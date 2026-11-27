import { esc } from './core.js';

// The paperclip on every box that takes images.
export const ATTACH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>';

// .nc-beam is the travelling border beam, which project-home.css draws.
export function promptComposerHtml({ id, label = 'Prompt', footer = '', rows = 6, placeholder = 'Describe the task…' }) {
  return '<div class="newconv-prompt" data-part="composer"><textarea id="' + esc(id) + '" rows="' + rows
    + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(label)
    + '"></textarea><footer>' + footer + '</footer><span class="nc-beam" aria-hidden="true"></span></div>';
}

// The composer shows typed list markers as • so a list reads as one while
// drafting; senders pass the text through here so agents and the chat
// transcript still receive a Markdown list.
export function composerText(value) {
  return value.replace(/^([ \t]*)• /gm, '$1- ');
}

export function bulletEdit(value, start, end, key, shift = false) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  if (key === ' ') {
    if (start !== end || !/^[ \t]*[-*+]$/.test(value.slice(lineStart, start))) return null;
    return { from: start - 1, to: start, text: '• ', caret: start + 1 };
  }
  const lineEnd = value.indexOf('\n', start);
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  const bullet = line.match(/^([ \t]*)(?:([-*+•])|(\d+)([.)])) (.*)/);
  if (!bullet) return null;
  if (key === 'Tab') {
    if (start !== end) return null;
    const removed = shift ? (bullet[1].startsWith('\t') ? 1 : Math.min(2, bullet[1].length)) : 0;
    if (shift && !removed) return null;
    const text = shift ? '' : '  ';
    return { from: lineStart, to: lineStart + removed, text, caret: start + text.length - removed };
  }
  if (key !== 'Enter' || start !== end) return null;
  if (!bullet[5].trim()) return { from: lineStart, to: lineStart + line.length, text: '', caret: lineStart };
  const text = '\n' + bullet[1] + (bullet[2] || Number(bullet[3]) + 1 + bullet[4]) + ' ';
  return { from: start, to: end, text, caret: start + text.length };
}

// Holding the box's height while the composer collapses to be measured stops
// the timeline growing for that instant: WebKit clamps its scroll to fit and
// never restores it, so each keystroke would drop the view off the latest message.
export function autoGrow(prompt) {
  const box = prompt.parentElement;
  box.style.minHeight = `${box.offsetHeight}px`;
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  box.style.minHeight = '';
}

export function bindPromptComposer(area) {
  area.addEventListener('keydown', event => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || area.disabled || area.readOnly) return;
    const edit = bulletEdit(area.value, area.selectionStart, area.selectionEnd, event.key, event.shiftKey);
    if (!edit) return;
    event.preventDefault();
    area.setRangeText(edit.text, edit.from, edit.to, 'end');
    area.setSelectionRange(edit.caret, edit.caret);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // The shell marks a pointer focus on the composer's wrapper; only a real
  // focus move clears it, so a later Tab back in shows the keyboard ring.
  area.addEventListener('blur', () => {
    if (document.hasFocus()) delete area.closest('.newconv-prompt')?.dataset.suppressFocusRing;
  });
}
