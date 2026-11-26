// Swamp's Factory floor: the bog brewery by moonlight and lantern light. A
// crooked witch-hatted brew-hut on stilts wraps a great bubbling cauldron,
// finished jobs ride home on a hopping frog's back up a lantern-lit trail of
// lily pads and sunken logs, and bog folk work their trades on mud islets in
// matt, murky water under cypresses and mist. Also serves as the fallback
// Factory skin.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, ConeGeometry,
  CylinderGeometry, Group, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, NormalBlending, PlaneGeometry, RingGeometry, SRGBColorSpace, SphereGeometry, Sprite,
  SpriteMaterial, TorusGeometry, Vector2, Vector3,
} from 'three';

const PALETTE = {
  light: {
    ground: '#566b52', horizon: '#c3d0bf', zenith: '#e3eadc',
    line: '#5c4a35', aisle: '#8a7553', body: '#7d5c3e', trim: '#4a3726', roof: '#62803a',
    accent: '#7ea64b', worker: '#688a43', busy: '#e0a52a', ok: '#4f9a35', fail: '#c8423a', idle: '#8a928b',
    crate: '#b0834d', tape: '#4d3b28', smoke: '#d6ded2', glow: '#a6e05a', window: '#f6cf74', door: '#241c15',
    sky: '#eef3e6', sun: '#fff0d0',
    lily: '#5f9a3a', lilyVein: '#4a7d2c', lotus: '#f2c4d4', reed: '#8a7840', cattail: '#5a3b22',
    tusk: '#ede6d1', iron: '#3a3f3c', cauldron: '#74d83a', sludge: '#9a4ed0', ember: '#ff8a2a',
    mud: '#6e5438', mudWet: '#45382a', moss: '#6a9238', stone: '#7a8278', copper: '#c87a40',
    frog: '#5ea83a', toad: '#94824a', belly: '#e6edb4', sac: '#f4e6a4', gold: '#f4ca59', pupil: '#151912',
    goblin: '#8aa64c', orc: '#5f8a3a', newt: '#e2782c', snail: '#c2aec0', shell: '#b06a38',
    crow: '#2c2c34', beak: '#d0a84a', cloth: '#6d4a72', leather: '#5e3e24', paper: '#f4ecd6',
    mushroom: '#cc4a3a', spore: '#f0ffb0', glass: '#d8f0e8', fish: '#9fbccb', brick: '#a55e3c',
    ripple: '#e8f2dc', wisp: '#5fcfb8', firefly: '#d49a1c',
    sunIntensity: 2.4, skyIntensity: 1.4, envIntensity: 0.55, exposure: 1.02, fogNear: 0, fogSpan: 19,
  },
  dark: {
    ground: '#08110c', horizon: '#10261c', zenith: '#0c1412',
    line: '#3a2f23', aisle: '#65513b', body: '#5e4533', trim: '#35281d', roof: '#4a6a2e',
    accent: '#b9e46a', worker: '#78a24c', busy: '#f0c050', ok: '#9dd86b', fail: '#ff6f6f', idle: '#5e6962',
    crate: '#9e7445', tape: '#3f3021', smoke: '#7f8e84', glow: '#c4ff7c', window: '#ffc266', door: '#0d0a08',
    sky: '#86a894', sun: '#cfe0ff',
    lily: '#4d8230', lilyVein: '#3a6624', lotus: '#e8a8c0', reed: '#6a5e36', cattail: '#45301c',
    tusk: '#dcd4bc', iron: '#2c3130', cauldron: '#7dff3c', sludge: '#c070ff', ember: '#ff9a3a',
    mud: '#52402c', mudWet: '#30261b', moss: '#4f7a32', stone: '#59615a', copper: '#c07040',
    frog: '#56a032', toad: '#7a6c3e', belly: '#d2dca2', sac: '#f2e4a2', gold: '#f4c24f', pupil: '#0c0e0a',
    goblin: '#7a9842', orc: '#527a32', newt: '#e8742a', snail: '#a896ac', shell: '#9a5e34',
    crow: '#202028', beak: '#c09a44', cloth: '#5e4066', leather: '#4a321e', paper: '#ece2c6',
    mushroom: '#c84c3e', spore: '#dcff8a', glass: '#c4ece0', fish: '#90aebd', brick: '#86503a',
    ripple: '#c4ff7c', wisp: '#9dfce0', firefly: '#ffd76a',
    sunIntensity: 2.0, skyIntensity: 1.2, envIntensity: 0.6, exposure: 1.04, fogNear: 0, fogSpan: 18,
  },
};

const BACKDROP = {
  light: 'radial-gradient(ellipse 55% 32% at 30% 14%, rgba(255, 249, 222, 0.85) 0%, transparent 72%), '
    + 'linear-gradient(180deg, #e4eadb 0%, #d4ddcc 30%, #c3d0bf 48%, #8fa58f 70%, #55705f 100%)',
  dark: 'radial-gradient(circle at 76% 13%, #e9f3d8 0 1.6%, rgba(200, 236, 180, 0.28) 2.1%, transparent 13%), '
    + 'radial-gradient(ellipse 70% 30% at 50% 40%, rgba(120, 190, 120, 0.16) 0%, transparent 70%), '
    + 'linear-gradient(180deg, #0a1210 0%, #10201a 32%, #1e3029 50%, #142219 72%, #12201a 100%)',
};

const TAU = Math.PI * 2;
const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const ease = t => t * t * (3 - 2 * t);
const overshoot = t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
const seeded = index => {
  const x = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const skinCache = new WeakMap();
function memo(kit, key, build) {
  let bag = skinCache.get(kit);
  if (!bag) {
    bag = {};
    skinCache.set(kit, bag);
  }
  return (bag[key] ||= build());
}

const POT_PROFILE = [[0, 0], [0.5, 0.02], [0.8, 0.14], [0.96, 0.36], [1, 0.56], [0.95, 0.78], [0.88, 0.92], [0.9, 0.97], [0.95, 1]];

// Unit shapes shared by every station; each part scales one.
const SHAPES = {
  ball: () => new SphereGeometry(1, 12, 9),
  bead: () => new SphereGeometry(1, 7, 5),
  rod: () => new CylinderGeometry(1, 1, 1, 8),
  taper: () => new CylinderGeometry(0.6, 1, 1, 8),
  cone: () => new ConeGeometry(1, 1, 8),
  block: () => new BoxGeometry(1, 1, 1),
  disc: () => new CylinderGeometry(1, 1, 1, 20),
  pad: () => new CylinderGeometry(1, 1, 1, 20, 1, false, 0.32, TAU - 0.64),
  ring: () => new TorusGeometry(1, 0.2, 6, 20),
  ripple: () => new RingGeometry(0.9, 1, 36).rotateX(-Math.PI / 2),
  pot: () => new LatheGeometry(POT_PROFILE.map(([r, y]) => new Vector2(r, y)), 14),
  mound: () => {
    const geometry = new CylinderGeometry(0.84, 1, 1, 13, 1);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
      position.setXYZ(i, x * k, position.getY(i), z * k);
    }
    geometry.computeVertexNormals();
    return geometry;
  },
};

function put(parent, kit, name, material, x, y, z, sx, sy = sx, sz = sx) {
  const mesh = new Mesh(memo(kit, `shape:${name}`, SHAPES[name]), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  parent.add(mesh);
  return mesh;
}

function pivot(parent, x, y, z) {
  const group = new Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

// Tiny parts skip the shadow pass: 24 stations of them would double the draw calls.
function shade(kit, object) {
  if (kit.software) return object;
  object.traverse(child => {
    if (!child.isMesh || child.material?.transparent) return;
    const { x, y, z } = child.scale;
    child.castShadow = Math.max(x, y, z) >= 0.09;
    child.receiveShadow = true;
  });
  return object;
}

// The still parts under `parts`, drawn as one mesh for each material and
// shadow setting they share, each laid where it stood: the bog's dressing is
// well over a thousand small parts, and drawn one by one they would cost a
// draw call each. Shapes are shared through memo, so each part is copied and
// the shared one kept. A see-through part keeps its own mesh so it still sorts
// where it stands, unless it is a flat decal (userData.decal) lying on the
// water, which draws the same either way. Sprites keep their own too.
function bake(parts) {
  parts.updateMatrixWorld(true);
  const from = new Matrix4().copy(parts.matrixWorld).invert();
  const sets = new Map();
  const alone = [];
  parts.traverse(node => {
    if (!node.isMesh && !node.isSprite) return;
    const place = new Matrix4().multiplyMatrices(from, node.matrixWorld);
    if (node.isSprite || (node.material.transparent && !node.userData.decal)) {
      alone.push([node, place]);
      return;
    }
    const names = Object.keys(node.geometry.attributes).sort().join();
    const key = [node.material.uuid, names, node.castShadow, node.receiveShadow, node.renderOrder].join('|');
    if (!sets.has(key)) sets.set(key, { first: node, pieces: [] });
    const piece = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    sets.get(key).pieces.push(piece.applyMatrix4(place));
  });
  const baked = new Group();
  for (const [node, place] of alone) {
    place.decompose(node.position, node.quaternion, node.scale);
    baked.add(node);
  }
  for (const { first, pieces } of sets.values()) {
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
    const mesh = new Mesh(geometry, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    baked.add(mesh);
  }
  return baked;
}

function mats(kit) {
  return memo(kit, 'mats', () => ({
    wood: kit.mat('trim', { rough: 0.9, flat: true }),
    plank: kit.mat('body', { rough: 0.88 }),
    iron: kit.mat('iron', { rough: 0.42, metal: 0.6 }),
    pot: kit.mat('iron', { rough: 0.42, metal: 0.6, doubleSide: true }),
    brew: kit.mat('cauldron', { emissive: 'cauldron', glow: kit.mode === 'dark' ? 0.7 : 0.45, rough: 0.25 }),
    froth: kit.mat('glow', { emissive: 'cauldron', glow: kit.mode === 'dark' ? 0.8 : 0.4, rough: 0.2 }),
    sludge: kit.mat('sludge', { emissive: 'sludge', glow: 0.75, rough: 0.2 }),
    ember: kit.mat('ember', { emissive: 'ember', glow: 1.8, rough: 0.5 }),
    mud: kit.mat('mud', { rough: 0.96, flat: true }),
    wet: kit.mat('mudWet', { rough: 0.35, metal: 0.12 }),
    moss: kit.mat('moss', { rough: 0.95, flat: true }),
    stone: kit.mat('stone', { rough: 0.95, flat: true }),
    copper: kit.mat('copper', { rough: 0.3, metal: 0.78 }),
    bone: kit.mat('tusk', { rough: 0.5 }),
    lily: kit.mat('lily', { rough: 0.5 }),
    lotus: kit.mat('lotus', { rough: 0.5 }),
    reed: kit.mat('reed', { rough: 0.9 }),
    cattail: kit.mat('cattail', { rough: 0.95 }),
    cloth: kit.mat('cloth', { rough: 0.85 }),
    leather: kit.mat('leather', { rough: 0.8 }),
    paper: kit.mat('paper', { rough: 0.9 }),
    gold: kit.mat('gold', { rough: 0.25, metal: 0.4, emissive: 'gold', glow: 0.3 }),
    pupil: kit.mat('pupil', { rough: 0.2 }),
    lantern: kit.mat('glow', { emissive: 'glow', glow: 1.6, rough: 0.3 }),
    spore: kit.mat('spore', { emissive: 'spore', glow: kit.mode === 'dark' ? 1.1 : 0.35, rough: 0.4 }),
    cap: kit.mat('mushroom', { rough: 0.55 }),
    glass: kit.mat('glass', { rough: 0.08, metal: 0.1, opacity: 0.3 }),
    brick: kit.mat('brick', { rough: 0.95, flat: true }),
    ripple: kit.basic('ripple', { opacity: kit.mode === 'dark' ? 0.16 : 0.3 }),
  }));
}

// ---------- the cast ----------

function frogFigure(kit, skinKey = 'frog', size = 1) {
  const m = mats(kit);
  const skin = kit.mat(skinKey, { rough: 0.48 });
  const belly = kit.mat('belly', { rough: 0.6 });
  const sacMat = kit.mat('sac', { rough: 0.32 });
  const root = new Group();
  root.scale.setScalar(size);
  const body = pivot(root, 0, 0, 0);
  for (const side of [-1, 1]) {
    put(root, kit, 'ball', skin, side * 0.17, 0.12, -0.04, 0.13, 0.12, 0.2);
    put(root, kit, 'ball', skin, side * 0.2, 0.025, 0.14, 0.1, 0.03, 0.14);
  }
  put(body, kit, 'ball', skin, 0, 0.3, 0, 0.24, 0.26, 0.21);
  put(body, kit, 'ball', belly, 0, 0.27, 0.075, 0.18, 0.2, 0.15);
  if (skinKey === 'toad') {
    for (const [x, y, z] of [[-0.12, 0.38, -0.12], [0.1, 0.42, -0.14], [0.16, 0.3, -0.12], [-0.06, 0.24, -0.17]]) {
      put(body, kit, 'bead', m.mud, x, y, z, 0.035);
    }
  }
  const head = pivot(body, 0, 0.53, 0.02);
  put(head, kit, 'ball', skin, 0, 0, 0, 0.26, 0.16, 0.22);
  const eyes = [];
  for (const side of [-1, 1]) {
    put(head, kit, 'ball', skin, side * 0.12, 0.11, 0.05, 0.085);
    eyes.push(put(head, kit, 'ball', m.gold, side * 0.125, 0.125, 0.1, 0.062));
    put(head, kit, 'bead', m.pupil, side * 0.13, 0.13, 0.155, 0.032, 0.018, 0.015);
  }
  put(head, kit, 'block', m.pupil, 0, -0.04, 0.198, 0.17, 0.012, 0.02);
  const sac = put(head, kit, 'ball', sacMat, 0, -0.1, 0.11, 0.09, 0.07, 0.08);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * 0.2, 0.4, 0.06);
    put(arm, kit, 'rod', skin, 0, -0.11, 0, 0.04, 0.22, 0.04);
    put(arm, kit, 'ball', skin, 0, -0.23, 0.01, 0.055, 0.03, 0.065);
    arms.push(arm);
  }
  return { root, body, head, sac, arms, eyes };
}

function goblinFigure(kit, size = 1) {
  const m = mats(kit);
  const skin = kit.mat('goblin', { rough: 0.6 });
  const eye = kit.mat('busy', { emissive: 'busy', glow: 0.9, rough: 0.3 });
  const root = new Group();
  root.scale.setScalar(size);
  for (const side of [-1, 1]) {
    put(root, kit, 'rod', m.leather, side * 0.08, 0.15, 0, 0.045, 0.3, 0.045);
    put(root, kit, 'ball', m.leather, side * 0.08, 0.02, 0.04, 0.06, 0.03, 0.09);
  }
  const body = pivot(root, 0, 0.28, 0);
  put(body, kit, 'taper', m.cloth, 0, 0.17, 0, 0.17, 0.36, 0.14);
  put(body, kit, 'block', m.leather, 0, 0.05, 0, 0.3, 0.05, 0.24);
  const head = pivot(body, 0, 0.47, 0.02);
  put(head, kit, 'ball', skin, 0, 0, 0, 0.16, 0.15, 0.15);
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = pivot(head, side * 0.14, 0.03, -0.02);
    put(ear, kit, 'cone', skin, side * 0.1, 0, 0, 0.05, 0.22, 0.03).rotation.z = -side * Math.PI / 2;
    ear.rotation.z = side * 0.25;
    ears.push(ear);
    put(head, kit, 'bead', eye, side * 0.06, 0.04, 0.135, 0.028);
  }
  put(head, kit, 'cone', skin, 0, -0.01, 0.2, 0.035, 0.13, 0.035).rotation.x = Math.PI / 2;
  const hat = put(head, kit, 'cone', m.cloth, 0.02, 0.17, -0.02, 0.13, 0.26, 0.13);
  hat.rotation.z = -0.4;
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * 0.19, 0.36, 0);
    put(arm, kit, 'rod', skin, 0, -0.15, 0, 0.035, 0.3, 0.035);
    put(arm, kit, 'ball', skin, 0, -0.31, 0, 0.045);
    arms.push(arm);
  }
  return { root, body, head, ears, arms };
}

function orcFigure(kit, size = 1) {
  const m = mats(kit);
  const skin = kit.mat('orc', { rough: 0.62 });
  const root = new Group();
  root.scale.setScalar(size);
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = pivot(root, side * 0.11, 0.38, 0);
    put(leg, kit, 'rod', m.leather, 0, -0.19, 0, 0.075, 0.38, 0.075);
    put(leg, kit, 'ball', m.leather, 0, -0.37, 0.05, 0.08, 0.04, 0.12);
    legs.push(leg);
  }
  const body = pivot(root, 0, 0.38, 0);
  put(body, kit, 'ball', skin, 0, 0.25, 0, 0.28, 0.3, 0.22);
  put(body, kit, 'rod', m.leather, 0, 0.06, 0, 0.25, 0.08, 0.2);
  put(body, kit, 'block', m.gold, 0, 0.06, 0.2, 0.08, 0.06, 0.02);
  const head = pivot(body, 0, 0.58, 0.06);
  put(head, kit, 'ball', skin, 0, 0, 0, 0.16, 0.16, 0.16);
  put(head, kit, 'ball', skin, 0, -0.07, 0.07, 0.13, 0.08, 0.1);
  for (const side of [-1, 1]) {
    put(head, kit, 'cone', m.bone, side * 0.06, -0.02, 0.15, 0.02, 0.07, 0.02);
    put(head, kit, 'bead', m.pupil, side * 0.06, 0.04, 0.145, 0.022);
    put(head, kit, 'cone', skin, side * 0.16, 0.03, -0.01, 0.035, 0.1, 0.025).rotation.z = -side * 1.3;
  }
  put(head, kit, 'cone', m.pupil, 0, 0.19, -0.03, 0.05, 0.12, 0.05);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * 0.29, 0.42, 0);
    put(arm, kit, 'rod', skin, 0, -0.18, 0, 0.065, 0.36, 0.065);
    put(arm, kit, 'ball', skin, 0, -0.37, 0, 0.075);
    arms.push(arm);
  }
  return { root, body, head, arms, legs };
}

function newtFigure(kit, size = 1) {
  const m = mats(kit);
  const skin = kit.mat('newt', { rough: 0.42 });
  const root = new Group();
  root.scale.setScalar(size);
  for (const [z, y, s] of [[-0.14, 0.06, 0.09], [-0.3, 0.04, 0.07], [-0.44, 0.03, 0.05], [-0.55, 0.025, 0.035]]) {
    put(root, kit, 'ball', skin, 0, y, z, s, s * 0.7, s * 1.5);
  }
  for (const side of [-1, 1]) put(root, kit, 'ball', skin, side * 0.08, 0.05, 0.03, 0.06, 0.06, 0.09);
  const body = pivot(root, 0, 0.06, 0);
  put(body, kit, 'ball', skin, 0, 0.24, 0, 0.14, 0.24, 0.13);
  put(body, kit, 'block', m.leather, 0, 0.22, 0.1, 0.18, 0.28, 0.04);
  for (const [x, y] of [[-0.09, 0.36], [0.1, 0.3], [-0.05, 0.16]]) put(body, kit, 'bead', m.pupil, x, y, -0.11, 0.025);
  const head = pivot(body, 0, 0.5, 0.03);
  put(head, kit, 'ball', skin, 0, 0, 0.03, 0.15, 0.1, 0.17);
  for (const side of [-1, 1]) put(head, kit, 'bead', m.pupil, side * 0.1, 0.06, 0.08, 0.03);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = pivot(body, side * 0.13, 0.36, 0.02);
    put(arm, kit, 'rod', skin, 0, -0.12, 0, 0.03, 0.24, 0.03);
    put(arm, kit, 'ball', skin, 0, -0.25, 0, 0.04);
    arms.push(arm);
  }
  return { root, body, head, arms };
}

function sproutFigure(kit, size = 1) {
  const m = mats(kit);
  const eye = kit.mat('glow', { emissive: 'glow', glow: 1.4, rough: 0.3 });
  const root = new Group();
  root.scale.setScalar(size);
  const body = pivot(root, 0, 0, 0);
  put(body, kit, 'cone', m.cloth, 0, 0.22, 0, 0.17, 0.44, 0.16);
  put(body, kit, 'ball', m.pupil, 0, 0.36, 0.06, 0.08, 0.075, 0.06);
  for (const side of [-1, 1]) put(body, kit, 'bead', eye, side * 0.035, 0.37, 0.115, 0.018);
  put(body, kit, 'ball', m.moss, 0.02, 0.43, -0.03, 0.07, 0.04, 0.07);
  const arm = pivot(body, 0.12, 0.28, 0.04);
  put(arm, kit, 'rod', m.cloth, 0, -0.07, 0, 0.03, 0.14, 0.03);
  return { root, body, arm };
}

function snailFigure(kit, size = 1) {
  const m = mats(kit);
  const skin = kit.mat('snail', { rough: 0.3, metal: 0.05 });
  const shellMat = kit.mat('shell', { rough: 0.55 });
  const root = new Group();
  root.scale.setScalar(size);
  const foot = pivot(root, 0, 0, 0);
  put(foot, kit, 'ball', skin, 0, 0.06, 0.02, 0.11, 0.06, 0.32);
  const neck = pivot(foot, 0, 0.08, 0.24);
  put(neck, kit, 'ball', skin, 0, 0.1, 0.02, 0.08, 0.12, 0.08);
  const stalks = [];
  for (const side of [-1, 1]) {
    const stalk = pivot(neck, side * 0.035, 0.19, 0.04);
    put(stalk, kit, 'rod', skin, 0, 0.07, 0, 0.012, 0.14, 0.012);
    put(stalk, kit, 'ball', skin, 0, 0.15, 0, 0.026);
    put(stalk, kit, 'bead', m.pupil, 0, 0.155, 0.02, 0.013);
    stalk.rotation.z = side * 0.25;
    stalks.push(stalk);
  }
  const shell = pivot(root, 0, 0.25, -0.04);
  const whorl = put(shell, kit, 'ring', shellMat, 0, 0, 0, 0.14, 0.14, 0.2);
  whorl.rotation.y = Math.PI / 2;
  put(shell, kit, 'ball', shellMat, 0, 0, 0, 0.1, 0.12, 0.12);
  put(shell, kit, 'ball', kit.mat('cattail', { rough: 0.6 }), 0.06, 0.02, 0.01, 0.04, 0.05, 0.05);
  put(shell, kit, 'ring', m.leather, 0, 0, 0, 0.11, 0.11, 0.17).rotation.set(0, 0, 0.5);
  const satchel = pivot(shell, -0.16, -0.06, 0);
  put(satchel, kit, 'block', m.leather, 0, 0, 0, 0.06, 0.13, 0.16);
  put(satchel, kit, 'block', m.leather, -0.012, 0.06, 0, 0.065, 0.03, 0.17);
  const letter = put(satchel, kit, 'block', m.paper, 0.005, 0.09, 0.03, 0.02, 0.1, 0.09);
  return { root, foot, neck, stalks, shell, letter };
}

function crowFigure(kit, size = 1) {
  const m = mats(kit);
  const feather = kit.mat('crow', { rough: 0.35, metal: 0.15 });
  const beak = kit.mat('beak', { rough: 0.45 });
  const root = new Group();
  root.scale.setScalar(size);
  const body = pivot(root, 0, 0.09, 0);
  put(body, kit, 'ball', feather, 0, 0.02, 0, 0.1, 0.11, 0.16).rotation.x = -0.35;
  const tail = put(body, kit, 'block', feather, 0, -0.03, -0.17, 0.08, 0.02, 0.14);
  tail.rotation.x = 0.4;
  const head = pivot(body, 0, 0.12, 0.08);
  put(head, kit, 'ball', feather, 0, 0, 0, 0.075);
  put(head, kit, 'cone', beak, 0, -0.01, 0.1, 0.025, 0.09, 0.022).rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) put(head, kit, 'bead', kit.mat('paper', { rough: 0.2 }), side * 0.045, 0.02, 0.05, 0.016);
  const coin = put(head, kit, 'rod', m.gold, 0, -0.02, 0.15, 0.035, 0.008, 0.035);
  coin.rotation.x = Math.PI / 2;
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = pivot(body, side * 0.08, 0.06, 0);
    put(wing, kit, 'ball', feather, side * 0.03, -0.03, -0.03, 0.03, 0.08, 0.15).rotation.x = -0.3;
    wings.push(wing);
    put(root, kit, 'rod', beak, side * 0.035, 0.03, 0.02, 0.008, 0.07, 0.008);
  }
  return { root, body, head, wings, coin };
}

// ---------- station scenery ----------

function islet(kit, station, w, d, seed) {
  const m = mats(kit);
  const e = extra(kit);
  const group = new Group();
  group.add(kit.shadow(w * 3.0, d * 3.0, kit.mode === 'dark' ? 0.5 : 0.3, [0, 0.008, 0]));
  const shore = memo(kit, 'shape:shore', () => new RingGeometry(0.975, 1, 40).rotateX(-Math.PI / 2));
  for (const [k, y] of [[1.2, 0.012], [1.42, 0.011]]) {
    const ring = new Mesh(shore, e.foam);
    ring.position.y = y;
    ring.scale.set(w * k, 1, d * k);
    group.add(ring);
  }
  put(group, kit, 'disc', m.wet, 0, 0.01, 0, w * 1.07, 0.02, d * 1.07);
  const mound = put(group, kit, 'mound', m.mud, 0, 0.1, 0, w, 0.2, d);
  mound.rotation.y = (seed % 2) * Math.PI;
  put(group, kit, 'ball', m.moss, 0.04, 0.18, 0.02, w * 0.84, 0.05, d * 0.8);
  for (let i = 0; i < 9; i += 1) {
    const a = seeded(seed * 7 + i) * TAU;
    const tall = 0.16 + seeded(seed * 5 + i) * 0.16;
    const tuft = put(group, kit, 'cone', i % 2 ? e.grass : m.moss, Math.cos(a) * w * 0.8, 0.17 + tall / 2, Math.sin(a) * d * 0.76, 0.035, tall, 0.035);
    tuft.rotation.z = (seeded(seed * 3 + i) - 0.5) * 0.7;
  }
  for (let i = 0; i < 3; i += 1) {
    const a = seeded(seed * 13 + i) * TAU;
    const s = 0.09 + seeded(seed * 17 + i) * 0.08;
    put(group, kit, 'ball', m.stone, Math.cos(a) * w * 1.02, 0.05, Math.sin(a) * d * 1.0, s, s * 0.55, s * 0.8);
  }
  for (let i = 0; i < 2; i += 1) {
    const a = 2.2 + seed + i * 0.5;
    const x = Math.cos(a) * w * 0.86;
    const z = Math.sin(a) * d * 0.82;
    put(group, kit, 'rod', m.paper, x, 0.22, z, 0.012, 0.09, 0.012);
    put(group, kit, 'ball', e.shroom, x, 0.28, z, 0.04, 0.025, 0.04);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = seeded(seed * 19 + i) * TAU;
    lilyPad(kit, group, Math.cos(a) * w * 1.42, Math.sin(a) * d * 1.42, 0.13 + seeded(seed * 23 + i) * 0.08, a * 3);
  }
  station.add(bake(shade(kit, group)));
}

function reeds(kit, group, x, z, count, seed, tall = 1) {
  const m = mats(kit);
  for (let i = 0; i < count; i += 1) {
    const a = i * 2.3 + seed;
    const h = (0.55 + seeded(seed * 5 + i) * 0.4) * tall;
    const px = x + Math.cos(a) * 0.09;
    const pz = z + Math.sin(a) * 0.09;
    const stem = put(group, kit, 'rod', m.reed, px, 0.15 + h / 2, pz, 0.014, h, 0.014);
    stem.rotation.z = (seeded(seed + i * 9) - 0.5) * 0.3;
    if (i % 2 === 0) put(group, kit, 'rod', m.cattail, px - Math.sin(stem.rotation.z) * h * 0.4, 0.15 + h * 0.88, pz, 0.032, 0.14, 0.032);
  }
}

// A crooked stake with the state lamp hanging from its crook.
function lampPost(kit, group, lamp, x, z, height, radius) {
  const m = mats(kit);
  const post = put(group, kit, 'rod', m.wood, x, 0.15 + height / 2, z, 0.032, height, 0.032);
  post.rotation.z = -0.05;
  const top = 0.15 + height;
  const arm = put(group, kit, 'block', m.wood, x + 0.12, top - 0.02, z, 0.26, 0.035, 0.035);
  arm.rotation.z = 0.12;
  put(group, kit, 'rod', m.iron, x + 0.22, top - 0.08, z, 0.008, 0.1, 0.008);
  put(group, kit, 'cone', m.iron, x + 0.22, top - 0.13 + radius * 0.2, z, radius * 0.95, radius * 0.6, radius * 0.95);
  lamp.position.set(x + 0.22, top - 0.16 - radius * 0.55, z);
  lamp.scale.setScalar(radius);
  group.add(lamp);
  put(group, kit, 'ring', m.iron, x + 0.22, lamp.position.y - radius * 0.7, z, radius * 0.7, radius * 0.7, radius * 0.7).rotation.x = Math.PI / 2;
  return top;
}

function bottle(kit, parent, x, y, z, s = 1) {
  const m = mats(kit);
  const group = pivot(parent, x, y, z);
  group.scale.setScalar(s);
  put(group, kit, 'ball', m.brew, 0, 0.09, 0, 0.075, 0.09, 0.075);
  put(group, kit, 'rod', m.glass, 0, 0.09, 0, 0.085, 0.18, 0.085);
  put(group, kit, 'rod', m.brew, 0, 0.2, 0, 0.025, 0.06, 0.025);
  put(group, kit, 'rod', m.wood, 0, 0.245, 0, 0.03, 0.04, 0.03);
  return group;
}

// ---------- workers: the bog's trades ----------

function frogBrewer(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.92, 0.8, index);
  reeds(kit, group, -0.72, 0.3, 5, index + 1);
  const pot = pivot(group, 0.22, 0.2, 0.14);
  pot.scale.setScalar(1.2);
  for (const a of [0.4, 2.5, 4.4]) {
    put(pot, kit, 'rod', m.wood, Math.cos(a) * 0.12, 0.02, Math.sin(a) * 0.12, 0.03, 0.34, 0.03).rotation.set(Math.PI / 2, a, 0);
  }
  put(pot, kit, 'ball', m.ember, 0, 0.02, 0, 0.14, 0.05, 0.14);
  put(pot, kit, 'pot', m.pot, 0, 0.03, 0, 0.36, 0.44, 0.36);
  put(pot, kit, 'ring', m.iron, 0, 0.47, 0, 0.34, 0.34, 0.34).rotation.x = Math.PI / 2;
  const brew = put(pot, kit, 'disc', m.brew, 0, 0.43, 0, 0.31, 0.02, 0.31);
  const froth = [0, 1, 2].map(i => put(pot, kit, 'ball', m.froth, Math.cos(i * 2.1) * 0.15, 0.44, Math.sin(i * 2.1) * 0.15, 0.05));
  const boil = put(pot, kit, 'ball', m.sludge, 0, 0.45, 0, 0.35, 0.12, 0.35);
  const blobs = [0.3, 1.9, 3.6].map(a => put(pot, kit, 'ball', m.sludge, Math.cos(a) * 0.16, 0.56, Math.sin(a) * 0.16, 0.08));
  const drips = [-0.4, 0.3, 0.9, 1.6].map(a => put(pot, kit, 'ball', m.sludge, Math.cos(a) * 0.37, 0.3, Math.sin(a) * 0.37, 0.06, 0.17, 0.05));
  const puddle = put(group, kit, 'ball', m.sludge, 0.5, 0.19, 0.4, 0.34, 0.02, 0.24);

  const paddle = pivot(pot, 0, 0.43, 0);
  put(paddle, kit, 'rod', m.wood, 0, 0.36, 0, 0.022, 0.84, 0.022);
  put(paddle, kit, 'block', m.wood, 0, -0.04, 0, 0.09, 0.14, 0.025);
  put(paddle, kit, 'ball', m.moss, 0, 0.78, 0, 0.04);

  const frog = frogFigure(kit, index % 8 >= 4 ? 'toad' : 'frog', 1.45);
  frog.root.position.set(-0.44, 0.2, -0.08);
  frog.root.rotation.y = 1.2;
  group.add(frog.root);

  const product = pivot(group, 0.6, 0.2, -0.4);
  product.scale.setScalar(1.3);
  bottle(kit, product, 0, 0, 0);
  bottle(kit, product, 0.13, 0, 0.1, 0.85);
  bottle(kit, product, -0.08, 0, 0.14, 0.75);

  lampPost(kit, group, lamp, -0.66, -0.52, 1.5, 0.17);
  return {
    puff: new Vector3(0.22, 0.85, 0.14),
    labelY: 2.05,
    occupants: [frog.root],
    animate(time, run, done, fail) {
      const t = time * 3.4;
      paddle.rotation.z = 0.48 + Math.cos(t) * 0.16 * run + fail * 0.75;
      paddle.rotation.x = Math.sin(t) * 0.2 * run;
      frog.body.rotation.y = Math.sin(t) * 0.14 * run;
      frog.body.rotation.x = -0.35 * fail;
      for (const arm of frog.arms) {
        arm.rotation.x = -1.35 + Math.sin(t) * 0.18 * run - fail * 1.1;
        arm.rotation.z = 0;
      }
      for (let i = 0; i < froth.length; i += 1) {
        const k = 0.5 + 0.5 * Math.sin(time * 4 + i * 2.1);
        froth[i].scale.setScalar(0.02 + 0.05 * k * (0.35 + run * 0.65));
        froth[i].visible = fail < 0.2;
      }
      const croak = done >= 0 && done < 3 ? Math.abs(Math.sin(done * 5.2)) * (1 - done / 3) : 0;
      const rest = done < 0 ? 0 : clamp01(done / 0.5);
      frog.sac.scale.set(0.09 + croak * 0.14 + rest * 0.02, 0.07 + croak * 0.12 + rest * 0.015, 0.08 + croak * 0.12);
      product.visible = rest > 0;
      product.scale.setScalar(Math.max(0.001, overshoot(rest)));
      if (rest > 0) {
        frog.arms[1].rotation.x = -2.6;
        frog.arms[1].rotation.z = 0.2;
      }
      brew.visible = fail < 0.25;
      boil.visible = fail > 0;
      boil.scale.y = 0.04 + 0.14 * fail;
      for (let i = 0; i < blobs.length; i += 1) {
        const k = kit.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 3 + i * 2);
        blobs[i].visible = fail > 0.5;
        blobs[i].scale.setScalar(0.04 + 0.06 * k * fail);
      }
      for (const drip of drips) {
        drip.visible = fail > 0;
        drip.scale.y = Math.max(0.001, 0.17 * fail);
      }
      puddle.visible = fail > 0;
      puddle.scale.x = Math.max(0.001, 0.42 * fail);
      puddle.scale.z = Math.max(0.001, 0.3 * fail);
    },
  };
}

function goblinStill(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.94, 0.8, index + 3);
  reeds(kit, group, 0.62, -0.52, 4, index + 5);
  put(group, kit, 'block', m.stone, -0.05, 0.3, -0.12, 0.46, 0.22, 0.44);
  const fire = put(group, kit, 'block', m.ember, -0.05, 0.28, 0.1, 0.2, 0.1, 0.02);
  put(group, kit, 'ball', m.copper, -0.05, 0.6, -0.12, 0.27, 0.25, 0.27);
  put(group, kit, 'cone', m.copper, -0.05, 0.92, -0.12, 0.11, 0.32, 0.11);
  const cap = pivot(group, -0.05, 1.08, -0.12);
  put(cap, kit, 'ball', m.copper, 0, 0, 0, 0.065);
  const arm = put(cap, kit, 'rod', m.copper, 0.24, -0.06, 0, 0.02, 0.5, 0.02);
  arm.rotation.z = Math.PI / 2 + 0.25;
  const coil = pivot(group, 0.48, 0.24, -0.16);
  put(coil, kit, 'taper', m.wood, 0, 0.14, 0, 0.16, 0.3, 0.16);
  for (let i = 0; i < 4; i += 1) {
    const turn = put(coil, kit, 'ring', m.copper, 0, 0.36 + i * 0.09, 0, 0.13, 0.13, 0.13);
    turn.rotation.set(Math.PI / 2 + (i % 2 ? 0.12 : -0.12), 0, 0);
  }
  put(coil, kit, 'rod', m.copper, 0, 0.7, 0, 0.02, 0.12, 0.02);
  put(coil, kit, 'rod', m.copper, 0.12, 0.2, 0.08, 0.018, 0.1, 0.018).rotation.z = 1.2;
  const jug = pivot(group, 0.62, 0.2, 0.16);
  put(jug, kit, 'ball', kit.mat('stone', { rough: 0.7 }), 0, 0.1, 0, 0.1, 0.11, 0.1);
  put(jug, kit, 'rod', kit.mat('stone', { rough: 0.7 }), 0, 0.22, 0, 0.035, 0.06, 0.035);
  const fill = put(jug, kit, 'ball', m.brew, 0, 0.26, 0, 0.035, 0.02, 0.035);
  const drop = put(group, kit, 'bead', m.brew, 0.62, 0.3, 0.16, 0.022);
  const gush = put(group, kit, 'ball', m.sludge, -0.05, 1.12, -0.12, 0.09, 0.22, 0.09);
  const puddle = put(group, kit, 'ball', m.sludge, -0.1, 0.19, 0.4, 0.4, 0.02, 0.22);

  const bellows = pivot(group, -0.28, 0.24, 0.16);
  put(bellows, kit, 'block', m.wood, 0, 0, 0, 0.3, 0.02, 0.16);
  const flap = pivot(bellows, -0.15, 0.02, 0);
  put(flap, kit, 'block', m.wood, 0.15, 0.04, 0, 0.3, 0.02, 0.16);
  put(flap, kit, 'rod', m.wood, -0.02, 0.04, 0, 0.012, 0.12, 0.012).rotation.z = Math.PI / 2;
  const lung = put(bellows, kit, 'ball', m.leather, 0, 0.03, 0, 0.13, 0.03, 0.07);

  const goblin = goblinFigure(kit, 1.4);
  goblin.root.position.set(-0.62, 0.2, 0.22);
  goblin.root.rotation.y = 1.1;
  group.add(goblin.root);
  const mug = pivot(goblin.arms[1], 0, -0.36, 0.03);
  put(mug, kit, 'rod', m.wood, 0, 0.04, 0, 0.05, 0.1, 0.05);
  put(mug, kit, 'rod', m.froth, 0, 0.1, 0, 0.045, 0.02, 0.045);

  lampPost(kit, group, lamp, -0.68, -0.52, 1.5, 0.17);
  return {
    puff: new Vector3(0.48, 1.0, -0.16),
    labelY: 2.05,
    occupants: [goblin.root],
    animate(time, run, done, fail) {
      const t = time * 4.2;
      const pump = (0.5 + 0.5 * Math.sin(t)) * run;
      flap.rotation.z = -0.05 - pump * 0.32;
      lung.scale.y = 0.03 + pump * 0.07;
      fire.scale.y = 0.1 + 0.05 * Math.abs(Math.sin(time * 7)) * run;
      goblin.body.rotation.x = 0.25 * pump;
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const cheer = done >= 0 && done < 2.4 ? Math.abs(Math.sin(done * 6)) * (1 - done / 2.4) : 0;
      goblin.root.position.y = 0.2 + cheer * 0.12;
      goblin.arms[0].rotation.set(-0.9 - pump * 0.5 - fail * 1.9, 0, -0.3 * fail);
      goblin.arms[1].rotation.set(-0.9 - pump * 0.5 - rest * 1.9 - fail * 1.9 * (1 - rest), 0, 0.3 * fail);
      mug.visible = rest > 0;
      for (const ear of goblin.ears) ear.rotation.z = (ear.position.x > 0 ? 1 : -1) * (0.25 - fail * 0.75);
      const drip = (time * 1.6) % 1;
      drop.visible = run > 0.3 && fail === 0;
      drop.position.y = 0.36 - drip * 0.12;
      fill.scale.y = 0.02 + rest * 0.02;
      cap.position.set(-0.05 + fail * 0.6, 1.08 - fail * 0.86, -0.12 + fail * 0.62);
      cap.rotation.z = -fail * 2.2;
      gush.visible = fail > 0;
      gush.scale.y = Math.max(0.001, 0.22 * fail * (1 + 0.15 * Math.sin(time * 9) * (kit.reducedMotion ? 0 : 1)));
      puddle.visible = fail > 0;
      puddle.scale.x = Math.max(0.001, 0.4 * fail);
    },
  };
}

function orcGrinder(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.94, 0.82, index + 6);
  put(group, kit, 'rod', m.stone, 0, 0.3, 0, 0.3, 0.2, 0.3);
  const powder = put(group, kit, 'ball', m.paper, 0.26, 0.21, 0.18, 0.16, 0.05, 0.12);
  const carousel = pivot(group, 0, 0, 0);
  const stone = pivot(group, 0, 0.46, 0);
  put(stone, kit, 'rod', m.stone, 0, 0, 0, 0.27, 0.12, 0.27);
  put(stone, kit, 'block', m.wood, 0.18, 0, 0, 0.12, 0.13, 0.03);
  put(carousel, kit, 'rod', m.wood, 0, 0.62, 0, 0.03, 0.3, 0.03);
  const bar = put(carousel, kit, 'rod', m.wood, 0.3, 0.72, 0, 0.03, 0.62, 0.03);
  bar.rotation.z = Math.PI / 2;
  const orc = orcFigure(kit, 1.15);
  orc.root.position.set(0.56, 0.2, -0.14);
  orc.root.rotation.y = Math.PI;
  carousel.add(orc.root);
  const ring = [];
  for (let i = 0; i < 7; i += 1) {
    const a = 0.5 + i * 0.78;
    const x = Math.cos(a) * 0.86;
    const z = Math.sin(a) * 0.74;
    const shroom = pivot(group, x, 0.2, z);
    const s = 0.7 + seeded(index * 11 + i) * 0.6;
    put(shroom, kit, 'rod', m.paper, 0, 0.06 * s, 0, 0.022 * s, 0.12 * s, 0.022 * s);
    put(shroom, kit, 'ball', i % 3 === 0 ? m.spore : m.cap, 0, 0.12 * s, 0, 0.07 * s, 0.045 * s, 0.07 * s);
    if (i % 3 !== 0) put(shroom, kit, 'bead', m.paper, 0.03 * s, 0.155 * s, 0.02 * s, 0.014 * s);
    ring.push(shroom);
  }
  const sack = pivot(group, -0.45, 0.2, 0.42);
  put(sack, kit, 'ball', m.paper, 0, 0.14, 0, 0.13, 0.16, 0.11);
  put(sack, kit, 'rod', m.leather, 0, 0.29, 0, 0.04, 0.04, 0.04);
  put(sack, kit, 'cone', m.paper, 0, 0.33, 0, 0.05, 0.07, 0.05);
  lampPost(kit, group, lamp, -0.72, -0.44, 1.6, 0.17);
  let angle = index * 1.3;
  let last = null;
  return {
    puff: new Vector3(0, 0.75, 0),
    labelY: 2.15,
    occupants: [orc.root],
    animate(time, run, done, fail) {
      const dt = last === null ? 0 : Math.min(0.1, Math.max(0, time - last));
      last = time;
      if (fail === 0) angle += dt * run * 1.3;
      carousel.rotation.y = angle;
      stone.rotation.y = angle;
      const step = Math.sin(time * 7) * 0.45 * run;
      orc.legs[0].rotation.x = step;
      orc.legs[1].rotation.x = -step;
      orc.body.rotation.x = 0.28 * run;
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const flex = done >= 0 && done < 2.4 ? Math.sin(done * 7) * 0.25 * (1 - done / 2.4) : 0;
      for (let i = 0; i < 2; i += 1) {
        const side = i ? 1 : -1;
        orc.arms[i].rotation.x = -1.45 * (1 - rest) * (1 - fail) - fail * 0.3;
        orc.arms[i].rotation.z = side * (rest * (2.3 + flex) + fail * 0.5);
      }
      orc.root.position.y = 0.2 - fail * 0.22;
      orc.root.rotation.x = -fail * 0.35;
      sack.visible = rest > 0;
      sack.scale.setScalar(Math.max(0.001, overshoot(rest)));
      powder.scale.y = 0.05 + rest * 0.04;
      stone.position.set(fail * 0.32, 0.46 - fail * 0.24, fail * 0.3);
      stone.rotation.z = fail * 0.7;
      for (let i = 0; i < ring.length; i += 1) {
        ring[i].rotation.z = fail * (i % 2 ? 0.7 : -0.7);
        ring[i].position.y = 0.2 + (run > 0.05 ? Math.abs(Math.sin(time * 3 + i)) * 0.015 * run : 0);
      }
    },
  };
}

function newtKiln(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.92, 0.8, index + 9);
  reeds(kit, group, -0.75, -0.2, 4, index + 7, 1.2);
  const kiln = pivot(group, -0.18, 0.18, -0.06);
  put(kiln, kit, 'ball', bricks(kit), 0, 0, 0, 0.44, 0.52, 0.42);
  put(kiln, kit, 'block', kit.mat('door'), 0, 0.12, 0.38, 0.24, 0.26, 0.1);
  const mouth = put(kiln, kit, 'ball', m.ember, 0, 0.1, 0.36, 0.1, 0.08, 0.04);
  put(kiln, kit, 'rod', bricks(kit), -0.1, 0.6, -0.12, 0.08, 0.36, 0.08);
  const crack = put(kiln, kit, 'block', m.pupil, 0.15, 0.32, 0.28, 0.025, 0.3, 0.03);
  crack.rotation.z = 0.5;
  const chunk = put(group, kit, 'ball', bricks(kit), 0.4, 0.22, 0.45, 0.12, 0.08, 0.11);
  const stack = pivot(group, 0.5, 0.2, -0.42);
  const brickMat = m.brick;
  const fresh = [];
  for (let layer = 0; layer < 4; layer += 1) {
    for (let i = 0; i < 2; i += 1) {
      const b = put(stack, kit, 'block', brickMat, (i - 0.5) * 0.15 + (layer % 2) * 0.03, 0.035 + layer * 0.07, 0, 0.14, 0.06, 0.08);
      b.rotation.y = layer % 2 ? 0.1 : -0.06;
      if (layer >= 2) fresh.push(b);
    }
  }
  const peat = pivot(group, 0.62, 0.2, 0.12);
  for (let i = 0; i < 4; i += 1) put(peat, kit, 'ball', m.wet, (i % 2) * 0.09 - 0.04, 0.04 + Math.floor(i / 2) * 0.05, (i % 3) * 0.05, 0.07, 0.05, 0.06);
  const newt = newtFigure(kit, 1.45);
  newt.root.position.set(0.32, 0.2, 0.32);
  newt.root.rotation.y = -1.25;
  group.add(newt.root);
  const shovel = pivot(newt.arms[1], 0, -0.24, 0);
  put(shovel, kit, 'rod', m.wood, 0, 0, 0.12, 0.015, 0.5, 0.015).rotation.x = Math.PI / 2;
  put(shovel, kit, 'block', m.iron, 0, -0.02, 0.4, 0.12, 0.02, 0.14);
  lampPost(kit, group, lamp, -0.7, 0.42, 1.5, 0.17);
  return {
    puff: new Vector3(-0.28, 1.05, -0.18),
    labelY: 2.05,
    occupants: [newt.root],
    animate(time, run, done, fail) {
      const t = time * 3;
      const dig = (0.5 + 0.5 * Math.sin(t)) * run;
      newt.arms[0].rotation.x = -0.7 - dig * 0.6;
      newt.arms[1].rotation.x = -0.7 - dig * 0.6;
      newt.body.rotation.x = 0.35 * dig;
      mouth.scale.set(0.1, 0.08 + 0.04 * Math.abs(Math.sin(time * 6)) * run, 0.04);
      mouth.visible = fail < 0.3;
      const rest = done < 0 ? 0 : clamp01(done / 0.5);
      for (let i = 0; i < fresh.length; i += 1) {
        const k = clamp01(rest * 4 - i * 0.6);
        fresh[i].visible = k > 0;
        fresh[i].scale.set(0.14, Math.max(0.001, 0.06 * overshoot(k)), 0.08);
      }
      const cheer = done >= 0 && done < 2.4 ? Math.abs(Math.sin(done * 6)) * (1 - done / 2.4) : 0;
      newt.root.position.y = 0.2 + cheer * 0.1;
      if (rest > 0) {
        newt.arms[0].rotation.x = -2.8;
        newt.body.rotation.x = -0.1;
      }
      kiln.rotation.z = -0.22 * fail;
      kiln.position.x = -0.18 - 0.05 * fail;
      crack.visible = fail > 0;
      chunk.visible = fail > 0;
      chunk.position.y = 0.22 + (1 - fail) * 0.4;
      if (fail > 0) {
        newt.arms[0].rotation.x = -2.9 * fail;
        newt.arms[1].rotation.x = -2.9 * fail;
        newt.body.rotation.x = -0.2 * fail;
      }
    },
  };
}

function boards(kit) {
  return memo(kit, 'hutBoards', () => kit.painted((ctx, w, h) => {
    const dark = kit.mode === 'dark';
    ctx.fillStyle = dark ? '#4e3a2a' : '#7a5a3c';
    ctx.fillRect(0, 0, w, h);
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const x = (i * w) / count;
      ctx.fillStyle = `rgba(${dark ? '20, 14, 8' : '50, 32, 18'}, ${0.12 + seeded(i + 300) * 0.22})`;
      ctx.fillRect(x, 0, w / count, h);
      ctx.fillStyle = dark ? 'rgba(10, 6, 2, 0.75)' : 'rgba(40, 24, 12, 0.7)';
      ctx.fillRect(x, 0, 3, h);
      ctx.beginPath();
      ctx.ellipse(x + seeded(i + 320) * (w / count), seeded(i + 340) * h, 4, 7, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = dark ? 'rgba(90, 140, 60, 0.45)' : 'rgba(110, 160, 70, 0.5)';
    for (let i = 0; i < 22; i += 1) {
      ctx.beginPath();
      ctx.arc(seeded(i + 400) * w, h - seeded(i + 420) * h * 0.3, 5 + seeded(i + 440) * 12, 0, TAU);
      ctx.fill();
    }
  }, { width: 256, height: 128, rough: 0.9 }));
}

function brewSign(kit) {
  return memo(kit, 'brewSign', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c4ff7c';
    ctx.lineWidth = 5;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = '#9cf05a';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.6, h * 0.24, 0, TAU);
    ctx.fill();
    ctx.fillRect(w * 0.45, h * 0.18, w * 0.1, h * 0.26);
    ctx.fillStyle = '#ede4cc';
    ctx.fillRect(w * 0.43, h * 0.13, w * 0.14, h * 0.08);
    ctx.fillStyle = '#3a2a1c';
    for (const x of [0.42, 0.58]) {
      ctx.beginPath();
      ctx.arc(w * x, h * 0.58, h * 0.05, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ede4cc';
    for (const [x, y, r] of [[0.24, 0.4, 0.05], [0.78, 0.32, 0.04], [0.72, 0.72, 0.03]]) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, h * r, 0, TAU);
      ctx.fill();
    }
  }, { width: 128, height: 128, emissive: true, glow: 0.35, rough: 0.8 }));
}

function bricks(kit) {
  return memo(kit, 'brickMud', () => kit.painted((ctx, w, h) => {
    const dark = kit.mode === 'dark';
    ctx.fillStyle = dark ? '#5a3a28' : '#8c5236';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = dark ? 'rgba(20, 12, 6, 0.7)' : 'rgba(60, 34, 18, 0.65)';
    ctx.lineWidth = 3;
    const rows = 8;
    for (let r = 0; r < rows; r += 1) {
      const y = (r * h) / rows;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      for (let c = 0; c < 4; c += 1) {
        const x = ((c + (r % 2) * 0.5) * w) / 4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h / rows); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(110, 150, 70, 0.35)';
    for (let i = 0; i < 14; i += 1) {
      ctx.beginPath();
      ctx.arc(seeded(i + 40) * w, seeded(i + 60) * h * 0.4, 6 + seeded(i + 80) * 10, 0, TAU);
      ctx.fill();
    }
  }, { width: 128, height: 128, repeat: [2, 1], rough: 0.95 }));
}

// ---------- subagents: bog folk at their posts ----------

function toadFisher(kit, group, lamp, index) {
  const m = mats(kit);
  put(group, kit, 'ripple', m.ripple, 0, 0.012, 0, 0.9, 1, 0.8);
  const leaf = put(group, kit, 'pad', m.lily, 0, 0.03, 0, 0.72, 0.03, 0.64);
  leaf.rotation.y = 2.4 + index;
  put(group, kit, 'pad', kit.mat('lilyVein', { rough: 0.5 }), 0, 0.047, 0, 0.5, 0.005, 0.44).rotation.y = 2.4 + index;
  put(group, kit, 'ball', m.lotus, -0.45, 0.07, 0.42, 0.08, 0.06, 0.08);
  put(group, kit, 'ball', kit.mat('busy'), -0.45, 0.11, 0.42, 0.03);
  const rig = pivot(group, -0.12, 0.04, -0.08);
  rig.rotation.y = 0.55;
  const toad = frogFigure(kit, 'toad', 1.2);
  rig.add(toad.root);
  const rod = pivot(rig, 0.12, 0.3, 0.16);
  put(rod, kit, 'rod', m.wood, 0, 0.42, 0, 0.012, 0.84, 0.012);
  const line = put(rig, kit, 'rod', m.paper, 0, 0, 0, 0.004, 1, 0.004);
  const bobber = put(rig, kit, 'ball', kit.mat('fail', { rough: 0.4 }), 0, 0, 0, 0.035);
  const fish = pivot(rig, 0, 0, 0);
  put(fish, kit, 'ball', kit.mat('fish', { rough: 0.25, metal: 0.4 }), 0, -0.1, 0, 0.035, 0.1, 0.06);
  put(fish, kit, 'cone', kit.mat('fish', { rough: 0.25, metal: 0.4 }), 0, -0.22, 0, 0.05, 0.07, 0.02).rotation.x = Math.PI;
  const glub = [put(group, kit, 'ball', m.ripple, 0.32, 0.03, 0.62, 0.04), put(group, kit, 'ball', m.ripple, 0.4, 0.05, 0.55, 0.025)];
  const top = lampPost(kit, group, lamp, -0.54, -0.4, 1.15, 0.14);
  return {
    puff: new Vector3(-0.32, top - 0.1, -0.4),
    labelY: 1.6,
    occupants: [toad.root, fish],
    animate(time, run, done, fail) {
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const tilt = 1.05 - rest * 0.55 + Math.sin(time * 2.4) * 0.06 * run;
      rod.rotation.x = fail > 0 ? 1.05 + fail * 0.5 : tilt;
      const length = 0.84;
      const tipY = 0.3 + Math.cos(rod.rotation.x) * length;
      const tipZ = 0.16 + Math.sin(rod.rotation.x) * length;
      const water = -0.02;
      const hang = rest > 0 ? 0.3 : tipY - water;
      line.position.set(0.12, tipY - hang / 2, tipZ);
      line.scale.y = Math.max(0.001, hang);
      line.visible = fail < 0.5;
      bobber.visible = rest === 0 && fail < 0.5;
      bobber.position.set(0.12, water + 0.03 - Math.max(0, Math.sin(time * 1.7)) * 0.03 * run, tipZ);
      fish.visible = rest > 0;
      fish.position.set(0.12, tipY - hang, tipZ);
      fish.rotation.y = kit.reducedMotion ? 0.6 : Math.sin(time * 5) * 0.8;
      const croak = done >= 0 && done < 3 ? Math.abs(Math.sin(done * 5)) * (1 - done / 3) : 0;
      const breathe = 0.5 + 0.5 * Math.sin(time * 2);
      toad.sac.scale.set(0.09 + croak * 0.13 + breathe * 0.015 * run, 0.07 + croak * 0.11, 0.08 + croak * 0.1);
      for (const arm of toad.arms) arm.rotation.x = -1.1;
      toad.root.position.set(0, -fail * 0.44, fail * 0.42);
      toad.body.rotation.x = 0;
      for (const g of glub) {
        g.visible = fail > 0.6;
        g.position.y = 0.03 + (kit.reducedMotion ? 0 : ((time * 0.7 + g.position.x) % 1) * 0.06);
      }
    },
  };
}

function wispKeeper(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.7, 0.62, index + 2);
  const log = put(group, kit, 'rod', m.wood, 0.1, 0.12, 0.42, 0.11, 0.85, 0.11);
  log.rotation.set(0, 0.25, Math.PI / 2);
  put(group, kit, 'ball', m.moss, 0.1, 0.22, 0.42, 0.3, 0.04, 0.09).rotation.y = 0.25;
  const sprout = sproutFigure(kit, 1.6);
  sprout.root.position.set(-0.15, 0.2, -0.05);
  sprout.root.rotation.y = 0.9;
  group.add(sprout.root);
  const pole = pivot(group, -0.03, 0.2, 0.04);
  put(pole, kit, 'rod', m.wood, 0, 0.55, 0, 0.018, 1.1, 0.018);
  put(pole, kit, 'block', m.wood, 0.12, 1.08, 0, 0.26, 0.025, 0.025);
  const jar = pivot(pole, 0.24, 1.06, 0);
  put(jar, kit, 'rod', m.iron, 0, -0.04, 0, 0.006, 0.08, 0.006);
  put(jar, kit, 'rod', m.iron, 0, -0.08, 0, 0.11, 0.035, 0.11);
  put(jar, kit, 'rod', m.glass, 0, -0.22, 0, 0.15, 0.26, 0.15);
  lamp.position.set(0, -0.22, 0);
  lamp.scale.setScalar(0.12);
  jar.add(lamp);
  const flies = [0, 1, 2, 3].map(i => put(jar, kit, 'bead', kit.basic('glow', { additive: kit.mode === 'dark' }), 0, -0.2, 0, 0.022 + (i % 2) * 0.008));
  return {
    puff: new Vector3(0.2, 1.3, 0.04),
    labelY: 1.62,
    occupants: [sprout.root, ...flies],
    animate(time, run, done, fail) {
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const sway = Math.sin(time * 1.8) * 0.12 * run;
      pole.rotation.z = sway * 0.5;
      pole.position.y = 0.2 + rest * 0.18;
      jar.rotation.z = -sway;
      sprout.body.rotation.z = sway * 0.4;
      sprout.body.rotation.x = fail * 0.45;
      sprout.arm.rotation.x = -rest * 1.2;
      if (fail > 0) {
        pole.rotation.z = fail * 1.35;
        jar.rotation.z = -fail * 1.35 + fail * 1.6;
      }
      for (let i = 0; i < flies.length; i += 1) {
        const f = flies[i];
        f.visible = fail < 0.5 && (run > 0.05 || rest > 0);
        const speed = rest > 0 ? 0.7 : 2.2;
        const a = time * speed * (kit.reducedMotion ? 0 : 1) + i * (TAU / flies.length);
        const r = 0.17 + rest * 0.08;
        f.position.set(Math.cos(a) * r, -0.2 + Math.sin(time * 3 + i) * 0.06, Math.sin(a) * r);
      }
    },
  };
}

function snailCourier(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.72, 0.62, index + 4);
  const box = pivot(group, -0.38, 0.2, -0.24);
  put(box, kit, 'rod', m.wood, 0, 0.3, 0, 0.03, 0.6, 0.03);
  put(box, kit, 'block', m.plank, 0, 0.68, 0, 0.3, 0.2, 0.22);
  put(box, kit, 'block', m.wood, 0, 0.8, 0, 0.34, 0.04, 0.26).rotation.z = 0.05;
  put(box, kit, 'block', m.pupil, 0, 0.7, 0.112, 0.18, 0.025, 0.01);
  const letterIn = put(box, kit, 'block', m.paper, 0, 0.73, 0.1, 0.14, 0.08, 0.012);
  put(box, kit, 'rod', m.iron, 0.1, 0.89, -0.04, 0.025, 0.14, 0.025);
  const flag = pivot(box, 0.16, 0.66, 0.04);
  put(flag, kit, 'block', m.wood, 0.01, 0.1, 0, 0.012, 0.2, 0.012);
  put(flag, kit, 'block', kit.mat('fail', { rough: 0.6 }), 0.01, 0.17, 0.045, 0.01, 0.07, 0.08);
  const papers = [0, 1, 2].map(i => {
    const p = put(group, kit, 'block', m.paper, 0.15 + i * 0.12, 0.215, 0.32 - i * 0.07, 0.11, 0.008, 0.08);
    p.rotation.y = i * 0.7;
    return p;
  });
  const snail = snailFigure(kit, 1.55);
  snail.root.position.set(0.12, 0.2, 0.05);
  snail.root.rotation.y = 0.75;
  group.add(snail.root);
  box.add(lamp);
  lamp.position.set(-0.1, 0.92 + 0.13, 0.0);
  lamp.scale.setScalar(0.13);
  put(box, kit, 'ring', m.iron, -0.1, 0.92, 0, 0.08, 0.08, 0.08).rotation.x = Math.PI / 2;
  return {
    puff: new Vector3(-0.28, 1.2, -0.28),
    labelY: 1.5,
    occupants: [snail.root],
    animate(time, run, done, fail) {
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const creep = Math.sin(time * 0.9) * run;
      snail.root.position.x = 0.12 + creep * 0.08;
      snail.foot.scale.z = 1 + Math.abs(Math.cos(time * 0.9)) * 0.12 * run;
      const hide = fail;
      snail.foot.scale.set(1 - hide * 0.6, 1 - hide * 0.6, (1 + Math.abs(Math.cos(time * 0.9)) * 0.12 * run) * (1 - hide * 0.75));
      snail.neck.visible = hide < 0.7;
      for (let i = 0; i < snail.stalks.length; i += 1) {
        const side = i ? 1 : -1;
        snail.stalks[i].rotation.z = side * (0.25 + Math.sin(time * 2.5 + i) * 0.15 * run - rest * 0.15);
        snail.stalks[i].scale.y = 1 + rest * 0.35 - hide * 0.8;
      }
      snail.shell.rotation.z = hide * 0.45;
      snail.shell.position.y = 0.25 - hide * 0.06;
      snail.letter.visible = rest === 0 && fail === 0;
      letterIn.visible = rest > 0;
      flag.rotation.x = -rest * 1.5;
      for (const p of papers) p.visible = fail > 0;
    },
  };
}

function crowPost(kit, group, lamp, index) {
  const m = mats(kit);
  islet(kit, group, 0.66, 0.6, index + 8);
  put(group, kit, 'rod', m.wood, -0.08, 0.27, -0.1, 0.14, 0.14, 0.14);
  const post = put(group, kit, 'rod', m.wood, -0.08, 0.75, -0.1, 0.04, 1.05, 0.04);
  post.rotation.z = 0.04;
  const arrows = [];
  for (const [y, yaw, w] of [[1.08, 0.3, 0.5], [0.9, -2.5, 0.42], [0.72, 1.2, 0.38]]) {
    const sign = pivot(group, -0.08, y, -0.1);
    sign.rotation.y = yaw;
    put(sign, kit, 'block', m.plank, w / 2 - 0.04, 0, 0, w, 0.09, 0.025);
    put(sign, kit, 'cone', m.plank, w - 0.02, 0, 0, 0.065, 0.08, 0.0125).rotation.z = -Math.PI / 2;
    arrows.push(sign);
  }
  const crow = crowFigure(kit, 1.7);
  crow.root.position.set(-0.08, 1.28, -0.1);
  crow.root.rotation.y = 0.9;
  group.add(crow.root);
  const feathers = [0, 1, 2].map(i => {
    const f = put(group, kit, 'block', kit.mat('crow', { rough: 0.4 }), 0.2 + i * 0.1, 0.215, 0.3 - i * 0.12, 0.03, 0.006, 0.1);
    f.rotation.y = i * 1.1;
    return f;
  });
  put(group, kit, 'block', m.wood, 0.1, 0.58, -0.1, 0.32, 0.03, 0.03);
  put(group, kit, 'rod', m.iron, 0.24, 0.53, -0.1, 0.006, 0.08, 0.006);
  lamp.position.set(0.24, 0.39, -0.1);
  lamp.scale.setScalar(0.14);
  group.add(lamp);
  put(group, kit, 'cone', m.iron, 0.24, 0.5, -0.1, 0.12, 0.07, 0.12);
  return {
    puff: new Vector3(-0.08, 1.35, -0.1),
    labelY: 1.95,
    occupants: [crow.root],
    animate(time, run, done, fail) {
      const rest = done < 0 ? 0 : ease(clamp01(done / 0.6));
      const peck = Math.max(0, Math.sin(time * 5)) * run;
      crow.head.rotation.x = peck * 0.7 - rest * 0.35;
      const hop = Math.max(0, Math.sin(time * 1.3 + index)) > 0.96 ? 0.04 * run : 0;
      const flapping = done >= 0 && done < 2.6 ? 1 - done / 2.6 : 0;
      for (let i = 0; i < 2; i += 1) {
        const side = i ? 1 : -1;
        crow.wings[i].rotation.z = side * (flapping * (0.7 + 0.6 * Math.sin(done * 18)) + fail * 0.6);
      }
      crow.coin.visible = rest > 0;
      crow.root.position.set(-0.08 + fail * 0.42, 1.28 + hop + flapping * 0.12 - fail * 1.08, -0.1 + fail * 0.32);
      crow.root.rotation.z = fail * 0.5;
      arrows[0].rotation.x = fail * 1.1;
      arrows[0].position.y = 1.08 - fail * 0.08;
      for (const f of feathers) f.visible = fail > 0;
    },
  };
}

const WORKERS = [frogBrewer, goblinStill, orcGrinder, newtKiln];
const SUBAGENTS = [toadFisher, wispKeeper, snailCourier, crowPost];

function station(kit, kind, spot = {}) {
  const index = spot.index ?? 0;
  const group = new Group();
  const lamp = new Mesh(new SphereGeometry(1, 12, 10), kit.lamp());
  const build = (kind === 'worker' ? WORKERS : SUBAGENTS)[index % 4];
  const rig = build(kit, group, lamp, index);
  // Built with the far side at -x; the left bank is mirrored so the back faces away from the camera.
  if ((spot.side ?? 1) < 0) group.scale.x = -1;
  group.userData = {
    lamp, puff: rig.puff, labelY: rig.labelY, occupants: rig.occupants ?? [], spin: [], swing: [],
    frame(time, dt, record) {
      const motion = !kit.reducedMotion;
      const run = record.activity;
      const fail = record.state !== 'failed' ? 0
        : !motion || !(record.failedAt > -Infinity) ? 1 : ease(clamp01((time - record.failedAt) / 0.9));
      const done = record.state !== 'done' ? -1
        : !motion || record.doneAt === null || record.doneAt === -Infinity ? Infinity : Math.max(0, time - record.doneAt);
      rig.animate(motion ? time : 0, run, done, fail);
    },
  };
  return shade(kit, group);
}

function ghost(kit) {
  const group = new Group();
  const wisp = kit.basic('glow', { opacity: 0.5, additive: kit.mode === 'dark' });
  const faint = kit.basic('glow', { opacity: 0.22, additive: kit.mode === 'dark' });
  const ring = new Mesh(new RingGeometry(0.62, 0.7, 32), faint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * TAU;
    const stake = kit.cylinder(0.018, 0.024, 0.55, wisp, [Math.cos(a) * 0.66, 0.28, Math.sin(a) * 0.66], 5);
    stake.rotation.z = Math.cos(a) * 0.12;
    group.add(stake);
  }
  group.add(kit.sphere(0.13, wisp, [0, 0.75, 0], 10));
  group.add(kit.sphere(0.3, faint, [0, 0.75, 0], 10));
  return group;
}

// ---------- the floor: murky water and the lantern-lit trail ----------

// Materials the water, trees, trail and islets share.

function extra(kit) {
  const dark = kit.mode === 'dark';
  return memo(kit, 'extra', () => ({
    warm: kit.mat('#ff9a2c', { emissive: '#ff8a1c', glow: dark ? 1.25 : 0.5, rough: 0.4 }),
    glint: new SpriteMaterial({
      map: kit.canvas(64, 64, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.3)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }),
      color: kit.color('#ffab45'), transparent: true, opacity: dark ? 0.7 : 0.25, depthWrite: false, blending: dark ? AdditiveBlending : NormalBlending,
    }),
    padTop: kit.mat(dark ? '#5f9c38' : '#7ab24a', { rough: 0.45 }),
    padRim: kit.mat(dark ? '#2f5a26' : '#4a7d2c', { rough: 0.5 }),
    petal: kit.mat('lotus', { rough: 0.5, emissive: 'lotus', glow: dark ? 0.3 : 0 }),
    bark: kit.mat(dark ? '#4a4132' : '#6e5c45', { rough: 0.95, flat: true }),
    leafLow: kit.mat(dark ? '#1b3a24' : '#3f6a34', { rough: 0.95, flat: true }),
    leafMid: kit.mat(dark ? '#2b5629' : '#56863c', { rough: 0.95, flat: true }),
    leafTop: kit.mat(dark ? '#447a34' : '#74a548', { rough: 0.95, flat: true }),
    drape: kit.mat(dark ? '#7d9a80' : '#9db48c', { rough: 0.95 }),
    shroom: kit.mat(dark ? '#2a9c8a' : '#8fd8c8', { emissive: '#22b49c', glow: dark ? 0.55 : 0.15, rough: 0.6 }),
    grass: kit.mat(dark ? '#6f9a3a' : '#86b04a', { rough: 0.9, flat: true }),
    foam: kit.basic('ripple', { opacity: dark ? 0.2 : 0.4 }),
  }));
}

// A lotus: two rings of petals round a gold heart. One unit across.
function lotus(kit, group, x, y, z, s) {
  const e = extra(kit);
  const flower = pivot(group, x, y, z);
  flower.scale.setScalar(s);
  for (let ring = 0; ring < 2; ring += 1) {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU + ring * 0.52;
      const out = ring ? 0.45 : 1;
      const petal = put(flower, kit, 'cone', e.petal, Math.cos(a) * 0.36 * out, 0.3 + ring * 0.16, Math.sin(a) * 0.36 * out, 0.2, 0.8, 0.2);
      petal.rotation.set(Math.sin(a) * out * 0.95, 0, -Math.cos(a) * out * 0.95);
    }
  }
  put(flower, kit, 'ball', mats(kit).gold, 0, 0.42, 0, 0.17);
  return flower;
}

// A lily pad in two greens, the lighter leaf lying on a darker rim.
function lilyPad(kit, group, x, z, r, turn, flower = 0) {
  const e = extra(kit);
  const pad = put(group, kit, 'pad', e.padRim, x, 0.018, z, r, 0.022, r * 0.92);
  pad.rotation.y = turn;
  const top = put(group, kit, 'pad', e.padTop, x, 0.031, z, r * 0.88, 0.008, r * 0.8);
  top.rotation.y = turn;
  if (flower) lotus(kit, group, x + Math.cos(turn) * r * 0.35, 0.03, z + Math.sin(turn) * r * 0.35, flower);
}

// A crooked stake with a warm lantern, and the pool of light it throws on the water.
function trailLamp(kit, group, x, z, lean) {
  const m = mats(kit);
  const e = extra(kit);
  const inward = x > 0 ? -1 : 1;
  const post = pivot(group, x, 0, z);
  post.rotation.z = lean;
  put(post, kit, 'rod', m.wood, 0, 0.6, 0, 0.035, 1.2, 0.035);
  put(post, kit, 'block', m.wood, 0.15 * inward, 1.16, 0, 0.36, 0.035, 0.035);
  put(post, kit, 'rod', m.iron, 0.3 * inward, 1.08, 0, 0.008, 0.14, 0.008);
  put(post, kit, 'cone', m.iron, 0.3 * inward, 1.02, 0, 0.09, 0.06, 0.09);
  put(post, kit, 'ball', e.warm, 0.3 * inward, 0.93, 0, 0.08);
  put(post, kit, 'ball', m.moss, 0, 0.04, 0, 0.11, 0.05, 0.11);
  const glint = new Sprite(e.glint);
  glint.position.set(0.3 * inward, 0.93, 0);
  glint.scale.setScalar(0.85);
  post.add(glint);
  group.add(kit.halo('#ff9a3a', 3.6, 3.6, { opacity: kit.mode === 'dark' ? 0.34 : 0.06, at: [x + 0.3 * inward, 0.016, z] }));
}

function floor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const m = mats(kit);
  // Still, deep water: slow blotches of depth and fine ripples, wrapped so the tile repeats without a seam.
  const water = kit.painted((ctx, w, h) => {
    ctx.fillStyle = dark ? '#060d08' : '#43573a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i += 1) {
      const x = seeded(i * 3 + 1) * w;
      const y = seeded(i * 3 + 2) * h;
      const r = 90 + seeded(i * 3 + 3) * 190;
      const tone = i % 3 === 1
        ? (dark ? 'rgba(46, 60, 22, 0.3)' : 'rgba(126, 146, 72, 0.3)')
        : i % 3 === 2
          ? (dark ? 'rgba(48, 38, 16, 0.28)' : 'rgba(112, 98, 56, 0.26)')
          : (dark ? 'rgba(1, 4, 2, 0.5)' : 'rgba(38, 58, 38, 0.3)');
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 4, x + ox, y + oy, r);
          g.addColorStop(0, tone);
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    // Streaks of scum and a grain of algae: stagnant water, not a pond.
    let state = 4711;
    const rnd = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 16; i += 1) {
      const x = rnd() * w;
      const y = rnd() * h;
      const len = 110 + rnd() * 200;
      const thick = 8 + rnd() * 18;
      const turn = (rnd() - 0.5) * 0.7;
      ctx.fillStyle = dark ? `rgba(66, 84, 32, ${(0.1 + rnd() * 0.1).toFixed(3)})` : `rgba(140, 160, 84, ${(0.07 + rnd() * 0.08).toFixed(3)})`;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, len, thick, turn, 0, TAU);
          ctx.fill();
        }
      }
    }
    for (let i = 0; i < 5200; i += 1) {
      const tone = rnd();
      ctx.fillStyle = dark
        ? (tone > 0.5 ? 'rgba(84, 108, 44, 0.2)' : 'rgba(0, 0, 0, 0.25)')
        : (tone > 0.5 ? 'rgba(160, 184, 96, 0.22)' : 'rgba(40, 56, 34, 0.16)');
      ctx.fillRect(rnd() * w, rnd() * h, 1 + tone * 1.6, 1 + tone);
    }
    ctx.strokeStyle = dark ? 'rgba(150, 190, 130, 0.05)' : 'rgba(240, 250, 236, 0.12)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 70; i += 1) {
      const x = seeded(90 + i * 2) * w;
      const y = seeded(91 + i * 2) * h;
      const len = 22 + seeded(300 + i) * 64;
      for (const ox of [-w, 0, w]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y, len, 3 + (i % 3) * 2, 0, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    }
  }, { width: 1024, height: 1024, repeat: [10, 10], rough: 0.7, metal: 0.03 });
  const disc = new Mesh(new CircleGeometry(70, 72), water);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0, -5);
  group.add(disc);

  // Lily pads and half-sunk logs step up the aisle to the cauldron hatch.
  let index = 0;
  for (let z = 9.8; z > -3.0; z -= 0.92) {
    const x = Math.sin(index * 1.7) * 0.32;
    if (index % 3 === 1) {
      const log = put(group, kit, 'rod', extra(kit).bark, x, 0.03, z, 0.14, 1.0, 0.14);
      log.rotation.set(0, (seeded(index) - 0.5) * 0.4, Math.PI / 2);
      const top = put(group, kit, 'ball', m.moss, x, 0.14, z, 0.34, 0.035, 0.09);
      top.rotation.y = log.rotation.y;
      put(group, kit, 'ball', extra(kit).shroom, x + 0.36, 0.17, z + 0.04, 0.035, 0.025, 0.035);
    } else {
      const r = 0.42 + seeded(index + 30) * 0.12;
      lilyPad(kit, group, x, z, r, seeded(index + 60) * TAU, index % 4 === 0 ? 0.13 : 0);
    }
    index += 1;
  }
  for (let i = 0; i < 26; i += 1) {
    const side = i % 2 ? 1 : -1;
    const x = side * (1.3 + seeded(i + 700) * 0.4);
    const z = -2.6 + seeded(i + 720) * 12.5;
    lilyPad(kit, group, x, z, 0.14 + seeded(i + 740) * 0.14, seeded(i + 760) * TAU);
  }
  // Lanterns on stakes light the way home.
  [[-1.05, 8.4, 0.08], [1.08, 5.6, -0.1], [-1.1, 2.6, 0.06], [1.05, -0.4, -0.07]].forEach(([x, z, lean]) => trailLamp(kit, group, x, z, lean));
  for (const node of group.children) node.receiveShadow = !kit.software;
  return bake(group);
}

// ---------- the hall: the brew-hut ----------

// Thatch laid in courses of straw, for the witch-hat roof and the shack.
function thatch(kit) {
  const dark = kit.mode === 'dark';
  return memo(kit, 'thatch', () => {
    const mat = kit.painted((ctx, w, h) => {
      ctx.fillStyle = dark ? '#4a4825' : '#8a8748';
      ctx.fillRect(0, 0, w, h);
      const rows = 5;
      for (let row = 0; row < rows; row += 1) {
        const y0 = (row / rows) * h;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + h / rows);
        g.addColorStop(0, dark ? 'rgba(26, 24, 10, 0.8)' : 'rgba(60, 56, 24, 0.55)');
        g.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
        g.addColorStop(1, dark ? 'rgba(190, 176, 96, 0.22)' : 'rgba(232, 222, 150, 0.3)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, h / rows);
      }
      for (let i = 0; i < 520; i += 1) {
        const x = seeded(i + 1100) * w;
        const y = seeded(i + 2100) * h;
        const tone = seeded(i + 3100);
        ctx.strokeStyle = tone > 0.66 ? (dark ? 'rgba(186, 170, 92, 0.55)' : 'rgba(232, 220, 150, 0.6)')
          : tone > 0.33 ? (dark ? 'rgba(92, 122, 56, 0.5)' : 'rgba(130, 160, 80, 0.5)') : 'rgba(30, 28, 12, 0.55)';
        ctx.lineWidth = 1 + tone * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (seeded(i + 4100) - 0.5) * 5, y + 10 + tone * 16);
        ctx.stroke();
      }
    }, { width: 256, height: 256, repeat: [3, 1], rough: 0.95, metal: 0 });
    mat.flatShading = true;
    return mat;
  });
}

// The brew-hut's dressing: a string of lanterns under the deck with their
// light on the water, steam off the brew and a boat tied up at the ladder.
// Returns the steam puffs, which the hall lifts and fades each frame.
function hallExtras(kit, hallGroup, DECK) {
  const group = new Group();
  const m = mats(kit);
  const e = extra(kit);
  const dark = kit.mode === 'dark';

  // Lanterns strung under the deck's front edge, and their pools of light.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const x = side * (1.52 + i * 0.26);
      const drop = 0.2 + Math.sin((i / 3) * Math.PI) * 0.16;
      put(group, kit, 'rod', m.iron, x, DECK - 0.1 - drop / 2, 0.96, 0.006, drop, 0.006);
      put(group, kit, 'ball', e.warm, x, DECK - 0.15 - drop, 0.96, 0.06);
    }
    group.add(kit.halo('#ff9a3a', 4.4, 3.6, { opacity: dark ? 0.36 : 0.05, at: [side * 2.3, 0.017, 1.5] }));
  }
  group.add(kit.halo('window', 3.2, 1.6, { opacity: dark ? 0.2 : 0, at: [0, DECK + 0.075, -0.3] }));

  // Steam rolling off the brew.
  const steam = new SpriteMaterial({
    map: kit.canvas(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
    color: kit.color('cauldron'), transparent: true, opacity: dark ? 0.16 : 0.2, depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending,
  });
  const puffs = [[0.1, 2.1, 0.5, 1.5], [-0.25, 2.8, 0.7, 1.9], [0.2, 3.6, 0.85, 2.4], [-0.1, 4.5, 1.0, 2.9]].map(([x, y, z, s], i) => {
    const puff = new Sprite(i ? steam.clone() : steam);
    puff.position.set(x, y, z);
    puff.scale.setScalar(s);
    hallGroup.add(puff);
    return { puff, phase: i / 4, sway: x, peak: steam.opacity };
  });

  // A boat tied up at the foot of the ladder, loaded with empties.
  const boat = pivot(group, -3.3, 0, 1.7);
  boat.rotation.y = 0.5;
  put(boat, kit, 'ball', m.plank, 0, 0.03, 0, 0.46, 0.3, 1.05);
  put(boat, kit, 'ball', m.wet, 0, 0.1, 0, 0.37, 0.19, 0.92);
  for (const z of [-0.32, 0.38]) put(boat, kit, 'block', m.wood, 0, 0.21, z, 0.78, 0.04, 0.15);
  put(boat, kit, 'block', kit.mat('crate', { rough: 0.9 }), 0, 0.3, 0, 0.36, 0.26, 0.36);
  for (let i = 0; i < 3; i += 1) bottle(kit, boat, -0.1 + i * 0.11, 0.42, -0.06 + (i % 2) * 0.12, 0.9);
  put(group, kit, 'rod', m.wood, -2.75, 0.45, 2.05, 0.04, 0.9, 0.04).rotation.z = 0.08;
  put(group, kit, 'ball', e.warm, -2.75, 0.98, 2.05, 0.075);
  const glint = new Sprite(e.glint);
  glint.position.set(-2.75, 0.98, 2.05);
  glint.scale.setScalar(0.85);
  group.add(glint);
  group.add(kit.halo('#ff9a3a', 3.2, 3.2, { opacity: dark ? 0.34 : 0.05, at: [-2.9, 0.018, 2.0] }));
  hallGroup.add(bake(shade(kit, group)));
  return puffs;
}

function hall(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const m = mats(kit);
  const spin = [];
  const swing = [];
  const DECK = 1.95;

  group.add(kit.shadow(6.2, 4.4, 0.42));
  group.add(kit.halo('cauldron', 4.4, 3.2, { opacity: dark ? 0.3 : 0.14, at: [0, 0.016, 1.1] }));

  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * TAU;
    put(group, kit, 'ball', m.stone, Math.cos(a) * 1.16, 0.06, 0.2 + Math.sin(a) * 1.08, 0.2, 0.1, 0.15).rotation.y = -a;
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU + 0.3;
    put(group, kit, 'ball', m.ember, Math.cos(a) * 0.6, 0.05, 0.2 + Math.sin(a) * 0.55, 0.16, 0.07, 0.12);
  }
  put(group, kit, 'pot', m.pot, 0, 0.04, 0.2, 1.25, 1.62, 1.25);
  const rim = new Mesh(new TorusGeometry(1.17, 0.075, 6, 30), m.iron);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 1.66, 0.2);
  group.add(rim);
  for (const a of [0.2, Math.PI - 0.2]) {
    const lug = put(group, kit, 'ring', m.iron, Math.cos(a) * 1.22, 1.38, 0.2 + Math.sin(a) * 1.22, 0.16);
    lug.rotation.y = Math.PI / 2 - a;
  }
  const brew = put(group, kit, 'disc', m.brew, 0, 1.56, 0.2, 1.1, 0.04, 1.1);
  for (const [x, z, s] of [[-0.55, 1.15, 0.16], [0.4, 1.24, 0.12], [0.85, 0.85, 0.14], [-0.95, 0.7, 0.11]]) {
    put(group, kit, 'ball', m.brew, x, 1.66, z, s, s * 0.7, s);
  }
  put(group, kit, 'ball', m.brew, 0.62, 1.42, 1.32, 0.07, 0.24, 0.06);
  const bubbles = Array.from({ length: 8 }, (_, i) => {
    const a = i * 2.4;
    const r = 0.2 + (i % 4) * 0.2;
    return { mesh: put(group, kit, 'ball', m.froth, Math.cos(a) * r, 1.58, 0.2 + Math.sin(a) * r, 0.1), phase: seeded(i + 3), rate: 0.6 + seeded(i + 9) * 0.6 };
  });

  // The feed hatch in the cauldron's belly: crates go in here.
  const hatch = pivot(group, 0, 1.06, 1.46);
  hatch.rotation.x = 0.25;
  put(hatch, kit, 'block', kit.mat('door', { rough: 1, emissive: 'cauldron', glow: 0.18 }), 0, -0.4, -0.07, 0.84, 0.8, 0.1);
  put(hatch, kit, 'block', m.iron, 0, 0.03, 0, 1.02, 0.1, 0.12);
  put(hatch, kit, 'block', m.iron, 0, -0.83, 0, 1.02, 0.1, 0.12);
  for (const side of [-1, 1]) {
    put(hatch, kit, 'block', m.iron, side * 0.47, -0.4, 0, 0.1, 0.86, 0.12);
    for (const y of [-0.1, -0.4, -0.7]) put(hatch, kit, 'bead', m.copper, side * 0.47, y, 0.065, 0.025);
  }
  const door = kit.box(0.82, 0.78, 0.06, kit.mat('iron', { rough: 0.5, metal: 0.45 }));
  door.geometry.translate(0, -0.39, 0);
  door.position.set(0, -0.01, 0.05);
  hatch.add(door);
  for (const y of [-0.18, -0.6]) door.add(kit.box(0.84, 0.06, 0.02, m.copper, [0, y, 0.035]));
  const handle = new Mesh(new TorusGeometry(0.08, 0.018, 6, 14), m.copper);
  handle.position.set(0, -0.68, 0.05);
  door.add(handle);

  const paddle = pivot(group, 0, 1.56, 0.2);
  const shaft = pivot(paddle, 0, 0, 0);
  shaft.rotation.z = 0.3;
  put(shaft, kit, 'rod', m.wood, 0, 0.78, 0, 0.055, 1.7, 0.055);
  put(shaft, kit, 'ball', m.moss, 0, 1.6, 0, 0.09, 0.07, 0.09);
  put(shaft, kit, 'block', m.wood, 0, 0.05, 0, 0.32, 0.16, 0.05);
  spin.push([paddle, 'y', 1.1]);

  const geyser = put(group, kit, 'ball', m.brew, 0, 1.6, 0.2, 0.22, 0.001, 0.22);
  geyser.visible = false;
  const ringMat = new MeshBasicMaterial({ color: kit.palette.cauldron, transparent: true, opacity: 0, depthWrite: false });
  const smokeRings = [0, 1].map(() => {
    const ring = new Mesh(new TorusGeometry(0.5, 0.13, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    group.add(ring);
    return ring;
  });

  // Stilts and the deck that wraps round the cauldron's back.
  for (const [x, z] of [[-2.2, -1.42], [2.2, -1.42], [-0.95, -1.45], [0.95, -1.45], [-2.2, 0.78], [2.2, 0.78]]) {
    const stilt = put(group, kit, 'rod', m.wood, x, DECK / 2, z, 0.085, DECK, 0.085);
    stilt.rotation.z = (seeded(x * 3 + z) - 0.5) * 0.08;
    put(group, kit, 'ball', m.moss, x, 0.08, z, 0.14, 0.06, 0.14);
  }
  for (const side of [-1, 1]) {
    const brace = put(group, kit, 'block', m.wood, side * 2.2, 1.05, -0.3, 0.05, 0.06, 2.4);
    brace.rotation.x = 0.62 * side;
  }
  put(group, kit, 'block', m.plank, 0, DECK, -0.85, 4.5, 0.12, 1.4);
  put(group, kit, 'block', m.wood, 0, DECK - 0.08, -0.15, 4.56, 0.08, 0.08);
  for (const side of [-1, 1]) {
    put(group, kit, 'block', m.plank, side * 1.9, DECK, 0.38, 0.85, 0.12, 1.05);
    put(group, kit, 'block', m.wood, side * 1.9, DECK - 0.08, 0.9, 0.9, 0.08, 0.08);
    for (const z of [0.05, 0.85]) put(group, kit, 'rod', m.wood, side * 2.28, DECK + 0.25, z, 0.03, 0.5, 0.03);
    put(group, kit, 'block', m.wood, side * 2.28, DECK + 0.48, 0.45, 0.04, 0.04, 0.84);
  }
  for (let i = 0; i < 9; i += 1) {
    const x = -2.1 + i * 0.52 + seeded(i + 40) * 0.1;
    const z = Math.abs(x) > 1.45 ? 0.92 : -0.15;
    const len = 0.25 + seeded(i + 50) * 0.35;
    put(group, kit, 'rod', m.moss, x, DECK - 0.1 - len / 2, z, 0.022, len, 0.022);
  }

  const sign = pivot(group, 1.62, DECK - 0.08, 0.96);
  put(sign, kit, 'rod', m.iron, -0.2, -0.1, 0, 0.008, 0.2, 0.008);
  put(sign, kit, 'rod', m.iron, 0.2, -0.1, 0, 0.008, 0.2, 0.008);
  put(sign, kit, 'block', brewSign(kit), 0, -0.38, 0, 0.6, 0.55, 0.04);
  swing.push([sign, 'x', 0.08, 1.3]);
  for (let i = 0; i < 4; i += 1) {
    const herb = pivot(group, -0.95 + i * 0.6, DECK + 1.62, -0.28);
    put(herb, kit, 'rod', m.reed, 0, -0.08, 0, 0.006, 0.16, 0.006);
    put(herb, kit, 'cone', i % 2 ? m.moss : m.cattail, 0, -0.24, 0, 0.06, 0.2, 0.06).rotation.x = Math.PI;
  }

  const ladder = pivot(group, -1.9, 0, 1.38);
  ladder.rotation.x = -0.24;
  for (const side of [-1, 1]) put(ladder, kit, 'rod', m.wood, side * 0.17, 1.05, 0, 0.03, 2.1, 0.03);
  for (let y = 0.25; y < 2.0; y += 0.32) put(ladder, kit, 'block', m.wood, 0, y, 0, 0.36, 0.035, 0.04);

  // The hut, crooked and topped with a bent witch-hat roof.
  const hut = pivot(group, 0, DECK + 0.06, -0.98);
  hut.rotation.set(0, -0.04, 0.035);
  put(hut, kit, 'block', boards(kit), 0, 0.7, 0, 2.7, 1.4, 1.0);
  for (const y of [0.35, 0.95]) put(hut, kit, 'block', m.wood, 0, y, 0.505, 2.72, 0.05, 0.02);
  for (const x of [-1.33, 1.33]) put(hut, kit, 'block', m.wood, x, 0.7, 0.49, 0.1, 1.42, 0.06);
  for (const x of [-0.78, 0.78]) {
    put(hut, kit, 'ring', m.iron, x, 0.78, 0.51, 0.23, 0.23, 0.23);
    put(hut, kit, 'disc', kit.windows, x, 0.78, 0.5, 0.21, 0.02, 0.21).rotation.x = Math.PI / 2;
    put(hut, kit, 'block', m.wood, x, 0.78, 0.53, 0.42, 0.03, 0.02);
  }
  put(hut, kit, 'block', kit.mat('door', { rough: 1 }), 0, 0.46, 0.51, 0.5, 0.86, 0.04);
  put(hut, kit, 'bead', m.bone, 0.15, 0.45, 0.54, 0.035);
  put(hut, kit, 'block', m.wood, 0, 0.93, 0.52, 0.6, 0.06, 0.04);

  const brim = new Mesh(new CylinderGeometry(0.62, 1.95, 0.55, 8), thatch(kit));
  brim.position.set(0, 1.62, 0);
  brim.scale.z = 0.72;
  hut.add(brim);
  const crown = new Mesh(new CylinderGeometry(0.36, 0.64, 0.95, 8), thatch(kit));
  crown.position.set(0.06, 2.34, 0);
  crown.rotation.z = -0.12;
  crown.scale.z = 0.8;
  hut.add(crown);
  put(hut, kit, 'rod', m.cloth, 0.03, 1.98, 0, 0.66, 0.16, 0.54).rotation.z = -0.12;
  put(hut, kit, 'block', m.gold, 0.02, 1.98, 0.54, 0.18, 0.14, 0.03).rotation.z = -0.12;
  const tip = new Mesh(new ConeGeometry(0.37, 1.05, 8), thatch(kit));
  tip.position.set(0.38, 3.2, 0);
  tip.rotation.z = -0.58;
  hut.add(tip);
  const tipLamp = pivot(hut, 0.82, 3.52, 0);
  put(tipLamp, kit, 'rod', m.iron, 0, -0.12, 0, 0.008, 0.24, 0.008);
  put(tipLamp, kit, 'ball', m.lantern, 0, -0.3, 0, 0.09);
  swing.push([tipLamp, 'z', 0.25, 1.6]);
  for (const [x, y, z, s] of [[-1.2, 1.5, 0.6, 0.22], [1.1, 1.45, 0.55, 0.2], [0.3, 1.88, 0.42, 0.16], [-0.6, 1.6, -0.4, 0.2]]) {
    put(hut, kit, 'ball', m.moss, x, y, z, s * 1.2, s * 0.45, s);
  }

  const chimney = pivot(group, -1.18, DECK + 0.1, -1.35);
  for (const [y, x, s, r] of [[0.32, 0, 0.4, 0.06], [0.95, -0.05, 0.36, -0.1], [1.55, 0.04, 0.32, 0.14], [2.08, 0.09, 0.28, -0.06]]) {
    put(chimney, kit, 'block', m.stone, x, y, 0, s, 0.62, s).rotation.z = r;
  }
  put(chimney, kit, 'block', m.iron, 0.1, 2.42, 0, 0.42, 0.08, 0.42);

  const pipe = put(group, kit, 'rod', m.copper, 0.72, 2.25, -0.25, 0.05, 1.0, 0.05);
  pipe.rotation.x = -0.75;
  put(group, kit, 'ball', m.copper, 0.72, 2.6, -0.62, 0.075);
  put(group, kit, 'ball', m.copper, 0.72, 1.9, 0.12, 0.07);
  for (let i = 0; i < 3; i += 1) bottle(kit, group, -1.75 - i * 0.16, DECK + 0.06, 0.15 + (i % 2) * 0.18, 1.1);
  put(group, kit, 'taper', m.wood, -1.95, DECK + 0.25, 0.65, 0.17, 0.38, 0.17);

  const hook = pivot(group, -2.28, DECK + 0.48, 0.92);
  put(hook, kit, 'rod', m.iron, 0, -0.14, 0, 0.008, 0.28, 0.008);
  put(hook, kit, 'cone', m.iron, 0, -0.3, 0, 0.1, 0.07, 0.1);
  put(hook, kit, 'ball', m.lantern, 0, -0.4, 0, 0.1);
  swing.push([hook, 'x', 0.18, 2.1]);

  // The totem: a horned skull lantern whose eyes are the beacon.
  const totem = pivot(group, 1.98, DECK, 0.45);
  put(totem, kit, 'rod', m.wood, 0, 0.75, 0, 0.08, 1.5, 0.08);
  for (const y of [0.35, 0.8, 1.2]) put(totem, kit, 'rod', m.bone, 0, y, 0, 0.1, 0.05, 0.1);
  for (const side of [-1, 1]) {
    const feather = put(totem, kit, 'block', m.cloth, side * 0.12, 1.0, 0.02, 0.03, 0.26, 0.08);
    feather.rotation.z = side * 0.5;
  }
  const skull = pivot(totem, 0, 1.68, 0);
  skull.rotation.y = -0.35;
  put(skull, kit, 'ball', m.bone, 0, 0, 0, 0.25, 0.22, 0.23);
  put(skull, kit, 'ball', m.bone, 0, -0.07, 0.13, 0.17, 0.11, 0.12);
  for (const side of [-1, 1]) {
    put(skull, kit, 'ball', m.pupil, side * 0.09, 0.03, 0.18, 0.065, 0.06, 0.04);
    const horn = put(skull, kit, 'cone', m.bone, side * 0.27, 0.16, 0, 0.055, 0.34, 0.055);
    horn.rotation.z = -side * 0.95;
  }
  const eyes = [-1, 1].map(side => {
    const eye = new Mesh(memo(kit, 'shape:ball', SHAPES.ball), kit.beacon);
    eye.position.set(side * 0.09, 0.03, 0.205);
    eye.scale.setScalar(0.042);
    skull.add(eye);
    return eye;
  });
  const jaw = pivot(skull, 0, -0.12, 0.02);
  put(jaw, kit, 'block', m.bone, 0, -0.03, 0.12, 0.2, 0.05, 0.14);
  put(skull, kit, 'bead', m.brew, 0, -0.1, 0.14, 0.05);

  const steam = hallExtras(kit, group, DECK);
  shade(kit, group);
  for (const ring of smokeRings) ring.castShadow = false;

  let clock = 0;
  let ringAt = -10;
  let spoutAt = -10;
  let pending = { delivery: false, spawn: false };
  group.userData = {
    door, beacon: eyes[1], chimney: new Vector3(-1.08, DECK + 2.62, -1.35), labelY: 5.55, spin, swing,
    react(event) {
      if (event === 'delivery') pending.delivery = true;
      if (event === 'spawn') pending.spawn = true;
    },
    frame(now, dt, main, reducedMotion) {
      if (pending.delivery) ringAt = now;
      if (pending.spawn) spoutAt = now;
      pending.delivery = pending.spawn = false;
      if (reducedMotion) {
        for (const { mesh } of bubbles) mesh.visible = false;
        return;
      }
      const working = main?.state === 'working';
      clock += dt * (working ? 1 : 0.35);
      // Steam rolls up off the brew, swelling and thinning as it climbs.
      for (const { puff, phase, sway, peak } of steam) {
        const t = (clock * 0.11 + phase) % 1;
        puff.position.set(sway + Math.sin(clock * 0.5 + phase * TAU) * 0.25, 2.0 + t * 2.9, 0.5 + t * 0.55);
        puff.scale.setScalar(1.3 + t * 1.8);
        puff.material.opacity = peak * Math.sin(t * Math.PI);
      }
      for (const bubble of bubbles) {
        const c = (clock * bubble.rate + bubble.phase) % 1;
        bubble.mesh.visible = c < 0.9;
        bubble.mesh.scale.setScalar(0.03 + c * 0.13);
        bubble.mesh.position.y = 1.56 + c * 0.05;
      }
      const belch = now - ringAt;
      for (let i = 0; i < smokeRings.length; i += 1) {
        const t = (belch - i * 0.35) / 1.9;
        const ring = smokeRings[i];
        ring.visible = t >= 0 && t < 1;
        if (!ring.visible) continue;
        const s = 0.55 + t * 1.5 - i * 0.15;
        ring.scale.set(s, s, s * (1 - t * 0.3));
        ring.position.set(0, 1.85 + t * 2.4, 0.4 + t * 0.6);
      }
      ringMat.opacity = belch < 2.3 ? 0.85 * (1 - clamp01(belch / 2.3)) : 0;
      const jump = belch < 0.6 ? Math.sin((belch / 0.6) * Math.PI) * 0.12 : 0;
      brew.position.y = 1.56 + jump;
      const spout = (now - spoutAt) / 0.7;
      geyser.visible = spout >= 0 && spout < 1;
      if (geyser.visible) {
        const h = Math.sin(spout * Math.PI);
        geyser.scale.set(0.24 * (1 - spout * 0.4), Math.max(0.001, h * 1.1), 0.24 * (1 - spout * 0.4));
        geyser.position.y = 1.56 + h * 0.6;
      }
      const chatter = Math.max(belch < 1.2 ? 1 - belch / 1.2 : 0, spout < 1.4 && spout >= 0 ? 1 - spout / 1.4 : 0);
      jaw.rotation.x = chatter > 0 ? Math.abs(Math.sin(now * 22)) * 0.55 * chatter : 0;
    },
  };
  return group;
}

// The receiving raft beside the hatch, where crates pile up.
function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.48);
  const m = mats(kit);
  group.add(kit.shadow(2.4, 1.8, 0.3, [0, 0.004, 0]));
  for (let i = 0; i < 6; i += 1) {
    const log = put(group, kit, 'rod', m.wood, 0, 0.0, -0.62 + i * 0.25, 0.115, 2.0 + seeded(i) * 0.2, 0.115);
    log.rotation.z = Math.PI / 2;
    log.position.x = (seeded(i + 4) - 0.5) * 0.15;
  }
  for (const x of [-0.72, 0.72]) put(group, kit, 'block', m.leather, x, 0.06, 0, 0.06, 0.06, 1.42);
  put(group, kit, 'rod', m.wood, 1.08, 0.35, -0.68, 0.06, 0.7, 0.06);
  put(group, kit, 'ring', m.leather, 1.08, 0.45, -0.68, 0.08, 0.08, 0.08).rotation.x = Math.PI / 2;
  put(group, kit, 'ball', m.moss, -0.6, 0.1, 0.55, 0.2, 0.05, 0.12);
  return shade(kit, group);
}

function crate(kit) {
  const group = new Group();
  const wood = kit.mat('crate', { rough: 0.86 });
  const slat = kit.mat('tape', { rough: 0.85 });
  const m = mats(kit);
  group.add(kit.box(0.44, 0.34, 0.44, wood, [0, -0.03, 0]));
  for (const z of [-0.23, 0.23]) {
    group.add(kit.box(0.47, 0.06, 0.02, slat, [0, 0.1, z]));
    group.add(kit.box(0.47, 0.06, 0.02, slat, [0, -0.15, z]));
  }
  for (const [x, z] of [[-0.11, -0.1], [0.1, -0.08], [-0.02, 0.11]]) {
    group.add(kit.cylinder(0.035, 0.07, 0.16, m.glass, [x, 0.2, z], 8));
    group.add(kit.cylinder(0.03, 0.03, 0.06, m.brew, [x, 0.3, z], 6));
  }
  return kit.shadows(group);
}

// A bullfrog hops each finished crate home strapped to its back.
function carrier(kit) {
  const object = new Group();
  const size = new Group();
  size.scale.setScalar(1.25);
  object.add(size);
  const body = new Group();
  size.add(body);
  const skin = kit.mat('frog', { rough: 0.42, metal: 0.06 });
  const belly = kit.mat('belly', { rough: 0.58 });
  const leather = kit.mat('leather', { rough: 0.8 });
  const m = mats(kit);

  const trunk = kit.sphere(0.3, skin, [0, 0.24, -0.02], 14);
  trunk.scale.set(1, 0.72, 1.2);
  body.add(trunk);
  const head = kit.sphere(0.24, skin, [0, 0.3, 0.27], 14);
  head.scale.set(1.05, 0.66, 0.9);
  body.add(head);
  const throat = kit.sphere(0.2, belly, [0, 0.2, 0.3], 12);
  throat.scale.set(0.95, 0.55, 0.85);
  body.add(throat);
  for (const side of [-1, 1]) {
    body.add(kit.sphere(0.085, skin, [side * 0.13, 0.43, 0.33], 10));
    body.add(kit.sphere(0.062, m.gold, [side * 0.135, 0.45, 0.38], 10));
    body.add(kit.sphere(0.03, m.pupil, [side * 0.14, 0.455, 0.435], 8));
    const hand = kit.sphere(0.06, skin, [side * 0.16, 0.04, 0.38], 8);
    hand.scale.set(1.3, 0.4, 1.3);
    body.add(hand);
  }
  body.add(kit.box(0.5, 0.05, 0.12, leather, [0, 0.42, -0.02]));
  for (const side of [-1, 1]) body.add(kit.box(0.04, 0.3, 0.1, leather, [side * 0.27, 0.3, -0.02]));
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.24, 0.16, -0.2);
    const thigh = kit.sphere(0.14, skin, [0, 0, 0], 10);
    thigh.scale.set(0.75, 0.85, 1.35);
    leg.add(thigh);
    const foot = kit.sphere(0.1, skin, [side * 0.03, -0.13, 0.16], 8);
    foot.scale.set(1.3, 0.35, 1.7);
    leg.add(foot);
    body.add(leg);
    legs.push(leg);
  }
  const hold = new Group();
  hold.position.set(0, 0.62, -0.04);
  body.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'ground',
    pose(target, { travel, phase }) {
      if (phase !== 'travel' || kit.reducedMotion) {
        body.position.y = 0;
        body.rotation.x = 0;
        body.scale.set(1, 1, 1);
        for (const leg of legs) leg.rotation.x = 0;
        return;
      }
      const hops = 6;
      const u = (travel * hops) % 1;
      const arc = Math.sin(u * Math.PI);
      target.position.y += arc * 0.55;
      body.rotation.x = (u - 0.5) * 0.7;
      const squash = u < 0.12 ? 1 - (0.12 - u) * 2 : u > 0.9 ? 1 - (u - 0.9) * 2 : 1;
      body.scale.set(2 - squash, squash, 1);
      for (const leg of legs) leg.rotation.x = arc * 1.1;
    },
  };
}

// ---------- the edges of the bog ----------

const TRUNK_PROFILE = [[1.0, 0], [0.7, 0.12], [0.46, 0.4], [0.33, 0.9], [0.26, 1.8], [0.22, 3.4], [0.17, 5.2]];

// A bald cypress: a flared, buttressed trunk with knees round it, a layered
// canopy, curtains of hanging moss and glowing brackets on the bark.
function cypress(kit, group, x, z, scale, lean, seed = 0) {
  const e = extra(kit);
  const tree = pivot(group, x, 0, z);
  tree.scale.setScalar(scale);
  tree.rotation.z = lean;
  tree.rotation.y = seed * 1.3;
  const trunkGeo = memo(kit, 'shape:trunk', () => new LatheGeometry(TRUNK_PROFILE.map(([r, y]) => new Vector2(r, y)), 9));
  const trunk = new Mesh(trunkGeo, e.bark);
  trunk.scale.set(1.25, 1, 1.25);
  tree.add(trunk);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + seed;
    const reach = 1.25 + seeded(seed * 5 + i) * 0.9;
    const tall = 0.3 + seeded(seed * 7 + i) * 0.5;
    put(tree, kit, 'ball', e.bark, Math.cos(a) * reach, 0, Math.sin(a) * reach, 0.13, tall, 0.13);
    const root = put(tree, kit, 'cone', e.bark, Math.cos(a + 0.4) * 0.72, 0.36, Math.sin(a + 0.4) * 0.72, 0.2, 0.95, 0.2);
    root.rotation.set(Math.sin(a + 0.4) * 0.55, 0, -Math.cos(a + 0.4) * 0.55);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = seed * 2 + i * 2.1;
    const y = 1.0 + i * 0.55;
    const r = 0.36 - i * 0.03;
    put(tree, kit, 'ball', e.shroom, Math.cos(a) * r * 1.25, y, Math.sin(a) * r * 1.25, 0.13, 0.035, 0.13);
  }
  const crown = [
    [0, 4.5, 0, 2.5, e.leafLow], [-1.2, 4.9, 0.5, 1.7, e.leafLow], [1.3, 4.8, -0.4, 1.8, e.leafLow],
    [0.2, 5.2, 0.2, 2.0, e.leafMid], [-1.0, 5.45, -0.5, 1.3, e.leafMid], [1.0, 5.5, 0.6, 1.35, e.leafMid],
    [0, 5.85, 0, 1.4, e.leafTop], [-0.9, 5.9, 0.4, 0.8, e.leafTop], [0.9, 6.0, -0.3, 0.85, e.leafTop],
  ];
  for (const [cx, cy, cz, r, mat] of crown) put(tree, kit, 'bead', mat, cx, cy, cz, r, r * 0.34, r).userData.canopy = true;
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * TAU + seed * 0.7;
    const r = 0.9 + seeded(seed * 11 + i) * 1.3;
    const len = 0.7 + seeded(seed * 13 + i) * 1.5;
    const strand = put(tree, kit, 'cone', e.drape, Math.cos(a) * r, 4.45 - len / 2, Math.sin(a) * r, 0.05, len, 0.05);
    strand.rotation.x = Math.PI;
  }
}

function snag(kit, group, x, z, scale, lean) {
  const e = extra(kit);
  const tree = pivot(group, x, 0, z);
  tree.scale.setScalar(scale);
  tree.rotation.z = lean;
  put(tree, kit, 'taper', e.bark, 0, 1.4, 0, 0.16, 2.8, 0.16);
  for (const [y, a, len] of [[1.6, 0.9, 0.9], [2.1, -1.0, 0.7], [2.5, 0.6, 0.5]]) {
    const branch = put(tree, kit, 'taper', e.bark, Math.sin(a) * len * 0.45, y + len * 0.3, 0, 0.04, len, 0.04);
    branch.rotation.z = -a;
  }
  for (const [dx, y, len] of [[0.45, 1.6, 0.7], [-0.4, 2.0, 0.5], [0.2, 2.5, 0.4]]) {
    put(tree, kit, 'cone', e.drape, dx, y, 0, 0.04, len, 0.04).rotation.x = Math.PI;
  }
  put(tree, kit, 'ball', e.shroom, 0.14, 0.8, 0.08, 0.13, 0.04, 0.13);
}

// A drift of duckweed: one of three painted mats laid on the water.
function duckweed(kit, which) {
  const dark = kit.mode === 'dark';
  return memo(kit, `duckweed:${which}`, () => {
    const mat = kit.painted((ctx, w, h) => {
      let state = 977 + which * 7919;
      const rnd = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const lobes = Array.from({ length: 5 }, () => ({ x: w * (0.28 + rnd() * 0.44), y: h * (0.28 + rnd() * 0.44), r: w * (0.1 + rnd() * 0.1) }));
      for (const lobe of lobes) {
        const g = ctx.createRadialGradient(lobe.x, lobe.y, 2, lobe.x, lobe.y, lobe.r * 1.7);
        g.addColorStop(0, dark ? 'rgba(40, 64, 28, 0.62)' : 'rgba(110, 160, 74, 0.6)');
        g.addColorStop(0.6, dark ? 'rgba(36, 58, 26, 0.3)' : 'rgba(110, 160, 74, 0.3)');
        g.addColorStop(1, 'rgba(40, 80, 44, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      for (let i = 0; i < 2600; i += 1) {
        const lobe = lobes[i % lobes.length];
        const a = rnd() * TAU;
        const d = Math.sqrt(rnd()) * rnd() * lobe.r * 2.3;
        const bright = rnd();
        ctx.fillStyle = dark
          ? (bright > 0.9 ? 'rgba(100, 132, 56, 0.85)' : bright > 0.4 ? 'rgba(68, 100, 42, 0.8)' : 'rgba(46, 74, 34, 0.75)')
          : (bright > 0.82 ? 'rgba(160, 196, 92, 0.95)' : bright > 0.4 ? 'rgba(124, 164, 74, 0.9)' : 'rgba(94, 134, 62, 0.85)');
        ctx.beginPath();
        ctx.ellipse(lobe.x + Math.cos(a) * d, lobe.y + Math.sin(a) * d, 1.1 + bright * 1.7, 0.9 + bright * 1.3, a, 0, TAU);
        ctx.fill();
      }
    }, { width: 512, height: 512, transparent: true, rough: 0.9, metal: 0 });
    mat.depthWrite = false;
    return mat;
  });
}

// A film of scum: a torn, brownish skin on the water with froth at its edge.
function scum(kit, which) {
  const dark = kit.mode === 'dark';
  return memo(kit, `scum:${which}`, () => {
    const mat = kit.painted((ctx, w, h) => {
      let state = 31337 + which * 104729;
      const rnd = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const blobs = Array.from({ length: 9 }, () => ({ x: w * (0.22 + rnd() * 0.56), y: h * (0.3 + rnd() * 0.4), r: w * (0.08 + rnd() * 0.12) }));
      for (const blob of blobs) {
        const g = ctx.createRadialGradient(blob.x, blob.y, blob.r * 0.2, blob.x, blob.y, blob.r * 1.5);
        g.addColorStop(0, dark ? 'rgba(62, 64, 26, 0.5)' : 'rgba(120, 124, 60, 0.5)');
        g.addColorStop(0.7, dark ? 'rgba(50, 58, 24, 0.3)' : 'rgba(110, 120, 60, 0.3)');
        g.addColorStop(1, 'rgba(50, 58, 24, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 14; i += 1) {
        const blob = blobs[i % blobs.length];
        const x = blob.x + (rnd() - 0.5) * blob.r * 2;
        const y = blob.y + (rnd() - 0.5) * blob.r * 2;
        const r = 6 + rnd() * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 520; i += 1) {
        const blob = blobs[i % blobs.length];
        const a = rnd() * TAU;
        const d = blob.r * (1.0 + rnd() * 0.5);
        ctx.fillStyle = dark ? `rgba(150, 156, 96, ${(0.1 + rnd() * 0.16).toFixed(3)})` : `rgba(226, 230, 180, ${(0.2 + rnd() * 0.2).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(blob.x + Math.cos(a) * d, blob.y + Math.sin(a) * d, 0.8 + rnd() * 1.6, 0, TAU);
        ctx.fill();
      }
    }, { width: 512, height: 512, transparent: true, rough: 0.8, metal: 0 });
    mat.depthWrite = false;
    return mat;
  });
}

// The moon lying on the water, with its glitter running towards the viewer.
function moonOnWater(kit) {
  const mat = kit.painted((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.2, 2, w / 2, h * 0.2, w * 0.3);
    g.addColorStop(0, 'rgba(190, 232, 226, 0.16)');
    g.addColorStop(0.4, 'rgba(150, 214, 200, 0.16)');
    g.addColorStop(1, 'rgba(120, 200, 190, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const disc = ctx.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.2, w * 0.06);
    disc.addColorStop(0, 'rgba(236, 248, 236, 0.9)');
    disc.addColorStop(0.86, 'rgba(222, 242, 230, 0.8)');
    disc.addColorStop(1, 'rgba(200, 236, 226, 0)');
    ctx.fillStyle = disc;
    ctx.fillRect(0, 0, w, h * 0.5);
    for (let i = 0; i < 46; i += 1) {
      const t = i / 46;
      const y = h * (0.25 + t * 0.6);
      const spread = w * (0.05 + t * 0.26);
      const x = w / 2 + (seeded(i * 7 + 3) - 0.5) * spread;
      ctx.fillStyle = `rgba(214, 240, 228, ${(0.5 * (1 - t) ** 1.3).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, w * (0.02 + seeded(i * 5 + 1) * 0.05), 1.3, 0, 0, TAU);
      ctx.fill();
    }
  }, { width: 256, height: 512, basic: true, additive: true });
  mat.fog = false;
  const mesh = new Mesh(new PlaneGeometry(6.4, 12.8), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function decor(kit) {
  const group = new Group();
  const m = mats(kit);
  const e = extra(kit);
  const dark = kit.mode === 'dark';

  [
    [-11.6, -9.4, 1.05, 0.04], [11.8, -9.0, 1.0, -0.05], [-12.8, 1.4, 0.9, 0.06],
    [13.0, 3.6, 0.95, -0.03], [-12.2, 9.6, 0.85, 0.02], [7.4, -14.2, 0.95, 0.02], [-7.2, -14.6, 0.9, -0.04],
    [2.6, -17.5, 0.85, 0.03], [-2.8, -18.2, 0.8, -0.02], [-15.5, -6.0, 1.0, 0.03], [15.6, -4.5, 1.0, -0.04],
  ].forEach(([x, z, s, lean], i) => cypress(kit, group, x, z, s * 1.1, lean, i + 1));
  // A far rank of trunks, lost in the mist.
  for (let i = 0; i < 16; i += 1) {
    const x = -30 + i * 4 + (seeded(i + 400) - 0.5) * 2.4;
    const z = -21 - seeded(i + 420) * 7;
    const h = 7 + seeded(i + 440) * 3;
    put(group, kit, 'taper', e.bark, x, h / 2, z, 0.45 + seeded(i + 460) * 0.3, h, 0.45).rotation.z = (seeded(i + 480) - 0.5) * 0.12;
    put(group, kit, 'bead', e.leafLow, x, h, z, 3.4, 1.0, 3.4).userData.canopy = true;
  }
  for (const [x, z, s, lean] of [[-10.3, -5.4, 1.0, 0.16], [10.6, -3.6, 1.15, -0.2], [10.4, 8.8, 0.9, 0.12], [0.6, -9.4, 0.85, -0.1]]) {
    snag(kit, group, x, z, s, lean);
  }

  // Duckweed drifts and lily pads across the open water. All of it lies flat, so a station can stand over any of it.
  const quad = memo(kit, 'shape:quad', () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  for (let i = 0; i < 64; i += 1) {
    const x = (seeded(i * 3 + 801) - 0.5) * 44;
    const z = -20 + seeded(i * 3 + 802) * 34;
    if (Math.abs(x) < 1.9 && z > -3.4) continue;
    if (Math.abs(x) < 3.2 && z > -7.6 && z <= -3.4) continue;
    const mesh = new Mesh(quad, duckweed(kit, i % 3));
    mesh.userData.decal = true;
    const size = 2.6 + seeded(i * 3 + 803) * 3.6;
    mesh.position.set(x, 0.006 + (i % 5) * 0.0006, z);
    mesh.scale.set(size, 1, size * (0.6 + seeded(i + 870) * 0.3));
    mesh.rotation.y = seeded(i + 880) * TAU;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = (seeded(i * 3 + 1201) - 0.5) * 46;
    const z = -20 + seeded(i * 3 + 1202) * 34;
    if (Math.abs(x) < 3.2 && z > -7.6 && z <= -3.4) continue;
    const mesh = new Mesh(quad, scum(kit, i % 3));
    mesh.userData.decal = true;
    const size = 5 + seeded(i * 3 + 1203) * 5;
    mesh.position.set(x, 0.004 + (i % 5) * 0.0003, z);
    mesh.scale.set(size, 1, size * (0.45 + seeded(i + 1270) * 0.3));
    mesh.rotation.y = (seeded(i + 1280) - 0.5) * 0.9;
    group.add(mesh);
  }
  // Twigs and dead reed adrift.
  for (let i = 0; i < 22; i += 1) {
    const x = (seeded(i * 3 + 1401) - 0.5) * 30;
    const z = -14 + seeded(i * 3 + 1402) * 26;
    if (Math.abs(x) < 2.2 && z > -8) continue;
    const twig = put(group, kit, 'rod', i % 3 ? e.bark : m.reed, x, 0.012, z, 0.016, 0.4 + seeded(i + 1450) * 0.7, 0.016);
    twig.rotation.set(0, seeded(i + 1460) * TAU, Math.PI / 2);
  }
  for (let i = 0; i < 22; i += 1) {
    const cx = (seeded(i * 5 + 901) - 0.5) * 32;
    const cz = -15 + seeded(i * 5 + 902) * 28;
    if (Math.abs(cx) < 2.4 && cz > -8) continue;
    const count = 2 + Math.floor(seeded(i + 930) * 4);
    for (let k = 0; k < count; k += 1) {
      const a = k * 2.4 + i;
      const d = k ? 0.42 + seeded(i * 9 + k) * 0.5 : 0;
      const r = (k ? 0.2 : 0.36) + seeded(i * 13 + k) * 0.2;
      lilyPad(kit, group, cx + Math.cos(a) * d, cz + Math.sin(a) * d, r, seeded(i * 17 + k) * TAU, k === 0 && i % 2 === 0 ? 0.15 : 0);
    }
  }

  // Moonlight: the moon mirrored in the water behind the dock, and the glade it lights.
  if (dark) {
    const moon = moonOnWater(kit);
    moon.position.set(8.0, 0.012, -7.6);
    moon.rotation.z = 0.16;
    group.add(moon);
    for (const [x, z, r] of [[7.3, -6.2, 0.4], [8.9, -5.1, 0.3], [8.3, -9.6, 0.34], [6.6, -8.3, 0.24]]) lilyPad(kit, group, x, z, r, x * 2);
    group.add(kit.halo('#8fbf9a', 26, 22, { opacity: 0.045, at: [7.2, 0.011, -6.0] }));
    group.add(kit.halo('#8fbf9a', 16, 13, { opacity: 0.025, at: [-8.5, 0.011, 3.4] }));
  }

  // A drowned shack on its own stilts, a lamp still burning in its window.
  const shack = pivot(group, -8.6, 0, -10.6);
  shack.rotation.set(0, 0.5, 0.08);
  for (const [x, z] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) put(shack, kit, 'rod', m.wood, x, 0.7, z, 0.06, 1.4, 0.06);
  put(shack, kit, 'block', m.plank, 0, 1.3, 0.2, 2.1, 0.08, 1.9);
  put(shack, kit, 'block', boards(kit), 0, 1.78, 0, 1.8, 0.9, 1.4);
  put(shack, kit, 'cone', thatch(kit), 0, 2.66, 0, 1.5, 0.95, 1.2).rotation.y = Math.PI / 4;
  put(shack, kit, 'block', e.warm, 0.3, 1.8, 0.71, 0.3, 0.26, 0.02);
  put(shack, kit, 'block', e.warm, -0.9, 1.8, 0.2, 0.02, 0.24, 0.26);
  put(shack, kit, 'ball', e.warm, 0.95, 1.9, 0.98, 0.07);
  group.add(kit.halo('#ff9a3a', 5.0, 4.4, { opacity: dark ? 0.3 : 0.05, at: [-8.2, 0.014, -9.4] }));

  // A rowboat tied to a lantern stake.
  const boat = pivot(group, 10.8, 0, 6.2);
  boat.rotation.set(0.04, 0.7, 0.06);
  put(boat, kit, 'ball', m.plank, 0, 0.02, 0, 0.5, 0.32, 1.1);
  put(boat, kit, 'ball', kit.mat('mudWet', { rough: 0.4 }), 0, 0.09, 0, 0.4, 0.2, 0.95);
  put(boat, kit, 'block', m.wood, 0, 0.2, 0.3, 0.84, 0.04, 0.16);
  put(boat, kit, 'block', m.wood, 0.1, 0.24, -0.2, 0.06, 0.04, 1.5).rotation.y = 0.5;
  trailLamp(kit, group, 11.9, 5.4, -0.1);

  // A hollow log grown over with glowing mushrooms.
  const log = put(group, kit, 'rod', e.bark, -10.6, 0.22, 4.2, 0.34, 2.6, 0.34);
  log.rotation.set(0, 0.3, Math.PI / 2);
  for (let i = 0; i < 7; i += 1) {
    const s = 0.1 + seeded(i + 60) * 0.1;
    put(group, kit, 'rod', m.paper, -11.6 + i * 0.34, 0.5 + s * 0.6, 4.0 + i * 0.1, 0.025, s * 1.4, 0.025);
    put(group, kit, 'ball', e.shroom, -11.6 + i * 0.34, 0.52 + s * 1.3, 4.0 + i * 0.1, s, s * 0.55, s);
  }
  group.add(kit.halo('wisp', 4.4, 3.2, { opacity: dark ? 0.26 : 0.04, at: [-10.6, 0.014, 4.6] }));
  for (const [x, z, s] of [[10.2, -1.4, 0.4], [10.6, -1.0, 0.25], [-10.2, 7.0, 0.35], [-3.4, -8.8, 0.3]]) {
    put(group, kit, 'ball', m.stone, x, 0.05, z, s, s * 0.45, s * 0.8);
    put(group, kit, 'ball', m.moss, x, 0.05 + s * 0.4, z, s * 0.7, s * 0.14, s * 0.56);
  }

  const clusters = [[-10.2, -3.0], [-10.0, 6.4], [10.1, 1.4], [10.0, 10.4], [-6.0, -8.4], [-9.8, 10.6], [2.0, -8.6], [-1.8, -8.7], [-13.4, -2.2], [13.2, -1.4]];
  clusters.forEach(([x, z], i) => {
    const holder = pivot(group, x, -0.15, z);
    reeds(kit, holder, 0, 0, 9, i * 3, 1.7);
    reeds(kit, holder, 0.3, 0.16, 6, i * 3 + 1, 1.3);
    for (let k = 0; k < 6; k += 1) {
      const blade = put(holder, kit, 'cone', e.grass, Math.cos(k * 1.1) * 0.22, 0.5, Math.sin(k * 1.1) * 0.22, 0.03, 0.8, 0.012);
      blade.rotation.z = Math.cos(k * 1.1) * -0.4;
    }
  });
  shade(kit, group);
  // A canopy's shadow would lie on the water as one hard slab.
  group.traverse(child => { if (child.userData.canopy) child.castShadow = false; });
  return bake(group);
}

// ---------- the air ----------

// Moonbeams, low mist, warm fireflies, will-o'-the-wisps that light the water
// under them, and the odd popping bubble.
function weather(kit) {
  const dark = kit.mode === 'dark';
  const motion = !kit.reducedMotion;
  const object = new Group();
  const owned = [];
  const own = thing => {
    owned.push(thing);
    return thing;
  };
  const softTexture = (stops) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return own(texture);
  };
  const glowTex = softTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.5)'], [0.5, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
  const mistTex = softTexture([[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.42)'], [1, 'rgba(255,255,255,0)']]);
  const orb = own(new SphereGeometry(1, 8, 6));
  const plane = own(new PlaneGeometry(1, 1));
  const ringGeo = own(new RingGeometry(0.93, 1, 32));
  const blending = dark ? AdditiveBlending : NormalBlending;

  // Moonbeams slanting down through the canopy onto the glade.
  if (dark) {
    const beamCanvas = document.createElement('canvas');
    beamCanvas.width = 64;
    beamCanvas.height = 256;
    const ctx = beamCanvas.getContext('2d');
    const across = ctx.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const along = ctx.createLinearGradient(0, 0, 0, 256);
    along.addColorStop(0, 'rgba(255,255,255,0.9)');
    along.addColorStop(0.75, 'rgba(255,255,255,0.5)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, 64, 256);
    const beamTex = own(new CanvasTexture(beamCanvas));
    beamTex.colorSpace = SRGBColorSpace;
    const beamMat = own(new MeshBasicMaterial({
      map: beamTex, color: '#b4dcc0', transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, fog: false,
    }));
    for (const [x, z, width, lean] of [[5.2, -8.6, 2.2, 0.3], [7.6, -7.2, 1.5, 0.34], [9.6, -9.2, 2.8, 0.27], [11.4, -6.4, 1.3, 0.36], [-9.6, 0.4, 1.2, 0.32]]) {
      const beam = new Mesh(plane, beamMat);
      beam.scale.set(width, 15, 1);
      beam.rotation.set(0, -0.16, lean);
      beam.position.set(x + Math.sin(lean) * 7.5, 7.2, z);
      beam.renderOrder = 3;
      object.add(beam);
    }
  }

  const mistMat = own(new MeshBasicMaterial({
    map: mistTex, color: dark ? '#8fae9c' : '#f4f8ee', transparent: true, opacity: dark ? 0.09 : 0.4, depthWrite: false,
  }));
  const mist = Array.from({ length: 16 }, (_, i) => {
    const mesh = new Mesh(plane, mistMat);
    mesh.rotation.x = -Math.PI / 2;
    const far = i % 2 === 0;
    const home = { x: (seeded(i + 11) - 0.5) * 34, y: 0.25 + (i % 4) * 0.16, z: far ? -18 + seeded(i + 21) * 8 : -8 + seeded(i + 21) * 20 };
    mesh.scale.set((far ? 11 : 6) + seeded(i + 31) * 6, (far ? 4.5 : 2.6) + seeded(i + 41) * 2.4, 1);
    mesh.position.set(home.x, home.y, home.z);
    mesh.renderOrder = 2;
    object.add(mesh);
    return { mesh, home, speed: 0.1 + seeded(i + 51) * 0.14 };
  });

  const wispColor = kit.palette.wisp;
  const wispCore = own(new MeshBasicMaterial({ color: '#eafff8', transparent: true, opacity: 0.95, blending, depthWrite: false }));
  const wispHalo = own(new SpriteMaterial({ map: glowTex, color: wispColor, transparent: true, opacity: dark ? 0.85 : 0.5, blending, depthWrite: false }));
  const wispPool = own(new MeshBasicMaterial({ map: glowTex, color: wispColor, transparent: true, opacity: dark ? 0.3 : 0.08, blending, depthWrite: false }));
  const wisps = [[-8.8, 1.3, -4.5], [9.2, 1.6, 2.5], [-9.4, 1.1, 7.5], [5.5, 2.0, -7.6], [-4.6, 1.2, 5.4]].map(([x, y, z], i) => {
    const core = new Mesh(orb, wispCore);
    core.scale.set(0.06, 0.085, 0.06);
    const halo = new Sprite(wispHalo);
    halo.scale.setScalar(1.5);
    const tail = new Sprite(wispHalo);
    tail.scale.set(0.5, 0.9, 1);
    tail.position.y = 0.28;
    const holder = new Group();
    holder.add(core, halo, tail);
    holder.position.set(x, y, z);
    const pool = new Mesh(plane, wispPool);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.setScalar(3.4);
    pool.position.set(x, 0.02, z);
    object.add(holder, pool);
    return { holder, pool, home: { x, y, z }, phase: i * 1.9 };
  });

  const fireflyMat = own(new MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.95, blending, depthWrite: false }));
  const fireflyGlow = own(new SpriteMaterial({ map: glowTex, color: kit.palette.firefly, transparent: true, opacity: dark ? 0.8 : 0.5, blending, depthWrite: false }));
  const flies = Array.from({ length: 34 }, (_, i) => {
    const mesh = new Mesh(orb, fireflyMat);
    const glow = new Sprite(fireflyGlow);
    glow.scale.setScalar(12);
    mesh.add(glow);
    const home = { x: ((i * 37) % 28) - 14, y: 0.5 + (i % 5) * 0.35, z: ((i * 53) % 22) - 9 };
    mesh.position.set(home.x, home.y, home.z);
    mesh.scale.setScalar(0.028);
    object.add(mesh);
    return { mesh, home, phase: i * 0.79 };
  });

  const bubbleMat = own(new MeshBasicMaterial({ color: dark ? '#9fd8a0' : '#e8f4dc', transparent: true, opacity: 0.5, depthWrite: false }));
  const bubbles = Array.from({ length: 7 }, (_, i) => {
    const dome = new Mesh(orb, bubbleMat);
    const ringMat = own(new MeshBasicMaterial({ color: dark ? '#b6e8c8' : '#f4faee', transparent: true, opacity: 0, depthWrite: false }));
    const ring = new Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    dome.visible = ring.visible = false;
    object.add(dome, ring);
    return { dome, ring, ringMat, period: 3.5 + seeded(i + 70) * 3, offset: seeded(i + 80) * 5, seed: i * 13 };
  });

  return {
    object,
    frame(time) {
      if (!motion) return;
      for (const { mesh, home, speed } of mist) {
        const x = home.x + time * speed;
        mesh.position.x = ((x + 20) % 40 + 40) % 40 - 20;
      }
      for (const { holder, pool, home, phase } of wisps) {
        holder.position.set(
          home.x + Math.sin(time * 0.31 + phase) * 1.2,
          home.y + Math.sin(time * 0.9 + phase) * 0.3,
          home.z + Math.cos(time * 0.23 + phase) * 1.4,
        );
        holder.scale.setScalar(0.85 + 0.15 * Math.sin(time * 2.3 + phase));
        pool.position.set(holder.position.x, 0.02, holder.position.z);
      }
      for (const { mesh, home, phase } of flies) {
        mesh.position.set(
          home.x + Math.sin(time * 0.62 + phase) * 0.82,
          home.y + Math.sin(time * 1.35 + phase * 2) * 0.26,
          home.z + Math.cos(time * 0.52 + phase) * 0.82,
        );
        mesh.scale.setScalar(0.028 * (0.35 + 0.65 * Math.abs(Math.sin(time * 1.6 + phase * 2.3))));
      }
      for (const bubble of bubbles) {
        const t = time + bubble.offset;
        const cycle = Math.floor(t / bubble.period);
        const u = t - cycle * bubble.period;
        const pick = bubble.seed + cycle * 7;
        const side = seeded(pick) < 0.5 ? -1 : 1;
        const x = side * (1.3 + seeded(pick + 1) * 9);
        const z = -6 + seeded(pick + 2) * 16;
        const size = 0.06 + seeded(pick + 3) * 0.07;
        const grow = u < 1.2;
        const pop = u >= 1.2 && u < 1.8;
        bubble.dome.visible = grow;
        bubble.ring.visible = pop;
        if (grow) {
          bubble.dome.position.set(x, 0, z);
          bubble.dome.scale.setScalar(size * ease(u / 1.2));
        } else if (pop) {
          const k = (u - 1.2) / 0.6;
          bubble.ring.position.set(x, 0.02, z);
          bubble.ring.scale.setScalar(size + k * 0.5);
          bubble.ringMat.opacity = 0.45 * (1 - k);
        }
      }
    },
    dispose() {
      for (const thing of owned) thing.dispose();
    },
  };
}

// The advisor: an owl on a stump, reading at a lectern on its own islet
// beside the hall. Pages from the hall land on its book; while it reads it
// tilts its head over them, blinks and turns a leaf now and then.
function advisor(kit) {
  const m = mats(kit);
  const dark = kit.mode === 'dark';
  const feather = kit.mat(dark ? '#5b5fa3' : '#6c70b6', { rough: 0.7 });
  const down = kit.mat(dark ? '#c7c0dc' : '#d9d2ea', { rough: 0.8 });
  const bark = kit.mat(dark ? '#4d3a2c' : '#6b513c', { rough: 0.95, flat: true });
  const root = new Group();
  islet(kit, root, 0.62, 0.56, 41);
  // The stump it perches on, and the lectern before it.
  put(root, kit, 'taper', bark, 0, 0.42, -0.12, 0.2, 0.5, 0.2);
  put(root, kit, 'disc', m.wood, 0, 0.68, -0.12, 0.22, 0.03, 0.22);
  put(root, kit, 'rod', bark, 0.02, 0.55, 0.36, 0.05, 0.72, 0.05);
  const desk = pivot(root, 0.02, 0.92, 0.38);
  desk.rotation.x = 0.5;
  put(desk, kit, 'block', m.wood, 0, 0, 0, 0.5, 0.04, 0.34);
  put(desk, kit, 'block', m.leather, 0, 0.03, 0, 0.44, 0.02, 0.3);
  put(desk, kit, 'block', m.paper, -0.11, 0.045, 0, 0.2, 0.012, 0.27);
  put(desk, kit, 'block', m.paper, 0.11, 0.045, 0, 0.2, 0.012, 0.27);
  const leaf = pivot(desk, 0, 0.05, 0);
  put(leaf, kit, 'block', m.paper, 0.1, 0, 0, 0.19, 0.01, 0.26);
  // A candle in a jar keeps the page lit.
  put(root, kit, 'rod', m.glass, 0.36, 1.02, 0.42, 0.05, 0.12, 0.05);
  const flame = put(root, kit, 'bead', m.lantern, 0.36, 1.03, 0.42, 0.03, 0.05, 0.03);
  // The owl.
  const owl = pivot(root, 0, 0.7, -0.12);
  const body = pivot(owl, 0, 0, 0);
  put(body, kit, 'ball', feather, 0, 0.3, 0, 0.27, 0.33, 0.24);
  put(body, kit, 'ball', down, 0, 0.26, 0.1, 0.19, 0.25, 0.16);
  for (const [x, y] of [[-0.06, 0.32], [0.06, 0.24], [-0.05, 0.16], [0.07, 0.38]]) {
    put(body, kit, 'cone', feather, x, y, 0.255, 0.025, 0.04, 0.012).rotation.x = Math.PI;
  }
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = pivot(body, side * 0.22, 0.42, -0.02);
    put(wing, kit, 'ball', feather, side * 0.03, -0.14, 0, 0.08, 0.2, 0.16);
    wings.push(wing);
    put(owl, kit, 'rod', m.gold, side * 0.08, 0.02, 0.08, 0.018, 0.06, 0.018);
  }
  const head = pivot(body, 0, 0.66, 0.02);
  put(head, kit, 'ball', feather, 0, 0, 0, 0.25, 0.22, 0.22);
  put(head, kit, 'ball', down, 0, -0.02, 0.1, 0.2, 0.16, 0.14);
  const lids = [];
  for (const side of [-1, 1]) {
    put(head, kit, 'cone', feather, side * 0.16, 0.2, -0.02, 0.06, 0.14, 0.05).rotation.z = -side * 0.35;
    put(head, kit, 'ball', m.gold, side * 0.085, 0.02, 0.19, 0.07);
    put(head, kit, 'bead', m.pupil, side * 0.085, 0.02, 0.255, 0.033, 0.033, 0.015);
    // Spectacles: a reading owl wears them.
    put(head, kit, 'ring', m.copper, side * 0.085, 0.02, 0.27, 0.078, 0.078, 0.06);
    const lid = put(head, kit, 'ball', feather, side * 0.085, 0.05, 0.205, 0.072, 0.04, 0.05);
    lid.scale.y = 0.001;
    lids.push(lid);
  }
  put(head, kit, 'block', m.copper, 0, 0.025, 0.27, 0.035, 0.008, 0.01);
  put(head, kit, 'cone', m.bone, 0, -0.07, 0.23, 0.03, 0.08, 0.03).rotation.x = Math.PI * 0.9;
  shade(kit, root);
  root.scale.setScalar(1.35);
  root.userData = {
    labelY: 2.6,
    page: new Vector3(0.03, 1.35, 0.54),
    frame(time, dt, state) {
      const reading = state.activity;
      head.rotation.x = 0.32 * reading + Math.sin(time * 0.7) * 0.03;
      head.rotation.y = Math.sin(time * 0.55) * 0.22 * reading;
      head.rotation.z = Math.sin(time * 0.4) * 0.08;
      body.rotation.z = Math.sin(time * 0.9) * 0.025;
      const blink = (time % 4.3) < 0.16 ? 1 : 0;
      for (const lid of lids) lid.scale.y = Math.max(0.001, blink * 0.04 + (1 - reading) * 0.02);
      // Every few seconds the owl turns a leaf with its wing.
      const turn = clamp01(((time * 0.33) % 1 - 0.7) / 0.3) * reading;
      leaf.rotation.z = -Math.PI * ease(turn);
      wings[1].rotation.x = -Math.sin(turn * Math.PI) * 0.5;
      wings[0].rotation.z = Math.sin(time * 1.3) * 0.04;
      flame.scale.set(0.03, 0.05 + Math.sin(time * 11) * 0.008, 0.03);
    },
  };
  return root;
}

export default {
  palette: PALETTE,
  backdrop: BACKDROP,
  layout: { bend: 0.18, stagger: 0.32, jitter: 0.25, turn: 0.32 },
  view: { elevation: 0.48, azimuth: -0.16 },
  pad: false,
  ghost,
  dock,
  floor,
  hall,
  station,
  crate,
  carrier,
  decor,
  weather,
  advisor,
};
