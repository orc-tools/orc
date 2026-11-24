// Synthwave mode. data-synthwave on <html> is the whole switch: theme.css
// repaints the shell and the artifact pages from it, and this module stands
// the drawn sunset behind the page (stars, haze, the sun's bands, clouds,
// hills, the grid floor and palms) and adds click strikes, press trails and
// typing sparks. Every picture and every movement is theme.css's; the pieces
// made here only give them somewhere to be.

import { defineFunMode } from '/js/fun-modes.js';

const SYNTHWAVE_SET_ID = 'synthwave-set';
const SYNTHWAVE_DRAWN_WIDTH = 1300;
// The stars large enough to have points: where each stands in main, as
// shares of its width and height, and how large it is. The first five stand
// along the top of the new-run screen, where a run's title would be, so they
// come out there only. The rest stand in the margins either side of the
// composer, which are the transcript's margins too.
const SYNTHWAVE_STARS = [
  { x: '4.6%', y: '6%', s: .8, show: true },
  { x: '21.2%', y: '4%', s: .55, show: true },
  { x: '50.8%', y: '3.5%', s: .6, show: true },
  { x: '72.9%', y: '5.5%', s: 1, show: true },
  { x: '92%', y: '7%', s: .85, show: true },
  { x: '6.5%', y: '30%', s: .6 },
  { x: '94.5%', y: '24%', s: .8 },
  { x: '2.8%', y: '52%', s: .5 },
  { x: '91.4%', y: '46%', s: .55 },
];
// Three streaks of cloud across the sun: where each lies from the sun's
// middle and above the horizon, how long it is, and how slowly it drifts.
// No two share a pace, so they never cross it together.
const SYNTHWAVE_CLOUDS = [
  { '--x': '-470px', '--y': '150px', '--w': '330px', '--h': '7px', '--dur': '46s', '--delay': '0s' },
  { '--x': '150px', '--y': '188px', '--w': '400px', '--h': '8px', '--dur': '61s', '--delay': '-61s' },
  { '--x': '250px', '--y': '172px', '--w': '230px', '--h': '5px', '--dur': '53s', '--delay': '-20s' },
];
// How slowly each palm sways, and where in its sway it starts.
const SYNTHWAVE_PALMS = [
  { '--dur': '9s', '--delay': '0s' },
  { '--dur': '11s', '--delay': '-4s' },
  { '--dur': '13s', '--delay': '-7s' },
];
// theme.css places and moves this many of each by number.
const SYNTHWAVE_SUN_BANDS = 7;
const SYNTHWAVE_FLOOR_LINES = 16;
const SYNTHWAVE_GLOWS = ['var(--synthwave-pink)', 'var(--synthwave-neon)', 'var(--synthwave-violet)'];
const SYNTHWAVE_SPARKS = 6;
const SYNTHWAVE_ZAP_CAP = 48;
const SYNTHWAVE_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<defs><linearGradient id='sun' x1='0' y1='0' x2='0' y2='1'>"
  + "<stop offset='0' stop-color='#ffe66d'/><stop offset='.5' stop-color='#ff4f9a'/><stop offset='1' stop-color='#b42dff'/>"
  + '</linearGradient></defs>'
  + "<rect width='64' height='64' rx='14' fill='#1b0a3c'/>"
  + "<circle cx='32' cy='31' r='20' fill='url(#sun)'/>"
  + "<path d='M10 35h44' stroke='#1b0a3c' stroke-width='1.8'/>"
  + "<path d='M10 41h44' stroke='#1b0a3c' stroke-width='2.6'/>"
  + "<path d='M10 47h44' stroke='#1b0a3c' stroke-width='3.4'/>"
  + "<path d='M3 51.5h58M32 51.5 13 64M32 51.5 51 64M32 51.5V64' fill='none' stroke='#2de2e6' stroke-width='2.4' stroke-linecap='round'/>"
  + '</svg>',
);
let synthwaveTrailTurn = 0;
let synthwaveWatch = null;

// Strikes and trails are drawn in this layer, over the page, for the moment
// each lasts. Nothing else is in it.
function synthwaveSceneLayer() {
  const scene = document.createElement('div');
  scene.id = 'synthwave-scene';
  scene.setAttribute('aria-hidden', 'true');
  return scene;
}

// The sunset stands in a layer behind the page. A piece marked synthwave-show
// belongs to the new-run screen alone; the rest also stand, still, in the
// margins beside a transcript.
function synthwaveSetLayer({ piece }) {
  const set = document.createElement('div');
  set.id = SYNTHWAVE_SET_ID;
  set.setAttribute('aria-hidden', 'true');
  const show = name => 'synthwave-' + name + ' synthwave-show';
  SYNTHWAVE_STARS.forEach((star, i) => set.append(piece(star.show ? show('star') : 'synthwave-star', {
    '--x': star.x,
    '--y': star.y,
    '--s': String(star.s),
    '--dur': (2.6 + (i * 1.7) % 4.1).toFixed(1) + 's',
    '--delay': '-' + ((0.4 + i * 1.3) % 5).toFixed(1) + 's',
  })));
  const land = piece('synthwave-land');
  const sun = piece(show('sun'));
  for (let i = 0; i < SYNTHWAVE_SUN_BANDS; i++) {
    const band = piece('synthwave-band');
    band.append(document.createElement('i'));
    sun.append(band);
  }
  const floor = piece('synthwave-floor');
  const grid = piece('synthwave-grid');
  grid.append(piece('synthwave-rays'));
  for (let i = 0; i < SYNTHWAVE_FLOOR_LINES; i++) grid.append(piece('synthwave-line'));
  floor.append(piece('synthwave-shine'), grid);
  land.append(
    piece('synthwave-haze'),
    piece(show('glow')),
    ...SYNTHWAVE_CLOUDS.map(place => piece(show('cloud'), place)),
    sun,
    piece('synthwave-ridge'),
    piece('synthwave-range synthwave-left'),
    piece('synthwave-range synthwave-right'),
    piece('synthwave-horizon'),
    floor,
    ...SYNTHWAVE_PALMS.map(place => piece(show('palm'), place)),
    piece(show('meteor')),
  );
  set.append(land);
  return set;
}

// The layer stands over main and nowhere else, and the scene, drawn for a
// main area 1300px wide over a floor 210px deep, is fitted to it:
// --synthwave-left and --synthwave-width place the layer on main, whatever
// the sidebar and the side panel leave it, --synthwave-k fits the drawing's
// breadth and --synthwave-floor is the horizon's height. They are measured
// here because CSS cannot do it on every Mac Orc runs on: anchor positioning
// is newer than macOS 12's WebKit, and WebKit does not resolve container
// units against a layer placed by anchor.
function synthwaveFit(set, main) {
  const clamp = (low, value, high) => Math.min(high, Math.max(low, value));
  const { left, width } = main.getBoundingClientRect();
  const { height } = set.getBoundingClientRect();
  set.style.setProperty('--synthwave-left', Math.round(left) + 'px');
  set.style.setProperty('--synthwave-width', Math.round(width) + 'px');
  set.style.setProperty('--synthwave-k', clamp(.6, width / SYNTHWAVE_DRAWN_WIDTH, 1.3).toFixed(3));
  set.style.setProperty('--synthwave-floor', Math.round(clamp(120, height * .21, 250)) + 'px');
}

function synthwaveSet(active, _boot, helpers) {
  const set = document.getElementById(SYNTHWAVE_SET_ID);
  if (active && !set) {
    const layer = synthwaveSetLayer(helpers);
    document.body.append(layer);
    // main changes size whenever the window, the sidebar or the side panel
    // does, and it only moves when it changes size.
    const main = document.querySelector?.('main');
    if (main && typeof ResizeObserver === 'function') {
      synthwaveWatch = new ResizeObserver(() => synthwaveFit(layer, main));
      synthwaveWatch.observe(main);
      synthwaveFit(layer, main);
    }
  }
  if (!active && set) {
    synthwaveWatch?.disconnect();
    synthwaveWatch = null;
    set.remove();
  }
}

// One stroke of light thrown from (x, y): it lies along the way it flies.
function synthwaveStroke(zap, x, y, angle, reach, turn, extra = '') {
  return zap('synthwave-zap synthwave-spark' + extra, {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': Math.round(Math.cos(angle) * reach) + 'px',
    '--dy': Math.round(Math.sin(angle) * reach) + 'px',
    '--tilt': Math.round(angle * 180 / Math.PI) + 'deg',
    '--glow': SYNTHWAVE_GLOWS[turn % SYNTHWAVE_GLOWS.length],
  });
}

function synthwaveZap(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  scene.append(zap('synthwave-zap synthwave-ring', { '--px': x + 'px', '--py': y + 'px' }));
  for (let i = 0; i < SYNTHWAVE_SPARKS; i++) {
    const angle = (i / SYNTHWAVE_SPARKS) * 2 * Math.PI - Math.PI / 2;
    scene.append(synthwaveStroke(zap, x, y, angle, 46 + (i % 2) * 24, i));
  }
}

function synthwaveTrailSpark(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  const turn = synthwaveTrailTurn++;
  const angle = (turn * 5 % SYNTHWAVE_SPARKS / SYNTHWAVE_SPARKS) * 2 * Math.PI - Math.PI / 2;
  scene.append(synthwaveStroke(zap, x, y, angle, 8 + (turn % 3) * 5, turn, ' synthwave-trail'));
}

function synthwaveTyping({ kind, data, streak, fieldRect, spawn, topEdge }) {
  const side = streak % 2 ? 1 : -1;
  const edge = { '--x': topEdge.left + 'px', '--y': fieldRect.top + 'px', '--w': topEdge.width + 'px' };
  if (kind === 'char') {
    const glyph = Array.from(data).pop();
    if (glyph && glyph.trim()) spawn('synthwave-typed synthwave-typed-ghost', glyph, { '--drift': side * 6 + 'px' });
    [0, 1].forEach(i => {
      const angle = (-90 + (i ? 1 : -1) * (25 + (streak * 17) % 45)) * Math.PI / 180;
      const reach = 22 + (streak * 5 + i * 7) % 14;
      spawn('synthwave-typed synthwave-typed-spark', '', {
        '--dx': Math.round(Math.cos(angle) * reach) + 'px', '--dy': Math.round(Math.sin(angle) * reach) + 'px',
        '--tilt': Math.round(angle * 180 / Math.PI) + 'deg', '--glow': SYNTHWAVE_GLOWS[(streak + i) % 2],
      });
    });
  } else if (kind === 'space') {
    spawn('synthwave-typed synthwave-typed-scan', '', edge);
  } else if (kind === 'delete') {
    for (let i = 0; i < 4; i++) {
      spawn('synthwave-typed synthwave-typed-pixel', '', {
        '--dx': (i % 2 ? 1 : -1) * (8 + i * 5) + 'px', '--dy': -(10 + i * 4) + 'px',
        '--glow': SYNTHWAVE_GLOWS[(streak + i) % 3],
      });
    }
  } else if (kind === 'paste') {
    spawn('synthwave-typed synthwave-typed-tape', '', edge);
    spawn('synthwave-typed synthwave-typed-play', '▶ PLAY', edge);
  }
}

const synthwaveMode = defineFunMode({
  id: 'synthwave',
  label: 'Synthwave',
  blurb: 'Neon grids and palms, rad~',
  favicon: SYNTHWAVE_FAVICON,
  announce: { on: 'Synthwave mode on. Totally rad~', off: 'Synthwave mode off' },
  layerId: 'synthwave-scene',
  zapSelector: '.synthwave-zap',
  zapCap: SYNTHWAVE_ZAP_CAP,
  buildLayer: synthwaveSceneLayer,
  onPaint: synthwaveSet,
  burst: synthwaveZap,
  trail: synthwaveTrailSpark,
  typing: synthwaveTyping,
});

export const SYNTHWAVE_STORAGE_KEY = synthwaveMode.storageKey;
export const synthwaveIsOn = synthwaveMode.isOn;
export const paintSynthwave = synthwaveMode.paint;
export const setSynthwave = synthwaveMode.set;
export const toggleSynthwave = synthwaveMode.toggle;
export const leaveSynthwave = synthwaveMode.leave;
export function activate(ctx) {
  return synthwaveMode.activate(ctx);
}
