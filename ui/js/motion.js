// Settings → Visuals → Motion & visuals. data-animations-off on <html> is
// the whole switch: shell-base.css stills every CSS animation and
// transition from it. Scripted effects that follow both preferences use
// reducedMotion(). The choice is this
// browser's, like the system setting it stands beside; index.html's pre-paint
// script restores the attribute before first paint. A browser that has not
// chosen starts from the installer's Animations answer, ORC_HOST_ANIMATIONS_OFF,
// so turning them back on under that answer saves '0' rather than nothing.

export const ANIMATIONS_OFF_KEY = 'orcAnimationsOff';
export const FACTORY_VISUALS_OFF_KEY = 'orcFactoryVisualsOff';
const MOTION_CHANGED = 'orc-motion-changed';
const FACTORY_VISUALS_CHANGED = 'orc-factory-visuals-changed';

const systemReduced = matchMedia('(prefers-reduced-motion: reduce)');
const hostAnimationsOff = () => window.ORC_HOST_ANIMATIONS_OFF === true;

export const animationsOff = () => document.documentElement.hasAttribute('data-animations-off');

// A page without index.html's pre-paint script, such as the Ship page opened on
// its own, still follows this browser's choice.
try {
  if (!animationsOff() && localStorage.getItem(ANIMATIONS_OFF_KEY) === '1') document.documentElement.setAttribute('data-animations-off', '');
} catch {}

export const systemReducedMotion = () => systemReduced.matches;

export const reducedMotion = () => animationsOff() || systemReducedMotion();

export function onReducedMotionChange(listener, { signal } = {}) {
  systemReduced.addEventListener('change', listener, { signal });
  window.addEventListener(MOTION_CHANGED, listener, { signal });
}

function paintAnimationsOff(off) {
  if (off === animationsOff()) return;
  document.documentElement.toggleAttribute('data-animations-off', off);
  window.dispatchEvent(new Event(MOTION_CHANGED));
}

export function setAnimationsOff(off) {
  try {
    if (off) localStorage.setItem(ANIMATIONS_OFF_KEY, '1');
    else if (hostAnimationsOff()) localStorage.setItem(ANIMATIONS_OFF_KEY, '0');
    else localStorage.removeItem(ANIMATIONS_OFF_KEY);
  } catch {}
  paintAnimationsOff(off);
}

export function factoryVisualsEnabled() {
  try { return localStorage.getItem(FACTORY_VISUALS_OFF_KEY) !== '1'; }
  catch { return true; }
}

export function onFactoryVisualsChange(listener, { signal } = {}) {
  window.addEventListener(FACTORY_VISUALS_CHANGED, listener, { signal });
}

export function setFactoryVisualsEnabled(enabled) {
  const on = Boolean(enabled);
  const was = factoryVisualsEnabled();
  try {
    if (on) localStorage.removeItem(FACTORY_VISUALS_OFF_KEY);
    else localStorage.setItem(FACTORY_VISUALS_OFF_KEY, '1');
  } catch {}
  if (on !== was) window.dispatchEvent(new Event(FACTORY_VISUALS_CHANGED));
}

window.addEventListener('storage', event => {
  if (event.key === ANIMATIONS_OFF_KEY) paintAnimationsOff(event.newValue === '1' || (event.newValue === null && hostAnimationsOff()));
  if (event.key === FACTORY_VISUALS_OFF_KEY || event.key === null) window.dispatchEvent(new Event(FACTORY_VISUALS_CHANGED));
});
