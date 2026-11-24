// Upside Down's Factory floor: a street at the edge of town. The main agent is the
// house at the end of the road, a string of lights along its porch and a
// radio mast beside it. Orchestrate workers are the places the kids hang out
// (a cabin, the A.V. club's radio shack, the arcade, a school bus fitted out
// as a lookout) and subagents are what they put up themselves (a stick fort,
// a campsite, a phone box, a walkie-talkie post). Instructions go out as radio
// waves and finished jobs come back as a cardboard box on the back of a bike.
// By day it is autumn in Indiana; by night it is the same street in the
// Upside Down: the trees bare, vines over everything, spores in the air and
// the gate open in the woods behind the house. A station whose agent fails is
// taken by the vines in either. Every string of lights is the same four
// bulbs, so they falter together and surge when the house hears from someone.
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Mesh,
  MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry, TorusGeometry, Vector3,
} from 'three';

const PALETTE = {
  light: {
    ground: '#7f8c4c', horizon: '#f1d9a8', zenith: '#bcd3de',
    line: '#4a3a24', aisle: '#57575b', body: '#eadfc4', trim: '#f6efdc', roof: '#7a2f2a',
    accent: '#23587f', worker: '#b8470b', busy: '#d99a14', ok: '#2f6b3c', fail: '#b3202a', idle: '#9a8d72',
    crate: '#c9a36a', tape: '#b3202a', smoke: '#8c8272', glow: '#ffc857', window: '#ffd98a', door: '#2b1d14',
    sky: '#dfeaf0', sun: '#fff1d6',
    grassDark: '#66773c', grassLight: '#9aa25a', asphaltDark: '#434348', kerb: '#b9b3a2', dirt: '#8f7f56',
    roofTin: '#5d6b5a', wood: '#7a5636', bark: '#4a3524', tarp: '#5f7a4e', canvas: '#c8b98a', brick: '#8a4a3a',
    mortar: '#c9b8a2', roadLine: '#e8c44a', concrete: '#b5b0a3',
    leafA: '#c8641e', leafB: '#d99a14', leafC: '#a8321e', pine: '#3d5a34', spore: '#d99a14',
    steel: '#8d949a', rust: '#8a4a2a', tyre: '#26221f', glass: '#4f6d7c', chrome: '#d8dcdc', car: '#b08a4a', bus: '#e2a61c',
    denim: '#3d5a80', skinA: '#e9bd95', skinB: '#a06c48', hairA: '#4a2f1c', hairB: '#b8752a', hairC: '#1d1712',
    shirtA: '#b3202a', shirtB: '#2f6b3c', shirtC: '#d99a14', shirtD: '#23587f',
    paper: '#f3e9cf', pumpkin: '#e07a1c', hay: '#d9b95a',
    vine: '#2a1a22', ember: '#ff5a3c', flame: '#ffa23a', sodium: '#d9d4c4', neon: '#ff3d8b', screen: '#6fe0ff',
    sunIntensity: 2.4, skyIntensity: 1.35, envIntensity: 0.5, exposure: 1.02, fogNear: 9, fogSpan: 26,
  },
  dark: {
    ground: '#15202e', horizon: '#141d31', zenith: '#04060c',
    line: '#3a4a66', aisle: '#232d3f', body: '#6c7fa6', trim: '#93a8cc', roof: '#8c2a3d',
    accent: '#6fc3e0', worker: '#ff2d3f', busy: '#ffc857', ok: '#7be0a0', fail: '#ff6b6b', idle: '#55627c',
    crate: '#d9c9a8', tape: '#ff2d3f', smoke: '#7b88a3', glow: '#ff2d3f', window: '#ffc857', door: '#05080f',
    sky: '#6485bd', sun: '#b8c8ee',
    grassDark: '#0e1722', grassLight: '#1c2a3b', asphaltDark: '#141b27', kerb: '#4a5874', dirt: '#222d40',
    roofTin: '#3d5876', wood: '#58698d', bark: '#0a0e16', tarp: '#41708a', canvas: '#7687ab', brick: '#74455c',
    mortar: '#8a7690', roadLine: '#9a8a4c', concrete: '#55627e',
    leafA: '#0b0f18', leafB: '#0b0f18', leafC: '#0b0f18', pine: '#0c141e', spore: '#cfdcf5',
    steel: '#8292ae', rust: '#84444a', tyre: '#07090e', glass: '#1c2a40', chrome: '#a3b1c9', car: '#6c6d86', bus: '#b89c40',
    denim: '#2c3d60', skinA: '#c9a48a', skinB: '#8a6048', hairA: '#2a1c14', hairB: '#8a5a26', hairC: '#0e0b09',
    shirtA: '#c8303c', shirtB: '#3f8a5a', shirtC: '#d9a83a', shirtD: '#4a8ab8',
    paper: '#d9d2c0', pumpkin: '#3b2d36', hay: '#3d4150',
    vine: '#140b16', ember: '#ff2d3f', flame: '#ffb04a', sodium: '#ffb35a', neon: '#ff3d8b', screen: '#6fe0ff',
    sunIntensity: 2.1, skyIntensity: 1.7, envIntensity: 0.75, exposure: 1.16, fogNear: 8, fogSpan: 22,
  },
};

const BACKDROP = {
  light: 'radial-gradient(ellipse 64% 40% at 30% 16%, #fff3d4 0%, transparent 70%), '
    + 'linear-gradient(180deg, #bcd3de 0%, #dfe2cc 30%, #f1d9a8 52%, #7f8c4c 100%)',
  dark: 'radial-gradient(ellipse 46% 34% at 66% 22%, rgba(255,45,63,0.34) 0%, rgba(255,45,63,0.08) 55%, transparent 76%), '
    + 'linear-gradient(180deg, #04060c 0%, #0a101c 30%, #141d31 54%, #111b28 100%)',
};

// A small town is not laid out on a grid, and its fronts half face the road.
const layout = { jitter: 0.16, turn: 0.56 };
const view = { elevation: 0.5 };

// The engine's rows (ui/yeet/factory-layout.js): the first at z -0.6 and one
// every 2.9 after it. A carrier comes down the gap on the hall side of its row,
// so what stands on the verge keeps to the far side of a row.
const ROW_Z = [-0.6, 2.3, 5.2, 8.1];
const ROAD = { from: -3.12, to: 30, half: 0.92 };
const VERGE = 1.3;

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const BULBS = ['#ff3b4a', '#ffc857', '#4fd08a', '#5aa9ff'];
const SHIRTS = ['shirtA', 'shirtB', 'shirtC', 'shirtD'];
const HAIR = ['hairA', 'hairB', 'hairC'];
const LEAVES = ['leafA', 'leafB', 'leafC'];
const SURGE_SECONDS = 0.9;
const FLAG_SECONDS = 3;
const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = x => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const hex = colour => '#' + colour.getHexString();

// The engine frees whatever is in the kit's material map with the scene, so
// the painted sheets and the materials the frame drives live there, one of
// each per look.
function shared(kit, key, make) {
  if (!kit.materials.has(key)) kit.materials.set(key, make());
  return kit.materials.get(key);
}

// What one floor's frame needs to find again: when its lights last surged,
// the mailbox flag, and the glows that breathe.
const towns = new WeakMap();
function town(kit) {
  if (!towns.has(kit)) towns.set(kit, { clock: 0, surgeAt: -Infinity, flagAt: -Infinity, flag: null, flagUp: 0, glows: [], shapes: new Map() });
  return towns.get(kit);
}

// Unit shapes every part shares; a mesh sizes its own with scale. The engine
// disposes a retired station's geometry, and three uploads a shared one again
// on its next draw.
const SHAPES = {
  box: () => new BoxGeometry(1, 1, 1),
  ball: () => new SphereGeometry(1, 10, 7),
  bead: () => new SphereGeometry(1, 6, 4),
  dome: () => new SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI / 2),
  rod: () => new CylinderGeometry(1, 1, 1, 6),
  drum: () => new CylinderGeometry(1, 1, 1, 14),
  taper: () => new CylinderGeometry(0.5, 1, 1, 7),
  cone: () => new ConeGeometry(1, 1, 7),
  rock: () => new IcosahedronGeometry(1, 0),
  blob: () => new IcosahedronGeometry(1, 1),
  ring: () => new TorusGeometry(1, 0.12, 5, 16),
  arc: () => new TorusGeometry(1, 0.16, 4, 10, Math.PI),
  wheel: () => new TorusGeometry(1, 0.16, 6, 14).rotateY(Math.PI / 2),
  plane: () => new PlaneGeometry(1, 1),
};
function shape(kit, name) {
  const { shapes } = town(kit);
  if (!shapes.has(name)) shapes.set(name, SHAPES[name]());
  return shapes.get(name);
}

function part(parent, kit, name, material, at = [0, 0, 0], size = 1, turn = null) {
  const mesh = new Mesh(shape(kit, name), material);
  mesh.position.set(at[0], at[1], at[2]);
  if (typeof size === 'number') mesh.scale.setScalar(size);
  else mesh.scale.set(size[0], size[1], size[2]);
  if (turn) mesh.rotation.set(turn[0], turn[1], turn[2]);
  parent.add(mesh);
  return mesh;
}

// A rod from point a to point b.
const span = new Vector3();
function rod(parent, kit, material, a, b, radius, name = 'rod') {
  const mesh = new Mesh(shape(kit, name), material);
  span.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = span.length();
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  mesh.quaternion.setFromUnitVectors(UP, span.normalize());
  mesh.scale.set(radius, length, radius);
  parent.add(mesh);
  return mesh;
}

// ---------- shared materials ----------

function bulbMaterial(kit, turn) {
  const colour = BULBS[turn % BULBS.length];
  return shared(kit, 'upside-down-bulb:' + turn % BULBS.length, () => new MeshStandardMaterial({
    color: kit.color(colour), emissive: kit.color(colour), emissiveIntensity: 1, roughness: 0.35,
  }));
}

// What glows red in the Upside Down, pulsing as one.
function emberMaterial(kit) {
  return shared(kit, 'upside-down-ember', () => new MeshStandardMaterial({
    color: kit.color('ember'), emissive: kit.color('ember'), emissiveIntensity: 1.2, roughness: 0.4,
  }));
}

// A window with someone home.
function litMaterial(kit) {
  return kit.mat('window', { rough: 0.3, emissive: 'window', glow: kit.mode === 'dark' ? 1.1 : 0.35 });
}

function planks(kit, key, tone, rows, gap) {
  return shared(kit, 'upside-down-' + key, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.palette[tone]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(kit.blend(kit.palette[tone], kit.palette.door, 0.38));
    for (let y = 0; y < h; y += h / rows) ctx.fillRect(0, y, w, gap);
    ctx.fillStyle = hex(kit.blend(kit.palette[tone], kit.palette.trim, 0.12));
    for (let y = gap; y < h; y += h / rows) ctx.fillRect(0, y, w, 1);
  }, { width: 64, height: 128, rough: 0.93, metal: 0 }));
}
const siding = kit => planks(kit, 'siding', 'body', 9, 2);
const logs = kit => planks(kit, 'logs', 'wood', 5, 4);

function bricks(kit) {
  return shared(kit, 'upside-down-brick', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.palette.mortar);
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const tall = h / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = -1; col < 4; col++) {
        const tone = kit.blend(kit.palette.brick, kit.palette.door, seeded(row * 7 + col) * 0.3);
        ctx.fillStyle = hex(tone);
        ctx.fillRect((col + (row % 2) * 0.5) * (w / 4) + 1, row * tall + 1, w / 4 - 2, tall - 2);
      }
    }
  }, { width: 64, height: 64, rough: 0.95, metal: 0 }));
}

// Rows of shingles running along the ridge: on a roof slope's sheet that is
// across u, so `rows` of them run down the slope and `tabs` along it.
function shingles(kit, tone, rows, tabs) {
  return shared(kit, ['upside-down-shingle', tone, rows, tabs].join(':'), () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.palette[tone]);
    ctx.fillRect(0, 0, w, h);
    const wide = w / 4;
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = hex(kit.blend(kit.palette[tone], kit.palette.door, 0.5));
      ctx.fillRect(row * wide, 0, 2, h);
      ctx.fillStyle = hex(kit.blend(kit.palette[tone], kit.palette.door, 0.28));
      for (let tab = 0; tab < 4; tab++) ctx.fillRect(row * wide, (tab + (row % 2) * 0.5) * (h / 4), wide, 1.5);
      ctx.fillStyle = hex(kit.blend(kit.palette[tone], kit.palette.trim, 0.1));
      ctx.fillRect(row * wide + 2, 0, 2, h);
    }
  }, { width: 64, height: 64, repeat: [rows / 4, tabs / 4], rough: 0.9, metal: 0 }));
}

// Hand lettering on a board. With `glow` the letters are lit from behind.
function lettering(kit, key, text, { ink, board, glow = 0, width = 256, height = 64, face = 'Georgia, serif' }) {
  return shared(kit, 'upside-down-sign:' + key, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.color(board));
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(kit.color(ink));
    const rows = text.split('\n');
    ctx.font = 'bold ' + Math.round(h / rows.length * 0.74) + 'px ' + face;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => ctx.fillText(row, w / 2, h * (i + 0.5) / rows.length + 1, w * 0.9));
  }, { width, height, rough: 0.8, metal: 0, emissive: glow > 0, glow }));
}

// ---------- shared parts ----------

// A string of lights between two points, sagging a little: a wire in two
// lengths and a bulb hanging every so often.
function lightString(kit, parent, from, to, count, sag = 0.12) {
  const wire = kit.mat('door', { rough: 0.9 });
  const at = along => [
    from[0] + (to[0] - from[0]) * along,
    from[1] + (to[1] - from[1]) * along - Math.sin(along * Math.PI) * sag,
    from[2] + (to[2] - from[2]) * along,
  ];
  rod(parent, kit, wire, from, at(0.5), 0.007);
  rod(parent, kit, wire, at(0.5), to, 0.007);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = at((i + 0.5) / count);
    part(parent, kit, 'bead', bulbMaterial(kit, i), [x, y - 0.045, z], [0.045, 0.068, 0.045]);
  }
}

// A roof whose ridge runs along x, so its eave faces the road.
function eaveRoof(kit, width, depth, rise, wall, cover) {
  const roof = kit.gable(depth, width, rise, cover, { bodyMat: wall, overhang: 0.14, thickness: 0.07 });
  roof.rotation.y = Math.PI / 2;
  return roof;
}

// A vine through the points given, thinning towards its end, with a pustule
// glowing at some of its joints.
function vine(kit, parent, points, radius, seed = 0) {
  const flesh = kit.mat('vine', { rough: 0.7 });
  for (let i = 1; i < points.length; i++) {
    const thick = radius * (1 - 0.6 * (i - 1) / (points.length - 1));
    rod(parent, kit, flesh, points[i - 1], points[i], thick);
    part(parent, kit, 'bead', flesh, points[i], thick * 1.15);
    if ((i + seed) % 2 === 0) part(parent, kit, 'bead', emberMaterial(kit), [points[i][0], points[i][1] + thick * 0.6, points[i][2]], thick * 0.75);
  }
}

// A kid, facing +z: `look` picks the shirt, hair and whether there is a cap.
// The arms hang from the shoulders and the head turns on the neck.
function kid(kit, parent, at, look = 0, { sit = false, turn = 0 } = {}) {
  const group = new Group();
  group.position.set(at[0], at[1], at[2]);
  group.rotation.y = turn;
  const shirt = kit.mat(SHIRTS[look % SHIRTS.length], { rough: 0.9 });
  const jeans = kit.mat('denim', { rough: 0.9 });
  const skin = kit.mat(look % 3 === 1 ? 'skinB' : 'skinA', { rough: 0.8 });
  const hip = sit ? 0.12 : 0.26;
  for (const side of [-1, 1]) {
    if (sit) part(group, kit, 'box', jeans, [side * 0.055, hip, 0.12], [0.075, 0.075, 0.27]);
    else part(group, kit, 'box', jeans, [side * 0.055, hip / 2, 0], [0.075, hip, 0.085]);
  }
  part(group, kit, 'box', shirt, [0, hip + 0.13, 0], [0.2, 0.26, 0.13]);
  const arms = [-1, 1].map(side => {
    const arm = new Group();
    arm.position.set(side * 0.13, hip + 0.23, 0);
    part(arm, kit, 'box', shirt, [0, -0.1, 0], [0.055, 0.22, 0.06]);
    part(arm, kit, 'bead', skin, [0, -0.22, 0], 0.036);
    group.add(arm);
    return arm;
  });
  const head = new Group();
  head.position.set(0, hip + 0.35, 0);
  part(head, kit, 'ball', skin, [0, 0, 0], 0.085);
  part(head, kit, 'dome', kit.mat(HAIR[look % HAIR.length], { rough: 0.95 }), [0, 0.008, -0.01], 0.094);
  if (look % 2 === 0) {
    const cap = kit.mat(look % 4 ? 'worker' : 'accent', { rough: 0.8 });
    part(head, kit, 'dome', cap, [0, 0.02, 0], 0.098);
    part(head, kit, 'box', cap, [0, 0.03, 0.1], [0.12, 0.018, 0.1]);
  }
  group.add(head);
  parent.add(group);
  return { group, arms, head, top: hip + 0.45 };
}

// A bike facing +z, the way the engine sends a carrier.
function bike(kit, tone) {
  const object = new Group();
  const frame = kit.mat(tone, { rough: 0.4, metal: 0.4 });
  const steel = kit.mat('steel', { rough: 0.4, metal: 0.6 });
  const tyre = kit.mat('tyre', { rough: 0.9 });
  const wheels = [0.36, -0.36].map(z => {
    const wheel = part(object, kit, 'wheel', tyre, [0, 0.22, z], 0.19);
    part(wheel, kit, 'box', steel, [0, 0, 0], [0.08, 1.8, 0.08]);
    part(wheel, kit, 'box', steel, [0, 0, 0], [0.08, 0.08, 1.8]);
    return wheel;
  });
  rod(object, kit, frame, [0, 0.22, -0.36], [0, 0.58, -0.14], 0.018);
  rod(object, kit, frame, [0, 0.22, -0.36], [0, 0.3, 0], 0.016);
  rod(object, kit, frame, [0, 0.52, -0.17], [0, 0.56, 0.24], 0.018);
  rod(object, kit, frame, [0, 0.3, 0], [0, 0.56, 0.24], 0.018);
  rod(object, kit, steel, [0, 0.22, 0.36], [0, 0.66, 0.23], 0.015);
  part(object, kit, 'box', tyre, [0, 0.6, -0.14], [0.11, 0.035, 0.2]);
  part(object, kit, 'box', steel, [0, 0.66, 0.23], [0.36, 0.028, 0.028]);
  return { object, wheels };
}

// ---------- the street ----------

// Draws at a point and at its eight neighbours a tile away, so nothing is cut
// off where two tiles meet.
function tiled(w, h, x, y, draw) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) draw(x + dx, y + dy);
}

function lawn(kit) {
  const { palette } = kit;
  const dark = kit.mode === 'dark';
  return kit.ground({
    draw(ctx, w, h) {
      ctx.fillStyle = hex(palette.ground);
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = hex(kit.blend(palette.ground, i % 2 ? palette.grassDark : palette.grassLight, 0.14 + seeded(i) * 0.26));
        const size = 16 + seeded(i + 200) * 34;
        tiled(w, h, seeded(i + 40) * w, seeded(i + 90) * h, (x, y) => {
          ctx.beginPath();
          ctx.ellipse(x, y, size, size * 0.6, seeded(i) * 3, 0, TAU);
          ctx.fill();
        });
      }
      if (dark) {
        ctx.strokeStyle = hex(palette.vine);
        ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          let x = seeded(i + 300) * w;
          let y = seeded(i + 330) * h;
          let heading = seeded(i + 360) * TAU;
          for (let step = 0; step < 9; step++) {
            const nx = x + Math.cos(heading) * 26;
            const ny = y + Math.sin(heading) * 26;
            ctx.lineWidth = 4.5 - step * 0.4;
            tiled(w, h, 0, 0, (ox, oy) => {
              ctx.beginPath();
              ctx.moveTo(x + ox, y + oy);
              ctx.lineTo(nx + ox, ny + oy);
              ctx.stroke();
            });
            x = nx;
            y = ny;
            heading += (seeded(i * 11 + step) - 0.5) * 1.5;
          }
        }
      }
      for (let i = 0; i < 300; i++) {
        const tone = dark ? palette.spore : palette[LEAVES[i % 3]];
        ctx.fillStyle = hex(tone);
        ctx.globalAlpha = dark ? 0.1 + seeded(i + 700) * 0.14 : 0.55 + seeded(i + 700) * 0.4;
        const size = dark ? 1.4 + seeded(i + 500) * 1.6 : 2.4 + seeded(i + 500) * 2.2;
        tiled(w, h, seeded(i + 410) * w, seeded(i + 460) * h, (x, y) => {
          ctx.beginPath();
          ctx.ellipse(x, y, size, size * 0.55, seeded(i + 600) * 3, 0, TAU);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;
    },
    repeat: [13, 13],
  });
}

function asphalt(kit) {
  const { palette } = kit;
  const long = ROAD.to - ROAD.from;
  return shared(kit, 'upside-down-asphalt', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(palette.aisle);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      ctx.fillStyle = hex(kit.blend(palette.aisle, i % 3 ? palette.asphaltDark : palette.kerb, 0.2 + seeded(i) * 0.3));
      ctx.fillRect(seeded(i + 20) * w, seeded(i + 60) * h, 2, 2);
    }
    ctx.fillStyle = hex(kit.blend(palette.aisle, palette.asphaltDark, 0.7));
    for (let i = 0; i < 3; i++) ctx.fillRect(12 + seeded(i + 5) * (w - 60), seeded(i + 9) * (h - 50), 26 + seeded(i) * 22, 22 + seeded(i + 2) * 22);
    ctx.strokeStyle = hex(palette.asphaltDark);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      let x = seeded(i + 80) * w;
      let y = seeded(i + 85) * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let step = 0; step < 5; step++) {
        x += (seeded(i * 5 + step) - 0.5) * 22;
        y += 8 + seeded(i * 7 + step) * 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { width: 128, height: 512, repeat: [1, long / 8], rough: 0.94, metal: 0 }));
}

// A telephone pole with a cross arm, and the two points its wires hang from.
function pole(kit, parent, x, z) {
  const timber = kit.mat('bark', { rough: 0.95 });
  part(parent, kit, 'rod', timber, [x, 1.5, z], [0.05, 3, 0.05]);
  part(parent, kit, 'box', timber, [x, 2.72, z], [0.74, 0.06, 0.06]);
  const china = kit.mat('trim', { rough: 0.4 });
  return [-1, 1].map(side => {
    part(parent, kit, 'bead', china, [x + side * 0.3, 2.79, z], 0.035);
    return [x + side * 0.3, 2.8, z];
  });
}

function wire(kit, parent, from, to, sag) {
  const cable = kit.mat('door', { rough: 0.9 });
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - sag, (from[2] + to[2]) / 2];
  rod(parent, kit, cable, from, mid, 0.005);
  rod(parent, kit, cable, mid, to, 0.005);
}

// A street lamp reaching over the road. By night it throws a pool of light,
// and the frame makes the lot of them falter.
function streetLamp(kit, parent, x, z) {
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const inward = -Math.sign(x);
  part(parent, kit, 'rod', steel, [x, 1.3, z], [0.035, 2.6, 0.035]);
  rod(parent, kit, steel, [x, 2.56, z], [x + inward * 0.62, 2.74, z], 0.024);
  part(parent, kit, 'box', steel, [x + inward * 0.72, 2.73, z], [0.3, 0.06, 0.13]);
  const dark = kit.mode === 'dark';
  const lens = shared(kit, 'upside-down-sodium', () => new MeshStandardMaterial({
    color: kit.color('sodium'), emissive: kit.color('sodium'), emissiveIntensity: dark ? 2 : 0, roughness: 0.4,
  }));
  part(parent, kit, 'bead', lens, [x + inward * 0.72, 2.68, z], [0.1, 0.05, 0.06]);
  if (!dark) return;
  const pool = kit.halo('sodium', 4.2, 4.2, { opacity: 0.5, at: [x + inward * 0.8, 0.036, z] });
  parent.add(pool);
  town(kit).glows.push({ material: pool.material, base: 0.5, swell: 0, lamp: true });
}

// Leaves raked into a heap, duller than the ones still on the trees.
function leafPile(kit, turn) {
  return kit.mat(kit.blend(kit.palette[LEAVES[turn % 3]], kit.palette.ground, 0.3), { rough: 0.95, flat: true });
}

function fence(kit, parent, from, to, seed) {
  const paint = kit.mat('trim', { rough: 0.85 });
  const dark = kit.mode === 'dark';
  const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const run = new Group();
  run.position.set(from[0], 0, from[1]);
  run.rotation.y = -Math.atan2(to[1] - from[1], to[0] - from[0]);
  for (const y of [0.14, 0.32]) part(run, kit, 'box', paint, [long / 2, y, 0], [long, 0.03, 0.02]);
  const count = Math.round(long / 0.2);
  for (let i = 0; i <= count; i++) {
    // The Upside Down has had some of the pickets.
    if (dark && seeded(seed + i * 3) > 0.74) continue;
    const picket = part(run, kit, 'box', paint, [i * long / count, 0.22, 0.015], [0.055, 0.44, 0.02]);
    if (dark) picket.rotation.z = (seeded(seed + i) - 0.5) * 0.5;
  }
  parent.add(run);
}

// The family estate car, wood down its sides.
function car(kit) {
  const group = new Group();
  const paint = kit.mat('car', { rough: 0.45, metal: 0.3 });
  const glass = kit.mat('glass', { rough: 0.15, metal: 0.4 });
  const chrome = kit.mat('chrome', { rough: 0.3, metal: 0.7 });
  const tyre = kit.mat('tyre', { rough: 0.9 });
  part(group, kit, 'box', paint, [0, 0.36, 0], [1, 0.3, 2.3]);
  part(group, kit, 'box', glass, [0, 0.62, -0.22], [0.9, 0.24, 1.45]);
  part(group, kit, 'box', paint, [0, 0.77, -0.22], [0.94, 0.06, 1.5]);
  for (const z of [0.5, -0.02, -0.94]) for (const side of [-1, 1]) part(group, kit, 'box', paint, [side * 0.44, 0.62, z], [0.05, 0.24, 0.06]);
  for (const side of [-1, 1]) {
    part(group, kit, 'box', kit.mat('wood', { rough: 0.8 }), [side * 0.505, 0.36, 0], [0.02, 0.15, 1.9]);
    for (const z of [0.72, -0.74]) part(group, kit, 'drum', tyre, [side * 0.46, 0.2, z], [0.2, 0.16, 0.2], [0, 0, Math.PI / 2]);
    part(group, kit, 'bead', kit.mat('paper', { rough: 0.3 }), [side * 0.34, 0.4, 1.15], 0.055);
    part(group, kit, 'box', kit.mat('fail', { rough: 0.4 }), [side * 0.36, 0.4, -1.155], [0.16, 0.06, 0.02]);
    part(group, kit, 'box', chrome, [side * 0.3, 0.82, -0.22], [0.025, 0.025, 1.2]);
  }
  for (const z of [1.17, -1.17]) part(group, kit, 'box', chrome, [0, 0.25, z], [1.04, 0.07, 0.06]);
  return group;
}

// The house's yard, which stays on the ground when the house rides a cloud:
// the fence, the mailbox whose flag goes up as a job comes home, the car, the
// bins and a bike left where it fell.
function yard(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const wood = kit.mat('wood', { rough: 0.9 });
  fence(kit, group, [-2.95, -2.66], [-1.2, -2.66], 3);
  fence(kit, group, [1.2, -2.66], [2.35, -2.66], 40);
  part(group, kit, 'box', wood, [1.24, 0.3, -2.86], [0.05, 0.6, 0.05]);
  part(group, kit, 'box', kit.mat('steel', { rough: 0.4, metal: 0.5 }), [1.24, 0.67, -2.86], [0.15, 0.15, 0.32]);
  const flag = new Group();
  flag.position.set(1.33, 0.66, -2.8);
  part(flag, kit, 'box', kit.mat('fail', { rough: 0.5 }), [0, 0.09, 0], [0.015, 0.18, 0.06]);
  flag.rotation.x = Math.PI / 2;
  group.add(flag);
  town(kit).flag = flag;
  const wagon = car(kit);
  wagon.position.set(-3.62, 0, -4.15);
  wagon.rotation.y = 0.1;
  group.add(wagon);
  const bin = kit.mat('steel', { rough: 0.6, metal: 0.4 });
  for (const [z, lean] of [[-4.5, 0], [-4.08, dark ? 1.45 : 0]]) {
    const can = part(group, kit, 'drum', bin, [-2.52, lean ? 0.15 : 0.24, z], [0.15, 0.48, 0.15], [lean, 0, 0]);
    part(can, kit, 'drum', bin, [0, 0.52, 0], [1.08, 0.06, 1.08]);
  }
  const dropped = bike(kit, 'accent').object;
  dropped.position.set(-1.85, 0.05, -3.05);
  dropped.rotation.set(0, 0.9, 1.42);
  group.add(dropped);
  if (dark) {
    vine(kit, group, [[-4.6, 0.05, -2.9], [-4.1, 0.5, -3.6], [-3.6, 0.72, -4.1], [-3.1, 0.5, -4.6]], 0.06, 1);
    vine(kit, group, [[2.5, 0.04, -2.5], [1.9, 0.12, -2.75], [1.3, 0.5, -2.8]], 0.045);
  } else {
    for (const [x, z, size] of [[-2.2, -3.2, 0.2], [2.1, -2.95, 0.16], [-4.4, -2.9, 0.22]]) {
      part(group, kit, 'blob', leafPile(kit, Math.round(size * 50)), [x, 0.03, z], [size, 0.07, size * 0.8]);
    }
  }
  return group;
}

// The ground is rough grass under fallen leaves, tiled so two towns meet
// without a seam, and the road runs from far out of town to the porch: patched
// asphalt, a dashed line down its middle, kerbs, the poles and their wires
// down one side and street lamps down the other.
function floor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  group.add(lawn(kit));
  const long = ROAD.to - ROAD.from;
  const mid = (ROAD.from + ROAD.to) / 2;
  const road = kit.box(ROAD.half * 2, 0.022, long, asphalt(kit), [0, 0.011, mid]);
  road.receiveShadow = !kit.software;
  group.add(road);
  const paint = kit.mat('roadLine', { rough: 0.8 });
  for (let z = ROAD.from + 0.5; z < ROAD.to; z += 1.1) part(group, kit, 'box', paint, [0, 0.024, z], [0.07, 0.006, 0.5]);
  const kerb = kit.mat('kerb', { rough: 0.95 });
  for (const side of [-1, 1]) {
    const edge = part(group, kit, 'box', kerb, [side * (ROAD.half + 0.05), 0.025, mid], [0.1, 0.05, long]);
    edge.receiveShadow = !kit.software;
  }
  const solid = new Group();
  solid.add(yard(kit));
  part(solid, kit, 'drum', kit.mat('asphaltDark', { rough: 0.6, metal: 0.4 }), [0.4, 0.024, 1.9], [0.2, 0.012, 0.2]);

  const hang = [2.5, 8.3, 14.1].map(z => pole(kit, solid, -VERGE, z + 0.42));
  for (let i = 1; i < hang.length; i++) for (const end of [0, 1]) wire(kit, solid, hang[i - 1][end], hang[i][end], 0.22);
  wire(kit, solid, hang[0][0], [-2.1, 1.78, -3.7], 0.3);
  part(solid, kit, 'drum', kit.mat('steel', { rough: 0.6, metal: 0.4 }), [-VERGE + 0.12, 2.3, 2.92], [0.09, 0.3, 0.09]);
  for (const z of [ROW_Z[0], ROW_Z[2], ROW_Z[3] + 5.8]) streetLamp(kit, solid, VERGE, z + 0.75);

  // Litter along the kerbs, between the gaps the bikes come down.
  for (const [row, side, along] of [[0, -1, 0.5], [0, 1, -0.5], [1, 1, 0.6], [1, -1, -0.45], [2, -1, 0.6], [3, 1, -0.4], [3, -1, 0.3]]) {
    const z = ROW_Z[row] + along;
    const x = side * (ROAD.half + 0.2);
    if (dark) {
      vine(kit, solid, [[side * 1.62, 0.03, z + 0.2], [side * 1.2, 0.07, z], [side * 0.8, 0.05, z + 0.16], [side * 0.42, 0.04, z + 0.05]], 0.04, row);
    } else {
      const size = 0.12 + seeded(row * 5 + side) * 0.06;
      part(solid, kit, 'blob', leafPile(kit, row + (side > 0 ? 1 : 0)), [x, 0.03, z], [size, 0.06, size * 1.6]);
      part(solid, kit, 'blob', leafPile(kit, row + 2), [x + side * 0.14, 0.02, z + 0.24], [size * 0.7, 0.05, size]);
    }
  }
  if (dark) {
    const seep = kit.halo('ember', 1.3, 1.3, { opacity: 0.3, at: [0.4, 0.04, 1.9] });
    group.add(seep);
    town(kit).glows.push({ material: seep.material, base: 0.3, swell: 0.3 });
    part(solid, kit, 'ring', emberMaterial(kit), [0.4, 0.03, 1.9], [0.2, 0.2, 0.08], [Math.PI / 2, 0, 0]);
  }
  group.add(kit.shadows(solid));
  return group;
}

// ---------- the house ----------

// The house at the end of the road: clapboard on a brick footing under a
// shingled roof with a dormer, a porch with the lights strung along it, a red
// door between two shuttered windows, a brick chimney and the radio mast
// beside it. The porch lamp is the beacon that blinks while the run waits on
// you.
function hall(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const st = town(kit);
  const wall = siding(kit);
  const trim = kit.mat('trim', { rough: 0.8 });
  const shade = kit.mat('door', { rough: 1 });
  const wood = kit.mat('wood', { rough: 0.9 });
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const cover = shingles(kit, 'roof', 8, 16);
  const brick = bricks(kit);
  group.add(kit.shadow(6.4, 4.6, 0.32));
  part(group, kit, 'box', brick, [0, 0.1, 0], [4.42, 0.2, 2.72]);
  part(group, kit, 'box', wall, [0, 0.95, 0], [4.3, 1.5, 2.6]);
  const roof = eaveRoof(kit, 4.3, 2.6, 0.95, wall, cover);
  roof.position.y = 1.7;
  group.add(roof);
  part(group, kit, 'box', trim, [0, 1.69, 1.43], [4.62, 0.07, 0.05]);
  part(group, kit, 'box', brick, [-1.35, 2.45, -0.5], [0.44, 1.3, 0.44]);
  part(group, kit, 'box', trim, [-1.35, 3.13, -0.5], [0.54, 0.07, 0.54]);
  part(group, kit, 'box', shade, [-1.35, 3.2, -0.5], [0.22, 0.1, 0.22]);

  part(group, kit, 'box', wall, [1.25, 2.15, 0.72], [0.7, 0.65, 0.8]);
  const dormer = kit.gable(0.82, 0.88, 0.26, shingles(kit, 'roof', 4, 4), { bodyMat: wall, overhang: 0.07, thickness: 0.05 });
  dormer.position.set(1.25, 2.47, 0.74);
  group.add(dormer);
  part(group, kit, 'box', kit.windows, [1.25, 2.2, 1.125], [0.4, 0.34, 0.03]);
  part(group, kit, 'box', trim, [1.25, 2.2, 1.135], [0.4, 0.025, 0.03]);
  part(group, kit, 'box', trim, [1.25, 2.2, 1.135], [0.025, 0.34, 0.03]);

  part(group, kit, 'box', wood, [0, 0.05, 1.6], [2.5, 0.1, 0.6]);
  for (const side of [-1, 1]) {
    part(group, kit, 'box', trim, [side * 1.14, 0.78, 1.84], [0.07, 1.36, 0.07]);
    part(group, kit, 'box', trim, [side * 1.14, 0.5, 1.57], [0.04, 0.04, 0.5]);
    part(group, kit, 'box', trim, [side * 1.14, 0.3, 1.57], [0.03, 0.4, 0.03]);
  }
  part(group, kit, 'box', kit.mat(kit.blend(kit.palette.roof, kit.palette.door, 0.2), { rough: 0.9 }), [0, 1.56, 1.63], [2.62, 0.05, 0.74], [0.22, 0, 0]);
  part(group, kit, 'box', trim, [0, 0.78, 1.31], [0.98, 1.36, 0.06]);
  part(group, kit, 'box', shade, [0, 0.74, 1.335], [0.82, 1.24, 0.05]);
  const door = kit.box(0.8, 1.22, 0.05, kit.mat('roof', { rough: 0.6 }), [0, 0, 0]);
  door.geometry.translate(0, -0.61, 0);
  door.position.set(0, 1.35, 1.37);
  part(door, kit, 'box', kit.windows, [0, -0.3, 0.02], [0.34, 0.24, 0.03]);
  part(door, kit, 'bead', kit.mat('busy', { rough: 0.3, metal: 0.6 }), [0.3, -0.68, 0.04], 0.035);
  group.add(door);

  const shutter = kit.mat('accent', { rough: 0.8 });
  for (const side of [-1, 1]) {
    const x = side * 1.5;
    part(group, kit, 'box', trim, [x, 1.02, 1.31], [0.86, 0.72, 0.05]);
    part(group, kit, 'box', kit.windows, [x, 1.02, 1.325], [0.74, 0.6, 0.04]);
    part(group, kit, 'box', trim, [x, 1.02, 1.335], [0.03, 0.6, 0.05]);
    part(group, kit, 'box', trim, [x, 1.02, 1.335], [0.74, 0.03, 0.05]);
    for (const edge of [-1, 1]) part(group, kit, 'box', shutter, [x + edge * 0.52, 1.02, 1.32], [0.15, 0.72, 0.03]);
    part(group, kit, 'box', wood, [x, 0.6, 1.39], [0.84, 0.12, 0.14]);
    for (let i = 0; i < 4; i++) {
      const bloom = dark ? kit.mat('vine', { rough: 0.9, flat: true }) : kit.mat(LEAVES[(i + (side > 0 ? 1 : 0)) % 3], { rough: 0.9, flat: true });
      part(group, kit, 'blob', bloom, [x - 0.3 + i * 0.2, 0.7, 1.4], [0.09, dark ? 0.04 : 0.08, 0.07]);
    }
  }
  part(group, kit, 'box', trim, [2.16, 1.0, 0.1], [0.05, 0.66, 0.8]);
  part(group, kit, 'box', kit.windows, [2.175, 1.0, 0.1], [0.03, 0.54, 0.68]);

  lightString(kit, group, [-2.22, 1.62, 1.5], [-1.16, 1.48, 1.94], 4, 0.1);
  lightString(kit, group, [-1.16, 1.48, 1.94], [1.16, 1.48, 1.94], 9, 0.14);
  lightString(kit, group, [1.16, 1.48, 1.94], [2.22, 1.62, 1.5], 4, 0.1);
  part(group, kit, 'box', shade, [0.66, 1.36, 1.34], [0.05, 0.05, 0.1]);
  const beacon = kit.sphere(0.1, kit.beacon, [0.66, 1.27, 1.42]);
  group.add(beacon);
  if (!dark) {
    for (const [x, size] of [[-0.82, 0.15], [-0.6, 0.1]]) {
      part(group, kit, 'ball', kit.mat('pumpkin', { rough: 0.6 }), [x, 0.1 + size * 0.8, 1.7], [size, size * 0.8, size]);
      part(group, kit, 'rod', kit.mat('pine', { rough: 0.9 }), [x, 0.1 + size * 1.7, 1.7], [0.018, 0.07, 0.018]);
    }
  }

  const foot = [2.62, -0.75];
  const tip = [foot[0], 3.4, foot[1]];
  for (let leg = 0; leg < 3; leg++) {
    const angle = leg / 3 * TAU + 0.5;
    rod(group, kit, steel, [foot[0] + Math.cos(angle) * 0.26, 0, foot[1] + Math.sin(angle) * 0.26], tip, 0.022);
  }
  for (const y of [0.8, 1.6, 2.4]) {
    const reach = 0.26 * (1 - y / 3.4);
    part(group, kit, 'ring', steel, [foot[0], y, foot[1]], [reach, reach, 0.2], [Math.PI / 2, 0, 0]);
  }
  rod(group, kit, steel, [foot[0], 2.6, foot[1]], [3.5, 0, -1.7], 0.007);
  const aerial = new Group();
  aerial.position.set(foot[0], 3.46, foot[1]);
  part(aerial, kit, 'box', steel, [0, 0, 0], [1.1, 0.03, 0.03]);
  for (const x of [-0.45, -0.15, 0.15, 0.45]) part(aerial, kit, 'box', steel, [x, 0, 0], [0.025, 0.025, 0.5 - Math.abs(x) * 0.4]);
  group.add(aerial);
  part(group, kit, 'bead', emberMaterial(kit), [foot[0], 3.58, foot[1]], 0.05);

  if (dark) {
    vine(kit, group, [[-2.4, 0.03, 1.7], [-2.22, 0.9, 1.38], [-1.95, 1.72, 1.46], [-1.5, 2.1, 0.9], [-0.9, 2.5, 0.28]], 0.06);
    vine(kit, group, [[2.5, 0.03, 1.2], [2.2, 0.8, 1.2], [2.24, 1.66, 0.8], [1.95, 2.02, 0.5]], 0.05, 1);
    vine(kit, group, [[-0.2, 2.64, 0.05], [0.5, 2.34, 0.46], [0.75, 1.9, 1.06]], 0.04);
  }

  group.userData = {
    door,
    beacon,
    spin: [[aerial, 'y', 0.5]],
    chimney: new Vector3(-1.35, 3.3, -0.5),
    labelY: 3.4,
    react(event) {
      st.surgeAt = st.clock;
      if (event === 'delivery') st.flagAt = st.clock;
    },
    frame(time) { st.clock = time; },
  };
  return kit.shadows(group);
}

// Deliveries are stacked on the drive beside the house: a concrete slab, a
// pallet and the board that says where they go.
function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  group.add(kit.shadow(2.6, 1.9, 0.26));
  const slab = part(group, kit, 'box', kit.mat('concrete', { rough: 0.95 }), [0, 0.015, 0], [2.3, 0.03, 1.6]);
  slab.receiveShadow = !kit.software;
  const wood = kit.mat('crate', { rough: 0.85 });
  for (const z of [-0.5, 0, 0.5]) part(group, kit, 'box', kit.mat('wood', { rough: 0.9 }), [0, 0.05, z], [1.9, 0.05, 0.08]);
  for (let i = -3; i <= 3; i++) part(group, kit, 'box', wood, [i * 0.27, 0.085, 0], [0.22, 0.022, 1.3]).receiveShadow = !kit.software;
  const post = kit.mat('wood', { rough: 0.9 });
  part(group, kit, 'box', post, [1.02, 0.42, -0.62], [0.04, 0.84, 0.04]);
  part(group, kit, 'box', lettering(kit, 'drop', 'DROP\nHERE', { ink: 'door', board: 'paper', height: 128 }), [1.02, 0.74, -0.59], [0.46, 0.3, 0.02], [0, -0.3, 0]);
  return group;
}

// ---------- stations ----------

// Each builder adds its place to `g` and returns what the station drives:
// the state `lamp`, where smoke `puff`s from, the `top` its label clears,
// optional `spin` and `swing`, and `pose(time, live)` for whoever is there,
// `live` running 0 to 1 as its agent works.

// Raises an arm to talk into a walkie-talkie, and nods along.
function talk(who, time, live, hand = 1) {
  who.arms[hand].rotation.x = -live * (2.2 + Math.sin(time * 3.1) * 0.12);
  who.head.rotation.x = live * Math.sin(time * 2.3) * 0.12;
}

function cabin(kit, g, index) {
  const wall = logs(kit);
  const trim = kit.mat('trim', { rough: 0.8 });
  const wood = kit.mat('wood', { rough: 0.9 });
  const tin = shingles(kit, 'roofTin', 4, 8);
  part(g, kit, 'box', wall, [0, 0.33, -0.12], [1.34, 0.66, 0.9]);
  for (const x of [-0.67, 0.67]) for (const z of [-0.57, 0.33]) part(g, kit, 'rod', kit.mat('bark', { rough: 0.95 }), [x, 0.34, z], [0.05, 0.7, 0.05]);
  const roof = eaveRoof(kit, 1.34, 0.9, 0.42, wall, tin);
  roof.position.set(0, 0.66, -0.12);
  g.add(roof);
  part(g, kit, 'box', wood, [0, 0.04, 0.54], [1.34, 0.08, 0.42]);
  for (const x of [-0.6, 0.6]) part(g, kit, 'box', wood, [x, 0.38, 0.7], [0.05, 0.6, 0.05]);
  part(g, kit, 'box', kit.mat('roofTin', { rough: 0.9 }), [0, 0.69, 0.52], [1.46, 0.04, 0.52], [0.22, 0, 0]);
  part(g, kit, 'box', kit.mat('worker', { rough: 0.6 }), [-0.3, 0.34, 0.335], [0.3, 0.5, 0.03]);
  part(g, kit, 'box', litMaterial(kit), [0.28, 0.4, 0.335], [0.4, 0.26, 0.03]);
  part(g, kit, 'box', trim, [0.28, 0.4, 0.345], [0.4, 0.025, 0.03]);
  part(g, kit, 'box', trim, [0.28, 0.4, 0.345], [0.025, 0.26, 0.03]);
  part(g, kit, 'rod', kit.mat('steel', { rough: 0.5, metal: 0.5 }), [-0.42, 1.0, -0.32], [0.045, 0.5, 0.045]);
  part(g, kit, 'cone', kit.mat('steel', { rough: 0.5, metal: 0.5 }), [-0.42, 1.28, -0.32], [0.08, 0.07, 0.08]);
  lightString(kit, g, [-0.7, 0.62, 0.78], [0.7, 0.62, 0.78], 5, 0.07);
  const chair = new Group();
  chair.position.set(0.36, 0.1, 0.56);
  part(chair, kit, 'box', wood, [0, 0.14, 0], [0.22, 0.03, 0.2]);
  part(chair, kit, 'box', wood, [0, 0.3, -0.1], [0.22, 0.32, 0.03], [-0.15, 0, 0]);
  for (const x of [-0.1, 0.1]) part(chair, kit, 'box', wood, [x, 0.02, 0], [0.025, 0.03, 0.34]);
  g.add(chair);
  const aerial = new Group();
  aerial.position.set(0.42, 1.34, -0.12);
  part(aerial, kit, 'rod', trim, [0, -0.2, 0], [0.012, 0.4, 0.012]);
  part(aerial, kit, 'box', trim, [0, 0, 0], [0.46, 0.02, 0.02]);
  for (const x of [-0.16, 0, 0.16]) part(aerial, kit, 'box', trim, [x, 0, 0], [0.02, 0.02, 0.22]);
  g.add(aerial);
  const lamp = part(g, kit, 'bead', kit.lamp(), [-0.02, 0.5, 0.72], 0.07);
  return {
    lamp, top: 1.36, puff: new Vector3(-0.42, 1.36, -0.32),
    spin: [[aerial, 'y', 1.1 + seeded(index) * 0.5]], swing: [[chair, 'x', 0.16, 2.2]],
  };
}

function radioShack(kit, g, index) {
  const trim = kit.mat('trim', { rough: 0.8 });
  const wood = kit.mat('wood', { rough: 0.9 });
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const shade = kit.mat('door', { rough: 1 });
  part(g, kit, 'box', siding(kit), [0, 0.42, -0.16], [1.16, 0.84, 0.8]);
  part(g, kit, 'box', kit.mat('roofTin', { rough: 0.9 }), [0, 0.88, -0.14], [1.3, 0.05, 0.96], [0.12, 0, 0]);
  part(g, kit, 'box', shade, [0.14, 0.46, 0.245], [0.64, 0.4, 0.02]);
  part(g, kit, 'box', wood, [0.14, 0.76, 0.38], [0.68, 0.03, 0.3], [-0.4, 0, 0]);
  part(g, kit, 'box', wood, [0.14, 0.24, 0.32], [0.72, 0.04, 0.2]);
  part(g, kit, 'box', kit.mat('accent', { rough: 0.7 }), [-0.4, 0.3, 0.245], [0.24, 0.56, 0.02]);
  part(g, kit, 'box', steel, [0.1, 0.33, 0.32], [0.3, 0.14, 0.13]);
  for (const x of [0.02, 0.1, 0.18]) part(g, kit, 'bead', litMaterial(kit), [x, 0.35, 0.39], 0.018);
  part(g, kit, 'box', lettering(kit, 'av', 'A.V. CLUB', { ink: 'paper', board: 'accent' }), [0.14, 0.96, 0.33], [0.7, 0.16, 0.025]);
  const base = [-0.36, 0.86, -0.42];
  for (const [dx, dz] of [[-0.08, -0.06], [0.08, -0.06], [0, 0.08]]) rod(g, kit, steel, [base[0] + dx, base[1], base[2] + dz], [base[0], 1.84, base[2]], 0.014);
  for (const y of [1.1, 1.4]) part(g, kit, 'ring', steel, [base[0], y, base[2]], [0.07 * (1.9 - y), 0.07 * (1.9 - y), 0.3], [Math.PI / 2, 0, 0]);
  const beam = new Group();
  beam.position.set(base[0], 1.88, base[2]);
  part(beam, kit, 'box', steel, [0, 0, 0], [0.7, 0.022, 0.022]);
  for (const x of [-0.3, -0.1, 0.1, 0.3]) part(beam, kit, 'box', steel, [x, 0, 0], [0.018, 0.018, 0.36 - Math.abs(x) * 0.4]);
  g.add(beam);
  const dish = part(g, kit, 'dome', kit.mat('trim', { rough: 0.5, metal: 0.3, doubleSide: true }), [0.38, 1.1, -0.36], [0.2, 0.09, 0.2], [2.3, 0, 0.3]);
  rod(g, kit, steel, [0.38, 0.88, -0.36], [0.38, 1.08, -0.36], 0.018);
  const lamp = part(g, kit, 'box', kit.lamp(), [0.14, 0.72, 0.262], [0.24, 0.07, 0.03]);
  const dj = kid(kit, g, [-0.12, 0, 0.56], index + 1, { turn: Math.PI - 0.5 });
  part(dj.head, kit, 'arc', shade, [0, 0.02, 0], [0.1, 0.1, 0.1]);
  return {
    lamp, occupants: [dj.group], top: 1.94, puff: new Vector3(base[0], 1.95, base[2]), spin: [[beam, 'y', 1.3 + seeded(index) * 0.4]],
    pose(time, live) {
      talk(dj, time, live);
      dish.rotation.z = 0.3 + Math.sin(time * 0.7) * 0.25 * live;
    },
  };
}

function arcade(kit, g, index) {
  const trim = kit.mat('trim', { rough: 0.8 });
  const shade = kit.mat('door', { rough: 1 });
  part(g, kit, 'box', bricks(kit), [0, 0.42, -0.14], [1.42, 0.84, 0.84]);
  part(g, kit, 'box', trim, [0, 0.87, -0.14], [1.48, 0.07, 0.9]);
  const front = shared(kit, 'upside-down-arcade-glass', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#0c0a1c';
    ctx.fillRect(0, 0, w, h);
    ['#ff3d8b', '#3dd6ff', '#ffc857', '#7be0a0', '#ff3d8b'].forEach((tone, i) => {
      const x = 6 + i * 25;
      ctx.fillStyle = '#1c1830';
      ctx.fillRect(x, 16, 20, h - 16);
      ctx.fillStyle = tone;
      ctx.fillRect(x + 3, 22, 14, 12);
      ctx.fillRect(x + 2, 8, 16, 4);
    });
  }, { width: 128, height: 64, rough: 0.3, metal: 0.1, emissive: true, glow: kit.mode === 'dark' ? 1.3 : 0.7 }));
  part(g, kit, 'box', trim, [0.2, 0.38, 0.275], [0.86, 0.48, 0.02]);
  part(g, kit, 'box', front, [0.2, 0.38, 0.29], [0.8, 0.42, 0.02]);
  part(g, kit, 'box', shade, [-0.47, 0.3, 0.285], [0.26, 0.56, 0.02]);
  part(g, kit, 'box', kit.mat('worker', { rough: 0.7 }), [0, 0.67, 0.4], [1.36, 0.035, 0.26], [0.32, 0, 0]);
  for (const x of [-0.4, 0.4]) part(g, kit, 'box', shade, [x, 0.98, 0.1], [0.03, 0.16, 0.03]);
  const neon = lettering(kit, 'arcade', 'ARCADE', { ink: 'neon', board: '#140c1c', glow: kit.mode === 'dark' ? 2.2 : 1.1, face: 'Arial, sans-serif' });
  part(g, kit, 'box', neon, [0, 1.12, 0.1], [1.04, 0.24, 0.04]);
  const lamp = part(g, kit, 'bead', kit.lamp(), [-0.47, 0.67, 0.31], 0.06);
  const cabinet = new Group();
  cabinet.position.set(0.5, 0, 0.44);
  cabinet.rotation.y = -0.5;
  part(cabinet, kit, 'box', shade, [0, 0.28, 0], [0.24, 0.56, 0.24]);
  part(cabinet, kit, 'box', kit.mat('neon', { rough: 0.6 }), [0, 0.6, -0.02], [0.24, 0.08, 0.2]);
  const screen = part(cabinet, kit, 'box', kit.mat('screen', { rough: 0.3, emissive: 'screen', glow: 1.2 }), [0, 0.44, 0.115], [0.18, 0.14, 0.02], [-0.3, 0, 0]);
  part(cabinet, kit, 'box', kit.mat('steel', { rough: 0.5 }), [0, 0.32, 0.14], [0.22, 0.03, 0.08]);
  g.add(cabinet);
  const player = kid(kit, cabinet, [0, 0, 0.3], index + 2, { turn: Math.PI });
  return {
    lamp, occupants: [player.group], top: 1.26, puff: new Vector3(0, 1.3, 0),
    pose(time, live) {
      player.arms[0].rotation.x = -1.1 - Math.sin(time * 9) * 0.1 * live;
      player.arms[1].rotation.x = -1.1 - Math.sin(time * 11 + 1) * 0.1 * live;
      player.group.position.x = Math.sin(time * 4.3) * 0.02 * live;
      screen.scale.x = 0.18 * (1 - 0.3 * live * (Math.sin(time * 13) > 0.6 ? 1 : 0));
    },
  };
}

function schoolBus(kit, g, index) {
  const paint = kit.mat('bus', { rough: 0.6, metal: 0.1 });
  const shade = kit.mat('door', { rough: 1 });
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const rust = kit.mat('rust', { rough: 0.9, metal: 0.2 });
  const wood = kit.mat('wood', { rough: 0.9 });
  part(g, kit, 'box', paint, [-0.14, 0.46, -0.1], [1.4, 0.5, 0.6]);
  part(g, kit, 'box', paint, [0.72, 0.36, -0.1], [0.34, 0.3, 0.54]);
  part(g, kit, 'box', kit.mat('trim', { rough: 0.7 }), [-0.14, 0.73, -0.1], [1.36, 0.05, 0.56]);
  part(g, kit, 'box', shade, [-0.14, 0.38, 0.203], [1.4, 0.03, 0.012]);
  for (let i = 0; i < 5; i++) part(g, kit, 'box', i === 3 ? kit.mat('glass', { rough: 0.2 }) : litMaterial(kit), [-0.7 + i * 0.26, 0.56, 0.203], [0.2, 0.16, 0.012]);
  part(g, kit, 'box', kit.mat('glass', { rough: 0.2 }), [0.565, 0.56, -0.1], [0.012, 0.18, 0.5]);
  for (const x of [-0.56, 0.56]) for (const z of [-0.36, 0.16]) part(g, kit, 'drum', kit.mat('tyre', { rough: 0.9 }), [x, 0.15, z], [0.15, 0.1, 0.15], [Math.PI / 2, 0, 0]);
  part(g, kit, 'box', rust, [-0.5, 0.36, 0.215], [0.42, 0.3, 0.02], [0, 0, 0.07]);
  part(g, kit, 'box', rust, [0.22, 0.3, 0.215], [0.3, 0.22, 0.02], [0, 0, -0.1]);
  part(g, kit, 'box', steel, [0.9, 0.26, -0.1], [0.04, 0.1, 0.6]);
  for (const z of [-0.28, 0.08]) part(g, kit, 'bead', litMaterial(kit), [0.895, 0.4, z], 0.04);
  part(g, kit, 'box', wood, [-0.36, 0.78, -0.1], [0.7, 0.04, 0.54]);
  for (const x of [-0.7, -0.02]) for (const z of [-0.35, 0.15]) part(g, kit, 'box', wood, [x, 0.92, z], [0.03, 0.26, 0.03]);
  part(g, kit, 'box', wood, [-0.36, 1.04, -0.35], [0.7, 0.03, 0.03]);
  for (const z of [-0.2, 0]) rod(g, kit, steel, [-0.86, 0.02, z], [-0.86, 0.82, z], 0.012);
  for (const y of [0.2, 0.4, 0.6]) part(g, kit, 'box', steel, [-0.86, y, -0.1], [0.02, 0.02, 0.2]);
  rod(g, kit, wood, [0.5, 0.75, -0.3], [0.5, 1.55, -0.3], 0.012);
  const pennant = new Group();
  pennant.position.set(0.5, 1.46, -0.3);
  part(pennant, kit, 'box', kit.mat('worker', { rough: 0.7, doubleSide: true }), [0.15, 0, 0], [0.3, 0.16, 0.012]);
  g.add(pennant);
  part(g, kit, 'drum', steel, [0.3, 0.83, 0.1], [0.07, 0.1, 0.07], [1.2, 0, 0]);
  const lamp = part(g, kit, 'bead', kit.lamp(), [0.3, 0.85, 0.16], 0.062);
  const scout = kid(kit, g, [-0.36, 0.8, -0.1], index + 3);
  part(scout.head, kit, 'box', shade, [0, 0.005, 0.09], [0.11, 0.04, 0.06]);
  scout.arms.forEach(arm => { arm.rotation.x = -2.5; });
  return {
    lamp, occupants: [scout.group], top: 1.56, puff: new Vector3(0.9, 0.5, -0.1), swing: [[pennant, 'y', 0.5, 2 + seeded(index) * 1.2]],
    pose(time, live) {
      scout.group.rotation.y = 0.4 + Math.sin(time * 0.8 + index) * 1.1 * live;
    },
  };
}

function stickFort(kit, g, index) {
  const shade = kit.mat('door', { rough: 1 });
  const stick = kit.mat('wood', { rough: 0.95 });
  const tarp = kit.gable(1.2, 1.0, 0.82, kit.mat('tarp', { rough: 0.95 }), { bodyMat: shade, overhang: 0.06, thickness: 0.04 });
  tarp.position.set(0, 0.02, -0.14);
  g.add(tarp);
  for (const [x, lean, length] of [[-0.44, -0.5, 0.96], [0.4, 0.48, 1.02], [0.52, 0.56, 0.8], [-0.56, -0.6, 0.7]]) {
    const leant = part(g, kit, 'rod', stick, [x, length * 0.42, 0.4], [0.024, length, 0.024]);
    leant.rotation.z = lean;
  }
  part(g, kit, 'box', lettering(kit, 'keep-out', 'KEEP OUT', { ink: 'fail', board: 'crate' }), [0, 0.9, 0.4], [0.58, 0.15, 0.03], [0, 0, 0.06]);
  const mast = new Group();
  mast.position.set(-0.48, 0, -0.56);
  part(mast, kit, 'rod', stick, [0, 0.65, 0], [0.016, 1.3, 0.016]);
  const pennant = new Group();
  pennant.position.y = 1.2;
  part(pennant, kit, 'box', kit.mat('accent', { rough: 0.7, doubleSide: true }), [0.15, 0, 0], [0.3, 0.16, 0.012]);
  mast.add(pennant);
  g.add(mast);
  rod(g, kit, stick, [0.62, 0, 0.5], [0.62, 0.74, 0.5], 0.016);
  rod(g, kit, stick, [0.62, 0.72, 0.5], [0.46, 0.72, 0.56], 0.012);
  const lamp = part(g, kit, 'bead', kit.lamp(), [0.46, 0.62, 0.56], 0.07);
  const reader = kid(kit, g, [-0.06, 0, 0.42], index, { sit: true });
  const comic = part(reader.group, kit, 'box', kit.mat('paper', { rough: 0.8 }), [0, 0.3, 0.2], [0.2, 0.14, 0.015], [-0.9, 0, 0]);
  reader.arms.forEach(arm => { arm.rotation.x = -1.0; });
  return {
    lamp, occupants: [reader.group], top: 1.3, puff: new Vector3(0, 0.95, -0.3), swing: [[pennant, 'y', 0.5, 2 + seeded(index) * 1.2]],
    pose(time, live) {
      reader.head.rotation.x = 0.35 - Math.sin(time * 0.9 + index) * 0.2 * live;
      reader.head.rotation.y = Math.sin(time * 0.6 + index) * 0.5 * live;
      comic.rotation.z = Math.sin(time * 2.6) * 0.06 * live;
    },
  };
}

function campsite(kit, g, index) {
  const shade = kit.mat('door', { rough: 1 });
  const stick = kit.mat('wood', { rough: 0.95 });
  const tent = kit.gable(0.86, 0.96, 0.6, kit.mat('canvas', { rough: 0.95 }), { bodyMat: shade, overhang: 0.04, thickness: 0.03 });
  tent.position.set(-0.36, 0.01, -0.22);
  tent.rotation.y = 0.5;
  g.add(tent);
  const fire = [0.34, 0.26];
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * TAU;
    part(g, kit, 'rock', kit.mat('kerb', { rough: 0.95, flat: true }), [fire[0] + Math.cos(angle) * 0.2, 0.03, fire[1] + Math.sin(angle) * 0.2], [0.06, 0.045, 0.05], [0, angle, 0]);
  }
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * Math.PI;
    rod(g, kit, kit.mat('bark', { rough: 0.95 }), [fire[0] - Math.cos(angle) * 0.15, 0.03, fire[1] - Math.sin(angle) * 0.15], [fire[0] + Math.cos(angle) * 0.15, 0.1, fire[1] + Math.sin(angle) * 0.15], 0.028);
  }
  const blaze = new Group();
  blaze.position.set(fire[0], 0.08, fire[1]);
  part(blaze, kit, 'cone', kit.mat('flame', { rough: 0.5, emissive: 'flame', glow: 1.6 }), [0, 0.13, 0], [0.1, 0.26, 0.1]);
  part(blaze, kit, 'cone', kit.mat('window', { rough: 0.5, emissive: 'window', glow: 1.8 }), [0.02, 0.09, 0.02], [0.06, 0.16, 0.06]);
  g.add(blaze);
  if (kit.mode === 'dark') g.add(kit.halo('flame', 1.5, 1.5, { opacity: 0.26, at: [fire[0], 0.04, fire[1]] }));
  rod(g, kit, kit.mat('bark', { rough: 0.95 }), [0.52, 0.07, -0.26], [0.86, 0.07, 0.02], 0.07);
  const camper = kid(kit, g, [0.7, 0.02, -0.1], index + 1, { sit: true, turn: -2.2 });
  const skewer = new Group();
  skewer.position.set(0, -0.2, 0);
  rod(skewer, kit, stick, [0, 0, 0], [0, -0.04, 0.42], 0.008);
  part(skewer, kit, 'bead', kit.mat('paper', { rough: 0.7 }), [0, -0.04, 0.42], 0.03);
  camper.arms[1].add(skewer);
  camper.arms[1].rotation.x = -0.9;
  rod(g, kit, stick, [-0.78, 0, 0.46], [-0.78, 0.78, 0.46], 0.016);
  rod(g, kit, stick, [-0.78, 0.76, 0.46], [-0.64, 0.76, 0.52], 0.012);
  const lamp = part(g, kit, 'bead', kit.lamp(), [-0.64, 0.66, 0.52], 0.07);
  return {
    lamp, occupants: [camper.group], top: 0.96, puff: new Vector3(fire[0], 0.5, fire[1]),
    pose(time, live) {
      blaze.scale.set(0.55 + live * 0.5, 0.45 + live * (0.6 + Math.sin(time * 9 + index) * 0.14), 0.55 + live * 0.5);
      blaze.rotation.y = time * 2;
      camper.arms[1].rotation.x = -0.9 + Math.sin(time * 1.4) * 0.12 * live;
      camper.head.rotation.x = 0.2 * live;
    },
  };
}

function phoneBox(kit, g, index) {
  const steel = kit.mat('steel', { rough: 0.4, metal: 0.5 });
  const pane = kit.mat('glass', { rough: 0.1, metal: 0.3, opacity: 0.32 });
  const booth = new Group();
  booth.position.set(-0.26, 0, -0.14);
  part(booth, kit, 'box', kit.mat('concrete', { rough: 0.95 }), [0, 0.02, 0], [0.6, 0.04, 0.6]);
  for (const x of [-0.24, 0.24]) for (const z of [-0.24, 0.24]) part(booth, kit, 'box', steel, [x, 0.56, z], [0.035, 1.04, 0.035]);
  part(booth, kit, 'box', pane, [0, 0.56, -0.24], [0.46, 0.96, 0.012]);
  for (const x of [-0.24, 0.24]) part(booth, kit, 'box', pane, [x, 0.56, 0], [0.012, 0.96, 0.46]);
  part(booth, kit, 'box', steel, [0, 1.11, 0], [0.56, 0.07, 0.56]);
  const header = lettering(kit, 'phone', 'PHONE', { ink: 'paper', board: 'accent', glow: kit.mode === 'dark' ? 1.4 : 0.4, face: 'Arial, sans-serif' });
  part(booth, kit, 'box', header, [0, 0.99, 0.25], [0.5, 0.13, 0.02]);
  part(booth, kit, 'box', kit.mat('door', { rough: 0.6 }), [0, 0.62, -0.19], [0.18, 0.26, 0.07]);
  g.add(booth);
  const lamp = part(booth, kit, 'dome', kit.lamp(), [0, 1.145, 0], [0.09, 0.07, 0.09]);
  const caller = kid(kit, booth, [0.02, 0.04, 0], index + 2, { turn: Math.PI });
  const handset = part(caller.arms[1], kit, 'box', kit.mat('door', { rough: 0.5 }), [0, -0.24, 0.02], [0.04, 0.12, 0.04]);
  handset.castShadow = false;
  rod(booth, kit, kit.mat('door', { rough: 0.6 }), [0.06, 0.6, -0.16], [0.13, 0.5, -0.04], 0.006);
  const ride = bike(kit, index % 2 ? 'accent' : 'ok').object;
  ride.position.set(0.44, 0, -0.06);
  ride.rotation.set(0, 0.35, 0.2);
  g.add(ride);
  return {
    lamp, occupants: [caller.group], top: 1.24, puff: new Vector3(-0.26, 1.25, -0.14),
    pose(time, live) {
      caller.arms[1].rotation.x = -0.4 - live * 2.1;
      caller.arms[0].rotation.x = -live * (0.5 + Math.sin(time * 2.2 + index) * 0.4);
      caller.head.rotation.y = Math.sin(time * 1.1 + index) * 0.4 * live;
    },
  };
}

function walkiePost(kit, g, index) {
  const wood = kit.mat('crate', { rough: 0.9 });
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const shade = kit.mat('door', { rough: 0.7 });
  part(g, kit, 'box', wood, [-0.34, 0.16, -0.2], [0.44, 0.32, 0.4]);
  part(g, kit, 'box', kit.mat('wood', { rough: 0.9 }), [-0.3, 0.44, -0.22], [0.32, 0.24, 0.3], [0, 0.3, 0]);
  part(g, kit, 'box', shade, [-0.3, 0.63, -0.22], [0.24, 0.14, 0.12], [0, 0.3, 0]);
  for (const x of [-0.36, -0.28]) part(g, kit, 'bead', litMaterial(kit), [x, 0.65, -0.14], 0.016);
  const whip = new Group();
  whip.position.set(-0.2, 0.7, -0.24);
  rod(whip, kit, steel, [0, 0, 0], [0, 0.72, 0], 0.008);
  const lamp = part(whip, kit, 'bead', kit.lamp(), [0, 0.76, 0], 0.055);
  g.add(whip);
  part(g, kit, 'box', wood, [0.3, 0.07, 0.1], [0.26, 0.14, 0.24]);
  const caller = kid(kit, g, [0.3, 0.04, 0.12], index + 3, { sit: true, turn: -0.5 });
  const walkie = new Group();
  walkie.position.set(0, -0.24, 0.02);
  part(walkie, kit, 'box', shade, [0, 0, 0], [0.05, 0.13, 0.035]);
  rod(walkie, kit, steel, [0.012, 0, 0], [0.012, -0.2, 0], 0.005);
  caller.arms[1].add(walkie);
  const stood = bike(kit, index % 2 ? 'fail' : 'accent').object;
  stood.position.set(0.24, 0, -0.52);
  stood.rotation.set(0, 1.4, 0.14);
  g.add(stood);
  return {
    lamp, occupants: [caller.group], top: 1.5, puff: new Vector3(-0.2, 1.5, -0.24), swing: [[whip, 'z', 0.07, 3.4]],
    pose(time, live) {
      talk(caller, time, live);
      caller.arms[0].rotation.x = -0.5;
    },
  };
}

const WORKERS = [cabin, radioShack, arcade, schoolBus];
const FORTS = [stickFort, campsite, phoneBox, walkiePost];

// What grows over a station whose agent failed: vines up out of the ground
// and in over it, a pustule glowing at the tip of each.
function overgrowth(kit, top, index) {
  const group = new Group();
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * TAU + seeded(index + i) * 0.8;
    const reach = 0.84 + seeded(index * 3 + i) * 0.14;
    const at = (share, height) => [Math.cos(angle + share * 0.6) * reach * (1 - share * 0.62), height, Math.sin(angle + share * 0.6) * reach * (1 - share * 0.62)];
    vine(kit, group, [at(0, 0), at(0.3, top * 0.45), at(0.65, top * 0.82), at(1, top * 0.74)], 0.05, 1);
  }
  group.visible = false;
  return group;
}

// A worker's place is one of four around town, and a subagent's one of four
// the kids put up themselves, each in turn.
function station(kit, kind, spot = { index: 0 }) {
  const index = spot.index ?? 0;
  const group = new Group();
  const rig = (kind === 'worker' ? WORKERS : FORTS)[index % 4](kit, group, index);
  kit.shadows(group);
  const taken = overgrowth(kit, rig.top, index);
  group.add(taken);
  group.userData = {
    lamp: rig.lamp,
    occupants: rig.occupants || [],
    spin: rig.spin || [],
    swing: rig.swing || [],
    puff: rig.puff,
    labelY: rig.top + 0.42,
    frame(time, dt, state) {
      const still = kit.reducedMotion;
      rig.pose?.(still ? 0 : time, still ? (state.state === 'running' ? 1 : 0) : state.activity);
      const since = state.failedAt;
      const grown = state.state !== 'failed' ? 0 : still || since == null || since === -Infinity ? 1 : smooth((time - since) / 1.4);
      taken.visible = grown > 0.01;
      if (taken.visible) taken.scale.set(0.75 + grown * 0.25, grown, 0.75 + grown * 0.25);
    },
  };
  return group;
}

// A lot worn into the grass, stepping stones out to the road and a marker
// either side of its front that shows the agent's state.
function pad(kit, kind, lampMaterial) {
  const group = new Group();
  const wide = kind === 'worker' ? 1.04 : 0.9;
  const deep = kind === 'worker' ? 0.94 : 0.82;
  group.add(kit.shadow(wide * 2.5, deep * 2.5, 0.3));
  const lot = part(group, kit, 'drum', kit.mat('dirt', { rough: 1 }), [0, 0.012, 0], [wide, 0.024, deep]);
  lot.receiveShadow = !kit.software;
  const stone = kit.mat('kerb', { rough: 0.95, flat: true });
  for (const [z, size] of [[deep + 0.14, 0.13], [deep + 0.42, 0.11]]) {
    part(group, kit, 'rock', stone, [0.03, 0.012, z], [size * 1.2, 0.03, size], [0, z * 3, 0]).receiveShadow = !kit.software;
  }
  if (lampMaterial) {
    for (const side of [-1, 1]) {
      part(group, kit, 'box', kit.mat('wood', { rough: 0.9 }), [side * wide * 0.72, 0.09, deep * 0.72], [0.035, 0.18, 0.035]);
      part(group, kit, 'box', lampMaterial, [side * wide * 0.72, 0.2, deep * 0.72], [0.07, 0.07, 0.07]);
    }
  }
  return group;
}

// A queued agent's lot is staked out and waiting: four stakes, twine between
// them and a bulb that has not come on yet.
function ghost(kit) {
  const group = new Group();
  const stake = kit.basic('trim', { opacity: 0.7 });
  const twine = kit.basic('glow', { opacity: 0.5, additive: kit.mode === 'dark' });
  const corners = [[-0.62, -0.5], [0.62, -0.5], [0.62, 0.5], [-0.62, 0.5]];
  corners.forEach(([x, z], i) => {
    part(group, kit, 'box', stake, [x, 0.24, z], [0.045, 0.48, 0.045]);
    const [nx, nz] = corners[(i + 1) % 4];
    rod(group, kit, twine, [x, 0.4, z], [nx, 0.4, nz], 0.008);
  });
  part(group, kit, 'bead', kit.basic('glow', { opacity: 0.35, additive: kit.mode === 'dark' }), [0, 0.5, 0], [0.09, 0.13, 0.09]);
  return group;
}

// A cardboard box, taped shut and stamped.
function crate(kit) {
  const group = new Group();
  group.add(kit.box(0.4, 0.34, 0.4, kit.mat('crate', { rough: 0.9 })));
  group.add(kit.box(0.41, 0.35, 0.07, kit.mat('tape', { rough: 0.6 })));
  group.add(kit.box(0.16, 0.1, 0.405, kit.mat('paper', { rough: 0.8 }), [0.06, 0.02, 0]));
  return kit.shadows(group);
}

// A kid on a bike, pedalling, the box on the rack behind and the headlamp on.
function carrier(kit) {
  const object = new Group();
  object.add(kit.shadow(0.5, 1.2, 0.26, [0, 0.006, 0]));
  const ride = bike(kit, 'fail');
  object.add(ride.object);
  const steel = kit.mat('steel', { rough: 0.4, metal: 0.6 });
  const shirt = kit.mat('worker', { rough: 0.9 });
  const jeans = kit.mat('denim', { rough: 0.9 });
  object.add(kit.sphere(0.045, kit.mat('window', { emissive: 'window', glow: 1.8 }), [0, 0.56, 0.33], 8));
  if (kit.mode === 'dark') object.add(kit.halo('window', 0.9, 1.5, { opacity: 0.3, at: [0, 0.02, 1.15] }));
  part(object, kit, 'box', shirt, [0, 0.8, -0.03], [0.2, 0.3, 0.15], [0.45, 0, 0]);
  part(object, kit, 'box', kit.mat('accent', { rough: 0.9 }), [0, 0.8, -0.15], [0.17, 0.22, 0.09], [0.45, 0, 0]);
  const legs = [-1, 1].map(side => {
    part(object, kit, 'box', shirt, [side * 0.13, 0.76, 0.15], [0.045, 0.045, 0.27], [0.5, 0, 0]);
    const leg = new Group();
    leg.position.set(side * 0.075, 0.62, -0.12);
    part(leg, kit, 'box', jeans, [0, -0.14, 0.03], [0.065, 0.3, 0.07]);
    object.add(leg);
    return leg;
  });
  part(object, kit, 'ball', kit.mat('skinA', { rough: 0.8 }), [0, 1.0, 0.1], 0.09);
  part(object, kit, 'dome', kit.mat('hairA', { rough: 0.95 }), [0, 1.01, 0.09], 0.098);
  part(object, kit, 'box', kit.mat('accent', { rough: 0.8 }), [0, 1.05, 0.2], [0.13, 0.02, 0.1]);
  part(object, kit, 'box', steel, [0, 0.45, -0.46], [0.26, 0.02, 0.3]);
  const hold = new Group();
  hold.position.set(0, 0.63, -0.46);
  object.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'ground', cruise: 0,
    pose(target, { time, speed }) {
      for (const wheel of ride.wheels) wheel.rotation.x = time * 12;
      legs.forEach((leg, i) => { leg.rotation.x = -0.5 + Math.sin(time * 10 + i * Math.PI) * 0.45; });
      target.rotation.z += Math.sin(time * 5) * 0.05 * (0.4 + speed);
    },
  };
}

// Instructions go out over the radio, a pair of waves at a time, and a
// result's pages blow in behind the bike that carries it.
function packet(kit, direction) {
  if (direction === 'up') {
    const page = kit.box(0.14, 0.012, 0.19, kit.mat('paper', { rough: 0.8, emissive: 'paper', glow: kit.mode === 'dark' ? 0.5 : 0.1 }));
    page.rotation.z = 0.3;
    return page;
  }
  const waves = new Group();
  const air = kit.mat('accent', { rough: 0.4, emissive: 'accent', glow: kit.mode === 'dark' ? 1.4 : 0.6 });
  part(waves, kit, 'arc', air, [0, -0.04, 0.06], 0.1);
  part(waves, kit, 'arc', air, [0, -0.04, -0.06], 0.16);
  return waves;
}

// ---------- beyond the street ----------

// A tree: bare boughs hung with vines by night, a crown of autumn leaves by day.
function tree(kit, parent, x, z, height, index) {
  const group = new Group();
  const bark = kit.mat('bark', { rough: 0.98 });
  part(group, kit, 'taper', bark, [0, height / 2, 0], [height * 0.07, height, height * 0.07]);
  if (kit.mode === 'dark') {
    for (let i = 0; i < 4; i++) {
      const angle = index * 1.7 + i * 1.9;
      const from = [0, height * (0.5 + i * 0.12), 0];
      const length = height * (0.42 - i * 0.06);
      const to = [Math.cos(angle) * length * 0.75, from[1] + length * 0.66, Math.sin(angle) * length * 0.75];
      rod(group, kit, bark, from, to, height * 0.016, 'taper');
      rod(group, kit, bark, to, [to[0] * 1.3 + 0.1, to[1] + length * 0.3, to[2] * 1.3], height * 0.007);
      if ((index + i) % 3 === 0) rod(group, kit, kit.mat('vine', { rough: 0.7 }), to, [to[0] * 1.05, to[1] - length * 0.9, to[2] * 1.05], 0.022);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const size = height * (0.27 - i * 0.035);
      part(group, kit, 'blob', kit.mat(LEAVES[(index + i) % 3], { rough: 0.95, flat: true }), [
        (seeded(index * 3 + i) - 0.5) * height * 0.34, height * (0.66 + i * 0.12), (seeded(index * 5 + i) - 0.5) * height * 0.34,
      ], [size, size * 0.86, size]);
    }
  }
  group.position.set(x, 0, z);
  group.rotation.y = index;
  parent.add(group);
}

function pine(kit, parent, x, z, height, index) {
  const dark = kit.mode === 'dark';
  const needles = kit.mat('pine', { rough: 0.95, flat: true });
  part(parent, kit, 'rod', kit.mat('bark', { rough: 0.98 }), [x, height / 2, z], [height * 0.035, height, height * 0.035]);
  for (let i = 0; i < 4; i++) {
    const wide = height * (0.3 - i * 0.055) * (dark ? 0.62 : 1);
    part(parent, kit, 'cone', needles, [x, height * (0.34 + i * 0.19), z], [wide, height * (dark ? 0.2 : 0.3), wide], [0, index + i, 0]);
  }
}

// The water tower, the town's name round its tank.
function waterTower(kit, parent) {
  const tower = new Group();
  tower.position.set(-5.4, 0, -11.6);
  const steel = kit.mat('steel', { rough: 0.5, metal: 0.5 });
  const feet = [[-0.95, -0.95], [0.95, -0.95], [0.95, 0.95], [-0.95, 0.95]];
  feet.forEach(([x, z], i) => {
    rod(tower, kit, steel, [x, 0, z], [x * 0.72, 4.2, z * 0.72], 0.055);
    const [nx, nz] = feet[(i + 1) % 4];
    rod(tower, kit, steel, [x * 0.9, 1.4, z * 0.9], [nx * 0.8, 2.9, nz * 0.8], 0.02);
    rod(tower, kit, steel, [nx * 0.9, 1.4, nz * 0.9], [x * 0.8, 2.9, z * 0.8], 0.02);
  });
  const band = shared(kit, 'upside-down-tank', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.palette.trim);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(kit.blend(kit.palette.trim, kit.palette.rust, 0.5));
    for (let i = 0; i < 14; i++) ctx.fillRect(seeded(i + 3) * w, h * 0.1, 3, h * (0.3 + seeded(i) * 0.6));
    ctx.fillStyle = hex(kit.palette.door);
    ctx.font = 'bold 46px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const x of [0.25, 0.75]) ctx.fillText('UPSIDE DOWN', w * x, h * 0.52, w * 0.42);
  }, { width: 512, height: 96, rough: 0.7, metal: 0.2 }));
  part(tower, kit, 'drum', band, [0, 4.8, 0], [1.2, 1.3, 1.2], [0, 0.6, 0]);
  part(tower, kit, 'ring', steel, [0, 4.16, 0], [1.3, 1.3, 0.5], [Math.PI / 2, 0, 0]);
  part(tower, kit, 'cone', kit.mat('roof', { rough: 0.7 }), [0, 5.75, 0], [1.26, 0.6, 1.26]);
  part(tower, kit, 'bead', emberMaterial(kit), [0, 6.1, 0], 0.08);
  parent.add(tower);
}

// The laboratory on the edge of town, behind its fence.
function laboratory(kit, parent) {
  const lab = new Group();
  lab.position.set(8.8, 0, -13.4);
  const dark = kit.mode === 'dark';
  const concrete = kit.mat('concrete', { rough: 0.9 });
  const bands = shared(kit, 'upside-down-lab-windows', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = hex(kit.palette.concrete);
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 12; col++) {
        const on = seeded(row * 13 + col) > (dark ? 0.72 : 0.4);
        ctx.fillStyle = on ? hex(kit.palette.window) : hex(kit.blend(kit.palette.concrete, kit.palette.door, 0.7));
        ctx.fillRect(8 + col * 20.5, 10 + row * 20, 14, 10);
      }
    }
  }, { width: 256, height: 64, rough: 0.8, metal: 0, emissive: true, glow: dark ? 0.9 : 0.25 }));
  part(lab, kit, 'box', bands, [0, 1.4, 0], [5.4, 2.8, 2.2]);
  part(lab, kit, 'box', concrete, [0, 2.84, 0], [5.6, 0.12, 2.4]);
  part(lab, kit, 'box', bands, [-3.5, 0.9, 0.3], [1.8, 1.8, 1.8]);
  part(lab, kit, 'box', concrete, [1.4, 3.15, -0.2], [1.1, 0.5, 0.9]);
  part(lab, kit, 'dome', kit.mat('trim', { rough: 0.5, metal: 0.3, doubleSide: true }), [-1.2, 3.3, 0], [0.5, 0.22, 0.5], [2.2, 0, 0.4]);
  rod(lab, kit, kit.mat('steel', { rough: 0.5, metal: 0.5 }), [2.3, 2.9, 0.4], [2.3, 4.4, 0.4], 0.02);
  part(lab, kit, 'bead', emberMaterial(kit), [2.3, 4.44, 0.4], 0.06);
  const mesh = kit.mat('steel', { rough: 0.6, metal: 0.4 });
  for (let x = -4.8; x <= 3.2; x += 1.6) part(lab, kit, 'rod', mesh, [x, 0.6, 2.2], [0.025, 1.2, 0.025]);
  for (const y of [0.3, 0.72, 1.14]) part(lab, kit, 'box', mesh, [-0.8, y, 2.2], [8, 0.015, 0.015]);
  parent.add(lab);
}

// The gate: a tear in the air, lit from the other side, its roots out across
// the ground.
function gate(kit, parent) {
  const at = [4.6, -9.6];
  const tear = shared(kit, 'upside-down-gate', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const edge = t => 0.5 + Math.sin(t * 9) * 0.05 + Math.sin(t * 23 + 1) * 0.03;
    for (const [reach, tone] of [[0.3, 'rgba(120,10,30,0.55)'], [0.19, 'rgba(255,45,63,0.85)'], [0.09, 'rgba(255,170,150,1)']]) {
      ctx.fillStyle = tone;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        ctx.lineTo(w * (edge(t) - reach * Math.sin(t * Math.PI) ** 0.7 * (0.8 + seeded(i) * 0.4)), h * t);
      }
      for (let i = 40; i >= 0; i--) {
        const t = i / 40;
        ctx.lineTo(w * (edge(t) + reach * Math.sin(t * Math.PI) ** 0.7 * (0.8 + seeded(i + 50) * 0.4)), h * t);
      }
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(20,5,12,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = h * (0.12 + i * 0.09);
      ctx.beginPath();
      ctx.moveTo(w * (edge(y / h) - 0.2), y - 6);
      ctx.quadraticCurveTo(w * edge(y / h), y + 5, w * (edge(y / h) + 0.2), y - 4);
      ctx.stroke();
    }
  }, { width: 128, height: 256, basic: true, transparent: true, doubleSide: true }));
  const rift = part(parent, kit, 'plane', tear, [at[0], 1.9, at[1]], [2.4, 3.8, 1]);
  rift.renderOrder = 2;
  const glare = kit.halo('glow', 10, 7, { opacity: 0.4, at: [at[0], 2.2, at[1] - 0.1], flat: false });
  const spill = kit.halo('glow', 7, 5, { opacity: 0.3, at: [at[0], 0.04, at[1] + 1.2] });
  parent.add(glare, spill);
  town(kit).glows.push({ material: glare.material, base: 0.4, swell: 0.3 }, { material: spill.material, base: 0.3, swell: 0.25 });
  for (let i = 0; i < 6; i++) {
    const angle = 0.3 + i / 5 * (Math.PI - 0.6);
    const out = (reach, y) => [at[0] + Math.cos(angle + reach * 0.2) * reach, y, at[1] + Math.sin(angle + reach * 0.2) * reach * 0.9];
    vine(kit, parent, [[at[0], 0.5, at[1]], out(0.7, 0.16), out(1.6, 0.08), out(2.4 + seeded(i) * 0.6, 0.04)], 0.09, i);
  }
}

function welcomeSign(kit, parent) {
  const sign = new Group();
  sign.position.set(-10.7, 0, 2.4);
  sign.rotation.y = 0.75;
  const wood = kit.mat('wood', { rough: 0.9 });
  for (const x of [-0.9, 0.9]) part(sign, kit, 'box', wood, [x, 0.75, 0], [0.09, 1.5, 0.09]);
  part(sign, kit, 'box', kit.mat('trim', { rough: 0.8 }), [0, 1.14, 0.02], [2.3, 0.98, 0.06]);
  const words = lettering(kit, 'welcome', 'WELCOME TO\nUPSIDE DOWN', { ink: 'accent', board: 'paper', width: 256, height: 128 });
  part(sign, kit, 'box', words, [0, 1.14, 0.06], [2.14, 0.84, 0.03]);
  if (kit.mode === 'dark') vine(kit, sign, [[1.3, 0.03, 0.4], [0.95, 0.8, 0.1], [0.5, 1.66, 0.08], [-0.3, 1.5, 0.12]], 0.05);
  parent.add(sign);
}

// The pumpkin patch at the east end of the street, a scarecrow over it. By
// night the pumpkins have rotted where they sat.
function patch(kit, parent) {
  const dark = kit.mode === 'dark';
  const rind = kit.mat('pumpkin', { rough: 0.6 });
  const stalk = kit.mat('pine', { rough: 0.9 });
  for (let i = 0; i < 13; i++) {
    const x = 10.3 + seeded(i + 11) * 2.3;
    const z = 2.2 + seeded(i + 31) * 6.2;
    const size = 0.16 + seeded(i + 51) * 0.14;
    part(parent, kit, 'ball', rind, [x, size * (dark ? 0.45 : 0.7), z], [size, size * (dark ? 0.5 : 0.78), size]);
    if (!dark) part(parent, kit, 'rod', stalk, [x, size * 1.5, z], [0.02, 0.09, 0.02]);
  }
  const hay = kit.mat('hay', { rough: 0.95 });
  part(parent, kit, 'box', hay, [10.5, 0.2, 1.4], [0.8, 0.4, 0.44], [0, 0.3, 0]);
  part(parent, kit, 'box', hay, [10.6, 0.6, 1.42], [0.8, 0.4, 0.44], [0, -0.2, 0]);
  const crow = new Group();
  crow.position.set(11.3, 0, 5.3);
  crow.rotation.y = -0.6;
  const wood = kit.mat('wood', { rough: 0.9 });
  part(crow, kit, 'box', wood, [0, 0.8, 0], [0.06, 1.6, 0.06]);
  part(crow, kit, 'box', wood, [0, 1.2, 0], [1.1, 0.05, 0.05]);
  part(crow, kit, 'box', kit.mat('shirtA', { rough: 0.95 }), [0, 1.08, 0], [0.4, 0.5, 0.16]);
  part(crow, kit, 'ball', kit.mat('canvas', { rough: 0.95 }), [0, 1.5, 0], 0.15);
  part(crow, kit, 'cone', kit.mat('hay', { rough: 0.95 }), [0, 1.68, 0], [0.22, 0.2, 0.22]);
  parent.add(crow);
  if (dark) {
    vine(kit, parent, [[13.4, 0.05, 6.4], [12.2, 0.2, 5.6], [11.3, 0.1, 4.4], [10.4, 0.05, 4.0]], 0.1);
    vine(kit, parent, [[13, 0.05, 2.2], [11.9, 0.16, 2.9], [10.9, 0.08, 2.6]], 0.08, 1);
  }
}

// Beyond the street: the woods on every side, the water tower and the
// laboratory behind the house, the town's sign and the pumpkin patch at
// either end of the rows and, by night, the gate open in the trees.
function decor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const oaks = [
    [-11, -5.5, 4.6], [-12.6, -1.5, 5.4], [-10.9, 5.4, 4.2], [-12.4, 7.2, 5], [-10.9, 9.9, 4.4],
    [11.2, -4.6, 5], [12.8, -0.4, 4.4], [13.2, 4.2, 5.6], [12.9, 8.6, 4.6], [11, 10.6, 4.2],
    [-7.5, -9.2, 5.8], [-2.6, -10.6, 6.4], [1.4, -11.6, 6], [8.2, -9.4, 5.2], [-11.2, -10.2, 6],
    [-14.2, 2.2, 5.6], [14.4, 1.6, 5.2], [-9.2, -7.6, 4.4],
  ];
  oaks.forEach(([x, z, height], i) => tree(kit, group, x, z, height, i));
  const pines = [
    [-13.4, -3.6, 5.6], [-13.6, 5, 6.2], [-14.8, 8.8, 6.6], [13.6, -3, 6], [14.6, 6.4, 6.4], [14, 10.4, 5.6],
    [-9.4, -11.6, 6.8], [-0.4, -13, 7], [3.2, -13.4, 6.6], [12.6, -9.8, 6.2], [-13.8, -8.2, 6.4],
  ];
  pines.forEach(([x, z, height], i) => pine(kit, group, x, z, height, i));
  waterTower(kit, group);
  laboratory(kit, group);
  welcomeSign(kit, group);
  patch(kit, group);
  const rail = kit.mat('wood', { rough: 0.95 });
  for (let z = -1.4; z <= 0.3; z += 1.7) part(group, kit, 'box', rail, [-9.9, 0.3, z], [0.07, 0.6, 0.07]);
  for (let z = 4.2; z <= 9.4; z += 1.7) part(group, kit, 'box', rail, [-9.9, 0.3, z], [0.07, 0.6, 0.07]);
  for (const y of [0.22, 0.44]) {
    part(group, kit, 'box', rail, [-9.9, y, -0.55], [0.04, 0.06, 1.9]);
    part(group, kit, 'box', rail, [-9.9, y, 6.75], [0.04, 0.06, 5.3]);
  }
  kit.shadows(group);
  if (dark) {
    const lit = new Group();
    gate(kit, lit);
    vine(kit, lit, [[-13.6, 0.05, 0.6], [-12.2, 0.22, 1.2], [-11, 0.1, 0.4], [-9.9, 0.05, 0.9]], 0.11);
    vine(kit, lit, [[-13, 0.05, 8.4], [-11.8, 0.2, 7.6], [-10.6, 0.08, 8.2]], 0.09, 1);
    vine(kit, lit, [[13.6, 0.05, -2.4], [12.2, 0.2, -1.6], [11, 0.1, -2.2], [10, 0.05, -1.8]], 0.1);
    vine(kit, lit, [[-6.4, 0.05, -10.4], [-5, 0.24, -9], [-3.6, 0.1, -8.2], [-3, 0.05, -7.3]], 0.1, 1);
    group.add(lit);
  }
  return group;
}

// By night spores rise through the street; by day leaves come down across it.
function weather(kit) {
  if (kit.reducedMotion) return null;
  const dark = kit.mode === 'dark';
  const count = dark ? 120 : 46;
  const geometry = dark ? new SphereGeometry(1, 5, 4) : new PlaneGeometry(0.13, 0.085);
  const material = kit.basic('#ffffff', { opacity: dark ? 0.75 : 0.95, doubleSide: true });
  const flock = new InstancedMesh(geometry, material, count);
  flock.frustumCulled = false;
  const drift = Array.from({ length: count }, (_, index) => {
    flock.setColorAt(index, kit.color(dark ? 'spore' : LEAVES[index % 3]));
    return {
      x: (seeded(index) - 0.5) * 26, z: -9 + seeded(index + 50) * 20,
      phase: seeded(index + 100), speed: 0.04 + seeded(index + 150) * 0.06,
      size: dark ? 0.018 + seeded(index + 250) * 0.03 : 0.8 + seeded(index + 250) * 0.5,
    };
  });
  const piece = new Object3D();
  return {
    object: flock,
    frame(time) {
      drift.forEach((one, index) => {
        const along = (one.phase + time * one.speed) % 1;
        piece.position.set(one.x + Math.sin(time * 0.6 + one.phase * 9) * 0.6, (dark ? along : 1 - along) * 6.5 + 0.1, one.z);
        if (dark) piece.rotation.set(0, 0, 0);
        else piece.rotation.set(time * 1.4 + one.phase * 6, time * 0.9, one.phase * 3);
        // Each piece shrinks to nothing at either end of its trip, so none pops in or out.
        piece.scale.setScalar(one.size * Math.sin(along * Math.PI) ** 0.5);
        piece.updateMatrix();
        flock.setMatrixAt(index, piece.matrix);
      });
      flock.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      flock.dispose();
    },
  };
}

// The four bulbs take turns being the bright one, each falters now and then,
// and all of them surge for a moment after the house's react. The street
// lamps and the arcade's sign falter with them, what glows red breathes, and
// the mailbox flag stands for a few seconds after a job comes home.
function frame(time, dt, kit) {
  const st = town(kit);
  const still = kit.reducedMotion;
  const dark = kit.mode === 'dark';
  const rest = dark ? 1.5 : 0.5;
  const surge = Math.max(0, 1 - (time - st.surgeAt) / SURGE_SECONDS);
  const falters = turn => !still && Math.sin(time * 7.3 + turn * 2.1) * Math.sin(time * 1.3 + turn) > 0.8;
  for (let turn = 0; turn < BULBS.length; turn++) {
    const bulb = kit.materials.get('upside-down-bulb:' + turn);
    if (!bulb) continue;
    const lead = still || Math.floor(time * 1.6) % BULBS.length !== turn ? 0.5 : 1;
    bulb.emissiveIntensity = still ? rest : rest * lead * (falters(turn) ? 0.15 : 1) + surge * 2.4;
  }
  const dim = falters(5) ? 0.35 : 1;
  const sodium = kit.materials.get('upside-down-sodium');
  if (sodium && dark) sodium.emissiveIntensity = 2 * dim;
  const neon = kit.materials.get('upside-down-sign:arcade');
  if (neon) neon.emissiveIntensity = (dark ? 2.2 : 1.1) * (falters(9) ? 0.3 : 1);
  const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.9);
  const ember = kit.materials.get('upside-down-ember');
  if (ember) ember.emissiveIntensity = (dark ? 0.9 : 0.5) + breath * (dark ? 0.9 : 0.3);
  for (const glow of st.glows) glow.material.opacity = glow.lamp ? glow.base * dim : glow.base + glow.swell * (breath - 0.5);
  if (st.flag) {
    const up = time - st.flagAt < FLAG_SECONDS ? 1 : 0;
    st.flagUp = still ? up : st.flagUp + (up - st.flagUp) * (1 - Math.exp(-dt * 8));
    st.flag.rotation.x = (1 - st.flagUp) * Math.PI / 2;
  }
}

export default {
  palette: PALETTE, backdrop: BACKDROP, layout, view,
  floor, hall, dock, station, pad, ghost, crate, carrier, packet, decor, weather, frame,
};
