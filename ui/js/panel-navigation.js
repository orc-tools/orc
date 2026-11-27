// Views bind their commands at startup. Callers receive the original return value or promise.

export let hasRunSnapshot;
export let refresh;
export let route;
export let prefillNewConversation;
export let ncSwitchProject;
export let restoreFailedLaunchPrompt;
export let applyUiConfig;
export let applyMergeQueueChanges;
export let syncSettingsPowerMode;
export function bindActivityNavigation(handlers) {
  ({
    hasRunSnapshot, refresh, route, prefillNewConversation, ncSwitchProject,
    restoreFailedLaunchPrompt, applyUiConfig, applyMergeQueueChanges, syncSettingsPowerMode,
  } = handlers);
}

export let chatComposerReady;
export let focusChatComposer;
export let updateChatRun;
export let showSendingAnswers;
export let chatWorkingOn;
export function bindChatNavigation(handlers) {
  ({ chatComposerReady, focusChatComposer, updateChatRun, showSendingAnswers, chatWorkingOn } = handlers);
}

export let openRun;
export function bindRunNavigation(handler) {
  openRun = handler;
}

let openSidePanel = () => {};
export function bindSidePanelNavigation(handler) {
  openSidePanel = handler;
}
// Opens on a tab without moving focus: an old #<run>/diff.patch or
// #<run>/pr-body.md link lands here.
export function revealDiffPanel(view = 'diff', options) {
  openSidePanel(view, options);
}

export function reflectRunChange(id) {
  document.dispatchEvent(new CustomEvent('orc:run-changed', { detail: id }));
}

// Overlays sit above every routed view and routing does not dismiss them, so a
// shortcut that only changes the hash renders the destination underneath an
// open dialog/lightbox/palette and reads as a dead key. Dialogs close
// generically; overlays with their own teardown (the lightbox un-inerts the
// shell, the palette drops its pending render) register a closer instead.
// Keyed, because per-render owners like the diff review panel re-register.
export function orcRegisterOverlayCloser(key, close) {
  (window.orcOverlayClosers || (window.orcOverlayClosers = new Map())).set(key, close);
}
export function orcCloseOverlays() {
  // orc-dialog reflects `open` on the host, so the host is what matches — the
  // real <dialog> is inside its shadow root and out of reach of this selector.
  document.querySelectorAll('orc-dialog[open]').forEach(dialog => { try { dialog.close(); } catch {} });
  (window.orcOverlayClosers || new Map()).forEach(close => { try { close(); } catch {} });
}

// Reading Chat or the Plan page is what clears Needs attention and Unread, so
// only a view the reader is actually looking at reports them seen.
const reportingSeen = new Set();
export function reportSeen(runId, action) {
  const key = `${action}:${runId}`;
  if (reportingSeen.has(key) || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  reportingSeen.add(key);
  fetch(`/runs/${encodeURIComponent(runId)}/${action}`, { method: 'POST' })
    .then(response => (response.ok ? refresh({ force: true }) : null))
    .catch(() => null)
    .finally(() => reportingSeen.delete(key));
}
