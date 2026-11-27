// Settings a chat changed (ui/chat_settings.py), followed by every open page.
// The assistant's chat and a run's Chat change a setting the user plainly asked for;
// the host bumps a revision, and this page polls it. On a new revision it
// applies the browser settings the host holds (Factory visuals, animations,
// send-offs), pulls the host theme and re-reads config.json. A flip of one of
// those browser settings in this page's own Settings goes up to the host, so
// every other browser and device follows it too.

import { applyUiConfig } from './panel-navigation.js';
import { fetchConfigData } from './config-data.js';
import { pullHostTheme } from './host-theme.js';
import { animationsOff, factoryVisualsEnabled, onFactoryVisualsChange, onReducedMotionChange, setAnimationsOff, setFactoryVisualsEnabled } from './motion.js';
import { showSidebarUsage } from './provider-usage.js';
import { onSendOffsChange, sendOffsEnabled, setSendOffsEnabled } from './send-offs.js';

const POLL_MS = 4000;
const BROWSER = {
  factoryVisuals: { read: factoryVisualsEnabled, write: setFactoryVisualsEnabled, fallback: () => true },
  animations: { read: () => !animationsOff(), write: on => setAnimationsOff(!on), fallback: () => window.ORC_HOST_ANIMATIONS_OFF !== true },
  sendOffs: { read: sendOffsEnabled, write: setSendOffsEnabled, fallback: () => false },
};

let rev = null;
let following = false;
let polling = false;
const sent = {};

function followPrefs(prefs) {
  following = true;
  try {
    for (const [key, setting] of Object.entries(BROWSER)) {
      if (typeof prefs[key] !== 'boolean') continue;
      sent[key] = prefs[key];
      if (setting.read() !== prefs[key]) setting.write(prefs[key]);
    }
  } finally {
    following = false;
  }
}

async function followConfig() {
  const data = await fetchConfigData({ fresh: true });
  applyUiConfig(data.config);
  showSidebarUsage(globalThis.ORC_SHOW_USAGE !== false);
}

// Applies whatever moved since the last revision this page saw. The first
// answer only records the revision, since index.html already painted from the
// host, and hands the host this browser's own choice of any setting it does
// not hold yet, as host-theme.js does with the theme: a browser left at the
// default sends nothing, so it cannot overwrite another's choice.
export function followChatSettings(state) {
  if (!state || typeof state.rev !== 'number') return;
  const first = rev === null;
  const moved = rev !== state.rev;
  const prefs = state.prefs || {};
  rev = state.rev;
  followPrefs(prefs);
  if (first) {
    for (const [key, setting] of Object.entries(BROWSER)) {
      if (typeof prefs[key] === 'boolean' || setting.read() === setting.fallback()) continue;
      delete sent[key];
      pushLocal(key);
    }
  }
  if (first || !moved) return;
  pullHostTheme();
  followConfig().catch(() => {});
}

async function poll() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const res = await fetch('/api/chat-settings/state', { cache: 'no-store' });
    if (res.ok) followChatSettings(await res.json());
  } catch {
    // Unreachable host: keep what is on screen until the next poll.
  } finally {
    polling = false;
  }
}

function pushLocal(key) {
  if (following || rev === null) return;
  const value = BROWSER[key].read();
  if (sent[key] === value) return;
  sent[key] = value;
  fetch('/api/chat-settings/prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  }).then(res => res.ok ? res.json() : null).then(state => { if (state) rev = state.rev; }).catch(() => {});
}

// Puts back the value a chat's change replaced. Answers the change, or throws
// the host's reason.
export async function undoSettingChange(id) {
  const res = await fetch('/api/chat-settings/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Could not undo that change.'), { status: res.status });
  poll();
  return body.change;
}

export function startChatSettings() {
  if (!['default', 'demo'].includes(window.ORC_INSTANCE?.kind)) return;
  for (const key of Object.keys(BROWSER)) sent[key] = BROWSER[key].read();
  onFactoryVisualsChange(() => pushLocal('factoryVisuals'));
  onReducedMotionChange(() => pushLocal('animations'));
  onSendOffsChange(() => pushLocal('sendOffs'));
  poll();
  setInterval(poll, POLL_MS);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
