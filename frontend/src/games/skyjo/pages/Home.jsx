import { useState } from "react";
import { socket } from "../../../shared/socket";

export default function Home({ gameId = "skyjo", onJoined, onBackToHub }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitRequest = (eventName, payload) => {
    if (isSubmitting) return;

    setError("");
    setIsSubmitting(true);

    if (!socket.connected) {
      socket.connect();
    }

    socket.timeout(5000).emit(eventName, payload, (err, res) => {
      setIsSubmitting(false);

      if (err) {
        setError("Impossible de joindre le serveur. Réessaie dans un instant.");
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
    });
  };

  const handleCreate = () => {
    if (!name.trim()) return setError("Entre ton pseudo !");
    submitRequest("create_room", {
      name: name.trim(),
      maxScore: 100,
      gameId,
    });
  };

  const handleJoin = () => {
    if (!name.trim()) return setError("Entre ton pseudo !");
    if (!code.trim()) return setError("Entre le code de la partie !");
    submitRequest("join_room", {
      name: name.trim(),
      code: code.toUpperCase().trim(),
    });
  };

  return (
    <div className="screen home-screen skyjo-home-screen">
      {onBackToHub && !mode && (
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

      <div className="home-header skyjo-home-header">
        <div className="skyjo-logo-mark" aria-hidden="true">
          <span>12</span>
          <span>0</span>
          <span>-2</span>
        </div>
        <h1 className="home-title">
          <span className="home-title-text">Skyjo</span>
        </h1>
        <p className="home-subtitle">
          Le plus petit score gagne. La partie s'arrête à 100 points.
        </p>
      </div>

      {!mode && (
        <div className="home-buttons">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setMode("create");
              setError("");
            }}
          >
            Créer une partie
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setMode("join");
              setError("");
            }}
          >
            Rejoindre une partie
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="form-card">
          <h2>Nouvelle partie Skyjo</h2>
          <label>Ton pseudo</label>
          <input
            className="input"
            placeholder="Ex : Camille"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError("");
            }}
          />
          <div className="lobby-info skyjo-rule-note">
            <p>2 à 8 joueurs. Objectif: rester sous les 100 points.</p>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setMode(null);
                setError("");
              }}
            >
              Retour
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Création..." : "Créer"}
            </button>
          </div>
        </div>
      )}

      {mode === "join" && (
        <div className="form-card">
          <h2>Rejoindre une partie</h2>
          <label>Ton pseudo</label>
          <input
            className="input"
            placeholder="Ex : Sophie"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError("");
            }}
          />
          <label>Code de la partie</label>
          <input
            className="input input-code"
            placeholder="Ex : AB3XY"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (error) setError("");
            }}
            maxLength={5}
          />
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setMode(null);
                setError("");
              }}
            >
              Retour
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleJoin}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Connexion..." : "Rejoindre"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
