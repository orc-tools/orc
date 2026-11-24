import {
  CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, TorusGeometry,
  Vector3,
} from 'three';
import { createOrc } from './orc-model.js';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';

const SHEET_HEIGHT = 1.75;
// The paper falls under gravity and snaps taut at the end.
const UNROLL = [1.84, 2.1];
const LANDS = 2.55;
const RELEASE = 3.22;
const FLIGHT = [RELEASE, 4.1];
// Sheet width at `front`.
const END_WIDTH = 1.843;
const UPPER_ARM = .64;
const FOREARM = .89;

// Smoothstep through [time, value, time, value, ...].
const track = (t, keys) => {
  let i = 2;
  while (i < keys.length - 2 && t > keys[i]) i += 2;
  return mix(keys[i - 1], keys[i + 1], smooth(range(t, keys[i - 2], keys[i])));
};

// Rod height, depth and tilt in chest space: clutched to the chest, flung up
// to peek over, lowered to present, wound back, then thrust at the viewer.
const ROD_Y = [0, .42, 1.55, .42, 1.72, .6, 1.9, 1.1, 2.38, 1.04, 2.52, .62, 2.92, .64, 3.1, .52, 3.26, .66];
const ROD_Z = [0, .8, 1.55, .8, 1.72, .7, 1.9, 1.02, 2.38, 1, 2.52, 1.1, 2.92, 1.08, 3.1, .98, 3.26, 1.55];
const TILT = [0, 0, 1.75, 0, 1.86, .14, 2.02, 0];
// Gaze leads, the head and chest follow it a beat later.
const GLANCE = [0, 0, .45, -.8, .6, .8, .75, 0, .98, -1, 1.18, -1, 1.28, 1, 1.46, 1, 1.56, 0];
const CROUCH = [0, -.12, .8, -.08, .95, -.3, 1.2, -.06, 1.55, -.08, 1.72, -.3, 1.88, .03, 2.05, -.1, 2.38, -.16, 2.5, .02, 2.62, -.1, 2.8, -.02, 2.95, -.02, 3.12, -.24, 3.28, -.2];
const LEAN = [0, .28, 1.55, .22, 1.72, .32, 1.9, -.06, 2.2, .1, 2.38, .1, 2.52, -.12, 2.92, -.08, 3.1, -.2, 3.28, .2, 3.6, .04];
const NOD = [0, -.25, 1.55, -.2, 1.72, -.28, 1.9, .06, 2.2, .08, 2.38, .04, 2.5, -.16, 2.6, -.16, 2.72, .16, 2.86, -.06, 3.1, -.02, 3.28, -.22];
const JAW = [0, 0, 1.75, 0, 1.85, .5, 2, .35, 2.1, .05, 2.42, .05, 2.52, .28, 2.95, .25, 3.08, .05, 3.2, .8, 3.45, .65, 3.8, .35];
const BROW = [0, -.1, 1.5, -.1, 1.62, .85, 1.75, .3, 1.86, 1, 2.05, .6, 2.42, .6, 2.52, .55, 2.95, .4, 3.08, -.1, 3.2, 1, 3.6, .7];
const SQUINT = [0, .45, .95, .5, 1.5, .55, 1.62, .2, 1.75, .35, 1.86, 0, 2.1, .35, 2.4, .3, 2.52, .3, 2.95, .25, 3.08, .65, 3.2, 0];
const SMILE = [0, .25, 1.5, .15, 1.65, .75, 1.86, .45, 2.1, .9, 2.52, 1];
const FROWN = [0, .9, 1.5, 1, 1.62, -.1, 1.86, -.2, 2.52, -.3, 2.95, -.3, 3.08, .3, 3.2, -.4];
const GAZE_Y = [0, .05, 1.75, 0, 1.88, -.7, 2.05, -.6, 2.15, 0, 2.68, 0, 2.76, -.55, 2.88, -.55, 2.96, 0];

export function createPlanScene(container, title) {
  const { canvas, scene, camera, glow, renderer, dispose, warm } = createStage(container);
  const orc = createOrc();
  scene.add(orc.root);
  const shadow = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .2, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.6, .9, 1);
  shadow.position.set(0, .01, .1);
  scene.add(shadow);
  const halo = new Mesh(new TorusGeometry(2.15, .022, 5, 64), new MeshBasicMaterial({ color: 0xb0d581, transparent: true, opacity: .3 }));
  halo.position.set(0, 2, -1.6);
  scene.add(halo);

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = 512;
  sheetCanvas.height = 384;
  const ctx = sheetCanvas.getContext('2d');
  ctx.fillStyle = '#e8e3c9';
  ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = '#345144';
  ctx.font = 'bold 40px system-ui';
  ctx.fillText('THE PLAN', 40, 70);
  ctx.font = 'bold 24px system-ui';
  wrap(title.trim(), 432, 2).forEach((line, i) => ctx.fillText(line, 40, 116 + i * 30));
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = '#728f45';
    ctx.lineWidth = 4;
    ctx.strokeRect(42, 190 + i * 36, 18, 18);
    ctx.beginPath();
    ctx.moveTo(45, 199 + i * 36);
    ctx.lineTo(51, 205 + i * 36);
    ctx.lineTo(64, 186 + i * 36);
    ctx.stroke();
    ctx.fillStyle = i % 2 ? '#a1a695' : '#818f7d';
    ctx.fillRect(78, 194 + i * 36, 250 + Math.sin(i * 3) * 80, 10);
  }
  const texture = new CanvasTexture(sheetCanvas);
  texture.colorSpace = SRGBColorSpace;

  // The top rod sits in the fists; `hang` swings the sheet and bottom rod
  // from it like a pendulum.
  const scroll = new Group();
  const hang = new Group();
  scroll.add(hang);
  const sheet = new Mesh(new PlaneGeometry(1, SHEET_HEIGHT), new MeshStandardMaterial({ map: texture, roughness: .92, side: DoubleSide }));
  sheet.castShadow = true;
  hang.add(sheet);
  const wood = new MeshStandardMaterial({ color: 0x6a4630, roughness: .7 });
  const gold = new MeshStandardMaterial({ color: 0xe4ad46, roughness: .35, metalness: .78 });
  const rodShape = new CylinderGeometry(.075, .075, 1, 14);
  const knobShape = new SphereGeometry(.11, 14, 10);
  const rods = [scroll, hang].map(parent => {
    const rod = new Group();
    const shaft = new Mesh(rodShape, wood);
    shaft.rotation.z = Math.PI / 2;
    shaft.castShadow = true;
    const knobs = [-1, 1].map(side => {
      const knob = new Mesh(knobShape, gold);
      knob.userData.side = side;
      rod.add(knob);
      return knob;
    });
    rod.add(shaft);
    parent.add(rod);
    return { rod, shaft, knobs };
  });
  // Paper still wound on the bottom rod; it thins as the sheet pays out.
  const roll = new Mesh(new CylinderGeometry(1, 1, 1, 18), new MeshStandardMaterial({ color: 0xd9d2b0, roughness: .9 }));
  roll.rotation.z = Math.PI / 2;
  roll.castShadow = true;
  rods[1].rod.add(roll);
  scene.add(scroll);
  const casters = [sheet, roll, ...rods.map(({ shaft }) => shaft)];

  const sparks = new Group();
  const flecks = [];
  const chipGeometry = new IcosahedronGeometry(.045, 0);
  const chipMaterials = [0xdbe6a1, 0xe8b65c, 0xfff1ce].map(color => new MeshBasicMaterial({ color }));
  for (let i = 0; i < 42; i++) {
    const mesh = new Mesh(chipGeometry, chipMaterials[i % 3]);
    const angle = i * 2.39996;
    const side = i % 2 ? 1 : -1;
    flecks.push({ mesh, side, x: side * Math.abs(Math.cos(angle)), y: Math.sin(angle) * .8 + .55, speed: .8 + (i % 6) * .3 });
    sparks.add(mesh);
  }
  scene.add(sparks);

  const left = new Vector3();
  const right = new Vector3();
  const held = new Vector3();
  const released = new Vector3();
  const heldTurn = new Quaternion();
  const releasedTurn = new Quaternion();
  const square = new Quaternion();
  const basis = new Matrix4();
  const across = new Vector3();
  const up = new Vector3();
  const facing = new Vector3();
  // Centred on the camera's line of sight, about half the view tall: the
  // overlay in the send-offs plugin pushes in on it from there.
  const front = new Vector3(.25, 3.45, 6);
  const ik = {
    target: new Vector3(), reach: new Vector3(), pole: new Vector3(), x: new Vector3(), r: new Vector3(), n: new Vector3(),
    lx: new Vector3(1, 0, 0), lr: new Vector3(), ln: new Vector3(), world: new Matrix4(), local: new Matrix4(), turn: new Quaternion(),
  };

  // Two-bone arm IK in chest space: lands the fist's grip on `target` with
  // the elbow bowed toward `pole`.
  function reachArm(arm, elbow, target, pole) {
    const { reach, x, r, n, lx, lr, ln } = ik;
    reach.copy(target).sub(arm.position);
    const d = Math.min(Math.max(reach.length(), UPPER_ARM - FOREARM + .3), UPPER_ARM + FOREARM - .001);
    const bend = Math.PI - Math.acos((UPPER_ARM ** 2 + FOREARM ** 2 - d * d) / (2 * UPPER_ARM * FOREARM));
    lr.set(0, -(UPPER_ARM + FOREARM * Math.cos(bend)), FOREARM * Math.sin(bend)).normalize();
    ln.crossVectors(lx, lr);
    r.copy(reach).normalize();
    n.copy(pole).addScaledVector(r, -pole.dot(r)).normalize();
    x.crossVectors(r, n);
    ik.world.makeBasis(x, r, n);
    ik.local.makeBasis(lx, lr, ln).transpose();
    arm.quaternion.setFromRotationMatrix(ik.world.multiply(ik.local));
    elbow.rotation.set(-bend, 0, 0);
  }

  // Twists the wrist so the rod running along chest x lies along the fist's
  // curl axis; a rod is symmetric, so never twist past a quarter turn.
  function wristTwist(arm, elbow) {
    ik.turn.copy(arm.quaternion).multiply(elbow.quaternion).invert();
    const d = ik.reach.set(1, 0, 0).applyQuaternion(ik.turn);
    let angle = Math.atan2(d.x, d.z);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    return angle;
  }

  function pose(t) {
    orc.reset();
    const rise = range(t, .1, .85);
    const settle = smooth(range(t, .1, .9));
    const lunge = smooth(range(t, 3.08, 3.24));
    orc.root.position.set(0, mix(-2.4, 0, back(rise, 1.4)), mix(-1.8, 0, settle));
    orc.root.rotation.x = mix(.35, 0, settle);
    orc.root.rotation.y = Math.sin(t * 1.6) * .04;
    // Clambers up through the page, one knee at a time.
    orc.feet.left.set(0, .55 * pulse(t, .3, .8), .35 * pulse(t, .3, .8));
    orc.feet.right.set(0, .3 * pulse(t, .55, .92) + .22 * pulse(t, 3.06, 3.26), .2 * pulse(t, .55, .92) + .55 * lunge);
    orc.hips.position.y += track(t, CROUCH);
    orc.hips.position.x = Math.sin(t * 2.4) * .05 * range(t, 2.55, 2.8);
    orc.hips.position.z = .3 * lunge - .1 * pulse(t, 2.9, 3.15);
    orc.hips.rotation.y = .08 * track(t - .16, GLANCE);
    orc.spine.rotation.x = track(t, LEAN);
    orc.chest.rotation.y = .16 * track(t - .12, GLANCE);
    orc.head.rotation.x = track(t, NOD);
    orc.head.rotation.y = .5 * track(t - .08, GLANCE);
    orc.head.rotation.z = .12 * Math.sin(range(t, 2.1, 2.4) * Math.PI * 4) + .08 * range(t, 2.42, 2.55) - .08 * range(t, 2.9, 3.1);

    const jolt = wobble(t, UNROLL[1], 14, 6);
    const y = track(t, ROD_Y) - .12 * jolt + .04 * wobble(t, 2.5, 12, 7);
    const z = track(t, ROD_Z);
    const tilt = track(t, TILT);
    const free = smooth(range(t, RELEASE + .08, RELEASE + .36));
    const open = smooth(range(t, RELEASE, RELEASE + .1));
    [[orc.leftArm, orc.leftElbow, orc.leftHand, -1], [orc.rightArm, orc.rightElbow, orc.rightHand, 1]].forEach(([arm, elbow, hand, side]) => {
      ik.target.set(mix(side * 1.0, side * 1.6, free), mix(y - side * tilt, 1.35, free), mix(z, .62, free));
      reachArm(arm, elbow, ik.target, ik.pole.set(side * .8, -1, -.3));
      // Jazz hands once the scroll is away.
      hand.rotation.set(-.4 * open, mix(wristTwist(arm, elbow), -side * .7, open), .3 * Math.sin(t * 38) * free);
    });

    orc.idle(t);
    const peek = range(t, 2.1, 2.4);
    orc.face({
      jaw: track(t, JAW),
      blink: pulse(t, .88, 1.02),
      squint: track(t, SQUINT),
      brow: track(t, BROW) + .5 * Math.sin(peek * Math.PI * 4) * pulse(t, 2.08, 2.42),
      frown: track(t, FROWN),
      smile: track(t, SMILE),
      look: [track(t, GLANCE), track(t, GAZE_Y)],
      flare: pulse(t, 3, 3.3),
    });
    orc.grip('both', 1 - open);
    orc.plantFeet();

    orc.leftGrip.getWorldPosition(left);
    orc.rightGrip.getWorldPosition(right);
    held.copy(left).add(right).multiplyScalar(.5);
    across.copy(right).sub(left);
    const span = across.length();
    across.normalize();
    up.set(0, 1, 0).addScaledVector(across, -across.y).normalize();
    facing.crossVectors(across, up);
    heldTurn.setFromRotationMatrix(basis.makeBasis(across, up, facing));
    return span;
  }

  const burst = new Vector3();

  function render(t) {
    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    let span;
    if (t > RELEASE) {
      span = pose(RELEASE);
      released.copy(held);
      releasedTurn.copy(heldTurn);
      pose(t);
    } else {
      span = pose(t);
      released.copy(held);
      releasedTurn.copy(heldTurn);
    }
    const unroll = range(t, UNROLL[0], UNROLL[1]) ** 2;
    const stretch = 1 + .05 * wobble(t, UNROLL[1], 18, 7) * (1 - lift);
    const height = SHEET_HEIGHT * Math.max(.06, unroll) * stretch;
    const width = mix(span - .26, END_WIDTH, lift);
    const rodLength = mix(span + .42, END_WIDTH + .1, lift);
    scroll.position.lerpVectors(released, front, lift);
    scroll.position.y += Math.sin(lift * Math.PI) * .35;
    scroll.quaternion.slerpQuaternions(releasedTurn, square, lift);
    scroll.scale.setScalar(mix(1, 1.25, lift));
    // Swings from the jolt, the stop and the thrust, then flutters in flight.
    hang.rotation.x = (.08 + .22 * wobble(t, UNROLL[1], 9, 4) - .16 * wobble(t, 2.5, 8, 4)
      - .2 * pulse(t, 2.9, 3.15) + .14 * pulse(t, 3.15, 3.4) + .18 * Math.sin(t * 13) * pulse(t, 3.3, 4)) * (1 - lift);
    sheet.scale.x = width;
    sheet.scale.y = height / SHEET_HEIGHT;
    sheet.position.y = -height / 2;
    texture.repeat.y = Math.min(1, sheet.scale.y);
    texture.offset.y = 1 - texture.repeat.y;
    rods.forEach(({ rod, shaft, knobs }, index) => {
      rod.position.y = index === 0 ? .02 : -height - .02;
      rod.position.z = .04;
      shaft.scale.y = rodLength;
      knobs.forEach(knob => { knob.position.x = knob.userData.side * rodLength / 2; });
    });
    const wound = Math.sqrt(.075 ** 2 + .024 * (1 - unroll));
    roll.visible = unroll < 1;
    roll.scale.set(wound, width, wound);
    // In flight toward the camera its shadow lands as a dark slab by the bottom edge.
    casters.forEach(mesh => { mesh.castShadow = t <= RELEASE; });

    const age = Math.max(0, t - LANDS);
    flecks.forEach(({ mesh, side, x, y, speed }, i) => {
      mesh.visible = age > 0 && age < 1.1;
      burst.set(side * 1.05, 2.72, 1.15);
      mesh.position.set(burst.x + x * age * speed * 2.6, burst.y + y * age * speed * 2.4 - age * age * 2.6, burst.z + .2 + age * (i % 4) * .4);
      mesh.rotation.set(age * 8, i, age * 5);
      mesh.scale.setScalar((1 - clamp(age / 1.1)) * (i % 3 + 1));
    });
    const bounce = pulse(t, LANDS - .1, LANDS + .3);
    const grounded = smooth(range(t, .55, .9));
    shadow.material.opacity = .2 * grounded;
    shadow.position.z = .1 + .15 * smooth(range(t, 3.08, 3.24));
    halo.material.opacity = .2 * Math.sin(grounded * Math.PI) + .06 + bounce * .3;
    halo.scale.setScalar(1 + range(t, .2, 1.5) * .4 + bounce * .15);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + bounce * 18;
    camera.position.x = .25 + Math.sin(t * 90) * bounce * .03;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([texture]) };
}

function wrap(text, width, lines) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = 'bold 24px system-ui';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > lines) out.splice(lines - 1, out.length, `${out[lines - 1]}…`);
  return out;
}
