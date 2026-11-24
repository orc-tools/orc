// Records a send-off frame by frame over screenshots of the window, for the
// animations gallery's silent MP4 export.
import { SCENES, seamOutline } from './scene-poses.js';
import { preloadScenes } from './theme-scenes.js';
import { mountScene } from './send-offs.js';

// Plays a scene over two screenshots of the window instead of the live page:
// `before` stands in for the page the papers copy, `after` for the page the
// layer fades back to, with the sidebar ending `left` px in. Each frame is the
// pose play() would lay out at exactly i / fps seconds, so an export runs at
// its own pace and never drops a frame. Resolves to JPEG data URLs.
export async function recordScene(name, { before, after, left, title, mode, fps, onFrame, theme }) {
  const spec = SCENES[name];
  const module = await preloadScenes(theme);
  theme = module.selected;
  const look = module.sceneLook(theme);
  const width = after.naturalWidth, height = after.naturalHeight;
  const box = { width: width - left, height };
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;top:0;left:${-box.width - 64}px;width:${box.width}px;height:${box.height}px;pointer-events:none`;
  host.style.colorScheme = mode;
  document.body.append(host);
  let stage;
  try {
    stage = await mountScene(name, host, title, theme);
    const frame = canvasOf(width, height), layer = canvasOf(box.width, box.height);
    const background = canvasOf(box.width, box.height);
    paintBackground(background.getContext('2d'), lightOrDark(look.background, mode), box.width, box.height);
    const word = wordImage(look.words[spec.name], look, mode, width, box);
    const frames = [], count = Math.round(spec.length * fps);
    for (let i = 0; i <= count; i++) {
      // Read back in the same task as the render: the WebGL buffer is
      // cleared once the frame is composited.
      stage.render(i / fps);
      composeFrame(frame, layer, spec.pose(i / fps), { spec, look, mode, before, after, left, stage, background, word });
      frames.push(frame.toDataURL('image/jpeg', .85));
      onFrame?.((i + 1) / (count + 1));
      await new Promise(resolve => setTimeout(resolve));
    }
    return frames;
  } finally {
    stage?.dispose();
    host.remove();
  }
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// The layer is drawn whole and then faded, because CSS opacity on the layer
// fades its overlapping parts as one image.
function composeFrame(frame, layer, pose, { spec, look, mode, before, after, left, stage, background, word }) {
  const out = frame.getContext('2d'), ctx = layer.getContext('2d');
  const { width, height } = layer;
  out.globalAlpha = 1;
  out.drawImage(after, 0, 0);
  if (pose.layer <= 0) return;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(background, 0, 0);
  pose.papers.forEach((paper, index) => {
    if (paper.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = paper.opacity;
    ctx.translate(width / 2 + paper.x / 100 * width, height / 2 + paper.y / 100 * height);
    ctx.rotate(paper.rotate * Math.PI / 180);
    ctx.scale(paper.scale, paper.scale);
    ctx.translate(-width / 2, -height / 2);
    ctx.beginPath();
    for (const [x, y] of seamOutline(spec.seam, index === 0 ? -1 : 1)) ctx.lineTo(x / 100 * width, y / 100 * height);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(before, -left, 0);
    ctx.restore();
  });
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(pose.zoom, pose.zoom);
  ctx.translate(-width / 2, -height / 2);
  if (pose.reveal && !stage.masksPage) {
    const [top, side] = pose.reveal.map(inset => inset / 100);
    ctx.beginPath();
    ctx.rect(side * width, top * height, width * (1 - 2 * side), height * (1 - 2 * top));
    ctx.clip();
  }
  ctx.drawImage(stage.canvas, 0, 0, width, height);
  ctx.restore();
  if (pose.word.opacity > 0) {
    const centre = word.top + word.height / 2;
    ctx.save();
    ctx.globalAlpha = pose.word.opacity;
    ctx.translate(width / 2, centre);
    ctx.rotate(pose.word.rotate * Math.PI / 180);
    ctx.translate(0, pose.word.y);
    ctx.scale(pose.word.scale, pose.word.scale);
    ctx.translate(-width / 2, -centre);
    ctx.drawImage(word.canvas, -word.pad, word.top - word.pad);
    ctx.restore();
  }
  if (pose.flash > 0) {
    const x = width / 2 - 3;
    ctx.save();
    ctx.globalAlpha = pose.flash;
    castShadow(ctx, { x: 0, y: 0, blur: 28, color: lightOrDark(look.flashGlow, mode) },
      () => ctx.fillRect(x - 10, -10, 26, height + 20));
    ctx.fillStyle = lightOrDark(look.flash, mode);
    ctx.fillRect(x, 0, 6, height);
    ctx.restore();
  }
  out.globalAlpha = pose.layer;
  out.drawImage(layer, left, 0);
  out.globalAlpha = 1;
}

// Paints only the shadow of `draw`: the shape itself lands far off the canvas.
function castShadow(ctx, { x, y, blur, color }, draw) {
  const away = 100000;
  ctx.save();
  ctx.translate(-away, 0);
  Object.assign(ctx, { shadowColor: color, shadowBlur: blur, shadowOffsetX: x + away, shadowOffsetY: y, fillStyle: '#000' });
  draw();
  ctx.restore();
}

// The .orc-yeet-word block rendered once, unrotated, with its text-shadow, so
// the glow turns and scales with the word as it does in CSS. The padding
// leaves room for the widest glow.
function wordImage(text, look, mode, viewWidth, box) {
  const boxWidth = box.width, ink = lightOrDark(look.ink, mode);
  const size = Math.min(160, Math.max(52, viewWidth * .12)), lineHeight = .9 * size, pad = 160;
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  const setFont = () => Object.assign(ctx, {
    font: `900 ${size}px ui-rounded,system-ui,sans-serif`,
    letterSpacing: `${-.08 * size}px`, wordSpacing: `${.22 * size}px`,
  });
  setFont();
  const lines = [];
  for (const piece of text.split(' ')) {
    const joined = lines.length ? `${lines[lines.length - 1]} ${piece}` : piece;
    if (lines.length && ctx.measureText(joined).width <= boxWidth) lines[lines.length - 1] = joined;
    else lines.push(piece);
  }
  canvas.width = boxWidth + 2 * pad;
  canvas.height = lines.length * lineHeight + 2 * pad;
  ctx = canvas.getContext('2d');
  setFont();
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(text);
  const baseline = (lineHeight - ascent - descent) / 2 + ascent;
  // Centred like text-align:center, except that CSS starts a line too wide
  // for the column at its left edge and lets it overflow the right.
  const write = () => lines.forEach((line, i) => {
    ctx.fillText(line, pad + Math.max(0, (boxWidth - ctx.measureText(line).width) / 2), pad + i * lineHeight + baseline);
  });
  // CSS paints the first shadow on top.
  for (const shadow of splitTopLevel(lightOrDark(look.glow, mode)).reverse()) {
    const parts = shadow.trim().split(/\s+/);
    const isLength = part => /^-?[\d.]+(px)?$/.test(part);
    const [x = 0, y = 0, blur = 0] = parts.filter(isLength).map(parseFloat);
    castShadow(ctx, { x, y, blur, color: parts.find(part => !isLength(part)) || ink }, write);
  }
  ctx.fillStyle = ink;
  write();
  return { canvas, pad, top: .09 * box.height, height: lines.length * lineHeight };
}

// radial-gradient(ellipse at X% Y%, stops...), the form every look uses, at
// CSS's default farthest-corner size; anything else paints as a plain colour.
function paintBackground(ctx, value, width, height) {
  const gradient = /^radial-gradient\(\s*ellipse\s+at\s+([\d.]+)%\s+([\d.]+)%\s*,(.*)\)$/s.exec(value.trim());
  const stops = gradient && splitTopLevel(gradient[3]).map(stop => /^(.+?)\s+([\d.]+)%$/.exec(stop.trim()));
  ctx.fillStyle = '#191d20';
  if (!stops || stops.some(stop => !stop)) {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const cx = gradient[1] / 100 * width, cy = gradient[2] / 100 * height;
  // Farthest-side radii, grown by √2 to reach the farthest corner.
  const rx = Math.max(cx, width - cx) * Math.SQRT2, ry = Math.max(cy, height - cy) * Math.SQRT2;
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [, color, at] of stops) fill.addColorStop(Math.min(1, at / 100), color);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = fill;
  ctx.fillRect(-cx, -cy * rx / ry, width, height * rx / ry);
  ctx.restore();
}

// Canvas has no colour scheme, so each light-dark(a,b) is settled up front.
function lightOrDark(value, mode) {
  let out = value;
  for (let at = out.indexOf('light-dark('); at >= 0; at = out.indexOf('light-dark(')) {
    let depth = 0, end = at + 'light-dark'.length;
    do { depth += out[end] === '(' ? 1 : out[end] === ')' ? -1 : 0; end++; } while (depth && end < out.length);
    const [light, dark = light] = splitTopLevel(out.slice(at + 'light-dark('.length, end - 1));
    out = out.slice(0, at) + (mode === 'dark' ? dark : light).trim() + out.slice(end);
  }
  return out;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && !depth) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, text.slice(start)];
}
