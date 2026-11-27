import { bindSidePanelNavigation } from './panel-navigation.js';
export { revealDiffPanel } from './panel-navigation.js';
import { DIFF_PREVIEW_BYTES } from './text-preview.js';
import { $, announce, esc, isQuestionRun, reviewsForRun, runs } from './core.js';
import { clearDiffViews, loadDiffsModule, renderDiffPanel } from './diff.js';
import { filesPanelAvailable, hideFilesPanel, showFilesPanel } from './files-panel.js';
import { showReviewPanel } from './review-panel.js';
import { showAnswerPanel } from './answer-panel.js';
import { hasDiagram, hasTechDoc, showDiagramPanel, showTechDocPanel } from './markdown-panel.js';
import { hasAssets, onRunDiffFiles, runDiffFiles, showAssetsPanel } from './assets-panel.js';
import { prBodyPaths, prPanelAvailable, retirePrPanelUnlessRun, showPrPanel } from './pr-panel.js';
import { hasEvals, showEvalsPanel } from './evals-panel.js';
import { shortcutMatches } from './shortcuts.js';
import { isFinalReady, isFlashcardRun, isPlanningComplete } from './run-presentation.js';

// panel-right, stroked like the other Run tools chips beside it. Its right
// half fills in while the panel is open.
export const DIFF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="side-panel-fill" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z" fill="currentColor" stroke="none"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>';
// The arrow after the button's label, saying it opens something.
const SIDE_PANEL_GO = '<svg class="side-panel-chip-go" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// The panel's state and wiring live in one closure, as the terminal's do: the
// module test reads every top-level name as app-wide.
let diffPanelOpen = false;
let diffPanelSync = () => {};
let diffPanelToggle = () => {};
const SIDE_PANEL_VIEWS = ['diff', 'files', 'pr', 'review', 'answer', 'diagram', 'techdoc', 'assets', 'evals'];
export function isDiffPanelOpen() { return diffPanelOpen; }
// Called on every openRun pass so route and poll updates reach whichever tab is open.
export function syncDiffPanel() { diffPanelSync(); }
export function toggleDiffPanel() { diffPanelToggle(); }
// A planning session whose questions are all answered (Plan ready, Start work)
// has nothing for the panel to show, so it gets neither the panel nor its chip.
export function sidePanelAvailable(run) { return !!run && !isPlanningComplete(run.meta); }

const diffPatchOf = run => run?.files.find(file => file.path === 'diff.patch') || null;
const diffUrl = (id, scope) => `/api/runs/${encodeURIComponent(id)}/diff?scope=${encodeURIComponent(scope)}`;
// BEGIN TESTABLE: diff panel width
// The panel never takes more than 70% of the window, and always leaves the
// run column `minRun` pixels beside the sidebar. A window too small for both
// still gets a usable panel.
function diffPanelMaxWidth(windowWidth, sidebar, min = 360, minRun = 360) {
  return Math.max(min, Math.min(Math.round(windowWidth * 0.7), windowWidth - sidebar - minRun));
}
function diffPanelClampWidth(width, windowWidth, sidebar, min = 360, minRun = 360) {
  const value = typeof width === 'number' && !Number.isNaN(width) ? width : 540;
  return Math.round(Math.min(diffPanelMaxWidth(windowWidth, sidebar, min, minRun), Math.max(min, value)));
}
// END TESTABLE: diff panel width

// BEGIN TESTABLE: side panel chip
// The header button reads what the panel holds. A branch with changes gives
// its file count, and the button adds the lines added and removed; a run with
// none names up to three of its results and a count of the rest.
function sidePanelChipText(files, results, shown = 3) {
  if (files > 0) return [`${files} ${files === 1 ? 'file' : 'files'}`];
  const parts = results.slice(0, shown);
  if (results.length > shown) parts.push(`+${results.length - shown}`);
  return parts;
}
// The run's whole diff, summed as Chat's changed-files card sums it.
function diffLineTotals(files) {
  return (files || []).reduce((sum, file) => ({
    additions: sum.additions + (file.additions || 0), deletions: sum.deletions + (file.deletions || 0),
  }), { additions: 0, deletions: 0 });
}
// END TESTABLE: side panel chip

// BEGIN TESTABLE: PR body reveal
// Whether the panel opens on Pull request by itself. `body` names the PR
// bodies as they stand ('' before one is written); `seen` is the body this
// browser last showed, `live` while the turn that showed it still runs. A body
// opens the panel as soon as it exists, but a sheet waits for Ship so it never
// covers a working Chat. Revisions within that turn update in place, and only
// a later turn's new or changed body opens a closed panel again.
function prBodyReveal(seen, { body, running, ready, sheet, showing }) {
  if (!body) return { open: false, seen };
  if (showing || seen?.live) return { open: false, seen: { body, live: running } };
  if (seen?.body === body || (sheet && !ready)) return { open: false, seen };
  return { open: true, seen: { body, live: running } };
}
// END TESTABLE: PR body reveal

// BEGIN TESTABLE: side panel run memory
// Panel state is kept for the most recently opened runs only, newest last, as
// the terminal keeps its open runs: one key per run would otherwise grow with
// every run this machine has ever made.
function rememberSidePanelRun(ids, id, max = 100) {
  const kept = ids.filter(other => other !== id);
  kept.push(id);
  return kept.slice(-max);
}
// END TESTABLE: side panel run memory

// BEGIN TESTABLE: side panel tab strip
// Keeps a selected tab inside the phone's single-row scrolling strip without
// moving the page. When another tab sits to its right, leave room for the
// right-edge fade so the selected label stays legible.
function panelTabScrollDelta({ stripLeft, stripRight, tabLeft, tabRight, padStart = 3, padEnd = 3 }) {
  if (tabLeft < stripLeft + padStart) return Math.floor(tabLeft - (stripLeft + padStart));
  if (tabRight > stripRight - padEnd) {
    return Math.min(Math.ceil(tabRight - (stripRight - padEnd)), Math.floor(tabLeft - (stripLeft + padStart)));
  }
  return 0;
}
function panelTabsHaveEndFade({ scrollWidth, clientWidth, scrollLeft }) {
  return scrollWidth - clientWidth - scrollLeft > 1;
}
// END TESTABLE: side panel tab strip

(() => {
  const OPEN_KEY = 'orcDiffPanelOpen:';
  const READY_KEY = 'orcSidePanelResultSeen:';
  const WIDTH_KEY = 'orcDiffPanelWidth';
  const RUNS_KEY = 'orcSidePanelRuns';
  const MAX_REMEMBERED_RUNS = 100;
  // Under this width the panel is a sheet over the run (ui/index.html).
  const sheetQuery = matchMedia('(max-width: 900px)');
  const phoneQuery = matchMedia('(max-width: 700px)');
  const backdrop = $('run-diff-backdrop');
  const MIN_WIDTH = 360;
  const TAB_PAD = 3;
  const TAB_FADE_CLEARANCE = 36;
  const panel = $('run-diff');
  const tabStrip = $('run-panel-tabs');
  const handle = $('run-diff-resize');
  const body = $('run-diff-body');
  const scopeSelect = $('run-diff-scope');
  const LIVE_POLL_MS = 2500;
  let loadedKey = null;
  let loadedRunId = null;
  let loadedScope = 'turn';
  let loadedEtag = null;
  let loadSeq = 0;
  let loadController = null;
  let returnFocus = null;
  let revealedTabKey = null;
  let userScrolledTabs = false;
  // Deliberately not persisted: a tab picked on one run, or in an earlier
  // session, would otherwise hide the next run's PR body.
  let chosenView = 'diff';

  // Maximized lays the panel over the chat. Not persisted, and dropped on a
  // run change or close: every run should open on its Chat.
  let maximized = false;

  let openRunId = null;
  const openByRun = new Map();
  const resultSeenByRun = new Map();
  const scopeByRun = new Map();

  const scopeFor = run => (run && scopeByRun.get(run.id)) || 'turn';
  const isLiveRun = run => !!run && (run.meta?.status === 'running' || run.activity === 'running');

  // Every run opens on what the person opening it came for: its result (the
  // answer or the PR body), else the diff. Questions live in Answer mode.
  function syncOpen(run) {
    const id = run?.id || null;
    if (id === openRunId) return;
    openRunId = id;
    maximized = false;
    chosenView = isQuestionRun(run) ? 'answer'
      : hasEvals(run) ? 'evals'
      : prPanelAvailable(run) ? 'pr' : 'diff';
    returnFocus = null;
    if (id) rememberRun(id);
    if (id && !openByRun.has(id)) {
      // An eval has no diff of its own: its panel is the comparison, so it
      // starts open until the user closes it.
      let open = hasEvals(run);
      try { open = (localStorage.getItem(OPEN_KEY + id) ?? (open ? '1' : '0')) === '1'; } catch {}
      openByRun.set(id, open);
    }
    diffPanelOpen = openByRun.get(id) || false;
  }

  // Moves a run to the newest end of the remembered list and drops the keys
  // of the runs that fall off it. The first pass after Orc starts also clears
  // keys left by runs the list no longer holds, such as every run's from
  // before the list existed.
  let swept = false;
  function rememberRun(id) {
    let ids = null;
    try { ids = JSON.parse(localStorage.getItem(RUNS_KEY)); } catch {}
    if (!Array.isArray(ids)) {
      ids = runs.filter(run => run.id !== id).sort((a, b) => (a.mtime || 0) - (b.mtime || 0)).map(run => run.id);
    } else if (swept && ids[ids.length - 1] === id) return;
    const kept = rememberSidePanelRun(ids, id, MAX_REMEMBERED_RUNS);
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(kept));
      const keep = new Set(kept);
      const stale = swept ? ids.filter(other => !keep.has(other)).flatMap(other => [OPEN_KEY + other, READY_KEY + other])
        : Object.keys(localStorage).filter(key => [OPEN_KEY, READY_KEY].some(prefix =>
          key.startsWith(prefix) && !keep.has(key.slice(prefix.length))));
      stale.forEach(key => localStorage.removeItem(key));
    } catch {}
    swept = true;
  }

  function currentRun() {
    const id = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
    return id && !$('head').hidden ? runs.find(run => run.id === id) || null : null;
  }

  function storedWidth() {
    let value = NaN;
    try { value = Number(localStorage.getItem(WIDTH_KEY)); } catch {}
    return value || 540;
  }
  function sidebarWidth() {
    // the sidebar is an overlay on narrow screens, where the panel is too
    const sidebar = $('run-sidebar');
    return getComputedStyle(sidebar).position === 'fixed' ? 0 : sidebar.getBoundingClientRect().width;
  }
  function setWidth(px, persist = true) {
    const width = diffPanelClampWidth(px, window.innerWidth, sidebarWidth(), MIN_WIDTH);
    panel.style.setProperty('--run-diff-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuemax', String(diffPanelMaxWidth(window.innerWidth, sidebarWidth(), MIN_WIDTH)));
    if (persist) { try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {} }
  }

  // The maximized panel starts at the run list's right edge, wherever a
  // collapse or a narrow window has left it.
  function syncMaximized() {
    const on = maximized && !panel.hidden;
    if (on) {
      const left = sidebarWidth() ? $('run-sidebar').getBoundingClientRect().right : 0;
      panel.style.setProperty('--run-diff-left', `${Math.round(left)}px`);
    }
    if (panel.classList.contains('maximized') === on) return;
    panel.classList.toggle('maximized', on);
    const button = $('run-diff-maximize');
    button.setAttribute('label', on ? 'Restore side panel' : 'Maximize side panel');
    button.querySelector('[data-icon="maximize"]').hidden = on;
    button.querySelector('[data-icon="restore"]').hidden = !on;
  }

  // Every tab the panel shows for a run, in the tab strip's order, with the
  // short name the header button gives a result.
  function panelTabs(run) {
    const card = isFinishedCard(run);
    return [
      { view: 'diff', label: 'Diff', shown: !card },
      { view: 'files', label: 'Files', shown: filesPanelAvailable() },
      { view: 'pr', label: 'Pull request', short: 'PR', shown: !isFlashcardRun(run), result: prPanelAvailable(run) },
      { view: 'answer', label: card ? 'Flashcard' : 'Answer', shown: isQuestionRun(run), result: true },
      { view: 'diagram', label: 'Diagram', shown: hasDiagram(run), result: true },
      { view: 'techdoc', label: 'Tech doc', shown: hasTechDoc(run), result: true },
      { view: 'evals', label: 'Evals', shown: hasEvals(run), result: true },
      { view: 'assets', label: 'Assets', shown: hasAssets(run), result: true },
      { view: 'review', label: 'Review', shown: !!run && reviewsForRun(run.id).length > 0, result: true },
    ];
  }

  // The results lead in the order a person comes to the panel for them.
  const RESULT_ORDER = ['pr', 'answer', 'review', 'evals', 'diagram', 'techdoc', 'assets'];

  function syncChip(run, tabs) {
    const chip = $('links').querySelector('.side-panel-chip');
    if (!chip) return;
    chip.setAttribute('aria-expanded', String(diffPanelOpen));
    const shown = tabs.filter(tab => tab.shown);
    const changed = shown.some(tab => tab.view === 'diff') ? runDiffFiles(run) || [] : [];
    const files = changed.length;
    const { additions, deletions } = diffLineTotals(changed);
    const results = shown.filter(tab => tab.result)
      .sort((a, b) => RESULT_ORDER.indexOf(a.view) - RESULT_ORDER.indexOf(b.view))
      .map(tab => tab.short || tab.label);
    const parts = sidePanelChipText(files, results);
    const names = shown.map(tab => (tab.view === 'diff' && files
      ? `Diff (${files} ${files === 1 ? 'file' : 'files'}, ${additions} added, ${deletions} removed)` : tab.label));
    const title = `Side panel (⌘B)${names.length ? `: ${names.join(', ')}` : ''}`;
    const key = JSON.stringify([parts, files, title]);
    if (chip.dataset.contents === key) return;
    chip.dataset.contents = key;
    chip.title = title;
    chip.classList.toggle('labelled', parts.length > 0);
    chip.innerHTML = DIFF_ICON + (parts.length
      ? `<span class="side-panel-chip-label" aria-hidden="true">${parts.map(esc).join(' <i>·</i> ')}</span>` : '')
      + (files ? `<span class="side-panel-chip-stat" aria-hidden="true"><span class="side-panel-chip-plus">+${additions}</span>`
        + `<span class="side-panel-chip-minus">−${deletions}</span></span>` : '')
      + (parts.length ? SIDE_PANEL_GO : '')
      + (files ? `<span class="side-panel-chip-count" aria-hidden="true">${files}</span>` : '');
  }

  // The sheet dims the run beside it, and a click there or Escape closes it.
  // A phone's sheet covers the whole width, so only Escape is left.
  const isSheet = () => !panel.hidden && !maximized && sheetQuery.matches;
  function syncBackdrop() {
    const on = !panel.hidden && !maximized;
    backdrop.hidden = !on;
    if (on) {
      const left = sidebarWidth() ? $('run-sidebar').getBoundingClientRect().right : 0;
      backdrop.style.setProperty('--run-diff-backdrop-left', `${Math.round(left)}px`);
    }
  }
  function closeSheet() {
    setOpen(false);
    diffPanelSync();
    returnFocus = null;
    $('links').querySelector('.side-panel-chip')?.focus();
  }

  // A finished flashcard run's output is its card: it has no PR, and its
  // Flashcard tab stands where Pull request would.
  const isFinishedCard = run => isFlashcardRun(run) && isQuestionRun(run);

  function viewFor(run) {
    if (isFinishedCard(run) && ['diff', 'pr'].includes(chosenView)) return 'answer';
    if (chosenView === 'files' && !filesPanelAvailable()) return 'diff';
    if (chosenView === 'answer' && !isQuestionRun(run)) return 'diff';
    if (chosenView === 'diagram' && !hasDiagram(run)) return 'diff';
    if (chosenView === 'techdoc' && !hasTechDoc(run)) return 'diff';
    if (chosenView === 'evals' && !hasEvals(run)) return 'diff';
    if (chosenView === 'assets' && !hasAssets(run)) return 'diff';
    if (chosenView === 'review' && !reviewsForRun(run?.id).length) return 'diff';
    return chosenView;
  }

  function syncTabsFade() {
    const more = !panel.hidden && phoneQuery.matches && panelTabsHaveEndFade(tabStrip);
    tabStrip.toggleAttribute('data-fade-end', more);
  }

  function revealPanelTab(tab) {
    if (!tab || !phoneQuery.matches || tabStrip.scrollWidth <= tabStrip.clientWidth + 1) return;
    const strip = tabStrip.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (!strip.width || !box.width) return;
    const visible = [...tabStrip.querySelectorAll('[role="tab"]')].filter(item => !item.hidden);
    const hasAfter = visible.indexOf(tab) < visible.length - 1;
    const delta = panelTabScrollDelta({
      stripLeft: strip.left,
      stripRight: strip.right,
      tabLeft: box.left,
      tabRight: box.right,
      padStart: TAB_PAD,
      padEnd: hasAfter ? TAB_FADE_CLEARANCE : TAB_PAD,
    });
    if (delta) tabStrip.scrollLeft += delta;
  }

  function paintTabs(view) {
    for (const tab of document.querySelectorAll('#run-panel-tabs [role="tab"]')) {
      const selected = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    $('run-panel-diff').hidden = view !== 'diff';
    $('run-panel-files').hidden = view !== 'files';
    $('run-panel-pr').hidden = view !== 'pr';
    $('run-panel-review').hidden = view !== 'review';
    $('run-panel-answer').hidden = view !== 'answer';
    $('run-panel-diagram').hidden = view !== 'diagram';
    $('run-panel-techdoc').hidden = view !== 'techdoc';
    $('run-panel-evals').hidden = view !== 'evals';
    $('run-panel-assets').hidden = view !== 'assets';
  }

  function note(text, { retry = false } = {}) {
    $('run-diff-summary').textContent = '';
    $('run-diff-tools').innerHTML = '';
    clearDiffViews();
    body.innerHTML = `<div class="run-diff-note" role="status"><p>${text}</p>` +
      (retry ? '<button type="button" data-diff-retry>Try again</button>' : '') + '</div>';
  }

  async function load(run, scope, key, { revalidate = false } = {}) {
    const token = ++loadSeq;
    loadController?.abort();
    loadController = new AbortController();
    const sameRun = loadedRunId === run.id;
    const sameScope = sameRun && loadedScope === scope;
    loadedKey = key;
    loadedRunId = run.id;
    loadedScope = scope;
    // a poll that saw the patch grow repaints in place; a new run or scope starts at the top
    const scrollTop = sameScope ? body.scrollTop : 0;
    if (!sameScope && !revalidate) note('Loading diff…');
    if (!revalidate) panel.setAttribute('aria-busy', 'true');
    const headers = { Range: `bytes=0-${DIFF_PREVIEW_BYTES - 1}` };
    if (sameScope && loadedEtag) headers['If-None-Match'] = loadedEtag;
    // The panel reads the patch with every file listed (run_diff.panel_patch);
    // the download is the whole one.
    const downloadUrl = diffUrl(run.id, scope);
    const url = `${downloadUrl}&view=panel`;
    // Start loading the bundle in parallel on a fresh scope; steady polls wait
    // so an empty run returning 304 or 416 never imports @pierre/diffs.
    const prewarmedApi = !sameScope ? loadDiffsModule().catch(() => null) : null;
    const response = await fetch(url, { headers, signal: loadController.signal }).catch(() => null);
    if (token !== loadSeq) return;
    if (response?.status === 304) {
      panel.removeAttribute('aria-busy');
      return;
    }
    const empty = response?.status === 416 && response.headers.get('Content-Range') === 'bytes */0';
    const text = empty ? '' : response?.ok ? await response.text().catch(() => null) : null;
    const contentRange = response?.headers.get('Content-Range')?.match(/^bytes \d+-(\d+)\/(\d+)$/);
    const truncated = !!contentRange && Number(contentRange[1]) + 1 < Number(contentRange[2]);
    if (token !== loadSeq) return;
    const api = text === null || !text.trim() ? null : await (prewarmedApi || loadDiffsModule().catch(() => null));
    if (token !== loadSeq) return;
    panel.removeAttribute('aria-busy');
    if (text === null) {
      // forget the key so the next poll retries on its own, too
      loadedKey = null;
      loadedEtag = null;
      note("Couldn't load this run's diff.", { retry: true });
      return;
    }
    loadedEtag = response?.headers.get('ETag') || null;
    if (!text.trim()) {
      note('No changes yet.');
      return;
    }
    renderDiffPanel(api, text, run.id, {
      truncated,
      downloadUrl,
      downloadName: scope === 'turn' ? 'turn-diff.patch' : 'diff.patch',
    });
    body.scrollTop = scrollTop;
  }

  function cancelLoad() {
    if (!loadController) return;
    ++loadSeq;
    loadController.abort();
    loadController = null;
    if (panel.hasAttribute('aria-busy')) {
      loadedKey = null;
      loadedEtag = null;
      panel.removeAttribute('aria-busy');
    }
  }

  function storeSeen(run, value) {
    if (value === resultSeenByRun.get(run.id)) return;
    resultSeenByRun.set(run.id, value);
    try {
      if (value) localStorage.setItem(READY_KEY + run.id, value);
      else localStorage.removeItem(READY_KEY + run.id);
    } catch {}
  }

  // An answer is read in the Chat, where the reply already holds it, so it
  // only picks the tab; a flashcard opens the panel, once it is final.
  function revealAnswer(run, ready) {
    if (ready && resultSeenByRun.get(run.id) !== '1') {
      storeSeen(run, '1');
      chosenView = 'answer';
      if (isFinishedCard(run)) setOpen(true);
    } else if (!ready && run.meta.status === 'running') storeSeen(run, null);
  }

  const resultReady = run => isFinalReady(run.meta)
    || ['complete', 'merged', 'merged-to-parent'].includes(run.meta.status);

  // Names the PR bodies as they stand, so a rewrite reads as a new body.
  function prBodySignature(run, ready) {
    const paths = prBodyPaths(run);
    if (!paths.length) return ready && run.meta.prUrl ? `pr:${run.meta.prUrl}` : '';
    return paths.map(path => {
      const file = run.files.find(entry => entry.path === path);
      return `${path}:${file?.mtime ?? ''}:${file?.size ?? ''}`;
    }).join('|');
  }

  // The result as it stands now counts as seen.
  function markResultSeen(run) {
    if (isQuestionRun(run)) { storeSeen(run, '1'); return; }
    const body = prBodySignature(run, resultReady(run));
    storeSeen(run, body ? JSON.stringify({ body, live: isLiveRun(run) }) : null);
  }

  function revealPrBody(run, ready) {
    const body = prBodySignature(run, ready);
    const stored = resultSeenByRun.get(run.id);
    let seen = null;
    // '1' is a result shown at Ship before the body itself was remembered.
    if (stored === '1') seen = { body, live: false };
    else if (stored) { try { seen = JSON.parse(stored); } catch {} }
    const showing = diffPanelOpen && sidePanelAvailable(run) && viewFor(run) === 'pr';
    const next = prBodyReveal(seen, { body, running: isLiveRun(run), ready, sheet: sheetQuery.matches, showing });
    storeSeen(run, next.seen ? JSON.stringify(next.seen) : null);
    if (!next.open) return;
    chosenView = 'pr';
    setOpen(true);
  }

  diffPanelSync = () => {
    const run = currentRun();
    retirePrPanelUnlessRun(run?.id);
    if (loadedRunId && loadedRunId !== run?.id) {
      cancelLoad();
      loadedKey = null;
      loadedRunId = null;
      loadedEtag = null;
      note('');
    }
    syncOpen(run);
    const tabs = panelTabs(run);
    for (const tab of tabs) $(`run-panel-tab-${tab.view}`).hidden = !tab.shown;
    const answerTab = $('run-panel-tab-answer');
    const answerLabel = tabs.find(tab => tab.view === 'answer').label;
    if (answerTab.textContent !== answerLabel) answerTab.textContent = answerLabel;
    if (run) {
      if (!resultSeenByRun.has(run.id)) {
        let stored = null;
        try { stored = localStorage.getItem(READY_KEY + run.id); } catch {}
        resultSeenByRun.set(run.id, stored);
      }
      const ready = resultReady(run);
      if (isQuestionRun(run)) revealAnswer(run, ready);
      else revealPrBody(run, ready);
    }
    const show = diffPanelOpen && sidePanelAvailable(run);
    const moved = panel.hidden === show;
    panel.hidden = !show;
    // Chat keeps a link on its Ship line for as long as the panel is shut.
    if (moved) document.dispatchEvent(new CustomEvent('orc:side-panel', { detail: { open: show } }));
    if (!show) maximized = false;
    syncMaximized();
    syncBackdrop();
    syncChip(run, tabs);
    if (!show) {
      cancelLoad();
      hideFilesPanel();
      revealedTabKey = null;
      userScrolledTabs = false;
      tabStrip.removeAttribute('data-fade-end');
      return;
    }
    setWidth(storedWidth(), false);
    const view = viewFor(run);
    paintTabs(view);
    const visibleTabKey = tabs.filter(tab => tab.shown).map(tab => tab.view).join(',');
    const tabKey = `${run?.id || ''}:${view}:${visibleTabKey}`;
    if (tabKey !== revealedTabKey) {
      revealedTabKey = tabKey;
      userScrolledTabs = false;
      revealPanelTab(tabStrip.querySelector('[aria-selected="true"]'));
    }
    syncTabsFade();
    if (view !== 'diff') cancelLoad();
    if (view === 'files') { showFilesPanel(run); return; }
    hideFilesPanel();
    if (view === 'answer') { showAnswerPanel(run); return; }
    if (view === 'diagram') { showDiagramPanel(run); return; }
    if (view === 'techdoc') { showTechDocPanel(run); return; }
    if (view === 'evals') { showEvalsPanel(run); return; }
    if (view === 'assets') { showAssetsPanel(run); return; }
    if (view === 'pr') { showPrPanel(run); return; }
    if (view === 'review') { showReviewPanel(run); return; }
    const scope = scopeFor(run);
    if (scopeSelect.value !== scope) scopeSelect.value = scope;
    const patch = diffPatchOf(run);
    const key = `${run.id}:${scope}:${patch ? patch.size : -1}:${run.meta?.status || ''}:${run.mtime || 0}`;
    if (key !== loadedKey) {
      const revalidate = loadedRunId === run.id && loadedScope === scope && Boolean(loadedEtag);
      load(run, scope, key, { revalidate });
    }
  };

  function selectView(view, { focus = true } = {}) {
    const run = currentRun();
    const tab = document.querySelector(`#run-panel-tabs [data-view="${view}"]`);
    if (!run || !SIDE_PANEL_VIEWS.includes(view)) return;
    chosenView = view;
    revealedTabKey = null;
    userScrolledTabs = false;
    diffPanelSync();
    if (focus) tab.focus();
  }

  function setOpen(open) {
    const run = currentRun();
    if (!run) return;
    syncOpen(run);
    diffPanelOpen = open;
    openByRun.set(run.id, open);
    try { localStorage.setItem(OPEN_KEY + run.id, open ? '1' : '0'); } catch {}
  }

  diffPanelToggle = () => {
    const run = currentRun();
    if (!run) { announce('Open a run to see its side panel.'); return; }
    if (!sidePanelAvailable(run)) return;
    syncOpen(run);
    if (diffPanelOpen) {
      const hadFocus = panel.contains(document.activeElement);
      setOpen(false);
      diffPanelSync();
      if (hadFocus) (returnFocus?.isConnected ? returnFocus : $('links').querySelector('.side-panel-chip'))?.focus();
      returnFocus = null;
      return;
    }
    returnFocus = document.activeElement;
    setOpen(true);
    diffPanelSync();
    document.querySelector('#run-panel-tabs [aria-selected="true"]')?.focus();
  };

  function setScope(next) {
    const run = currentRun();
    if (!run) return;
    const normalized = next === 'branch' ? 'branch' : 'turn';
    scopeByRun.set(run.id, normalized);
    scopeSelect.value = normalized;
    loadedKey = null;
    loadedEtag = null;
    diffPanelSync();
  }

  bindSidePanelNavigation((view, options) => {
    const run = currentRun();
    syncOpen(run);
    // A link to one view outranks the one-time jump to the run's result.
    if (run) {
      markResultSeen(run);
      if (options?.scope === 'turn' || options?.scope === 'branch') {
        scopeByRun.set(run.id, options.scope);
        loadedKey = null;
        loadedEtag = null;
      }
    }
    returnFocus = document.activeElement;
    setOpen(true);
    selectView(view, { focus: false });
  });

  // Stable entry point for Orc.app's View menu, same as ⌘J's terminal toggle.
  window.orcToggleDiff = toggleDiffPanel;

  // ⌘B on a Mac, Ctrl+B elsewhere. Off a run the browser keeps the key, and
  // off a Mac the terminal keeps its Ctrl chords, such as tmux's Ctrl+B prefix.
  const mac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || !shortcutMatches('side-panel', event)) return;
    if (!currentRun()) return;
    if (!mac && event.ctrlKey && $('run-terminal').contains(document.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleDiffPanel();
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('#links .side-panel-chip')) toggleDiffPanel();
  });
  tabStrip.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectView(tab.dataset.view);
  });
  // Arrow keys move between the tabs, as a tablist's do.
  tabStrip.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const all = [...tabStrip.querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden && tab.getAttribute('aria-disabled') !== 'true');
    const at = all.indexOf(document.activeElement);
    const next = event.key === 'Home' ? all[0]
      : event.key === 'End' ? all[all.length - 1]
      : all[(at + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    event.preventDefault();
    if (next) selectView(next.dataset.view);
  });
  tabStrip.addEventListener('scroll', syncTabsFade, { passive: true });
  for (const type of ['pointerdown', 'touchstart', 'wheel']) {
    tabStrip.addEventListener(type, () => { userScrolledTabs = true; }, { passive: true });
  }
  document.fonts?.ready.then(() => {
    if (panel.hidden || userScrolledTabs) return;
    revealPanelTab(tabStrip.querySelector('[aria-selected="true"]'));
    syncTabsFade();
  });
  new ResizeObserver(syncTabsFade).observe(tabStrip);
  phoneQuery.addEventListener('change', () => {
    if (phoneQuery.matches) revealPanelTab(tabStrip.querySelector('[aria-selected="true"]'));
    syncTabsFade();
  });
  $('run-diff-close').addEventListener('click', () => toggleDiffPanel());
  backdrop.addEventListener('click', () => { if (isSheet()) closeSheet(); });
  // Escape belongs to whatever handled it first: a menu, a dialog, the
  // composer, or the terminal's own programs.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !isSheet()) return;
    if (document.body.classList.contains('sidebar-open') || $('run-terminal').contains(document.activeElement)) return;
    if (document.querySelector('orc-dialog[open], dialog[open], #lightbox.open')) return;
    event.preventDefault();
    closeSheet();
  });
  $('run-diff-maximize').addEventListener('click', () => {
    maximized = !maximized;
    syncMaximized();
    syncBackdrop();
    announce(maximized ? 'Side panel maximized.' : 'Side panel restored.');
  });
  new ResizeObserver(() => { syncMaximized(); syncBackdrop(); }).observe($('run-sidebar'));
  scopeSelect.addEventListener('change', () => setScope(scopeSelect.value));
  body.addEventListener('click', event => {
    if (!event.target.closest('[data-diff-retry]')) return;
    loadedKey = null;
    loadedEtag = null;
    diffPanelSync();
  });

  setInterval(() => {
    if (document.hidden || panel.hidden || panel.hasAttribute('aria-busy')) return;
    const run = currentRun();
    if (!run || !isLiveRun(run) || viewFor(run) !== 'diff' || !loadedKey) return;
    load(run, scopeFor(run), loadedKey, { revalidate: true });
  }, LIVE_POLL_MS);

  // Leaving the run for Settings, Tickets or any other view hides the panel;
  // coming back brings it back.
  new MutationObserver(() => diffPanelSync()).observe($('head'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('hashchange', () => diffPanelSync());
  window.addEventListener('orc-files-provider-changed', () => diffPanelSync());
  // The Assets tab appears once the run's diff is read.
  onRunDiffFiles(runId => { if (currentRun()?.id === runId) diffPanelSync(); });

  // Drag the left edge, or focus it and use the arrow keys, to resize.
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    panel.classList.add('resizing');
    const move = e => setWidth(startWidth + (startX - e.clientX));
    const up = () => {
      panel.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', event => {
    const step = event.shiftKey ? 80 : 20;
    const current = panel.getBoundingClientRect().width;
    // the handle is the panel's left edge: left widens it
    if (event.key === 'ArrowLeft') setWidth(current + step);
    else if (event.key === 'ArrowRight') setWidth(current - step);
    else if (event.key === 'Home') setWidth(MIN_WIDTH);
    else if (event.key === 'End') setWidth(Infinity);
    else return;
    event.preventDefault();
  });
  window.addEventListener('resize', () => { if (!panel.hidden) { setWidth(storedWidth(), false); syncMaximized(); } });
})();
