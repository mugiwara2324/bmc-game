const bmc = require("./blancMangerCoco/engine");
const skyjo = require("./skyjo/engine");
const { BMC_GAME_ID, SKYJO_GAME_ID } = require("./gameIds");

const games = {
  [BMC_GAME_ID]: bmc,
  [SKYJO_GAME_ID]: skyjo,
};

function getGame(gameId) {
  return games[gameId] || games[BMC_GAME_ID];
}

function getCreateGameId(gameId) {
  return gameId === SKYJO_GAME_ID ? SKYJO_GAME_ID : BMC_GAME_ID;
}

module.exports = {
  BMC_GAME_ID,
  SKYJO_GAME_ID,
  games,
  getCreateGameId,
  getGame,
};
