import {
  AdditiveBlending, CanvasTexture, CircleGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';
import { createOrc } from './orc-model.js';
import { back, clamp, createStage, fall, keys, mix, out, pulse, range, smooth, whip, wobble } from '../../ui/yeet/stage.js';

import { createClearScene } from './clear-scene.js';
import { createPlanScene } from './plan-scene.js';
import { createPrScene } from './pr-scene.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';
export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: createYeetScene, pr: createPrScene, plan: createPlanScene, clear: createClearScene,
  look: {
    words: { yeet: 'YEET.', pr: 'PR OPENED.', plan: 'PLAN READY.', clear: 'ALL SETTLED.' },
    background: 'radial-gradient(ellipse at 50% 57%,light-dark(#f1f4ec,#34413b) 0%,light-dark(#dce2da,#18201d) 45%,light-dark(#c3ccc4,#0c100f) 100%)',
    ink: 'light-dark(#2c4632,#ecf4c7)',
    glow: '0 5px 0 light-dark(#b7cf95,#213f28),0 0 70px light-dark(#53743a40,#b9e46a50)',
    flash: 'light-dark(#53743a,#e9ffb8)',
    flashGlow: 'light-dark(#9dc76b90,#b9e46a90)',
  },
};

// The second the ball leaves the hand.
const LANDS = 3.32;


// Beats: burst up through the page and land on bent knees (0.15-1.3), crack
// the neck (1.25-1.8), beckon for the page and catch the ball (1.85-2.6),
// toss and catch it (2.6-2.88), wind up with the front knee high (2.88-3.14),
// stride and whip it away roaring (3.14-3.32), follow through onto the front
// leg (3.32-3.8), shade the eyes to watch it twinkle out (3.8-4.15), then
// hop back square into a grinning double-biceps flex.
const T = {
  rootY: [[.15, -2.6], [.68, .55, out], [.93, 0, fall], [3.95, 0], [4.08, .14, out], [4.22, 0, fall]],
  rootZ: [[.15, -1.8], [.85, .15, out]],
  lean: [[.15, -.5], [.66, .14], [1.05, 0]],
  turn: [[2.85, 0], [3.1, .08], [3.3, -.16], [3.95, -.14], [4.2, 0]],
  hipY: [[.86, 0], [.93, .04], [1.03, -.46, out], [1.35, -.08], [1.6, 0], [2.88, 0], [3.1, -.1], [3.3, -.36, out], [3.55, -.3], [3.9, -.06], [4.3, 0]],
  hipX: [[2.85, 0], [3.1, .24], [3.3, -.3], [3.6, -.4], [3.95, -.14], [4.3, 0]],
  hipTwist: [[2.6, 0], [2.88, .05], [3.12, .32], [3.26, -.3, whip], [3.6, -.42], [3.95, -.2], [4.3, 0]],
  spineTwist: [[2.9, 0], [3.12, .12], [3.29, -.18, whip], [3.6, -.2], [4, -.08], [4.3, 0]],
  chestTwist: [[2.9, 0], [3.12, .1], [3.31, -.16, whip], [3.6, -.16], [4, -.04], [4.3, 0]],
  bend: [[.95, 0], [1.05, .32, out], [1.4, 0], [2.9, 0], [3.12, -.14], [3.34, .42], [3.62, .38], [3.95, 0], [4.25, -.04], [4.55, -.12]],
  tilt: [[2.9, 0], [3.12, -.16], [3.32, .3], [3.62, .14], [4, 0]],
  leftFootX: [[2.88, 0], [3.1, .3], [3.24, -.5], [3.95, -.5], [4.2, 0]],
  leftFootY: [[.2, 0], [.45, .38], [.82, .26], [.93, 0, fall], [2.88, 0], [3.1, .62, out], [3.16, .55], [3.24, 0, fall]],
  leftFootZ: [[2.88, 0], [3.1, .16], [3.24, .3], [3.95, .3], [4.2, 0]],
  rightFootX: [[3.3, 0], [3.5, -.22], [3.8, -.3], [3.95, -.3], [4.2, 0]],
  rightFootY: [[.25, 0], [.5, .2], [.85, .12], [.93, 0, fall], [3.3, 0], [3.47, .52, out], [3.62, .44], [3.78, 0, fall]],
  rightFootZ: [[3.3, 0], [3.5, -.36], [3.8, -.12], [4.2, 0]],
  lArmY: [[3.55, 0], [3.78, .2], [4.15, .2], [4.38, 0]],
  lWrist: [[3.55, 0], [3.78, -.9], [4.15, -.9], [4.3, 0]],
  lGrip: [[.85, 1], [1.1, .1], [2.9, .1], [3.05, 0], [3.22, .9], [3.6, .9], [3.75, 0], [4.2, 0], [4.38, 1]],
  rGrip: [[2.42, .6], [3.36, .6], [3.4, .9], [4.2, .9], [4.38, 1]],
  rArmZ: [[.15, 1.3], [.45, 2.6, out], [.88, 2.35], [1.05, .9], [1.4, .25], [1.85, .25], [2.12, 1.05], [2.45, .95], [2.88, .55], [3.1, 1.6], [3.16, 1.65], [3.32, .35, whip], [3.55, -.3], [3.9, .55], [4.15, .55], [4.38, 1.5]],
  rArmX: [[.15, -.6], [.45, 0], [1.05, -.3], [1.4, 0], [1.85, 0], [2.12, -.95], [2.45, -1], [2.88, -1.2], [3.1, -2], [3.16, -2.1], [3.32, -2.75, whip], [3.55, -1], [3.9, .3], [4.15, .3], [4.38, -1.57]],
  rElbow: [[.15, -.6], [.45, -.5], [1.05, -.4], [1.85, -.3], [2.12, -.8], [2.45, -1], [2.88, -1.4], [3.1, -1.8], [3.16, -1.9], [3.32, -.3, whip], [3.55, -.6], [3.9, -1.3], [4.15, -1.3], [4.38, -2.1]],
  lArmZ: [[.15, -1.3], [.45, -2.6, out], [.88, -2.35], [1.05, -.9], [1.4, -.25], [1.85, -.5], [2.88, -.5], [3.1, -1.45], [3.3, -.7], [3.55, -.9], [3.78, .45], [4.15, .45], [4.38, -1.5]],
  lArmX: [[.15, -.6], [.45, 0], [1.05, -.3], [1.4, 0], [1.85, .2], [2.88, .2], [3.1, -.35], [3.3, -1.2], [3.55, -.6], [3.78, -2.45], [4.15, -2.45], [4.38, -1.57]],
  lElbow: [[.15, -.6], [.45, -.5], [1.05, -.4], [1.85, -1.3], [2.88, -1.3], [3.1, -.3], [3.3, -1.9], [3.55, -.6], [3.78, -1.6], [4.15, -1.6], [4.38, -2.1]],
  headTilt: [[1.2, 0], [1.32, .42, out], [1.44, .3], [1.54, -.42, out], [1.66, -.3], [1.82, 0], [2.9, 0], [3.12, .12], [3.32, -.1], [3.6, 0], [3.8, .22], [4.15, .22], [4.3, 0]],
  headTurn: [[1.85, 0], [2.05, .35], [2.4, .3], [2.6, .1], [2.88, 0], [3.1, -.9], [3.3, .45, whip], [3.6, .5], [3.8, .1], [4.15, .05], [4.3, 0]],
  headNod: [[.15, -.3], [.6, -.4], [1, .22], [1.3, 0], [2.4, .05], [2.55, .15], [2.72, -.4], [2.88, 0], [3.1, .05], [3.3, -.35], [3.55, 0], [3.8, -.3], [4.15, -.3], [4.3, -.08], [4.6, -.16]],
  // jaw, squint, smile, brow, frown, lookX, lookY, flare
  face: [
    [0, [.7, .6, 0, .2, .9, 0, .2, .7]],
    [.8, [.8, .6, 0, .3, .9, 0, .2, .8]],
    [1.02, [.15, 1, -.3, -.2, .8, 0, -.2, .5]],
    [1.25, [0, .3, .2, 0, .4, 0, 0, 0]],
    [1.36, [0, 1, -.4, -.3, .7, -.4, 0, .5]],
    [1.47, [0, .3, .3, 0, .3, 0, 0, 0]],
    [1.58, [0, 1, -.4, -.3, .7, .4, 0, .5]],
    [1.75, [.1, .2, .8, .6, -.1, 0, 0, 0]],
    [2.05, [.3, 0, .7, .8, -.3, .7, .4, 0]],
    [2.4, [.25, 0, .6, .7, -.2, .6, .2, 0]],
    [2.52, [0, 0, .3, 1, -.4, .5, -.4, 0]],
    [2.72, [.1, .2, .7, .5, -.1, .3, 1, 0]],
    [2.88, [0, .2, .6, .4, 0, .2, 0, 0]],
    [3.08, [0, .7, -.4, -.2, 1, -.8, .1, .6]],
    [3.18, [.2, .7, -.2, 0, 1, -.6, .2, .8]],
    [3.27, [1, .7, 0, .2, 1, -.5, .3, 1]],
    [3.6, [1, .6, 0, .2, 1, -.5, .4, 1]],
    [3.8, [.2, .8, 0, -.1, .3, -.6, .7, .2]],
    [4, [.2, .9, 0, 0, .2, -.6, .7, 0]],
    [4.1, [.45, 0, 0, 1, -.4, -.6, .8, 0]],
    [4.3, [.25, .35, 1, .5, -.3, 0, 0, 0]],
  ],
};

export function createYeetScene(container, title) {
  const { canvas, scene, camera, glow, renderer, dispose, warm } = createStage(container);
  const orc = createOrc();
  scene.add(orc.root);
  const shadow = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const halo = new Mesh(new TorusGeometry(2.15, .022, 5, 64), new MeshBasicMaterial({ color: 0xb0d581, transparent: true, opacity: .3 }));
  halo.position.set(0, 2, -1.6);
  halo.scale.y = 1.08;
  scene.add(halo);

  const paperCanvas = document.createElement('canvas');
  paperCanvas.width = 512;
  paperCanvas.height = 512;
  const ctx = paperCanvas.getContext('2d');
  ctx.fillStyle = '#e8e3c9';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#345144';
  ctx.font = 'bold 35px system-ui';
  ctx.fillText('SHIP', 38, 65);
  ctx.font = 'bold 22px system-ui';
  ctx.fillText(title.trim().slice(0, 28), 38, 118);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#a1a695' : '#818f7d';
    ctx.fillRect(39, 165 + i * 45, 280 + Math.sin(i * 3) * 65, 10);
  }
  ctx.fillStyle = '#728f45';
  ctx.fillRect(38, 441, 148, 34);
  const texture = new CanvasTexture(paperCanvas);
  texture.colorSpace = SRGBColorSpace;
  const paper = new Group();
  const crumpled = new Mesh(new IcosahedronGeometry(.58, 1), new MeshStandardMaterial({ map: texture, roughness: .95, flatShading: true }));
  crumpled.castShadow = true;
  paper.add(crumpled);
  for (let i = 0; i < 5; i++) {
    const fold = new Mesh(new PlaneGeometry(.42, .58), crumpled.material);
    fold.material.side = DoubleSide;
    fold.position.set(Math.sin(i * 2) * .45, Math.cos(i * 2) * .35, .2);
    fold.rotation.set(i * .6, i * 1.2, i * .9);
    paper.add(fold);
  }
  scene.add(paper);
  const ghostMaterial = new MeshBasicMaterial({ color: 0xe8e3c9, transparent: true, opacity: .28, depthWrite: false });
  const ghosts = Array.from({ length: 5 }, () => new Mesh(crumpled.geometry, ghostMaterial));
  scene.add(...ghosts);

  const starCanvas = document.createElement('canvas');
  starCanvas.width = starCanvas.height = 128;
  const sctx = starCanvas.getContext('2d');
  const shine = sctx.createRadialGradient(64, 64, 0, 64, 64, 40);
  shine.addColorStop(0, 'rgba(255,250,210,.9)');
  shine.addColorStop(1, 'rgba(255,250,210,0)');
  sctx.fillStyle = shine;
  sctx.fillRect(0, 0, 128, 128);
  sctx.fillStyle = '#fffbe0';
  sctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    sctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    sctx.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
  }
  sctx.fill();
  const starTexture = new CanvasTexture(starCanvas);
  starTexture.colorSpace = SRGBColorSpace;
  const star = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: starTexture, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  const ring = new Mesh(new TorusGeometry(1, .035, 4, 40), new MeshBasicMaterial({ color: 0xe9ffb8, transparent: true, depthWrite: false }));
  scene.add(star, ring);

  const sparks = new Group();
  const flecks = [];
  const chipGeometry = new IcosahedronGeometry(.04, 0);
  const chipMaterials = [0xdbe6a1, 0xe8b65c, 0x8fa873].map(color => new MeshBasicMaterial({ color, transparent: true }));
  for (let i = 0; i < 38; i++) {
    const mesh = new Mesh(chipGeometry, chipMaterials[i % 3]);
    const angle = i * 2.39996;
    flecks.push({ mesh, x: Math.cos(angle), y: Math.sin(angle), speed: .7 + (i % 7) * .24 });
    sparks.add(mesh);
  }
  scene.add(sparks);

  const point = new Vector3();
  const far = new Vector3(-5.5, 7.2, -30);
  const burstPoint = new Vector3(0, 1.4, .5);
  const face = [];
  const camY = camera.position.y;

  function holdPoint(target) {
    return orc.rightGrip.localToWorld(target.set(-.2, -.1, 0));
  }

  function pose(t) {
    orc.reset();
    orc.root.position.set(0, keys(t, T.rootY), keys(t, T.rootZ));
    orc.root.rotation.set(keys(t, T.lean), keys(t, T.turn), 0);
    orc.hips.position.x += keys(t, T.hipX);
    orc.hips.position.y += keys(t, T.hipY);
    orc.hips.rotation.y = keys(t, T.hipTwist);
    // Arms out for balance while the follow-through teeters on one leg.
    const teeter = wobble(t, 3.42, 9, 3.2);
    orc.hips.rotation.z = teeter * .1;
    orc.spine.rotation.set(keys(t, T.bend), keys(t, T.spineTwist), -teeter * .06);
    orc.chest.rotation.set(0, keys(t, T.chestTwist), keys(t, T.tilt));
    orc.feet.left.set(keys(t, T.leftFootX), keys(t, T.leftFootY), keys(t, T.leftFootZ));
    orc.feet.right.set(keys(t, T.rightFootX), keys(t, T.rightFootY), keys(t, T.rightFootZ));
    const turn = keys(t, T.headTurn);
    orc.neck.rotation.y = turn * .4;
    orc.head.rotation.set(keys(t, T.headNod), turn * .6, keys(t, T.headTilt) + wobble(t, 1.32, 70, 22) * .05 + wobble(t, 1.54, 70, 22) * .05);
    const pump = Math.sin(t * 15) * pulse(t, 4.45, 4.95) * .18;
    orc.rightArm.rotation.set(keys(t, T.rArmX) + wobble(t, 2.48, 14, 6) * .3 + pulse(t, 2.54, 2.64) * -.35 + wobble(t, 2.86, 14, 6) * .25, 0, keys(t, T.rArmZ));
    orc.rightElbow.rotation.x = keys(t, T.rElbow) + pump;
    orc.leftArm.rotation.set(keys(t, T.lArmX), keys(t, T.lArmY), keys(t, T.lArmZ) - teeter * .5);
    orc.leftElbow.rotation.x = keys(t, T.lElbow) + pump;
    orc.leftHand.rotation.z = keys(t, T.lWrist);
    orc.idle(t, 1 - pulse(t, 3, 3.7) * .7);
    let k = 1;
    while (k < T.face.length - 1 && t > T.face[k][0]) k += 1;
    const [a, from] = T.face[k - 1], [b, to] = T.face[k];
    for (let i = 0; i < 8; i++) face[i] = mix(from[i], to[i], smooth(range(t, a, b)));
    const waggle = Math.sin(t * 24) * (pulse(t, 1.7, 1.9) + pulse(t, 4.5, 4.85)) * .45;
    orc.face({ jaw: face[0], squint: face[1], smile: face[2], brow: face[3] + waggle, frown: face[4], look: [face[5], face[6]], flare: face[7] });
    // Gimme fingers while the page flies in.
    const beckon = (.5 + Math.sin(t * 22) * .5) * pulse(t, 1.9, 2.35);
    orc.grip('right', t < 2.42 ? beckon * .8 : keys(t, T.rGrip));
    orc.grip('left', keys(t, T.lGrip));
    orc.plantFeet();
  }

  pose(LANDS);
  const origin = holdPoint(new Vector3());
  function flight(t, target) {
    const s = 1 - Math.exp(-Math.max(0, t - LANDS) * 4.6);
    target.lerpVectors(origin, far, s);
    target.x -= Math.sin(s * Math.PI) * 1.4;
    return target;
  }

  function render(t) {
    pose(t);
    const thrown = t >= LANDS;
    paper.visible = t > 2.3 && t < 4.02;
    if (!thrown) {
      holdPoint(paper.position);
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

    const release = thrown ? LANDS - .03 : .3;
    const from = thrown ? origin : burstPoint;
    flecks.forEach(({ mesh, x, y, speed }, i) => {
      const age = Math.max(0, t - release);
      mesh.visible = age > 0 && age < (thrown ? .85 : 1.5);
      mesh.position.set(from.x + x * age * speed * 4, from.y + y * age * speed * 3 - age * age * 2, from.z + age * (i % 4));
      mesh.rotation.set(age * 7, i, age * 4);
      mesh.scale.setScalar((1 - clamp(age / 1.5)) * (i % 3 + 1));
    });

    orc.hips.getWorldPosition(point);
    const height = orc.root.position.y;
    shadow.position.set(point.x, .01, point.z + .1);
    shadow.scale.set(2.4, 1.25, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    shadow.material.opacity = .35 * range(height, -1, 0) * (1 - clamp(height) * .5);
    const emerge = range(t, .12, 1.55);
    halo.material.opacity = .2 * Math.sin(emerge * Math.PI) + .06;
    halo.scale.setScalar(1 + range(t, .2, 1.5) * .4);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + pulse(t, 3.3, 3.7) * 8;
    const impact = pulse(t, LANDS, 3.6) * .035;
    const thud = pulse(t, .93, 1.15) * .04;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * thud;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([texture]) };
}
