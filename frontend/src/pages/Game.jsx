import { useState, useEffect } from "react";
import { socket } from "../Socket";
import iconBmc from "../assets/icone-BMC.png";

function renderAnswer(question, card) {
  if (!question) return card || "";
  return question.includes("_____")
    ? question.replace("_____", `"${card}"`)
    : `${question} "${card}"`;
}

export default function Game({ room, myId, myData, onLeave }) {
  const [revealedIndex, setRevealedIndex] = useState(-1);
  const [pendingCard, setPendingCard] = useState(null);
  const [pendingVote, setPendingVote] = useState(null);

  const players = room?.players || [];
  const connectedPlayers = players.filter(
    (player) => player.connected !== false,
  );
  const me = players.find((player) => player.id === myId);
  const question = room?.currentQuestion || "";
  const phase = room?.phase || "playing";
  const playedCards = room?.playedCards || [];
  const playCount = room?.playCount || {
    count: 0,
    total: connectedPlayers.length || players.length,
  };
  const voteCount = room?.voteCount || {
    count: 0,
    total: connectedPlayers.length || players.length,
  };
  const roundResult = room?.lastRound || null;
  const hand = myData?.hand || [];
  const hasPlayed = !!me?.hasPlayed;
  const selectedCard = room?.myPlayedCard || pendingCard;
  const votedFor = room?.votedFor || pendingVote;
  const isHost = room?.host === myId;
  const allCardsRevealed =
    playedCards.length > 0 && revealedIndex >= playedCards.length - 1;

  useEffect(() => {
    if (room?.myPlayedCard) {
      setPendingCard(null);
    }
  }, [room?.myPlayedCard]);

  useEffect(() => {
    if (room?.votedFor) {
      setPendingVote(null);
    }
  }, [room?.votedFor]);

  useEffect(() => {
    if (phase === "playing") {
      setRevealedIndex(-1);
      setPendingVote(null);
      if (!hasPlayed) {
        setPendingCard(null);
      }
      return;
    }

    if (phase === "voting" || phase === "result" || phase === "scores") {
      setRevealedIndex(playedCards.length - 1);
      return;
    }

    if (phase !== "revealing" || playedCards.length === 0) return;

    setRevealedIndex(-1);
    const timers = playedCards.map((_, index) =>
      setTimeout(() => setRevealedIndex(index), (index + 1) * 1200),
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [phase, playedCards, hasPlayed]);

  const playCard = (card) => {
    if (hasPlayed || phase !== "playing") return;
    setPendingCard(card);
    socket.emit("play_card", { card });
  };

  const voteFor = (id) => {
    if (votedFor || id === myId || phase !== "voting") return;
    setPendingVote(id);
    socket.emit("vote_card", { votedId: id });
  };

  const startVoting = () => {
    if (!isHost || !allCardsRevealed) return;
    socket.emit("start_voting");
  };

  const nextRound = () => {
    if (!isHost || phase !== "result") return;
    socket.emit("next_round");
  };

  return (
    <div className="screen game-screen">
      <div className="screen-actions">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      {/* Scores en haut */}
      <div className="scoreboard">
        {players.map((p) => (
          <div key={p.id} className={`score-chip ${p.id === myId ? "me" : ""}`}>
            <span>{p.name}</span>
            <strong>{p.score}</strong>
          </div>
        ))}
      </div>

      {/* Question */}
      <div className="question-card">
        <p className="question-label">Question</p>
        <p className="question-text">
          {question || "En attente de la question..."}
        </p>
      </div>

      {/* Phase : jouer une carte */}
      {phase === "playing" && (
        <div className="playing-phase">
          {hasPlayed ? (
            <div className="waiting-info">
              <p>
                ✅ Carte jouée : <em>"{selectedCard}"</em>
              </p>
              <p className="muted">
                En attente des autres joueurs… ({playCount.count}/
                {playCount.total || connectedPlayers.length || players.length})
              </p>
            </div>
          ) : (
            <>
              <p className="phase-label">Choisis une carte réponse</p>
              <div className="hand">
                {hand.map((card, i) => (
                  <div
                    key={i}
                    className="card answer-card"
                    onClick={() => playCard(card)}
                  >
                    {card}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Phase : révélation */}
      {(phase === "revealing" || phase === "voting") && (
        <div className="reveal-phase">
          <p className="phase-label">
            {phase === "revealing"
              ? "Révélation des cartes…"
              : "Vote ! Quelle est la meilleure réponse ?"}
          </p>
          <div className="played-cards">
            {playedCards.map((p, i) => (
              <div
                key={p.id}
                className={`card played-card ${i <= revealedIndex ? "revealed" : "hidden-card"} ${phase === "voting" && p.id !== myId ? "votable" : ""} ${votedFor === p.id ? "voted" : ""}`}
                onClick={() => phase === "voting" && voteFor(p.id)}
              >
                {i <= revealedIndex ? (
                  <>
                    <p className="played-answer">
                      {renderAnswer(question, p.card)}
                    </p>
                    {phase === "voting" && p.id !== myId && (
                      <span className="vote-hint">
                        {votedFor === p.id ? "✅ Voté !" : "👆 Voter"}
                      </span>
                    )}
                    {p.id === myId && (
                      <span className="my-card-label">Ma carte</span>
                    )}
                  </>
                ) : (
                  <img
                    className="card-back-logo"
                    src={iconBmc}
                    alt="Dos de carte Blanc Manger Coco"
                  />
                )}
              </div>
            ))}
          </div>
          {phase === "revealing" && allCardsRevealed && (
            <div className="phase-actions">
              {isHost ? (
                <button className="btn btn-primary" onClick={startVoting}>
                  Ouvrir les votes
                </button>
              ) : (
                <p className="muted">En attente du maitre du salon…</p>
              )}
            </div>
          )}
          {phase === "voting" && votedFor && (
            <p className="muted">
              En attente des votes… ({voteCount.count}/
              {voteCount.total || connectedPlayers.length || players.length})
            </p>
          )}
        </div>
      )}

      {/* Phase : résultat du round */}
      {phase === "result" && roundResult && (
        <div className="result-phase">
          <h3>
            🏆 {room.players.find((p) => p.id === roundResult.winnerId)?.name}{" "}
            remporte ce tour !
          </h3>
          <div className="result-list">
            {roundResult.results
              .sort((a, b) => b.votes - a.votes)
              .map((r) => (
                <div
                  key={r.id}
                  className={`result-row ${r.id === roundResult.winnerId ? "winner" : ""}`}
                >
                  <span className="result-name">{r.name}</span>
                  <span className="result-card">"{r.card}"</span>
                  <span className="result-votes">
                    {r.votes} vote{r.votes !== 1 ? "s" : ""}
                  </span>
                  <span className="result-score">{r.score} pts</span>
                </div>
              ))}
          </div>
          <div className="phase-actions">
            {isHost ? (
              <button className="btn btn-primary" onClick={nextRound}>
                Question suivante
              </button>
            ) : (
              <p className="muted">En attente du maitre du salon…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
