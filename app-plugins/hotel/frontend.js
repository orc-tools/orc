// Hotel mode. data-hotel on <html> is the whole switch: theme.css repaints
// the shell and the artifact pages from it, and this module adds the parts CSS
// cannot: the layer a click's tile flashes on, the steps a held press leaves,
// the typing effects and the favicon.

import { defineFunMode } from '/js/fun-modes.js';

// The four ways across the floor: a tile's edges run two pixels across for
// each one down, so a pixel thrown along one travels the same.
const HOTEL_WAYS = [[2, 1], [-2, 1], [-2, -1], [2, -1]];
const HOTEL_REACH = 13;
const HOTEL_SPARK_CAP = 48;
// The bellhop: the orc's head under a red cap with a brass band, drawn on a
// 16 by 16 grid on the hotel's blue.
const HOTEL_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' shape-rendering='crispEdges'>"
  + "<rect x='2' y='2' width='60' height='60' rx='10' fill='#1f78ad' stroke='#10202b' stroke-width='4' shape-rendering='auto'/>"
  + "<rect x='20' y='8' width='24' height='4' fill='#10202b'/><rect x='16' y='12' width='32' height='8' fill='#c8283c'/>"
  + "<rect x='16' y='20' width='32' height='4' fill='#ffcc33'/><rect x='12' y='24' width='40' height='28' fill='#83c851'/>"
  + "<rect x='8' y='28' width='4' height='8' fill='#4f8a2b'/><rect x='52' y='28' width='4' height='8' fill='#4f8a2b'/>"
  + "<rect x='20' y='32' width='8' height='8' fill='#182f10'/><rect x='36' y='32' width='8' height='8' fill='#182f10'/>"
  + "<rect x='20' y='44' width='4' height='8' fill='#fff8ec'/><rect x='40' y='44' width='4' height='8' fill='#fff8ec'/>"
  + "<rect x='24' y='48' width='16' height='4' fill='#3d6f22'/>"
  + '</svg>',
);
let hotelStepTurn = 0;

// The floor is theme.css's, painted behind the chrome. This layer starts
// empty and holds only what a press throws.
function hotelFxLayer() {
  const layer = document.createElement('div');
  layer.id = 'hotel-fx';
  layer.setAttribute('aria-hidden', 'true');
  return layer;
}

// A click walks to a tile: its outline flashes where the pointer landed, a
// pixel jumps off along each of the floor's four ways and a coin pops up.
function hotelWalk(x, y, { zap, layerWithRoom }) {
  const layer = layerWithRoom(HOTEL_WAYS.length + 2);
  if (!layer) return;
  const at = { '--px': x + 'px', '--py': y + 'px' };
  layer.append(zap('hotel-spark hotel-tile', at));
  HOTEL_WAYS.forEach(([across, down], i) => {
    layer.append(zap('hotel-spark', {
      ...at,
      '--dx': across * HOTEL_REACH + 'px',
      '--dy': down * HOTEL_REACH + 'px',
      '--delay': (i % 2 * 0.04).toFixed(2) + 's',
    }));
  });
  layer.append(zap('hotel-spark hotel-coin', at));
}

// A held press leaves the steps of a walk: small tiles, brass and blue by
// turns rather than by Math.random, so every run looks the same.
function hotelStep(x, y, { zap, layerWithRoom }) {
  const layer = layerWithRoom(1);
  if (!layer) return;
  const blue = hotelStepTurn++ % 2 === 1;
  layer.append(zap('hotel-spark hotel-step' + (blue ? ' hotel-step-blue' : ''), { '--px': x + 'px', '--py': y + 'px' }));
}

const HOTEL_TYPED_CALLS = ['room service!', 'late checkout?', 'do not disturb', 'fresh towels!'];

// Strides of the streak rather than Math.random, so a capture of the same
// typing comes out the same. Each key knocks a pixel off the caret, a space
// lays a tile, and a long run gets a guest talking.
function hotelTyping({ kind, streak, fieldRect, spawn }) {
  const side = streak % 2 ? 1 : -1;
  const pixel = (dx, dy, delay, gold) => spawn('hotel-typed hotel-typed-pixel' + (gold ? ' hotel-typed-gold' : ''), '', {
    '--dx': dx + 'px', '--dy': dy + 'px', '--delay': delay + 's',
  });
  if (kind === 'char') {
    pixel(side * (4 + (streak * 5) % 10), -10 - (streak * 3) % 10, 0, false);
    if (streak > 12) pixel(-side * (4 + (streak * 7) % 10), -14 - (streak * 5) % 10, 0.03, true);
  } else if (kind === 'space') {
    spawn('hotel-typed hotel-typed-tile', '', { '--dx': side * 6 + 'px' });
  } else if (kind === 'delete') {
    spawn('hotel-typed hotel-typed-out', '');
  } else if (kind === 'paste') {
    for (let i = 0; i < 6; i++) pixel((i - 2.5) * 10, -12 - (2.5 - Math.abs(i - 2.5)) * 8, Math.abs(i - 2.5) * 0.03, i % 2 === 1);
  }
  // The bubble rises over the field's right-hand corner, wherever the caret
  // is: project home's heading is centred above the field, and a bubble at
  // the caret would cover it.
  if (streak % 20 === 0) {
    const call = streak % 100 === 0 ? 'five stars!' : HOTEL_TYPED_CALLS[(streak / 20) % HOTEL_TYPED_CALLS.length];
    spawn('hotel-typed hotel-typed-say', call, { '--x': fieldRect.right - 140 + 'px', '--y': fieldRect.top - 8 + 'px' });
  }
}

const hotelMode = defineFunMode({
  id: 'hotel',
  label: 'Hotel',
  blurb: 'Your room is ready~',
  favicon: HOTEL_FAVICON,
  announce: { on: 'Hotel mode on. Your room is ready~', off: 'Hotel mode off' },
  layerId: 'hotel-fx',
  zapSelector: '.hotel-spark',
  zapCap: HOTEL_SPARK_CAP,
  buildLayer: hotelFxLayer,
  burst: hotelWalk,
  trail: hotelStep,
  typing: hotelTyping,
});

export const HOTEL_STORAGE_KEY = hotelMode.storageKey;
export const hotelIsOn = hotelMode.isOn;
export const paintHotel = hotelMode.paint;
export const setHotel = hotelMode.set;
export const toggleHotel = hotelMode.toggle;
export const leaveHotel = hotelMode.leave;
export function activate(ctx) {
  return hotelMode.activate(ctx);
}
