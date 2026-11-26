// Phosphor mode. data-phosphor on <html> is the whole switch: theme.css
// repaints the shell and the artifact pages from it, a green CRT by night and
// plain printout paper by day, and this module adds the hex rain, packets,
// worms, CRT glass with boot sequence, glyph bursts and typing echoes.

import { defineFunMode } from '/js/fun-modes.js';
import { soundsAreEnabled } from '/js/activity.js';
import { soundContext, soundVolume } from '/js/sound.js';
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

// Pictures show through the glass. The glass stays one full-window layer, and
// a mask cuts a clear hole in it over each image and video on screen, in the
// shell and in its same-origin artifact frames, so screenshots keep their own
// pixels while scanlines, the rolling band and glitches stay on everything
// else. Icons, avatars and emoji are smaller than CLEAR_GLASS_MIN and keep the
// glass. The holes follow scrolling, resizing and panels opening: any of those
// starts a short run of frames that ends once the holes stop moving.
const CLEAR_GLASS_MEDIA = 'img, video';
const CLEAR_GLASS_MIN = 48;
const CLEAR_GLASS_CAP = 30;
const CLEAR_GLASS_SETTLE = 12;
const CLEAR_GLASS_OWN = '#phosphor-scene, #phosphor-crt, [id^="typing-fx"]';
const CLEAR_GLASS_SHEET = 'linear-gradient(#000 0 0)';
const CLEAR_GLASS_EVENTS = ['scroll', 'load', 'transitionend'];
let clearGlass = null;

function intersectBox(a, b) {
  const box = {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

function shiftBox(box, dx, dy) {
  return { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy };
}

// The part of el that no scroll container or frame edge cuts off, in its own
// document's coordinates.
function clearGlassOnScreen(el, view, frameBox, cuts) {
  if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < CLEAR_GLASS_MIN || rect.height < CLEAR_GLASS_MIN) return null;
  let box = intersectBox(rect, frameBox);
  for (let up = el.parentElement; box && up && up !== el.ownerDocument.documentElement; up = up.parentElement) {
    let cutsHere = cuts.get(up);
    if (cutsHere === undefined) {
      const style = view.getComputedStyle(up);
      cutsHere = style.overflowX !== 'visible' || style.overflowY !== 'visible';
      cuts.set(up, cutsHere);
    }
    if (cutsHere) box = intersectBox(box, up.getBoundingClientRect());
  }
  return box;
}

function clearGlassCollect(doc, dx, dy, frameBox, boxes) {
  const view = doc.defaultView;
  if (!view) return;
  hookClearGlassDocument(doc);
  const cuts = new Map();
  for (const el of doc.querySelectorAll(CLEAR_GLASS_MEDIA)) {
    if (el.closest(CLEAR_GLASS_OWN)) continue;
    const box = clearGlassOnScreen(el, view, frameBox, cuts);
    if (box) boxes.push(shiftBox(box, dx, dy));
  }
  for (const frame of doc.querySelectorAll('iframe')) {
    let inner = null;
    try { inner = frame.contentDocument; } catch {}
    if (!inner?.documentElement) continue;
    const outer = clearGlassOnScreen(frame, view, frameBox, cuts);
    if (!outer) continue;
    const rect = frame.getBoundingClientRect();
    const left = rect.left + frame.clientLeft;
    const top = rect.top + frame.clientTop;
    const content = intersectBox(outer, { left, top, right: left + frame.clientWidth, bottom: top + frame.clientHeight });
    if (content) clearGlassCollect(inner, dx + left, dy + top, shiftBox(content, -left, -top), boxes);
  }
}

function clearGlassMask(crt, holes) {
  const style = crt.style;
  const prefix = clearGlass.prefixed ? '-webkit-' : '';
  if (!holes.length) {
    for (const prop of ['image', 'position', 'size', 'repeat', 'composite']) style.removeProperty(prefix + 'mask-' + prop);
    return;
  }
  const each = value => holes.map(() => value);
  // The whole sheet is the top layer, and the holes, added together beneath
  // it, are subtracted from it.
  style.setProperty(prefix + 'mask-image', [CLEAR_GLASS_SHEET, ...each(CLEAR_GLASS_SHEET)].join(', '));
  style.setProperty(prefix + 'mask-position', ['0 0', ...holes.map(b => b.left + 'px ' + b.top + 'px')].join(', '));
  style.setProperty(prefix + 'mask-size', ['100% 100%', ...holes.map(b => (b.right - b.left) + 'px ' + (b.bottom - b.top) + 'px')].join(', '));
  style.setProperty(prefix + 'mask-repeat', 'no-repeat');
  style.setProperty(prefix + 'mask-composite', clearGlass.prefixed
    ? ['source-out', ...each('source-over')].join(', ')
    : ['subtract', ...each('add')].join(', '));
}

function paintClearGlass() {
  const crt = document.getElementById('phosphor-crt');
  if (!crt) return '';
  for (const doc of clearGlass.documents.keys()) {
    if (!doc.defaultView) unhookClearGlassDocument(doc);
  }
  const boxes = [];
  // By day the glass paints nothing, so it needs no holes.
  if (getComputedStyle(crt).backgroundImage !== 'none') {
    clearGlassCollect(document, 0, 0, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, boxes);
  }
  const area = b => (b.right - b.left) * (b.bottom - b.top);
  const holes = boxes
    .map(b => ({ left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) }))
    .sort((a, b) => area(b) - area(a))
    .slice(0, CLEAR_GLASS_CAP);
  const key = holes.map(b => [b.left, b.top, b.right, b.bottom].join(',')).join(';');
  if (key !== clearGlass.key) {
    clearGlass.key = key;
    clearGlassMask(crt, holes);
  }
  return key;
}

function clearGlassFrame() {
  if (!clearGlass) return;
  clearGlass.frame = 0;
  const before = clearGlass.key;
  if (paintClearGlass() === before) clearGlass.still++;
  else clearGlass.still = 0;
  if (clearGlass?.still < CLEAR_GLASS_SETTLE) clearGlass.frame = requestAnimationFrame(clearGlassFrame);
}

function scheduleClearGlass() {
  if (!clearGlass) return;
  clearGlass.still = 0;
  if (!clearGlass.frame) clearGlass.frame = requestAnimationFrame(clearGlassFrame);
}

// The glass's own layers and the typing effects change all the time and
// never move a picture, so their changes are ignored.
function clearGlassMutated(records) {
  for (const record of records) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (!target?.closest(CLEAR_GLASS_OWN)) {
      scheduleClearGlass();
      return;
    }
  }
}

function hookClearGlassDocument(doc) {
  if (clearGlass.documents.has(doc)) return;
  for (const type of CLEAR_GLASS_EVENTS) doc.addEventListener(type, scheduleClearGlass, { capture: true, passive: true });
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(clearGlassMutated) : null;
  observer?.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
  clearGlass.documents.set(doc, observer);
}

function unhookClearGlassDocument(doc) {
  for (const type of CLEAR_GLASS_EVENTS) doc.removeEventListener(type, scheduleClearGlass, { capture: true });
  clearGlass.documents.get(doc)?.disconnect();
  clearGlass.documents.delete(doc);
}

const darkScheme = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function startClearGlass() {
  if (clearGlass || typeof getComputedStyle !== 'function') return;
  const prefixed = !globalThis.CSS?.supports?.('mask-composite', 'subtract');
  clearGlass = { frame: 0, still: 0, key: '', prefixed, documents: new Map() };
  window.addEventListener('resize', scheduleClearGlass);
  darkScheme()?.addEventListener?.('change', scheduleClearGlass);
  hookClearGlassDocument(document);
  scheduleClearGlass();
}

function stopClearGlass() {
  if (!clearGlass) return;
  cancelAnimationFrame(clearGlass.frame);
  window.removeEventListener('resize', scheduleClearGlass);
  darkScheme()?.removeEventListener?.('change', scheduleClearGlass);
  for (const doc of [...clearGlass.documents.keys()]) unhookClearGlassDocument(doc);
  clearGlass = null;
}

function phosphorGlass(active, boot, { piece }) {
  const crt = document.getElementById('phosphor-crt');
  if (active && !crt) {
    document.body.append(phosphorCrtLayer(piece));
    if (boot) phosphorBoot(piece);
  }
  if (!active && crt) crt.remove();
  if (active) startClearGlass();
  else stopClearGlass();
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

const HI75_INPUT = 'html[data-phosphor] #run-terminal.terminal-staged:not(.terminal-stage-pending) .xterm-helper-textarea:focus';
let hi75Samples;

function loadHi75(context) {
  if (!hi75Samples) {
    hi75Samples = fetch(new URL('./hi75.mp3', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error('Hi75 audio unavailable');
        return response.arrayBuffer();
      })
      .then(bytes => context.decodeAudioData(bytes))
      .catch(() => { hi75Samples = null; });
  }
  return hi75Samples;
}

async function phosphorTerminalSound(event) {
  const input = event.target;
  if (!input.matches?.(HI75_INPUT) || !soundsAreEnabled() || !soundVolume()) return;
  const { key } = event;
  if (event.type === 'keydown' && (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
      || (key.length !== 1 && key !== 'Enter' && key !== 'Backspace'))) return;
  try {
    const context = soundContext();
    if (!context) return;
    const samples = loadHi75(context);
    if (event.type === 'focusin') return;
    const pressed = performance.now();
    if (context.state !== 'running') context.resume().catch(() => {});
    const buffer = await samples;
    // A cold download or a blocked audio device must never replay a backlog of keystrokes.
    if (!buffer || context.state !== 'running' || performance.now() - pressed > 80
        || !input.matches(HI75_INPUT) || !soundsAreEnabled()) return;
    const first = key === 'Enter' ? 14 : key === ' ' ? 8 : 0;
    const take = first + Math.floor(Math.random() * (first === 0 ? 8 : 6));
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = soundVolume() * (key === 'Enter' ? 0.42 : 0.28);
    source.connect(gain).connect(context.destination);
    source.start(0, take * 0.25, 0.25);
  } catch {
    // Typing still works when the browser cannot play audio.
  }
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
  for (const type of ['focusin', 'keydown']) {
    window.addEventListener(type, phosphorTerminalSound, { capture: true, signal: ctx?.signal });
  }
  return phosphorMode.activate(ctx);
}
