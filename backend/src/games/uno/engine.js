const { v4: uuidv4 } = require("uuid");
const { UNO_GAME_ID } = require("../gameIds");
const { shuffle } = require("../../shared/random");

const UNO_PLAYERS_PER_DECK = 10;
const UNO_MIN_PLAYERS = 2;

const COLORS = ["red", "yellow", "green", "blue"];
const COLOR_LABELS = {
  red: "Rouge",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
};

function getDeckMultiplier(playerCount) {
  return Math.max(1, Math.ceil(playerCount / UNO_PLAYERS_PER_DECK));
}

function makeCard(type, color = null, value = null) {
  const labelByType = {
    skip: "Passe ton tour",
    reverse: "Changement de sens",
    draw2: "+2",
    wild: "Changement de couleur",
    wild4: "+4",
  };
  const label = type === "number" ? String(value) : labelByType[type];

  return {
    id: uuidv4(),
    type,
    color,
    value,
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

function createRoom({ code, playerId, name, socketId }) {
  return {
    code,
    gameId: UNO_GAME_ID,
    variant: "classic",
    host: playerId,
    maxScore: null,
    players: {
      [playerId]: createPlayer(name, socketId),
    },
    phase: "lobby",
    deck: buildDeck(1),
    discardPile: [],
    turnOrder: [],
    currentPlayerId: null,
    direction: 1,
    pendingDraw: 0,
    pendingDrawType: null,
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
  return room.chosenColor || getTopCard(room)?.color || null;
}

function canPlayOnTop(card, room) {
  if (!card) return false;

  if (room.pendingDraw > 0) {
    return (
      (room.pendingDrawType === "draw2" && card.type === "draw2") ||
      (room.pendingDrawType === "wild4" && card.type === "wild4")
    );
  }

  if (card.type === "wild" || card.type === "wild4") return true;

  const topCard = getTopCard(room);
  if (!topCard) return true;

  return (
    card.color === getCurrentColor(room) ||
    card.stackKey === topCard.stackKey
  );
}

function normalizeColor(color) {
  return COLORS.includes(color) ? color : null;
}

function validatePlay(room, player, cardIds, chosenColor) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
  if (cards.some((card) => !card)) return null;

  const [firstCard] = cards;
  if (!cards.every((card) => card.stackKey === firstCard.stackKey)) {
    return null;
  }

  if (room.drawnPlayableCardId && firstCard.id !== room.drawnPlayableCardId) {
    return null;
  }

  const wouldEmptyHand = player.hand.length === cards.length;
  const canFinish = cards.every((card) => card.type === "number");
  if (wouldEmptyHand && !canFinish) return null;

  if (!canPlayOnTop(firstCard, room)) return null;

  const needsColor = cards.some(
    (card) => card.type === "wild" || card.type === "wild4",
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

function applyPlayedCards(room, playerId, cards, chosenColor, context) {
  const player = room.players[playerId];
  const playedIds = new Set(cards.map((card) => card.id));
  player.hand = player.hand.filter((card) => !playedIds.has(card.id));

  cards.forEach((card) => room.discardPile.push(card));
  room.lastPlayedCards = cards;
  room.lastMove = {
    playerId,
    playerName: player.name,
    cards,
    chosenColor,
  };
  room.chosenColor = chosenColor;
  room.drawnPlayableCardId = null;

  if (!player.hand.length) {
    finishGame(room, playerId, context);
    return;
  }

  const draw2Count = cards.filter((card) => card.type === "draw2").length;
  const wild4Count = cards.filter((card) => card.type === "wild4").length;
  const reverseCount = cards.filter((card) => card.type === "reverse").length;
  const skipCount = cards.filter((card) => card.type === "skip").length;

  if (draw2Count > 0) {
    room.pendingDraw += draw2Count * 2;
    room.pendingDrawType = "draw2";
  }

  if (wild4Count > 0) {
    room.pendingDraw += wild4Count * 4;
    room.pendingDrawType = "wild4";
  }

  if (reverseCount % 2 === 1) {
    room.direction *= -1;
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
  const drawCount = hasDrawPenalty ? room.pendingDraw : 1;
  const drawnCards = drawCards(room, drawCount);
  player.hand.push(...drawnCards);
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
  room.deck = buildDeck(playerIds.length);
  room.discardPile = [];
  room.turnOrder = shuffle(playerIds);
  room.currentPlayerId = room.turnOrder[0] || null;
  room.direction = 1;
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.drawnPlayableCardId = null;
  room.chosenColor = null;
  room.lastPlayedCards = [];
  room.lastMove = null;
  room.winnerName = null;
  room.finalResults = null;

  playerIds.forEach((playerId) => {
    room.players[playerId].hand = drawCards(room, 7);
  });

  let firstCard = drawCard(room);
  while (firstCard && firstCard.type !== "number") {
    room.deck.unshift(firstCard);
    room.deck = shuffle(room.deck);
    firstCard = drawCard(room);
  }

  if (firstCard) room.discardPile.push(firstCard);
  room.phase = "uno_playing";
}

function replay(room) {
  Object.values(room.players).forEach((player) => {
    player.hand = [];
  });
  room.phase = "lobby";
  room.deck = buildDeck(Object.keys(room.players).length);
  room.discardPile = [];
  room.turnOrder = [];
  room.currentPlayerId = null;
  room.direction = 1;
  room.pendingDraw = 0;
  room.pendingDrawType = null;
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
    deckCount: room.deck.length,
    discardTop: topCard,
    chosenColor: room.chosenColor,
    currentColor: getCurrentColor(room),
    currentPlayerId: room.currentPlayerId,
    direction: room.direction,
    pendingDraw: room.pendingDraw,
    pendingDrawType: room.pendingDrawType,
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
      hand: id === requesterId ? player.hand : undefined,
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
