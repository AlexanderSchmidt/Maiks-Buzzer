import { useState, useEffect, useRef } from 'react';
import { Eye, Trophy, Zap, MessageSquare, CheckCircle, Clock, LogOut, Users, UsersRound, Check } from 'lucide-react';

const MODE_LABELS = { BUZZER: 'Buzzer', MULTIPLE_CHOICE: 'Multiple Choice', GUESS: 'Guess', SEQUENCE: 'Sequence' };

export default function SpectatorView({ store }) {
  const { roomId, gameState, players, leaveRoom, teams, playerTeams, teamsEnabled, teamScores } = store;
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
    const delta = cur - first;
    if (delta === 0) return '±0ms';
    if (delta < 1000) return `+${delta}ms`;
    return `+${(delta / 1000).toFixed(2)}s`;
  };

  const formatAnswer = (playerId) => {
    const ans = gameState.playerAnswers?.[playerId];
    if (!ans) return null;

    const val = ans.value ?? ans.preview;
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
                      {teamsEnabled && playerTeams?.[player.id] && teams?.[playerTeams[player.id]] && (
                        <span className="text-[10px] bg-pink-900/50 text-pink-300 px-1.5 py-0.5 rounded-full leading-none">
                          {teams[playerTeams[player.id]].name}
                        </span>
                      )}
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

          {/* ── Multiple Choice: option-centric view ──────────────── */}
          {gameState.currentMode === 'MULTIPLE_CHOICE' && gameState.mcOptionsLocked && gameState.mcOptions ? (
            <div className="space-y-3">
              {gameState.mcOptions
                .map((opt, idx) => {
                  // Gather players whose current value (submitted or preview) equals this index
                  const selecting = playerList.filter((p) => {
                    const pa = gameState.playerAnswers?.[p.id];
                    if (!pa) return false;
                    const val = pa.submitted ? pa.value : pa.value ?? pa.preview;
                    return val === idx;
                  });

                  const MC_COLORS = [
                    { bg: 'from-purple-900/50 to-purple-800/30', border: 'border-purple-500/40', badge: 'bg-purple-500', text: 'text-purple-300', ring: 'ring-purple-400/40' },
                    { bg: 'from-blue-900/50 to-blue-800/30', border: 'border-blue-500/40', badge: 'bg-blue-500', text: 'text-blue-300', ring: 'ring-blue-400/40' },
                    { bg: 'from-teal-900/50 to-teal-800/30', border: 'border-teal-500/40', badge: 'bg-teal-500', text: 'text-teal-300', ring: 'ring-teal-400/40' },
                    { bg: 'from-amber-900/50 to-amber-800/30', border: 'border-amber-500/40', badge: 'bg-amber-500', text: 'text-amber-300', ring: 'ring-amber-400/40' },
                  ];
                  const c = MC_COLORS[idx % MC_COLORS.length];

                  return (
                    <div
                      key={idx}
                      className={`relative rounded-xl border bg-gradient-to-r p-4 transition-all duration-500 ${
                        c.bg
                      } ${
                        selecting.length > 0 ? c.border : 'border-gray-700/30'
                      }`}
                    >
                      {/* Option header */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm text-white ${c.badge} shadow-lg`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={`font-semibold ${c.text}`}>{opt || <span className="italic text-gray-500">empty</span>}</span>
                        {/* Player count pill */}
                        <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded-full ${
                          selecting.length > 0 ? `${c.badge} text-white` : 'bg-gray-800 text-gray-500'
                        } transition-all duration-300`}>
                          {selecting.length}
                        </span>
                      </div>

                      {/* Player chips */}
                      <div className="flex flex-wrap gap-2 min-h-[28px]">
                        {selecting.length === 0 && (
                          <span className="text-xs text-gray-600 italic">No selections yet</span>
                        )}
                        {selecting.map((player) => {
                          const pa = gameState.playerAnswers?.[player.id];
                          const isSubmitted = pa?.submitted;
                          const justSubmitted = newSubmitIds.has(player.id);

                          return (
                            <span
                              key={player.id}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-500 ${
                                isSubmitted
                                  ? `bg-green-800/60 text-green-200 ring-2 ring-green-400/50 shadow-md shadow-green-500/20`
                                  : 'bg-gray-700/60 text-gray-300 ring-1 ring-gray-600/40'
                              } ${
                                justSubmitted ? 'mc-chip-submit' : ''
                              }`}
                            >
                              {isSubmitted && <Check className="w-3 h-3 text-green-400" />}
                              {!isSubmitted && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />}
                              {player.name}
                              {teamsEnabled && playerTeams?.[player.id] && teams?.[playerTeams[player.id]] && (
                                <span className="text-[9px] opacity-60">({teams[playerTeams[player.id]].name})</span>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      {/* Progress bar: proportion of players who chose this */}
                      {(() => {
                        const totalAnswered = playerList.filter((p) => gameState.playerAnswers?.[p.id]).length;
                        const pct = totalAnswered > 0 ? (selecting.length / totalAnswered) * 100 : 0;
                        return (
                          <div className="mt-3 h-1 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ease-out ${c.badge}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}

              {/* Summary bar */}
              {(() => {
                const totalPlayers = playerList.length;
                const answered = playerList.filter((p) => gameState.playerAnswers?.[p.id]).length;
                const submitted = playerList.filter((p) => gameState.playerAnswers?.[p.id]?.submitted).length;
                return (
                  <div className="flex items-center gap-4 mt-2 pt-3 border-t border-gray-800">
                    <span className="text-xs text-gray-500">
                      <span className="font-mono text-gray-300">{answered}</span>/{totalPlayers} answered
                    </span>
                    <span className="text-xs text-gray-500">
                      <span className="font-mono text-green-400">{submitted}</span> submitted
                    </span>
                    <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-600">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Submitted</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" /> Selecting</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : playerList.length === 0 ? (
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
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">{player.name}</span>
                        {teamsEnabled && playerTeams?.[player.id] && teams?.[playerTeams[player.id]] && (
                          <span className="text-[10px] bg-pink-900/50 text-pink-300 px-1 py-0 rounded-full leading-none">
                            {teams[playerTeams[player.id]].name}
                          </span>
                        )}
                      </div>
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
                    <span className="text-xs text-red-400 ml-1">{delta}</span>
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

      {/* Team Scoreboard */}
      {teamsEnabled && Object.keys(teams || {}).length > 0 && (
        <div className="mt-6 bg-gray-900 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            <UsersRound className="w-4 h-4 text-pink-400" />
            Team Scores
          </h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(teams)
              .sort(([, a], [, b]) => (teamScores?.[b] ?? 0) - (teamScores?.[a] ?? 0))
              .map(([teamId, team], idx) => {
                const memberCount = playerList.filter((p) => playerTeams?.[p.id] === teamId).length;
                return (
                  <div
                    key={teamId}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                      idx === 0
                        ? 'bg-pink-900/30 border-pink-600/40'
                        : 'bg-gray-800/50 border-gray-700/30'
                    }`}
                  >
                    <span className="font-semibold text-pink-300">{team.name}</span>
                    <span className="font-mono font-bold text-yellow-400 text-lg">{teamScores?.[teamId] ?? 0}</span>
                    <span className="text-xs text-gray-500">({memberCount} player{memberCount !== 1 ? 's' : ''})</span>
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
