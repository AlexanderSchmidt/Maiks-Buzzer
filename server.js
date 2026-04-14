const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const teamNamesData = require('./src/teamNames.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://buzzer.saug.cloud',
    methods: ['GET', 'POST'],
  },
});

// Serve static files from the Vite build output
app.use(express.static(path.join(__dirname, 'dist')));

// ─── Random Team Name Generator ──────────────────────────────────────────────
function generateTeamName(existingNames = []) {
  const existing = new Set(existingNames);
  for (let i = 0; i < 100; i++) {
    const adj = teamNamesData.adjectives[Math.floor(Math.random() * teamNamesData.adjectives.length)];
    const noun = teamNamesData.nouns[Math.floor(Math.random() * teamNamesData.nouns.length)];
    const name = `${adj} ${noun}`;
    if (!existing.has(name)) return name;
  }
  return `Team ${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

// ─── In-Memory Room Store ────────────────────────────────────────────────────
const rooms = new Map();
const DISCONNECT_GRACE_MS = 600_000; // 10 minutes grace period for reconnection

function createRoom() {
  const id = uuidv4().slice(0, 6).toUpperCase();
  const spectatorToken = uuidv4().slice(0, 12);
  const room = {
    id,
    spectatorToken,
    gameState: {
      currentMode: 'BUZZER', // BUZZER | MULTIPLE_CHOICE | GUESS
      raceMode: true,      // false = "First wins" (lock after 1st), true = "Race" (all can buzz)
      showBuzzToPlayers: false, // whether players can see who buzzed first
      inputEnabled: true,
      buzzes: [],           // [{ playerId, playerName, timestamp }] ordered by time
      lockedOut: false,     // true after first buzz in "First wins" mode

      // Multiple Choice
      mcOptions: ['', ''],  // 2-4 option strings set by QM
      mcOptionsLocked: false, // true once QM confirms → shown to players

      // Guess
      guessType: 'number',   // 'number' | 'date'
      sliderMin: 0,
      sliderMax: 100,
      sliderLocked: false,  // true once QM confirms → shown to players
      guessSolution: null,   // number or ISO date string — the correct answer
      guessWinnerId: null,   // playerId of the closest answer

      // Player answers (for MC, Guess) { playerId: { preview, submitted, value } }
      playerAnswers: {},
      clearGeneration: 0,

      // Death Timer
      timerMode: 'off',       // 'off' | 'enforced' | 'enforced_after_first'
      timerDuration: 30,      // seconds
      timerStartedAt: null,   // epoch ms when timer was started (null = not running)
      timerExpired: false,    // true once timer has run out
    },
    players: new Map(),           // socketId → { id, name, role, text, score, sessionToken, joinOrder }
    disconnectedPlayers: new Map(), // sessionToken → { player, timer, oldSocketId }
    takeoverTokens: new Map(),      // takeoverToken → sessionToken (one-time takeover links)
    nextJoinOrder: 1,               // monotonic counter for stable player ordering
    scores: {},                   // playerId → score (persistent across resets)
    teams: {},                    // teamId → { name, color }
    playerTeams: {},              // playerId → teamId
    teamsEnabled: false,          // whether team mode is active
    history: [],                  // [{ id, timestamp, playerId, playerName, action, detail }]
  };
  rooms.set(id, room);
  return room;
}

// ─── Timer helpers ──────────────────────────────────────────────────────
const roomTimers = new Map(); // roomId → setTimeout reference

function clearRoomTimer(roomId) {
  const existing = roomTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    roomTimers.delete(roomId);
  }
}

function startRoomTimer(room) {
  clearRoomTimer(room.id);
  const gs = room.gameState;
  gs.timerStartedAt = Date.now();
  gs.timerExpired = false;
  const timeout = setTimeout(() => {
    gs.timerExpired = true;
    roomTimers.delete(room.id);
    broadcast(room);
  }, gs.timerDuration * 1000);
  roomTimers.set(room.id, timeout);
}

function stopRoomTimer(room) {
  clearRoomTimer(room.id);
  room.gameState.timerStartedAt = null;
  room.gameState.timerExpired = false;
}

function isTimerBlockingInput(gs) {
  if (gs.timerMode === 'off') return false;
  if (gs.timerMode === 'enforced') {
    // Must be running AND not expired
    return !gs.timerStartedAt || gs.timerExpired;
  }
  if (gs.timerMode === 'enforced_after_first') {
    // Before first buzz/submit: allow input (timer not started yet)
    if (!gs.timerStartedAt) return false;
    // After start: block only when expired
    return gs.timerExpired;
  }
  return false;
}

// Find a player across active and disconnected players by sessionToken
function findPlayerBySession(room, sessionToken) {
  for (const [socketId, p] of room.players) {
    if (p.sessionToken === sessionToken) return { player: p, socketId, disconnected: false };
  }
  if (room.disconnectedPlayers.has(sessionToken)) {
    const entry = room.disconnectedPlayers.get(sessionToken);
    return { player: entry.player, socketId: null, disconnected: true, entry };
  }
  return null;
}

// Remove a truly-expired disconnected player from the room
function removeDisconnectedPlayer(room, sessionToken) {
  const entry = room.disconnectedPlayers.get(sessionToken);
  if (!entry) return;
  const playerId = entry.player.id;
  room.disconnectedPlayers.delete(sessionToken);
  // Don't remove scores — they persist for the room's lifetime
  // But do clean up buzzes etc. if desired
  console.log(`[session-expired] player ${entry.player.name} (${playerId}) removed from room ${room.id}`);
  broadcast(room);
}

function getTeamScores(room) {
  const teamScores = {};
  for (const [teamId] of Object.entries(room.teams)) {
    teamScores[teamId] = 0;
  }
  for (const [playerId, teamId] of Object.entries(room.playerTeams)) {
    if (teamScores[teamId] !== undefined) {
      teamScores[teamId] += (room.scores[playerId] ?? 0);
    }
  }
  return teamScores;
}

function getRoomPayload(room) {
  const players = [];
  // Active (connected) players
  for (const [socketId, p] of room.players) {
    players.push({
      socketId,
      id: p.id,
      name: p.name,
      role: p.role,
      text: p.text || '',
      score: room.scores[p.id] ?? 0,
      soundId: p.soundId || 0,
      teamId: room.playerTeams[p.id] || null,
      connected: true,
      joinOrder: p.joinOrder || 0,
    });
  }
  // Disconnected players (in grace period) — still visible but greyed out
  for (const [sessionToken, entry] of room.disconnectedPlayers) {
    const p = entry.player;
    players.push({
      socketId: null,
      id: p.id,
      name: p.name,
      role: p.role,
      text: p.text || '',
      score: room.scores[p.id] ?? 0,
      soundId: p.soundId || 0,
      teamId: room.playerTeams[p.id] || null,
      connected: false,
      joinOrder: p.joinOrder || 0,
    });
  }
  // Sort by join order to keep stable ordering across reconnections
  players.sort((a, b) => a.joinOrder - b.joinOrder);
  return {
    roomId: room.id,
    gameState: room.gameState,
    players,
    scores: room.scores,
    teams: room.teams,
    playerTeams: room.playerTeams,
    teamsEnabled: room.teamsEnabled,
    teamScores: getTeamScores(room),
    history: room.history,
  };
}

function addHistory(room, entry) {
  room.history.push({ id: room.history.length + 1, timestamp: Date.now(), ...entry });
}

function broadcast(room) {
  io.to(room.id).emit('ROOM_STATE', getRoomPayload(room));
}

// ─── Socket.io Handler ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── CREATE_ROOM ────────────────────────────────────────────────────────
  socket.on('CREATE_ROOM', ({ name }, cb) => {
    const room = createRoom();
    const playerId = uuidv4().slice(0, 8);
    const sessionToken = uuidv4();
    room.players.set(socket.id, {
      id: playerId,
      name: name || 'Quiz Master',
      role: 'quizmaster',
      text: '',
      soundId: 0,
      sessionToken,
      joinOrder: room.nextJoinOrder++,
    });
    room.scores[playerId] = 0;
    socket.join(room.id);
    socket.data = { roomId: room.id, playerId, sessionToken };
    addHistory(room, { playerId, playerName: name || 'Quiz Master', action: 'CREATE', detail: 'Created room' });
    broadcast(room);
    if (cb) cb({ roomId: room.id, playerId, role: 'quizmaster', spectatorToken: room.spectatorToken, sessionToken });
  });

  // ── JOIN_ROOM ──────────────────────────────────────────────────────────
  socket.on('JOIN_ROOM', ({ roomId, name, role = 'player', spectatorToken }, cb) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) {
      if (cb) cb({ error: 'Room not found' });
      return;
    }
    // Spectators must provide the correct token
    if (role === 'spectator' && spectatorToken !== room.spectatorToken) {
      if (cb) cb({ error: 'Invalid spectator link' });
      return;
    }
    const playerId = uuidv4().slice(0, 8);
    const sessionToken = uuidv4();
    room.players.set(socket.id, {
      id: playerId,
      name: name || `Player ${room.players.size}`,
      role,
      text: '',
      soundId: 0,
      sessionToken,
      joinOrder: room.nextJoinOrder++,
    });
    if (role === 'player') {
      room.scores[playerId] = 0;
      // Auto-assign to a random team if teams are enabled
      if (room.teamsEnabled) {
        const teamIds = Object.keys(room.teams);
        if (teamIds.length > 0) {
          // Put in the team with fewest players
          const teamCounts = {};
          teamIds.forEach(tid => teamCounts[tid] = 0);
          Object.values(room.playerTeams).forEach(tid => { if (teamCounts[tid] !== undefined) teamCounts[tid]++; });
          const minCount = Math.min(...Object.values(teamCounts));
          const candidates = teamIds.filter(tid => teamCounts[tid] === minCount);
          room.playerTeams[playerId] = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
          // Create a new random team
          const teamId = uuidv4().slice(0, 6);
          room.teams[teamId] = { name: generateTeamName(Object.values(room.teams).map(t => t.name)) };
          room.playerTeams[playerId] = teamId;
        }
      }
    }
    socket.join(room.id);
    socket.data = { roomId: room.id, playerId, sessionToken };
    addHistory(room, { playerId, playerName: name || 'Player', action: 'JOIN', detail: `Joined as ${role}` });
    broadcast(room);
    if (cb) cb({ roomId: room.id, playerId, role, spectatorToken: role === 'quizmaster' ? room.spectatorToken : undefined, sessionToken });
  });

  // ── REJOIN_ROOM (session-based reconnection) ───────────────────────────
  socket.on('REJOIN_ROOM', ({ roomId, sessionToken }, cb) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) {
      if (cb) cb({ error: 'Room not found' });
      return;
    }
    if (!sessionToken) {
      if (cb) cb({ error: 'No session token' });
      return;
    }

    const found = findPlayerBySession(room, sessionToken);
    if (!found) {
      if (cb) cb({ error: 'Session expired' });
      return;
    }

    const { player, disconnected, entry } = found;

    if (disconnected) {
      // Clear the expiry timer
      if (entry.timer) clearTimeout(entry.timer);
      room.disconnectedPlayers.delete(sessionToken);
      // Re-add to active players with the new socket
      room.players.set(socket.id, player);
    } else {
      // Player is still in active map (very fast reconnect / duplicate tab)
      // Remove old socket mapping, add new one
      const oldSocketId = found.socketId;
      if (oldSocketId && oldSocketId !== socket.id) {
        room.players.delete(oldSocketId);
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          oldSocket.leave(room.id);
          oldSocket.data = {};
        }
      }
      room.players.set(socket.id, player);
    }

    socket.join(room.id);
    socket.data = { roomId: room.id, playerId: player.id, sessionToken };

    console.log(`[rejoin] ${player.name} (${player.id}) rejoined room ${room.id}`);
    broadcast(room);
    if (cb) cb({
      roomId: room.id,
      playerId: player.id,
      role: player.role,
      sessionToken,
      spectatorToken: player.role === 'quizmaster' ? room.spectatorToken : undefined,
    });
  });

  // ── GENERATE_TAKEOVER_TOKEN (QM only — creates a one-time link for a disconnected player) ──
  socket.on('GENERATE_TAKEOVER_TOKEN', ({ targetPlayerId }, cb) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) { if (cb) cb({ error: 'Room not found' }); return; }
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') { if (cb) cb({ error: 'Not allowed' }); return; }

    // Find the disconnected player by playerId
    let targetSessionToken = null;
    for (const [st, entry] of room.disconnectedPlayers) {
      if (entry.player.id === targetPlayerId) {
        targetSessionToken = st;
        break;
      }
    }
    if (!targetSessionToken) { if (cb) cb({ error: 'Player not found or not disconnected' }); return; }

    // Invalidate any existing takeover token for this session
    for (const [tok, st] of room.takeoverTokens) {
      if (st === targetSessionToken) { room.takeoverTokens.delete(tok); break; }
    }

    const takeoverToken = uuidv4();
    room.takeoverTokens.set(takeoverToken, targetSessionToken);
    console.log(`[takeover] token generated for ${targetPlayerId} in room ${room.id}`);
    if (cb) cb({ takeoverToken });
  });

  // ── TAKEOVER_SESSION (anyone with a valid takeover token) ──────────────
  socket.on('TAKEOVER_SESSION', ({ roomId, takeoverToken }, cb) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) { if (cb) cb({ error: 'Room not found' }); return; }
    if (!takeoverToken || !room.takeoverTokens.has(takeoverToken)) {
      if (cb) cb({ error: 'Invalid or expired takeover link' });
      return;
    }

    const sessionToken = room.takeoverTokens.get(takeoverToken);
    room.takeoverTokens.delete(takeoverToken); // one-time use

    const entry = room.disconnectedPlayers.get(sessionToken);
    if (!entry) {
      if (cb) cb({ error: 'Player already reconnected or removed' });
      return;
    }

    // Clear the expiry timer and restore the player
    if (entry.timer) clearTimeout(entry.timer);
    room.disconnectedPlayers.delete(sessionToken);

    const takenOverPlayer = entry.player;
    // Generate a NEW session token for the new owner
    const newSessionToken = uuidv4();
    takenOverPlayer.sessionToken = newSessionToken;

    room.players.set(socket.id, takenOverPlayer);
    socket.join(room.id);
    socket.data = { roomId: room.id, playerId: takenOverPlayer.id, sessionToken: newSessionToken };

    console.log(`[takeover] ${takenOverPlayer.name} (${takenOverPlayer.id}) taken over by socket ${socket.id} in room ${room.id}`);
    addHistory(room, { playerId: takenOverPlayer.id, playerName: takenOverPlayer.name, action: 'TAKEOVER', detail: `Session taken over` });
    broadcast(room);
    if (cb) cb({
      roomId: room.id,
      playerId: takenOverPlayer.id,
      role: takenOverPlayer.role,
      sessionToken: newSessionToken,
      spectatorToken: takenOverPlayer.role === 'quizmaster' ? room.spectatorToken : undefined,
    });
  });

  // ── BUZZ_PRESS (Server-authoritative) ──────────────────────────────────
  socket.on('BUZZ_PRESS', () => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const gs = room.gameState;
    if (gs.currentMode !== 'BUZZER') return;
    if (isTimerBlockingInput(gs)) return;

    // In "First wins" mode, block if already locked out
    if (!gs.raceMode && gs.lockedOut) return;

    // Check if this player already buzzed
    if (gs.buzzes.find((b) => b.playerId === playerId)) return;

    const player = room.players.get(socket.id);
    if (!player || player.role !== 'player') return;

    gs.buzzes.push({
      playerId,
      playerName: player.name,
      timestamp: Date.now(),
      soundId: player.soundId || 0,
    });

    // Auto-start timer on first buzz in "enforced_after_first" mode
    if (gs.timerMode === 'enforced_after_first' && !gs.timerStartedAt && gs.buzzes.length === 1) {
      startRoomTimer(room);
    }

    // In "First wins" mode, lock out after first buzz
    if (!gs.raceMode && gs.buzzes.length === 1) {
      gs.lockedOut = true;
    }

    addHistory(room, { playerId, playerName: player.name, action: 'BUZZ', detail: `Buzzed #${gs.buzzes.length}` });

    // Auto-stop timer when all active players have buzzed
    if (gs.timerStartedAt && !gs.timerExpired) {
      const activePlayers = [...room.players.values()].filter(p => p.role === 'player');
      const allBuzzed = activePlayers.length > 0 && activePlayers.every(p =>
        gs.buzzes.find(b => b.playerId === p.id)
      );
      if (allBuzzed) {
        stopRoomTimer(room);
      }
    }

    broadcast(room);
  });

  // ── SET_SOUND ──────────────────────────────────────────────────────────
  socket.on('SET_SOUND', ({ soundId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.soundId = typeof soundId === 'number' ? Math.max(0, Math.min(9, soundId)) : 0;
    broadcast(room);
  });

  // ── SET_PLAYER_SOUND (QM assigns sound to a specific player) ──────────
  socket.on('SET_PLAYER_SOUND', ({ targetPlayerId, soundId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    const resolvedSoundId = typeof soundId === 'number' ? Math.max(1, Math.min(9, soundId)) : 1;
    // Find target in active players
    for (const [, p] of room.players) {
      if (p.id === targetPlayerId) {
        p.soundId = resolvedSoundId;
        broadcast(room);
        return;
      }
    }
    // Also check disconnected players
    for (const [, entry] of room.disconnectedPlayers) {
      if (entry.player.id === targetPlayerId) {
        entry.player.soundId = resolvedSoundId;
        broadcast(room);
        return;
      }
    }
  });

  // ── TEXT_UPDATE (throttled client-side, processed here) ─────────────────
  socket.on('TEXT_UPDATE', ({ text }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'player') return;
    if (!room.gameState.inputEnabled) return;

    player.text = typeof text === 'string' ? text.slice(0, 500) : '';
    broadcast(room);
  });

  // ── SUBMIT_PAYLOAD (generic answer submission) ─────────────────────────
  socket.on('SUBMIT_PAYLOAD', ({ payload }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'player') return;

    // Forward the payload to the quiz master(s) and spectators
    io.to(room.id).emit('PLAYER_PAYLOAD', {
      playerId,
      playerName: player.name,
      mode: room.gameState.currentMode,
      payload,
      timestamp: Date.now(),
    });
  });

  // ── QM Commands ────────────────────────────────────────────────────────
  socket.on('TOGGLE_INPUT', ({ enabled }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.inputEnabled = !!enabled;
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'TOGGLE_INPUT', detail: enabled ? 'Input enabled' : 'Input disabled' });
    broadcast(room);
  });

  socket.on('RESET_ROOM', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    room.gameState.buzzes = [];
    room.gameState.lockedOut = false;
    room.gameState.mcOptionsLocked = false;
    room.gameState.sliderLocked = false;
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.playerAnswers = {};
    room.gameState.clearGeneration = (room.gameState.clearGeneration || 0) + 1;
    stopRoomTimer(room);
    // Clear all player text
    for (const [, p] of room.players) {
      p.text = '';
    }
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'RESET', detail: 'Reset all' });
    broadcast(room);
  });

  socket.on('CLEAR_TEXTS', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    for (const [, p] of room.players) {
      p.text = '';
    }
    room.gameState.playerAnswers = {};
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.clearGeneration = (room.gameState.clearGeneration || 0) + 1;
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'CLEAR', detail: 'Cleared all inputs' });
    broadcast(room);
  });

  socket.on('CHANGE_MODE', ({ mode }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    const validModes = ['BUZZER', 'MULTIPLE_CHOICE', 'GUESS'];
    if (!validModes.includes(mode)) return;

    room.gameState.currentMode = mode;
    room.gameState.buzzes = [];
    room.gameState.lockedOut = false;
    room.gameState.mcOptionsLocked = false;
    room.gameState.sliderLocked = false;
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.playerAnswers = {};
    stopRoomTimer(room);
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'CHANGE_MODE', detail: `Changed to ${mode}` });
    broadcast(room);
  });

  // ── Death Timer: QM configures timer ───────────────────────────────────
  socket.on('SET_TIMER_MODE', ({ mode }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    const validModes = ['off', 'not_enforced', 'enforced', 'enforced_after_first'];
    if (!validModes.includes(mode)) return;
    room.gameState.timerMode = mode;
    stopRoomTimer(room);
    broadcast(room);
  });

  socket.on('SET_TIMER_DURATION', ({ duration }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    const d = Math.max(5, Math.min(300, Number(duration) || 30));
    room.gameState.timerDuration = d;
    stopRoomTimer(room);
    broadcast(room);
  });

  socket.on('START_TIMER', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (room.gameState.timerMode === 'off') return;
    startRoomTimer(room);
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'START_TIMER', detail: `Timer started (${room.gameState.timerDuration}s)` });
    broadcast(room);
  });

  socket.on('STOP_TIMER', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    stopRoomTimer(room);
    broadcast(room);
  });

  // ── Show Buzz to Players Toggle ────────────────────────────────────────
  socket.on('TOGGLE_SHOW_BUZZ', ({ enabled }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.showBuzzToPlayers = !!enabled;
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'TOGGLE_SHOW_BUZZ', detail: enabled ? 'Buzz visible to players' : 'Buzz hidden from players' });
    broadcast(room);
  });

  // ── Race Mode Toggle ───────────────────────────────────────────────────
  socket.on('TOGGLE_RACE_MODE', ({ enabled }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.raceMode = !!enabled;
    // Reset buzzes when toggling mode
    room.gameState.buzzes = [];
    room.gameState.lockedOut = false;
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'TOGGLE_RACE', detail: enabled ? 'Race Mode' : 'First Wins' });
    broadcast(room);
  });

  // ── Multiple Choice: QM sets options ───────────────────────────────────
  socket.on('SET_MC_OPTIONS', ({ options }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) return;
    room.gameState.mcOptions = options.map((o) => String(o).slice(0, 200));
    room.gameState.mcOptionsLocked = false;
    room.gameState.playerAnswers = {};
    broadcast(room);
  });

  // ── Multiple Choice: QM locks/confirms options ─────────────────────────
  socket.on('LOCK_MC_OPTIONS', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    // Validate at least 2 non-empty options
    const validOptions = room.gameState.mcOptions.filter((o) => o.trim());
    if (validOptions.length < 2) return;
    room.gameState.mcOptionsLocked = true;
    room.gameState.playerAnswers = {};
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'LOCK_MC', detail: `Options: ${room.gameState.mcOptions.filter(o => o.trim()).join(', ')}` });
    broadcast(room);
  });

  // ── Guess: QM sets guess type ──────────────────────────────────────────
  socket.on('SET_GUESS_TYPE', ({ type }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (type !== 'number' && type !== 'date') return;
    room.gameState.guessType = type;
    room.gameState.sliderLocked = false;
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.playerAnswers = {};
    room.gameState.buzzes = [];
    if (type === 'number') {
      room.gameState.sliderMin = 0;
      room.gameState.sliderMax = 100;
    } else {
      room.gameState.sliderMin = new Date().toISOString().slice(0, 10);
      room.gameState.sliderMax = new Date().toISOString().slice(0, 10);
    }
    broadcast(room);
  });

  // ── Guess: QM sets range ──────────────────────────────────────────────
  socket.on('SET_SLIDER_RANGE', ({ min, max }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (room.gameState.guessType === 'date') {
      room.gameState.sliderMin = String(min);
      room.gameState.sliderMax = String(max);
    } else {
      room.gameState.sliderMin = Number(min) || 0;
      room.gameState.sliderMax = Number(max) || 100;
    }
    room.gameState.sliderLocked = false;
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.playerAnswers = {};
    broadcast(room);
  });

  // ── Guess: QM locks/confirms range ─────────────────────────────────────
  socket.on('LOCK_SLIDER_RANGE', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.sliderLocked = true;
    room.gameState.guessSolution = null;
    room.gameState.guessWinnerId = null;
    room.gameState.playerAnswers = {};
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'LOCK_GUESS', detail: `Range: ${room.gameState.sliderMin}–${room.gameState.sliderMax}` });
    broadcast(room);
  });

  // ── Guess: QM sets the correct solution ────────────────────────────────
  socket.on('SET_GUESS_SOLUTION', ({ value }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.guessSolution = value;
    room.gameState.guessWinnerId = null;
    broadcast(room);
  });

  // ── Guess: QM reveals the closest answer (winner) ──────────────────────
  socket.on('REVEAL_GUESS_WINNER', () => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    const gs = room.gameState;
    if (gs.guessSolution === null || gs.guessSolution === undefined) return;

    // Collect submitted answers
    const submitted = Object.entries(gs.playerAnswers)
      .filter(([, ans]) => ans.submitted)
      .map(([pid, ans]) => ({ pid, value: ans.value }));
    if (submitted.length === 0) return;

    // Calculate distance
    const solutionNum = gs.guessType === 'date'
      ? new Date(gs.guessSolution).getTime()
      : Number(gs.guessSolution);

    let bestPid = null;
    let bestDist = Infinity;
    let bestBuzzIdx = Infinity;

    for (const { pid, value } of submitted) {
      const valNum = gs.guessType === 'date'
        ? new Date(value).getTime()
        : Number(value);
      const dist = Math.abs(valNum - solutionNum);
      const buzzIdx = gs.buzzes.findIndex((b) => b.playerId === pid);
      if (dist < bestDist || (dist === bestDist && buzzIdx < bestBuzzIdx)) {
        bestDist = dist;
        bestPid = pid;
        bestBuzzIdx = buzzIdx;
      }
    }

    gs.guessWinnerId = bestPid;
    const winnerName = [...room.players.values()].find(p => p.id === bestPid)?.name || bestPid;
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'REVEAL_WINNER', detail: `Winner: ${winnerName} (solution: ${gs.guessSolution})` });
    broadcast(room);
  });

  // ── PREVIEW_ANSWER: live preview of player's selection ─────────────────
  socket.on('PREVIEW_ANSWER', ({ value }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'player') return;
    const gs = room.gameState;

    if (!gs.playerAnswers[playerId]) {
      gs.playerAnswers[playerId] = { preview: null, value: null, submitted: false };
    }
    gs.playerAnswers[playerId].preview = value;
    broadcast(room);
  });

  // ── SUBMIT_ANSWER: final confirmed answer ──────────────────────────────
  socket.on('SUBMIT_ANSWER', ({ value }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'player') return;
    const gs = room.gameState;

    // Block if enforced timer is not running or expired
    if (isTimerBlockingInput(gs)) return;

    // In solo (non-race) mode, block submit if someone else already submitted
    if (!gs.raceMode) {
      const someoneElseSubmitted = Object.entries(gs.playerAnswers).some(
        ([pid, ans]) => pid !== playerId && ans.submitted
      );
      if (someoneElseSubmitted) return;
    }

    if (!gs.playerAnswers[playerId]) {
      gs.playerAnswers[playerId] = { preview: null, value: null, submitted: false };
    }

    // Validate guess answers are within range
    if (gs.currentMode === 'GUESS' && gs.sliderLocked) {
      if (gs.guessType === 'date') {
        if (typeof value === 'string' && (value < gs.sliderMin || value > gs.sliderMax)) return;
      } else {
        const num = Number(value);
        if (isNaN(num) || num < gs.sliderMin || num > gs.sliderMax) return;
      }
    }

    gs.playerAnswers[playerId].value = value;
    gs.playerAnswers[playerId].preview = value;
    gs.playerAnswers[playerId].submitted = true;

    // Auto-start timer on first submit in "enforced_after_first" mode
    if (gs.timerMode === 'enforced_after_first' && !gs.timerStartedAt) {
      startRoomTimer(room);
    }

    addHistory(room, { playerId, playerName: player.name, action: 'SUBMIT', detail: `Answer: ${JSON.stringify(value)}` });

    // Also record buzz timestamp for race mode sorting
    if (!gs.buzzes.find((b) => b.playerId === playerId)) {
      gs.buzzes.push({
        playerId,
        playerName: player.name,
        timestamp: Date.now(),
      });
    }

    // Auto-stop timer when all active players have submitted
    if (gs.timerStartedAt && !gs.timerExpired) {
      const activePlayers = [...room.players.values()].filter(p => p.role === 'player');
      const allSubmitted = activePlayers.length > 0 && activePlayers.every(p =>
        gs.playerAnswers[p.id]?.submitted
      );
      if (allSubmitted) {
        stopRoomTimer(room);
      }
    }

    broadcast(room);
  });

  socket.on('UPDATE_SCORE', ({ playerId: targetId, delta }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    if (room.scores[targetId] !== undefined) {
      room.scores[targetId] += delta;
      const target = [...room.players.values()].find(p => p.id === targetId);
      addHistory(room, { playerId: player.id, playerName: player.name, action: 'SCORE', detail: `${target?.name || targetId}: ${delta > 0 ? '+' : ''}${delta} → ${room.scores[targetId]}` });
    }
    broadcast(room);
  });

  socket.on('SET_SCORE', ({ playerId: targetId, score }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    if (room.scores[targetId] !== undefined) {
      room.scores[targetId] = score;
    }
    broadcast(room);
  });

  // ── TOGGLE_TEAMS (QM only) ───────────────────────────────────────────
  socket.on('TOGGLE_TEAMS', ({ enabled }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.teamsEnabled = !!enabled;
    if (enabled) {
      // Auto-assign all unassigned players to random teams
      const playerIds = [...room.players.values()].filter(p => p.role === 'player').map(p => p.id);
      const unassigned = playerIds.filter(pid => !room.playerTeams[pid]);
      if (unassigned.length > 0 && Object.keys(room.teams).length === 0) {
        // Create 2 default teams
        for (let i = 0; i < 2; i++) {
          const teamId = uuidv4().slice(0, 6);
          room.teams[teamId] = { name: generateTeamName(Object.values(room.teams).map(t => t.name)) };
        }
      }
      const teamIds = Object.keys(room.teams);
      if (teamIds.length > 0) {
        unassigned.forEach((pid, i) => {
          room.playerTeams[pid] = teamIds[i % teamIds.length];
        });
      }
    }
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'TOGGLE_TEAMS', detail: enabled ? 'Teams enabled' : 'Teams disabled' });
    broadcast(room);
  });

  // ── SET_TEAM: QM assigns a player to a team ────────────────────────────
  socket.on('SET_TEAM', ({ targetPlayerId, teamId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (!room.teams[teamId]) return;
    room.playerTeams[targetPlayerId] = teamId;
    const target = [...room.players.values()].find(p => p.id === targetPlayerId);
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'SET_TEAM', detail: `${target?.name || targetPlayerId} → ${room.teams[teamId].name}` });
    broadcast(room);
  });

  // ── CREATE_TEAM: QM creates a new team ─────────────────────────────────
  socket.on('CREATE_TEAM', ({ name }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    const teamId = uuidv4().slice(0, 6);
    const teamName = (name && name.trim()) ? name.trim().slice(0, 40) : generateTeamName(Object.values(room.teams).map(t => t.name));
    room.teams[teamId] = { name: teamName };
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'CREATE_TEAM', detail: `Created team "${teamName}"` });
    broadcast(room);
  });

  // ── RENAME_TEAM: QM renames a team ─────────────────────────────────────
  socket.on('RENAME_TEAM', ({ teamId, name }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (!room.teams[teamId]) return;
    const newName = (name && name.trim()) ? name.trim().slice(0, 40) : room.teams[teamId].name;
    room.teams[teamId].name = newName;
    broadcast(room);
  });

  // ── REMOVE_TEAM: QM removes a team (unassigns its players) ────────────
  socket.on('REMOVE_TEAM', ({ teamId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    if (!room.teams[teamId]) return;
    const teamName = room.teams[teamId].name;
    // Unassign players from this team
    for (const [pid, tid] of Object.entries(room.playerTeams)) {
      if (tid === teamId) delete room.playerTeams[pid];
    }
    delete room.teams[teamId];
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'REMOVE_TEAM', detail: `Removed team "${teamName}"` });
    broadcast(room);
  });

  // ── KICK_PLAYER (QM only) ──────────────────────────────────────────────
  socket.on('KICK_PLAYER', ({ targetPlayerId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    // Find the target in active players
    let targetSocketId = null;
    let targetName = null;
    let targetSessionToken = null;
    for (const [sid, p] of room.players) {
      if (p.id === targetPlayerId) {
        targetSocketId = sid;
        targetName = p.name;
        targetSessionToken = p.sessionToken;
        break;
      }
    }

    // Also check disconnected players
    if (!targetSocketId) {
      for (const [st, entry] of room.disconnectedPlayers) {
        if (entry.player.id === targetPlayerId) {
          targetName = entry.player.name;
          targetSessionToken = st;
          // Clear grace timer and remove
          if (entry.timer) clearTimeout(entry.timer);
          room.disconnectedPlayers.delete(st);
          break;
        }
      }
      if (!targetName) return;
    }

    addHistory(room, { playerId: player.id, playerName: player.name, action: 'KICK', detail: `Kicked ${targetName}` });

    if (targetSocketId) {
      // Notify the kicked player before removing
      io.to(targetSocketId).emit('KICKED');
      // Remove from room
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(room.id);
        targetSocket.data = {};
      }
      room.players.delete(targetSocketId);
    }
    // Also remove from disconnected pool if present
    if (targetSessionToken && room.disconnectedPlayers.has(targetSessionToken)) {
      const entry = room.disconnectedPlayers.get(targetSessionToken);
      if (entry.timer) clearTimeout(entry.timer);
      room.disconnectedPlayers.delete(targetSessionToken);
    }
    delete room.scores[targetPlayerId];
    delete room.playerTeams[targetPlayerId];
    broadcast(room);
  });

  // ── RESET_PLAYER (QM only) ─────────────────────────────────────────────
  socket.on('RESET_PLAYER', ({ targetPlayerId }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;

    // Find the target player and clear their state
    let targetName = null;
    for (const [, p] of room.players) {
      if (p.id === targetPlayerId) {
        p.text = '';
        targetName = p.name;
        break;
      }
    }
    if (!targetName) return;

    // Remove their buzzes
    room.gameState.buzzes = room.gameState.buzzes.filter((b) => b.playerId !== targetPlayerId);
    // Recalculate lockedOut
    if (!room.gameState.raceMode) {
      room.gameState.lockedOut = room.gameState.buzzes.length > 0;
    }
    // Remove their answer
    delete room.gameState.playerAnswers[targetPlayerId];

    addHistory(room, { playerId: player.id, playerName: player.name, action: 'RESET_PLAYER', detail: `Reset ${targetName}` });
    broadcast(room);
  });

  // ── LEAVE_ROOM ─────────────────────────────────────────────────────────
  socket.on('LEAVE_ROOM', () => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      addHistory(room, { playerId, playerName: player.name, action: 'LEAVE', detail: 'Left the room' });
      // Intentional leave — don't add to disconnectedPlayers
    }
    socket.leave(roomId);
    room.players.delete(socket.id);
    socket.data = {};
    if (room.players.size === 0 && room.disconnectedPlayers.size === 0) {
      rooms.delete(room.id);
      console.log(`[room-deleted] ${room.id}`);
    } else {
      broadcast(room);
    }
  });

  // ── Disconnect (grace period for reconnection) ────────────────────────
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const { roomId, sessionToken } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player && sessionToken) {
      // Move player to disconnected pool with a grace timer
      room.players.delete(socket.id);
      const timer = setTimeout(() => {
        removeDisconnectedPlayer(room, sessionToken);
        // If room is now fully empty, delete it
        if (room.players.size === 0 && room.disconnectedPlayers.size === 0) {
          rooms.delete(room.id);
          console.log(`[room-deleted] ${room.id}`);
        }
      }, DISCONNECT_GRACE_MS);
      room.disconnectedPlayers.set(sessionToken, { player, timer });
      console.log(`[grace-period] ${player.name} (${player.id}) has ${DISCONNECT_GRACE_MS / 1000}s to reconnect`);
      broadcast(room);
    } else {
      room.players.delete(socket.id);
      if (room.players.size === 0 && room.disconnectedPlayers.size === 0) {
        rooms.delete(room.id);
        console.log(`[room-deleted] ${room.id}`);
      } else {
        broadcast(room);
      }
    }
  });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Maik's Buzzer server running on http://localhost:${PORT}`);
});
