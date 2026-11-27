import { $, LABELS, esc, externalizeLinks, highlightSeverity, resolveRelativeUrls, runState, runs, stateText, styleTldrs, versionedFileUrl } from './core.js';
import { artifactHtml } from './diff.js';

// An evals parent's side panel view: each candidate's child run and where it
// is now, read live from the run list, then the report in the space the
// status held. Old #<run>/__evals__ links open it.
export const EVALS_KEY = '__evals__';
export const EVALS_REPORT = 'evals-report.md';

export function evalsCandidatesHtml(meta, runList) {
  const evals = meta.evals || {};
  const byIndex = new Map((evals.children || []).map(child => [child.index, child]));
  const rows = (evals.candidates || []).map(candidate => {
    const child = byIndex.get(candidate.index) || {};
    const run = child.childRunId && runList.find(entry => entry.id === child.childRunId);
    // The report names the child's recorded status, so the table does too.
    const state = child.state === 'failed' ? { key: 'cancelled', label: 'Launch failed', detail: child.error || '' }
      : run ? { ...runState(run.meta, run.files), detail: run.meta?.status || '' }
      : { key: 'working', label: 'Starting', detail: '' };
    const name = run ? `<a href="#${encodeURIComponent(run.id)}">${esc(run.meta?.title || run.id)}</a>`
      : `<span>${esc(child.childRunId || 'Not started yet')}</span>`;
    const phase = run?.meta?.phase ? esc(run.meta.phase) : '—';
    // The shared prompt heads the table; a candidate given another shows its own.
    const ownPrompt = candidate.prompt ? `<span class="evals-detail evals-own-prompt" title="${esc(candidate.prompt)}">${esc(candidate.prompt)}</span>` : '';
    return `<tr><th scope="row">${esc(candidate.label || child.label || '')}${ownPrompt}</th><td>${name}</td>`
      + `<td>${phase}</td><td><span class="state-tag state-${state.key}">${esc(stateText(state))}</span>`
      + `${state.detail ? ` <span class="evals-detail">${esc(state.detail)}</span>` : ''}</td></tr>`;
  }).join('');
  return `<section class="evals-panel" aria-labelledby="evals-panel-title">
    <h2 id="evals-panel-title">Candidates</h2>
    <p class="evals-prompt">${esc(evals.prompt || '')}</p>
    <table class="evals-table"><thead><tr><th scope="col">Candidate</th><th scope="col">Run</th>`
    + `<th scope="col">Phase</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

export function evalsWaitingHtml(evals = {}) {
  const total = (evals.candidates || []).length;
  const settled = (evals.children || []).filter(child => child.settledAt || child.state === 'failed').length;
  const [title, detail] = evals.reportRequestedAt
    ? ['Writing the comparison report', 'Every candidate has settled. The report appears here when it is ready.']
    : ['Running candidates', `${settled} of ${total} settled. The comparison report appears here once all have.`];
  return `<div class="evals-waiting" role="status">
    <p class="evals-waiting-title"><span class="evals-spinner" aria-hidden="true"></span>${esc(title)}</p>
    <p class="evals-note">${esc(detail)}</p>
    <div class="evals-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
  </div>`;
}

// A report's Diff size cell ("5 files, +2 / -9") as a file count and coloured
// line counts. Any other wording returns null and stays as written.
const FILE_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 1.75h5l3.25 3.25v9.25H4z"/><path d="M9 1.75V5h3.25"/></svg>';
export function evalsDiffHtml(text) {
  const match = /^(\d+) files?,?\s*\+(\d+)\s*\/?\s*[-−–](\d+)$/.exec(String(text).trim());
  if (!match) return null;
  const [, files, added, removed] = match;
  const label = `${files} ${files === '1' ? 'file' : 'files'} changed, ${added} added, ${removed} removed`;
  return `<span class="evals-diff" role="img" aria-label="${label}" title="${label}">${FILE_ICON}${files}`
    + ` <span class="diff-stat-add">+${added}</span> <span class="diff-stat-del">−${removed}</span></span>`;
}

// A report's Checks cell ("4/4 passed", "0/1") as a tick when every check that
// ran passed, else a cross, beside the count. Other wording returns null.
const TICK_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.25 3.25L13 4.75"/></svg>';
const CROSS_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
export function evalsChecksHtml(text) {
  const match = /^(\d+)\s*\/\s*(\d+)(?:\s+pass(?:ed|ing)?)?$/i.exec(String(text).trim());
  if (!match) return null;
  const [passed, ran] = [Number(match[1]), Number(match[2])];
  const ok = ran > 0 && passed === ran;
  const label = `${passed} of ${ran} ${ran === 1 ? 'check' : 'checks'} passed`;
  return `<span class="evals-checks evals-checks-${ok ? 'pass' : 'fail'}" role="img" aria-label="${label}" title="${label}">`
    + `${ok ? TICK_ICON : CROSS_ICON}${passed}/${ran}</span>`;
}

export const hasEvals = run => run?.meta?.route === 'evals';

// The candidates table and the report repaint apart: a poll that changes one
// child's status leaves the rendered report, and the reader's place in it, alone.
const EVALS_FIGURES = new Set(['checks', 'diff size', 'time', 'tokens', 'cost', 'score']);
const EVALS_COMPACT = { checks: evalsChecksHtml, 'diff size': evalsDiffHtml };
let evalsPanelSequence = 0;
export async function showEvalsPanel(run) {
  const host = $('run-evals-body');
  let page = host.firstElementChild;
  if (page?.dataset.run !== run.id) {
    host.innerHTML = '<div class="md evals-page"><div></div><div class="evals-report"></div></div>';
    page = host.firstElementChild;
    page.dataset.run = run.id;
    host.scrollTop = 0;
  }
  const [live, body] = page.children;
  const table = evalsCandidatesHtml(run.meta || {}, runs);
  if (live.dataset.html !== table) live.innerHTML = live.dataset.html = table;
  const published = run.files.some(file => file.path === EVALS_REPORT);
  const url = published ? versionedFileUrl(run.id, EVALS_REPORT) : '';
  if (body.dataset.url === url && body.dataset.settled) return;
  body.dataset.url = url;
  delete body.dataset.settled;
  if (!published) { body.innerHTML = evalsWaitingHtml(run.meta?.evals); return; }
  const sequence = ++evalsPanelSequence;
  const report = await fetch(url).then(response => response.ok ? response.text() : null).catch(() => null);
  if (sequence !== evalsPanelSequence || !body.isConnected) return;
  if (report === null || typeof marked === 'undefined') {
    // Left unsettled, so the next poll asks again.
    body.innerHTML = `<p role="status">Couldn't load the ${esc(LABELS[EVALS_REPORT])}. Trying again…</p>`;
    return;
  }
  body.dataset.settled = '1';
  body.innerHTML = artifactHtml(report);
  resolveRelativeUrls(body, run.id, EVALS_REPORT);
  externalizeLinks(body);
  highlightSeverity(body);
  styleTldrs(body);
  window.orcUpgradeCallouts?.(body);
  window.orcMountCodeCopy?.(body);
  for (const head of body.querySelectorAll('thead th')) {
    const name = head.textContent.trim().toLowerCase();
    if (!EVALS_FIGURES.has(name)) continue;
    for (const row of head.closest('table').tBodies[0]?.rows || []) {
      const cell = row.cells[head.cellIndex];
      if (!cell) continue;
      cell.classList.add('evals-figure');
      const compact = EVALS_COMPACT[name]?.(cell.textContent);
      if (compact) cell.innerHTML = compact;
    }
  }
}

const FINISHED = ['complete', 'merged', 'merged-to-parent', 'cancelled'];

// Merging one candidate picks it. Null unless `runId` is a candidate of an
// eval here with other candidates still open.
export function evalsPickOffer(runId, runList) {
  const parent = runList.find(run => run.meta?.route === 'evals' && run.meta.remote !== true
    && (run.meta.evals?.children || []).some(child => child.childRunId === runId));
  if (!parent) return null;
  const candidates = parent.meta.evals.children.flatMap(child => {
    const run = runList.find(entry => entry.id === child.childRunId);
    return run ? [{ id: run.id, label: child.label || run.meta?.title || run.id, meta: run.meta || {} }] : [];
  });
  const strip = ({ id, label }) => ({ id, label });
  const winner = candidates.find(candidate => candidate.id === runId);
  const others = candidates.filter(candidate => candidate.id !== runId
    && !FINISHED.includes(candidate.meta.status) && candidate.meta.remote !== true);
  if (!winner || !others.length) return null;
  return { winner: strip(winner), others: others.map(strip),
    reason: `${winner.label} was picked instead (${winner.id})`.slice(0, 500) };
}

export function evalsPickOfferHtml(offer) {
  const one = offer.others.length === 1;
  return `<p>You merged <strong>${esc(offer.winner.label)}</strong>. ${one ? 'This candidate is' : 'These candidates are'} still open:</p>
    <ul class="evals-pick-others">${offer.others.map(other => `<li><a href="#${encodeURIComponent(other.id)}">${esc(other.label)}</a></li>`).join('')}</ul>
    <p class="settings-hint">Cancelling records the reason "${esc(offer.reason)}" on ${one ? 'it' : 'each'}.</p>`;
}
