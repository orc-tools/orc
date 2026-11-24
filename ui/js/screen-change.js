import { reducedMotion } from './motion.js';

// The screen change every page shares: the screen being left lifts, blurs and
// fades while the next comes forward. index.html's stylesheet draws it on the
// view transition this starts. One plays at a time.
let screenChange = null;

// Whether a screen change can play now. When it cannot, the caller swaps the
// screens at once.
export function canChangeScreen() {
  const root = document.documentElement;
  return !screenChange && typeof document.startViewTransition === 'function' && !document.hidden && !reducedMotion()
    && !root.classList.contains('orc-launching') && !root.dataset.laptopSwitch;
}

// Settles once the change now playing has swapped its screens; null when none
// is playing.
export const screenSwapped = () => screenChange?.updateCallbackDone ?? null;

// Plays the change to `destination` around `update`, which swaps the screens
// a frame later, once the one being left has been pictured. `from` is the
// point it started at, for themes that draw from it. Resolves when the motion
// ends.
export function changeScreen(destination, update, from = { x: innerWidth / 2, y: innerHeight / 2 }) {
  const root = document.documentElement;
  const reach = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  root.style.setProperty('--orc-view-x', `${Math.round(from.x)}px`);
  root.style.setProperty('--orc-view-y', `${Math.round(from.y)}px`);
  root.style.setProperty('--orc-view-r', `${Math.ceil(reach)}px`);
  root.dataset.viewTransition = destination;
  const transition = document.startViewTransition(update);
  screenChange = transition;
  // A skipped transition rejects ready; that is not an error worth reporting.
  transition.ready.catch(() => {});
  return transition.finished.catch(() => {}).then(() => {
    screenChange = null;
    delete root.dataset.viewTransition;
    for (const name of ['--orc-view-x', '--orc-view-y', '--orc-view-r']) root.style.removeProperty(name);
  });
}
