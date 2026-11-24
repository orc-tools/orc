// Orcsoft 97 mode. data-ninetyseven on <html> is the whole switch: theme.css
// repaints the shell and the artifact pages from it, and this module adds the
// drifting clouds/stars, start-up box, pixel scatter, ghost trail and tips.

import { defineFunMode } from '/js/fun-modes.js';
import { reducedMotion } from '/js/motion.js';

const NINETYSEVEN_CLOUDS = 6;
const NINETYSEVEN_STARS = 24;
const NINETYSEVEN_BOOT_BLOCKS = 14;
const NINETYSEVEN_PIXELS = ['#e8362a', '#4aa52c', '#1c6cd8', '#f2b90f', '#e8362a', '#4aa52c', '#1c6cd8', '#f2b90f'];
const NINETYSEVEN_ZAP_CAP = 48;
const NINETYSEVEN_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' shape-rendering='crispEdges'>"
  + "<rect width='64' height='64' fill='#008080'/>"
  + "<rect x='6' y='8' width='52' height='48' fill='#c0c0c0'/>"
  + "<path d='M6 8h52v2H8v46H6z' fill='#fff'/><path d='M58 8v48H6v-2h50V8z' fill='#0a0a0a'/>"
  + "<rect x='10' y='12' width='44' height='9' fill='#000080'/>"
  + "<rect x='20' y='26' width='24' height='24' fill='#5a9a3a'/>"
  + "<rect x='15' y='29' width='5' height='7' fill='#5a9a3a'/><rect x='44' y='29' width='5' height='7' fill='#5a9a3a'/>"
  + "<rect x='24' y='32' width='5' height='5' fill='#101010'/><rect x='35' y='32' width='5' height='5' fill='#101010'/>"
  + "<rect x='25' y='42' width='3' height='7' fill='#fff'/><rect x='36' y='42' width='3' height='7' fill='#fff'/>"
  + '</svg>',
);

function ninetysevenSceneLayer({ piece }) {
  const scene = document.createElement('div');
  scene.id = 'ninetyseven-scene';
  scene.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < NINETYSEVEN_CLOUDS; i++) {
    scene.append(piece('ninetyseven-thing ninetyseven-cloud', '', {
      '--y': 6 + (i * 31 + 9) % 78 + '%',
      '--size': 90 + (i * 37) % 80 + 'px',
      '--dur': 70 + (i * 23) % 60 + 's',
      '--delay': '-' + ((7.5 + i * 19.3) % 70).toFixed(1) + 's',
    }));
  }
  for (let i = 0; i < NINETYSEVEN_STARS; i++) {
    const angle = i * 2.39996;
    scene.append(piece('ninetyseven-thing ninetyseven-star', '', {
      '--size': 2 + i % 3 + 'px',
      '--dur': 5 + (i * 7) % 6 + 's',
      '--delay': '-' + ((0.4 + i * 1.7) % 11).toFixed(1) + 's',
      '--dx': Math.round(Math.cos(angle) * 70) + 'vw',
      '--dy': Math.round(Math.sin(angle) * 70) + 'vh',
    }));
  }
  return scene;
}

function ninetysevenBoot(piece) {
  if (reducedMotion()) return;
  document.getElementById('ninetyseven-splash')?.remove();
  const splash = document.createElement('div');
  splash.id = 'ninetyseven-splash';
  splash.setAttribute('aria-hidden', 'true');
  const boot = piece('ninetyseven-boot', '', {});
  const bar = piece('ninetyseven-boot-bar', '', {});
  for (let i = 0; i < NINETYSEVEN_BOOT_BLOCKS; i++) bar.append(piece('ninetyseven-boot-block', '', { '--i': String(i) }));
  boot.append(
    piece('ninetyseven-boot-title', 'Orc 97', {}),
    piece('ninetyseven-boot-line', 'Starting Orc 97...', {}),
    bar,
  );
  boot.addEventListener('animationend', event => {
    if (event.target === boot) splash.remove();
  });
  splash.append(boot);
  document.body.append(splash);
}

function ninetysevenSplash(active, boot, { freshlyMounted, piece }) {
  if (active && freshlyMounted && boot) ninetysevenBoot(piece);
  if (!active) document.getElementById('ninetyseven-splash')?.remove();
}

function ninetysevenBurst(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  NINETYSEVEN_PIXELS.forEach((tint, i) => {
    const angle = i * Math.PI / 4;
    const reach = i % 2 ? 52 : 38;
    scene.append(zap('ninetyseven-zap ninetyseven-pixel', {
      '--px': x + 'px',
      '--py': y + 'px',
      '--tint': tint,
      '--dx': Math.round(Math.cos(angle) * reach) + 'px',
      '--dy': Math.round(Math.sin(angle) * reach) + 'px',
    }));
  });
}

function ninetysevenTrailGhost(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  scene.append(zap('ninetyseven-zap ninetyseven-ghost', { '--px': x + 'px', '--py': y + 'px' }));
}

const NINETYSEVEN_TIPS = ['It looks like you are writing a prompt.', 'Tip: Enter starts the run.', 'Press F1 for Help. There is no Help.'];

function ninetysevenTyping({ kind, data, x, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const tipAt = left => ({ '--x': Math.min(Math.max(left, fieldRect.left + 12), Math.max(fieldRect.left + 12, fieldRect.right - 230)) + 'px', '--y': fieldRect.top + 'px' });
  if (kind === 'char') {
    const glyph = Array.from(data || '').pop();
    if (glyph && glyph.trim()) spawn('ninetyseven-typed ninetyseven-typed-key', glyph, { '--drift': side * 5 + 'px' });
  } else if (kind === 'space') {
    spawn('ninetyseven-typed ninetyseven-typed-caret', '');
  } else if (kind === 'delete') {
    for (let i = 0; i < 3; i++) {
      spawn('ninetyseven-typed ninetyseven-typed-scrap', '', {
        '--dx': (i % 2 ? 1 : -1) * (5 + i * 4) + 'px', '--dy': 12 + i * 6 + 'px',
      });
    }
  } else if (kind === 'paste') {
    spawn('ninetyseven-typed ninetyseven-typed-tip', 'Pasted from the Clipboard', tipAt(x));
  }
  if (streak % 40 === 0) {
    spawn('ninetyseven-typed ninetyseven-typed-tip', NINETYSEVEN_TIPS[streak / 40 % NINETYSEVEN_TIPS.length], tipAt(fieldRect.left + 12));
  }
}

const ninetysevenMode = defineFunMode({
  id: 'ninetyseven',
  label: 'Orcsoft 97',
  blurb: 'Grey bevels and a teal desktop, ta-da~',
  favicon: NINETYSEVEN_FAVICON,
  announce: { on: 'Orcsoft 97 mode on. Ta-da~', off: 'Orcsoft 97 mode off' },
  layerId: 'ninetyseven-scene',
  zapSelector: '.ninetyseven-zap',
  zapCap: NINETYSEVEN_ZAP_CAP,
  buildLayer: ninetysevenSceneLayer,
  onPaint: ninetysevenSplash,
  burst: ninetysevenBurst,
  trail: ninetysevenTrailGhost,
  typing: ninetysevenTyping,
});

export const NINETYSEVEN_STORAGE_KEY = ninetysevenMode.storageKey;
export const ninetysevenIsOn = ninetysevenMode.isOn;
export const paintNinetyseven = ninetysevenMode.paint;
export const setNinetyseven = ninetysevenMode.set;
export const toggleNinetyseven = ninetysevenMode.toggle;
export const leaveNinetyseven = ninetysevenMode.leave;
export function activate(ctx) {
  return ninetysevenMode.activate(ctx);
}
