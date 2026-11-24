import { esc } from './core.js';
import { replyEditorHtml, repaintWithEmoji, wireReplyEditor } from './pr-review-card.js';
import { emojiReady, emojifyHtml } from './github-emoji.js';
import { prPushButton, prPushPending, prRepliesPending } from './run-presentation.js';

// A PR feedback round finishes in Chat. Once the agent has acted on the
// user's answers (skills/orc-pr, "PR feedback round"), this card lists each
// review comment with what happened to it and the reply that will answer it,
// editable until it posts, and holds the round's one GitHub write: Push
// comments & commits (or Push commits, when Settings say so). The PR comments tab keeps the same threads as the record.
// The card shares the chat's question slot (#answer-card) with Answer mode's
// invitation, which never shows at the same time: a round asks first, then
// acts, then waits here.

const REPLIES_FILE = 'pr-replies.json';
const STATUS = {
  fixed: { label: 'Fixed', tone: 'ok' },
  left: { label: 'Left as is', tone: 'warn' },
  'follow-up': { label: 'Follow-up run', tone: 'info' },
  decision: { label: 'Needs your decision', tone: 'warn' },
};

const cards = new Map();

// The round waits at its gate for the click. While the agent is still writing
// the round (running before it opens the gate) there is nothing to click yet;
// once the click sent the push, the card stays to show it under way.
export function prRoundCardPending(run) {
  const meta = run?.meta;
  return !!meta && (prPushPending(meta) || prRepliesPending(meta))
    && (run.files || []).some(file => file.path === REPLIES_FILE)
    && (meta.status === 'awaiting-gate' || (meta.status === 'running' && !!cards.get(run.id)?.sent));
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
  let entry = cards.get(run.id);
  if (!entry || entry.key !== key) {
    const previous = entry;
    // A refetch of the same round (a status flip, a saved reply) keeps the
    // reply being edited and the click already sent.
    const same = previous && JSON.parse(previous.key)[1] === (run.meta.prFeedback?.round ?? null);
    entry = { key, round: same ? previous.round : null, error: '', editing: same ? previous.editing : null,
      saving: false, saveError: '', sent: same && previous.sent };
    cards.set(run.id, entry);
    fetchRound(run.id).then(round => { entry.round = round; entry.error = ''; }, error => { if (!entry.round) entry.error = error.message; })
      .then(() => { if (entry.isCurrent() && cards.get(run.id) === entry) paint(host, run, entry); });
  }
  entry.isCurrent = isCurrent;
  paint(host, run, entry);
}

function actionFor(meta) {
  if (prPushPending(meta)) {
    const { label, postReplies } = prPushButton(meta);
    return { action: 'push', label, postReplies };
  }
  return { action: 'post-replies', label: 'Push comments', postReplies: true };
}

function authorsText(threads) {
  const names = [...new Set(threads.map(thread => thread.author).filter(Boolean))];
  if (!names.length) return '';
  return `from ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')}`;
}

function replyHtml(thread, entry) {
  const reply = thread.reply;
  if (!reply) return '';
  if (entry.editing === thread.card) {
    return replyEditorHtml(thread.card, 'Your reply', reply.body, entry, 'Save reply');
  }
  const state = reply.posted
    ? (reply.postedUrl ? `<a class="prr-link" href="${esc(reply.postedUrl)}" target="_blank" rel="noopener">Posted</a>` : '<span class="prr-posted">Posted</span>')
    : reply.editable ? `<button type="button" class="prr-link" data-prr-edit="${esc(thread.card)}">Edit<span class="sr-only"> the reply to ${esc(thread.header || thread.author || 'this comment')}</span></button>` : '';
  return `<div class="prr-reply"><span class="prr-reply-label">Your reply</span><p>${emojifyHtml(reply.body)}</p>${state}</div>`;
}

function threadHtml(thread, entry) {
  const status = STATUS[thread.status];
  const where = thread.path
    ? `<code>${esc(thread.path)}</code>${thread.line ? ` <span class="prr-line">line ${thread.line}</span>` : ''}`
    : '<span class="prr-line">review comment</span>';
  const title = thread.header || thread.author || 'Comment';
  return `<li class="prr-thread">
    <p class="prr-head">${status ? `<span class="prr-chip" data-tone="${status.tone}">${status.label}</span>` : ''}<strong>${esc(title)}</strong><span class="prr-sep" aria-hidden="true">·</span>${where}</p>
    ${thread.verdict ? `<p class="prr-verdict">${esc(thread.verdict)}</p>` : ''}
    ${replyHtml(thread, entry)}
  </li>`;
}

function cardHtml(run, entry) {
  const meta = run.meta;
  const round = entry.round;
  const threads = round?.threads || [];
  const { action, label, postReplies } = actionFor(meta);
  const pushing = meta.status === 'running' && entry.sent;
  const replies = threads.filter(thread => thread.reply && !thread.reply.posted).length;
  const count = threads.length;
  const heading = count
    ? `${count === 1 ? '1 review comment' : `${count} review comments`} ready to ${action === 'push' ? 'push' : 'answer'}`
    : 'Review fixes ready to push';
  const commit = round?.commit || String(meta.prFeedback?.commit || '').slice(0, 7);
  const detail = action === 'push'
    ? [`Pushes ${commit ? `<code>${esc(commit)}</code>` : 'the fixes'}${replies && postReplies ? ` and posts ${replies === 1 ? 'the reply' : `${replies === 2 ? 'both' : `all ${replies}`} replies`}` : replies ? `; ${replies === 1 ? 'the reply waits' : 'the replies wait'} for Push comments` : ''}`,
      round?.verification ? esc(round.verification) : ''].filter(Boolean).join(' · ')
    : `Posts ${replies === 1 ? 'the reply' : `${replies} replies`} still waiting`;
  return `<div class="prr" role="region" aria-label="Review comments ready">
    <div class="prr-top"><span class="prr-dot" aria-hidden="true"></span><strong>${heading}</strong><span>${esc(authorsText(threads))}</span></div>
    ${count ? `<ol class="prr-list">${threads.map(thread => threadHtml(thread, entry)).join('')}</ol>` : entry.error ? `<p class="prr-note">${esc(entry.error)} The PR comments tab has the details.</p>` : ''}
    <div class="prr-foot"><orc-button variant="primary" size="compact" data-chat-action="${action}"${pushing ? ' disabled' : ''}>${pushing ? (action === 'push' ? 'Pushing…' : 'Posting…') : label}</orc-button><span>${detail}</span></div>
  </div>`;
}

function paint(host, run, entry) {
  // While a reply is open for editing, a change that only moves the run's
  // status leaves the editor alone: a repaint would move the caret.
  const signature = JSON.stringify([!entry.editing && emojiReady(), entry.key, !!entry.round, entry.error, entry.editing, entry.saving, entry.saveError,
    globalThis.ORC_PR_PUSH_ACTION ?? null,
    entry.editing ? null : [run.meta.status, entry.sent]]);
  if (host.dataset.signature === signature && !host.hidden) return;
  const draft = host.querySelector('#prr-edit')?.value;
  const draftCard = host.querySelector('[data-prr-save]')?.dataset.prrSave;
  host.dataset.signature = signature;
  repaintWithEmoji(() => { if (entry.isCurrent?.() && cards.get(run.id) === entry) paint(host, run, entry); });
  const scroller = host.closest('.chat-scroll');
  const following = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  host.hidden = !entry.round && !entry.error;
  host.innerHTML = host.hidden ? '' : cardHtml(run, entry);
  if (following) scroller.scrollTop = scroller.scrollHeight;
  const editor = host.querySelector('#prr-edit');
  if (editor) {
    if (draft != null && draftCard === entry.editing) editor.value = draft;
    editor.focus({ preventScroll: true });
  }
  host.querySelectorAll('[data-prr-edit]').forEach(button => {
    button.onclick = () => { entry.editing = button.dataset.prrEdit; entry.saveError = ''; paint(host, run, entry); };
  });
  const cancel = host.querySelector('[data-prr-cancel]');
  if (cancel) {
    cancel.onclick = () => {
      const card = entry.editing;
      entry.editing = null;
      entry.saveError = '';
      paint(host, run, entry);
      host.querySelector(`[data-prr-edit="${CSS.escape(card)}"]`)?.focus();
    };
  }
  host.querySelectorAll('.prr-foot [data-chat-action]').forEach(button => {
    // Chat's own handler sends the push; the card only notes that it went.
    button.addEventListener('click', () => { entry.sent = true; }, { capture: true });
  });
  wireReplyEditor(host, form => saveReply(host, run, entry, form));
}

async function saveReply(host, run, entry, form) {
  if (entry.saving) return;
  const card = form.dataset.prrSave;
  const body = form.querySelector('textarea').value;
  entry.saving = true;
  entry.saveError = '';
  paint(host, run, entry);
  try {
    const response = await fetch(`/runs/${encodeURIComponent(run.id)}/pr-replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card, body }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save the reply.');
    const thread = entry.round.threads.find(item => item.card === card);
    if (thread?.reply) thread.reply.body = body.trim();
    entry.editing = null;
  } catch (error) {
    entry.saveError = error.message;
  } finally {
    entry.saving = false;
    // The chat may have moved to another run while the save was out; the
    // card then belongs to no host until that run's chat opens again.
    if (cards.get(run.id) === entry && entry.isCurrent()) {
      paint(host, run, entry);
      if (!entry.editing) host.querySelector(`[data-prr-edit="${CSS.escape(card)}"]`)?.focus();
    }
  }
}
