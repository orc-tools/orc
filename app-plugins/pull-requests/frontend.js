import { LINEAR_MARK_SVG, SLACK_MARK_SVG } from '/js/agent-marks.js';
import { $, announce, esc } from '/js/core.js';
import { GITHUB_MARK_SVG, openCancel } from '/js/dialogs.js';
import { createLaunchSelection } from '/js/launch-selection.js';
import '/js/model-picker.js';
import '/js/effort-slider.js';

const SIBLING_VIEWS = ['empty', 'head', 'tabs', 'version-banner', 'content', 'settings-view', 'changelog-view', 'new-view', 'stats-view', 'gallery-view', 'servers-view', 'bots-view', 'welcome-view', 'run-times'];
const REFRESHING_POLL_MS = 3000;
const IDLE_POLL_MS = 60000;
const REPO_SEARCH_DEBOUNCE_MS = 220;
const DAY_MS = 86400000;
const TEAM_KEY = 'orc.prManager.team';
const TAB_KEY = 'orc.prManager.tab';
const REVIEW_DEFAULT = { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' };
const PASSED_CHECKS_SHOWN = 6;
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
// The description and conversation are GitHub-rendered HTML written by anyone
// who can comment, so they get no scripts, no connections and no plugins.
// Images and video stay because PR descriptions are mostly screenshots.
const DESCRIPTION_CSP = "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'";
const DESCRIPTION_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const FRAME_TOKENS = ['--text', '--heading', '--muted-strong', '--accent', '--accent-text', '--border', '--code', '--panel', '--bg', '--chip',
  '--green', '--green-text', '--red', '--red-text', '--yellow', '--yellow-text', '--purple', '--purple-text'];
const TIMELINE_REVIEWS = {
  APPROVED: ['ok', 'ok', 'approved these changes'],
  CHANGES_REQUESTED: ['fail', 'fail', 'requested changes'],
  COMMENTED: ['neutral', 'reply', 'reviewed'],
  DISMISSED: ['neutral', 'neutral', 'left a review that was dismissed'],
  PENDING: ['neutral', 'reply', 'has a pending review'],
};
const TIMELINE_EVENTS = {
  merged: ['merged', 'merged', 'merged commit'],
  closed: ['fail', 'fail', 'closed this pull request'],
  reopened: ['ok', 'ok', 'reopened this pull request'],
  ready: ['neutral', 'ok', 'marked this pull request as ready for review'],
  draft: ['neutral', 'neutral', 'marked this pull request as draft'],
  'review-requested': ['neutral', 'gate', 'requested a review from'],
  'force-pushed': ['neutral', 'commit', 'force-pushed the branch'],
};
const ICON_PATHS = {
  ok: '<path d="M3.5 8.5l3 3 6-7"/>',
  fail: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  active: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  warn: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.8v2.7M8 11.6v.01"/>',
  gate: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
  merged: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="9" r="1.5"/><path d="M4.5 5v6M4.5 5c0 3 2 4 5.5 4"/>',
  neutral: '<circle cx="8" cy="8" r="4.5"/>',
  reply: '<path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7.5l-3 2.5V11H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5z"/>',
  commit: '<circle cx="8" cy="8" r="2.5"/><path d="M1.5 8h4M10.5 8h4"/>',
  conflict: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V7.5a2 2 0 0 0-2-2H7"/><path d="M8.5 4L7 5.5 8.5 7"/>',
  stack: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.6v2.6h-2.6"/>',
  bolt: '<path d="M9 1.8 3.8 9h3.6L6.6 14.2 12.2 7H8.4z"/>',
  team: '<circle cx="6" cy="6" r="2.2"/><path d="M2 13c.4-2.3 2-3.5 4-3.5s3.6 1.2 4 3.5"/><circle cx="11.5" cy="5.2" r="1.7"/><path d="M11.6 9c1.5.2 2.5 1.2 2.9 3"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  pr: '<circle cx="4" cy="3.6" r="1.6"/><circle cx="4" cy="12.4" r="1.6"/><circle cx="12" cy="12.4" r="1.6"/><path d="M4 5.2v5.6M12 10.8V7a2 2 0 0 0-2-2H7.6"/><path d="M9 3.4 7.4 5 9 6.6"/>',
  dots: '<path d="M4.4 8h.01M8 8h.01M11.6 8h.01" stroke-width="2.4"/>',
  pencil: '<path d="M3 13l.6-2.8 7-7a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2l-7 7z"/><path d="M9.6 4.2l2.2 2.2"/>',
  launch: '<path d="M8 13V3.4M4.2 7 8 3.2 11.8 7"/><path d="M3 13.4h10"/>',
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1.2 1.5H2.8z"/><path d="M6.8 14a1.3 1.3 0 0 0 2.4 0"/>',
  megaphone: '<path d="M2.5 6.5v3h2l5 3v-9l-5 3z"/><path d="M12 6.2a2.6 2.6 0 0 1 0 3.6"/>',
};
// Drawn on a 40px grid. An outline says what kind of thing sits in it before
// the words are read; its colour is the tone.
const ring = (points, outer, inner) => Array.from({ length: points * 2 }, (_, index) => {
  const radius = index % 2 ? inner : outer;
  const angle = Math.PI * index / points - Math.PI / 2;
  return `${(20 + radius * Math.cos(angle)).toFixed(1)} ${(20 + radius * Math.sin(angle)).toFixed(1)}`;
});
const burst = points => `M${ring(points, 18.5, 14.2).join('L')}z`;
// Each lobe curves out from one inner point to the next, pulled by the outer point between them.
const scallop = lobes => {
  const points = ring(lobes, 22.5, 15.5);
  return `M${points.at(-1)}${Array.from({ length: lobes }, (_, lobe) => `Q${points[lobe * 2]} ${points[lobe * 2 + 1]}`).join('')}z`;
};
const SHAPE_PATHS = {
  circle: 'M20 2.5a17.5 17.5 0 1 1 0 35 17.5 17.5 0 0 1 0-35z',
  squircle: 'M20 2.5c12.6 0 17.5 4.9 17.5 17.5S32.6 37.5 20 37.5 2.5 32.6 2.5 20 7.4 2.5 20 2.5z',
  octagon: 'M13 2.8h14L37.2 13v14L27 37.2H13L2.8 27V13z',
  diamond: 'M20 2 38 20 20 38 2 20z',
  hexagon: 'M20 2 35.6 11v18L20 38 4.4 29V11z',
  shield: 'M20 2.5 34.5 7.5v11c0 8.6-5.6 15-14.5 19-8.9-4-14.5-10.4-14.5-19v-11z',
  bubble: 'M9 4h22a6 6 0 0 1 6 6v13a6 6 0 0 1-6 6H20.5L12 37v-8H9a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6z',
  blob: 'M22 2.6c8.4.6 14.8 6 15.3 15 .5 9.4-4.8 18.6-15.4 19.7C11.3 38.4 3.4 31.6 2.7 21.8 2 11.6 11.2 1.8 22 2.6z',
  ticket: 'M5.5 7h29a3 3 0 0 1 3 3v5.2a4.8 4.8 0 0 0 0 9.6V30a3 3 0 0 1-3 3h-29a3 3 0 0 1-3-3v-5.2a4.8 4.8 0 0 0 0-9.6V10a3 3 0 0 1 3-3z',
  burst: burst(10),
  seal: scallop(9),
};
const SIDEBAR_PR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4"/><path d="M13 4.5 10.5 7 13 9.5"/></svg>';
const CHECK_SIGNALS = { success: ['ok', 'Checks passing'], failure: ['fail', 'Checks failing'], pending: ['active', 'Checks running'] };
const SLACK_STATES = {
  approved: ['ok', 'Approved in Slack', '✅'],
  'picked-up': ['active', 'Picked up in Slack', '👀'],
  waiting: ['neutral', 'Not picked up yet', ''],
};
const STATE_LABELS = { OPEN: ['Open', 'ok'], MERGED: ['Merged', 'merged'], CLOSED: ['Closed', 'fail'] };
const REVIEW_STATES = {
  APPROVED: ['Approved', 'ok'], CHANGES_REQUESTED: ['Changes requested', 'fail'], COMMENTED: ['Commented', 'neutral'],
  DISMISSED: ['Dismissed', 'neutral'], PENDING: ['Pending', 'neutral'],
};
const CHECK_STATES = {
  SUCCESS: ['Passed', 'ok'], FAILURE: ['Failed', 'fail'], ERROR: ['Failed', 'fail'], TIMED_OUT: ['Timed out', 'fail'],
  STARTUP_FAILURE: ['Failed', 'fail'], CANCELLED: ['Cancelled', 'fail'], ACTION_REQUIRED: ['Action required', 'warn'], STALE: ['Stale', 'warn'],
  SKIPPED: ['Skipped', 'neutral'], NEUTRAL: ['Neutral', 'neutral'],
  PENDING: ['Running', 'active'], IN_PROGRESS: ['Running', 'active'], QUEUED: ['Queued', 'active'], EXPECTED: ['Expected', 'active'],
};
const CHECK_ORDER = { fail: 0, warn: 1, active: 2, neutral: 3, ok: 4 };
const DECISIVE_REVIEWS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

let active = false;
let wired = false;
let mode = null;
let shellKind = null;
let timer = 0;
let request = null;
let snapshot = null;
let loadError = false;
let query = '';
let detailPath = null;
let detail = null;
let reviewSetup = null;
let mergePending = false;
let conflictPending = false;
let onboarding = null;
let repoRequest = null;
let repoSearchTimer = 0;
let openOnboardingNext = false;
let settingsSlot = null;
let pickedTab = readStore(TAB_KEY);
const cachedCatalogOrgs = new Map();
const cachedCatalogRepos = new Map();
const frames = new Map();

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts until reload */ }
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function pluralRepo(count) {
  return count === 1 ? '1 repository' : `${count} repositories`;
}

function elapsedMs(iso) {
  const at = Date.parse(iso || '');
  return Number.isNaN(at) ? null : Math.max(0, Date.now() - at);
}

function shortAge(iso) {
  const ms = elapsedMs(iso);
  if (ms === null) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  const days = Math.floor(minutes / 1440);
  return days < 365 ? `${days}d` : `${Math.floor(days / 365)}y`;
}

function updatedText(iso) {
  const ms = elapsedMs(iso);
  if (ms === null) return 'Updated';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (minutes < 1440) return `Updated ${plural(Math.floor(minutes / 60), 'hour')} ago`;
  return `Updated ${plural(Math.floor(minutes / 1440), 'day')} ago`;
}

function icon(name) {
  return `<svg class="prs-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.neutral}</svg>`;
}

// Only the outline is hidden from a screen reader: a count inside is still read.
function shaped(shape, inner, cls) {
  return `<span class="prs-shape ${cls}" data-shape="${shape}"><svg class="prs-shape-bg" viewBox="0 0 40 40" aria-hidden="true"><path d="${SHAPE_PATHS[shape] || SHAPE_PATHS.circle}"/></svg>${inner}</span>`;
}

// Pictures that failed to load, so the next render does not ask for them again.
const brokenImages = new Set();

function monogram(name) {
  const words = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2)) || '?').toUpperCase();
}

// The monogram shows until a picture loads over it and stays when none does.
function logo(kind, name, sources) {
  const [src, ...rest] = sources.filter(source => source && !brokenImages.has(source));
  const image = src ? `<img src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(rest.join(' '))}">` : '';
  return `<span class="prs-logo" data-kind="${kind}" aria-hidden="true"><span>${esc(monogram(name))}</span>${image}</span>`;
}

function logoFailed(image) {
  brokenImages.add(image.getAttribute('src'));
  const [next, ...rest] = image.dataset.fallback.split(' ').filter(Boolean);
  if (!next) return image.remove();
  image.dataset.fallback = rest.join(' ');
  image.src = next;
}

// An Orc project shows its own icon, as in the sidebar. Any other repository
// shows its owner's GitHub picture.
function repoRef(row) {
  const project = snapshot?.repoProjects?.[String(row.repo).toLowerCase()];
  const mark = logo('repo', String(row.repo).split('/').pop(),
    [project && `/api/project-icon?project=${encodeURIComponent(project)}`, safeUrl(row.ownerAvatarUrl)]);
  return `<span class="prs-repo">${mark}<span class="prs-ref">${esc(prRef(row))}</span></span>`;
}

function authorName(row) {
  return `<span class="prs-author">${logo('person', row.author, [safeUrl(row.authorAvatarUrl)])}${esc(row.author || 'unknown')}</span>`;
}

function pill(html, tone = 'neutral') {
  return `<span class="prs-pill" data-tone="${tone}">${html}</span>`;
}

function signal(tone, text, mark = icon(tone), title = '') {
  return `<span class="prs-signal" data-tone="${tone}"${title ? ` title="${esc(title)}"` : ''}>${mark}<span>${text}</span></span>`;
}

// Who left the reaction behind a Slack post's state: "by Juan and Kim", or ''.
const NAME_LIST = new Intl.ListFormat('en', { type: 'conjunction' });
function slackBy(slack) {
  const names = slack?.state === 'waiting' ? [] : (slack?.by || []).filter(Boolean);
  return names.length ? `by ${NAME_LIST.format(names)}` : '';
}

function emoji(char) {
  return char ? `<span class="prs-emoji" aria-hidden="true">${char}</span>` : icon('neutral');
}

function prHash(row) {
  return `#prs/${String(row.repo).split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(row.number)}`;
}

function prRef(row) {
  return `${row.repo}#${row.number}`;
}

function diffStat(row) {
  if (!Number.isFinite(row.additions) && !Number.isFinite(row.deletions)) return '';
  const added = row.additions || 0;
  const deleted = row.deletions || 0;
  // Five squares split as the change is. A side with any lines keeps one square.
  const green = Math.min(deleted ? 4 : 5, Math.max(added ? 1 : 0, Math.round(5 * added / (added + deleted))));
  const squares = added + deleted
    ? `<span class="prs-diff-squares" aria-hidden="true">${'<i data-kind="add"></i>'.repeat(green)}${'<i data-kind="del"></i>'.repeat(5 - green)}</span>`
    : '';
  return `<span class="prs-diff">${squares}<span class="prs-add">+${added.toLocaleString()}</span> <span class="prs-del">−${deleted.toLocaleString()}</span><span class="sr-only"> lines</span></span>`;
}

function ticketChip(ticket) {
  if (!ticket?.ref) return '';
  const mark = /^https:\/\/linear\.app\//.test(ticket.url || '') ? LINEAR_MARK_SVG : '';
  return ticket.url
    ? `<a class="prs-ticket" href="${esc(ticket.url)}" target="_blank" rel="noopener noreferrer">${mark}${esc(ticket.ref)}</a>`
    : `<span class="prs-ticket">${esc(ticket.ref)}</span>`;
}

function reviewerName(login) {
  return login.startsWith('team:') ? `${login.slice(5)} (team)` : login;
}

function nameList(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`;
}

function notPickedUp(posted) {
  return posted ? `Posted ${posted} ago, not picked up` : 'Posted, not picked up';
}

function checksSignal(row) {
  const [tone, text] = CHECK_SIGNALS[row.checkStatus] || [];
  return tone ? signal(tone, text) : '';
}

function reviewSignal(row) {
  if (row.reviewStatus === 'changes_requested') return signal('fail', 'Changes requested');
  if (row.reviewStatus === 'approved') return signal('ok', row.approvals > 1 ? `${row.approvals} approvals` : 'Approved');
  if (row.reviewStatus === 'review_required') return signal('neutral', row.hasCommentReviews ? 'Comments, no approval' : 'No reviews yet');
  return '';
}

// More than one person's reaction is worth its count: two pairs of eyes
// already on a post is a reason to pick up another.
function slackSignal(row) {
  if (!slackOn()) return '';
  if (!row.slack) return signal('neutral', 'Not posted in Slack');
  const [tone, text, mark] = SLACK_STATES[row.slack.state] || ['neutral', 'Posted in Slack', ''];
  const counted = name => (row.slack.state === 'approved' ? name.includes('check') : name === 'eyes');
  const count = (row.slack.reactions || []).reduce((sum, reaction) => sum + (counted(String(reaction.name)) ? reaction.count || 0 : 0), 0);
  const by = slackBy(row.slack);
  return signal(tone, count > 1 && mark ? `${text} · ${count}` : text, emoji(mark), by && `${text} ${by}`);
}

// How long since anything happened on the PR or its Slack post. Slack does not
// say when a reaction was left, so the post's own time stands in for it.
function quietFor(row) {
  const times = [elapsedMs(row.updatedAt), elapsedMs(row.slack?.postedAt)].filter(ms => ms !== null);
  return times.length ? Math.min(...times) : null;
}

// Problems outrank Draft so a draft the server files under Needs your action says why.
function ownStatus(row) {
  const posted = shortAge(row.slack?.postedAt);
  const waitingOn = (row.requestedReviewers || []).map(reviewerName);
  // A team is asked by CODEOWNERS, so only a person or a reaction means someone has it.
  const people = (row.requestedReviewers || []).filter(login => !login.startsWith('team:'));
  const pickedUp = row.slack?.state === 'picked-up';
  if (row.mergeable === 'CONFLICTING') return { id: 'conflict', tone: 'fail', text: 'Resolve the conflict', detail: `Conflicts with ${row.baseRef || 'its base branch'}` };
  if (row.checkStatus === 'failure') return { id: 'checks', tone: 'fail', text: 'Fix failing checks' };
  if (row.reviewStatus === 'changes_requested') return { id: 'changes', tone: 'fail', text: 'Address requested changes' };
  if ((row.actionReasons || []).some(reason => reason.kind === 'feedback')) return { id: 'feedback', tone: 'fail', text: 'Address new feedback' };
  if (row.isDraft) return { id: 'draft', tone: 'neutral', text: 'Draft', detail: row.reviewStatus === 'approved' ? 'Approved; mark it ready to merge' : 'Not ready for review' };
  if (row.reviewStatus === 'approved') {
    return row.checkStatus === 'pending'
      ? { id: 'approved', tone: 'active', text: 'Approved, checks running', detail: 'Merge when they pass' }
      : { id: 'ready', tone: 'ok', text: 'Ready to merge' };
  }
  if (row.slack?.state === 'approved') return { id: 'slack-approved', tone: 'active', text: 'Approved in Slack', detail: 'No GitHub approval yet' };
  const quiet = quietFor(row);
  if ((pickedUp || people.length) && quiet !== null && quiet >= DAY_MS) {
    const days = Math.floor(quiet / DAY_MS);
    return { id: 'chase', tone: 'warn', text: 'Chase the review', detail: `${pickedUp ? 'Picked up in Slack' : `Waiting on ${nameList(people)}`}, quiet for ${days}d` };
  }
  if (pickedUp) return { id: 'reviewing', tone: 'active', text: 'Being reviewed', detail: posted ? `Posted ${posted} ago` : '' };
  if (!waitingOn.length && !row.slack) return { id: 'ask', tone: 'warn', text: 'Ask for a review', detail: slackOn() ? 'No reviewer requested, not posted in Slack' : 'No reviewer requested' };
  const detail = waitingOn.length ? `Waiting on ${nameList(waitingOn)}` : notPickedUp(posted);
  const stale = row.slack && elapsedMs(row.slack.postedAt) >= DAY_MS;
  return { id: 'waiting', tone: stale ? 'warn' : 'neutral', text: 'Waiting for review', detail };
}

// Slack turned off in Settings, or not connected in Claude Code, leaves no
// Slack on the page. The server already drops Slack from every row; this hides
// the parts that would otherwise say "not posted".
function slackOn() {
  return snapshot?.slack?.shown !== false;
}

function sameTag(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function teamOptions() {
  const tags = (snapshot?.team?.tags || []).filter(tag => !sameTag(tag, 'All'));
  const team = selectedTeam();
  return team && !tags.some(tag => sameTag(tag, team)) ? [...tags, team].sort() : tags;
}

function selectedTeam() {
  const stored = readStore(TEAM_KEY);
  if (stored !== null) return stored || null;
  return snapshot?.team?.detected || null;
}

function rowTags(row) {
  return row.slack?.tags || (row.slack?.tag ? [row.slack.tag] : []);
}

function tagged(row, tag) {
  return rowTags(row).some(own => sameTag(own, tag));
}

function matchesQuery(row) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [row.title, row.repo, `${row.repo}#${row.number}`, `#${row.number}`, row.author, row.ticket?.ref]
    .filter(Boolean).join('\n').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

const renderedHtml = new WeakMap();

function replaceHtml(el, html) {
  if (!el || renderedHtml.get(el) === html) return;
  renderedHtml.set(el, html);
  const focused = el.contains(document.activeElement) ? document.activeElement : null;
  el.innerHTML = html;
  if (!focused) return;
  const key = focused.dataset.focusKey;
  const target = (key && [...el.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key))
    || $(el.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby')) || $('pr-manager-title');
  target?.focus({ preventScroll: true });
}

// The server sections whose rows go to Do next instead of your other pull requests.
const TOP_SECTIONS = ['ready', 'needs-action'];

// The lists in page order. Each is a tab: its button carries the count, its panel the rows.
const TABS = ['now', 'stale', 'team-reviews', 'waiting', 'reviewed', 'own'];

function tabHtml(id) {
  return `<button type="button" role="tab" id="prs-${id}-title" class="prs-tab" data-tab="${id}" aria-controls="prs-panel-${id}" aria-selected="false" tabindex="-1"></button>`;
}

function panelHtml(id, extra = '') {
  return `<section id="prs-panel-${id}" class="prs-section" role="tabpanel" aria-labelledby="prs-${id}-title" hidden>${extra}<div id="prs-${id}"></div></section>`;
}

function listsHtml() {
  const extra = { 'team-reviews': '<div id="prs-team-pick" class="prs-panel-tools"></div>' };
  return `<div id="prs-lists" class="prs-lists"><div id="prs-tabs" class="prs-tabs" role="tablist" aria-label="Pull request lists">${TABS.map(tabHtml).join('')}</div>
    ${TABS.map(id => panelHtml(id, extra[id])).join('')}</div>`;
}

const visibleTabs = () => [...$('prs-tabs').children].filter(tab => !tab.hidden);

// The tab you picked while it is on the page, else the first one there.
// Focus on a tab that just left follows to the open one.
function showTab(onTab = false) {
  const tabs = visibleTabs();
  const current = tabs.find(tab => tab.dataset.tab === pickedTab) || tabs[0];
  for (const tab of $('prs-tabs').children) {
    const on = tab === current;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;
  }
  const lists = $('prs-lists');
  // The first tab stands on the panel's square corner; any other needs a foot on both sides.
  lists.dataset.lead = String(current === tabs[0]);
  lists.dataset.loud = String(current?.dataset.tab === 'now' && current.dataset.tone === 'fail');
  if (onTab && document.activeElement !== current) current?.focus({ preventScroll: true });
}

function pickTab(tab) {
  pickedTab = tab.dataset.tab;
  writeStore(TAB_KEY, pickedTab);
  showTab();
  tab.focus();
  tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function headingHtml() {
  return `<div class="prs-heading">${shaped('blob', icon('pr'), 'prs-crest')}<div><h2 id="pr-manager-title" tabindex="-1">Pull requests</h2>
      <p class="prs-note"><span id="prs-status" role="status">Loading pull requests…</span><span id="prs-sources"></span></p></div></div>`;
}

function loadingShell() {
  return `<div class="prs-wrap"><header class="prs-header">${headingHtml()}</header></div>`;
}

function dashboardShell() {
  return `<div class="prs-wrap"><header class="prs-header">${headingHtml()}
      <div class="prs-header-actions"><label class="prs-search">${icon('search')}<span class="sr-only">Search pull requests</span><input id="prs-search" type="search" placeholder="Search title, repo, #number, author, ticket" autocomplete="off" spellcheck="false"></label>
      <button type="button" id="prs-refresh" class="settings-btn-inline">${icon('refresh')}<span>Refresh</span></button>
      <button type="button" id="prs-settings" class="settings-btn-inline prs-settings-btn" aria-label="Settings">${icon('settings')}<span>Settings</span></button></div></header>
    <ul id="prs-notices" class="prs-notices"></ul>
    ${listsHtml()}</div>`;
}

function scopeSummaryText(scope) {
  if (!scope) return 'Not configured yet';
  if (scope.mode === 'all') return 'All repositories';
  const orgs = scope.orgs || [];
  const repos = scope.repos || [];
  const items = [...orgs.map(org => `${org}/*`), ...repos];
  if (!items.length) return 'Not configured yet';
  if (items.length <= 2) return items.join(', ');
  const parts = [];
  if (orgs.length) parts.push(plural(orgs.length, 'org'));
  if (repos.length) parts.push(pluralRepo(repos.length));
  return parts.join(', ');
}

function teamPickHtml(team) {
  const options = teamOptions().map(tag => `<option value="${esc(tag)}"${sameTag(tag, team) ? ' selected' : ''}>${esc(tag)}</option>`).join('');
  return `<div class="prs-team"><span>Team</span><orc-select id="prs-team" aria-label="Team" size="compact" data-focus-key="team"><option value=""${team ? '' : ' selected'}>No team</option>${options}</orc-select></div>`;
}

function reviewHash(row) {
  return `${prHash(row)}/review`;
}

function rowLinks(row, lead = '') {
  const ref = esc(prRef(row));
  const slack = row.slack?.permalink
    ? `<a class="prs-icon-link" href="${esc(row.slack.permalink)}" target="_blank" rel="noopener noreferrer" aria-label="Open the Slack post for ${ref}" title="Open the Slack post" data-focus-key="slack:${esc(row.url)}">${SLACK_MARK_SVG}</a>`
    : '';
  return `<div class="prs-row-links">${lead}${slack}<a class="prs-icon-link" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${ref} on GitHub" title="Open on GitHub" data-focus-key="github:${esc(row.url)}">${GITHUB_MARK_SVG}</a></div>`;
}

function rowTitle(row) {
  return `<a class="prs-row-title" href="${esc(prHash(row))}" data-focus-key="pr:${esc(row.url)}">${esc(row.title)}</a>`;
}

function meta(parts) {
  return `<p class="prs-meta">${parts.filter(Boolean).map(part => `<span>${part}</span>`).join('')}</p>`;
}

function shortRef(target, row) {
  return target.repo === row.repo ? `#${target.number}` : `${String(target.repo).split('/').pop()}#${target.number}`;
}

function relationLinks(row, targets) {
  return targets.map(target => `<a href="${esc(prHash(target))}" data-focus-key="relation:${esc(row.url)}:${esc(target.url)}">${esc(shortRef(target, row))}</a>`).join(', ');
}

// A linked PR already framed beside this row needs no chip; one in another
// list or section does, because nothing else on screen connects them.
function relations(row, near) {
  const linked = (row.linkedWith || []).filter(target => !near.has(target.url));
  return [
    row.stackedOn ? `<span class="prs-relation">${icon('stack')}Stacked on ${relationLinks(row, [row.stackedOn])}</span>` : '',
    linked.length ? `<span class="prs-relation">${icon('link')}Linked to ${relationLinks(row, linked)}</span>` : '',
  ];
}

function groupLabel(kind, rows) {
  if (kind === 'stack') return `Stack · ${rows.length} PRs`;
  const tickets = new Set(rows.map(row => row.ticket?.ref).filter(Boolean));
  const repos = new Set(rows.map(row => row.repo)).size;
  return ['Linked', tickets.size === 1 ? [...tickets][0] : '', repos > 1 ? `${repos} repos` : `${rows.length} PRs`].filter(Boolean).join(' · ');
}

function rowsHtml(rows, render) {
  const counts = new Map();
  for (const row of rows) if (row.group) counts.set(row.group.id, (counts.get(row.group.id) || 0) + 1);
  const shown = new Set();
  return rows.map(row => {
    const id = row.group?.id;
    if (!id || counts.get(id) < 2) return render(row, new Set());
    if (shown.has(id)) return '';
    shown.add(id);
    const members = rows.filter(other => other.group?.id === id).sort((a, b) => a.group.position - b.group.position);
    const near = new Set(members.map(member => member.url));
    const label = groupLabel(row.group.kind, members);
    return `<li class="prs-group" data-kind="${esc(row.group.kind)}"><p class="prs-group-label">${icon(row.group.kind === 'stack' ? 'stack' : 'link')}<span>${esc(label)}</span></p>
      <ul class="prs-rows" aria-label="${esc(label)}">${members.map(member => render(member, near)).join('')}</ul></li>`;
  }).join('');
}

// A PR someone else wants reviewed. In your team's list the post may already
// be picked up, so the lead says how long ago it was posted, not that it waits.
function reviewRow(row, near, team = false) {
  const waited = shortAge(row.waitingSince);
  const unpicked = !row.slack || row.slack.state === 'waiting';
  const tone = unpicked && waited && elapsedMs(row.waitingSince) >= DAY_MS ? 'warn' : 'neutral';
  // The ring closes at two days, so it is half full when a day's wait turns it yellow.
  const filled = Math.round(100 * Math.min(1, elapsedMs(row.waitingSince) / (2 * DAY_MS)));
  const dial = `<svg class="prs-dial" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle cx="20" cy="20" r="17" pathLength="100" stroke-dasharray="${filled} 100"/></svg>`;
  const lead = waited
    ? `<div class="prs-wait" data-tone="${tone}">${dial}<span class="prs-wait-value">${waited}</span><span class="prs-wait-label">${unpicked ? 'waiting' : 'ago'}</span></div>`
    : '<div class="prs-wait"></div>';
  const tag = !team && row.slack?.tag ? `<span class="prs-tag"><span class="sr-only">Slack tag </span>${esc(row.slack.tag)}</span>` : '';
  const signals = [team ? slackSignal(row) : '', team && row.reviewRequestedFromYou ? signal('gate', 'Requested from you') : '',
    checksSignal(row), team && row.reviewStatus === 'approved' ? reviewSignal(row) : '',
    row.reviewStatus === 'changes_requested' ? signal('fail', 'Changes requested') : '',
    row.mergeable === 'CONFLICTING' ? signal('fail', 'Conflict', icon('conflict')) : ''];
  const start = `<a class="prs-start" href="${esc(reviewHash(row))}"${unpicked ? ' data-lead="true"' : ''} aria-label="Review ${esc(prRef(row))} in Orc" data-focus-key="start:${esc(row.url)}">Review in Orc</a>`;
  return `<li class="prs-row prs-row-waiting">${lead}
    <div class="prs-row-body">${rowTitle(row)}
      ${meta([repoRef(row), authorName(row), diffStat(row), tag, ...relations(row, near), ...signals])}</div>
    ${rowLinks(row, start)}</li>`;
}

// A post left in Slack with no 👀 or ✅. The way to move it is in Slack, so
// Open in Slack leads; your own posts are marked so you can bump them.
function staleRow(row) {
  const age = shortAge(row.waitingSince);
  const old = elapsedMs(row.waitingSince) >= 7 * DAY_MS;
  const mine = String(row.author || '').toLowerCase() === String(snapshot?.viewer?.login || '').toLowerCase();
  const tag = row.slack?.tag ? `<span class="prs-tag"><span class="sr-only">Slack tag </span>${esc(row.slack.tag)}</span>` : '';
  const ref = esc(prRef(row));
  const open = row.slack?.permalink
    ? `<a class="prs-open-slack" href="${esc(row.slack.permalink)}" target="_blank" rel="noopener noreferrer" aria-label="Open the Slack post for ${ref}" data-focus-key="slack:${esc(row.url)}">${SLACK_MARK_SVG}<span>Open in Slack</span></a>`
    : '';
  return `<li class="prs-row prs-row-stale"><div class="prs-age" data-tone="${old ? 'fail' : 'warn'}"><b>${esc(age || '')}</b><span>no reaction</span></div>
    <div class="prs-row-body">${rowTitle(row)}
      ${meta([repoRef(row), mine ? '<span class="prs-author prs-mine">You</span>' : authorName(row), diffStat(row), tag])}</div>
    <div class="prs-row-links">${open}<a class="prs-icon-link" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${ref} on GitHub" title="Open on GitHub" data-focus-key="github:${esc(row.url)}">${GITHUB_MARK_SVG}</a></div></li>`;
}

const STATUS_MARKS = {
  conflict: ['diamond', 'conflict'], checks: ['octagon', 'fail'], changes: ['bubble', 'fail'], feedback: ['bubble', 'dots'],
  draft: ['squircle', 'pencil'], approved: ['circle', 'active'], ready: ['seal', 'ok'], 'slack-approved': ['circle', 'ok'],
  chase: ['hexagon', 'bell'], reviewing: ['circle', 'eye'], ask: ['hexagon', 'megaphone'], waiting: ['circle', 'active'],
  open: ['seal', 'launch'], rereview: ['shield', 'gate'], replied: ['bubble', 'dots'], pushed: ['circle', 'commit'], author: ['circle', 'active'],
};

function statusHtml(status) {
  const [shape, mark] = STATUS_MARKS[status.id];
  return `<div class="prs-status" data-tone="${status.tone}">${shaped(shape, icon(mark), 'prs-status-mark')}
    <p class="prs-status-line"><span class="prs-status-text">${esc(status.text)}</span>${status.detail ? `<span class="prs-status-detail">${esc(status.detail)}</span>` : ''}</p></div>`;
}

function ownRow(row, near) {
  const status = ownStatus(row);
  const updated = shortAge(row.updatedAt);
  const run = row.orcRun?.runId
    ? `<a class="prs-run" href="#${esc(encodeURIComponent(row.orcRun.runId))}" aria-label="Orc run: ${esc(row.orcRun.title || row.orcRun.runId)}" data-focus-key="run:${esc(row.url)}">Orc run</a>`
    : '';
  const signals = [row.isDraft && status.id !== 'draft' ? signal('neutral', 'Draft') : '', checksSignal(row), row.isDraft ? '' : reviewSignal(row),
    row.mergeable === 'CONFLICTING' ? signal('fail', 'Conflict', icon('conflict')) : '', row.isDraft ? '' : slackSignal(row)].join('');
  return `<li class="prs-row prs-row-own" data-status="${status.id}">${statusHtml(status)}
    <div class="prs-row-body">${rowTitle(row)}
      ${meta([repoRef(row), ticketChip(row.ticket), diffStat(row), ...relations(row, near), updated ? `updated ${updated} ago` : '', run])}
      ${signals ? `<p class="prs-signals">${signals}</p>` : ''}${reasonsHtml(row)}</div>
    ${rowLinks(row)}</li>`;
}

const REASON_TEXT = {
  feedback: reason => `${reason.bot ? '' : 'Comments from '}${reason.label}${reason.bot ? ' reviewed' : ''}`,
  changes: reason => `Changes requested by ${reason.label}`,
  conflict: reason => reason.label,
  checks: reason => reason.label,
};
const REASON_MARKS = { feedback: 'reply', changes: 'fail', conflict: 'conflict', checks: 'fail' };

function reasonsHtml(row) {
  const reasons = row.actionReasons || [];
  if (!reasons.length) return '';
  const items = reasons.map(reason => `<li data-kind="${esc(reason.kind)}">${icon(REASON_MARKS[reason.kind] || 'warn')}<span>${esc((REASON_TEXT[reason.kind] || (r => r.label))(reason))}</span></li>`).join('');
  const proposal = row.garyProposal?.href
    ? `<a class="prs-proposal" href="${esc(row.garyProposal.href)}" data-focus-key="proposal:${esc(row.url)}">${esc(row.garyProposal.label || 'See the suggested plan')}</a>`
    : '';
  return `<div class="prs-reasons"><span class="sr-only">Why it needs you: </span><ul>${items}</ul>${proposal}</div>`;
}

// The Ship gate holds Open PR with every check that decides whether it is
// offered, so the row links there rather than repeating them.
function readyToOpenActions(run) {
  const id = esc(run.runId);
  const name = esc(run.title || run.runId);
  const gate = `#${encodeURIComponent(run.runId)}${run.gate ? `/${run.gate.split('/').map(encodeURIComponent).join('/')}` : ''}`;
  return `<div class="prs-row-actions">
    <a class="settings-btn-inline prs-link-btn" href="${esc(gate)}" aria-label="Open the Ship gate for ${name}" data-focus-key="gate:${id}">Open PR…</a>
    <button type="button" class="settings-btn-inline prs-link-btn prs-cancel-run" data-cancel-run="${id}" aria-label="Cancel run ${name}" data-focus-key="cancel:${id}">Cancel run</button></div>`;
}

function readyToOpenRow(run) {
  const updated = shortAge(run.updatedAt);
  return `<li class="prs-row prs-row-own prs-row-open">${statusHtml({ id: 'open', tone: 'ok', text: 'Ready to open', detail: 'At the Ship gate' })}
    <div class="prs-row-body"><a class="prs-row-title" href="#${esc(encodeURIComponent(run.runId))}" data-focus-key="open:${esc(run.runId)}">${esc(run.title || run.runId)}</a>
      ${meta([run.project ? esc(run.project) : '', run.branch ? `<span class="prs-ref">${esc(run.branch)}</span>` : '', updated ? `updated ${updated} ago` : ''])}</div>
    ${readyToOpenActions(run)}</li>`;
}

// A cancelled run leaves the Ship gate, so it drops out of Ready to open now
// rather than at the next poll.
function cancelReadyRun(runId) {
  openCancel(runId, {
    onCancelled: id => {
      if (!snapshot?.readyToOpen) return;
      snapshot.readyToOpen = snapshot.readyToOpen.filter(run => run.runId !== id);
      renderDashboard();
      if (active && mode === 'dashboard') $('prs-now-title')?.focus();
    },
  });
}

function reviewedStatus(row) {
  const { repliedAt, pushedAt, reRequestedAt } = row.reviewActivity || {};
  if (reRequestedAt) return { id: 'rereview', tone: 'gate', text: 'Re-review requested', detail: `${shortAge(reRequestedAt)} ago` };
  if (repliedAt) return { id: 'replied', tone: 'gate', text: 'Author replied', detail: pushedAt ? 'and pushed new commits' : `${shortAge(repliedAt)} ago` };
  if (pushedAt) return { id: 'pushed', tone: 'gate', text: 'New commits', detail: `${shortAge(pushedAt)} ago` };
  return { id: 'author', tone: 'neutral', text: 'Waiting on author' };
}

function reviewedRow(row, near) {
  const status = reviewedStatus(row);
  const reviewed = shortAge(row.reviewActivity?.reviewedAt);
  return `<li class="prs-row prs-row-own prs-row-reviewed">${statusHtml(status)}
    <div class="prs-row-body">${rowTitle(row)}
      ${meta([repoRef(row), authorName(row), reviewed ? `you reviewed ${reviewed} ago` : '', diffStat(row), ...relations(row, near), checksSignal(row)])}</div>
    ${rowLinks(row)}</li>`;
}

const EMPTY_ART = {
  clear: '<path d="M10 19h20v9a9 9 0 0 1-9 9h-2a9 9 0 0 1-9-9z"/><path d="M30 22h2.5a4 4 0 0 1 0 8H29.6"/><path d="M15.5 13c0-3 3-3 3-6M22.5 13c0-3 3-3 3-6"/>',
  watch: '<circle cx="13" cy="28" r="7.5"/><circle cx="31" cy="28" r="7.5"/><path d="M20.5 27h3M6.5 24 10 10.5h5.5l1.2 10.5M37.5 24 34 10.5h-5.5l-1.2 10.5"/>',
  search: '<circle cx="19" cy="19" r="11"/><path d="m27.5 27.5 9 9M14.5 19h9"/>',
};

function emptyHtml(text, hint = '', art = '') {
  const drawing = art
    ? `<svg class="prs-empty-art" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EMPTY_ART[art]}</svg>`
    : '';
  return `<p class="prs-empty">${drawing}<span>${text}${hint ? `<span class="prs-empty-hint">${hint}</span>` : ''}</span></p>`;
}

function statusText() {
  if (loadError) return 'Could not load pull requests. What you see is from the last update. Try Refresh.';
  if (!snapshot || (snapshot.refreshing && !snapshot.fetchedAt)) return 'Loading pull requests…';
  if (snapshot.refreshing) return 'Refreshing…';
  return snapshot.fetchedAt ? updatedText(snapshot.fetchedAt) : 'Not loaded yet. Try Refresh.';
}

function channelName() {
  return `#${esc(snapshot?.slack?.channel || detail?.slackChannel || 'eng-review-requests')}`;
}

function sourcesText() {
  if (!snapshot) return '';
  const days = snapshot.slack?.lookbackDays;
  const scope = snapshot.repoScope ? ` · ${esc(scopeSummaryText(snapshot.repoScope))}` : '';
  if (!slackOn()) return ` · From <span class="prs-source">${GITHUB_MARK_SVG}GitHub</span>${scope}`;
  return ` · From <span class="prs-source">${GITHUB_MARK_SVG}GitHub</span> and <span class="prs-source">${SLACK_MARK_SVG}${channelName()}</span> in Slack${days ? `, last ${plural(days, 'day')}` : ''}${scope}`;
}

function renderStatus() {
  const status = $('prs-status');
  if (!status) return;
  const text = statusText();
  if (status.textContent !== text) status.textContent = text;
  status.dataset.error = String(loadError);
  replaceHtml($('prs-sources'), sourcesText());
  $('prs-refresh')?.setAttribute('aria-disabled', String(!!snapshot?.refreshing));
}

function renderNotices() {
  const notices = [];
  for (const [name, source] of [['GitHub', snapshot?.github], ['Slack', snapshot?.slack]]) {
    if (source && source.ok === false) notices.push(`<strong>${name}:</strong> ${esc(source.error || `${name} could not be read.`)}`);
  }
  for (const notice of snapshot?.notices || []) notices.push(esc(notice));
  replaceHtml($('prs-notices'), notices.map(text => `<li>${icon('warn')}<span>${text}</span></li>`).join(''));
}

// Each tab's mark: its shape, icon and the tone it takes while its list has rows.
const SECTION_MARKS = {
  now: ['burst', 'bolt', 'fail'], stale: ['hexagon', 'active', 'warn'], 'team-reviews': ['shield', 'team', 'gate'], waiting: ['ticket', 'eye', 'active'],
  reviewed: ['blob', 'active', 'neutral'], own: ['squircle', 'pr', 'neutral'],
};
function waitingGroup(id, shape, title, hint, rows) {
  return `<section class="prs-sub" aria-label="${esc(title)}"><h4 id="${id}" tabindex="-1" data-focus-key="group:${id}">${shaped(shape, '', 'prs-sub-mark')}${esc(title)} <span class="prs-count">${rows.length}</span></h4>
    ${hint ? `<p class="prs-hint">${hint}</p>` : ''}<ul class="prs-rows">${rowsHtml(rows, reviewRow)}</ul></section>`;
}

function matchesRunQuery(run) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [run.title, run.project, run.branch, run.runId].filter(Boolean).join('\n').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function renderDashboard() {
  if (!active || mode !== 'dashboard' || shellKind !== 'dashboard') return;
  renderStatus();
  if (!snapshot) return;
  renderNotices();
  const onTab = $('prs-tabs').contains(document.activeElement);
  const loading = snapshot.refreshing && !snapshot.fetchedAt;
  const searching = !!query.trim();
  const team = selectedTeam();
  replaceHtml($('prs-team-pick'), teamPickHtml(team));
  const tab = id => $(`prs-${id}-title`);
  const count = (id, title, total) => {
    const [shape, mark, tone] = SECTION_MARKS[id];
    // An empty list's mark goes quiet.
    tab(id).dataset.tone = total ? tone : 'neutral';
    tab(id).innerHTML = `${shaped(shape, icon(mark), 'prs-section-mark')}${title} <span class="prs-count">${total}</span>`;
  };

  const sections = (snapshot.sections || [])
    .map(section => ({ ...section, items: (section.items || []).filter(matchesQuery) }));
  // A configured prManager.sections without the default ids gives Do next
  // none of your own PRs, so your tab leads the page instead. The server
  // decides this from the config: it sends only sections with rows, so the
  // ids that came back say nothing. The own tab moves to the front and back
  // as the config changes.
  const custom = !!snapshot.customSections;
  if (custom !== (tab('own').nextElementSibling === tab('now'))) {
    if (custom) tab('now').before(tab('own'));
    else tab('reviewed').after(tab('own'));
  }
  const top = id => (custom ? null : sections.find(section => section.id === id))?.items || [];

  // Do next leads with what one click finishes: your PRs that can merge now.
  // Then what blocks you most: your PRs that need a fix or an answer, runs
  // ready to open, reviews an author came back on, approved PRs whose checks
  // still run, then reviews of yours gone quiet.
  const action = top('needs-action');
  const mergeable = row => ownStatus(row).id === 'ready';
  const ready = top('ready').filter(mergeable);
  const approved = top('ready').filter(row => !mergeable(row));
  const chasing = row => !custom && ownStatus(row).id === 'chase';
  const others = sections.filter(section => custom || !TOP_SECTIONS.includes(section.id));
  const chase = others.flatMap(section => section.items.filter(chasing));
  const opening = (snapshot.readyToOpen || []).filter(matchesRunQuery);
  const reviewed = (snapshot.reviewed || []).filter(matchesQuery);
  const rereview = reviewed.filter(row => reviewedStatus(row).tone === 'gate');
  const quiet = reviewed.filter(row => reviewedStatus(row).tone !== 'gate');
  const now = ready.length + action.length + opening.length + rereview.length + approved.length + chase.length;
  count('now', 'Do next', now);
  replaceHtml($('prs-now'), now
    ? `<ul class="prs-rows">${rowsHtml(ready, ownRow)}${rowsHtml(action, ownRow)}${opening.map(readyToOpenRow).join('')}${rowsHtml(rereview, reviewedRow)}${rowsHtml(approved, ownRow)}${rowsHtml(chase, ownRow)}</ul>`
    : loading ? '' : searching ? emptyHtml('Nothing that needs you matches your search.', '', 'search')
      : emptyHtml('Nothing needs you right now.', ' No merges, conflicts, new feedback, runs to open, re-reviews or quiet reviews to chase.', 'clear'));

  const days = snapshot.slack?.lookbackDays;
  const checked = ` Checked ${channelName()}${days ? ` for the last ${plural(days, 'day')}` : ''}`;
  const slack = slackOn();
  const stale = (snapshot.stale || []).filter(matchesQuery);
  count('stale', 'Stale in Slack', stale.length);
  tab('stale').hidden = !slack;
  replaceHtml($('prs-stale'), stale.length
    ? `<p class="prs-hint">Posted in ${channelName()} 4+ days ago with no 👀 or ✅ yet, oldest first. Every team, yours included.</p><ul class="prs-rows">${stale.map(staleRow).join('')}</ul>`
    : loading ? '' : searching ? emptyHtml('No stale Slack posts match your search.', '', 'search')
      : emptyHtml('No stale review posts.', `${checked}: every post from 4+ days ago has a 👀 or ✅.`, 'clear'));

  const teamRows = team ? (snapshot.posted || []).filter(row => tagged(row, team) && matchesQuery(row)) : [];
  tab('team-reviews').hidden = !slack;
  count('team-reviews', team ? `${esc(team)} reviews` : 'Team reviews', teamRows.length);
  replaceHtml($('prs-team-reviews'), teamRows.length
    ? `<p class="prs-hint">Posted in ${channelName()}, oldest first.</p><ul class="prs-rows">${rowsHtml(teamRows, (row, near) => reviewRow(row, near, true))}</ul>`
    : loading ? '' : !team ? emptyHtml('Pick your team to list its review requests here.', '', 'watch')
      : searching ? emptyHtml(`No ${esc(team)} review requests match your search.`, '', 'search')
        : emptyHtml(`No open ${esc(team)} review requests.`, `${checked}.`, 'watch'));

  // A row shows once: a team post stays in the team list, marked when it is
  // also requested from you.
  const inTeam = new Set(teamRows.map(row => row.url));
  const waiting = (snapshot.waiting || []).filter(row => !inTeam.has(row.url) && matchesQuery(row));
  const requested = waiting.filter(row => row.reviewRequestedFromYou);
  const open = waiting.filter(row => !row.reviewRequestedFromYou && tagged(row, 'All'));
  count('waiting', 'Reviews to pick up', requested.length + open.length);
  replaceHtml($('prs-waiting'), requested.length + open.length
    ? (requested.length ? waitingGroup('prs-group-requested', 'bubble', 'Requested from you', '', requested) : '')
      + (open.length ? waitingGroup('prs-group-queue', 'ticket', 'Open to all', `Tagged All in ${channelName()} and not picked up yet, oldest first.`, open) : '')
    : loading ? '' : searching ? emptyHtml('No waiting pull requests match your search.', '', 'search')
      : emptyHtml('Nothing waiting for a reviewer.', slack ? `${checked} and your GitHub review requests.` : ' Checked your GitHub review requests.', 'watch'));

  // The last two wait on other people, so each tab leaves the page while empty.
  count('reviewed', 'Waiting on authors', quiet.length);
  tab('reviewed').hidden = !quiet.length && !searching;
  replaceHtml($('prs-reviewed'), quiet.length ? `<ul class="prs-rows">${rowsHtml(quiet, reviewedRow)}</ul>`
    : searching ? emptyHtml('No reviewed pull requests match your search.', '', 'search') : '');

  const rest = others.map(section => ({ ...section, items: section.items.filter(row => !chasing(row)) })).filter(section => section.items.length);
  const ownCount = rest.reduce((sum, section) => sum + section.items.length, 0);
  count('own', custom ? 'Your pull requests' : 'Your other pull requests', ownCount);
  tab('own').hidden = !ownCount && !searching;
  replaceHtml($('prs-own'), rest.length
    ? rest.map(section => `<section class="prs-sub" aria-label="${esc(section.title)}"><h4${section.id ? ` id="prs-own-${esc(section.id)}" tabindex="-1" data-focus-key="group:own-${esc(section.id)}"` : ''}>${esc(section.title)} <span class="prs-count">${section.items.length}</span></h4>
        <ul class="prs-rows">${rowsHtml(section.items, ownRow)}</ul></section>`).join('')
    : searching ? emptyHtml(`None of your ${custom ? '' : 'other '}pull requests match your search.`, '', 'search') : '');

  showTab(onTab);
}

function schedule() {
  clearTimeout(timer);
  if (!active || mode !== 'dashboard' || document.hidden) return;
  timer = setTimeout(refreshDashboard, snapshot?.refreshing ? REFRESHING_POLL_MS : IDLE_POLL_MS);
}

function mountDashboardShell() {
  const view = $('pr-manager-view');
  const keepHeadingFocus = !document.activeElement || document.activeElement === document.body || view.contains(document.activeElement);
  delete view.dataset.onboarding;
  view.innerHTML = dashboardShell();
  shellKind = 'dashboard';
  $('prs-search').value = query;
  if (keepHeadingFocus) $('pr-manager-title')?.focus();
}

async function refreshDashboard() {
  if (!active || mode !== 'dashboard' || document.hidden || request) return;
  clearTimeout(timer);
  const controller = new AbortController();
  request = controller;
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/prs', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Pull requests request failed');
    const data = await response.json();
    if (request === controller) {
      snapshot = data;
      loadError = false;
      renderPluginSettingsCard();
      if (data.onboardingComplete === false) {
        request = null;
        openOnboarding({ reconfiguring: false });
        return;
      }
      if (shellKind !== 'dashboard') mountDashboardShell();
      renderDashboard();
    }
  } catch {
    if (request === controller) {
      loadError = true;
      if (shellKind !== 'dashboard') mountDashboardShell();
      renderStatus();
    }
  } finally {
    clearTimeout(deadline);
    if (request === controller) {
      request = null;
      schedule();
    }
  }
}

async function startRefresh() {
  const button = $('prs-refresh');
  if (!button || button.getAttribute('aria-disabled') === 'true') return;
  button.setAttribute('aria-disabled', 'true');
  $('prs-status').textContent = 'Refreshing…';
  try {
    const response = await fetch('/api/prs/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Try again.');
  } catch (error) {
    if (!active || mode !== 'dashboard') return;
    $('prs-status').textContent = `Could not start a refresh. ${error.message}`;
    $('prs-status').dataset.error = 'true';
    button.setAttribute('aria-disabled', 'false');
    return;
  }
  if (snapshot) snapshot.refreshing = true;
  request?.abort();
  request = null;
  refreshDashboard();
}

function showDashboard() {
  const view = $('pr-manager-view');
  delete view.dataset.onboarding;
  onboarding = null;
  detail = null;
  mode = 'dashboard';
  if (openOnboardingNext) {
    openOnboardingNext = false;
    openOnboarding({ reconfiguring: snapshot?.onboardingComplete !== false });
    return;
  }
  if (snapshot?.onboardingComplete === false) {
    openOnboarding({ reconfiguring: false });
    return;
  }
  if (snapshot) {
    if (shellKind !== 'dashboard') mountDashboardShell();
    renderDashboard();
  } else if (shellKind !== 'loading') {
    view.innerHTML = loadingShell();
    shellKind = 'loading';
  }
  refreshDashboard();
}

function onboardingShell() {
  return `<div id="prs-onboarding" class="prs-onboard-stage">
    <section class="am-card prs-onboard-card" aria-labelledby="pr-manager-title">
      <p class="am-eyebrow">Pull requests</p>
      <h2 id="pr-manager-title" class="am-q" tabindex="-1">What repositories do you care about?</h2>
      <p class="am-why">Choose the GitHub organizations or repositories whose pull requests and review requests should show here. This overrides machine and project hiding.</p>
      <div class="am-options prs-onboard-all" data-type="multi">
        <label id="prs-onboard-all-row" class="am-opt" for="prs-onboard-all">
          <input id="prs-onboard-all" type="checkbox">
          <span class="am-tick" aria-hidden="true">✓</span>
          <span>
            <strong>All repositories</strong>
            <small>Show pull requests across every organization and repository you can access, including future repositories.</small>
          </span>
        </label>
      </div>
      <div id="prs-onboard-picker" class="prs-onboard-picker">
        <label class="prs-onboard-search">
          ${icon('search')}
          <span class="sr-only">Search organizations and repositories</span>
          <input id="prs-onboard-search" type="search" placeholder="Search organizations or owner/repo (e.g. acme, acme/web)…" autocomplete="off" spellcheck="false">
        </label>
        <div id="prs-onboard-notice" class="prs-onboard-notice"></div>
        <div id="prs-onboard-results" class="prs-onboard-results am-options" data-type="multi"></div>
      </div>
      <section class="prs-onboard-slack" aria-labelledby="prs-onboard-slack-title">
        <h3 id="prs-onboard-slack-title">Slack</h3>
        <orc-switch id="prs-onboard-slack" label="Use Slack" aria-describedby="prs-onboard-slack-hint"></orc-switch>
        <p id="prs-onboard-slack-hint" class="prs-onboard-slack-hint">Reads the channel below for review posts, their reactions and the Stale in Slack list. Off, this page stops reading Slack and hides every Slack part.</p>
        <label id="prs-onboard-channel-row" class="prs-onboard-channel">
          <span>Channel</span>
          <orc-input type="text" id="prs-onboard-channel" placeholder="review-requests" aria-label="Slack channel" aria-describedby="prs-onboard-channel-hint" spellcheck="false" autocomplete="off"></orc-input>
        </label>
        <p id="prs-onboard-channel-hint" class="prs-onboard-slack-hint">Start a line with your team's name and a colon, such as <code>Payments:</code>, before the pull request links in a post. Your team's tab lists the posts tagged with your team.</p>
        <p id="prs-onboard-slack-note" class="prs-onboard-slack-note" hidden>${icon('warn')}<span>${SLACK_SIGN_IN}</span></p>
      </section>
      <p id="prs-onboard-error" class="am-error" role="alert"></p>
      <div class="am-actions">
        <div id="prs-onboard-summary" class="prs-onboard-meta" role="status"></div>
        <div id="prs-onboard-buttons" class="prs-onboard-btns"></div>
      </div>
    </section>
  </div>`;
}

function mergeCatalog(data) {
  for (const org of data?.orgs || []) {
    if (!org?.login) continue;
    const key = org.login.toLowerCase();
    const prev = cachedCatalogOrgs.get(key);
    cachedCatalogOrgs.set(key, {
      login: org.login,
      repoCount: Math.max(Number(org.repoCount) || 0, Number(prev?.repoCount) || 0),
    });
  }
  for (const repo of data?.repos || []) {
    if (typeof repo !== 'string' || !repo.includes('/')) continue;
    cachedCatalogRepos.set(repo.toLowerCase(), repo);
    const owner = repo.split('/', 1)[0];
    if (!cachedCatalogOrgs.has(owner.toLowerCase())) {
      cachedCatalogOrgs.set(owner.toLowerCase(), { login: owner, repoCount: 1 });
    }
  }
}

// Slack channel names: lowercase letters, digits, hyphens, underscores, periods.
const SLACK_CHANNEL_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function onboardingChannel() {
  return (onboarding?.slackChannel || '').trim().replace(/^#/, '').toLowerCase();
}

function onboardingChannelValid() {
  return !onboarding?.useSlack || SLACK_CHANNEL_RE.test(onboardingChannel());
}

function onboardingSelectionValid() {
  return Boolean(onboarding && (onboarding.all || onboarding.orgs.size > 0 || onboarding.repos.size > 0)
    && onboardingChannelValid());
}

function onboardingSummaryHtml() {
  if (!onboarding) return '';
  if (onboarding.all) {
    return '<span>Showing <strong>all current and future repositories</strong></span>';
  }
  const orgs = [...onboarding.orgs.values()];
  const repos = [...onboarding.repos.values()];
  if (!orgs.length && !repos.length) {
    return '<span>None selected yet</span>';
  }
  const parts = [];
  if (orgs.length === 1 && !repos.length) parts.push(`All repositories in <strong>${esc(orgs[0])}</strong>`);
  else {
    if (orgs.length) parts.push(`<strong>${plural(orgs.length, 'organization')}</strong> (${orgs.map(esc).join(', ')})`);
    if (repos.length) parts.push(`<strong>${pluralRepo(repos.length)}</strong>`);
  }
  const clear = onboarding.saving
    ? ''
    : '<button type="button" id="prs-onboard-clear" class="prs-onboard-clear">Clear</button>';
  return `<span>Selected: ${parts.join(' and ')}</span>${clear}`;
}

function onboardingResultsHtml() {
  if (!onboarding) return '';
  const needle = onboarding.search.trim();
  const low = needle.toLowerCase();
  const disabledAll = onboarding.all || onboarding.saving;

  const orgMap = new Map(cachedCatalogOrgs);
  for (const [key, login] of onboarding.orgs) {
    if (!orgMap.has(key)) orgMap.set(key, { login, repoCount: 0 });
  }
  const repoMap = new Map(cachedCatalogRepos);
  for (const [key, repo] of onboarding.repos) {
    if (!repoMap.has(key)) repoMap.set(key, repo);
  }

  let orgs = [...orgMap.values()].filter(item => !low || item.login.toLowerCase().includes(low));
  let repos = [...repoMap.values()].filter(item => !low || item.toLowerCase().includes(low));

  if (needle && GITHUB_REPO_RE.test(needle) && !repoMap.has(low)) {
    repos = [needle, ...repos];
  } else if (needle && GITHUB_LOGIN_RE.test(needle) && !orgs.some(item => item.login.toLowerCase() === low)) {
    orgs = [{ login: needle, repoCount: 0 }, ...orgs];
  }

  if (!orgs.length && !repos.length) {
    if (onboarding.loading) return '<p class="prs-empty" role="status">Loading organizations and repositories from GitHub…</p>';
    return emptyHtml(
      needle ? `No organizations or repositories match “${esc(needle)}”.` : 'No repositories discovered yet.',
      'Type an organization name (like acme) or owner/repo above to select it directly.',
    );
  }

  const orgItems = orgs.map(org => {
    const key = org.login.toLowerCase();
    const checked = onboarding.orgs.has(key);
    const countText = org.repoCount ? ` · ${pluralRepo(org.repoCount)} found` : '';
    return `<label class="am-opt${disabledAll ? ' is-disabled' : ''}" data-focus-key="onboard-org:${esc(key)}">
      <input type="checkbox" name="prs-onboard-org" value="${esc(org.login)}"${checked ? ' checked' : ''}${disabledAll ? ' disabled' : ''}>
      <span class="am-tick" aria-hidden="true">✓</span>
      <span>
        <strong>${esc(org.login)} <span class="prs-onboard-badge">All in ${esc(org.login)}/*</span></strong>
        <small>Show every current and future repository in ${esc(org.login)}${esc(countText)}.</small>
      </span>
    </label>`;
  }).join('');

  const repoItems = repos.map(repo => {
    const key = repo.toLowerCase();
    const owner = repo.split('/', 1)[0];
    const coveredByOrg = onboarding.orgs.has(owner.toLowerCase());
    const checked = coveredByOrg || onboarding.repos.has(key);
    const disabled = disabledAll || coveredByOrg;
    const classes = ['am-opt', disabled ? 'is-disabled' : '', coveredByOrg ? 'is-covered' : ''].filter(Boolean).join(' ');
    const note = coveredByOrg
      ? `Included because all of ${esc(owner)}/* is selected`
      : 'Individual repository';
    return `<label class="${classes}" data-focus-key="onboard-repo:${esc(key)}">
      <input type="checkbox" name="prs-onboard-repo" value="${esc(repo)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
      <span class="am-tick" aria-hidden="true">✓</span>
      <span>
        <strong>${esc(repo)}</strong>
        <small>${note}</small>
      </span>
    </label>`;
  }).join('');

  return `${orgItems ? `<div class="prs-onboard-group" role="group" aria-labelledby="prs-onboard-orgs-head">
      <p id="prs-onboard-orgs-head" class="prs-onboard-group-head">Organizations <span class="prs-count">${orgs.length}</span></p>
      ${orgItems}
    </div>` : ''}
    ${repoItems ? `<div class="prs-onboard-group" role="group" aria-labelledby="prs-onboard-repos-head">
      <p id="prs-onboard-repos-head" class="prs-onboard-group-head">Repositories <span class="prs-count">${repos.length}</span></p>
      ${repoItems}
    </div>` : ''}`;
}

const SLACK_SIGN_IN = 'Slack isn\'t connected in Claude Code, so Slack is hidden on this page. Run /mcp in Claude Code to sign in.';

function renderOnboarding() {
  if (!active || mode !== 'onboarding' || !onboarding) return;
  const allInput = $('prs-onboard-all');
  const allRow = $('prs-onboard-all-row');
  const picker = $('prs-onboard-picker');
  const search = $('prs-onboard-search');
  if (!allInput || !picker || !search) return;

  allInput.checked = onboarding.all;
  allInput.disabled = onboarding.saving;
  allRow.classList.toggle('is-disabled', onboarding.saving);
  picker.dataset.disabled = String(onboarding.all);
  search.disabled = onboarding.all || onboarding.saving;

  const notice = onboarding.repoNotice
    ? `<span>${esc(onboarding.repoNotice)}</span><button type="button" id="prs-onboard-retry-repos" class="settings-btn-inline">Retry</button>`
    : '';
  replaceHtml($('prs-onboard-notice'), notice);
  replaceHtml($('prs-onboard-results'), onboardingResultsHtml());
  $('prs-onboard-error').textContent = onboarding.error || '';
  replaceHtml($('prs-onboard-summary'), onboardingSummaryHtml());
  const slackSwitch = $('prs-onboard-slack');
  slackSwitch.toggleAttribute('checked', onboarding.useSlack);
  slackSwitch.toggleAttribute('disabled', onboarding.saving);
  $('prs-onboard-slack-note').hidden = !(onboarding.useSlack && snapshot?.slack?.connected === false);
  const channel = $('prs-onboard-channel');
  if (channel.value !== onboarding.slackChannel) channel.value = onboarding.slackChannel;
  channel.toggleAttribute('disabled', onboarding.saving);
  $('prs-onboard-channel-row').hidden = !onboarding.useSlack;
  $('prs-onboard-channel-hint').hidden = !onboarding.useSlack;

  const cancelBtn = onboarding.reconfiguring
    ? `<button type="button" id="prs-onboard-cancel" class="am-btn ghost"${onboarding.saving ? ' disabled' : ''}>Cancel</button>`
    : '';
  const saveLabel = onboarding.saving ? 'Saving…' : 'Save';
  const canSave = onboardingSelectionValid() && !onboarding.saving;
  replaceHtml($('prs-onboard-buttons'), `${cancelBtn}<button type="button" id="prs-onboard-save" class="am-btn primary"${canSave ? '' : ' disabled'}>${saveLabel}</button>`);
}

async function loadOnboardingRepos(q = '', { force = false } = {}) {
  if (!active || mode !== 'onboarding' || !onboarding) return;
  repoRequest?.abort();
  const controller = new AbortController();
  repoRequest = controller;
  onboarding.loading = true;
  renderOnboarding();
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (force) params.set('refresh', '1');
  const suffix = params.toString() ? `?${params}` : '';
  try {
    const response = await fetch(`/api/prs/repos${suffix}`, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (repoRequest !== controller || !onboarding) return;
    if (!response.ok) {
      onboarding.repoNotice = data.error || 'Could not load repositories from GitHub.';
    } else {
      mergeCatalog(data);
      onboarding.repoNotice = data.error || '';
    }
  } catch {
    if (repoRequest === controller && onboarding) {
      onboarding.repoNotice = 'Could not reach Orc to list GitHub repositories.';
    }
  } finally {
    if (repoRequest === controller) {
      repoRequest = null;
      if (onboarding) {
        onboarding.loading = false;
        renderOnboarding();
      }
    }
  }
}

function openOnboarding({ reconfiguring = false } = {}) {
  clearTimeout(timer);
  request?.abort();
  request = null;
  clearTimeout(repoSearchTimer);
  repoRequest?.abort();
  repoRequest = null;
  releaseFrames();

  const saved = reconfiguring ? snapshot?.repoScope : null;
  const orgs = new Map();
  const repos = new Map();
  if (saved?.mode === 'selected') {
    for (const org of saved.orgs || []) orgs.set(org.toLowerCase(), org);
    for (const repo of saved.repos || []) repos.set(repo.toLowerCase(), repo);
  }
  onboarding = {
    reconfiguring,
    all: saved?.mode === 'all',
    orgs,
    repos,
    search: '',
    loading: cachedCatalogOrgs.size === 0 && cachedCatalogRepos.size === 0,
    saving: false,
    error: '',
    repoNotice: '',
    useSlack: snapshot?.slack?.enabled !== false,
    slackChannel: snapshot?.slack?.channel || '',
  };
  mode = 'onboarding';
  shellKind = 'onboarding';
  const view = $('pr-manager-view');
  view.dataset.onboarding = 'true';
  view.innerHTML = onboardingShell();
  renderOnboarding();
  $('pr-manager-title')?.focus();
  loadOnboardingRepos('');
}

function cancelOnboarding() {
  if (!onboarding?.reconfiguring || onboarding.saving) return;
  clearTimeout(repoSearchTimer);
  repoRequest?.abort();
  repoRequest = null;
  onboarding = null;
  showDashboard();
  $('prs-settings')?.focus();
}

async function saveOnboarding() {
  if (!onboarding || onboarding.saving || !onboardingSelectionValid()) return;
  onboarding.saving = true;
  onboarding.error = '';
  renderOnboarding();
  const payload = {
    ...(onboarding.all
      ? { mode: 'all', orgs: [], repos: [] }
      : { mode: 'selected', orgs: [...onboarding.orgs.values()], repos: [...onboarding.repos.values()] }),
    useSlack: onboarding.useSlack,
    ...(onboarding.useSlack ? { slackChannel: onboardingChannel() } : {}),
  };
  try {
    const response = await fetch('/api/prs/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not save repository selection.');
    if (!active || mode !== 'onboarding') return;
    snapshot = data;
    loadError = false;
    onboarding = null;
    clearTimeout(repoSearchTimer);
    repoRequest?.abort();
    repoRequest = null;
    renderPluginSettingsCard();
    mode = 'dashboard';
    mountDashboardShell();
    renderDashboard();
    $('pr-manager-title')?.focus();
    announce('Pull request settings saved.');
    schedule();
  } catch (error) {
    if (active && mode === 'onboarding' && onboarding) {
      onboarding.saving = false;
      onboarding.error = error.message || 'Could not save repository selection.';
      renderOnboarding();
    }
  }
}

function themeCss() {
  const probe = document.createElement('span');
  $('pr-manager-view').append(probe);
  const tokens = FRAME_TOKENS.map(token => {
    probe.style.color = `var(${token})`;
    return `${token}: ${getComputedStyle(probe).color};`;
  }).join(' ');
  probe.remove();
  const root = getComputedStyle(document.documentElement);
  const sans = getComputedStyle(document.body).fontFamily;
  const mono = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  return `:root { color-scheme: ${root.colorScheme || 'light dark'}; ${tokens} --mono: ${mono}; }
html, body { margin: 0; background: var(--panel); overflow: hidden; }
body { padding: 0; color: var(--text); font: 14px/1.6 ${sans}; overflow-wrap: anywhere; }
body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }
a { color: var(--accent-text); }
h1, h2, h3, h4, h5, h6 { color: var(--heading); line-height: 1.3; margin: 1.3em 0 .5em; }
h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15px; } h4, h5, h6 { font-size: 14px; }
h1, h2 { padding-bottom: 6px; border-bottom: 1px solid var(--border); }
p, ul, ol, dl, blockquote, pre, table, details { margin: 0 0 12px; }
img, video { max-width: 100%; height: auto; border-radius: 6px; }
code, kbd, samp { font-family: var(--mono); font-size: 12.5px; background: var(--code); border-radius: 4px; padding: 1px 4px; }
pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.6; background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow: auto; }
pre code { background: none; padding: 0; border-radius: 0; }
table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--bg); color: var(--heading); }
blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid var(--border); color: var(--muted-strong); }
hr { border: 0; border-top: 1px solid var(--border); }
summary { cursor: var(--orc-cursor-pointer, pointer); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
ul.contains-task-list { list-style: none; padding-left: 4px; }`;
}

function frameDoc(bodyHtml, css = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DESCRIPTION_CSP}"><base target="_blank"><style>${themeCss()}${css}</style></head><body>${bodyHtml}</body></html>`;
}

// Same-origin without scripts lets this parent measure the document; a
// sandboxed frame cannot report its own height.
function fitFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  const fit = () => { frame.style.height = `${doc.documentElement.scrollHeight}px`; };
  fit();
  frames.get(frame)?.observer?.disconnect();
  const observer = new ResizeObserver(fit);
  observer.observe(doc.body);
  frames.set(frame, { ...frames.get(frame), observer });
  doc.addEventListener('load', fit, true);
}

function mountFrame(host, title, render) {
  const frame = document.createElement('iframe');
  frame.className = 'prs-description';
  frame.title = title;
  frame.setAttribute('sandbox', DESCRIPTION_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.addEventListener('load', () => fitFrame(frame));
  frames.set(frame, { render });
  frame.srcdoc = render();
  host.replaceChildren(frame);
}

function releaseFrames() {
  for (const { observer } of frames.values()) observer?.disconnect();
  frames.clear();
}

function mountDescription(host, bodyHtml) {
  if (!String(bodyHtml || '').trim()) {
    host.innerHTML = emptyHtml('No description.');
    return;
  }
  mountFrame(host, 'Pull request description', () => frameDoc(bodyHtml));
}

const TIMELINE_CSS = `
html, body { background: var(--bg); }
.tl { list-style: none; margin: 0; padding: 0; position: relative; }
.tl::before { content: ""; position: absolute; top: 4px; bottom: 4px; left: 15px; width: 2px; background: var(--border); }
.tl-item { position: relative; margin: 0; padding: 0 0 18px 46px; }
.tl-item:last-child { padding-bottom: 0; }
.tl-avatar { position: absolute; left: 0; top: 0; width: 32px; height: 32px; border-radius: 50%; background: var(--chip); }
.tl-avatar, .mini { display: inline-grid; place-items: center; object-fit: cover; color: var(--muted-strong); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.mini { width: 20px; height: 20px; border-radius: 50%; background: var(--chip); font-size: 10px; flex-shrink: 0; }
.badge { position: absolute; left: 3px; top: 0; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--chip); color: var(--muted-strong); box-shadow: 0 0 0 3px var(--bg); }
[data-tone="ok"] > .badge { background: var(--green); color: var(--panel); }
[data-tone="fail"] > .badge { background: var(--red); color: var(--panel); }
[data-tone="merged"] > .badge { background: var(--purple); color: var(--panel); }
.badge svg { display: block; }
.tl-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-height: 22px; margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted-strong); }
.who { color: var(--heading); font-weight: 600; }
a.when { color: var(--muted-strong); text-decoration: none; white-space: nowrap; }
a.when:hover { color: var(--accent-text); text-decoration: underline; }
.pill { display: inline-block; font-size: 11px; font-weight: 600; line-height: 1.5; border-radius: 999px; padding: 0 7px; border: 1px solid var(--border); color: var(--muted-strong); white-space: nowrap; }
.pill[data-tone="ok"] { color: var(--green-text); border-color: color-mix(in srgb, var(--green) 45%, transparent); }
.pill[data-tone="warn"] { color: var(--yellow-text); border-color: color-mix(in srgb, var(--yellow) 45%, transparent); }
.box { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); overflow: hidden; }
.tl-event > .box, .tl-event > .thread { margin-top: 8px; }
.detail { color: var(--heading); font-weight: 500; }
.box-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 0; padding: 7px 12px; font-size: 13px; color: var(--muted-strong); background: var(--bg); border-bottom: 1px solid var(--border); }
.box-body { padding: 10px 12px; }
.box-body > :first-child { margin-top: 0; }
.box-body > :last-child, .thread-comment > :last-child { margin-bottom: 0; }
.no-body { margin: 0; color: var(--muted-strong); font-style: italic; }
.minimized > summary { color: var(--muted-strong); font-size: 13px; }
.minimized[open] > summary { margin-bottom: 8px; }
.thread { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 0; }
.thread > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 7px 12px; background: var(--bg); font-size: 12.5px; list-style: none; }
.thread > summary::-webkit-details-marker { display: none; }
.thread > summary::before { content: ""; width: 6px; height: 6px; border: solid var(--muted-strong); border-width: 0 1.5px 1.5px 0; transform: rotate(-45deg); margin: 0 2px 0 -1px; transition: transform .12s; }
.thread[open] > summary::before { transform: rotate(45deg); }
.thread[open] > summary { border-bottom: 1px solid var(--border); }
.path { font-family: var(--mono); font-size: 12px; color: var(--heading); }
.line-no, .count { color: var(--muted-strong); }
.count { margin-left: auto; }
.hunk { margin: 0; padding: 6px 0; border: 0; border-radius: 0; border-bottom: 1px solid var(--border); font-size: 12px; line-height: 1.5; }
.hunk code { display: inline-block; min-width: 100%; }
.hunk span { display: block; padding: 0 12px; white-space: pre; }
.hunk .add { background: color-mix(in srgb, var(--green) 16%, transparent); }
.hunk .del { background: color-mix(in srgb, var(--red) 16%, transparent); }
.thread-comments { list-style: none; margin: 0; padding: 0; }
.thread-comment { padding: 10px 12px; }
.thread-comment + .thread-comment { border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.thread-comment > .tl-line { margin-bottom: 6px; }
.thread-foot { margin: 0; padding: 7px 12px; font-size: 12.5px; color: var(--muted-strong); border-top: 1px solid var(--border); background: var(--bg); }
.commits { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; font-size: 13px; }
.commits li { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.commits .headline { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.commits a { font-family: var(--mono); font-size: 12px; color: var(--muted-strong); text-decoration: none; }
.commits a:hover { color: var(--accent-text); text-decoration: underline; }
.tl-gap { padding-top: 2px; }
.tl-gap a { display: inline-block; font-size: 13px; font-weight: 600; padding: 4px 12px; border: 1px dashed var(--border); border-radius: 999px; background: var(--panel); text-decoration: none; }
.tl-gap a:hover { border-color: var(--accent); }
@media (max-width: 520px) {
  .tl::before { left: 11px; }
  .tl-item { padding-left: 34px; }
  .tl-avatar { width: 24px; height: 24px; }
  .badge { left: 1px; }
}`;

function safeUrl(url) {
  return /^https:\/\//i.test(String(url || '')) ? String(url) : '';
}

function safeWebUrl(url) {
  const value = String(url || '').trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : '';
  } catch {
    return '';
  }
}

function avatar(actor, size) {
  const login = actor?.login || 'ghost';
  const cls = size === 'large' ? 'tl-avatar' : 'mini';
  const src = safeUrl(actor?.avatarUrl);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="${cls}" aria-hidden="true">${esc(login[0])}</span>`;
}

function who(actor) {
  const login = actor?.login || 'ghost';
  return `<strong class="who">${esc(login)}</strong>${actor?.bot ? ' <span class="pill">bot</span>' : ''}`;
}

function when(iso, url) {
  const age = shortAge(iso);
  if (!age) return '';
  const time = `<time datetime="${esc(iso)}" title="${esc(new Date(iso).toLocaleString())}">${age} ago</time>`;
  const href = safeUrl(url);
  return href ? `<a class="when" href="${esc(href)}">${time}</a>` : `<span class="when">${time}</span>`;
}

function commentBody(item) {
  const body = String(item.bodyHtml || '').trim() ? item.bodyHtml : '<p class="no-body">No description provided.</p>';
  if (!item.minimized) return body;
  const reason = item.minimized === 'hidden' ? 'hidden' : `marked as ${esc(item.minimized)}`;
  return `<details class="minimized"><summary>This comment was ${reason}.</summary>${body}</details>`;
}

function hunkHtml(hunk) {
  const lines = String(hunk || '').split('\n').filter(line => line.length);
  if (!lines.length) return '';
  const rows = lines.map(line => {
    const kind = line[0] === '+' ? ' class="add"' : line[0] === '-' ? ' class="del"' : '';
    return `<span${kind}>${esc(line)}</span>`;
  }).join('');
  return `<pre class="hunk"><code>${rows}</code></pre>`;
}

function threadHtml(thread) {
  const comments = thread.comments || [];
  const labels = [
    Number.isFinite(thread.line) ? `<span class="line-no">line ${thread.line}</span>` : '',
    thread.outdated ? '<span class="pill" data-tone="warn">Outdated</span>' : '',
    thread.resolved ? '<span class="pill" data-tone="ok">Resolved</span>' : '',
  ].join('');
  const items = comments.map(comment => `<li class="thread-comment">
      <p class="tl-line">${avatar(comment.author)}${who(comment.author)}${when(comment.createdAt, comment.url)}</p>${commentBody(comment)}</li>`).join('');
  const resolvedBy = thread.resolved && thread.resolvedBy
    ? `<p class="thread-foot"><strong class="who">${esc(thread.resolvedBy)}</strong> marked this conversation as resolved.</p>` : '';
  return `<details class="thread"${thread.resolved ? '' : ' open'}>
    <summary><span class="path">${esc(thread.path || 'File')}</span>${labels}<span class="count">${plural(comments.length, 'comment')}</span></summary>
    ${hunkHtml(thread.diffHunk)}<ol class="thread-comments">${items}</ol>${resolvedBy}</details>`;
}

function timelineEntry(tone, mark, line, rest = '') {
  return `<li class="tl-item tl-event" data-tone="${tone}"><span class="badge">${icon(mark)}</span><p class="tl-line">${line}</p>${rest}</li>`;
}

function commitsHtml(item) {
  const commits = item.commits || [];
  const authors = [...new Set(commits.map(commit => commit.author).filter(Boolean))];
  const lead = authors.length ? `<strong class="who">${esc(nameList(authors))}</strong><span>added ${plural(commits.length, 'commit')}</span>` : `<span>${plural(commits.length, 'commit')}</span>`;
  const rows = commits.map(commit => {
    const href = safeUrl(commit.url);
    const sha = esc(commit.shortOid || String(commit.oid || '').slice(0, 7));
    return `<li><span class="headline">${esc(commit.headline || '')}</span>${href ? `<a href="${esc(href)}">${sha}</a>` : `<code>${sha}</code>`}</li>`;
  }).join('');
  return timelineEntry('neutral', 'commit', `${lead}${when(item.createdAt)}`, `<ul class="commits">${rows}</ul>`);
}

function eventHtml(item) {
  const [tone, mark, verb] = TIMELINE_EVENTS[item.event] || ['neutral', 'neutral', 'updated this pull request'];
  const requested = item.event === 'review-requested';
  const detail = requested && item.detail ? reviewerName(item.detail) : item.detail;
  const text = detail ? `${verb} <span class="detail">${esc(detail)}</span>` : requested ? 'requested a review' : verb;
  return timelineEntry(tone, mark, `${avatar(item.actor)}${who(item.actor)}<span>${text}</span>${when(item.createdAt)}`);
}

function reviewHtml(item) {
  const [tone, mark, verb] = TIMELINE_REVIEWS[item.state] || ['neutral', 'reply', 'reviewed'];
  const body = String(item.bodyHtml || '').trim() ? `<div class="box"><div class="box-body">${item.bodyHtml}</div></div>` : '';
  return timelineEntry(tone, mark, `${avatar(item.author)}${who(item.author)}<span>${verb}</span>${when(item.createdAt, item.url)}`,
    body + (item.threads || []).map(threadHtml).join(''));
}

function timelineItemHtml(item, pr) {
  if (item.kind === 'comment') {
    return `<li class="tl-item">${avatar(item.author, 'large')}<article class="box">
      <p class="box-head">${who(item.author)}<span>commented</span>${when(item.createdAt, item.url)}</p>
      <div class="box-body">${commentBody(item)}</div></article></li>`;
  }
  if (item.kind === 'review') return reviewHtml(item);
  if (item.kind === 'thread') {
    const first = item.comments?.[0];
    return timelineEntry('neutral', 'reply', `${avatar(first?.author)}${who(first?.author)}<span>commented on a file</span>${when(item.createdAt, first?.url)}`, threadHtml(item));
  }
  if (item.kind === 'commits') return commitsHtml(item);
  if (item.kind === 'event') return eventHtml(item);
  if (item.kind === 'gap' && item.count > 0) {
    return `<li class="tl-item tl-gap"><a href="${esc(pr.url)}">${plural(item.count, 'more item')} on GitHub</a></li>`;
  }
  return '';
}

function conversationDoc(pr) {
  const items = pr.conversation.map(item => timelineItemHtml(item, pr)).join('');
  return frameDoc(`<ol class="tl">${items}</ol>`, TIMELINE_CSS);
}

function mountConversation(host, pr) {
  if (!Array.isArray(pr.conversation) || !pr.conversation.length) {
    host.innerHTML = emptyHtml('No comments or activity yet.');
    return;
  }
  mountFrame(host, 'Pull request conversation', () => conversationDoc(pr));
}

// Like review_status in pr_manager.py: a comment after an approval or a
// change request does not replace it, and the author's own replies are not reviews.
function latestReviews(pr) {
  const author = String(pr.author || '').toLowerCase();
  const latest = new Map();
  for (const review of [...(pr.reviews || [])].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))) {
    if (!review.author || review.author.toLowerCase() === author) continue;
    if (DECISIVE_REVIEWS.has(review.state) || !DECISIVE_REVIEWS.has(latest.get(review.author)?.state)) latest.set(review.author, review);
  }
  return latest;
}

function reviewersHtml(pr) {
  const latest = latestReviews(pr);
  const rows = [...latest.values()].map(review => {
    const [text, tone] = REVIEW_STATES[review.state] || [String(review.state || 'Reviewed'), 'neutral'];
    const age = shortAge(review.submittedAt);
    return `<li><span class="prs-person">${esc(review.author)}</span> ${pill(esc(text), tone)}${age ? `<span class="prs-when">${age} ago</span>` : ''}</li>`;
  });
  for (const login of pr.requestedReviewers || []) {
    if (!latest.has(login)) rows.push(`<li><span class="prs-person">${esc(reviewerName(login))}</span> ${pill('Requested', 'warn')}</li>`);
  }
  return rows.length ? `<ul class="prs-list">${rows.join('')}</ul>` : emptyHtml('No reviewers yet.');
}

function checkRows(pr) {
  return (pr.checks || []).map(check => {
    const state = String(check.state || '').toUpperCase();
    const [text, tone] = CHECK_STATES[state] || [state ? state[0] + state.slice(1).toLowerCase().replace(/_/g, ' ') : 'Unknown', 'neutral'];
    return { ...check, text, tone };
  }).sort((a, b) => CHECK_ORDER[a.tone] - CHECK_ORDER[b.tone]);
}

function checkItem(check) {
  const href = safeWebUrl(check.url);
  const name = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(check.name)}</a>` : `<span>${esc(check.name)}</span>`;
  return `<li>${pill(esc(check.text), check.tone)} ${name}</li>`;
}

function checksHtml(pr) {
  const checks = checkRows(pr);
  if (!checks.length) return emptyHtml('No checks reported.');
  const passed = checks.filter(check => check.tone === 'ok');
  const rest = checks.filter(check => check.tone !== 'ok');
  if (passed.length <= PASSED_CHECKS_SHOWN || !rest.length) return `<ul class="prs-list">${checks.map(checkItem).join('')}</ul>`;
  return `<ul class="prs-list">${rest.map(checkItem).join('')}</ul>
    <orc-accordion class="prs-more" label="Show ${plural(passed.length, 'passed check')}"><ul class="prs-list">${passed.map(checkItem).join('')}</ul></orc-accordion>`;
}

function checksSummary(pr) {
  const checks = checkRows(pr);
  if (!checks.length) return ['neutral', 'No checks reported'];
  const count = tone => checks.filter(check => check.tone === tone).length;
  const failed = count('fail');
  const running = count('active');
  const passed = count('ok');
  const parts = [failed && `${failed} failing`, count('warn') && `${count('warn')} need action`, running && `${running} running`, passed && `${passed} passed`].filter(Boolean);
  const tone = failed ? 'fail' : count('warn') ? 'warn' : running ? 'active' : passed ? 'ok' : 'neutral';
  if (pr.checkStatus === 'failure' && !failed) return ['fail', ['GitHub reports a failure', ...parts].join(', ')];
  if (tone === 'ok' && passed === checks.length) return ['ok', passed === 1 ? 'Passed' : `All ${passed} passed`];
  return [tone, parts.join(', ') || plural(checks.length, 'check')];
}

function reviewsSummary(pr) {
  const latest = [...latestReviews(pr).values()];
  const by = state => latest.filter(review => review.state === state).map(review => review.author);
  const changes = by('CHANGES_REQUESTED');
  const approved = by('APPROVED');
  const pending = (pr.requestedReviewers || []).filter(login => !latest.some(review => review.author === login)).map(reviewerName);
  if (changes.length) return ['fail', `Changes requested by ${nameList(changes)}`];
  if (approved.length) return ['ok', `Approved by ${nameList(approved)}`];
  if (pending.length) return ['neutral', `Waiting on ${nameList(pending)}`];
  if (by('COMMENTED').length) return ['neutral', `Comments from ${nameList(by('COMMENTED'))}`];
  return ['neutral', 'No reviewers yet'];
}

function mergeSummary(pr) {
  if (pr.state === 'MERGED') return ['merged', 'Merged', 'merged'];
  if (pr.state === 'CLOSED') return ['fail', 'Closed without merging'];
  if (pr.isDraft) return ['neutral', 'Draft, not ready to merge'];
  if (pr.mergeable === 'CONFLICTING') return ['fail', `Conflicts with ${pr.baseRef || 'the base branch'}`, 'conflict'];
  if (pr.mergeable === 'MERGEABLE') return ['ok', `No conflicts with ${pr.baseRef || 'the base branch'}`];
  return ['neutral', 'Not checked by GitHub yet'];
}

function slackSummary(slack) {
  if (!slack) return ['neutral', 'Not posted', ''];
  const posted = shortAge(slack.postedAt);
  const [tone, text, mark] = SLACK_STATES[slack.state] || ['neutral', 'Posted', ''];
  const stateText = slack.state === 'waiting' ? notPickedUp(posted) : text;
  return [slack.state === 'waiting' && elapsedMs(slack.postedAt) >= DAY_MS ? 'warn' : tone, stateText, mark];
}

function headline(pr) {
  if (pr.state === 'MERGED') return { tone: 'merged', text: 'Merged', mark: 'merged' };
  if (pr.state === 'CLOSED') return { tone: 'fail', text: 'Closed without merging' };
  const viewer = pr.viewer?.login;
  if (viewer && pr.author && viewer.toLowerCase() === pr.author.toLowerCase()) return ownStatus(pr);
  if (pr.reviewRequestedFromYou) return { tone: 'gate', text: 'Your review is requested', detail: pr.waitingSince ? `waiting ${shortAge(pr.waitingSince)}` : '' };
  if (pr.waitingSince) {
    const waited = shortAge(pr.waitingSince);
    return { tone: elapsedMs(pr.waitingSince) >= DAY_MS ? 'warn' : 'neutral', text: 'Waiting for a reviewer', detail: waited ? `for ${waited}` : '' };
  }
  return null;
}

function overviewHtml(pr) {
  const [slackTone, slackText, slackMark] = slackSummary(pr.slack);
  const cells = [
    ['Checks', ...checksSummary(pr)],
    ['Reviews', ...reviewsSummary(pr)],
    ['Merge', ...mergeSummary(pr)],
    ...(pr.slackShown === false ? [] : [['Slack', slackTone, slackText, slackMark ? emoji(slackMark) : null]]),
  ].map(([label, tone, text, mark]) => {
    const glyph = typeof mark === 'string' && ICON_PATHS[mark] ? icon(mark) : mark || icon(tone);
    return `<div class="prs-overview-item" data-tone="${tone}"><dt>${label}</dt><dd>${glyph}<span>${esc(text)}</span></dd></div>`;
  }).join('');
  const head = headline(pr);
  const lead = head ? `<p class="prs-headline" data-tone="${head.tone}">${icon(head.mark || head.tone)}<strong>${esc(head.text)}</strong>${head.detail ? `<span>${esc(head.detail)}</span>` : ''}</p>` : '';
  return `<section class="prs-overview" aria-labelledby="prs-overview-title"><h3 id="prs-overview-title" class="sr-only">Status</h3>${lead}<dl>${cells}</dl></section>`;
}

function slackHtml(slack) {
  if (!slack) return emptyHtml('Not posted in Slack.');
  const posted = shortAge(slack.postedAt);
  const reactions = (slack.reactions || []).map(reaction => `${esc(reaction.name)} ×${esc(String(reaction.count))}`).join(', ');
  const [tone, text, mark] = SLACK_STATES[slack.state] || ['neutral', 'Posted', ''];
  return `<dl class="prs-facts">
      <dt>Tag</dt><dd>${esc(slack.tag || 'None')}</dd>
      <dt>Posted by</dt><dd>${esc(slack.postedBy || 'Unknown')}${posted ? `, ${posted} ago` : ''}</dd>
      <dt>Reactions</dt><dd>${reactions || 'None'}</dd>
      <dt>State</dt><dd>${signal(tone, esc(slackBy(slack) ? `${text} ${slackBy(slack)}` : text), emoji(mark))}</dd></dl>
    ${slack.permalink ? `<p><a class="prs-external" href="${esc(slack.permalink)}" target="_blank" rel="noopener noreferrer">Open in Slack</a></p>` : ''}`;
}

function detailMetaHtml(pr) {
  const opened = shortAge(pr.createdAt);
  const facts = [
    pr.author ? `by <span class="prs-person">${esc(pr.author)}</span>` : '',
    pr.headRef ? `<code>${esc(pr.headRef)}</code> → <code>${esc(pr.baseRef || '')}</code>` : '',
    diffStat(pr),
    Number.isFinite(pr.changedFiles) ? plural(pr.changedFiles, 'file') : '',
    Number.isFinite(pr.commits) ? plural(pr.commits, 'commit') : '',
    opened ? `opened ${opened} ago` : '',
  ].filter(Boolean).join(' · ');
  return `<p class="prs-detail-facts">${facts}</p>`;
}

function detailRefHtml(pr) {
  const state = pr.isDraft && pr.state === 'OPEN' ? pill('Draft', 'neutral') : pill(...(STATE_LABELS[pr.state] || ['Open', 'ok']));
  const labels = (pr.labels || []).map(label => `<span class="prs-label">${esc(label.name)}</span>`).join('');
  return `<span class="prs-ref">${esc(prRef(pr))}</span>${state}${ticketChip(pr.ticket)}${labels}`;
}

const MERGE_LABELS = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

function mergeHtml(pr) {
  if (pr.state !== 'OPEN' || !pr.merge) return '';
  const { available, reason, method } = pr.merge;
  return `<button type="button" id="prs-merge" class="settings-btn-inline prs-link-btn" aria-describedby="prs-merge-note"${available ? '' : ' disabled'}>${esc(MERGE_LABELS[method] || 'Merge')}</button>
      <p id="prs-merge-note" class="prs-review-note" role="status">${available ? '' : esc(reason || '')}</p>`;
}

// A PR that conflicts with its base leads with the one thing to do about it,
// when Orc has a project to start the run in. Once that run is going the same
// button opens it, so a second click never starts a second run.
function conflictHtml(pr, review) {
  if (pr.state !== 'OPEN' || pr.mergeable !== 'CONFLICTING' || !review.available) return '';
  if (pr.conflictRun) return `<a id="prs-conflict" class="prs-primary" href="#${esc(encodeURIComponent(pr.conflictRun))}">Open conflict run</a>`;
  return `<button type="button" id="prs-conflict" class="prs-primary" aria-describedby="prs-conflict-note">Resolve the conflict</button>`;
}

function renderDetail() {
  const pr = detail;
  releaseFrames();
  $('pr-manager-title').textContent = pr.title || prRef(pr);
  $('prs-detail-ref').innerHTML = detailRefHtml(pr);
  $('prs-detail-meta').innerHTML = detailMetaHtml(pr);
  const review = pr.review || { available: false, reason: 'Review locally is not available for this pull request.' };
  const run = pr.orcRun?.runId
    ? `<a class="settings-btn-inline prs-link-btn" href="#${esc(encodeURIComponent(pr.orcRun.runId))}">Open Orc run</a>` : '';
  const conflict = conflictHtml(pr, review);
  // Only one button on the page takes the filled style.
  const reviewClass = conflict ? 'settings-btn-inline prs-link-btn' : 'prs-primary';
  $('prs-detail-body').innerHTML = `<div class="prs-actions">${conflict}
      ${review.available
    ? `<a id="prs-review" class="${reviewClass}" href="${esc(reviewHash(pr))}">Review in Orc</a>`
    : '<button type="button" id="prs-review" class="prs-primary" aria-describedby="prs-review-note" disabled>Review in Orc</button>'}
      <a class="settings-btn-inline prs-link-btn" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>${run}
      ${conflict && !pr.conflictRun ? '<p id="prs-conflict-note" class="prs-review-note" role="status"></p>' : ''}
      <p id="prs-review-note" class="prs-review-note" role="status">${review.available ? '' : esc(review.reason || '')}</p>
      ${mergeHtml(pr)}</div>
    ${overviewHtml(pr)}
    <div class="prs-detail-grid">
      <div class="prs-main">
        <section class="prs-panel prs-panel-description" aria-labelledby="prs-description-title"><h3 id="prs-description-title">Description</h3><div id="prs-description"></div></section>
        <section class="prs-conversation" aria-labelledby="prs-conversation-title"><h3 id="prs-conversation-title">Conversation</h3><div id="prs-conversation"></div></section>
      </div>
      <div class="prs-aside">
        <section class="prs-panel" aria-labelledby="prs-reviewers-title"><h3 id="prs-reviewers-title">Reviewers</h3>${reviewersHtml(pr)}</section>
        <section class="prs-panel" aria-labelledby="prs-checks-title"><h3 id="prs-checks-title">Checks</h3>${checksHtml(pr)}</section>
        ${pr.slackShown === false ? '' : `<section class="prs-panel" aria-labelledby="prs-slack-title"><h3 id="prs-slack-title">Slack post</h3>${slackHtml(pr.slack)}</section>`}
      </div></div>`;
  mountDescription($('prs-description'), pr.bodyHtml);
  mountConversation($('prs-conversation'), pr);
}

function renderDetailError(message, retry) {
  $('prs-detail-meta').innerHTML = '';
  $('prs-detail-body').innerHTML = `<p class="prs-error" role="alert">${esc(message)}</p>${retry ? '<button type="button" id="prs-retry" class="settings-btn-inline">Retry</button>' : ''}`;
}

function parseDetailPath(segments) {
  const [owner, repo, number, ...extra] = segments.map(part => {
    try { return decodeURIComponent(part); } catch { return ''; }
  });
  const review = extra.length === 1 && extra[0] === 'review';
  if (!owner || !repo || !/^\d+$/.test(number || '') || (extra.length && !review)) return null;
  return { owner, repo, number, review, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

async function loadDetail() {
  const target = parseDetailPath(detailPath.split('/').slice(1));
  if (!target) return renderDetailError('Pull request not found.', false);
  $('prs-detail-body').innerHTML = '<p class="prs-note" role="status">Loading pull request…</p>';
  const controller = new AbortController();
  request = controller;
  try {
    const response = await fetch(`/api/prs/pr?url=${encodeURIComponent(target.url)}`, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (request !== controller) return;
    if (response.status === 404) return renderDetailError('Pull request not found.', false);
    if (!response.ok) return renderDetailError(data.error || 'Could not load the pull request.', true);
    detail = { url: target.url, repo: `${target.owner}/${target.repo}`, number: Number(target.number), ...data };
    if (target.review) renderReviewSetup();
    else renderDetail();
  } catch {
    if (request === controller) renderDetailError('Could not reach Orc to load the pull request.', true);
  } finally {
    if (request === controller) request = null;
  }
}

function showDetail(path) {
  mode = 'detail';
  shellKind = 'detail';
  onboarding = null;
  detailPath = path;
  detail = null;
  reviewSetup = null;
  releaseFrames();
  const view = $('pr-manager-view');
  delete view.dataset.onboarding;
  const target = parseDetailPath(path.split('/').slice(1));
  const ref = target ? `${target.owner}/${target.repo}#${target.number}` : 'Pull request';
  view.innerHTML = `<div class="prs-wrap prs-detail"><a class="prs-back" href="#prs"><span aria-hidden="true">←</span> Pull requests</a>
    <header class="prs-detail-head"><p id="prs-detail-ref" class="prs-detail-ref"><span class="prs-ref">${esc(ref)}</span></p><h2 id="pr-manager-title" tabindex="-1">${esc(ref)}</h2><div id="prs-detail-meta"></div></header>
    <div id="prs-detail-body"></div></div>`;
  loadDetail();
}

const STEP_ORDER = ['eyes', 'reviewer', 'start'];
// With Slack off or not connected there is no post to put your eyes on.
const stepOrder = pr => STEP_ORDER.filter(id => id !== 'eyes' || pr?.slackShown !== false);
const STEP_TEXT = {
  eyes: { mark: '👀', title: 'Put your eyes on the Slack post', approve: 'Approve', working: 'Adding your reaction in Slack…', done: 'Your eyes are on the post.' },
  reviewer: { mark: icon('gate'), title: 'Assign yourself as a reviewer on GitHub', approve: 'Approve', working: 'Asking GitHub…', done: 'You are a reviewer on GitHub.' },
  start: { mark: icon('search'), title: 'Start the review and QA', approve: 'Start review', working: 'Preparing a review checkout…', done: '' },
};

// What Start review sets going, in the order it happens: the app is what you
// need soonest, so it comes before the review and the QA steps.
const START_ORDER = `<ol class="prs-step-order" aria-label="What starts, in order">${
  ['App running', 'Code review', 'QA steps'].map((label, index) => `<li><span><i aria-hidden="true">${index + 1}</i>${label}</span></li>`).join('')}</ol>`;

// `off` is a step this pull request has no use for; it says why and asks nothing.
function reviewSteps(pr) {
  const viewer = String(pr.viewer?.login || '').toLowerCase();
  const own = !!viewer && String(pr.author || '').toLowerCase() === viewer;
  const asked = !!viewer && (pr.requestedReviewers || []).some(login => login.toLowerCase() === viewer);
  return {
    eyes: pr.slack ? { state: 'open' } : { state: 'off', note: `Not posted in ${channelName()}, so there is no post to react to.` },
    reviewer: own ? { state: 'off', note: 'This is your own pull request.' }
      : asked ? { state: 'done', note: 'You are already a requested reviewer.' } : { state: 'open' },
    start: pr.review?.available ? { state: 'open' } : { state: 'off', note: pr.review?.reason || 'Review locally is not available for this pull request.' },
  };
}

function stepDetail(id, pr) {
  if (id === 'eyes') {
    const post = pr.slack?.permalink
      ? ` <a href="${esc(pr.slack.permalink)}" target="_blank" rel="noopener noreferrer">Open the post</a>` : '';
    const taken = pr.slack?.state === 'picked-up' ? ' Someone else is already looking.' : '';
    return `Shows ${channelName()} that you have picked this up.${taken}${post}`;
  }
  if (id === 'reviewer') return 'Adds you to the reviewers on the pull request.';
  return 'Starts the pull request\'s app first, so you can test straight away. Then a child run reviews the code and Orc writes your QA steps.';
}

function stepHtml(id) {
  const step = reviewSetup.steps[id];
  const text = STEP_TEXT[id];
  const note = step.error || step.note || (step.state === 'working' ? text.working : step.state === 'done' ? text.done : step.state === 'dismissed' ? 'Skipped.' : '');
  const busy = step.state === 'working';
  const actions = step.state === 'open' || busy
    ? `<button type="button" class="prs-primary" data-step-act="approve"${busy ? ' aria-disabled="true"' : ''}>${text.approve}<span class="sr-only">: ${esc(text.title)}</span></button>
       <button type="button" class="settings-btn-inline" data-step-act="dismiss"${busy ? ' aria-disabled="true"' : ''}>Dismiss<span class="sr-only">: ${esc(text.title)}</span></button>`
    : step.state === 'dismissed'
      ? `<button type="button" class="settings-btn-inline" data-step-act="undo">Undo<span class="sr-only"> skipping: ${esc(text.title)}</span></button>` : '';
  const picker = id === 'start' && (step.state === 'open' || busy)
    ? `<div class="prs-step-model"><orc-model-picker id="prs-review-model"></orc-model-picker>${START_ORDER}<orc-effort-slider id="prs-review-effort"></orc-effort-slider></div>` : '';
  return `<span class="prs-step-mark" aria-hidden="true">${step.state === 'done' ? icon('ok') : text.mark}</span>
    <div class="prs-step-body"><p class="prs-step-title">${esc(text.title)}</p>
      ${step.state === 'open' || busy ? `<p class="prs-step-detail">${stepDetail(id, reviewSetup.pr)}</p>` : ''}
      <p class="prs-step-note" role="status" data-error="${step.error ? 'true' : 'false'}">${esc(note)}</p></div>
    <div class="prs-step-actions">${actions}</div>${picker}`;
}

function paintReviewModel() {
  const picker = $('prs-review-model');
  if (!picker || !reviewSetup) return;
  const state = reviewSetup.selection.snapshot();
  picker.selection = state;
  $('prs-review-effort').selection = state;
  $('prs-review-effort').hidden = !state.takesEffort;
}

function renderStep(id) {
  const item = document.querySelector(`#prs-steps [data-step="${id}"]`);
  if (!item || !reviewSetup) return;
  item.dataset.state = reviewSetup.steps[id].state;
  item.innerHTML = stepHtml(id);
  if (id === 'start') paintReviewModel();
}

// The picks stay on this page: what the composer remembers as your usual
// model is not changed by reviewing one PR with another.
function reviewSelection() {
  const kept = new Map();
  const selection = createLaunchSelection({ storage: { getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) } });
  selection.restore(REVIEW_DEFAULT);
  return selection;
}

function renderReviewSetup() {
  const pr = detail;
  reviewSetup = { pr, steps: reviewSteps(pr), selection: reviewSetup?.pr?.url === pr.url ? reviewSetup.selection : reviewSelection() };
  $('pr-manager-title').textContent = `Review: ${pr.title || prRef(pr)}`;
  $('prs-detail-ref').innerHTML = detailRefHtml(pr);
  $('prs-detail-meta').innerHTML = `<p class="prs-detail-facts">${[esc(pr.author || 'unknown'), diffStat(pr), `<a href="${esc(prHash(pr))}">Read the pull request</a>`,
    `<a href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>`].filter(Boolean).join(' · ')}</p>`;
  $('prs-detail-body').innerHTML = `<p class="prs-steps-intro">Approve or dismiss each step. Nothing is sent until you approve it.</p>
    <ol id="prs-steps" class="prs-steps">${stepOrder(pr).map(id => `<li class="prs-step" data-step="${id}"></li>`).join('')}</ol>`;
  stepOrder(pr).forEach(renderStep);
}

function focusStep(after) {
  const order = stepOrder(reviewSetup?.pr);
  const next = [...order.slice(order.indexOf(after) + 1), ...order]
    .map(id => document.querySelector(`#prs-steps [data-step="${id}"] [data-step-act]`)).find(Boolean);
  (next || $('pr-manager-title'))?.focus({ preventScroll: true });
}

async function approveStep(id) {
  const setup = reviewSetup;
  const step = setup.steps[id];
  const settle = (state, error = '') => {
    Object.assign(step, { state, error });
    if (active && reviewSetup === setup) renderStep(id);
  };
  settle('working');
  try {
    const { agent, model, effort } = setup.selection.value;
    const body = id === 'start' ? { url: setup.pr.url, agent, model, effort } : { url: setup.pr.url };
    const response = await fetch({ eyes: '/api/prs/eyes', reviewer: '/api/prs/reviewer', start: '/api/prs/review' }[id], {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || (id === 'start' && !result.runId)) throw new Error(result.error || 'That did not work. Try again.');
    if (id === 'start') {
      if (active && reviewSetup === setup) location.hash = result.runId;
      return;
    }
    settle('done');
    if (active && reviewSetup === setup) focusStep(id);
  } catch (error) {
    settle('open', error.message);
    if (active && reviewSetup === setup) document.querySelector(`#prs-steps [data-step="${id}"] [data-step-act="approve"]`)?.focus({ preventScroll: true });
  }
}

function stepAction(button) {
  const id = button.closest('[data-step]')?.dataset.step;
  const step = reviewSetup?.steps[id];
  if (!step || button.getAttribute('aria-disabled') === 'true') return;
  const act = button.dataset.stepAct;
  if (act === 'approve' && step.state === 'open') approveStep(id);
  else if ((act === 'dismiss' && step.state === 'open') || (act === 'undo' && step.state === 'dismissed')) {
    Object.assign(step, { state: act === 'undo' ? 'open' : 'dismissed', error: '' });
    renderStep(id);
    if (act === 'undo') document.querySelector(`#prs-steps [data-step="${id}"] [data-step-act="approve"]`)?.focus({ preventScroll: true });
    else focusStep(id);
  }
}

async function startMerge(button) {
  if (mergePending || button.disabled || !detail?.merge) return;
  const pr = detail;
  const label = MERGE_LABELS[pr.merge.method] || 'Merge';
  if (!window.confirm(`${label} ${prRef(pr)} into ${pr.baseRef || 'its base branch'} on GitHub?`)) return;
  const path = detailPath;
  const note = $('prs-merge-note');
  mergePending = true;
  button.setAttribute('aria-disabled', 'true');
  note.dataset.error = 'false';
  note.textContent = 'Merging on GitHub…';
  try {
    const response = await fetch('/api/prs/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pr.url, headOid: pr.merge.headOid }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not merge the pull request. Try again.');
    if (active && detailPath === path) loadDetail();
  } catch (error) {
    if (active && detailPath === path && note.isConnected) {
      note.textContent = error.message;
      note.dataset.error = 'true';
    }
  } finally {
    mergePending = false;
    button.removeAttribute('aria-disabled');
  }
}

// Starts the conflict run on the composer's own agent and model, then opens it.
async function startConflictRun(button) {
  if (conflictPending || !detail) return;
  const pr = detail;
  const path = detailPath;
  const note = $('prs-conflict-note');
  conflictPending = true;
  button.setAttribute('aria-disabled', 'true');
  note.dataset.error = 'false';
  note.textContent = 'Starting the conflict run…';
  try {
    const selection = createLaunchSelection();
    selection.open();
    const { agent, model, effort } = selection.value;
    const response = await fetch('/api/prs/resolve-conflict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pr.url, agent, model, effort }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.runId) throw new Error(result.error || 'Could not start the conflict run. Try again.');
    if (active && detailPath === path) location.hash = result.runId;
  } catch (error) {
    if (active && detailPath === path && note.isConnected) {
      note.textContent = error.message;
      note.dataset.error = 'true';
    }
  } finally {
    conflictPending = false;
    button.removeAttribute('aria-disabled');
  }
}

function wireView(view) {
  if (wired) return;
  wired = true;
  // error does not bubble, so it is caught on its way down.
  view.addEventListener('error', event => {
    if (event.target.matches?.('.prs-logo img')) logoFailed(event.target);
  }, true);
  view.addEventListener('input', event => {
    if (event.target.id === 'prs-search') {
      query = event.target.value;
      renderDashboard();
      return;
    }
    if (event.target.id === 'prs-onboard-channel' && onboarding) {
      onboarding.slackChannel = event.target.value;
      renderOnboarding();
      return;
    }
    if (event.target.id === 'prs-onboard-search' && onboarding) {
      onboarding.search = event.target.value;
      renderOnboarding();
      clearTimeout(repoSearchTimer);
      const trimmed = onboarding.search.trim();
      if (trimmed.length >= 2) {
        repoSearchTimer = setTimeout(() => loadOnboardingRepos(trimmed), REPO_SEARCH_DEBOUNCE_MS);
      }
    }
  });
  view.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'prs-review-model' && reviewSetup) {
      const { agent, model } = target.choice;
      reviewSetup.selection.choose({ agent });
      if (model) reviewSetup.selection.choose({ model });
      paintReviewModel();
      return;
    }
    if (target.id === 'prs-review-effort' && reviewSetup) {
      reviewSetup.selection.choose({ effort: target.value });
      paintReviewModel();
      return;
    }
    if (target.id === 'prs-team') {
      writeStore(TEAM_KEY, target.value);
      renderDashboard();
      return;
    }
    if (!onboarding) return;
    if (target.id === 'prs-onboard-slack') {
      onboarding.useSlack = !!event.detail?.checked;
      renderOnboarding();
      return;
    }
    if (target.id === 'prs-onboard-all') {
      onboarding.all = target.checked;
      onboarding.error = '';
      renderOnboarding();
      return;
    }
    if (target.name === 'prs-onboard-org') {
      const login = target.value;
      const key = login.toLowerCase();
      if (target.checked) {
        onboarding.orgs.set(key, login);
        for (const repoKey of [...onboarding.repos.keys()]) {
          if (repoKey.split('/', 1)[0] === key) onboarding.repos.delete(repoKey);
        }
      } else {
        onboarding.orgs.delete(key);
      }
      onboarding.error = '';
      renderOnboarding();
      return;
    }
    if (target.name === 'prs-onboard-repo') {
      const repo = target.value;
      const key = repo.toLowerCase();
      if (target.checked) onboarding.repos.set(key, repo);
      else onboarding.repos.delete(key);
      onboarding.error = '';
      renderOnboarding();
    }
  });
  view.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'prs-refresh') startRefresh();
    else if (button.id === 'prs-settings') openOnboarding({ reconfiguring: true });
    else if (button.id === 'prs-onboard-save') saveOnboarding();
    else if (button.id === 'prs-onboard-cancel') cancelOnboarding();
    else if (button.id === 'prs-onboard-clear' && onboarding) {
      onboarding.all = false;
      onboarding.orgs.clear();
      onboarding.repos.clear();
      onboarding.error = '';
      renderOnboarding();
    } else if (button.id === 'prs-onboard-retry-repos' && onboarding) {
      loadOnboardingRepos(onboarding.search, { force: true });
    } else if (button.id === 'prs-retry') loadDetail();
    else if (button.dataset.stepAct) stepAction(button);
    else if (button.id === 'prs-merge') startMerge(button);
    else if (button.id === 'prs-conflict') startConflictRun(button);
    else if (button.dataset.cancelRun) cancelReadyRun(button.dataset.cancelRun);
    else if (button.dataset.tab) pickTab(button);
  });
  // Arrows, Home and End move between the tabs that are showing and open the one they reach.
  view.addEventListener('keydown', event => {
    if (event.target.getAttribute?.('role') !== 'tab') return;
    const tabs = visibleTabs();
    const at = tabs.indexOf(event.target);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    pickTab(tabs[(next + tabs.length) % tabs.length]);
  });
}

function renderPluginSettingsCard() {
  if (!settingsSlot || !settingsSlot.isConnected) return;
  const slack = snapshot?.slack;
  const slackText = slack?.enabled === false ? 'Off' : slack?.connected === false ? SLACK_SIGN_IN : 'On';
  settingsSlot.innerHTML = `<div class="prs-plugin-settings">
    <p><strong>Repositories:</strong> ${esc(scopeSummaryText(snapshot?.repoScope))}<br><strong>Slack:</strong> ${esc(slackText)}</p>
    <button type="button" class="settings-btn-inline" data-prs-configure>Configure</button>
  </div>`;
  settingsSlot.querySelector('[data-prs-configure]')?.addEventListener('click', () => {
    openOnboardingNext = true;
    location.hash = 'prs';
  });
}

export function showPrManager(hash = '#prs') {
  const path = String(hash || 'prs').replace(/^#/, '') || 'prs';
  window.orcCloseContentFind?.();
  document.querySelectorAll('.run').forEach(el => el.classList.remove('active'));
  for (const id of SIBLING_VIEWS) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  const view = $('pr-manager-view');
  if (!view) return;
  wireView(view);
  view.hidden = false;
  active = true;
  clearTimeout(timer);
  request?.abort();
  request = null;
  if (path.includes('/')) showDetail(path);
  else showDashboard();
  $('pr-manager-title')?.focus();
}

export function hidePrManager() {
  active = false;
  clearTimeout(timer);
  clearTimeout(repoSearchTimer);
  request?.abort();
  request = null;
  repoRequest?.abort();
  repoRequest = null;
  releaseFrames();
  const view = $('pr-manager-view');
  if (view) view.hidden = true;
}

const isPrHash = hash => hash === '#prs' || hash.startsWith('#prs/');

export async function activate({ signal, base, commands, settings, view: registerView }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'pr-manager.css';
  style.dataset.prManagerStyle = '';
  await new Promise(resolve => {
    style.addEventListener('load', resolve, { once: true });
    style.addEventListener('error', resolve, { once: true });
    signal.addEventListener('abort', resolve, { once: true });
    document.head.append(style);
  });
  if (signal.aborted) {
    style.remove();
    return () => {};
  }

  const section = document.createElement('section');
  section.id = 'pr-manager-view';
  section.setAttribute('aria-labelledby', 'pr-manager-title');
  section.hidden = true;
  if ($('servers-view')) $('servers-view').after(section);
  else $('settings-view').before(section);

  const button = document.createElement('orc-icon-button');
  button.id = 'prs-btn';
  button.setAttribute('href', '#prs');
  button.setAttribute('label', 'Pull requests');
  button.setAttribute('size', 'compact');
  button.innerHTML = SIDEBAR_PR_ICON;
  if ($('servers-btn')) $('servers-btn').after(button);
  else $('sidebar-footer')?.append(button);

  commands(() => [{
    label: 'Open pull requests',
    sub: 'Your open PRs and team review requests from GitHub and Slack',
    action: () => { location.hash = 'prs'; },
  }]);

  settings(slot => {
    settingsSlot = slot;
    renderPluginSettingsCard();
    if (!snapshot) {
      fetch('/api/prs', { signal, cache: 'no-store' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && !snapshot) {
            snapshot = data;
            renderPluginSettingsCard();
          }
        })
        .catch(() => {});
    }
  });

  registerView({ hash: 'prs', subroutes: true, show: showPrManager, hide: hidePrManager });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active && mode === 'onboarding' && onboarding?.reconfiguring && !onboarding.saving) {
      event.preventDefault();
      cancelOnboarding();
    }
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (active && mode === 'dashboard' && !document.hidden) refreshDashboard();
  }, { signal });
  window.addEventListener('pagehide', hidePrManager, { signal });
  window.addEventListener('pageshow', event => {
    if (event.persisted && isPrHash(location.hash)) showPrManager(location.hash);
  }, { signal });
  const themeObserver = new MutationObserver(() => {
    if (!active || mode !== 'detail') return;
    for (const [frame, { render }] of frames) if (frame.isConnected) frame.srcdoc = render();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return () => {
    hidePrManager();
    themeObserver.disconnect();
    section.remove();
    button.remove();
    style.remove();
    wired = false;
    mode = null;
    shellKind = null;
    snapshot = null;
    loadError = false;
    detailPath = null;
    detail = null;
    reviewSetup = null;
    onboarding = null;
    openOnboardingNext = false;
    settingsSlot = null;
    cachedCatalogOrgs.clear();
    cachedCatalogRepos.clear();
    if (isPrHash(location.hash)) location.hash = 'new';
  };
}
