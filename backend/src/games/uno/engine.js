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

function getActiveDeck(room) {
  return room.variant === FLIP_VARIANT ? room.decks[room.side] : room.deck;
}

function setActiveDeck(room, deck) {
  if (room.variant === FLIP_VARIANT) {
    room.decks[room.side] = deck;
  } else {
    room.deck = deck;
  }
}

function getActiveDiscardPile(room) {
  return room.variant === FLIP_VARIANT
    ? room.discardPiles[room.side]
    : room.discardPile;
}

function getActiveHand(player, room) {
  return room.variant === FLIP_VARIANT ? player.hands[room.side] : player.hand;
}

function setActiveHand(player, room, hand) {
  if (room.variant === FLIP_VARIANT) {
    player.hands[room.side] = hand;
  } else {
    player.hand = hand;
  }
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

function buildFlipSideDeck(side, playerCount = 1) {
  const multiplier = getDeckMultiplier(playerCount);
  const colors = FLIP_COLORS[side];
  const actionTypes =
    side === LIGHT_SIDE
      ? ["draw1", "reverse", "skip", "flip"]
      : ["draw5", "reverse", "replay", "flip"];
  const wildTypes = side === LIGHT_SIDE ? ["wild", "wild2"] : ["wild", "wildDraw"];

  const buildSingleSideDeck = () => {
    const colorCards = colors.flatMap((color) => {
      const numbers = Array.from({ length: 9 }, (_, index) =>
        Array.from({ length: 2 }, () =>
          makeCard("number", color, index + 1, side),
        ),
      ).flat();
      const actions = actionTypes.flatMap((type) =>
        Array.from({ length: 2 }, () => makeCard(type, color, null, side)),
      );
      return [...numbers, ...actions];
    });

    const wilds = wildTypes.flatMap((type) =>
      Array.from({ length: 4 }, () => makeCard(type, null, null, side)),
    );

    return [...colorCards, ...wilds];
  };

  return shuffle(
    Array.from({ length: multiplier }, () => buildSingleSideDeck()).flat(),
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
    hands: {
      [LIGHT_SIDE]: [],
      [DARK_SIDE]: [],
    },
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
    deck: buildDeck(1),
    decks: {
      [LIGHT_SIDE]: buildFlipSideDeck(LIGHT_SIDE, 1),
      [DARK_SIDE]: buildFlipSideDeck(DARK_SIDE, 1),
    },
    discardPile: [],
    discardPiles: {
      [LIGHT_SIDE]: [],
      [DARK_SIDE]: [],
    },
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
  let deck = getActiveDeck(room);
  const discardPile = getActiveDiscardPile(room);

  if (!deck.length) {
    const topDiscard = discardPile.pop();
    deck = shuffle(discardPile);
    discardPile.splice(0, discardPile.length, ...(topDiscard ? [topDiscard] : []));
    setActiveDeck(room, deck);
  }

  return deck.pop() || null;
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
  return getActiveDiscardPile(room).at(-1) || null;
}

function getCurrentColor(room) {
  return room.chosenColor || getTopCard(room)?.color || null;
}

function canPlayOnTop(card, room) {
  if (!card) return false;

  if (room.pendingWildDrawColor) return false;

  if (room.pendingDraw > 0) {
    return (
      (room.pendingDrawType === "draw2" && card.type === "draw2") ||
      (room.pendingDrawType === "wild4" && card.type === "wild4") ||
      (room.pendingDrawType === "draw1" && card.type === "draw1") ||
      (room.pendingDrawType === "draw5" && card.type === "draw5") ||
      (room.pendingDrawType === "wild2" && card.type === "wild2")
    );
  }

  if (
    card.type === "wild" ||
    card.type === "wild4" ||
    card.type === "wild2" ||
    card.type === "wildDraw"
  ) {
    return true;
  }

  const topCard = getTopCard(room);
  if (!topCard) return true;

  return (
    card.color === getCurrentColor(room) ||
    card.stackKey === topCard.stackKey
  );
}

function normalizeColor(color) {
  const allColors = [...COLORS, ...FLIP_COLORS[LIGHT_SIDE], ...FLIP_COLORS[DARK_SIDE]];
  return allColors.includes(color) ? color : null;
}

function validatePlay(room, player, cardIds, chosenColor) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const hand = getActiveHand(player, room);
  const cards = cardIds.map((id) => hand.find((card) => card.id === id));
  if (cards.some((card) => !card)) return null;

  const [firstCard] = cards;
  if (!cards.every((card) => card.stackKey === firstCard.stackKey)) {
    return null;
  }

  if (room.drawnPlayableCardId && firstCard.id !== room.drawnPlayableCardId) {
    return null;
  }

  const wouldEmptyHand = hand.length === cards.length;
  const canFinish = cards.every((card) => card.type === "number");
  if (wouldEmptyHand && !canFinish) return null;

  if (!canPlayOnTop(firstCard, room)) return null;

  const needsColor = cards.some(
    (card) =>
      card.type === "wild" ||
      card.type === "wild4" ||
      card.type === "wild2" ||
      card.type === "wildDraw",
  );
  const nextColor = needsColor ? normalizeColor(chosenColor) : null;
  if (needsColor && !nextColor) return null;

  return { cards, nextColor };
}

function finishGame(room, winnerId, context) {
  const results = Object.entries(room.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      cardsLeft: getActiveHand(player, room).length,
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

function applyPlayedCards(room, playerId, cards, chosenColor, context) {
  const player = room.players[playerId];
  const playedIds = new Set(cards.map((card) => card.id));
  setActiveHand(
    player,
    room,
    getActiveHand(player, room).filter((card) => !playedIds.has(card.id)),
  );

  cards.forEach((card) => getActiveDiscardPile(room).push(card));
  room.lastPlayedCards = cards;
  room.lastMove = {
    playerId,
    playerName: player.name,
    cards,
    chosenColor,
  };
  room.chosenColor = chosenColor;
  room.drawnPlayableCardId = null;

  if (!getActiveHand(player, room).length) {
    finishGame(room, playerId, context);
    return;
  }

  const draw2Count = cards.filter((card) => card.type === "draw2").length;
  const draw1Count = cards.filter((card) => card.type === "draw1").length;
  const draw5Count = cards.filter((card) => card.type === "draw5").length;
  const wild4Count = cards.filter((card) => card.type === "wild4").length;
  const wild2Count = cards.filter((card) => card.type === "wild2").length;
  const wildDrawCount = cards.filter((card) => card.type === "wildDraw").length;
  const reverseCount = cards.filter((card) => card.type === "reverse").length;
  const skipCount = cards.filter((card) => card.type === "skip").length;
  const replayCount = cards.filter((card) => card.type === "replay").length;
  const flipCount = cards.filter((card) => card.type === "flip").length;

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
    let guard = getActiveDeck(room).length + getActiveDiscardPile(room).length + 8;
    while (guard > 0) {
      guard -= 1;
      const card = drawCard(room);
      if (!card) break;
      drawnCards.push(card);
      if (card.color === targetColor) break;
    }
    setActiveHand(player, room, [...getActiveHand(player, room), ...drawnCards]);
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
  setActiveHand(player, room, [...getActiveHand(player, room), ...drawnCards]);
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.lastPlayedCards = [];
  room.lastMove = null;
  room.drawnPlayableCardId = null;

  if (hasDrawPenalty) {
    // +2 et +4 fonctionnent pareil : la pioche forcee met toujours fin au
    // tour (le seul moyen d'eviter de piocher est de surencherir avant).
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

function startGame(room) {
  const playerIds = Object.keys(room.players);
  if (room.variant === FLIP_VARIANT) {
    room.side = LIGHT_SIDE;
    room.decks = {
      [LIGHT_SIDE]: buildFlipSideDeck(LIGHT_SIDE, playerIds.length),
      [DARK_SIDE]: buildFlipSideDeck(DARK_SIDE, playerIds.length),
    };
    room.discardPiles = {
      [LIGHT_SIDE]: [],
      [DARK_SIDE]: [],
    };
  }
  room.deck = buildDeck(playerIds.length);
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
    if (room.variant === FLIP_VARIANT) {
      room.side = LIGHT_SIDE;
      room.players[playerId].hands[LIGHT_SIDE] = drawCards(room, 7);
      room.side = DARK_SIDE;
      room.players[playerId].hands[DARK_SIDE] = drawCards(room, 7);
      room.side = LIGHT_SIDE;
      room.players[playerId].hand = room.players[playerId].hands[LIGHT_SIDE];
    } else {
      room.players[playerId].hand = drawCards(room, 7);
    }
  });

  let firstCard = drawCard(room);
  while (firstCard && firstCard.type !== "number") {
    getActiveDeck(room).unshift(firstCard);
    setActiveDeck(room, shuffle(getActiveDeck(room)));
    firstCard = drawCard(room);
  }

  if (firstCard) room.discardPile.push(firstCard);
  if (room.variant === FLIP_VARIANT) {
    const lightFirstCard = room.discardPile.pop();
    if (lightFirstCard) room.discardPiles[LIGHT_SIDE].push(lightFirstCard);
    room.side = DARK_SIDE;
    let darkFirstCard = drawCard(room);
    while (darkFirstCard && darkFirstCard.type !== "number") {
      getActiveDeck(room).unshift(darkFirstCard);
      setActiveDeck(room, shuffle(getActiveDeck(room)));
      darkFirstCard = drawCard(room);
    }
    if (darkFirstCard) room.discardPiles[DARK_SIDE].push(darkFirstCard);
    room.side = LIGHT_SIDE;
    room.discardPile = [];
  }
  room.phase = "uno_playing";
}

function replay(room) {
  Object.values(room.players).forEach((player) => {
    player.hand = [];
    player.hands = {
      [LIGHT_SIDE]: [],
      [DARK_SIDE]: [],
    };
  });
  room.phase = "lobby";
  room.deck = buildDeck(Object.keys(room.players).length);
  room.decks = {
    [LIGHT_SIDE]: buildFlipSideDeck(LIGHT_SIDE, Object.keys(room.players).length),
    [DARK_SIDE]: buildFlipSideDeck(DARK_SIDE, Object.keys(room.players).length),
  };
  room.discardPile = [];
  room.discardPiles = {
    [LIGHT_SIDE]: [],
    [DARK_SIDE]: [],
  };
  room.side = room.variant === FLIP_VARIANT ? LIGHT_SIDE : null;
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
    deckCount: getActiveDeck(room).length,
    discardTop: topCard,
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
      cardsCount:
        room.variant === FLIP_VARIANT
          ? getActiveHand(player, room).length
          : player.hand.length,
      hand: id === requesterId ? getActiveHand(player, room) : undefined,
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
