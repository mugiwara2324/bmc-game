import logoBizu from "../assets/bizu_logo.png";

export default function GameOver({ onQuit }) {
  return (
    <div className="screen gameover-screen">
      <div className="gameover-header">
        <img className="home-logo" src={logoBizu} alt="Logo Le BIZU" />
        <h1>Paquet terminé</h1>
        <p className="subtitle">La partie est finie.</p>
      </div>
      <div className="gameover-actions">
        <button className="btn btn-ghost btn-large" onClick={onQuit}>
          Quitter
        </button>
      </div>
    </div>
  );
}
