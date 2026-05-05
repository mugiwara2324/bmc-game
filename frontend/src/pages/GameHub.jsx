import logoBmc from "../assets/logo-BMC.webp";

const games = [
  {
    id: "noir-manger-coco",
    title: "Noir Manger Coco",
    subtitle: "La meilleur version du jeu Blanc Manger Coco",
    description: "Questions noires, reponses absurdes, parties entre amis.",
    badge: "Disponible",
  },
];

export default function GameHub({ onSelectGame }) {
  return (
    <div className="screen hub-screen">
      <div className="hub-header">
        <p className="hub-kicker">Selection</p>
        <h1>Jeux</h1>
        <p className="hub-subtitle">Choisis le jeu que tu veux lancer.</p>
      </div>

      <div className="hub-grid">
        {games.map((game) => (
          <button
            key={game.id}
            type="button"
            className="game-card"
            onClick={() => onSelectGame(game.id)}
          >
            <div className="game-card-top">
              <span className="game-card-icon" aria-hidden="true">
                <img className="game-card-logo" src={logoBmc} alt="" />
              </span>
              <span className="game-card-badge">{game.badge}</span>
            </div>

            <div className="game-card-body">
              <h2>{game.title}</h2>
              <p className="game-card-subtitle">{game.subtitle}</p>
              <p className="game-card-description">{game.description}</p>
            </div>

            <span className="game-card-cta">Ouvrir le jeu</span>
          </button>
        ))}
      </div>
    </div>
  );
}
