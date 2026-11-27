// A vault on its own, for a phone's home screen: the vault's page, the box
// that changes it, and the entries waiting for the user. It talks to the same
// /api/vaults routes as Orc's Vaults screen (frontend.js), through the Orc
// this phone is paired with, so what is added here is on that Mac at once.
import {
  vaultBuildEndedLine, vaultBuildSource, vaultLink, vaultMode, vaultPageGesture, vaultPageRequest, vaultPageState, vaultPageUrl, vaultToolLabel, vaultTrustsLink,
} from './vault-helpers.js';

const slug = document.body.dataset.vault;
const root = document.getElementById('vault-app');
const api = `/api/vaults/${encodeURIComponent(slug)}`;
const BUILD_POLL_MS = 1500;
const IDLE_POLL_MS = 15000;
const ASK_MAX = 8000;
const DRAFT_KEY = `orcVaultDraft:${slug}`;
const FRAME_SANDBOX = 'allow-scripts';
const LINK_LABEL_MAX = 80;

let detail = null;
let error = '';
let busy = '';
let notice = '';
let askedLink = null;
let pollTimer = 0;
let generation = 0;
let shownAway = '';
let boxShown = false;
let pageToldAs = '';
// When this app itself last saw a tap or key, and when each page window said
// it had loaded, for vaultPageGesture.
let ownInputAt = -Infinity;
const pageShownAt = new WeakMap();

// Orc's mode, as Orc on this browser shows it: the light or dark saved
// under orcTheme, else the system's. The app wears it too, as Orc does.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function savedMode() {
  try { return localStorage.getItem('orcTheme'); } catch { return null; }
}
const mode = () => vaultMode(null, savedMode(), systemDark.matches);
function wearMode() {
  const saved = savedMode();
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  else delete document.documentElement.dataset.theme;
}
wearMode();

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const building = () => detail?.build?.state === 'building';
const pageHasBox = () => !!detail?.vault?.page?.ownsBox;
const pageOwnsBox = () => pageHasBox() && !boxShown;

function readDraft() {
  try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}
function keepDraft(text) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

async function call(path, body) {
  let response = null;
  try {
    response = await fetch(`${api}${path}`, body === undefined
      ? { cache: 'no-store', credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {}
  const data = response ? await response.json().catch(() => ({})) : {};
  return { ok: !!response?.ok, status: response?.status || 0, data: data && typeof data === 'object' ? data : {} };
}

function unreachable(result) {
  if (result.status === 401) return 'This phone is signed out of Orc. Reload to sign in again.';
  if (result.status === 404) return result.data.error || 'This vault is not on that Mac any more.';
  if (!result.status) return 'Orc cannot be reached. Its Mac has to be awake, online and on Tailscale.';
  return result.data.error || 'Orc could not load this vault. Try again.';
}

async function load() {
  const mine = ++generation;
  const result = await call('');
  if (mine !== generation) return;
  if (result.ok && result.data.vault) {
    detail = result.data;
    error = '';
  } else {
    error = unreachable(result);
  }
  render();
  schedule();
}

function schedule() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(load, building() ? BUILD_POLL_MS : IDLE_POLL_MS);
}

// A poll that left before a change did must not put the older answer back.
function take(result) {
  generation++;
  if (result.ok && result.data.vault) {
    const { proposal: _decided, ...next } = result.data;
    detail = next;
    error = '';
    return true;
  }
  notice = result.data.error || unreachable(result);
  return false;
}

// ---------- Rendering ----------

function headHtml() {
  const vault = detail?.vault || {};
  return `<header class="vault-app-head">
    <span class="vault-app-dot" aria-hidden="true"></span>
    <div class="vault-app-title">
      <h1>${esc(vault.name || slug)}</h1>
      ${vault.about ? `<p>${esc(vault.about)}</p>` : ''}
    </div>
    ${pageHasBox() ? `<button type="button" class="vault-app-orc" data-box aria-pressed="${boxShown}" title="This page has its own box. This one is here should you need it.">${boxShown ? 'Hide box' : 'Box'}</button>` : ''}
    <a class="vault-app-orc" href="/#vaults/${encodeURIComponent(slug)}" title="Open this vault in Orc">Orc</a>
  </header>`;
}

function waitingHtml() {
  const waiting = detail?.proposals || [];
  if (!waiting.length) return '';
  return `<section class="vault-app-waiting" aria-labelledby="vault-app-waiting-title">
    <h2 id="vault-app-waiting-title">${waiting.length === 1 ? '1 entry waiting' : `${waiting.length} entries waiting`}</h2>
    <ul>${waiting.map(item => `<li>
      <p class="vault-app-entry-file">${esc(item.file)}</p>
      <p class="vault-app-entry-text">${esc(item.text)}</p>
      ${item.reason ? `<p class="vault-app-entry-reason">${esc(item.reason)}</p>` : ''}
      <span class="vault-app-buttons">
        <button type="button" data-decide="dismiss" data-proposal="${esc(item.id)}" ${busy ? 'disabled' : ''}>Dismiss</button>
        <button type="button" class="is-primary" data-decide="approve" data-proposal="${esc(item.id)}" ${busy ? 'disabled' : ''}>Approve</button>
      </span>
    </li>`).join('')}</ul>
  </section>`;
}

function saidHtml() {
  const build = detail?.build || {};
  const from = vaultBuildSource(build);
  let body = '';
  if (build.state === 'building') {
    body = `<p class="vault-app-said is-building" role="status"><span class="vault-app-pulse" aria-hidden="true"></span><strong>${from ? `${esc(from)} is building` : 'Building'}</strong> <span>${esc(build.activity || 'Working')}…</span></p>`;
  } else if (build.outcome && shownAway !== build.endedAt && !(pageOwnsBox() && build.outcome === 'completed')) {
    const failed = build.outcome !== 'completed';
    body = `<p class="vault-app-said${failed ? ' is-error' : ''}" role="status">${esc(failed ? vaultBuildEndedLine(build) : build.reply || 'Done.')}
      <button type="button" class="vault-app-away" data-away aria-label="Put this away">×</button></p>`;
  }
  for (const tool of build.state === 'building' ? [] : build.denied || []) {
    body += `<p class="vault-app-said">This page asked to use <strong>${esc(vaultToolLabel(tool))}</strong>, which it is not allowed.
      <button type="button" data-allow="${esc(tool)}" ${busy ? 'disabled' : ''}>Allow</button></p>`;
  }
  if (askedLink) {
    body += `<div class="vault-app-link" role="group" aria-labelledby="vault-app-link-text">
      <p id="vault-app-link-text">Open <strong translate="no" title="${esc(askedLink.href)}">${esc(askedLink.label.length > LINK_LABEL_MAX ? `${askedLink.label.slice(0, LINK_LABEL_MAX - 1)}…` : askedLink.label)}</strong> from this page?</p>
      <label><input type="checkbox" id="vault-app-link-always"> Always open links to <span translate="no">${esc(askedLink.host)}</span></label>
      <span class="vault-app-buttons">
        <button type="button" data-link="drop">Not now</button>
        <button type="button" class="is-primary" data-link="open">Open</button>
      </span>
    </div>`;
  }
  if (notice) body += `<p class="vault-app-said is-note" role="status">${esc(notice)}</p>`;
  return body ? `<div class="vault-app-saids">${body}</div>` : '';
}

function askHtml() {
  const exists = detail?.vault?.page?.exists;
  const label = exists ? 'Add to this vault or change its page' : 'Describe the page you want';
  return `<form class="vault-app-ask" data-ask>
    <label class="sr-only" for="vault-app-text">${label}</label>
    <textarea id="vault-app-text" rows="2" maxlength="${ASK_MAX}" placeholder="${exists ? 'Add a win, a goal, an idea…' : 'Describe the page you want…'}" ${busy === 'ask' ? 'disabled' : ''}></textarea>
    ${building()
    ? `<button type="button" class="is-danger" data-stop ${busy ? 'disabled' : ''}>${busy === 'stop' ? 'Stopping…' : 'Stop'}</button>`
    : `<button type="submit" class="is-primary" ${busy ? 'disabled' : ''}>${busy === 'ask' ? 'Sending…' : 'Add'}</button>`}
  </form>`;
}

// The stage keeps its frame across renders, and a new version of the page
// loads in a frame of its own over the old one.
function syncStage(stage) {
  const page = detail?.vault?.page;
  stage.classList.toggle('is-building', building());
  const key = page?.exists ? `page:${page.version}` : `empty:${building()}`;
  if (stage.dataset.key === key) return;
  stage.dataset.key = key;
  if (!page?.exists) {
    stage.innerHTML = `<p class="vault-app-empty">${building() ? 'The page is being built…' : 'This vault has no page yet. Say below what it should show.'}</p>`;
    return;
  }
  const frame = document.createElement('iframe');
  frame.className = 'vault-app-frame';
  frame.title = `${detail.vault.name || slug} page`;
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = vaultPageUrl(slug, page.version, mode());
  const old = [...stage.children];
  if (!old.some(node => node.tagName === 'IFRAME')) {
    stage.replaceChildren(frame);
    return;
  }
  frame.classList.add('is-loading');
  frame.addEventListener('load', () => {
    for (const node of old) node.remove();
    frame.classList.remove('is-loading');
  }, { once: true });
  stage.append(frame);
}

function render() {
  root.removeAttribute('aria-busy');
  if (!detail) {
    root.innerHTML = `<p class="vault-app-error" role="alert">${esc(error || 'Opening…')}</p>
      <button type="button" class="vault-app-retry" data-retry>Try again</button>`;
    return;
  }
  document.title = detail.vault?.name || slug;
  if (!root.querySelector('.vault-app-stage')) {
    root.innerHTML = `<div class="vault-app-top"></div><div class="vault-app-stage"></div><div class="vault-app-bottom"></div><div class="vault-app-box"></div>`;
  }
  const typed = document.getElementById('vault-app-text');
  const focused = document.activeElement === typed;
  const draft = typed ? typed.value : readDraft();
  root.querySelector('.vault-app-top').innerHTML = headHtml()
    + (error ? `<p class="vault-app-error" role="alert">${esc(error)}</p>` : '');
  syncStage(root.querySelector('.vault-app-stage'));
  // Entries and replies scroll; the box under them always shows.
  const bottom = root.querySelector('.vault-app-bottom');
  bottom.innerHTML = waitingHtml() + saidHtml();
  bottom.hidden = !bottom.innerHTML;
  const box = root.querySelector('.vault-app-box');
  box.innerHTML = pageOwnsBox() ? '' : askHtml();
  box.hidden = pageOwnsBox();
  const text = document.getElementById('vault-app-text');
  if (text) {
    text.value = draft;
    if (focused) text.focus();
  }
  tellPages();
}

// ---------- Actions ----------

// Starts a build of `prompt`, from this app's box or the page's own.
// Returns the error to show, or '' once it started.
async function startBuild(prompt) {
  busy = 'ask';
  notice = '';
  render();
  const result = await call('/build', { prompt });
  busy = '';
  return take(result) ? '' : notice;
}

async function ask() {
  const text = document.getElementById('vault-app-text');
  const prompt = (text?.value || '').trim();
  if (busy || building()) return;
  if (!prompt) {
    notice = 'Say what to add first.';
    render();
    text?.focus();
    return;
  }
  // The box renders from what it holds, so a sent ask is cleared first.
  if (!await startBuild(prompt)) {
    keepDraft('');
    const sent = document.getElementById('vault-app-text');
    if (sent) sent.value = '';
  }
  render();
  schedule();
}

async function act(path, body) {
  busy = 'act';
  notice = '';
  render();
  const result = await call(path, body);
  busy = '';
  take(result);
  render();
  schedule();
  return result.ok;
}

function openLink(link) {
  window.open(link.href, '_blank', 'noopener,noreferrer');
}

// The page's script could send this without a click, so a link opens at once
// only for a site the user chose and while a click is fresh.
function onMessage(event) {
  const fromPage = pageWindows().includes(event.source);
  if (!fromPage || !detail) return;
  const asked = vaultPageRequest(event.data);
  if (asked) {
    answerPage(asked, event.source);
    return;
  }
  const link = vaultLink(event.data?.orcVaultLink, location.origin);
  if (!link) return;
  if (vaultTrustsLink(link.host, detail.settings?.links) && navigator.userActivation?.isActive) {
    openLink(link);
    return;
  }
  askedLink = link;
  render();
}

// The page's own window, one frame inside each of the stage's frames.
function pageWindows() {
  return [...root.querySelectorAll('.vault-app-frame')].map(frame => {
    try { return frame.contentWindow?.[0] || null; } catch { return null; }
  }).filter(Boolean);
}

function tellPage(target, error = '') {
  try { target.postMessage({ orcVaultState: vaultPageState(detail, error) }, '*'); } catch {}
}

function tellMode(target) {
  try { target.postMessage({ orcVaultMode: mode() }, '*'); } catch {}
}

// Orc's mode switching, here, in Orc in another tab, or with the system's.
function modeSwitched() {
  wearMode();
  for (const target of pageWindows()) tellMode(target);
}

function tellPages() {
  const told = JSON.stringify(vaultPageState(detail));
  if (told === pageToldAs) return;
  pageToldAs = told;
  for (const target of pageWindows()) tellPage(target);
}

// As on Orc's Vaults screen: the page's script could send an ask with nobody
// there, so one goes through only while a tap or key of the user's is fresh.
async function answerPage(asked, source) {
  const now = performance.now();
  if (asked.ready) {
    pageShownAt.set(source, now);
    tellMode(source);
    tellPage(source);
    return;
  }
  if (!vaultPageGesture({ active: navigator.userActivation?.isActive, sinceOrcInput: now - ownInputAt, sinceShown: now - (pageShownAt.get(source) ?? now) })) {
    tellPage(source, 'Orc builds what this page sends only straight after you tap a button or press a key in it. Try it again.');
    return;
  }
  if (asked.stop) {
    if (building()) act('/stop', {});
    return;
  }
  if (busy || building()) {
    tellPage(source, 'The page is already building. Wait for it to finish, or stop it.');
    return;
  }
  const failed = await startBuild(asked.ask);
  render();
  schedule();
  if (failed) tellPage(source, failed);
}

async function answerLink(open) {
  const link = askedLink;
  const always = document.getElementById('vault-app-link-always')?.checked;
  askedLink = null;
  if (open && link) openLink(link);
  render();
  if (open && link && always) await act('/links', { host: link.host, allowed: true });
}

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.decide) {
    act(`/proposals/${encodeURIComponent(button.dataset.proposal)}/${button.dataset.decide}`, {});
  } else if (button.dataset.allow) {
    act('/tools', { tool: button.dataset.allow, allowed: true });
  } else if (button.dataset.link) {
    answerLink(button.dataset.link === 'open');
  } else if ('stop' in button.dataset) {
    act('/stop', {});
  } else if ('away' in button.dataset) {
    shownAway = detail?.build?.endedAt || '';
    notice = '';
    render();
  } else if ('retry' in button.dataset) {
    load();
  } else if ('box' in button.dataset) {
    boxShown = !boxShown;
    render();
    (boxShown ? document.getElementById('vault-app-text') : root.querySelector('[data-box]'))?.focus();
  }
});
root.addEventListener('submit', event => {
  if (!event.target.matches('[data-ask]')) return;
  event.preventDefault();
  ask();
});
root.addEventListener('input', event => {
  if (event.target.id === 'vault-app-text') keepDraft(event.target.value);
});
root.addEventListener('keydown', event => {
  if (event.target.id === 'vault-app-text' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    ask();
  }
});
window.addEventListener('message', onMessage);
systemDark.addEventListener('change', modeSwitched);
window.addEventListener('storage', event => { if (event.key === 'orcTheme' || event.key === null) modeSwitched(); });
for (const kind of ['pointerdown', 'keydown']) document.addEventListener(kind, () => { ownInputAt = performance.now(); }, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(pollTimer);
  else load();
});

load();
