const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const {
  BIZU_GAME_ID,
  BMC_GAME_ID,
  SKYJO_GAME_ID,
  UNO_GAME_ID,
  getCreateGameId,
  getGame,
} = require("./games/registry");
const bizu = require("./games/bizu/engine");
const bmc = require("./games/blancMangerCoco/engine");
const skyjo = require("./games/skyjo/engine");
const uno = require("./games/uno/engine");
const {
  attachPlayerToSocket,
  getConnectedCount,
  isCurrentSocket,
} = require("./rooms/players");
const { cancelRoomCleanup, rooms, scheduleRoomCleanup } = require("./rooms/store");
const { genCode } = require("./shared/random");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://game-gourmands.vercel.app"],
    methods: ["GET", "POST"],
  },
});

function sanitizeRoom(room, requesterId) {
  return getGame(room.gameId).sanitizeRoom(room, requesterId);
}

function emitRoomUpdate(room) {
  Object.entries(room.players).forEach(([playerId, player]) => {
    if (!player.socketId) return;
    io.to(player.socketId).emit("room_update", sanitizeRoom(room, playerId));
  });
}

function getGameContext() {
  return {
    emitRoomUpdate,
    io,
  };
}

function removePlayerFromRoom(room, playerId) {
  if (!room.players[playerId]) return;
  const player = room.players[playerId];

  delete room.players[playerId];
  getGame(room.gameId).removePlayer?.(room, playerId, player);

  if (room.host === playerId) {
    room.host = Object.keys(room.players)[0] || null;
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name, maxScore, gameId, variant }, cb) => {
    const code = genCode();
    const playerId = uuidv4();
    const selectedGameId = getCreateGameId(gameId);
    const game = getGame(selectedGameId);

    rooms[code] = game.createRoom({
      code,
      playerId,
      name,
      socketId: socket.id,
      maxScore,
      variant,
    });

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

    if (
      room.gameId === SKYJO_GAME_ID &&
      Object.keys(room.players).length >= skyjo.SKYJO_MAX_PLAYERS
    ) {
      return cb({
        error: `Le Skyjo se joue à ${skyjo.SKYJO_MAX_PLAYERS} maximum.`,
      });
    }

    const playerId = uuidv4();
    if (room.gameId === SKYJO_GAME_ID) {
      room.players[playerId] = skyjo.createPlayer(name, socket.id);
    } else if (room.gameId === UNO_GAME_ID) {
      room.players[playerId] = uno.createPlayer(name, socket.id);
    } else if (room.gameId === BIZU_GAME_ID) {
      room.players[playerId] = bizu.createPlayer(name, socket.id);
    } else {
      room.players[playerId] = bmc.createPlayer(
        name,
        socket.id,
        bmc.drawCards(room, 10),
      );
    }

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

    attachPlayerToSocket(socket, room, playerId, cancelRoomCleanup);
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
      bmc.maybeRevealCards(room, getGameContext()) || emitRoomUpdate(room);
    } else if (room.gameId === BMC_GAME_ID && room.phase === "voting") {
      bmc.finalizeVoting(room, getGameContext()) || emitRoomUpdate(room);
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
      skyjo.startRound(room);
      emitRoomUpdate(room);
      return;
    }

    if (room.gameId === BIZU_GAME_ID) {
      if (getConnectedCount(room) < 1) return;
      bizu.startGame(room);
      emitRoomUpdate(room);
      return;
    }

    if (room.gameId === UNO_GAME_ID) {
      if (getConnectedCount(room) < uno.UNO_MIN_PLAYERS) return;
      uno.startGame(room);
      emitRoomUpdate(room);
      return;
    }

    if (getConnectedCount(room) < 3) return;

    bmc.startGame(room);
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

    if (bmc.maybeRevealCards(room, getGameContext())) return;

    emitRoomUpdate(room);
    io.to(code).emit("play_update", bmc.getPlayProgress(room));
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

    if (bmc.finalizeVoting(room, getGameContext())) return;

    emitRoomUpdate(room);
    io.to(code).emit("vote_update", bmc.getVoteProgress(room));
  });

  socket.on("next_round", () => {
    const code = socket.data.code;
    const room = rooms[code];

    if (!isCurrentSocket(room, socket.data.playerId, socket.id)) return;
    if (!room || room.host !== socket.data.playerId) return;

    if (room.gameId === SKYJO_GAME_ID) {
      if (room.phase !== "skyjo_round_over") return;
      skyjo.startRound(room);
      emitRoomUpdate(room);
      return;
    }

    if (room.phase !== "result") return;

    bmc.startNextRound(room);
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
      skyjo.resetToLobby(room);
      emitRoomUpdate(room);
      return;
    }

    if (room.gameId === UNO_GAME_ID) {
      uno.replay(room);
      emitRoomUpdate(room);
      return;
    }

    bmc.replay(room);
    emitRoomUpdate(room);
  });

  socket.on("bizu_draw_card", () => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== BIZU_GAME_ID || room.phase !== "bizu_playing") return;

    bizu.drawCard(room);
    emitRoomUpdate(room);
  });

  socket.on("bizu_replay", () => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== BIZU_GAME_ID || room.host !== playerId) return;
    if (room.phase !== "bizu_finished") return;

    bizu.replay(room);
    emitRoomUpdate(room);
  });

  socket.on("skyjo_reveal_initial", ({ index }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;
    const player = room?.players[playerId];

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== SKYJO_GAME_ID || room.phase !== "skyjo_setup") return;
    if (!player || skyjo.getRevealedCount(player) >= 2) return;

    const card = player.board[index];
    if (!card || card.removed || card.revealed) return;

    card.revealed = true;
    skyjo.maybeStartTurns(room);
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
      room.drawnCard = skyjo.drawCard(room);
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
    skyjo.finishTurn(room, getGameContext());
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
    skyjo.finishTurn(room, getGameContext());
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
    skyjo.finishTurn(room, getGameContext());
  });

  socket.on("uno_play_cards", ({ cardIds, chosenColor }) => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== UNO_GAME_ID) return;

    uno.playCards(room, playerId, cardIds, chosenColor, getGameContext());
  });

  socket.on("uno_draw", () => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== UNO_GAME_ID) return;

    uno.drawForTurn(room, playerId, getGameContext());
  });

  socket.on("uno_pass_after_draw", () => {
    const code = socket.data.code;
    const room = rooms[code];
    const playerId = socket.data.playerId;

    if (!isCurrentSocket(room, playerId, socket.id)) return;
    if (!room || room.gameId !== UNO_GAME_ID) return;

    uno.passAfterDraw(room, playerId, getGameContext());
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

    if (room.gameId === BMC_GAME_ID && room.phase === "playing" && bmc.maybeRevealCards(room, getGameContext())) return;
    if (room.gameId === BMC_GAME_ID && room.phase === "voting" && bmc.finalizeVoting(room, getGameContext())) return;

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

module.exports = {
  io,
  server,
};
