// Pocket mode. data-pocket on <html> is the whole switch: theme.css repaints
// the shell and the artifact pages from it, and this module adds the parts CSS
// cannot: saving the choice, the layer a click's sparks jump across, the
// solder dots a held press leaves, the typing effects and the favicon.
// index.html's pre-paint script restores the attribute before first paint.

import { announce, syncOpenArtifactThemes } from '/js/core.js';
import { funModeSaved, leaveOtherFunModes, registerFunMode, whileFunPress } from '/js/fun-modes.js';

export const POCKET_STORAGE_KEY = 'orcPocket';
// A press throws one spark along each of the board's eight directions: the
// traces run square or at 45 degrees, so the sparks do too.
const POCKET_SPARK_WAYS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
// Sparks remove themselves when their animation ends, which never happens
// while animations are suppressed (forced colours, print), so cap the pile.
// A steady held trail stays under it: see whileFunPress in fun-modes.js.
const POCKET_SPARK_CAP = 48;
// The handheld itself: a clear purple shell, the orc on its screen, and the
// two round buttons under it.
const POCKET_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<rect x='8' y='2' width='48' height='60' rx='9' fill='#7c54e8' stroke='#2a1763' stroke-width='3'/>"
  + "<path d='M13 9l9-4M13 15l16-8' stroke='#ffffff' stroke-width='2.5' stroke-linecap='round' stroke-opacity='.45'/>"
  + "<rect x='14' y='9' width='36' height='31' rx='4' fill='#08060e'/>"
  + "<rect x='18' y='13' width='28' height='23' rx='2' fill='#1a1430'/>"
  + "<circle cx='32' cy='24' r='9' fill='#83c851' stroke='#182f10' stroke-width='2'/>"
  + "<circle cx='28.5' cy='22.5' r='1.5' fill='#182f10'/><circle cx='35.5' cy='22.5' r='1.5' fill='#182f10'/>"
  + "<path d='M28 29l1.2-3.4 1.2 3.4zM33.6 29l1.2-3.4 1.2 3.4z' fill='#fff8ec' stroke='#182f10' stroke-width='.8'/>"
  + "<path d='M17 50h8M21 46v8' stroke='#2a2536' stroke-width='3.4' stroke-linecap='round'/>"
  + "<circle cx='39' cy='52' r='3.6' fill='#c9a8ff' stroke='#2a1763' stroke-width='1.5'/>"
  + "<circle cx='47' cy='47' r='3.6' fill='#c9a8ff' stroke='#2a1763' stroke-width='1.5'/>"
  + '</svg>',
);
let pocketSavedFavicon = null;
let pocketTrailTurn = 0;

export function pocketIsOn() {
  return document.documentElement.hasAttribute('data-pocket');
}

function pocketPiece(className, text, place) {
  const piece = document.createElement('span');
  piece.className = className;
  piece.textContent = text;
  for (const [name, value] of Object.entries(place)) piece.style.setProperty(name, value);
  return piece;
}

// The board is theme.css's, painted behind the chrome. This layer starts
// empty and holds only what a press throws.
function pocketFxLayer() {
  const layer = document.createElement('div');
  layer.id = 'pocket-fx';
  layer.setAttribute('aria-hidden', 'true');
  return layer;
}

function swapPocketFavicon(on) {
  const faviconLink = document.querySelector('link[rel="icon"]');
  if (!faviconLink) return;
  if (on && pocketSavedFavicon === null) {
    pocketSavedFavicon = faviconLink.getAttribute('href');
    faviconLink.setAttribute('href', POCKET_FAVICON);
  } else if (!on && pocketSavedFavicon !== null) {
    faviconLink.setAttribute('href', pocketSavedFavicon);
    pocketSavedFavicon = null;
  }
}

export function paintPocket(on) {
  const root = document.documentElement;
  if (on) root.setAttribute('data-pocket', '');
  else root.removeAttribute('data-pocket');
  const layer = document.getElementById('pocket-fx');
  if (on && !layer) document.body.append(pocketFxLayer());
  if (!on && layer) layer.remove();
  swapPocketFavicon(on);
}

// Leaving the other modes first keeps them from overlapping and hands their
// favicon back before this one saves and swaps it.
function renderPocket(on) {
  if (on) leaveOtherFunModes('pocket');
  paintPocket(on);
  syncOpenArtifactThemes();
}

export function setPocket(on) {
  on = Boolean(on);
  renderPocket(on);
  // Blocked storage (private windows) only costs the choice surviving a reload.
  try {
    if (on) localStorage.setItem(POCKET_STORAGE_KEY, 'on');
    else localStorage.removeItem(POCKET_STORAGE_KEY);
  } catch {}
  funModeSaved();
  announce(on ? 'Pocket mode on. Batteries not included~' : 'Pocket mode off');
  return on;
}

export function togglePocket() {
  return setPocket(!pocketIsOn());
}

// Another mode calls this as it turns on. It stays quiet because that mode
// announces and syncs the frames once with the final state. The key is
// cleared even when pocket is already off, so a stale saved choice cannot
// bring it back on reload.
export function leavePocket() {
  paintPocket(false);
  try {
    localStorage.removeItem(POCKET_STORAGE_KEY);
  } catch {}
}

function pocketSparkPiece(className, place) {
  const piece = pocketPiece(className, '', place);
  piece.addEventListener('animationend', () => piece.remove(), { once: true });
  return piece;
}

function pocketLayerWithRoom(size) {
  if (!pocketIsOn()) return null;
  const layer = document.getElementById('pocket-fx');
  if (!layer || layer.querySelectorAll('.pocket-spark').length + size > POCKET_SPARK_CAP) return null;
  return layer;
}

// A button press: a ring where it landed, and a spark down each direction a
// trace can run. The diagonal ones travel as far across as they do down.
function pocketPress(x, y) {
  const layer = pocketLayerWithRoom(POCKET_SPARK_WAYS.length + 1);
  if (!layer) return;
  layer.append(pocketSparkPiece('pocket-spark pocket-press', { '--px': x + 'px', '--py': y + 'px' }));
  POCKET_SPARK_WAYS.forEach(([across, down], i) => {
    const reach = across && down ? 20 : 30;
    layer.append(pocketSparkPiece('pocket-spark', {
      '--px': x + 'px',
      '--py': y + 'px',
      '--dx': across * reach + 'px',
      '--dy': down * reach + 'px',
      '--delay': (i % 2 * 0.04).toFixed(2) + 's',
    }));
  });
}

// Strides rather than Math.random, so neighbours along a held press's trail
// fall apart and every run looks the same.
function pocketTrailSpark(x, y) {
  const layer = pocketLayerWithRoom(1);
  if (!layer) return;
  const turn = pocketTrailTurn++;
  const [across, down] = POCKET_SPARK_WAYS[(turn * 3) % POCKET_SPARK_WAYS.length];
  layer.append(pocketSparkPiece('pocket-spark pocket-trail', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': across * 10 + 'px',
    '--dy': down * 10 + 'px',
  }));
}

// Called once at load. The pre-paint script has already set data-pocket, so a
// reload in pocket mode only needs the layer and favicon, and announces nothing.
export function activate({ signal }) {
  const unregister = registerFunMode('pocket', {
    paint: paintPocket, leave: leavePocket, set: setPocket,
    label: 'Pocket', blurb: 'Batteries not included~', typing: pocketTyping,
  });
  if (pocketIsOn()) renderPocket(true);
  whileFunPress(pocketPress, pocketTrailSpark, signal);
  return () => {
    paintPocket(false);
    unregister();
  };
}

// Strides of the streak rather than Math.random, so a capture of the same
// typing comes out the same. Each key knocks a pixel off the caret, and a
// long run of them is a combo that the screen counts out loud.
function pocketTyping({ kind, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const pixel = (dx, dy, delay, gold) => spawn('pocket-typed pocket-typed-pixel' + (gold ? ' pocket-typed-gold' : ''), '', {
    '--dx': dx + 'px', '--dy': dy + 'px', '--delay': delay + 's',
  });
  if (kind === 'char') {
    pixel(side * (5 + (streak * 5) % 10), -10 - (streak * 3) % 10, 0, false);
    if (streak > 12) pixel(-side * (5 + (streak * 7) % 10), -15 - (streak * 5) % 10, 0.03, true);
  } else if (kind === 'space') {
    spawn('pocket-typed pocket-typed-ring', '', { '--dx': side * 6 + 'px', '--size': 8 + (streak % 3) * 3 + 'px' });
  } else if (kind === 'delete') {
    spawn('pocket-typed pocket-typed-miss', 'miss');
  } else if (kind === 'paste') {
    for (let i = 0; i < 6; i++) pixel((i - 2.5) * 10, -12 - (2.5 - Math.abs(i - 2.5)) * 8, Math.abs(i - 2.5) * 0.03, i % 2 === 1);
  }
  // The count pops up over the field's right-hand corner, wherever the caret
  // is: project home's heading is centred above the field, and a call at the
  // caret would cover it.
  if (streak % 20 === 0) {
    spawn('pocket-typed pocket-typed-say', streak % 100 === 0 ? 'high score!' : 'combo x' + streak, {
      '--x': fieldRect.right - 130 + 'px', '--y': fieldRect.top - 6 + 'px',
    });
  }
}
