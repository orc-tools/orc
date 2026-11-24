// Upside Down mode. data-upside-down on <html> is the whole switch: theme.css repaints
// the shell and the artifact pages from it, and this module adds the string of
// lights, drifting spores, the crack's smoke, rays, embers and lightning, the
// night wall's storm, haze and stray spores, click surges, spore trails and
// wall letters.

import { defineFunMode } from '/js/fun-modes.js';

const UPSIDE_DOWN_BULB_COUNT = 16;
const UPSIDE_DOWN_SPORE_COUNT = 8;
const UPSIDE_DOWN_EMBER_COUNT = 18;
const UPSIDE_DOWN_EMBER_COLOURS = ['#ffb070', '#ff7a3c', '#ff3b4a'];
// The rays and the smoke over the crack, two sheets of each: how strong each
// rests, how strong it turns, and how long it takes to get there and back.
// The clocks share no beat, so the light never swells all at once.
const UPSIDE_DOWN_LIGHTS = [
  { sheet: 'rays-a', rest: .95, to: .3, dur: '9s' },
  { sheet: 'rays-b', rest: .25, to: .9, dur: '13s' },
  { sheet: 'smoke-a', rest: .9, to: .4, dur: '17s' },
  { sheet: 'smoke-b', rest: .3, to: .85, dur: '23s' },
];
// Where along the crack each bolt strikes, how long until it strikes again,
// and its lean and height, so no two strikes look or land alike.
const UPSIDE_DOWN_BOLTS = [
  { x: '23%', dur: '17s', delay: '-4s', flip: 1, tall: 1 },
  { x: '61%', dur: '23s', delay: '-15s', flip: -1, tall: 1.18 },
  { x: '84%', dur: '29s', delay: '-9s', flip: 1, tall: .84 },
];
// Where the storm lights from inside, one place in each of its two corners,
// how large the glow is and how long until it comes again.
const UPSIDE_DOWN_FLASHES = [
  { x: '59.7%', y: '-90px', wide: '41.8%', tall: '300px', dur: '19s', delay: '0s' },
  { x: '-4.5%', y: '-80px', wide: '29.9%', tall: '230px', dur: '31s', delay: '-12s' },
];
// The wall's bands from the top down, and the sheets of cloud that slide in
// each: the storm's red cloud has darker cloud passing under it.
const UPSIDE_DOWN_BANDS = [
  ['upside-down-storm', 'upside-down-cloud', 'upside-down-cloud upside-down-belly'],
  ['upside-down-haze', 'upside-down-cloud'],
  ['upside-down-heat', 'upside-down-cloud'],
];
// The spores that have left the drift, and the paths theme.css draws for
// them: up an eddy, snatched round, rocking down like ash, and at the eye.
// They are few because each is a piece of its own to keep moving for as long
// as the window is open, where a whole sheet of spores costs the same as one.
const UPSIDE_DOWN_STRAY_COUNT = 12;
const UPSIDE_DOWN_STRAY_PATHS = ['curl', 'dart', 'sink', 'loom'];
const UPSIDE_DOWN_STRAY_PALE = '#cfdcf5';
const UPSIDE_DOWN_STRAY_RED = '#ff6b78';
const UPSIDE_DOWN_WALL_ID = 'upside-down-wall';
const UPSIDE_DOWN_BULB_COLOURS = 4;
const UPSIDE_DOWN_SPARKS = 7;
const UPSIDE_DOWN_SPARK_CAP = 48;
const UPSIDE_DOWN_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<circle cx='32' cy='32' r='30' fill='#05080f'/>"
  + "<circle cx='32' cy='32' r='28.5' fill='none' stroke='#ff2d3f' stroke-width='3'/>"
  + "<path d='M9 20q23 9 46 0' fill='none' stroke='#3c4a44' stroke-width='1.5'/>"
  + "<ellipse cx='16' cy='25' rx='2.6' ry='3.6' fill='#ff3b4a'/><ellipse cx='27' cy='28' rx='2.6' ry='3.6' fill='#ffc857'/>"
  + "<ellipse cx='38' cy='28' rx='2.6' ry='3.6' fill='#4fd08a'/><ellipse cx='49' cy='25' rx='2.6' ry='3.6' fill='#5aa9ff'/>"
  + "<circle cx='32' cy='41' r='13' fill='#83c851' stroke='#182f10' stroke-width='2'/>"
  + "<circle cx='27' cy='39' r='2' fill='#182f10'/><circle cx='37' cy='39' r='2' fill='#182f10'/>"
  + "<path d='M27 48l1.5-4.5 1.5 4.5zM34 48l1.5-4.5 1.5 4.5z' fill='#fff8ec' stroke='#182f10' stroke-width='1'/>"
  + '</svg>',
);
let upsideDownTrailTurn = 0;

const upsideDownFromEdge = px => 'calc(100% - ' + px + 'px)';
const upsideDownBulbColour = turn => 'var(--upside-down-bulb-' + (turn % UPSIDE_DOWN_BULB_COLOURS + 1) + ')';

function upsideDownSkyLayer({ piece }) {
  const sky = document.createElement('div');
  sky.id = 'upside-down-sky';
  sky.setAttribute('aria-hidden', 'true');
  sky.append(piece('upside-down-piece upside-down-wire', {}));
  for (let i = 0; i < UPSIDE_DOWN_BULB_COUNT; i++) {
    sky.append(piece('upside-down-piece upside-down-bulb', {
      '--x': ((i + 0.5) * 100 / UPSIDE_DOWN_BULB_COUNT).toFixed(1) + '%',
      '--c': upsideDownBulbColour(i),
      '--tilt': (i % 2 ? 14 : -14) + 'deg',
      '--dur': (3.4 + ((i * 3) % 7) * 0.6).toFixed(1) + 's',
      '--delay': '-' + ((0.4 + i * 0.83) % 5).toFixed(2) + 's',
    }));
  }
  for (let i = 0; i < UPSIDE_DOWN_SPORE_COUNT; i++) {
    sky.append(piece('upside-down-piece upside-down-spore', {
      '--x': upsideDownFromEdge(4 + ((i * 5) % 6) * 3),
      '--y': 14 + (i * 29 + 7) % 74 + '%',
      '--size': 2 + (i * 3) % 3 + 'px',
      '--sway': ((i * 7) % 5 - 2) * 8 + 'px',
      '--dur': 7 + (i * 5) % 6 + 's',
      '--delay': '-' + ((0.6 + i * 1.3) % 9).toFixed(1) + 's',
    }));
  }
  for (const light of UPSIDE_DOWN_LIGHTS) {
    sky.append(piece('upside-down-piece upside-down-light', {
      '--sheet': 'var(--upside-down-' + light.sheet + ')', '--rest': String(light.rest), '--to': String(light.to), '--dur': light.dur,
    }));
  }
  for (let i = 0; i < UPSIDE_DOWN_EMBER_COUNT; i++) {
    sky.append(piece('upside-down-piece upside-down-ember', {
      '--x': (3 + (i * 37) % 95) + '%',
      '--y': 28 + (i * 11) % 34 + 'px',
      '--size': 2 + (i * 5) % 3 + 'px',
      '--c': UPSIDE_DOWN_EMBER_COLOURS[i % UPSIDE_DOWN_EMBER_COLOURS.length],
      '--rise': 150 + (i * 53) % 260 + 'px',
      '--sway': ((i * 7) % 9 - 4) * 11 + 'px',
      '--dur': (5 + (i * 3) % 7 * 0.9).toFixed(1) + 's',
      '--delay': '-' + ((i * 1.7) % 11).toFixed(1) + 's',
    }));
  }
  for (const bolt of UPSIDE_DOWN_BOLTS) {
    sky.append(piece('upside-down-piece upside-down-bolt', {
      '--x': bolt.x, '--dur': bolt.dur, '--delay': bolt.delay, '--flip': String(bolt.flip), '--tall': String(bolt.tall),
    }));
  }
  return sky;
}

// One stray: where in the window it flies, which path it takes, and how that
// path is turned, stretched and mirrored. The path's shape is theme.css's,
// so everything that sets one stray apart from the next is here. The strides
// share no factor with the count, so no two strays start from one place, and
// the path and the turn come round on different beats, so no two fly alike.
function upsideDownStray(i, { piece }) {
  return piece('upside-down-stray upside-down-' + UPSIDE_DOWN_STRAY_PATHS[i % UPSIDE_DOWN_STRAY_PATHS.length], {
    '--x': 3 + (i * 41) % 95 + '%',
    '--y': 5 + (i * 59) % 91 + '%',
    '--size': 4 + (i * 3) % 5 + 'px',
    '--c': i % 7 === 3 ? UPSIDE_DOWN_STRAY_RED : UPSIDE_DOWN_STRAY_PALE,
    '--turn': ((i * 7) % 13 - 6) * 9 + 'deg',
    '--reach': (0.7 + (i * 3) % 7 * 0.15).toFixed(2),
    '--flip': i % 3 === 1 ? '-1' : '1',
    '--dur': 13 + (i * 7) % 23 + 's',
    '--delay': '-' + ((1.9 + i * 4.3) % 31).toFixed(1) + 's',
  });
}

// The night wall's weather lies under the spores' sheets, which lie under
// everything, so it is a layer of its own: the sky's pieces pass over the
// chrome. theme.css draws all of it and gives the layer its nearest spores.
// The strays fly over the weather and under the sheets, and the last piece is
// the sheet of the spores' second current, which crosses the body's first.
function upsideDownWallLayer({ piece }) {
  const wall = document.createElement('div');
  wall.id = UPSIDE_DOWN_WALL_ID;
  wall.setAttribute('aria-hidden', 'true');
  for (const flash of UPSIDE_DOWN_FLASHES) {
    wall.append(piece('upside-down-flash', {
      '--x': flash.x, '--y': flash.y, '--wide': flash.wide, '--tall': flash.tall, '--dur': flash.dur, '--delay': flash.delay,
    }));
  }
  for (const [name, ...clouds] of UPSIDE_DOWN_BANDS) {
    const band = piece('upside-down-band ' + name);
    for (const cloud of clouds) band.append(piece(cloud));
    wall.append(band);
  }
  for (let i = 0; i < UPSIDE_DOWN_STRAY_COUNT; i++) wall.append(upsideDownStray(i, { piece }));
  wall.append(piece('upside-down-cross'));
  return wall;
}

function upsideDownWall(on, _announce, helpers) {
  const wall = document.getElementById(UPSIDE_DOWN_WALL_ID);
  if (on && !wall) document.body.append(upsideDownWallLayer(helpers));
  if (!on && wall) wall.remove();
}

function upsideDownSurge(x, y, { zap, layerWithRoom }) {
  const sky = layerWithRoom(UPSIDE_DOWN_SPARKS + 1);
  if (!sky) return;
  sky.append(zap('upside-down-spark upside-down-surge', { '--px': x + 'px', '--py': y + 'px' }));
  for (let i = 0; i < UPSIDE_DOWN_SPARKS; i++) {
    const angle = i / UPSIDE_DOWN_SPARKS * Math.PI * 2 - Math.PI / 2;
    sky.append(zap('upside-down-spark', {
      '--px': x + 'px',
      '--py': y + 'px',
      '--c': upsideDownBulbColour(i),
      '--dx': Math.round(Math.cos(angle) * 32) + 'px',
      '--dy': Math.round(Math.sin(angle) * 32) + 'px',
      '--delay': (i % 2 * 0.04).toFixed(2) + 's',
    }));
  }
}

function upsideDownTrailSpore(x, y, { zap, layerWithRoom }) {
  const sky = layerWithRoom(1);
  if (!sky) return;
  const turn = upsideDownTrailTurn++;
  sky.append(zap('upside-down-spark upside-down-trail', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': ((turn * 3) % 7 - 3) * 3 + 'px',
    '--dy': -(10 + (turn * 7) % 12) + 'px',
  }));
}

const UPSIDE_DOWN_TYPED_CALLS = ['do you copy?', 'roll for initiative', 'over and out', 'code red'];
const UPSIDE_DOWN_LETTER = /^[a-z]$/i;

function upsideDownTyping({ kind, data, x, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const bulb = (dx, dy, delay, turn) => spawn('upside-down-typed upside-down-typed-bulb', '', {
    '--c': upsideDownBulbColour(turn), '--dx': dx + 'px', '--dy': dy + 'px', '--delay': delay + 's',
  });
  if (kind === 'char') {
    if (UPSIDE_DOWN_LETTER.test(data || '')) spawn('upside-down-typed upside-down-typed-letter', data.toUpperCase(), { '--c': upsideDownBulbColour(streak) });
    else bulb(side * (5 + (streak * 5) % 7), -(10 + (streak * 3) % 8), 0, streak);
    if (streak > 12) bulb(side * (8 + (streak * 7) % 9), -(14 + (streak * 5) % 10), 0.03, streak + 1);
  } else if (kind === 'space') {
    spawn('upside-down-typed upside-down-typed-spore', '', { '--dx': side * 5 + 'px', '--size': 4 + (streak % 3) + 'px' });
  } else if (kind === 'delete') {
    spawn('upside-down-typed upside-down-typed-out', '');
  } else if (kind === 'paste') {
    for (let i = 0; i < 6; i++) bulb((i - 2.5) * 10, -(14 + (2.5 - Math.abs(i - 2.5)) * 8), Math.abs(i - 2.5) * 0.03, i);
  }
  if (streak % 20 === 0) {
    const at = Math.min(Math.max(x, fieldRect.left + 20), fieldRect.right - 140);
    spawn('upside-down-typed upside-down-typed-bike', '🚲', { '--x': at + 'px', '--y': fieldRect.top + 'px' });
    spawn('upside-down-typed upside-down-typed-say', UPSIDE_DOWN_TYPED_CALLS[(streak / 20) % UPSIDE_DOWN_TYPED_CALLS.length], {
      '--x': at + 22 + 'px', '--y': fieldRect.top - 24 + 'px',
    });
  }
}

const upsideDownMode = defineFunMode({
  id: 'upside-down',
  label: 'Upside Down',
  blurb: 'The lights are flickering~',
  favicon: UPSIDE_DOWN_FAVICON,
  announce: { on: 'Upside Down mode on. The lights are flickering~', off: 'Upside Down mode off' },
  layerId: 'upside-down-sky',
  zapSelector: '.upside-down-spark',
  zapCap: UPSIDE_DOWN_SPARK_CAP,
  buildLayer: upsideDownSkyLayer,
  onPaint: upsideDownWall,
  burst: upsideDownSurge,
  trail: upsideDownTrailSpore,
  typing: upsideDownTyping,
});

export const UPSIDE_DOWN_STORAGE_KEY = upsideDownMode.storageKey;
export const upsideDownIsOn = upsideDownMode.isOn;
export const paintUpsideDown = upsideDownMode.paint;
export const setUpsideDown = upsideDownMode.set;
export const toggleUpsideDown = upsideDownMode.toggle;
export const leaveUpsideDown = upsideDownMode.leave;
export function activate(ctx) {
  return upsideDownMode.activate(ctx);
}
