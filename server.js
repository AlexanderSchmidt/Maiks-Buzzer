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
    origin: '*',
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

function createRoom() {
  const id = uuidv4().slice(0, 6).toUpperCase();
  const spectatorToken = uuidv4().slice(0, 12);
  const room = {
    id,
    spectatorToken,
    gameState: {
      currentMode: 'BUZZER', // BUZZER | MULTIPLE_CHOICE | GUESS | SEQUENCE
      raceMode: false,      // false = "First wins" (lock after 1st), true = "Race" (all can buzz)
      showBuzzToPlayers: true, // whether players can see who buzzed first
      inputEnabled: false,
      buzzes: [],           // [{ playerId, playerName, timestamp }] ordered by time
      lockedOut: false,     // true after first buzz in "First wins" mode

      // Multiple Choice
      mcOptions: ['', ''],  // 2-4 option strings set by QM
      mcOptionsLocked: false, // true once QM confirms → shown to players

      // Guess
      sliderMin: 0,
      sliderMax: 100,
      sliderLocked: false,  // true once QM confirms → shown to players

      // Player answers (for MC, Guess, Sequence) { playerId: { preview, submitted, value } }
      playerAnswers: {},
      clearGeneration: 0,
    },
    players: new Map(),  // socketId → { id, name, role, text, score }
    scores: {},          // playerId → score (persistent across resets)
    teams: {},           // teamId → { name, color }
    playerTeams: {},     // playerId → teamId
    teamsEnabled: false, // whether team mode is active
    history: [],         // [{ id, timestamp, playerId, playerName, action, detail }]
  };
  rooms.set(id, room);
  return room;
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
    });
  }
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
    room.players.set(socket.id, {
      id: playerId,
      name: name || 'Quiz Master',
      role: 'quizmaster',
      text: '',
      soundId: 0,
    });
    room.scores[playerId] = 0;
    socket.join(room.id);
    socket.data = { roomId: room.id, playerId };
    addHistory(room, { playerId, playerName: name || 'Quiz Master', action: 'CREATE', detail: 'Created room' });
    broadcast(room);
    if (cb) cb({ roomId: room.id, playerId, role: 'quizmaster', spectatorToken: room.spectatorToken });
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
    room.players.set(socket.id, {
      id: playerId,
      name: name || `Player ${room.players.size}`,
      role,
      text: '',
      soundId: 0,
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
    socket.data = { roomId: room.id, playerId };
    addHistory(room, { playerId, playerName: name || 'Player', action: 'JOIN', detail: `Joined as ${role}` });
    broadcast(room);
    if (cb) cb({ roomId: room.id, playerId, role, spectatorToken: role === 'quizmaster' ? room.spectatorToken : undefined });
  });

  // ── BUZZ_PRESS (Server-authoritative) ──────────────────────────────────
  socket.on('BUZZ_PRESS', () => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const gs = room.gameState;
    if (gs.currentMode !== 'BUZZER') return;

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

    // In "First wins" mode, lock out after first buzz
    if (!gs.raceMode && gs.buzzes.length === 1) {
      gs.lockedOut = true;
    }

    addHistory(room, { playerId, playerName: player.name, action: 'BUZZ', detail: `Buzzed #${gs.buzzes.length}` });
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
    room.gameState.playerAnswers = {};
    room.gameState.clearGeneration = (room.gameState.clearGeneration || 0) + 1;
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

    const validModes = ['BUZZER', 'MULTIPLE_CHOICE', 'GUESS', 'SEQUENCE'];
    if (!validModes.includes(mode)) return;

    room.gameState.currentMode = mode;
    room.gameState.buzzes = [];
    room.gameState.lockedOut = false;
    room.gameState.mcOptionsLocked = false;
    room.gameState.sliderLocked = false;
    room.gameState.playerAnswers = {};
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'CHANGE_MODE', detail: `Changed to ${mode}` });
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

  // ── Guess: QM sets range ──────────────────────────────────────────────
  socket.on('SET_SLIDER_RANGE', ({ min, max }) => {
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'quizmaster') return;
    room.gameState.sliderMin = Number(min) || 0;
    room.gameState.sliderMax = Number(max) || 100;
    room.gameState.sliderLocked = false;
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
    room.gameState.playerAnswers = {};
    addHistory(room, { playerId: player.id, playerName: player.name, action: 'LOCK_GUESS', detail: `Range: ${room.gameState.sliderMin}–${room.gameState.sliderMax}` });
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
    gs.playerAnswers[playerId].value = value;
    gs.playerAnswers[playerId].preview = value;
    gs.playerAnswers[playerId].submitted = true;

    addHistory(room, { playerId, playerName: player.name, action: 'SUBMIT', detail: `Answer: ${JSON.stringify(value)}` });

    // Also record buzz timestamp for race mode sorting
    if (!gs.buzzes.find((b) => b.playerId === playerId)) {
      gs.buzzes.push({
        playerId,
        playerName: player.name,
        timestamp: Date.now(),
      });
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

    // Find the target socket
    let targetSocketId = null;
    let targetName = null;
    for (const [sid, p] of room.players) {
      if (p.id === targetPlayerId) {
        targetSocketId = sid;
        targetName = p.name;
        break;
      }
    }
    if (!targetSocketId) return;

    addHistory(room, { playerId: player.id, playerName: player.name, action: 'KICK', detail: `Kicked ${targetName}` });

    // Notify the kicked player before removing
    io.to(targetSocketId).emit('KICKED');
    // Remove from room
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(room.id);
      targetSocket.data = {};
    }
    room.players.delete(targetSocketId);
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
    }
    socket.leave(roomId);
    room.players.delete(socket.id);
    socket.data = {};
    if (room.players.size === 0) {
      rooms.delete(room.id);
      console.log(`[room-deleted] ${room.id}`);
    } else {
      broadcast(room);
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const { roomId } = socket.data || {};
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.delete(socket.id);
    // Clean up empty rooms
    if (room.players.size === 0) {
      rooms.delete(room.id);
      console.log(`[room-deleted] ${room.id}`);
    } else {
      broadcast(room);
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
