import { useState, useEffect, useRef } from 'react';
import {
  RotateCcw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Plus,
  Minus,
  Zap,
  Users,
  Settings,
  Lock,
  Unlock,
  Timer,
  Trophy,
  Link2,
  Check,
  Clock,
  LogOut,
  UserX,
  Eye,
  Volume2,
  VolumeX,
  UsersRound,
  X,
} from 'lucide-react';
import { SOUND_NAMES, loadSoundPrefs, saveSoundPrefs, resolveSoundId, playBuzzSound } from '../sounds';

const MODES = ['BUZZER', 'MULTIPLE_CHOICE', 'GUESS', 'SEQUENCE'];
const MODE_LABELS = { BUZZER: 'Buzzer', MULTIPLE_CHOICE: 'Multiple Choice', GUESS: 'Guess', SEQUENCE: 'Sequence' };

export default function QuizMasterView({ store }) {
  const {
    roomId,
    gameState,
    players,
    scores,
    spectatorToken,
    teams,
    playerTeams,
    teamsEnabled,
    teamScores,
    toggleInput,
    resetRoom,
    clearTexts,
    changeMode,
    updateScore,
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
    leaveRoom,
    kickPlayer,
    resetPlayer,
  } = store;

  const history = store.history || [];
  const playerList = players.filter((p) => p.role === 'player');
  const spectatorList = players.filter((p) => p.role === 'spectator');

  // Local state for MC option editing
  const [localMcOptions, setLocalMcOptions] = useState(['', '']);
  const [localSliderMin, setLocalSliderMin] = useState(0);
  const [localSliderMax, setLocalSliderMax] = useState(100);
  const [copiedLink, setCopiedLink] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSpectators, setShowSpectators] = useState(false);
  const [confirmKick, setConfirmKick] = useState(null); // playerId pending kick confirmation
  const [showTeams, setShowTeams] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeam, setEditingTeam] = useState(null); // teamId being renamed
  const [editTeamName, setEditTeamName] = useState('');

  // Sound preferences (persisted in localStorage)
  const [muted, setMuted] = useState(() => loadSoundPrefs().qmMuted ?? false);
  const [volume, setVolume] = useState(() => loadSoundPrefs().qmVolume ?? 0.7);
  const [perPlayerSound, setPerPlayerSound] = useState(() => loadSoundPrefs().perPlayerSound ?? true);
  const [qmDefaultSound, setQmDefaultSound] = useState(() => loadSoundPrefs().qmDefaultSound ?? 1);
  const prevBuzzIdsRef = useRef(new Set());

  // Play sound when new buzzes arrive
  useEffect(() => {
    if (muted) return;
    const currentIds = new Set(gameState.buzzes.map((b) => b.playerId));
    for (const buzz of gameState.buzzes) {
      if (!prevBuzzIdsRef.current.has(buzz.playerId)) {
        // New buzz detected
        if (perPlayerSound) {
          playBuzzSound(resolveSoundId(buzz.soundId || 0, buzz.playerId), volume);
        } else {
          playBuzzSound(resolveSoundId(qmDefaultSound), volume);
        }
      }
    }
    prevBuzzIdsRef.current = currentIds;
  }, [gameState.buzzes]);

  // Reset tracked buzzes when round resets (buzzes cleared)
  useEffect(() => {
    if (gameState.buzzes.length === 0) {
      prevBuzzIdsRef.current = new Set();
    }
  }, [gameState.buzzes.length]);

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    saveSoundPrefs({ ...loadSoundPrefs(), qmMuted: next });
  };

  const handleVolumeChange = (val) => {
    const v = Number(val);
    setVolume(v);
    saveSoundPrefs({ ...loadSoundPrefs(), qmVolume: v });
  };

  const handlePerPlayerToggle = () => {
    const next = !perPlayerSound;
    setPerPlayerSound(next);
    saveSoundPrefs({ ...loadSoundPrefs(), perPlayerSound: next });
  };

  const handleDefaultSoundChange = (val) => {
    const id = Number(val);
    setQmDefaultSound(id);
    saveSoundPrefs({ ...loadSoundPrefs(), qmDefaultSound: id });
  };

  const handleTestSound = () => {
    if (!muted) playBuzzSound(resolveSoundId(qmDefaultSound), volume);
  };

  const getBuzzRank = (playerId) => {
    const idx = gameState.buzzes.findIndex((b) => b.playerId === playerId);
    return idx >= 0 ? idx + 1 : null;
  };

  const getTimeDelta = (playerId) => {
    if (!gameState.buzzes.length) return null;
    const firstTs = gameState.buzzes[0].timestamp;
    const buzz = gameState.buzzes.find((b) => b.playerId === playerId);
    if (!buzz) return null;
    const delta = buzz.timestamp - firstTs;
    if (delta === 0) return '±0ms';
    if (delta < 1000) return `+${delta}ms`;
    return `+${(delta / 1000).toFixed(2)}s`;
  };

  const rankLabel = (rank) => {
    if (rank === 1) return '🥇 1st';
    if (rank === 2) return '🥈 2nd';
    if (rank === 3) return '🥉 3rd';
    return `#${rank}`;
  };

  const getPlayerAnswer = (playerId) => {
    return gameState.playerAnswers?.[playerId] || null;
  };

  const formatAnswer = (answer, mode) => {
    if (!answer) return null;
    const val = answer.submitted ? answer.value : answer.preview;
    if (val === null || val === undefined) return null;

    if (mode === 'MULTIPLE_CHOICE') {
      const idx = typeof val === 'number' ? val : null;
      if (idx !== null && gameState.mcOptions?.[idx]) {
        return gameState.mcOptions[idx];
      }
      return String(val);
    }
    if (mode === 'GUESS') return String(val);
    if (mode === 'SEQUENCE') {
      return Array.isArray(val) ? val.join(', ') : String(val);
    }
    return String(val);
  };

  // ── MC options editor ──────────────────────────────────────────────────
  const handleAddOption = () => {
    if (localMcOptions.length < 4) {
      setLocalMcOptions([...localMcOptions, '']);
    }
  };

  const handleRemoveOption = (idx) => {
    if (localMcOptions.length > 2) {
      setLocalMcOptions(localMcOptions.filter((_, i) => i !== idx));
    }
  };

  const handleOptionChange = (idx, val) => {
    const updated = [...localMcOptions];
    updated[idx] = val;
    setLocalMcOptions(updated);
  };

  const handleConfirmMc = () => {
    setMcOptions(localMcOptions);
    // Small delay to ensure server has options before locking
    setTimeout(() => lockMcOptions(), 50);
  };

  const handleConfirmSlider = () => {
    setSliderRange(localSliderMin, localSliderMax);
    setTimeout(() => lockSliderRange(), 50);
  };

  // ── Mode-specific config panel ─────────────────────────────────────────
  const renderModeConfig = () => {
    switch (gameState.currentMode) {
      case 'MULTIPLE_CHOICE':
        return (
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">
              Multiple Choice Options
            </h3>
            {gameState.mcOptionsLocked ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <Lock className="w-4 h-4" /> Options locked — visible to players
                </div>
                {gameState.mcOptions.map((opt, idx) => (
                  <div key={idx} className="px-3 py-2 bg-gray-700/50 rounded-lg text-sm">
                    <span className="text-purple-400 font-bold mr-2">{String.fromCharCode(65 + idx)}.</span>
                    {opt}
                  </div>
                ))}
              </div>
            ) : (
              <>
                {localMcOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-purple-400 font-bold text-sm w-6">
                      {String.fromCharCode(65 + idx)}.
                    </span>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => handleOptionChange(idx, e.target.value)}
                      placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                      className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 focus:outline-none text-white text-sm"
                    />
                    {localMcOptions.length > 2 && (
                      <button
                        onClick={() => handleRemoveOption(idx)}
                        className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-red-800 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex gap-2">
                  {localMcOptions.length < 4 && (
                    <button
                      onClick={handleAddOption}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add Option
                    </button>
                  )}
                  <button
                    onClick={handleConfirmMc}
                    disabled={localMcOptions.filter((o) => o.trim()).length < 2}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                  >
                    <Lock className="w-3 h-3" /> Confirm & Show to Players
                  </button>
                </div>
              </>
            )}
          </div>
        );

      case 'GUESS':
        return (
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider">
              Guess Range
            </h3>
            {gameState.sliderLocked ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <Lock className="w-4 h-4" /> Range locked — visible to players
                </div>
                <p className="text-sm text-gray-300">
                  Range: <span className="font-mono text-blue-400">{gameState.sliderMin}</span>
                  {' → '}
                  <span className="font-mono text-blue-400">{gameState.sliderMax}</span>
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Min</label>
                  <input
                    type="number"
                    value={localSliderMin}
                    onChange={(e) => setLocalSliderMin(Number(e.target.value))}
                    className="w-24 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-blue-500 focus:outline-none text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Max</label>
                  <input
                    type="number"
                    value={localSliderMax}
                    onChange={(e) => setLocalSliderMax(Number(e.target.value))}
                    className="w-24 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-blue-500 focus:outline-none text-white text-sm"
                  />
                </div>
                <button
                  onClick={handleConfirmSlider}
                  disabled={localSliderMin >= localSliderMax}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                >
                  <Lock className="w-3 h-3" /> Confirm & Show to Players
                </button>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            Maik&apos;s Buzzer
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Room:{' '}
            <span className="font-mono text-yellow-400 text-lg tracking-wider">
              {roomId}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Users className="w-4 h-4" />
            {playerList.length} player{playerList.length !== 1 && 's'}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}?role=player`);
              setCopiedLink('player');
              setTimeout(() => setCopiedLink(null), 2000);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-700 text-xs font-medium transition-colors"
          >
            {copiedLink === 'player' ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
            {copiedLink === 'player' ? 'Copied!' : 'Copy Player Link'}
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}?role=spectator&token=${spectatorToken || ''}`);
              setCopiedLink('spectator');
              setTimeout(() => setCopiedLink(null), 2000);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs font-medium transition-colors"
          >
            {copiedLink === 'spectator' ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
            {copiedLink === 'spectator' ? 'Copied!' : 'Copy Spectator Link'}
          </button>
          <button
            onClick={leaveRoom}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 text-xs font-medium transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Leave
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-2xl p-4 mb-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
          <Settings className="w-4 h-4" /> Controls
        </div>

        {/* Mode selector */}
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => changeMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${gameState.currentMode === mode
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
            >
              {MODE_LABELS[mode] || mode}
            </button>
          ))}
        </div>

        {/* Race mode toggle */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => toggleRaceMode(!gameState.raceMode)}
            title={gameState.raceMode ? 'Players compete to buzz first, with timestamps recorded' : 'First to buzz wins. All other buzzers are blocked until reset'}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${gameState.raceMode
              ? 'bg-orange-700 hover:bg-orange-600'
              : 'bg-cyan-800 hover:bg-cyan-700'
              }`}
          >
            {gameState.raceMode ? (
              <>
                <Timer className="w-4 h-4" /> Race Mode
              </>
            ) : (
              <>
                <Trophy className="w-4 h-4" /> Solo Mode
              </>
            )}
          </button>

          <button
            onClick={() => toggleShowBuzz(!gameState.showBuzzToPlayers)}
            title={gameState.showBuzzToPlayers ? 'Players can see their buzz rank' : 'Buzz rank is hidden from players'}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              gameState.showBuzzToPlayers
                ? 'bg-emerald-700 hover:bg-emerald-600'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <Eye className="w-4 h-4" />
            {gameState.showBuzzToPlayers ? 'Buzz: Visible' : 'Buzz: Hidden'}
          </button>

          <button
            onClick={resetRoom}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All
          </button>

          <button
            onClick={() => toggleInput(!gameState.inputEnabled)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${gameState.inputEnabled
              ? 'bg-green-700 hover:bg-green-600'
              : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            {gameState.inputEnabled ? (
              <ToggleRight className="w-4 h-4" />
            ) : (
              <ToggleLeft className="w-4 h-4" />
            )}
            {gameState.inputEnabled ? 'Input: ON' : 'Input: OFF'}
          </button>

          <button
            onClick={clearTexts}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear Texts
          </button>

          <button
            onClick={() => toggleTeams(!teamsEnabled)}
            title={teamsEnabled ? 'Disable team mode' : 'Enable team mode'}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              teamsEnabled
                ? 'bg-pink-700 hover:bg-pink-600'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <UsersRound className="w-4 h-4" />
            {teamsEnabled ? 'Teams: ON' : 'Teams: OFF'}
          </button>
        </div>

        {/* Sound controls */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-800">
          <button
            onClick={handleMuteToggle}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              muted ? 'bg-red-900/60 text-red-400' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            {muted ? 'Muted' : 'Sound'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="w-24 accent-indigo-500"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
          <select
            value={qmDefaultSound}
            onChange={(e) => handleDefaultSoundChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            {SOUND_NAMES.map((name, idx) => (
              <option key={idx} value={idx}>{name}</option>
            ))}
          </select>
          <button
            onClick={handleTestSound}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Test
          </button>
          <button
            onClick={handlePerPlayerToggle}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              perPlayerSound ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {perPlayerSound ? 'Per-Player Sound: ON' : 'Per-Player Sound: OFF'}
          </button>
        </div>

        {/* Mode-specific config */}
        {renderModeConfig()}
      </div>

      {/* Teams Panel */}
      {teamsEnabled && (
        <div className="bg-gray-900 rounded-2xl p-4 mb-6">
          <button
            onClick={() => setShowTeams((s) => !s)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider w-full"
          >
            <UsersRound className="w-4 h-4 text-pink-400" />
            Teams ({Object.keys(teams).length})
            <span className="ml-auto text-xs text-gray-600">{showTeams ? '▼' : '▶'}</span>
          </button>
          {showTeams && (
            <div className="mt-3 space-y-3">
              {/* Create team */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Team name (leave blank for random)"
                  className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-pink-500 focus:outline-none text-white text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { createTeam(newTeamName); setNewTeamName(''); }
                  }}
                />
                <button
                  onClick={() => { createTeam(newTeamName); setNewTeamName(''); }}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg bg-pink-700 hover:bg-pink-600 text-sm font-medium transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Team
                </button>
              </div>

              {/* Team list */}
              {Object.entries(teams).map(([teamId, team]) => {
                const teamPlayers = playerList.filter(p => playerTeams[p.id] === teamId);
                const score = teamScores[teamId] ?? 0;
                return (
                  <div key={teamId} className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {editingTeam === teamId ? (
                          <input
                            type="text"
                            value={editTeamName}
                            onChange={(e) => setEditTeamName(e.target.value)}
                            onBlur={() => { renameTeam(teamId, editTeamName); setEditingTeam(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { renameTeam(teamId, editTeamName); setEditingTeam(null); } }}
                            autoFocus
                            className="px-2 py-1 rounded bg-gray-700 border border-pink-500 text-white text-sm focus:outline-none"
                          />
                        ) : (
                          <span
                            className="font-semibold text-pink-300 cursor-pointer hover:underline"
                            onClick={() => { setEditingTeam(teamId); setEditTeamName(team.name); }}
                            title="Click to rename"
                          >
                            {team.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">({teamPlayers.length} player{teamPlayers.length !== 1 && 's'})</span>
                        <span className="text-xs font-mono text-yellow-400">Score: {score}</span>
                      </div>
                      <button
                        onClick={() => removeTeam(teamId)}
                        className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-red-800 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                        title="Remove team"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {teamPlayers.map(p => (
                        <span key={p.id} className="text-xs bg-pink-900/40 text-pink-300 px-2 py-0.5 rounded-full">
                          {p.name}
                        </span>
                      ))}
                      {teamPlayers.length === 0 && (
                        <span className="text-xs text-gray-600 italic">No players</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {Object.keys(teams).length === 0 && (
                <p className="text-gray-600 text-xs italic">No teams yet. Add one above.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Player Cards */}
      {playerList.length === 0 ? (
        <div className="text-center text-gray-500 py-20">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-40" />
          <p className="text-lg">Waiting for players to join...</p>
          <p className="text-sm mt-1">
            Share the room code: <span className="font-mono text-yellow-400">{roomId}</span>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {playerList.map((player) => {
            const rank = getBuzzRank(player.id);
            const delta = gameState.raceMode ? getTimeDelta(player.id) : null;
            const answer = getPlayerAnswer(player.id);
            const answerText = formatAnswer(answer, gameState.currentMode);

            return (
              <div
                key={player.id}
                className={`rounded-2xl p-4 border transition-all duration-300 ${rank === 1
                  ? 'bg-yellow-900/30 border-yellow-500/50 shadow-lg shadow-yellow-500/10'
                  : rank
                    ? 'bg-green-900/20 border-green-700/40'
                    : 'bg-gray-900 border-gray-800'
                  }`}
              >
                {/* Player header */}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${rank ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
                        }`}
                    />
                    <span className="font-semibold truncate max-w-[140px]">
                      {player.name}
                    </span>
                    {teamsEnabled && playerTeams[player.id] && teams[playerTeams[player.id]] && (
                      <span className="text-[10px] bg-pink-900/50 text-pink-300 px-1.5 py-0.5 rounded-full leading-none">
                        {teams[playerTeams[player.id]].name}
                      </span>
                    )}
                  </div>
                  <div className={`text-right ${rank ? 'visible' : 'invisible'}`}>
                    <span className="text-sm font-bold">{rank ? rankLabel(rank) : '\u00A0'}</span>
                    {gameState.raceMode && (
                      <span className={`block text-xs text-orange-400 font-mono ${delta ? 'visible' : 'invisible'}`}>{delta || '\u00A0'}</span>
                    )}
                  </div>
                </div>

                {/* Buzz time */}
                <p className={`text-xs text-gray-400 mb-2 ${rank ? 'visible' : 'invisible'}`}>
                  {rank
                    ? `Buzzed at ${new Date(gameState.buzzes[rank - 1].timestamp).toLocaleTimeString()}`
                    : '\u00A0'}
                </p>

                {/* Team assignment */}
                {teamsEnabled && Object.keys(teams).length > 0 && (
                  <div className="mb-2">
                    <select
                      value={playerTeams[player.id] || ''}
                      onChange={(e) => setTeam(player.id, e.target.value || null)}
                      className="w-full px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:border-pink-500 focus:outline-none"
                    >
                      <option value="">No team</option>
                      {Object.entries(teams).map(([tid, t]) => (
                        <option key={tid} value={tid}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Player answer (for MC/Slider/Sequence) */}
                {gameState.currentMode !== 'BUZZER' && answerText && (
                  <div className={`rounded-lg p-2 mb-2 text-sm ${answer?.submitted
                    ? 'bg-indigo-900/40 border border-indigo-500/30 text-indigo-300'
                    : 'bg-gray-800/40 text-gray-400 italic'
                    }`}>
                    <span className="text-xs text-gray-500 block">
                      {answer?.submitted ? '✓ Submitted' : 'Previewing...'}
                    </span>
                    {answerText}
                  </div>
                )}

                {/* Player text */}
                <div className="bg-gray-800/60 rounded-lg p-2 min-h-[40px] text-sm text-gray-300 mb-3 break-words">
                  {player.text || (
                    <span className="text-gray-600 italic">No text</span>
                  )}
                </div>

                {/* Score controls */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Score</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateScore(player.id, -1)}
                      className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-red-800 flex items-center justify-center transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-mono text-lg font-bold text-yellow-400">
                      {player.score}
                    </span>
                    <button
                      onClick={() => updateScore(player.id, 1)}
                      className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-green-800 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Reset & Kick buttons */}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => resetPlayer(player.id)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-300 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                  {confirmKick === player.id ? (
                    <div className="flex-1 flex gap-1">
                      <button
                        onClick={() => { kickPlayer(player.id); setConfirmKick(null); }}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-bold text-white transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmKick(null)}
                        className="flex-1 flex items-center justify-center px-2 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-400 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmKick(player.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-800 text-xs font-medium text-red-300 transition-colors"
                    >
                      <UserX className="w-3 h-3" /> Kick
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Spectators Panel */}
      <div className="bg-gray-900 rounded-2xl p-4 mt-6">
        <button
          onClick={() => setShowSpectators((s) => !s)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider w-full"
        >
          <Eye className="w-4 h-4 text-gray-400" />
          Spectators ({spectatorList.length})
          <span className="ml-auto text-xs text-gray-600">{showSpectators ? '▼' : '▶'}</span>
        </button>
        {showSpectators && (
          <div className="mt-3 space-y-1">
            {spectatorList.length === 0 && (
              <p className="text-gray-600 text-xs italic">No spectators</p>
            )}
            {spectatorList.map((spec) => (
              <div key={spec.id} className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg text-sm">
                <span className="text-gray-300">{spec.name}</span>
                {confirmKick === spec.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { kickPlayer(spec.id); setConfirmKick(null); }}
                      className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs font-bold text-white transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmKick(null)}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmKick(spec.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-red-900/50 hover:bg-red-800 text-xs text-red-300 transition-colors"
                  >
                    <UserX className="w-3 h-3" /> Kick
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="bg-gray-900 rounded-2xl p-4 mt-6">
        <button
          onClick={() => setShowHistory((h) => !h)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider w-full"
        >
          <Clock className="w-4 h-4 text-gray-400" />
          History ({history.length})
          <span className="ml-auto text-xs text-gray-600">{showHistory ? '▼' : '▶'}</span>
        </button>
        {showHistory && (
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
    </div>
  );
}
