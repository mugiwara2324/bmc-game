import { useEffect, useState } from "react";
import { socket } from "../../../shared/socket";

function getCardTone(value) {
  if (value === null || value === undefined) return "back";
  if (value <= -1) return "blue";
  if (value === 0) return "cyan";
  if (value <= 4) return "green";
  if (value <= 8) return "yellow";
  return "red";
}

function SkyjoCard({ card, disabled, onClick, label }) {
  const tone = card?.removed ? "removed" : getCardTone(card?.value);
  const content = card?.removed ? "" : card?.value ?? "?";
  const isInteractive = Boolean(onClick) && !disabled && !card?.removed;
  const Component = isInteractive ? "button" : "div";

  return (
    <Component
      {...(isInteractive ? { type: "button" } : {})}
      className={`skyjo-card skyjo-card-${tone} ${
        card?.revealed ? "is-revealed" : "is-hidden"
      } ${isInteractive ? "is-clickable" : ""}`}
      onClick={isInteractive ? onClick : undefined}
      aria-label={label}
      role={isInteractive ? undefined : "img"}
    >
      {!card?.removed && (
        <>
          <span className="skyjo-card-corner">{content}</span>
          <span className="skyjo-card-value">{content}</span>
          <span className="skyjo-card-corner skyjo-card-corner-bottom">
            {content}
          </span>
        </>
      )}
    </Component>
  );
}

function PlayerBoard({
  player,
  isMe,
  isCurrent,
  canRevealInitial,
  canExchange,
  canRevealAfterDiscard,
  compact,
  onRevealInitial,
  onExchange,
  onRevealAfterDiscard,
}) {
  return (
    <section
      className={`skyjo-board-panel ${isMe ? "me" : ""} ${
        isCurrent ? "current" : ""
      } ${compact ? "compact" : ""}`}
    >
      <div className="skyjo-board-header">
        <div>
          <h3>{player.name}</h3>
          <p>
            {player.revealedCount}/12 visibles · {player.visibleScore} pts
            visibles
          </p>
        </div>
        {isCurrent && <span className="badge badge-me">À jouer</span>}
      </div>

      <div className="skyjo-board-grid">
        {player.board.map((card) => {
          const canClickInitial = isMe && canRevealInitial && !card.revealed;
          const canClickExchange = isMe && canExchange && !card.removed;
          const canClickRevealAfterDiscard =
            isMe && canRevealAfterDiscard && !card.revealed && !card.removed;

          let onClick = undefined;
          if (canClickInitial) onClick = () => onRevealInitial(card.index);
          if (canClickExchange) {
            onClick = () => onExchange(card.index);
          }
          if (canClickRevealAfterDiscard) {
            onClick = () => onRevealAfterDiscard(card.index);
          }

          return (
            <SkyjoCard
              key={`${card.index}-${card.value}-${card.revealed}-${card.removed}`}
              card={card}
              disabled={!onClick}
              onClick={onClick}
              label={`Carte ${card.index + 1}`}
            />
          );
        })}
      </div>
    </section>
  );
}

export default function Game({ room, myId, onLeave }) {
  const [boardView, setBoardView] = useState("mine");
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const [pendingExchangeIndex, setPendingExchangeIndex] = useState(null);
  const players = room?.players || [];
  const me = players.find((player) => player.id === myId);
  const otherPlayers = players.filter((player) => player.id !== myId);
  const currentPlayer = players.find(
    (player) => player.id === room.currentPlayerId,
  );
  const isHost = room.host === myId;
  const isMyTurn = room.currentPlayerId === myId;
  const isSetup = room.phase === "skyjo_setup";
  const isPlaying = room.phase === "skyjo_playing";
  const hasDrawn = room.phase === "skyjo_drawn";
  const isRevealAfterDiscard = room.phase === "skyjo_reveal_after_discard";
  const isRoundOver = room.phase === "skyjo_round_over";
  const canRevealInitial = isSetup && (me?.revealedCount || 0) < 2;
  const canExchange = hasDrawn && isMyTurn;
  const canDiscardDrawn = hasDrawn && isMyTurn && room.drawSource === "deck";
  const canRevealAfterDiscard = isRevealAfterDiscard && isMyTurn;
  const pendingExchangeCard =
    pendingExchangeIndex === null
      ? null
      : me?.board.find((card) => card.index === pendingExchangeIndex) || null;

  const drawCard = (source) => {
    if (!isMyTurn || !isPlaying) return;
    socket.emit("skyjo_draw", { source });
  };

  const handlePileKeyDown = (event, source) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handlePileClick(source);
  };

  const handlePileClick = (source) => {
    if (isPlaying) {
      drawCard(source);
      return;
    }

    if (source === "discard" && canDiscardDrawn) {
      setIsDiscardConfirmOpen(true);
    }
  };

  const confirmDiscardDrawn = () => {
    if (!canDiscardDrawn) return;
    setIsDiscardConfirmOpen(false);
    socket.emit("skyjo_discard_drawn");
  };

  const requestExchange = (index) => {
    if (!canExchange) return;
    setPendingExchangeIndex(index);
  };

  const confirmExchange = () => {
    if (!canExchange || pendingExchangeIndex === null) return;
    socket.emit("skyjo_exchange", { index: pendingExchangeIndex });
    setPendingExchangeIndex(null);
  };

  useEffect(() => {
    setIsDiscardConfirmOpen(false);
    setPendingExchangeIndex(null);
  }, [room.phase, room.drawnCard]);

  const sortedResults = [...(room.lastRound?.results || [])].sort(
    (a, b) => a.score - b.score,
  );

  return (
    <div className="screen skyjo-game-screen">
      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <div className="scoreboard skyjo-scoreboard">
        {players.map((player) => (
          <div
            key={player.id}
            className={`score-chip ${player.id === myId ? "me" : ""}`}
          >
            <span>{player.name}</span>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>

      {otherPlayers.length > 0 && (
        <button
          type="button"
          className="skyjo-view-toggle"
          onClick={() =>
            setBoardView((currentView) =>
              currentView === "mine" ? "others" : "mine",
            )
          }
        >
          {boardView === "mine" ? "Voir les joueurs" : "Voir mes cartes"}
        </button>
      )}

      <div className="skyjo-table">
        <div
          className={`skyjo-pile skyjo-deck ${
            isMyTurn && isPlaying ? "clickable" : ""
          }`}
          onClick={() => handlePileClick("deck")}
          onKeyDown={(event) => handlePileKeyDown(event, "deck")}
          role="button"
          tabIndex={isMyTurn && isPlaying ? 0 : -1}
          aria-disabled={!isMyTurn || !isPlaying}
        >
          <span className="skyjo-pile-label">Pioche</span>
          <div className="skyjo-card skyjo-card-back">
            <span className="skyjo-card-value">?</span>
          </div>
          <strong>{room.deckCount}</strong>
        </div>
        <div
          className={`skyjo-pile ${
            (isMyTurn && isPlaying && room.discardTop !== null) ||
            canDiscardDrawn
              ? "clickable"
              : ""
          }`}
          onClick={() => {
            if (room.discardTop !== null || canDiscardDrawn) {
              handlePileClick("discard");
            }
          }}
          onKeyDown={(event) => handlePileKeyDown(event, "discard")}
          role="button"
          tabIndex={
            (isMyTurn && isPlaying && room.discardTop !== null) ||
            canDiscardDrawn
              ? 0
              : -1
          }
          aria-disabled={
            (!isMyTurn || !isPlaying || room.discardTop === null) &&
            !canDiscardDrawn
          }
        >
          <span className="skyjo-pile-label">Défausse</span>
          <SkyjoCard
            card={{ value: room.discardTop, revealed: true }}
            disabled
            label="Carte de la défausse"
          />
        </div>
      </div>

      {isSetup && (
        <div className="waiting-info skyjo-status">
          {canRevealInitial ? (
            <p>Choisis deux cartes de ton tableau à révéler.</p>
          ) : (
            <p>En attente des deux cartes révélées par les autres joueurs...</p>
          )}
        </div>
      )}

      {isPlaying && (
        <div className="skyjo-turn-panel">
          {isMyTurn ? (
            <p className="phase-label">
              À toi de jouer: clique sur la pioche ou la défausse.
            </p>
          ) : (
            <p className="phase-label">
              Tour de {currentPlayer?.name || "l'autre joueur"}.
            </p>
          )}
        </div>
      )}

      {hasDrawn && (
        <div className="skyjo-turn-panel">
          <p className="phase-label">
            {isMyTurn
              ? `Carte piochée: ${room.drawnCard}`
              : `${currentPlayer?.name || "Le joueur"} choisit une carte.`}
          </p>
          {isMyTurn && (
            <div className="skyjo-drawn-card">
              <SkyjoCard
                card={{ value: room.drawnCard, revealed: true }}
                disabled
                label="Carte piochée"
              />
              <p className="muted">
                Clique sur une de tes cartes pour l'échanger.
                {room.drawSource === "deck"
                  ? " Clique sur la défausse si tu veux jeter la carte piochée."
                  : ""}
              </p>
            </div>
          )}
        </div>
      )}

      {isRevealAfterDiscard && (
        <div className="skyjo-turn-panel">
          <p className="phase-label">
            {isMyTurn
              ? "Carte défaussée. Retourne maintenant une de tes cartes cachées."
              : `${currentPlayer?.name || "Le joueur"} doit retourner une carte.`}
          </p>
        </div>
      )}

      {room.closerId && !isRoundOver && (
        <p className="muted">
          {players.find((player) => player.id === room.closerId)?.name} a tout
          révélé. Les autres terminent leur dernier tour.
        </p>
      )}

      <div className="skyjo-boards">
        {(boardView === "mine" ? [me].filter(Boolean) : otherPlayers).map((player) => (
          <PlayerBoard
            key={player.id}
            player={player}
            isMe={player.id === myId}
            isCurrent={player.id === room.currentPlayerId}
            canRevealInitial={canRevealInitial}
            canExchange={canExchange}
            canRevealAfterDiscard={canRevealAfterDiscard}
            compact={boardView === "others"}
            onRevealInitial={(index) =>
              socket.emit("skyjo_reveal_initial", { index })
            }
            onExchange={requestExchange}
            onRevealAfterDiscard={(index) =>
              socket.emit("skyjo_reveal_after_discard", { index })
            }
          />
        ))}
      </div>

      {isDiscardConfirmOpen && (
        <div className="skyjo-modal-backdrop" role="presentation">
          <div
            className="skyjo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skyjo-discard-title"
          >
            <h3 id="skyjo-discard-title">Défausser cette carte ?</h3>
            <div className="skyjo-exchange-preview single">
              <div className="skyjo-preview-card">
                <span>Carte piochée</span>
                <SkyjoCard
                  card={{ value: room.drawnCard, revealed: true }}
                  disabled
                  label="Carte piochée"
                />
              </div>
            </div>
            <p>
              Cette carte sera posée sur la défausse. Ensuite, tu devras
              retourner une carte cachée de ton tableau.
            </p>
            <div className="skyjo-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsDiscardConfirmOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmDiscardDrawn}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingExchangeIndex !== null && (
        <div className="skyjo-modal-backdrop" role="presentation">
          <div
            className="skyjo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skyjo-exchange-title"
          >
            <h3 id="skyjo-exchange-title">Échanger cette carte ?</h3>
            <div className="skyjo-exchange-preview">
              <div className="skyjo-preview-card">
                <span>Carte piochée</span>
                <SkyjoCard
                  card={{ value: room.drawnCard, revealed: true }}
                  disabled
                  label="Carte piochée"
                />
              </div>
              <span className="skyjo-exchange-arrow" aria-hidden="true">
                →
              </span>
              <div className="skyjo-preview-card">
                <span>Carte choisie</span>
                <SkyjoCard
                  card={
                    pendingExchangeCard || {
                      value: null,
                      revealed: false,
                      removed: false,
                    }
                  }
                  disabled
                  label="Carte choisie"
                />
              </div>
            </div>
            <p>
              La carte piochée remplacera la carte choisie. La carte remplacée
              sera posée face visible sur la défausse.
            </p>
            <div className="skyjo-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingExchangeIndex(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmExchange}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {isRoundOver && (
        <div className="result-phase skyjo-round-result">
          <h3>Fin de manche</h3>
          <div className="result-list">
            {sortedResults.map((result) => (
              <div key={result.id} className="result-row">
                <span className="result-name">{result.name}</span>
                <span className="result-votes">
                  Manche: {result.roundScore} pts
                  {result.doubled
                    ? ` (${result.baseRoundScore} x2)`
                    : ""}
                </span>
                <span className="result-score">Total: {result.score} pts</span>
              </div>
            ))}
          </div>
          <div className="phase-actions">
            {isHost ? (
              <button
                className="btn btn-primary"
                onClick={() => socket.emit("next_round")}
              >
                Manche suivante
              </button>
            ) : (
              <p className="muted">En attente de l'hôte...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
