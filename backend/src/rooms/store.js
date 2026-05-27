const ROOM_CLEANUP_DELAY = 5 * 60 * 1000;
const rooms = {};

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

module.exports = {
  cancelRoomCleanup,
  rooms,
  scheduleRoomCleanup,
};
