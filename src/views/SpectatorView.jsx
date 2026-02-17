import { useState, useEffect, useRef } from 'react';
import { Eye, Trophy, Zap, MessageSquare, CheckCircle, Clock, LogOut, Users } from 'lucide-react';

const MODE_LABELS = { BUZZER: 'Buzzer', MULTIPLE_CHOICE: 'Multiple Choice', GUESS: 'Guess', SEQUENCE: 'Sequence' };

export default function SpectatorView({ store }) {
  const { roomId, gameState, players, leaveRoom } = store;
  const history = store.history || [];

  const playerList = players.filter((p) => p.role === 'player');
  const spectatorList = players.filter((p) => p.role === 'spectator');
  const leaderboard = [...playerList].sort((a, b) => b.score - a.score);

  // ── Score animation tracking ───────────────────────────────────────────
  const prevScoresRef = useRef({});
  const [scoreAnims, setScoreAnims] = useState({}); // { playerId: 'up' | 'down' }

  useEffect(() => {
    const next = {};
    for (const p of playerList) {
      const prev = prevScoresRef.current[p.id];
      if (prev !== undefined) {
        if (p.score > prev) next[p.id] = 'up';
        else if (p.score < prev) next[p.id] = 'down';
      }
      prevScoresRef.current[p.id] = p.score;
    }
    if (Object.keys(next).length > 0) {
      setScoreAnims(next);
      const timer = setTimeout(() => setScoreAnims({}), 700);
      return () => clearTimeout(timer);
    }
  }, [players]);

  // ── Buzz animation tracking ────────────────────────────────────────────
  const prevBuzzCountRef = useRef(0);
  const [newBuzzIds, setNewBuzzIds] = useState(new Set());

  useEffect(() => {
    const count = gameState.buzzes.length;
    if (count > prevBuzzCountRef.current) {
      const ids = new Set(gameState.buzzes.slice(prevBuzzCountRef.current).map((b) => b.playerId));
      setNewBuzzIds(ids);
      const timer = setTimeout(() => setNewBuzzIds(new Set()), 800);
      prevBuzzCountRef.current = count;
      return () => clearTimeout(timer);
    }
    if (count === 0) {
      prevBuzzCountRef.current = 0;
      setNewBuzzIds(new Set());
    }
  }, [gameState.buzzes]);

  // ── Answer animation tracking ──────────────────────────────────────────
  const prevSubmittedRef = useRef(new Set());
  const [newSubmitIds, setNewSubmitIds] = useState(new Set());

  useEffect(() => {
    const currentSubmitted = new Set();
    for (const [pid, ans] of Object.entries(gameState.playerAnswers || {})) {
      if (ans?.submitted) currentSubmitted.add(pid);
    }
    const fresh = new Set();
    for (const pid of currentSubmitted) {
      if (!prevSubmittedRef.current.has(pid)) fresh.add(pid);
    }
    prevSubmittedRef.current = currentSubmitted;
    if (fresh.size > 0) {
      setNewSubmitIds(fresh);
      const timer = setTimeout(() => setNewSubmitIds(new Set()), 700);
      return () => clearTimeout(timer);
    }
  }, [gameState.playerAnswers]);

  // ── Mode change animation ─────────────────────────────────────────────
  const [modeFlash, setModeFlash] = useState(false);
  const prevModeRef = useRef(gameState.currentMode);

  useEffect(() => {
    if (gameState.currentMode !== prevModeRef.current) {
      setModeFlash(true);
      prevModeRef.current = gameState.currentMode;
      const timer = setTimeout(() => setModeFlash(false), 800);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentMode]);

  // ── Input enabled flash ────────────────────────────────────────────────
  const [inputFlash, setInputFlash] = useState(false);
  const prevInputRef = useRef(gameState.inputEnabled);

  useEffect(() => {
    if (gameState.inputEnabled !== prevInputRef.current) {
      setInputFlash(true);
      prevInputRef.current = gameState.inputEnabled;
      const timer = setTimeout(() => setInputFlash(false), 800);
      return () => clearTimeout(timer);
    }
  }, [gameState.inputEnabled]);

  const getBuzzRank = (playerId) => {
    const idx = gameState.buzzes.findIndex((b) => b.playerId === playerId);
    return idx >= 0 ? idx + 1 : null;
  };

  const rankLabel = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getTimeDelta = (idx) => {
    if (idx === 0 || !gameState.raceMode) return null;
    const first = gameState.buzzes[0]?.timestamp;
    const cur = gameState.buzzes[idx]?.timestamp;
    if (!first || !cur) return null;
    return ((cur - first) / 1000).toFixed(2);
  };

  const formatAnswer = (playerId) => {
    const ans = gameState.playerAnswers?.[playerId];
    if (!ans) return null;

    const val = ans.value;
    const submitted = ans.submitted;

    if (gameState.currentMode === 'MULTIPLE_CHOICE' && gameState.mcOptions) {
      const label = gameState.mcOptions[val]
        ? `${String.fromCharCode(65 + val)}: ${gameState.mcOptions[val]}`
        : String.fromCharCode(65 + (val ?? 0));
      return { label, submitted };
    }
    if (gameState.currentMode === 'GUESS') {
      return { label: `${val}`, submitted };
    }
    if (gameState.currentMode === 'SEQUENCE' && Array.isArray(val)) {
      return { label: val.join(', '), submitted };
    }
    return { label: String(val), submitted };
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Eye className="w-6 h-6 text-purple-400" />
          <div>
            <h1 className="text-xl font-bold">Spectator View</h1>
            <p className="text-xs text-gray-500">
              Room: <span className="font-mono text-purple-400">{roomId}</span>
              {' · '}
              <span className={`inline-block transition-all duration-500 ${modeFlash ? 'text-indigo-300 scale-110 font-bold' : ''}`}>
                Mode: {MODE_LABELS[gameState.currentMode] || gameState.currentMode}
              </span>
              {' · '}{gameState.raceMode ? 'Race' : 'First Wins'}
              {' · '}
              <span className={`inline-block transition-all duration-500 ${inputFlash ? (gameState.inputEnabled ? 'text-green-400 font-bold' : 'text-red-400 font-bold') : ''}`}>
                Input: {gameState.inputEnabled ? 'ON' : 'OFF'}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={leaveRoom}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 text-xs font-medium transition-colors"
        >
          <LogOut className="w-3 h-3" /> Leave
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leaderboard */}
        <div className="bg-gray-900 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            <Trophy className="w-4 h-4 text-yellow-400" />
            Leaderboard
          </h2>
          {leaderboard.length === 0 ? (
            <p className="text-gray-600 italic text-sm">No players yet</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((player, idx) => {
                const rank = getBuzzRank(player.id);
                return (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between p-3 rounded-xl transition-all duration-500 ${
                      rank === 1
                        ? 'bg-yellow-900/30 border border-yellow-600/30'
                        : newBuzzIds.has(player.id)
                        ? 'bg-green-900/30 border border-green-600/30'
                        : 'bg-gray-800/50'
                    } ${
                      newBuzzIds.has(player.id) ? 'scale-[1.02]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-center text-sm font-bold text-gray-500">
                        {idx + 1}
                      </span>
                      <span className="font-medium truncate max-w-[160px]">
                        {player.name}
                      </span>
                      {rank && (
                        <span className="text-xs bg-green-800/40 text-green-400 px-2 py-0.5 rounded-full">
                          Buzzed {rankLabel(rank)}
                        </span>
                      )}
                    </div>
                    <span className={`font-mono font-bold transition-all duration-500 ${
                      scoreAnims[player.id] === 'up'
                        ? 'text-green-300 scale-125'
                        : scoreAnims[player.id] === 'down'
                        ? 'text-red-300 scale-125'
                        : 'text-yellow-400'
                    }`}>
                      {player.score}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Answers / Player Answers */}
        <div className="bg-gray-900 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            Live Answers
          </h2>
          {playerList.length === 0 ? (
            <p className="text-gray-600 italic text-sm">No players yet</p>
          ) : (
            <div className="space-y-2">
              {playerList.map((player) => {
                const ans = formatAnswer(player.id);
                return (
                  <div
                    key={player.id}
                    className={`flex items-start gap-3 p-3 rounded-xl transition-all duration-500 ${
                      newSubmitIds.has(player.id)
                        ? 'bg-green-900/30 border border-green-500/30 scale-[1.02]'
                        : 'bg-gray-800/50'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                        ans?.submitted
                          ? 'bg-green-400'
                          : ans
                          ? 'bg-yellow-400'
                          : player.text
                          ? 'bg-blue-400'
                          : 'bg-gray-600'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-gray-500">{player.name}</span>
                      {ans ? (
                        <div className="flex items-center gap-2">
                          <p className={`text-sm break-words ${
                            ans.submitted ? 'text-green-300' : 'text-yellow-300 italic'
                          }`}>
                            {ans.label}
                          </p>
                          {ans.submitted && (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                          )}
                          {!ans.submitted && (
                            <span className="text-[10px] text-yellow-600">(preview)</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-300 break-words">
                          {player.text || (
                            <span className="text-gray-600 italic">—</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Buzz Timeline */}
      {gameState.buzzes.length > 0 && (
        <div className="mt-6 bg-gray-900 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            <Zap className="w-4 h-4 text-red-400" />
            Buzz Order {gameState.raceMode && <span className="text-xs text-gray-500 ml-2">(Race Mode)</span>}
          </h2>
          <div className="flex flex-wrap gap-3">
            {gameState.buzzes.map((buzz, idx) => {
              const delta = getTimeDelta(idx);
              return (
                <div
                  key={buzz.playerId}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-500 ${
                    idx === 0
                      ? 'bg-yellow-900/40 text-yellow-300 border border-yellow-600/40'
                      : 'bg-gray-800 text-gray-400'
                  } ${
                    newBuzzIds.has(buzz.playerId)
                      ? 'animate-[buzzIn_0.5s_ease-out] scale-105 shadow-lg shadow-yellow-500/20'
                      : ''
                  }`}
                  style={newBuzzIds.has(buzz.playerId) ? { animation: 'buzzIn 0.5s ease-out' } : {}}
                >
                  <span className="font-bold">{rankLabel(idx + 1)}</span>
                  {buzz.playerName}
                  {delta && (
                    <span className="text-xs text-red-400 ml-1">+{delta}s</span>
                  )}
                  <span className="text-xs text-gray-500 ml-1">
                    {new Date(buzz.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Spectators panel */}
      <div className="bg-gray-900 rounded-2xl p-4 mt-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          <Users className="w-4 h-4 text-gray-400" />
          Spectators ({spectatorList.length})
        </div>
        {spectatorList.length === 0 ? (
          <p className="text-gray-600 text-xs italic">No spectators</p>
        ) : (
          <div className="space-y-1">
            {spectatorList.map((spec) => (
              <div key={spec.id} className="px-3 py-2 bg-gray-800/50 rounded-lg text-sm text-gray-300">
                {spec.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <HistoryPanel history={history} />
    </div>
  );
}

function HistoryPanel({ history }) {
  const [show, setShow] = useState(false);
  return (
    <div className="bg-gray-900 rounded-2xl p-4 mt-6">
      <button
        onClick={() => setShow((s) => !s)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider w-full"
      >
        <Clock className="w-4 h-4 text-gray-400" />
        History ({history.length})
        <span className="ml-auto text-xs text-gray-600">{show ? '\u25bc' : '\u25b6'}</span>
      </button>
      {show && (
        <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
          {history.length === 0 && (
            <p className="text-gray-600 text-xs italic">No history yet</p>
          )}
          {[...history].reverse().map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 text-xs p-2 bg-gray-800/50 rounded-lg">
              <span className="text-gray-600 font-mono shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-gray-500 shrink-0 w-20 truncate">{entry.playerName}</span>
              <span className="text-gray-300">{entry.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
