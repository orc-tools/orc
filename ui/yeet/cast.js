// What the hand-posed casts share. Plush characters move through keyframes and throw
// sprites about. Christmas's snowman and Spooky's ghost move their hands along
// point tracks and burst into solid flecks over a contact shadow. The
// jointed ones (the snowman's arms, Spooky's skeletons, Upside Down's kid) bend
// their limbs with one two-bone solver. A theme keeps its own model, palette
// and choreography.
import {
  CanvasTexture, CircleGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector3,
} from 'three';
import { back, clamp, mix, range, smooth } from './stage.js';

const fract = x => x - Math.floor(x);

export const EASE = {
  s: smooth,
  l: u => u,
  o: u => 1 - (1 - u) * (1 - u),
  // Gravity: speeds up until something stops it.
  i: u => u * u,
  c: u => u * u * u,
  b: u => back(u, 1.8),
};

// [[time, changes, ease?], ...] on top of `base`: every key inherits the pose
// before it, so a key names only what moves, easing into it from the previous
// key.
export function keyframes(base, list) {
  let last = base;
  return list.map(([time, values, ease = 's']) => {
    last = { ...last, ...values };
    return [time, last, EASE[ease]];
  });
}

// A pose at `t` on a track of [[time, pose, ease?], ...], written into `out`.
export function sample(keys, t, out) {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i += 1;
  const [t0, a] = keys[i - 1], [t1, b, ease = smooth] = keys[i];
  const u = ease(range(t, t0, t1));
  for (const key in a) out[key] = mix(a[key], b[key], u);
  return out;
}

// sample() for a point: [[time, x, y, z, ease?], ...] into the vector `target`.
export function keysV(t, track, target) {
  let i = 1;
  while (i < track.length - 1 && t > track[i][0]) i += 1;
  const a = track[i - 1], b = track[i];
  const u = (b[4] || smooth)(range(t, a[0], b[0]));
  return target.set(mix(a[1], b[1], u), mix(a[2], b[2], u), mix(a[3], b[3], u));
}

const unit = x => Math.max(-1, Math.min(1, x));
// Made on first use, so a bundle that bends no limbs carries none of this.
let limbScratch;

// Two-bone IK in the limb's parent space: its end lands `d` from its mount
// with the joint bowed toward `pole`. `d` is pulled in to what the bones
// reach, from `nearest` to `slack` short of straight. The upper bone runs
// along the shoulder's x axis and the elbow turns about z.
export function bendLimb({ shoulder, elbow, upper, fore }, d, pole, nearest = .1, slack = .012) {
  limbScratch ||= { n: new Vector3(), u: new Vector3(), f: new Vector3(), y: new Vector3(), z: new Vector3(), basis: new Matrix4() };
  const { n, u, f, y, z, basis } = limbScratch;
  const length = d.length();
  const distance = Math.min(Math.max(length, nearest), upper + fore - slack);
  d.multiplyScalar(distance / length);
  u.copy(d).divideScalar(distance);
  n.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
  const opening = Math.acos(unit((upper ** 2 + distance ** 2 - fore ** 2) / (2 * upper * distance)));
  u.multiplyScalar(Math.cos(opening)).addScaledVector(n, Math.sin(opening));
  f.copy(d).addScaledVector(u, -upper).divideScalar(fore);
  y.copy(f).addScaledVector(u, -f.dot(u)).normalize();
  z.crossVectors(u, y);
  shoulder.quaternion.setFromRotationMatrix(basis.makeBasis(u, y, z));
  elbow.rotation.set(0, 0, Math.acos(unit(f.dot(u))));
}

// 0 -> 1 -> 0 parabola over [at, at + length]: a hop or a toss.
export const arc = (t, at, length) => {
  const u = range(t, at, at + length);
  return 4 * u * (1 - u);
};

export function paint(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function wrap(text, width, lines, font) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
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

// One sprite for each of `specs`, taking turns through `kinds` (textures of
// white shapes) and `colours` unless a spec names its own `map` or `color`.
// Each particle owns its material so it can fade and spin on its own.
export function particles(scene, specs, kinds, colours) {
  return specs.map((spec, i) => {
    const sprite = new Sprite(new SpriteMaterial({
      map: spec.map || kinds[i % kinds.length], color: spec.color ?? colours[i % colours.length],
      transparent: true, depthWrite: false, toneMapped: false,
    }));
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, gravity: 2.4, life: 1, size: .3, spin: 0, ...spec };
  });
}

export function drawParticles(list, t) {
  for (const p of list) {
    const age = t - p.at;
    const visible = age > 0 && age < p.life;
    p.sprite.visible = visible;
    if (!visible) continue;
    const u = age / p.life;
    p.sprite.position.set(p.o.x + p.v.x * age, p.o.y + p.v.y * age - p.gravity * age * age, p.o.z + p.v.z * age);
    p.sprite.scale.setScalar(p.size * back(clamp(age / .12), 2.5) * (1 - u * u));
    p.sprite.material.rotation = p.spin * age + Math.sin(age * 6 + p.v.x) * .25;
    p.sprite.material.opacity = 1 - u * u * u;
  }
}

// A radial spray: `count` particles leaving `origin` at `at`. `side` sends
// every particle one way along x, `turn` is [slowest spin, step between the
// three speeds], and `map` and `color` (one, or a list to take turns through)
// override what `particles` would pick.
export function spray(origin, at, count, { speed = 2.4, up = 1.2, depth = .8, life = 1, size = .32, gravity = 2.4, phase = 0, side = 0, turn = [1, 1], map, color } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i + phase) * 2.39996;
    const pace = speed * (.55 + (i * .618 % 1) * .7);
    return {
      at: at + (i % 3) * .015, o: origin, life: life * (.75 + (i % 4) * .1), gravity,
      size: size * (.7 + (i % 5) * .15), spin: (i % 2 ? 1 : -1) * (turn[0] + i % 3 * turn[1]),
      v: new Vector3((side ? side * Math.abs(Math.cos(angle)) : Math.cos(angle)) * pace, Math.abs(Math.sin(angle)) * pace * .6 + up, depth * (.4 + (i % 4) * .3)),
      ...(map && { map }), ...(color !== undefined && { color: Array.isArray(color) ? color[i % color.length] : color }),
    };
  });
}

// Solid burst particles on a fixed spiral of directions, taking turns through
// `parts` ({ geometry, materials, size }). fling() places them from the age of
// the burst alone.
export function createFlecks(scene, count, parts) {
  const group = new Group();
  scene.add(group);
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const part = parts[i % parts.length];
    const mesh = new Mesh(part.geometry, part.materials[i % part.materials.length]);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, x: Math.cos(a) * r, y, z: Math.sin(a) * r, speed: .55 + fract(i * .618) * .9, life: .55 + fract(i * .377) * .45, spin: fract(i * .29) * 2 - 1, size: part.size * (.6 + fract(i * .713) * .8) };
  });
}

export function fling(flecks, age, origin, power, up, gravity, life, flatten = 1) {
  for (let i = 0; i < flecks.length; i++) {
    const fleck = flecks[i];
    const end = life * fleck.life;
    const on = age > 0 && age < end;
    fleck.mesh.visible = on;
    if (!on) continue;
    const travel = (1 - Math.exp(-age * 3.2)) / 3.2 * power * fleck.speed;
    fleck.mesh.position.set(
      origin.x + fleck.x * travel,
      origin.y + (fleck.y * flatten + up) * travel - gravity * age * age,
      origin.z + fleck.z * travel * .8,
    );
    fleck.mesh.rotation.set(age * 9 * fleck.spin + fleck.x * 3, age * 6 + fleck.z * 3, age * 7 * fleck.spin);
    fleck.mesh.scale.setScalar(fleck.size * (1 - smooth(age / end)));
  }
}

export function contactShadow(scene, opacity, color = 0x000814) {
  const shadow = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .01;
  scene.add(shadow);
  return shadow;
}
