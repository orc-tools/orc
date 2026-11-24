// orc-ui: the crossing between linked laptops. Leaving shrinks this laptop's
// page into the laptop drawn on a fullscreen cover and navigates under it.
// The other laptop's page arrives already covered, painted by
// ui/laptop-cover.js, and dives into the drawn screen once it has settled.

import { $, announce, showToast } from './core.js';
import { reducedMotion } from './motion.js';

// TESTABLE: laptop switch
// Counted from the end of the page's own boot, which can take seconds alone.
const LAPTOP_ARRIVAL_CAP_MS = 8000;
const LAPTOP_ARRIVAL_QUIET_MS = 300;
// From the click, so a laptop that answers at once still shows its name.
const LAPTOP_COVER_MIN_MS = 900;
const DIVE_STEPS = 16;
// The share of the dive the page takes to fade up on the drawn screen.
const DIVE_LIT_BY = 0.15;
// Past this share the drawn laptop is a few blurred bars at the window's
// edge, so it dissolves into the cover's colour instead of lingering there.
const DIVE_DISSOLVE_FROM = 0.55;

export function laptopSwitchUrl(href, ticket) {
  const url = new URL(href);
  url.searchParams.set('orc-switch', JSON.stringify(ticket));
  return url.href;
}

// The cover grows until its drawn screen is the window, and the page, which
// starts the size of that screen, grows with it about the same point. The
// scale steps geometrically: a straight tween between the end scales would
// let the page slide off the screen it is meant to be showing on.
export function laptopDive(screen, windowSize) {
  const scaleX = windowSize.width / screen.width;
  const scaleY = windowSize.height / screen.height;
  const vanishing = (scale, centre, middle) => (scale > 1.001 ? (scale * centre - middle) / (scale - 1) : middle);
  const x = vanishing(scaleX, screen.left + screen.width / 2, windowSize.width / 2);
  const y = vanishing(scaleY, screen.top + screen.height / 2, windowSize.height / 2);
  const cover = [];
  const page = [];
  for (let step = 0; step <= DIVE_STEPS; step++) {
    const along = step / DIVE_STEPS;
    cover.push({
      transform: `scale(${scaleX ** along}, ${scaleY ** along})`,
      opacity: Math.min(1, (1 - along) / (1 - DIVE_DISSOLVE_FROM)),
    });
    page.push({
      transform: `scale(${scaleX ** (along - 1)}, ${scaleY ** (along - 1)})`,
      opacity: Math.min(1, along / DIVE_LIT_BY),
    });
  }
  const px = value => `${Math.round(value * 100) / 100}px`;
  return { origin: `${px(x)} ${px(y)}`, cover, page };
}

export function laptopArrivalSettled({ ready, fontsLoaded, imagesLoaded, inFlight, quietMs, coverMs, waitedMs }) {
  if (waitedMs >= LAPTOP_ARRIVAL_CAP_MS) return true;
  return ready && fontsLoaded && imagesLoaded && inFlight === 0
    && quietMs >= LAPTOP_ARRIVAL_QUIET_MS && coverMs >= LAPTOP_COVER_MIN_MS;
}

// A computed colour as the #rrggbb a ticket carries, or null for a form the
// arriving page could not check. Tokens mixed with color-mix() compute to
// color(srgb …) rather than rgb().
export function laptopLookColour(computed) {
  const mixed = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(computed);
  const plain = /^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(computed);
  const parts = mixed ? mixed.slice(1).map(part => Number(part) * 255) : plain?.slice(1).map(Number);
  if (!parts || parts.some(Number.isNaN)) return null;
  return `#${parts.map(part => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, '0')).join('')}`;
}
// END TESTABLE: laptop switch

const PULL_MS = 520;
const PULL_EASE = 'cubic-bezier(.45, 0, .15, 1)';
const LEAVE_SLOW_MS = 4000;
// A navigation can end without replacing this page, which would leave the
// cover up for good.
const LEAVE_GIVE_UP_MS = 15000;
const DIVE_MS = 780;
const DIVE_EASE = 'cubic-bezier(.65, 0, .2, 1)';
const POWER_ON_MS = 160;
const FADE_MS = 200;
const SETTLE_CHECK_MS = 50;

const pageRoot = document.documentElement;
const afterMs = ms => new Promise(resolve => setTimeout(resolve, ms));
const withoutMotion = () => document.hidden || typeof document.startViewTransition !== 'function'
  || reducedMotion();

function drawnScreen() {
  const screen = $('laptop-switch').querySelector('.laptop-switch-screen');
  const box = screen.getBoundingClientRect();
  return { left: box.left + screen.clientLeft, top: box.top + screen.clientTop, width: screen.clientWidth, height: screen.clientHeight };
}

// A ticket carries resolved colours, because a token on this laptop can be a
// color-mix() of tokens the other laptop's theme defines differently.
function coverLook() {
  const coverStyle = getComputedStyle($('laptop-switch'));
  const look = {
    bg: laptopLookColour(coverStyle.backgroundColor),
    text: laptopLookColour(coverStyle.color),
    muted: laptopLookColour(getComputedStyle($('laptop-switch-note')).color),
    accent: laptopLookColour(coverStyle.accentColor),
    font: coverStyle.fontFamily,
  };
  return Object.fromEntries(Object.entries(look).filter(([, value]) => value));
}

function playDive(dive, { backwards, duration, easing }) {
  const order = layerFrames => (backwards ? [...layerFrames].reverse() : layerFrames);
  const [coverLayer, pageLayer] = backwards ? ['new', 'old'] : ['old', 'new'];
  pageRoot.style.setProperty('--laptop-switch-origin', dive.origin);
  const timing = { duration, easing, fill: 'both' };
  pageRoot.animate(order(dive.cover), { ...timing, pseudoElement: `::view-transition-${coverLayer}(root)` });
  pageRoot.animate(order(dive.page), { ...timing, pseudoElement: `::view-transition-${pageLayer}(root)` });
}

async function transitionOver(transition, animateLayers) {
  try {
    await transition.ready;
    animateLayers();
  } catch {
    // A skipped transition has already swapped the page; nothing to animate.
  }
  await transition.finished.catch(() => {});
  pageRoot.style.removeProperty('--laptop-switch-origin');
}

let departure = null;

// `putBadgeBack` redraws the badge if the switch is called off.
export function leaveForLaptop({ name, asleep, href, putBadgeBack }) {
  if (departure || pageRoot.dataset.laptopSwitch) return;
  const cover = $('laptop-switch');
  // A switched window can run this script from a newer Orc than the laptop
  // that sent its page, and an older page has no cover to raise.
  if (!cover || !window.orcLaptopCover) {
    location.href = href;
    return;
  }
  const cancelButton = $('laptop-switch-cancel');
  const cameFrom = document.activeElement;
  const ticket = { to: name, asleep: !!asleep, at: Date.now() };
  const timers = [];
  const cancel = message => {
    if (!departure) return;
    const { transition } = departure;
    departure = null;
    timers.forEach(clearTimeout);
    cancelButton.removeEventListener('click', onCancel);
    window.stop();
    transition?.skipTransition();
    window.orcLaptopCover.clear();
    putBadgeBack?.();
    if (cameFrom?.isConnected) cameFrom.focus();
    if (message) showToast(message);
  };
  const onCancel = () => cancel();
  departure = { cancel };
  const look = coverLook();
  const raiseCover = () => {
    window.orcLaptopCover.paint(ticket, onCancel);
    cover.focus();
  };
  const waiting = () => { pageRoot.dataset.laptopSwitch = 'wait'; };
  const navigate = () => { location.href = laptopSwitchUrl(href, { ...ticket, look }); };
  cancelButton.addEventListener('click', onCancel);
  timers.push(setTimeout(() => cover.classList.add('is-slow'), LEAVE_SLOW_MS));
  timers.push(setTimeout(() => cancel(`Couldn’t open ${name}. Try again.`), LEAVE_GIVE_UP_MS));
  if (withoutMotion()) {
    raiseCover();
    waiting();
    navigate();
    return;
  }
  pageRoot.dataset.laptopSwitch = 'pull';
  departure.transition = document.startViewTransition(raiseCover);
  // This page stops drawing the moment the other laptop answers, so the
  // navigation waits for the pull-out rather than freezing it part way.
  transitionOver(departure.transition, () => playDive(laptopDive(drawnScreen(), { width: innerWidth, height: innerHeight }),
    { backwards: true, duration: PULL_MS, easing: PULL_EASE })).then(() => {
    if (!departure) return;
    waiting();
    navigate();
  });
}

// Back from the other laptop can restore this page as it was left, covered.
export function resetLaptopSwitch() {
  if (departure) departure.cancel();
}

function imagesOnScreenLoaded() {
  return [...document.images].every(image => image.complete || image.loading === 'lazy' || !image.getClientRects().length);
}

async function diveIn() {
  const cover = $('laptop-switch');
  if (withoutMotion()) {
    cover.classList.add('is-fading');
    await afterMs(FADE_MS);
    return;
  }
  cover.classList.add('is-ready');
  await afterMs(POWER_ON_MS);
  const dive = laptopDive(drawnScreen(), { width: innerWidth, height: innerHeight });
  pageRoot.dataset.laptopSwitch = 'dive';
  const transition = document.startViewTransition(() => { cover.hidden = true; });
  await transitionOver(transition, () => playDive(dive, { duration: DIVE_MS, easing: DIVE_EASE }));
}

// `ready` says whether the page's own first loads have landed. The rest is
// read off the page: nothing in flight, nothing still being added.
export async function arriveFromLaptop(ready) {
  // A page that started after its cover gave up has opened after all.
  const failed = $('laptop-switch-failed');
  if (failed) failed.hidden = true;
  const arrival = window.orcLaptopArrival;
  if (!arrival) return;
  clearTimeout(arrival.unattended);
  const booted = performance.now();
  const changes = new MutationObserver(() => { arrival.changedAt = performance.now(); });
  changes.observe(document.body, { childList: true, subtree: true, characterData: true });
  await new Promise(resolve => {
    const check = () => {
      const now = performance.now();
      const settled = !window.orcLaptopArrival || laptopArrivalSettled({
        ready: ready(), inFlight: arrival.inFlight, quietMs: now - arrival.changedAt,
        coverMs: Date.now() - arrival.at, waitedMs: now - booted,
        fontsLoaded: document.fonts.status === 'loaded', imagesLoaded: imagesOnScreenLoaded(),
      });
      if (settled) resolve();
      else setTimeout(check, SETTLE_CHECK_MS);
    };
    check();
  });
  changes.disconnect();
  if (!window.orcLaptopArrival) return;
  await diveIn();
  arrival.done();
  announce(`Showing ${arrival.to}`);
}
