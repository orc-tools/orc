// The Keyboard shortcuts card in Settings. Clicking a shortcut records the
// next key combination pressed; the registry in shortcuts.js decides what is
// allowed.
import { esc } from './core.js';
import {
  SHORTCUT_COMMANDS, resetShortcuts, setShortcutOverride, setShortcutRecording, shortcutCommand,
  shortcutFromEvent, shortcutIsCustom, shortcutKeys, shortcutKeyLabel, shortcutProblem,
} from './shortcuts.js';

let shortcutRecorder = null; // { id, button } while a row waits for keys
let shortcutSettingsChanged = () => {};

function shortcutKeysHtml(id) {
  const keys = shortcutKeys(id);
  if (!keys.length) return '<span class="shortcut-none">None</span>';
  return keys.map(text => `<kbd>${esc(shortcutKeyLabel(text))}</kbd>`).join('<span class="shortcut-or">or</span>');
}

const shortcutKeysText = id => shortcutKeys(id).map(shortcutKeyLabel).join(' or ') || 'no shortcut';

function shortcutRowHtml(command) {
  const id = esc(command.id), label = esc(command.label);
  return `<li class="shortcut-row" data-shortcut-id="${id}" data-settings-anchor="shortcut-${id}">
    <span class="shortcut-text"><span class="shortcut-name">${label}</span>${command.note ? `<span class="settings-hint">${esc(command.note)}</span>` : ''}</span>
    <orc-chip class="shortcut-custom" variant="accent" hidden>Custom</orc-chip>
    <button type="button" class="settings-btn-inline shortcut-change" data-shortcut-change aria-pressed="false" aria-label="Change shortcut for ${label}" aria-describedby="shortcut-keys-${id}"><span class="shortcut-keys" id="shortcut-keys-${id}"></span></button>
  </li>`;
}

export function shortcutSettingsHtml() {
  return `<div class="settings-card" id="shortcuts-card" data-settings-anchor="shortcuts">
    <fieldset class="settings-fieldset">
      <legend class="settings-label">Keyboard shortcuts</legend>
      <p class="settings-hint">Click a shortcut, then press the new keys. Press its default keys to restore it, Backspace to remove it, or Esc to cancel. Changes apply here and in Orc.app straight away.</p>
      <ul class="shortcut-list" aria-label="Keyboard shortcuts">${SHORTCUT_COMMANDS.map(shortcutRowHtml).join('')}</ul>
      <div class="shortcut-actions"><button type="button" id="shortcuts-reset-all" class="settings-btn-inline">Reset all shortcuts</button></div>
      <p id="shortcuts-status" class="settings-note" role="status" aria-live="polite"></p>
    </fieldset>
  </div>`;
}

function shortcutRow(id) {
  return document.querySelector(`#shortcuts-card .shortcut-row[data-shortcut-id="${id}"]`);
}

function renderShortcutRow(id) {
  const row = shortcutRow(id);
  if (!row) return;
  const recording = shortcutRecorder?.id === id;
  row.querySelector('.shortcut-keys').innerHTML = recording ? 'Press keys…' : shortcutKeysHtml(id);
  row.querySelector('[data-shortcut-change]').setAttribute('aria-pressed', String(recording));
  row.querySelector('.shortcut-custom').hidden = !shortcutIsCustom(id);
}

function shortcutStatus(text, tone = '') {
  const status = document.getElementById('shortcuts-status');
  if (!status) return;
  status.className = `settings-note${tone ? ` ${tone}` : ''}`;
  status.textContent = text;
}

function stopShortcutRecording() {
  if (!shortcutRecorder) return;
  const { id } = shortcutRecorder;
  shortcutRecorder = null;
  setShortcutRecording(false);
  renderShortcutRow(id);
}

function startShortcutRecording(id, button) {
  stopShortcutRecording();
  shortcutRecorder = { id, button };
  setShortcutRecording(true);
  renderShortcutRow(id);
  // WebKit does not focus a clicked button, and recording ends when focus leaves.
  button.focus();
  shortcutStatus(`Press the new keys for ${shortcutCommand(id).label}. Its default keys restore it, Backspace removes it, Esc cancels.`);
}

function finishShortcutChange(id, message) {
  stopShortcutRecording();
  shortcutStatus(message);
  shortcutSettingsChanged();
}

// Capture phase on window, so the keys reach the recorder before any shortcut
// or the terminal can act on them.
globalThis.window?.addEventListener?.('keydown', event => {
  if (!shortcutRecorder) return;
  if (!shortcutRecorder.button.isConnected) { stopShortcutRecording(); return; }
  const { id } = shortcutRecorder;
  const label = shortcutCommand(id).label;
  const plain = !(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey);
  if (event.key === 'Tab' && !(event.ctrlKey || event.altKey || event.metaKey)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return;
  if (plain && event.key === 'Escape') {
    stopShortcutRecording();
    shortcutStatus(`${label} keeps ${shortcutKeysText(id)}.`);
    return;
  }
  if (plain && (event.key === 'Backspace' || event.key === 'Delete')) {
    setShortcutOverride(id, false);
    finishShortcutChange(id, `${label} has no shortcut now.`);
    return;
  }
  const text = shortcutFromEvent(event);
  if (!text) return;
  const problem = shortcutProblem(id, text);
  if (problem) {
    shortcutStatus(`${problem} Try other keys, or press Esc.`, 'error');
    return;
  }
  setShortcutOverride(id, text);
  finishShortcutChange(id, shortcutIsCustom(id)
    ? `${label} is now ${shortcutKeysText(id)}.` : `${label} is back to ${shortcutKeysText(id)}.`);
}, true);

export function mountShortcutSettings({ onChange = () => {} } = {}) {
  const card = document.getElementById('shortcuts-card');
  if (!card) return;
  shortcutSettingsChanged = onChange;
  stopShortcutRecording();
  for (const command of SHORTCUT_COMMANDS) renderShortcutRow(command.id);
  card.addEventListener('click', event => {
    const button = event.target.closest('button');
    const id = button?.closest('.shortcut-row')?.dataset.shortcutId;
    if (button?.matches('[data-shortcut-change]')) {
      if (shortcutRecorder?.id === id) {
        stopShortcutRecording();
        shortcutStatus('');
      } else startShortcutRecording(id, button);
    } else if (button?.id === 'shortcuts-reset-all') {
      stopShortcutRecording();
      resetShortcuts();
      for (const command of SHORTCUT_COMMANDS) renderShortcutRow(command.id);
      shortcutStatus('Every shortcut is back to its default.');
      shortcutSettingsChanged();
    }
  });
  card.addEventListener('focusout', event => {
    if (shortcutRecorder && event.target === shortcutRecorder.button) {
      stopShortcutRecording();
      shortcutStatus('');
    }
  });
}
