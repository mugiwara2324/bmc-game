const cards = require("../../../cards.json");
const { BMC_GAME_ID } = require("../gameIds");
const { getConnectedCount, getConnectedEntries } = require("../../rooms/players");
const { shuffle } = require("../../shared/random");

const QUESTION_POOL = [...new Set(cards.questions)];
const ANSWER_POOL = [...new Set(cards.answers)];

function buildAnswerDeck(excludedCards = []) {
  const excluded = new Set(excludedCards.filter(Boolean));
  return shuffle(ANSWER_POOL.filter((card) => !excluded.has(card)));
}

function getReservedCards(room) {
  return Object.values(room.players).flatMap((player) => [
    ...(player.hand || []),
    player.playedCard,
  ]);
}

function drawCards(room, count) {
  const drawnCards = [];

  while (drawnCards.length < count) {
    if (!room.answerDeck?.length) {
      room.answerDeck = buildAnswerDeck(getReservedCards(room));
    }

    const nextCard = room.answerDeck?.pop();
    if (!nextCard) break;
    drawnCards.push(nextCard);
  }

  return drawnCards;
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

function createPlayer(name, socketId, hand = []) {
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

function createRoom({ code, playerId, name, socketId, maxScore }) {
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

  room.players[playerId] = createPlayer(name, socketId, drawCards(room, 10));
  return room;
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

function sanitizeRoom(room, requesterId) {
  return {
    code: room.code,
    gameId: room.gameId,
    host: room.host,
    maxScore: room.maxScore,
    phase: room.phase,
    questionIndex: room.questionIndex,
    currentQuestion: room.currentQuestion || null,
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

function maybeRevealCards(room, context) {
  const connectedPlayers = getConnectedEntries(room);
  const allPlayed =
    connectedPlayers.length > 0 &&
    connectedPlayers.every(([, player]) => player.playedCard);

  if (!allPlayed) return false;

  room.phase = "revealing";
  room.revealedCards = shuffle(getPlayedCards(room));
  context.emitRoomUpdate(room);
  context.io.to(room.code).emit("all_played", { played: room.revealedCards });
  return true;
}

function finalizeVoting(room, context) {
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
    context.emitRoomUpdate(room);
    context.io.to(room.code).emit("game_over", {
      winner: room.winnerName,
      results,
    });
    return true;
  }

  room.phase = "result";
  context.emitRoomUpdate(room);
  context.io.to(room.code).emit("round_result", room.lastRound);
  return true;
}

function startGame(room) {
  room.phase = "playing";
  room.currentQuestion = assignNextQuestion(room);
  room.revealedCards = [];
  room.lastRound = null;
  room.winnerName = null;
  room.finalResults = null;
  room.votes = {};
}

function startNextRound(room) {
  room.questionIndex += 1;
  assignNextQuestion(room);

  Object.values(room.players).forEach((player) => {
    player.playedCard = null;
    player.hand.push(...drawCards(room, 1));
  });

  room.votes = {};
  room.revealedCards = [];
  room.lastRound = null;
  room.phase = "playing";
}

function replay(room) {
  Object.values(room.players).forEach((player) => {
    player.score = 0;
    player.hand = [];
    player.playedCard = null;
  });

  room.answerDeck = buildAnswerDeck();
  Object.values(room.players).forEach((player) => {
    player.hand = drawCards(room, 10);
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
}

function removePlayer(room, playerId, player) {
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

module.exports = {
  assignNextQuestion,
  createPlayer,
  createRoom,
  drawCards,
  finalizeVoting,
  getPlayProgress,
  getVoteProgress,
  maybeRevealCards,
  removePlayer,
  replay,
  sanitizeRoom,
  startGame,
  startNextRound,
};
