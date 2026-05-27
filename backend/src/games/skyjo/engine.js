const { v4: uuidv4 } = require("uuid");
const { SKYJO_GAME_ID } = require("../gameIds");
const { shuffle } = require("../../shared/random");

const SKYJO_MAX_PLAYERS = 40;
const SKYJO_PLAYERS_PER_DECK = 8;
const SKYJO_MAX_DECK_MULTIPLIER = 5;

function getDeckMultiplier(playerCount) {
  return Math.min(
    SKYJO_MAX_DECK_MULTIPLIER,
    Math.max(1, Math.ceil(playerCount / SKYJO_PLAYERS_PER_DECK)),
  );
}

function buildSingleDeck() {
  const entries = [
    [-2, 5],
    [0, 15],
    [-1, 10],
    [1, 10],
    [2, 10],
    [3, 10],
    [4, 10],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
    [11, 10],
    [12, 10],
  ];

  return shuffle(
    entries.flatMap(([value, count]) =>
      Array.from({ length: count }, () => value),
    ),
  );
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
    board: [],
  };
}

function createRoom({ code, playerId, name, socketId, maxScore }) {
  const room = {
    code,
    gameId: SKYJO_GAME_ID,
    host: playerId,
    maxScore: maxScore || 100,
    players: {
      [playerId]: createPlayer(name, socketId),
    },
    phase: "lobby",
    deck: buildDeck(1),
    discardPile: [],
    currentPlayerId: null,
    drawnCard: null,
    drawSource: null,
    pendingDiscardReveal: false,
    turnOrder: [],
    closerId: null,
    finalTurnQueue: [],
    roundIndex: 0,
    lastRound: null,
    winnerName: null,
    finalResults: null,
    cleanupTimer: null,
  };

  return room;
}

function drawCard(room) {
  if (!room.deck.length) {
    const topDiscard = room.discardPile.pop();
    room.deck = shuffle(room.discardPile);
    room.discardPile = topDiscard === undefined ? [] : [topDiscard];
  }

  return room.deck.pop();
}

function dealBoards(room) {
  Object.values(room.players).forEach((player) => {
    player.board = Array.from({ length: 12 }, (_, index) => ({
      id: uuidv4(),
      index,
      value: drawCard(room),
      revealed: false,
      removed: false,
    }));
  });
}

function getBoardForRequester(player, revealAll) {
  return player.board.map((card) => ({
    index: card.index,
    value: revealAll || card.revealed || card.removed ? card.value : null,
    revealed: card.revealed || revealAll,
    removed: card.removed,
  }));
}

function getVisibleScore(player) {
  return player.board.reduce((total, card) => {
    if (card.removed || !card.revealed) return total;
    return total + card.value;
  }, 0);
}

function getBoardScore(player) {
  return player.board.reduce((total, card) => {
    if (card.removed) return total;
    return total + card.value;
  }, 0);
}

function getRevealedCount(player) {
  return player.board.filter((card) => card.revealed && !card.removed).length;
}

function hasFinishedBoard(player) {
  return player.board.every((card) => card.removed || card.revealed);
}

function sanitizeRoom(room, requesterId) {
  const revealAll = room.phase === "skyjo_round_over" || room.phase === "scores";
  const canSeeDrawnCard = room.currentPlayerId === requesterId || revealAll;

  return {
    code: room.code,
    gameId: room.gameId,
    host: room.host,
    maxScore: room.maxScore,
    phase: room.phase,
    roundIndex: room.roundIndex,
    deckCount: room.deck.length,
    discardTop: room.discardPile.at(-1) ?? null,
    currentPlayerId: room.currentPlayerId,
    drawnCard: canSeeDrawnCard ? room.drawnCard : null,
    drawSource: room.currentPlayerId === requesterId ? room.drawSource : null,
    closerId: room.closerId,
    finalTurnQueue: room.finalTurnQueue,
    lastRound: room.lastRound,
    winnerName: room.winnerName,
    finalResults: room.finalResults,
    players: Object.entries(room.players).map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      visibleScore: getVisibleScore(player),
      revealedCount: getRevealedCount(player),
      board: getBoardForRequester(player, revealAll),
    })),
  };
}

function removeCompletedColumns(player, discardPile) {
  for (let col = 0; col < 4; col += 1) {
    const indexes = [col, col + 4, col + 8];
    const columnCards = indexes.map((index) => player.board[index]);
    const canRemove = columnCards.every(
      (card) => card && !card.removed && card.revealed,
    );

    if (!canRemove) continue;

    const [firstCard] = columnCards;
    if (columnCards.every((card) => card.value === firstCard.value)) {
      columnCards.forEach((card) => {
        card.removed = true;
        discardPile.push(card.value);
      });
    }
  }
}

function getActivePlayerIds(room) {
  return room.turnOrder.filter((id) => room.players[id]);
}

function setNextPlayer(room) {
  const activeIds = getActivePlayerIds(room);
  if (!activeIds.length) {
    room.currentPlayerId = null;
    return;
  }

  if (room.finalTurnQueue.length) {
    room.currentPlayerId = room.finalTurnQueue.shift();
    return;
  }

  const currentIndex = activeIds.indexOf(room.currentPlayerId);
  room.currentPlayerId = activeIds[(currentIndex + 1) % activeIds.length];
}

function finalizeRound(room, context) {
  Object.values(room.players).forEach((player) => {
    player.board.forEach((card) => {
      if (!card.removed) card.revealed = true;
    });
    removeCompletedColumns(player, room.discardPile);
  });

  const baseScores = Object.fromEntries(
    Object.entries(room.players).map(([id, player]) => [
      id,
      getBoardScore(player),
    ]),
  );
  const closerScore = baseScores[room.closerId];
  const otherScores = Object.entries(baseScores)
    .filter(([id]) => id !== room.closerId)
    .map(([, score]) => score);
  const closerHasStrictLowest =
    otherScores.length === 0 ||
    otherScores.every((score) => closerScore < score);
  const shouldDoubleCloser =
    closerScore > 0 && room.closerId && !closerHasStrictLowest;

  const results = Object.entries(room.players)
    .map(([id, player]) => {
      const baseRoundScore = baseScores[id];
      const roundScore =
        id === room.closerId && shouldDoubleCloser
          ? baseRoundScore * 2
          : baseRoundScore;
      player.score += roundScore;
      return {
        id,
        name: player.name,
        baseRoundScore,
        roundScore,
        doubled: id === room.closerId && shouldDoubleCloser,
        score: player.score,
      };
    })
    .sort((a, b) => a.score - b.score);

  room.lastRound = { results, closerId: room.closerId };

  const gameIsOver = results.some((result) => result.score >= room.maxScore);
  if (gameIsOver) {
    room.phase = "scores";
    room.finalResults = results;
    room.winnerName = results[0]?.name || null;
    context.emitRoomUpdate(room);
    context.io.to(room.code).emit("game_over", {
      winner: room.winnerName,
      results,
    });
    return;
  }

  room.phase = "skyjo_round_over";
  room.currentPlayerId = null;
  room.drawnCard = null;
  room.drawSource = null;
  room.pendingDiscardReveal = false;
  context.emitRoomUpdate(room);
}

function finishTurn(room, context) {
  const player = room.players[room.currentPlayerId];
  if (player) {
    removeCompletedColumns(player, room.discardPile);

    if (!room.closerId && hasFinishedBoard(player)) {
      room.closerId = room.currentPlayerId;
      const activeIds = getActivePlayerIds(room);
      const currentIndex = activeIds.indexOf(room.currentPlayerId);
      room.finalTurnQueue = activeIds
        .slice(currentIndex + 1)
        .concat(activeIds.slice(0, currentIndex));
    }
  }

  room.drawnCard = null;
  room.drawSource = null;
  room.pendingDiscardReveal = false;

  if (room.closerId && room.finalTurnQueue.length === 0) {
    finalizeRound(room, context);
    return;
  }

  room.phase = "skyjo_playing";
  setNextPlayer(room);
  context.emitRoomUpdate(room);
}

function startRound(room) {
  const playerCount = Object.keys(room.players).length;

  room.roundIndex += 1;
  room.deck = buildDeck(playerCount);
  room.discardPile = [];
  room.currentPlayerId = null;
  room.drawnCard = null;
  room.drawSource = null;
  room.pendingDiscardReveal = false;
  room.closerId = null;
  room.finalTurnQueue = [];
  room.lastRound = null;
  room.winnerName = null;
  room.finalResults = null;
  room.turnOrder = Object.keys(room.players);
  dealBoards(room);
  room.discardPile.push(drawCard(room));
  room.phase = "skyjo_setup";
}

function maybeStartTurns(room) {
  const allReady = Object.values(room.players).every(
    (player) => getRevealedCount(player) >= 2,
  );
  if (!allReady) return false;

  const firstPlayer = Object.entries(room.players)
    .map(([id, player]) => ({
      id,
      initialScore: getVisibleScore(player),
    }))
    .sort((a, b) => b.initialScore - a.initialScore)[0];

  room.currentPlayerId = firstPlayer?.id || room.host;
  room.phase = "skyjo_playing";
  return true;
}

function resetToLobby(room) {
  Object.values(room.players).forEach((player) => {
    player.score = 0;
    player.board = [];
  });

  room.deck = buildDeck(Object.keys(room.players).length);
  room.discardPile = [];
  room.currentPlayerId = null;
  room.drawnCard = null;
  room.drawSource = null;
  room.pendingDiscardReveal = false;
  room.turnOrder = Object.keys(room.players);
  room.closerId = null;
  room.finalTurnQueue = [];
  room.roundIndex = 0;
  room.lastRound = null;
  room.winnerName = null;
  room.finalResults = null;
  room.phase = "lobby";
}

function removePlayer(room, playerId) {
  room.turnOrder = room.turnOrder.filter((id) => id !== playerId);
  room.finalTurnQueue = room.finalTurnQueue.filter((id) => id !== playerId);
  if (room.currentPlayerId === playerId) {
    setNextPlayer(room);
  }
}

module.exports = {
  SKYJO_MAX_PLAYERS,
  createPlayer,
  createRoom,
  drawCard,
  finishTurn,
  getRevealedCount,
  maybeStartTurns,
  removePlayer,
  resetToLobby,
  sanitizeRoom,
  setNextPlayer,
  startRound,
};
