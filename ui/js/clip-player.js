import { mediaKind } from './chat-timeline.js';

// One player for the page, so starting a run's clips stops any others. The
// chat's clip button and the Assets tab both drive it, so they always agree
// about what is playing.
let current = null;   // { runId, paths, urlFor, index, media, paused, pendingAt, failed }
let lastError = null; // { runId, message }
const listeners = new Set();
const timeListeners = new Set();

const notify = () => listeners.forEach(fn => fn());
const notifyTime = () => timeListeners.forEach(fn => fn());
const fileName = clip => clip.split('/').pop();

export function onClipChange(fn) {
  listeners.add(fn);
}

// The clip's clock ticking and seeks landing, kept apart from onClipChange so
// the chat does not redraw on every tick.
export function onClipTime(fn) {
  timeListeners.add(fn);
}

export function clipPlayback(runId) {
  if (current?.runId !== runId) return null;
  const { media } = current;
  return {
    path: current.paths[current.index], index: current.index, count: current.paths.length,
    paused: current.paused, media,
    time: current.pendingAt ?? (media?.currentTime || 0),
    duration: Number.isFinite(media?.duration) ? media.duration : null,
  };
}

export function clipError(runId) {
  return lastError?.runId === runId ? lastError.message : null;
}

// Plays `paths` in turn from `index`, `at` seconds in. `paused` cues the clip
// without starting it, for a seek or a step while paused.
export function playClips(runId, paths, urlFor, { index = 0, at = 0, paused = false } = {}) {
  stopClips({ quiet: true });
  lastError = null;
  current = { runId, paths, urlFor, index: index - 1, media: null, paused, pendingAt: at || null, failed: [] };
  advance(current);
}

export function stopClips({ quiet = false } = {}) {
  if (!current) return;
  current.media?.pause();
  current = null;
  if (!quiet) notify();
}

export function setClipsPaused(paused) {
  if (!current || current.paused === paused) return;
  const playback = current;
  playback.paused = paused;
  if (paused) playback.media.pause();
  else {
    Promise.resolve(playback.media.play()).catch(() => {
      if (current !== playback) return;
      playback.paused = true;
      notify();
    });
  }
  notify();
}

export function seekClip(seconds) {
  if (!current?.media) return;
  const { media } = current;
  const end = Number.isFinite(media.duration) ? media.duration : Infinity;
  const at = Math.max(0, Math.min(seconds, end));
  // Before its metadata a clip can't seek; it starts there once it can.
  if (media.readyState >= 1) media.currentTime = at;
  else current.pendingAt = at;
  notifyTime();
}

function mediaFor(clip, src) {
  if (mediaKind(clip) !== 'video') return new window.Audio(src);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.src = src;
  return video;
}

function advance(playback) {
  if (current !== playback) return;
  playback.index++;
  if (playback.index >= playback.paths.length) {
    if (playback.failed.length) {
      lastError = { runId: playback.runId, message: `Couldn't play ${playback.failed.map(fileName).join(', ')}` };
    }
    current = null;
    notify();
    return;
  }
  const clip = playback.paths[playback.index];
  const media = mediaFor(clip, playback.urlFor(playback.runId, clip));
  playback.media = media;
  let settled = false;
  const live = () => current === playback && playback.media === media;
  const next = failed => {
    if (settled || !live()) return;
    settled = true;
    if (failed) playback.failed.push(clip);
    playback.pendingAt = null;
    advance(playback);
  };
  media.addEventListener('ended', () => next(false));
  media.addEventListener('error', () => next(true));
  media.addEventListener('loadedmetadata', () => {
    if (!live()) return;
    if (playback.pendingAt !== null) media.currentTime = playback.pendingAt;
    playback.pendingAt = null;
    notify();
  });
  for (const type of ['timeupdate', 'seeked']) media.addEventListener(type, () => { if (live()) notifyTime(); });
  // A pause from outside, such as a media key, shows as paused too. The
  // pause that comes with a clip's end is not one.
  media.addEventListener('pause', () => {
    if (!live() || media.ended || playback.paused) return;
    playback.paused = true;
    notify();
  });
  media.addEventListener('play', () => {
    if (!live() || !playback.paused) return;
    playback.paused = false;
    notify();
  });
  // A pause before play() settles rejects it too, which is no failure.
  if (!playback.paused) Promise.resolve(media.play()).catch(() => { if (!playback.paused) next(true); });
  notify();
}
