// ─── Buzzer Sound Utilities ──────────────────────────────────────────────────

export const SOUND_COUNT = 9;

export const SOUND_NAMES = [
  'Random',       // 0 = random
  'Buzz 1',       // 1
  'Buzz 2',       // 2
  'Buzz 3',       // 3
  'Buzz 4',       // 4
  'Buzz 5',       // 5
  'Buzz 6',       // 6
  'Buzz 7',       // 7
  'Buzz 8',       // 8
  'Buzz 9',       // 9
];

const STORAGE_KEY = 'buzzmaster_sound_prefs';

export function loadSoundPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSoundPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

/**
 * Get the actual sound index (1-9) from a selection (0 = random, 1-9 = specific).
 * When a playerId is provided and selection is 0, derives a stable sound from the ID.
 */
export function resolveSoundId(selection, playerId) {
  if (!selection || selection === 0) {
    if (playerId) {
      // Derive a stable hash from the playerId string
      let hash = 0;
      for (let i = 0; i < playerId.length; i++) {
        hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
      }
      return (Math.abs(hash) % SOUND_COUNT) + 1;
    }
    return Math.floor(Math.random() * SOUND_COUNT) + 1;
  }
  return selection;
}

/**
 * Play a buzzer sound.
 * @param {number} soundId  1-9 sound file index
 * @param {number} volume   0.0 - 1.0
 * @returns {HTMLAudioElement|null}
 */
export function playBuzzSound(soundId, volume = 0.7) {
  try {
    const resolved = soundId >= 1 && soundId <= 9 ? soundId : resolveSoundId(0);
    const audio = new Audio(`/sounds/buzz${resolved}.mp3`);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}
