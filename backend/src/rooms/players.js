function getConnectedEntries(room) {
  return Object.entries(room.players).filter(([, player]) => player.connected);
}

function getConnectedCount(room) {
  return getConnectedEntries(room).length;
}

function attachPlayerToSocket(socket, room, playerId, cancelRoomCleanup) {
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

module.exports = {
  attachPlayerToSocket,
  getConnectedCount,
  getConnectedEntries,
  isCurrentSocket,
};
