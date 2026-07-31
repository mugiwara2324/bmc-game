import { useEffect, useMemo, useState } from "react";
import { socket } from "../../../shared/socket";

/* =========================
   IMAGE LOADER (CRA / Webpack)
========================= */

const classicImages = require.context("../assets/uno-classic-cards", false, /\.png$/);
const flipLightImages = require.context("../assets/uno-flip-cards-light", false, /\.png$/);
const flipDarkImages = require.context("../assets/uno-flip-cards-dark", false, /\.png$/);

function getImage(loader, name) {
  try {
    return loader(`./${name}`);
  } catch (e) {
    return loader("./back.png");
  }
}

/* =========================
   CARD IMAGE MAPPING
========================= */

function getCardImage(card, room) {
  const isFlip = room?.variant === "flip";
  const side = card?.side || room?.side || "light";
  const loader = isFlip
    ? side === "dark"
      ? flipDarkImages
      : flipLightImages
    : classicImages;

  if (!card) return getImage(loader, "back.png");

  if (card.type === "wild") return getImage(loader, "wild.png");
  if (card.type === "wild4") return getImage(loader, "wild4.png");
  if (card.type === "wild2") return getImage(loader, "wild2.png");
  if (card.type === "wildDraw") return getImage(loader, "wildDraw.png");

  if (card.type === "number") {
    return getImage(loader, `${card.color}_${card.value}.png`);
  }

  if (card.type === "reverse") {
    return getImage(loader, `${card.color}_reverse.png`);
  }

  if (card.type === "skip") {
    return getImage(loader, `${card.color}_skip.png`);
  }

  if (card.type === "draw2") {
    return getImage(loader, `${card.color}_draw2.png`);
  }

  if (card.type === "draw1") {
    return getImage(loader, `${card.color}_draw1.png`);
  }

  if (card.type === "draw5") {
    return getImage(loader, `${card.color}_draw5.png`);
  }

  if (card.type === "flip") {
    return getImage(loader, `${card.color}_flip.png`);
  }

  if (card.type === "replay") {
    return getImage(loader, `${card.color}_replay.png`);
  }

  return getImage(loader, "back.png");
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
const FLIP_COLORS = {
  light: COLORS,
  dark: [
    { id: "pink", label: "Rose" },
    { id: "cyan", label: "Turquoise" },
    { id: "orange", label: "Orange" },
    { id: "purple", label: "Violet" },
  ],
};

const COLOR_LABEL_BY_ID = Object.fromEntries(
  [...COLORS, ...FLIP_COLORS.dark].map((color) => [color.id, color.label]),
);

// Ordre utilisé pour trier la main par couleur (les jokers a la fin)
const COLOR_SORT_ORDER = {
  red: 0,
  yellow: 1,
  green: 2,
  blue: 3,
  pink: 0,
  cyan: 1,
  orange: 2,
  purple: 3,
};

function cardSortKey(card) {
  if (
    card.type === "wild" ||
    card.type === "wild4" ||
    card.type === "wild2" ||
    card.type === "wildDraw"
  ) {
    return [4, card.type, 0];
  }
  const colorRank = COLOR_SORT_ORDER[card.color] ?? 5;
  const typeRank = card.type === "number" ? 0 : 1;
  const valueRank = card.type === "number" ? card.value : 99;
  return [colorRank, typeRank, valueRank];
}

function sortHand(cards) {
  return [...cards].sort((a, b) => {
    const ka = cardSortKey(a);
    const kb = cardSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}

/* =========================
   UNO CARD COMPONENT
========================= */

function UnoCard({ card, room, selected, disabled, unplayable, playable, onClick, compact, orderBadge }) {
  const Component = onClick && !disabled ? "button" : "div";

  return (
    <Component
      {...(Component === "button" ? { type: "button" } : {})}
      className={`uno-card uno-card-img ${
        selected ? "is-selected" : ""
      } ${unplayable ? "is-unplayable" : ""} ${playable ? "is-playable" : ""} ${compact ? "is-compact" : ""}`}
      onClick={onClick && !disabled ? onClick : undefined}
      aria-label={card ? `${card.color || "Joker"} ${card.type}` : "Carte UNO"}
    >
      <img
        src={getCardImage(card, room)}
        alt=""
        draggable={false}
        className="uno-card-image"
      />
      {orderBadge ? (
        <span className="uno-order-badge">{orderBadge}</span>
      ) : null}
    </Component>
  );
}

/* =========================
   HELPERS (logique de jouabilite)
========================= */

// Une carte peut demarrer une selection si elle correspond a ce qui est
// reellement jouable a l'instant T : carte piochee imposee, pioche forcee
// en cours (+2/+4), ou pile normale.
function canStartSelection(card, room) {
  if (!card) return false;

  if (room.drawnPlayableCardId) {
    return card.id === room.drawnPlayableCardId;
  }

  if (room.pendingWildDrawColor) return false;

  if (room.pendingDraw > 0) {
    return (
      (room.pendingDrawType === "draw2" && card.type === "draw2") ||
      (room.pendingDrawType === "wild4" && card.type === "wild4") ||
      (room.pendingDrawType === "draw1" && card.type === "draw1") ||
      (room.pendingDrawType === "draw5" && card.type === "draw5") ||
      (room.pendingDrawType === "wild2" && card.type === "wild2")
    );
  }

  if (
    card.type === "wild" ||
    card.type === "wild4" ||
    card.type === "wild2" ||
    card.type === "wildDraw"
  ) return true;

  if (!room.discardTop) return true;

  return (
    card.color === room.currentColor ||
    card.stackKey === room.discardTop.stackKey
  );
}

function needsColor(cards) {
  return cards.some(
    (card) =>
      card.type === "wild" ||
      card.type === "wild4" ||
      card.type === "wild2" ||
      card.type === "wildDraw",
  );
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
  const sortedHand = useMemo(() => sortHand(myHand), [myHand]);

  const isMyTurn = room.currentPlayerId === myId;

  const selectedCards = useMemo(
    () =>
      selectedIds.map((id) => myHand.find((c) => c.id === id)).filter(Boolean),
    [myHand, selectedIds],
  );

  const selectedStackKey = selectedCards[0]?.stackKey || null;
  const lastSelectedCard = selectedCards[selectedCards.length - 1] || null;
  const requiresColorChoice = needsColor(selectedCards);

  const mustPlayDrawnCard = Boolean(room.drawnPlayableCardId);

  const canSubmit =
    isMyTurn &&
    selectedCards.length > 0 &&
    (selectedCards.length !== myHand.length || canFinishWith(selectedCards)) &&
    (!requiresColorChoice || Boolean(chosenColor));

  const canDraw =
    isMyTurn && selectedCards.length === 0 && !room.drawnPlayableCardId;

  const activeColors =
    room.variant === "flip" ? FLIP_COLORS[room.side || "light"] : COLORS;
  const pendingLabelByType = {
    draw1: "+1",
    draw2: "+2",
    draw5: "+5",
    wild2: "+2",
    wild4: "+4",
  };
  const pendingLabel = pendingLabelByType[room.pendingDrawType] || "+";
  const currentColorLabel = room.currentColor
    ? COLOR_LABEL_BY_ID[room.currentColor] || room.currentColor
    : null;

  const statusMainText = isMyTurn
    ? room.pendingDraw > 0
      ? `Tu dois repondre au ${pendingLabel} (${room.pendingDraw} carte${room.pendingDraw > 1 ? "s" : ""}) ou piocher.`
      : room.pendingWildDrawColor
        ? `Tu dois piocher jusqu'a tomber sur ${COLOR_LABEL_BY_ID[room.pendingWildDrawColor] || room.pendingWildDrawColor}.`
      : mustPlayDrawnCard
        ? "Carte piochee jouable : joue-la ou passe."
        : "A toi de jouer : pose une carte ou pioche."
    : currentPlayer
      ? `Tour de ${currentPlayer.name}...`
      : "En attente...";

  const statusSubParts = [];
  if (room.variant === "flip") {
    statusSubParts.push(`Face ${room.side === "dark" ? "sombre" : "claire"}`);
  }
  if (currentColorLabel) statusSubParts.push(`Couleur en cours : ${currentColorLabel}`);
  if (!isMyTurn && room.pendingDraw > 0) {
    statusSubParts.push(
      `${currentPlayer?.name || "Le joueur"} devra repondre au ${pendingLabel} ou piocher ${room.pendingDraw} carte${room.pendingDraw > 1 ? "s" : ""}.`,
    );
  }
  if (!isMyTurn && room.pendingWildDrawColor) {
    statusSubParts.push(
      `${currentPlayer?.name || "Le joueur"} devra piocher jusqu'a ${COLOR_LABEL_BY_ID[room.pendingWildDrawColor] || room.pendingWildDrawColor}.`,
    );
  }
  const statusSubText = statusSubParts.join(" · ");

  const handleSelectCard = (card) => {
    if (!isMyTurn) return;

    const alreadySelected = selectedIds.includes(card.id);

    if (!alreadySelected) {
      if (!selectedStackKey) {
        // canStartSelection gere deja le cas "carte piochee imposee" : seule
        // room.drawnPlayableCardId peut demarrer le coup dans ce cas.
        if (!canStartSelection(card, room)) return;
        setSelectedIds([card.id]);
        setChosenColor("");
        return;
      }

      if (card.stackKey !== selectedStackKey) return;
      setSelectedIds((current) => [...current, card.id]);
      return;
    }

    // La carte de depart (position 0) a ete validee comme jouable sur la
    // pile reelle : elle doit rester en tete du coup pour que le serveur
    // valide la pose. On ne peut la retirer qu'en annulant tout le coup.
    if (card.id === selectedIds[0] && selectedIds.length > 1) return;

    setSelectedIds((current) => current.filter((id) => id !== card.id));
  };

  // Deplace une carte selectionnee dans l'ordre de pose, pour choisir quelle
  // carte finit visible sur la pile (et donc quelle couleur s'applique).
  // La carte de depart (index 0) est verrouillee : c'est la seule dont le
  // serveur verifie la validite contre la pile reelle.
  const moveSelected = (cardId, direction) => {
    setSelectedIds((current) => {
      const idx = current.indexOf(cardId);
      if (idx <= 0) return current;
      const newIdx = idx + direction;
      if (newIdx <= 0 || newIdx >= current.length) return current;
      const copy = [...current];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
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

  const cancelSelection = () => {
    setSelectedIds([]);
    setChosenColor("");
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
        <div className="uno-table-status">
          <span className={`uno-color-dot ${room.currentColor || "wild"}`} />
          <p>{statusMainText}</p>
          <small>{statusSubText}</small>
        </div>

        <div className="uno-piles">
          <button
            className={`uno-pile ${canDraw ? "clickable" : ""}`}
            onClick={drawCard}
            disabled={!canDraw}
          >
            <span>Pioche</span>
            <UnoCard card={null} room={room} compact />
          </button>

          <div className="uno-pile">
            <span>Pile</span>
            <UnoCard card={room.discardTop} room={room} compact />
          </div>
        </div>

        {selectedCards.length > 1 && (
          <div className="uno-played-stack">
            <span>Ordre du coup (la derniere carte finira sur la pile)</span>

            <div className="uno-played-stack-cards">
              {selectedCards.map((card, i) => {
                const isLast = i === selectedCards.length - 1;
                const isLocked = i === 0;
                return (
                  <div key={`${card.id}-${i}`} className="uno-stack-item">
                    <UnoCard card={card} room={room} compact orderBadge={i + 1} />
                    {isLocked ? (
                      <span className="uno-stack-final-hint">Carte de depart</span>
                    ) : (
                      <div className="uno-stack-controls">
                        <button
                          type="button"
                          className="uno-stack-move-btn"
                          onClick={() => moveSelected(card.id, -1)}
                          disabled={i <= 1}
                          aria-label="Deplacer plus tot"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="uno-stack-move-btn"
                          onClick={() => moveSelected(card.id, 1)}
                          disabled={i === selectedCards.length - 1}
                          aria-label="Deplacer plus tard"
                        >
                          ›
                        </button>
                      </div>
                    )}
                    {isLast && !isLocked && (
                      <span className="uno-stack-final-hint">Carte finale</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {requiresColorChoice && (
          <div className="uno-played-stack">
            <div className="uno-color-picker">
              {activeColors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={`uno-color-choice ${color.id} ${
                    chosenColor === color.id ? "is-selected" : ""
                  }`}
                  onClick={() => setChosenColor(color.id)}
                  aria-label={color.label}
                  title={color.label}
                />
              ))}
            </div>
            {lastSelectedCard && (
              <p className="muted">
                Choisis la couleur pour ta carte {lastSelectedCard.type === "wild4" || lastSelectedCard.type === "wild2" ? "+2/+4" : "joker"}.
              </p>
            )}
          </div>
        )}
      </div>

      {isMyTurn && (
        <div className="uno-actions">
          <button
            className="btn btn-secondary"
            onClick={
              mustPlayDrawnCard && !selectedIds.length
                ? passAfterDraw
                : cancelSelection
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
      )}

      <div className="uno-hand">
        {sortedHand.map((card) => {
          const selected = selectedIds.includes(card.id);
          const orderIndex = selectedIds.indexOf(card.id);

          const canSelect =
            isMyTurn &&
            (!selectedStackKey
              ? canStartSelection(card, room)
              : card.stackKey === selectedStackKey);

          const showPlayability = isMyTurn && !requiresColorChoice;
          const unplayable = showPlayability && !canSelect;
          const playable = showPlayability && canSelect && !selected;

          return (
            <div key={card.id} className="uno-hand-card">
              <UnoCard
                card={card}
                room={room}
                selected={selected}
                disabled={!isMyTurn || !canSelect}
                unplayable={unplayable}
                playable={playable}
                onClick={() => handleSelectCard(card)}
                orderBadge={selected && selectedIds.length > 1 ? orderIndex + 1 : null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
