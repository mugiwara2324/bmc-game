import { useEffect, useMemo, useState } from "react";
import { socket } from "../../../shared/socket";

const COLORS = [
  { id: "red", label: "Rouge" },
  { id: "yellow", label: "Jaune" },
  { id: "green", label: "Vert" },
  { id: "blue", label: "Bleu" },
];

const ACTION_LABELS = {
  skip: "⊘",
  reverse: "↻",
  draw2: "+2",
  wild: "",
  wild4: "+4",
};

function getCardLabel(card) {
  if (!card) return "";
  if (card.type === "number") return String(card.value);
  if (Object.prototype.hasOwnProperty.call(ACTION_LABELS, card.type)) {
    return ACTION_LABELS[card.type];
  }
  return card.label;
}

function getCardAriaLabel(card) {
  if (!card) return "Carte UNO";
  return `${card.colorLabel || "Joker"} ${card.label}`;
}

function UnoCard({ card, selected, disabled, dimmed, onClick, compact }) {
  const isWild = card?.type === "wild" || card?.type === "wild4";
  const colorClass = isWild ? "wild" : card?.color || "back";
  const typeClass = card ? `uno-card-type-${card.type}` : "uno-card-type-back";
  const Component = onClick && !disabled ? "button" : "div";

  return (
    <Component
      {...(Component === "button" ? { type: "button" } : {})}
      className={`uno-card uno-card-${colorClass} ${typeClass} ${
        selected ? "is-selected" : ""
      } ${dimmed ? "is-dimmed" : ""} ${compact ? "is-compact" : ""}`}
      onClick={onClick && !disabled ? onClick : undefined}
      aria-label={getCardAriaLabel(card)}
      role={Component === "div" ? "img" : undefined}
    >
      {card ? (
        <>
          <span className="uno-card-corner">
            {card.type === "skip" || card.type === "reverse" ? (
              <UnoCardIcon card={card} />
            ) : (
              getCardLabel(card)
            )}
          </span>
          <span className="uno-card-center">
            <UnoCardIcon card={card} />
          </span>
          <span className="uno-card-corner uno-card-corner-bottom">
            {card.type === "skip" || card.type === "reverse" ? (
              <UnoCardIcon card={card} />
            ) : (
              getCardLabel(card)
            )}
          </span>
        </>
      ) : (
        <>
          <span className="uno-card-back-oval" aria-hidden="true" />
          <span className="uno-card-center uno-card-logo-text">UNO</span>
        </>
      )}
    </Component>
  );
}

function UnoCardIcon({ card }) {
  if (!card) return null;
  if (card.type === "number") return getCardLabel(card);
  if (card.type === "skip") {
    return (
      <svg className="uno-icon-skip" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <filter id="skip-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="-1.5"
              dy="-1.5"
              stdDeviation="0"
              floodColor="#111116"
            />
          </filter>
          <clipPath id="skip-clip">
            <circle cx="24" cy="24" r="14" />
          </clipPath>
        </defs>
        <g filter="url(#skip-shadow)">
          <circle
            cx="24"
            cy="24"
            r="17"
            fill="none"
            stroke="var(--uno-symbol-stroke)"
            strokeWidth="7"
          />
          <circle
            cx="24"
            cy="24"
            r="17"
            fill="none"
            stroke="var(--uno-symbol)"
            strokeWidth="6"
          />
        </g>
        <g clipPath="url(#skip-clip)">
          <g filter="url(#skip-shadow)">
            <line
              x1="10"
              y1="38"
              x2="38"
              y2="10"
              stroke="var(--uno-symbol)"
              strokeWidth="6"
              strokeLinecap="butt"
            />
          </g>
        </g>
      </svg>
    );
  }
  if (card.type === "reverse") {
    return (
      <svg className="uno-icon-reverse" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <filter id="skip-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="-1.5"
              dy="-1.5"
              stdDeviation="0"
              floodColor="#111116"
            />
          </filter>
        </defs>
        <g
          filter="url(#skip-shadow)"
          fill="var(--uno-symbol)"
          stroke="var(--uno-symbol-stroke)"
          strokeWidth="1.5"
          strokeLinejoin="miter"
        >
          <path d="M4 10 L28 10 L28 4 L44 16 L28 28 L28 22 L4 22 Z" />
          <path
            d="M44 26 L20 26 L20 32 L4 20 L20 8 L20 14 L44 14 Z"
            transform="translate(0,12)"
          />
        </g>
      </svg>
    );
  }
  if (card.type === "draw2") {
    return (
      <span className="uno-icon-draw uno-icon-draw-2">
        <span className="uno-mini-card" />
        <span className="uno-mini-card" />
        <strong>+2</strong>
      </span>
    );
  }
  if (card.type === "wild" || card.type === "wild4") {
    return (
      <span className="uno-icon-wild">
        <span className="uno-wild-oval" />
        {card.type === "wild4" && <strong>+4</strong>}
      </span>
    );
  }
  return getCardLabel(card);
}

function canStartSelection(card, room) {
  if (!card) return false;

  if (room.drawnPlayableCardId) {
    return card.id === room.drawnPlayableCardId;
  }

  if (room.pendingDraw > 0) {
    return (
      (room.pendingDrawType === "draw2" && card.type === "draw2") ||
      (room.pendingDrawType === "wild4" && card.type === "wild4")
    );
  }

  if (card.type === "wild" || card.type === "wild4") return true;

  if (!room.discardTop) return true;

  return (
    card.color === room.currentColor ||
    card.stackKey === room.discardTop.stackKey
  );
}

function needsColor(cards) {
  return cards.some((card) => card.type === "wild" || card.type === "wild4");
}

function canFinishWith(cards) {
  return cards.every((card) => card.type === "number");
}

export default function Game({ room, myId, onLeave }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [chosenColor, setChosenColor] = useState("");
  const [showTurnOverlay, setShowTurnOverlay] = useState(false);
  const players = room?.players || [];
  const me = players.find((player) => player.id === myId);
  const currentPlayer = players.find(
    (player) => player.id === room.currentPlayerId,
  );
  const myHand = useMemo(() => me?.hand || [], [me?.hand]);
  const isMyTurn = room.currentPlayerId === myId;
  const selectedCards = useMemo(
    () =>
      selectedIds
        .map((id) => myHand.find((card) => card.id === id))
        .filter(Boolean),
    [myHand, selectedIds],
  );
  const selectedStackKey = selectedCards[0]?.stackKey || null;
  const mustPlayDrawnCard = Boolean(room.drawnPlayableCardId);
  const canSubmit =
    isMyTurn &&
    selectedCards.length > 0 &&
    (selectedCards.length !== myHand.length || canFinishWith(selectedCards)) &&
    (!needsColor(selectedCards) || Boolean(chosenColor));
  const canDraw =
    isMyTurn && selectedCards.length === 0 && !room.drawnPlayableCardId;
  const stackedPreviewCards = selectedCards.length
    ? selectedCards
    : room.lastMove?.cards || [];
  const stackedPreviewTitle = selectedCards.length
    ? "Ordre du coup"
    : room.lastMove
      ? `Dernier coup de ${room.lastMove.playerName}`
      : "Pile active";

  const handleSelectCard = (card) => {
    if (!isMyTurn) return;

    if (!selectedStackKey) {
      if (!canStartSelection(card, room)) return;
      setSelectedIds([card.id]);
      setChosenColor("");
      return;
    }

    if (card.stackKey !== selectedStackKey) return;

    setSelectedIds((current) =>
      current.includes(card.id)
        ? current.filter((id) => id !== card.id)
        : [...current, card.id],
    );
  };

  const playCards = () => {
    if (!canSubmit) return;
    socket.emit("uno_play_cards", { cardIds: selectedIds, chosenColor });
  };

  const drawCard = () => {
    if (!canDraw) return;
    socket.emit("uno_draw");
  };

  const passAfterDraw = () => {
    if (!isMyTurn || !room.drawnPlayableCardId) return;
    socket.emit("uno_pass_after_draw");
  };

  useEffect(() => {
    setSelectedIds([]);
    setChosenColor("");
  }, [room.currentPlayerId, room.discardTop?.id, room.pendingDraw]);

  useEffect(() => {
    if (!isMyTurn) {
      setShowTurnOverlay(false);
      return undefined;
    }

    setShowTurnOverlay(true);
    const timer = window.setTimeout(() => {
      setShowTurnOverlay(false);
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [isMyTurn, room.currentPlayerId]);

  return (
    <div className="screen uno-game-screen">
      {showTurnOverlay && (
        <div className="skyjo-turn-overlay" aria-live="polite">
          <div className="skyjo-turn-overlay-card">
            <strong>A toi de jouer !</strong>
            <span>Pose ou pioche</span>
          </div>
        </div>
      )}

      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost btn-inline" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <div className="scoreboard uno-scoreboard">
        {players.map((player) => (
          <div
            key={player.id}
            className={`score-chip ${player.id === myId ? "me" : ""} ${
              player.id === room.currentPlayerId ? "current" : ""
            }`}
          >
            <span>{player.name}</span>
            <strong>{player.cardsCount}</strong>
          </div>
        ))}
      </div>

      <div className="uno-table">
        <div className="uno-table-status">
          <span className={`uno-color-dot ${room.currentColor || "wild"}`} />
          <p>
            {isMyTurn
              ? "A toi de jouer"
              : `Tour de ${currentPlayer?.name || "l'autre joueur"}`}
          </p>
          <small>
            Sens {room.direction === 1 ? "horaire" : "inverse"}
            {room.pendingDraw > 0 ? ` · cumul +${room.pendingDraw}` : ""}
          </small>
        </div>

        <div className="uno-piles">
          <button
            type="button"
            className={`uno-pile ${canDraw ? "clickable" : ""}`}
            onClick={drawCard}
            disabled={!canDraw}
          >
            <span className="skyjo-pile-label">Pioche</span>
            <UnoCard card={null} compact />
            <strong>{room.deckCount}</strong>
          </button>

          <div className="uno-pile">
            <span className="skyjo-pile-label">Pile</span>
            <UnoCard card={room.discardTop} compact />
            <strong>{room.currentColor || "-"}</strong>
          </div>
        </div>

        <div className="uno-played-stack" aria-label={stackedPreviewTitle}>
          <span className="skyjo-pile-label">{stackedPreviewTitle}</span>
          {stackedPreviewCards.length ? (
            <div className="uno-played-stack-cards">
              {stackedPreviewCards.map((card, index) => (
                <div
                  key={`${card.id}-${index}`}
                  className="uno-played-stack-card"
                  style={{ "--stack-index": index }}
                >
                  <UnoCard card={card} compact />
                  <span>{index + 1}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Aucune carte posee</p>
          )}
        </div>
      </div>

      <div className="uno-turn-panel">
        {room.pendingDraw > 0 && isMyTurn ? (
          <p className="phase-label">
            Tu dois empiler une carte identique ou piocher {room.pendingDraw}{" "}
            cartes.
          </p>
        ) : mustPlayDrawnCard && isMyTurn ? (
          <p className="phase-label">
            La carte piochee est jouable. Tu peux la poser ou passer.
          </p>
        ) : (
          <p className="phase-label">
            Selectionne une carte, puis ajoute les cartes de meme valeur si tu
            veux.
          </p>
        )}

        {needsColor(selectedCards) && (
          <div className="uno-color-picker" aria-label="Choisir une couleur">
            {COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`uno-color-choice ${color.id} ${
                  chosenColor === color.id ? "is-selected" : ""
                }`}
                onClick={() => setChosenColor(color.id)}
                aria-label={color.label}
              />
            ))}
          </div>
        )}

        <div className="uno-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={
              mustPlayDrawnCard && !selectedIds.length
                ? passAfterDraw
                : () => {
                    setSelectedIds([]);
                    setChosenColor("");
                  }
            }
            disabled={!selectedIds.length && !mustPlayDrawnCard}
          >
            {mustPlayDrawnCard && !selectedIds.length ? "Passer" : "Annuler"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={playCards}
            disabled={!canSubmit}
          >
            Poser {selectedIds.length || ""}
          </button>
        </div>
      </div>

      <div className="uno-hand" aria-label="Tes cartes">
        {myHand.map((card, index) => {
          const selected = selectedIds.includes(card.id);
          const canSelect =
            isMyTurn &&
            (!selectedStackKey
              ? canStartSelection(card, room)
              : card.stackKey === selectedStackKey);
          const dimmed =
            isMyTurn &&
            ((selectedStackKey && !canSelect) ||
              (mustPlayDrawnCard && card.id !== room.drawnPlayableCardId));
          const spread =
            myHand.length > 1 ? index - (myHand.length - 1) / 2 : 0;

          return (
            <div
              key={card.id}
              className="uno-hand-card"
              style={{
                "--uno-rotate": `${Math.max(-18, Math.min(18, spread * 3))}deg`,
                "--uno-offset": `${Math.abs(spread) * 2}px`,
              }}
            >
              <UnoCard
                card={card}
                selected={selected}
                disabled={!canSelect}
                dimmed={dimmed}
                onClick={() => handleSelectCard(card)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
