// orc-ui: Artifact shell: tabs and version history.

import { chatTabAvailable } from './chat-timeline.js';
import { refresh, bindRunNavigation, hasRunSnapshot, revealDiffPanel } from './panel-navigation.js';
import { readScroll, saveScroll } from './artifact-load.js';
import { loadFile } from './artifact-content.js';
import { byPeople, prChipContent, resolvePrUrls } from './pr-badge.js';
import { harnessMark, LINEAR_MARK_SVG, SLACK_MARK_SVG } from './agent-marks.js';
import { $, CHAT_KEY, calendarAvailable, deliveryTagHtml, serversTaskTagHtml, DECISION_FILES, GEAR_ICON, SOURCE_LABELS, announce, artifactPageUnloading, canonicalPhase, captureFocus, currentArtifactLoad, doneSettled, esc, flashcardMeeting, flashcardWhen, grillingShellState, hasOwnedLivePane, isFinalReady, isHeadlessRun, isMergedToParent, isPlanningRun, isPresentReady, isQuestionRun, isShipReady, mediaSignature, moveTabIndicator, prPushPending, prRepliesPending, pullRequestKey, renderedArtifactKey, requestedArtifactKey, restoreFocus, restoreTabIndicator, reviewParent, runLinkBadges, runTimesHtml, runs, setCurrentArtifactLoad, setRenderedArtifactKey, setRequestedArtifactKey, versionLabel, CONTROL_KEY, PR_BODY_RE, linkedMarkdownTab, tabsFor } from './core.js';
import { q } from './diff.js';
import { followOpenRun, groupedPlanBuild, renderList } from './filters.js';
import { renderCodexQuestions } from './pending-questions.js';
import { TERMINAL_ICON, isTerminalOpen } from './terminal.js';
import { DIFF_ICON, isDiffPanelOpen, sidePanelAvailable, syncDiffPanel } from './diff-panel.js';
import { CLARIFICATION_PAGE, PLANNING_PAGE, amAskHolds, markSentQuestions, openAnswerMode, questionsPending, releaseSentQuestions, settleSentQuestions, syncAnswerCard, syncAnswerMode } from './answer-mode.js';
import { landingTab, recordPlanReveal, revealedMeta } from './plan-reveal.js';
import { selectReview } from './review-panel.js';
import { EVALS_KEY, EVALS_REPORT } from './evals-panel.js';
import { isPlanRevealPending, isPlanTabHidden, isPlanningComplete, isProjectRedirect, planOf, presentRun, runGroupOf } from './run-presentation.js';
import { chatMounted, sessionTakesChat, updateChatRun } from './chat.js';
import { FACTORY_KEY, factoryMounted, unmountFactory, updateFactoryRun } from './secondary-screens.js';
import { factoryVisualsEnabled } from './motion.js';
import { appChipsHtml } from './app-chips.js';
import { MCP_KEY, mcpMounted, mcpTabAvailable, unmountMcp, updateMcpRun } from './mcp-tab.js';
import { handPlanPageOver, planPageMounted, planPageShows, unmountPlanPage, updatePlanPage } from './plan-page.js';
import { pullRequestQa, qaAvailable } from './qa-launch.js';
import { renderEmptyStateSlot, renderThemeTabBar } from './theme-components.js';

// A checklist: the QA window's steps.
const QA_ICON = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 2 2 4-4"/><path d="m3 17 2 2 4-4"/><path d="M13 7h8"/><path d="M13 17h8"/></svg>';

// The reaction the review post has: eyes once picked up, a check once done.
const SLACK_REVIEW_STATES = {
  'picked-up': ['👀', 'picked up'],
  approved: ['✅', 'done'],
  waiting: ['', 'no reaction yet'],
};

// Keep the shell-wide focus-modality contract independent of optional
// artifact features. Pointer-focused text controls use their border cue;
// keyboard-focused controls retain the full focus ring.
const orcTextEntry = el => el instanceof Element
  && el.matches('textarea, select, orc-select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"])');
document.addEventListener('pointerdown', e => {
  const t = e.target instanceof Element && e.target.closest('input, textarea, select, orc-select');
  if (orcTextEntry(t)) t.dataset.suppressFocusRing = '';
}, true);
document.addEventListener('input', e => {
  if (orcTextEntry(e.target)) e.target.dataset.suppressFocusRing = '';
}, true);
document.addEventListener('focusout', e => {
  if (document.hasFocus() && orcTextEntry(e.target)) delete e.target.dataset.suppressFocusRing;
}, true);
let orcPointerModality = false;
document.addEventListener('pointerdown', () => { orcPointerModality = true; }, true);
document.addEventListener('keydown', () => { orcPointerModality = false; }, true);
document.addEventListener('focusin', e => {
  if (!orcPointerModality || !orcTextEntry(e.target)) return;
  (e.target.closest('.newconv-prompt') || e.target).dataset.suppressFocusRing = '';
}, true);

const PHASE_TAB = {
  grilling: ['grilling.html'],
  plan: ['plan.html', 'grilling.html'],
  // Build keeps the review pages ahead of Plan, but lands on Plan in practice:
  // virtual_gate_entries withholds an in-progress review tab entirely, so the
  // list falls through while the build runs. Once a build gate is actually
  // pending, build-review.html exists and this must land on it.
  build: ['review.html', 'audit.html', 'build-review.html', 'plan.html'],
  ponytail: ['review.html', 'audit.html', 'build-review.html', 'plan.html'],
  mvp: ['mvp/mvp.html', 'plan.html'],
  review: ['review.html', 'audit.html', 'build-review.html'],
  a11y: ['review.html', 'audit.html', 'build-review.html'],
  analytics: ['review.html', 'audit.html', 'build-review.html'],
  audit: ['review.html', 'audit.html', 'build-review.html'],
  qa: ['recap/recap.html', 'qa-review.html', 'review.html', 'audit.html', 'build-review.html'],
  recap: ['recap/recap.html'],
  docs: ['docs/feature.md'],
  present: ['present/present.html', 'recap/recap.html'],
  done: ['present/present.html', 'recap/recap.html'],
  clarification: ['__chat__'],
  planning: ['planning/planning.html'],
  verify: ['verification-receipt.json', 'build-summary.md', 'plan.html'],
  ship: ['ship/ship.html', 'verification-receipt.json'],
};
const PR_COMMENTS_TAB = 'pr-comments.html';
const PLANNING_TAB = 'planning/planning.html';
function defaultTab(meta, tabs, files = []) {
  // An answered question reads as its conversation; answer.md stays the
  // landing only for a run whose conversation Orc cannot read.
  if (isQuestionRun(meta, files)) return tabs.some(t => t.key === CHAT_KEY) ? CHAT_KEY : 'answer.md';
  if (meta.route === 'local-review') return 'review/recap.html';
  const prPlan = prPlanTab(meta, tabs);
  if (prPlan) return prPlan;
  // A planning session has one page whatever its phase says, closed or not.
  if (isPlanningRun(meta) && tabs.some(t => t.key === PLANNING_TAB)) return PLANNING_TAB;
  // While the agent is working, what it is doing right now is the
  // conversation; a gate or a finished run still opens on its artifact.
  if (meta.status === 'running' && tabs.some(t => t.key === CHAT_KEY)) return CHAT_KEY;
  const phase = canonicalPhase(meta.phase, meta.lifecycleVersion);
  const phaseTabs = [3, 4].includes(meta.lifecycleVersion) && phase === 'done'
    ? PHASE_TAB.ship : PHASE_TAB[phase];
  for (const key of phaseTabs || []) {
    if (tabs.some(t => t.key === key)) return key;
  }
  return tabs[0] && tabs[0].key;
}

// Opening a run lands on its conversation whenever it has one, falling back
// to defaultTab when Chat is unavailable.
function openingTab(meta, tabs, files = []) {
  const prPlan = prPlanTab(meta, tabs);
  if (prPlan) return prPlan;
  return tabs.some(t => t.key === CHAT_KEY) ? CHAT_KEY : defaultTab(meta, tabs, files);
}

// TESTABLE: PR comments round tab policy
// A round waiting on the user finishes in Chat (pr-round-card.js), so its PR
// comments tab never opens by itself; it stays the record of the threads.
// The round's button hands the push to the session, so its progress shows in
// the conversation.
function prRoundSent(prevMeta, meta) {
  return prevMeta?.status === 'awaiting-gate' && meta.status === 'running'
    && (prPushPending(meta) || prRepliesPending(meta));
}
// Before it changes anything, a round asks what to do about each comment,
// and the PR comments tab is its plan (ui/run_pr_plan.py): the run opens there.
function prPlanTab(meta, tabs) {
  return meta.status === 'awaiting-gate' && meta.prFeedback?.state === 'awaiting-answers'
    && tabs.some(tab => tab.key === PR_COMMENTS_TAB) ? PR_COMMENTS_TAB : null;
}
// END TESTABLE: PR comments round tab policy

const REVIEW_TABS = new Set(['review.html', 'audit.html', 'build-review.html']);
function lifecycleTabs(meta, tabs, chat) {
  // The side panel's Evals view carries the candidates and the report.
  if (meta.route === 'evals') return tabs.filter(tab => tab.key === '__shots__');
  if (meta.route === 'local-review') return tabs.filter(tab => tab.key === 'review/recap.html');
  // A planning session owns no lifecycle artifact; a Notion draft drafted on
  // request is linked from the header, not a tab. Its Planning tab waits for
  // the plan reveal wherever Chat can carry the session.
  if (isPlanningRun(meta)) {
    const planning = tabs.filter(tab => tab.key === PLANNING_TAB && !(chat && isPlanTabHidden(meta)));
    // Once the rounds are over the page is the plan, and is named for it.
    return isPlanningComplete(meta) ? planning.map(tab => ({ ...tab, label: 'Plan' })) : planning;
  }
  if (meta.lifecycleVersion === 4) {
    // The Pull request panel replaced the Ship page, whatever the run's status.
    const allowed = new Set([
      'clarification/clarification.html', 'plan.html', 'build-summary.md',
      'docs/feature.md', 'pr-comments.html',
    ]);
    return tabs.filter(tab => allowed.has(tab.key));
  }
  if (meta.lifecycleVersion === 3) {
    const allowed = new Set([
      'clarification/clarification.html', 'plan.html', 'build-summary.md',
      'verification-receipt.json', 'ship/ship.html', 'docs/feature.md',
      'pr-comments.html',
    ]);
    return tabs.filter(tab => allowed.has(tab.key));
  }
  tabs = tabs.filter(tab => tab.key !== 'build-summary.md');
  if (meta.mode !== 'gated' || meta.mvpCheckpointVersion !== 2) return tabs;
  const mvp = tabs.find(tab => tab.key === 'mvp/mvp.html');
  if (!mvp) return tabs;
  const ordered = tabs.filter(tab => tab !== mvp);
  const reviewIdx = ordered.findLastIndex(tab => REVIEW_TABS.has(tab.key));
  if (reviewIdx === -1) return tabs;
  ordered.splice(reviewIdx + 1, 0, mvp);
  return ordered;
}

// The title keeps clear of the run tools in the header's corner, which are as
// wide as their buttons and the side panel button's label make them. With the
// side panel open a cut title shows itself whole on hover. Each render
// replaces the title and may replace the tools, so watch the new nodes.
const runTitleRoom = typeof ResizeObserver === 'function' ? new ResizeObserver(fitRunTitle) : null;
function fitRunTitle() {
  const tools = $('links').querySelector('.run-tools');
  if (tools?.offsetWidth) $('head').style.setProperty('--run-tools-width', `${Math.ceil(tools.getBoundingClientRect().width)}px`);
  const text = $('title').querySelector('.run-title-text');
  if (text) text.title = text.scrollWidth > text.clientWidth ? text.textContent : '';
}
// A rename shows at once, before the next poll repaints the header.
export function setRunTitleText(title) {
  const text = $('title')?.querySelector('.run-title-text');
  if (!text) return;
  text.textContent = title;
  fitRunTitle();
}
function watchRunTitleRoom() {
  fitRunTitle();
  if (!runTitleRoom) return;
  runTitleRoom.disconnect();
  for (const node of [$('title'), $('title').querySelector('.run-title-text'), $('links').querySelector('.run-tools')]) {
    if (node) runTitleRoom.observe(node);
  }
}

// Leave the node alone when a poll repaints the same markup.
export function paintHtml(node, html) {
  if (node.innerHTML !== html) node.innerHTML = html;
}

// Kept as an extraction boundary for the standalone progress-contract tests.
function copyChip(value, display, icon, label) {
  return `<orc-copy-button variant="ghost" size="compact" value="${esc(value)}" aria-label="Copy ${esc(label)}">${icon} ${esc(display)}</orc-copy-button>`;
}

// The server names these only at an open gate whose session has gone idle:
// they no longer hold the gate, but a reader should know what is still running.
function backgroundTasksNote(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) return '';
  const count = tasks.length === 1 ? '1 background task' : `${tasks.length} background tasks`;
  const title = `${count} still running:\n${tasks.join('\n')}`;
  return `<span class="background-tasks" title="${esc(title)}">${count} running: <code>${esc(tasks[0])}</code></span>`;
}

// BEGIN recap-version-feedback
function planRefinementHtml(id, refinement, open) {
  if (!refinement) return '';
  const changes = refinement.changes || {};
  const changeRows = [
    ['Updated', changes.updatedSections],
    ['Added', changes.addedSections],
    ['Removed', changes.removedSections],
  ].filter(([, sections]) => Array.isArray(sections) && sections.length)
    .map(([label, sections]) => `<li><strong>${label}:</strong> ${esc(sections.join(', '))}</li>`);
  const added = Number(changes.linesAdded) || 0;
  const removed = Number(changes.linesRemoved) || 0;
  const details = Array.isArray(changes.details) ? changes.details : [];
  details.forEach(detail => {
    const delta = detail.before && detail.after
      ? `${detail.before} → ${detail.after}`
      : detail.after ? `Added: ${detail.after}` : detail.before ? `Removed: ${detail.before}` : '';
    if (delta) changeRows.push(`<li><strong>${esc(detail.section || 'Change')}:</strong> ${esc(delta)}</li>`);
  });
  if (added || removed) {
    changeRows.push(`<li class="refinement-stats">${added} line${added === 1 ? '' : 's'} added · ${removed} line${removed === 1 ? '' : 's'} removed</li>`);
  }
  const nextPath = refinement.nextPath;
  const feedback = Array.isArray(refinement.feedback) ? refinement.feedback : [];
  const feedbackRows = feedback.map(thread => {
    const messages = Array.isArray(thread.messages) && thread.messages.length
      ? thread.messages.map(message => `<p><strong>${message.actor === 'agent' ? 'Agent' : 'You'}:</strong> ${esc(message.body || '')}</p>`).join('')
      : `<p><strong>You:</strong> ${esc(thread.question || thread.anchor?.exact || 'Feedback')}</p>`
        + (thread.replies || []).map(reply => `<p><strong>Agent:</strong> ${esc(reply)}</p>`).join('');
    const refs = (thread.resultRefs || []).map(ref => {
      if (!ref || typeof ref !== 'object' || !ref.path) return '';
      return `<a href="${esc(`#${encodeURIComponent(id)}/${String(ref.path).replace(/^\/+/, '')}`)}">${esc(ref.label || 'View result')} →</a>`;
    }).join(' ');
    const outcome = [thread.status, thread.resolved ? 'resolved' : '', thread.action].filter(Boolean).join(' · ');
    return `<div class="refinement-feedback-thread">
      ${messages || '<p class="refinement-empty">No messages recorded.</p>'}
      ${outcome ? `<p><strong>Outcome:</strong> ${esc(outcome)}</p>` : ''}
      ${refs ? `<p class="artifact-thread-links">${refs}</p>` : ''}
    </div>`;
  }).join('');
  const hintBits = [];
  if (Array.isArray(changes.updatedSections) && changes.updatedSections.length) {
    hintBits.push(`Updated: ${changes.updatedSections.join(', ')}`);
  }
  if (added || removed) hintBits.push(`+${added} · −${removed}`);
  const hint = hintBits.join(' · ');
  return `<orc-accordion class="plan-refinement"${open ? ' open' : ''}>
      <span slot="summary">Refinement context${hint ? `<span class="refinement-hint">${esc(hint)}</span>` : ''}</span>
      ${feedbackRows ? `<div class="refinement-block"><h3>Comment threads and outcomes</h3>${feedbackRows}</div>` : ''}
      <div class="refinement-block">
        <h3>${refinement.current ? 'Current plan state' : 'What changed in the next version'}</h3>
        ${refinement.current ? '<p class="refinement-empty">These comments are attached to the current plan.</p>'
          : changeRows.length ? `<ul class="refinement-changes">${changeRows.join('')}</ul>` : '<p class="refinement-empty">No text changes detected.</p>'}
        ${nextPath ? `<a class="refinement-next" href="#${encodeURIComponent(id)}/${esc(nextPath)}">View next version →</a>` : ''}
      </div>
    </orc-accordion>`;
}

function renderVersionBanner(banner, id, current, snap, snaps = [], latestFeedback = []) {
  const currentThreads = !snap && current === 'plan.html' && Array.isArray(latestFeedback) ? latestFeedback : [];
  banner.hidden = !snap && !currentThreads.length;
  banner.innerHTML = snap
    ? `<div class="version-banner-head"><strong>Viewing version from ${esc(versionLabel(snap.ts))}</strong><a href="#${encodeURIComponent(id)}/${esc(current)}">Back to Latest</a></div>`
      + (current === 'plan.html' ? planRefinementHtml(id, snap.refinement, true) : '')
      + (['present/present.html', 'recap/recap.html'].includes(current) && Array.isArray(snap.feedback)
        ? snap.feedback.map(text => `<div class="version-feedback">
            <label>Feedback submitted on this version</label>
            <textarea rows="3" readonly disabled>${esc(text)}</textarea>
          </div>`).join('')
        : '')
    : (currentThreads.length
        ? `<div class="version-banner-head"><strong>Comments on this plan</strong></div>${planRefinementHtml(id, { answers: [], changes: {}, feedback: currentThreads, current: true }, false)}` : '');
  const status = typeof $ === 'function' ? $('version-banner-status') : null;
  if (status) {
    status.textContent = '';
    if (!banner.hidden) requestAnimationFrame(() => { status.textContent = snap ? `Viewing version from ${versionLabel(snap.ts)}.` : 'Plan feedback history available.'; });
  }
}
// END recap-version-feedback


// TESTABLE: pending-run placeholder scene
// A run stub that's still being surfaced (server has created it but no
// artifacts exist yet) gets an animated forging scene instead of the bare
// "No artifacts yet" empty state. Decorative SVG only — the accessible
// content is the status text below it.
function runPendingPlaceholderHtml() {
  return `<div class="run-placeholder">
    <svg class="rp-orc" viewBox="0 0 220 170" aria-hidden="true">
      <defs><linearGradient id="orc-skin-forge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9dc76b"/><stop offset="1" stop-color="#53743a"/></linearGradient><clipPath id="orc-forge-tile"><rect x="8" y="38" width="104" height="104" rx="24"/></clipPath></defs>
      <g class="rp-anvil">
        <rect x="138" y="130" width="36" height="8" rx="2" fill="color-mix(in srgb, var(--muted) 70%, var(--heading))"/>
        <rect x="146" y="118" width="20" height="12" fill="color-mix(in srgb, var(--muted) 60%, var(--panel))"/>
        <path d="M124 106 h64 l-8 12 h-48 z" fill="var(--muted)"/>
      </g>
      <circle class="rp-workpiece" cx="156" cy="100" r="7" fill="var(--accent)"/>
      <g class="rp-arm">
        <path d="M96 100 L126 78 L140 62 L150 70 L134 84 L106 108 Z" fill="url(#orc-skin-forge)" stroke="#202722" stroke-width="4" stroke-linejoin="round"/>
        <path d="M136 42 l26 11 l-7 16 l-26 -11 Z" fill="var(--muted)" stroke="#202722" stroke-width="3" stroke-linejoin="round"/>
      </g>
      <image href="/pwa/icon-192.png?v=3d-1" x="8" y="38" width="104" height="104" clip-path="url(#orc-forge-tile)"/>
      <g class="rp-sparks">
        <circle class="rp-spark s1" cx="160" cy="94" r="2.4" fill="var(--yellow)"/>
        <circle class="rp-spark s2" cx="166" cy="98" r="2" fill="var(--orange)"/>
        <circle class="rp-spark s3" cx="153" cy="90" r="1.8" fill="color-mix(in srgb, var(--yellow) 45%, var(--panel))"/>
      </g>
    </svg>
    <div class="rp-text" role="status">
      <p class="rp-caption">Forging artifacts…</p>
      <p class="rp-sub">Awaiting artifacts — run is starting</p>
    </div>
  </div>`;
}
// END TESTABLE: pending-run placeholder scene

// Send an answer to the question the run's pane is blocked on. The server
// Escapes the picker and pastes into the prompt, so a pick and a typed reply
// are the same request. The question hides on send and comes back with its
// controls and draft on failure — the pane is still waiting then.
function wirePendingAnswer(id, host) {
  const controls = [...host.querySelectorAll('button, input')];
  const restoreReply = typedReply => {
    const input = $('pending-q')?.querySelector('#pq-reply-text');
    if (input && typedReply && !input.value) input.value = typedReply;
  };
  const send = async (text, typedReply = '') => {
    if (!text.trim()) return;
    controls.forEach(c => { c.disabled = true; });
    const sent = markSentQuestions(id);
    announce('sending answer…');
    let res;
    try {
      res = await fetch(`/runs/${encodeURIComponent(id)}/answer-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch {
      releaseSentQuestions(id, sent);
      controls.forEach(c => { c.disabled = false; });
      restoreReply(typedReply);
      return announce('answer failed — could not reach orc-ui');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      releaseSentQuestions(id, sent);
      controls.forEach(c => { c.disabled = false; });
      restoreReply(typedReply);
      return announce(body.error || 'answer failed');
    }
    settleSentQuestions(id, sent);
    announce('answer sent to the terminal');
    refresh({ force: true });
  };
  host.querySelectorAll('.pq-pick').forEach(b => {
    b.onclick = () => send(b.dataset.answer);
  });
  const form = host.querySelector('.pq-reply');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const typed = form.querySelector('input').value;
    send(typed, typed);
  };
}

function paintRunTimes(run) {
  const html = run ? runTimesHtml(run) : '';
  paintHtml($('run-times'), html);
  $('run-times').hidden = !html;
}
// A 304 poll repaints nothing, so relative times need their own clock.
setInterval(() => {
  if ($('tabs').hidden) return;
  const id = decodeURIComponent(location.hash.slice(1).split('/')[0] || '');
  paintRunTimes(runs.find(r => r.id === id));
}, 30000);

// The run openRun is fetching a fresh list for, so a repaint of the empty slot
// keeps saying it is loading.
let loadingRunId = null;
export function openRun(id, file, opts) {
  const run = runs.find(r => r.id === id);
  // A plan paired with its build shows as the build: its links, and a plan
  // page still open when Start work's build arrives, move to the build's
  // same tab. location.replace tells every hash listener, the terminal too.
  const pairedBuild = groupedPlanBuild(run);
  if (pairedBuild && (!file || [CHAT_KEY, FACTORY_KEY, PLANNING_TAB].includes(file.split('?')[0]))) {
    location.replace(`#${encodeURIComponent(pairedBuild.id)}${file ? `/${file}` : ''}`);
    return;
  }
  if (file?.startsWith(`${CHAT_KEY}?message=`)) file = CHAT_KEY;
  const bare = !file;
  if (!run) {
    // orc:// links can target a run started while the window was
    // hidden (polling pauses on document.hidden) — fetch a fresh list once
    // before giving up instead of silently doing nothing
    if (!opts || !opts.retried) {
      const requestedHash = location.hash;
      loadingRunId = id;
      if (typeof renderEmptyStateSlot === 'function') {
        renderEmptyStateSlot($('empty'), { kind: 'no-run', message: 'Loading run…', hasDiff: false, runId: id });
      } else {
        $('empty').textContent = 'Loading run…';
      }
      refresh({ force: true, openingHash: requestedHash }).then(() => {
        if (location.hash === requestedHash) openRun(id, file, { ...opts, retried: true });
      }).catch(() => {}).finally(() => {
        loadingRunId = null;
        if (typeof renderEmptyStateSlot === 'function') {
          renderEmptyStateSlot($('empty'), { kind: 'no-run', message: 'Select a run', hasDiff: false, runId: null });
        } else {
          $('empty').textContent = 'Select a run';
        }
      });
    }
    return;
  }
  const parent = reviewParent(run);
  if (parent && (!file || file === 'review/recap.html' || file === 'review/recap.mdx')) {
    selectReview(parent.id, run.id);
    const parentTab = chatTabAvailable(parent) ? CHAT_KEY : null;
    history.replaceState(null, '', `#${encodeURIComponent(parent.id)}${parentTab ? `/${parentTab}` : ''}`);
    openRun(parent.id, parentTab, opts);
    revealDiffPanel('review');
    return;
  }
  const focus = captureFocus();
  document.querySelectorAll('.run').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id));
  followOpenRun(id);
  $('empty').hidden = true;
  $('head').hidden = $('tabs').hidden = $('content').hidden = false;

  // Opening a run without naming a tab lands on its plan until work from it
  // starts, including after a bare link waits for a fresh run list.
  const planLanding = bare ? landingTab(run) : null;
  if (planLanding) file = planLanding;
  // Opening a finished plan records the reveal in the background and renders
  // the Plan tab on the first paint instead of flashing Chat first.
  if (file === PLANNING_PAGE && isPlanRevealPending(revealedMeta(run))) {
    recordPlanReveal(run);
  }
  const meta = revealedMeta(run);
  const paths = run.files.map(f => f.path);
  const { header, badges, state } = presentRun({ ...run, meta });
  const answered = badges.answered;
  // decisions.md/.log lost their tab — links minted back then (chat logs, skill
  // docs) land on Run Control, where the trail now lives, instead of silently
  // falling through to the run's default tab.
  if (DECISION_FILES.includes(file)) file = CONTROL_KEY;
  // Clarification links in chat replies and notifications land in Answer mode.
  const clarificationLink = file === CLARIFICATION_PAGE;
  if (clarificationLink) {
    file = CHAT_KEY;
    if (questionsPending(run) || amAskHolds(run)) openAnswerMode(id);
  }
  // While the plan is still hidden (rounds open or cancelled), a planning link
  // opens in Chat and Answer mode instead of a hidden tab.
  const planningLink = file === PLANNING_PAGE && isPlanTabHidden(meta) && chatTabAvailable(run);
  if (planningLink) {
    file = CHAT_KEY;
    if (questionsPending(run) || amAskHolds(run)) openAnswerMode(id);
  }
  // Diff lost its tab to the diff panel (⌘B). A link minted back then opens
  // the panel over the run's default tab, and the hash drops it below so a
  // later poll cannot reopen a panel the user has since closed.
  const diffLink = file === 'diff.patch';
  if (diffLink) { file = null; revealDiffPanel(); }
  // PR bodies moved the same way, to the panel's Pull request view.
  const prBodyLink = file === 'pr-body.md' || PR_BODY_RE.test(file || '')
    || (meta.lifecycleVersion === 4 && file === 'ship/ship.html');
  if (prBodyLink) { file = null; revealDiffPanel('pr'); }
  // An eval's candidates and report moved there too, to its Evals view.
  const evalsLink = meta.route === 'evals' && [EVALS_KEY, EVALS_REPORT].includes(file);
  if (evalsLink) { file = null; revealDiffPanel('evals'); }
  if (answered && file === 'answer.md' && chatTabAvailable(run)) {
    file = null;
    revealDiffPanel('answer');
  }
  // The living diagram and the tech doc have no tab of their own; a link to
  // either opens the panel's view.
  if (file === 'diagram.md' && paths.includes('diagram.md')) {
    file = null;
    revealDiffPanel('diagram');
  }
  if (file === 'docs/tech-doc.md' && paths.includes('docs/tech-doc.md')) {
    file = null;
    revealDiffPanel('techdoc');
  }
  const grillingState = grillingShellState(meta, paths);
  $('head').dataset.grillingState = grillingState || '';
  const releaseBadge = !meta.releaseVersion ? '' : meta.releaseInSettings
    ? ` <a class="settings-version" href="#changelog" aria-label="View release ${esc(meta.releaseVersion)} in changelog">${esc(meta.releaseVersion)}</a>`
    : ` <span class="settings-version" aria-label="Release ${esc(meta.releaseVersion)}">${esc(meta.releaseVersion)}</span>`;
  const deliveryTag = deliveryTagHtml(meta, { files: paths });
  const serversTag = serversTaskTagHtml(meta);
  $('title').innerHTML = `<span class="run-title-text">${esc(meta.title || run.id)}</span>`
    + (serversTag ? ` ${serversTag}` : '')
    + releaseBadge
    + (deliveryTag ? ` ${deliveryTag}` : '');
  $('title').title = run.id;
  // Keep the header as a compact launch strip. Metadata and lifecycle
  // controls remain directly reachable from the selected run's settings cog.
  const links = [];
  // A headless turn's outcome and background tasks go FIRST, then the badge
  // pills (source link, PRs, linked runs). Anything new goes after those.
  const ticket = meta.linearTicket;
  // Frozen repository delivery is authoritative when present. The flattened
  // prUrls field remains a compatibility projection for older clients.
  const { urls: prUrls, groupedPrs } = resolvePrUrls(meta);
  // A source that is one of the header's PRs (or a review or comment on it)
  // already has its PR chip, so it gets no Source chip of its own.
  const sourcePr = pullRequestKey(meta.sourceUrl);
  const sourceIsPr = !!sourcePr && prUrls.some(url => pullRequestKey(url) === sourcePr);
  const sourceLink = !meta.parentRunId && meta.sourceUrl && !(ticket && meta.source === 'linear') && !sourceIsPr
    ? `<a href="${esc(meta.sourceUrl)}" target="_blank">${esc(SOURCE_LABELS[meta.source] || 'Source')} ↗</a>`
    : '';
  // A flashcard run's chip names its meeting and opens it in Calendar.
  const meeting = calendarAvailable() ? flashcardMeeting(meta) : null;
  const meetingChip = meeting
    ? `<a href="#calendar" class="flashcard-meeting-chip" data-calendar-meeting="${esc(meeting.key)}" title="Show in Calendar">${esc([meeting.title, flashcardWhen(meeting, { short: true })].filter(Boolean).join(' · '))}</a>`
    : '';
  if (header.session) {
    const session = header.session;
    if (session.outcome) {
      const process = session.exitCode == null ? 'Process exit unknown' : `Process exit ${session.exitCode}`;
      const provider = `provider ${session.providerOutcome || 'unknown'}`;
      links.push(`<orc-accordion class="headless-turn-outcome" data-key="turn-outcome"><span slot="summary">${esc(session.label)}</span><div><p>${esc(session.cause || '')}</p><p>${esc(process)}; ${esc(provider)}.</p><p>${esc(session.continuation || '')}</p></div></orc-accordion>`);
    }
    const background = backgroundTasksNote(session.backgroundTasks);
    if (background) links.push(background);
  }
  if (meetingChip || sourceLink) links.push(meetingChip || sourceLink);
  if (ticket) {
    const content = `${LINEAR_MARK_SVG}${esc(ticket.ref)}`;
    links.push(ticket.url
      ? `<a class="linear-ticket" href="${esc(ticket.url)}" target="_blank" rel="noopener" aria-label="Linear ticket ${esc(ticket.ref)}">${content}</a>`
      : `<span class="linear-ticket" title="Linear ticket">${content}</span>`);
  }
  if (meta.threadLink?.url) {
    const { url, name, agent } = meta.threadLink;
    const label = `${harnessMark(agent)?.[0] || 'Agent'} thread`;
    links.push(`<a class="harness-thread" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(name || label)}" title="${esc(name || label)}">${harnessMark(agent)?.[1] || ''}${esc(label)}</a>`);
  }
  // One chip per app the run's worktree serves, running or not, then MCP.
  if (!answered) links.push(...appChipsHtml(run));
  if (!answered && qaAvailable(run)) {
    // qa-launch.js opens the window; the href is where it lives.
    links.push(`<a class="qa-chip" href="/qa/${encodeURIComponent(id)}" title="Walk through the QA steps in their own window">${QA_ICON}QA</a>`);
  } else {
    const prQa = pullRequestQa(run, runs);
    if (prQa) links.push(`<a class="qa-chip" href="${esc(prQa.href)}" title="${esc(prQa.title)}">${QA_ICON}QA</a>`);
  }
  // An answered review keeps the PR it reviewed; its Slack and Notion stay hidden.
  for (const url of prUrls) {
    const repo = (url.match(/github\.com\/[^/]+\/([^/]+)\/pull\//) || [])[1];
    const grouped = groupedPrs.find(item => item.url === url);
    const duplicateParticipant = grouped && groupedPrs.filter(
      item => item.participantId === grouped.participantId).length > 1;
    const label = grouped ? `${grouped.participantId}${duplicateParticipant ? ` · ${grouped.branch || grouped.id}` : ''} PR`
      : prUrls.length > 1 && repo ? `${repo} PR` : 'PR';
    links.push(`<a class="pr-link" href="${esc(url)}" target="_blank">${prChipContent(url, label)}</a>`);
  }
  for (const post of answered ? [] : meta.slackReviewPosts || []) {
    const [mark, status] = SLACK_REVIEW_STATES[post.state] || SLACK_REVIEW_STATES.waiting;
    const repo = (post.prUrl.match(/github\.com\/[^/]+\/([^/]+)\/pull\//) || [])[1];
    const label = prUrls.length > 1 && repo ? `${repo} Slack` : 'Slack';
    const name = `${label} post in #${post.channel}: ${status}${post.state === 'waiting' ? '' : byPeople(post.by)}`;
    links.push(`<a class="slack-review" data-state="${esc(post.state)}" href="${esc(post.permalink)}" target="_blank" rel="noopener" aria-label="${esc(name)}" title="${esc(name)}">${SLACK_MARK_SVG}${esc(label)}${mark ? ` ${mark}` : ''}</a>`);
  }
  if (!answered && meta.notionUrl) links.push(`<a href="${esc(meta.notionUrl)}" target="_blank">Notion doc ↗</a>`);
  links.push(...runLinkBadges(run));
  if (!answered) links.push(runGroupLineHtml(id, meta));
  // Chat replaces an answered question's Answer tab: the answer is the
  // conversation's last reply. A run with no conversation to read keeps it.
  const chat = chatTabAvailable(run);
  const tabs = answered
    ? (chat ? [] : tabsFor(run).filter(tab => tab.key === 'answer.md'))
    : lifecycleTabs(meta, tabsFor(run), chat);
  // A run a plan started reads that plan in a Plan tab after Chat and Factory.
  // Both share one key, so a run that already has its own Plan tab keeps it.
  if (!answered && !tabs.some(tab => tab.key === PLANNING_TAB) && planOf(run, runs)) {
    tabs.unshift({ key: PLANNING_TAB, label: 'Plan' });
  }
  const linkedTab = linkedMarkdownTab(run, file);
  if (linkedTab && !tabs.some(tab => tab.key === linkedTab.key)) tabs.push(linkedTab);
  const factory = chat && factoryVisualsEnabled();
  if (chat) tabs.unshift({ key: CHAT_KEY, label: 'Chat' }, ...(factory ? [{ key: FACTORY_KEY, label: 'Factory' }] : []));
  if (mcpTabAvailable(run)) tabs.splice(chat ? (factory ? 2 : 1) : 0, 0, { key: MCP_KEY, label: 'MCP' });
  // Swapping run from another run's Factory stays in the Factory, where the
  // floor travels to this run's town.
  const factoryHop = bare && !planLanding && factory && !!opts?.fromFactory;
  if (factoryHop) file = FACTORY_KEY;
  const factoryFallback = file === FACTORY_KEY && !factory;
  if (questionsPending(run) || amAskHolds(run)) {
    links.push('<button type="button" class="questions-chip" aria-label="Answer questions" aria-controls="answer-mode">Questions</button>');
  }
  links.push('<div class="run-tools" role="group" aria-label="Run tools">');
  if (sidePanelAvailable(run)) {
    links.push(`<button type="button" class="side-panel-chip" aria-label="Side panel" title="Side panel (⌘B)" aria-controls="run-diff" aria-expanded="${isDiffPanelOpen()}">${DIFF_ICON}</button>`);
  }
  if (meta.worktree?.path || meta.repoPath || meta.mainRepoPath) {
    links.push(`<button type="button" class="terminal-chip" aria-label="Terminal" title="Terminal" aria-controls="run-terminal" aria-expanded="${isTerminalOpen()}">${TERMINAL_ICON}</button>`);
  }
  links.push(`<a class="control-chip" href="#${encodeURIComponent(id)}/${CONTROL_KEY}" data-key="${CONTROL_KEY}" aria-label="Run Control" title="Run Control"${file === CONTROL_KEY ? ' aria-current="page"' : ''}>${GEAR_ICON}</a>`);
  links.push('</div>');
  paintHtml($('links'), links.join(''));
  syncDiffPanel();
  watchRunTitleRoom();
  const mergedTarget = meta.mergedIntoBranch || meta.parentBranch || '';
  const grillingTransition = grillingState === 'transition';
  // Cancelled runs lead with why: the tag beside the title only carries the
  // reason in a tooltip, which is unreachable on the way past. The words come
  // first — the tint is the redundant cue.
  const superseded = isProjectRedirect(meta);
  const stoppedReason = meta.status === 'cancelled'
    ? `Run ${superseded ? 'superseded' : 'cancelled'}${String(meta.cancelReason || '').trim() ? ` — ${meta.cancelReason.trim()}` : ''}`
    : '';
  $('run-state-note').className = meta.status === 'cancelled' ? (superseded ? 'stopped' : 'stopped cancelled') : '';
  $('run-state-note').setAttribute('variant', meta.status === 'cancelled' && !superseded ? 'red' : 'neutral');
  $('run-state-note').hidden = !stoppedReason && !isMergedToParent(meta) && !grillingTransition;
  $('run-state-note').textContent = stoppedReason
    || (isMergedToParent(meta)
      ? `Read-only child record${mergedTarget ? ` · merged into ${mergedTarget}` : ''}`
      : grillingTransition ? 'Grilling approved · preparing Plan' : '');

  let prRoundSwitch = false;
  if (tabs.some(tab => tab.key === PR_COMMENTS_TAB)) {
    if (chat && file === PR_COMMENTS_TAB && prRoundSent(opts?.prevRun?.meta, meta)) {
      file = CHAT_KEY;
      prRoundSwitch = true;
    }
  }

  // a hash may point at a snapshot (.versions/<tab file>/<ts><ext>) — keep the
  // owning tab highlighted for historical direct links
  const versionOwner = file && file.startsWith('.versions/')
    ? file.slice('.versions/'.length).replace(/\/[^/]+$/, '') : null;
  let tabKey = versionOwner || file;
  if (versionOwner && !tabs.some(t => t.key === versionOwner)) {
    // snapshot of a synthesized page's source (plan.mdx under the plan.html
    // tab) — find the tab whose version list owns this snapshot
    const owner = tabs.find(t => ((run.versions || {})[t.key] || [])
      .some(s => s.path === file || s.sourcePath === file));
    if (owner) tabKey = owner.key;
  }
  const current = (tabKey === CONTROL_KEY) || (tabKey && tabs.some(t => t.key === tabKey))
    ? tabKey : openingTab(meta, tabs, run.files);

  // Keep the shared question nodes outside content before a tab or run replaces them.
  if ((current !== CHAT_KEY || !chatMounted(id)) && $('pending-q').parentElement !== $('content-shell')) {
    $('content-shell').insertBefore($('pending-q'), $('content'));
  }
  if ((current !== CHAT_KEY || !chatMounted(id)) && $('answer-card').parentElement !== $('content-shell')) {
    $('content-shell').insertBefore($('answer-card'), $('content'));
  }
  syncAnswerMode(run);
  syncAnswerCard(current === CHAT_KEY ? run : null);

  const finalStop = isFinalReady(meta);
  const finalLive = !versionOwner && (isShipReady(meta)
    ? current === 'ship/ship.html'
    : isPresentReady(meta) ? current === 'present/present.html'
    : current === 'recap/recap.html');
  const pq = meta.pendingQuestion && (meta.harness === 'codex' || !(finalStop && finalLive))
    ? meta.pendingQuestion : null;
  $('pending-q').hidden = !pq;
  if (meta.harness === 'codex') {
    renderCodexQuestions($('pending-q'), id, meta, announce, refresh);
  } else if (pq) {
    $('pending-q').classList.remove('codex-questions');
    $('pending-q').dataset.codexSignature = '';
    // Answering sends a chat turn (or pastes into a live pane), and a one-click
    // pick is only unambiguous when there is a single question; multiple
    // questions keep the plain list and answer through the field.
    const answerable = hasOwnedLivePane(meta) || sessionTakesChat(meta);
    const picks = answerable && pq.questions.length === 1
      ? (pq.questions[0].options || []) : [];
    // In Chat the composer under the conversation takes the typed answer.
    const typedHere = answerable && current !== CHAT_KEY;
    $('pending-q').innerHTML =
      `<div class="pq-head">⏸ Waiting on you in the terminal</div>`
      + pq.questions.map(q =>
        `<div class="pq-q">${q.header ? `<b>${esc(q.header)}</b> — ` : ''}${esc(q.question)}</div>`
        + ((q.options || []).length
          ? `<ul>${q.options.map(o => `<li>${esc(o.label)}`
              + (o.description ? ` — ${esc(o.description)}` : '')
              + (o.preview ? `<pre class="pq-preview">${esc(o.preview)}</pre>` : '')
              + `</li>`).join('')}</ul>` : '')
      ).join('')
      + (picks.length || typedHere
        ? `<div class="pq-actions">`
          + picks.map(o =>
            `<button type="button" class="pq-pick" data-answer="${esc(o.label)}">`
            + `${esc(o.label)}</button>`).join('')
          + (typedHere
            ? `<form class="pq-reply">`
              + `<label class="sr-only" for="pq-reply-text">Answer in your own words</label>`
              + `<input id="pq-reply-text" type="text" autocomplete="off"`
              + ` placeholder="Answer in your own words…">`
              + `<button type="submit">Send answer</button></form>`
            : '')
          + `</div>`
        : '');
    if (answerable) wirePendingAnswer(id, $('pending-q'));
  }

  // When the URL named no tab we just resolved one from the run's phase — pin it
  // into the hash so a reload keeps it instead of re-deriving from the (by then
  // advanced) phase, which snapped you to a different artifact (plan -> recap).
  // replaceState adds no history entry and doesn't refire route().
  if (((bare || !file) && current) || factoryHop || factoryFallback || diffLink || prBodyLink || evalsLink || clarificationLink || planningLink || prRoundSwitch) {
    try { history.replaceState(history.state, '', '#' + encodeURIComponent(id) + (current ? '/' + current : '')); } catch {}
  }
  const snaps = (current && (run.versions || {})[current]) || [];
  const viewing = file && file.startsWith('.versions/')
    && snaps.some(s => s.path === file || s.sourcePath === file) ? file : current;
  paintRunTabButtons(id, tabs, current);
  paintRunTimes(run);
  const snap = snaps.find(s => s.path === viewing || s.sourcePath === viewing);
  renderVersionBanner($('version-banner'), id, current, snap, snaps, run.planLatestFeedback || []);
  restoreFocus(focus);
  if (opts?.focusTitle) $('title').focus();

  // A mounted Chat updates in place: rebuilding it on every poll would drop
  // the reader's scroll, expanded rows and half-typed message.
  if (current === CHAT_KEY && id + '/' + CHAT_KEY === requestedArtifactKey && chatMounted(id)) {
    lastEmptySlotData = null;
    updateChatRun(run);
  } else if (current === FACTORY_KEY && id + '/' + FACTORY_KEY === requestedArtifactKey && factoryMounted(id)) {
    lastEmptySlotData = null;
    updateFactoryRun(run);
  } else if (current === MCP_KEY && id + '/' + MCP_KEY === requestedArtifactKey && mcpMounted(id)) {
    lastEmptySlotData = null;
    updateMcpRun(run);
  } else if (planPageShows(run, viewing) && id + '/' + viewing === requestedArtifactKey && planPageMounted(id)) {
    lastEmptySlotData = null;
    updatePlanPage(run);
  } else if (planPageShows(run, viewing) && viewing === current && handPlanPageOver(run)) {
    // The plan page took the build over in place: it becomes this tab's
    // render, at the same scroll.
    lastEmptySlotData = null;
    const key = id + '/' + viewing;
    const scrollTop = $('content').scrollTop;
    setRequestedArtifactKey(key);
    setCurrentArtifactLoad({ key, scrollTop, resetStoredScroll: false, mergeSettled: doneSettled(run.meta || {}) });
    setRenderedArtifactKey(key);
    saveScroll(key, scrollTop);
  } else if (current) {
    lastEmptySlotData = null;
    const prevRun = opts && opts.prevRun;
    const prevFile = prevRun && prevRun.files.find(f => f.path === current);
    const newFile = run.files.find(f => f.path === current);
    const loadKey = id + '/' + viewing;
    const renderedSettled = currentArtifactLoad?.key === loadKey
      ? currentArtifactLoad.mergeSettled : undefined;
    const needsReload = !prevRun || !prevFile || !newFile || artifactTabNeedsReload(
      prevFile.size, newFile.size, prevRun.meta, run.meta, current,
      renderedSettled, doneSettled(run.meta || {}))
      || mediaSignature(prevRun) !== mediaSignature(run);
    // reload when the viewed path changed (tab/version switch) or, on the
    // latest file, when the poll saw it change; snapshots are immutable
    // A session that completes while its question page is open swaps to the plan.
    if (loadKey !== requestedArtifactKey || (viewing === current && (needsReload || planPageShows(run, viewing)))) {
      requestArtifactLoad(run, viewing);
    }
  } else {
    currentArtifactLoad?.iframeAbortController?.abort();
    setRequestedArtifactKey(id + '/');
    setCurrentArtifactLoad({ key: requestedArtifactKey });
    setRenderedArtifactKey(requestedArtifactKey);
    // A freshly created run stub has no artifacts yet by definition — show the
    // forging scene instead of the bare empty state. Re-derived from run.pending
    // on every openRun/route pass, so a later poll that drops the flag (or adds
    // artifacts) falls straight back to the normal empty state or real tabs
    // without any state left over here to clean up.
    $('content').removeAttribute('aria-busy');
    // The views renderArtifact mounts are put away as it does, so a plan's
    // unsent note drops its images rather than lingering off the page.
    unmountFactory();
    unmountMcp();
    unmountPlanPage();
    const hasDiff = paths.includes('diff.patch');
    const emptyMessage = hasDiff
      ? 'No artifacts yet. The change so far is in the side panel (⌘B).'
      : 'No artifacts yet';
    lastEmptySlotData = run.pending ? null : { kind: 'no-artifacts', message: emptyMessage, hasDiff, runId: id };
    $('content').innerHTML = run.pending ? runPendingPlaceholderHtml()
      : `<div id="empty" data-part="empty-state">${esc(emptyMessage)}</div>`;
    if (lastEmptySlotData && typeof renderEmptyStateSlot === 'function') {
      const emptyNode = $('content').querySelector?.('#empty');
      if (emptyNode) renderEmptyStateSlot(emptyNode, lastEmptySlotData);
    }
    $('content').scrollTop = 0;
  }
}

let lastRenderedRunTabs = null;
let lastEmptySlotData = null;

function paintRunTabButtons(id, tabs, current) {
  lastRenderedRunTabs = { id, tabs, current };
  const tabBtn = t =>
    `<button type="button" data-part="tab" data-key="${esc(t.key)}" class="${t.key === current ? 'active' : ''}"${t.key === current ? ' aria-current="true"' : ''}>${esc(t.label)}</button>`;
  const stockTabs = tabs.map(tabBtn).join('')
    + (tabs.length ? '<span class="tab-indicator" data-part="tab-indicator" aria-hidden="true"></span>' : '');
  $('tabs').innerHTML = typeof renderThemeTabBar === 'function'
    ? renderThemeTabBar(tabs.map(t => ({ key: t.key, label: t.label, active: t.key === current })), stockTabs)
    : stockTabs;
  const tabList = $('tabs');
  const tabButtons = tabList.querySelectorAll('button');
  tabButtons.forEach(b => {
    b.onclick = () => { location.hash = encodeURIComponent(id) + '/' + b.dataset.key; };
    b.onfocus = () => moveTabIndicator(b);
  });
  tabList.onfocusout = () => requestAnimationFrame(() => restoreTabIndicator());
  requestAnimationFrame(() => restoreTabIndicator(true));
}

function syncMountedThemeSlots() {
  if (hasRunSnapshot()) renderList();
  if ($('tabs') && !$('tabs').hidden && lastRenderedRunTabs) {
    paintRunTabButtons(lastRenderedRunTabs.id, lastRenderedRunTabs.tabs, lastRenderedRunTabs.current);
  }
  if ($('empty') && !$('empty').hidden && typeof renderEmptyStateSlot === 'function') {
    renderEmptyStateSlot($('empty'), loadingRunId
      ? { kind: 'no-run', message: 'Loading run…', hasDiff: false, runId: loadingRunId }
      : { kind: 'no-run', message: 'Select a run', hasDiff: false, runId: null });
  }
  if ($('content') && !$('content').hidden && lastEmptySlotData && typeof renderEmptyStateSlot === 'function') {
    const emptyNode = $('content').querySelector?.('#empty');
    if (emptyNode) renderEmptyStateSlot(emptyNode, lastEmptySlotData);
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('orc-theme-painted', syncMountedThemeSlots);
  window.addEventListener('orc-plugins-changed', syncMountedThemeSlots);
}

// TESTABLE: artifact scroll/load policy
function artifactShouldRestoreScroll(previousRequestedKey, nextKey) {
  // null only exists on a full document load, when session-scoped restoration
  // is intentional. Every in-app key transition, including history, resets.
  return previousRequestedKey === null || previousRequestedKey === nextKey;
}

// END TESTABLE: artifact scroll/load policy

// TESTABLE: artifact reload policy
// Pages this run synthesizes as its own gate/step pages — mirrors serve.py's
// GATE_SYNTH keys. Their rendered bytes are status-templated server-side (a
// relabeled delivery button, say), so a same-size phase/status flip can still
// mean changed bytes there with no cheaper signal than phase/status itself.
// Every other tab's bytes only ever change with its reported size.
const LIVE_GATE_PAGES = new Set([
  'clarification/clarification.html', 'grilling.html', 'plan.html', 'mvp/mvp.html',
  'review.html', 'audit.html', 'build-review.html', 'qa-review.html',
  'recap/recap.html', 'present/present.html', 'ship/ship.html',
  'pr-comments.html',
]);

// `renderedSettled` is what the loaded page was rendered under (doneSettled at
// load time) and `settled` is the run now. A merged run keeps status=merged
// while its session wraps up, so the Ship page's merge band flips from the
// authored gate band to the merge summary with no phase/status change to see:
// only that settled edge, which can also arrive from the clock alone.
function artifactTabNeedsReload(prevSize, nextSize, prevMeta, nextMeta, tabKey,
  renderedSettled, settled) {
  if (prevSize !== nextSize) return true;
  if (!LIVE_GATE_PAGES.has(tabKey)) return false;
  const prev = prevMeta || {};
  const next = nextMeta || {};
  if (prev.phase !== next.phase || prev.status !== next.status) return true;
  if (prev.mergeQueued !== next.mergeQueued
    || prev.mergeCheckoutWait !== next.mergeCheckoutWait
    || prev.mergeConflict?.resolutionPending !== next.mergeConflict?.resolutionPending
    || prev.mergeWaitingOn?.runId !== next.mergeWaitingOn?.runId
    || prev.shipAction !== next.shipAction) return true;
  return renderedSettled !== undefined && settled !== undefined && renderedSettled !== settled;
}
// END TESTABLE: artifact reload policy

function requestArtifactLoad(run, key) {
  const loadKey = run.id + '/' + key;
  const restoreScroll = artifactShouldRestoreScroll(requestedArtifactKey, loadKey);
  currentArtifactLoad?.iframeAbortController?.abort();
  const load = {
    key: loadKey,
    scrollTop: restoreScroll ? readScroll(loadKey) : 0,
    resetStoredScroll: !restoreScroll,
    mergeSettled: doneSettled(run.meta || {}),
  };
  setRequestedArtifactKey(loadKey);
  setCurrentArtifactLoad(load);
  // Remove the outgoing offset synchronously. The rendered owner remains the
  // old key until a guarded DOM commit, so this reset cannot save under the
  // destination key while its response is still in flight.
  if (!restoreScroll) $('content').scrollTop = 0;
  if (!restoreScroll) $('content-shell').scrollTop = 0;
  loadFile(run, key, load);
}

// markdown/text tabs scroll #content itself; html tabs scroll inside the
// iframe (saved separately in loadFile), so skip those here.
$('content').addEventListener('scroll', () => {
  if (!artifactPageUnloading && renderedArtifactKey && renderedArtifactKey === requestedArtifactKey
      && !$('content').querySelector('iframe')) {
    currentArtifactLoad.scrollTop = $('content').scrollTop;
    saveScroll(renderedArtifactKey, currentArtifactLoad.scrollTop);
  }
}, { passive: true });

// A run in a group names the others beside it: each by its repository, or
// by its step when the group builds in one, with its PR once it has one, or
// that it waits. The plan heading the group is not one of them; its steps
// panel lists the group instead.
export function runGroupLineHtml(id, meta) {
  const group = runGroupOf(meta);
  if (!group || !group.members.some(member => member.runId === id)) return '';
  const others = group.members.filter(member => member.runId !== id);
  if (!others.length) return '';
  const byStep = group.plan && group.repos < 2;
  const items = others.map(member => {
    const label = esc((byStep && Number.isInteger(member.step) ? `step ${member.step}` : member.repo) || member.title || 'run');
    const name = member.runId
      ? `<a href="#${encodeURIComponent(member.runId)}" title="${esc(member.title)}">${label}</a>`
      : `<span title="${esc(member.title)}">${label}</span>`;
    const extra = member.prUrl
      ? ` <a class="run-group-pr" href="${esc(member.prUrl)}" target="_blank" rel="noopener" aria-label="${label} PR">PR</a>`
      : member.state === 'waiting' ? ' <span class="run-group-wait">waiting</span>' : '';
    return `<span class="run-group-member">${name}${extra}</span>`;
  });
  return `<span class="run-group-line" data-part="run-group-line">With ${items.join('<span aria-hidden="true"> · </span>')}</span>`;
}

bindRunNavigation(openRun);
