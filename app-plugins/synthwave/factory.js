// Synthwave's Factory floor: a neon strip at sunset. The main agent is ORC FM,
// an art deco radio station at the head of a boulevard, with a mast, a speaker
// in each wing and a hatch that takes each tape. Workers are shops on lit lots
// (an arcade, a diner, a record shop), each kept by a chrome robot; subagents
// are kiosks (a phone booth, a jukebox, a billboard, an ice cream stand). A
// sports car brings each finished tape up the avenue to the station's hatch,
// and the theme's own sunset stands behind it all. Night is the neon drive;
// day is Golden hour, a pale poster with pastel buildings and violet roads.
//
// The car collects a tape from a lot's front and drives straight back to the
// street behind its row, and cars from further out pass along the streets
// either side of it, so each lot is cut back from all three roads: no car
// drives through a shop, its keeper or its lamp (tests/test-synthwave-factory.js
// drives every route past every lot). The still parts of each building are
// drawn as one mesh per material, since the floor is drawn twice while the
// view travels between towns.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute,
  Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, ShapeGeometry, TorusGeometry, Vector3,
} from 'three';
import { CAPACITY, createLayout } from '../../ui/yeet/factory-layout.js';

// The engine's palette keys, in the theme's own inks (app-plugins/synthwave/theme.css).
const PALETTE = {
  light: {
    ground: '#f3cde6', horizon: '#f9c4c4', zenith: '#f4dcf6',
    line: '#e0218a', aisle: '#3a1260', body: '#fdf6ff', trim: '#4b1b7c', roof: '#f0288f',
    accent: '#00a3b0', worker: '#8a3ffc', busy: '#ff9d0a', ok: '#0c9f77', fail: '#e11d48', idle: '#a48fbd',
    crate: '#3a1260', tape: '#e0218a', smoke: '#d9a8e8', moss: '#c23fd0', glow: '#00a3b0', window: '#ffd53d', door: '#240840',
    sky: '#fff0f6', sun: '#fff3e0', chrome: '#eef1fc', pave: '#f8eefc',
    sunIntensity: 2.7, skyIntensity: 1.55, envIntensity: 0.5, exposure: 1.0, fogNear: 5, fogSpan: 30,
  },
  dark: {
    ground: '#0d0424', horizon: '#2a0d55', zenith: '#0c0424',
    line: '#ff3fa4', aisle: '#07021a', body: '#b8c0e8', trim: '#230e48', roof: '#ff3fa4',
    accent: '#2de2e6', worker: '#c77dff', busy: '#ffe66d', ok: '#6dfacb', fail: '#ff5c7a', idle: '#6e5d9e',
    crate: '#190a30', tape: '#ff3fa4', smoke: '#bd8fe6', moss: '#d65ae6', glow: '#2de2e6', window: '#ffe66d', door: '#06010e',
    sky: '#a682ea', sun: '#e8dcff', chrome: '#d6dcf5', pave: '#1d1147',
    sunIntensity: 2.15, skyIntensity: 1.5, envIntensity: 0.55, exposure: 1.14, fogNear: 5, fogSpan: 30,
  },
};

// What the scenery and the buildings are painted with. The scenery is a
// picture, not a lit model, so it keeps the theme's inks whatever the lights do.
const INK = {
  dark: {
    sky: [[0, '#0c0424'], [0.34, '#130837'], [0.6, '#1a0b3d'], [1, '#1b0b3f']],
    haze: [[0, 'rgba(214,62,150,0.62)'], [0.09, 'rgba(150,40,150,0.5)'], [0.26, 'rgba(96,26,128,0.4)'], [0.52, 'rgba(52,16,100,0.26)'], [1, 'rgba(52,16,100,0)']],
    glow: '#ff6e96', glowOpacity: 0.5,
    sun: [[0, '#fff08a'], [0.16, '#ffd65a'], [0.34, '#ff9d4f'], [0.5, '#ff5a8c'], [0.62, '#f03ab4'], [0.8, '#b42dff'], [1, '#b42dff']],
    ridge: '#2a0f58', ridgeLine: '#8a3f95',
    hillShade: '#120630', hillTop: '#6b1f8f', hillFoot: '#2a0e58', hillEdge: '#2de2e6', hillRim: '#ff3fa4',
    palm: '#08021a',
    floor: '#0d0424', floorLine: 'rgba(255,63,164,0.9)', floorRay: 'rgba(45,226,230,0.85)', floorFaint: 'rgba(255,63,164,0.3)',
    horizon: '#ff3fa4', lane: '#07021a', laneEdge: '#2de2e6', laneLine: '#ffe9a8',
    tower: '#a79cf0', wing: '#d78ad8', roofTop: '#6a58c4', walls: ['#d78ad8', '#6fcfd0', '#a79cf0'],
  },
  light: {
    sky: [[0, '#f4dcf6'], [1, '#f4dcf6']],
    haze: [[0, 'rgba(255,168,140,0.9)'], [0.12, 'rgba(255,190,165,0.72)'], [0.34, 'rgba(255,205,195,0.46)'], [0.6, 'rgba(252,214,224,0.22)'], [1, 'rgba(252,214,224,0)']],
    glow: '#ffd0b8', glowOpacity: 0.95,
    sun: [[0, '#ffd53d'], [0.26, '#ffd53d'], [0.26, '#ffb640'], [0.39, '#ffb640'], [0.39, '#ff9150'], [0.5, '#ff9150'],
      [0.5, '#ff6f74'], [0.59, '#ff6f74'], [0.59, '#f24a98'], [0.68, '#f24a98'], [0.68, '#c53dcd'], [1, '#c53dcd']],
    ridge: '#dfb6ee', ridgeLine: null,
    hillShade: '#7a3aab', hillTop: '#d2a0ec', hillFoot: '#b072d6', hillEdge: '#3a1260', hillRim: '#3a1260',
    palm: '#3a1260',
    floor: '#efc3e2', floorLine: 'rgba(200,8,116,1)', floorRay: 'rgba(0,122,136,1)', floorFaint: 'rgba(200,8,116,0.55)',
    horizon: '#3a1260', lane: '#3a1260', laneEdge: '#8fe6ec', laneLine: '#fff3c4',
    tower: '#fffaf2', wing: '#ffc9de', roofTop: '#fff0fa', walls: ['#ffc9de', '#bdeee8', '#fff1c9'],
  },
};

// The theme's own lettering (--synthwave-font in theme.css), for the signs.
const LETTERING = '"Avenir Next", Futura, "Century Gothic", "Trebuchet MS", system-ui, sans-serif';

// Behind the canvas, for the rare view that looks over the top of the sky.
function backdrop(mode) {
  return mode === 'dark' ? 'linear-gradient(180deg, #0c0424 0%, #130837 60%, #1a0b3d 100%)' : '#f4dcf6';
}

const skinCache = new WeakMap();
function memo(kit, key, build) {
  let bag = skinCache.get(kit);
  if (!bag) {
    bag = {};
    skinCache.set(kit, bag);
  }
  return (bag[key] ||= build());
}

const neon = (kit, color, glow = 1.45) => kit.mat(color, { emissive: color, glow, rough: 0.32, metal: 0.15 });
// Chrome: polished where the floor has its studio light to mirror, and satin
// where it draws in software with none, so it reads light rather than grey.
const chromeOf = (kit, { rough = 0.2, metal = 0.8, doubleSide = false } = {}) =>
  kit.mat('chrome', { rough, metal: kit.software ? metal * 0.4 : metal, doubleSide });

const TAU = Math.PI * 2;

const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Rises fast and dies away over `life` seconds; 0 outside it.
function burst(age, life) {
  if (!(age >= 0 && age < life)) return 0;
  const t = age / life;
  return Math.min(1, t * 8) * (1 - t);
}

// ---------- drawing still parts as one ----------

// The parts in `parts` that never move apart, drawn as one mesh for each
// material they wear, each part laid where it stood. Their geometry is used up.
// A transparent part is moved over as it is, so it still sorts where it stands.
function bake(parts) {
  parts.updateMatrixWorld(true);
  const from = new Matrix4().copy(parts.matrixWorld).invert();
  const sets = new Map();
  const clear = [];
  parts.traverse(mesh => {
    if (!mesh.isMesh) return;
    const place = new Matrix4().multiplyMatrices(from, mesh.matrixWorld);
    if (mesh.material.transparent) {
      clear.push([mesh, place]);
      return;
    }
    const names = Object.keys(mesh.geometry.attributes).sort().join();
    const key = [mesh.material.uuid, names, mesh.receiveShadow, mesh.renderOrder].join('|');
    if (!sets.has(key)) sets.set(key, { mesh, pieces: [] });
    const piece = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    mesh.geometry.dispose();
    sets.get(key).pieces.push(piece.applyMatrix4(place));
  });
  const baked = new Group();
  for (const [mesh, place] of clear) {
    place.decompose(mesh.position, mesh.quaternion, mesh.scale);
    baked.add(mesh);
  }
  for (const { mesh: first, pieces } of sets.values()) {
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
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    baked.add(mesh);
  }
  return baked;
}

// Bakes a group's own parts in place, keeping the group for what moves it.
function solid(group) {
  const parts = new Group();
  parts.add(...group.children);
  group.add(bake(parts));
  return group;
}

// ---------- where things stand: the engine's own street grid ----------

// A street grid: straight rows, with each front turned well towards the camera.
const TURN = 0.5;
const layout = { bend: 0, turn: TURN };
const view = { elevation: 0.47, azimuth: 0 };

// Every slot's place, turn and outlet, from the layout the engine draws with.
const grid = createLayout(layout);
const SLOTS = Array.from({ length: CAPACITY }, (_, slot) => ({ ...grid.slotPosition(slot), out: grid.outlet(slot) }));
const ROW_Z = [];
for (const spot of SLOTS) ROW_Z[spot.row] = spot.z;
const ROW_GAP = ROW_Z[1] - ROW_Z[0];
// The street on the hall side of each row, which is the way a car leaves it.
const STREETS = ROW_Z.map(z => z - ROW_GAP / 2);
const STREET_WIDTH = 0.8;
const STREET_REACH = 9.7;
// How far apart the columns stand on each side of the avenue.
const COLUMN_STEP = (() => {
  const reaches = [...new Set(SLOTS.map(spot => Math.abs(spot.x)))].sort((a, b) => a - b);
  return reaches[1] - reaches[0];
})();

// The car is drawn at 0.8 of its model, and is CAR_HALF wide either side of
// its middle at that size. Lots keep CLEARANCE more from where it drives.
const CAR_SCALE = 0.8;
const CAR_HALF = 0.5 * CAR_SCALE;
const CLEARANCE = 0.06;
// The engine first shows a ground car this far aisle-side of its station's
// outlet, then pulls it in (ui/yeet/factory.js, animateDelivery).
const PULL_IN = 0.45;

// The lot each kind stands on, before it is cut back from the roads.
const LOT = { worker: [1.9, 1.7], subagent: [1.5, 1.4] };

// The slot a station stands in. A station built with no slot stands in the first.
const slotOf = spot => SLOTS[spot?.slot ?? 0] || SLOTS[0];

// Builders lay a lot out with its drive on the left, as it is on the right of
// the avenue. This is 1 there and -1 on the left, where the lot is mirrored.
const handed = spot => (slotOf(spot).side > 0 ? 1 : -1);

// A station is turned to the aisle. This turns a part of it back to the camera.
const facing = spot => handed(spot) * (Math.PI / 2 - TURN) * 0.86;

// Keeps the side of a convex polygon where `inside` is not negative.
function clip(points, inside) {
  const kept = [];
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    const a = inside(point);
    const b = inside(next);
    if (a >= 0) kept.push(point);
    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      kept.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t]);
    }
  });
  return kept;
}

// A lot's outline in the station's own frame, as [x, z] points running
// clockwise seen from above: its rectangle, cut back to the block the roads
// leave it. Its own car drives off on the aisle side, the next car out pulls
// in on the far side, and cars pass along the streets either side of its row.
function lotOutline(kind, spot) {
  const { x, yaw, side, out } = slotOf(spot);
  const [width, depth] = LOT[kind];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const toWorld = ([u, v]) => [u * cos + v * sin, -u * sin + v * cos];
  const toLocal = ([u, v]) => [u * cos - v * sin, u * sin + v * cos];
  // How far the drive is from the lot's middle towards the aisle.
  const drive = side * (x - out.x);
  const keep = CAR_HALF + CLEARANCE;
  let outline = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(toWorld);
  outline = clip(outline, ([u]) => side * u + drive - keep);
  outline = clip(outline, ([u]) => COLUMN_STEP - drive - PULL_IN - keep - side * u);
  outline = clip(outline, ([, v]) => v + ROW_GAP / 2 - keep);
  outline = clip(outline, ([, v]) => ROW_GAP / 2 - keep - v);
  // A cut that only grazes a corner leaves a sliver of an edge, which would
  // send an inset outline's corner far outside; such corners are dropped.
  outline = outline.filter((point, i) => {
    const next = outline[(i + 1) % outline.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 0.03;
  });
  return outline.map(toLocal);
}

// A clockwise outline moved in by `by` along every edge.
function inset(points, by) {
  const lines = points.map((point, i) => {
    const next = points[(i + 1) % points.length];
    const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const along = [(next[0] - point[0]) / length, (next[1] - point[1]) / length];
    // Seen from above with z towards the camera, inwards is to the right.
    return { point: [point[0] - along[1] * by, point[1] + along[0] * by], along };
  });
  return lines.map((line, i) => {
    const before = lines[(i + lines.length - 1) % lines.length];
    const cross = before.along[0] * line.along[1] - before.along[1] * line.along[0];
    if (Math.abs(cross) < 1e-6) return line.point;
    const dx = line.point[0] - before.point[0];
    const dz = line.point[1] - before.point[1];
    const t = (dx * line.along[1] - dz * line.along[0]) / cross;
    return [before.point[0] + before.along[0] * t, before.point[1] + before.along[1] * t];
  });
}

// An outline as a flat shape in x and -z, ready to lie on the ground.
function outlineShape(points) {
  const shape = new Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  return shape;
}

// Lays a part that runs along x from a to b, at height `y`.
function along(part, [ax, az], [bx, bz], y) {
  part.position.set((ax + bx) / 2, y, (az + bz) / 2);
  part.rotation.y = Math.atan2(-(bz - az), bx - ax);
  return part;
}

// A strip from a to b on the ground, `width` wide, `height` tall at `y`.
function edgeStrip(kit, a, b, width, height, y, material) {
  return along(kit.box(Math.hypot(b[0] - a[0], b[1] - a[1]), height, width, material), a, b, y);
}

// ---------- the strip: a boulevard, its cross streets and what stands on them ----------

const DASHES = 18;
const DASH_GAP = 1.0;
const ROAD_FROM = -3.5;
// The avenue: its road, and a pavement out to where the shops' drives run.
const ROAD_HALF = 1.0;
const PAVE_FROM = 1.05;
const PAVE_TO = 1.33;

// Lettering in neon on a dark board, facing +z.
function sign(kit, text, { width = 1.3, height = 0.34, ink = '#ff3fa4', edge = '#2de2e6' } = {}) {
  const material = memo(kit, ['sign', text, ink, edge, width, height].join(':'), () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#120628';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 7;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.font = 'italic 800 ' + Math.round(h * 0.6) + 'px ' + LETTERING;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = ink;
    ctx.shadowBlur = 16;
    ctx.fillStyle = ink;
    ctx.fillText(text, w / 2, h / 2 + 3, w - 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(text, w / 2, h / 2 + 3, w - 40);
  }, { width: 512, height: Math.max(64, Math.round(512 * height / width)), emissive: true, glow: 1.05, rough: 0.3 }));
  const group = new Group();
  group.add(kit.box(width + 0.07, height + 0.07, 0.05, kit.mat('#120628', { rough: 0.5 }), [0, 0, -0.03]));
  group.add(new Mesh(new PlaneGeometry(width, height), material));
  return group;
}

// A sign on two legs over a roof, turned to the camera.
function roofSign(kit, spot, text, at, options = {}) {
  const board = sign(kit, text, options);
  const group = new Group();
  const height = options.height || 0.34;
  const width = options.width || 1.3;
  board.position.y = height / 2 + 0.14;
  for (const side of [-1, 1]) group.add(kit.cylinder(0.02, 0.02, 0.16, chromeOf(kit), [side * width * 0.36, 0.07, -0.03], 6));
  group.add(board);
  group.position.set(...at);
  group.rotation.y = facing(spot);
  return group;
}

// A neon arch over the avenue. Its legs stand on the pavement, clear of the
// shops' drives beside it.
function gate(kit, z, color) {
  const group = new Group();
  const tube = neon(kit, color, 1.8);
  const chrome = chromeOf(kit);
  const span = 1.19;
  const leg = 1.2;
  for (const side of [-1, 1]) {
    group.add(kit.cylinder(0.04, 0.055, leg, chrome, [side * span, leg / 2, z], 8));
    group.add(kit.cylinder(0.1, 0.12, 0.08, chrome, [side * span, 0.04, z], 8));
    group.add(kit.box(0.035, leg - 0.12, 0.035, tube, [side * (span - 0.075), leg / 2 + 0.06, z + 0.03]));
  }
  const arch = new Mesh(new TorusGeometry(span, 0.045, 8, 28, Math.PI), chrome);
  arch.position.set(0, leg, z);
  const glow = new Mesh(new TorusGeometry(span - 0.075, 0.03, 6, 28, Math.PI), tube);
  glow.position.set(0, leg, z + 0.03);
  group.add(arch, glow);
  return group;
}

// Where finished tapes wait beside the station: a lit rack. The engine piles
// crates from x 2.95, z -3.85. The rack stands back from the first street,
// which a car from that row's outer lot noses across as it turns into it.
function dock(kit) {
  const group = new Group();
  const still = new Group();
  group.position.set(3.5, 0, -3.7);
  const chrome = chromeOf(kit);
  const pink = neon(kit, 'roof', 1.6);
  const cyan = neon(kit, 'accent', 1.5);
  group.add(kit.shadow(2.5, 1.9, 0.3, [0, 0.004, 0]));
  group.add(kit.halo('roof', 3.4, 2.6, { opacity: kit.mode === 'dark' ? 0.26 : 0.12, at: [0, 0.009, 0] }));
  still.add(kit.box(2.04, 0.1, 1.44, kit.mat('trim', { rough: 0.42, metal: 0.38 }), [0, 0.05, 0]));
  still.add(kit.box(1.9, 0.02, 1.3, kit.mat('aisle', { rough: 0.2, metal: 0.5 }), [0, 0.11, 0]));
  for (const side of [-1, 1]) {
    still.add(kit.box(0.04, 0.035, 1.4, pink, [side * 1.0, 0.115, 0]));
    still.add(kit.box(2.04, 0.035, 0.04, pink, [0, 0.115, side * 0.7]));
    still.add(kit.cylinder(0.035, 0.045, 0.62, chrome, [side * 0.97, 0.41, -0.67], 8));
  }
  // The rail at the back, with a row of level lights along it.
  still.add(kit.box(2.0, 0.05, 0.05, chrome, [0, 0.7, -0.67]));
  for (let i = 0; i < 7; i += 1) still.add(kit.box(0.16, 0.07, 0.03, i % 3 === 0 ? pink : cyan, [-0.72 + i * 0.24, 0.6, -0.66]));
  group.add(bake(still));
  return kit.shadows(group);
}

function streetLamp(kit, still, glows, x, z, tint) {
  const chrome = chromeOf(kit);
  const side = Math.sign(x);
  still.add(kit.cylinder(0.022, 0.035, 1.25, chrome, [x, 0.625, z], 6));
  still.add(kit.box(0.36, 0.03, 0.03, chrome, [x - side * 0.16, 1.24, z]));
  still.add(kit.box(0.26, 0.045, 0.07, neon(kit, tint, 1.9), [x - side * 0.2, 1.2, z]));
  glows.add(kit.halo(tint, 1.7, 1.7, { opacity: kit.mode === 'dark' ? 0.2 : 0.05, at: [x - side * 0.3, 0.032, z] }));
}

function floor(kit) {
  const group = new Group();
  const still = new Group();
  const dark = kit.mode === 'dark';
  const ink = INK[kit.mode];
  // The theme's floor: lines across in pink, and the ones that run to the
  // horizon in cyan, on a floor with no gloss to catch the lights. One tile is
  // 2 by 2 and holds two cells each way.
  const gridGround = kit.ground({
    radius: 72,
    rough: 1,
    metal: 0,
    repeat: [72, 72],
    draw(ctx, w, h) {
      ctx.fillStyle = ink.floor;
      ctx.fillRect(0, 0, w, h);
      const line = (x0, y0, x1, y1, style, width, blur = 0) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.shadowColor = style;
        ctx.shadowBlur = blur;
        // Drawn at each edge too, so the glow carries over the tile's seam.
        for (const shift of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(x0 + (x0 === x1 ? shift * w : 0), y0 + (y0 === y1 ? shift * h : 0));
          ctx.lineTo(x1 + (x0 === x1 ? shift * w : 0), y1 + (y0 === y1 ? shift * h : 0));
          ctx.stroke();
        }
      };
      const glow = dark ? 14 : 0;
      const weight = dark ? 5 : 10;
      line(-w, h * 0.25, 2 * w, h * 0.25, ink.floorLine, weight, glow);
      line(-w, h * 0.75, 2 * w, h * 0.75, ink.floorLine, weight, glow);
      line(w * 0.25, -h, w * 0.25, 2 * h, ink.floorRay, weight - 1, glow);
      line(w * 0.75, -h, w * 0.75, 2 * h, ink.floorFaint, weight - 1, 0);
      ctx.shadowBlur = 0;
    },
  });
  if (dark) {
    gridGround.material.emissive.setHex(0xffffff);
    gridGround.material.emissiveMap = gridGround.material.map;
    gridGround.material.emissiveIntensity = 0.62;
  }
  group.add(gridGround);
  // The sun lies down the middle of the floor.
  group.add(kit.halo(dark ? '#ff78aa' : '#ffbe78', 13, 30, { opacity: dark ? 0.2 : 0.42, at: [0, 0.006, -4] }));
  group.add(kit.halo(dark ? '#ff3fa4' : '#ffbe78', 46, 9, { opacity: dark ? 0.2 : 0.3, at: [0, 0.007, WALL_Z + 4] }));

  // The avenue up to the station's door.
  const length = DASHES * DASH_GAP;
  const middle = ROAD_FROM + length / 2;
  const tarmac = kit.mat('aisle', { rough: 0.92, metal: 0 });
  const road = kit.box(ROAD_HALF * 2, 0.026, length, tarmac, [0, 0.013, middle]);
  road.receiveShadow = !kit.software;
  still.add(road);
  const cyan = neon(kit, 'accent', 1.65);
  const pink = neon(kit, 'roof', 1.55);
  const pave = kit.mat('pave', { rough: 0.85, metal: 0.04 });
  for (const side of [-1, 1]) still.add(kit.box(0.05, 0.012, length, cyan, [side * (ROAD_HALF - 0.07), 0.03, middle]));
  // Pavements and kerbs, broken where a street comes in.
  const blocks = [];
  let from = ROAD_FROM;
  for (const z of STREETS) {
    blocks.push([from, z - STREET_WIDTH / 2]);
    from = z + STREET_WIDTH / 2;
  }
  blocks.push([from, ROAD_FROM + length]);
  for (const [a, b] of blocks) {
    for (const side of [-1, 1]) {
      const walk = kit.box(PAVE_TO - PAVE_FROM, 0.05, b - a, pave, [side * (PAVE_FROM + PAVE_TO) / 2, 0.025, (a + b) / 2]);
      walk.receiveShadow = !kit.software;
      still.add(walk, kit.box(0.04, 0.062, b - a, pink, [side * (ROAD_HALF + 0.03), 0.031, (a + b) / 2]));
    }
  }
  // The centre line runs towards the station, so the road always looks driven.
  const line = neon(kit, 'window', 1.5);
  const dashes = new Group();
  for (let i = 0; i < DASHES; i += 1) dashes.add(kit.box(0.1, 0.012, 0.5, line, [0, 0.032, ROAD_FROM + i * DASH_GAP]));
  const dash = bake(dashes).children[0];
  group.add(dash);
  memo(kit, 'bag', () => ({})).dash = dash;
  group.add(kit.halo('accent', 3.2, length + 0.6, { opacity: dark ? 0.2 : 0.1, at: [0, 0.008, middle] }));
  // A crossing at the station's door.
  const zebra = kit.mat('#f6ecff', { rough: 0.7, emissive: '#f6ecff', glow: dark ? 0.35 : 0 });
  for (let i = 0; i < 6; i += 1) still.add(kit.box(0.2, 0.006, 0.46, zebra, [-0.75 + i * 0.3, 0.03, -2.72]));

  // The cross streets: one behind each row, where the cars turn in.
  const lane = memo(kit, 'lane', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = ink.lane;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink.laneEdge;
    ctx.fillRect(0, 3, w, 3);
    ctx.fillRect(0, h - 6, w, 3);
    ctx.fillStyle = ink.laneLine;
    ctx.fillRect(w * 0.2, h / 2 - 2, w * 0.6, 4);
  }, { width: 64, height: 64, repeat: [STREET_REACH * 2, 1], rough: 0.92, metal: 0, emissive: dark, glow: 0.7 }));
  const glows = new Group();
  // A lamp each side where each street meets the avenue, or an arch over it
  // at every other: the one place by the avenue where no car pulls in.
  STREETS.forEach((z, i) => {
    const street = new Mesh(new PlaneGeometry(STREET_REACH * 2, STREET_WIDTH), lane);
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0.012, z);
    street.receiveShadow = !kit.software;
    still.add(street);
    if (i % 2) still.add(gate(kit, z + 0.62, i === 1 ? 'roof' : 'accent'));
    else for (const side of [-1, 1]) streetLamp(kit, still, glows, side * 1.22, z + 0.62, side > 0 ? 'accent' : 'roof');
  });
  group.add(bake(still), glows);
  return group;
}

function frame(_time, _dt, kit) {
  if (kit.reducedMotion) return;
  const { dash } = memo(kit, 'bag', () => ({}));
  // The road only runs while something is really driving it.
  if (dash) dash.position.z = DASH_GAP - 0.25 - ((kit.traffic.clock * 2.2) % DASH_GAP);
}

// ---------- hall: ORC FM, a radio station at the head of the strip ----------

// A speaker built into a wall: the ring and cone stay put, the cap and the
// glow move to the beat.
function speaker(kit, radius, at, still, group) {
  const ring = new Mesh(new TorusGeometry(radius, radius * 0.12, 8, 24), chromeOf(kit, { rough: 0.18, metal: 0.8 }));
  ring.position.set(...at);
  const cone = new Mesh(new ConeGeometry(radius * 0.92, radius * 0.4, 20, 1, true), kit.mat('trim', { rough: 0.6, metal: 0.2, doubleSide: true }));
  cone.rotation.x = Math.PI / 2;
  cone.position.set(at[0], at[1], at[2] - radius * 0.2);
  still.add(ring, cone);
  const glow = new Mesh(new TorusGeometry(radius * 0.6, radius * 0.045, 6, 20), neon(kit, 'roof', 1.6));
  glow.position.set(at[0], at[1], at[2] - radius * 0.14);
  const cap = kit.sphere(radius * 0.28, neon(kit, 'accent', 1.2), [at[0], at[1], at[2] - radius * 0.3], 10);
  cap.scale.z = 0.5;
  group.add(glow, cap);
  return { cap, glow, rest: at[2], radius };
}

function hall(kit) {
  const group = new Group();
  const still = new Group();
  const dark = kit.mode === 'dark';
  const ink = INK[kit.mode];
  const wall = kit.mat(ink.tower, { rough: 0.66, metal: 0.03 });
  const wing = kit.mat(ink.wing, { rough: 0.66, metal: 0.03 });
  const trim = kit.mat('trim', { rough: 0.42, metal: 0.38 });
  const roofTop = kit.mat(ink.roofTop, { rough: 0.7, metal: 0.03 });
  const chrome = chromeOf(kit, { rough: 0.18, metal: 0.8 });
  const glass = kit.mat('#0a0420', { rough: 0.2, metal: 0.5 });
  const pink = neon(kit, 'roof', 1.6);
  const cyan = neon(kit, 'accent', 1.6);
  group.add(kit.shadow(6.4, 4.4, 0.42));
  group.add(kit.halo('roof', 7.6, 5.4, { opacity: dark ? 0.3 : 0.14, at: [0, 0.01, 0.4] }));

  // The terrace it stands on.
  still.add(kit.box(5.0, 0.16, 2.9, trim, [0, 0.08, 0]));
  still.add(kit.box(5.04, 0.04, 2.94, pink, [0, 0.17, 0]));
  const base = 0.18;

  // Two low wings with rounded ends, a band of lit window round each.
  const wingH = 2.0;
  const speakers = [];
  for (const side of [-1, 1]) {
    still.add(kit.box(0.8, wingH, 1.56, wing, [side * 1.3, base + wingH / 2, 0]));
    still.add(kit.cylinder(0.78, 0.78, wingH, wing, [side * 1.7, base + wingH / 2, 0], 22));
    still.add(kit.box(0.8, 0.07, 1.64, roofTop, [side * 1.3, base + wingH + 0.035, 0]));
    still.add(kit.cylinder(0.82, 0.82, 0.07, roofTop, [side * 1.7, base + wingH + 0.035, 0], 22));
    const hoop = (y, material) => {
      const ring = new Mesh(new TorusGeometry(0.795, 0.024, 6, 30), material);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(side * 1.7, y, 0);
      still.add(ring, kit.box(0.8, 0.045, 0.045, material, [side * 1.3, y, 0.795]));
    };
    hoop(base + wingH - 0.12, pink);
    hoop(base + 0.2, cyan);
    const arc = Math.PI * 0.72;
    const band = new Mesh(new CylinderGeometry(0.792, 0.792, 0.4, 22, 1, true, side > 0 ? 0.04 : -0.04 - arc, arc), kit.windows);
    band.position.set(side * 1.7, base + 1.42, 0);
    still.add(band, kit.box(0.66, 0.4, 0.03, kit.windows, [side * 1.28, base + 1.42, 0.785]));
    // The speaker in each wing: the old boombox's, built into the wall.
    speakers.push(speaker(kit, 0.3, [side * 1.3, base + 0.66, 0.84], still, group));
  }

  // The tower between them, stepped at the top.
  const towerH = 3.3;
  const face = 1.0;
  const top = base + towerH;
  still.add(kit.box(2.1, towerH, 1.9, wall, [0, base + towerH / 2, 0.05]));
  still.add(kit.box(2.2, 0.08, 2.0, roofTop, [0, top + 0.04, 0.05]));
  still.add(kit.box(1.4, 0.26, 1.3, wall, [0, top + 0.21, 0.05]));
  still.add(kit.box(1.48, 0.06, 1.38, roofTop, [0, top + 0.37, 0.05]));
  still.add(kit.box(0.74, 0.2, 0.7, wall, [0, top + 0.5, 0.05]));
  // Neon round each step of the crown.
  for (const [w, d, y, tube] of [[2.2, 2.0, top + 0.09, pink], [1.48, 1.38, top + 0.41, cyan], [0.8, 0.76, top + 0.61, pink]]) {
    for (const side of [-1, 1]) {
      still.add(kit.box(w + 0.04, 0.035, 0.035, tube, [0, y, 0.05 + side * d / 2]));
      still.add(kit.box(0.035, 0.035, d + 0.04, tube, [side * w / 2, y, 0.05]));
    }
  }
  for (const side of [-1, 1]) {
    still.add(kit.box(0.05, towerH - 0.16, 0.05, pink, [side * 1.055, base + towerH / 2, face + 0.01]));
    still.add(kit.box(0.04, 1.7, 0.04, cyan, [side * 0.9, base + 2.2, face + 0.02]));
  }
  const name = sign(kit, 'ORC FM', { width: 1.62, height: 0.46 });
  name.position.set(0, top - 0.38, face + 0.04);
  still.add(name);

  // The studio window: reels turn behind it, and the levels run above.
  still.add(kit.box(1.5, 0.62, 0.05, chrome, [0, base + 1.66, face + 0.01]));
  still.add(kit.box(1.38, 0.5, 0.05, glass, [0, base + 1.66, face + 0.03]));
  const reels = [-1, 1].map(side => {
    const reel = new Group();
    reel.position.set(side * 0.38, base + 1.66, face + 0.07);
    reel.add(new Mesh(new TorusGeometry(0.18, 0.03, 6, 18), kit.windows));
    for (let i = 0; i < 3; i += 1) {
      const spoke = kit.box(0.33, 0.045, 0.02, chrome);
      spoke.rotation.z = (i / 3) * Math.PI;
      reel.add(spoke);
    }
    group.add(solid(reel));
    return reel;
  });
  still.add(kit.box(1.5, 0.4, 0.04, glass, [0, base + 2.3, face + 0.02]));
  const bars = Array.from({ length: 12 }, (_, i) => {
    const geometry = new PlaneGeometry(0.085, 0.3);
    geometry.translate(0, 0.15, 0);
    const bar = new Mesh(geometry, i % 3 === 0 ? pink : cyan);
    bar.position.set(-0.605 + i * 0.11, base + 2.13, face + 0.045);
    group.add(bar);
    return bar;
  });

  // The tape hatch, under a canopy the car pulls up to.
  still.add(kit.box(1.72, 0.98, 0.08, chrome, [0, base + 0.49, face]));
  still.add(kit.box(1.52, 0.86, 0.1, kit.mat('door', { rough: 0.9 }), [0, base + 0.43, face + 0.01]));
  const doorGeo = new PlaneGeometry(1.5, 0.84);
  doorGeo.translate(0, -0.42, 0);
  const door = new Mesh(doorGeo, tapeDoor(kit));
  door.position.set(0, base + 0.86, face + 0.075);
  group.add(door);
  still.add(kit.box(2.1, 0.07, 0.76, trim, [0, base + 1.07, face + 0.36]));
  still.add(kit.box(2.14, 0.045, 0.045, cyan, [0, base + 1.07, face + 0.75]));
  for (const side of [-1, 1]) {
    still.add(kit.box(0.045, 0.045, 0.76, cyan, [side * 1.06, base + 1.07, face + 0.36]));
    still.add(kit.cylinder(0.035, 0.035, 1.04, chrome, [side * 0.98, base + 0.52, face + 0.68], 8));
  }
  const onAir = sign(kit, 'ON AIR', { width: 0.66, height: 0.17, ink: '#ff5c7a', edge: '#ff5c7a' });
  onAir.position.set(0, base + 1.2, face + 0.75);
  still.add(onAir);
  const ramp = kit.box(1.5, 0.05, 0.62, trim, [0, 0.1, 1.72]);
  ramp.rotation.x = 0.3;
  still.add(ramp);

  // On the roofs: a dish, a vent, and the mast with its light.
  const dish = new Mesh(new ConeGeometry(0.36, 0.17, 18, 1, true), chromeOf(kit, { rough: 0.25, metal: 0.7, doubleSide: true }));
  dish.position.set(-1.62, base + wingH + 0.5, -0.1);
  dish.rotation.set(-1.1, 0.5, 0);
  still.add(dish, kit.cylinder(0.03, 0.04, 0.4, chrome, [-1.62, base + wingH + 0.25, -0.1], 6));
  still.add(kit.box(0.5, 0.26, 0.4, trim, [1.5, base + wingH + 0.2, -0.25]), kit.box(0.42, 0.04, 0.32, cyan, [1.5, base + wingH + 0.35, -0.25]));
  const mast = new Group();
  mast.position.set(0, top + 0.6, 0.05);
  const rigging = new Group();
  rigging.add(kit.cylinder(0.018, 0.07, 1.5, chrome, [0, 0.75, 0], 6));
  for (const [y, w] of [[0.3, 0.34], [0.7, 0.24], [1.1, 0.14]]) rigging.add(kit.box(w, 0.025, 0.025, chrome, [0, y, 0]), kit.box(0.025, 0.025, w, chrome, [0, y, 0]));
  mast.add(bake(rigging));
  const beacon = kit.sphere(0.13, kit.beacon, [0, 1.56, 0], 10);
  mast.add(beacon);
  // Rings that leave the mast as the station sends.
  const signal = [0, 1, 2].map(() => {
    const ring = new Mesh(new TorusGeometry(1, 0.02, 5, 36), kit.basic('accent', { opacity: 0.7, additive: dark }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.5;
    ring.visible = false;
    mast.add(ring);
    return ring;
  });
  group.add(mast);

  const wave = new Mesh(new TorusGeometry(1, 0.03, 5, 40), kit.basic('accent', { opacity: 0.8, additive: true }));
  wave.rotation.x = Math.PI / 2;
  wave.position.set(0, 0.06, 1.2);
  wave.visible = false;
  group.add(wave);
  group.add(bake(still));

  let dropAt = -10;
  let sendAt = -10;
  let clock = 0;
  group.userData = {
    door,
    beacon,
    chimney: new Vector3(1.5, base + wingH + 0.5, -0.25),
    labelY: top + 1.7,
    react(event) {
      if (event === 'delivery') dropAt = clock;
      else sendAt = clock;
    },
    frame(time, dt, main, reducedMotion) {
      clock = time;
      if (reducedMotion) return;
      const playing = main.state === 'working' ? 1 : 0.12;
      const drop = burst(time - dropAt, 1.1);
      const beat = Math.max(0, Math.sin(time * 7.2)) ** 3 * playing + drop * 1.6;
      for (const unit of speakers) {
        unit.cap.position.z = unit.rest + (-0.3 + beat * 0.3) * unit.radius;
        unit.glow.scale.setScalar(1 + beat * 0.16);
      }
      reels.forEach((reel, i) => { reel.rotation.z -= dt * (2.4 + i) * (playing + drop * 3); });
      bars.forEach((bar, i) => {
        bar.scale.y = Math.max(0.08, (0.5 + 0.5 * Math.sin(time * (5 + (i % 5) * 1.3) + i * 1.7)) * playing + drop);
      });
      const sent = time - sendAt;
      signal.forEach((ring, i) => {
        const age = sent - i * 0.22;
        ring.visible = age >= 0 && age < 1.1;
        if (ring.visible) ring.scale.setScalar(0.2 + age * 1.6);
      });
      mast.rotation.z = Math.sin(time * 30) * 0.02 * burst(sent, 0.7);
      const ripple = time - dropAt;
      wave.visible = ripple >= 0 && ripple < 1.1;
      if (wave.visible) wave.scale.setScalar(0.6 + ripple * 3.6);
    },
  };
  return kit.shadows(group);
}

// The hatch's shutter, with the tape in it showing through the glass.
function tapeDoor(kit) {
  return memo(kit, 'tapeDoor', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#120628';
    ctx.fillRect(0, 0, w, h);
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, 'rgba(45,226,230,0.3)');
    sheen.addColorStop(0.5, 'rgba(45,226,230,0.04)');
    sheen.addColorStop(1, 'rgba(255,63,164,0.22)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    const x = w * 0.13;
    const y = h * 0.15;
    const cw = w * 0.74;
    const ch = h * 0.7;
    ctx.fillStyle = '#34186a';
    ctx.fillRect(x, y, cw, ch);
    [['#ffe047', 0.1, 0.1], ['#ff6a3d', 0.2, 0.08], ['#ff2a94', 0.28, 0.08]].forEach(([tone, from, tall]) => {
      ctx.fillStyle = tone;
      ctx.fillRect(x + cw * 0.06, y + ch * from, cw * 0.88, ch * tall);
    });
    ctx.fillStyle = '#0a0420';
    ctx.fillRect(x + cw * 0.2, y + ch * 0.46, cw * 0.6, ch * 0.34);
    ctx.strokeStyle = '#ffe66d';
    ctx.lineWidth = 7;
    for (const at of [0.34, 0.66]) {
      ctx.beginPath();
      ctx.arc(x + cw * at, y + ch * 0.63, ch * 0.105, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ff3fa4';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }, { width: 384, height: 216, emissive: true, glow: 0.75, rough: 0.2, metal: 0.4, doubleSide: true }));
}

// ---------- stations: a building or a kiosk on its own lit lot ----------

function ghost(kit) {
  const group = new Group();
  const tube = kit.basic('accent', { opacity: 0.7 });
  for (const y of [0.04, 0.6, 1.16]) {
    const ring = new Mesh(new TorusGeometry(0.72, 0.02, 5, 6), tube);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }
  group.add(kit.cylinder(0.72, 0.72, 1.12, kit.basic('glow', { opacity: 0.1, additive: kit.mode === 'dark' }), [0, 0.6, 0], 6));
  return group;
}

// The top of a lot: a dance floor of lit tiles, busier under a shop.
function stageTop(kit, kind) {
  return memo(kit, 'stageTop:' + kind, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = kit.mode === 'dark' ? '#0a0320' : '#2c0f52';
    ctx.fillRect(0, 0, w, h);
    const tones = kind === 'worker' ? ['#ff3fa4', '#2de2e6', '#b42dff', '#ffe66d'] : ['#2de2e6', '#b42dff'];
    const cells = kind === 'worker' ? 6 : 5;
    const size = w / cells;
    for (let x = 0; x < cells; x += 1) {
      for (let y = 0; y < cells; y += 1) {
        ctx.globalAlpha = 0.14 + seeded(x * 3 + y * 5 + cells) * 0.5;
        ctx.fillStyle = tones[Math.floor(seeded(x * 7 + y * 13 + cells) * tones.length)];
        ctx.fillRect(x * size + 3, y * size + 3, size - 6, size - 6);
      }
    }
    ctx.globalAlpha = 1;
  }, { width: 256, height: 256, emissive: true, glow: 0.8, rough: 0.25, metal: 0.3 }));
}

// A flat outline lying at height `y`, its texture laid over the lot's whole rectangle.
function plate(outline, [width, depth], y) {
  const geometry = new ShapeGeometry(outlineShape(outline));
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i += 1) uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / depth + 0.5);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

// A paved lot with lit tiles, cut back from the roads round it; its kerb and
// its lamp show the agent's state. `lampAt` is laid out as for a lot right of
// the avenue, and mirrored on the left. Still parts go into `still`.
function lot(kit, kind, spot, still, lampAt) {
  const group = new Group();
  const size = LOT[kind];
  const flip = handed(spot);
  const outline = lotOutline(kind, spot);
  const at = [lampAt[0] * flip, lampAt[1], lampAt[2]];
  const lamp = kit.sphere(0.11, kit.lamp(), at, 10);
  group.add(kit.shadow(size[0] + 0.9, size[1] + 0.9, 0.34));
  group.add(kit.halo(kind === 'worker' ? 'roof' : 'accent', size[0] + 1.5, size[1] + 1.5, { opacity: kit.mode === 'dark' ? 0.22 : 0.1, at: [0, 0.008, 0] }));
  const slab = new ExtrudeGeometry(outlineShape(outline), { depth: 0.1, bevelEnabled: false });
  slab.rotateX(-Math.PI / 2);
  still.add(new Mesh(slab, kit.mat('trim', { rough: 0.5, metal: 0.3 })));
  still.add(new Mesh(plate(inset(outline, 0.07), size, 0.104), stageTop(kit, kind)));
  const kerb = inset(outline, 0.02);
  kerb.forEach((point, i) => still.add(edgeStrip(kit, point, kerb[(i + 1) % kerb.length], 0.04, 0.035, 0.118, lamp.material)));
  still.add(kit.cylinder(0.02, 0.03, at[1] - 0.1, chromeOf(kit), [at[0], at[1] / 2 + 0.05, at[2]], 6));
  group.add(lamp);
  // Rays that shoot out once when the job lands.
  const rays = new Group();
  rays.position.y = 0.2;
  for (let i = 0; i < 8; i += 1) {
    const ray = kit.box(0.05, 0.03, 0.5, neon(kit, i % 2 ? 'accent' : 'window', 1.8), [0, 0, size[0] / 2 + 0.3]);
    ray.position.applyAxisAngle(new Vector3(0, 1, 0), (i / 8) * TAU);
    ray.rotation.y = (i / 8) * TAU;
    rays.add(ray);
  }
  rays.visible = false;
  // Light, not a body: a car may drive through it.
  rays.userData.light = true;
  group.add(solid(rays));
  return { group, lamp, rays, top: 0.12, flip, spot };
}

// A hovering chrome robot in a visor: the shop's keeper.
function bot(kit, tint) {
  const chrome = chromeOf(kit);
  const root = new Group();
  const body = new Group();
  body.add(kit.box(0.26, 0.3, 0.18, kit.mat('trim', { rough: 0.4, metal: 0.4 }), [0, 0.36, 0]));
  body.add(kit.box(0.14, 0.08, 0.02, neon(kit, tint, 1.5), [0, 0.4, 0.095]));
  const jet = new Mesh(new ConeGeometry(0.1, 0.2, 8), neon(kit, tint, 1.3));
  jet.rotation.x = Math.PI;
  jet.position.y = 0.11;
  body.add(jet);
  root.add(bake(body));
  const head = new Group();
  head.position.y = 0.64;
  head.add(kit.box(0.24, 0.2, 0.2, chrome, [0, 0, 0]));
  head.add(kit.box(0.26, 0.07, 0.03, neon(kit, 'accent', 1.8), [0, 0.01, 0.1]));
  head.add(kit.cylinder(0.012, 0.012, 0.12, chrome, [0.07, 0.16, 0], 4));
  root.add(solid(head));
  const arms = [-1, 1].map(side => {
    const pivot = new Group();
    pivot.position.set(side * 0.17, 0.47, 0);
    pivot.add(kit.box(0.06, 0.24, 0.06, chrome, [0, -0.11, 0]));
    pivot.add(kit.sphere(0.045, neon(kit, tint, 1.2), [0, -0.25, 0], 6));
    root.add(solid(pivot));
    return pivot;
  });
  return { root, head, arms };
}

// Wires a built station to the engine. `occupants` are the keepers that leave
// a decommissioned shop. With Reduce animations on, everything holds still.
function stage(kit, base, { labelY, puff, run, occupants = [] }) {
  const { group, lamp, rays, spot } = base;
  const seed = seeded((spot?.slot ?? 0) * 7 + 3) * 6;
  group.userData = {
    lamp,
    occupants,
    puff,
    labelY,
    frame(time, dt, station) {
      const still = kit.reducedMotion;
      const failed = station.state === 'failed';
      const finished = station.state === 'done';
      const flash = finished && !still ? burst(time - station.doneAt, 1.2) : 0;
      rays.visible = flash > 0.01;
      if (rays.visible) {
        rays.scale.setScalar(0.5 + (1 - flash) * 1.2);
        rays.rotation.y = time * 2;
      }
      // The engine eases a station's activity down even with Reduce
      // animations on, so a still floor reads it as nothing at all.
      run(still ? seed : time + seed, still ? 0 : station.activity, {
        failed, finished, dt: still ? 0 : dt, flicker: !still && failed && Math.sin(time * 23) * Math.sin(time * 7.3) > 0.2,
      });
    },
  };
  return kit.shadows(group);
}

// A failed keeper slumps back against its shop, away from the drive.
function pose(player, t, active, { failed, finished }, play) {
  player.root.rotation.x = failed ? -0.35 : 0;
  player.root.position.y = player.rest + (failed ? -0.12 : Math.sin(t * 3.2) * 0.04 + (finished ? 0.08 : 0));
  player.head.rotation.z = Math.sin(t * 6.2) * 0.2 * active;
  if (finished) {
    player.arms[0].rotation.set(0, 0, -2.4);
    player.arms[1].rotation.set(0, 0, 2.4);
  } else if (failed) {
    player.arms[0].rotation.set(0.2, 0, 0);
    player.arms[1].rotation.set(0.2, 0, 0);
  } else play();
}

function arcadeScreen(kit) {
  return memo(kit, 'arcadeScreen', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#0a0420';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff3fa4';
    for (let i = 0; i < 6; i += 1) ctx.fillRect(8 + i * 9, 8 + (i % 2) * 6, 6, 6);
    ctx.fillStyle = '#2de2e6';
    ctx.fillRect(26, 48, 12, 6);
    ctx.fillRect(30, 44, 4, 4);
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(31, 30, 2, 8);
  }, { width: 64, height: 64, nearest: true, emissive: true, glow: 1.1, rough: 0.2 }));
}

// Awning cloth in two inks.
function stripes(kit, tone) {
  return memo(kit, 'stripes:' + tone, () => kit.painted((ctx, w, h) => {
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 ? '#fff6fb' : '#' + kit.color(tone).getHexString();
      ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  }, { width: 128, height: 32, rough: 0.7, emissive: true, glow: 0.25 }));
}

// Warm light behind a pane.
const lit = kit => kit.mat('#2a1450', { rough: 0.2, metal: 0.3, emissive: 'window', glow: kit.mode === 'dark' ? 1.1 : 0.45 });

// Where a shop's building stands on its lot, laid out as right of the avenue:
// in the middle of the block the roads leave, with its keeper in front of its
// door and its lamp on the corner nearest the camera.
const SHOP = { x: 0.1, z: -0.18, w: 1.2, d: 0.76 };
const KEEPER = [0.4, 0.45];
const SHOP_LAMP = [0.78, 0.86, 0.36];
// A kiosk stands a little right of the middle of its lot, back from the drive.
const KIOSK = [0.15, -0.15];
const KIOSK_LAMP = [0.56, 0.74, 0.5];

// The body of a shop: walls, a cornice and a tube of neon round the roofline.
function shell(kit, still, flip, { wall, top, tube = 'roof', h }) {
  const { w, d } = SHOP;
  const x = SHOP.x * flip;
  const z = SHOP.z;
  still.add(kit.box(w, h, d, wall, [x, top + h / 2, z]));
  still.add(kit.box(w + 0.08, 0.06, d + 0.08, kit.mat(INK[kit.mode].roofTop, { rough: 0.7, metal: 0.03 }), [x, top + h + 0.03, z]));
  const glow = neon(kit, tube, 1.6);
  for (const side of [-1, 1]) {
    still.add(kit.box(w + 0.12, 0.04, 0.04, glow, [x, top + h + 0.06, z + side * (d / 2 + 0.04)]));
    still.add(kit.box(0.04, 0.04, d + 0.12, glow, [x + side * (w / 2 + 0.04), top + h + 0.06, z]));
  }
  return { x, front: z + d / 2, roof: top + h + 0.06 };
}

// A robot keeps each shop, in front of its door.
function keeper(kit, group, flip, tint, top) {
  const player = bot(kit, tint);
  player.root.scale.setScalar(1.15);
  player.rest = top + 0.14;
  player.root.position.set(KEEPER[0] * flip, player.rest, KEEPER[1]);
  group.add(player.root);
  return player;
}

function arcade(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'worker', spot, still, SHOP_LAMP);
  const { group, top, flip } = base;
  const { x, front, roof } = shell(kit, still, flip, { wall: kit.mat(INK[kit.mode].walls[0], { rough: 0.66 }), top, tube: 'accent', h: 0.92 });
  // The window is a game on a cabinet's screen, with the door on the keeper's side.
  const screen = kit.box(0.7, 0.42, 0.03, arcadeScreen(kit), [x - 0.22 * flip, top + 0.5, front + 0.012]);
  group.add(screen);
  still.add(kit.box(0.28, 0.58, 0.03, kit.mat('door', { rough: 0.5 }), [x + 0.38 * flip, top + 0.29, front + 0.012]));
  still.add(kit.box(0.32, 0.03, 0.04, neon(kit, 'roof', 1.5), [x + 0.38 * flip, top + 0.6, front + 0.02]));
  const awning = kit.box(0.76, 0.03, 0.3, stripes(kit, 'roof'), [x - 0.22 * flip, top + 0.8, front + 0.13]);
  awning.rotation.x = 0.36;
  still.add(awning);
  const board = solid(roofSign(kit, spot, 'ARCADE', [x, roof, SHOP.z], { width: 1.18, height: 0.32 }));
  // Six bulbs over the sign, chasing in threes: every third one is a set.
  const bulbs = [0, 1, 2].map(set => {
    const three = new Group();
    for (const i of [set, set + 3]) three.add(kit.sphere(0.04, neon(kit, 'window', 1.9), [-0.5 + i * 0.2, 0.56, 0], 6));
    const lit = bake(three).children[0];
    board.add(lit);
    return lit;
  });
  group.add(board);
  const player = keeper(kit, group, flip, 'accent', top);
  player.root.rotation.y = Math.PI;
  group.add(bake(still));
  return stage(kit, base, {
    labelY: 2.35, puff: new Vector3(x, 1.5, SHOP.z), occupants: [player.root],
    run(t, active, state) {
      screen.visible = !state.failed || state.flicker;
      board.visible = !state.failed || state.flicker;
      const lead = Math.floor(t * 6) % bulbs.length;
      bulbs.forEach((set, i) => { set.visible = state.finished || (active > 0.05 ? (i + lead) % 3 !== 0 : i !== 1); });
      pose(player, t, active, state, () => {
        player.arms[0].rotation.set(-1.1, 0, Math.sin(t * 9) * 0.3 * active);
        player.arms[1].rotation.set(-1.1 + Math.abs(Math.sin(t * 15)) * 0.3 * active, 0, 0);
      });
    },
  });
}

function diner(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'worker', spot, still, SHOP_LAMP);
  const { group, top, flip } = base;
  const chrome = chromeOf(kit, { rough: 0.22, metal: 0.75 });
  const roofPaint = kit.mat('roof', { rough: 0.35, metal: 0.3 });
  const pink = neon(kit, 'roof', 1.6);
  const x = SHOP.x * flip;
  const z = SHOP.z;
  // A chrome dining car: a long body with a rounded end each side, as long as
  // a shop is wide.
  const body = 0.62;
  const end = 0.29;
  still.add(kit.box(body, 0.62, end * 2, chrome, [x, top + 0.31, z]));
  for (const side of [-1, 1]) {
    still.add(kit.cylinder(end, end, 0.62, chrome, [x + side * body / 2, top + 0.31, z], 16));
    still.add(kit.cylinder(end + 0.03, end + 0.03, 0.08, roofPaint, [x + side * body / 2, top + 0.66, z], 16));
    still.add(kit.cylinder(end + 0.005, end + 0.005, 0.05, pink, [x + side * body / 2, top + 0.2, z], 16));
  }
  still.add(kit.box(body, 0.08, end * 2 + 0.06, roofPaint, [x, top + 0.66, z]));
  still.add(kit.box(body, 0.05, end * 2 + 0.01, pink, [x, top + 0.2, z]));
  const panes = kit.box(0.42, 0.2, 0.03, lit(kit), [x - 0.1 * flip, top + 0.43, z + end]);
  group.add(panes);
  still.add(kit.box(0.16, 0.48, 0.03, kit.mat('door', { rough: 0.5 }), [x + 0.23 * flip, top + 0.26, z + end + 0.004]));
  still.add(kit.cylinder(0.05, 0.06, 0.2, chrome, [x - 0.4 * flip, top + 0.8, z - 0.1], 8));
  const board = solid(roofSign(kit, spot, 'DINER', [x, top + 0.7, z], { width: 1.06, height: 0.32, ink: '#ffe66d', edge: '#ff3fa4' }));
  group.add(board);
  const player = keeper(kit, group, flip, 'roof', top);
  group.add(bake(still));
  return stage(kit, base, {
    labelY: 2.1, puff: new Vector3(x - 0.4 * flip, 1.2, z - 0.1), occupants: [player.root],
    run(t, active, state) {
      panes.visible = !state.failed || state.flicker;
      board.visible = state.failed ? state.flicker : state.finished || active < 0.05 || Math.floor(t * 2.5) % 4 !== 0;
      pose(player, t, active, state, () => {
        player.arms[0].rotation.set(-1.25 + Math.sin(t * 6) * 0.2 * active, 0, 0.2);
        player.arms[1].rotation.set(-0.5, 0, -0.5 + Math.sin(t * 4) * 0.35 * active);
      });
    },
  });
}

function recordShop(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'worker', spot, still, SHOP_LAMP);
  const { group, top, flip } = base;
  const { x, front, roof } = shell(kit, still, flip, { wall: kit.mat(INK[kit.mode].walls[1], { rough: 0.66 }), top, h: 0.86 });
  // The window is a wall of record sleeves.
  const sleeves = memo(kit, 'sleeves', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#120628';
    ctx.fillRect(0, 0, w, h);
    const tones = ['#ff3fa4', '#2de2e6', '#ffe66d', '#b42dff', '#ff9d4f', '#6dfacb'];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        ctx.fillStyle = tones[(i * 2 + j * 3) % tones.length];
        ctx.fillRect(8 + i * 30, 6 + j * 28, 24, 24);
        ctx.fillStyle = '#120628';
        ctx.beginPath();
        ctx.arc(20 + i * 30, 18 + j * 28, 7, 0, TAU);
        ctx.fill();
      }
    }
  }, { width: 128, height: 64, emissive: true, glow: 0.9, rough: 0.3 }));
  const display = kit.box(0.72, 0.38, 0.03, sleeves, [x - 0.2 * flip, top + 0.46, front + 0.012]);
  group.add(display);
  still.add(kit.box(0.26, 0.56, 0.03, kit.mat('door', { rough: 0.5 }), [x + 0.4 * flip, top + 0.28, front + 0.012]));
  const awning = kit.box(0.76, 0.03, 0.28, stripes(kit, 'accent'), [x - 0.2 * flip, top + 0.74, front + 0.12]);
  awning.rotation.x = 0.36;
  still.add(awning);
  // The sign is a record the size of the shop, turning on the roof.
  const grooves = memo(kit, 'grooves', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#0a0420';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(180,45,255,0.5)';
    for (let r = 46; r < 120; r += 9) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(45,226,230,0.5)';
    for (const turn of [0.4, 3.5]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, 124, turn, turn + 0.42);
      ctx.fill();
    }
    ctx.fillStyle = '#ff3fa4';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 40, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffe66d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 9, 0, TAU);
    ctx.fill();
  }, { width: 256, height: 256, emissive: true, glow: 0.8, rough: 0.25, metal: 0.3 }));
  const mount = new Group();
  mount.position.set(x, roof + 0.62, SHOP.z);
  mount.rotation.y = facing(spot);
  const spindle = new Group();
  const disc = kit.cylinder(0.56, 0.56, 0.05, grooves, [0, 0, 0], 28);
  disc.rotation.x = Math.PI / 2;
  spindle.add(disc);
  mount.add(spindle, bake(new Group().add(kit.cylinder(0.03, 0.03, 0.62, chromeOf(kit), [0, -0.5, -0.06], 6))));
  group.add(mount);
  const player = keeper(kit, group, flip, 'window', top);
  group.add(bake(still));
  return stage(kit, base, {
    labelY: 2.75, puff: new Vector3(x, 1.4, SHOP.z), occupants: [player.root],
    run(t, active, state) {
      display.visible = !state.failed || state.flicker;
      spindle.rotation.z -= state.dt * (0.4 + 3 * active) * (state.failed ? 0 : 1);
      mount.rotation.z = state.failed ? 0.3 : 0;
      pose(player, t, active, state, () => {
        player.arms[0].rotation.set(-1.0, 0, 0.4 + Math.sin(t * 5) * 0.25 * active);
        player.arms[1].rotation.set(-2.4 + Math.sin(t * 7) * 0.3 * active, 0, -0.2);
      });
    },
  });
}

// A kiosk's own group, where kiosks stand on the lot, turned to the camera.
function kioskAt(spot, flip, top, turned = true) {
  const group = new Group();
  group.position.set(KIOSK[0] * flip, top, KIOSK[1]);
  if (turned) group.rotation.y = facing(spot);
  return group;
}

function phoneBooth(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'subagent', spot, still, KIOSK_LAMP);
  const { group, top, flip } = base;
  const chrome = chromeOf(kit);
  const booth = kioskAt(spot, flip, top);
  for (const x of [-0.27, 0.27]) for (const z of [-0.27, 0.27]) booth.add(kit.cylinder(0.025, 0.025, 1.16, chrome, [x, 0.58, z], 6));
  booth.add(kit.box(0.64, 0.2, 0.64, kit.mat('trim', { rough: 0.4, metal: 0.4 }), [0, 1.2, 0]));
  const header = sign(kit, 'PHONE', { width: 0.58, height: 0.15, ink: '#2de2e6', edge: '#ff3fa4' });
  header.position.set(0, 1.2, 0.33);
  booth.add(header, kit.box(0.2, 0.3, 0.08, kit.mat('door', { rough: 0.5 }), [0, 0.62, -0.18]));
  solid(booth);
  // The glass stays a mesh of its own, so it sorts behind the frame.
  booth.add(kit.box(0.5, 1.02, 0.5, kit.mat('accent', { rough: 0.1, metal: 0.2, opacity: 0.3, emissive: 'accent', glow: 0.55 }), [0, 0.56, 0]));
  const ring = kit.sphere(0.07, neon(kit, 'window', 1.9), [0, 1.0, 0], 8);
  booth.add(ring);
  group.add(booth, bake(still));
  return stage(kit, base, {
    labelY: 2.0, puff: new Vector3(KIOSK[0] * flip, 1.5, KIOSK[1]),
    run(t, active, state) {
      ring.visible = state.failed ? state.flicker : state.finished || Math.floor(t * 5) % 2 === 0 || active < 0.05;
      ring.scale.setScalar(1 + 0.35 * active * Math.abs(Math.sin(t * 9)));
      booth.rotation.z = state.failed ? 0.16 : 0;
    },
  });
}

function jukebox(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'subagent', spot, still, KIOSK_LAMP);
  const { group, top, flip } = base;
  const juke = kioskAt(spot, flip, top);
  const wood = kit.mat('trim', { rough: 0.4, metal: 0.4 });
  juke.add(kit.box(0.78, 0.66, 0.44, wood, [0, 0.33, 0]));
  const crown = kit.cylinder(0.39, 0.39, 0.44, wood, [0, 0.66, 0], 18);
  crown.rotation.x = Math.PI / 2;
  juke.add(crown);
  const radii = [['roof', 0.37], ['window', 0.31], ['accent', 0.25]];
  for (const [tone, radius] of radii) for (const side of [-1, 1]) juke.add(kit.box(0.046, 0.5, 0.03, neon(kit, tone, 1.9), [side * radius, 0.4, 0.225]));
  juke.add(kit.box(0.4, 0.2, 0.03, lit(kit), [0, 0.62, 0.225]), kit.box(0.44, 0.18, 0.03, chromeOf(kit, { rough: 0.25, metal: 0.7 }), [0, 0.2, 0.225]));
  const platter = kit.cylinder(0.11, 0.11, 0.02, kit.mat('#0a0420', { rough: 0.3 }), [0, 0.62, 0.25], 14);
  platter.rotation.x = Math.PI / 2;
  juke.add(platter);
  solid(juke);
  // The arches of neon over the front light in turn.
  const tubes = radii.map(([tone, radius]) => {
    const arc = new Mesh(new TorusGeometry(radius, 0.024, 6, 18, Math.PI), neon(kit, tone, 1.9));
    arc.position.set(0, 0.66, 0.225);
    juke.add(arc);
    return arc;
  });
  group.add(juke, bake(still));
  return stage(kit, base, {
    labelY: 1.9, puff: new Vector3(KIOSK[0] * flip, 1.3, KIOSK[1]),
    run(t, active, state) {
      const on = Math.floor(t * 4) % 3;
      tubes.forEach((tube, i) => { tube.visible = state.failed ? state.flicker && i === 0 : state.finished || active < 0.05 || i !== on; });
      juke.rotation.z = state.failed ? -0.18 : Math.sin(t * 8) * 0.025 * active;
    },
  });
}

function billboard(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'subagent', spot, still, KIOSK_LAMP);
  const { group, top, flip } = base;
  const chrome = chromeOf(kit);
  const picture = memo(kit, 'flamingo', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#120628';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const tube = (style, width, draw) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.shadowColor = style;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      draw();
      ctx.stroke();
    };
    // a low sun in bands
    for (let i = 0; i < 4; i += 1) tube('#ffe66d', 4, () => { ctx.arc(w * 0.74, h * 0.82, 16 + i * 11, Math.PI, TAU); });
    // a palm
    tube('#2de2e6', 5, () => { ctx.moveTo(w * 0.2, h * 0.9); ctx.quadraticCurveTo(w * 0.17, h * 0.55, w * 0.25, h * 0.28); });
    for (const [dx, dy] of [[-0.14, 0.02], [-0.1, -0.12], [0.02, -0.16], [0.13, -0.08], [0.15, 0.06]]) {
      tube('#2de2e6', 4, () => { ctx.moveTo(w * 0.25, h * 0.28); ctx.quadraticCurveTo(w * (0.25 + dx * 0.6), h * (0.28 + dy - 0.06), w * (0.25 + dx), h * (0.28 + dy + 0.1)); });
    }
    // a flamingo
    tube('#ff3fa4', 6, () => { ctx.ellipse(w * 0.5, h * 0.5, 26, 17, -0.2, 0, TAU); });
    tube('#ff3fa4', 6, () => { ctx.moveTo(w * 0.57, h * 0.42); ctx.bezierCurveTo(w * 0.68, h * 0.34, w * 0.52, h * 0.2, w * 0.63, h * 0.13); ctx.lineTo(w * 0.69, h * 0.17); });
    tube('#ff3fa4', 5, () => { ctx.moveTo(w * 0.5, h * 0.64); ctx.lineTo(w * 0.5, h * 0.9); ctx.moveTo(w * 0.46, h * 0.64); ctx.lineTo(w * 0.42, h * 0.78); ctx.lineTo(w * 0.47, h * 0.9); });
  }, { width: 256, height: 160, emissive: true, glow: 1.1, rough: 0.3 }));
  const board = kioskAt(spot, flip, top);
  for (const side of [-1, 1]) board.add(kit.cylinder(0.03, 0.04, 0.95, chrome, [side * 0.42, 0.47, -0.04], 6));
  board.add(kit.box(1.24, 0.78, 0.06, kit.mat('trim', { rough: 0.4, metal: 0.4 }), [0, 1.2, -0.04]));
  solid(board);
  const face = new Mesh(new PlaneGeometry(1.14, 0.68), picture);
  face.position.set(0, 1.2, 0);
  board.add(face);
  const edge = [0, 1].map(i => {
    const set = new Group();
    const glow = neon(kit, i ? 'accent' : 'roof', 1.8);
    set.add(kit.box(1.24, 0.03, 0.03, glow, [0, 1.2 + (i ? 0.39 : -0.39), 0.01]), kit.box(0.03, 0.78, 0.03, glow, [i ? 0.62 : -0.62, 1.2, 0.01]));
    board.add(solid(set));
    return set;
  });
  group.add(board, bake(still));
  return stage(kit, base, {
    labelY: 2.5, puff: new Vector3(KIOSK[0] * flip, 1.7, KIOSK[1]),
    run(t, active, state) {
      face.visible = !state.failed || state.flicker;
      const turn = Math.floor(t * 3) % 2;
      edge.forEach((set, i) => { set.visible = state.failed ? false : state.finished || active < 0.05 || i === turn; });
      board.rotation.z = state.failed ? 0.2 : 0;
    },
  });
}

function iceStand(kit, spot) {
  const still = new Group();
  const base = lot(kit, 'subagent', spot, still, KIOSK_LAMP);
  const { group, top, flip } = base;
  const kiosk = kioskAt(spot, flip, top, false);
  kiosk.add(kit.cylinder(0.42, 0.42, 0.62, kit.mat(INK[kit.mode].walls[2], { rough: 0.66 }), [0, 0.31, 0], 10));
  kiosk.add(kit.cylinder(0.435, 0.435, 0.05, neon(kit, 'roof', 1.6), [0, 0.2, 0], 10));
  const canopy = new Mesh(new ConeGeometry(0.62, 0.34, 10), memo(kit, 'canopy', () => kit.painted((ctx, w, h) => {
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = i % 2 ? '#fff6fb' : '#ff3fa4';
      ctx.fillRect((i * w) / 10, 0, w / 10 + 1, h);
    }
  }, { width: 160, height: 16, rough: 0.7, emissive: true, glow: 0.3 })));
  canopy.position.y = 0.8;
  kiosk.add(canopy);
  solid(kiosk);
  const hatch = kit.cylinder(0.43, 0.43, 0.2, lit(kit), [0, 0.42, 0], 10);
  kiosk.add(hatch);
  // The sign is a cone taller than the stand.
  const treat = new Group();
  treat.position.y = 1.0;
  const wafer = new Mesh(new ConeGeometry(0.15, 0.4, 10), kit.mat('#f0b25c', { rough: 0.7 }));
  wafer.rotation.x = Math.PI;
  wafer.position.y = 0.2;
  treat.add(wafer, kit.sphere(0.18, kit.mat('#ff8fc6', { rough: 0.5, emissive: '#ff3fa4', glow: 0.35 }), [0, 0.46, 0], 10));
  treat.add(kit.sphere(0.14, kit.mat('#9af0e6', { rough: 0.5, emissive: '#2de2e6', glow: 0.35 }), [0.02, 0.68, 0], 10), kit.sphere(0.05, neon(kit, 'fail', 1.4), [0.03, 0.83, 0], 6));
  kiosk.add(solid(treat));
  group.add(kiosk, bake(still));
  return stage(kit, base, {
    labelY: 2.3, puff: new Vector3(KIOSK[0] * flip, 1.7, KIOSK[1]),
    run(t, active, state) {
      hatch.visible = !state.failed || state.flicker;
      treat.rotation.y += state.dt * (0.4 + 1.6 * active);
      treat.rotation.z = state.failed ? 0.9 : 0;
      treat.position.y = state.failed ? 0.86 : 1.0 + Math.sin(t * 2.4) * 0.03 + (state.finished ? 0.05 : 0);
    },
  });
}

const SHOPS = [arcade, diner, recordShop];
const KIOSKS = [phoneBooth, jukebox, billboard, iceStand];

function station(kit, kind, spot = { index: 0 }) {
  const cast = kind === 'worker' ? SHOPS : KIOSKS;
  return cast[(spot.index || 0) % cast.length](kit, spot);
}

// ---------- a decommissioned lot: the stock cordon, laid along the cut lot ----------

// Tape whose stripes keep one pitch however long it runs.
function tapeGeometry(length, height = 0.075) {
  const geometry = new BoxGeometry(length, height, 0.012);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * length / 0.22);
  return geometry;
}

// The stock cordon's own tape, plaque, posts, weeds and rubble (ui/yeet/factory.js).
function cordonLooks(kit) {
  return memo(kit, 'cordon', () => ({
    tape: kit.painted((ctx, w, h) => {
      ctx.fillStyle = '#' + kit.color('busy').getHexString();
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#' + kit.blend(kit.color('door'), kit.color('trim'), 0.3).getHexString();
      for (let x = -h; x < w; x += h) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h / 2, h);
        ctx.lineTo(x + h, 0);
        ctx.lineTo(x + h / 2, 0);
        ctx.fill();
      }
    }, { width: 64, height: 32, repeat: [1, 1], rough: 0.55, metal: 0.05, doubleSide: true }),
    plaque: kit.painted((ctx, w, h) => {
      ctx.fillStyle = '#' + kit.blend(kit.color('crate'), kit.color('#f6f1e4'), 0.7).getHexString();
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#' + kit.color('fail').getHexString();
      ctx.lineWidth = 10;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.fillStyle = '#' + kit.color('fail').getHexString();
      ctx.font = '800 66px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSED', w / 2, h / 2 + 3);
    }, { width: 288, height: 128, rough: 0.8, metal: 0, doubleSide: true }),
    post: kit.mat('trim', { rough: 0.6, metal: 0.3 }),
    moss: kit.mat('moss', { rough: 0.92, doubleSide: true }),
    rubble: kit.mat('dust', { rough: 0.95, flat: true }),
  }));
}

// A decommissioned lot keeps the stock cordon: tape on posts with one end
// snapped and stirring, a CLOSED plaque, rubble and weeds that grow the
// longer it stands (`station.weathered`). It runs round the lot's own cut
// outline, not a square, so the cars that pass the lot still pass it.
function ruin(kit, kind, spot = { slot: 0 }) {
  const group = new Group();
  const looks = cordonLooks(kit);
  const outline = inset(lotOutline(kind, spot), 0.04);
  const count = outline.length;
  const height = 0.47;
  const seed = (spot.slot ?? 0) + 1;
  const rand = salt => seeded(seed * 91.7 + salt * 37.3);
  // The tape is snapped along the edge nearest the camera, where the plaque
  // hangs: the one furthest towards +z once the station is turned.
  const { yaw } = slotOf(spot);
  const towardCamera = ([x, z]) => -x * Math.sin(yaw) + z * Math.cos(yaw);
  const middle = i => {
    const [a, b] = [outline[i], outline[(i + 1) % count]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  let snapped = 0;
  outline.forEach((_, i) => { if (towardCamera(middle(i)) > towardCamera(middle(snapped))) snapped = i; });
  const posts = new Group();
  const tape = new Group();
  outline.forEach((point, i) => {
    posts.add(kit.box(0.07, 0.6, 0.07, looks.post, [point[0], 0.3, point[1]]), kit.box(0.1, 0.05, 0.1, looks.post, [point[0], 0.62, point[1]]));
    const next = outline[(i + 1) % count];
    if (i !== snapped) {
      tape.add(along(new Mesh(tapeGeometry(Math.hypot(next[0] - point[0], next[1] - point[1])), looks.tape), point, next, height - (i % 2) * 0.02));
    }
  });
  const postMesh = kit.shadows(bake(posts));
  const tapeMesh = bake(tape);
  postMesh.name = 'posts';
  tapeMesh.name = 'tape';
  group.add(postMesh, tapeMesh);
  // The snapped edge: a stub with the plaque from one post, a loose end hanging from the other.
  const a = outline[snapped];
  const b = outline[(snapped + 1) % count];
  const stubEnd = [b[0] + (a[0] - b[0]) * 0.55, b[1] + (a[1] - b[1]) * 0.55];
  const stub = along(new Mesh(tapeGeometry(Math.hypot(stubEnd[0] - b[0], stubEnd[1] - b[1])), looks.tape), b, stubEnd, height);
  stub.name = 'stub';
  group.add(stub);
  const plaque = along(new Mesh(new PlaneGeometry(0.36, 0.16), looks.plaque), b, stubEnd, height - 0.12);
  plaque.name = 'plaque';
  plaque.rotation.z = (seed % 2 ? 1 : -1) * 0.09;
  // On the side of the stub away from the lot's middle.
  const outward = [(b[1] - a[1]), -(b[0] - a[0])];
  const length = Math.hypot(...outward) || 1;
  plaque.position.x += (outward[0] / length) * 0.02;
  plaque.position.z += (outward[1] / length) * 0.02;
  group.add(plaque);
  const flap = new Group();
  flap.name = 'flap';
  along(flap, a, b, height);
  flap.position.set(a[0], height, a[1]);
  const loose = new Mesh(tapeGeometry(0.4), looks.tape);
  loose.position.x = 0.2;
  flap.add(loose);
  const turn = flap.rotation.y;
  flap.rotation.z = -1.08;
  group.add(flap);
  // Rubble by the posts, and weeds round them and halfway along each edge.
  const rubble = new Group();
  for (let i = 0; i < 3; i += 1) {
    const size = 0.07 + rand(i) * 0.06;
    const [px, pz] = outline[Math.floor(rand(i + 5) * count) % count];
    const piece = kit.box(size, size * 0.7, size * 1.2, looks.rubble, [px * 0.8, size * 0.3, pz * 0.8]);
    piece.rotation.set(rand(i + 1), rand(i + 2) * 3, rand(i + 4) * 0.6);
    rubble.add(piece);
  }
  const rubbled = bake(rubble);
  rubbled.name = 'rubble';
  group.add(rubbled);
  // Tufts far enough inside the cordon that their splayed blades stay on the lot.
  const rooted = inset(outline, 0.2);
  const tufts = new Group();
  rooted.forEach((point, i) => {
    const next = rooted[(i + 1) % rooted.length];
    for (const [x, z, size] of [[point[0], point[1], 0.4 + rand(i + 11) * 0.15], [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2, 0.28 + rand(i + 17) * 0.12]]) {
      for (let blade = 0; blade < 3; blade += 1) {
        const leaf = new Mesh(new ConeGeometry(0.035, size, 3), looks.moss);
        leaf.geometry.translate(0, size / 2, 0);
        leaf.position.set(x, 0, z);
        leaf.rotation.set(Math.sin(blade * 2.1 + i) * 0.3, blade * 2.1, Math.cos(blade * 2.1 + i) * 0.3);
        tufts.add(leaf);
      }
    }
  });
  const weeds = bake(tufts);
  weeds.name = 'weeds';
  weeds.scale.set(0.5, 0.001, 0.5);
  group.add(weeds);
  group.userData.frame = (time, dt, station) => {
    const grown = Math.min(1, Math.max(0, station.weathered ?? 0));
    const spread = 0.5 + grown * 0.5;
    weeds.scale.set(spread, Math.max(0.001, 0.12 + grown * 0.88), spread);
    if (kit.reducedMotion) return;
    flap.rotation.z = -1.08 + Math.sin(time * 2.2 + seed) * 0.07;
    flap.rotation.y = turn + Math.sin(time * 1.4 + seed * 2) * 0.22;
  };
  return group;
}

function crate(kit) {
  const group = new Group();
  const labelMat = memo(kit, 'tapeLabel', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#ffe047';
    ctx.fillRect(0, 0, w, h * 0.36);
    ctx.fillStyle = '#ff6a3d';
    ctx.fillRect(0, h * 0.36, w, h * 0.28);
    ctx.fillStyle = '#ff2a94';
    ctx.fillRect(0, h * 0.64, w, h * 0.36);
    ctx.fillStyle = '#120428';
    ctx.fillRect(18, h * 0.32, w - 36, h * 0.38);
  }, { width: 128, height: 64, emissive: true, glow: 0.75, rough: 0.3 }));

  group.add(kit.box(0.54, 0.35, 0.24, kit.mat('crate', { rough: 0.34, metal: 0.4 })));
  for (const z of [-0.125, 0.125]) {
    group.add(kit.box(0.45, 0.2, 0.012, labelMat, [0, 0.03, z]));
    for (const x of [-0.11, 0.11]) {
      const reel = kit.cylinder(0.048, 0.048, 0.022, chromeOf(kit, { rough: 0.25, metal: 0.6 }), [x, 0.03, z * 1.07], 10);
      reel.rotation.x = Math.PI / 2;
      group.add(reel);
    }
  }
  group.add(kit.box(0.56, 0.045, 0.26, neon(kit, 'accent', 1.3), [0, -0.155, 0]));
  return kit.shadows(solid(group));
}

// The car that brings each tape home: a low wedge with the cassette on its
// roof. Its model is no more than 0.5 wide either side of its middle, wheels
// and spoiler included, and it is drawn at CAR_SCALE.
function carrier(kit) {
  const object = new Group();
  const ride = new Group();
  ride.scale.setScalar(CAR_SCALE);
  object.add(ride);
  const body = new Group();
  const paint = kit.mat('roof', { rough: 0.22, metal: 0.52 });
  const chrome = chromeOf(kit, { rough: 0.18, metal: 0.78 });
  const black = kit.mat('#0a0420', { rough: 0.35, metal: 0.4 });
  const glass = kit.mat('#102348', { rough: 0.08, metal: 0.35, emissive: 'accent', glow: 0.32 });
  const cyan = neon(kit, 'accent', 1.7);
  body.add(kit.box(0.94, 0.17, 1.72, paint, [0, 0.22, 0]));
  const nose = kit.box(0.92, 0.1, 0.66, paint, [0, 0.235, 0.7]);
  nose.rotation.x = 0.17;
  const screen = kit.box(0.76, 0.03, 0.4, glass, [0, 0.39, 0.26]);
  screen.rotation.x = 0.55;
  body.add(nose, screen, kit.box(0.78, 0.17, 0.62, glass, [0, 0.39, -0.2]), kit.box(0.8, 0.03, 0.56, paint, [0, 0.485, -0.22]));
  for (let i = 0; i < 3; i += 1) body.add(kit.box(0.7, 0.02, 0.07, black, [0, 0.33 + i * 0.035, -0.56 - i * 0.07]));
  body.add(kit.box(0.98, 0.035, 0.16, paint, [0, 0.44, -0.84]), kit.box(0.88, 0.06, 0.03, neon(kit, 'fail', 2.2), [0, 0.25, -0.87]));
  for (const side of [-1, 1]) {
    body.add(kit.box(0.2, 0.05, 0.05, neon(kit, 'window', 2.0), [side * 0.33, 0.25, 1.02]));
    body.add(kit.box(0.03, 0.03, 1.5, cyan, [side * 0.475, 0.14, 0]));
    for (const z of [-0.56, 0.56]) {
      body.add(kit.cylinder(0.15, 0.15, 0.12, black, [side * 0.44, 0.15, z], 12).rotateZ(Math.PI / 2));
      body.add(kit.cylinder(0.07, 0.07, 0.125, chrome, [side * 0.435, 0.15, z], 8).rotateZ(Math.PI / 2));
    }
  }
  ride.add(bake(body));
  const glow = new Mesh(new CircleGeometry(0.95, 22), kit.basic('roof', { opacity: 0.5, additive: true }));
  glow.rotation.x = -Math.PI / 2;
  glow.scale.set(0.74, 1.2, 1);
  glow.position.y = 0.035;
  ride.add(glow);
  const trail = new Group();
  trail.position.set(0, 0.2, -0.88);
  for (const [x, color] of [[-0.36, 'fail'], [0.36, 'fail'], [0, 'roof']]) {
    const ribbon = new Mesh(new PlaneGeometry(0.11, 1), kit.basic(color, { opacity: 0.76, additive: true }));
    ribbon.rotation.x = -Math.PI / 2;
    ribbon.geometry.translate(0, 0.5, 0);
    ribbon.position.x = x;
    if (!x) ribbon.position.y = -0.1;
    trail.add(ribbon);
  }
  ride.add(trail);
  const hold = new Group();
  hold.position.set(0, 0.7, -0.2);
  ride.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'ground', cruise: 1.2,
    pose(target, { time, phase, speed }) {
      const moving = phase === 'travel';
      ride.position.y = Math.abs(Math.sin(time * 9)) * 0.012 * speed;
      ride.rotation.x = -0.04 * speed;
      trail.scale.set(1, 1, moving ? 0.45 + speed * 2.8 : 0.04);
      trail.visible = moving;
      glow.material.opacity = 0.4 + 0.14 * Math.sin(time * 9);
    },
  };
}

// ---------- scenery: the theme's sunset, stood up behind the floor ----------

// The camera looks down on the floor, so no real sky is ever in shot. The
// sunset stands at the back of the floor as a set: a painted sky, the sun in
// front of it, a far ridge, two ranges of faceted hills and the palms.
const WALL_Z = -15.4;
// One trip's length (ui/yeet/factory-layout.js TRIP_LENGTH), so the skies of
// two towns side by side meet.
const WALL_W = 108;
const WALL_H = 16;
const SUN_R = 3.2;
const SUN_Y = 1.15;
// The cuts across the sun's lower half, as shares of its height (theme.css's
// --synthwave-art-sun-night).
const SUN_CUTS = [[0.419, 0.4265], [0.4625, 0.4775], [0.511, 0.5335], [0.565, 0.595], [0.624, 0.661], [0.69, 0.74]];

// A picture's material: its own colours, with no lights, tone curve or fog.
function drawn(material) {
  material.toneMapped = false;
  material.fog = false;
  return material;
}

function flatInk(kit, color, extra = {}) {
  return memo(kit, 'ink:' + color + JSON.stringify(extra), () => drawn(new MeshBasicMaterial({ color: kit.color(color), ...extra })));
}

function skyWall(kit) {
  const ink = INK[kit.mode];
  const dark = kit.mode === 'dark';
  const material = drawn(kit.painted((ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of ink.sky) sky.addColorStop(at, color);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    if (dark) {
      // Stars: thicker towards the top, none in the haze.
      for (let i = 0; i < 260; i += 1) {
        const x = seeded(i * 3 + 1) * w;
        const y = seeded(i * 3 + 2) ** 1.25 * h * 0.84;
        const size = 0.7 + seeded(i * 3 + 3) ** 3 * 2.2;
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + seeded(i * 7) * 0.6).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
    const top = h * 0.5;
    const haze = ctx.createLinearGradient(0, h, 0, top);
    for (const [at, color] of ink.haze) haze.addColorStop(at, color);
    ctx.fillStyle = haze;
    ctx.fillRect(0, top, w, h - top);
    if (!dark) {
      // The poster's halftone: dots that thin out as they rise from the horizon.
      const step = 12;
      for (let row = 0; row * step < h * 0.42; row += 1) {
        const y = h - 4 - row * step;
        const radius = 4.4 * (1 - row * step / (h * 0.42)) ** 0.8;
        if (radius < 0.5) continue;
        ctx.fillStyle = 'rgba(224,33,138,0.36)';
        for (let x = (row % 2) * step / 2; x < w + step; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, TAU);
          ctx.fill();
        }
      }
    }
  }, { width: 1024, height: 1024, repeat: [6, 1], basic: true }));
  const wall = new Mesh(new PlaneGeometry(WALL_W, WALL_H), material);
  wall.position.set(0, WALL_H / 2, WALL_Z);
  return wall;
}

function sunDisc(kit) {
  const ink = INK[kit.mode];
  const dark = kit.mode === 'dark';
  const group = new Group();
  const material = memo(kit, 'sunDisc', () => drawn(kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, TAU);
    ctx.clip();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of ink.sun) fill.addColorStop(at, color);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    for (const [from, to] of SUN_CUTS) ctx.fillRect(0, from * h, w, (to - from) * h);
    ctx.restore();
  }, { width: 1024, height: 1024, basic: true, transparent: true })));
  const z = WALL_Z + 0.5;
  group.add(kit.halo(ink.glow, SUN_R * 5.2, SUN_R * 4.2, { opacity: ink.glowOpacity, at: [0, SUN_Y + 0.4, WALL_Z + 0.2], flat: false, additive: dark }));
  if (!dark) {
    // The poster's hard shadow, a step down and to the right.
    const shade = new Mesh(new CircleGeometry(SUN_R, 48), drawn(new MeshBasicMaterial({ color: kit.color('#e0218a'), transparent: true, opacity: 0.22, depthWrite: false })));
    shade.position.set(0.16, SUN_Y - 0.16, z - 0.1);
    group.add(shade);
  }
  const disc = new Mesh(new PlaneGeometry(SUN_R * 2, SUN_R * 2), material);
  disc.position.set(0, SUN_Y, z);
  group.add(disc);
  return group;
}

// The far ridge: one low, jagged outline right across the back.
function farRidge(kit) {
  const ink = INK[kit.mode];
  const outline = lift => {
    const shape = new Shape();
    shape.moveTo(-WALL_W / 2, 0);
    let x = -WALL_W / 2;
    let i = 0;
    while (x < WALL_W / 2) {
      const peak = i % 2 === 0;
      shape.lineTo(x, (peak ? 0.55 + seeded(i * 5 + 2) * 0.75 : 0.22 + seeded(i * 5 + 3) * 0.3) + lift);
      x += 0.9 + seeded(i * 5 + 4) * 1.5;
      i += 1;
    }
    shape.lineTo(WALL_W / 2, 0.3 + lift);
    shape.lineTo(WALL_W / 2, 0);
    return new ShapeGeometry(shape);
  };
  const group = new Group();
  if (ink.ridgeLine) {
    const rim = new Mesh(outline(0.045), flatInk(kit, ink.ridgeLine));
    rim.position.set(0, 0, WALL_Z + 0.78);
    group.add(rim);
  }
  const ridge = new Mesh(outline(0), flatInk(kit, ink.ridge));
  ridge.position.set(0, 0, WALL_Z + 0.8);
  group.add(ridge);
  return group;
}

// A thin bar from a to b: a drawn line that keeps its width in perspective.
function strut(kit, a, b, thickness, material) {
  const mesh = kit.box(thickness, thickness, a.distanceTo(b), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.lookAt(b);
  return mesh;
}

// One hill, drawn as the theme draws it: a facet in shade on the left, a lit
// one on the right that darkens towards its foot, the crease between them in
// cyan and the skyline in pink.
function hill(kit, [x, z, half, height, reach, apexShift, frontShift]) {
  const ink = INK[kit.mode];
  const dark = kit.mode === 'dark';
  const group = new Group();
  const apex = new Vector3(apexShift, height, 0);
  const left = new Vector3(-half, 0, 0);
  const right = new Vector3(half, 0, 0);
  const front = new Vector3(frontShift, 0, reach);
  const shade = kit.color(ink.hillShade);
  const top = kit.color(ink.hillTop);
  const foot = kit.color(ink.hillFoot);
  const points = [apex, left, front, apex, front, right];
  const tones = [shade, shade, shade, top, foot, foot];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => [p.x, p.y, p.z]), 3));
  geometry.setAttribute('color', new Float32BufferAttribute(tones.flatMap(c => [c.r, c.g, c.b]), 3));
  group.add(new Mesh(geometry, memo(kit, 'hillFace', () => drawn(new MeshBasicMaterial({ vertexColors: true })))));
  const rim = dark ? neon(kit, ink.hillRim, 1.5) : flatInk(kit, ink.hillRim);
  const crease = dark ? neon(kit, ink.hillEdge, 1.2) : flatInk(kit, ink.hillEdge);
  const width = dark ? 0.035 : 0.045;
  group.add(strut(kit, apex, left, width, rim), strut(kit, apex, right, width, rim), strut(kit, apex, front, width * 0.8, crease));
  group.position.set(x, 0, z);
  return group;
}

// Two ranges either side of the sun: [x, z, half width, height, how far the
// crease's foot comes forward, apex off centre, crease foot off centre].
const RANGE = [
  [4.9, 0.9, 1.9, 1.55, 1.2, 0.25, 0.55],
  [7.3, 0.3, 2.5, 2.35, 1.6, -0.35, 0.3],
  [10.3, 1.1, 2.2, 1.75, 1.3, 0.3, 0.6],
  [13.1, 0.2, 2.9, 2.55, 1.7, 0.1, 0.5],
  [16.4, 0.9, 2.5, 1.9, 1.4, -0.3, 0.2],
  [19.6, 0.1, 3.2, 2.6, 1.8, 0.3, 0.7],
  [23.4, 0.8, 3.0, 2.0, 1.5, -0.1, 0.4],
  [27.2, 0.2, 3.4, 2.5, 1.8, 0.2, 0.6],
  [31.4, 0.9, 3.1, 1.8, 1.4, 0, 0.4],
];

function ranges(kit) {
  const group = new Group();
  RANGE.forEach(([x, back, half, height, reach, apexShift, frontShift], i) => {
    const z = WALL_Z + 1.3 + back;
    group.add(hill(kit, [x, z, half, height, reach, apexShift, frontShift]));
    // The left range is the right one mirrored and a little reshuffled, as the two drawings are.
    const other = RANGE[(i + 4) % RANGE.length];
    group.add(hill(kit, [-x - 0.2, z + 0.1, other[2] * 0.95, other[3] * (i === 0 ? 0.8 : 1), other[4], -other[5], other[6]]));
  });
  return bake(group);
}

// A palm frond's picture: a rib with leaflets swept back from it.
function frondMaterial(kit) {
  return memo(kit, 'frond', () => {
    const ink = INK[kit.mode];
    const material = drawn(kit.painted((ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const leaf = (from, side, length, style) => {
        const reach = length * 0.62;
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(from - 5, mid);
        ctx.quadraticCurveTo(from + reach * 0.5, mid + side * length * 0.78, from + reach + 12, mid + side * length);
        ctx.quadraticCurveTo(from + reach * 0.62, mid + side * length * 0.42, from + 9, mid);
        ctx.fill();
      };
      const count = 26;
      for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        const from = 10 + t * (w - 46);
        const length = (h / 2 - 3) * Math.sin(Math.PI * (0.16 + 0.8 * t)) ** 0.6;
        for (const side of [-1, 1]) leaf(from, side, length, ink.palm);
      }
      ctx.strokeStyle = ink.palm;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2, mid);
      ctx.lineTo(w - 8, mid);
      ctx.stroke();
    }, { width: 512, height: 160, basic: true, transparent: true, doubleSide: true }));
    material.alphaTest = 0.45;
    material.transparent = false;
    material.depthWrite = true;
    return material;
  });
}

// One frond: a strip that arcs out from the crown and droops, folded a
// little along its rib so it never turns edge-on.
function frond(kit, length, width, lift, droop) {
  const steps = 7;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps;
    const out = length * (s - 0.16 * s * s);
    const up = length * (lift * s - droop * s * s);
    const half = width / 2;
    for (const [side, v] of [[-1, 0], [0, 0.5], [1, 1]]) {
      positions.push(out, up - Math.abs(side) * half * 0.42, side * half);
      uvs.push(s, v);
    }
    if (i < steps) {
      const a = i * 3;
      index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return new Mesh(geometry, frondMaterial(kit));
}

// A palm as the theme draws one: a slim trunk that leans and curves, and a
// full head of drooping fronds, all in one ink. The trunk goes into `trunks`,
// which stand still, and the crown that sways is returned.
function palm(kit, trunks, x, z, height, lean, seed = 0) {
  const ink = flatInk(kit, INK[kit.mode].palm);
  const segments = 8;
  let at = new Vector3(0, 0, 0);
  for (let i = 0; i < segments; i += 1) {
    const step = height / segments;
    const bend = lean * ((i + 0.5) / segments) ** 1.5;
    const radius = 0.11 - i * 0.007;
    const piece = kit.cylinder(radius - 0.007, radius + (i === 0 ? 0.05 : 0), step * 1.1, ink, [0, 0, 0], 7);
    piece.rotation.z = -bend;
    piece.position.set(x + at.x + Math.sin(bend) * step / 2, at.y + Math.cos(bend) * step / 2, z);
    trunks.add(piece);
    at = new Vector3(at.x + Math.sin(bend) * step, at.y + Math.cos(bend) * step, 0);
  }
  const crown = new Group();
  crown.position.set(x + at.x, at.y, z);
  const count = 13;
  for (let i = 0; i < count; i += 1) {
    const upright = i % 3 === 2;
    const length = height * (upright ? 0.34 : 0.46 + seeded(seed + i * 3) * 0.12);
    const leaf = frond(kit, length, length * 0.42, upright ? 0.95 : 0.42 + seeded(seed + i * 5) * 0.28, upright ? 0.75 : 0.95 + seeded(seed + i * 7) * 0.4);
    leaf.rotation.y = (i / count) * TAU + seeded(seed + i) * 0.3;
    crown.add(leaf);
  }
  for (let i = 0; i < 3; i += 1) crown.add(kit.sphere(0.085, ink, [Math.cos(i * 2.1) * 0.1, -0.1, Math.sin(i * 2.1) * 0.1], 6));
  return solid(crown);
}

// Where the palms stand: two pairs framing the sun behind the station, and a
// row down each side of the floor, their fronds clear of the outer lots
// (decor keeps beyond x 9.6 alongside the floor). [x, z, height, lean]
const PALMS = [
  [-6.3, -10.4, 3.5, 0.5], [-8.9, -11.6, 2.8, -0.3], [6.5, -10.2, 3.7, -0.52], [9.1, -11.4, 2.9, 0.34],
  [-12.6, -3.4, 4.3, 0.36], [12.8, -1.6, 4.5, -0.42], [-12.9, 3.6, 4.0, 0.3], [12.6, 5.4, 4.2, -0.3],
  [-13.2, 9.8, 4.4, 0.34], [13.0, 11.6, 4.1, -0.36],
];

function decor(kit) {
  const group = new Group();
  const ink = INK[kit.mode];
  const dark = kit.mode === 'dark';
  group.add(skyWall(kit), sunDisc(kit), farRidge(kit), ranges(kit));
  // The horizon: one bright line where the floor meets the sky.
  group.add(kit.box(WALL_W, 0.07, 0.07, dark ? neon(kit, ink.horizon, 1.9) : flatInk(kit, ink.horizon), [0, 0.04, WALL_Z + 0.9]));
  const trunks = new Group();
  const crowns = PALMS.map(([x, z, height, lean], i) => palm(kit, trunks, x, z, height, lean, i * 17));
  group.add(bake(trunks), ...crowns);
  memo(kit, 'bag', () => ({})).crowns = crowns;
  return group;
}

// Night only: the stars with points twinkle, and thin clouds drift across the
// sun. The palms sway by day and night.
function weather(kit) {
  const dark = kit.mode === 'dark';
  const object = new Group();
  const sparkMat = drawn(kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = dark ? '#ffffff' : '#e0218a';
    ctx.beginPath();
    // theme.css's --synthwave-art-spark, a four-pointed star on a 14 by 14 grid
    const s = w / 14;
    [[7, 0], [8.1, 5.9], [14, 7], [8.1, 8.1], [7, 14], [5.9, 8.1], [0, 7], [5.9, 5.9]].forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.fill();
  }, { width: 64, height: 64, basic: true, transparent: true, opacity: dark ? 1 : 0.55 }));
  const stars = Array.from({ length: 22 }, (_, i) => {
    const size = 0.16 + seeded(i * 11 + 5) * 0.2;
    const mesh = new Mesh(new PlaneGeometry(size, size), sparkMat);
    // Clear of the sun, lowest just above the hills.
    const side = i % 2 ? 1 : -1;
    mesh.position.set(side * (4.2 + seeded(i * 11 + 1) * 22), 2.9 + seeded(i * 11 + 2) ** 1.6 * 10.5, WALL_Z + 0.12);
    object.add(mesh);
    return { mesh, phase: i * 1.37 };
  });
  const clouds = dark ? [[-3.6, 2.1, 3.3, 0.12, 46], [1.4, 2.62, 4.0, 0.14, 61], [2.6, 2.34, 2.3, 0.09, 53]].map(([x, y, w, h, period]) => {
    const mesh = kit.halo('#ffb0bc', w, h, { opacity: 0.75, at: [x, y, WALL_Z + 0.62], flat: false, additive: false });
    object.add(mesh);
    return { mesh, x, period };
  }) : [];
  return {
    object,
    frame(time) {
      if (kit.reducedMotion) return;
      for (const star of stars) star.mesh.scale.setScalar(0.55 + 0.45 * Math.abs(Math.sin(time * 1.1 + star.phase)));
      for (const cloud of clouds) cloud.mesh.position.x = cloud.x + Math.sin((time / cloud.period) * TAU) * 1.6;
      const crowns = memo(kit, 'bag', () => ({})).crowns || [];
      crowns.forEach((crown, i) => { crown.rotation.z = Math.sin(time * 0.55 + i * 1.9) * 0.035; });
    },
    dispose() {},
  };
}

export default { palette: PALETTE, backdrop, layout, view, pad: false, dock, ghost, ruin, floor, hall, station, crate, carrier, decor, weather, frame };
