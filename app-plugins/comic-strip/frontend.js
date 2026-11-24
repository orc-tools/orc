// Comic Strip mode. data-comic-strip on <html> repaints the shell from
// theme.css; this module adds the parts CSS cannot: the typing marks, and on
// the new-run screen the comic page itself. There the courier gets her own
// panel beside the composer, a dashed flight path runs from Start down to the
// foot of the page, and the foot is three slanted panels: the flight, its
// FWOOSH! and the catch. All of it is cut from courier.webp, the theme's one
// picture. Only the Start burst takes the pointer.
//
// Beside the promised hooks it hears two of the composer's own window events
// (ui/js/activity.js): orc-newconv-ready when the screen is built again, and
// orc-newconv-launch when Start or Enter sends a prompt.
// tests/e2e/comic-strip-page.js holds the page to both.

import { defineFunMode } from '/js/fun-modes.js';
import { reducedMotion } from '/js/motion.js';
import { DART_CREASES, DART_FOLDS, DART_INK } from './dart.js';

// The theme's one picture, beside this module.
const MODULE_URL = import.meta.url;
const art = () => new URL('./courier.webp', MODULE_URL).href;
const SVG = 'http://www.w3.org/2000/svg';
// Each panel's box inside courier.webp (1680 by 560), inside its inked rule.
const PANELS = {
  courier: '8 8 536 544',
  flight: '562 8 556 544',
  catch: '1136 8 536 544',
};
// The paper dart (dart.js) that also flies in the send-off scenes.
const xy = points => points.map(point => point.join(',')).join(' ');
const PLANE = `<g stroke='${DART_INK}' stroke-linejoin='round' stroke-linecap='round'>`
  + DART_FOLDS.map(fold => `<polygon points='${xy(fold.points)}' fill='${fold.fill}' stroke='none'/>`).join('')
  + DART_CREASES.map(crease => `<polyline points='${xy(crease)}' fill='none' stroke-width='.04' opacity='.55'/>`).join('')
  + DART_FOLDS.map(fold => `<polygon points='${xy(fold.points)}' fill='none' stroke-width='.06'/>`).join('')
  + '</g>';
const BURST = '62,4.2 72.1,15.6 86,12.7 91.8,20.4 106.6,22.2 99.2,32.9 122.4,37.3 100,45 115.1,54.9 98.1,58 95.8,66.5 '
  + '82.5,67.1 75.5,77.2 62,66.7 47.4,80 43.6,64.5 25.8,68.2 25.1,58.4 14,53.7 19.7,45.3 3.9,37.5 26.7,33.4 12.6,20.1 '
  + '34.7,22.2 37.6,12.1 51.2,13.8';
// Under this pane width the courier and her balloon fold into a strip above
// the composer.
const FOLD_WIDTH = 900;
// The gap the foot keeps above the window's bottom edge (.comic-strip-foot's
// bottom margin), clear of the handout in the corner.
const FOOT_MARGIN = 34;

const clamp = (low, value, high) => Math.min(high, Math.max(low, value));
const pts = points => points.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');

function svg(className, viewBox, inner) {
  const node = document.createElementNS(SVG, 'svg');
  node.setAttribute('class', className);
  if (viewBox) node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = inner;
  return node;
}

// The art cut to one panel: a nested viewport whose viewBox is the panel's
// box in courier.webp, scaled to cover the space it is given.
function cut(panel, x, width, height) {
  return `<svg x="${x.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}"`
    + ` viewBox="${PANELS[panel]}" preserveAspectRatio="xMaxYMid slice">`
    + `<image href="${art()}" width="1680" height="560"/></svg>`;
}

// The foot of the page: three slanted panels as wide as the page.
function tierMarkup(w, h) {
  const slant = 46 * h / 360;
  const half = slant / 2;
  const gap = 16;
  const a = w * .341;
  const b = w * .68;
  const flight = [[0, 0], [a + half, 0], [a - half, h], [0, h]];
  const sound = [[a + half + gap, 0], [b + half, 0], [b - half, h], [a - half + gap, h]];
  const landing = [[b + half + gap, 0], [w, 0], [w, h], [b - half + gap, h]];
  const k = h / 360;
  const room = b - a - gap - slant;
  const letters = 'FWOOSH!';
  const steps = [...letters].map((_, i) => .72 + i * .07);
  const tall = k > .7;
  const tilt = tall ? 15 : 5;
  const big = Math.min(room * (tall ? 1.08 : .92) / (steps.reduce((sum, step) => sum + step, 0) * .7), h * .5);
  const fx = a + gap - 60;
  const fy = h * .7;
  let rays = '';
  for (let i = 0; i < 17; i += 1) {
    const from = (-50 + i * 6.2) * Math.PI / 180;
    const to = from + 3 * Math.PI / 180;
    const far = Math.max(1100, w);
    rays += `<polygon points="${pts([[fx, fy], [fx + Math.cos(from) * far, fy + Math.sin(from) * far], [fx + Math.cos(to) * far, fy + Math.sin(to) * far]])}"/>`;
  }
  const streak = (x, y, length) => `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${length.toFixed(1)} ${(-length * .2).toFixed(1)}"/>`;
  let lines = '';
  for (let i = 0; i < 8; i += 1) {
    const y = h * (.12 + i * .05) + (i * 37 % 9) * k;
    lines += streak(a + gap + slant * (1 - y / h) + 18 + (i * 53 % 120) * room / 360, y, (70 + (i * 71 % 170)) * room / 360);
  }
  if (tall) {
    for (let i = 0; i < 3; i += 1) {
      lines += streak(a + gap + (120 + (i * 67 % 110)) * room / 360, h * (.87 + i * .05), (80 + (i * 59 % 120)) * room / 360);
    }
  }
  const spans = [...letters].map((ch, i) => `<tspan font-size="${(big * steps[i]).toFixed(1)}">${ch}</tspan>`).join('');
  const [tx, ty] = tall ? [a + gap + 4, h * .86] : [a + gap + 22, h * .8];
  const drop = Math.max(3, 6 * k);
  const place = (x, y) => `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(-${tilt}) skewX(-11)`;
  const ground = `x="${(a - 40).toFixed(1)}" width="${(b - a + 100).toFixed(1)}" height="${h}"`;
  return `
  <defs>
    <clipPath id="comic-strip-cut-flight"><polygon points="${pts(flight)}"/></clipPath>
    <clipPath id="comic-strip-cut-sound"><polygon points="${pts(sound)}"/></clipPath>
    <clipPath id="comic-strip-cut-catch"><polygon points="${pts(landing)}"/></clipPath>
    <pattern id="comic-strip-tone" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <circle cx="4.5" cy="4.5" r="2.1"/>
    </pattern>
    <linearGradient id="comic-strip-tone-fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="comic-strip-tone-mask"><rect width="${w}" height="${h}" fill="url(#comic-strip-tone-fade)"/></mask>
  </defs>
  <g class="comic-strip-tier-shadow" transform="translate(6 7)">
    <polygon points="${pts(flight)}"/><polygon points="${pts(sound)}"/><polygon points="${pts(landing)}"/>
  </g>
  <g clip-path="url(#comic-strip-cut-flight)">${cut('flight', 0, a + half, h)}</g>
  <g clip-path="url(#comic-strip-cut-sound)">
    <rect class="comic-strip-sfx-ground" ${ground}/>
    <g class="comic-strip-sfx-rays">${rays}</g>
    <rect class="comic-strip-sfx-dots" ${ground} fill="url(#comic-strip-tone)" mask="url(#comic-strip-tone-mask)"/>
    <g class="comic-strip-sfx-lines">${lines}</g>
  </g>
  <g clip-path="url(#comic-strip-cut-catch)">${cut('catch', b - half + gap, w - (b - half + gap), h)}</g>
  <g class="comic-strip-tier-edge"><polygon points="${pts(flight)}"/><polygon points="${pts(sound)}"/><polygon points="${pts(landing)}"/></g>
  <g class="comic-strip-sfx-letters" style="--comic-strip-sfx-stroke:${Math.max(5, 9 * k).toFixed(1)}px">
    <text transform="${place(tx + drop, ty + drop * 1.2)}" class="comic-strip-sfx-shadow">${spans}</text>
    <text transform="${place(tx, ty)}" class="comic-strip-sfx-word">${spans}</text>
  </g>`;
}

// The dashed path from Start to the flight panel: one sweep down the page
// with a loop the loop halfway. start and end are where it leaves Start and
// where it meets the panel's top; the two pulls bend it out to the right
// and in from the left.
function flightPath(start, startPull, endPull, end) {
  const radius = 36;
  const span = .036;
  const low = .5 - span / 2;
  const base = u => {
    const a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, c = 3 * u * u * (1 - u), d = u ** 3;
    return [a * start[0] + b * startPull[0] + c * endPull[0] + d * end[0], a * start[1] + b * startPull[1] + c * endPull[1] + d * end[1]];
  };
  const stops = new Set();
  for (let i = 0; i <= 160; i += 1) stops.add(i / 160);
  for (let i = 0; i <= 90; i += 1) stops.add(low + span * i / 90);
  const out = [];
  for (const u of [...stops].sort((p, q) => p - q)) {
    let [x, y] = base(u);
    const [x2, y2] = base(Math.min(1, u + .001));
    const [x1, y1] = base(Math.max(0, u - .001));
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = (x2 - x1) / length, dy = (y2 - y1) / length;
    // The normal that points up the page.
    const [nx, ny] = -dx < 0 ? [dy, -dx] : [-dy, dx];
    const turn = clamp(0, (u - low) / span, 1) * Math.PI * 2;
    x += radius * (Math.sin(turn) * dx + (1 - Math.cos(turn)) * nx);
    y += radius * (Math.sin(turn) * dy + (1 - Math.cos(turn)) * ny);
    out.push(x.toFixed(1) + ' ' + y.toFixed(1));
  }
  return 'M ' + out.join(' L ');
}

function comicPage(view) {
  const startbar = view.querySelector('.nc-startbar');
  const scroll = view.querySelector('.nc-scroll');
  const title = view.querySelector('.nc-title');
  const composer = startbar?.querySelector('.newconv-prompt');
  if (!startbar || !scroll || !title || !composer) return null;
  const controller = new AbortController();

  const courier = document.createElement('div');
  courier.className = 'comic-strip-courier';
  courier.setAttribute('aria-hidden', 'true');
  const portrait = svg('comic-strip-courier-art', PANELS.courier, `<image href="${art()}" width="1680" height="560"/>`);
  portrait.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  courier.append(portrait);
  startbar.prepend(courier);

  // The heading's tail. Its seam paints over the balloon's rule where the
  // two meet, so they read as one line.
  const tail = svg('comic-strip-tail', '-20 -4 110 50',
    '<path class="comic-strip-tail-shadow" d="M 44 0 Q 30 25 -14 39 Q 46 35 84 0" transform="translate(5 6)"/>'
    + '<path class="comic-strip-tail-fill" d="M 44 0 Q 30 25 -14 39 Q 46 35 84 0"/>'
    + '<path class="comic-strip-tail-seam" d="M 46.5 -1.5 L 81.5 -1.5"/>');
  title.append(tail);

  const burst = svg('comic-strip-burst', '0 0 124 84',
    `<polygon class="comic-strip-burst-shadow" points="${BURST}" transform="translate(3 4)"/>`
    + `<polygon class="comic-strip-burst-face" points="${BURST}"/>`);
  composer.append(burst);
  const start = composer.querySelector('#nc-send');
  // Let an edge tap become a click before the drawer can claim it as a swipe.
  burst.addEventListener('touchstart', event => event.stopPropagation(),
    { passive: true, signal: controller.signal });
  burst.addEventListener('click', event => {
    if (!start || start.hidden || start.hasAttribute('disabled')) return;
    event.stopPropagation();
    start.dispatchEvent(new MouseEvent('click', event));
  }, { signal: controller.signal });

  const foot = document.createElement('div');
  foot.className = 'comic-strip-foot';
  foot.setAttribute('aria-hidden', 'true');
  const trail = document.createElement('div');
  trail.className = 'comic-strip-trail';
  const line = svg('comic-strip-trail-line', null, '<path/>');
  line.setAttribute('preserveAspectRatio', 'none');
  const glider = document.createElement('span');
  glider.className = 'comic-strip-glider';
  glider.append(svg('comic-strip-plane', '-30 -22 60 44', `<g transform="scale(26)">${PLANE}</g>`));
  trail.append(line, glider);
  const tier = svg('comic-strip-tier', null, '');
  foot.append(trail, tier);
  scroll.append(foot);
  view.setAttribute('data-comic-strip-page', '');

  let drawn = '';
  let frame = 0;
  function layout() {
    frame = 0;
    const width = view.clientWidth;
    const height = view.clientHeight;
    if (!width || !height) return;
    const fold = width < FOLD_WIDTH;
    view.toggleAttribute('data-comic-strip-fold', fold);
    const notes = Boolean(view.querySelector('.nc-note'));
    const pane = scroll.getBoundingClientRect();
    const paneStyle = getComputedStyle(scroll);
    const w = Math.round(scroll.clientWidth - parseFloat(paneStyle.paddingLeft) - parseFloat(paneStyle.paddingRight));
    // An empty board's page fits the window: the foot takes only the room the
    // start bar and the board leave, so it never runs on under the handout in
    // the window's corner, and with too little room it is put away. Notes
    // already make the page scroll, so under them the strip shrinks towards
    // its least and stays, ending clear of the handout at the scroll's foot.
    // While the Evals candidates take the board's place, it is put away.
    const board = scroll.querySelector('.nc-notes');
    const boardStyle = board && getComputedStyle(board);
    const boardRoom = board
      ? (parseFloat(boardStyle.minHeight) || 0) + parseFloat(boardStyle.marginTop) + parseFloat(boardStyle.marginBottom)
      : 0;
    const used = startbar.parentElement.getBoundingClientRect().bottom - pane.top + scroll.scrollTop
      + boardRoom + parseFloat(paneStyle.paddingBottom) + FOOT_MARGIN + 8;
    const room = scroll.clientHeight - used;
    const h = Math.round(notes
      ? clamp(96, Math.min(height * .15, room), 150)
      : Math.min(clamp(fold ? 110 : 150, Math.min(height * .36, w * .36), 360), room));
    const shown = !view.hasAttribute('data-evals') && (notes || h >= 110);
    // Only a change is written: the observer below hears every write.
    if (foot.hidden === shown) foot.hidden = !shown;
    foot.style.setProperty('--comic-strip-tier-h', h + 'px');
    if (shown && w + 'x' + h !== drawn) {
      drawn = w + 'x' + h;
      tier.setAttribute('viewBox', `0 0 ${w} ${h}`);
      tier.innerHTML = tierMarkup(w, h);
    }
    // The path leaves from under Start and lands on the flight panel's top.
    // It is put away while notes hold the board, while anything stands under
    // the start bar (the verification card, Evals), or with too little room.
    const box = foot.getBoundingClientRect();
    const send = composer.getBoundingClientRect();
    const below = startbar.parentElement.getBoundingClientRect().bottom - startbar.getBoundingClientRect().bottom;
    const drop = box.top - (send.bottom + 14);
    const open = shown && !notes && below < 24 && drop > 150 && w > 0;
    view.toggleAttribute('data-comic-strip-flight', open);
    if (!open) return;
    const lift = 44;
    const right = send.right - box.left;
    const tall = drop + lift;
    const path = flightPath([right - 34, lift], [right - 8, tall], [w * .243, lift + 74], [w * .119, tall]);
    trail.style.setProperty('--comic-strip-trail-h', tall + 'px');
    line.setAttribute('viewBox', `0 0 ${w} ${tall}`);
    line.firstElementChild.setAttribute('d', path);
    glider.style.offsetPath = `path("${path}")`;
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
  const resized = new ResizeObserver(schedule);
  for (const node of [view, startbar, composer, foot]) resized.observe(node);
  // Notes come and go and the verification card shows and hides; both change
  // what the foot and the path have room for.
  const changed = new MutationObserver(schedule);
  changed.observe(scroll, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  changed.observe(view, { attributes: true, attributeFilter: ['data-evals'] });
  layout();

  let activeFlight;
  window.addEventListener('orc-newconv-launch', event => {
    if (!view.hasAttribute('data-comic-strip-flight') || reducedMotion()) return;
    glider.classList.remove('comic-strip-thrown');
    void glider.offsetWidth;
    glider.classList.add('comic-strip-thrown');
    const flight = glider.getAnimations().find(animation => animation.animationName === 'comic-strip-throw');
    if (!flight) {
      glider.classList.remove('comic-strip-thrown');
      return;
    }
    activeFlight = flight;
    const clearFlight = () => {
      if (activeFlight !== flight) return;
      activeFlight = null;
      glider.classList.remove('comic-strip-thrown');
    };
    flight.finished.then(clearFlight, clearFlight);
    event.detail?.waitUntil?.(flight.finished);
  }, { signal: controller.signal });

  return {
    view,
    dispose() {
      controller.abort();
      resized.disconnect();
      changed.disconnect();
      cancelAnimationFrame(frame);
      for (const node of [courier, tail, burst, foot]) node.remove();
      for (const name of ['data-comic-strip-page', 'data-comic-strip-fold', 'data-comic-strip-flight']) view.removeAttribute(name);
    },
  };
}

let page = null;
let rebuilt = null;

// buildNewConversation rewrites the view, so the page is drawn again each time.
function drawPage() {
  page?.dispose();
  const view = document.getElementById('new-view');
  page = view ? comicPage(view) : null;
}

function comicStripPaint(on) {
  if (on && !rebuilt) {
    rebuilt = drawPage;
    window.addEventListener('orc-newconv-ready', rebuilt);
    drawPage();
  } else if (!on && rebuilt) {
    window.removeEventListener('orc-newconv-ready', rebuilt);
    rebuilt = null;
    page?.dispose();
    page = null;
  }
}

function comicStripTyping({ kind, streak, fieldRect, spawn }) {
  if (kind === 'paste') {
    spawn('comic-strip-typed-caption', 'POW!');
    return;
  }
  if (kind === 'char' && streak % 16 === 0) {
    const corner = fieldRect.right - Math.min(28, fieldRect.width / 2);
    spawn('comic-strip-typed-caption', 'ZIP!', { '--x': corner + 'px' });
    return;
  }
  spawn('comic-strip-typed-mark comic-strip-typed-' + kind, '', {
    '--comic-strip-drift': streak % 2 ? '8px' : '-8px',
  });
}

export const { activate } = defineFunMode({ id: 'comic-strip', typing: comicStripTyping, onPaint: comicStripPaint });
