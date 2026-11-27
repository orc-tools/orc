import { createShellTab } from './qa-shell-tab.js';

function mcpFrame(runId) {
  const frame = document.createElement('iframe');
  frame.title = 'MCP inspector';
  frame.className = 'qa-tool-frame';
  frame.dataset.run = runId;
  frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/app-plugin-themes.css"><link rel="stylesheet" href="/orc-aliases.css">
    <link rel="stylesheet" href="/qa-window.css"><link rel="stylesheet" href="/mcp-tab.css">
    <script type="module" src="/vendor/orc-ds.min.js"></script>
    <script type="module" src="/js/qa-mcp-frame.js"></script></head>
    <body><main id="content" class="qa-tool-content"></main><span id="announcer" role="status" class="qa-visually-hidden"></span></body></html>`;
  return { element: frame };
}

export function createToolTabs({ pane, runId, data, onSelect, onClose, updateCutouts }) {
  const qa = { id: 'qa', label: 'QA step' };
  const items = new Map([[qa.id, qa]]);
  const counts = new Map();
  let active = qa;
  const strip = document.createElement('div');
  strip.className = 'qa-tool-strip';
  strip.hidden = true;
  const list = document.createElement('div');
  list.className = 'qa-tool-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Inspector tabs');
  strip.append(list);
  pane.prepend(strip);
  const picker = document.createElement('div');
  picker.className = 'qa-tool-picker';
  picker.innerHTML = `<button type="button" class="qa-btn qa-glyph" aria-label="New tab" title="New tab" aria-expanded="false">+</button>
    <div class="qa-tool-choices" data-qa-cutout hidden>${['Browser','MCP','Terminal'].map(type => `<button type="button">${type}</button>`).join('')}</div>`;
  const trigger = picker.firstElementChild;
  const choices = picker.lastElementChild;

  function toggle(open) {
    choices.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      const rect = picker.getBoundingClientRect();
      const spaceBelow = innerHeight - rect.bottom - 10;
      const spaceAbove = rect.top - 10;
      choices.dataset.side = choices.offsetHeight > spaceBelow && spaceAbove > spaceBelow ? 'above' : 'below';
      choices.style.left = Math.min(0, innerWidth - rect.left - choices.offsetWidth - 5) + 'px';
      choices.firstElementChild.focus();
    } else {
      delete choices.dataset.side;
    }
    updateCutouts();
  }

  function select(item) {
    if (item === active) return;
    const previous = active;
    active = item;
    if (previous.element) previous.element.hidden = true;
    if (item.element) item.element.hidden = false;
    for (const tab of items.values()) tab.button?.setAttribute('aria-selected', String(tab === item));
    onSelect(item, previous);
  }

  function addButton(item) {
    const group = document.createElement('span');
    const button = document.createElement('button');
    button.textContent = item.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(item === active));
    button.onclick = () => select(item);
    group.append(button);
    list.append(group);
    item.button = button;
    button.onkeydown = event => {
      const ordered = [...items.values()];
      const index = ordered.indexOf(item);
      const next = { ArrowRight: (index + 1) % ordered.length, ArrowLeft: (index + ordered.length - 1) % ordered.length,
        Home: 0, End: ordered.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(ordered[next]);
      ordered[next].button.focus();
    };
    if (item === qa) return;
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Close ' + item.label);
    close.textContent = '×';
    group.append(close);
    close.onclick = () => {
      items.delete(item.id);
      if (active === item) select(qa);
      item.dispose?.();
      item.element?.remove();
      onClose(item);
      group.remove();
      place(lastToolbar);
      (strip.hidden ? trigger : active.button).focus();
    };
  }

  let lastToolbar;
  function place(toolbar) {
    lastToolbar = toolbar;
    strip.hidden = items.size === 1;
    const parent = strip.hidden ? toolbar : strip;
    if (parent && picker.parentNode !== parent) parent.insertBefore(picker, parent.querySelector('[data-act="open-external"]'));
  }
  addButton(qa);
  trigger.onclick = () => toggle(choices.hidden);
  // WebKit blurs the current choice on mousedown, before it clicks the new one.
  choices.onmousedown = event => {
    if (event.button === 0) event.preventDefault();
  };
  function open(kind) {
    const id = crypto.randomUUID();
    const count = (counts.get(kind) || 0) + 1;
    counts.set(kind, count);
    const tab = { id, kind, label: count === 1 ? kind : kind + ' ' + count };
    if (kind === 'MCP') Object.assign(tab, mcpFrame(runId));
    if (kind === 'Terminal') Object.assign(tab, createShellTab({ runId, tabId: id, data: data() }));
    if (tab.element) pane.append(tab.element);
    items.set(id, tab);
    addButton(tab);
    select(tab);
    tab.button.focus();
    tab.focus?.();
    return tab;
  }
  choices.onclick = event => {
    const kind = event.target.closest('button')?.textContent;
    if (!kind) return;
    toggle(false);
    open(kind);
  };
  picker.onkeydown = event => {
    if (event.key === 'Escape') { toggle(false); trigger.focus(); }
    if (!choices.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const options = [...choices.children];
      const next = options.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
      options[(next + options.length) % options.length].focus();
    }
    event.stopPropagation();
  };
  document.addEventListener('pointerdown', e => { if (!choices.hidden && !picker.contains(e.target)) toggle(false); });
  picker.addEventListener('focusout', e => { if (!choices.hidden && !picker.contains(e.relatedTarget)) toggle(false); });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) for (const item of items.values()) item.dispose?.();
  });
  return { place, open, get active() { return active; }, qa, selectQa: () => select(qa) };
}
