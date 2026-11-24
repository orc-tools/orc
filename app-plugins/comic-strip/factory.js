// Comic Strip's Factory floor: an inked Art Deco print-shop rooftop.
// The main agent runs The Daily Orc Print House at the head of a chevron
// runway laid across halftone rooftop tiles, framed by cast-iron streetlamps,
// newsprint rolls, rooftop water towers and an Art Deco skyline. Workers
// rotate across three print-shop stations (rotary press, sawtooth art studio,
// dispatch loft) and subagents across three kiosks (newsstand, letterpress
// bench, proof booth) on inked comic-panel pads with orc crew. Finished jobs
// fly home as tied newspaper bundles slung under folded 3D paper darts.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry,
  DoubleSide, EdgesGeometry, ExtrudeGeometry, Group, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, PlaneGeometry, Shape, SphereGeometry, Vector3,
} from 'three';

const PAPER = '#fff8e7';
const INK = '#192632';
const CYAN = '#78a6ae';
const SAFFRON = '#e7b54c';
const VERMILION = '#d65a42';

const PALETTE = {
  light: {
    ground: '#ece0c4', horizon: '#f1e6cc', zenith: '#faf3e1',
    line: '#24313d', aisle: '#98bab4', body: '#f7eed8', trim: INK,
    roof: '#6c9ca3', accent: VERMILION, worker: SAFFRON,
    busy: '#23849c', ok: '#3f7651', fail: VERMILION, idle: '#737d80',
    crate: PAPER, tape: VERMILION, smoke: '#a89f8e', dust: '#b8aa90', moss: '#8d806a',
    glow: '#5db7d6', window: '#ffe599', door: '#243340',
    sky: '#fff9eb', sun: '#fff5dd',
    ink: INK, brick: '#f3e6c8', brickMortar: '#b7a688',
    brickRed: '#d9664c', timber: '#965c36', tower: '#4b6b72', towerAlt: '#3b5760',
    orc: '#6e9e4c', apron: '#2c3944', visor: '#387654', bluePencil: '#3b96b8',
    sunIntensity: 2.35, skyIntensity: 1.45, envIntensity: 0.48, exposure: 1.02, fogNear: 12, fogSpan: 34,
  },
  dark: {
    ground: '#2b3945', horizon: '#243440', zenith: '#15202a',
    line: '#e4c278', aisle: '#39616b', body: '#d3c19a', trim: '#15202a',
    roof: '#56858f', accent: '#e56f54', worker: SAFFRON,
    busy: '#78cddd', ok: '#7cb489', fail: '#f17c69', idle: '#95a6a9',
    crate: '#f5ebd3', tape: '#df5c43', smoke: '#7d8a92', dust: '#687174', moss: '#707474',
    glow: '#7ad4e8', window: '#ffe08a', door: '#192530',
    sky: '#88adc0', sun: '#dce9ff',
    ink: '#131d26', brick: '#cbb890', brickMortar: '#85775d',
    brickRed: '#ce5a43', timber: '#7c4b2b', tower: '#1c2832', towerAlt: '#152029',
    orc: '#6a9b4c', apron: '#222d37', visor: '#448c62', bluePencil: '#6bc4e0',
    sunIntensity: 2.15, skyIntensity: 1.35, envIntensity: 0.62, exposure: 1.12, fogNear: 12, fogSpan: 34,
  },
};

const BACKDROP = {
  light: 'linear-gradient(180deg, #faf3e1 0%, #f1e6cc 45%, #e5d8b9 100%)',
  dark: 'radial-gradient(ellipse 74% 38% at 50% 24%, rgba(110, 165, 180, 0.16) 0%, transparent 70%), '
    + 'linear-gradient(180deg, #131d27 0%, #1c2a36 38%, #263643 68%, #2b3945 100%)',
};

const view = { elevation: 0.58, azimuth: 0.09 };
const TAU = Math.PI * 2;
const NOOP = () => {};
const css = colour => '#' + colour.getHexString();

function shared(kit, key, make) {
  if (!kit.materials.has(key)) kit.materials.set(key, make());
  return kit.materials.get(key);
}

function inkMaterial(kit) {
  return shared(kit, 'comic:ink-line', () => new LineBasicMaterial({ color: kit.color('ink') }));
}

function edgeOverlay(kit, mesh, threshold = 24) {
  const lines = new LineSegments(new EdgesGeometry(mesh.geometry, threshold), inkMaterial(kit));
  lines.raycast = NOOP;
  mesh.add(lines);
  return lines;
}

// Welds crisp ink edges for every opaque static mesh inside `group` into one
// LineSegments draw call, so inked buildings stay low-cost across 24 stations.
function bakeInk(kit, group, threshold = 26) {
  group.updateMatrixWorld(true);
  const invRoot = group.matrixWorld.clone().invert();
  const rel = new Matrix4();
  const chunks = [];
  let total = 0;
  group.traverse(node => {
    if (!node.isMesh || node.material?.transparent || node.userData?.noInk) return;
    if (node.geometry?.type === 'SphereGeometry') return;
    const edges = new EdgesGeometry(node.geometry, threshold);
    const pos = edges.attributes.position;
    if (!pos || !pos.count) {
      edges.dispose();
      return;
    }
    rel.multiplyMatrices(invRoot, node.matrixWorld);
    edges.applyMatrix4(rel);
    const copy = new Float32Array(pos.array);
    chunks.push(copy);
    total += copy.length;
    edges.dispose();
  });
  if (!total) return null;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(merged, 3));
  const lines = new LineSegments(geometry, inkMaterial(kit));
  lines.raycast = NOOP;
  group.add(lines);
  return lines;
}

function box(kit, w, h, d, mat, at = [0, 0, 0], ink = false) {
  const mesh = kit.box(w, h, d, mat, at);
  if (ink) edgeOverlay(kit, mesh, 24);
  return mesh;
}

function cyl(kit, top, bottom, height, mat, at = [0, 0, 0], segments = 14, ink = false) {
  const mesh = kit.cylinder(top, bottom, height, mat, at, segments);
  if (ink) edgeOverlay(kit, mesh, 28);
  return mesh;
}

// ---------- painted comic textures (cached once per scene) ----------

function brickMat(kit, key = 'brick') {
  return shared(kit, `comic:brick:${key}`, () => {
    const dark = kit.mode === 'dark';
    const base = css(kit.color(key));
    const mortar = key === 'brickRed'
      ? css(kit.blend(kit.color('brickRed'), kit.color('ink'), 0.42))
      : css(kit.color('brickMortar'));
    const shade = key === 'brickRed'
      ? (dark ? 'rgba(20, 12, 16, 0.14)' : 'rgba(120, 30, 18, 0.14)')
      : (dark ? 'rgba(20, 26, 32, 0.12)' : 'rgba(130, 112, 82, 0.12)');
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const rows = 8;
      const cols = 4;
      const rh = h / rows;
      const cw = w / cols;
      for (let r = 0; r < rows; r += 1) {
        const shift = (r % 2) * (cw / 2);
        for (let c = -1; c <= cols; c += 1) {
          if ((r * 3 + c * 5 + 10) % 3 === 0) {
            ctx.fillStyle = shade;
            ctx.fillRect(c * cw + shift, r * rh, cw, rh);
          }
        }
      }
      ctx.strokeStyle = mortar;
      ctx.lineWidth = 2;
      for (let r = 0; r <= rows; r += 1) {
        const y = r * rh;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        if (r < rows) {
          const shift = (r % 2) * (cw / 2);
          for (let c = 0; c <= cols; c += 1) {
            const x = (c * cw + shift) % w;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rh); ctx.stroke();
          }
        }
      }
    }, { width: 256, height: 256, rough: 0.84, metal: 0.02 });
  });
}

function padMat(kit) {
  return shared(kit, 'comic:pad', () => {
    const dark = kit.mode === 'dark';
    const paper = dark ? '#ded0b0' : '#fff8e7';
    const ink = css(kit.color('ink'));
    const dot = dark ? 'rgba(25, 38, 50, 0.18)' : 'rgba(25, 38, 50, 0.11)';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dot;
      for (let y = 16; y < h - 14; y += 14) {
        for (let x = 16; x < w - 14; x += 14) {
          const edge = Math.min(x, y, w - x, h - y);
          if (edge > 52) continue;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(18, 18, w - 36, h - 36);
      // Printer's corner registration crosshairs.
      ctx.lineWidth = 2;
      for (const [cx, cy] of [[28, 28], [w - 28, 28], [28, h - 28], [w - 28, h - 28]]) {
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5);
        ctx.stroke();
      }
    }, { width: 256, height: 256, rough: 0.88, metal: 0.02 });
  });
}

function marqueeMat(kit) {
  return shared(kit, 'comic:marquee', () => {
    const dark = kit.mode === 'dark';
    return kit.painted((ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#ffe38d');
      grad.addColorStop(1, '#edb646');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(207, 82, 63, 0.14)';
      for (let y = 14; y < h - 10; y += 12) {
        for (let x = 16; x < w - 12; x += 12) {
          ctx.beginPath();
          ctx.arc(x + ((y / 12) % 2) * 6, y, 1.7, 0, TAU);
          ctx.fill();
        }
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.strokeStyle = '#cf523f';
      ctx.lineWidth = 3;
      ctx.strokeRect(15, 15, w - 30, h - 30);
      ctx.font = 'italic 900 54px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#cf523f';
      ctx.fillText('THE DAILY ORC', w / 2 + 3, h / 2 + 5);
      ctx.fillStyle = INK;
      ctx.fillText('THE DAILY ORC', w / 2, h / 2 + 2);
    }, { width: 512, height: 128, rough: 0.5, metal: 0.04, emissive: true, glow: dark ? 0.34 : 0.06 });
  });
}

function sheetMat(kit) {
  return shared(kit, 'comic:sheet', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = INK;
    ctx.fillRect(14, 14, w - 28, 14);
    ctx.fillStyle = VERMILION;
    ctx.fillRect(14, 34, w * 0.45, 7);
    ctx.fillStyle = '#6f7c84';
    for (let row = 0; row < 5; row += 1) {
      const y = 50 + row * 12;
      ctx.fillRect(14, y, w * 0.38, 4);
      ctx.fillRect(w * 0.56, y, w * 0.30, 4);
    }
  }, { width: 128, height: 128, rough: 0.85, metal: 0, doubleSide: true }));
}

function rollEndMat(kit) {
  return shared(kit, 'comic:roll-end', () => kit.painted((ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9b8d74';
    ctx.lineWidth = 2.5;
    for (let r = 18; r < w * 0.47; r += 10) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.13, 0, TAU);
    ctx.fill();
  }, { width: 128, height: 128, rough: 0.82, metal: 0 }));
}

function towerMat(kit, variant) {
  return shared(kit, `comic:tower:${variant}`, () => {
    const dark = kit.mode === 'dark';
    const wall = css(kit.color(variant % 2 === 0 ? 'tower' : 'towerAlt'));
    const flute = dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(25, 38, 50, 0.1)';
    const lit = dark ? '#ffe69c' : '#f7df94';
    const dim = dark ? '#273846' : '#354f57';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = flute;
      for (let x = 18; x < w; x += 32) ctx.fillRect(x, 0, 5, h);
      const cols = 4;
      const rows = 8;
      const padX = 28;
      const padY = 38;
      const spanX = (w - padX * 2) / cols;
      const spanY = (h - padY * 2) / rows;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const hash = (r * 7 + c * 11 + variant * 13) % 9;
          const on = hash === 1 || hash === 4 || hash === 7;
          if (!on && !dark && hash % 2 === 0) continue;
          ctx.fillStyle = on ? lit : dim;
          ctx.fillRect(padX + c * spanX + 10, padY + r * spanY + 10, spanX - 20, spanY - 18);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.strokeRect(padX + c * spanX + 10, padY + r * spanY + 10, spanX - 20, spanY - 18);
        }
      }
    }, { width: 256, height: 512, rough: 0.86, metal: 0.04, emissive: dark, glow: dark ? 0.45 : 0 });
  });
}

function aisleMat(kit) {
  return shared(kit, 'comic:aisle', () => {
    const dark = kit.mode === 'dark';
    const fill = css(kit.color('aisle'));
    const ink = css(kit.color('ink'));
    const gold = SAFFRON;
    const chevron = PAPER;
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      // Outer ink border + saffron comic pinstripe + perforated edge dots.
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, 14, h);
      ctx.fillRect(w - 14, 0, 14, h);
      ctx.fillStyle = gold;
      ctx.fillRect(14, 0, 10, h);
      ctx.fillRect(w - 24, 0, 10, h);
      ctx.fillStyle = dark ? 'rgba(25, 38, 50, 0.35)' : 'rgba(25, 38, 50, 0.22)';
      for (let y = 12; y < h; y += 24) {
        ctx.beginPath();
        ctx.arc(34, y, 3, 0, TAU);
        ctx.arc(w - 34, y, 3, 0, TAU);
        ctx.fill();
      }
      // Forward-pointing chevrons aimed up the runway toward The Daily Orc.
      const count = 4;
      const step = h / count;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < count; i += 1) {
        const cy = (i + 0.5) * step;
        ctx.strokeStyle = 'rgba(25, 38, 50, 0.32)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(w * 0.27 + 3, cy + 28 + 4);
        ctx.lineTo(w * 0.5 + 3, cy - 20 + 4);
        ctx.lineTo(w * 0.73 + 3, cy + 28 + 4);
        ctx.stroke();
        ctx.strokeStyle = chevron;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(w * 0.27, cy + 28);
        ctx.lineTo(w * 0.5, cy - 20);
        ctx.lineTo(w * 0.73, cy + 28);
        ctx.stroke();
      }
    }, { width: 256, height: 512, repeat: [1, 3.6], rough: 0.78, metal: 0.04 });
  });
}

function stopPressLooks(kit) {
  const tape = shared(kit, 'comic:ruin-tape', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = SAFFRON;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    for (let x = -h; x < w; x += h) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + h * 0.48, h);
      ctx.lineTo(x + h, 0);
      ctx.lineTo(x + h * 0.52, 0);
      ctx.fill();
    }
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h - 3, w, 3);
  }, { width: 64, height: 32, repeat: [3, 1], rough: 0.65, metal: 0, doubleSide: true }));

  const sign = shared(kit, 'comic:stop-press', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.strokeStyle = VERMILION;
    ctx.lineWidth = 6;
    ctx.strokeRect(15, 15, w - 30, h - 30);
    ctx.fillStyle = VERMILION;
    ctx.font = 'italic 900 44px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP PRESS', w / 2, h / 2 + 2);
  }, { width: 320, height: 112, rough: 0.75, metal: 0, doubleSide: true }));

  return { tape, sign };
}

// ---------- reusable comic props & crew ----------

// Low-poly inked orc print-shop crew member, standing at y 0 facing +z.
function orcCrew(kit, hat = 'press', scale = 1) {
  const root = new Group();
  root.scale.setScalar(scale);
  const skin = kit.mat('orc', { rough: 0.62 });
  const apron = kit.mat('apron', { rough: 0.78 });
  const ink = kit.mat('ink', { rough: 0.7 });
  const paper = kit.mat('crate', { rough: 0.85 });
  const accent = kit.mat('accent', { rough: 0.65 });
  const visor = kit.mat('visor', { rough: 0.55 });

  // Boots & legs
  for (const side of [-1, 1]) {
    root.add(box(kit, 0.1, 0.18, 0.12, ink, [side * 0.08, 0.09, 0], true));
  }
  const body = new Group();
  body.position.set(0, 0.18, 0);
  root.add(body);
  // Torso + printer apron
  body.add(box(kit, 0.3, 0.3, 0.2, apron, [0, 0.15, 0], true));
  body.add(box(kit, 0.24, 0.16, 0.03, hat === 'newsie' ? accent : paper, [0, 0.16, 0.105]));

  // Arms
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 0.19, 0.26, 0);
    arm.add(box(kit, 0.08, 0.24, 0.09, skin, [0, -0.1, 0], true));
    body.add(arm);
    arms.push(arm);
  }

  // Head, ears, tiny tusks, eyes and trade headgear
  const head = new Group();
  head.position.set(0, 0.43, 0.01);
  body.add(head);
  head.add(box(kit, 0.27, 0.24, 0.24, skin, [0, 0, 0], true));
  for (const side of [-1, 1]) {
    const ear = box(kit, 0.07, 0.05, 0.04, skin, [side * 0.16, 0.01, 0]);
    ear.rotation.z = side * 0.28;
    head.add(ear);
    head.add(kit.box(0.035, 0.035, 0.02, ink, [side * 0.058, 0.03, 0.125]));
    head.add(kit.box(0.026, 0.042, 0.02, paper, [side * 0.055, -0.06, 0.125]));
  }
  if (hat === 'press') {
    // Classic folded newspaper printer's cap
    const cap = box(kit, 0.28, 0.12, 0.22, paper, [0, 0.16, 0], true);
    cap.rotation.z = 0.06;
    head.add(cap);
    head.add(kit.box(0.29, 0.03, 0.23, accent, [0, 0.12, 0]));
  } else if (hat === 'visor') {
    // Green editor/inker eyeshade visor
    head.add(kit.box(0.28, 0.04, 0.25, ink, [0, 0.095, 0]));
    const brim = box(kit, 0.27, 0.022, 0.13, visor, [0, 0.08, 0.16], true);
    brim.rotation.x = 0.18;
    head.add(brim);
  } else {
    // Flat newsie cap
    head.add(box(kit, 0.3, 0.08, 0.28, apron, [0, 0.14, 0.01], true));
    head.add(box(kit, 0.24, 0.024, 0.11, ink, [0, 0.105, 0.16], true));
  }
  return { root, body, head, arms };
}

// Wooden rooftop water tower on four trestle legs with iron hoops & cyan cone roof.
function waterTower(kit, scale = 1) {
  const tower = new Group();
  tower.scale.setScalar(scale);
  const timber = kit.mat('timber', { rough: 0.85 });
  const ink = kit.mat('ink', { rough: 0.65, metal: 0.2 });
  const roof = kit.mat('roof', { rough: 0.62 });

  for (const [lx, lz] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) {
    const leg = kit.box(0.06, 0.82, 0.06, timber, [lx, 0.41, lz]);
    leg.rotation.x = lz * 0.22;
    leg.rotation.z = -lx * 0.22;
    tower.add(leg);
  }
  tower.add(kit.box(0.56, 0.05, 0.05, timber, [0, 0.36, 0.24]));
  tower.add(kit.box(0.56, 0.05, 0.05, timber, [0, 0.36, -0.24]));
  tower.add(kit.cylinder(0.46, 0.46, 0.06, ink, [0, 0.82, 0], 12));
  tower.add(kit.cylinder(0.42, 0.44, 0.72, timber, [0, 1.2, 0], 12));
  for (const hy of [1.02, 1.24, 1.44]) {
    tower.add(kit.cylinder(0.445, 0.445, 0.04, ink, [0, hy, 0], 12));
  }
  const cap = new Mesh(new ConeGeometry(0.52, 0.46, 12), roof);
  cap.position.y = 1.79;
  tower.add(cap);
  bakeInk(kit, tower, 28);
  return tower;
}

// Giant upright newsprint roll with spiral winding end-cap.
function newsprintRoll(kit, radius = 0.36, height = 0.88, inked = true) {
  const roll = new Group();
  const body = kit.mat('crate', { rough: 0.86 });
  const cap = rollEndMat(kit);
  const cylMesh = new Mesh(new CylinderGeometry(radius, radius, height, 14), [body, cap, body]);
  cylMesh.position.y = height / 2;
  roll.add(cylMesh);
  if (inked) bakeInk(kit, roll, 30);
  return roll;
}

// Cast-iron streetlamp with flared base, overhang arm and warm globe bulb.
function streetLamp(kit, facing = 1) {
  const lamp = new Group();
  const iron = kit.mat('ink', { rough: 0.46, metal: 0.45 });
  const bulb = kit.mat('window', { emissive: 'window', glow: kit.mode === 'dark' ? 1.35 : 0.75, rough: 0.2 });
  lamp.add(kit.cylinder(0.11, 0.18, 0.36, iron, [0, 0.18, 0], 8));
  lamp.add(kit.cylinder(0.055, 0.09, 2.35, iron, [0, 1.5, 0], 8));
  lamp.add(kit.box(0.56, 0.065, 0.065, iron, [facing * 0.25, 2.66, 0]));
  lamp.add(kit.box(0.055, 0.14, 0.055, iron, [facing * 0.48, 2.57, 0]));
  const globe = kit.sphere(0.21, bulb, [facing * 0.48, 2.4, 0], 12);
  lamp.add(globe);
  bakeInk(kit, lamp, 28);
  return lamp;
}

// Folded 3D paper dart pointing along +z: dihedral cream wings, shaded
// underside, central folded keel and crisp dark ink crease outlines.
function paperDart(kit, scale = 1) {
  const dart = new Group();
  dart.scale.setScalar(scale);

  // Build crisp 3D folded triangles: nose at (0, 0, +0.68), tail at z = -0.48.
  const wingGeo = (verts) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    g.computeVertexNormals();
    return g;
  };
  const topLeft = wingGeo([
    0, 0.02, 0.68,
    -0.46, 0.08, -0.44,
    -0.06, -0.01, -0.34,
  ]);
  const topRight = wingGeo([
    0, 0.02, 0.68,
    0.06, -0.01, -0.34,
    0.46, 0.08, -0.44,
  ]);
  const keelLeft = wingGeo([
    0, 0.02, 0.68,
    -0.06, -0.01, -0.34,
    0, -0.18, -0.26,
  ]);
  const keelRight = wingGeo([
    0, 0.02, 0.68,
    0, -0.18, -0.26,
    0.06, -0.01, -0.34,
  ]);

  const cream = kit.mat('crate', { rough: 0.72, doubleSide: true });
  const shade = kit.mat('body', { rough: 0.78, doubleSide: true });
  const accent = kit.mat('roof', { rough: 0.7, doubleSide: true });

  dart.add(
    new Mesh(topLeft, cream),
    new Mesh(topRight, cream),
    new Mesh(keelLeft, shade),
    new Mesh(keelRight, accent),
  );
  // Inked wing edges and fold creases.
  const creaseVerts = new Float32Array([
    0, 0.022, 0.68, -0.46, 0.082, -0.44,
    0, 0.022, 0.68, 0.46, 0.082, -0.44,
    -0.46, 0.082, -0.44, -0.06, -0.008, -0.34,
    0.46, 0.082, -0.44, 0.06, -0.008, -0.34,
    0, 0.022, 0.68, -0.06, -0.008, -0.34,
    0, 0.022, 0.68, 0.06, -0.008, -0.34,
    0, 0.022, 0.68, 0, -0.18, -0.26,
    -0.06, -0.008, -0.34, 0, -0.18, -0.26,
    0.06, -0.008, -0.34, 0, -0.18, -0.26,
  ]);
  const creaseGeo = new BufferGeometry();
  creaseGeo.setAttribute('position', new BufferAttribute(creaseVerts, 3));
  const lines = new LineSegments(creaseGeo, inkMaterial(kit));
  lines.raycast = NOOP;
  dart.add(lines);
  return dart;
}

// ---------- floor, hall, dock, decor, weather ----------

function floor(kit) {
  const { palette, mode } = kit;
  const dark = mode === 'dark';
  const group = new Group();
  group.add(kit.ground({
    rough: 0.9, metal: 0.02, repeat: [19, 19],
    draw(ctx, w, h) {
      const cells = 4;
      const step = w / cells;
      const base = css(palette.ground);
      const alt = css(kit.blend(palette.ground, palette.ink, dark ? 0.14 : 0.05));
      const grout = css(kit.blend(palette.ground, palette.ink, dark ? 0.52 : 0.62));
      const dot = dark ? 'rgba(12, 18, 26, 0.36)' : 'rgba(130, 114, 86, 0.24)';
      for (let r = 0; r < cells; r += 1) {
        for (let c = 0; c < cells; c += 1) {
          ctx.fillStyle = (r + c) % 2 === 0 ? base : alt;
          ctx.fillRect(c * step, r * step, step, step);
          ctx.fillStyle = dot;
          const margin = 16;
          for (let dy = margin; dy < step - margin + 1; dy += 24) {
            for (let dx = margin; dx < step - margin + 1; dx += 24) {
              ctx.beginPath();
              ctx.arc(c * step + dx, r * step + dy, 3.2, 0, TAU);
              ctx.fill();
            }
          }
        }
      }
      ctx.strokeStyle = grout;
      ctx.lineWidth = 4;
      for (let i = 0; i <= cells; i += 1) {
        const p = i * step;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
      }
    },
  }));

  // Chevron runway leading up to The Daily Orc's rolling door.
  const runwayMat = aisleMat(kit);
  const runway = new Mesh(new PlaneGeometry(1.94, 13.8), runwayMat);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0.022, 3.3);
  runway.receiveShadow = !kit.software;
  group.add(runway);
  const curb = kit.mat('ink', { rough: 0.68, metal: 0.15 });
  for (const side of [-1, 1]) {
    const rail = kit.box(0.09, 0.044, 13.8, curb, [side * 1.0, 0.022, 3.3]);
    rail.receiveShadow = !kit.software;
    group.add(rail);
  }
  return group;
}

// Arched window cutout shape for The Daily Orc facade.
function archGeometry(w, h) {
  const shape = new Shape();
  const r = w / 2;
  const rectH = Math.max(0.05, h - r);
  shape.moveTo(-r, 0);
  shape.lineTo(r, 0);
  shape.lineTo(r, rectH);
  shape.absarc(0, rectH, r, 0, Math.PI, false);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 10 });
}

function hall(kit) {
  const group = new Group();
  const staticParts = new Group();
  group.add(staticParts);

  const brick = brickMat(kit, 'brick');
  const brickRed = brickMat(kit, 'brickRed');
  const ink = kit.mat('ink', { rough: 0.62, metal: 0.16 });
  const roof = kit.mat('roof', { rough: 0.56, metal: 0.08 });
  const stone = kit.mat('body', { rough: 0.78 });
  const accent = kit.mat('accent', { rough: 0.54 });
  const gold = kit.mat('worker', { rough: 0.45, metal: 0.12 });

  group.add(kit.shadow(6.0, 4.1, 0.34));

  // Main brick print-house hall and stepped Art Deco roof tiers
  staticParts.add(
    kit.box(5.04, 0.18, 3.12, ink, [0, 0.09, 0]),
    kit.box(4.74, 1.98, 2.88, brick, [0, 1.17, 0]),
    kit.box(4.96, 0.15, 3.06, ink, [0, 2.22, 0]),
    kit.box(4.06, 0.28, 2.6, roof, [0, 2.43, 0]),
    kit.box(2.96, 0.28, 2.1, stone, [0, 2.71, 0]),
    kit.box(1.94, 0.32, 1.54, roof, [0, 3.01, 0]),
    // Door frame, dark interior recess & vermilion awning with gold lip
    kit.box(1.66, 1.44, 0.1, ink, [0, 0.9, 1.44]),
    kit.box(1.5, 1.32, 0.06, kit.mat('door', { rough: 1 }), [0, 0.84, 1.44]),
    kit.box(1.94, 0.18, 0.4, accent, [0, 1.66, 1.56]),
    kit.box(1.98, 0.05, 0.43, gold, [0, 1.56, 1.56]),
  );
  // Awning tie rods
  for (const x of [-0.82, 0.82]) {
    staticParts.add(kit.box(0.03, 0.42, 0.03, ink, [x, 1.92, 1.56]));
  }

  // Four glowing arched print-shop windows with ink frames & crossbars
  const frameGeo = archGeometry(0.42, 0.98);
  const paneGeo = archGeometry(0.32, 0.88);
  for (const x of [-1.86, -1.26, 1.26, 1.86]) {
    const frame = new Mesh(frameGeo, ink);
    frame.position.set(x, 0.78, 1.43);
    const pane = new Mesh(paneGeo, kit.windows);
    pane.position.set(x, 0.82, 1.455);
    pane.userData.noInk = true;
    staticParts.add(
      frame, pane,
      kit.box(0.03, 0.88, 0.03, ink, [x, 1.26, 1.49]),
      kit.box(0.34, 0.03, 0.03, ink, [x, 1.22, 1.49]),
    );
  }

  // Vermilion Art Deco vertical banners on left & right corners
  for (const side of [-1, 1]) {
    staticParts.add(
      kit.box(0.34, 0.06, 0.14, ink, [side * 2.24, 1.98, 1.5]),
      kit.box(0.28, 1.18, 0.05, accent, [side * 2.24, 1.38, 1.5]),
      kit.box(0.22, 0.96, 0.06, gold, [side * 2.24, 1.42, 1.505]),
      kit.box(0.16, 0.86, 0.065, accent, [side * 2.24, 1.42, 1.508]),
    );
  }

  // Rooftop wooden water tower on left & smoking brick chimney on right
  const roofTower = waterTower(kit, 0.72);
  roofTower.position.set(-1.72, 2.29, -0.54);
  group.add(roofTower);

  staticParts.add(
    kit.box(0.44, 1.15, 0.44, brickRed, [1.66, 2.86, -0.46]),
    kit.box(0.52, 0.14, 0.52, ink, [1.66, 3.46, -0.46]),
  );

  // Rolling cyan shutter door (hinged at top so scaling y opens it)
  const door = box(kit, 1.46, 1.28, 0.06, roof, [0, 1.46, 1.49], true);
  door.geometry.translate(0, -0.64, 0);
  group.add(door);

  // Popping "THE DAILY ORC" roof marquee
  const board = new Group();
  board.position.set(0, 3.36, 0.66);
  board.add(box(kit, 2.66, 0.66, 0.14, ink, [0, 0, 0], true));
  const face = new Mesh(new PlaneGeometry(2.54, 0.56), marqueeMat(kit));
  face.position.z = 0.075;
  board.add(face);
  group.add(board);
  for (const x of [-0.95, 0.95]) {
    staticParts.add(kit.box(0.06, 0.44, 0.06, ink, [x, 2.94, 0.66]));
  }

  // State beacon finial above the marquee
  staticParts.add(kit.cylinder(0.03, 0.045, 0.24, ink, [0, 3.74, 0.66], 8));
  const beacon = kit.sphere(0.13, kit.beacon, [0, 3.92, 0.66], 10);
  group.add(beacon);

  // Chief orc printer standing guard beside the doorway
  const printer = orcCrew(kit, 'press', 1.12);
  printer.root.position.set(1.14, 0.16, 1.66);
  printer.root.rotation.y = -0.22;
  group.add(printer.root);

  bakeInk(kit, staticParts, 26);

  let pulse = -Infinity;
  let clock = 0;
  group.userData = {
    door,
    beacon,
    chimney: new Vector3(1.66, 3.64, -0.46),
    labelY: 4.18,
    react() {
      pulse = clock;
    },
    frame(time, _dt, main, reduced) {
      clock = time;
      if (reduced || kit.reducedMotion) {
        board.scale.setScalar(1);
        printer.body.position.y = 0.18;
        printer.arms[0].rotation.x = -0.2;
        printer.arms[1].rotation.x = -0.2;
        return;
      }
      const kick = Math.max(0, 1 - (time - pulse) / 0.65);
      board.scale.setScalar(1 + Math.sin(kick * Math.PI) * 0.12);
      const active = main?.state === 'working' ? 1 : 0.25;
      printer.body.position.y = 0.18 + Math.abs(Math.sin(time * 4.2)) * 0.03 * active;
      printer.arms[0].rotation.x = -0.25 + Math.sin(time * 4.2) * 0.35 * active;
      printer.arms[1].rotation.x = -0.25 - Math.sin(time * 4.2) * 0.35 * active;
    },
  };
  return kit.shadows(group);
}

// Inked comic-panel pad with printer's corner registration marks & status trim.
function pad(kit, kind, lampMaterial) {
  const group = new Group();
  const wide = kind === 'worker' ? 1.98 : 1.78;
  const deep = kind === 'worker' ? 1.78 : 1.58;
  group.add(kit.shadow(wide + 0.45, deep + 0.45, 0.3, [0, 0.004, 0]));
  const base = kit.box(wide, 0.048, deep, kit.mat('ink', { rough: 0.72 }), [0, 0.024, 0]);
  base.receiveShadow = !kit.software;
  group.add(base);
  const deck = new Mesh(new PlaneGeometry(wide - 0.08, deep - 0.08), padMat(kit));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.05;
  deck.receiveShadow = !kit.software;
  group.add(deck);
  if (lampMaterial) {
    for (const side of [-1, 1]) {
      group.add(kit.box(0.32, 0.024, 0.055, lampMaterial, [side * (wide * 0.28), 0.054, deep / 2 - 0.03]));
    }
  }
  return group;
}

// Blue-pencil layout wireframe for queued stations.
function ghost(kit) {
  const group = new Group();
  const pencil = kit.basic('bluePencil', { opacity: 0.85 });
  const wash = kit.basic('bluePencil', { opacity: kit.mode === 'dark' ? 0.16 : 0.12 });
  group.add(kit.box(1.26, 0.96, 1.08, wash, [0, 0.54, 0]));
  for (const x of [-0.63, 0.63]) {
    for (const z of [-0.54, 0.54]) {
      group.add(kit.box(0.045, 1.02, 0.045, pencil, [x, 0.56, z]));
    }
  }
  for (const y of [0.06, 1.04]) {
    group.add(
      kit.box(1.3, 0.036, 0.036, pencil, [0, y, -0.54]),
      kit.box(1.3, 0.036, 0.036, pencil, [0, y, 0.54]),
      kit.box(0.036, 0.036, 1.12, pencil, [-0.63, y, 0]),
      kit.box(0.036, 0.036, 1.12, pencil, [0.63, y, 0]),
    );
  }
  return group;
}

// ---------- worker stations (3 rotating print-shop stations) ----------

function rotaryPress(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const ink = kit.mat('ink', { rough: 0.55, metal: 0.28 });
  const roof = kit.mat('roof', { rough: 0.58 });
  const paper = kit.mat('crate', { rough: 0.82 });
  const saffron = kit.mat('worker', { rough: 0.52 });
  const accent = kit.mat('accent', { rough: 0.55 });

  // Heavy cast-iron side cheeks & base
  body.add(
    kit.box(1.42, 0.14, 1.24, ink, [0, 0.11, 0]),
    kit.box(0.18, 0.98, 0.96, ink, [-0.54, 0.66, -0.06]),
    kit.box(0.18, 0.98, 0.96, ink, [0.54, 0.66, -0.06]),
    kit.box(1.16, 0.22, 0.72, roof, [0, 0.3, -0.04]),
    // Front delivery chute & tray
    kit.box(0.92, 0.08, 0.44, roof, [0, 0.44, 0.52]),
    kit.box(0.76, 0.05, 0.34, sheetMat(kit), [0, 0.505, 0.54]),
    kit.box(0.84, 0.07, 0.04, accent, [0, 1.12, -0.34]),
  );

  // Two spinning cylinders: top newsprint web roll & front saffron impression drum
  const topRoller = cyl(kit, 0.2, 0.2, 0.9, paper, [0, 1.0, -0.16], 14, true);
  topRoller.rotation.z = Math.PI / 2;
  const inkRoller = cyl(kit, 0.22, 0.22, 0.9, saffron, [0, 0.68, 0.22], 14, true);
  inkRoller.rotation.z = Math.PI / 2;
  const wheel = cyl(kit, 0.18, 0.18, 0.06, accent, [0.66, 0.68, 0.22], 12, true);
  wheel.rotation.z = Math.PI / 2;
  group.add(topRoller, inkRoller, wheel);

  // Fresh sheet sliding out on delivery tray
  const sheet = box(kit, 0.58, 0.02, 0.28, sheetMat(kit), [0, 0.55, 0.54], true);
  group.add(sheet);

  const orc = orcCrew(kit, 'press', 0.92);
  orc.root.position.set(-0.62, 0.05, 0.44);
  orc.root.rotation.y = 0.72;
  group.add(orc.root);

  lamp.position.set(0.48, 1.38, 0.32);
  body.add(kit.cylinder(0.025, 0.03, 0.24, ink, [0.48, 1.24, 0.32], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    spin: [[topRoller, 'x', -3.6], [inkRoller, 'x', 4.6], [wheel, 'x', 4.6]],
    puff: new Vector3(0, 1.22, -0.14),
    labelY: 1.76,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      const slide = (time * 1.4) % 1;
      sheet.position.z = 0.42 + slide * 0.2 * run;
      orc.body.position.y = 0.18 + Math.abs(Math.sin(time * 5.2)) * 0.028 * run;
      orc.arms[0].rotation.x = -0.5 + Math.sin(time * 5.2) * 0.4 * run;
      orc.arms[1].rotation.x = -0.5 - Math.sin(time * 5.2) * 0.4 * run;
    },
  };
}

function sawtoothStudio(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const brick = brickMat(kit, 'brick');
  const ink = kit.mat('ink', { rough: 0.6 });
  const roof = kit.mat('roof', { rough: 0.58 });
  const timber = kit.mat('timber', { rough: 0.82 });
  const accent = kit.mat('accent', { rough: 0.55 });

  body.add(
    kit.box(1.44, 0.12, 1.26, ink, [0, 0.1, 0]),
    kit.box(1.32, 0.84, 1.14, brick, [0, 0.58, 0]),
    kit.box(1.38, 0.08, 1.2, ink, [0, 1.02, 0]),
    // Warm lit drafting window on front wall
    kit.box(0.54, 0.44, 0.05, ink, [0.22, 0.62, 0.57]),
    kit.box(0.42, 0.34, 0.04, kit.windows, [0.22, 0.62, 0.59]),
    // Small doorway on left front
    kit.box(0.36, 0.64, 0.05, kit.mat('door', { rough: 1 }), [-0.34, 0.48, 0.57]),
    kit.box(0.44, 0.07, 0.16, accent, [-0.34, 0.84, 0.62]),
  );
  // Twin sawtooth skylights on the roof
  const teeth = kit.sawtooth(1.32, 1.12, 2, 0.48, roof, kit.windows);
  teeth.position.y = 1.06;
  body.add(teeth);

  // Outdoor angled drafting easel beside the studio door
  const desk = new Group();
  desk.position.set(0.32, 0.05, 0.68);
  desk.add(kit.box(0.44, 0.34, 0.05, timber, [0, 0.17, 0]));
  const board = kit.box(0.48, 0.04, 0.32, sheetMat(kit), [0, 0.37, 0.02]);
  board.rotation.x = 0.28;
  desk.add(board);
  body.add(desk);

  const orc = orcCrew(kit, 'visor', 0.9);
  orc.root.position.set(-0.42, 0.05, 0.72);
  orc.root.rotation.y = 0.35;
  group.add(orc.root);

  lamp.position.set(0, 1.62, 0.34);
  body.add(kit.cylinder(0.024, 0.028, 0.18, ink, [0, 1.5, 0.34], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    puff: new Vector3(-0.32, 1.55, -0.25),
    labelY: 1.94,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      orc.head.rotation.z = Math.sin(time * 3.2) * 0.1 * run;
      orc.arms[1].rotation.x = -0.65 + Math.sin(time * 8.4) * 0.28 * run;
      orc.arms[0].rotation.x = -0.35;
    },
  };
}

function dispatchLoft(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const brickRed = brickMat(kit, 'brickRed');
  const stone = kit.mat('body', { rough: 0.78 });
  const ink = kit.mat('ink', { rough: 0.6 });
  const roof = kit.mat('roof', { rough: 0.56 });
  const timber = kit.mat('timber', { rough: 0.82 });
  const accent = kit.mat('accent', { rough: 0.55 });

  body.add(
    kit.box(1.42, 0.12, 1.24, ink, [0, 0.1, 0]),
    kit.box(1.26, 0.54, 1.12, brickRed, [0, 0.43, -0.04]),
    kit.box(1.32, 0.08, 1.18, ink, [0, 0.72, -0.04]),
    kit.box(1.14, 0.56, 0.98, stone, [0, 1.02, -0.06]),
    // Open upper dispatch bay & launch balcony
    kit.box(0.56, 0.42, 0.06, kit.mat('door', { rough: 1 }), [0, 0.98, 0.44]),
    kit.box(1.16, 0.06, 0.32, timber, [0, 0.76, 0.56]),
    kit.box(0.14, 0.04, 0.46, timber, [0, 0.86, 0.62]),
    // Pitched cyan roof gable
    (() => {
      const g = kit.gable(1.22, 1.04, 0.44, roof, { bodyMat: stone, trimMat: accent, overhang: 0.1, thickness: 0.07 });
      g.position.set(0, 1.3, -0.06);
      return g;
    })(),
  );

  // Ready paper dart sitting on the dispatch launch rail
  const readyDart = paperDart(kit, 0.55);
  readyDart.position.set(0, 0.94, 0.68);
  readyDart.rotation.x = -0.14;
  group.add(readyDart);

  // Spinning rooftop windsock/weathervane
  const vane = new Group();
  vane.position.set(0.38, 1.72, -0.2);
  vane.add(box(kit, 0.36, 0.04, 0.04, accent, [0, 0, 0], true));
  vane.add(box(kit, 0.12, 0.1, 0.03, kit.mat('worker', { rough: 0.5 }), [-0.14, 0, 0], true));
  body.add(kit.cylinder(0.02, 0.025, 0.34, ink, [0.38, 1.56, -0.2], 6));
  group.add(vane);

  const orc = orcCrew(kit, 'newsie', 0.88);
  orc.root.position.set(-0.5, 0.05, 0.56);
  orc.root.rotation.y = 0.25;
  group.add(orc.root);

  lamp.position.set(-0.4, 1.74, 0.46);
  body.add(kit.cylinder(0.022, 0.026, 0.22, ink, [-0.4, 1.6, 0.46], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    spin: [[vane, 'y', 2.4]],
    puff: new Vector3(0, 1.68, -0.06),
    labelY: 2.08,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      readyDart.position.y = 0.94 + Math.sin(time * 4.5) * 0.04 * run;
      orc.arms[0].rotation.x = -0.9 + Math.sin(time * 4.5) * 0.35 * run;
      orc.arms[1].rotation.x = -0.35;
    },
  };
}

// ---------- subagent kiosks (3 rotating print-shop kiosks) ----------

function newsstandKiosk(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const saffron = kit.mat('worker', { rough: 0.58 });
  const roof = kit.mat('roof', { rough: 0.58 });
  const accent = kit.mat('accent', { rough: 0.55 });
  const ink = kit.mat('ink', { rough: 0.62 });
  const paper = sheetMat(kit);

  body.add(
    kit.box(1.18, 0.1, 1.06, ink, [0, 0.09, 0]),
    kit.box(1.04, 0.78, 0.94, saffron, [0, 0.53, 0]),
    // Slanted cyan kiosk roof + vermilion front awning
    kit.box(1.22, 0.16, 1.12, roof, [0, 1.02, 0.02]),
    (() => {
      const awning = kit.box(1.16, 0.09, 0.34, accent, [0, 0.88, 0.54]);
      awning.rotation.x = 0.36;
      return awning;
    })(),
  );
  // Three crisp newspaper display bins along the front counter
  for (const x of [-0.32, 0, 0.32]) {
    body.add(kit.box(0.22, 0.2, 0.24, paper, [x, 0.66, 0.52]));
  }

  const orc = orcCrew(kit, 'newsie', 0.82);
  orc.root.position.set(0.64, 0.05, 0.22);
  orc.root.rotation.y = -0.8;
  group.add(orc.root);

  lamp.position.set(-0.46, 1.24, 0.44);
  body.add(kit.cylinder(0.02, 0.024, 0.16, ink, [-0.46, 1.14, 0.44], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    puff: new Vector3(0, 1.2, 0.2),
    labelY: 1.56,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      orc.body.position.y = 0.18 + Math.abs(Math.sin(time * 5.0)) * 0.025 * run;
      orc.arms[1].rotation.x = -0.8 + Math.sin(time * 5.0) * 0.45 * run;
    },
  };
}

function letterpressBench(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const brick = brickMat(kit, 'brick');
  const ink = kit.mat('ink', { rough: 0.56, metal: 0.25 });
  const timber = kit.mat('timber', { rough: 0.82 });
  const accent = kit.mat('accent', { rough: 0.55 });

  body.add(
    kit.box(1.16, 0.1, 1.04, ink, [0, 0.09, 0]),
    kit.box(0.98, 0.58, 0.86, brick, [0, 0.42, 0]),
    kit.box(1.04, 0.07, 0.92, timber, [0, 0.74, 0]),
    // Type proof sheet on the press bed
    kit.box(0.54, 0.025, 0.4, sheetMat(kit), [-0.04, 0.79, 0.04]),
    // Cast-iron press bridge gantry
    kit.box(0.1, 0.5, 0.1, ink, [-0.36, 1.0, -0.06]),
    kit.box(0.1, 0.5, 0.1, ink, [0.36, 1.0, -0.06]),
    kit.box(0.84, 0.11, 0.14, ink, [0, 1.24, -0.06]),
  );

  // Moving platen head + press lever
  const platen = box(kit, 0.46, 0.1, 0.34, accent, [0, 0.98, 0.02], true);
  const lever = new Group();
  lever.position.set(0.36, 1.18, 0.02);
  lever.add(box(kit, 0.05, 0.44, 0.05, ink, [0, 0.2, 0], true));
  lever.add(box(kit, 0.1, 0.09, 0.1, accent, [0, 0.42, 0], true));
  group.add(platen, lever);

  const orc = orcCrew(kit, 'press', 0.84);
  orc.root.position.set(-0.56, 0.05, 0.38);
  orc.root.rotation.y = 0.65;
  group.add(orc.root);

  lamp.position.set(-0.36, 1.4, -0.06);
  body.add(kit.cylinder(0.02, 0.024, 0.14, ink, [-0.36, 1.32, -0.06], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    puff: new Vector3(0, 1.12, 0.02),
    labelY: 1.72,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      const press = (0.5 + 0.5 * Math.sin(time * 4.2)) * run;
      platen.position.y = 1.0 - press * 0.14;
      lever.rotation.z = -0.35 - press * 0.55;
      orc.arms[1].rotation.x = -0.7 - press * 0.45;
    },
  };
}

function proofBooth(kit, group, lamp) {
  const body = new Group();
  group.add(body);
  const stone = kit.mat('body', { rough: 0.78 });
  const roof = kit.mat('roof', { rough: 0.56 });
  const accent = kit.mat('accent', { rough: 0.55 });
  const ink = kit.mat('ink', { rough: 0.6 });

  body.add(
    kit.box(1.14, 0.1, 1.02, ink, [0, 0.09, 0]),
    kit.box(0.92, 0.96, 0.84, stone, [0, 0.62, 0]),
    kit.box(1.0, 0.1, 0.92, roof, [0, 1.15, 0]),
    kit.box(0.94, 0.12, 0.05, accent, [0, 0.96, 0.43]),
    // Lit proofreader light-table window
    kit.box(0.62, 0.44, 0.05, ink, [0, 0.62, 0.42]),
    kit.box(0.5, 0.34, 0.04, kit.windows, [0, 0.62, 0.44]),
    kit.box(0.66, 0.06, 0.24, kit.mat('timber', { rough: 0.8 }), [0, 0.4, 0.52]),
  );

  // Spinning rooftop ventilator cap
  const vent = cyl(kit, 0.16, 0.19, 0.18, roof, [0, 1.3, -0.08], 8, true);
  group.add(vent);

  const orc = orcCrew(kit, 'visor', 0.82);
  orc.root.position.set(0.56, 0.05, 0.32);
  orc.root.rotation.y = -0.55;
  group.add(orc.root);

  lamp.position.set(0.38, 1.36, 0.34);
  body.add(kit.cylinder(0.02, 0.024, 0.16, ink, [0.38, 1.26, 0.34], 8));
  bakeInk(kit, body, 26);

  return {
    occupants: [orc.root],
    spin: [[vent, 'y', 3.2]],
    puff: new Vector3(0, 1.42, -0.08),
    labelY: 1.68,
    frame(time, _dt, station) {
      if (kit.reducedMotion) return;
      const run = station.activity || 0;
      orc.head.rotation.y = Math.sin(time * 2.8) * 0.22 * run;
      orc.arms[0].rotation.x = -0.6 + Math.sin(time * 6.0) * 0.25 * run;
    },
  };
}

const WORKERS = [rotaryPress, sawtoothStudio, dispatchLoft];
const KIOSKS = [newsstandKiosk, letterpressBench, proofBooth];

function station(kit, kind, spot = { index: 0 }) {
  const group = new Group();
  const lamp = new Mesh(new SphereGeometry(0.11, 12, 8), kit.lamp());
  const list = kind === 'worker' ? WORKERS : KIOSKS;
  const builder = list[(spot?.index || 0) % list.length];
  const built = builder(kit, group, lamp);
  group.add(lamp);
  group.userData = {
    lamp,
    occupants: built.occupants || [],
    spin: built.spin || [],
    swing: built.swing || [],
    puff: built.puff,
    labelY: built.labelY,
    frame: built.frame,
  };
  return kit.shadows(group);
}

// ---------- crate, carrier, packet, dock, ruin, decor, weather ----------

function crate(kit) {
  const bundle = new Group();
  const paper = kit.mat('crate', { rough: 0.84 });
  const topSheet = sheetMat(kit);
  const tape = kit.mat('tape', { rough: 0.55 });
  bundle.add(
    kit.box(0.46, 0.09, 0.34, paper, [0, -0.105, 0]),
    kit.box(0.46, 0.09, 0.34, paper, [0, 0, 0]),
    new Mesh(new BoxGeometry(0.46, 0.09, 0.34), [paper, paper, topSheet, paper, paper, paper]),
    kit.box(0.08, 0.31, 0.355, tape, [0, 0, 0]),
    kit.box(0.475, 0.31, 0.06, tape, [0, 0, 0]),
  );
  bundle.children[2].position.y = 0.105;
  bakeInk(kit, bundle, 26);
  return kit.shadows(bundle);
}

function carrier(kit) {
  const object = new Group();
  const dart = paperDart(kit, 1.18);
  object.add(dart);
  const hold = new Group();
  hold.position.y = -0.34;
  object.add(hold);
  return {
    object: kit.shadows(object),
    hold,
    route: 'air',
    cruise: 2.6,
    pose(target, { time = 0, speed = 0 } = {}) {
      if (kit.reducedMotion) {
        target.rotation.x = 0;
        target.rotation.z = 0;
        return;
      }
      target.rotation.x = 0.16 * speed;
      target.rotation.z = Math.sin(time * 4.2) * 0.1 * speed;
    },
  };
}

// Comic dispatch envelope outbound from the hall; proof sheet trailing home.
function packet(kit, direction) {
  const group = new Group();
  if (direction === 'down') {
    const body = kit.box(0.24, 0.04, 0.18, kit.mat('crate', { rough: 0.72, emissive: 'worker', glow: kit.mode === 'dark' ? 0.35 : 0.1 }));
    const seal = kit.box(0.07, 0.05, 0.07, kit.mat('accent', { rough: 0.45, emissive: 'accent', glow: kit.mode === 'dark' ? 0.6 : 0.2 }), [0, 0.01, 0]);
    group.add(body, seal);
  } else {
    group.add(kit.box(0.2, 0.03, 0.16, kit.mat('busy', { rough: 0.4, emissive: 'busy', glow: kit.mode === 'dark' ? 0.7 : 0.25 })));
  }
  bakeInk(kit, group, 26);
  return group;
}

// Timber loading dock beside the print house, keeping the delivery drop zone clear.
function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  group.add(kit.shadow(2.35, 1.75, 0.3, [0, 0.004, 0]));
  const timber = kit.mat('timber', { rough: 0.84 });
  const ink = kit.mat('ink', { rough: 0.65 });
  const accent = kit.mat('accent', { rough: 0.55 });
  const base = kit.box(2.0, 0.07, 1.38, ink, [0, 0.035, 0]);
  base.receiveShadow = !kit.software;
  group.add(base);
  for (let i = -2; i <= 2; i += 1) {
    const plank = kit.box(1.88, 0.035, 0.21, timber, [0, 0.082, i * 0.245]);
    plank.receiveShadow = !kit.software;
    group.add(plank);
  }
  for (const [x, z] of [[-0.94, -0.64], [0.94, -0.64], [-0.94, 0.64], [0.94, 0.64]]) {
    group.add(
      kit.box(0.09, 0.24, 0.09, timber, [x, 0.15, z]),
      kit.box(0.11, 0.05, 0.11, accent, [x, 0.28, z]),
    );
  }
  // Spare newsprint roll & paper pallet tucked neatly behind the dock's drop zone.
  const spareRoll = newsprintRoll(kit, 0.28, 0.76, false);
  spareRoll.rotation.z = Math.PI / 2;
  spareRoll.position.set(-0.36, 0.34, -1.18);
  group.add(spareRoll);
  const stack = new Group();
  stack.position.set(0.68, 0, -1.35);
  stack.add(
    kit.box(1.24, 0.08, 0.76, timber, [0, 0.04, 0]),
    kit.box(0.48, 0.58, 0.48, kit.mat('crate', { rough: 0.86 }), [-0.28, 0.37, 0]),
    kit.box(0.48, 0.76, 0.48, kit.mat('crate', { rough: 0.86 }), [0.28, 0.46, 0]),
  );
  group.add(stack);

  bakeInk(kit, group, 26);
  return kit.shadows(group);
}

// "STOP PRESS" cordon and stray loose newsprint pages round a decommissioned station.
function ruin(kit, kind, spot = { slot: 0 }) {
  const group = new Group();
  const { tape, sign } = stopPressLooks(kit);
  const wide = kind === 'worker' ? 1.01 : 0.92;
  const deep = kind === 'worker' ? 0.9 : 0.82;
  const h = 0.48;
  const seed = (spot?.slot || 0) + 1;
  const timber = kit.mat('timber', { rough: 0.82 });
  const ink = kit.mat('ink', { rough: 0.65 });

  const posts = new Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    posts.add(
      kit.box(0.075, 0.62, 0.075, timber, [sx * wide, 0.31, sz * deep]),
      kit.box(0.11, 0.055, 0.11, ink, [sx * wide, 0.64, sz * deep]),
    );
  }
  bakeInk(kit, posts, 26);
  group.add(kit.shadows(posts));

  const stub = wide * 0.64;
  const band = (len) => new Mesh(new BoxGeometry(len, 0.075, 0.012), tape);
  const backTape = band(wide * 2);
  backTape.position.set(0, h, -deep);
  const leftTape = band(deep * 2);
  leftTape.rotation.y = Math.PI / 2;
  leftTape.position.set(-wide, h, 0);
  const rightTape = band(deep * 2);
  rightTape.rotation.y = Math.PI / 2;
  rightTape.position.set(wide, h - 0.02, 0);
  const frontStub = band(stub);
  frontStub.position.set(wide - stub / 2, h, deep);
  frontStub.rotation.z = 0.03;
  group.add(backTape, leftTape, rightTape, frontStub);

  // Snapped ribbon end stirring in the rooftop breeze
  const flap = new Group();
  flap.position.set(-wide, h, deep);
  const loose = band(0.48);
  loose.position.x = 0.24;
  flap.add(loose);
  flap.rotation.z = -1.06;
  group.add(flap);

  // "STOP PRESS" comic plaque hanging on the front cordon
  const plaque = new Mesh(new PlaneGeometry(0.5, 0.18), sign);
  plaque.position.set(wide - stub * 0.5, h - 0.12, deep + 0.025);
  plaque.rotation.z = (seed % 2 ? 1 : -1) * 0.08;
  group.add(plaque);

  // Stray newsprint pages scattered beside the cordoned pad
  const pageMat = sheetMat(kit);
  const pages = new Group();
  const spots = [
    [-wide - 0.18, 0.025, 0.32, 0.24],
    [-wide - 0.26, 0.028, -0.18, -0.46],
    [wide + 0.16, 0.025, 0.42, 0.62],
  ];
  for (const [px, py, pz, ry] of spots) {
    const page = new Mesh(new PlaneGeometry(0.28, 0.22), pageMat);
    page.rotation.set(-Math.PI / 2, 0, ry);
    page.position.set(px, py, pz);
    pages.add(page);
  }
  group.add(pages);

  group.userData.frame = (time, _dt, station) => {
    const weathered = Math.max(0, Math.min(1, station?.weathered ?? 0));
    pages.scale.setScalar(0.7 + weathered * 0.35);
    if (kit.reducedMotion) return;
    flap.rotation.z = -1.06 + Math.sin(time * 2.4 + seed) * 0.07;
    flap.rotation.y = Math.sin(time * 1.5 + seed * 2) * 0.22;
  };
  return group;
}

// Rooftop parapet, giant newsprint rolls, wooden water towers, cast-iron
// streetlamps and the stepped Art Deco city skyline beyond the rooftop.
function decor(kit) {
  const group = new Group();
  const ink = kit.mat('ink', { rough: 0.62 });
  const stone = kit.mat('body', { rough: 0.8 });

  // Stepped rooftop parapet flanking the print house (clear of all 24 slots)
  const parapet = new Group();
  for (const [x, w] of [[-7.2, 4.4], [-3.8, 1.8], [5.8, 4.6], [9.4, 2.2]]) {
    parapet.add(
      kit.box(w, 0.42, 0.36, stone, [x, 0.21, -7.15]),
      kit.box(w + 0.1, 0.1, 0.44, ink, [x, 0.47, -7.15]),
    );
  }
  bakeInk(kit, parapet, 26);
  group.add(parapet);

  // Giant upright newsprint rolls beside the print house (replacing stock cylinders)
  for (const [x, z, r, h] of [[-3.55, -5.55, 0.38, 0.9], [-4.35, -4.95, 0.34, 0.8]]) {
    const roll = newsprintRoll(kit, r, h);
    roll.position.set(x, 0, z);
    group.add(roll);
  }

  // Rooftop water towers flanking the back parapet
  for (const [x, z, s] of [[-6.5, -7.35, 1.05], [7.8, -7.35, 0.98]]) {
    const wt = waterTower(kit, s);
    wt.position.set(x, 0, z);
    group.add(wt);
  }

  // Cast-iron streetlamps along the rooftop edges
  for (const [x, z, facing] of [[-7.4, -5.2, 1], [7.6, -5.2, -1], [-10.1, 5.4, 1], [10.1, 5.4, -1]]) {
    const lamp = streetLamp(kit, facing);
    lamp.position.set(x, 0, z);
    group.add(lamp);
  }

  // Stepped Art Deco skyline rising behind the rooftop
  const towers = [
    [-16.2, -13.6, 3.6, 9.2, 2.8, 0],
    [-11.2, -14.2, 3.2, 11.4, 2.8, 1],
    [-6.6, -13.4, 3.4, 9.8, 2.6, 2],
    [-1.4, -14.8, 3.8, 12.2, 3.0, 0],
    [3.8, -13.8, 3.3, 10.4, 2.8, 1],
    [8.8, -14.4, 3.6, 11.6, 2.8, 2],
    [14.0, -13.6, 3.4, 9.4, 2.8, 0],
    [18.6, -14.2, 3.4, 10.6, 2.6, 1],
  ];
  const skylineGroup = new Group();
  for (const [tx, tz, tw, th, td, v] of towers) {
    const faceMat = towerMat(kit, v);
    const crownMat = kit.mat(v % 2 === 0 ? 'tower' : 'towerAlt', { rough: 0.82 });
    const base = new Mesh(new BoxGeometry(tw, th, td), [faceMat, faceMat, crownMat, crownMat, faceMat, faceMat]);
    base.position.set(tx, th / 2 - 2.4, tz);
    skylineGroup.add(base);
    // Art Deco setback crown + optional spire
    const stepH = 1.15;
    skylineGroup.add(kit.box(tw * 0.66, stepH, td * 0.66, crownMat, [tx, th - 2.4 + stepH / 2, tz]));
    if (v === 1) {
      skylineGroup.add(kit.cylinder(0.04, 0.08, 1.9, ink, [tx, th - 2.4 + stepH + 0.95, tz], 6));
    }
  }
  bakeInk(kit, skylineGroup, 26);
  group.add(skylineGroup);

  return kit.shadows(group);
}

// High-flying patrol paper dart circling gently over the print-shop rooftop.
function weather(kit) {
  const root = new Group();
  const patrol = paperDart(kit, 1.32);
  // Rest pose at top-left so even reduced-motion shots show the skyline dart.
  const placeAt = (angle) => {
    const x = Math.cos(angle) * 8.2;
    const z = -5.6 + Math.sin(angle) * 3.2;
    const y = 5.1 + Math.sin(angle * 2) * 0.28;
    const dx = -Math.sin(angle) * 8.2;
    const dz = Math.cos(angle) * 3.2;
    patrol.position.set(x, y, z);
    patrol.rotation.set(0.06, Math.atan2(dx, dz), -0.18);
  };
  placeAt(2.48);
  root.add(patrol);

  return {
    object: kit.shadows(root),
    frame(time) {
      if (kit.reducedMotion) return;
      placeAt(2.48 + time * 0.24);
    },
    dispose() {},
  };
}

// Gently scrolls the runway chevrons only while packets or deliveries are in flight.
function frame(_time, _dt, kit) {
  if (kit.reducedMotion) return;
  const runway = kit.materials.get('comic:aisle');
  if (runway?.map && kit.traffic?.flow > 0.001) {
    runway.map.offset.y = -(kit.traffic.clock * 0.45) % 1;
  }
}

export default {
  palette: PALETTE,
  backdrop: BACKDROP,
  view,
  floor,
  hall,
  pad,
  ghost,
  station,
  crate,
  carrier,
  packet,
  dock,
  ruin,
  decor,
  weather,
  frame,
};
