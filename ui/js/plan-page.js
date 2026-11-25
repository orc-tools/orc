// orc-ui: the plan page, which a finished planning session opens on
// (#<run>/planning/planning.html), and the same plan in the Plan tab of a
// run it started. The document reads down one column: destination, the work,
// then the record behind it. The plan's steps sit beside it with each step's
// run, or Start for a step that has none. Everything shown is read from
// planning/planning.mdx. A planning session's plan
// (skills/_shared/planning-session.md) lists its runs under `## Work`; a plan
// run's (skills/orc-plan/SKILL.md) says what will change, shows a mockup,
// and names what Orc assumed and left out. A plan with no `## Work` is one step.
import { refresh } from './activity.js';
import { harnessMark } from './agent-marks.js';
import { PLANNING_PAGE } from './answer-mode.js';
import { CHAT_KEY, announce, dotHtml, esc, externalizeLinks, fileUrl, mediaSignature, resolveRelativeUrls, runs } from './core.js';
import { markdownHtml, stripFrontMatter } from './diff.js';
import { mountPlanBuilds } from './plan-builds.js';
import { mountPlanNotes } from './plan-notes.js';
import { reportSeen } from './chat.js';
import { runModelLabel } from './launch-options.js';
import { holdPlanStart, planStartAccepted, planStartFailed } from './plan-starts.js';
import { compactAge, projectMonogramHtml } from './filters.js';
import { groupWaitLabel, isPlanningClosed, isPlanningComplete, pairedBuildOf, planOf, presentRun } from './run-presentation.js';

export const PLAN_SOURCE = 'planning/planning.mdx';

// Plugins add their own controls beside Copy plan (the Tailscale plugin's
// Share plan). A renderer runs after every paint with the plan run, the
// layout, the `.plan-tools` row and the `.plan-work` card; it owns what it
// adds, marking each node `data-plan-extension="<id>"` with the id it
// registered under, so unregistering removes its nodes and nobody else's.
const planToolRenderers = new Set();
const planViews = new Set();
export function extendPlanTools(id, render) {
  planToolRenderers.add(render);
  for (const view of planViews) if (view.model) planRunExtensions(view, view.planRun);
  return () => {
    planToolRenderers.delete(render);
    document.querySelectorAll(`[data-plan-extension="${CSS.escape(id)}"]`).forEach(node => node.remove());
  };
}

function planRunExtensions(view, planRun) {
  const tools = view.root.querySelector('.plan-tools');
  const work = view.root.querySelector('.plan-work');
  if (!tools || !work) return;
  for (const render of planToolRenderers) {
    try {
      render({ runId: planRun.id, meta: planRun.meta || {}, layout: view.layout, own: view.viewerId === planRun.id, tools, work });
    } catch (error) {
      console.error('plan tools extension', error);
    }
  }
}

const PLAN_SECTION_KEYS = {
  destination: 'destination', work: 'work', 'decisions so far': 'decisions', decisions: 'decisions',
  'not yet specified': 'open', 'out of scope': 'out', findings: 'findings', glossary: 'glossary',
  'decisions worth recording': 'recorded',
  // The four parts of a plan run's plan (ui/plan_check.py names the same).
  'what will change': 'change', mockup: 'mockup', mockups: 'mockup',
  'what orc assumed': 'assumed', assumptions: 'assumed', 'left out': 'out', 'what it leaves out': 'out',
};
// What a reader with ten seconds needs comes first: the work, anything still
// open, the trade-offs, what is left out. The record follows.
const PLAN_READING_ORDER = ['change', 'mockup', 'work', 'open', 'recorded', 'assumed', 'out', 'decisions', 'findings', 'other', 'glossary'];
const PLAN_CHECK_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';

// ---------- pure helpers (tests/test-plan-page.js runs them) ----------

export function planOutline(source) {
  const outline = { title: '', sections: [] };
  let section = { key: 'intro', title: '', rows: [] };
  let fence = '';
  const seen = new Set();
  for (const row of String(source || '').replace(/\r\n?/g, '\n').split('\n')) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(row)?.[1][0] || '';
    if (mark && (!fence || fence === mark)) fence = fence ? '' : mark;
    else if (!fence) {
      const top = /^#\s+(.+?)\s*#*\s*$/.exec(row);
      if (top && !outline.title && section.key === 'intro' && !section.rows.some(text => text.trim())) {
        outline.title = planPlain(top[1]);
        continue;
      }
      const heading = /^##\s+(.+?)\s*#*\s*$/.exec(row);
      if (heading) {
        outline.sections.push(section);
        const known = PLAN_SECTION_KEYS[heading[1].trim().toLowerCase()];
        section = { key: known && !seen.has(known) ? known : 'other', title: heading[1].trim(), rows: [] };
        seen.add(section.key);
        continue;
      }
    }
    section.rows.push(row);
  }
  outline.sections.push(section);
  outline.sections = outline.sections
    .map(({ key, title, rows }) => ({ key, title, body: rows.join('\n').trim() }))
    .filter(entry => entry.key !== 'intro' || entry.body);
  return outline;
}

// Nothing written, or only a word that says so.
export const planSectionEmpty = body => /^\s*(?:none|nothing)?\.?\s*$/i.test(String(body || '').replace(/[_*]/g, ''));

export function planPlain(text) {
  return String(text || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`|~~)/g, '')
    .replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,;:!?]|$)/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

// Text around the Work list is kept, since the page shows every word the plan
// wrote.
export function planWork(body) {
  const before = [];
  const after = [];
  const items = [];
  const place = row => (where === 'list' ? items.at(-1).push(row.replace(/^ {1,4}/, ''))
    : (where === 'before' ? before : after).push(row));
  let where = 'before';
  let gap = false;
  let fence = '';
  for (const row of String(body || '').split('\n')) {
    const open = !!fence;
    const mark = /^\s*(`{3,}|~{3,})/.exec(row)?.[1][0] || '';
    if (mark && (!fence || fence === mark)) fence = fence ? '' : mark;
    if (open) {
      // Inside a code block nothing is a step; it stays with what it is in.
      place(row);
      gap = false;
      continue;
    }
    const item = where === 'after' ? null : /^ {0,3}\d{1,3}[.)]\s+(\S.*)$/.exec(row);
    if (item) {
      items.push([item[1]]);
      where = 'list';
      gap = false;
    } else if (where === 'before') {
      before.push(row);
    } else if (where === 'list' && !row.trim()) {
      items.at(-1).push('');
      gap = true;
    } else if (where === 'list' && (!gap || /^\s{2,}\S/.test(row))) {
      // An indented line belongs to its item; so does one that follows on
      // without a blank line.
      place(row);
      gap = false;
    } else {
      where = 'after';
      after.push(row);
    }
  }
  return {
    before: before.join('\n').trim(),
    after: after.join('\n').trim(),
    steps: items.map((rows, at) => {
      const text = rows.join('\n').trim();
      return { title: planStepTitle(text), body: text, ...planStepPlace(text, at + 1) };
    }),
  };
}

// The repository a step builds in, a code span in brackets on its first line
// as `**Export worker** (`serverless`).`, and the earlier steps it waits on,
// as `Waits on step 1.` The server reads the same (ui/plan_steps.py).
const PLAN_STEP_REPO = /\s*\(\s*`([^`\n]+)`\s*\)/;
const PLAN_STEP_WAITS = /\bwaits?\s+(?:on|for)\s+steps?\s+(\d{1,3}(?:(?:\s*,\s*|\s*,?\s+and\s+)\d{1,3})*)/gi;

export function planStepPlace(text, number) {
  const first = String(text || '').split('\n')[0];
  const repo = PLAN_STEP_REPO.exec(first)?.[1].trim() || '';
  const waitsOn = [];
  for (const match of planPlain(String(text || '').replace(/\n/g, ' ')).matchAll(PLAN_STEP_WAITS)) {
    for (const digits of match[1].match(/\d+/g)) {
      const wait = Number(digits);
      if (wait >= 1 && wait < number && !waitsOn.includes(wait)) waitsOn.push(wait);
    }
  }
  return { repo, waitsOn };
}

// A step is named by its leading bold run, or by its first sentence.
export function planStepTitle(text) {
  const first = String(text || '').split('\n')[0].replace(PLAN_STEP_REPO, '');
  const bold = /^\*\*(.+?)\*\*/.exec(first);
  if (bold) return planPlain(bold[1]).replace(/[.:,;]+$/, '');
  const plain = planPlain(first);
  const stop = plain.search(/[.:](?:\s|$)/);
  const name = stop > 0 ? plain.slice(0, stop) : plain;
  return name.length > 90 ? `${name.slice(0, 89).replace(/\s+\S*$/, '')}…` : name;
}

export function planModel(source) {
  const outline = planOutline(source);
  const find = key => outline.sections.find(entry => entry.key === key);
  const work = planWork(find('work')?.body);
  const sections = PLAN_READING_ORDER.flatMap(key => outline.sections.filter(entry => entry.key === key))
    .filter(entry => (entry.key === 'work' ? work.steps.length || work.before : !planSectionEmpty(entry.body)));
  return {
    title: outline.title,
    intro: find('intro')?.body || '',
    destination: find('destination')?.body || '',
    sections,
    work,
    // A plan with no Work list is built by one run.
    steps: work.steps.length ? work.steps : [{ title: '', body: '', implied: true }],
  };
}

// `rows` are the plan run's relationshipChildren. A row that builds the whole
// plan belongs to every step; one with no step belongs to a one-step plan's
// step, or is listed apart. A row still launching, the host's or the one
// Start work holds (plan-starts.js), keeps its step Starting.
export function planStepStates(steps, rows, findRun) {
  const launches = (Array.isArray(rows) ? rows : [])
    .filter(row => row && row.mode !== 'orc-plan-session' && (row.childRunId || row.state !== 'launched'));
  const states = steps.map((step, index) => ({ ...step, number: index + 1, runs: [], state: 'todo', error: '' }));
  const loose = [];
  let wholeError = '';
  let wholeLaunching = false;
  for (const row of launches) {
    const run = row.childRunId ? findRun(row.childRunId) : null;
    const entry = { id: row.childRunId || '', run, launch: row.state, error: row.error || '', at: row.requestedAt || '',
      waitsOn: Array.isArray(row.waitsOn) ? row.waitsOn : [],
      // A stacked step builds on the branch of the steps it waits on.
      stackedOn: Array.isArray(row.stackedOn) ? row.stackedOn : [] };
    const number = Number.isInteger(row.planStep) ? row.planStep : states.length === 1 ? 1 : 0;
    // A whole-plan launch that failed is told once, above the steps.
    if (row.planWhole === true && row.state === 'failed') wholeError = row.error || ' ';
    else if (row.planWhole === true) {
      wholeLaunching ||= row.state === 'launching';
      states.forEach(step => step.runs.push(entry));
    }
    else if (number >= 1 && number <= states.length) states[number - 1].runs.push(entry);
    else if (run) loose.push(entry);
  }
  for (const step of states) {
    step.runs.sort((a, b) => a.at.localeCompare(b.at));
    const live = step.runs.filter(entry => entry.launch === 'launching'
      || (entry.launch === 'launched' && entry.run && entry.run.meta?.status !== 'cancelled'));
    const last = step.runs.at(-1);
    if (live.some(entry => entry.launch === 'launching')) step.state = 'starting';
    else if (live.length) step.state = live.every(entry => presentRun(entry.run).state.key === 'done') ? 'done' : 'active';
    // A step that waits on another starts by itself once that run reaches Ship.
    else if (last?.launch === 'waiting') { step.state = 'waiting'; step.waitsOn = last.waitsOn; }
    else if (last?.launch === 'failed') { step.state = 'failed'; step.error = last.error; }
    // Only runs that still stand for the step are listed under it.
    step.runs = live.filter(entry => entry.run);
  }
  // Until one step starts, the whole plan is the next thing to start.
  const fresh = states.length > 1 && states.every(step => step.state === 'todo' || step.state === 'failed');
  const next = !fresh && states.find(step => step.state === 'todo' || step.state === 'failed');
  if (next) next.next = true;
  // A run for the whole plan on its way shows once, where its Start was.
  const wholeStarting = wholeLaunching && states.every(step => step.state === 'starting');
  return { steps: states, loose, whole: fresh, wholeError: fresh ? wholeError : '', wholeStarting };
}

export function planProgress(steps) {
  const total = steps.length;
  // A plan that opened one run per repository counts runs, as its group does.
  if (total > 1 && steps.some(step => step.repo)) {
    const count = key => steps.filter(step => step.state === key).length;
    const [working, waiting, done] = [count('active'), count('waiting'), count('done')];
    if (working || waiting || done) {
      return [`${working} of ${total} runs working`, done && `${done} done`, waiting && `${waiting} waiting`]
        .filter(Boolean).join(' · ');
    }
  }
  const started = steps.filter(step => !['todo', 'failed'].includes(step.state)).length;
  const done = steps.filter(step => step.state === 'done').length;
  // Until a first run is listed, starting is all that is happening.
  if (started && steps.every(step => ['todo', 'failed', 'starting'].includes(step.state))) return 'Starting work';
  if (total === 1) return done ? 'Work done' : started ? 'Work started' : 'Ready to start';
  if (!started) return `${total} steps, none started`;
  if (done === total) return `All ${total} steps done`;
  if (started === total) return `All ${total} steps started`;
  return `${started} of ${total} steps started`;
}

// ---------- rendering ----------

function planMarkdown(text) {
  return text ? markdownHtml(text) : '';
}

function planRunLine(entry, here, view = null, steps = []) {
  if (here) return '<p class="plan-step-here">This run</p>';
  const shown = presentRun(entry.run).state;
  const title = entry.run.meta?.title || entry.id;
  const call = planChatCall(shown);
  const merge = view && call?.merge ? planMergeHtml(entry, view, steps) : '';
  // Until then, a stacked step says whose branch it builds on.
  const below = !merge && planMergeHold(entry, steps);
  const stacked = below ? `<p class="plan-step-hold">Builds on step ${below}'s branch</p>` : '';
  return `<a class="plan-step-run" href="#${encodeURIComponent(entry.id)}">${dotHtml(entry.run.meta || {})}<span class="plan-step-run-state">${esc(shown.label)}</span><span class="plan-step-run-title" title="${esc(title)}">${esc(title)}</span></a>${merge || (call ? planChatButtonHtml(call, entry.id, 'size="compact"') : '')}${stacked}`;
}

const planStepMerged = step => !!step?.runs.some(entry => ['merged', 'merged-to-parent'].includes(entry.run?.meta?.status));

// A step's run at Ship merges from the plan page, in stack order: a step
// stacked on another waits until that one merges. The host's merge checks
// still decide (/api/merge-candidates), and Chat keeps the full Ship bar.
export function planMergeHold(entry, steps) {
  return (entry.stackedOn || []).find(number => !planStepMerged(steps[number - 1])) || 0;
}

function planMergeHtml(entry, view, steps) {
  const held = planMergeHold(entry, steps);
  const state = view.merging.get(entry.id);
  const name = esc(entry.run.meta?.title || entry.id);
  if (held) {
    return `<orc-button variant="primary" size="compact" disabled>Merge<span class="sr-only"> ${name}</span></orc-button><p class="plan-step-hold">Merges once step ${held} merges</p>`;
  }
  if (state?.pending) return `<orc-button variant="primary" size="compact" disabled data-plan-merging><span class="plan-start-ring" aria-hidden="true"></span>Merging…</orc-button>`;
  return `<orc-button variant="primary" size="compact" data-plan-merge="${esc(entry.id)}">Merge<span class="sr-only"> ${name}</span></orc-button>${state?.error ? `<p class="plan-step-error" role="alert">Could not merge${esc(planFailure(state.error))}</p>` : ''}`;
}

// When a run the plan started needs you, the plan page says so and points
// to Chat, where its merge, its PR and its questions live. The merge keeps
// its one home there, with its checks and its confirm. A run that is still
// working needs nothing from you, so it gets no call.
export function planChatCall(shown) {
  if (shown?.key === 'ready') {
    // A finished run reads Ready; its detail says how it delivers.
    const pr = shown.detail === 'Ready for PR';
    return {
      // Only a run that can merge now gets Merge; a queued one is on its way.
      tone: 'ready', title: 'Work done', label: shown.detail || shown.label, merge: shown.detail === 'Ready to merge',
      button: pr ? 'Go to Chat to open the PR' : 'Go to Chat to merge',
      text: pr ? 'The build is finished. Open its PR from Chat.' : 'The build is finished. Merge it from Chat.',
    };
  }
  if (shown?.key === 'blocked') {
    return {
      tone: 'ask', title: 'Building', label: shown.label, button: 'Go to Chat to answer',
      text: shown.label === 'Needs input' || /questions? for you$/.test(shown.label) ? 'The build has a question for you in Chat.' : 'The build needs you in Chat.',
    };
  }
  return null;
}

const planChatButtonHtml = (call, id, attrs = '') =>
  `<orc-button variant="primary" ${attrs} class="plan-chat-call" data-tone="${call.tone}" data-plan-open-chat="${esc(id)}">${esc(call.button)}<span class="plan-chat-arrow" aria-hidden="true">→</span></orc-button>`;

// The latest note the step's run sent or took, as its group shows it:
// who it asked or answered, what, and whether the answer is in.
function planNoteHtml(note) {
  if (!note?.peerLabel) return '';
  const out = note.direction === 'out';
  const verb = note.kind === 'tell' ? (out ? 'Told' : 'Told by')
    : out ? 'Asked' : note.answered ? 'Answered' : 'Asked by';
  const at = note.answered && note.answerAt ? new Date(note.answerAt) : null;
  const status = note.kind === 'tell' ? ''
    : out ? (note.answered ? 'answered' : 'waiting for an answer')
    : note.answered && at && !Number.isNaN(at.getTime()) ? `${compactAge(at)}${compactAge(at) === 'now' ? '' : ' ago'}` : note.answered ? '' : 'to answer';
  return `<p class="plan-step-talk">${verb} ${esc(note.peerLabel)}: <q>${esc(note.text || '')}</q>${status ? ` · <span class="plan-step-talk-state">${esc(status)}</span>` : ''}</p>`;
}

function planStepHtml(step, view, count, whole, wholeStarting, steps) {
  const single = count === 1;
  const name = step.title || 'this plan';
  // While Orc revises the plan its Starts stay in place, greyed out.
  const busy = view.posting !== null || view.revising;
  // While the whole plan is what starts, its one button is the only Start.
  const startable = (view.canStart || view.revising) && !whole && (step.state === 'todo' || step.state === 'failed');
  const label = single ? 'Start work' : `Start step ${step.number}`;
  // Once a step has started on its own, the next step carries the page's one
  // primary button, under its name, and a later step keeps a small Start for
  // work that can run alongside. That button names itself from its own text, so the step
  // rides along for a reader who cannot see which row it sits in.
  const primary = startable && step.next
    ? `<orc-button variant="primary" data-plan-start="${step.number}"${busy ? ' disabled' : ''}>${label}</orc-button>` : '';
  const aside = startable && !step.next
    ? `<orc-button variant="ghost" size="compact" data-plan-start="${step.number}"${busy ? ' disabled' : ''}>Start<span class="sr-only"> step ${step.number}: ${esc(name)}</span></orc-button>` : '';
  const head = step.implied ? ''
    : `<div class="plan-step-head"><button type="button" class="plan-step-name" data-plan-jump="${view.prefix}-step-${step.number}">${esc(name)}</button>${step.repo ? `<span class="plan-step-repo">${projectMonogramHtml(step.repo)}<span class="sr-only">in </span>${esc(step.repo)}</span>` : ''}${aside}</div>`;
  // A step that waits starts by itself once the run it waits on reaches Ship.
  const waiting = step.state === 'waiting'
    ? `<p class="plan-step-run plan-step-waiting"><span class="dot" data-state="waiting" aria-hidden="true"></span><span class="plan-step-run-state">${esc(groupWaitLabel(step, { steps: true }))}</span><span class="plan-step-run-title">starts by itself</span></p>` : '';
  const talk = step.runs.map(entry => planNoteHtml(entry.run?.meta?.runNote)).join('');
  const wait = step.state === 'starting' && !wholeStarting
    ? planStartingButton(single ? 'variant="primary"' : 'variant="ghost" size="compact"') : '';
  const failure = step.state === 'failed' || view.failures.has(step.number)
    ? `<p class="plan-step-error" role="alert">Could not start a run${esc(planFailure(view.failures.get(step.number) || step.error))}</p>` : '';
  const state = step.state === 'todo' && step.next ? 'next' : step.state;
  return `<li class="plan-step" data-state="${state}" data-plan-step="${step.number}">
    <span class="plan-step-mark" aria-hidden="true">${step.state === 'done' ? PLAN_CHECK_ICON : step.number}</span>
    <div class="plan-step-body">
      ${head}${step.runs.map(entry => planRunLine(entry, entry.id === view.viewerId, view, steps)).join('')}${talk}
      ${waiting}${wait}${failure}${primary}
    </div>
  </li>`;
}

// Where Start was pressed, until the run it launched is listed.
const planStartingButton = (attrs = 'variant="primary"') =>
  `<orc-button ${attrs} disabled data-plan-starting><span class="plan-start-ring" aria-hidden="true"></span>Starting…</orc-button>`;

const planFailure = reason => (reason ? `: ${String(reason).replace(/[.\s]+$/, '')}.` : '.');

// Once the build paired with the plan starts, the start panel says how it is
// going and what each part runs on, where Start work was. Notes on the plan
// go to the build's Chat from then on. Once the build is done or waiting on
// you, its quiet Open Chat becomes the call to go there.
function planBuildingHtml(build, planRun) {
  const agentOf = meta => harnessMark(meta.harness)?.[0] || 'Claude';
  const meta = build.meta || {};
  const shown = presentRun(build).state;
  const call = planChatCall(shown);
  return `<div class="plan-building"${call ? ` data-tone="${call.tone}"` : ''}>
    <h2 class="plan-work-title">${call ? call.title : 'Building'}</h2>
    <p class="plan-building-state">${dotHtml(meta)}<span class="plan-building-label">${esc(call?.label || shown.label)}</span><span class="plan-building-model">· ${esc(runModelLabel(meta, agentOf(meta)))}</span></p>
    <p class="plan-building-note">Planned with ${esc(runModelLabel(planRun.meta || {}, agentOf(planRun.meta || {})))}</p>
    ${call ? `<p class="plan-building-call">${esc(call.text)}</p>${planChatButtonHtml(call, build.id)}`
      : `<orc-button variant="ghost" size="compact" data-plan-open-chat="${esc(build.id)}">Open Chat</orc-button>`}
    <p class="plan-building-hint">Notes on the plan now go to Chat as a message, like any other reply.</p>
  </div>`;
}

function planWorkHtml(view, planRun) {
  const meta = planRun.meta || {};
  const { steps, loose, whole, wholeError, wholeStarting } = planStepStates(view.model.steps, meta.relationshipChildren,
    id => runs.find(candidate => candidate.id === id));
  const agent = harnessMark(meta.harness)?.[0] || 'Claude';
  const project = String(meta.mainRepoPath || meta.repoPath || '').split('/').filter(Boolean).pop();
  const offered = (view.canStart || view.revising) && steps.some(step => step.state === 'todo' || step.state === 'failed');
  // The Builds with row says what Start launches on. Until it has loaded,
  // a line names the agent the plan run used, which is what Start builds on.
  const chosen = offered && view.builds?.ready === true;
  // A one-step plan's build is the whole of its work; a longer plan keeps
  // its steps below, with Start for the ones no run has taken yet.
  // Only the build Start work launched shows how it is going; other runs
  // the plan started find themselves among its steps.
  const paired = pairedBuildOf(planRun, runs);
  const build = paired?.id === view.viewerId ? paired : null;
  const buildOnly = !!build && steps.length === 1;
  if (view.buildsHost) view.buildsHost.hidden = !chosen || buildOnly;
  const perRepo = steps.length > 1 && steps.some(step => step.repo);
  const opened = perRepo && steps.some(step => step.state !== 'todo' && step.state !== 'failed');
  const note = offered && !chosen && !opened
    ? (perRepo ? `<p class="plan-start-note">Start work opens one run per repository on ${esc(agent)}, each with its own PR. A step that waits starts by itself.</p>`
      : `<p class="plan-start-note">Start opens a change run${project ? ` in ${esc(project)}` : ''} on ${esc(agent)}, with this plan as its settled brief.${whole ? ' Start each step opens one per step, and a step that waits builds on the branch of the step it waits on.' : ''}</p>`)
    : meta.status === 'cancelled' ? '<p class="plan-start-note">This plan was cancelled, so it starts no more work.</p>'
    : opened ? '<p class="plan-start-note">Start work opened one run per repository. Each opens its own PR.</p>' : '';
  // Start work builds the whole plan in one run. Beside it, a quiet Start
  // each step opens one run per step, as a plan across repositories does.
  const held = view.posting !== null || view.revising ? ' disabled' : '';
  const each = !perRepo
    ? `<orc-button class="plan-start-each" variant="ghost" size="compact" data-plan-start-each${held}>Start each step</orc-button>` : '';
  const start = wholeStarting ? planStartingButton('class="plan-start-all" variant="primary"')
    : whole && (view.canStart || view.revising)
      ? `<div class="plan-start-row"><orc-button class="plan-start-all" variant="primary" data-plan-start="0"${held}>Start work</orc-button>${each}</div>` : '';
  const failure = whole && (view.failures.has(0) || wholeError)
    ? `<p class="plan-step-error" role="alert">Could not start a run${esc(planFailure((view.failures.get(0) || wholeError).trim()))}</p>` : '';
  const others = loose.length
    ? `<div class="plan-loose"><h3>Also started from this plan</h3>${loose.map(entry => planRunLine(entry, entry.id === view.viewerId)).join('')}</div>` : '';
  const building = build ? planBuildingHtml(build, planRun) : '';
  if (buildOnly) return building;
  return `${building}<h2 class="plan-work-title" tabindex="-1">${esc(planProgress(steps))}</h2>${start}${failure}
    <ol class="plan-steps" data-count="${steps.length}" aria-label="Steps">${steps.map(step => planStepHtml(step, view, steps.length, whole, wholeStarting, steps)).join('')}</ol>
    ${note}${others}`;
}

function planSectionHtml(entry, index, view) {
  const id = `${view.prefix}-sec-${index}`;
  let body;
  if (entry.key === 'work') {
    const { before, after, steps } = view.model.work;
    body = planMarkdown(before)
      + (steps.length ? `<ol class="plan-doc-steps">${steps.map((step, at) =>
        `<li id="${view.prefix}-step-${at + 1}" tabindex="-1">${planMarkdown(step.body)}</li>`).join('')}</ol>` : '')
      + planMarkdown(after);
  } else {
    body = planMarkdown(entry.body);
  }
  return `<section class="plan-section" data-plan-section="${entry.key}" id="${id}"><h2 tabindex="-1">${esc(entry.title)}</h2>${body}</section>`;
}

function planHtml(view, planRun) {
  const { model } = view;
  const meta = planRun.meta || {};
  const title = model.title || meta.title || planRun.id;
  const lede = [model.intro, model.destination].filter(Boolean).map(planMarkdown).join('');
  const nav = model.sections.map((entry, index) =>
    `<li><button type="button" data-plan-jump="${view.prefix}-sec-${index}">${esc(entry.title)}</button></li>`).join('');
  const notion = typeof meta.notionUrl === 'string' && /^https?:\/\//.test(meta.notionUrl)
    ? `<a class="plan-tool-link" href="${esc(meta.notionUrl)}">Notion plan doc</a>` : '';
  // A run the plan started links to the plan's own page, except the build
  // paired with it, whose Plan tab is that page.
  const page = view.viewerId !== planRun.id && pairedBuildOf(planRun, runs)?.id !== view.viewerId
    ? `<a class="plan-tool-link" href="#${encodeURIComponent(planRun.id)}/${PLANNING_PAGE}">Open the plan</a>` : '';
  // Kept as written, so the next repaint can tell whether anything changed.
  view.workHtml = planWorkHtml(view, planRun);
  return `<div class="plan-layout">
    <header class="plan-head"><h1 class="plan-title">${esc(title)}</h1>${lede ? `<div class="plan-lede md">${lede}</div>` : ''}</header>
    <div class="plan-work" role="complementary" aria-label="Work on this plan">
      <div class="plan-work-steps">${view.workHtml}</div>
      <div data-plan-builds-slot></div>
      ${nav ? `<nav class="plan-nav" aria-label="Plan sections"><ul>${nav}</ul></nav>` : ''}
      <div class="plan-tools"><orc-copy-button variant="ghost" size="compact" value="${esc(view.source)}" aria-label="Copy the plan as Markdown">Copy plan</orc-copy-button>${page}${notion}</div>
    </div>
    <article class="plan-doc md" aria-label="Plan">${model.sections.map((entry, index) => planSectionHtml(entry, index, view)).join('')}</article>
  </div>
  <div data-plan-notes-slot></div>`;
}

// "Q12: …" at the head of a decision becomes a reference set beside it, so a
// round reads as a list of answers.
function planMarkRefs(root) {
  root.querySelectorAll('[data-plan-section="decisions"] li, [data-plan-section="out"] li').forEach(item => {
    const holder = item.firstElementChild?.tagName === 'P' ? item.firstElementChild : item;
    const text = holder.firstChild;
    if (text?.nodeType !== 3) return;
    const ref = /^\s*(Q\d+(?:\s*[–—-]\s*Q?\d+)?)\s*[:.]\s+/.exec(text.nodeValue);
    if (!ref) return;
    text.nodeValue = text.nodeValue.slice(ref[0].length);
    const label = document.createElement('span');
    label.className = 'plan-ref';
    label.textContent = ref[1].replace(/\s+/g, '');
    holder.insertBefore(label, text);
    item.classList.add('plan-answer');
  });
}

function planFinish(view, planRun) {
  const { root } = view;
  // The row keeps what was picked, so one element outlives each repaint.
  if (view.buildsHost) root.querySelector('[data-plan-builds-slot]')?.replaceWith(view.buildsHost);
  const notesSlot = root.querySelector('[data-plan-notes-slot]');
  if (view.notesHost) notesSlot?.replaceWith(view.notesHost);
  else notesSlot?.remove();
  root.querySelectorAll('[data-plan-section="mockup"] a[href]').forEach(link => {
    if (!/^(?:\.\/)?mockups\/[^?#]+\.html(?:[?#]|$)/i.test(link.getAttribute('href'))) return;
    link.classList.add('plan-mockup-link');
    link.innerHTML = 'Open in browser<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" '
      + 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4 12l8-8M5 4h7v7"/></svg>';
  });
  root.querySelectorAll('.plan-doc, .plan-lede').forEach(node => resolveRelativeUrls(node, planRun.id, PLAN_SOURCE));
  externalizeLinks(root);
  window.orcUpgradeCallouts?.(root);
  window.orcMountCodeCopy?.(root);
  planMarkRefs(root);
  // A plan's pair is the screen today beside a mockup of the change, not a
  // build's before and after.
  root.querySelectorAll('.plan-doc .before-after').forEach(pair => {
    const [today, mockup] = pair.querySelectorAll('.ba-pane > h4');
    if (today) today.textContent = 'Today';
    if (mockup) mockup.textContent = 'Mockup';
  });
  view.notes?.paint();
  planRunExtensions(view, planRun);
  planSpy(view);
}

// Mark the section the reader has reached in the section links. A section
// they jumped to stays marked until they scroll on, since a short one near
// the end can never reach the top of the view.
function planSpy(view) {
  const links = [...view.root.querySelectorAll('.plan-nav [data-plan-jump]')];
  if (!links.length) return;
  const line = view.scroller.getBoundingClientRect().top + 96;
  let reached = links.find(link => link.dataset.planJump === view.jumped);
  if (!reached) {
    const atEnd = view.scroller.scrollTop + view.scroller.clientHeight >= view.scroller.scrollHeight - 2;
    reached = atEnd && view.scroller.scrollTop > 0 ? links.at(-1) : links[0];
    if (!atEnd) {
      for (const link of links) {
        const target = document.getElementById(link.dataset.planJump);
        if (target && target.getBoundingClientRect().top <= line) reached = link;
      }
    }
  }
  links.forEach(link => {
    if (link === reached) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
}

function planJump(view, id) {
  const target = document.getElementById(id);
  if (!target || !view.root.contains(target)) return;
  view.jumped = id;
  planSpy(view);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  const landed = target.matches('section') ? target.querySelector('h2') : target;
  landed.focus({ preventScroll: true });
  landed.classList.remove('plan-arrived');
  // Restart the arrival tint when the same place is picked twice.
  void landed.offsetWidth;
  landed.classList.add('plan-arrived');
}

// Which control of a step holds focus, so a repaint can hand it back.
const PLAN_FOCUS = { start: '[data-plan-start]:not([disabled])', merge: '[data-plan-merge]:not([disabled])',
  run: '.plan-step-run', name: '.plan-step-name' };
// A Start that gave way to Starting… hands focus to the panel's heading.
const PLAN_FOCUS_TITLE = '.plan-work-title';

function planRepaintWork(view, planRun) {
  const host = view.root.querySelector('.plan-work-steps');
  if (!host) return;
  const html = planWorkHtml(view, planRun);
  if (view.workHtml === html) return;
  const held = host.contains(document.activeElement) ? document.activeElement : null;
  const wasStart = !!held?.matches('[data-plan-start], [data-plan-start-each]');
  const step = held?.closest('.plan-step')?.dataset.planStep;
  const kind = held && Object.keys(PLAN_FOCUS).find(key => held.matches(PLAN_FOCUS[key].replace(':not([disabled])', '')));
  view.workHtml = html;
  host.innerHTML = html;
  if (wasStart && !step) return void (host.querySelector(PLAN_FOCUS.start) || host.querySelector(PLAN_FOCUS_TITLE))?.focus({ preventScroll: true });
  if (!step || !kind) return;
  // Start gives way to the step's run, so focus follows the step: to the
  // same control when it is still there, else to what replaced it.
  const row = host.querySelector(`.plan-step[data-plan-step="${step}"]`);
  const order = kind === 'name' ? ['name'] : kind === 'start' ? ['start', 'run', 'name']
    : kind === 'merge' ? ['merge', 'run', 'name'] : ['run', 'start', 'name'];
  (order.map(key => row?.querySelector(PLAN_FOCUS[key])).find(Boolean) || host.querySelector(PLAN_FOCUS_TITLE))
    ?.focus({ preventScroll: true });
}

async function planStart(view, number, each = false) {
  if (view.posting !== null || !view.canStart) return;
  // Step 0 is the whole plan, built in one run, or with `each` one run per step.
  const step = view.model.steps[number - 1];
  const name = each ? 'each step' : number === 0 ? 'the whole plan' : step?.title || 'this plan';
  // An agent this project cannot run would only fail at the server.
  if (view.builds?.blocker) {
    view.failures.set(number, view.builds.blocker);
    announce(`Could not start a run for ${name}${planFailure(view.builds.blocker)}`);
    return view.repaint();
  }
  view.posting = number;
  view.failures.delete(number);
  const sent = number === 0 || step?.implied ? 0 : number;
  // The plan reads Starting here and in the sidebar before the host answers.
  const hold = holdPlanStart(view.planRun, { step: sent, whole: !sent && view.model.steps.length > 1 });
  view.sync();
  announce(`Starting a run for ${name}`);
  let reply = null;
  let failure = '';
  try {
    const response = await fetch(`/runs/${encodeURIComponent(view.planId)}/planning-start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(sent ? { step: sent } : each ? { each: true } : {}), ...view.builds?.choices() }),
    });
    reply = await response.json().catch(() => null);
    if (!response.ok) failure = reply?.error || `the server answered ${response.status}`;
  } catch {
    failure = 'Orc could not be reached';
  }
  view.posting = null;
  // The hold outlives this page: the sidebar shows it until the run is listed.
  if (failure) planStartFailed(view.planId, hold);
  else {
    planStartAccepted(view.planId, hold, reply?.childRunId);
    refresh({ force: true });
  }
  if (!view.alive) return;
  if (failure) {
    view.failures.set(number, failure);
    announce(`Could not start a run for ${name}${planFailure(failure)}`);
  } else {
    announce(each ? 'Runs started for each step' : `Run started for ${name}`);
  }
  view.sync();
}

// Merge on a step's run: the same host checks and queue as the merge plan
// (merge-plan.js), bound to the proof the host names for the run now.
async function planMerge(view, runId) {
  if (view.merging.get(runId)?.pending) return;
  view.merging.set(runId, { pending: true });
  view.repaint();
  let error = '';
  try {
    const found = await fetch(`/api/merge-candidates?run=${encodeURIComponent(runId)}`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null));
    const candidate = found?.candidates?.[0];
    if (!candidate?.eligible) error = candidate?.reason || 'Orc could not check the merge';
    else {
      const response = await fetch('/api/merge-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runs: [{ runId, digest: candidate.digest }] }),
      });
      const reply = await response.json().catch(() => null);
      const result = reply?.results?.[0];
      if (!response.ok || !result?.queued) error = result?.error || reply?.error || `the server answered ${response.status}`;
    }
  } catch {
    error = 'Orc could not be reached';
  }
  if (!view.alive) return;
  // A queued merge keeps Merging… until the run list shows it merging.
  view.merging.set(runId, error ? { error } : { pending: true });
  announce(error ? `Could not merge${planFailure(error)}` : 'Merge started');
  if (!error) refresh({ force: true });
  view.repaint();
}

// A run is building the plan, or about to: one that was cancelled or deleted
// leaves the plan as it was before Start. Start work's own hold is not yet
// work, so notes stay open until the host takes the launch.
const planHasWork = planRun => (planRun.meta?.relationshipChildren || []).some(row => {
  if (!row || row.mode === 'orc-plan-session' || row.held) return false;
  if (row.state === 'launching') return true;
  const child = row.state === 'launched' && row.childRunId ? runs.find(candidate => candidate.id === row.childRunId) : null;
  return Boolean(child) && child.meta?.status !== 'cancelled';
});

const planSourceKey = planRun => {
  const file = (planRun.files || []).find(entry => entry.path === PLAN_SOURCE);
  return `${planRun.id}:${file?.size}:${file?.mtime ?? planRun.mtime ?? ''}:${mediaSignature(planRun)}`;
};

// One plan drawn into `root`. `viewer` is the run whose page or Plan tab
// this is: the plan itself, or a run the plan started.
export function planMount(root, { planRun, viewer, layout, scroller, onPainted }) {
  const view = {
    root, scroller, layout, prefix: `plan-${layout}`, planId: planRun.id, viewerId: viewer.id,
    source: '', sourceKey: '', mediaSig: '', model: null, workHtml: '', alive: true, loading: 0,
    posting: null, failures: new Map(), merging: new Map(), canStart: false, planRun, jumped: '',
    repaint: () => planRepaintWork(view, view.planRun),
    // Repaint from the listed plan, which carries a held Start (plan-starts.js).
    sync: () => {
      view.planRun = runs.find(candidate => candidate.id === view.planId) || view.planRun;
      view.repaint();
    },
  };
  view.buildsHost = document.createElement('div');
  view.buildsHost.className = 'plan-builds';
  view.builds = mountPlanBuilds(view.buildsHost, { meta: planRun.meta || {}, labelId: `${view.prefix}-builds` });
  view.buildsHost.addEventListener('plan-builds-ready', () => { if (view.alive && view.model) view.repaint(); });
  // Notes are left on the plan's own page, while nothing has started from it.
  if (layout === 'page' && viewer.id === planRun.id) {
    view.notesHost = document.createElement('div');
    view.notes = mountPlanNotes({
      root, dock: view.notesHost, runId: planRun.id, meta: () => view.planRun.meta || {},
      source: () => view.source, changed: () => { if (view.alive) update(view.planRun, { id: view.viewerId }); },
    });
  }
  const sizeToScroller = () => root.style.setProperty('--plan-view-h', `${scroller.clientHeight}px`);
  const sizes = new ResizeObserver(sizeToScroller);
  sizes.observe(scroller);
  let spyFrame = 0;
  const onScroll = () => {
    if (spyFrame) return;
    spyFrame = requestAnimationFrame(() => { spyFrame = 0; if (view.alive) planSpy(view); });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  // The reader's own scrolling takes the mark back from a jump.
  const onReaderScroll = () => { view.jumped = ''; };
  // Each new run list can bring the run a Start launched, or end its hold,
  // and another run's Plan tab is not redrawn by that run's route.
  const onRuns = () => {
    const listed = runs.find(candidate => candidate.id === view.planId);
    if (view.alive && listed && listed !== view.planRun) update(listed, { id: view.viewerId });
  };
  document.addEventListener('orc:runs', onRuns);
  const markPlanRead = () => {
    if (view.alive && view.viewerId === view.planId && view.planRun?.meta?.unread === true) {
      reportSeen(view.planId, 'read');
    }
  };
  window.addEventListener('focus', markPlanRead);
  document.addEventListener('visibilitychange', markPlanRead);
  for (const type of ['wheel', 'touchmove', 'keydown']) scroller.addEventListener(type, onReaderScroll, { passive: true });
  root.addEventListener('click', event => {
    const start = event.target.closest?.('[data-plan-start]');
    if (start && !start.hasAttribute('disabled')) return void planStart(view, Number(start.dataset.planStart));
    const each = event.target.closest?.('[data-plan-start-each]');
    if (each && !each.hasAttribute('disabled')) return void planStart(view, 0, true);
    const merge = event.target.closest?.('[data-plan-merge]');
    if (merge && !merge.hasAttribute('disabled')) return void planMerge(view, merge.dataset.planMerge);
    const chat = event.target.closest?.('[data-plan-open-chat]');
    if (chat) {
      location.hash = `${encodeURIComponent(chat.dataset.planOpenChat)}/${CHAT_KEY}`;
      return;
    }
    const jump = event.target.closest?.('[data-plan-jump]');
    if (jump) return void planJump(view, jump.dataset.planJump);
    if (event.target.closest?.('[data-plan-retry]')) { emptyRetries = 0; load(view.planRun, true); }
  });

  const MAX_EMPTY_RETRIES = 6;
  const EMPTY_RETRY_MS = 400;
  let retryTimer = 0;
  let emptyRetries = 0;
  const clearRetry = () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
  };

  async function load(run, force = false) {
    const key = planSourceKey(run);
    if (!force && key === view.sourceKey) return;
    if (!force) emptyRetries = 0;
    clearRetry();
    view.sourceKey = key;
    const turn = ++view.loading;
    if (!view.model) root.innerHTML = '<p class="plan-loading" role="status">Loading plan…</p>';
    root.setAttribute('aria-busy', 'true');
    const text = await fetch(fileUrl(run.id, PLAN_SOURCE), { cache: 'no-store' })
      .then(response => (response.ok ? response.text() : null)).catch(() => null);
    if (!view.alive || turn !== view.loading) return;
    root.removeAttribute('aria-busy');
    // An empty body is either a transient mid-write read or a missing source:
    // never wipe a plan already on screen, and retry briefly so a 304 /api/runs
    // poll cannot leave the update dropped.
    if (text === null || !text.trim()) {
      view.sourceKey = '';
      if (!view.model) root.innerHTML = '<p class="plan-loading" role="status">Couldn\'t load the plan.</p><orc-button variant="ghost" size="compact" data-plan-retry>Try again</orc-button>';
      if (text !== null && emptyRetries < MAX_EMPTY_RETRIES) {
        emptyRetries += 1;
        retryTimer = setTimeout(() => { retryTimer = 0; if (view.alive) load(view.planRun, true); }, EMPTY_RETRY_MS);
      }
      return;
    }
    emptyRetries = 0;
    const nextMedia = mediaSignature(view.planRun);
    if (text === view.source && nextMedia === view.mediaSig && view.model) return;
    view.source = text;
    view.mediaSig = nextMedia;
    view.model = planModel(stripFrontMatter(text));
    root.innerHTML = planHtml(view, view.planRun);
    sizeToScroller();
    planFinish(view, view.planRun);
    onPainted?.();
  }

  function update(run, nextViewer) {
    view.planRun = run;
    view.viewerId = nextViewer.id;
    const meta = run.meta || {};
    // Nothing starts from a plan its run is rewriting.
    const open = isPlanningComplete(meta) && meta.status !== 'cancelled' && meta.remote !== true;
    view.revising = open && Boolean(view.notes?.revising);
    view.canStart = open && !view.revising;
    view.notes?.update({
      enabled: open && !isPlanningClosed(meta) && !planHasWork(run),
      key: `${planSourceKey(run)}:${meta.status}`,
    });
    load(run);
    if (view.model) planRepaintWork(view, run);
    markPlanRead();
  }

  update(planRun, viewer);
  planViews.add(view);
  return {
    planId: planRun.id,
    update,
    destroy() {
      view.alive = false;
      clearRetry();
      planViews.delete(view);
      view.builds.destroy();
      view.notes?.destroy();
      sizes.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      document.removeEventListener('orc:runs', onRuns);
      window.removeEventListener('focus', markPlanRead);
      document.removeEventListener('visibilitychange', markPlanRead);
      for (const type of ['wheel', 'touchmove', 'keydown']) scroller.removeEventListener(type, onReaderScroll);
      if (spyFrame) cancelAnimationFrame(spyFrame);
    },
  };
}

// ---------- the plan page ----------

let planPage = null;

// Rounds still open keep the embedded page and its question form. A run a
// plan started shows that plan in its own Plan tab.
export const planPageShows = (run, key) => key === PLANNING_PAGE
  && (isPlanningComplete(run?.meta) || !!planOf(run, runs));
export const planPageMounted = id => !!planPage && planPage.viewerId === id && planPage.root.isConnected;

export function mountPlanPage(run, container, scrollTop = 0) {
  unmountPlanPage();
  container.innerHTML = '<div class="plan-page" data-plan-layout="page"></div>';
  container.scrollTop = 0;
  const root = container.firstElementChild;
  planPage = planMount(root, {
    planRun: planOf(run, runs) || run, viewer: run, layout: 'page', scroller: container,
    onPainted: () => { if (scrollTop && root.isConnected) container.scrollTop = scrollTop; },
  });
  planPage.root = root;
  planPage.viewerId = run.id;
}

export function updatePlanPage(run) {
  planPage?.update(planOf(run, runs) || run, run);
}

export function unmountPlanPage() {
  planPage?.destroy();
  planPage = null;
}
