import { esc } from './core.js';

// GitHub's emoji in the PR review cards: `:tada:` in a saved note, comment or
// reply shows 🎉, and typing `:` and two letters in their editor offers the
// matching names, the way GitHub's comment box does. The names come from
// GitHub's emoji API, through gh, once (ui/github_emoji.py). Picking one
// inserts the `:shortcode:` text, which GitHub turns into the emoji when the
// review posts.

const EMOJI_SUGGEST_LIMIT = 5;
// `:` then two or more name characters, right before the caret, at the start
// of the text or after a space or bracket, as GitHub asks for.
const EMOJI_QUERY = /(?:^|[\s([{])(:([a-z0-9_+-]{2,}))$/i;
const EMOJI_SHORTCODE = /:([a-z0-9_+-]+):/gi;

let emojiTable = null;
let emojiLoading = null;
let emojiFailedAt = 0;
// After a failed load, cards and keystrokes wait this long before asking again.
const EMOJI_RETRY_MS = 30_000;
const emojiWaiters = new Set();

export function emojiReady() {
  return !!emojiTable;
}

// Loads the list once per page. `then` runs when it arrives, so a card painted
// before then can paint again with the emoji in place.
export function loadGithubEmoji(then) {
  if (emojiTable) return Promise.resolve(emojiTable);
  if (!emojiLoading && Date.now() - emojiFailedAt < EMOJI_RETRY_MS) return Promise.resolve(null);
  if (then) emojiWaiters.add(then);
  emojiLoading ||= fetch('/api/github-emoji')
    .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then(table => {
      // Maps, so a name such as `:constructor:` never finds Object's own.
      emojiTable = { unicode: new Map(Object.entries(table.unicode || {})), custom: new Map(Object.entries(table.custom || {})) };
      const waiting = [...emojiWaiters];
      emojiWaiters.clear();
      waiting.forEach(fn => fn());
      return emojiTable;
    })
    .catch(() => { emojiLoading = null; emojiFailedAt = Date.now(); emojiWaiters.clear(); return null; });
  return emojiLoading;
}

function emojiHtml(name) {
  const unicode = emojiTable?.unicode.get(name);
  if (unicode) return `<span class="gh-emoji" title=":${esc(name)}:">${esc(unicode)}</span>`;
  const image = emojiTable?.custom.get(name);
  if (image) return `<img class="gh-emoji" src="${esc(image)}" alt=":${esc(name)}:" title=":${esc(name)}:" width="20" height="20">`;
  return null;
}

// Escapes `text` and shows each `:name:` GitHub knows as its emoji. Names it
// does not know, and every name before the list loads, stay as typed.
export function emojifyHtml(text) {
  const html = esc(text);
  if (!emojiTable) return html;
  return html.replace(EMOJI_SHORTCODE, (whole, name) => emojiHtml(name) ?? whole);
}

export function emojiSuggestions(query) {
  if (!emojiTable) return [];
  const needle = query.toLowerCase();
  const names = [...emojiTable.unicode.keys(), ...emojiTable.custom.keys()];
  const starts = names.filter(name => name.startsWith(needle))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const inside = starts.length >= EMOJI_SUGGEST_LIMIT ? []
    : names.filter(name => !name.startsWith(needle) && name.includes(needle)).sort();
  return [...starts, ...inside].slice(0, EMOJI_SUGGEST_LIMIT);
}

// Where the caret sits inside the textarea, in its own pixels, measured on a
// hidden copy that wraps the text the same way.
function caretPoint(textarea) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize']) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' });
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(marker);
  document.body.append(mirror);
  const box = mirror.getBoundingClientRect();
  const mark = marker.getBoundingClientRect();
  const point = { left: mark.left - box.left, top: mark.top - box.top, bottom: mark.bottom - box.top };
  mirror.remove();
  return {
    left: point.left - textarea.scrollLeft,
    top: point.top - textarea.scrollTop,
    bottom: point.bottom - textarea.scrollTop,
  };
}

function clipBounds(textarea) {
  const viewport = window.visualViewport;
  let left = viewport?.offsetLeft || 0;
  let top = viewport?.offsetTop || 0;
  let right = left + (viewport?.width || innerWidth);
  let bottom = top + (viewport?.height || innerHeight);
  for (let el = textarea.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (!/^(auto|scroll|clip|hidden)$/.test(getComputedStyle(el).overflowY)) continue;
    const rect = el.getBoundingClientRect();
    left = Math.max(left, rect.left);
    top = Math.max(top, rect.top);
    right = Math.min(right, rect.right);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { left: left + 8, top: top + 8, right: Math.max(left + 8, right - 8), bottom: Math.max(top + 8, bottom - 8) };
}

// The suggestion list under the caret in a PR card's editor. Arrow keys move,
// Enter or Tab inserts, Escape closes. The textarea keeps focus throughout and
// names the active option, as a combobox does.
export function wireEmojiSuggest(textarea) {
  if (!textarea || textarea.dataset.emojiSuggest != null) return;
  textarea.dataset.emojiSuggest = '';
  const menu = document.createElement('ul');
  menu.className = 'gh-emoji-menu';
  menu.id = `${textarea.id || 'prr-edit'}-emoji`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Emoji');
  menu.hidden = true;
  textarea.insertAdjacentElement('afterend', menu);
  textarea.setAttribute('aria-autocomplete', 'list');
  textarea.setAttribute('aria-controls', menu.id);
  textarea.setAttribute('aria-expanded', 'false');
  let matches = [];
  let active = 0;
  let start = -1;
  let typed = '';
  let openListeners = null;

  const stopOpenListeners = () => {
    openListeners?.abort();
    openListeners = null;
  };
  const close = () => {
    stopOpenListeners();
    menu.hidden = true;
    delete menu.dataset.side;
    menu.style.maxHeight = '';
    matches = [];
    textarea.setAttribute('aria-expanded', 'false');
    textarea.removeAttribute('aria-activedescendant');
  };
  const position = () => {
    if (menu.hidden) return;
    if (!textarea.isConnected) return close();
    const point = caretPoint(textarea);
    const field = textarea.getBoundingClientRect();
    const bounds = clipBounds(textarea);
    const caretTop = field.top + Math.max(0, Math.min(point.top, textarea.offsetHeight));
    const caretBottom = field.top + Math.max(0, Math.min(point.bottom, textarea.offsetHeight));
    menu.style.maxHeight = '';
    const menuRect = menu.getBoundingClientRect();
    const spaceBelow = Math.max(0, bounds.bottom - caretBottom - 4);
    const spaceAbove = Math.max(0, caretTop - bounds.top - 4);
    const flip = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
    const available = flip ? spaceAbove : spaceBelow;
    if (menuRect.height > available && available > 0) {
      menu.style.maxHeight = `${Math.max(40, Math.floor(available))}px`;
    }
    const height = menu.offsetHeight;
    const width = menu.offsetWidth;
    const y = flip
      ? Math.max(bounds.top, caretTop - height - 4)
      : Math.min(caretBottom + 4, Math.max(bounds.top, bounds.bottom - height));
    const rawX = field.left + Math.min(point.left, textarea.clientWidth - 40);
    const x = Math.max(bounds.left, Math.min(rawX, Math.max(bounds.left, bounds.right - width)));
    const offsetParent = menu.offsetParent;
    const form = offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    menu.style.left = `${x - form.left - (offsetParent?.clientLeft || 0)}px`;
    menu.style.top = `${y - form.top - (offsetParent?.clientTop || 0)}px`;
    menu.dataset.side = flip ? 'above' : 'below';
  };
  const startOpenListeners = () => {
    if (openListeners) return;
    openListeners = new AbortController();
    const { signal } = openListeners;
    const onScroll = event => {
      if (event.target === menu || menu.contains(event.target)) return;
      position();
    };
    window.addEventListener('resize', position, { signal, passive: true });
    window.addEventListener('scroll', onScroll, { signal, capture: true, passive: true });
    textarea.addEventListener('scroll', position, { signal, passive: true });
    window.visualViewport?.addEventListener('resize', position, { signal, passive: true });
    window.visualViewport?.addEventListener('scroll', position, { signal, passive: true });
  };
  const pick = index => {
    const name = matches[index];
    if (!name) return;
    const caret = textarea.selectionStart;
    const insert = `:${name}: `;
    textarea.setRangeText(insert, start, caret, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  const render = () => {
    menu.innerHTML = matches.map((name, index) => `<li role="option" id="${menu.id}-${index}"${index === active ? ' aria-selected="true"' : ''} data-emoji-index="${index}">
        <span class="gh-emoji-glyph" aria-hidden="true">${emojiHtml(name) || ''}</span><span><b>:${esc(name.slice(0, typed.length))}</b>${esc(name.slice(typed.length))}:</span>
      </li>`).join('');
    textarea.setAttribute('aria-activedescendant', `${menu.id}-${active}`);
  };
  const update = () => {
    if (textarea.selectionStart !== textarea.selectionEnd) return close();
    const before = textarea.value.slice(0, textarea.selectionStart);
    const found = EMOJI_QUERY.exec(before);
    matches = found ? emojiSuggestions(found[2]) : [];
    if (!matches.length) return close();
    start = before.length - found[1].length;
    typed = found[2];
    active = 0;
    render();
    menu.hidden = false;
    position();
    startOpenListeners();
    textarea.setAttribute('aria-expanded', 'true');
  };

  textarea.addEventListener('input', event => {
    // An IME's unfinished word is in the box too; wait for it to commit.
    if (event.isComposing) return;
    if (emojiReady()) update();
    else loadGithubEmoji().then(() => { if (document.activeElement === textarea) update(); });
  });
  textarea.addEventListener('click', () => { if (!menu.hidden) update(); });
  // The image tray wraps the box once it appears, which blurs it and gives
  // focus straight back; only a real move away closes the list.
  textarea.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== textarea) close(); }));
  textarea.addEventListener('keydown', event => {
    if (menu.hidden || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      active = (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      render();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      pick(active);
    } else if (event.key === 'Escape') {
      close();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  // Mouse down, not click, so the textarea keeps focus and its caret.
  menu.addEventListener('mousedown', event => {
    const option = event.target.closest('[data-emoji-index]');
    if (!option) return;
    event.preventDefault();
    pick(Number(option.dataset.emojiIndex));
  });
  // A card repaint swaps in a new box holding the same draft; it offers the
  // same names the old one was showing.
  if (document.activeElement === textarea && emojiReady()) update();
  else loadGithubEmoji(() => { if (document.activeElement === textarea) update(); });
}
