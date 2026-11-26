import { $, announce } from '/js/core.js';
import { reducedMotion } from '/js/motion.js';
import { toast } from '/js/toast.js';
import { SKILL_MD_LIMIT, detectSkillInputKind, skillsByteLength, skillsCountLabel, skillsFileUrl } from './model.js';
import {
  DETAIL_SKELETON,
  DIALOGS_HTML,
  INTERVAL_OPTIONS,
  LIST_SKELETON,
  addHintHtml,
  canManage,
  chooseListHtml,
  detailRegions,
  listRegions,
} from './views.js';
import { SKILLS_HASH, skillHash } from './table.js';

const ENTER_MS = 1100;
const PASTE_FLASH_MS = 950;

const state = {
  snapshot: null,
  listError: '',
  filterMode: 'all',
  searchQuery: '',
  targetFilter: '',
  quickInput: '',
  quickScope: 'global',
  detailSlug: '',
  detail: null,
  detailError: '',
  mdEditing: false,
  mdDraft: null,
  sourceUrlDraft: null,
  openCompanionPath: '',
  openCompanionFile: null,
  companionLoading: '',
  busyKey: '',
  // Skills whose removal is on its way to the server: their bins are off.
  removing: new Set(),
  sectionStatus: {},
};

let active = false;
let viewHash = '';
let wired = false;
let pluginSignal = null;
// The screen, made once and drawn into the Skills tab of Settings each time
// it shows there.
let section = null;
let listReq = 0;
let detailReq = 0;
let autoCheckTriggered = false;
let pendingFocusAdd = false;
let mdBaseDigest = null;
let chooseState = null; // { source, scope, projects, availableSkills, selected: Set }
let keepFocus = '';
let enterTimer = 0;
let entered = false;
let paintedMode = '';
const painted = new Map();
// The harness under the pointer or the focus, lit wherever the screen shows it.
let hotTarget = '';
// Each link's state at the last paint, keyed `slug|target`, so a link that
// has just become synced can be seen closing in its cell.
let linkStates = null;
let trackedSnapshot = null;
let tablesWatch = null;
let listScrollBeforeSkill = 0;

function resetDetailState() {
  state.detail = null;
  state.detailError = '';
  state.mdEditing = false;
  state.mdDraft = null;
  mdBaseDigest = null;
  state.sourceUrlDraft = null;
  state.openCompanionPath = '';
  state.openCompanionFile = null;
  state.companionLoading = '';
  for (const key of Object.keys(state.sectionStatus)) {
    if (key !== 'list') delete state.sectionStatus[key];
  }
}

// Posts that can change which skills the chat's `/` menu offers.
const SKILL_WRITE = /^\/api\/skills-manager\/(?:install|create|skills\/.+)$/;

async function api(url, body) {
  let response = null;
  try {
    response = await fetch(url, body === undefined
      ? { cache: 'no-store', signal: pluginSignal }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: pluginSignal,
        });
  } catch {}
  const data = response ? await response.json().catch(() => ({})) : {};
  if (response?.ok && body !== undefined && SKILL_WRITE.test(url)) window.dispatchEvent(new Event('orc-skills-changed'));
  return {
    ok: Boolean(response?.ok),
    status: response?.status || 0,
    data: data && typeof data === 'object' ? data : {},
  };
}

function setStatus(section, text, tone = '') {
  state.sectionStatus[section] = { text, tone };
}

// The pressed button shows that work is running, so the step itself is only
// spoken; the last result goes so it cannot read as this one's.
function startBusy(key, section, working) {
  state.busyKey = key;
  if (working) {
    setStatus(section, '');
    announce(working);
  }
  render();
}

function setDialogStatus(id, text, tone = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `skills-status${tone ? ` is-${tone}` : ''}`;
}

function takeSnapshot(data) {
  state.snapshot = data;
}

async function loadSnapshot({ quietDueCheck = true } = {}) {
  const gen = ++listReq;
  const res = await api('/api/skills-manager');
  if (gen !== listReq) return;
  if (res.ok && Array.isArray(res.data.skills)) {
    takeSnapshot(res.data);
    state.listError = '';
    const snap = state.snapshot;
    if (
      quietDueCheck &&
      !autoCheckTriggered &&
      snap.allowNetwork &&
      snap.canManage &&
      snap.updateCheckDue &&
      snap.skills.some(item => item.source?.canCheckUpdates)
    ) {
      autoCheckTriggered = true;
      runBackgroundDueCheck();
    }
  } else {
    state.listError = res.data.error || 'Could not load your skills. Try again.';
  }
  if (active && !state.detailSlug) render();
  if (pendingFocusAdd && active && !state.detailSlug) {
    pendingFocusAdd = false;
    $('skills-quickadd-input')?.focus();
  }
}

async function runBackgroundDueCheck() {
  const res = await api('/api/skills-manager/check-updates', {});
  if (res.ok && Array.isArray(res.data.skills)) {
    takeSnapshot(res.data);
    if (active && !state.detailSlug) render();
  }
}

function sourceInputOf(detail) {
  const source = detail?.skill?.source;
  return source?.input || source?.gitUrl || source?.rawUrl || '';
}

async function loadDetail(slug) {
  const gen = ++detailReq;
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}`);
  if (gen !== detailReq || slug !== state.detailSlug) return;
  if (!res.ok || !res.data.skill) {
    state.detailError = res.data.error || (res.status === 404 ? 'That skill does not exist.' : 'Could not load this skill.');
    if (res.status === 404) state.detail = null;
  } else {
    state.detailError = '';
    state.detail = res.data;
    if (state.sourceUrlDraft === null) state.sourceUrlDraft = sourceInputOf(state.detail);
  }
  if (active && state.detailSlug === slug) render();
}

function render() {
  const view = $('skills-view');
  if (!view || !active) return;
  let body = $('skills-body');
  if (!body) {
    view.innerHTML = `<div id="skills-body" class="skills-wrap"></div>${DIALOGS_HTML}`;
    body = $('skills-body');
    paintedMode = '';
  }
  const mode = state.detailSlug ? 'detail' : 'list';
  // A redraw keeps the screen where it was. WebKit, which Orc.app runs on,
  // moved Settings' scroller when a table was replaced (a bin press, Sync,
  // Undo, the harness filter). Moving between the list and a skill's page
  // sets its own place in showSkills.
  const keptScroll = paintedMode === mode ? scroller().scrollTop : null;
  if (paintedMode !== mode) {
    body.innerHTML = mode === 'detail' ? DETAIL_SKELETON : LIST_SKELETON;
    paintedMode = mode;
    painted.clear();
    watchTables();
  }

  // The rows rise once per visit, when there is something to show, not when
  // the empty frame first paints.
  const ready = mode === 'detail' ? Boolean(state.detail?.skill) : Boolean(state.snapshot);
  if (ready && !entered) {
    entered = true;
    body.classList.add('skills-entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => body.classList.remove('skills-entering'), ENTER_MS);
  }

  const focused = document.activeElement && view.contains(document.activeElement) ? document.activeElement : null;
  const focusId = focused?.id || '';
  const selection = focused && typeof focused.selectionStart === 'number'
    ? [focused.selectionStart, focused.selectionEnd]
    : null;
  const textScroll = focused?.tagName === 'TEXTAREA' ? focused.scrollTop : 0;

  for (const region of mode === 'detail' ? detailRegions(state) : listRegions(state)) {
    const key = region.key ?? region.html;
    if (painted.get(region.id) === key) continue;
    painted.set(region.id, key);
    const el = $(region.id);
    if (el) el.innerHTML = region.html;
  }
  if (keptScroll !== null && scroller().scrollTop !== keptScroll) scroller().scrollTop = keptScroll;
  syncFields();

  // A control that a repaint replaced gets its focus back; one a busy action
  // disabled gets it back once the action ends.
  if (focusId && !focused.isConnected) keepFocus = focusId;
  if (keepFocus && !view.querySelector('dialog[open]')) {
    const el = $(keepFocus);
    if (el && view.contains(el) && !el.disabled) {
      keepFocus = '';
      el.focus({ preventScroll: true });
      if (selection && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(...selection); } catch {}
      }
      if (textScroll) el.scrollTop = textScroll;
    } else if (!state.busyKey) {
      keepFocus = '';
    }
  }

  applyHot();
  if (mode === 'list') {
    fitTables();
    showClosedLinks();
  }
}

// A field's text is left out of its region's key, so set it here whenever the
// screen changed it rather than the user.
function syncFields() {
  const fields = [
    ['skills-quickadd-input', state.quickInput],
    ['skills-search-input', state.searchQuery],
    ['skills-source-url', state.sourceUrlDraft ?? ''],
  ];
  for (const [id, value] of fields) {
    const el = $(id);
    if (el && el.value !== value) el.value = value;
  }
}

// The harness columns sit beside the names while the tables are wide enough
// to keep a name readable. Narrower than that, each skill's cells move to a
// strip under it. The width that takes depends on how many harnesses there
// are, so table.js works it out and a container query cannot.
function fitTables() {
  const roster = $('skills-r-roster');
  if (!roster) return;
  const fit = Number(roster.querySelector('.skills-tables')?.dataset.fit) || 0;
  roster.classList.toggle('is-strip', roster.clientWidth < fit);
}

function watchTables() {
  tablesWatch?.disconnect();
  tablesWatch = null;
  const roster = $('skills-r-roster');
  if (!roster || typeof ResizeObserver !== 'function') return;
  tablesWatch = new ResizeObserver(fitTables);
  tablesWatch.observe(roster);
}

function setHot(target) {
  if (hotTarget === target) return;
  hotTarget = target;
  applyHot();
}

function applyHot() {
  const body = $('skills-body');
  if (!body) return;
  body.querySelectorAll('.is-hot').forEach(el => el.classList.remove('is-hot'));
  if (!hotTarget) return;
  body.querySelectorAll(`[data-target="${CSS.escape(hotTarget)}"]`).forEach(el => el.classList.add('is-hot'));
}

function showClosedLinks() {
  if (trackedSnapshot === state.snapshot) return;
  trackedSnapshot = state.snapshot;
  const next = new Map();
  const closed = [];
  const known = new Set([...(linkStates?.keys() || [])].map(key => key.split('|')[0]));
  (state.snapshot?.targets || []).forEach((target, column) => {
    for (const skill of state.snapshot.skills || []) {
      const inst = (skill.instances || []).find(row => row.targetId === target.id);
      if (!inst) continue;
      const key = `${skill.slug}|${target.id}`;
      next.set(key, inst.state);
      const was = linkStates?.get(key);
      const arrived = linkStates && !known.has(skill.slug);
      if (inst.state === 'synced' && (arrived || (was && was !== 'synced'))) closed.push({ slug: skill.slug, target: target.id, column });
    }
  });
  linkStates = next;
  if (!closed.length || reducedMotion()) return;
  const roster = $('skills-r-roster');
  for (const { slug, target, column } of closed) {
    roster?.querySelector(`[data-skill="${CSS.escape(slug)}"] [data-target="${CSS.escape(target)}"] .skills-cell`)?.animate(
      [
        { opacity: 0, transform: 'scale(.5)' },
        { opacity: 1, transform: 'scale(1.12)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 560, delay: column * 55, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'backwards' },
    );
  }
}

function openChooseDialog(data, scope, projects) {
  const dialog = $('skills-choose-dialog');
  if (!dialog) return;
  const available = data.availableSkills || [];
  chooseState = {
    source: data.source,
    scope,
    projects,
    availableSkills: available,
    selected: new Set(available.map(item => item.subdir || item.slug)),
  };
  renderChooseList();
  setDialogStatus('skills-choose-status', '');
  if (!dialog.open) dialog.showModal();
}

function renderChooseList() {
  const list = $('skills-choose-list');
  const confirmBtn = $('skills-choose-confirm');
  if (!list || !chooseState) return;
  list.innerHTML = chooseListHtml(chooseState);
  if (confirmBtn) {
    const n = chooseState.selected.size;
    confirmBtn.disabled = n === 0;
    confirmBtn.textContent = n ? `Install ${n} skill${n === 1 ? '' : 's'}` : 'Select at least one';
  }
}

function openNewSkillDialog() {
  const dialog = $('skills-new-dialog');
  if (!dialog) return;
  dialog.querySelector('form')?.reset();
  setDialogStatus('skills-new-status', '');
  if (!dialog.open) dialog.showModal();
  $('skills-new-name')?.focus();
}

function skillName(slug) {
  const skill = state.detail?.skill?.slug === slug
    ? state.detail.skill
    : (state.snapshot?.skills || []).find(s => s.slug === slug);
  return skill?.name || slug;
}

function parseQuickScopeValue(val) {
  if (typeof val === 'string' && val.startsWith('project:')) {
    return { scope: 'project', projects: [val.slice('project:'.length)] };
  }
  return { scope: 'global', projects: undefined };
}

function fail(section, message) {
  setStatus(section, message, 'error');
  announce(message);
  render();
}

function succeed(section, message) {
  setStatus(section, message, 'ok');
  announce(message);
}

async function submitQuickInstall(sourceOverride, selectedSubdirs) {
  const raw = String(sourceOverride ?? state.quickInput ?? '').trim();
  if (!raw) {
    setStatus('install', 'Paste a GitHub link, skills.sh URL, owner/repo shorthand, or local folder path.', 'error');
    render();
    $('skills-quickadd-input')?.focus();
    return;
  }
  const { scope, projects } = parseQuickScopeValue(state.quickScope);
  startBusy('install', 'install', 'Fetching and syncing skill…');

  const res = await api('/api/skills-manager/install', {
    source: raw,
    scope,
    ...(projects ? { projects } : {}),
    ...(selectedSubdirs ? { selectedSubdirs } : {}),
  });
  state.busyKey = '';

  if (!res.ok) {
    fail('install', res.data.error || 'Could not install from that link.');
    return;
  }
  if (res.data.status === 'choose_skills') {
    setStatus('install', '');
    render();
    openChooseDialog(res.data, scope, projects);
    return;
  }

  takeSnapshot(res.data);
  const slugs = res.data.installedSlugs || [];
  state.quickInput = '';
  succeed('install', `Installed and synced ${slugs.join(', ') || 'skill'}.`);
  render();
}

async function confirmChooseInstall() {
  if (!chooseState || !chooseState.selected.size) return;
  const btn = $('skills-choose-confirm');
  if (btn) btn.disabled = true;
  setDialogStatus('skills-choose-status', 'Installing selected skills…');

  const res = await api('/api/skills-manager/install', {
    source: chooseState.source,
    scope: chooseState.scope,
    ...(chooseState.projects ? { projects: chooseState.projects } : {}),
    selectedSubdirs: [...chooseState.selected],
  });

  if (btn) btn.disabled = false;
  if (!res.ok) {
    const msg = res.data.error || 'Could not install selected skills.';
    setDialogStatus('skills-choose-status', msg, 'error');
    announce(msg);
    return;
  }

  $('skills-choose-dialog')?.close();
  chooseState = null;
  takeSnapshot(res.data);
  state.quickInput = '';
  const slugs = res.data.installedSlugs || [];
  succeed('install', `Installed and synced ${slugs.length} skill${slugs.length === 1 ? '' : 's'}: ${slugs.join(', ')}.`);
  render();
}

async function submitNewSkill(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  const description = String(fd.get('description') || '').trim();
  const body = String(fd.get('body') || '').trim();
  const btn = $('skills-new-submit');
  if (!name) {
    setDialogStatus('skills-new-status', 'Name the skill first.', 'error');
    $('skills-new-name')?.focus();
    return;
  }
  if (btn) btn.disabled = true;
  setDialogStatus('skills-new-status', 'Creating…');

  const res = await api('/api/skills-manager/create', { name, description, body });
  if (btn) btn.disabled = false;
  if (!res.ok) {
    const msg = res.data.error || 'Could not create the skill.';
    setDialogStatus('skills-new-status', msg, 'error');
    announce(msg);
    return;
  }

  $('skills-new-dialog')?.close();
  takeSnapshot(res.data);
  const slug = res.data.installedSlugs?.[0];
  announce(`Created ${slug || name}.`);
  if (slug) location.hash = skillHash(slug);
  else render();
}

async function runListAction({ busy, url, body = {}, working, failed, done }) {
  if (state.busyKey) return;
  startBusy(busy, 'list', working);
  const res = await api(url, body);
  state.busyKey = '';
  if (!res.ok) {
    fail('list', res.data.error || failed);
    return;
  }
  takeSnapshot(res.data);
  succeed('list', done(res.data));
  render();
}

function runSyncAll() {
  return runListAction({
    busy: 'sync-all',
    url: '/api/skills-manager/sync-all',
    body: { strategy: 'newest' },
    working: 'Syncing skills across all harnesses…',
    failed: 'Could not sync skills.',
    done: data => {
      const synced = (data.syncReport?.synced || []).length;
      const skipped = (data.syncReport?.skippedConflicts || []).length;
      return skipped
        ? `Synced ${synced} skill${synced === 1 ? '' : 's'}; ${skipped} could not be synced.`
        : `Synced ${synced || 'all'} skill${synced === 1 ? '' : 's'} across configured harnesses.`;
    },
  });
}

function runUpdateAll() {
  return runListAction({
    busy: 'update-all',
    url: '/api/skills-manager/update-all',
    working: 'Updating all outdated skills…',
    failed: 'Could not update skills.',
    done: data => {
      const updated = data.updateReport?.updated || [];
      const skipped = data.updateReport?.skippedLocallyModified || [];
      return skipped.length
        ? `Updated ${updated.length} skill${updated.length === 1 ? '' : 's'} (${skipped.length} with local edits skipped).`
        : `Updated ${updated.length} skill${updated.length === 1 ? '' : 's'} and synced every harness.`;
    },
  });
}

function runEntrySync(slug) {
  return runListAction({
    busy: `sync:${slug}`,
    url: `/api/skills-manager/skills/${encodeURIComponent(slug)}/sync`,
    body: { preferredSource: 'newest' },
    failed: `Could not sync ${slug}.`,
    done: () => `Synced ${slug} across harnesses.`,
  });
}

function runEntryUpdate(slug) {
  return runListAction({
    busy: `update:${slug}`,
    url: `/api/skills-manager/skills/${encodeURIComponent(slug)}/update`,
    failed: `Could not update ${slug}.`,
    done: () => `Updated ${slug} to the latest version.`,
  });
}

async function runCheckUpdates(slug = undefined) {
  if (state.busyKey) return;
  const section = slug ? 'source' : 'list';
  startBusy('check-updates', section, 'Checking upstream sources for updates…');
  const res = await api('/api/skills-manager/check-updates', slug ? { slug } : {});
  state.busyKey = '';
  if (!res.ok) {
    fail(section, res.data.error || 'Could not check updates.');
    return;
  }
  takeSnapshot(res.data);
  const ready = state.snapshot.summary?.updatesAvailable || 0;
  succeed(section, ready
    ? `Found ${ready} update${ready === 1 ? '' : 's'} ready to install.`
    : 'All checked skills are up to date.');
  if (slug && state.detailSlug === slug) await loadDetail(slug);
  else render();
}

async function runDetailPreferSync(preferredSource) {
  if (state.busyKey || !state.detailSlug) return;
  const slug = state.detailSlug;
  startBusy('resolve', 'detail', 'Syncing across harnesses…');
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}/sync`, { preferredSource });
  state.busyKey = '';
  if (!res.ok) {
    fail('detail', res.data.error || 'Could not sync this skill.');
    return;
  }
  takeSnapshot(res.data);
  setStatus('detail', 'Canonical copy updated and synced across all configured harnesses.', 'ok');
  announce('Synced across all configured harnesses.');
  await loadDetail(slug);
}

async function runDetailUpdate() {
  if (state.busyKey || !state.detailSlug) return;
  const slug = state.detailSlug;
  startBusy('detail-update', 'detail', 'Updating from upstream…');
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}/update`, {});
  state.busyKey = '';
  if (!res.ok) {
    fail('detail', res.data.error || 'Could not update this skill.');
    return;
  }
  takeSnapshot(res.data);
  setStatus('detail', 'Updated to the latest upstream version.', 'ok');
  announce('Updated skill.');
  await loadDetail(slug);
}

async function saveDetail({ busy, path, body, section, working, failed, done }) {
  if (state.busyKey || !state.detailSlug) return false;
  const slug = state.detailSlug;
  startBusy(busy, section, working);
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}/${path}`, body);
  state.busyKey = '';
  if (slug !== state.detailSlug) return false;
  if (!res.ok) {
    fail(section, res.data.error || failed);
    return false;
  }
  state.detail = res.data;
  done();
  render();
  loadSnapshot({ quietDueCheck: false });
  return true;
}

function configureCurrentSkill(patch, savedMsg = 'Updated skill sync settings.') {
  return saveDetail({
    busy: 'configure',
    path: 'configure',
    body: patch,
    section: 'configure',
    failed: 'Could not update skill configuration.',
    done: () => succeed('configure', savedMsg),
  });
}

function saveMarkdown() {
  if (state.mdDraft === null) return;
  if (skillsByteLength(state.mdDraft) > SKILL_MD_LIMIT) {
    setStatus('markdown', 'SKILL.md exceeds 256 KB.', 'error');
    render();
    return;
  }
  saveDetail({
    busy: 'markdown',
    path: 'markdown',
    body: { text: state.mdDraft, baseDigest: mdBaseDigest },
    section: 'markdown',
    working: 'Saving SKILL.md…',
    failed: 'Could not save SKILL.md.',
    done: () => {
      state.mdDraft = null;
      mdBaseDigest = null;
      state.mdEditing = false;
      setStatus('markdown', 'Saved SKILL.md and updated every linked harness.', 'ok');
      announce('Saved SKILL.md.');
    },
  });
}

function saveSourceUrl(form) {
  const url = String(new FormData(form).get('sourceUrl') || '').trim();
  saveDetail({
    busy: 'source',
    path: 'configure',
    body: { sourceUrl: url },
    section: 'source',
    working: 'Saving upstream source…',
    failed: 'Could not save source link.',
    done: () => {
      state.sourceUrlDraft = sourceInputOf(state.detail);
      setStatus('source', url ? 'Saved upstream source.' : 'Cleared upstream source.', 'ok');
      announce('Saved upstream source.');
    },
  });
}

async function toggleCompanionFile(path) {
  if (state.openCompanionPath === path) {
    state.openCompanionPath = '';
    state.openCompanionFile = null;
    render();
    return;
  }
  const slug = state.detailSlug;
  state.companionLoading = path;
  render();
  const res = await api(skillsFileUrl(slug, path));
  if (slug !== state.detailSlug || state.companionLoading !== path) return;
  state.companionLoading = '';
  if (!res.ok || !res.data.file) {
    setStatus('detail', res.data.error || `Could not read ${path}.`, 'error');
    render();
    return;
  }
  state.openCompanionPath = path;
  state.openCompanionFile = res.data.file;
  render();
}

// The bin a removal should leave focus on: the next row's, else the one
// before, so the keyboard can carry on down the table.
function binAfter(slug) {
  const bins = [...document.querySelectorAll('#skills-view [data-act="entry-remove"]')];
  const at = bins.findIndex(bin => bin.dataset.slug === slug);
  if (at < 0) return '';
  return (bins[at + 1] || bins[at - 1])?.dataset.slug || '';
}

function focusBin(slug) {
  const bin = slug && [...document.querySelectorAll('#skills-view [data-act="entry-remove"]')].find(el => el.dataset.slug === slug);
  if (bin) bin.focus({ preventScroll: true });
  else $(state.detailSlug ? 'skills-title' : 'skills-quickadd-input')?.focus({ preventScroll: true });
}

// One press removes a skill from every harness and project; no dialog asks
// first. The toast that follows puts it all back, and the server keeps the
// files in the trash folder after the toast has gone.
async function removeSkill(slug) {
  if (!slug || state.removing.has(slug)) return;
  const name = skillName(slug);
  const hadFocus = document.activeElement?.closest?.('#skills-view') != null;
  const nextBin = binAfter(slug);
  const fromPage = state.detailSlug === slug;
  if (fromPage && state.mdDraft !== null && !discardDraft()) return;
  state.removing.add(slug);
  render();
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}/delete`, { confirm: true });
  state.removing.delete(slug);
  if (!res.ok) {
    const msg = res.data.error || `Could not remove ${name}.`;
    toast(msg, { tone: 'error' });
    announce(msg);
    render();
    return;
  }
  takeSnapshot(res.data);
  const token = res.data.removal?.token;
  toast(`Removed ${name}`, {
    tone: 'info',
    actions: token ? [{ label: 'Undo', onClick: () => undoRemove(slug, name, token) }] : [],
  });
  announce(`Removed ${name}.${token ? ' Undo is in the notification.' : ''}`);
  if (fromPage && active) {
    location.hash = SKILLS_HASH;
    return;
  }
  render();
  if (hadFocus && active) focusBin(nextBin);
}

async function undoRemove(slug, name, token) {
  const res = await api(`/api/skills-manager/skills/${encodeURIComponent(slug)}/restore`, { token });
  if (!res.ok) {
    const msg = res.data.error || `Could not put ${name} back.`;
    toast(msg, { tone: 'error' });
    announce(msg);
    return;
  }
  takeSnapshot(res.data);
  announce(`Put back ${name}.`);
  if (active && !state.detailSlug) {
    render();
    focusBin(slug);
  }
}

// The defaults card at the foot of the list, which sat under Plugins when
// Skills was a plugin.
async function saveDefaults(button) {
  const card = button.closest('.skills-settings-card');
  if (!card) return;
  const checkedTargets = [...card.querySelectorAll('[data-skills-setting-target]:checked')]
    .map(el => el.dataset.skillsSettingTarget);
  const autoSync = Boolean(card.querySelector('#skills-setting-autosync')?.checked);
  const nextInterval = card.querySelector('#skills-setting-interval')?.value || 'daily';
  button.disabled = true;
  setDialogStatus('skills-plugin-settings-status', 'Saving…');
  const res = await api('/api/skills-manager/settings', {
    defaultTargets: checkedTargets,
    autoSyncNewAccounts: autoSync,
    updateCheckInterval: nextInterval,
    applyToGlobalSkills: true,
  });
  button.disabled = false;
  if (!res.ok) {
    const msg = res.data.error || 'Could not save defaults.';
    setDialogStatus('skills-plugin-settings-status', msg, 'error');
    announce(msg);
    return;
  }
  takeSnapshot(res.data);
  render();
  setDialogStatus('skills-plugin-settings-status', 'Saved defaults and synced global skills.', 'ok');
  announce('Saved Skills defaults.');
}

async function updateIntervalSetting(interval) {
  const res = await api('/api/skills-manager/settings', { updateCheckInterval: interval });
  if (!res.ok) {
    fail('list', res.data.error || 'Could not update schedule.');
    return;
  }
  state.snapshot = res.data;
  const label = INTERVAL_OPTIONS.find(o => o.id === interval)?.label || interval;
  setStatus('list', `Update check schedule set to ${label}.`, 'ok');
  announce(`Update checks set to ${label}.`);
  render();
}

// The class goes on the region, not the bar inside it, so it outlives the
// repaint that disables the bar while the skill is fetched.
function flashAdd() {
  const region = $('skills-r-add');
  if (!region) return;
  region.classList.add('is-pasted');
  setTimeout(() => region.classList.remove('is-pasted'), PASTE_FLASH_MS);
}

async function pasteFromClipboardButton() {
  const prompt = text => {
    setStatus('install', text);
    render();
    $('skills-quickadd-input')?.focus();
  };
  if (!navigator.clipboard?.readText) {
    prompt('Press ⌘V inside the field above to paste your link.');
    return;
  }
  try {
    const clip = (await navigator.clipboard.readText()).trim();
    if (!clip) {
      prompt('Clipboard is empty — copy a skill URL or repository first.');
      return;
    }
    state.quickInput = clip;
    flashAdd();
    await submitQuickInstall(clip);
  } catch {
    prompt('Press ⌘V to paste your link directly.');
  }
}

function onDocumentPaste(event) {
  if (!active || state.detailSlug || !canManage(state) || state.busyKey) return;
  const view = $('skills-view');
  if (!view || view.hidden || view.querySelector('dialog[open]')) return;
  const el = document.activeElement;
  if (el && (el.matches('input, textarea, select') || el.isContentEditable)) return;

  const text = event.clipboardData?.getData('text/plain')?.trim() || '';
  if (!text || !detectSkillInputKind(text).valid) return;

  event.preventDefault();
  state.quickInput = text;
  render();
  flashAdd();
  submitQuickInstall(text);
}

function discardDraft() {
  if (state.mdDraft !== null && !confirm('Discard your unsaved changes to SKILL.md?')) return false;
  state.mdEditing = false;
  state.mdDraft = null;
  mdBaseDigest = null;
  return true;
}

const ACTIONS = {
  // A table row opens its skill. A control in it keeps its own click, and a
  // click that ends a text selection is not a visit.
  'open-skill': (el, event) => {
    if (event.target.closest('a, button') || String(getSelection())) return;
    location.hash = skillHash(el.dataset.skill);
  },
  filter: el => {
    state.filterMode = el.dataset.filter;
    render();
  },
  'target-filter': el => {
    state.targetFilter = state.targetFilter === el.dataset.target ? '' : el.dataset.target;
    render();
  },
  'reset-filters': () => {
    state.filterMode = 'all';
    state.searchQuery = '';
    state.targetFilter = '';
    render();
  },
  'focus-add': () => $('skills-quickadd-input')?.focus(),
  paste: () => pasteFromClipboardButton(),
  'new-open': () => openNewSkillDialog(),
  'new-cancel': () => {
    $('skills-new-dialog')?.close();
    $('skills-new-open')?.focus();
  },
  'choose-all': el => {
    if (!chooseState) return;
    chooseState.selected = new Set(el.dataset.all === '1' ? chooseState.availableSkills.map(i => i.subdir || i.slug) : []);
    renderChooseList();
  },
  'choose-cancel': () => {
    $('skills-choose-dialog')?.close();
    chooseState = null;
    $('skills-quickadd-input')?.focus();
  },
  'sync-all': () => runSyncAll(),
  'check-updates': () => runCheckUpdates(),
  'update-all': () => runUpdateAll(),
  'entry-sync': el => runEntrySync(el.dataset.slug),
  'entry-update': el => runEntryUpdate(el.dataset.slug),
  prefer: el => runDetailPreferSync(el.dataset.source),
  'detail-update': () => runDetailUpdate(),
  'detail-check': () => runCheckUpdates(state.detailSlug),
  'toggle-enabled': () => {
    const enable = state.detail?.skill?.enabled === false;
    configureCurrentSkill({ enabled: enable }, enable ? 'Skill resumed and linked across harnesses.' : 'Skill paused and unlinked.');
  },
  'set-mode': el => {
    const skill = state.detail?.skill;
    if (el.dataset.mode === 'project') {
      const current = (skill?.projects || []).map(p => p.projectId);
      const first = state.detail?.projects?.[0]?.id;
      configureCurrentSkill({
        scope: 'project',
        projects: current.length ? current : (first ? [first] : []),
      }, 'Scoped skill to selected project repositories.');
    } else if (el.dataset.mode === 'custom') {
      const wanted = (skill?.instances || []).filter(i => i.wanted).map(i => i.targetId);
      configureCurrentSkill({ scope: 'global', targetMode: 'custom', targets: wanted }, 'Switched to custom harnesses for this skill.');
    } else {
      configureCurrentSkill({ scope: 'global', targetMode: 'global', excludedTargets: [] }, 'Following global harness defaults.');
    }
  },
  'md-toggle': () => {
    if (state.mdEditing) {
      if (!discardDraft()) return;
    } else {
      state.mdEditing = true;
      mdBaseDigest = state.detail?.skill?.digest || null;
    }
    render();
    (state.mdEditing ? $('skills-md-editor') : $('skills-md-toggle'))?.focus();
  },
  'md-cancel': () => {
    if (!discardDraft()) return;
    render();
    $('skills-md-toggle')?.focus();
  },
  'md-save': () => saveMarkdown(),
  'open-file': el => toggleCompanionFile(el.dataset.path),
  'entry-remove': el => removeSkill(el.dataset.slug),
  'settings-save': el => saveDefaults(el),
};

function onClick(event) {
  const el = event.target.closest('[data-act]');
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.act]?.(el, event);
}

function onInput(event) {
  const target = event.target;
  if (target.id === 'skills-quickadd-input') {
    state.quickInput = target.value;
    const hint = $('skills-add-hint');
    if (hint) hint.innerHTML = addHintHtml(target.value);
  } else if (target.id === 'skills-search-input') {
    state.searchQuery = target.value;
    render();
  } else if (target.id === 'skills-md-editor') {
    if (state.mdDraft === null) mdBaseDigest = state.detail?.skill?.digest || null;
    state.mdDraft = target.value;
    const bytes = skillsByteLength(state.mdDraft);
    const over = bytes > SKILL_MD_LIMIT;
    const countEl = $('skills-md-count');
    if (countEl) {
      countEl.textContent = skillsCountLabel(bytes);
      countEl.classList.toggle('is-over', over);
    }
    const saveEl = $('skills-md-save');
    if (saveEl) saveEl.disabled = over || Boolean(state.busyKey);
  } else if (target.id === 'skills-source-url') {
    state.sourceUrlDraft = target.value;
  }
}

function onChange(event) {
  const target = event.target;
  const skill = state.detail?.skill;
  if (target.id === 'skills-quickadd-scope') {
    state.quickScope = target.value;
  } else if (target.dataset.change === 'interval') {
    updateIntervalSetting(target.value);
  } else if (target.dataset.skillsChoiceKey !== undefined && chooseState) {
    const key = target.dataset.skillsChoiceKey;
    if (target.checked) chooseState.selected.add(key);
    else chooseState.selected.delete(key);
    renderChooseList();
  } else if (target.dataset.skillsToggleTarget !== undefined && skill) {
    const wanted = new Set((skill.instances || []).filter(i => i.wanted).map(i => i.targetId));
    if (target.checked) wanted.add(target.dataset.skillsToggleTarget);
    else wanted.delete(target.dataset.skillsToggleTarget);
    configureCurrentSkill({
      scope: 'global',
      targetMode: 'custom',
      targets: [...wanted],
    }, 'Updated synced harnesses for this skill.');
  } else if (target.dataset.skillsToggleProject !== undefined && skill) {
    const attached = new Set((skill.projects || []).map(p => p.projectId));
    if (target.checked) attached.add(target.dataset.skillsToggleProject);
    else attached.delete(target.dataset.skillsToggleProject);
    configureCurrentSkill({
      scope: skill.scope === 'project' && !attached.size ? 'global' : skill.scope,
      projects: [...attached],
    }, 'Updated project links for this skill.');
  }
}

const FORMS = {
  install: () => submitQuickInstall(),
  choose: () => confirmChooseInstall(),
  create: form => submitNewSkill(form),
  'save-source': form => saveSourceUrl(form),
};

function onSubmit(event) {
  const submit = FORMS[event.target.dataset.form];
  if (!submit) return;
  event.preventDefault();
  submit(event.target);
}

// Focus counts as pointing, so the keyboard lights a harness the same way
// the pointer does.
function onPoint(event) {
  const from = event.target;
  if (!(from instanceof Element)) return;
  setHot(from.closest('[data-target]')?.dataset.target || '');
}

function wire(view) {
  if (wired) return;
  wired = true;
  view.addEventListener('click', onClick);
  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  view.addEventListener('submit', onSubmit);
  view.addEventListener('pointerover', onPoint);
  view.addEventListener('focusin', onPoint);
  view.addEventListener('pointerleave', () => setHot(''));
  view.addEventListener('focusout', () => setHot(''));
}

function interceptSkillsRoute(nextHash) {
  if (!active || !state.detailSlug || state.mdDraft === null) return null;
  const targetSlug = slugFromHash(nextHash);
  if (targetSlug === state.detailSlug) return null;
  if (!confirm('Discard your unsaved changes to SKILL.md?')) {
    history.replaceState(history.state, '', skillHash(state.detailSlug));
    return { stop: true };
  }
  state.mdDraft = null;
  mdBaseDigest = null;
  state.mdEditing = false;
  return null;
}

function slugFromHash(hash) {
  const path = String(hash || '').replace(/^#/, '');
  if (!path.startsWith(SKILLS_HASH + '/')) return '';
  const raw = path.slice(SKILLS_HASH.length + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Settings' scroller, which the screen scrolls inside now that it is a tab.
const scroller = () => $('settings-view') || section;

export function showSkills(hash = '#' + SKILLS_HASH) {
  const path = String(hash || '').replace(/^#/, '') || SKILLS_HASH;
  const host = document.querySelector('[data-settings-tab-host="skills"]');
  if (!section || !host) return;
  if (section.parentNode !== host) host.replaceChildren(section);
  wire(section);
  section.hidden = false;

  const changed = viewHash !== path;
  const fromSkill = active && Boolean(state.detailSlug);
  active = true;
  viewHash = path;

  const slug = slugFromHash(path);
  if (slug !== state.detailSlug) {
    const kept = state.detail?.skill?.slug === slug ? state.detail : null;
    if (!state.detailSlug) listScrollBeforeSkill = scroller().scrollTop;
    resetDetailState();
    state.detailSlug = slug;
    state.detail = kept;
    hotTarget = '';
  }
  if (changed) entered = false;
  render();
  if (changed) {
    if (slug || fromSkill) scroller().scrollTop = !slug && fromSkill ? listScrollBeforeSkill : 0;
    if (pendingFocusAdd && !slug) {
      pendingFocusAdd = false;
      $('skills-quickadd-input')?.focus({ preventScroll: true });
    } else if (slug || fromSkill) {
      // Opening the tab leaves focus with Settings' tab row, so arrowing
      // through the tabs keeps working; a move inside Skills takes it.
      $('skills-title')?.focus({ preventScroll: true });
    }
  }
  if (slug) loadDetail(slug);
  loadSnapshot();
}

export function hideSkills() {
  active = false;
  viewHash = '';
  listReq++;
  detailReq++;
  $('skills-choose-dialog')?.close?.();
  $('skills-new-dialog')?.close?.();
  if (section) section.hidden = true;
}

const isSkillsHash = hash => hash === '#' + SKILLS_HASH || hash.startsWith(`#${SKILLS_HASH}/`);

export async function activate({ signal, base, commands, view: registerView }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'skills.css';
  style.dataset.skillsStyle = '';
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

  // Skills is part of Orc: Settings has a Skills tab, and this screen is drawn
  // into it whenever the address is `#settings/skills` or a skill's page.
  section = document.createElement('section');
  section.id = 'skills-view';
  section.setAttribute('aria-labelledby', 'skills-title');
  section.hidden = true;

  const openSkills = () => { location.hash = SKILLS_HASH; };
  commands(() => [
    {
      label: 'Open Skills',
      sub: 'Settings → Skills: global and project skills across Carbon, Codex, .agents and Claude',
      action: openSkills,
    },
    {
      label: 'Add skill from link',
      sub: 'Paste a GitHub repo, skills.sh URL, or owner/repo shorthand',
      action: () => {
        if (active && !state.detailSlug) {
          $('skills-quickadd-input')?.focus();
          return;
        }
        pendingFocusAdd = true;
        openSkills();
      },
    },
    ...(canManage(state) ? [
      {
        label: 'Sync all skills',
        sub: 'Link every skill into your harnesses and Claude logins, keeping the newest copy where copies differ',
        action: async () => {
          if (!active || state.detailSlug) openSkills();
          await runSyncAll();
        },
      },
      {
        label: 'Check skill updates',
        sub: 'Probe upstream GitHub repositories and URLs for newer skill versions',
        action: async () => {
          if (!active || state.detailSlug) openSkills();
          await runCheckUpdates();
        },
      },
    ] : []),
  ]);

  registerView({ hash: SKILLS_HASH, subroutes: true, show: showSkills, hide: hideSkills, intercept: interceptSkillsRoute, leave: interceptSkillsRoute });

  document.addEventListener('paste', onDocumentPaste, { signal });
  document.addEventListener('visibilitychange', () => {
    if (!active || document.hidden) return;
    if (state.detailSlug) loadDetail(state.detailSlug);
    else loadSnapshot({ quietDueCheck: false });
  }, { signal });
  window.addEventListener('orc:account-sign-in', () => {
    if (active) loadSnapshot({ quietDueCheck: false });
  }, { signal });
  window.addEventListener('beforeunload', event => {
    if (active && state.mdDraft !== null) {
      event.preventDefault();
      event.returnValue = '';
    }
  }, { signal });
  window.addEventListener('pagehide', hideSkills, { signal });
  window.addEventListener('pageshow', event => {
    if (event.persisted && isSkillsHash(location.hash)) showSkills(location.hash);
  }, { signal });

  return () => {
    hideSkills();
    tablesWatch?.disconnect();
    tablesWatch = null;
    section.remove();
    section = null;
    style.remove();
    wired = false;
    pluginSignal = null;
    state.snapshot = null;
    state.listError = '';
    state.detailSlug = '';
    state.busyKey = '';
    keepFocus = '';
    chooseState = null;
    paintedMode = '';
    painted.clear();
    linkStates = null;
    trackedSnapshot = null;
    hotTarget = '';
    clearTimeout(enterTimer);
    resetDetailState();
    delete state.sectionStatus.list;
    state.removing.clear();
    if (isSkillsHash(location.hash)) location.hash = 'settings';
  };
}
