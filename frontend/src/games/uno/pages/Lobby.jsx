import { socket } from "../../../shared/socket";

export default function Lobby({ room, myId, onLeave }) {
  if (!room) {
    return (
      <div className="screen">
        <p>Chargement...</p>
      </div>
    );
  }

  const isHost = room.host === myId;
  const connectedPlayers = room.players.filter(
    (player) => player.connected !== false,
  );

  const copyCode = () => {
    navigator.clipboard.writeText(room.code);
  };

  return (
    <div className="screen lobby-screen uno-lobby-screen">
      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <div className="lobby-header">
        <h2>Salon UNO classique</h2>
        <div className="code-block" onClick={copyCode} title="Copier le code">
          <span className="code-label">Code de la partie</span>
          <span className="code-value">{room.code}</span>
          <span className="code-copy">Copier code</span>
        </div>
      </div>

      <div className="players-list">
        <h3>Joueurs ({room.players.length})</h3>
        {room.players.map((player) => (
          <div key={player.id} className="player-row">
            <span className="player-avatar">{player.name[0].toUpperCase()}</span>
            <span className="player-name">{player.name}</span>
            {player.id === room.host && <span className="badge">Hote</span>}
            {player.id === myId && <span className="badge badge-me">Moi</span>}
            {player.connected === false && (
              <span className="badge">Reconnexion...</span>
            )}
          </div>
        ))}
      </div>

      <div className="lobby-info">
        <p>Joueurs connectes: {connectedPlayers.length} (2 minimum)</p>
      </div>

      {isHost ? (
        <button
          className="btn btn-primary btn-large"
          onClick={() => socket.emit("start_game")}
          disabled={connectedPlayers.length < 2}
        >
          {connectedPlayers.length < 2
            ? "En attente d'un autre joueur..."
            : "Lancer la partie"}
        </button>
      ) : (
        <p className="waiting-text">En attente que l'hote lance la partie...</p>
      )}
    </div>
  );
}
