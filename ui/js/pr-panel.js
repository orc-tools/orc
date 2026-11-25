// ---- side panel: Pull request ----
// Laid out like T3 Code's Pull request surface. T3 Code shows it only once a
// PR exists; Orc shows it as soon as the run has a PR body, editable until
// the PR opens. After that the view reads the PR from the host
// (ui/run_pull_request.py) and is read-only, because pr_body_edit_blocker
// refuses the save.

import { formatDuration } from './activity-model.js';
import { LINEAR_MARK_SVG } from './agent-marks.js';
import { chatTabAvailable, chatWorkingOn, fileReferenceLines, fileReferencePath } from './chat.js';
import { $, artifactUrl, esc, externalizeLinks, fileUrl, mediaSignature, prPushPending, resolveRelativeUrls } from './core.js';
import { PR_BODY_RE, prBodySlug } from './control.js';
import { resolvePrUrls } from './dialogs.js';
import { openRunFile } from './files-panel.js';
import { revealDiffPanel } from './diff-panel.js';
import { checksSectionHtml } from './run-checks.js';
import { agentWorking } from './run-presentation.js';

let prPanelShow = () => {};
export function showPrPanel(run) { prPanelShow(run); }
let prPanelRetire = () => {};
export function retirePrPanelUnlessRun(runId) { prPanelRetire(runId); }

const PR_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>';
const EXTERNAL_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
const CHEVRON_ICON = '<svg class="pr-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="M208,34H88A14,14,0,0,0,74,48V74H48A14,14,0,0,0,34,88V208a14,14,0,0,0,14,14H168a14,14,0,0,0,14-14V182h26a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM170,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V88a2,2,0,0,1,2-2H168a2,2,0,0,1,2,2Zm40-40a2,2,0,0,1-2,2H182V88a14,14,0,0,0-14-14H86V48a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Z"/></svg>';
// The eyes your team reacts with in Slack, as the mark on a person who has a PR.
const PICKED_UP_ICON = '<span class="pr-chip-mark" role="img" aria-label="Picked up">👀</span>';
const APPROVED_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="Approved" role="img"><path d="M20 6 9 17l-5-5"/></svg>';
// The same tick inside a chip whose text already says it passed.
const APPROVED_MARK = APPROVED_ICON.replace('aria-label="Approved" role="img"', 'aria-hidden="true"');
const ARROW_LEFT_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="receives changes from" role="img"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';

export function prBodyPaths(run) {
  return (run?.files || []).map(file => file.path)
    .filter(path => path === 'pr-body.md' || PR_BODY_RE.test(path))
    .sort((a, b) => (a === 'pr-body.md' ? -1 : b === 'pr-body.md' ? 1 : a.localeCompare(b)));
}

export function prPanelAvailable(run) {
  return prBodyPaths(run).length > 0 || resolvePrUrls(run?.meta).urls.length > 0;
}

const PR_BODY_LOCKED_STATUSES = ['merged', 'merged-to-parent', 'cancelled'];

// Mirrors the server's authoritative pr_body_edit_blocker only to decide what
// to draw; the save itself is what the server refuses.
export function prBodyEditable(run) {
  const meta = run.meta || {};
  // Only a recorded PR locks the body, as on the server.
  return resolvePrUrls(meta, { observed: false }).urls.length === 0
    && meta.source !== 'pr'
    && !prPushPending(meta)
    && !PR_BODY_LOCKED_STATUSES.includes(meta.status);
}

// BEGIN TESTABLE: pull request presentation
const PR_STATE_LABELS = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };

// Before the PR exists, diff.patch is the only source of the counts.

function copyMarkdownButton(className, value) {
  return `<orc-copy-button class="${className}" variant="ghost" size="compact" value="${esc(value)}" aria-label="Copy markdown" title="Copy markdown">${COPY_ICON}</orc-copy-button>`;
}

function bodyBarHtml(title, value, saveStatus = false) {
  return `<div class="pr-body-bar"><h3 class="pr-body-title">${esc(title)}</h3>` +
    (saveStatus ? '<span class="pr-body-save" role="status" aria-live="polite"></span>' : '') +
    `${copyMarkdownButton('pr-copy', value)}</div>`;
}
function prDiffStat(patch) {
  let files = 0, additions = 0, deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { files, additions, deletions };
}

// A private repository's attachments only load for a signed-in github.com
// session, so the server reads them with gh's token instead.
const GITHUB_ASSET_URL_RE = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]{36}$/;
const GITHUB_ASSET_SRC_RE = /(<img\b[^>]*?\bsrc=")(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]{36})"/g;
const RAW_HTML_IMG_RE = /^<img\b([^>]*)\/?>$/i;
const HTML_ATTR_RE = /\b([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

export function safeWebUrl(url) {
  const value = String(url || '').trim();
  if (!value || CONTROL_CHAR_RE.test(value)) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : '';
  } catch {
    return '';
  }
}

export function safePrHref(url, { allowRelative = false } = {}) {
  const value = String(url || '').trim();
  if (!value || CONTROL_CHAR_RE.test(value)) return '';
  if (allowRelative && !value.startsWith('//') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:' ? value : '';
  } catch {
    return '';
  }
}

const STATIC_IMAGE_PATH_RE = /^\/(?!\/)(?!api\/)[^\s?#]+\.(?:png|jpe?g|gif|webp|avif|apng|bmp)(?:[?#].*)?$/i;

export function safePrImageSrc(url, { allowRelative = false } = {}) {
  const value = String(url || '').trim();
  if (!value || CONTROL_CHAR_RE.test(value)) return '';
  if (allowRelative && !value.startsWith('//') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return value;
  }
  if (!value.includes('..') && STATIC_IMAGE_PATH_RE.test(value)) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function proxyAssetUrl(src, runId, prUrl) {
  if (!runId || !prUrl || !GITHUB_ASSET_URL_RE.test(src)) return src;
  return `/api/runs/${encodeURIComponent(runId)}/pull-request/asset?${new URLSearchParams({ url: prUrl, src }).toString()}`;
}

export function proxyPrAssets(html, runId, prUrl) {
  return html.replace(GITHUB_ASSET_SRC_RE, (_, head, src) =>
    `${head}${esc(proxyAssetUrl(src, runId, prUrl))}"`);
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

// GitHub drag-and-drop uploads insert raw <img> tags into PR bodies. Keep only
// a clean <img> pointing at a GitHub attachment URL and drop every other tag
// and attribute so inline scripts and event handlers can never run.
function safeGithubAttachmentImg(rawHtml, runId, prUrl) {
  const match = RAW_HTML_IMG_RE.exec(String(rawHtml || '').trim());
  if (!match) return '';
  let src = '';
  let alt = '';
  for (const attr of match[1].matchAll(HTML_ATTR_RE)) {
    const name = attr[1].toLowerCase();
    const value = decodeHtmlAttr(attr[2] ?? attr[3] ?? attr[4] ?? '');
    if (name === 'src') src = value.trim();
    else if (name === 'alt') alt = value;
  }
  if (!GITHUB_ASSET_URL_RE.test(src)) return '';
  return `<img src="${esc(proxyAssetUrl(src, runId, prUrl))}" alt="${esc(alt)}">`;
}

const prMarkdownParsers = new Map();

export function renderPrMarkdown(text, { runId = '', prUrl = '', allowRelative = false } = {}) {
  const source = String(text ?? '');
  const lib = globalThis.marked;
  if (!lib?.Marked) return `<pre>${esc(source)}</pre>`;
  const key = `${allowRelative ? '1' : '0'}|${runId}|${prUrl}`;
  let parser = prMarkdownParsers.get(key);
  if (!parser) {
    if (prMarkdownParsers.size >= 32) prMarkdownParsers.clear();
    parser = new lib.Marked({
      gfm: true,
      renderer: {
        html(token) {
          return safeGithubAttachmentImg(token.raw ?? token.text, runId, prUrl);
        },
        link(token) {
          const label = this.parser.parseInline(token.tokens);
          const href = safePrHref(token.href, { allowRelative });
          if (!href) return label;
          const title = token.title ? ` title="${esc(token.title)}"` : '';
          return `<a href="${esc(href)}"${title}>${label}</a>`;
        },
        image(token) {
          const alt = String(token.text || '');
          const src = safePrImageSrc(token.href, { allowRelative });
          if (!src) return esc(alt);
          const resolved = proxyAssetUrl(src, runId, prUrl);
          const title = token.title ? ` title="${esc(token.title)}"` : '';
          return `<img src="${esc(resolved)}" alt="${esc(alt)}"${title}>`;
        },
      },
    });
    prMarkdownParsers.set(key, parser);
  }
  return parser.parse(source);
}

// END TESTABLE: pull request presentation

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const DISALLOWED_MD_ELEMENTS = 'script, iframe, object, embed, svg, math, style, link, meta, base, form, template, noscript';

function sanitizePrDom(root, { allowRelative = false } = {}) {
  root.querySelectorAll(DISALLOWED_MD_ELEMENTS).forEach(node => node.remove());
  root.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        node.removeAttribute(attr.name);
      } else if (name === 'href' && !safePrHref(attr.value, { allowRelative })) {
        node.removeAttribute(attr.name);
      } else if (name === 'src' && !safePrImageSrc(attr.value, { allowRelative }) && !attr.value.startsWith('/api/runs/')) {
        node.removeAttribute(attr.name);
      }
    }
  });
}

function bindFileReferences(root, runId, { editable = false, signal } = {}) {
  const decorate = () => {
    root.querySelectorAll('code').forEach(code => {
      const path = !code.closest('pre, a') && fileReferencePath(code.textContent);
      if (path) {
        if (code.dataset.fileReference === path) return;
        code.dataset.fileReference = path;
        code.setAttribute('role', 'link');
        code.setAttribute('tabindex', '0');
        code.setAttribute('title', 'Open in Files');
        code.setAttribute('contenteditable', 'false');
      } else if (code.hasAttribute('data-file-reference')) {
        for (const name of ['data-file-reference', 'role', 'tabindex', 'title', 'contenteditable']) code.removeAttribute(name);
      }
    });
  };
  const activate = event => {
    if (event.type === 'keydown' && event.key !== 'Enter') return;
    const target = event.type === 'keydown' ? document.activeElement : event.target;
    const code = target?.closest('[data-file-reference]');
    if (!code || !root.contains(code)) return;
    const path = fileReferencePath(code.textContent);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    openRunFile(runId, path, fileReferenceLines(code.textContent));
    revealDiffPanel('files');
  };
  root.addEventListener('click', activate, { capture: true, signal });
  root.addEventListener('keydown', activate, { capture: true, signal });
  if (!editable) decorate();
}

async function savePrBody(runId, key, text) {
  const response = await fetch(`/runs/${encodeURIComponent(runId)}/pr-body`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: key, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'save failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

// The editor's stylesheet loads with the first editor, not with the page.
// Crepe's toolbar and menus sit in the page flow under the text until it
// applies, so the editor mounts only once this settles.
let editorStyles = null;
function ensureEditorStyles() {
  editorStyles ??= new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.id = 'orc-editor-styles';
    link.rel = 'stylesheet';
    link.href = '/vendor/orc-editor.min.css';
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', () => {
      link.remove();
      editorStyles = null;
      reject(new Error('editor stylesheet failed to load'));
    }, { once: true });
    document.head.append(link);
  });
  return editorStyles;
}

function retryPrImages(container, signal) {
  const attempts = new WeakMap();
  const timers = new Set();
  signal.addEventListener('abort', () => {
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  }, { once: true });
  container.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const source = image.getAttribute('src');
    if (!source) return;
    const url = new URL(source, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/runs/')) return;
    const previous = attempts.get(image);
    const count = previous?.source === source ? previous.count : 0;
    if (count >= 3) return;
    const next = new URL(url);
    next.searchParams.set('orc-image-retry', String(count + 1));
    const retrySource = next.pathname + next.search + next.hash;
    attempts.set(image, { source: retrySource, count: count + 1 });
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (image.isConnected && image.getAttribute('src') === source) {
        image.setAttribute('src', retrySource);
      }
    }, 500 * 2 ** count);
    timers.add(timer);
  }, { capture: true, signal });
}

const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;

// Crepe reads a pipe table with no blank line above it as more of the list
// item or sentence before it, so the rows show as one line of pipes.
function separateGluedTables(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let fence = null;
  lines.forEach((line, index) => {
    const marker = line.match(FENCE_LINE)?.[1];
    if (marker && (fence === null || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence === null ? marker : null;
    } else if (fence === null && index > 0 && lines[index - 1].trim() && line.includes('|')
        && lines[index + 1]?.includes('|') && TABLE_DELIMITER_ROW.test(lines[index + 1])
        && !lines[index - 1].includes('|')) {
      out.push('');
    }
    out.push(line);
  });
  return out.join('\n');
}

// A write can outlive its editor. Keep only unsettled writes here so a
// remount sees the latest draft and queues its updates behind earlier writes.
const pendingPrBodySaves = new Map();
const prBodySaveKey = (runId, path) => JSON.stringify([runId, path]);
// A failed write belongs to the user's draft even after its editor closes.
// Keep the text in this tab if browser storage is full or unavailable.
const unstoredPrDrafts = new Map();
function failedPrDraft(key) {
  if (unstoredPrDrafts.has(key)) return unstoredPrDrafts.get(key);
  try { return JSON.parse(sessionStorage.getItem('orc-pr-draft:' + key)); } catch { return null; }
}
function rememberPrDraft(key, draft) {
  try {
    if (draft) sessionStorage.setItem('orc-pr-draft:' + key, JSON.stringify(draft));
    else sessionStorage.removeItem('orc-pr-draft:' + key);
    unstoredPrDrafts.delete(key);
  } catch {
    if (draft) unstoredPrDrafts.set(key, draft);
    else unstoredPrDrafts.delete(key);
  }
}

function newPrBodySave(runId, path, text, size, onChange) {
  const key = prBodySaveKey(runId, path);
  const draft = failedPrDraft(key);
  const save = { runId, text: draft?.text ?? text, size, savedText: text, message: draft?.message ?? '',
    locked: false, request: null, updateEditor: null, write };

  function notify() {
    save.updateEditor?.();
    onChange(runId);
  }

  function write(text) {
    if (save.locked) return;
    save.text = text;
    save.message = 'Saving…';
    const request = (save.request || Promise.resolve()).then(async () => {
      if (save.locked) return;
      try {
        const data = await savePrBody(runId, path, text);
        save.size = data.size;
        save.savedText = text;
        if (save.request === request) save.message = 'Saved';
      } catch (error) {
        if (error.status === 409) save.locked = true;
        if (save.locked || save.request === request) save.message = `Save failed: ${error.message}`;
      }
    }).finally(() => {
      if (save.request !== request) return;
      save.request = null;
      rememberPrDraft(key, save.message.startsWith('Save failed') ? { text: save.text, message: save.message } : null);
      pendingPrBodySaves.delete(key);
      notify();
    });
    save.request = request;
    pendingPrBodySaves.set(key, save);
    notify();
    return request;
  }

  return save;
}

function mountPrBodyEditor(host, runId, key, save, updateDelivery) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let crepeEditor = null;
  let saveTimer = null;

  host.innerHTML = bodyBarHtml(host.dataset.title, save.savedText, true) + '<div class="pr-body-editor md-editor" aria-busy="true"></div>';
  const mountPoint = host.querySelector('.pr-body-editor');
  const status = host.querySelector('.pr-body-save');
  const copy = host.querySelector('.pr-copy');
  const saveMessage = () => saveTimer !== null && !save.locked ? 'Unsaved changes' : save.message;
  const pending = () => saveTimer !== null || !!save.request || save.message.startsWith('Save failed');
  const updateEditor = () => {
    const message = saveMessage();
    status.textContent = message;
    status.toggleAttribute('data-failed', message.startsWith('Save failed'));
    copy.setAttribute('value', save.savedText);
  };
  const flushSave = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (save.locked) return;
    let text;
    try {
      text = crepeEditor ? crepeEditor.getMarkdown() : mountPoint.querySelector('textarea').value;
    } catch (error) {
      save.message = `Save failed: ${error.message}`;
      save.updateEditor?.();
      updateDelivery(runId);
      return;
    }
    return save.write(text);
  };
  const queueSave = () => {
    if (save.locked) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
    updateEditor();
    updateDelivery(runId);
  };
  save.updateEditor = updateEditor;
  updateEditor();
  retryPrImages(mountPoint, signal);

  const destroy = editor => {
    void editor.destroy().catch(error => console.warn('Could not destroy PR body editor', error));
  };

  async function mountRendered() {
    try {
      // Lazy: the editor bundle is by far the largest thing orc-ui serves.
      const [{ Crepe, fileReferencePlugin, htmlCommentPlugin, keepTightLists }] = await Promise.all([import('/vendor/orc-editor.min.js'), ensureEditorStyles()]);
      if (signal.aborted) return;
      // Resolve only the displayed URL so editing preserves authored paths.
      const images = { proxyDomURL: url => artifactUrl(url, runId, key) };
      const editor = new Crepe({
        root: mountPoint, defaultValue: separateGluedTables(save.text),
        featureConfigs: { [Crepe.Feature.ImageBlock]: images },
      });
      keepTightLists(editor.editor);
      editor.editor.use(fileReferencePlugin(fileReferencePath));
      editor.editor.use(htmlCommentPlugin());
      await editor.create();
      // Milkdown waits for creation inside destroy(), so a retired mount
      // cleans up here once it can be destroyed.
      if (signal.aborted) {
        destroy(editor);
        return;
      }
      crepeEditor = editor;
      const editable = mountPoint.querySelector('[contenteditable="true"]');
      if (editable) {
        editable.setAttribute('aria-label', 'PR body');
        bindFileReferences(editable, runId, { editable: true, signal });
        editable.addEventListener('input', queueSave, { signal });
      }
    } catch {
      if (signal.aborted) return;
      if (crepeEditor) destroy(crepeEditor);
      crepeEditor = null;
      mountPoint.innerHTML = '<p class="ticket-editor-fallback" role="alert">The rich editor could not load, so this is plain markdown.</p>' +
        '<textarea aria-label="PR body" rows="16"></textarea>';
      const area = mountPoint.querySelector('textarea');
      area.value = save.text;
      area.addEventListener('input', queueSave, { signal });
    }
    mountPoint.removeAttribute('aria-busy');
  }

  mountRendered();
  return {
    pending,
    dispose() {
      lifetime.abort();
      save.updateEditor = null;
      try {
        if (saveTimer !== null) flushSave();
      } finally {
        if (crepeEditor) destroy(crepeEditor);
        crepeEditor = null;
      }
    },
  };
}

const SLACK_POST_STATES = { waiting: 'Posted, no reaction yet', 'picked-up': 'Picked up', approved: 'Approved' };

(() => {
  const body = $('run-pr-body');
  let shownRun = null;
  let shownState = null;
  let paintedSignature = null;
  let bodyLoads = null;

  function retireEditors(state) {
    bodyLoads?.abort();
    bodyLoads = null;
    const editors = state.editors;
    state.editors = new Map();
    for (const entry of editors.values()) entry.handle?.dispose();
    return editors;
  }

  prPanelRetire = runId => {
    if (!shownState || shownRun?.id === runId) return;
    const state = shownState;
    shownRun = null;
    shownState = null;
    paintedSignature = null;
    state.loads.abort();
    retireEditors(state);
    body.replaceChildren();
  };

  function updateDelivery(runId) {
    if (shownRun?.id !== runId) return;
    const saving = [...shownState.editors.values()].some(entry => entry.handle?.pending())
      || [...pendingPrBodySaves.values()].some(save => save.runId === runId)
      || (prBodyEditable(shownRun) && prBodyPaths(shownRun).some(path => failedPrDraft(prBodySaveKey(runId, path))));
    const actions = body.querySelector('.pr-delivery');
    if (actions) actions.hidden = saving;
    const chatActions = document.querySelector('.chat-delivery iframe');
    if (chatActions?.getAttribute('src') === `/runs/${encodeURIComponent(runId)}/chat-delivery`) {
      chatActions.hidden = saving;
    }
  }

  function sectionHtml(state, id, title, inner, actions = '') {
    const open = !state.closed.has(id);
    return `<section class="pr-section" aria-label="${esc(title)}">
        <div class="pr-section-head">
          <button type="button" class="pr-section-toggle" data-section="${esc(id)}" aria-expanded="${open}">
            <span>${esc(title)}</span>${CHEVRON_ICON}</button>${actions}
        </div>
        <div class="pr-section-body" data-section-body="${esc(id)}"${open ? '' : ' hidden'}>${inner}</div>
      </section>`;
  }

  function headHtml(run, state, editable) {
    const meta = run.meta || {};
    const pr = state.detail;
    const prHref = pr ? safeWebUrl(pr.url) : '';
    const prNumber = pr && prHref
      ? `<a class="pr-number pr-tone-${esc(pr.state)}" href="${esc(prHref)}" target="_blank" rel="noopener" aria-label="Open pull request #${pr.number} on GitHub">#${pr.number}${EXTERNAL_ICON}</a>`
      : pr ? `<span class="pr-number pr-tone-${esc(pr.state)}">#${pr.number}</span>` : '';
    const ticket = meta.linearTicket;
    const ticketContent = ticket ? `${LINEAR_MARK_SVG}${esc(ticket.ref)}` : '';
    const ticketHref = ticket ? safeWebUrl(ticket.url) : '';
    const ticketCrumb = !ticket ? ''
      : ticketHref
        ? `<a class="pr-ticket" href="${esc(ticketHref)}" target="_blank" rel="noopener" aria-label="Open Linear ticket ${esc(ticket.ref)}">${ticketContent}</a>`
        : `<span class="pr-ticket" title="Linear ticket">${ticketContent}</span>`;
    const stateLabel = pr && PR_STATE_LABELS[pr.state];
    const badge = stateLabel
      ? `<span class="pr-state pr-tone-${esc(pr.state)}">${PR_ICON}<span class="pr-state-label">${esc(stateLabel)}</span></span>` : '';
    const crumb = prNumber + ticketCrumb + badge;
    const metaLine = pr ? ''
      : `<div class="pr-meta"><span>${editable ? 'The PR opens with this body. Edits save to the run as you type.' : 'This body is read-only now.'}</span></div>`;
    const stat = pr ? { files: pr.changedFiles, additions: pr.additions, deletions: pr.deletions } : state.stat;
    const head = pr ? pr.headBranch : meta.branch || '';
    const branches = pr
      ? `<code>${esc(pr.baseBranch)}</code>${ARROW_LEFT_ICON}<code>${esc(head)}</code>`
      : head ? `<code>${esc(head)}</code>` : '';
    const statHtml = stat
      ? `<button type="button" class="pr-stat" aria-controls="run-diff"><span class="sr-only">Open diff: </span>` +
        `<span class="pr-stat-files">${esc(plural(stat.files, 'file'))}</span> ` +
        `<span class="pr-add">+${stat.additions.toLocaleString()}</span> <span class="pr-del">−${stat.deletions.toLocaleString()}</span></button>`
      : '';
    return `<header class="pr-head">
        ${crumb ? `<div class="pr-crumb">${crumb}</div>` : ''}
        <h2 class="pr-title">${esc(pr?.title || meta.title || run.id)}</h2>
        ${metaLine}
        ${branches || statHtml ? `<div class="pr-branches"><span class="pr-branch-names">${branches}</span>${statHtml}</div>` : ''}
      </header>`;
  }

  // One person on the PR: a mark before the name once they have it, else the
  // name and what they are at.
  function personChip(name, outcome, mark) {
    return `<span class="pr-chip pr-reviewer" data-outcome="${esc(outcome)}">${mark}${esc(name)}</span>`;
  }

  function reviewerChip(reviewer) {
    const outcome = reviewer.outcome || 'requested';
    return outcome === 'approved'
      ? personChip(reviewer.login, outcome, APPROVED_ICON)
      : `<span class="pr-chip pr-reviewer" data-outcome="${esc(outcome)}">${esc(reviewer.login)} · ${esc(reviewer.outcome ? outcome.replace('_', ' ') : 'review requested')}</span>`;
  }

  // The Slack post's reactors marked like reviewers, then the post itself.
  // With nobody named, the post's chip says what state it is in instead.
  function slackHtml(post) {
    const mark = { approved: APPROVED_ICON, 'picked-up': PICKED_UP_ICON }[post.state];
    const people = mark ? (post.by || []).filter(Boolean) : [];
    const label = people.length ? `#${post.channel}` : `${SLACK_POST_STATES[post.state] || SLACK_POST_STATES.waiting} in #${post.channel}`;
    const href = safeWebUrl(post.permalink);
    const chip = href
      ? `<a class="pr-chip" data-outcome="${esc(post.state)}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`
      : `<span class="pr-chip" data-outcome="${esc(post.state)}">${esc(label)}</span>`;
    return people.map(name => personChip(name, post.state, mark)).join('') + chip;
  }

  // Zerohands' newest review of the PR (ui/zerohands_review.py): one chip
  // linking its Actions run, and while it runs, which reviewers still are.
  function zerohandsHtml(review) {
    const started = Date.parse(review.startedAt || '');
    const label = {
      queued: 'Queued',
      reviewing: Number.isNaN(started) ? 'Reviewing' : `Reviewing · ${formatDuration((Date.now() - started) / 1000)}`,
      passed: 'Looks good to merge',
      commented: review.comments ? `Left ${plural(review.comments, 'comment')}` : 'Left a review',
      failed: 'Review failed',
      done: 'Reviewed',
    }[review.state];
    if (!label) return '';
    const outcome = { queued: 'requested', reviewing: 'running', passed: 'approved', commented: 'changes_requested',
      failed: 'failed', done: 'requested' }[review.state];
    const mark = review.state === 'passed' ? APPROVED_MARK : '';
    const href = safeWebUrl(review.url);
    const chip = href
      ? `<a class="pr-chip pr-zerohands" data-outcome="${outcome}" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(label)}: open the Zerohands run on GitHub">${mark}${esc(label)}${EXTERNAL_ICON}</a>`
      : `<span class="pr-chip pr-zerohands" data-outcome="${outcome}">${mark}${esc(label)}</span>`;
    const running = review.state === 'reviewing' && Array.isArray(review.running) ? review.running.filter(Boolean) : [];
    const sub = running.length
      ? `<span class="pr-zerohands-running">${running.map(name => `<b>${esc(name)}</b> running`).join(' · ')}</span>`
      : '';
    return chip + sub;
  }

  // The checks the run's agent reported, above the description they back up.
  function verificationHtml(run, state) {
    state.verificationHtml = state.verification ? checksSectionHtml(run.id, state.verification,
      { open: state.verificationOpen, working: chatWorkingOn(run.id) ?? agentWorking(run.meta || {}) }) : '';
    return state.verificationHtml;
  }

  // The agent reports checks as it works, so every refresh of the panel asks
  // again. The section repaints alone: painting the panel remounts the editor.
  async function loadVerification(run, state) {
    if (state.verificationLoading) return;
    state.verificationLoading = true;
    const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/checks`, { cache: 'no-store', signal: state.loads.signal }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    state.verificationLoading = false;
    if (!data || shownState !== state) return;
    state.verification = data;
    const host = body.querySelector('.pr-verification-host');
    const was = state.verificationHtml;
    if (!host || verificationHtml(shownRun, state) === was) return;
    const held = host.contains(document.activeElement);
    host.innerHTML = state.verificationHtml;
    if (held) host.querySelector('.pr-verification-head')?.focus({ preventScroll: true });
  }

  function summaryHtml(run, state, paths, editable) {
    const pr = state.detail;
    let out = '';
    const verification = `<div class="pr-verification-host">${verificationHtml(run, state)}</div>`;
    if (pr) {
      const reviewers = pr.reviewers.length
        ? pr.reviewers.map(reviewerChip).join('')
        : '<span class="pr-none">None</span>';
      const post = (run.meta?.slackReviewPosts || []).find(item => item.prUrl === state.url);
      const slack = post
        ? `<dt>Slack</dt><dd>${slackHtml(post)}</dd>`
        : '';
      const labels = pr.labels.length
        ? pr.labels.map(label => `<span class="pr-chip">${esc(label)}</span>`).join('')
        : '<span class="pr-none">None</span>';
      const zerohandsChip = pr.zerohands ? zerohandsHtml(pr.zerohands) : '';
      const zerohands = zerohandsChip ? `<dt>Zerohands</dt><dd>${zerohandsChip}</dd>` : '';
      out += `<dl class="pr-meta-rows"><dt>Reviewers</dt><dd>${reviewers}</dd>${zerohands}${slack}<dt>Labels</dt><dd>${labels}</dd></dl>`;
      out += verification;
      out += `<section class="pr-description" aria-label="Description">
        <div class="pr-body-host">${bodyBarHtml('Description', pr.body)}
        <div class="md">${renderPrMarkdown(pr.body.trim() ? pr.body : '_No description provided._', { runId: run.id, prUrl: state.url })}</div></div></section>`;
      const checks = pr.checks.length
        ? `<ul class="pr-checks">${pr.checks.map(check => {
            const href = safeWebUrl(check.url);
            return `<li class="pr-check pr-check-${esc(check.outcome)}">` +
              `<span class="pr-check-outcome">${esc(check.outcome)}</span>` +
              (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(check.name)}</a>` : `<span>${esc(check.name)}</span>`) +
              '</li>';
          }).join('')}</ul>`
        : '<p class="pr-none">No checks reported.</p>';
      out += sectionHtml(state, 'checks', 'Checks', checks);
      return out;
    }
    if (state.error) out += `<p class="pr-error" role="status">Couldn't read the pull request: ${esc(state.error)}. <button type="button" data-pr-retry>Try again</button></p>`;
    out += verification;
    for (const path of paths) {
      const slug = path === 'pr-body.md' ? null : prBodySlug(path);
      const title = slug ? `Description (${slug})` : 'Description';
      out += `<section class="pr-description" aria-label="${esc(title)}">
        <div class="pr-body-host" data-body="${esc(path)}" data-title="${esc(title)}" aria-busy="true"></div></section>`;
    }
    return out;
  }

  async function loadBodies(run, state, paths, editable, previousEditors, signal) {
    for (const path of paths) {
      const host = body.querySelector(`.pr-body-host[data-body="${CSS.escape(path)}"]`);
      if (!host) continue;
      const pending = pendingPrBodySaves.get(prBodySaveKey(run.id, path));
      const previous = previousEditors.get(path)?.save;
      let save = editable ? pending ?? previous : null;
      let text = save?.text;
      const size = run.files.find(file => file.path === path)?.size ?? null;
      if (!save) {
        if (pending) await pending.request;
        if (signal.aborted) return;
        text = await fetch(fileUrl(run.id, path), { signal }).then(r => (r.ok ? r.text() : null)).catch(() => null);
      }
      if (signal.aborted) return;
      host.removeAttribute('aria-busy');
      if (text === null) { host.innerHTML = '<p class="pr-error" role="status">Couldn\'t load this body.</p>'; continue; }
      if (editable) {
        save ??= newPrBodySave(run.id, path, text, size, updateDelivery);
        const handle = mountPrBodyEditor(host, run.id, path, save, updateDelivery);
        state.editors.set(path, { media: mediaSignature(run), handle, save });
      } else {
        host.innerHTML = bodyBarHtml(host.dataset.title, text) +
          `<div class="md">${renderPrMarkdown(text, { allowRelative: true })}</div>`;
        const md = host.querySelector('.md');
        if (md) sanitizePrDom(md, { allowRelative: true });
        bindFileReferences(host, run.id);
        resolveRelativeUrls(host, run.id, path);
        externalizeLinks(host);
        state.editors.set(path, { size, media: mediaSignature(run) });
      }
      updateDelivery(run.id);
    }
  }

  async function loadStat(run, state) {
    const patch = run.files.find(file => file.path === 'diff.patch');
    const key = patch ? `${run.id}:${patch.size}` : null;
    if (key === state.statKey) return false;
    state.statKey = key;
    state.stat = null;
    if (!patch) return true;
    const text = await fetch(fileUrl(run.id, 'diff.patch'), { signal: state.loads.signal }).then(r => (r.ok ? r.text() : null)).catch(() => null);
    if (shownState !== state || state.statKey !== key) return false;
    state.stat = text === null ? null : prDiffStat(text);
    return true;
  }

  async function loadDetail(run, state, url, force = false) {
    if (!force && state.url === url && Date.now() - state.detailAt < 30_000) return false;
    state.url = url;
    state.detailAt = Date.now();
    const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/pull-request?${new URLSearchParams({ url })}`,
      { signal: state.loads.signal }).catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    if (shownState !== state || !resolvePrUrls(shownRun.meta).urls.includes(url) || state.url !== url) return false;
    if (response?.ok && data) { state.detail = data; state.error = null; }
    else { state.detail = null; state.error = data?.error || "Orc couldn't reach the host"; }
    return true;
  }

  function paint(run, state, paths, editable) {
    const scrollTop = body.scrollTop;
    const previousEditors = retireEditors(state);
    for (const [path, entry] of previousEditors) {
      if (editable && entry.handle?.pending()) previousEditors.set(path, { save: entry.save });
      else previousEditors.delete(path);
    }
    const content = summaryHtml(run, state, paths, editable);
    const ready = run.meta?.lifecycleVersion === 4 && run.meta.phase === 'ship'
      && run.meta.status === 'awaiting-gate' && paths.length > 0;
    if (!paths.length && !resolvePrUrls(run.meta).urls.length) {
      body.innerHTML = '<div class="run-diff-note" role="status"><p>No pull request yet. The draft will appear here when it is ready, followed by pull request details once published.</p></div>';
      return;
    }
    const actions = ready && !chatTabAvailable(run)
      ? `<iframe class="pr-delivery" title="Delivery actions" src="/runs/${encodeURIComponent(run.id)}/pr-delivery"></iframe>` : '';
    body.innerHTML = actions + headHtml(run, state, editable) + `<div class="pr-content">${content}</div>`;
    body.querySelectorAll('.pr-content .md').forEach(node => {
      sanitizePrDom(node, { allowRelative: false });
      bindFileReferences(node, run.id);
      externalizeLinks(node);
    });
    body.scrollTop = scrollTop;
    if (!state.detail) {
      bodyLoads = new AbortController();
      loadBodies(run, state, paths, editable, previousEditors, bodyLoads.signal);
    }
    updateDelivery(run.id);
  }

  // An editor keeps its text across polls; only a body rewritten from outside
  // (the agent regenerating it) while nobody is typing remounts it.
  function bodiesChangedOutside(run, state) {
    const media = mediaSignature(run);
    for (const [path, entry] of state.editors) {
      const size = run.files.find(file => file.path === path)?.size ?? null;
      if (size === (entry.save ? entry.save.size : entry.size) && media === entry.media) continue;
      if (entry.handle?.pending()) continue;
      return true;
    }
    return false;
  }

  prPanelShow = async run => {
    prPanelRetire(run.id);
    const state = shownState ??= { loads: new AbortController(), closed: new Set(['checks']), url: null,
      detail: null, detailAt: 0, error: null, stat: null, statKey: null, editors: new Map(),
      verification: null, verificationOpen: null, verificationHtml: '', verificationLoading: false };
    const paths = prBodyPaths(run);
    const urls = resolvePrUrls(run.meta).urls;
    const editable = prBodyEditable(run);
    // A review or a Slack reaction the host noticed is news the cached PR read lacks.
    const reviewKey = JSON.stringify([run.meta?.prReview?.state, (run.meta?.slackReviewPosts || []).map(post => post.state)]);
    if (state.reviewKey !== undefined && state.reviewKey !== reviewKey) state.detailAt = 0;
    state.reviewKey = reviewKey;
    const deliveryKey = JSON.stringify([
      run.meta?.shipAction || '',
      Boolean(run.meta?.mergeQueued),
      Boolean(run.meta?.mergeQueueConflict),
      Boolean(run.meta?.mergeCheckoutWait),
      run.meta?.mergeWaitingOn?.runId || '',
      Boolean(run.meta?.mergeConflict?.resolutionPending),
    ]);
    const deliveryChanged = state.deliveryKey !== undefined && state.deliveryKey !== deliveryKey;
    state.deliveryKey = deliveryKey;
    // Names behind a Slack reaction repaint the panel without a new PR read.
    const slackBy = (run.meta?.slackReviewPosts || []).map(post => post.by || []);
    const signature = JSON.stringify([run.id, paths, urls, editable, run.meta?.phase, run.meta?.status, reviewKey, slackBy]);
    const fresh = signature !== paintedSignature;
    shownRun = run;
    paintedSignature = signature;
    if (fresh) {
      paint(run, state, paths, editable);
    } else if (!state.detail && bodiesChangedOutside(run, state)) {
      paint(run, state, paths, editable);
    } else if (deliveryChanged) {
      body.querySelector('.pr-delivery')?.contentWindow?.location.reload();
    }
    updateDelivery(run.id);
    loadVerification(run, state);
    const statChanged = !urls.length && await loadStat(run, state);
    const detailChanged = urls.length > 0 && await loadDetail(run, state, urls[0]);
    if (shownState !== state || paintedSignature !== signature) return;
    if (detailChanged || (statChanged && !body.querySelector('.pr-body-editor, .pr-body-host[aria-busy]'))) {
      paint(run, state, paths, editable);
    } else if (statChanged) {
      const headEl = body.querySelector('.pr-head');
      if (headEl) headEl.outerHTML = headHtml(run, state, editable);
    }
  };

  body.addEventListener('click', event => {
    const state = shownState;
    if (!state) return;
    // The file count is the way to the diff those files are in.
    if (event.target.closest('.pr-stat')) {
      revealDiffPanel('diff', { scope: 'branch' });
      // The count leaves with the Pull request tab, so focus goes to the tab it opened.
      document.getElementById('run-panel-tab-diff').focus();
      return;
    }
    const toggle = event.target.closest('.pr-section-toggle, .pr-verification-head');
    if (toggle) {
      const id = toggle.dataset.section;
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      body.querySelector(`[data-section-body="${CSS.escape(id)}"]`).hidden = !open;
      if (id === 'verification') {
        state.verificationOpen = open;
        verificationHtml(shownRun, state);
      } else if (open) state.closed.delete(id);
      else state.closed.add(id);
      return;
    }
    if (event.target.closest('[data-pr-retry]')) {
      state.detailAt = 0;
      paintedSignature = null;
      prPanelShow(shownRun);
    }
  });

})();
