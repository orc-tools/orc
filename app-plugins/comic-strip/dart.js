// The paper dart that the glider on the flight path (frontend.js) and the
// send-off scenes (scene.js) both draw. Its nose is at (1, 0), one unit out,
// and it is seen from just under the wings: both wing undersides rise above
// the centre crease and the folded keel hangs below it. Draw the folds in
// order, then the creases, then ink every fold's outline.

export const DART_INK = '#192632';

export const DART_FOLDS = [
  // The far wing's underside, in shade.
  { points: [[1, 0], [-.7, 0], [-.84, -.5]], fill: '#dcc79c' },
  // The near wing, nearer and larger, catching the light.
  { points: [[1, 0], [-.7, 0], [-.98, -.3]], fill: '#fff8e7' },
  // The keel, folded down under the crease.
  { points: [[1, 0], [-.7, 0], [-.6, .21]], fill: '#e7d1a7' },
];

// The fold lines pressed into the near wing and the keel.
export const DART_CREASES = [
  [[1, 0], [-.86, -.14]],
  [[1, 0], [-.64, .1]],
];
