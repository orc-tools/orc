import { $, esc, fileUrl } from './core.js';
import { diffFiles, isClip, mediaKind, runFolderClips } from './chat-timeline.js';
import { clipPlayback, onClipChange, onClipTime, playClips, seekClip, setClipsPaused, stopClips } from './clip-player.js';

// serve.py's media route: one changed file, with Range so a player can seek.
// With `blob` it is the version git holds under that id, not the checkout's.
export const mediaUrl = (runId, path, blob) => `/api/runs/${encodeURIComponent(runId)}/media?path=${encodeURIComponent(path)}${blob ? `&blob=${blob}` : ''}`;
// A removed asset is gone from the checkout, so it plays from git. One the
// run saved in its own folder is a run file, served beside its other files;
// a plan's mockup is a file in the plan run's folder.
const assetUrl = (runId, asset) => (asset.planRun ? fileUrl(asset.planRun, asset.path)
  : asset.runFolder ? fileUrl(runId, asset.path)
  : mediaUrl(runId, asset.path, asset.removed ? asset.blob : null));
export const clipUrl = (runId, path, runFolder) => assetUrl(runId, { path, runFolder });

// A run's diff.patch per file, fetched once per patch size by the chat's
// card. The Assets tab reads what the card fetched and redraws when it lands.
const runPatches = new Map(); // runId -> { key, files }
const runPatchListeners = new Set();
const patchKey = run => {
  const patch = (run?.files || []).find(file => file.path === 'diff.patch');
  return patch ? `${run.id}:${patch.size}` : null;
};

export function onRunDiffFiles(fn) {
  runPatchListeners.add(fn);
}

export function runDiffFiles(run) {
  const key = patchKey(run);
  const known = runPatches.get(run?.id);
  if (known?.key === key) return known.files;
  if (!run) return null;
  const entry = { key, files: null };
  runPatches.set(run.id, entry);
  if (!key) return null;
  fetch(fileUrl(run.id, 'diff.patch')).then(r => (r.ok ? r.text() : null)).catch(() => null).then(text => {
    if (runPatches.get(run.id) !== entry || text === null) return;
    entry.files = diffFiles(text);
    runPatchListeners.forEach(fn => fn(run.id));
  });
  return null;
}

// What each mockup in shots/mockup/ was built into: shots/manifest.json's
// `mockup` -> `after`, fetched once per manifest size like the patch.
const runShotPairs = new Map(); // runId -> { key, pairs }
const manifestKey = run => {
  const manifest = (run?.files || []).find(file => file.path === 'shots/manifest.json');
  return manifest ? `${run.id}:${manifest.size}` : null;
};

function mockupPairs(run) {
  const key = manifestKey(run);
  const known = runShotPairs.get(run.id);
  if (known?.key === key) return known.pairs;
  const entry = { key, pairs: new Map() };
  runShotPairs.set(run.id, entry);
  if (!key) return entry.pairs;
  fetch(fileUrl(run.id, 'shots/manifest.json')).then(r => (r.ok ? r.json() : null)).catch(() => null).then(json => {
    const shots = Array.isArray(json) ? json : json?.shots;
    if (runShotPairs.get(run.id) !== entry || !Array.isArray(shots)) return;
    for (const shot of shots) {
      if (typeof shot?.mockup === 'string' && typeof shot.after === 'string') {
        entry.pairs.set(`shots/${shot.mockup}`, { path: `shots/${shot.after}`, flow: shot.flow || '' });
      }
    }
    if (entry.pairs.size) runPatchListeners.forEach(fn => fn(run.id));
  });
  return entry.pairs;
}

const stem = path => path.split('/').pop().replace(/\.[^.]+$/, '');

// The mockups a run was built to match: the pictures it copied into
// shots/mockup/, each beside the screen it built when the manifest pairs them,
// then any of its plan's mockups it has no copy of. A copy keeps its plan
// mockup's page.
const runMockups = run => {
  const own = (run?.files || [])
    .filter(file => file.path.startsWith('shots/mockup/') && mediaKind(file.path) === 'image')
    .map(file => ({ path: file.path, media: 'image', runFolder: true, mockup: true }));
  const plan = run?.meta?.planMockups;
  const fromPlan = [];
  for (const mockup of plan?.mockups || []) {
    const copy = own.find(asset => stem(asset.path) === mockup.label);
    const page = mockup.html ? { run: plan.runId, path: mockup.html } : null;
    if (copy) copy.page = page;
    else fromPlan.push({ path: mockup.picture, media: 'image', runFolder: true, mockup: true, planRun: plan.runId, page });
  }
  if (own.length) {
    const pairs = mockupPairs(run);
    own.forEach(asset => { asset.built = pairs.get(asset.path) || null; });
  }
  return [...own, ...fromPlan];
};

// The side panel never fetches the patch itself: its Diff tab reads a large
// patch in ranged pages, and a whole read here would undo that.
// What the run changed comes first, in diff order, then the clips it saved in
// its own folder, then the mockups it was built to match, then what it
// removed. A run-folder clip or mockup under a path the diff already has is
// left out, so a path names one asset.
const runAssets = run => {
  const known = runPatches.get(run?.id);
  const media = (known && known.key === patchKey(run) && known.files || []).filter(file => file.media);
  const changed = new Set(media.map(file => file.path));
  const folder = runFolderClips(run?.files).filter(clip => !changed.has(clip.path));
  const mockups = runMockups(run).filter(asset => !changed.has(asset.path));
  return [...media.filter(file => !file.removed), ...folder, ...mockups, ...media.filter(file => file.removed)];
};

export function hasAssets(run) {
  return runAssets(run).length > 0;
}

const ASSET_ICON = (body, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ASSET_ICONS = {
  audio: ASSET_ICON('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  video: ASSET_ICON('<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  image: ASSET_ICON('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  play: ASSET_ICON('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: ASSET_ICON('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  prev: ASSET_ICON('<path d="M6 5v14"/><path d="M19 5 9 12l10 7z" fill="currentColor"/>'),
  next: ASSET_ICON('<path d="M18 5v14"/><path d="m5 5 10 7-10 7z" fill="currentColor"/>'),
};
const KIND_NAMES = { audio: 'Audio', video: 'Video', image: 'Image' };
const SEEK_STEP = 5;

export function clockTime(seconds) {
  if (!Number.isFinite(seconds)) return '–:––';
  const whole = Math.max(0, Math.floor(seconds));
  const pad = value => String(value).padStart(2, '0');
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// The tab's state lives in one object: the module test reads every top-level
// name as app-wide.
const assetsTab = {
  run: null,
  picked: new Map(),      // runId -> the path last picked or played
  durations: new Map(),   // `${runId}:${path}` -> seconds
  probing: false,
  scrubbing: false,
};

const durationKey = (runId, path) => `${runId}:${path}`;

// What the player at the top shows: the clip playing, else the last one
// picked or played, else the first asset.
function selectedAsset(assets) {
  const runId = assetsTab.run.id;
  const playing = clipPlayback(runId);
  const path = playing?.path || assetsTab.picked.get(runId);
  return assets.find(asset => asset.path === path) || assets[0] || null;
}

// One metadata probe at a time, so a run with dozens of clips doesn't fire
// dozens of requests at once.
function probeDurations(run, assets) {
  if (assetsTab.probing) return;
  const asset = assets.find(item => isClip(item) && !assetsTab.durations.has(durationKey(run.id, item.path)));
  if (!asset) return;
  assetsTab.probing = true;
  const probe = document.createElement(asset.media === 'video' ? 'video' : 'audio');
  const done = seconds => {
    assetsTab.durations.set(durationKey(run.id, asset.path), seconds);
    probe.removeAttribute('src');
    probe.load();
    assetsTab.probing = false;
    if (assetsTab.run?.id === run.id) renderAssets();
  };
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => done(Number.isFinite(probe.duration) ? probe.duration : NaN), { once: true });
  probe.addEventListener('error', () => done(NaN), { once: true });
  probe.src = assetUrl(run.id, asset);
}

function stageHtml(asset, runId) {
  if (!asset) return '';
  const name = esc(asset.path.split('/').pop());
  if (asset.built) {
    return `<figure class="assets-pair-pane"><img src="${esc(assetUrl(runId, asset))}" alt="${esc(`Mockup ${name}`)}"><figcaption>Mockup</figcaption></figure>
      <figure class="assets-pair-pane"><img src="${esc(fileUrl(runId, asset.built.path))}" alt="${esc(`Built ${asset.built.flow || name}`)}"><figcaption>Built</figcaption></figure>`;
  }
  if (asset.media === 'image') return `<img src="${esc(assetUrl(runId, asset))}" alt="${name}">`;
  if (asset.media === 'video') return '';
  return `<div class="assets-stage-audio">${ASSET_ICONS.audio}<span>${name}</span></div>`;
}

function listHtml(assets, selected, runId, playing) {
  return assets.map(asset => {
    const name = asset.path.split('/').pop();
    const folder = asset.path.slice(0, -name.length).replace(/\/$/, '');
    const seconds = assetsTab.durations.get(durationKey(runId, asset.path));
    const where = asset.planRun ? 'Plan mockup' : asset.mockup ? 'Mockup' : asset.runFolder ? 'Run folder' : '';
    const meta = [KIND_NAMES[asset.media], asset.removed ? 'Removed' : '', where, Number.isFinite(seconds) ? clockTime(seconds) : ''].filter(Boolean).join(' · ');
    const current = asset === selected;
    const state = current && playing ? (playing.paused ? ', paused' : ', playing') : '';
    return `<li><button type="button" class="assets-item${asset.removed ? ' is-removed' : ''}" data-asset="${esc(asset.path)}" data-focus-key="asset:${esc(asset.path)}"${current ? ' aria-current="true"' : ''} title="${esc(asset.path)}" aria-label="${esc(`${name}, ${meta}${state}`)}">
      <span class="assets-item-icon" aria-hidden="true">${ASSET_ICONS[asset.media]}</span>
      <span class="assets-item-name">${esc(name)}</span>
      <span class="assets-item-path chat-mono">${esc(folder)}</span>
      <span class="assets-item-meta">${esc(meta)}</span>
    </button></li>`;
  }).join('');
}

// Moves the scrubber and the clock without redrawing anything else, so a
// drag stays under the pointer.
function paintAssetsTime() {
  const body = $('run-assets-body');
  const run = assetsTab.run;
  const scrubber = body.querySelector('.assets-scrubber');
  if (!run || !scrubber) return;
  const assets = runAssets(run);
  const selected = selectedAsset(assets);
  const playing = clipPlayback(run.id);
  const live = playing && playing.path === selected?.path;
  const known = assetsTab.durations.get(durationKey(run.id, selected?.path));
  const duration = live && playing.duration !== null ? playing.duration : Number.isFinite(known) ? known : null;
  const time = live ? playing.time : 0;
  scrubber.disabled = !selected || !isClip(selected) || duration === null;
  scrubber.max = String(duration ?? 0);
  if (!assetsTab.scrubbing) scrubber.value = String(Math.min(time, duration ?? 0));
  const progress = duration ? Math.min(1, Number(scrubber.value) / duration) : 0;
  scrubber.style.setProperty('--progress', `${(progress * 100).toFixed(2)}%`);
  scrubber.setAttribute('aria-valuetext', `${clockTime(time)} of ${clockTime(duration ?? NaN)}`);
  body.querySelector('.assets-time').textContent = clockTime(time);
  body.querySelector('.assets-duration').textContent = clockTime(duration ?? NaN);
}

function renderAssets() {
  const body = $('run-assets-body');
  const run = assetsTab.run;
  if (!run) return;
  const assets = runAssets(run);
  if (!assets.length) {
    body.innerHTML = '<p class="run-diff-note" role="status">No images, audio or video in this run.</p>';
    return;
  }
  const playing = clipPlayback(run.id);
  if (playing && playing.duration !== null) assetsTab.durations.set(durationKey(run.id, playing.path), playing.duration);
  const selected = selectedAsset(assets);
  const live = playing && playing.path === selected.path;
  const index = assets.indexOf(selected);
  const view = $('run-panel-assets');
  const hadFocus = view.contains(document.activeElement);
  const focusKey = hadFocus ? document.activeElement.dataset.focusKey : null;
  if (!body.querySelector('.assets-player')) {
    body.innerHTML = `<section class="assets-player" aria-label="Player">
      <div class="assets-stage"></div>
      <div class="assets-transport">
        <button type="button" class="diff-tool" data-assets-action="prev" data-focus-key="prev" aria-label="Previous asset" title="Previous asset (↑ or [)">${ASSET_ICONS.prev}</button>
        <button type="button" class="diff-tool assets-toggle" data-assets-action="toggle" data-focus-key="toggle"></button>
        <button type="button" class="diff-tool" data-assets-action="next" data-focus-key="next" aria-label="Next asset" title="Next asset (↓ or ])">${ASSET_ICONS.next}</button>
        <span class="assets-time"></span>
        <input type="range" class="assets-scrubber" aria-label="Seek" min="0" max="0" step="0.01" value="0" data-focus-key="seek">
        <span class="assets-duration"></span>
      </div>
      <p class="assets-now"><span class="assets-now-name"></span><span class="assets-now-path chat-mono"></span><a class="assets-now-open" target="_blank" rel="noopener" hidden>Open mockup</a></p>
    </section>
    <ul class="assets-list" style="scroll-padding-block:6px" aria-label="Assets"></ul>`;
  }
  const stage = body.querySelector('.assets-stage');
  const media = live && selected.media === 'video' ? playing.media : null;
  const stageKey = `${selected.path}:${media ? 'live' : 'idle'}:${selected.built?.path || ''}`;
  if (stage.dataset.key !== stageKey) {
    stage.dataset.key = stageKey;
    stage.dataset.kind = selected.built ? 'pair' : selected.media;
    stage.innerHTML = stageHtml(selected, run.id);
    // An idle video shows its first frame until it plays.
    if (selected.media === 'video') {
      const video = media || Object.assign(document.createElement('video'), { preload: 'metadata', muted: true, src: assetUrl(run.id, selected) });
      video.setAttribute('aria-label', selected.path.split('/').pop());
      stage.append(video);
    }
  }
  body.querySelector('.assets-transport').dataset.kind = selected.media;
  const toggle = body.querySelector('.assets-toggle');
  const running = live && !playing.paused;
  toggle.disabled = !isClip(selected);
  toggle.innerHTML = running ? ASSET_ICONS.pause : ASSET_ICONS.play;
  toggle.setAttribute('aria-label', running ? 'Pause' : 'Play');
  toggle.title = running ? 'Pause (Space)' : 'Play (Space)';
  body.querySelector('[data-assets-action="prev"]').disabled = index <= 0;
  body.querySelector('[data-assets-action="next"]').disabled = index >= assets.length - 1;
  const name = selected.path.split('/').pop();
  body.querySelector('.assets-now-name').textContent = name;
  body.querySelector('.assets-now-path').textContent = selected.removed ? `Removed: ${selected.path}`
    : selected.planRun ? `Plan ${selected.planRun}: ${selected.path}`
    : selected.mockup ? `Mockup: ${selected.path}`
    : selected.runFolder ? `Run folder: ${selected.path}` : selected.path;
  const open = body.querySelector('.assets-now-open');
  open.hidden = !selected.page;
  if (selected.page) open.href = fileUrl(selected.page.run, selected.page.path);
  else open.removeAttribute('href');
  body.querySelector('.assets-list').innerHTML = listHtml(assets, selected, run.id, live ? playing : null);
  paintAssetsTime();
  if (hadFocus && !view.contains(document.activeElement)) {
    const restored = focusKey && body.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    // Disabling prev/next/toggle/seek drops focus to body; keep it in the panel.
    if (restored && !restored.disabled) restored.focus({ preventScroll: true });
    else view.focus({ preventScroll: true });
  }
  probeDurations(run, assets);
}

export function showAssetsPanel(run) {
  if (assetsTab.run?.id !== run.id) $('run-assets-body').replaceChildren();
  assetsTab.run = run;
  renderAssets();
}

// Plays or shows one asset. A clip keeps the player's play or pause, and
// starts from `at` seconds in.
function pickAsset(asset, { paused = false, at = 0 } = {}) {
  const run = assetsTab.run;
  assetsTab.picked.set(run.id, asset.path);
  if (!isClip(asset)) {
    stopClips();
    renderAssets();
    return;
  }
  const assets = runAssets(run);
  const clips = assets.filter(isClip).map(item => item.path);
  const urlFor = (runId, path) => assetUrl(runId, assets.find(item => item.path === path));
  playClips(run.id, clips, urlFor, { index: clips.indexOf(asset.path), paused, at });
}

function revealAsset(path, focus = true) {
  const item = $('run-assets-body').querySelector(`[data-focus-key="asset:${CSS.escape(path)}"]`);
  if (!item) return;
  item.scrollIntoView({ block: 'nearest' });
  if (focus) item.focus({ preventScroll: true });
}

function selectAssetAt(index, { focusItem = false } = {}) {
  const run = assetsTab.run;
  const assets = runAssets(run);
  const target = assets[index];
  if (!target) return;
  const inList = !!$('run-assets-body').querySelector('.assets-list')?.contains(document.activeElement);
  if (target !== selectedAsset(assets)) {
    const playing = clipPlayback(run.id);
    // With nothing playing, stepping only moves the selection.
    if (!playing && isClip(target)) {
      assetsTab.picked.set(run.id, target.path);
      renderAssets();
    } else {
      pickAsset(target, { paused: !!playing?.paused });
    }
  }
  revealAsset(target.path, focusItem || inList);
}

function stepAsset(step, options) {
  const assets = runAssets(assetsTab.run);
  const focusedPath = document.activeElement?.closest?.('[data-asset]')?.dataset.asset;
  const anchor = (focusedPath && assets.find(asset => asset.path === focusedPath)) || selectedAsset(assets);
  const index = assets.indexOf(anchor);
  if (index >= 0) selectAssetAt(index + step, options);
}

function toggleAsset() {
  const run = assetsTab.run;
  const selected = selectedAsset(runAssets(run));
  if (!selected || !isClip(selected)) return;
  const playing = clipPlayback(run.id);
  if (playing?.path === selected.path) setClipsPaused(!playing.paused);
  else pickAsset(selected);
}

function seekAsset(seconds) {
  const run = assetsTab.run;
  const selected = selectedAsset(runAssets(run));
  if (!selected || !isClip(selected)) return;
  const playing = clipPlayback(run.id);
  if (playing?.path === selected.path) seekClip(seconds);
  else pickAsset(selected, { paused: true, at: seconds });
}

onClipChange(() => {
  const run = assetsTab.run;
  if (!run) return;
  const playing = clipPlayback(run.id);
  if (playing) assetsTab.picked.set(run.id, playing.path);
  if (!$('run-panel-assets').hidden) renderAssets();
});
onClipTime(() => { if (assetsTab.run && !$('run-panel-assets').hidden) paintAssetsTime(); });
onRunDiffFiles(runId => { if (assetsTab.run?.id === runId && !$('run-panel-assets').hidden) renderAssets(); });

(() => {
  const view = $('run-panel-assets');
  const body = $('run-assets-body');
  view.tabIndex = -1;
  view.style.outline = 'none';
  document.addEventListener('click', event => {
    if (event.target.closest?.('.chat-files-assets') && !view.hidden) {
      view.focus({ preventScroll: true });
    }
  });
  $('run-panel-tab-assets')?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || view.hidden || !assetsTab.run || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const assets = runAssets(assetsTab.run);
    if (!assets.length) return;
    const index = assets.indexOf(selectedAsset(assets));
    selectAssetAt(Math.min(Math.max(0, index) + 1, assets.length - 1), { focusItem: true });
    event.preventDefault();
  });
  body.addEventListener('click', event => {
    const item = event.target.closest('[data-asset]');
    if (item) {
      const asset = runAssets(assetsTab.run).find(entry => entry.path === item.dataset.asset);
      if (asset) {
        pickAsset(asset);
        // WKWebView on macOS leaves <button> unfocused on pointer click.
        revealAsset(asset.path);
      }
      return;
    }
    const action = event.target.closest('[data-assets-action]')?.dataset.assetsAction;
    if (!action) return;
    if (action === 'toggle') toggleAsset();
    else if (action === 'prev') stepAsset(-1);
    else if (action === 'next') stepAsset(1);
    const button = body.querySelector(`[data-assets-action="${CSS.escape(action)}"]`);
    (button && !button.disabled ? button : view).focus({ preventScroll: true });
  });
  // Every input seeks at once, so a drag is heard and seen as it moves.
  body.addEventListener('input', event => {
    if (event.target.matches('.assets-scrubber')) seekAsset(Number(event.target.value));
  });
  body.addEventListener('pointerdown', event => {
    if (!event.target.matches('.assets-scrubber')) return;
    assetsTab.scrubbing = true;
    const release = () => {
      assetsTab.scrubbing = false;
      paintAssetsTime();
    };
    window.addEventListener('pointerup', release, { once: true });
    window.addEventListener('pointercancel', release, { once: true });
  });
  view.addEventListener('keydown', event => {
    if (!assetsTab.run || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const assets = runAssets(assetsTab.run);
    if (!assets.length) return;
    const item = event.target.closest('[data-asset]');
    const onActionButton = !!event.target.closest('[data-assets-action]');
    const onScrubber = event.target.matches('.assets-scrubber');
    const selected = selectedAsset(assets);
    const playing = clipPlayback(assetsTab.run.id);
    if (event.key === ' ') {
      // Native <button> activation on Space clicks the row and restarts from 0:00.
      if (onActionButton || (item && item.dataset.asset !== selected?.path)) return;
      toggleAsset();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (event.shiftKey) return;
      stepAsset(event.key === 'ArrowUp' ? -1 : 1, { focusItem: true });
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !onScrubber) {
      if (event.shiftKey) return;
      const dir = event.key === 'ArrowLeft' ? -1 : 1;
      if (playing) seekClip(playing.time + dir * SEEK_STEP);
      else stepAsset(dir, { focusItem: true });
    } else if ((event.key === 'Home' || event.key === 'End') && !onScrubber) {
      if (event.shiftKey) return;
      selectAssetAt(event.key === 'Home' ? 0 : assets.length - 1, { focusItem: true });
    } else if (event.key === '[') stepAsset(-1);
    else if (event.key === ']') stepAsset(1);
    else return;
    event.preventDefault();
  });
})();
