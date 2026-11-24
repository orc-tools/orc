// Phosphor mode. data-phosphor on <html> is the whole switch: theme.css
// repaints the shell and the artifact pages from it, a green CRT by night and
// plain printout paper by day, and this module adds the hex rain, packets,
// worms, CRT glass with boot sequence, glyph bursts and typing echoes.

import { defineFunMode } from '/js/fun-modes.js';
import { reducedMotion } from '/js/motion.js';

const PHOSPHOR_GLYPHS = '0123456789ABCDEF<>{}[]/=+*#%&@~^|:;!?';
const PHOSPHOR_RAIN_COLUMNS = 14;
const PHOSPHOR_PACKETS = ['SYN', 'ACK', '0xBEEF', '200 OK', 'sudo', '>_', '127.0.0.1', 'ping', 'λ', '{ }'];
const PHOSPHOR_WORMS = [['~~~~~:>', '1'], ['<:~~~~~', '-1']];
const PHOSPHOR_SPARKS = ['0', '1', '#', '*', '%', '1', '0', '&'];
const PHOSPHOR_BOOT = [
  'PHOSPHOR BIOS v4.04  (C) 1983 ORC SYSTEMS',
  'CPU 6502 @ 1.79MHz ............ OK',
  'MEMORY TEST 640K .............. OK',
  'MOUNT /dev/swamp .............. OK',
  'LOADING ORC.SYS ............... OK',
  '> ACCESS GRANTED',
];
const PHOSPHOR_SPARK_CAP = 48;
const PHOSPHOR_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
  + "<rect width='64' height='64' rx='12' fill='#050a06'/>"
  + "<rect x='3' y='3' width='58' height='58' rx='10' fill='none' stroke='#39ff6a' stroke-width='3'/>"
  + "<path d='M14 20l12 12-12 12' fill='none' stroke='#39ff6a' stroke-width='6' stroke-linecap='square'/>"
  + "<rect x='30' y='40' width='20' height='6' fill='#39ff6a'/>"
  + "<path d='M6 12h52M6 24h52M6 36h52M6 48h52' stroke='#050a06' stroke-opacity='.45' stroke-width='2'/>"
  + '</svg>',
);
let phosphorTrailTurn = 0;

function phosphorRainText(column, length) {
  const glyphs = [];
  for (let i = 0; i < length; i++) {
    glyphs.push(PHOSPHOR_GLYPHS[(column * 11 + i * 7 + (i * i) % 5) % PHOSPHOR_GLYPHS.length]);
  }
  return glyphs.join('\n');
}

function phosphorSceneLayer({ piece }) {
  const scene = document.createElement('div');
  scene.id = 'phosphor-scene';
  scene.setAttribute('aria-hidden', 'true');
  const thing = (kind, face, place) => piece('phosphor-thing phosphor-' + kind, face, place);
  for (let i = 0; i < PHOSPHOR_RAIN_COLUMNS; i++) {
    scene.append(thing('rain', phosphorRainText(i, 14 + (i * 5) % 12), {
      '--x': 2 + (i * 37 + 5) % 96 + '%',
      '--size': 11 + (i * 3) % 6 + 'px',
      '--dur': 7 + (i * 5) % 9 + 's',
      '--delay': '-' + ((0.9 + i * 2.7) % 15).toFixed(1) + 's',
    }));
  }
  PHOSPHOR_PACKETS.forEach((face, i) => scene.append(thing('packet', face, {
    '--x': 4 + (i * 29 + 13) % 90 + '%',
    '--size': 11 + (i * 3) % 5 + 'px',
    '--dur': 16 + (i * 7) % 14 + 's',
    '--delay': '-' + ((2.3 + i * 3.9) % 22).toFixed(1) + 's',
    '--sway': 6 + (i * 5) % 12 + 'px',
  })));
  PHOSPHOR_WORMS.forEach(([face, dir], i) => scene.append(thing('worm', face, {
    '--size': 14 + i * 2 + 'px',
    '--dur': 26 + i * 9 + 's',
    '--delay': '-' + (4.5 + i * 11).toFixed(1) + 's',
    '--dir': dir,
  })));
  return scene;
}

function phosphorCrtLayer(piece) {
  const crt = document.createElement('div');
  crt.id = 'phosphor-crt';
  crt.setAttribute('aria-hidden', 'true');
  crt.append(piece('phosphor-rollbar', '', {}), piece('phosphor-glitch', '', {}));
  return crt;
}

function phosphorBoot(piece) {
  const crt = document.getElementById('phosphor-crt');
  if (!crt || reducedMotion()) return;
  crt.querySelectorAll('.phosphor-boot').forEach(old => old.remove());
  const boot = piece('phosphor-boot', '', {});
  PHOSPHOR_BOOT.forEach((line, i) => boot.append(piece('phosphor-boot-line', line, {
    '--i': String(i), '--chars': String(line.length),
  })));
  boot.addEventListener('animationend', event => {
    if (event.target === boot) boot.remove();
  });
  crt.append(boot);
}

function phosphorGlass(active, boot, { piece }) {
  const crt = document.getElementById('phosphor-crt');
  if (active && !crt) {
    document.body.append(phosphorCrtLayer(piece));
    if (boot) phosphorBoot(piece);
  }
  if (!active && crt) crt.remove();
}

function phosphorBurst(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  const at = { '--px': x + 'px', '--py': y + 'px' };
  scene.append(zap('phosphor-zap phosphor-reticle', '', at));
  PHOSPHOR_SPARKS.forEach((face, i) => {
    const angle = i * Math.PI / 4;
    const reach = i % 2 ? 58 : 42;
    scene.append(zap('phosphor-zap phosphor-spark', face, {
      ...at,
      '--dx': Math.round(Math.cos(angle) * reach) + 'px',
      '--dy': Math.round(Math.sin(angle) * reach) + 'px',
    }));
  });
}

function phosphorTrailBit(x, y, { zap, layerWithRoom }) {
  const scene = layerWithRoom(1);
  if (!scene) return;
  const turn = phosphorTrailTurn++;
  scene.append(zap('phosphor-zap phosphor-spark phosphor-trail', turn % 3 ? String(turn % 2) : '#', {
    '--px': x + 'px',
    '--py': y + 'px',
    '--dx': (turn % 2 ? 1 : -1) * (4 + (turn * 3) % 7) + 'px',
    '--dy': 10 + (turn * 5) % 9 + 'px',
  }));
}

const PHOSPHOR_HEX = '0123456789ABCDEF';

function phosphorTyping({ kind, data, x, streak, fieldRect, spawn, topEdge }) {
  const side = streak % 2 ? 1 : -1;
  const edge = { '--x': topEdge.left + 'px', '--y': fieldRect.top + 'px', '--w': topEdge.width + 'px' };
  if (kind === 'char') {
    const glyph = Array.from(data || '').pop();
    if (glyph && glyph.trim()) spawn('phosphor-typed phosphor-typed-echo', glyph, { '--drift': side * 5 + 'px' });
    spawn('phosphor-typed phosphor-typed-cursor', '');
  } else if (kind === 'space') {
    spawn('phosphor-typed phosphor-typed-scan', '', edge);
  } else if (kind === 'delete') {
    for (let i = 0; i < 4; i++) {
      spawn('phosphor-typed phosphor-typed-bit', String((streak + i) % 2), {
        '--dx': (i % 2 ? 1 : -1) * (6 + i * 4) + 'px', '--dy': 10 + i * 5 + 'px',
      });
    }
  } else if (kind === 'paste') {
    const at = Math.min(Math.max(x, fieldRect.left + 20), fieldRect.right - 140);
    spawn('phosphor-typed phosphor-typed-granted', 'ACCESS GRANTED', { '--x': at + 'px', '--y': fieldRect.top + 'px' });
  }
  if (streak % 25 === 0) {
    let dump = '';
    for (let i = 0; i < 8; i++) {
      dump += PHOSPHOR_HEX[(streak * 7 + i * 5) % 16] + PHOSPHOR_HEX[(streak * 3 + i * 11) % 16] + ' ';
    }
    spawn('phosphor-typed phosphor-typed-dump', dump.trim(), { ...edge, '--y': fieldRect.top - 18 + 'px' });
  }
}

const phosphorMode = defineFunMode({
  id: 'phosphor',
  label: 'Phosphor',
  blurb: 'Green screens and code rain, h4ck~',
  favicon: PHOSPHOR_FAVICON,
  announce: { on: 'Phosphor mode on. Hack the planet~', off: 'Phosphor mode off' },
  layerId: 'phosphor-scene',
  zapSelector: '.phosphor-zap',
  zapCap: PHOSPHOR_SPARK_CAP,
  buildLayer: phosphorSceneLayer,
  onPaint: phosphorGlass,
  burst: phosphorBurst,
  trail: phosphorTrailBit,
  typing: phosphorTyping,
});

export const PHOSPHOR_STORAGE_KEY = phosphorMode.storageKey;
export const phosphorIsOn = phosphorMode.isOn;
export const paintPhosphor = phosphorMode.paint;
export const setPhosphor = phosphorMode.set;
export const togglePhosphor = phosphorMode.toggle;
export const leavePhosphor = phosphorMode.leave;
export function activate(ctx) {
  return phosphorMode.activate(ctx);
}
