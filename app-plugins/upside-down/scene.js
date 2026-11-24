// The Upside Down cast for Yeet, PR opened, Plan reveal and All settled: a kid
// out in the woods after dark with a torch in one hand and a walkie-talkie in
// the other. Bare trees stand round, a string of lights sags between them and
// falters, spores drift up, and the gate glows red in the trunk of a tree
// behind. For Yeet a monster from the other side claws the page open and
// comes through it, and the kid hurls the page at it and knocks it back
// through the gate as it snaps shut. The kid raises the PR on the
// walkie-talkie until the lights answer, unrolls the party's map, and rides a
// BMX round the clearing once everything is quiet. Every scene hits the beats
// ui/js/scene-poses.js times its overlay to.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, IcosahedronGeometry, Line, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, PointLight, Points, PointsMaterial, Quaternion,
  RepeatWrapping, SphereGeometry, SpotLight, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, fall, keys, mix, out, pulse, range, smooth, whip, wobble } from '../../ui/yeet/stage.js';
import { bendLimb, contactShadow, createFlecks, fling, keysV, paint, sample, wrap } from '../../ui/yeet/cast.js';
import { createPageMask, screenPoint } from '../../ui/yeet/tear.js';
import { SCENES } from '../../ui/js/scene-poses.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const NEON = 0xff2d3f;
const BARK = 0x0b0f18;
const BULBS = [0xff3b4a, 0xffc857, 0x4fd08a, 0x5aa9ff];
const SPORE_SPAN = 9;
const SKIN = 0xf2c29b;
const VEST = 0x1e9a8f;
const JEANS = 0x3f68b0;
const HAT = 0xd9482c;
const MUSTARD = 0xf2b53a;
const PAPER = '#f3e8c9';
const PEN = '#27305e';
const RED_PEN = '#c8102e';
const fract = x => x - Math.floor(x);
const AHEAD = new Vector3(1, 0, 0);
// The gate's tree: an old trunk, broad enough to hold it, close enough to
// read and well clear of the kid and the word.
const HOST = { x: -4.6, z: -8.6, height: 7.4, girth: 1.8 };
// How thick a trunk `height` tall is at `y`.
const girthAt = (height, y, girth = 1) => height * girth * (.06 - .05 * y / height);
// The gate sits on the face of that trunk.
const GATE = new Vector3(HOST.x, 2.3, HOST.z + girthAt(HOST.height, 2.3, HOST.girth));

const FACE = { blink: 0, smile: .4, jaw: 0, brow: 0, lookX: 0, lookY: 0, wide: 0 };
const mood = values => ({ ...FACE, ...values });

// Mouth flaps for a line spoken over [a, b]: open on the syllables, never
// quite shut between them.
const chatter = (t, a, b, rate = 17) => smooth(range(t, a, a + .06)) * (1 - smooth(range(t, b - .08, b))) * (.3 + .55 * Math.abs(Math.sin((t - a) * rate)) * (.7 + .3 * Math.sin((t - a) * rate * .37)));

// Moonlight and the gate's red in place of the swamp green.
function dress({ scene, key, glow }) {
  scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xd6dcff);
      light.groundColor.set(0x2a1620);
    } else if (light.isDirectionalLight && light !== key && light.position.z < 0) light.color.set(0xff5a64);
    else if (light.isAmbientLight) light.color.set(0xd8d4f0);
  });
  key.color.set(0xeef0ff);
  glow.color.set(NEON);
}

// Two sheets of spores, placed by stride so every replay runs the same. Each
// rises through the span and fades at its ends, half a span out of step with
// the other, so the air is never empty and nothing pops.
function spores(offset, map) {
  const positions = [];
  for (let i = 0; i < 110; i++) {
    const n = i + offset * 57;
    positions.push(((n * 0.618034) % 1 - 0.5) * 26, ((n * 0.754877) % 1) * SPORE_SPAN, -1 - ((n * 0.569840) % 1) * 12);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(geometry, new PointsMaterial({
    color: 0xcfdcf5, map, size: 0.2 + offset * 0.08, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  }));
}

// Bark: pale with dark grooves running up it, so a trunk catches the moon in
// streaks instead of as one flat band.
function grooves() {
  const texture = paint(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = fract(i * 0.618034) * w, from = fract(i * 0.377) * h, length = (0.25 + fract(i * 0.829) * 0.6) * h, width = 3 + fract(i * 0.27) * 8;
      // Each groove fades in and out along its length, and runs off the
      // bottom of the canvas onto the top.
      for (const top of [from, from - h]) {
        const groove = ctx.createLinearGradient(0, top, 0, top + length);
        groove.addColorStop(0, 'rgba(0,0,0,0)');
        groove.addColorStop(.5, 'rgba(0,0,0,' + (0.2 + fract(i * 0.531) * 0.35) + ')');
        groove.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = groove;
        ctx.fillRect(x, top, width, length);
      }
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

// A bare tree: a trunk that bends on its way up to a point and spreads into
// roots at the foot, and four boughs with two twigs each. `bend` is how far
// the trunk wanders, and `girth` how stout it is; the tree the gate is in
// stands straight.
function tree(bark, x, z, height, turn, bend = 1, girth = 1) {
  const trunk = new Group();
  // A stout trunk is seen close to: it takes more faces to stay round, and
  // more rings for its roots to spread smoothly.
  const stem = new CylinderGeometry(girthAt(height, height, girth), girthAt(height, 0, girth), height, ...(girth > 1 ? [20, 36] : [12, 10])).translate(0, height / 2, 0);
  const spot = stem.getAttribute('position');
  for (let i = 0; i < spot.count; i++) {
    const along = spot.getY(i) / height;
    // Roots in front of the gate would stand out of its glow.
    const foot = (1 - along) ** 16 * (bend ? 1 : .3);
    const flare = 1 + foot * (0.55 + 0.3 * Math.sin(Math.atan2(spot.getZ(i), spot.getX(i)) * 3 + turn));
    spot.setX(i, spot.getX(i) * flare + Math.sin(along * 2.6 + turn) * height * 0.014 * bend * along);
    spot.setZ(i, spot.getZ(i) * flare + Math.cos(along * 1.9 + turn * 2) * height * 0.01 * bend * along);
  }
  stem.computeVertexNormals();
  trunk.add(new Mesh(stem, bark));
  for (let i = 0; i < 4; i++) {
    const bough = new Group();
    bough.position.y = height * (0.44 + i * 0.13);
    bough.rotation.set(0, turn + i * 2.4, 0.95 - i * 0.14 + fract(turn + i * 0.37) * 0.2);
    const length = height * (0.4 - i * 0.06);
    const thick = height * 0.02 * girth * (1 - i * 0.14);
    bough.add(new Mesh(new CylinderGeometry(thick * 0.12, thick, length, 6).translate(0, length / 2, 0), bark));
    [[0.5, -0.85, 0.46], [0.76, 0.7, 0.3]].forEach(([at, tip, share], n) => {
      const reach = length * share;
      const twig = new Mesh(new CylinderGeometry(thick * 0.04, thick * 0.42 * (1 - at * 0.4), reach, 5).translate(0, reach / 2, 0), bark);
      twig.position.y = length * at;
      twig.rotation.set(0, n * 1.3 + i, tip);
      bough.add(twig);
    });
    trunk.add(bough);
  }
  trunk.position.set(x, 0, z);
  return trunk;
}

// The trees round the clearing, each a little paler the further back it
// stands, and a row of flat shapes far behind them that closes the woods in.
function woods(barkMap) {
  const stand = new Group();
  const near = new Color(BARK), far = new Color(0x1a2138);
  const spots = [[-6.8, -4.5, 6.2], [HOST.x, HOST.z, HOST.height], [-8.6, -9.5, 8], [5.6, -4.2, 5.8], [7.6, -7.5, 7.6], [4.4, -10.5, 8.4], [9.4, -11, 7], [-2.4, -13, 9], [1.8, -13.5, 8.6]];
  spots.forEach(([x, z, height], i) => {
    const bark = new MeshStandardMaterial({ color: near.clone().lerp(far, clamp((-z - 4) / 10)), map: barkMap, roughness: 0.95 });
    const host = x === HOST.x;
    stand.add(tree(bark, x, z, height, i * 1.7, host ? 0 : 1, host ? HOST.girth : 1));
  });
  stand.traverse(part => { part.castShadow = true; });
  const shade = new MeshBasicMaterial({ color: 0x11172a, transparent: true, opacity: 0.8 });
  for (let i = 0; i < 9; i++) stand.add(tree(shade, -13 + i * 3.3 + fract(i * 0.618) * 1.6, -17.5 - fract(i * 0.377) * 4, 9 + fract(i * 0.829) * 3, i * 2.1));
  return stand;
}

// A soft round falloff, for the gate's glow and the bulbs' halos: a plane
// with a hard edge reads as a box.
function falloff() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const fade = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.35, 'rgba(255,255,255,.45)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

// Mist lying low between the trunks, so the trees stand in something and the
// clearing has depth. Each bank drifts a little on its own; the one at the
// gate takes its red.
const MIST = [[-5.5, -5.5, 9, .1], [4.5, -6, 10, .09], [HOST.x, -7.4, 6, .16, NEON], [6.5, -9.5, 11, .12], [-1, -11.5, 13, .14], [0, -15, 22, .16], [-9, -12, 9, .12]];
function mist(map) {
  const banks = MIST.map(([x, z, width, opacity, color = 0x8ea0d6], i) => {
    const bank = new Sprite(new SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
    bank.position.set(x, 0.45 + fract(i * 0.618) * 0.3, z);
    bank.scale.set(width, 1.5 + fract(i * 0.377) * 0.8, 1);
    return { bank, x, opacity, red: color === NEON };
  });
  return {
    banks: banks.map(({ bank }) => bank),
    drift(t, heat) {
      banks.forEach(({ bank, x, opacity, red }, i) => {
        bank.position.x = x + Math.sin(t * 0.17 + i * 1.9) * 0.7;
        bank.material.opacity = opacity * (0.85 + 0.15 * Math.sin(t * 0.4 + i)) * (red ? heat : 1);
      });
    },
  };
}

// The string of lights, sagging between two trees from `ends` down to `low`
// at `z`. Each bulb has its own material so it can falter on its own, a cap
// where it meets the wire, and a halo that sits just in front of it, so the
// glass burns hottest in the middle. The host's word covers everything above
// about y 2.6 once it lands, so a scene whose lights answer under the word
// hangs them lower.
function lights(glowMap, { ends = 4.3, low = 3.2, z = -4.2, count = 15 } = {}) {
  const string = new Group();
  const wire = [];
  const bulbs = [];
  const socket = new MeshStandardMaterial({ color: 0x1c2420, roughness: 0.6 });
  const glass = new SphereGeometry(0.11, 16, 12);
  const cap = new CylinderGeometry(0.045, 0.06, 0.09, 8);
  for (let i = 0; i < count; i++) {
    const along = i / (count - 1);
    const x = -6.6 + along * 13.2;
    const y = ends - Math.sin(along * Math.PI) * (ends - low);
    wire.push(x, y, z);
    if (i === 0 || i === count - 1) continue;
    const colour = BULBS[i % BULBS.length];
    const material = new MeshBasicMaterial({ color: colour, toneMapped: false });
    const bulb = new Mesh(glass, material);
    bulb.scale.y = 1.4;
    bulb.position.set(x, y - 0.17, z);
    const holder = new Mesh(cap, socket);
    holder.position.set(x, y - 0.03, z);
    const halo = new Sprite(new SpriteMaterial({ map: glowMap, color: colour, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
    halo.position.set(x, y - 0.17, z + 0.16);
    string.add(bulb, holder, halo);
    bulbs.push({ bulb, material, halo, colour, phase: i * 1.91, along });
  }
  const line = new BufferGeometry();
  line.setAttribute('position', new Float32BufferAttribute(wire, 3));
  string.add(new Line(line, new LineBasicMaterial({ color: 0x3c4a44 })));
  return { string, bulbs };
}

// The gate's lips, raw while it burns and scabbed over once it has cooled.
const RAW = 0x4a1118;
const SCAB = 0x1d0b0f;
// How tall the gate is, half its width as it stands, and how many times that
// the beast can force it.
const TALL = 2;
const WIDE = .23;
const GAPE = 1.6;
// The way the gate faces, out of the trunk.
const FACING = new Vector3(0, 0, 1);
// The host trunk's thickness `y` above the middle of the gate, and how far its
// bark stands out there, `x` across from the middle.
const hostGirth = y => girthAt(HOST.height, GATE.y + y, HOST.girth);
const barkAt = (x, y) => Math.sqrt(Math.max(0, hostGirth(y) ** 2 - x * x)) - hostGirth(0);
// The most its roots spread the trunk there, as a share of its thickness.
const footSpread = y => .26 * (1 - (GATE.y + y) / HOST.height) ** 16;
// Half the gate's width `along` its height on `side` (-1 left, 1 right): a
// lens whose edge wanders, differently down each side, and pinches in above
// the middle.
const edgeAt = (side, along) => WIDE * Math.sin(clamp(along) * Math.PI) ** .7
  * (1 + .22 * Math.sin(along * 9 + side * 1.3) + .1 * Math.sin(along * 23 + side * 4))
  * (1 - .4 * Math.exp(-(((along - .62 - side * .02) / .07) ** 2)));
// How thick the lip is there, and how far from the edge its middle lies, in
// thicknesses: shut, the two lips overlap and leave a crease between them.
const LIP_APART = .75;
const lipAt = (side, along) => .028 + .07 * Math.sin(clamp(along) * Math.PI) ** .6 * (1 + .25 * Math.sin(along * 14 + side * 2));

// Ropes as one shape, `sides` round each: a rope runs through `points`, is
// `radius(i)` thick at each, and `lift(i)` is the way up off what it lies on.
function ropeGeometry(ropes, sides) {
  const corners = [], index = [];
  const tangent = new Vector3(), up = new Vector3(), across = new Vector3();
  for (const { points, radius, lift } of ropes) {
    const first = corners.length / 3;
    points.forEach((point, i) => {
      tangent.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
      up.copy(lift(i));
      up.addScaledVector(tangent, -tangent.dot(up)).normalize();
      across.crossVectors(tangent, up);
      const r = radius(i);
      for (let k = 0; k < sides; k++) {
        const turn = k / sides * Math.PI * 2, c = Math.cos(turn) * r, s = Math.sin(turn) * r;
        corners.push(point.x + up.x * c + across.x * s, point.y + up.y * c + across.y * s, point.z + up.z * c + across.z * s);
        if (i === points.length - 1) continue;
        const a = first + i * sides + k, b = first + i * sides + (k + 1) % sides;
        index.push(a, b, a + sides, b, b + sides, a + sides);
      }
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(corners, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// A shape that can be posed anywhere from shut to forced wide: `make(gape)`
// builds it at one width, and the mesh blends from its resting shape towards
// the shut one or the widest. Each of the three hugs the round of the trunk.
function gaping(make) {
  const shape = make(1);
  shape.morphAttributes.position = [make(0), make(GAPE)].map(posed => posed.getAttribute('position'));
  return shape;
}
const gapeTo = (mesh, gape) => {
  mesh.morphTargetInfluences[0] = Math.max(0, 1 - gape);
  mesh.morphTargetInfluences[1] = Math.max(0, (gape - 1) / (GAPE - 1));
};

// The gate's two lips at `gape` of its resting width: a thick rope of flesh
// down each side, the two meeting in a point past each end.
function lips(gape) {
  const count = 26;
  const along = i => mix(-.05, 1.05, i / (count - 1));
  return [-1, 1].map(side => ({
    points: Array.from({ length: count }, (_, i) => {
      const at = along(i), thick = lipAt(side, at);
      const x = side * (edgeAt(side, at) * gape + thick * LIP_APART), y = (at - .5) * TALL;
      return new Vector3(x, y, barkAt(x, y) + thick * .35);
    }),
    radius: i => (i === 0 || i === count - 1 ? .004 : lipAt(side, along(i))),
    lift: () => FACING,
  }));
}

// What has crept out of the gate: vines round the trunk from its lips, and
// roots down the trunk and out over the ground.
function growth() {
  const ropes = [];
  const outward = new Vector3();
  // A spot `off` the bark, `turn` round the trunk from the gate and `y` from
  // its middle.
  const onBark = (turn, y, off) => {
    const reach = hostGirth(y) * (1 + footSpread(y)) + off;
    return new Vector3(Math.sin(turn) * reach, y, Math.cos(turn) * reach - hostGirth(0));
  };
  const fromTrunk = point => outward.set(point.x, 0, point.z + hostGirth(0)).normalize();
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, at = .1 + fract(i * .618 + .3) * .8, count = 14;
    const y = (at - .5) * TALL, start = side * Math.asin(clamp((edgeAt(side, at) + lipAt(side, at)) / hostGirth(y)));
    const sweep = side * (.7 + fract(i * .377) * 1.6), climb = (fract(i * .829) - .6) * 1.6, thick = .016 + fract(i * .27) * .02;
    const points = Array.from({ length: count }, (_, k) => {
      const s = k / (count - 1);
      return onBark(start + sweep * s + Math.sin(s * 7 + i) * .1 * s, y + climb * s * s + Math.sin(s * 5 + i * 2) * .06 * s, thick * (1 - s) * .4);
    });
    ropes.push({ points, radius: k => thick * (1 - k / (count - 1)) + .003, lift: k => fromTrunk(points[k]) });
  }
  // Roots leave the lower lips, spread as they run down the trunk and reach
  // out over the ground the way they were heading.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, at = .06 + fract(i * .618 + .1) * .3, down = 10, along = 10;
    const y = (at - .5) * TALL, start = side * Math.asin(clamp(edgeAt(side, at) / hostGirth(y)));
    const spread = side * (.25 + fract(i * .377 + .5) * 1.1), length = .5 + fract(i * .829) * 1.3, thick = .028 + fract(i * .27) * .026;
    const points = Array.from({ length: down }, (_, k) => {
      const s = k / (down - 1);
      return onBark(start + spread * s ** 1.5 + Math.sin(s * 6 + i) * .05, mix(y, -GATE.y + thick * .5, s), thick * .3);
    });
    const foot = points[down - 1];
    for (let k = 1; k <= along; k++) {
      const s = k / along, heading = start + spread + Math.sin(s * 4 + i * 1.7) * .4;
      points.push(new Vector3(foot.x + Math.sin(heading) * s * length, -GATE.y + thick * (1 - s) * .5 + .01, foot.z + Math.cos(heading) * s * length));
    }
    ropes.push({
      points,
      radius: k => thick * Math.min(1, .3 + k * .35) * (1 - .85 * (k / (points.length - 1)) ** 1.5),
      lift: k => (k < down ? fromTrunk(points[k]) : UP),
    });
  }
  return ropes;
}

// The gate: a wound in the trunk held open by two lips of wet flesh, the
// other side burning through a skin strung with sinew between them, vines
// creeping out of it over the bark and the ground, and the light it throws.
// Shut, the lips press into a scar that glows down its seam until it cools;
// the vines stay.
function gate(glowMap) {
  const crack = new Group();
  const fleshMap = paint(96, 384, (ctx, w, h) => {
    // White-hot down a wandering middle, red towards the lips and dark under them.
    const across = ctx.createLinearGradient(0, 0, w, 0);
    [[0, '#1c0308'], [.12, '#7a0c1e'], [.3, '#e8261f'], [.43, '#ff6a2c'], [.5, '#ffd9a0'], [.57, '#ff6a2c'], [.7, '#e8261f'], [.88, '#7a0c1e'], [1, '#1c0308']]
      .forEach(([at, colour]) => across.addColorStop(at, colour));
    ctx.fillStyle = across;
    for (let y = 0; y < h; y += 2) {
      ctx.setTransform(1, 0, 0, 1, (Math.sin(y * .045) * .07 + Math.sin(y * .13 + 1) * .03) * w, 0);
      ctx.fillRect(-w, y, w * 3, 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 26; i++) {
      const x = fract(i * .618) * w, y = fract(i * .377) * h, r = 5 + fract(i * .829) * 12;
      const clot = ctx.createRadialGradient(x, y, 0, x, y, r);
      clot.addColorStop(0, 'rgba(110,8,26,.5)');
      clot.addColorStop(1, 'rgba(110,8,26,0)');
      ctx.fillStyle = clot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Sinew strung from lip to lip at every slant, and finer threads webbed
    // between the strands.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(34,3,10,.85)';
    const strand = (x0, y0, x1, y1, bow, width) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + bow, x1, y1);
      ctx.stroke();
    };
    for (let i = 0; i < 8; i++) {
      const from = h * (.04 + fract(i * .618 + .2) * .92), to = from + (fract(i * .377) - .5) * h * .34;
      strand(0, from, w, to, (fract(i * .829) - .5) * h * .1, 2 + fract(i * .27) * 3);
    }
    for (let i = 0; i < 12; i++) {
      const x = w * (.15 + fract(i * .377 + .4) * .7), y = h * fract(i * .618 + .7);
      strand(x, y, x + (fract(i * .829) - .5) * w * .9, y + (fract(i * .27) - .5) * h * .16, 0, 1.2);
    }
  });
  // Brighter patches that rise through the skin, so it is never still.
  const plasmaMap = paint(64, 128, (ctx, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = fract(i * .618) * w, y = fract(i * .377) * h, r = 8 + fract(i * .829) * 14;
      // Drawn again past each edge, so the patches wrap.
      for (const [dx, dy] of [[0, 0], [0, -h], [0, h], [-w, 0], [w, 0]]) {
        const patch = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        patch.addColorStop(0, 'rgba(255,214,160,.55)');
        patch.addColorStop(1, 'rgba(255,214,160,0)');
        ctx.fillStyle = patch;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  });
  plasmaMap.wrapS = plasmaMap.wrapT = RepeatWrapping;
  // The seam's glow: brightest in the middle and broken along its length.
  const cinderMap = paint(4, 128, (ctx, w, h) => {
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.sin(y / h * Math.PI) ** 1.5 * (.25 + .75 * fract(Math.sin(y * 12.9898) * 43758.5453) ** 2) + ')';
      ctx.fillRect(0, y, w, 3);
    }
  });

  // A strip up the bark and round it, `tall` high and `across` faces wide:
  // `half(side, along, y)` is half its width, `off(along, y)` how far it
  // stands off the trunk, and `span` how much of its map's width it shows.
  const strip = (tall, across, half, off, span = 1) => {
    const rows = 24, spots = [], uvs = [], index = [];
    for (let i = 0; i <= rows; i++) {
      const along = i / rows, y = (along - .5) * tall;
      for (let k = 0; k <= across; k++) {
        const u = k / across * 2 - 1, x = u * half(Math.sign(u), along, y);
        spots.push(x, y, barkAt(x, y) + off(along, y));
        uvs.push(.5 + (k / across - .5) * span, along);
        if (i === rows || k === across) continue;
        const a = i * (across + 1) + k, above = a + across + 1;
        index.push(a, a + 1, above, a + 1, above + 1, above);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(spots, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    return geometry;
  };
  const lit = (map, color) => new MeshBasicMaterial({ map, color, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const skin = gaping(gape => strip(TALL, 4, (side, along) => edgeAt(side, along) * gape + .02, () => .012));
  const inside = new Mesh(skin, new MeshBasicMaterial({ map: fleshMap, toneMapped: false }));
  const plasma = new Mesh(skin, lit(plasmaMap, 0xffffff));
  plasma.position.z = .004;
  // Where the two lips cross once shut, out from the bark.
  const crease = (.35 + Math.sqrt(1 - LIP_APART ** 2)) * 1.02;
  const thinner = along => Math.min(lipAt(-1, along), lipAt(1, along));
  const cinder = new Mesh(strip(TALL, 2, (side, along) => thinner(along) * .3, along => thinner(along) * crease), lit(cinderMap, 0xffa868));
  // Its light on the bark round it, which the lips and vines stand dark
  // against, and pooled on the ground at the foot of the tree. The light on
  // the bark stands clear of the roots the trunk spreads into.
  const shine = new Mesh(strip(TALL * 1.6, 12, (side, along, y) => hostGirth(y) * .98, (along, y) => .004 + hostGirth(y) * footSpread(y), .7), lit(glowMap, NEON));
  const pool = new Mesh(new PlaneGeometry(3.6, 2.6), lit(glowMap, NEON));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, .02 - GATE.y, .7);

  const flesh = new MeshStandardMaterial({ color: RAW, roughness: .35, envMapIntensity: .5, emissive: 0xff2030, emissiveIntensity: 0 });
  const raw = new Color(RAW);
  const mouth = new Mesh(gaping(gape => ropeGeometry(lips(gape), 8)), flesh);
  const sinew = new MeshStandardMaterial({ color: 0x2a0a10, roughness: .7, envMapIntensity: .4, emissive: 0xff2030, emissiveIntensity: 0 });
  const vines = new Mesh(ropeGeometry(growth(), 5), sinew);

  // Its glow in the air round the tree, from behind the trunk.
  const halo = new Mesh(new PlaneGeometry(2.9, 5.4), lit(glowMap, NEON));
  halo.position.z = -hostGirth(0);
  // The light from inside it: on the flanks of its lips, the vines and
  // whatever goes through.
  const lamp = new PointLight(0xff4030, 0, 6, 2);
  lamp.position.z = .05;
  crack.add(halo, shine, pool, vines, inside, plasma, mouth, cinder, lamp);
  crack.position.copy(GATE);
  return {
    crack,
    // `open` is how wide it stands, `surge` how hard it strains, `heat` how
    // hot it still burns and `jolt` the shudder that runs through its lips.
    pose(t, open, surge, heat, jolt) {
      const throb = .6 + Math.sin(t * 2.1) * .14 + Math.sin(t * 13) * .05;
      const gape = Math.min(GAPE, open * (1 + Math.sin(t * 2.1) * .07 + surge * .3));
      for (const part of [mouth, inside, plasma]) gapeTo(part, gape);
      // Pressed together, the lips can only bulge.
      mouth.scale.set(1 - Math.abs(jolt) * .12, 1 + jolt * .03, 1 + jolt * .8);
      flesh.color.setHex(SCAB).lerp(raw, heat);
      flesh.roughness = mix(.65, .35, heat);
      flesh.emissiveIntensity = heat * (.05 + throb * .1 + surge * .25);
      sinew.emissiveIntensity = heat * (.03 + throb * .05 + surge * .12);
      shine.material.opacity = heat * (.5 + throb * .5 + surge * .4);
      pool.material.opacity = heat * (.16 + throb * .14 + surge * .2);
      inside.visible = plasma.visible = gape > .01;
      inside.material.color.setScalar(.75 + throb * .4 + surge * .3);
      plasma.material.opacity = .35 + .1 * Math.sin(t * 13) + surge * .3;
      plasmaMap.offset.set(Math.sin(t * .9) * .08, -t * .45);
      cinder.visible = gape < .25 && heat > .01;
      cinder.material.opacity = heat * (1 - gape * 4) * (.7 + .3 * Math.sin(t * 31));
      // White-hot and wide as the lips meet, then a thread that dies from its ends.
      cinder.scale.set(.5 + 1.2 * heat ** 4, .35 + .65 * heat, 1);
      halo.material.opacity = throb * clamp(open) + surge * .5;
      lamp.intensity = heat * (.5 + throb * .6 + surge * 1.2);
    },
  };
}

// The woods, the mist, the lights, the spores and the gate, and one call that
// sets them for time `t`. `falter` is how often the bulbs dip (0 burns
// steady), `flare` swells every bulb, `level(bulb, i)` dims or lights one bulb
// on its own, `open` and `surge` are how wide the gate is and how hard it
// strains, `cool` is how far a shut gate has cooled, and `jolt` shudders its
// lips.
function createSet(scene, string = {}) {
  const glowMap = falloff();
  const barkMap = grooves();
  const air = [spores(0, glowMap), spores(1, glowMap)];
  const { string: wire, bulbs } = lights(glowMap, string);
  const portal = gate(glowMap);
  const fog = mist(glowMap);
  scene.add(woods(barkMap), ...fog.banks, wire, portal.crack, ...air);
  return {
    bulbs,
    textures: [glowMap, barkMap],
    update(t, { falter = .4, flare = 0, level = null, open = 1, surge = 0, cool = 1, jolt = 0, haze = 1 } = {}) {
      air.forEach((sheet, n) => {
        const phase = (t * 0.045 + n * 0.5) % 1;
        sheet.position.y = (phase - 0.5) * 3;
        sheet.position.x = Math.sin(t * 0.2 + n * 2) * 0.4;
        sheet.material.opacity = Math.sin(phase * Math.PI) * 0.75 * haze;
      });
      const heat = Math.max(clamp(open), 1 - cool);
      fog.drift(t, heat);
      const threshold = mix(1.01, .3, falter);
      bulbs.forEach((bulb, i) => {
        // Mostly lit, with the odd dip: two slow waves out of step with each other.
        const wave = Math.sin(t * 5.3 + bulb.phase) * Math.sin(t * 1.7 + bulb.phase * 2.3);
        const lit = (wave > threshold ? .15 : 1) * (level ? level(bulb, i) : 1);
        bulb.material.color.setHex(bulb.colour).multiplyScalar(Math.max(.12, lit));
        bulb.bulb.scale.set(1 + flare * .35, 1.4 * (1 + flare * .35), 1 + flare * .35);
        bulb.halo.material.opacity = clamp(lit) * (.42 + flare * .3);
        bulb.halo.scale.setScalar(.85 + flare * .45);
      });
      portal.pose(t, open, surge, heat, jolt);
    },
  };
}

// Walkie-talkie static, solid flecks for dirt and sparks, and the dice.
function burstParts() {
  const white = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const cyan = new MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false });
  const red = new MeshBasicMaterial({ color: 0xff4a5a, toneMapped: false });
  const ember = new MeshBasicMaterial({ color: 0xffb0a0, toneMapped: false });
  const gold = new MeshBasicMaterial({ color: 0xffd36a, toneMapped: false });
  const green = new MeshBasicMaterial({ color: 0x7dffa8, toneMapped: false });
  const soil = [0x4a3526, 0x6b4d33, 0x3a2b20].map(color => new MeshBasicMaterial({ color }));
  return {
    static: { geometry: new BoxGeometry(1, .18, .18), materials: [white, cyan, white], size: .09 },
    ember: { geometry: new OctahedronGeometry(1, 0), materials: [red, ember, red], size: .08 },
    spark: { geometry: new OctahedronGeometry(1, 0), materials: [gold, white, green], size: .06 },
    cinder: { geometry: new OctahedronGeometry(1, 0), materials: [white, ember, white], size: .045 },
    dirt: { geometry: new IcosahedronGeometry(1, 0), materials: soil, size: .06 },
  };
}

// A stripe texture for the jumper: wraps round the body, so the bands run
// across it.
function stripes() {
  return paint(64, 256, (ctx, w, h) => {
    const bands = ['#f4ead2', '#c8352b', '#f4ead2', '#2e4a8c', '#f4ead2', '#e7a93a'];
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = bands[i % bands.length];
      ctx.fillRect(0, i * h / 12, w, h / 12);
    }
  });
}

// Quilting for the body-warmer: stitched channels with a soft sheen in each.
function quilting() {
  return paint(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1e9a8f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const y = i * h / 8;
      const puff = ctx.createLinearGradient(0, y, 0, y + h / 8);
      puff.addColorStop(0, 'rgba(0,0,0,.25)');
      puff.addColorStop(.45, 'rgba(255,255,255,.18)');
      puff.addColorStop(1, 'rgba(0,0,0,.3)');
      ctx.fillStyle = puff;
      ctx.fillRect(0, y, w, h / 8);
      ctx.fillStyle = 'rgba(8,40,40,.7)';
      ctx.fillRect(0, y, w, 2);
    }
  });
}

const UPPER_ARM = .32;
const FORE_ARM = .3;
const THIGH = .4;
const SHIN = .4;
const HIP = .9;
// From the floor to where the shin enters the trainer's collar.
const ANKLE = .17;

// One limb of two bones for bendLimb, each lying along +x from its joint and
// tapering from `r0` at the mount through `r1` at the joint to `r2`.
function jointedLimb(parent, upper, fore, side, [r0, r1, r2], material) {
  const bone = (length, from, to) => {
    const shaft = new Mesh(new CylinderGeometry(to, from, length, 12).rotateZ(-Math.PI / 2).translate(length / 2, 0, 0), material);
    shaft.castShadow = true;
    return shaft;
  };
  const mount = new Group(), shoulder = new Group(), elbow = new Group(), grip = new Object3D();
  elbow.position.x = upper;
  grip.position.x = fore;
  elbow.add(bone(fore, r1, r2), new Mesh(new SphereGeometry(r1, 12, 8), material), grip);
  shoulder.add(bone(upper, r0, r1), elbow);
  mount.add(shoulder);
  parent.add(mount);
  return { side, mount, shoulder, elbow, grip, upper, fore };
}

// The kid: a big head under a bobble hat, a quilted body-warmer over a
// striped jumper, rolled jeans and hi-tops, with a rucksack on. Posed by
// where the hands and feet go: every limb is two bones solved by IK, as
// Spooky's skeleton is, so feet stay planted while the body moves.
function createKid() {
  const lambert = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: .82, emissive: color, emissiveIntensity: .12, ...extra });
  const textures = [];
  const stripeMap = stripes();
  const quiltMap = quilting();
  textures.push(stripeMap, quiltMap);
  const skin = lambert(SKIN, { roughness: .7, emissiveIntensity: .16 });
  const jumper = new MeshStandardMaterial({ map: stripeMap, roughness: .9, emissive: 0xffffff, emissiveMap: stripeMap, emissiveIntensity: .1 });
  const sleeve = jumper.clone();
  const vest = new MeshStandardMaterial({ map: quiltMap, roughness: .55, side: DoubleSide, emissive: VEST, emissiveIntensity: .12 });
  const denim = lambert(JEANS);
  const cuffDenim = lambert(0x7d9fd6);
  const white = lambert(0xf4f1ea, { emissiveIntensity: .18 });
  const redStripe = lambert(0xd4352b);
  const gum = lambert(0x9a6a3a);
  const hat = lambert(HAT);
  const hatCuff = lambert(MUSTARD);
  const hair = lambert(0x5a3420, { emissiveIntensity: .08 });
  const pack = lambert(0xc0612b);
  const packDark = lambert(0x7a3a1c);
  const dark = new MeshBasicMaterial({ color: 0x1c1420 });
  const eyeWhite = new MeshBasicMaterial({ color: 0xfbfaf6 });
  const mouthInside = new MeshBasicMaterial({ color: 0x5a1820 });
  const blush = new MeshBasicMaterial({ color: 0xff8a7a, transparent: true, opacity: .4, depthWrite: false });
  const freckle = new MeshBasicMaterial({ color: 0xb06a44 });
  const shadowy = mesh => { mesh.castShadow = true; return mesh; };

  const root = new Group();
  const hips = new Group();
  hips.position.y = HIP;
  root.add(hips);
  const seat = shadowy(new Mesh(new SphereGeometry(.2, 16, 12), denim));
  seat.scale.set(1.12, .72, .82);
  seat.position.y = .02;
  hips.add(seat);
  const spine = new Group();
  spine.position.y = .04;
  hips.add(spine);
  const chest = new Group();
  chest.position.y = .1;
  spine.add(chest);
  const torso = shadowy(new Mesh(new SphereGeometry(.27, 22, 16), jumper));
  torso.scale.set(1, 1.18, .8);
  torso.position.y = .24;
  chest.add(torso);
  // Open down the front, so the jumper shows; stops short of the hem and
  // the neck.
  const gap = 1.1;
  const warmer = shadowy(new Mesh(new SphereGeometry(.3, 22, 14, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, .5, 1.95), vest));
  warmer.scale.set(1.02, 1.1, .86);
  warmer.position.y = .26;
  chest.add(warmer);
  const collar = new Mesh(new TorusGeometry(.13, .04, 8, 18), vest);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = .54;
  collar.scale.set(1.15, 1, .95);
  chest.add(collar);

  const rucksack = new Group();
  rucksack.position.set(0, .26, -.25);
  const bag = shadowy(new Mesh(new BoxGeometry(.4, .44, .2), pack));
  const flap = new Mesh(new BoxGeometry(.42, .17, .22), packDark);
  flap.position.y = .17;
  const pocket = new Mesh(new BoxGeometry(.26, .16, .06), packDark);
  pocket.position.set(0, -.08, -.12);
  rucksack.add(bag, flap, pocket);
  [-1, 1].forEach(side => {
    const strap = new Mesh(new TorusGeometry(.2, .018, 5, 16, Math.PI * .95), packDark);
    strap.rotation.set(0, Math.PI / 2, 0);
    strap.position.set(side * .13, .02, .23);
    strap.scale.set(1, 1.15, .95);
    rucksack.add(strap);
  });
  chest.add(rucksack);

  const neck = new Group();
  neck.position.y = .52;
  chest.add(neck);
  neck.add(new Mesh(new CylinderGeometry(.075, .085, .1, 10).translate(0, .04, 0), skin));
  const head = new Group();
  head.position.y = .07;
  neck.add(head);
  const skull = shadowy(new Mesh(new SphereGeometry(.34, 26, 20), skin));
  skull.position.y = .3;
  skull.scale.set(1, .97, .95);
  head.add(skull);
  const face = new Group();
  face.position.y = .3;
  head.add(face);
  [-1, 1].forEach(side => {
    const ear = new Mesh(new SphereGeometry(.07, 10, 8), skin);
    ear.position.set(side * .33, -.01, -.02);
    ear.scale.set(.6, 1, .8);
    face.add(ear);
  });
  const nose = new Mesh(new SphereGeometry(.05, 12, 8), lambert(0xeaa98a));
  nose.position.set(0, -.04, .33);
  face.add(nose);
  const eyes = [-1, 1].map(side => {
    const eye = new Group();
    eye.position.set(side * .13, .03, .27);
    eye.rotation.y = side * .3;
    const ball = new Mesh(new SphereGeometry(.098, 14, 10), eyeWhite);
    ball.scale.set(1, 1.18, .5);
    const pupil = new Mesh(new SphereGeometry(.052, 12, 8), dark);
    pupil.scale.set(1, 1.15, .5);
    const shine = new Mesh(new SphereGeometry(.016, 6, 5), eyeWhite);
    shine.position.set(.016, .025, .025);
    pupil.add(shine);
    eye.add(ball, pupil);
    face.add(eye);
    return { eye, ball, pupil, side };
  });
  const brows = [-1, 1].map(side => {
    const bar = new Mesh(new BoxGeometry(.13, .032, .03), hair);
    face.add(bar);
    return { bar, side };
  });
  const grin = new Mesh(new TorusGeometry(.075, .016, 6, 16, Math.PI), dark);
  grin.rotation.z = Math.PI;
  const maw = new Mesh(new SphereGeometry(1, 16, 10), mouthInside);
  const teeth = new Mesh(new BoxGeometry(1, .3, .1), eyeWhite);
  maw.add(teeth);
  teeth.position.set(0, .62, .6);
  face.add(grin, maw);
  const cheeks = [-1, 1].map(side => {
    const cheek = new Mesh(new SphereGeometry(1, 10, 8), blush);
    cheek.position.set(side * .2, -.08, .27);
    cheek.rotation.y = side * .6;
    cheek.scale.set(.06, .04, .02);
    face.add(cheek);
    [[-.03, .01], [.02, .03], [.03, -.02]].forEach(([dx, dy]) => {
      const dot = new Mesh(new SphereGeometry(.009, 5, 4), freckle);
      dot.position.set(side * (.19 + dx), -.05 + dy, .29 - Math.abs(dx) * .5);
      face.add(dot);
    });
    return cheek;
  });

  const thatch = new Mesh(new SphereGeometry(.35, 20, 12, Math.PI + .35, Math.PI - .7, 0, Math.PI * .64), hair);
  thatch.position.y = .3;
  thatch.scale.set(1.01, .98, .97);
  head.add(thatch);
  // Tufts of hair poke out under the hat at the sides and back.
  [[-.3, .06, -.08], [.3, .06, -.08], [-.24, .1, -.22], [.24, .1, -.22], [0, .1, -.3], [-.13, .12, -.28], [.13, .12, -.28], [-.27, .14, .1], [.27, .14, .1]].forEach(([x, y, z], i) => {
    const tuft = new Mesh(new SphereGeometry(.075 + (i % 3) * .01, 8, 6), hair);
    tuft.position.set(x, y + .3, z);
    head.add(tuft);
  });
  // Pulled down to just above the brows, so the eyes stay clear.
  const beanie = new Group();
  beanie.position.set(0, .49, -.02);
  beanie.rotation.x = -.18;
  const crown = shadowy(new Mesh(new SphereGeometry(.31, 22, 12, 0, Math.PI * 2, 0, Math.PI * .5), hat));
  crown.scale.set(1, 1.05, .98);
  const band = new Mesh(new CylinderGeometry(.315, .325, .11, 22, 1, true), hatCuff);
  band.position.y = .01;
  const bobble = new Group();
  bobble.position.y = .33;
  const pom = shadowy(new Mesh(new IcosahedronGeometry(.085, 1), hatCuff));
  pom.position.y = .05;
  bobble.add(pom);
  beanie.add(crown, band, bobble);
  head.add(beanie);

  const arms = [-1, 1].map(side => {
    const arm = jointedLimb(chest, UPPER_ARM, FORE_ARM, side, [.075, .065, .058], sleeve);
    arm.mount.position.set(side * .27, .43, 0);
    const shoulderPuff = new Mesh(new SphereGeometry(.085, 12, 8), sleeve);
    arm.mount.add(shoulderPuff);
    const hand = shadowy(new Mesh(new SphereGeometry(.075, 12, 10), skin));
    hand.scale.set(1.05, .9, 1);
    arm.grip.add(hand);
    return arm;
  });
  const legs = [-1, 1].map(side => jointedLimb(root, THIGH, SHIN, side, [.095, .08, .075], denim));
  legs.forEach(leg => {
    const roll = new Mesh(new CylinderGeometry(.092, .092, .07, 12).rotateZ(-Math.PI / 2), cuffDenim);
    roll.position.x = SHIN - .07;
    leg.elbow.add(roll);
  });
  const feet = legs.map(leg => {
    const foot = new Group();
    const sole = new Mesh(new BoxGeometry(.15, .04, .3), gum);
    sole.position.set(0, .02, .05);
    const upper = shadowy(new Mesh(new SphereGeometry(.1, 12, 8), white));
    upper.scale.set(.78, .62, 1.45);
    upper.position.set(0, .07, .06);
    const top = shadowy(new Mesh(new CylinderGeometry(.085, .09, .14, 12), white));
    top.position.set(0, .14, -.01);
    const stripe = new Mesh(new BoxGeometry(.012, .035, .16), redStripe);
    stripe.position.set(leg.side * .073, .08, .05);
    stripe.rotation.x = -.35;
    foot.add(sole, upper, top, stripe);
    root.add(foot);
    return foot;
  });

  const toEnd = new Vector3();
  const pole = new Vector3();

  const point = new Vector3();
  return {
    root, hips, spine, chest, neck, head, beanie, bobble, arms, legs, feet, textures,
    left: arms[0], right: arms[1],
    // Call once the hips, spine and chest are set: hands are solved in the
    // chest's space, from targets given in the kid's own.
    settle() {
      legs.forEach(leg => leg.mount.position.set(hips.position.x + leg.side * .12, hips.position.y - .05, hips.position.z));
      root.updateMatrixWorld(true);
    },
    // A hand to a point in the kid's space, elbow out and down.
    hand(arm, target, poleY = -1) {
      toEnd.copy(target);
      chest.worldToLocal(root.localToWorld(toEnd)).sub(arm.mount.position);
      pole.set(arm.side * .8, poleY, -.35);
      bendLimb(arm, toEnd, pole);
    },
    // A foot to a point in the kid's space, knee forward. `pitch` tips the
    // toe down.
    step(leg, target, toe = 0, pitch = null) {
      const foot = feet[legs.indexOf(leg)];
      foot.position.copy(target);
      foot.rotation.set(pitch ?? -Math.min(.7, target.y * 2), toe, 0, 'YXZ');
      toEnd.copy(target).sub(leg.mount.position);
      toEnd.y += ANKLE;
      pole.set(leg.side * .2, 0, 1);
      bendLimb(leg, toEnd, pole);
    },
    // Where a hand is, in the kid's space.
    grip(arm, target = point) {
      return root.worldToLocal(arm.grip.getWorldPosition(target));
    },
    face({ blink, smile, jaw, brow, lookX, lookY, wide }) {
      const lid = Math.max(.1, 1 - blink);
      eyes.forEach(({ eye, ball, pupil, side }) => {
        eye.scale.set(1 + wide * .15, (1 + wide * .25) * lid, 1);
        pupil.position.set(lookX * .035 - side * .004, lookY * .035, .045);
        pupil.scale.set(1 - wide * .25, 1.15 * (1 - wide * .2), .5);
        pupil.visible = lid > .3;
        ball.scale.y = 1.18;
      });
      brows.forEach(({ bar, side }) => {
        bar.position.set(side * .13, .165 + brow * .03 + wide * .02, .29);
        bar.rotation.set(0, side * .3, side * (-.28 * Math.max(0, -brow) + .14 * Math.max(0, brow)));
      });
      const open = jaw > .1;
      maw.visible = open;
      grin.visible = !open;
      maw.position.set(0, -.16 - jaw * .03, .3);
      maw.scale.set(.05 + .035 * Math.max(0, smile) + .03 * jaw, .02 + .1 * jaw, .035);
      teeth.visible = smile > .2;
      grin.position.set(0, -.14 - .025 * Math.max(0, smile), .315);
      grin.scale.set(.75 + .5 * Math.abs(smile), smile < 0 ? Math.min(-.25, smile) : Math.max(.25, smile), 1);
      cheeks.forEach(cheek => cheek.scale.set(.06, .04, .02).multiplyScalar(.8 + .35 * Math.max(0, smile)));
    },
  };
}

// The torch: a chunky yellow body, a black rubber head and a lens that glows,
// with a soft cone of light ahead of it. It points along its own +z from the
// grip, and a spot light goes where it points.
function createTorch(scene, camera) {
  const body = new MeshStandardMaterial({ color: MUSTARD, roughness: .45, emissive: MUSTARD, emissiveIntensity: .15 });
  const rubber = new MeshStandardMaterial({ color: 0x24242a, roughness: .7, emissive: 0x24242a, emissiveIntensity: .2 });
  const torch = new Group();
  torch.rotation.order = 'YXZ';
  const handle = new Mesh(new CylinderGeometry(.052, .052, .26, 14).rotateX(Math.PI / 2), body);
  handle.position.z = .02;
  handle.castShadow = true;
  const head = new Mesh(new CylinderGeometry(.09, .06, .11, 16).rotateX(Math.PI / 2), rubber);
  head.position.z = .2;
  const lensMaterial = new MeshBasicMaterial({ color: 0xfff4c8, toneMapped: false });
  const lens = new Mesh(new CylinderGeometry(.075, .075, .01, 16).rotateX(Math.PI / 2), lensMaterial);
  lens.position.z = .258;
  const button = new Mesh(new BoxGeometry(.03, .02, .05), rubber);
  button.position.set(0, .055, .02);
  torch.add(handle, head, lens, button);
  // The beam in the air: brightest down its middle and at the lens, fading
  // out to nothing at its sides and its far end. The canvas's top is the far end.
  const beamMap = paint(128, 256, (ctx, w, h) => {
    for (let y = 0; y < h; y++) {
      const along = 1 - y / h;
      const half = w * (.04 + .46 * along);
      const strength = (1 - along) ** 1.6 * .9 + .04 * (1 - along);
      const across = ctx.createLinearGradient(w / 2 - half, 0, w / 2 + half, 0);
      across.addColorStop(0, 'rgba(255,236,180,0)');
      across.addColorStop(.3, 'rgba(255,238,188,' + strength * .5 + ')');
      across.addColorStop(.5, 'rgba(255,246,214,' + strength + ')');
      across.addColorStop(.7, 'rgba(255,238,188,' + strength * .5 + ')');
      across.addColorStop(1, 'rgba(255,236,180,0)');
      ctx.fillStyle = across;
      ctx.fillRect(0, y, w, 1);
    }
  });
  const beamMaterial = new MeshBasicMaterial({ map: beamMap, transparent: true, opacity: .8, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  // A flat sheet from the lens along +z, turned about the beam each frame to
  // face the camera, so its edges are the texture's soft ones.
  const beam = new Mesh(new PlaneGeometry(1.9, 3.8).translate(0, 1.9, 0).rotateX(Math.PI / 2), beamMaterial);
  beam.position.z = .26;
  const glareMap = paint(64, 64, (ctx, w) => {
    const fade = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    fade.addColorStop(0, 'rgba(255,250,230,1)');
    fade.addColorStop(.25, 'rgba(255,240,200,.4)');
    fade.addColorStop(1, 'rgba(255,236,180,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, w);
  });
  const glareMaterial = new SpriteMaterial({ map: glareMap, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  const glare = new Sprite(glareMaterial);
  glare.position.z = .28;
  glare.scale.setScalar(.55);
  torch.add(beam, glare);
  const spot = new SpotLight(0xffe8b8, 0, 9, .42, .55, 1.2);
  const aim = new Object3D();
  scene.add(spot, aim);
  spot.target = aim;
  const at = new Vector3();
  return {
    torch, textures: [beamMap, glareMap],
    // How bright it shines, 0 to 1, once the torch is posed for the frame.
    shine(power) {
      beamMaterial.opacity = .8 * power;
      glareMaterial.opacity = .9 * power;
      lensMaterial.color.setHex(0xfff4c8).multiplyScalar(.35 + .65 * power);
      torch.updateMatrixWorld(true);
      torch.worldToLocal(at.copy(camera.position));
      beam.rotation.z = Math.atan2(-at.x, at.y);
      spot.position.copy(lens.getWorldPosition(at));
      aim.position.copy(torch.localToWorld(at.set(0, 0, 4)));
      spot.intensity = 26 * power;
    },
  };
}

// The walkie-talkie: a yellow box with a speaker grille, a lamp that shows
// when it is talking or hearing, and a long aerial in segments that whip about.
// Its grip is the middle of its lower half; the aerial rises from the top.
function createWalkie() {
  const face = paint(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f0b429';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26262c';
    ctx.beginPath();
    ctx.roundRect(14, 22, w - 28, 132, 14);
    ctx.fill();
    ctx.fillStyle = '#4b4b55';
    for (let i = 0; i < 9; i++) ctx.fillRect(26, 34 + i * 13, w - 52, 6);
    ctx.fillStyle = '#26262c';
    ctx.fillRect(20, 176, 40, 28);
    ctx.fillRect(72, 176, 36, 28);
    ctx.fillStyle = '#c8352b';
    ctx.fillRect(14, 222, w - 28, 14);
  });
  const shell = new MeshStandardMaterial({ color: 0xf0b429, roughness: .5, emissive: 0xf0b429, emissiveIntensity: .14 });
  const front = new MeshStandardMaterial({ map: face, roughness: .5, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: .12 });
  const black = new MeshStandardMaterial({ color: 0x1e1e24, roughness: .6, emissive: 0x1e1e24, emissiveIntensity: .25 });
  const walkie = new Group();
  walkie.rotation.order = 'YXZ';
  const box = new Mesh(new BoxGeometry(.17, .32, .085), [shell, shell, shell, shell, front, shell]);
  box.position.y = .07;
  box.castShadow = true;
  const knob = new Mesh(new CylinderGeometry(.025, .025, .04, 10), black);
  knob.position.set(.045, .25, 0);
  const talk = new Mesh(new BoxGeometry(.02, .09, .04), black);
  talk.position.set(-.093, .1, 0);
  const lampMaterial = new MeshBasicMaterial({ color: 0x401010, toneMapped: false });
  const lamp = new Mesh(new SphereGeometry(.018, 8, 6), lampMaterial);
  lamp.position.set(-.05, .24, .045);
  walkie.add(box, knob, talk, lamp);
  const rod = new MeshStandardMaterial({ color: 0xd8d8de, roughness: .35, emissive: 0x808088, emissiveIntensity: .3 });
  const segments = [];
  let parent = new Group();
  parent.position.set(-.05, .23, 0);
  walkie.add(parent);
  const base = new Mesh(new CylinderGeometry(.022, .026, .05, 8).translate(0, .025, 0), black);
  parent.add(base);
  const SEGMENT = .15;
  for (let i = 0; i < 5; i++) {
    const joint = new Group();
    joint.position.y = i ? SEGMENT : .04;
    const bar = new Mesh(new CylinderGeometry(.009 - i * .0012, .011 - i * .0012, SEGMENT, 6).translate(0, SEGMENT / 2, 0), rod);
    joint.add(bar);
    parent.add(joint);
    segments.push(joint);
    parent = joint;
  }
  const tip = new Mesh(new SphereGeometry(.02, 8, 6), black);
  tip.position.y = SEGMENT;
  parent.add(tip);
  const talking = new Color(0xff3030), hearing = new Color(0x40ff80);
  return {
    walkie, textures: [face],
    // `reach` telescopes the aerial (0 down, 1 up); `sway` and `nod` bend it
    // sideways and fore-and-aft, more towards the tip.
    aerial(reach, sway, nod) {
      segments.forEach((joint, i) => {
        joint.scale.y = i ? Math.max(.02, reach) : 1;
        joint.rotation.set(nod * (.1 + i * .08), 0, sway * (.1 + i * .08));
      });
      tip.scale.y = 1 / Math.max(.02, reach);
    },
    // 0 dark, 1 red for talking; `heard` blends it to green.
    lamp(on, heard = 0) {
      lampMaterial.color.copy(talking).lerp(hearing, heard).multiplyScalar(.15 + .85 * on);
    },
  };
}

// A paper ball crumpled from the page, with the run's title on it.
function paperBall(title) {
  const texture = paint(256, 256, ctx => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = PEN;
    ctx.font = 'bold 26px system-ui';
    ctx.fillText('SHIPPED', 20, 40);
    ctx.font = 'bold 16px system-ui';
    wrap(title.trim() || 'This run', 220, 2, ctx.font).forEach((line, i) => ctx.fillText(line, 20, 70 + i * 20));
    // Heavy scribbles and a red stamp, so the ball still reads as a page
    // against the light scheme's pale dusk.
    ctx.strokeStyle = PEN;
    ctx.lineWidth = 7;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(20, 120 + i * 22);
      ctx.lineTo(200 + Math.sin(i * 3) * 30, 120 + i * 22);
      ctx.stroke();
    }
    ctx.fillStyle = RED_PEN;
    ctx.fillRect(150, 196, 86, 44);
  });
  const ball = new Mesh(new IcosahedronGeometry(.17, 1), new MeshStandardMaterial({ map: texture, roughness: .95, flatShading: true, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: .1 }));
  ball.castShadow = true;
  return { ball, texture };
}

// A soft ring that spreads from `at` and fades, facing the camera.
function ripple(scene, color) {
  const map = paint(128, 128, (ctx, w) => {
    const band = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    band.addColorStop(.5, 'rgba(255,255,255,0)');
    band.addColorStop(.78, 'rgba(255,255,255,.35)');
    band.addColorStop(.86, 'rgba(255,255,255,1)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, w);
  });
  const ring = new Sprite(new SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
  ring.visible = false;
  scene.add(ring);
  return (age, at, size = 3, life = .6) => {
    ring.visible = age > 0 && age < life;
    if (!ring.visible) return;
    ring.position.copy(at);
    // The band sits at 0.86 of the sprite's half width.
    ring.scale.setScalar((.15 + out(clamp(age / life)) * size) * 2 / .86);
    ring.material.opacity = (1 - clamp(age / life)) ** 1.5;
  };
}

// The kid's whole pose for a frame, from one object of numbers, so each scene
// only writes tracks. Hands and feet are points in the kid's space.
const STANCE = { x: 0, y: 0, z: 0, yaw: 0, size: 1.12, crouch: 0, sway: 0, lean: 0, twist: 0, tilt: 0, nod: 0, turn: 0, cock: 0 };
function poseKid(kid, p, hands, feet, toes = [-.15, .15]) {
  const { root, hips, spine, chest, neck, head } = kid;
  root.position.set(p.x, p.y, p.z);
  root.rotation.set(0, p.yaw, 0);
  root.scale.setScalar(p.size);
  hips.position.set(p.sway, HIP - p.crouch, 0);
  hips.rotation.set(p.crouch * .25, p.twist * .3, p.tilt * .4);
  spine.rotation.set(p.lean, p.twist * .4, p.tilt * .4);
  chest.rotation.set(p.lean * .4, p.twist * .3, p.tilt * .2);
  neck.rotation.set(p.nod * .3 - p.lean * .5, p.turn * .4, p.cock * .3);
  head.rotation.set(p.nod * .7, p.turn * .6, p.cock * .7);
  kid.settle();
  if (feet) kid.legs.forEach((leg, i) => kid.step(leg, feet[i], toes[i]));
  if (hands) kid.arms.forEach((arm, i) => kid.hand(arm, hands[i]));
  root.updateMatrixWorld(true);
}

// Sets a held prop at a hand, turned by `turn` ([x, y, z] in the kid's space).
function carry(kid, prop, arm, turn) {
  kid.grip(arm, prop.position);
  prop.rotation.set(turn[0], turn[1], turn[2]);
}

// The monster from the other side: tall and gaunt in a slick grey hide, with
// arms too long for it, hooked claws and no face, only a bud of five petals
// that opens into a mouth. Its limbs are two bones solved by IK, as the kid's
// are, and its hands go to points in the world, so they can hold the torn
// edges of the page.
const BEAST_ARM = [.88, .92];
const BEAST_LEG = [.64, .68];
const BEAST_HIP = 1.26;
const BEAST = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, size: 1, crouch: 0, lean: 0, nod: 0, turn: 0, bloom: 0, flutter: 0 };
const UP = new Vector3(0, 1, 0);

// Blotches and veins under the beast's skin, so it reads as wet hide and not
// as plastic.
function mottle() {
  return paint(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#7b6a72';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(52,40,50,.34)' : 'rgba(150,126,132,.3)';
      ctx.beginPath();
      ctx.ellipse(fract(i * .618) * w, fract(i * .377) * h, 5 + fract(i * .29) * 13, 3 + fract(i * .713) * 8, i, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(96,24,40,.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(fract(i * .41) * w, 0);
      ctx.bezierCurveTo(fract(i * .73) * w, h * .3, fract(i * .19) * w, h * .7, fract(i * .57) * w, h);
      ctx.stroke();
    }
  });
}

function createBeast() {
  const flesh = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: .36, emissive: color, emissiveIntensity: .07, ...extra });
  const skin = mottle();
  const hide = new MeshStandardMaterial({ map: skin, roughness: .36, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: .07 });
  const dusk = flesh(0x43373f);
  const gullet = flesh(0xb3182e, { roughness: .28, emissiveIntensity: .4 });
  const throat = new MeshBasicMaterial({ color: 0x24040a });
  const ivory = flesh(0xf3ead6, { roughness: .3, emissiveIntensity: .35 });
  const horn = flesh(0x1d181c, { roughness: .25 });
  const solid = mesh => { mesh.castShadow = true; return mesh; };
  const ball = new SphereGeometry(1, 18, 14);
  const blob = (material, [sx, sy, sz], [x, y, z]) => {
    const part = solid(new Mesh(ball, material));
    part.scale.set(sx, sy, sz);
    part.position.set(x, y, z);
    return part;
  };

  const root = new Group();
  root.rotation.order = 'YXZ';
  const hips = new Group();
  root.add(hips);
  hips.add(blob(hide, [.19, .15, .15], [0, 0, 0]));
  const spine = new Group();
  spine.position.y = .04;
  hips.add(spine);
  spine.add(solid(new Mesh(new CylinderGeometry(.17, .13, .5, 12).translate(0, .25, 0), hide)));
  const chest = new Group();
  chest.position.y = .46;
  spine.add(chest);
  chest.add(blob(hide, [.32, .35, .22], [0, .2, 0]));
  for (let i = 0; i < 4; i++) {
    const y = .31 - i * .085;
    const rib = new Mesh(new TorusGeometry(.322 * Math.sqrt(1 - ((y - .2) / .35) ** 2), .013, 5, 16, Math.PI), dusk);
    rib.rotation.x = Math.PI / 2;
    rib.scale.y = .7;
    rib.position.y = y;
    chest.add(rib);
  }
  const neck = new Group();
  neck.position.set(0, .5, .03);
  chest.add(neck);
  neck.add(solid(new Mesh(new CylinderGeometry(.085, .12, .26, 10).translate(0, .1, 0), hide)));
  const head = new Group();
  head.position.y = .26;
  neck.add(head);
  head.add(blob(hide, [.2, .2, .21], [0, 0, -.04]), blob(throat, [.14, .14, .08], [0, 0, .1]));
  const fang = new ConeGeometry(.017, .075, 5);
  const inward = new Vector3();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const tooth = new Mesh(fang, ivory);
    tooth.position.set(Math.cos(a) * .11, Math.sin(a) * .11, .16);
    tooth.quaternion.setFromUnitVectors(UP, inward.set(-Math.cos(a) * .6, -Math.sin(a) * .6, 1).normalize());
    head.add(tooth);
  }
  // Each petal hinges at the rim of the gullet: shut they meet in a point
  // ahead of it, open they lie back like a flower, teeth showing.
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = Math.PI / 2 + i * Math.PI * 2 / 5;
    const hinge = new Group();
    hinge.position.set(Math.cos(a) * .1, Math.sin(a) * .1, .08);
    hinge.rotation.z = a - Math.PI / 2;
    const flap = new Group();
    flap.add(blob(hide, [.17, .06, .27], [0, 0, .25]), blob(gullet, [.14, .035, .235], [0, -.04, .25]));
    for (let j = 0; j < 4; j++) {
      for (const x of [-1, 1]) {
        const tooth = new Mesh(fang, ivory);
        tooth.rotation.x = Math.PI;
        tooth.position.set(x * (.085 - j * .014), -.085, .1 + j * .1);
        flap.add(tooth);
      }
    }
    hinge.add(flap);
    head.add(hinge);
    return flap;
  });

  const arms = [-1, 1].map(side => {
    const arm = jointedLimb(chest, BEAST_ARM[0], BEAST_ARM[1], side, [.085, .06, .042], hide);
    arm.mount.position.set(side * .33, .38, 0);
    arm.mount.add(blob(hide, [.11, .11, .11], [0, 0, 0]));
    // Fingers lie along +x from the wrist with their backs to +y, and curl
    // towards the palm. The last of them is the thumb.
    const hand = new Group();
    hand.scale.setScalar(1.5);
    hand.add(blob(hide, [.08, .035, .07], [.07, 0, 0]));
    const fingers = [-1.5, -.5, .5, 1.5, 0].map((row, n) => {
      const thumb = n === 4;
      const base = new Group();
      base.position.set(thumb ? .03 : .13, 0, thumb ? -side * .07 : row * .042);
      const joints = [];
      let parent = base;
      (thumb ? [.1, .08, .06] : [.17, .14, .11]).forEach((length, k, lengths) => {
        const joint = new Group();
        if (k) joint.position.x = lengths[k - 1];
        joint.add(solid(new Mesh(new CylinderGeometry(.02 - k * .004, .025 - k * .004, length, 6).rotateZ(-Math.PI / 2).translate(length / 2, 0, 0), hide)));
        parent.add(joint);
        joints.push(joint);
        parent = joint;
      });
      const claw = solid(new Mesh(new ConeGeometry(.021, .2, 6).rotateZ(-Math.PI / 2).translate(.1, 0, 0), horn));
      claw.position.x = thumb ? .05 : .1;
      claw.rotation.z = -.35;
      parent.add(claw);
      hand.add(base);
      return { base, joints, row, thumb };
    });
    arm.grip.add(hand);
    return { ...arm, hand, fingers };
  });
  const legs = [-1, 1].map(side => jointedLimb(root, BEAST_LEG[0], BEAST_LEG[1], side, [.1, .06, .04], hide));
  const feet = legs.map(() => {
    const foot = new Group();
    for (const splay of [-.4, 0, .4]) {
      const toe = solid(new Mesh(new ConeGeometry(.04, .3, 6).rotateX(Math.PI / 2).translate(0, .03, .13), dusk));
      toe.rotation.y = splay;
      foot.add(toe);
    }
    root.add(foot);
    return foot;
  });

  const toEnd = new Vector3();
  const pole = new Vector3();
  const across = new Vector3();
  const basis = new Matrix4();
  const held = new Quaternion();
  const wanted = new Quaternion();
  return {
    root, head, arms, legs, textures: [skin],
    // The body for a frame, from a pose like BEAST; set the limbs after it.
    // `bloom` opens the petals and `flutter` is the phase they shake at.
    settle(p) {
      root.position.set(p.x, p.y, p.z);
      root.rotation.set(p.pitch, p.yaw, p.roll);
      root.scale.setScalar(p.size);
      hips.position.y = BEAST_HIP - p.crouch;
      hips.rotation.x = p.crouch * .3;
      spine.rotation.x = p.lean * .5;
      chest.rotation.x = p.lean * .5;
      neck.rotation.set(p.nod * .4, p.turn * .4, 0);
      head.rotation.set(p.nod * .6, p.turn * .6, 0);
      petals.forEach((flap, i) => { flap.rotation.x = mix(.26, -1.15, p.bloom) + Math.sin(p.flutter + i * 2.4) * .07 * p.bloom; });
      legs.forEach(leg => leg.mount.position.set(leg.side * .13, hips.position.y - .04, 0));
      root.updateMatrixWorld(true);
    },
    // A wrist to a point in the world, elbow out and down.
    reach(arm, target) {
      chest.worldToLocal(toEnd.copy(target)).sub(arm.mount.position);
      bendLimb(arm, toEnd, pole.set(arm.side * .7, -1, -.3));
    },
    // Lays a hand's fingers along `fingers` with their backs to `back`, both
    // in the world, by `weight`: at 0 the hand follows its forearm.
    aim(arm, fingers, back, weight) {
      arm.hand.quaternion.identity();
      if (weight <= 0) return;
      across.crossVectors(fingers, back).normalize();
      basis.makeBasis(fingers, pole.crossVectors(across, fingers), across);
      arm.grip.getWorldQuaternion(held).invert();
      arm.hand.quaternion.slerp(held.multiply(wanted.setFromRotationMatrix(basis)), weight);
    },
    // 0 holds the fingers out straight, 1 hooks them; `spread` fans them.
    flex(arm, curl, spread) {
      arm.fingers.forEach(({ base, joints, row, thumb }) => {
        base.rotation.y = thumb ? arm.side * .7 : -row * .2 * spread;
        joints.forEach((joint, k) => { joint.rotation.z = -curl * [.5, .75, .65][k] * (thumb ? .7 : 1); });
      });
    },
    // A foot to a point in the beast's own space, knee forward, toes hanging
    // once it is off the ground.
    step(leg, target) {
      const foot = feet[legs.indexOf(leg)];
      foot.position.copy(target);
      foot.rotation.x = Math.min(.9, target.y * 1.5);
      toEnd.copy(target).sub(leg.mount.position);
      toEnd.y += .08;
      bendLimb(leg, toEnd, pole.set(leg.side * .2, 0, 1));
    },
  };
}

// Strands of the page's skin across the tear, each anchored to the same point
// of both papers, so it stretches as they part, snaps at its own length and
// shrinks back to its edge.
function createStrands(scene, count) {
  const sinew = new MeshBasicMaterial({ color: 0x9e1b2e, toneMapped: false });
  const strand = new CylinderGeometry(1, 1, 1, 5).translate(0, .5, 0);
  const halves = Array.from({ length: count * 2 }, () => {
    const half = new Mesh(strand, sinew);
    scene.add(half);
    return half;
  });
  const span = new Vector3();
  return {
    // Strand `i` between `from` and `to` in the world, `age` after it snapped
    // (negative while it holds) and `strain` of the way to snapping.
    draw(i, from, to, age, strain) {
      const length = span.subVectors(to, from).length();
      const kept = age < 0 ? .5 : .5 * (1 - out(clamp(age / .16)));
      const width = (.006 + fract(i * .37) * .01) * (1 - .55 * clamp(strain));
      halves.slice(i * 2, i * 2 + 2).forEach((half, end) => {
        half.visible = kept > .01;
        half.position.copy(end ? to : from);
        half.quaternion.setFromUnitVectors(UP, span.subVectors(end ? from : to, end ? to : from).normalize());
        half.scale.set(width, length * kept, width);
      });
    },
  };
}

// Yeet. The gate snaps shut exactly when the send-offs plugin plays the voice.
const SHUT = 3.32;
const RELEASE = 2.93;
// The beast is through the page at LUNGE, and the page hits it at HIT.
const LUNGE = .92;
const HIT = 3.04;
// Where the host's crumpled page is (67% across, 45% down) at the kid's depth.
const SWOOP = new Vector3(1.95, 2.55, .9);
// Where the beast squares up to the kid.
const DEN = new Vector3(-1.9, 0, .6);
const STRANDS = 16;

// Beats: claws punch through the seam of the page (0.04-0.18) and haul its
// halves apart (0.15-0.9), the beast lunges through the tear (0.92) and roars
// at the room (1.0-1.5), and the kid jumps out of its skin (0.95-1.15), shakes
// (1.15-1.55) and steels itself (1.55-1.85) while the beast lopes off round
// it (1.6-2.3). The kid holds a hand out for the page (1.85-2.4), catches the
// ball (2.48), bounces it once (2.55-2.72) and winds up (2.72-2.93) as the
// beast rears over it (2.6), hurls it (2.93) down the beast's throat (3.04),
// which throws the beast back through the gate, unclips the walkie-talkie
// (3.05-3.15), turns back and reports in as the gate snaps shut (3.32), then
// punches the air (4.2-4.5).
const Y = {
  // Well off to one side while the beast is at the page, then two steps in
  // to where the page comes down.
  x: [[0, 2.3], [1.55, 2.3], [1.9, 1.05], [2.72, 1.05], [2.93, .9], [3.3, 1.0]],
  yaw: [[0, -.3], [.4, -.75], [.85, -.5], [.95, -.1, out], [1.5, -.2], [1.7, -.45], [1.9, .15], [2.45, .2], [2.6, .05], [2.72, -1.45], [2.82, -1.6], [RELEASE, -2.2, whip], [3.08, -2.05], [3.28, -.45], [3.7, -.3], [4.2, -.2], [4.6, -.05]],
  y: [[.92, 0], [1.02, .17, out], [1.14, 0, fall], [4.2, 0], [4.32, .08, out], [4.46, 0, fall]],
  crouch: [[0, .03], [.9, .03], [1.0, -.04], [1.15, .2, out], [1.5, .17], [1.7, .05], [2.42, .04], [2.5, .14, out], [2.62, .04], [2.72, .1], [2.85, .16], [RELEASE, .04, whip], [3.05, .14], [3.25, .05], [4.18, .05], [4.24, .12], [4.32, 0], [4.48, .1], [4.6, .03]],
  lean: [[0, .1], [.85, .18], [.95, -.18, out], [1.15, .05], [1.55, .08], [1.75, -.04], [2.4, .05], [2.72, -.1], [2.85, -.28], [RELEASE, .45, whip], [3.05, .38], [3.25, .05], [3.5, .02], [4.2, 0], [4.32, -.12], [4.6, 0]],
  twist: [[2.62, 0], [2.85, .8], [RELEASE, -.9, whip], [3.1, -.6], [3.3, 0]],
  tilt: [[1.15, 0], [1.3, .08], [1.45, -.06], [1.55, 0], [2.72, 0], [2.85, -.15], [RELEASE, .2, whip], [3.2, 0], [4.2, 0], [4.35, -.08], [4.6, 0]],
  nod: [[0, .05], [.95, -.25], [1.2, .05], [1.62, .3], [1.72, -.1], [1.82, .1], [2.42, .2], [2.6, .3], [2.72, 0], [RELEASE, .1], [3.3, .1], [3.6, .05], [4.2, .05], [4.32, -.15], [4.6, 0]],
  // The head follows the beast: round to the tear, then after it as it goes by.
  turn: [[0, -.4], [.4, -.7], [.85, -.3], [.95, 0, out], [1.5, -.1], [1.78, -.7], [2.0, 0], [2.45, .2], [2.6, .1], [2.72, 0], [2.85, -.4], [RELEASE, -.2], [3.2, -.5], [3.32, .1], [4.2, .2], [4.6, 0]],
  // Torch hand: low and ahead, flung up at the scare, pointed at the beast
  // through the wind-up, punched high at the end.
  left: [[0, -.3, 1.12, .34], [.95, -.3, 1.12, .34], [1.05, -.4, 1.42, .3, out], [1.5, -.36, 1.22, .36], [1.85, -.3, 1.0, .25], [2.45, -.32, 1.0, .2], [2.72, -.4, 1.25, .45], [RELEASE, -.4, 1.1, .3], [3.2, -.36, 1.02, .22], [4.18, -.36, 1.02, .22], [4.3, -.26, 2.05, .2, out], [4.6, -.3, 1.95, .24]],
  // Throwing hand: offered out for the page, cocked back high, whipped
  // through and down, to the clip on the vest, then up beside the mouth.
  right: [[0, .34, .92, .08], [.95, .34, .92, .08], [1.05, .45, 1.45, .25, out], [1.5, .36, 1.05, .22], [1.85, .36, .95, .1], [2.1, .48, 1.3, .5], [2.42, .5, 1.36, .5], [2.5, .46, 1.24, .46, out], [2.62, .42, 1.32, .44], [2.72, .4, 1.5, .1], [2.86, .34, 1.85, -.32], [RELEASE, -.12, 1.45, .58, whip], [3.04, -.18, .95, .42], [3.13, .16, 1.32, .24], [3.3, .2, 1.6, .44], [4.2, .2, 1.6, .44], [4.4, .3, 1.3, .32], [4.6, .3, 1.2, .3]],
  // Front foot: lifts for the wind-up and plants out towards the beast.
  footL: [[0, -.14, 0, .02], [1.55, -.14, 0, .02], [1.64, -.2, .1, .02], [1.73, -.14, 0, .02, fall], [2.72, -.14, 0, .02], [2.86, -.12, .2, .12], [RELEASE, -.2, 0, .3, fall], [3.25, -.2, 0, .3], [3.4, -.14, .1, .1], [3.5, -.14, 0, .02]],
  footR: [[0, .14, 0, -.02], [.95, .14, 0, -.02], [1.02, .16, .1, -.02], [1.14, .18, 0, -.02, fall], [1.72, .18, 0, -.02], [1.81, .1, .1, -.02], [1.9, .14, 0, -.02, fall], [2.9, .14, 0, -.02], [3.0, .18, 0, -.02], [3.1, .16, .12, .05], [3.2, .14, 0, 0, fall]],
  face: [
    [0, mood({ smile: -.1, brow: -.5, lookX: -.6 })],
    [.4, mood({ smile: -.2, brow: -.6, lookX: -1 })],
    [.85, mood({ smile: -.2, brow: -.5, lookX: -.3 })],
    [.95, mood({ jaw: .9, smile: -.3, brow: 1, wide: 1, lookX: -.2, lookY: .5 }), whip],
    [1.2, mood({ jaw: .55, smile: -.4, brow: .9, wide: .8, lookX: -.2, lookY: .5 })],
    [1.5, mood({ jaw: .15, smile: -.5, brow: -.8, wide: .3, lookX: -.5 })],
    [1.62, mood({ smile: -.2, brow: -.9, blink: .7 })],
    [1.75, mood({ smile: .3, brow: -.7, lookX: 0 })],
    [1.95, mood({ smile: .5, brow: .4, jaw: .3, lookX: .6, lookY: .5 })],
    [2.42, mood({ smile: .6, brow: .5, jaw: .2, lookX: .7, lookY: .6 })],
    [2.55, mood({ smile: .7, brow: -.3, lookX: .5, lookY: -.4 })],
    [2.72, mood({ smile: .5, brow: -.9, lookX: -1 })],
    [2.88, mood({ smile: -.2, brow: -1, jaw: .3, lookX: -1 })],
    [RELEASE, mood({ jaw: .9, smile: .2, brow: -.8, lookX: -1 }), whip],
    [3.15, mood({ jaw: .3, smile: .4, brow: .3, wide: .4, lookX: -1, lookY: .2 })],
    [3.28, mood({ smile: .8, brow: .5, lookX: -.4 })],
    [SHUT, mood({ smile: .9, brow: .8, wide: .3, lookX: -.2 })],
    [4.2, mood({ smile: 1, brow: .6, lookX: 0 })],
    [4.32, mood({ jaw: .7, smile: 1, brow: 1, blink: .8 })],
    [4.6, mood({ jaw: .3, smile: 1, brow: .6 })],
  ],
};

// The beast: pressed up behind the page, through it and rocked back to roar,
// off round the kid, reared up over the kid, and bowled over by the page.
const B = {
  // How far in front of the camera it stands, in the stage's `near`s.
  depth: [[0, 1.5], [.8, 1.16], [LUNGE, 1.02, fall], [1.05, .8, out], [1.5, .86]],
  // Round by its right, away from us, then back round to face the kid.
  yaw: [[1.5, 0], [1.74, 3.45, out], [2.1, 3.45], [2.36, 1.26]],
  crouch: [[0, .12], [.8, .12], [LUNGE, .34], [1.05, 0, out], [1.5, .06], [1.66, .3], [2.3, .26], [2.5, .2], [2.64, -.04, out], [2.95, 0]],
  lean: [[0, .32], [.8, .38], [LUNGE, .7], [1.06, -.16, out], [1.5, -.08], [1.68, .7], [2.25, .7], [2.45, .3], [2.64, -.2, out], [2.95, -.12], [HIT + .06, -.9, out]],
  // Which way the bud points, whatever the back is doing: up is negative.
  face: [[0, .1], [.8, 0], [1.05, -.12, out], [1.5, -.05], [1.7, .1], [2.3, 0], [2.64, -.1], [2.95, -.05]],
  turn: [[1.36, 0], [1.5, .9, out], [1.7, 0]],
  bloom: [[.96, 0], [1.02, .2], [1.1, 1.12, out], [1.2, 1], [1.5, .96], [1.68, .12], [2.5, .1], [2.6, 1.1, out], [2.72, 1], [HIT, .9], [HIT + .08, .35], [3.3, .2]],
  // A wrist in the beast's own space, mirrored for the other arm: out wide
  // for the roar, low on the run, up over the kid, flung out by the hit.
  hand: [[0, 1.05, 2.1, .7], [LUNGE, 1.05, 2.1, .7], [1.07, 1.25, 2.45, .35, out], [1.5, 1.2, 2.3, .3], [1.7, .4, 1.15, .6], [2.3, .42, 1.2, .55], [2.5, .5, 1.5, .5], [2.64, .85, 2.75, .45, out], [2.95, .9, 2.65, .5], [HIT + .07, .45, 2.0, 1.25, out], [3.3, .5, 2.2, 1.3]],
  curl: [[.8, .45], [1.05, .3, out], [1.5, .35], [1.7, .7], [2.5, .7], [2.64, .25, out], [2.95, .3], [HIT + .07, .6]],
};

function createGateScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  scene.add(camera);
  const tear = SCENES.yeet;
  const mask = createPageMask(camera, tear);
  const set = createSet(scene);
  const kid = createKid();
  const beast = createBeast();
  scene.add(kid.root, beast.root);
  const { torch, shine, textures: torchTextures } = createTorch(scene, camera);
  const radio = createWalkie();
  kid.root.add(torch, radio.walkie);
  const { ball, texture } = paperBall(title);
  scene.add(ball);
  const textures = [...set.textures, ...kid.textures, ...beast.textures, ...torchTextures, ...radio.textures, texture];
  const trail = Array.from({ length: 5 }, (_, i) => new Mesh(ball.geometry, new MeshBasicMaterial({ color: 0xffe6e0, transparent: true, opacity: .3 - i * .05, depthWrite: false })));
  scene.add(...trail);
  const shadow = contactShadow(scene, .3, 0x05030a);
  const flareMap = falloff();
  textures.push(flareMap);
  const glare = color => new Sprite(new SpriteMaterial({ map: flareMap, color, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
  // The flash as the gate shuts, in the air in front of it.
  const flare = glare(0xffd8dc);
  flare.position.copy(GATE).add(FACING);
  // The other side's red, behind the beast while it is at the page.
  const rift = glare(NEON);
  rift.scale.set(6.5, 8, 1);
  scene.add(flare, rift);
  const strands = createStrands(scene, STRANDS);
  const ring = ripple(scene, 0xffc0c8);
  const parts = burstParts();
  const embers = createFlecks(scene, 40, [parts.ember, parts.cinder]);
  const crackle = createFlecks(scene, 16, [parts.static]);
  const breach = createFlecks(scene, 26, [{ ...parts.ember, size: .03 }]);
  const spit = createFlecks(scene, 24, [parts.ember, parts.static]);
  const smack = createFlecks(scene, 20, [parts.spark, parts.static]);

  const hands = [new Vector3(), new Vector3()];
  const feet = [new Vector3(), new Vector3()];
  const p = { ...STANCE };
  const face = { ...FACE };
  const b = { ...BEAST };
  const at = new Vector3();
  const to = new Vector3();
  const holster = new Vector3();
  const speaker = new Vector3();
  const wrist = new Vector3();
  const grip = new Vector3();
  const outward = new Vector3();
  const fingers = new Vector3();
  const edge = { x: 0, y: 0 };
  const stride = [new Vector3(), new Vector3()];
  const { x: camX, y: camY, z: camZ } = camera.position;
  camera.updateMatrixWorld();
  const toCamera = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  // Once through the page the beast stands this far from the camera: its
  // open head fills the middle of a window of any shape.
  const near = Math.min(9.8, Math.max(3.4, 8.2 / camera.aspect));
  const standoff = t => near * keys(t, B.depth);
  // The unseen page stays between the beast's body and its claws until the
  // beast is through it, then falls back through the woods, so the scene
  // comes out over the page as every theme's does.
  const pageDepth = t => t < LUNGE ? standoff(t) - 1.15 : mix(standoff(LUNGE) + 1, 45, smooth(range(t, LUNGE, 1.4)));
  const gap = (t, along) => mask.edge(t, 1, along, 0, edge).x - mask.edge(t, -1, along, 0, edge).x;
  // Each strand gives once the tear is as wide as it is long, in percent of
  // the screen: the time that happens, found once.
  const snaps = Array.from({ length: STRANDS }, (_, i) => {
    const along = 5 + 90 * fract(i * .618 + .1), length = 5 + 22 * fract(i * .377 + .2);
    let from = .15, until = 1.25;
    for (let step = 0; step < 20; step++) {
      const middle = (from + until) / 2;
      if (gap(middle, along) < length) from = middle;
      else until = middle;
    }
    return { along, length, at: until };
  });

  function pose(t) {
    for (const key of ['x', 'yaw', 'y', 'crouch', 'lean', 'twist', 'tilt', 'nod', 'turn']) p[key] = keys(t, Y[key]);
    p.z = 1.5;
    const shake = pulse(t, 1.12, 1.58);
    p.sway = Math.sin(t * 47) * .012 * shake;
    p.tilt += Math.sin(t * 39) * .03 * shake;
    keysV(t, Y.left, hands[0]);
    keysV(t, Y.right, hands[1]);
    // The torch sweeps the woods while the kid creeps about.
    hands[0].x += Math.sin(t * 2.2) * .06 * (1 - range(t, .85, .95));
    hands[0].y += Math.sin(t * 50) * .01 * shake;
    // Gimme fingers while the page flies in.
    hands[1].y += Math.sin(t * 20) * .04 * pulse(t, 2.05, 2.42);
    hands[1].x += Math.sin(t * 15) * .05 * pulse(t, 4.25, 4.5);
    keysV(t, Y.footL, feet[0]);
    keysV(t, Y.footR, feet[1]);
    poseKid(kid, p, hands, feet);
    const f = sample(Y.face, t, face);
    f.jaw = Math.max(f.jaw, chatter(t, SHUT, 4.15));
    f.blink = Math.max(f.blink, pulse(t, .62, .72), pulse(t, 3.9, 4.0));
    kid.face(f);
    kid.bobble.rotation.set(wobble(t, .95, 14, 4) * .5 + wobble(t, RELEASE, 12, 4) * .4 + wobble(t, 4.3, 14, 4) * .4, 0, wobble(t, 2.9, 10, 4) * .4);
  }

  // How far the beast has gone from the page to its den, and from there to
  // the gate.
  const gone = t => smooth(range(t, 1.6, 2.32));
  const thrown = t => out(range(t, HIT, 3.29));

  function poseBeast(t) {
    const away = gone(t), back = thrown(t), gallop = away * Math.PI * 4, running = Math.sin(away * Math.PI);
    b.size = mix(1, 1.3, away) * (1 - smooth(range(t, 3.2, 3.3)));
    b.x = mix(mix(camX, DEN.x, away), GATE.x, back);
    b.z = mix(mix(camZ - standoff(t), DEN.z, away), GATE.z, back);
    b.y = Math.abs(Math.sin(gallop / 2)) * .3 + back * (GATE.y - 1.3 * b.size) + Math.sin(back * Math.PI) * 1.5;
    b.yaw = keys(t, B.yaw);
    b.pitch = -back * 2.6;
    const roar = pulse(t, 1.02, 1.5) + pulse(t, 2.6, 2.95);
    b.roll = Math.sin(t * 43) * .03 * roar;
    for (const key of ['crouch', 'lean', 'turn', 'bloom']) b[key] = keys(t, B[key]);
    b.nod = keys(t, B.face) - b.lean;
    // It casts about behind the page before it finds the way through.
    b.turn += Math.sin(t * 11) * .22 * (1 - range(t, .7, .9));
    b.flutter = t * 46;
    beast.settle(b);

    const held = 1 - smooth(range(t, .8, LUNGE));
    const curl = keys(t, B.curl);
    beast.arms.forEach((arm, i) => {
      const { side } = arm;
      keysV(t, B.hand, wrist);
      wrist.x *= side;
      wrist.y += Math.sin(t * 40 + i) * .03 * roar;
      wrist.z += side * Math.sin(gallop) * .45 * running;
      beast.root.localToWorld(wrist);
      if (held > 0) {
        // Each claw punches through the page on its own beat, hooks over the
        // torn edge of its paper and stays on it as the paper swings away.
        // Each holds a notch of its own paper, so the arms never cross, with
        // the knuckles on the edge, the fingers out over the page and the
        // claws sunk into it.
        const through = out(range(t, .04 + i * .06, .12 + i * .06));
        const swing = tear.pose(t).papers[i].rotate * Math.PI / 180;
        mask.edge(t, side, i ? 45.5 : 36.4, 0, edge);
        screenPoint(camera, edge.x, edge.y, pageDepth(t) + mix(.4, -.24, through), grip);
        outward.set(side * Math.cos(swing), -side * Math.sin(swing), 0).applyQuaternion(camera.quaternion);
        wrist.lerp(grip.addScaledVector(outward, -.2), held);
        fingers.copy(outward).addScaledVector(toCamera, .25).normalize();
      }
      beast.reach(arm, wrist);
      beast.aim(arm, fingers, toCamera, held);
      beast.flex(arm, curl, 1 - .5 * held);
    });
    beast.legs.forEach((leg, i) => {
      const swing = gallop + i * Math.PI;
      beast.step(leg, stride[i].set(leg.side * .2, Math.max(0, Math.cos(swing)) * .3 * running + back * .5, Math.sin(swing) * .5 * running + back * .7));
    });
  }

  function render(t) {
    // The camera moves first: the page and the claws on it are placed from it.
    const quake = pulse(t, SHUT, SHUT + .3) * .05 + pulse(t, .1, .3) * .015 + pulse(t, .5, .9) * .02 + pulse(t, 1, 1.45) * .045 + pulse(t, HIT, HIT + .16) * .03;
    camera.position.x = camX + Math.sin(t * 90) * quake;
    camera.position.y = camY + Math.sin(t * 75) * quake * .7;
    camera.updateMatrixWorld();

    pose(t);
    // The torch points ahead and a little down, at the beast through the
    // wind-up, and up with the fist at the end.
    const aimBeast = pulse(t, 2.62, 3.15);
    const punch = smooth(range(t, 4.22, 4.34));
    carry(kid, torch, kid.left, [mix(.25 - Math.sin(t * 2.2) * .05, -.1, aimBeast) - punch * 1.6, mix(-.25 + Math.sin(t * 1.3) * .25, .9, aimBeast) * (1 - punch) - range(t, .95, 1.05) * .4 * (1 - range(t, 1.6, 1.9)), 0]);
    shine(1 - .7 * pulse(t, .94, 1.1) - .5 * punch);

    // The walkie-talkie hangs on the vest until the throwing hand fetches it.
    const drawn = t >= 3.13;
    if (drawn) {
      carry(kid, radio.walkie, kid.right, [.1, -1.25, .12]);
      radio.walkie.position.y -= .04;
    } else {
      kid.chest.localToWorld(holster.set(.14, .22, .27));
      kid.root.worldToLocal(holster);
      radio.walkie.position.copy(holster);
      radio.walkie.rotation.set(-.1, .5, -.15);
    }
    radio.aerial(.25 + .75 * out(range(t, 3.14, 3.26)), wobble(t, 3.14, 16, 4) * .9 + Math.sin(t * 7) * .06 + wobble(t, 4.3, 16, 4) * .5, wobble(t, 3.2, 12, 4) * .5 + Math.sin(t * 5) * .04);
    radio.lamp(chatter(t, SHUT, 4.15) > 0 ? 1 : 0);

    poseBeast(t);
    beast.root.visible = t < 3.3;
    mask.sheet.visible = t < 1.4;
    mask.update(t, pageDepth(t));
    const skin = pageDepth(Math.min(t, LUNGE - .01)) - .03;
    snaps.forEach((strand, i) => {
      screenPoint(camera, mask.edge(t, -1, strand.along, 0, edge).x, edge.y, skin, at);
      screenPoint(camera, mask.edge(t, 1, strand.along, 0, edge).x, edge.y, skin, to);
      strands.draw(i, at, to, t - strand.at, gap(t, strand.along) / strand.length);
    });
    const away = gone(t);
    rift.position.set(camX, 2.5, camZ - standoff(t) - 2.4);
    rift.material.opacity = (.55 + .2 * Math.sin(t * 31)) * (1 - smooth(range(t, 1.45, 1.9)));
    rift.visible = t < 1.9;
    fling(breach, t - .16, screenPoint(camera, 50, 50, skin, at), 3, .05, .2, .8);
    fling(spit, t - 1.08, maw, 4.5, .1, .5, .7);

    // The page comes in from the host's crumple, lands in the hand, bounces
    // once, and goes from the throw straight down the beast's throat.
    const caught = range(t, 2.3, 2.48);
    ball.visible = t > 2.3 && t < HIT;
    if (t < RELEASE) {
      kid.right.grip.getWorldPosition(at);
      ball.position.lerpVectors(SWOOP, at, smooth(caught));
      ball.position.y += Math.sin(caught * Math.PI) * .35 + .3 * pulse(t, 2.56, 2.72) * (1 - range(t, 2.72, 2.75));
      ball.scale.setScalar(back(range(t, 2.3, 2.46), 2));
      ball.rotation.set(t * 2 + caught * 4, t * 1.4, 0);
    } else {
      flight(t, ball.position);
      ball.rotation.set(t * 11, t * 14, t * 6);
    }
    trail.forEach((ghost, i) => {
      const when = t - (i + 1) * .014;
      ghost.visible = when > RELEASE && t < HIT + .04;
      flight(when, ghost.position);
      ghost.scale.setScalar(1 - i * .12);
    });
    fling(smack, t - HIT, gullet, 4, .4, .8, .5);

    // The gate gapes for the beast and snaps shut on SHUT.
    const shut = whip(range(t, SHUT, SHUT + .07));
    const open = (1 - shut) * (1 + .5 * pulse(t, 3.2, SHUT));
    const strain = .8 * pulse(t, .1, 1.5) + pulse(t, HIT, SHUT);
    set.update(t, {
      falter: t < SHUT ? Math.max(.35 + .5 * range(t, 2.6, 3.25), .95 * (1 - range(t, 1.5, 1.9))) : 0,
      flare: pulse(t, SHUT, 3.9) * .9 + pulse(t, 1, 1.4) * .7,
      open, surge: strain,
      // The scar burns on down its seam for a second, and the lips shudder
      // from the slam.
      cool: out(range(t, SHUT + .07, SHUT + 1.1)),
      jolt: wobble(t, SHUT + .07, 38, 7),
      haze: 1 - .5 * range(t, SHUT, 4),
    });
    const age = t - SHUT;
    flare.visible = age > -.1 && age < .6;
    flare.scale.setScalar(2 + 5 * out(clamp((age + .1) / .25)) * (1 - clamp(age / .6)));
    flare.material.opacity = (1 - clamp(age / .6)) ** 2 * .6;
    ring(age, GATE, 3.4, .6);
    fling(embers, age, GATE, 7, .2, .8, 1.1);
    kid.root.localToWorld(speaker.copy(radio.walkie.position).add(at.set(0, .1, 0)));
    fling(crackle, t - SHUT, speaker, 2.2, .6, .4, .6);

    shadow.position.set(kid.root.position.x, .015, kid.root.position.z + .05);
    shadow.scale.set(.75, .48, 1).multiplyScalar(1 - clamp(kid.root.position.y * 2) * .3);
    // The red lights the beast from behind while it is at the page, then
    // goes back to the gate.
    glow.position.set(mix(camX, -1.8, away), mix(2.7, 2.4, away), mix(camZ - standoff(t) - 1.3, -2.5, away));
    glow.intensity = (6 + Math.sin(t * 2.1) * 1.5 + strain * 12 + 20 * (1 - away)) * (1 - shut * .85) + pulse(t, SHUT, 3.6) * 10;
    renderer.render(scene, camera);
  }

  pose(RELEASE);
  const origin = kid.right.grip.getWorldPosition(new Vector3());
  poseBeast(1.08);
  const maw = beast.head.localToWorld(new Vector3(0, 0, .45));
  poseBeast(HIT);
  const gullet = beast.head.getWorldPosition(new Vector3());
  // From the throwing hand to the beast's open head, hard and nearly flat.
  function flight(t, target) {
    const s = range(t, RELEASE, HIT);
    target.lerpVectors(origin, gullet, s);
    target.y += Math.sin(s * Math.PI) * .25;
    return target;
  }
  render(0);
  return { ready: warm(), canvas, render, masksPage: true, dispose: () => dispose(textures) };
}

// PR opened. Two tries on the walkie-talkie get nothing but static; on the
// overlay's `lands` the kid calls once more and the lights answer, bulb by
// bulb, then all at once.
const COPY = 3.05;
const SWEEP = .042;

const R = {
  yaw: [[0, -.25], [.5, .2], [.9, -.1], [1.55, .05], [2.05, -.15], [2.4, -.05], [2.9, -.2], [COPY, -.1], [3.6, .1], [4.4, 0]],
  // Low hops with the knees tucked up, so the face stays under the word.
  y: [[3.56, 0], [3.68, .1, out], [3.82, 0, fall], [3.92, 0], [4.04, .08, out], [4.18, 0, fall]],
  crouch: [[0, .04], [.9, .04], [1.0, .1], [1.5, .06], [1.6, .03], [2.05, .03], [2.2, .1], [2.4, .05], [2.85, .08], [COPY, .14], [3.12, .05], [3.5, .05], [3.56, .16], [3.66, 0], [3.82, .14], [3.92, .08], [4.0, 0], [4.18, .12], [4.35, .04]],
  lean: [[0, .12], [.9, .05], [1.0, .15], [1.5, .1], [1.6, -.05], [2.05, -.05], [2.4, .22], [2.85, .1], [2.95, -.08], [COPY, .14], [3.5, .05], [3.66, -.15], [3.82, .05], [4.04, -.12], [4.3, 0]],
  tilt: [[1.6, 0], [1.75, .12], [2.0, .1], [2.1, 0], [2.85, 0], [2.95, -.1], [3.2, .05], [3.5, 0]],
  nod: [[0, .15], [.6, .2], [.9, -.05], [1.0, .2], [1.5, .1], [1.62, -.35], [2.0, -.4], [2.1, .15], [2.4, .25], [2.85, .1], [2.95, -.35], [COPY, .1], [3.25, -.3], [3.5, -.1], [3.66, -.25], [4.3, 0]],
  turn: [[0, -.6], [.35, .6], [.7, -.3], [.9, 0], [1.62, .3], [2.0, -.3], [2.1, 0], [2.85, 0], [2.95, -.2], [COPY, -.5], [3.5, .5], [3.6, 0], [4.4, 0]],
  // Torch hand: sweeps low, then up at the lights while listening, raps
  // the walkie-talkie, and is flung up for joy.
  left: [[0, -.32, 1.1, .32], [.9, -.32, 1.1, .32], [1.6, -.34, 1.15, .3], [1.75, -.4, 1.45, .3], [2.0, -.38, 1.5, .3], [2.12, .02, 1.5, .36], [2.18, .06, 1.42, .36], [2.24, .02, 1.5, .36], [2.32, -.3, 1.2, .3], [2.85, -.32, 1.15, .3], [2.95, -.42, 1.45, .3], [COPY, -.34, 1.2, .32], [3.5, -.34, 1.2, .32], [3.66, -.42, 2.0, .2, out], [3.82, -.38, 1.7, .25], [4.04, -.42, 2.05, .2, out], [4.3, -.36, 1.6, .26]],
  // Walkie hand: low, up to the mouth, out in front to listen, shaken,
  // close for the second try, out again, back for the call, up for joy.
  right: [[0, .32, 1.0, .18], [.6, .32, 1.05, .22], [.95, .22, 1.6, .32], [1.5, .22, 1.6, .32], [1.62, .22, 1.45, .48], [2.05, .22, 1.45, .48], [2.4, .18, 1.62, .3], [2.85, .18, 1.62, .3], [2.95, .24, 1.45, .5], [COPY - .04, .2, 1.62, .32], [3.5, .2, 1.62, .32], [3.66, .4, 2.0, .2, out], [3.82, .36, 1.7, .25], [4.04, .42, 2.05, .2, out], [4.3, .32, 1.55, .3]],
  face: [
    [0, mood({ smile: -.1, brow: -.5, lookX: -1 })],
    [.35, mood({ smile: -.1, brow: -.5, lookX: 1 })],
    [.7, mood({ smile: 0, brow: -.3, lookX: -.4 })],
    [.9, mood({ smile: .3, brow: .3 })],
    [1.5, mood({ smile: .2, brow: .2 })],
    [1.62, mood({ smile: -.3, brow: -.6, lookY: 1, lookX: .3 })],
    [2.0, mood({ smile: -.5, brow: -.8, lookY: .9, lookX: -.5 })],
    [2.12, mood({ smile: -.6, brow: -1, blink: .6 })],
    [2.32, mood({ smile: -.3, brow: -.6, lookY: -.2 })],
    [2.85, mood({ smile: -.2, brow: -.4 })],
    [2.95, mood({ smile: -.4, brow: .9, wide: 1, lookY: 1 })],
    [COPY, mood({ smile: .6, brow: .9, wide: .6, lookY: .6, lookX: -1 })],
    [3.5, mood({ smile: .9, brow: .8, wide: .5, lookY: .6, lookX: 1 })],
    [3.6, mood({ smile: 1, brow: 1, jaw: .8, wide: .3 })],
    [4.0, mood({ smile: 1, brow: .9, jaw: .7, blink: .7 })],
    [4.4, mood({ smile: 1, brow: .6, jaw: .4 })],
  ],
};

function createCallScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  // Low enough to show under the two-line word as the lights answer.
  const set = createSet(scene, { ends: 2.45, low: 1.9, z: -2.6, count: 17 });
  const kid = createKid();
  scene.add(kid.root);
  const { torch, shine, textures: torchTextures } = createTorch(scene, camera);
  const radio = createWalkie();
  kid.root.add(torch, radio.walkie);
  const textures = [...set.textures, ...kid.textures, ...torchTextures, ...radio.textures];
  const shadow = contactShadow(scene, .3, 0x05030a);
  const parts = burstParts();
  const fizz = [1.62, 2.95].map(() => createFlecks(scene, 18, [parts.static]));
  const answer = createFlecks(scene, 40, [parts.spark, parts.static]);
  const joy = createFlecks(scene, 30, [parts.spark]);

  const hands = [new Vector3(), new Vector3()];
  const feet = [new Vector3(), new Vector3()];
  const p = { ...STANCE };
  const face = { ...FACE };
  const speaker = new Vector3();
  const lift = new Vector3(0, .12, 0);
  const camY = camera.position.y;
  const talking = t => Math.max(chatter(t, .98, 1.48), chatter(t, 2.42, 2.84, 21), chatter(t, COPY, 3.55));

  function render(t) {
    for (const key of ['yaw', 'y', 'crouch', 'lean', 'tilt', 'nod', 'turn']) p[key] = keys(t, R[key]);
    p.x = .5;
    p.z = 1.7;
    keysV(t, R.left, hands[0]);
    keysV(t, R.right, hands[1]);
    const rattle = pulse(t, 2.08, 2.32);
    hands[1].x += Math.sin(t * 60) * .035 * rattle;
    hands[0].x += Math.sin(t * 2.6) * .06 * (1 - range(t, .8, .95));
    // Up on the toes for the second, urgent try.
    const toes = pulse(t, 2.4, 2.86);
    p.y += .04 * toes * Math.abs(Math.sin(t * 9));
    const tuck = Math.max(pulse(t, 3.6, 3.82), pulse(t, 3.96, 4.18));
    feet[0].set(-.15, tuck * .3, .02 - tuck * .12);
    feet[1].set(.15, tuck * .3, -.02 - tuck * .12);
    poseKid(kid, p, hands, feet);
    const f = sample(R.face, t, face);
    f.jaw = Math.max(f.jaw, talking(t));
    f.blink = Math.max(f.blink, pulse(t, .5, .6), pulse(t, 2.6, 2.7));
    kid.face(f);
    kid.bobble.rotation.set(wobble(t, 3.68, 12, 4) * .5 + wobble(t, 4.04, 12, 4) * .5, 0, Math.sin(t * 60) * .1 * rattle);

    // Held out to listen, turned to the mouth to talk.
    const toMouth = Math.max(smooth(range(t, .9, 1.0)) * (1 - smooth(range(t, 1.5, 1.62))), smooth(range(t, 2.35, 2.42)) * (1 - smooth(range(t, 2.86, 2.95))), smooth(range(t, COPY - .1, COPY)) * (1 - smooth(range(t, 3.55, 3.66))));
    carry(kid, radio.walkie, kid.right, [mix(-.15, .12, toMouth), mix(-.35, -1.2, toMouth), mix(.08, .12, toMouth) + Math.sin(t * 60) * .15 * rattle]);
    const raised = out(range(t, .62, .82));
    radio.aerial(.22 + .78 * raised, wobble(t, .72, 18, 4) * 1.1 + wobble(t, 2.08, 22, 3) * .8 + wobble(t, 3.68, 14, 4) * .6 + wobble(t, 4.04, 14, 4) * .6 + Math.sin(t * 6) * .05, wobble(t, .8, 14, 5) * .4 + Math.sin(t * 4.3) * .05);
    const heard = range(t, COPY, COPY + .05);
    const fuzz = pulse(t, 1.6, 2.05) + pulse(t, 2.95, COPY);
    radio.lamp(Math.max(talking(t) > 0 ? 1 : 0, fuzz * (Math.sin(t * 70) > 0 ? 1 : .2), heard * (1 - range(t, 3.6, 4))), heard);

    const aim = range(t, 1.62, 1.75) * (1 - range(t, 2.0, 2.12)) + pulse(t, 2.92, COPY);
    const joyUp = Math.max(pulse(t, 3.6, 3.85), pulse(t, 3.98, 4.26));
    carry(kid, torch, kid.left, [mix(.3, -.75, aim) - joyUp * 1.2 + Math.sin(t * 2.2) * .05 * (1 - range(t, .8, .95)), mix(-.3 + Math.sin(t * 1.4) * .4 * (1 - range(t, .8, .95)), .1, aim) + .6 * pulse(t, 2.1, 2.3), 0]);
    shine(1);

    // The lights falter as the kid waits, go out as it holds its breath, and
    // answer one by one from the left on COPY, then flare together.
    const count = set.bulbs.length;
    set.update(t, {
      falter: t < COPY ? .4 + .5 * pulse(t, 1.55, 2.1) + .2 * range(t, 2.3, 2.85) : 0,
      level: (bulb, i) => t < 2.9 ? 1 : t < COPY ? 1 - smooth(range(t, 2.9, 2.98)) * .95 : smooth(range(t, COPY + i * SWEEP, COPY + i * SWEEP + .04)) * (1 + .6 * pulse(t, COPY + i * SWEEP, COPY + i * SWEEP + .25)),
      flare: pulse(t, COPY + count * SWEEP, COPY + count * SWEEP + .55) * 1.1 + pulse(t, 3.95, 4.3) * .4,
      open: .8, surge: pulse(t, 2.9, COPY) * .4,
    });

    kid.root.localToWorld(speaker.copy(radio.walkie.position).add(lift));
    fizz.forEach((burst, i) => fling(burst, t - [1.62, 2.95][i], speaker, 2.2, .5, .6, .6));
    fling(answer, t - COPY, speaker, 4.5, .9, 1.2, 1);
    kid.root.localToWorld(speaker.set(0, 1.9, .3));
    fling(joy, t - 3.62, speaker, 5, 1.2, 2, 1.1);

    shadow.position.set(kid.root.position.x, .015, kid.root.position.z + .05);
    shadow.scale.set(.75, .48, 1).multiplyScalar(1 - clamp(kid.root.position.y * 2) * .3);
    const bright = pulse(t, COPY + count * SWEEP, COPY + count * SWEEP + .6);
    glow.color.set(t < COPY ? NEON : 0xffd890);
    glow.position.set(0, 3, -1.5);
    glow.intensity = 5 + Math.sin(t * 2.1) + bright * 18;
    const quake = pulse(t, COPY + count * SWEEP, COPY + count * SWEEP + .3) * .03 + pulse(t, 3.8, 3.95) * .03;
    camera.position.x = .25 + Math.sin(t * 90) * quake;
    camera.position.y = camY + Math.sin(t * 75) * quake;
    renderer.render(scene, camera);
  }
  render(0);
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// Plan reveal. The map is slapped down on the boulder's sloping face at 1.62,
// rolls down it towards the camera and is all there on the overlay's `lands`;
// at 3.22 it lifts off and flies to `FRONT`, square to the camera, where the
// overlay pushes in.
const SLAP = 1.62;
const UNROLLED = 2.42;
const MAP_LANDS = 2.55;
const LIFT = [3.22, 4.05];
// Centred on the camera's line of sight, about half the view tall, as
// Ninetyseven's plan ends.
const FRONT = new Vector3(.25, 2.36, 6);
const END = [2.304, 2.1875];
const MAP = [1.3, 1.3 * END[1] / END[0]];
// The camera looks along the ground, so a map laid flat reads as a strip: the
// boulder's face tips it up towards the lens. TOP is the map's top edge.
const SLOPE = .9;
const TOP = new Vector3(-.12, 1.1, 2.6);
const DOWN = new Vector3(0, -Math.sin(SLOPE), Math.cos(SLOPE));
const OUTWARD = new Vector3(0, Math.cos(SLOPE), Math.sin(SLOPE));

const M = {
  yaw: [[0, -.5], [.4, .35], [.75, -.2], [.9, 0], [1.2, -.1], [SLAP, 0], [2.3, -.1], [MAP_LANDS, 0], [3.2, .05], [3.6, -.1]],
  y: [[MAP_LANDS - .04, 0], [MAP_LANDS + .1, .06, out], [MAP_LANDS + .24, 0, fall], [3.3, 0], [3.42, .07, out], [3.58, 0, fall]],
  crouch: [[0, .36], [.3, .4], [.9, .38], [1.3, .3], [1.5, .32], [SLAP, .42, whip], [1.75, .38], [2.3, .38], [2.42, .42], [MAP_LANDS, .1, out], [2.85, .08], [3.1, .14], [3.22, .07], [3.3, .1], [3.42, .06], [3.58, .14], [3.75, .1]],
  lean: [[0, .15], [.9, .12], [1.15, .05], [1.35, -.15], [1.5, .05], [SLAP, .35, whip], [1.75, .3], [2.3, .25], [2.42, .2], [MAP_LANDS, -.1, out], [2.8, .05], [3.1, .2], [3.22, -.2, whip], [3.5, 0]],
  nod: [[0, .3], [.4, .2], [.9, .1], [1.15, -.2], [1.35, -.1], [1.5, .2], [SLAP, .45], [2.3, .45], [2.42, .25], [MAP_LANDS, -.15], [2.8, .15], [3.1, .3], [3.22, -.3], [3.6, -.15]],
  turn: [[0, -.7], [.4, .7], [.75, -.3], [.9, 0], [1.1, -.5], [1.35, 0], [MAP_LANDS, 0], [2.85, .3], [3.1, 0], [3.22, 0]],
  tilt: [[1.35, 0], [1.45, .15], [1.55, 0], [2.85, 0], [2.95, .15], [3.1, 0]],
  // Torch hand: rests on the boulder lighting its face, punched up in
  // triumph, then sent after the map as it flies.
  left: [[0, -.32, .95, .42], [.9, -.32, .95, .42], [1.05, -.38, 1.2, .3], [1.35, -.4, 1.3, .3], [1.5, -.34, .95, .42], [2.42, -.34, .95, .45], [MAP_LANDS, -.4, 1.85, .3, out], [2.85, -.38, 1.65, .3], [3.1, -.36, 1.05, .45], [3.22, -.4, 1.6, .55, whip], [3.6, -.36, 1.5, .45]],
  // Map hand: over the shoulder into the rucksack, the roll held high,
  // slapped down on the top edge, a shove after it, a point at the map, a
  // flick to send it.
  right: [[0, .32, .9, .35], [.9, .32, .9, .35], [1.05, .26, 1.25, -.1], [1.2, .24, 1.3, -.18], [1.35, .36, 1.6, .2, out], [1.5, .3, 1.35, .4], [SLAP, .02, .95, .52, whip], [1.75, .06, .95, .55], [1.9, .1, .8, .72, out], [2.3, .2, .9, .5], [MAP_LANDS, .45, 1.25, .45, out], [2.75, .32, 1.1, .6], [2.95, .2, .9, .72], [3.1, .3, .85, .62], [3.22, .4, 1.6, .55, whip], [3.6, .38, 1.4, .45]],
  face: [
    [0, mood({ smile: -.1, brow: -.5, lookX: -1, lookY: -.3 })],
    [.4, mood({ smile: -.1, brow: -.5, lookX: 1, lookY: -.3 })],
    [.75, mood({ smile: 0, brow: -.3, lookX: -.5 })],
    [.9, mood({ smile: .4, brow: .4 })],
    [1.15, mood({ smile: .4, brow: .2, lookX: .8 })],
    [1.35, mood({ smile: .9, brow: .9, jaw: .4 })],
    [1.5, mood({ smile: .7, brow: .3, lookY: -1 })],
    [SLAP, mood({ smile: .5, brow: -.5, jaw: .3, lookY: -1 })],
    [2.3, mood({ smile: .7, brow: .3, lookY: -1 })],
    [2.42, mood({ smile: .8, brow: .6, wide: .4, lookY: -.6 })],
    [MAP_LANDS, mood({ smile: 1, brow: 1, wide: .3 })],
    [2.85, mood({ smile: 1, brow: .7, lookY: -.6, lookX: .3 })],
    [3.1, mood({ smile: .7, brow: .3, lookY: -.8 })],
    [3.22, mood({ smile: .9, brow: .9, jaw: .6, lookY: .4 })],
    [3.6, mood({ smile: 1, brow: .6, jaw: .3, lookY: .3 })],
  ],
};

// The party's plan, drawn by hand: a trail through the woods to an X, the
// run's title across the top, and a checklist down the side.
function planMap(title) {
  return paint(512, 486, (ctx, w, h) => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(80,110,170,.25)';
    ctx.lineWidth = 1;
    for (let y = 30; y < h; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(200,16,46,.35)';
    ctx.beginPath();
    ctx.moveTo(44, 0);
    ctx.lineTo(44, h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,100,40,.18)';
    ctx.beginPath();
    ctx.arc(430, 400, 46, 0, Math.PI * 2);
    ctx.fill();
    const hand = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive';
    ctx.fillStyle = RED_PEN;
    ctx.font = `bold 46px ${hand}`;
    ctx.fillText('THE PLAN', 58, 62);
    ctx.fillStyle = PEN;
    ctx.font = `bold 26px ${hand}`;
    wrap(title.trim() || 'This run', 420, 2, ctx.font).forEach((line, i) => ctx.fillText(line, 58, 102 + i * 30));
    ctx.strokeStyle = PEN;
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 9]);
    ctx.beginPath();
    ctx.moveTo(70, 440);
    ctx.bezierCurveTo(140, 330, 230, 440, 290, 330);
    ctx.bezierCurveTo(330, 260, 400, 300, 420, 210);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = RED_PEN;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(402, 192);
    ctx.lineTo(440, 230);
    ctx.moveTo(440, 192);
    ctx.lineTo(402, 230);
    ctx.stroke();
    ctx.fillStyle = '#2f6a3a';
    [[110, 330], [185, 300], [245, 250], [350, 390], [395, 440], [300, 215]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.moveTo(x, y - 26);
      ctx.lineTo(x + 15, y + 6);
      ctx.lineTo(x - 15, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 3, y + 6, 6, 9);
    });
    ctx.font = `bold 20px ${hand}`;
    ['torches', 'bikes', 'walkies'].forEach((item, i) => {
      const y = 182 + i * 34;
      ctx.strokeStyle = PEN;
      ctx.lineWidth = 3;
      ctx.strokeRect(60, y - 16, 18, 18);
      ctx.strokeStyle = RED_PEN;
      ctx.beginPath();
      ctx.moveTo(62, y - 8);
      ctx.lineTo(69, y);
      ctx.lineTo(82, y - 20);
      ctx.stroke();
      ctx.fillStyle = PEN;
      ctx.fillText(item, 88, y);
    });
  });
}

// A boulder with a flat face sloping down to the camera, just under the map:
// a rounded, knobbly block with everything proud of the face planed off.
function boulder() {
  const half = new Vector3((MAP[0] + .5) / 2, .65, .65);
  const centre = new Vector3(TOP.x, .5, TOP.z + .15);
  const plane = TOP.clone().addScaledVector(OUTWARD, -.03);
  const geometry = new BoxGeometry(half.x * 2, half.y * 2, half.z * 2, 8, 5, 6);
  const points = geometry.attributes.position;
  const v = new Vector3(), round = new Vector3();
  for (let i = 0; i < points.count; i++) {
    v.fromBufferAttribute(points, i);
    round.copy(v).divide(half).normalize().multiply(half);
    v.lerp(round, .45);
    // Knobbles by position, not index, so the box's shared corners stay shut.
    v.multiplyScalar(1 + (fract(Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453) - .5) * .1).add(centre);
    const proud = v.clone().sub(plane).dot(OUTWARD);
    if (proud > 0) v.addScaledVector(OUTWARD, -proud);
    points.setXYZ(i, v.x, Math.max(0, v.y), v.z);
  }
  geometry.computeVertexNormals();
  const rock = new Mesh(geometry, new MeshStandardMaterial({ color: 0x59606f, roughness: .95, flatShading: true, emissive: 0x59606f, emissiveIntensity: .14 }));
  rock.castShadow = rock.receiveShadow = true;
  return rock;
}

// A point on the boulder's face, `along` its slope from TOP and `off` above it.
const onFace = (target, along, off = 0, across = 0) => target.copy(TOP).addScaledVector(DOWN, along).addScaledVector(OUTWARD, off).setX(TOP.x + across);

function createMapScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const set = createSet(scene);
  const kid = createKid();
  scene.add(kid.root);
  const { torch, shine, textures: torchTextures } = createTorch(scene, camera);
  const radio = createWalkie();
  kid.root.add(torch, radio.walkie);
  const mapTexture = planMap(title);
  const textures = [...set.textures, ...kid.textures, ...torchTextures, ...radio.textures, mapTexture];
  const shadow = contactShadow(scene, .3, 0x05030a);
  scene.add(boulder());

  // The sheet hangs from its top edge, so growing it reveals the map from the
  // top down as the roll travels down the slope.
  const paper = new MeshStandardMaterial({ map: mapTexture, roughness: .9, side: DoubleSide, emissive: 0xffffff, emissiveMap: mapTexture, emissiveIntensity: .2 });
  const sheet = new Mesh(new PlaneGeometry(1, 1).translate(0, -.5, 0), paper);
  sheet.receiveShadow = true;
  const holder = new Group();
  holder.add(sheet);
  scene.add(holder);
  const rollMaterial = new MeshStandardMaterial({ color: 0xeadcb4, roughness: .85, emissive: 0xeadcb4, emissiveIntensity: .12 });
  const roll = new Mesh(new CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2), rollMaterial);
  roll.castShadow = true;
  scene.add(roll);
  // A twenty-sided die and a pencil ride inside the roll and spill out.
  const die = new Mesh(new IcosahedronGeometry(.075, 0), new MeshStandardMaterial({ color: 0xd8352b, roughness: .4, flatShading: true, emissive: 0xd8352b, emissiveIntensity: .2 }));
  die.castShadow = true;
  const pencil = new Group();
  const wood = new Mesh(new CylinderGeometry(.018, .018, .32, 6).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: MUSTARD, roughness: .6, emissive: MUSTARD, emissiveIntensity: .15 }));
  const tip = new Mesh(new ConeGeometry(.018, .05, 6).rotateZ(-Math.PI / 2), new MeshStandardMaterial({ color: 0xe8c9a0, roughness: .7 }));
  tip.position.x = .185;
  const rubber = new Mesh(new CylinderGeometry(.019, .019, .04, 6).rotateZ(Math.PI / 2), new MeshStandardMaterial({ color: 0xf08aa0, roughness: .7 }));
  rubber.position.x = -.18;
  pencil.add(wood, tip, rubber);
  scene.add(die, pencil);
  const parts = burstParts();
  const thump = createFlecks(scene, 22, [parts.dirt, parts.spark]);
  const sparkle = createFlecks(scene, 36, [parts.spark]);
  const toss = createFlecks(scene, 24, [parts.spark, parts.dirt]);

  const hands = [new Vector3(), new Vector3()];
  const feet = [new Vector3(), new Vector3()];
  const p = { ...STANCE };
  const face = { ...FACE };
  const onSlope = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), SLOPE - Math.PI / 2);
  const middle = new Vector3();
  const lead = new Vector3();
  const at = new Vector3();
  const camY = camera.position.y;

  function render(t) {
    for (const key of ['yaw', 'y', 'crouch', 'lean', 'nod', 'turn', 'tilt']) p[key] = keys(t, M[key]);
    p.x = -.1;
    p.z = 1.75;
    keysV(t, M.left, hands[0]);
    keysV(t, M.right, hands[1]);
    hands[0].x += Math.sin(t * 2.4) * .08 * (1 - range(t, .8, .95));
    hands[1].x += Math.sin(t * 13) * .06 * pulse(t, 2.6, 3.0);
    // Feet set wide for the crouch, together standing.
    const up = range(t, 2.42, 2.62);
    feet[0].set(-.22 + up * .08, 0, mix(-.22, .02, up));
    feet[1].set(.22 - up * .08, 0, mix(-.24, -.02, up));
    poseKid(kid, p, hands, feet);
    const f = sample(M.face, t, face);
    f.jaw = Math.max(f.jaw, chatter(t, MAP_LANDS, 3.3));
    f.blink = Math.max(f.blink, pulse(t, .6, .7), pulse(t, 2.0, 2.1));
    kid.face(f);
    kid.bobble.rotation.set(wobble(t, SLAP, 12, 4) * .5 + wobble(t, MAP_LANDS + .1, 12, 4) * .5 + wobble(t, 3.42, 12, 4) * .4, 0, 0);

    // The walkie-talkie rides on the vest; the torch lights the boulder.
    kid.chest.localToWorld(at.set(.14, .22, .27));
    radio.walkie.position.copy(kid.root.worldToLocal(at));
    radio.walkie.rotation.set(-.1, .5, -.15);
    radio.aerial(.25, wobble(t, SLAP, 14, 4) * .5 + Math.sin(t * 6) * .05, wobble(t, MAP_LANDS + .1, 12, 4) * .4);
    radio.lamp(0);
    const triumph = pulse(t, MAP_LANDS - .05, 3.05);
    carry(kid, torch, kid.left, [mix(.75, -.9, triumph) - .6 * pulse(t, 3.2, 3.8) - .4 * pulse(t, 1.05, 1.45), (1 - range(t, .8, .95)) * Math.sin(t * 1.5) * .5 + .2 * range(t, .8, .95), 0]);
    shine(1);

    // The roll: in the rucksack, then in the hand, slapped down on the top
    // edge, rolled down the face.
    const held = t >= 1.28 && t < SLAP;
    const unroll = out(range(t, SLAP + .1, UNROLLED)) + wobble(t, UNROLLED, 14, 7) * .012;
    const reach = MAP[1] * unroll;
    const radius = mix(.08, .028, clamp(unroll));
    roll.visible = t >= 1.28 && t < LIFT[0] + .02;
    if (held) {
      kid.right.grip.getWorldPosition(roll.position);
      roll.rotation.set(0, .2, .3);
      roll.scale.set(MAP[0] * .85, .08, .08);
    } else {
      onFace(roll.position, Math.min(reach, MAP[1]), radius + .01);
      roll.rotation.set(reach / radius, 0, 0);
      roll.scale.set(MAP[0] + .04, radius, radius);
    }

    // On the face, then lifting off and flying to the camera, square to it.
    const flight = 1 - (1 - range(t, LIFT[0], LIFT[1])) ** 3;
    holder.visible = t >= SLAP + .1;
    if (t < LIFT[0]) {
      onFace(holder.position, 0, .012);
      holder.quaternion.copy(onSlope);
      holder.scale.set(1, 1, 1);
      sheet.rotation.x = 0;
      sheet.scale.set(MAP[0], Math.max(.005, reach), 1);
      mapTexture.repeat.set(1, Math.max(.005, clamp(unroll)));
      mapTexture.offset.set(0, 1 - mapTexture.repeat.y);
    } else {
      sheet.scale.set(MAP[0], MAP[1], 1);
      mapTexture.repeat.set(1, 1);
      mapTexture.offset.set(0, 0);
      // The sheet's middle travels from the boulder to FRONT.
      onFace(middle, MAP[1] / 2, .012);
      at.lerpVectors(middle, FRONT, flight);
      at.y += Math.sin(flight * Math.PI) * .6;
      holder.quaternion.slerpQuaternions(onSlope, camera.quaternion, smooth(range(t, LIFT[0], LIFT[1] - .15)));
      holder.scale.setScalar(mix(1, END[0] / MAP[0], flight));
      // From its middle back up to its top edge, in the holder's turned frame.
      lead.set(0, MAP[1] / 2, 0).applyQuaternion(holder.quaternion).multiplyScalar(holder.scale.x);
      holder.position.copy(at).add(lead);
      sheet.rotation.x = Math.sin(t * 9) * .08 * (1 - flight);
    }

    // The die tumbles out as the roll passes and comes to rest by the X; the
    // pencil rolls down after it. Both are flicked off as the map goes.
    const spill = out(range(t, 1.95, 2.4));
    const kick = range(t, LIFT[0], LIFT[0] + .4);
    die.visible = pencil.visible = t >= 1.95 && t < LIFT[0] + .4;
    onFace(die.position, .25 + spill * .6, .07 + .25 * Math.sin(spill * Math.PI) * (1 - spill * .6), .38);
    die.position.y += kick * 1.4 - kick * kick * 2.2;
    die.position.z += kick * .5;
    die.rotation.set(spill * 9 + kick * 8, spill * 5, spill * 7);
    const glide = out(range(t, 2.05, 2.5));
    onFace(pencil.position, .3 + glide * .55, .02, -.35);
    pencil.position.y += kick * 1.1 - kick * kick * 1.8;
    pencil.position.z += kick * .4;
    pencil.rotation.set(glide * 14, .3, 0);

    set.update(t, {
      falter: t < MAP_LANDS ? .4 : .2,
      flare: pulse(t, MAP_LANDS, 3.1) * .8,
      open: 1, surge: pulse(t, .9, 1.15) * .4,
    });
    onFace(at, .05, .1);
    fling(thump, t - SLAP, at, 3, .6, 1.4, .7, .5);
    onFace(middle, MAP[1] / 2, .2);
    fling(sparkle, t - MAP_LANDS, middle, 4.5, 1, 1.2, 1.1);
    fling(toss, t - LIFT[0], middle, 4, 1, 1.4, .9);

    shadow.position.set(kid.root.position.x, .015, kid.root.position.z + .05);
    shadow.scale.set(.8, .55, 1);
    glow.position.set(0, 2.6, -2);
    glow.intensity = 6 + Math.sin(t * 2.1) * 1.5 + pulse(t, MAP_LANDS, 3) * 10;
    const bounce = pulse(t, MAP_LANDS - .05, MAP_LANDS + .25) * .025 + pulse(t, SLAP, SLAP + .2) * .03;
    camera.position.x = .25 + Math.sin(t * 90) * bounce;
    camera.position.y = camY + Math.sin(t * 75) * bounce * .6;
    renderer.render(scene, camera);
  }
  render(0);
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// A BMX: a small blue frame with yellow pads, knobbly tyres, high bars and
// cranks that turn. Built facing +z, with the rear tyre's contact patch at
// its origin so a wheelie pivots about it.
const WHEEL = .32;
const BASE = 1.0;

function createBike() {
  const paintwork = new MeshStandardMaterial({ color: 0x2f7fe0, roughness: .35, emissive: 0x2f7fe0, emissiveIntensity: .18 });
  const pad = new MeshStandardMaterial({ color: MUSTARD, roughness: .7, emissive: MUSTARD, emissiveIntensity: .15 });
  const tyre = new MeshStandardMaterial({ color: 0x26262c, roughness: .9, emissive: 0x26262c, emissiveIntensity: .25 });
  const steel = new MeshStandardMaterial({ color: 0xc8ccd6, roughness: .35, emissive: 0x6a6e78, emissiveIntensity: .3 });
  const bike = new Group();
  const tube = (a, b, radius, material) => {
    const from = new Vector3(...a), to = new Vector3(...b);
    const length = from.distanceTo(to);
    const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 8), material);
    mesh.position.lerpVectors(from, to, .5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), to.clone().sub(from).normalize());
    mesh.castShadow = true;
    bike.add(mesh);
    return mesh;
  };
  const wheel = z => {
    const hub = new Group();
    hub.position.set(0, WHEEL, z);
    const rubber = new Mesh(new TorusGeometry(WHEEL - .035, .04, 8, 28), tyre);
    rubber.rotation.y = Math.PI / 2;
    rubber.castShadow = true;
    const rim = new Mesh(new TorusGeometry(WHEEL - .075, .012, 6, 28), steel);
    rim.rotation.y = Math.PI / 2;
    const spin = new Group();
    for (let i = 0; i < 6; i++) {
      const spoke = new Mesh(new CylinderGeometry(.005, .005, (WHEEL - .075) * 2, 4), steel);
      spoke.rotation.x = i * Math.PI / 6;
      spin.add(spoke);
    }
    const cap = new Mesh(new CylinderGeometry(.03, .03, .08, 10).rotateZ(Math.PI / 2), steel);
    spin.add(cap);
    hub.add(rubber, rim, spin);
    bike.add(hub);
    return spin;
  };
  const rear = wheel(0);
  const front = wheel(BASE);
  const crank = [0, .3, .45];
  const seatTop = [0, .82, .22];
  const headTop = [0, .78, .86];
  const headLow = [0, .62, .9];
  tube(crank, seatTop, .028, paintwork);
  tube(crank, headLow, .03, paintwork);
  tube(seatTop, headTop, .026, paintwork);
  tube(headTop, headLow, .034, paintwork);
  [-1, 1].forEach(side => {
    tube([side * .05, WHEEL, 0], [side * .03, .3, .45], .016, paintwork);
    tube([side * .05, WHEEL, 0], [side * .02, .8, .23], .014, paintwork);
    tube([side * .05, WHEEL, BASE], [side * .03, .64, .89], .016, paintwork);
  });
  const stem = [0, .98, .82];
  tube(headTop, stem, .02, steel);
  tube([-.3, 1.06, .74], [.3, 1.06, .74], .016, steel);
  [-1, 1].forEach(side => tube([side * .12, .98, .82], [side * .27, 1.06, .74], .014, steel));
  const cross = tube([-.12, .99, .81], [.12, .99, .81], .012, steel);
  cross.position.y += .03;
  const barPad = new Mesh(new CylinderGeometry(.035, .035, .2, 10).rotateZ(Math.PI / 2), pad);
  barPad.position.set(0, 1.03, .8);
  const topPad = new Mesh(new CylinderGeometry(.045, .045, .42, 10), pad);
  topPad.position.set(0, .8, .54);
  topPad.rotation.x = Math.PI / 2 + .06;
  tube([0, .82, .22], [0, .92, .18], .016, steel);
  const saddle = new Mesh(new BoxGeometry(.13, .05, .26), tyre);
  saddle.position.set(0, .94, .17);
  saddle.rotation.x = -.08;
  bike.add(barPad, topPad, saddle);
  const cranks = new Group();
  cranks.position.set(...crank);
  const ring = new Mesh(new CylinderGeometry(.09, .09, .015, 18).rotateZ(Math.PI / 2), steel);
  ring.position.x = .06;
  cranks.add(ring);
  [-1, 1].forEach(side => {
    const arm = new Mesh(new BoxGeometry(.02, .17, .03).translate(0, -.085, 0), steel);
    arm.position.x = side * .08;
    arm.rotation.x = side > 0 ? 0 : Math.PI;
    const block = new Mesh(new BoxGeometry(.1, .025, .07), tyre);
    block.position.set(side * .06, -.17, 0);
    arm.add(block);
    cranks.add(arm);
  });
  bike.add(cranks);
  const grips = [-1, 1].map(side => new Vector3(side * .28, 1.06, .74));
  const seat = new Vector3(0, .97, .14);
  return {
    bike, grips, seat,
    // Wheels and cranks for a distance ridden.
    roll(distance) {
      rear.rotation.x = front.rotation.x = distance / WHEEL;
      cranks.rotation.x = distance / WHEEL * .55;
    },
    // A pedal's tread in bike space: 0 is the near (-x) side.
    pedalAt(i, target) {
      const angle = cranks.rotation.x + (i ? 0 : Math.PI);
      return target.set((i ? 1 : -1) * .14, crank[1] - .17 * Math.cos(angle), crank[2] - .17 * Math.sin(angle));
    },
  };
}

// All settled. Beats: the kid rides in from the left (0-1.2), pulls up into a
// wheelie (1.2-1.45) as the fireworks burst (1.45) and holds it with the torch
// punched high (1.45-2.2), drops the front (2.25), rides a lap of the
// clearing (2.35-4.35) and skids to a stop, foot down, to wave the torch at
// the sky (4.4-5.6).
const LAP = [2.35, 4.35];
const LAP_CENTRE = new Vector3(.4, 0, -.45);
const LAP_SIZE = [2.4, 1.35];
const C = {
  x: [[0, -6.4], [1.2, -1.1, out], [2.25, .4]],
  wheelie: [[1.18, 0], [1.42, .62, out], [1.6, .55], [1.85, .6], [2.05, .52], [2.22, 0, fall], [2.3, .04], [2.36, 0]],
  lean: [[0, 0], [1.2, -.05], [1.42, -.4, out], [2.05, -.35], [2.25, .1], [2.4, 0]],
};

function createRideScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const set = createSet(scene);
  const ride = createBike();
  const kid = createKid();
  const { torch, shine, textures: torchTextures } = createTorch(scene, camera);
  const radio = createWalkie();
  const heading = new Group();
  const bank = new Group();
  const pitch = new Group();
  heading.add(bank);
  heading.scale.setScalar(1.12);
  bank.add(pitch);
  pitch.add(ride.bike, kid.root);
  kid.root.add(torch, radio.walkie);
  scene.add(heading);
  const textures = [...set.textures, ...kid.textures, ...torchTextures, ...radio.textures];
  const shadow = contactShadow(scene, .32, 0x05030a);
  const parts = burstParts();
  const dust = [1.42, 2.25, 4.4].map(() => createFlecks(scene, 20, [parts.dirt]));
  const fireworks = createFireworks(scene, camera, { colors: [...BULBS, 0xffffff], geometry: new OctahedronGeometry(1, 0), sparks: 30 });

  const hands = [new Vector3(), new Vector3()];
  const feet = [new Vector3(), new Vector3()];
  const p = { ...STANCE };
  const face = { ...FACE };
  const at = new Vector3();
  const tread = new Vector3();
  const camY = camera.position.y;
  const JOY = mood({ smile: 1, brow: .7, jaw: .55 });

  // Where the bike is, which way it points and how far it has gone at `t`.
  function course(t) {
    if (t < LAP[0]) {
      const x = keys(t, C.x);
      return { x, z: LAP_CENTRE.z + LAP_SIZE[1], heading: Math.PI / 2, distance: x + 6.4, turn: 0 };
    }
    const lap = smooth(range(t, LAP[0], LAP[1]));
    const angle = lap * Math.PI * 2;
    const x = LAP_CENTRE.x + Math.sin(angle) * LAP_SIZE[0];
    const z = LAP_CENTRE.z + Math.cos(angle) * LAP_SIZE[1];
    const dx = Math.cos(angle) * LAP_SIZE[0], dz = -Math.sin(angle) * LAP_SIZE[1];
    const speed = Math.sin(lap * Math.PI);
    // The skid swings the back out after the lap.
    const skid = smooth(range(t, 4.35, 4.6)) * .55;
    return { x, z, heading: Math.atan2(dx, dz) - skid, distance: 6.8 + lap * 11, turn: speed + wobble(t, 4.6, 10, 5) * .3 };
  }

  function render(t) {
    const where = course(t);
    heading.position.set(where.x, 0, where.z);
    heading.rotation.y = where.heading;
    // Leans in towards the middle of the lap, and away for the skid.
    bank.rotation.z = keys(t, C.lean) - where.turn * .32 + .18 * pulse(t, 4.35, 4.75);
    const wheelie = keys(t, C.wheelie) + Math.sin(t * 9) * .03 * pulse(t, 1.45, 2.2);
    pitch.rotation.x = -wheelie;
    const stopped = smooth(range(t, 4.45, 4.7));
    ride.roll(where.distance);

    // Seated, hands on the bars, feet on the pedals; the torch hand lets go
    // to punch the sky through the wheelie and to wave once stopped.
    p.x = 0;
    p.y = 0;
    p.z = ride.seat.z;
    p.yaw = 0;
    p.size = .98;
    p.crouch = HIP - ride.seat.y / p.size + .02;
    p.sway = 0;
    p.lean = .38 - wheelie * .35 + .05 * Math.sin(t * 8) * (1 - stopped);
    p.twist = -.15 * stopped;
    p.tilt = .1 * pulse(t, 1.45, 2.2);
    p.nod = -.15 + .2 * wheelie - .2 * stopped;
    p.turn = -.6 * smooth(range(t, .2, .8)) * (1 - smooth(range(t, 1.1, 1.3))) - .9 * stopped;
    p.cock = .15 * pulse(t, 1.45, 2.2);
    const punch = Math.max(smooth(range(t, 1.3, 1.45)) * (1 - smooth(range(t, 2.1, 2.25))), stopped);
    // Bike space to the kid's: the kid sits at the saddle, a touch smaller.
    const own = (point, target) => target.set(point.x, point.y, point.z - p.z).divideScalar(p.size);
    ride.grips.forEach((grip, arm) => own(grip, hands[arm]));
    const wave = Math.sin(t * 12) * .1 * stopped;
    hands[0].lerp(at.set(-.3 + wave, 2.0, .25), punch);
    // Feet ride the pedals; stopped, the near foot comes down to the ground.
    ride.pedalAt(0, tread);
    own(tread, feet[0]);
    ride.pedalAt(1, tread);
    own(tread, feet[1]);
    feet[0].lerp(at.set(-.42, 0, .1), stopped);
    poseKid(kid, p, hands, null);
    kid.legs.forEach((leg, i) => kid.step(leg, feet[i], 0, i === 0 && stopped > .5 ? 0 : .25));
    kid.root.updateMatrixWorld(true);
    kid.face(Object.assign(face, t < 1.2 ? mood({ smile: .7, brow: .4, lookX: .8 }) : JOY, {
      jaw: t < 1.2 ? .1 : .55 + .3 * Math.sin(t * 7) * pulse(t, 1.45, 2.3),
      blink: Math.max(pulse(t, .7, .8), pulse(t, 3.2, 3.3)),
      lookX: t > 4.5 ? .5 : t < 1.2 ? .8 : 0,
    }));
    kid.bobble.rotation.set(wobble(t, 1.42, 10, 4) * .4 + wobble(t, 2.25, 12, 4) * .5 + Math.sin(t * 9) * .1, 0, Math.sin(t * 7) * .1);

    carry(kid, torch, kid.left, [mix(.1, -1.2, punch) + Math.sin(t * 12) * .2 * stopped, mix(0, -.3, punch), 0]);
    shine(1);
    kid.chest.localToWorld(at.set(.14, .22, .27));
    radio.walkie.position.copy(kid.root.worldToLocal(at));
    radio.walkie.rotation.set(-.1, .5, -.15);
    radio.aerial(.25, wobble(t, 2.25, 14, 4) * .6 + Math.sin(t * 8) * .1, Math.sin(t * 5) * .1);
    radio.lamp(0);

    set.update(t, { falter: 0, flare: fireworks.flash(t) * .5, open: 0, surge: 0, haze: .6 });
    fireworks.update(t);
    [1.42, 2.25, 4.4].forEach((when, i) => {
      at.set(where.x, .1, where.z);
      fling(dust[i], t - when, at, 3, .5, 1.2, .8, .4);
    });

    shadow.position.set(where.x, .015, where.z);
    shadow.rotation.z = -where.heading;
    shadow.scale.set(.42, .85, 1);
    glow.color.set(0xffd2a0);
    glow.position.set(0, 2.5, 1);
    glow.intensity = 6 + fireworks.flash(t) * 12;
    camera.position.y = camY + Math.sin(t * 75) * pulse(t, 2.22, 2.4) * .03;
    renderer.render(scene, camera);
  }
  render(0);
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: createGateScene, pr: createCallScene, plan: createMapScene, clear: createRideScene,
  look: {
    words: { yeet: 'GATE CLOSED.', pr: 'PR, DO YOU COPY?', plan: 'THE PARTY HAS A PLAN.', clear: 'ALL QUIET IN THE UPSIDE DOWN.' },
    background: 'radial-gradient(ellipse at 50% 60%,light-dark(#fbe9c8,#3a0f1c) 0%,light-dark(#e6c39c,#0d1424) 50%,light-dark(#a9a0b8,#03050a) 100%)',
    ink: 'light-dark(#1d1410,#f4f6fb)',
    glow: '0 5px 0 light-dark(#8a0d1e,#7a0f1c),0 0 70px light-dark(#c8102e50,#ff2d3f70)',
    flash: 'light-dark(#c8102e,#ff2d3f)',
    flashGlow: 'light-dark(#c8102e90,#ff2d3f90)',
  },
};
