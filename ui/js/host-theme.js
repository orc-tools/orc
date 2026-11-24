// The theme belongs to the Orc host, not to the browser viewing it, so every
// device sees the same one. serve.py keeps it in ~/.orc/ui-theme.json and writes
// it into the page; localStorage stays as this browser's working copy, which
// the theme controller, the fun modes and the offline page all read.

import { onThemeModeChange, setThemeMode, themeMode } from './core.js';
import { defaultTheme, followBasicsAccent, followFunMode, onFunModeSaved, savedBasicsAccent, savedFunMode } from './fun-modes.js';

let unsaved = false;
let saving = false;
let pulling = false;
let following = false;
let localChanges = 0;

function followHostTheme(theme) {
  // setThemeMode announces even when nothing changes, and this runs on each focus.
  if (theme.mode !== themeMode) {
    following = true;
    setThemeMode(theme.mode);
    following = false;
  }
  followBasicsAccent(theme.basicsAccent);
  followFunMode(theme.funMode);
}

async function saveHostTheme() {
  if (saving) return;
  saving = true;
  try {
    while (unsaved) {
      unsaved = false;
      const res = await fetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: themeMode, funMode: savedFunMode(), basicsAccent: savedBasicsAccent() }),
      });
      if (!res.ok) {
        unsaved = true;
        break;
      }
    }
  } catch {
    unsaved = true;
  } finally {
    saving = false;
  }
}

function themeChanged() {
  if (following) return;
  localChanges += 1;
  unsaved = true;
  saveHostTheme();
}

// A choice that has not reached the host yet goes up rather than being replaced
// by the older one the host still holds, and a choice made while the host was
// answering beats that answer.
export async function pullHostTheme() {
  if (unsaved || saving) return saveHostTheme();
  if (pulling) return undefined;
  pulling = true;
  const changesAtStart = localChanges;
  try {
    const res = await fetch('/api/theme', { cache: 'no-store' });
    if (!res.ok) return undefined;
    const { theme } = await res.json();
    if (theme && changesAtStart === localChanges) followHostTheme(theme);
  } catch {
    // Unreachable host: keep what is on screen until the next focus.
  } finally {
    pulling = false;
  }
  return undefined;
}

export function startHostTheme() {
  if (!['default', 'demo'].includes(window.ORC_INSTANCE?.kind)) return;
  const hostTheme = window.ORC_HOST_THEME;
  if (hostTheme) {
    followHostTheme(hostTheme);
  } else if (themeMode !== 'system' || savedFunMode() !== defaultTheme() || savedBasicsAccent() !== 'green') {
    // A host with nothing saved takes the first choice a browser brings. A browser
    // with no choice sends nothing, so a new device cannot overwrite that choice.
    unsaved = true;
    saveHostTheme();
  }
  onThemeModeChange(themeChanged);
  onFunModeSaved(themeChanged);
  // Picking up a laptop is what shows another device's choice.
  window.addEventListener('focus', pullHostTheme);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullHostTheme();
  });
}
