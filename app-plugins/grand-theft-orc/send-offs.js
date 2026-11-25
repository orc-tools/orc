import { wrap } from '../../ui/yeet/cast.js';
import { mix, range, smooth } from '../../ui/yeet/stage.js';

const WIDTH = 1254;
const HEIGHT = 418;

// The first three rows are the shots. The transparent fourth row holds their moving parts.
function motelStage(container, actor, focus, camera, paint) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  const ctx = canvas.getContext('2d');
  const appearance = getComputedStyle(container);
  const sheets = ['day', 'night'].map(mode => {
    const image = new Image();
    image.src = new URL(`./send-off-${actor}-${mode}.webp`, import.meta.url).href;
    return image;
  });
  let sheet = sheets[0];
  let disposed = false;
  const ready = Promise.all(sheets.map(image => image.decode())).then(() => {
    if (!disposed) container.append(canvas);
  });

  function frame(row) {
    ctx.drawImage(sheet, 0, row * HEIGHT, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
  }
  function part(x, y, w, h, left, top) {
    ctx.drawImage(sheet, x, 3 * HEIGHT + y, w, h, left, top, w, h);
  }
  function render(time) {
    const width = container.clientWidth, height = container.clientHeight;
    if (disposed || !width || !height || !sheet.naturalWidth) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixels = Math.round(width * ratio), rows = Math.round(height * ratio);
    if (canvas.width !== pixels || canvas.height !== rows) {
      canvas.width = pixels;
      canvas.height = rows;
    }
    const dark = appearance.colorScheme === 'dark';
    sheet = dark ? sheets[1] : sheets[0];
    // A portrait window keeps the face, hand and prop together in one shot.
    const scale = Math.min(Math.max(width / WIDTH, height / HEIGHT), width / (WIDTH * .43)) * camera(time);
    const left = Math.max(width - WIDTH * scale, Math.min(0, width / 2 - WIDTH * scale * focus));
    const top = (height - HEIGHT * scale) / 2;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (top > 0) {
      ctx.fillStyle = dark ? '#221c2d' : '#f7ede0';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.translate(left, top);
    ctx.scale(scale, scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    ctx.clip();
    paint(ctx, frame, part, time);
    ctx.restore();
  }
  return { canvas, ready, render, dispose() { disposed = true; canvas.remove(); } };
}

function crackSeal(ctx, x, y, progress) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(-16, -16, 32, 32 * progress);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(3, -16);
  ctx.lineTo(-2, -6);
  ctx.lineTo(2, 0);
  ctx.lineTo(-4, 6);
  ctx.lineTo(-2, 16);
  ctx.strokeStyle = '#923b34';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function cardInscription(title) {
  const text = title?.trim() || 'This run';
  let lines, font, lineHeight;
  for (let size = 23; size >= 11; size -= 2) {
    font = '650 ' + size + 'px system-ui, sans-serif';
    lines = wrap(text, 131, Infinity, font);
    lineHeight = size + 2;
    if (lines.length * lineHeight <= 70) break;
  }
  return ctx => {
    ctx.save();
    ctx.translate(790, 109);
    ctx.rotate(-.043);
    ctx.scale(1, Math.min(1, 70 / (lines.length * lineHeight)));
    ctx.fillStyle = '#492c33';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineHeight, 131));
    ctx.restore();
  };
}

export function openEnvelope(container, title) {
  const inscribe = cardInscription(title);
  const camera = t => 1 + .035 * smooth(range(t, .5, 1.35)) + .24 * smooth(range(t, 2.93, 3.65));
  return motelStage(container, 'sheila', .535, camera, (ctx, frame, part, time) => {
    if (time < 1.38) {
      frame(0);
      crackSeal(ctx, 624, 373, range(time, .94, 1.29));
    } else if (time < 2.96) {
      frame(1);
      const pull = smooth(range(time, 1.38, 2.56));
      ctx.save();
      // Pivot at the elbow. The card rises behind the envelope's front lip.
      ctx.translate(842, 0);
      ctx.transform(1, -.32 * (1 - pull), 0, 1, 0, 0);
      part(0, 0, 320, 283, 576 - 842, 85);
      ctx.restore();
      part(328, 0, 255, 166, 536, 237);
      crackSeal(ctx, 692, 318, 1);
    } else {
      frame(2);
      crackSeal(ctx, 582, 380, 1);
      inscribe(ctx);
    }
  });
}

export function driveAway(container) {
  const camera = t => 1 + .045 * smooth(range(t, 1.6, 2.22)) * (1 - smooth(range(t, 2.38, 2.72)));
  return motelStage(container, 'gary', .54, camera, (ctx, frame, part, time) => {
    if (time < 1.62) {
      frame(0);
      const catchKey = range(time, .38, 1.53);
      ctx.save();
      ctx.translate(mix(428, 604, catchKey), mix(110, 141, catchKey) - 103 * Math.sin(Math.PI * catchKey));
      ctx.rotate(mix(-1.7, .32, catchKey));
      ctx.globalAlpha = 1 - smooth(range(time, 1.43, 1.57));
      part(1156, 0, 86, 88, -43, -44);
      ctx.restore();
    } else if (time < 2.64) {
      frame(1);
    } else {
      frame(2);
      const travel = range(time, 3.52, 4.84);
      ctx.translate(-WIDTH * travel * travel, 0);
      ctx.fillStyle = 'rgba(25, 17, 30, .32)';
      ctx.beginPath();
      ctx.ellipse(597, 388, 494, 26, -.025, 0, 2 * Math.PI);
      ctx.fill();
      part(52, 60, 1100, 358, 52, 60);
      // Gary's elbow stays on the sill as the coupe picks up speed.
      const wave = range(time, 2.64, 4.32);
      ctx.translate(761, 184);
      ctx.rotate(.17 * Math.sin(wave * 3 * Math.PI));
      part(1156, 92, 96, 116, 738 - 761, 74 - 184);
    }
  });
}
