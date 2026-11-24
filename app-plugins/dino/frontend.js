// Dino mode. data-dino on <html> is the whole switch: theme.css repaints the
// shell and the artifact pages from it, and this module adds the parts CSS
// cannot: the valley under the page, the track a click stamps over it, the
// trail of tracks a held press walks and what typing shakes loose.
// The valley (#dino-jungle) lies below the page's content and the tracks
// (#dino-tracks) land on top of it, so they are two layers.

import { defineFunMode } from '/js/fun-modes.js';

const DINO_JUNGLE_ID = 'dino-jungle';
// The stars are the motes' two drawings at other sizes, so no star sits where
// an ember starts.
const DINO_STARS = [
  { kind: 'specks dino-night', '--tile': '560px', '--dur': '5.2s', '--delay': '-1.4s' },
  { kind: 'dust dino-night', '--tile': '410px', '--dur': '7.4s', '--delay': '-4.2s' },
];
// Where each meteor starts its fall, --y below the run's header, and how long
// it stays away between falls. The waits share no factor, so two rarely fall
// together.
const DINO_METEORS = [
  { '--x': '74%', '--y': '4vh', '--size': '120px', '--dur': '17s', '--delay': '-4.6s' },
  { '--x': '96%', '--y': '11vh', '--size': '86px', '--dur': '23s', '--delay': '-15.2s' },
  { '--x': '58%', '--y': '7vh', '--size': '104px', '--dur': '29s', '--delay': '-21.9s' },
];
// --y is how far a line of hills stands above the window's foot, and --shift
// slides the nearer line so its crests do not stand under the far line's.
const DINO_HILLS = [
  { '--y': '104px', '--h': '112px', '--alpha': '.7' },
  { '--y': '62px', '--h': '94px', '--shift': '-310px' },
];
// Each bank of mist lies on the window's foot, so neither shows an edge.
const DINO_MISTS = [{ '--h': '260px' }, { '--h': '118px' }];
// A long-neck takes --dur to walk the valley and --pace to swing a leg once,
// so the young one steps faster on its shorter legs. Their delays put both in
// the open when the page loads, walking towards each other.
const DINO_LONGNECKS = [
  { '--x': '21vw', '--w': '236px', '--dur': '137s', '--pace': '1.1s', '--delay': '-31s' },
  { '--x': '47vw', '--w': '124px', '--dir': '-1', '--dur': '119s', '--pace': '0.55s', '--delay': '-25s' },
];
const DINO_LEGS = ['fore dino-far', 'hind dino-far', 'fore', 'hind'];
// --lane runs from just under the run's header (0) to just over the trees
// (1). --x is where a flier or a long-neck rests when motion is off.
const DINO_FLIERS = [
  { kind: 'day', '--w': '104px', '--lane': '.08', '--dir': '1', '--dur': '58s', '--delay': '-27.5s', '--x': '72vw' },
  { kind: 'day', '--w': '64px', '--lane': '.36', '--dir': '-1', '--dur': '83s', '--delay': '-47.2s', '--x': '26vw', '--alpha': '.55' },
  { kind: 'day', '--w': '46px', '--lane': '.2', '--dir': '1', '--dur': '97s', '--delay': '-70.3s', '--x': '88vw', '--alpha': '.4' },
  { kind: 'night', '--w': '86px', '--lane': '.72', '--dir': '-1', '--dur': '71s', '--delay': '-33.8s', '--x': '80vw' },
];
// Each tile drifts by its own height, so the nearer specks pass the far dust.
const DINO_MOTES = [
  { kind: 'specks', '--tile': '480px', '--dur': '95s' },
  { kind: 'dust', '--tile': '340px', '--dur': '140s' },
];
// --roam is how far a dragonfly darts from where it was put.
const DINO_DRAGONFLIES = [
  { '--x': '92px', '--y': '57vh', '--w': '30px', '--roam': '34px', '--dur': '13s', '--delay': '-4.2s' },
  { '--x': 'calc(100% - 122px)', '--y': '50vh', '--w': '26px', '--roam': '-30px', '--dir': '-1', '--dur': '17s', '--delay': '-11.7s' },
  { '--x': '60%', '--y': '77vh', '--w': '24px', '--roam': '28px', '--dur': '11s', '--delay': '-8.3s' },
];
// Most embers keep to the two sides of the page, where a transcript leaves the
// valley open. The last three are for project home, which is open all the way
// across. --y is where each rests when motion is off.
const DINO_EMBER_SPOTS = [
  ['40px', '62vh'], ['calc(100% - 52px)', '48vh'], ['118px', '80vh'],
  ['calc(100% - 128px)', '72vh'], ['76px', '44vh'], ['calc(100% - 88px)', '86vh'],
  ['44%', '74vh'], ['63%', '88vh'], ['78%', '66vh'],
];
// The valley's layer starts at the sidebar's edge, so a plain --x is measured
// from there. The tree ferns: one at that edge, where a transcript leaves the
// valley open, and a smaller one across project home.
const DINO_TREEFERNS = [
  { '--x': '-4px', '--w': '250px', '--h': '452px', '--dur': '7.4s', '--delay': '-2.6s' },
  { '--x': 'calc(100% - 452px)', '--w': '168px', '--h': '292px', '--dur': '6.2s', '--delay': '-4.9s' },
];
const DINO_CYCADS = [
  { '--x': 'calc(100% - 218px)', '--w': '176px' },
];
const DINO_HORSETAILS = [
  { '--x': '178px', '--w': '56px', '--dur': '5.6s', '--delay': '-1.8s' },
  { '--x': 'calc(100% - 66px)', '--w': '66px', '--dur': '6.4s', '--delay': '-3.9s' },
];
const DINO_FERNS = [
  { '--x': '14px', '--w': '150px', '--dur': '6.4s', '--delay': '-1.2s' },
  { '--x': '122px', '--w': '104px', '--dur': '7.6s', '--delay': '-3.4s' },
  { '--x': 'calc(100% - 336px)', '--w': '122px', '--dur': '7s', '--delay': '-4.6s' },
  { '--x': 'calc(100% - 118px)', '--w': '138px', '--dur': '6.1s', '--delay': '-0.7s' },
];
const DINO_PEBBLE_COUNT = 5;
const DINO_TINTS = ['var(--muted)', 'var(--dino-lava)', 'var(--border)', 'var(--dino-ember)', 'var(--accent)'];
const DINO_WORDS = ['RAWR!', 'stomp', 'rawr~', 'CHOMP', 'thud', 'RAWR~'];
// A burst is the track, a ring of dust, the pebbles and a word. Each piece
// removes itself when its animation ends, which never happens while
// animations are suppressed (forced colours, print), so cap the pile. A
// steady held trail stays under it: see whileFunPress in fun-modes.js.
const DINO_BURST_SIZE = DINO_PEBBLE_COUNT + 3;
const DINO_BURST_CAP = DINO_BURST_SIZE * 6;
const DINO_ROARS = ['RAWR!', 'so fast!', 'RAWR~', 'stomp stomp!'];
// The orc looking out of a tyrannosaur's open jaws, back plates on its crown.
const DINO_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<path d='M17 14 21 3l6 9zM29 11l4-9 5 9zM41 13l6-9 2 11z' fill='#f0803c' stroke='#23160f' stroke-width='2.4' stroke-linejoin='round'/>"
  + "<path d='M32 9C15 9 4 21 4 37c0 14 12 24 28 24s28-10 28-24C60 21 49 9 32 9z' fill='#6cbf43' stroke='#23160f' stroke-width='3' stroke-linejoin='round'/>"
  + "<circle cx='17' cy='21' r='3.4' fill='#fffbea' stroke='#23160f' stroke-width='1.8'/><circle cx='47' cy='21' r='3.4' fill='#fffbea' stroke='#23160f' stroke-width='1.8'/>"
  + "<circle cx='17.6' cy='21.4' r='1.4' fill='#23160f'/><circle cx='46.4' cy='21.4' r='1.4' fill='#23160f'/>"
  + "<circle cx='32' cy='41' r='17' fill='#23160f'/>"
  + "<path d='M17.5 33l3.5 6 3.2-7.6 3.6 6.4 4.2-7 4.2 7 3.6-6.4 3.2 7.6 3.5-6' fill='#fffbea' stroke='#23160f' stroke-width='1.4' stroke-linejoin='round'/>"
  + "<circle cx='32' cy='44' r='11.5' fill='#83c851' stroke='#182f10' stroke-width='2'/>"
  + "<circle cx='27.6' cy='42' r='1.8' fill='#182f10'/><circle cx='36.4' cy='42' r='1.8' fill='#182f10'/>"
  + "<path d='M27.6 50l1.4-4 1.4 4zM33.6 50l1.4-4 1.4 4z' fill='#fff8ec' stroke='#182f10' stroke-width='1'/>"
  + '</svg>',
);
let dinoWordTurn = 0;
let dinoStepTurn = 0;
// Where the last track of a held press went, and which way it pointed.
let dinoLastStep = null;

// Fixed places rather than Math.random, so every toggle and every screenshot
// draws the same valley. Later pieces paint over earlier ones: the sky and
// the volcano first, then the hills, the trees and the mist between them,
// what moves in the valley, and last what stands along its near edge.
function dinoJungleLayer({ piece }) {
  const jungle = document.createElement('div');
  jungle.id = DINO_JUNGLE_ID;
  jungle.setAttribute('aria-hidden', 'true');
  const add = (kind, place) => {
    const { kind: more = '', ...props } = place;
    const node = piece(('dino-piece dino-' + kind + ' ' + (more && 'dino-' + more)).trim(), props);
    jungle.append(node);
    return node;
  };
  DINO_STARS.forEach(place => add('stars', place));
  DINO_METEORS.forEach(place => add('meteor', { ...place, kind: 'night' }));
  add('volcano', {});
  add('plume', {});
  add('hills', DINO_HILLS[0]);
  add('mist', DINO_MISTS[0]);
  add('hills', DINO_HILLS[1]);
  add('treeline', {});
  add('mist', DINO_MISTS[1]);
  DINO_LONGNECKS.forEach(place => {
    const beast = add('longneck', place);
    DINO_LEGS.forEach(leg => beast.append(piece('dino-leg dino-' + leg)));
  });
  DINO_FLIERS.forEach(place => add('flier', place));
  DINO_MOTES.forEach(place => add('motes', place));
  DINO_EMBER_SPOTS.forEach(([x, y], i) => add('ember', {
    kind: 'night',
    '--x': x,
    '--y': y,
    '--size': 3 + (i * 3) % 4 + 'px',
    '--dur': 9 + (i * 7) % 10 + 's',
    '--delay': '-' + ((0.6 + i * 2.3) % 17).toFixed(1) + 's',
    '--drift': ((i % 5) - 2) * 22 + 'px',
  }));
  DINO_DRAGONFLIES.forEach(place => add('dragonfly', { ...place, kind: 'day' }));
  DINO_TREEFERNS.forEach(place => add('treefern', place));
  DINO_CYCADS.forEach(place => add('cycad', place));
  DINO_HORSETAILS.forEach(place => add('horsetail', place));
  DINO_FERNS.forEach(place => add('fern', place));
  add('nest', { '--x': '262px' });
  add('floor', {});
  add('runner', {});
  return jungle;
}

function dinoTracksLayer() {
  const tracks = document.createElement('div');
  tracks.id = 'dino-tracks';
  tracks.setAttribute('aria-hidden', 'true');
  return tracks;
}

function dinoScenery(on, _announce, helpers) {
  const jungle = document.getElementById(DINO_JUNGLE_ID);
  if (on && !jungle) document.body.append(dinoJungleLayer(helpers));
  if (!on && jungle) jungle.remove();
}

// A click stamps one track where the pointer landed, in a ring of dust, and
// kicks pebbles out of it.
function dinoBurst(x, y, { zap, layerWithRoom }) {
  dinoLastStep = { x, y, turn: 0 };
  const tracks = layerWithRoom(DINO_BURST_SIZE);
  if (!tracks) return;
  const at = { '--px': x + 'px', '--py': y + 'px' };
  const word = dinoWordTurn++;
  tracks.append(zap('dino-burst dino-puff', at));
  // Left foot, then right: each click's track toes out the other way.
  tracks.append(zap('dino-burst dino-stomp', { ...at, '--turn': (word % 2 ? 16 : -16) + 'deg', '--tint': DINO_TINTS[(word * 2) % DINO_TINTS.length] }));
  for (let i = 0; i < DINO_PEBBLE_COUNT; i++) {
    // Kicked up and out in a fan, then left to drop.
    const angle = (-160 + i * 35) * Math.PI / 180;
    const reach = 38 + (i % 2) * 16;
    tracks.append(zap('dino-burst dino-pebble', {
      ...at,
      '--dx': Math.round(Math.cos(angle) * reach) + 'px',
      '--dy': Math.round(Math.sin(angle) * reach) + 'px',
      '--spin': (i % 2 ? 1 : -1) * (160 + i * 40) + 'deg',
      '--tint': DINO_TINTS[i % DINO_TINTS.length],
    }));
  }
  tracks.append(zap('dino-burst dino-word', DINO_WORDS[word % DINO_WORDS.length], at));
}

// One small track for a held press's trail. Its toes point the way the
// pointer is going and it falls left then right of that line, so a drag
// leaves a walked trail. A press held still treads on the spot, facing the
// way it last went.
function dinoTrailStep(x, y, { zap, layerWithRoom }) {
  const last = dinoLastStep || { x, y, turn: 0 };
  const moved = Math.hypot(x - last.x, y - last.y) >= 1;
  const turn = moved ? Math.round(Math.atan2(x - last.x, last.y - y) * 180 / Math.PI) : last.turn;
  dinoLastStep = { x, y, turn };
  const tracks = layerWithRoom(1);
  if (!tracks) return;
  const step = dinoStepTurn++;
  tracks.append(zap('dino-burst dino-stomp dino-trail', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--turn': turn + 'deg',
    '--side': step % 2 ? '1' : '-1',
    '--tint': DINO_TINTS[(step * 2) % DINO_TINTS.length],
  }));
}

// Strides of the streak rather than Math.random, as with the valley, so a
// capture of the same typing comes out the same.
function dinoTyping({ kind, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  if (kind === 'char') {
    spawn('dino-typed dino-typed-chip', '', {
      '--dx': side * (6 + (streak % 4) * 4) + 'px', '--spin': side * (120 + (streak % 3) * 70) + 'deg',
      '--tint': DINO_TINTS[streak % DINO_TINTS.length],
    });
    if (streak % 2 === 0) spawn('dino-typed dino-typed-print', '', { '--tilt': side * 16 + 'deg' });
  } else if (kind === 'space') {
    spawn('dino-typed dino-typed-leaf', '', { '--dx': side * 10 + 'px' });
  } else if (kind === 'delete') {
    spawn('dino-typed dino-typed-bone', '', { '--dx': side * 8 + 'px', '--spin': side * 60 + 'deg' });
  } else if (kind === 'paste') {
    // An eruption: embers thrown up and out over the caret.
    for (let i = 0; i < 6; i++) {
      const angle = (-160 + i * 28) * Math.PI / 180;
      spawn('dino-typed dino-typed-ember', '', {
        '--dx': Math.round(Math.cos(angle) * 50) + 'px', '--dy': Math.round(Math.sin(angle) * 50) + 'px',
        '--tint': i % 2 ? 'var(--dino-lava)' : 'var(--dino-ember)', '--delay': (i * 0.04).toFixed(2) + 's',
      });
    }
  }
  if (streak % 20 === 0) {
    const x = fieldRect.right - 36;
    spawn('dino-typed dino-typed-rex', '', { '--x': x + 'px', '--y': fieldRect.top + 'px' });
    spawn('dino-typed dino-typed-roar', DINO_ROARS[(streak / 20) % DINO_ROARS.length], {
      '--x': x - 22 + 'px', '--y': fieldRect.top - 4 + 'px',
    });
  }
}

const dinoMode = defineFunMode({
  id: 'dino',
  label: 'Dino',
  blurb: 'Dinosaurs and volcanoes, rawr~',
  favicon: DINO_FAVICON,
  announce: { on: 'Dino mode on. Rawr~', off: 'Dino mode off' },
  layerId: 'dino-tracks',
  zapSelector: '.dino-burst',
  zapCap: DINO_BURST_CAP,
  buildLayer: dinoTracksLayer,
  onPaint: dinoScenery,
  burst: dinoBurst,
  trail: dinoTrailStep,
  typing: dinoTyping,
});

export const DINO_STORAGE_KEY = dinoMode.storageKey;
export const dinoIsOn = dinoMode.isOn;
export const paintDino = dinoMode.paint;
export const setDino = dinoMode.set;
export const toggleDino = dinoMode.toggle;
export const leaveDino = dinoMode.leave;
export function activate(ctx) {
  return dinoMode.activate(ctx);
}
