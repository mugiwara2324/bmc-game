const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const cards = require("./cards.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://game-gourmands.vercel.app"],
    methods: ["GET", "POST"],
  },
});

const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
const BMC_GAME_ID = "noir-manger-coco";
const SKYJO_GAME_ID = "skyjo";
const QUESTION_POOL = [...new Set(cards.questions)];
const ANSWER_POOL = [...new Set(cards.answers)];
const rooms = {};

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function getConnectedEntries(room) {
  return Object.entries(room.players).filter(([, player]) => player.connected);
}

function getConnectedCount(room) {
  return getConnectedEntries(room).length;
}

function cancelRoomCleanup(room) {
  if (!room?.cleanupTimer) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function scheduleRoomCleanup(code) {
  const room = rooms[code];
  if (!room) return;

  cancelRoomCleanup(room);
  room.cleanupTimer = setTimeout(() => {
    const targetRoom = rooms[code];
    if (!targetRoom) return;

    const hasConnectedPlayer = Object.values(targetRoom.players).some(
      (player) => player.connected,
    );

    if (!hasConnectedPlayer) {
      delete rooms[code];
    }
  }, ROOM_CLEANUP_DELAY);
}

function attachPlayerToSocket(socket, room, playerId) {
  const player = room.players[playerId];

  cancelRoomCleanup(room);
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = null;
  socket.join(room.code);
  socket.data.code = room.code;
  socket.data.playerId = playerId;
}

function isCurrentSocket(room, playerId, socketId) {
  return room?.players[playerId]?.socketId === socketId;
}

function emitRoomUpdate(room) {
  Object.entries(room.players).forEach(([playerId, player]) => {
    if (!player.socketId) return;
    io.to(player.socketId).emit("room_update", sanitizeRoom(room, playerId));
  });
}

function buildAnswerDeck(excludedCards = []) {
  const excluded = new Set(excludedCards.filter(Boolean));
  return shuffle(ANSWER_POOL.filter((card) => !excluded.has(card)));
}

function getReservedBmcCards(room) {
  return Object.values(room.players).flatMap((player) => [
    ...(player.hand || []),
    player.playedCard,
  ]);
}

function drawBmcCards(room, count) {
  const drawnCards = [];

  while (drawnCards.length < count) {
    if (!room.answerDeck?.length) {
      room.answerDeck = buildAnswerDeck(getReservedBmcCards(room));
    }

    const nextCard = room.answerDeck?.pop();
    if (!nextCard) break;
    drawnCards.push(nextCard);
  }

  return drawnCards;
}

function getCurrentQuestion(room) {
  return room.currentQuestion || null;
}

function getPlayedCards(room) {
  return Object.entries(room.players)
    .filter(([, player]) => player.playedCard)
    .map(([id, player]) => ({
      id,
      name: player.name,
      card: player.playedCard,
    }));
}

function buildQuestionDeck(currentQuestion = null) {
  return shuffle(
    QUESTION_POOL.filter((question) => question !== currentQuestion),
  );
}

function assignNextQuestion(room) {
  if (!room.questionDeck?.length) {
    room.questionDeck = buildQuestionDeck(room.currentQuestion);
  }

  const nextQuestion =
    room.questionDeck.shift() ||
    room.currentQuestion ||
    QUESTION_POOL[0] ||
    null;

  room.currentQuestion = nextQuestion;
  return nextQuestion;
}

function getPlayProgress(room) {
  const connectedIds = new Set(getConnectedEntries(room).map(([id]) => id));

  return {
    count: Object.entries(room.players).filter(
      ([id, player]) => connectedIds.has(id) && player.playedCard,
    ).length,
    total: connectedIds.size,
  };
}

function getVoteProgress(room) {
  return {
    count: Object.keys(room.votes || {}).length,
    total: getConnectedCount(room),
  };
}

function sanitizeBmcRoom(room, requesterId) {
  return {
    code: room.code,
    gameId: room.gameId,
    host: room.host,
    maxScore: room.maxScore,
    phase: room.phase,
    questionIndex: room.questionIndex,
    currentQuestion: getCurrentQuestion(room),
    playCount: getPlayProgress(room),
    voteCount: getVoteProgress(room),
    playedCards:
      room.phase === "revealing" ||
      room.phase === "voting" ||
      room.phase === "result" ||
      room.phase === "scores"
        ? room.revealedCards || []
        : [],
    lastRound: room.lastRound,
    myPlayedCard: room.players[requesterId]?.playedCard || null,
    votedFor: room.votes[requesterId] || null,
    winnerName: room.winnerName,
    finalResults: room.finalResults,
    players: Object.entries(room.players).map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
      hasPlayed: !!player.playedCard,
      connected: player.connected,
      hand: id === requesterId ? player.hand : undefined,
    })),
  };
}

function maybeRevealCards(room, code) {
  const connectedPlayers = getConnectedEntries(room);
  const allPlayed =
    connectedPlayers.length > 0 &&
    connectedPlayers.every(([, player]) => player.playedCard);

  if (!allPlayed) return false;

  room.phase = "revealing";
  room.revealedCards = shuffle(getPlayedCards(room));
  emitRoomUpdate(room);
  io.to(code).emit("all_played", { played: room.revealedCards });
  return true;
}

function finalizeVoting(room, code) {
  const { count, total } = getVoteProgress(room);
  if (count < total || total === 0) return false;

  const tally = {};
  Object.values(room.votes).forEach((id) => {
    tally[id] = (tally[id] || 0) + 1;
  });

  const highestVoteCount = Math.max(...Object.values(tally));
  const winnerIds = Object.entries(tally)
    .filter(([, votes]) => votes === highestVoteCount)
    .map(([id]) => id);

  winnerIds.forEach((winnerId) => {
    if (room.players[winnerId]) {
      room.players[winnerId].score += 1;
    }
  });

  const results = Object.entries(room.players).map(([id, player]) => ({
    id,
    name: player.name,
    score: player.score,
    votes: tally[id] || 0,
    card: player.playedCard,
  }));

  room.lastRound = {
    results,
    winnerId: winnerIds[0] || null,
    winnerIds,
  };

  const highestScore = Math.max(...results.map((result) => result.score));
  const topScorers = results.filter((result) => result.score === highestScore);

  if (highestScore >= room.maxScore) {
    room.phase = "scores";
    room.winnerName = topScorers.map((result) => result.name).join(" et ");
    room.finalResults = results;
    emitRoomUpdate(room);
    io.to(code).emit("game_over", {
      winner: room.winnerName,
      results,
    });
    return true;
  }

  room.phase = "result";
  emitRoomUpdate(room);
  io.to(code).emit("round_result", room.lastRound);
  return true;
}

function startNextBmcRound(room) {
  room.questionIndex += 1;
  assignNextQuestion(room);

  Object.values(room.players).forEach((player) => {
    player.playedCard = null;
    player.hand.push(...drawBmcCards(room, 1));
  });

  room.votes = {};
  room.revealedCards = [];
  room.lastRound = null;
  room.phase = "playing";
}

function createBmcPlayer(name, socketId, hand = []) {
  return {
    name,
    score: 0,
    hand,
    playedCard: null,
    socketId,
    connected: true,
    disconnectedAt: null,
  };
}

function createBmcRoom({ code, playerId, name, socketId, maxScore }) {
  const room = {
    code,
    gameId: BMC_GAME_ID,
    host: playerId,
    maxScore: maxScore || 10,
    players: {},
    answerDeck: buildAnswerDeck(),
    questionIndex: 0,
    currentQuestion: null,
    questionDeck: buildQuestionDeck(),
    phase: "lobby",
    votes: {},
    revealedCards: [],
    lastRound: null,
    winnerName: null,
    finalResults: null,
    cleanupTimer: null,
  };

  room.players[playerId] = createBmcPlayer(name, socketId, drawBmcCards(room, 10));
  return room;
}

function buildSkyjoDeck() {
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

function createSkyjoPlayer(name, socketId) {
  return {
    name,
    score: 0,
    socketId,
    connected: true,
    disconnectedAt: null,
    board: [],
  };
}

function drawSkyjoCard(room) {
  if (!room.deck.length) {
    const topDiscard = room.discardPile.pop();
    room.deck = shuffle(room.discardPile);
    room.discardPile = topDiscard === undefined ? [] : [topDiscard];
  }

  return room.deck.pop();
}

function dealSkyjoBoards(room) {
  Object.values(room.players).forEach((player) => {
    player.board = Array.from({ length: 12 }, (_, index) => ({
      id: uuidv4(),
      index,
      value: drawSkyjoCard(room),
      revealed: false,
      removed: false,
    }));
  });
}

function createSkyjoRoom({ code, playerId, name, socketId, maxScore }) {
  const room = {
    code,
    gameId: SKYJO_GAME_ID,
    host: playerId,
    maxScore: maxScore || 100,
    players: {
      [playerId]: createSkyjoPlayer(name, socketId),
    },
    phase: "lobby",
    deck: [],
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

  room.deck = buildSkyjoDeck();
  return room;
}

function getSkyjoBoardForRequester(player, requesterId, playerId, revealAll) {
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

function sanitizeSkyjoRoom(room, requesterId) {
  const revealAll = room.phase === "skyjo_round_over" || room.phase === "scores";
  const canSeeDrawnCard =
    room.currentPlayerId === requesterId || revealAll;

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
      board: getSkyjoBoardForRequester(player, requesterId, id, revealAll),
    })),
  };
}

function sanitizeRoom(room, requesterId) {
  return room.gameId === SKYJO_GAME_ID
    ? sanitizeSkyjoRoom(room, requesterId)
    : sanitizeBmcRoom(room, requesterId);
}

function removeCompletedSkyjoColumns(player, discardPile) {
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

function getActiveSkyjoPlayerIds(room) {
  return room.turnOrder.filter((id) => room.players[id]);
}

function setNextSkyjoPlayer(room) {
  const activeIds = getActiveSkyjoPlayerIds(room);
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

function finalizeSkyjoRound(room, code) {
  Object.values(room.players).forEach((player) => {
    player.board.forEach((card) => {
      if (!card.removed) card.revealed = true;
    });
    removeCompletedSkyjoColumns(player, room.discardPile);
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
    emitRoomUpdate(room);
    io.to(code).emit("game_over", {
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
  emitRoomUpdate(room);
}

function finishSkyjoTurn(room, code) {
  const player = room.players[room.currentPlayerId];
  if (player) {
    removeCompletedSkyjoColumns(player, room.discardPile);

    if (!room.closerId && hasFinishedBoard(player)) {
      room.closerId = room.currentPlayerId;
      const activeIds = getActiveSkyjoPlayerIds(room);
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
    finalizeSkyjoRound(room, code);
    return;
  }

  room.phase = "skyjo_playing";
  setNextSkyjoPlayer(room);
  emitRoomUpdate(room);
}

function startSkyjoRound(room) {
  room.roundIndex += 1;
  room.deck = buildSkyjoDeck();
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
  dealSkyjoBoards(room);
  room.discardPile.push(drawSkyjoCard(room));
  room.phase = "skyjo_setup";
}

function maybeStartSkyjoTurns(room) {
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

function resetSkyjoToLobby(room) {
  Object.values(room.players).forEach((player) => {
    player.score = 0;
    player.board = [];
  });

  room.deck = buildSkyjoDeck();
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

function removePlayerFromRoom(room, playerId) {
  if (!room.players[playerId]) return;
  const player = room.players[playerId];

  delete room.players[playerId];

  if (room.gameId === BMC_GAME_ID) {
    const returnedCards = [
      ...(player?.hand || []),
      player?.playedCard,
    ].filter(Boolean);

    if (returnedCards.length) {
      room.answerDeck = shuffle([...(room.answerDeck || []), ...returnedCards]);
    }

    delete room.votes[playerId];
    room.revealedCards = (room.revealedCards || []).filter(
      (entry) => entry.id !== playerId,
    );

    Object.keys(room.votes).forEach((voterId) => {
      if (room.votes[voterId] === playerId) {
        delete room.votes[voterId];
      }
    });
  }

  if (room.gameId === SKYJO_GAME_ID) {
    room.turnOrder = room.turnOrder.filter((id) => id !== playerId);
    room.finalTurnQueue = room.finalTurnQueue.filter((id) => id !== playerId);
    if (room.currentPlayerId === playerId) {
      setNextSkyjoPlayer(room);
    }
  }

  if (room.host === playerId) {
    room.host = Object.keys(room.players)[0] || null;
  }
}

function getCreateGameId(gameId) {
  return gameId === SKYJO_GAME_ID ? SKYJO_GAME_ID : BMC_GAME_ID;
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name, maxScore, gameId }, cb) => {
    const code = genCode();
    const playerId = uuidv4();
    const selectedGameId = getCreateGameId(gameId);

    rooms[code] =
      selectedGameId === SKYJO_GAME_ID
        ? createSkyjoRoom({ code, playerId, name, socketId: socket.id, maxScore })
        : createBmcRoom({ code, playerId, name, socketId: socket.id, maxScore });

    socket.join(code);
    socket.data.code = code;
    socket.data.playerId = playerId;

    cb({
      code,
      player: {
        id: playerId,
        name,
        score: 0,
        hand: rooms[code].players[playerId].hand,
      },
      room: sanitizeRoom(rooms[code], playerId),
    });

    emitRoomUpdate(rooms[code]);
  });

  socket.on("join_room", ({ name, code }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: "Code invalide" });
    if (room.phase !== "lobby") return cb({ error: "Partie déjà commencée" });

    if (room.gameId === SKYJO_GAME_ID && Object.keys(room.players).length >= 8) {
      return cb({ error: "Le Skyjo se joue à 8 maximum." });
    }

    const playerId = uuidv4();
    room.players[playerId] =
      room.gameId === SKYJO_GAME_ID
        ? createSkyjoPlayer(name, socket.id)
        : createBmcPlayer(name, socket.id, drawBmcCards(room, 10));

    socket.join(code);
    socket.data.code = code;
    socket.data.playerId = playerId;

    cb({
      code,
      player: {
        id: playerId,
        name,
        score: 0,
        hand: room.players[playerId].hand,
      },
      room: sanitizeRoom(room, playerId),
    });

    emitRoomUpdate(room);
  });

  socket.on("restore_session", ({ code, playerId }, cb) => {
    const room = rooms[code];
    const player = room?.players[playerId];

    if (!room || !player) {
      return cb({ error: "Session introuvable" });
    }

    attachPlayerToSocket(socket, room, playerId);
    emitRoomUpdate(room);

    cb({
      room: sanitizeRoom(room, playerId),
      player: {
        id: playerId,
        name: player.name,
        score: player.score,
        hand: player.hand,
      },
    });
  });

  socket.on("leave_room", (cb) => {
    const code = socket.data.code;
    const playerId = socket.data.playerId;
    const room = rooms[code];

    if (!room || !playerId) {
      if (cb) cb({ ok: true });
      return;
    }

    if (!isCurrentSocket(room, playerId, socket.id)) {
      if (cb) cb({ ok: true });
      return;
    }

    socket.leave(code);
    removePlayerFromRoom(room, playerId);
    socket.data.code = null;
    socket.data.playerId = null;

    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
    } else if (room.gameId === BMC_GAME_ID && room.phase === "playing") {
      maybeRevealCards(room, code) || emitRoomUpdate(room);
    } else if (room.gameId === BMC_GAME_ID && room.phase === "voting") {
      finalizeVoting(room, code) || emitRoomUpdate(room);
    } else {
      emitRoomUpdate(room);
    }

    if (cb) cb({ ok: true });
  });

  socket.on("start_game", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.host !== socket.data.playerId) return;

    if (room.gameId === SKYJO_GAME_ID) {
      if (getConnectedCount(room) < 2) return;
      startSkyjoRound(room);
      emitRoomUpdate(room);
      return;
    }

    if (getConnectedCount(room) < 3) return;

    room.phase = "playing";
    room.currentQuestion = assignNextQuestion(room);
    room.revealedCards = [];
    room.lastRound = null;
    room.winnerName = null;
    room.finalResults = null;
    room.votes = {};

    emitRoomUpdate(room);
    io.to(code).emit("new_question", {
      question: room.currentQuestion,
    });
  });

  socket.on("play_card", ({ card }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== BMC_GAME_ID || room.phase !== "playing" || !player) return;
    if (!player.connected || player.playedCard) return;
    if (!player.hand.includes(card)) return;

    player.playedCard = card;
    const cardIndex = player.hand.indexOf(card);
    if (cardIndex >= 0) {
      player.hand.splice(cardIndex, 1);
    }

    if (maybeRevealCards(room, code)) return;

    emitRoomUpdate(room);
    io.to(code).emit("play_update", getPlayProgress(room));
  });

  socket.on("start_voting", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.gameId !== BMC_GAME_ID || room.phase !== "revealing") return;
    if (room.host !== socket.data.playerId) return;

    room.phase = "voting";
    emitRoomUpdate(room);
    io.to(code).emit("voting_started");
  });

  socket.on("vote_card", ({ votedId }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== BMC_GAME_ID || room.phase !== "voting") return;
    if (!room.players[playerId]?.connected) return;
    if (room.votes[playerId]) return;
    if (votedId === playerId) return;

    room.votes[playerId] = votedId;

    if (finalizeVoting(room, code)) return;

    emitRoomUpdate(room);
    io.to(code).emit("vote_update", getVoteProgress(room));
  });

  socket.on("next_round", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.host !== socket.data.playerId) return;

    if (room.gameId === SKYJO_GAME_ID) {
      if (room.phase !== "skyjo_round_over") return;
      startSkyjoRound(room);
      emitRoomUpdate(room);
      return;
    }

    if (room.phase !== "result") return;

    startNextBmcRound(room);
    emitRoomUpdate(room);
    io.to(code).emit("new_question", {
      question: room.currentQuestion,
    });
  });

  socket.on("replay_game", () => {
    const code = socket.data.code;
    const playerId = socket.data.playerId;
    const room = rooms[code];

    if (!room || room.host !== playerId || room.phase !== "scores") return;

    if (room.gameId === SKYJO_GAME_ID) {
      resetSkyjoToLobby(room);
      emitRoomUpdate(room);
      return;
    }

    Object.values(room.players).forEach((p) => {
      p.score = 0;
      p.hand = [];
      p.playedCard = null;
    });

    room.answerDeck = buildAnswerDeck();
    Object.values(room.players).forEach((player) => {
      player.hand = drawBmcCards(room, 10);
    });
    room.questionDeck = buildQuestionDeck();
    room.questionIndex = 0;
    room.currentQuestion = null;
    room.lastRound = null;
    room.winnerName = null;
    room.finalResults = null;
    room.votes = {};
    room.revealedCards = [];
    room.phase = "lobby";

    emitRoomUpdate(room);
  });

  socket.on("skyjo_reveal_initial", ({ index }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_setup") return;
    if (!player || getRevealedCount(player) >= 2) return;

    const card = player.board[index];
    if (!card || card.removed || card.revealed) return;

    card.revealed = true;
    maybeStartSkyjoTurns(room);
    emitRoomUpdate(room);
  });

  socket.on("skyjo_draw", ({ source }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_playing") return;
    if (room.currentPlayerId !== playerId || room.drawnCard !== null) return;

    if (source === "discard") {
      room.drawnCard = room.discardPile.pop();
      room.drawSource = "discard";
    } else {
      room.drawnCard = drawSkyjoCard(room);
      room.drawSource = "deck";
    }

    room.phase = "skyjo_drawn";
    emitRoomUpdate(room);
  });

  socket.on("skyjo_exchange", ({ index }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_drawn") return;
    if (room.currentPlayerId !== playerId || room.drawnCard === null || !player) return;

    const targetCard = player.board[index];
    if (!targetCard || targetCard.removed) return;

    room.discardPile.push(targetCard.value);
    targetCard.value = room.drawnCard;
    targetCard.revealed = true;
    finishSkyjoTurn(room, code);
  });

  socket.on("skyjo_discard_drawn", () => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_drawn") return;
    if (room.currentPlayerId !== playerId) return;
    if (room.drawSource !== "deck" || room.drawnCard === null) return;

    room.discardPile.push(room.drawnCard);
    room.drawnCard = null;
    room.pendingDiscardReveal = true;
    room.phase = "skyjo_reveal_after_discard";
    emitRoomUpdate(room);
  });

  socket.on("skyjo_reveal_after_discard", ({ index }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_reveal_after_discard") return;
    if (room.currentPlayerId !== playerId || !room.pendingDiscardReveal || !player) return;

    const targetCard = player.board[index];
    if (!targetCard || targetCard.removed || targetCard.revealed) return;

    targetCard.revealed = true;
    finishSkyjoTurn(room, code);
  });

  socket.on("skyjo_discard_drawn_and_reveal", ({ index }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID) return;
    if (room.currentPlayerId !== playerId || !player) return;

    const targetCard = player.board[index];
    if (!targetCard || targetCard.removed || targetCard.revealed) return;

    if (room.phase === "skyjo_drawn") {
      if (room.drawSource !== "deck" || room.drawnCard === null) return;
      room.discardPile.push(room.drawnCard);
    } else if (room.phase !== "skyjo_reveal_after_discard") {
      return;
    }

    targetCard.revealed = true;
    finishSkyjoTurn(room, code);
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    const playerId = socket.data.playerId;
    const room = rooms[code];
    const player = room?.players[playerId];

    if (!room || !player) return;
    if (!isCurrentSocket(room, playerId, socket.id)) return;

    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();

    if (room.gameId === BMC_GAME_ID && room.phase === "playing" && maybeRevealCards(room, code)) return;
    if (room.gameId === BMC_GAME_ID && room.phase === "voting" && finalizeVoting(room, code)) return;

    emitRoomUpdate(room);

    const hasConnectedPlayer = Object.values(room.players).some(
      (entry) => entry.connected,
    );

    if (!hasConnectedPlayer) {
      scheduleRoomCleanup(code);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Serveur sur le port ${PORT}`));
