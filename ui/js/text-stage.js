import { esc } from './dom-text.js';
import { canChangeScreen, changeScreen } from './screen-change.js';

// Full-screen modal text stage (used to maximise verification steps and to
// view check logs and other plain-text run files over a blurred backdrop).
// Copy in the main shell uses ui/md-callouts.js's code-copy handler via
// [data-code-box]; standalone windows without md-callouts wire Copy locally.

const ICON = path => `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
export const MAXIMISE_ICON = ICON('M214,48V96a6,6,0,0,1-12,0V62.48l-45.76,45.76a6,6,0,0,1-8.48-8.48L193.52,54H160a6,6,0,0,1,0-12h48A6,6,0,0,1,214,48ZM99.76,147.76,54,193.52V160a6,6,0,0,0-12,0v48a6,6,0,0,0,6,6H96a6,6,0,0,0,0-12H62.48l45.76-45.76a6,6,0,0,0-8.48-8.48Z');
export const RESTORE_ICON = ICON('M150,104V72a6,6,0,0,1,12,0V89.52l45.76-45.76a6,6,0,0,1,8.48,8.48L170.48,98H188a6,6,0,0,1,0,12H156A6,6,0,0,1,150,104ZM100,146H68a6,6,0,0,0,0,12H85.52L39.76,203.76a6,6,0,1,0,8.48,8.48L94,166.48V184a6,6,0,0,0,12,0V152A6,6,0,0,0,100,146Z');
export const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
export const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const COPIED_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

const NON_TEXT_RUN_EXT = /\.(html?|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|m4v|ogv|mp3|wav|ogg|m4a|flac|aac|pdf|zip|gz|tar|tgz|bz2|xz|7z|dmg|pkg|exe|bin|wasm|woff2?|ttf|otf|sqlite3?|db)$/i;

export function copyButtonHtml(label) {
  return `<orc-icon-button class="code-copy" variant="ghost" size="compact" label="${esc(label)}">${COPY_ICON}</orc-icon-button>`;
}

// The change starts from the button or link that asked for it, as the
// terminal's starts from its header chip; it is skipped when it cannot play.
function change(from, swap) {
  if (!canChangeScreen()) { swap(); return Promise.resolve(); }
  const box = from?.isConnected ? from.getBoundingClientRect() : null;
  return changeScreen('stage', swap, box?.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
}

/** Extract the run-relative path from a same-origin /runs/<id>/<path> URL. */
export function runFilePath(href) {
  if (!href) return '';
  let url;
  try { url = new URL(href, location.href); } catch { return ''; }
  if (url.origin !== location.origin) return '';
  const parts = url.pathname.split('/');
  if (parts.length < 4 || parts[1] !== 'runs' || !parts[2]) return '';
  const relParts = parts.slice(3).filter(Boolean);
  if (!relParts.length) return '';
  try {
    return relParts.map(segment => decodeURIComponent(segment)).join('/');
  } catch {
    return '';
  }
}

/** Whether href points to a plain-text run file suitable for the modal stage. */
export function isTextRunFile(href) {
  const rel = runFilePath(href);
  return Boolean(rel) && !NON_TEXT_RUN_EXT.test(rel);
}

function wireFallbackCopy(button, pre, dialog, copyLabel) {
  let timer = null;
  const reset = (label, icon) => {
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.innerHTML = icon;
  };
  button.addEventListener('click', () => {
    if (button.disabled || !Object.hasOwn(dialog.dataset, 'codeBox')) return;
    const text = pre.textContent.replace(/\n$/, '');
    const show = (label, icon) => {
      reset(label, icon);
      clearTimeout(timer);
      timer = setTimeout(() => reset(copyLabel, COPY_ICON), 1200);
    };
    navigator.clipboard.writeText(text).then(
      () => show('Copied', COPIED_ICON),
      () => show('Copy failed', COPY_ICON),
    );
  });
}

/** Open the full-screen modal text stage with title, optional path, and text. */
export function openTextStage({
  title,
  path = '',
  text = '',
  copyLabel = 'Copy',
  closeLabel = 'Restore',
  closeIcon = RESTORE_ICON,
  from = document.activeElement,
  onOpen = null,
  onClose = null,
}) {
  for (const existing of document.querySelectorAll('dialog.text-stage[open]')) {
    existing._orcDispose?.();
    existing.close();
    existing.remove();
  }
  const hasOrcButton = typeof customElements !== 'undefined' && Boolean(customElements.get('orc-icon-button'));
  const dismissClass = closeLabel === 'Restore' ? 'text-stage-restore' : 'text-stage-close';
  const copyHtml = hasOrcButton
    ? `<orc-icon-button class="code-copy text-stage-copy" variant="ghost" size="compact" label="${esc(copyLabel)}">${COPY_ICON}</orc-icon-button>`
    : `<button type="button" class="text-stage-btn text-stage-copy" aria-label="${esc(copyLabel)}" title="${esc(copyLabel)}">${COPY_ICON}</button>`;
  const dismissHtml = hasOrcButton
    ? `<orc-icon-button class="${dismissClass}" data-stage-close variant="ghost" size="compact" label="${esc(closeLabel)}">${closeIcon}</orc-icon-button>`
    : `<button type="button" class="text-stage-btn ${dismissClass}" data-stage-close aria-label="${esc(closeLabel)}" title="${esc(closeLabel)}">${closeIcon}</button>`;
  const subtitle = path && path !== title ? `<span class="text-stage-path" translate="no">${esc(path)}</span>` : '';

  const dialog = document.createElement('dialog');
  dialog.className = 'text-stage';
  dialog.dataset.codeBox = '';
  dialog.setAttribute('aria-labelledby', 'text-stage-title');
  dialog.innerHTML = `<div class="text-stage-bar">
      <div class="text-stage-heading">
        <h2 id="text-stage-title" class="text-stage-title">${esc(title)}</h2>
        ${subtitle}
      </div>
      <div class="text-stage-actions">
        ${copyHtml}
        ${dismissHtml}
      </div>
    </div>
    <pre class="text-stage-text" translate="no" tabindex="0"></pre>`;

  const pre = dialog.querySelector('pre');
  pre.textContent = text;
  if (!hasOrcButton) wireFallbackCopy(dialog.querySelector('.text-stage-copy'), pre, dialog, copyLabel);

  let closing = false;
  let downInside = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    onClose?.();
  };
  dialog._orcDispose = dispose;

  const close = () => {
    if (closing) return;
    closing = true;
    dispose();
    change(from, () => {
      dialog.close();
      dialog.remove();
      if (from?.isConnected) from.focus();
    });
  };

  dialog.addEventListener('pointerdown', event => {
    downInside = event.target !== dialog;
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    const startedInside = downInside;
    downInside = false;
    if (event.target === dialog && !startedInside) close();
  });
  dialog.querySelector('[data-stage-close]').addEventListener('click', close);

  document.body.append(dialog);
  change(from, () => {
    dialog.showModal();
    pre.scrollTop = 0;
    pre.scrollLeft = 0;
    pre.focus({ preventScroll: true });
    onOpen?.();
  });
  return dialog;
}

function setCopyEnabled(button, enabled) {
  if (!button) return;
  button.disabled = !enabled;
  if (enabled) button.removeAttribute('disabled');
  else button.setAttribute('disabled', '');
}

/** Fetch a plain-text run file and show it in a closable full-screen modal. */
export function openTextFileStage({
  url,
  title = '',
  path = '',
  copyLabel,
  from = document.activeElement,
  onOpen = null,
  onClose = null,
}) {
  const relPath = path || runFilePath(url) || '';
  const fileName = relPath.split('/').pop() || relPath || url;
  const heading = String(title || '').trim() || fileName;
  const subtitle = relPath && relPath !== heading ? relPath : '';
  const copyText = copyLabel || (relPath.toLowerCase().endsWith('.log') ? 'Copy log' : 'Copy text');
  const controller = new AbortController();

  const dialog = openTextStage({
    title: heading,
    path: subtitle,
    text: 'Loading…',
    copyLabel: copyText,
    closeLabel: 'Close',
    closeIcon: CLOSE_ICON,
    from,
    onOpen,
    onClose: () => {
      controller.abort();
      onClose?.();
    },
  });

  const pre = dialog.querySelector('pre');
  const copyBtn = dialog.querySelector('.text-stage-copy');
  dialog.dataset.state = 'loading';
  delete dialog.dataset.codeBox;
  setCopyEnabled(copyBtn, false);

  fetch(url, { cache: 'no-store', signal: controller.signal })
    .then(async response => {
      if (controller.signal.aborted || !dialog.isConnected) return;
      if (!response.ok) {
        dialog.dataset.state = 'error';
        pre.textContent = `Could not load ${relPath || 'this file'} (HTTP ${response.status}).`;
        return;
      }
      const text = await response.text();
      if (controller.signal.aborted || !dialog.isConnected) return;
      if (!text) {
        dialog.dataset.state = 'empty';
        pre.textContent = 'This file is empty.';
        return;
      }
      delete dialog.dataset.state;
      dialog.dataset.codeBox = '';
      setCopyEnabled(copyBtn, true);
      pre.textContent = text;
      pre.scrollTop = 0;
      pre.scrollLeft = 0;
    })
    .catch(error => {
      if (controller.signal.aborted || error?.name === 'AbortError' || !dialog.isConnected) return;
      dialog.dataset.state = 'error';
      pre.textContent = `Could not load ${relPath || 'this file'}.`;
    });

  return dialog;
}

const wiredRoots = new WeakSet();

/** Intercept plain left clicks on [data-text-stage] run file links. */
export function installTextStageLinks(root = document, { onOpen = null, onClose = null } = {}) {
  if (!root || wiredRoots.has(root)) return;
  wiredRoots.add(root);
  root.addEventListener('click', event => {
    const link = event.target?.closest?.('a[data-text-stage]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href') || '';
    if (!isTextRunFile(href)) return;
    event.preventDefault();
    openTextFileStage({
      url: link.href || href,
      title: link.dataset.textTitle || '',
      path: link.dataset.textPath || '',
      copyLabel: link.dataset.copyLabel || undefined,
      from: link,
      onOpen,
      onClose,
    });
  });
}
