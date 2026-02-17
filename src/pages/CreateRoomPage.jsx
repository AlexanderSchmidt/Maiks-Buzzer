import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import useQuizStore from '../hooks/useQuizStore';
import QuizMasterView from '../views/QuizMasterView';

const SESSION_KEY = 'buzzmaster_session';

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function CreateRoomPage() {
  const navigate = useNavigate();
  const store = useQuizStore();
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (created) return;
    // If already in a room from session auto-rejoin, just show it
    if (store.roomId && store.role === 'quizmaster') {
      setCreated(true);
      return;
    }

    const session = loadSession();
    const name = session?.name || 'Quiz Master';

    if (!session?.name) {
      navigate('/');
      return;
    }

    const tryCreate = () => {
      if (store.connected && !created) {
        store.createRoom(name);
        setCreated(true);
      }
    };

    tryCreate();
    const interval = setInterval(tryCreate, 200);
    return () => clearInterval(interval);
  }, [store.connected, created, store.roomId]);

  // Once room is created, redirect to the room URL so refresh works
  useEffect(() => {
    if (store.roomId && created) {
      navigate(`/room/${store.roomId}`, { replace: true });
    }
  }, [store.roomId, created, navigate]);

  if (!store.roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-gray-500">Creating room...</p>
      </div>
    );
  }

  return <QuizMasterView store={store} />;
}
