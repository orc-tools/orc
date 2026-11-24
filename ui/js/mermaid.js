const selector = ':is(.md, .chat-md) pre > code.language-mermaid';
const processed = new WeakSet();
const sources = new WeakMap();
// Zoom is relative to the diagram's natural width; no entry means fit to the panel.
const zooms = new WeakMap();
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
// Mermaid wraps flowchart labels at 120px, which stacks long labels into tall,
// narrow nodes; wider panels give each label a share of their width instead.
const WRAP_SHARE = 0.4;
const WRAP_MIN = 120;
const WRAP_MAX = 360;
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 16;
const COPIED_MS = 1500;
const COPY_LABEL = 'Copy diagram as PNG';
let library;
let queue = Promise.resolve();
let nextId = 0;
const darkPreference = matchMedia('(prefers-color-scheme: dark)');

const style = document.createElement('style');
style.textContent = `
  .orc-mermaid { margin: 0 0 16px; min-width: 0; max-width: 100%; }
  .orc-mermaid-frame { position: relative; }
  .orc-mermaid-tools {
    position: absolute; top: 6px; right: 6px; display: flex; gap: 2px; padding: 2px;
    border-radius: 6px; background: var(--panel);
  }
  .orc-mermaid-tools[hidden] { display: none; }
  .orc-mermaid-tools button {
    display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
    padding: 0; border: 0; border-radius: 5px; background: none; color: var(--muted-strong); cursor: var(--orc-cursor-pointer, pointer);
  }
  .orc-mermaid-tools button:hover:not(:disabled) { color: var(--text); background: var(--chip); }
  .orc-mermaid-tools button:disabled { opacity: 0.4; cursor: default; }
  .orc-mermaid-tools svg { width: 16px; height: 16px; }
  .orc-mermaid-graphic {
    overflow: auto; max-width: 100%; padding: 40px 16px 16px; box-sizing: border-box;
    border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
  }
  .orc-mermaid-graphic > svg {
    display: block; max-width: none; height: auto; margin: auto; -webkit-user-select: none; user-select: none;
  }
  .orc-mermaid-graphic > svg text { -webkit-user-select: text; user-select: text; }
  .orc-mermaid-source { margin-top: 8px; }
  .orc-mermaid-source::part(summary) { color: var(--muted-strong); font-size: 12px; }
  .orc-mermaid-source > pre { margin-top: 8px; }
  .orc-mermaid-error { color: var(--muted-strong); }
`;
document.head.append(style);

const ICON = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  zoomOut: ICON('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
  zoomIn: ICON('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>'),
  copy: ICON('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  copied: ICON('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

function theme() {
  return document.documentElement.dataset.theme || (darkPreference.matches ? 'dark' : 'light');
}

async function mermaid() {
  library ||= import('/vendor/orc-mermaid.min.js').then(module => module.default).catch(error => {
    library = null;
    throw error;
  });
  return library;
}

async function draw(figure) {
  if (!figure.isConnected) return;
  const source = sources.get(figure);
  const graphic = figure.querySelector('.orc-mermaid-graphic');
  const details = figure.querySelector('orc-accordion');
  const currentTheme = theme();
  const staging = document.createElement('div');
  staging.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;inset:0 auto auto 0';
  document.body.append(staging);
  try {
    const renderer = await mermaid();
    renderer.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: currentTheme === 'dark' ? 'dark' : 'default',
      fontFamily: 'Inter, sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false, wrappingWidth: Math.round(Math.min(WRAP_MAX, Math.max(WRAP_MIN, graphic.clientWidth * WRAP_SHARE))) },
      secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'themeCSS', 'themeVariables', 'fontFamily'],
    });
    const { svg } = await renderer.render(`orc-mermaid-${++nextId}`, source, staging);
    if (!figure.isConnected) return;
    const settle = holdPlace(figure);
    graphic.innerHTML = svg;
    const image = graphic.querySelector('svg');
    image.setAttribute('role', 'img');
    spaceWrappedRows(image, source);
    if (!image.hasAttribute('aria-labelledby')) image.setAttribute('aria-label', 'Mermaid diagram');
    resize(figure);
    figure.querySelector('.orc-mermaid-tools').hidden = false;
    graphic.tabIndex = 0;
    graphic.setAttribute('role', 'region');
    graphic.setAttribute('aria-label', 'Diagram, scroll to explore');
    figure.querySelector('.orc-mermaid-error')?.remove();
    // The source stays open until the first drawing; after that it is the
    // reader's to open, and a theme redraw leaves it as they set it.
    if (!figure.dataset.theme) {
      // settle() measures straight after, so the fold cannot still be moving.
      details.setAttribute('no-motion', '');
      details.open = false;
      requestAnimationFrame(() => details.removeAttribute('no-motion'));
    }
    figure.dataset.theme = currentTheme;
    settle();
    if (currentTheme !== theme()) enqueue(figure);
  } catch {
    if (!figure.isConnected) return;
    if (!figure.querySelector('.orc-mermaid-error')) {
      const error = document.createElement('p');
      error.className = 'orc-mermaid-error';
      error.setAttribute('role', 'status');
      error.textContent = "Couldn't render this Mermaid diagram. The source is shown below.";
      figure.querySelector('.orc-mermaid-frame').before(error);
    }
    details.open = true;
  } finally {
    staging.remove();
  }
}

function scrollParent(element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

// Drawing changes a figure's height. When the figure starts above the
// reader's view, as it does on the way up a conversation, everything they are
// reading would jump by the difference. The returned function scrolls by
// however much the content grew, which is nothing in an engine whose scroll
// anchoring already held the place. WebKit has none.
function holdPlace(figure) {
  const scroller = scrollParent(figure);
  if (!scroller || figure.getBoundingClientRect().top >= scroller.getBoundingClientRect().top) return () => {};
  const height = scroller.scrollHeight;
  return () => { scroller.scrollTop += scroller.scrollHeight - height; };
}

// Mermaid draws each wrapped line of a label as its own positioned tspan with
// nothing between them, so a selection across lines copies the words joined.
// A word too long for the box is split mid-word, and its halves stay joined.
function spaceWrappedRows(image, source) {
  image.querySelectorAll('text').forEach(text => {
    const rows = [...text.children].filter(row => row.matches('tspan.row'));
    rows.slice(0, -1).forEach((row, index) => {
      const tail = row.textContent.trim().split(/\s+/).pop();
      const head = rows[index + 1].textContent.trim().split(/\s+/)[0];
      if (!source.includes(tail + head)) row.after(' ');
    });
  });
}

function naturalWidth(figure) {
  return figure.querySelector('.orc-mermaid-graphic > svg')?.viewBox.baseVal.width || 0;
}

function currentZoom(figure) {
  const image = figure.querySelector('.orc-mermaid-graphic > svg');
  return zooms.get(figure) ?? image.getBoundingClientRect().width / naturalWidth(figure);
}

function resize(figure) {
  const image = figure.querySelector('.orc-mermaid-graphic > svg');
  const width = naturalWidth(figure);
  if (!(width > 0)) return;
  const zoom = zooms.get(figure);
  if (zoom) {
    image.style.width = `${Math.ceil(width * zoom)}px`;
    image.style.maxWidth = 'none';
  } else {
    image.style.width = `${Math.ceil(width)}px`;
    image.style.maxWidth = `max(100%, ${Math.ceil(width * 0.75)}px)`;
  }
  const current = currentZoom(figure);
  figure.querySelector('[data-zoom="out"]').disabled = current <= ZOOM_MIN + 0.001;
  figure.querySelector('[data-zoom="in"]').disabled = current >= ZOOM_MAX - 0.001;
}

function zoom(figure, factor) {
  if (!(naturalWidth(figure) > 0)) return;
  const graphic = figure.querySelector('.orc-mermaid-graphic');
  const centerX = (graphic.scrollLeft + graphic.clientWidth / 2) / graphic.scrollWidth;
  const centerY = (graphic.scrollTop + graphic.clientHeight / 2) / graphic.scrollHeight;
  zooms.set(figure, Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, currentZoom(figure) * factor)));
  resize(figure);
  graphic.scrollLeft = centerX * graphic.scrollWidth - graphic.clientWidth / 2;
  graphic.scrollTop = centerY * graphic.scrollHeight - graphic.clientHeight / 2;
}

// An SVG drawn as an image cannot reach the page's web fonts, so Inter is
// inlined or the labels fall back to a wider face and clip their boxes.
async function inlineFont() {
  try {
    const response = await fetch('/fonts/inter-latin-wght-normal.woff2');
    if (!response.ok) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face { font-family: "Inter"; src: url(data:font/woff2;base64,${btoa(binary)}) format("woff2"); font-weight: 100 900; }`;
  } catch {
    return '';
  }
}

async function rasterize(figure) {
  const graphic = figure.querySelector('.orc-mermaid-graphic');
  const image = graphic.querySelector('svg');
  const { width, height } = image.viewBox.baseVal;
  const clone = image.cloneNode(true);
  clone.removeAttribute('style');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const font = await inlineFont();
  if (font) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = font;
    clone.prepend(style);
  }
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((width + EXPORT_PADDING * 2) * EXPORT_SCALE);
  canvas.height = Math.ceil((height + EXPORT_PADDING * 2) * EXPORT_SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = getComputedStyle(graphic).backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.drawImage(picture, EXPORT_PADDING, EXPORT_PADDING, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('empty image'))), 'image/png'));
}

async function copy(figure, button) {
  button.disabled = true;
  try {
    // Safari drops the click's permission to write while the PNG renders,
    // unless the clipboard write starts now and is handed the pending image.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': rasterize(figure) })]);
    button.innerHTML = ICONS.copied;
    button.title = 'Copied';
    setTimeout(() => {
      button.innerHTML = ICONS.copy;
      button.title = COPY_LABEL;
    }, COPIED_MS);
  } catch {
    button.title = "Couldn't copy this diagram";
  } finally {
    button.disabled = false;
  }
}

function toolbar(figure) {
  const tools = document.createElement('div');
  tools.className = 'orc-mermaid-tools';
  tools.hidden = true;
  const add = (label, icon, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    button.addEventListener('click', () => action(button));
    tools.append(button);
    return button;
  };
  add('Zoom out', ICONS.zoomOut, () => zoom(figure, 1 / ZOOM_STEP)).dataset.zoom = 'out';
  add('Zoom in', ICONS.zoomIn, () => zoom(figure, ZOOM_STEP)).dataset.zoom = 'in';
  add(COPY_LABEL, ICONS.copy, button => copy(figure, button));
  return tools;
}

function enqueue(figure) {
  queue = queue.then(() => draw(figure));
}

// Each drawing blocks the page for a moment, and a long conversation can hold
// dozens of diagrams. One is drawn when it first comes into view, so opening
// the conversation draws what is on screen and nothing above it.
const inView = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    inView.unobserve(entry.target);
    if (entry.target.dataset.theme !== theme()) enqueue(entry.target);
  }
});

function enhance(code) {
  const pre = code.parentElement;
  if (processed.has(pre) || code.closest('[contenteditable="true"], .orc-mermaid-source')) return;
  processed.add(pre);
  const figure = document.createElement('figure');
  figure.className = 'orc-mermaid';
  const frame = document.createElement('div');
  frame.className = 'orc-mermaid-frame';
  const graphic = document.createElement('div');
  graphic.className = 'orc-mermaid-graphic';
  frame.append(graphic, toolbar(figure));
  const details = document.createElement('orc-accordion');
  details.className = 'orc-mermaid-source';
  details.setAttribute('label', 'Diagram source');
  details.setAttribute('open', '');
  sources.set(figure, code.textContent);
  pre.replaceWith(figure);
  details.append(pre);
  figure.append(frame, details);
  inView.observe(figure);
}

function scan(root) {
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.matches?.(selector)) enhance(root);
  root.querySelectorAll(selector).forEach(enhance);
}

function redraw() {
  document.querySelectorAll('.orc-mermaid').forEach(figure => {
    if (sources.has(figure) && figure.dataset.theme && figure.dataset.theme !== theme()) inView.observe(figure);
  });
}

scan(document);
new MutationObserver(records => {
  for (const record of records) record.addedNodes.forEach(scan);
}).observe(document.body, { childList: true, subtree: true });
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
darkPreference.addEventListener('change', redraw);
