// Orbit mode. data-orbit on <html> is the whole switch: theme.css repaints the
// shell and the artifact pages from it, and this module adds the stars,
// satellite and comets at the window's edge, project home's planet and
// moving sky, thruster sparks, exhaust trails and typing telemetry.

import { defineFunMode } from '/js/fun-modes.js';

const ORBIT_STAR_COUNT = 14;
// Where each comet starts its fall, and how long it stays away between falls.
// The waits share no factor, so the two rarely fall together.
const ORBIT_COMETS = [
  { '--x': '98.8%', '--y': '20%', '--size': '64px', '--dur': '23s', '--delay': '-6s' },
  { '--x': '99.4%', '--y': '52%', '--size': '46px', '--dur': '37s', '--delay': '-30s' },
];
const ORBIT_SPARKS = 7;
const ORBIT_SPARK_CAP = 48;
const ORBIT_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<circle cx='32' cy='32' r='30' fill='#0b1020'/>"
  + "<circle cx='12' cy='14' r='1.4' fill='#ffffff'/><circle cx='52' cy='10' r='1' fill='#ffffff'/><circle cx='55' cy='48' r='1.3' fill='#ffffff'/>"
  + "<ellipse cx='32' cy='35' rx='29' ry='7' fill='none' stroke='#ffb347' stroke-width='3' transform='rotate(-14 32 35)'/>"
  + "<circle cx='32' cy='32' r='19' fill='#eef0f4' stroke='#121110' stroke-width='3'/>"
  + "<circle cx='32' cy='32' r='14' fill='#83c851' stroke='#182f10' stroke-width='2'/>"
  + "<circle cx='27' cy='30' r='2' fill='#182f10'/><circle cx='37' cy='30' r='2' fill='#182f10'/>"
  + "<path d='M27 39l1.5-4.5 1.5 4.5zM34 39l1.5-4.5 1.5 4.5z' fill='#fff8ec' stroke='#182f10' stroke-width='1'/>"
  + "<path d='M22 24a13 13 0 0 1 10-6' fill='none' stroke='#5fd4f0' stroke-width='3' stroke-linecap='round' stroke-opacity='.8'/>"
  + "<path d='M3 37q29 12 58 -6' fill='none' stroke='#ffb347' stroke-width='3' stroke-linecap='round'/>"
  + '</svg>',
);
let orbitTrailTurn = 0;

function orbitSkyLayer({ piece }) {
  const sky = document.createElement('div');
  sky.id = 'orbit-sky';
  sky.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < ORBIT_STAR_COUNT; i++) {
    sky.append(piece('orbit-piece orbit-star', '', {
      '--x': (96.6 + ((i * 7) % 6) * 0.55).toFixed(1) + '%',
      '--y': 12 + (i * 37 + 11) % 76 + '%',
      '--size': 2 + (i * 5) % 3 + 'px',
      '--dur': (1.6 + ((i * 3) % 7) * 0.4).toFixed(1) + 's',
      '--delay': '-' + ((0.3 + i * 0.77) % 4).toFixed(1) + 's',
    }));
  }
  // Drawn by theme.css's --orbit-satellite, the same craft that crosses
  // project home.
  sky.append(piece('orbit-piece orbit-satellite', {
    '--x': '98.2%', '--y': '18%', '--size': '30px', '--dur': '9s', '--delay': '-2.5s',
  }));
  for (const fall of ORBIT_COMETS) sky.append(piece('orbit-piece orbit-comet', fall));
  return sky;
}

// Project home's own sky, laid in #new-view under the composer and the notes:
// stars that twinkle, shooting stars, a satellite crossing and the ringed
// planet with its moons, low in the bottom right. theme.css shows it only at
// night and wider than a phone. defineFunMode lays it again whenever
// buildNewConversation rewrites the view.
const HOME_ID = 'orbit-home';
const PLANET_R = 92;                       // the globe's radius, px
const RING_OPEN = 15.7 * Math.PI / 180;    // how far the rings open towards us
const RING_SQUASH = Math.sin(RING_OPEN);
// What goes round the axis: latitude, where it rests (0 the left limb, 90
// facing us, 180 the right limb), seconds per turn, kind, width, height,
// strength. Latitudes nearer the equator go round faster.
const PLANET_FEATURES = [
  [29, 62, 96, 'storm', 20, 9, .85],
  [9, 40, 78, 'wisp', 44, 4, .5], [9, 200, 78, 'wisp', 36, 3.4, .45],
  [-12, 110, 74, 'wisp', 50, 4.4, .5], [-12, 300, 74, 'wisp', 34, 3.4, .45],
  [-33, 70, 88, 'wisp', 38, 3.6, .42], [-33, 250, 88, 'knot', 30, 4, .4],
  [20, 130, 84, 'knot', 34, 4.2, .42], [20, 330, 84, 'wisp', 30, 3, .4],
  [44, 95, 104, 'wisp', 32, 3.2, .4], [44, 280, 104, 'knot', 26, 3.6, .36],
  [-48, 50, 108, 'wisp', 30, 3, .36], [-48, 215, 108, 'knot', 28, 3.6, .36],
  [58, 150, 118, 'wisp', 24, 2.6, .34],
  [-2, 160, 72, 'knot', 40, 3.6, .34], [-2, 20, 72, 'wisp', 30, 3, .4],
];
// Two moons in the plane of the rings: orbit radius in planet radii, seconds
// per orbit, where each rests, and size.
const PLANET_MOONS = [['a', 2.95, 400, 335, 13], ['b', 3.9, 640, 278, 6]];
const HOME_TWINKLES = 30;
// Where each shooting star starts, how far it falls and how long it waits
// between falls. The waits share no factor, so one falls about every ten
// seconds and two seldom fall together.
const HOME_METEORS = [
  { '--x': '37%', '--y': '36.5%', '--len': '130px', '--a': '152deg', '--dx': '-230px', '--dy': '122px', '--dur': '23s', '--delay': '-22.5s' },
  { '--x': '52%', '--y': '70%', '--len': '110px', '--a': '150deg', '--dx': '-242px', '--dy': '140px', '--dur': '37s', '--delay': '-9s' },
  { '--x': '98%', '--y': '52%', '--len': '120px', '--a': '155deg', '--dx': '-218px', '--dy': '101px', '--dur': '53s', '--delay': '-12s' },
];

const px = value => value.toFixed(1) + 'px';

function node(className, props = {}, ...children) {
  const el = document.createElement('div');
  el.className = className;
  for (const [prop, val] of Object.entries(props)) el.style.setProperty(prop, val);
  el.append(...children);
  return el;
}

// One thing going round the planet's axis the way the planet turns, left to
// right across the near side: across and down are eased apart, as a cosine
// and a sine of one angle, on a circle seen at the rings' tilt. `side` is the
// half of the turn this copy shows for. It rests where its motion starts, so
// with animations reduced it stays put.
function orbiter({ a, b, period, at, side, y0 = 0, squeeze = false }, body) {
  const turn = at * Math.PI / 180;
  const near = Math.sin(turn) > 0;
  return node('orbit-go orbit-' + side, {
    '--half': period / 2 + 's', '--period': period + 's', '--t0': '-' + (at / 360 * period).toFixed(1) + 's',
    '--a': px(a), '--b': px(b), '--rx': px(-a * Math.cos(turn)), '--ry': px(b * Math.sin(turn)),
    '--rs': Math.sin(turn).toFixed(3), '--y0': px(y0), '--rest': (side === 'near') === near ? '1' : '0',
  }, node('orbit-ox', {}, node('orbit-oy', {}, squeeze ? node('orbit-sq', {}, body) : body)));
}

function moons(side) {
  return PLANET_MOONS.map(([kind, k, period, at, size]) => orbiter(
    { a: k * PLANET_R, b: k * PLANET_R * RING_SQUASH, period, at, side },
    node('orbit-moon orbit-moon-' + kind, { '--d': size + 'px' })));
}

// A latitude's circle as it is seen: where its centre sits along the axis,
// and its half-width and half-height.
function latitude(degrees) {
  const lat = degrees * Math.PI / 180;
  const a = PLANET_R * Math.cos(lat);
  return { y0: -PLANET_R * Math.sin(lat) * Math.cos(RING_OPEN), a, b: a * RING_SQUASH };
}

function features() {
  return PLANET_FEATURES.map(([lat, at, period, kind, w, h, strength]) => orbiter(
    { ...latitude(lat), period, at, side: 'near', squeeze: true },
    node('orbit-feature orbit-' + kind, { '--w': w + 'px', '--h': h + 'px', '--o': String(strength) })));
}

// The same stars on every page, spread over the open sky. The planet, the
// composer and the notes paint over any that fall behind them.
function twinkles() {
  let state = 5;
  const roll = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const stars = [];
  for (let i = 0; i < HOME_TWINKLES; i++) {
    stars.push(node('orbit-twinkle' + (i % 5 ? '' : ' orbit-twinkle-big'), {
      '--x': (1.5 + roll() * 97).toFixed(1) + '%',
      '--y': (1.5 + roll() * 97).toFixed(1) + '%',
      '--s': [1.8, 2.2, 2.6, 3.2][i % 4] + 'px',
      '--c': ['#ffffff', '#ffffff', '#cfe6ff', '#ffe2b0'][(i * 7) % 4],
      '--dur': (1.7 + (i * 3) % 7 * .45).toFixed(2) + 's',
      '--delay': '-' + ((.3 + i * .77) % 4).toFixed(2) + 's',
    }));
  }
  return stars;
}

// Dark spokes ride the bright ring, as Saturn's do: one copy on the rings
// behind the globe, one on the near rings over it.
function spokes(near) {
  return node('orbit-ringplane', {}, node('orbit-sunward' + (near ? ' orbit-sunward-near' : ''), {}, node('orbit-spokes')));
}

function orbitHomeLayer() {
  const home = node('orbit-home');
  home.id = HOME_ID;
  home.setAttribute('aria-hidden', 'true');
  // Bottom to top: the far moons, the rings behind the globe and their
  // spokes, the banded globe and what turns on it, its shading, the near
  // rings and their spokes, then the near moons.
  const planet = node('orbit-planet', {},
    node('orbit-axis', {}, ...moons('far')),
    node('orbit-layer orbit-ring-back'),
    spokes(false),
    node('orbit-layer orbit-globe'),
    node('orbit-disc', {}, node('orbit-axis', {}, ...features())),
    node('orbit-layer orbit-shade'),
    node('orbit-layer orbit-ring-front'),
    node('orbit-disc', {}, spokes(true)),
    node('orbit-axis', {}, ...moons('near')));
  home.append(
    ...twinkles(),
    // Each falls on its own keyframes, theme.css's orbit-meteor-<n>: it
    // crosses in about a second whatever its wait.
    ...HOME_METEORS.map((fall, i) => node('orbit-meteor orbit-meteor-' + i, fall)),
    node('orbit-crossing', {}, node('orbit-crossing-arc', {}, node('orbit-craft'), node('orbit-beacon'))),
    planet);
  return home;
}

function orbitThrust(x, y, { zap, layerWithRoom }) {
  const sky = layerWithRoom(ORBIT_SPARKS + 1);
  if (!sky) return;
  sky.append(zap('orbit-spark orbit-puff', { '--px': x + 'px', '--py': y + 'px' }));
  for (let i = 0; i < ORBIT_SPARKS; i++) {
    const turn = (i - (ORBIT_SPARKS - 1) / 2) / ((ORBIT_SPARKS - 1) / 2);
    sky.append(zap('orbit-spark', {
      '--px': x + 'px',
      '--py': y + 'px',
      '--dx': Math.round(turn * 34) + 'px',
      '--dy': Math.round(26 + (1 - Math.abs(turn)) * 22) + 'px',
      '--delay': (Math.abs(turn) * 0.04).toFixed(2) + 's',
    }));
  }
}

function orbitTrailSpark(x, y, { zap, layerWithRoom }) {
  const sky = layerWithRoom(1);
  if (!sky) return;
  const turn = orbitTrailTurn++;
  sky.append(zap('orbit-spark orbit-trail', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': ((turn * 3) % 7 - 3) * 3 + 'px',
    '--dy': 10 + (turn * 7) % 12 + 'px',
  }));
}

const ORBIT_TYPED_CALLS = ['go for launch', 'liftoff!', 'roger', 'all systems go'];

function orbitTyping({ kind, x, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const spark = (dx, dy, delay) => spawn('orbit-typed orbit-typed-spark', '', {
    '--dx': dx + 'px', '--dy': dy + 'px', '--delay': delay + 's',
  });
  if (kind === 'char') {
    spark(-6 - (streak * 5) % 7, 8 + (streak * 3) % 8, 0);
    if (streak > 12) spark(side * (6 + (streak * 7) % 9), 12 + (streak * 5) % 10, 0.03);
  } else if (kind === 'space') {
    spawn('orbit-typed orbit-typed-ring', '', { '--dx': side * 6 + 'px', '--size': 9 + (streak % 3) * 3 + 'px' });
  } else if (kind === 'delete') {
    spawn('orbit-typed orbit-typed-abort', 'abort');
  } else if (kind === 'paste') {
    for (let i = 0; i < 6; i++) spark((i - 2.5) * 9, 14 + (2.5 - Math.abs(i - 2.5)) * 8, Math.abs(i - 2.5) * 0.03);
  }
  if (streak % 20 === 0) {
    const at = Math.min(Math.max(x, fieldRect.left + 20), fieldRect.right - 120);
    spawn('orbit-typed orbit-typed-launch', '🚀', { '--x': at + 'px', '--y': fieldRect.top + 'px' });
    spawn('orbit-typed orbit-typed-say', ORBIT_TYPED_CALLS[(streak / 20) % ORBIT_TYPED_CALLS.length], {
      '--x': at + 22 + 'px', '--y': fieldRect.top - 24 + 'px',
    });
  }
}

const orbitMode = defineFunMode({
  id: 'orbit',
  label: 'Orbit',
  blurb: 'Go for launch~',
  favicon: ORBIT_FAVICON,
  announce: { on: 'Orbit mode on. Go for launch~', off: 'Orbit mode off' },
  layerId: 'orbit-sky',
  zapSelector: '.orbit-spark',
  zapCap: ORBIT_SPARK_CAP,
  buildLayer: orbitSkyLayer,
  homeLayerId: HOME_ID,
  buildHomeLayer: orbitHomeLayer,
  burst: orbitThrust,
  trail: orbitTrailSpark,
  typing: orbitTyping,
});

export const ORBIT_STORAGE_KEY = orbitMode.storageKey;
export const orbitIsOn = orbitMode.isOn;
export const paintOrbit = orbitMode.paint;
export const setOrbit = orbitMode.set;
export const toggleOrbit = orbitMode.toggle;
export const leaveOrbit = orbitMode.leave;
export function activate(ctx) {
  return orbitMode.activate(ctx);
}
