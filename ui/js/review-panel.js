import { $, CHAT_KEY, esc, fileUrl, reviewsForRun, runState, runStateTagHtml } from './core.js';

const selectedReviews = new Map();
let reviewPanelKey = null;
let reviewControlsKey = null;

export function selectReview(parentId, reviewId) {
  selectedReviews.set(parentId, reviewId);
}

export function showReviewPanel(run) {
  const reviews = reviewsForRun(run.id);
  const review = reviews.find(item => item.id === selectedReviews.get(run.id)) || reviews.at(-1);
  const controls = $('run-review-controls');
  const report = $('run-review-report');
  if (!review) {
    controls.replaceChildren();
    report.innerHTML = '<p class="run-diff-note">No review yet.</p>';
    reviewPanelKey = reviewControlsKey = null;
    return;
  }
  const state = runState(review.meta, review.files);
  const controlsKey = JSON.stringify([run.id, review.id, reviews.map(item => item.id), state]);
  if (controlsKey !== reviewControlsKey) {
    const focused = controls.contains(document.activeElement);
    const picker = reviews.length > 1
      ? `<span>Report</span>
        <orc-select id="run-review-select" aria-label="Report" size="compact">${reviews.map((item, index) =>
          `<option value="${esc(item.id)}"${item.id === review.id ? ' selected' : ''}>Review ${index + 1}${index === reviews.length - 1 ? ' · Latest' : ''}</option>`).join('')}</orc-select>`
      : '';
    controls.innerHTML = `${picker}
      <span id="run-review-status" role="status">${runStateTagHtml(state)}</span>
      <a href="#${encodeURIComponent(review.id)}/${CHAT_KEY}">Review conversation</a>`;
    const select = controls.querySelector('#run-review-select');
    if (select) {
      select.addEventListener('change', event => {
        selectReview(run.id, event.target.value);
        showReviewPanel(run);
      });
      if (focused) select.focus();
    }
    reviewControlsKey = controlsKey;
  }
  const recap = review.files?.find(file => file.path === 'review/recap.html');
  const key = JSON.stringify([review.id, recap?.size, review.meta.review?.resultDigest,
    review.meta.status, recap ? null : state]);
  if (key === reviewPanelKey) return;
  reviewPanelKey = key;
  if (recap) {
    const frame = document.createElement('iframe');
    frame.title = `Review report: ${review.meta.title || review.id}`;
    frame.src = fileUrl(review.id, recap.path);
    report.replaceChildren(frame);
  } else {
    report.innerHTML = `<div class="run-diff-note" role="status"><p>${esc(state.detail)}</p>
      <p>The report will appear here when it is ready.</p></div>`;
  }
}
