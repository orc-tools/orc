// orc-ui: Confirm / queue / worktree dialogs raised from the run list and Run Control.

import { ncSwitchProject, refresh, route } from './activity.js';
import { controlRefresh, setControlStatus } from './control.js';
import { $, announce, esc, nativeInput, runs, setRuns, showToast, toast } from './core.js';
import { focusControl, renderList } from './filters.js';
import { evalsPickOffer, evalsPickOfferHtml } from './evals-panel.js';
import { playingScene } from './page-scene.js';
import { attachPathComplete } from './path-complete.js';
const deleteDialog = $('delete-dialog');
let deleteTarget = null;
export function deleteRun(id) {
  deleteTarget = id;
  const run = runs.find(r => r.id === id);
  $('delete-run-name').textContent = (run && run.meta && run.meta.title) || id;
  $('delete-run-id').textContent = id;
  $('delete-scope').innerHTML = 'Removes the whole run folder from <code>~/.orc/runs</code> — plan, reports, recap, screenshots, decisions, and version history.';
  deleteDialog.show();
}
$('delete-cancel').onclick = () => deleteDialog.close();
$('delete-confirm').onclick = async () => {
  const id = deleteTarget;
  deleteDialog.close();
  if (!id) return;
  const res = await fetch('/api/runs/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.json().then(b => b && b.error, () => null);
    return alert(detail ? `Failed to delete run: ${detail}` : 'Failed to delete run.');
  }
  setRuns(runs.filter(r => r.id !== id));
  renderList();
  announce(`Deleted run ${id}`);
  // the trigger no longer exists after renderList — native dialog focus
  // restore lands on <body>; keep keyboard/SR focus in the list instead
  if (!document.activeElement || document.activeElement === document.body) {
    const next = document.querySelector('#list .run-link');
    (next || $('search')).focus();
  }
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === id) {
    location.hash = '';
    $('empty').hidden = false;
    $('head').hidden = $('tabs').hidden = $('content').hidden = $('version-banner').hidden = true;
  }
};

const cancelDialog = $('cancel-dialog');
let cancelTarget = null;
let cancelDone = null;

// re-render list + (if the changed run is open) its detail, from the local cache
export function reflectRunChange(id) {
  renderList();
  if (decodeURIComponent(location.hash.slice(1).split('/')[0] || '') === id) route();
}

export async function changeRunPause(id, action) {
  const response = await fetch(`/runs/${encodeURIComponent(id)}/focus`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  }).catch(() => null);
  if (!response?.ok) {
    const error = response && (await response.json().catch(() => ({}))).error;
    toast(error || 'Could not update the run pause.', { tone: 'error' });
    return;
  }
  announce(action === 'resume' ? 'Run resumed' : 'Run paused');
  await refresh({ force: true });
  reflectRunChange(id);
}

export function openCancel(id, { onCancelled = null } = {}) {
  cancelTarget = id;
  cancelDone = onCancelled;
  $('cancel-run-id').textContent = id;
  $('cancel-input').value = '';
  $('cancel-confirm').disabled = false;
  cancelDialog.show();
  $('cancel-input').focus();
}
$('cancel-dismiss').onclick = () => cancelDialog.close();
$('cancel-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('cancel-confirm').click(); }
});
// Cancels one run and mirrors it into the local cache. Resolves to the
// server's reply, or `{ error }` when the run was not cancelled.
async function postCancel(id, reason) {
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
  } catch { res = null; }
  if (!res || !res.ok) {
    const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
    return { error: msg || 'Failed to cancel run.' };
  }
  const run = runs.find(r => r.id === id);
  if (run && run.meta) {
    run.meta.status = 'cancelled';
    if (reason) run.meta.cancelReason = reason;
  }
  return res.json().catch(() => ({}));
}

// A session nobody interrupted keeps working until it reads its stop-work
// notice. `cancelled` is the sentence opener: "Run cancelled", "2 runs cancelled".
// It goes in a toast that stays until dismissed: the Cancel dialog remains the
// only modal, and the warning cannot slip by unread.
async function surfaceStopNotices(cancelled, notes) {
  const note = notes.join('\n\n');
  const one = notes.length === 1;
  let copied = true;
  try { await navigator.clipboard.writeText(note); } catch { copied = false; }
  const which = one ? 'its agent is' : `${notes.length} agents are`;
  const where = one ? 'its session' : 'each session';
  const what = one ? 'the stop-work notice' : 'the stop-work notices';
  toast(`${cancelled}, but ${which} still working`, {
    tone: 'error',
    duration: Infinity,
    description: copied
      ? `Paste ${what} on your clipboard into ${where} to stop it.`
      : `Paste this into ${where} to stop it:\n\n${note}`,
  });
}

$('cancel-confirm').onclick = async () => {
  const id = cancelTarget;
  const done = cancelDone;
  if (!id) return;
  const reason = $('cancel-input').value.trim();
  $('cancel-confirm').disabled = true;
  const { error, stopped, closed, note } = await postCancel(id, reason);
  if (error) {
    $('cancel-confirm').disabled = false;
    return showToast(error);
  }
  cancelDialog.close();
  reflectRunChange(id);
  done?.(id);
  if (!stopped && note) return surfaceStopNotices('Run cancelled', [note]);
  announce(closed ? 'Run cancelled — agent stopped'
    : stopped ? 'Run cancelled — session interrupted' : 'Run cancelled');
};

// Raised by a Ship bar as soon as its merge is accepted (the merge-queue reply
// in serve.py): merging one eval candidate picks it, so offer to cancel the
// rest. The offer is read from the list as it stands then, and shown once a
// Yeet scene playing over the window has ended.
const evalsPickDialog = $('evals-pick-dialog');
let evalsPick = null;
async function offerCancelOtherCandidates(runId) {
  const offer = evalsPickOffer(runId, runs);
  if (!offer) return;
  await playingScene()?.finished;
  evalsPick = offer;
  const one = evalsPick.others.length === 1;
  $('evals-pick-body').innerHTML = evalsPickOfferHtml(evalsPick);
  $('evals-pick-confirm').textContent = one ? 'Cancel the other candidate' : `Cancel the other ${evalsPick.others.length} candidates`;
  $('evals-pick-dismiss').textContent = one ? 'Keep it running' : 'Keep them running';
  $('evals-pick-confirm').disabled = false;
  evalsPickDialog.show();
}
window.orcMergeRequested = offerCancelOtherCandidates;
$('evals-pick-dismiss').onclick = () => evalsPickDialog.close();
// A link to a candidate leaves the choice for later rather than under the modal.
$('evals-pick-body').addEventListener('click', event => { if (event.target.closest('a')) evalsPickDialog.close(); });
// One refusal never stops the rest.
$('evals-pick-confirm').onclick = async () => {
  const offer = evalsPick;
  if (!offer) return;
  $('evals-pick-confirm').disabled = true;
  const failed = [];
  const notes = [];
  let done = 0;
  for (const other of offer.others) {
    const { error, stopped, note } = await postCancel(other.id, offer.reason);
    if (error) { failed.push(`${other.label}: ${error}`); continue; }
    done += 1;
    if (!stopped && note) notes.push(note);
  }
  evalsPickDialog.close();
  renderList();
  const cancelled = `${done} other candidate${done === 1 ? '' : 's'} cancelled`;
  if (failed.length) alert(`${cancelled}. Not cancelled:\n\n${failed.join('\n')}`);
  if (notes.length) return surfaceStopNotices(cancelled, notes);
  announce(cancelled);
};

const linkPrDialog = $('link-pr-dialog');
let linkPrTarget = null;

function isValidPrUrl(url) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url);
}

// caps and autofill opt-outs belong on the real fields inside the elements
nativeInput($('cancel-input'), { maxlength: '500', autocomplete: 'off' });
nativeInput($('link-pr-input'), { autocomplete: 'off' });
function setLinkPrError(msg) {
  const el = $('link-pr-error');
  el.textContent = msg || '';
  el.hidden = !msg;
  nativeInput($('link-pr-input'), { 'aria-invalid': msg ? 'true' : 'false' });
}

export function openLinkPr(id) {
  linkPrTarget = id;
  $('link-pr-input').value = '';
  setLinkPrError('');
  $('link-pr-confirm').disabled = false;
  linkPrDialog.show();
  $('link-pr-input').focus();
}
$('link-pr-cancel').onclick = () => linkPrDialog.close();
$('link-pr-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('link-pr-confirm').click(); }
});
$('link-pr-confirm').onclick = async () => {
  const id = linkPrTarget;
  if (!id) return;
  const prUrl = $('link-pr-input').value.trim();
  if (!isValidPrUrl(prUrl)) {
    setLinkPrError('Enter a valid GitHub PR URL (https://github.com/org/repo/pull/123).');
    $('link-pr-input').focus();
    return;
  }
  $('link-pr-confirm').disabled = true;
  const result = await patchRunOrError(id, { prUrl });
  if (!result.ok) {
    $('link-pr-confirm').disabled = false;
    setLinkPrError(result.error);
    $('link-pr-input').focus();
    return;
  }
  linkPrDialog.close();
  const run = runs.find(r => r.id === id);
  if (run) { run.meta = run.meta || {}; run.meta.prUrl = prUrl; }
  reflectRunChange(id);
  announce('PR linked');
};

// ---- add project modal ----
// Project home's way in for a machine with no projects yet; Settings keeps its
// own Add repo row for bulk setup.
const addProjectDialog = $('add-project-dialog');
const ADD_PROJECT_HINT = $('add-project-hint').textContent;
// { cloneDir } while gh is signed in to GitHub, else null: the dialog then
// takes folder paths only and never mentions GitHub.
let addProjectGithub = null;
let addProjectPicked = null;
let addProjectAskDir = false;
let addProjectOpening = 0;
const githubRepoName = text => {
  const match = /^(?:(?:https?:\/\/|ssh:\/\/git@)github\.com\/|git@github\.com:)?([a-z\d][a-z\d-]*)\/([\w.][\w.-]*?)(?:\.git)?\/?$/i.exec(text.trim());
  return match ? `${match[1]}/${match[2]}` : '';
};
// The repo the field names: the one picked from the list, or a typed
// owner/name or GitHub URL.
function addProjectRepo() {
  if (!addProjectGithub) return null;
  const text = $('add-project-input').value.trim();
  if (addProjectPicked && addProjectPicked.name === text) return addProjectPicked;
  const name = githubRepoName(text);
  return name ? { name, project: null } : null;
}
function setAddProjectError(msg) {
  const el = $('add-project-error');
  el.textContent = msg || '';
  el.hidden = !msg;
  nativeInput($('add-project-input'), { 'aria-invalid': msg ? 'true' : 'false' });
}
function renderAddProjectClone() {
  const repo = addProjectRepo();
  const cloning = repo && !repo.project;
  const dir = addProjectGithub?.cloneDir;
  const askDir = Boolean(cloning && (addProjectAskDir || !dir));
  $('add-project-clone').hidden = !repo || askDir;
  $('add-project-clone-change').hidden = !cloning;
  $('add-project-dir-row').hidden = !askDir;
  if (repo?.project) $('add-project-clone-text').textContent = `${repo.name} is already on this machine at ${repo.project}.`;
  else if (cloning && !askDir) $('add-project-clone-text').textContent = `Clones into ${dir}/${repo.name.split('/')[1]}.`;
  if (askDir) $('add-project-dir-label').textContent = `Folder to clone ${repo.name} into`;
  $('add-project-confirm').textContent = cloning ? 'Clone and add' : 'Add project';
}
async function searchAddProjectRepos(query) {
  try {
    const res = await fetch('/api/github-repos?q=' + encodeURIComponent(query));
    return res.ok ? (await res.json()).repos || [] : [];
  } catch {
    return [];
  }
}
nativeInput($('add-project-input'), { autocomplete: 'off', spellcheck: 'false' });
nativeInput($('add-project-dir'), { autocomplete: 'off', spellcheck: 'false' });
const addProjectComplete = attachPathComplete($('add-project-input'), {
  repos: {
    search: query => (addProjectGithub ? searchAddProjectRepos(query) : []),
    pick(repo) {
      addProjectPicked = repo;
      $('add-project-input').value = repo.name;
      setAddProjectError('');
      renderAddProjectClone();
    },
  },
});
attachPathComplete($('add-project-dir'));
$('add-project-input').addEventListener('input', renderAddProjectClone);
$('add-project-clone-change').onclick = () => {
  addProjectAskDir = true;
  $('add-project-dir').value = addProjectGithub?.cloneDir ? `${addProjectGithub.cloneDir}/` : '';
  renderAddProjectClone();
  $('add-project-dir').focus();
};

export function openAddProject(path = '') {
  $('add-project-input').value = path;
  $('add-project-dir').value = '';
  addProjectPicked = null;
  addProjectAskDir = false;
  setAddProjectError('');
  $('add-project-confirm').disabled = false;
  renderAddProjectClone();
  addProjectDialog.show();
  $('add-project-input').focus();
  const mine = ++addProjectOpening;
  fetch('/api/github-repos').then(res => (res.ok ? res.json() : null)).catch(() => null).then(body => {
    if (mine !== addProjectOpening) return;
    addProjectGithub = body?.available ? { cloneDir: body.cloneDir || '' } : null;
    $('add-project-hint').textContent = addProjectGithub
      ? 'Type a project’s name to find its folder on this machine or its repo on GitHub, or paste a path. Orc starts new conversations there.'
      : ADD_PROJECT_HINT;
    renderAddProjectClone();
    // A name carried in from the palette lists its matches straight away.
    if (path) addProjectComplete?.suggest();
  });
}
window.orcOpenAddProject = openAddProject;
$('add-project-cancel').onclick = () => addProjectDialog.close();
for (const id of ['add-project-input', 'add-project-dir']) {
  $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('add-project-confirm').click(); }
  });
}
$('add-project-confirm').onclick = async () => {
  const path = $('add-project-input').value.trim();
  const repo = addProjectRepo();
  const cloning = repo && !repo.project;
  const askDir = !$('add-project-dir-row').hidden;
  const dir = $('add-project-dir').value.trim();
  if (!path) {
    setAddProjectError('Type a project’s name and pick it from the list, or enter the path of a folder, like ~/Projects/my-repo.');
    $('add-project-input').focus();
    return;
  }
  const windowsPath = window.ORC_INSTANCE?.windows && /^(?:[A-Z]:[\\/]|\\\\(?:wsl\.localhost|wsl\$)\\)/i.test(path);
  if (!repo && !windowsPath && !/^~?\//.test(path)) {
    setAddProjectError(`Pick a folder${addProjectGithub ? ' or repo' : ''} from the list, or enter the path of a folder, like ~/Projects/my-repo.`);
    $('add-project-input').focus();
    return;
  }
  if (cloning && askDir && !dir) {
    setAddProjectError('Enter the folder to clone into, like ~/Projects.');
    $('add-project-dir').focus();
    return;
  }
  $('add-project-confirm').disabled = true;
  if (cloning) $('add-project-confirm').textContent = 'Cloning…';
  setAddProjectError('');
  let body = {};
  try {
    const res = await fetch(cloning ? '/api/project-clone' : '/api/project-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloning ? { repo: repo.name, ...(askDir ? { dir } : {}) } : { path: repo?.project || path }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  } catch (e) {
    $('add-project-confirm').disabled = false;
    // The server could not tell where this machine keeps its projects.
    if (body.code === 'clone-dir-needed') {
      addProjectAskDir = true;
      if (addProjectGithub) addProjectGithub.cloneDir = '';
    }
    renderAddProjectClone();
    setAddProjectError(cloning ? `Couldn’t clone ${repo.name}: ${e.message}` : `Couldn’t add project: ${e.message}`);
    (cloning && !$('add-project-dir-row').hidden ? $('add-project-dir') : $('add-project-input')).focus();
    return;
  }
  addProjectDialog.close();
  ncSwitchProject(body.key);
  announce(body.cloned ? `Cloned and added ${body.key}` : body.added ? `Added ${body.key}` : `${body.key} is already a project`);
};

// ---- merge queue modal ----
// A print-queue view of the repo's merge queue: every entry read from queue
// authority via the run's own /api/runs/<id>/merge-queue, removed via the
// existing DELETE. An actively merging entry has no Remove — the server
// refuses it, and the refusal text is what shows if it races.
const queueDialog = $('queue-dialog');
let queueDialogRun = null;
const QUEUE_ICON = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const QUEUE_BRANCH_ICON = QUEUE_ICON('<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>');
const QUEUE_MERGE_ICON = QUEUE_ICON('<circle cx="6" cy="5" r="3"/><path d="M6 8v10M18 8a6 6 0 0 1-6 6H6"/><circle cx="6" cy="21" r="2"/><circle cx="18" cy="5" r="3"/>');
// held across removals: the chip leaves the DOM when there is no project, so
// there is nothing left to look up by id
const queueProjectChip = $('queue-project');
function setQueueProject(project) {
  queueProjectChip.textContent = project || '';
  if (project) queueDialog.prepend(queueProjectChip);
  else queueProjectChip.remove();
}

export function openQueueDialog(id) {
  queueDialogRun = id;
  $('queue-error').hidden = true;
  setQueueProject('');
  $('queue-list').innerHTML = '<li class="queue-empty">Loading…</li>';
  queueDialog.open = true;
  renderQueueDialog();
}

async function renderQueueDialog() {
  const id = queueDialogRun;
  if (!id) return;
  let state = null;
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(id)}/merge-queue`, { cache: 'no-store' });
    if (res.ok) state = await res.json();
  } catch { state = null; }
  if (!queueDialog.open || queueDialogRun !== id) return;   // closed/reopened while fetching
  // one queue is one repo, so the project names the whole view rather than each row
  const project = state && state.project;
  setQueueProject(project);
  // a fail-closed queue (malformed state) answers 200 without entries — say so
  // instead of passing it off as an empty queue
  const unavailable = !state || state.state === 'unavailable';
  const entries = (state && state.entries) || [];
  if (unavailable || !entries.length) {
    $('queue-list').innerHTML = `<li class="queue-empty">${QUEUE_MERGE_ICON}<span>${unavailable
      ? esc((state && state.detail) || 'Queue unavailable.')
      : 'Nothing queued.'}</span></li>`;
    queueDialogPoll();
    return;
  }
  $('queue-list').innerHTML = entries.map(e => {
    const stuck = e.state === 'recovery-blocked';
    const conflicted = Boolean(e.conflictsWithMain) || e.state === 'waiting-conflict' || e.state === 'blocked-conflict';
    const classes = [e.runId === id && 'queue-current',
                     conflicted && 'queue-conflict',
                     !e.removable && (stuck ? 'queue-stuck' : 'queue-merging')].filter(Boolean);
    return `
    <li${classes.length ? ` class="${classes.join(' ')}"` : ''}>
      <span class="queue-pos">${e.position}</span>
      <span class="queue-run">
        <a href="#${encodeURIComponent(e.runId)}">${esc(e.title)}</a>
        <span class="queue-branch">${QUEUE_BRANCH_ICON}<span>${esc(e.branch)}</span></span>
        ${queueRowDetail(e)}
      </span>
      ${e.removable
        ? `<button type="button" class="queue-remove" data-remove="${esc(e.runId)}"
             aria-label="Remove ${esc(e.title)} from the merge queue">Remove</button>`
        : `<span class="queue-state">${stuck ? '' : '<span class="dot pulse" aria-hidden="true"></span>'}${esc(queueRowLabel(e))}</span>`}
    </li>`;
  }).join('');
  queueDialogPoll();
}

// The merge runs in-process with nothing watching it, so "Merging…" alone
// cannot tell a healthy head from a wedged one. The age does: a merge still
// going after several minutes is the signal to read the run's merge-main.log.
// A recovery-blocked head still holds its claim, so it is unremovable too —
// it must not borrow the healthy label and read as merely slow.
function queueRowLabel(e) {
  if (e.state === 'recovery-blocked') return 'Stuck';
  if (e.state !== 'active') return 'Merging…';
  const age = elapsedSince(e.claimedAt);
  return age ? `Merging… ${age}` : 'Merging…';
}

// Only the states that need explanation get a line of their own —
// "Waiting behind 2 queued runs" is already obvious from the position column.
const QUEUE_BAD_STATES = ['recovery-blocked', 'delivery-unavailable',
                          'blocked-conflict', 'waiting-conflict', 'waiting-conflict-resolution',
                          'blocked-active-merge', 'waiting-checkout'];
function queueRowDetail(e) {
  if (e.state === 'retry-waiting') {
    return [
      e.detail,
      e.lastFailure ? `Last attempt: ${e.lastFailure}` : '',
      e.mergeBlocker ? `Current blocker: ${e.mergeBlocker}` : '',
    ].filter(Boolean).map(detail =>
      `<span class="queue-detail">${esc(detail)}</span>`).join('');
  }
  const lines = [];
  if ((QUEUE_BAD_STATES.includes(e.state) || e.conflictsWithMain) && e.detail) {
    lines.push(`<span class="queue-detail">${esc(e.detail)}</span>`);
  }
  if (Array.isArray(e.regeneratedFiles) && e.regeneratedFiles.length) {
    lines.push(`<span class="queue-regen">Regenerates ${esc(e.regeneratedFiles.slice(0, 3).join(', '))} on merge</span>`);
  }
  return lines.join('');
}

// Coarse on purpose: this answers "is it stuck?", not "how long exactly".
function elapsedSince(stamp) {
  const started = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(started)) return '';
  const mins = Math.floor((Date.now() - started) / 60000);
  if (mins < 1) return '';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
}

// A queue only changes from the outside — the dispatcher tick, another run
// landing — so the open dialog has to ask again or it lies the moment it
// renders. One timer, cleared on close, never stacked. A re-render replaces
// the whole list, so it waits while focus is inside it rather than yanking a
// keyboard user off the Remove button they were about to press.
let queuePollTimer = null;
function queueDialogPoll() {
  clearTimeout(queuePollTimer);
  if (!queueDialog.open || !queueDialogRun) return;
  queuePollTimer = setTimeout(() => {
    if ($('queue-list').contains(document.activeElement)) return queueDialogPoll();
    renderQueueDialog();
  }, 5000);
}

$('queue-list').onclick = async e => {
  if (e.target.closest('a')) return closeQueueDialog();   // navigating to that run
  const btn = e.target.closest('button[data-remove]');
  if (!btn) return;
  btn.disabled = true;
  $('queue-error').hidden = true;
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(btn.dataset.remove)}/merge-queue`, { method: 'DELETE' });
  } catch { res = null; }
  if (!res || !res.ok) {
    const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
    $('queue-error').textContent = msg || 'Could not remove that run from the queue.';
    $('queue-error').hidden = false;
  } else {
    announce('Removed from the merge queue');
    // The open gate page renders Remove from queue / Merge to main from queue
    // state at request time, so it goes stale the moment this dialog drops an
    // entry. Same refresh the palette's Clear merge queue does — and it runs
    // before the focus restore below, so nothing route() touches steals focus.
    try { await refresh({ force: true }); } catch {}
    reflectRunChange(btn.dataset.remove);
  }
  await renderQueueDialog();
  // the clicked button is gone with the re-render — keep focus inside the dialog
  if (queueDialog.open) focusControl($('queue-close'));
};

function closeQueueDialog() {
  queueDialogRun = null;
  clearTimeout(queuePollTimer);
  if (queueDialog.open) queueDialog.close();
}
$('queue-close').onclick = closeQueueDialog;
queueDialog.addEventListener('close', () => {
  queueDialogRun = null;
  clearTimeout(queuePollTimer);
});

// Empty a run's repo merge queue in one action — the palette counterpart to the
// queue dialog's per-row Remove. There is no bulk endpoint, so this reuses the
// same per-run DELETE the dialog uses over every removable entry; an actively
// merging (claimed) entry is skipped because the server refuses it anyway.
export async function clearMergeQueue(id) {
  let state = null;
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(id)}/merge-queue`, { cache: 'no-store' });
    if (res.ok) state = await res.json();
  } catch { state = null; }
  // Distinguish a failed/unavailable read from a genuinely empty queue (same
  // check the queue dialog uses) so we never announce "empty" when we couldn't look.
  if (!state || state.state === 'unavailable') return announce('Could not load the merge queue');
  const removable = (state.entries || []).filter(e => e.removable);
  if (!removable.length) return announce('Merge queue is already empty');
  if (!confirm(`Remove ${removable.length} run${removable.length === 1 ? '' : 's'} from the merge queue?`)) return;
  let failed = 0;
  for (const e of removable) {
    try {
      const res = await fetch(`/runs/${encodeURIComponent(e.runId)}/merge-queue`, { method: 'DELETE' });
      if (!res.ok) failed++;
    } catch { failed++; }
  }
  announce(failed ? `Cleared merge queue; ${failed} could not be removed` : 'Merge queue cleared');
  try { await refresh({ force: true }); } catch {}
  reflectRunChange(id);
}
// ---- worktree app actions (start / stop / cleanup) ----
const wtCleanupDialog = $('wt-cleanup-dialog');
let wtCleanupTarget = null;

export function openWorktreeCleanup(id) {
  const run = runs.find(r => r.id === id);
  const wt = (run && run.meta && run.meta.worktree) || {};
  wtCleanupTarget = id;
  $('wt-cleanup-path').textContent = wt.path || '';
  $('wt-cleanup-branch').textContent = (run && run.meta && run.meta.branch) || '';
  wtCleanupDialog.show();
}
$('wt-cleanup-dismiss').onclick = () => wtCleanupDialog.close();
$('wt-cleanup-confirm').onclick = async () => {
  const id = wtCleanupTarget;
  if (!id) return;
  wtCleanupDialog.close();
  postWorktreeAction(id, 'cleanup', 'Cleaning up worktree…');
};

export async function postWorktreeAction(id, action, busyMsg) {
  announce(busyMsg);
  setControlStatus('control-worktree-status', busyMsg);
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/worktree-app`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
  } catch { res = null; }
  if (!res || !res.ok) {
    const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
    const detail = msg || `Failed to ${action} worktree app.`;
    announce(detail);
    setControlStatus('control-worktree-status', `${detail} Check the worktree state and try again.`, 'error');
    return;
  }
  setControlStatus('control-worktree-status', `${action === 'cleanup' ? 'Cleanup' : action === 'start' ? 'Start' : 'Stop'} requested.`, 'ok');
  await controlRefresh(id);
}

// With `typed`, the new tab holds that command at its prompt, unrun.
export async function postOpenTerminal(id, typed = '') {
  announce('Opening terminal…');
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/open-terminal`, typed
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: typed }) }
      : { method: 'POST' });
  } catch { res = null; }
  if (!res || !res.ok) {
    const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
    announce(msg || 'Failed to open terminal.');
    return;
  }
  const data = await res.json();
  document.dispatchEvent(new CustomEvent('orc-open-terminal-tab', { detail: { runId: id, index: data.terminalTab, herdrTab: data.herdrTab, warning: data.warning } }));
  announce(typed ? 'Typed into a new terminal tab. Press Enter there to run it.' : 'Terminal opened.');
}

export async function postProjectScript(id, script) {
  announce(`Running ${script.name}…`);
  let res;
  try {
    res = await fetch(`/runs/${encodeURIComponent(id)}/run-script`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: script.id }),
    });
  } catch { res = null; }
  if (!res || !res.ok) {
    const msg = res ? ((await res.json().catch(() => ({}))).error) : null;
    const error = msg || `Could not run ${script.name}.`;
    announce(error);
    return { ok: false, error };
  }
  const data = await res.json();
  document.dispatchEvent(new CustomEvent('orc-open-terminal-tab', { detail: { runId: id, index: data.terminalTab, herdrTab: data.herdrTab, warning: data.warning } }));
  announce(`${script.name} started in a new terminal tab.`);
  return { ok: true };
}

// the id that resumes a stopped session — each harness records its own id
export function resumeId(meta) {
  meta = meta || {};
  const harness = String(meta.harness || '').toLowerCase();
  if (!harness && meta.cursorSessionId) return undefined;
  if (harness === 'codex') return meta.codexThreadId;
  if (harness === 'claude') return meta.sessionId;
  if (harness) return undefined;
  return meta.sessionId;
}

export async function patchRun(id, body) {
  try {
    const res = await fetch('/api/runs/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    return true;
  } catch (_) {
    alert('Failed to update run.');
    return false;
  }
}

// Same PATCH as patchRun, but surfaces the server's error text instead of
// alert()ing — callers with an inline error slot (e.g. the Link PR dialog)
// need the detail to show next to the field, not in a modal.
export async function patchRunOrError(id, body) {
  try {
    const res = await fetch('/api/runs/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const detail = await res.json().catch(() => ({}));
    return { ok: false, error: (detail && detail.error) || 'Failed to update run.' };
  } catch (_) {
    return { ok: false, error: 'Failed to update run.' };
  }
}

// Add/remove a typed run-to-run link. Shared by the Cmd-K "Link run…" flow and
// the Control tab's Linked runs section, both of which surface the server's
// error text inline rather than alert()ing (mirrors patchRunOrError).
export async function postLinkAction(id, body) {
  try {
    const res = await fetch(`/runs/${encodeURIComponent(id)}/link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const detail = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, settled: detail?.settled === true };
    return { ok: false, error: (detail && detail.error) || 'Could not update the link. Try again.' };
  } catch (_) {
    return { ok: false, error: 'Could not update the link. Try again.' };
  }
}

// Resolve the PR URL(s) for a run. Frozen repository delivery (schemaVersion 1)
// is authoritative only when it actually yields PR URLs; if delivery is present
// but groupedPrs is empty, fall back to the flattened prUrls/prUrl fields (a
// compatibility projection for older clients). Shared by the detail header and
// the sidebar PR badge so both agree on which URL is "the" PR.
export function resolvePrUrls(meta, { observed = true } = {}) {
  meta = meta || {};
  const groupedDeliveryPresent = meta.delivery != null;
  const deliveryGroups = meta.delivery && meta.delivery.schemaVersion === 1
    && Array.isArray(meta.delivery.groups) ? meta.delivery.groups : [];
  const groupedPrs = deliveryGroups
    .filter(group => group && group.pr && typeof group.pr.url === 'string')
    .map(group => ({ url: group.pr.url, participantId: group.participantId,
      branch: group.branch, id: group.id }));
  const reviewedPr = meta.route === 'local-review' ? meta.review?.prUrl : null;
  // sourcePrUrl: the PR a branchless run started from, such as an answered review.
  // deliveryStatus.prUrl: the open PR the server found on a pushed run branch
  // that never recorded one, such as a run that pushed but never reached Ship.
  const branchPr = observed && !groupedDeliveryPresent ? meta.deliveryStatus?.prUrl : null;
  const urls = groupedDeliveryPresent && groupedPrs.length
    ? groupedPrs.map(item => item.url)
    : [].concat(meta.prUrls || meta.prUrl || reviewedPr || meta.sourcePrUrl || branchPr || []);
  return { urls, groupedPrs };
}

// Sidebar run-row PR badge — lives in .sub (outside the .run-link anchor;
// nesting anchors is invalid HTML and would truncate the run-link).
// GitHub octocat mark (Phosphor github-logo), matches the app's inline-SVG
// icon convention (viewBox 0 0 256 256, fill=currentColor).
export const GITHUB_MARK_SVG = '<svg class="pr-tag-icon" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68Z"></path></svg>';

function isGithubPrUrl(url) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#]|$)/.test(url || '');
}

// Shared PR-chip inner markup — the sidebar badge and the run-detail header
// chip both call this so the GitHub decision and glyph placement never
// diverge. GitHub PR URLs lead with the octocat mark, then the label;
// anything else keeps the plain trailing "↗" glyph.
export function prChipContent(url, label) {
  return isGithubPrUrl(url) ? `${GITHUB_MARK_SVG}${esc(label)}` : `${esc(label)} ↗`;
}

// Once a reviewer has the PR, the badge leads with the mark your team uses
// for that in Slack instead of the GitHub mark.
const PR_REVIEW_MARKS = {
  'picked-up': ['👀', 'picked up for review'],
  approved: ['✅', 'approved'],
};

// "Juan", "Juan and Kim", "Juan, Kim and Lee": the people a review state
// names, or '' when nobody is known.
const NAME_LIST = new Intl.ListFormat('en', { type: 'conjunction' });
export const peopleText = names => NAME_LIST.format((names || []).filter(name => typeof name === 'string' && name));
export const byPeople = names => (peopleText(names) ? ` by ${peopleText(names)}` : '');

export function prBadgeHtml(meta) {
  const { urls } = resolvePrUrls(meta);
  if (!urls.length) return '';
  const [mark, reviewStatus] = PR_REVIEW_MARKS[meta?.prReview?.state] || [];
  const status = reviewStatus && `${reviewStatus}${byPeople(meta.prReview.by)}`;
  const title = [urls.length > 1 ? `${urls.length} PRs — opens first` : '', status ? `PR ${status}` : ''].filter(Boolean).join(' · ');
  const content = mark ? `<span class="pr-tag-icon pr-tag-mark" aria-hidden="true">${mark}</span>PR` : prChipContent(urls[0], 'PR');
  return `<a class="pr-tag" href="${esc(urls[0])}" target="_blank" rel="noopener" aria-label="open PR in new tab${status ? `, ${status}` : ''}"${title ? ` title="${esc(title)}"` : ''}${mark ? ` data-review="${esc(meta.prReview.state)}"` : ''}>${content}</a>`;
}
