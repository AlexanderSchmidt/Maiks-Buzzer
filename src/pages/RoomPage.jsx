import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, UserPlus, Eye } from 'lucide-react';
import useQuizStore from '../hooks/useQuizStore';
import PlayerView from '../views/PlayerView';
import QuizMasterView from '../views/QuizMasterView';
import SpectatorView from '../views/SpectatorView';
import LanguageSwitcher from '../components/LanguageSwitcher';

const SESSION_KEY = 'buzzmaster_session';

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

export default function RoomPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useQuizStore();
  const { t } = useTranslation();
  const [joined, setJoined] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [linkRole, setLinkRole] = useState(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [spectatorToken, setSpectatorToken] = useState(null);
  const [wasInRoom, setWasInRoom] = useState(false);

  // Track when we've actually been in a room (join completed)
  useEffect(() => {
    if (store.roomId) setWasInRoom(true);
  }, [store.roomId]);

  useEffect(() => {
    if (!id) return;
    if (joined) return;
    // If the store already has a roomId (e.g. from session auto-rejoin), skip
    if (store.roomId) {
      setJoined(true);
      return;
    }

    const session = loadSession();
    if (session?.name && session?.role) {
      const tryJoin = () => {
        if (store.connected && !joined) {
          store.joinRoom(id, session.name, session.role, session.spectatorToken || null);
          setJoined(true);
        }
      };

      tryJoin();
      const interval = setInterval(tryJoin, 200);
      return () => clearInterval(interval);
    }

    // No session — check URL query param for direct link
    const role = searchParams.get('role');
    const token = searchParams.get('token');
    if (role === 'player' || role === 'spectator') {
      setLinkRole(role);
      if (token) setSpectatorToken(token);
      setNeedsName(true);
    } else {
      navigate('/');
    }
  }, [id, store.connected, joined, store.roomId]);

  const handleJoinFromLink = () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    saveSession({ roomId: id, name: name.trim(), role: linkRole, spectatorToken: spectatorToken || null });
    setNeedsName(false);

    const doJoin = () => {
      store.joinRoom(id, name.trim(), linkRole, spectatorToken);
      setJoined(true);
    };

    if (store.connected) {
      doJoin();
    } else {
      const interval = setInterval(() => {
        if (store.connected) {
          doJoin();
          clearInterval(interval);
        }
      }, 200);
    }
  };

  // Name gate for direct link join
  if (needsName) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-end">
            <LanguageSwitcher />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-1">{t('roomPage.joinRoom')}</h1>
            <p className="text-sm text-gray-500">
              {t('common.room')}: <span className="font-mono text-yellow-400">{id}</span>
              {' · '}
              <span className="text-gray-400">
                {linkRole === 'spectator' ? t('common.spectator') : t('common.player')}
              </span>
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              {t('roomPage.yourName')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value.trim()) setNameError(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinFromLink()}
              placeholder={t('roomPage.enterYourName')}
              autoFocus
              className={`w-full px-4 py-3 rounded-xl bg-gray-900 border focus:outline-none text-white placeholder-gray-600 transition-colors ${
                nameError
                  ? 'border-red-500 focus:border-red-400'
                  : 'border-gray-800 focus:border-indigo-500'
              }`}
            />
            {nameError && (
              <p className="text-red-400 text-xs mt-1">{t('roomPage.nameRequired')}</p>
            )}
          </div>
          <button
            onClick={handleJoinFromLink}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-700 hover:bg-green-600 font-bold transition-colors"
          >
            {linkRole === 'spectator' ? (
              <Eye className="w-5 h-5" />
            ) : (
              <UserPlus className="w-5 h-5" />
            )}
            {linkRole === 'spectator' ? t('roomPage.joinAsSpectator') : t('roomPage.joinAsPlayer')}
          </button>
        </div>
      </div>
    );
  }

  // Kicked
  if (store.kicked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-red-400 text-lg">{t('roomPage.kicked')}</p>
        <button
          onClick={() => { store.clearKicked(); navigate('/'); }}
          className="px-6 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors"
        >
          {t('common.backToHome')}
        </button>
      </div>
    );
  }

  // Show error
  if (store.error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-red-400 text-lg">{store.error}</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors"
        >
          {t('common.backToHome')}
        </button>
      </div>
    );
  }

  // Loading / left room
  if (!store.roomId) {
    // If we were previously in a room and now roomId is gone, user left — redirect home
    if (wasInRoom && !store.kicked && !store.error) {
      navigate('/');
      return null;
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-gray-500">{t('roomPage.joiningRoom', { id })}</p>
      </div>
    );
  }

  // Render view based on role
  switch (store.role) {
    case 'quizmaster':
      return <QuizMasterView store={store} />;
    case 'spectator':
      return <SpectatorView store={store} />;
    case 'player':
    default:
      return <PlayerView store={store} />;
  }
}
