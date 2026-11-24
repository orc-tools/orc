// Embedded sandboxed xterm.js terminal for QA command steps.
// Shares Orc's bundled xterm renderer (/vendor/orc-term.min.js) and keeps one
// persistent terminal/WebSocket per step across QA payload polls.

const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
const LINE_EDITING = {
  alt: { ArrowLeft: '\x1bb', ArrowRight: '\x1bf' },
  meta: { ArrowLeft: '\x01', ArrowRight: '\x05', Backspace: '\x15' },
};

let lib = null;
let loading = null;
let stylesReady = null;
const entries = new Map();
const activeEntries = new Set();

function ensureStyles() {
  if (document.getElementById('orc-term-styles')) return stylesReady || Promise.resolve();
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
    try { await Promise.all([`13px ${FONT}`, `bold 13px ${FONT}`].map(f => document.fonts.load(f))); } catch {}
    lib = module;
    return lib;
  })();
  try { return await loading; } finally { loading = null; }
}

function parseColor(raw, fallback = '#1f2422') {
  const value = String(raw || '').trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  }
  const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  return parseColor(fallback, '#000000');
}

function toHex(rgb) {
  return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function mixColors(a, b, weight) {
  const [x, y] = [parseColor(a), parseColor(b)];
  return toHex(x.map((v, i) => v * weight + y[i] * (1 - weight)));
}

function terminalTheme() {
  const style = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const heading = tok('--heading', '#e0e5e2');
  const code = tok('--code', '#1f2422');
  const text = tok('--text', '#c7cfca');
  const muted = tok('--muted', '#707a73');
  const accent = tok('--accent', '#78a9c2');
  const theme = {
    background: toHex(parseColor(code)),
    foreground: toHex(parseColor(text)),
    cursor: toHex(parseColor(heading)),
    cursorAccent: toHex(parseColor(code)),
    selectionBackground: mixColors(accent, code, 0.35),
    black: toHex(parseColor(code)),
    white: toHex(parseColor(muted)),
    brightBlack: toHex(parseColor(muted)),
    brightWhite: toHex(parseColor(heading)),
  };
  const named = {
    red: tok('--red', '#e87878'),
    green: tok('--green', '#9dc76b'),
    yellow: tok('--yellow', '#d5b05c'),
    blue: accent,
    magenta: tok('--purple', '#b497d6'),
    cyan: tok('--cyan', '#77b8b1'),
  };
  for (const [key, color] of Object.entries(named)) {
    theme[key] = toHex(parseColor(color));
    theme[`bright${key[0].toUpperCase()}${key.slice(1)}`] = mixColors(color, heading, 0.8);
  }
  return theme;
}

const themeObserver = new MutationObserver(() => {
  const theme = terminalTheme();
  for (const entry of activeEntries) {
    if (entry.term) entry.term.options.theme = theme;
  }
});
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme', 'data-fun-mode', 'style', 'class'],
});

function setStatus(entry, dot, text, { showReconnect = false, error = '' } = {}) {
  entry.dot.className = `qa-dot ${dot}`;
  entry.statusLabel.textContent = text;
  entry.reconnectBtn.hidden = !showReconnect;
  entry.errorEl.textContent = error;
  entry.errorEl.hidden = !error;
}

function sendResize(entry) {
  if (entry.socket?.readyState !== WebSocket.OPEN || !entry.term) return;
  entry.socket.send(JSON.stringify({
    type: 'resize',
    cols: entry.term.cols,
    rows: entry.term.rows,
  }));
}

function fitEntry(entry) {
  if (!entry.fitAddon || !entry.host.isConnected || entry.host.offsetParent === null) return;
  try {
    entry.fitAddon.fit();
    sendResize(entry);
  } catch {}
}

function connectSocket(entry) {
  const sandbox = entry.sandbox;
  if (entry.disposed || !sandbox?.available || !sandbox.terminalPath || sandbox.preview) return;
  if (entry.socket && (entry.socket.readyState === WebSocket.CONNECTING || entry.socket.readyState === WebSocket.OPEN)) {
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const cols = entry.term?.cols || 80;
  const rows = entry.term?.rows || 14;
  const sep = sandbox.terminalPath.includes('?') ? '&' : '?';
  const url = `${proto}://${location.host}${sandbox.terminalPath}${sep}cols=${cols}&rows=${rows}`;
  setStatus(entry, 'orange', 'Connecting…');
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    setStatus(entry, 'red', 'Disconnected', { showReconnect: true });
    return;
  }
  ws.binaryType = 'arraybuffer';
  entry.socket = ws;

  ws.onmessage = event => {
    if (entry.socket !== ws || entry.disposed) return;
    if (event.data instanceof ArrayBuffer) {
      entry.term?.write(new Uint8Array(event.data));
      return;
    }
    let msg = null;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (entry.term) entry.term.options.disableStdin = false;
      setStatus(entry, 'green', 'Ready');
      fitEntry(entry);
    } else if (msg.type === 'error') {
      if (entry.term) entry.term.options.disableStdin = true;
      setStatus(entry, 'red', 'Unavailable', {
        error: msg.message || 'Sandbox terminal failed to start.',
        showReconnect: entry.standalone,
      });
    } else if (msg.type === 'exit') {
      if (entry.term) entry.term.options.disableStdin = true;
      setStatus(entry, 'muted', 'Exited', { showReconnect: true });
    }
  };

  ws.onerror = () => {
    if (entry.socket !== ws || entry.disposed) return;
    if (entry.statusLabel.textContent !== 'Unavailable') {
      setStatus(entry, 'red', 'Disconnected', { showReconnect: true });
    }
  };

  ws.onclose = () => {
    if (entry.socket !== ws || entry.disposed) return;
    entry.socket = null;
    if (entry.term) entry.term.options.disableStdin = true;
    if (entry.statusLabel.textContent !== 'Unavailable' && entry.statusLabel.textContent !== 'Exited') {
      setStatus(entry, 'muted', 'Disconnected', { showReconnect: true });
    }
  };
}

async function initRenderer(entry) {
  if (entry.initPromise) return entry.initPromise;
  entry.initPromise = (async () => {
    const xterm = await loadRenderer();
    if (entry.disposed) return;
    const isPreview = Boolean(entry.sandbox?.preview);
    const term = new xterm.Terminal({
      allowProposedApi: true,
      cursorBlink: !isPreview,
      disableStdin: true,
      fontFamily: FONT,
      fontSize: 12.5,
      lineHeight: 1.25,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    entry.term = term;
    const fit = new xterm.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new xterm.WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank', 'noopener');
    }));
    const unicode = new xterm.Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11';
    term.open(entry.host);

    term.attachCustomKeyEventHandler(event => {
      if (event.type === 'keydown' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (event.key.toLowerCase() === 'c' && term.hasSelection()) {
          event.preventDefault();
          navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          return false;
        }
      }
      if (event.type === 'keydown' && !event.ctrlKey && !event.shiftKey && event.altKey !== event.metaKey) {
        const seq = LINE_EDITING[event.altKey ? 'alt' : 'meta'][event.key];
        if (seq) {
          event.preventDefault();
          term.input(seq);
          return false;
        }
      }
      if (!IS_MAC && event.type === 'keydown' && event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'v') {
        return false;
      }
      return !event.metaKey;
    });

    const encoder = new TextEncoder();
    const isOpen = () => entry.socket?.readyState === WebSocket.OPEN;
    term.onData(data => { if (isOpen()) entry.socket.send(encoder.encode(data)); });
    term.onBinary(data => {
      if (isOpen()) entry.socket.send(Uint8Array.from(data, ch => ch.charCodeAt(0) & 0xff));
    });
    term.onResize(({ cols, rows }) => {
      if (isOpen()) entry.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    entry.fitAddon = fit;

    const ro = new ResizeObserver(() => fitEntry(entry));
    ro.observe(entry.host);
    entry.resizeObserver = ro;

    if (isPreview) {
      setStatus(entry, 'green', entry.standalone ? 'Preview' : 'Ready');
      term.write(String(entry.sandbox.preview).replace(/\r?\n/g, '\r\n'));
    }
    requestAnimationFrame(() => {
      fitEntry(entry);
      if (entry.focusRequested && entry.host.offsetParent !== null) term.focus();
      entry.focusRequested = false;
      if (!isPreview) connectSocket(entry);
    });
  })().catch(() => {
    if (entry.disposed) return;
    entry.resizeObserver?.disconnect();
    entry.term?.dispose();
    entry.term = null;
    entry.fitAddon = null;
    setStatus(entry, 'red', 'Unavailable', {
      error: 'Could not load the terminal renderer.',
      showReconnect: true,
    });
  });
  return entry.initPromise;
}

function syncEntry(entry) {
  const sandbox = entry.sandbox || {};
  const available = sandbox.available !== false;
  if (entry.runBtn) entry.runBtn.disabled = !available || entry.busy;
  if (entry.resetBtn) entry.resetBtn.disabled = !available || entry.busy || Boolean(sandbox.preview);
  entry.host.hidden = !available;
  entry.emptyEl.hidden = available;
  if (!available) {
    setStatus(entry, 'red', 'Unavailable');
    entry.emptyEl.textContent = sandbox.reason || 'QA sandbox is unavailable on this computer.';
    return;
  }
  if (!entry.initPromise) void initRenderer(entry);
}

const SANDBOX_HEAD = { title: 'Sandboxed terminal', policy: 'localhost only · read-only checkout' };

function createEntry({ step, sandbox = step?.sandbox, onRunInTerminal, onReset, head = SANDBOX_HEAD, onClose = null }) {
  const standalone = !step;
  const element = document.createElement('section');
  element.className = 'qa-term';
  if (step) element.dataset.step = step.id;
  element.innerHTML = `<div class="qa-term-head">
      <div class="qa-term-title">
        <span class="qa-dot muted" aria-hidden="true"></span>
        <b></b>
        <span class="qa-term-status">Starting…</span>
        ${head.policy ? '<span class="qa-term-policy mono"></span>' : ''}
      </div>
      <div class="qa-term-actions">
        ${standalone ? '' : '<button type="button" class="qa-btn" data-term-act="run">Send to terminal</button>'}
        <button type="button" class="qa-btn quiet" data-term-act="reconnect" hidden>Reconnect</button>
        ${standalone ? '' : '<button type="button" class="qa-btn quiet" data-term-act="reset">Reset</button>'}
        ${onClose ? '<button type="button" class="qa-btn quiet" data-term-act="close">Close</button>' : ''}
      </div>
    </div>
    <div class="qa-error qa-term-error" hidden></div>
    <div class="qa-term-empty" hidden></div>
    <div class="qa-term-host"></div>`;
  element.querySelector('.qa-term-title b').textContent = head.title;
  if (head.policy) element.querySelector('.qa-term-policy').textContent = head.policy;
  element.querySelector('[data-term-act="close"]')?.addEventListener('click', () => onClose());

  const entry = {
    step,
    sandbox,
    standalone,
    onRunInTerminal,
    onReset,
    element,
    dot: element.querySelector('.qa-dot'),
    statusLabel: element.querySelector('.qa-term-status'),
    errorEl: element.querySelector('.qa-term-error'),
    emptyEl: element.querySelector('.qa-term-empty'),
    host: element.querySelector('.qa-term-host'),
    runBtn: element.querySelector('[data-term-act="run"]'),
    reconnectBtn: element.querySelector('[data-term-act="reconnect"]'),
    resetBtn: element.querySelector('[data-term-act="reset"]'),
    term: null,
    fitAddon: null,
    socket: null,
    resizeObserver: null,
    initPromise: null,
    busy: false,
    disposed: false,
    focusRequested: false,
    fit() { fitEntry(entry); },
    focus() {
      if (entry.disposed) return;
      if (!entry.term) {
        entry.focusRequested = true;
        return;
      }
      fitEntry(entry);
      if (entry.host.offsetParent !== null) entry.term.focus();
    },
  };

  entry.runBtn?.addEventListener('click', () => {
    if (!entry.sandbox?.available || entry.sandbox.preview) return;
    if (!entry.socket || entry.socket.readyState > WebSocket.OPEN) connectSocket(entry);
    entry.onRunInTerminal?.(entry.step);
  });
  entry.reconnectBtn.addEventListener('click', () => {
    if (entry.term) {
      connectSocket(entry);
    } else {
      entry.initPromise = null;
      setStatus(entry, 'muted', 'Starting…');
      void initRenderer(entry);
    }
  });
  entry.resetBtn?.addEventListener('click', () => entry.onReset?.(entry.step));

  activeEntries.add(entry);
  syncEntry(entry);
  return entry;
}

export function getQaTerminal({ step, onRunInTerminal, onReset, busy = false }) {
  let entry = entries.get(step.id);
  if (!entry) {
    entry = createEntry({ step, onRunInTerminal, onReset });
    entries.set(step.id, entry);
  } else {
    entry.step = step;
    entry.sandbox = step.sandbox;
    entry.onRunInTerminal = onRunInTerminal;
    entry.onReset = onReset;
  }
  entry.busy = busy;
  syncEntry(entry);
  return entry;
}

function disposeEntry(entry) {
  if (entry.disposed) return;
  entry.disposed = true;
  activeEntries.delete(entry);
  try { entry.socket?.close(); } catch {}
  entry.socket = null;
  entry.resizeObserver?.disconnect();
  entry.term?.dispose();
  entry.element.remove();
}

export function createQaShellTerminal(sandbox) {
  const entry = createEntry({ sandbox });
  return { element: entry.element, dispose: () => disposeEntry(entry), focus: entry.focus };
}

// The terminal a setup fix runs in, outside the sandbox: `terminalPath` is
// the run's QA terminal address with `fix=1`.
export function createQaFixTerminal({ terminalPath, onClose }) {
  const entry = createEntry({ sandbox: { available: true, terminalPath },
    head: { title: 'Running in this window', policy: '' }, onClose });
  return { element: entry.element, dispose: () => disposeEntry(entry), focus: entry.focus, fit: entry.fit };
}

export function resetQaTerminal(stepId) {
  const entry = entries.get(stepId);
  if (!entry) return;
  entries.delete(stepId);
  disposeEntry(entry);
}

export function disposeQaTerminals() {
  for (const stepId of [...entries.keys()]) resetQaTerminal(stepId);
}
