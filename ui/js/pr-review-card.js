import { announce, esc, runs, setRuns } from './core.js';
import { refresh } from './activity.js';
import { reflectRunChange } from './dialogs.js';
import { ATTACH_ICON } from './prompt-composer.js';
import { emojiReady, emojifyHtml, loadGithubEmoji, wireEmojiSuggest } from './github-emoji.js';

// Your review of a colleague's PR, in Chat (ui/pr_review_draft.py). Once Answer
// mode has walked the drafted comments, this card holds the note and each kept
// comment (editable), dropped ones (Put back) and the review's one GitHub write:
// Request changes, Comment or Approve. It shares the chat's #answer-card slot
// with Answer mode's invitation, which shows while the draft is still drafting.

const DRAFT_FILE = 'pr-review-draft.json';
const EVENTS = [['REQUEST_CHANGES', 'Request changes'], ['COMMENT', 'Comment'], ['APPROVE', 'Approve']];
const POSTED = { REQUEST_CHANGES: 'Changes requested', COMMENT: 'Commented', APPROVE: 'Approved' };
// GitHub's upload endpoint takes these (GITHUB_IMAGE_TYPES in ui/pr_review_draft.py).
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_IMAGES = 10;

const cards = new Map();
export const roundCards = new Map();
const RECENT_CARDS = 12;
let nextReviewEdit = 0;

// Keep recent models for a return visit. A draft being edited or sent still
// belongs to its caller even when several other reviews have since opened.
export function rememberReviewCard(cache, id, entry) {
  cache.delete(id);
  cache.set(id, entry);
  for (const [oldId, old] of cache) {
    if (cache.size <= RECENT_CARDS) break;
    if (oldId !== id && !old.editing && !old.saving && !old.posting && !old.sent) cache.delete(oldId);
  }
}
// Reviews GitHub has accepted that the run list has not caught up with yet,
// by run id. The sidebar row reads meta.review.posted, so it shows the posted
// label in the same moment as the card instead of on the next poll.
const postedReviews = new Map();

function withPostedReview(run, posted) {
  const meta = run.meta || {};
  return { ...run, meta: { ...meta, review: { ...meta.review, posted } } };
}

// Keeps each accepted review on its row until a run list carries it.
export function holdPostedReviews(list) {
  if (cards.size || roundCards.size || postedReviews.size) {
    const missing = new Set([...cards.keys(), ...roundCards.keys(), ...postedReviews.keys()]);
    for (const run of list) {
      if (!missing.delete(run.id)) continue;
      if (roundCards.get(run.id)?.sent && !['awaiting-gate', 'running'].includes(run.meta?.status)) roundCards.delete(run.id);
      if (!missing.size) break;
    }
    for (const id of missing) {
      cards.delete(id);
      roundCards.delete(id);
      postedReviews.delete(id);
    }
  }
  if (!postedReviews.size) return list;
  return list.map(run => {
    const posted = postedReviews.get(run.id);
    if (!posted) return run;
    if (run.meta?.review?.posted) {
      postedReviews.delete(run.id);
      return run;
    }
    return withPostedReview(run, posted);
  });
}

function showPostedInSidebar(runId, posted) {
  postedReviews.set(runId, posted);
  setRuns(runs.map(item => item.id === runId ? withPostedReview(item, posted) : item));
  reflectRunChange(runId);
  refresh({ force: true });
}

export function prDraftFile(run) {
  return run?.meta?.review?.mode === 'flag' && (run.files || []).some(file => file.path === DRAFT_FILE);
}

function fileKey(run) {
  const file = (run.files || []).find(item => item.path === DRAFT_FILE);
  return JSON.stringify([run.id, file?.size ?? null, file?.mtime ?? null]);
}

// 'drafting', 'ready' or 'posted' once the card model has loaded; 'unknown'
// while it loads; 'none' when the run has no readable draft.
export function prReviewState(run) {
  const entry = cards.get(run.id);
  if (entry?.model) return entry.model.state;
  return entry?.error ? 'none' : 'unknown';
}

export function prReviewCardPending(run) {
  return prDraftFile(run) && ['ready', 'posted'].includes(prReviewState(run));
}

async function fetchModel(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/pr-review`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load your review.');
  return body;
}

// A review on GitHub stays there, so a model read before the post landed
// (the run list noticed the draft change first) never takes the card back to
// ready to post.
function load(entry, runId) {
  return fetchModel(runId).then(model => {
    if (entry.model?.state === 'posted' && model.state !== 'posted') return;
    entry.model = model;
    entry.error = '';
  }, error => { if (!entry.model) entry.error = error.message; });
}

function entryFor(runId) {
  let entry = cards.get(runId);
  if (!entry) {
    entry = { runId, key: null, model: null, error: '', editing: null, editImages: [], saving: false, saveError: '', posting: null, postError: '', isCurrent: null };
  }
  rememberReviewCard(cards, runId, entry);
  return entry;
}

// Fetches the model again, such as after Answer mode saved its answers.
export function reloadPrReview(runId) {
  return load(entryFor(runId), runId);
}

// Makes sure the model for this version of the draft is loading or loaded. The
// entry lives on across versions, so an edit or a post under way survives the
// file changing under it.
export function loadPrReview(run, onLoad) {
  const key = fileKey(run);
  const entry = entryFor(run.id);
  if (entry.key !== key) {
    entry.key = key;
    load(entry, run.id).then(onLoad);
  }
  return entry;
}

export function syncPrReviewCard(host, run, isCurrent) {
  const entry = loadPrReview(run, () => {});
  entry.isCurrent = isCurrent;
  paint(host, run, entry);
}

function where(comment) {
  return comment.path
    ? `<code>${esc(comment.path)}</code>${comment.line ? ` <span class="prr-line">line ${comment.line}</span>` : ''}`
    : '<span class="prr-line">review comment</span>';
}

const imageUrl = (runId, image) =>
  `/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(image.slice('attachments/'.length))}`;

// A note's or comment's saved images. In the editor each has Remove.
function imagesHtml(runId, images, removable) {
  if (!images?.length) return '';
  return `<ul class="prr-images" aria-label="Images">${images.map((image, index) => `<li>
      <a href="${esc(imageUrl(runId, image))}" target="_blank" rel="noopener"><img src="${esc(imageUrl(runId, image))}" alt="Image ${index + 1}" loading="lazy"></a>
      ${removable ? `<button type="button" class="prr-link" data-prr-remove-image="${esc(image)}">Remove<span class="sr-only"> image ${index + 1}</span></button>` : ''}
    </li>`).join('')}</ul>`;
}

// The editor both PR cards use for a note, a comment or a reply. Its buttons
// are the same compact design-system buttons as the card's footer, so every
// theme colours them. <orc-button> is not a form control, so wireReplyEditor
// has Save submit the form itself. `images` (the review card only) gives it
// the shared image tray (ATTACHMENTS_JS in ui/serve.py lists
// #prr-edit[data-prr-images]): paste, drop or the paperclip, with the images
// already saved listed under the box, where they post.
export function replyEditorHtml(target, label, text, entry, saveLabel, images = null) {
  const pictures = images ? imagesHtml(entry.runId, images, true) : '';
  const attach = images ? `<orc-icon-button label="Attach images" size="compact" data-prr-attach>${ATTACH_ICON}</orc-icon-button>
      <input type="file" accept="${IMAGE_ACCEPT}" multiple hidden data-prr-file>
      <span class="prr-reply-hint">Paste or drop an image. It uploads to GitHub when you post the review.</span>` : '';
  return `<form class="prr-reply is-editing" data-prr-save="${esc(target)}">
      <label class="prr-reply-label" for="prr-edit">${label}</label>
      <textarea id="prr-edit" rows="3" maxlength="65536"${images ? ' data-prr-images' : ''}>${esc(text)}</textarea>
      ${pictures}
      <p class="prr-save-error" role="alert">${esc(entry.saveError)}</p>
      <span class="prr-reply-actions">${attach}<orc-button variant="secondary" size="compact" data-prr-cancel>Cancel</orc-button><orc-button variant="primary" size="compact" data-prr-submit${entry.saving ? ' disabled' : ''}>${entry.saving ? 'Saving…' : saveLabel}</orc-button></span>
    </form>`;
}

export function wireReplyEditor(host, save) {
  const form = host.querySelector('[data-prr-save]');
  if (!form) return;
  form.onsubmit = event => { event.preventDefault(); save(form); };
  form.querySelector('[data-prr-submit]').onclick = () => form.requestSubmit();
  wireEmojiSuggest(form.querySelector('textarea'));
}

// Paints the card again once GitHub's emoji list arrives, so saved text shows
// its emoji. Both PR cards use it; `paint` checks the card is still showing.
// Their signatures leave the list out while a box is open, so it arriving
// never swaps the box (and its caret) under you; closing it repaints.
export function repaintWithEmoji(paint) {
  if (!emojiReady()) loadGithubEmoji(paint);
}

function rowHtml(entry, target, label, text, images, empty, canEdit, aria) {
  if (entry.editing === target) return replyEditorHtml(target, label, text, entry, 'Save', entry.editImages);
  const filled = text || images.length;
  const edit = canEdit
    ? `<button type="button" class="prr-link" data-prr-edit="${esc(target)}">${filled ? 'Edit' : 'Add'}<span class="sr-only"> ${esc(aria)}</span></button>` : '';
  const words = text ? `<p>${emojifyHtml(text)}</p>` : images.length ? '' : `<p class="prr-empty">${esc(empty)}</p>`;
  return `<div class="prr-reply"><span class="prr-reply-label">${label}</span>${words}${edit}${imagesHtml(entry.runId, images, false)}</div>`;
}

// Orc's drafted note waits under an empty note as a suggestion: the review
// posts with no note unless you add one or take this.
function suggestionHtml(model, entry, open) {
  if (!open || model.note || !model.suggestedNote || entry.editing === 'note') return '';
  return `<p class="prr-suggest"><span>Suggested: <q>${emojifyHtml(model.suggestedNote)}</q></span><button type="button" class="prr-link" data-prr-use-note${entry.saving ? ' disabled' : ''}>${entry.saving ? 'Saving…' : 'Use it'}<span class="sr-only"> as your note</span></button></p>
    ${entry.saveError ? `<p class="prr-save-error prr-suggest" role="alert">${esc(entry.saveError)}</p>` : ''}`;
}

function commentHtml(comment, entry, open) {
  const title = `<strong>${esc(comment.header)}</strong><span class="prr-sep" aria-hidden="true">·</span>${where(comment)}`;
  if (!comment.kept) {
    return `<li class="prr-thread is-dropped" data-comment="${esc(comment.id)}">
      <p class="prr-head"><span class="prr-chip">Dropped</span>${title}</p>
      <p class="prr-verdict">Kept out of the review, as you chose.${open ? ` <button type="button" class="prr-link" data-prr-keep="${esc(comment.id)}" data-kept="true">Put back<span class="sr-only"> ${esc(comment.header)}</span></button>` : ''}</p>
    </li>`;
  }
  return `<li class="prr-thread" data-comment="${esc(comment.id)}">
    <p class="prr-head"><span class="prr-chip" data-tone="ok">Comment</span>${title}</p>
    ${comment.finding ? `<p class="prr-verdict">${esc(comment.finding)}</p>` : ''}
    ${rowHtml(entry, comment.id, 'Your comment', comment.body, comment.images || [], '', open, `your comment on ${comment.header}`)}
    ${open ? `<p class="prr-drop"><button type="button" class="prr-link" data-prr-keep="${esc(comment.id)}" data-kept="false">Drop<span class="sr-only"> ${esc(comment.header)}</span></button></p>` : ''}
  </li>`;
}

function footHtml(model, entry) {
  if (model.state === 'posted') {
    const posted = model.posted || {};
    const label = POSTED[posted.event] || 'Posted';
    return `<div class="prr-foot"><span class="prr-posted">Your review is on GitHub: ${posted.url ? `<a class="prr-link" href="${esc(posted.url)}" target="_blank" rel="noopener">${label}</a>` : label}</span></div>`;
  }
  const kept = model.comments.filter(comment => comment.kept && (comment.body || comment.images?.length));
  const lines = kept.length;
  const images = (model.noteImages?.length || 0) + kept.reduce((sum, comment) => sum + (comment.images?.length || 0), 0);
  const posting = !!entry.posting;
  const buttons = EVENTS.map(([event, label]) => {
    const primary = event === model.recommended;
    return `<orc-button variant="${primary ? 'primary' : 'secondary'}" size="compact" data-prr-post="${event}"${posting ? ' disabled' : ''}>${entry.posting === event ? 'Posting…' : label}</orc-button>`;
  }).join('');
  const error = entry.postError || model.lastError?.message || '';
  const parts = [lines === 1 ? '1 line comment' : `${lines} line comments`];
  if (model.note || model.noteImages?.length) parts.push('your note');
  if (images) parts.push(images === 1 ? '1 image' : `${images} images`);
  const detail = `Posts ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} as one GitHub review, as you`;
  return `${error ? `<p class="prr-post-error" role="alert">${esc(error)}</p>` : ''}
    <div class="prr-foot">${buttons}<span>${detail}</span></div>`;
}

function cardHtml(model, entry) {
  const posted = model.state === 'posted';
  const open = !posted && !entry.posting;
  const who = model.authorName || model.author;
  const comments = model.comments || [];
  return `<div class="prr is-review" role="region" aria-label="Your review of PR #${model.number}">
    <div class="prr-top"><span class="prr-dot${posted ? '' : ' is-ready'}" aria-hidden="true"></span><strong>Your review of PR #${model.number}${posted ? '' : ', ready to post'}</strong>${who ? `<span>to ${esc(who)}</span>` : ''}</div>
    <div class="prr-overall"><h4 class="prr-title">Overall</h4>${rowHtml(entry, 'note', 'Your note', model.note, model.noteImages || [], 'None. The review posts without a note.', open, 'your note')}${suggestionHtml(model, entry, open)}</div>
    ${comments.length ? `<ol class="prr-list">${comments.map(comment => commentHtml(comment, entry, open)).join('')}</ol>` : ''}
    ${footHtml(model, entry)}
  </div>`;
}

function paint(host, run, entry) {
  const model = entry.model;
  const signature = JSON.stringify([!entry.editing && emojiReady(), model, entry.error, entry.editing, entry.editImages, entry.saving, entry.saveError, entry.posting, entry.postError]);
  if (host.dataset.signature === signature && !host.hidden) return;
  const oldEditor = host.querySelector('#prr-edit');
  const draft = oldEditor?.value;
  const draftTarget = host.querySelector('[data-prr-save]')?.dataset.prrSave;
  // Images pasted but not saved yet belong to the box, which this repaint
  // replaces; the new box takes them back.
  const pasted = oldEditor?.dataset.prrImages != null ? window.orcTextareaAttachments?.(oldEditor) || [] : [];
  host.dataset.signature = signature;
  repaintWithEmoji(() => { if (cards.get(run.id) === entry && entry.isCurrent?.()) paint(host, run, entry); });
  const scroller = host.closest('.chat-scroll');
  const following = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  host.hidden = !model;
  host.innerHTML = model ? cardHtml(model, entry) : '';
  if (following) scroller.scrollTop = scroller.scrollHeight;
  const editor = host.querySelector('#prr-edit');
  if (editor) {
    if (editor.dataset.prrImages != null) {
      // One tray per run and target, so no other box reads these images.
      editor.dataset.orcAttachmentKey = `prr:${run.id}:${entry.editing}:${entry.editGeneration}`;
      if (pasted.length && draftTarget === entry.editing) window.orcRestoreAttachments?.(editor, pasted);
      wireImages(host, run, entry, editor);
    }
    if (draft != null && draftTarget === entry.editing) editor.value = draft;
    editor.focus({ preventScroll: true });
  }
  host.querySelectorAll('[data-prr-edit]').forEach(button => {
    button.onclick = () => {
      const target = button.dataset.prrEdit;
      entry.editing = target;
      entry.editGeneration = ++nextReviewEdit;
      entry.editImages = [...savedImages(entry.model, target)];
      entry.saveError = '';
      paint(host, run, entry);
    };
  });
  const cancel = host.querySelector('[data-prr-cancel]');
  if (cancel) {
    cancel.onclick = () => {
      const target = entry.editing;
      discardPasted(editor);
      entry.editing = null;
      entry.saveError = '';
      paint(host, run, entry);
      host.querySelector(`[data-prr-edit="${CSS.escape(target)}"]`)?.focus();
    };
  }
  wireReplyEditor(host, form => saveBody(host, run, entry, form.dataset.prrSave, form.querySelector('textarea').value,
    form.querySelector('textarea')));
  const useNote = host.querySelector('[data-prr-use-note]');
  if (useNote) useNote.onclick = () => saveBody(host, run, entry, 'note', entry.model.suggestedNote);
  host.querySelectorAll('[data-prr-keep]').forEach(button => {
    button.onclick = () => setKept(host, run, entry, button.dataset.prrKeep, button.dataset.kept === 'true');
  });
  host.querySelectorAll('[data-prr-post]').forEach(button => {
    button.addEventListener('click', () => postReview(host, run, entry, button.dataset.prrPost));
  });
}

function savedImages(model, target) {
  if (target === 'note') return model.noteImages || [];
  return model.comments.find(item => item.id === target)?.images || [];
}

// The images pasted into a box that is being put away unsaved are thrown away.
function discardPasted(editor) {
  if (!editor || editor.dataset.prrImages == null) return;
  (window.orcTextareaAttachments?.(editor) || []).forEach(reference => {
    const name = reference.split('/').pop();
    fetch(`/api/attachments/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  });
  window.orcClearAttachments?.(editor);
}

// The editor's paperclip and the saved images' Remove buttons.
function wireImages(host, run, entry, editor) {
  const picker = host.querySelector('[data-prr-file]');
  host.querySelector('[data-prr-attach]')?.addEventListener('click', () => picker?.click());
  picker?.addEventListener('change', () => {
    const room = MAX_IMAGES - entry.editImages.length - (window.orcTextareaAttachments?.(editor) || []).length;
    const files = [...(picker.files || [])];
    picker.value = '';
    if (files.length > room) announce(`A comment holds at most ${MAX_IMAGES} images`);
    if (room > 0 && files.length) window.orcAttachFiles?.(editor, files.slice(0, room));
    editor.focus({ preventScroll: true });
  });
  host.querySelectorAll('[data-prr-remove-image]').forEach(button => {
    button.onclick = () => {
      entry.editImages = entry.editImages.filter(image => image !== button.dataset.prrRemoveImage);
      paint(host, run, entry);
    };
  });
}

function repaint(host, run, entry) {
  if (cards.get(run.id) === entry && entry.isCurrent?.()) paint(host, run, entry);
}

async function send(run, entry, payload) {
  const response = await fetch(`/runs/${encodeURIComponent(run.id)}/pr-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, digest: entry.model.digest }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not save that change.');
  if (result.digest) entry.model.digest = result.digest;
  return result;
}

// Saves the note or one comment, from its Edit box or from Use it. From the
// Edit box it also saves the box's images: the saved ones still listed and
// any pasted in.
async function saveBody(host, run, entry, target, body, editor = null) {
  if (entry.saving) return;
  const withImages = editor?.dataset.prrImages != null;
  if (withImages && window.orcTextareaUploading?.(editor)) {
    entry.saveError = 'Wait for the image to finish adding.';
    paint(host, run, entry);
    return;
  }
  const pasted = withImages ? window.orcTextareaAttachments?.(editor) || [] : [];
  const images = withImages ? [...entry.editImages, ...pasted] : null;
  if (images && images.length > MAX_IMAGES) {
    entry.saveError = `A comment holds at most ${MAX_IMAGES} images.`;
    paint(host, run, entry);
    return;
  }
  entry.saving = true;
  entry.saveError = '';
  paint(host, run, entry);
  try {
    const result = await send(run, entry, images ? { target, body, images } : { target, body });
    const saved = Array.isArray(result.images) ? result.images : images;
    if (target === 'note') {
      entry.model.note = body.trim();
      if (saved) entry.model.noteImages = saved;
    } else {
      const comment = entry.model.comments.find(item => item.id === target);
      if (comment) {
        comment.body = body.trim();
        if (saved) comment.images = saved;
      }
    }
    // The run keeps its own copies now; the box lets go of the uploads.
    const box = host.querySelector('#prr-edit');
    if (withImages && box) window.orcClearAttachments?.(box);
    entry.editing = null;
    entry.editImages = [];
  } catch (error) {
    entry.saveError = error.message;
  } finally {
    entry.saving = false;
    repaint(host, run, entry);
    if (!entry.editing) host.querySelector(`[data-prr-edit="${CSS.escape(target)}"]`)?.focus();
  }
}

async function setKept(host, run, entry, id, kept) {
  try {
    await send(run, entry, { target: id, kept });
    const comment = entry.model.comments.find(item => item.id === id);
    if (comment) comment.kept = kept;
    entry.postError = '';
  } catch (error) {
    entry.postError = error.message;
  }
  repaint(host, run, entry);
}

async function postReview(host, run, entry, event) {
  if (entry.posting) return;
  entry.posting = event;
  entry.postError = '';
  entry.editing = null;
  paint(host, run, entry);
  try {
    const response = await fetch(`/runs/${encodeURIComponent(run.id)}/pr-review-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, digest: entry.model.digest }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not post the review.');
    entry.model.state = 'posted';
    entry.model.posted = { event: result.event || event, url: result.url || null };
    entry.model.lastError = null;
    showPostedInSidebar(run.id, { ...entry.model.posted, at: result.at || new Date().toISOString() });
  } catch (error) {
    entry.postError = error.message;
  } finally {
    entry.posting = null;
    repaint(host, run, entry);
  }
}
