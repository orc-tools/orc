// The send-off scenes' timing, with no page or theme in it, so anything that
// plays a scene shares one choreography.
export function sceneRange(time, from, to) { return Math.max(0, Math.min(1, (time - from) / (to - from))); }
export function sceneEase(t) { return t * t * (3 - 2 * t); }

const TORN = [0, 4, -3, 6, -5, 3, -6, 5, -2, 4, -4, 0];
const STRAIGHT = [0, 0];

// Each scene's pose(time) is the whole choreography: play() in the send-offs
// plugin lays it out in the DOM, recordScene() paints
// the same pose onto a canvas, and the landing page (site/) plays it inside a
// window. Paper translate is a
// percentage of the paper's box, as in CSS.
export const SCENES = {
  yeet: {
    name: 'yeet', label: 'Yeet animation', seam: TORN, length: 4.95,
    lands: 3.32,
    pose(time) {
      const open = sceneEase(sceneRange(time, .15, 1.25));
      const gather = sceneEase(sceneRange(time, 1.85, 2.55));
      const reveal = sceneEase(sceneRange(time, .08, 1.1));
      return {
        papers: [-1, 1].map(side => ({
          x: side * open * (1 - gather) * 35 + gather * 17, y: gather * -5,
          rotate: side * open * (1 - gather) * 13 + gather * 38, scale: 1 - gather * .94,
          opacity: 1 - sceneRange(time, 2.35, 2.65),
        })),
        reveal: reveal < 1 ? [42 * (1 - reveal), 49 * (1 - reveal)] : null,
        zoom: 1,
        word: {
          opacity: sceneRange(time, 3.32, 3.48) * (1 - sceneRange(time, 4.15, 4.55)),
          rotate: -7, y: 0, scale: .87 + .13 * sceneEase(sceneRange(time, 3.32, 3.65)),
        },
        flash: 0,
        layer: 1 - sceneRange(time, 4.55, 4.95),
      };
    },
  },
  pr: {
    name: 'pr', label: 'PR opened animation', seam: STRAIGHT, length: 5.1,
    lands: 3.05,
    pose(time) {
      const doors = sceneEase(sceneRange(time, .1, .95)) - sceneEase(sceneRange(time, 3.95, 4.5));
      const pop = sceneEase(sceneRange(time, 3.05, 3.35));
      return {
        papers: doorPapers(doors),
        reveal: doors < 1 ? [0, 50 * (1 - doors)] : null,
        zoom: 1,
        word: { opacity: sceneRange(time, 3.05, 3.2) * (1 - sceneRange(time, 4.2, 4.5)), rotate: -4, y: (1 - pop) * 30, scale: .8 + .2 * pop },
        flash: Math.sin(sceneRange(time, 4.42, 4.8) * Math.PI),
        layer: 1 - sceneRange(time, 4.7, 5.1),
      };
    },
  },
  plan: {
    name: 'plan', label: 'Plan reveal animation', seam: STRAIGHT, length: 5,
    lands: 2.55,
    pose(time) {
      const doors = sceneEase(sceneRange(time, .1, .9));
      const pop = sceneEase(sceneRange(time, 2.55, 2.85));
      return {
        papers: doorPapers(doors),
        reveal: doors < 1 ? [0, 50 * (1 - doors)] : null,
        // The scroll ends its flight centred in view. Pushing in on it while the
        // scene dissolves lands on the plan, which is already loaded behind it.
        zoom: 1 + 1.6 * sceneRange(time, 3.8, 5) ** 2,
        word: { opacity: sceneRange(time, 2.55, 2.68) * (1 - sceneRange(time, 3.55, 3.85)), rotate: -4, y: (1 - pop) * 30, scale: .8 + .2 * pop },
        flash: 0,
        layer: 1 - sceneEase(sceneRange(time, 3.9, 4.75)),
      };
    },
  },
  // The doors stay open: the scene fades over the page the settle left behind.
  clear: {
    name: 'clear', label: 'All settled animation', seam: STRAIGHT, length: 5.6,
    lands: 1.45,
    pose(time) {
      const doors = sceneEase(sceneRange(time, .1, .9));
      const pop = sceneEase(sceneRange(time, 1.45, 1.75));
      return {
        papers: doorPapers(doors),
        reveal: doors < 1 ? [0, 50 * (1 - doors)] : null,
        zoom: 1,
        word: { opacity: sceneRange(time, 1.45, 1.6) * (1 - sceneRange(time, 4.3, 4.7)), rotate: -4, y: (1 - pop) * 30, scale: .8 + .2 * pop },
        flash: 0,
        layer: 1 - sceneEase(sceneRange(time, 4.9, 5.6)),
      };
    },
  },
};

function doorPapers(doors) {
  return [-1, 1].map(side => ({ x: side * doors * 51, y: 0, rotate: 0, scale: 1, opacity: 1 }));
}

// One paper's outline as [x%, y%] points of its own box: the left half up to
// the seam, or the right half from it.
export function seamOutline(seam, side) {
  const points = seam.map((x, i) => [50 + x, i / (seam.length - 1) * 100]);
  return side < 0 ? [[0, 0], ...points, [0, 100]] : [[100, 0], [100, 100], ...points.reverse()];
}
