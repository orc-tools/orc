// The orbit cast for Yeet, PR opened, Plan reveal and All settled: a small
// round astronaut on a launch pad, with a ringed planet in the sky, a
// satellite turning overhead and a rocket on its gantry. The astronaut loads
// the page aboard the rocket and waves it off, slings the PR into orbit, files
// a flight plan and plants a flag. Every scene hits the beats ui/js/scene-poses.js
// times its overlay to.
import {
  BackSide, BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, ConeGeometry,
  CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, Points, PointsMaterial,
  Quaternion, RingGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, fall, keys, mix, out, pulse, range, smooth, whip, wobble } from '../../ui/yeet/stage.js';
import { contactShadow, createFlecks, fling, keysV, paint, sample, wrap } from '../../ui/yeet/cast.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const AMBER = 0xffb347;
const HULL = 0xeef0f4;
const FLARE = 0xe8590c;
const PLANET = 0x2b5aa8;
const RING = 0xffd59a;
const INK = 0x1b1f2e;
const STEEL = 0x3a4357;
const CYAN = 0x5fd4f0;
const PAPER = '#f6eedb';
const PRINT = '#121110';
const UP = new Vector3(0, 1, 0);
const FRONT = new Vector3(0, 0, 1);

// Cool starlight on the rim and the warning lamp's amber in place of the
// swamp green.
function dress({ scene, key, glow }) {
  scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xe4ecff);
      light.groundColor.set(0x262b3d);
    } else if (light.isDirectionalLight && light !== key && light.position.z < 0) light.color.set(0x9fbcff);
  });
  key.color.set(0xfff1dc);
  glow.color.set(AMBER);
}

// An inverted hull behind `mesh`, so white parts keep an inked edge on the
// pale flight-manual paper.
function inked(mesh, ink, x = 1.06, y = x, z = x) {
  const hull = new Mesh(mesh.geometry, ink);
  hull.scale.set(x, y, z);
  mesh.add(hull);
  mesh.castShadow = true;
  return mesh;
}

// A low-gravity body from its hops ([take-off, length, height]) and any other
// touchdowns ([time, weight]): the lift hangs at the top of each hop longer
// than a parabola, with a crouch before it, a stretch off the ground and a
// squash on landing that rings out.
function bounce(t, hops, landings = []) {
  let lift = 0, squash = 1, spring = 0, tuck = 0;
  for (const [at, length, height] of hops) {
    const u = range(t, at, at + length), end = at + length, w = Math.min(height, .5);
    lift += height * (1 - (1 - 4 * u * (1 - u)) ** 2);
    tuck += Math.sin(Math.PI * u) * w * 2;
    squash += -w * .5 * pulse(t, at - .16, at + .02) + w * .35 * pulse(t, at, at + length * .45)
      - w * .55 * pulse(t, end - .02, end + .2) + w * .3 * wobble(t, end + .18, 15, 6);
    spring += (wobble(t, end, 12, 4) - .6 * wobble(t, at, 12, 4)) * w * 1.8;
  }
  for (const [at, w] of landings) {
    squash += -w * .55 * pulse(t, at - .02, at + .22) + w * .3 * wobble(t, at + .2, 15, 6);
    spring += wobble(t, at, 12, 4) * w * 1.8;
  }
  return { lift, squash, spring, tuck: Math.min(1, tuck) };
}

const blinks = (t, times) => times.reduce((most, at) => Math.max(most, pulse(t, at, at + .16)), 0);

// A dome of stars behind the stage, placed by stride so every replay runs the
// same.
function starfield() {
  const positions = [];
  for (let i = 0; i < 260; i++) {
    const around = (i * 2.399963) % (Math.PI * 2);
    const up = 0.08 + ((i * 0.618034) % 1) * 1.3;
    const far = 26 + (i * 13) % 9;
    positions.push(Math.cos(around) * far * 1.3, Math.sin(up) * far * 0.55 + 1, -Math.abs(Math.sin(around)) * far - 8);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(geometry, new PointsMaterial({
    color: 0xffffff, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
  }));
}

function planet() {
  const world = new Group();
  const body = new Mesh(new SphereGeometry(3.2, 40, 24), new MeshStandardMaterial({
    color: PLANET, roughness: 0.75, emissive: PLANET, emissiveIntensity: 0.25,
  }));
  const ring = new Mesh(new RingGeometry(4.1, 5.6, 64), new MeshBasicMaterial({
    color: RING, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false,
  }));
  ring.rotation.x = Math.PI / 2.35;
  ring.rotation.y = 0.25;
  world.add(body, ring);
  world.position.set(7.5, 6.4, -16);
  return world;
}

function satellite() {
  const craft = new Group();
  const panel = new MeshStandardMaterial({ color: 0x1f4f8a, roughness: 0.3, metalness: 0.6, emissive: 0x0b2a50, emissiveIntensity: 0.4 });
  const gold = new MeshStandardMaterial({ color: 0xd4a640, roughness: 0.35, metalness: 0.8 });
  craft.add(new Mesh(new BoxGeometry(0.5, 0.5, 0.6), gold));
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(1.3, 0.04, 0.46), panel);
    wing.position.x = side * 0.95;
    craft.add(wing);
  }
  const dish = new Mesh(new ConeGeometry(0.26, 0.18, 16, 1, true), new MeshStandardMaterial({ color: HULL, side: DoubleSide }));
  dish.position.y = 0.36;
  craft.add(dish);
  craft.position.set(-5.2, 5.6, -7);
  return craft;
}

// The rocket stands on a plinth beside its gantry. `ship` is everything that
// flies: its origin is the plinth's top, and a hatch on the side faces `hatch`
// radians round from the camera.
function rocket(ink, hatchTurn = Math.PI / 2) {
  const pad = new Group();
  const ship = new Group();
  ship.position.y = .2;
  pad.add(ship);
  const hull = new MeshStandardMaterial({ color: HULL, roughness: 0.4, metalness: 0.15 });
  const flare = new MeshStandardMaterial({ color: FLARE, roughness: 0.45 });
  const steel = new MeshStandardMaterial({ color: STEEL, roughness: 0.6, metalness: 0.5 });
  const dark = new MeshStandardMaterial({ color: 0x1d2130, roughness: .6 });
  const body = inked(new Mesh(new CylinderGeometry(0.42, 0.48, 3, 24), hull), ink, 1.05, 1.01, 1.05);
  body.position.y = 1.8;
  const nose = inked(new Mesh(new ConeGeometry(0.42, 1, 24), flare), ink, 1.06, 1.03, 1.06);
  nose.position.y = 3.8;
  const band = new Mesh(new CylinderGeometry(0.49, 0.49, 0.2, 24), flare);
  band.position.y = .75;
  const nozzle = new Mesh(new CylinderGeometry(.2, .3, .3, 18), steel);
  nozzle.position.y = .15;
  ship.add(body, nose, band, nozzle);
  for (let fin = 0; fin < 3; fin++) {
    const turn = new Group();
    turn.rotation.y = fin * Math.PI * 2 / 3 + .5;
    const blade = inked(new Mesh(new BoxGeometry(0.06, 0.9, 0.55), flare), ink, 1.5, 1.04, 1.06);
    blade.position.set(0, 0.6, 0.62);
    turn.add(blade);
    ship.add(turn);
  }
  // The round hatch the page goes in by, and a porthole above it.
  const side = new Group();
  side.rotation.y = hatchTurn;
  ship.add(side);
  const hole = new Mesh(new CircleGeometry(.17, 24), dark);
  hole.position.set(0, 1.6, .459);
  const hinge = new Group();
  hinge.position.set(-.17, 1.6, .47);
  const door = new Mesh(new CylinderGeometry(.18, .18, .035, 24), flare);
  door.rotation.x = Math.PI / 2;
  door.position.x = .17;
  hinge.add(door);
  const port = new Mesh(new CylinderGeometry(.12, .12, .04, 20), new MeshStandardMaterial({ color: CYAN, roughness: .2, emissive: 0x1d6f86, emissiveIntensity: .6 }));
  port.rotation.x = Math.PI / 2;
  port.position.set(0, 2.55, .44);
  const rim = new Mesh(new TorusGeometry(.13, .03, 8, 24), flare);
  rim.position.set(0, 2.55, .46);
  side.add(hole, hinge, port, rim);
  const plume = new ConeGeometry(.26, 1, 18, 1, true).rotateX(Math.PI).translate(0, -.5, 0);
  const flame = new Mesh(plume, new MeshBasicMaterial({ color: 0xffa940, transparent: true, opacity: .92, toneMapped: false, side: DoubleSide, depthWrite: false }));
  const core = new Mesh(plume, new MeshBasicMaterial({ color: 0xfff1c0, toneMapped: false, side: DoubleSide }));
  core.scale.set(.55, .6, .55);
  flame.add(core);
  flame.visible = false;
  ship.traverse(part => { if (part.isMesh && part.material !== ink) part.castShadow = true; });
  ship.add(flame);

  const plinth = new Mesh(new CylinderGeometry(.9, 1.02, .2, 28), steel);
  plinth.position.y = .1;
  plinth.receiveShadow = true;
  const gantry = new Mesh(new BoxGeometry(0.22, 5.2, 0.22), steel);
  gantry.position.set(-1.0, 2.6, -0.15);
  gantry.castShadow = true;
  const arms = [1.5, 2.6, 3.5].map(y => {
    const swing = new Group();
    swing.position.set(-1.0, y, -.15);
    const arm = new Mesh(new BoxGeometry(0.62, 0.08, 0.1), steel);
    arm.position.x = .31;
    swing.add(arm);
    pad.add(swing);
    return swing;
  });
  const light = new Mesh(new SphereGeometry(0.1, 12, 8), new MeshBasicMaterial({ color: AMBER, toneMapped: false }));
  light.position.set(-1.0, 5.3, -0.15);
  pad.add(plinth, gantry, light);
  pad.position.set(-4.3, 0, -3.2);
  return { pad, ship, hinge, hole, flame, light, arms };
}

function createSet(scene, ink, { at = [-4.3, 0, -3.2], size = 1, hatch } = {}) {
  const stars = starfield();
  const world = planet();
  const craft = satellite();
  const launch = rocket(ink, hatch);
  launch.pad.position.set(...at);
  launch.pad.scale.setScalar(size);
  scene.add(stars, world, craft, launch.pad);
  return {
    ...launch,
    update(t, hurry = 0) {
      stars.material.opacity = 0.75 + Math.sin(t * 2.3) * 0.15;
      world.rotation.y = t * 0.06;
      craft.rotation.set(Math.sin(t * 0.7) * 0.25, t * 0.5, Math.sin(t * 0.5) * 0.15);
      craft.position.y = 5.6 + Math.sin(t * 0.9) * 0.2;
      launch.light.visible = Math.sin(t * (6 + hurry * 14)) > -0.2;
    },
  };
}

const ARM = .32;
const LEG = .25;
// Body space has the boots on the floor at y = 0. The torso turns about the
// hips at PIVOT; a flip turns the whole body about CENTRE.
const PIVOT = .55;
const CENTRE = 1.05;
const NECK = .87;
const HELMET = .38;
const VISOR = { width: 2.2, top: .9, tall: 1.2 };

const FACE = { blink: 0, happy: 0, wide: 0, squint: 0, lx: 0, ly: 0, smile: .5, open: 0 };
const mood = values => ({ ...FACE, ...values });

// A short round spacewalker. Hands are placed in torso space and boots in
// body space; two-bone IK fits the limbs between. The visor is the face: two
// highlights for eyes that blink, squint, widen and close happy, and a small
// reflected mouth under them.
function createAstronaut(ink) {
  const suit = new MeshStandardMaterial({ color: HULL, roughness: .6 });
  const trim = new MeshStandardMaterial({ color: FLARE, roughness: .5 });
  const joint = new MeshStandardMaterial({ color: 0xb7bfcf, roughness: .65 });
  const dark = new MeshStandardMaterial({ color: 0x272c3c, roughness: .5 });
  // Low metalness and a little glow: the software renderer has no environment
  // map for a metal visor to reflect, and it would go black.
  const glass = new MeshStandardMaterial({ color: AMBER, roughness: .5, metalness: .1, emissive: 0x9a5208, emissiveIntensity: .55 });
  const shine = new MeshBasicMaterial({ color: 0xfff7e2, toneMapped: false });
  const closed = new MeshBasicMaterial({ color: 0xfff7e2, toneMapped: false, transparent: true, depthWrite: false });
  const lips = new MeshBasicMaterial({ color: 0x5a2a06 });
  const glint = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: .55, depthWrite: false });
  const lamp = color => new MeshBasicMaterial({ color, toneMapped: false });

  const root = new Group();
  const squash = new Group();
  root.add(squash);
  const flip = new Group();
  flip.position.y = CENTRE;
  squash.add(flip);
  const body = new Group();
  body.position.y = -CENTRE;
  flip.add(body);
  const hips = new Group();
  hips.position.y = PIVOT;
  body.add(hips);
  const torso = new Group();
  hips.add(torso);

  const shell = inked(new Mesh(new SphereGeometry(.5, 32, 24), suit), ink, 1.05);
  shell.scale.set(1, 1, .9);
  shell.position.y = .43;
  const belt = new Mesh(new TorusGeometry(.425, .055, 10, 40), trim);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, .9, 1);
  belt.position.y = .17;
  const panel = new Mesh(new BoxGeometry(.32, .19, .07), dark);
  panel.position.set(0, .5, .42);
  panel.rotation.x = -.18;
  const lights = [AMBER, 0x7be0a0, FLARE].map((color, i) => {
    const bulb = new Mesh(new SphereGeometry(.027, 10, 8), lamp(color));
    bulb.position.set((i - 1) * .085, .51, .465);
    return bulb;
  });
  const pack = inked(new Mesh(new BoxGeometry(.6, .66, .26), suit), ink, 1.06);
  pack.position.set(0, .45, -.47);
  const stripe = new Mesh(new BoxGeometry(.62, .07, .28), trim);
  stripe.position.set(0, .63, -.47);
  const nozzles = [-1, 1].map(side => {
    const nozzle = new Mesh(new CylinderGeometry(.045, .075, .12, 12), dark);
    nozzle.position.set(side * .16, .07, -.47);
    return nozzle;
  });
  const collar = new Mesh(new TorusGeometry(.27, .06, 10, 32), trim);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = NECK;
  torso.add(shell, belt, panel, ...lights, pack, stripe, ...nozzles, collar);

  const head = new Group();
  head.rotation.order = 'YXZ';
  head.position.y = NECK;
  torso.add(head);
  const helmet = inked(new Mesh(new SphereGeometry(.5, 36, 28), suit), ink, 1.045);
  helmet.position.y = HELMET;
  const { width, top, tall } = VISOR;
  const gasket = new Mesh(new SphereGeometry(.506, 36, 20, Math.PI / 2 - width / 2 - .08, width + .16, top - .07, tall + .14), dark);
  gasket.position.y = HELMET;
  const visor = new Mesh(new SphereGeometry(.514, 36, 20, Math.PI / 2 - width / 2, width, top, tall), glass);
  visor.position.y = HELMET;
  head.add(helmet, gasket, visor);
  const dir = new Vector3();
  function onVisor(object, across, up, radius = .521) {
    dir.set(Math.sin(across) * Math.cos(up), Math.sin(up), Math.cos(across) * Math.cos(up));
    object.position.copy(dir).multiplyScalar(radius);
    object.position.y += HELMET;
    object.quaternion.setFromUnitVectors(FRONT, dir);
  }
  const disc = new CircleGeometry(1, 28);
  const arc = new TorusGeometry(1, .24, 6, 20, Math.PI);
  const eyes = [-1, 1].map(side => {
    const eye = new Group();
    const open = new Mesh(disc, shine);
    const shut = new Mesh(arc, closed);
    eye.add(open, shut);
    head.add(eye);
    return { side, eye, open, shut };
  });
  const mouth = new Group();
  const grin = new Mesh(arc, lips);
  grin.rotation.z = Math.PI;
  const gasp = new Mesh(disc, lips);
  mouth.add(grin, gasp);
  head.add(mouth);
  const streak = new Mesh(disc, glint);
  onVisor(streak, -.62, .42, .52);
  streak.rotateZ(-.7);
  streak.scale.set(.085, .026, 1);
  const dot = new Mesh(disc, glint);
  onVisor(dot, -.42, .52, .52);
  dot.scale.setScalar(.022);
  head.add(streak, dot);
  for (const side of [-1, 1]) {
    const puck = inked(new Mesh(new CylinderGeometry(.12, .12, .09, 20), trim), ink, 1.1);
    puck.rotation.z = Math.PI / 2;
    puck.position.set(side * .49, HELMET, 0);
    head.add(puck);
  }
  const antenna = new Group();
  antenna.position.set(-.2, HELMET + .44, -.06);
  const rod = new Mesh(new CylinderGeometry(.016, .016, .36, 6), dark);
  rod.position.y = .18;
  const tip = new Mesh(new SphereGeometry(.05, 12, 8), lamp(FLARE));
  tip.position.y = .37;
  antenna.add(rod, tip);
  head.add(antenna);

  const ball = new SphereGeometry(1, 16, 12);
  const upperArm = new CapsuleGeometry(.1, ARM, 4, 12);
  const foreArm = new CapsuleGeometry(.095, ARM, 4, 12);
  const band = new TorusGeometry(.105, .03, 6, 18);
  const arms = [-1, 1].map(side => {
    const upper = inked(new Mesh(upperArm, suit), ink, 1.22, 1.03, 1.22);
    const stripe = new Mesh(band, trim);
    stripe.rotation.x = Math.PI / 2;
    upper.add(stripe);
    const lower = inked(new Mesh(foreArm, suit), ink, 1.22, 1.03, 1.22);
    const hand = new Group();
    const mitten = inked(new Mesh(ball, trim), ink, 1.12, 1.1, 1.14);
    mitten.scale.set(.125, .14, .105);
    mitten.position.y = .05;
    const thumb = inked(new Mesh(ball, trim), ink, 1.15);
    thumb.scale.setScalar(.055);
    thumb.position.set(0, .03, -.085);
    const cuff = new Mesh(band, joint);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -.05;
    hand.add(mitten, thumb, cuff);
    torso.add(upper, lower, hand);
    return { side, upper, lower, hand, from: new Vector3(side * .44, .64, 0), pole: new Vector3(side * .9, -.6, -.5) };
  });
  const thigh = new CapsuleGeometry(.12, LEG, 4, 12);
  const shin = new CapsuleGeometry(.115, LEG, 4, 12);
  const sole = new BoxGeometry(.3, .07, .44);
  const legs = [-1, 1].map(side => {
    const upper = inked(new Mesh(thigh, suit), ink, 1.2, 1.03, 1.2);
    const knee = new Mesh(new TorusGeometry(.125, .032, 6, 18), trim);
    knee.rotation.x = Math.PI / 2;
    knee.position.y = -.12;
    upper.add(knee);
    const lower = inked(new Mesh(shin, suit), ink, 1.2, 1.03, 1.2);
    const boot = new Group();
    const shoe = inked(new Mesh(ball, suit), ink, 1.08);
    shoe.scale.set(.165, .13, .22);
    shoe.position.set(0, -.02, .05);
    const tread = new Mesh(sole, dark);
    tread.position.set(0, -.115, .05);
    const toe = new Mesh(ball, trim);
    toe.scale.set(.13, .08, .09);
    toe.position.set(0, -.05, .2);
    boot.add(shoe, tread, toe);
    body.add(upper, lower, boot);
    return { side, upper, lower, boot, from: new Vector3(side * .19, .52, 0), pole: new Vector3(side * .25, 0, 1) };
  });

  const w = { r: new Vector3(), n: new Vector3(), elbow: new Vector3(), end: new Vector3(), d: new Vector3(), x: new Vector3(), z: new Vector3(), m: new Matrix4() };
  function bone(mesh, from, to) {
    mesh.position.addVectors(from, to).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(UP, w.d.subVectors(to, from).normalize());
  }
  function solve(limb, target, pole, length) {
    const { r, n, elbow, end } = w;
    r.subVectors(target, limb.from);
    const span = r.length() || 1e-6;
    const d = Math.min(Math.max(span, .08), length * 2 - .002);
    r.divideScalar(span);
    const cos = d / (2 * length);
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    n.copy(pole).addScaledVector(r, -pole.dot(r));
    if (n.lengthSq() < 1e-6) n.set(0, -r.z, r.y);
    n.normalize();
    elbow.copy(limb.from).addScaledVector(r, length * cos).addScaledVector(n, length * sin);
    end.copy(limb.from).addScaledVector(r, d);
    bone(limb.upper, limb.from, elbow);
    bone(limb.lower, elbow, end);
    return end;
  }

  return {
    root, torso, head, hips, arms, legs, nozzles,
    pose({ x = 0, y = 0, z = 0, yaw = 0, size = 1, squash: q = 1, flip: f = 0, roll = 0, lean = 0, tilt = 0, twist = 0, nod = 0, turn = 0, cock = 0, antenna: bend = 0 }) {
      root.position.set(x, y, z);
      root.rotation.set(0, yaw, 0);
      const girth = 1 / Math.sqrt(q);
      squash.scale.set(size * girth, size * q, size * girth);
      flip.rotation.set(f, 0, roll);
      hips.rotation.set(lean, 0, tilt);
      torso.rotation.y = twist;
      head.rotation.set(nod, turn, cock);
      antenna.rotation.set(0, 0, .3 + bend);
    },
    // `side` is -1 for the hand on screen left as it faces the camera.
    reach(side, target, pole) {
      const arm = arms[side < 0 ? 0 : 1];
      const end = solve(arm, target, pole || arm.pole, ARM);
      arm.hand.position.copy(end);
      const along = w.d.subVectors(end, w.elbow).normalize();
      w.x.crossVectors(along, w.n).normalize();
      w.z.crossVectors(w.x, along);
      arm.hand.quaternion.setFromRotationMatrix(w.m.makeBasis(w.x, along, w.z));
    },
    step(side, target, toe = 0, pole) {
      const leg = legs[side < 0 ? 0 : 1];
      leg.boot.position.copy(solve(leg, target, pole || leg.pole, LEG));
      leg.boot.rotation.set(toe, 0, 0);
    },
    face({ blink, happy, wide, squint, lx, ly, smile, open }) {
      const lid = Math.max(.07, (1 - blink) * (1 - .8 * squint) * (1 - happy));
      for (const { side, eye, open: oval, shut } of eyes) {
        onVisor(eye, side * .3 + lx * .14, .17 + ly * .1);
        eye.rotateZ(side * -.4 * squint);
        oval.scale.set(.082 * (1 + .25 * wide), .118 * (1 + .3 * wide) * lid, 1);
        shut.visible = happy > .02;
        shut.scale.setScalar(.075 * (1 + .2 * wide));
        shut.position.y = -.02;
      }
      closed.opacity = happy;
      onVisor(mouth, lx * .08, -.08 + ly * .06);
      grin.visible = open < .3;
      grin.scale.set(.055 * (.7 + .5 * Math.abs(smile)), .05 * (Math.abs(smile) < .15 ? .15 * Math.sign(smile || 1) : smile), .02);
      gasp.visible = !grin.visible;
      gasp.scale.set(.034 + .018 * open, .05 * open, 1);
    },
    tick(t) {
      lights.forEach((bulb, i) => { bulb.visible = Math.sin(t * 5 + i * 2.1) > -.35; });
      tip.scale.setScalar(.85 + .3 * Math.max(0, Math.sin(t * 4)));
    },
  };
}

const rest = (side, y = .12, z = .14) => [side * .57, y, z];

// A Matrix4 for a prop held in `parent`'s space, written into `object`.
const holding = { m: new Matrix4(), q: new Quaternion(), e: new Euler(), p: new Vector3(), one: new Vector3(1, 1, 1) };
function hold(object, parent, x, y, z, rx = 0, ry = 0, rz = 0, matrix = holding.m) {
  matrix.compose(holding.p.set(x, y, z), holding.q.setFromEuler(holding.e.set(rx, ry, rz)), holding.one).premultiply(parent.matrixWorld);
  matrix.decompose(object.position, object.quaternion, object.scale);
  return matrix;
}

function smokeParts() {
  const puff = new IcosahedronGeometry(1, 1);
  return {
    smoke: { geometry: puff, materials: [0xd9d4c8, 0xaab0bd, 0xf2ede2].map(color => new MeshStandardMaterial({ color, roughness: 1, flatShading: true })), size: .3 },
    dust: { geometry: puff, materials: [0xcfc7b2, 0x9aa0ad].map(color => new MeshStandardMaterial({ color, roughness: 1, flatShading: true })), size: .09 },
    spark: { geometry: new OctahedronGeometry(1, 0), materials: [AMBER, FLARE, 0xfff1c4].map(color => new MeshBasicMaterial({ color, toneMapped: false })), size: .07 },
  };
}

function twinkleTexture() {
  return paint(128, 128, ctx => {
    const shine = ctx.createRadialGradient(64, 64, 0, 64, 64, 44);
    shine.addColorStop(0, 'rgba(255,190,90,.9)');
    shine.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffb347';
    ctx.strokeStyle = '#a8440a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
      ctx.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff6dc';
    ctx.beginPath();
    ctx.arc(64, 64, 9, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Yeet. The rocket leaves the pad exactly when the send-offs plugin plays the line.
const LIFT = 3.32;
const SIZE = 1.15;
const PAD = { at: [-2.35, 0, .3], size: 1.08, hatch: 1.5 };
const FAR = new Vector3(4.5, 7.8, -14);
const ARRIVE = 2.3;
const CATCH = 2.58;
const DUNK = [2.96, 3.05];
const GONE = LIFT + 1.05;

// Beats: the astronaut drifts down onto the pad on its thrusters (0.2-1.05),
// bounces and waves (1.1-1.9), looks up for the page and catches the ball it
// has become (1.9-2.58), hops to the rocket and pushes it in through the hatch
// (2.8-3.05), hops clear (3.14-3.31), is blown back by the exhaust as the
// rocket lifts off (3.32), salutes it up into the sky (3.9-4.3) and waves it
// off as it twinkles out (4.37).
const Y = {
  hops: [[1.12, .3, .16], [2.8, .32, .4], [3.14, .17, .2], [3.34, .3, .1], [4.5, .3, .14]],
  landings: [[1.05, .75], [CATCH, .35], [3.36, .4]],
  descend: [[.2, 3.8], [1.05, 0, out]],
  x: [[0, .35], [ARRIVE, .38], [CATCH, .45], [2.68, .62, out], [2.8, .58], [3.12, -1.05], [3.14, -1.05], [3.31, .25], [3.33, .3], [3.75, 1.15, out]],
  z: [[0, 1.3], [2.8, 1.35], [3.12, .4], [3.14, .4], [3.31, 1.4], [3.75, 1.55, out]],
  yaw: [[0, .3], [1.05, .1], [1.45, 0], [1.9, 0], [2.15, .45], [CATCH, .38], [2.66, .3], [2.78, -1.0], [2.95, -1.64], [3.12, -1.64], [3.22, -1.1], [3.31, -.75], [3.6, -.6], [3.95, -.3], [4.4, -.15]],
  lean: [[0, -.05], [.95, 0], [1.05, .22, out], [1.3, 0], [1.9, 0], [2.2, -.12], [2.55, -.08], [2.63, -.32, out], [2.72, .05], [2.8, .22], [2.92, -.08], [3.02, .3, whip], [3.12, .12], [3.22, -.12], [3.31, .05], [3.38, -.52, out], [3.7, -.26], [3.95, -.04], [4.4, 0]],
  tilt: [[3.3, 0], [3.38, -.3, out], [3.7, -.12], [4, 0], [4.45, .08], [4.7, -.05], [4.95, 0]],
  twist: [[2.85, 0], [2.98, -.2], [3.04, .1], [3.12, 0]],
  nod: [[0, .3], [.9, .2], [1.05, .1], [1.3, -.05], [1.9, 0], [2.15, -.28], [2.5, -.12], [2.62, .12], [2.78, .05], [2.95, -.1], [3.1, .05], [3.31, 0], [3.4, .18], [3.65, .05], [3.9, -.38], [4.5, -.42], [4.8, -.3]],
  turn: [[1.4, 0], [1.9, 0], [2.15, .15], [2.6, 0], [3.31, 0], [3.42, .35], [3.7, .1], [3.9, -.45], [4.5, -.35], [4.9, -.2]],
  cock: [[1.45, 0], [1.6, .2], [1.85, .15], [2, 0], [3.9, 0], [4.05, .12], [4.4, .1], [4.6, -.1]],
  right: [[0, -.66, .5, .05], [.95, -.66, .45, .1], [1.08, -.6, .15, .22], [1.4, ...rest(-1)], [1.9, ...rest(-1)], [2.12, -.33, .72, .42], [2.42, -.33, .72, .45], [CATCH, -.19, .55, .56], [2.75, -.18, .45, .52], [2.82, -.18, .36, .48], [2.94, -.16, .82, .52], [3.02, -.14, .72, .68, whip], [3.1, -.5, .6, .3], [3.25, -.62, .72, .08], [3.32, -.62, .7, .1], [3.4, -.16, .92, .44, out], [3.7, -.2, .9, .44], [3.85, -.55, .3, .2], [4, -.45, 1.15, .3], [4.3, -.45, 1.15, .3], [4.45, -.6, .95, .22]],
  left: [[0, .66, .5, .05], [.95, .66, .45, .1], [1.08, .6, .15, .22], [1.4, ...rest(1)], [1.5, .62, .9, .2], [1.85, .62, .9, .2], [2, ...rest(1)], [2.12, .33, .72, .42], [2.42, .33, .72, .45], [CATCH, .19, .55, .56], [2.75, .18, .45, .52], [2.82, .18, .36, .48], [2.94, .16, .82, .52], [3.02, .14, .72, .68, whip], [3.1, .5, .6, .3], [3.25, .62, .72, .08], [3.32, .62, .7, .1], [3.4, .62, .5, -.28, out], [3.7, .6, .35, -.1], [3.9, .52, .08, .2]],
  face: [
    [0, mood({ ly: -.6, lx: -.1, smile: .3 })],
    [1, mood({ ly: -.7, smile: .2, wide: .3 })],
    [1.1, mood({ squint: .5, smile: .6 })],
    [1.3, mood({ smile: .7 })],
    [1.5, mood({ happy: 1, smile: 1 })],
    [1.85, mood({ happy: 1, smile: 1 })],
    [2, mood({ lx: .8, ly: .7, wide: .6, smile: .4, open: .4 })],
    [2.4, mood({ lx: .9, ly: .5, wide: .8, open: .5 })],
    [CATCH, mood({ lx: .2, ly: -.2, squint: .9, smile: .2 }), whip],
    [2.66, mood({ ly: -.7, wide: .3, smile: .8 })],
    [2.78, mood({ lx: -.9, ly: .2, wide: .2, smile: .6 })],
    [3, mood({ lx: -.6, ly: .1, squint: .5, smile: .8, open: .3 })],
    [3.12, mood({ lx: -.7, happy: .8, smile: 1 })],
    [3.3, mood({ lx: -.8, ly: .3, wide: 1, smile: .3, open: .6 })],
    [3.36, mood({ lx: -.5, squint: 1, open: .8, smile: 0 }), whip],
    [3.7, mood({ lx: -.5, squint: .8, open: .5 })],
    [3.85, mood({ lx: -.7, ly: .8, wide: .5, open: .7 })],
    [4, mood({ lx: -.6, ly: .8, happy: .9, smile: 1 })],
    [4.4, mood({ lx: -.5, ly: .7, happy: .9, smile: 1 })],
    [4.55, mood({ lx: -.2, ly: .3, happy: 1, smile: 1 })],
  ],
  blinks: [.62, 1.36, 2.22, 4.72],
};

function createLiftoffScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const ink = new MeshBasicMaterial({ color: INK, side: BackSide });
  const set = createSet(scene, ink, PAD);
  const astro = createAstronaut(ink);
  scene.add(astro.root);
  const shadow = contactShadow(scene, .3, 0x0a0e1a);

  const pageTexture = paint(512, 512, ctx => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = PRINT;
    ctx.font = 'bold 40px system-ui';
    ctx.fillText('CARGO', 38, 70);
    ctx.font = 'bold 24px system-ui';
    wrap(title.trim() || 'This run', 430, 2, ctx.font).forEach((line, i) => ctx.fillText(line, 38, 122 + i * 30));
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#b9ad92' : '#8f866f';
      ctx.fillRect(39, 200 + i * 44, 280 + Math.sin(i * 3) * 70, 10);
    }
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(38, 435, 150, 34);
  });
  textures.push(pageTexture);
  const page = new Mesh(new IcosahedronGeometry(.26, 1), new MeshStandardMaterial({ map: pageTexture, roughness: .95, flatShading: true }));
  page.castShadow = true;
  scene.add(page);

  const trailMaterials = Array.from({ length: 12 }, () => new MeshStandardMaterial({ color: 0xe9e4d8, roughness: 1, transparent: true, depthWrite: false }));
  const trail = trailMaterials.map(material => new Mesh(new IcosahedronGeometry(1, 1), material));
  scene.add(...trail);
  const twinkle = twinkleTexture();
  textures.push(twinkle);
  const star = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: twinkle, transparent: true, depthWrite: false }));
  scene.add(star);

  const parts = smokeParts();
  const exhaust = createFlecks(scene, 46, [parts.smoke]);
  const rumble = createFlecks(scene, 16, [parts.smoke]);
  const dust = createFlecks(scene, 26, [parts.dust]);
  const sparks = createFlecks(scene, 22, [parts.spark]);
  const puffs = createFlecks(scene, 18, [parts.dust]);

  scene.updateMatrixWorld(true);
  const hatch = set.hole.getWorldPosition(new Vector3());
  const base = set.pad.localToWorld(new Vector3(0, .25, 0));
  const groundBase = new Vector3(base.x, .1, base.z);
  // The flight runs in the pad's own space, from the plinth to FAR.
  const path = [new Vector3(0, .2, 0), new Vector3(0, 4.5, 0), new Vector3(1.5, 8.5, -5), set.pad.worldToLocal(FAR.clone())];
  const along = new Vector3(), heading = new Vector3(), temp = new Vector3();
  function flight(age, at) {
    const u = clamp(age / (GONE - LIFT)) ** 2.1;
    const [a, b, c, d] = path, v = 1 - u;
    at.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
    heading.subVectors(b, a).multiplyScalar(3 * v * v).addScaledVector(temp.subVectors(c, b), 6 * v * u).addScaledVector(temp.subVectors(d, c), 3 * u * u).normalize();
    return at;
  }

  const target = new Vector3();
  const hand = [new Vector3(), new Vector3()];
  const face = { ...FACE };
  const feet = new Vector3();
  const camY = camera.position.y;

  function pose(t) {
    const move = bounce(t, Y.hops, Y.landings);
    const wave = Math.sin(t * 15) * .13 * pulse(t, 1.5, 1.88);
    const waveOff = Math.sin(t * 13) * .15 * range(t, 4.45, 4.6);
    astro.pose({
      x: keys(t, Y.x), y: keys(t, Y.descend) + move.lift, z: keys(t, Y.z), yaw: keys(t, Y.yaw), size: SIZE,
      squash: move.squash, lean: keys(t, Y.lean) + Math.sin(t * 9) * .03 * pulse(t, 3.4, 3.9), tilt: keys(t, Y.tilt) + Math.sin(t * 2.4) * .04 * range(t, .3, .9) * (1 - range(t, .9, 1.05)),
      twist: keys(t, Y.twist), nod: keys(t, Y.nod), turn: keys(t, Y.turn), cock: keys(t, Y.cock) + wave * .4,
      antenna: move.spring + Math.sin(t * 31) * .25 * pulse(t, LIFT, 3.9) - .3 * pulse(t, .2, 1.05),
    });
    keysV(t, Y.right, target);
    target.x += waveOff;
    target.y += Math.sin(t * 40) * .04 * pulse(t, LIFT, 3.7);
    astro.reach(-1, target);
    keysV(t, Y.left, target);
    target.x += wave;
    astro.reach(1, target);
    const drift = 1 - range(t, .9, 1.05);
    for (const side of [-1, 1]) {
      const kick = side * Math.sin(t * 4 + side) * .05 * drift;
      astro.step(side, target.set(side * .2, .15 + move.tuck * .2 + drift * .05 + kick, .03 - move.tuck * .08), move.tuck * .3 - drift * .3);
    }
    sample(Y.face, t, face);
    face.blink = blinks(t, Y.blinks);
    astro.face(face);
    astro.tick(t);
    astro.root.updateMatrixWorld(true);
    astro.arms.forEach((arm, i) => arm.hand.getWorldPosition(hand[i]));
  }

  // Between both mittens, a little in front of them.
  function holdPoint(at) {
    at.addVectors(hand[0], hand[1]).multiplyScalar(.5);
    astro.torso.getWorldDirection(temp);
    return at.addScaledVector(temp, .1);
  }
  pose(DUNK[0]);
  const loaded = holdPoint(new Vector3());
  const start = new Vector3(2.3, 2.85, .9);

  function render(t) {
    pose(t);
    page.visible = t > ARRIVE && t < DUNK[1];
    if (t < CATCH) {
      const u = range(t, ARRIVE, CATCH);
      holdPoint(target);
      page.position.lerpVectors(start, target, out(u));
      page.position.y += Math.sin(u * Math.PI) * .35;
      page.scale.setScalar(SIZE * mix(.4, 1, back(range(t, ARRIVE, ARRIVE + .14), 2)));
      page.rotation.set(t * 9, t * 7, t * 4);
    } else if (t < DUNK[0]) {
      holdPoint(page.position);
      page.scale.setScalar(SIZE * (1 + .12 * wobble(t, CATCH, 22, 7)));
      page.rotation.set(CATCH * 9 + (t - CATCH) * 2, CATCH * 7, CATCH * 4);
    } else {
      const u = range(t, DUNK[0], DUNK[1]);
      page.position.lerpVectors(loaded, hatch, smooth(u));
      page.scale.setScalar(SIZE * mix(1, .55, u));
    }

    const age = t - LIFT;
    const ignite = smooth(range(t, 3.18, LIFT + .02));
    const shake = range(t, 3.06, LIFT) * (1 - range(t, LIFT + .3, LIFT + .7));
    const flying = age > 0 && age < GONE - LIFT;
    set.ship.visible = age < GONE - LIFT;
    if (age > 0) {
      flight(age, set.ship.position);
      set.ship.quaternion.setFromUnitVectors(UP, heading);
    } else {
      set.ship.position.set(0, .2, 0);
      set.ship.quaternion.identity();
    }
    set.ship.position.x += Math.sin(t * 67) * .02 * shake;
    set.ship.position.z += Math.sin(t * 53) * .012 * shake;
    set.flame.visible = ignite > 0 && set.ship.visible;
    const roar = ignite * (1 + .6 * range(age, 0, .45));
    // Never longer than the gap under the nozzle, or it pokes through the
    // floor, which is only a shadow catcher.
    const gap = Math.max(.02, set.ship.position.y - .02);
    set.flame.scale.set(.85 + .15 * ignite, Math.min(gap, roar * (1 + .15 * Math.sin(t * 53) + .1 * Math.sin(t * 31))), .85 + .15 * ignite);
    const shut = back(range(t, DUNK[1] - .02, DUNK[1] + .06), 1.4);
    set.hinge.rotation.y = -1.9 * (1 - shut) + wobble(t, DUNK[1] + .06, 30, 9) * .08;
    set.arms.forEach((arm, i) => { arm.rotation.y = 1.1 * smooth(range(t, 3.2 + i * .04, 3.5 + i * .04)); });
    set.update(t, range(t, 3, 3.1));

    trail.forEach((puff, k) => {
      const at = age - (k + 1) * .06;
      puff.visible = flying && at > 0;
      if (!puff.visible) return;
      set.pad.localToWorld(flight(at, puff.position));
      puff.scale.setScalar(SIZE * (.16 + k * .045) * (1 - range(t, GONE - .2, GONE + .1)));
      trailMaterials[k].opacity = .75 * (1 - k / trail.length);
    });

    const pop = range(t, GONE, GONE + .12);
    const fade = 1 - range(t, GONE + .12, GONE + .45);
    star.visible = pop > 0 && fade > 0;
    star.position.copy(FAR);
    star.quaternion.copy(camera.quaternion);
    star.rotateZ(t * 3);
    star.scale.setScalar(3.4 * back(pop, 2.4) * fade);
    star.material.opacity = fade;

    fling(rumble, t - 3.1, groundBase, 2.6, .5, -.3, .9, .4);
    fling(exhaust, age, groundBase, 8, .12, -.25, 1.6, .2);
    astro.root.getWorldPosition(feet);
    feet.y = .05;
    fling(dust, t - 1.05, feet, 3, .5, .7, 1.1, .35);
    fling(puffs, t - .25, temp.set(feet.x, keys(t, Y.descend) + .3, feet.z), 2.2, -.6, -.4, .9, .5);
    fling(sparks, age, base, 6, .6, 1.4, .8);

    const height = astro.root.position.y;
    shadow.position.set(astro.root.position.x, .015, astro.root.position.z + .05);
    shadow.scale.set(.85, .55, 1).multiplyScalar(SIZE * (1.15 - clamp(height / 2) * .5));
    shadow.material.opacity = .3 * (1 - clamp(height / 3.5));
    const blast = pulse(t, LIFT - .05, LIFT + .9);
    set.ship.updateWorldMatrix(true, false);
    if (set.flame.visible) set.ship.localToWorld(glow.position.set(0, -.3, 0));
    else glow.position.set(0, 1.8, -1.5);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + ignite * 22 * (1 - range(age, .5, 1.1));
    const impact = blast * .045;
    const thud = pulse(t, 1.03, 1.2) * .03;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * (thud + impact * .6);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// PR opened. The astronaut lets go of the tether at 3.05, the overlay's
// `lands`, and the PR's little satellite swings out into an orbit round it.
const RELEASE_PR = 3.05;
const SPIN_AT = 1.98;
const LAG = -.35;
// Where round the astronaut the satellite floats before the spin starts.
const LEAD = .75;
// Ends the wind-up with the satellite on the astronaut's right, heading away
// from the camera, so it swings out behind and comes round the front.
const SPIN = 2.5 * Math.PI - LAG;
const SPIN_RATE = 2 * SPIN / (RELEASE_PR - SPIN_AT);
const SETTLE = 4 * Math.PI;
const ORBIT = { radius: 1.75, height: 1.4, tilt: new Euler(.32, 0, -.14), drift: 3, decay: 2.6 };
const CENTRE_PR = new Vector3(0, 0, 1.4);

// Beats: the astronaut polishes the PR's satellite (0.15-0.95), shows it off
// with a bounce (1.0-1.4), lets it float up on its tether (1.45-1.95), spins
// round faster and faster with it like a hammer thrower (1.98-3.05), lets go
// (3.05) so it swings out wide and settles into a ring of its own, staggers
// dizzily to a stop (3.1-3.7) and cheers it round (3.7-4.5).
const P = {
  hops: [[1.1, .26, .08], [3.78, .3, .14]],
  landings: [[3.42, .5]],
  y: [[0, 0], [2.2, 0], [2.6, .1], [2.95, .12], [3.15, .14, out], [3.42, 0, fall]],
  lean: [[0, .12], [.95, .12], [1.1, -.04], [1.45, 0], [1.6, -.12], [1.92, -.18], [2.05, .08], [2.4, -.14], [3.05, -.2], [3.12, .2, out], [3.3, 0], [3.7, 0], [3.8, -.1], [4.2, 0]],
  nod: [[0, .38], [.95, .35], [1.1, 0], [1.4, -.05], [1.6, -.4], [1.95, -.35], [2.2, -.1], [3.05, .05], [3.15, -.2], [3.45, .15], [3.75, -.15], [4.3, -.1]],
  cock: [[0, .15], [.95, .2], [1.15, -.12], [1.4, .1], [1.6, 0]],
  pod: [[0, 0, .5, .74], [1, 0, .5, .74], [1.25, .2, .6, .84], [1.45, .2, .6, .84]],
  face: [
    [0, mood({ ly: -.7, happy: .6, smile: .8 })],
    [.95, mood({ ly: -.6, happy: .6, smile: .8 })],
    [1.1, mood({ wide: .6, smile: 1, ly: .1 })],
    [1.4, mood({ happy: 1, smile: 1 })],
    [1.6, mood({ ly: .9, wide: .8, smile: .4, open: .4 })],
    [1.95, mood({ ly: .6, squint: .4, smile: .3 })],
    [2.4, mood({ ly: .1, squint: .6, smile: .2, open: .3 })],
    [3, mood({ squint: .85, open: .6 })],
    [3.08, mood({ wide: 1, open: .9, smile: .2 }), whip],
    [3.3, mood({ wide: .6, open: .4 })],
    [3.6, mood({ wide: .3, smile: .6 })],
    [3.75, mood({ happy: 1, smile: 1 })],
  ],
  blinks: [.7, 1.85, 4.3],
};

function podTexture() {
  return paint(128, 128, ctx => {
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = PRINT;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 116, 116);
    ctx.fillStyle = PRINT;
    ctx.font = 'bold 62px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PR', 64, 68);
  });
}

function createOrbitScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const ink = new MeshBasicMaterial({ color: INK, side: BackSide });
  const set = createSet(scene, ink);
  const astro = createAstronaut(ink);
  scene.add(astro.root);
  const shadow = contactShadow(scene, .3, 0x0a0e1a);

  const label = podTexture();
  const grid = paint(128, 64, ctx => {
    ctx.fillStyle = '#1f4f8a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#9cc4f0';
    ctx.lineWidth = 3;
    for (let x = 0; x <= 128; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(128, 32); ctx.stroke();
  });
  textures.push(label, grid);
  const pod = new Group();
  const crate = inked(new Mesh(new BoxGeometry(.4, .4, .4), new MeshStandardMaterial({ map: label, roughness: .45, emissive: 0x6a3a00, emissiveIntensity: .3 })), ink, 1.08);
  pod.add(crate);
  const panel = new MeshStandardMaterial({ map: grid, roughness: .35, emissive: 0x0b2a50, emissiveIntensity: .5 });
  for (const side of [-1, 1]) {
    const wing = inked(new Mesh(new BoxGeometry(.46, .025, .24), panel), ink, 1.06, 1.6, 1.1);
    wing.position.x = side * .48;
    const strut = new Mesh(new CylinderGeometry(.015, .015, .1, 6), new MeshStandardMaterial({ color: STEEL }));
    strut.rotation.z = Math.PI / 2;
    strut.position.x = side * .24;
    pod.add(wing, strut);
  }
  const mast = new Mesh(new CylinderGeometry(.012, .012, .26, 6), new MeshStandardMaterial({ color: STEEL }));
  mast.position.y = .32;
  const beacon = new Mesh(new SphereGeometry(.045, 10, 8), new MeshBasicMaterial({ color: FLARE, toneMapped: false }));
  beacon.position.y = .46;
  pod.add(mast, beacon);
  scene.add(pod);

  const tether = new Mesh(new CylinderGeometry(.014, .014, 1, 6), new MeshBasicMaterial({ color: FLARE }));
  scene.add(tether);
  const turns = 128, sides = 5;
  const loop = new CatmullRomCurve3(Array.from({ length: 64 }, (_, i) => {
    const a = SPIN + LAG + i / 64 * Math.PI * 2;
    return new Vector3(Math.sin(a) * ORBIT.radius, 0, Math.cos(a) * ORBIT.radius);
  }), true);
  const ring = new Mesh(new TubeGeometry(loop, turns, .02, sides, true), new MeshBasicMaterial({ color: AMBER, transparent: true, toneMapped: false, depthWrite: false }));
  ring.position.set(CENTRE_PR.x, ORBIT.height, CENTRE_PR.z);
  ring.rotation.copy(ORBIT.tilt);
  scene.add(ring);
  const motes = Array.from({ length: 10 }, (_, i) => new Mesh(new OctahedronGeometry(.05, 0), new MeshBasicMaterial({ color: i % 2 ? AMBER : 0xfff1c4, toneMapped: false })));
  scene.add(...motes);
  const parts = smokeParts();
  const whoosh = createFlecks(scene, 26, [parts.spark]);
  const dust = createFlecks(scene, 20, [parts.dust]);

  const tilt = new Euler();
  const offset = new Vector3();
  const grip = new Vector3();
  const target = new Vector3();
  const hand = [new Vector3(), new Vector3()];
  const face = { ...FACE };
  const camY = camera.position.y;

  function yawAt(t) {
    if (t < SPIN_AT) return .12 * Math.sin(t * 1.3) * (1 - range(t, 1.2, 1.6));
    if (t < RELEASE_PR) return SPIN * range(t, SPIN_AT, RELEASE_PR) ** 2;
    const age = t - RELEASE_PR;
    return SETTLE - (SETTLE - SPIN) * Math.exp(-age * SPIN_RATE / (SETTLE - SPIN));
  }
  // Where the satellite is once it is let go: it keeps the throw's spin,
  // swings out wide and slows into a tilted ring.
  function orbiting(t, at) {
    const age = Math.max(0, t - RELEASE_PR);
    const angle = SPIN + LAG + ORBIT.drift * age + (SPIN_RATE - ORBIT.drift) * (1 - Math.exp(-ORBIT.decay * age)) / ORBIT.decay;
    const radius = keys(age, [[0, 1.65], [.28, 2.45, out], [.9, ORBIT.radius]]);
    const settle = smooth(range(age, 0, .7));
    tilt.set(ORBIT.tilt.x * settle, 0, ORBIT.tilt.z * settle);
    offset.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius).applyEuler(tilt);
    at.set(CENTRE_PR.x, keys(age, [[0, 1.45], [.28, 1.85, out], [.9, ORBIT.height]]), CENTRE_PR.z).add(offset);
    return angle;
  }

  function pose(t) {
    const move = bounce(t, P.hops, P.landings);
    const spin = range(t, SPIN_AT, RELEASE_PR);
    const dizzy = range(t, 3.15, 3.3) * (1 - range(t, 3.55, 3.85));
    const yaw = yawAt(t);
    astro.pose({
      x: CENTRE_PR.x, y: keys(t, P.y) + move.lift, z: CENTRE_PR.z, yaw, size: SIZE, squash: move.squash,
      lean: keys(t, P.lean) + Math.sin(t * 8) * .12 * dizzy, tilt: Math.cos(t * 8) * .14 * dizzy - .06 * smooth(spin),
      nod: keys(t, P.nod) + Math.sin(t * 8 + 1) * .1 * dizzy, turn: Math.sin(t * 6) * .15 * dizzy, cock: keys(t, P.cock) + Math.cos(t * 8) * .2 * dizzy,
      antenna: move.spring + .6 * smooth(spin) * (1 - range(t, RELEASE_PR, 3.3)) + wobble(t, RELEASE_PR, 10, 3) * .5,
    });
    const lag = mix(LEAD, LAG, smooth(spin));
    const polish = pulse(t, .15, .95);
    for (const side of [-1, 1]) {
      if (t < 1.45) {
        keysV(t, P.pod, grip);
        target.set(grip.x + side * .3, grip.y - .02, grip.z - .05);
        if (side < 0) {
          target.x += (.17 + Math.cos(t * 12) * .08) * polish;
          target.y += Math.sin(t * 12) * .08 * polish;
          target.z += .16 * polish;
        }
      } else if (t < RELEASE_PR) {
        const reach = mix(.42, .58, smooth(spin));
        target.set(Math.sin(lag) * reach + side * .09 * Math.cos(lag), .5 + .14 * smooth(spin), Math.cos(lag) * reach - side * .09 * Math.sin(lag));
      } else {
        keysV(t, [[RELEASE_PR, side * .2, .62, .55], [3.12, side * .64, .6, .1, out], [3.45, side * .62, .2, .16], [3.7, side * .6, .25, .15], [3.82, side * .58, 1.02, .25, out]], target);
        target.y += Math.sin(t * 14 + side) * .08 * range(t, 3.9, 4.05);
      }
      astro.reach(side, target);
      const shuffle = Math.max(0, Math.sin(yaw * 2 + side * 1.6)) * .14 * smooth(spin);
      astro.step(side, target.set(side * .2, .15 + shuffle + move.tuck * .15, .03), move.tuck * .2);
    }
    sample(P.face, t, face);
    face.blink = blinks(t, P.blinks);
    face.lx += Math.cos(t * 16) * .8 * dizzy + Math.sin(lag) * .5 * range(t, 1.45, 1.6) * (1 - range(t, RELEASE_PR, 3.2));
    face.ly += Math.sin(t * 16) * .6 * dizzy;
    astro.face(face);
    astro.tick(t);
    astro.root.updateMatrixWorld(true);
    astro.arms.forEach((arm, i) => arm.hand.getWorldPosition(hand[i]));
  }

  pose(1.45);
  const freed = new Vector3();
  astro.torso.localToWorld(keysV(1.45, P.pod, freed));
  const aloft = new Vector3(CENTRE_PR.x + Math.sin(LEAD) * .9, 3.4, CENTRE_PR.z + Math.cos(LEAD) * .9);

  function render(t) {
    pose(t);
    const thrown = t >= RELEASE_PR;
    let angle;
    if (t < 1.45) {
      astro.torso.localToWorld(keysV(t, P.pod, pod.position));
      pod.rotation.set(-.15, Math.sin(t * 1.4) * .3, 0);
    } else if (t < SPIN_AT) {
      const u = smooth(range(t, 1.45, 1.9));
      // Up past the visor's side rather than in front of it.
      pod.position.lerpVectors(freed, aloft, u);
      pod.position.x += Math.sin(u * Math.PI) * .8;
      pod.position.y += Math.sin(t * 5) * .04 * u;
      pod.rotation.set(-.15 + u * .3, Math.sin(t * 1.4) * .3 + u * .6, Math.sin(t * 3) * .1 * u);
    } else if (!thrown) {
      const u = range(t, SPIN_AT, RELEASE_PR);
      const reach = mix(.9, 1.65, smooth(u));
      angle = yawAt(t) + mix(LEAD, LAG, smooth(u));
      pod.position.set(CENTRE_PR.x + Math.sin(angle) * reach, mix(aloft.y, 1.45, smooth(u)) + astro.root.position.y * .5, CENTRE_PR.z + Math.cos(angle) * reach);
      pod.rotation.set(.15 * (1 - u), angle + .6 * (1 - u), Math.sin(t * 3) * .1 * (1 - u));
    } else {
      angle = orbiting(t, pod.position);
      pod.rotation.set(.25, angle + Math.PI / 2 + (t - RELEASE_PR) * 1.5, -.2);
    }
    pod.scale.setScalar(SIZE);
    beacon.visible = Math.sin(t * 7) > -.3;

    tether.visible = t > 1.45 && !thrown;
    if (tether.visible) {
      grip.addVectors(hand[0], hand[1]).multiplyScalar(.5);
      target.subVectors(pod.position, grip);
      const length = target.length();
      tether.position.addVectors(grip, pod.position).multiplyScalar(.5);
      tether.quaternion.setFromUnitVectors(UP, target.normalize());
      tether.scale.set(1, length, 1);
    }

    const traced = thrown ? clamp((orbiting(t, target) - SPIN - LAG) / (Math.PI * 2)) : 0;
    ring.visible = traced > 0;
    ring.geometry.setDrawRange(0, Math.floor(traced * turns) * sides * 6);
    ring.material.opacity = .85 * range(t, RELEASE_PR, RELEASE_PR + .15) * (1 - .35 * range(t, 3.8, 4.3));
    motes.forEach((mote, k) => {
      const at = t - (k + 1) * .035;
      mote.visible = thrown && at > RELEASE_PR;
      if (!mote.visible) return;
      orbiting(at, mote.position);
      mote.scale.setScalar((1 - k / motes.length) * (1.4 - .6 * range(t, 3.3, 3.8)));
      mote.rotation.set(t * 6, t * 4 + k, 0);
    });
    orbiting(RELEASE_PR, target);
    fling(whoosh, t - RELEASE_PR, target, 4.5, .2, .6, .8);
    astro.root.getWorldPosition(grip);
    grip.y = .05;
    fling(dust, t - 3.42, grip, 2.6, .4, .6, 1, .35);
    set.update(t);

    const height = astro.root.position.y;
    shadow.position.set(CENTRE_PR.x, .015, CENTRE_PR.z + .05);
    shadow.scale.set(.85, .55, 1).multiplyScalar(SIZE * (1.15 - clamp(height / 2) * .5));
    const pop = pulse(t, RELEASE_PR - .05, RELEASE_PR + .45);
    glow.position.set(CENTRE_PR.x, 2, -1.2);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + pop * 16;
    camera.position.x = .25 + Math.sin(t * 90) * pop * .03;
    camera.position.y = camY + Math.sin(t * 75) * pulse(t, 3.4, 3.6) * .025;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// Plan reveal. The flight plan is stamped FILED at 2.55, the overlay's
// `lands`; at 3.22 the astronaut lets go of the sheet and it flies to `front`,
// where the overlay pushes in on it.
const PLAN_LANDS = 2.55;
const PENCIL_GONE = 1.94;
const TOSS = 3.22;
const FLIGHT = [TOSS, 4.1];
const SHEET = { w: .56, h: .72 };
// Final sheet width at `front`.
const END_WIDTH = 2;
const CHECKS = [1.55, 1.66, 1.77, 1.88];
const SPOT = new Vector3(-.25, 0, 1.5);

// Beats: the astronaut floats cross-legged, pencil tapping its visor
// (0.15-0.9), plots the course and ticks off the checklist (0.95-1.9), holds
// the plan up to look it over and lets the pencil drift off (1.9-2.25), sets
// down, draws a rubber stamp from its belt and stamps it FILED (2.55), shows it
// off (2.7-3.15), launches the sheet at the camera (3.22) and salutes it.
const L = {
  hops: [[2.82, .3, .1]],
  landings: [[2.42, .45], [PLAN_LANDS, .4]],
  y: [[0, .62], [2.2, .62], [2.42, 0, fall]],
  yaw: [[0, .35], [1, .2], [1.9, .12], [2.3, 0]],
  lean: [[0, .1], [.9, .15], [1, .25], [1.85, .25], [2, -.05], [2.3, 0], [2.46, .1], [PLAN_LANDS, .2, whip], [2.7, .08], [3, -.04], [3.14, .1], [TOSS, -.16, whip], [3.5, 0]],
  nod: [[0, -.1], [.9, -.1], [1, .38], [1.88, .35], [2, .05], [2.25, .05], [2.4, .2], [PLAN_LANDS, .18], [2.7, .05], [3.1, 0], [3.3, -.2], [3.6, -.12], [4, -.05]],
  turn: [[0, -.2], [.9, -.15], [1, 0], [1.9, 0], [2.05, .2], [2.25, 0]],
  cock: [[0, .2], [.5, .25], [.9, .1], [1, 0], [1.95, 0], [2.1, -.18], [2.3, 0], [2.75, .15], [3.1, .1], [3.25, 0]],
  // The clipboard in torso space: [time, x, y, z], and its tip back from upright.
  board: [[0, .02, .02, .62], [.95, .02, .02, .64], [1.9, .02, .04, .64], [2.05, 0, .55, .72], [2.25, 0, .55, .72], [2.38, .04, .22, .68], [2.7, .04, .22, .68], [2.85, .05, .4, .8], [3.12, .05, .4, .8], [TOSS, .05, .62, .9, whip], [3.45, .1, .25, .6], [3.8, .45, .05, .35]],
  tip: [[0, -1.05], [1.9, -1.05], [2.05, -.12], [2.25, -.12], [2.38, -1.15], [2.7, -1.15], [2.85, -.05], [3.12, -.08], [TOSS, .05], [3.45, -.6], [3.8, -1.3]],
  // The free hand, in the clipboard's own space while it works on the sheet.
  pen: [[0, 0, 0, 0], [.95, -.12, .1, .1], [1.5, .12, .02, .07], [1.55, -.13, -.12, .07], [1.88, -.13, -.25, .07]],
  stamp: [[2.28, 0, -.1, .5], [2.46, 0, -.1, .45], [PLAN_LANDS, 0, -.12, .06, fall], [2.66, 0, -.12, .3], [2.75, 0, -.12, .35]],
  face: [
    [0, mood({ lx: -.6, ly: .7, smile: .2, squint: .2 })],
    [.9, mood({ lx: -.5, ly: .6, smile: .3 })],
    [1, mood({ ly: -.8, smile: .4, squint: .3 })],
    [1.5, mood({ ly: -.8, lx: .3, smile: .5, squint: .3 })],
    [1.9, mood({ ly: -.8, lx: -.2, smile: .7 })],
    [2.05, mood({ ly: -.2, wide: .8, smile: 1, open: .4 })],
    [2.25, mood({ happy: 1, smile: 1 })],
    [2.4, mood({ ly: -.8, squint: .5, smile: .6 })],
    [PLAN_LANDS, mood({ ly: -.8, squint: 1, smile: .9 }), whip],
    [2.75, mood({ happy: 1, smile: 1 })],
    [3.12, mood({ happy: 1, smile: 1 })],
    [3.3, mood({ wide: .7, ly: .3, open: .5, smile: .5 })],
    [3.6, mood({ happy: .9, smile: 1, ly: .2 })],
  ],
  blinks: [.55, 1.3, 2.9, 4.4],
};

function planTexture(title) {
  return paint(512, 658, ctx => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, 512, 658);
    ctx.strokeStyle = PRINT;
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, 484, 630);
    ctx.fillStyle = PRINT;
    ctx.font = 'bold 50px system-ui';
    ctx.fillText('FLIGHT PLAN', 36, 76);
    ctx.fillRect(36, 92, 440, 5);
    ctx.fillStyle = '#c2410c';
    ctx.font = 'bold 18px system-ui';
    ctx.fillText('MISSION', 36, 128);
    ctx.fillStyle = PRINT;
    ctx.font = 'bold 27px system-ui';
    wrap(title.trim() || 'This run', 440, 3, ctx.font).forEach((line, i) => ctx.fillText(line, 36, 162 + i * 32));
    // The trajectory panel: a plotting grid, the home planet and a dashed
    // target orbit the pencilled course climbs to.
    ctx.strokeStyle = '#cdbf9e';
    ctx.lineWidth = 1.5;
    for (let x = 36; x <= 476; x += 22) { ctx.beginPath(); ctx.moveTo(x, 268); ctx.lineTo(x, 436); ctx.stroke(); }
    for (let y = 268; y <= 436; y += 21) { ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(476, y); ctx.stroke(); }
    ctx.strokeStyle = PRINT;
    ctx.lineWidth = 3;
    ctx.strokeRect(36, 268, 440, 168);
    ctx.fillStyle = '#2b5aa8';
    ctx.beginPath();
    ctx.arc(110, 436, 52, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = '#c2410c';
    ctx.beginPath();
    ctx.ellipse(380, 330, 70, 34, -.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const y = 470 + i * 40;
      ctx.strokeStyle = PRINT;
      ctx.lineWidth = 3;
      ctx.strokeRect(40, y, 22, 22);
      ctx.fillStyle = i % 2 ? '#a99d82' : '#7d735e';
      ctx.fillRect(78, y + 7, 250 + Math.sin(i * 3) * 80, 9);
    }
  });
}

function createFlightPlanScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const ink = new MeshBasicMaterial({ color: INK, side: BackSide });
  const set = createSet(scene, ink);
  const astro = createAstronaut(ink);
  scene.add(astro.root);
  const shadow = contactShadow(scene, .3, 0x0a0e1a);

  const board = new Group();
  const masonite = inked(new Mesh(new BoxGeometry(.64, .82, .025), new MeshStandardMaterial({ color: 0x9a7048, roughness: .8 })), ink, 1.04, 1.03, 1.6);
  const clip = new Mesh(new BoxGeometry(.24, .07, .06), new MeshStandardMaterial({ color: 0x9aa3b5, roughness: .4, metalness: .3 }));
  clip.position.set(0, .4, .03);
  board.add(masonite, clip);
  scene.add(board);

  const planMap = planTexture(title);
  const tick = paint(64, 64, ctx => {
    ctx.strokeStyle = '#e8590c';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(12, 34);
    ctx.lineTo(26, 50);
    ctx.lineTo(54, 12);
    ctx.stroke();
  });
  const filed = paint(256, 112, ctx => {
    ctx.strokeStyle = '#b42318';
    ctx.fillStyle = '#b42318';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 240, 96);
    ctx.lineWidth = 3;
    ctx.strokeRect(17, 17, 222, 78);
    ctx.font = 'bold 60px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FILED', 128, 60);
  });
  textures.push(planMap, tick, filed);
  // Sheet space is the paper's: SHEET.w by SHEET.h, centred, facing +z.
  const plan = new Group();
  const paper = new Mesh(new PlaneGeometry(SHEET.w, SHEET.h), new MeshStandardMaterial({ map: planMap, emissive: 0xffffff, emissiveMap: planMap, emissiveIntensity: .25, roughness: .9, side: DoubleSide }));
  plan.add(paper);
  const px = (x, y, z = .002) => new Vector3((x / 512 - .5) * SHEET.w, (.5 - y / 658) * SHEET.h, z);
  const course = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    course.push(px(mix(mix(140, 170, u), mix(170, 330, u), u), mix(mix(392, 280, u), mix(280, 318, u), u), .003));
  }
  const strip = [];
  for (let i = 0; i < course.length; i++) {
    const a = course[Math.max(0, i - 1)], b = course[Math.min(course.length - 1, i + 1)];
    const nx = -(b.y - a.y), ny = b.x - a.x, size = Math.hypot(nx, ny) || 1, half = .0045;
    strip.push(course[i].x + nx / size * half, course[i].y + ny / size * half, .003, course[i].x - nx / size * half, course[i].y - ny / size * half, .003);
  }
  const ribbon = new BufferGeometry();
  ribbon.setAttribute('position', new Float32BufferAttribute(strip, 3));
  ribbon.setIndex(Array.from({ length: course.length - 1 }, (_, i) => [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2]).flat());
  const drawn = new Mesh(ribbon, new MeshBasicMaterial({ color: FLARE, side: DoubleSide }));
  const craft = new Mesh(new CircleGeometry(.012, 12), new MeshBasicMaterial({ color: FLARE }));
  plan.add(drawn, craft);
  const ticks = CHECKS.map((_, i) => {
    const mark = new Mesh(new PlaneGeometry(.045, .045), new MeshBasicMaterial({ map: tick, transparent: true, depthWrite: false }));
    mark.position.copy(px(52, 478 + i * 40, .004));
    plan.add(mark);
    return mark;
  });
  const stampMark = new Mesh(new PlaneGeometry(.3, .13), new MeshBasicMaterial({ map: filed, transparent: true, depthWrite: false, opacity: .92 }));
  stampMark.position.copy(px(370, 560, .005));
  stampMark.rotation.z = .22;
  plan.add(stampMark);
  scene.add(plan);

  const pencil = new Group();
  // Gripped near the top, so most of it shows below the mitten.
  const wood = inked(new Mesh(new CylinderGeometry(.028, .028, .34, 6), new MeshStandardMaterial({ color: 0xf2c14e, roughness: .6 })), ink, 1.3, 1.02, 1.3);
  wood.position.y = -.1;
  const lead = new Mesh(new ConeGeometry(.028, .07, 6), new MeshStandardMaterial({ color: 0x3b2a1a }));
  lead.position.y = -.305;
  lead.rotation.x = Math.PI;
  const rubber = new Mesh(new CylinderGeometry(.029, .029, .05, 6), new MeshStandardMaterial({ color: 0xe86a7a }));
  rubber.position.y = .09;
  pencil.add(wood, lead, rubber);
  scene.add(pencil);
  const stamp = new Group();
  const knob = inked(new Mesh(new SphereGeometry(.07, 12, 8), new MeshStandardMaterial({ color: STEEL, roughness: .5 })), ink, 1.15);
  knob.position.y = .24;
  const handle = new Mesh(new CylinderGeometry(.035, .05, .2, 10), new MeshStandardMaterial({ color: STEEL, roughness: .5 }));
  handle.position.y = .13;
  const block = inked(new Mesh(new BoxGeometry(.28, .07, .15), new MeshStandardMaterial({ color: FLARE, roughness: .5 })), ink, 1.1);
  const pad = new Mesh(new BoxGeometry(.26, .015, .13), new MeshStandardMaterial({ color: 0xb42318 }));
  pad.position.y = -.042;
  stamp.add(knob, handle, block, pad);
  scene.add(stamp);

  const parts = smokeParts();
  const burst = createFlecks(scene, 30, [parts.spark]);
  const dust = createFlecks(scene, 18, [parts.dust]);
  const halo = new Mesh(new TorusGeometry(1, .03, 5, 48), new MeshBasicMaterial({ color: AMBER, transparent: true, depthWrite: false, toneMapped: false }));
  scene.add(halo);

  const boardAt = new Vector3();
  const target = new Vector3();
  const local = new Vector3();
  const euler = new Euler();
  const boardMatrix = new Matrix4();
  const sheetMatrix = new Matrix4().makeTranslation(0, -.03, .016);
  const face = { ...FACE };
  const camY = camera.position.y;
  // Centred on the camera's line of sight, about two thirds of the view tall:
  // the overlay in the send-offs plugin pushes in on it from there.
  const front = new Vector3(.25, 2.36, 6);
  const square = new Object3D();
  square.position.copy(front);
  square.lookAt(camera.position);

  // A point in clipboard space, in torso space.
  const onBoard = (x, y, z, at) => at.set(x, y, z).applyEuler(euler).add(boardAt);

  function pose(t) {
    const move = bounce(t, L.hops, L.landings);
    const aloft = 1 - range(t, 2.2, 2.42);
    astro.pose({
      x: SPOT.x, y: keys(t, L.y) + move.lift + Math.sin(t * 2.2) * .06 * aloft, z: SPOT.z,
      yaw: keys(t, L.yaw) + Math.sin(t * .9) * .1 * aloft, size: SIZE, squash: move.squash,
      lean: keys(t, L.lean), tilt: Math.sin(t * 1.7) * .05 * aloft, nod: keys(t, L.nod), turn: keys(t, L.turn),
      cock: keys(t, L.cock) + Math.sin(t * 9) * .05 * pulse(t, .2, .9), antenna: move.spring + Math.sin(t * 2.2 + 1) * .12 * aloft,
    });
    keysV(t, L.board, boardAt);
    euler.set(keys(t, L.tip), 0, Math.sin(t * 2) * .04 * aloft);
    astro.reach(1, onBoard(.33, -.08, 0, target));
    const scribble = pulse(t, .95, 1.9);
    if (t < .95) {
      // Tapping the chin of the visor while it thinks.
      target.set(-.3, .9 + Math.max(0, Math.sin(t * 9)) * .05, .5);
    } else if (t < 1.9) {
      keysV(t, L.pen, local);
      onBoard(local.x + Math.sin(t * 37) * .015 * scribble, local.y + Math.sin(t * 29) * .012 * scribble, local.z, target);
    } else if (t < 2.28) {
      keysV(t, [[1.9, -.2, .5, .62], [2.02, -.28, .7, .6], [2.15, -.4, .15, .32], [2.28, -.36, .12, .34]], target);
    } else if (t < 2.75) {
      keysV(t, L.stamp, local);
      onBoard(local.x, local.y, local.z, target);
    } else if (t < TOSS + .05) {
      onBoard(-.33, -.08, 0, target);
    } else {
      keysV(t, [[TOSS + .05, -.3, .6, .6], [3.5, -.45, .14, .2], [3.7, -.45, 1.15, .3], [4.3, -.45, 1.15, .3], [4.5, -.55, .14, .18]], target);
    }
    astro.reach(-1, target);
    for (const side of [-1, 1]) {
      // Cross-legged while it floats, each boot tucked under the other knee.
      const crossed = side < 0 ? [.1, .34, .32] : [-.1, .28, .28];
      local.set(mix(side * .2, crossed[0], aloft), mix(.15, crossed[1], aloft) + move.tuck * .12, mix(.03, crossed[2], aloft));
      astro.step(side, local, mix(0, -.5, aloft), aloft > .5 ? target.set(side, .1, .5) : undefined);
    }
    sample(L.face, t, face);
    face.blink = blinks(t, L.blinks);
    if (t > .95 && t < 1.9) face.lx = keys(t, [[.95, -.3], [1.5, .3], [1.55, -.3], [1.9, -.3]]);
    astro.face(face);
    astro.tick(t);
    astro.root.updateMatrixWorld(true);
    hold(board, astro.torso, boardAt.x, boardAt.y, boardAt.z, euler.x, euler.y, euler.z, boardMatrix);
    holding.m.multiplyMatrices(boardMatrix, sheetMatrix).decompose(plan.position, plan.quaternion, plan.scale);
    const pen = astro.arms[0].hand.position;
    hold(pencil, astro.torso, pen.x, pen.y + .04, pen.z, euler.x + Math.PI / 2 - .5, 0, .35);
    hold(stamp, astro.torso, pen.x, pen.y - .04, pen.z, euler.x + Math.PI / 2, 0, 0);
  }

  pose(PENCIL_GONE);
  const dropped = { at: pencil.position.clone(), turn: pencil.quaternion.clone() };
  pose(PLAN_LANDS);
  const struck = plan.localToWorld(stampMark.position.clone());
  pose(TOSS);
  const thrown = { at: plan.position.clone(), turn: plan.quaternion.clone(), size: plan.scale.x };
  const spinning = new Quaternion();

  function render(t) {
    pose(t);
    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    if (t > TOSS) {
      plan.position.lerpVectors(thrown.at, front, lift);
      plan.position.y += Math.sin(lift * Math.PI) * .4;
      plan.quaternion.slerpQuaternions(thrown.turn, square.quaternion, lift);
      spinning.setFromEuler(euler.set(Math.sin(t * 13) * .25 * (1 - lift), Math.sin(t * 9) * .2 * (1 - lift), 0));
      plan.quaternion.multiply(spinning);
      plan.scale.setScalar(mix(thrown.size, END_WIDTH / SHEET.w, lift));
    }
    const plotted = range(t, 1, 1.5);
    drawn.geometry.setDrawRange(0, Math.floor(plotted * (course.length - 1)) * 6);
    drawn.visible = plotted > 0;
    craft.visible = plotted > 0;
    craft.position.copy(course[Math.round(plotted * (course.length - 1))]);
    craft.position.z = .004;
    ticks.forEach((mark, i) => {
      const pop = range(t, CHECKS[i], CHECKS[i] + .14);
      mark.visible = pop > 0;
      mark.scale.setScalar(back(pop, 2.5));
    });
    const hit = range(t, PLAN_LANDS, PLAN_LANDS + .12);
    stampMark.visible = hit > 0;
    stampMark.scale.setScalar(mix(1.5, 1, back(hit, 2)));

    pencil.visible = t < 3.6;
    if (t > PENCIL_GONE) {
      const age = t - PENCIL_GONE;
      pencil.position.copy(dropped.at).add(target.set(-.9 * age, .45 * age + .1 * age * age, -.2 * age));
      pencil.quaternion.copy(dropped.turn).multiply(spinning.setFromEuler(euler.set(age * 2, 0, age * 5)));
    }
    stamp.visible = t > 2.26 && t < 2.9;
    stamp.scale.multiplyScalar(back(range(t, 2.26, 2.36), 2) * (1 - range(t, 2.78, 2.9)));
    fling(burst, t - PLAN_LANDS, struck, 3.5, .5, 1.6, .8);
    astro.root.getWorldPosition(target);
    target.y = .05;
    fling(dust, t - 2.42, target, 2.4, .4, .6, 1, .35);

    const bang = pulse(t, PLAN_LANDS - .05, PLAN_LANDS + .4);
    halo.position.copy(struck);
    halo.quaternion.copy(camera.quaternion);
    const ring = range(t, PLAN_LANDS, PLAN_LANDS + .45);
    halo.visible = ring > 0 && ring < 1;
    halo.scale.setScalar(.12 + out(ring) * .7);
    halo.material.opacity = (1 - ring) * .8;
    set.update(t);
    const height = astro.root.position.y;
    shadow.position.set(SPOT.x, .015, SPOT.z + .05);
    shadow.scale.set(.85, .55, 1).multiplyScalar(SIZE * (1.15 - clamp(height / 2) * .5));
    shadow.material.opacity = .3 * (1 - clamp(height / 3));
    glow.position.set(SPOT.x, 2, -1.2);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + bang * 16;
    camera.position.x = .25 + Math.sin(t * 90) * bang * .025;
    camera.position.y = camY + Math.sin(t * 75) * pulse(t, 2.42, 2.6) * .02;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// All settled. The astronaut plants a flag as the word lands and the first
// shells burst.
const PLANT = CLEAR_LANDS;
const FLIP = [2.82, 1.2];
const POLE = 2.1;

// Beats: the astronaut bounds in carrying the mission flag (0.2-1.12), lifts
// it high (1.12-1.38), plants it (1.45) so it unfurls, steps back and salutes
// it (1.55-2.5), crouches and does a slow zero-g backflip (2.82-4.02), lands,
// and jumps for joy with both arms up (4.1-4.9).
const C = {
  hops: [[0, .4, .45], [.4, .38, .4], [.78, .36, .3], [1.56, .3, .12], [FLIP[0], FLIP[1], 1.35], [4.16, .34, .22]],
  landings: [[PLANT, .4]],
  x: [[0, 5.4], [1.14, .25, out], [1.56, .25], [1.86, .72]],
  yaw: [[0, -1.3], [.9, -1.1], [1.12, -.1], [1.3, 0], [1.56, 0], [1.86, -.25], [2.5, -.3], [2.7, 0]],
  lean: [[0, .15], [1.1, .15], [1.2, -.1], [1.36, -.18], [PLANT, .3, whip], [1.6, 0], [2.6, 0], [2.78, .25], [2.84, -.1], [4.02, -.05], [4.06, .25, out], [4.25, 0]],
  nod: [[0, 0], [1.12, 0], [1.36, -.3], [PLANT, .12, whip], [1.65, 0], [1.9, -.3], [2.5, -.3], [2.7, .2], [2.84, -.2], [3.4, .3], [4.02, .1], [4.2, -.15], [4.7, -.2]],
  cock: [[1.9, 0], [2.05, .15], [2.5, .12], [2.6, 0], [4.25, 0], [4.45, .15], [4.7, -.15], [4.9, .1]],
  // The pole in root space while it is held: [time, foot x, y, z], how far it
  // leans from upright, and how far up it the hand grips.
  pole: [[0, -.3, .5, .3], [1.12, -.55, .3, .45], [1.36, -.6, .75, .45], [PLANT, -.6, 0, .45, whip]],
  slant: [[0, .55], [1.12, .3], [1.36, 0]],
  grip: [[0, .6], [1.36, .62], [PLANT, .9, whip]],
  face: [
    [0, mood({ lx: -.7, happy: .7, smile: 1 })],
    [1.12, mood({ lx: -.4, smile: .9, wide: .3 })],
    [1.36, mood({ ly: .7, squint: .6, smile: .4, open: .4 })],
    [PLANT, mood({ squint: 1, open: .9, smile: .3 }), whip],
    [1.7, mood({ ly: .5, lx: -.5, wide: .7, open: .6 })],
    [1.95, mood({ lx: -.6, ly: .5, happy: 1, smile: 1 })],
    [2.55, mood({ lx: -.3, happy: 1, smile: 1 })],
    [2.75, mood({ squint: .6, smile: .6 })],
    [2.9, mood({ wide: 1, open: .8, smile: .5 })],
    [3.9, mood({ wide: .8, open: .6 })],
    [4.05, mood({ squint: .9, smile: .8 })],
    [4.2, mood({ happy: 1, smile: 1 })],
  ],
  blinks: [1.9, 4.75],
};

function flagTexture() {
  return paint(256, 160, ctx => {
    ctx.fillStyle = '#16213f';
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(0, 0, 256, 16);
    ctx.fillRect(0, 144, 256, 16);
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(128, 82, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd59a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(128, 82, 62, 17, -.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(128, 82, 34, Math.PI * 1.1, Math.PI * 1.9);
    ctx.fill();
    ctx.fillStyle = '#eef0f4';
    for (const [x, y, r] of [[42, 44, 5], [212, 120, 4], [204, 40, 3], [58, 118, 3]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function createFlagScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const ink = new MeshBasicMaterial({ color: INK, side: BackSide });
  const set = createSet(scene, ink);
  const astro = createAstronaut(ink);
  scene.add(astro.root);
  const shadow = contactShadow(scene, .3, 0x0a0e1a);
  const fireworks = createFireworks(scene, camera, { colors: [AMBER, FLARE, CYAN, 0xfff1c4] });

  const flagMap = flagTexture();
  textures.push(flagMap);
  const flag = new Group();
  const staff = inked(new Mesh(new CylinderGeometry(.03, .03, POLE, 8).translate(0, POLE / 2, 0), new MeshStandardMaterial({ color: 0xc9ced8, roughness: .4, metalness: .3 })), ink, 1.6, 1.005, 1.6);
  const bar = new Mesh(new CylinderGeometry(.022, .022, 1.05, 8), new MeshStandardMaterial({ color: 0xc9ced8, roughness: .4, metalness: .3 }));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(-.52, POLE - .04, 0);
  const finial = new Mesh(new SphereGeometry(.055, 12, 8), new MeshBasicMaterial({ color: AMBER, toneMapped: false }));
  finial.position.y = POLE + .03;
  const clothShape = new PlaneGeometry(1, .62, 16, 6).translate(-.5, -.31, 0);
  const cloth = new Mesh(clothShape, new MeshStandardMaterial({ map: flagMap, roughness: .8, side: DoubleSide, emissive: 0xffffff, emissiveMap: flagMap, emissiveIntensity: .15 }));
  cloth.position.set(-.03, POLE - .06, 0);
  cloth.castShadow = true;
  flag.add(staff, bar, finial, cloth);
  scene.add(flag);
  const restCloth = clothShape.attributes.position.array.slice();

  const ripple = new Mesh(new TorusGeometry(1, .06, 6, 48), new MeshBasicMaterial({ color: 0xcfc7b2, transparent: true, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  scene.add(ripple);
  const parts = smokeParts();
  const dust = createFlecks(scene, 32, [parts.dust]);
  const thrust = createFlecks(scene, 14, [parts.dust]);
  const landing = createFlecks(scene, 22, [parts.dust]);

  const point = new Vector3();
  const foot = new Vector3();
  const target = new Vector3();
  const nozzle = new Vector3();
  const tilt = new Euler();
  const face = { ...FACE };
  const camY = camera.position.y;

  // The pole's foot and top in root space at `t`, while it is held.
  function poleAt(t, base, top) {
    keysV(t, C.pole, base);
    const lean = keys(t, C.slant);
    return top.set(0, Math.cos(lean), Math.sin(lean));
  }
  const base = new Vector3(), up = new Vector3();

  function pose(t) {
    const move = bounce(t, C.hops, C.landings);
    const flipping = range(t, FLIP[0] + .12, FLIP[0] + FLIP[1] - .14);
    const tuck = Math.sin(Math.PI * flipping);
    const jig = range(t, 4.3, 4.45);
    astro.pose({
      x: keys(t, C.x), y: move.lift, z: 1.4, yaw: keys(t, C.yaw), size: SIZE, squash: move.squash,
      flip: -Math.PI * 2 * smooth(flipping), lean: keys(t, C.lean) + tuck * .3, tilt: Math.sin(t * 7) * .08 * jig,
      nod: keys(t, C.nod) + tuck * .3, cock: keys(t, C.cock), antenna: move.spring + tuck * .6,
    });
    astro.root.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      if (side < 0 && t < PLANT + .08) {
        poleAt(t, base, up);
        target.copy(base).addScaledVector(up, keys(t, C.grip));
        astro.torso.worldToLocal(astro.root.localToWorld(target));
      } else if (side < 0 && t < 2.6) {
        keysV(t, [[PLANT + .08, -.45, .45, .4], [1.6, ...rest(-1)], [1.9, -.45, 1.15, .3], [2.5, -.45, 1.15, .3], [2.65, -.5, .2, .1]], target);
      } else if (t < PLANT + .08) {
        keysV(t, [[0, .6, .3, .2], [1.1, .6, .3, .2], [1.36, .5, .9, .3], [PLANT, .55, .35, .3, whip]], target);
        target.x += Math.sin(t * 9) * .05 * (1 - range(t, 1, 1.12));
      } else if (t < 2.6) {
        keysV(t, [[PLANT + .08, ...rest(1)], [1.9, .52, .08, .2]], target);
      } else {
        keysV(t, [[2.6, side * .52, .08, .2], [2.78, side * .55, .1, -.25], [2.95, side * .25, .1, .5], [3.85, side * .25, .1, .5], [4.04, side * .66, .6, .1, out], [4.2, side * .58, 1.02, .25], [4.95, side * .58, 1.02, .25]], target);
        target.x += Math.sin(t * 12 + side) * .1 * range(t, 4.4, 4.55) * side;
      }
      astro.reach(side, target);
      foot.set(side * .2, .15 + move.tuck * .1 + tuck * .32, .03 + tuck * .3);
      if (t < 1.2) foot.y += Math.max(0, Math.sin(t * 13 + side * 1.5)) * .06 * (1 - move.tuck);
      astro.step(side, foot, tuck * .6);
    }
    sample(C.face, t, face);
    face.blink = blinks(t, C.blinks);
    astro.face(face);
    astro.tick(t);
    astro.root.updateMatrixWorld(true);
  }

  pose(PLANT);
  const planted = astro.root.localToWorld(keysV(PLANT, C.pole, new Vector3()));
  const groundAt = new Vector3(planted.x, .04, planted.z);

  function render(t) {
    pose(t);
    if (t < PLANT) {
      poleAt(t, base, up);
      astro.root.localToWorld(flag.position.copy(base));
      flag.quaternion.setFromUnitVectors(UP, up).premultiply(astro.root.quaternion);
    } else {
      flag.position.copy(planted);
      flag.quaternion.setFromEuler(tilt.set(0, -.25, wobble(t, PLANT, 14, 5) * .06));
    }
    flag.scale.setScalar(SIZE);
    // Furled round the staff until it is planted, then it unfurls and
    // ripples, the ripple dying out as low gravity lets it settle.
    const unfurl = back(range(t, PLANT, PLANT + .4), 1.6);
    bar.scale.y = mix(.16, 1, unfurl);
    bar.position.x = -.52 * bar.scale.y;
    const points = cloth.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const x = restCloth[i * 3], y = restCloth[i * 3 + 1];
      const along = -x;
      const wave = Math.sin(along * 7 - t * 6) * .05 * along * (.3 + .7 * Math.exp(-(t - PLANT) * 1.2)) * (t > PLANT ? 1 : 0);
      points.array[i * 3] = x * mix(.16, 1, unfurl);
      points.array[i * 3 + 1] = y;
      points.array[i * 3 + 2] = wave + (t < PLANT ? Math.sin(along * 40) * .02 : 0);
    }
    points.needsUpdate = true;
    cloth.geometry.computeVertexNormals();

    fireworks.update(t);
    const flash = fireworks.flash(t);
    const thud = range(t, PLANT, PLANT + .5);
    ripple.position.copy(groundAt);
    ripple.visible = thud > 0 && thud < 1;
    ripple.scale.setScalar(.3 + smooth(thud) * 1.8);
    ripple.material.opacity = .55 * (1 - thud);
    fling(dust, t - PLANT, groundAt, 3.2, .5, .5, 1.2, .35);
    astro.nozzles[0].getWorldPosition(nozzle);
    fling(thrust, t - (FLIP[0] + .25), nozzle, 1.4, -.8, .4, .6, .6);
    astro.root.getWorldPosition(point);
    point.y = .05;
    fling(landing, t - (FLIP[0] + FLIP[1]), point, 2.8, .4, .6, 1.1, .35);
    set.update(t);

    const height = astro.root.position.y;
    shadow.position.set(point.x, .015, point.z + .05);
    shadow.scale.set(.85, .55, 1).multiplyScalar(SIZE * (1.15 - clamp(height / 2) * .5));
    shadow.material.opacity = .3 * (1 - clamp(height / 3));
    glow.position.set(0, 3, -1.5);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + flash * 14;
    const bump = pulse(t, PLANT, PLANT + .2) * .03 + pulse(t, 4.02, 4.2) * .025;
    camera.position.x = .25 + Math.sin(t * 90) * flash * .015;
    camera.position.y = camY + Math.sin(t * 75) * bump;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: createLiftoffScene, pr: createOrbitScene, plan: createFlightPlanScene, clear: createFlagScene,
  look: {
    words: { yeet: 'LIFTOFF.', pr: 'PR IN ORBIT.', plan: 'FLIGHT PLAN FILED.', clear: 'ALL STATIONS GO.' },
    background: 'radial-gradient(ellipse at 50% 60%,light-dark(#fbf6ea,#18264a) 0%,light-dark(#efe4c9,#0b1020) 50%,light-dark(#ddd0b0,#03050c) 100%)',
    ink: 'light-dark(#121110,#eef3ff)',
    glow: '0 5px 0 light-dark(#c2410c,#7a4a10),0 0 70px light-dark(#e8590c50,#ffb34750)',
    flash: 'light-dark(#c2410c,#ffb347)',
    flashGlow: 'light-dark(#e8590c90,#ffb34790)',
  },
};
