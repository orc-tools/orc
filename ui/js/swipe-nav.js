// Two-finger trackpad swipes go back and forward in Orc.app's history.
//
// WebKit draws this gesture itself, but only when the Mac's "Swipe between
// pages" trackpad setting is on. Orc.app sets window.orcSwipeFallback when
// that setting is off, and this module then reads the horizontal wheel
// events WebKit passes to the page instead. A browser tab never sets it, so
// the browser's own swipe is left alone.

// How far the fingers travel, in wheel pixels, before the swipe navigates.
export const SWIPE_DISTANCE = 140;
// A pause this long between wheel events ends one swipe, so the momentum
// that follows a navigation can't start a second one.
const SWIPE_GAP_MS = 220;

let swipe = null;
let indicator = null;

function fallbackOn() {
  return window.orcSwipeFallback === true;
}

// True when the element, or one it sits in, can still scroll sideways in the
// direction the wheel moves it, so the swipe belongs to that scroller.
function scrollerTakes(target, deltaX) {
  for (let el = target instanceof Element ? target : null; el && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const max = el.scrollWidth - el.clientWidth;
    if (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft < max - 1) return true;
  }
  return false;
}

function showIndicator(back, progress) {
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'swipe-nav-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    document.body.append(indicator);
  }
  indicator.dataset.side = back ? 'back' : 'forward';
  indicator.textContent = back ? '←' : '→';
  indicator.style.setProperty('--swipe-progress', String(Math.min(progress, 1)));
  indicator.classList.toggle('ready', progress >= 1);
  indicator.hidden = false;
}

function hideIndicator() {
  if (indicator) indicator.hidden = true;
}

function endSwipe() {
  swipe = null;
  hideIndicator();
}

export function handleSwipeWheel(event) {
  // Ctrl + wheel is a pinch zoom. Shift + wheel is a mouse scrolling sideways,
  // which macOS sends as horizontal wheel events just like a swipe.
  if (!fallbackOn() || event.ctrlKey || event.shiftKey || event.deltaMode !== 0) return;
  const now = event.timeStamp;
  if (swipe && now - swipe.last > SWIPE_GAP_MS) endSwipe();

  if (!swipe) {
    // Only a gesture that starts sideways is a swipe; one that starts as a
    // vertical scroll stays a scroll however it drifts.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.deltaX === 0) {
      swipe = { last: now, ignored: true };
      return;
    }
    swipe = { last: now, ignored: scrollerTakes(event.target, event.deltaX), travel: 0, done: false };
  }
  swipe.last = now;
  if (swipe.ignored || swipe.done) return;

  // With natural scrolling, fingers moving right scroll the page left, so
  // deltaX is negative. WebKit says which way the device is set.
  const natural = event.webkitDirectionInvertedFromDevice ?? true;
  swipe.travel += natural ? -event.deltaX : event.deltaX;
  // Fingers moving right go back, as they do in Safari.
  const back = swipe.travel > 0;
  const progress = Math.abs(swipe.travel) / SWIPE_DISTANCE;
  showIndicator(back, progress);
  if (progress < 1) return;

  swipe.done = true;
  hideIndicator();
  if (back) history.back();
  else history.forward();
}

window.addEventListener('wheel', handleSwipeWheel, { passive: true });
