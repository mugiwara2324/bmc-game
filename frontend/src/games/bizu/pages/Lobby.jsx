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
    <div className="screen lobby-screen">
      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <div className="lobby-header">
        <h2>Salon BIZU</h2>
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
            {player.id === room.host && <span className="badge">Hôte</span>}
            {player.id === myId && <span className="badge badge-me">Moi</span>}
            {player.connected === false && (
              <span className="badge">Reconnexion...</span>
            )}
          </div>
        ))}
      </div>

      <div className="lobby-info">
        <p>
          Objectif: <strong>retourner les 54 cartes</strong>
        </p>
        <p>Joueurs connectés: {connectedPlayers.length}</p>
      </div>

      {isHost ? (
        <button
          className="btn btn-primary btn-large"
          onClick={() => socket.emit("start_game")}
          disabled={connectedPlayers.length < 1}
        >
          Lancer la partie
        </button>
      ) : (
        <p className="waiting-text">En attente que l'hôte lance la partie...</p>
      )}
    </div>
  );
}
