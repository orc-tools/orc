// The motor court's advisor: an old orc regular who has seen every job on
// the strip, sitting out on the seafront promenade in a striped beach chair,
// straw hat, floral shirt and half-moon glasses, reading the evening paper.
// He is a cut-out in Astra's manner, painted here in layers (the figure and
// chair, his head, the paper and its turning leaf) and stood square to where
// she painted from, on a free stretch of promenade left of the motel.
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { ELEVATION, painter } from './factory-waterfront.js';

// Where he sits, in frame pixels: on the promenade by the rail, clear of the
// motel's wing and above the first row's left garage.
const SEAT = [262, 333];
// How wide he is painted there, in frame pixels.
const WIDE = 120;
// The figure's sheet, in its own pixels, and the world units each one spans.
const SHEET = [320, 400];

export const advisorSpot = (() => {
  const point = painter.ground(...SEAT);
  return { x: point.x, z: point.z, yaw: 0 };
})();

const UNIT = (() => {
  const a = painter.ground(SEAT[0], SEAT[1]);
  const b = painter.ground(SEAT[0] + WIDE, SEAT[1]);
  return (b.x - a.x) / SHEET[0];
})();

const TAU = Math.PI * 2;

// Dusk or morning: the painting's own light on him.
const LOOK = {
  dark: {
    skin: '#6f9a52', skinShade: '#42643a', skinLit: '#9cc477',
    shirt: '#1f8d93', shirtShade: '#155e6a', bloom: '#ff8a7a', bloom2: '#ffe0a6',
    shorts: '#b9a284', shortsShade: '#7f6c5c', stripe: '#f2667c', stripe2: '#f3dcc4',
    frame: '#b4b7c8', hat: '#d9b77a', hatShade: '#9c7a4e', band: '#f2667c',
    paper: '#eadfca', paperShade: '#b9ab98', ink: '#3b3546', glass: '#bfe9ec',
    rim: 'rgba(255, 112, 140, 0.55)', rim2: 'rgba(80, 226, 230, 0.5)',
    tint: 'rgba(48, 40, 92, 0.24)', glow: 'rgba(255, 190, 110, 0.28)', shadow: 'rgba(16, 12, 34, 0.55)',
  },
  light: {
    skin: '#86b35f', skinShade: '#5d8746', skinLit: '#b2d887',
    shirt: '#2aa9ab', shirtShade: '#1d7b82', bloom: '#ff8f7d', bloom2: '#fff1c9',
    shorts: '#d6c1a1', shortsShade: '#a38d73', stripe: '#ee777b', stripe2: '#fff2dc',
    frame: '#d5d9df', hat: '#ecd093', hatShade: '#b99560', band: '#ee777b',
    paper: '#fbf4e4', paperShade: '#cfc2ad', ink: '#3d4448', glass: '#dff6f6',
    rim: 'rgba(255, 236, 200, 0.55)', rim2: 'rgba(255, 255, 255, 0.35)',
    tint: 'rgba(255, 226, 180, 0.12)', glow: 'rgba(255, 240, 200, 0.2)', shadow: 'rgba(60, 52, 48, 0.42)',
  },
};

function ellipse(ctx, x, y, rx, ry, fill, rotation = 0) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
  ctx.fill();
}

function round(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
  ctx.fill();
}

function shaded(ctx, x0, y0, x1, y1, from, to) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

// Washes the light of the hour over what is painted, and a rim of the
// motel's neon down one side by dusk, keeping to the painted pixels.
function light(ctx, w, h, look) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = shaded(ctx, 0, 0, 0, h, look.tint, 'rgba(0,0,0,0)');
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = shaded(ctx, w, 0, w * 0.45, 0, look.rim, 'rgba(0,0,0,0)');
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = shaded(ctx, 0, 0, w * 0.3, 0, look.rim2, 'rgba(0,0,0,0)');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// The chair, his shirt, shorts, shins and sandals.
function paintFigure(ctx, w, h, look) {
  ellipse(ctx, 160, 384, 128, 14, look.shadow);
  // The chair's frame: a back leaning away and crossed legs to the ground.
  ctx.lineCap = 'round';
  ctx.strokeStyle = look.frame;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(70, 380); ctx.lineTo(250, 300);
  ctx.moveTo(250, 380); ctx.lineTo(70, 300);
  ctx.moveTo(62, 318); ctx.lineTo(80, 128);
  ctx.moveTo(258, 318); ctx.lineTo(240, 128);
  ctx.stroke();
  // The striped canvas of its back and seat.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(84, 126); ctx.lineTo(236, 126); ctx.lineTo(252, 316); ctx.lineTo(68, 316);
  ctx.closePath();
  ctx.clip();
  for (let i = 0; i < 9; i += 1) {
    ctx.fillStyle = i % 2 ? look.stripe2 : look.stripe;
    ctx.fillRect(60 + i * 22, 120, 22, 200);
  }
  ctx.fillStyle = shaded(ctx, 0, 120, 0, 320, 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.28)');
  ctx.fillRect(60, 120, 200, 200);
  ctx.restore();
  ctx.strokeStyle = look.frame;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(82, 126); ctx.lineTo(238, 126);
  ctx.stroke();
  // His shins and sandals.
  for (const x of [128, 194]) {
    round(ctx, x - 15, 300, 30, 74, 13, shaded(ctx, x - 15, 0, x + 15, 0, look.skin, look.skinShade));
    ellipse(ctx, x + (x < 160 ? -4 : 4), 376, 24, 9, '#5a3b2e');
    ellipse(ctx, x + (x < 160 ? -4 : 4), 371, 19, 7, look.skinShade);
  }
  // Shorts across his lap.
  round(ctx, 92, 262, 136, 60, 22, shaded(ctx, 0, 262, 0, 322, look.shorts, look.shortsShade));
  // The shirt: a round belly in teal with coral and cream flowers.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(108, 168);
  ctx.quadraticCurveTo(160, 150, 212, 168);
  ctx.quadraticCurveTo(240, 230, 222, 282);
  ctx.quadraticCurveTo(160, 300, 98, 282);
  ctx.quadraticCurveTo(80, 230, 108, 168);
  ctx.closePath();
  ctx.fillStyle = shaded(ctx, 90, 0, 230, 0, look.shirt, look.shirtShade);
  ctx.fill();
  ctx.clip();
  const flowers = [[122, 190], [178, 182], [204, 228], [140, 238], [110, 268], [188, 270], [160, 210]];
  for (const [index, [x, y]] of flowers.entries()) {
    const petal = index % 2 ? look.bloom2 : look.bloom;
    for (let p = 0; p < 5; p += 1) {
      const a = p * TAU / 5 + index;
      ellipse(ctx, x + Math.cos(a) * 7, y + Math.sin(a) * 7, 6, 4, petal, a);
    }
    ellipse(ctx, x, y, 3.5, 3.5, '#ffd36b');
  }
  ctx.restore();
  // The open collar, and his arms down to the paper.
  ctx.fillStyle = look.skinShade;
  ctx.beginPath();
  ctx.moveTo(142, 160); ctx.lineTo(160, 192); ctx.lineTo(178, 160);
  ctx.closePath();
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(160 + side * 62, 196);
    ctx.rotate(side * -0.35);
    round(ctx, -17, -12, 34, 34, 14, look.shirtShade);
    round(ctx, -13, 14, 26, 50, 12, shaded(ctx, -13, 0, 13, 0, look.skin, look.skinShade));
    ctx.restore();
  }
  light(ctx, w, h, look);
}

// His head: a broad green face, short tusks, grey brows over half-moon
// glasses looking down at the paper, and a straw hat with a coral band.
function paintHead(ctx, w, h, look, shut) {
  // Ears.
  for (const side of [-1, 1]) {
    ctx.fillStyle = look.skinShade;
    ctx.beginPath();
    ctx.moveTo(80 + side * 40, 92);
    ctx.lineTo(80 + side * 70, 74);
    ctx.lineTo(80 + side * 44, 112);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = shaded(ctx, 40, 60, 120, 140, look.skinLit, look.skinShade);
  ctx.beginPath();
  ctx.ellipse(80, 100, 44, 46, 0, 0, TAU);
  ctx.fill();
  // Jowls and jaw.
  ellipse(ctx, 80, 124, 38, 22, look.skin);
  // Nose.
  ellipse(ctx, 80, 108, 11, 9, look.skinShade);
  ellipse(ctx, 78, 105, 5, 3, look.skinLit);
  // Tusks.
  ctx.fillStyle = '#f6eedb';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(80 + side * 18, 132);
    ctx.lineTo(80 + side * 24, 116);
    ctx.lineTo(80 + side * 28, 132);
    ctx.closePath();
    ctx.fill();
  }
  // Eyes, looking down, or shut as he blinks.
  for (const side of [-1, 1]) {
    const x = 80 + side * 17;
    if (shut) {
      ctx.strokeStyle = '#26301f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, 90, 6, 0.2, Math.PI - 0.2);
      ctx.stroke();
    } else {
      ellipse(ctx, x, 92, 6, 5, '#f4f0e2');
      ellipse(ctx, x, 95, 3.4, 3, '#26301f');
    }
    // Bushy grey brows.
    ellipse(ctx, x + side * 2, 80, 12, 5, '#d5d3cc', side * 0.25);
    // Half-moon glasses, low on the nose.
    ctx.fillStyle = look.glass;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x, 98, 12, 8, 0, 0, Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3b2c26';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, 98, 12, 8, 0, 0, Math.PI);
    ctx.moveTo(x - 12, 98); ctx.lineTo(x + 12, 98);
    ctx.stroke();
  }
  // The straw hat: a wide brim, its crown and band.
  ellipse(ctx, 80, 62, 72, 15, look.hatShade);
  ellipse(ctx, 80, 58, 70, 13, look.hat);
  round(ctx, 46, 22, 68, 38, 16, shaded(ctx, 46, 0, 114, 0, look.hat, look.hatShade));
  ctx.fillStyle = look.band;
  ctx.fillRect(46, 44, 68, 9);
  // Weave on the brim.
  ctx.strokeStyle = look.hatShade;
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(80 + i * 18, 50); ctx.lineTo(80 + i * 22, 70);
    ctx.stroke();
  }
  light(ctx, w, h, look);
}

// The evening paper held open: a masthead, columns and a photo of a coupe,
// his thumbs at its edges.
function paintPaper(ctx, w, h, look, leaf) {
  const page = (x, width) => {
    ctx.fillStyle = shaded(ctx, x, 0, x + width, 0, look.paper, look.paperShade);
    ctx.fillRect(x, 8, width, h - 16);
  };
  if (leaf) {
    page(0, w);
    ctx.fillStyle = look.ink;
    for (let line = 0; line < 7; line += 1) ctx.fillRect(8, 20 + line * 11, w - 16 - (line % 3) * 10, 4);
    light(ctx, w, h, look);
    return;
  }
  page(10, w / 2 - 10);
  page(w / 2, w / 2 - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(w / 2 - 2, 8, 4, h - 16);
  ctx.fillStyle = look.ink;
  ctx.font = '700 12px Georgia, serif';
  ctx.fillText('THE STRIP', 18, 28);
  for (let line = 0; line < 5; line += 1) ctx.fillRect(18, 36 + line * 11, w / 2 - 30 - (line % 2) * 12, 4);
  // A photo of a coral coupe.
  ctx.fillStyle = '#5e6f86';
  ctx.fillRect(w / 2 + 8, 16, w / 2 - 26, 36);
  round(ctx, w / 2 + 16, 32, w / 2 - 42, 11, 4, look.band);
  ellipse(ctx, w / 2 + 26, 44, 4, 4, '#22232b');
  ellipse(ctx, w - 36, 44, 4, 4, '#22232b');
  ctx.fillStyle = look.ink;
  for (let line = 0; line < 4; line += 1) ctx.fillRect(w / 2 + 8, 60 + line * 11, w / 2 - 26 - (line % 2) * 14, 4);
  // His hands at its edges.
  for (const x of [8, w - 8]) {
    ellipse(ctx, x, h / 2 + 6, 13, 17, look.skin);
    ellipse(ctx, x, h / 2 - 4, 7, 9, look.skinLit);
  }
  light(ctx, w, h, look);
}

function sheet(kit, key, width, height, draw) {
  const id = `gto-advisor-${key}`;
  if (!kit.materials.has(id)) {
    const map = kit.canvas(width, height, draw);
    map.anisotropy = 4;
    kit.materials.set(id, new MeshBasicMaterial({
      map, side: DoubleSide, toneMapped: false, fog: false, alphaTest: 0.35,
    }));
  }
  return kit.materials.get(id);
}

// A layer of the cut-out, `width` by `height` sheet pixels, centred on sheet
// pixel (`x`, `y`) of the figure, `lift` towards the painter.
function layer(material, width, height, x, y, lift) {
  const mesh = new Mesh(new PlaneGeometry(width * UNIT, height * UNIT), material);
  mesh.position.set((x - SHEET[0] / 2) * UNIT, (SHEET[1] - y) * UNIT, lift);
  return mesh;
}

export function advisor(kit) {
  const look = LOOK[kit.mode === 'light' ? 'light' : 'dark'];
  const root = new Group();
  // The card stands square to the painter, leaning back by her elevation.
  const card = new Group();
  card.rotation.x = -ELEVATION;
  root.add(card);
  card.add(layer(sheet(kit, 'figure', ...SHEET, (ctx, w, h) => paintFigure(ctx, w, h, look)), ...SHEET, 160, 200, 0));
  const open = sheet(kit, 'head', 160, 160, (ctx, w, h) => paintHead(ctx, w, h, look, false));
  const shut = sheet(kit, 'head-shut', 160, 160, (ctx, w, h) => paintHead(ctx, w, h, look, true));
  // The head turns about his neck.
  const neck = new Group();
  neck.position.set(0, (SHEET[1] - 170) * UNIT, 0.012);
  const head = new Mesh(new PlaneGeometry(160 * UNIT, 160 * UNIT), open);
  head.position.y = (160 / 2 - 130) * -UNIT;
  neck.add(head);
  card.add(neck);
  // The paper, and the leaf he turns over its spine.
  const paper = new Group();
  const paperAt = [160, 262];
  paper.position.set((paperAt[0] - SHEET[0] / 2) * UNIT, (SHEET[1] - paperAt[1]) * UNIT, 0.024);
  paper.add(new Mesh(new PlaneGeometry(176 * UNIT, 110 * UNIT), sheet(kit, 'paper', 176, 110, (ctx, w, h) => paintPaper(ctx, w, h, look, false))));
  const spine = new Group();
  spine.position.z = 0.004;
  const leaf = new Mesh(new PlaneGeometry(76 * UNIT, 110 * UNIT), sheet(kit, 'leaf', 76, 110, (ctx, w, h) => paintPaper(ctx, w, h, look, true)));
  leaf.position.x = 40 * UNIT;
  spine.add(leaf);
  paper.add(spine);
  card.add(paper);
  const paperY = paper.position.y;
  // Where the pages land and the label hangs, in the root's frame.
  const tilt = (x, y, z) => new Vector3(x, y, z).applyEuler(card.rotation);
  const page = tilt(paper.position.x, paperY, 0.05);
  const top = tilt(0, (SHEET[1] - 18) * UNIT, 0);
  root.userData = {
    labelY: top.y + 0.6,
    page,
    frame(time, dt, state) {
      const reading = state.activity;
      // He lowers the paper and looks up while he is not reading.
      paper.position.y = paperY - (1 - reading) * 34 * UNIT;
      paper.rotation.z = Math.sin(time * 0.8) * 0.03 * reading;
      neck.rotation.z = Math.sin(time * 0.5) * 0.08 * reading;
      neck.position.y = (SHEET[1] - 170) * UNIT - (0.5 + 0.5 * Math.sin(time * 0.35)) * 3 * UNIT * reading;
      head.material = (time % 4.6) < 0.15 ? shut : open;
      // Every few seconds he turns a leaf: it folds over the spine.
      const turn = Math.min(1, Math.max(0, ((time * 0.28) % 1 - 0.74) / 0.26)) * reading;
      spine.scale.x = Math.cos(Math.PI * turn * turn * (3 - 2 * turn)) || 0.001;
    },
  };
  return root;
}
