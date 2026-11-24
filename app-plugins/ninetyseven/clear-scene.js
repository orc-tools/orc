import { BoxGeometry, Vector3 } from 'three';
import { back, clamp, createStage, pulse, range, wobble } from '../../ui/yeet/stage.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createClippy } from './clippy-model.js';
import { balloon, blobShadow, chips, dressStage, fall, keys, notepad, out } from './desktop-set.js';

const SCALE = 1.15;
const HOPS = 2.05;
const REST = 4.3;

// Beats: spring up through the page and land with a squash (0.15-1.0), coil
// (1.15-1.42), spring off the notepad arm high as the pixel shells burst
// (1.45), land (1.95), offer to help with nothing at all while hopping from
// side to side and waving (2.05-4.3), then settle with a waggle of the brows.
const T = {
  rise: [[.15, -4.6], [.62, .7, out], [.9, 0, fall], [1.42, 0], [1.68, .7, out], [1.95, 0, fall]],
  depth: [[.15, -1.4], [.85, 0, out]],
  stretch: [[.15, 1.14], [.62, 1.2], [.9, 1.08], [.99, .68, out], [1.16, 1.1], [1.3, .9], [1.42, .7], [1.52, 1.24, out], [1.9, 1.1], [2, .7, fall], [2.16, 1.1], [2.3, 1]],
  arm: [[1.3, 0], [1.42, .4], [1.56, 3, out], [1.95, 2.7], [2.1, 2.2]],
  lean: [[.15, -.35], [.7, .12], [1.05, 0], [1.42, .2], [1.55, -.2, out], [1.95, 0]],
  brow: [[.15, .9], [1, .9], [1.25, 0], [1.42, -.4], [1.52, 1], [REST, .8], [REST + .2, .4]],
  wide: [[.15, 1.15], [1, 1.15], [1.2, 1], [1.42, .9], [1.52, 1.2], [2.1, 1.1], [REST, 1.1], [REST + .2, 1]],
};

export function createClearScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const backdrop = dressStage(stage);
  const clippy = createClippy();
  clippy.root.scale.setScalar(SCALE);
  const pad = notepad();
  const shadow = blobShadow();
  // Beside him rather than over his head, where the overlay's word is.
  const asks = balloon(['It looks like you’ve', 'settled everything.', '(o) Do nothing', '( ) Do nothing, harder'], .85);
  asks.mesh.position.set(-1.2, 1.9, .6);
  scene.add(pad, shadow, clippy.root, asks.mesh);
  const burst = chips(scene, 38);
  const fireworks = createFireworks(scene, camera, { colors: [0xffff55, 0xff55ff, 0xffffff, 0x55ffff], geometry: new BoxGeometry(1, 1, .3), size: .2, sparks: 32 });
  const feet = new Vector3(0, .4, .5);
  const camY = camera.position.y;

  function render(t) {
    backdrop(t);
    const hop = range(t, HOPS, HOPS + .2) * (1 - range(t, REST - .2, REST));
    const beat = (t - HOPS) * Math.PI * 2.2;
    const side = Math.sin(beat / 2) * hop;
    const air = Math.abs(Math.sin(beat)) * hop;
    clippy.root.position.set(side * .9, keys(t, T.rise) + air * .4, keys(t, T.depth));
    const waggle = Math.sin(t * 20) * (pulse(t, 2.1, 2.6) + range(t, REST + .15, REST + .3)) * .7;
    const brow = keys(t, T.brow);
    clippy.pose({
      arm: keys(t, T.arm) + Math.sin(beat) * .5 * hop,
      curl: Math.sin(beat * 2) * .12 * hop,
      stretch: keys(t, T.stretch) + (air - .5 * hop) * .16 + wobble(t, .99, 22, 7) * .08 + Math.sin(t * 3) * .012,
      sway: -side * .35 + wobble(t, 1.95, 15, 4.5) * .2,
      lean: keys(t, T.lean),
      twist: side * .3,
      look: [side * .5, pulse(t, 1.5, 2) * .7],
      blink: pulse(t, 1, 1.12) + pulse(t, 3.2, 3.32),
      brows: [brow + waggle, brow - waggle],
      wide: keys(t, T.wide),
    });
    pad.position.set(0, -4.2 * (1 - back(range(t, .1, .75), 1.3)), -.45);
    asks.mesh.position.x = -1.2 + clippy.root.position.x;
    asks.show(t, 2.1, 4.45);
    fireworks.update(t);
    if (t > CLEAR_LANDS) burst(t - CLEAR_LANDS, feet, 1);
    else burst(t - .3, feet, 1.5);
    const height = clippy.root.position.y;
    shadow.position.set(clippy.root.position.x, .01, clippy.root.position.z + .1);
    shadow.scale.set(1.5, .8, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    shadow.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height) * .5);
    const flash = fireworks.flash(t);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + flash * 8;
    camera.position.y = camY + Math.sin(t * 75) * (pulse(t, .93, 1.15) + pulse(t, 1.95, 2.15)) * .04;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose };
}
