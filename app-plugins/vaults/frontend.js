import { $, announce, esc, relativeStamp } from '/js/core.js';
import { outsideMarkdownHtml } from '/js/user-markdown.js';
import { launchSetupLabel } from '/js/model-picker.js';
import '/js/effort-slider.js';
import qrcode from '/vendor/orc-qr.min.js';
import {
  VAULT_NOTE_LIMIT, VAULT_SOUL_LIMIT, vaultBuildEndedLine, vaultBuildSource, vaultByteLength, vaultCountLabel, vaultHue, vaultLayout,
  vaultLink, vaultMeterPercent, vaultNotePath, vaultNoteUrl, vaultPageGesture, vaultPageRequest, vaultPageState, vaultPageUrl, vaultPermalink, vaultPlaceFromPoint, vaultPlaceNudge, vaultPlural, VAULT_PLACE_HOMES,
  vaultSizeLabel, vaultToolLabel, vaultTrustsLink, vaultsByNeed,
} from './vault-helpers.js';

const SIBLING_VIEWS = ['empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'changelog-view', 'new-view',
  'stats-view', 'gallery-view', 'servers-view', 'bots-view', 'welcome-view', 'run-times'];
const ICON = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SIDEBAR_ICON = `<svg ${ICON}><rect x="3.5" y="4" width="17" height="15" rx="2"/><circle cx="12" cy="11.5" r="3.5"/><path d="M12 8v1.2M12 13.8V15M8.5 11.5h1.2M14.3 11.5h1.2M7 19v1.5M17 19v1.5"/></svg>`;
const TRASH_PATH = '~/.orc/vaults/.trash';
const ENTER_MS = 1200;
const FRESH_MS = 2200;
const BUILD_POLL_MS = 1500;
const IDLE_POLL_MS = 15000;
const FRAME_SWAP_MS = 4000;
const ASK_MAX = 8000;
const COG_ICON = `<svg ${ICON}><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.2M12 18.800V21M3 12h2.2M18.800 12H21M5.600 5.600l1.600 1.600M16.800 16.800l1.600 1.600M5.600 18.400l1.600-1.600M16.800 7.200l1.600-1.600"/></svg>`;
// What the frame may do: run the page's own script. It opens no window, so a
// link in the page is handed to Orc (see onPageMessage). The routes' own
// policies say the same.
const FRAME_SANDBOX = 'allow-scripts';
const LINK_LABEL_MAX = 80;
// What floats over a vault's page keeps this far from its edges, and a press
// must travel this far to count as a drag. Each vault remembers its layout.
const FLOAT_MARGIN = 12;
const DRAG_PX = 4;
const layoutKey = slug => `orc.vaults.layout:${slug}`;
const CHAT_ICON = `<svg ${ICON}><path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z"/></svg>`;
const GRIP_ICON = `<svg ${ICON}><circle cx="9" cy="6.5" r="1"/><circle cx="15" cy="6.5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17.5" r="1"/><circle cx="15" cy="17.5" r="1"/></svg>`;
const SHRINK_ICON = `<svg ${ICON}><path d="M6 12h12"/></svg>`;
const BOLTS = Array.from({ length: 8 }, (_, index) => {
  const angle = ((22.5 + index * 45) * Math.PI) / 180;
  return `<circle cx="${(32 + 25 * Math.cos(angle)).toFixed(2)}" cy="${(32 + 25 * Math.sin(angle)).toFixed(2)}" r="1.5"/>`;
}).join('');
const TICKS = Array.from({ length: 24 }, (_, index) => `<path d="M32 12.5v${index % 6 ? 2 : 3.5}" transform="rotate(${index * 15} 32 32)"/>`).join('');
const PANEL_ICONS = {
  proposals: '<path d="M4 13.5 6.5 5h11L20 13.5V19H4z"/><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20"/>',
  soul: '<path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.500z"/>',
  model: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9.500 9.500h5v5h-5zM9 2.500V5M15 2.500V5M9 19v2.500M15 19v2.500M2.500 9H5M2.500 15H5M19 9h2.500M19 15h2.500"/>',
  automations: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7v5l3.500 2"/>',
  tools: '<path d="M14.500 6.500a4 4 0 0 0-5 5l-5.500 5.500 2 2 5.500-5.500a4 4 0 0 0 5-5l-2.500 2.500-2-2z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.500-5.800M4 5v4h4M12 8v4.500l3 1.500"/>',
  notes: '<path d="M7 3.500h7.500L19 8v12.500H7z"/><path d="M14.5 3.500V8H19M10 12.500h6M10 16h6"/>',
  devices: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  settings: '<path d="M5 7h9M18 7h1M5 12h1M10 12h9M5 17h7M16 17h3"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="17" r="2"/>',
};

// Hidden from assistive tech: the name beside the door says everything it does.
function doorHtml(vault, size = '') {
  const waiting = Number(vault?.pending) > 0;
  const hue = vault ? ` style="--vault-hue:${vaultHue(vault.slug)}"` : '';
  return `<span class="vault-door${size ? ` ${size}` : ''}${waiting ? ' is-waiting' : ''}"${hue} aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false">
    <circle class="vault-door-rim" cx="32" cy="32" r="29.5"/>
    <g class="vault-door-bolts">${BOLTS}</g>
    <circle class="vault-door-face" cx="32" cy="32" r="20.5"/>
    <g class="vault-door-ticks">${TICKS}</g>
    <g class="vault-door-wheel"><path d="M32 20v24M20 32h24M23.5 23.500l17 17M40.5 23.500l-17 17"/><circle cx="32" cy="32" r="8"/><circle class="vault-door-hub" cx="32" cy="32" r="3"/></g>
  </svg></span>`;
}

function panelIcon(name) {
  return `<svg class="vault-panel-icon" ${ICON}>${PANEL_ICONS[name]}</svg>`;
}

function updatedLabel(vault) {
  const when = new Date(vault?.updatedAt || '');
  return Number.isFinite(when.getTime()) ? `Updated ${relativeStamp(when).replace(/^./, first => first.toLowerCase())}` : '';
}

let active = false;
let viewHash = '';
let wired = false;
let pluginSignal = null;
let listData = null;
let listError = '';
let listRequest = 0;
let detailSlug = '';
let detail = null;
let detailError = '';
let detailRequest = 0;
let busy = '';
let keepFocus = '';
let soulEditing = false;
let soulDraft = null;
let soulBase;
let soulStale = null;
let openNote = null;
let noteDraft = null;
let noteStale = null;
let noteLoading = '';
let noteConfirmDelete = false;
let newNoteDraft = '';
let renameDraft = null;
let newDialogPending = null;
let nameTouched = false;
let lastHtml = null;
let enterTimer = 0;
let freshNote = '';
let freshTimer = 0;
let askDraft = '';
let cogOpen = false;
let pollTimer = 0;
let frameTimer = 0;
let newPromptTouched = false;
// The end time of the build whose reply was put away.
let saidAway = '';
// The link the page last asked Orc to open, waiting for the user's word.
let askedLink = null;
// The Worker already holds a vault of this one's id, which syncing here would join.
let syncJoin = false;
let orcBoxShown = false;
// Over the page: whether the menu is open, the vault's layout (read from
// this Mac's storage once per vault), and a drag in progress.
let dockOpen = false;
let layout = null;
let drag = null;
// A drag ends in a click on what was dragged, which must do nothing.
let dragged = false;
// What the page was last told, so a poll that changed nothing tells it nothing.
let pageToldAs = '';
// When Orc itself last saw a click or key, and when each page window said it
// had loaded, for vaultPageGesture.
let orcInputAt = -Infinity;
const pageShownAt = new WeakMap();
const sectionStatus = {};

function resetDetailState() {
  detail = null;
  detailError = '';
  soulEditing = false;
  soulDraft = null;
  soulBase = undefined;
  soulStale = null;
  openNote = null;
  noteDraft = null;
  noteStale = null;
  noteLoading = '';
  noteConfirmDelete = false;
  newNoteDraft = '';
  renameDraft = null;
  askDraft = '';
  cogOpen = false;
  askedLink = null;
  syncJoin = false;
  orcBoxShown = false;
  dockOpen = false;
  layout = null;
  pageToldAs = '';
  for (const key of Object.keys(sectionStatus)) delete sectionStatus[key];
}

async function request(url, body) {
  let response = null;
  try {
    response = await fetch(url, body === undefined
      ? { cache: 'no-store', signal: pluginSignal }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: pluginSignal });
  } catch {}
  const data = response ? await response.json().catch(() => ({})) : {};
  return { ok: !!response?.ok, status: response?.status || 0, data: data && typeof data === 'object' ? data : {} };
}

const vaultUrl = slug => `/api/vaults/${encodeURIComponent(slug)}`;

async function loadList() {
  const generation = ++listRequest;
  const result = await request('/api/vaults');
  if (generation !== listRequest) return;
  if (result.ok && Array.isArray(result.data.vaults)) {
    listData = result.data;
    listError = '';
  } else {
    listError = result.data.error || 'Could not load your vaults. Try again.';
  }
  if (active && !detailSlug) render();
  if (newDialogPending && listData) {
    const template = newDialogPending.template;
    newDialogPending = null;
    openNewDialog(template);
  }
  schedulePoll();
}

const isBuilding = () => detail?.build?.state === 'building';
const pageHasBox = () => !!detail?.vault?.page?.ownsBox;
// The cog hides the page, so Orc's box shows while it is open.
const pageOwnsBox = () => pageHasBox() && !orcBoxShown && !cogOpen;
// The page has the whole screen beside the sidebar unless the cog is open.
const fullPage = () => !!detailSlug && !!detail && !cogOpen;

// A page that is building is read again every moment so its frame follows the
// build; an idle one now and then, as an automation can start it. The list is
// read again only while one of its vaults is building.
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!active || document.hidden) return;
  if (detailSlug) pollTimer = setTimeout(() => loadDetail(detailSlug), isBuilding() ? BUILD_POLL_MS : IDLE_POLL_MS);
  else if ((listData?.vaults || []).some(vault => vault.building)) pollTimer = setTimeout(loadList, BUILD_POLL_MS * 2);
}

async function loadDetail(slug) {
  const generation = ++detailRequest;
  const result = await request(vaultUrl(slug));
  if (generation !== detailRequest || slug !== detailSlug) return;
  if (!result.ok || !result.data.vault) {
    detailError = result.data.error || (result.status === 404 ? 'That vault does not exist.' : 'Could not load this vault. Try again.');
    if (result.status === 404) detail = null;
  } else {
    detailError = '';
    const wasBuilding = isBuilding();
    detail = result.data;
    followOpenNote();
    if (wasBuilding && !isBuilding()) announce(buildEndedLine(detail.build));
  }
  if (active) render();
  schedulePoll();
}

// An approved entry, or an edit made elsewhere, rewrites the open note. An
// untouched editor takes the new text rather than offering to save over it.
async function followOpenNote() {
  const listed = openNote && noteDraft === null && (detail?.notes || []).find(note => note.path === openNote.path);
  if (!listed || listed.mtime === openNote.mtime) return;
  const slug = detailSlug;
  const path = openNote.path;
  const result = await request(vaultNoteUrl(slug, path));
  if (slug !== detailSlug || openNote?.path !== path || noteDraft !== null || !result.ok || !result.data.note) return;
  openNote = result.data.note;
  if (active) render();
}

function statusHtml(section) {
  const entry = sectionStatus[section] || {};
  const action = entry.reload ? ` <button type="button" class="settings-btn-inline" id="vault-${section}-reload" data-vault-reload="${section}">Reload</button>` : '';
  return `<p id="vault-${section}-status" class="vault-status${entry.tone ? ` is-${entry.tone}` : ''}" role="status" aria-live="polite">${esc(entry.text || '')}${action}</p>`;
}

function setStatus(section, text, tone = '', reload = false) {
  sectionStatus[section] = { text, tone, reload };
  const el = $(`vault-${section}-status`);
  if (el && !reload) {
    el.className = `vault-status${tone ? ` is-${tone}` : ''}`;
    el.textContent = text;
  }
}

function render() {
  const view = $('vaults-view');
  if (!view || !active) return;
  if (!$('vaults-body')) {
    // The stage holds the page's frame. It sits outside the body so a
    // re-render never reloads the page.
    view.innerHTML = `<div id="vaults-body" class="vault-wrap"></div><div id="vault-stage" class="vault-wrap vault-stage" hidden></div>${newDialogHtml()}${deleteDialogHtml()}`;
    lastHtml = null;
  }
  $('vaults-body').classList.toggle('is-page', !!detailSlug);
  view.classList.toggle('is-page', !!detailSlug);
  view.classList.toggle('is-page-box', !!detailSlug && pageOwnsBox());
  view.classList.toggle('is-full', fullPage());
  syncStage();
  tellPages();
  // A refetch that changed nothing leaves the page alone, so its animations
  // and the reader's place in it are not reset.
  const html = detailSlug ? detailHtml() : listHtml();
  if (html === lastHtml && !keepFocus) return;
  lastHtml = html;
  const focused = document.activeElement && view.contains(document.activeElement) ? document.activeElement : null;
  let focusId = focused?.id || '';
  let wanted = '';
  if (!busy && keepFocus) {
    wanted = keepFocus;
    focusId = focusId || keepFocus;
    keepFocus = '';
  }
  const selection = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
  const textScroll = focused?.tagName === 'TEXTAREA' ? focused.scrollTop : 0;
  const scroll = view.scrollTop;
  const turns = turnsPlace();
  $('vaults-body').innerHTML = html;
  view.scrollTop = scroll;
  keepTurnsPlace(turns);
  fitDockStack();
  if (focusId && !view.querySelector('dialog[open]')) {
    // The ask box is not always on show: the chat shrinks, and a page can hold its own.
    const el = $(focusId) || (wanted && $(wanted)) || ([focusId, wanted].includes('vault-ask-text') ? boxOrButton() : null);
    if (el && view.contains(el)) {
      el.focus({ preventScroll: true });
      if (selection && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(...selection); } catch {} }
      if (textScroll) el.scrollTop = textScroll;
    }
  }
  syncControls();
}

// The model picker and effort slider are elements with their own state, made
// anew by each render.
function syncControls() {
  const settings = detail?.settings;
  const picker = $('vault-model');
  if (picker && settings) picker.selection = { agent: 'claude', model: settings.model, effort: settings.effort, fast: false };
  const effort = $('vault-effort');
  if (effort && settings) effort.value = settings.effort;
  growAsk();
}

function growAsk() {
  const box = $('vault-ask-text');
  if (!box) return;
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight + 2, 220)}px`;
}

// ---------- The page's frame ----------

function stageEmptyHtml(building) {
  const starters = (listData?.templates || []).filter(template => template.starter).slice(0, 3);
  if (building) {
    return `<div class="vault-stage-empty is-building" role="status">${doorHtml(detail.vault, 'is-large')}
      <h3>Building your page…</h3><p class="vault-note">It appears here as soon as its first part is written.</p></div>`;
  }
  return `<div class="vault-stage-empty">${doorHtml(detail.vault, 'is-large')}
    <h3>This vault has no page yet</h3>
    <p class="vault-note">Say what it should be in the chat, as plainly as you would to a person. You can keep changing it the same way.</p>
    ${starters.length ? `<div class="vault-quick">${starters.map(template => `<button type="button" class="settings-btn-inline" id="vault-starter-${esc(template.id)}" data-vault-starter="${esc(template.id)}">${esc(template.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function syncStage() {
  const stage = $('vault-stage');
  if (!stage) return;
  const page = detail?.vault?.page;
  const shown = fullPage();
  stage.hidden = !shown;
  if (!shown) {
    if (!detailSlug || !detail) {
      stage.replaceChildren();
      delete stage.dataset.key;
    }
    return;
  }
  const building = isBuilding();
  stage.classList.toggle('is-building', building);
  stage.style.setProperty('--vault-hue', vaultHue(detailSlug));
  const key = page?.exists ? `page:${detailSlug}:${page.version}` : `empty:${detailSlug}:${building}`;
  if (stage.dataset.key === key) return;
  const reloading = page?.exists && stage.dataset.key?.startsWith(`page:${detailSlug}:`);
  stage.dataset.key = key;
  if (!page?.exists) {
    stage.innerHTML = stageEmptyHtml(building);
    return;
  }
  // Each version loads in a frame of its own: changing one frame's address
  // would add every save of a build to the Back button's history.
  const frame = document.createElement('iframe');
  frame.id = 'vault-frame';
  frame.className = 'vault-frame';
  frame.title = `${detail.vault.name || detailSlug} page`;
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = vaultPageUrl(detailSlug, page.version);
  if (!reloading) {
    stage.replaceChildren(frame);
    return;
  }
  // The page on show stays until its next version has loaded over it. A
  // version still loading when a newer one arrives is dropped, so only the
  // newest ever takes the stage.
  const settle = () => {
    clearTimeout(frameTimer);
    for (const old of stage.querySelectorAll('.vault-frame')) if (old !== frame) old.remove();
    frame.classList.remove('is-loading');
  };
  for (const old of stage.querySelectorAll('.vault-frame')) {
    if (old.classList.contains('is-loading')) old.remove();
    else old.removeAttribute('id');
  }
  frame.classList.add('is-loading');
  frame.addEventListener('load', settle, { once: true });
  clearTimeout(frameTimer);
  frameTimer = setTimeout(settle, FRAME_SWAP_MS);
  stage.append(frame);
}

// ---------- The list ----------

function waitingTag(pending) {
  return pending ? `<span class="vault-tag is-gate"><span class="vault-pulse" aria-hidden="true"></span>${esc(vaultPlural(pending, 'proposal'))} waiting</span>` : '';
}

function cardHtml(vault, index) {
  const pending = Number(vault.pending) || 0;
  const updated = updatedLabel(vault);
  // A still of the page: with no script allowed, it is a picture and nothing more.
  const preview = vault.page?.exists
    ? `<span class="vault-card-preview" aria-hidden="true"><iframe tabindex="-1" sandbox="" loading="lazy" referrerpolicy="no-referrer" src="${esc(vaultPageUrl(vault.slug, vault.page.version))}"></iframe></span>` : '';
  return `<li style="--vault-i:${index}"><a class="vault-card${pending ? ' is-waiting' : ''}${preview ? ' has-preview' : ''}" style="--vault-hue:${vaultHue(vault.slug)}" href="#vaults/${encodeURIComponent(vault.slug)}">
    ${preview}${doorHtml(vault)}
    <span class="vault-card-text">
      <span class="vault-card-head"><span class="vault-card-name">${esc(vault.name || vault.slug)}</span>${waitingTag(pending)}</span>
      <span class="vault-card-about${vault.about ? '' : ' is-empty'}">${esc(vault.about || 'No description yet')}</span>
      <span class="vault-card-facts">${vault.building ? '<span class="vault-building-fact"><span class="vault-pulse" aria-hidden="true"></span>Building</span>' : ''}<span>${vault.page?.exists ? 'Has a page' : 'No page yet'}</span>${
        Number(vault.automations) ? `<span>${esc(vaultPlural(vault.automations, 'automation'))}</span>` : ''}${updated ? `<span>${esc(updated)}</span>` : ''}</span>
    </span>
  </a></li>`;
}

function statsHtml(vaults) {
  const automations = vaults.reduce((sum, vault) => sum + (Number(vault.automations) || 0), 0);
  const pending = vaults.reduce((sum, vault) => sum + (Number(vault.pending) || 0), 0);
  const first = vaults.find(vault => Number(vault.pending) > 0);
  const stat = (count, word, extra = '') => `<span class="vault-stat${extra}"><strong>${count.toLocaleString('en-US')}</strong> ${esc(word)}</span>`;
  return `<p class="vault-stats">${stat(vaults.length, vaults.length === 1 ? 'vault' : 'vaults')}${automations ? stat(automations, automations === 1 ? 'automation' : 'automations') : ''}${
    first ? `<a class="vault-stat is-gate" id="vault-stat-waiting" href="#vaults/${encodeURIComponent(first.slug)}"><span class="vault-pulse" aria-hidden="true"></span><strong>${pending.toLocaleString('en-US')}</strong> waiting for you</a>` : ''}</p>`;
}

function listHtml() {
  const vaults = vaultsByNeed(listData?.vaults);
  const templates = listData?.templates || [];
  let body;
  if (!listData) {
    body = `<p class="vault-note${listError ? ' is-error' : ''}" role="status">${esc(listError || 'Loading vaults…')}</p>`;
  } else if (!vaults.length) {
    body = `<section class="vault-empty" aria-labelledby="vaults-empty-title">
      ${doorHtml(null, 'is-large')}
      <div class="vault-empty-text">
        <h3 id="vaults-empty-title">No vaults yet</h3>
        <p class="vault-note">Pick a fullscreen template with its own chat, or build a page from a prompt.</p>
        <div class="vault-template-gallery">${templates.filter(item => item.readyPage).map(template => `<button type="button" class="vault-template-card" id="vault-quick-${esc(template.id)}" data-vault-new="${esc(template.id)}">${readyTemplateHtml(template)}</button>`).join('')}</div>
        <div class="vault-quick">${templates.filter(item => !item.readyPage).map(template => `<button type="button" class="settings-btn-inline" id="vault-quick-${esc(template.id)}" data-vault-new="${esc(template.id)}">${esc(template.label)}</button>`).join('')}</div>
      </div>
    </section>`;
  } else {
    body = `<ul class="vault-cards">${vaults.map(cardHtml).join('')}</ul>`;
  }
  return `<header class="vault-header vault-hero">
      ${vaults.length ? doorHtml(null, 'is-large') : ''}
      <div class="vault-hero-text"><h2 id="vaults-title" tabindex="-1">Vaults</h2>
      <p class="vault-note">Pages you build by describing them, one purpose each. They can rebuild themselves, and what agents propose for them waits here for you.</p>
      ${vaults.length ? statsHtml(vaults) : ''}</div>
      <div class="vault-header-actions"><button type="button" class="settings-btn-inline vault-primary" id="vault-new-open" data-vault-new>New vault</button></div>
    </header>
    ${listData && listError ? `<p class="vault-status is-error" role="status">${esc(listError)}</p>` : ''}
    ${statusHtml('list')}
    ${body}`;
}

function readyTemplateHtml(template) {
  return `<span class="vault-cover" data-cover="${esc(template.id)}" aria-hidden="true"></span>
    <span class="vault-template-text"><span class="vault-template-label">${esc(template.label)}</span>
      <span class="vault-template-about">${esc(template.purpose)}</span></span>`;
}

function templatesHtml(templates, picked) {
  const radio = item => `<input type="radio" name="template" value="${esc(item.id)}" id="vault-template-${esc(item.id)}"${item.id === picked ? ' checked' : ''}>`;
  const pages = templates.filter(item => item.readyPage);
  const prompts = templates.filter(item => !item.readyPage);
  return `<legend>Start from</legend>
    <div class="vault-template-gallery">${pages.map(item => `<label class="vault-template-card">${radio(item)}${readyTemplateHtml(item)}</label>`).join('')}</div>
    <div class="vault-template-prompts">${prompts.map(item => `<label class="vault-template" title="${esc(item.purpose)}">
      ${radio(item)}<span class="vault-template-label">${esc(item.label)}</span></label>`).join('')}</div>`;
}

function newDialogHtml() {
  return `<dialog id="vault-new-dialog" class="vault-dialog" aria-labelledby="vault-new-title">
    <form method="dialog" data-vault-create>
      <h3 id="vault-new-title">New vault</h3>
      <p class="vault-note">Templates open with a finished page and built-in chat. You can change them as you go.</p>
      <label class="vault-field">Name<input id="vault-new-name" name="name" type="text" maxlength="60" autocomplete="off" required></label>
      <fieldset class="vault-templates" id="vault-new-templates"><legend>Start from</legend></fieldset>
      <label class="vault-field"><span id="vault-prompt-label">What should this page be?</span><textarea id="vault-new-prompt" name="prompt" rows="4" maxlength="${ASK_MAX}" placeholder="Leave empty to make the vault and build its page later."></textarea></label>
      <p id="vault-new-status" class="vault-status" role="status" aria-live="polite"></p>
      <div class="vault-dialog-actions">
        <button type="button" class="settings-btn-inline" data-vault-new-cancel>Cancel</button>
        <button type="submit" class="settings-btn-inline vault-primary" id="vault-new-submit">Create vault</button>
      </div>
    </form>
  </dialog>`;
}

function deleteDialogHtml() {
  return `<dialog id="vault-delete-dialog" class="vault-dialog" aria-labelledby="vault-delete-title" aria-describedby="vault-delete-text">
    <form method="dialog" data-vault-delete>
      <h3 id="vault-delete-title">Delete this vault?</h3>
      <p class="vault-note" id="vault-delete-text"></p>
      <p id="vault-delete-status" class="vault-status" role="status" aria-live="polite"></p>
      <div class="vault-dialog-actions">
        <button type="button" class="settings-btn-inline" data-vault-delete-cancel>Cancel</button>
        <button type="submit" class="settings-btn-inline vault-danger" id="vault-delete-confirm">Delete vault</button>
      </div>
    </form>
  </dialog>`;
}

function pickTemplate(id) {
  const templates = listData?.templates || [];
  const template = templates.find(item => item.id === id) || templates[0];
  if (!template) return;
  const radio = $(`vault-template-${template.id}`);
  if (radio) radio.checked = true;
  const prompt = $('vault-new-prompt');
  if (prompt) {
    $('vault-prompt-label').textContent = template.readyPage ? 'First change (optional)' : 'What should this page be?';
    prompt.placeholder = template.readyPage ? 'Leave empty to open the finished template.' : 'Leave empty to build the page later.';
    if (!newPromptTouched) prompt.value = template.starter || '';
  }
  const name = $('vault-new-name');
  if (name && !nameTouched) name.value = template.name || '';
}

function openNewDialog(templateId) {
  const dialog = $('vault-new-dialog');
  if (!dialog) return;
  if (!listData) {
    newDialogPending = { template: templateId };
    return;
  }
  const templates = listData.templates || [];
  const picked = templates.some(item => item.id === templateId) ? templateId : templates[0]?.id;
  dialog.querySelector('form').reset();
  nameTouched = false;
  newPromptTouched = false;
  const status = $('vault-new-status');
  status.textContent = '';
  status.className = 'vault-status';
  $('vault-new-templates').innerHTML = templatesHtml(templates, picked);
  $('vault-new-submit').disabled = false;
  pickTemplate(picked);
  if (!dialog.open) dialog.showModal();
  const name = $('vault-new-name');
  name?.focus();
  name?.select();
}

async function createVault(form) {
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const template = String(data.get('template') || 'blank');
  const prompt = String(data.get('prompt') || '').trim();
  const status = $('vault-new-status');
  status.className = 'vault-status';
  if (!name) {
    status.textContent = 'Name the vault first.';
    status.classList.add('is-error');
    $('vault-new-name')?.focus();
    return;
  }
  const submit = $('vault-new-submit');
  submit.disabled = true;
  status.textContent = 'Creating…';
  const result = await request('/api/vaults', { name, template });
  if (!result.ok || !result.data.vault?.slug) {
    submit.disabled = false;
    status.textContent = result.data.error || 'Could not create the vault. Try again.';
    status.classList.add('is-error');
    announce(status.textContent);
    return;
  }
  const vault = result.data.vault;
  // The vault exists either way; a build that will not start is said on its screen.
  const started = prompt ? await request(`${vaultUrl(vault.slug)}/build`, { prompt }) : null;
  submit.disabled = false;
  $('vault-new-dialog')?.close();
  if (listData) listData = { ...listData, vaults: [vault, ...(listData.vaults || []).filter(item => item.slug !== vault.slug)] };
  resetDetailState();
  detailSlug = vault.slug;
  detail = started?.ok && started.data.vault ? started.data : result.data;
  if (started && !started.ok) {
    askDraft = prompt;
    sectionStatus.ask = { text: started.data.error || 'Could not start the build. Try again.', tone: 'error' };
  }
  announce(started?.ok ? `Created ${vault.name}. Building its page.` : `Created ${vault.name}.`);
  location.hash = `vaults/${encodeURIComponent(vault.slug)}`;
}

// ---------- One vault ----------

function markdownHtml(text) {
  return outsideMarkdownHtml(text, { newTab: true }) ?? `<pre>${esc(text)}</pre>`;
}

function formatDate(seconds) {
  const when = new Date(Number(seconds) * 1000);
  if (!Number.isFinite(when.getTime())) return '';
  const sameYear = when.getFullYear() === new Date().getFullYear();
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function modelLabel(settings) {
  return launchSetupLabel({ agent: 'claude', model: settings?.model, effort: settings?.effort, fast: false }) || settings?.model || '';
}

const buildEndedLine = vaultBuildEndedLine;

function askHtml() {
  const building = isBuilding();
  const sending = busy === 'ask';
  const settings = detail.settings || {};
  const exists = detail.vault?.page?.exists;
  return `<form class="vault-ask${building ? ' is-building' : ''}" data-vault-ask aria-labelledby="vault-ask-label">
    <label id="vault-ask-label" class="sr-only" for="vault-ask-text">${exists ? 'What should change on this page?' : 'What should this page be?'}</label>
    <textarea id="vault-ask-text" rows="1" maxlength="${ASK_MAX}" aria-describedby="vault-said" placeholder="${exists ? 'Change this page: add a win, move a section, restyle it…' : 'Describe the page you want…'}" ${sending ? 'disabled' : ''}>${esc(askDraft)}</textarea>
    <div class="vault-ask-foot">
      <button type="button" class="vault-ask-model" id="vault-ask-model" data-vault-cog="model" title="Change the model this page builds with"><span class="sr-only">Model: </span>${esc(modelLabel(settings))}</button>
      <span class="vault-ask-hint" aria-hidden="true">⏎ builds · ⇧⏎ new line</span>
      ${building
    ? `<button type="button" class="settings-btn-inline vault-danger" id="vault-stop" data-vault-stop ${busy === 'stop' ? 'disabled' : ''}>${busy === 'stop' ? 'Stopping…' : 'Stop'}</button>`
    : `<button type="submit" class="settings-btn-inline vault-primary" id="vault-build" ${sending ? 'disabled' : ''}>${sending ? 'Starting…' : 'Build'}</button>`}
    </div>
  </form>`;
}

// By the box: what the build is doing, or how the last one ended. The last
// build's lines can be put away; a tool it was refused stays until decided.
// `where` is the chat, the cog's screen, or beside the menu button when the
// chat is shrunk or the page holds its own box.
function saidHtml(where) {
  const build = detail.build || {};
  const from = vaultBuildSource(build);
  // Where the conversation is on show, Orc does not repeat the reply.
  const owned = pageOwnsBox() || (where === 'chat' && layoutNow().history);
  let body = '';
  if (build.state === 'building' && where === 'dock') {
    // With no box of Orc's in sight, Orc names what is being built, since
    // the page's script may have sent it, and keeps Stop.
    body = `<p class="vault-said-line is-building" role="status"><span class="vault-pulse" aria-hidden="true"></span><strong>${from ? `${esc(from)} is building this page` : 'Building'}</strong>${build.prompt && !from ? `<span class="vault-said-asked">“${esc(build.prompt)}”</span>` : `<span>${esc(build.activity || 'Working')}…</span>`}
      <button type="button" class="settings-btn-inline vault-danger" id="vault-stop" data-vault-stop ${busy === 'stop' ? 'disabled' : ''}>${busy === 'stop' ? 'Stopping…' : 'Stop'}</button></p>`;
  } else if (build.state === 'building') {
    body = `<p class="vault-said-line is-building" role="status"><span class="vault-pulse" aria-hidden="true"></span><strong>${from ? `${esc(from)} is building this page` : 'Building'}</strong><span>${esc(build.activity || 'Working')}…</span></p>`;
  } else if (build.outcome) {
    const failed = build.outcome !== 'completed';
    // A page with its own box shows the reply itself; what the build did to
    // the page's automations is Orc's to say.
    if (owned && !failed) {
      if (build.changes?.length && saidAway !== build.endedAt) {
        body = `<div class="vault-said-card">
          <div class="vault-said-text"><ul class="vault-said-changes">${build.changes.map(line => `<li>${esc(line)}</li>`).join('')}</ul></div>
          <button type="button" class="vault-said-away" id="vault-said-away" data-vault-said-away aria-label="Put this away" title="Put this away">×</button>
        </div>`;
      }
    } else if (saidAway !== build.endedAt) {
      body = `<div class="vault-said-card${failed ? ' is-error' : ''}">
        <div class="vault-said-text"><p>${from ? `<span class="vault-tag">${esc(from)}</span> ` : ''}${esc(failed ? buildEndedLine(build) : build.reply || 'Done.')}</p>
        ${build.changes?.length ? `<ul class="vault-said-changes">${build.changes.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}</div>
        <button type="button" class="vault-said-away" id="vault-said-away" data-vault-said-away aria-label="Put this away" title="Put this away">×</button>
      </div>`;
    }
    if (build.denied?.length) {
      body += `<ul class="vault-said-denied" aria-label="Tools this page asked for">${build.denied.map((tool, index) => `<li>
        <span>This page asked to use <strong>${esc(vaultToolLabel(tool))}</strong>, which it is not allowed.</span>
        <button type="button" class="settings-btn-inline" id="vault-allow-${index}" data-vault-allow="${esc(tool)}" ${busy ? 'disabled' : ''}>Allow for this page</button></li>`).join('')}</ul>`;
    }
  }
  return `<div id="vault-said" class="vault-said">${body}${linkAskHtml()}${statusHtml('ask')}</div>`;
}

// A page cannot open a window, so its links wait here for the user's word.
function linkAskHtml() {
  if (!askedLink) return '';
  const label = askedLink.label.length > LINK_LABEL_MAX ? `${askedLink.label.slice(0, LINK_LABEL_MAX - 1)}…` : askedLink.label;
  return `<div class="vault-link-ask" role="group" aria-labelledby="vault-link-text">
    <span id="vault-link-text">Open <strong translate="no" title="${esc(askedLink.href)}">${esc(label)}</strong> from this page?</span>
    <label class="vault-link-always"><input type="checkbox" id="vault-link-always"> Always open links to <span translate="no">${esc(askedLink.host)}</span></label>
    <span class="vault-link-buttons">
      <button type="button" class="settings-btn-inline" id="vault-link-drop" data-vault-link-drop>Not now</button>
      <button type="button" class="settings-btn-inline vault-primary" id="vault-link-open" data-vault-link-open>Open</button>
    </span>
  </div>`;
}

function layoutNow() {
  if (!layout) {
    let stored = null;
    try { stored = localStorage.getItem(layoutKey(detailSlug)); } catch {}
    layout = vaultLayout(stored);
  }
  return layout;
}

// A drag changes the layout as it goes and stores it once it ends.
function saveLayout(change, store = true) {
  layout = vaultLayout({ ...layoutNow(), ...change });
  if (!store) return;
  try { localStorage.setItem(layoutKey(detailSlug), JSON.stringify(layout)); } catch {}
}

const floatId = what => (what === 'dock' ? 'vault-dock' : 'vault-chat');

// Moves what floats without a render, as a drag goes.
function placeFloat(what, at) {
  const el = $(floatId(what));
  if (!el) return;
  el.style.setProperty('--x', at.x);
  el.style.setProperty('--y', at.y);
  if (what === 'dock') {
    el.classList.toggle('is-left', at.x < 0.5);
    el.classList.toggle('is-up', at.y > 0.5);
  }
}

// What the header held, behind one button that floats over the page: the
// way back to the list, the vault's name, proposals waiting, Orc's chat and
// the cog. It opens toward whichever side has room.
function dockHtml() {
  const vault = detail.vault || {};
  const name = vault.name || vault.slug || detailSlug;
  const pending = Array.isArray(detail.proposals) ? detail.proposals.length : 0;
  const at = layoutNow().dock;
  const building = isBuilding();
  const label = `${name} menu${pending ? `, ${vaultPlural(pending, 'proposal')} waiting` : ''}${building ? ', building' : ''}`;
  const menu = dockOpen ? `<div class="vault-dock-menu" id="vault-dock-menu" role="group" aria-labelledby="vault-dock-name">
      <nav class="vault-crumb" aria-label="Breadcrumb"><a href="#vaults">Vaults</a></nav>
      <div class="vault-dock-head">
        ${doorHtml({ ...vault, pending })}
        <div class="vault-dock-text"><p class="vault-dock-name" id="vault-dock-name">${esc(name)}</p>
          <p class="vault-about${vault.about ? '' : ' is-empty'}">${esc(vault.about || 'No description yet')}</p></div>
      </div>
      <div class="vault-dock-actions">
        ${pending ? `<button type="button" class="vault-tag is-gate vault-waiting-open" id="vault-waiting-open" data-vault-cog="proposals"><span class="vault-pulse" aria-hidden="true"></span>${esc(vaultPlural(pending, 'proposal'))} waiting</button>` : ''}
        ${pageHasBox() ? `<button type="button" class="settings-btn-inline" id="vault-orc-box" data-vault-orc-box aria-pressed="${orcBoxShown}" title="This page has its own box. Orc's chat is here should you need it.">${orcBoxShown ? "Hide Orc's chat" : "Orc's chat"}</button>` : ''}
        <button type="button" class="settings-btn-inline vault-cog" id="vault-cog" data-vault-cog aria-expanded="false" aria-controls="vault-settings-panel">${panelIcon('settings')}<span>Settings</span></button>
      </div>
    </div>` : '';
  return `<div class="vault-float vault-dock${at.x < 0.5 ? ' is-left' : ''}${at.y > 0.5 ? ' is-up' : ''}" id="vault-dock" style="--vault-hue:${vaultHue(vault.slug)};--x:${at.x};--y:${at.y}">
    <button type="button" class="vault-dock-btn${building ? ' is-building' : ''}" id="vault-dock-btn" data-vault-dock data-vault-grip="dock" aria-expanded="${dockOpen}" aria-controls="vault-dock-menu" aria-label="${esc(label)}" title="Vault menu. Drag it, or press the arrow keys, to move it.">${COG_ICON}${pending
    ? `<span class="vault-dock-count" aria-hidden="true">${pending}</span>`
    : building ? '<span class="vault-pulse vault-dock-pulse" aria-hidden="true"></span>' : ''}</button>
    <div class="vault-dock-stack">${menu}${chatShown() ? '' : noticesHtml('dock')}</div>
  </div>`;
}

// Orc's chat floats over every vault's page, so a new vault has one from the
// start: the box, and the conversation when asked for. It moves by its
// handle and shrinks to a button, and each vault remembers both. A page that
// holds its own box has it put away until the menu brings it back.
const chatOpen = () => !pageOwnsBox();
const chatShown = () => chatOpen() && !layoutNow().small;

function chatHtml() {
  const { chat, history, small } = layoutNow();
  const building = isBuilding();
  const style = `--x:${chat.x};--y:${chat.y}`;
  if (small) {
    return `<div class="vault-float vault-chat is-small" id="vault-chat" style="${style}">
      <button type="button" class="vault-chat-pill${building ? ' is-building' : ''}" id="vault-chat-grow" data-vault-chat-small="false">${CHAT_ICON}<span>${building ? 'Building…' : 'Chat'}</span>${building ? '<span class="vault-pulse" aria-hidden="true"></span>' : ''}</button>
    </div>`;
  }
  const state = vaultPageState(detail);
  const turns = history ? `<ol class="vault-chat-turns" id="vault-chat-turns" aria-label="The conversation so far">${state.turns.length
    ? state.turns.map(turn => `<li class="vault-chat-turn">
        <p class="vault-chat-asked">${turn.from ? `<span class="vault-tag">${esc(turn.from)}</span> ` : ''}${esc(turn.asked)}</p>
        <p class="vault-chat-reply${turn.failed ? ' is-error' : ''}${turn.pending ? ' is-pending' : ''}">${esc(turn.pending ? `${state.activity}…` : turn.reply)}</p>
      </li>`).join('')
    : '<li class="vault-note">Nothing asked yet. What you ask, and what it answers, shows here.</li>'}</ol>` : '';
  return `<section class="vault-float vault-chat${history ? ' has-history' : ''}" id="vault-chat" style="${style}" aria-labelledby="vault-chat-title">
    <div class="vault-chat-head">
      <button type="button" class="vault-chat-tool vault-chat-grip" id="vault-chat-grip" data-vault-grip="chat" aria-label="Move the chat" title="Drag, or press the arrow keys, to move the chat">${GRIP_ICON}</button>
      <h3 class="vault-chat-title" id="vault-chat-title">Chat</h3>
      <button type="button" class="vault-chat-tool vault-chat-history" id="vault-chat-history" data-vault-chat-history aria-expanded="${history}">${history ? 'Hide conversation' : 'Show conversation'}</button>
      <button type="button" class="vault-chat-tool" id="vault-chat-shrink" data-vault-chat-small="true" aria-label="Shrink the chat" title="Shrink the chat">${SHRINK_ICON}</button>
    </div>
    ${turns}
    ${noticesHtml('chat')}
    ${askHtml()}
  </section>`;
}

function noticesHtml(where) {
  return `${detailError ? `<p class="vault-status is-error" role="status">${esc(detailError)}</p>` : ''}${saidHtml(where)}${statusHtml('page')}`;
}

function detailHtml() {
  const crumb = '<nav class="vault-crumb" aria-label="Breadcrumb"><a href="#vaults">Vaults</a></nav>';
  if (!detail) {
    const fallback = (listData?.vaults || []).find(item => item.slug === detailSlug);
    return `${crumb}<header class="vault-header"><div><h2 id="vaults-title" tabindex="-1">${esc(fallback?.name || detailSlug)}</h2></div></header>
      <p class="vault-note${detailError ? ' is-error' : ''}" role="status">${esc(detailError || 'Loading vault…')}</p>`;
  }
  const vault = detail.vault || {};
  if (fullPage()) {
    return `<h2 id="vaults-title" class="sr-only" tabindex="-1">${esc(vault.name || vault.slug)}</h2>
      ${dockHtml()}
      ${chatOpen() ? chatHtml() : ''}`;
  }
  const pending = Array.isArray(detail.proposals) ? detail.proposals.length : 0;
  return `${crumb}
    <header class="vault-bar" style="--vault-hue:${vaultHue(vault.slug)}">
      ${doorHtml({ ...vault, pending })}
      <div class="vault-bar-text">
        <h2 id="vaults-title" tabindex="-1">${esc(vault.name || vault.slug)}</h2>
        <p class="vault-about${vault.about ? '' : ' is-empty'}">${esc(vault.about || 'No description yet')}</p>
      </div>
      <div class="vault-bar-actions">
        ${pending ? `<button type="button" class="vault-tag is-gate vault-waiting-open" id="vault-waiting-open" data-vault-cog="proposals"><span class="vault-pulse" aria-hidden="true"></span>${esc(vaultPlural(pending, 'proposal'))} waiting</button>` : ''}
        <button type="button" class="settings-btn-inline vault-cog" id="vault-cog" data-vault-cog aria-expanded="true" aria-controls="vault-settings-panel">${COG_ICON}<span>Back to the page</span></button>
      </div>
    </header>
    ${askHtml()}
    ${noticesHtml('cog')}
    <div class="vault-sections" id="vault-settings-panel">
      ${modelHtml()}
      ${automationsHtml()}
      ${toolsHtml()}
      ${historyHtml()}
      ${devicesHtml()}
      ${proposalsHtml()}
      ${soulHtml()}
      ${notesHtml()}
      ${settingsHtml()}
    </div>`;
}

// ---------- The cog ----------

function modelHtml() {
  const settings = detail.settings || {};
  const accounts = Array.isArray(detail.accounts) ? detail.accounts : [];
  const saving = busy === 'model';
  const account = settings.account || accounts[0] || '';
  return `<section class="vault-panel" aria-labelledby="vault-model-title">
    <div class="vault-panel-head">${panelIcon('model')}<h3 id="vault-model-title" tabindex="-1">Model</h3><p>What builds this page, when you ask and when it rebuilds itself.</p></div>
    <div class="vault-model-row">
      <div class="vault-field"><span id="vault-model-label">Model</span><orc-model-picker id="vault-model" floating aria-labelledby="vault-model-label"></orc-model-picker></div>
      <div class="vault-field"><span aria-hidden="true">Effort</span><orc-effort-slider id="vault-effort"></orc-effort-slider></div>
    </div>
    ${accounts.length > 1 ? `<label class="vault-field vault-account" for="vault-account">Claude login
      <select id="vault-account" ${saving ? 'disabled' : ''}>${accounts.map(name => `<option value="${esc(name)}"${name === account ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <p class="vault-note">Connections such as Notion belong to a login, so pick the one that has them.</p>` : ''}
    ${statusHtml('model')}
  </section>`;
}

function automationsHtml() {
  const settings = detail.settings || {};
  const automations = Array.isArray(settings.automations) ? settings.automations : [];
  const disabled = busy === 'automations' ? 'disabled' : '';
  const row = (item, index) => `<li class="vault-automation${item.enabled ? '' : ' is-off'}">
      <div class="vault-automation-text">
        <span class="vault-automation-title" id="vault-automation-${index}">${esc(item.title)}</span>
        <span class="vault-tag">${esc(item.label)}</span>
        <p>${esc(item.do)}</p>
        ${item.lastRun ? `<p class="vault-note">Last ran ${esc(relativeStamp(new Date(item.lastRun)).replace(/^./, first => first.toLowerCase()))}</p>` : ''}
      </div>
      <div class="vault-automation-actions">
        <label class="vault-switch"><input type="checkbox" role="switch" id="vault-automation-on-${index}" data-vault-automation-on="${esc(item.id)}" aria-labelledby="vault-automation-${index}" ${item.enabled ? 'checked' : ''} ${disabled}><span>${item.enabled ? 'On' : 'Off'}</span></label>
        <button type="button" class="settings-btn-inline" id="vault-automation-run-${index}" data-vault-automation-run="${esc(item.id)}" aria-label="${esc(`Run ${item.title} now`)}" ${disabled || isBuilding() ? 'disabled' : ''}>Run now</button>
        <button type="button" class="settings-btn-inline vault-danger" id="vault-automation-delete-${index}" data-vault-automation-delete="${esc(item.id)}" aria-label="${esc(`Delete ${item.title}`)}" ${disabled}>Delete</button>
      </div>
    </li>`;
  return `<section class="vault-panel" aria-labelledby="vault-automations-title">
    <div class="vault-panel-head">${panelIcon('automations')}<h3 id="vault-automations-title" tabindex="-1">Automations</h3><p>What this page does on its own. Add one by asking the page, such as “rebuild this every weekday at 8”.</p></div>
    ${automations.length ? `<ul class="vault-automations">${automations.map(row).join('')}</ul>` : '<p class="vault-note">Nothing yet. This page changes only when you ask.</p>'}
    <label class="vault-switch vault-calendar"><input type="checkbox" role="switch" id="vault-calendar" data-vault-calendar ${settings.calendar ? 'checked' : ''} ${disabled}><span>Give each build my next 24 hours of meetings, from Calendar</span></label>
    ${statusHtml('automations')}
  </section>`;
}

function toolsHtml() {
  const tools = Array.isArray(detail.settings?.tools) ? detail.settings.tools : [];
  const links = Array.isArray(detail.settings?.links) ? detail.settings.links : [];
  const disabled = busy === 'tools' ? 'disabled' : '';
  return `<section class="vault-panel" aria-labelledby="vault-tools-title">
    <div class="vault-panel-head">${panelIcon('tools')}<h3 id="vault-tools-title" tabindex="-1">Allowed tools</h3><p>A build may use what your own Claude may use, with your settings. A web or connection tool it is still refused can be allowed here, and then automations may use it too.</p></div>
    ${tools.length ? `<ul class="vault-tools">${tools.map((tool, index) => `<li><span><strong>${esc(vaultToolLabel(tool))}</strong> <code translate="no">${esc(tool)}</code></span>
      <button type="button" class="settings-btn-inline" id="vault-tool-remove-${index}" data-vault-tool-remove="${esc(tool)}" aria-label="${esc(`Stop allowing ${vaultToolLabel(tool)}`)}" ${disabled}>Remove</button></li>`).join('')}</ul>`
    : '<p class="vault-note">Nothing beyond your own Claude\'s permissions. When a build is refused a tool, an Allow button appears under the box.</p>'}
    ${links.length ? `<h4 class="vault-subhead" id="vault-links-title">Sites its links open without asking</h4>
    <ul class="vault-tools" aria-labelledby="vault-links-title">${links.map((host, index) => `<li><span><strong translate="no">${esc(host)}</strong></span>
      <button type="button" class="settings-btn-inline" id="vault-link-remove-${index}" data-vault-link-remove="${esc(host)}" aria-label="${esc(`Ask before opening links to ${host}`)}" ${disabled}>Remove</button></li>`).join('')}</ul>` : ''}
    ${statusHtml('tools')}
  </section>`;
}

function historyHtml() {
  const history = Array.isArray(detail.history) ? [...detail.history].reverse() : [];
  const snapshots = Number(detail.snapshots) || 0;
  const row = item => {
    const from = vaultBuildSource(item);
    const when = item.at ? relativeStamp(new Date(item.at)) : '';
    return `<li><p class="vault-history-asked">${from ? `<span class="vault-tag">${esc(from)}</span> ` : ''}${esc(item.prompt || '')}</p>
      <p class="vault-history-reply${item.outcome === 'completed' ? '' : ' is-error'}">${esc(item.outcome === 'completed' ? item.reply || 'Done.' : buildEndedLine(item))}</p>
      ${when ? `<p class="vault-note">${esc(when)}</p>` : ''}</li>`;
  };
  return `<section class="vault-panel" aria-labelledby="vault-history-title">
    <div class="vault-panel-head">${panelIcon('history')}<h3 id="vault-history-title" tabindex="-1">History</h3><p>What this page was asked, newest first.</p>
      <button type="button" class="settings-btn-inline" id="vault-undo" data-vault-undo ${snapshots && busy !== 'history' && !isBuilding() ? '' : 'disabled'}>Undo last change</button></div>
    ${history.length ? `<ul class="vault-history">${history.map(row).join('')}</ul>` : '<p class="vault-note">Nothing asked yet.</p>'}
    ${statusHtml('history')}
  </section>`;
}

function proposalsHtml() {
  const pending = Array.isArray(detail.proposals) ? detail.proposals : [];
  const decided = Array.isArray(detail.decided) ? detail.decided : [];
  if (!pending.length && !decided.length) return '';
  const disabled = busy === 'proposals' ? 'disabled' : '';
  const card = (item, index) => `<li class="vault-proposal" style="--vault-i:${index}" aria-labelledby="vault-proposal-${esc(item.id)}">
      <div class="vault-proposal-head"><span class="vault-tag" id="vault-proposal-${esc(item.id)}">Adds to <span translate="no">${esc(item.file)}</span></span>
        ${item.runId ? `<span class="vault-proposal-source">From run <a href="#${encodeURIComponent(item.runId)}" translate="no">${esc(item.runId)}</a></span>` : ''}</div>
      <div class="md vault-md vault-proposal-text">${markdownHtml(item.text || '')}</div>
      ${item.reason ? `<p class="vault-proposal-reason"><span class="sr-only">Reason: </span>${esc(item.reason)}</p>` : ''}
      <div class="vault-proposal-actions">
        <button type="button" class="settings-btn-inline vault-primary" id="vault-approve-${esc(item.id)}" data-vault-decide="approve" data-proposal="${esc(item.id)}" aria-label="${esc(`Approve entry for ${item.file}`)}" ${disabled}>Approve</button>
        <button type="button" class="settings-btn-inline" id="vault-dismiss-${esc(item.id)}" data-vault-decide="dismiss" data-proposal="${esc(item.id)}" aria-label="${esc(`Dismiss entry for ${item.file}`)}" ${disabled}>Dismiss</button>
      </div>
    </li>`;
  return `<section class="vault-panel vault-proposals${pending.length ? ' is-waiting' : ''}" aria-labelledby="vault-proposals-title">
    <div class="vault-panel-head">${panelIcon('proposals')}<h3 id="vault-proposals-title" tabindex="-1">Proposals</h3><p>Entries agents want to add. Nothing changes until you approve one; then it joins the note and the page.</p></div>
    ${pending.length ? `<ul class="vault-proposal-list">${pending.map(card).join('')}</ul>` : '<p class="vault-note">No proposals waiting.</p>'}
    ${decided.length ? `<orc-accordion class="vault-decided" label="Decided (${decided.length})"><ul>${decided.map(item => `<li><span class="vault-tag${item.status === 'approved' ? ' is-ok' : ''}">${item.status === 'approved' ? 'Approved' : 'Dismissed'}</span> <span translate="no">${esc(item.file)}</span>: ${esc(String(item.text || '').slice(0, 140))}</li>`).join('')}</ul></orc-accordion>` : ''}
    ${statusHtml('proposals')}
  </section>`;
}

function soulHtml() {
  const text = soulDraft ?? detail.soul?.text ?? '';
  const saving = busy === 'soul';
  const bytes = vaultByteLength(text);
  const over = bytes > VAULT_SOUL_LIMIT;
  const body = soulEditing
    ? `<textarea id="vault-soul" class="vault-text" rows="14" aria-labelledby="vault-soul-title" aria-describedby="vault-soul-count vault-soul-status" spellcheck="true" ${saving ? 'disabled' : ''}>${esc(text)}</textarea>
      <div class="vault-panel-foot">
        <span id="vault-soul-count" class="vault-count${over ? ' is-over' : ''}" aria-live="off">${esc(vaultCountLabel(bytes, VAULT_SOUL_LIMIT))}</span>
        <button type="button" class="settings-btn-inline vault-primary" id="vault-soul-save" data-vault-save-soul ${saving || over || soulDraft === null ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save soul'}</button>
      </div>`
    : text.trim() ? `<div class="md vault-md vault-soul">${markdownHtml(text)}</div>` : '<p class="vault-note">This vault has no soul yet. Edit it to say what the vault is for.</p>';
  return `<section class="vault-panel vault-soul-panel" aria-labelledby="vault-soul-title">
    <div class="vault-panel-head">${panelIcon('soul')}<h3 id="vault-soul-title">Soul</h3><p>What this vault is for, what belongs in it and how agents use it. Every build reads it, and only you change it.</p>
      <button type="button" class="settings-btn-inline" id="vault-soul-toggle" data-vault-soul-toggle aria-pressed="${soulEditing}" ${saving ? 'disabled' : ''}>${soulEditing ? 'Preview' : 'Edit'}</button></div>
    ${body}
    ${statusHtml('soul')}
  </section>`;
}

function noteEditorHtml() {
  const note = openNote;
  const text = noteDraft ?? note.text ?? '';
  const saving = busy === 'note';
  const bytes = vaultByteLength(text);
  const over = bytes > VAULT_NOTE_LIMIT;
  const disabled = saving ? 'disabled' : '';
  const actions = noteConfirmDelete
    ? `<span class="vault-confirm" role="group" aria-labelledby="vault-note-confirm-text"><span id="vault-note-confirm-text">Move ${esc(note.path)} to the vault's trash?</span>
        <button type="button" class="settings-btn-inline" id="vault-note-keep" data-vault-note-keep ${disabled}>Keep</button>
        <button type="button" class="settings-btn-inline vault-danger" id="vault-note-delete-confirm" data-vault-note-delete-confirm ${disabled}>Delete note</button></span>`
    : `<span class="vault-editor-buttons">
        <button type="button" class="settings-btn-inline" id="vault-note-close" data-vault-note-close ${disabled}>Close</button>
        <button type="button" class="settings-btn-inline" id="vault-note-delete" data-vault-note-delete ${disabled}>Delete</button>
        <button type="button" class="settings-btn-inline vault-primary" id="vault-note-save" data-vault-note-save ${saving || over || noteDraft === null ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save'}</button></span>`;
  return `<div class="vault-editor" id="vault-note-editor">
    <textarea id="vault-note-text" class="vault-text" rows="14" aria-label="${esc(`Text of ${note.path}`)}" aria-describedby="vault-note-count vault-note-status" spellcheck="true" ${disabled}>${esc(text)}</textarea>
    <div class="vault-panel-foot">
      <span id="vault-note-count" class="vault-count${over ? ' is-over' : ''}" aria-live="off">${esc(vaultCountLabel(bytes, VAULT_NOTE_LIMIT))}</span>
      ${actions}
    </div>
    ${statusHtml('note')}
  </div>`;
}

function notesHtml() {
  const notes = Array.isArray(detail.notes) ? detail.notes : [];
  const creating = busy === 'new-note';
  const shownOpen = openNote && notes.some(note => note.path === openNote.path);
  const largest = Math.max(0, ...notes.map(note => Number(note.size) || 0));
  const row = (note, index) => {
    const isOpen = openNote?.path === note.path;
    return `<li class="vault-note-row${isOpen ? ' is-open' : ''}${freshNote === note.path ? ' is-fresh' : ''}">
      <button type="button" class="vault-note-open" id="vault-note-${index}" data-vault-note="${esc(note.path)}" aria-expanded="${isOpen}"${isOpen ? ' aria-controls="vault-note-editor"' : ''}>
        <span class="vault-note-path" translate="no">${esc(note.path)}</span>
        <span class="vault-note-meter" aria-hidden="true"><span style="width:${vaultMeterPercent(note.size, largest)}%"></span></span>
        <span class="vault-note-facts">${esc(vaultSizeLabel(note.size))} · ${esc(formatDate(note.mtime))}</span>
      </button>
      ${noteLoading === note.path ? '<p class="vault-note" role="status">Opening…</p>' : ''}
      ${isOpen ? noteEditorHtml() : ''}
    </li>`;
  };
  return `<section class="vault-panel" aria-labelledby="vault-notes-title">
    <div class="vault-panel-head">${panelIcon('notes')}<h3 id="vault-notes-title" tabindex="-1">Notes</h3><p>The page's content as plain text, newest first. Agents read them from the end, where new entries land.</p></div>
    ${notes.length ? `<ul class="vault-notes">${notes.map(row).join('')}</ul>` : '<p class="vault-note">No notes yet.</p>'}
    ${openNote && !shownOpen ? `<div class="vault-note-row is-open"><p class="vault-note-path" translate="no">${esc(openNote.path)}</p>${noteEditorHtml()}</div>` : ''}
    <form class="vault-new-note" data-vault-new-note>
      <label class="vault-field" for="vault-new-note-path">New note</label>
      <div class="vault-inline">
        <input id="vault-new-note-path" name="path" type="text" maxlength="240" autocomplete="off" spellcheck="false" placeholder="ideas.md" value="${esc(newNoteDraft)}" aria-describedby="vault-new-note-status" ${creating ? 'disabled' : ''}>
        <button type="submit" class="settings-btn-inline" id="vault-new-note-create" ${creating ? 'disabled' : ''}>${creating ? 'Creating…' : 'Create'}</button>
      </div>
    </form>
    ${statusHtml('new-note')}
  </section>`;
}

// A QR code of the vault's phone address, or '' when it cannot be drawn.
function qrDataUrl(text) {
  try {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    return code.createDataURL(5, 16);
  } catch {
    return '';
  }
}

// The vault's own app on a phone: Orc's Tailscale address for it, which a
// phone adds to its home screen.
function devicesHtml() {
  const link = vaultPermalink(detail.phoneUrl, detailSlug);
  const qr = link ? qrDataUrl(link) : '';
  return `<section class="vault-panel" aria-labelledby="vault-devices-title">
    <div class="vault-panel-head">${panelIcon('devices')}<h3 id="vault-devices-title">Other devices</h3></div>
    ${link ? `<div class="vault-phone">
      ${qr ? `<img class="vault-phone-qr" id="vault-phone-qr" src="${esc(qr)}" alt="Scan to open this vault on your phone">` : ''}
      <div class="vault-phone-text">
        <p class="vault-note">Open this address on your phone with Tailscale on, then add it to the home screen. It opens this vault on its own, and what you add there is on this Mac at once.</p>
        <p class="vault-phone-link"><a href="${esc(link)}" id="vault-phone-link" target="_blank" rel="noopener" translate="no">${esc(link)}</a><orc-copy-button variant="ghost" size="compact" value="${esc(link)}">Copy</orc-copy-button></p>
        <p class="vault-note">This Mac has to be awake, online and on Tailscale for the phone to reach it.</p>
      </div>
    </div>` : `<p class="vault-note" id="vault-phone-off">To open this vault on your phone, turn on <strong>Phone access</strong> in Settings › Devices › Tailscale. This vault then gets an address of its own here.</p>`}
    ${syncHtml()}
  </section>`;
}

function syncLine(sync) {
  if (sync.error) return { text: sync.redeploy ? sync.error : `The last sync failed: ${sync.error}`, tone: 'error' };
  if (!sync.lastSync) return { text: 'Syncs within a minute.', tone: '' };
  const when = new Date(sync.lastSync);
  return { text: Number.isNaN(when.getTime()) ? 'Synced.' : `Synced ${relativeStamp(when)}.`, tone: '' };
}

// Keeping the vault the same on the user's other Macs, through their own
// Cloudflare Worker. Its page reaches them too; its automations do not.
function syncHtml() {
  const sync = detail.sync || {};
  const disabled = busy ? 'disabled' : '';
  if (!sync.available) {
    return `<h4 class="vault-subhead" id="vault-sync-title">Your other Macs</h4>
      <p class="vault-note" id="vault-sync-off">To keep this vault the same on your other Macs, set up your Cloudflare Worker first: sign this Mac in with GitHub in Settings › Account, or follow <code translate="no">cloud/project-memory/README.md</code>.</p>`;
  }
  const line = sync.enabled ? syncLine(sync) : null;
  const large = sync.enabled ? sync.tooLarge || [] : [];
  return `<h4 class="vault-subhead" id="vault-sync-title">Your other Macs</h4>
    <label class="vault-switch"><input type="checkbox" role="switch" id="vault-sync" data-vault-sync aria-describedby="vault-sync-about" ${sync.enabled ? 'checked' : ''} ${disabled}><span>Keep this vault the same on my other Macs</span></label>
    <p class="vault-note" id="vault-sync-about">Through your Cloudflare Worker. Its soul, page brief, notes and page sync, and a Mac signed in to the same Worker gets the vault by itself. Automations, allowed tools and entries waiting stay on each Mac, and deleting the vault here deletes it on all of them.</p>
    ${line ? `<p class="vault-note${line.tone ? ' is-error' : ''}" id="vault-sync-line">${esc(line.text)}</p>` : ''}
    ${large.length ? `<p class="vault-note" id="vault-sync-large">Kept on this Mac only, as too large to sync or named in a way the Worker refuses: ${large.map(path => `<code translate="no">${esc(path)}</code>`).join(', ')}.</p>` : ''}
    ${!sync.enabled && (sync.remote || syncJoin) ? `<div class="vault-inline vault-sync-join">
      <span class="vault-note">A vault called <code translate="no">${esc(detailSlug)}</code> already syncs from another Mac. Joining merges the two, note by note.</span>
      <button type="button" class="settings-btn-inline" id="vault-sync-join" data-vault-sync-join ${disabled}>Join it</button>
    </div>` : ''}
    ${statusHtml('sync')}`;
}

function setSync(enabled, join = false) {
  return mutate('sync', `${vaultUrl(detailSlug)}/sync`, { enabled, join }, {
    saved: enabled ? (join ? 'Joined. The two merge within a minute.' : 'This vault now syncs.') : 'This vault no longer syncs. Every copy stays where it is.',
    apply: (result, failed) => {
      if (failed) {
        syncJoin = result.data.code === 'remote_exists';
        return false;
      }
      syncJoin = false;
      return taken(result, failed);
    },
  });
}

function settingsHtml() {
  const vault = detail.vault || {};
  const saving = busy === 'settings';
  return `<section class="vault-panel" aria-labelledby="vault-settings-title">
    <div class="vault-panel-head">${panelIcon('settings')}<h3 id="vault-settings-title">Settings</h3></div>
    <form class="vault-settings" data-vault-rename>
      <label class="vault-field" for="vault-rename">Name</label>
      <div class="vault-inline">
        <input id="vault-rename" name="name" type="text" maxlength="60" autocomplete="off" value="${esc(renameDraft ?? vault.name ?? '')}" required ${saving ? 'disabled' : ''}>
        <button type="submit" class="settings-btn-inline vault-primary" id="vault-rename-save" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save name'}</button>
      </div>
    </form>
    <p class="vault-note">Its folder: <code translate="no">${esc(vault.path || '')}</code></p>
    <div class="vault-panel-foot vault-delete-row">
      <span class="vault-note">Deleting moves the vault, its page and its notes to <code translate="no">${esc(TRASH_PATH)}</code>.</span>
      <button type="button" class="settings-btn-inline vault-danger" id="vault-delete-open" data-vault-delete-open ${saving ? 'disabled' : ''}>Delete vault</button>
    </div>
    ${statusHtml('settings')}
  </section>`;
}

// ---------- Changes ----------

// Focus stays on the control that started the change through the re-render.
async function mutate(section, url, body, { saved, apply }) {
  if (busy || !detailSlug) return null;
  const slug = detailSlug;
  keepFocus = document.activeElement?.id || '';
  busy = section;
  setStatus(section, 'Saving…');
  render();
  const result = await request(url, body);
  busy = '';
  if (slug !== detailSlug || !active) return null;
  // A poll that left before this did must not put the older answer back,
  // and the next one is timed by what this answer says.
  detailRequest++;
  if (!result.ok) {
    const handled = apply?.(result, true);
    if (!handled) {
      const message = result.data.error || 'Could not save. Try again.';
      setStatus(section, message, 'error');
      announce(message);
    }
    render();
    schedulePoll();
    return null;
  }
  const refetch = apply?.(result, false) === 'refetch';
  setStatus(section, saved, 'ok');
  announce(saved);
  render();
  if (refetch) loadDetail(slug);
  else schedulePoll();
  return result.data;
}

// ---------- Building ----------

// Starts a build of `prompt`, from Orc's box or the page's own. Returns the
// error to show, or '' once it started.
async function startBuild(prompt) {
  const slug = detailSlug;
  busy = 'ask';
  delete sectionStatus.ask;
  render();
  const result = await request(`${vaultUrl(slug)}/build`, { prompt });
  busy = '';
  if (slug !== detailSlug || !active) return 'The vault was closed.';
  // A poll that left before this did must not put the older answer back.
  detailRequest++;
  if (result.ok && result.data.vault) {
    detail = result.data;
    cogOpen = false;
    announce('Building the page.');
    return '';
  }
  const message = result.data.error || 'Could not start the build. Try again.';
  sectionStatus.ask = { text: message, tone: 'error' };
  announce(message);
  loadDetail(slug);
  return message;
}

async function ask() {
  if (busy || !detailSlug || isBuilding()) return;
  const prompt = askDraft.trim();
  if (!prompt) {
    setStatus('ask', 'Say what to build first.', 'error');
    boxOrButton()?.focus();
    return;
  }
  keepFocus = 'vault-ask-text';
  const failed = await startBuild(prompt);
  if (!failed) askDraft = '';
  keepFocus = 'vault-ask-text';
  render();
  if (!failed) schedulePoll();
}

async function stopBuild() {
  if (busy || !detailSlug) return;
  const slug = detailSlug;
  busy = 'stop';
  render();
  const result = await request(`${vaultUrl(slug)}/stop`, {});
  busy = '';
  if (slug !== detailSlug || !active) return;
  detailRequest++;
  if (result.ok && result.data.vault) detail = result.data;
  else sectionStatus.ask = { text: result.data.error || 'Could not stop the build. Try again.', tone: 'error' };
  keepFocus = 'vault-ask-text';
  render();
  schedulePoll();
}

function taken(result, failed) {
  if (failed) return false;
  detail = result.data;
  return null;
}

function saveSettings(data, section, saved) {
  return mutate(section, `${vaultUrl(detailSlug)}/settings`, data, { saved, apply: taken });
}

function chooseModel(picker) {
  const choice = picker.choice;
  if ((choice.agent || 'claude') !== 'claude') {
    setStatus('model', "A vault's page builds with a Claude model.", 'error');
    syncControls();
    return;
  }
  const model = choice.model || picker.value;
  if (!model || model === detail?.settings?.model) return;
  const effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(choice.effort) ? { effort: choice.effort } : {};
  saveSettings({ model, ...effort }, 'model', 'Model saved.');
}

function allowTool(tool, allowed) {
  const label = vaultToolLabel(tool);
  // Allow sits under the box; Remove sits in the cog.
  return mutate(allowed ? 'ask' : 'tools', `${vaultUrl(detailSlug)}/tools`, { tool, allowed }, {
    saved: allowed ? `Allowed ${label}. Ask again and the page can use it.` : `Stopped allowing ${label}.`, apply: taken,
  });
}

const trustsLink = host => vaultTrustsLink(host, detail?.settings?.links);

function openLink(link) {
  window.open(link.href, '_blank', 'noopener,noreferrer');
}

// The page's own script could send this without a click, so a link opens at
// once only for a site the user chose and while a click is fresh; any other
// waits under the box for Open.
function onPageMessage(event) {
  if (!active || !detailSlug || !detail) return;
  const fromPage = pageWindows().includes(event.source);
  if (!fromPage) return;
  const asked = vaultPageRequest(event.data);
  if (asked) {
    answerPage(asked, event.source);
    return;
  }
  const link = vaultLink(event.data?.orcVaultLink, location.origin);
  if (!link) return;
  if (trustsLink(link.host) && navigator.userActivation?.isActive) {
    openLink(link);
    return;
  }
  askedLink = link;
  render();
  announce(`This page asks to open ${link.label}. Press Open under the box to follow it.`);
}

// The page's own window, one frame inside each of the stage's frames.
function pageWindows() {
  return [...document.querySelectorAll('#vault-stage .vault-frame')].map(frame => {
    try { return frame.contentWindow?.[0] || null; } catch { return null; }
  }).filter(Boolean);
}

function tellPage(target, error = '') {
  try { target.postMessage({ orcVaultState: vaultPageState(detail, error) }, '*'); } catch {}
}

function tellPages() {
  if (!detailSlug || !detail?.vault?.page?.exists) {
    pageToldAs = '';
    return;
  }
  const told = JSON.stringify(vaultPageState(detail));
  if (told === pageToldAs) return;
  pageToldAs = told;
  for (const target of pageWindows()) tellPage(target);
}

// A page's own box builds as Orc's does. Its script could send an ask with
// nobody there, so one goes through only while a click or key of the
// user's is fresh, and Orc names what is building above the page.
async function answerPage(asked, source) {
  const now = performance.now();
  if (asked.ready) {
    pageShownAt.set(source, now);
    tellPage(source);
    return;
  }
  if (!vaultPageGesture({ active: navigator.userActivation?.isActive, sinceOrcInput: now - orcInputAt, sinceShown: now - (pageShownAt.get(source) ?? now) })) {
    tellPage(source, 'Orc builds what this page sends only straight after you press a button or a key in it. Try it again.');
    return;
  }
  if (asked.stop) {
    if (isBuilding()) stopBuild();
    return;
  }
  if (busy || isBuilding()) {
    tellPage(source, 'The page is already building. Wait for it to finish, or stop it.');
    return;
  }
  const failed = await startBuild(asked.ask);
  render();
  if (failed) tellPage(source, failed);
  else schedulePoll();
}

async function answerLink(open) {
  const link = askedLink;
  const always = $('vault-link-always')?.checked;
  askedLink = null;
  if (!link) return;
  if (open) openLink(link);
  render();
  boxOrButton()?.focus();
  if (open && always) {
    await mutate('ask', `${vaultUrl(detailSlug)}/links`, { host: link.host, allowed: true }, {
      saved: `Links to ${link.host} open from this page without asking.`, apply: taken });
  }
}

function changeAutomation(id, body, saved) {
  return mutate('automations', `${vaultUrl(detailSlug)}/automations/${encodeURIComponent(id)}`, body, { saved, apply: taken });
}

async function runAutomation(id) {
  const done = await changeAutomation(id, { run: true }, 'Started.');
  if (!done) return;
  cogOpen = false;
  render();
  schedulePoll();
  boxOrButton()?.focus();
}

async function undo() {
  const done = await mutate('history', `${vaultUrl(detailSlug)}/undo`, {}, { saved: 'Put the page back as it was.', apply: taken });
  if (done) $('vault-history-title')?.focus();
}

function openCog(section) {
  cogOpen = section ? true : !cogOpen;
  dockOpen = false;
  render();
  if (cogOpen && section) $(`vault-${section}-title`)?.focus();
  else ($('vault-cog') || $('vault-dock-btn'))?.focus();
  if (cogOpen) $('vaults-view').scrollTop = 0;
}

function useStarter(id) {
  const template = (listData?.templates || []).find(item => item.id === id);
  if (!template?.starter) return;
  askDraft = template.starter;
  keepFocus = 'vault-ask-text';
  render();
  const box = $('vault-ask-text');
  box?.focus();
  box?.setSelectionRange(box.value.length, box.value.length);
}

async function saveSoul() {
  const text = soulDraft ?? '';
  if (vaultByteLength(text) > VAULT_SOUL_LIMIT) {
    setStatus('soul', `The soul is limited to ${VAULT_SOUL_LIMIT.toLocaleString('en-US')} bytes.`, 'error');
    return;
  }
  const baseMtime = soulBase !== undefined ? soulBase : detail?.soul?.mtime ?? null;
  const done = await mutate('soul', `${vaultUrl(detailSlug)}/soul`, { text, baseMtime }, {
    saved: 'Soul saved.',
    apply: (result, failed) => {
      if (failed) {
        if (result.data.code !== 'stale') return false;
        soulStale = result.data.current || null;
        setStatus('soul', 'The soul changed since you opened it.', 'error', true);
        announce('The soul changed since you opened it.');
        return true;
      }
      detail = result.data;
      soulDraft = null;
      soulBase = undefined;
      soulStale = null;
      soulEditing = false;
      return null;
    },
  });
  if (done) $('vault-soul-toggle')?.focus();
}

function reloadSoul() {
  if (!detail || !soulStale) return;
  detail = { ...detail, soul: { text: soulStale.text ?? '', mtime: soulStale.mtime ?? null } };
  soulDraft = null;
  soulBase = undefined;
  soulStale = null;
  setStatus('soul', 'Loaded the latest soul.', 'ok');
  announce('Loaded the latest soul.');
  render();
  (soulEditing ? $('vault-soul') : $('vault-soul-toggle'))?.focus();
}

async function openNoteAt(path) {
  if (openNote?.path === path) {
    closeNote();
    return;
  }
  if (noteDraft !== null && openNote && !confirm(`Discard your changes to ${openNote.path}?`)) return;
  const slug = detailSlug;
  noteLoading = path;
  render();
  const result = await request(vaultNoteUrl(slug, path));
  if (slug !== detailSlug || noteLoading !== path) return;
  noteLoading = '';
  if (!result.ok || !result.data.note) {
    const message = result.data.error || `Could not open ${path}. Try again.`;
    setStatus('new-note', message, 'error');
    announce(message);
    render();
    return;
  }
  showNote(result.data.note);
  $('vault-note-text')?.focus();
}

function showNote(note) {
  openNote = note;
  noteDraft = null;
  noteStale = null;
  noteConfirmDelete = false;
  delete sectionStatus.note;
  render();
}

function closeNote() {
  if (noteDraft !== null && openNote && !confirm(`Discard your changes to ${openNote.path}?`)) return;
  const path = openNote?.path;
  openNote = null;
  noteDraft = null;
  noteStale = null;
  noteConfirmDelete = false;
  delete sectionStatus.note;
  render();
  const button = [...document.querySelectorAll('#vaults-view [data-vault-note]')].find(el => el.dataset.vaultNote === path);
  (button || $('vault-notes-title'))?.focus();
}

async function saveNote() {
  if (!openNote) return;
  const text = noteDraft ?? '';
  if (vaultByteLength(text) > VAULT_NOTE_LIMIT) {
    setStatus('note', `A note is limited to ${VAULT_NOTE_LIMIT.toLocaleString('en-US')} bytes.`, 'error');
    return;
  }
  const path = openNote.path;
  await mutate('note', vaultNoteUrl(detailSlug, path), { text, baseMtime: openNote.mtime }, {
    saved: `Saved ${path}.`,
    apply: (result, failed) => {
      if (failed) {
        if (result.data.code !== 'stale') return false;
        noteStale = result.data.current || null;
        const message = `${path} changed since you opened it.`;
        setStatus('note', message, 'error', true);
        announce(message);
        return true;
      }
      openNote = result.data.note || openNote;
      noteDraft = null;
      noteStale = null;
      // Save stays disabled until the next edit, so focus returns to the text.
      keepFocus = 'vault-note-text';
      return 'refetch';
    },
  });
}

function reloadNote() {
  if (!openNote || !noteStale) return;
  const path = openNote.path;
  showNote(noteStale);
  setStatus('note', `Loaded the latest ${path}.`, 'ok');
  announce(`Loaded the latest ${path}.`);
  render();
  $('vault-note-text')?.focus();
}

async function deleteNote() {
  if (!openNote) return;
  const path = openNote.path;
  const done = await mutate('note', `${vaultNoteUrl(detailSlug, path)}/delete`, {}, {
    saved: `Moved ${path} to the vault's trash.`,
    apply: (result, failed) => {
      if (failed) return false;
      detail = result.data;
      openNote = null;
      noteDraft = null;
      noteConfirmDelete = false;
      return null;
    },
  });
  if (done) {
    sectionStatus['new-note'] = { ...sectionStatus.note };
    delete sectionStatus.note;
    render();
    const heading = $('vault-notes-title');
    heading?.focus();
  }
}

async function createNote(form) {
  const path = vaultNotePath(new FormData(form).get('path'));
  if (!path) {
    setStatus('new-note', 'Name the note first, such as ideas.md.', 'error');
    $('vault-new-note-path')?.focus();
    return;
  }
  if (noteDraft !== null && openNote && !confirm(`Discard your changes to ${openNote.path}?`)) return;
  const done = await mutate('new-note', `${vaultUrl(detailSlug)}/notes`, { path, text: '' }, {
    saved: `Created ${path}.`,
    apply: (result, failed) => {
      if (failed) return false;
      newNoteDraft = '';
      openNote = result.data.note;
      noteDraft = null;
      noteStale = null;
      noteConfirmDelete = false;
      delete sectionStatus.note;
      keepFocus = 'vault-note-text';
      return 'refetch';
    },
  });
  if (done) $('vault-note-text')?.focus();
}

// The note an approved entry landed in glows once. Later renders inside the
// window keep the class, so the timer rather than a render ends it.
function markFresh(path) {
  freshNote = path;
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => {
    freshNote = '';
    document.querySelector('#vaults-view .vault-note-row.is-fresh')?.classList.remove('is-fresh');
  }, FRESH_MS);
}

async function decide(button) {
  const approve = button.dataset.vaultDecide === 'approve';
  const id = button.dataset.proposal;
  const proposal = (detail?.proposals || []).find(item => item.id === id);
  const done = await mutate('proposals', `${vaultUrl(detailSlug)}/proposals/${encodeURIComponent(id)}/${approve ? 'approve' : 'dismiss'}`, {}, {
    saved: approve ? `Added to ${proposal?.file || 'the note'}.` : 'Proposal dismissed.',
    apply: (result, failed) => {
      if (failed) {
        if (result.status === 409 || result.status === 404) loadDetail(detailSlug);
        return false;
      }
      const { proposal: _decided, ...next } = result.data;
      detail = next;
      if (approve && proposal?.file) markFresh(proposal.file);
      followOpenNote();
      return null;
    },
  });
  if (!done) return;
  const next = document.querySelector('#vaults-view [data-vault-decide]');
  (next || $('vault-proposals-title'))?.focus();
}

async function rename(form) {
  const name = String(new FormData(form).get('name') || '').trim();
  if (!name) {
    setStatus('settings', 'A vault needs a name.', 'error');
    return;
  }
  await mutate('settings', vaultUrl(detailSlug), { name }, {
    saved: 'Name saved.',
    apply: (result, failed) => {
      if (failed) return false;
      detail = result.data;
      renameDraft = null;
      if (listData) listData = { ...listData, vaults: (listData.vaults || []).map(item => (item.slug === detail.vault.slug ? detail.vault : item)) };
      return null;
    },
  });
}

function openDeleteDialog() {
  const dialog = $('vault-delete-dialog');
  if (!dialog || !detail) return;
  const name = detail.vault?.name || detailSlug;
  $('vault-delete-title').textContent = `Delete ${name}?`;
  $('vault-delete-text').innerHTML = `${esc(name)}, its page and its notes move to <code translate="no">${esc(TRASH_PATH)}</code>, where you can fetch them back. Its automations stop, and agents stop reading it.`;
  const status = $('vault-delete-status');
  status.textContent = '';
  status.className = 'vault-status';
  $('vault-delete-confirm').disabled = false;
  dialog.showModal();
  dialog.querySelector('[data-vault-delete-cancel]')?.focus();
}

async function deleteVault() {
  const slug = detailSlug;
  const name = detail?.vault?.name || slug;
  const status = $('vault-delete-status');
  const submit = $('vault-delete-confirm');
  submit.disabled = true;
  status.className = 'vault-status';
  status.textContent = 'Deleting…';
  const result = await request(`${vaultUrl(slug)}/delete`, { confirm: true });
  submit.disabled = false;
  if (!result.ok) {
    status.textContent = result.data.error || 'Could not delete the vault. Try again.';
    status.classList.add('is-error');
    announce(status.textContent);
    return;
  }
  $('vault-delete-dialog')?.close();
  if (listData && Array.isArray(result.data.vaults)) listData = { ...listData, vaults: result.data.vaults };
  sectionStatus.list = { text: `Moved ${name} to ${TRASH_PATH}.`, tone: 'ok' };
  announce(`Moved ${name} to the trash.`);
  location.hash = 'vaults';
}

// ---------- Events ----------

function onClick(event) {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.dataset.vaultNew !== undefined) openNewDialog(target.dataset.vaultNew || undefined);
  else if (target.dataset.vaultCog !== undefined) openCog(target.dataset.vaultCog);
  else if (dragged && target.dataset.vaultGrip) dragged = false;
  else if (target.matches('[data-vault-dock]')) {
    dockOpen = !dockOpen;
    keepFocus = 'vault-dock-btn';
    render();
  } else if (target.matches('[data-vault-chat-history]')) {
    saveLayout({ history: !layoutNow().history });
    keepFocus = 'vault-chat-history';
    render();
  } else if (target.dataset.vaultChatSmall) {
    // The pressed button goes with the render, so focus moves on by hand.
    const small = target.dataset.vaultChatSmall === 'true';
    saveLayout({ small });
    render();
    $(small ? 'vault-chat-grow' : 'vault-ask-text')?.focus();
  }
  else if (target.matches('[data-vault-stop]')) stopBuild();
  else if (target.matches('[data-vault-sync-join]')) setSync(true, true);
  else if (target.matches('[data-vault-orc-box]')) {
    orcBoxShown = !orcBoxShown;
    dockOpen = false;
    if (orcBoxShown) saveLayout({ small: false });
    render();
    $(orcBoxShown ? 'vault-ask-text' : 'vault-dock-btn')?.focus();
  }
  else if (target.matches('[data-vault-said-away]')) {
    saidAway = detail?.build?.endedAt || '';
    render();
    boxOrButton()?.focus();
  }
  else if (target.dataset.vaultAllow) allowTool(target.dataset.vaultAllow, true);
  else if (target.dataset.vaultToolRemove) allowTool(target.dataset.vaultToolRemove, false);
  else if (target.matches('[data-vault-link-open]')) answerLink(true);
  else if (target.matches('[data-vault-link-drop]')) answerLink(false);
  else if (target.dataset.vaultLinkRemove) {
    const host = target.dataset.vaultLinkRemove;
    mutate('tools', `${vaultUrl(detailSlug)}/links`, { host, allowed: false }, { saved: `Links to ${host} ask first again.`, apply: taken });
  }
  else if (target.dataset.vaultAutomationRun) runAutomation(target.dataset.vaultAutomationRun);
  else if (target.dataset.vaultAutomationDelete) changeAutomation(target.dataset.vaultAutomationDelete, { delete: true }, 'Automation deleted.');
  else if (target.matches('[data-vault-undo]')) undo();
  else if (target.dataset.vaultStarter) useStarter(target.dataset.vaultStarter);
  else if (target.matches('[data-vault-new-cancel]')) {
    $('vault-new-dialog')?.close();
    $('vault-new-open')?.focus();
  } else if (target.matches('[data-vault-soul-toggle]')) {
    soulEditing = !soulEditing;
    render();
    (soulEditing ? $('vault-soul') : $('vault-soul-toggle'))?.focus();
  } else if (target.matches('[data-vault-save-soul]')) saveSoul();
  else if (target.dataset.vaultReload === 'soul') reloadSoul();
  else if (target.dataset.vaultReload === 'note') reloadNote();
  else if (target.dataset.vaultNote !== undefined) openNoteAt(target.dataset.vaultNote);
  else if (target.matches('[data-vault-note-close]')) closeNote();
  else if (target.matches('[data-vault-note-save]')) saveNote();
  else if (target.matches('[data-vault-note-delete]')) {
    noteConfirmDelete = true;
    render();
    $('vault-note-keep')?.focus();
  } else if (target.matches('[data-vault-note-keep]')) {
    noteConfirmDelete = false;
    render();
    $('vault-note-delete')?.focus();
  } else if (target.matches('[data-vault-note-delete-confirm]')) deleteNote();
  else if (target.dataset.vaultDecide) decide(target);
  else if (target.matches('[data-vault-delete-open]')) openDeleteDialog();
  else if (target.matches('[data-vault-delete-cancel]')) {
    $('vault-delete-dialog')?.close();
    $('vault-delete-open')?.focus();
  }
}

function onInput(event) {
  const target = event.target;
  if (target.id === 'vault-ask-text') {
    askDraft = target.value;
    growAsk();
  } else if (target.id === 'vault-new-prompt') {
    newPromptTouched = target.value.trim() !== '';
  } else if (target.id === 'vault-soul') {
    if (soulDraft === null) soulBase = detail?.soul?.mtime ?? null;
    soulDraft = target.value;
    updateCount('vault-soul-count', 'vault-soul-save', target.value, VAULT_SOUL_LIMIT);
  } else if (target.id === 'vault-note-text') {
    noteDraft = target.value;
    updateCount('vault-note-count', 'vault-note-save', target.value, VAULT_NOTE_LIMIT);
  } else if (target.id === 'vault-new-note-path') {
    newNoteDraft = target.value;
  } else if (target.id === 'vault-rename') {
    renameDraft = target.value;
  } else if (target.id === 'vault-new-name') {
    nameTouched = target.value.trim() !== '';
  }
}

function updateCount(countId, saveId, text, limit) {
  const bytes = vaultByteLength(text);
  const over = bytes > limit;
  const count = $(countId);
  if (count) {
    count.textContent = vaultCountLabel(bytes, limit);
    count.classList.toggle('is-over', over);
  }
  const save = $(saveId);
  if (save) save.disabled = over || !!busy;
}

function onChange(event) {
  const target = event.target;
  if (target.name === 'template' && target.closest('#vault-new-dialog')) pickTemplate(target.value);
  else if (target.id === 'vault-model') chooseModel(target);
  else if (target.id === 'vault-effort') saveSettings({ effort: target.value }, 'model', 'Effort saved.');
  else if (target.id === 'vault-account') saveSettings({ account: target.value }, 'model', 'Login saved.');
  else if (target.dataset?.vaultAutomationOn) changeAutomation(target.dataset.vaultAutomationOn, { enabled: target.checked }, target.checked ? 'Automation on.' : 'Automation off.');
  else if (target.matches?.('[data-vault-sync]')) setSync(target.checked);
  else if (target.matches?.('[data-vault-calendar]')) saveSettings({ calendar: target.checked }, 'automations', target.checked ? 'Builds now get your meetings.' : 'Builds no longer get your meetings.');
}

// Return builds, as in a chat box; Shift+Return adds a line. Escape shuts
// the menu, and the arrow keys move the menu button or the chat by its handle.
function onKeydown(event) {
  if (event.key === 'Escape' && dockOpen) {
    event.preventDefault();
    closeDock(true);
    return;
  }
  const what = event.target.dataset?.vaultGrip;
  if (what && !event.altKey && !event.metaKey && !event.ctrlKey) {
    const next = vaultPlaceNudge(layoutNow()[what], event.key, VAULT_PLACE_HOMES[what]);
    if (!next) return;
    event.preventDefault();
    saveLayout({ [what]: next });
    render();
    return;
  }
  if (event.target.id !== 'vault-ask-text' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  ask();
}

function onSubmit(event) {
  const form = event.target;
  if (form.matches('[data-vault-create]')) {
    event.preventDefault();
    createVault(form);
  } else if (form.matches('[data-vault-ask]')) {
    event.preventDefault();
    ask();
  } else if (form.matches('[data-vault-delete]')) {
    event.preventDefault();
    deleteVault();
  } else if (form.matches('[data-vault-new-note]')) {
    event.preventDefault();
    createNote(form);
  } else if (form.matches('[data-vault-rename]')) {
    event.preventDefault();
    rename(form);
  }
}

// Shut without a render: a click outside the menu shuts it as it presses, and
// a render then would replace what is being pressed, losing the click.
function closeDock(focus) {
  if (!dockOpen) return;
  dockOpen = false;
  $('vault-dock-menu')?.remove();
  $('vault-dock-btn')?.setAttribute('aria-expanded', 'false');
  fitDockStack();
  if (focus) $('vault-dock-btn')?.focus();
}

// Where the ask box is, or the button nearest to it when it is put away.
function boxOrButton() {
  return $('vault-ask-text') || $('vault-chat-grow') || $('vault-dock-btn');
}

// A render replaces the conversation. It opens at its newest turn and follows
// new ones, but a reader scrolled back keeps their place while a build polls.
function turnsPlace() {
  const list = $('vault-chat-turns');
  if (!list) return null;
  return { top: list.scrollTop, count: list.children.length, atEnd: list.scrollHeight - list.scrollTop - list.clientHeight < 8 };
}

function keepTurnsPlace(was) {
  const list = $('vault-chat-turns');
  if (!list) return;
  list.scrollTop = !was || was.atEnd || was.count !== list.children.length ? list.scrollHeight : was.top;
}

// The menu and what Orc says beside the button open toward the side with more
// room, but a button partway across a narrow screen leaves too little either
// way, so they slide back inside it.
function fitDockStack() {
  const stack = document.querySelector('#vault-dock .vault-dock-stack');
  const room = $('vaults-body')?.getBoundingClientRect();
  if (!stack || !room) return;
  stack.style.translate = '';
  const box = stack.getBoundingClientRect();
  if (!box.width) return;
  const shift = box.left < room.left + FLOAT_MARGIN ? room.left + FLOAT_MARGIN - box.left
    : box.right > room.right - FLOAT_MARGIN ? room.right - FLOAT_MARGIN - box.right : 0;
  if (shift) stack.style.translate = `${Math.round(shift)}px 0`;
}

// The menu button, or the chat by its handle, follows the pointer once it
// has moved a few pixels; until then the press is a click. The page's frame
// would swallow the pointer, so it is switched off while either is held.
function onPointerdown(event) {
  const grip = event.target.closest?.('[data-vault-grip]');
  const el = grip && $(floatId(grip.dataset.vaultGrip));
  if (!el || event.button !== 0) return;
  const rect = el.getBoundingClientRect();
  drag = { what: grip.dataset.vaultGrip, x: event.clientX, y: event.clientY, moved: false,
    box: { width: rect.width, height: rect.height, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top } };
  $('vaults-view')?.classList.add('is-float-held');
  try { grip.setPointerCapture(event.pointerId); } catch {}
}

function onPointermove(event) {
  if (!drag) return;
  // Released outside the window, the press sent no pointerup.
  if (!event.buttons) {
    onPointerup();
    return;
  }
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_PX) return;
  const room = $('vaults-body')?.getBoundingClientRect();
  if (!room) return;
  if (!drag.moved) {
    drag.moved = true;
    $('vaults-view')?.classList.add('is-float-dragging');
  }
  event.preventDefault();
  const at = vaultPlaceFromPoint(event, room, drag.box, FLOAT_MARGIN, VAULT_PLACE_HOMES[drag.what]);
  saveLayout({ [drag.what]: at }, false);
  placeFloat(drag.what, at);
  if (drag.what === 'dock') fitDockStack();
}

function onPointerup() {
  const ended = drag;
  drag = null;
  $('vaults-view')?.classList.remove('is-float-held', 'is-float-dragging');
  if (!ended?.moved) return;
  dragged = true;
  // A drag that ends off what was dragged has no click to swallow.
  setTimeout(() => { dragged = false; }, 0);
  saveLayout({});
  render();
}

// A click outside the menu, or into the page's frame, shuts it.
function onOutside(event) {
  if (dockOpen && !$('vault-dock')?.contains(event.target)) closeDock(false);
}

function wire(view) {
  if (wired) return;
  wired = true;
  view.addEventListener('click', onClick);
  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  view.addEventListener('submit', onSubmit);
  view.addEventListener('keydown', onKeydown);
  view.addEventListener('pointerdown', onPointerdown);
}

export function showVaults(hash = '#vaults') {
  const path = String(hash || 'vaults').replace(/^#/, '') || 'vaults';
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  for (const id of SIBLING_VIEWS) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  const view = $('vaults-view');
  if (!view) return;
  wire(view);
  view.hidden = false;
  const changed = viewHash !== path;
  active = true;
  viewHash = path;
  let slug = '';
  if (path.startsWith('vaults/')) {
    try { slug = decodeURIComponent(path.slice('vaults/'.length)); } catch { slug = path.slice('vaults/'.length); }
  }
  if (slug !== detailSlug) {
    const kept = detail?.vault?.slug === slug ? detail : null;
    resetDetailState();
    detailSlug = slug;
    detail = kept;
  }
  if (changed) lastHtml = null;
  render();
  if (changed) {
    // Arriving plays the entrance once; saves and refetches after it do not.
    const body = $('vaults-body');
    body?.classList.add('vault-entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => body?.classList.remove('vault-entering'), ENTER_MS);
    $('vaults-title')?.focus({ preventScroll: true });
  }
  if (slug) loadDetail(slug);
  loadList();
  if (newDialogPending && listData && !slug) {
    const template = newDialogPending.template;
    newDialogPending = null;
    openNewDialog(template);
  }
}

export function hideVaults() {
  active = false;
  viewHash = '';
  listRequest++;
  detailRequest++;
  clearTimeout(pollTimer);
  clearTimeout(frameTimer);
  // A hidden page would go on running its scripts.
  const stage = $('vault-stage');
  if (stage) {
    stage.replaceChildren();
    delete stage.dataset.key;
  }
  $('vault-new-dialog')?.close?.();
  $('vault-delete-dialog')?.close?.();
  const view = $('vaults-view');
  if (view) view.hidden = true;
}

const isVaultHash = hash => hash === '#vaults' || hash.startsWith('#vaults/');

export async function activate({ signal, base, commands, view: registerView }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'vaults.css';
  style.dataset.vaultsStyle = '';
  await new Promise(resolve => {
    style.addEventListener('load', resolve, { once: true });
    style.addEventListener('error', resolve, { once: true });
    signal.addEventListener('abort', resolve, { once: true });
    document.head.append(style);
  });
  if (signal.aborted) {
    style.remove();
    return () => {};
  }
  pluginSignal = signal;

  const section = document.createElement('section');
  section.id = 'vaults-view';
  section.setAttribute('aria-labelledby', 'vaults-title');
  section.hidden = true;
  if ($('servers-view')) $('servers-view').after(section);
  else $('settings-view').before(section);

  const button = document.createElement('orc-icon-button');
  button.id = 'vaults-btn';
  button.setAttribute('href', '#vaults');
  button.setAttribute('label', 'Vaults');
  button.setAttribute('size', 'compact');
  button.innerHTML = SIDEBAR_ICON;
  if ($('servers-btn')) $('servers-btn').after(button);
  else $('sidebar-footer')?.append(button);

  commands(() => [
    { label: 'Open vaults', sub: 'Pages you build by describing them', action: () => { location.hash = 'vaults'; } },
    {
      label: 'New vault',
      sub: 'Build a page for your goals, your wins, your next meeting or anything else',
      action: () => {
        if (active && !detailSlug) {
          openNewDialog();
          return;
        }
        newDialogPending = { template: undefined };
        location.hash = 'vaults';
      },
    },
  ]);

  registerView({ hash: 'vaults', subroutes: true, show: showVaults, hide: hideVaults });

  document.addEventListener('visibilitychange', () => {
    if (!active || document.hidden) return;
    if (detailSlug) loadDetail(detailSlug);
    else loadList();
  }, { signal });
  window.addEventListener('message', onPageMessage, { signal });
  window.addEventListener('pointermove', onPointermove, { signal });
  window.addEventListener('pointerup', onPointerup, { signal });
  window.addEventListener('pointercancel', onPointerup, { signal });
  document.addEventListener('pointerdown', onOutside, { capture: true, signal });
  window.addEventListener('blur', () => {
    if (document.activeElement?.classList?.contains('vault-frame')) closeDock(false);
  }, { signal });
  const orcInput = () => { orcInputAt = performance.now(); };
  document.addEventListener('pointerdown', orcInput, { capture: true, signal });
  document.addEventListener('keydown', orcInput, { capture: true, signal });
  window.addEventListener('pagehide', hideVaults, { signal });
  window.addEventListener('pageshow', event => {
    if (event.persisted && isVaultHash(location.hash)) showVaults(location.hash);
  }, { signal });

  return () => {
    hideVaults();
    section.remove();
    button.remove();
    style.remove();
    wired = false;
    pluginSignal = null;
    listData = null;
    listError = '';
    detailSlug = '';
    busy = '';
    keepFocus = '';
    newDialogPending = null;
    lastHtml = null;
    clearTimeout(enterTimer);
    clearTimeout(freshTimer);
    clearTimeout(pollTimer);
    clearTimeout(frameTimer);
    freshNote = '';
    resetDetailState();
    if (isVaultHash(location.hash)) location.hash = 'new';
  };
}
