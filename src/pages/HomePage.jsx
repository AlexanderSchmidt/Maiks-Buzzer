import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, UserPlus, Crown } from 'lucide-react';

const SESSION_KEY = 'buzzmaster_session';

function saveSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

export default function HomePage() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [nameError, setNameError] = useState(false);
  const navigate = useNavigate();

  const validateName = () => {
    if (!name.trim()) {
      setNameError(true);
      return false;
    }
    setNameError(false);
    return true;
  };

  const handleJoinPlayer = () => {
    if (!validateName()) return;
    if (!roomCode.trim()) return;
    const roomId = roomCode.trim().toUpperCase();
    saveSession({ roomId, name: name.trim(), role: 'player' });
    navigate(`/room/${roomId}`);
  };

  // Spectators can only join via the secure link shared by the QM

  const handleCreateRoom = () => {
    if (!validateName()) return;
    // Session will be written by the store after the server responds with a roomId
    navigate(`/create`);
    // Stash the name temporarily so CreateRoomPage can read it
    saveSession({ name: name.trim(), role: 'quizmaster', roomId: null });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-red-500 flex items-center justify-center shadow-lg shadow-red-500/30">
              <Zap className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Maik&apos;s <span className="text-yellow-400">Buzzer</span>
          </h1>
          <p className="text-gray-500 mt-2">Real-time Quiz Buzzer</p>
        </div>

        {/* Name input */}
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">
            Your Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setNameError(false);
            }}
            placeholder="Enter your name"
            className={`w-full px-4 py-3 rounded-xl bg-gray-900 border focus:outline-none text-white placeholder-gray-600 transition-colors ${
              nameError
                ? 'border-red-500 focus:border-red-400'
                : 'border-gray-800 focus:border-indigo-500'
            }`}
          />
          {nameError && (
            <p className="text-red-400 text-xs mt-1">Please enter your name to continue.</p>
          )}
        </div>

        {/* Create Room */}
        <button
          onClick={handleCreateRoom}
          className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-lg transition-all shadow-lg shadow-indigo-500/20"
        >
          <Crown className="w-5 h-5" />
          Create Room (Quiz Master)
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-sm text-gray-600 uppercase">or join</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Join Room */}
        <div className="space-y-3">
          <label className="block text-sm text-gray-400 mb-1.5">Room Code</label>
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3"
            maxLength={6}
            className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 focus:border-yellow-500 focus:outline-none text-white text-center text-2xl font-mono tracking-[0.3em] placeholder-gray-600 placeholder:text-base placeholder:tracking-normal"
          />

          <button
            onClick={handleJoinPlayer}
            disabled={!roomCode.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed font-semibold transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Join as Player
          </button>
          <p className="text-xs text-gray-600 text-center">Spectators join via the secure link from the Quiz Master</p>
        </div>
      </div>
    </div>
  );
}
