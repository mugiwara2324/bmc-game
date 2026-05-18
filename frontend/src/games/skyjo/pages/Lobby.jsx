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
        <h2>Salon Skyjo</h2>
        <div className="code-block" onClick={copyCode} title="Copier le code">
          <span className="code-label">Code de la partie</span>
          <span className="code-value">{room.code}</span>
          <span className="code-copy">Copier code</span>
        </div>
      </div>

      <div className="players-list">
        <h3>Joueurs ({room.players.length}/8)</h3>
        {room.players.map((p) => (
          <div key={p.id} className="player-row">
            <span className="player-avatar">{p.name[0].toUpperCase()}</span>
            <span className="player-name">{p.name}</span>
            {p.id === room.host && <span className="badge">Hôte</span>}
            {p.id === myId && <span className="badge badge-me">Moi</span>}
            {p.connected === false && (
              <span className="badge">Reconnexion...</span>
            )}
          </div>
        ))}
      </div>

      <div className="lobby-info">
        <p>
          Objectif: <strong>éviter les 100 points</strong>
        </p>
        <p>Joueurs connectés: {connectedPlayers.length} (2 minimum)</p>
      </div>

      {isHost ? (
        <button
          className="btn btn-primary btn-large"
          onClick={() => socket.emit("start_game")}
          disabled={connectedPlayers.length < 2}
        >
          {connectedPlayers.length < 2
            ? "En attente d'un autre joueur..."
            : "Lancer la manche"}
        </button>
      ) : (
        <p className="waiting-text">En attente que l'hôte lance la partie...</p>
      )}
    </div>
  );
}
