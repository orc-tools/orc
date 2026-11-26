// Phosphor Factory skin: inside the mainframe. The floor is a circuit board
// drawn in vector strokes, the aisle a data bus into a CPU monolith, and every
// station a component wired to the bus by its own trace. Nothing runs on the
// bus but what the run really hands over: amber pulses out for instructions,
// bright ones in behind each result. Light mode re-inks the same board as a
// pen plot on greenbar paper.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, CylinderGeometry, DoubleSide,
  EdgesGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, Vector3,
} from 'three';

const MONO = '"JetBrains Mono", Menlo, Consolas, monospace';
const TAU = Math.PI * 2;

const PALETTE = {
  light: {
    ground: '#f1efdc', horizon: '#e9e7d3', zenith: '#f6f4e7', sky: '#fbfaf0', sun: '#ffffff',
    glow: '#13693a', aisle: '#e2e9d2', line: '#7aa682', body: '#f1efdc', trim: '#c4d0b2', roof: '#dae3c8',
    accent: '#13693a', worker: '#4a7a00', busy: '#c98a00', ok: '#0f8a46', fail: '#c0281e', idle: '#8aa08d',
    crate: '#f1efdc', tape: '#13693a', smoke: '#b3c9b2', window: '#249450', door: '#f1efdc',
    ink: '#0f5b2e', hot: '#063a1b', dim: '#93b598', faint: '#d6e4cc', trace: '#7fa985', amber: '#a35c00',
    paper: '#f1efdc', band: '#e1ecd3',
    sunIntensity: 2.2, skyIntensity: 1.4, envIntensity: 0.48, exposure: 1.02, fogNear: 10, fogSpan: 30,
  },
  dark: {
    ground: '#020904', horizon: '#020a05', zenith: '#010302', sky: '#2f7c44', sun: '#c2ffd0',
    glow: '#39ff6a', aisle: '#04140a', line: '#1b6e32', body: '#030c06', trim: '#0b2613', roof: '#0e3018',
    accent: '#39ff6a', worker: '#c0ff4a', busy: '#ffb642', ok: '#7dfc96', fail: '#ff5a4e', idle: '#2a6a3a',
    crate: '#020904', tape: '#39ff6a', smoke: '#1d5c2e', window: '#39ff6a', door: '#010402',
    ink: '#39ff6a', hot: '#d2ffdc', dim: '#17592a', faint: '#0a2612', trace: '#145226', amber: '#ffb03a',
    paper: '#020904', band: '#03100a',
    sunIntensity: 1.65, skyIntensity: 1.48, envIntensity: 0.72, exposure: 1.14, fogNear: 10, fogSpan: 30,
  },
};

const BACKDROP = {
  dark: 'repeating-linear-gradient(0deg, rgba(57,255,106,0.035) 0 1px, transparent 1px 3px), '
    + 'radial-gradient(ellipse 80% 50% at 50% 30%, #062312 0%, #010402 75%)',
  light: 'repeating-linear-gradient(0deg, rgba(19,105,58,0.05) 0 1px, transparent 1px 3px), '
    + 'linear-gradient(180deg, #f6f4e7 0%, #ebe9d4 100%)',
};

// The engine's floor plan (ui/yeet/factory-layout.js) with this skin's layout.
const ROW_GAP = 2.9;
const FIRST_ROW = -0.6;
const STAGGER = 0.5;
const COLUMNS = [2.7, 5.4, 8.1];
const gapZ = (side, row) => FIRST_ROW + row * ROW_GAP + (side > 0 ? STAGGER * ROW_GAP : 0) - ROW_GAP / 2;
const BUS = { front: 11.6, back: -3.45 };

const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const back = (t, s = 1.8) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

const CACHE = new WeakMap();
const bag = kit => {
  let entry = CACHE.get(kit);
  if (!entry) CACHE.set(kit, (entry = {}));
  return entry;
};
const memo = (kit, key, fn) => (bag(kit)[key] ??= fn());

// ---------- vector strokes ----------

class Sketch {
  constructor() { this.v = []; }
  seg(ax, ay, az, bx, by, bz) { this.v.push(ax, ay, az, bx, by, bz); return this; }
  path(points, closed = false) {
    for (let i = 0; i < points.length - 1; i += 1) this.seg(...points[i], ...points[i + 1]);
    if (closed) this.seg(...points[points.length - 1], ...points[0]);
    return this;
  }
  box(w, h, d, x = 0, y = 0, z = 0) {
    const a = w / 2; const b = h / 2; const c = d / 2;
    for (const sy of [-b, b]) this.path([[x - a, y + sy, z - c], [x + a, y + sy, z - c], [x + a, y + sy, z + c], [x - a, y + sy, z + c]], true);
    for (const [sx, sz] of [[-a, -c], [a, -c], [a, c], [-a, c]]) this.seg(x + sx, y - b, z + sz, x + sx, y + b, z + sz);
    return this;
  }
  // A circle around `axis` through (x, y, z).
  ring(r, x, y, z, axis = 'y', n = 16, from = 0, to = TAU) {
    const points = [];
    const closed = to - from >= TAU - 1e-6;
    const steps = closed ? n : n + 1;
    for (let i = 0; i < steps; i += 1) {
      const a = from + ((to - from) * i) / n;
      const u = Math.cos(a) * r; const w = Math.sin(a) * r;
      points.push(axis === 'y' ? [x + u, y, z + w] : axis === 'z' ? [x + u, y + w, z] : [x, y + u, z + w]);
    }
    return this.path(points, closed);
  }
  rect(w, h, x, y, z) {
    return this.path([[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z], [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]], true);
  }
  cylinder(r, h, x, y, z, n = 12, ribs = 4) {
    this.ring(r, x, y - h / 2, z, 'y', n).ring(r, x, y + h / 2, z, 'y', n);
    for (let i = 0; i < ribs; i += 1) {
      const a = (i / ribs) * TAU + Math.PI / ribs;
      this.seg(x + Math.cos(a) * r, y - h / 2, z + Math.sin(a) * r, x + Math.cos(a) * r, y + h / 2, z + Math.sin(a) * r);
    }
    return this;
  }
}

// Square prisms along each segment, stretched by half a width so corners close.
function strokeGeometry(v, width) {
  const n = v.length / 6;
  const pos = new Float32Array(n * 24);
  const index = new Uint32Array(n * 24);
  const h = width / 2;
  for (let s = 0; s < n; s += 1) {
    let ax = v[s * 6]; let ay = v[s * 6 + 1]; let az = v[s * 6 + 2];
    let bx = v[s * 6 + 3]; let by = v[s * 6 + 4]; let bz = v[s * 6 + 5];
    let dx = bx - ax; let dy = by - ay; let dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    ax -= dx * h; ay -= dy * h; az -= dz * h;
    bx += dx * h; by += dy * h; bz += dz * h;
    const ux = Math.abs(dy) > 0.9 ? 1 : 0; const uy = 1 - ux;
    let px = -dz * uy; let py = dz * ux; let pz = dx * uy - dy * ux;
    const pl = Math.hypot(px, py, pz) || 1;
    px *= h / pl; py *= h / pl; pz *= h / pl;
    const qx = dy * pz - dz * py; const qy = dz * px - dx * pz; const qz = dx * py - dy * px;
    const corners = [[px + qx, py + qy, pz + qz], [px - qx, py - qy, pz - qz], [-px - qx, -py - qy, -pz - qz], [-px + qx, -py + qy, -pz + qz]];
    const o = s * 24;
    corners.forEach(([cx, cy, cz], i) => {
      pos.set([ax + cx, ay + cy, az + cz], o + i * 3);
      pos.set([bx + cx, by + cy, bz + cz], o + 12 + i * 3);
    });
    const base = s * 8;
    for (let f = 0; f < 4; f += 1) {
      const a = base + f; const b = base + ((f + 1) % 4);
      index.set([a, b, b + 4, a, b + 4, a + 4], s * 24 + f * 6);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// Flat strokes on the board: [x1, z1, x2, z2] segments as quads at height y.
class Flat {
  constructor() { this.v = []; }
  seg(x1, z1, x2, z2) { this.v.push(x1, z1, x2, z2); return this; }
  path(points, closed = false) {
    for (let i = 0; i < points.length - 1; i += 1) this.seg(...points[i], ...points[i + 1]);
    if (closed) this.seg(...points[points.length - 1], ...points[0]);
    return this;
  }
  ring(r, x, z, n = 10) {
    const points = [];
    for (let i = 0; i < n; i += 1) points.push([x + Math.cos((i / n) * TAU) * r, z + Math.sin((i / n) * TAU) * r]);
    return this.path(points, true);
  }
  rect(w, d, x, z) { return this.path([[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]], true); }
  dashed(x1, z1, x2, z2, dash = 0.22, gap = 0.16) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    for (let d = 0; d < len; d += dash + gap) {
      const a = d / len; const b = Math.min(len, d + dash) / len;
      this.seg(x1 + (x2 - x1) * a, z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, z1 + (z2 - z1) * b);
    }
    return this;
  }
}

function flatGeometry(v, width, y) {
  const n = v.length / 4;
  const pos = new Float32Array(n * 12);
  const index = new Uint32Array(n * 6);
  const h = width / 2;
  for (let s = 0; s < n; s += 1) {
    let [x1, z1, x2, z2] = [v[s * 4], v[s * 4 + 1], v[s * 4 + 2], v[s * 4 + 3]];
    let dx = x2 - x1; let dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    x1 -= dx * h; z1 -= dz * h; x2 += dx * h; z2 += dz * h;
    const px = -dz * h; const pz = dx * h;
    pos.set([x1 + px, y, z1 + pz, x1 - px, y, z1 - pz, x2 - px, y, z2 - pz, x2 + px, y, z2 + pz], s * 12);
    const b = s * 4;
    index.set([b, b + 2, b + 1, b, b + 3, b + 2], s * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const strokeWidth = kit => (kit.mode === 'dark' ? 0.026 : 0.03);

// ---------- materials ----------

// Unlit and outside tone mapping, so the phosphor greens stay exact.
function inks(kit) {
  return memo(kit, 'inks', () => {
    const dark = kit.mode === 'dark';
    const make = (key, { opacity = 1, additive = false, doubleSide = false } = {}) => {
      const material = new MeshBasicMaterial({
        color: kit.color(key), transparent: additive || opacity < 1, opacity,
        depthWrite: !additive && opacity >= 1, toneMapped: false,
      });
      if (additive) material.blending = AdditiveBlending;
      if (doubleSide) material.side = DoubleSide;
      return material;
    };
    const occluder = doubleSide => {
      const material = make('paper', { doubleSide });
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
      return material;
    };
    return {
      ink: make('ink'), hot: make('hot'), dim: make('dim'), faint: make('faint'), trace: make('trace'),
      amber: make('amber'), ok: make('ok'), fail: make('fail'), busy: make('busy'),
      void: occluder(false), voidBoth: occluder(true),
      flash: make('hot', { additive: dark, opacity: dark ? 1 : 0.9 }),
      flashAmber: make('amber', { additive: dark, opacity: dark ? 1 : 0.9 }),
      haze: make('ink', { additive: dark, opacity: dark ? 0.16 : 0.1 }),
      text: make('ink', { additive: dark, opacity: dark ? 0.95 : 0.9 }),
    };
  });
}

const textCanvas = (kit, key, width, height, draw) => memo(kit, `tex:${key}`, () => kit.canvas(width, height, draw));

const glyphInk = (kit, key, map, colorKey, opacity = 1) => memo(kit, `glyph:${key}:${colorKey}`, () => {
  const material = new MeshBasicMaterial({
    map, color: kit.color(colorKey), transparent: true, opacity, depthWrite: false, toneMapped: false, side: DoubleSide,
  });
  if (kit.mode === 'dark') material.blending = AdditiveBlending;
  return material;
});

// A boxed status word, white on clear so each material tints it.
function badge(kit, word, icon = null) {
  const map = textCanvas(kit, `badge:${word}`, 256, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.font = `bold 54px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const textX = icon ? w * 0.6 : w / 2;
    ctx.fillText(word, textX, h / 2 + 3);
    if (icon === 'check') {
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(30, 50); ctx.lineTo(50, 70); ctx.lineTo(84, 26);
      ctx.stroke();
    } else if (icon === 'skull') {
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(58, 42, 24, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(74, 72); ctx.lineTo(42, 72); ctx.closePath();
      ctx.stroke();
      ctx.fillRect(44, 34, 10, 10);
      ctx.fillRect(62, 34, 10, 10);
      for (const x of [48, 58, 68]) ctx.fillRect(x - 1, 62, 3, 12);
    }
  });
  return map;
}

function glyphs(kit) {
  return memo(kit, 'glyphs', () => ({
    ok: glyphInk(kit, 'ok', badge(kit, 'OK', 'check'), 'ok'),
    err: glyphInk(kit, 'err', badge(kit, 'ERR', 'skull'), 'fail'),
    halt: glyphInk(kit, 'halt', badge(kit, 'HALT'), 'dim'),
    run: glyphInk(kit, 'run', badge(kit, 'RUN'), 'ink'),
    wait: glyphInk(kit, 'wait', badge(kit, 'WAIT'), 'busy'),
    idle: glyphInk(kit, 'idle', badge(kit, 'IDLE'), 'dim'),
    done: glyphInk(kit, 'done', badge(kit, 'DONE', 'check'), 'ok'),
    recv: glyphInk(kit, 'recv', badge(kit, 'RECV'), 'hot'),
    fork: glyphInk(kit, 'fork', badge(kit, 'FORK'), 'amber'),
  }));
}

// ---------- the board ----------

function boardTexture(kit) {
  const dark = kit.mode === 'dark';
  const p = kit.palette;
  const css = c => `#${c.getHexString()}`;
  return kit.canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = css(p.paper);
    ctx.fillRect(0, 0, w, h);
    if (!dark) {
      ctx.fillStyle = css(p.band);
      ctx.fillRect(0, 0, w, h / 2);
    }
    ctx.fillStyle = dark ? '#0b2a15' : 'rgba(15,91,46,0.16)';
    const step = w / 8;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }, { repeat: [150 / ROW_GAP, 150 / ROW_GAP] });
}

function label(kit, text, size, at, colorKey = 'dim') {
  const width = Math.min(512, Math.ceil(text.length * 25 + 12));
  const map = textCanvas(kit, `label:${text}`, width, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = `bold 40px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 6, h / 2 + 2);
  });
  const mesh = new Mesh(new PlaneGeometry(size * (width / 64), size), glyphInk(kit, `label:${text}`, map, colorKey, 0.9));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(...at);
  return mesh;
}

function floor(kit) {
  const group = new Group();
  const I = inks(kit);
  const dark = kit.mode === 'dark';
  const board = new Mesh(new PlaneGeometry(150, 150), new MeshBasicMaterial({ map: boardTexture(kit), toneMapped: false }));
  board.rotation.x = -Math.PI / 2;
  board.position.z = -5;
  group.add(board);

  const bus = new Flat();
  const lanes = [0, -0.22, 0.22, -0.44, 0.44, -0.66, 0.66, -0.88, 0.88];
  for (const x of lanes) bus.seg(x, BUS.back, x, BUS.front);
  const fine = new Flat();
  const vias = new Flat();
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row += 1) {
      const z = gapZ(side, row);
      bus.seg(side * 0.88, z, side * 9.3, z);
      fine.seg(side * 1.05, z - 0.14, side * 9.3, z - 0.14).seg(side * 1.05, z + 0.14, side * 9.3, z + 0.14);
      vias.ring(0.09, side * 0.88, z).ring(0.07, side * 9.42, z);
      for (const x of COLUMNS) vias.ring(0.05, side * (x - 1.45), z - 0.14).ring(0.05, side * (x + 1.45), z + 0.14);
    }
    vias.ring(0.07, side * 0.88, BUS.front + 0.1);
  }
  for (let z = BUS.back + 0.6; z < BUS.front; z += 1.45) {
    for (const x of [-0.11, 0.11]) vias.ring(0.035, x, z + (x > 0 ? 0.72 : 0));
  }
  group.add(new Mesh(flatGeometry(bus.v, dark ? 0.06 : 0.055, 0.004), I.trace));
  group.add(new Mesh(flatGeometry(fine.v, 0.028, 0.004), I.trace));
  group.add(new Mesh(flatGeometry(vias.v, 0.03, 0.006), I.dim));

  // Board edge: a routed outline with mounting holes, or on paper the
  // tractor-feed holes and perforations of a plotter roll.
  const edge = new Flat();
  if (dark) {
    edge.path([[-10, -8.4], [10, -8.4], [10, 12.6], [-10, 12.6]], true);
    for (const [x, z] of [[-9.5, -7.9], [9.5, -7.9], [-9.5, 12.1], [9.5, 12.1]]) edge.ring(0.28, x, z, 14).ring(0.16, x, z, 12);
  } else {
    for (const side of [-1, 1]) {
      edge.seg(side * 10, -30, side * 10, 30);
      for (let z = -20; z < 24; z += 0.6) edge.ring(0.13, side * 10.5, z, 10);
    }
    edge.dashed(-10, -8.4, 10, -8.4, 0.12, 0.12).dashed(-10, 12.6, 10, 12.6, 0.12, 0.12);
  }
  group.add(new Mesh(flatGeometry(edge.v, 0.035, 0.005), I.dim));

  group.add(label(kit, 'CORE-0 MAINBOARD  REV.9', 0.36, [-6.2, 0.007, -5.2]));
  group.add(label(kit, 'J1  DATA BUS', 0.26, [-2.0, 0.007, 10.9]));
  group.add(label(kit, 'RX BUF', 0.24, [3.5, 0.007, -2.6]));

  // Every shared ink stays in the scene so the engine disposes it.
  const anchor = new PlaneGeometry(0.01, 0.01);
  for (const material of [...Object.values(I), ...Object.values(glyphs(kit))]) {
    const keep = new Mesh(anchor, material);
    keep.visible = false;
    group.add(keep);
  }
  return group;
}

// One pulse of a hand-off on the bus: amber for instructions on their way out
// to a component, bright for a result's bytes on their way in.
function packet(kit, direction) {
  const I = inks(kit);
  const group = new Group();
  const dash = new Mesh(new PlaneGeometry(0.09, 0.4), direction === 'down' ? I.flashAmber : I.flash);
  dash.rotation.x = -Math.PI / 2;
  dash.position.y = -0.085;
  group.add(dash);
  return group;
}

// ---------- the hall: a CPU monolith in its socket ----------

function dynamicRibbon(points, material) {
  const pos = new Float32Array(points * 6);
  const index = [];
  for (let i = 0; i < points - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

// Writes a trace across [x0, x1] at depth z; `sample(u)` gives each point's height.
function drawRibbon(mesh, x0, x1, z, width, sample) {
  const attr = mesh.geometry.attributes.position;
  const pos = attr.array;
  const n = pos.length / 6;
  for (let i = 0; i < n; i += 1) {
    const u = i / (n - 1);
    const x = x0 + (x1 - x0) * u;
    const y = sample(u);
    pos[i * 6] = x; pos[i * 6 + 1] = y - width / 2; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x; pos[i * 6 + 4] = y + width / 2; pos[i * 6 + 5] = z;
  }
  attr.needsUpdate = true;
}

function solid(kit, geometry, at, both = false) {
  const mesh = new Mesh(geometry, both ? inks(kit).voidBoth : inks(kit).void);
  mesh.position.set(...at);
  return mesh;
}

function reel(kit, r, material = 'ink') {
  const I = inks(kit);
  const group = new Group();
  group.add(solid(kit, new CircleGeometry(r, 20), [0, 0, -0.01]));
  const s = new Sketch().ring(r, 0, 0, 0, 'z', 20).ring(r * 0.26, 0, 0, 0, 'z', 10);
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU;
    s.seg(Math.cos(a) * r * 0.26, Math.sin(a) * r * 0.26, 0, Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94, 0);
  }
  group.add(new Mesh(strokeGeometry(s.v, strokeWidth(kit)), I[material]));
  group.add(new Mesh(strokeGeometry(new Sketch().ring(r * 0.66, 0, 0, 0, 'z', 18).v, strokeWidth(kit) * 0.8), I.dim));
  return group;
}

function hall(kit) {
  const I = inks(kit);
  const G = glyphs(kit);
  const dark = kit.mode === 'dark';
  const W = strokeWidth(kit) * 1.25;
  const group = new Group();
  const s = new Sketch();

  group.add(solid(kit, new BoxGeometry(4.8, 0.16, 3.0), [0, 0.08, 0]));
  s.box(4.8, 0.16, 3.0, 0, 0.08, 0);
  group.add(solid(kit, new BoxGeometry(3.9, 3.3, 2.3), [0, 1.81, -0.1]));
  s.box(3.9, 3.3, 2.3, 0, 1.81, -0.1);
  group.add(solid(kit, new BoxGeometry(3.3, 0.32, 1.9), [0, 3.62, -0.1]));
  s.box(3.3, 0.32, 1.9, 0, 3.62, -0.1);
  group.add(solid(kit, new BoxGeometry(2.0, 0.22, 1.8), [0, 3.89, -0.1]));
  s.box(2.0, 0.22, 1.8, 0, 3.89, -0.1).ring(0.8, 0, 4.005, -0.1, 'y', 28).ring(0.84, 0, 4.005, -0.1, 'y', 28);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const x = side * (1.12 + i * 0.13);
      s.path([[x, 3.78, -0.9], [x, 4.12 - i * 0.06, -0.9], [x, 4.12 - i * 0.06, 0.7], [x, 3.78, 0.7]]);
    }
  }
  // I/O bay around the door
  group.add(solid(kit, new BoxGeometry(1.9, 1.62, 0.4), [0, 0.97, 1.25]));
  s.box(1.9, 1.62, 0.4, 0, 0.97, 1.25);
  s.rect(1.62, 1.42, 0, 0.87, 1.452);
  // front-face detail: corner ribs and a notch like a chip's pin-1 mark
  for (const x of [-1.95, 1.95]) s.seg(x * 0.93, 0.16, 1.06, x * 0.93, 3.46, 1.06);
  s.ring(0.14, -1.68, 3.22, 1.06, 'z', 12, Math.PI, TAU);
  group.add(new Mesh(strokeGeometry(s.v, W), I.ink));
  if (dark) group.add(new Mesh(strokeGeometry(s.v, W * 4), I.haze));

  // Pin grid on the socket's rim.
  const pins = new Flat();
  for (let x = -2.25; x <= 2.26; x += 0.2) {
    for (let z = -1.35; z <= 1.36; z += 0.2) {
      const inner = Math.abs(x) < 2.02 && Math.abs(z) < 1.3;
      if (inner || (Math.abs(x) < 1.05 && z > 1)) continue;
      pins.rect(0.07, 0.07, x, z);
    }
  }
  group.add(new Mesh(flatGeometry(pins.v, 0.022, 0.17), I.dim));
  const chase = [];
  const chaseGeo = new PlaneGeometry(0.11, 0.11);
  for (let i = 0; i < 7; i += 1) {
    const pin = new Mesh(chaseGeo, I.flash);
    pin.rotation.x = -Math.PI / 2;
    group.add(pin);
    chase.push(pin);
  }

  const fan = new Group();
  fan.position.set(0, 4.02, -0.1);
  const blades = new Sketch().ring(0.17, 0, 0, 0, 'y', 10);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU;
    const at = (r, turn) => [Math.cos(a + turn) * r, 0, Math.sin(a + turn) * r];
    blades.path([at(0.17, 0), at(0.45, 0.22), at(0.74, 0.5), at(0.74, 0.86), at(0.45, 0.62), at(0.17, 0.42)]);
  }
  fan.add(new Mesh(strokeGeometry(blades.v, W), I.ink));
  group.add(fan);

  // Tape reels either side of the bay.
  const spin = [[fan, 'y', -2.6]];
  for (const side of [-1, 1]) {
    const top = reel(kit, 0.36);
    top.position.set(side * 1.45, 1.6, 1.07);
    const bottom = reel(kit, 0.36);
    bottom.position.set(side * 1.45, 0.72, 1.07);
    group.add(top, bottom);
    spin.push([top, 'z', side * 3.4], [bottom, 'z', -side * 4.2]);
    const tape = new Sketch().seg(side * 1.09, 1.6, 1.075, side * 1.09, 0.72, 1.075);
    group.add(new Mesh(strokeGeometry(tape.v, W * 0.8), I.dim));
  }

  // The vector display.
  const screen = new Sketch().rect(3.5, 1.3, 0, 2.66, 1.07).rect(3.36, 1.16, 0, 2.66, 1.075);
  group.add(new Mesh(strokeGeometry(screen.v, W), I.ink));
  const grid = new Sketch();
  for (let i = 1; i < 8; i += 1) grid.seg(-1.68 + i * 0.42, 2.1, 1.08, -1.68 + i * 0.42, 3.22, 1.08);
  for (let i = 1; i < 4; i += 1) grid.seg(-1.68, 2.1 + i * 0.28, 1.08, 1.68, 2.1 + i * 0.28, 1.08);
  group.add(new Mesh(strokeGeometry(grid.v, W * 0.5), I.faint));
  const wave = dynamicRibbon(80, I.hot);
  group.add(wave);
  const flatten = new Group();
  flatten.position.set(1.0, 2.7, 1.1);
  flatten.scale.set(1, 1, 0.08);
  const spinner = new Group();
  const ico = new EdgesGeometry(new IcosahedronGeometry(0.42, 0));
  spinner.add(new Mesh(strokeGeometry(Array.from(ico.attributes.position.array), W * 0.9), I.ink));
  ico.dispose();
  flatten.add(spinner);
  group.add(flatten);
  const status = new Mesh(new PlaneGeometry(0.9, 0.34), G.run);
  status.position.set(-1.12, 3.0, 1.09);
  group.add(status);
  const flash = new Mesh(new PlaneGeometry(3.36, 1.16), new MeshBasicMaterial({
    color: kit.color('hot'), transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    blending: dark ? AdditiveBlending : undefined,
  }));
  flash.position.set(0, 2.66, 1.1);
  group.add(flash);

  // The beacon is the prompt's cursor: it blinks while the run waits on you.
  const prompt = new Sketch().path([[1.18, 1.98, 1.08], [1.3, 1.9, 1.08], [1.18, 1.82, 1.08]]);
  const beacon = kit.box(0.2, 0.3, 0.06, kit.beacon, [1.5, 1.9, 1.09]);
  group.add(new Mesh(strokeGeometry(prompt.v, W), I.ink), beacon);
  const cursorBox = new Sketch().rect(0.24, 0.34, 1.5, 1.9, 1.125);
  group.add(new Mesh(strokeGeometry(cursorBox.v, W * 0.7), I.ink));

  // Door: a shutter hinged at its top edge.
  group.add(solid(kit, new BoxGeometry(1.6, 1.4, 0.05), [0, 0.87, 1.4]));
  const door = new Mesh(new BoxGeometry(1.54, 1.38, 0.04), I.void);
  door.geometry.translate(0, -0.69, 0);
  door.position.set(0, 1.57, 1.47);
  const shutter = new Sketch().rect(1.5, 1.34, 0, -0.69, 0.03);
  for (let i = 0; i < 3; i += 1) {
    const y = -0.42 - i * 0.3;
    shutter.path([[-0.34, y - 0.12, 0.03], [0, y + 0.08, 0.03], [0.34, y - 0.12, 0.03]]);
  }
  door.add(new Mesh(strokeGeometry(shutter.v, W), I.ink));
  group.add(door);

  if (dark) {
    const glow = kit.halo('ink', 5.4, 2.4, { opacity: 0.16, at: [0, 2.66, 1.0], flat: false });
    group.add(glow);
    group.add(kit.halo('ink', 6.4, 4.2, { opacity: 0.12, at: [0, 0.01, 0.4] }));
  }

  const ripple = new Mesh(flatGeometry(new Flat().rect(4.9, 3.1, 0, 0).v, 0.04, 0.02), I.ink);
  ripple.visible = false;
  group.add(ripple);

  const state = { deliveryAt: -10, spawnAt: -10, main: 'idle', now: 0 };
  const perimeter = 2 * (4.5 + 2.7);
  const along = (d, pin) => {
    let left = ((d % perimeter) + perimeter) % perimeter;
    if (left < 4.5) return pin.position.set(-2.25 + left, 0.18, 1.35);
    left -= 4.5;
    if (left < 2.7) return pin.position.set(2.25, 0.18, 1.35 - left);
    left -= 2.7;
    if (left < 4.5) return pin.position.set(2.25 - left, 0.18, -1.35);
    left -= 4.5;
    return pin.position.set(-2.25, 0.18, -1.35 + left);
  };

  let mood = 'idle';
  let since = 0;
  const sample = u => {
    const t = state.now;
    const x = u * 12;
    const kick = Math.max(0, 1 - (t - state.deliveryAt) / 1.2);
    let y;
    if (mood === 'working') y = Math.sin(x * 1.9 + t * 5.5) * 0.18 + Math.sin(x * 5.3 - t * 9) * 0.07 + Math.sin(x * 11 + t * 17) * 0.03;
    else if (mood === 'waiting') {
      const beat = ((t * 0.45) % 1) * 1.3 - 0.15;
      const d = (u - beat) * 18;
      y = Math.abs(d) < 1 ? Math.sin(d * Math.PI) * 0.3 * (1 - Math.abs(d)) : 0;
    } else y = Math.sin(x * 0.9 + t * 0.6) * 0.06;
    y += kick * Math.sin(x * 7 - t * 20) * 0.32 * Math.sin(u * Math.PI);
    return 2.42 + y;
  };

  group.userData = {
    door, beacon, spin,
    chimney: new Vector3(0, 4.1, -0.1),
    labelY: 4.45,
    react(event) {
      if (event === 'delivery') state.deliveryAt = state.now;
      if (event === 'spawn' || event === 'send') state.spawnAt = state.now;
    },
    frame(time, dt, main, reducedMotion) {
      state.now = reducedMotion ? 2 : time;
      state.main = main?.state || 'idle';
      if (state.main !== mood) {
        mood = state.main;
        since = time;
      }
      const t = state.now;
      const working = mood === 'working';
      drawRibbon(wave, -1.62, 0.32, 1.09, W * 1.2, sample);
      if (!reducedMotion) {
        spinner.rotation.y += dt * (working ? 1.4 : 0.35);
        spinner.rotation.x = Math.sin(t * 0.37) * 0.5;
      } else spinner.rotation.set(0.4, 0.6, 0);
      const recv = t - state.deliveryAt < 1.6;
      const fork = t - state.spawnAt < 1.4;
      status.material = recv ? G.recv : fork ? G.fork : mood === 'working' ? G.run : mood === 'waiting' ? G.wait : mood === 'done' ? G.done : G.idle;
      status.visible = !(mood === 'waiting' && !recv && !fork && !reducedMotion) || Math.sin(time * 5) > -0.2;
      flash.material.opacity = reducedMotion ? 0 : Math.max(0, 1 - (t - state.deliveryAt) / 0.5) * (dark ? 0.35 : 0.25)
        + Math.max(0, 1 - (t - since) / 0.4) * 0.12;
      const ring = clamp01((t - state.deliveryAt) / 0.6);
      ripple.visible = !reducedMotion && ring < 1 && Math.sin(time * 40) > 0;
      ripple.scale.set(1 + ring * 0.12, 1, 1 + ring * 0.2);
      const speed = working ? 3.2 : 0.8;
      for (let i = 0; i < chase.length; i += 1) {
        along(t * speed - i * 0.2, chase[i]);
        chase[i].visible = !reducedMotion || i === 0;
      }
    },
  };
  return group;
}

// ---------- stations: components wired to the bus ----------

// The stub is in the station's own frame, where +z faces the aisle; it runs
// out the crate's outlet and turns into the gap the carrier drives along.
function stubPath(side) {
  return [[0, 0.7], [0, 1.05], [-side * 1.45, 1.05]];
}

function pointOn(path, u, out) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let left = clamp01(u) * total;
  for (let i = 1; i < path.length; i += 1) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i === path.length - 1) {
      const k = len ? Math.min(1, left / len) : 1;
      out.x = ax + (bx - ax) * k;
      out.z = az + (bz - az) * k;
      return out;
    }
    left -= len;
  }
  return out;
}

function makeContext(kit, face) {
  const I = inks(kit);
  const W = strokeWidth(kit);
  const ctx = {
    kit, I, W, face, wires: [], lampMat: kit.lamp(),
    solid(geometry, at, parent = face, both = false) {
      const mesh = solid(kit, geometry, at, both);
      parent.add(mesh);
      return mesh;
    },
    box(sketch, w, h, d, x, y, z, parent = face) {
      ctx.solid(new BoxGeometry(w, h, d), [x, y, z], parent);
      sketch.box(w, h, d, x, y, z);
    },
    cyl(sketch, r, h, x, y, z, parent = face, n = 12) {
      ctx.solid(new CylinderGeometry(r, r, h, n), [x, y, z], parent);
      sketch.cylinder(r, h, x, y, z, n);
    },
    wire(sketch, key = 'ink', parent = face, width = W) {
      const mesh = new Mesh(strokeGeometry(sketch.v, width), I[key]);
      mesh.userData.base = I[key];
      if (!ctx.wires.length && kit.mode === 'dark') parent.add(new Mesh(strokeGeometry(sketch.v, width * 4), I.haze));
      parent.add(mesh);
      ctx.wires.push(mesh);
      return mesh;
    },
    pads(flat, key = 'dim', parent = face) {
      const mesh = new Mesh(flatGeometry(flat.v, W * 0.9, 0.008), I[key]);
      parent.add(mesh);
      return mesh;
    },
    lamp(x, y, z, r = 0.11, parent = face) {
      const mesh = new Mesh(new SphereGeometry(r, 12, 8), ctx.lampMat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    },
  };
  return ctx;
}

// Two-link reach: sets shoulder and elbow so a wrist lands on (hx, hy).
function reach(shoulder, elbow, upper, fore, hx, hy) {
  const d = Math.min(upper + fore - 0.001, Math.max(0.05, Math.hypot(hx, hy)));
  const toward = Math.atan2(hx, hy);
  const inner = Math.acos(clamp01((upper * upper + d * d - fore * fore) / (2 * upper * d)));
  const bend = Math.acos(Math.max(-1, Math.min(1, (upper * upper + fore * fore - d * d) / (2 * upper * fore))));
  shoulder.rotation.z = -(toward - inner);
  elbow.rotation.z = -(Math.PI - bend);
}

function solderingArm(ctx) {
  const { I, face } = ctx;
  const s = new Sketch();
  ctx.box(s, 1.55, 0.16, 1.45, 0, 0.08, 0);
  ctx.box(s, 0.54, 0.1, 0.32, 0.3, 0.21, 0.28);
  for (let i = 0; i < 4; i += 1) {
    const x = 0.12 + i * 0.12;
    s.path([[x, 0.2, 0.12], [x, 0.17, 0.06]]).path([[x, 0.2, 0.44], [x, 0.17, 0.5]]);
  }
  s.ring(0.04, 0.08, 0.265, 0.2, 'y', 8);
  for (let i = 0; i < 6; i += 1) s.seg(-0.7, 0.161, -0.55 + i * 0.2, -0.35, 0.161, -0.55 + i * 0.2);
  ctx.cyl(s, 0.22, 0.2, -0.38, 0.26, -0.3);
  s.seg(-0.62, 0.16, 0.55, -0.62, 0.52, 0.55);
  ctx.wire(s);
  const lamp = ctx.lamp(-0.62, 0.6, 0.55);

  const waist = new Group();
  waist.position.set(-0.38, 0.36, -0.3);
  waist.rotation.y = -0.68;
  face.add(waist);
  const shoulder = new Group();
  waist.add(shoulder);
  const arm = new Sketch();
  ctx.box(arm, 0.13, 0.62, 0.13, 0, 0.31, 0, shoulder);
  arm.ring(0.09, 0, 0, 0, 'z', 10);
  ctx.wire(arm, 'ink', shoulder);
  const elbow = new Group();
  elbow.position.y = 0.62;
  shoulder.add(elbow);
  const fore = new Sketch();
  ctx.box(fore, 0.1, 0.5, 0.1, 0, 0.25, 0, elbow);
  fore.ring(0.075, 0, 0, 0, 'z', 10);
  ctx.wire(fore, 'ink', elbow);
  const wrist = new Group();
  wrist.position.y = 0.5;
  elbow.add(wrist);
  const iron = new Sketch().box(0.12, 0.1, 0.12, 0, 0.04, 0).seg(0, 0.09, 0, 0, 0.3, 0);
  ctx.wire(iron, 'amber', wrist);
  const tip = new Mesh(new BoxGeometry(0.05, 0.05, 0.05), I.flashAmber);
  tip.position.y = 0.31;
  wrist.add(tip);
  const sparkGeo = new BoxGeometry(0.035, 0.035, 0.035);
  const sparks = Array.from({ length: 4 }, () => {
    const spark = new Mesh(sparkGeo, I.flashAmber);
    wrist.add(spark);
    return spark;
  });

  return {
    lamp, top: 1.3, puff: [0.3, 0.45, 0.28],
    animate(t, live, state) {
      const dab = Math.max(0, Math.sin(t * 7.5));
      const hop = Math.floor(t * 1.2);
      waist.rotation.y = -0.68 + live * ((seeded(hop) - 0.5) * 0.34);
      const hx = 0.2 + live * 0.68;
      const hy = 0.72 - live * (0.58 - dab * 0.1);
      reach(shoulder, elbow, 0.62, 0.5, hx, hy);
      wrist.rotation.z = -Math.PI - shoulder.rotation.z - elbow.rotation.z;
      if (state === 'done' || state === 'stopped') wrist.rotation.z = -shoulder.rotation.z - elbow.rotation.z;
      const hot = live > 0.5 && dab < 0.35;
      tip.visible = live > 0.1;
      for (let i = 0; i < sparks.length; i += 1) {
        sparks[i].visible = hot;
        if (hot) sparks[i].position.set((seeded(t * 31 + i) - 0.5) * 0.24, 0.33 + seeded(t * 17 + i) * 0.12, (seeded(t * 13 + i) - 0.5) * 0.24);
      }
    },
  };
}

function tapeDrive(ctx) {
  const { I, face } = ctx;
  const s = new Sketch();
  ctx.box(s, 1.36, 1.5, 0.78, 0, 0.75, -0.2);
  s.rect(1.2, 0.95, 0, 1.03, 0.195).rect(1.2, 0.36, 0, 0.3, 0.195);
  for (let i = 0; i < 5; i += 1) s.seg(-0.5 + i * 0.25, 1.51, -0.5, -0.5 + i * 0.25, 1.51, 0.1);
  s.path([[-0.58, 0.8, 0.2], [-0.24, 0.62, 0.2], [0.24, 0.62, 0.2], [0.58, 0.8, 0.2]]);
  s.rect(0.2, 0.1, 0, 0.62, 0.2);
  ctx.wire(s);
  const reels = [-0.32, 0.32].map(x => {
    const r = reel(ctx.kit, 0.27);
    r.position.set(x, 1.08, 0.21);
    face.add(r);
    return r;
  });
  const meters = [];
  const meterGeo = new BoxGeometry(0.5, 0.06, 0.02);
  meterGeo.translate(0.25, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const bar = new Mesh(meterGeo, I.amber);
    bar.position.set(-0.52, 0.36 - i * 0.12, 0.21);
    face.add(bar);
    meters.push(bar);
  }
  const buttons = new Sketch();
  for (let i = 0; i < 3; i += 1) buttons.rect(0.1, 0.08, 0.2 + i * 0.14, 0.3, 0.205);
  ctx.wire(buttons, 'dim');
  const lamp = ctx.lamp(0.5, 1.6, 0.05);
  return {
    lamp, top: 1.62, puff: [-0.3, 1.6, -0.3],
    animate(t, live, state, dt) {
      reels[0].rotation.z += dt * live * 5.5;
      reels[1].rotation.z += dt * live * 4.1;
      for (let i = 0; i < meters.length; i += 1) {
        const level = state === 'done' ? 1 : live * (0.35 + 0.6 * Math.abs(Math.sin(t * (7 + i * 3.1) + i)));
        meters[i].scale.x = Math.max(0.04, level);
      }
    },
  };
}

function scopeGrid(kit) {
  return memo(kit, 'scopeGrid', () => new MeshBasicMaterial({
    map: kit.canvas(128, 96, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      for (let x = 0; x <= 8; x += 1) { ctx.beginPath(); ctx.moveTo(x * (w - 2) / 8 + 1, 0); ctx.lineTo(x * (w - 2) / 8 + 1, h); ctx.stroke(); }
      for (let y = 0; y <= 6; y += 1) { ctx.beginPath(); ctx.moveTo(0, y * (h - 2) / 6 + 1); ctx.lineTo(w, y * (h - 2) / 6 + 1); ctx.stroke(); }
    }),
    color: kit.color('dim'), transparent: true, depthWrite: false, toneMapped: false,
  }));
}

function oscilloscope(ctx) {
  const { I, face, kit } = ctx;
  const s = new Sketch();
  ctx.box(s, 1.5, 1.0, 0.95, 0, 0.5, -0.15);
  s.rect(0.98, 0.72, -0.2, 0.55, 0.33);
  for (const y of [0.78, 0.55, 0.32]) s.ring(0.07, 0.5, y, 0.33, 'z', 10).seg(0.5, y, 0.33, 0.5, y + 0.07, 0.33);
  s.path([[-0.6, 1.0, -0.3], [-0.5, 1.2, -0.3], [0.5, 1.2, -0.3], [0.6, 1.0, -0.3]]);
  s.path([[0.62, 0.12, 0.33], [0.72, 0.06, 0.6], [0.5, 0.02, 0.8]]);
  ctx.box(s, 0.3, 0.06, 0.2, 0.3, 0.03, 0.78);
  ctx.wire(s);
  const graticule = new Mesh(new PlaneGeometry(0.9, 0.64), scopeGrid(kit));
  graticule.position.set(-0.2, 0.55, 0.335);
  face.add(graticule);
  const trace = dynamicRibbon(44, I.hot);
  face.add(trace);
  const knob = new Mesh(strokeGeometry(new Sketch().seg(0, 0, 0, 0, 0.07, 0).v, ctx.W), I.amber);
  knob.position.set(0.5, 0.55, 0.34);
  face.add(knob);
  const lamp = ctx.lamp(0.55, 1.05, 0.15);
  let mode = 'running';
  let clock = 0;
  let live = 1;
  const sample = u => {
    const x = u * TAU * 2;
    if (mode === 'failed') return 0.55 + (seeded(Math.floor(clock * 20) + u * 40) - 0.5) * 0.4;
    if (mode === 'done') return 0.55 + Math.sin(x) * 0.18;
    if (mode !== 'running') return 0.55;
    return 0.55 + live * (Math.sin(x * 1.5 - clock * 7) * 0.16 + Math.sin(x * 4.2 + clock * 3) * 0.06);
  };
  return {
    lamp, top: 1.22, puff: [-0.5, 1.05, -0.4],
    animate(t, a, state) {
      mode = state;
      clock = t;
      live = a;
      drawRibbon(trace, -0.62, 0.22, 0.34, ctx.W * 1.4, sample);
      trace.material = state === 'failed' ? I.fail : I.hot;
      knob.rotation.z = -t * 1.5 * a;
    },
  };
}

function radarDish(ctx) {
  const { I, face } = ctx;
  const s = new Sketch();
  ctx.box(s, 0.7, 0.24, 0.7, -0.2, 0.12, -0.3);
  s.seg(-0.2, 0.24, -0.3, -0.2, 0.78, -0.3).seg(-0.32, 0.24, -0.42, -0.2, 0.7, -0.3).seg(-0.08, 0.24, -0.18, -0.2, 0.7, -0.3);
  ctx.wire(s);
  const yaw = new Group();
  yaw.position.set(-0.2, 0.8, -0.3);
  face.add(yaw);
  const tilt = new Group();
  tilt.rotation.x = 0.8;
  yaw.add(tilt);
  const dish = new Sketch();
  const rings = [[0.6, 0.24], [0.42, 0.11], [0.22, 0.03]];
  for (const [r, depth] of rings) dish.ring(r, 0, depth, 0, 'y', 18);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU;
    dish.path([[0, 0, 0], ...rings.slice().reverse().map(([r, depth]) => [Math.cos(a) * r, depth, Math.sin(a) * r])]);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + 0.5;
    dish.seg(Math.cos(a) * 0.6, 0.24, Math.sin(a) * 0.6, 0, 0.62, 0);
  }
  ctx.solid(new CylinderGeometry(0.58, 0.05, 0.23, 18, 1, true), [0, 0.12, 0], tilt, true);
  ctx.wire(dish, 'ink', tilt);
  const feed = new Mesh(new BoxGeometry(0.08, 0.08, 0.08), I.flashAmber);
  feed.position.y = 0.62;
  tilt.add(feed);

  const scope = new Group();
  scope.position.set(0.42, 0.012, 0.5);
  face.add(scope);
  const marks = new Flat().ring(0.36, 0, 0, 20).ring(0.2, 0, 0, 16).seg(-0.4, 0, 0.4, 0).seg(0, -0.4, 0, 0.4);
  scope.add(new Mesh(flatGeometry(marks.v, ctx.W, 0), I.dim));
  const sweep = new Mesh(flatGeometry(new Flat().seg(0, 0, 0.36, 0).v, ctx.W * 1.6, 0.004), I.hot);
  scope.add(sweep);
  const blips = [0.7, 2.6, 4.4].map((a, i) => {
    const blip = new Mesh(new PlaneGeometry(0.07, 0.07), I.flash);
    blip.rotation.x = -Math.PI / 2;
    blip.position.set(Math.cos(a) * (0.12 + i * 0.09), 0.006, -Math.sin(a) * (0.12 + i * 0.09));
    blip.userData.angle = a;
    scope.add(blip);
    return blip;
  });
  const lamp = ctx.lamp(-0.62, 0.38, 0.35);
  ctx.solid(new BoxGeometry(0.08, 0.3, 0.08), [-0.62, 0.15, 0.35]);
  ctx.wire(new Sketch().box(0.08, 0.3, 0.08, -0.62, 0.15, 0.35));
  let heading = 0;
  return {
    lamp, top: 1.45, puff: [-0.2, 0.3, -0.3],
    animate(t, live, state, dt) {
      heading += dt * live * 1.6;
      yaw.rotation.y = heading;
      tilt.rotation.x = 0.8 + live * Math.sin(t * 0.9) * 0.15;
      const angle = (t * 2.4) % TAU;
      sweep.rotation.y = live > 0.05 ? angle : 0.8;
      for (const blip of blips) {
        const behind = (angle - blip.userData.angle + TAU) % TAU;
        blip.visible = live > 0.05 ? behind < 1.6 : state === 'done';
      }
    },
  };
}

function ledSprite(ctx) {
  const { face } = ctx;
  const s = new Sketch();
  s.ring(0.17, 0, 0.2, 0, 'y', 14);
  s.seg(-0.06, 0.2, 0, -0.06, 0.012, 0.08).seg(0.06, 0.2, 0, 0.06, 0.012, 0.16);
  ctx.wire(s);
  const pads = new Flat().rect(0.1, 0.1, -0.06, 0.08).rect(0.1, 0.1, 0.06, 0.16).rect(0.9, 0.9, 0, 0.1);
  ctx.pads(pads);
  const lamp = new Mesh(new CylinderGeometry(0.13, 0.13, 0.28, 12), ctx.lampMat);
  lamp.position.set(0, 0.34, 0);
  face.add(lamp);
  const dome = new Mesh(new SphereGeometry(0.13, 12, 6, 0, TAU, 0, Math.PI / 2), ctx.lampMat);
  dome.position.set(0, 0.48, 0);
  face.add(dome);

  const bot = new Group();
  bot.scale.setScalar(1.7);
  face.add(bot);
  const sprite = new Group();
  sprite.rotation.x = -0.55;
  bot.add(sprite);
  const b = new Sketch();
  b.rect(0.24, 0.2, 0, 0.22, 0).rect(0.05, 0.05, -0.05, 0.24, 0.002).rect(0.05, 0.05, 0.05, 0.24, 0.002);
  b.seg(0, 0.32, 0, 0, 0.4, 0).ring(0.025, 0, 0.42, 0, 'z', 6);
  b.path([[-0.08, 0.12, 0], [-0.1, 0.02, 0]]).path([[0.08, 0.12, 0], [0.1, 0.02, 0]]);
  b.path([[-0.12, 0.2, 0], [-0.2, 0.26, 0]]).path([[0.12, 0.2, 0], [0.2, 0.26, 0]]);
  ctx.solid(new PlaneGeometry(0.24, 0.2), [0, 0.22, -0.005], sprite);
  ctx.wire(b, 'hot', sprite);
  return {
    lamp, occupants: [bot], top: 0.85, puff: [0, 0.6, 0],
    animate(t, live, state) {
      if (state === 'failed') {
        bot.position.set(0.36, 0.02, 0.3);
        bot.rotation.set(0, 0, -1.45);
        return;
      }
      const hop = Math.abs(Math.sin(t * 4)) * 0.18 * live;
      bot.position.set(0.36 + Math.sin(t * 1.3) * 0.08 * live, 0.18 * live + hop, 0.3);
      bot.rotation.set(0, 0, Math.sin(t * 4) * 0.2 * live);
    },
  };
}

function capacitor(ctx) {
  const { I, face } = ctx;
  const s = new Sketch();
  ctx.cyl(s, 0.21, 0.6, -0.25, 0.32, -0.05, face, 14);
  s.seg(-0.25, 0.62, -0.17, -0.25, 0.62, 0.07).seg(-0.37, 0.62, -0.05, -0.13, 0.62, -0.05);
  s.seg(-0.31, 0.02, -0.05, -0.31, 0.012, 0.25).seg(-0.19, 0.02, -0.05, -0.19, 0.012, 0.25);
  s.box(0.3, 0.05, 0.3, 0.3, 0.025, 0);
  ctx.wire(s);
  const stripe = new Sketch().seg(-0.25, 0.08, 0.16, -0.25, 0.56, 0.16).seg(-0.23, 0.42, 0.16, -0.27, 0.42, 0.16);
  ctx.wire(stripe, 'amber');
  ctx.pads(new Flat().rect(0.1, 0.1, -0.31, 0.27).rect(0.1, 0.1, -0.19, 0.27).rect(1.05, 0.8, 0, 0.05));
  const cells = [];
  const cellGeo = new BoxGeometry(0.22, 0.06, 0.06);
  for (let i = 0; i < 6; i += 1) {
    const cell = new Mesh(cellGeo, I.faint);
    cell.position.set(0.3, 0.1 + i * 0.085, 0);
    face.add(cell);
    cells.push(cell);
  }
  const zap = new Mesh(strokeGeometry(new Sketch().path([[-0.1, 0.64, 0], [0.02, 0.7, 0], [0.06, 0.62, 0], [0.18, 0.7, 0]]).v, ctx.W), I.flash);
  face.add(zap);
  const lamp = ctx.lamp(0.3, 0.7, 0);
  return {
    lamp, top: 0.85, puff: [-0.25, 0.7, -0.05],
    animate(t, live, state) {
      const cycle = (t * 0.55) % 1;
      let level = Math.floor(cycle * 7.5) * live;
      if (state === 'done') level = 6;
      else if (state === 'stopped' || state === 'unknown') level = 0;
      for (let i = 0; i < cells.length; i += 1) {
        if (state === 'failed') cells[i].material = seeded(Math.floor(t * 9) + i) > 0.5 ? I.fail : I.faint;
        else cells[i].material = i < level ? (state === 'done' ? I.ok : i >= 4 ? I.amber : I.ink) : I.faint;
      }
      zap.visible = live > 0.5 && cycle > 0.88;
    },
  };
}

function terminalText(kit) {
  return memo(kit, 'terminalText', () => new MeshBasicMaterial({
    map: kit.canvas(256, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 23px ${MONO}`;
      ctx.textBaseline = 'middle';
      ['$ grep -rn todo', '$ make check', '  ok 42 tests', '$ diff -u a b'].forEach((line, i) => {
        for (let c = 0; c < line.length; c += 1) ctx.fillText(line[c], 4 + c * 15.5, 16 + i * 32);
      });
    }),
    color: kit.color('hot'), transparent: true, depthWrite: false, toneMapped: false,
  }));
}

function miniTerminal(ctx) {
  const { I, face, kit } = ctx;
  const base = new Sketch();
  ctx.box(base, 0.24, 0.2, 0.2, 0, 0.1, -0.2);
  ctx.box(base, 0.8, 0.05, 0.26, 0, 0.025, 0.34);
  for (let r = 0; r < 3; r += 1) base.seg(-0.32, 0.052, 0.26 + r * 0.07, 0.32, 0.052, 0.26 + r * 0.07);
  ctx.wire(base);
  const monitor = new Group();
  monitor.position.set(0, 0.2, -0.2);
  monitor.rotation.x = -0.32;
  face.add(monitor);
  const s = new Sketch();
  ctx.box(s, 0.84, 0.62, 0.48, 0, 0.31, 0, monitor);
  s.rect(0.72, 0.46, 0, 0.31, 0.245);
  ctx.wire(s, 'ink', monitor);
  const text = new Mesh(new PlaneGeometry(0.64, 0.32), terminalText(kit));
  text.position.set(0, 0.31, 0.25);
  monitor.add(text);
  const coverGeo = new PlaneGeometry(1, 1);
  coverGeo.translate(0.5, -0.5, 0);
  const coverLine = new Mesh(coverGeo, I.void);
  const coverBelow = new Mesh(coverGeo, I.void);
  monitor.add(coverLine, coverBelow);
  const cursor = new Mesh(new BoxGeometry(0.035, 0.065, 0.01), I.flash);
  monitor.add(cursor);
  const lamp = ctx.lamp(0.3, 0.55, 0.12, 0.09, monitor);
  lamp.position.set(0.3, 0.68, 0.0);
  const left = -0.32; const topY = 0.47; const lineH = 0.08; const charW = 0.0388;
  const chars = 15;
  const z = 0.255;
  return {
    lamp, top: 0.95, puff: [0, 0.85, -0.4],
    animate(t, live, state) {
      let typed = 4 * chars;
      if (state === 'running') typed = Math.floor(((t * 9) % (4 * chars + 14)));
      else if (state === 'failed') typed = Math.floor(2.4 * chars);
      else if (state === 'stopped' || state === 'unknown') typed = Math.floor(1.6 * chars);
      typed = Math.min(typed, 4 * chars);
      const line = Math.min(3, Math.floor(typed / chars));
      const col = typed >= 4 * chars ? chars : typed % chars;
      const x = left + col * charW;
      const y = topY - line * lineH;
      coverLine.visible = typed < 4 * chars;
      coverLine.position.set(x, y + 0.002, z);
      coverLine.scale.set(Math.max(0.001, -left + 0.02 - col * charW), lineH, 1);
      coverBelow.visible = line < 3 && typed < 4 * chars;
      coverBelow.position.set(left - 0.01, y - lineH + 0.002, z);
      coverBelow.scale.set(0.66, Math.max(0.001, (3 - line) * lineH), 1);
      cursor.position.set(Math.min(x + 0.02, 0.31), y - lineH / 2, z + 0.005);
      cursor.visible = Math.sin(t * 8) > -0.2 || live > 0.5;
      cursor.material = state === 'failed' ? I.fail : I.flash;
    },
  };
}

function logicProbe(ctx) {
  const { I, face } = ctx;
  const s = new Sketch();
  ctx.box(s, 0.72, 0.13, 0.34, 0.05, 0.1, 0.12);
  s.ring(0.05, -0.24, 0.166, 0.12, 'y', 8, 0, Math.PI);
  for (let i = 0; i < 5; i += 1) {
    const x = -0.19 + i * 0.12;
    s.path([[x, 0.08, -0.05], [x, 0.04, -0.09], [x, 0.012, -0.09]]).path([[x, 0.08, 0.29], [x, 0.04, 0.33], [x, 0.012, 0.33]]);
  }
  ctx.box(s, 0.42, 0.34, 0.26, -0.3, 0.3, -0.5);
  s.rect(0.34, 0.2, -0.3, 0.32, -0.369);
  ctx.wire(s);
  const pads = new Flat();
  for (let i = 0; i < 5; i += 1) pads.rect(0.07, 0.07, -0.19 + i * 0.12, -0.09).rect(0.07, 0.07, -0.19 + i * 0.12, 0.33);
  ctx.pads(pads);
  const wave = dynamicRibbon(26, I.hot);
  face.add(wave);
  const probe = new Group();
  face.add(probe);
  const pen = new Sketch();
  ctx.cyl(pen, 0.045, 0.46, 0, 0.3, 0, probe, 8);
  pen.seg(0, 0.07, 0, 0, 0, 0).seg(0, 0.53, 0, -0.1, 0.62, -0.1);
  ctx.wire(pen, 'ink', probe);
  const tip = new Mesh(new BoxGeometry(0.04, 0.04, 0.04), I.flashAmber);
  probe.add(tip);
  const lamp = ctx.lamp(-0.3, 0.55, -0.5, 0.09);
  let level = 0;
  let clock = 0;
  const sample = u => {
    const bit = seeded(Math.floor(u * 8 + clock * 4)) > 0.5 ? 1 : 0;
    return 0.27 + (bit * 0.1) * level;
  };
  return {
    lamp, top: 0.95, puff: [-0.3, 0.5, -0.5],
    animate(t, live, state) {
      const pin = Math.floor(t * 1.6) % 5;
      const dip = Math.max(0, Math.sin(t * 1.6 * TAU)) * live;
      probe.position.set(-0.19 + pin * 0.12 * live + (1 - live) * 0.45, 0.06 + (1 - dip) * 0.12 + (1 - live) * 0.1, 0.33 * live + (1 - live) * 0.35);
      probe.rotation.z = (1 - live) * 0.25;
      tip.visible = dip > 0.6;
      level = state === 'running' ? live : state === 'done' ? 1 : 0;
      clock = state === 'running' ? t : 0;
      drawRibbon(wave, -0.44, -0.16, -0.364, ctx.W * 1.2, sample);
      wave.material = state === 'failed' ? I.fail : I.hot;
    },
  };
}

const WORKERS = [solderingArm, tapeDrive, oscilloscope, radarDish];
const HELPERS = [ledSprite, capacitor, miniTerminal, logicProbe];

function station(kit, kind, spot = {}) {
  const side = spot.side < 0 ? -1 : 1;
  const index = spot.index ?? 0;
  const salt = (spot.slot ?? index) + 1;
  const I = inks(kit);
  const G = glyphs(kit);
  const group = new Group();
  const face = new Group();
  // Turned so the face looks at the camera whichever side of the aisle it stands.
  face.rotation.y = side * Math.PI / 2;
  group.add(face);
  const ctx = makeContext(kit, face);
  const part = (kind === 'worker' ? WORKERS : HELPERS)[index % 4](ctx);
  const size = kind === 'worker' ? 1.12 : 1.22;
  face.scale.setScalar(size);
  if (index >= 4) face.scale.x = -size;
  part.top *= size;

  const path = stubPath(side);
  const stub = new Flat().path(path).ring(0.09, path[2][0], path[2][1], 10).rect(0.16, 0.16, path[0][0], path[0][1]);
  const trace = new Mesh(flatGeometry(stub.v, 0.06, 0.01), I.trace);
  group.add(trace);
  const pulse = new Mesh(new PlaneGeometry(0.16, 0.16), I.flash);
  pulse.rotation.x = -Math.PI / 2;
  pulse.visible = false;
  group.add(pulse);
  const via = new Mesh(flatGeometry(new Flat().ring(0.2, 0, 0, 14).v, 0.04, 0.012), I.flash);
  via.position.set(path[2][0], 0, path[2][1]);
  via.visible = false;
  group.add(via);

  const glyph = new Mesh(new PlaneGeometry(0.78, 0.29), G.ok);
  glyph.position.set(0, part.top + 0.24, 0.3);
  glyph.rotation.x = -0.6;
  glyph.visible = false;
  face.add(glyph);

  const at = { x: 0, z: 0 };
  let clock = 0;
  let heardAt = -10;
  const puff = new Vector3(...part.puff).multiplyScalar(size).applyAxisAngle(new Vector3(0, 1, 0), face.rotation.y);
  let glitched = false;

  group.userData = {
    lamp: part.lamp,
    occupants: part.occupants || [],
    puff,
    labelY: part.top + 0.72,
    react(event) {
      if (event === 'instructions') heardAt = clock;
    },
    frame(time, dt, st) {
      clock = time;
      const reduced = kit.reducedMotion;
      const state = st.state;
      const running = state === 'running';
      const live = reduced ? (running ? 1 : 0) : st.activity;
      const t = reduced ? 0.7 + salt * 0.37 : time;
      part.animate(t, live, state, reduced ? 0 : dt);

      const done = state === 'done';
      const failed = state === 'failed';
      const resting = state === 'stopped' || state === 'unknown';
      trace.material = failed ? I.fail : done ? I.ok : running ? I.trace : I.dim;
      const doneAge = done ? (reduced || st.doneAt === -Infinity || st.doneAt == null ? 99 : time - st.doneAt) : 99;
      // The trace carries a pulse only for a real hand-off: in from the bus as
      // instructions arrive, out to it as the result leaves.
      const heardAge = reduced ? 99 : time - heardAt;
      if (heardAge < 0.5) {
        pulse.visible = true;
        pulse.material = I.flashAmber;
        pointOn(path, 1 - heardAge / 0.5, at);
      } else if (done && doneAge < 1.1) {
        pulse.visible = true;
        pulse.material = I.flash;
        pointOn(path, doneAge / 1.1, at);
      } else pulse.visible = false;
      if (pulse.visible) pulse.position.set(at.x, 0.02, at.z);
      const ripple = (doneAge - 1.1) / 0.7;
      via.visible = done && ripple > 0 && ripple < 1;
      if (via.visible) via.scale.setScalar(0.4 + ripple * 1.4);

      glyph.visible = done || failed || resting;
      if (done) {
        glyph.material = G.ok;
        const pop = clamp01(doneAge / 0.45);
        glyph.scale.setScalar(Math.max(0.001, back(pop)));
        glyph.position.y = part.top + 0.24 - (1 - pop) * 0.3;
      } else if (failed) {
        glyph.material = G.err;
        glyph.scale.setScalar(1);
        glyph.position.y = part.top + 0.24;
      } else if (resting) {
        glyph.material = G.halt;
        glyph.scale.setScalar(0.8);
        glyph.position.y = part.top + 0.2;
      }

      if (failed) {
        glitched = true;
        const k = reduced ? 3 : Math.floor(time * 11);
        for (let i = 0; i < ctx.wires.length; i += 1) {
          const mesh = ctx.wires[i];
          const h = seeded(k * 13.7 + i * 7.1 + salt);
          mesh.visible = i === 0 || h > 0.3;
          mesh.material = h > 0.62 ? I.fail : mesh.userData.base;
        }
        const jolt = !reduced && seeded(k * 3.3 + salt) > 0.55;
        face.position.set(jolt ? (seeded(k * 5.1) - 0.5) * 0.14 : 0, 0, jolt ? (seeded(k * 9.7) - 0.5) * 0.08 : 0);
        face.scale.y = size * (jolt ? 1 + (seeded(k * 11.3) - 0.5) * 0.35 : 1);
        face.scale.z = size * (jolt ? 1 + (seeded(k * 2.9) - 0.5) * 0.2 : 1);
      } else {
        if (glitched) {
          face.position.set(0, 0, 0);
          face.scale.y = face.scale.z = size;
          glitched = false;
        }
        for (const mesh of ctx.wires) {
          mesh.visible = true;
          mesh.material = resting ? I.dim : mesh.userData.base;
        }
      }
    },
  };
  return group;
}

function ghost(kit, kind) {
  const I = inks(kit);
  const group = new Group();
  const [w, d, h] = kind === 'worker' ? [1.5, 1.4, 1.1] : [1.0, 0.9, 0.7];
  const footprint = new Flat();
  footprint.dashed(-w / 2, -d / 2, w / 2, -d / 2, 0.12, 0.1).dashed(w / 2, -d / 2, w / 2, d / 2, 0.12, 0.1)
    .dashed(w / 2, d / 2, -w / 2, d / 2, 0.12, 0.1).dashed(-w / 2, d / 2, -w / 2, -d / 2, 0.12, 0.1);
  group.add(new Mesh(flatGeometry(footprint.v, 0.035, 0.012), I.ink));
  const frame = new Sketch();
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
    for (let y = 0; y < h; y += 0.2) frame.seg(x, y, z, x, Math.min(h, y + 0.1), z);
  }
  frame.rect(w, d, 0, h, 0);
  const top = new Mesh(strokeGeometry(frame.v, 0.02), I.dim);
  group.add(top);
  return group;
}

// ---------- carrier and crate ----------

function crate(kit) {
  const I = inks(kit);
  const group = new Group();
  const page = new Group();
  page.rotation.x = -0.45;
  group.add(page);
  const s = new Sketch().path([[-0.17, -0.22, 0.04], [0.17, -0.22, 0.04], [0.17, 0.12, 0.04], [0.07, 0.22, 0.04], [-0.17, 0.22, 0.04]], true);
  s.path([[0.07, 0.22, 0.04], [0.07, 0.12, 0.04], [0.17, 0.12, 0.04]]);
  for (let i = 0; i < 4; i += 1) s.seg(-0.11, 0.08 - i * 0.075, 0.045, i === 3 ? 0.02 : 0.11, 0.08 - i * 0.075, 0.045);
  s.path([[-0.17, -0.22, -0.04], [0.17, -0.22, -0.04], [0.17, 0.12, -0.04], [0.07, 0.22, -0.04], [-0.17, 0.22, -0.04]], true);
  page.add(solid(kit, new BoxGeometry(0.34, 0.44, 0.08), [0, 0, 0]));
  page.add(new Mesh(strokeGeometry(s.v, strokeWidth(kit) * 0.9), I.ink));
  return group;
}

function carrier(kit) {
  const I = inks(kit);
  const dark = kit.mode === 'dark';
  const object = new Group();
  const body = new Group();
  object.add(body);
  body.add(solid(kit, new BoxGeometry(0.34, 0.2, 0.52), [0, 0.12, 0]));
  body.add(new Mesh(strokeGeometry(new Sketch().box(0.34, 0.2, 0.52, 0, 0.12, 0).v, strokeWidth(kit) * 1.2), I.ink));
  const core = new Mesh(new BoxGeometry(0.2, 0.22, 0.36), I.flash);
  core.position.y = 0.12;
  body.add(core);
  const trail = [0.42, 0.68, 0.92].map((z, i) => {
    const bit = new Mesh(new PlaneGeometry(0.22 - i * 0.04, 0.16), I.flash);
    bit.rotation.x = -Math.PI / 2;
    bit.position.set(0, 0.02, -z);
    object.add(bit);
    return bit;
  });
  if (dark) object.add(kit.halo('ink', 1.2, 1.6, { opacity: 0.3, at: [0, 0.015, -0.2] }));
  const hold = new Group();
  hold.position.y = 0.5;
  object.add(hold);
  return {
    object, hold, route: 'ground', cruise: 0,
    pose(target, { time, speed }) {
      body.position.y = Math.abs(Math.sin(time * 9)) * 0.03;
      core.visible = Math.sin(time * 14) > -0.6;
      for (let i = 0; i < trail.length; i += 1) trail[i].visible = speed > 0.08 && Math.sin(time * 20 - i * 1.7) > -0.3;
    },
  };
}

function dock(kit) {
  const I = inks(kit);
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  const f = new Flat().rect(1.95, 1.45, 0, 0);
  for (const [x, z] of [[-1.05, -0.8], [1.05, -0.8], [-1.05, 0.8], [1.05, 0.8]]) {
    f.seg(x, z, x - Math.sign(x) * 0.18, z).seg(x, z, x, z - Math.sign(z) * 0.18);
  }
  for (let i = 0; i < 3; i += 1) f.rect(0.4, 0.4, -0.55 + i * 0.55, -0.27).rect(0.4, 0.4, -0.55 + i * 0.55, 0.28);
  group.add(new Mesh(flatGeometry(f.v, 0.03, 0.008), I.dim));
  group.add(new Mesh(flatGeometry(new Flat().seg(-2.4, 0.2, -0.98, 0.2).seg(-2.4, -0.2, -0.98, -0.2).v, 0.05, 0.006), I.trace));
  return group;
}

// ---------- surroundings ----------

function decor(kit) {
  const I = inks(kit);
  const W = strokeWidth(kit) * 1.4;
  const group = new Group();
  const s = new Sketch();
  const add = (geometry, at) => group.add(solid(kit, geometry, at));
  // memory modules behind the hall
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      const x = side * (4.6 + i * 0.85);
      add(new BoxGeometry(0.14, 1.7, 3.4), [x, 0.95, -10.2]);
      s.box(0.14, 1.7, 3.4, x, 0.95, -10.2);
      s.box(0.36, 0.2, 3.7, x, 0.1, -10.2);
      for (let c = 0; c < 4; c += 1) s.box(0.16, 0.42, 0.62, x, 1.15, -11.4 + c * 0.8);
    }
  }
  // electrolytic cans and a coil at the board's sides
  for (const [x, z, r, h] of [[-11.4, -3.2, 0.62, 1.7], [-12.2, -1.2, 0.48, 1.3], [11.6, 6.2, 0.7, 1.9], [12.4, 8.4, 0.5, 1.2]]) {
    add(new CylinderGeometry(r, r, h, 16), [x, h / 2, z]);
    s.cylinder(r, h, x, h / 2, z, 16, 6);
    s.seg(x - r * 0.7, h + 0.005, z, x + r * 0.7, h + 0.005, z).seg(x, h + 0.005, z - r * 0.7, x, h + 0.005, z + r * 0.7);
  }
  for (let i = 0; i < 9; i += 1) s.ring(0.55, -11.5 + i * 0.18, 0.6, 6.4, 'x', 14);
  s.seg(-11.6, 0.6, 6.4, -11.5, 0.6, 6.4);
  // a heat sink
  for (let i = 0; i < 8; i += 1) {
    const z = -2.6 + i * 0.3;
    s.path([[11.0, 0.05, z], [11.0, 1.5, z], [12.6, 1.5, z], [12.6, 0.05, z]]);
  }
  add(new BoxGeometry(1.7, 0.2, 2.4), [11.8, 0.1, -1.55]);
  s.box(1.7, 0.2, 2.4, 11.8, 0.1, -1.55);
  group.add(new Mesh(strokeGeometry(s.v, W), I.dim));
  return group;
}

function weather(kit) {
  const dark = kit.mode === 'dark';
  const object = new Group();
  const columns = [0, 1, 2].map(variant => kit.canvas(64, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `bold 36px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows = 13;
    for (let i = 0; i < rows; i += 1) {
      const fade = (i + 1) / rows;
      ctx.fillStyle = i === rows - 1 ? '#ffffff' : `rgba(255,255,255,${(fade * fade * 0.8).toFixed(3)})`;
      const glyph = '01<>{}#$%&*+=/ABCDEF'[Math.floor(seeded(variant * 50 + i) * 21)];
      ctx.fillText(glyph, w / 2, (i + 0.5) * (h / rows));
    }
  }));
  const materials = columns.map(map => {
    const material = new MeshBasicMaterial({
      map, color: kit.color('ink'), transparent: true, opacity: dark ? 0.7 : 0.4, depthWrite: false, toneMapped: false,
    });
    if (dark) material.blending = AdditiveBlending;
    return material;
  });
  const geometry = new PlaneGeometry(0.42, 3.4);
  const drops = [];
  for (let i = 0; i < 40; i += 1) {
    const behind = i < 24;
    const sideways = i % 2 ? 1 : -1;
    const x = behind ? -14 + seeded(i * 3.3) * 28 : sideways * (10.4 + seeded(i * 5.1) * 3);
    const z = behind ? -8.8 - seeded(i * 7.7) * 4 : -6 + seeded(i * 2.2) * 15;
    const drop = new Mesh(geometry, materials[i % 3]);
    drop.position.set(x, 0, z);
    drop.rotation.x = -0.35;
    object.add(drop);
    drops.push({ drop, speed: 1.4 + seeded(i * 9.1) * 1.8, offset: seeded(i * 4.4) * 9, top: behind ? 9 : 6 });
  }
  const sweep = new Group();
  const beam = (depth, opacity) => {
    const material = new MeshBasicMaterial({
      color: kit.color('ink'), transparent: true, opacity, depthWrite: false, toneMapped: false,
    });
    if (dark) material.blending = AdditiveBlending;
    const mesh = new Mesh(new PlaneGeometry(24, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.z = -depth / 2;
    return mesh;
  };
  sweep.add(beam(0.06, dark ? 0.55 : 0.4), beam(0.7, dark ? 0.07 : 0.05));
  sweep.position.y = 0.03;
  sweep.visible = false;
  object.add(sweep);
  const place = time => {
    for (const { drop, speed, offset, top } of drops) {
      drop.position.y = top - ((time * speed + offset) % (top + 2)) + 1.7;
    }
  };
  place(4.2);
  return {
    object,
    frame(time) {
      if (kit.reducedMotion) return;
      place(time);
      const cycle = (time % 11) / 2.6;
      sweep.visible = cycle < 1;
      if (sweep.visible) sweep.position.z = -8.5 + cycle * 21;
    },
    dispose() {},
  };
}

// ---------- advisor ----------

// The oracle's printout: greenbar paper with the lines it reads, tiled so it
// can scroll up through its hands.
function printout(kit) {
  return memo(kit, 'oracle-printout', () => {
    const css = key => '#' + kit.color(key).getHexString();
    const map = kit.canvas(256, 256, (ctx, w, h) => {
      for (let band = 0; band < 8; band += 1) {
        ctx.fillStyle = css(band % 2 ? 'paper' : 'band');
        ctx.fillRect(0, band * 32, w, 32);
      }
      ctx.fillStyle = css('dim');
      for (let y = 8; y < h; y += 32) {
        ctx.beginPath(); ctx.arc(8, y + 8, 4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(w - 8, y + 8, 4, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = css('ink');
      ctx.font = `bold 13px ${MONO}`;
      ctx.textBaseline = 'middle';
      const lines = ['> ASK ORACLE', 'READ 120K', 'RETRY WINDOW?', '  BACKOFF 2^N', '  JITTER ON', 'CHECK SWEEP', 'OK  ADVISE', '> ..........'];
      lines.forEach((line, i) => ctx.fillText(line, 24, 16 + i * 32));
    }, { repeat: [1, 1] });
    return new MeshBasicMaterial({ map, toneMapped: false, side: DoubleSide });
  });
}

// A cone of strokes: rings up its height and ribs down its sides.
function coneSketch(sketch, r0, r1, h, x, y, z, rings = 3, ribs = 8) {
  for (let i = 0; i <= rings; i += 1) sketch.ring(r0 + (r1 - r0) * (i / rings), x, y - h / 2 + h * (i / rings), z, 'y', 16);
  for (let i = 0; i < ribs; i += 1) {
    const a = (i / ribs) * TAU;
    sketch.seg(x + Math.cos(a) * r0, y - h / 2, z + Math.sin(a) * r0, x + Math.cos(a) * r1, y + h / 2, z + Math.sin(a) * r1);
  }
  return sketch;
}

// The advisor is the oracle in the machine: a hooded sage drawn in vector
// strokes, standing on a chip's plinth with a halo turning over its hood. It
// reads a greenbar printout that scrolls up through its hands and folds down
// to the board, its eyes running down the lines and blinking, its halo
// brightening while it reads.
function advisor(kit) {
  const root = new Group();
  const ctx = makeContext(kit, root);
  const { I, W } = ctx;
  // The plinth: a package with its pins.
  const plinth = new Sketch();
  ctx.box(plinth, 1.2, 0.12, 1.0, 0, 0.06, 0);
  for (let i = 0; i < 6; i += 1) {
    const z = -0.4 + i * 0.16;
    for (const side of [-1, 1]) plinth.seg(side * 0.6, 0.04, z, side * 0.72, 0.04, z).seg(side * 0.72, 0.04, z, side * 0.72, 0, z);
  }
  plinth.ring(0.06, -0.48, 0.121, -0.38, 'y', 8);
  ctx.wire(plinth, 'dim');
  // The sage: robe, shoulders and a hood round a round head.
  const sage = new Group();
  sage.position.set(0, 0.12, -0.22);
  root.add(sage);
  const robe = new Sketch();
  ctx.solid(new CylinderGeometry(0.14, 0.42, 0.9, 16), [0, 0.45, 0], sage);
  coneSketch(robe, 0.42, 0.14, 0.9, 0, 0.45, 0, 3, 10);
  ctx.wire(robe, 'ink', sage);
  const head = new Group();
  head.position.set(0, 1.02, 0);
  sage.add(head);
  const hood = new Sketch();
  ctx.solid(new CylinderGeometry(0.02, 0.27, 0.5, 14), [0, 0.12, -0.02], head);
  coneSketch(hood, 0.27, 0.02, 0.5, 0, 0.12, -0.02, 2, 8);
  ctx.wire(hood, 'ink', head);
  // The face in the hood's shadow: a dark disc with two glowing eyes.
  const shade = new Mesh(new CircleGeometry(0.15, 16), I.void);
  shade.position.set(0, 0.02, 0.215);
  shade.rotation.x = -0.25;
  head.add(shade);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new Mesh(new BoxGeometry(0.06, 0.035, 0.01), I.flash);
    eye.position.set(side * 0.06, 0.04, 0.24);
    head.add(eye);
    eyes.push(eye);
  }
  // The halo over its hood.
  const halo = new Group();
  halo.position.set(0, 0.5, -0.02);
  halo.add(new Mesh(strokeGeometry(new Sketch().ring(0.2, 0, 0, 0, 'y', 20).v, W), I.amber));
  const tick = new Sketch();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    tick.seg(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27);
  }
  halo.add(new Mesh(strokeGeometry(tick.v, W), I.amber));
  head.add(halo);
  // Its arms, out to the printout's edges.
  const arms = new Sketch();
  for (const side of [-1, 1]) arms.path([[side * 0.16, 0.85, 0.02], [side * 0.3, 0.66, 0.2], [side * 0.3, 0.66, 0.42]]);
  ctx.wire(arms, 'ink', sage);
  // The printout: a sheet held up to read and its fanfold down to the board.
  const sheet = new Group();
  sheet.position.set(0, 0.8, 0.26);
  sheet.rotation.x = -0.55;
  root.add(sheet);
  const paper = printout(kit);
  sheet.add(new Mesh(new PlaneGeometry(0.62, 0.42), paper));
  sheet.add(new Mesh(strokeGeometry(new Sketch().rect(0.62, 0.42, 0, 0, 0.004).v, W * 0.8), I.ink));
  const fold = new Sketch();
  const folds = [[0.8, 0.26], [0.6, 0.44], [0.42, 0.3], [0.24, 0.48], [0.13, 0.36]];
  for (let i = 0; i < folds.length - 1; i += 1) {
    const [y0, z0] = folds[i];
    const [y1, z1] = folds[i + 1];
    for (const x of [-0.31, 0.31]) fold.seg(x, y0 - (i ? 0 : 0.18), z0 + (i ? 0 : 0.1), x, y1, z1);
    fold.seg(-0.31, y1, z1, 0.31, y1, z1);
  }
  ctx.wire(fold, 'dim');
  const scale = 1.35;
  root.scale.setScalar(scale);
  root.userData = {
    labelY: 1.95 * scale,
    page: new Vector3(0, 0.84 * scale, 0.3 * scale),
    frame(time, dt, state) {
      const reading = state.activity;
      paper.map.offset.y = (time * 0.12 * reading) % 1;
      head.rotation.x = 0.3 * reading + Math.sin(time * 0.6) * 0.03;
      head.rotation.y = Math.sin(time * 0.5) * 0.15 * reading;
      sage.rotation.z = Math.sin(time * 0.8) * 0.02;
      halo.rotation.y = time * (0.4 + reading * 0.8);
      halo.scale.setScalar(0.9 + 0.1 * reading);
      const blink = (time % 4.1) < 0.14;
      for (const eye of eyes) {
        eye.visible = !blink;
        eye.position.y = 0.04 - 0.02 * reading * (0.5 + 0.5 * Math.sin(time * 2.4));
      }
    },
  };
  return root;
}

export default {
  palette: PALETTE,
  backdrop: BACKDROP,
  layout: { bend: 0, stagger: STAGGER, jitter: 0, turn: 0 },
  view: { elevation: 0.78, azimuth: 0.05 },
  pad: false,
  floor, hall, station, ghost, crate, carrier, packet, dock, decor, weather, advisor,
};
