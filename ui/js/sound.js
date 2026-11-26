// Provenance and license for each clip: ui/ready-fanfare-source.md for the
// fanfare, ui/sounds/SOURCES.md for the clips beside it.

// What Settings > Sounds offers for each event, in the order shown. The ids
// are saved in Orc's config, so one stays as it is once it has shipped.
export const SOUNDS = [
  { id: 'fanfare', label: 'Fanfare', clip: '/ready-fanfare.wav' },
  { id: 'two-note', label: 'Two-note tone', tone: { wave: 'sine', gain: 0.2, notes: [[440, 0.12], [349.23, 0.12]] } },
  ...[['level-up', 'Level up'], ['ta-da', 'Ta-da'], ['ka-ching', 'Ka-ching'], ['war-horn', 'War horn'],
    ['kazoo', 'Kazoo'], ['sparkle', 'Sparkle'], ['bubble-pop', 'Bubble pop'],
    ['wooden-double-tap', 'Wooden double tap'], ['glass-chime', 'Glass chime'], ['home-chord', 'Home chord'],
    ['reed-call', 'Reed call'], ['thumb-piano', 'Thumb piano'], ['sonar-ping', 'Sonar ping'],
    ['pocket-drum', 'Pocket drum'], ['silver-string', 'Silver string'],
    ['clockwork', 'Clockwork'], ['steam-whistle', 'Steam whistle'], ['bass-bloom', 'Bass bloom'],
  ].map(([id, label]) => ({ id, label, clip: `/sounds/${id}.mp3` })),
];
export const NO_SOUND = 'none';
// The last option of each event's select in Settings: choosing it opens a
// file picker rather than choosing a sound, so it is never saved.
export const ADD_SOUND = 'add-sound';
// Sound files someone added in Settings, kept on the Mac running Orc
// (~/.orc/sounds/). Each is { id: 'custom:<file>', label, url }; /api/config
// lists them as customSounds.
let customSounds = [];
export function setCustomSounds(list) {
  customSounds = Array.isArray(list)
    ? list.filter(sound => typeof sound?.id === 'string' && sound.id.startsWith('custom:') && typeof sound.url === 'string')
      .map(sound => ({ id: sound.id, label: String(sound.label || sound.id.slice(7)), clip: sound.url, custom: true }))
    : [];
}
// SOUNDS, then the added ones: every sound an event can be set to here.
export const allSounds = () => [...SOUNDS, ...customSounds];
// The run events that can make a sound, named as run-presentation.js names
// their edges. `sound` is what plays until someone chooses otherwise.
export const SOUND_EVENTS = [
  { id: 'attention', label: 'Input is needed', hint: 'A run stopped and is waiting on you.', sound: NO_SOUND },
  { id: 'ship', label: 'Ready to merge', hint: 'A run finished and is waiting for you to deliver it.', sound: 'fanfare' },
  { id: 'merged', label: 'Merged', hint: 'A run’s branch or pull request merged.', sound: NO_SOUND },
  { id: 'plan', label: 'Plan is ready', hint: 'A plan is written and waiting for you to read it.', sound: NO_SOUND },
];

const TONES = {
  // Plays when Sound effects is switched on: a rising boing, then a quick
  // major arpeggio.
  soundsOn: { wave: 'triangle', gain: 0.16, notes: [[330, 0.1, 660], [523.25, 0.07], [659.25, 0.07], [783.99, 0.07], [1046.5, 0.2]] },
};

// ui.eventSounds in Orc's config: { <event id>: <sound id> or 'none' }.
let eventSounds = {};
export function setEventSounds(choices) {
  eventSounds = choices && typeof choices === 'object' ? choices : {};
}
// A sound this Orc does not have, such as one a newer Orc saved from another
// computer or an added sound since removed, reads as the event's default.
export function eventSound(event, choices = eventSounds) {
  const chosen = Object.hasOwn(Object(choices), event) ? choices[event] : null;
  if (chosen === NO_SOUND || allSounds().some(sound => sound.id === chosen)) return chosen;
  return SOUND_EVENTS.find(item => item.id === event)?.sound || NO_SOUND;
}
// What ui.eventSounds becomes once Settings' rows are read, or undefined when
// every event is at its default. `chosen(id)` is the value of an event's row.
export function eventSoundsToSave(saved, chosen) {
  const next = saved && typeof saved === 'object' ? { ...saved } : {};
  for (const event of SOUND_EVENTS) {
    const value = chosen(event.id);
    // A row left as it was keeps what is saved, which may be a sound only a
    // newer Orc on another computer has. So does a value that is no sound,
    // such as a row's "Your own sound…" while its file picker is open.
    if (!value || value === eventSound(event.id, next)) continue;
    if (value !== NO_SOUND && !allSounds().some(sound => sound.id === value)) continue;
    if (value === event.sound) delete next[event.id];
    else next[event.id] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

const START_TIMEOUT_MS = 1500;

// Stored in this browser rather than Orc's config, so every browser and the
// desktop app keep their own level.
const VOLUME_KEY = 'orcSoundVolume';

export function soundVolume() {
  try {
    const value = parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isNaN(value) ? 1 : Math.min(Math.max(value, 0), 1);
  } catch {
    return 1;
  }
}

export function setSoundVolume(value) {
  try { localStorage.setItem(VOLUME_KEY, String(value)); } catch {}
}

let ctx = null;
export function soundContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx || ctx.state === 'closed') ctx = new Ctor();
  return ctx;
}

async function playClip(src, volume) {
  let timer;
  let gaveUp = false;
  try {
    const Ctor = window.Audio;
    if (!Ctor) return false;
    const audio = new Ctor(src);
    audio.preload = 'auto';
    audio.volume = volume;
    const playing = Promise.resolve(audio.play()).then(() => {
      // Playback that only starts after we reported failure would sound late.
      if (gaveUp) audio.pause();
      return true;
    });
    const started = await Promise.race([
      playing,
      new Promise(resolve => { timer = setTimeout(() => resolve(false), START_TIMEOUT_MS); }),
    ]);
    if (!started) {
      gaveUp = true;
      audio.pause();
      playing.catch(() => {});
    }
    return started;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function playTone(tone, volume) {
  let resumeTimer;
  try {
    const audioCtx = soundContext();
    if (!audioCtx) return false;
    if (audioCtx.state !== 'running') {
      // WebKit can leave resume pending while playback is blocked.
      await Promise.race([
        audioCtx.resume(),
        new Promise(resolve => { resumeTimer = setTimeout(resolve, START_TIMEOUT_MS); }),
      ]);
    }
    if (audioCtx.state !== 'running') return false;
    let start = audioCtx.currentTime;
    tone.notes.forEach(([freq, duration, glideTo]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = tone.wave;
      osc.frequency.value = freq;
      if (glideTo) {
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
      }
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain * volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
      start += duration;
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(resumeTimer);
  }
}

// A recorded line of the assistant's, at the same level as every other sound.
export const playVoice = src => playClip(src, soundVolume());

// One of allSounds() by id, whatever any event is set to.
export async function playChoice(id) {
  const sound = allSounds().find(item => item.id === id);
  if (!sound) return false;
  return sound.clip ? playClip(sound.clip, soundVolume()) : playTone(sound.tone, soundVolume());
}

export async function playSound(kind) {
  if (SOUND_EVENTS.some(event => event.id === kind)) return playChoice(eventSound(kind));
  const tone = TONES[kind];
  return tone ? playTone(tone, soundVolume()) : false;
}
