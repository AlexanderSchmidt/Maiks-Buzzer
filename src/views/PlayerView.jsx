import { useState, useEffect, useRef } from 'react';
import { Zap, Send, Type, Check, CheckCircle, Clock, LogOut, Volume2, VolumeX, Music, UsersRound, Lock } from 'lucide-react';
import { SOUND_NAMES, loadSoundPrefs, saveSoundPrefs, resolveSoundId, playBuzzSound } from '../sounds';

const MODE_LABELS = { BUZZER: 'Buzzer', MULTIPLE_CHOICE: 'Multiple Choice', GUESS: 'Guess' };

export default function PlayerView({ store }) {
  const {
    gameState,
    playerId,
    players,
    buzzPress,
    textUpdate,
    submitPayload,
    previewAnswer,
    submitAnswer,
    leaveRoom,
    setSound,
    teams,
    playerTeams,
    teamsEnabled,
    teamScores,
  } = store;

  const history = (store.history || []).filter((h) => h.playerId === playerId);
  const [localText, setLocalText] = useState('');
  const [buzzed, setBuzzed] = useState(false);
  const [buzzRank, setBuzzRank] = useState(null);
  const [selectedMcIndex, setSelectedMcIndex] = useState(null);
  const [sliderValue, setSliderValue] = useState(null);

  const [showHistory, setShowHistory] = useState(false);
  const throttleRef = useRef(null);
  const prevBuzzCountRef = useRef(0);

  // Sound preferences (persisted in localStorage)
  const [soundSelection, setSoundSelection] = useState(() => {
    const prefs = loadSoundPrefs();
    return prefs.playerSound ?? 0; // 0 = random
  });
  const [muted, setMuted] = useState(() => loadSoundPrefs().muted ?? false);
  const [volume, setVolume] = useState(() => loadSoundPrefs().volume ?? 0.7);

  const myBuzz = gameState.buzzes.find((b) => b.playerId === playerId);
  const myAnswer = gameState.playerAnswers?.[playerId] || null;
  const isSubmitted = myAnswer?.submitted || false;

  // Solo mode: check if another player already submitted (locks everyone else out)
  const soloLocked = !gameState.raceMode && !isSubmitted && Object.entries(gameState.playerAnswers || {}).some(
    ([pid, ans]) => pid !== playerId && ans?.submitted
  );

  useEffect(() => {
    if (myBuzz) {
      setBuzzed(true);
      setBuzzRank(gameState.buzzes.indexOf(myBuzz) + 1);
    } else {
      setBuzzed(false);
      setBuzzRank(null);
    }
  }, [gameState.buzzes, myBuzz]);

  // Reset local selections when mode / options change
  useEffect(() => {
    setSelectedMcIndex(null);
    setSliderValue(null);
  }, [gameState.currentMode, gameState.mcOptionsLocked, gameState.sliderLocked]);

  // Reset all local inputs when QM clears
  useEffect(() => {
    setLocalText('');
    setSelectedMcIndex(null);
    setSliderValue(null);
  }, [gameState.clearGeneration]);

  // Initialize slider to midpoint when range is locked
  useEffect(() => {
    if (gameState.sliderLocked && sliderValue === null) {
      const mid = Math.round((gameState.sliderMin + gameState.sliderMax) / 2);
      setSliderValue(mid);
    }
  }, [gameState.sliderLocked, gameState.sliderMin, gameState.sliderMax]);

  const handleBuzz = () => {
    if (!buzzed) {
      // In race mode: always allow (no lockedOut check)
      // In first-wins: check lockedOut
      if (gameState.raceMode || !gameState.lockedOut) {
        buzzPress();
      }
    }
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setLocalText(val);
    textUpdate(val);
  };

  const handleSubmitPayload = () => {
    submitPayload({ text: localText });
  };

  // Throttled preview
  const sendPreview = (value) => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = setTimeout(() => {
      previewAnswer(value);
    }, 80);
  };

  const handleMcSelect = (idx) => {
    if (isSubmitted) return;
    setSelectedMcIndex(idx);
    sendPreview(idx);
  };

  const handleMcSubmit = () => {
    if (selectedMcIndex === null || isSubmitted) return;
    submitAnswer(selectedMcIndex);
  };

  const handleSliderChange = (val) => {
    if (isSubmitted) return;
    setSliderValue(val);
    sendPreview(val);
  };

  const handleSliderSubmit = () => {
    if (sliderValue === null || isSubmitted) return;
    submitAnswer(sliderValue);
  };

  // Sync sound selection to server
  useEffect(() => {
    setSound(soundSelection);
  }, [soundSelection, setSound]);

  // Play sound when I buzz
  useEffect(() => {
    if (myBuzz && !muted && buzzed) {
      const resolved = resolveSoundId(soundSelection, playerId);
      playBuzzSound(resolved, volume);
    }
  }, [buzzed]); // only fire when buzzed flips to true

  const handleSoundChange = (val) => {
    const id = Number(val);
    setSoundSelection(id);
    saveSoundPrefs({ ...loadSoundPrefs(), playerSound: id });
    setSound(id);
  };

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    saveSoundPrefs({ ...loadSoundPrefs(), muted: next });
  };

  const handleVolumeChange = (val) => {
    const v = Number(val);
    setVolume(v);
    saveSoundPrefs({ ...loadSoundPrefs(), volume: v });
  };

  const handleTestSound = () => {
    if (!muted) {
      const resolved = resolveSoundId(soundSelection, playerId);
      playBuzzSound(resolved, volume);
    }
  };

  const me = players.find((p) => p.id === playerId);
  const myScore = me?.score ?? 0;
  const [scoreAnim, setScoreAnim] = useState(null); // 'up' | 'down' | null
  const prevScoreRef = useRef(myScore);

  // Team info
  const myTeamId = playerTeams?.[playerId] || null;
  const myTeam = myTeamId && teams?.[myTeamId] ? teams[myTeamId] : null;
  const myTeamScore = myTeamId ? (teamScores?.[myTeamId] ?? 0) : null;
  const teammates = teamsEnabled && myTeamId
    ? players.filter((p) => p.id !== playerId && playerTeams?.[p.id] === myTeamId)
    : [];

  useEffect(() => {
    if (myScore > prevScoreRef.current) {
      setScoreAnim('up');
    } else if (myScore < prevScoreRef.current) {
      setScoreAnim('down');
    }
    prevScoreRef.current = myScore;
    if (myScore !== prevScoreRef.current) {
      const timer = setTimeout(() => setScoreAnim(null), 600);
      return () => clearTimeout(timer);
    }
  }, [myScore]);

  // Team score animation
  const [teamScoreAnim, setTeamScoreAnim] = useState(null);
  const prevTeamScoreRef = useRef(myTeamScore);

  useEffect(() => {
    if (myTeamScore === null) return;
    if (prevTeamScoreRef.current !== null) {
      if (myTeamScore > prevTeamScoreRef.current) {
        setTeamScoreAnim('up');
      } else if (myTeamScore < prevTeamScoreRef.current) {
        setTeamScoreAnim('down');
      }
    }
    prevTeamScoreRef.current = myTeamScore;
    const timer = setTimeout(() => setTeamScoreAnim(null), 600);
    return () => clearTimeout(timer);
  }, [myTeamScore]);

  // ── Render based on currentMode ────────────────────────────────────────
  const renderModeUI = () => {
    switch (gameState.currentMode) {
      case 'BUZZER':
        return (
          <div className="flex flex-col items-center gap-6 w-full">
            <button
              onClick={handleBuzz}
              disabled={
                buzzed ||
                (!gameState.raceMode && gameState.lockedOut)
              }
              className={`
                relative w-56 h-56 sm:w-64 sm:h-64 rounded-full text-white text-2xl font-bold
                transition-all duration-150 active:scale-95 select-none
                shadow-2xl focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-950
                ${
                  buzzed
                    ? 'bg-green-500 ring-4 ring-green-300 cursor-default'
                    : (!gameState.raceMode && gameState.lockedOut)
                    ? 'bg-gray-600 cursor-not-allowed opacity-60'
                    : 'bg-red-600 hover:bg-red-500 active:bg-red-700 ring-4 ring-red-400 hover:ring-red-300 cursor-pointer animate-pulse'
                }
              `}
            >
              <Zap className="w-16 h-16 mx-auto mb-2" />
              {buzzed
                ? (gameState.showBuzzToPlayers !== false ? `#${buzzRank}!` : 'Buzzed!')
                : (!gameState.raceMode && gameState.lockedOut)
                ? 'Locked'
                : 'BUZZ!'}
            </button>
          </div>
        );

      case 'MULTIPLE_CHOICE':
        if (!gameState.mcOptionsLocked) {
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
              <h2 className="text-xl font-bold text-purple-400">Multiple Choice</h2>
              <p className="text-gray-500 text-sm">Waiting for the Quiz Master to set the options...</p>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-4 w-full max-w-md">
            <h2 className="text-xl font-bold text-purple-400">Multiple Choice</h2>
            {gameState.mcOptions
              .filter((opt) => opt.trim())
              .map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleMcSelect(idx)}
                  disabled={isSubmitted || soloLocked}
                  className={`w-full py-4 px-4 text-lg font-bold rounded-xl transition-colors border text-left ${
                    soloLocked
                      ? 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed opacity-60'
                      : selectedMcIndex === idx
                      ? isSubmitted
                        ? 'bg-green-800 border-green-500 text-green-200'
                        : 'bg-purple-700 border-purple-400 text-white'
                      : isSubmitted
                      ? 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed'
                      : 'bg-gray-800 hover:bg-purple-700 border-gray-700 hover:border-purple-500'
                  }`}
                >
                  <span className="text-purple-400 mr-3">{String.fromCharCode(65 + idx)}.</span>
                  {opt}
                </button>
              ))}
            {soloLocked ? (
              <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
                <Lock className="w-5 h-5" /> Another player already submitted
              </div>
            ) : !isSubmitted ? (
              <button
                onClick={handleMcSubmit}
                disabled={selectedMcIndex === null}
                className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5" /> Submit Answer
              </button>
            ) : (
              <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                <CheckCircle className="w-5 h-5" /> Answer submitted!
              </div>
            )}
          </div>
        );

      case 'GUESS':
        if (!gameState.sliderLocked) {
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
              <h2 className="text-xl font-bold text-blue-400">Guess</h2>
              <p className="text-gray-500 text-sm">Waiting for the Quiz Master to set the range...</p>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-blue-400">Guess</h2>
            <div className="w-full flex justify-between text-xs text-gray-500">
              <span>{gameState.sliderMin}</span>
              <span>{gameState.sliderMax}</span>
            </div>
            <input
              type="range"
              min={gameState.sliderMin}
              max={gameState.sliderMax}
              value={sliderValue ?? gameState.sliderMin}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              disabled={isSubmitted}
              className="w-full accent-blue-500 disabled:opacity-50"
            />
            <input
              type="number"
              min={gameState.sliderMin}
              max={gameState.sliderMax}
              value={sliderValue ?? ''}
              onChange={(e) => {
                if (isSubmitted) return;
                const v = Number(e.target.value);
                if (!isNaN(v)) handleSliderChange(v);
              }}
              disabled={isSubmitted}
              placeholder="Type a number"
              className="w-32 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 focus:border-blue-500 focus:outline-none text-white text-center text-xl font-mono disabled:opacity-50"
            />
            {!isSubmitted ? (
              <button
                onClick={handleSliderSubmit}
                disabled={sliderValue === null}
                className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-colors flex items-center gap-2"
              >
                <Send className="w-5 h-5" /> Submit
              </button>
            ) : (
              <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                <CheckCircle className="w-5 h-5" /> Answer submitted!
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-4 pt-28 sm:pt-4">
      {/* Top bar: Sound controls (left) + Badges (right) */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800/50 px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-3 justify-between">
        {/* Sound controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0">
          <select
            value={soundSelection}
            onChange={(e) => handleSoundChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500 min-w-0 max-w-[110px] sm:max-w-none"
          >
            {SOUND_NAMES.map((name, idx) => (
              <option key={idx} value={idx}>{name}</option>
            ))}
          </select>
          <button
            onClick={handleTestSound}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors shrink-0"
            title="Test sound"
          >
            <Music className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMuteToggle}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              muted ? 'bg-red-900/60 text-red-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="w-12 sm:w-16 accent-indigo-500"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>

        {/* Score badge + Team score + Leave */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {teamsEnabled && myTeam && (
            <div
              className={`rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 text-sm font-mono border flex items-center gap-1.5 transition-all duration-500 ${
                teamScoreAnim === 'up'
                  ? 'bg-green-700 scale-110 ring-2 ring-green-400 shadow-lg shadow-green-500/40 border-green-500/40'
                  : teamScoreAnim === 'down'
                  ? 'bg-red-700 scale-110 ring-2 ring-red-400 shadow-lg shadow-red-500/40 border-red-500/40'
                  : 'bg-pink-900/50 border-pink-700/40'
              }`}
              onTransitionEnd={() => setTeamScoreAnim(null)}
            >
              <UsersRound className="w-3.5 h-3.5 text-pink-400" />
              <span className="text-pink-300 text-xs font-semibold">{myTeam.name}</span>
              <span className={`font-bold transition-colors duration-500 ${
                teamScoreAnim === 'up' ? 'text-green-300' : teamScoreAnim === 'down' ? 'text-red-300' : 'text-yellow-400'
              }`}>{myTeamScore}</span>
            </div>
          )}
          {!(teamsEnabled && myTeam) && (
          <div
            className={`rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 text-sm font-mono transition-all duration-500 ${
              scoreAnim === 'up'
                ? 'bg-green-700 scale-110 ring-2 ring-green-400 shadow-lg shadow-green-500/40'
                : scoreAnim === 'down'
                ? 'bg-red-700 scale-110 ring-2 ring-red-400 shadow-lg shadow-red-500/40'
                : 'bg-gray-800'
            }`}
            onTransitionEnd={() => setScoreAnim(null)}
          >
            Score: <span className={`font-bold transition-colors duration-500 ${
              scoreAnim === 'up' ? 'text-green-300' : scoreAnim === 'down' ? 'text-red-300' : 'text-yellow-400'
            }`}>{myScore}</span>
          </div>
          )}
          <button
            onClick={leaveRoom}
            className="bg-red-900 hover:bg-red-800 rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 text-sm transition-colors flex items-center gap-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode indicator */}
      <div className="text-xs uppercase tracking-widest text-gray-500">
        Mode: {MODE_LABELS[gameState.currentMode] || gameState.currentMode}
        {' · '}
        {gameState.raceMode ? 'Race' : 'Solo'}
      </div>

      {renderModeUI()}

      {/* Teammates panel */}
      {teamsEnabled && myTeam && teammates.length > 0 && (
        <div className="w-full max-w-md bg-pink-900/20 border border-pink-800/30 rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-pink-300 uppercase tracking-wider mb-2">
            <UsersRound className="w-3.5 h-3.5" />
            Teammates
          </div>
          <div className="space-y-1.5">
            {teammates.map((mate) => {
              const mateBuzz = gameState.buzzes.find((b) => b.playerId === mate.id);
              const mateRank = mateBuzz ? gameState.buzzes.indexOf(mateBuzz) + 1 : null;
              const mateAnswer = gameState.playerAnswers?.[mate.id];
              return (
                <div key={mate.id} className="flex items-center gap-2 text-sm bg-gray-900/60 rounded-lg px-3 py-1.5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${mateRank ? 'bg-green-400' : 'bg-gray-600'}`} />
                  <span className="font-medium text-gray-200 truncate max-w-[100px]">{mate.name}</span>
                  {mateRank && (
                    <span className="text-xs text-green-400 font-mono">#{mateRank}</span>
                  )}
                  {mateAnswer?.submitted && (
                    <span className="text-xs text-indigo-400">
                      <CheckCircle className="w-3 h-3 inline" /> Submitted
                    </span>
                  )}
                  {mate.text && (
                    <span className="ml-auto text-xs text-gray-500 truncate max-w-[100px]" title={mate.text}>{mate.text}</span>
                  )}
                  <span className="ml-auto text-xs font-mono text-yellow-400">{mate.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Text input area */}
      <div className="w-full max-w-md flex gap-2">
        <div className="relative flex-1">
          <Type className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={localText}
            onChange={handleTextChange}
            disabled={!gameState.inputEnabled || buzzed}
            placeholder={
              gameState.inputEnabled
                ? 'Type your answer...'
                : 'Input disabled by QM'
            }
            className={`
              w-full pl-10 pr-4 py-3 rounded-xl border text-white placeholder-gray-500
              focus:outline-none transition-colors
              ${
                gameState.inputEnabled && !buzzed
                  ? 'bg-gray-800 border-gray-600 focus:border-indigo-500'
                  : 'bg-gray-900 border-gray-800 cursor-not-allowed opacity-50'
              }
            `}
          />
        </div>
      </div>

      {/* History */}
      <div className="w-full max-w-md mt-4">
        <button
          onClick={() => setShowHistory((h) => !h)}
          className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-full"
        >
          <Clock className="w-3 h-3" />
          My History ({history.length})
          <span className="ml-auto text-gray-600">{showHistory ? '▼' : '▶'}</span>
        </button>
        {showHistory && (
          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
            {history.length === 0 && (
              <p className="text-gray-600 text-xs italic">No history yet</p>
            )}
            {[...history].reverse().map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs p-2 bg-gray-800/50 rounded-lg">
                <span className="text-gray-600 font-mono shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-gray-300">{entry.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
