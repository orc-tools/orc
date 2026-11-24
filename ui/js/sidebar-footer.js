// orc-ui: the sidebar's bottom row. Plugins add their buttons to it, and the
// ones that do not fit move into the More menu.

import { orcRegisterOverlayCloser } from './activity.js';
import { $ } from './core.js';

const footer = $('sidebar-footer');
const more = $('sidebar-more');

const isLink = item => item.matches('orc-icon-button[href]');

// Themes hang decoration off the row's edge, which scrollWidth counts, so
// the last button's own edge is what says whether the row fits.
function fits() {
  const shown = [...footer.children].filter(item => item.getClientRects().length);
  const edge = footer.getBoundingClientRect().right - parseFloat(getComputedStyle(footer).paddingRight);
  return !shown.length || shown.at(-1).getBoundingClientRect().right <= edge + 0.5;
}

const overflowed = () => [...footer.querySelectorAll(':scope > [data-overflowed]')];

function menuRow(item) {
  const href = item.getAttribute('href');
  const row = document.createElement(href ? 'a' : 'button');
  if (href) row.href = href;
  else {
    row.type = 'button';
    row.addEventListener('click', () => item.click());
  }
  row.setAttribute('role', 'menuitem');
  const icon = item.querySelector('svg')?.cloneNode(true);
  // A toggle's title says its state ("Stay awake: off"); its name alone does not.
  const label = document.createElement('span');
  label.textContent = item.getAttribute('label') || item.title || item.getAttribute('aria-label') || '';
  row.append(...[icon, label].filter(Boolean));
  return row;
}

// The trigger icon stays in place: a press that starts on a node which then
// leaves the document never becomes a click.
function fillMenu() {
  for (const row of more.querySelectorAll('[role="menuitem"]')) row.remove();
  more.append(...overflowed().map(menuRow));
}

// Settings stays put. Destinations leave from the end first; a toggle such as
// the Stay awake cup shows its state in the row, so it leaves last.
function layout() {
  const before = overflowed();
  const items = [...footer.children].filter(item => item !== more);
  for (const item of items) delete item.dataset.overflowed;
  more.hidden = true;
  if (!fits()) {
    more.hidden = false;
    const movable = items.slice(1).filter(item => item.getClientRects().length).reverse();
    for (const item of [...movable.filter(isLink), ...movable.filter(item => !isLink(item))]) {
      item.dataset.overflowed = '';
      if (fits()) break;
    }
  }
  // A theme change or a resize that moves nothing leaves an open menu alone.
  const after = overflowed();
  if (after.length === before.length && after.every((item, index) => item === before[index])) return;
  more.close('programmatic', false);
  fillMenu();
}

// The rows are rebuilt as the menu opens, so each carries its button's
// current icon and state.
for (const type of ['pointerdown', 'keydown']) {
  more.addEventListener(type, () => { if (!more.open) fillMenu(); }, true);
}
orcRegisterOverlayCloser('sidebar-more', () => more.close?.('programmatic', false));

new ResizeObserver(layout).observe(footer);
new MutationObserver(layout).observe(footer, { childList: true });
