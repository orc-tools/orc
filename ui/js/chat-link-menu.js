// orc-ui: the right-click menu on a file or folder link in Chat, offering
// where to open it. Web links use the browser's own context menu.

import { $, esc, showToast, toast } from './core.js';
import { bindContextMenu, placeContextMenu } from './context-menu.js';
import { revealDiffPanel } from './diff-panel.js';
import { fileActions, filesPanelAvailable, runFileAction, openRunFile } from './files-panel.js';
import { revealInFileManagerLabel } from './finder.js';

const FILE_LINKS = '[data-chat-file], [data-chat-html], [data-chat-finder]';
const linkMenu = $('chat-link-menu');
let linkMenuTarget = null;

// Finder and the clipboard take a path on disk, and a link names its file
// from the run's checkout.
function pathOnDisk(run, path) {
  if (/^(?:\/|~(?:\/|$))/.test(path)) return path;
  const checkout = run.meta?.worktree?.path || run.meta?.repoPath || run.meta?.mainRepoPath;
  return checkout ? `${checkout.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}` : null;
}

function closeLinkMenu({ refocus = false } = {}) {
  if (linkMenu.hidden) return;
  linkMenu.hidden = true;
  if (refocus) linkMenuTarget.link.focus();
}

function renderLinkMenuRows(rows) {
  linkMenu.innerHTML = rows.map((row, index) =>
    `<button type="button" role="menuitem" data-row="${index}" tabindex="-1"><span class="run-menu-label">${esc(row.label)}</span></button>`).join('');
}

// A row either runs something or copies text: { label, run } or
// { label, copy, copied }, where `copied` is the toast title.
function openLinkMenu(link, rows, x, y, rebuild) {
  linkMenuTarget = { link, rows, rebuild };
  renderLinkMenuRows(rows);
  placeContextMenu(linkMenu, link, x, y);
}

async function openInBrowser(runId, path) {
  const response = await fetch(`/runs/${encodeURIComponent(runId)}/open-in`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editor: 'browser', path }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not open the page');
}

function fileLinkRows(link, run, revealInFinder) {
  const { chatFile, chatHtml, chatFinder } = link.dataset;
  const path = chatHtml ?? chatFile ?? chatFinder;
  const onDisk = pathOnDisk(run, path);
  // Finder links can name files outside the checkout.
  const inCheckout = chatFinder === undefined;
  return [
    chatHtml !== undefined && { label: 'Open in browser', run: () => openInBrowser(run.id, path) },
    inCheckout && filesPanelAvailable() && { label: 'Open in sidebar', run: () => { openRunFile(run.id, path); revealDiffPanel('files'); } },
    onDisk && { label: revealInFileManagerLabel(), run: () => revealInFinder(onDisk) },
    ...(inCheckout ? fileActions().map(action => ({ label: `Open in ${action.name}`, run: () => runFileAction(run.id, path, action.id) })) : []),
    { label: 'Copy path', copy: onDisk || path, copied: 'Copied path' },
  ].filter(Boolean);
}

linkMenu.addEventListener('click', event => {
  const index = event.target.closest('[data-row]')?.dataset.row;
  if (index === undefined) return;
  const row = linkMenuTarget.rows[index];
  // WebKit only allows a clipboard write that starts inside the click itself
  const copied = row.copy && navigator.clipboard.writeText(row.copy);
  closeLinkMenu({ refocus: true });
  if (copied) copied.then(() => toast(row.copied, { tone: 'success', description: row.copy }),
    () => toast('Copy failed', { tone: 'error' }));
  else new Promise(resolve => resolve(row.run())).catch(error => showToast(error.message));
});

bindContextMenu(linkMenu, closeLinkMenu);

// Only the reader's own scrolling closes it: a live chat scrolls by itself
// as output arrives, which would take the menu away mid-choice.
for (const gesture of ['wheel', 'touchmove']) document.addEventListener(gesture, () => closeLinkMenu(), { passive: true });

window.addEventListener('orc-files-actions-changed', () => {
  if (linkMenu.hidden || !linkMenuTarget?.rebuild) return;
  const focusedLabel = linkMenu.contains(document.activeElement)
    ? document.activeElement.querySelector('.run-menu-label')?.textContent : null;
  linkMenuTarget.rows = linkMenuTarget.rebuild();
  renderLinkMenuRows(linkMenuTarget.rows);
  if (focusedLabel) {
    const match = [...linkMenu.querySelectorAll('[role^="menuitem"]')]
      .find(item => item.querySelector('.run-menu-label')?.textContent === focusedLabel);
    (match || linkMenu.querySelector('[role^="menuitem"]'))?.focus();
  }
});

export function bindChatLinkMenu(root, currentRun, revealInFinder) {
  root.addEventListener('contextmenu', event => {
    const link = event.target.closest(FILE_LINKS);
    if (!link) return;
    event.preventDefault();
    const rebuild = () => fileLinkRows(link, currentRun(), revealInFinder);
    openLinkMenu(link, rebuild(), event.clientX, event.clientY, rebuild);
  });
}
