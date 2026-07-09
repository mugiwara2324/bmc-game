import { useState } from "react";
import { socket } from "../../../shared/socket";
import logoUno from "../assets/uno_logo.png";

export default function Home({ gameId = "uno", onJoined, onBackToHub }) {
  const [variant, setVariant] = useState(null);
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
        setError("Impossible de joindre le serveur. Reessaie dans un instant.");
        return;
      }

      if (!res) {
        setError("Le serveur n'a pas repondu.");
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

  const resetToVariants = () => {
    setVariant(null);
    setMode(null);
    setError("");
  };

  return (
    <div className="screen home-screen uno-home-screen">
      {onBackToHub && !variant && (
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

      <div className="home-header uno-home-header">
        {/* <div className="uno-logo-mark" aria-hidden="true">
          <span>U</span>
          <span>N</span>
          <span>O</span>
        </div> */}
        <img className="home-logo" src={logoUno} alt="Logo UNO" />
        {/* <h1 className="home-title">
          <span className="home-title-text">UNO</span>
        </h1> */}
        <br />
        <p className="home-subtitle">
          Choisis une version, sois le premier a te débarasser de toutes tes
          cartes.
        </p>
      </div>

      {!variant && (
        <div className="uno-variant-grid">
          <button
            type="button"
            className="uno-variant-card"
            onClick={() => setVariant("classic")}
          >
            <span className="uno-card-preview uno-card-red">7</span>
            <span>
              <strong>UNO classique</strong>
              <small>Disponible maintenant</small>
            </span>
          </button>

          <button
            type="button"
            className="uno-variant-card is-disabled"
            disabled
          >
            <span className="uno-card-preview uno-card-flip">FLIP</span>
            <span>
              <strong>UNO Flip</strong>
              <small>Carte creee, moteur a venir</small>
            </span>
          </button>
        </div>
      )}

      {variant === "classic" && !mode && (
        <div className="home-buttons">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setMode("create");
              setError("");
            }}
          >
            Creer une partie
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={resetToVariants}
          >
            Retour aux versions
          </button>
        </div>
      )}

      {variant === "classic" && mode === "create" && (
        <div className="form-card">
          <h2>Nouvelle partie UNO</h2>
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
          <div className="lobby-info uno-rule-note">
            <p>2 joueurs minimum. Chacun commence avec 7 cartes.</p>
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
              {isSubmitting ? "Creation..." : "Creer"}
            </button>
          </div>
        </div>
      )}

      {variant === "classic" && mode === "join" && (
        <div className="form-card">
          <h2>Rejoindre une partie UNO</h2>
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
