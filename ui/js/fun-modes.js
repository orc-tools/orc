import { animationsOff } from './motion.js';

const funModeRegistry = new Map();
var hostAnnounceFn = null;
var hostSyncArtifactsFn = null;
var declarativePaintedId = null;
var declarativeBackdropId = null;
var declarativeSavedFavicon = null;

export function wireFunModeHost({ onAnnounce, onSyncArtifacts } = {}) {
  if (onAnnounce) hostAnnounceFn = onAnnounce;
  if (onSyncArtifacts) hostSyncArtifactsFn = onSyncArtifacts;
}

function notifyAnnounce(message) {
  if (!message) return;
  if (hostAnnounceFn) hostAnnounceFn(message);
  else if (typeof globalThis.announce === 'function') globalThis.announce(message);
}

function notifySyncArtifacts() {
  if (hostSyncArtifactsFn) hostSyncArtifactsFn();
  else if (typeof globalThis.syncOpenArtifactThemes === 'function') globalThis.syncOpenArtifactThemes();
}

const THEME_ALIASES = { hawkins: 'upside-down', leonida: 'grand-theft-orc' };

export const availableThemes = () => (window.ORC_APP_PLUGINS?.plugins || [])
  .filter(plugin => plugin.enabled && !plugin.error && plugin.contributes?.theme)
  .map(plugin => ({ ...plugin.contributes.theme, required: plugin.required, base: plugin.base }));
export const defaultTheme = () => availableThemes().find(theme => theme.required)?.id;
const normalize = name => {
  const mapped = THEME_ALIASES[name] || name;
  return availableThemes().some(theme => theme.id === mapped) ? mapped : defaultTheme();
};

function resolveManifestFavicon(theme) {
  if (!theme || !theme.favicon) return null;
  const fav = theme.favicon;
  if (fav.startsWith('data:') || fav.startsWith('/') || fav.startsWith('http://') || fav.startsWith('https://')) {
    return fav;
  }
  return (theme.base || '') + fav;
}

function paintDeclarativeThemeOff(keepName) {
  if (!declarativePaintedId || declarativePaintedId === keepName) return;
  if (declarativeBackdropId) {
    document.getElementById?.(declarativeBackdropId)?.remove();
    declarativeBackdropId = null;
  }
  if (declarativeSavedFavicon !== null) {
    const link = document.querySelector?.('link[rel="icon"]');
    if (link) link.setAttribute('href', declarativeSavedFavicon);
    declarativeSavedFavicon = null;
  }
  declarativePaintedId = null;
}

function paintDeclarativeThemeOn(name) {
  if (funModeRegistry.has(name)) {
    paintDeclarativeThemeOff(null);
    return;
  }
  const theme = availableThemes().find(item => item.id === name);
  if (!theme) {
    paintDeclarativeThemeOff(null);
    return;
  }
  const href = resolveManifestFavicon(theme);
  const link = document.querySelector?.('link[rel="icon"]');
  if (href && link) {
    if (declarativeSavedFavicon === null) declarativeSavedFavicon = link.getAttribute('href');
    link.setAttribute('href', href);
  } else if (!href && declarativeSavedFavicon !== null && link) {
    link.setAttribute('href', declarativeSavedFavicon);
    declarativeSavedFavicon = null;
  }
  if (theme.backdrop && theme.backdrop.className && theme.backdrop.count && document.createElement && document.body?.append) {
    const layerId = theme.backdrop.id || (name + '-backdrop');
    if (!document.getElementById?.(layerId)) {
      const layer = document.createElement('div');
      layer.id = layerId;
      layer.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < theme.backdrop.count; i++) {
        const item = document.createElement('span');
        item.className = theme.backdrop.className;
        item.style.setProperty('--i', String(i));
        layer.append(item);
      }
      document.body.append(layer);
    }
    declarativeBackdropId = layerId;
  }
  declarativePaintedId = name;
}

// paint(on) repaints the page only; leave() paints off quietly and also
// clears that mode's saved choice. set(on) is the mode's own switch, which
// saves and announces; without it the theme picker cannot offer the mode.
// typing(at) draws the mode's typing effect; ui/js/typing-fx.js documents `at`.
export function registerFunMode(name, { paint, leave, set, label, blurb, typing, announce }) {
  funModeRegistry.set(name, { paint, leave, set, label, blurb, typing, announce });
  return () => funModeRegistry.delete(name);
}

export function funModeTyping(name) {
  return funModeRegistry.get(name)?.typing || null;
}

// Whether a theme's own module has registered it. A theme with no frontend
// never does, and one with a frontend need not have a typing effect.
export function funModeRegistered(name) {
  return funModeRegistry.has(name);
}

// A mode turning on in this window.
export function leaveOtherFunModes(name) {
  for (const [funModeName, funModeHooks] of funModeRegistry) {
    if (funModeName !== name) funModeHooks.leave();
  }
  paintDeclarativeThemeOff(name);
}

// Following another window, which has already cleared the saved choices.
// Clearing them again here could erase a newer one from a third window.
export function paintOtherFunModesOff(name) {
  for (const [funModeName, funModeHooks] of funModeRegistry) {
    if (funModeName !== name) funModeHooks.paint(false);
  }
  paintDeclarativeThemeOff(name);
}

export function pickableFunModes() {
  return availableThemes().map(theme => ({ name: theme.id, label: theme.label, blurb: theme.description || '' }));
}

// Every mode marks <html> with data-<name> while it is painted on.
export function paintedFunMode() {
  return normalize(document.documentElement.dataset.funMode);
}

// Preview must not publish a host or cross-window preference.
export function previewFunMode(name) {
  name = normalize(name);
  for (const [funModeName, funModeHooks] of funModeRegistry) {
    if (funModeName !== name) funModeHooks.paint(false);
  }
  paintDeclarativeThemeOff(name);
  for (const theme of availableThemes()) document.documentElement.toggleAttribute('data-' + theme.id, theme.id === name);
  document.documentElement.dataset.funMode = name;
  if (funModeRegistry.has(name)) funModeRegistry.get(name).paint(true);
  else paintDeclarativeThemeOn(name);
  window.dispatchEvent(new Event('orc-theme-painted'));
}

// Commits a picked theme over whatever the preview painted.
export function chooseFunMode(name, startName) {
  name = normalize(name);
  if (name === startName) {
    previewFunMode(startName);
    return;
  }
  previewFunMode(name);
  try { localStorage.setItem('orcFunMode', name); } catch {}
  funModeSaved();
  const chosenAnnounce = funModeRegistry.get(name)?.announce
    || availableThemes().find(item => item.id === name)?.announce;
  if (chosenAnnounce) {
    notifyAnnounce(typeof chosenAnnounce === 'string' ? chosenAnnounce : chosenAnnounce.on);
  } else if (startName) {
    const previousAnnounce = funModeRegistry.get(startName)?.announce
      || availableThemes().find(item => item.id === startName)?.announce;
    if (typeof previousAnnounce === 'object' && previousAnnounce?.off) {
      notifyAnnounce(previousAnnounce.off);
    }
  }
}

export function defineFunMode({
  id,
  storageKey = 'orc' + id[0].toUpperCase() + id.slice(1),
  label,
  blurb,
  favicon,
  announce: announceSpec,
  layerId,
  zapSelector,
  zapCap = 48,
  buildLayer,
  homeLayerId,
  buildHomeLayer,
  onPaint,
  burst,
  trail,
  typing,
}) {
  let savedFavicon = null;

  function piece(className, face = '', place = {}) {
    if (typeof face === 'object' && face !== null) {
      place = face;
      face = '';
    }
    const node = document.createElement('span');
    node.className = className;
    if (face !== '') node.textContent = face;
    for (const [prop, val] of Object.entries(place)) node.style.setProperty(prop, val);
    return node;
  }

  function zap(className, face = '', place = {}) {
    const spark = piece(className, face, place);
    spark.addEventListener('animationend', () => spark.remove(), { once: true });
    return spark;
  }

  function isOn() {
    return document.documentElement.hasAttribute('data-' + id);
  }

  function layerWithRoom(size = 1) {
    if (!isOn() || !layerId) return null;
    const layer = document.getElementById(layerId);
    if (!layer) return null;
    if (zapSelector && layer.querySelectorAll(zapSelector).length + size > zapCap) return null;
    return layer;
  }

  const helpers = { piece, zap, layerWithRoom, isOn };

  // A layer of the mode's own inside project home (#new-view), under its
  // composer and notes. buildNewConversation rewrites the view, so the layer
  // is laid again each time the view says it is ready.
  function mountHomeLayer() {
    const view = document.getElementById('new-view');
    if (!view || document.getElementById(homeLayerId)) return;
    view.prepend(buildHomeLayer(helpers));
  }

  function paintHomeLayer(active) {
    if (active) {
      window.addEventListener('orc-newconv-ready', mountHomeLayer);
      mountHomeLayer();
    } else {
      window.removeEventListener('orc-newconv-ready', mountHomeLayer);
      document.getElementById(homeLayerId)?.remove();
    }
  }

  function swapFavicon(on) {
    const link = document.querySelector?.('link[rel="icon"]');
    if (!link) return;
    const manifestTheme = availableThemes().find(item => item.id === id);
    const targetHref = favicon || resolveManifestFavicon(manifestTheme);
    if (!targetHref) return;
    if (on && savedFavicon === null) {
      savedFavicon = link.getAttribute('href');
      link.setAttribute('href', targetHref);
    } else if (!on && savedFavicon !== null) {
      link.setAttribute('href', savedFavicon);
      savedFavicon = null;
    }
  }

  function paint(on, ...extra) {
    const active = Boolean(on);
    const root = document.documentElement;
    if (active) root.setAttribute('data-' + id, '');
    else root.removeAttribute('data-' + id);
    let freshlyMounted = false;
    if (layerId) {
      const existing = document.getElementById(layerId);
      if (active && !existing && buildLayer) {
        document.body.append(buildLayer(helpers));
        freshlyMounted = true;
      }
      if (!active && existing) existing.remove();
    }
    if (homeLayerId && buildHomeLayer) paintHomeLayer(active);
    if (onPaint) onPaint(active, extra[0] !== false, { freshlyMounted, ...helpers });
    swapFavicon(active);
  }

  function render(on, ...extra) {
    if (on) leaveOtherFunModes(id);
    paint(on, ...extra);
    notifySyncArtifacts();
  }

  function set(on) {
    on = Boolean(on);
    render(on);
    try {
      if (on) localStorage.setItem(storageKey, 'on');
      else localStorage.removeItem(storageKey);
    } catch {}
    funModeSaved();
    const manifestTheme = availableThemes().find(item => item.id === id);
    const rawAnnounce = announceSpec || manifestTheme?.announce;
    const modeLabel = label || manifestTheme?.label || (id[0].toUpperCase() + id.slice(1));
    const onText = typeof rawAnnounce === 'string' ? rawAnnounce : (rawAnnounce?.on || (modeLabel + ' mode on'));
    const offText = (typeof rawAnnounce === 'object' && rawAnnounce?.off) ? rawAnnounce.off : (modeLabel + ' mode off');
    notifyAnnounce(on ? onText : offText);
    return on;
  }

  function toggle() {
    return set(!isOn());
  }

  function leave() {
    paint(false);
    try { localStorage.removeItem(storageKey); } catch {}
  }

  function activate({ signal } = {}) {
    const manifestTheme = availableThemes().find(item => item.id === id);
    const unregister = registerFunMode(id, {
      paint, leave, set,
      label: label || manifestTheme?.label || id,
      blurb: blurb ?? manifestTheme?.description ?? '',
      typing,
      announce: announceSpec || manifestTheme?.announce,
    });
    if (isOn()) render(true, false);
    if (burst && trail) {
      whileFunPress((x, y) => burst(x, y, helpers), (x, y) => trail(x, y, helpers), signal);
    }
    return () => {
      paint(false);
      unregister?.();
    };
  }

  return { id, storageKey, isOn, paint, render, set, toggle, leave, activate, piece, zap, layerWithRoom };
}

export const basicsAccents = ['green', 'blue', 'magenta', 'teal', 'amber', 'violet', 'graphite'];
// A Custom accent is saved as its own lowercase #rrggbb, everywhere a named one is.
export const DEFAULT_CUSTOM_ACCENT = '#e0582b';
export function customAccentHex(value) {
  const hex = String(value ?? '').trim().replace(/^#?/, '#').toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  return /^#[0-9a-f]{3}$/.test(hex) ? `#${[...hex.slice(1)].map(digit => digit + digit).join('')}` : null;
}
export const isCustomAccent = value => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
const normalizedAccent = value => basicsAccents.includes(value) || isCustomAccent(value) ? value : 'green';

// The one place a page takes an accent: the name or hex on data-basics-accent,
// and a hex also as --basics-custom for Basics' theme.css.
export function paintBasicsAccent(root, value) {
  const accent = normalizedAccent(value);
  root.dataset.basicsAccent = accent;
  if (isCustomAccent(accent)) root.style.setProperty('--basics-custom', accent);
  else root.style.removeProperty('--basics-custom');
  return accent;
}

export function savedBasicsAccent() {
  try { return normalizedAccent(localStorage.getItem('orcBasicsAccent')); }
  catch { return normalizedAccent(document.documentElement.dataset.basicsAccent); }
}

// The last Custom colour, so Custom comes back to it after picking a named accent.
export function savedCustomAccent() {
  const saved = savedBasicsAccent();
  if (isCustomAccent(saved)) return saved;
  try { return customAccentHex(localStorage.getItem('orcBasicsCustomAccent')) || DEFAULT_CUSTOM_ACCENT; }
  catch { return DEFAULT_CUSTOM_ACCENT; }
}

export function previewBasicsAccent(value) {
  const accent = normalizedAccent(value);
  if (document.documentElement.dataset.basicsAccent === accent) return;
  paintBasicsAccent(document.documentElement, accent);
  window.dispatchEvent(new Event('orc-theme-painted'));
}

export function followBasicsAccent(value) {
  const accent = normalizedAccent(value);
  try {
    localStorage.setItem('orcBasicsAccent', accent);
    if (isCustomAccent(accent)) localStorage.setItem('orcBasicsCustomAccent', accent);
  } catch {}
  previewBasicsAccent(accent);
}

export function setBasicsAccent(value, theme) {
  if (!basicsAccents.includes(value) && !isCustomAccent(value)) return;
  const previous = savedFunMode();
  followBasicsAccent(value);
  if (theme === 'basics' && previous !== theme) chooseFunMode(theme, previous);
  else funModeSaved();
}

export function savedFunMode() {
  try { return normalize(localStorage.getItem('orcFunMode')); }
  catch { return paintedFunMode(); }
}

// A press fires a mode's whole burst once. While it is held, single trail
// pieces follow the pointer at an even spacing, so dragging to select text
// leaves a smooth line rather than a row of clumps. The rate is bounded
// whatever the speed: a trail piece lives at most .6s, so at most
// 48 * .6 + 6 = 35 are live, which with one burst (8 at most) stays under
// every mode's cap of 48, so a long drag never stalls against it.
const FUN_TRAIL_SPACING_PX = 12;
const FUN_TRAIL_PER_SECOND = 48;
// Also bounds what one frame lays, so a long jump cannot flood the layer.
const FUN_TRAIL_PER_FRAME = 6;
// A pointer held still keeps a gentle trickle going where it rests.
const FUN_TRAIL_STILL_MS = 120;

export function whileFunPress(burst, trail, signal) {
  let x;
  let y;
  // Pointer positions since the last frame, which the trail is laid along.
  let path = [];
  let frame = 0;
  let then;
  // Pieces the rate still allows, fractional between frames.
  let allowance;
  // Distance and time since the last piece.
  let gap;
  let still;
  const release = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    path = [];
  };
  const lay = (atX, atY) => {
    trail(Math.round(atX), Math.round(atY));
    allowance -= 1;
    still = 0;
  };
  const step = now => {
    const elapsed = then === undefined ? 0 : now - then;
    then = now;
    allowance = Math.min(FUN_TRAIL_PER_FRAME, allowance + elapsed * FUN_TRAIL_PER_SECOND / 1000);
    still += elapsed;
    let length = gap;
    let fromX = x;
    let fromY = y;
    for (const [toX, toY] of path) {
      length += Math.hypot(toX - fromX, toY - fromY);
      fromX = toX;
      fromY = toY;
    }
    // Faster than the rate allows, the spacing widens to what the allowance
    // covers, so the pieces stay evenly spread instead of bunching up and
    // then skipping a stretch.
    const spacing = allowance > 0 ? Math.max(FUN_TRAIL_SPACING_PX, length / allowance) : Infinity;
    for (const [toX, toY] of path) {
      const segment = Math.hypot(toX - x, toY - y);
      let along = 0;
      // The tolerance keeps rounding from dropping a piece due exactly at
      // the pointer. A gap already past the spacing, left when the pointer
      // slows down, puts the next piece at the start of this segment.
      while (segment && allowance >= 1 && gap + segment - along > spacing - 1e-6) {
        along = Math.max(along, along + spacing - gap);
        gap = 0;
        lay(x + (toX - x) * along / segment, y + (toY - y) * along / segment);
      }
      gap += segment - along;
      x = toX;
      y = toY;
    }
    path = [];
    if (still >= FUN_TRAIL_STILL_MS && allowance >= 1) {
      lay(x, y);
      gap = 0;
    }
    frame = requestAnimationFrame(step);
  };
  document.addEventListener('pointerdown', event => {
    // Touch and pen contacts report 0 like the primary button, and some
    // pointers report no button at all.
    if (event.button > 0 || animationsOff()) return;
    release();
    x = event.clientX;
    y = event.clientY;
    burst(x, y);
    then = undefined;
    allowance = FUN_TRAIL_PER_FRAME;
    gap = 0;
    still = 0;
    frame = requestAnimationFrame(step);
  }, { passive: true, signal });
  // Moves report button -1, so only a press already held follows them.
  document.addEventListener('pointermove', event => {
    if (frame) path.push([event.clientX, event.clientY]);
  }, { passive: true, signal });
  document.addEventListener('pointerup', release, { passive: true, signal });
  document.addEventListener('pointercancel', release, { passive: true, signal });
  // A release outside the window may never arrive.
  window.addEventListener('blur', release, { signal });
  signal?.addEventListener('abort', release, { once: true });
}

let funModeSavedListener = () => {};
export function onFunModeSaved(listener) { funModeSavedListener = listener; }
// Every mode's set() calls this once its choice is saved. leave() does not: it
// only ever runs as another mode turns on, and that mode reports the result.
export function funModeSaved() { funModeSavedListener(); }

export function followFunMode(name) {
  const wanted = normalize(name);
  try { localStorage.setItem('orcFunMode', wanted); } catch {}
  previewFunMode(wanted);
}

window.addEventListener('storage', event => {
  if (event.key === 'orcBasicsAccent') previewBasicsAccent(event.newValue);
  if (event.key === 'orcFunMode') previewFunMode(event.newValue);
});
