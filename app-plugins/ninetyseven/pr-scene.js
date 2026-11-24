import {
  DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { createClippy, HEIGHT } from './clippy-model.js';
import {
  balloon, blobShadow, BLUE, canvasTexture, chips, dressStage, fall, FONT, keys, NAVY, notepad, out, wrap,
} from './desktop-set.js';

// The last strike is the overlay's `lands` beat in ui/js/scene-poses.js.
const STRIKES = [1.5, 1.95, 3.05];
const LANDS = STRIKES[2];
const SCALE = 1.15;
const HOME = -1.7;
// He somersaults about his middle, so the carrier holds him by it.
const MIDDLE = HEIGHT * SCALE / 2;
const SHEET = [2.5, 3.3];
// Half the gap between the two sheets' middles, so they overlap by a third.
const APART = .75;
const PAIR = [1.3, 1.95, -.2];
// Where along the pair he clips on: over the overlap, left of its middle so
// the pull request's writing shows beside him.
const SEAM = -.3;
// How far up his wire the sheets' top edge sits once he is clipped on.
const BITE = 1.9 * SCALE;
const CLIPPED = PAIR[1] + SHEET[1] / 2 - BITE + MIDDLE;
// In front of both sheets, with the tucked tongue behind them.
const PROUD = .16;

// Beats: spring up beside the notepad (0.15-1.3) as main drops in and the
// pull request slides up to it (0.55-1.4), tap each sheet square (1.5, 1.95),
// coil (2.12-2.6), somersault over the pair (2.6-2.95) and slide down onto
// their top edge to clip them together (3.05), then wave from up there.
const T = {
  x: [[2.6, HOME], [2.95, PAIR[0] + SEAM]],
  y: [[.15, MIDDLE - 4.6], [.62, MIDDLE + .6, out], [.9, MIDDLE, fall], [2.6, MIDDLE], [2.84, 3.9, out], [2.95, 3.75], [LANDS, CLIPPED, fall]],
  z: [[.15, -1.4], [.85, 0, out], [2.6, 0], [2.95, PAIR[2] + PROUD]],
  spin: [[2.62, 0], [2.96, -Math.PI * 2]],
  stretch: [[.15, 1.14], [.62, 1.2], [.9, 1.08], [.99, .68, out], [1.16, 1.12], [1.32, .95], [1.48, 1], [2.12, 1], [2.5, .6], [2.6, .56], [2.7, 1.3, out], [2.9, 1], [3.02, 1.1], [LANDS, .9], [3.2, 1.05], [3.4, 1]],
  arm: [[1.2, 0], [1.36, .75], [STRIKES[0], 1.4, fall], [1.64, 1], [1.8, .8], [STRIKES[1], 1.45, fall], [2.12, .4], [2.4, 0], [LANDS, 0], [3.4, 1.9, out]],
  lookX: [[.9, .3], [1.1, .8], [2.1, .8], [2.3, 0], [2.6, .6], [LANDS, 0]],
  lookY: [[.5, .9], [1.25, .2], [1.5, 0], [2.3, -.3], [2.6, .7], [2.95, -.6], [3.2, 0]],
  brow: [[.3, .8], [1.2, .5], [1.36, -.2], [1.5, .6], [1.8, -.2], [1.95, .7], [2.15, -.6], [2.6, -.6], [2.75, 1], [LANDS, .2], [3.2, .9]],
  scowl: [[2.1, 0], [2.3, .9], [2.6, 1], [2.75, 0]],
  squint: [[2.1, 0], [2.4, .45], [2.6, .5], [2.7, 0]],
};

// `margin` is where the writing starts, so the pull request's stays clear of
// the clip once he is on.
function sheet(label, colour, title, margin) {
  const texture = canvasTexture(380, 500, ctx => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 380, 500);
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 380, 74);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillText(label, margin, 52);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 24px ${FONT}`;
    const lines = wrap(ctx, title.trim(), 354 - margin, 3);
    lines.forEach((line, i) => ctx.fillText(line, margin, 122 + i * 32));
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 ? '#b8b8b8' : '#8a8a8a';
      ctx.fillRect(margin, 150 + lines.length * 32 + i * 38, (300 - margin) * (.75 + Math.sin(i * 3) * .25), 10);
    }
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 377, 497);
  });
  return new Mesh(new PlaneGeometry(...SHEET), new MeshBasicMaterial({ map: texture, side: DoubleSide, toneMapped: false }));
}

export function createPrScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const backdrop = dressStage(stage);
  const clippy = createClippy();
  clippy.root.scale.setScalar(SCALE);
  clippy.root.position.y = -MIDDLE;
  const carrier = new Group();
  carrier.add(clippy.root);
  const pad = notepad();
  const shadow = blobShadow();
  const asks = balloon(['It looks like you’re', 'opening a pull request.', '(o) Clip it to main'], .3);
  asks.mesh.position.set(HOME + .15, 3.85, .5);

  const pair = new Group();
  const main = sheet('main', NAVY, '', 26);
  const feature = sheet('pull request', BLUE, title, 164);
  pair.add(main, feature);
  const clip = new Vector3(PAIR[0] + SEAM, PAIR[1] + SHEET[1] / 2, PAIR[2] + PROUD);
  const wave = new Mesh(new TorusGeometry(.5, .04, 6, 48), new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
  wave.position.copy(clip);
  scene.add(pad, shadow, carrier, asks.mesh, pair, wave);
  const bursts = STRIKES.map((_, i) => chips(scene, i === 2 ? 30 : 10));

  const at = new Vector3();

  function pose(t) {
    const clipped = t >= LANDS;
    if (clipped !== (carrier.parent === pair)) (clipped ? pair : scene).add(carrier);
    if (clipped) carrier.position.set(SEAM, CLIPPED - PAIR[1], PROUD);
    else carrier.position.set(keys(t, T.x), keys(t, T.y), keys(t, T.z));
    carrier.rotation.z = keys(t, T.spin);
    const lunge = pulse(t, STRIKES[0] - .1, STRIKES[0] + .14) + pulse(t, STRIKES[1] - .1, STRIKES[1] + .14);
    const waggle = Math.sin(t * 20) * pulse(t, 3.3, 3.95) * .7;
    const brow = keys(t, T.brow);
    const waving = smooth(range(t, 3.3, 3.5));
    clippy.pose({
      arm: keys(t, T.arm) + Math.sin(t * 16) * .25 * waving,
      // Shakes with the effort of coiling.
      stretch: keys(t, T.stretch) + wobble(t, .99, 22, 7) * .08 + Math.sin(t * 50) * .02 * pulse(t, 2.25, 2.6),
      sway: lunge * .22 + Math.sin(t * 1.7) * .015,
      tuck: range(t, 2.6, 2.9),
      look: [keys(t, T.lookX), keys(t, T.lookY)],
      blink: keys(t, T.squint) + pulse(t, 1, 1.12) + pulse(t, 3.6, 3.72),
      brows: [brow + waggle, brow - waggle],
      scowl: keys(t, T.scowl),
    });
  }

  const contacts = STRIKES.slice(0, 2).map(strike => {
    pose(strike);
    return clippy.tip(new Vector3());
  });
  contacts.push(clip);

  function render(t) {
    backdrop(t);
    const squared = STRIKES.slice(0, 2).map(strike => smooth(range(t, strike, strike + .07)));
    const hover = Math.sin(t * 2.2) * .05 * (1 - range(t, 2.6, 2.95));
    // The pair sags under him as he lands, then rides it out.
    pair.position.set(PAIR[0], PAIR[1] + hover - Math.abs(wobble(t, LANDS, 16, 5)) * .25, PAIR[2]);
    pair.rotation.z = wobble(t, LANDS, 11, 4) * .05;
    main.position.set(-APART - .3 * (1 - squared[0]), 7 * (1 - back(range(t, .55, 1.25), 1.2)), 0);
    main.rotation.z = .14 * (1 - squared[0]) + wobble(t, STRIKES[0], 18, 6) * .1;
    feature.position.set(APART + mix(9, .34 * (1 - squared[1]), out(range(t, .7, 1.4))), .3 * (1 - squared[1]), .02);
    feature.rotation.z = -.12 * (1 - squared[1]) + wobble(t, STRIKES[1], 18, 6) * .1;
    pose(t);

    pad.position.set(HOME, -4.2 * (1 - back(range(t, .1, .75), 1.3)), -.45);
    asks.show(t, 1, 2.15);
    STRIKES.forEach((strike, i) => bursts[i](t - strike + .03, contacts[i], i === 2 ? .9 : .5));
    const ripple = range(t, LANDS - .03, LANDS + .6);
    wave.visible = ripple > 0 && ripple < 1;
    wave.scale.setScalar(1 + smooth(ripple) * 3.2);
    wave.material.opacity = 1 - ripple;

    carrier.getWorldPosition(at);
    const height = at.y - MIDDLE;
    shadow.position.set(at.x, .01, at.z + .1);
    shadow.scale.set(1.5, .8, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    shadow.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height / 1.2));
    const hits = STRIKES.map(strike => (t > strike ? Math.exp(-(t - strike) * 9) : 0));
    glow.intensity = 9 + Math.sin(t * 3) * 3 + (hits[0] + hits[1]) * 5 + hits[2] * 14;
    const shake = hits[0] * .2 + hits[1] * .2 + hits[2];
    camera.position.x = .25 + Math.sin(t * 97) * shake * .06;
    camera.position.y = 2.7 + Math.cos(t * 83) * shake * .05;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose };
}
