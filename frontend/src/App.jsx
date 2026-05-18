import { useState, useEffect } from "react";
import { socket } from "./shared/socket";
import GameHub from "./hub/GameHub";
import BmcHome from "./games/blancMangerCoco/pages/Home";
import BmcLobby from "./games/blancMangerCoco/pages/Lobby";
import BmcGame from "./games/blancMangerCoco/pages/Game";
import BmcGameOver from "./games/blancMangerCoco/pages/GameOver";
import SkyjoHome from "./games/skyjo/pages/Home";
import SkyjoLobby from "./games/skyjo/pages/Lobby";
import SkyjoGame from "./games/skyjo/pages/Game";
import SkyjoGameOver from "./games/skyjo/pages/GameOver";
import "./App.css";

const SESSION_STORAGE_KEY = "bmc-game-session";
const DEFAULT_GAME_ID = "noir-manger-coco";
const RESTORE_TIMEOUT_MS = 8000;
const THEME_STORAGE_KEY = "bmc-game-theme";

function isValidSession(session) {
  return Boolean(
    session &&
    typeof session.code === "string" &&
    session.code.trim() &&
    typeof session.playerId === "string" &&
    session.playerId.trim(),
  );
}

function loadSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);
    if (!isValidSession(session)) {
      clearSession();
      return null;
    }

    return session;
  } catch {
    clearSession();
    return null;
  }
}

function saveSession(session) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function updateSession(patch) {
  const current = loadSession();
  if (!current) return;
  saveSession({ ...current, ...patch });
}

function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function loadTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return getSystemTheme();
  } catch {
    return "light";
  }
}

function saveTheme(theme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function getScreenFromRoom(room) {
  if (!room) return "home";

  if (room.phase === "scores" && room.winnerName && room.finalResults) {
    return "gameover";
  }

  return room.phase === "lobby" ? "lobby" : "game";
}

function getInitialScreen() {
  const session = loadSession();
  if (!session) return "hub";

  if (session.lastPhase === "scores") {
    return "gameover";
  }

  return session.lastPhase && session.lastPhase !== "lobby" ? "game" : "lobby";
}

export default function App() {
  const [screen, setScreen] = useState(getInitialScreen); // hub | home | lobby | game | gameover
  const [theme, setTheme] = useState(loadTheme);
  const [selectedGame, setSelectedGame] = useState(() =>
    loadSession()?.gameId || null,
  );
  const [roomData, setRoomData] = useState(null); // infos de la salle
  const [myData, setMyData] = useState(null); // { id, name, hand }
  const [winner, setWinner] = useState(null);
  const [finalResults, setFinalResults] = useState(null);
  const [isRestoringSession, setIsRestoringSession] = useState(
    () => !!loadSession(),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);

    const themeColor = theme === "dark" ? "#24151c" : "#f4eddb";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", themeColor);
    }

    document.documentElement.style.backgroundColor = themeColor;
    document.body.style.backgroundColor = themeColor;
  }, [theme]);

  useEffect(() => {
    let restoreTimeout = null;

    const stopRestoring = () => {
      if (restoreTimeout) {
        window.clearTimeout(restoreTimeout);
        restoreTimeout = null;
      }
      setIsRestoringSession(false);
    };

    const resetToHome = ({ clearStoredSession = false } = {}) => {
      if (clearStoredSession) {
        clearSession();
      }
      setRoomData(null);
      setMyData(null);
      setWinner(null);
      setFinalResults(null);
      setScreen(selectedGame ? "home" : "hub");
      stopRestoring();
    };

    const handleConnect = () => {
      const session = loadSession();
      if (!session?.code || !session?.playerId) {
        stopRestoring();
        return;
      }

      setIsRestoringSession(true);
      if (restoreTimeout) {
        window.clearTimeout(restoreTimeout);
      }
      restoreTimeout = window.setTimeout(() => {
        resetToHome({ clearStoredSession: true });
      }, RESTORE_TIMEOUT_MS);

      socket.emit("restore_session", session, (res) => {
        if (res?.error) {
          resetToHome({ clearStoredSession: true });
          return;
        }

        updateSession({ lastPhase: res.room.phase });
        setSelectedGame(res.room.gameId || DEFAULT_GAME_ID);
        setRoomData(res.room);
        setMyData(res.player);
        setScreen(getScreenFromRoom(res.room));
        stopRestoring();
      });
    };

    const handleRoomUpdate = (room) => {
      const session = loadSession();
      setRoomData(room);
      setSelectedGame(room.gameId || DEFAULT_GAME_ID);

      if (session?.playerId) {
        const me = room.players.find(
          (player) => player.id === session.playerId,
        );
        if (me?.hand) {
          setMyData((prev) => ({
            id: me.id,
            name: prev?.name || me.name,
            hand: me.hand,
          }));
        }
      }

      if (session) {
        updateSession({ lastPhase: room.phase, gameId: room.gameId });
        setScreen(getScreenFromRoom(room));
        stopRestoring();
      }
    };

    const handleGameOver = ({ winner, results }) => {
      updateSession({ lastPhase: "scores" });
      setWinner(winner);
      setFinalResults(results);
      setScreen("gameover");
      stopRestoring();
    };

    const handleConnectError = () => {
      if (loadSession()) {
        resetToHome({ clearStoredSession: true });
      } else {
        stopRestoring();
      }
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room_update", handleRoomUpdate);
    socket.on("game_over", handleGameOver);

    if (socket.connected) {
      handleConnect();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !socket.connected) {
        socket.connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopRestoring();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room_update", handleRoomUpdate);
      socket.off("game_over", handleGameOver);
    };
  }, [selectedGame]);

  useEffect(() => {
    if (!roomData) return;

    if (
      roomData.phase === "scores" &&
      roomData.winnerName &&
      roomData.finalResults
    ) {
      setWinner(roomData.winnerName);
      setFinalResults(roomData.finalResults);
    }
  }, [roomData]);

  const handleRoomJoined = ({ code, player, room }) => {
    const joinedGameId = room?.gameId || selectedGame || DEFAULT_GAME_ID;
    setSelectedGame(joinedGameId);
    saveSession({
      code,
      playerId: player.id,
      gameId: joinedGameId,
      lastPhase: room?.phase || "lobby",
    });
    setRoomData(room || null);
    setMyData(player);
    setWinner(null);
    setFinalResults(null);
    setIsRestoringSession(false);
    setScreen(room ? getScreenFromRoom(room) : "lobby");
  };

  const leaveCurrentRoom = () => {
    const resetLocalState = () => {
      clearSession();
      setScreen(selectedGame ? "home" : "hub");
      setRoomData(null);
      setMyData(null);
      setWinner(null);
      setFinalResults(null);
      setIsRestoringSession(false);
    };

    let didReset = false;
    const resetOnce = () => {
      if (didReset) return;
      didReset = true;
      resetLocalState();
    };

    socket.emit("leave_room", () => {
      resetOnce();
    });

    window.setTimeout(resetOnce, 400);
  };

  const session = loadSession();
  const renderScreen = roomData ? getScreenFromRoom(roomData) : screen;
  const activeGameId = roomData?.gameId || selectedGame || DEFAULT_GAME_ID;
  const Screens =
    activeGameId === "skyjo"
      ? {
          Home: SkyjoHome,
          Lobby: SkyjoLobby,
          Game: SkyjoGame,
          GameOver: SkyjoGameOver,
        }
      : {
          Home: BmcHome,
          Lobby: BmcLobby,
          Game: BmcGame,
          GameOver: BmcGameOver,
        };
  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  };
  const themeToggle = (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? "Activer le mode clair" : "Activer le mode sombre"
      }
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {theme === "dark" ? "☀️" : "🌙"}
      </span>
      <span className="theme-toggle-label">
        {theme === "dark" ? "Mode clair" : "Mode sombre"}
      </span>
    </button>
  );

  if (isRestoringSession && renderScreen !== "home" && !roomData) {
    return (
      <div className="app">
        {themeToggle}
        <div className="screen">
          <p>Reconnexion a la partie...</p>
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearSession();
              setRoomData(null);
              setMyData(null);
              setWinner(null);
              setFinalResults(null);
              setIsRestoringSession(false);
              setSelectedGame(null);
              setScreen("hub");
            }}
          >
            Retour aux jeux
          </button>
        </div>
      </div>
    );
  }

  if (!roomData && renderScreen !== "home" && renderScreen !== "hub") {
    if (session) {
      return (
        <div className="app">
          {themeToggle}
          <div className="screen">
            <p>Reconnexion a la partie...</p>
            <button
              className="btn btn-ghost"
              onClick={() => {
                clearSession();
                setRoomData(null);
                setMyData(null);
                setWinner(null);
                setFinalResults(null);
                setIsRestoringSession(false);
                setSelectedGame(null);
                setScreen("hub");
              }}
            >
              Retour aux jeux
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="app">
        {themeToggle}
        {selectedGame ? (
          <Screens.Home
            gameId={activeGameId}
            onJoined={handleRoomJoined}
            onBackToHub={() => {
              setSelectedGame(null);
              setScreen("hub");
            }}
          />
        ) : (
          <GameHub
            onSelectGame={(gameId) => {
              setSelectedGame(gameId);
              setScreen("home");
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {themeToggle}
      {renderScreen === "hub" && (
        <GameHub
          onSelectGame={(gameId) => {
            setSelectedGame(gameId);
            setScreen("home");
          }}
        />
      )}
      {renderScreen === "home" && (
        <Screens.Home
          gameId={activeGameId}
          onJoined={handleRoomJoined}
          onBackToHub={() => {
            setSelectedGame(null);
            setScreen("hub");
          }}
        />
      )}
      {renderScreen === "lobby" && (
        <Screens.Lobby
          room={roomData}
          myId={myData?.id}
          onLeave={leaveCurrentRoom}
        />
      )}
      {renderScreen === "game" && (
        <Screens.Game
          room={roomData}
          myId={myData?.id}
          myData={myData}
          onLeave={leaveCurrentRoom}
        />
      )}
      {renderScreen === "gameover" && (
        <Screens.GameOver
          winner={winner}
          results={finalResults}
          room={roomData}
          myId={myData?.id}
          onQuit={leaveCurrentRoom}
        />
      )}
    </div>
  );
}
