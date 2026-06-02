const { v4: uuidv4 } = require("uuid");
const { BIZU_GAME_ID } = require("../gameIds");
const { shuffle } = require("../../shared/random");

const SUITS = [
  { id: "hearts", symbol: "♥", color: "red" },
  { id: "diamonds", symbol: "♦", color: "red" },
  { id: "clubs", symbol: "♣", color: "black" },
  { id: "spades", symbol: "♠", color: "black" },
];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const RULES = {
  A: {
    title: "Memoire courte",
    description: "Prend en compte la regle de la carte precedente.",
  },
  "2": {
    title: "Deux gorgees",
    description: "Prends ou distribue 2 gorgees.",
  },
  "3": {
    title: "Trois gorgees",
    description: "Prends ou distribue 3 gorgees.",
  },
  "4": {
    title: "Quatre gorgees",
    description: "Prends ou distribue 4 gorgees.",
  },
  "5": {
    title: "Cinq gorgees",
    description: "Prends ou distribue 5 gorgees.",
  },
  "6": {
    title: "Six gorgees",
    description: "Prends ou distribue 6 gorgees.",
  },
  "7": {
    title: "Sept pour toi",
    description: "Prends 7 gorgees.",
  },
  "8": {
    title: "Maitre de la question",
    description: "Tu deviens le maitre de la question.",
  },
  "9": {
    title: "J'ai deja, j'ai jamais",
    description: "Lance un tour de j'ai deja, j'ai jamais.",
  },
  "10": {
    title: "Dans ma valise",
    description: "Joue a dans ma valise ou impose un theme.",
  },
  J: {
    title: "Choisis un BIZU",
    description: "Tu choisis un bizu.",
  },
  Q: {
    title: "Reine des pouces",
    description: "Tu es la reine des pouces.",
  },
  K: {
    title: "Nouvelle regle",
    description: "Tu inventes une regle.",
  },
  Joker: {
    title: "Cul sec",
    description: "Cul sec.",
  },
};

function makeCard(rank, suit = null, jokerIndex = null) {
  const rule = RULES[rank];

  return {
    id: uuidv4(),
    rank,
    suit: suit?.id || "joker",
    symbol: suit?.symbol || "★",
    color: suit?.color || "joker",
    label: rank === "Joker" ? `Joker ${jokerIndex}` : `${rank}${suit.symbol}`,
    ruleTitle: rule.title,
    ruleDescription: rule.description,
  };
}

function buildDeck() {
  const standardCards = SUITS.flatMap((suit) =>
    RANKS.map((rank) => makeCard(rank, suit)),
  );
  const jokers = [makeCard("Joker", null, 1), makeCard("Joker", null, 2)];

  return shuffle([...standardCards, ...jokers]);
}

function getLastRuleSource(drawnCards) {
  return drawnCards
    .slice()
    .reverse()
    .find((card) => card.rank !== "A") || null;
}

function applyInheritedRule(card, drawnCards) {
  if (card.rank !== "A") {
    delete card.inheritedRule;
    return card;
  }

  const sourceCard = getLastRuleSource(drawnCards);
  card.inheritedRule = sourceCard
    ? {
        label: sourceCard.label,
        ruleTitle: sourceCard.ruleTitle,
        ruleDescription: sourceCard.ruleDescription,
      }
    : null;

  return card;
}

function createPlayer(name, socketId) {
  return {
    name,
    score: 0,
    socketId,
    connected: true,
    disconnectedAt: null,
  };
}

function createRoom({ code, playerId, name, socketId }) {
  return {
    code,
    gameId: BIZU_GAME_ID,
    host: playerId,
    maxScore: null,
    players: {
      [playerId]: createPlayer(name, socketId),
    },
    phase: "lobby",
    deck: buildDeck(),
    drawnCards: [],
    currentCard: null,
    cleanupTimer: null,
  };
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    gameId: room.gameId,
    host: room.host,
    phase: room.phase,
    deckCount: room.deck.length,
    drawnCount: room.drawnCards.length,
    totalCards: room.deck.length + room.drawnCards.length,
    currentCard: room.currentCard,
    previousCard: room.drawnCards.at(-2) || null,
    players: Object.entries(room.players).map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
      connected: player.connected,
    })),
  };
}

function startGame(room) {
  room.deck = buildDeck();
  room.drawnCards = [];
  room.currentCard = null;
  room.phase = "bizu_playing";
}

function drawCard(room) {
  if (room.phase !== "bizu_playing" || !room.deck.length) return null;

  const card = room.deck.pop();
  applyInheritedRule(card, room.drawnCards);
  room.drawnCards.push(card);
  room.currentCard = card;

  if (!room.deck.length) {
    room.phase = "bizu_finished";
  }

  return card;
}

function replay(room) {
  startGame(room);
}

module.exports = {
  createPlayer,
  createRoom,
  drawCard,
  replay,
  sanitizeRoom,
  startGame,
};
