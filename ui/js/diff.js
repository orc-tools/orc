import { orcRegisterOverlayCloser } from './panel-navigation.js';
import { renderTextPreview } from './text-preview.js';
import { readSessionDraft, saveSessionDraft } from './session-draft.js';
// Diff and Markdown renderers shared by the artifact reader and side panels.


const COMMENT_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M142,128a10,10,0,1,1-10-10A10,10,0,0,1,142,128ZM88,118a10,10,0,1,0,10,10A10,10,0,0,0,88,118Zm88,0a10,10,0,1,0,10,10A10,10,0,0,0,176,118Zm54,6a98.11,98.11,0,0,1-98,98H48a14,14,0,0,1-14-14V124a98,98,0,0,1,196,0Zm-12,0a86,86,0,0,0-172,0v84a2,2,0,0,0,2,2h84A86.1,86.1,0,0,0,218,124Z"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M208,34H88A14,14,0,0,0,74,48V74H48A14,14,0,0,0,34,88V208a14,14,0,0,0,14,14H168a14,14,0,0,0,14-14V182h26a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM170,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V88a2,2,0,0,1,2-2H168a2,2,0,0,1,2,2Zm40-40a2,2,0,0,1-2,2H182V88a14,14,0,0,0-14-14H86V48a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Z"/></svg>';
const COPIED_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>';
import { mediaKind } from './chat-timeline.js';
import { mediaUrl } from './assets-panel.js';
import { clipPlayback, onClipChange, stopClips } from './clip-player.js';
import { $, announce, esc, fileUrl, runs, submitChord } from './core.js';
// ---------- Diff view (@pierre/diffs) ----------
// diff.patch is parsed and painted by @pierre/diffs, vendored as
// ui/vendor/orc-diffs.min.js and imported the first time the diff panel
// (diff-panel.js) opens. orc-ui keeps the panel's controls, the file sections
// with their header actions, and the review-comment surface; the library owns
// the rows, syntax highlighting, line selection and the gutter comment button.
// Comment composers ride on the library's line annotations, which it renders
// into light DOM, so they take the page's own styles.
let diffsModulePromise = null;
export function loadDiffsModule() {
  diffsModulePromise ??= import('/vendor/orc-diffs.min.js').then(mod => {
    diffsApi = mod;
    diffWarmWorkerPool(mod);
    return mod;
  }).catch(err => {
    diffsModulePromise = null;
    throw err;
  });
  return diffsModulePromise;
}

// BEGIN TESTABLE: file model
// The library keeps each line's own newline on it; the comment context and
// quotes join lines themselves.
function diffLineText(text) {
  return (text ?? '').replace(/\r?\n$/, '');
}

function diffBuildHunks(fileDiff) {
  return fileDiff.hunks.map(hunk => {
    const lines = [];
    let old = hunk.deletionStart, cur = hunk.additionStart;
    for (const part of hunk.hunkContent) {
      if (part.type === 'context') {
        for (let i = 0; i < part.lines; i++) {
          lines.push({ type: 'ctx', old: old++, new: cur++, text: diffLineText(fileDiff.deletionLines[part.deletionLineIndex + i]) });
        }
        continue;
      }
      for (let i = 0; i < part.deletions; i++) {
        lines.push({ type: 'del', old: old++, new: null, text: diffLineText(fileDiff.deletionLines[part.deletionLineIndex + i]) });
      }
      for (let i = 0; i < part.additions; i++) {
        lines.push({ type: 'add', old: null, new: cur++, text: diffLineText(fileDiff.additionLines[part.additionLineIndex + i]) });
      }
    }
    const specs = hunk.hunkSpecs || `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
    return { header: hunk.hunkContext ? `${specs} ${hunk.hunkContext}` : specs, lines };
  });
}

// The per-line model the header actions, comment context and range helpers
// read: {type: 'ctx'|'add'|'del', old, new, text} per hunk, rebuilt lazily
// from the library's hunkContent index runs so deferred and un-commented
// files never allocate per-line objects during initial render.
function diffFileModel(fileDiff) {
  let adds = 0, dels = 0;
  for (const hunk of fileDiff.hunks) {
    adds += hunk.additionLines;
    dels += hunk.deletionLines;
  }
  const status = fileDiff.type === 'new' ? 'added'
    : fileDiff.type === 'deleted' ? 'deleted'
    : fileDiff.type === 'rename-pure' || fileDiff.type === 'rename-changed' ? 'renamed'
    : 'modified';
  let builtHunks = null;
  return {
    fileDiff,
    newPath: fileDiff.name,
    oldPath: fileDiff.prevName ?? fileDiff.name,
    status,
    adds,
    dels,
    get hunks() {
      builtHunks ??= diffBuildHunks(fileDiff);
      return builtHunks;
    },
    view: null,
  };
}
// END TESTABLE: file model

// BEGIN TESTABLE: deferred files
// Files painted only on request, as GitHub does: lockfiles and minified
// bundles nobody reads line by line (T3 Code files the same names as
// generated), and files big enough that highlighting them stalls the panel.
// A long line alone never defers a file; the library leaves lines over 1,000
// characters unhighlighted by itself.
const DIFF_GENERATED = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Gemfile\.lock|Cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|Podfile\.lock|Package\.resolved|go\.sum)$|\.min\.(?:js|mjs|css)$|\.(?:js|css)\.map$/;
const DIFF_DEFER_LINES = 1500;
const DIFF_DEFER_CHARS = 256 * 1024;

function diffTrimmedLineLength(raw) {
  if (!raw) return 0;
  let len = raw.length;
  if (len > 0 && raw.charCodeAt(len - 1) === 10) {
    len--;
    if (len > 0 && raw.charCodeAt(len - 1) === 13) len--;
  }
  return len;
}

function diffDeferReason(file) {
  if (DIFF_GENERATED.test(file.newPath)) return 'generated';
  const fd = file.fileDiff;
  if (fd && Array.isArray(fd.hunks)) {
    let lines = 0;
    for (const hunk of fd.hunks) {
      for (const part of hunk.hunkContent) {
        lines += part.type === 'context' ? part.lines : part.deletions + part.additions;
      }
      if (lines > DIFF_DEFER_LINES) return 'large';
    }
    let chars = 0;
    for (const hunk of fd.hunks) {
      for (const part of hunk.hunkContent) {
        if (part.type === 'context') {
          for (let i = 0; i < part.lines; i++) chars += diffTrimmedLineLength(fd.deletionLines[part.deletionLineIndex + i]);
        } else {
          for (let i = 0; i < part.deletions; i++) chars += diffTrimmedLineLength(fd.deletionLines[part.deletionLineIndex + i]);
          for (let i = 0; i < part.additions; i++) chars += diffTrimmedLineLength(fd.additionLines[part.additionLineIndex + i]);
        }
        if (chars > DIFF_DEFER_CHARS) return 'large';
      }
    }
    return null;
  }
  let lines = 0, chars = 0;
  for (const hunk of file.hunks) {
    lines += hunk.lines.length;
    for (const line of hunk.lines) chars += line.text.length;
  }
  return lines > DIFF_DEFER_LINES || chars > DIFF_DEFER_CHARS ? 'large' : null;
}

// A patch cut at the byte limit ends mid-file: keep the files before the cut.
function diffCompleteFiles(text) {
  const last = text.lastIndexOf('\ndiff --git ');
  return last === -1 ? '' : text.slice(0, last + 1);
}

const DIFF_FAST_SCAN_MIN_CHARS = 64 * 1024;

function diffEnsureFileDiff(api, file) {
  if (file.fileDiff) return file.fileDiff;
  if (!file.rawPatch || !api?.parsePatchFiles) return null;
  // Omit cacheKeyPrefix so parsePatchFiles never stamps positional keys that
  // collide in WorkerPoolManager across separate patches or on-demand loads.
  for (const patch of api.parsePatchFiles(file.rawPatch)) {
    if (patch.files.length) {
      file.fileDiff = api.withBundledLanguage(patch.files[0]);
      file.rawPatch = null;
      return file.fileDiff;
    }
  }
  return null;
}

// Scans huge or generated `diff --git` sections without allocating per-line
// strings when the card will wait behind "Load diff"; full patch parsing runs
// on demand via diffEnsureFileDiff if the user loads or comments on the file.
function diffTryFastDeferredSection(text, start, end, loadedPaths) {
  const firstNl = text.indexOf('\n', start);
  if (firstNl === -1 || firstNl >= end) return null;
  const firstEnd = firstNl > start && text.charCodeAt(firstNl - 1) === 13 ? firstNl - 1 : firstNl;
  const headLine = text.slice(start, firstEnd);
  const headMatch = /^diff --git a\/([^\t\r\n"]+) b\/([^\t\r\n"]+)$/.exec(headLine);
  if (!headMatch) return null;
  let oldPath = headMatch[1];
  let newPath = headMatch[2];
  const generatedHint = DIFF_GENERATED.test(newPath);
  if (!generatedHint && end - start < DIFF_FAST_SCAN_MIN_CHARS) return null;

  let status = 'modified';
  let pos = firstNl + 1;
  let hunkStart = -1;
  while (pos < end) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1 || nl > end) nl = end;
    const lineEnd = nl > pos && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    if (text.charCodeAt(pos) === 64 && text.startsWith('@@ ', pos)) {
      hunkStart = pos;
      break;
    }
    const line = text.slice(pos, lineEnd);
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')
        || line.startsWith('copy from ') || line.startsWith('copy to ')) return null;
    if (line.startsWith('new file mode ')) status = 'added';
    else if (line.startsWith('deleted file mode ')) status = 'deleted';
    else if (line.startsWith('rename from ')) { status = 'renamed'; oldPath = line.slice(12); }
    else if (line.startsWith('rename to ')) { status = 'renamed'; newPath = line.slice(10); }
    else if (line.startsWith('--- ')) {
      if (line === '--- /dev/null') status = 'added';
      else if (line.startsWith('--- a/') && !line.includes('\t')) oldPath = line.slice(6);
      else if (line.startsWith('--- "')) return null;
    } else if (line.startsWith('+++ ')) {
      if (line === '+++ /dev/null') status = 'deleted';
      else if (line.startsWith('+++ b/') && !line.includes('\t')) newPath = line.slice(6);
      else if (line.startsWith('+++ "')) return null;
    }
    pos = nl + 1;
  }
  if (status === 'deleted') newPath = oldPath;
  else if (status === 'added') oldPath = newPath;
  if (hunkStart === -1 || loadedPaths?.has(newPath)) return null;

  let adds = 0, dels = 0, lines = 0, chars = 0;
  pos = hunkStart;
  while (pos < end) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1 || nl > end) nl = end;
    const lineEnd = nl > pos && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    if (lineEnd > pos) {
      const ch = text.charCodeAt(pos);
      if (ch === 43) { adds++; lines++; chars += lineEnd - pos - 1; }
      else if (ch === 45) { dels++; lines++; chars += lineEnd - pos - 1; }
      else if (ch === 32) { lines++; chars += lineEnd - pos - 1; }
      else if (ch === 64) { if (!text.startsWith('@@ ', pos)) return null; }
      else if (ch !== 92) return null;
    }
    pos = nl + 1;
  }
  if (lines === 0) return null;
  const defer = DIFF_GENERATED.test(newPath) ? 'generated'
    : (lines > DIFF_DEFER_LINES || chars > DIFF_DEFER_CHARS ? 'large' : null);
  if (!defer) return null;

  const rawPatch = text.slice(start, end);
  let builtHunks = null;
  const file = {
    fileDiff: null,
    rawPatch,
    hasHunks: true,
    newPath,
    oldPath: status === 'added' || status === 'deleted' ? newPath : oldPath,
    status,
    adds,
    dels,
    defer,
    get hunks() {
      if (!builtHunks) {
        const fd = diffEnsureFileDiff(diffsApi, file);
        builtHunks = fd ? diffBuildHunks(fd) : [];
      }
      return builtHunks;
    },
    view: null,
  };
  return file;
}

// What the panel's patch says in place of lines it left out (panel_patch in
// ui/run_diff.py): a binary file, or one whose hunks were too big to send.
// Both sit in the section's header, where no hunk line can pass for them. The
// header ends at the first hunk; the cap bounds the scan of a whole patch's
// encoded binary, which has none.
const DIFF_HEAD_CHARS = 256 * 1024;
const DIFF_OMITTED_LINE = /\nOrc-Omitted: bytes=(\d+) additions=(\d+) deletions=(\d+)(?=\n|$)/;

function diffSectionNote(text, start, end) {
  const capped = text.slice(start, Math.min(end, start + DIFF_HEAD_CHARS));
  const hunk = capped.indexOf('\n@@ ');
  const head = hunk === -1 ? capped : capped.slice(0, hunk + 1);
  const omitted = DIFF_OMITTED_LINE.exec(head);
  if (omitted) return { omitted: Number(omitted[1]), adds: Number(omitted[2]), dels: Number(omitted[3]) };
  return /\n(?:GIT binary patch|Binary files [^\n]*)(?:\n|$)/.test(head) ? { binary: true } : null;
}
// END TESTABLE: deferred files

function parseDiffPatch(api, text) {
  const files = [];
  const pushBatch = slice => {
    for (const patch of api.parsePatchFiles(slice)) {
      for (const fileDiff of patch.files) {
        const file = diffFileModel(api.withBundledLanguage(fileDiff));
        file.defer = diffDeferReason(file);
        files.push(file);
      }
    }
  };
  if (!text.startsWith('diff --git ')) {
    pushBatch(text);
    return files;
  }
  let pos = 0;
  let batchStart = -1;
  let batchEnd = 0;
  while (pos < text.length) {
    const next = text.indexOf('\ndiff --git ', pos);
    const end = next === -1 ? text.length : next + 1;
    const note = diffSectionNote(text, pos, end);
    const fast = note ? null : diffTryFastDeferredSection(text, pos, end, diffLoadedPaths);
    if (note || fast) {
      if (batchStart !== -1) {
        pushBatch(text.slice(batchStart, batchEnd));
        batchStart = -1;
      }
      if (fast) {
        files.push(fast);
      } else {
        // Parsed alone, so the note lands on this file and no other.
        const first = files.length;
        pushBatch(text.slice(pos, end).replace(DIFF_OMITTED_LINE, ''));
        for (const file of files.slice(first)) Object.assign(file, note);
      }
    } else {
      if (batchStart === -1) batchStart = pos;
      batchEnd = end;
    }
    pos = end;
  }
  if (batchStart !== -1) {
    pushBatch(batchStart === 0 && batchEnd === text.length ? text : text.slice(batchStart, batchEnd));
  }
  return files;
}

// splits "dir/sub/base.ext" into { dir: "dir/sub/", base: "base.ext" }
function diffPathParts(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? { dir: '', base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

// BEGIN TESTABLE: file header actions
// The copy-path button that sits beside the comment button in every file
// header's meta strip. Icon-only, so it carries the path in its accessible
// name.
function diffFileActionsHtml(file) {
  const path = file.newPath;
  return `<button type="button" class="diff-file-action diff-file-copy" data-path="${esc(path)}" ` +
    `aria-label="Copy path ${esc(path)}">${COPY_ICON}</button>`;
}
// END TESTABLE: file header actions

function diffFileContext(file) {
  return file.hunks.map(hunk => [hunk.header, ...hunk.lines.map(line => {
    const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
    return marker + line.text;
  })].join('\n')).join('\n').slice(0, 30_000);
}

function diffCommentContext(hunk, line, side) {
  const at = hunk.lines.indexOf(line);
  const nearby = hunk.lines.slice(Math.max(0, at - 2), at + 3)
    .filter(item => side === 'LEFT' ? item.old != null : item.new != null)
    .map(item => `${item.type === 'add' ? '+' : item.type === 'del' ? '-' : ' '}${item.text}`);
  return `${hunk.header}\n${nearby.join('\n')}`;
}

// The send-review payload names sides the GitHub way; the library names them
// by what they hold.
const DIFF_SIDE = { deletions: 'LEFT', additions: 'RIGHT' };
const DIFF_LIB_SIDE = { LEFT: 'deletions', RIGHT: 'additions' };

// every commentable line of a file, one entry per side it appears on; the
// diff context is attached only for the lines a comment actually lands on
function diffFileTargets(file) {
  if (file.targets) return file.targets;
  const targets = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.old != null) targets.push({ path: file.newPath, side: 'LEFT', line: line.old, hunk, ref: line });
      if (line.new != null) targets.push({ path: file.newPath, side: 'RIGHT', line: line.new, hunk, ref: line });
    }
  }
  file.targets = targets;
  return targets;
}

function diffWithContext(target) {
  return { path: target.path, side: target.side, line: target.line, context: diffCommentContext(target.hunk, target.ref, target.side) };
}

// label + <orc-chip> colour family; the label is what carries the meaning, the
// family only reinforces it
const DIFF_CHIP = { added: ['Added', 'green'], deleted: ['Deleted', 'red'], renamed: ['Renamed', 'accent'] };

// paths of files collapsed by the user, so re-rendering on a mode toggle or a
// grown patch doesn't spring every file back open; reset when the panel moves
// to another run (see renderDiffPanel).
let diffCollapsedPaths = new Set();
// paths of deferred files the user loaded, kept across repaints the same way
let diffLoadedPaths = new Set();
let diffReviewState = { runId: null, comments: [], body: '', open: false, anchor: null };
// The comment being written, kept with the review: { kind: 'line', targets,
// quote, text } or { kind: 'file', path, text }. A box the panel redraws or
// a run left behind keeps it; Cancel, Comment now, or starting another
// comment puts it away.
let diffWriting = null;
// A review's unsent words come back after a reload (ui/js/session-draft.js):
// its pending comments, its overall comment, and the comment being written.
const diffReviewDraftKey = runId => `orcDiffReview:${runId}`;
function diffSaveReview() {
  const { runId, comments, body, open } = diffReviewState;
  if (!runId) return;
  const writing = diffWriting?.text?.trim() ? diffWriting : null;
  saveSessionDraft(diffReviewDraftKey(runId), comments.length || body.trim() || writing
    ? { comments, body, open, ...(writing ? { writing } : {}) } : null);
}
function diffReadReview(runId) {
  const saved = readSessionDraft(diffReviewDraftKey(runId)) || {};
  diffWriting = saved.writing?.kind === 'line' || saved.writing?.kind === 'file' ? saved.writing : null;
  return {
    runId, anchor: null, open: saved.open === true,
    comments: Array.isArray(saved.comments) ? saved.comments : [],
    body: typeof saved.body === 'string' ? saved.body : '',
  };
}
function diffWrite(writing) {
  diffWriting = writing?.text ? writing : null;
  diffSaveReview();
}
// Opens the comment a reload put away on its lines or file again, once the
// patch is drawn. One on a file not drawn now waits for a later draw.
function diffReopenWriting(c) {
  const writing = diffWriting;
  if (!writing || diffComposer || c.querySelector('.diff-file-comment-composer')) return;
  if (writing.kind === 'line') {
    const file = diffActiveFiles.find(candidate => candidate.newPath === writing.targets?.[0]?.path);
    if (file?.view) diffOpenComposer(c, diffActiveFiles, file, writing.targets, writing.quote || '', writing.text);
    return;
  }
  const index = diffActiveFiles.findIndex(candidate => candidate.newPath === writing.path);
  if (index >= 0) c.querySelector(`.diff-file-comment[data-file-index="${index}"]`)?.click();
}
// the mounted @pierre/diffs instances, one per open file card
let diffViews = [];
let diffVirtualizer = null;
let diffWorkerPool = null;
let diffWorkerIdleTimer = null;
let diffActiveRunId = null;
// Where the whole patch downloads from: { url, name }.
let diffDownload = null;
// A few previews read their length up front; a diff full of them waits for
// play, so it never opens with a request per file holding the browser's few
// connections to the server.
const DIFF_MEDIA_EAGER = 6;
let diffMediaPreload = 'metadata';
let diffActiveFiles = [];
let diffActiveMode = 'unified';
let diffActiveWrap = false;
// the one open line-comment composer: { file, targets, quote, element }
let diffComposer = null;

const DIFF_WORKER_IDLE_MS = 60_000;
const DIFF_VIRTUAL_METRICS = { lineHeight: 20, hunkSeparatorHeight: 24, spacing: 8 };
// Shared between WorkerPoolManager and FileDiff options so areDiffRenderOptionsEqual
// matches worker cache entries on the first check.
const DIFF_HIGHLIGHT_OPTIONS = {
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
  lineDiffType: 'word-alt',
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
};

function diffCancelWorkerIdleTimer() {
  if (!diffWorkerIdleTimer) return;
  clearTimeout(diffWorkerIdleTimer);
  diffWorkerIdleTimer = null;
}

function diffScheduleWorkerIdleCleanup() {
  diffCancelWorkerIdleTimer();
  if (!diffWorkerPool) return;
  diffWorkerIdleTimer = setTimeout(() => {
    diffWorkerIdleTimer = null;
    if (diffViews.length > 0) return;
    try { diffWorkerPool?.terminate(); } catch (err) {}
    diffWorkerPool = null;
  }, DIFF_WORKER_IDLE_MS);
}

function diffGetWorkerPool(api = diffsApi) {
  diffCancelWorkerIdleTimer();
  if (diffWorkerPool) return diffWorkerPool;
  if (!api?.WorkerPoolManager || typeof Worker === 'undefined') return null;
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
  const poolSize = Math.max(2, Math.min(6, Math.floor(cores / 2)));
  try {
    diffWorkerPool = new api.WorkerPoolManager({
      workerFactory: () => new Worker('/vendor/orc-diffs-worker.min.js', { type: 'module' }),
      poolSize,
      totalASTLRUCacheSize: 240,
    }, DIFF_HIGHLIGHT_OPTIONS);
  } catch (err) {
    diffWorkerPool = null;
  }
  return diffWorkerPool;
}

function diffWarmWorkerPool(api) {
  diffGetWorkerPool(api)?.initialize().catch(() => {});
}

// BEGIN TESTABLE: content cache key
function diffHashUpdate(h, str) {
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h;
}

function diffEnsureCacheKey(file) {
  if (file.cacheKey?.startsWith('orc-diff:')) return file.cacheKey;
  const fd = file.fileDiff;
  if (!fd) return '';
  if (fd.cacheKey?.startsWith('orc-diff:')) {
    file.cacheKey = fd.cacheKey;
    return fd.cacheKey;
  }
  let h1 = 2166136261;
  let h2 = 2768478513;
  const mix = value => {
    const s = String(value ?? '');
    h1 = diffHashUpdate(h1, s);
    h2 = diffHashUpdate(h2 ^ s.length, s);
  };
  mix(fd.name); mix('\0');
  mix(fd.prevName); mix('\0');
  mix(fd.type); mix('\0');
  mix(fd.lang); mix('\0');
  mix(fd.isPartial ? 1 : 0); mix('\0');
  for (const hunk of fd.hunks) {
    mix(`${hunk.deletionStart},${hunk.deletionCount},${hunk.additionStart},${hunk.additionCount},${hunk.collapsedBefore},${hunk.noEOFCRAdditions ? 1 : 0},${hunk.noEOFCRDeletions ? 1 : 0}:`);
    mix(hunk.hunkSpecs); mix(':'); mix(hunk.hunkContext); mix(';');
    for (const part of hunk.hunkContent) {
      mix(part.type === 'context'
        ? `c${part.lines}@${part.deletionLineIndex},${part.additionLineIndex}`
        : `d${part.deletions}@${part.deletionLineIndex}+${part.additions}@${part.additionLineIndex}`);
    }
  }
  for (const line of fd.deletionLines) { h1 = diffHashUpdate(h1, line); h2 = diffHashUpdate(h2 ^ 1, line); }
  for (const line of fd.additionLines) { h1 = diffHashUpdate(h1, line); h2 = diffHashUpdate(h2 ^ 2, line); }
  const key = `orc-diff:${fd.name}:${fd.deletionLines.length}:${fd.additionLines.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
  fd.cacheKey = key;
  file.cacheKey = key;
  return key;
}
// END TESTABLE: content cache key

function diffFilesHaveSameContent(prevFile, nextFile) {
  if (prevFile.newPath !== nextFile.newPath
      || prevFile.oldPath !== nextFile.oldPath
      || prevFile.status !== nextFile.status
      || prevFile.adds !== nextFile.adds
      || prevFile.dels !== nextFile.dels
      || prevFile.defer !== nextFile.defer) return false;
  if (prevFile.rawPatch || nextFile.rawPatch) {
    return Boolean(prevFile.rawPatch && nextFile.rawPatch && prevFile.rawPatch === nextFile.rawPatch);
  }
  const a = prevFile.fileDiff, b = nextFile.fileDiff;
  if (!a || !b) return false;
  // A file drawn without lines is told apart by what the patch says of it.
  if (prevFile.omitted !== nextFile.omitted || prevFile.binary !== nextFile.binary
      || (nextFile.binary && (a.prevObjectId !== b.prevObjectId || a.newObjectId !== b.newObjectId))) return false;
  if (a.hunks.length !== b.hunks.length
      || a.deletionLines.length !== b.deletionLines.length
      || a.additionLines.length !== b.additionLines.length) return false;
  return diffEnsureCacheKey(prevFile) === diffEnsureCacheKey(nextFile);
}

function diffLineRange(comment) {
  if (comment.scope === 'file') return 'whole file';
  return comment.startLine === comment.endLine
    ? `line ${comment.startLine}`
    : `lines ${comment.startLine}–${comment.endLine}`;
}

function diffLineLabel(comment) {
  if (comment.scope === 'file') return `${comment.path} · whole file`;
  return `${comment.path} · ${comment.side} ${diffLineRange(comment)}`;
}

// TESTABLE: range/comment helpers. A range must stay on one file + side and
// every line between its endpoints must be visible in the current patch.
function diffSelectionRange(anchor, target, candidates) {
  if (!anchor || !target || anchor.path !== target.path || anchor.side !== target.side) return [];
  const lo = Math.min(+anchor.line, +target.line), hi = Math.max(+anchor.line, +target.line);
  const matching = candidates.filter(item => item.path === anchor.path && item.side === anchor.side && +item.line >= lo && +item.line <= hi)
    .sort((a, b) => +a.line - +b.line);
  if (matching.length !== hi - lo + 1) return [];
  return matching;
}

function diffCommentFromTargets(targets, body, quote) {
  if (!targets.length) return null;
  const ordered = targets.slice().sort((a, b) => +a.line - +b.line);
  const context = ordered.map(item => item.context).join('\n');
  const selected = (quote || '').trim().slice(0, 2000);
  return {
    path: ordered[0].path,
    side: ordered[0].side,
    startLine: +ordered[0].line,
    endLine: +ordered[ordered.length - 1].line,
    // the send-review payload has no quote field, so a text selection rides
    // along as a labelled preamble to the diff context the agent reads
    context: selected ? `Selected text:\n${selected}\n\n${context}` : context,
    quote: selected,
    body: body.trim(),
  };
}
// END TESTABLE: range/comment helpers

// TESTABLE: library range -> comment targets. The library reports a selection
// as {start, end, side, endSide} in its own side names; a range that crosses
// sides has no single anchor, and every line in between must be in the patch.
function diffTargetsForRange(file, range) {
  if (!range) return [];
  const side = DIFF_SIDE[range.side || 'additions'];
  const endSide = DIFF_SIDE[range.endSide || range.side || 'additions'];
  if (side !== endSide) return [];
  const anchor = { path: file.newPath, side, line: range.start };
  return diffSelectionRange(anchor, { ...anchor, line: range.end }, diffFileTargets(file)).map(diffWithContext);
}
// END TESTABLE: library range

function diffReviewPanelHtml() {
  const comments = diffReviewState.comments.map((comment, index) =>
    `<div class="diff-review-item"><span class="diff-review-item-text">` +
      `<span class="diff-review-item-loc">${esc(diffLineLabel(comment))}</span>` +
      `<span class="diff-review-item-body">${esc(comment.body)}</span></span>` +
      `<button type="button" class="diff-review-remove" data-review-remove="${index}" aria-label="Remove comment on ${esc(diffLineLabel(comment))}">Remove</button></div>`
  ).join('');
  return `<section class="diff-review-panel" id="diff-review-panel" aria-labelledby="diff-review-title"${diffReviewState.open ? '' : ' hidden'}>` +
    `<h3 id="diff-review-title">Pending review</h3>` +
    `<p class="diff-review-copy">Add an overall note, file comments, line comments, or any combination.</p>` +
    `<label class="sr-only" for="diff-review-body">Overall review comment</label>` +
    `<textarea id="diff-review-body" name="diff-review-body" autocomplete="off" class="diff-review-body" placeholder="Overall review comment… (optional)">${esc(diffReviewState.body)}</textarea>` +
    `<div class="diff-review-comments">${comments || '<span class="diff-review-copy">No comments added yet.</span>'}</div>` +
    `<div class="diff-comment-error" id="diff-review-error" role="alert"></div>` +
    `<div class="diff-review-actions"><orc-button data-review-close variant="ghost" size="compact">Close</orc-button>` +
    `<orc-button data-review-send variant="primary" size="compact">Send to agent</orc-button></div></section>`;
}

async function diffPostReview(payload) {
  const runId = diffReviewState.runId;
  if (!runId) throw new Error('No run selected.');
  const response = await fetch(`/runs/${encodeURIComponent(runId)}/send-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Could not send review (${response.status}).`);
  }
}

// Copy and open-in-neovim on each file header. Both re-bind after every
// repaint, so they guard on their own dataset flag like the comment triggers.
function diffBindFileActions(c) {
  // the strip is inside the <summary>, so every click in it would otherwise
  // collapse the file it acts on. Bound on the strip, after the buttons'
  // own listeners have already run.
  c.querySelectorAll('.diff-file-meta').forEach(strip => {
    if (strip.dataset.actionBound) return;
    strip.dataset.actionBound = 'true';
    strip.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  });
  c.querySelectorAll('.diff-file-copy').forEach(button => {
    if (button.dataset.actionBound) return;
    button.dataset.actionBound = 'true';
    button.addEventListener('click', async () => {
      let ok = true;
      try { await navigator.clipboard.writeText(button.dataset.path); } catch (err) { ok = false; }
      if (!ok) return announce('Copy failed');
      button.innerHTML = COPIED_ICON;
      button.classList.add('is-copied');
      announce(`Copied path ${button.dataset.path}`);
      setTimeout(() => { button.innerHTML = COPY_ICON; button.classList.remove('is-copied'); }, 1200);
    });
  });
}

// TESTABLE: did the selection take less than the lines it covers? Compared on
// trimmed text so a drag that skips a line's indentation still counts as
// whole-line. Whole lines need no quote — the diff already highlights them.
function diffSelectionIsPartial(lines, cellTexts) {
  return lines.some((line, index) => line.trim() !== (cellTexts[index] || '').trim());
}
// END TESTABLE-PARTIAL

// TESTABLE: grow offsets out to whole words, so a drag that starts mid-token
// quotes `context:` rather than `ontext:`. Returns [start, end] for the text.
function diffWholeWordBounds(text, start, end) {
  const word = /\S/;
  let from = start, to = end;
  while (from > 0 && word.test(text[from - 1])) from--;
  while (to < text.length && word.test(text[to])) to++;
  return [from, to];
}
// END TESTABLE-WORDS

// applies those bounds to a live range; text-node endpoints only — an element
// endpoint is already on a boundary, so it is left alone.
function diffWholeWordRange(range) {
  const grown = range.cloneRange();
  if (grown.startContainer.nodeType === 3) {
    const text = grown.startContainer.data;
    grown.setStart(grown.startContainer, diffWholeWordBounds(text, grown.startOffset, grown.startOffset)[0]);
  }
  if (grown.endContainer.nodeType === 3) {
    const text = grown.endContainer.data;
    grown.setEnd(grown.endContainer, diffWholeWordBounds(text, grown.endOffset, grown.endOffset)[1]);
  }
  return grown;
}

// TESTABLE: which side a rendered code line belongs to. Split view puts each
// side in its own code column; unified view has one column and tells the
// sides apart by line type, where a context line counts as the new file.
function diffLineSide(column, lineType) {
  if (column.hasAttribute('data-deletions')) return 'LEFT';
  if (column.hasAttribute('data-additions')) return 'RIGHT';
  return lineType === 'change-deletion' ? 'LEFT' : 'RIGHT';
}
// END TESTABLE-SIDE

// the library's theme mode follows the shell's resolved data-theme
function diffThemeType() {
  const theme = document.documentElement.dataset.theme;
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}
new MutationObserver(() => {
  for (const view of diffViews) view.setThemeType(diffThemeType());
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// T3 Code's hunk separators: a full-width band one step off the code surface
// instead of the library's tall rounded pill. Height and type size live in
// the shadow root; the band's colour and face come from .diff-host. Split+wrap
// pins the code track to minmax(0, 1fr) so long unbroken tokens wrap inside
// their column instead of widening one half of the split grid.
const DIFF_UNSAFE_CSS = '[data-separator="line-info-basic"] { height: 24px; }\n' +
  '[data-separator="line-info-basic"] [data-separator-content] { font-size: 11px; }\n' +
  '[data-diff-type="split"][data-overflow="wrap"] { --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr); }';

// The library only reports pointer-selected ranges; the option names here are
// its own (enableGutterUtility is the hover "+" in the gutter, and a click or
// drag on it lands in onGutterUtilityClick with the range it covers).
function diffViewOptions(mode, wrap, file, c, host) {
  return {
    diffStyle: mode,
    ...DIFF_HIGHLIGHT_OPTIONS,
    themeType: diffThemeType(),
    disableFileHeader: true,
    hunkSeparators: 'line-info-basic',
    unsafeCSS: DIFF_UNSAFE_CSS,
    diffIndicators: 'classic',
    overflow: wrap ? 'wrap' : 'scroll',
    lineHoverHighlight: 'both',
    enableGutterUtility: true,
    enableLineSelection: true,
    onGutterUtilityClick: range => diffOpenRange(c, diffActiveFiles, file, range),
    // dragging line numbers selects a range; a single-line click only
    // highlights it and leaves the gutter button to open the composer
    onLineSelectionEnd: range => { if (range && range.start !== range.end) diffOpenRange(c, diffActiveFiles, file, range); },
    onLineSelectionStart: () => { if (diffComposer) { diffCloseComposer(); diffWrite(null); } },
    renderAnnotation: annotation => diffRenderComposer(c, diffActiveFiles, file, annotation.metadata),
    // VirtualizedFileDiff emits 'unmount' when swapping an offscreen file back
    // to its placeholder so CSS min-height and tests reflect live paint state.
    onPostRender: (node, instance, phase) => {
      if (!host) return;
      if (phase === 'unmount') delete host.dataset.painted;
      else host.dataset.painted = 'true';
    },
  };
}

function diffOpenRange(c, files, file, range, quote = '') {
  const targets = diffTargetsForRange(file, range);
  if (!targets.length) { announce('Comment ranges must use contiguous lines on the same file and side'); return; }
  diffOpenComposer(c, files, file, targets, quote);
}

function diffOpenComposer(c, files, file, targets, quote = '', text = '') {
  diffCloseComposer();
  const view = file.view;
  if (!view) return;
  const last = targets[targets.length - 1], libSide = DIFF_LIB_SIDE[last.side];
  diffComposer = { file, targets, quote, element: null, text };
  diffWrite({ kind: 'line', targets, quote, text });
  diffReviewState.anchor = { path: last.path, side: last.side, line: targets[0].line };
  view.setSelectedLines({ start: targets[0].line, end: last.line, side: libSide, endSide: libSide });
  // annotations only reach the DOM through render(); setLineAnnotations alone
  // just stores them for the next one
  diffRenderAnnotations(file, [{ side: libSide, lineNumber: last.line, metadata: { targets, quote } }]);
  // the slot is filled on the library's own render tick
  requestAnimationFrame(() => diffComposer?.element?.querySelector('textarea')?.focus());
}

function diffRenderAnnotations(file, lineAnnotations) {
  const host = file.view?.fileContainer;
  if (!host) return;
  file.view.render({ fileContainer: host, fileDiff: file.fileDiff, lineAnnotations });
}

// closes the open composer; `focus` hands focus back to the file card it was in
function diffCloseComposer(focus = false) {
  const open = diffComposer;
  if (!open) return;
  diffComposer = null;
  diffRenderAnnotations(open.file, []);
  open.file.view?.setSelectedLines(null);
  if (focus) open.file.view?.fileContainer?.closest('.diff-file')?.querySelector('.diff-file-head')?.focus();
}

// the line-comment composer, rendered by the library as the annotation under
// the range's last line
function diffRenderComposer(c, files, file, { targets, quote }) {
  const comment = diffCommentFromTargets(targets, '', quote);
  const composer = document.createElement('div');
  composer.className = 'diff-line-comment-composer';
  composer.innerHTML = `<div class="diff-comment-composer">` +
    // GitHub-style: the lines are the headline. The quote below only earns
    // its space when the selection is narrower than the lines it covers.
    `<label class="diff-comment-heading" for="diff-line-comment">Commenting on ${esc(diffLineRange(comment))}` +
    `<span class="diff-comment-path">${esc(comment.path)}</span></label>` +
    (comment.quote ? `<p class="diff-comment-quote" id="diff-line-comment-quote" tabindex="0" role="group" aria-label="Selected text">${esc(comment.quote)}</p>` : '') +
    `<textarea id="diff-line-comment" name="diff-line-comment" autocomplete="off" placeholder="Leave a comment…" aria-describedby="${comment.quote ? 'diff-line-comment-quote ' : ''}diff-line-comment-error"></textarea>` +
    `<div class="diff-comment-error" id="diff-line-comment-error" role="alert"></div>` +
    `<div class="diff-comment-actions"><button type="button" data-comment-cancel>Cancel</button>` +
    `<orc-button data-comment-send variant="primary" size="compact">Comment now</orc-button></div>` +
    `</div>`;
  const textarea = composer.querySelector('textarea'), error = composer.querySelector('[role="alert"]');
  const setError = message => { error.textContent = message; if (message) error.focus?.(); };
  // The library draws the box again on its own renders; the words go with it.
  const mine = () => diffComposer && diffComposer.targets === targets;
  if (mine()) textarea.value = diffComposer.text || '';
  textarea.addEventListener('input', () => {
    if (!mine()) return;
    diffComposer.text = textarea.value;
    diffWrite({ kind: 'line', targets, quote, text: textarea.value });
  });
  submitChord(textarea, () => composer.querySelector('[data-comment-send]'), true);
  composer.querySelector('[data-comment-cancel]').addEventListener('click', () => { diffCloseComposer(true); diffWrite(null); });
  composer.querySelector('[data-comment-send]').addEventListener('click', async event => {
    const direct = diffCommentFromTargets(targets, textarea.value, quote);
    if (!direct.body) return setError('Write a comment first.');
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Sending…'; setError('');
    try {
      await diffPostReview({ body: '', comments: [direct] });
      diffCloseComposer(true); diffWrite(null); announce('Comment sent to agent');
    } catch (err) {
      setError(err.message || 'Could not send comment. Try again.'); button.disabled = false; button.textContent = 'Comment now';
    }
  });
  if (diffComposer && diffComposer.targets === targets) diffComposer.element = composer;
  return composer;
}

function diffUnmountFile(file, keepHost = true) {
  const view = file?.view;
  if (!view) return;
  if (diffComposer?.file === file) diffCloseComposer();
  const host = view.fileContainer;
  const parent = keepHost ? host?.parentNode : null;
  const next = keepHost ? host?.nextSibling : null;
  file.view = null;
  const at = diffViews.indexOf(view);
  if (at !== -1) diffViews.splice(at, 1);
  // FileDiff.cleanUp() removes fileContainer from the DOM without clearing its
  // shadow children, so swap in a fresh <diffs-container> shell when keeping
  // the card for re-expanding a folded file or remounting a changed file.
  try { view.cleanUp(); } catch (err) {}
  if (host && parent) {
    const freshHost = document.createElement('diffs-container');
    freshHost.className = 'diff-host';
    if (host.dataset.fileIndex !== undefined) freshHost.dataset.fileIndex = host.dataset.fileIndex;
    if (host.style.cssText) freshHost.style.cssText = host.style.cssText;
    parent.insertBefore(freshHost, next);
  }
}

// Find reads the rows on screen. A folded file and one waiting on Load diff
// have none, so count their matches from the patch lines: header path → count.
export function diffHiddenFindCounts(root, pattern) {
  const counts = new Map();
  const byPath = new Map(diffActiveFiles.map(file => [file.newPath, file]));
  root.querySelectorAll('.diff-file').forEach(card => {
    const file = byPath.get(card.dataset.path);
    const details = card.querySelector(':scope > .diff-file-details');
    if (!file || !details) return;
    if (details.open && details.querySelector('.diff-host')) return;
    let total = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) total += (line.text.match(pattern) || []).length;
    }
    const path = details.querySelector('.diff-file-head .diff-path');
    if (total && path) counts.set(path, total);
  });
  return counts;
}

export function clearDiffViews() {
  diffCloseComposer();
  for (const view of diffViews) { try { view.cleanUp(); } catch (err) {} }
  diffViews = [];
  for (const file of diffActiveFiles) file.view = null;
  diffVirtualizer?.cleanUp();
  diffVirtualizer = null;
  diffActiveRunId = null;
  diffActiveFiles = [];
  diffScheduleWorkerIdleCleanup();
}

function diffMountFile(c, files, host, mode, wrap) {
  const file = files[+host.dataset.fileIndex];
  if (!file || file.view) return;
  // A closed <details> gives getBoundingClientRect() { top: 0, height: 0 },
  // which would mislead Virtualizer into treating the card as onscreen.
  const details = host.closest('.diff-file-details');
  if (details && !details.open) return;
  if (!diffEnsureFileDiff(diffsApi, file)) return;
  diffEnsureCacheKey(file);
  const options = diffViewOptions(mode, wrap, file, c, host);
  const worker = diffGetWorkerPool();
  const view = diffVirtualizer && diffsApi.VirtualizedFileDiff
    ? new diffsApi.VirtualizedFileDiff(options, diffVirtualizer, DIFF_VIRTUAL_METRICS, worker)
    : new diffsApi.FileDiff(options, worker);
  view.render({ fileContainer: host, fileDiff: file.fileDiff });
  file.view = view;
  diffViews.push(view);
}

function diffMountFiles(c, files, mode, wrap) {
  const body = c.querySelector('#run-diff-body');
  const filesContainer = body?.querySelector('.diff-files');
  diffVirtualizer?.cleanUp();
  diffVirtualizer = null;
  if (diffsApi?.Virtualizer && body) {
    diffVirtualizer = new diffsApi.Virtualizer({ overscrollSize: 600, intersectionObserverMargin: 1500 });
    diffVirtualizer.setup(body, filesContainer);
  }
  for (const host of c.querySelectorAll('.diff-host')) {
    diffMountFile(c, files, host, mode, wrap);
  }
}
let diffsApi = null;

function diffBindReview(c, files) {
  const panel = c.querySelector('.diff-review-panel');
  const toolbarToggle = c.querySelector('.diff-review-toggle');
  const refreshPanelCount = () => {
    if (toolbarToggle) toolbarToggle.innerHTML = `Start review${diffReviewState.comments.length ? ` <span class="diff-review-count">(${diffReviewState.comments.length})</span>` : ''}`;
  };
  const setError = (node, message) => { node.textContent = message; if (message) node.focus?.(); };

  if (toolbarToggle && !toolbarToggle.dataset.reviewBound) {
    toolbarToggle.dataset.reviewBound = 'true';
    toolbarToggle.addEventListener('click', () => {
      diffReviewState.open = !diffReviewState.open;
      diffSaveReview();
      const currentPanel = c.querySelector('.diff-review-panel');
      currentPanel.hidden = !diffReviewState.open;
      toolbarToggle.setAttribute('aria-expanded', String(diffReviewState.open));
      if (diffReviewState.open) currentPanel.querySelector('textarea').focus();
    });
  }
  if (panel && !panel.dataset.reviewBound) {
    panel.dataset.reviewBound = 'true';
    const reviewBody = panel.querySelector('.diff-review-body');
    reviewBody?.addEventListener('input', event => { diffReviewState.body = event.target.value; diffSaveReview(); });
    if (reviewBody) submitChord(reviewBody, () => panel.querySelector('[data-review-send]'), true);
    const closeReview = () => {
      diffReviewState.open = false; panel.hidden = true; toolbarToggle?.setAttribute('aria-expanded', 'false'); toolbarToggle?.focus();
      diffSaveReview();
    };
    orcRegisterOverlayCloser('diff-review', closeReview);
    panel.querySelector('[data-review-close]')?.addEventListener('click', closeReview);
    // floating popover: Escape dismisses while focus is inside it
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeReview(); } });
    panel.querySelectorAll('[data-review-remove]').forEach(button => button.addEventListener('click', () => {
      const index = +button.dataset.reviewRemove;
      diffReviewState.comments.splice(index, 1);
      diffReviewState.open = true;
      diffSaveReview();
      const replacement = document.createElement('div'); replacement.innerHTML = diffReviewPanelHtml();
      panel.replaceWith(replacement.firstElementChild);
      refreshPanelCount(); diffBindReview(c, diffActiveFiles);
      c.querySelector('.diff-review-body')?.focus();
    }));
    panel.querySelector('[data-review-send]')?.addEventListener('click', async event => {
      const button = event.currentTarget, error = c.querySelector('#diff-review-error');
      diffReviewState.body = panel.querySelector('.diff-review-body').value;
      if (!diffReviewState.body.trim() && !diffReviewState.comments.length) return setError(error, 'Write an overall comment or add a line comment first.');
      button.disabled = true; button.textContent = 'Sending…'; setError(error, '');
      try {
        await diffPostReview({ body: diffReviewState.body.trim(), comments: diffReviewState.comments });
        diffReviewState.comments = []; diffReviewState.body = ''; diffReviewState.open = false;
        diffSaveReview();
        const replacement = document.createElement('div'); replacement.innerHTML = diffReviewPanelHtml();
        panel.replaceWith(replacement.firstElementChild);
        toolbarToggle?.setAttribute('aria-expanded', 'false'); refreshPanelCount(); diffBindReview(c, diffActiveFiles);
        announce('Review sent to agent'); toolbarToggle?.focus();
      } catch (err) {
        setError(error, err.message || 'Could not send review. Try again.'); button.disabled = false; button.textContent = 'Send to agent';
      }
    });
  }

  c.querySelectorAll('.diff-file-comment').forEach(button => {
    if (button.dataset.reviewBound) return;
    button.dataset.reviewBound = 'true';
    button.addEventListener('click', () => {
      const file = diffActiveFiles[+button.dataset.fileIndex];
      const details = button.closest('.diff-file')?.querySelector('.diff-file-details');
      if (!file || !details) return;
      details.open = true;
      c.querySelector('.diff-file-comment-composer')?.remove();
      diffCloseComposer();
      const comment = { scope: 'file', path: file.newPath, context: diffFileContext(file), body: '' };
      const composer = document.createElement('div');
      const inputId = `diff-file-comment-${button.dataset.fileIndex}`;
      composer.className = 'diff-file-comment-composer';
      composer.innerHTML = `<div class="diff-comment-composer">` +
        `<label class="diff-comment-heading" for="${inputId}">Comment on whole file` +
        `<span class="diff-comment-path">${esc(file.newPath)}</span></label>` +
        `<textarea id="${inputId}" name="diff-file-comment" autocomplete="off" placeholder="Leave a comment…" aria-describedby="${inputId}-error"></textarea>` +
        `<div class="diff-comment-error" id="${inputId}-error" role="alert" tabindex="-1"></div>` +
        `<div class="diff-comment-actions"><button type="button" data-file-comment-cancel>Cancel</button>` +
        `<orc-button data-file-comment-send variant="primary" size="compact">Comment now</orc-button></div></div>`;
      details.querySelector('.diff-file-head').after(composer);
      const textarea = composer.querySelector('textarea');
      const error = composer.querySelector('[role="alert"]');
      // A comment on this file a reload put away comes back in its box.
      if (diffWriting?.kind === 'file' && diffWriting.path === file.newPath) textarea.value = diffWriting.text;
      diffWrite({ kind: 'file', path: file.newPath, text: textarea.value });
      textarea.addEventListener('input', () => diffWrite({ kind: 'file', path: file.newPath, text: textarea.value }));
      textarea.focus();
      submitChord(textarea, () => composer.querySelector('[data-file-comment-send]'), true);
      const close = () => { composer.remove(); diffWrite(null); button.focus(); };
      composer.querySelector('[data-file-comment-cancel]').addEventListener('click', close);
      composer.querySelector('[data-file-comment-send]').addEventListener('click', async event => {
        comment.body = textarea.value.trim();
        if (!comment.body) return setError(error, 'Write a comment first.');
        const action = event.currentTarget; action.disabled = true; action.textContent = 'Sending…'; setError(error, '');
        try {
          await diffPostReview({ body: '', comments: [comment] });
          close(); announce('File comment sent to agent');
        } catch (err) {
          setError(error, err.message || 'Could not send comment. Try again.'); action.disabled = false; action.textContent = 'Comment now';
        }
      });
    });
  });

  // selecting text raises a hovering comment control: the comment covers the
  // lines the selection touches and quotes the selected text itself.
  // diffBindReview re-runs whenever the review panel is rebuilt, and `c` keeps
  // its children — reuse the existing control instead of stacking a new one
  // (and a duplicate listener set) on every rebind.
  let selectionTrigger = c.querySelector('.diff-selection-trigger');
  const freshTrigger = !selectionTrigger;
  if (freshTrigger) {
    selectionTrigger = document.createElement('button');
    selectionTrigger.type = 'button';
    selectionTrigger.className = 'diff-selection-trigger';
    selectionTrigger.hidden = true;
    selectionTrigger.innerHTML = `${COMMENT_ICON}<span>Comment on selection</span>`;
    c.appendChild(selectionTrigger);
  }
  let selectionFile = null, selectionTargets = [], selectionQuote = '';

  // The rows live in each file card's shadow root, where document.getSelection()
  // only sees the host. getComposedRanges() reaches inside; a browser without
  // it keeps the gutter route and simply never raises this control.
  const composedRange = selection => {
    if (typeof selection.getComposedRanges !== 'function') return null;
    const roots = [...c.querySelectorAll('.diff-host')].map(host => host.shadowRoot).filter(Boolean);
    if (!roots.length) return null;
    const inside = ranges => ranges?.length && roots.some(root => root.contains(ranges[0].startContainer));
    let ranges = null;
    try { ranges = selection.getComposedRanges({ shadowRoots: roots }); } catch (err) { ranges = null; }
    // the older signature took the roots as arguments
    if (!inside(ranges)) { try { ranges = selection.getComposedRanges(...roots); } catch (err) { ranges = null; } }
    if (!inside(ranges)) return null;
    const first = ranges[0], last = ranges[ranges.length - 1];
    const range = document.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    return range;
  };
  const lineOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-line]');
  const readSelection = () => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    if (!selection.toString().trim()) return null;
    const range = composedRange(selection);
    if (!range) return null;
    const startLine = lineOf(range.startContainer), endLine = lineOf(range.endContainer);
    if (!startLine || !endLine) return null;
    // a selection crossing files or sides has no single anchor — ignore it
    // rather than guessing which half the comment belongs to
    const column = startLine.closest('[data-code]');
    if (!column || column !== endLine.closest('[data-code]')) return null;
    const host = column.getRootNode().host;
    const file = diffActiveFiles[+host?.dataset.fileIndex];
    if (!file) return null;
    const rows = [...column.querySelectorAll('[data-line]')];
    const from = rows.indexOf(startLine), to = rows.indexOf(endLine);
    if (from < 0 || to < from) return null;
    const candidates = diffFileTargets(file);
    const targets = [], lines = [], cellTexts = [];
    let side = null;
    for (const row of rows.slice(from, to + 1)) {
      const rowSide = diffLineSide(column, row.dataset.lineType);
      if (side && rowSide !== side) return null;
      side = rowSide;
      const target = candidates.find(item => item.side === side && item.line === +row.dataset.line);
      if (!target) return null;
      targets.push(diffWithContext(target));
      // quote per row, clamped to that row: the range's own text would splice
      // in the neighbouring rows' glyphs
      const part = document.createRange();
      part.selectNodeContents(row);
      if (row === startLine) part.setStart(range.startContainer, range.startOffset);
      if (row === endLine) part.setEnd(range.endContainer, range.endOffset);
      lines.push(diffWholeWordRange(part).toString());
      cellTexts.push(row.textContent || '');
    }
    if (!targets.length) return null;
    const quote = lines.join('\n').trim();
    if (!quote) return null;
    // whole lines are already highlighted in the diff above the composer, so
    // only a selection narrower than its lines needs quoting
    const partial = diffSelectionIsPartial(lines, cellTexts);
    return { file, targets, quote: partial ? quote : '', rect: range.getBoundingClientRect() };
  };
  const hideSelectionTrigger = () => {
    // hiding a focused control drops focus to <body> — hand it back to the
    // file card the selection was in
    if (!selectionTrigger.hidden && selectionTrigger.contains(document.activeElement)) {
      selectionFile?.view?.fileContainer?.closest('.diff-file')?.querySelector('.diff-file-head')?.focus();
    }
    selectionTrigger.hidden = true; selectionFile = null; selectionTargets = []; selectionQuote = '';
  };
  const refreshSelectionTrigger = () => {
    const found = readSelection();
    if (!found) return hideSelectionTrigger();
    const wasHidden = selectionTrigger.hidden;
    selectionFile = found.file; selectionTargets = found.targets; selectionQuote = found.quote;
    selectionTrigger.hidden = false;
    // measure after unhiding: the label is variable-width, so a hardcoded
    // clamp clips the control at large text sizes
    const width = selectionTrigger.offsetWidth, height = selectionTrigger.offsetHeight;
    selectionTrigger.style.top = `${Math.max(6, Math.min(found.rect.bottom + 6, window.innerHeight - height - 6))}px`;
    selectionTrigger.style.left = `${Math.max(6, Math.min(found.rect.left, window.innerWidth - width - 6))}px`;
    if (wasHidden) announce('Comment on selection available');
  };
  // every listener goes through these module-level handles, so a rebind
  // repoints them at the current closure instead of leaving stale state live
  diffHideSelectionTrigger = hideSelectionTrigger;
  diffRefreshSelectionTrigger = refreshSelectionTrigger;
  selectionTrigger.onclick = () => {
    const file = selectionFile, targets = selectionTargets, quote = selectionQuote;
    if (!file || !targets.length) return;
    hideSelectionTrigger();
    document.getSelection()?.removeAllRanges();
    diffOpenComposer(c, diffActiveFiles, file, targets, quote);
  };
  if (!freshTrigger) return;
  // mouseup is composed, so one from inside a card's shadow root reaches here
  c.addEventListener('mouseup', () => setTimeout(() => diffRefreshSelectionTrigger?.(), 0));
  // keyboard selection and Escape happen wherever focus is, not necessarily
  // inside the untabbable diff container
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') { diffHideSelectionTrigger?.(); return; }
    if (event.shiftKey || event.key === 'Shift') setTimeout(() => diffRefreshSelectionTrigger?.(), 0);
  });
  c.addEventListener('mousedown', event => {
    if (!selectionTrigger.contains(event.target)) diffHideSelectionTrigger?.();
  });
}

// the trigger is position:fixed, so scrolling would leave it stranded beside
// text that moved — hide it instead of chasing the selection
let diffHideSelectionTrigger = null, diffRefreshSelectionTrigger = null;
window.addEventListener('scroll', () => diffHideSelectionTrigger?.(), true);

// the library paints the rows into the host, which has to be its own
// <diffs-container> element: that is what adopts its core stylesheet into
// the shadow root. Until it paints, the host holds the file's estimated
// height so the scrollbar doesn't grow while scrolling: 20px rows, a 24px band
// before each hunk that skips lines, and the library's 16px of padding.
function diffHasHunks(f) {
  if (typeof f.hasHunks === 'boolean') return f.hasHunks;
  return f.fileDiff ? f.fileDiff.hunks.length > 0 : f.hunks.length > 0;
}

function diffEstimatePx(f) {
  if (f.fileDiff && Array.isArray(f.fileDiff.hunks)) {
    let px = 16;
    for (const hunk of f.fileDiff.hunks) {
      let lineCount = 0;
      for (const part of hunk.hunkContent) {
        lineCount += part.type === 'context' ? part.lines : part.deletions + part.additions;
      }
      const first = hunk.hunkContent[0];
      const firstOld = !first ? Infinity : (first.type === 'change' && !first.deletions ? Infinity : hunk.deletionStart);
      const firstNew = !first ? Infinity : (first.type === 'change' && !first.additions ? Infinity : hunk.additionStart);
      const skips = lineCount > 0 && Math.min(firstOld, firstNew) > 1;
      px += (skips ? 24 : 0) + lineCount * 20;
    }
    return px;
  }
  return f.hunks.reduce((px, hunk) => {
    const first = hunk.lines[0];
    const skips = first && Math.min(first.old ?? Infinity, first.new ?? Infinity) > 1;
    return px + (skips ? 24 : 0) + hunk.lines.length * 20;
  }, 16);
}

function diffHostHtml(f, idx) {
  return `<div class="diff-file-body"><diffs-container class="diff-host" data-file-index="${idx}" ` +
    `style="--diff-estimate: ${diffEstimatePx(f)}px"></diffs-container></div>`;
}

const DIFF_DEFER_COPY = { generated: 'Generated file, not shown by default.', large: 'Large diff, not shown by default.' };

function diffDeferredHtml(f, idx) {
  const lines = f.adds + f.dels;
  return `<div class="diff-deferred"><p>${DIFF_DEFER_COPY[f.defer]} ` +
    `<span class="diff-deferred-size">${lines.toLocaleString('en-US')} changed line${lines === 1 ? '' : 's'}</span></p>` +
    `<button type="button" class="diff-load" data-file-index="${idx}" aria-label="Load diff for ${esc(f.newPath)}">Load diff</button></div>`;
}

// BEGIN TESTABLE: files without lines
function diffSizeText(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// A whole blob id that names content: an added file's old side and a deleted
// file's new side are all zeros.
const diffBlobId = id => (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id || '') && /[^0]/.test(id) ? id : null);

// The sides of a changed image, clip or video that git can still play: the
// old one for a deleted file, the new one for an added file, both otherwise.
function diffMediaSides(f) {
  const kind = f.binary && diffActiveRunId != null ? mediaKind(f.newPath) : null;
  if (!kind) return [];
  const before = f.status === 'added' ? null : diffBlobId(f.fileDiff?.prevObjectId);
  const after = f.status === 'deleted' ? null : diffBlobId(f.fileDiff?.newObjectId);
  const both = before && after;
  return [before && { kind, blob: before, path: f.oldPath, label: both ? 'Before' : '' },
    after && { kind, blob: after, path: f.newPath, label: both ? 'After' : '' }].filter(Boolean);
}

function diffMediaSideHtml({ kind, blob, path, label }) {
  const src = esc(mediaUrl(diffActiveRunId, path, blob));
  const name = esc(`${label ? `${label}: ` : ''}${diffPathParts(path).base}`);
  const media = kind === 'image' ? `<img src="${src}" alt="${name}" loading="lazy">`
    : kind === 'video' ? `<video src="${src}" aria-label="${name}" controls playsinline preload="${diffMediaPreload}"></video>`
    : `<audio src="${src}" aria-label="${name}" controls preload="${diffMediaPreload}"></audio>`;
  return `<figure class="diff-media-side">${label ? `<figcaption>${label}</figcaption>` : ''}${media}</figure>`;
}

// A file with no hunks (binary, too big to send, mode change, pure rename)
// has nothing for the library to paint.
function diffNoLinesHtml(f) {
  if (f.omitted) {
    const download = diffDownload
      ? ` <a href="${esc(diffDownload.url)}" download="${esc(diffDownload.name)}">Download full diff</a>` : '';
    return `<div class="diff-binary">Too large to show here: ${diffSizeText(f.omitted)} of changes.${download}</div>`;
  }
  const sides = diffMediaSides(f);
  if (sides.length) return `<div class="diff-media" data-kind="${sides[0].kind}">${sides.map(diffMediaSideHtml).join('')}</div>`;
  return `<div class="diff-binary">${f.binary ? 'Binary file, so there are no lines to show.' : 'No lines to show: a change with no content.'}</div>`;
}
// END TESTABLE: files without lines

// One clip at a time: a preview that starts stops the others and the page's
// clip player. A preview that cannot load says so in its place.
function diffBindMedia(body) {
  if (body.dataset.mediaBound) return;
  body.dataset.mediaBound = 'true';
  body.addEventListener('play', event => {
    if (!event.target.closest?.('.diff-media')) return;
    stopClips();
    for (const media of body.querySelectorAll('.diff-media audio, .diff-media video')) {
      if (media !== event.target) media.pause();
    }
  }, true);
  body.addEventListener('error', event => {
    const side = event.target.closest?.('.diff-media-side');
    if (!side || !event.target.matches('img, audio, video')) return;
    event.target.outerHTML = '<p class="diff-media-missing" role="status">Preview unavailable.</p>';
  }, true);
}

// The page's clip player starting, from the chat or the Assets tab, stops a
// preview here in turn.
onClipChange(() => {
  const playing = diffActiveRunId != null && clipPlayback(diffActiveRunId);
  if (!playing || playing.paused) return;
  for (const media of document.querySelectorAll('#run-diff-body .diff-media audio, #run-diff-body .diff-media video')) media.pause();
});

function diffWantsHost(f) {
  return diffHasHunks(f) && !(f.defer && !diffLoadedPaths.has(f.newPath));
}

function diffStatsHtml(f) {
  return (f.adds || f.dels) ? `<span class="diff-stat-add">+${f.adds}</span> <span class="diff-stat-del">−${f.dels}</span>` : '';
}

function diffRenderFile(f, idx) {
  const n = diffPathParts(f.newPath);
  const pathId = `diff-path-${idx}`;
  let pathHtml;
  if (f.status === 'renamed' && f.oldPath !== f.newPath) {
    const o = diffPathParts(f.oldPath);
    pathHtml = `<span class="diff-path-part"><span class="diff-dir">${esc(o.dir)}</span><span class="diff-base"><bdi dir="ltr">${esc(o.base)}</bdi></span></span><span class="diff-rename-arrow"> → </span>` +
      `<span class="diff-path-part"><span class="diff-dir">${esc(n.dir)}</span><span class="diff-base"><bdi dir="ltr">${esc(n.base)}</bdi></span></span>`;
  } else {
    pathHtml = `<span class="diff-path-part"><span class="diff-dir">${esc(n.dir)}</span><span class="diff-base"><bdi dir="ltr">${esc(n.base)}</bdi></span></span>`;
  }
  const chipDef = DIFF_CHIP[f.status];
  const chip = chipDef ? `<orc-chip class="diff-chip" variant="${chipDef[1]}">${chipDef[0]}</orc-chip>` : '';
  const stats = diffStatsHtml(f);
  const body = !diffHasHunks(f) ? diffNoLinesHtml(f)
    : f.defer && !diffLoadedPaths.has(f.newPath) ? diffDeferredHtml(f, idx) : diffHostHtml(f, idx);
  const openAttr = diffCollapsedPaths.has(f.newPath) ? '' : ' open';
  // the meta strip sits inside the summary so the sticky header is its
  // containing block and the icons centre on it; diffBindFileActions keeps a
  // click in the strip from toggling the <details> around it
  return `<div class="diff-file" data-path="${esc(f.newPath)}">` +
    `<details class="diff-file-details"${openAttr}>` +
    // the actions live in the summary, so pin its accessible name to the path
    // — otherwise the disclosure announces every icon's label as its own name
    `<summary class="diff-file-head" aria-labelledby="${pathId}">` +
    `<svg class="diff-chevron" aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 1 L7 5 L2 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `<span class="diff-path" id="${pathId}">${pathHtml}</span>${chip}` +
    `<span class="diff-file-meta">${diffFileActionsHtml(f)}` +
    `<button type="button" class="diff-file-action diff-file-comment" data-file-index="${idx}" aria-label="Comment on whole file ${esc(f.newPath)}">` +
    `${COMMENT_ICON}</button>${stats}</span>` +
    `</summary>${body}</details></div>`;
}

// The panel bar's icon controls, drawn in the same 24px stroke set as T3 Code's.
function diffToolIcon(paths) {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
const DIFF_TOOL_ICONS = {
  collapse: diffToolIcon('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
  expand: diffToolIcon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
  unified: diffToolIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>'),
  split: diffToolIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>'),
  wrap: diffToolIcon('<path d="M3 6h18M3 18h7"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/>'),
};

function diffToolHtml(attrs, label, glyph, pressed) {
  return `<button type="button" class="diff-tool" ${attrs} aria-label="${label}" title="${label}"` +
    `${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${glyph}</button>`;
}

function diffReadSetting(key, allowed, fallback) {
  let value = null;
  try { value = localStorage.getItem(key); } catch (e) {}
  return allowed.includes(value) ? value : fallback;
}

function diffSyncFoldButton(tools) {
  const fold = tools?.querySelector('[data-diff-fold]');
  if (!fold) return;
  const all = diffActiveFiles.length > 0 && diffActiveFiles.every(f => diffCollapsedPaths.has(f.newPath));
  const label = all ? 'Expand all files' : 'Collapse all files';
  if (fold.getAttribute('aria-label') === label) return;
  fold.setAttribute('aria-label', label);
  fold.title = label;
  fold.innerHTML = all ? DIFF_TOOL_ICONS.expand : DIFF_TOOL_ICONS.collapse;
}

function diffSyncLayoutTools(tools) {
  tools?.querySelectorAll('[data-diff-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.diffMode === diffActiveMode));
  });
  tools?.querySelector('[data-diff-wrap]')?.setAttribute('aria-pressed', String(diffActiveWrap));
}

function diffApplyLayoutInPlace(tools) {
  diffSyncLayoutTools(tools);
  const overflow = diffActiveWrap ? 'wrap' : 'scroll';
  for (const file of diffActiveFiles) {
    const view = file.view;
    if (!view) continue;
    view.setOptions({ ...view.options, diffStyle: diffActiveMode, overflow });
    if (!diffVirtualizer) view.rerender();
  }
}

function diffBindCardControls(c, root) {
  const tools = c.querySelector('#run-diff-tools');
  root.querySelectorAll('.diff-file-details').forEach(d => {
    if (d.dataset.toggleBound) return;
    d.dataset.toggleBound = 'true';
    d.addEventListener('toggle', () => {
      const p = d.closest('.diff-file').dataset.path;
      if (d.open) diffCollapsedPaths.delete(p); else diffCollapsedPaths.add(p);
      const host = d.querySelector('.diff-host');
      if (host) {
        if (d.open) diffMountFile(c, diffActiveFiles, host, diffActiveMode, diffActiveWrap);
        else diffUnmountFile(diffActiveFiles[+host.dataset.fileIndex]);
      }
      diffSyncFoldButton(tools);
    });
  });
  root.querySelectorAll('.diff-load').forEach(button => {
    if (button.dataset.loadBound) return;
    button.dataset.loadBound = 'true';
    button.addEventListener('click', () => {
      const idx = +button.dataset.fileIndex;
      const file = diffActiveFiles[idx];
      const card = button.closest('.diff-file');
      if (!file || !card) return;
      diffLoadedPaths.add(file.newPath);
      diffEnsureFileDiff(diffsApi, file);
      button.closest('.diff-deferred').outerHTML = diffHostHtml(file, idx);
      diffMountFile(c, diffActiveFiles, card.querySelector('.diff-host'), diffActiveMode, diffActiveWrap);
      // the button is gone, so focus stays in the card on its header
      card.querySelector('.diff-file-head').focus();
      announce(`Loaded diff for ${file.newPath}`);
    });
  });
}

function diffSyncCardIndex(card, idx) {
  const pathId = `diff-path-${idx}`;
  const pathEl = card.querySelector('.diff-path');
  const headEl = card.querySelector('.diff-file-head');
  if (pathEl && pathEl.id !== pathId) pathEl.id = pathId;
  if (headEl && headEl.getAttribute('aria-labelledby') !== pathId) headEl.setAttribute('aria-labelledby', pathId);
  card.querySelector('.diff-file-comment')?.setAttribute('data-file-index', String(idx));
  card.querySelector('.diff-host')?.setAttribute('data-file-index', String(idx));
  card.querySelector('.diff-load')?.setAttribute('data-file-index', String(idx));
}

function diffSyncCardStats(card, file) {
  const meta = card.querySelector('.diff-file-meta');
  const commentBtn = meta?.querySelector('.diff-file-comment');
  if (!meta || !commentBtn) return;
  while (commentBtn.nextSibling) commentBtn.nextSibling.remove();
  const stats = diffStatsHtml(file);
  if (stats) commentBtn.insertAdjacentHTML('afterend', stats);
}

function diffCreateCardElement(file, idx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = diffRenderFile(file, idx);
  return wrap.firstElementChild;
}

function diffSyncTruncatedNotice(body, filesContainer, noticeHtml) {
  const existing = body.querySelector(':scope > .diff-truncated');
  if (!noticeHtml) {
    existing?.remove();
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = noticeHtml;
  const fresh = wrap.firstElementChild;
  if (existing) existing.replaceWith(fresh);
  else body.insertBefore(fresh, filesContainer);
}

function diffReconcileFiles(c, body, tools, nextFiles, noticeHtml) {
  const filesContainer = body.querySelector(':scope > .diff-files');
  diffSyncTruncatedNotice(body, filesContainer, noticeHtml);

  const prevByPath = new Map();
  const cards = [...filesContainer.querySelectorAll(':scope > .diff-file')];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const file = diffActiveFiles[i];
    if (file && card.dataset.path === file.newPath) prevByPath.set(file.newPath, { file, card });
  }
  const nextPaths = new Set(nextFiles.map(f => f.newPath));
  for (const [path, entry] of prevByPath) {
    if (nextPaths.has(path)) continue;
    diffUnmountFile(entry.file, false);
    entry.card.remove();
  }

  for (let idx = 0; idx < nextFiles.length; idx++) {
    const nextFile = nextFiles[idx];
    const entry = prevByPath.get(nextFile.newPath);
    if (entry && diffFilesHaveSameContent(entry.file, nextFile)
        && Boolean(entry.card.querySelector('.diff-host')) === diffWantsHost(entry.file)) {
      nextFiles[idx] = entry.file;
      diffSyncCardIndex(entry.card, idx);
      if (filesContainer.children[idx] !== entry.card) {
        filesContainer.insertBefore(entry.card, filesContainer.children[idx] || null);
      }
      continue;
    }

    if (entry && entry.file.status === nextFile.status && entry.file.oldPath === nextFile.oldPath
        && Boolean(entry.card.querySelector('.diff-host')) === diffWantsHost(nextFile)
        && diffWantsHost(nextFile)) {
      const prevFile = entry.file;
      // VirtualizedFileDiff rejects an uncached diff swap on an already-highlighted
      // instance while the worker is still tokenizing, so remount only this card's
      // host while keeping the card element and every unchanged file view intact.
      diffUnmountFile(prevFile);
      prevFile.fileDiff = nextFile.fileDiff;
      prevFile.rawPatch = nextFile.rawPatch ?? null;
      prevFile.hasHunks = nextFile.hasHunks;
      prevFile.cacheKey = null;
      prevFile.adds = nextFile.adds;
      prevFile.dels = nextFile.dels;
      prevFile.defer = nextFile.defer;
      prevFile.targets = null;
      Object.defineProperty(prevFile, 'hunks', Object.getOwnPropertyDescriptor(nextFile, 'hunks'));
      diffEnsureCacheKey(prevFile);
      nextFiles[idx] = prevFile;
      diffSyncCardStats(entry.card, prevFile);
      diffSyncCardIndex(entry.card, idx);
      if (filesContainer.children[idx] !== entry.card) {
        filesContainer.insertBefore(entry.card, filesContainer.children[idx] || null);
      }
      const host = entry.card.querySelector('.diff-host');
      host.style.setProperty('--diff-estimate', `${diffEstimatePx(prevFile)}px`);
      diffMountFile(c, nextFiles, host, diffActiveMode, diffActiveWrap);
      continue;
    }

    if (entry) {
      diffUnmountFile(entry.file, false);
    }
    const freshCard = diffCreateCardElement(nextFile, idx);
    if (entry) entry.card.replaceWith(freshCard);
    if (filesContainer.children[idx] !== freshCard) {
      filesContainer.insertBefore(freshCard, filesContainer.children[idx] || null);
    }
  }

  diffActiveFiles = nextFiles;
  diffBindCardControls(c, filesContainer);
  for (const host of filesContainer.querySelectorAll('.diff-host')) {
    const file = diffActiveFiles[+host.dataset.fileIndex];
    if (file && !file.view) diffMountFile(c, diffActiveFiles, host, diffActiveMode, diffActiveWrap);
  }
  diffVirtualizer?.markDOMDirty?.();
  diffSyncFoldButton(tools);
  diffBindReview(c, diffActiveFiles);
  diffBindFileActions(c);
}

function renderDiffPatch(api, text, c, runId, { truncated, downloadUrl, downloadName }) {
  try {
    diffsApi = api;
    const files = parseDiffPatch(api, text);
    if (!files.length) return false;
    diffDownload = { url: downloadUrl, name: downloadName };
    const previews = files.reduce((n, f) => n + (f.binary && mediaKind(f.newPath) ? (f.status === 'modified' ? 2 : 1) : 0), 0);
    diffMediaPreload = previews > DIFF_MEDIA_EAGER ? 'none' : 'metadata';
    const summary = c.querySelector('#run-diff-summary');
    const tools = c.querySelector('#run-diff-tools');
    const body = c.querySelector('#run-diff-body');
    const totalAdds = files.reduce((n, f) => n + f.adds, 0);
    const totalDels = files.reduce((n, f) => n + f.dels, 0);
    const fileCount = `${files.length} file${files.length === 1 ? '' : 's'}`;
    summary.innerHTML = `${fileCount} ` +
      `<span class="diff-stat-add">+${totalAdds}</span> <span class="diff-stat-del">−${totalDels}</span>`;
    const notice = truncated
      ? `<p class="diff-truncated" role="status">Showing the first ${fileCount}: the full diff is over 8 MB. ` +
        `<a href="${esc(downloadUrl)}" download="${esc(downloadName)}">Download full diff</a></p>`
      : '';
    const nextMode = diffReadSetting('orcDiffMode', ['unified', 'split'], 'unified');
    const nextWrap = diffReadSetting('orcDiffWrap', ['on', 'off'], 'off') === 'on';
    const canReconcile = runId != null && diffActiveRunId === runId
      && Boolean(body.querySelector(':scope > .diff-files'))
      && Boolean(tools.querySelector('[data-diff-fold]'));

    if (canReconcile) {
      const layoutChanged = diffActiveMode !== nextMode || diffActiveWrap !== nextWrap;
      diffActiveMode = nextMode;
      diffActiveWrap = nextWrap;
      diffReconcileFiles(c, body, tools, files, notice);
      if (layoutChanged) diffApplyLayoutInPlace(tools);
      return true;
    }

    clearDiffViews();
    diffActiveRunId = runId;
    diffActiveFiles = files;
    diffActiveMode = nextMode;
    diffActiveWrap = nextWrap;

    const scrollTop = body.scrollTop;
    const folded = files.every(f => diffCollapsedPaths.has(f.newPath));
    tools.innerHTML =
      diffToolHtml('data-diff-fold', folded ? 'Expand all files' : 'Collapse all files',
        folded ? DIFF_TOOL_ICONS.expand : DIFF_TOOL_ICONS.collapse) +
      `<div class="diff-tool-group" role="group" aria-label="Diff layout">` +
      diffToolHtml('data-diff-mode="unified"', 'Unified view', DIFF_TOOL_ICONS.unified, nextMode === 'unified') +
      diffToolHtml('data-diff-mode="split"', 'Split view', DIFF_TOOL_ICONS.split, nextMode === 'split') +
      `</div>` +
      diffToolHtml('data-diff-wrap', 'Wrap long lines', DIFF_TOOL_ICONS.wrap, nextWrap) +
      // the popover hangs from the panel bar, under this button's row
      `<span class="diff-review-anchor"><button type="button" class="diff-review-toggle" aria-expanded="${diffReviewState.open}" aria-controls="diff-review-panel">` +
      `Start review${diffReviewState.comments.length ? ` <span class="diff-review-count">(${diffReviewState.comments.length})</span>` : ''}</button>` +
      diffReviewPanelHtml() + `</span>`;
    body.innerHTML = `${notice}<div class="diff-files">${files.map((f, idx) => diffRenderFile(f, idx)).join('')}</div>`;
    body.scrollTop = scrollTop;

    tools.querySelector('[data-diff-fold]').addEventListener('click', () => {
      const open = !diffActiveFiles.every(f => diffCollapsedPaths.has(f.newPath));
      body.querySelectorAll('.diff-file-details').forEach(d => { d.open = !open; });
      // the toggle events land a task later; the label has to agree now
      for (const f of diffActiveFiles) { if (open) diffCollapsedPaths.add(f.newPath); else diffCollapsedPaths.delete(f.newPath); }
      diffSyncFoldButton(tools);
      announce(open ? 'Collapsed all files' : 'Expanded all files');
    });
    tools.querySelectorAll('[data-diff-mode]').forEach(button => button.addEventListener('click', () => {
      const next = button.dataset.diffMode;
      if (next === diffActiveMode) return;
      diffActiveMode = next;
      try { localStorage.setItem('orcDiffMode', next); } catch (err) {}
      diffApplyLayoutInPlace(tools);
    }));
    tools.querySelector('[data-diff-wrap]').addEventListener('click', () => {
      diffActiveWrap = !diffActiveWrap;
      try { localStorage.setItem('orcDiffWrap', diffActiveWrap ? 'on' : 'off'); } catch (err) {}
      diffApplyLayoutInPlace(tools);
    });

    diffBindCardControls(c, body);
    diffBindMedia(body);
    diffMountFiles(c, files, nextMode, nextWrap);
    diffBindReview(c, files);
    diffBindFileActions(c);
    return true;
  } catch (e) {
    return false;
  }
}

export function renderDiffPanel(api, text, runId, { truncated = false, downloadUrl = fileUrl(runId, 'diff.patch'), downloadName = 'diff.patch' } = {}) {
  const c = $('run-diff');
  if (diffReviewState.runId !== runId) {
    clearDiffViews();
    diffReviewState = diffReadReview(runId);
    diffCollapsedPaths = new Set();
    diffLoadedPaths = new Set();
  }
  // Like T3 Code, size alone never drops the styled view: big files wait
  // behind Load diff, and plain text is only for a patch the library can't
  // format or a first file that alone passes the byte limit.
  const complete = truncated ? diffCompleteFiles(text) : text;
  if (api && complete && renderDiffPatch(api, complete, c, runId, { truncated, downloadUrl, downloadName })) {
    diffReopenWriting(c);
    return;
  }
  clearDiffViews();
  const large = truncated && !complete;
  c.querySelector('#run-diff-summary').textContent = large ? 'Large diff' : 'Plain-text diff';
  c.querySelector('#run-diff-tools').innerHTML = '';
  renderTextPreview(c.querySelector('#run-diff-body'), text, {
    message: (large ? 'Large diff shown as paged plain text. '
      : api ? 'This patch could not be formatted, so it is shown as plain text. '
      : 'Diff formatting unavailable. ') +
      (truncated ? 'Preview limited to the first 8 MB. ' : '') +
      'Line comments and split view are unavailable in this preview.',
    label: 'Diff preview', downloadUrl, downloadName,
  });
}

// marked treats indented lines inside a raw-HTML block (charm-kit components)
// as indented code — swap each column-0 <div>…</div>
// block for a token before parsing, restore verbatim after. Contract
// (render-page.md): outer div opens and closes at column 0, everything inside
// stays indented. Kept in sync by hand with serve.py's PAGE_TMPL copy.
// A protected block is restored verbatim, so markdown inside it never reaches
// marked. Recaps author screenshots as ![alt](src) (orc-recap) inside a
// .before-after pane (render-page.md's charm kit) — both contracts are legal,
// so convert those images to <img> rather than making authors choose. <pre>
// and <code> spans are skipped: ![…](…) in there is sample text (a recap
// explaining this very syntax would otherwise render a broken image).
function mdImages(s) {
  return s.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/).map((part, i) => i % 2 ? part :
    part.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
      `<img alt="${q(alt)}" src="${q(src)}">`)).join('');
}
// a bare " in either half would end the attribute and turn the rest into live
// markup — the block is author-controlled, but a stray quote shouldn't
// silently mangle the tag
export function q(s) {
  return s.replace(/"/g, '&quot;');
}
// Artifacts may open with a YAML frontmatter block. marked reads its closing
// --- as a setext rule and renders the metadata as one giant heading, so drop
// a leading block; a --- divider further down the document is left alone.
export function stripFrontMatter(src) {
  return src.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '');
}
function baPane(label, alt, src) {
  return `<figure class="ba-pane"><h4>${label}</h4><img alt="${q(alt)}" src="${q(src)}"></figure>`;
}
// Ship rows stack Before/After shots as two bare adjacent images (see
// mdImages above) because the ba-pane's column-0 <div> would break the
// list; rewrite a matching pair into that same before-after/ba-pane markup
// so imgLabel/lbGroup group and label it with no lightbox change. Runs
// after protectHtml's raw-<div> extraction so an already-authored charm-kit
// pane is never rescanned, and skips fenced/inline code for the same
// reason mdImages does.
function pairBeforeAfter(s) {
  const answerMedia = /^(?:\.\/)?media\/[^/]+\.(?:png|jpe?g|gif|webp)$/i;
  const mockupPicture = /-mockup\.(?:png|jpe?g|gif|webp)$/i;
  return s.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => {
    if (i % 2) return part;
    return part.replace(
      /^([ \t]*)!\[([^\]]*)\]\(([^)\s]+)\)[ \t]*\r?\n\1!\[([^\]]*)\]\(([^)\s]+)\)[ \t]*$/gm,
      (m, indent, alt1, src1, alt2, src2) => {
        if (/(^|\/)shots\/before\//.test(src1) && /(^|\/)shots\/after\//.test(src2))
          return `${indent}<div class="before-after">${baPane('Before', alt1, src1)}${baPane('After', alt2, src2)}</div>`;
        // A question answer's pair (question_media.py): the screen today, then
        // the picture of its mockup, <label>-mockup.<ext>, as a plan shows them.
        if (answerMedia.test(src1) && answerMedia.test(src2) && mockupPicture.test(src2))
          return `${indent}<div class="before-after">${baPane('Today', alt1, src1)}${baPane('Mockup', alt2, src2)}</div>`;
        return m;
      }
    );
  }).join('');
}
export function protectHtml(src) {
  const blocks = [];
  src = src.replace(/^<div[^>]*>[\s\S]*?\n<\/div>/gm, m => {
    blocks.push(mdImages(m));
    return `\n\nORCRAWHTML${blocks.length - 1}X\n\n`;
  });
  src = pairBeforeAfter(src);
  return { src, restore: html =>
    html.replace(/(?:<p>)?ORCRAWHTML(\d+)X(?:<\/p>)?/g, (_, i) => blocks[+i]) };
}

// Markdown as HTML that is safe to put in Orc's page: every view of a run's
// files goes through here. The raw <div> blocks go back before the cleaning,
// so it sees what the browser would. Without the cleaner (its script did not
// load) the text shows as plain text, never as HTML.
export function markdownHtml(src) {
  if (typeof marked === 'undefined' || typeof window.orcSafeHtml !== 'function') return `<pre>${esc(src)}</pre>`;
  const guarded = protectHtml(src);
  return window.orcSafeHtml(guarded.restore(marked.parse(guarded.src)));
}

export function artifactHtml(text) {
  return markdownHtml(stripFrontMatter(text));
}
