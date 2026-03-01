import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Send, Type, Check, CheckCircle, Clock, LogOut, Volume2, VolumeX, UsersRound, Lock, Trophy, ChevronDown, ChevronRight } from 'lucide-react';
import { loadSoundPrefs, saveSoundPrefs, resolveSoundId, playBuzzSound } from '../sounds';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function PlayerView({ store }) {
  const { t } = useTranslation();
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
    teams,
    playerTeams,
    teamsEnabled,
    teamScores,
    scores,
  } = store;

  const history = (store.history || []).filter((h) => h.playerId === playerId);
  const [localText, setLocalText] = useState('');
  const [buzzed, setBuzzed] = useState(false);
  const [buzzRank, setBuzzRank] = useState(null);
  const [selectedMcIndex, setSelectedMcIndex] = useState(null);
  const [sliderValue, setSliderValue] = useState(null);

  const [showHistory, setShowHistory] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const throttleRef = useRef(null);
  const prevBuzzCountRef = useRef(0);

  // Sound preferences (persisted in localStorage)
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

  // Reset local inputs when QM uses resetPlayer (server clears text & answer)
  const me = players.find((p) => p.id === playerId);
  useEffect(() => {
    if (me && me.text === '' && !myAnswer) {
      setLocalText('');
      setSelectedMcIndex(null);
      setSliderValue(null);
    }
  }, [me?.text, myAnswer]);

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

  // Play sound when I buzz (use server-assigned soundId from the buzz data)
  useEffect(() => {
    if (myBuzz && !muted && buzzed) {
      const resolved = resolveSoundId(myBuzz.soundId || me?.soundId || 1, playerId);
      playBuzzSound(resolved, volume);
    }
  }, [buzzed]); // only fire when buzzed flips to true

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
                ? (gameState.showBuzzToPlayers !== false ? `#${buzzRank}!` : t('player.buzzed'))
                : (!gameState.raceMode && gameState.lockedOut)
                ? t('player.locked')
                : t('player.buzzButton')}
            </button>
          </div>
        );

      case 'MULTIPLE_CHOICE':
        if (!gameState.mcOptionsLocked) {
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
              <h2 className="text-xl font-bold text-purple-400">{t('player.multipleChoice')}</h2>
              <p className="text-gray-500 text-sm">{t('player.waitingForOptions')}</p>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-4 w-full max-w-md">
            <h2 className="text-xl font-bold text-purple-400">{t('player.multipleChoice')}</h2>
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
                <Lock className="w-5 h-5" /> {t('player.anotherPlayerSubmitted')}
              </div>
            ) : !isSubmitted ? (
              <button
                onClick={handleMcSubmit}
                disabled={selectedMcIndex === null}
                className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5" /> {t('player.submitAnswer')}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                <CheckCircle className="w-5 h-5" /> {t('player.answerSubmitted')}
              </div>
            )}
          </div>
        );

      case 'GUESS':
        if (!gameState.sliderLocked) {
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-md">
              <h2 className="text-xl font-bold text-blue-400">{t('player.guess')}</h2>
              <p className="text-gray-500 text-sm">{t('player.waitingForRange')}</p>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-blue-400">{t('player.guess')}</h2>
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
              placeholder={t('player.typeANumber')}
              className="w-32 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 focus:border-blue-500 focus:outline-none text-white text-center text-xl font-mono disabled:opacity-50"
            />
            {!isSubmitted ? (
              <button
                onClick={handleSliderSubmit}
                disabled={sliderValue === null}
                className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold transition-colors flex items-center gap-2"
              >
                <Send className="w-5 h-5" /> {t('common.submit')}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                <CheckCircle className="w-5 h-5" /> {t('player.answerSubmitted')}
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
          <button
            onClick={handleMuteToggle}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              muted ? 'bg-red-900/60 text-red-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
            title={muted ? t('player.unmute') : t('player.mute')}
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
            title={t('common.volumePercent', { percent: Math.round(volume * 100) })}
          />
        </div>

        {/* Score badge + Leave */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {!teamsEnabled && (
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
            {t('common.score')}: <span className={`font-bold transition-colors duration-500 ${
              scoreAnim === 'up' ? 'text-green-300' : scoreAnim === 'down' ? 'text-red-300' : 'text-yellow-400'
            }`}>{myScore}</span>
          </div>
          )}
          <LanguageSwitcher />
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
        {t('common.mode')}: {t(`modes.${gameState.currentMode}`)}
        {' · '}
        {gameState.raceMode ? t('player.race') : t('player.solo')}
      </div>

      {renderModeUI()}

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
                ? t('player.typeYourAnswer')
                : t('player.inputDisabled')
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

      {/* Scores section */}
      {teamsEnabled && (() => {
        const playerList = players.filter((p) => p.role === 'player');
        // Group players by team
        const teamEntries = Object.entries(teams);
        const unassigned = playerList.filter((p) => !playerTeams[p.id]);
        return (
          <div className="w-full max-w-md">
            <button
              onClick={() => setShowScores((s) => !s)}
              className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-full"
            >
              {showScores ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Trophy className="w-3 h-3 text-yellow-400" />
              {t('common.scores')}
              <span className="ml-auto text-gray-600">{showScores ? '▼' : '▶'}</span>
            </button>
            {showScores && (
              <div className="mt-2 space-y-3">
                {/* Team sections */}
                {teamEntries.map(([teamId, team]) => {
                  const teamPlayers = playerList.filter((p) => playerTeams[p.id] === teamId);
                  const tScore = teamScores[teamId] ?? 0;
                  const isMyTeam = teamId === myTeamId;
                  return (
                    <div key={teamId} className={`rounded-xl p-3 border ${
                      isMyTeam
                        ? 'bg-pink-900/30 border-pink-700/40'
                        : 'bg-gray-800/40 border-gray-700/30'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <UsersRound className={`w-3.5 h-3.5 ${isMyTeam ? 'text-pink-400' : 'text-gray-500'}`} />
                          <span className={`text-sm font-semibold ${isMyTeam ? 'text-pink-300' : 'text-gray-300'}`}>{team.name}</span>
                        </div>
                        <span className={`text-sm font-mono font-bold ${
                          isMyTeam
                            ? (teamScoreAnim === 'up' ? 'text-green-300' : teamScoreAnim === 'down' ? 'text-red-300' : 'text-yellow-400')
                            : 'text-yellow-400'
                        }`}>{tScore}</span>
                      </div>
                      <div className="space-y-1">
                        {teamPlayers.map((p) => (
                          <div key={p.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 ${
                            p.id === playerId ? 'bg-indigo-900/30' : 'bg-gray-900/40'
                          }${p.connected === false ? ' opacity-50' : ''}`}>
                            <div className={`w-2 h-2 rounded-full shrink-0 ${
                              p.connected === false ? 'bg-red-500' : gameState.buzzes.find((b) => b.playerId === p.id) ? 'bg-green-400' : 'bg-gray-600'
                            }`} title={p.connected === false ? t('status.disconnected') : gameState.buzzes.find((b) => b.playerId === p.id) ? t('status.buzzed') : t('status.idle')} />
                            <span className={`font-medium truncate max-w-[120px] ${
                              p.id === playerId ? 'text-indigo-300' : 'text-gray-300'
                            }`}>{p.name}{p.id === playerId ? ` (${t('common.you')})` : ''}</span>
                            <span className="ml-auto text-xs font-mono text-yellow-400">{p.score}</span>
                          </div>
                        ))}
                        {teamPlayers.length === 0 && (
                          <p className="text-xs text-gray-600 italic px-3">{t('player.noPlayers')}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Unassigned players */}
                {unassigned.length > 0 && (
                  <div className="rounded-xl p-3 border bg-gray-800/40 border-gray-700/30">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-gray-400">{t('player.unassigned')}</span>
                    </div>
                    <div className="space-y-1">
                      {unassigned.map((p) => (
                        <div key={p.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 ${
                          p.id === playerId ? 'bg-indigo-900/30' : 'bg-gray-900/40'
                        }${p.connected === false ? ' opacity-50' : ''}`}>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            p.connected === false ? 'bg-red-500' : gameState.buzzes.find((b) => b.playerId === p.id) ? 'bg-green-400' : 'bg-gray-600'
                          }`} title={p.connected === false ? t('status.disconnected') : gameState.buzzes.find((b) => b.playerId === p.id) ? t('status.buzzed') : t('status.idle')} />
                          <span className={`font-medium truncate max-w-[120px] ${
                            p.id === playerId ? 'text-indigo-300' : 'text-gray-300'
                          }`}>{p.name}{p.id === playerId ? ` (${t('common.you')})` : ''}</span>
                          <span className="ml-auto text-xs font-mono text-yellow-400">{p.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* History */}
      <div className="w-full max-w-md mt-4">
        <button
          onClick={() => setShowHistory((h) => !h)}
          className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider w-full"
        >
          <Clock className="w-3 h-3" />
          {t('player.myHistory', { count: history.length })}
          <span className="ml-auto text-gray-600">{showHistory ? '▼' : '▶'}</span>
        </button>
        {showHistory && (
          <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
            {history.length === 0 && (
              <p className="text-gray-600 text-xs italic">{t('common.noHistoryYet')}</p>
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
