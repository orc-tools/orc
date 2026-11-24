import { CircleGeometry, Mesh, MeshBasicMaterial, TorusGeometry, Vector3 } from 'three';
import { createOrc } from './orc-model.js';
import { clamp, createStage, fall, keys, mix, out, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';

const LANDS = CLEAR_LANDS;
const TOUCH = 2.02;
const FLEX = 4.3;

// Beats: burst up through the page and land on bent knees (0.15-0.95), sink
// into a crouch with both fists cocked (0.95-1.4), launch into a star jump
// roaring as the first shells burst (1.45), land (2.02), stomp out a victory
// jig with alternating fist pumps (2.1-4.25), then hit a double-biceps flex.
const T = {
  rootY: [[.15, -2.6], [.62, .5, out], [.9, 0, fall], [1.4, 0], [1.72, 1.25, out], [TOUCH, 0, fall]],
  rootZ: [[.15, -1.8], [.85, .2, out]],
  hipY: [[.86, 0], [.98, -.4, out], [1.15, -.2], [1.4, -.5], [1.5, .05, out], [1.9, 0], [TOUCH, -.05], [2.12, -.42, out], [2.35, -.1]],
  arm: [[.15, 2.5], [.9, 2.3], [1.05, .9], [1.4, .45], [1.52, 2.75, out], [1.95, 2.6], [2.12, 1.2], [2.3, 1.5]],
  elbow: [[.15, -.5], [1.05, -.6], [1.4, -1.9], [1.52, -.15, out], [1.95, -.3], [2.12, -1.2], [2.3, -1.6]],
  lean: [[.15, -.5], [.66, .12], [1, .1], [1.4, .3], [1.52, -.28, out], [1.95, -.1], [2.12, .22], [2.4, 0]],
  // jaw, squint, smile, brow, frown, flare
  face: [
    [0, [.7, .5, .2, .4, .6, .6]],
    [.9, [.5, .4, .4, .4, .4, .4]],
    [1.1, [.1, .7, .6, -.2, .7, .3]],
    [1.4, [.05, .9, .3, -.4, .9, .6]],
    [1.5, [1, .6, .5, .6, .3, 1]],
    [1.95, [1, .5, .6, .6, .2, 1]],
    [2.15, [.2, .8, .8, 0, .2, .4]],
    [2.4, [.45, .3, 1, .6, -.3, .1]],
    [4.2, [.45, .3, 1, .6, -.3, .1]],
    [4.45, [.25, .4, 1, .7, -.35, 0]],
  ],
};

export function createClearScene(container) {
  const { canvas, scene, camera, glow, renderer, dispose, warm } = createStage(container);
  const orc = createOrc();
  scene.add(orc.root);
  const shadow = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  const halo = new Mesh(new TorusGeometry(2.15, .022, 5, 64), new MeshBasicMaterial({ color: 0xb0d581, transparent: true, opacity: .3 }));
  halo.position.set(0, 2, -1.6);
  const dust = new Mesh(new TorusGeometry(1, .07, 6, 48), new MeshBasicMaterial({ color: 0xdfe6c8, transparent: true, depthWrite: false }));
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = .04;
  scene.add(shadow, halo, dust);
  const fireworks = createFireworks(scene, camera, { colors: [0x8fd14f, 0xf0b33c, 0xe2603a, 0xfff2b0] });

  const face = [];
  const point = new Vector3();
  const camY = camera.position.y;

  function pose(t) {
    const jig = smooth(range(t, 2.1, 2.35)) * (1 - smooth(range(t, FLEX - .15, FLEX + .1)));
    const flex = smooth(range(t, FLEX - .05, FLEX + .2));
    // Two stomps a second; each arm pumps on its own foot's beat.
    const beat = (t - 2.1) * Math.PI * 2;
    const step = Math.sin(beat), pump = Math.sin(beat * 2);
    const arm = keys(t, T.arm), elbow = keys(t, T.elbow);
    orc.reset();
    orc.root.position.set(0, keys(t, T.rootY), keys(t, T.rootZ));
    orc.root.rotation.set(keys(t, T.lean), step * .28 * jig, 0);
    orc.hips.position.x += step * .2 * jig;
    orc.hips.position.y += keys(t, T.hipY) - Math.abs(pump) * .1 * jig - flex * .06;
    orc.hips.rotation.z = step * .08 * jig;
    orc.spine.rotation.set(-flex * .1, 0, -step * .1 * jig);
    orc.chest.rotation.set(-flex * .1, step * .12 * jig, 0);
    orc.feet.left.set(-.1 * jig, Math.max(0, step) * .42 * jig + pulse(t, 1.5, TOUCH) * .5, .1 * jig);
    orc.feet.right.set(.1 * jig, Math.max(0, -step) * .42 * jig + pulse(t, 1.5, TOUCH) * .35, 0);
    const up = [.5 + .5 * pump, .5 - .5 * pump];
    const raise = up.map(u => mix(arm, mix(1.35, 2.8, u), jig)), bend = up.map(u => mix(elbow, mix(-2, -.2, u), jig));
    orc.rightArm.rotation.set(mix(0, -1.57, flex), 0, mix(raise[0], 1.5, flex));
    orc.rightElbow.rotation.x = mix(bend[0], -2.1, flex) + Math.sin(t * 15) * .16 * flex;
    orc.leftArm.rotation.set(mix(0, -1.57, flex), 0, -mix(raise[1], 1.5, flex));
    orc.leftElbow.rotation.x = mix(bend[1], -2.1, flex) + Math.sin(t * 15) * .16 * flex;
    orc.neck.rotation.y = step * .15 * jig;
    orc.head.rotation.set(-.12 * jig + pump * .07 * jig - .25 * pulse(t, 1.45, 1.95), step * .2 * jig, step * .14 * jig + wobble(t, TOUCH, 30, 9) * .06);
    orc.idle(t, 1 - jig * .5);
    let k = 1;
    while (k < T.face.length - 1 && t > T.face[k][0]) k += 1;
    const [a, from] = T.face[k - 1], [b, to] = T.face[k];
    for (let i = 0; i < 6; i++) face[i] = mix(from[i], to[i], smooth(range(t, a, b)));
    const waggle = Math.sin(t * 24) * range(t, FLEX + .2, FLEX + .35) * .45;
    orc.face({ jaw: face[0] + Math.abs(pump) * .25 * jig, squint: face[1], smile: face[2], brow: face[3] + waggle, frown: face[4], flare: face[5] });
    orc.grip('both', mix(.35, 1, clamp(range(t, 1, 1.3) - pulse(t, 1.5, 1.95) * .8)));
    orc.plantFeet();
  }

  function render(t) {
    pose(t);
    fireworks.update(t);
    const flash = fireworks.flash(t);
    orc.hips.getWorldPosition(point);
    const height = orc.root.position.y;
    shadow.position.set(point.x, .01, point.z + .1);
    shadow.scale.set(2.4, 1.25, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    shadow.material.opacity = .35 * range(height, -1, 0) * (1 - clamp(height) * .5);
    const ground = range(t, TOUCH, TOUCH + .5);
    dust.visible = ground > 0 && ground < 1;
    dust.scale.setScalar(.6 + smooth(ground) * 2.2);
    dust.material.opacity = .5 * (1 - ground);
    halo.material.opacity = .12 + flash * .3;
    halo.scale.setScalar(1.3 + flash * .15);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + flash * 12;
    const thud = pulse(t, .9, 1.1) * .04 + pulse(t, TOUCH, TOUCH + .25) * .06;
    camera.position.x = .25 + Math.sin(t * 90) * flash * .02;
    camera.position.y = camY + Math.sin(t * 75) * thud;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose };
}
