const { v4: uuidv4 } = require("uuid");
const { UNO_GAME_ID } = require("../gameIds");
const { shuffle } = require("../../shared/random");

const UNO_PLAYERS_PER_DECK = 10;
const UNO_MIN_PLAYERS = 2;

const CLASSIC_VARIANT = "classic";
const FLIP_VARIANT = "flip";
const LIGHT_SIDE = "light";
const DARK_SIDE = "dark";

const COLORS = ["red", "yellow", "green", "blue"];
const FLIP_COLORS = {
  [LIGHT_SIDE]: ["blue", "green", "red", "yellow"],
  [DARK_SIDE]: ["pink", "cyan", "orange", "purple"],
};
const COLOR_LABELS = {
  red: "Rouge",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
  pink: "Rose",
  cyan: "Turquoise",
  orange: "Orange",
  purple: "Violet",
};

function getDeckMultiplier(playerCount) {
  return Math.max(1, Math.ceil(playerCount / UNO_PLAYERS_PER_DECK));
}

function normalizeVariant(variant) {
  return variant === FLIP_VARIANT ? FLIP_VARIANT : CLASSIC_VARIANT;
}

function makeCard(type, color = null, value = null, side = null) {
  const labelByType = {
    skip: "Passe ton tour",
    reverse: "Changement de sens",
    draw2: "+2",
    draw1: "+1",
    draw5: "+5",
    wild: "Changement de couleur",
    wild4: "+4",
    wild2: "+2",
    wildDraw: "Joker pioche couleur",
    replay: "Rejouer",
    flip: "Flip",
  };
  const label = type === "number" ? String(value) : labelByType[type];

  return {
    id: uuidv4(),
    type,
    color,
    value,
    side,
    label,
    stackKey: type === "number" ? `number:${value}` : type,
    colorLabel: color ? COLOR_LABELS[color] : "Joker",
  };
}

function makeFlipPair(lightFace, darkFace) {
  return {
    id: uuidv4(),
    variant: FLIP_VARIANT,
    faces: {
      [LIGHT_SIDE]: { ...lightFace, id: undefined },
      [DARK_SIDE]: { ...darkFace, id: undefined },
    },
  };
}

function getCardFace(card, roomOrSide) {
  if (!card?.faces) return card;
  const side = typeof roomOrSide === "string" ? roomOrSide : roomOrSide?.side;
  const face = card.faces[side || LIGHT_SIDE] || card.faces[LIGHT_SIDE];
  return {
    ...face,
    id: card.id,
    pairId: card.id,
  };
}

function exposeCard(card, room) {
  if (!card) return null;
  return getCardFace(card, room);
}

function buildSingleDeck() {
  const colorCards = COLORS.flatMap((color) => {
    const numbers = Array.from({ length: 10 }, (_, value) =>
      Array.from({ length: 2 }, () => makeCard("number", color, value)),
    ).flat();
    const actions = ["skip", "draw2", "reverse"].flatMap((type) =>
      Array.from({ length: 2 }, () => makeCard(type, color)),
    );
    return [...numbers, ...actions];
  });

  const wilds = [
    ...Array.from({ length: 4 }, () => makeCard("wild")),
    ...Array.from({ length: 4 }, () => makeCard("wild4")),
  ];

  return shuffle([...colorCards, ...wilds]);
}

function buildDeck(playerCount = 1) {
  const multiplier = getDeckMultiplier(playerCount);
  return shuffle(
    Array.from({ length: multiplier }, () => buildSingleDeck()).flat(),
  );
}

function buildFlipFaces(side) {
  const colors = FLIP_COLORS[side];
  const actionTypes =
    side === LIGHT_SIDE
      ? ["draw1", "reverse", "skip", "flip"]
      : ["draw5", "reverse", "replay", "flip"];
  const wildTypes = side === LIGHT_SIDE ? ["wild", "wild2"] : ["wild", "wildDraw"];

  const colorCards = colors.flatMap((color) => {
    const numbers = Array.from({ length: 9 }, (_, index) =>
      Array.from({ length: 2 }, () => makeCard("number", color, index + 1, side)),
    ).flat();
    const actions = actionTypes.flatMap((type) =>
      Array.from({ length: 2 }, () => makeCard(type, color, null, side)),
    );
    return [...numbers, ...actions];
  });

  const wilds = wildTypes.flatMap((type) =>
    Array.from({ length: 4 }, () => makeCard(type, null, null, side)),
  );

  return shuffle([...colorCards, ...wilds]);
}

function buildFlipDeck(playerCount = 1) {
  const multiplier = getDeckMultiplier(playerCount);
  return shuffle(
    Array.from({ length: multiplier }, () => {
      const lightFaces = buildFlipFaces(LIGHT_SIDE);
      const darkFaces = buildFlipFaces(DARK_SIDE);
      return lightFaces.map((lightFace, index) =>
        makeFlipPair(lightFace, darkFaces[index]),
      );
    }).flat(),
  );
}

function createPlayer(name, socketId) {
  return {
    name,
    score: 0,
    socketId,
    connected: true,
    disconnectedAt: null,
    hand: [],
  };
}

function createRoom({ code, playerId, name, socketId, variant }) {
  const selectedVariant = normalizeVariant(variant);
  return {
    code,
    gameId: UNO_GAME_ID,
    variant: selectedVariant,
    side: selectedVariant === FLIP_VARIANT ? LIGHT_SIDE : null,
    host: playerId,
    maxScore: null,
    players: {
      [playerId]: createPlayer(name, socketId),
    },
    phase: "lobby",
    deck: selectedVariant === FLIP_VARIANT ? buildFlipDeck(1) : buildDeck(1),
    discardPile: [],
    turnOrder: [],
    currentPlayerId: null,
    direction: 1,
    pendingDraw: 0,
    pendingDrawType: null,
    pendingWildDrawColor: null,
    drawnPlayableCardId: null,
    chosenColor: null,
    lastPlayedCards: [],
    lastMove: null,
    winnerName: null,
    finalResults: null,
    cleanupTimer: null,
  };
}

function drawCard(room) {
  if (!room.deck.length) {
    const topDiscard = room.discardPile.pop();
    room.deck = shuffle(room.discardPile);
    room.discardPile = topDiscard ? [topDiscard] : [];
  }

  return room.deck.pop() || null;
}

function drawCards(room, count) {
  return Array.from({ length: count }, () => drawCard(room)).filter(Boolean);
}

function getActivePlayerIds(room) {
  return room.turnOrder.filter((id) => room.players[id]);
}

function advanceTurn(room, steps = 1) {
  const activeIds = getActivePlayerIds(room);
  if (!activeIds.length) {
    room.currentPlayerId = null;
    return;
  }

  const currentIndex = activeIds.indexOf(room.currentPlayerId);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    (startIndex + room.direction * steps + activeIds.length * steps) %
    activeIds.length;
  room.currentPlayerId = activeIds[nextIndex];
}

function getTopCard(room) {
  return room.discardPile.at(-1) || null;
}

function getCurrentColor(room) {
  return room.chosenColor || getCardFace(getTopCard(room), room)?.color || null;
}

function canPlayOnTop(card, room) {
  const face = getCardFace(card, room);
  if (!face) return false;

  if (room.pendingWildDrawColor) return false;

  if (room.pendingDraw > 0) {
    return (
      (room.pendingDrawType === "draw2" && face.type === "draw2") ||
      (room.pendingDrawType === "wild4" && face.type === "wild4") ||
      (room.pendingDrawType === "draw1" && face.type === "draw1") ||
      (room.pendingDrawType === "draw5" && face.type === "draw5") ||
      (room.pendingDrawType === "wild2" && face.type === "wild2")
    );
  }

  if (
    face.type === "wild" ||
    face.type === "wild4" ||
    face.type === "wild2" ||
    face.type === "wildDraw"
  ) {
    return true;
  }

  const topFace = getCardFace(getTopCard(room), room);
  if (!topFace) return true;

  return face.color === getCurrentColor(room) || face.stackKey === topFace.stackKey;
}

function normalizeColor(color) {
  const allColors = [...COLORS, ...FLIP_COLORS[LIGHT_SIDE], ...FLIP_COLORS[DARK_SIDE]];
  return allColors.includes(color) ? color : null;
}

function validatePlay(room, player, cardIds, chosenColor) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (cards.some((card) => !card)) return null;

  const faces = cards.map((card) => getCardFace(card, room));
  const [firstFace] = faces;
  if (!faces.every((face) => face.stackKey === firstFace.stackKey)) return null;

  if (room.drawnPlayableCardId && cards[0].id !== room.drawnPlayableCardId) {
    return null;
  }

  const wouldEmptyHand = player.hand.length === cards.length;
  const canFinish = faces.every((face) => face.type === "number");
  if (wouldEmptyHand && !canFinish) return null;

  if (!canPlayOnTop(cards[0], room)) return null;

  const needsColor = faces.some(
    (face) =>
      face.type === "wild" ||
      face.type === "wild4" ||
      face.type === "wild2" ||
      face.type === "wildDraw",
  );
  const nextColor = needsColor ? normalizeColor(chosenColor) : null;
  if (needsColor && !nextColor) return null;

  return { cards, faces, nextColor };
}

function finishGame(room, winnerId, context) {
  const results = Object.entries(room.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      cardsLeft: player.hand.length,
    }))
    .sort((a, b) => a.cardsLeft - b.cardsLeft);

  room.phase = "scores";
  room.currentPlayerId = null;
  room.winnerName = room.players[winnerId]?.name || results[0]?.name || null;
  room.finalResults = results;

  context.emitRoomUpdate(room);
  context.io.to(room.code).emit("game_over", {
    winner: room.winnerName,
    results,
  });
}

function applyPlayedCards(room, playerId, cards, faces, chosenColor, context) {
  const player = room.players[playerId];
  const playedIds = new Set(cards.map((card) => card.id));
  player.hand = player.hand.filter((card) => !playedIds.has(card.id));

  cards.forEach((card) => room.discardPile.push(card));
  room.lastPlayedCards = cards.map((card) => exposeCard(card, room));
  room.lastMove = {
    playerId,
    playerName: player.name,
    cards: cards.map((card) => exposeCard(card, room)),
    chosenColor,
  };
  room.chosenColor = chosenColor;
  room.drawnPlayableCardId = null;

  if (!player.hand.length) {
    finishGame(room, playerId, context);
    return;
  }

  const countType = (type) => faces.filter((face) => face.type === type).length;
  const draw2Count = countType("draw2");
  const draw1Count = countType("draw1");
  const draw5Count = countType("draw5");
  const wild4Count = countType("wild4");
  const wild2Count = countType("wild2");
  const wildDrawCount = countType("wildDraw");
  const reverseCount = countType("reverse");
  const skipCount = countType("skip");
  const replayCount = countType("replay");
  const flipCount = countType("flip");

  if (draw2Count > 0) {
    room.pendingDraw += draw2Count * 2;
    room.pendingDrawType = "draw2";
  }

  if (wild4Count > 0) {
    room.pendingDraw += wild4Count * 4;
    room.pendingDrawType = "wild4";
  }

  if (draw1Count > 0) {
    room.pendingDraw += draw1Count;
    room.pendingDrawType = "draw1";
  }

  if (draw5Count > 0) {
    room.pendingDraw += draw5Count * 5;
    room.pendingDrawType = "draw5";
  }

  if (wild2Count > 0) {
    room.pendingDraw += wild2Count * 2;
    room.pendingDrawType = "wild2";
  }

  if (wildDrawCount > 0) {
    room.pendingWildDrawColor = chosenColor;
  }

  if (reverseCount % 2 === 1) {
    room.direction *= -1;
  }

  if (room.variant === FLIP_VARIANT && flipCount % 2 === 1) {
    room.side = room.side === LIGHT_SIDE ? DARK_SIDE : LIGHT_SIDE;
    room.chosenColor = null;
    room.drawnPlayableCardId = null;
  }

  if (replayCount > 0) {
    context.emitRoomUpdate(room);
    return;
  }

  advanceTurn(room, skipCount + 1);
  context.emitRoomUpdate(room);
}

function playCards(room, playerId, cardIds, chosenColor, context) {
  const player = room.players[playerId];
  if (!player || room.phase !== "uno_playing") return false;
  if (room.currentPlayerId !== playerId) return false;

  const validPlay = validatePlay(room, player, cardIds, chosenColor);
  if (!validPlay) return false;

  applyPlayedCards(
    room,
    playerId,
    validPlay.cards,
    validPlay.faces,
    validPlay.nextColor,
    context,
  );
  return true;
}

function drawForTurn(room, playerId, context) {
  const player = room.players[playerId];
  if (!player || room.phase !== "uno_playing") return false;
  if (room.currentPlayerId !== playerId) return false;

  const hasDrawPenalty = room.pendingDraw > 0;
  const hasWildDrawPenalty = Boolean(room.pendingWildDrawColor);
  if (hasWildDrawPenalty) {
    const drawnCards = [];
    const targetColor = room.pendingWildDrawColor;
    let guard = room.deck.length + room.discardPile.length + 8;
    while (guard > 0) {
      guard -= 1;
      const card = drawCard(room);
      if (!card) break;
      drawnCards.push(card);
      if (getCardFace(card, room).color === targetColor) break;
    }
    player.hand.push(...drawnCards);
    room.pendingWildDrawColor = null;
    room.lastPlayedCards = [];
    room.lastMove = null;
    room.drawnPlayableCardId = null;
    advanceTurn(room, 1);
    context.emitRoomUpdate(room);
    return true;
  }

  const drawCount = hasDrawPenalty ? room.pendingDraw : 1;
  const drawnCards = drawCards(room, drawCount);
  player.hand.push(...drawnCards);
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.lastPlayedCards = [];
  room.lastMove = null;
  room.drawnPlayableCardId = null;

  if (hasDrawPenalty) {
    advanceTurn(room, 1);
    context.emitRoomUpdate(room);
    return true;
  }

  const [drawnCard] = drawnCards;
  if (drawnCard && canPlayOnTop(drawnCard, room)) {
    room.drawnPlayableCardId = drawnCard.id;
    context.emitRoomUpdate(room);
    return true;
  }

  advanceTurn(room, 1);
  context.emitRoomUpdate(room);
  return true;
}

function passAfterDraw(room, playerId, context) {
  if (room.phase !== "uno_playing") return false;
  if (room.currentPlayerId !== playerId || !room.drawnPlayableCardId) return false;

  room.drawnPlayableCardId = null;
  advanceTurn(room, 1);
  context.emitRoomUpdate(room);
  return true;
}

function drawInitialNumber(room) {
  let firstCard = drawCard(room);
  while (firstCard && getCardFace(firstCard, room).type !== "number") {
    room.deck.unshift(firstCard);
    room.deck = shuffle(room.deck);
    firstCard = drawCard(room);
  }
  return firstCard;
}

function startGame(room) {
  const playerIds = Object.keys(room.players);
  room.side = room.variant === FLIP_VARIANT ? LIGHT_SIDE : null;
  room.deck = room.variant === FLIP_VARIANT ? buildFlipDeck(playerIds.length) : buildDeck(playerIds.length);
  room.discardPile = [];
  room.turnOrder = shuffle(playerIds);
  room.currentPlayerId = room.turnOrder[0] || null;
  room.direction = 1;
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.pendingWildDrawColor = null;
  room.drawnPlayableCardId = null;
  room.chosenColor = null;
  room.lastPlayedCards = [];
  room.lastMove = null;
  room.winnerName = null;
  room.finalResults = null;

  playerIds.forEach((playerId) => {
    room.players[playerId].hand = drawCards(room, 7);
  });

  const firstCard = drawInitialNumber(room);
  if (firstCard) room.discardPile.push(firstCard);
  room.phase = "uno_playing";
}

function replay(room) {
  Object.values(room.players).forEach((player) => {
    player.hand = [];
  });
  const playerCount = Object.keys(room.players).length;
  room.phase = "lobby";
  room.side = room.variant === FLIP_VARIANT ? LIGHT_SIDE : null;
  room.deck = room.variant === FLIP_VARIANT ? buildFlipDeck(playerCount) : buildDeck(playerCount);
  room.discardPile = [];
  room.turnOrder = [];
  room.currentPlayerId = null;
  room.direction = 1;
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.pendingWildDrawColor = null;
  room.drawnPlayableCardId = null;
  room.chosenColor = null;
  room.lastPlayedCards = [];
  room.lastMove = null;
  room.winnerName = null;
  room.finalResults = null;
}

function removePlayer(room, playerId) {
  room.turnOrder = room.turnOrder.filter((id) => id !== playerId);
  if (room.currentPlayerId === playerId) {
    room.drawnPlayableCardId = null;
    advanceTurn(room, 1);
  }
}

function sanitizeRoom(room, requesterId) {
  const topCard = getTopCard(room);

  return {
    code: room.code,
    gameId: room.gameId,
    variant: room.variant,
    host: room.host,
    phase: room.phase,
    side: room.side,
    deckCount: room.deck.length,
    discardTop: exposeCard(topCard, room),
    chosenColor: room.chosenColor,
    currentColor: getCurrentColor(room),
    currentPlayerId: room.currentPlayerId,
    direction: room.direction,
    pendingDraw: room.pendingDraw,
    pendingDrawType: room.pendingDrawType,
    pendingWildDrawColor: room.pendingWildDrawColor,
    drawnPlayableCardId:
      room.currentPlayerId === requesterId ? room.drawnPlayableCardId : null,
    lastPlayedCards: room.lastPlayedCards,
    lastMove: room.lastMove,
    winnerName: room.winnerName,
    finalResults: room.finalResults,
    players: Object.entries(room.players).map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      cardsCount: player.hand.length,
      hand: id === requesterId ? player.hand.map((card) => exposeCard(card, room)) : undefined,
    })),
  };
}

module.exports = {
  UNO_MIN_PLAYERS,
  canPlayOnTop,
  createPlayer,
  createRoom,
  drawForTurn,
  getDeckMultiplier,
  passAfterDraw,
  playCards,
  removePlayer,
  replay,
  sanitizeRoom,
  startGame,
};
