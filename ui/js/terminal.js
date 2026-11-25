
import { $, runs, announce, holdInert, toast } from './core.js';
import { canChangeScreen, changeScreen } from './screen-change.js';
import { bindContextMenu, placeContextMenu } from './context-menu.js';
import { terminalTree, terminalTreeRows } from './terminal-tree.js';
import { SHORTCUT_IS_MAC, shortcutMatches } from './shortcuts.js';
import { chatComposerReady, focusChatComposer } from './chat.js';

// Phosphor terminal-window, light weight — the header chip's glyph.
export const TERMINAL_ICON = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M126,128a6,6,0,0,1-2.25,4.69l-40,32a6,6,0,0,1-7.5-9.38L110.4,128,76.25,100.69a6,6,0,1,1,7.5-9.38l40,32A6,6,0,0,1,126,128Zm50,26H136a6,6,0,0,0,0,12h40a6,6,0,0,0,0-12Zm54-98V200a14,14,0,0,1-14,14H40a14,14,0,0,1-14-14V56A14,14,0,0,1,40,42H216A14,14,0,0,1,230,56Zm-12,0a2,2,0,0,0-2-2H40a2,2,0,0,0-2,2V200a2,2,0,0,0,2,2H216a2,2,0,0,0,2-2Z"/></svg>';

// The panel's state and wiring live in one closure, as the palette's do: the
// module test reads every top-level name as app-wide.
let terminalOpen = false;
let terminalToggle = () => {};
export function isTerminalOpen() { return terminalOpen; }
export function toggleTerminal() { terminalToggle(); }

(() => {
  const HEIGHT_KEY = 'orcTerminalHeight';
  const OPEN_KEY = 'orcTerminalOpenRuns';
  // Whether the user last chose the maximised stage, so ⌘J reopens at that size.
  const MAXIMISED_KEY = 'orcTerminalMaximised';
  const MAX_REMEMBERED_RUNS = 100;
  const MIN_HEIGHT = 120;
  // A first open, before any drag, takes about half the window.
  const DEFAULT_HEIGHT_SHARE = 0.5;
  // The Nerd Font build of JetBrains Mono, the font Ghostty uses: box drawing,
  // Powerline arrows, spinners and icons all come from one font, so they keep
  // the cell width and look the same off a Mac. ui/index.html declares it, and
  // the browser fetches it only once a terminal measures it.
  const FONT = '"JetBrains Mono Nerd Font Mono"';
  const NO_SCOPE = 'Pick a project to use its terminal.';

  let lib = null;
  let loading = null;
  // What the tabs on screen belong to: a run, or outside one a project's
  // root. `id` tells scopes apart here; `key` is the daemon's name for the
  // scope's herdr workspace.
  let scope = null;
  let openingScope = null;
  // In strip order, and which one shows.
  let tabs = [];
  let active = null;
  let building = null;
  let resizeFrame = 0;
  let returnFocus = null;
  // With herdr installed there is one connection, to Orc's herdr session,
  // which holds a workspace per scope. The strip mirrors the tabs of the
  // workspace herdr shows, as the daemon pushes them.
  let herdrTabs = [];
  // Tabs in every workspace of the session, where herdrTabs is only the
  // focused one's: closing the session's last tab ends it.
  let herdrSessionTabs = 0;
  // Every workspace of the session, for the maximised terminal's sidebar.
  let herdrWorkspaces = [];
  // Bumped whenever the tabs are rebuilt, so a reply for the old ones is dropped.
  let generation = 0;
  // The maximised stage, and where focus returns when it closes.
  let staged = null;
  let stageMotion = null;

  function storedHeight() {
    let value = NaN;
    try { value = Number(localStorage.getItem(HEIGHT_KEY)); } catch {}
    return Number.isFinite(value) && value >= MIN_HEIGHT ? value : Math.round(window.innerHeight * DEFAULT_HEIGHT_SHARE);
  }

  function openRuns() {
    try {
      const ids = JSON.parse(localStorage.getItem(OPEN_KEY));
      return Array.isArray(ids) ? ids : [];
    } catch { return []; }
  }

  function rememberOpen(runId, open) {
    if (!runId) return;
    const ids = openRuns().filter(id => id !== runId);
    if (open) ids.push(runId);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED_RUNS))); } catch {}
  }

  function storedMaximised() {
    try { return localStorage.getItem(MAXIMISED_KEY) === 'true'; } catch { return false; }
  }

  function rememberMaximised(on) {
    try { localStorage.setItem(MAXIMISED_KEY, String(on)); } catch {}
  }

  // The dock grows as far as the user drags it, short of covering the chat's
  // reply box itself — never the cards pinned above it — so opening or closing
  // cards leaves the terminal fixed and dragging it up is not capped by them.
  function promptReserve() {
    const composer = $('content').querySelector('.chat-composer');
    const box = composer?.querySelector('.newconv-prompt');
    if (!composer || !box) return 0;
    const style = getComputedStyle(composer);
    const chrome = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    return Math.ceil(box.getBoundingClientRect().height + chrome);
  }

  function maxHeight() {
    const shell = $('content-shell').getBoundingClientRect?.();
    return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - (shell?.top || 0) - promptReserve()));
  }

  function setHeight(px, persist = true) {
    const maximum = maxHeight();
    const height = Math.round(Math.min(maximum, Math.max(MIN_HEIGHT, px)));
    $('run-terminal').style.height = `${height}px`;
    const handle = $('run-terminal-resize');
    handle.setAttribute('aria-valuenow', String(height));
    handle.setAttribute('aria-valuemax', String(maximum));
    if (persist) { try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch {} }
    scheduleFit();
  }

  function fitDock() {
    if (terminalOpen && !staged) setHeight(storedHeight(), false);
  }

  const dockObserver = new ResizeObserver(fitDock);

  function observeDock() {
    dockObserver.disconnect();
    dockObserver.observe($('content-shell'));
    const prompt = $('content').querySelector('.chat-composer .newconv-prompt');
    if (prompt) dockObserver.observe(prompt);
  }

  // The run the hash names, when it is one the sidebar knows. Everything else
  // (#new, #settings, #tickets…) has no checkout to open a shell in.
  function currentRunId() {
    const id = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
    return id && runs.some(run => run.id === id) ? id : null;
  }

  // The page's scope: its run, or outside a run the root of the project the
  // home screen last picked.
  function currentScope() {
    const runId = currentRunId();
    if (runId) return { kind: 'run', runId, id: `run:${runId}` };
    const path = window.orcCurrentProject?.() || '';
    return path ? { kind: 'project', path, id: `project:${path}` } : null;
  }

  function scopeUrl(target, suffix, query = '') {
    if (target.kind === 'run') {
      return `/api/runs/${encodeURIComponent(target.runId)}/terminal${suffix}${query ? `?${query}` : ''}`;
    }
    return `/api/terminal${suffix}?project=${encodeURIComponent(target.path)}${query ? `&${query}` : ''}`;
  }

  // With herdr installed the strip shows herdr's tabs and, beside them, any
  // shell tabs Orc opened when herdr could not take a command.
  function herdrEntry() { return tabs.find(tab => tab.kind === 'herdr'); }
  function herdrMode() { return Boolean(herdrEntry()); }
  function shownWorkspace() { return herdrWorkspaces.find(item => item.focused) || null; }

  function syncBar() {
    const status = $('run-terminal-status');
    status.textContent = status.title = active?.status
      || (active?.kind === 'shell' && !active.socket ? 'Select Shell to connect.' : '')
      || (active?.kind === 'herdr' && !active.socket ? 'Select a tab to connect.' : '');
    $('run-terminal-reconnect').hidden = !active?.reconnect;
    // The sidebar can leave herdr on another workspace than the page's own.
    const elsewhere = active?.kind === 'herdr' && shownWorkspace() && shownWorkspace().scope !== scope?.key;
    const cwd = elsewhere ? '' : active?.cwd || '';
    $('run-terminal-cwd').textContent = cwd ? `\u200e${cwd}\u200e` : '';
    $('run-terminal-cwd').title = cwd;
  }

  function setStatus(tab, text, { reconnect = false } = {}) {
    tab.status = text;
    tab.reconnect = reconnect;
    if (tab === active) syncBar();
  }

  function token(style, name) { return style.getPropertyValue(name).trim(); }

  // xterm parses hex and rgb() only, so the palette mixes in plain numbers
  // rather than handing it the CSS color-mix() the stylesheet uses.
  function rgb(hex) {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? [...value].map(ch => ch + ch).join('') : value;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0);
  }
  function mix(a, b, weight) {
    const [x, y] = [rgb(a), rgb(b)];
    return '#' + x.map((v, i) => Math.round(v * weight + y[i] * (1 - weight)).toString(16).padStart(2, '0')).join('');
  }

  // ANSI colours come from Orc's own palette, so `ls`, git and test output
  // read in the same hues as the rest of the app in both themes.
  function terminalTheme() {
    const style = getComputedStyle(document.documentElement);
    const heading = token(style, '--heading');
    const panel = token(style, '--panel');
    const theme = {
      background: panel,
      foreground: token(style, '--text'),
      cursor: heading,
      cursorAccent: panel,
      selectionBackground: mix(token(style, '--accent'), panel, 0.35),
      black: token(style, '--code'),
      white: token(style, '--muted'),
      brightBlack: token(style, '--muted'),
      brightWhite: heading,
    };
    const named = {
      red: '--red', green: '--green', yellow: '--yellow',
      blue: '--accent', magenta: '--purple', cyan: '--cyan',
    };
    for (const [key, name] of Object.entries(named)) {
      theme[key] = token(style, name);
      theme[`bright${key[0].toUpperCase()}${key.slice(1)}`] = mix(theme[key], heading, 0.8);
    }
    return theme;
  }

  let stylesReady = null;
  function ensureStyles() {
    if (document.getElementById('orc-term-styles')) return stylesReady;
    const link = document.createElement('link');
    link.id = 'orc-term-styles';
    link.rel = 'stylesheet';
    link.href = '/vendor/orc-term.min.css';
    stylesReady = new Promise(resolve => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
    });
    document.head.append(link);
    return stylesReady;
  }

  async function loadRenderer() {
    if (lib) return lib;
    if (loading) return loading;
    loading = (async () => {
      const [module] = await Promise.all([import('/vendor/orc-term.min.js'), ensureStyles()]);
      // xterm measures the cell once at open; a font that lands later leaves
      // every cell the fallback font's width.
      try { await Promise.all([`13px ${FONT}`, `bold 13px ${FONT}`].map(font => document.fonts.load(font))); } catch {}
      lib = module;
      return lib;
    })();
    try { return await loading; } finally { loading = null; }
  }

  // xterm draws its selection instead of making a DOM range, so WebKit's
  // native Copy finds nothing selected and ⌘C would do nothing in Orc.app.
  function copySelection(term, event) {
    if (event.type !== 'keydown' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 'c' || !term.hasSelection()) return;
    event.preventDefault();
    navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
  }

  // Off a Mac, Ctrl+V and Ctrl+Shift+V paste, as in Windows Terminal. xterm
  // would send ^V and cancel the key, so the browser never raised its paste
  // event. That event reaches xterm without the clipboard API, which a page
  // served over plain http to another computer does not have.
  function pasteKey(event) {
    if (event.type !== 'keydown' || !event.ctrlKey || event.altKey || event.metaKey) return false;
    return event.key.toLowerCase() === 'v' && !SHORTCUT_IS_MAC;
  }

  // A copy out of herdr, or out of a program, arrives as OSC 52 just after
  // the release or keypress that made it, and Safari refuses a clipboard
  // write once that gesture is over. So the gesture starts a write whose text
  // is the next OSC 52. One arriving with no gesture here was made on another
  // device sharing herdr, or is old output replayed on reconnect.
  const COPY_WINDOW = 1500;
  const copyIntent = { at: -Infinity, text: null };

  function expectCopy(clipboard = navigator.clipboard, now = performance.now()) {
    copyIntent.text?.(null);
    copyIntent.at = now;
    copyIntent.text = null;
    if (!globalThis.ClipboardItem || !clipboard?.write) return;
    let copied = null;
    const text = new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(null), COPY_WINDOW);
      const settle = value => {
        clearTimeout(timer);
        if (copyIntent.text === settle) copyIntent.text = null;
        copied = value;
        if (value === null) reject(new Error('nothing copied'));
        else resolve(new Blob([value], { type: 'text/plain' }));
      };
      copyIntent.text = settle;
    });
    clipboard.write([new ClipboardItem({ 'text/plain': text })])
      // A browser that cannot take a pending item can still take the text.
      .catch(() => { if (copied !== null) clipboard.writeText(copied).catch(() => {}); });
  }

  // Any key may copy (a herdr copy key, a program's own), so each one counts
  // as a gesture; Enter and herdr's y, which usually do, also start a write.
  function noteGesture(now = performance.now()) { copyIntent.at = now; }

  // herdr copies on the release of a press in the terminal, wherever the
  // release lands, as xterm reports one outside the pane too.
  function expectCopyOnRelease(tab, doc = document) {
    if (tab.releaseArmed) return;
    tab.releaseArmed = true;
    doc.addEventListener('mouseup', () => {
      tab.releaseArmed = false;
      expectCopy();
    }, { capture: true, once: true });
  }

  function takeCopy(text, toMac, clipboard = navigator.clipboard, now = performance.now()) {
    if (now - copyIntent.at > COPY_WINDOW) return Promise.resolve();
    copyIntent.at = -Infinity;
    toMac(text);
    const settle = copyIntent.text;
    if (settle) { settle(text); return Promise.resolve(); }
    return clipboard?.writeText(text) ?? Promise.resolve();
  }

  function clipboardFor(tab) {
    const toMac = text => {
      if (tab.socket?.readyState === WebSocket.OPEN) tab.socket.send(JSON.stringify({ type: 'copy', text }));
    };
    // Write-only, so a program's OSC 52 query never reads the clipboard back.
    return {
      readText: () => '',
      writeText: (selection, text) => (selection === 'c' ? takeCopy(text, toMac) : Promise.resolve()),
    };
  }

  // A URL in the row under the pointer, matched as addon-web-links does,
  // short of herdr's pane borders.
  const URL_PATTERN = /https?:\/\/[^\s"'<>`{}|\\^─-╿]*[^\s"':,.!?{}|\\^~[\]`()<>─-╿]/g;

  function linkAt(term, event) {
    const cell = cellAt(term, event);
    const line = term.buffer.active.getLine(Math.floor(cell / term.cols));
    if (!line) return null;
    const column = cell % term.cols;
    let text = '';
    const columns = [];
    for (let x = 0; x < term.cols; x++) {
      const found = line.getCell(x);
      // The right half of a wide character has no text of its own.
      if (found?.getWidth() === 0) continue;
      const chars = found?.getChars() || ' ';
      text += chars;
      for (let i = 0; i < chars.length; i++) columns.push(x);
    }
    for (const match of text.matchAll(URL_PATTERN)) {
      const first = columns[match.index];
      const last = columns[match.index + match[0].length - 1];
      if (column >= first && column <= last) return match[0];
    }
    return null;
  }

  // herdr opens a Ctrl-clicked link with `open` on the Mac it runs on,
  // whichever device clicked, so a link xterm can see opens here instead and
  // herdr never hears the click.
  function openLinkOnPress(term, tab, event) {
    if (!event.ctrlKey || (event.button !== 0 && event.button !== 2)) return;
    const url = linkAt(term, event);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    tab.swallowUntil = event.timeStamp + 1000;
    window.open(url, '_blank', 'noopener');
  }

  // The release, click and context menu that follow that press.
  function swallowClick(tab, event) {
    if (!(event.timeStamp < tab.swallowUntil)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // macOS terminals' line-editing keys. xterm sends ⌥← as ESC[1;3D, which
  // zsh and bash leave unbound, and ⌘ never reaches it.
  const lineEditing = {
    alt: { ArrowLeft: '\x1bb', ArrowRight: '\x1bf' },
    meta: { ArrowLeft: '\x01', ArrowRight: '\x05', Backspace: '\x15' },
  };

  function sendLineEdit(term, event) {
    if (event.type !== 'keydown' || event.ctrlKey || event.shiftKey || event.altKey === event.metaKey) return false;
    const sequence = lineEditing[event.altKey ? 'alt' : 'meta'][event.key];
    if (!sequence) return false;
    event.preventDefault();
    term.input(sequence);
    return true;
  }

  function cellAt(term, event) {
    const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect();
    const column = Math.floor((event.clientX - screen.left) * term.cols / screen.width);
    const row = Math.floor((event.clientY - screen.top) * term.rows / screen.height);
    return (term.buffer.active.viewportY + row) * term.cols + column;
  }

  // xterm reports a selection in reading order, not which end the mouse
  // pressed. The end nearer the press stays put while ⇧+arrows move the other.
  function selectionEnds(term, tab) {
    const { start, end } = term.getSelectionPosition();
    const first = start.y * term.cols + start.x;
    const last = end.y * term.cols + end.x - 1;
    const kept = tab.selectionEnds;
    if (kept && Math.min(kept.anchor, kept.head) === first && Math.max(kept.anchor, kept.head) === last) return kept;
    const pressed = tab.pressedCell ?? first;
    return Math.abs(pressed - first) <= Math.abs(pressed - last)
      ? { anchor: first, head: last }
      : { anchor: last, head: first };
  }

  // Sent to the shell, ⇧+arrows would clear the selection like any input.
  function adjustSelection(term, tab, event) {
    if (event.type !== 'keydown' || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -term.cols, ArrowDown: term.cols }[event.key];
    if (!step || !term.hasSelection()) return false;
    event.preventDefault();
    const ends = selectionEnds(term, tab);
    ends.head = Math.min(Math.max(ends.head + step, 0), term.buffer.active.length * term.cols - 1);
    const first = Math.min(ends.anchor, ends.head);
    term.select(first % term.cols, Math.floor(first / term.cols), Math.abs(ends.head - ends.anchor) + 1);
    tab.selectionEnds = ends;
    const row = Math.floor(ends.head / term.cols);
    const top = term.buffer.active.viewportY;
    if (row < top) term.scrollToLine(row);
    else if (row >= top + term.rows) term.scrollToLine(row - term.rows + 1);
    return true;
  }

  function selectOnPress(term, event) {
    if (event.button !== 0 || event.altKey || event.metaKey) return;
    if (term.modes.mouseTrackingMode === 'none') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    event.target.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: event.view, detail: event.detail,
      screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: true, button: 0, buttons: event.buttons,
    }));
  }

  function createTerm(tab) {
    const readOnly = false;
    const term = new lib.Terminal({
      allowProposedApi: true,
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontFamily: `${FONT}, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
      fontSize: 13,
      // The font's own line height: box-drawing lines span exactly that, so
      // any more leaves gaps between rows.
      lineHeight: 1,
      macOptionIsMeta: true,
      // selectOnPress depends on this.
      macOptionClickForcesSelection: true,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    tab.fit = new lib.FitAddon();
    term.loadAddon(tab.fit);
    // A drag that starts and ends on one link selects part of it (herdr
    // copies that), so only a click in place opens it.
    term.loadAddon(new lib.WebLinksAddon((event, uri) => {
      if (cellAt(term, event) === tab.pressedCell) window.open(uri, '_blank', 'noopener');
    }));
    const unicode = new lib.Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11';
    tab.pane = document.createElement('div');
    tab.pane.className = 'terminal-pane';
    tab.pane.hidden = true;
    $('run-terminal-screen').append(tab.pane);
    // Ahead of selectOnPress, which stops later listeners. ⇧-click extends from
    // the original press, so it keeps that anchor.
    tab.pane.addEventListener('mousedown', event => {
      if (event.button === 0 && !event.shiftKey) tab.pressedCell = cellAt(term, event);
      expectCopyOnRelease(tab);
    }, true);
    // herdr runs its own mouse UI (pane focus, splits, tab drag, selection).
    if (tab.kind !== 'herdr') tab.pane.addEventListener('mousedown', event => selectOnPress(term, event), true);
    else {
      tab.pane.classList.add('herdr');
      tab.pane.addEventListener('mousedown', event => openLinkOnPress(term, tab, event), true);
      for (const type of ['mouseup', 'click', 'contextmenu']) {
        tab.pane.addEventListener(type, event => swallowClick(tab, event), true);
      }
    }
    tab.pane.addEventListener('touchend', () => expectCopy(), true);
    term.open(tab.pane);
    term.loadAddon(new lib.ClipboardAddon(undefined, clipboardFor(tab)));
    try {
      const webgl = new lib.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL: xterm keeps its DOM renderer.
    }
    // ⌘-chords belong to Orc and the browser (⌘J, ⌘T, ⌘K, ⌘V's own event),
    // never to the shell.
    term.attachCustomKeyEventHandler(event => {
      if (pasteKey(event)) return false;
      if (event.type === 'keydown') {
        if (event.key === 'Enter' || (tab.kind === 'herdr' && event.key === 'y')) expectCopy();
        else noteGesture();
      }
      if (adjustSelection(term, tab, event) || sendLineEdit(term, event)) return false;
      copySelection(term, event);
      return !event.metaKey;
    });
    const encoder = new TextEncoder();
    const open = () => tab.socket?.readyState === WebSocket.OPEN;
    if (!readOnly) {
      term.onData(data => { if (open()) tab.socket.send(encoder.encode(data)); });
      term.onBinary(data => {
        if (open()) tab.socket.send(Uint8Array.from(data, ch => ch.charCodeAt(0) & 0xff));
      });
    }
    term.onResize(({ cols, rows }) => {
      if (open()) tab.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
    tab.term = term;
  }

  function tabLabel(tab) {
    if (tab.kind === 'herdr') return 'herdr';
    return tab.index === 1 ? 'Shell' : `Shell ${tab.index}`;
  }

  const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"/></svg>';
  // herdr's agent states in the words and colours of Orc's own run states.
  const AGENT_STATUS = { working: 'agent working', blocked: 'agent blocked', done: 'agent done', idle: 'agent idle' };

  function herdrTabName(item) {
    const label = item.label && item.label !== String(item.number) ? `: ${item.label}` : '';
    const status = AGENT_STATUS[item.agentStatus];
    return `Tab ${item.number}${label}${status ? `, ${status}` : ''}`;
  }

  function tabButtons(key, onSelect, closeName, onClose) {
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'terminal-tab-select';
    select.setAttribute('data-key', `${key}:select`);
    select.addEventListener('click', onSelect);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'terminal-tab-close';
    close.setAttribute('data-key', `${key}:close`);
    close.setAttribute('aria-label', closeName);
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', onClose);
    return [select, close];
  }

  function shellItem(tab) {
    const item = document.createElement('div');
    item.className = 'terminal-tab' + (tab === active ? ' active' : '');
    const [select, close] = tabButtons(`shell:${tab.index}`,
      () => { activate(tab); tab.term?.focus(); }, `Close ${tabLabel(tab)}`, () => closeTab(tab));
    select.setAttribute('aria-pressed', String(tab === active));
    select.append(tabLabel(tab));
    item.append(select, close);
    return item;
  }

  function herdrItem(item) {
    const shown = item.focused && active?.kind === 'herdr';
    const row = document.createElement('div');
    row.className = 'terminal-tab' + (shown ? ' active' : '');
    row.dataset.herdrTab = item.id;
    const [select, close] = tabButtons(`herdr:${item.id}`, () => focusHerdrTab(item),
      `Close tab ${item.number}${item.label !== String(item.number) ? ` (${item.label})` : ''}`, () => closeHerdrTab(item));
    select.setAttribute('aria-pressed', String(shown));
    select.setAttribute('aria-label', herdrTabName(item));
    select.title = herdrTabName(item);
    if (AGENT_STATUS[item.agentStatus]) {
      const dot = document.createElement('span');
      dot.className = 'terminal-tab-dot';
      dot.dataset.status = item.agentStatus;
      select.append(dot);
    }
    const number = document.createElement('span');
    number.className = 'terminal-tab-number';
    number.textContent = String(item.number);
    select.append(number);
    if (item.label && item.label !== String(item.number)) select.append(item.label);
    row.append(select, close);
    return row;
  }

  function herdrTabButton(id) {
    return [...$('run-terminal-tabs').querySelectorAll('button')]
      .find(button => button.getAttribute('data-key') === `herdr:${id}:select`) || null;
  }

  // The herdr tab whose name is being typed, in a field over its button.
  // herdr pushes its tabs on every change, so the strip holds still until
  // the name is saved or dropped; a rebuild would take the field away.
  let renaming = null;

  function renamingHolds() {
    if (!renaming) return false;
    if (renaming.generation === generation && herdrMode() && herdrTabs.some(item => item.id === renaming.id)) return true;
    renaming = null;
    return false;
  }

  function renameHerdrTab(id) {
    if (renaming) endRename({ save: false });
    const item = herdrTabs.find(other => other.id === id);
    const select = herdrTabButton(id);
    if (!item || !select) return;
    const named = item.label && item.label !== String(item.number) ? item.label : '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'terminal-tab-rename';
    input.value = named;
    input.maxLength = 60;
    input.placeholder = `Tab ${item.number}`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Name for tab ${item.number}`);
    input.addEventListener('keydown', event => {
      // The field's keys are its own, not the strip's or the terminal's.
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); endRename({ save: true, refocus: true }); }
      else if (event.key === 'Escape') { event.preventDefault(); endRename({ save: false, refocus: true }); }
    });
    input.addEventListener('blur', () => endRename({ save: true }));
    renaming = { id, input, generation };
    const row = select.parentElement;
    row.classList.add('renaming');
    row.replaceChildren(input);
    input.focus();
    input.select?.();
  }

  // An empty name changes nothing: herdr takes a name of 1 to 60 characters.
  function endRename({ save, refocus = false }) {
    const current = renaming;
    if (!current) return;
    renaming = null;
    const label = current.input.value.trim();
    const item = herdrTabs.find(other => other.id === current.id);
    const changed = save && current.generation === generation && item && label && label !== item.label;
    // Shown at once; herdr's reply and push confirm it.
    if (changed) setHerdrTabs(herdrTabs.map(other => (other.id === item.id ? { ...other, label } : other)), herdrSessionTabs);
    else renderStrip();
    if (refocus) herdrTabButton(current.id)?.focus();
    if (changed) herdrAction({ action: 'rename', tabId: item.id, label });
  }

  // The strip's right-click menu, on herdr's tabs. The strip is rebuilt on
  // every push, so the menu keeps the tab's id and finds it again when chosen.
  const tabMenu = $('run-terminal-tab-menu');
  let tabMenuId = null;

  function openTabMenu(row, x, y) {
    const item = herdrTabs.find(other => other.id === row.dataset.herdrTab);
    if (!item) return;
    tabMenuId = item.id;
    const menuItem = (key, label) =>
      `<button type="button" role="menuitem" data-key="${key}" tabindex="-1"><span class="run-menu-label">${label}</span></button>`;
    tabMenu.innerHTML = menuItem('rename', 'Rename tab') + menuItem('close', 'Close tab');
    placeContextMenu(tabMenu, row, x, y);
  }

  function closeTabMenu({ refocus = false } = {}) {
    if (tabMenu.hidden) return;
    tabMenu.hidden = true;
    if (refocus) herdrTabButton(tabMenuId)?.focus();
    tabMenuId = null;
  }

  $('run-terminal-tabs').addEventListener('contextmenu', event => {
    const row = event.target.closest('.terminal-tab');
    if (!row) return;
    // WebKit's own Back and Reload have nothing to do with a tab.
    event.preventDefault();
    if (row.dataset.herdrTab && !renaming) openTabMenu(row, event.clientX, event.clientY);
  });
  $('run-terminal-tabs').addEventListener('scroll', () => closeTabMenu());
  // A double-click renames too. Its first click rebuilds the strip, which
  // keeps the browser from sending dblclick, so the second click's count does.
  $('run-terminal-tabs').addEventListener('click', event => {
    if (event.detail !== 2 || !event.target.closest('.terminal-tab-select')) return;
    const id = event.target.closest('.terminal-tab')?.dataset.herdrTab;
    if (id) renameHerdrTab(id);
  });
  tabMenu.addEventListener('click', event => {
    const key = event.target.closest('[data-key]')?.getAttribute('data-key');
    if (!key) return;
    const id = tabMenuId;
    closeTabMenu({ refocus: key === 'close' });
    if (key === 'rename') renameHerdrTab(id);
    else closeHerdrTab(herdrTabs.find(item => item.id === id));
  });
  bindContextMenu(tabMenu, closeTabMenu);

  // herdr pushes its tabs on every change, agent status included, so the
  // strip is rebuilt often: focus stays on the same tab's control, or moves
  // to the shown tab when that one has gone.
  function renderHerdrStrip(strip) {
    const focused = strip.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    strip.replaceChildren(...herdrTabs.map(herdrItem), ...tabs.filter(tab => tab.kind === 'shell').map(shellItem));
    $('run-terminal-new').hidden = false;
    $('run-terminal-new').setAttribute('label', 'New tab (⌘T)');
    if (!focused) return;
    const buttons = strip.querySelectorAll('button');
    const find = key => [...buttons].find(button => button.getAttribute('data-key') === key);
    const shownKey = active?.kind === 'herdr'
      ? `herdr:${herdrTabs.find(item => item.focused)?.id}:select` : `shell:${active?.index}:select`;
    (find(focused) || find(shownKey) || $('run-terminal-new')).focus();
  }

  function renderStrip() {
    if (renamingHolds()) return;
    const strip = $('run-terminal-tabs');
    if (herdrMode()) { renderHerdrStrip(strip); return; }
    strip.replaceChildren(...tabs.map(shellItem));
    strip.querySelector('.terminal-tab.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    $('run-terminal-new').setAttribute('label', 'New shell tab');
  }

  // herdr always draws its own tab row on the top line, and Orc draws that
  // strip itself, so herdr gets one more row than shows and the pane clips it.
  // The clip is xterm's cell height (private, as addon-fit reads it): the
  // screen's height lags the rows while xterm's renderer is paused, such as
  // after the terminal was hidden, and would clip several rows. Set on every
  // fit so a stale value heals and font or zoom changes reach it.
  function fitTab(tab) {
    if (!tab?.term) return;
    try {
      snapToPixels(tab.pane);
      if (tab.kind !== 'herdr') { tab.fit.fit(); return; }
      // The CSS height divides the device rows back out, slightly off the
      // device grid, so the shift rounds to whole device pixels as well.
      const ratio = window.devicePixelRatio || 1;
      const cell = tab.term._core?._renderService?.dimensions?.css?.cell?.height;
      if (cell) tab.pane.style.setProperty('--herdr-row', `${Math.round(cell * ratio) / ratio}px`);
      const size = tab.fit.proposeDimensions();
      if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return;
      if (tab.term.cols === size.cols && tab.term.rows === size.rows + 1) return;
      tab.term.resize(size.cols, size.rows + 1);
    } catch {}
  }

  // The canvas blurs when its corner falls between device pixels, which a
  // fractional bar height or a 125% display scale puts it, so the screen
  // shifts by under a pixel onto the grid. A Retina screen hides the blur.
  function snapToPixels(pane) {
    const ratio = window.devicePixelRatio || 1;
    const box = pane.getBoundingClientRect();
    const offset = position => (Math.round(position * ratio) - position * ratio) / ratio;
    pane.style.setProperty('--snap-x', `${offset(box.left)}px`);
    pane.style.setProperty('--snap-y', `${offset(box.top)}px`);
  }

  function scheduleFit() {
    if (!active?.term || !terminalOpen) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => fitTab(active));
  }

  function disconnect(tab) {
    if (!tab.socket) return;
    tab.closingOnPurpose = true;
    try { tab.socket.close(); } catch {}
    tab.socket = null;
  }

  function disposeTab(tab) {
    disconnect(tab);
    try { tab.term?.dispose(); } catch {}
    tab.pane?.remove();
  }

  function connect(tab) {
    disconnect(tab);
    tab.closingOnPurpose = false;
    tab.term.reset();
    tab.live = false;
    tab.cwd = '';
    setStatus(tab, 'Connecting…');
    fitTab(tab);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const which = tab.kind === 'herdr' ? 'herdr' : String(tab.index);
    // The daemon shows the scope's workspace as the client connects.
    tab.opened = scope.id;
    const url = `${scheme}://${location.host}`
      + scopeUrl(scope, '', `tab=${which}&cols=${tab.term.cols}&rows=${tab.term.rows}`);
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    tab.socket = ws;
    let failure = '';
    let ended = '';
    ws.onmessage = event => {
      if (typeof event.data !== 'string') { tab.term.write(new Uint8Array(event.data)); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready') {
        // A resize while the socket was still connecting never reached the
        // daemon, which sized the PTY from the URL; the stage opening right
        // after a connect is one.
        ws.send(JSON.stringify({ type: 'resize', cols: tab.term.cols, rows: tab.term.rows }));
        tab.cwd = message.cwd || '';
        tab.live = true;
        setStatus(tab, '');
        renderStrip();
      } else if (message.type === 'tabs') {
        if (Array.isArray(message.tabs)) setHerdrState(message);
      } else if (message.type === 'error') {
        failure = message.message || 'The terminal could not open.';
      } else if (message.type === 'exit') {
        ended = message.reason || 'ended';
      }
    };
    ws.onclose = () => {
      if (tab.socket !== ws) return;
      tab.socket = null;
      tab.live = false;
      renderStrip();
      if (tab.closingOnPurpose) return;
      const text = failure || (tab.kind === 'herdr'
        ? (ended ? 'herdr exited.' : 'Disconnected from herdr.')
        : (ended ? 'Shell exited.' : 'Disconnected from the shell.'));
      setStatus(tab, text, { reconnect: true });
      if (tab === active) announce(text);
    };
  }

  function activate(tab, { connectShell = true } = {}) {
    if (!tab) return;
    active = tab;
    if (!tab.term) createTerm(tab);
    for (const other of tabs) if (other.pane) other.pane.hidden = other !== tab;
    renderStrip();
    syncBar();
    fitTab(tab);
    if (!tab.socket && !tab.status && connectShell) connect(tab);
  }

  // herdr leads once the scope has a workspace in it; until then a shell
  // that is already running does.
  function openingTab() {
    const open = herdrWorkspaces.some(item => item.scope === scope?.key);
    return tabs.find(tab => tab.kind === 'herdr' && open)
      || tabs.find(tab => tab.kind === 'shell') || tabs[0];
  }

  // `keep` is the herdr client, which every scope shares and so stays connected.
  function resetTabs({ keep = null } = {}) {
    for (const tab of tabs) if (tab !== keep) disposeTab(tab);
    tabs = [];
    herdrTabs = [];
    herdrSessionTabs = 0;
    herdrWorkspaces = [];
    generation += 1;
    active = null;
    scope = null;
    syncBar();
    renderTree();
  }

  function orderTabs() {
    tabs.sort((a, b) => (a.kind === 'herdr' ? 0 : a.index) - (b.kind === 'herdr' ? 0 : b.index));
  }

  async function liveState(target) {
    try {
      const res = await fetch(scopeUrl(target, '/tabs'));
      if (res.ok) {
        const { shells, herdr, scope: key } = await res.json();
        return { shells: Array.isArray(shells) ? shells : [], herdr: herdr || null, scope: key || null };
      }
    } catch {}
    return { shells: [], herdr: null, scope: null };
  }

  // herdr's session outlives any one scope, so it counts only once the scope
  // has a workspace in it.
  function hasLiveTabs(state) {
    return state.shells.length > 0
      || Boolean(state.herdr?.running && state.herdr.workspaces?.some(item => item.scope === state.scope));
  }

  async function buildTabs(target, state = null) {
    const client = herdrEntry()?.socket ? herdrEntry() : null;
    resetTabs({ keep: client });
    // The client's cwd was the scope it connected for.
    if (client) client.cwd = '';
    scope = target;
    const listed = state || await liveState(target);
    if (scope !== target) { if (client && !tabs.includes(client)) disposeTab(client); return; }
    scope.key = listed.scope;
    const shells = listed.shells.map(index => ({ kind: 'shell', index }));
    if (listed.herdr) {
      tabs = [client || { kind: 'herdr' }, ...shells];
      setHerdrState(listed.herdr);
      // Another scope's tabs, until herdr shows this one's workspace.
      if (shownWorkspace()?.scope !== scope.key) setHerdrTabs([], listed.herdr.sessionTabs);
      showPageWorkspace();
      return;
    }
    if (client) disposeTab(client);
    tabs = shells.length ? shells : [{ kind: 'shell', index: 1 }];
  }

  function setHerdrTabs(list, sessionTabs) {
    herdrTabs = list;
    herdrSessionTabs = sessionTabs ?? list.length;
    renderStrip();
  }

  function setHerdrState(state) {
    if (Array.isArray(state.workspaces)) herdrWorkspaces = state.workspaces;
    setHerdrTabs(Array.isArray(state.tabs) ? state.tabs : [], state.sessionTabs);
    renderTree();
    syncBar();
  }

  // `target` is the scope whose workspace the action opens; the tab actions
  // reach whichever workspace herdr shows.
  async function herdrAction(body, target = scope) {
    const built = generation;
    let res = null;
    try {
      res = await fetch(target.kind === 'run' ? `/runs/${encodeURIComponent(target.runId)}/terminal-tab` : '/terminal-tab', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target.kind === 'run' ? body : { ...body, project: target.path }),
      });
    } catch {}
    const data = res ? await res.json().catch(() => ({})) : {};
    if (built !== generation) return null;
    if (!res?.ok) {
      announce(data.error || 'herdr did not answer.');
      return null;
    }
    if (Array.isArray(data.tabs)) setHerdrState(data);
    return data;
  }

  // Docked, or freshly opened, the terminal shows the page's own workspace;
  // the sidebar may have left herdr on another.
  async function showPageWorkspace() {
    const client = herdrEntry();
    const target = scope;
    if (!client?.socket || !target?.key) return;
    if (client.opened === target.id && shownWorkspace()?.scope === target.key) return;
    const data = await herdrAction({ action: 'open' });
    if (!data || scope !== target) return;
    client.opened = target.id;
    client.cwd = data.cwd || '';
    syncBar();
  }

  // Shown focused at once; herdr's own reply and push confirm it.
  function focusHerdrTab(item) {
    if (!item) return;
    const entry = herdrEntry();
    setHerdrTabs(herdrTabs.map(other => ({ ...other, focused: other.id === item.id })), herdrSessionTabs);
    if (entry && (active !== entry || !entry.socket)) activate(entry);
    herdrAction({ action: 'focus', tabId: item.id });
    active?.term?.focus();
  }

  async function newHerdrTab() {
    const entry = herdrEntry();
    const built = generation;
    // A scope with no workspace yet gets one as the client connects, first tab included.
    if (!entry.socket && !herdrTabs.length) { activate(entry); entry.term?.focus(); return; }
    if (active !== entry || !entry.socket) activate(entry);
    await herdrAction({ action: 'create' });
    if (built === generation) active?.term?.focus();
  }

  // No tabs left to show: no shells, and herdr's session not running.
  function nothingLeft() {
    return tabs.every(tab => tab.kind === 'herdr' && !tab.socket && !herdrTabs.length);
  }

  async function closeHerdrTab(item) {
    if (!item) return;
    const last = herdrSessionTabs <= 1;
    const name = herdrTabName(item).split(',')[0];
    const why = last ? 'It is the herdr session\'s last tab, so the session ends and anything'
      : herdrTabs.length <= 1 ? 'It is this workspace\'s last tab, so the workspace closes and anything' : 'Anything';
    if (!confirm(`Close ${name}? ${why} still running in it stops.`)) return;
    return afterHerdrClose(herdrAction({ action: 'close', tabId: item.id }));
  }

  // A tab or a workspace closed: `reply` says whether the workspace or the
  // whole session went with it.
  async function afterHerdrClose(reply) {
    const built = generation;
    const data = await reply;
    if (built !== generation) return;
    // herdr moves on to another workspace, which a docked terminal has no place for.
    if (data?.workspaceClosed && !staged) {
      hide();
      announce('Terminal closed.');
      return;
    }
    if (data?.stopped) {
      herdrTabs = [];
      herdrSessionTabs = 0;
      // The PTY may already have reported its exit, leaving a status that
      // would stop the next + from connecting; a fresh entry starts a new session.
      const stopped = herdrEntry();
      disposeTab(stopped);
      tabs[tabs.indexOf(stopped)] = { kind: 'herdr' };
      if (nothingLeft()) {
        resetTabs();
        hide();
        announce('Terminal closed.');
        return;
      }
      activate(tabs.find(tab => tab.kind === 'shell'));
    }
    active?.term?.focus();
  }

  async function closeTab(tab) {
    if (tab.kind === 'herdr') return closeHerdrTab(herdrTabs.find(item => item.focused) || herdrTabs[0]);
    if (tab.kind === 'shell' && (tab.socket || tab.live)) {
      if (!confirm(`End ${tabLabel(tab)}? Anything still running in it stops.`)) return;
    }
    const owner = scope;
    const at = tabs.indexOf(tab);
    disposeTab(tab);
    tabs.splice(at, 1);
    if (tab.kind === 'shell') {
      let res = null;
      try {
        res = await fetch(owner.kind === 'run'
          ? `/runs/${encodeURIComponent(owner.runId)}/terminal?tab=${tab.index}`
          : `/terminal?project=${encodeURIComponent(owner.path)}&tab=${tab.index}`, { method: 'DELETE' });
      } catch {}
      if (!res || !res.ok) announce(`Could not end ${tabLabel(tab)}.`);
    }
    if (nothingLeft()) {
      // Nothing left: hide, and let the next open start from the defaults.
      resetTabs();
      hide();
      announce('Terminal closed.');
      return;
    }
    if (active === tab) activate(tabs[Math.min(at, tabs.length - 1)]);
    else renderStrip();
    active?.term?.focus();
  }

  function newShell() {
    if (!scope) return;
    if (herdrMode()) { newHerdrTab(); return; }
    const used = new Set(tabs.filter(t => t.kind === 'shell').map(t => t.index));
    let index = 1;
    while (used.has(index)) index += 1;
    const tab = { kind: 'shell', index };
    tabs.push(tab);
    orderTabs();
    activate(tab);
    tab.term.focus();
  }

  // `live` is a run's liveState; showing its running tabs attaches at once.
  async function show({ focus = true, live = null } = {}) {
    const target = currentScope();
    if (!target) return false;
    const openedFrom = document.activeElement;
    if (!terminalOpen) returnFocus = openedFrom;
    openingScope = target;
    terminalOpen = true;
    rememberOpen(target.runId, true);
    $('run-terminal').hidden = false;
    document.body.classList.add('terminal-open');
    syncToggle();
    if (!staged) {
      setHeight(storedHeight(), false);
      observeDock();
    }
    try {
      try {
        await loadRenderer();
      } catch {
        const status = $('run-terminal-status');
        status.textContent = status.title = 'The terminal renderer could not load.';
        return true;
      }
      if (!terminalOpen || currentScope()?.id !== target.id) return true;
      if (scope?.id !== target.id || !tabs.length) {
        if (!building || building.id !== target.id) {
          const promise = buildTabs(target, live);
          building = { id: target.id, promise };
          try { await promise; } finally { if (building?.promise === promise) building = null; }
        } else {
          await building.promise;
        }
        if (!terminalOpen || scope?.id !== target.id) return true;
        activate(openingTab(), { connectShell: focus || Boolean(live) });
      } else {
        activate(active, { connectShell: focus || Boolean(live) });
        showPageWorkspace();
      }
      // The first open waits on the renderer and its font, which can take a
      // while from another computer; focus moved meanwhile stays where it went.
      const moved = document.activeElement !== openedFrom && !document.activeElement?.closest?.('.terminal-pane');
      if (focus && !moved) active?.term?.focus();
      return true;
    } finally {
      if (openingScope === target) openingScope = null;
    }
  }

  async function openPreferred(onShown) {
    if (!terminalOpen && opensMaximised()) {
      await maximise({ onShown, remember: !overQuestions() });
      return;
    }
    const target = currentScope();
    if (await show() && terminalOpen && scope?.id === target?.id) onShown?.();
  }

  async function openTerminalTab({ runId, index, herdrTab, warning } = {}) {
    if (runId !== currentRunId()) return;
    if (stageMotion) await stageMotion;
    if (typeof herdrTab === 'string' && herdrTab) {
      await openPreferred(() => {
        if (herdrMode()) focusHerdrTab(herdrTabs.find(item => item.id === herdrTab) || { id: herdrTab });
        // Retrying an unconfirmed command could run it twice, so the warning
        // stays on screen until dismissed as well as being spoken.
        if (typeof warning === 'string' && warning) {
          toast(warning, { tone: 'error', duration: Infinity });
          announce(warning);
        }
      });
      return;
    }
    if (!Number.isSafeInteger(index) || index < 1) return;
    await openPreferred(() => {
      let tab = tabs.find(item => item.kind === 'shell' && item.index === index);
      if (!tab) {
        tab = { kind: 'shell', index };
        tabs.push(tab);
        orderTabs();
      }
      activate(tab);
      tab.term?.focus();
    });
  }
  document.addEventListener('orc-open-terminal-tab', event => openTerminalTab(event.detail));
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'orc-open-terminal-tab') openTerminalTab(event.data);
  });

  function hide({ remember = true } = {}) {
    if (!terminalOpen) return;
    if (staged) leaveStage({ dock: false });
    const closingScope = scope || openingScope;
    openingScope = null;
    terminalOpen = false;
    dockObserver.disconnect();
    if (remember) rememberOpen(closingScope?.runId || currentRunId(), false);
    const hadFocus = $('run-terminal').contains(document.activeElement);
    $('run-terminal').hidden = true;
    document.body.classList.remove('terminal-open');
    syncToggle();
    // Hiding it by hand hands the keyboard to the run's chat, when it has one.
    // A route change hides it without remembering, and leaves focus alone.
    if (remember && chatComposerReady()) focusChatComposer();
    else if (hadFocus) {
      const target = returnFocus?.isConnected ? returnFocus : $('links').querySelector('.terminal-chip');
      target?.focus();
    }
    returnFocus = null;
  }

  function syncToggle() {
    const chip = $('links').querySelector('.terminal-chip');
    if (chip) chip.setAttribute('aria-expanded', String(terminalOpen));
    const maximise = $('run-terminal-maximise');
    maximise.setAttribute('label', staged ? 'Restore terminal' : 'Maximise terminal');
    maximise.innerHTML = staged ? RESTORE_ICON : MAXIMISE_ICON;
    // A project's root has no run page to dock under.
    maximise.hidden = Boolean(staged) && (scope || openingScope)?.kind === 'project';
  }

  const MAXIMISE_ICON = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M214,48V96a6,6,0,0,1-12,0V62.48l-45.76,45.76a6,6,0,0,1-8.48-8.48L193.52,54H160a6,6,0,0,1,0-12h48A6,6,0,0,1,214,48ZM99.76,147.76,54,193.52V160a6,6,0,0,0-12,0v48a6,6,0,0,0,6,6H96a6,6,0,0,0,0-12H62.48l45.76-45.76a6,6,0,0,0-8.48-8.48Z"/></svg>';
  const RESTORE_ICON = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M150,104V72a6,6,0,0,1,12,0V89.52l45.76-45.76a6,6,0,0,1,8.48,8.48L170.48,98H188a6,6,0,0,1,0,12H156A6,6,0,0,1,150,104ZM100,146H68a6,6,0,0,0,0,12H85.52L39.76,203.76a6,6,0,1,0,8.48,8.48L94,166.48V184a6,6,0,0,0,12,0V152A6,6,0,0,0,100,146Z"/></svg>';

  function scopeTitle() {
    if (scope?.kind === 'project') return scope.path.replace(/\/+$/, '').split('/').pop() || scope.path;
    const run = runs.find(item => item.id === scope?.runId);
    return run?.meta?.title || scope?.runId || '';
  }

  function treeRows() {
    return terminalTreeRows(terminalTree(herdrWorkspaces, runs, scope?.key));
  }

  // The stage names what the terminal shows, which the sidebar can change.
  function syncTitle() {
    const shown = herdrMode() ? treeRows().find(({ node }) => node.workspace?.focused)?.node : null;
    $('run-terminal-title').textContent = staged ? shown?.label || scopeTitle() : '';
  }

  function selectNode(node, event) {
    if (node.kind === 'run') herdrAction({ action: 'open' }, { kind: 'run', runId: node.runId });
    else if (node.kind === 'project') herdrAction({ action: 'open' }, { kind: 'project', path: node.path });
    else herdrAction({ action: 'focus-workspace', workspaceId: node.workspace.id });
    // A click goes on to type; a keyboard user is still choosing in the list.
    if (event.detail > 0) active?.term?.focus();
  }

  function treeRow(node, depth) {
    if (node.kind === 'group') {
      const heading = document.createElement('span');
      heading.className = 'terminal-tree-group';
      heading.textContent = node.label;
      return heading;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `terminal-tree-row terminal-tree-${node.kind}${node.workspace ? '' : ' closed'}`;
    row.style.setProperty('--depth', String(depth));
    row.setAttribute('data-key', node.key);
    const status = AGENT_STATUS[node.workspace?.agentStatus];
    const name = `${node.label}${status ? `, ${status}` : ''}${node.workspace ? '' : ', no terminal open'}`;
    row.setAttribute('aria-label', name);
    row.title = name;
    if (node.workspace?.focused) row.setAttribute('aria-current', 'true');
    if (status) {
      const dot = document.createElement('span');
      dot.className = 'terminal-tab-dot';
      dot.dataset.status = node.workspace.agentStatus;
      row.append(dot);
    }
    const label = document.createElement('span');
    label.className = 'terminal-tree-label';
    label.textContent = node.label;
    row.append(label);
    if (node.workspace?.tabCount > 1) {
      const count = document.createElement('span');
      count.className = 'terminal-tree-count';
      count.textContent = String(node.workspace.tabCount);
      row.append(count);
    }
    row.addEventListener('click', event => selectNode(node, event));
    return row;
  }

  // The sidebar's right-click menu. The tree is rebuilt on every push, so the
  // menu keeps the row's key and finds its node again when chosen.
  const treeMenu = $('run-terminal-tree-menu');
  let treeMenuKey = null;

  function treeNode(key) {
    return treeRows().find(({ node }) => node.key === key)?.node || null;
  }

  function openTreeMenu(row, x, y) {
    const node = treeNode(row.getAttribute('data-key'));
    if (!node) return;
    treeMenuKey = node.key;
    const tabCount = node.workspace?.tabCount || 0;
    const sub = !node.workspace ? 'No terminal open' : `${tabCount} tab${tabCount === 1 ? '' : 's'}`;
    treeMenu.innerHTML = `<button type="button" role="menuitem" data-key="close-workspace" tabindex="-1"${
      node.workspace ? '' : ' aria-disabled="true"'}><span class="run-menu-label">Close terminal</span><span class="run-menu-sub">${sub}</span></button>`;
    placeContextMenu(treeMenu, row, x, y);
  }

  function closeTreeMenu({ refocus = false } = {}) {
    if (treeMenu.hidden) return;
    treeMenu.hidden = true;
    if (refocus) [...$('run-terminal-tree').querySelectorAll('button')]
      .find(row => row.getAttribute('data-key') === treeMenuKey)?.focus();
    treeMenuKey = null;
  }

  // Closes the workspace and every tab in it; the last workspace with tabs
  // takes herdr's session with it, as its last tab does.
  function closeWorkspace(node) {
    const workspace = node?.workspace;
    if (!workspace) return;
    const last = herdrWorkspaces.every(item => item.id === workspace.id || !item.tabCount);
    const why = last ? 'It is the herdr session\'s last workspace, so the session ends and anything' : 'Anything';
    if (!confirm(`Close the terminal for ${node.label}? ${why} still running in it stops.`)) return;
    return afterHerdrClose(herdrAction({ action: 'close-workspace', workspaceId: workspace.id }));
  }

  $('run-terminal-tree').addEventListener('contextmenu', event => {
    const row = event.target.closest('.terminal-tree-row');
    if (!row) return;
    event.preventDefault();
    openTreeMenu(row, event.clientX, event.clientY);
  });
  $('run-terminal-tree').addEventListener('scroll', () => closeTreeMenu());
  treeMenu.addEventListener('click', event => {
    const item = event.target.closest('[data-key]');
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    const node = treeNode(treeMenuKey);
    closeTreeMenu({ refocus: true });
    closeWorkspace(node);
  });
  bindContextMenu(treeMenu, closeTreeMenu);

  function treeList(nodes, depth) {
    const list = document.createElement('ul');
    for (const node of nodes) {
      const item = document.createElement('li');
      item.style.setProperty('--depth', String(depth));
      item.append(treeRow(node, depth));
      if (node.children.length) item.append(treeList(node.children, depth + 1));
      list.append(item);
    }
    return list;
  }

  // The sidebar belongs to the maximised stage with herdr: project roots,
  // their runs and those runs' children. It is rebuilt on every push, so
  // focus stays on the same row.
  function renderTree() {
    const tree = $('run-terminal-tree');
    const shown = Boolean(staged) && herdrMode();
    tree.hidden = !shown;
    syncTitle();
    if (!shown) { tree.replaceChildren(); return; }
    const focused = tree.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    tree.replaceChildren(treeList(terminalTree(herdrWorkspaces, runs, scope?.key), 0));
    if (focused) [...tree.querySelectorAll('button')].find(row => row.getAttribute('data-key') === focused)?.focus();
  }

  // A modal stage: everything outside it leaves the tab order and the
  // accessibility tree until it closes.
  function setStageInert(on) {
    const covered = [];
    for (let node = $('run-terminal'); on && node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children || []) {
        if (sibling !== node && sibling.id !== 'toast-region' && sibling.id !== 'announcer') covered.push(sibling);
      }
    }
    holdInert('terminal-stage', covered);
  }

  function applyStage(on) {
    const panel = $('run-terminal');
    panel.classList.toggle('terminal-staged', on);
    document.body.classList.toggle('terminal-stage-open', on);
    $('run-terminal-scrim').hidden = !on;
    $('run-terminal-title').hidden = !on;
    if (on) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'run-terminal-title');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      panel.removeAttribute('aria-labelledby');
    }
    setStageInert(on);
    syncToggle();
    renderTree();
    scheduleFit();
  }

  // Answer mode covers the run page, so a terminal there can only be seen
  // maximised over it.
  function overQuestions() {
    return document.body.classList.contains('answer-mode-open');
  }

  // A project's root has no run page to dock under, and Answer mode covers it.
  function opensMaximised() {
    return storedMaximised() || currentScope()?.kind === 'project' || overQuestions();
  }

  // The stage takes over the screen, so going on or off it plays the screen
  // change every page shares, started from the header chip. `swap` runs once
  // the screen being left has been pictured, or at once when nothing can play.
  function changeStage(swap) {
    if (document.documentElement.dataset.funMode === 'basics' || !canChangeScreen()) { swap(); return Promise.resolve(); }
    const chip = $('links').querySelector('.terminal-chip')?.getBoundingClientRect();
    return changeScreen('terminal', swap, chip?.width ? { x: chip.left + chip.width / 2, y: chip.top + chip.height / 2 } : undefined);
  }

  // `remember: false` maximises without changing the size ⌘J reopens at.
  async function maximise({ onShown, remember = true } = {}) {
    if (staged || stageMotion) return;
    const target = currentScope();
    if (!target) { announce(NO_SCOPE); return; }
    const wasOpen = terminalOpen;
    const panel = $('run-terminal');
    const returnTo = document.activeElement;
    staged = { returnFocus: returnTo };
    if (!wasOpen) {
      // Stage before un-hiding so awaiting renderer or /tabs never reserves
      // docked flex height or fits xterm to the docked box. It stays out of
      // sight until the swap, so the screen being left is pictured without it.
      panel.classList.add('terminal-staged', 'terminal-stage-pending');
      $('run-terminal-title').hidden = false;
    }
    let shown = false;
    try { shown = await show(); } catch (error) { panel.classList.remove('terminal-stage-pending'); throw error; }
    if (!shown || !terminalOpen || !staged || currentScope()?.id !== target.id) {
      panel.classList.remove('terminal-stage-pending');
      if (staged) leaveStage({ dock: false });
      return;
    }
    // Only a run can dock, so only a run's choice is one to remember.
    if (target.kind === 'run' && remember) rememberMaximised(true);
    stageMotion = changeStage(() => {
      panel.classList.remove('terminal-stage-pending');
      if (!staged) return;
      // The swap runs a frame later, and the run may have changed by then.
      if (!terminalOpen || currentScope()?.id !== target.id) { leaveStage({ dock: false }); return; }
      applyStage(true);
      fitTab(active);
      onShown?.();
      active?.term?.focus();
    });
    try { await stageMotion; } finally { stageMotion = null; }
    if (staged) announce('Terminal maximised.');
  }

  // Restore docks the terminal and saves that choice; closing hides it and
  // keeps the maximised choice for the next open.
  async function restore({ close = false } = {}) {
    if (!staged || stageMotion) return;
    const { returnFocus: returnTo } = staged;
    if (!close) rememberMaximised(false);
    stageMotion = changeStage(() => {
      if (!staged) return;
      leaveStage({ dock: !close });
      if (close) hide();
      else { announce('Terminal restored.'); showPageWorkspace(); }
      if (close && document.activeElement === $('chat-prompt')) return;
      if (returnTo?.isConnected && !returnTo.closest?.('#run-terminal')) returnTo.focus();
      else if (!close) active?.term?.focus();
    });
    try { await stageMotion; } finally { stageMotion = null; }
  }

  function leaveStage({ dock = true } = {}) {
    staged = null;
    closeTreeMenu();
    $('run-terminal').classList.remove('terminal-stage-pending');
    applyStage(false);
    if (dock && terminalOpen) {
      fitDock();
      observeDock();
    }
  }

  function toggleStage() {
    if (stageMotion || $('run-terminal').classList.contains('terminal-stage-pending')) return;
    if (staged) restore({ close: scope?.kind === 'project' });
    else maximise();
  }

  // Only a docked terminal maximises, and only a run's terminal outside
  // Answer mode can dock: those are the states that show each button.
  const stageKeys = {
    BracketRight: () => { if (!staged) toggleStage(); },
    BracketLeft: () => { if (staged && scope?.kind !== 'project' && !overQuestions()) toggleStage(); },
  };

  // ⌘J, Orc.app's menu item and the header chip: close an open terminal, or
  // open a closed one at the size the user last chose. Outside a run it is
  // the project's root, which has no run page to dock under and so opens
  // maximised.
  terminalToggle = () => {
    if (stageMotion) return;
    if (terminalOpen) {
      if (staged && !$('run-terminal').classList.contains('terminal-stage-pending')) restore({ close: true });
      else if (!staged && overQuestions()) maximise({ remember: false });
      else hide();
      return;
    }
    if (opensMaximised()) { maximise({ remember: !overQuestions() }); return; }
    show().then(shown => { if (!shown) announce(NO_SCOPE); });
  };
  // Stable entry point for Orc.app's ⌘J menu item, same as ⌘K's palette opener.
  window.orcToggleTerminal = toggleTerminal;
  // An Orc.app built while ⌘J switched projects outside a run calls this name.
  window.orcProjectOrTerminalShortcut = toggleTerminal;

  window.orcCloseTerminalTab = () => {
    if (!terminalOpen || !active || !$('run-terminal').contains(document.activeElement)) return false;
    closeTab(active);
    return true;
  };

  // A run's terminal reopens only onto a shell that is still running. A run
  // whose shells have ended stays closed rather than show an empty pane.
  async function followRoute() {
    const target = currentScope();
    const runId = target?.runId || null;
    const currentId = (openingScope || scope)?.id;
    if (staged && currentId !== target?.id) leaveStage();
    if (!runId || !openRuns().includes(runId)) { if (terminalOpen) hide({ remember: false }); return; }
    if (terminalOpen && currentId === target.id) return;
    const live = await liveState(target);
    if (currentRunId() !== runId) return;
    if (terminalOpen && (openingScope || scope)?.id === target.id) return;
    if (!hasLiveTabs(live)) { if (terminalOpen) hide({ remember: false }); return; }
    show({ focus: false, live });
  }
  window.addEventListener('hashchange', followRoute);
  // The first route runs before /api/runs answers; wait for the run list.
  let routedOnce = false;
  const firstRoute = setInterval(() => {
    if (!runs.length || routedOnce) return;
    routedOnce = true;
    clearInterval(firstRoute);
    followRoute();
  }, 250);

  // Capture before xterm can send a shortcut to the shell.
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    const toggle = shortcutMatches('terminal', event);
    if (!toggle && (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)) return;
    const key = event.key.toLowerCase();
    const inTerminal = terminalOpen && $('run-terminal').contains(document.activeElement);
    const addShell = !toggle && key === 't' && inTerminal;
    const closeTerminal = !toggle && key === 'w' && event.metaKey && inTerminal && active;
    // ⌘1…⌘9 pick herdr's tabs, as its own prefix+1…9 does.
    const pickTab = !toggle && /^[1-9]$/.test(key) && event.metaKey && inTerminal && herdrMode();
    // ⌘] maximises and ⌘[ docks, as the Maximise and Restore buttons do.
    // Outside the terminal they stay the composer's effort keys.
    const stageKey = !toggle && event.metaKey && inTerminal && stageKeys[event.code];
    if (!toggle && !addShell && !closeTerminal && !pickTab && !stageKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (closeTerminal) window.orcCloseTerminalTab();
    else if (addShell) newShell();
    else if (pickTab) focusHerdrTab(herdrTabs[Number(key) - 1]);
    else if (stageKey) stageKey();
    else toggleTerminal();
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest?.('#links .terminal-chip')) toggleTerminal();
  });

  $('run-terminal-hide').addEventListener('click', () => { if (staged) restore({ close: true }); else hide(); });
  $('run-terminal-maximise').addEventListener('click', toggleStage);
  $('run-terminal-new').addEventListener('click', newShell);
  // A phone has no ⌘V, and no Paste menu over the terminal's canvas.
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const showPaste = () => { $('run-terminal-paste').hidden = !coarsePointer.matches; };
  showPaste();
  coarsePointer.addEventListener('change', showPaste);
  $('run-terminal-paste').addEventListener('click', async () => {
    const tab = active;
    if (!tab?.term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) tab.term.paste(text);
    } catch {
      announce('Could not read the clipboard.');
    }
    tab.term.focus();
  });
  $('run-terminal-reconnect').addEventListener('click', () => {
    if (!active?.term) return;
    connect(active);
    active.term.focus();
  });

  // Drag the top edge, or focus it and use the arrow keys, to resize.
  const handle = $('run-terminal-resize');
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = $('run-terminal').getBoundingClientRect().height;
    const move = e => setHeight(startHeight + (startY - e.clientY));
    const up = () => {
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
    const current = $('run-terminal').getBoundingClientRect().height;
    if (event.key === 'ArrowUp') setHeight(current + step);
    else if (event.key === 'ArrowDown') setHeight(current - step);
    else return;
    event.preventDefault();
  });

  // Orc.app types a folder dropped on a terminal into it, as a paste so a
  // shell or agent there takes it as text rather than keystrokes.
  window.orcTerminalPaste = (element, text) => {
    const tab = element && tabs.find(item => item.term && item.pane?.contains(element));
    if (!tab) return false;
    tab.term.paste(text);
    tab.term.focus();
    return true;
  };

  // Theme switches (Settings or the OS) repaint the terminal in the new palette.
  const retheme = () => {
    const theme = terminalTheme();
    for (const tab of tabs) if (tab.term) tab.term.options.theme = theme;
  };
  // herdr's `terminal` theme paints with this palette, so it follows too.
  new MutationObserver(retheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-fun-mode'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  window.addEventListener('resize', fitDock);
  new MutationObserver(() => {
    if (terminalOpen) observeDock();
  }).observe($('content'), { childList: true });
  new ResizeObserver(scheduleFit).observe($('run-terminal-screen'));
})();
