// What the cards pinned above the chat box share: the steps a run left for the
// user (manual-steps.js) and the checks its agent ran (run-checks.js). Each
// folds to one row, remembers per run how the reader left it, and travels
// between its open and folded places.
// The plan's answers tray folds at the same pace (ui/js/plan-notes.js).
export const CARD_FOLD_TIMING = { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' };
export const CARD_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

const cardPreferences = new Map();

// A drag that selects text still ends in a click, which a card leaves alone so
// the text can be copied.
export function selectingTextIn(node) {
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.containsNode(node, true));
}

// Clicking a card's header anywhere outside its buttons and links folds or opens it.
export function wireCardHead(head, toggle) {
  head.onclick = event => {
    if (!event.target.closest('button, a') && !selectingTextIn(head)) toggle.click();
  };
}

// `minimized` folds a card that still needs the reader; `shownWhenDone` opens
// one that has nothing left to say.
export function cardPreference(storageKey) {
  if (!cardPreferences.has(storageKey)) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    cardPreferences.set(storageKey, {
      minimized: saved?.minimized === true,
      shownWhenDone: saved?.shownWhenDone === true,
    });
  }
  return cardPreferences.get(storageKey);
}

export function flipCardPreference(storageKey, field) {
  const preference = cardPreference(storageKey);
  preference[field] = !preference[field];
  try { localStorage.setItem(storageKey, JSON.stringify(preference)); } catch {}
}

// What differs between an open card's header and its folded row, so the copy's
// header can ease from one to the other instead of keeping its open size and
// jumping when the real card returns.
const HEADER_STYLE = [
  ['', ['borderRadius']],
  ['.chat-card-head', ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'columnGap', 'borderBottomWidth']],
  ['.chat-card-head h2', ['fontSize']],
  ['.chat-card-dot', ['width', 'height', 'boxShadow']],
  ['.chat-card-fold svg', ['transform']],
];

const headerPart = (card, selector) => (selector ? card.querySelector(selector) : card);

function headerStyle(card) {
  return HEADER_STYLE.map(([selector, properties]) => {
    const node = headerPart(card, selector);
    const style = node && getComputedStyle(node);
    return style && Object.fromEntries(properties.map(property => [property, style[property]]));
  });
}

// The chat box is pinned to the bottom, so the folded row lands below where the
// card stood. A copy of the open card travels between the two places while the
// real one waits unseen, its header easing to the other state's size and
// places. `ghostClass` names the copy for its card's own rules.
export function animateCardFold(host, repaint, ghostClass, onAfterPaint) {
  const before = host.querySelector('.chat-card');
  const first = before.getBoundingClientRect();
  const wasOpen = !before.hasAttribute('data-folded');
  const from = headerStyle(before);
  repaint();
  onAfterPaint?.();
  const card = host.querySelector('.chat-card');
  if (!card?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const last = card.getBoundingClientRect();
  const to = headerStyle(card);
  const ghost = wasOpen ? before : card.cloneNode(true);
  const origin = host.getBoundingClientRect();
  const box = rect => ({
    left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
  });
  ghost.classList.add('chat-card-ghost', ghostClass);
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('aria-labelledby');
  ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  const body = [...ghost.querySelectorAll('.chat-card-body')];
  const open = wasOpen ? first : last;
  body.forEach(node => { node.style.width = `${open.width - 2}px`; });
  card.style.opacity = '0';
  host.append(ghost);
  const timing = { ...CARD_FOLD_TIMING, fill: 'both' };
  body.forEach(node => node.animate({ opacity: wasOpen ? [1, 0] : [0, 1] }, timing));
  HEADER_STYLE.forEach(([selector], index) => {
    const node = headerPart(ghost, selector);
    if (node && from[index] && to[index]) node.animate([from[index], to[index]], timing);
  });
  const settle = () => { ghost.remove(); card.style.opacity = ''; };
  ghost.animate([box(first), box(last)], timing).finished.then(settle, settle);
}
