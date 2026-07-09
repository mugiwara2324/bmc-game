import { useEffect, useMemo, useState } from "react";
import { socket } from "../../../shared/socket";

/* =========================
   IMAGE LOADER (CRA / Webpack)
========================= */

const images = require.context("../assets/uno-classic-cards", false, /\.png$/);

function getImage(name) {
  try {
    return images(`./${name}`);
  } catch (e) {
    return images("./back.png");
  }
}

/* =========================
   CARD IMAGE MAPPING
========================= */

function getCardImage(card) {
  if (!card) return getImage("back.png");

  if (card.type === "wild") return getImage("wild.png");
  if (card.type === "wild4") return getImage("wild4.png");

  if (card.type === "number") {
    return getImage(`${card.color}_${card.value}.png`);
  }

  if (card.type === "reverse") {
    return getImage(`${card.color}_reverse.png`);
  }

  if (card.type === "skip") {
    return getImage(`${card.color}_skip.png`);
  }

  if (card.type === "draw2") {
    return getImage(`${card.color}_draw2.png`);
  }

  return getImage("back.png");
}

/* =========================
   COLORS
========================= */

const COLORS = [
  { id: "red", label: "Rouge" },
  { id: "yellow", label: "Jaune" },
  { id: "green", label: "Vert" },
  { id: "blue", label: "Bleu" },
];

/* =========================
   UNO CARD COMPONENT
========================= */

function UnoCard({ card, selected, disabled, dimmed, onClick, compact }) {
  const Component = onClick && !disabled ? "button" : "div";

  return (
    <Component
      {...(Component === "button" ? { type: "button" } : {})}
      className={`uno-card uno-card-img ${
        selected ? "is-selected" : ""
      } ${dimmed ? "is-dimmed" : ""} ${compact ? "is-compact" : ""}`}
      onClick={onClick && !disabled ? onClick : undefined}
      aria-label={card ? `${card.color || "Joker"} ${card.type}` : "Carte UNO"}
    >
      <img
        src={getCardImage(card)}
        alt=""
        draggable={false}
        className="uno-card-image"
      />
    </Component>
  );
}

/* =========================
   HELPERS (inchangés)
========================= */

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

/* =========================
   MAIN GAME
========================= */

export default function Game({ room, myId, onLeave }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [chosenColor, setChosenColor] = useState("");
  const [showTurnOverlay, setShowTurnOverlay] = useState(false);

  const players = room?.players || [];
  const me = players.find((p) => p.id === myId);
  const currentPlayer = players.find((p) => p.id === room.currentPlayerId);

  const myHand = useMemo(() => me?.hand || [], [me?.hand]);

  const isMyTurn = room.currentPlayerId === myId;

  const selectedCards = useMemo(
    () =>
      selectedIds.map((id) => myHand.find((c) => c.id === id)).filter(Boolean),
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
    socket.emit("uno_play_cards", {
      cardIds: selectedIds,
      chosenColor,
    });
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
      return;
    }

    setShowTurnOverlay(true);
    const timer = setTimeout(() => setShowTurnOverlay(false), 1400);
    return () => clearTimeout(timer);
  }, [isMyTurn, room.currentPlayerId]);

  return (
    <div className="screen uno-game-screen">
      {showTurnOverlay && (
        <div className="skyjo-turn-overlay">
          <div className="skyjo-turn-overlay-card">
            <strong>A toi de jouer !</strong>
            <span>Pose ou pioche</span>
          </div>
        </div>
      )}

      <div className="screen-actions screen-actions-left">
        <button className="btn btn-ghost" onClick={onLeave}>
          Quitter la partie
        </button>
      </div>

      <div className="uno-table">
        <div className="uno-piles">
          <button
            className={`uno-pile ${canDraw ? "clickable" : ""}`}
            onClick={drawCard}
            disabled={!canDraw}
          >
            <span>Pioche</span>
            <UnoCard card={null} compact />
            <strong>{room.deckCount}</strong>
          </button>

          <div className="uno-pile">
            <span>Pile</span>
            <UnoCard card={room.discardTop} compact />
            <strong>{room.currentColor || "-"}</strong>
          </div>
        </div>

        <div className="uno-played-stack">
          <span>{stackedPreviewTitle}</span>

          {stackedPreviewCards.length ? (
            <div className="uno-played-stack-cards">
              {stackedPreviewCards.map((card, i) => (
                <div key={`${card.id}-${i}`}>
                  <UnoCard card={card} compact />
                </div>
              ))}
            </div>
          ) : (
            <p>Aucune carte posée</p>
          )}
        </div>
      </div>

      <div className="uno-actions">
        <button
          className="btn btn-secondary"
          onClick={
            mustPlayDrawnCard && !selectedIds.length
              ? passAfterDraw
              : () => {
                  setSelectedIds([]);
                  setChosenColor("");
                }
          }
        >
          {mustPlayDrawnCard && !selectedIds.length ? "Passer" : "Annuler"}
        </button>

        <button
          className="btn btn-primary"
          onClick={playCards}
          disabled={!canSubmit}
        >
          Poser {selectedIds.length || ""}
        </button>
      </div>

      <div className="uno-hand">
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
