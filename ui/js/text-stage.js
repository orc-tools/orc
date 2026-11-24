import { esc } from './core.js';
import { canChangeScreen, changeScreen } from './screen-change.js';

// Long text maximised over the app the way the terminal maximises: a frame
// over a blurred page, with the same screen change on the way in and out.
// Its Copy button is ui/md-callouts.js's code-copy, which copies the <pre>
// of the nearest [data-code-box].

const ICON = path => `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
export const MAXIMISE_ICON = ICON('M214,48V96a6,6,0,0,1-12,0V62.48l-45.76,45.76a6,6,0,0,1-8.48-8.48L193.52,54H160a6,6,0,0,1,0-12h48A6,6,0,0,1,214,48ZM99.76,147.76,54,193.52V160a6,6,0,0,0-12,0v48a6,6,0,0,0,6,6H96a6,6,0,0,0,0-12H62.48l45.76-45.76a6,6,0,0,0-8.48-8.48Z');
export const RESTORE_ICON = ICON('M150,104V72a6,6,0,0,1,12,0V89.52l45.76-45.76a6,6,0,0,1,8.48,8.48L170.48,98H188a6,6,0,0,1,0,12H156A6,6,0,0,1,150,104ZM100,146H68a6,6,0,0,0,0,12H85.52L39.76,203.76a6,6,0,1,0,8.48,8.48L94,166.48V184a6,6,0,0,0,12,0V152A6,6,0,0,0,100,146Z');
export const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

export function copyButtonHtml(label) {
  return `<orc-icon-button class="code-copy" variant="ghost" size="compact" label="${esc(label)}">${COPY_ICON}</orc-icon-button>`;
}

// The change starts from the button that asked for it, as the terminal's
// starts from its header chip; it is skipped when it cannot play.
function change(from, swap) {
  if (!canChangeScreen()) { swap(); return Promise.resolve(); }
  const box = from?.isConnected ? from.getBoundingClientRect() : null;
  return changeScreen('stage', swap, box?.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
}

// Restore, Escape and a click on the blurred page all close it, and focus
// goes back to `from`.
export function openTextStage({ title, text, copyLabel = 'Copy', from = document.activeElement }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'text-stage';
  dialog.dataset.codeBox = '';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<div class="text-stage-bar">
      <h2 class="text-stage-title">${esc(title)}</h2>
      ${copyButtonHtml(copyLabel)}
      <orc-icon-button class="text-stage-restore" variant="ghost" size="compact" label="Restore">${RESTORE_ICON}</orc-icon-button>
    </div>
    <pre class="text-stage-text" translate="no" tabindex="0"></pre>`;
  dialog.querySelector('pre').textContent = text;
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    change(from, () => {
      dialog.close();
      dialog.remove();
      if (from?.isConnected) from.focus();
    });
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.querySelector('.text-stage-restore').addEventListener('click', close);
  document.body.append(dialog);
  change(from, () => {
    dialog.showModal();
    dialog.querySelector('pre').focus();
  });
  return dialog;
}
