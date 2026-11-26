// Hotel's Factory floor: the lobby, seen from above and to one side the way
// the hotel draws its rooms, built of chunky flat-shaded blocks. The floor is
// a marble checker by day and a softly lit dance floor by night, and the aisle
// is the red carpet up to the canopy over the hotel's door. The main agent is
// the hotel itself: four storeys with balconies, windows that light and go
// dark one by one through the evening, and a neon sign on the roof. Each
// worker is a guest room with two of its walls cut away and each subagent a
// concierge desk, and a place still queued is a plot roped off and reserved.
// Finished jobs come home as suitcases on a brass luggage trolley. The place is
// lived in: a guest idles in every room, a concierge minds every desk, the orc
// bellhop keeps the door, and a pool with loungers lies beside the hotel.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, PlaneGeometry, Vector3,
} from 'three';

const PALETTE = {
  light: {
    ground: '#e0cca2', horizon: '#cfe3ef', zenith: '#eef3f6',
    line: '#b98a00', aisle: '#b3263a', body: '#f4ead0', trim: '#17628f', roof: '#2478ab',
    accent: '#0e6088', worker: '#f5b800', busy: '#1763c9', ok: '#2a7a14', fail: '#c2283a', idle: '#5d7180',
    crate: '#8a4b2a', tape: '#f5b800', smoke: '#5d7180', moss: '#8d97a6', glow: '#f5b800', window: '#ffd45e', door: '#10202b',
    sky: '#ffffff', sun: '#fff7e6',
    tile: '#f8f2e4', ink: '#10202b', wall: '#dfe9ef', carpet: '#9cc3da', wood: '#8a5a2b', brass: '#d9a514',
    leaf: '#3c8c2a', pot: '#b3542e', water: '#3aa7d9', linen: '#ffffff', blanket: '#2478ab',
    glass: '#8fbfd8', neon: '#e0489e', paper: '#f6efdc', leather: '#5c3418', stone: '#d8cdb4',
    sunIntensity: 1.6, skyIntensity: 1.8, envIntensity: 0.5, exposure: 1.02, fogNear: 16, fogSpan: 34,
  },
  dark: {
    ground: '#2a4f74', horizon: '#3a2f4f', zenith: '#151629',
    line: '#ffcc33', aisle: '#a3243a', body: '#566a8a', trim: '#1f4a6e', roof: '#24597f',
    accent: '#6cc4f5', worker: '#ffcc33', busy: '#7fb8ff', ok: '#7fdc6a', fail: '#ff8795', idle: '#86a0b4',
    crate: '#a8643a', tape: '#ffcc33', smoke: '#9a8fa8', moss: '#7f8da0', glow: '#ffcc33', window: '#ffc870', door: '#0a0f1c',
    sky: '#ffbe8a', sun: '#ffd2a4',
    tile: '#3a6488', ink: '#070b14', wall: '#4a5a78', carpet: '#24557a', wood: '#6a4421', brass: '#ffcc33',
    leaf: '#3f8a46', pot: '#8a3f24', water: '#2a8fd0', linen: '#e6dccb', blanket: '#2a5f90',
    glass: '#1c2438', neon: '#ff5fa8', paper: '#efe2c4', leather: '#4a2a14', stone: '#55607a',
    sunIntensity: 1.45, skyIntensity: 1.4, envIntensity: 0.6, exposure: 1.18, fogNear: 16, fogSpan: 34,
  },
};

// Behind the floor is the sky over the town: pale by day, and a warm dusk
// glowing behind the hotel by night.
function backdrop(mode) {
  return mode === 'dark'
    ? 'radial-gradient(ellipse 85% 55% at 50% 30%, #6b4560 0%, #3a2f4f 45%, transparent 80%), '
      + 'linear-gradient(180deg, #151629 0%, #24223f 45%, #3a2f4f 75%, #2a2a44 100%)'
    : 'linear-gradient(180deg, #eef3f6, #d3e6f1 55%, #c3ddec)';
}

// The camera stands as far round to the side as the engine lets it, and the
// rooms turn a little towards it, so the floor reads as a room seen from its
// corner.
const layout = { turn: 0.3, advisor: { x: 3.8, z: -6.1, yaw: -0.6 } };
const view = { elevation: 0.6, azimuth: 0.3 };

const TAU = Math.PI * 2;
const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const ease = t => t * t * (3 - 2 * t);
const css = colour => '#' + colour.getHexString();
// Two colours (palette keys, hex strings or colours) mixed `t` of the way.
const mix = (kit, a, b, t) => kit.color(a).clone().lerp(kit.color(b), t);
const seeded = index => {
  const x = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// What a skin builds once for a kit: shared unit shapes and painted sheets.
const skinCache = new WeakMap();
function memo(kit, key, build) {
  let bag = skinCache.get(kit);
  if (!bag) {
    bag = {};
    skinCache.set(kit, bag);
  }
  return (bag[key] ||= build());
}

// The engine frees whatever is in the kit's material map with the scene, so
// the painted sheets and the window materials live there, one of each per look.
function shared(kit, key, make) {
  if (!kit.materials.has(key)) kit.materials.set(key, make());
  return kit.materials.get(key);
}

// Unit shapes every part scales one of. Everything is a block or an
// eight-sided post, so the hotel keeps its chunky pixel look.
const SHAPES = {
  block: () => new BoxGeometry(1, 1, 1),
  post: () => new CylinderGeometry(1, 1, 1, 8),
};

// A block `w` by `h` by `d` centred on x, y, z. `name` marks a part tests and
// readers look for; baking keeps it on the merged mesh.
function block(parent, kit, material, w, h, d, x, y, z, name = '') {
  const mesh = new Mesh(memo(kit, 'shape:block', SHAPES.block), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function post(parent, kit, material, r, h, x, y, z, name = '') {
  const mesh = new Mesh(memo(kit, 'shape:post', SHAPES.post), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(r, h, r);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function pivot(parent, x, y, z) {
  const group = new Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

// The still parts under `parts`, drawn as one mesh for each material and
// shadow setting they share, each laid where it stood: a storey of balconies
// alone is a hundred blocks, and drawn one by one each would cost a draw call.
// A see-through part keeps its own mesh so it still sorts where it stands. The
// merged mesh is named after the named parts in it.
function bake(parts) {
  parts.updateMatrixWorld(true);
  const from = new Matrix4().copy(parts.matrixWorld).invert();
  const sets = new Map();
  const alone = [];
  parts.traverse(node => {
    if (!node.isMesh && !node.isSprite) return;
    const place = new Matrix4().multiplyMatrices(from, node.matrixWorld);
    if (node.isSprite || node.material.transparent) {
      alone.push([node, place]);
      return;
    }
    const names = Object.keys(node.geometry.attributes).sort().join();
    const key = [node.material.uuid, names, node.castShadow, node.receiveShadow, node.renderOrder].join('|');
    if (!sets.has(key)) sets.set(key, { first: node, pieces: [], names: new Set(), data: {} });
    const set = sets.get(key);
    const piece = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    set.pieces.push(piece.applyMatrix4(place));
    if (node.name) set.names.add(node.name);
    Object.assign(set.data, node.userData);
  });
  const baked = new Group();
  for (const [node, place] of alone) {
    place.decompose(node.position, node.quaternion, node.scale);
    baked.add(node);
  }
  for (const { first, pieces, names, data } of sets.values()) {
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(pieces[0].attributes)) {
      const array = new Float32Array(pieces.reduce((sum, piece) => sum + piece.attributes[name].array.length, 0));
      let at = 0;
      for (const piece of pieces) {
        array.set(piece.attributes[name].array, at);
        at += piece.attributes[name].array.length;
      }
      geometry.setAttribute(name, new BufferAttribute(array, attribute.itemSize));
    }
    pieces.forEach(piece => piece.dispose());
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.name = [...names].join(' ');
    Object.assign(mesh.userData, data);
    baked.add(mesh);
  }
  return baked;
}

// The materials every part shares, flat-shaded so each block face reads crisp.
function mats(kit) {
  const dark = kit.mode === 'dark';
  return memo(kit, 'mats', () => ({
    body: kit.mat('body', { rough: 0.85, flat: true }),
    trim: kit.mat('trim', { rough: 0.55, metal: 0.12, flat: true }),
    roof: kit.mat('roof', { rough: 0.7, flat: true }),
    wall: kit.mat('wall', { rough: 0.85, flat: true }),
    wood: kit.mat('wood', { rough: 0.75, flat: true }),
    brass: kit.mat('brass', { rough: 0.35, metal: 0.7, emissive: 'brass', glow: dark ? 0.22 : 0.05, flat: true }),
    aisle: kit.mat('aisle', { rough: 0.85, flat: true }),
    carpet: kit.mat('carpet', { rough: 0.9, flat: true }),
    linen: kit.mat('linen', { rough: 0.85, flat: true }),
    blanket: kit.mat('blanket', { rough: 0.85, flat: true }),
    ink: kit.mat('ink', { rough: 0.6, flat: true }),
    door: kit.mat('door', { rough: 1, flat: true }),
    leaf: kit.mat('leaf', { rough: 0.8, flat: true }),
    leafDark: kit.mat(mix(kit, 'leaf', 'ink', 0.3), { rough: 0.8, flat: true }),
    pot: kit.mat('pot', { rough: 0.85, flat: true }),
    stone: kit.mat('stone', { rough: 0.9, flat: true }),
    paper: kit.mat('paper', { rough: 0.9, flat: true }),
    leather: kit.mat('leather', { rough: 0.7, flat: true }),
    crate: kit.mat('crate', { rough: 0.7, flat: true }),
    tape: kit.mat('tape', { rough: 0.5, emissive: 'tape', glow: dark ? 0.5 : 0.1, flat: true }),
    accent: kit.mat('accent', { rough: 0.6, flat: true }),
    neon: kit.mat('neon', { rough: 0.4, emissive: 'neon', glow: dark ? 1.6 : 0.25, flat: true }),
    warm: kit.mat('window', { rough: 0.4, emissive: 'window', glow: dark ? 1.2 : 0.3, flat: true }),
    water: kit.mat('water', { rough: 0.15, metal: 0.2, emissive: 'water', glow: dark ? 0.45 : 0.08, flat: true }),
    worker: kit.mat('worker', { rough: 0.5, emissive: 'worker', glow: dark ? 0.4 : 0.08, flat: true }),
  }));
}

// ---------- the people ----------

// Who is staying: hair, skin, shirt, trousers and a hair style, the same in
// both modes as the guests on the page are.
const GUESTS = [
  { hair: '#3b2416', skin: '#f0c8a0', shirt: '#e0489e', legs: '#2b4a7a', shoes: '#2a1a12', style: 'bob' },
  { hair: '#f2c94c', skin: '#f6d7b8', shirt: '#28b4e0', legs: '#3a3a48', shoes: '#14141c', style: 'quiff' },
  { hair: '#141414', skin: '#b9805a', shirt: '#f5b800', legs: '#17628f', shoes: '#3a2416', style: 'bun' },
  { hair: '#b3542e', skin: '#e9b48c', shirt: '#3c8c2a', legs: '#6b46b8', shoes: '#1c1c24', style: 'spiky' },
];
const BELLHOP = { hair: '#1c2a14', skin: '#83c851', shirt: '#c8283c', legs: '#3a1a22', shoes: '#10101a', style: 'orc' };

// A person in blocks standing on the origin and facing +z, about as tall as a
// room's door: legs and shoes, a body with arms and hands, and a head with eyes
// and a hair style. Each moving part is its own pivot with its blocks baked.
function figure(kit, look) {
  const m = mats(kit);
  const skin = kit.mat(look.skin, { rough: 0.7, flat: true });
  const shirt = kit.mat(look.shirt, { rough: 0.8, flat: true });
  const legsMat = kit.mat(look.legs, { rough: 0.85, flat: true });
  const shoes = kit.mat(look.shoes, { rough: 0.6, flat: true });
  const hair = kit.mat(look.hair, { rough: 0.85, flat: true });
  const orc = look.style === 'orc';
  const root = new Group();
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = pivot(root, side * 0.065, 0.27, 0);
    const parts = new Group();
    block(parts, kit, legsMat, 0.1, 0.22, 0.11, 0, -0.12, 0);
    block(parts, kit, shoes, 0.11, 0.05, 0.16, 0, -0.245, 0.025);
    leg.add(bake(parts));
    legs.push(leg);
  }
  const body = pivot(root, 0, 0.27, 0);
  const torso = new Group();
  block(torso, kit, shirt, 0.28, 0.25, 0.16, 0, 0.125, 0);
  block(torso, kit, legsMat, 0.29, 0.04, 0.17, 0, 0.01, 0);
  if (orc) {
    // The bellhop's jacket: brass buttons down the front and a gold collar.
    for (let row = 0; row < 3; row += 1) {
      for (const side of [-1, 1]) block(torso, kit, m.brass, 0.03, 0.03, 0.02, side * 0.045, 0.19 - row * 0.065, 0.085, 'buttons');
    }
    block(torso, kit, m.brass, 0.3, 0.035, 0.17, 0, 0.245, 0);
  } else {
    block(torso, kit, skin, 0.1, 0.03, 0.02, 0, 0.235, 0.081);
  }
  body.add(bake(torso));
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * 0.18, 0.225, 0);
    const parts = new Group();
    block(parts, kit, shirt, 0.08, 0.17, 0.1, 0, -0.08, 0);
    if (orc) block(parts, kit, m.brass, 0.085, 0.025, 0.105, 0, -0.16, 0);
    block(parts, kit, skin, 0.07, 0.065, 0.08, 0, -0.2, 0.005);
    arm.add(bake(parts));
    arms.push(arm);
  }
  const head = pivot(body, 0, 0.255, 0);
  const face = new Group();
  block(face, kit, skin, 0.26, 0.24, 0.24, 0, 0.12, 0);
  for (const side of [-1, 1]) block(face, kit, m.ink, 0.04, 0.045, 0.012, side * 0.062, 0.13, 0.121);
  block(face, kit, kit.mat(mix(kit, look.skin, '#000000', 0.35), { rough: 0.7, flat: true }), 0.08, 0.02, 0.012, 0, 0.055, 0.121);
  if (orc) {
    for (const side of [-1, 1]) {
      // Pointed ears and a tusk at each corner of the mouth.
      block(face, kit, skin, 0.09, 0.06, 0.05, side * 0.16, 0.14, -0.01);
      block(face, kit, skin, 0.05, 0.04, 0.04, side * 0.215, 0.17, -0.01);
      block(face, kit, m.linen, 0.03, 0.045, 0.02, side * 0.06, 0.06, 0.13);
    }
    // The pillbox cap with its gold band, tipped a touch.
    block(face, kit, shirt, 0.19, 0.1, 0.19, 0.02, 0.29, -0.01, 'pillbox-cap');
    block(face, kit, m.brass, 0.2, 0.03, 0.2, 0.02, 0.255, -0.01, 'pillbox-cap');
    block(face, kit, m.brass, 0.04, 0.03, 0.04, 0.02, 0.355, -0.01, 'pillbox-cap');
    block(face, kit, hair, 0.27, 0.04, 0.24, 0, 0.245, -0.005);
  } else {
    block(face, kit, hair, 0.28, 0.07, 0.26, 0, 0.27, -0.005, 'hair');
    block(face, kit, hair, 0.28, 0.14, 0.05, 0, 0.19, -0.12, 'hair');
    if (look.style === 'bob') {
      for (const side of [-1, 1]) block(face, kit, hair, 0.04, 0.17, 0.2, side * 0.145, 0.16, -0.02, 'hair');
    } else if (look.style === 'quiff') {
      block(face, kit, hair, 0.22, 0.07, 0.1, 0, 0.32, 0.08, 'hair');
    } else if (look.style === 'bun') {
      block(face, kit, hair, 0.12, 0.1, 0.12, 0, 0.34, -0.06, 'hair');
    } else {
      for (const [x, z] of [[-0.08, 0.04], [0.06, -0.02], [0, 0.09], [0.1, 0.08], [-0.06, -0.08]]) block(face, kit, hair, 0.06, 0.07, 0.06, x, 0.325, z, 'hair');
    }
  }
  head.add(bake(face));
  const person = { root, body, head, arms, legs };
  return person;
}

// Small movements a person makes while standing about, a pure function of
// time: a sway, a turn of the head, a nod now and then, the arms easing and
// every few seconds a step. A busy person works with their right hand. `t`
// is held at 0 under Reduce animations, so the pose holds.
function idle(person, t, phase, busy = false) {
  const { body, head, arms, legs } = person;
  const a = t * 1.15 + phase;
  body.rotation.z = Math.sin(a) * 0.035;
  body.rotation.y = Math.sin(a * 0.37 + 1) * 0.12;
  head.rotation.y = Math.sin(t * 0.45 + phase * 1.3) * 0.28;
  head.rotation.x = Math.max(0, Math.sin(t * 0.62 + phase * 1.7)) ** 6 * 0.24 - 0.02;
  const drift = Math.sin(a * 0.9) * 0.08;
  arms[0].rotation.x = drift;
  arms[1].rotation.x = busy ? -0.75 + Math.sin(t * 7 + phase) * 0.22 : -drift;
  arms[0].rotation.z = -0.06;
  arms[1].rotation.z = 0.06;
  const pace = t * 0.17 + phase * 0.1;
  const beat = pace - Math.floor(pace);
  const lift = beat < 0.1 ? Math.sin((beat / 0.1) * Math.PI) : 0;
  const which = Math.abs(Math.floor(pace)) % 2;
  legs[which].rotation.x = -0.38 * lift;
  legs[1 - which].rotation.x = 0;
  body.position.y = 0.27 + lift * 0.012;
}

// ---------- the floor ----------

// The checker, one tile to a unit: veined marble by day; by night a dance
// floor with four tiles in each stretch of eight lit soft pink, blue, gold
// and violet, the same few the page's floor lights, and dimmer than they were.
// It is painted once and never changes, so it glows without a flicker. The red
// carpet runs up the middle with a brass rail down each side.
const LIT_TILES = [[1, 2, '#e0489e'], [5, 1, '#28b4e0'], [3, 5, '#f5b800'], [6, 6, '#7c5cf0']];

function floor(kit) {
  const group = new Group();
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const tones = [css(kit.palette.ground), css(kit.palette.tile)];
  const seam = css(mix(kit, kit.palette.ground, kit.palette.ink, dark ? 0.35 : 0.18));
  const vein = css(mix(kit, kit.palette.tile, kit.palette.ink, 0.24));
  group.add(kit.ground({
    rough: dark ? 0.55 : 0.4, metal: 0.05, repeat: [17, 17],
    draw(ctx, w) {
      const cell = w / 8;
      for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
          ctx.fillStyle = tones[(row + column) % 2];
          ctx.fillRect(column * cell, row * cell, cell, cell);
          if (!dark && (row + column) % 2) {
            // Marble: two faint veins wandering across each pale tile.
            ctx.strokeStyle = vein;
            ctx.lineWidth = 1.5;
            for (let line = 0; line < 2; line += 1) {
              const s = seeded(row * 8 + column + line * 64);
              ctx.beginPath();
              ctx.moveTo(column * cell, row * cell + cell * s);
              ctx.lineTo(column * cell + cell * 0.45, row * cell + cell * seeded(s * 91));
              ctx.lineTo(column * cell + cell, row * cell + cell * (1 - s));
              ctx.stroke();
            }
          }
        }
      }
      if (dark) {
        // Lit tiles: a soft glow from the middle of each, fading to its edge.
        for (const [column, row, colour] of LIT_TILES) {
          const cx = (column + 0.5) * cell;
          const cy = (row + 0.5) * cell;
          ctx.fillStyle = colour;
          ctx.globalAlpha = 0.3;
          ctx.fillRect(column * cell, row * cell, cell, cell);
          const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.62);
          glow.addColorStop(0, 'rgba(255,255,255,0.55)');
          glow.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = glow;
          ctx.fillRect(column * cell, row * cell, cell, cell);
          ctx.globalAlpha = 1;
        }
      }
      ctx.strokeStyle = seam;
      ctx.lineWidth = 3;
      for (let line = 0; line <= 8; line += 1) {
        ctx.beginPath(); ctx.moveTo(line * cell, 0); ctx.lineTo(line * cell, w); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, line * cell); ctx.lineTo(w, line * cell); ctx.stroke();
      }
    },
  }));
  const dressing = new Group();
  const carpet = block(dressing, kit, m.aisle, 1.84, 0.022, 13.8, 0, 0.011, 3.3, 'carpet');
  carpet.receiveShadow = !kit.software;
  const inlay = kit.mat(mix(kit, 'aisle', 'brass', 0.45), { rough: 0.8, flat: true });
  for (const side of [-1, 1]) {
    block(dressing, kit, m.brass, 0.08, 0.03, 13.8, side * 0.98, 0.015, 3.3);
    block(dressing, kit, inlay, 0.05, 0.024, 13.8, side * 0.78, 0.012, 3.3);
  }
  group.add(kit.shadows(bake(dressing)));
  return group;
}

// ---------- the hotel ----------

// The sign on the hotel's roof: neon letters in a frame of neon tube by night,
// brass letters on the title bar's blue by day.
function sign(kit) {
  return shared(kit, 'hotel-sign', () => {
    const dark = kit.mode === 'dark';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = dark ? '#151a2c' : css(kit.palette.roof);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = dark ? '#ffcc33' : css(kit.palette.brass);
      ctx.lineWidth = 8;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.font = '700 70px Verdana, Geneva, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (dark) {
        ctx.shadowColor = '#ff4f9a';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#ffd0e6';
        ctx.fillText('ORC HOTEL', w / 2, h / 2 + 4);
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ff7ab8';
        ctx.fillText('ORC HOTEL', w / 2, h / 2 + 4);
      } else {
        ctx.fillStyle = css(kit.palette.brass);
        ctx.fillText('ORC HOTEL', w / 2, h / 2 + 4);
      }
    }, { width: 512, height: 112, rough: 0.5, metal: 0.1, emissive: true, glow: dark ? 1.15 : 0.15 });
  });
}

// The windows that light and go dark through the evening, in groups, each on
// its own material. One group changes at a time, every few seconds, and takes
// a couple of seconds to fade, so the building never blinks. The last group
// stays lit all night.
const WINDOW_GROUPS = 6;
const WINDOW_SLOT = 3.4;
const WINDOW_FADE = 2.4;
const WINDOW_ORDER = [0, 3, 1, 4, 2, 5];
const WINDOW_START = [true, false, true, true, false, true];

// How lit group `g` is at `time`, 0 to 1. Groups take turns: slot k changes
// the group whose turn it is, so each changes once every WINDOW_GROUPS slots.
function windowLevel(g, time) {
  if (g >= WINDOW_GROUPS) return 1;
  const slot = Math.floor(time / WINDOW_SLOT);
  const turn = WINDOW_ORDER[g];
  const last = slot - ((((slot - turn) % WINDOW_GROUPS) + WINDOW_GROUPS) % WINDOW_GROUPS);
  const flips = Math.floor((last - turn) / WINDOW_GROUPS);
  const on = flips % 2 === 0 ? !WINDOW_START[g] : WINDOW_START[g];
  const fade = ease(clamp01((time - last * WINDOW_SLOT) / WINDOW_FADE));
  return on ? fade : 1 - fade;
}

function windowMaterials(kit) {
  return memo(kit, 'windows', () => Array.from({ length: WINDOW_GROUPS + 1 }, (_, g) => shared(kit, `hotel-window-${g}`, () => {
    const material = kit.mat('window', { rough: 0.3, metal: 0.1, emissive: 'window', glow: 1, flat: true }).clone();
    if (kit.mode !== 'dark') {
      // By day the glass is glass, with the sun on it.
      material.color.copy(kit.color('glass'));
      material.emissiveIntensity = 0.06;
    }
    return material;
  })));
}

// Sets every window group as it is at `time` (dark only; by day nothing lights).
function lightWindows(kit, materials, time) {
  if (kit.mode !== 'dark') return;
  const on = kit.color('window');
  const off = kit.color('glass');
  materials.forEach((material, g) => {
    const level = windowLevel(g, time);
    material.color.lerpColors(off, on, 0.15 + level * 0.85);
    material.emissiveIntensity = level * 1.05;
  });
}

// A window with its frame, a cross of glazing bars, a sill and curtains, set
// in a wall facing `facing` (+z front, or ±x for the sides).
function windowAt(still, kit, material, x, y, z, w, h, facing) {
  const m = mats(kit);
  const along = facing === 'z';
  const sx = along ? w : 0.03;
  const sz = along ? 0.03 : w;
  block(still, kit, material, sx, h, sz, x, y, z, 'window');
  const out = 0.02;
  const ox = along ? 0 : Math.sign(x) * out;
  const oz = along ? out : 0;
  block(still, kit, m.trim, along ? w + 0.06 : 0.04, 0.04, along ? 0.04 : w + 0.06, x + ox, y + h / 2 + 0.02, z + oz);
  block(still, kit, m.stone, along ? w + 0.1 : 0.07, 0.04, along ? 0.07 : w + 0.1, x + ox * 1.5, y - h / 2 - 0.02, z + oz * 1.5);
  block(still, kit, m.trim, along ? 0.025 : 0.035, h, along ? 0.035 : 0.025, x + ox, y, z + oz);
  block(still, kit, m.trim, along ? w : 0.035, 0.025, along ? 0.035 : w, x + ox, y + h * 0.1, z + oz);
}

// A palm in a pot, all blocks: a square pot, a trunk of stacked segments
// leaning a little, and fronds drooping off the top in two greens.
function palm(parent, kit, x, z, height, seed = 0) {
  const m = mats(kit);
  const tree = pivot(parent, x, 0, z);
  block(tree, kit, m.pot, 0.44, 0.38, 0.44, 0, 0.19, 0, 'palm');
  block(tree, kit, m.pot, 0.5, 0.06, 0.5, 0, 0.36, 0);
  block(tree, kit, kit.mat('#3a2616', { rough: 0.95, flat: true }), 0.38, 0.03, 0.38, 0, 0.39, 0);
  const segments = Math.max(3, Math.round(height / 0.22));
  const lean = (seeded(seed) - 0.5) * 0.3;
  let top = 0.39;
  for (let i = 0; i < segments; i += 1) {
    const size = 0.13 - i * 0.006;
    block(tree, kit, i % 2 ? m.wood : kit.mat(mix(kit, 'wood', 'ink', 0.2), { rough: 0.8, flat: true }), size, 0.22, size, lean * i * 0.06, top + 0.11, 0);
    top += 0.22;
  }
  const crown = pivot(tree, lean * segments * 0.06, top, 0);
  for (let frond = 0; frond < 7; frond += 1) {
    const hub = pivot(crown, 0, 0, 0);
    hub.rotation.y = frond * TAU / 7 + seed;
    const droop = pivot(hub, 0, 0, 0);
    droop.rotation.z = -0.35 - (frond % 3) * 0.12;
    block(droop, kit, frond % 2 ? m.leaf : m.leafDark, 0.42, 0.04, 0.2, 0.22, 0, 0);
    const tip = pivot(droop, 0.42, 0, 0);
    tip.rotation.z = -0.5;
    block(tip, kit, frond % 2 ? m.leafDark : m.leaf, 0.34, 0.035, 0.14, 0.16, 0, 0);
  }
  block(crown, kit, m.leafDark, 0.16, 0.1, 0.16, 0, 0.02, 0);
  return tree;
}

// The hotel: a lobby storey on a marble plinth, three storeys of rooms above
// with balconies, a canopy over the door at the head of the carpet, and on the
// roof the neon sign, a water tank, two flags and the lamp that blinks while
// the run waits on you. The flags stir while the main agent works, the star
// over the sign turns, the sign jumps as a job lands, and the bellhop keeps
// the door.
const STOREY = 0.6;
const LOBBY_TOP = 2.05;
const ROOF = LOBBY_TOP + STOREY * 3;
const COLUMNS = [-1.9, -0.95, 0, 0.95, 1.9];

function hall(kit) {
  const group = new Group();
  const still = new Group();
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const windows = windowMaterials(kit);
  let pane = 0;
  // Which group a window joins: a spread so neighbours rarely share one.
  const nextWindow = () => windows[Math.min(WINDOW_GROUPS, (pane++ * 5 + 2) % (WINDOW_GROUPS + 2))];

  group.add(kit.shadow(6.6, 4.6, 0.34));
  if (dark) group.add(kit.halo('#ffb060', 3.6, 2.8, { opacity: 0.2, at: [0, 0.02, 2.5] }));

  // The plinth and the steps up to the door, carpeted.
  block(still, kit, m.stone, 5.4, 0.14, 3.0, 0, 0.07, 0, 'plinth');
  block(still, kit, m.trim, 5.46, 0.03, 3.06, 0, 0.145, 0);
  block(still, kit, m.stone, 2.3, 0.07, 0.3, 0, 0.035, 1.65);
  block(still, kit, m.aisle, 1.4, 0.075, 0.32, 0, 0.04, 1.65);
  block(still, kit, m.aisle, 1.4, 0.145, 0.2, 0, 0.075, 1.41);

  // The lobby: tall glass either side of the door between brass pilasters.
  block(still, kit, m.body, 5.0, LOBBY_TOP - 0.16, 2.6, 0, 0.16 + (LOBBY_TOP - 0.16) / 2, 0, 'lobby');
  for (const x of [-1.55, 1.55]) {
    block(still, kit, windows[WINDOW_GROUPS], 1.1, 1.0, 0.03, x, 0.9, 1.31, 'window');
    block(still, kit, m.trim, 1.18, 0.06, 0.06, x, 1.43, 1.32);
    block(still, kit, m.trim, 1.18, 0.06, 0.06, x, 0.38, 1.32);
    for (const dx of [-0.37, 0, 0.37]) block(still, kit, m.brass, 0.03, 1.0, 0.04, x + dx, 0.9, 1.33);
    block(still, kit, m.trim, 1.12, 0.03, 0.04, x, 1.18, 1.33);
    // A lobby lamp glowing behind each pane.
    block(still, kit, m.warm, 0.12, 0.16, 0.04, x, 0.95, 1.29);
  }
  for (const x of [-2.42, -0.86, 0.86, 2.42]) {
    block(still, kit, m.trim, 0.16, LOBBY_TOP - 0.16, 0.12, x, 0.16 + (LOBBY_TOP - 0.16) / 2, 1.33);
    block(still, kit, m.brass, 0.2, 0.06, 0.16, x, 0.19, 1.34);
    block(still, kit, m.brass, 0.2, 0.06, 0.16, x, LOBBY_TOP - 0.08, 1.34);
  }
  // The doorway, its brass frame, and the transom of light above it.
  block(still, kit, m.door, 1.24, 1.32, 0.04, 0, 0.8, 1.31);
  for (const x of [-0.66, 0.66]) block(still, kit, m.brass, 0.08, 1.36, 0.1, x, 0.82, 1.34);
  block(still, kit, m.brass, 1.4, 0.08, 0.1, 0, 1.5, 1.34);
  block(still, kit, m.warm, 1.1, 0.2, 0.03, 0, 1.66, 1.315);
  for (const dx of [-0.36, 0, 0.36]) block(still, kit, m.trim, 0.03, 0.2, 0.04, dx, 1.66, 1.33);
  // The cornice over the lobby.
  block(still, kit, m.trim, 5.24, 0.1, 2.84, 0, LOBBY_TOP, 0);
  block(still, kit, m.brass, 5.28, 0.025, 2.88, 0, LOBBY_TOP - 0.06, 0);

  // The canopy: red, with a brass fascia and a valance of blocks along its
  // front, on two brass poles over the head of the carpet. It stands above
  // the engine's doorway light, which warms the steps beneath it.
  block(still, kit, m.aisle, 2.1, 0.08, 1.6, 0, 2.02, 2.1, 'canopy');
  block(still, kit, m.brass, 2.16, 0.12, 0.05, 0, 1.98, 2.9, 'canopy');
  for (const side of [-1, 1]) block(still, kit, m.brass, 0.05, 0.12, 1.6, side * 1.06, 1.98, 2.1);
  for (let tooth = 0; tooth < 7; tooth += 1) block(still, kit, m.aisle, 0.2, 0.08, 0.04, -0.9 + tooth * 0.3, 1.88, 2.9);
  for (const side of [-1, 1]) {
    block(still, kit, m.brass, 0.06, 1.98, 0.06, side * 1.0, 0.99, 2.82, 'canopy');
    block(still, kit, m.brass, 0.12, 0.04, 0.12, side * 1.0, 0.02, 2.82);
    block(still, kit, m.brass, 0.1, 0.06, 0.1, side * 1.0, 1.95, 2.82);
  }
  block(still, kit, m.warm, 0.18, 0.06, 0.18, 0, 1.96, 2.2);

  // Three storeys of rooms, each a little narrower than the lobby, a band of
  // trim between them, five windows across the front and balconies at four.
  for (let level = 0; level < 3; level += 1) {
    const y = LOBBY_TOP + 0.05 + level * STOREY;
    block(still, kit, m.body, 4.8, STOREY, 2.4, 0, y + STOREY / 2, -0.05, 'storey');
    block(still, kit, m.trim, 4.9, 0.05, 2.5, 0, y + STOREY - 0.02, -0.05);
    for (const x of COLUMNS) {
      windowAt(still, kit, nextWindow(), x, y + 0.31, 1.16, 0.4, 0.34, 'z');
      if (x === 0) continue;
      // A balcony: a slab, a brass rail on posts, and a plant in a pot.
      block(still, kit, m.stone, 0.72, 0.05, 0.34, x, y + 0.02, 1.32, 'balcony');
      block(still, kit, m.brass, 0.72, 0.03, 0.03, x, y + 0.23, 1.48);
      for (const side of [-1, 1]) block(still, kit, m.brass, 0.03, 0.03, 0.32, x + side * 0.35, y + 0.23, 1.33);
      for (let p = 0; p < 5; p += 1) block(still, kit, m.brass, 0.022, 0.2, 0.022, x - 0.34 + p * 0.17, y + 0.13, 1.48);
      if ((level + Math.round(x)) % 2 === 0) {
        block(still, kit, m.pot, 0.1, 0.09, 0.1, x + 0.24, y + 0.09, 1.3);
        block(still, kit, m.leaf, 0.14, 0.1, 0.14, x + 0.24, y + 0.18, 1.3);
      }
    }
    for (const side of [-1, 1]) {
      for (const z of [-0.65, 0.45]) windowAt(still, kit, nextWindow(), side * 2.41, y + 0.31, z, 0.4, 0.34, 'x');
    }
  }
  for (const side of [-1, 1]) {
    windowAt(still, kit, windows[WINDOW_GROUPS], side * 2.51, 0.95, 0.2, 0.9, 0.8, 'x');
  }

  // The roof: a slab and parapet, the tank on its legs, and the sign.
  block(still, kit, m.roof, 4.96, 0.1, 2.56, 0, ROOF + 0.05, -0.05, 'roof');
  for (const side of [-1, 1]) {
    block(still, kit, m.trim, 5.0, 0.14, 0.08, 0, ROOF + 0.12, -0.05 + side * 1.26);
    block(still, kit, m.trim, 0.08, 0.14, 2.56, side * 2.46, ROOF + 0.12, -0.05);
  }
  for (const [x, z] of [[-1.98, -0.88], [-1.42, -0.88], [-1.98, -0.32], [-1.42, -0.32]]) block(still, kit, m.trim, 0.05, 0.2, 0.05, x, ROOF + 0.2, z);
  block(still, kit, m.wood, 0.62, 0.4, 0.62, -1.7, ROOF + 0.5, -0.6, 'tank');
  block(still, kit, m.ink, 0.64, 0.04, 0.64, -1.7, ROOF + 0.42, -0.6);
  block(still, kit, m.ink, 0.64, 0.04, 0.64, -1.7, ROOF + 0.6, -0.6);
  block(still, kit, m.roof, 0.46, 0.08, 0.46, -1.7, ROOF + 0.74, -0.6);
  block(still, kit, m.trim, 0.22, 0.12, 0.22, 1.2, ROOF + 0.16, -0.7);
  // The sign's frame: two legs and a strut behind each.
  for (const x of [-1.25, 1.25]) {
    block(still, kit, m.trim, 0.07, 0.22, 0.07, x, ROOF + 0.2, 0.75);
    const strut = block(still, kit, m.trim, 0.05, 0.55, 0.05, x, ROOF + 0.3, 0.5);
    strut.rotation.x = 0.8;
  }
  // The flagpoles at the front corners; their flags hang from pivots below.
  for (const side of [-1, 1]) {
    block(still, kit, m.trim, 0.035, 0.9, 0.035, side * 2.3, ROOF + 0.55, 1.05);
    block(still, kit, m.brass, 0.06, 0.06, 0.06, side * 2.3, ROOF + 1.02, 1.05);
  }
  block(still, kit, m.trim, 0.05, 0.42, 0.05, 2.05, ROOF + 0.31, -0.8);
  block(still, kit, m.trim, 0.025, 0.24, 0.025, 0, ROOF + 0.98, 0.75);

  // Potted palms either side of the door.
  for (const side of [-1, 1]) palm(still, kit, side * 2.35, 1.8, 0.9, side);

  // The rolling glass door, hung from its top edge so it rolls up.
  const door = kit.box(1.16, 1.26, 0.05, kit.mat('glass', { rough: 0.2, metal: 0.3, opacity: 0.8 }), [0, 0, 0]);
  door.geometry.translate(0, -0.63, 0);
  door.position.set(0, 1.44, 1.36);

  // The neon sign, which jumps as a job lands, and the star turning over it.
  const board = new Group();
  board.position.set(0, ROOF + 0.62, 0.75);
  const boardParts = new Group();
  block(boardParts, kit, dark ? m.ink : m.trim, 3.3, 0.64, 0.1, 0, 0, 0, 'neon-sign');
  for (const side of [-1, 1]) {
    block(boardParts, kit, m.neon, 3.34, 0.04, 0.04, 0, side * 0.34, 0.05, 'neon-sign');
    block(boardParts, kit, m.neon, 0.04, 0.68, 0.04, side * 1.67, 0, 0.05);
  }
  board.add(bake(boardParts));
  const face = new Mesh(new PlaneGeometry(3.18, 0.56), sign(kit));
  face.name = 'neon-sign';
  face.position.z = 0.052;
  board.add(face);
  const turner = new Group();
  turner.position.set(0, ROOF + 1.2, 0.75);
  const star = new Group();
  for (const turn of [0, Math.PI / 4]) block(star, kit, m.brass, 0.24, 0.24, 0.04, 0, 0, 0).rotation.z = turn;
  block(star, kit, m.neon, 0.1, 0.1, 0.06, 0, 0, 0);
  turner.add(bake(star));
  const beacon = kit.box(0.17, 0.17, 0.17, kit.beacon, [2.05, ROOF + 0.6, -0.8]);
  beacon.name = 'beacon';
  const flags = [];
  for (const [side, tone] of [[-1, m.worker], [1, m.accent]]) {
    const flag = new Group();
    flag.position.set(side * 2.3, ROOF + 0.88, 1.05);
    block(flag, kit, tone, 0.42, 0.24, 0.02, -side * 0.21, 0, 0);
    flags.push(flag);
  }

  // The bellhop at the door, a head taller than the guests.
  const bellhop = figure(kit, BELLHOP);
  bellhop.root.scale.setScalar(1.4);
  bellhop.root.position.set(1.3, 0.02, 2.45);
  bellhop.root.rotation.y = -0.25;
  bellhop.root.name = 'bellhop';
  idle(bellhop, 0, 0.7);

  group.add(kit.shadows(bake(still)), door, board, turner, beacon, ...flags, kit.shadows(bellhop.root));
  lightWindows(kit, windows, 0);

  let pulse = -Infinity;
  let clock = 0;
  group.userData = {
    door,
    beacon,
    windows,
    figures: [bellhop],
    spin: [[turner, 'y', 1.4]],
    swing: flags.map((flag, index) => [flag, 'y', 0.35, 2.1 + index * 0.4]),
    chimney: new Vector3(-1.7, ROOF + 0.85, -0.6),
    labelY: ROOF + 1.45,
    react(event) {
      if (event === 'delivery') pulse = clock;
    },
    frame(time, dt, main, held) {
      clock = time;
      const still = kit.reducedMotion || held === true;
      const t = still ? 0 : time;
      const kick = still ? 0 : Math.max(0, 1 - (time - pulse) / 0.8);
      board.scale.setScalar(1 + kick * 0.1);
      idle(bellhop, t, 0.7);
      lightWindows(kit, windows, t);
    },
  };
  return group;
}

// A place not yet taken: its plot roped off with brass posts and red velvet,
// and a reserved sign standing in the middle of it.
function ghost(kit) {
  const group = new Group();
  const line = kit.basic('line', { opacity: 0.75 });
  const rope = kit.basic('aisle', { opacity: 0.8 });
  const corners = [[-0.75, -0.65], [0.75, -0.65], [0.75, 0.65], [-0.75, 0.65]];
  for (const [x, z] of corners) {
    group.add(kit.box(0.06, 0.42, 0.06, line, [x, 0.21, z]));
    group.add(kit.box(0.1, 0.06, 0.1, line, [x, 0.45, z]));
  }
  for (const [w, d, x, z] of [[1.44, 0.04, 0, -0.65], [1.44, 0.04, 0, 0.65], [0.04, 1.24, -0.75, 0], [0.04, 1.24, 0.75, 0]]) {
    group.add(kit.box(w, 0.04, d, rope, [x, 0.34, z]));
    group.add(kit.box(w, 0.012, d, line, [x, 0.03, z]));
  }
  group.add(kit.box(0.05, 0.5, 0.05, line, [0, 0.27, 0]));
  group.add(kit.box(0.56, 0.28, 0.05, kit.basic('accent', { opacity: 0.65 }), [0, 0.64, 0]));
  group.add(kit.box(0.44, 0.05, 0.06, line, [0, 0.64, 0.01]));
  return group;
}

// The three tiers of a room's wall: wood wainscot, papered wall and a cap,
// with a brass dado rail between. `along` is 'x' for a wall running along x.
function wall(still, kit, along, length, x, z) {
  const m = mats(kit);
  const size = (thick, h) => (along === 'x' ? [length, h, thick] : [thick, h, length]);
  block(still, kit, m.wood, ...size(0.09, 0.42), x, 0.29, z, 'wall');
  block(still, kit, m.wall, ...size(0.08, 0.6), x, 0.8, z, 'wall');
  block(still, kit, m.brass, ...size(0.1, 0.03), x, 0.51, z);
  block(still, kit, m.trim, ...size(0.11, 0.06), x, 1.12, z);
}

// A guest room with its two near walls cut away: a numbered door in one wall,
// a window with curtains in the other, a made bed with a lamp on the bedside
// table that is the room's state light, a rug, a suitcase, and the guest. `far`
// is the side of the room away from the camera once the engine has turned its
// front to the aisle, and the bed and one wall stand on it. The camera looks
// from the right of the aisle (see `view`), so the other wall left standing is
// the one away from the aisle on the left and the one on the aisle on the
// right.
function room(kit, still, far, front, look, number) {
  const m = mats(kit);
  block(still, kit, m.carpet, 1.7, 0.08, 1.5, 0, 0.04, 0, 'floor');
  wall(still, kit, 'z', 1.5, far * 0.81, 0);
  const wz = front ? 0.71 : -0.71;
  wall(still, kit, 'x', 1.7, 0, wz);
  // The door, its frame and knob, and its number on both faces. On the
  // right of the aisle the wall beside the aisle is seen edge on, so the door
  // stands in the far wall there instead, at its front end.
  const doorWood = kit.mat(mix(kit, 'wood', 'aisle', 0.35), { rough: 0.7, flat: true });
  let plate;
  if (front) {
    const dx = far * 0.81;
    const dz = 0.5;
    block(still, kit, doorWood, 0.12, 0.84, 0.44, dx, 0.5, dz, 'room-door');
    for (const side of [-1, 1]) block(still, kit, m.trim, 0.14, 0.9, 0.05, dx, 0.5, dz + side * 0.245);
    block(still, kit, m.trim, 0.14, 0.06, 0.54, dx, 0.95, dz);
    for (const side of [-1, 1]) block(still, kit, m.brass, 0.03, 0.04, 0.04, dx + side * 0.07, 0.5, dz - 0.15);
    plate = block(still, kit, roomPlate(kit, number), 0.135, 0.1, 0.18, dx, 0.76, dz, 'room-number');
  } else {
    const doorX = -far * 0.42;
    block(still, kit, doorWood, 0.46, 0.84, 0.12, doorX, 0.5, wz, 'room-door');
    for (const side of [-1, 1]) block(still, kit, m.trim, 0.05, 0.9, 0.14, doorX + side * 0.255, 0.5, wz);
    block(still, kit, m.trim, 0.56, 0.06, 0.14, doorX, 0.95, wz);
    for (const side of [-1, 1]) block(still, kit, m.brass, 0.04, 0.04, 0.03, doorX + 0.16, 0.5, wz + side * 0.07);
    plate = block(still, kit, roomPlate(kit, number), 0.18, 0.1, 0.135, doorX, 0.76, wz, 'room-number');
  }
  plate.userData.roomNumber = number;
  // The window in the far wall, lit, with its curtains drawn back.
  const wx = far * 0.765;
  const winZ = front ? -0.1 : 0.28;
  block(still, kit, kit.windows, 0.02, 0.36, 0.46, wx, 0.76, winZ, 'window');
  block(still, kit, m.trim, 0.04, 0.04, 0.52, wx, 0.96, winZ);
  block(still, kit, m.stone, 0.07, 0.04, 0.56, wx - far * 0.02, 0.56, winZ);
  block(still, kit, m.trim, 0.03, 0.36, 0.025, wx, 0.76, winZ);
  const curtain = kit.mat(look.shirt, { rough: 0.9, flat: true });
  for (const side of [-1, 1]) block(still, kit, curtain, 0.04, 0.46, 0.09, wx - far * 0.02, 0.74, winZ + side * 0.29, 'curtains');
  if (!front) {
    // A picture on the wall over the bed.
    block(still, kit, m.brass, 0.03, 0.22, 0.3, wx, 0.86, -0.38);
    block(still, kit, kit.mat(look.legs, { rough: 0.8, flat: true }), 0.035, 0.16, 0.24, wx, 0.86, -0.38);
  }
  // The bed: frame, mattress, blanket turned down, two pillows, headboard;
  // pushed back from the door where it shares the far wall.
  const bedX = far * 0.36;
  const bz = front ? -0.1 : 0;
  block(still, kit, m.wood, 0.74, 0.16, 1.0, bedX, 0.16, bz - 0.1, 'bed');
  block(still, kit, m.linen, 0.7, 0.1, 0.96, bedX, 0.29, bz - 0.1, 'bed');
  block(still, kit, m.blanket, 0.72, 0.12, 0.6, bedX, 0.3, bz + 0.1);
  block(still, kit, m.linen, 0.72, 0.03, 0.1, bedX, 0.36, bz - 0.18);
  for (const side of [-1, 1]) block(still, kit, m.linen, 0.28, 0.08, 0.18, bedX + side * 0.17, 0.38, bz - 0.46);
  block(still, kit, m.wood, 0.78, 0.46, 0.08, bedX, 0.37, bz - 0.63);
  block(still, kit, m.brass, 0.8, 0.04, 0.1, bedX, 0.61, bz - 0.63);
  block(still, kit, m.wood, 0.78, 0.22, 0.06, bedX, 0.19, bz + 0.41);
  // The bedside table with its drawer.
  const tableX = far * -0.26;
  block(still, kit, m.wood, 0.3, 0.32, 0.3, tableX, 0.24, -0.5, 'bedside');
  block(still, kit, kit.mat(mix(kit, 'wood', 'ink', 0.3), { rough: 0.8, flat: true }), 0.24, 0.08, 0.02, tableX, 0.3, -0.345);
  block(still, kit, m.brass, 0.04, 0.03, 0.03, tableX, 0.3, -0.33);
  // The rug, with a border, and a suitcase at the foot of the bed.
  block(still, kit, m.brass, 0.78, 0.012, 0.56, far * -0.2, 0.086, 0.22, 'rug');
  block(still, kit, m.aisle, 0.68, 0.016, 0.46, far * -0.2, 0.088, 0.22, 'rug');
  const caseX = front ? far * 0.05 : bedX;
  block(still, kit, m.crate, 0.36, 0.24, 0.12, caseX, 0.2, 0.55, 'suitcase');
  block(still, kit, m.tape, 0.04, 0.25, 0.13, caseX + 0.09, 0.2, 0.55);
  const guest = figure(kit, look);
  guest.root.position.set(far * -0.28, 0.08, 0.18);
  guest.root.rotation.y = far * -0.35;
  return { person: guest, lampAt: [tableX, 0.62, -0.5], stalk: 0.22, swing: [], spin: [], puff: new Vector3(bedX, 0.7, -0.3), labelY: 1.8 };
}

// A room's number, painted on a brass plate; one sheet per number.
function roomPlate(kit, number) {
  return shared(kit, `hotel-room-${number}`, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = css(kit.palette.brass);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css(kit.palette.ink);
    ctx.font = '700 44px Verdana, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), w / 2, h / 2 + 2);
  }, { width: 128, height: 64, rough: 0.4, metal: 0.5, emissive: true, glow: kit.mode === 'dark' ? 0.3 : 0.05 }));
}

// A concierge desk on a square rug: a panelled counter with a brass top, the
// bell, the open ledger and a pen on it, a banker's lamp that is the state
// light, a board behind hung with brass room keys, and the concierge on a
// stool that swivels while they work.
function desk(kit, still, look) {
  const m = mats(kit);
  block(still, kit, m.aisle, 1.56, 0.03, 1.56, 0, 0.015, 0, 'rug');
  block(still, kit, m.carpet, 1.36, 0.034, 1.36, 0, 0.017, 0, 'rug');
  // The wall behind, and the key rack on it.
  block(still, kit, m.wood, 1.24, 0.46, 0.09, 0, 0.27, -0.72, 'wall');
  block(still, kit, m.wall, 1.24, 0.62, 0.08, 0, 0.81, -0.72, 'wall');
  block(still, kit, m.trim, 1.3, 0.06, 0.11, 0, 1.14, -0.72);
  block(still, kit, m.brass, 1.26, 0.03, 0.1, 0, 0.5, -0.72);
  block(still, kit, m.wood, 0.84, 0.44, 0.04, 0, 0.8, -0.66, 'key-rack');
  block(still, kit, m.brass, 0.8, 0.03, 0.05, 0, 0.98, -0.64, 'key-rack');
  block(still, kit, m.brass, 0.8, 0.03, 0.05, 0, 0.77, -0.64, 'key-rack');
  for (let key = 0; key < 8; key += 1) {
    const x = -0.3 + (key % 4) * 0.2;
    const y = key < 4 ? 0.93 : 0.72;
    if (key === 5) continue;
    block(still, kit, m.brass, 0.03, 0.07, 0.02, x, y, -0.625, 'key-rack');
    block(still, kit, key % 2 ? m.aisle : m.accent, 0.05, 0.06, 0.015, x, y - 0.07, -0.625);
  }
  // The counter.
  block(still, kit, m.wood, 1.16, 0.58, 0.42, 0, 0.31, 0.14, 'counter');
  for (const x of [-0.38, 0, 0.38]) block(still, kit, kit.mat(mix(kit, 'wood', 'ink', 0.25), { rough: 0.8, flat: true }), 0.3, 0.36, 0.02, x, 0.32, 0.36);
  block(still, kit, m.brass, 1.18, 0.05, 0.44, 0, 0.04, 0.14);
  block(still, kit, m.brass, 1.24, 0.05, 0.5, 0, 0.625, 0.14, 'counter');
  // The bell: a base, its dome and the button.
  block(still, kit, m.brass, 0.12, 0.02, 0.12, 0.34, 0.66, 0.2, 'bell');
  post(still, kit, m.brass, 0.055, 0.06, 0.34, 0.7, 0.2, 'bell');
  block(still, kit, m.brass, 0.07, 0.02, 0.07, 0.34, 0.74, 0.2, 'bell');
  block(still, kit, m.ink, 0.02, 0.03, 0.02, 0.34, 0.76, 0.2, 'bell');
  // The ledger, open, with a ribbon and a pen beside it.
  const ledger = pivot(still, -0.02, 0.66, 0.18);
  ledger.rotation.y = 0.18;
  block(ledger, kit, m.leather, 0.34, 0.02, 0.24, 0, 0, 0, 'ledger');
  for (const side of [-1, 1]) {
    const page = block(ledger, kit, m.paper, 0.15, 0.02, 0.21, side * 0.08, 0.015, 0, 'ledger');
    page.rotation.z = side * -0.06;
  }
  block(ledger, kit, m.aisle, 0.015, 0.025, 0.12, 0.02, 0.02, 0.08);
  block(ledger, kit, m.ink, 0.02, 0.02, 0.18, 0.21, 0.01, 0.02, 'ledger');
  // The banker's lamp's base and stalk; its shade is the state light.
  block(still, kit, m.brass, 0.14, 0.03, 0.1, -0.42, 0.665, 0.1);
  const stool = new Group();
  stool.position.set(0, 0, -0.32);
  const seat = new Group();
  post(seat, kit, m.brass, 0.035, 0.36, 0, 0.2, 0);
  block(seat, kit, m.brass, 0.3, 0.03, 0.04, 0, 0.04, 0);
  block(seat, kit, m.brass, 0.04, 0.03, 0.3, 0, 0.04, 0);
  block(seat, kit, m.blanket, 0.36, 0.08, 0.34, 0, 0.42, 0);
  block(seat, kit, m.blanket, 0.34, 0.26, 0.06, 0, 0.58, -0.17);
  stool.add(bake(seat));
  const concierge = figure(kit, look);
  concierge.root.position.set(0, 0.2, 0.02);
  stool.add(concierge.root);
  // Reduce animations: the engine swings what it is given, so give it nothing.
  const swing = kit.reducedMotion ? [] : [[stool, 'y', 0.35, 1.4]];
  return { person: concierge, stool, lampAt: [-0.42, 0.86, 0.1], stalk: 0.2, swing, spin: [], puff: new Vector3(0.34, 0.85, 0.2), labelY: 1.7 };
}

function station(kit, kind, spot = {}) {
  const group = new Group();
  const still = new Group();
  const m = mats(kit);
  const right = spot.side > 0;
  const index = spot.index || 0;
  const look = GUESTS[index % GUESTS.length];
  const number = 101 + index + (kind === 'worker' ? 0 : 100);
  const fitted = kind === 'worker'
    ? room(kit, still, right ? -1 : 1, right, look, number)
    : desk(kit, still, look);
  const [x, y, z] = fitted.lampAt;
  block(still, kit, m.trim, 0.025, fitted.stalk, 0.025, x, y - 0.06 - fitted.stalk / 2, z);
  const lamp = kit.box(0.15, 0.12, 0.15, kit.lamp(), [x, y, z]);
  lamp.name = 'lamp';
  group.add(kit.shadows(bake(still)), lamp);
  if (fitted.stool) group.add(kit.shadows(fitted.stool));
  else group.add(kit.shadows(fitted.person.root));
  const person = fitted.person;
  const phase = (spot.slot ?? index) * 1.9 + (kind === 'worker' ? 0 : 0.8);
  idle(person, 0, phase);
  group.userData = {
    lamp,
    roomNumber: kind === 'worker' ? number : null,
    figures: [person],
    occupants: [person.root],
    spin: fitted.spin,
    swing: fitted.swing,
    puff: fitted.puff,
    labelY: fitted.labelY,
    frame(time, dt, record) {
      const t = kit.reducedMotion ? 0 : time;
      idle(person, t, phase, !kit.reducedMotion && record?.state === 'running');
    },
  };
  return group;
}

// The luggage stand beside the door, where delivered suitcases are stood: a
// square of carpet inside a brass rail. HALL is at z -5 on the floor.
function dock(kit) {
  const group = new Group();
  const m = mats(kit);
  group.position.set(3.5, 0, -3.58);
  group.add(kit.shadow(2.35, 1.75, 0.3, [0, 0.004, 0]));
  const still = new Group();
  block(still, kit, m.aisle, 1.94, 0.06, 1.34, 0, 0.03, 0, 'luggage-stand');
  block(still, kit, m.brass, 2.0, 0.02, 1.4, 0, 0.01, 0);
  for (const [x, z] of [[-0.94, -0.64], [0.94, -0.64], [-0.94, 0.64], [0.94, 0.64]]) {
    block(still, kit, m.brass, 0.06, 0.4, 0.06, x, 0.2, z);
    block(still, kit, m.brass, 0.1, 0.08, 0.1, x, 0.42, z);
  }
  block(still, kit, m.brass, 1.88, 0.03, 0.03, 0, 0.34, -0.64);
  for (const x of [-0.94, 0.94]) block(still, kit, m.brass, 0.03, 0.03, 1.28, x, 0.34, 0);
  group.add(kit.shadows(bake(still)));
  return group;
}

// A finished job is a suitcase: leather with two brass straps, brass corners
// and a handle.
function crate(kit) {
  const group = new Group();
  const m = mats(kit);
  const parts = new Group();
  block(parts, kit, m.crate, 0.46, 0.32, 0.18, 0, 0, 0, 'suitcase');
  for (const x of [-0.13, 0.13]) block(parts, kit, m.tape, 0.05, 0.33, 0.19, x, 0, 0);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) block(parts, kit, m.brass, 0.05, 0.05, 0.19, sx * 0.21, sy * 0.14, 0);
  }
  block(parts, kit, m.ink, 0.16, 0.05, 0.04, 0, 0.185, 0);
  block(parts, kit, m.paper, 0.06, 0.08, 0.01, -0.06, 0.06, 0.095);
  group.add(kit.shadows(bake(parts)));
  return group;
}

// What carries it: a brass luggage trolley rolling up the carpet, with the
// suitcase standing on its bed under the two hoops.
function carrier(kit) {
  const object = new Group();
  const m = mats(kit);
  const frame = new Group();
  block(frame, kit, m.aisle, 0.66, 0.05, 0.44, 0, 0.15, 0);
  block(frame, kit, m.brass, 0.7, 0.03, 0.48, 0, 0.12, 0);
  for (const z of [-0.2, 0.2]) {
    for (const x of [-0.3, 0.3]) block(frame, kit, m.brass, 0.03, 0.62, 0.03, x, 0.46, z);
    block(frame, kit, m.brass, 0.62, 0.03, 0.03, 0, 0.77, z);
  }
  block(frame, kit, m.brass, 0.03, 0.03, 0.42, 0, 0.77, 0);
  object.add(bake(frame));
  const wheels = [];
  for (const [x, z] of [[-0.27, -0.19], [0.27, -0.19], [-0.27, 0.19], [0.27, 0.19]]) {
    const wheel = kit.cylinder(0.06, 0.06, 0.04, m.ink, [x, 0.06, z], 8);
    wheel.rotation.z = Math.PI / 2;
    object.add(wheel);
    wheels.push(wheel);
  }
  const hold = new Group();
  hold.position.y = 0.34;
  object.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'ground',
    pose(target, { time, speed }) {
      for (const wheel of wheels) wheel.rotation.x = time * 9 * (0.3 + speed);
      hold.rotation.z = Math.sin(time * 11) * 0.03 * speed;
    },
  };
}

// One blip of a hand-off: a key card on its way down to a room, and a coin
// for each part of a result that follows the trolley home.
function packet(kit, direction) {
  const lit = (colour, glow) => kit.mat(colour, { rough: 0.5, emissive: colour, glow: kit.mode === 'dark' ? glow : glow * 0.2 });
  if (direction === 'down') return kit.box(0.13, 0.03, 0.2, lit('linen', 0.6));
  return kit.cylinder(0.09, 0.09, 0.03, lit('worker', 1), [0, 0, 0], 8);
}

// A sun lounger facing +z: a frame on legs, a cushion with its back raised,
// and a towel folded over the end.
function lounger(still, kit, x, z, turn, towel) {
  const m = mats(kit);
  const seat = pivot(still, x, 0, z);
  seat.rotation.y = turn;
  for (const [lx, lz] of [[-0.22, -0.5], [0.22, -0.5], [-0.22, 0.5], [0.22, 0.5]]) block(seat, kit, m.linen, 0.05, 0.16, 0.05, lx, 0.08, lz);
  block(seat, kit, m.linen, 0.52, 0.05, 1.1, 0, 0.18, 0, 'lounger');
  block(seat, kit, m.blanket, 0.46, 0.06, 0.74, 0, 0.23, 0.15);
  const back = pivot(seat, 0, 0.2, -0.36);
  back.rotation.x = -0.75;
  block(back, kit, m.blanket, 0.46, 0.06, 0.4, 0, 0.03, -0.18);
  block(seat, kit, towel, 0.46, 0.07, 0.18, 0, 0.27, 0.42);
}

// A parasol: a pole and a stepped square shade in two stripes.
function parasol(still, kit, x, z) {
  const m = mats(kit);
  post(still, kit, m.linen, 0.03, 1.2, x, 0.6, z);
  block(still, kit, m.aisle, 0.9, 0.06, 0.9, x, 1.16, z, 'parasol');
  block(still, kit, m.linen, 0.64, 0.06, 0.64, x, 1.22, z);
  block(still, kit, m.aisle, 0.36, 0.06, 0.36, x, 1.28, z);
  block(still, kit, m.brass, 0.08, 0.08, 0.08, x, 1.34, z);
}

// A lamp post with a square lantern, lit warm by night.
function lampPost(still, kit, x, z) {
  const m = mats(kit);
  block(still, kit, m.trim, 0.16, 0.08, 0.16, x, 0.04, z);
  block(still, kit, m.trim, 0.06, 1.4, 0.06, x, 0.74, z, 'lamp-post');
  block(still, kit, m.brass, 0.2, 0.04, 0.2, x, 1.46, z);
  block(still, kit, m.warm, 0.14, 0.18, 0.14, x, 1.57, z);
  block(still, kit, m.trim, 0.2, 0.05, 0.2, x, 1.68, z);
}

// Beside the hotel: the pool to its left with a ladder, loungers and a
// parasol on its deck, palms around it and along the back of the floor, and
// lamp posts by the luggage stand on the right. HALL is at x 0, z -5.
function decor(kit) {
  const group = new Group();
  const still = new Group();
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const poolX = -6.4;
  const poolZ = -5.4;
  block(still, kit, m.stone, 4.6, 0.12, 3.0, poolX, 0.06, poolZ, 'pool');
  block(still, kit, m.linen, 4.1, 0.16, 2.3, poolX, 0.08, poolZ, 'pool');
  block(still, kit, m.water, 3.8, 0.17, 2.0, poolX, 0.085, poolZ, 'pool');
  // A lane of darker tile down the bottom, showing through.
  block(still, kit, kit.mat(mix(kit, 'water', 'ink', 0.3), { rough: 0.2, flat: true, emissive: 'water', glow: dark ? 0.25 : 0 }), 3.2, 0.172, 0.12, poolX, 0.086, poolZ);
  for (const side of [-1, 1]) {
    block(still, kit, m.brass, 0.04, 0.42, 0.04, poolX + 1.6 + side * 0.14, 0.32, poolZ - 1.05);
  }
  block(still, kit, m.brass, 0.32, 0.04, 0.04, poolX + 1.6, 0.48, poolZ - 1.05);
  // The diving board at the far end.
  block(still, kit, m.stone, 0.3, 0.26, 0.3, poolX - 2.2, 0.13, poolZ);
  block(still, kit, m.linen, 0.9, 0.05, 0.28, poolX - 1.8, 0.28, poolZ, 'diving-board');
  lounger(still, kit, poolX - 1.3, poolZ - 2.1, 0, m.aisle);
  lounger(still, kit, poolX - 0.1, poolZ - 2.1, 0, m.worker);
  lounger(still, kit, poolX + 1.4, poolZ - 2.1, 0, m.accent);
  parasol(still, kit, poolX + 0.65, poolZ - 2.3);
  palm(still, kit, poolX - 2.9, poolZ - 1.6, 1.5, 3);
  palm(still, kit, poolX + 2.7, poolZ - 2.4, 1.2, 5);
  palm(still, kit, poolX - 3.0, poolZ + 1.6, 1.1, 7);
  // Behind and to the right of the hotel.
  palm(still, kit, 5.2, -6.6, 1.6, 2);
  palm(still, kit, 8.2, -5.8, 1.3, 4);
  lampPost(still, kit, 5.1, -4.6);
  lampPost(still, kit, 2.9, -2.6);
  lampPost(still, kit, -2.9, -2.6);
  // The corners of the lobby floor.
  for (const [x, z, height, seed] of [[-10.6, -6.4, 1.5, 1], [10.6, -6.4, 1.7, 6], [-10.6, 9.4, 1.3, 8], [10.6, 9.4, 1.5, 9]]) {
    palm(still, kit, x, z, height, seed);
  }
  group.add(kit.shadows(bake(still)));
  if (dark) {
    group.add(kit.halo('water', 5.0, 3.2, { opacity: 0.22, at: [poolX, 0.18, poolZ] }));
    for (const [x, z] of [[5.1, -4.6], [2.9, -2.6], [-2.9, -2.6]]) group.add(kit.halo('#ffb060', 1.8, 1.8, { opacity: 0.18, at: [x, 0.02, z] }));
  }
  return group;
}

// The advisor: the hotel's manager, grey at the temples in a tailcoat and
// reading glasses, standing at a brass-railed lectern over the great guest
// register, a standard lamp and a potted palm beside it on its own rug. It
// stands to the hotel's right, since the pool takes the spot to its left.
// Pages from the hotel land in the register; while the manager reads, they
// bow over it, run a finger down the page and turn a leaf now and then.
const MANAGER = { hair: '#8e929e', skin: '#e6b994', shirt: '#1d2436', legs: '#1d2436', shoes: '#0c0c12', style: 'quiff' };

function advisor(kit) {
  const m = mats(kit);
  const root = new Group();
  const still = new Group();
  root.add(kit.shadow(1.6, 1.4, 0.26));
  block(still, kit, m.aisle, 1.5, 0.03, 1.4, 0, 0.015, 0, 'rug');
  block(still, kit, m.brass, 1.36, 0.034, 1.26, 0, 0.017, 0, 'rug');
  block(still, kit, m.aisle, 1.3, 0.036, 1.2, 0, 0.018, 0, 'rug');
  // The lectern: a plinth, a fluted column banded in brass, a sloped top.
  block(still, kit, m.wood, 0.5, 0.06, 0.4, 0, 0.05, 0.4);
  block(still, kit, m.wood, 0.32, 0.74, 0.26, 0, 0.45, 0.4, 'lectern');
  for (const x of [-0.08, 0, 0.08]) block(still, kit, kit.mat(mix(kit, 'wood', 'ink', 0.3), { rough: 0.8, flat: true }), 0.03, 0.6, 0.01, x, 0.45, 0.535);
  for (const y of [0.12, 0.8]) block(still, kit, m.brass, 0.36, 0.03, 0.3, 0, y, 0.4);
  // The standard lamp, and a palm in its pot.
  post(still, kit, m.brass, 0.1, 0.04, -0.55, 0.04, 0.35);
  post(still, kit, m.brass, 0.018, 1.5, -0.55, 0.77, 0.35);
  post(still, kit, m.linen, 0.16, 0.2, -0.55, 1.58, 0.35, 'lamp');
  palm(still, kit, -0.45, -0.5, 1.25, 11);
  root.add(bake(still));
  const glow = new Mesh(memo(kit, 'shape:post', SHAPES.post), m.warm);
  glow.position.set(-0.55, 1.47, 0.35);
  glow.scale.set(0.1, 0.03, 0.1);
  root.add(glow);
  const desk = pivot(root, 0, 0.84, 0.4);
  desk.rotation.x = 0.35;
  block(desk, kit, m.wood, 0.56, 0.05, 0.4, 0, 0, 0);
  block(desk, kit, m.brass, 0.58, 0.04, 0.03, 0, 0.03, 0.2);
  // The register, open, with its ribbon, and the leaf that turns.
  block(desk, kit, m.leather, 0.48, 0.03, 0.32, 0, 0.04, 0, 'register');
  for (const side of [-1, 1]) block(desk, kit, m.paper, 0.22, 0.025, 0.29, side * 0.115, 0.06, 0, 'register');
  for (const z of [-0.08, -0.03, 0.02, 0.07]) block(desk, kit, m.ink, 0.16, 0.003, 0.008, -0.115, 0.074, z);
  block(desk, kit, m.aisle, 0.02, 0.02, 0.16, 0.01, 0.07, 0.1);
  const leaf = pivot(desk, 0, 0.075, 0);
  block(leaf, kit, m.paper, 0.21, 0.008, 0.28, 0.105, 0, 0);
  // The manager, a head taller than the staff.
  const manager = figure(kit, MANAGER);
  manager.root.scale.setScalar(1.75);
  manager.root.position.set(0, 0.03, -0.12);
  root.add(manager.root);
  const { body, head, arms } = manager;
  const coat = kit.mat(MANAGER.shirt, { rough: 0.8, flat: true });
  block(body, kit, m.linen, 0.1, 0.2, 0.02, 0, 0.13, 0.082);
  block(body, kit, m.ink, 0.09, 0.03, 0.025, 0, 0.225, 0.09);
  for (const side of [-1, 1]) block(body, kit, coat, 0.1, 0.18, 0.03, side * 0.07, -0.06, -0.08);
  block(body, kit, m.brass, 0.03, 0.05, 0.01, -0.1, 0.17, 0.083);
  for (const side of [-1, 1]) block(head, kit, m.brass, 0.07, 0.05, 0.01, side * 0.062, 0.13, 0.13);
  block(head, kit, m.brass, 0.06, 0.01, 0.01, 0, 0.14, 0.13);
  block(head, kit, kit.mat(MANAGER.hair, { rough: 0.85, flat: true }), 0.12, 0.02, 0.012, 0, 0.075, 0.124);
  kit.shadows(root);
  root.scale.setScalar(1.2);
  root.userData = {
    labelY: 2.45,
    page: new Vector3(0, 1.13, 0.5),
    frame(time, dt, state) {
      const reading = state.activity;
      body.rotation.x = 0.14 * reading;
      body.rotation.z = Math.sin(time * 0.9) * 0.02;
      head.rotation.x = 0.36 * reading + Math.sin(time * 0.6) * 0.03;
      head.rotation.y = Math.sin(time * 0.5) * 0.16 * reading;
      // A finger runs down the page, and every few seconds a leaf turns.
      const turn = clamp01(((time * 0.3) % 1 - 0.74) / 0.26) * reading;
      leaf.rotation.z = Math.PI * ease(turn);
      arms[0].rotation.x = -1.0 * reading - 0.1 + Math.sin(time * 1.6) * 0.06 * reading;
      arms[0].rotation.z = -0.25 * reading;
      arms[1].rotation.x = -1.05 * reading - Math.sin(turn * Math.PI) * 0.35;
      arms[1].rotation.z = 0.2 * reading;
    },
  };
  return root;
}

export default { palette: PALETTE, backdrop, layout, view, pad: false, ghost, floor, hall, station, crate, carrier, packet, dock, decor, advisor };
