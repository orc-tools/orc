import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { createClippy } from './clippy-model.js';
import {
  balloon, blobShadow, canvasTexture, CHROME, chips, dressStage, fall, FONT, keys, NAVY, notepad, out, whip, wrap,
} from './desktop-set.js';

const OPENS = [1.84, 2.1];
const LANDS = 2.55;
const RELEASE = 3.22;
const FLIGHT = [RELEASE, 4.1];
const SCALE = 1.15;
const HOME = -1.9;
// The document's size once it fills the view, and its share of that while it
// hangs from his hook.
const PAGE = [2.304, 2.1875];
const HELD = 1;
// From the hook to the page's middle: he holds it by its top left corner.
const HANGS = [PAGE[0] / 2 - .19, .31 - PAGE[1] / 2, .12];
// Centred on the camera's line of sight, about half the view tall: the
// overlay in the send-offs plugin pushes in on it from there.
const FRONT = new Vector3(.25, 2.36, 6);

// Beats: spring up and glance about (0.1-1.5), offer the plan (0.95-1.7),
// hook the document out of thin air (1.5-2.1), peek at it and waggle the
// eyebrows (2.1-2.5), bounce as the word lands (2.55), draw it back
// (2.9-3.12), fling it at the viewer (3.22) and wave it off.
const T = {
  rise: [[.1, -4.6], [.6, .6, out], [.86, 0, fall], [2.5, 0], [2.6, .3, out], [2.72, 0, fall]],
  depth: [[.1, -1.4], [.85, 0, out]],
  stretch: [[.1, 1.14], [.6, 1.2], [.86, 1.08], [.95, .7, out], [1.1, 1.1], [1.26, .96], [1.4, 1], [1.6, 1], [1.74, .86], [1.88, 1.12, out], [2.05, 1], [2.48, 1], [2.52, .88], [2.6, 1.1, out], [2.72, .9, fall], [2.85, 1], [2.9, 1], [3.12, .86], [3.26, 1.14, whip], [3.5, 1]],
  arm: [[1.5, 0], [1.74, .5], [1.86, 1.85, out], [2.05, 1.7], [2.9, 1.7], [3.12, 1.2], [3.26, 2.1, whip], [3.5, 2.6]],
  forward: [[2.9, 0], [3.12, -.35], [3.26, .9, whip], [3.6, .3], [4, 0]],
  sway: [[1.6, 0], [1.74, -.2], [1.9, .15], [2.1, 0], [2.9, 0], [3.12, -.3], [3.26, .35, whip], [3.6, .1], [4, 0]],
  lean: [[.1, -.35], [.7, .12], [1, 0], [2.9, 0], [3.12, -.2], [3.26, .35, whip], [3.7, .1]],
  lookX: [[0, 0], [.45, -.8], [.6, .8], [.75, 0], [.98, -1], [1.18, -1], [1.28, 1], [1.46, 1], [1.56, 0], [1.8, .9], [2.4, .9], [2.5, 0], [2.9, 0], [3.1, .8], [3.3, .5], [3.6, .3]],
  lookY: [[0, .1], [1.8, .1], [1.9, .4], [2.4, .3], [2.5, 0], [3.26, 0], [3.5, -.2]],
  brow: [[0, -.1], [1.5, -.1], [1.62, .85], [1.75, .3], [1.86, 1], [2.05, .6], [2.42, .6], [2.52, .9], [2.95, .4], [3.08, -.3], [3.2, 1], [3.6, .7]],
  scowl: [[2.9, 0], [3.1, .7], [3.24, .8], [3.4, 0]],
  wide: [[1.8, 1], [1.88, 1.18], [2.1, 1], [3.2, 1], [3.3, 1.15], [3.7, 1]],
};

// A WordPad window holding the plan: title bar, menu and a page of ticked
// steps under the run's title.
function planDocument(title) {
  const texture = canvasTexture(512, 486, ctx => {
    ctx.fillStyle = CHROME;
    ctx.fillRect(0, 0, 512, 486);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 3);
    ctx.fillRect(0, 0, 3, 486);
    ctx.fillStyle = '#404040';
    ctx.fillRect(0, 483, 512, 3);
    ctx.fillRect(509, 0, 3, 486);
    const bar = ctx.createLinearGradient(6, 0, 506, 0);
    bar.addColorStop(0, NAVY);
    bar.addColorStop(1, '#1084d0');
    ctx.fillStyle = bar;
    ctx.fillRect(6, 6, 500, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('Plan.doc - WordPad', 16, 34);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = CHROME;
      ctx.fillRect(408 + i * 32, 11, 28, 30);
      ctx.fillStyle = '#000000';
      ctx.fillRect(415 + i * 32, i === 0 ? 33 : 18, 14, i === 0 ? 3 : 4);
    }
    ctx.fillStyle = '#000000';
    ctx.font = `18px ${FONT}`;
    ctx.fillText('File    Edit    View    Help', 16, 70);
    ctx.fillStyle = '#808080';
    ctx.fillRect(8, 82, 496, 396);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(11, 85, 493, 393);
    ctx.fillStyle = NAVY;
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillText('THE PLAN', 36, 138);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 23px ${FONT}`;
    wrap(ctx, title.trim(), 440, 2).forEach((line, i) => ctx.fillText(line, 36, 180 + i * 30));
    for (let i = 0; i < 5; i++) {
      const y = 262 + i * 40;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeRect(38, y - 16, 20, 20);
      ctx.strokeStyle = '#008080';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(42, y - 6);
      ctx.lineTo(48, y);
      ctx.lineTo(62, y - 20);
      ctx.stroke();
      ctx.fillStyle = i % 2 ? '#b8b8b8' : '#8a8a8a';
      ctx.fillRect(76, y - 11, 260 + Math.sin(i * 3) * 80, 10);
    }
  });
  const page = new Mesh(new PlaneGeometry(...PAGE), new MeshBasicMaterial({ map: texture, side: DoubleSide, toneMapped: false }));
  page.position.set(...HANGS);
  // The hook holds the group's origin, so the page swings and grows from it.
  const hang = new Group();
  hang.add(page);
  return hang;
}

export function createPlanScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const backdrop = dressStage(stage);
  const clippy = createClippy();
  clippy.root.scale.setScalar(SCALE);
  const pad = notepad();
  const shadow = blobShadow();
  shadow.scale.set(1.5, .8, 1);
  const asks = balloon(['It looks like you’re', 'writing a plan.', '(o) Show me'], .25);
  asks.mesh.position.set(HOME + .5, 3.8, .5);
  const hang = planDocument(title);
  scene.add(pad, shadow, clippy.root, asks.mesh, hang);
  const burst = chips(scene, 42);

  function pose(t) {
    clippy.root.position.set(HOME, keys(t, T.rise), keys(t, T.depth));
    const peek = range(t, 2.1, 2.4);
    const waggle = Math.sin(peek * Math.PI * 4) * pulse(t, 2.08, 2.42) * .6;
    const brow = keys(t, T.brow);
    const free = smooth(range(t, RELEASE + .1, RELEASE + .4));
    clippy.pose({
      arm: keys(t, T.arm) + wobble(t, OPENS[1], 14, 6) * .08 + Math.sin(t * 18) * .22 * free,
      forward: keys(t, T.forward),
      stretch: keys(t, T.stretch) + wobble(t, .95, 22, 7) * .08 + Math.sin(t * 3) * .012,
      sway: keys(t, T.sway) + wobble(t, RELEASE, 15, 4.5) * .2 + Math.sin(t * 1.7) * .015,
      lean: keys(t, T.lean),
      look: [keys(t, T.lookX), keys(t, T.lookY)],
      blink: pulse(t, .88, 1.02) + pulse(t, 2.44, 2.56) + pulse(t, 3.7, 3.82),
      brows: [brow + waggle, brow - waggle],
      scowl: keys(t, T.scowl),
      wide: keys(t, T.wide),
    });
  }

  pose(RELEASE);
  const released = clippy.tip(new Vector3());
  pose(LANDS);
  const cheer = clippy.tip(new Vector3()).add(new Vector3(HANGS[0], HANGS[1], HANGS[2] + .2).multiplyScalar(HELD));
  const landed = FRONT.clone().sub(new Vector3(...HANGS));

  function render(t) {
    backdrop(t);
    pose(t);
    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    hang.visible = t > OPENS[0];
    if (t <= RELEASE) clippy.tip(hang.position);
    else {
      hang.position.lerpVectors(released, landed, lift);
      hang.position.y += Math.sin(lift * Math.PI) * .35;
    }
    hang.scale.setScalar(mix(HELD, 1, lift) * back(range(t, OPENS[0], OPENS[1]), 2));
    // Swings from its corner as it pops open, at the bounce and on the
    // draw back, then squares up to the viewer in flight.
    hang.rotation.z = (.1 * wobble(t, OPENS[1], 9, 4) - .12 * wobble(t, 2.5, 8, 4) - .18 * pulse(t, 2.9, 3.15)) * (1 - lift);
    hang.rotation.y = -.18 * (1 - lift);

    pad.position.set(HOME, -4.2 * (1 - back(range(t, .1, .75), 1.3)), -.45);
    asks.show(t, .95, 1.62);
    burst(t - LANDS, cheer, 1.1);
    const bounce = pulse(t, LANDS - .1, LANDS + .3);
    const height = clippy.root.position.y;
    shadow.position.set(HOME, .01, clippy.root.position.z + .1);
    shadow.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height) * .5);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + bounce * 18;
    camera.position.x = .25 + Math.sin(t * 90) * bounce * .03;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose };
}
