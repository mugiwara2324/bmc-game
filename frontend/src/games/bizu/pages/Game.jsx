import { useState } from "react";
import { socket } from "../../../shared/socket";

function PlayingCard({ card, hidden = false }) {
  const isRed = card?.color === "red";
  const isJoker = card?.rank === "Joker";

  return (
    <div
      className={`bizu-card ${hidden ? "bizu-card-back" : ""} ${
        isRed ? "red" : ""
      } ${isJoker ? "joker" : ""}`}
    >
      {hidden ? (
        <span className="bizu-card-back-text">BIZU</span>
      ) : (
        <>
          <span className="bizu-card-corner">
            {card.rank}
            <small>{card.symbol}</small>
          </span>
          <span className="bizu-card-main">{isJoker ? "★" : card.symbol}</span>
          <span className="bizu-card-corner bizu-card-corner-bottom">
            {card.rank}
            <small>{card.symbol}</small>
          </span>
        </>
      )}
    </div>
  );
}

function RuleBook() {
  const rules = [
    ["As", "reprend la règle de la carte précédente"],
    ["2 à 6", "prends ou distribue le nombre de gorgées"],
    ["7", "prends 7 gorgées"],
    ["8", "tu deviens le maître de la question"],
    ["9", "j'ai déjà, j'ai jamais"],
    ["10", "dans ma valise ou thème"],
    ["J", "tu choisis un bizu"],
    ["Q", "tu es la reine des pouces"],
    ["K", "tu inventes une règle"],
    ["Joker", "cul sec"],
  ];

  return (
    <section className="bizu-rules">
      <h3>Règles</h3>
      <div className="bizu-rule-grid">
        {rules.map(([rank, rule]) => (
          <div key={rank} className="bizu-rule-row">
            <strong>{rank}</strong>
            <span>{rule}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Game({ room, myId, onLeave }) {
  const [showRules, setShowRules] = useState(false);
  const isHost = room.host === myId;
  const isFinished = room.phase === "bizu_finished";
  const currentCard = room.currentCard;
  const inheritedRule = currentCard?.inheritedRule;
  const totalCards = room.totalCards || 54;
  const progress = Math.round(((room.drawnCount || 0) / totalCards) * 100);

  return (
    <div className="screen bizu-game-screen">
      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <button
        type="button"
        className="bizu-rules-toggle"
        onClick={() => setShowRules(true)}
      >
        Afficher les règles
      </button>

      <section className="bizu-table">
        <div className="bizu-deck-panel">
          <span className="bizu-kicker">Paquet</span>
          <div className="bizu-deck-stack" aria-label="Paquet de cartes">
            <PlayingCard hidden />
          </div>
          <strong>{room.deckCount} cartes restantes</strong>
          <div className="bizu-progress" aria-label={`${progress}% du paquet`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="bizu-current-panel">
          <span className="bizu-kicker">
            {isFinished ? "Dernière carte" : "Carte retournée"}
          </span>
          {currentCard ? (
            <PlayingCard card={currentCard} />
          ) : (
            <div className="bizu-empty-card">
              <span>?</span>
            </div>
          )}
        </div>
      </section>

      <section className="bizu-rule-card">
        {currentCard ? (
          <>
            <p className="bizu-current-label">{currentCard.label}</p>
            <h2>{inheritedRule?.ruleTitle || currentCard.ruleTitle}</h2>
            <p>{inheritedRule?.ruleDescription || currentCard.ruleDescription}</p>
            {currentCard.rank === "A" && inheritedRule && (
              <p className="bizu-previous-rule">
                Règle reprise: {inheritedRule.label} - {inheritedRule.ruleTitle}
              </p>
            )}
            {currentCard.rank === "A" && !inheritedRule && (
              <p className="bizu-previous-rule">
                Aucun effet à reprendre pour le moment.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="bizu-current-label">Prêt ?</p>
            <h2>Retourne la première carte</h2>
            <p>Chaque carte révélée impose sa règle à la table.</p>
          </>
        )}
      </section>

      <div className="bizu-actions">
        {isFinished ? (
          isHost ? (
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={() => socket.emit("bizu_replay")}
            >
              Rejouer
            </button>
          ) : (
            <p className="muted">En attente que l'hôte relance une partie...</p>
          )
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={() => socket.emit("bizu_draw_card")}
            disabled={room.deckCount <= 0}
          >
            Retourner une carte
          </button>
        )}
      </div>

      {showRules && (
        <div
          className="bizu-rules-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Règles du BIZU"
          onClick={() => setShowRules(false)}
        >
          <div className="bizu-rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bizu-rules-modal-header">
              <h2>Règles du BIZU</h2>
              <button
                type="button"
                className="bizu-rules-close"
                onClick={() => setShowRules(false)}
                aria-label="Fermer les règles"
              >
                ×
              </button>
            </div>
            <RuleBook />
          </div>
        </div>
      )}
    </div>
  );
}
