// Grand Theft Orc's new-run scene. The stylesheet also supplies the still
// painting used by the Themes card and the installer preview.

import { defineFunMode } from '/js/fun-modes.js';

const SCENE_ID = 'grand-theft-orc-scene';
// The paintings are 1536 by 512. Places inside them are given in their pixels
// and laid as shares of the painting, so they hold at any width.
const ART_W = 1536;
const ART_H = 512;
// Open night sky between the clouds and clear of the palms, the motel and its
// tower: docs/grand-theft-orc-art/layers.mjs cuts the same sky as motel-night-sky.webp.
const SKY_STARS = [
  [663, 108], [439, 79], [492, 93], [457, 231], [211, 218], [384, 165], [643, 189], [740, 146], [508, 273],
  [368, 248], [241, 201], [700, 108], [642, 157], [1011, 85], [446, 266], [588, 103], [340, 184], [280, 279],
  [309, 91], [360, 108], [538, 142], [8, 107], [257, 246], [820, 85], [390, 87], [427, 182], [425, 227],
  [638, 91], [1057, 75], [740, 107], [534, 202], [399, 276], [464, 121], [572, 190],
];
// The pane above the painting, where the composer and the notes leave it open:
// the margin either side of the composer, as shares of the pane, and a strip
// along the top, which is a fixed depth because the heading under it is.
const OPEN_SKY = [
  { count: 9, x: [1, 17], y: [2, 35], unit: '%' },
  { count: 9, x: [83, 99], y: [2, 35], unit: '%' },
  { count: 8, x: [19, 81], y: [12, 64], unit: 'px' },
];
// Sunlight on the sea, between the palms and the beach.
const SEA_SPARKLES = [
  [445, 385], [458, 381], [299, 385], [433, 388], [253, 383], [474, 381], [465, 392], [165, 379], [285, 389],
  [265, 388], [151, 383], [491, 376], [423, 379], [446, 397], [503, 379], [530, 377], [517, 376], [317, 382],
  [404, 384], [224, 379], [550, 379], [276, 381], [254, 395], [416, 390], [239, 383], [513, 388],
];
// The coupe's chrome: where each glint flares, how large, how often and when.
const GLINTS = [
  { at: [1304, 373], '--s': '1', '--dur': '11s', '--delay': '0s' },
  { at: [1192, 404], '--s': '.55', '--dur': '14s', '--delay': '-6s' },
];
// Raindrops land in the pink, amber and turquoise pools on the night road.
const PUDDLES = [
  { at: [382, 480], tint: '#ffc2ac' }, { at: [760, 499], tint: '#f4ae96' },
  { at: [970, 471], tint: '#ffc486' }, { at: [1077, 485], tint: '#91e7e1' },
  { at: [1245, 497], tint: '#ffa2cc' },
];
// The night's lights, back to front, each a layer theme.css pictures and moves.
const NIGHT_LIGHTS = ['skyline-a', 'skyline-b', 'windows', 'window-out', 'pink', 'cyan', 'tube-out', 'wet'];

const share = (value, of) => (value / of * 100).toFixed(2) + '%';
const inArt = ([x, y]) => ({ '--x': share(x, ART_W), '--y': share(y, ART_H) });
// Strides of the index rather than Math.random, so every window and every
// capture shows the same sky.
const stride = (i, step, span) => (i * step) % span;

function star(i, place, sizes) {
  return {
    ...place,
    '--size': sizes[stride(i, 7, sizes.length)] + 'px',
    '--rest': (.45 + stride(i, 37, 50) / 100).toFixed(2),
    '--dur': (1.6 + stride(i, 13, 27) / 10).toFixed(1) + 's',
    '--delay': '-' + (stride(i, 29, 40) / 10).toFixed(1) + 's',
  };
}

function openSkyStars(piece) {
  const stars = [];
  for (const { count, x, y, unit } of OPEN_SKY) {
    for (let n = 0; n < count; n++) {
      const i = stars.length;
      stars.push(piece('grand-theft-orc-star', star(i, {
        '--x': (x[0] + stride(i * 5 + 3, 31, 100) / 100 * (x[1] - x[0])).toFixed(1) + '%',
        '--y': (y[0] + stride(i * 3 + 1, 43, 100) / 100 * (y[1] - y[0])).toFixed(1) + unit,
      }, [1.3, 1.5, 1.8])));
    }
  }
  return stars;
}

function sparkle(at, i, piece) {
  return piece('grand-theft-orc-spark', {
    ...inArt(at),
    '--size': [1.6, 2, 2.6][stride(i, 5, 3)] + 'px',
    '--rest': String([.15, .5, .9, 1][stride(i, 3, 4)]),
    '--dur': (.7 + stride(i, 11, 16) / 10).toFixed(1) + 's',
    '--delay': '-' + (stride(i, 17, 30) / 10).toFixed(1) + 's',
  });
}

function group(piece, className, ...children) {
  const node = piece(className);
  node.append(...children);
  return node;
}

function grandTheftOrcScene({ piece }) {
  const scene = document.createElement('div');
  scene.id = SCENE_ID;
  scene.setAttribute('aria-hidden', 'true');
  const clouds = () => group(piece, 'grand-theft-orc-sky grand-theft-orc-clouds', piece('grand-theft-orc-bank'));
  const shower = group(piece, 'grand-theft-orc-shower', piece('grand-theft-orc-rain'),
    ...PUDDLES.map(({ at, tint }, i) => piece('grand-theft-orc-ripple', {
      ...inArt(at), '--grand-theft-orc-tint': tint, '--dur': (2.2 + i * .29).toFixed(2) + 's', '--delay': (-i * .83).toFixed(2) + 's',
    })));
  const night = group(piece, 'grand-theft-orc-night',
    clouds(),
    group(piece, 'grand-theft-orc-sky', piece('grand-theft-orc-glow'),
      group(piece, 'grand-theft-orc-plane', piece('grand-theft-orc-plane-white'), piece('grand-theft-orc-plane-red'))),
    ...SKY_STARS.map((at, i) => piece('grand-theft-orc-star', star(i, inArt(at), [1.4, 1.6, 2, 2.4]))),
    ...NIGHT_LIGHTS.map(name => piece('grand-theft-orc-light grand-theft-orc-' + name)), shower);
  const day = group(piece, 'grand-theft-orc-day',
    clouds(),
    ...SEA_SPARKLES.map((at, i) => sparkle(at, i, piece)),
    ...GLINTS.map(({ at, ...flare }) => piece('grand-theft-orc-glint', { ...inArt(at), ...flare })));
  scene.append(
    group(piece, 'grand-theft-orc-night grand-theft-orc-open-sky', ...openSkyStars(piece)),
    group(piece, 'grand-theft-orc-motel', group(piece, 'grand-theft-orc-art', night, day, piece('grand-theft-orc-coupe'))));
  return scene;
}

const grandTheftOrcMode = defineFunMode({
  id: 'grand-theft-orc',
  homeLayerId: SCENE_ID,
  buildHomeLayer: grandTheftOrcScene,
});

export const GRAND_THEFT_ORC_STORAGE_KEY = grandTheftOrcMode.storageKey;
export const grandTheftOrcIsOn = grandTheftOrcMode.isOn;
export const paintGrandTheftOrc = grandTheftOrcMode.paint;
export const setGrandTheftOrc = grandTheftOrcMode.set;
export const toggleGrandTheftOrc = grandTheftOrcMode.toggle;
export const leaveGrandTheftOrc = grandTheftOrcMode.leave;
export function activate(ctx) {
  return grandTheftOrcMode.activate(ctx);
}
