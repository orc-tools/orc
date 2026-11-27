// The checks a run's agent ran on its own work, reported with `orc-check`
// (ui/run_checks.py). The Pull request panel lists them under
// Self-verification, at every stage of the run. Chat shows a card above the
// chat box only once the run reaches Ship (and after delivery), never during
// Build, Verify, or a Ship hold while the agent may still solve the failure
// itself, and only for a check that failed and that no other run is fixing,
// since that card holds Fix it. A check running, passed, skipped, left
// unfinished or being fixed elsewhere leaves no card at Ship, during a merge,
// or after delivery. They are the agent's own report: Orc reruns nothing and
// no check holds Ship.
// A failure the agent saw on main too reads amber, as one this run did not
// cause. On an open run that takes chat messages, Fix it asks this run's agent
// to fix its own red failures (with a secondary link to start a new run); an
// on-main failure or a finished run starts a separate run instead. A failure
// fixed in a separate run spins in the panel while that run works on it and
// turns into a tick once it merges.
import { CARD_CHEVRON, animateCardFold, cardPreference, flipCardPreference, selectingTextIn, wireCardHead } from './chat-card.js';
import { announce, esc, fileUrl } from './core.js';

// Each status and how a count of it reads: one word, or one for one check and
// another for more.
const CHECK_WORDS = [['pass', 'passed'], ['fixed', 'fixed'], ['fail', 'failed'], ['main', ['fails on main', 'fail on main']],
  ['fixing', 'being fixed'], ['skip', 'skipped'], ['running', 'running'], ['unfinished', 'not finished']];
const CHECK_NAMES = { pass: 'Passed', fixed: 'Fixed', fail: 'Failed', main: 'Fails on main too', fixing: 'Being fixed',
  skip: 'Skipped', running: 'Running', unfinished: 'Not finished' };
const counted = (status, count) => {
  const word = CHECK_WORDS.find(([key]) => key === status)[1];
  return `${count} ${Array.isArray(word) ? word[count === 1 ? 0 : 1] : word}`;
};

// A check still marked running once the agent has stopped never finished, so
// it reads as that instead of spinning for good. A failure that happens on
// main too gets its own status, `main`. A failure with a run started to fix
// it is `fixing` while that run works and `fixed` once it merged (serve.py's
// check_fix_run). Only the statuses Orc reports come in: `main`, `fixing`,
// `fixed` and `unfinished` are its own words for them.
function settledChecks(checks, working) {
  return (checks || []).filter(check => check && ['pass', 'fail', 'skip', 'running'].includes(check.status))
    .map(check => {
      if (check.status === 'running' && !working) return { ...check, status: 'unfinished' };
      if (check.status !== 'fail') return check;
      if (check.fix && typeof check.fix.id === 'string') return { ...check, status: check.fix.state === 'merged' ? 'fixed' : 'fixing' };
      if (check.onMain === true) {
        const { relatedFix, ...rest } = check;
        return relatedFix && typeof relatedFix.id === 'string'
          ? { ...rest, status: 'main', relatedFix } : { ...rest, status: 'main' };
      }
      return check;
    });
}

// The checks that need the reader: failed, here or on main too, with no run
// started to fix them. Chat shows them only once the run reaches Ship.
const failedChecks = view => view.filter(check => check.status === 'fail' || check.status === 'main');
const chatChecks = (checks, working, { show = true } = {}) => (show ? failedChecks(settledChecks(checks, working)) : []);

// What the list adds up to.
function checksSummary(checks) {
  const counts = { pass: 0, fixed: 0, fail: 0, main: 0, fixing: 0, skip: 0, running: 0, unfinished: 0 };
  for (const check of checks) counts[check.status] += 1;
  const parts = except => CHECK_WORDS.filter(([status]) => counts[status] && status !== except)
    .map(([status]) => counted(status, counts[status]));
  const named = status => `${counts[status]} check${counts[status] === 1 ? '' : 's'} ${CHECK_WORDS.find(([key]) => key === status)[1]}`;
  const pills = CHECK_WORDS.filter(([status]) => counts[status]).map(([status]) => ({ status, text: counted(status, counts[status]) }));
  if (counts.running) {
    return { state: 'running', title: 'Verifying', count: parts().join(' · '), pills };
  }
  if (counts.fail) return { state: 'failed', title: named('fail'), count: parts('fail').join(' · '), pills };
  if (counts.unfinished) return { state: 'unfinished', title: named('unfinished'), count: parts('unfinished').join(' · '), pills };
  if (counts.main) {
    const title = `${counts.main} check${counts.main === 1 ? ' already fails' : 's already fail'} on main`;
    return { state: 'main', title, count: parts('main').join(' · '), pills };
  }
  if (counts.fixing) return { state: 'fixing', title: named('fixing'), count: parts('fixing').join(' · '), pills };
  const first = ['pass', 'fixed'].find(status => counts[status]) || 'skip';
  return { state: 'done', title: [named(first), ...parts(first)].join(' · '), count: '', pills };
}

function checkDetail(check) {
  if (check.status === 'unfinished') return 'Not finished';
  const detail = check.detail || '';
  if (check.status !== 'skip') return detail;
  return !detail ? 'Skipped' : /^skipped\b/i.test(detail) ? detail : `Skipped: ${detail}`;
}

const CHECK_RING = '<circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const CHECK_MARK = body => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TICK = CHECK_MARK(`${CHECK_RING}<path d="M4.7 8.3l2.2 2.2 4.4-4.8"/>`);
const SPINNER = CHECK_MARK('<circle class="run-check-track" cx="8" cy="8" r="6.5" stroke-width="1.8"/><path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke-width="1.8"/>');
const CHECK_MARKS = {
  pass: TICK,
  fixed: TICK,
  fail: CHECK_MARK(`${CHECK_RING}<path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/>`),
  main: CHECK_MARK(`${CHECK_RING}<path d="M8 4.6v4.1"/><circle cx="8" cy="11.2" r=".55" fill="currentColor"/>`),
  fixing: SPINNER,
  skip: CHECK_MARK(`${CHECK_RING}<path d="M5 8h6"/>`),
  running: SPINNER,
  unfinished: CHECK_MARK('<circle cx="8" cy="8" r="7.25" stroke-width="1.5" stroke-dasharray="2.6 2.4"/>'),
};

// Backticks in a detail mark a command, as they do in the agent's messages.
const inlineCode = text => text.split(/(`[^`]+`)/).map(part => (/^`[^`]+`$/.test(part)
  ? `<code translate="no">${esc(part.slice(1, -1))}</code>` : esc(part))).join('');

// The lightbox items for a check's pictures (ui/run_checks.py lists them).
function checkPictures(runId, check) {
  const pictures = Array.isArray(check.pictures) ? check.pictures.filter(picture => picture && typeof picture.path === 'string') : [];
  return pictures.map((picture, index) => {
    const label = typeof picture.label === 'string' ? picture.label : '';
    const name = label || picture.path.split('/').pop();
    return { src: fileUrl(runId, picture.path), label, set: -1,
      alt: pictures.length > 1 ? `${check.label}, picture ${index + 1} of ${pictures.length}: ${name}` : `${check.label}: ${name}` };
  });
}

// A plain click on a check's Open link shows its pictures in Orc's lightbox,
// in Chat and in the Pull request panel alike; a modified click still opens
// the file itself.
document.addEventListener('click', event => {
  const link = event.target.closest?.('a.run-check-open[data-pictures]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  let items;
  try { items = JSON.parse(link.dataset.pictures); } catch { return; }
  if (!Array.isArray(items) || !items.length) return;
  event.preventDefault();
  window.postMessage({ type: 'orc-lightbox', items, i: 0 }, location.origin);
});

function checkRowHtml(runId, check) {
  const detail = checkDetail(check);
  const label = check.kind === 'command' ? `<code translate="no">${esc(check.label)}</code>` : esc(check.label);
  const pictures = checkPictures(runId, check);
  const isLog = !pictures.length && typeof check.artifact === 'string' && check.artifact.endsWith('.log');
  const open = check.artifact
    ? `<a class="run-check-open" href="${esc(fileUrl(runId, check.artifact))}" target="_blank" rel="noopener" data-focus-key="open:${esc(check.id)}"${pictures.length ? ` data-pictures="${esc(JSON.stringify(pictures))}"` : ` data-text-stage data-text-title="${esc(check.label)}" data-text-path="${esc(check.artifact)}" data-copy-label="${isLog ? 'Copy log' : 'Copy file'}"`} aria-label="${pictures.length ? 'View the pictures' : isLog ? 'Open the log' : 'Open the file'} for: ${esc(check.label)}">${isLog ? 'View log' : 'Open'}</a>` : '';
  // A failure on main too says so first, in the card's amber; one a run is
  // fixing names that run first, linked. When another build in the same repo
  // looks like it is already fixing an on-main failure, flag it beside the mark.
  const onMain = check.status === 'main' ? CHECK_NAMES.main : '';
  const fixing = check.status === 'fixing' || check.status === 'fixed';
  const fixedIn = fixing ? `${check.status === 'fixed' ? 'Fixed' : 'Being fixed'} in ${check.fix.title || check.fix.id}` : '';
  const related = check.status === 'main' && check.relatedFix ? check.relatedFix : null;
  const relatedVerb = related ? (related.state === 'merged' ? 'Possibly fixed' : 'Possibly being fixed') : '';
  const relatedIn = related ? `${relatedVerb} in ${related.title || related.id}` : '';
  const lead = onMain ? `<span class="run-check-on-main">${onMain}</span>`
    : fixing ? `<span class="run-check-fix">${check.status === 'fixed' ? 'Fixed' : 'Being fixed'} in <a href="#${encodeURIComponent(check.fix.id)}" data-focus-key="fix-run:${esc(check.id)}">${esc(check.fix.title || check.fix.id)}</a></span>` : '';
  const relatedLead = related
    ? `<span class="run-check-related-fix"${related.state === 'merged' ? ' data-state="merged"' : ''}>${relatedVerb} in <a href="#${encodeURIComponent(related.id)}" data-focus-key="related-fix:${esc(check.id)}">${esc(related.title || related.id)}</a></span>` : '';
  const said = [onMain || fixedIn, relatedIn, detail].filter(Boolean);
  const textParts = [...(lead ? [lead] : []), ...(relatedLead ? [relatedLead] : []), ...(detail ? [inlineCode(detail)] : [])];
  const detailHtml = open
    ? (textParts.length
      ? `<span class="run-check-detail-text">${textParts.join(' · ')}</span><span class="run-check-detail-sep"> · </span>${open}`
      : open)
    : textParts.join(' · ');
  return `<li class="run-check" data-status="${check.status}" data-check-id="${esc(check.id || check.label)}">
      <span class="run-check-mark">${CHECK_MARKS[check.status]}<span class="sr-only">${['main', 'fixing'].includes(check.status) ? 'Failed' : CHECK_NAMES[check.status]}:</span></span>
      <span class="run-check-label">${label}</span>
      ${detailHtml ? `<span class="run-check-detail"${said.length ? ` title="${esc(said.join(' · '))}"` : ''}>${detailHtml}</span>` : ''}
    </li>`;
}

export const checkRowsHtml = (runId, checks) => checks.map(check => checkRowHtml(runId, check)).join('');

// The rows the reader opened in Chat's card, by run, for as long as Orc is open.
const openRows = new Map();

// On a wide card each row is cut to one line. A row whose name or result is cut
// short can be opened to read in full (and closed again); one that fits stays
// plain, with no pointer and nothing to focus.
function markCheckRows(list, runId) {
  const opened = openRows.get(runId);
  // chat.css sets this flag only where rows sit on one line; a narrow card
  // already shows every row in full.
  const oneLine = getComputedStyle(list).getPropertyValue('--run-check-one-line').trim() === '1';
  for (const row of list.querySelectorAll('.run-check')) {
    const open = !!opened?.has(row.dataset.checkId);
    const name = row.querySelector('.run-check-label');
    row.toggleAttribute('data-open', open);
    const cut = oneLine && (open || [...row.querySelectorAll('.run-check-label, .run-check-detail, .run-check-detail-text')]
      .some(part => part.scrollWidth > part.clientWidth));
    row.toggleAttribute('data-expandable', cut);
    if (cut) {
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.setAttribute('aria-expanded', String(open));
      name.dataset.focusKey = `row:${row.dataset.checkId}`;
    } else {
      for (const attribute of ['role', 'tabindex', 'aria-expanded', 'data-focus-key']) name.removeAttribute(attribute);
    }
  }
}

function toggleCheckRow(row, runId) {
  if (!row?.hasAttribute('data-expandable')) return;
  const open = !row.hasAttribute('data-open');
  if (!openRows.has(runId)) openRows.set(runId, new Set());
  openRows.get(runId)[open ? 'add' : 'delete'](row.dataset.checkId);
  row.toggleAttribute('data-open', open);
  row.querySelector('.run-check-label').setAttribute('aria-expanded', String(open));
}

// Opening and closing rows, by pointer or from the keyboard. The Open link
// keeps its own job, and selecting a row's text does not toggle it.
function wireCheckRows(list, runId) {
  list.onclick = event => {
    const row = event.target.closest('.run-check');
    if (!row || event.target.closest('a, button')) return;
    if (!selectingTextIn(row)) toggleCheckRow(row, runId);
  };
  list.onkeydown = event => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('.run-check-label[role="button"]')) return;
    event.preventDefault();
    toggleCheckRow(event.target.closest('.run-check'), runId);
  };
}

// Which rows are cut short changes with the card's width, so it is measured again.
const rowObservers = new WeakMap();
function watchCheckRows(host, runId) {
  rowObservers.get(host)?.disconnect();
  if (typeof ResizeObserver !== 'function') return;
  let width = host.clientWidth;
  const observer = new ResizeObserver(() => {
    if (host.clientWidth === width) return;
    width = host.clientWidth;
    const list = host.querySelector('.chat-card:not(.chat-card-ghost) .run-checks');
    if (list && !list.hidden) markCheckRows(list, runId);
  });
  observer.observe(host);
  rowObservers.set(host, observer);
}

// What Fix it asks: in this run's Chat, only the run's own red failures so the
// agent fixes and re-reports them here; a new run gets every failed check.
function fixRequest(view, { inRun = false } = {}) {
  const own = view.filter(check => check.status === 'fail');
  const targets = inRun && own.length ? own : failedChecks(view);
  const lines = targets.map(check => {
    const log = typeof check.artifact === 'string' && check.artifact.endsWith('.log') ? ` (log: ${check.artifact})` : '';
    return `- ${check.label}${check.detail ? `: ${check.detail}` : ''}${!inRun && check.status === 'main' ? ' (fails on main too)' : ''}${log}`;
  });
  const lead = inRun
    ? 'Fix the checks that failed, then run them again and report each one with orc-check:'
    : 'Fix the checks that failed in this run:';
  return [lead, ...lines].join('\n');
}

// The card's foot whenever a check failed, the agent working or not: what Fix it
// will do, its button, and beside it either a way to start a separate run (when
// Fix it stays in this run) or to track a run that may already be fixing it.
function checksFootHtml(summary, failed, listed, { working = false, fixInRun = false, fixInNewRun = false, canLinkRelated = false } = {}) {
  const own = failed.filter(check => check.status === 'fail');
  const one = (fixInRun ? own.length : failed.length) === 1;
  const related = failed.filter(check => check.relatedFix);
  const relatedIds = [...new Set(related.map(check => check.relatedFix.id))];
  const allRelatedMerged = related.length > 0 && related.every(check => check.relatedFix.state === 'merged');
  let note;
  if (summary.state === 'main') {
    if (!related.length) note = 'This run didn\'t break it, so it is safe to ship as is.';
    else if (related.length === failed.length) {
      note = allRelatedMerged ? 'This run didn\'t break it; a merged run may already have fixed it.'
        : 'This run didn\'t break it; another run may already be fixing it.';
    } else note = 'This run didn\'t break it; another run may already be fixing part of it.';
  } else if (fixInRun) {
    note = working
      ? `Fix it queues a message here to fix ${one ? 'it' : 'them'} once this turn ends.`
      : `Fix it asks the agent here to fix ${one ? 'it' : 'them'} and run ${one ? 'it' : 'them'} again.`;
  } else {
    note = `Fix it starts a new run to fix ${one ? 'it' : 'them'}.`;
  }
  const linkLabel = allRelatedMerged
    ? (relatedIds.length === 1 ? 'Mark as fixed by that run' : 'Mark as fixed by those runs')
    : (relatedIds.length === 1 ? 'Track that run as the fix' : 'Track those runs as the fix');
  const secondary = fixInRun
    ? (fixInNewRun ? '\n        <button type="button" class="chat-checks-link" data-checks-fix-new data-focus-key="fix-new">Fix in a new run</button>' : '')
    : (canLinkRelated && related.length
      ? `\n        <button type="button" class="chat-checks-link" data-checks-link-fix data-focus-key="link">${linkLabel}</button>` : '');
  return `<div class="chat-checks-foot" ${listed ? '' : 'hidden'}>
      <p class="chat-checks-note">${note}</p>
      <div class="chat-checks-actions">${secondary}
        <orc-button variant="ghost" size="compact" data-checks-fix data-focus-key="fix">Fix it</orc-button>
      </div>
    </div>`;
}

const checksFoldKey = runId => `orc-checks:${runId}`;

// `onFixInRun(text)` sends Fix it's request in this run's Chat (used for red
// failures while the run is open), `onFixInNewRun(text, checkIds)` (or legacy
// `onFix`) opens a new conversation noted on those checks, and
// `onLinkFixRun(links)` records a flagged related build as the check's fix run.
// Only failed checks show, so a run with none has no card. `onToggle` repaints
// whatever shares the card's place once the reader folds or opens it. Returns
// whether the card stands open, and `fold()` to fold it for a card that takes
// its place.
export function renderChecksCard(host, options) {
  const { runId, checks, working, show = true, onFixInRun, onFixInNewRun, onFix, onLinkFixRun, onToggle, onAfterFold } = options;
  const fixNew = onFixInNewRun || onFix;
  const repaint = () => (onToggle ? onToggle() : renderChecksCard(host, options));
  const view = chatChecks(checks, working, { show });
  if (!view.length) {
    host.hidden = true;
    for (const name of ['signature', 'folded', 'listed']) delete host.dataset[name];
    // Kept once Chat has drawn, so a check failing later is announced.
    host.dataset.state = 'none';
    host.replaceChildren();
    return { open: false, fold() {} };
  }
  const summary = checksSummary(view);
  const preference = cardPreference(checksFoldKey(runId));
  const listed = !preference.minimized;
  const fixInRun = summary.state === 'failed' && !!onFixInRun;
  const fixInNewRun = !!fixNew;
  const fixable = fixInRun || fixInNewRun;
  const canLinkRelated = !fixInRun && fixInNewRun && !!onLinkFixRun;
  const result = { open: listed, fold() { if (listed) flipCardPreference(checksFoldKey(runId), 'minimized'); } };
  const signature = JSON.stringify([runId, view, summary.state, preference, working, fixInRun, fixInNewRun, canLinkRelated]);
  if (host.dataset.signature === signature) return result;
  const paint = () => {
    host.dataset.signature = signature;
    host.dataset.listed = String(listed);
    host.hidden = false;
    host.toggleAttribute('data-folded', !listed);
    const focusKey = host.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    host.innerHTML = `<section class="chat-card chat-checks-card" data-state="${summary.state}" ${listed ? '' : 'data-folded'} aria-labelledby="chat-checks-title">
      <div class="chat-card-head">
        <span class="chat-card-dot" aria-hidden="true"></span>
        <h2 id="chat-checks-title">${esc(summary.title)}</h2>
        <span class="chat-card-count">${esc(summary.count)}</span>
        <button type="button" class="chat-card-toggle chat-card-fold chat-steps-toggle" aria-expanded="${listed}" aria-controls="chat-checks-list" aria-label="${listed ? 'Minimize checks' : 'Show checks'}" data-focus-key="toggle">${CARD_CHEVRON}</button>
      </div>
      <ul id="chat-checks-list" class="chat-card-body chat-card-list run-checks" ${listed ? '' : 'hidden'}>${checkRowsHtml(runId, view)}</ul>
      ${fixable ? checksFootHtml(summary, view, listed, { working, fixInRun, fixInNewRun, canLinkRelated }) : ''}
    </section>`;
    if (fixable) {
      host.querySelector('[data-checks-fix]').onclick = fixInRun
        ? () => onFixInRun(fixRequest(view, { inRun: true }))
        : () => fixNew(fixRequest(view), view.map(check => check.id));
      const fixNewButton = host.querySelector('[data-checks-fix-new]');
      if (fixNewButton && fixNew) {
        fixNewButton.onclick = () => fixNew(fixRequest(view), view.map(check => check.id));
      }
      const linkButton = host.querySelector('[data-checks-link-fix]');
      if (linkButton) {
        linkButton.onclick = () => onLinkFixRun(view.filter(check => check.relatedFix)
          .map(check => ({ checkId: check.id, fixRunId: check.relatedFix.id })));
      }
    }
    const list = host.querySelector('#chat-checks-list');
    if (listed) markCheckRows(list, runId);
    wireCheckRows(list, runId);
    watchCheckRows(host, runId);
    const toggle = host.querySelector('.chat-card-toggle');
    toggle.onclick = () => {
      flipCardPreference(checksFoldKey(runId), 'minimized');
      repaint();
    };
    wireCardHead(host.querySelector('.chat-card-head'), toggle);
    if (focusKey) {
      const target = host.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      (target && !target.closest('[hidden]') ? target : toggle)?.focus({ preventScroll: true });
    }
  };
  // A card already on screen travels to its folded row, or back.
  const moved = host.querySelector('.chat-card') && host.dataset.listed !== String(listed);
  if (moved) animateCardFold(host, paint, 'chat-checks-ghost', onAfterFold);
  else paint();
  // A card that comes or changes while Chat is open says so; one there when Chat opens does not.
  const said = host.dataset.state;
  host.dataset.state = summary.state;
  if (said && said !== summary.state) announce(`Verification: ${summary.title}.`);
  return result;
}

// The Pull request panel's section. `source` is "ship" when the run reported no
// checks and the rows are what it recorded at Ship instead. It starts folded to
// its header, whose pills already name any failure; `open` is the reader's own
// choice once made.
export function checksSectionHtml(runId, { checks, source } = {}, { open = null, working = false } = {}) {
  const view = settledChecks(checks, working);
  if (!view.length) return '';
  const summary = checksSummary(view);
  const shown = open === true;
  const pills = summary.pills.map(pill => `<span class="pr-verification-pill" data-status="${pill.status}">${esc(pill.text)}</span>`).join(' ');
  return `<section class="pr-verification" aria-label="Self-verification">
      <button type="button" class="pr-verification-head" data-section="verification" aria-expanded="${shown}">
        <span class="pr-verification-title">Self-verification</span>
        <span class="pr-verification-count">${pills}</span>${CARD_CHEVRON}
      </button>
      <div data-section-body="verification"${shown ? '' : ' hidden'}>
        ${source === 'ship' ? '<p class="pr-verification-note">This run reported no checks as it worked. These are the commands and flows it recorded at Ship.</p>' : ''}
        <ul class="run-checks">${checkRowsHtml(runId, view)}</ul>
      </div>
    </section>`;
}
