// orc-ui: a run id written in a chat becomes a badge that links to the run,
// reads as its title and describes it on hover. A draft names a run as
// `@` and its title, which becomes the run's id when it is sent.

import { esc, presentRun, relativeStamp, runCreated, runStarted, runs } from './core.js';
import { queryRank, runProject } from './filters.js';
import { bindHoverCard } from './hover-card.js';

// Run ids carry their start time (`fix-the-header-20261115-0941`), so only a
// word holding one is looked up. A path or a URL names a file, not the run.
export const RUN_REF = /(?<![\w./#@-])[A-Za-z0-9][\w.-]*\d{8}-\d{4}[\w.-]*/g;
const RUN_ID = /^[A-Za-z0-9][\w.-]*\d{8}-\d{4}[\w.-]*$/;
export const knownRun = id => runs.find(run => run.id === id) || null;

// The run a RUN_REF word names. A sentence's full stop is not part of the id.
export function runRefIn(word, lookup = knownRun) {
  const id = word.replace(/[.-]+$/, '');
  const run = RUN_ID.test(id) ? lookup(id) : null;
  return run ? { id, run } : null;
}

export function runRefHtml(id, lookup = knownRun) {
  const run = RUN_ID.test(id) ? lookup(id) : null;
  return run ? `<a class="chat-run-ref" href="#${encodeURIComponent(run.id)}" data-run-ref="${esc(run.id)}">${esc(run.meta?.title || run.id)}</a>` : null;
}

// Wraps each known run id in already-escaped text that holds no tags.
export function runRefsHtml(html, lookup = knownRun) {
  return html.replace(RUN_REF, word => {
    const ref = runRefIn(word, lookup);
    return ref ? runRefHtml(ref.id, lookup) + word.slice(ref.id.length) : word;
  });
}

// The run an `@` at `text[at - 1]` names by its title. The longest title wins,
// so "Fix the header colours" is not read as "Fix the header", and among runs
// with the same title the one chosen from the menu, then the newest.
export function mentionAt(text, at, chosen = new Map()) {
  let best = null;
  for (const run of runs) {
    const title = run.meta?.title;
    if (!title || !text.startsWith(title, at) || /[\p{L}\p{N}]/u.test(text[at + title.length] || '')) continue;
    const score = chosen.get(title) === run.id ? Infinity : runCreated(run) || 0;
    if (!best || title.length > best.title.length || (title.length === best.title.length && score > best.score)) {
      best = { title, run, score };
    }
  }
  return best;
}

// A textarea cannot pad part of its text, so a chosen mention or a pasted run
// id carries a three-per-em space on each side: the inside of its pill. The
// space typed before it stays a gap.
export const MENTION_PAD = '\u2004';

export function runMentionsIn(text, chosen) {
  return [...text.matchAll(/(?<=^|\s)@/g)].flatMap(match => {
    const mention = mentionAt(text, match.index + 1, chosen);
    if (!mention) return [];
    const start = match.index - (text[match.index - 1] === MENTION_PAD ? 1 : 0);
    const after = match.index + 1 + mention.title.length;
    const end = after + (text[after] === MENTION_PAD ? 1 : 0);
    return [{ index: start, text: text.slice(start, end), run: mention.run }];
  });
}

// The runs an `@` search offers, newest first, and the newest of all before
// anything is typed. Only the text as typed matches: Enter takes the top
// match, and a loose one would turn a plain "@bob" into some run's id.
export function searchRuns(term, { exclude = '', limit = 30 } = {}) {
  const q = term.trim().toLowerCase();
  return runs.filter(run => run.id !== exclude && (!q || queryRank(run, q) === 0))
    .sort((a, b) => (runCreated(b) || 0) - (runCreated(a) || 0))
    .slice(0, limit);
}

// Pads each known run id in pasted text that is not padded already.
export function padRunRefs(text, lookup = knownRun) {
  return text.replace(RUN_REF, (word, index) => {
    const ref = runRefIn(word, lookup);
    if (!ref) return word;
    const before = text[index - 1] === MENTION_PAD ? '' : MENTION_PAD;
    const after = word.length > ref.id.length || text[index + word.length] !== MENTION_PAD ? MENTION_PAD : '';
    return before + ref.id + after + word.slice(ref.id.length);
  });
}

// What is sent: a padded run id without its padding.
const PADDED_REF = new RegExp(`${MENTION_PAD}(${RUN_REF.source})${MENTION_PAD}`, 'g');
export function unpadRunRefs(text, lookup = knownRun) {
  return text.replace(PADDED_REF, (whole, id) => (runRefIn(id, lookup)?.id === id ? id : whole));
}

// Calls `changed` for the lifetime of the bound composer.
export function onRunsChange(changed, signal) {
  document.addEventListener('orc:runs', changed, { signal });
}

// Rendered chat is cached, and what it cached goes stale when a run a message
// names appears or goes. Zero for text that names no run.
let runRefsIds = '';
let runRefsVersion = 1;
globalThis.document?.addEventListener?.('orc:runs', () => {
  const ids = runs.map(run => `${run.id}\t${run.meta?.title || ''}`).join('\n');
  if (ids !== runRefsIds) { runRefsIds = ids; runRefsVersion += 1; }
});
export function runRefsKey(text) {
  return /\d{8}-\d{4}/.test(text) ? runRefsVersion : 0;
}

export function runCardHtml(run, now = new Date()) {
  const meta = run.meta || {};
  const state = presentRun(run, { now: now.getTime() }).state;
  const started = new Date(runStarted(run) * 1000);
  const facts = [runProject(run).label,
    Number.isNaN(started.getTime()) ? '' : `Started ${relativeStamp(started, now).replace(/^(Just now|Yesterday)/, word => word.toLowerCase())}`];
  return `<strong class="chat-run-card-title">${esc(meta.title || run.id)}</strong>`
    + (meta.title ? `<span class="chat-run-card-id">${esc(run.id)}</span>` : '')
    + `<div class="chat-run-card-state"><span class="chat-run-card-dot" style="background:${esc(state.color)}"></span>${esc(state.label)}</div>`
    + (state.detail ? `<p>${esc(state.detail)}</p>` : '')
    + `<div class="chat-hover-card-foot">${esc(facts.filter(Boolean).join(' · '))}</div>`;
}

// Every chat renders through the same Markdown, so one listener serves them all.
if (globalThis.document?.addEventListener) {
  bindHoverCard(document, '[data-run-ref]', ref => {
    const run = knownRun(ref.dataset.runRef);
    return run ? runCardHtml(run) : '';
  });
}
