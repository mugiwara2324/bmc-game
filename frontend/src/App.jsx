import { useState, useEffect } from "react";
import { socket } from "./Socket";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";
import GameOver from "./pages/GameOver";
import "./App.css";

const SESSION_STORAGE_KEY = "bmc-game-session";
const RESTORE_TIMEOUT_MS = 8000;

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

function getScreenFromRoom(room) {
  if (!room) return "home";

  if (room.phase === "scores" && room.winnerName && room.finalResults) {
    return "gameover";
  }

  return room.phase === "lobby" ? "lobby" : "game";
}

function getInitialScreen() {
  const session = loadSession();
  if (!session) return "home";

  if (session.lastPhase === "scores") {
    return "gameover";
  }

  return session.lastPhase && session.lastPhase !== "lobby" ? "game" : "lobby";
}

export default function App() {
  const [screen, setScreen] = useState(getInitialScreen); // home | lobby | game | gameover
  const [roomData, setRoomData] = useState(null); // infos de la salle
  const [myData, setMyData] = useState(null); // { id, name, hand }
  const [winner, setWinner] = useState(null);
  const [finalResults, setFinalResults] = useState(null);
  const [isRestoringSession, setIsRestoringSession] = useState(
    () => !!loadSession(),
  );

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
      setScreen("home");
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
        setRoomData(res.room);
        setMyData(res.player);
        setScreen(getScreenFromRoom(res.room));
        stopRestoring();
      });
    };

    const handleRoomUpdate = (room) => {
      const session = loadSession();
      setRoomData(room);

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
        updateSession({ lastPhase: room.phase });
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
  }, []);

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
    saveSession({
      code,
      playerId: player.id,
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
      setScreen("home");
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

  if (isRestoringSession && renderScreen !== "home" && !roomData) {
    return (
      <div className="app">
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
              setScreen("home");
            }}
          >
            Retour a l'accueil
          </button>
        </div>
      </div>
    );
  }

  if (!roomData && renderScreen !== "home") {
    if (session) {
      return (
        <div className="app">
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
                setScreen("home");
              }}
            >
              Retour a l'accueil
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="app">
        <Home onJoined={handleRoomJoined} />
      </div>
    );
  }

  return (
    <div className="app">
      {renderScreen === "home" && <Home onJoined={handleRoomJoined} />}
      {renderScreen === "lobby" && (
        <Lobby room={roomData} myId={myData?.id} onLeave={leaveCurrentRoom} />
      )}
      {renderScreen === "game" && (
        <Game
          room={roomData}
          myId={myData?.id}
          myData={myData}
          onLeave={leaveCurrentRoom}
        />
      )}
      {renderScreen === "gameover" && (
        <GameOver
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
