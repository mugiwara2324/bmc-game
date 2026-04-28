export default function GameOver({ winner, results, onRestart }) {
  const sorted = [...(results || [])].sort((a, b) => b.score - a.score);

  return (
    <div className="screen gameover-screen">
      <div className="gameover-header">
        <div className="trophy">🏆</div>
        <h1>{winner} a gagné !</h1>
        <p className="subtitle">Félicitations au grand vainqueur</p>
      </div>

      <div className="final-scores">
        {sorted.map((p, i) => (
          <div key={p.id} className={`final-row rank-${i + 1}`}>
            <span className="rank">
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
            </span>
            <span className="final-name">{p.name}</span>
            <span className="final-score">{p.score} pts</span>
          </div>
        ))}
      </div>

      <button className="btn btn-primary btn-large" onClick={onRestart}>
        Rejouer
      </button>
    </div>
  );
}
