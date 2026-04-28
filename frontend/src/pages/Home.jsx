import { useState } from "react";
import { socket } from "../Socket";

export default function Home({ onJoined }) {
  const [mode, setMode] = useState(null); // "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [maxScore, setMaxScore] = useState(10);
  const [error, setError] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return setError("Entre ton pseudo !");
    socket.emit("create_room", { name: name.trim(), maxScore }, (res) => {
      if (res.error) return setError(res.error);
      onJoined({ code: res.code, player: res.player, room: res.room });
    });
  };

  const handleJoin = () => {
    if (!name.trim()) return setError("Entre ton pseudo !");
    if (!code.trim()) return setError("Entre le code de la partie !");
    socket.emit(
      "join_room",
      { name: name.trim(), code: code.toUpperCase().trim() },
      (res) => {
        if (res.error) return setError(res.error);
        onJoined({ code: res.code, player: res.player, room: res.room });
      },
    );
  };

  return (
    <div className="screen home-screen">
      <div className="home-header">
        <h1 className="home-title">🃏 Noir Manger Coco 🃏</h1>
        <p className="home-subtitle">Le jeu de cartes entre amis</p>
      </div>

      {!mode && (
        <div className="home-buttons">
          <button className="btn btn-primary" onClick={() => setMode("create")}>
            Créer une partie
          </button>
          <button className="btn btn-secondary" onClick={() => setMode("join")}>
            Rejoindre une partie
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="form-card">
          <h2>Nouvelle partie</h2>
          <label>Ton pseudo</label>
          <input
            className="input"
            placeholder="Ex : Julien"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label>Score pour gagner</label>
          <div className="score-selector">
            {[5, 7, 10, 15].map((n) => (
              <button
                key={n}
                className={`score-btn ${maxScore === n ? "active" : ""}`}
                onClick={() => setMaxScore(n)}
              >
                {n} pts
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMode(null);
                setError("");
              }}
            >
              Retour
            </button>
            <button className="btn btn-primary" onClick={handleCreate}>
              Créer →
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
            onChange={(e) => setName(e.target.value)}
          />
          <label>Code de la partie</label>
          <input
            className="input input-code"
            placeholder="Ex : AB3XY"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
          />
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMode(null);
                setError("");
              }}
            >
              Retour
            </button>
            <button className="btn btn-primary" onClick={handleJoin}>
              Rejoindre →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
