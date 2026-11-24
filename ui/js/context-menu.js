// orc-ui: what Orc's right-click menus share: where one opens, its arrow
// keys, and what dismisses it.

// A keyboard-opened menu has no pointer position, so it opens under `anchor`.
export function placeContextMenu(menu, anchor, x, y) {
  menu.hidden = false;
  const box = menu.getBoundingClientRect();
  const under = anchor.getBoundingClientRect();
  const left = x || under.left + 16, top = y || under.bottom;
  menu.style.left = `${Math.max(4, Math.min(left, innerWidth - box.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(top, innerHeight - box.height - 4))}px`;
  menu.querySelector('[role^="menuitem"]').focus();
}

// `close({ refocus })` hides the menu. Escape asks it to hand focus back to
// whatever the menu opened from. A package's menu passes the `signal` it is
// disposed with, which takes the page-wide listeners down with it.
export function bindContextMenu(menu, close, { signal } = {}) {
  menu.addEventListener('keydown', event => {
    const choices = [...menu.querySelectorAll('[role^="menuitem"]')];
    const index = choices.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) choices[(index + step + choices.length) % choices.length].focus();
    else if (event.key === 'Home') choices[0].focus();
    else if (event.key === 'End') choices[choices.length - 1].focus();
    else if (event.key === 'Escape') close({ refocus: true });
    else if (event.key === 'Tab') close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target)) close();
  }, { capture: true, signal });
  window.addEventListener('blur', () => close(), { signal });
  window.addEventListener('resize', () => close(), { signal });
}
