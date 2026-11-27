import { esc } from './core.js';
import { rememberReviewCard, roundCards } from './pr-review-card.js';
import { prPushButton, prPushPending, prRepliesPending } from './run-presentation.js';

// A PR feedback round finishes in Chat. Once the agent has acted on the
// user's answers (skills/orc-pr, "PR feedback round"), this card sums the
// round up in two rows (how many comments, a count per outcome, who left
// them) and holds the round's one GitHub write: Push comments & commits (or
// Push commits, when Settings say so). After the push it shrinks to one line.
// The threads and their replies, editable until they post, live in the PR
// comments tab, which the card links to rather than repeating.
// The card shares the chat's question slot (#answer-card) with Answer mode's
// invitation, which never shows at the same time: a round asks first, then
// acts, then waits here.

const REPLIES_FILE = 'pr-replies.json';
const PR_COMMENTS = 'pr-comments.html';
const STATUS = {
  fixed: { label: 'Fixed', tone: 'ok' },
  left: { label: 'Left as is', tone: 'warn' },
  'follow-up': { label: 'Follow-up run', tone: 'info' },
  decision: { label: 'Needs your decision', tone: 'warn' },
};

// The round waits at its gate for the click. While the agent is still writing
// the round (running before it opens the gate) there is nothing to click yet;
// once the click sent the push, the card stays to show it under way, and then
// stays to say it went.
export function prRoundCardPending(run) {
  const meta = run?.meta;
  if (!meta || !(run.files || []).some(file => file.path === REPLIES_FILE)) return false;
  const entry = roundCards.get(run.id);
  if (entry?.pushing || prRoundCardPushed(run)) return true;
  return (prPushPending(meta) || prRepliesPending(meta))
    && (meta.status === 'awaiting-gate' || (meta.status === 'running' && !!entry?.sent));
}

// The round this page pushed: its card says Pushed in place of the button,
// and has nothing left to click.
export function prRoundCardPushed(run) {
  const pushed = roundCards.get(run?.id)?.pushed;
  return !!pushed && pushed.commit === (run.meta?.prFeedback?.commit ?? null);
}

// Chat sends the click's request and reports it here, so the button reads
// Pushing… (dimmed, ignoring clicks) while it is out, and the card says
// Pushed once it lands. `state` is 'sending', then 'done' or 'failed';
// `already` says an earlier click had already pushed the round.
export function notePrRoundPush(run, state, { already = false } = {}) {
  const entry = roundCards.get(run.id);
  if (!entry) return;
  if (state === 'sending') {
    const { action, postReplies } = actionFor(run.meta);
    const threads = entry.round?.threads || [];
    entry.pushing = { action, postReplies, commit: run.meta.prFeedback?.commit ?? null,
      short: entry.round?.commit || String(run.meta.prFeedback?.commit || '').slice(0, 7),
      replies: postReplies ? threads.filter(thread => thread.reply && !thread.reply.posted).length : 0 };
  } else {
    // Push commits leaves the replies for Push comments, so that card comes back.
    if (state === 'done' && entry.pushing?.postReplies) {
      entry.pushed = { ...entry.pushing, already };
    }
    entry.pushing = null;
  }
  entry.repaint?.();
}

function roundKey(run) {
  const feedback = run.meta.prFeedback || {};
  const file = (run.files || []).find(item => item.path === REPLIES_FILE);
  return JSON.stringify([run.id, feedback.round ?? null, feedback.commit ?? null, feedback.state,
    feedback.repliesPostedAt ?? null, file?.size ?? null, file?.mtime ?? null]);
}

async function fetchRound(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/pr-round`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load the review round.');
  return body;
}

// Paints the card into `host`, fetching the round when it changed. `isCurrent`
// says whether the host still belongs to this run once the fetch returns.
export function syncPrRoundCard(host, run, isCurrent) {
  const key = roundKey(run);
  let entry = roundCards.get(run.id);
  if (!entry || entry.key !== key) {
    const previous = entry;
    // A refetch of the same round (a status flip, a saved reply) keeps the
    // click already sent.
    const same = previous && JSON.parse(previous.key)[1] === (run.meta.prFeedback?.round ?? null);
    entry = { key, round: same ? previous.round : null, error: '', sent: same && previous.sent,
      pushing: same ? previous.pushing : null, pushed: same ? previous.pushed : null };
    fetchRound(run.id).then(round => { entry.round = round; entry.error = ''; }, error => { if (!entry.round) entry.error = error.message; })
      .then(() => { if (entry.isCurrent() && roundCards.get(run.id) === entry) paint(host, run, entry); });
  }
  rememberReviewCard(roundCards, run.id, entry);
  entry.isCurrent = isCurrent;
  entry.repaint = () => { if (entry.isCurrent() && roundCards.get(run.id) === entry) paint(host, run, entry); };
  paint(host, run, entry);
}

function actionFor(meta) {
  if (prPushPending(meta)) {
    const { label, postReplies } = prPushButton(meta);
    return { action: 'push', label, postReplies };
  }
  return { action: 'post-replies', label: 'Push comments', postReplies: true };
}

function repliesText(count) {
  return count === 1 ? 'the reply' : `${count === 2 ? 'both' : `all ${count}`} replies`;
}

// The foot while the click's request is out, and once it has landed.
function progressFoot(entry) {
  const { action, short, replies } = entry.pushing;
  const commit = short ? `<code>${esc(short)}</code>` : 'the fixes';
  const say = action === 'push'
    ? `Pushing ${commit}${replies ? ` and posting ${repliesText(replies)}` : ''}`
    : `Posting ${repliesText(replies)}`;
  return `<orc-button variant="primary" size="compact" disabled><span class="status-spinner" aria-hidden="true"></span>${action === 'push' ? 'Pushing…' : 'Posting…'}</orc-button><span role="status">${say}</span>`;
}

function authorsText(threads) {
  const names = [...new Set(threads.map(thread => thread.author).filter(Boolean))];
  if (!names.length) return '';
  return `from ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')}`;
}

// One chip per outcome, in STATUS order: "5 fixed", "2 left as is".
function outcomeChips(threads) {
  return Object.entries(STATUS).map(([key, status]) => {
    const count = threads.filter(thread => thread.status === key).length;
    return count ? `<span class="prr-chip" data-tone="${status.tone}">${count} ${status.label.toLowerCase()}</span>` : '';
  }).join('');
}

function commentsText(count) {
  return count === 1 ? '1 review comment' : `${count} review comments`;
}

function threadsLink(run, label) {
  return `<a class="prr-link prr-threads" href="#${esc(run.id)}/${PR_COMMENTS}">${label}</a>`;
}

// After the push the card is one line: what went, and where the threads are.
function pushedLine(run, entry, count) {
  const { action, short, replies, already } = entry.pushed;
  const done = action === 'push' ? (already ? 'Already pushed' : 'Pushed') : (already ? 'Already posted' : 'Posted');
  const heading = count ? `${commentsText(count)} answered` : 'Review fixes pushed';
  const said = [action === 'push' && short ? `<code>${esc(short)}</code>` : '',
    replies ? `${repliesText(replies)} posted` : ''].filter(Boolean);
  return `<div class="prr is-pushed" role="region" aria-label="Review comments">
    <span class="prr-done">✓ ${done}</span><strong>${heading}</strong>${said.length ? `<span role="status">${said.map(part => `<span class="prr-sep" aria-hidden="true">·</span> ${part}`).join(' ')}</span>` : ''}${threadsLink(run, 'PR comments')}
  </div>`;
}

function cardHtml(run, entry) {
  const meta = run.meta;
  const round = entry.round;
  const threads = round?.threads || [];
  const count = threads.length;
  if (prRoundCardPushed(run)) return pushedLine(run, entry, count);
  const { action, label, postReplies } = actionFor(meta);
  const pushing = meta.status === 'running' && entry.sent;
  const replies = threads.filter(thread => thread.reply && !thread.reply.posted).length;
  const heading = count ? `${commentsText(count)} ready to ${action === 'push' ? 'push' : 'answer'}` : 'Review fixes ready to push';
  const commit = round?.commit || String(meta.prFeedback?.commit || '').slice(0, 7);
  const detail = action === 'push'
    ? `Pushes ${commit ? `<code>${esc(commit)}</code>` : 'the fixes'}${replies && postReplies ? ` and posts ${repliesText(replies)}` : replies ? `; ${replies === 1 ? 'the reply waits' : 'the replies wait'} for Push comments` : ''}`
    : `Posts ${replies === 1 ? 'the reply' : `${replies} replies`} still waiting`;
  const who = authorsText(threads);
  return `<div class="prr" role="region" aria-label="Review comments">
    <div class="prr-top"><span class="prr-dot" aria-hidden="true"></span><strong>${heading}</strong>${outcomeChips(threads)}${who ? `<span class="prr-who">${esc(who)}</span>` : ''}</div>
    ${!count && entry.error ? `<p class="prr-note">${esc(entry.error)} The PR comments tab has the details.</p>` : ''}
    <div class="prr-foot">${entry.pushing ? progressFoot(entry)
      : `<orc-button variant="primary" size="compact" data-chat-action="${action}"${pushing ? ' disabled' : ''}>${pushing ? (action === 'push' ? 'Pushing…' : 'Posting…') : label}</orc-button><span>${detail}</span>`}${threadsLink(run, replies ? 'Read or edit replies in PR comments' : 'Read the threads in PR comments')}</div>
  </div>`;
}

function paint(host, run, entry) {
  const signature = JSON.stringify([entry.key, !!entry.round, entry.error, globalThis.ORC_PR_PUSH_ACTION ?? null,
    run.meta.status, entry.sent, entry.pushing, entry.pushed]);
  if (host.dataset.signature === signature && !host.hidden) return;
  host.dataset.signature = signature;
  const scroller = host.closest('.chat-scroll');
  const following = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  host.hidden = !entry.round && !entry.error;
  host.innerHTML = host.hidden ? '' : cardHtml(run, entry);
  if (following) scroller.scrollTop = scroller.scrollHeight;
  host.querySelectorAll('.prr-foot [data-chat-action]').forEach(button => {
    // Chat's own handler sends the push; the card only notes that it went.
    button.addEventListener('click', () => { entry.sent = true; }, { capture: true });
  });
}
