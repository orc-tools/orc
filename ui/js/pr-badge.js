import { esc } from './dom-text.js';

// Resolve the PR URL(s) for a run. Frozen repository delivery (schemaVersion 1)
// is authoritative only when it actually yields PR URLs; if delivery is present
// but groupedPrs is empty, fall back to the flattened prUrls/prUrl fields (a
// compatibility projection for older clients). Shared by the detail header and
// the sidebar PR badge so both agree on which URL is "the" PR.
export function resolvePrUrls(meta, { observed = true } = {}) {
  meta = meta || {};
  const groupedDeliveryPresent = meta.delivery != null;
  const deliveryGroups = meta.delivery && meta.delivery.schemaVersion === 1
    && Array.isArray(meta.delivery.groups) ? meta.delivery.groups : [];
  const groupedPrs = deliveryGroups
    .filter(group => group && group.pr && typeof group.pr.url === 'string')
    .map(group => ({ url: group.pr.url, participantId: group.participantId,
      branch: group.branch, id: group.id }));
  const reviewedPr = meta.route === 'local-review' ? meta.review?.prUrl : null;
  // sourcePrUrl: the PR a branchless run started from, such as an answered review.
  // deliveryStatus.prUrl: the open PR the server found on a pushed run branch
  // that never recorded one, such as a run that pushed but never reached Ship.
  const branchPr = observed && !groupedDeliveryPresent ? meta.deliveryStatus?.prUrl : null;
  const urls = groupedDeliveryPresent && groupedPrs.length
    ? groupedPrs.map(item => item.url)
    : [].concat(meta.prUrls || meta.prUrl || reviewedPr || meta.sourcePrUrl || branchPr || []);
  return { urls, groupedPrs };
}

// Sidebar run-row PR badge — lives in .sub (outside the .run-link anchor;
// nesting anchors is invalid HTML and would truncate the run-link).
// GitHub octocat mark (Phosphor github-logo), matches the app's inline-SVG
// icon convention (viewBox 0 0 256 256, fill=currentColor).
export const GITHUB_MARK_SVG = '<svg class="pr-tag-icon" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68Z"></path></svg>';

function isGithubPrUrl(url) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#]|$)/.test(url || '');
}

// Shared PR-chip inner markup — the sidebar badge and the run-detail header
// chip both call this so the GitHub decision and glyph placement never
// diverge. GitHub PR URLs lead with the octocat mark, then the label;
// anything else keeps the plain trailing "↗" glyph.
export function prChipContent(url, label) {
  return isGithubPrUrl(url) ? `${GITHUB_MARK_SVG}${esc(label)}` : `${esc(label)} ↗`;
}

// Once a reviewer has the PR, the badge leads with the mark your team uses
// for that in Slack instead of the GitHub mark.
const PR_REVIEW_MARKS = {
  'picked-up': ['👀', 'picked up for review'],
  approved: ['✅', 'approved'],
};

// "Juan", "Juan and Kim", "Juan, Kim and Lee": the people a review state
// names, or '' when nobody is known.
const NAME_LIST = new Intl.ListFormat('en', { type: 'conjunction' });
export const peopleText = names => NAME_LIST.format((names || []).filter(name => typeof name === 'string' && name));
export const byPeople = names => (peopleText(names) ? ` by ${peopleText(names)}` : '');

export function prBadgeHtml(meta) {
  const { urls } = resolvePrUrls(meta);
  if (!urls.length) return '';
  const [mark, reviewStatus] = PR_REVIEW_MARKS[meta?.prReview?.state] || [];
  const status = reviewStatus && `${reviewStatus}${byPeople(meta.prReview.by)}`;
  const title = [urls.length > 1 ? `${urls.length} PRs — opens first` : '', status ? `PR ${status}` : ''].filter(Boolean).join(' · ');
  const content = mark ? `<span class="pr-tag-icon pr-tag-mark" aria-hidden="true">${mark}</span>PR` : prChipContent(urls[0], 'PR');
  return `<a class="pr-tag" href="${esc(urls[0])}" target="_blank" rel="noopener" aria-label="open PR in new tab${status ? `, ${status}` : ''}"${title ? ` title="${esc(title)}"` : ''}${mark ? ` data-review="${esc(meta.prReview.state)}"` : ''}>${content}</a>`;
}
