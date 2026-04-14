import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';

const INITIAL_STATE = {
  connected: false,
  roomId: null,
  playerId: null,
  role: null,
  spectatorToken: null,
  sessionToken: null,
  kicked: false,
  gameState: {
    currentMode: 'BUZZER',
    inputEnabled: false,
    buzzes: [],
    lockedOut: false,
  },
  players: [],
  scores: {},
  teams: {},
  playerTeams: {},
  teamsEnabled: false,
  teamScores: {},
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
  const pendingTextRef = useRef(null);
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    const onConnect = () => {
      setState((s) => ({ ...s, connected: true }));

      // Auto-rejoin on reconnect / page refresh
      if (!reconnectedRef.current) {
        reconnectedRef.current = true;
        const session = loadSession();
        if (session?.roomId && session?.sessionToken) {
          // Try session-based rejoin first (preserves playerId, scores, etc.)
          socket.emit('REJOIN_ROOM', { roomId: session.roomId, sessionToken: session.sessionToken }, (res) => {
            if (res.error) {
              // Session expired or room gone — try a fresh join if we have name+role
              if (session.name && session.role) {
                socket.emit('JOIN_ROOM', { roomId: session.roomId, name: session.name, role: session.role, spectatorToken: session.spectatorToken || null }, (res2) => {
                  if (res2.error) {
                    clearSession();
                    setState((s) => ({ ...s, error: res2.error }));
                  } else {
                    saveSession({ ...session, roomId: res2.roomId, sessionToken: res2.sessionToken, role: res2.role });
                    setState((s) => ({
                      ...s,
                      roomId: res2.roomId,
                      playerId: res2.playerId,
                      role: res2.role,
                      sessionToken: res2.sessionToken,
                      spectatorToken: res2.spectatorToken || session.spectatorToken || null,
                      error: null,
                    }));
                  }
                });
              } else {
                clearSession();
                setState((s) => ({ ...s, error: res.error }));
              }
            } else {
              saveSession({ ...session, roomId: res.roomId, sessionToken: res.sessionToken });
              setState((s) => ({
                ...s,
                roomId: res.roomId,
                playerId: res.playerId,
                role: res.role,
                sessionToken: res.sessionToken,
                spectatorToken: res.spectatorToken || session.spectatorToken || null,
                error: null,
              }));
            }
          });
        } else if (session?.roomId && session?.name && session?.role) {
          // No sessionToken stored (legacy) — do a fresh join
          const { roomId, name, role, spectatorToken } = session;
          socket.emit('JOIN_ROOM', { roomId, name, role, spectatorToken: spectatorToken || null }, (res) => {
            if (res.error) {
              clearSession();
              setState((s) => ({ ...s, error: res.error }));
            } else {
              saveSession({ ...session, roomId: res.roomId, sessionToken: res.sessionToken, role: res.role });
              setState((s) => ({
                ...s,
                roomId: res.roomId,
                playerId: res.playerId,
                role: res.role,
                sessionToken: res.sessionToken,
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
        teams: payload.teams || {},
        playerTeams: payload.playerTeams || {},
        teamsEnabled: payload.teamsEnabled || false,
        teamScores: payload.teamScores || {},
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
        saveSession({ roomId: res.roomId, name, role: res.role, spectatorToken: res.spectatorToken || null, sessionToken: res.sessionToken });
        setState((s) => ({
          ...s,
          roomId: res.roomId,
          playerId: res.playerId,
          role: res.role,
          spectatorToken: res.spectatorToken || null,
          sessionToken: res.sessionToken,
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
        saveSession({ roomId: res.roomId, name, role: res.role, spectatorToken: spectatorToken || null, sessionToken: res.sessionToken });
        setState((s) => ({
          ...s,
          roomId: res.roomId,
          playerId: res.playerId,
          role: res.role,
          spectatorToken: res.spectatorToken || spectatorToken || null,
          sessionToken: res.sessionToken,
          error: null,
        }));
      }
    });
  }, []);

  const buzzPress = useCallback(() => {
    socket.emit('BUZZ_PRESS');
  }, []);

  const textUpdate = useCallback((text) => {
    // Throttle: max every 100ms, but always flush the latest value
    if (throttleRef.current) {
      pendingTextRef.current = text;
      return;
    }
    socket.emit('TEXT_UPDATE', { text });
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      if (pendingTextRef.current !== null) {
        socket.emit('TEXT_UPDATE', { text: pendingTextRef.current });
        pendingTextRef.current = null;
      }
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

  const toggleTeams = useCallback((enabled) => {
    socket.emit('TOGGLE_TEAMS', { enabled });
  }, []);

  const setTeam = useCallback((targetPlayerId, teamId) => {
    socket.emit('SET_TEAM', { targetPlayerId, teamId });
  }, []);

  const createTeam = useCallback((name) => {
    socket.emit('CREATE_TEAM', { name });
  }, []);

  const renameTeam = useCallback((teamId, name) => {
    socket.emit('RENAME_TEAM', { teamId, name });
  }, []);

  const removeTeam = useCallback((teamId) => {
    socket.emit('REMOVE_TEAM', { teamId });
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

  const setGuessType = useCallback((type) => {
    socket.emit('SET_GUESS_TYPE', { type });
  }, []);

  const setGuessSolution = useCallback((value) => {
    socket.emit('SET_GUESS_SOLUTION', { value });
  }, []);

  const revealGuessWinner = useCallback(() => {
    socket.emit('REVEAL_GUESS_WINNER');
  }, []);

  const setTimerMode = useCallback((mode) => {
    socket.emit('SET_TIMER_MODE', { mode });
  }, []);

  const setTimerDuration = useCallback((duration) => {
    socket.emit('SET_TIMER_DURATION', { duration });
  }, []);

  const startTimer = useCallback(() => {
    socket.emit('START_TIMER');
  }, []);

  const stopTimer = useCallback(() => {
    socket.emit('STOP_TIMER');
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

  const setPlayerSound = useCallback((targetPlayerId, soundId) => {
    socket.emit('SET_PLAYER_SOUND', { targetPlayerId, soundId });
  }, []);

  const generateTakeoverToken = useCallback((targetPlayerId) => {
    return new Promise((resolve, reject) => {
      socket.emit('GENERATE_TAKEOVER_TOKEN', { targetPlayerId }, (res) => {
        if (res.error) reject(new Error(res.error));
        else resolve(res.takeoverToken);
      });
    });
  }, []);

  const takeoverSession = useCallback((roomId, takeoverToken) => {
    return new Promise((resolve, reject) => {
      socket.emit('TAKEOVER_SESSION', { roomId, takeoverToken }, (res) => {
        if (res.error) {
          setState((s) => ({ ...s, error: res.error }));
          reject(new Error(res.error));
        } else {
          saveSession({ roomId: res.roomId, name: '', role: res.role, spectatorToken: res.spectatorToken || null, sessionToken: res.sessionToken });
          setState((s) => ({
            ...s,
            roomId: res.roomId,
            playerId: res.playerId,
            role: res.role,
            sessionToken: res.sessionToken,
            spectatorToken: res.spectatorToken || null,
            error: null,
          }));
          resolve(res);
        }
      });
    });
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
    toggleTeams,
    setTeam,
    createTeam,
    renameTeam,
    removeTeam,
    setMcOptions,
    lockMcOptions,
    setSliderRange,
    lockSliderRange,
    setGuessType,
    setGuessSolution,
    revealGuessWinner,
    setTimerMode,
    setTimerDuration,
    startTimer,
    stopTimer,
    previewAnswer,
    submitAnswer,
    leaveRoom,
    kickPlayer,
    resetPlayer,
    setSound,
    setPlayerSound,
    generateTakeoverToken,
    takeoverSession,
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
