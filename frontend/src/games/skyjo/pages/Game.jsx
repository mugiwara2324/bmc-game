import { useEffect, useState } from "react";
import { socket } from "../../../shared/socket";

// Import des images de cartes Skyjo
import skyjoBack from "../assets/skyjo_back.png";
import skyjoNeg1 from "../assets/skyjo_neg1.png";
import skyjoNeg2 from "../assets/skyjo_neg2.png";
import skyjo0 from "../assets/skyjo_0.png";
import skyjo1 from "../assets/skyjo_1.png";
import skyjo2 from "../assets/skyjo_2.png";
import skyjo3 from "../assets/skyjo_3.png";
import skyjo4 from "../assets/skyjo_4.png";
import skyjo5 from "../assets/skyjo_5.png";
import skyjo6 from "../assets/skyjo_6.png";
import skyjo7 from "../assets/skyjo_7.png";
import skyjo8 from "../assets/skyjo_8.png";
import skyjo9 from "../assets/skyjo_9.png";
import skyjo10 from "../assets/skyjo_10.png";
import skyjo11 from "../assets/skyjo_11.png";
import skyjo12 from "../assets/skyjo_12.png";

const CARD_IMAGES = {
  "-1": skyjoNeg1,
  "-2": skyjoNeg2,
  0: skyjo0,
  1: skyjo1,
  2: skyjo2,
  3: skyjo3,
  4: skyjo4,
  5: skyjo5,
  6: skyjo6,
  7: skyjo7,
  8: skyjo8,
  9: skyjo9,
  10: skyjo10,
  11: skyjo11,
  12: skyjo12,
};

function getCardImage(card) {
  if (card?.removed) return null;
  if (!card?.revealed) return skyjoBack;
  if (card?.value === null || card?.value === undefined) return skyjoBack;
  return CARD_IMAGES[card.value] ?? skyjoBack;
}

function SkyjoCard({ card, disabled, onClick, label, selected }) {
  const image = getCardImage(card);
  const isInteractive = Boolean(onClick) && !disabled && !card?.removed;
  const Component = isInteractive ? "button" : "div";

  return (
    <Component
      {...(isInteractive ? { type: "button" } : {})}
      className={`skyjo-card ${card?.removed ? "skyjo-card-removed" : ""} ${
        card?.revealed ? "is-revealed" : "is-hidden"
      } ${isInteractive ? "is-clickable" : ""} ${
        selected ? "is-selected" : ""
      }`}
      onClick={isInteractive ? onClick : undefined}
      aria-label={label}
      role={isInteractive ? undefined : "img"}
    >
      {!card?.removed && (
        <>
          <img
            src={image}
            alt={label}
            className="skyjo-card-img"
            draggable={false}
          />
          {selected && (
            <span className="skyjo-card-confirm-hint">
              Retouche pour confirmer
            </span>
          )}
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
  selectedExchangeIndex,
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
          const isSelected =
            canClickExchange && selectedExchangeIndex === card.index;

          return (
            <div
              key={`${card.index}-${card.value}-${card.revealed}-${card.removed}`}
              className={`skyjo-card-slot ${isSelected ? "is-selected" : ""}`}
            >
              <SkyjoCard
                card={card}
                disabled={!onClick}
                onClick={onClick}
                label={`Carte ${card.index + 1}`}
                selected={isSelected}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Game({ room, myId, onLeave }) {
  const [boardView, setBoardView] = useState("mine");
  const [selectedAction, setSelectedAction] = useState(null);
  const [showTurnOverlay, setShowTurnOverlay] = useState(false);
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
  const selectedExchangeIndex =
    selectedAction?.type === "exchange" ? selectedAction.index : null;
  const isDiscardSelected = selectedAction?.type === "discard";

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
      if (isDiscardSelected) {
        socket.emit("skyjo_discard_drawn");
        setSelectedAction(null);
        return;
      }

      setSelectedAction({ type: "discard" });
    }
  };

  const requestExchange = (index) => {
    if (!canExchange) return;

    if (selectedAction?.type === "exchange" && selectedAction.index === index) {
      socket.emit("skyjo_exchange", { index });
      setSelectedAction(null);
      return;
    }

    setSelectedAction({ type: "exchange", index });
  };

  useEffect(() => {
    setSelectedAction(null);
  }, [room.phase, room.drawnCard]);

  useEffect(() => {
    if (!isMyTurn || !isPlaying) {
      setShowTurnOverlay(false);
      return undefined;
    }

    setShowTurnOverlay(true);
    const timer = window.setTimeout(() => {
      setShowTurnOverlay(false);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [isMyTurn, isPlaying, room.currentPlayerId]);

  const sortedResults = [...(room.lastRound?.results || [])].sort(
    (a, b) => a.score - b.score,
  );

  return (
    <div className="screen skyjo-game-screen">
      {showTurnOverlay && (
        <div className="skyjo-turn-overlay" aria-live="polite">
          <div className="skyjo-turn-overlay-card">
            <strong>À toi de jouer !</strong>
            <span>Choisis une carte</span>
          </div>
        </div>
      )}

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
            <img
              src={skyjoBack}
              alt="Pioche"
              className="skyjo-card-img"
              draggable={false}
            />
          </div>
          <strong>{room.deckCount}</strong>
        </div>
        <div
          className={`skyjo-pile ${
            (isMyTurn && isPlaying && room.discardTop !== null) ||
            canDiscardDrawn
              ? "clickable"
              : ""
          } ${isDiscardSelected ? "discard-card-selected" : ""}`}
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
            selected={isDiscardSelected}
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
                {selectedAction?.type === "exchange"
                  ? "Retouche la même carte pour confirmer l'échange."
                  : "Clique sur une de tes cartes pour préparer l'échange."}
                {room.drawSource === "deck"
                  ? isDiscardSelected
                    ? " Retouche la défausse pour confirmer. Clique sur l'une de tes cartes pour l'échanger."
                    : " Clique sur la défausse si tu veux jeter la carte piochée."
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
        {(boardView === "mine" ? [me].filter(Boolean) : otherPlayers).map(
          (player) => (
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
              selectedExchangeIndex={selectedExchangeIndex}
            />
          ),
        )}
      </div>

      {isRoundOver && (
        <div className="result-phase skyjo-round-result">
          <h3>Fin de manche</h3>
          <div className="result-list">
            {sortedResults.map((result) => (
              <div key={result.id} className="result-row">
                <span className="result-name">{result.name}</span>
                <span className="result-votes">
                  Manche: {result.roundScore} pts
                  {result.doubled ? ` (${result.baseRoundScore} x2)` : ""}
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
