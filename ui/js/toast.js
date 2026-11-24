// Orc's notifications: compact cards stacked in the bottom-right corner, after
// Emil Kowalski's Sonner. The newest sits in front with older ones tucked
// behind it; hovering or focusing the stack fans it out. A toast closes from
// its close button, a swipe to the right, or its own timer, which waits while
// the stack is hovered, focused, or the page is hidden.

export const TOAST_MS = 10000;
const DURATION = { error: TOAST_MS, success: 6000, info: 6000, loading: Infinity };
const VISIBLE = 3;
const GAP = 8;
const PEEK = 10;
const EXIT_MS = 200;
const SWIPE_PX = 48;
const SWIPE_VELOCITY = 0.11;

const ICONS = {
  success: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.81a.75.75 0 0 0-1.22-.88l-3.24 4.48-1.6-1.6a.75.75 0 0 0-1.06 1.06l2.22 2.22a.75.75 0 0 0 1.14-.09l3.76-5.19Z" clip-rule="evenodd"/></svg>',
  error: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>',
  info: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.25v2.75a.75.75 0 0 0 1.5 0V9.75A.75.75 0 0 0 10 9H9Z" clip-rule="evenodd"/></svg>',
  loading: '<span class="toast-spinner" aria-hidden="true"></span>',
};
const CLOSE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7"/></svg>';

const toasts = [];
let region = null;

function regionEl() {
  const el = document.getElementById('toast-region');
  if (el && el !== region) {
    region = el;
    const fan = open => { el.toggleAttribute('data-expanded', open); layout(); pauseAll(open); };
    el.addEventListener('pointerenter', () => fan(true));
    el.addEventListener('pointerleave', () => { if (!el.contains(document.activeElement)) fan(false); });
    el.addEventListener('focusin', () => fan(true));
    el.addEventListener('focusout', event => { if (!el.contains(event.relatedTarget) && !el.matches(':hover')) fan(false); });
    document.addEventListener('visibilitychange', () => pauseAll(document.hidden || el.hasAttribute('data-expanded')));
  }
  return el;
}

// Same clear-then-set as core.js announce(): an error toast is its own alert,
// anything calmer is read out politely.
function speak(text) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

export function toast(title, options = {}) {
  const host = regionEl();
  const item = { title, options: {}, timer: 0, remaining: 0, started: 0, gone: false };
  const handle = {
    element: null,
    update(next) { if (!item.gone) render(item, typeof next === 'string' ? { title: next } : next); return handle; },
    dismiss() { remove(item); },
  };
  item.handle = handle;
  if (!host) return handle;
  const el = document.createElement('li');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon"></span>
    <div class="toast-body"><p class="toast-title"></p><p class="toast-description"></p><div class="toast-actions"></div></div>
    <button type="button" class="toast-close" aria-label="Dismiss">${CLOSE_ICON}</button>`;
  el.querySelector('.toast-close').addEventListener('click', () => remove(item));
  item.el = handle.element = el;
  swipeable(item);
  toasts.unshift(item);
  host.prepend(el);
  render(item, { title, ...options });
  requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.mounted = ''; layout(); }));
  layout();
  return handle;
}

// A failure reported after its own page has gone: work that was shown as done
// straight away and then turned out not to be.
export function showToast(message) {
  return toast(message, { tone: 'error' });
}

function render(item, next) {
  const before = item.options;
  item.options = { ...before, ...next };
  const { title, description = '', tone = 'info', actions = [] } = item.options;
  const el = item.el;
  el.dataset.tone = tone;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.querySelector('.toast-icon').innerHTML = ICONS[tone] || ICONS.info;
  el.querySelector('.toast-title').textContent = title;
  const desc = el.querySelector('.toast-description');
  desc.textContent = description;
  desc.hidden = !description;
  const row = el.querySelector('.toast-actions');
  row.replaceChildren(...actions.map(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.onClick?.(item.handle);
      if (action.dismiss !== false) remove(item);
    });
    return button;
  }));
  row.hidden = !actions.length;
  el.toggleAttribute('data-inline-action', !description && actions.length === 1);
  if (tone !== 'error' && (title !== before.title || tone !== before.tone)) speak(description ? `${title}. ${description}` : title);
  clearTimeout(item.timer);
  // A toast with a button stays long enough to reach for it.
  item.remaining = item.options.duration ?? (actions.length && tone !== 'loading' ? TOAST_MS : DURATION[tone] ?? DURATION.info);
  if (!region?.hasAttribute('data-expanded') && !document.hidden) startTimer(item);
  layout();
}

function startTimer(item) {
  if (item.gone || !Number.isFinite(item.remaining)) return;
  clearTimeout(item.timer);
  item.started = performance.now();
  item.timer = setTimeout(() => remove(item), item.remaining);
}

function pauseAll(paused) {
  for (const item of toasts) {
    if (paused) {
      if (item.started && Number.isFinite(item.remaining)) {
        clearTimeout(item.timer);
        item.remaining = Math.max(1000, item.remaining - (performance.now() - item.started));
        item.started = 0;
      }
    } else if (!item.started) startTimer(item);
  }
}

function remove(item, { swiped = false } = {}) {
  if (item.gone) return;
  item.gone = true;
  clearTimeout(item.timer);
  const index = toasts.indexOf(item);
  if (index >= 0) toasts.splice(index, 1);
  const { el } = item;
  if (!el) return;
  const hadFocus = el.contains(document.activeElement);
  el.dataset.removed = swiped ? 'swipe' : '';
  el.inert = true;
  layout();
  if (hadFocus) (region?.querySelector('.toast:not([data-removed]) .toast-close') || document.body).focus?.();
  setTimeout(() => { el.remove(); layout(); }, EXIT_MS);
  item.options.onDismiss?.();
}

// The front toast sets the collapsed height, so a taller one behind it never
// peeks out; fanned out, each toast sits above the ones newer than it.
function layout() {
  if (!region) return;
  const front = toasts[0]?.el;
  const frontHeight = front ? front.getBoundingClientRect().height || front.offsetHeight : 0;
  let offset = 0;
  toasts.forEach((item, index) => {
    const el = item.el;
    el.style.setProperty('--index', index);
    el.style.setProperty('--offset', `${offset}px`);
    el.style.setProperty('--front-height', `${frontHeight}px`);
    el.toggleAttribute('data-front', index === 0);
    el.toggleAttribute('data-hidden', index >= VISIBLE);
    el.style.zIndex = String(toasts.length - index);
    offset += (el.scrollHeight || 0) + GAP;
  });
  const expanded = region.hasAttribute('data-expanded');
  const visible = toasts.slice(0, VISIBLE);
  const height = !visible.length ? 0
    : expanded ? visible.reduce((sum, item) => sum + item.el.scrollHeight, 0) + GAP * (visible.length - 1)
      : frontHeight + PEEK * (visible.length - 1);
  region.style.height = `${height}px`;
}

function swipeable(item) {
  const el = item.el;
  let start = null;
  el.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, a, input')) return;
    start = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
    el.setPointerCapture(event.pointerId);
    el.dataset.swiping = '';
  });
  el.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    // Rightward follows the finger; leftward resists, since nothing is there.
    el.style.setProperty('--swipe', `${dx > 0 ? dx : dx / 6}px`);
  });
  const end = event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const velocity = Math.abs(dx) / Math.max(1, performance.now() - start.time);
    start = null;
    delete el.dataset.swiping;
    if (dx > SWIPE_PX || (dx > 0 && velocity > SWIPE_VELOCITY)) remove(item, { swiped: true });
    else el.style.setProperty('--swipe', '0px');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
