import { useState } from "react";
import { socket } from "../../../shared/socket";
import logoBizu from "../assets/bizu_logo.png";

export default function Home({ gameId = "le-bizu", onJoined, onBackToHub }) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStart = () => {
    if (isSubmitting) return;

    setError("");
    setIsSubmitting(true);

    if (!socket.connected) {
      socket.connect();
    }

    socket
      .timeout(5000)
      .emit("create_room", { name: "Joueur", gameId }, (err, res) => {
        setIsSubmitting(false);

        if (err) {
          setError(
            "Impossible de joindre le serveur. Réessaie dans un instant.",
          );
          return;
        }

        if (!res) {
          setError("Le serveur n'a pas répondu.");
          return;
        }

        if (res.error) {
          setError(res.error);
          return;
        }

        onJoined({ code: res.code, player: res.player, room: res.room });
        socket.emit("start_game");
      });
  };

  return (
    <div className="screen home-screen bizu-home-screen">
      {onBackToHub && (
        <div className="screen-actions screen-actions-left">
          <button
            type="button"
            className="btn btn-ghost btn-inline"
            onClick={onBackToHub}
          >
            Changer de jeu
          </button>
        </div>
      )}

      <div className="home-header bizu-home-header">
        {/* <div className="bizu-logo-mark" aria-hidden="true">
          <span>A</span>
          <span>BIZU</span>
          <span>★</span>
        </div> */}
        <img className="home-logo" src={logoBizu} alt="Logo Le BIZU" />
        {/* <h1 className="home-title">
          <span className="home-title-text">Le BIZU</span>
        </h1> */}
        <br />
        <p className="home-subtitle">
          Un paquet, une carte, une règle. La partie s'arrête quand tout le
          paquet est retourné.
        </p>
      </div>

      <div className="home-buttons">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStart}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Lancement..." : "Lancer une partie"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
