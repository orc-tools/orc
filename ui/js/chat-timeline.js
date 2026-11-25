// orc-ui: Chat timeline rules. Turns the items GET /api/runs/<id>/chat reads
// out of a run's transcript into the rows the Chat tab draws. It touches no
// DOM and fetches nothing, so the rules are testable on their own.
//
// A turn starts at a prompt (or a notice the agent answers, like a finished
// background task) and runs to the next one. While the agent works, its turn
// shows everything, newest tool call live at the bottom. Once a turn settles
// it folds to "Worked for 1m 2s" above its final reply, so the conversation
// reads as a conversation; errors and the final reply stay out of the fold.

const PLURAL = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CATEGORY_SUMMARY = {
  command: n => `ran ${PLURAL(n, 'command')}`,
  edit: n => `edited ${PLURAL(n, 'file')}`,
  read: n => `read ${PLURAL(n, 'file')}`,
  search: n => `searched ${PLURAL(n, 'time')}`,
  web: n => `used the web ${PLURAL(n, 'time')}`,
  agent: n => `ran ${PLURAL(n, 'agent')}`,
  mcp: n => `called ${PLURAL(n, 'tool')}`,
  question: n => `asked ${PLURAL(n, 'question')}`,
  skill: n => `loaded ${PLURAL(n, 'skill')}`,
  todo: () => 'updated the task list',
  other: n => `used ${PLURAL(n, 'tool')}`,
};
// Commands and edits lead a summary: they are what changed something.
const SUMMARY_LEAD = ['command', 'edit'];
// Distinct files, not calls: three edits to one file "edited 1 file".
const COUNT_DISTINCT = new Set(['edit', 'read']);

// "850ms", "4.2s", "42s", "3m 5s", "1h 2m"
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

// The live "Working for" counter: whole seconds, then the duration format.
export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  return ms < 60000 ? `${Math.floor(ms / 1000)}s` : formatDuration(ms);
}

const joinPhrases = parts => parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

export function summarizeWork(items) {
  const tools = items.filter(item => item.kind === 'tool');
  if (!tools.length) {
    const ms = items.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    return ms ? `Thought for ${formatDuration(ms)}` : 'Thought';
  }
  const counts = new Map();
  for (const tool of tools) {
    const category = CATEGORY_SUMMARY[tool.category] ? tool.category : 'other';
    if (!counts.has(category)) counts.set(category, new Set());
    counts.get(category).add(COUNT_DISTINCT.has(category) ? tool.title : tool.id);
  }
  const rank = category => {
    const lead = SUMMARY_LEAD.indexOf(category);
    return lead >= 0 ? lead : category === 'other' ? SUMMARY_LEAD.length + 1 : SUMMARY_LEAD.length;
  };
  const ranked = [...counts.keys()].sort((a, b) =>
    rank(a) - rank(b) || counts.get(b).size - counts.get(a).size);
  const shown = ranked.slice(0, 2).map(category => CATEGORY_SUMMARY[category](counts.get(category).size));
  const rest = ranked.slice(2).reduce((sum, category) => sum + counts.get(category).size, 0);
  if (rest) shown.push(`${PLURAL(rest, 'other action')}`);
  return capitalize(joinPhrases(shown));
}

// One tool line as {verb, subject, mono}: the verb in prose, the subject (a
// command, path or pattern) as the thing the agent touched.
export function workLabel(item, live = false) {
  if (item.kind === 'thinking') {
    if (live) return { verb: 'Thinking', subject: '', mono: false };
    return { verb: item.durationMs ? `Thought for ${formatDuration(item.durationMs)}` : 'Thought', subject: '', mono: false };
  }
  const running = item.status === 'running';
  const verb = (present, past) => running ? present : past;
  const subject = item.title || '';
  switch (item.category) {
    case 'command': return { verb: verb('Running', 'Ran'), subject, mono: true };
    case 'read': return { verb: verb('Reading', 'Read'), subject, mono: true };
    case 'edit': return { verb: verb('Editing', 'Edited'), subject, mono: true };
    case 'search': return { verb: verb('Searching', 'Searched'), subject, mono: true };
    case 'web': return { verb: verb('Fetching', 'Fetched'), subject, mono: false };
    case 'agent': return { verb: verb('Running agent', 'Ran agent'), subject, mono: false };
    case 'mcp': return { verb: verb('Calling', 'Called'), subject, mono: false };
    case 'question': return { verb: 'Asked', subject, mono: false };
    case 'skill': return { verb: verb('Loading skill', 'Loaded skill'), subject, mono: true };
    case 'todo': return { verb: 'Updated the task list', subject: '', mono: false };
    case 'plan': return { verb: 'Proposed a plan', subject: '', mono: false };
    default: return { verb: verb('Using', 'Used'), subject: subject || item.name || 'a tool', mono: false };
  }
}

// A message that reached the agent mid-turn (steer) joins that turn.
// A silent handoff starts the replacement session's turn without drawing a user bubble.
const startsTurn = item => (item.kind === 'user' && !item.steer)
  || (item.kind === 'notice' && item.turn === true)
  || item.kind === 'handoff';
const endsTurn = item => item.kind === 'turn-end' || item.kind === 'interrupt';

// Whether the transcript itself says the agent finished its latest turn.
export function transcriptSettled(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (endsTurn(item)) return true;
    if (item.kind === 'notice' && !item.turn) continue;
    if (item.kind === 'compaction') continue;
    return false;
  }
  return false;
}

// A run counts as left alone once its conversation has been quiet this long.
export const CATCH_UP_IDLE_DAYS = 3;
const DAY_MS = 86400000;

// What the Chat shows about catching up: the saved summary while nothing has
// been said since it was written, else the offer to write one for a run left
// alone, else nothing.
export function catchUpState(items, saved, { now = Date.now(), working = false } = {}) {
  let last = NaN;
  for (let i = items.length - 1; i >= 0 && Number.isNaN(last); i--) last = Date.parse(items[i].at || '');
  if (Number.isNaN(last)) return null;
  if (saved?.text && Date.parse(saved.at || '') >= last) return { summary: saved };
  const days = Math.floor((now - last) / DAY_MS);
  return !working && days >= CATCH_UP_IDLE_DAYS ? { offer: true, days } : null;
}

// A prompt the heartbeat has not caught up with yet still reads as work.
const FRESH_PROMPT_MS = 20000;
export function chatWorking({ items = [], sessionRunning = false, sessionIdle = false, starting = false, now = Date.now() } = {}) {
  if (starting) return true;
  if (sessionIdle) return false;
  if (!items.length) return sessionRunning;
  if (transcriptSettled(items)) return false;
  if (sessionRunning) return true;
  const prompt = [...items].reverse().find(startsTurn);
  const at = prompt && Date.parse(prompt.at);
  return Number.isFinite(at) && now - at < FRESH_PROMPT_MS;
}

export function splitTurns(items) {
  const turns = [];
  let turn = { prompt: null, body: [] };
  for (const item of items) {
    if (item.kind === 'model-switch') {
      if (turn.prompt || turn.body.length) turns.push(turn);
      turns.push({ divider: item, prompt: null, body: [] });
      turn = { prompt: null, body: [] };
    } else if (startsTurn(item)) {
      if (turn.prompt || turn.body.length) turns.push(turn);
      turn = { prompt: item, body: [] };
    } else {
      turn.body.push(item);
    }
  }
  if (turn.prompt || turn.body.length) turns.push(turn);
  return turns;
}

// Per path, summed across a turn's edits.
export function changedFiles(items) {
  const files = new Map();
  for (const item of items) {
    if (item.kind !== 'tool' || !Array.isArray(item.files)) continue;
    for (const file of item.files) {
      if (!file || !file.path) continue;
      const entry = files.get(file.path) || { path: file.path, additions: 0, deletions: 0 };
      if (file.fullPath) entry.fullPath = file.fullPath;
      entry.additions += Number(file.additions) || 0;
      entry.deletions += Number(file.deletions) || 0;
      files.set(file.path, entry);
    }
  }
  return [...files.values()];
}

// run_files.MEDIA_TYPES in ui/run_files.py, which serves them.
const MEDIA_FILES = [
  ['audio', /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/i],
  ['video', /\.(mp4|m4v|webm|mov|ogv)$/i],
  ['image', /\.(png|jpe?g|webp|gif|bmp|avif)$/i],
];

// 'audio', 'video' or 'image' for a file the media route serves, else null.
export function mediaKind(path) {
  return MEDIA_FILES.find(([, pattern]) => pattern.test(path))?.[0] || null;
}

// Per file in a run's diff.patch, in patch order. Only hunk lines count, so a
// removed "--- x" line is a deletion, not a header. A media file carries its
// kind, so the card can play it and the Assets tab can list it. One the diff
// deletes is `removed` and carries the blob git still holds it under; without
// that id nothing can show it, so it is no asset. A symlink that became a file
// is a deleted link and a new file under one path: only the file is an asset.
export function diffFiles(patch) {
  const files = [];
  let file = null;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const head = line.match(/^diff --git a\/.* b\/(.*)$/);
    if (head) {
      file = { path: head[1], additions: 0, deletions: 0 };
      const media = mediaKind(file.path);
      if (media) file.media = media;
      files.push(file);
      inHunk = false;
    } else if (!file) {
      continue;
    } else if (!inHunk && line.startsWith('deleted file mode')) {
      if (file.media && /^deleted file mode 100(?:644|755)$/.test(line)) file.removed = true;
      else delete file.media;
    } else if (!inHunk && file.removed && line.startsWith('index ')) {
      const blob = /^index ((?:[0-9a-f]{40}|[0-9a-f]{64}))\.\./.exec(line)?.[1];
      if (blob) file.blob = blob;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      file.additions++;
    } else if (inHunk && line.startsWith('-')) {
      file.deletions++;
    }
  }
  for (const removed of files) {
    if (!removed.removed || removed.blob) continue;
    delete removed.media;
    delete removed.removed;
  }
  return files;
}

// Audio and video play in turn, as one run's clips; images only show.
export const isClip = file => file.media === 'audio' || file.media === 'video';
// The clips a run made or changed, which the chat's play button runs through.
// A removed clip plays only from the Assets tab and the diff.
export const madeClips = files => files.filter(file => isClip(file) && !file.removed).map(file => file.path);

// Audio and video a run saved in its own folder rather than its repository,
// such as voice takes waiting on an audition: no diff or edit names them, so
// they come from the run's file list, and play from the run folder.
// Captures under shots/ are proof of a change, not something it made.
export function runFolderClips(runFiles) {
  return (runFiles || [])
    .filter(file => typeof file?.path === 'string' && !file.path.startsWith('shots/'))
    .map(file => ({ path: file.path, media: mediaKind(file.path), runFolder: true }))
    .filter(isClip);
}

const FILES_SHOWN = 8;

// `folderClips` are the run folder's own clips, which play after the
// changed ones; a path the change already has plays once, from the change.
function filesRow(id, files, { expanded, fromDiff, hasDiff, folderClips = [] }) {
  const moreId = `${id}:more`;
  const shown = expanded.has(moreId) ? files : files.slice(0, FILES_SHOWN);
  const changed = madeClips(files);
  const runFolder = folderClips.map(clip => clip.path).filter(path => !changed.includes(path));
  return {
    kind: 'files', id, files: shown, count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    more: files.length - shown.length, moreId, collapsible: files.length > FILES_SHOWN, fromDiff, hasDiff,
    clips: [...changed, ...runFolder], runFolderClips: runFolder,
    assets: files.filter(file => file.media).length + runFolder.length,
  };
}

function turnDuration(turn) {
  const end = turn.body.find(item => item.kind === 'turn-end');
  if (end && Number.isFinite(end.durationMs)) return end.durationMs;
  const start = Date.parse(turn.prompt?.at);
  const last = Date.parse([...turn.body].reverse().find(item => item.at)?.at);
  return Number.isFinite(start) && Number.isFinite(last) && last >= start ? last - start : null;
}

// A stopped turn Orc paused, for whom ('queue' or 'you'), by turn index. Orc
// notes a pause just after its interrupt lands, and some harnesses stamp the
// interrupt a moment later still, so each pause goes to the stop nearest it
// in time, within PAUSE_SLACK_MS. A stop with no pause by it was Stop.
const PAUSE_SLACK_MS = 30000;
function pausedTurns(turns, pauses) {
  const found = new Map();
  if (!pauses?.length) return found;
  const stops = turns.flatMap((turn, index) => {
    const at = Date.parse(turn.body?.find(item => item.kind === 'interrupt')?.at);
    return Number.isFinite(at) ? [{ index, at }] : [];
  });
  for (const pause of pauses) {
    const at = Date.parse(pause.at);
    if (!Number.isFinite(at)) continue;
    let nearest = null;
    for (const stop of stops) {
      const gap = Math.abs(stop.at - at);
      if (gap <= PAUSE_SLACK_MS && (!nearest || gap < nearest.gap)) nearest = { index: stop.index, gap };
    }
    if (nearest) found.set(nearest.index, pause.by);
  }
  return found;
}

// Out of a settled turn's fold: its final reply, anything that went wrong,
// and anything the person said into it.
const staysVisible = (item, terminal) => item === terminal || item.kind === 'user' || (item.kind !== 'tool' && item.images?.length > 0)
  || item.kind === 'compaction' || item.kind === 'interrupt' || item.kind === 'auto-merge'
  || (item.kind === 'notice' && item.tone !== 'info')
  || (item.kind === 'tool' && item.category === 'plan');

// An empty thought between two tool calls is the model pausing, not news. It
// only shows when a group has nothing else to say.
function groupItems(group) {
  const meaningful = group.filter(item => item.kind !== 'thinking' || item.text);
  return meaningful.length ? meaningful : group;
}

// Agents end replies with an "Open in Orc.app" link so a terminal reader can
// jump to the run. Read in Orc, that link leads back to where the reader is,
// so the Chat drops lines holding nothing else. Links to answer.md stay: they
// open the answer panel. Lines inside a code fence stay too.
const APP_LINK_LINE = /^\s*\[Open in Orc(?:\.app)?\]\(\s*<?([^)\s>]+)>?\s*\)\s*$/i;
export function withoutAppLinks(text) {
  let fenced = false;
  const lines = String(text || '').split('\n');
  const kept = lines.filter(line => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const link = !fenced && APP_LINK_LINE.exec(line);
    return !link || /\/answer\.md$/i.test(link[1]);
  });
  return kept.length === lines.length ? text : kept.join('\n').trim();
}

// Mid-turn sync nudges older Orc servers steered into busy Build turns.
// Conflict and dirty-overlap prompts carry different wording and stay visible.
const BUILD_SYNC_NUDGE = /^\[Orc\] \S+ moved to [0-9a-f]{7,} while you are building\. Once your current edit is saved, run `orc-sync-main --run-dir [^\n`]+` to merge \S+ into this worktree(?:, settle any conflict while you have the context, and reset buildBaseCommit)?\.$/;

export function isBuildSyncNudge(item) {
  return item?.kind === 'user'
    && !item.attachments?.length
    && !item.imageCount
    && BUILD_SYNC_NUDGE.test((item.text || '').trim());
}

// A reply that was only such a link draws no row at all, and previously
// delivered mid-turn main-moved sync nudges stay hidden in Chat.
function shownItems(items) {
  return items.flatMap(item => {
    if (isBuildSyncNudge(item)) {
      return item.steer ? [] : [{ id: item.id, kind: 'handoff', at: item.at }];
    }
    if (item.kind !== 'assistant' || !item.text) return [item];
    const text = withoutAppLinks(item.text);
    if (text === item.text) return [item];
    return text ? [{ ...item, text }] : [];
  });
}

// Context-window errors say "context limit" too, so match only usage, rate,
// quota, and timed reset notices.
const QUOTA_NOTICE = /\b(?:quota|rate[-_ ]limit(?:ed|_error)?|usage limit|(?:daily|weekly|monthly|session) limit|hit your (?:[\w-]+ )?limit|resets?\s+(?:in|at|after)\b)|·\s*resets?\b/i;
const STREAM_INTERRUPT_NOTICE = /\b(?:stream\s+(?:was\s+)?(?:interrupted|disconnected|closed|lost|reset|ended\s+(?:unexpectedly|prematurely))|connection\s+(?:was\s+)?(?:interrupted|lost|reset|dropped)|econnreset)\b/i;
const UNIT_MS = {
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
  d: 86400000, day: 86400000, days: 86400000,
};
const RELATIVE_RESET = /\b(?:resets?\s+(?:in|after)|(?:try again|retry)\s+(?:in|after))\s+((?:\d+(?:\.\d+)?\s*(?:ms|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|[smhd])(?![a-z])(?:[\s,]+(?:and\s+)?)?)+)/i;
const DURATION_PART = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|[smhd])(?![a-z])/gi;
const CLOCK_RESET = /(?:·\s*resets?|\bresets?\s+at|\bresets?(?=\s+\d{1,2}(?::\d{2}|\s*(?:am|pm)\b))|\btry again at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\))?/i;

export function isQuotaNotice(item) {
  return item?.kind === 'notice' && item.tone === 'error' && QUOTA_NOTICE.test(item.text || '');
}

export function isStreamInterruptNotice(item) {
  return item?.kind === 'notice' && item.tone === 'error' && STREAM_INTERRUPT_NOTICE.test(item.text || '');
}

function zonedClockMs(year, month, day, hour, minute, formatter) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offsetAt = ms => {
    const parts = Object.fromEntries(formatter.formatToParts(ms).map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

export function quotaResetAt(item) {
  if (!isQuotaNotice(item)) return null;
  const text = String(item.text || '');
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return Number(epoch[1]) * 1000;
  const base = Date.parse(item.at);
  if (!Number.isFinite(base)) return null;
  const relative = RELATIVE_RESET.exec(text);
  if (relative) {
    let total = 0;
    for (const match of relative[1].matchAll(DURATION_PART)) {
      total += Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
    }
    return total > 0 ? base + total : null;
  }
  const clock = CLOCK_RESET.exec(text);
  if (!clock || (!clock[2] && !clock[3])) return null;
  const rawHour = Number(clock[1]);
  const minute = clock[2] ? Number(clock[2]) : 0;
  const meridiem = clock[3]?.toLowerCase() || null;
  if (minute > 59 || (meridiem ? rawHour < 1 || rawHour > 12 : rawHour > 23)) return null;
  const hour = meridiem ? (rawHour % 12) + (meridiem === 'pm' ? 12 : 0) : rawHour;
  if (!clock[4]) {
    const next = new Date(base);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= base) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: clock[4], year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const parts = Object.fromEntries(formatter.formatToParts(base).map(part => [part.type, Number(part.value)]));
    let candidate = zonedClockMs(parts.year, parts.month, parts.day, hour, minute, formatter);
    if (candidate <= base) candidate = zonedClockMs(parts.year, parts.month, parts.day + 1, hour, minute, formatter);
    return candidate;
  } catch {
    return null;
  }
}

const isAgentWork = item => item.kind === 'tool' || item.kind === 'thinking' || item.kind === 'assistant';
const isErrorNotice = item => item.kind === 'notice' && item.tone === 'error';

function noticeDividerSpec(item) {
  if (isQuotaNotice(item)) return { kind: 'quota-reset', text: 'Quota reset', match: isQuotaNotice };
  if (isStreamInterruptNotice(item)) return { kind: 'stream-resumed', text: 'Stream resumed', match: isStreamInterruptNotice };
  return null;
}

function passedNoticeDividers(turns, working, now) {
  const afterNotice = new Map();
  const afterTurn = new Map();
  const switchedAfterNotice = new Set();
  turns.forEach((turn, turnIndex) => {
    if (turn.divider || !turn.body.some(item => item.kind === 'notice')) return;
    const active = turnIndex === turns.length - 1 && working;
    const laterSlice = turns.slice(turnIndex + 1);
    const nextSwitchIndex = laterSlice.findIndex(later => Boolean(later.divider));
    const hasSwitchAfter = nextSwitchIndex !== -1;
    const laterSameSession = hasSwitchAfter ? laterSlice.slice(0, nextSwitchIndex) : laterSlice;
    turn.body.forEach((item, itemIndex) => {
      const spec = noticeDividerSpec(item);
      if (!spec) return;
      if (spec.kind === 'quota-reset' && hasSwitchAfter) {
        switchedAfterNotice.add(item.id);
      }
      const restInTurn = turn.body.slice(itemIndex + 1);
      // Consecutive retries that hit the same wall with no agent work between
      // them collapse onto the last notice in that streak.
      let superseded = false;
      for (const next of [...restInTurn, ...laterSameSession.flatMap(later => later.body)]) {
        if (isAgentWork(next)) break;
        if (spec.match(next)) { superseded = true; break; }
      }
      if (superseded) return;
      const resumedInTurn = restInTurn.some(isAgentWork);
      const resumedLater = laterSameSession.some(later => later.body.some(isAgentWork));
      const activeAfter = !hasSwitchAfter && working && turns.length - 1 > turnIndex
        && !turns.at(-1).divider && !turns.at(-1).body.some(isErrorNotice);
      const resetAt = spec.kind === 'quota-reset' && !hasSwitchAfter ? quotaResetAt(item) : null;
      const clockPassed = resetAt !== null && now >= resetAt;
      if (!resumedInTurn && !resumedLater && !activeAfter && !clockPassed) return;
      const id = `${spec.kind}:${item.id}`;
      const divider = { kind: 'divider', id, item: { id, kind: spec.kind, text: spec.text } };
      if (resumedInTurn || active) afterNotice.set(item.id, divider);
      else afterTurn.set(turnIndex, divider);
    });
  });
  return { afterNotice, afterTurn, switchedAfterNotice };
}

const autoMergeRow = item => ({ kind: 'auto-merge', id: `auto-merge:${item.id}`, item });

// Puts the flips that happened during a turn where they happened in it: the
// ones before its first step under the prompt (`lead`), the rest among its
// steps, and any made since its newest step last (`since`).
function placeFlips(turn, flips) {
  const lead = [], since = [], inside = [...turn.body];
  for (const flip of flips) {
    const at = Date.parse(flip.at);
    const next = inside.findIndex(item => Date.parse(item.at) > at);
    if (next === 0 || Date.parse(turn.prompt?.at) >= at) lead.push(flip);
    else if (next === -1) since.push(flip);
    else inside.splice(next, 0, flip);
  }
  return { lead, since, inside };
}

// A live turn draws each group as a log of its latest steps (`log`), so a
// group a reply closes keeps its lines instead of turning into a summary.
export function groupRows(items, { live = false, afterNotice = null, switchedAfterNotice = null } = {}) {
  const rows = [];
  let group = null;
  for (const item of items) {
    if ((item.kind === 'tool' && item.category !== 'plan') || item.kind === 'thinking') {
      if (!group) {
        group = { kind: 'work', id: `work:${item.id}`, items: [], log: live };
        rows.push(group);
      }
      group.items.push(item);
      continue;
    }
    group = null;
    if (item.kind === 'assistant') rows.push({ kind: 'assistant', id: item.id, item });
    else if (item.kind === 'user') rows.push({ kind: 'user', id: item.id, item });
    else if (item.kind === 'tool') rows.push({ kind: 'plan', id: item.id, item });
    else if (item.kind === 'notice') {
      const showQuotaAction = isQuotaNotice(item) && !switchedAfterNotice?.has(item.id);
      rows.push({ kind: 'notice', id: item.id, item, ...(showQuotaAction && { quota: true }) });
      const divider = afterNotice?.get(item.id);
      if (divider) rows.push(divider);
    }
    else if (item.kind === 'compaction') rows.push({ kind: 'divider', id: item.id, item });
    else if (item.kind === 'interrupt') rows.push({ kind: 'interrupt', id: item.id, item });
    else if (item.kind === 'auto-merge') rows.push(autoMergeRow(item));
  }
  for (const row of rows) {
    if (row.kind === 'work') row.items = groupItems(row.items);
  }
  return rows;
}

// Every row the Chat tab draws, in order.
//   items          transcript items in transcript order
//   working        the agent is on a turn right now
//   expanded       row ids the reader opened
//   startPrompt    {text, attachments} the run launched with, shown until the
//                  transcript records its first prompt
//   launch         {state, error} while a composer launch is still reporting
//   queued/outbox  messages waiting for the turn's end / on their way
//   queueStranded  the run's status no longer lets the queue go
//   queueError     why the last attempt to send the queue failed
//   turnFailure    {turn, error} when the latest turn failed, offered for Retry
//   permissionFallback {requested, effective, reason} when Claude settings
//                  stepped the launch's permission mode down
//   answer         a published answer.md, the reply to show when the
//                  conversation itself cannot be read
//   diffFiles      the run's diff.patch per file, summed on the last settled
//                  turn in place of that turn's own edits
//   folderClips    runFolderClips(run.files), offered on the last settled turn
//   detailed       false keeps a live turn to what the agent said and the
//                  step it is on now
//   now            clock ms used to tell whether a quota reset time has passed
//   prUpdates      what happened on the run's pull request, each placed
//                  before the first prompt sent after it
//   settingChanges Orc settings this run changed (ui/chat_settings.py),
//                  placed the same way, each with its Undo
//   autoMergeChanges  each time Auto merge was turned on or off, placed where
//                  it happened, inside a turn too
//   deploy         the run's Deploy after merge (ui/deploys.py), shown after
//                  the conversation while it runs and once it has ended
export function chatRows(items, {
  working = false, expanded = new Set(), startPrompt = null, launch = null,
  queued = [], outbox = [], supported = true, transcriptState = 'ready',
  agentName = 'The agent', hasDiff = false, diffFiles = null, folderClips = [], waitingOnYou = false,
  queueStranded = false, queueError = null, answer = null, turnFailure = null,
  permissionFallback = null, detailed = true, now = Date.now(), prUpdates = [], settingChanges = [],
  autoMergeChanges = [], background = null,
  deploy = null, pauses = [], cache = null,
} = {}) {
  let turns;
  if (cache && cache.items === items) {
    turns = cache.turns;
  } else {
    turns = splitTurns(shownItems(items));
    if (cache) Object.assign(cache, { items, turns });
  }
  const rows = [];
  if (permissionFallback) {
    const names = { bypass: 'bypass permissions', auto: 'auto mode', default: 'Manual mode' };
    const mode = key => names[key] || key;
    rows.push({ kind: 'notice', id: 'permission-fallback', item: { id: 'permission-fallback', kind: 'notice', tone: 'warning',
      text: `${permissionFallback.reason}, so this run uses ${mode(permissionFallback.effective)} instead of ${mode(permissionFallback.requested)}.` } });
  }
  const paused = pausedTurns(turns, pauses);
  const { afterNotice, afterTurn, switchedAfterNotice } = passedNoticeDividers(turns, working, now);
  const lastWorkTurnIndex = turns.findLastIndex(turn => !turn.divider);
  const prompted = turns.some(turn => turn.prompt && turn.prompt.kind === 'user');
  if (!prompted && startPrompt && (startPrompt.text || (startPrompt.attachments || []).length)) {
    rows.push({ kind: 'user', id: 'start-prompt', item: { id: 'start-prompt', kind: 'user', ...startPrompt, pending: true } });
  }
  const updates = [
    ...prUpdates.map(item => ({ kind: 'pr-update', item })),
    ...settingChanges.map(item => ({ kind: 'setting-change', item })),
    ...autoMergeChanges.map(change => ({ kind: 'auto-merge', item: { ...change, kind: 'auto-merge' } })),
  ].sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at));
  const pushUpdatesBefore = at => {
    const limit = at === null ? Infinity : Date.parse(at);
    while (updates.length && !(Date.parse(updates[0].item.at) >= limit)) {
      const { kind, item } = updates.shift();
      rows.push({ kind, id: `${kind}:${item.id}`, item });
    }
  };
  // The flips made while a turn ran: up to its last step, or up to now while
  // it runs. Later ones wait for the next prompt, like every other update.
  const takeFlips = (turn, active) => {
    if (!updates.length) return [];
    const ended = active ? Infinity
      : Date.parse((turn.body.findLast(item => item.at && item.kind !== 'turn-end') || turn.prompt)?.at);
    const flips = updates.filter(update => update.kind === 'auto-merge' && Date.parse(update.item.at) < ended);
    for (const flip of flips) updates.splice(updates.indexOf(flip), 1);
    return flips.map(flip => flip.item);
  };
  turns.forEach((turn, index) => {
    const last = index === turns.length - 1;
    if (turn.divider) {
      if (index > 0 && turn.divider.at) pushUpdatesBefore(turn.divider.at);
      rows.push({ kind: 'divider', id: turn.divider.id, item: turn.divider });
      if (last && working) {
        rows.push(waitingOnYou
          ? { kind: 'working', id: `working:${turn.divider.id}`, since: null, label: `${agentName} is waiting on you`, steps: 0, detailed }
          : { kind: 'working', id: `working:${turn.divider.id}`, since: turn.divider.at || null, steps: 0, detailed });
        rows.push({ kind: 'live', id: `thinking:${turn.divider.id}`, item: null, groupId: null, quiet: waitingOnYou });
      }
      return;
    }
    const id = turn.prompt ? turn.prompt.id : `turn:${index}`;
    if (index > 0 && turn.prompt?.at) pushUpdatesBefore(turn.prompt.at);
    const active = last && working;
    if (turn.prompt && turn.prompt.kind !== 'handoff') {
      const showQuota = turn.prompt.kind !== 'user' && isQuotaNotice(turn.prompt) && !switchedAfterNotice.has(turn.prompt.id);
      rows.push({ kind: turn.prompt.kind === 'user' ? 'user' : 'notice', id: turn.prompt.id, item: turn.prompt, ...(showQuota && { quota: true }) });
    }
    const { lead, since, inside } = placeFlips(turn, takeFlips(turn, active));
    rows.push(...lead.map(autoMergeRow));
    const foldId = `fold:${id}`;
    const open = expanded.has(foldId);
    const filesOpen = expanded.has(`files:${id}:more`);
    const pausedBy = paused.get(index);
    // Notices depend on later turns and the clock. The most recent turn also
    // owns the run's live file and media cards. A turn with Auto merge flips
    // among its rows is drawn again, since those arrive apart from its items.
    const reusable = cache && turn.prompt && index < lastWorkTurnIndex
      && inside.length === turn.body.length && !since.length
      && !turn.body.some(item => item.kind === 'notice');
    const prior = reusable && cache.completed.get(turn.prompt);
    if (prior && prior.open === open && prior.filesOpen === filesOpen
        && prior.hasDiff === hasDiff && prior.pausedBy === pausedBy
        && (prior.body === turn.body || (prior.body.length === turn.body.length
          && turn.body.every((item, i) => item === prior.body[i])))) {
      for (const row of prior.rows) rows.push(row);
      return;
    }
    const start = rows.length;
    const body = inside.filter(item => item.kind !== 'turn-end');
    if (active) {
      const steps = body.filter(item => item.kind === 'tool' && item.category !== 'plan').length;
      // A question it asked stops the clock: the turn is waiting on a person.
      rows.push(waitingOnYou
        ? { kind: 'working', id: `working:${id}`, since: null, label: `${agentName} is waiting on you`, steps, detailed }
        : { kind: 'working', id: `working:${id}`, since: turn.prompt?.at || null, steps, detailed });
      const grouped = groupRows(body, { live: true, afterNotice, switchedAfterNotice });
      const tail = grouped.at(-1)?.kind === 'work' ? grouped.at(-1) : null;
      const newest = tail?.items.at(-1);
      // The step it is on now leaves the log for the live slot, so finished
      // steps only ever add lines above the slot, never swap rows with it.
      // A question it is waiting on stays in the log: the slot is blank then.
      const current = !tail || waitingOnYou ? null
        : newest.kind === 'thinking' ? newest : tail.items.findLast(item => item.status === 'running') || null;
      if (current) {
        const rest = tail.items.filter(item => item !== current);
        grouped.splice(-1, 1, ...(rest.length ? [{ ...tail, items: rest }] : []));
      }
      rows.push(...(detailed ? grouped : grouped.filter(row => row.kind !== 'work')));
      rows.push(...since.map(autoMergeRow));
      // One slot at the turn's foot for the whole turn, so the live chip never
      // moves between rows. groupId keeps the step's toggle key once it lands
      // in that group's log.
      rows.push({ kind: 'live', id: `thinking:${id}`, item: current, groupId: tail?.id || null, quiet: waitingOnYou });
      return;
    }
    const terminal = [...body].reverse().find(item => item.kind === 'assistant') || null;
    const foldable = body.filter(item => !staysVisible(item, terminal));
    // The fold line always shows when the final reply landed, so that reply
    // keeps no hover time of its own.
    const foldAt = foldable.length ? terminal?.at || null : null;
    if (foldable.length) {
      const ms = turnDuration(turn);
      const interrupted = body.some(item => item.kind === 'interrupt');
      const ended = paused.has(index) ? 'Paused' : 'Stopped';
      const verb = interrupted ? `${ended} after` : 'Worked for';
      rows.push({ kind: 'fold', id: foldId, expanded: open, at: foldAt,
                  label: ms === null ? (interrupted ? ended : 'Worked') : `${verb} ${formatDuration(ms)}` });
    }
    const visible = foldable.length && !open ? body.filter(item => staysVisible(item, terminal)) : body;
    for (const row of groupRows(visible, { afterNotice, switchedAfterNotice })) {
      if (row.kind === 'interrupt' && paused.has(index)) row.pausedBy = paused.get(index);
      if (row.kind === 'assistant' && row.item === terminal) {
        row.terminal = true;
        if (foldAt) row.timeOnFold = true;
      }
      rows.push(row);
    }
    rows.push(...since.map(autoMergeRow));
    const isLastWorkTurn = index === lastWorkTurnIndex;
    const fromDiff = isLastWorkTurn && !!diffFiles?.length;
    const files = fromDiff ? diffFiles : changedFiles(body);
    const ownClips = isLastWorkTurn ? folderClips : [];
    if (files.length || ownClips.length) {
      rows.push(filesRow(`files:${id}`, files, { expanded, fromDiff, hasDiff, folderClips: ownClips }));
    }
    const resetDivider = afterTurn.get(index);
    if (resetDivider) rows.push(resetDivider);
    if (reusable) cache.completed.set(turn.prompt, {
      open, filesOpen, hasDiff, pausedBy, body: turn.body, rows: rows.slice(start),
    });
  });
  pushUpdatesBefore(null);
  if (deploy?.state) rows.push({ kind: 'deploy', id: 'deploy', deploy });
  // With nothing readable, say why rather than show a start that never ends.
  // A fresh session records its id before its first transcript write, so a
  // missing transcript only means something once the agent has stopped.
  const unreadable = !supported || (transcriptState === 'missing' && !working);
  if (!turns.length && unreadable && answer) {
    rows.push({ kind: 'assistant', id: 'answer', terminal: true,
                item: { id: 'answer', kind: 'assistant', text: answer } });
  } else if (!turns.length && unreadable) {
    rows.push({ kind: 'empty', id: 'empty', text: !supported
      ? `${agentName} conversations can't be shown here yet. Follow along in the terminal (⌘J); messages you send below still reach it.`
      : 'This session left no transcript on this machine.' });
  } else if (!turns.length && working) {
    const trust = launch && launch.state === 'needs-trust';
    rows.push({ kind: 'working', id: 'working:start', since: null,
                label: trust ? `${agentName} is waiting for you` : `Starting ${agentName}…` });
    if (!trust) rows.push({ kind: 'live', id: 'thinking:start', item: null });
  }
  if (launch && launch.state === 'needs-trust') {
    rows.push({ kind: 'launch', id: 'launch', state: 'needs-trust',
                text: `${agentName} is waiting for you to trust this folder in its terminal. Your prompt is queued for 5 minutes.` });
  } else if (launch && launch.state === 'failed') {
    rows.push({ kind: 'launch', id: 'launch', state: 'failed',
                text: launch.error ? `Couldn't start: ${launch.error}` : 'No session appeared. Check your terminal.' });
  }
  if (turnFailure && !working) {
    rows.push({ kind: 'turn-failed', id: `turn-failed:${turnFailure.turn}`, turn: turnFailure.turn,
                text: `${agentName} couldn't finish: ${turnFailure.error}` });
  }
  // The agent replied, but tasks it started keep its process, and the next
  // message, waiting until they end or Orc stops them.
  if (!working && background?.tasks?.length) {
    rows.push({ kind: 'background', id: 'background', tasks: background.tasks, settleAt: background.settleAt || null });
  }
  for (const entry of outbox) rows.push({ kind: 'outbox', id: `outbox:${entry.id}`, entry });
  for (const entry of queued) rows.push({ kind: 'queued', id: `queued:${entry.id}`, entry, stranded: entry.stranded ?? queueStranded });
  if (queued.length && queueError) {
    rows.push({ kind: 'notice', id: 'queue-error', item: { id: 'queue-error', kind: 'notice', tone: 'error',
      text: `Couldn't send the queued messages: ${queueError}. Orc tries again every 15 seconds.` } });
  }
  if (!rows.some(row => row.id !== 'permission-fallback')) {
    rows.push({ kind: 'empty', id: 'empty',
                text: transcriptState === 'waiting' ? `Waiting for ${agentName} to start its session.` : 'No messages yet.' });
  }
  return rows;
}

// A build paired with its plan (plan-pair.js) shows one conversation: the
// plan's rows, a Start work divider, then the build's. The build's first
// prompt is the brief Start work sent, which the divider stands for. Below
// the prompt the plan began from, a Plan divider names what the plan ran on;
// the Start work divider already names the build's.
export function pairedChatRows(planRows, buildRows, { planLabel = '', buildLabel = '' } = {}) {
  const taken = new Set(buildRows.map(row => row.id));
  const plan = planRows.filter(row => row.kind !== 'empty')
    .map(row => (taken.has(row.id) ? { ...row, id: `plan:${row.id}` } : row));
  const asked = plan[0]?.kind === 'user' ? 1 : 0;
  const kickoff = buildRows.findIndex(row => row.kind === 'user');
  const build = buildRows.filter((row, index) => index !== kickoff);
  return [
    ...plan.slice(0, asked),
    ...(plan.length > asked ? [{ kind: 'divider', id: 'part:plan', item: { kind: 'plan', text: planLabel ? `Plan · ${planLabel}` : 'Plan' } }] : []),
    ...plan.slice(asked),
    { kind: 'divider', id: 'part:start', item: { kind: 'start-work', text: buildLabel ? `Start work · building with ${buildLabel}` : 'Start work' } },
    ...build,
  ];
}

// A long conversation opens on its latest rows; the rest wait behind "Show
// earlier messages", so the time to open one does not grow with its length.
export const ROWS_SHOWN = 120;
export const ROWS_EARLIER = 240;
// A window starts on the prompt that opens a turn when one is this close, and
// a start this near the top is not worth hiding anything for.
const WINDOW_SLACK = 20;

// The index a window of `count` rows ending before `end` starts at.
export function windowStart(rows, count, end = rows.length) {
  const start = Math.max(0, end - count);
  if (start <= WINDOW_SLACK) return 0;
  for (let index = start; index > start - WINDOW_SLACK; index -= 1) {
    if (rows[index].kind === 'user') return index;
  }
  return start;
}

// The prompt text and the image and video attachment paths it references, the
// same split ui/run_chat.py makes on the server.
export function splitAttachments(text) {
  const attachments = [];
  const rest = String(text || '').replace(/^\[(?:Image|Video) attachment: (\/[^\]\r\n]+)\]\s*$/gm, (line, path) => {
    attachments.push(path);
    return '';
  });
  return { text: attachments.length ? rest.trim() : String(text || ''), attachments };
}

// Thumbnails exist only for files inside Orc's own attachment folders, the
// two places the server will serve one from.
export function attachmentUrl(path) {
  const value = String(path || '');
  const staged = /\/\.orc\/attachments\/([^/]+)$/.exec(value);
  if (staged) return `/api/attachments/${encodeURIComponent(staged[1])}`;
  const owned = /\/\.orc\/runs\/([^/]+)\/attachments\/([^/]+)$/.exec(value);
  if (owned) return `/runs/${encodeURIComponent(owned[1])}/attachments/${encodeURIComponent(owned[2])}`;
  return null;
}

export const isVideoAttachment = path => /\.(mp4|mov|webm)$/i.test(String(path || ''));
