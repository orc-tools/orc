// orc-ui: records the first view of a finished planning session and opens its plan.

import { announce } from './core.js';
import { PLANNING_PAGE } from './answer-mode.js';
import { isPlanRevealPending, isPlanTabHidden, opensOnPlan } from './run-presentation.js';

// Reveals recorded in this window, so a failed record or a poll that predates
// it never hides the tab again.
const revealedHere = new Map();

export function revealedMeta(run) {
  const meta = run.meta || {};
  const revealedAt = revealedHere.get(run.id);
  return revealedAt && isPlanTabHidden(meta)
    ? { ...meta, planReveal: { ...meta.planReveal, revealedAt } } : meta;
}

// Marks the plan seen immediately so the Plan tab renders on the first paint,
// and records the reveal on the server in the background.
export function recordPlanReveal(run) {
  if (!run || !isPlanRevealPending(revealedMeta(run))) return false;
  revealedHere.set(run.id, new Date().toISOString());
  fetch('/runs/' + encodeURIComponent(run.id) + '/plan-reveal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
    .then(response => response.ok ? response.json() : null)
    .catch(() => null)
    .then(reply => {
      if (reply?.revealedAt) revealedHere.set(run.id, reply.revealedAt);
      else if (!reply) announce("Couldn't save that the plan was revealed.");
    });
  return true;
}

export function revealPlan(run) {
  recordPlanReveal(run);
  location.hash = encodeURIComponent(run.id) + '/' + PLANNING_PAGE;
}

// A finished plan nobody has opened yet, here or on another device.
export const planUnseen = run => !!run && isPlanRevealPending(revealedMeta(run));

// The tab a run opens on when it is opened without naming one, the run already
// open included: its plan until work from the plan has started.
export function landingTab(run) {
  return run && opensOnPlan(revealedMeta(run)) ? PLANNING_PAGE : null;
}
