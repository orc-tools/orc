// Ocean's Factory floor: the reef works on the sea bed. The main agent is a
// galleon broken across the reef, its cargo hatch the door and an anglerfish
// in the crow's nest dangling the beacon. A trail of glowing sea glass leads up
// to it through a reef amphitheatre where sea creatures run little industries,
// and a manta ray glides each finished sea chest home.
import {
  BufferAttribute, BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry,
  Group, Mesh, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, Shape, SphereGeometry,
  TorusGeometry, Vector3,
} from 'three';

const PALETTE = {
  light: {
    ground: '#e0d09f', horizon: '#86d6de', zenith: '#c2eff2', sky: '#d8f6f6', sun: '#fff6dc', glow: '#45e3ee',
    aisle: '#bfe9d8', line: '#a88f5c', body: '#7d6a4e', trim: '#4a3a2a', roof: '#c99a3e',
    accent: '#f0b232', worker: '#e87892', busy: '#e8a21a', ok: '#0a9e68', fail: '#d4381f', idle: '#7d9ba3',
    crate: '#8c532a', tape: '#deb044', smoke: '#effdff', window: '#ffd98a', door: '#1c2a2e',
    hull: '#7a6b52', hullDark: '#4f4334', brass: '#cda042', brassDark: '#8b6722', iron: '#3a4a50',
    sand: '#e7d8ab', patch: '#d9c48f', rock: '#8d9690', rockDark: '#66716e',
    kelp: '#3c8f4a', kelpLight: '#6bbf5e', coralPink: '#ff7868', coralViolet: '#b868e0',
    coralGold: '#ffb23e', coralCyan: '#3ccfc0', pearl: '#fff7ec', ink: '#3a2650',
    clam: '#c9a3d6', clamInner: '#ffd6dc', crab: '#e35c3a', octo: '#d4607a', octoPale: '#e9ccd2',
    puffer: '#f0c445', shrimp: '#ff6a55', star: '#ff8748', horse: '#ffb23e', eel: '#5f8c3c',
    forge: '#ff9a3c', soot: '#3b302c', glassA: '#7febc4', glassB: '#62cdec', glassC: '#ffd27a', glassD: '#c3b0ff',
    manta: '#2f5674', belly: '#eef6f6', sail: '#e9dcc0', angler: '#4b3f5c', net: '#6a5640', cork: '#e0763a',
    sunIntensity: 2.2, skyIntensity: 1.5, envIntensity: 0.6, exposure: 1.04, fogNear: 6, fogSpan: 22,
  },
  dark: {
    ground: '#163444', horizon: '#06233a', zenith: '#020d18', sky: '#3f8fb0', sun: '#9fdcff', glow: '#3ee0e8',
    aisle: '#2b5566', line: '#1d3e4c', body: '#3d4644', trim: '#1e292b', roof: '#c99c42',
    accent: '#3ee0e8', worker: '#e06c96', busy: '#ffd27a', ok: '#5ff5b8', fail: '#ff6b6b', idle: '#557785',
    crate: '#7b4a28', tape: '#e5b84b', smoke: '#a8f2ff', window: '#ffcf70', door: '#04121c',
    hull: '#4a4c44', hullDark: '#2c2e29', brass: '#c79a40', brassDark: '#7c5d20', iron: '#26363e',
    sand: '#1f4252', patch: '#2b5262', rock: '#3c5260', rockDark: '#273944',
    kelp: '#22693f', kelpLight: '#3ea25a', coralPink: '#ff7a70', coralViolet: '#c682ff',
    coralGold: '#ffc452', coralCyan: '#4cf5e0', pearl: '#f6f0ff', ink: '#2c1a44',
    clam: '#9d7bb8', clamInner: '#ffb8cc', crab: '#e8583a', octo: '#d65c80', octoPale: '#b8a4ae',
    puffer: '#f2c84b', shrimp: '#ff6a55', star: '#ff8748', horse: '#ffbe52', eel: '#6a9a42',
    forge: '#ffa040', soot: '#1e1816', glassA: '#5ff5c0', glassB: '#4ccff5', glassC: '#ffd27a', glassD: '#b9a4ff',
    manta: '#29496a', belly: '#c9dde6', sail: '#b9ae98', angler: '#3b3150', net: '#5a4a38', cork: '#d86a32',
    sunIntensity: 1.9, skyIntensity: 1.45, envIntensity: 0.75, exposure: 1.15, fogNear: 5, fogSpan: 20,
  },
};

const BACKDROP = {
  light: 'radial-gradient(ellipse 70% 45% at 50% -4%, rgba(255,255,236,0.7) 0%, transparent 72%), '
    + 'linear-gradient(180deg, #a6e9ee 0%, #79d0db 40%, #8fd2cf 70%, #c9dfbf 100%)',
  dark: 'radial-gradient(ellipse 60% 40% at 50% -6%, rgba(90,210,235,0.28) 0%, transparent 72%), '
    + 'linear-gradient(180deg, #020c18 0%, #04203a 42%, #0a3448 72%, #123c4c 100%)',
};

const GLASS = ['glassA', 'glassB', 'glassC', 'glassD'];
const CORALS = ['coralPink', 'coralViolet', 'coralGold', 'coralCyan'];
const UP = new Vector3(0, 1, 0);

const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = t => Math.max(0, Math.min(1, t));
const back = t => {
  const u = clamp01(t) - 1;
  return 1 + u * u * (2.7 * u + 1.7);
};

const cache = new WeakMap();
function bag(kit) {
  let found = cache.get(kit);
  if (!found) {
    found = { kelp: [], pulses: [], shafts: [], caustics: [] };
    cache.set(kit, found);
  }
  return found;
}
const memo = (kit, key, build) => {
  const store = bag(kit);
  return (store[key] ||= build());
};

const glowing = (kit, key, glow = 1.1) => kit.mat(key, { emissive: key, glow, rough: 0.32 });
const flat = (kit, key, rough = 0.85) => kit.mat(key, { rough, flat: true });

function blob(kit, radius, material, at, scale = [1, 1, 1], detail = 8) {
  const mesh = kit.sphere(radius, material, at, detail);
  mesh.scale.set(...scale);
  return mesh;
}

// A tapering limb along +y from its group, bending at `joints`.
function limb(material, length, radius, segments = 3) {
  const root = new Group();
  const joints = [root];
  let parent = root;
  const step = length / segments;
  for (let i = 0; i < segments; i += 1) {
    const r0 = radius * (1 - i / segments) + 0.01;
    const r1 = radius * (1 - (i + 1) / segments) + 0.01;
    const piece = new Mesh(new CylinderGeometry(r1, r0, step * 1.08, 6), material);
    piece.position.y = step / 2;
    parent.add(piece);
    if (i < segments - 1) {
      const joint = new Group();
      joint.position.y = step;
      parent.add(joint);
      joints.push(joint);
      parent = joint;
    }
  }
  return { root, joints };
}

const scratch = new Vector3();
function aim(object, from, to) {
  object.position.set(...from);
  scratch.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  object.quaternion.setFromUnitVectors(UP, scratch);
  return object;
}

function eyes(kit, group, x, y, z, size = 0.06, pupilKey = '#14161c') {
  const white = kit.mat('#f8f6ee', { rough: 0.3 });
  const pupil = kit.mat(pupilKey, { rough: 0.2 });
  for (const side of [-1, 1]) {
    group.add(kit.sphere(size, white, [side * x, y, z], 8));
    group.add(kit.sphere(size * 0.55, pupil, [side * x, y, z + size * 0.62], 6));
  }
}

// ---------- sea floor ----------

function sandDraw(kit) {
  const dark = kit.mode === 'dark';
  return (ctx, w, h) => {
    ctx.fillStyle = dark ? '#173748' : '#e0d09f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i += 1) {
      const y0 = (i / 26) * h;
      ctx.strokeStyle = i % 2 ? (dark ? 'rgba(80,150,170,0.16)' : 'rgba(255,250,230,0.5)') : (dark ? 'rgba(4,20,30,0.28)' : 'rgba(150,120,70,0.22)');
      ctx.lineWidth = i % 2 ? 4 : 3;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin((x / w) * Math.PI * 4 + i * 0.7) * 5 + Math.sin((x / w) * Math.PI * 2 + i) * 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 420; i += 1) {
      ctx.fillStyle = seeded(i + 7) > 0.5 ? (dark ? 'rgba(120,200,220,0.18)' : 'rgba(255,255,245,0.6)') : (dark ? 'rgba(0,10,20,0.3)' : 'rgba(120,96,60,0.28)');
      ctx.fillRect(seeded(i) * w, seeded(i + 900) * h, 2, 2);
    }
  };
}

// Bright where a texel is nearly as close to its second-nearest cell as to
// its nearest, which is how light focused through a rippled surface looks.
function causticMaterial(kit, repeat, seed) {
  const dark = kit.mode === 'dark';
  return kit.painted((ctx, w, h) => {
    const points = Array.from({ length: 14 }, (_, i) => [seeded(seed + i * 2) * w, seeded(seed + i * 2 + 1) * h]);
    const image = ctx.createImageData(w, h);
    const tint = dark ? [120, 235, 255] : [255, 255, 236];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let first = Infinity;
        let second = Infinity;
        for (const [px, py] of points) {
          const dx = Math.min(Math.abs(x - px), w - Math.abs(x - px));
          const dy = Math.min(Math.abs(y - py), h - Math.abs(y - py));
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < first) {
            second = first;
            first = d;
          } else if (d < second) second = d;
        }
        const edge = Math.max(0, 1 - (second - first) / 7);
        const value = edge * edge;
        const at = (y * w + x) * 4;
        image.data[at] = tint[0] * value;
        image.data[at + 1] = tint[1] * value;
        image.data[at + 2] = tint[2] * value;
        image.data[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, { width: 128, height: 128, repeat, basic: true, additive: true, transparent: true, opacity: dark ? 0.16 : 0.17 });
}

function seaGrass(kit, x, z, height, seed) {
  const group = new Group();
  const blade = kit.mat(seed % 2 ? 'kelp' : 'kelpLight', { rough: 0.8, flat: true });
  for (let i = 0; i < 4; i += 1) {
    const cone = new Mesh(new ConeGeometry(0.035, height * (0.7 + seeded(seed + i) * 0.5), 4), blade);
    cone.position.set((seeded(seed * 3 + i) - 0.5) * 0.22, height * 0.4, (seeded(seed * 5 + i) - 0.5) * 0.22);
    cone.rotation.z = (seeded(seed + i * 9) - 0.5) * 0.6;
    group.add(cone);
  }
  group.position.set(x, 0, z);
  return group;
}

function floor(kit) {
  const group = new Group();
  const store = bag(kit);
  const dark = kit.mode === 'dark';
  group.add(kit.ground({ radius: 70, rough: 0.96, draw: sandDraw(kit), repeat: [16, 16] }));

  // The light thins out towards its rim, which a trip to another town crosses.
  const rim = kit.canvas(64, 64, (ctx, w, h) => {
    const fade = ctx.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w * 0.5);
    fade.addColorStop(0, '#fff');
    fade.addColorStop(1, '#000');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  });
  for (const [repeat, seed, y, spin] of [[[16, 16], 3, 0.012, 0.3], [[11, 11], 41, 0.016, -0.5]]) {
    const material = causticMaterial(kit, repeat, seed);
    material.alphaMap = rim;
    const sheet = new Mesh(new CircleGeometry(26, 40), material);
    sheet.rotation.x = -Math.PI / 2;
    sheet.rotation.z = spin;
    sheet.position.set(0, y, 1);
    sheet.renderOrder = 1;
    group.add(sheet);
    store.caustics.push(material.map);
  }

  // The sea-glass trail meanders up the aisle to the hatch.
  const halo = kit.halo('glow', 1.05, 1.05, { opacity: dark ? 0.32 : 0.16, at: [0, 0.02, 0] });
  let z = -2.85;
  let index = 0;
  while (z < 10.8) {
    const centre = Math.sin(z * 0.62) * 0.28;
    const twin = index % 3 === 2;
    for (const offset of twin ? [-0.3, 0.3] : [(index % 2 ? 0.16 : -0.16)]) {
      const radius = (twin ? 0.2 : 0.27) + seeded(index * 7 + offset) * 0.08;
      const key = GLASS[(index + (offset > 0 ? 1 : 0)) % GLASS.length];
      const stone = new Mesh(new CylinderGeometry(radius, radius * 1.1, 0.06, 7), kit.mat(key, {
        emissive: key, glow: dark ? 0.55 : 0.12, rough: 0.25, metal: 0.05, flat: true,
      }));
      stone.position.set(centre + offset, 0.03, z);
      stone.rotation.y = seeded(index + 40) * 3;
      stone.scale.z = 0.8 + seeded(index + 13) * 0.3;
      group.add(stone);
      if (dark) {
        const glowPool = new Mesh(halo.geometry, halo.material);
        glowPool.rotation.x = -Math.PI / 2;
        glowPool.position.set(centre + offset, 0.02, z);
        group.add(glowPool);
      }
    }
    if (index % 4 === 1) {
      const side = index % 8 === 1 ? 1 : -1;
      const shell = new Mesh(new SphereGeometry(0.14, 9, 4, 0, Math.PI), kit.mat(index % 8 === 1 ? 'pearl' : 'coralPink', { rough: 0.4, flat: true }));
      shell.rotation.set(-Math.PI / 2, 0, seeded(index) * 2);
      shell.scale.set(1, 1, 0.35);
      shell.position.set(centre + side * 0.72, 0.02, z + 0.1);
      group.add(shell);
    }
    if (index % 3 === 0 && z > -1.5) {
      for (const side of [-1, 1]) group.add(seaGrass(kit, side * (1.15 + seeded(index + side) * 0.15), z + 0.2, 0.42, index * 2 + (side > 0 ? 1 : 0)));
    }
    z += 0.56 + seeded(index + 3) * 0.18;
    index += 1;
  }

  for (let p = 0; p < 3; p += 1) {
    const pulse = kit.halo('glassA', 1.0, 1.0, { opacity: 0, at: [0, 0.05, 0] });
    group.add(pulse);
    store.pulses.push(pulse);
  }
  return group;
}

function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  group.add(kit.shadow(2.4, 1.8, 0.24));
  const slab = blob(kit, 1, flat(kit, 'rock'), [0, -0.02, 0], [1.08, 0.08, 0.78], 9);
  group.add(slab);
  const net = memo(kit, 'netMat', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = kit.mode === 'dark' ? 'rgba(170,150,120,0.9)' : 'rgba(90,70,48,0.95)';
    ctx.lineWidth = 3;
    for (let i = -8; i <= 16; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * 16, 0); ctx.lineTo(i * 16 + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * 16, h); ctx.lineTo(i * 16 + h, 0); ctx.stroke();
    }
  }, { width: 128, height: 128, transparent: true, rough: 0.9, doubleSide: true }));
  const sheet = new Mesh(new PlaneGeometry(2.0, 1.4), net);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.075;
  group.add(sheet);
  const cork = kit.mat('cork', { rough: 0.6 });
  for (const [x, z] of [[-0.98, -0.66], [0.98, -0.66], [-0.98, 0.66], [0.98, 0.66]]) group.add(blob(kit, 0.1, cork, [x, 0.1, z], [1, 0.7, 1]));
  const rope = new Mesh(new TorusGeometry(0.16, 0.035, 5, 14), kit.mat('net', { rough: 0.9 }));
  rope.rotation.x = -Math.PI / 2;
  rope.position.set(-1.25, 0.05, 0.1);
  group.add(rope);
  return group;
}

// ---------- the hall: a galleon broken across the reef ----------

// `pinch` narrows the beam towards each end (0 keeps it, 1 meets in a point)
// and `sheer` lifts the gunwale there.
function hullGeometry(length, { scale = 1, pinch = [0.2, 0.3], sheer = [0.2, 0.3] } = {}) {
  const profile = [[0, -0.8], [0.95, -0.55], [1.42, 0.2], [1.55, 1.0], [1.5, 1.7], [1.36, 2.2]];
  const shape = new Shape();
  shape.moveTo(0, profile[0][1] * scale);
  for (const [z, y] of profile.slice(1)) shape.lineTo(z * scale, y * scale);
  for (const [z, y] of profile.slice(1).reverse()) shape.lineTo(-z * scale, y * scale);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: length, steps: 8, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(length / 2, 0, 0);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const u = (position.getX(i) + length / 2) / length;
    const left = Math.max(0, 1 - u / 0.45) ** 2;
    const right = Math.max(0, 1 - (1 - u) / 0.45) ** 2;
    position.setZ(i, position.getZ(i) * (1 - pinch[0] * left - pinch[1] * right));
    const y = position.getY(i);
    if (y > 0) position.setY(i, y + (y / (2.2 * scale)) * (sheer[0] * left + sheer[1] * right));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function plankMaterial(kit) {
  return memo(kit, 'planks', () => {
    const dark = kit.mode === 'dark';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = dark ? '#5d5f52' : '#8a7454';
      ctx.fillRect(0, 0, w, h);
      for (let b = 0; b < 4; b += 1) {
        const x = (b / 4) * w;
        ctx.fillStyle = `rgba(${dark ? '20,26,24' : '60,44,26'},${0.08 + seeded(b) * 0.16})`;
        ctx.fillRect(x, 0, w / 4, h);
        ctx.fillStyle = dark ? '#1a1d1a' : '#3a2c1d';
        ctx.fillRect(x, 0, 3, h);
        const seam = seeded(b + 5) * h;
        ctx.fillRect(x, seam, w / 4, 3);
      }
      for (let i = 0; i < 70; i += 1) {
        const x = seeded(i + 31) * w;
        const y = seeded(i + 77) * h;
        ctx.fillStyle = i % 3 ? (dark ? 'rgba(90,140,110,0.35)' : 'rgba(80,130,90,0.35)') : (dark ? 'rgba(200,210,200,0.35)' : 'rgba(240,235,220,0.7)');
        ctx.beginPath();
        ctx.arc(x, y, 2 + seeded(i) * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { width: 256, height: 256, repeat: [1, 0.5], rough: 0.88 });
  });
}

function sailMaterial(kit) {
  return memo(kit, 'sail', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = kit.mode === 'dark' ? '#a69c86' : '#e6d9bc';
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(w - 4, 4);
    for (let x = w - 4; x > 4; x -= 16) ctx.lineTo(x - 8, h - 6 - seeded(x) * 46);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of [[0.24, 0.62, 9], [0.7, 0.42, 13]]) {
      ctx.beginPath();
      ctx.ellipse(x * w, y * h, r, r * 0.8, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(80,60,40,0.4)';
    ctx.lineWidth = 2;
    for (let x = 30; x < w; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h * 0.7); ctx.stroke();
    }
  }, { width: 128, height: 128, transparent: true, doubleSide: true, rough: 0.9 }));
}

function porthole(kit, x, y, z, radius = 0.17) {
  const group = new Group();
  const ring = new Mesh(new TorusGeometry(radius, 0.045, 6, 14), kit.mat('brass', { rough: 0.35, metal: 0.7 }));
  group.add(ring);
  const glass = new Mesh(new CircleGeometry(radius * 0.92, 14), kit.windows);
  glass.position.z = -0.01;
  group.add(glass);
  group.position.set(x, y, z);
  return group;
}

function brainCoral(kit, at, radius, key) {
  return blob(kit, radius, kit.mat(key, { rough: 0.75 }), at, [1, 0.68, 1], 12);
}

function staghorn(kit, at, scale, key) {
  const group = new Group();
  const material = kit.mat(key, { rough: 0.6, flat: true });
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + seeded(i + at[0]) * 0.6;
    const branch = new Mesh(new ConeGeometry(0.06 * scale, 0.7 * scale, 5), material);
    branch.position.set(Math.cos(a) * 0.12 * scale, 0.3 * scale, Math.sin(a) * 0.12 * scale);
    branch.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    group.add(branch);
  }
  group.add(new Mesh(new ConeGeometry(0.07 * scale, 0.8 * scale, 5), material).translateY(0.38 * scale));
  group.position.set(...at);
  return group;
}

function kelpStrand(kit, at, height, seed) {
  const root = new Group();
  root.position.set(...at);
  const stem = kit.mat(seed % 2 ? 'kelp' : 'kelpLight', { rough: 0.75, flat: true, doubleSide: true });
  const segments = Math.max(3, Math.round(height / 0.7));
  const step = height / segments;
  const joints = [];
  let parent = root;
  for (let i = 0; i < segments; i += 1) {
    const joint = new Group();
    joint.position.y = i ? step : 0;
    parent.add(joint);
    joint.add(kit.cylinder(0.03, 0.04, step, stem, [0, step / 2, 0], 5));
    const leaf = new Mesh(new PlaneGeometry(0.2, step * 0.9), stem);
    leaf.position.set(i % 2 ? 0.11 : -0.11, step * 0.5, 0);
    leaf.rotation.z = i % 2 ? -0.5 : 0.5;
    joint.add(leaf);
    joints.push(joint);
    parent = joint;
  }
  bag(kit).kelp.push({ joints, phase: seed * 0.9 });
  return root;
}

function anglerfish(kit) {
  const group = new Group();
  const skin = kit.mat('angler', { rough: 0.55, flat: true });
  const body = blob(kit, 0.26, skin, [0, 0.2, 0], [1.05, 0.9, 1.15], 9);
  group.add(body);
  const jaw = new Group();
  jaw.position.set(0, 0.14, 0.08);
  const lower = new Mesh(new SphereGeometry(0.24, 9, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
  lower.scale.set(1.02, 0.6, 1.15);
  lower.position.z = 0.08;
  jaw.add(lower);
  const tooth = kit.mat('#f4efe2', { rough: 0.4 });
  for (let i = 0; i < 6; i += 1) {
    const a = -1.1 + (i / 5) * 2.2;
    const fang = new Mesh(new ConeGeometry(0.022, 0.1, 4), tooth);
    fang.position.set(Math.sin(a) * 0.21, 0.04, 0.08 + Math.cos(a) * 0.24);
    jaw.add(fang);
  }
  group.add(jaw);
  const eyeGlow = glowing(kit, 'glassA', 1.4);
  for (const side of [-1, 1]) group.add(kit.sphere(0.045, eyeGlow, [side * 0.15, 0.32, 0.18], 6));
  const fin = new Mesh(new ConeGeometry(0.12, 0.26, 4), skin);
  fin.position.set(0, 0.22, -0.32);
  fin.rotation.x = -Math.PI / 2;
  group.add(fin);
  const lure = new Group();
  lure.position.set(0, 0.42, 0.06);
  const stalk = limb(skin, 0.5, 0.025, 3);
  stalk.root.rotation.x = 0.9;
  stalk.joints[1].rotation.x = 0.5;
  stalk.joints[2].rotation.x = 0.6;
  lure.add(stalk.root);
  const tip = new Group();
  tip.position.set(0, 0.36, 0.37);
  lure.add(tip);
  const beacon = kit.sphere(0.11, kit.beacon, [0, -0.08, 0], 10);
  tip.add(beacon);
  tip.add(kit.halo('glassA', 0.9, 0.9, { opacity: kit.mode === 'dark' ? 0.55 : 0.3, flat: false, at: [0, -0.08, 0.02], additive: true }));
  group.add(lure);
  return { group, jaw, lure, beacon };
}

function hall(kit) {
  const group = new Group();
  const ship = new Group();
  ship.rotation.set(-0.1, 0, 0.05);
  group.add(ship);
  const planks = plankMaterial(kit);
  const hullDark = kit.mat('hullDark', { rough: 0.9 });
  const trim = kit.mat('trim', { rough: 0.85 });
  const brass = kit.mat('brass', { rough: 0.35, metal: 0.7 });
  const swing = [];

  group.add(kit.shadow(6.4, 4.4, 0.3));
  group.add(blob(kit, 1, kit.mat('sand', { rough: 0.95 }), [0, 0, -0.1], [3.0, 0.32, 1.85], 14));

  const hull = new Mesh(hullGeometry(4.55, { pinch: [0.12, 0.3], sheer: [0.05, 0.45] }), planks);
  hull.position.x = 0.15;
  ship.add(hull);
  const deck = kit.box(4.5, 0.06, 2.6, trim, [0.15, 2.18, 0]);
  ship.add(deck);
  for (const x of [-1.95, -1.4, -0.85, 0.85, 1.4, 1.95]) ship.add(kit.box(0.08, 0.32, 0.08, trim, [x, 2.36, 1.25]));
  ship.add(kit.box(4.2, 0.07, 0.1, trim, [0.15, 2.52, 1.25]));
  ship.add(kit.box(4.55, 0.12, 0.06, hullDark, [0.15, 0.62, 1.48]));
  ship.add(kit.box(4.3, 0.14, 0.06, kit.mat('roof', { rough: 0.5, metal: 0.4 }), [0.05, 1.82, 1.47]));

  for (let i = 0; i < 6; i += 1) {
    const plank = kit.box(0.08, 0.5 + seeded(i) * 0.6, 0.09, hullDark, [-2.12, 0.5 + i * 0.3, -1.2 + i * 0.48]);
    plank.rotation.set(seeded(i + 3) - 0.5, 0, 0.5 + seeded(i + 9) * 0.6);
    ship.add(plank);
  }

  const bow = new Group();
  bow.position.set(-2.75, -0.55, -0.75);
  bow.rotation.set(0.12, 0.5, 0.38);
  bow.add(new Mesh(hullGeometry(1.6, { scale: 0.82, pinch: [0.97, 0.1], sheer: [0.7, 0] }), planks));
  bow.add(kit.box(1.4, 0.1, 0.06, kit.mat('roof', { rough: 0.5, metal: 0.4 }), [0.1, 1.55, 1.05]));
  const sprit = kit.cylinder(0.05, 0.08, 1.7, trim, [-1.15, 2.35, 0], 6);
  sprit.rotation.z = 1.0;
  bow.add(sprit);
  group.add(bow);

  const castle = new Group();
  castle.position.set(1.75, 2.3, -0.1);
  castle.add(kit.box(1.0, 0.85, 2.1, plankMaterial(kit), [0, 0.42, 0]));
  castle.add(kit.box(1.06, 0.07, 2.16, trim, [0, 0.86, 0]));
  for (const z of [-0.95, -0.3, 0.35, 0.95]) castle.add(kit.box(0.06, 0.24, 0.06, trim, [0.48, 1.0, z]));
  castle.add(kit.box(0.06, 0.05, 2.0, trim, [0.48, 1.12, 0]));
  castle.add(kit.box(1.04, 0.08, 0.08, kit.mat('roof', { rough: 0.5, metal: 0.4 }), [0, 0.74, 1.07]));
  for (const x of [-0.27, 0.27]) {
    castle.add(kit.box(0.3, 0.38, 0.04, trim, [x, 0.45, 1.06]));
    castle.add(kit.box(0.22, 0.3, 0.03, kit.windows, [x, 0.45, 1.08]));
  }
  castle.add(kit.cylinder(0.07, 0.09, 0.55, kit.mat('iron', { rough: 0.5, metal: 0.5 }), [0.1, 1.15, -0.55], 8));
  const lantern = new Group();
  lantern.position.set(0.55, 0.88, 1.0);
  lantern.add(kit.cylinder(0.012, 0.012, 0.2, trim, [0, -0.1, 0], 4));
  lantern.add(kit.box(0.16, 0.2, 0.16, kit.windows, [0, -0.3, 0]));
  lantern.add(kit.box(0.2, 0.04, 0.2, brass, [0, -0.19, 0]));
  castle.add(lantern);
  swing.push([lantern, 'x', 0.18, 1.2]);
  ship.add(castle);

  const nameboard = memo(kit, 'nameboard', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = kit.mode === 'dark' ? '#23292a' : '#3a2c1d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d9a845';
    ctx.lineWidth = 4;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#e8b94e';
    ctx.font = 'bold 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('REEF WORKS', w / 2, h / 2 + 2);
  }, { width: 256, height: 64, emissive: true, glow: 0.35 }));
  ship.add(kit.box(1.5, 0.3, 0.04, nameboard, [0, 2.0, 1.47]));

  for (const x of [-1.75, -1.22, 1.22, 1.75]) ship.add(porthole(kit, x, 1.28, 1.55, 0.16));

  group.add(kit.box(1.62, 1.5, 0.2, kit.mat('door', { rough: 1 }), [0, 0.85, 1.48]));
  for (const x of [-0.84, 0.84]) group.add(kit.box(0.1, 1.56, 0.24, hullDark, [x, 0.86, 1.5]));
  group.add(kit.box(1.8, 0.12, 0.26, hullDark, [0, 1.62, 1.52]));
  const door = kit.box(1.5, 1.4, 0.07, kit.mat('hull', { rough: 0.85 }), [0, 0, 0]);
  door.geometry.translate(0, -0.7, 0);
  door.position.set(0, 1.56, 1.62);
  for (const y of [-0.3, -1.05]) door.add(kit.box(1.52, 0.08, 0.03, kit.mat('iron', { rough: 0.5, metal: 0.55 }), [0, y, 0.045]));
  door.add(kit.box(0.08, 1.3, 0.03, hullDark, [0, -0.7, 0.045]));
  group.add(door);

  const mast = new Group();
  mast.position.set(0.2, 2.15, -0.25);
  mast.rotation.set(-0.12, 0, 0.2);
  mast.add(kit.cylinder(0.08, 0.11, 2.5, trim, [0, 1.25, 0], 8));
  const yard = kit.cylinder(0.045, 0.045, 1.9, trim, [0, 1.95, 0.05], 6);
  yard.rotation.z = Math.PI / 2 + 0.12;
  mast.add(yard);
  const sail = new Group();
  sail.position.set(0, 1.92, 0.1);
  sail.add(new Mesh(new PlaneGeometry(1.7, 1.25), sailMaterial(kit)).translateY(-0.62));
  sail.rotation.z = 0.12;
  mast.add(sail);
  swing.push([sail, 'x', 0.1, 0.8]);
  const nest = new Mesh(new CylinderGeometry(0.3, 0.24, 0.24, 10, 1, true), kit.mat('trim', { rough: 0.85, doubleSide: true }));
  nest.position.y = 2.3;
  mast.add(nest);
  mast.add(kit.cylinder(0.27, 0.27, 0.04, trim, [0, 2.2, 0], 10));
  ship.add(mast);

  ship.add(kit.cylinder(0.12, 0.14, 1.0, trim, [-1.45, 2.65, 0.05], 7));
  ship.add(kit.cylinder(0.24, 0.2, 0.08, trim, [-1.45, 3.16, 0.05], 8));
  const fish = anglerfish(kit);
  fish.group.position.set(-1.45, 3.2, 0.1);
  fish.group.rotation.set(0.15, 0.25, 0);
  fish.group.scale.setScalar(1.25);
  ship.add(fish.group);

  ship.add(brainCoral(kit, [-0.9, 2.25, 0.6], 0.32, 'coralGold'));
  ship.add(staghorn(kit, [-1.75, 2.2, 0.1], 0.8, 'coralPink'));
  ship.add(staghorn(kit, [1.1, 2.2, 0.9], 0.55, 'coralViolet'));
  group.add(brainCoral(kit, [-2.35, 0.1, 0.9], 0.42, 'coralViolet'));
  group.add(staghorn(kit, [-2.05, 0, 1.25], 0.9, 'coralCyan'));
  group.add(brainCoral(kit, [2.3, 0.1, -0.7], 0.5, 'coralPink'));
  group.add(blob(kit, 0.8, flat(kit, 'rock'), [-1.4, 0.1, -1.55], [1.4, 0.7, 0.8], 6));
  group.add(blob(kit, 0.7, flat(kit, 'rockDark'), [1.5, 0.1, -1.6], [1.5, 0.65, 0.7], 6));
  for (const [x, z, h, s] of [[-2.55, -0.9, 3.4, 1], [-2.3, -1.4, 2.6, 2], [2.55, -1.1, 3.1, 3], [-1.0, -1.7, 4.0, 4], [0.9, -1.8, 3.5, 5]]) {
    group.add(kelpStrand(kit, [x, 0, z], h, s));
  }

  const bubbleMat = kit.basic('smoke', { opacity: 0.7 });
  const burst = [];
  for (let i = 0; i < 8; i += 1) {
    const bubble = kit.sphere(0.07 + (i % 3) * 0.03, bubbleMat, [0, 0, 0], 8);
    bubble.visible = false;
    group.add(bubble);
    burst.push(bubble);
  }

  let deliveredAt = -10;
  let spawnedAt = -10;
  const pending = { delivery: false, spawn: false };
  group.userData = {
    door, beacon: fish.beacon, chimney: new Vector3(1.85, 3.75, -0.85), labelY: 4.75, swing,
    react(event) {
      if (event in pending) pending[event] = true;
    },
    frame(time, _dt, main, reduced) {
      if (pending.delivery) deliveredAt = time;
      if (pending.spawn) spawnedAt = time;
      pending.delivery = pending.spawn = false;
      const sinceDelivery = time - deliveredAt;
      const sinceSpawn = time - spawnedAt;
      if (reduced) {
        ship.rotation.z = 0.05;
        fish.jaw.rotation.x = 0.25;
        for (const bubble of burst) bubble.visible = false;
        return;
      }
      const working = main?.state === 'working' ? 1 : 0.4;
      ship.rotation.z = 0.05 + Math.sin(time * 0.5) * 0.008 + (sinceDelivery < 1.6 ? Math.sin(sinceDelivery * 9) * 0.02 * (1 - sinceDelivery / 1.6) : 0);
      fish.group.position.y = 3.2 + Math.sin(time * 1.3) * 0.03;
      fish.lure.rotation.x = Math.sin(time * 1.1) * 0.12 * working;
      fish.lure.rotation.z = Math.sin(time * 0.7) * 0.1;
      const gulp = sinceSpawn < 1.2 ? Math.sin((sinceSpawn / 1.2) * Math.PI) : 0;
      fish.jaw.rotation.x = 0.18 + Math.sin(time * 0.9) * 0.08 + gulp * 0.6;
      fish.beacon.scale.setScalar(1 + gulp * 0.8);
      burst.forEach((bubble, i) => {
        const t = sinceDelivery - i * 0.08;
        bubble.visible = t > 0 && t < 1.8;
        if (!bubble.visible) return;
        bubble.position.set(Math.sin(i * 2.4) * (0.3 + t * 0.25), 1.6 + t * 1.6 + (i % 3) * 0.1, 1.7 + Math.cos(i * 2.4) * 0.2);
      });
    },
  };
  return kit.shadows(group);
}

// ---------- stations ----------

function reefPatch(kit, group, radius, seed) {
  group.add(kit.shadow(radius * 2.5, radius * 2.3, 0.22));
  const patch = new Mesh(new CylinderGeometry(radius, radius * 1.08, 0.08, 9), flat(kit, 'patch', 0.92));
  patch.position.y = 0.03;
  patch.rotation.y = seed;
  group.add(patch);
  for (let i = 0; i < 3; i += 1) {
    const a = Math.PI * (0.85 + i * 0.4) + seeded(seed + i) * 0.4;
    const key = CORALS[(seed + i) % CORALS.length];
    group.add(brainCoral(kit, [Math.cos(a) * radius * 0.86, 0.08, Math.sin(a) * radius * 0.82], 0.1 + seeded(seed * 3 + i) * 0.07, key));
  }
}

function lampStalk(kit, group, lamp, x, y, z, key = 'kelp') {
  group.add(kit.cylinder(0.025, 0.04, y, kit.mat(key, { rough: 0.7 }), [x, y / 2, z], 6));
  lamp.position.set(x, y + 0.08, z);
}

function crab(kit, scale = 1) {
  const group = new Group();
  const shell = kit.mat('crab', { rough: 0.5, flat: true });
  group.add(blob(kit, 0.17, shell, [0, 0.12, 0], [1.35, 0.6, 1]));
  for (const side of [-1, 1]) {
    group.add(kit.cylinder(0.015, 0.015, 0.12, shell, [side * 0.06, 0.24, 0.1], 4));
    group.add(kit.sphere(0.03, kit.mat('#141414', { rough: 0.2 }), [side * 0.06, 0.31, 0.1], 6));
    for (let leg = 0; leg < 3; leg += 1) {
      const piece = kit.box(0.2, 0.025, 0.03, shell, [side * 0.24, 0.07, -0.08 + leg * 0.07]);
      piece.rotation.z = side * -0.5;
      group.add(piece);
    }
  }
  const claws = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 0.16, 0.13, 0.1);
    arm.add(kit.box(0.04, 0.04, 0.16, shell, [0, 0, 0.08]));
    arm.add(blob(kit, 0.07, shell, [0, 0.02, 0.2], [0.8, 0.7, 1.3]));
    group.add(arm);
    claws.push(arm);
  }
  group.scale.setScalar(scale);
  return { group, claws };
}

function clamWorks(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.92, seed);
  const shell = kit.mat('clam', { rough: 0.5, flat: true, doubleSide: true });
  const clam = new Group();
  clam.position.set(-0.18, 0.08, -0.08);
  const lower = new Mesh(new SphereGeometry(0.62, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell);
  lower.scale.set(1, 0.5, 0.85);
  lower.position.y = 0.3;
  clam.add(lower);
  const flesh = new Mesh(new CircleGeometry(0.56, 14), kit.mat('clamInner', { rough: 0.45 }));
  flesh.rotation.x = -Math.PI / 2;
  flesh.scale.y = 0.85;
  flesh.position.y = 0.3;
  clam.add(flesh);
  const pearl = kit.sphere(0.17, glowing(kit, 'pearl', 0.5), [0, 0.44, 0.04], 14);
  clam.add(pearl);
  const hinge = new Group();
  hinge.position.set(0, 0.3, -0.52);
  const upper = new Mesh(new SphereGeometry(0.62, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  upper.scale.set(1, 0.5, 0.85);
  upper.position.z = 0.52;
  hinge.add(upper);
  clam.add(hinge);
  group.add(clam);
  const worker = crab(kit, 1.15);
  worker.group.position.set(0.6, 0.06, 0.38);
  worker.group.rotation.y = -1.1;
  const sponge = kit.box(0.09, 0.06, 0.09, kit.mat('coralGold', { rough: 0.9 }), [0, 0, 0.3]);
  worker.claws[0].add(sponge);
  group.add(worker.group);
  lampStalk(kit, group, lamp, 0.62, 0.95, -0.45, 'coralCyan');
  return {
    occupants: [worker.group], puff: new Vector3(-0.18, 0.95, 0), labelY: 1.7, inkY: 0.9,
    frame(time, s, act, live, failed, done, sinceDone) {
      let open = 0.12;
      if (failed) open = live ? Math.abs(Math.sin(time * 9)) * 0.04 : 0;
      else if (done) open = 0.8;
      else if (s.state === 'running') open = 0.35 + (live ? (0.5 + 0.5 * Math.sin(time * 1.4)) * 0.3 * act : 0.15);
      hinge.rotation.x = -open;
      pearl.scale.setScalar(done ? 1.2 + (live && sinceDone < 2 ? Math.sin(sinceDone * 6) * 0.15 : 0) : 1);
      const scrub = live ? Math.sin(time * 9) * 0.45 * act : 0;
      worker.claws[0].rotation.y = scrub;
      worker.claws[1].rotation.y = -scrub * 0.5;
      worker.group.position.x = failed ? 0.78 : 0.6;
      worker.group.rotation.z = failed ? 0.4 : 0;
    },
  };
}

function octopusLevers(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.92, seed);
  const console_ = kit.mat('brassDark', { rough: 0.5, metal: 0.55 });
  const brass = kit.mat('brass', { rough: 0.35, metal: 0.7 });
  group.add(kit.box(1.3, 0.42, 0.34, console_, [0, 0.25, 0.42]));
  group.add(kit.box(1.36, 0.06, 0.4, brass, [0, 0.47, 0.42]));
  const gauge = new Mesh(new CircleGeometry(0.1, 12), kit.mat('pearl', { rough: 0.4 }));
  gauge.position.set(-0.4, 0.27, 0.6);
  group.add(gauge);
  group.add(kit.box(0.015, 0.08, 0.01, kit.mat('#2a1a10'), [-0.4, 0.3, 0.61]));
  const levers = [];
  const knob = kit.mat('coralPink', { rough: 0.4 });
  [-0.45, -0.15, 0.15, 0.45].forEach(x => {
    const pivot = new Group();
    pivot.position.set(x, 0.5, 0.42);
    pivot.add(kit.cylinder(0.025, 0.025, 0.36, brass, [0, 0.18, 0], 5));
    pivot.add(kit.sphere(0.055, knob, [0, 0.38, 0], 7));
    group.add(pivot);
    levers.push(pivot);
  });
  const normal = kit.mat('octo', { rough: 0.5, flat: true });
  const pale = kit.mat('octoPale', { rough: 0.5, flat: true });
  const skinned = [];
  const head = blob(kit, 0.36, normal, [0, 1.0, -0.3], [1, 1.2, 1], 10);
  head.rotation.x = -0.3;
  group.add(head);
  skinned.push(head);
  const occupants = [head];
  const eyesFrom = group.children.length;
  eyes(kit, group, 0.15, 0.9, -0.02, 0.075);
  occupants.push(...group.children.slice(eyesFrom));
  const arms = [];
  levers.forEach((lever, i) => {
    const arm = limb(normal, 0.6, 0.07, 3);
    aim(arm.root, [lever.position.x * 0.5, 0.72, -0.15], [lever.position.x, 0.86, 0.42]);
    group.add(arm.root);
    occupants.push(arm.root);
    arm.root.traverse(node => node.isMesh && skinned.push(node));
    arms.push({ arm, lever, phase: i * 1.7 });
  });
  for (const side of [-1, 1]) {
    const arm = limb(normal, 0.7, 0.075, 3);
    aim(arm.root, [side * 0.25, 0.65, -0.35], [side * 0.85, 0.05, -0.2]);
    arm.joints[1].rotation.z = side * 0.5;
    arm.joints[2].rotation.z = side * 0.8;
    group.add(arm.root);
    occupants.push(arm.root);
    arm.root.traverse(node => node.isMesh && skinned.push(node));
  }
  lampStalk(kit, group, lamp, 0.72, 0.85, -0.1, 'brassDark');
  let wasFailed = false;
  return {
    occupants, puff: new Vector3(0, 1.5, -0.3), labelY: 1.75, inkY: 1.3,
    frame(time, s, act, live, failed, done) {
      if (failed !== wasFailed) {
        for (const mesh of skinned) mesh.material = failed ? pale : normal;
        wasFailed = failed;
      }
      for (const { arm, lever, phase } of arms) {
        const pull = done ? -0.5 : live ? Math.sin(time * 2.6 + phase) * 0.55 * act : 0;
        lever.rotation.x = pull;
        arm.joints[1].rotation.x = pull * 0.5;
        arm.joints[2].rotation.x = pull * 0.6;
      }
      head.position.y = failed ? 0.82 : 1.0 + (live ? Math.sin(time * 1.6) * 0.04 : 0);
      head.scale.set(1, failed ? 0.9 : 1.2, 1);
    },
  };
}

function helmetForge(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.92, seed);
  const brass = kit.mat('brass', { rough: 0.3, metal: 0.75 });
  const dark = kit.mat('brassDark', { rough: 0.4, metal: 0.6 });
  const helmet = new Group();
  helmet.position.set(-0.22, 0.12, -0.15);
  helmet.rotation.set(-0.25, 0.35, 0.18);
  helmet.add(kit.cylinder(0.42, 0.48, 0.2, dark, [0, 0.1, 0], 12));
  helmet.add(kit.sphere(0.5, brass, [0, 0.6, 0], 14));
  const plate = new Group();
  plate.position.set(0, 0.62, 0.47);
  plate.add(new Mesh(new TorusGeometry(0.22, 0.05, 6, 14), dark));
  const forge = glowing(kit, 'forge', 1.5);
  const soot = kit.mat('soot', { rough: 0.9 });
  const fire = new Mesh(new CircleGeometry(0.2, 14), forge);
  fire.position.z = 0.01;
  plate.add(fire);
  for (const x of [-0.1, 0.1]) plate.add(kit.box(0.02, 0.4, 0.02, dark, [x, 0, 0.03]));
  helmet.add(plate);
  for (const side of [-1, 1]) {
    const port = new Mesh(new TorusGeometry(0.1, 0.035, 5, 10), dark);
    port.position.set(side * 0.48, 0.62, 0.05);
    port.rotation.y = Math.PI / 2;
    helmet.add(port);
  }
  group.add(helmet);
  const lampValve = kit.cylinder(0.05, 0.06, 0.16, dark, [-0.22, 1.25, -0.27], 6);
  group.add(lampValve);
  lamp.position.set(-0.22, 1.4, -0.27);

  const crabby = new Group();
  crabby.position.set(0.18, 0, 0.25);
  const shell = kit.mat('crab', { rough: 0.5, flat: true });
  for (let i = 0; i < 4; i += 1) {
    const leg = kit.box(0.26, 0.04, 0.05, shell, [0.15 + (i % 2) * 0.05, 0.07, -0.25 + i * 0.12]);
    leg.rotation.z = -0.45;
    crabby.add(leg);
  }
  for (const x of [0.02, 0.12]) {
    crabby.add(kit.cylinder(0.015, 0.015, 0.16, shell, [x, 0.28, 0.12], 4));
    crabby.add(kit.sphere(0.035, kit.mat('#141414', { rough: 0.2 }), [x, 0.37, 0.12], 6));
  }
  const arm = new Group();
  arm.position.set(0.15, 0.25, 0.15);
  arm.add(kit.box(0.08, 0.08, 0.3, shell, [0, 0, 0.12]));
  arm.add(blob(kit, 0.11, shell, [0, 0.02, 0.3], [0.9, 0.8, 1.2]));
  arm.add(kit.cylinder(0.025, 0.025, 0.42, kit.mat('trim'), [0.05, 0.15, 0.36], 5));
  arm.add(kit.box(0.2, 0.11, 0.11, kit.mat('iron', { rough: 0.45, metal: 0.6 }), [0.05, 0.36, 0.36]));
  crabby.add(arm);
  group.add(crabby);
  const iron = kit.mat('iron', { rough: 0.45, metal: 0.6 });
  group.add(kit.box(0.34, 0.2, 0.22, iron, [0.3, 0.1, 0.58]));
  group.add(kit.box(0.44, 0.07, 0.24, iron, [0.32, 0.23, 0.58]));
  const spark = kit.sphere(0.06, kit.basic('forge', { additive: true }), [0.3, 0.32, 0.6], 6);
  group.add(spark);
  let sooty = false;
  return {
    occupants: [crabby], puff: new Vector3(-0.22, 1.35, -0.27), labelY: 1.85, inkY: 1.35,
    frame(time, s, act, live, failed, done) {
      if (failed !== sooty) {
        fire.material = failed ? soot : forge;
        sooty = failed;
      }
      const beat = live ? Math.max(0, Math.sin(time * 5)) : 0;
      arm.rotation.x = failed ? -0.9 : -0.3 - beat * 0.9 * act;
      crabby.scale.setScalar(failed ? 0.55 : 1);
      crabby.position.x = failed ? -0.05 : 0.18;
      const hit = live && act > 0.3 && !failed ? Math.max(0, Math.sin(time * 5 - 1.2)) : 0;
      spark.visible = hit > 0.75;
      spark.scale.setScalar(0.5 + hit);
      helmet.rotation.z = done ? 0.05 : 0.18;
    },
  };
}

function seahorse(kit, key = 'horse') {
  const group = new Group();
  const body = kit.mat(key, { rough: 0.5, flat: true });
  group.add(blob(kit, 0.1, body, [0, 0.38, 0.02], [1, 1, 1.2]));
  const snout = kit.cylinder(0.025, 0.035, 0.16, body, [0, 0.38, 0.15], 6);
  snout.rotation.x = Math.PI / 2;
  group.add(snout);
  group.add(blob(kit, 0.1, body, [0, 0.25, -0.02], [0.9, 1.2, 1]));
  group.add(blob(kit, 0.085, body, [0, 0.12, -0.03], [0.85, 1.1, 0.9]));
  const tail = new Mesh(new TorusGeometry(0.06, 0.025, 5, 10, Math.PI * 1.5), body);
  tail.position.set(0, 0.02, 0);
  tail.rotation.y = Math.PI / 2;
  group.add(tail);
  const fin = new Mesh(new ConeGeometry(0.06, 0.12, 3), kit.mat('coralPink', { rough: 0.5 }));
  fin.position.set(0, 0.25, -0.11);
  fin.rotation.x = -1.4;
  group.add(fin);
  for (const side of [-1, 1]) group.add(kit.sphere(0.028, kit.mat('#141414', { rough: 0.2 }), [side * 0.07, 0.42, 0.05], 6));
  return group;
}

function weaveMaterial(kit, tangled) {
  return memo(kit, tangled ? 'weaveTangled' : 'weave', () => kit.painted((ctx, w, h) => {
    const dark = kit.mode === 'dark';
    ctx.fillStyle = dark ? '#1d5a3c' : '#4b9a5a';
    ctx.fillRect(0, 0, w, h);
    if (tangled) {
      ctx.strokeStyle = dark ? '#7ad08a' : '#c6f0a8';
      ctx.lineWidth = 3;
      for (let i = 0; i < 26; i += 1) {
        ctx.beginPath();
        ctx.moveTo(seeded(i) * w, seeded(i + 40) * h);
        ctx.bezierCurveTo(seeded(i + 2) * w, seeded(i + 3) * h, seeded(i + 4) * w, seeded(i + 5) * h, seeded(i + 6) * w, seeded(i + 7) * h);
        ctx.stroke();
      }
      return;
    }
    for (let y = 0; y < h; y += 16) {
      for (let x = 0; x < w; x += 16) {
        ctx.fillStyle = ((x + y) / 16) % 2 ? (dark ? '#2f8a58' : '#7cc46c') : (dark ? '#c99c42' : '#f0c35a');
        ctx.fillRect(x + 1, y + 1, 14, 14);
      }
    }
  }, { width: 128, height: 128, rough: 0.8, doubleSide: true }));
}

function seahorseLoom(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.92, seed);
  const wood = kit.mat('trim', { rough: 0.85, flat: true });
  for (const x of [-0.62, 0.62]) group.add(kit.cylinder(0.06, 0.08, 1.45, wood, [x, 0.72, -0.25], 6));
  for (const y of [0.32, 1.32]) {
    const beam = kit.cylinder(0.05, 0.05, 1.4, wood, [0, y, -0.25], 6);
    beam.rotation.z = Math.PI / 2;
    group.add(beam);
  }
  const panel = new Mesh(new PlaneGeometry(1.12, 1), weaveMaterial(kit, false));
  panel.position.set(0, 0.82, -0.24);
  group.add(panel);
  const thread = kit.mat('kelpLight', { rough: 0.7 });
  for (let i = 0; i < 6; i += 1) group.add(kit.box(0.015, 1.0, 0.015, thread, [-0.5 + i * 0.2, 0.82, -0.2]));
  const basket = new Mesh(new SphereGeometry(0.22, 9, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.mat('pearl', { rough: 0.5, flat: true, doubleSide: true }));
  basket.position.set(0.55, 0.26, 0.45);
  group.add(basket);
  for (const [x, z, key] of [[0.5, 0.42, 'kelpLight'], [0.62, 0.5, 'coralGold'], [0.56, 0.36, 'coralPink']]) group.add(kit.sphere(0.08, kit.mat(key, { rough: 0.8 }), [x, 0.3, z], 7));
  const horse = seahorse(kit);
  horse.scale.setScalar(1.6);
  group.add(horse);
  lamp.position.set(-0.62, 1.55, -0.25);
  let tangled = false;
  return {
    occupants: [horse], puff: new Vector3(0, 1.5, -0.2), labelY: 1.9, inkY: 1.4,
    frame(time, s, act, live, failed, done) {
      if (failed !== tangled) {
        panel.material = weaveMaterial(kit, failed);
        tangled = failed;
      }
      const sweep = live ? Math.sin(time * 1.3) : 0.6;
      horse.position.set(failed ? 0.3 : done ? 0.0 : sweep * 0.45 * Math.max(act, 0.15), failed ? 0.08 : 0.5 + (live ? Math.sin(time * 3.1) * 0.05 : 0), 0.12);
      horse.rotation.set(0, failed ? 0.4 : live ? Math.cos(time * 1.3) * 0.5 : 0, failed ? 1.35 : 0);
    },
  };
}

function pufferPump(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.62, seed);
  group.add(blob(kit, 0.32, flat(kit, 'rock'), [0, 0.12, -0.05], [1.2, 0.6, 1], 6));
  const fish = new Group();
  fish.position.set(0, 0.6, 0.02);
  const body = kit.mat('puffer', { rough: 0.5, flat: true });
  fish.add(kit.sphere(0.22, body, [0, 0, 0], 10));
  fish.add(blob(kit, 0.2, kit.mat('pearl', { rough: 0.6 }), [0, -0.05, 0.03], [1, 0.8, 1]));
  const spikes = new Group();
  const spikeMat = kit.mat('brassDark', { rough: 0.6 });
  for (let i = 0; i < 14; i += 1) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / 14);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
    const spike = new Mesh(new ConeGeometry(0.03, 0.12, 4), spikeMat);
    aim(spike, dir.map(v => v * 0.22), dir.map(v => v * 0.5));
    spikes.add(spike);
  }
  fish.add(spikes);
  eyes(kit, fish, 0.1, 0.07, 0.17, 0.05);
  fish.add(new Mesh(new TorusGeometry(0.035, 0.015, 5, 8), kit.mat('coralPink', { rough: 0.5 })).translateZ(0.22).translateY(-0.04));
  const tail = new Mesh(new ConeGeometry(0.1, 0.16, 4), body);
  tail.position.z = -0.27;
  tail.rotation.x = Math.PI / 2;
  fish.add(tail);
  group.add(fish);
  const jar = kit.cylinder(0.14, 0.14, 0.3, kit.mat('glassB', { rough: 0.1, opacity: 0.45 }), [0.38, 0.2, 0.3], 10);
  group.add(jar);
  lampStalk(kit, group, lamp, -0.4, 0.8, -0.3, 'coralCyan');
  return {
    occupants: [fish], puff: new Vector3(0.3, 0.75, 0.3), labelY: 1.25, inkY: 1.0,
    frame(time, s, act, live, failed, done) {
      const breath = failed ? 1 : live ? (0.5 + 0.5 * Math.sin(time * 2.2)) * act : 0;
      const size = 1 + breath * 0.45;
      fish.scale.setScalar(size);
      spikes.scale.setScalar(0.5 + breath * 0.8);
      fish.position.y = 0.58 + breath * 0.08 + (done ? 0.04 : 0);
      tail.rotation.y = live ? Math.sin(time * 8) * 0.4 : 0;
    },
  };
}

function shrimpStation(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.62, seed);
  const basin = new Mesh(new SphereGeometry(0.34, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.mat('pearl', { rough: 0.35, metal: 0.2, flat: true, doubleSide: true }));
  basin.scale.set(1.1, 0.5, 0.9);
  basin.position.set(-0.05, 0.3, 0);
  group.add(basin);
  group.add(kit.cylinder(0.12, 0.18, 0.16, flat(kit, 'rockDark'), [-0.05, 0.08, 0], 6));
  const pebble = blob(kit, 0.13, kit.mat('coralGold', { rough: 0.4 }), [-0.08, 0.32, 0], [1, 0.6, 1]);
  group.add(pebble);
  const shrimp = new Group();
  shrimp.position.set(0.3, 0.3, 0.12);
  const red = kit.mat('shrimp', { rough: 0.45 });
  const white = kit.mat('pearl', { rough: 0.45 });
  [[0, 0.12, 0, 0.1, red], [0.03, 0.04, -0.1, 0.085, white], [0.05, -0.03, -0.19, 0.07, red], [0.06, -0.06, -0.26, 0.05, white]].forEach(([x, y, z, r, m]) => shrimp.add(blob(kit, r, m, [x, y, z], [0.9, 0.9, 1.2], 7)));
  shrimp.add(kit.sphere(0.03, kit.mat('#141414', { rough: 0.2 }), [-0.05, 0.18, 0.07], 6));
  const antennae = new Group();
  antennae.position.set(-0.02, 0.18, 0.08);
  for (const side of [-1, 1]) {
    const feeler = kit.cylinder(0.006, 0.01, 0.5, white, [side * 0.05, 0.22, 0.08], 4);
    feeler.rotation.set(0.5, 0, side * 0.35);
    antennae.add(feeler);
  }
  shrimp.add(antennae);
  const brush = new Group();
  brush.position.set(-0.08, 0.06, 0.08);
  brush.add(kit.box(0.025, 0.025, 0.2, red, [0, 0, 0.08]));
  brush.add(kit.box(0.08, 0.04, 0.06, kit.mat('coralCyan', { rough: 0.8 }), [-0.04, -0.02, 0.18]));
  brush.rotation.y = 0.9;
  shrimp.add(brush);
  shrimp.rotation.y = -0.6;
  shrimp.scale.setScalar(1.5);
  group.add(shrimp);
  lampStalk(kit, group, lamp, 0.35, 0.82, -0.32, 'coralViolet');
  return {
    occupants: [shrimp], puff: new Vector3(-0.05, 0.6, 0), labelY: 1.25, inkY: 0.9,
    frame(time, s, act, live, failed) {
      const scrub = live ? Math.sin(time * 10) * act : 0;
      brush.rotation.y = 0.9 + scrub * 0.5;
      antennae.rotation.x = live ? Math.sin(time * 3) * 0.25 : 0;
      shrimp.rotation.z = failed ? Math.PI * 0.95 : 0;
      shrimp.position.y = failed ? 0.5 : 0.3 + Math.abs(scrub) * 0.03;
      pebble.rotation.y = live ? time * act : 0;
    },
  };
}

function starLantern(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.62, seed);
  group.add(blob(kit, 0.36, flat(kit, 'rock'), [-0.05, 0.14, -0.15], [1.1, 0.75, 0.9], 6));
  const star = new Group();
  star.position.set(-0.05, 0.62, 0.12);
  star.scale.setScalar(1.6);
  const skin = kit.mat('star', { rough: 0.6, flat: true });
  const arms = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const pivot = new Group();
    pivot.rotation.z = a;
    const arm = new Mesh(new ConeGeometry(0.08, 0.32, 5), skin);
    arm.position.y = 0.16;
    arm.scale.z = 0.5;
    pivot.add(arm);
    star.add(pivot);
    arms.push(pivot);
  }
  star.add(blob(kit, 0.09, skin, [0, 0, 0], [1, 1, 0.55], 8));
  eyes(kit, star, 0.035, 0.03, 0.04, 0.03);
  group.add(star);
  const pole = new Group();
  pole.position.set(0.3, 0.5, 0.18);
  pole.add(kit.cylinder(0.022, 0.022, 0.6, kit.mat('trim'), [0, 0.3, 0], 5));
  const crook = kit.cylinder(0.018, 0.018, 0.22, kit.mat('trim'), [0.1, 0.58, 0], 4);
  crook.rotation.z = -Math.PI / 2;
  pole.add(crook);
  pole.add(kit.box(0.16, 0.03, 0.16, kit.mat('brass', { rough: 0.35, metal: 0.7 }), [0.2, 0.5, 0]));
  pole.add(kit.box(0.14, 0.03, 0.14, kit.mat('brass', { rough: 0.35, metal: 0.7 }), [0.2, 0.28, 0]));
  lamp.position.set(0.2, 0.39, 0);
  pole.add(lamp);
  group.add(pole);
  return {
    occupants: [star], puff: new Vector3(0, 1.1, 0.1), labelY: 1.45, inkY: 1.15, ownsLamp: true,
    frame(time, s, act, live, failed) {
      const wave = live ? Math.sin(time * 2.4) * act : 0;
      arms[1].rotation.z = (1 / 5) * Math.PI * 2 + wave * 0.3;
      pole.rotation.z = failed ? 0.8 : wave * 0.15;
      pole.position.y = failed ? 0.3 : 0.5;
      star.rotation.z = failed ? 0.5 : live ? Math.sin(time * 1.2) * 0.08 : 0;
      star.position.y = failed ? 0.45 : 0.66;
    },
  };
}

function eelPipe(kit, group, lamp, seed) {
  reefPatch(kit, group, 0.62, seed);
  const rust = kit.mat('#8a5a3a', { rough: 0.8, metal: 0.3 });
  group.add(kit.cylinder(0.2, 0.22, 0.6, rust, [-0.1, 0.3, 0], 10));
  group.add(new Mesh(new TorusGeometry(0.2, 0.04, 5, 12), rust).rotateX(Math.PI / 2).translateZ(-0.6).translateX(-0.1));
  group.add(kit.cylinder(0.17, 0.17, 0.02, kit.mat('#05080a', { rough: 1 }), [-0.1, 0.6, 0], 10));
  const eel = new Group();
  eel.position.set(-0.1, 0.1, 0);
  const skin = kit.mat('eel', { rough: 0.5, flat: true });
  eel.add(kit.cylinder(0.11, 0.13, 0.7, skin, [0, 0.35, 0], 8));
  const head = new Group();
  head.position.y = 0.72;
  head.add(blob(kit, 0.13, skin, [0, 0, 0.04], [0.9, 1, 1.3], 8));
  head.add(blob(kit, 0.09, skin, [0, -0.08, 0.1], [0.85, 0.5, 1.3], 7));
  eyes(kit, head, 0.07, 0.05, 0.1, 0.04, '#1c1600');
  eel.add(head);
  group.add(eel);
  const valvePipe = kit.cylinder(0.07, 0.07, 0.6, rust, [0.36, 0.3, -0.18], 8);
  group.add(valvePipe);
  const wheel = new Group();
  wheel.position.set(0.36, 0.4, -0.08);
  wheel.add(new Mesh(new TorusGeometry(0.11, 0.02, 4, 10), kit.mat('fail', { rough: 0.5 })));
  wheel.add(kit.box(0.2, 0.02, 0.02, kit.mat('fail', { rough: 0.5 })));
  wheel.add(kit.box(0.02, 0.2, 0.02, kit.mat('fail', { rough: 0.5 })));
  group.add(wheel);
  lamp.position.set(0.36, 0.68, -0.18);
  return {
    occupants: [eel], puff: new Vector3(-0.1, 1.1, 0), labelY: 1.5, inkY: 0.95,
    frame(time, s, act, live, failed, done) {
      let out = 0.6;
      if (failed) out = -0.35;
      else if (live && s.state === 'running') out = Math.max(-0.3, Math.sin(time * 1.1) * 0.55 * act + 0.15);
      else if (done) out = 0.25;
      eel.position.y = 0.1 + out * 0.5 - 0.15;
      head.rotation.y = live ? Math.sin(time * 1.7) * 0.6 : 0.3;
      wheel.rotation.z += live ? 0.04 * act : 0;
    },
  };
}

const WORKERS = [clamWorks, octopusLevers, helmetForge, seahorseLoom];
const SUBAGENTS = [pufferPump, shrimpStation, starLantern, eelPipe];

function inkCloud(kit) {
  const cloud = new Group();
  const ink = kit.mat('ink', { rough: 1, opacity: 0.62 });
  const core = kit.mat('ink', { rough: 1, opacity: 0.85 });
  const puffs = [[0, 0, 0, 0.3], [0.32, 0.1, 0.05, 0.24], [-0.3, 0.06, -0.04, 0.26], [0.1, 0.3, -0.06, 0.22], [-0.14, -0.14, 0.14, 0.2], [0.42, -0.1, -0.12, 0.17], [-0.45, 0.24, 0.08, 0.16], [0.02, 0.1, 0.3, 0.2]];
  puffs.forEach(([x, y, z, r], i) => cloud.add(kit.sphere(r, i ? ink : core, [x, y, z], 10)));
  cloud.visible = false;
  return cloud;
}

function trophy(kit) {
  const group = new Group();
  const shell = new Mesh(new SphereGeometry(0.22, 9, 4, 0, Math.PI), kit.mat('coralPink', { rough: 0.45, flat: true, doubleSide: true }));
  shell.rotation.set(-0.6, 0, 0);
  shell.scale.set(1, 1, 0.4);
  group.add(shell);
  group.add(kit.sphere(0.11, glowing(kit, 'pearl', 0.9), [0, 0.09, 0.08], 12));
  group.add(kit.halo('ok', 1.0, 1.0, { opacity: kit.mode === 'dark' ? 0.6 : 0.45, at: [0, -0.06, 0.04], additive: true }));
  group.visible = false;
  return group;
}

function station(kit, kind, spot = {}) {
  const index = spot.index ?? 0;
  const worker = kind === 'worker';
  const builders = worker ? WORKERS : SUBAGENTS;
  const group = new Group();
  const size = worker ? 1 : 1.3;
  const body = new Group();
  body.scale.setScalar(size);
  group.add(body);
  const lamp = new Mesh(new SphereGeometry(worker ? 0.15 : 0.12, 14, 10), kit.lamp());
  const seed = (spot.slot ?? index) * 3 + 1;
  const parts = builders[index % builders.length](kit, body, lamp, seed);
  if (!parts.ownsLamp) body.add(lamp);
  parts.puff.multiplyScalar(size);
  parts.inkY *= size;
  const ink = inkCloud(kit);
  ink.position.y = parts.inkY;
  group.add(ink);
  const prize = trophy(kit);
  prize.position.set(0.55, 0.1, worker ? 0.62 : 0.55);
  group.add(prize);
  const bubbleMat = kit.basic('smoke', { opacity: 0.75 });
  const bubbles = [];
  for (let i = 0; i < 5; i += 1) {
    const bubble = kit.sphere(0.05 + (i % 2) * 0.03, bubbleMat, [0, 0, 0], 7);
    bubble.visible = false;
    group.add(bubble);
    bubbles.push(bubble);
  }
  const sway = 0.6 + seeded(seed) * 0.5;
  group.userData = {
    lamp, occupants: parts.occupants || [], puff: parts.puff, labelY: parts.labelY * size, spin: [], swing: [],
    frame(time, _dt, s) {
      const live = !kit.reducedMotion;
      const failed = s.state === 'failed';
      const done = s.state === 'done';
      const sinceDone = done && Number.isFinite(s.doneAt) ? time - s.doneAt : Infinity;
      parts.frame(time, s, s.activity, live, failed, done, sinceDone);
      group.rotation.z = live ? Math.sin(time * sway + seed) * 0.012 : 0;
      ink.visible = failed;
      if (failed && live) {
        ink.children.forEach((blobMesh, i) => blobMesh.scale.setScalar(1 + Math.sin(time * 1.6 + i * 1.3) * 0.14));
        ink.position.y = parts.inkY + Math.sin(time * 0.7) * 0.06;
      }
      prize.visible = done;
      if (done) prize.scale.setScalar(live && sinceDone < 0.7 ? Math.max(0.001, back(sinceDone / 0.7)) : 1);
      const bursting = done && live && sinceDone < 4.5;
      bubbles.forEach((bubble, i) => {
        const t = sinceDone - i * 0.35;
        bubble.visible = bursting && t > 0 && t < 2.6;
        if (!bubble.visible) return;
        bubble.position.set(parts.puff.x + Math.sin(t * 3 + i) * 0.12, parts.puff.y - 0.2 + t * 0.9, parts.puff.z + Math.cos(t * 2.5 + i) * 0.1);
      });
    },
  };
  return kit.shadows(group);
}

// ---------- the sea chest and the manta that carries it ----------

function crate(kit) {
  const group = new Group();
  const wood = kit.mat('crate', { rough: 0.8 });
  const brass = kit.mat('tape', { rough: 0.35, metal: 0.65 });
  group.add(kit.box(0.48, 0.26, 0.36, wood, [0, -0.06, 0]));
  const lid = new Mesh(new CylinderGeometry(0.18, 0.18, 0.48, 10, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.07;
  group.add(lid);
  for (const x of [-0.17, 0.17]) group.add(kit.box(0.05, 0.3, 0.38, brass, [x, -0.04, 0]));
  group.add(kit.box(0.08, 0.1, 0.03, brass, [0, 0.04, 0.19]));
  const star = kit.mat('star', { rough: 0.6, flat: true });
  const starfish = new Group();
  starfish.position.set(0.06, 0.25, 0.02);
  starfish.rotation.set(-1.2, 0.3, 0);
  for (let i = 0; i < 5; i += 1) {
    const arm = new Mesh(new ConeGeometry(0.03, 0.11, 4), star);
    arm.position.set(Math.sin((i / 5) * Math.PI * 2) * 0.05, Math.cos((i / 5) * Math.PI * 2) * 0.05, 0);
    arm.rotation.z = -(i / 5) * Math.PI * 2;
    starfish.add(arm);
  }
  group.add(starfish);
  return kit.shadows(group);
}

function wingGeometry() {
  const shape = new Shape();
  shape.moveTo(0, 0.28);
  shape.quadraticCurveTo(0.45, 0.18, 0.78, -0.12);
  shape.quadraticCurveTo(0.4, -0.1, 0, -0.3);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 4 });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function carrier(kit) {
  const object = new Group();
  const body = new Group();
  object.add(body);
  const top = kit.mat('manta', { rough: 0.5 });
  const belly = kit.mat('belly', { rough: 0.6 });
  body.add(blob(kit, 0.32, top, [0, 0, 0], [1, 0.32, 1.25], 12));
  body.add(blob(kit, 0.3, belly, [0, -0.03, 0.02], [0.95, 0.24, 1.2], 10));
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * 0.22, 0, 0);
    const wing = new Mesh(wingGeometry(), top);
    wing.scale.x = side;
    pivot.add(wing);
    body.add(pivot);
    wings.push({ pivot, side });
    const horn = new Mesh(new ConeGeometry(0.05, 0.22, 5), top);
    horn.position.set(side * 0.14, 0.02, 0.42);
    horn.rotation.set(Math.PI / 2, 0, side * 0.3);
    body.add(horn);
    body.add(kit.sphere(0.035, kit.mat('#101418', { rough: 0.2 }), [side * 0.2, 0.05, 0.3], 6));
  }
  const tail = kit.cylinder(0.006, 0.025, 0.8, top, [0, 0, -0.75], 4);
  tail.rotation.x = Math.PI / 2;
  body.add(tail);
  body.add(kit.box(0.5, 0.02, 0.06, kit.mat('trim', { rough: 0.8 }), [0, 0.1, 0]));
  const hold = new Group();
  hold.position.set(0, 0.25, -0.02);
  body.add(hold);
  body.scale.setScalar(1.25);
  kit.shadows(object);
  return {
    object, hold, route: 'air', cruise: 2.8,
    pose(target, { time, speed, phase }) {
      const flap = Math.sin(time * 3.2);
      for (const { pivot, side } of wings) pivot.rotation.z = side * flap * (phase === 'travel' ? 0.38 : 0.2);
      body.rotation.x = Math.sin(time * 3.2 + 1) * 0.06 - speed * 0.08;
      target.rotation.z = Math.sin(time * 0.9) * 0.12 * speed;
      target.position.y += flap * 0.05;
      tail.rotation.y = Math.sin(time * 2.4) * 0.2;
    },
  };
}

// ---------- the reef around it ----------

function seaFan(kit, at, scale, key) {
  const material = memo(kit, `fan:${key}`, () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = `#${kit.color(key).getHexString()}`;
    ctx.lineWidth = 3;
    const base = [w / 2, h - 4];
    for (let i = 0; i < 9; i += 1) {
      const a = -1.2 + (i / 8) * 2.4;
      ctx.beginPath();
      ctx.moveTo(...base);
      ctx.quadraticCurveTo(w / 2 + Math.sin(a) * w * 0.25, h * 0.55, w / 2 + Math.sin(a) * w * 0.46, h * (0.15 + Math.abs(a) * 0.15));
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 7; r += 1) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h - 4, w * (0.12 + r * 0.055), h * (0.14 + r * 0.11), 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
  }, { width: 128, height: 128, transparent: true, doubleSide: true, rough: 0.7 }));
  const fan = new Mesh(new PlaneGeometry(1.4 * scale, 1.4 * scale), material);
  fan.position.set(at[0], 0.7 * scale, at[2]);
  fan.rotation.y = at[1];
  return fan;
}

function anchor(kit, at) {
  const group = new Group();
  const iron = kit.mat('iron', { rough: 0.6, metal: 0.5 });
  group.add(kit.cylinder(0.07, 0.07, 1.6, iron, [0, 0.8, 0], 6));
  const bar = kit.cylinder(0.05, 0.05, 0.9, iron, [0, 1.45, 0], 6);
  bar.rotation.z = Math.PI / 2;
  group.add(bar);
  const fluke = new Mesh(new TorusGeometry(0.45, 0.06, 5, 10, Math.PI), iron);
  fluke.rotation.z = Math.PI;
  fluke.position.y = 0.4;
  group.add(fluke);
  group.add(new Mesh(new TorusGeometry(0.12, 0.03, 5, 8), iron).translateY(1.7));
  group.position.set(...at);
  group.rotation.set(0.1, 0.6, 0.45);
  return group;
}

function decor(kit) {
  const group = new Group();
  for (const [x, z, s] of [[-10.6, -6.2, 0.5], [10.4, -5.6, 0.6], [-11.2, 2.4, 0.8], [11.4, 4.2, 0.9], [-10.4, 9.4, 0.7], [10.8, 10.2, 0.4], [-5.2, -9.8, 0.1], [4.8, -10.2, 0.2], [0, -12.4, 0.3]]) {
    for (let i = 0; i < 4; i += 1) {
      const height = 3.2 + seeded(x * 3 + i) * 3;
      group.add(kelpStrand(kit, [x + (seeded(i + x) - 0.5) * 1.6, 0, z + (seeded(i + z) - 0.5) * 1.4], height, Math.round(x * 7 + i + s * 10)));
    }
  }
  [[-12.5, -3, 1.2], [12.6, -1, 1.3], [-12.8, 6.5, 1], [-8, -10.5, 1.4], [8.5, -10, 1.2], [12.2, 8.6, 0.9]].forEach(([x, z, size], i) => {
    for (let lump = 0; lump < 3; lump += 1) {
      const r = size * (0.8 - lump * 0.18);
      const rock = blob(kit, r, flat(kit, (i + lump) % 2 ? 'rock' : 'rockDark'), [x + (lump - 1) * size * 0.7, r * 0.35, z + seeded(i + lump) * 0.6], [1.2, 0.75, 1], 9);
      rock.rotation.y = seeded(i * 3 + lump) * 3;
      group.add(rock);
    }
  });
  [[-10.2, -2.0, 'coralPink'], [-10.0, 5.6, 'coralGold'], [10.2, 1.2, 'coralViolet'], [10.1, 7.2, 'coralCyan'], [-6.8, -8.2, 'coralGold'], [6.6, -8, 'coralPink'], [-2.8, -8.6, 'coralCyan'], [3.2, -8.8, 'coralViolet']].forEach(([x, z, key], i) => {
    group.add(staghorn(kit, [x, 0, z], 1.1 + seeded(i) * 0.6, key));
    group.add(brainCoral(kit, [x + 0.8, 0.15, z + 0.5], 0.45 + seeded(i + 9) * 0.3, CORALS[(i + 1) % 4]));
  });
  [[-10.5, -0.2, 0.4, 'coralViolet'], [10.6, -2.8, -0.5, 'coralPink'], [-9.9, 7.8, 0.6, 'coralGold'], [10.2, 5.4, -0.2, 'coralCyan'], [-1.6, -9.4, 0.1, 'coralPink']].forEach(([x, z, turn, key], i) => {
    group.add(seaFan(kit, [x, turn, z], 1 + seeded(i + 4) * 0.6, key));
  });
  group.add(anchor(kit, [-10.6, -0.4, 3.6]));
  const cannon = kit.cylinder(0.16, 0.22, 1.5, kit.mat('iron', { rough: 0.6, metal: 0.5 }), [10.4, 0.12, -4.2], 8);
  cannon.rotation.set(Math.PI / 2 - 0.15, 0.7, 0);
  group.add(cannon);
  for (const [x, z] of [[-9.0, -6.8], [9.2, -6.6], [-12.2, 10], [12.4, -6.4]]) group.add(seaGrass(kit, x, z, 0.6, Math.round(x + z)));

  const shaftMat = memo(kit, 'shaft', () => kit.painted((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const side = ctx.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.3, 'rgba(0,0,0,0)');
    side.addColorStop(0.7, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, w, h);
  }, { width: 64, height: 128, basic: true, additive: true, transparent: true, opacity: kit.mode === 'dark' ? 0.12 : 0.22, doubleSide: true }));
  const store = bag(kit);
  for (const [x, z, w, lean] of [[-7, -9, 2.4, 0.25], [-1.5, -10.5, 3.2, 0.2], [5, -9.5, 2.0, 0.28], [9.5, -4, 1.8, 0.22], [-9.5, 1.5, 1.6, 0.26]]) {
    const shaft = new Mesh(new PlaneGeometry(w, 16), shaftMat);
    shaft.position.set(x, 7.5, z);
    shaft.rotation.z = lean;
    shaft.renderOrder = 2;
    group.add(shaft);
    store.shafts.push(shaft);
  }
  return kit.shadows(group);
}

// ---------- ambient life ----------

function whale(kit) {
  const group = new Group();
  const material = new MeshBasicMaterial({ color: kit.mode === 'dark' ? '#0c2c44' : '#4d97ad', transparent: true, opacity: kit.mode === 'dark' ? 0.75 : 0.45, depthWrite: false, fog: false });
  const body = new Mesh(new SphereGeometry(1, 12, 8), material);
  body.scale.set(1.1, 1, 4.2);
  group.add(body);
  const tail = new Mesh(new ConeGeometry(0.5, 2.4, 6), material);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -5;
  group.add(tail);
  const fluke = new Mesh(new SphereGeometry(1, 8, 4), material);
  fluke.scale.set(2.2, 0.12, 0.7);
  fluke.position.z = -6.2;
  group.add(fluke);
  for (const side of [-1, 1]) {
    const fin = new Mesh(new SphereGeometry(1, 8, 4), material);
    fin.scale.set(1.6, 0.1, 0.5);
    fin.position.set(side * 1.6, -0.5, 1.2);
    fin.rotation.y = side * -0.4;
    group.add(fin);
  }
  return { group, material, fluke };
}

function weather(kit) {
  const object = new Group();
  const dark = kit.mode === 'dark';
  const bubbleGeo = new SphereGeometry(0.06, 8, 6);
  const bubbleMat = new MeshBasicMaterial({ color: kit.palette.smoke, transparent: true, opacity: dark ? 0.6 : 0.7, depthWrite: false });
  const vents = [[-9.2, -3.5], [9.4, 2.5], [-8.8, 8], [7.6, -7.6], [-3.5, -8.2], [9.8, 9]];
  const bubbles = Array.from({ length: 36 }, (_, i) => {
    const mesh = new Mesh(bubbleGeo, bubbleMat);
    object.add(mesh);
    const [x, z] = vents[i % vents.length];
    return { mesh, x, z, offset: seeded(i * 7 + 1), speed: 0.12 + seeded(i) * 0.08, size: 0.6 + seeded(i + 3) * 1.1, phase: i * 1.3 };
  });

  const count = 70;
  const seeds = new Float32Array(count * 4);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    seeds.set([(seeded(i * 3 + 5) - 0.5) * 28, 0.4 + seeded(i * 5 + 6) * 5.5, seeded(i * 7 + 7) * 24 - 11, seeded(i * 11 + 8) * Math.PI * 2], i * 4);
    positions.set([seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2]], i * 3);
  }
  const plankGeo = new BufferGeometry();
  plankGeo.setAttribute('position', new BufferAttribute(positions, 3));
  const sprite = kit.canvas(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(180,250,255,0.5)');
    g.addColorStop(1, 'rgba(180,250,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const plankMat = new PointsMaterial({ map: sprite, color: kit.color('glow'), size: dark ? 0.2 : 0.13, transparent: true, opacity: dark ? 0.8 : 0.5, depthWrite: false });
  const plankton = new Points(plankGeo, plankMat);
  plankton.frustumCulled = false;
  object.add(plankton);

  const giant = whale(kit);
  giant.group.position.set(-20, 3.6, -12.5);
  giant.group.scale.setScalar(0.55);
  giant.group.rotation.y = Math.PI / 2 - 0.15;
  object.add(giant.group);

  return {
    object,
    frame(time) {
      if (kit.reducedMotion) return;
      for (const b of bubbles) {
        const rise = (time * b.speed + b.offset) % 1;
        b.mesh.position.set(b.x + Math.sin(time * 2.6 + b.phase) * 0.12, rise * 9, b.z + Math.cos(time * 2.1 + b.phase) * 0.1);
        b.mesh.scale.setScalar(b.size * (0.6 + rise * 0.7));
      }
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = seeds[i * 4] + Math.sin(time * 0.3 + seeds[i * 4 + 3]) * 0.9;
        positions[i * 3 + 1] = seeds[i * 4 + 1] + Math.sin(time * 0.55 + seeds[i * 4 + 3] * 1.4) * 0.35;
        positions[i * 3 + 2] = seeds[i * 4 + 2] + Math.cos(time * 0.27 + seeds[i * 4 + 3]) * 0.7;
      }
      plankGeo.attributes.position.needsUpdate = true;
      const cruise = ((time * 0.012) % 1);
      giant.group.position.x = -22 + cruise * 44;
      giant.group.position.y = 3.6 + Math.sin(time * 0.2) * 0.3;
      giant.fluke.rotation.x = Math.sin(time * 0.8) * 0.25;
    },
    dispose() {
      bubbleGeo.dispose();
      bubbleMat.dispose();
      plankGeo.dispose();
      plankMat.dispose();
      giant.group.traverse(node => node.geometry?.dispose());
      giant.material.dispose();
    },
  };
}

function frame(time, _dt, kit) {
  if (kit.reducedMotion) return;
  const store = bag(kit);
  store.caustics.forEach((map, i) => map.offset.set(time * (i ? -0.011 : 0.014), time * (i ? 0.009 : -0.006)));
  for (const { joints, phase } of store.kelp) {
    joints.forEach((joint, i) => {
      joint.rotation.z = Math.sin(time * 0.7 + phase + i * 0.5) * 0.09;
      joint.rotation.x = Math.sin(time * 0.5 + phase * 1.3 + i * 0.4) * 0.06;
    });
  }
  // The glass trail lights up only while something is really travelling it.
  const { clock, flow } = kit.traffic;
  store.pulses.forEach((pulse, i) => {
    const t = (clock * 0.3 + i / 3) % 1;
    const z = 10.6 - t * 13.4;
    pulse.position.set(Math.sin(z * 0.62) * 0.28, 0.05, z);
    pulse.material.opacity = Math.sin(t * Math.PI) * (kit.mode === 'dark' ? 0.6 : 0.4) * flow;
  });
  store.shafts.forEach((shaft, i) => {
    shaft.scale.x = 0.85 + Math.sin(time * 0.25 + i * 1.7) * 0.15;
  });
}

export default {
  palette: PALETTE, backdrop: BACKDROP,
  layout: { bend: -0.6, stagger: 0.15, jitter: 0.12, turn: 0.35 },
  view: { elevation: 0.7, azimuth: -0.1 },
  pad: false, dock, floor, hall, station, crate, carrier, decor, weather, frame,
};
