import { socket } from "../../../shared/socket";
import logoUno from "../assets/uno_logo.png";
import logoUnoFlip from "../assets/uno_flip_logo.png";

export default function GameOver({ winner, results, room, myId, onQuit }) {
  const sorted = [...(results || [])].sort((a, b) => a.cardsLeft - b.cardsLeft);
  const isHost = room.host === myId;
  const logo = room?.variant === "flip" ? logoUnoFlip : logoUno;
  const logoAlt = room?.variant === "flip" ? "Logo UNO Flip" : "Logo UNO";

  return (
    <div className="screen gameover-screen uno-gameover-screen">
      <div className="gameover-header">
        <img className="home-logo" src={logo} alt={logoAlt} />
        <h1>{winner} gagne !</h1>
        <p className="subtitle">Plus aucune carte en main.</p>
      </div>

      <div className="final-scores">
        {sorted.map((player, index) => (
          <div key={player.id} className={`final-row rank-${index + 1}`}>
            <span className="rank">
              {index === 0 ? "1." : index === 1 ? "2." : `${index + 1}.`}
            </span>
            <span className="final-name">{player.name}</span>
            <span className="final-score">{player.cardsLeft} cartes</span>
          </div>
        ))}
      </div>

      <div className="gameover-actions">
        {isHost ? (
          <button
            className="btn btn-primary btn-large"
            onClick={() => socket.emit("replay_game")}
          >
            Rejouer
          </button>
        ) : (
          <p className="muted">En attente que l'hote relance une partie...</p>
        )}
        <button className="btn btn-ghost btn-large" onClick={onQuit}>
          Quitter
        </button>
      </div>
    </div>
  );
}
