import { createFactory } from '../../ui/yeet/factory.js';
import { CLEAR_LANDS } from '../../ui/yeet/party.js';
import { mix, range, smooth } from '../../ui/yeet/stage.js';
import { DART_CREASES, DART_FOLDS, DART_INK } from './dart.js';
import printShop from './factory.js';

const PAPER = '#fff8e7';
const INK = '#19232f';
const CYAN = '#78a6ae';
const SAFFRON = '#e7b54c';
const VERMILION = '#c94f3b';

const DAY = {
  page: PAPER, rule: INK, sky: '#ecdfc1', sun: SAFFRON, outline: INK, trail: INK,
  skyDots: '#19232f2b', stripDots: '#19232f4d', detail: CYAN,
  distant: '#bbced0', towers: [INK, '#39515d', '#2b3946'],
  distantWindow: '#78979b', warmWindow: SAFFRON, coolWindow: '#b7c9c5',
  vermilion: VERMILION, saffron: SAFFRON, cyan: CYAN, proof: PAPER, lettering: INK,
};
const NIGHT = {
  page: '#17232e', rule: '#85939a', sky: '#2b414d', sun: '#c6b48f', outline: '#111c26', trail: '#a7b0b5',
  skyDots: '#91a5af38', stripDots: '#1926324d', detail: '#416674',
  distant: '#45606d', towers: ['#18232e', '#253a48', '#20313f'],
  distantWindow: '#758994', warmWindow: '#efbd66', coolWindow: '#b9c8c4',
  vermilion: '#994e45', saffron: '#876238', cyan: '#407180', proof: '#344550', lettering: '#fff2d5',
};

// Match the word and sound cues in ui/js/scene-poses.js without importing a private host module.
const SEND_OFFS = {
  yeet: { lands: 3.32, accent: 'vermilion', target: .69, arc: .35, caption: 'Meanwhile, on main…' },
  pr: { lands: 3.05, accent: 'saffron', target: .61, arc: .21, proof: true, caption: 'Meanwhile, at review…' },
  plan: { lands: 2.55, accent: 'cyan', target: .50, arc: .29, proof: true, caption: 'Earlier that day…' },
  clear: { lands: CLEAR_LANDS, accent: 'saffron', target: .56, arc: .15, celebrate: true, caption: 'And so…' },
};

function polygon(ctx, points, fill, outline = true) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) ctx.stroke();
}

function halftone(ctx, x, y, width, height, step, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let row = 0; row < height; row += step) {
    for (let col = (row / step % 2) * step / 2; col < width; col += step) {
      const r = step * (.09 + .13 * row / height);
      ctx.moveTo(x + col + r, y + row);
      ctx.arc(x + col, y + row, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function skyline(ctx, width, height, back, palette) {
  const base = height * (back ? .94 : 1.04);
  const count = back ? 13 : 8;
  const spacing = width / count;
  ctx.lineWidth = back ? 1.2 : 2.2;
  ctx.strokeStyle = palette.outline;
  for (let index = 0; index <= count; index += 1) {
    const x = (index - .3) * spacing;
    const w = spacing * (index % 2 ? .93 : 1.21);
    const tower = index % 4 === (back ? 2 : 0);
    const h = height * ((back ? .17 : .23) + (index * 7 % 9) * .025 + (tower ? .18 : 0));
    const y = base - h;
    const step = h * .18;
    const face = back ? palette.distant : palette.towers[index % palette.towers.length];
    polygon(ctx, [
      [x, base], [x, y + step * 2], [x + w * .18, y + step * 2], [x + w * .18, y + step],
      [x + w * .32, y + step], [x + w * .32, y], [x + w * .68, y],
      [x + w * .68, y + step], [x + w * .82, y + step], [x + w * .82, y + step * 2],
      [x + w, y + step * 2], [x + w, base],
    ], face);
    if (tower) {
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y - step * 1.8);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
    }
    ctx.fillStyle = back ? palette.distantWindow : index % 3 === 0 ? palette.warmWindow : palette.coolWindow;
    for (let col = 1; col <= 4; col += 1) {
      const windowX = x + w * col / 5;
      for (let row = 0; row < 4; row += 1) {
        if ((row * 3 + col + index) % 5 !== 0) {
          ctx.fillRect(windowX, y + h * (.43 + row * .13), Math.min(4, w * .08), h * .076);
        }
      }
    }
  }
}

// Rooftops along the foot of the caption panel: left edge, width and how far
// each roof sits below the tallest, as shares of the panel and its roof band.
const ROOFS = [[0, .21, .39], [.24, .14, .13], [.41, .25, .52], [.7, .12, .22], [.85, .18, .61]];

// The row above the skyline: a caption panel and a wide panel of speed lines
// that the host's big word lands on, centred across the page like the word.
function paintTopRow(ctx, x, y, width, height, gutter, pageWidth, palette, caption) {
  const captionWidth = width * .35;
  const burstX = x + captionWidth + gutter;
  const burstWidth = width - captionWidth - gutter;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = palette.rule;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, captionWidth, height);
  ctx.clip();
  ctx.fillStyle = palette.cyan;
  ctx.fillRect(x, y, captionWidth, height);
  halftone(ctx, x, y, captionWidth, height, 7, palette.skyDots);
  const roofs = height * .32;
  ctx.fillStyle = palette.outline;
  for (const [left, share, drop] of ROOFS) {
    ctx.fillRect(x + captionWidth * left, y + height - roofs * (1 - drop), captionWidth * share, roofs);
  }
  // Narrow panels set the caption smaller rather than squeezing its letters.
  const text = caption.toUpperCase();
  const inset = Math.max(6, height * .08);
  let size = Math.max(9, Math.min(height * .11, 17));
  ctx.font = `bold ${size}px Georgia, serif`;
  size = Math.max(7, Math.min(size, size * (captionWidth - inset * 2 - 3) / (ctx.measureText(text).width + size * 1.4)));
  const pad = size * .7;
  ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const textWidth = Math.min(ctx.measureText(text).width, captionWidth - inset * 2 - pad * 2 - 3);
  const boxWidth = textWidth + pad * 2;
  const boxHeight = size * 1.9;
  ctx.fillStyle = palette.outline;
  ctx.fillRect(x + inset + 3, y + inset + 3, boxWidth, boxHeight);
  ctx.fillStyle = palette.page;
  ctx.fillRect(x + inset, y + inset, boxWidth, boxHeight);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + inset, y + inset, boxWidth, boxHeight);
  ctx.fillStyle = palette.lettering;
  ctx.fillText(text, x + inset + pad, y + inset + boxHeight / 2, textWidth);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, captionWidth, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(burstX, y, burstWidth, height);
  ctx.clip();
  ctx.fillStyle = palette.saffron;
  ctx.fillRect(burstX, y, burstWidth, height);
  halftone(ctx, burstX, y, burstWidth, height, 7, palette.skyDots);
  const focusX = pageWidth / 2;
  const focusY = y + height * .62;
  const reach = Math.hypot(width, height);
  const rays = 40;
  ctx.fillStyle = palette.skyDots;
  ctx.beginPath();
  for (let ray = 0; ray < rays; ray += 1) {
    const from = ray * Math.PI * 2 / rays;
    const to = from + Math.PI * 2 / rays * .4;
    ctx.moveTo(focusX, focusY);
    ctx.lineTo(focusX + Math.cos(from) * reach, focusY + Math.sin(from) * reach);
    ctx.lineTo(focusX + Math.cos(to) * reach, focusY + Math.sin(to) * reach);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  ctx.strokeRect(burstX, y, burstWidth, height);
}

function paintPanels(ctx, width, height, palette, accent, caption) {
  const shortSide = Math.min(width, height);
  const gutter = Math.min(shortSide * .055, Math.max(7, shortSide * .021));
  const stripY = height * .79;
  const heroY = height * .235;
  const heroWidth = width - gutter * 2;
  const heroHeight = stripY - heroY;
  ctx.fillStyle = palette.page;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(gutter, gutter, heroWidth, height - gutter * 2);
  paintTopRow(ctx, gutter, gutter, heroWidth, heroY - gutter * 2, gutter, width, palette, caption);

  ctx.save();
  ctx.translate(gutter, heroY);
  ctx.beginPath();
  ctx.rect(0, 0, heroWidth, heroHeight);
  ctx.clip();
  ctx.fillStyle = palette.sky;
  ctx.fillRect(0, 0, heroWidth, heroHeight);

  const sunX = heroWidth * .76;
  const sunY = heroHeight * .43;
  const sunRadius = Math.min(heroWidth, heroHeight) * .31;
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.outline;
  ctx.fillStyle = palette.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  halftone(ctx, 0, 0, heroWidth, heroHeight, Math.max(6, gutter * .5), palette.skyDots);
  skyline(ctx, heroWidth, heroHeight, true, palette);
  skyline(ctx, heroWidth, heroHeight, false, palette);
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = palette.rule;
  ctx.strokeRect(gutter, heroY, heroWidth, heroHeight);
  const stripHeight = height - stripY - gutter * 3;
  const detailWidth = heroWidth * .32;
  ctx.save();
  ctx.translate(gutter, stripY + gutter);
  ctx.beginPath();
  ctx.rect(0, 0, heroWidth, stripHeight);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, heroWidth, stripHeight);
  halftone(ctx, 0, 0, heroWidth, stripHeight, 6, palette.stripDots);
  ctx.strokeStyle = palette.outline;
  polygon(ctx, [[0, 0], [detailWidth + gutter, 0], [detailWidth - gutter, stripHeight], [0, stripHeight]], palette.detail);
  drawPlane(ctx, detailWidth * .27, stripHeight * .88, Math.min(detailWidth, stripHeight) * 1.13, -.37);
  ctx.lineWidth = 1;
  for (let line = 0; line < 8; line += 1) {
    const y = (line + 1) * stripHeight / 9;
    ctx.beginPath();
    ctx.moveTo(detailWidth + gutter * 2 + (line * 17 % 41), y);
    ctx.lineTo(heroWidth, y - stripHeight * .54);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeRect(gutter, stripY + gutter, heroWidth, stripHeight);
  return { gutter, heroY, heroWidth, heroHeight };
}

function drawPlane(ctx, x, y, radius, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(radius, radius);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = DART_INK;
  for (const fold of DART_FOLDS) polygon(ctx, fold.points, fold.fill, false);
  ctx.lineWidth = .032;
  ctx.globalAlpha = .55;
  for (const [from, to] of DART_CREASES) {
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(...to);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = .047;
  for (const fold of DART_FOLDS) {
    ctx.beginPath();
    ctx.moveTo(...fold.points[0]);
    for (const point of fold.points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function burst(ctx, x, y, radius, age, palette, accent, celebrate) {
  const opacity = 1 - range(age, .08, celebrate ? 1.25 : .56);
  if (age <= 0 || opacity <= 0) return;
  const spread = radius * (.8 + Math.min(age, 1) * 1.4);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.outline;
  const count = celebrate ? 15 : 9;
  for (let ray = 0; ray < count; ray += 1) {
    const angle = ray * Math.PI * 2 / count + .18;
    const r = spread * (.7 + ray % 3 * .18);
    ctx.save();
    ctx.rotate(angle);
    polygon(ctx, [[r, 0], [r + radius * .3, -3], [r + radius * .58, 0], [r + radius * .3, 3]], ray % 2 ? PAPER : accent);
    ctx.restore();
  }
  ctx.restore();
}

function drawProof(ctx, title, x, y, radius, shown, palette, accent) {
  if (!shown) return;
  const width = radius * 3;
  const height = radius * 1.55;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-.09);
  ctx.scale(.48 + shown * .52, shown);
  ctx.globalAlpha = shown;
  ctx.fillStyle = INK;
  ctx.fillRect(-width / 2 + 5, -height / 2 + 5, width, height);
  ctx.fillStyle = palette.proof;
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 2;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(-width * .43, -height * .35, width * .86, height * .11);
  ctx.font = `bold ${Math.round(radius * .31)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.lettering;
  ctx.fillText(title, 0, height * .018, width * .84);
  ctx.fillRect(-width * .43, height * .24, width * .68, 1.5);
  ctx.fillRect(-width * .43, height * .34, width * .46, 1.5);
  ctx.restore();
}

function createCourierScene(container, title, variant) {
  const canvas = document.createElement('canvas');
  const backdrop = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const panels = backdrop.getContext('2d');
  const caption = Array.from(title?.trim().replace(/\s+/g, ' ') || 'This run').slice(0, 42).join('');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  container.append(canvas);
  const style = getComputedStyle(canvas);
  let palette;
  let width = 0, height = 0, ratio = 0, panel, disposed = false;

  function render(time) {
    if (disposed) return;
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (!nextWidth || !nextHeight) return;
    const nextRatio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    const nextPalette = style.colorScheme === 'dark' ? NIGHT : DAY;
    const accent = nextPalette[variant.accent];
    if (width !== nextWidth || height !== nextHeight || ratio !== nextRatio || palette !== nextPalette) {
      palette = nextPalette;
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      canvas.width = backdrop.width = Math.ceil(width * ratio);
      canvas.height = backdrop.height = Math.ceil(height * ratio);
      panels.setTransform(ratio, 0, 0, ratio, 0, 0);
      panel = paintPanels(panels, width, height, palette, accent, variant.caption);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { gutter, heroY, heroWidth, heroHeight } = panel;
    const age = time - variant.lands;
    const flight = range(time, .16, variant.lands);
    const exit = variant.proof ? 0 : smooth(range(age, .24, variant.celebrate ? 1.7 : .91));
    const targetY = heroY + heroHeight * .57;
    const x = mix(-width * .04, width * variant.target, flight) + width * .58 * exit;
    const y = targetY - heroHeight * (Math.sin(Math.PI * flight) * variant.arc + exit * .56);
    const radius = Math.max(10, Math.min(width, heroHeight * 1.75) * mix(.072, .155, smooth(flight)));
    const angle = mix(-.31, .13, flight) - exit * .52;
    const shown = variant.proof ? smooth(range(age, 0, .38)) : 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter + 2, heroY + 2, heroWidth - 4, heroHeight - 4);
    ctx.clip();
    ctx.strokeStyle = palette.trail;
    ctx.globalAlpha = Math.sin(Math.PI * range(time, .16, variant.lands + .14)) * .66;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    for (let line = 0; line < 5; line += 1) {
      const tail = x - radius * (.7 + line * .1);
      const trailY = y + (line - 2) * radius * .22;
      ctx.moveTo(tail, trailY);
      ctx.lineTo(tail - radius * (.45 + (line % 3) * .33), trailY - angle * radius * .6);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    burst(ctx, width * variant.target, targetY, radius, age, palette, accent, variant.celebrate);
    drawProof(ctx, caption, x, y, radius, shown, palette, accent);
    ctx.globalAlpha = 1 - shown;
    drawPlane(ctx, x, y, radius, angle);
    ctx.restore();
  }

  return {
    canvas,
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.remove();
      canvas.width = canvas.height = backdrop.width = backdrop.height = 0;
    },
  };
}

export default {
  yeet: (container, title) => createCourierScene(container, title, SEND_OFFS.yeet),
  pr: (container, title) => createCourierScene(container, title, SEND_OFFS.pr),
  plan: (container, title) => createCourierScene(container, title, SEND_OFFS.plan),
  clear: (container, title) => createCourierScene(container, title, SEND_OFFS.clear),
  factory: (container, options) => createFactory(container, printShop, options),
  look: {
    words: { yeet: 'ZIP!', pr: 'PR UP!', plan: 'PLAN!', clear: 'SETTLED!' },
    background: 'light-dark(#fff8e7,#17232e)',
    ink: 'light-dark(#19232f,#fff2d5)',
    glow: '2px 2px 0 light-dark(#fff8e7,#111c26), 5px 6px 0 light-dark(#e7b54c,#416674)',
    flash: 'light-dark(#fff8e7,#344550)',
    flashGlow: 'light-dark(#e7b54c75,#41667475)',
  },
};
