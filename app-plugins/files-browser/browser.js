import { needsTextPreview, renderTextPreview } from '/js/text-preview.js';
import { $, esc, externalizeLinks, showToast } from '/js/core.js';
import { stripFrontMatter } from '/js/diff.js';
import { outsideMarkdownHtml } from '/js/user-markdown.js';

const FOLDER_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const FILE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
const CHEVRON_ICON = '<svg class="files-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const MARKDOWN_PREVIEW_KEY = 'orcFilesMarkdownPreview';
const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;

function filePreviewLinesHtml(text, escape, target = null) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, index) => (target && index + 1 >= target.start && index + 1 <= target.end
    ? `<span class="file-line file-line-target" aria-current="true">${escape(line)}</span>`
    : `<span class="file-line">${escape(line)}</span>`)).join('');
}

const filePreviewMarkdownHtml = text => outsideMarkdownHtml(stripFrontMatter(text));

export function mountBrowser({ signal, actions, execute }) {
  const view = $('run-panel-files');
  const body = $('run-files-body');
  const search = $('run-files-search');
  const searchToggle = $('run-files-search-toggle');
  const crumb = $('run-files-crumb');
  const previewToggle = $('run-files-preview');
  const remoteLink = $('run-files-remote');
  const states = new Map();
  let runId = null;
  let checkout = '';
  let searchTimer = 0;
  let paintSeq = 0;
  let remoteSeq = 0;
  let shownRemote = null;

  function stateOf(id) {
    if (!states.has(id)) states.set(id, { open: new Set(), file: null, query: '', listings: new Map(), remotes: new Map(), root: '' });
    return states.get(id);
  }
  const apiUrl = (id, kind, params) =>
    `/api/runs/${encodeURIComponent(id)}/${kind}?${new URLSearchParams(params)}`;

  async function fetchJson(url) {
    const response = await fetch(url).catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    if (!response?.ok || !data) throw new Error(data?.error || "Couldn't reach Orc.");
    return data;
  }

  function note(text, retry = false) {
    return `<div class="run-diff-note" role="status"><p>${esc(text)}</p>` +
      (retry ? '<button type="button" data-files-retry>Try again</button>' : '') + '</div>';
  }

  async function listing(id, state, path) {
    if (state.listings.has(path)) return state.listings.get(path);
    const data = await fetchJson(apiUrl(id, 'files', { path }));
    state.root = data.root || state.root;
    state.listings.set(path, data);
    return data;
  }

  function entryHtml(entry, depth, state) {
    const pad = `style="--files-depth:${depth}"`;
    if (entry.kind === 'directory') {
      const open = state.open.has(entry.path);
      return `<li><button type="button" class="files-row" ${pad} data-dir="${esc(entry.path)}" aria-expanded="${open}">` +
        `${CHEVRON_ICON}${FOLDER_ICON}<span>${esc(entry.name)}</span></button>` +
        (open ? `<ul class="files-tree" data-children="${esc(entry.path)}"></ul>` : '') + '</li>';
    }
    return `<li><button type="button" class="files-row" ${pad} data-file="${esc(entry.path)}">` +
      `<span class="files-chevron-space"></span>${FILE_ICON}<span>${esc(entry.name)}</span></button></li>`;
  }

  async function paintDirectory(id, state, path, list, depth, seq) {
    let data;
    try { data = await listing(id, state, path); } catch (error) {
      if (seq !== paintSeq) return;
      if (!path) { body.innerHTML = note(`Couldn't list this run's files: ${error.message}`, true); return; }
      list.innerHTML = `<li class="files-error" style="--files-depth:${depth}">${esc(error.message)}</li>`;
      return;
    }
    if (seq !== paintSeq) return;
    if (!path) crumb.textContent = state.root;
    if (!data.entries.length) {
      list.innerHTML = `<li class="files-empty" style="--files-depth:${depth}">${path ? 'Empty folder' : 'No files'}</li>`;
      return;
    }
    list.innerHTML = data.entries.map(entry => entryHtml(entry, depth, state)).join('') +
      (data.truncated ? `<li class="files-empty" style="--files-depth:${depth}">Only the first ${data.entries.length} entries are shown</li>` : '');
    await Promise.all([...list.querySelectorAll(':scope > li > ul[data-children]')].map(child =>
      paintDirectory(id, state, child.dataset.children, child, depth + 1, seq)));
  }

  async function paintTree(id, state) {
    const seq = ++paintSeq;
    const scrollTop = body.scrollTop;
    const list = document.createElement('ul');
    list.className = 'files-tree';
    list.setAttribute('aria-label', 'Files');
    if (!state.listings.has('')) body.innerHTML = note('Loading files…');
    await paintDirectory(id, state, '', list, 0, seq);
    if (seq !== paintSeq || body.querySelector('[data-files-retry]')) return;
    body.replaceChildren(list);
    body.scrollTop = scrollTop;
  }

  async function paintSearch(id, state) {
    const seq = ++paintSeq;
    crumb.textContent = state.root;
    let data;
    try { data = await fetchJson(apiUrl(id, 'files', { q: state.query })); } catch (error) {
      if (seq === paintSeq) body.innerHTML = note(`Couldn't search this run's files: ${error.message}`, true);
      return;
    }
    if (seq !== paintSeq) return;
    if (!data.entries.length) { body.innerHTML = note(`No files match “${state.query}”.`); return; }
    body.innerHTML = `<ul class="files-tree files-results" aria-label="Matching files">` +
      data.entries.map(entry => `<li><button type="button" class="files-row" data-file="${esc(entry.path)}">` +
        `${FILE_ICON}<span>${esc(entry.name)}</span><span class="files-dir">${esc(entry.path.slice(0, -entry.name.length).replace(/\/$/, ''))}</span></button></li>`).join('') +
      (data.truncated ? `<li class="files-empty">Only the first ${data.entries.length} matches are shown</li>` : '') + '</ul>';
    body.scrollTop = 0;
  }

  // The crumb runs right to left so a long path loses its start, which would
  // carry an absolute path's leading slash to the end. A left-to-right mark
  // keeps it in front.
  const crumbText = path => path.startsWith('/') ? `\u200E${path}` : path;

  async function paintFile(id, state) {
    const seq = ++paintSeq;
    const path = state.file;
    crumb.textContent = crumbText(path);
    body.innerHTML = note('Loading file…');
    let data;
    try { data = await fetchJson(apiUrl(id, 'file', { path })); } catch (error) {
      if (seq === paintSeq) body.innerHTML = note(`Couldn't open ${path}: ${error.message}`, true);
      return;
    }
    if (seq !== paintSeq) return;
    // An absolute path inside the checkout comes back checkout-relative, so
    // Back and Open in find it.
    state.file = data.path;
    crumb.textContent = crumbText(data.path);
    state.outside = !!data.outside;
    setOpenDisabled(!!data.outside);
    paintRemote(id, state, data.outside ? null : data.path);
    if (data.image) {
      body.innerHTML = note('Loading image…');
      const image = new Image();
      image.alt = data.path;
      image.className = 'file-image';
      image.onload = () => {
        if (seq !== paintSeq) return;
        const preview = document.createElement('div');
        preview.className = 'file-image-preview';
        preview.append(image);
        body.replaceChildren(preview);
        body.scrollTop = 0;
      };
      image.onerror = () => {
        if (seq === paintSeq) body.innerHTML = note(`Couldn't preview ${data.path}. The image may be damaged or unsupported by this browser.`, true);
      };
      image.src = data.image;
      return;
    }
    if (data.binary) { body.innerHTML = note('This is a binary file, so there is nothing to show as text.'); return; }
    if (needsTextPreview(data.text)) {
      previewToggle.hidden = true;
      renderTextPreview(body, data.text, {
        message: 'Large file shown as paged plain text.' +
          (data.truncated ? ' Showing the first 1 MB of this file.' : ''),
        label: data.path,
      });
      return;
    }
    const markdown = MARKDOWN_FILE.test(data.path);
    previewToggle.hidden = !markdown;
    const rendered = markdown && markdownPreviewOn() ? filePreviewMarkdownHtml(data.text) : null;
    body.innerHTML = (data.truncated ? '<p class="files-truncated" role="status">Showing the first 1 MB of this file.</p>' : '') +
      (rendered !== null
        ? `<article class="md file-markdown" tabindex="0" aria-label="${esc(data.path)}">${rendered}</article>`
        : `<pre class="file-preview" tabindex="0" aria-label="${esc(data.path)}"><code>${filePreviewLinesHtml(data.text, esc, state.lines)}</code></pre>`);
    if (rendered !== null) {
      externalizeLinks(body);
      window.orcUpgradeCallouts?.(body);
      window.orcMountCodeCopy?.(body);
    }
    body.scrollTop = 0;
    body.querySelector('.file-line-target')?.scrollIntoView({ block: 'center' });
  }

  function markdownPreviewOn() {
    try { return localStorage.getItem(MARKDOWN_PREVIEW_KEY) !== 'source'; } catch { return true; }
  }
  function paintPreviewToggle() {
    previewToggle.setAttribute('aria-pressed', String(markdownPreviewOn()));
  }

  function setOpenDisabled(disabled) {
    $('run-files-open-go').disabled = disabled || !actions().length;
    $('run-files-action').disabled = disabled || !actions().length;
  }

  function paintActions() {
    const select = $('run-files-action');
    const selected = select.value;
    select.innerHTML = actions().map(action => `<option value="${esc(action.id)}">${esc(action.name)}</option>`).join('');
    select.value = actions().some(action => action.id === selected) ? selected : (actions()[0]?.id || '');
    select.hidden = actions().length < 2;
    $('run-files-open-go').textContent = actions().length === 1 ? actions()[0].name : 'Open';
    if (runId) setOpenDisabled(!checkout || !!stateOf(runId).outside);
  }
  paintActions();

  async function paintRemote(id, state, path) {
    const seq = ++remoteSeq;
    remoteLink.hidden = true;
    remoteLink.removeAttribute('href');
    shownRemote = null;
    if (path === null) return;
    if (!state.remotes.has(path)) {
      state.remotes.set(path, fetchJson(apiUrl(id, 'remote-url', { path })).catch(() => null));
    }
    const remote = await state.remotes.get(path);
    if (seq !== remoteSeq || !remote?.state) return;
    const branch = remote.ref === 'HEAD' ? 'the default branch' : remote.ref;
    shownRemote = { ...remote, branch, what: path ? 'the file' : 'the repository', path };
    if (remote.url) remoteLink.setAttribute('href', remote.url);
    remoteLink.setAttribute('label', remote.state === 'branch'
      ? `Open on GitHub (${remote.ref})`
      : remote.state === 'default'
        ? `Open on GitHub (not pushed, shows ${branch})`
        : 'Open on GitHub (not on GitHub)');
    remoteLink.hidden = false;
  }

  remoteLink.addEventListener('click', event => {
    const remote = shownRemote;
    if (!remote || remote.state === 'branch') return;
    if (remote.state === 'missing') {
      event.preventDefault();
      showToast(`${remote.path || 'This checkout'} isn't on GitHub: it isn't pushed, and ${remote.branch} doesn't have it.`);
      return;
    }
    if (!window.confirm(`The code isn't present on GitHub, so we'll show you ${remote.what} on ${remote.branch}.`)) {
      event.preventDefault();
    }
  });

  function setSearchOpen(open) {
    $('run-files-bar').classList.toggle('searching', open);
    search.hidden = !open;
    searchToggle.hidden = open;
    searchToggle.setAttribute('aria-expanded', String(open));
  }

  function paint() {
    setOpenDisabled(!checkout);
    previewToggle.hidden = true;
    const state = stateOf(runId);
    paintRemote(runId, state, checkout && !state.file ? '' : null);
    if (!checkout && !state.file) {
      ++paintSeq;
      view.classList.remove('showing-file');
      search.value = '';
      setSearchOpen(false);
      crumb.textContent = '';
      body.innerHTML = note('No checkout yet. Files will appear here when this run has a repository or worktree.');
      return;
    }
    view.classList.toggle('showing-file', !!state.file);
    if (search.value !== state.query) search.value = state.query;
    setSearchOpen(!!state.query || search.matches(':focus-within'));
    if (state.file) return paintFile(runId, state);
    if (state.query.trim()) return paintSearch(runId, state);
    return paintTree(runId, state);
  }

  const show = run => {
    const nextCheckout = run.meta?.worktree?.path || run.meta?.repoPath || run.meta?.mainRepoPath || '';
    if (run.id === runId && checkout === nextCheckout && view.dataset.shown === '1') return;
    checkout = nextCheckout;
    search.toggleAttribute('disabled', !checkout);
    searchToggle.disabled = !checkout;
    $('run-files-refresh').disabled = !checkout;
    runId = run.id;
    view.dataset.shown = '1';
    paint();
  };
  const hide = () => { ++paintSeq; view.dataset.shown = ''; };
  const open = (id, path, lines) => {
    stateOf(id).file = path;
    stateOf(id).lines = lines;
    if (id === runId && view.dataset.shown === '1') paint();
  };

  body.addEventListener('click', event => {
    if (!runId) return;
    const state = stateOf(runId);
    if (event.target.closest('[data-files-retry]')) {
      state.listings.clear();
      paint();
      return;
    }
    const dir = event.target.closest('[data-dir]');
    if (dir) {
      const path = dir.dataset.dir;
      if (state.open.has(path)) state.open.delete(path); else state.open.add(path);
      paintTree(runId, state).then(() => body.querySelector(`[data-dir="${CSS.escape(path)}"]`)?.focus());
      return;
    }
    const file = event.target.closest('[data-file]');
    if (file) {
      state.file = file.dataset.file;
      state.lines = null;
      paint();
      $('run-files-back').focus();
    }
  });

  $('run-files-back').addEventListener('click', () => {
    const state = stateOf(runId);
    const path = state.file;
    state.file = null;
    paint()?.then(() => body.querySelector(`[data-file="${CSS.escape(path)}"]`)?.focus());
  });

  previewToggle.addEventListener('click', () => {
    try { localStorage.setItem(MARKDOWN_PREVIEW_KEY, markdownPreviewOn() ? 'source' : 'preview'); } catch {}
    paintPreviewToggle();
    if (runId && stateOf(runId).file) paint();
  });
  paintPreviewToggle();

  $('run-files-refresh').addEventListener('click', () => {
    if (!runId) return;
    stateOf(runId).listings.clear();
    stateOf(runId).remotes.clear();
    paint();
  });

  $('run-files-open-go').addEventListener('click', () => {
    if (!runId || !checkout) return;
    const button = $('run-files-open-go');
    button.disabled = true;
    execute(runId, stateOf(runId).file || '', $('run-files-action').value)
      .catch(error => showToast(error.message)).finally(() => { if (!signal.aborted) setOpenDisabled(!checkout || !!stateOf(runId).outside); });
  });

  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!runId) return;
      const state = stateOf(runId);
      state.query = search.value.slice(0, 256);
      state.file = null;
      paint();
    }, 200);
  });
  searchToggle.addEventListener('click', () => {
    setSearchOpen(true);
    search.focus();
  });
  search.addEventListener('focusout', () => {
    if (!search.value) setSearchOpen(false);
  });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (!search.value) {
      setSearchOpen(false);
      searchToggle.focus();
      return;
    }
    search.value = '';
    search.dispatchEvent(new Event('input'));
  });
  signal.addEventListener('abort', () => { clearTimeout(searchTimer); ++paintSeq; ++remoteSeq; }, { once: true });
  return { show, hide, open, paintActions };
}
