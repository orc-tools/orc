// Greg: the QA window's throwaway chat (ui/qa_chat.py). He floats in a corner
// of the tested app's area; clicking him opens a small chat card beside him.
// The conversation belongs to this window: a reload keeps it, and closing
// the window deletes it.
//
// In Orc.app the tested page is a native browser laid over the QA page, so
// Greg and his card would sit underneath it. `syncCutouts` tells the app
// which rectangles to cut out of that browser so they show through, and
// where to draw Greg's face over it, so the tested page shows around him.

const CORNERS = ['br', 'bl', 'tr', 'tl'];
const CORNER_KEY = 'orcQaGregCorner';
// Where he was dropped, as fractions of the room he can move in.
const SPOT_KEY = 'orcQaGregSpot';
const DRAG_START = 6;
const POLL_MS = 700;
const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
// `path/to/file.ext` or `path/to/file.ext:41`, as Greg is told to cite code.
const FILE_REF = /<code class="mono">((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?)<\/code>/g;

function stored(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function store(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* this window only */ }
}

// The face the active theme draws for Gary, which Greg wears until he has
// one of his own. qa.html has already painted the theme onto <html>.
function gregFace() {
  const themeId = document.documentElement.dataset.funMode;
  const plugin = (window.ORC_APP_PLUGINS?.plugins || [])
    .find(entry => entry.enabled && !entry.error && entry.contributes?.theme?.id === themeId);
  const file = plugin?.contributes.theme.gary;
  return plugin?.base && file ? plugin.base + file : '/assets/persona/gary.png';
}

// A CSS colour as `#rrggbb`, as Orc.app reads colours, or null when it is
// not one or not opaque.
let colorCanvas = null;
function hexColor(css) {
  colorCanvas ??= document.createElement('canvas').getContext('2d');
  if (!colorCanvas) return null;
  colorCanvas.fillStyle = '#000000';
  colorCanvas.fillStyle = css.trim();
  const value = colorCanvas.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

// Greg's reply as HTML: paragraphs, short lists and fenced code. Every
// character of the reply is escaped by `inline` or `escape` before it is
// placed, because the reply can quote a pull request someone else wrote.
export function gregMarkdown(text, { inline, escape }) {
  const html = [];
  let paragraph = [];
  let list = null;
  let fence = null;
  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        html.push(`<pre class="mono">${escape(fence.join('\n'))}</pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      closeParagraph();
      closeList();
      fence = [];
      continue;
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      closeParagraph();
      const tag = item[1] ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      list = list || { tag, items: [] };
      list.items.push(item[3]);
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    // A wrapped line carries on the list item above it.
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    closeList();
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      closeParagraph();
      html.push(`<p><b>${inline(heading[1].replace(/\*\*/g, ''))}</b></p>`);
    } else paragraph.push(line.trim());
  }
  if (fence) html.push(`<pre class="mono">${escape(fence.join('\n'))}</pre>`);
  closeParagraph();
  closeList();
  return html.join('').replace(FILE_REF, '<code class="mono qa-chat-ref">$1</code>');
}

// The corner of `box` nearest to the point, as 'br', 'bl', 'tr' or 'tl'.
export function nearestCorner(box, x, y) {
  const vertical = y < box.top + box.height / 2 ? 't' : 'b';
  const horizontal = x < box.left + box.width / 2 ? 'l' : 'r';
  return vertical + horizontal;
}

// A stored drop spot, or null when there is none or it is not one.
export function parseSpot(text) {
  try {
    const spot = JSON.parse(text);
    const ok = value => typeof value === 'number' && value >= 0 && value <= 1;
    return spot && ok(spot.x) && ok(spot.y) ? { x: spot.x, y: spot.y } : null;
  } catch { return null; }
}

// The corner an arrow key moves Greg to from `corner`.
export function cornerAfterKey(corner, key) {
  const [vertical, horizontal] = corner;
  if (key === 'ArrowLeft') return vertical + 'l';
  if (key === 'ArrowRight') return vertical + 'r';
  if (key === 'ArrowUp') return 't' + horizontal;
  if (key === 'ArrowDown') return 'b' + horizontal;
  return corner;
}

// What Greg starts with, as the chips under his name.
export function knownThings({ pr, review, steps, page, diff }) {
  const things = [pr?.number ? `PR #${pr.number}` : review ? 'this pull request' : 'this run'];
  if (diff) things.push('its diff');
  if (steps) things.push(`${steps} QA step${steps === 1 ? '' : 's'}`);
  if (page) things.push('this page');
  return things;
}

// `where()` is the QA window's own state: {ready, review, pr, steps, step,
// page}. `post(message)` reaches Orc.app; `native()` says whether it is there.
export function mountGreg({ runId, root, pane, where, native, post, announce, escapeHtml, inlineMarkdown }) {
  const sessionKey = 'orc-qa-chat-session:' + runId;
  const openKey = 'orc-qa-chat-open:' + runId;
  let session = stored(sessionStorage, sessionKey);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(session || '')) {
    session = (crypto.randomUUID?.() || `w-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
    store(sessionStorage, sessionKey, session);
  }
  const chatUrl = `/runs/${encodeURIComponent(runId)}/qa/chat`;
  const markdown = text => gregMarkdown(text, { inline: inlineMarkdown, escape: escapeHtml });
  const face = gregFace();
  const faceUrl = new URL(face, location.href).href;

  const chat = {
    data: null,          // the last answer from the server
    sending: null,       // the message on its way, shown before the server has it
    stopping: false,
    error: null,
    open: stored(sessionStorage, openKey) === '1',
    menu: false,
    corner: CORNERS.includes(stored(localStorage, CORNER_KEY)) ? stored(localStorage, CORNER_KEY) : 'br',
    // Where he was dropped; null keeps him at his corner.
    spot: parseSpot(stored(localStorage, SPOT_KEY)),
  };
  let seq = 0;
  let applied = 0;
  let pollTimer = null;
  let drag = null;
  let dragged = false;
  let lastCutouts = null;
  // What is drawn now, so a repaint with nothing new leaves scroll and focus alone.
  let drawnMessages = null;
  let drawnMenu = null;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'qa-greg';
  button.className = 'qa-greg';
  button.setAttribute('aria-label', 'Ask Greg about this change');
  button.setAttribute('aria-controls', 'qa-chat');
  button.setAttribute('aria-describedby', 'qa-greg-hint');
  button.innerHTML = `<img src="${escapeHtml(face)}" alt="" draggable="false">`;

  const hint = document.createElement('span');
  hint.id = 'qa-greg-hint';
  hint.hidden = true;
  hint.textContent = 'Drag him anywhere, or use the arrow keys to send him to a corner.';

  const card = document.createElement('section');
  card.id = 'qa-chat';
  card.className = 'qa-chat';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Chat with Greg');
  card.hidden = true;
  card.innerHTML = `<header class="qa-chat-head">
      <img src="${escapeHtml(face)}" alt="">
      <div><h2>Greg</h2><p>A fresh chat. Closing the QA window deletes it.</p></div>
      <button type="button" class="qa-chat-close" data-chat="close" aria-label="Close the chat">×</button>
    </header>
    <div class="qa-chat-knows"></div>
    <div class="qa-chat-msgs" role="log" aria-live="polite" aria-label="Conversation" tabindex="0"></div>
    <form class="qa-chat-composer">
      <textarea rows="2" aria-label="Message Greg"></textarea>
      <div class="qa-chat-row">
        <button type="button" class="qa-chat-model" data-chat="menu" aria-haspopup="true" aria-expanded="false"></button>
        <button type="submit" class="qa-chat-send"></button>
      </div>
      <div class="qa-chat-menu" hidden></div>
      <p class="qa-error qa-chat-error" role="alert" hidden></p>
    </form>`;
  const knows = card.querySelector('.qa-chat-knows');
  const messages = card.querySelector('.qa-chat-msgs');
  const form = card.querySelector('.qa-chat-composer');
  const input = card.querySelector('textarea');
  const modelButton = card.querySelector('.qa-chat-model');
  const sendButton = card.querySelector('.qa-chat-send');
  const menu = card.querySelector('.qa-chat-menu');
  const errorLine = card.querySelector('.qa-chat-error');
  pane.append(button, hint, card);

  const working = () => chat.sending ? { status: 'Thinking', draft: '' } : chat.data?.working || null;

  // ---------- network ----------

  async function load() {
    const mine = ++seq;
    try {
      const response = await fetch(`/api${chatUrl}?session=${encodeURIComponent(session)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (mine < applied) return;
      applied = mine;
      apply(data);
    } catch {
      if (mine < applied) return;
      // A turn in flight is asked about again; anything else waits for the next action.
      if (chat.data?.working) schedulePoll();
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (chat.data?.working) pollTimer = setTimeout(load, POLL_MS);
  }

  function apply(data) {
    const was = chat.data;
    chat.data = data;
    if (was?.working && !data.working) {
      const last = data.messages[data.messages.length - 1];
      announce(last?.error ? 'Greg could not answer.' : last?.stopped ? 'Greg stopped.' : 'Greg answered.');
    }
    paint();
    schedulePoll();
  }

  async function act(body) {
    chat.error = null;
    try {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, session }),
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        chat.error = payload?.error || `That did not work (HTTP ${response.status}).`;
        return false;
      }
      chat.sending = null;
      applied = ++seq;
      apply(payload);
      return true;
    } catch {
      chat.error = 'Orc did not answer. Is it still running?';
      return false;
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || working()) return;
    const at = where();
    chat.sending = text;
    input.value = '';
    paint();
    const sent = await act({ action: 'send', text, step: at.step?.id || null, page: at.page || null });
    chat.sending = null;
    // The words go back in the box, unless more were typed while it was away.
    if (!sent && !input.value) input.value = text;
    paint();
  }

  async function stop() {
    chat.stopping = true;
    paint();
    await act({ action: 'stop' });
    chat.stopping = false;
    paint();
  }

  async function chooseModel(model, effort) {
    await act({ action: 'model', model, effort });
    paint();
  }

  // ---------- drawing ----------

  function him(html, extra = '') {
    return `<div class="qa-chat-him${extra}"><img src="${escapeHtml(face)}" alt=""><div class="qa-chat-said">${html}</div></div>`;
  }

  function messageHtml(message) {
    if (message.role === 'you') return `<div class="qa-chat-me">${escapeHtml(message.text)}</div>`;
    if (message.error) return him(`<p class="qa-error">${escapeHtml(message.error)}</p>`);
    const stopped = message.stopped ? '<p class="qa-chat-stopped">You stopped Greg here.</p>' : '';
    return him((message.text ? markdown(message.text) : '') + stopped);
  }

  function paintMessages() {
    const list = [...(chat.data?.messages || [])];
    if (chat.sending) list.push({ role: 'you', text: chat.sending });
    const busy = working();
    let html = list.map(messageHtml).join('');
    if (!list.length && !busy) {
      html = him(`<p>${escapeHtml(chat.data?.unavailable
        || `Ask me what this ${where().review ? 'pull request' : 'run'} changes, why a step is there, or about what you are looking at.`)}</p>`, ' qa-chat-hello');
    }
    if (busy?.draft) html += him(markdown(busy.draft));
    if (busy) {
      html += `<div class="qa-chat-working"><img src="${escapeHtml(face)}" alt=""><span class="qa-chat-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(busy.status || 'Thinking')}</span></div>`;
    }
    if (html === drawnMessages) return;
    const stick = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 24;
    drawnMessages = html;
    messages.innerHTML = html;
    if (stick || chat.sending) messages.scrollTop = messages.scrollHeight;
  }

  function paintMenu() {
    menu.hidden = !chat.menu;
    modelButton.setAttribute('aria-expanded', String(chat.menu));
    if (!chat.menu || !chat.data) return;
    const { models = [], efforts = [], model, effort } = chat.data;
    const html = `<div class="qa-chat-menu-label" id="qa-chat-models-label">Model for this window</div>
      <div class="qa-chat-models" role="radiogroup" aria-labelledby="qa-chat-models-label">${models.map(entry => `<button type="button" role="radio" aria-checked="${entry.id === model}" data-chat="model" data-model="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</button>`).join('')}</div>
      <div class="qa-chat-menu-label" id="qa-chat-effort-label">Effort</div>
      <div class="qa-chat-efforts" role="radiogroup" aria-labelledby="qa-chat-effort-label">${efforts.map(level => `<button type="button" role="radio" aria-checked="${level === effort}" data-chat="effort" data-effort="${escapeHtml(level)}">${escapeHtml(EFFORT_LABELS[level] || level)}</button>`).join('')}</div>`;
    if (html === drawnMenu) return;
    // The choice just pressed keeps the keyboard's place in the new list.
    const pressed = menu.contains(document.activeElement) ? document.activeElement.dataset : null;
    drawnMenu = html;
    menu.innerHTML = html;
    if (pressed) {
      const again = pressed.chat === 'model' ? `[data-model="${CSS.escape(pressed.model)}"]` : `[data-effort="${CSS.escape(pressed.effort)}"]`;
      menu.querySelector(again)?.focus();
    }
  }

  function paint() {
    const at = where();
    const shown = Boolean(at.ready);
    button.hidden = !shown;
    card.hidden = !shown || !chat.open;
    button.dataset.corner = card.dataset.corner = chat.corner;
    if (!drag?.moved) place();
    button.setAttribute('aria-expanded', String(chat.open));
    button.classList.toggle('is-working', Boolean(working()));
    if (shown && chat.open) {
      knows.innerHTML = 'Has read ' + knownThings({
        pr: at.pr, review: at.review, steps: at.steps, page: at.page, diff: chat.data?.knowsDiff,
      }).map(thing => `<span>${escapeHtml(thing)}</span>`).join('');
      input.placeholder = `Ask about this ${at.review ? 'PR' : 'run'} or what you're seeing…`;
      const busy = Boolean(working());
      const blocked = Boolean(chat.data?.unavailable);
      input.disabled = blocked;
      sendButton.textContent = busy ? 'Stop' : 'Send';
      sendButton.dataset.chat = busy ? 'stop' : 'send';
      sendButton.disabled = blocked || Boolean(chat.sending) || chat.stopping;
      const current = (chat.data?.models || []).find(entry => entry.id === chat.data?.model);
      modelButton.innerHTML = chat.data
        ? `${escapeHtml(current?.label || chat.data.model)} · ${escapeHtml(EFFORT_LABELS[chat.data.effort] || chat.data.effort)} ${CHEVRON}`
        : 'Loading…';
      modelButton.disabled = !chat.data;
      errorLine.hidden = !chat.error;
      errorLine.textContent = chat.error || '';
      paintMessages();
      paintMenu();
    }
    syncCutouts();
  }

  // ---------- open, close, corners ----------

  function setOpen(open, { focus = true } = {}) {
    chat.open = open;
    chat.menu = false;
    store(sessionStorage, openKey, open ? '1' : '');
    paint();
    if (open) {
      messages.scrollTop = messages.scrollHeight;
      if (!chat.data) load();
      if (focus) input.focus();
    } else if (focus) button.focus();
  }

  // An arrow key sends him to a corner; a drop leaves him at `spot`, and the
  // corner is then the nearest one, which says where his card opens.
  function setCorner(corner, spot = null) {
    chat.corner = corner;
    chat.spot = spot;
    store(localStorage, CORNER_KEY, corner);
    store(localStorage, SPOT_KEY, spot ? JSON.stringify(spot) : '');
    paint();
  }

  // The room he moves in, in the coordinates his left and top are set in:
  // the pane, or the window when the narrow layout fixes him to it. A page
  // step's toolbar stays clear, as his top corners keep it clear.
  function room() {
    if (getComputedStyle(button).position === 'fixed') {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, inset: 0 };
    }
    const box = pane.getBoundingClientRect();
    const toolbar = pane.querySelector('.qa-toolbar');
    return { left: box.left, top: box.top, width: box.width, height: box.height, inset: toolbar ? toolbar.offsetHeight : 0 };
  }

  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

  // Puts him at his drop spot and his card beside him. Without a spot both
  // keep to their corner's stylesheet place.
  function place() {
    const sides = ['left', 'top', 'right', 'bottom'];
    if (!chat.spot || button.hidden) {
      for (const side of sides) button.style[side] = card.style[side] = '';
      card.style.height = '';
      return;
    }
    const area = room();
    const size = button.offsetWidth;
    const left = clamp(chat.spot.x * (area.width - size), 0, area.width - size);
    const top = clamp(chat.spot.y * (area.height - size), area.inset, area.height - size);
    Object.assign(button.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    if (card.hidden) return;
    // The card opens above him in the bottom half and below him in the top,
    // lined up with his outer side, as it does at a corner.
    const [vertical, horizontal] = chat.corner;
    const width = Math.min(392, area.width - 32);
    const margin = 16;
    if (horizontal === 'r') {
      Object.assign(card.style, { left: 'auto', right: `${clamp(area.width - left - size - 6, margin, area.width - width - margin)}px` });
    } else {
      Object.assign(card.style, { right: 'auto', left: `${clamp(left - 6, margin, area.width - width - margin)}px` });
    }
    if (vertical === 'b') {
      const bottom = area.height - top + 12;
      Object.assign(card.style, { top: 'auto', bottom: `${bottom}px`, height: `${Math.max(200, Math.min(570, area.height - bottom - Math.max(area.inset, margin)))}px` });
    } else {
      const from = top + size + 12;
      Object.assign(card.style, { bottom: 'auto', top: `${from}px`, height: `${Math.max(200, Math.min(570, area.height - from - margin))}px` });
    }
  }

  // The rectangles Orc.app cuts out of its browser so his card shows. Greg's
  // own does not paint: it only lets presses through to him here, and the
  // app draws his face (`greg`) over its browser, so the tested page shows
  // around him. An older app ignores both and cuts him a hole.
  function syncCutouts() {
    if (!native()) return;
    const rects = [];
    let greg = null;
    for (const [node, radius] of [[button, null], [card, 12], ...Array.from(pane.querySelectorAll('[data-qa-cutout]:not([hidden])'), node => [node, 5])]) {
      if (node.hidden) continue;
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
      if (node === button) {
        rects.push({ ...rect, radius: box.width / 2, paint: false });
        greg = { ...rect, face: faceUrl };
        // His working dot, which the browser covers along with the rest of him.
        if (button.classList.contains('is-working') && !chat.open) {
          const style = getComputedStyle(button);
          greg.dot = hexColor(style.getPropertyValue('--accent'));
          greg.dotRing = hexColor(style.getPropertyValue('--bg'));
        }
      } else rects.push({ ...rect, radius });
    }
    const message = greg ? { action: 'cutouts', rects, greg } : { action: 'cutouts', rects };
    const key = JSON.stringify(message);
    if (key === lastCutouts) return;
    lastCutouts = key;
    post(message);
  }

  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const box = button.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_START) return;
    if (!drag.moved) {
      drag.moved = true;
      // The card would trail behind him; it comes back at the new corner.
      drag.wasOpen = chat.open;
      if (chat.open) setOpen(false, { focus: false });
      button.classList.add('is-dragging');
    }
    const area = room();
    const size = button.offsetWidth;
    drag.left = clamp(event.clientX - drag.dx - area.left, 0, area.width - size);
    drag.top = clamp(event.clientY - drag.dy - area.top, area.inset, area.height - size);
    Object.assign(button.style, { left: `${drag.left}px`, top: `${drag.top}px`, right: 'auto', bottom: 'auto' });
    syncCutouts();
  });
  const endDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = drag;
    drag = null;
    if (!ended.moved) return;
    button.classList.remove('is-dragging');
    // A mouse drag ends in a click, which must not also open the chat.
    dragged = event.type === 'pointerup' && event.pointerType === 'mouse';
    // He stays where he was let go, and the next window opens him there.
    const area = room();
    const size = button.offsetWidth;
    const spot = {
      x: area.width > size ? ended.left / (area.width - size) : 0,
      y: area.height > size ? ended.top / (area.height - size) : 0,
    };
    setCorner(nearestCorner({ left: 0, top: 0, width: area.width, height: area.height }, ended.left + size / 2, ended.top + size / 2), spot);
    if (ended.wasOpen) setOpen(true, { focus: false });
  };
  button.addEventListener('pointerup', endDrag);
  button.addEventListener('pointercancel', endDrag);
  button.addEventListener('click', () => {
    if (dragged) { dragged = false; return; }
    setOpen(!chat.open);
  });
  button.addEventListener('keydown', event => {
    if (!event.key.startsWith('Arrow') || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const corner = cornerAfterKey(chat.corner, event.key);
    if (corner !== chat.corner) setCorner(corner);
  });

  // Keys typed in the chat are the chat's: the window's step shortcuts
  // (j, k, p, f) must not hear them.
  card.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (chat.menu) { chat.menu = false; paint(); modelButton.focus(); } else setOpen(false);
    } else if (event.target === input && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (sendButton.dataset.chat === 'stop') stop();
    else send();
  });
  card.addEventListener('click', event => {
    const control = event.target.closest('[data-chat]');
    if (!control) return;
    const what = control.dataset.chat;
    if (what === 'close') setOpen(false);
    else if (what === 'menu') { chat.menu = !chat.menu; paint(); }
    else if (what === 'model') chooseModel(control.dataset.model, chat.data.effort);
    else if (what === 'effort') chooseModel(chat.data.model, control.dataset.effort);
  });

  // A reload looks like closing from here, so the server waits a moment for
  // this window to ask again before it deletes the chat. Orc.app tells the
  // server itself when its window closes.
  window.addEventListener('pagehide', () => {
    try {
      navigator.sendBeacon(chatUrl, JSON.stringify({ action: 'leave', session }));
    } catch { /* the server forgets a chat nobody reads */ }
  });
  // An idle window still reads its chat now and then, so the server knows it
  // is open, and a page restored from the back-forward cache says it is back.
  const back = () => { if (document.visibilityState === 'visible' && !working()) load(); };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  window.addEventListener('pageshow', event => { if (event.persisted) back(); });
  // A press anywhere else puts the model list away.
  document.addEventListener('pointerdown', event => {
    if (chat.menu && !menu.contains(event.target) && !modelButton.contains(event.target)) { chat.menu = false; paint(); }
  });
  // A resized window keeps him at the same share of the room, inside it.
  const resized = () => { if (!drag?.moved) place(); syncCutouts(); };
  if (window.ResizeObserver) new ResizeObserver(resized).observe(pane);
  window.addEventListener('resize', resized);

  root.classList.toggle('qa-native', Boolean(native()));
  paint();
  load();
  return { sync: paint, syncCutouts };
}
