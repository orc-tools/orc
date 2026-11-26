import { renderTextPreview } from './text-preview.js';
// orc-ui: artifact viewer — the diff panel's files (rendered by @pierre/diffs), markdown, logs and editors.

import { orcRegisterOverlayCloser } from './activity.js';
import { artifactLoadCanWrite, commitArtifactRender, saveScroll } from './artifact.js';

const COMMENT_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M142,128a10,10,0,1,1-10-10A10,10,0,0,1,142,128ZM88,118a10,10,0,1,0,10,10A10,10,0,0,0,88,118Zm88,0a10,10,0,1,0,10,10A10,10,0,0,0,176,118Zm54,6a98.11,98.11,0,0,1-98,98H48a14,14,0,0,1-14-14V124a98,98,0,0,1,196,0Zm-12,0a86,86,0,0,0-172,0v84a2,2,0,0,0,2,2h84A86.1,86.1,0,0,0,218,124Z"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M208,34H88A14,14,0,0,0,74,48V74H48A14,14,0,0,0,34,88V208a14,14,0,0,0,14,14H168a14,14,0,0,0,14-14V182h26a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM170,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V88a2,2,0,0,1,2-2H168a2,2,0,0,1,2,2Zm40-40a2,2,0,0,1-2,2H182V88a14,14,0,0,0-14-14H86V48a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Z"/></svg>';
const COPIED_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>';
import { CONTROL_KEY, renderControlCenter } from './control.js';
import { CHAT_KEY, mountChat } from './chat.js';
import { mediaKind } from './chat-timeline.js';
import { mediaUrl } from './assets-panel.js';
import { clipPlayback, onClipChange, stopClips } from './clip-player.js';
import { FACTORY_KEY, loadFactory, unmountFactory } from './secondary-screens.js';
import { MCP_KEY, mountMcp, unmountMcp } from './mcp-tab.js';
import { mountPlanPage, planPageShows, unmountPlanPage } from './plan-page.js';
import { $, IMG, LABELS, TAB_LABELS, VID, adrLabel, announce, artifactPageUnloading, esc, externalizeLinks, fileUrl, highlightSeverity, pendingArtifactFocus, renderedArtifactKey, resolveRelativeUrls, runs, setPendingArtifactFocus, styleTldrs, submitChord, syncArtifactTheme, versionedFileUrl } from './core.js';
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
    onLineSelectionStart: () => diffCloseComposer(),
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

function diffOpenComposer(c, files, file, targets, quote = '') {
  diffCloseComposer();
  const view = file.view;
  if (!view) return;
  const last = targets[targets.length - 1], libSide = DIFF_LIB_SIDE[last.side];
  diffComposer = { file, targets, quote, element: null };
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
  submitChord(textarea, () => composer.querySelector('[data-comment-send]'), true);
  composer.querySelector('[data-comment-cancel]').addEventListener('click', () => diffCloseComposer(true));
  composer.querySelector('[data-comment-send]').addEventListener('click', async event => {
    const direct = diffCommentFromTargets(targets, textarea.value, quote);
    if (!direct.body) return setError('Write a comment first.');
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Sending…'; setError('');
    try {
      await diffPostReview({ body: '', comments: [direct] });
      diffCloseComposer(true); announce('Comment sent to agent');
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
      const currentPanel = c.querySelector('.diff-review-panel');
      currentPanel.hidden = !diffReviewState.open;
      toolbarToggle.setAttribute('aria-expanded', String(diffReviewState.open));
      if (diffReviewState.open) currentPanel.querySelector('textarea').focus();
    });
  }
  if (panel && !panel.dataset.reviewBound) {
    panel.dataset.reviewBound = 'true';
    const reviewBody = panel.querySelector('.diff-review-body');
    reviewBody?.addEventListener('input', event => { diffReviewState.body = event.target.value; });
    if (reviewBody) submitChord(reviewBody, () => panel.querySelector('[data-review-send]'), true);
    const closeReview = () => {
      diffReviewState.open = false; panel.hidden = true; toolbarToggle?.setAttribute('aria-expanded', 'false'); toolbarToggle?.focus();
    };
    orcRegisterOverlayCloser('diff-review', closeReview);
    panel.querySelector('[data-review-close]')?.addEventListener('click', closeReview);
    // floating popover: Escape dismisses while focus is inside it
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeReview(); } });
    panel.querySelectorAll('[data-review-remove]').forEach(button => button.addEventListener('click', () => {
      const index = +button.dataset.reviewRemove;
      diffReviewState.comments.splice(index, 1);
      diffReviewState.open = true;
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
      textarea.focus();
      submitChord(textarea, () => composer.querySelector('[data-file-comment-send]'), true);
      const close = () => { composer.remove(); button.focus(); };
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
    diffReviewState = { runId, comments: [], body: '', open: false, anchor: null };
    diffCollapsedPaths = new Set();
    diffLoadedPaths = new Set();
  }
  // Like T3 Code, size alone never drops the styled view: big files wait
  // behind Load diff, and plain text is only for a patch the library can't
  // format or a first file that alone passes the byte limit.
  const complete = truncated ? diffCompleteFiles(text) : text;
  if (api && complete && renderDiffPatch(api, complete, c, runId, { truncated, downloadUrl, downloadName })) return;
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

// TESTABLE: artifact textarea drafts
function artifactTextareaDraftKey(textarea, index) {
  return textarea.id ? `id:${textarea.id}`
    : textarea.name ? `name:${textarea.name}`
    : `index:${index}`;
}

function bindArtifactTextareaDrafts(iframe, loadKey) {
  if (iframe.contentDocument.documentElement?.dataset.orcActionsLoading) return;
  const storeKey = `orc-textareas:${loadKey}`;
  const textareas = Array.from(
    iframe.contentDocument.querySelectorAll('textarea[data-orc-tab-draft]')
  ).filter(textarea => !textarea.disabled && !textarea.readOnly);
  if (!textareas.length) {
    try { sessionStorage.removeItem(storeKey); } catch {}
    return;
  }
  let drafts = {};
  try { drafts = JSON.parse(sessionStorage.getItem(storeKey) || '{}'); } catch {}
  textareas.forEach((textarea, index) => {
    const key = artifactTextareaDraftKey(textarea, index);
    textarea.addEventListener('input', () => {
      drafts[key] = textarea.value;
      try { sessionStorage.setItem(storeKey, JSON.stringify(drafts)); } catch {}
    });
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) return;
    textarea.value = drafts[key];
    textarea.dispatchEvent(new iframe.contentWindow.Event('input', { bubbles: true }));
  });
}
// END TESTABLE: artifact textarea drafts

export async function loadFile(run, key, load) {
  window.orcCloseContentFind?.();
  const c = $('content');
  const lk = run.id + '/' + key;
  if (!artifactLoadCanWrite(load)) return;
  c.removeAttribute('aria-busy');
  if (key !== FACTORY_KEY) unmountFactory();
  if (key !== MCP_KEY) unmountMcp();
  if (!planPageShows(run, key)) unmountPlanPage();
  if (key === FACTORY_KEY) {
    try {
      const factory = await loadFactory();
      if (commitArtifactRender(load)) factory.mountFactory(run, c);
    } catch (error) {
      if (artifactLoadCanWrite(load)) c.textContent = 'Could not open Factory: ' + error.message;
    }
    return;
  }
  if (key === MCP_KEY) {
    if (!commitArtifactRender(load)) return;
    mountMcp(run, c);
    return;
  }
  if (key === CONTROL_KEY) {
    if (!commitArtifactRender(load)) return;
    renderControlCenter(run, load.scrollTop);
    return;
  }
  if (key === CHAT_KEY) {
    if (!commitArtifactRender(load)) return;
    mountChat(run, c);
    return;
  }
  if (planPageShows(run, key)) {
    if (!commitArtifactRender(load)) return;
    mountPlanPage(run, c, load.scrollTop);
    return;
  }
  if (key === '__shots__') {
    const media = run.files.map(f => f.path).filter(p => (IMG.test(p) || VID.test(p)) && !p.includes('test-results/') && !p.includes('/node_modules/'));
    let manifest = [];
    if (run.files.some(f => f.path === 'shots/manifest.json')) {
      const raw = await fetch(fileUrl(run.id, 'shots/manifest.json')).then(r => r.json()).catch(() => []);
      // Schema is a bare array; tolerate the {"shots": [...]} shape some runs
      // write — a non-array here used to throw on .map and blank the tab.
      manifest = Array.isArray(raw) ? raw : Array.isArray(raw?.shots) ? raw.shots : [];
    }
    if (!artifactLoadCanWrite(load)) return;

    // Timeline: media under shots/{before,after}/<flow>-<YYYYMMDD>-<HHMMSS>[-short].<ext>.
    // A flow's captures span several revisions across the run's phases; lay
    // them oldest→newest so "what changed over time" is scannable per scene,
    // rather than dumping older revisions into one flat gallery. Runs whose
    // manifest points at flat paths (no before/after dirs) fall back to the
    // classic latest-pair table + gallery below.
    const REV = /^shots\/(before|after)\/(.+?)-(\d{8}-\d{6})(-short)?\.\w+$/;
    const flows = new Map();          // flow -> Map<rev, {before,after}>
    for (const p of media) {
      const m = REV.exec(p);
      if (!m) continue;
      const [, side, flow, rev, short] = m;
      if (!flows.has(flow)) flows.set(flow, new Map());
      const revs = flows.get(flow);
      if (!revs.has(rev)) revs.set(rev, {});
      const node = revs.get(rev);
      // one media per side per rev — prefer the full capture over its -short gif
      if (!node[side] || (!short && node[side].short)) node[side] = { path: p, short: !!short };
    }
    if (flows.size) {
      // manifest names the canonical flows (order + description + note); a
      // flow only present on disk trails after, alphabetically.
      const info = new Map(manifest.map(m => [m.label || m.flow, m]));
      const order = [...info.keys()].filter(k => flows.has(k))
        .concat([...flows.keys()].filter(k => !info.has(k)).sort());
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const fmt = rev => {
        const [d, t] = rev.split('-');
        return `${+d.slice(6)} ${MON[+d.slice(4, 6) - 1] || ''} · ${t.slice(0, 2)}:${t.slice(2, 4)}`;
      };
      const pane = (label, item, isNew) => {
        if (isNew && label === 'Before') return `<figure class="ba-pane empty"><h4>${label}</h4><span class="none">new — no baseline</span></figure>`;
        if (!item) return `<figure class="ba-pane empty"><h4>${label}</h4><span class="none">not captured</span></figure>`;
        const url = versionedFileUrl(run.id, item.path);
        const tag = VID.test(item.path)
          ? `<video src="${url}" controls muted loop aria-label="${esc(label)}"></video>`
          : `<img src="${url}" loading="lazy" alt="${esc(label)}">`;
        return `<figure class="ba-pane"><h4>${label}</h4>${tag}</figure>`;
      };
      // the whole shots/{before,after}/ subtree is the timeline (unversioned
      // aliases included, so they don't re-clutter); anything else is a loose
      // capture and keeps the old gallery so nothing is silently dropped.
      const rest = media.filter(p => !/^shots\/(before|after)\//.test(p));
      if (!commitArtifactRender(load)) return;
      c.innerHTML = `<div id="shot-timeline">` + order.map(flow => {
        const meta = info.get(flow) || {};
        const revs = [...flows.get(flow).keys()].sort();
        return `<section class="flow-track">
          <div class="flow-head">
            <h3>${esc(meta.flow || flow)}</h3>
            ${meta.flow && meta.flow !== flow ? `<code class="flow-key">${esc(flow)}</code>` : ''}
            ${meta.note ? `<p class="note">${esc(meta.note)}</p>` : ''}
          </div>
          <ol class="timeline">${revs.map((rev, i) => {
            const n = flows.get(flow).get(rev);
            const last = i === revs.length - 1;
            return `<li class="rev${last ? ' current' : ''}">
              <div class="rev-time"><span class="dot"></span><time>${fmt(rev)}</time>${last ? '<span class="tag">latest</span>' : ''}</div>
              <div class="before-after">${pane('Before', n.before, meta.new)}${pane('After', n.after)}</div>
            </li>`;
          }).join('')}</ol>
        </section>`;
      }).join('') + `</div>` +
      (rest.length ? `<div id="shots-rest"><h3>Other captures</h3><div id="shots">` + rest.map(p => {
        const url = versionedFileUrl(run.id, p);
        const tag = VID.test(p)
          ? `<video src="${url}" controls muted aria-label="${esc(p)}"></video>`
          : `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt=""></a>`;
        return `<figure>${tag}<figcaption>${esc(p)}</figcaption></figure>`;
      }).join('') + '</div></div>' : '');
      c.scrollTop = load.scrollTop;
      return;
    }

    const used = new Set();
    const cell = rel => {
      if (!rel) return '<span class="none">not captured</span>';
      const path = 'shots/' + rel;
      used.add(path);
      const url = versionedFileUrl(run.id, path);
      if (VID.test(rel)) return `<video src="${url}" controls muted aria-label="${esc(path)}"></video>`;
      return `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt="${esc(path)}"></a>`;
    };
    const rows = manifest.map(m => `<tr>
      <td><div class="flow">${esc(m.flow || m.label)}</div>${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}</td>
      <td class="media">${m.new ? '<span class="none">new in this change — no before</span>' : cell(m.before)}</td>
      <td class="media">${cell(m.after)}</td>
    </tr>`).join('');
    const rest = media.filter(p => !used.has(p));
    if (!commitArtifactRender(load)) return;
    c.innerHTML =
      (rows ? `<table id="pairs"><thead><tr><th>Flow</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
      (rest.length ? `<div id="shots-rest">${rows ? '<h3>Other captures</h3>' : ''}<div id="shots">` + rest.map(p => {
        const url = versionedFileUrl(run.id, p);
        const tag = VID.test(p)
          ? `<video src="${url}" controls muted aria-label="${esc(p)}"></video>`
          : `<a href="${url}" target="_blank"><img src="${url}" loading="lazy" alt=""></a>`;
        return `<figure>${tag}<figcaption>${esc(p)}</figcaption></figure>`;
      }).join('') + '</div></div>' : '');
    c.scrollTop = load.scrollTop;
    return;
  }
  if (key.endsWith('.html')) {
    if (!commitArtifactRender(load)) return;
    // A previous reload that never reached its own `load` event (superseded
    // by this one) left its incoming frame hidden and orphaned — drop it
    // before adding ours. At most one visible frame remains, the one this
    // load double-buffers against, if any.
    c.querySelectorAll(':scope > iframe[hidden]').forEach(node => node.remove());
    // Double-buffer only a reload of the page already on screen. Switching to
    // another run or tab drops the outgoing frame now: kept, it showed the
    // previous run's page under the new run's header until this one loaded.
    let outgoing = c.querySelector(':scope > iframe');
    if (outgoing && outgoing.dataset.planHighlightKey !== lk) { outgoing.remove(); outgoing = null; }
    c.setAttribute('aria-busy', 'true');
    if (!outgoing) {
      c.innerHTML = `<div id="empty" role="status">Loading artifact…</div>`;
      c.scrollTop = 0;
    }
    // iframe is same-origin (served by serve.py) — restore its scroll on load
    // and keep it saved as the user scrolls inside the plan/gate page. Build
    // it hidden beside any outgoing frame so the outgoing one stays on screen
    // until this one's themed document and bindings are ready, then swap:
    // unhide this frame and remove the outgoing one, never the reverse order.
    const ifr = document.createElement('iframe');
    ifr.hidden = true;
    ifr.src = fileUrl(run.id, key);
    ifr.title = TAB_LABELS[key] || key;
    ifr.setAttribute('allow', 'clipboard-write');
    ifr.dataset.planHighlightKey = lk;
    c.appendChild(ifr);
    ifr.addEventListener('load', () => {
      try {
        if (!artifactLoadCanWrite(load, ifr)) return;
        const w = ifr.contentWindow;
        if ('scrollRestoration' in w.history) w.history.scrollRestoration = 'manual';
        load.iframeAbortController?.abort();
        // EventTarget requires an AbortSignal from its own window realm.
        load.iframeAbortController = new w.AbortController();
        const iframeSignal = load.iframeAbortController.signal;
        syncArtifactTheme(ifr);
        w.addEventListener('orc-actions-ready', () => {
          if (artifactLoadCanWrite(load, ifr)) bindArtifactTextareaDrafts(ifr, lk);
        }, { once: true, signal: iframeSignal });
        bindArtifactTextareaDrafts(ifr, lk);
        if (load.scrollTop && w.document.body) {
          // A just-revealed frame can still report no scroll range. Restore
          // once the document gets a scrollable layout, before it paints.
          const observer = new w.ResizeObserver(() => {
            const root = w.document.scrollingElement;
            if (!root || root.scrollHeight <= root.clientHeight) return;
            observer.disconnect();
            if (artifactLoadCanWrite(load, ifr)) w.scrollTo(0, load.scrollTop);
          });
          observer.observe(w.document.body);
          iframeSignal.addEventListener('abort', () => observer.disconnect(), { once: true });
        }
        w.addEventListener('scroll', () => {
          if (!artifactPageUnloading && artifactLoadCanWrite(load, ifr) && renderedArtifactKey === lk) {
            saveScroll(lk, w.scrollY);
          }
        }, { passive: true, signal: iframeSignal });
        // Clicking anything in the artifact moves focus into this frame, and a
        // keydown there never reaches the shell's document — which silently
        // kills ⌘N and ⌘K. Replay modifier chords the artifact left unhandled
        // onto the shell, and swallow the original only when the shell used it
        // (otherwise the browser still gets ⌘N as "new window").
        w.addEventListener('keydown', event => {
          if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
          const replay = new KeyboardEvent('keydown', {
            key: event.key, code: event.code, bubbles: true, cancelable: true,
            metaKey: event.metaKey, ctrlKey: event.ctrlKey,
            altKey: event.altKey, shiftKey: event.shiftKey,
          });
          if (!document.dispatchEvent(replay)) event.preventDefault();
        }, { signal: iframeSignal });
      } catch {} finally {
        if (artifactLoadCanWrite(load, ifr)) {
          c.removeAttribute('aria-busy');
          c.querySelector('#empty')?.remove();
          // Unhide this frame before dropping the outgoing one so there is
          // never a frame-less instant between the two paints.
          ifr.hidden = false;
          outgoing?.remove();
        }
      }
    });
    return;
  }
  const text = await fetch(fileUrl(run.id, key)).then(r => r.ok ? r.text() : null).catch(() => null);
  if (!artifactLoadCanWrite(load)) return;
  if (text === null) {
    if (!commitArtifactRender(load)) return;
    c.innerHTML = `<div class="load-error">Couldn't load ${esc(key)} — reselect the tab to retry.</div>`;
    c.scrollTop = load.scrollTop;
    return;
  }
  if (!commitArtifactRender(load)) return;
  // The receipt is canonical JSON on one line; rendered raw it is an unreadable
  // wall of text. Any parse/shape failure leaves report null and falls through
  // to the markdown path below, so a schema change degrades instead of blanking.
  let report = null;
  if (key === 'verification-receipt.json' && typeof marked !== 'undefined') {
    try { report = receiptReport(JSON.parse(text)); } catch { report = null; }
  } else if (key === 'delivery-authority.json' && typeof marked !== 'undefined') {
    try { report = authorityReport(JSON.parse(text)); } catch { report = null; }
  }
  if (report !== null) {
    // No highlightSeverity: it only tints table cells under a severity/priority/
    // risk/impact header, and the report has no such column.
    c.innerHTML = `<article class="md">${markdownHtml(report)}</article>`;
    externalizeLinks(c);
    window.orcUpgradeCallouts(c);
    window.orcMountCodeCopy(c);
  } else if (key.endsWith('.log') || typeof marked === 'undefined') {
    c.innerHTML = `<div class="log-view"><pre>${esc(text)}</pre></div>`;
  } else {
    c.innerHTML = `<article class="md">${artifactHtml(text)}</article>`;
    resolveRelativeUrls(c, run.id, key);
    externalizeLinks(c);
    highlightSeverity(c);
    styleTldrs(c);
    window.orcUpgradeCallouts(c);
    window.orcMountCodeCopy(c);
    window.orcMountNeedsYouCommands(c, `/runs/${encodeURIComponent(run.id)}/${key}`);
    window.orcMountImageComparisons(c, key);
  }
  c.scrollTop = load.scrollTop;
  if (pendingArtifactFocus && pendingArtifactFocus.id === run.id && pendingArtifactFocus.path === key) {
    const target = c.querySelector('.md h1') || c.querySelector('.md');
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }
    announce(`Opened ${adrLabel(key)}`);
    setPendingArtifactFocus(null);
  }
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

// TESTABLE: verification receipt report
// The receipt is canonical JSON — one line, no whitespace — so the generic
// markdown fallback rendered it as a single unwrapped paragraph. Build a report
// in markdown instead and let the existing .md article styles do the layout;
// that reuses the tables, callouts and code spans already defined for every
// other artifact rather than inventing a verify-only visual language.
const RECEIPT_MARK = { pass: '✓', passed: '✓', fail: '✕', skipped: '–', 'not-applicable': '–' };
// Display order for the checks we know about. The receipt's own key set is the
// authority on which checks exist — the schema has already gained `analytics`
// once, and a check the report silently drops can leave three green sections
// under a red verdict. Anything unrecognised renders last rather than vanishing.
const RECEIPT_CHECK_ORDER = ['standards', 'spec', 'tests', 'analytics'];
const RECEIPT_CHECK_LABELS = {
  standards: 'Standards', spec: 'Spec', tests: 'Tests', analytics: 'Analytics',
};

// Free text in a receipt is model-authored, so it can carry pipes that split a
// table row or underscores that italicise. Cells get both escapes; prose only
// needs the HTML one because marked handles the rest inside a paragraph.
const receiptCell = value => esc(String(value ?? '')).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const receiptText = value => esc(String(value ?? ''));
// marked escapes HTML inside a code span, so this must NOT pre-escape — esc()
// here would render "&lt;img&gt;" literally. The only real hazard is content
// breaking *out* of the span, so drop backticks and flatten newlines; pipes
// still split a table cell from inside a span, so they escape too.
const receiptCode = value => '`'
  + String(value ?? '').replace(/`/g, '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
  + '`';

const receiptStatusMark = status => RECEIPT_MARK[status] || '';

// "not-applicable" -> "Not applicable": sentence case, not title case. Kept
// separate from the mark so a heading can lead with the glyph without
// stacking two dashes.
function receiptStatusName(status) {
  const words = String(status || 'unknown').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function receiptStatusLabel(status) {
  const mark = receiptStatusMark(status);
  return (mark ? mark + ' ' : '') + receiptStatusName(status);
}

function receiptWhen(value) {
  // Receipt timestamps are ISO-8601 Zulu; anything else prints verbatim rather
  // than becoming "Invalid Date".
  const at = value ? new Date(value) : null;
  return at && !isNaN(at) ? at.toLocaleString() : String(value || '');
}

function receiptDuration(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return '';
  const secs = Math.max(0, Math.round((b - a) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function receiptCheckSection(key, name, entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') {
    out.push(`## ${name}\n\nThis check is missing from the receipt.`);
    return out.join('\n');
  }
  const status = entry.applicable === false ? 'not-applicable' : entry.status;
  const mark = receiptStatusMark(status);
  out.push(`## ${mark ? mark + ' ' : ''}${name} — ${receiptStatusName(status)}`);
  if (entry.summary) out.push(receiptText(entry.summary));

  const concerns = entry.concerns && typeof entry.concerns === 'object'
    ? Object.entries(entry.concerns) : [];
  if (concerns.length) {
    out.push(concerns
      .map(([k, v]) => `${receiptText(k.replace(/([A-Z])/g, ' $1').toLowerCase())} ${receiptStatusLabel(v)}`)
      .join(' · '));
  }
  if (Array.isArray(entry.considered) && entry.considered.length) {
    out.push('Considered: ' + entry.considered.map(receiptCode).join(', '));
  }

  // An inapplicable check reports no findings: whatever it left behind describes
  // a review that did not run against this diff.
  const findings = entry.applicable === false || !Array.isArray(entry.findings) ? [] : entry.findings;
  if (findings.length) {
    out.push('### Findings');
    // Repair findings are plain strings; check findings have carried objects in
    // the wild, so read the usual fields and fall back to JSON rather than "[object Object]".
    out.push(findings.map(f => {
      if (typeof f === 'string') return `- ${receiptText(f)}`;
      if (!f || typeof f !== 'object') return `- ${receiptText(f)}`;
      const head = [f.severity, f.title || f.summary].filter(Boolean).map(receiptText).join(' — ');
      const where = f.file ? ` (${receiptCode(f.file + (f.line ? ':' + f.line : ''))})` : '';
      return `- ${head || receiptText(JSON.stringify(f))}${where}`;
    }).join('\n'));
  }

  // Keyed off the receipt key, not the display label: renaming a label must not
  // silently delete the suite table.
  if (key === 'tests') {
    const suites = Array.isArray(entry.initialSuites) ? entry.initialSuites : [];
    if (suites.length) {
      // Header and rows are one block: a blank line between them ends the table.
      out.push('| Participant | Command | Result | Exit | Duration |\n|---|---|---|---|---|\n'
        + suites.map(s => '| ' + [
          receiptCell(s.participantId),
          receiptCode(s.command),
          receiptCell(s.result),
          receiptCell(s.exitCode),
          receiptCell(receiptDuration(s.startedAt, s.completedAt)),
        ].join(' | ') + ' |').join('\n'));
    }
    const limits = Array.isArray(entry.environmentLimitations) ? entry.environmentLimitations : [];
    if (limits.length) {
      out.push('### Environment limitations');
      out.push(limits.map(l => `- ${receiptText(l)}`).join('\n'));
    }
    const added = Array.isArray(entry.coverageAdditions) ? entry.coverageAdditions : [];
    if (added.length) {
      out.push('### Coverage added');
      out.push(added.map(a => `- ${receiptText(typeof a === 'string' ? a : JSON.stringify(a))}`).join('\n'));
    }
  }
  return out.join('\n\n');
}

// Returns markdown, or null when the input is not a receipt object — callers
// fall back to the raw rendering so the tab can never come up blank.
function receiptReport(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (!receipt.checks || typeof receipt.checks !== 'object') return null;

  const passed = receipt.status === 'pass';
  const out = [];
  const heads = Array.isArray(receipt.finalHeads) ? receipt.finalHeads : [];
  const headLine = heads
    .map(h => `${receiptText(h.participantId)} at <code>${receiptText(String(h.head || '').slice(0, 7))}</code>`)
    .join(' · ');
  out.push(`<div class="callout ${passed ? 'green' : 'red'}">`
    + `<p><strong>${passed ? 'Verification passed' : 'Verification failed'}</strong>`
    + ` — ${receiptText(receiptWhen(receipt.evaluatedAt))}</p>`
    + (headLine ? `<p>${headLine}</p>` : '')
    + '</div>');

  // On a failure the reason is what you came for, so failing checks lead. Within
  // each group the canonical order holds (sort is stable), and any check the
  // receipt carries that we have no label for still renders, at the end.
  const keys = Object.keys(receipt.checks).sort((a, b) => {
    const ai = RECEIPT_CHECK_ORDER.indexOf(a), bi = RECEIPT_CHECK_ORDER.indexOf(b);
    return (ai < 0 ? RECEIPT_CHECK_ORDER.length : ai) - (bi < 0 ? RECEIPT_CHECK_ORDER.length : bi);
  }).sort((a, b) =>
    (receipt.checks[b]?.status === 'fail') - (receipt.checks[a]?.status === 'fail'));
  for (const key of keys) {
    const label = RECEIPT_CHECK_LABELS[key] || receiptStatusName(key);
    out.push(receiptCheckSection(key, label, receipt.checks[key]));
  }

  const repairs = Array.isArray(receipt.repairs) ? receipt.repairs : [];
  if (repairs.length) {
    out.push('## Repairs');
    // The schema allows one repair; it carries affectedChecks/commits/findings,
    // never a bare head. What matters is which findings it answered and which
    // checks it invalidated.
    out.push(repairs.map(r => {
      const findings = Array.isArray(r.findings) ? r.findings : [];
      const affected = Array.isArray(r.affectedChecks) ? r.affectedChecks : [];
      const commits = Array.isArray(r.commits) ? r.commits : [];
      const meta = [
        affected.length && 'invalidated ' + affected.map(receiptText).join(', '),
        commits.length && commits.map(c => receiptCode(String(c.sha || c).slice(0, 7))).join(', '),
      ].filter(Boolean).join(' · ');
      return (r.summary ? receiptText(r.summary) : 'Repair pass')
        + (meta ? ` — ${meta}` : '')
        + (findings.length ? '\n' + findings.map(f => `- ${receiptText(f)}`).join('\n') : '');
    }).join('\n\n'));
  }

  const reruns = Array.isArray(receipt.reruns) ? receipt.reruns : [];
  if (reruns.length) {
    out.push('## Reruns');
    // invalidatedBy is the required field and carries the reason for the rerun.
    out.push(reruns.map(r =>
      `- ${receiptText(r.check || 'check')} — ${receiptStatusLabel(r.status)}`
      + (r.invalidatedBy ? `: ${receiptText(r.invalidatedBy)}` : '')).join('\n'));
  }

  const handsOn = receipt.handsOn && typeof receipt.handsOn === 'object' ? receipt.handsOn : null;
  out.push('## Hands-on');
  if (!handsOn) {
    // Absent is not the same as applicable:false — do not assert a fact the
    // receipt never recorded.
    out.push('The receipt records no hands-on section.');
  } else if (handsOn.applicable === false) {
    out.push('Not applicable — no user-visible change.');
  } else {
    out.push(receiptStatusLabel(handsOn.status)
      + (handsOn.appAvailable === false ? ' — the app was not available' : ''));
    if (handsOn.overrideReason) out.push(receiptText(handsOn.overrideReason));
    const flows = Array.isArray(handsOn.flows) ? handsOn.flows : [];
    if (flows.length) out.push(flows.map(f => `- ${receiptText(f)}`).join('\n'));
  }

  const recovery = receipt.recovery && typeof receipt.recovery === 'object' ? receipt.recovery : null;
  if (recovery) {
    out.push('## Recovery');
    out.push(`${receiptText(recovery.kind || 'recovery')} — ${receiptStatusLabel(recovery.status)}`);
    const actions = Array.isArray(recovery.actions) ? recovery.actions : [];
    if (actions.length) out.push(actions.map(a => `- ${receiptText(a)}`).join('\n'));
    if (recovery.priorReceipt?.reason) {
      out.push(`Prior attempt failed: ${receiptText(recovery.priorReceipt.reason)}`);
    }
  }

  const rows = [
    ['Diff digest', receipt.diffDigest && receiptCode(String(receipt.diffDigest).slice(0, 12))],
    ['Plan source digest', receipt.planSourceDigest && receiptCode(String(receipt.planSourceDigest).slice(0, 12))],
    ['Ticket evidence', receipt.ticketEvidence?.path && receiptCode(receipt.ticketEvidence.path)],
    // != null, not truthiness: generation 0 is a real value.
    ['Generation', receipt.generation != null && receiptCell(receipt.generation)],
    // Each half is guarded separately — one without the other used to print
    // "lifecycle vundefined".
    ['Schema', [
      receipt.schemaVersion != null && `v${receiptCell(receipt.schemaVersion)}`,
      receipt.lifecycleVersion != null && `lifecycle v${receiptCell(receipt.lifecycleVersion)}`,
    ].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);
  if (rows.length) {
    out.push('## Provenance');
    out.push('| Field | Value |\n|---|---|\n'
      + rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n'));
  }
  return out.join('\n\n');
}
// END TESTABLE: verification receipt report

function authorityReport(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
      || authority.lifecycleVersion !== 4 || !Array.isArray(authority.buildProof)) return null;
  const handsOn = authority.handsOn && typeof authority.handsOn === 'object'
    ? authority.handsOn : null;
  const blocked = handsOn?.state === 'blocked';
  const out = [
    `<div class="callout ${blocked ? 'red' : 'green'}"><p><strong>${blocked ? 'Delivery blocked' : 'Build authority ready'}</strong> — ${receiptText(receiptWhen(authority.publishedAt))}</p></div>`,
    '## Targeted Build proof',
  ];
  authority.buildProof.forEach(proof => {
    out.push(`### ${receiptText(proof.participantId || 'participant')} at <code>${receiptText(String(proof.head || '').slice(0, 7))}</code>`);
    const commands = Array.isArray(proof.commands) ? proof.commands : [];
    out.push(commands.length
      ? '| Command | Result | Exit |\n|---|---|---|\n' + commands.map(command => `| ${receiptCode(command.command)} | ${receiptText(command.result)} | ${receiptCell(command.exitCode)} |`).join('\n')
      : 'No targeted command proof was recorded.');
  });
  out.push('## Hands-on');
  if (!handsOn) out.push('No hands-on state was recorded.');
  else if (handsOn.applicable === false) out.push('Not applicable — no user-visible change.');
  else {
    out.push(receiptStatusLabel(handsOn.state));
    if (handsOn.overrideReason) out.push(receiptText(handsOn.overrideReason));
    if (Array.isArray(handsOn.flows) && handsOn.flows.length) {
      out.push(handsOn.flows.map(flow => `- ${receiptText(flow)}`).join('\n'));
    }
  }
  out.push('## Provenance');
  out.push('| Field | Value |\n|---|---|\n' + [
    ['Plan', authority.plan?.sha256],
    ['Diff', authority.diff?.sha256],
    ['Ticket evidence', authority.ticketEvidence?.sha256],
  ].filter(([, value]) => value).map(([label, value]) => `| ${label} | ${receiptCode(String(value).slice(0, 12))} |`).join('\n'));
  return out.join('\n\n');
}
