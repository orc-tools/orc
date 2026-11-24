// Orc's global keyboard shortcuts: what each one does, the keys it starts
// with, and the overrides saved under `ui.shortcuts` in ~/.orc/config.json.
// A shortcut is text such as "Ctrl+Alt+Shift+Meta+K"; "Mod" in a default is ⌘
// on a Mac and Ctrl elsewhere. An override is a shortcut, or false for none.

export const SHORTCUT_IS_MAC = /mac|iphone|ipad/i.test(
  globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');

// `menu` names the Orc.app menu item that carries the same command, so the
// native menu can follow a change instead of claiming the old key first.
export const SHORTCUT_COMMANDS = [
  { id: 'command-palette', label: 'Open the command palette', keys: ['Meta+K', 'Ctrl+K'], menu: 'commandPalette' },
  { id: 'new-conversation', label: 'Start a new conversation', keys: ['Meta+N', 'Ctrl+N'], menu: 'newConversation' },
  { id: 'search', label: 'Search runs', keys: ['/'] },
  { id: 'settings', label: 'Open or close Settings', keys: ['Meta+,', 'Ctrl+,'], menu: 'settings' },
  { id: 'terminal', label: 'Show or hide the terminal', note: 'Outside a run it opens the project’s root.', keys: ['Meta+J', 'Ctrl+J'], menu: 'terminal' },
  { id: 'switch-project', label: 'Switch project', keys: ['Mod+P'], menu: 'switchProject' },
  { id: 'side-panel', label: 'Show or hide the side panel', keys: ['Mod+B'], menu: 'sidePanel' },
  { id: 'dictation', label: 'Start or stop dictation', keys: ['Mod+D'], menu: 'dictation' },
  { id: 'model-picker', label: 'Choose a model', keys: ['Mod+M'], menu: 'modelPicker' },
  { id: 'fast-mode', label: 'Turn Fast mode on or off', note: 'Works in the composer. Opens Settings search in Settings, and Find everywhere else in Orc.app.', keys: ['Mod+F'], menu: 'find' },
  { id: 'effort-down', label: 'Lower the effort', note: 'Works in the composer.', keys: ['Mod+['] },
  { id: 'effort-up', label: 'Raise the effort', note: 'Works in the composer.', keys: ['Mod+]'] },
  { id: 'auto-merge', label: 'Turn Auto merge on or off', note: 'Works in the new-run composer and a run’s Chat while the Auto merge plugin is on.', keys: ['Mod+S'] },
];

// Keys Orc.app, the terminal or text editing already own. A shortcut on one of
// these would either never arrive or take the key away from something else.
const SHORTCUT_RESERVED = {
  'Meta+Q': 'quits Orc.app', 'Meta+H': 'hides Orc.app', 'Meta+W': 'closes the tab',
  'Meta+R': 'reloads the page', 'Meta+T': 'opens a terminal tab',
  'Meta+0': 'shows Orc',
  'Meta+Enter': 'sends a message', 'Ctrl+Enter': 'sends a message', 'Escape': 'closes dialogs',
};
for (const [key, does] of [['C', 'copies'], ['V', 'pastes'], ['X', 'cuts'], ['A', 'selects all'], ['Z', 'undoes']]) {
  SHORTCUT_RESERVED[`Meta+${key}`] = does;
  SHORTCUT_RESERVED[`Ctrl+${key}`] = does;
}
SHORTCUT_RESERVED['Shift+Meta+Z'] = 'redoes';
for (let digit = 1; digit <= 9; digit++) SHORTCUT_RESERVED[`Meta+${digit}`] = 'picks a terminal tab or model';

const SHORTCUT_CODE_KEYS = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', Space: 'Space',
};
const SHORTCUT_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'AltGraph']);
const SHORTCUT_KEY_LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↩', Space: 'Space',
  Backspace: '⌫', Delete: '⌦', Escape: 'Esc', Tab: '⇥', PageUp: 'Page Up', PageDown: 'Page Down',
};

let shortcutOverrides = {};
let shortcutRecording = false;

export function parseShortcut(text) {
  if (typeof text !== 'string' || !text) return null;
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+').filter(Boolean), '+'] : text.split('+');
  const key = parts.pop();
  if (!key) return null;
  const combo = { ctrl: false, alt: false, shift: false, meta: false, key: key.length === 1 ? key.toLowerCase() : key };
  for (const part of parts) {
    if (part === 'Ctrl') combo.ctrl = true;
    else if (part === 'Alt') combo.alt = true;
    else if (part === 'Shift') combo.shift = true;
    else if (part === 'Meta') combo.meta = true;
    else if (part === 'Mod') combo[SHORTCUT_IS_MAC ? 'meta' : 'ctrl'] = true;
    else return null;
  }
  return combo;
}

function shortcutText(combo) {
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return [combo.ctrl && 'Ctrl', combo.alt && 'Alt', combo.shift && 'Shift', combo.meta && 'Meta', key]
    .filter(Boolean).join('+');
}

const shortcutCanonical = text => {
  const combo = parseShortcut(text);
  return combo ? shortcutText(combo) : '';
};

export function shortcutKeyLabel(text) {
  const combo = parseShortcut(text);
  if (!combo) return '';
  const key = SHORTCUT_KEY_LABELS[combo.key] || (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  if (SHORTCUT_IS_MAC) {
    return (combo.ctrl ? '⌃' : '') + (combo.alt ? '⌥' : '') + (combo.shift ? '⇧' : '') + (combo.meta ? '⌘' : '') + key;
  }
  return [combo.ctrl && 'Ctrl', combo.alt && 'Alt', combo.shift && 'Shift', combo.meta && 'Meta', key]
    .filter(Boolean).join('+');
}

// A list that picks its rows by number, as the model picker and the
// Orchestrate card do: ⌘1–⌘9 on a Mac, Ctrl+1–9 elsewhere. Returns the
// zero-based row the event names, or -1.
export function numberPickIndex(event) {
  const held = SHORTCUT_IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!held || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return -1;
  return Number(event.key) - 1;
}

// The hint a row picked by number wears, or '' past the ninth.
export const numberPickLabel = index => (index < 9 ? `${SHORTCUT_IS_MAC ? '⌘' : 'Ctrl+'}${index + 1}` : '');

// Option changes the character a Mac key types (⌥K is ˚), so with Alt held
// the physical key decides; otherwise the typed key does, as it always has.
function shortcutEventKey(event) {
  const code = String(event.code || '');
  if (event.altKey && code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (SHORTCUT_CODE_KEYS[code]) return SHORTCUT_CODE_KEYS[code];
  }
  const key = String(event.key || '');
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}

const shortcutIsSymbol = key => key.length === 1 && !/[a-z0-9]/.test(key);
const shortcutIsChord = combo => combo.ctrl || combo.alt || combo.meta;

// composedPath: inside an <orc-input> the event is retargeted to the host,
// which hides the real field in its shadow root.
function shortcutTypingTarget(event) {
  const target = event.composedPath?.()[0] || event.target;
  return Boolean(target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]'));
}

function shortcutComboMatches(combo, event) {
  if (!combo || Boolean(event.ctrlKey) !== combo.ctrl || Boolean(event.altKey) !== combo.alt
    || Boolean(event.metaKey) !== combo.meta) return false;
  if (shortcutEventKey(event) !== combo.key) return false;
  // A plain symbol already says whether Shift was needed to type it; with ⌘
  // held, browsers keep the unshifted symbol (`]` on ⇧⌘]), so Shift still counts.
  if (Boolean(event.shiftKey) !== combo.shift && !(shortcutIsSymbol(combo.key) && !shortcutIsChord(combo))) return false;
  return shortcutIsChord(combo) || !shortcutTypingTarget(event);
}

export function shortcutCommand(id) {
  return SHORTCUT_COMMANDS.find(command => command.id === id) || null;
}

export function shortcutKeys(id) {
  const command = shortcutCommand(id);
  if (!command) return [];
  if (!(id in shortcutOverrides)) return command.keys.map(shortcutCanonical);
  return shortcutOverrides[id] === false ? [] : [shortcutOverrides[id]];
}

export function shortcutIsCustom(id) {
  return id in shortcutOverrides;
}

export function shortcutMatches(id, event) {
  if (shortcutRecording) return false;
  return shortcutKeys(id).some(text => shortcutComboMatches(parseShortcut(text), event));
}

export function shortcutFromEvent(event) {
  if (SHORTCUT_MODIFIER_KEYS.has(event.key)) return null;
  const key = shortcutEventKey(event);
  if (!key || key === 'Unidentified' || key === 'Dead') return null;
  return shortcutText({
    ctrl: Boolean(event.ctrlKey), alt: Boolean(event.altKey), shift: Boolean(event.shiftKey),
    meta: Boolean(event.metaKey), key,
  });
}

// Why `text` cannot become `id`'s shortcut, or '' when it can.
export function shortcutProblem(id, text) {
  const combo = parseShortcut(text);
  if (!combo) return 'Orc can’t read that key.';
  const canonical = shortcutText(combo);
  const label = shortcutKeyLabel(canonical);
  if (SHORTCUT_RESERVED[canonical]) return `${label} already ${SHORTCUT_RESERVED[canonical]}.`;
  if (!shortcutIsChord(combo) && !shortcutIsSymbol(combo.key) && !/^F\d{1,2}$/.test(combo.key)) {
    return `Add ${SHORTCUT_IS_MAC ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'}: ${label} on its own would fire while you type.`;
  }
  const clash = SHORTCUT_COMMANDS.find(command => command.id !== id && shortcutKeys(command.id).includes(canonical));
  return clash ? `${label} is already used by ${clash.label}.` : '';
}

function shortcutReadOverrides(saved) {
  const next = {};
  if (!saved || typeof saved !== 'object') return next;
  for (const command of SHORTCUT_COMMANDS) {
    const value = saved[command.id];
    if (value === false) next[command.id] = false;
    else if (typeof value === 'string' && parseShortcut(value)) next[command.id] = shortcutCanonical(value);
  }
  return next;
}

export function setShortcutOverrides(saved) {
  shortcutOverrides = shortcutReadOverrides(saved);
  syncNativeShortcuts();
}

// `value` is a shortcut, false for none, or undefined to go back to the default.
export function setShortcutOverride(id, value) {
  if (!shortcutCommand(id)) return;
  const next = { ...shortcutOverrides };
  delete next[id];
  const defaults = shortcutCommand(id).keys.map(shortcutCanonical);
  if (value === false) next[id] = false;
  else if (typeof value === 'string' && parseShortcut(value)) {
    const canonical = shortcutCanonical(value);
    if (!defaults.includes(canonical)) next[id] = canonical;
  }
  shortcutOverrides = next;
  syncNativeShortcuts();
}

export function resetShortcuts() {
  shortcutOverrides = {};
  syncNativeShortcuts();
}

// The `ui.shortcuts` value to save: the overrides, keeping entries a newer Orc
// wrote for commands this one does not know. Undefined means remove the key.
export function shortcutOverridesForConfig(saved) {
  const known = new Set(SHORTCUT_COMMANDS.map(command => command.id));
  const next = {};
  for (const [id, value] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
    if (!known.has(id)) next[id] = value;
  }
  Object.assign(next, shortcutOverrides);
  return Object.keys(next).length ? next : undefined;
}

export function setShortcutRecording(on) {
  shortcutRecording = Boolean(on);
  syncNativeShortcuts();
}

const SHORTCUT_NATIVE_MODIFIERS = [['ctrl', 'control'], ['alt', 'option'], ['shift', 'shift'], ['meta', 'command']];

// Orc.app's menus claim their keys before the page sees them, so the shell is
// told the keys in effect. A menu shows one key, so a ⌘ shortcut wins; a key a
// menu cannot show (F5, arrows) leaves the item blank and the page handles it.
function shortcutNativeItem(id) {
  const combos = shortcutKeys(id).map(parseShortcut).filter(Boolean);
  const combo = combos.find(candidate => candidate.meta) || combos[0];
  if (!combo || combo.key.length !== 1) return null;
  return { key: combo.key, modifiers: SHORTCUT_NATIVE_MODIFIERS.filter(([flag]) => combo[flag]).map(([, name]) => name) };
}

// An Orc.app built before this bridge has no handler and keeps its own keys.
export function syncNativeShortcuts() {
  const bridge = globalThis.window?.webkit?.messageHandlers?.orcShortcuts;
  if (!bridge) return;
  const items = {};
  for (const command of SHORTCUT_COMMANDS) {
    if (command.menu) items[command.menu] = shortcutNativeItem(command.id);
  }
  bridge.postMessage({ action: shortcutRecording ? 'suspend' : 'set', items });
}
