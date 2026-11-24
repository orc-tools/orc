// Orcsoft 97 Factory skin: the floor is a desktop seen from above. The main
// agent is a giant beige PC whose floppy drive takes the deliveries; workers
// are workstations with a program standing out of the screen (a paint program,
// a mine game, a defragmenter) and subagents are desk things (printer, notepad
// with a pencil helper, disk drive, recycle bin). The aisle is a progress bar,
// the pointer drags each finished floppy home, and every job ends in a dialog.
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, NearestFilter,
  PlaneGeometry, Shape, Vector3,
} from 'three';

const FONT = '"MS Sans Serif", Tahoma, Verdana, sans-serif';

const PALETTE = {
  light: {
    ground: '#008080',
    horizon: '#00767a',
    zenith: '#cfe2f5',
    sky: '#e6f0fa',
    sun: '#fffaf0',
    glow: '#1084d0',
    aisle: '#c0c0c0',
    line: '#005e5e',
    body: '#c0c0c0',
    trim: '#808080',
    roof: '#dfdfdf',
    accent: '#000080',
    worker: '#ddd5b8',
    busy: '#ffd800',
    ok: '#00b800',
    fail: '#dc0000',
    idle: '#808080',
    crate: '#193a8a',
    tape: '#cdd2dc',
    smoke: '#f0f0f0', moss: '#9a9fa8',
    window: '#ffffe1',
    door: '#14161c',
    highlight: '#ffffff',
    hilite: '#dfdfdf',
    shadow: '#808080',
    darkEdge: '#404040',
    abyss: '#0a0a0a',
    titleStart: '#000080',
    titleEnd: '#1084d0',
    paper: '#ffffff',
    beige: '#ddd5b8',
    beigeShade: '#b8b094',
    manila: '#ebc86e',
    manilaLight: '#f6df98',
    screenBg: '#001e24',
    ink: '#000000',
    tip: '#ffffe1',
    sunIntensity: 2.35,
    skyIntensity: 1.32,
    envIntensity: 0.45,
    exposure: 1.02,
    fogNear: 8,
    fogSpan: 26,
  },
  dark: {
    ground: '#003c3c',
    horizon: '#052c30',
    zenith: '#111620',
    sky: '#7f98b8',
    sun: '#dfe8ff',
    glow: '#62c8ee',
    aisle: '#2f3238',
    line: '#075252',
    body: '#3a3e47',
    trim: '#5c616b',
    roof: '#4d525e',
    accent: '#2a56a8',
    worker: '#a49c82',
    busy: '#f0d060',
    ok: '#7ee07e',
    fail: '#ff7b7b',
    idle: '#666b75',
    crate: '#22428c',
    tape: '#aeb4c0',
    smoke: '#9da2ab', moss: '#8b9099',
    window: '#f0d060',
    door: '#090a0e',
    highlight: '#7a808d',
    hilite: '#525864',
    shadow: '#1e2026',
    darkEdge: '#121418',
    abyss: '#050608',
    titleStart: '#152f66',
    titleEnd: '#2b6cb0',
    paper: '#1b1e24',
    beige: '#9c947c',
    beigeShade: '#736d5a',
    manila: '#cca956',
    manilaLight: '#dfc274',
    screenBg: '#051518',
    ink: '#e8ecf2',
    tip: '#4a4630',
    sunIntensity: 2.2,
    skyIntensity: 1.4,
    envIntensity: 0.55,
    exposure: 1.1,
    fogNear: 8,
    fogSpan: 26,
  },
};

const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const CACHE = new WeakMap();
const memo = (kit, key, fn) => {
  let bag = CACHE.get(kit);
  if (!bag) {
    bag = {};
    CACHE.set(kit, bag);
  }
  return (bag[key] ??= fn());
};

const css = color => `#${color.getHexString()}`;

function drawWinBevel(ctx, x, y, w, h, sunken = false, hi = '#ffffff', midHi = '#dfdfdf', sh = '#808080', dk = '#0a0a0a') {
  const tlOuter = sunken ? sh : hi;
  const tlInner = sunken ? dk : midHi;
  const brOuter = sunken ? hi : dk;
  const brInner = sunken ? midHi : sh;
  ctx.fillStyle = tlOuter;
  ctx.fillRect(x, y, w - 1, 2);
  ctx.fillRect(x, y, 2, h - 1);
  ctx.fillStyle = brOuter;
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = tlInner;
  ctx.fillRect(x + 2, y + 2, w - 5, 2);
  ctx.fillRect(x + 2, y + 2, 2, h - 5);
  ctx.fillStyle = brInner;
  ctx.fillRect(x + 2, y + h - 4, w - 4, 2);
  ctx.fillRect(x + w - 4, y + 2, 2, h - 4);
}

function bevelBox(kit, group, w, h, d, at, fill = 'body', sunken = false) {
  const [x, y, z] = at;
  group.add(kit.box(w, h, d, kit.mat(fill, { rough: 0.78, metal: 0.06 }), at));
  const tl = kit.mat(sunken ? 'darkEdge' : 'hilite', { rough: 0.72 });
  const br = kit.mat(sunken ? 'highlight' : 'darkEdge', { rough: 0.78 });
  const edge = Math.min(0.045, w * 0.07, h * 0.07);
  const fz = z + d / 2 + 0.005;
  group.add(kit.box(w, edge, 0.01, tl, [x, y + h / 2 - edge / 2, fz]));
  group.add(kit.box(edge, h, 0.01, tl, [x - w / 2 + edge / 2, y, fz]));
  group.add(kit.box(w, edge, 0.01, br, [x, y - h / 2 + edge / 2, fz]));
  group.add(kit.box(edge, h, 0.01, br, [x + w / 2 - edge / 2, y, fz]));
  return group;
}

function plane(w, h, mat, at) {
  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.position.set(...at);
  return mesh;
}

function pixelHourglass(kit, scale = 1) {
  const group = new Group();
  const cap = kit.mat('abyss', { rough: 0.7 });
  const frame = kit.mat('ink', { rough: 0.65 });
  const glass = kit.mat('#e8f6ff', { rough: 0.28, metal: 0.1, opacity: 0.86 });
  const sand = kit.mat('busy', { rough: 0.5, emissive: 'busy', glow: 0.25 });

  for (const sy of [-1, 1]) {
    group.add(kit.box(0.38, 0.06, 0.22, cap, [0, sy * 0.27, 0]));
    group.add(kit.box(0.32, 0.04, 0.18, frame, [0, sy * 0.22, 0]));
    group.add(kit.box(0.26, 0.07, 0.15, glass, [0, sy * 0.165, 0]));
    group.add(kit.box(0.18, 0.06, 0.12, glass, [0, sy * 0.1, 0]));
    group.add(kit.box(0.1, 0.05, 0.09, glass, [0, sy * 0.045, 0]));
  }
  for (const sx of [-0.15, 0.15]) group.add(kit.box(0.03, 0.44, 0.03, frame, [sx, 0, 0]));
  group.add(kit.box(0.2, 0.05, 0.11, sand, [0, -0.16, 0]));
  group.add(kit.box(0.14, 0.04, 0.09, sand, [0, 0.12, 0]));
  group.add(kit.box(0.035, 0.18, 0.035, sand, [0, -0.02, 0]));
  group.scale.setScalar(scale);
  return group;
}

function drawCaptionButton(ctx, x, y, w, h, glyph) {
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(x, y, w, h);
  drawWinBevel(ctx, x, y, w, h, false);
  ctx.fillStyle = '#000000';
  if (glyph === '_') {
    ctx.fillRect(x + 8, y + h - 11, w - 18, 5);
  } else if (glyph === 'max') {
    ctx.fillRect(x + 7, y + 7, w - 14, 5);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 8, y + 9, w - 16, h - 17);
  } else {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 9);
    ctx.lineTo(x + w - 9, y + h - 9);
    ctx.moveTo(x + w - 9, y + 9);
    ctx.lineTo(x + 9, y + h - 9);
    ctx.stroke();
  }
}

// ---------- shared pieces ----------

const TAU = Math.PI * 2;
const layout = { turn: 0.6 };
// Looked down on, the floor reads as a desktop.
const view = { elevation: 0.68, azimuth: 0.03 };
const yawOf = side => (side > 0 ? -1 : 1) * (Math.PI / 2 - layout.turn);

function bagOf(kit) {
  return memo(kit, 'bag', () => ({ segments: [] }));
}

function dialogMaterial(kit, key, title, text, glyph) {
  return memo(kit, `dialog:${key}`, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, 0, w, h);
    drawWinBevel(ctx, 0, 0, w, h, false);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#000080');
    grad.addColorStop(1, '#1084d0');
    ctx.fillStyle = grad;
    ctx.fillRect(6, 6, w - 12, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 20px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 14, 22);
    drawCaptionButton(ctx, w - 38, 9, 28, 24, 'x');
    const cx = 52;
    const cy = 82;
    if (glyph === 'error') {
      ctx.fillStyle = '#dc0000';
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy - 12);
      ctx.lineTo(cx + 12, cy + 12);
      ctx.moveTo(cx + 12, cy - 12);
      ctx.lineTo(cx - 12, cy + 12);
      ctx.stroke();
    } else if (glyph === 'ok') {
      ctx.strokeStyle = '#00a000';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy);
      ctx.lineTo(cx - 6, cy + 18);
      ctx.lineTo(cx + 24, cy - 22);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ebc86e';
      ctx.fillRect(cx - 26, cy - 12, 52, 36);
      ctx.fillRect(cx - 26, cy - 22, 24, 12);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 26, cy - 12, 52, 36);
    }
    ctx.fillStyle = '#000000';
    ctx.font = `20px ${FONT}`;
    ctx.fillText(text, 96, 82);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(w / 2 - 44, h - 46, 88, 32);
    drawWinBevel(ctx, w / 2 - 44, h - 46, 88, 32, false);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('OK', w / 2, h - 29);
  }, { width: 320, height: 176, nearest: true, rough: 0.7, emissive: true, glow: kit.mode === 'dark' ? 0.55 : 0.2 }));
}

// A dialog box that pops up over its owner, facing the camera whatever way the
// owner is turned.
function popup(kit, material, yaw, at, width = 1.0) {
  const node = new Group();
  node.position.set(...at);
  node.rotation.y = -yaw;
  const height = width * 0.55;
  node.add(kit.box(width, height, 0.05, kit.mat('abyss', { rough: 0.8 }), [0.03, -0.03, -0.03]));
  node.add(plane(width, height, material, [0, 0, 0]));
  node.visible = false;
  return node;
}

// Pops in, holds for `hold` seconds, then closes; with no hold it stays up.
function popLevel(age, hold = Infinity) {
  if (!(age >= 0)) return 0;
  if (age === Infinity) return hold === Infinity ? 1 : 0;
  const opening = Math.min(1, age / 0.22);
  const closing = hold === Infinity ? 1 : Math.max(0, Math.min(1, (hold + 0.2 - age) / 0.2));
  return (1 + 0.25 * Math.sin(opening * Math.PI)) * opening * closing;
}

function show(node, level, size = 1) {
  node.visible = level > 0.01;
  if (node.visible) node.scale.setScalar(level * size);
}

// ---------- floor ----------

const BAR_FROM = -3.3;
const BAR_STEP = 0.52;
const BAR_COUNT = 25;

function pad(kit, kind, lampMat) {
  const group = new Group();
  const wide = kind === 'worker' ? 1.84 : 1.6;
  const deep = kind === 'worker' ? 1.64 : 1.44;
  group.add(kit.shadow(wide + 0.4, deep + 0.4, 0.26, [0, 0.004, 0]));
  // The dotted focus rectangle of a selected desktop icon.
  const dot = kit.basic('highlight', { opacity: 0.9 });
  for (let i = 0; i < 12; i += 1) {
    const t = (i + 0.5) / 12 - 0.5;
    group.add(kit.box(wide / 20, 0.008, 0.03, dot, [t * wide, 0.012, -deep / 2]));
    group.add(kit.box(wide / 20, 0.008, 0.03, dot, [t * wide, 0.012, deep / 2]));
    group.add(kit.box(0.03, 0.008, deep / 20, dot, [-wide / 2, 0.012, t * deep]));
    group.add(kit.box(0.03, 0.008, deep / 20, dot, [wide / 2, 0.012, t * deep]));
  }
  const tile = kit.box(wide - 0.1, 0.012, deep - 0.1, kit.basic('accent', { opacity: 0.34 }), [0, 0.008, 0]);
  group.add(tile);
  // Its caption wears the agent's state colour.
  if (lampMat) group.add(kit.box(wide * 0.62, 0.05, 0.2, lampMat, [0, 0.03, deep / 2 + 0.16]));
  return group;
}

function ghost(kit) {
  const group = new Group();
  const dot = kit.basic('highlight', { opacity: 0.8 });
  for (let i = 0; i < 8; i += 1) {
    const t = (i + 0.5) / 8 - 0.5;
    for (const y of [0.06, 1.0]) {
      group.add(kit.box(0.08, 0.03, 0.03, dot, [t * 1.2, y, -0.5]));
      group.add(kit.box(0.08, 0.03, 0.03, dot, [t * 1.2, y, 0.5]));
    }
  }
  const glass = pixelHourglass(kit, 1.5);
  glass.position.y = 0.56;
  group.add(glass);
  return group;
}

function floor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const groundHex = css(kit.palette.ground);
  const dotHex = dark ? '#0b5a5a' : '#1a9898';

  const disc = kit.ground({
    radius: 68,
    repeat: [36, 36],
    rough: 0.92,
    metal: 0.02,
    draw(ctx, w, h) {
      ctx.fillStyle = groundHex;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dotHex;
      for (let y = 16; y < h; y += 64) {
        for (let x = 16; x < w; x += 64) {
          ctx.fillRect(x - 2, y, 6, 2);
          ctx.fillRect(x, y - 2, 2, 6);
        }
      }
    },
  });
  if (disc.material.map) {
    disc.material.map.magFilter = NearestFilter;
    disc.material.map.minFilter = NearestFilter;
    disc.material.map.generateMipmaps = false;
  }
  group.add(disc);

  // The aisle is a progress bar that fills towards the computer.
  const length = BAR_COUNT * BAR_STEP + 0.2;
  const middle = BAR_FROM + length / 2 - 0.1;
  const well = kit.box(1.7, 0.02, length, kit.mat(dark ? '#16181d' : '#ffffff', { rough: 0.8 }), [0, 0.01, middle]);
  well.receiveShadow = !kit.software;
  group.add(well);
  const lightEdge = kit.mat('highlight', { rough: 0.65 });
  const darkEdge = kit.mat('darkEdge', { rough: 0.82 });
  group.add(kit.box(0.08, 0.05, length + 0.16, darkEdge, [-0.89, 0.025, middle]));
  group.add(kit.box(0.08, 0.05, length + 0.16, lightEdge, [0.89, 0.025, middle]));
  group.add(kit.box(1.86, 0.05, 0.08, darkEdge, [0, 0.025, BAR_FROM - 0.14]));
  group.add(kit.box(1.86, 0.05, 0.08, lightEdge, [0, 0.025, BAR_FROM + length - 0.06]));
  const fill = kit.mat('accent', { rough: 0.5, emissive: 'glow', glow: dark ? 0.35 : 0.08 });
  const bag = bagOf(kit);
  bag.segments = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const block = kit.box(1.5, 0.05, BAR_STEP - 0.1, fill, [0, 0.045, BAR_FROM + (BAR_COUNT - 1 - i) * BAR_STEP + 0.2]);
    block.receiveShadow = !kit.software;
    group.add(block);
    bag.segments.push(block);
  }
  return group;
}

// The bar is the crew's real progress: the share of its agents that have closed.
function frame(_time, _dt, kit) {
  const { segments } = bagOf(kit);
  const filled = Math.round(kit.traffic.progress * segments.length);
  for (let i = 0; i < segments.length; i += 1) segments[i].visible = i < filled;
}

// ---------- hall ----------

function screenMaterial(kit) {
  return memo(kit, 'hallScreen', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#008080';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i += 1) {
      const y = 22 + i * 62;
      ctx.fillStyle = ['#ebc86e', '#c0c0c0', '#ffffff', '#ebc86e'][i];
      ctx.fillRect(18, y, 30, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(10, y + 30, 46, 6);
    }
    const x0 = 86;
    const y0 = 34;
    const ww = w - x0 - 22;
    const wh = h - 96;
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(x0, y0, ww, wh);
    drawWinBevel(ctx, x0, y0, ww, wh, false);
    const grad = ctx.createLinearGradient(x0, 0, x0 + ww, 0);
    grad.addColorStop(0, '#000080');
    grad.addColorStop(1, '#1084d0');
    ctx.fillStyle = grad;
    ctx.fillRect(x0 + 6, y0 + 6, ww - 12, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 20px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('Orc Factory.exe', x0 + 14, y0 + 22);
    drawCaptionButton(ctx, x0 + ww - 38, y0 + 9, 28, 24, 'x');
    ctx.fillStyle = '#000000';
    ctx.font = `18px ${FONT}`;
    ctx.fillText('Copying results to main...', x0 + 22, y0 + 64);
    for (const fx of [x0 + 40, x0 + ww - 96]) {
      ctx.fillStyle = '#ebc86e';
      ctx.fillRect(fx, y0 + 96, 56, 38);
      ctx.fillRect(fx, y0 + 86, 26, 12);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(fx, y0 + 96, 56, 38);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 + 22, y0 + wh - 56, ww - 44, 32);
    drawWinBevel(ctx, x0 + 22, y0 + wh - 56, ww - 44, 32, true);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, h - 38, w, 38);
    drawWinBevel(ctx, 0, h - 38, w, 38, false);
    ctx.fillRect(8, h - 32, 84, 26);
    drawWinBevel(ctx, 8, h - 32, 84, 26, false);
    ctx.fillStyle = '#000000';
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('Start', 34, h - 18);
    ctx.fillStyle = '#00a000';
    ctx.fillRect(14, h - 27, 14, 16);
    drawWinBevel(ctx, w - 96, h - 32, 88, 26, true);
    ctx.font = `16px ${FONT}`;
    ctx.fillText('4:20 PM', w - 82, h - 18);
  }, { width: 512, height: 384, nearest: true, rough: 0.3, emissive: true, glow: kit.mode === 'dark' ? 0.5 : 0.4 }));
}

function hall(kit) {
  const group = new Group();
  const beige = kit.mat('beige', { rough: 0.62, metal: 0.04 });
  const shade = kit.mat('beigeShade', { rough: 0.7 });
  const abyss = kit.mat('abyss', { rough: 0.8 });
  group.add(kit.shadow(5.8, 4.0, 0.36));

  // The desktop case is the plinth; its floppy drive takes the deliveries.
  const caseH = 0.92;
  group.add(kit.box(4.7, caseH, 2.8, beige, [0, caseH / 2, 0]));
  group.add(kit.box(4.74, 0.08, 2.84, shade, [0, 0.04, 0]));
  group.add(kit.box(4.6, 0.03, 0.02, shade, [0, caseH - 0.14, 1.41]));
  group.add(kit.box(1.62, 0.44, 0.04, shade, [0, 0.42, 1.41]));
  group.add(kit.box(1.4, 0.3, 0.06, abyss, [0, 0.44, 1.41]));
  const flapGeo = new BoxGeometry(1.38, 0.28, 0.04);
  flapGeo.translate(0, -0.14, 0);
  const door = new Mesh(flapGeo, kit.mat('tape', { rough: 0.3, metal: 0.6 }));
  door.position.set(0, 0.58, 1.45);
  group.add(door);
  group.add(kit.box(0.2, 0.08, 0.05, shade, [0.56, 0.2, 1.42]));
  group.add(kit.box(0.12, 0.05, 0.04, kit.mat('ok', { emissive: 'ok', glow: 0.9 }), [-0.62, 0.2, 1.42]));
  // Power button and badge on the left, a blanked bay and vents on the right.
  group.add(kit.cylinder(0.14, 0.14, 0.06, shade, [-1.8, 0.5, 1.42], 14).rotateX(Math.PI / 2));
  group.add(kit.box(0.34, 0.12, 0.03, kit.windows, [-1.8, 0.24, 1.41]));
  group.add(kit.box(1.0, 0.3, 0.03, shade, [1.62, 0.62, 1.41]));
  for (let i = 0; i < 5; i += 1) group.add(kit.box(1.0, 0.03, 0.03, abyss, [1.62, 0.16 + i * 0.07, 1.41]));

  // A CRT as tall as the hall should be.
  const neckY = caseH + 0.12;
  group.add(kit.cylinder(0.9, 1.1, 0.24, shade, [0, neckY, -0.1], 18));
  const bodyY = neckY + 0.12 + 1.3;
  group.add(kit.box(3.9, 2.6, 0.7, beige, [0, bodyY, 0.5]));
  group.add(kit.box(3.3, 2.2, 1.0, beige, [0, bodyY, -0.3]));
  group.add(kit.box(2.4, 1.7, 0.6, shade, [0, bodyY - 0.05, -0.95]));
  group.add(kit.box(3.36, 2.14, 0.04, abyss, [0, bodyY + 0.1, 0.84]));
  const screen = new Group();
  screen.position.set(0, bodyY + 0.1, 0.87);
  screen.add(plane(3.24, 2.02, screenMaterial(kit), [0, 0, 0]));
  group.add(screen);
  group.add(kit.box(0.5, 0.07, 0.03, shade, [0, bodyY - 1.14, 0.86]));
  group.add(kit.box(0.08, 0.05, 0.04, kit.mat('ok', { emissive: 'ok', glow: 1 }), [1.6, bodyY - 1.14, 0.86]));

  // Live parts of the screen: the progress blocks and the page that flies
  // from one folder to the other.
  const fill = kit.mat('accent', { rough: 0.4, emissive: 'glow', glow: 0.5 });
  const blocks = Array.from({ length: 12 }, (_, i) => {
    const block = plane(0.15, 0.13, fill, [-0.83 + i * 0.185, -0.53, 0.012]);
    screen.add(block);
    return block;
  });
  const page = plane(0.2, 0.26, kit.mat('#ffffff', { rough: 0.6, emissive: '#ffffff', glow: 0.5, doubleSide: true }), [0, 0, 0.03]);
  screen.add(page);

  const top = bodyY + 1.3;
  group.add(kit.box(0.06, 0.4, 0.06, shade, [1.3, top + 0.2, 0.2]));
  const beacon = kit.box(0.5, 0.5, 0.12, kit.beacon, [1.3, top + 0.62, 0.2]);
  beacon.rotation.z = Math.PI / 4;
  group.add(beacon);

  // A mouse on its cord, to the left where the dock is not.
  const mouse = new Group();
  mouse.position.set(-3.15, 0, 0.9);
  mouse.rotation.y = 0.5;
  mouse.add(kit.box(0.62, 0.2, 0.9, beige, [0, 0.1, 0]));
  mouse.add(kit.box(0.56, 0.08, 0.5, beige, [0, 0.22, 0.1]));
  const buttons = [-1, 1].map(side => {
    const button = kit.box(0.27, 0.05, 0.34, shade, [side * 0.145, 0.22, -0.26]);
    mouse.add(button);
    return button;
  });
  group.add(mouse);
  group.add(kit.box(0.05, 0.05, 1.0, shade, [-2.75, 0.03, 0.05]).rotateY(-0.5));

  const received = popup(kit, dialogMaterial(kit, 'received', 'Copy', '1 file received', 'folder'), 0, [1.75, top + 0.2, 1.3], 1.9);
  const starting = popup(kit, dialogMaterial(kit, 'starting', 'Run', 'Starting task...', 'folder'), 0, [-1.75, top + 0.2, 1.3], 1.9);
  group.add(received, starting);

  let receivedAt = -Infinity;
  let startingAt = -Infinity;
  let clock = 0;
  group.userData = {
    door,
    beacon,
    chimney: new Vector3(-1.2, bodyY + 0.9, -1.2),
    labelY: top + 1.35,
    react(event) {
      if (event === 'delivery') receivedAt = clock;
      else startingAt = clock;
    },
    frame(time, _dt, main, reducedMotion) {
      clock = time;
      const working = main.state === 'working';
      const shown = reducedMotion ? (working ? 7 : 12) : working ? Math.floor(time * 5) % 14 : main.state === 'done' ? 12 : 0;
      blocks.forEach((block, i) => { block.visible = i < shown; });
      page.visible = working && !reducedMotion;
      if (page.visible) {
        const t = (time * 0.7) % 1;
        page.position.set(-0.72 + t * 1.44, 0.1 + Math.sin(t * Math.PI) * 0.36, 0.03);
        page.rotation.z = -t * TAU;
      }
      show(received, popLevel(time - receivedAt, 1.5));
      show(starting, popLevel(time - startingAt, 1.1));
      buttons[0].position.y = time - startingAt < 0.25 ? 0.19 : 0.22;
    },
  };
  return kit.shadows(group);
}

// ---------- stations ----------

// Every station ends the same way: a dialog box. A tick that shrinks to a
// badge when the job is done, an error that stays up when it fails.
// `occupants` are the characters that leave a decommissioned station.
function program(group, spot, { lamp, labelY, puff, top, run, occupants = [] }) {
  const kit = group.userData.kit;
  const yaw = yawOf(spot.side);
  const error = popup(kit, dialogMaterial(kit, 'error', 'Error', 'Task failed', 'error'), yaw, [0, top - 0.45, 0.6], 1.1);
  const done = popup(kit, dialogMaterial(kit, 'done', 'Done', 'Task complete', 'ok'), yaw, [0, top - 0.45, 0.6], 1.1);
  group.add(error, done);
  group.userData = {
    lamp,
    occupants,
    puff,
    labelY,
    frame(time, dt, station) {
      const failed = station.state === 'failed';
      const finished = station.state === 'done';
      show(error, failed ? popLevel(time - station.failedAt) : 0);
      error.rotation.z = failed ? Math.sin(time * 2.2 + spot.slot) * 0.05 : 0;
      const since = time - station.doneAt;
      show(done, finished ? Math.max(popLevel(since, 1.6), since > 1.7 ? 0.42 : 0) : 0);
      run(time + spot.slot * 1.7, station.activity, { failed, finished, dt });
    },
  };
  return group;
}

function statusLight(kit, group, at) {
  const lamp = kit.box(0.17, 0.17, 0.17, kit.lamp(), at);
  group.add(kit.box(0.23, 0.05, 0.23, kit.mat('darkEdge', { rough: 0.8 }), [at[0], at[1] - 0.11, at[2]]));
  group.add(lamp);
  return lamp;
}

// A workstation whose program stands out of its screen in relief.
function workstation(kit) {
  const group = new Group();
  group.userData.kit = kit;
  const beige = kit.mat('beige', { rough: 0.62, metal: 0.04 });
  const shade = kit.mat('beigeShade', { rough: 0.7 });
  group.add(kit.box(1.3, 0.26, 1.06, beige, [0, 0.13, -0.1]));
  group.add(kit.box(0.42, 0.06, 0.03, kit.mat('abyss'), [0.3, 0.16, 0.44]));
  group.add(kit.box(0.08, 0.04, 0.03, kit.mat('ok', { emissive: 'ok', glow: 0.9 }), [-0.5, 0.16, 0.44]));
  group.add(kit.cylinder(0.28, 0.34, 0.1, shade, [0, 0.31, -0.14], 12));
  group.add(kit.box(1.24, 0.98, 0.3, beige, [0, 0.85, 0.06]));
  group.add(kit.box(0.98, 0.8, 0.5, beige, [0, 0.85, -0.3]));
  group.add(kit.box(1.04, 0.78, 0.03, kit.mat('abyss', { rough: 0.5 }), [0, 0.88, 0.215]));
  const screen = new Group();
  screen.position.set(0, 0.88, 0.235);
  group.add(screen);
  const lamp = statusLight(kit, group, [0.48, 1.45, -0.1]);
  return { group, screen, lamp };
}

const PAINTS = ['#dc0000', '#ffd800', '#00a000', '#1084d0', '#c000c0'];

function paintProgram(kit, spot) {
  const { group, screen, lamp } = workstation(kit);
  screen.add(plane(0.98, 0.72, kit.mat('#ffffff', { rough: 0.7, emissive: '#ffffff', glow: 0.3 }), [0, 0, 0]));
  const strokes = PAINTS.map((hex, i) => {
    const geometry = new BoxGeometry(0.7, 0.07, 0.03);
    geometry.translate(0.35, 0, 0);
    const stroke = new Mesh(geometry, kit.mat(hex, { rough: 0.5, emissive: hex, glow: 0.35 }));
    stroke.position.set(-0.36, 0.24 - i * 0.12, 0.02);
    stroke.rotation.z = (i % 2 ? -1 : 1) * 0.06;
    screen.add(stroke);
    return stroke;
  });
  const splat = kit.cylinder(0.3, 0.3, 0.04, kit.mat('fail', { rough: 0.5, emissive: 'fail', glow: 0.4 }), [0, 0, 0.03], 9);
  splat.rotation.x = Math.PI / 2;
  screen.add(splat);
  const brush = new Group();
  brush.add(kit.cylinder(0.035, 0.028, 0.5, kit.mat('manila', { rough: 0.5 }), [0, 0.3, 0], 6));
  brush.add(kit.cylinder(0.04, 0.04, 0.08, kit.mat('tape', { metal: 0.6, rough: 0.3 }), [0, 0.05, 0], 6));
  const tip = kit.cylinder(0.04, 0.008, 0.11, kit.mat(PAINTS[spot.index % PAINTS.length], { rough: 0.5 }), [0, -0.04, 0], 6);
  brush.add(tip);
  brush.rotation.set(0.5, 0, -0.5);
  screen.add(brush);
  for (let i = 0; i < 5; i += 1) group.add(kit.box(0.14, 0.1, 0.14, kit.mat(PAINTS[i], { rough: 0.5 }), [-0.5 + i * 0.16, 0.05, 0.62]));
  return program(kit.shadows(group), spot, {
    lamp, top: 1.4, labelY: 1.95, puff: new Vector3(0, 1.4, -0.3),
    run(t, active, { failed, finished }) {
      const cycle = (t * 0.5) % 1;
      const at = cycle * strokes.length;
      strokes.forEach((stroke, i) => {
        stroke.visible = !failed;
        stroke.scale.x = finished ? 1 : Math.max(0.001, Math.min(1, at - i));
      });
      splat.visible = failed;
      const row = Math.min(strokes.length - 1, Math.floor(at));
      brush.visible = !failed && !finished;
      brush.position.set(-0.36 + (at - row) * 0.7 * (active > 0.05 ? 1 : 0), 0.24 - row * 0.12 + 0.04, 0.1);
    },
  });
}

function mineFaceMaterial(kit, mood) {
  return memo(kit, `face:${mood}`, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#ffd800';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = '#000000';
    if (mood === 'cool') ctx.fillRect(10, 20, 44, 12);
    else if (mood === 'dead') {
      ctx.lineWidth = 4;
      for (const x of [20, 44]) {
        ctx.beginPath();
        ctx.moveTo(x - 6, 18);
        ctx.lineTo(x + 6, 30);
        ctx.moveTo(x + 6, 18);
        ctx.lineTo(x - 6, 30);
        ctx.stroke();
      }
    } else {
      ctx.fillRect(16, 18, 8, 10);
      ctx.fillRect(40, 18, 8, 10);
    }
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (mood === 'dead') ctx.arc(32, 52, 12, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(32, 34, 14, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }, { width: 64, height: 64, nearest: true, rough: 0.5, emissive: true, glow: 0.4 }));
}

function minesProgram(kit, spot) {
  const { group, screen, lamp } = workstation(kit);
  screen.add(plane(0.98, 0.72, kit.mat('body', { rough: 0.7 }), [0, 0, 0]));
  const up = kit.mat('hilite', { rough: 0.6, emissive: 'hilite', glow: 0.2 });
  const tiles = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const tile = kit.box(0.15, 0.15, 0.06, up, [-0.34 + col * 0.17, -0.25 + row * 0.17, 0.03]);
      screen.add(tile);
      tiles.push(tile);
    }
  }
  const faces = ['smile', 'cool', 'dead'].map(mood => {
    const face = kit.box(0.2, 0.2, 0.08, mineFaceMaterial(kit, mood), [0, 0.28, 0.05]);
    screen.add(face);
    return face;
  });
  const flag = new Group();
  flag.add(kit.box(0.02, 0.2, 0.02, kit.mat('abyss'), [0, 0.1, 0]));
  flag.add(kit.box(0.12, 0.09, 0.02, kit.mat('fail', { emissive: 'fail', glow: 0.4 }), [0.06, 0.16, 0]));
  flag.position.set(0.34, -0.3, 0.07);
  screen.add(flag);
  const mine = kit.sphere(0.1, kit.mat('abyss', { rough: 0.4, metal: 0.4 }), [-0.17, -0.08, 0.1], 8);
  for (let i = 0; i < 6; i += 1) {
    const spike = kit.box(0.03, 0.28, 0.03, kit.mat('abyss'));
    spike.rotation.z = (i / 6) * Math.PI;
    mine.add(spike);
  }
  screen.add(mine);
  return program(kit.shadows(group), spot, {
    lamp, top: 1.4, labelY: 1.95, puff: new Vector3(0, 1.4, -0.3),
    run(t, active, { failed, finished }) {
      const step = Math.floor(t * 2.4);
      tiles.forEach((tile, i) => {
        const cleared = finished || failed || seeded(i * 7 + spot.index) < ((step % 16) / 16) * active + (active > 0.05 ? 0 : 0.3);
        tile.position.z = cleared ? -0.01 : 0.03;
      });
      faces[0].visible = !failed && !finished;
      faces[1].visible = finished;
      faces[2].visible = failed;
      faces[0].position.z = 0.05 + (Math.sin(t * 9) > 0.6 ? -0.03 : 0) * active;
      mine.visible = failed;
      flag.visible = !failed;
      flag.rotation.z = Math.sin(t * 5) * 0.2 * active;
    },
  });
}

function defragProgram(kit, spot) {
  const { group, screen, lamp } = workstation(kit);
  screen.add(plane(0.98, 0.72, kit.mat('abyss', { rough: 0.6 }), [0, 0, 0]));
  const looks = {
    tidy: kit.mat('glow', { rough: 0.4, emissive: 'glow', glow: 0.6 }),
    loose: kit.mat('#ffffff', { rough: 0.4, emissive: '#ffffff', glow: 0.35 }),
    bad: kit.mat('fail', { rough: 0.4, emissive: 'fail', glow: 0.6 }),
    moving: kit.mat('busy', { rough: 0.4, emissive: 'busy', glow: 0.8 }),
  };
  const cols = 9;
  const rows = 6;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = kit.box(0.085, 0.085, 0.04, looks.loose, [-0.4 + col * 0.1, 0.27 - row * 0.105, 0.02]);
      screen.add(cell);
      cells.push(cell);
    }
  }
  return program(kit.shadows(group), spot, {
    lamp, top: 1.4, labelY: 1.95, puff: new Vector3(0, 1.4, -0.3),
    run(t, active, { failed, finished }) {
      const head = finished ? cells.length : Math.floor((t * 6) % (cells.length + 8));
      cells.forEach((cell, i) => {
        const scattered = seeded(i * 3 + spot.index) < 0.55;
        const moving = !finished && !failed && active > 0.05 && i === head;
        cell.material = failed && seeded(i * 5 + 1) < 0.3 ? looks.bad : moving ? looks.moving : i < head ? looks.tidy : looks.loose;
        cell.visible = i < head || scattered;
        cell.position.z = moving ? 0.1 : 0.02;
      });
    },
  });
}

// Desk things for the subagents, with no screen of their own.
function deskThing(kit) {
  const group = new Group();
  group.userData.kit = kit;
  return group;
}

function printer(kit, spot) {
  const group = deskThing(kit);
  const beige = kit.mat('beige', { rough: 0.62 });
  const shade = kit.mat('beigeShade', { rough: 0.7 });
  group.add(kit.box(1.1, 0.34, 0.74, beige, [0, 0.17, 0]));
  group.add(kit.box(1.0, 0.1, 0.5, shade, [0, 0.39, -0.06]));
  group.add(kit.box(0.84, 0.03, 0.05, kit.mat('abyss'), [0, 0.445, 0.02]));
  group.add(kit.box(0.9, 0.03, 0.4, shade, [0, 0.06, 0.52]));
  const paperMat = memo(kit, 'printout', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b8d8ff';
    for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 16);
    ctx.fillStyle = '#000000';
    for (let y = 10; y < h; y += 16) ctx.fillRect(14, y, 30 + seeded(y) * 70, 4);
    ctx.fillStyle = '#808080';
    for (let y = 6; y < h; y += 16) {
      ctx.fillRect(3, y, 5, 5);
      ctx.fillRect(w - 8, y, 5, 5);
    }
  }, { width: 128, height: 128, nearest: true, rough: 0.8, doubleSide: true, emissive: true, glow: 0.25 }));
  const sheetGeo = new PlaneGeometry(0.74, 0.9);
  sheetGeo.translate(0, 0.45, 0);
  const sheet = new Mesh(sheetGeo, paperMat);
  sheet.position.set(0, 0.44, 0.02);
  sheet.rotation.x = -0.25;
  group.add(sheet);
  const jam = new Mesh(new PlaneGeometry(0.6, 0.5), paperMat);
  jam.position.set(0.1, 0.62, 0.1);
  jam.rotation.set(-1.0, 0.5, 0.6);
  group.add(jam);
  const head = kit.box(0.14, 0.07, 0.08, kit.mat('abyss'), [0, 0.47, 0.04]);
  group.add(head);
  const lamp = statusLight(kit, group, [0.42, 0.55, -0.24]);
  return program(kit.shadows(group), spot, {
    lamp, top: 1.2, labelY: 1.6, puff: new Vector3(0, 0.6, 0),
    run(t, active, { failed, finished }) {
      sheet.scale.y = failed ? 0.25 : finished ? 1 : 0.12 + ((t * 0.35) % 1) * 0.88 * (active > 0.05 ? 1 : 0.4);
      sheet.rotation.x = -0.25 + (finished ? Math.sin(t * 2) * 0.06 : 0);
      jam.visible = failed;
      head.position.x = Math.sin(t * 14) * 0.36 * active;
    },
  });
}

function diskDrive(kit, spot) {
  const group = deskThing(kit);
  const beige = kit.mat('beige', { rough: 0.62 });
  const shade = kit.mat('beigeShade', { rough: 0.7 });
  group.add(kit.box(0.62, 1.0, 0.9, beige, [0, 0.5, -0.1]));
  group.add(kit.box(0.66, 0.06, 0.94, shade, [0, 0.03, -0.1]));
  for (let i = 0; i < 2; i += 1) {
    group.add(kit.box(0.5, 0.16, 0.03, shade, [0, 0.78 - i * 0.22, 0.355]));
    group.add(kit.box(0.4, 0.03, 0.04, kit.mat('abyss'), [0, 0.79 - i * 0.22, 0.36]));
  }
  for (let i = 0; i < 4; i += 1) group.add(kit.box(0.44, 0.02, 0.03, kit.mat('abyss'), [0, 0.14 + i * 0.06, 0.355]));
  const disk = new Group();
  disk.add(kit.box(0.36, 0.04, 0.38, kit.mat('crate', { rough: 0.48 }), [0, 0, 0]));
  disk.add(kit.box(0.2, 0.045, 0.12, kit.mat('tape', { metal: 0.6, rough: 0.3 }), [0.02, 0, -0.12]));
  disk.add(kit.box(0.26, 0.045, 0.14, kit.mat('#ffffff', { rough: 0.8 }), [0, 0, 0.1]));
  disk.position.set(0, 0.79, 0.5);
  group.add(disk);
  const glass = pixelHourglass(kit, 0.8);
  glass.position.set(0, 1.36, -0.1);
  group.add(glass);
  const lamp = statusLight(kit, group, [0.52, 0.2, 0.3]);
  return program(kit.shadows(group), spot, {
    lamp, top: 1.35, labelY: 1.85, puff: new Vector3(0, 1.1, -0.1),
    run(t, active, { failed, finished, dt }) {
      const slide = 0.5 + 0.5 * Math.sin(t * 2.2);
      disk.position.z = failed ? 0.62 : finished ? 0.66 : 0.36 + slide * 0.3 * (active > 0.05 ? 1 : 0.3);
      disk.rotation.z = failed ? 0.5 : 0;
      disk.rotation.y = failed ? 0.4 : 0;
      glass.visible = !failed && !finished;
      glass.rotation.z += dt * 2.4 * active;
    },
  });
}

function recycleBin(kit, spot) {
  const group = deskThing(kit);
  const wire = kit.mat('tape', { rough: 0.4, metal: 0.5 });
  const bin = new Mesh(new CylinderGeometry(0.46, 0.34, 0.8, 10, 1, true), kit.mat('tape', { rough: 0.4, metal: 0.5, doubleSide: true }));
  bin.position.y = 0.42;
  group.add(bin);
  group.add(kit.cylinder(0.34, 0.34, 0.04, wire, [0, 0.04, 0], 10));
  const rim = new Mesh(new CylinderGeometry(0.49, 0.49, 0.06, 10, 1, true), kit.mat('accent', { rough: 0.5, doubleSide: true }));
  rim.position.y = 0.82;
  group.add(rim);
  const paper = kit.mat('#ffffff', { rough: 0.9, flat: true });
  const balls = Array.from({ length: 5 }, (_, i) => {
    const ball = kit.sphere(0.13, paper, [0, 0, 0], 5);
    group.add(ball);
    return { ball, a: seeded(i + spot.index * 3) * TAU, r: 0.08 + seeded(i * 3 + 1) * 0.16 };
  });
  const lamp = statusLight(kit, group, [0.58, 0.2, 0.42]);
  return program(kit.shadows(group), spot, {
    lamp, top: 1.2, labelY: 1.6, puff: new Vector3(0, 0.9, 0),
    run(t, active, { failed, finished }) {
      balls.forEach(({ ball, a, r }, i) => {
        ball.visible = !finished;
        if (failed) {
          ball.position.set(Math.cos(a) * (0.5 + r * 2), 0.12, Math.sin(a) * (0.5 + r * 2) + 0.2);
          return;
        }
        const hop = Math.abs(Math.sin(t * 3.4 + i * 1.3)) * 0.5 * active;
        ball.position.set(Math.cos(a) * r, 0.5 + i * 0.07 + hop, Math.sin(a) * r);
        ball.rotation.x = t * 2 * active + i;
      });
    },
  });
}

function notepad(kit, spot) {
  const group = deskThing(kit);
  const padMat = memo(kit, 'notepad', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#ffffe1';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000080';
    ctx.fillRect(0, 0, w, 16);
    ctx.fillStyle = '#1084d0';
    for (let y = 30; y < h; y += 14) ctx.fillRect(8, y, w - 16, 2);
    ctx.fillStyle = '#000000';
    for (let y = 24; y < h * 0.6; y += 14) ctx.fillRect(12, y, 24 + seeded(y) * 70, 4);
  }, { width: 128, height: 128, nearest: true, rough: 0.8, emissive: true, glow: 0.2 }));
  const pad = kit.box(1.0, 0.1, 1.1, padMat, [0, 0.12, 0]);
  pad.rotation.x = 0.12;
  group.add(pad);
  group.add(kit.box(1.04, 0.06, 1.14, kit.mat('beigeShade', { rough: 0.7 }), [0, 0.04, 0]));
  // A pencil with eyes, because every desktop of the era had a helper.
  const pencil = new Group();
  const wood = kit.mat('busy', { rough: 0.5 });
  pencil.add(kit.cylinder(0.075, 0.075, 0.7, wood, [0, 0.5, 0], 6));
  pencil.add(kit.cylinder(0.075, 0.012, 0.16, kit.mat('manilaLight', { rough: 0.6 }), [0, 0.08, 0], 6));
  pencil.add(kit.cylinder(0.08, 0.08, 0.1, kit.mat('fail', { rough: 0.6 }), [0, 0.9, 0], 6));
  pencil.add(kit.cylinder(0.082, 0.082, 0.05, kit.mat('tape', { metal: 0.6, rough: 0.3 }), [0, 0.83, 0], 6));
  for (const side of [-1, 1]) {
    pencil.add(kit.sphere(0.05, kit.mat('#ffffff', { rough: 0.3 }), [side * 0.045, 0.62, 0.07], 8));
    pencil.add(kit.sphere(0.022, kit.mat('abyss'), [side * 0.045, 0.62, 0.115], 6));
  }
  pencil.position.set(0, 0.18, 0.1);
  group.add(pencil);
  const tick = new Group();
  const green = kit.mat('ok', { emissive: 'ok', glow: 0.7 });
  tick.add(kit.box(0.08, 0.02, 0.26, green, [-0.12, 0, 0.06]).rotateY(0.7));
  tick.add(kit.box(0.08, 0.02, 0.5, green, [0.1, 0, -0.04]).rotateY(-0.6));
  tick.position.set(0, 0.2, 0.25);
  tick.rotation.x = 0.12;
  group.add(tick);
  const lamp = statusLight(kit, group, [0.42, 0.24, -0.42]);
  return program(kit.shadows(group), spot, {
    lamp, top: 1.2, labelY: 1.65, puff: new Vector3(0, 0.9, 0), occupants: [pencil],
    run(t, active, { failed, finished }) {
      tick.visible = finished;
      if (failed) {
        pencil.position.set(0.1, 0.24, 0.1);
        pencil.rotation.set(0, 0, 1.45);
        return;
      }
      const writing = finished ? 0 : active;
      pencil.position.set(-0.25 + ((t * 0.5) % 1) * 0.5 * (writing > 0.05 ? 1 : 0) + Math.sin(t * 16) * 0.03 * writing, 0.18 + (finished ? Math.abs(Math.sin(t * 3)) * 0.06 : 0), finished ? -0.2 : 0.1);
      pencil.rotation.set(0.22 * (finished ? 0 : 1), 0, -0.3 * (finished ? 0 : 1) + Math.sin(t * 16) * 0.08 * writing);
    },
  });
}

const PROGRAMS = [paintProgram, minesProgram, defragProgram];
const DESK = [printer, notepad, diskDrive, recycleBin];

function station(kit, kind, spot = { index: 0, side: -1, slot: 0 }) {
  const cast = kind === 'worker' ? PROGRAMS : DESK;
  return cast[spot.index % cast.length](kit, spot);
}

// ---------- carrier ----------

function arrowGeometry(depth) {
  const shape = new Shape();
  const points = [[0, 0], [0, -0.74], [0.17, -0.58], [0.3, -0.86], [0.41, -0.81], [0.28, -0.54], [0.52, -0.54]];
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

// The pointer drags each finished file home.
function carrier(kit) {
  const object = new Group();
  const pointer = new Group();
  const rim = new Mesh(arrowGeometry(0.05), kit.mat('#000000', { rough: 0.6 }));
  rim.scale.setScalar(1.16);
  rim.position.set(-0.035, 0.05, -0.01);
  const face = new Mesh(arrowGeometry(0.07), kit.mat('#ffffff', { rough: 0.5, emissive: '#ffffff', glow: 0.35 }));
  pointer.add(rim, face);
  pointer.rotation.x = -0.9;
  pointer.position.set(-0.1, 0.25, 0.1);
  object.add(pointer);
  const hold = new Group();
  hold.position.set(0.24, -0.3, 0.1);
  object.add(hold);
  kit.shadows(object);
  return {
    object,
    hold,
    route: 'air',
    cruise: 2.4,
    pose(target, { time, phase, speed }) {
      target.rotation.y = 0;
      pointer.position.y = 0.25 - (phase === 'summon' ? 0.08 : 0);
      target.rotation.z = -0.12 * speed;
      hold.rotation.z = Math.sin(time * 6) * 0.1 * speed;
    },
  };
}

function floppyLabelMaterial(kit) {
  return memo(kit, 'floppyLabel', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000080';
    ctx.fillRect(0, 0, w, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText('1.44 MB  PATCH.ZIP', 8, 17);
    ctx.fillStyle = '#cc2222';
    ctx.fillRect(8, 38, w - 16, 4);
    ctx.fillStyle = '#1084d0';
    ctx.fillRect(8, 56, w - 16, 4);
    ctx.fillRect(8, 74, w - 36, 4);
  }, { width: 160, height: 96, nearest: true, rough: 0.78 }));
}

function crate(kit) {
  const group = new Group();
  const disk = new Group();
  disk.rotation.x = -0.38;
  const shell = kit.mat('crate', { rough: 0.48, metal: 0.08 });
  const shutter = kit.mat('tape', { rough: 0.26, metal: 0.62 });
  disk.add(kit.box(0.46, 0.48, 0.075, shell, [0, 0, 0]));
  disk.add(kit.box(0.28, 0.16, 0.086, shutter, [0.03, 0.16, 0]));
  disk.add(kit.box(0.065, 0.12, 0.092, shell, [0.09, 0.16, 0]));
  disk.add(kit.box(0.05, 0.05, 0.082, kit.mat('abyss'), [-0.19, -0.19, 0]));
  const label = plane(0.36, 0.22, floppyLabelMaterial(kit), [0, -0.09, 0.041]);
  disk.add(label);
  group.add(disk);
  return kit.shadows(group);
}

function defragScreenMaterial(kit) {
  return memo(kit, 'defragScreen', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#008080';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(10, 10, w - 20, h - 20);
    drawWinBevel(ctx, 10, 10, w - 20, h - 20, false);
    ctx.fillStyle = '#000080';
    ctx.fillRect(14, 14, w - 28, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText('Defragmenting C: [84%]', 20, 29);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(18, 42, w - 36, h - 76);
    const palette = ['#000080', '#00a8c8', '#00ffff', '#ffd800', '#00c000', '#e0e0e0'];
    let idx = 0;
    for (let y = 46; y < h - 42; y += 10) {
      for (let x = 22; x < w - 28; x += 12) {
        const pick = idx < 72 ? palette[Math.floor(seeded(idx) * 4)] : (idx < 84 ? '#dc0000' : '#d8d8d8');
        ctx.fillStyle = pick;
        ctx.fillRect(x, y, 9, 7);
        ctx.fillStyle = '#000000';
        ctx.fillRect(x + 9, y + 1, 1, 7);
        idx += 1;
      }
    }
    ctx.fillStyle = '#000080';
    for (let b = 0; b < 11; b += 1) ctx.fillRect(20 + b * 18, h - 28, 14, 11);
  }, { width: 256, height: 192, nearest: true, emissive: true, glow: 0.78, rough: 0.26 }));
}

function sysmonScreenMaterial(kit) {
  return memo(kit, 'sysmonScreen', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000080';
    ctx.fillRect(6, 6, w - 12, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText('System Monitor - Kernel', 12, 21);

    ctx.fillStyle = '#002424';
    ctx.fillRect(12, 34, w - 24, h - 52);
    ctx.strokeStyle = '#006868';
    ctx.lineWidth = 2;
    for (let x = 28; x < w - 16; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, h - 18); ctx.stroke();
    }
    for (let y = 52; y < h - 18; y += 24) {
      ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke();
    }
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 14; i += 1) {
      const px = 14 + (i / 14) * (w - 28);
      const py = h - 30 - (0.28 + seeded(i + 9) * 0.58) * (h - 74);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = '#38c8ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 14; i += 1) {
      const px = 14 + (i / 14) * (w - 28);
      const py = h - 26 - (0.15 + seeded(i + 31) * 0.42) * (h - 74);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }, { width: 256, height: 192, nearest: true, emissive: true, glow: 0.84, rough: 0.25 }));
}

function crtMonitor(kit, group, at, scale, screenMat, tilt = -0.06) {
  const [x, y, z] = at;
  const crt = new Group();
  crt.position.set(x, y, z);
  crt.rotation.x = tilt;
  group.add(kit.cylinder(0.16 * scale, 0.24 * scale, 0.14 * scale, kit.mat('beigeShade', { rough: 0.78 }), [x, y - 0.36 * scale, z - 0.02], 12));
  bevelBox(kit, crt, 0.84 * scale, 0.68 * scale, 0.44 * scale, [0, 0, 0.08 * scale], 'beige');
  crt.add(kit.box(0.56 * scale, 0.46 * scale, 0.36 * scale, kit.mat('beigeShade', { rough: 0.82 }), [0, 0.02 * scale, -0.28 * scale]));
  bevelBox(kit, crt, 0.7 * scale, 0.52 * scale, 0.03 * scale, [0, 0.03 * scale, 0.295 * scale], 'beigeShade', true);
  crt.add(plane(0.64 * scale, 0.46 * scale, screenMat, [0, 0.03 * scale, 0.318 * scale]));
  crt.add(kit.box(0.06 * scale, 0.028 * scale, 0.015, kit.mat('ok', { emissive: 'ok', glow: 1.1 }), [0.27 * scale, -0.27 * scale, 0.31 * scale]));
  group.add(crt);
}

function iconCaption(kit, text) {
  const mat = memo(kit, `caption:${text}`, () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = kit.mode === 'dark' ? '#043434' : '#008080';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.setLineDash([]);
    ctx.font = `bold 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(text, w / 2 + 2, h / 2 + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, h / 2);
  }, { width: 256, height: 48, nearest: true, rough: 0.85 }));
  const sign = plane(1.85, 0.35, mat, [0, 0.2, 0.82]);
  sign.rotation.x = -0.32;
  return sign;
}

function desktopIcon(kit, kind, at, turn = 0.32) {
  const group = new Group();
  group.position.set(...at);
  group.rotation.y = turn;
  group.add(kit.shadow(1.8, 1.5, 0.26, [0, 0.004, 0]));

  if (kind === 'My Computer') {
    bevelBox(kit, group, 1.08, 0.28, 0.86, [0, 0.16, 0], 'beige');
    crtMonitor(kit, group, [0, 0.68, 0], 1.05, defragScreenMaterial(kit), -0.04);
  } else if (kind === 'Network Neighborhood') {
    for (const [dx, dz] of [[-0.36, -0.14], [0.36, 0.12]]) {
      bevelBox(kit, group, 0.64, 0.2, 0.52, [dx, 0.12, dz], 'beige');
      crtMonitor(kit, group, [dx, 0.48, dz], 0.66, sysmonScreenMaterial(kit), -0.04);
    }
    const wire = kit.mat('#1084d0', { rough: 0.45, metal: 0.25 });
    group.add(kit.box(0.95, 0.05, 0.05, wire, [0, 0.05, 0.42]));
    group.add(kit.sphere(0.08, kit.mat('ok', { emissive: 'ok', glow: 0.8 }), [0, 0.07, 0.42], 8));
  } else if (kind === 'Recycle Bin') {
    const binMat = kit.mat('hilite', { rough: 0.5, metal: 0.24 });
    group.add(kit.cylinder(0.46, 0.34, 0.96, binMat, [0, 0.48, 0], 12));
    group.add(kit.cylinder(0.5, 0.5, 0.07, kit.mat('trim'), [0, 0.96, 0], 12));
    const arrow = kit.mat('ok', { rough: 0.45, emissive: 'ok', glow: 0.25 });
    for (let a = 0; a < 3; a += 1) {
      const ang = (a / 3) * Math.PI * 2;
      group.add(kit.box(0.18, 0.06, 0.04, arrow, [Math.sin(ang) * 0.41, 0.52, Math.cos(ang) * 0.41]));
    }
    for (const [px, pz] of [[-0.12, 0.06], [0.14, -0.05], [0, 0.12]]) {
      group.add(kit.sphere(0.15, kit.mat('paper', { rough: 0.9, flat: true }), [px, 1.02, pz], 6));
    }
  } else {
    const leather = kit.mat('#9c5624', { rough: 0.72 });
    const leatherTrim = kit.mat('#753d16', { rough: 0.78 });
    const brass = kit.mat('#ffd84d', { rough: 0.3, metal: 0.65 });
    group.add(kit.box(1.14, 0.78, 0.34, leather, [0, 0.42, 0]));
    group.add(kit.box(1.18, 0.14, 0.38, leatherTrim, [0, 0.76, 0]));
    for (const sx of [-0.34, 0.34]) {
      group.add(kit.box(0.08, 0.8, 0.37, leatherTrim, [sx, 0.42, 0]));
      group.add(kit.box(0.11, 0.14, 0.4, brass, [sx, 0.64, 0]));
    }
    group.add(kit.box(0.36, 0.07, 0.08, leatherTrim, [0, 0.94, 0]));
    for (const sx of [-0.15, 0.15]) group.add(kit.box(0.06, 0.14, 0.08, brass, [sx, 0.86, 0]));
  }
  group.add(iconCaption(kit, kind));
  return group;
}

function sysPropsMaterial(kit) {
  return memo(kit, 'sysProps', () => {
    const dark = kit.mode === 'dark';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = dark ? '#3a3e47' : '#c0c0c0';
      ctx.fillRect(0, 0, w, h);
      drawWinBevel(ctx, 0, 0, w, h, false);

      const grad = ctx.createLinearGradient(6, 6, w - 6, 6);
      grad.addColorStop(0, css(kit.palette.titleStart));
      grad.addColorStop(1, css(kit.palette.titleEnd));
      ctx.fillStyle = grad;
      ctx.fillRect(6, 6, w - 12, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 18px ${FONT}`;
      ctx.fillText('System Properties', 16, 29);
      drawCaptionButton(ctx, w - 38, 10, 26, 26, 'x');

      const tabs = [['General', 14], ['Device Manager', 102], ['Performance', 252]];
      tabs.forEach(([t, tx], idx) => {
        ctx.fillStyle = dark ? '#3a3e47' : '#c0c0c0';
        ctx.fillRect(tx, 48, idx === 1 ? 146 : 86, 26);
        drawWinBevel(ctx, tx, 48, idx === 1 ? 146 : 86, 26, false);
        ctx.fillStyle = dark ? '#f0f2f7' : '#000000';
        ctx.font = `bold 13px ${FONT}`;
        ctx.fillText(t, tx + 10, 66);
      });
      drawWinBevel(ctx, 14, 72, w - 28, h - 128, false);

      ctx.fillStyle = '#008080';
      ctx.fillRect(36, 98, 68, 52);
      drawWinBevel(ctx, 32, 94, 76, 60, false);
      ctx.fillStyle = dark ? '#e8ecf2' : '#000000';
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillText('System:', 132, 108);
      ctx.font = `15px ${FONT}`;
      ctx.fillText('Orcsoft 97', 144, 130);
      ctx.fillText('Orc 4.00.950 B (32-Bit)', 144, 150);
      ctx.fillText('64.0 MB RAM', 144, 174);

      for (const [label, bx] of [['OK', w - 186], ['Cancel', w - 98]]) {
        drawWinBevel(ctx, bx, h - 44, 82, 30, false);
        ctx.fillStyle = dark ? '#f0f2f7' : '#000000';
        ctx.font = `bold 14px ${FONT}`;
        ctx.fillText(label, bx + (label === 'OK' ? 28 : 16), h - 24);
      }
    }, { width: 384, height: 256, nearest: true, rough: 0.68 });
  });
}

function taskbarMaterial(kit) {
  return memo(kit, 'taskbar', () => {
    const dark = kit.mode === 'dark';
    return kit.painted((ctx, w, h) => {
      ctx.fillStyle = dark ? '#3a3e47' : '#c0c0c0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark ? '#7a808d' : '#ffffff';
      ctx.fillRect(0, 0, w, 4);

      drawWinBevel(ctx, 10, 10, 118, h - 20, false);
      const flag = [['#dc0000', 20, 18], ['#00b800', 34, 18], ['#1084d0', 20, 32], ['#ffd800', 34, 32]];
      for (const [c, fx, fy] of flag) {
        ctx.fillStyle = c;
        ctx.fillRect(fx, fy, 12, 12);
      }
      ctx.fillStyle = dark ? '#ffffff' : '#000000';
      ctx.font = `bold 24px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Start', 54, h / 2 + 1);

      ctx.fillStyle = dark ? '#262a33' : '#dfdfdf';
      ctx.fillRect(140, 10, 224, h - 20);
      drawWinBevel(ctx, 140, 10, 224, h - 20, true);
      ctx.fillStyle = '#00b800';
      ctx.fillRect(152, 20, 18, 22);
      ctx.fillStyle = dark ? '#ffffff' : '#000000';
      ctx.font = `bold 19px ${FONT}`;
      ctx.fillText('Orc Factory.exe', 180, h / 2 + 1);

      drawWinBevel(ctx, 374, 10, 186, h - 20, false);
      ctx.fillStyle = '#ebc86e';
      ctx.fillRect(386, 20, 20, 18);
      ctx.fillStyle = dark ? '#e8ecf2' : '#000000';
      ctx.font = `19px ${FONT}`;
      ctx.fillText('Exploring - C:\\', 414, h / 2 + 1);

      drawWinBevel(ctx, w - 166, 10, 156, h - 20, true);
      ctx.fillStyle = '#ffd800';
      ctx.fillRect(w - 152, 22, 16, 18);
      ctx.fillStyle = dark ? '#ffffff' : '#000000';
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillText('9:41 AM', w - 124, h / 2 + 1);
    }, { width: 1024, height: 64, nearest: true, rough: 0.72 });
  });
}

function decor(kit) {
  const group = new Group();

  const icons = [
    ['My Computer', [-11.3, 0, -5.2], 0.34],
    ['Network Neighborhood', [-11.5, 0, -1.5], 0.38],
    ['Recycle Bin', [-11.5, 0, 2.2], 0.42],
    ['Briefcase', [-11.3, 0, 5.9], 0.46],
  ];
  for (const [kind, pos, turn] of icons) {
    group.add(desktopIcon(kit, kind, pos, turn));
  }

  const dialog = new Group();
  dialog.position.set(11.1, 2.05, -8.8);
  dialog.rotation.y = -0.36;
  group.add(kit.shadow(5.4, 1.8, 0.26, [11.1, 0.004, -8.8]));
  bevelBox(kit, dialog, 5.1, 3.4, 0.24, [0, 0, 0], 'body');
  dialog.add(plane(4.96, 3.26, sysPropsMaterial(kit), [0, 0, 0.132]));
  group.add(dialog);

  const bar = new Group();
  bar.position.set(0, 0.48, -11.5);
  bevelBox(kit, bar, 27.6, 0.96, 0.56, [0, 0, 0], 'body');
  bar.add(plane(27.2, 0.86, taskbarMaterial(kit), [0, 0, 0.292]));
  group.add(bar);

  return kit.shadows(group);
}

function makeCursorGeometry() {
  const pts = [
    0, 0.26, 0, 0, -0.22, 0, 0.32, -0.06, 0,
    0.09, -0.1, 0, 0.2, -0.32, 0, 0.27, -0.28, 0,
    0.09, -0.1, 0, 0.27, -0.28, 0, 0.16, -0.06, 0,
  ];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  geo.computeVertexNormals();
  return geo;
}

function weather(kit) {
  if (kit.reducedMotion) return null;
  const object = new Group();
  const cursorGeo = makeCursorGeometry();
  const sheetGeo = new PlaneGeometry(0.32, 0.4);
  const cursorMat = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const cursorRim = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide });
  const sheetMat = new MeshBasicMaterial({
    color: kit.mode === 'dark' ? 0xd8dce6 : 0xffffff,
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
  });

  const particles = Array.from({ length: 20 }, (_, i) => {
    const isCursor = i % 2 === 0;
    const node = new Group();
    if (isCursor) {
      const bg = new Mesh(cursorGeo, cursorRim);
      bg.scale.setScalar(1.18);
      bg.position.z = -0.008;
      node.add(bg, new Mesh(cursorGeo, cursorMat));
    } else {
      node.add(new Mesh(sheetGeo, sheetMat));
    }
    const behind = i % 3 === 0;
    const side = i % 4 < 2 ? -1 : 1;
    const bx = behind ? (seeded(i * 3 + 1) - 0.5) * 22 : side * (10.3 + seeded(i * 5) * 2.8);
    const bz = behind ? -8.6 - seeded(i * 7) * 2.6 : -6.2 + seeded(i * 11) * 15.5;
    object.add(node);
    return {
      node,
      isCursor,
      bx,
      bz,
      by: 1.1 + seeded(i * 13) * 3.2,
      speed: 0.55 + seeded(i * 17) * 0.5,
      phase: seeded(i * 19) * Math.PI * 2,
    };
  });

  return {
    object,
    frame(time) {
      for (const p of particles) {
        const w = time * p.speed + p.phase;
        p.node.position.set(
          p.bx + Math.sin(w) * 0.55,
          p.by + Math.cos(w * 0.85) * 0.42,
          p.bz + Math.sin(w * 0.6) * 0.35,
        );
        if (p.isCursor) {
          p.node.rotation.set(0, Math.sin(w * 0.5) * 0.35, 0.28 + Math.sin(w * 1.4) * 0.12);
        } else {
          p.node.rotation.set(Math.sin(w * 1.8) * 0.55, w * 0.9, Math.cos(w * 1.3) * 0.4);
        }
      }
    },
    dispose() {
      cursorGeo.dispose();
      sheetGeo.dispose();
      cursorMat.dispose();
      cursorRim.dispose();
      sheetMat.dispose();
    },
  };
}

export default { palette: PALETTE, layout, view, pad, ghost, floor, hall, station, crate, carrier, decor, weather, frame };
