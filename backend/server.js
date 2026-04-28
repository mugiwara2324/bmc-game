const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const cards = require("./cards.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
const QUESTION_POOL = [...new Set(cards.questions)];

function genCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function dealCards(n) {
  return shuffle(cards.answers).slice(0, n);
}

function getCurrentQuestion(room) {
  return room.currentQuestion || null;
}

function getConnectedEntries(room) {
  return Object.entries(room.players).filter(([, player]) => player.connected);
}

function getConnectedCount(room) {
  return getConnectedEntries(room).length;
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
    count: Object.keys(room.votes).length,
    total: getConnectedCount(room),
  };
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

function sanitizeRoom(room, requesterId) {
  return {
    code: room.code,
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

function emitRoomUpdate(room) {
  Object.entries(room.players).forEach(([playerId, player]) => {
    if (!player.socketId) return;
    io.to(player.socketId).emit("room_update", sanitizeRoom(room, playerId));
  });
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

  const winnerId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  room.players[winnerId].score += 1;

  const results = Object.entries(room.players).map(([id, player]) => ({
    id,
    name: player.name,
    score: player.score,
    votes: tally[id] || 0,
    card: player.playedCard,
  }));

  room.lastRound = { results, winnerId };

  if (room.players[winnerId].score >= room.maxScore) {
    room.phase = "scores";
    room.winnerName = room.players[winnerId].name;
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

function removePlayerFromRoom(room, playerId) {
  if (!room.players[playerId]) return;

  delete room.players[playerId];
  delete room.votes[playerId];
  room.revealedCards = (room.revealedCards || []).filter(
    (entry) => entry.id !== playerId,
  );

  Object.keys(room.votes).forEach((voterId) => {
    if (room.votes[voterId] === playerId) {
      delete room.votes[voterId];
    }
  });

  if (room.host === playerId) {
    room.host = Object.keys(room.players)[0] || null;
  }
}

function startNextRound(room) {
  room.questionIndex += 1;
  assignNextQuestion(room);

  Object.values(room.players).forEach((player) => {
    player.playedCard = null;
    player.hand.push(dealCards(1)[0]);
  });

  room.votes = {};
  room.revealedCards = [];
  room.lastRound = null;
  room.phase = "playing";
}

const rooms = {};

io.on("connection", (socket) => {
  socket.on("create_room", ({ name, maxScore }, cb) => {
    const code = genCode();
    const playerId = uuidv4();

    rooms[code] = {
      code,
      host: playerId,
      maxScore: maxScore || 10,
      players: {
        [playerId]: {
          name,
          score: 0,
          hand: dealCards(10),
          playedCard: null,
          socketId: socket.id,
          connected: true,
          disconnectedAt: null,
        },
      },
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

    const playerId = uuidv4();
    room.players[playerId] = {
      name,
      score: 0,
      hand: dealCards(10),
      playedCard: null,
      socketId: socket.id,
      connected: true,
      disconnectedAt: null,
    };

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
    } else if (room.phase === "playing" && maybeRevealCards(room, code)) {
      if (cb) cb({ ok: true });
      return;
    } else if (room.phase === "voting" && finalizeVoting(room, code)) {
      if (cb) cb({ ok: true });
      return;
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
    if (!room || room.phase !== "playing" || !player) return;
    if (!player.connected || player.playedCard) return;
    if (!player.hand.includes(card)) return;

    player.playedCard = card;
    const cardIndex = player.hand.indexOf(card);
    if (cardIndex >= 0) {
      player.hand.splice(cardIndex, 1);
    }

    if (maybeRevealCards(room, code)) {
      return;
    }

    emitRoomUpdate(room);
    io.to(code).emit("play_update", getPlayProgress(room));
  });

  socket.on("start_voting", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.phase !== "revealing") return;
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
    if (!room || room.phase !== "voting") return;
    if (!room.players[playerId]?.connected) return;
    if (room.votes[playerId]) return;
    if (votedId === playerId) return;

    room.votes[playerId] = votedId;

    if (finalizeVoting(room, code)) {
      return;
    }

    emitRoomUpdate(room);
    io.to(code).emit("vote_update", getVoteProgress(room));
  });

  socket.on("next_round", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.phase !== "result") return;
    if (room.host !== socket.data.playerId) return;

    startNextRound(room);
    emitRoomUpdate(room);
    io.to(code).emit("new_question", {
      question: room.currentQuestion,
    });
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

    if (room.phase === "playing" && maybeRevealCards(room, code)) {
      return;
    }

    if (room.phase === "voting" && finalizeVoting(room, code)) {
      return;
    }

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
server.listen(PORT, () => console.log(`✅ Serveur sur le port ${PORT}`));
