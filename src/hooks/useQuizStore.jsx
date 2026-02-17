import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';

const INITIAL_STATE = {
  connected: false,
  roomId: null,
  playerId: null,
  role: null,
  spectatorToken: null,
  kicked: false,
  gameState: {
    currentMode: 'BUZZER',
    inputEnabled: false,
    buzzes: [],
    lockedOut: false,
  },
  players: [],
  scores: {},
  history: [],
  error: null,
};

// ── Session helpers ────────────────────────────────────────────────────────
const SESSION_KEY = 'buzzmaster_session';

function saveSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

const QuizContext = createContext(null);

export function QuizProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);
  const throttleRef = useRef(null);
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    const onConnect = () => {
      setState((s) => ({ ...s, connected: true }));

      // Auto-rejoin on reconnect / page refresh
      if (!reconnectedRef.current) {
        reconnectedRef.current = true;
        const session = loadSession();
        if (session?.roomId && session?.name && session?.role) {
          const { roomId, name, role, spectatorToken } = session;
          socket.emit('JOIN_ROOM', { roomId, name, role, spectatorToken: spectatorToken || null }, (res) => {
            if (res.error) {
              clearSession();
              setState((s) => ({ ...s, error: res.error }));
            } else {
              setState((s) => ({
                ...s,
                roomId: res.roomId,
                playerId: res.playerId,
                role: res.role,
                spectatorToken: res.spectatorToken || session.spectatorToken || null,
                error: null,
              }));
            }
          });
        }
      }
    };
    const onDisconnect = () => {
      setState((s) => ({ ...s, connected: false }));
      reconnectedRef.current = false; // allow re-join on next connect
    };
    const onRoomState = (payload) => {
      setState((s) => ({
        ...s,
        roomId: payload.roomId,
        gameState: payload.gameState,
        players: payload.players,
        scores: payload.scores,
        history: payload.history || [],
      }));
    };

    const onKicked = () => {
      clearSession();
      setState({ ...INITIAL_STATE, connected: true, kicked: true });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('ROOM_STATE', onRoomState);
    socket.on('KICKED', onKicked);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('ROOM_STATE', onRoomState);
      socket.off('KICKED', onKicked);
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────

  const createRoom = useCallback((name) => {
    socket.emit('CREATE_ROOM', { name }, (res) => {
      if (res.error) {
        setState((s) => ({ ...s, error: res.error }));
      } else {
        saveSession({ roomId: res.roomId, name, role: res.role, spectatorToken: res.spectatorToken || null });
        setState((s) => ({
          ...s,
          roomId: res.roomId,
          playerId: res.playerId,
          role: res.role,
          spectatorToken: res.spectatorToken || null,
          error: null,
        }));
      }
    });
  }, []);

  const joinRoom = useCallback((roomId, name, role = 'player', spectatorToken = null) => {
    socket.emit('JOIN_ROOM', { roomId, name, role, spectatorToken }, (res) => {
      if (res.error) {
        setState((s) => ({ ...s, error: res.error }));
      } else {
        saveSession({ roomId: res.roomId, name, role: res.role, spectatorToken: spectatorToken || null });
        setState((s) => ({
          ...s,
          roomId: res.roomId,
          playerId: res.playerId,
          role: res.role,
          spectatorToken: res.spectatorToken || spectatorToken || null,
          error: null,
        }));
      }
    });
  }, []);

  const buzzPress = useCallback(() => {
    socket.emit('BUZZ_PRESS');
  }, []);

  const textUpdate = useCallback((text) => {
    // Throttle: max every 100ms
    if (throttleRef.current) return;
    socket.emit('TEXT_UPDATE', { text });
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
    }, 100);
  }, []);

  const submitPayload = useCallback((payload) => {
    socket.emit('SUBMIT_PAYLOAD', { payload });
  }, []);

  // QM-only actions
  const toggleInput = useCallback((enabled) => {
    socket.emit('TOGGLE_INPUT', { enabled });
  }, []);

  const resetRoom = useCallback(() => {
    socket.emit('RESET_ROOM');
  }, []);

  const clearTexts = useCallback(() => {
    socket.emit('CLEAR_TEXTS');
  }, []);

  const changeMode = useCallback((mode) => {
    socket.emit('CHANGE_MODE', { mode });
  }, []);

  const updateScore = useCallback((playerId, delta) => {
    socket.emit('UPDATE_SCORE', { playerId, delta });
  }, []);

  const setScore = useCallback((playerId, score) => {
    socket.emit('SET_SCORE', { playerId, score });
  }, []);

  const toggleRaceMode = useCallback((enabled) => {
    socket.emit('TOGGLE_RACE_MODE', { enabled });
  }, []);

  const toggleShowBuzz = useCallback((enabled) => {
    socket.emit('TOGGLE_SHOW_BUZZ', { enabled });
  }, []);

  const setMcOptions = useCallback((options) => {
    socket.emit('SET_MC_OPTIONS', { options });
  }, []);

  const lockMcOptions = useCallback(() => {
    socket.emit('LOCK_MC_OPTIONS');
  }, []);

  const setSliderRange = useCallback((min, max) => {
    socket.emit('SET_SLIDER_RANGE', { min, max });
  }, []);

  const lockSliderRange = useCallback(() => {
    socket.emit('LOCK_SLIDER_RANGE');
  }, []);

  const previewAnswer = useCallback((value) => {
    socket.emit('PREVIEW_ANSWER', { value });
  }, []);

  const submitAnswer = useCallback((value) => {
    socket.emit('SUBMIT_ANSWER', { value });
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit('LEAVE_ROOM');
    clearSession();
    setState({ ...INITIAL_STATE, connected: socket.connected });
  }, []);

  const kickPlayer = useCallback((targetPlayerId) => {
    socket.emit('KICK_PLAYER', { targetPlayerId });
  }, []);

  const resetPlayer = useCallback((targetPlayerId) => {
    socket.emit('RESET_PLAYER', { targetPlayerId });
  }, []);

  const setSound = useCallback((soundId) => {
    socket.emit('SET_SOUND', { soundId });
  }, []);

  const clearKicked = useCallback(() => {
    setState((s) => ({ ...s, kicked: false }));
  }, []);

  const hasSession = useCallback(() => {
    return !!loadSession();
  }, []);

  const value = {
    ...state,
    createRoom,
    joinRoom,
    buzzPress,
    textUpdate,
    submitPayload,
    toggleInput,
    resetRoom,
    clearTexts,
    changeMode,
    updateScore,
    setScore,
    toggleRaceMode,
    toggleShowBuzz,
    setMcOptions,
    lockMcOptions,
    setSliderRange,
    lockSliderRange,
    previewAnswer,
    submitAnswer,
    leaveRoom,
    kickPlayer,
    resetPlayer,
    setSound,
    clearKicked,
    hasSession,
  };

  return <QuizContext.Provider value={value}>{children}</QuizContext.Provider>;
}

export default function useQuizStore() {
  const ctx = useContext(QuizContext);
  if (!ctx) {
    throw new Error('useQuizStore must be used within a <QuizProvider>');
  }
  return ctx;
}
