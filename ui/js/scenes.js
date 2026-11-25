// orc-ui: the animations gallery (#gallery).

import { $, announce, dotHtml, esc, runs, runState, toast } from './core.js';
import { reducedMotion } from './motion.js';
import { themeAllowsCharacterMotion } from './character-motion.js';
import { playingScene } from './page-scene.js';
import { mountScene, playPrOpened, playYeet, recordScene } from './send-offs.js';
import { defaultTheme, pickableFunModes } from './fun-modes.js';
import { formatBytes, revealInFinder } from './finder.js';
// The full scenes tear the whole page, so the cards loop only the silent 3D
// stage and the play button runs the silent full-screen scene.
const GALLERY_DELIVERY_SCENES = [
  { scene: 'pr', tag: 'Open PR', title: 'PR opened', when: 'Plays when Orc opens a pull request for a finished run.', play: theme => playPrOpened({ theme, force: true }) },
  { scene: 'yeet', tag: 'Merged', title: 'Merged', when: 'Plays when a run is merged.', play: theme => playYeet({ theme, force: true }) },
];
const deliveryTheme = el => el.closest('[data-delivery-theme]')?.dataset.deliveryTheme || null;
const GALLERY_PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
// serve.py caps a GIF at 30 frames and an MP4 at 360.
const GALLERY_DELIVERY_FRAMES = 30;
// The send-off scenes run at display rate in the app, so their MP4 does too.
const GALLERY_DELIVERY_MP4_FPS = 60;
const GALLERY_GIF_WIDTH = 560;
// The GIF endpoint accepts 8 MiB of JSON, including the base64 frames.
const GALLERY_GIF_FRAME_BUDGET = 8 * 1024 * 1024 - 4096;
// Screenshots of the showcase world (docs/showcase/gallery-backdrops.js) that
// stand in for the page a send-off plays over: the page it tears or opens,
// then the page it fades back to.
const GALLERY_BACKDROPS = { yeet: ['pull-request', 'pull-request'], pr: ['pull-request', 'pull-request'] };
const GALLERY_DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>';
const GALLERY_EXPORTS = [
  ['gif', 'download', 'Download GIF'], ['gif', 'copy', 'Copy GIF'],
  ['mp4', 'download', 'Download MP4'], ['mp4', 'copy', 'Copy MP4'],
];
function galleryExportMenu(title) {
  const items = GALLERY_EXPORTS.map(([format, deliver, label], i) => `${i === 2 ? '<div class="gallery-export-sep" role="separator"></div>' : ''}<button type="button" role="menuitem" data-export-format="${format}" data-export-deliver="${deliver}">${label}</button>`).join('');
  return `<orc-menu class="gallery-scene-dl" size="compact" no-chevron data-gallery-title="${esc(title)}" trigger-label="Export ${esc(title)}" label="Export ${esc(title)}"><span slot="trigger">${GALLERY_DL_ICON}</span>${items}</orc-menu>`;
}
// The scene canvases are transparent — the card behind them paints the
// background. Sampled straight, a frame is sprite dots on nothing, which reads
// as a broken GIF once it lands on a white desktop, so find the colour the card
// is actually showing through and bake it in.
function galleryBackdrop(el) {
  for (let node = el; node instanceof Element; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/,\s*0\)$/.test(color)) return color;
  }
  return getComputedStyle(document.documentElement).backgroundColor || '#1a1b26';
}
function galleryGifFrame(canvas, backdrop, maxWidth) {
  const scale = Math.min(1, maxWidth / canvas.width);
  const flat = document.createElement('canvas');
  flat.width = Math.max(2, Math.round(canvas.width * scale / 2) * 2);
  flat.height = Math.max(2, Math.round(canvas.height * scale / 2) * 2);
  const ctx = flat.getContext('2d');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0, flat.width, flat.height);
  return flat.toDataURL('image/png');
}
async function exportGalleryScene(item, capture) {
  const menu = item.closest('.gallery-scene-dl');
  if (!menu || menu.hasAttribute('data-busy')) return;
  const title = menu.dataset.galleryTitle || 'gallery-scene';
  const { exportFormat: format, exportDeliver: deliver } = item.dataset;
  const kind = format.toUpperCase();
  menu.setAttribute('data-busy', '');
  menu.disabled = true;
  const note = toast(`Recording ${title}`, { tone: 'loading', description: kind });
  try {
    const shot = await capture(format, done => note.update({ description: `${kind} · ${Math.round(done * 100)}%` }));
    note.update({ title: `Encoding ${title}`, description: kind });
    const res = await fetch('/api/gallery-gif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, format, deliver, ...shot }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${kind} export failed`);
    const size = formatBytes(body.size);
    if (body.copied) {
      note.update({ tone: 'success', title: `Copied ${body.name}`, description: [size, 'ready to paste'].filter(Boolean).join(' · ') });
    } else if (body.path) {
      note.update({
        tone: 'success', title: `Saved ${body.name}`, description: [size, 'Downloads'].filter(Boolean).join(' · '),
        actions: [{ label: 'Show in Finder', onClick: () => revealInFinder(body.path) }],
      });
    } else {
      const a = document.createElement('a');
      a.href = body.url;
      a.download = body.name || `gallery-scene.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      note.update({ tone: 'success', title: `Exported ${body.name || title}`, description: [size, 'browser downloads'].filter(Boolean).join(' · ') });
    }
  } catch (err) {
    note.update({ tone: 'error', title: `Could not export ${title}`, description: err && err.message ? err.message : `${kind} export failed` });
  } finally {
    menu.removeAttribute('data-busy');
    menu.disabled = false;
  }
}
// One representative meta per run state, so dotHtml and runState render the
// exact sidebar treatment.
function galleryStatuses() {
  return [
    { meta: { status: 'running', phase: 'build' }, when: 'Orc is doing the work: a phase, a fork, a merge, or a queued merge.' },
    { meta: { status: 'awaiting-gate', phase: 'plan' }, when: 'Waiting on your answer: a gate, an escalation, or an agent question.' },
    { meta: { status: 'awaiting-gate', phase: 'ship', lifecycleVersion: 4 }, when: 'Finished and checked; merge it or open a PR.' },
    { meta: { status: 'merged', phase: 'done' }, when: 'Landed, answered, or otherwise finished.' },
    { meta: { status: 'cancelled', phase: 'build' }, when: 'Stopped before delivery.' },
  ];
}
let galleryBuilt = false;
function buildGallery() {
  if (galleryBuilt) return;
  galleryBuilt = true;
  $('gallery-statuses').innerHTML = galleryStatuses().map(s => `
    <div class="gallery-status-card">
      <div class="gallery-status-top">
        ${dotHtml(s.meta)}
        <span class="gallery-status-name">${esc(runState(s.meta).label)}</span>
      </div>
      <p class="gallery-status-when">${esc(s.when)}</p>
    </div>`).join('');
  // The palette's theme tier, in the same order and words. Its label names
  // every card, so each Play button and export menu has its own accessible
  // name and each export its own filename.
  $('gallery-delivery').innerHTML = pickableFunModes().filter(theme => themeAllowsCharacterMotion(theme.name)).map((theme, t) => `
    <div class="gallery-theme-group" role="group" aria-labelledby="gallery-delivery-${t}-h" data-delivery-theme="${esc(theme.name ?? '')}">
      <h4 id="gallery-delivery-${t}-h">${esc(theme.label)}</h4>
      <div class="gallery-scene-grid">${GALLERY_DELIVERY_SCENES.map(s => `
        <div class="gallery-scene-card">
          <div class="gallery-scene-stage gallery-delivery-stage" data-delivery-scene="${esc(s.scene)}">
            <span class="gallery-scene-tag">${esc(s.tag)}</span>
            ${galleryExportMenu(`${theme.label} ${s.title}`)}
          </div>
          <div class="gallery-scene-body gallery-delivery-body">
            <div>
              <p class="gallery-scene-title">${esc(s.title)}</p>
              <p class="gallery-scene-when">${esc(s.when)}</p>
            </div>
            <button type="button" class="gallery-scene-play" data-delivery-play="${esc(s.scene)}" aria-label="Play ${esc(theme.label)} ${esc(s.title)}">${GALLERY_PLAY_ICON}<span>Play</span></button>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');
  $('gallery-view').addEventListener('click', event => {
    const play = event.target.closest('[data-delivery-play]');
    if (play) {
      GALLERY_DELIVERY_SCENES.find(s => s.scene === play.dataset.deliveryPlay)?.play(deliveryTheme(play));
      return;
    }
    const item = event.target.closest('[data-export-format]');
    if (!item || !$('gallery-view').contains(item)) return;
    const stage = item.closest('.gallery-scene-stage');
    const delivery = galleryDeliveryScenes.find(s => s.host === stage);
    if (delivery) exportGalleryScene(item, delivery.capture);
  });
  $('gallery-close').addEventListener('click', closeGallery);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || $('gallery-view').hidden || playingScene()) return;
    event.preventDefault();
    closeGallery();
  });
}
// createStage sizes its renderer once, so a card that changes width gets a
// fresh stage. A scene's render(time) is a pure function of time, which lets a
// download step through the whole scene instead of sampling the live loop.
// Every theme's cards together hold more stages than Chrome keeps WebGL
// contexts live (about 16, losing the oldest), so a card holds one only while
// it is on or near screen.
let galleryDeliveryScenes = [];
function runDeliveryScene(host, theme) {
  let stage = null, frame = 0, generation = 0, start, width = 0, timer, near = false;
  const loop = now => {
    start ??= now;
    stage.render(((now - start) / 1000) % stage.length);
    frame = requestAnimationFrame(loop);
  };
  const unmount = () => {
    generation++;
    cancelAnimationFrame(frame);
    stage?.dispose();
    stage = null;
  };
  const mount = async () => {
    unmount();
    const mine = generation;
    width = host.clientWidth;
    if (!width || !near) return;
    const next = await mountScene(host.dataset.deliveryScene, host, 'Your run', theme).catch(() => null);
    if (!next) return;
    if (mine !== generation) return next.dispose();
    stage = next;
    frame = requestAnimationFrame(loop);
  };
  const observer = new ResizeObserver(() => {
    if (host.clientWidth === width) return;
    clearTimeout(timer);
    timer = setTimeout(mount, 150);
  });
  const onScreen = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting === near) return;
    near = entry.isIntersecting;
    clearTimeout(timer);
    if (near) mount();
    else unmount();
  }, { root: $('gallery-view'), rootMargin: '300px 0px' });
  observer.observe(host);
  onScreen.observe(host);
  return {
    host,
    stop() { clearTimeout(timer); observer.disconnect(); onScreen.disconnect(); unmount(); },
    async capture(format = 'gif', onFrame) {
      const scene = stage;
      if (!scene) throw new Error('Scene is still loading');
      if (format === 'mp4') {
        const frames = await recordDeliveryScene(host.dataset.deliveryScene, scene.theme, onFrame);
        return { frames, fps: GALLERY_DELIVERY_MP4_FPS };
      }
      const backdrop = galleryBackdrop(host), step = scene.length / GALLERY_DELIVERY_FRAMES;
      let maxWidth = GALLERY_GIF_WIDTH;
      for (;;) {
        const frames = [];
        let bytes = 0;
        for (let i = 0; i < GALLERY_DELIVERY_FRAMES; i++) {
          if (scene !== stage) throw new Error('Scene changed while recording');
          // Read back before the compositor clears a WebGL frame.
          scene.render(i * step);
          const frame = galleryGifFrame(scene.canvas, backdrop, maxWidth);
          frames.push(frame);
          bytes += frame.length;
          await new Promise(resolve => setTimeout(resolve));
        }
        if (bytes <= GALLERY_GIF_FRAME_BUDGET) return { frames, delayCs: Math.round(step * 100) };
        // Detailed illustrations can exceed the upload limit on a Retina display.
        const scale = .9 * Math.sqrt(GALLERY_GIF_FRAME_BUDGET / bytes);
        maxWidth = Math.max(2, Math.floor(Math.min(maxWidth, scene.canvas.width) * scale));
      }
    },
  };
}
// The full-screen scene over the showcase pages, in the card's theme and the
// colour scheme this window is showing, so the clip looks like the app it
// came from.
async function recordDeliveryScene(name, theme, onFrame) {
  const response = await fetch('/gallery-backdrops/manifest.json');
  if (!response.ok) throw new Error('Gallery backdrops are missing');
  const manifest = await response.json();
  const probe = document.createElement('i');
  probe.style.color = 'light-dark(rgb(0, 0, 0), rgb(255, 255, 255))';
  document.body.append(probe);
  const mode = getComputedStyle(probe).color === 'rgb(255, 255, 255)' ? 'dark' : 'light';
  probe.remove();
  const [before, after] = await Promise.all(GALLERY_BACKDROPS[name].map(async view => {
    const image = new Image();
    image.src = `/gallery-backdrops/${view}-${theme ?? defaultTheme()}-${mode}.jpg`;
    try { await image.decode(); }
    catch {
      // Authored themes have scenes but no bundled showcase photograph.
      image.src = `/gallery-backdrops/${view}-${defaultTheme()}-${mode}.jpg`;
      await image.decode();
    }
    return image;
  }));
  // The stage shows the title of the run the scene lands on.
  const title = manifest.titles[GALLERY_BACKDROPS[name][1]];
  return recordScene(name, { before, after, left: manifest.left, title, mode, fps: GALLERY_DELIVERY_MP4_FPS, onFrame, theme });
}
function stopGalleryDeliveryScenes() {
  galleryDeliveryScenes.forEach(scene => scene.stop());
  galleryDeliveryScenes = [];
}
function startGalleryDeliveryScenes() {
  stopGalleryDeliveryScenes();
  // Reduce animations, or the system's reduced motion, holds send-offs off.
  const shown = !reducedMotion();
  $('gallery-delivery').closest('.gallery-section').hidden = !shown;
  if (!shown) return;
  galleryDeliveryScenes = [...document.querySelectorAll('#gallery-delivery [data-delivery-scene]')]
    .map(host => runDeliveryScene(host, deliveryTheme(host)));
}
let galleryCameFrom = null;
export function showGallery(cameFrom) {
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  $('empty').hidden = true; $('head').hidden = true;
  $('tabs').hidden = true; $('version-banner').hidden = true; $('content').hidden = true;
  $('settings-view').hidden = true; $('stats-view').hidden = true;
  $('new-view').hidden = true; $('changelog-view').hidden = true;
  if ($('bots-view')) $('bots-view').hidden = true;
  $('gallery-view').hidden = false;
  galleryCameFrom = cameFrom ?? null;
  buildGallery();
  startGalleryDeliveryScenes();
  const h = $('gallery-view').querySelector('.gallery-head h2');
  if (h) h.focus();
  announce('Animations reference');
}
export function hideGallery() { stopGalleryDeliveryScenes(); $('gallery-view').hidden = true; }
// Close goes back, so #gallery leaves no history trace; a
// deep-loaded #gallery falls through to the run list.
function closeGallery() {
  if (galleryCameFrom !== null) history.back();
  else if (runs.length) location.hash = encodeURIComponent(runs[0].id);
  else { location.hash = ''; $('empty').hidden = false; }
}
