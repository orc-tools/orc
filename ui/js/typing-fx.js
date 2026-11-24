// Typing effects for the fun modes. Each mode registers a typing(at) hook with
// ui/js/fun-modes.js; this module works out where the caret went after an
// edit and hands the painted mode:
//   at.x, at.y     the caret, in viewport pixels
//   at.kind        'char', 'space', 'delete' or 'paste'
//   at.data        what was typed, for 'char'
//   at.streak      edits in quick succession, 1 for the first
//   at.fieldRect   the field's viewport rect, for effects along its edges
//   at.topEdge     { left, width }: the straight run of the top edge between
//                  the rounded corners of the composer (or the field), for
//                  effects that travel along it; one that stops on a corner
//                  stands proud of the curve and squares it off
//   at.spawn(className, text, place)
//                  adds one piece on the field's top edge above the caret, or
//                  wherever place's --x and --y say, and returns null once
//                  the layer is full
// Every theme, the swamp included, also heats the composer being typed in:
// --typing-heat on .newconv-prompt runs from 0 at 20 words a minute to 1 at
// 120, five edits to a word, and back to 0 once the streak ends. Each theme's
// stylesheet turns it into its own border and glow. The swamp has no hook, so
// heat is all it draws.
// Reduced motion, Reduce animations and forced colours draw nothing at all: they hide the layers
// while pieces would still pile up, and the stylesheets ignore the heat there.

import { funModeTyping, paintedFunMode } from './fun-modes.js';
import { animationsOff } from './motion.js';

// Pieces remove themselves when their animation ends, which never happens
// while animations are suppressed, as in print, so cap the pile.
const TYPING_PIECE_CAP = 80;
// The outer edge of the layer's clip path, past any viewport, since path()
// takes no percentages.
const TYPING_CLIP_FAR = 100000;
const TYPING_STREAK_GAP_MS = 700;
// index.html's --typing-heat transition, plus a frame or two.
const TYPING_HEAT_FADE_MS = 1100;
const TYPING_TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel']);
// Laying out more text than this before the caret costs more than the effect is worth.
const TYPING_MEASURE_LIMIT = 5000;
const TYPING_MIRRORED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontFeatureSettings', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'tabSize', 'textAlign', 'textIndent', 'textTransform', 'direction',
];

let typingStreak = 0;
let typingLastAt = -Infinity;
let typingStreakStart = 0;
let typingCalm = null;
let typingHotComposer = null;
let typingCooling = 0;
// composer -> the timer that ends its beat once the heat has faded
const typingFading = new Map();

// A field inside a design-system host, such as <orc-input type="password">,
// reaches the document retargeted to the host; composedPath has the real one.
function typingField(event) {
  const field = event.composedPath ? event.composedPath()[0] : event.target;
  if (!field || field.nodeType !== 1) return null;
  // xterm's hidden helper textarea follows its own cursor, not a caret.
  if (field.tagName === 'TEXTAREA') return field.classList.contains('xterm-helper-textarea') ? null : field;
  if (field.tagName === 'INPUT') return TYPING_TEXT_INPUTS.has(field.type) ? field : null;
  return field.isContentEditable ? field : null;
}

// Code that sets a value and fires a plain Event('input') has no inputType,
// so it draws nothing.
function typingKind(inputType, data) {
  if (!inputType) return null;
  // Committing an IME composition or a dead-key accent replaces the composed
  // text; insertCompositionText has already drawn each keystroke as a 'char'.
  if (inputType === 'deleteCompositionText' || inputType === 'insertFromComposition') return null;
  // Enter draws nothing: in a composer it starts the run or sends the message.
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') return null;
  // A paste the page rewrites arrives as one insertText of the whole text.
  if (inputType.startsWith('insertFrom') || (inputType === 'insertText' && data?.length > 1)) return 'paste';
  if (inputType.startsWith('delete')) return 'delete';
  if (inputType.startsWith('insert')) return data === ' ' ? 'space' : 'char';
  return null;
}

function typingMirror() {
  let mirror = document.getElementById('typing-fx-mirror');
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.id = 'typing-fx-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    document.body.append(mirror);
  }
  return mirror;
}

// A textarea or input never says where its caret is, so a hidden copy with
// the same box and font lays out the text up to it.
function typingCaret(field, fieldRect) {
  const fallback = { x: fieldRect.left + Math.min(24, fieldRect.width / 2), y: fieldRect.top + fieldRect.height / 2 };
  if (field.isContentEditable) {
    const selection = document.getSelection();
    const rect = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    return rect && rect.height ? { x: rect.right, y: rect.top + rect.height / 2 } : fallback;
  }
  const end = field.selectionEnd ?? field.value.length;
  if (end > TYPING_MEASURE_LIMIT) return fallback;
  const multiline = field.tagName === 'TEXTAREA';
  const scrolling = multiline && field.scrollHeight > field.clientHeight;
  const fieldStyle = getComputedStyle(field);
  const mirror = typingMirror();
  for (const name of TYPING_MIRRORED) mirror.style[name] = fieldStyle[name];
  mirror.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';
  mirror.style.overflowWrap = multiline ? 'break-word' : 'normal';
  mirror.style.overflowY = scrolling ? 'scroll' : 'hidden';
  mirror.textContent = field.value.slice(0, end);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  // DOM copies of the page, such as the send-offs' copyPage, would carry what was typed.
  mirror.textContent = '';
  const x = fieldRect.left + markerRect.left - mirrorRect.left - field.scrollLeft;
  // A single-line input centres its text however tall it is.
  const y = multiline
    ? fieldRect.top + markerRect.top - mirrorRect.top - field.scrollTop + markerRect.height / 2
    : fieldRect.top + fieldRect.height / 2;
  return {
    x: Math.min(Math.max(x, fieldRect.left), fieldRect.right),
    y: Math.min(Math.max(y, fieldRect.top), fieldRect.bottom),
  };
}

function typingLayer(id) {
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = id;
    layer.className = 'typing-fx';
    layer.setAttribute('aria-hidden', 'true');
    if (id === 'typing-fx-top') layer.setAttribute('popover', 'manual');
    document.body.append(layer);
  }
  return layer;
}

// A modal dialog or open popover sits in the top layer, above every z-index,
// so effects for a field inside one go to a popover layer of their own. It is
// raised above the newest dialog only when empty, which restarts nothing, and
// it closes again once empty, so it never covers a dialog or toast for longer
// than one effect.
function typingPieceLayer(event) {
  const path = event.composedPath ? event.composedPath() : [];
  const raised = path.some(node => (node.tagName === 'DIALOG' && node.open)
    || (node.hasAttribute?.('popover') && node.matches(':popover-open')));
  if (!raised) return typingLayer('typing-fx');
  const top = typingLayer('typing-fx-top');
  if (!top.showPopover) return typingLayer('typing-fx');
  if (!top.children.length) {
    if (top.matches(':popover-open')) top.hidePopover();
    top.showPopover();
  }
  return top;
}

function typingFrame(field) {
  const frame = field.closest('.newconv-prompt') || field;
  const rect = frame.getBoundingClientRect();
  const style = getComputedStyle(frame);
  // CSS draws a radius past half the box no bigger than half, and a larger
  // arc in the clip path would cross the opposite edge.
  const radius = name => Math.min(parseFloat(style[name]) || 0, rect.width / 2, rect.height / 2);
  return {
    rect,
    tl: radius('borderTopLeftRadius'), tr: radius('borderTopRightRadius'),
    br: radius('borderBottomRightRadius'), bl: radius('borderBottomLeftRadius'),
  };
}

// The layer never draws over the frame, so what is being typed stays readable.
// The hole takes the frame's rounded corners, so a piece passing a corner is
// cut along the curve rather than a square.
function typingSpawner(layer, caret, fieldRect, frame) {
  const { rect: { left: l, top: t, right: r, bottom: b }, tl, tr, br, bl } = frame;
  layer.style.setProperty('clip-path', `path(evenodd, "M0 0H${TYPING_CLIP_FAR}V${TYPING_CLIP_FAR}H0Z`
    + `M${l + tl} ${t}H${r - tr}A${tr} ${tr} 0 0 1 ${r} ${t + tr}V${b - br}A${br} ${br} 0 0 1 ${r - br} ${b}`
    + `H${l + bl}A${bl} ${bl} 0 0 1 ${l} ${b - bl}V${t + tl}A${tl} ${tl} 0 0 1 ${l + tl} ${t}Z")`);
  return (className, text, place = {}) => {
    if (layer.children.length >= TYPING_PIECE_CAP) return null;
    const piece = document.createElement('span');
    piece.className = className;
    piece.textContent = text;
    const props = { '--x': caret.x + 'px', '--y': fieldRect.top + 'px', ...place };
    for (const [name, value] of Object.entries(props)) piece.style.setProperty(name, value);
    piece.addEventListener('animationend', () => {
      piece.remove();
      if (layer.id === 'typing-fx-top' && !layer.children.length && layer.matches(':popover-open')) layer.hidePopover();
    }, { once: true });
    layer.append(piece);
    return piece;
  };
}

function typingTopEdge(fieldRect, { tl, tr }) {
  const left = Math.min(tl, fieldRect.width / 2);
  const right = Math.min(tr, fieldRect.width / 2);
  return { left: fieldRect.left + left, width: fieldRect.width - left - right };
}

// data-typing-hot runs the composer's beat (see index.html's --typing-pulse).
// The heat fades over a second and the beat shows through it, so the mark
// outlasts the heat by that long.
function typingBeat(composer, hot) {
  if (hot) {
    clearTimeout(typingFading.get(composer));
    typingFading.delete(composer);
    composer.setAttribute('data-typing-hot', '');
  } else if (composer.hasAttribute('data-typing-hot') && !typingFading.has(composer)) {
    typingFading.set(composer, setTimeout(() => {
      typingFading.delete(composer);
      composer.removeAttribute('data-typing-hot');
    }, TYPING_HEAT_FADE_MS));
  }
}

function typingCool() {
  const composer = typingHotComposer;
  typingHotComposer = null;
  if (!composer) return;
  composer.style.setProperty('--typing-heat', '0');
  typingBeat(composer, false);
}

// The piece layer is clipped around the field, so the composer itself
// carries the heat. Fields outside a composer stay cold. It cools after the
// streak gap, so the border stays hot exactly as long as the streak.
function typingHeat(field, wpm) {
  const composer = field.closest('.newconv-prompt');
  if (!composer) return;
  clearTimeout(typingCooling);
  if (composer !== typingHotComposer) typingCool();
  typingHotComposer = composer;
  const heat = Math.min(Math.max((wpm - 20) / 100, 0), 1);
  composer.style.setProperty('--typing-heat', String(Math.round(heat * 100) / 100));
  typingBeat(composer, heat > 0);
  typingCooling = setTimeout(typingCool, TYPING_STREAK_GAP_MS);
}

function typingFx(event) {
  if (!event.isTrusted || typingCalm?.matches || animationsOff()) return;
  const kind = typingKind(event.inputType, event.data);
  const field = kind && typingField(event);
  if (!field) return;
  const fieldRect = field.getBoundingClientRect();
  if (!fieldRect.width || !fieldRect.height) return;
  typingStreak = event.timeStamp - typingLastAt < TYPING_STREAK_GAP_MS ? typingStreak + 1 : 1;
  typingLastAt = event.timeStamp;
  if (typingStreak === 1) typingStreakStart = event.timeStamp;
  const minutes = (event.timeStamp - typingStreakStart) / 60000;
  const wpm = minutes > 0 ? Math.round((typingStreak - 1) / 5 / minutes) : 0;
  typingHeat(field, wpm);
  const typing = funModeTyping(paintedFunMode());
  if (!typing) return;
  const caret = typingCaret(field, fieldRect);
  const frame = typingFrame(field);
  typing({
    x: caret.x, y: caret.y, kind, data: event.data || '', streak: typingStreak, fieldRect,
    topEdge: typingTopEdge(fieldRect, frame),
    spawn: typingSpawner(typingPieceLayer(event), caret, fieldRect, frame),
  });
}

export function startTypingFx() {
  typingCalm = matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
  document.addEventListener('input', typingFx, { capture: true, passive: true });
}
