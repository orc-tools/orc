// Opening a run's QA window (ui/qa.html at /qa/<run-id>): its own window in
// Orc.app, which gives it a browser beside the steps, and a popup anywhere
// else.
import { pluginEnabled } from './harnesses.js';
import { isDone, isFinalReady, isOrchestrationWorker, isQaRun } from './run-presentation.js';

const PULL_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
const isPullRequestReview = meta => meta?.route === 'local-review' && PULL_URL.test(meta?.review?.prUrl || '');

const QA_PATH = /^\/qa\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

const hasReachedShip = meta => !!meta && !isOrchestrationWorker(meta) && meta.status !== 'cancelled' && (
  isFinalReady(meta)
  || isDone(meta)
  || meta.status === 'merging'
  || meta.status === 'merging-to-parent'
);

// A QA run, and the review of a pull request, always have the window: the
// review writes its steps while it reviews. Any other run has it once it has
// reached its Ship gate (or delivered past it) and has steps to walk: the
// ones its agent published, or its PR body's QA section. While a run is
// still building or working before Ship, pr-body.md may already be on disk
// before the change is ready to QA. Only the host has it: the window runs
// the steps' commands and browser on the host, which a paired phone or
// browser cannot watch or drive.
export function qaAvailable(run) {
  if (window.ORC_INSTANCE?.remote) return false;
  const meta = run?.meta;
  if (isQaRun(meta) || isPullRequestReview(meta)) return true;
  if (!hasReachedShip(meta)) return false;
  return (run?.files || []).some(file => file?.path === 'qa/steps.json' || file?.path === 'pr-body.md');
}

// A run that only answered about a PR (sourcePrUrl) has no checkout or app to
// walk steps against, so its QA is Review in Orc on that PR: the QA window of
// the review already under way, else the Pull requests view that starts one.
export function pullRequestQa(run, allRuns = []) {
  if (window.ORC_INSTANCE?.remote) return null;
  const pr = PULL_URL.exec(run?.meta?.sourcePrUrl || '');
  if (!pr) return null;
  const key = match => `${match[1]}/${match[2]}#${match[3]}`.toLowerCase();
  const review = allRuns.find(other => other?.id !== run.id && isPullRequestReview(other.meta)
    && other.meta.status !== 'cancelled' && key(PULL_URL.exec(other.meta.review.prUrl)) === key(pr));
  if (review) {
    return { href: `/qa/${encodeURIComponent(review.id)}`, title: 'Walk through the QA steps of this PR’s review in Orc' };
  }
  if (!pluginEnabled('pull-requests')) return null;
  return { href: `#prs/${[pr[1], pr[2], pr[3]].map(encodeURIComponent).join('/')}/review`,
    title: 'Review this PR in Orc: check it out, start its app and walk its QA steps' };
}

export function openQaWindow(runId) {
  const bridge = window.webkit?.messageHandlers?.orcQa;
  if (bridge) {
    bridge.postMessage({ action: 'open', runId });
    return;
  }
  window.open(`/qa/${encodeURIComponent(runId)}`, `orc-qa-${runId}`, 'popup,width=1440,height=900');
}

// Every link to a QA window opens that window, wherever the link is: the run
// header's QA button, or the "Open QA" link a QA run's agent ends its reply
// with. Following it in place would swap Orc itself for the QA page.
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return;
  }
  const match = url.origin === location.origin && QA_PATH.exec(url.pathname);
  if (!match) return;
  event.preventDefault();
  openQaWindow(decodeURIComponent(match[1]));
}, true);
