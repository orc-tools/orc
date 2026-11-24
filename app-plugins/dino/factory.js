// Dino Factory skin: a dinosaur park in a jungle clearing. The main agent is
// the visitor centre behind the park's torch-lit gate. Instructions leave
// through the gate as a convoy of tour cars on the guide rail, and a park
// truck brings each finished job back up the rail and in through the gate.
// Workers are the big paddocks (a rex pacing behind a high fence, a crane
// feeding the raptor pen, a long-neck browsing a tall tree) and subagents are
// the back rooms (the hatchery, the amber lab, the control desk). By night a
// storm comes in: rain, lightning behind the ridge and the fence lamps lit.
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh,
  MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, SphereGeometry, TorusGeometry, Vector3,
} from 'three';

const TAU = Math.PI * 2;

const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const cache = new WeakMap();
function bagOf(kit) {
  let bag = cache.get(kit);
  if (!bag) {
    bag = {};
    cache.set(kit, bag);
  }
  return bag;
}
function memo(kit, key, build) {
  const bag = bagOf(kit);
  return (bag[key] ||= build());
}

const palette = {
  light: {
    ground: '#93c46c',
    horizon: '#dcefc8',
    zenith: '#bfe6f2',
    sky: '#eef8dc',
    sun: '#fff3d0',
    glow: '#ffb02e',
    aisle: '#cdb98a',
    line: '#7d6a44',
    body: '#b9b4a6',
    trim: '#c8281e',
    roof: '#c9a85a',
    accent: '#d99a00',
    worker: '#6cbf43',
    busy: '#e8930c',
    ok: '#2f9e44',
    fail: '#d63a2a',
    idle: '#9a9a82',
    crate: '#b98a52',
    tape: '#f2b90f',
    smoke: '#f4f0e6',
    window: '#ffb347',
    door: '#3a2a20',
    sunIntensity: 2.4,
    skyIntensity: 1.4,
    envIntensity: 0.55,
    exposure: 1.04,
  },
  dark: {
    ground: '#223526',
    horizon: '#24383a',
    zenith: '#080d12',
    sky: '#2e4b4f',
    sun: '#c9d8ff',
    glow: '#ffa63d',
    aisle: '#3a3628',
    line: '#8a7a3a',
    body: '#59605a',
    trim: '#d8402e',
    roof: '#7a6436',
    accent: '#ffc233',
    worker: '#8fdc6a',
    busy: '#ffd166',
    ok: '#8fdc6a',
    fail: '#ff6b7a',
    idle: '#6f7a70',
    crate: '#8a6238',
    tape: '#ffc93a',
    smoke: '#cfd8d4',
    window: '#ffc468',
    door: '#0c100e',
    sunIntensity: 2,
    skyIntensity: 1.5,
    envIntensity: 0.75,
    exposure: 1.28,
  },
};

// A clearing, not a grid: the rows sweep back beside the gate and nothing
// stands square.
const layout = { bend: -0.25, stagger: 0.3, jitter: 0.2, turn: 0.35 };
const view = { elevation: 0.58, azimuth: 0.1 };

// Each animal's hide by day and by night: along the back, down the flank,
// underneath, and the markings over the back.
const HIDES = {
  rex: { back: ['#5e4a30', '#4c3d29'], flank: ['#8f7448', '#75603f'], belly: ['#dcc99a', '#b3a47c'], mark: ['#3d2f1f', '#30261a'] },
  raptor: { back: ['#7d5632', '#66472b'], flank: ['#b9824c', '#96683c'], belly: ['#ead8ac', '#bfb08a'], mark: ['#4a3220', '#3b281a'] },
  brachio: { back: ['#586c5a', '#4f6552'], flank: ['#82987f', '#70886f'], belly: ['#d6d3ae', '#aeae90'], mark: ['#46594a', '#3e5042'] },
};

function mats(kit) {
  return memo(kit, 'mats', () => {
    const dark = kit.mode === 'dark';
    const hide = (day, night) => kit.mat(dark ? night : day, { rough: 0.72, metal: 0.02 });
    return {
      rock: kit.mat(dark ? '#4a5148' : '#9d9a85', { rough: 0.95, flat: true }),
      stone: kit.mat(dark ? '#6c6a5e' : '#c4b9a3', { rough: 0.9, flat: true }),
      concrete: kit.mat(dark ? '#59605a' : '#b9b4a6', { rough: 0.85 }),
      ridge: kit.mat(dark ? '#1f3a2c' : '#5a8f6a', { rough: 0.95, flat: true }),
      blur: kit.mat(dark ? '#aab4b8' : '#59605c', { rough: 0.6, opacity: 0.22, doubleSide: true }),
      earth: kit.mat(dark ? '#3a3022' : '#9c7f55', { rough: 0.95 }),
      wood: kit.mat(dark ? '#5e432c' : '#8f6540', { rough: 0.9 }),
      timber: kit.mat(dark ? '#4a3524' : '#6f4c2e', { rough: 0.9 }),
      thatch: kit.mat(dark ? '#7a6436' : '#c9a85a', { rough: 0.95, flat: true }),
      steel: kit.mat(dark ? '#7d8a8c' : '#a9b3b5', { rough: 0.4, metal: 0.55 }),
      iron: kit.mat(dark ? '#1f2422' : '#353b38', { rough: 0.55, metal: 0.4 }),
      hazard: kit.mat(dark ? '#ffc93a' : '#f2b90f', { rough: 0.55, emissive: '#ffb400', glow: dark ? 0.35 : 0.04 }),
      red: kit.mat(dark ? '#d8402e' : '#c8281e', { rough: 0.5 }),
      paint: kit.mat(dark ? '#356b34' : '#3f8a3a', { rough: 0.55 }),
      cream: kit.mat(dark ? '#cfc4a0' : '#f3e8c6', { rough: 0.6 }),
      khaki: kit.mat(dark ? '#8f7f52' : '#c2ad74', { rough: 0.8 }),
      skin: kit.mat(dark ? '#b88a64' : '#e0b088', { rough: 0.7 }),
      glass: kit.mat(dark ? '#8fc4d6' : '#bfe9f5', { rough: 0.15, metal: 0.3 }),
      console: kit.mat(dark ? '#2f3836' : '#5b6660', { rough: 0.6, metal: 0.2 }),
      fire: kit.mat('#ff7a1f', { rough: 0.4, emissive: '#ff5a14', glow: dark ? 1.6 : 0.8 }),
      flame: kit.mat('#ffd166', { rough: 0.35, emissive: '#ffb347', glow: dark ? 1.8 : 0.95 }),
      amber: kit.mat('#f2a51e', { rough: 0.2, emissive: '#ff9a1e', glow: dark ? 1.1 : 0.45 }),
      bulb: kit.mat('#fff0c0', { rough: 0.3, emissive: '#ffd27a', glow: dark ? 1.7 : 0.8 }),
      fall: kit.mat(dark ? '#587d8e' : '#c4e6f0', { rough: 0.3, emissive: '#cfeaf5', glow: dark ? 0 : 0.06 }),
      bone: kit.mat(dark ? '#d9cdb0' : '#f6efd9', { rough: 0.6 }),
      leaf: kit.mat(dark ? '#2a5f2c' : '#4f9a3a', { rough: 0.8, doubleSide: true }),
      frond: kit.mat(dark ? '#357a36' : '#6cbf43', { rough: 0.78, doubleSide: true }),
      shell: kit.mat(dark ? '#d8caa4' : '#fbf1d6', { rough: 0.5, doubleSide: true }),
      ink: kit.mat('#1c120c', { rough: 0.3 }),
      water: kit.mat(dark ? '#16404e' : '#58bcd0', { rough: 0.5, metal: 0.05, emissive: '#3aa0b8', glow: dark ? 0.05 : 0.1 }),
      maw: kit.mat('#5a1410', { rough: 0.8 }),
      rex: hide(...HIDES.rex.flank),
      raptor: hide(...HIDES.raptor.flank),
      belly: hide('#f6e9b8', '#cdbf92'),
      claw: kit.mat(dark ? '#2b2620' : '#3a332a', { rough: 0.5 }),
      horn: kit.mat(dark ? '#8d856e' : '#b5aa90', { rough: 0.6 }),
      rexBrow: hide(...HIDES.rex.back),
      raptorBrow: hide(...HIDES.raptor.back),
    };
  });
}

// Rises fast and dies away over `life` seconds; 0 outside it.
function burst(age, life) {
  if (!(age >= 0 && age < life)) return 0;
  const t = age / life;
  return Math.min(1, t * 8) * (1 - t);
}

function drawPrint(ctx, x, y, size, turn = 0) {
  const s = size / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.beginPath();
  ctx.ellipse(0, 26 * s, 15 * s, 17 * s, 0, 0, TAU);
  ctx.fill();
  for (const [angle, length] of [[-0.62, 30], [0, 42], [0.62, 30]]) {
    ctx.save();
    ctx.translate(0, 18 * s);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-8.5 * s, 0);
    ctx.quadraticCurveTo(-10 * s, -length * s * 0.75, 0, -(length + 16) * s);
    ctx.quadraticCurveTo(10 * s, -length * s * 0.75, 8.5 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawWarningStripes(ctx, w, h, step = 24) {
  ctx.fillStyle = '#f2b90f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1c120c';
  for (let x = -h; x < w; x += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.lineTo(x + h + step, 0);
    ctx.lineTo(x + step, h);
    ctx.closePath();
    ctx.fill();
  }
}

function boulder(kit, radius, material, at, squash = 0.7) {
  const rock = new Mesh(new IcosahedronGeometry(radius, 0), material);
  rock.position.set(...at);
  rock.scale.y = squash;
  rock.rotation.set(at[0] * 3, at[2] * 5, at[0] + at[2]);
  return rock;
}

// A fern or a palm's crown: blades fanned round a point, each leaning out.
function fronds(kit, material, count, length, lean, width = 0.16) {
  const group = new Group();
  const blade = new ConeGeometry(width, length, 4);
  blade.translate(0, length / 2, 0);
  for (let i = 0; i < count; i += 1) {
    const holder = new Group();
    holder.rotation.y = (i / count) * TAU + seeded(i + count) * 0.4;
    const leaf = new Mesh(blade, material);
    leaf.scale.z = 0.22;
    leaf.rotation.x = lean * (0.85 + seeded(i * 3 + count) * 0.3);
    holder.add(leaf);
    group.add(holder);
  }
  return group;
}

function eyes(kit, head, x, y, z, size = 0.035) {
  const m = mats(kit);
  return [-1, 1].map(side => {
    const eye = kit.sphere(size, m.ink, [x, y, side * z], 6);
    head.add(eye);
    return eye;
  });
}

// A concrete fence post with a warning cap, standing on its own origin so it
// can be thrown flat.
function post(kit, height) {
  const m = mats(kit);
  const group = new Group();
  group.add(kit.box(0.08, height, 0.08, m.concrete, [0, height / 2, 0]));
  group.add(kit.box(0.1, 0.05, 0.1, m.hazard, [0, height + 0.025, 0]));
  return group;
}

// A fire bowl. The flame grows from the bowl's rim, so scaling it flares it.
function torch(kit, size = 1) {
  const m = mats(kit);
  const group = new Group();
  group.add(kit.cylinder(0.17 * size, 0.08 * size, 0.14 * size, m.iron, [0, 0.07 * size, 0], 8));
  const flame = new Group();
  flame.position.y = 0.12 * size;
  const outer = new ConeGeometry(0.15 * size, 0.32 * size, 6);
  outer.translate(0, 0.16 * size, 0);
  const inner = new ConeGeometry(0.08 * size, 0.52 * size, 5);
  inner.translate(0, 0.26 * size, 0);
  flame.add(new Mesh(outer, m.fire), new Mesh(inner, m.flame));
  group.add(flame);
  return { group, flame };
}

// How a hide is coloured: dark along the back, pale underneath, and
// `pattern(u, lift, out)` says how deep the markings lie at a point. A leg
// is the flank's colour all the way round, a shade darker down its front.
function coat(kit, name, pattern) {
  const [back, flank, belly, mark] = ['back', 'flank', 'belly', 'mark']
    .map(part => new Color(HIDES[name][part][kit.mode === 'dark' ? 1 : 0]));
  const body = (shade, u, lift, out) => {
    shade.copy(flank);
    if (lift > 0) shade.lerp(back, smooth(lift * 1.3));
    else shade.lerp(belly, smooth(-lift * 1.6 - 0.15));
    const depth = pattern(u, lift, out);
    if (depth > 0) shade.lerp(mark, depth);
  };
  const leg = (shade, u, lift) => {
    shade.copy(flank).lerp(back, smooth(lift) * 0.45 + smooth(u * 2 - 1) * 0.3);
    const depth = pattern(u * 0.4, 0.2, 0);
    if (depth > 0) shade.lerp(mark, depth * (1 - u));
  };
  return { body, leg };
}

function coats(kit) {
  return memo(kit, 'coats', () => ({
    // Bands over the back that fade out down the flank.
    rex: coat(kit, 'rex', (u, lift) => smooth(Math.sin(u * 88) * 1.6 - 0.2) * smooth(lift * 1.4 + 0.5) * 0.6),
    raptor: coat(kit, 'raptor', (u, lift) => smooth(Math.sin(u * 70) * 1.8 - 0.3) * smooth(lift * 1.4 + 0.4) * 0.65),
    // Dapples, thickest high on the flank.
    brachio: coat(kit, 'brachio', (u, lift, out) => smooth(Math.sin(u * 61) * Math.sin(u * 37 + out * 2.6) * 2.4 - 0.3) * smooth(lift + 0.75) * 0.5),
  }));
}

// A hide stretched over a spine. A key is [x, y, z, up, side, down]: a point
// on the spine and how far the hide stands off it above, beside and below. A
// spine that runs down a leg reads those as front, beside and back, and a
// key with one figure is round. `shape` splines `count` keys into rings, so a
// pose is a short list and a neck or a tail bends with no joint showing.
// `tint(shade, u, lift, out)` colours the hide once: `u` runs 0 to 1 along the
// spine, `lift` from -1 underneath to 1 on top and `out` from -1 to 1 across.
function pelt(kit, count, tint, { sides = 10, steps = 3 } = {}) {
  const rings = (count - 1) * steps + 1;
  const last = rings * sides;
  const position = new Float32Array((last + 2) * 3);
  const colour = new Float32Array((last + 2) * 3);
  const round = Array.from({ length: sides }, (_, j) => [Math.cos((j / sides) * TAU), Math.sin((j / sides) * TAU)]);
  const index = [];
  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const a = i * sides + j;
      const b = i * sides + (j + 1) % sides;
      index.push(a, a + sides, b, a + sides, b + sides, b);
    }
  }
  // Each end closes on a point at the middle of its ring.
  for (let j = 0; j < sides; j += 1) {
    const next = (j + 1) % sides;
    index.push(last, j, next, last + 1, last - sides + next, last - sides + j);
  }
  const shade = new Color();
  const paint = (at, u, lift, out) => {
    tint(shade, u, lift, out);
    colour.set([shade.r, shade.g, shade.b], at * 3);
  };
  for (let i = 0; i < rings; i += 1) {
    round.forEach(([out, lift], j) => paint(i * sides + j, i / (rings - 1), lift, out));
  }
  paint(last, 0, 0, 0);
  paint(last + 1, 1, 0, 0);

  const geometry = new BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(colour, 3));
  const mesh = new Mesh(geometry, memo(kit, 'hide', () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.02 })));

  const spine = new Float32Array(rings * 6);
  const part = (keys, k, c) => {
    const key = keys[Math.min(count - 1, Math.max(0, k))];
    return key[c] ?? key[3];
  };
  // Runs every frame for an animal that moves, so it makes no garbage.
  function shape(keys) {
    for (let i = 0; i < rings; i += 1) {
      const span = Math.min(count - 2, Math.floor(i / steps));
      const f = i / steps - span;
      for (let c = 0; c < 6; c += 1) {
        const p0 = part(keys, span - 1, c);
        const p1 = part(keys, span, c);
        const p2 = part(keys, span + 1, c);
        const p3 = part(keys, span + 2, c);
        const value = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
        spine[i * 6 + c] = c < 3 ? value : Math.max(0.002, value);
      }
    }
    for (let i = 0; i < rings; i += 1) {
      const o = i * 6;
      const from = Math.max(0, i - 1) * 6;
      const to = Math.min(rings - 1, i + 1) * 6;
      let tx = spine[to] - spine[from];
      let ty = spine[to + 1] - spine[from + 1];
      let tz = spine[to + 2] - spine[from + 2];
      const run = Math.hypot(tx, ty, tz) || 1;
      tx /= run;
      ty /= run;
      tz /= run;
      // Across is z, less the part of it that lies along the spine, so the
      // hide never rolls; above is square to both.
      let sx = -tz * tx;
      let sy = -tz * ty;
      let sz = 1 - tz * tz;
      const wide = Math.hypot(sx, sy, sz) || 1;
      sx /= wide;
      sy /= wide;
      sz /= wide;
      const ux = sy * tz - sz * ty;
      const uy = sz * tx - sx * tz;
      const uz = sx * ty - sy * tx;
      for (let j = 0; j < sides; j += 1) {
        const across = round[j][0] * spine[o + 4];
        const above = round[j][1] * spine[o + (round[j][1] > 0 ? 3 : 5)];
        const at = (i * sides + j) * 3;
        position[at] = spine[o] + sx * across + ux * above;
        position[at + 1] = spine[o + 1] + sy * across + uy * above;
        position[at + 2] = spine[o + 2] + sz * across + uz * above;
      }
    }
    for (let c = 0; c < 3; c += 1) {
      position[last * 3 + c] = spine[c];
      position[(last + 1) * 3 + c] = spine[(rings - 1) * 6 + c];
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  return { mesh, shape };
}

// A part that never bends: a leg, a skull or a jaw.
function limb(kit, tint, keys, options) {
  const { mesh, shape } = pelt(kit, keys.length, tint, { sides: 8, ...options });
  shape(keys);
  return mesh;
}

// A long-neck standing over its hind feet, head towards +x, its shoulders
// higher than its hips. `pose` sets how far the neck leans from upright, how
// far it swings aside, the head's nod and the tail's sway, and leaves `mouth`
// where the muzzle ends.
function longNeck(kit, { curl = 0.22 } = {}) {
  const m = mats(kit);
  const { body: tint, leg } = coats(kit).brachio;
  const body = new Group();

  for (const side of [-1, 1]) {
    const fore = side * 0.17;
    const hind = side * 0.18;
    body.add(limb(kit, leg, [[0.62, 1.02, fore * 0.5, 0.05], [0.64, 0.84, fore, 0.125, 0.105, 0.14], [0.62, 0.5, fore, 0.084, 0.084, 0.094], [0.655, 0.17, fore, 0.072, 0.078, 0.078], [0.665, 0, fore, 0.096, 0.096, 0.088]]));
    body.add(limb(kit, leg, [[-0.02, 0.9, hind * 0.5, 0.05], [0, 0.72, hind, 0.155, 0.115, 0.17], [0.08, 0.43, hind, 0.1, 0.096, 0.115], [-0.025, 0.17, hind, 0.078, 0.084, 0.084], [0.01, 0, hind, 0.1, 0.1, 0.094]]));
    for (const [x, z] of [[0.665, fore], [0.01, hind]]) {
      for (const toe of [-0.5, 0.1, 0.7]) {
        const nail = kit.sphere(0.022, m.horn, [x + Math.cos(toe) * 0.088, 0.016, z + side * Math.sin(toe) * 0.088], 6);
        nail.scale.y = 0.7;
        body.add(nail);
      }
    }
  }

  const head = new Group();
  // A domed crown over the eyes, then a broad flat muzzle.
  head.add(limb(kit, tint, [[-0.08, 0, 0, 0.06, 0.066, 0.066], [0.03, 0.03, 0, 0.115, 0.088, 0.08], [0.14, 0.006, 0, 0.08, 0.084, 0.066], [0.26, -0.02, 0, 0.056, 0.08, 0.052], [0.33, -0.028, 0, 0.024, 0.046, 0.024]], { steps: 4 }));
  eyes(kit, head, 0.07, 0.04, 0.08, 0.022);
  for (const side of [-1, 1]) head.add(kit.sphere(0.01, m.ink, [0.29, 0.016, side * 0.04], 5));
  body.add(head);

  const TAIL = [[0.1, 0.1, 0.12], [0.09, 0.07], [0.06, 0.045], [0.035, 0.022], [0.015, 0.006]];
  const TRUNK = [[-0.2, 0.74, 0, 0.16, 0.16, 0.18], [0.02, 0.8, 0, 0.21, 0.24, 0.29], [0.3, 0.84, 0, 0.22, 0.28, 0.35], [0.56, 0.94, 0, 0.21, 0.26, 0.33], [0.74, 1.08, 0, 0.18, 0.19, 0.24]];
  // Each stretch of neck: its girth above, beside and below, its length, and
  // how far it has turned from the neck's line to the skull's.
  const NECK = [[0.155, 0.14, 0.17, 0.25, 0], [0.13, 0.115, 0.14, 0.25, 0], [0.108, 0.096, 0.112, 0.25, 0.12], [0.09, 0.082, 0.09, 0.2, 0.4], [0.07, 0.066, 0.068, 0.12, 0.8]];
  const hide = pelt(kit, TAIL.length + TRUNK.length + NECK.length, tint, { sides: 12 });
  body.add(hide.mesh);
  const mouth = new Vector3();

  function pose({ lean = 0.8, turn = 0, nod = 0, wag = 0 } = {}) {
    const keys = [];
    let [x, y, z] = TRUNK[0];
    let heading = 0;
    TAIL.forEach(([drop, girth, deep = girth], i) => {
      heading += curl + wag * (i + 1) * 0.1;
      x -= Math.cos(heading) * 0.24;
      y -= drop;
      z += Math.sin(heading) * 0.24;
      keys.unshift([x, y, z, girth, girth, deep]);
    });
    keys.push(...TRUNK);
    [x, y, z] = TRUNK[TRUNK.length - 1];
    // The base of the neck follows the head only part of the way, and the
    // top of it bends over to meet the skull.
    const base = lean * 0.45 + 0.55;
    const level = Math.PI / 2 + 0.25 - nod;
    NECK.forEach(([up, side, down, run, over], i) => {
      const s = (i + 1) / NECK.length;
      const tilt = lerp(lerp(base, lean, smooth(s * 1.4)), level, over);
      x += Math.sin(tilt) * Math.cos(turn * s) * run;
      y += Math.cos(tilt) * run;
      z -= Math.sin(tilt) * Math.sin(turn * s) * run;
      keys.push([x, y, z, up, side, down]);
    });
    hide.shape(keys);
    head.position.set(x, y, z);
    head.rotation.set(0, turn, nod - 0.25);
    mouth.set(0.32, -0.03, 0).applyEuler(head.rotation).add(head.position);
  }
  pose();
  return { body, pose, mouth };
}

// A toe along +x from its own origin, with a claw at the end of it.
function toe(kit, material, length, girth) {
  const m = mats(kit);
  const group = new Group();
  const digit = kit.cylinder(girth * 0.7, girth, length, material, [length / 2, 0, 0], 6);
  digit.rotation.z = Math.PI / 2;
  const claw = new Mesh(new ConeGeometry(girth * 0.66, girth * 2.4, 5), m.claw);
  claw.rotation.z = -Math.PI / 2 - 0.35;
  claw.position.set(length + girth * 0.8, -girth * 0.3, 0);
  group.add(digit, claw);
  return group;
}

// A rex, head towards +x, standing over its feet with its back level and
// its tail held out behind to balance the head. The head, the jaw and each
// leg turn on their own joints, and `pose` sways the tail.
function tyrant(kit) {
  const m = mats(kit);
  const { body: tint, leg: shank } = coats(kit).rex;
  const rex = new Group();

  const legs = [-1, 1].map(side => {
    const leg = new Group();
    leg.position.set(-0.03, 0.74, side * 0.16);
    // Thigh, knee, hock and the long foot bones a rex stands on.
    leg.add(limb(kit, shank, [[-0.02, 0.1, -side * 0.06, 0.07], [0.02, -0.07, 0, 0.16, 0.1, 0.16], [0.15, -0.33, 0, 0.09, 0.076, 0.095], [-0.04, -0.54, 0, 0.05, 0.05, 0.058], [0.01, -0.705, 0, 0.046, 0.052, 0.046]]));
    for (const splay of [-0.42, 0, 0.42]) {
      const digit = toe(kit, m.rex, splay ? 0.14 : 0.17, 0.03);
      digit.position.set(0.02, -0.705, 0);
      digit.rotation.y = splay;
      leg.add(digit);
    }
    rex.add(leg);
    return leg;
  });
  for (const side of [-1, 1]) {
    const z = side * 0.15;
    rex.add(limb(kit, shank, [[0.34, 0.82, z * 0.6, 0.03], [0.37, 0.74, z, 0.042, 0.036, 0.042], [0.4, 0.64, z, 0.03], [0.48, 0.6, z, 0.022]], { sides: 6 }));
    for (const spread of [-0.016, 0.016]) {
      const claw = new Mesh(new ConeGeometry(0.01, 0.05, 4), m.claw);
      claw.rotation.z = -2.1;
      claw.position.set(0.5, 0.585, z + spread);
      rex.add(claw);
    }
  }

  const head = new Group();
  head.position.set(0.62, 1.08, 0);
  head.scale.setScalar(1.16);
  // Deep at the cheeks and narrow at the snout, flat along the tooth row.
  head.add(limb(kit, tint, [[-0.08, 0, 0, 0.09, 0.09, 0.09], [0.04, 0.035, 0, 0.118, 0.128, 0.092], [0.17, 0.03, 0, 0.1, 0.104, 0.086], [0.32, 0.015, 0, 0.086, 0.084, 0.072], [0.43, 0, 0, 0.07, 0.07, 0.056], [0.49, -0.014, 0, 0.03, 0.04, 0.03]], { sides: 10, steps: 4 }));
  for (const side of [-1, 1]) {
    const brow = kit.sphere(0.05, m.rexBrow, [0.1, 0.122, side * 0.078], 6);
    brow.scale.set(1.5, 0.55, 0.7);
    head.add(brow);
    head.add(kit.sphere(0.011, m.ink, [0.455, 0.04, side * 0.034], 5));
  }
  eyes(kit, head, 0.105, 0.085, 0.107, 0.021);
  head.add(kit.box(0.36, 0.012, 0.12, m.maw, [0.27, -0.052, 0]));
  const jaw = new Group();
  jaw.position.set(0.02, -0.052, 0);
  jaw.add(limb(kit, tint, [[-0.03, -0.02, 0, 0.03, 0.09, 0.05], [0.12, -0.022, 0, 0.026, 0.094, 0.062], [0.29, -0.024, 0, 0.022, 0.072, 0.05], [0.4, -0.022, 0, 0.016, 0.05, 0.034], [0.445, -0.018, 0, 0.008, 0.02, 0.012]], { steps: 4 }));
  jaw.add(kit.box(0.3, 0.012, 0.09, m.maw, [0.22, 0.004, 0]));
  const tooth = new ConeGeometry(0.013, 0.05, 4);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i += 1) {
      const x = 0.13 + i * 0.052;
      const upper = new Mesh(tooth, m.bone);
      upper.position.set(x, -0.07, side * lerp(0.092, 0.052, i / 6));
      upper.rotation.x = Math.PI;
      upper.scale.setScalar(i % 2 ? 0.75 : 1);
      head.add(upper);
      if (i > 5) continue;
      const fang = new Mesh(tooth, m.bone);
      fang.position.set(x + 0.008, 0.012, side * lerp(0.078, 0.04, i / 5));
      fang.scale.setScalar(0.7);
      jaw.add(fang);
    }
  }
  head.add(jaw);
  rex.add(head);

  const TAIL = [[0.115, 0.09, 0.115], [0.078, 0.062, 0.074], [0.046, 0.038, 0.042], [0.02, 0.018], [0.006]];
  const TRUNK = [[-0.3, 0.8, 0, 0.16, 0.13, 0.17], [-0.04, 0.82, 0, 0.21, 0.19, 0.25], [0.2, 0.82, 0, 0.21, 0.2, 0.27], [0.4, 0.88, 0, 0.19, 0.18, 0.24], [0.53, 0.99, 0, 0.15, 0.13, 0.16], [0.62, 1.08, 0, 0.11, 0.1, 0.11]];
  const hide = pelt(kit, TAIL.length + TRUNK.length, tint, { sides: 12, steps: 4 });
  rex.add(hide.mesh);
  function pose({ wag = 0 } = {}) {
    const keys = [];
    let [x, y, z] = TRUNK[0];
    let heading = 0;
    TAIL.forEach(([up, side = up, down = up], i) => {
      heading += wag * (i + 1) * 0.3;
      x -= Math.cos(heading) * 0.2;
      y -= i * 0.008;
      z += Math.sin(heading) * 0.2;
      keys.unshift([x, y, z, up, side, down]);
    });
    hide.shape([...keys, ...TRUNK]);
  }
  pose();
  return { rex, head, jaw, legs, pose };
}

// A raptor's long, narrow skull, snout towards +x.
function raptorHead(kit) {
  const m = mats(kit);
  const head = new Group();
  head.add(limb(kit, coats(kit).raptor.body, [[-0.04, 0, 0, 0.036, 0.038, 0.038], [0.02, 0.014, 0, 0.054, 0.05, 0.044], [0.095, 0.002, 0, 0.04, 0.037, 0.036], [0.18, -0.008, 0, 0.03, 0.028, 0.027], [0.228, -0.012, 0, 0.012, 0.015, 0.012]], { steps: 4 }));
  for (const side of [-1, 1]) {
    const brow = kit.sphere(0.02, m.raptorBrow, [0.04, 0.056, side * 0.03], 5);
    brow.scale.set(1.5, 0.5, 0.7);
    head.add(brow);
  }
  eyes(kit, head, 0.045, 0.034, 0.042, 0.013);
  return head;
}

// A raptor, head towards +x, its tail held stiff behind it. `pose` takes it
// from a stalk with its head low among the ferns (0) to its full height (1).
function raptor(kit, { curl = 0 } = {}) {
  const m = mats(kit);
  const { body: tint, leg } = coats(kit).raptor;
  const body = new Group();

  for (const side of [-1, 1]) {
    const z = side * 0.055;
    body.add(limb(kit, leg, [[0, 0.34, z * 0.5, 0.028], [0.02, 0.26, z, 0.06, 0.036, 0.06], [0.09, 0.15, z, 0.032, 0.028, 0.034], [-0.03, 0.085, z, 0.019], [0.005, 0.016, z, 0.018]], { sides: 6 }));
    for (const splay of [-0.3, 0.3]) {
      const digit = toe(kit, m.raptor, 0.06, 0.012);
      digit.position.set(0.005, 0.014, z);
      digit.rotation.y = splay;
      body.add(digit);
    }
    // The killing claw, carried clear of the ground.
    const sickle = new Mesh(new ConeGeometry(0.011, 0.06, 5), m.claw);
    sickle.rotation.z = -0.9;
    sickle.position.set(0.04, 0.05, z - side * 0.016);
    body.add(sickle);
  }
  const arms = new Group();
  for (const side of [-1, 1]) {
    const z = side * 0.052;
    arms.add(limb(kit, leg, [[0, 0, z * 0.6, 0.016], [0.02, -0.06, z, 0.02, 0.016, 0.02], [0.0, -0.11, z, 0.014], [0.06, -0.13, z, 0.011]], { sides: 6, steps: 2 }));
    for (const spread of [-0.012, 0, 0.012]) {
      const claw = new Mesh(new ConeGeometry(0.006, 0.034, 4), m.claw);
      claw.rotation.z = -2;
      claw.position.set(0.078, -0.14, z + spread);
      arms.add(claw);
    }
  }
  body.add(arms);
  const head = raptorHead(kit);
  body.add(head);

  const TAIL = [[0.034, 0.03, 0.034], [0.022, 0.02], [0.013], [0.005]];
  const hide = pelt(kit, TAIL.length + 6, tint, { sides: 8 });
  body.add(hide.mesh);
  function pose({ rise = 0, wag = 0 } = {}) {
    const pitch = lerp(0.1, 1, rise);
    const keys = [];
    let x = -0.1;
    let y = 0.3;
    let z = 0;
    let heading = 0;
    TAIL.forEach(([up, side = up, down = up], i) => {
      heading += curl + wag * (i + 1) * 0.3;
      x -= Math.cos(heading) * 0.13;
      y += lerp(0.012, -0.04, rise);
      z += Math.sin(heading) * 0.13;
      keys.unshift([x, y, z, up, side, down]);
    });
    keys.push([-0.1, 0.3, 0, 0.052, 0.045, 0.056], [0, 0.305, 0, 0.076, 0.064, 0.086]);
    x = Math.cos(pitch) * 0.2;
    y = 0.305 + Math.sin(pitch) * 0.2;
    keys.push([x, y, 0, 0.068, 0.058, 0.08]);
    arms.position.set(x, y - 0.02, 0);
    arms.rotation.z = pitch * 0.6;
    // The neck comes up out of the shoulders, then reaches forward in a
    // stalk or straight up for a look over the wall.
    for (const [bend, girth] of [[pitch + 0.35, 0.05], [lerp(1.15, 1.5, rise), 0.038], [lerp(0.15, 1.42, rise), 0.032]]) {
      x += Math.cos(bend) * 0.1;
      y += Math.sin(bend) * 0.1;
      keys.push([x, y, 0, girth, girth * 0.9, girth]);
    }
    hide.shape(keys);
    head.position.set(x, y, 0);
    head.rotation.z = lerp(-0.05, 0.3, rise) - 0.25;
  }
  pose();
  return { body, head, pose };
}

// A tour car, nose towards +z: cream over green with a red roof. `lift` drops
// it by the height the engine carries a hand-off's blips above the floor.
function tourCar(kit, lift = 0) {
  const m = mats(kit);
  const car = new Group();
  car.add(kit.box(0.2, 0.09, 0.34, m.cream, [0, 0.105 - lift, 0]));
  car.add(kit.box(0.21, 0.04, 0.35, m.paint, [0, 0.06 - lift, 0]));
  car.add(kit.box(0.17, 0.07, 0.19, m.glass, [0, 0.185 - lift, -0.02]));
  car.add(kit.box(0.19, 0.016, 0.21, m.red, [0, 0.228 - lift, -0.02]));
  for (const z of [-0.11, 0.11]) {
    const axle = kit.cylinder(0.045, 0.045, 0.23, m.iron, [0, 0.045 - lift, z], 8);
    axle.rotation.z = Math.PI / 2;
    car.add(axle);
  }
  car.add(kit.box(0.14, 0.03, 0.012, m.bulb, [0, 0.11 - lift, 0.172]));
  return car;
}

// The park helicopter, nose towards +z, standing on its skids at its origin.
function chopper(kit) {
  const m = mats(kit);
  const rig = new Group();
  const hull = kit.sphere(0.19, m.cream, [0, 0.262, 0], 10);
  hull.scale.set(1, 0.95, 1.55);
  rig.add(hull);
  const stripe = kit.sphere(0.19, m.red, [0, 0.212, 0], 10);
  stripe.scale.set(1.03, 0.4, 1.58);
  rig.add(stripe);
  const canopy = kit.sphere(0.15, m.glass, [0, 0.292, 0.17], 9);
  canopy.scale.set(1.05, 0.9, 1.1);
  rig.add(canopy);
  const boom = kit.cylinder(0.03, 0.05, 0.5, m.cream, [0, 0.302, -0.5], 6);
  boom.rotation.x = -Math.PI / 2;
  rig.add(boom);
  rig.add(kit.box(0.02, 0.2, 0.12, m.red, [0, 0.402, -0.74]));
  const prop = kit.box(0.012, 0.24, 0.03, m.iron, [0.03, 0.402, -0.74]);
  rig.add(prop);
  rig.add(kit.cylinder(0.02, 0.02, 0.1, m.iron, [0, 0.482, 0], 5));
  const rotor = new Group();
  rotor.position.y = 0.542;
  rotor.add(kit.box(1.5, 0.012, 0.06, m.iron, [0, 0, 0]), kit.cylinder(0.75, 0.75, 0.004, m.blur, [0, -0.004, 0], 16));
  rig.add(rotor);
  for (const side of [-1, 1]) {
    const skid = kit.cylinder(0.012, 0.012, 0.52, m.iron, [side * 0.15, 0.012, 0.02], 5);
    skid.rotation.x = Math.PI / 2;
    rig.add(skid);
    for (const z of [-0.12, 0.16]) rig.add(kit.cylinder(0.01, 0.01, 0.1, m.iron, [side * 0.13, 0.062, z], 4));
  }
  return { rig, rotor, prop };
}

// ---------- floor ----------

const STUDS = 13;

function floor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const m = mats(kit);

  group.add(kit.ground({
    radius: 68,
    repeat: [22, 22],
    rough: dark ? 0.7 : 0.92,
    metal: 0.02,
    draw(ctx, w, h) {
      ctx.fillStyle = dark ? '#223526' : '#93c46c';
      ctx.fillRect(0, 0, w, h);
      // Jungle grass by day, rain standing in the hollows by night.
      for (let i = 0; i < 26; i += 1) {
        ctx.fillStyle = dark
          ? (i % 3 ? 'rgba(38, 62, 44, 0.55)' : 'rgba(120, 170, 190, 0.14)')
          : (i % 3 ? 'rgba(104, 168, 76, 0.5)' : 'rgba(190, 218, 132, 0.5)');
        ctx.beginPath();
        ctx.ellipse(seeded(i) * w, seeded(i + 40) * h, 20 + seeded(i + 80) * 46, 12 + seeded(i + 120) * 26, seeded(i) * 3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = dark ? 'rgba(150, 200, 215, 0.2)' : 'rgba(61, 107, 36, 0.22)';
      drawPrint(ctx, w * 0.27, h * 0.3, 54, 0.5);
      drawPrint(ctx, w * 0.72, h * 0.76, 54, -0.4);
    },
  }));
  group.add(kit.halo('glow', 11, 8, { opacity: dark ? 0.3 : 0.08, at: [0, 0.005, -3.2] }));

  // The tour road up the aisle to the gate, with the cars' guide rail down
  // its middle.
  const road = kit.box(1.7, 0.02, 13.6, kit.mat('aisle', { rough: 0.9 }), [0, 0.01, 3.4]);
  road.receiveShadow = !kit.software;
  group.add(road);
  for (const side of [-1, 1]) group.add(kit.box(0.07, 0.035, 13.6, m.concrete, [side * 0.88, 0.018, 3.4]));
  group.add(kit.box(0.07, 0.045, 13.6, m.steel, [0, 0.03, 3.4]));
  const studs = [];
  for (let i = 0; i < STUDS; i += 1) {
    const stud = kit.box(0.16, 0.03, 0.09, m.hazard, [0, 0.062, 8.9 - i * 0.92]);
    group.add(stud);
    studs.push(stud);
  }
  bagOf(kit).studs = studs;

  for (const [x, z, r] of [[-1.5, 7.4, 0.2], [1.6, 5.2, 0.16], [-1.55, 2.6, 0.22], [1.5, 0.4, 0.18], [-1.6, -1.4, 0.2]]) {
    group.add(boulder(kit, r, m.rock, [x, r * 0.5, z]));
  }
  return group;
}

function frame(_time, _dt, kit) {
  if (kit.reducedMotion) return;
  const studs = bagOf(kit).studs || [];
  // Each rail stud lifts as something passes over it, and only while
  // something really is on its way between the gate and a station.
  const { clock, flow } = kit.traffic;
  const step = (clock * 5) % (studs.length + 5);
  for (let i = 0; i < studs.length; i += 1) {
    const near = Math.max(0, 1 - Math.abs(i - step)) * flow;
    studs[i].scale.set(1 + near * 0.5, 1 + near * 2.2, 1);
  }
}

// ---------- hall: the gate and the visitor centre ----------

const GATE = { z: 1.7, pylon: 1.2, top: 2.94, leaf: 0.9 };
const PAD = { x: 1.78, z: -0.72 };

function hall(kit) {
  const group = new Group();
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  group.add(kit.shadow(6.4, 5.2, 0.42));

  // The lodge: a stone drum under a tall thatched cone, with a low wing.
  const LODGE = -0.75;
  group.add(kit.cylinder(1.25, 1.3, 1.25, m.stone, [0, 0.625, LODGE], 12));
  group.add(kit.cylinder(1.76, 1.76, 0.07, m.timber, [0, 1.27, LODGE], 12));
  const roof = new Mesh(new ConeGeometry(1.72, 1.5, 12), m.thatch);
  roof.position.set(0, 2.05, LODGE);
  group.add(roof);
  const finial = new Mesh(new ConeGeometry(0.36, 0.5, 8), m.thatch);
  finial.position.set(0, 2.96, LODGE);
  group.add(finial);
  for (const a of [-1.0, -0.56, 0.56, 1.0]) {
    const pane = kit.box(0.26, 0.4, 0.05, kit.windows, [Math.sin(a) * 1.28, 0.78, LODGE + Math.cos(a) * 1.28]);
    pane.rotation.y = a;
    group.add(pane);
  }
  group.add(kit.box(1.3, 1.1, 0.08, kit.mat('door', { rough: 0.95 }), [0, 0.55, LODGE + 1.29]));
  group.add(kit.box(1.7, 0.03, 1.1, kit.mat('aisle', { rough: 0.9 }), [0, 0.015, 1.1]));
  group.add(kit.box(1.25, 0.9, 1.2, m.stone, [-1.8, 0.45, LODGE]));
  const wing = new Mesh(new ConeGeometry(1.08, 0.66, 4), m.thatch);
  wing.rotation.y = Math.PI / 4;
  wing.position.set(-1.8, 1.23, LODGE);
  group.add(wing);
  group.add(kit.box(0.5, 0.3, 0.05, kit.windows, [-1.8, 0.52, LODGE + 0.61]));

  // The helipad stands on its own tower beside the lodge, lamps round its rim
  // and the park's helicopter on it.
  group.add(kit.cylinder(0.7, 0.78, 1.5, m.concrete, [PAD.x, 0.75, PAD.z], 8));
  group.add(kit.cylinder(0.98, 0.98, 0.08, m.concrete, [PAD.x, 1.54, PAD.z], 14));
  group.add(kit.box(0.5, 0.22, 0.05, kit.windows, [PAD.x, 1.02, PAD.z + 0.7]));
  const marking = new Mesh(new PlaneGeometry(1.8, 1.8), memo(kit, 'helipad', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#f2b90f';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.4, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#fbf1d6';
    for (const x of [0.36, 0.58]) ctx.fillRect(w * x, h * 0.3, w * 0.06, h * 0.4);
    ctx.fillRect(w * 0.36, h * 0.47, w * 0.28, h * 0.06);
  }, { width: 256, height: 256, transparent: true, rough: 0.8 })));
  marking.rotation.x = -Math.PI / 2;
  marking.position.set(PAD.x, 1.585, PAD.z);
  group.add(marking);
  const heli = chopper(kit);
  heli.rig.scale.setScalar(1.2);
  heli.rig.position.set(PAD.x, 1.585, PAD.z);
  heli.rig.rotation.y = -0.7;
  group.add(heli.rig);
  const padLamps = [0, 1, 2, 3, 4, 5].map(i => {
    const a = (i / 6) * TAU + 0.5;
    const lamp = kit.sphere(0.05, m.hazard, [PAD.x + Math.cos(a) * 0.9, 1.6, PAD.z + Math.sin(a) * 0.9], 6);
    group.add(lamp);
    return lamp;
  });

  // The gate: two tapering pylons, a painted board between them and fire
  // along the top.
  const shaft = new CylinderGeometry(0.24, 0.34, 2.3, 4);
  shaft.rotateY(Math.PI / 4);
  const torches = [];
  for (const side of [-1, 1]) {
    const x = side * GATE.pylon;
    group.add(kit.box(0.72, 0.5, 0.72, m.stone, [x, 0.25, GATE.z]));
    const pylon = new Mesh(shaft, m.timber);
    pylon.position.set(x, 1.65, GATE.z);
    group.add(pylon);
    group.add(kit.box(0.6, 0.14, 0.6, m.stone, [x, 2.87, GATE.z]));
    for (const [tx, ty, size] of [[x, GATE.top, 1.15], [side * 0.62, 2.67, 0.75]]) {
      const fire = torch(kit, size);
      fire.group.position.set(tx, ty, GATE.z);
      group.add(fire.group);
      torches.push(fire.flame);
    }
    // The fence runs on from each pylon.
    const end = post(kit, 1.5);
    end.position.set(side * 2.5, 0, GATE.z);
    group.add(end);
    for (const y of [0.4, 0.8, 1.2]) group.add(kit.box(0.98, 0.018, 0.018, m.steel, [side * 2.0, y, GATE.z]));
  }
  group.add(kit.box(2.5, 0.5, 0.16, m.timber, [0, 2.3, GATE.z]));
  group.add(kit.box(2.95, 0.1, 0.22, m.timber, [0, 2.62, GATE.z]));
  const board = new Mesh(new PlaneGeometry(2.2, 0.4), memo(kit, 'board', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = dark ? '#d9c98f' : '#f3e2a8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8c2416';
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#8c2416';
    ctx.font = "bold 58px Georgia, 'Times New Roman', serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DINO PARK', w / 2, h / 2 + 3, w * 0.66);
    drawPrint(ctx, w * 0.09, h * 0.42, 62, -0.3);
    drawPrint(ctx, w * 0.91, h * 0.42, 62, 0.3);
  }, { width: 512, height: 96, rough: 0.8 })));
  board.position.set(0, 2.3, GATE.z + 0.085);
  group.add(board);

  // Two timber leaves, hinged on the pylons, that swing in towards the lodge.
  const leaves = [-1, 1].map(side => {
    const hinge = new Group();
    hinge.position.set(side * (GATE.leaf + 0.03), 0, GATE.z);
    hinge.add(kit.box(GATE.leaf, 1.9, 0.08, m.wood, [-side * GATE.leaf / 2, 1.0, 0]));
    for (const y of [0.45, 1.55]) hinge.add(kit.box(GATE.leaf, 0.07, 0.1, m.iron, [-side * GATE.leaf / 2, y, 0]));
    group.add(hinge);
    return { hinge, side };
  });
  // The engine rolls a hall's door up by scaling it; this one is a latch
  // nobody sees, and the leaves swing as far as it has rolled.
  const latch = new Group();
  const pool = kit.halo('glow', 4.6, 3.2, { opacity: dark ? 0.5 : 0.1, at: [0, 0.03, GATE.z + 0.5] });
  group.add(pool);

  // The lamp that flickers while the run waits on you, on a striped pole.
  group.add(kit.cylinder(0.04, 0.05, 1.1, m.steel, [2.25, 0.55, GATE.z + 0.35], 6));
  group.add(kit.cylinder(0.06, 0.06, 0.2, m.hazard, [2.25, 0.3, GATE.z + 0.35], 6));
  const beacon = kit.sphere(0.2, kit.beacon, [2.25, 1.22, GATE.z + 0.35], 10);
  group.add(beacon);
  for (const [x, z, r] of [[-2.75, 1.2, 0.36], [2.8, 0.4, 0.34], [-2.9, -0.2, 0.46], [2.9, -1.3, 0.42]]) {
    group.add(boulder(kit, r, m.rock, [x, r * 0.5, z]));
  }
  for (const [x, z, s] of [[-1.85, 2.25, 0.9], [1.75, 2.3, 0.8], [-2.9, 0.6, 1.1], [0.95, 0.75, 0.7], [-0.95, 0.8, 0.75]]) {
    const fern = fronds(kit, m.frond, 6, 0.7 * s, 1.0);
    fern.position.set(x, 0, z);
    group.add(fern);
  }

  // Sparks off the gate fires when a delivery lands.
  const embers = Array.from({ length: 6 }, (_, i) => {
    const ember = kit.sphere(0.05 + (i % 3) * 0.015, m.flame, [0, 0, 0], 5);
    ember.visible = false;
    group.add(ember);
    const side = i % 2 ? 1 : -1;
    return { ember, x: side * GATE.pylon, vx: side * (0.2 + (i % 3) * 0.25), vz: 0.3 + (i % 2) * 0.4, up: 2.2 + (i % 4) * 0.4, delay: (i % 3) * 0.08 };
  });

  let dropAt = -10;
  let sendAt = -10;
  let clock = 0;
  group.userData = {
    beacon,
    door: latch,
    // The rotor turns over while the main agent works.
    spin: [[heli.rotor, 'y', 9], [heli.prop, 'x', 13]],
    chimney: new Vector3(-GATE.pylon, GATE.top + 0.7, GATE.z),
    labelY: 4.5,
    react(event) {
      if (event === 'delivery') dropAt = clock;
      else sendAt = clock;
    },
    frame(time, _dt, main, reducedMotion) {
      clock = time;
      const open = Math.min(1, Math.max(0, (1 - latch.scale.y) / 0.92));
      for (const { hinge, side } of leaves) hinge.rotation.y = -side * open * 1.2;
      if (reducedMotion) return;
      const awake = main.state === 'working' ? 1 : 0.45;
      const flare = burst(time - dropAt, 1.6) + burst(time - sendAt, 0.9) * 0.4;
      torches.forEach((flame, i) => {
        const lick = Math.sin(time * 11 + i * 1.7) * 0.14 + Math.sin(time * 17.3 + i * 2.9) * 0.08;
        flame.scale.set(1 + flare * 0.7, (0.75 + 0.35 * awake) * (1 + lick) + flare * 1.9, 1 + flare * 0.7);
        flame.rotation.z = Math.sin(time * 5 + i) * 0.08;
      });
      pool.scale.setScalar(1 + flare * 0.5);
      pool.material.opacity = (dark ? 0.5 : 0.1) * (0.6 + 0.4 * awake) + flare * 0.3;
      padLamps.forEach((lamp, i) => lamp.scale.setScalar(1 + Math.max(0, Math.sin(time * 3 - i)) * 0.6 * awake));
      for (const { ember, x, vx, vz, up, delay } of embers) {
        const age = time - dropAt - delay;
        ember.visible = age > 0 && age < 1.3;
        if (ember.visible) ember.position.set(x + vx * age, GATE.top + 0.3 + up * age - 2.2 * age * age, GATE.z + vz * age);
      }
    },
  };
  return kit.shadows(group);
}

// ---------- stations ----------

function ghost(kit) {
  const group = new Group();
  const stake = kit.basic('glow', { opacity: 0.75 });
  const tape = kit.basic('accent', { opacity: 0.4 });
  // A plot pegged out with tape, waiting for its paddock.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const b = ((i + 1) / 4) * TAU + Math.PI / 4;
    group.add(kit.cylinder(0.03, 0.03, 0.5, stake, [Math.cos(a) * 0.85, 0.25, Math.sin(a) * 0.85], 5));
    const run = kit.box(1.2, 0.05, 0.01, tape, [(Math.cos(a) + Math.cos(b)) * 0.425, 0.4, (Math.sin(a) + Math.sin(b)) * 0.425]);
    run.rotation.y = -Math.atan2(Math.sin(b) - Math.sin(a), Math.cos(b) - Math.cos(a));
    group.add(run);
  }
  const egg = kit.sphere(0.26, kit.basic('accent', { opacity: 0.35 }), [0, 0.36, 0], 10);
  egg.scale.y = 1.25;
  group.add(egg);
  return group;
}

// Each station stands on a patch of trodden earth. The warning lamp on its
// pole takes the agent's state colour.
function patch(kit, kind) {
  const m = mats(kit);
  const group = new Group();
  const radius = kind === 'worker' ? 0.98 : 0.74;
  group.add(kit.shadow(radius * 2.6, radius * 2.6, 0.3));
  const ground = kit.cylinder(radius, radius * 1.06, 0.08, m.earth, [0, 0.04, 0], 14);
  ground.receiveShadow = !kit.software;
  group.add(ground);
  const at = [radius * 0.74, 0, radius * 0.62];
  group.add(kit.cylinder(0.025, 0.035, 0.42, m.steel, [at[0], 0.29, at[2]], 6));
  group.add(kit.cylinder(0.05, 0.05, 0.1, m.hazard, [at[0], 0.13, at[2]], 6));
  const lamp = new Mesh(new CylinderGeometry(0.075, 0.09, 0.13, 8), kit.lamp());
  lamp.position.set(at[0], 0.56, at[2]);
  group.add(lamp);
  group.add(kit.cylinder(0.1, 0.1, 0.025, m.steel, [at[0], 0.64, at[2]], 8));
  // Sparks that rise from the lamp when the job is done.
  const sparks = [0, 1, 2].map(() => {
    const spark = new Mesh(new OctahedronGeometry(0.07, 0), lamp.material);
    spark.visible = false;
    group.add(spark);
    return spark;
  });
  return { group, lamp, sparks, at, top: 0.08 };
}

// `occupants` are the animals and people that leave a decommissioned station.
function trade(base, { labelY, puff, run, occupants = [] }) {
  const { group, lamp, sparks, at } = base;
  const seed = seeded(group.id) * 6;
  group.userData = {
    lamp,
    occupants,
    puff,
    labelY,
    frame(time, dt, station) {
      const failed = station.state === 'failed';
      const finished = station.state === 'done';
      const age = finished ? time - station.doneAt : -1;
      sparks.forEach((spark, i) => {
        const t = age - i * 0.22;
        spark.visible = t >= 0 && t < 1.5;
        if (!spark.visible) return;
        spark.position.set(at[0] + Math.sin(t * 5 + i * 2) * 0.14, 0.75 + t * 0.9, at[2]);
        spark.scale.setScalar(Math.min(1, t * 5) * (1 - t / 1.5) * 1.5);
        spark.rotation.y = t * 4;
      });
      run(time + seed, station.activity, { failed, finished, dt, age });
    },
  };
  return group;
}

// The big one, behind the highest fence in the park. It paces and roars while
// it works; a failed job is a fence thrown flat and the rex through it.
function rexPaddock(kit) {
  const base = patch(kit, 'worker');
  const { group, top } = base;
  const m = mats(kit);

  const { rex, head, jaw, legs, pose } = tyrant(kit);
  const STRIDE = 0.12;
  group.add(rex);

  // The fence across the front: four posts, four live cables and a sign.
  const FENCE = { z: 0.5, span: 1.68, height: 1.3 };
  const posts = [-0.84, -0.28, 0.28, 0.84].map(x => {
    const upright = post(kit, FENCE.height);
    upright.position.set(x, top, FENCE.z);
    group.add(upright);
    return upright;
  });
  const cables = [0.3, 0.55, 0.8, 1.05].map(y => {
    const cable = kit.box(FENCE.span, 0.016, 0.016, m.steel, [0, top + y, FENCE.z]);
    group.add(cable);
    return { cable, y };
  });
  const sign = new Mesh(new PlaneGeometry(0.28, 0.2), memo(kit, 'danger', () => kit.painted((ctx, w, h) => {
    drawWarningStripes(ctx, w, h, 14);
    ctx.fillStyle = '#f2b90f';
    ctx.fillRect(w * 0.14, h * 0.16, w * 0.72, h * 0.68);
    ctx.fillStyle = '#1c120c';
    ctx.beginPath();
    ctx.moveTo(w * 0.56, h * 0.22);
    ctx.lineTo(w * 0.38, h * 0.54);
    ctx.lineTo(w * 0.5, h * 0.54);
    ctx.lineTo(w * 0.42, h * 0.8);
    ctx.lineTo(w * 0.64, h * 0.44);
    ctx.lineTo(w * 0.52, h * 0.44);
    ctx.closePath();
    ctx.fill();
  }, { width: 112, height: 80, rough: 0.6, doubleSide: true })));
  sign.position.set(-0.56, top + 0.93, FENCE.z + 0.02);
  group.add(sign);
  const charge = kit.sphere(0.035, m.flame, [0, top + 1.05, FENCE.z], 6);
  group.add(charge);
  // A puddle by the fence, which shivers at every step.
  group.add(kit.cylinder(0.17, 0.17, 0.012, m.water, [-0.5, top + 0.008, 0.76], 10));
  const ripple = new Mesh(new TorusGeometry(0.1, 0.008, 4, 14), m.shell);
  ripple.rotation.x = Math.PI / 2;
  ripple.position.set(-0.5, top + 0.018, 0.76);
  group.add(ripple);

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 2.1, puff: new Vector3(0.6, 1.5, -0.2), occupants: [rex],
    run(t, active, state) {
      const busy = Math.min(1, active * 4);
      const loose = state.failed;
      // A slow bellow every few seconds, head up and jaw wide.
      const roar = state.finished ? 0.8 + Math.sin(t * 6) * 0.2 : loose ? 0.7 : Math.max(0, Math.sin(t * 0.9)) ** 8 * busy;
      // It walks the fence one way and back. The legs swing by the ground it
      // has covered, so a planted foot stays where it was put.
      const walked = loose || state.finished ? 0 : Math.sin(t * 1.3) * 0.2 * busy;
      const step = Math.sin(walked / STRIDE) * 0.19;
      rex.position.set(
        -0.12 + (loose ? 0.1 : walked),
        top + (state.finished ? Math.abs(Math.sin(t * 5)) * 0.06 : (1 - Math.abs(Math.cos(walked / STRIDE))) * 0.014),
        loose ? 0.42 : -0.22,
      );
      legs.forEach((leg, i) => { leg.rotation.z = i ? step : -step; });
      head.rotation.z = state.finished ? 0.42 : loose ? -0.25 : roar * 0.35 + Math.sin(t * 2.6) * 0.05 * busy;
      jaw.rotation.z = -(roar * 0.5 + 0.14);
      pose({ wag: Math.sin(t * 2.2) * (0.07 + 0.09 * busy) });
      posts.forEach((upright, i) => { upright.rotation.x = loose && (i === 1 || i === 2) ? 1.3 : 0; });
      cables.forEach(({ cable, y }, i) => {
        // A cable that held sings; one that failed lies where it fell.
        cable.position.y = top + (loose ? 0.05 + i * 0.012 : y + Math.sin(t * 40 + i * 2) * 0.004 * busy);
        cable.position.z = FENCE.z + (loose ? 0.25 + i * 0.12 : 0);
        cable.rotation.y = loose ? (i % 2 ? 0.16 : -0.12) : 0;
      });
      sign.visible = !loose;
      const live = busy > 0.05 && !loose && !state.finished;
      charge.visible = live;
      charge.position.x = -FENCE.span / 2 + ((t * 0.9) % 1) * FENCE.span;
      ripple.visible = live;
      ripple.scale.setScalar(0.4 + ((t * 2.07) % 1) * 1.3);
    },
  });
}

// Feeding time: a crane swings a bale out over the pen and lowers it into the
// ferns, where something is waiting. The raptors show themselves when it lands.
function raptorPen(kit) {
  const base = patch(kit, 'worker');
  const { group, top } = base;
  const m = mats(kit);
  const PEN = { x: 0.12, z: -0.05, r: 0.56 };
  const MAST = { x: -0.62, z: -0.45, height: 1.5, reach: 0.85 };

  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    const slab = new Group();
    slab.position.set(PEN.x + Math.cos(a) * PEN.r, top, PEN.z + Math.sin(a) * PEN.r);
    slab.rotation.y = Math.PI / 2 - a;
    slab.add(kit.box(0.66, 0.46, 0.07, m.concrete, [0, 0.23, 0]), kit.box(0.66, 0.04, 0.09, m.hazard, [0, 0.48, 0]));
    group.add(slab);
  }
  const brush = new Group();
  brush.position.set(PEN.x, top, PEN.z);
  for (const [x, z, s] of [[-0.18, 0.1, 1], [0.2, 0.14, 0.85], [0.02, -0.2, 0.95]]) {
    const fern = fronds(kit, m.leaf, 6, 0.55 * s, 0.9);
    fern.position.set(x, 0, z);
    brush.add(fern);
  }
  group.add(brush);
  // Both face the front of the pen, nose to the wall.
  const raptors = [[-0.17, 0.02, 0.3, 0.2], [0.18, 0.06, -0.4, -0.25]].map(([x, z, turn, curl]) => {
    const animal = raptor(kit, { curl });
    animal.body.position.set(PEN.x + x, top, PEN.z + z);
    animal.body.rotation.y = turn - Math.PI / 2;
    group.add(animal.body);
    return animal;
  });

  group.add(kit.cylinder(0.04, 0.055, MAST.height, m.steel, [MAST.x, top + MAST.height / 2, MAST.z], 6));
  group.add(kit.box(0.12, 0.08, 0.08, m.bulb, [MAST.x + 0.02, top + MAST.height + 0.1, MAST.z + 0.02]));
  const jib = new Group();
  jib.position.set(MAST.x, top + MAST.height, MAST.z);
  jib.add(kit.box(MAST.reach + 0.25, 0.05, 0.05, m.hazard, [(MAST.reach - 0.25) / 2, 0, 0]));
  jib.add(kit.box(0.16, 0.14, 0.12, m.iron, [-0.22, -0.02, 0]));
  group.add(jib);
  const cable = kit.cylinder(0.008, 0.008, 1, m.iron, [0, 0, 0], 4);
  group.add(cable);
  const bale = new Group();
  bale.add(kit.box(0.24, 0.17, 0.17, m.thatch, [0, 0, 0]));
  for (const x of [-0.07, 0.07]) bale.add(kit.box(0.02, 0.18, 0.18, m.red, [x, 0, 0]));
  group.add(bale);
  // Straight at the pen's middle from the mast.
  const OVER = -Math.atan2(PEN.z - MAST.z, PEN.x - MAST.x);

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 2.3, puff: new Vector3(PEN.x, 1.0, PEN.z), occupants: raptors.map(animal => animal.body),
    run(t, active, state) {
      const busy = Math.min(1, active * 4);
      const still = state.finished || state.failed;
      // Swing in over the pen and lower, then lift and swing back for more.
      const cycle = (t * 0.3) % 1;
      const out = still ? 1 : 0.5 - 0.5 * Math.cos(cycle * TAU);
      const dip = still ? 0 : Math.max(0, Math.sin(cycle * TAU - 1.2)) * busy;
      jib.rotation.y = OVER + (1 - out) * 1.2 * busy;
      const tipX = MAST.x + Math.cos(jib.rotation.y) * MAST.reach;
      const tipZ = MAST.z - Math.sin(jib.rotation.y) * MAST.reach;
      const hang = still ? 0.22 : 0.4 + dip * 0.72;
      cable.scale.y = hang;
      cable.position.set(tipX, top + MAST.height - hang / 2, tipZ);
      bale.visible = !state.finished;
      if (state.failed) {
        // The cable snapped and the bale lies outside the wall.
        bale.position.set(0.5, top + 0.1, 0.72);
        bale.rotation.set(0.3, 0.6, 0.2);
      } else {
        bale.position.set(tipX, top + MAST.height - hang - 0.08, tipZ);
        bale.rotation.set(0, t * 0.5, Math.sin(t * 3) * 0.06 * busy);
      }
      brush.rotation.z = Math.sin(t * 17) * 0.05 * (dip + (state.finished ? 0.4 : 0));
      raptors.forEach(({ body, head, pose }, i) => {
        // A look over the wall now and then; both up once they have been fed.
        const peek = state.finished ? 1 : state.failed ? (i === 0 ? 1 : 0) : Math.max(0, Math.sin(t * 0.7 + i * 2.4)) ** 6 * busy;
        pose({ rise: peek, wag: Math.sin(t * 3.1 + i * 2) * 0.12 });
        body.position.y = top + (state.finished ? Math.abs(Math.sin(t * 6 + i)) * 0.05 : 0);
        head.rotation.y = Math.sin(t * (state.finished ? 5 : 2.2) + i * 1.7) * 0.5;
        if (state.failed) head.rotation.z = 0.3;
      });
    },
  });
}

// A long-neck at a tall tree, reaching up for a mouthful and coming down to
// chew it. It rears on its hind legs when the job is done.
function brachioGrove(kit) {
  const base = patch(kit, 'worker');
  const { group, top } = base;
  const m = mats(kit);
  const REACH = { up: 0.45, down: 0.95 };

  const animal = longNeck(kit);
  const { body } = animal;
  body.scale.setScalar(0.85);
  body.position.set(-0.6, top, 0);
  group.add(body);
  // The tree stands where the mouth is at the top of a reach.
  animal.pose({ lean: REACH.up });
  const TREE = { x: body.position.x + (animal.mouth.x + 0.1) * body.scale.x, z: -0.05, height: animal.mouth.y * body.scale.y + 0.03 };

  group.add(kit.cylinder(0.07, 0.11, TREE.height, m.wood, [TREE.x, top + TREE.height / 2, TREE.z], 7));
  const crown = new Group();
  crown.add(fronds(kit, m.frond, 7, 0.7, 1.15, 0.2));
  const browse = kit.sphere(0.2, m.leaf, [-0.12, -0.02, 0], 7);
  browse.scale.y = 0.75;
  crown.add(browse);
  group.add(crown);
  for (const x of [-0.6, 0, 0.6]) group.add(kit.cylinder(0.03, 0.035, 0.4, m.wood, [x, top + 0.2, 0.72], 6));
  group.add(kit.box(1.2, 0.02, 0.02, m.steel, [0, top + 0.32, 0.72]));
  const litter = Array.from({ length: 5 }, (_, i) => {
    const leaf = new Mesh(new PlaneGeometry(0.11, 0.05), i % 2 ? m.frond : m.leaf);
    group.add(leaf);
    return { leaf, phase: i / 5 };
  });

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 2.6, puff: new Vector3(TREE.x, TREE.height + 0.1, TREE.z), occupants: [body],
    run(t, active, state) {
      const busy = Math.min(1, active * 4);
      const cycle = (t * 0.32) % 1;
      const up = state.finished ? 1 : state.failed ? 0 : (0.5 - 0.5 * Math.cos(cycle * TAU)) * busy + (1 - busy) * 0.3;
      const tug = Math.max(0, up - 0.82) * 5.5 * busy;
      body.rotation.z = state.finished ? 0.3 + Math.sin(t * 5) * 0.03 : 0;
      animal.pose({
        lean: (state.finished ? 0.2 : state.failed ? 1.5 : lerp(REACH.down, REACH.up, up)) + Math.sin(t * 2.2) * 0.015,
        turn: state.failed ? 0.35 : Math.sin(t * 0.8) * 0.05,
        // Level with the ground whatever the body does, nodding as it chews.
        nod: -body.rotation.z + (up < 0.3 && !state.failed ? Math.sin(t * 9) * 0.1 * busy : 0),
        wag: Math.sin(t * 2.6) * 0.2,
      });
      crown.visible = true;
      if (state.failed) {
        // The crown came away and lies at the foot of the bare trunk.
        crown.position.set(TREE.x - 0.1, top + 0.12, TREE.z + 0.5);
        crown.rotation.set(1.2, 0.4, 0);
      } else {
        crown.position.set(TREE.x, top + TREE.height, TREE.z);
        crown.rotation.set(0, 0, Math.sin(t * 20) * 0.06 * tug);
      }
      litter.forEach(({ leaf, phase }, i) => {
        const fall = (t * 0.9 + phase) % 1;
        leaf.visible = busy > 0.05 && !state.failed && !state.finished;
        leaf.position.set(TREE.x - 0.25 + (i - 2) * 0.09 + Math.sin(fall * 6 + i) * 0.06, top + TREE.height - 0.1 - fall * 1.6, TREE.z + 0.1 + (i % 2) * 0.12);
        leaf.rotation.set(fall * 5 + i, fall * 3, 0.4);
      });
    },
  });
}

// The hatchery: a clutch under a heat lamp. The back egg hatches when the job
// is done.
function hatchery(kit) {
  const base = patch(kit, 'subagent');
  const { group, top } = base;
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const TABLE = top + 0.26;
  group.add(kit.cylinder(0.5, 0.46, 0.26, m.cream, [0, top + 0.13, 0], 12));
  group.add(kit.cylinder(0.52, 0.52, 0.03, m.steel, [0, TABLE, 0], 12));
  const nest = new Mesh(new TorusGeometry(0.36, 0.09, 6, 14), m.thatch);
  nest.rotation.x = Math.PI / 2;
  nest.position.y = TABLE + 0.07;
  group.add(nest);
  const tints = [m.shell, m.belly, m.shell];
  const eggs = [[-0.16, 0.07], [0.16, 0.09], [0, -0.13]].map(([x, z], i) => {
    const egg = new Group();
    egg.position.set(x, TABLE + 0.04, z);
    const shell = new Mesh(new SphereGeometry(0.15, 10, 8, 0, TAU, i === 2 ? 0.95 : 0, Math.PI), tints[i]);
    shell.scale.y = 1.3;
    shell.position.y = 0.17;
    egg.add(shell);
    group.add(egg);
    return egg;
  });
  const cap = new Mesh(new SphereGeometry(0.15, 10, 6, 0, TAU, 0, 0.95), m.shell);
  cap.scale.y = 1.3;
  eggs[2].add(cap);
  // A hatchling is mostly head: a short snout on a thin neck, nose to the front.
  const chick = new Group();
  const hatchling = raptorHead(kit);
  hatchling.scale.set(1.25, 1.7, 1.7);
  hatchling.rotation.y = -Math.PI / 2;
  chick.add(hatchling, limb(kit, coats(kit).raptor.body, [[0, -0.16, -0.02, 0.04], [0, -0.07, -0.03, 0.036], [0, 0, -0.02, 0.04]], { sides: 6 }));
  eggs[2].add(chick);

  // The lamp reaches in over the clutch from a pole at the back.
  group.add(kit.cylinder(0.02, 0.025, 1.0, m.steel, [-0.42, top + 0.5, -0.3], 5));
  const arm = kit.box(0.54, 0.025, 0.025, m.steel, [-0.21, top + 1.0, -0.15]);
  arm.rotation.y = -Math.atan2(0.3, 0.42);
  group.add(arm);
  const shade = new Mesh(new ConeGeometry(0.15, 0.14, 8, 1, true), m.hazard);
  shade.position.set(0, top + 0.95, 0);
  group.add(shade);
  const bulb = kit.sphere(0.06, m.bulb, [0, top + 0.9, 0], 7);
  group.add(bulb);
  const warmth = kit.halo('glow', 1.2, 1.2, { opacity: dark ? 0.5 : 0.2, at: [0, TABLE + 0.022, 0] });
  group.add(warmth);

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 1.6, puff: new Vector3(0, 1.1, 0), occupants: [chick],
    run(t, active, state) {
      eggs.forEach((egg, i) => {
        const rock = Math.sin(t * (5 + i) + i * 2) * 0.16 * active;
        egg.rotation.z = state.failed ? (i === 0 ? 1.2 : 0) : rock;
        egg.position.y = TABLE + 0.04 + (state.failed ? 0 : Math.max(0, Math.sin(t * 3 + i * 2.1)) ** 6 * 0.06 * active);
      });
      const out = state.finished ? Math.min(1, state.age * 2.5) : 0;
      cap.position.set(out * 0.14, 0.17 + out * 0.17, -out * 0.08);
      cap.rotation.z = -out * 0.9;
      chick.visible = out > 0;
      chick.position.y = 0.13 + out * 0.17 + (state.finished ? Math.abs(Math.sin(t * 6)) * 0.03 : 0);
      chick.rotation.y = Math.sin(t * 2.4) * 0.5;
      // The lamp goes out over a clutch that failed.
      bulb.visible = !state.failed;
      warmth.visible = !state.failed;
      bulb.scale.setScalar(1 + (0.2 + Math.sin(t * 9) * 0.06) * active);
      warmth.scale.setScalar(0.8 + 0.25 * active);
    },
  });
}

// The amber lab: a needle works at a lump of amber and the strand it reads
// out builds up beside it, a rung at a time.
function amberLab(kit) {
  const base = patch(kit, 'subagent');
  const { group, top } = base;
  const m = mats(kit);
  const BENCH = top + 0.33;
  const RUNGS = 8;
  group.add(kit.box(1.0, 0.3, 0.46, m.cream, [0, top + 0.15, -0.1]));
  group.add(kit.box(1.04, 0.03, 0.5, m.steel, [0, top + 0.315, -0.1]));

  group.add(kit.cylinder(0.05, 0.07, 0.08, m.iron, [-0.25, BENCH + 0.04, -0.1], 7));
  const amber = new Mesh(new IcosahedronGeometry(0.16, 0), m.amber);
  amber.scale.set(1, 1.3, 0.8);
  group.add(amber);
  const midge = kit.sphere(0.03, m.ink, [0, 0, 0], 5);
  midge.scale.set(1.6, 0.6, 0.6);
  group.add(midge);
  group.add(kit.cylinder(0.02, 0.02, 0.72, m.steel, [-0.46, BENCH + 0.36, -0.26], 5));
  const reach = kit.box(0.28, 0.03, 0.03, m.steel, [-0.36, BENCH + 0.72, -0.18]);
  reach.rotation.y = -0.65;
  group.add(reach);
  const needle = kit.cylinder(0.012, 0.004, 0.3, m.steel, [0, 0, 0], 5);
  group.add(needle);

  const helix = new Group();
  helix.position.set(0.25, BENCH, -0.1);
  const rungs = Array.from({ length: RUNGS }, (_, k) => {
    const rung = new Group();
    rung.position.y = 0.08 + k * 0.095;
    rung.rotation.y = k * 0.7;
    rung.add(kit.sphere(0.035, m.hazard, [0.11, 0, 0], 6), kit.sphere(0.035, m.red, [-0.11, 0, 0], 6), kit.box(0.2, 0.014, 0.014, m.bone, [0, 0, 0]));
    helix.add(rung);
    return rung;
  });
  group.add(helix);

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 1.65, puff: new Vector3(0.25, 1.3, -0.1),
    run(t, active, state) {
      const working = active > 0.05 && !state.failed && !state.finished;
      const read = state.finished ? 1 : state.failed ? 0.25 : ((t * 0.09) % 1) * (active > 0.05 ? 1 : 0.2);
      rungs.forEach((rung, k) => { rung.visible = k < Math.max(1, Math.round(read * RUNGS)); });
      helix.rotation.y = t * (state.finished ? 1.2 : 0.4 + active * 2.2) * (state.failed ? 0 : 1);
      helix.position.y = BENCH + (state.finished ? 0.06 + Math.abs(Math.sin(t * 5)) * 0.05 : 0);
      helix.rotation.z = state.failed ? 0.5 : 0;
      // A failed sample has rolled off its stand.
      amber.position.set(state.failed ? -0.08 : -0.25, BENCH + (state.failed ? 0.12 : 0.26), state.failed ? 0.06 : -0.1);
      amber.rotation.set(0, t * (state.finished ? 0.8 : 0), state.failed ? 1.3 : 0);
      midge.visible = !state.failed && !state.finished;
      midge.position.set(-0.25, BENCH + 0.25, 0.035);
      const bob = working ? Math.abs(Math.sin(t * 9)) * 0.07 : state.failed ? 0.02 : 0.14;
      needle.position.set(-0.25, BENCH + 0.58 + bob, -0.1);
      needle.rotation.z = state.failed ? 0.6 : 0;
    },
  });
}

function screen(kit, key, draw) {
  return memo(kit, key, () => kit.painted(draw, { width: 128, height: 96, emissive: true, glow: kit.mode === 'dark' ? 1.1 : 0.8, rough: 0.3 }));
}

// The control desk: a ranger at three screens, watching the fences. The middle
// screen fills as the job goes, then shows how it went.
function controlDesk(kit) {
  const base = patch(kit, 'subagent');
  const { group, top } = base;
  const m = mats(kit);
  const DESK = top + 0.34;
  group.add(kit.box(1.05, 0.34, 0.4, m.console, [0, top + 0.17, -0.2]));
  group.add(kit.box(1.09, 0.03, 0.46, m.iron, [0, DESK, -0.18]));

  const map = screen(kit, 'screen-map', (ctx, w, h) => {
    ctx.fillStyle = '#0c2a1c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3ddc84';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 46, 34);
    ctx.strokeRect(66, 10, 52, 22);
    ctx.strokeRect(10, 54, 30, 32);
    ctx.strokeRect(50, 42, 68, 44);
    ctx.fillStyle = '#ffd166';
    for (const [x, y] of [[30, 26], [88, 20], [24, 70], [80, 62], [102, 74]]) ctx.fillRect(x, y, 6, 6);
  });
  const blank = screen(kit, 'screen-blank', (ctx, w, h) => {
    ctx.fillStyle = '#0c2a1c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3ddc84';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 34, w - 24, 28);
  });
  const fine = screen(kit, 'screen-ok', (ctx, w, h) => {
    ctx.fillStyle = '#0f3d22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7dffa8';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(34, 50);
    ctx.lineTo(56, 70);
    ctx.lineTo(96, 26);
    ctx.stroke();
  });
  const alarm = screen(kit, 'screen-fail', (ctx, w, h) => {
    ctx.fillStyle = '#4a0d0d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff8a8a';
    ctx.fillRect(56, 14, 16, 46);
    ctx.beginPath();
    ctx.arc(64, 76, 9, 0, TAU);
    ctx.fill();
  });
  const SCREEN = { w: 0.3, h: 0.22, y: DESK + 0.2, z: -0.3 };
  const face = new PlaneGeometry(SCREEN.w, SCREEN.h);
  const panels = [-1, 0, 1].map(i => {
    const panel = new Group();
    panel.position.set(i * 0.34, SCREEN.y, SCREEN.z + Math.abs(i) * 0.05);
    panel.rotation.set(-0.18, -i * 0.32, 0);
    panel.add(kit.box(SCREEN.w + 0.04, SCREEN.h + 0.04, 0.03, m.iron, [0, 0, -0.02]));
    panel.add(kit.cylinder(0.02, 0.03, 0.1, m.iron, [0, -SCREEN.h / 2 - 0.04, -0.02], 5));
    const lit = new Mesh(face, i ? map : blank);
    panel.add(lit);
    group.add(panel);
    return { panel, lit };
  });
  const middle = panels[1];
  const bar = kit.box(SCREEN.w * 0.8, 0.045, 0.004, m.hazard, [0, 0, 0.004]);
  middle.panel.add(bar);

  const ranger = new Group();
  const torso = kit.sphere(0.12, m.khaki, [0, 0.24, 0], 9);
  torso.scale.set(0.95, 1.2, 0.8);
  ranger.add(torso);
  for (const side of [-1, 1]) ranger.add(kit.cylinder(0.035, 0.04, 0.14, m.timber, [side * 0.06, 0.07, 0], 6));
  const head = new Group();
  head.position.set(0, 0.45, 0);
  head.add(kit.sphere(0.085, m.skin, [0, 0, 0], 9), kit.cylinder(0.15, 0.15, 0.016, m.khaki, [0, 0.06, 0], 10), kit.cylinder(0.075, 0.09, 0.07, m.khaki, [0, 0.1, 0], 8));
  ranger.add(head);
  const arms = [-1, 1].map(side => {
    const arm = new Group();
    arm.position.set(side * 0.12, 0.32, 0);
    arm.add(kit.cylinder(0.022, 0.022, 0.2, m.khaki, [0, 0, -0.1], 5).rotateX(Math.PI / 2));
    ranger.add(arm);
    return arm;
  });
  group.add(ranger);

  return trade({ ...base, group: kit.shadows(group) }, {
    labelY: 1.5, puff: new Vector3(0, 1.1, -0.2), occupants: [ranger],
    run(t, active, state) {
      const done = state.finished ? 1 : state.failed ? 0.25 : ((t * 0.09) % 1) * (active > 0.05 ? 1 : 0.2);
      const still = state.finished || state.failed;
      middle.lit.material = state.finished ? fine : state.failed ? alarm : blank;
      bar.visible = !still;
      bar.scale.x = Math.max(0.02, done);
      bar.position.x = -(SCREEN.w * 0.8 * (1 - bar.scale.x)) / 2;
      // Up and round to face the road when it is done; slumped when it failed.
      ranger.position.set(0.2, top + (state.finished ? Math.abs(Math.sin(t * 6)) * 0.1 : 0), 0.24);
      ranger.rotation.y = state.finished ? Math.PI : 0;
      head.rotation.x = state.failed ? -0.6 : 0;
      head.rotation.y = still ? 0 : Math.sin(t * 0.9) * 0.5 * Math.min(1, active * 4);
      arms.forEach((arm, i) => {
        arm.rotation.x = state.finished ? 1.9 : state.failed ? -1.2 : Math.sin(t * 13 + i * Math.PI) * 0.22 * active;
      });
    },
  });
}

const TRADES = [rexPaddock, raptorPen, brachioGrove];
const SMALL_FRY = [hatchery, amberLab, controlDesk];

function station(kit, kind, spot = { index: 0 }) {
  const cast = kind === 'worker' ? TRADES : SMALL_FRY;
  return cast[spot.index % cast.length](kit, spot);
}

// A timber shipping crate with warning bands and an air hole in its lid.
function crate(kit) {
  const group = new Group();
  group.add(kit.box(0.42, 0.32, 0.42, kit.mat('crate', { rough: 0.85 }), [0, 0.16, 0]));
  const band = kit.mat('tape', { rough: 0.6 });
  for (const y of [0.07, 0.25]) group.add(kit.box(0.44, 0.05, 0.44, band, [0, y, 0]));
  group.add(kit.box(0.2, 0.02, 0.2, kit.mat('door', { rough: 0.9 }), [0, 0.322, 0]));
  return kit.shadows(group);
}

// The park truck drives nose first along +z with the crate on its bed.
function carrier(kit) {
  const m = mats(kit);
  const object = new Group();
  const rig = new Group();
  object.add(rig);

  rig.add(kit.box(0.52, 0.1, 1.0, m.paint, [0, 0.17, 0]));
  rig.add(kit.box(0.5, 0.16, 0.38, m.cream, [0, 0.3, 0.29]));
  rig.add(kit.box(0.46, 0.17, 0.2, m.glass, [0, 0.46, 0.2]));
  rig.add(kit.box(0.5, 0.03, 0.26, m.red, [0, 0.56, 0.2]));
  rig.add(kit.cylinder(0.035, 0.035, 0.05, m.hazard, [0, 0.6, 0.2], 6));
  rig.add(kit.box(0.5, 0.05, 0.54, m.cream, [0, 0.245, -0.22]));
  for (const side of [-1, 1]) {
    rig.add(kit.box(0.03, 0.12, 0.54, m.cream, [side * 0.245, 0.33, -0.22]));
    rig.add(kit.sphere(0.035, m.bulb, [side * 0.17, 0.3, 0.485], 6));
  }
  rig.add(kit.box(0.5, 0.12, 0.03, m.cream, [0, 0.33, -0.485]));
  rig.add(kit.box(0.54, 0.05, 0.04, m.iron, [0, 0.19, 0.515]));
  const wheels = [-0.3, 0.3].flatMap(z => [-1, 1].map(side => {
    const wheel = kit.cylinder(0.11, 0.11, 0.08, m.iron, [side * 0.27, 0.11, z], 8);
    wheel.rotation.z = Math.PI / 2;
    rig.add(wheel);
    return wheel;
  }));

  const hold = new Group();
  hold.position.set(0, 0.27, -0.22);
  rig.add(hold);
  kit.shadows(object);

  return {
    object,
    hold,
    route: 'ground',
    cruise: 0,
    pose(target, { time, travel, speed }) {
      // It rocks on its springs and sits back for as long as it is moving.
      for (const wheel of wheels) wheel.rotation.x = travel * 44;
      rig.position.y = Math.abs(Math.sin(time * 17)) * 0.012 * speed;
      rig.rotation.x = -0.035 * speed;
      rig.rotation.z = Math.sin(time * 6.3) * 0.012 * speed;
    },
  };
}

// Instructions go out as tour cars on the rail; a result comes home as amber.
function packet(kit, direction) {
  if (direction === 'down') return tourCar(kit, 0.09);
  const nugget = new Mesh(new OctahedronGeometry(0.075, 0), mats(kit).amber);
  nugget.position.y = 0.09;
  nugget.scale.y = 1.3;
  return nugget;
}

// ---------- scenery ----------

function palm(kit, height, lean) {
  const m = mats(kit);
  const tree = new Group();
  const trunk = kit.cylinder(0.13, 0.2, height, m.wood, [0, height / 2, 0], 7);
  tree.add(trunk);
  for (let i = 1; i < 5; i += 1) tree.add(kit.cylinder(0.19 - i * 0.012, 0.19 - i * 0.012, 0.05, m.earth, [0, (height * i) / 5, 0], 7));
  const crown = fronds(kit, m.frond, 8, 1.5, 1.25, 0.26);
  crown.position.y = height;
  tree.add(crown);
  tree.rotation.z = lean;
  return tree;
}

// The perimeter fence down one side of the clearing, a lamp on every other
// post.
function perimeter(kit, x) {
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const group = new Group();
  const FROM = -6.4;
  const LENGTH = 16;
  for (let i = 0; i < 9; i += 1) {
    const z = FROM + (i / 8) * LENGTH;
    const upright = post(kit, 1.9);
    upright.position.set(x, 0, z);
    group.add(upright);
    if (i % 2) continue;
    group.add(kit.sphere(0.09, m.bulb, [x, 2.04, z], 6));
    group.add(kit.halo('glow', 3, 3, { opacity: dark ? 0.3 : 0.05, at: [x, 0.02, z] }));
  }
  for (const y of [0.45, 0.9, 1.35, 1.8]) group.add(kit.box(0.02, 0.02, LENGTH, m.steel, [x, y, FROM + LENGTH / 2]));
  return group;
}

function decor(kit) {
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const group = new Group();

  // The island's high peak behind the ridge, a waterfall down its near face.
  const peak = new Group();
  peak.position.set(-8.6, 0, -12.4);
  const cone = new Mesh(new ConeGeometry(3.6, 4.6, 8), m.ridge);
  cone.rotation.y = Math.PI / 8;
  cone.position.y = 2.3;
  peak.add(cone);
  const SLOPE = Math.atan2(3.6, 4.6);
  // Each strand lies on the face it runs down, from `from` up the peak to its foot.
  for (const [x, width, from] of [[-0.12, 0.3, 3.5], [0.2, 0.16, 2.6]]) {
    const mid = from / 2;
    const strand = kit.box(width, from / Math.cos(SLOPE), 0.05, m.fall, [x, mid, 3.6 * (1 - mid / 4.6) * Math.cos(Math.PI / 8) + 0.04]);
    strand.rotation.x = -SLOPE;
    peak.add(strand);
  }
  peak.add(kit.cylinder(1.15, 1.25, 0.06, m.water, [0, 0.03, 3.9], 12));
  peak.add(kit.halo('#ffffff', 3.4, 2.6, { opacity: dark ? 0.16 : 0.34, at: [0, 0.08, 3.8], additive: false }));
  group.add(peak);
  const ridge = [[6.4, -13, 2.6, 2.6], [13.6, -10.6, 2.1, 2.0], [2.6, -13.2, 1.8, 1.7], [-12.6, -9.4, 2.2, 2.2], [-3.4, -13.6, 2.4, 2.1]];
  for (const [x, z, r, h] of ridge) group.add(new Mesh(new ConeGeometry(r, h, 7), m.ridge).translateX(x).translateY(h / 2).translateZ(z));

  group.add(perimeter(kit, -9.9), perimeter(kit, 9.9));

  const palms = [[-11.2, -5.4, 3.4, 0.1], [11.3, -4.4, 3.8, -0.12], [-11.6, 6.4, 3.1, 0.14], [11.2, 7.9, 3.5, -0.08], [-6.3, -10.2, 3.9, 0.06], [6.1, -10.9, 3.3, -0.1], [12.6, 0.6, 2.8, -0.16]];
  for (const [x, z, height, lean] of palms) {
    group.add(kit.shadow(2.6, 2.6, 0.24, [x, 0.004, z]));
    const tree = palm(kit, height, lean);
    tree.position.set(x, 0, z);
    tree.rotation.y = x + z;
    group.add(tree);
  }
  const ferns = [[-10.6, -2.6, 1.3], [10.7, -1.4, 1.2], [-10.8, 2.6, 1.5], [10.6, 2.2, 1.3], [-10.5, 8.6, 1.2], [10.6, 9.4, 1.4], [-8.2, -9.6, 1.4], [7.1, -8.5, 1.2], [-12.8, -3.2, 1.6], [12.6, -2.6, 1.5], [0.6, -10.4, 1.2]];
  ferns.forEach(([x, z, s], i) => {
    const fern = fronds(kit, i % 2 ? m.leaf : m.frond, 7, 0.9 * s, 1.0, 0.18);
    fern.position.set(x, 0, z);
    group.add(fern);
  });
  for (const [x, z, r] of [[-10.9, 4.4, 0.7], [12.2, -6.4, 0.8], [-12.2, -5.8, 0.9], [-10.4, -7.4, 0.55], [10.6, 8.4, 0.5], [-1.2, -11.3, 0.6]]) {
    group.add(kit.shadow(r * 2.8, r * 2.8, 0.22, [x, 0.004, z]));
    group.add(boulder(kit, r, m.rock, [x, r * 0.5, z]));
  }

  // The tour car bay behind the lodge: a thatched shelter and two cars in.
  const bay = new Group();
  bay.position.set(-3.8, 0, -9);
  bay.rotation.y = 0.25;
  bay.add(kit.shadow(4.2, 3.6, 0.26));
  for (const x of [-1.3, 1.3]) for (const z of [-0.9, 0.9]) bay.add(kit.cylinder(0.07, 0.08, 1.5, m.timber, [x, 0.75, z], 6));
  const shelter = new Mesh(new ConeGeometry(2.3, 0.9, 4), m.thatch);
  shelter.rotation.y = Math.PI / 4;
  shelter.scale.z = 0.75;
  shelter.position.y = 1.95;
  bay.add(shelter);
  for (const x of [-0.6, 0.6]) {
    const car = tourCar(kit);
    car.scale.setScalar(2.7);
    car.position.set(x, 0, 0.1);
    bay.add(car);
  }
  group.add(bay);

  // A lake under the ridge, and the herd that comes down to it.
  const LAKE = { x: 10.2, z: -9.1, r: 1.8 };
  group.add(kit.cylinder(LAKE.r, LAKE.r + 0.1, 0.06, m.water, [LAKE.x, 0.03, LAKE.z], 14));
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU;
    group.add(boulder(kit, 0.24 + seeded(i) * 0.16, m.rock, [LAKE.x + Math.cos(a) * (LAKE.r + 0.2), 0.1, LAKE.z + Math.sin(a) * (LAKE.r + 0.2)], 0.7));
  }
  for (const [x, z, size, turn, lean, curl] of [[11.4, -10, 1.6, 2.6, 0.5, 0.22], [8.8, -8.4, 1.2, 3.6, 1.25, -0.3]]) {
    const { body, pose } = longNeck(kit, { curl });
    body.scale.setScalar(size);
    body.position.set(x, 0, z);
    body.rotation.y = turn;
    pose({ lean });
    group.add(kit.shadow(size * 2.9, size * 1.9, 0.26, [x, 0.004, z]));
    group.add(body);
  }
  return kit.shadows(group);
}

// Leaves drift down by day. By night it rains, and lightning walks along
// behind the ridge.
function weather(kit) {
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const object = new Group();
  const streak = dark && new CylinderGeometry(0.007, 0.007, 0.6, 3);
  const rain = dark && kit.basic('#bcd6e6', { opacity: 0.45, additive: true });
  const motes = Array.from({ length: dark ? 46 : 24 }, (_, i) => {
    const mesh = dark ? new Mesh(streak, rain) : new Mesh(new PlaneGeometry(0.22, 0.1), i % 3 ? m.frond : m.leaf);
    if (dark) mesh.rotation.z = -0.14;
    object.add(mesh);
    return {
      mesh,
      x: (seeded(i * 5 + 1) - 0.5) * 22,
      z: -7.6 + seeded(i * 5 + 2) * 18,
      phase: seeded(i * 5 + 3),
      speed: dark ? 1.1 + seeded(i * 5 + 4) * 0.7 : 0.06 + seeded(i * 5 + 4) * 0.05,
      spin: 0.9 + seeded(i * 5 + 5) * 1.6,
    };
  });

  const STRIKES = [[-4, -17], [8, -18], [1, -19]];
  const PERIOD = 7.5;
  const bolt = new Group();
  if (dark && !kit.reducedMotion) {
    const glare = kit.basic('#eaf2ff', { opacity: 0.9, additive: true });
    const path = [[0, 16], [-0.7, 13.4], [0.4, 10.8], [-0.5, 8.4], [0.3, 6]];
    for (let i = 1; i < path.length; i += 1) {
      const [x0, y0] = path[i - 1];
      const [x1, y1] = path[i];
      const stroke = kit.box(0.09, Math.hypot(x1 - x0, y1 - y0), 0.09, glare, [(x0 + x1) / 2, (y0 + y1) / 2, 0]);
      stroke.rotation.z = Math.atan2(x0 - x1, y1 - y0);
      bolt.add(stroke);
    }
    bolt.add(kit.halo('#cfe0ff', 30, 15, { opacity: 0.2, at: [0, 9, 0], flat: false, additive: true }));
    bolt.visible = false;
    object.add(bolt);
  }

  return {
    object,
    frame(time) {
      const now = kit.reducedMotion ? 0 : time;
      motes.forEach((mote, i) => {
        const drift = (mote.phase + now * mote.speed) % 1;
        if (dark) {
          mote.mesh.position.set(mote.x - drift * 1.2, 8.6 - drift * 8.6, mote.z);
          return;
        }
        mote.mesh.position.set(mote.x + Math.sin(now * 1.1 + i) * 0.4, 8.6 - drift * 8.2, mote.z);
        mote.mesh.rotation.set(now * mote.spin + i, now * 0.7 + i, Math.sin(now * 1.6 + i) * 0.6);
      });
      if (!dark || kit.reducedMotion) return;
      // One strike and its echo, then dark again until the next.
      const since = time % PERIOD;
      const [x, z] = STRIKES[Math.floor(time / PERIOD) % STRIKES.length];
      bolt.visible = since < 0.09 || (since > 0.17 && since < 0.24);
      bolt.position.set(x, 0, z);
    },
  };
}

export default {
  palette,
  layout,
  view,
  pad: false,
  dock: false,
  ghost,
  floor,
  hall,
  station,
  crate,
  carrier,
  packet,
  decor,
  weather,
  frame,
};
