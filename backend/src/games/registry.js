const bmc = require("./blancMangerCoco/engine");
const bizu = require("./bizu/engine");
const skyjo = require("./skyjo/engine");
const uno = require("./uno/engine");
const {
  BIZU_GAME_ID,
  BMC_GAME_ID,
  SKYJO_GAME_ID,
  UNO_GAME_ID,
} = require("./gameIds");

const games = {
  [BIZU_GAME_ID]: bizu,
  [BMC_GAME_ID]: bmc,
  [SKYJO_GAME_ID]: skyjo,
  [UNO_GAME_ID]: uno,
};

function getGame(gameId) {
  return games[gameId] || games[BMC_GAME_ID];
}

function getCreateGameId(gameId) {
  if (gameId === BIZU_GAME_ID) return BIZU_GAME_ID;
  if (gameId === SKYJO_GAME_ID) return SKYJO_GAME_ID;
  return gameId === UNO_GAME_ID ? UNO_GAME_ID : BMC_GAME_ID;
}

module.exports = {
  BIZU_GAME_ID,
  BMC_GAME_ID,
  SKYJO_GAME_ID,
  UNO_GAME_ID,
  games,
  getCreateGameId,
  getGame,
};
