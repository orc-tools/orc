// orc-ui: Start work on a plan, shown the moment it is pressed. The host takes
// a few seconds to launch the build run, and more before the run list carries
// it. Until then the plan holds a launch row of its own in its listed meta,
// like the one the host writes while it launches (ui/serve.py
// _planning_fork), so the plan reads Starting in the sidebar and on its page
// (planStartingSince in run-presentation.js, planStepStates in
// plan-page.js). The hold ends when the build run is listed, when the launch
// fails, or a while after the host accepted it, if its run never shows.
import { reflectRunChange } from './panel-navigation.js';
import { runs, setRuns } from './core.js';

// After the host answered with its run, and while it has not answered.
const PLAN_START_LISTED_MS = 20000;
const PLAN_START_ANSWER_MS = 2 * 60 * 1000;
const planStartHolds = new Map();

// The step a launch row builds; 0 is the whole plan, or a plan of one step.
const planLaunchKey = row => (Number.isInteger(row?.planStep) ? row.planStep : 0);
const planLaunchRows = meta => (Array.isArray(meta?.relationshipChildren) ? meta.relationshipChildren : [])
  .filter(row => row && row.mode !== 'orc-plan-session');

// The hold ends only once the plan's own rows carry the launch: a run listed
// before the plan's rows catch up would leave its step reading unstarted, with
// Start work offered again. A reply lost on the way still ends the hold once
// the host's row settles.
function planStartEnded(hold, meta, listed) {
  return planLaunchRows(meta).some(row => row.state === 'failed'
    ? row.launchToken && !hold.known.has(row.launchToken) && planLaunchKey(row) === hold.key
    : row.state === 'launched' && !!row.childRunId && listed.has(row.childRunId)
      && (row.childRunId === hold.childRunId
        || (row.launchToken && !hold.known.has(row.launchToken) && planLaunchKey(row) === hold.key)));
}

const planWithoutHeld = run => (run.meta?.relationshipChildren || []).some(row => row?.held)
  ? { ...run, meta: { ...run.meta, relationshipChildren: run.meta.relationshipChildren.filter(row => !row?.held) } }
  : run;

// `list` as the host sent it, with each plan's Start work still held.
export function holdPlanStarts(list) {
  if (!planStartHolds.size) return list;
  const listed = new Set(list.map(run => run.id));
  return list.map(run => {
    const held = planStartHolds.get(run.id);
    if (!held) return run;
    const live = held.filter(hold => {
      if (!planStartEnded(hold, run.meta, listed)) return true;
      clearTimeout(hold.timer);
      return false;
    });
    if (!live.length) {
      planStartHolds.delete(run.id);
      return run;
    }
    planStartHolds.set(run.id, live);
    const rows = Array.isArray(run.meta?.relationshipChildren) ? run.meta.relationshipChildren : [];
    return { ...run, meta: { ...run.meta, relationshipChildren: [...rows, ...live.map(hold => hold.row)] } };
  });
}

function planStartRedraw(planId) {
  setRuns(holdPlanStarts(runs.map(planWithoutHeld)));
  reflectRunChange(planId);
}

function planStartRelease(planId, hold) {
  const held = planStartHolds.get(planId);
  if (!held?.includes(hold)) return;
  clearTimeout(hold.timer);
  const rest = held.filter(entry => entry !== hold);
  if (rest.length) planStartHolds.set(planId, rest);
  else planStartHolds.delete(planId);
  planStartRedraw(planId);
}

// Start work was pressed for `step` (none for the whole plan, or a plan of one
// step). `whole` says the plan has several steps and this run builds them all.
export function holdPlanStart(planRun, { step = 0, whole = false } = {}) {
  const planId = planRun.id;
  // The launches listed now, which may be newer than the caller's copy.
  const listed = runs.find(run => run.id === planId) || planRun;
  const hold = {
    key: step || 0,
    known: new Set(planLaunchRows(listed.meta).map(row => row.launchToken).filter(Boolean)),
    childRunId: '',
    row: { state: 'launching', mode: 'orc', held: true, requestedAt: new Date().toISOString(),
      ...(step ? { planStep: step } : whole ? { planWhole: true } : {}) },
  };
  hold.timer = setTimeout(() => planStartRelease(planId, hold), PLAN_START_ANSWER_MS);
  planStartHolds.set(planId, [...(planStartHolds.get(planId) || []), hold]);
  planStartRedraw(planId);
  return hold;
}

// The host launched `childRunId`; the hold stays until the run list has it.
export function planStartAccepted(planId, hold, childRunId) {
  if (!planStartHolds.get(planId)?.includes(hold)) return;
  hold.childRunId = childRunId || '';
  clearTimeout(hold.timer);
  hold.timer = setTimeout(() => planStartRelease(planId, hold), PLAN_START_LISTED_MS);
  planStartRedraw(planId);
}

// The host refused the launch or could not be reached: the plan is as it was.
export const planStartFailed = (planId, hold) => planStartRelease(planId, hold);
