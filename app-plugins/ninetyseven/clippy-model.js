// Clippy: one bent wire with eyes and eyebrows. The wire is rebuilt from its
// centreline on every pose, so he bends and stretches like a spring and swings
// his loose outer end as an arm.
import {
  BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry,
  TorusGeometry, Vector3,
} from 'three';
import { clamp, smooth } from '../../ui/yeet/stage.js';

export const HEIGHT = 3.2;
const HALF = .62;
const SHOULDER_Y = HEIGHT - HALF;
const ARM_END = .95;
const HOOK = .2;
const INNER_RIGHT = .3;
const INNER_LEFT = -.32;
const BOTTOM = (HALF + INNER_RIGHT) / 2;
const CROWN = (INNER_RIGHT - INNER_LEFT) / 2;
const CROWN_Y = 2.05;
const TONGUE_END = 1.2;
// How far back the tongue sits when tucked, enough to clear a sheet of paper
// held between it and the rest of the wire.
const TUCK = -.26;
const WIRE = .09;
const SIDES = 10;
const EYES_Y = 2.42;
// Where a ball rests on the arm, just inside the hook.
const PALM = [HALF + .45, SHOULDER_Y - 1.45];
const TIP = [HALF + HOOK, ARM_END - HOOK];

const REST = {
  // Arm swing in his own plane: 0 hangs by his side, PI / 2 points sideways,
  // PI points straight up.
  arm: 0,
  // Arm swing toward the viewer, as a share of a quarter turn.
  forward: 0,
  curl: 0,
  stretch: 1,
  sway: 0,
  lean: 0,
  twist: 0,
  tuck: 0,
  look: [0, 0],
  blink: 0,
  brows: [0, 0],
  scowl: 0,
  wide: 1,
};

// The wire from the arm's hooked tip, up over the head, down the far side,
// round the foot, up the middle and over the crown to the tongue. `along` is
// 0 on the body and rises to 1 at the arm's tip; `tongue` is 1 on the part
// that tucks behind a sheet.
function restWire() {
  const points = [];
  const add = (x, y, tongue = 0) => points.push({ x, y, tongue, along: 0 });
  const line = (x, from, to, steps, tongue = 0) => {
    for (let i = 1; i <= steps; i++) add(x, from + (to - from) * i / steps, tongue);
  };
  const arc = (cx, cy, radius, from, to, steps, tucks = false) => {
    for (let i = 1; i <= steps; i++) {
      const angle = from + (to - from) * i / steps;
      add(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, tucks ? smooth(i / steps) : 0);
    }
  };
  add(...TIP);
  arc(HALF + HOOK, ARM_END, HOOK, -Math.PI / 2, -Math.PI, 6);
  line(HALF, ARM_END, SHOULDER_Y, 18);
  const shoulder = points.length - 1;
  arc(0, SHOULDER_Y, HALF, 0, Math.PI, 20);
  line(-HALF, SHOULDER_Y, BOTTOM, 14);
  arc(INNER_RIGHT - BOTTOM, BOTTOM, BOTTOM, Math.PI, Math.PI * 2, 16);
  line(INNER_RIGHT, BOTTOM, CROWN_Y, 12);
  arc(INNER_RIGHT - CROWN, CROWN_Y, CROWN, 0, Math.PI, 12, true);
  line(INNER_LEFT, CROWN_Y, TONGUE_END, 8, 1);
  let length = 0;
  for (let i = shoulder - 1; i >= 0; i--) {
    length += Math.hypot(points[i].x - points[i + 1].x, points[i].y - points[i + 1].y);
    points[i].along = length;
  }
  for (let i = 0; i < shoulder; i++) points[i].along /= length;
  return points;
}

// A straight stalk of HEIGHT bent into an arc that turns `angle` by its top,
// toward +across. Returns [across, up].
function bend(across, up, angle) {
  if (Math.abs(angle) < 1e-4) return [across, up];
  const radius = HEIGHT / angle;
  const turned = up / radius;
  const reach = radius - across;
  return [radius - reach * Math.cos(turned), reach * Math.sin(turned)];
}

function deform(out, x, y, z, along, pose) {
  if (along > 0) {
    const share = smooth(clamp(along / .3));
    const swing = pose.arm * share + pose.curl * along * along;
    let dx = x - HALF;
    const dy = y - SHOULDER_Y;
    x = HALF + dx * Math.cos(swing) - dy * Math.sin(swing);
    y = SHOULDER_Y + dx * Math.sin(swing) + dy * Math.cos(swing);
    const toward = pose.forward * share * Math.PI / 2;
    dx = x - HALF;
    x = HALF + dx * Math.cos(toward) - z * Math.sin(toward);
    z = dx * Math.sin(toward) + z * Math.cos(toward);
  }
  const wide = 1 / Math.sqrt(pose.stretch);
  x *= wide;
  y *= pose.stretch;
  z *= wide;
  const turn = pose.twist * y / HEIGHT;
  [x, z] = [x * Math.cos(turn) + z * Math.sin(turn), z * Math.cos(turn) - x * Math.sin(turn)];
  [x, y] = bend(x, y, pose.sway);
  [z, y] = bend(z, y, pose.lean);
  return out.set(x, y, z);
}

function eye(side, ball, white, ink) {
  const group = new Group();
  group.position.set(side * .29, 0, .1);
  const rim = new Mesh(ball, ink);
  rim.scale.set(.31, .38, .06);
  rim.position.z = -.02;
  const sclera = new Mesh(ball, white);
  sclera.scale.set(.27, .34, .08);
  const pupil = new Group();
  const iris = new Mesh(ball, ink);
  iris.scale.set(.1, .12, .03);
  const glint = new Mesh(ball, white);
  glint.scale.setScalar(.03);
  glint.position.set(.035, .045, .03);
  pupil.add(iris, glint);
  group.add(rim, sclera, pupil);
  return { group, pupil };
}

function brow(side, ink) {
  const arch = new Mesh(new TorusGeometry(.2, .05, 8, 14, 1.5), ink);
  arch.rotation.z = Math.PI / 2 - .75;
  arch.position.y = -.2;
  const group = new Group();
  group.add(arch);
  group.userData.side = side;
  return group;
}

export function createClippy() {
  const wire = restWire();
  const rings = wire.length;
  const positions = new Float32Array(rings * SIDES * 3);
  const normals = new Float32Array(rings * SIDES * 3);
  const index = [];
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const a = ring * SIDES + side;
      const b = a + SIDES;
      const c = ring * SIDES + (side + 1) % SIDES;
      const d = c + SIDES;
      index.push(a, c, b, c, d, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(index);
  const steel = new MeshStandardMaterial({ color: 0xb2bac9, metalness: .6, roughness: .3 });
  const body = new Mesh(geometry, steel);
  body.castShadow = true;
  // The geometry moves under a bounding sphere measured once.
  body.frustumCulled = false;
  const tip = new SphereGeometry(WIRE, 12, 8);
  const ends = [0, 1].map(() => {
    const cap = new Mesh(tip, steel);
    cap.castShadow = true;
    return cap;
  });

  const white = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const ink = new MeshBasicMaterial({ color: 0x0a0a0a, toneMapped: false });
  const face = new Group();
  const ball = new SphereGeometry(1, 20, 14);
  const eyes = [-1, 1].map(side => eye(side, ball, white, ink));
  const brows = [-1, 1].map(side => brow(side, ink));
  face.add(...eyes.map(({ group }) => group), ...brows);

  const root = new Group();
  root.add(body, ...ends, face);

  const centres = wire.map(() => new Vector3());
  const tangent = new Vector3(), normal = new Vector3(), binormal = new Vector3(), outward = new Vector3();
  const origin = new Vector3(), across = new Vector3(), up = new Vector3(), facing = new Vector3();
  const basis = new Matrix4();
  let current = REST;

  function pose(values = {}) {
    current = { ...REST, ...values };
    wire.forEach((point, i) => deform(centres[i], point.x, point.y, point.tongue * current.tuck * TUCK, point.along, current));
    // Carried from ring to ring rather than rebuilt from a fixed axis, so the
    // tube never twists where the wire turns to face that axis.
    normal.set(0, 0, 1);
    for (let ring = 0; ring < rings; ring++) {
      tangent.subVectors(centres[Math.min(ring + 1, rings - 1)], centres[Math.max(ring - 1, 0)]).normalize();
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      binormal.crossVectors(tangent, normal);
      for (let side = 0; side < SIDES; side++) {
        const angle = side / SIDES * Math.PI * 2;
        const at = (ring * SIDES + side) * 3;
        outward.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
        outward.toArray(normals, at);
        outward.multiplyScalar(WIRE).add(centres[ring]).toArray(positions, at);
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    ends[0].position.copy(centres[0]);
    ends[1].position.copy(centres[rings - 1]);

    // The face rides the wire: it sits where the bends carry the point
    // between his eyes, squared to how they turn it.
    deform(origin, 0, EYES_Y, 0, 0, current);
    deform(across, .1, EYES_Y, 0, 0, current).sub(origin).normalize();
    deform(up, 0, EYES_Y + .1, 0, 0, current).sub(origin);
    facing.crossVectors(across, up).normalize();
    up.crossVectors(facing, across);
    face.position.copy(origin);
    face.quaternion.setFromRotationMatrix(basis.makeBasis(across, up, facing));
    const open = current.wide * Math.max(.1, 1 - current.blink);
    eyes.forEach(({ group, pupil }) => {
      group.scale.set(current.wide, open, 1);
      pupil.position.set(current.look[0] * .13, current.look[1] * .16, .075);
    });
    brows.forEach((group, i) => {
      const side = group.userData.side;
      group.position.set(side * .29, .52 + current.brows[i] * .16, .16);
      group.rotation.z = side * current.scowl * .5;
    });
    return clippy;
  }

  function carried(rest, target) {
    root.updateWorldMatrix(true, false);
    return root.localToWorld(deform(target, rest[0], rest[1], 0, 1, current));
  }

  const clippy = {
    root,
    pose,
    palm: target => carried(PALM, target),
    tip: target => carried(TIP, target),
  };
  return pose();
}
