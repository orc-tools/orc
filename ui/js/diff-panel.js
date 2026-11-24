import { DIFF_PREVIEW_BYTES } from './text-preview.js';
import { $, announce, isQuestionRun, reviewsForRun, runs } from './core.js';
import { clearDiffViews, loadDiffsModule, renderDiffPanel } from './diff.js';
import { filesPanelAvailable, hideFilesPanel, showFilesPanel } from './files-panel.js';
import { showReviewPanel } from './review-panel.js';
import { showAnswerPanel } from './answer-panel.js';
import { hasDiagram, hasTechDoc, showDiagramPanel, showTechDocPanel } from './markdown-panel.js';
import { hasAssets, onRunDiffFiles, showAssetsPanel } from './assets-panel.js';
import { prPanelAvailable, showPrPanel } from './pr-panel.js';
import { hasEvals, showEvalsPanel } from './evals-panel.js';
import { shortcutMatches } from './shortcuts.js';
import { isFinalReady, isFlashcardRun, isPlanningComplete } from './run-presentation.js';

// panel-right, stroked like the other Run tools chips beside it.
export const DIFF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>';

// The panel's state and wiring live in one closure, as the terminal's do: the
// module test reads every top-level name as app-wide.
let diffPanelOpen = false;
let diffPanelSync = () => {};
let diffPanelToggle = () => {};
let diffPanelReveal = () => {};
const SIDE_PANEL_VIEWS = ['diff', 'files', 'pr', 'review', 'answer', 'diagram', 'techdoc', 'assets', 'evals'];
export function isDiffPanelOpen() { return diffPanelOpen; }
// Called on every openRun pass so route and poll updates reach whichever tab is open.
export function syncDiffPanel() { diffPanelSync(); }
export function toggleDiffPanel() { diffPanelToggle(); }
// Opens on a tab without moving focus: an old #<run>/diff.patch or
// #<run>/pr-body.md link lands here.
export function revealDiffPanel(view = 'diff', options) { diffPanelReveal(view, options); }
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

(() => {
  const OPEN_KEY = 'orcDiffPanelOpen:';
  const READY_KEY = 'orcSidePanelResultSeen:';
  const WIDTH_KEY = 'orcDiffPanelWidth';
  const MIN_WIDTH = 360;
  const panel = $('run-diff');
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
    if (id && !openByRun.has(id)) {
      // An eval has no diff of its own: its panel is the comparison, so it
      // starts open until the user closes it.
      let open = hasEvals(run);
      try { open = (localStorage.getItem(OPEN_KEY + id) ?? (open ? '1' : '0')) === '1'; } catch {}
      openByRun.set(id, open);
    }
    diffPanelOpen = openByRun.get(id) || false;
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

  function syncChip() {
    $('links').querySelector('.side-panel-chip')?.setAttribute('aria-expanded', String(diffPanelOpen));
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

  function note(text, { retry = false, showBranch = false } = {}) {
    $('run-diff-summary').textContent = '';
    $('run-diff-tools').innerHTML = '';
    clearDiffViews();
    body.innerHTML = `<div class="run-diff-note" role="status"><p>${text}</p>` +
      (showBranch ? '<button type="button" data-diff-scope="branch">Show branch diff</button>' : '') +
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
    const branchHasDiff = response?.headers.get('X-Orc-Branch-Has-Diff') === '1';
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
      if (scope === 'turn' && branchHasDiff) note('No changes since last turn.', { showBranch: true });
      else note('No changes yet.');
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

  diffPanelSync = () => {
    const run = currentRun();
    if (loadedRunId && loadedRunId !== run?.id) {
      cancelLoad();
      loadedKey = null;
      loadedRunId = null;
      loadedEtag = null;
      note('');
    }
    syncOpen(run);
    const card = isFinishedCard(run);
    const answerTab = $('run-panel-tab-answer');
    answerTab.hidden = !isQuestionRun(run);
    const answerLabel = card ? 'Flashcard' : 'Answer';
    if (answerTab.textContent !== answerLabel) answerTab.textContent = answerLabel;
    $('run-panel-tab-diff').hidden = card;
    $('run-panel-tab-pr').hidden = isFlashcardRun(run);
    $('run-panel-tab-files').hidden = !filesPanelAvailable();
    $('run-panel-tab-diagram').hidden = !hasDiagram(run);
    $('run-panel-tab-techdoc').hidden = !hasTechDoc(run);
    $('run-panel-tab-evals').hidden = !hasEvals(run);
    $('run-panel-tab-assets').hidden = !hasAssets(run);
    $('run-panel-tab-review').hidden = !reviewsForRun(run?.id).length;
    if (run) {
      if (!resultSeenByRun.has(run.id)) {
        let seen = false;
        try { seen = localStorage.getItem(READY_KEY + run.id) === '1'; } catch {}
        resultSeenByRun.set(run.id, seen);
      }
      const ready = isFinalReady(run.meta)
        || ['complete', 'merged', 'merged-to-parent'].includes(run.meta.status);
      const answered = isQuestionRun(run);
      const hasResult = answered || run.meta.prUrl || run.files.some(file => file.path === 'pr-body.md');
      if (ready && hasResult && !resultSeenByRun.get(run.id)) {
        resultSeenByRun.set(run.id, true);
        try { localStorage.setItem(READY_KEY + run.id, '1'); } catch {}
        chosenView = answered ? 'answer' : 'pr';
        // An answer is read in the Chat, where the reply already holds it, so
        // only a PR body or a flashcard opens the panel on its own.
        if (!answered || card) setOpen(true);
      } else if (!ready && run.meta.status === 'running') {
        resultSeenByRun.set(run.id, false);
        try { localStorage.removeItem(READY_KEY + run.id); } catch {}
      }
    }
    const show = diffPanelOpen && sidePanelAvailable(run);
    const moved = panel.hidden === show;
    panel.hidden = !show;
    // Chat keeps a link on its Ship line for as long as the panel is shut.
    if (moved) document.dispatchEvent(new CustomEvent('orc:side-panel', { detail: { open: show } }));
    if (!show) maximized = false;
    syncMaximized();
    syncChip();
    if (!show) { cancelLoad(); hideFilesPanel(); return; }
    setWidth(storedWidth(), false);
    const view = viewFor(run);
    paintTabs(view);
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

  function setScope(next, { focusSelect = false } = {}) {
    const run = currentRun();
    if (!run) return;
    const normalized = next === 'branch' ? 'branch' : 'turn';
    scopeByRun.set(run.id, normalized);
    scopeSelect.value = normalized;
    loadedKey = null;
    loadedEtag = null;
    diffPanelSync();
    if (focusSelect) scopeSelect.focus();
  }

  diffPanelReveal = (view, options) => {
    const run = currentRun();
    syncOpen(run);
    // A link to one view outranks the one-time jump to the run's result.
    if (run) {
      resultSeenByRun.set(run.id, true);
      try { localStorage.setItem(READY_KEY + run.id, '1'); } catch {}
      if (options?.scope === 'turn' || options?.scope === 'branch') {
        scopeByRun.set(run.id, options.scope);
        loadedKey = null;
        loadedEtag = null;
      }
    }
    returnFocus = document.activeElement;
    setOpen(true);
    selectView(view, { focus: false });
  };

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
  const tabs = $('run-panel-tabs');
  tabs.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectView(tab.dataset.view);
  });
  // Arrow keys move between the tabs, as a tablist's do.
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const all = [...tabs.querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden && tab.getAttribute('aria-disabled') !== 'true');
    const at = all.indexOf(document.activeElement);
    const next = event.key === 'Home' ? all[0]
      : event.key === 'End' ? all[all.length - 1]
      : all[(at + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    event.preventDefault();
    if (next) selectView(next.dataset.view);
  });
  $('run-diff-close').addEventListener('click', () => toggleDiffPanel());
  $('run-diff-maximize').addEventListener('click', () => {
    maximized = !maximized;
    syncMaximized();
    announce(maximized ? 'Side panel maximized.' : 'Side panel restored.');
  });
  new ResizeObserver(() => syncMaximized()).observe($('run-sidebar'));
  scopeSelect.addEventListener('change', () => setScope(scopeSelect.value));
  body.addEventListener('click', event => {
    const scopeBtn = event.target.closest('[data-diff-scope]');
    if (scopeBtn) {
      setScope(scopeBtn.dataset.diffScope, { focusSelect: true });
      return;
    }
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
