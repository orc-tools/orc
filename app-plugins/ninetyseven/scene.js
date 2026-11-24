// The Orcsoft 97 cast for Yeet, PR opened, Plan reveal and All settled: Clippy on the teal
// desktop, with a screen saver's worth of windows flying out of the distance
// behind him.
import {
  AdditiveBlending, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, pulse, range, wobble } from '../../ui/yeet/stage.js';
import { createClearScene } from './clear-scene.js';
import { createClippy } from './clippy-model.js';
import { createPlanScene } from './plan-scene.js';
import { createPrScene } from './pr-scene.js';
import {
  balloon, blobShadow, canvasTexture, chips, dressStage, fall, FONT, keys, NAVY, notepad, out, whip,
} from './desktop-set.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

// Voices are left out of the look, so the host falls back to the orc's own.
export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: createYeetScene, pr: createPrScene, plan: createPlanScene, clear: createClearScene,
  look: {
    words: { yeet: 'YEET.EXE', pr: 'PR OPENED', plan: 'PLAN.DOC SAVED', clear: '0 OBJECT(S)' },
    background: 'light-dark(#008080,#0a4a4a)',
    ink: '#ffffff',
    glow: '3px 3px 0 #000000',
    flash: '#ffffff',
    flashGlow: 'light-dark(#ffffff90,#8ab4f8b0)',
  },
};

// The ball leaves the hook exactly when the send-offs plugin plays the voice.
const LANDS = 3.32;
const SCALE = 1.15;

// Beats: spring up through the page and land with a squash (0.15-1.3), ask
// whether to yeet it and waggle the eyebrows (1.05-1.85), hold the arm out for
// the page and catch the ball (1.85-2.6), toss and catch it (2.6-2.86), coil
// back with the ball low (2.88-3.14), whip it away overhead (3.14-3.32), ring
// like a struck spring (3.32-3.9), watch it twinkle out, then hop twice.
const T = {
  rise: [[.15, -4.6], [.62, .7, out], [.9, 0, fall], [3.98, 0], [4.1, .45, out], [4.24, 0, fall], [4.42, 0], [4.52, .28, out], [4.64, 0, fall]],
  depth: [[.15, -1.4], [.85, 0, out]],
  stretch: [[.15, 1.14], [.62, 1.2], [.9, 1.08], [.99, .68, out], [1.16, 1.12], [1.32, .95], [1.48, 1], [2.88, 1], [3.14, .82], [3.3, 1.1, whip], [3.55, .98], [3.9, 1], [3.98, .84], [4.1, 1.14, out], [4.24, .86, fall], [4.36, 1.06], [4.42, .9], [4.52, 1.1, out], [4.64, .9, fall], [4.8, 1]],
  sway: [[2.88, 0], [3.14, .5], [3.32, -.25, whip], [3.5, -.4, out], [3.8, -.15], [4.1, 0]],
  lean: [[.15, -.35], [.7, .12], [1.05, 0], [2.88, 0], [3.14, -.15], [3.32, .3, whip], [3.7, .05], [4, 0]],
  twist: [[2.88, 0], [3.14, .45], [3.32, -.35, whip], [3.8, -.1], [4.1, 0]],
  arm: [[1.8, 0], [2.12, 1.1, out], [2.58, 1.05], [2.64, .85], [2.72, 1.3, out], [2.86, 1.05], [3.14, .35], [3.32, 2.2, whip], [3.44, 2.8, out], [3.85, 2.6], [4.15, 2.5], [4.42, 0]],
  curl: [[1.85, 0], [2.3, .15], [3.14, .3], [3.32, -.2, whip], [3.6, 0]],
  lookX: [[.9, 0], [1.02, -.8], [1.28, -.8], [1.4, .8], [1.62, .8], [1.76, 0], [1.9, .9], [2.6, .9], [3.14, .7], [3.32, -.3, whip], [3.5, -.8], [4.05, -.8], [4.3, 0]],
  lookY: [[.15, .5], [.9, 0], [2.58, -.1], [2.72, .8], [2.86, -.1], [3.14, -.5], [3.32, .7, whip], [3.5, .9], [4.05, .9], [4.3, 0]],
  brow: [[.15, .9], [1, .9], [1.25, 0], [1.9, .6], [2.58, .6], [2.72, 1], [2.9, .3], [3.14, -.5], [3.4, -.3], [3.6, 1], [4.1, 1], [4.3, .3]],
  scowl: [[2.86, 0], [3.14, .9], [3.36, 1], [3.6, 0]],
  squint: [[2.88, 0], [3.14, .4], [3.36, .5], [3.5, 0]],
  wide: [[.15, 1.15], [1, 1.15], [1.2, 1], [3.5, 1], [3.6, 1.15], [4.1, 1.15], [4.3, 1]],
};

function crumpledPage(title) {
  const texture = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, 512, 84);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText('SHIP', 38, 58);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText(title.trim().slice(0, 28), 38, 130);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#b8b8b8' : '#8a8a8a';
      ctx.fillRect(39, 170 + i * 45, 280 + Math.sin(i * 3) * 65, 10);
    }
    ctx.fillStyle = '#008080';
    ctx.fillRect(38, 441, 148, 34);
  });
  const paper = new Group();
  const ball = new Mesh(new IcosahedronGeometry(.58, 1), new MeshStandardMaterial({ map: texture, roughness: .95, flatShading: true, side: DoubleSide }));
  ball.castShadow = true;
  paper.add(ball);
  for (let i = 0; i < 5; i++) {
    const fold = new Mesh(new PlaneGeometry(.42, .58), ball.material);
    fold.position.set(Math.sin(i * 2) * .45, Math.cos(i * 2) * .35, .2);
    fold.rotation.set(i * .6, i * 1.2, i * .9);
    paper.add(fold);
  }
  return { paper, ball };
}

function twinkle() {
  const texture = canvasTexture(128, 128, ctx => {
    const shine = ctx.createRadialGradient(64, 64, 0, 64, 64, 40);
    shine.addColorStop(0, 'rgba(255,255,255,.9)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
      ctx.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
    }
    ctx.fill();
  });
  const star = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  const ring = new Mesh(new TorusGeometry(1, .035, 4, 40), new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
  return { star, ring };
}

export function createYeetScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const backdrop = dressStage(stage);
  const clippy = createClippy();
  clippy.root.scale.setScalar(SCALE);
  const pad = notepad();
  const shadow = blobShadow();
  const asks = balloon(['It looks like you’re', 'shipping a run.', '(o) Yeet it', '( ) Yeet it harder'], .7);
  asks.mesh.position.set(-.45, 3.78, .5);
  const { paper, ball } = crumpledPage(title);
  const ghostMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .28, depthWrite: false });
  const ghosts = Array.from({ length: 5 }, () => new Mesh(ball.geometry, ghostMaterial));
  const { star, ring } = twinkle();
  scene.add(pad, shadow, clippy.root, asks.mesh, paper, ...ghosts, star, ring);
  const burst = chips(scene, 38);

  const far = new Vector3(-5.5, 7.2, -30);
  const burstPoint = new Vector3(0, 1.4, .5);
  const camY = camera.position.y;

  function pose(t) {
    clippy.root.position.set(0, keys(t, T.rise), keys(t, T.depth));
    const waggle = Math.sin(t * 20) * (pulse(t, 1.3, 1.85) + pulse(t, 4.45, 4.9)) * .7;
    const brow = keys(t, T.brow);
    // Rings like a struck spring once the ball is away.
    const ringing = wobble(t, LANDS, 15, 4.5);
    clippy.pose({
      arm: keys(t, T.arm),
      // Gimme, while the page flies in.
      curl: keys(t, T.curl) + (.5 + Math.sin(t * 22) * .5) * pulse(t, 1.9, 2.35) * .25,
      stretch: keys(t, T.stretch) + wobble(t, .99, 22, 7) * .08 + Math.sin(t * 3) * .012,
      sway: keys(t, T.sway) + ringing * .3 + Math.sin(t * 1.7) * .015,
      lean: keys(t, T.lean),
      twist: keys(t, T.twist),
      look: [keys(t, T.lookX), keys(t, T.lookY)],
      blink: keys(t, T.squint) + pulse(t, 1, 1.12) + pulse(t, 2.46, 2.58) + pulse(t, 4.3, 4.42),
      brows: [brow + waggle, brow - waggle],
      scowl: keys(t, T.scowl),
      wide: keys(t, T.wide),
    });
  }

  pose(LANDS);
  const origin = clippy.palm(new Vector3());
  function flight(t, target) {
    const s = 1 - Math.exp(-Math.max(0, t - LANDS) * 4.6);
    target.lerpVectors(origin, far, s);
    target.x -= Math.sin(s * Math.PI) * 1.4;
    return target;
  }

  function render(t) {
    backdrop(t);
    pose(t);
    pad.position.set(0, -4.2 * (1 - back(range(t, .1, .75), 1.3)), -.45);
    asks.show(t, 1.05, 2.5);
    const thrown = t >= LANDS;
    paper.visible = t > 2.3 && t < 4.02;
    if (!thrown) {
      clippy.palm(paper.position);
      const toss = range(t, 2.6, 2.86);
      paper.position.y += 4 * toss * (1 - toss) * 1.05;
      paper.scale.setScalar(.7 * back(range(t, 2.3, 2.62)));
      paper.rotation.set(t * 1.3 + toss * 6, t * .7, t * .3 + toss * 4);
    } else {
      flight(t, paper.position);
      paper.rotation.set(t * 9, t * 12, t * 7);
      paper.scale.setScalar(.7 * (1 - range(t, 3.82, 4.02)));
    }
    ghosts.forEach((ghost, i) => {
      const at = t - (i + 1) * .028;
      ghost.visible = thrown && at > LANDS && t < 3.9;
      flight(at, ghost.position);
      ghost.scale.setScalar(.6 * (1 - i * .17) * (1 - range(t, 3.6, 3.9)));
    });
    const pop = range(t, 3.98, 4.12);
    const fade = 1 - range(t, 4.12, 4.45);
    star.visible = ring.visible = pop > 0 && fade > 0;
    flight(4, star.position);
    star.quaternion.copy(camera.quaternion);
    star.rotateZ(t * 3);
    star.scale.setScalar(2.8 * back(pop, 2.4) * fade);
    star.material.opacity = fade;
    ring.position.copy(star.position);
    ring.quaternion.copy(camera.quaternion);
    ring.scale.setScalar(.2 + out(range(t, 3.98, 4.35)) * 2.6);
    ring.material.opacity = (1 - range(t, 4, 4.35)) * .8;

    if (thrown) burst(t - LANDS + .03, origin, .85);
    else burst(t - .3, burstPoint, 1.5);

    const height = clippy.root.position.y;
    shadow.position.set(0, .01, clippy.root.position.z + .1);
    shadow.scale.set(1.5, .8, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    shadow.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height) * .5);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + pulse(t, 3.3, 3.7) * 8;
    const impact = pulse(t, LANDS, 3.6) * .035;
    const thud = pulse(t, .93, 1.15) * .04;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * thud;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose };
}
