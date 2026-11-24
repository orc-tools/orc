// Ocean mode. data-ocean on <html> is the whole switch: theme.css repaints
// the shell and the artifact pages from it, and this module adds the parts CSS
// cannot: the scenery under the page, a click's bubbles, the trail of bubbles
// a held press leaves and typing drops, and the creatures giving way to the
// pointer.
// The scenery (#ocean-deep) lies below the page's content and the bubbles
// (#ocean-sea) rise over it, so they are two layers.

import { defineFunMode } from '/js/fun-modes.js';
import { animationsOff } from '/js/motion.js';

const OCEAN_DEEP_ID = 'ocean-deep';
// Two fans of light from the same sun, the second turned to fill the gaps
// the first leaves.
const OCEAN_RAYS = [
  { '--dur': '11s', '--delay': '-3s' },
  { '--dur': '17s', '--delay': '-9s', rotate: '9deg' },
];
// Each tile drifts by its own height, so the nearer specks pass the far dust.
const OCEAN_MOTES = [
  { kind: 'specks', '--tile': '480px', '--dur': '80s' },
  { kind: 'dust', '--tile': '340px', '--dur': '120s' },
];
const OCEAN_SURFACE = [
  { '--h': '20px', '--alpha': '.5', '--dur': '14s' },
  { '--h': '13px', '--alpha': '.7', '--dur': '9s', '--way': 'reverse' },
];
// Kelp and coral stand at the two sides of the page: just off the sidebar and
// in the window's right corner, where a transcript leaves open water.
const OCEAN_KELP = [
  { '--x': 'calc(var(--ocean-rail) + 6px)', '--w': '52px', '--dur': '6.4s', '--delay': '-1.2s' },
  { '--x': 'calc(var(--ocean-rail) + 46px)', '--w': '72px', '--dur': '7.6s', '--delay': '-3.4s' },
  { '--x': 'calc(var(--ocean-rail) + 104px)', '--w': '44px', '--dur': '5.8s', '--delay': '-2.2s' },
  { '--x': 'calc(100% - 92px)', '--w': '68px', '--dur': '7s', '--delay': '-4.6s' },
  { '--x': 'calc(100% - 150px)', '--w': '46px', '--dur': '6.1s', '--delay': '-0.7s' },
];
const OCEAN_REEFS = [
  { '--x': 'calc(var(--ocean-rail) - 40px)' },
  { '--x': 'calc(100% - 240px)', '--dir': '-1' },
];
// --lane runs from just under the run's header (0) to the seabed (1), --x is
// where a swimmer rests when motion is off, and the delays put a few of them
// in the open water at any moment. The whale comes first of the night's
// swimmers, so the rest cross in front of it.
const OCEAN_SWIMMERS = [
  { kind: 'school ocean-sunny ocean-day', '--w': '184px', '--h': '83px', '--lane': '.16', '--dir': '1', '--dur': '52s', '--delay': '-26.5s', '--x': '88vw', '--bob': '6px' },
  { kind: 'fish ocean-coral ocean-day', '--w': '64px', '--h': '40px', '--lane': '.52', '--dir': '-1', '--dur': '34s', '--delay': '-5s', '--x': '22vw', '--bob': '9px' },
  { kind: 'angel ocean-violet ocean-day', '--w': '54px', '--h': '58px', '--lane': '.58', '--dir': '1', '--dur': '40s', '--delay': '-17.3s', '--x': '93vw', '--bob': '11px' },
  { kind: 'turtle ocean-shell ocean-day', '--w': '132px', '--h': '84px', '--lane': '.74', '--dir': '-1', '--dur': '70s', '--delay': '-55.7s', '--x': '91vw', '--bob': '14px' },
  { kind: 'school ocean-lagoon ocean-day', '--w': '122px', '--h': '55px', '--lane': '.27', '--dir': '-1', '--dur': '60s', '--delay': '-24.1s', '--x': '20vw', '--bob': '5px' },
  { kind: 'fish ocean-sunny ocean-day', '--w': '44px', '--h': '28px', '--lane': '.86', '--dir': '1', '--dur': '28s', '--delay': '-15.5s', '--x': '24vw', '--bob': '7px' },
  { kind: 'whale ocean-far ocean-night', '--w': '330px', '--h': '121px', '--lane': '.32', '--dir': '-1', '--dur': '160s', '--delay': '-31.7s', '--x': '60vw', '--bob': '10px' },
  { kind: 'angler ocean-shade ocean-night', '--w': '96px', '--h': '72px', '--lane': '.46', '--dir': '1', '--dur': '58s', '--delay': '-33.2s', '--x': '91vw', '--bob': '8px' },
  { kind: 'school ocean-lantern ocean-night', '--w': '184px', '--h': '83px', '--lane': '.2', '--dir': '-1', '--dur': '54s', '--delay': '-18.3s', '--x': '20vw', '--bob': '6px' },
  { kind: 'fish ocean-shade ocean-night', '--w': '64px', '--h': '40px', '--lane': '.62', '--dir': '1', '--dur': '36s', '--delay': '-26s', '--x': '24vw', '--bob': '9px' },
  { kind: 'school ocean-lantern ocean-night', '--w': '122px', '--h': '55px', '--lane': '.84', '--dir': '1', '--dur': '64s', '--delay': '-39.2s', '--x': '92vw', '--bob': '5px' },
];
// --y is where each rests when motion is off.
const OCEAN_JELLIES = [
  { '--x': 'calc(var(--ocean-rail) + 70px)', '--y': '47vh', '--w': '40px', '--dur': '44s', '--delay': '-8.8s' },
  { '--x': 'calc(100% - 60px)', '--y': '44vh', '--w': '30px', '--dur': '52s', '--delay': '-15.9s' },
  { '--x': '58%', '--y': '78vh', '--w': '52px', '--dur': '48s', '--delay': '-41.2s' },
];
const OCEAN_VENTS = ['calc(var(--ocean-rail) + 38px)', 'calc(100% - 52px)', '46%'];
const OCEAN_VENT_BUBBLES = 4;
const OCEAN_BUBBLE_SIZES = [14, 9, 11, 7, 12, 8];
const OCEAN_BUBBLE_CAP = 48;
// One school on a sheet 204 wide and 92 tall: where each fish's box starts and
// its size against the 25 by 10 fish of theme.css's --ocean-minnow. The
// leaders are largest, so the school reads as one shape with a direction.
const OCEAN_SCHOOL = { w: 204, h: 92, fishW: 25, fishH: 10 };
const OCEAN_MINNOWS = [
  [150, 8, 1], [176, 30, 1.05], [120, 24, .9], [92, 6, .8], [140, 48, 1], [104, 54, .9],
  [64, 30, .85], [166, 66, .9], [124, 78, .85], [76, 70, .8], [36, 46, .75], [18, 18, .7], [52, 84, .7],
];
// How each kind gives way. `reach` is how far in px the hardest push, on its
// middle, would hold it off; the push eases as the creature gets clear, so a
// resting pointer holds it about half that far. `pull` is how fast it comes
// back, as its spring's radians a second, and `damp` the damping ratio: from
// 1 up it drifts back with no spring, because water damps it, and the
// jellyfish is well under 1 so it wobbles to rest. `shove` is how much of the
// pointer's speed towards it a creature picks up each second, so a swipe
// sends it further than a pointer easing in. `turn` is its tilt in degrees at
// full reach: a small fish darts and noses over, a whale leans and takes its
// time. `shy` is how far outside its outline in px it feels the pointer,
// OCEAN_HAND unless it says: a school is skittish and opens round the pointer
// before it is touched.
const OCEAN_REEF_FISH = { reach: 40, pull: 8, damp: 1, shove: 60, turn: 9 };
const OCEAN_WAYS = {
  fish: OCEAN_REEF_FISH,
  angel: OCEAN_REEF_FISH,
  minnow: { reach: 36, pull: 10, damp: .9, shove: 64, turn: 12, shy: 36 },
  turtle: { reach: 30, pull: 5, damp: 1.2, shove: 20, turn: 4 },
  angler: { reach: 28, pull: 5.5, damp: 1.1, shove: 24, turn: 3 },
  whale: { reach: 22, pull: 3.5, damp: 1.3, shove: 7, turn: 1.5 },
  jelly: { reach: 44, pull: 7, damp: .3, shove: 28, turn: 14, soft: true },
  // The crab has the seabed under it, so it sidesteps.
  crab: { reach: 34, pull: 11, damp: .85, shove: 64, turn: 0, grounded: true },
};
// While the pointer is on it a creature answers this many times faster than
// it drifts back: it moves at the pointer's pace and comes home at its own.
const OCEAN_GRIP = 2;
// The pointer is a hand, not a point: a creature gives way a little before
// the tip of the arrow is on its outline.
const OCEAN_HAND = 16;
// The pointer speed in px a second past which a swipe shoves no harder.
const OCEAN_SWIPE = 1200;
// The share of a push against its heading that a swimmer gives way to: a fish
// veers and slows, it does not back up.
const OCEAN_BACKWATER = .6;
// A shove can carry a creature past its reach, but never past this share of it.
const OCEAN_SLACK = 1.5;
// The first frame after a rest has no frame before it to time, and a frame
// after the tab was hidden would be one huge step.
const OCEAN_FRAME = 1 / 60;
const OCEAN_LONGEST_FRAME = 1 / 30;
// The longest step the springs take in one go: a slow frame is worked in
// several, or the stiffest of them would overshoot and shake.
const OCEAN_STEP = 1 / 120;
// A jellyfish leans its full turn at this speed in px a second, and stretches
// by OCEAN_STRETCH of its size at twice it.
const OCEAN_LEAN_SPEED = 260;
const OCEAN_STRETCH = .2;
// The orc at a brass porthole, the surface rolling behind him.
const OCEAN_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<circle cx='32' cy='32' r='30' fill='#e3a94b' stroke='#3a2710' stroke-width='3'/>"
  + "<circle cx='32' cy='32' r='22' fill='#0c4a5e' stroke='#3a2710' stroke-width='3'/>"
  + "<path d='M13.5 26a19.5 19.5 0 0 1 37 0q-4.6 3-9.2 0t-9.3 0-9.2 0-9.3 0z' fill='#3fc3d6'/>"
  + "<circle cx='32' cy='37' r='13' fill='#83c851' stroke='#182f10' stroke-width='2'/>"
  + "<circle cx='27' cy='35' r='2' fill='#182f10'/><circle cx='37' cy='35' r='2' fill='#182f10'/>"
  + "<path d='M27 44l1.5-4.5 1.5 4.5zM34 44l1.5-4.5 1.5 4.5z' fill='#fff8ec' stroke='#182f10' stroke-width='1'/>"
  + "<circle cx='45' cy='21' r='2.6' fill='none' stroke='#dff8ff' stroke-width='1.6'/><circle cx='39.5' cy='15.5' r='1.6' fill='#dff8ff'/>"
  + "<g fill='#3a2710'><circle cx='32' cy='5.6' r='1.7'/><circle cx='32' cy='58.4' r='1.7'/><circle cx='5.6' cy='32' r='1.7'/><circle cx='58.4' cy='32' r='1.7'/></g>"
  + '</svg>',
);
let oceanTrailTurn = 0;
let oceanCreatures = [];
let oceanPointer = null;
let oceanPointerWas = null;
let oceanFrame = 0;
let oceanFrameAt = 0;

// Fixed places rather than Math.random, so every toggle and every screenshot
// draws the same sea. Later pieces paint over earlier ones: the light behind,
// then the kelp, what swims and what rises, and the reef and the floor in front.
function oceanDeepLayer({ piece }) {
  const deep = document.createElement('div');
  deep.id = OCEAN_DEEP_ID;
  deep.setAttribute('aria-hidden', 'true');
  const add = (kind, place) => {
    const { kind: more = '', ...props } = place;
    const node = piece(('ocean-piece ocean-' + kind + ' ' + (more && 'ocean-' + more)).trim(), props);
    deep.append(node);
    return node;
  };
  // `host` is the piece whose box says where the creature is and `drawn` what
  // is pushed about inside it. `at` is the creature's middle and size as
  // shares of that box.
  const creature = (host, drawn, kind, { heading = 0, at = [.5, .5, 1, 1] } = {}) => {
    const [fx, fy, fw, fh] = at;
    oceanCreatures.push({ host, drawn, way: OCEAN_WAYS[kind], heading, fx, fy, fw, fh, x: 0, y: 0, vx: 0, vy: 0, held: false, shown: {} });
  };
  const swimmer = place => {
    const node = add('swimmer', place);
    const kind = place.kind.split(' ')[0];
    const heading = Number(place['--dir']);
    if (kind !== 'school') {
      creature(node, node, kind, { heading });
      return;
    }
    const { w, h, fishW, fishH } = OCEAN_SCHOOL;
    const share = (part, whole) => (part / whole * 100).toFixed(2) + '%';
    for (const [x, y, size] of OCEAN_MINNOWS) {
      const minnow = piece('ocean-minnow', {
        '--x': share(x, w), '--y': share(y, h), '--w': share(fishW * size, w), '--h': share(fishH * size, h),
      });
      node.append(minnow);
      creature(node, minnow, 'minnow', {
        heading,
        at: [(x + fishW * size / 2) / w, (y + fishH * size / 2) / h, fishW * size / w, fishH * size / h],
      });
    }
  };
  oceanCreatures = [];
  OCEAN_RAYS.forEach(place => add('ray', place));
  OCEAN_MOTES.forEach(place => add('motes', place));
  OCEAN_SURFACE.forEach(place => add('surface', place));
  OCEAN_KELP.forEach(place => add('kelp', place));
  OCEAN_SWIMMERS.forEach(swimmer);
  OCEAN_JELLIES.forEach(place => {
    const jelly = add('jelly', place);
    jelly.addEventListener('animationend', event => {
      if (event.animationName === 'ocean-ring') jelly.classList.remove('ocean-booped');
    });
    creature(jelly, jelly, 'jelly');
  });
  OCEAN_VENTS.forEach((x, vent) => {
    for (let i = 0; i < OCEAN_VENT_BUBBLES; i++) {
      const turn = vent * OCEAN_VENT_BUBBLES + i;
      add('fizz', {
        '--x': x,
        '--y': 20 + (turn * 23) % 60 + 'vh',
        '--size': 5 + (turn * 5) % 7 + 'px',
        '--dur': 9 + (turn * 3) % 5 + 's',
        '--delay': '-' + ((0.7 + turn * 2.9) % 13).toFixed(1) + 's',
        '--sway': 5 + (turn * 3) % 8 + 'px',
      });
    }
  });
  OCEAN_REEFS.forEach(place => add('reef', place));
  add('floor', {});
  const crab = add('crab', { '--x': 'calc(100% - 168px)', '--walk': '84px' });
  creature(crab, crab, 'crab');
  return deep;
}

function oceanSeaLayer() {
  const sea = document.createElement('div');
  sea.id = 'ocean-sea';
  sea.setAttribute('aria-hidden', 'true');
  return sea;
}

function oceanScenery(on, _announce, helpers) {
  const deep = document.getElementById(OCEAN_DEEP_ID);
  if (on && !deep) document.body.append(oceanDeepLayer(helpers));
  if (!on && deep) {
    deep.remove();
    oceanCreatures = [];
    oceanPointerGone();
    if (oceanFrame) cancelAnimationFrame(oceanFrame);
    oceanFrame = 0;
    oceanFrameAt = 0;
  }
}

function oceanPointerAt(event) {
  if (!oceanCreatures.length) return;
  // Reduce animations stills the sea, so nothing in it is pushed about.
  if (animationsOff()) {
    oceanPointerGone();
    return;
  }
  oceanPointer = { x: event.clientX, y: event.clientY };
  if (!oceanFrame) oceanFrame = requestAnimationFrame(oceanSwim);
}

// The creatures still out drift home: their frames are already running.
function oceanPointerGone() {
  oceanPointer = null;
  oceanPointerWas = null;
}

// Where the pointer is and how fast it got there since the last frame, in px
// a second. Timed by frames, not events, so a still pointer has no speed.
function oceanHand(dt) {
  if (!oceanPointer) return null;
  const was = oceanPointerWas || oceanPointer;
  oceanPointerWas = oceanPointer;
  return { x: oceanPointer.x, y: oceanPointer.y, vx: (oceanPointer.x - was.x) / dt, vy: (oceanPointer.y - was.y) / dt };
}

// One frame of every creature. The scenery lies under the page and takes no
// pointer events, so each creature's box is read here, all of them before
// anything is written. The frames stop once nothing is pushed or out of place
// and start again with the pointer's next move.
function oceanSwim(now) {
  const dt = oceanFrameAt ? Math.min(OCEAN_LONGEST_FRAME, (now - oceanFrameAt) / 1000) : OCEAN_FRAME;
  const hand = oceanHand(dt);
  const boxes = new Map();
  if (hand) {
    for (const { host } of oceanCreatures) if (!boxes.has(host)) boxes.set(host, host.getBoundingClientRect());
  }
  const steps = Math.ceil(dt / OCEAN_STEP);
  let moving = false;
  for (const creature of oceanCreatures) {
    const box = boxes.get(creature.host);
    let away = false;
    for (let step = 0; step < steps; step++) away = oceanPush(creature, hand, box, dt / steps);
    oceanDraw(creature);
    moving = moving || away;
  }
  oceanFrame = moving ? requestAnimationFrame(oceanSwim) : 0;
  oceanFrameAt = moving ? now : 0;
}

// A creature is a damped spring about its place in its box, and the pointer
// pushes on the oval inside that box, because the corners are open water.
// The push is on where the creature is now, not where it started: it eases as
// the creature gets clear, so a resting pointer holds it off at a distance
// instead of throwing it, and it goes on for as long as the pointer is there.
// True while the creature is pushed or away from its place.
function oceanPush(creature, hand, box, dt) {
  const { way, heading } = creature;
  let held = false;
  let pull = way.pull;
  let push = 0;
  let nx = 0;
  let ny = 0;
  // A creature that is not drawn has no box to push on.
  if (hand && box.width > 0) {
    const shy = way.shy ?? OCEAN_HAND;
    const rx = box.width * creature.fw / 2 + shy;
    const ry = box.height * creature.fh / 2 + shy;
    // A swimmer heading left is mirrored, and so is its school.
    const dx = box.left + box.width * (heading < 0 ? 1 - creature.fx : creature.fx) + creature.x - hand.x;
    const dy = box.top + box.height * creature.fy + creature.y - hand.y;
    const depth = 1 - Math.hypot(dx / rx, dy / ry);
    if (depth > 0) {
      held = true;
      pull *= OCEAN_GRIP;
      // Straight out through the oval's edge, so a push on a whale's back
      // sends it down, not along. From dead centre there is no way to give,
      // so it goes up.
      nx = dx / (rx * rx);
      ny = dy / (ry * ry);
      const length = Math.hypot(nx, ny);
      nx = length ? nx / length : 0;
      ny = length ? ny / length : -1;
      if (way.grounded) {
        nx = Math.sign(dx) || 1;
        ny = 0;
      } else if (nx * heading < 0) {
        nx *= OCEAN_BACKWATER;
      }
      const closing = Math.max(0,
        Math.min(OCEAN_SWIPE, hand.vx * nx + hand.vy * ny) - (creature.vx * nx + creature.vy * ny));
      push = depth * (pull * pull * way.reach + way.shove * closing);
    }
  }
  creature.vx += (push * nx - pull * pull * creature.x - 2 * way.damp * pull * creature.vx) * dt;
  creature.vy += (push * ny - pull * pull * creature.y - 2 * way.damp * pull * creature.vy) * dt;
  creature.x += creature.vx * dt;
  creature.y += creature.vy * dt;
  const out = Math.hypot(creature.x, creature.y);
  const most = way.reach * OCEAN_SLACK;
  if (out > most) {
    // Stopped at the end of its slack, it keeps only the speed along it.
    const ux = creature.x / out;
    const uy = creature.y / out;
    const outward = Math.max(0, creature.vx * ux + creature.vy * uy);
    creature.vx -= outward * ux;
    creature.vy -= outward * uy;
    creature.x = ux * most;
    creature.y = uy * most;
  }
  const home = !held && out < .05 && Math.hypot(creature.vx, creature.vy) < 1;
  if (home) creature.x = creature.y = creature.vx = creature.vy = 0;
  // A jellyfish that the pointer has just found is booped: a ring spreads
  // from where it was.
  if (way.soft && held && !creature.held) creature.host.classList.add('ocean-booped');
  creature.held = held;
  return !home;
}

// theme.css moves each drawing by these. A mirrored swimmer's drawing is
// mirrored with it, which would turn the push round. A swimmer tips its nose
// the way it is pushed; a jellyfish leans the way it is going, stretches with
// its speed and brightens the further out it is.
function oceanDraw(creature) {
  const { drawn, shown, way } = creature;
  const set = (name, value, unit, step) => {
    const text = (Math.round(value / step) * step || 0).toFixed(2) * 1 + unit;
    // Nothing is written on a creature until it first moves.
    if ((shown[name] || 0 + unit) === text) return;
    shown[name] = text;
    drawn.style.setProperty(name, text);
  };
  set('--push-x', creature.x * (creature.heading || 1), 'px', .1);
  set('--push-y', creature.y, 'px', .1);
  if (way.soft) {
    set('--push-turn', way.turn * Math.max(-1, Math.min(1, creature.vx / OCEAN_LEAN_SPEED)), 'deg', .1);
    set('--push-stretch', OCEAN_STRETCH * Math.min(1, Math.hypot(creature.vx, creature.vy) / (OCEAN_LEAN_SPEED * 2)), '', .01);
    set('--push-glow', Math.min(1, Math.hypot(creature.x, creature.y) / way.reach), '', .01);
  } else if (way.turn) {
    set('--push-turn', way.turn * creature.y / way.reach, 'deg', .1);
  }
}

function oceanBubbles(x, y, { zap, layerWithRoom }) {
  const sea = layerWithRoom(OCEAN_BUBBLE_SIZES.length);
  if (!sea) return;
  OCEAN_BUBBLE_SIZES.forEach((size, i) => sea.append(zap('ocean-bubble', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--size': size + 'px',
    '--dx': (i * 2 - 5) * 6 + 'px',
    '--dy': -(80 + (i * 37) % 60) + 'px',
    '--delay': ((i + 1) * 0.04).toFixed(2) + 's',
  })));
}

function oceanTrailBubble(x, y, { zap, layerWithRoom }) {
  const sea = layerWithRoom(1);
  if (!sea) return;
  const turn = oceanTrailTurn++;
  sea.append(zap('ocean-bubble ocean-trail', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': ((turn * 3) % 7 - 3) * 4 + 'px',
    '--dy': -(34 + (turn * 11) % 30) + 'px',
  }));
}

function oceanTyping({ kind, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const drop = (dx, up, delay, place = {}) => spawn('ocean-typed ocean-typed-drop', '', {
    '--dx': dx + 'px', '--up': -up + 'px', '--delay': delay + 's', ...place,
  });
  if (kind === 'char') {
    spawn('ocean-typed ocean-typed-ripple', '');
    const drops = streak > 12 ? 2 : 1;
    for (let i = 0; i < drops; i++) drop(side * (8 + i * 11 + (streak * 7) % 9), 16 + (streak * 5 + i * 9) % 18, i * 0.04);
  } else if (kind === 'space') {
    spawn('ocean-typed ocean-typed-bubble', '', { '--sway': side * 7 + 'px', '--size': 9 + (streak % 3) * 3 + 'px' });
  } else if (kind === 'delete') {
    spawn('ocean-typed ocean-typed-pop', '');
    spawn('ocean-typed ocean-typed-plip', 'plip');
  } else if (kind === 'paste') {
    spawn('ocean-typed ocean-typed-fish', '', {
      '--x': fieldRect.left + 'px', '--y': fieldRect.top + 'px', '--w': fieldRect.width + 'px',
    });
  }
  if (streak % 20 === 0) {
    const blowhole = { '--x': fieldRect.right - 36 + 'px', '--y': fieldRect.top - 30 + 'px' };
    spawn('ocean-typed ocean-typed-whale', '', { '--x': fieldRect.right - 36 + 'px', '--y': fieldRect.top + 'px' });
    for (let i = 0; i < 3; i++) drop((i - 1) * 12, 34 + (i % 2) * 10, 0.45, blowhole);
  }
}

const oceanMode = defineFunMode({
  id: 'ocean',
  label: 'Ocean',
  blurb: 'Fish and bubbles, blub~',
  favicon: OCEAN_FAVICON,
  announce: { on: 'Ocean mode on. Blub blub~', off: 'Ocean mode off' },
  layerId: 'ocean-sea',
  zapSelector: '.ocean-bubble',
  zapCap: OCEAN_BUBBLE_CAP,
  buildLayer: oceanSeaLayer,
  onPaint: oceanScenery,
  burst: oceanBubbles,
  trail: oceanTrailBubble,
  typing: oceanTyping,
});

export const OCEAN_STORAGE_KEY = oceanMode.storageKey;
export const oceanIsOn = oceanMode.isOn;
export const paintOcean = oceanMode.paint;
export const setOcean = oceanMode.set;
export const toggleOcean = oceanMode.toggle;
export const leaveOcean = oceanMode.leave;
export function activate(ctx) {
  document.addEventListener('pointermove', oceanPointerAt, { passive: true, signal: ctx?.signal });
  // The window's edge, a lifted finger, or a press the browser took over.
  for (const gone of ['pointerleave', 'pointercancel']) {
    document.documentElement.addEventListener(gone, oceanPointerGone, { signal: ctx?.signal });
  }
  return oceanMode.activate(ctx);
}
