// The send-offs: silent full-screen scenes played when a run merges or opens a
// pull request. Off by default in each browser (Settings → Appearance, under
// Reduce animations); when off, automatic triggers return an already-ended
// scene immediately. Reduce animations, or the system's reduced motion, holds
// them off whatever the switch says, even for previews. The theme's scene
// module draws the cast.
import { onReducedMotionChange, reducedMotion } from './motion.js';
import { themeAllowsCharacterMotion } from './character-motion.js';
import { claimScene, playingScene, releaseScene, restoreScroll, sceneLeft, staticClone, stillCopies } from './page-scene.js';
import { SCENES, seamOutline } from './scene-poses.js';
import { preloadScenes } from './theme-scenes.js';

export const SEND_OFFS_ENABLED_KEY = 'orcSendOffsEnabled';
const SEND_OFFS_CHANGED = 'orc-send-offs-changed';
const SUPPORTED = new Set(['yeet', 'pr']);
const ended = () => ({ shown: Promise.resolve(), finished: Promise.resolve(), cancel() {} });

let activeSendOff = null;

function readSendOffsEnabled() {
  try { return localStorage.getItem(SEND_OFFS_ENABLED_KEY) === '1'; }
  catch { return false; }
}

export const sendOffsEnabled = () => readSendOffsEnabled();

const canPlay = (theme, force) => themeAllowsCharacterMotion(theme)
  && !reducedMotion() && (force || sendOffsEnabled());
export const hasSendOffs = () => canPlay();

onReducedMotionChange(() => { if (reducedMotion()) activeSendOff?.cancel(); });
window.addEventListener('orc-theme-painted', () => {
  if (!themeAllowsCharacterMotion()) activeSendOff?.cancel();
});

export function onSendOffsChange(listener, { signal } = {}) {
  window.addEventListener(SEND_OFFS_CHANGED, listener, { signal });
}

export function setSendOffsEnabled(enabled) {
  const on = Boolean(enabled);
  const was = sendOffsEnabled();
  try {
    if (on) localStorage.setItem(SEND_OFFS_ENABLED_KEY, '1');
    else localStorage.removeItem(SEND_OFFS_ENABLED_KEY);
  } catch {}
  if (!on) activeSendOff?.cancel();
  if (on !== was) window.dispatchEvent(new Event(SEND_OFFS_CHANGED));
}

window.addEventListener('storage', event => {
  if (event.key !== SEND_OFFS_ENABLED_KEY) return;
  if (!sendOffsEnabled()) activeSendOff?.cancel();
  window.dispatchEvent(new Event(SEND_OFFS_CHANGED));
});

// Warms the theme's scenes before a button that plays one.
export function preloadSendOffs(theme, { force = false } = {}) {
  if (!canPlay(theme, force)) return Promise.resolve(null);
  return preloadScenes(theme).catch(() => null);
}

// Plays `name` (`yeet` for Merged, or `pr` for PR opened) silently over the
// page and returns `{shown, finished, cancel}`.
function send(name, { theme, word, title: customTitle, force = false } = {}) {
  if (!SUPPORTED.has(name)) return ended();
  if (document.hidden) {
    playingScene()?.cancel();
    return ended();
  }
  if (!canPlay(theme, force)) return ended();

  const spec = SCENES[name];
  let show, finish;
  const shown = new Promise(resolve => { show = resolve; });
  const finished = new Promise(resolve => { finish = resolve; });
  const listeners = new AbortController();
  let stage, layer, frame, endedFlag = false;
  const previousFocus = document.activeElement;
  let deadline = setTimeout(() => handle.cancel(), (spec.length + .85) * 1000);

  const handle = {
    shown,
    finished,
    cancel() {
      if (endedFlag) return;
      endedFlag = true;
      clearTimeout(deadline);
      cancelAnimationFrame(frame);
      listeners.abort();
      if (activeSendOff === handle) activeSendOff = null;
      releaseScene(finished);
      stage?.dispose();
      const restoreFocus = layer?.contains(document.activeElement);
      layer?.remove();
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
      show();
      finish();
    },
  };

  activeSendOff = handle;
  claimScene(handle);

  const options = { signal: listeners.signal };
  document.addEventListener('visibilitychange', () => { if (document.hidden) handle.cancel(); }, options);
  window.addEventListener('pagehide', () => handle.cancel(), options);
  window.addEventListener('hashchange', () => handle.cancel(), options);
  // Phone browsers change the viewport height as their toolbars slide in and
  // out. Only a width change moves the sidebar edge the scene is laid out from.
  const width = innerWidth;
  window.addEventListener('resize', () => { if (innerWidth !== width) handle.cancel(); }, options);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') handle.cancel(); }, options);

  const hash = location.hash;
  preloadScenes(theme).then(async module => {
    if (endedFlag || !module || document.hidden || location.hash !== hash) return handle.cancel();
    const left = sceneLeft();
    const selected = module.selected;
    const look = module.sceneLook(selected);
    layer = document.createElement('div');
    layer.className = 'orc-yeet-scene';
    layer.style.left = `${left}px`;
    layer.setAttribute('role', 'region');
    layer.setAttribute('aria-label', spec.label);
    if (selected) layer.dataset.theme = selected;
    for (const [key, value] of [['bg', look.background], ['ink', look.ink], ['glow', look.glow], ['flash', look.flash], ['flash-glow', look.flashGlow]]) {
      layer.style.setProperty(`--orc-scene-${key}`, value);
    }
    layer.innerHTML = `<style>
      .orc-yeet-scene { position:fixed; inset:0; z-index:2147483000; overflow:hidden; pointer-events:none;
        isolation:isolate; background:var(--orc-scene-bg); }
      ${stillCopies('.orc-yeet-scene *')}
      .orc-yeet-scene canvas { position:absolute; inset:0; width:100%; height:100%; z-index:3; pointer-events:none; }
      .orc-yeet-paper { position:absolute; inset:0; z-index:2; overflow:hidden; pointer-events:none;
        background:var(--bg,#191d20); transform-origin:50% 50%; will-change:transform,opacity; }
      .orc-yeet-copy { width:100%; height:100%; box-sizing:border-box; }
      .orc-yeet-word { position:absolute; z-index:4; top:9%; left:0; width:100%; text-align:center;
        color:var(--orc-scene-ink); font:900 clamp(52px,12vw,160px)/.9 ui-rounded,system-ui,sans-serif;
        letter-spacing:-.08em; word-spacing:.22em;
        text-shadow:var(--orc-scene-glow);
        pointer-events:none; opacity:0; }
      .orc-yeet-flash { position:absolute; z-index:4; top:0; bottom:0; left:50%; width:6px; margin-left:-3px;
        background:var(--orc-scene-flash); box-shadow:0 0 28px 10px var(--orc-scene-flash-glow); pointer-events:none; opacity:0; }
    </style><div class="orc-yeet-word" aria-hidden="true"></div><div class="orc-yeet-flash" aria-hidden="true"></div>`;
    const papers = [-1, 1].map(side => {
      const paper = document.createElement('div');
      paper.className = 'orc-yeet-paper';
      paper.inert = true;
      paper.setAttribute('aria-hidden', 'true');
      paper.style.clipPath = `polygon(${seamOutline(spec.seam, side).map(([x, y]) => `${x}% ${y}%`).join(',')})`;
      paper.append(copyPage(left));
      layer.append(paper);
      return paper;
    });
    layer.querySelector('.orc-yeet-word').textContent = word ?? look.words[spec.name];
    document.body.append(layer);
    show();
    restoreScroll(layer);
    const title = customTitle ?? (document.getElementById('title')?.firstChild?.textContent
      || document.querySelector('h1')?.textContent || 'This run');
    try {
      stage = module.createScene(spec.name, selected, layer, title);
      stage.canvas.addEventListener('webglcontextlost', () => handle.cancel(), options);
      await stage.ready;
      if (endedFlag) return;
      stage.render(0);
      const canvas = stage.canvas, wordEl = layer.querySelector('.orc-yeet-word'), flash = layer.querySelector('.orc-yeet-flash');
      const apply = pose => {
        papers.forEach((paper, index) => {
          const { x, y, rotate, scale, opacity } = pose.papers[index];
          paper.style.transform = `translate(${x}%,${y}%) rotate(${rotate}deg) scale(${scale})`;
          paper.style.opacity = String(opacity);
        });
        // A scene that hides itself behind the page needs no window cut for it.
        canvas.style.clipPath = pose.reveal && !stage.masksPage ? `inset(${pose.reveal[0]}% ${pose.reveal[1]}%)` : 'none';
        canvas.style.transform = pose.zoom === 1 ? '' : `scale(${pose.zoom})`;
        wordEl.style.opacity = String(pose.word.opacity);
        wordEl.style.transform = `rotate(${pose.word.rotate}deg) translateY(${pose.word.y}px) scale(${pose.word.scale})`;
        flash.style.opacity = String(pose.flash);
        layer.style.opacity = String(pose.layer);
      };
      let start;
      const gl = stage.canvas.getContext('webgl2');
      const drawing = [];
      const tick = now => {
        if (endedFlag) return;
        if (start === undefined) {
          start = now;
          clearTimeout(deadline);
          deadline = setTimeout(() => handle.cancel(), (spec.length + .85) * 1000);
        }
        const time = (now - start) / 1000;
        try {
          // With two frames still drawing, skip this one: a slow GPU drops
          // frames instead of queueing seconds of work that stall the page
          // when the scene is disposed.
          while (drawing.length && gl.getSyncParameter(drawing[0], gl.SYNC_STATUS) === gl.SIGNALED) {
            gl.deleteSync(drawing.shift());
          }
          if (drawing.length < 2) {
            stage.render(time);
            if (gl) {
              drawing.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
              gl.flush();
            }
          }
          apply(spec.pose(time));
          if (time >= spec.length) return handle.cancel();
          frame = requestAnimationFrame(tick);
        } catch { handle.cancel(); }
      };
      frame = requestAnimationFrame(tick);
    } catch { handle.cancel(); }
  }).catch(() => handle.cancel());
  return handle;
}

export function playYeet(options) { return send('yeet', options); }

export function playPrOpened(options) { return send('pr', options); }

// The gallery's cards: a scene mounted in `container` without the page, and
// one recorded frame by frame over screenshots.
export async function mountScene(name, container, title, theme) {
  if (!SUPPORTED.has(name)) throw new Error(`Unsupported send-off scene: ${name}`);
  const spec = SCENES[name];
  const module = await preloadScenes(theme);
  const selected = module.selected;
  const stage = module.createScene(spec.name, selected, container, title);
  try {
    await stage.ready;
  } catch (error) {
    stage.dispose();
    throw error;
  }
  return { ...stage, length: spec.length, lands: spec.lands, theme: selected };
}

export async function recordScene(name, options) {
  if (!SUPPORTED.has(name)) throw new Error(`Unsupported send-off scene: ${name}`);
  const recorder = await import('./send-off-record.js');
  return recorder.recordScene(name, options);
}

// cloneNode keeps no scroll offsets, and a cloned frame would load its page
// again. The copy keeps the window's layout and shifts left past the sidebar.
function copyPage(left) {
  const copy = document.createElement('div');
  copy.className = 'orc-yeet-copy';
  const page = getComputedStyle(document.body);
  if (left) {
    copy.style.width = `${innerWidth}px`;
    copy.style.marginLeft = `${-left}px`;
  }
  copy.style.display = page.display;
  copy.style.flexDirection = page.flexDirection;
  copy.style.padding = page.padding;
  copy.style.marginTop = `${-scrollY}px`;
  const view = { left, top: 0, right: innerWidth, bottom: innerHeight };
  for (const node of document.body.children) {
    if (node.matches('script, style, template, iframe, .orc-yeet-scene, .orc-settle-scene')) continue;
    copy.append(staticClone(node, view));
  }
  return copy;
}
