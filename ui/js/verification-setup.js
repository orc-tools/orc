// The project home's Set up verification card. It shows under the composer
// until the project tells runs how to check their work: its AGENTS.md or
// CLAUDE.md has a section about verifying, the user keeps a private guide for
// it, an enabled plugin ships a guide for the repository, or the user started
// setup or chose Not now (ui/project_verification.py). The button starts a
// change run that follows skills/_shared/verification-setup.md, which saves the
// steps where the card's choice says: in the repository's AGENTS.md (the
// default) or as a private guide in Orc's own data that is never committed.
// Not now only quiets the project home: project Settings keeps its
// Verification card, which also hands the card a project whose steps exist, to
// update them or set them up again (`offer(project, request)`).
import { announce } from './core.js';

export const VERIFICATION_DESTINATIONS = ['repo', 'private'];

// TESTABLE: the setup run's prompt for where the steps are saved
export function verificationSetupPrompt(destination = 'repo') {
  const start = 'Set up verification for this project. Follow Orc’s `_shared/verification-setup.md` skill file: '
    + 'find out how this project is tested and run, ask me one round of questions about what to check, then ';
  return destination === 'private'
    ? start + 'save the steps as my private verification guide (the path `orc-verification-guides --repo <checkout> '
      + '--private-path` prints), outside the repository, so every later run on my machine verifies its work the '
      + 'same way without anything being committed.'
    : start + 'write a "Verifying changes" section in AGENTS.md so every later run verifies its work the same way.';
}
// END TESTABLE: the setup run's prompt for where the steps are saved

export const VERIFICATION_SETUP_PROMPT = verificationSetupPrompt('repo');

// TESTABLE: the prompts that change steps a project already has
// Where the steps are, as the run should find them: `state` is what
// /api/project-verification reported (ui/project_verification.py).
function verificationStepsPlace(state) {
  return state?.state === 'private'
    ? 'my private verification guide (the path `orc-verification-guides --repo <checkout> --private-path` prints), '
      + 'outside the repository, so nothing is committed'
    : `the "${state?.heading || 'Verifying changes'}" section in ${state?.file || 'AGENTS.md'}`;
}

// Update steps: the change the user typed, and the steps tried once after.
export function verificationUpdatePrompt(state, change) {
  return 'Update this project’s verification steps. Follow the Update steps part of Orc’s '
    + '`_shared/verification-setup.md` skill file: change ' + verificationStepsPlace(state)
    + ' as I describe below, without a round of questions, then dry-run the steps once.\n\nWhat should change:\n'
    + String(change || '').trim();
}

// Set up again: setup from scratch, replacing the steps where they are.
export function verificationRedoPrompt(state) {
  return 'Set up verification for this project again. Follow the Set up again part of Orc’s '
    + '`_shared/verification-setup.md` skill file: study how this project is tested and run from scratch, ask me one '
    + 'round of questions about what to check, then rewrite ' + verificationStepsPlace(state)
    + ' in place of the steps there now, and dry-run them once.';
}
// END TESTABLE: the prompts that change steps a project already has

// What the card says for each kind of run it starts. `setup` is the
// project home's own offer; the others come from project Settings.
const VERIFICATION_CARD_MODES = {
  setup: { lead: 'Recommended for', title: 'Set up verification', go: 'Start setup',
    text: 'Orc looks at how this project is tested and run, asks what you care about checking, and writes it down so every run proves its work the same way.' },
  update: { lead: 'Verification for', title: 'Update verification steps', go: 'Update steps',
    text: 'Orc changes the steps as you described and tries them once. The change is merged like any other.',
    privateText: 'Orc changes your private guide as you described and tries the steps once. Nothing is committed.' },
  redo: { lead: 'Verification for', title: 'Set up verification again', go: 'Set up again',
    text: 'Orc studies the project from scratch, asks what you care about checking, and rewrites the steps.' },
};

export const verificationCardHtml = `
  <section id="nc-verify" class="nc-verify-card" aria-labelledby="nc-verify-title" hidden>
    <span class="nc-verify-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    <div class="nc-verify-body">
      <p class="nc-verify-eyebrow"><span id="nc-verify-lead">Recommended for</span> <span id="nc-verify-project"></span></p>
      <h3 id="nc-verify-title" class="nc-verify-title">Set up verification</h3>
      <p class="nc-verify-text" id="nc-verify-text">Orc looks at how this project is tested and run, asks what you care about checking, and writes it down so every run proves its work the same way.</p>
      <blockquote class="nc-verify-change" id="nc-verify-change" hidden></blockquote>
      <div class="nc-verify-actions" id="nc-verify-offer">
        <orc-button id="nc-verify-start" size="compact">Set up verification</orc-button>
        <orc-button id="nc-verify-dismiss" variant="ghost" size="compact">Not now</orc-button>
      </div>
      <div class="nc-verify-choose" id="nc-verify-choose" hidden>
        <div class="nc-verify-field" id="nc-verify-where-field">
          <span class="nc-verify-label" aria-hidden="true">Save the steps</span>
          <orc-segmented id="nc-verify-where" label="Save the steps" value="repo">
            <button type="button" value="repo">In the repo</button>
            <button type="button" value="private">Private to me</button>
          </orc-segmented>
          <p class="nc-verify-hint" id="nc-verify-where-hint">Writes a Verifying changes section in AGENTS.md, merged like any other change.</p>
        </div>
        <div class="nc-verify-field">
          <div class="plan-builds nc-verify-runs" id="nc-verify-runs"></div>
          <p class="nc-verify-hint" id="nc-verify-hint" hidden>Opus 5.5 at medium effort is recommended for this.</p>
        </div>
        <div class="nc-verify-actions">
          <orc-button id="nc-verify-go" size="compact">Start setup</orc-button>
          <orc-button id="nc-verify-cancel" variant="ghost" size="compact">Cancel</orc-button>
        </div>
      </div>
    </div>
  </section>`;

// TESTABLE: whether the card shows for a project's verification state
export function verificationCardShows(state) {
  return state?.state === 'missing';
}
// END TESTABLE: whether the card shows for a project's verification state

// `choice` is 'started', 'skipped' (Not now) or null to forget either.
export async function postVerificationChoice(project, choice) {
  const response = await fetch('/api/project-verification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, choice }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not save that. Try again.');
  return result;
}

export const VERIFICATION_DESTINATION_HINTS = {
  repo: 'Writes a Verifying changes section in AGENTS.md, merged like any other change.',
  private: 'Keeps the steps in Orc on this machine. Nothing is committed, and other people using the repo never see them.',
};

// One card per composer. `runsWith(host)` draws the setup run's launch choices
// into `host` and returns `{ row, recommended }`: the row (plan-builds.js) and
// whether it opened on the recommended model. `start(project, choices,
// prompt)` launches the run with that prompt and resolves true once Orc
// accepted it; `name(project)` is the label the heading uses.
export function mountVerificationCard(root, { start, name, runsWith }) {
  const card = root.querySelector('#nc-verify');
  const $ = id => card.querySelector(`#${id}`);
  const startButton = $('nc-verify-start');
  const dismissButton = $('nc-verify-dismiss');
  const offer = $('nc-verify-offer');
  const choose = $('nc-verify-choose');
  const runs = $('nc-verify-runs');
  const hint = $('nc-verify-hint');
  const goButton = $('nc-verify-go');
  const cancelButton = $('nc-verify-cancel');
  const where = $('nc-verify-where');
  const whereHint = $('nc-verify-where-hint');
  const whereField = $('nc-verify-where-field');
  const changeQuote = $('nc-verify-change');
  const destination = () => (VERIFICATION_DESTINATIONS.includes(where.value) ? where.value : 'repo');
  const paintWhere = () => { whereHint.textContent = VERIFICATION_DESTINATION_HINTS[destination()]; };
  where.addEventListener('change', paintWhere);
  let shownFor = null;
  // The project Settings asked to set up: the card shows for it whatever its
  // state until the composer moves to another project, and opens on the
  // choice of model the first time it shows.
  let offeredFor = null;
  let openOffer = false;
  // What the card offers: `{ mode: 'setup' }`, or from project Settings
  // `{ mode: 'update', state, change }` or `{ mode: 'redo', state }`, where
  // `state` is the project's verification state with its steps.
  let request = { mode: 'setup' };
  const paintMode = () => {
    const copy = VERIFICATION_CARD_MODES[request.mode];
    $('nc-verify-lead').textContent = copy.lead;
    $('nc-verify-title').textContent = copy.title;
    // A private guide is never merged: it changes in Orc's data in place.
    $('nc-verify-text').textContent = request.state?.state === 'private' && copy.privateText ? copy.privateText : copy.text;
    goButton.textContent = copy.go;
    changeQuote.textContent = request.mode === 'update' ? request.change : '';
    changeQuote.hidden = request.mode !== 'update';
    // The steps already have a place; only a first setup chooses one.
    whereField.hidden = request.mode !== 'setup';
  };
  const promptFor = () => (request.mode === 'update' ? verificationUpdatePrompt(request.state, request.change)
    : request.mode === 'redo' ? verificationRedoPrompt(request.state) : verificationSetupPrompt(destination()));
  let row = null;
  let generation = 0;
  let launching = false;
  const collapse = () => {
    row?.destroy();
    row = null;
    runs.innerHTML = '';
    // Each offer starts on the default: the steps go in the repository.
    where.value = 'repo';
    paintWhere();
    choose.hidden = true;
    offer.hidden = false;
  };
  const hide = () => { collapse(); card.hidden = true; shownFor = null; };
  // An orc-button's own button takes focus; the host does not.
  const focus = button => (button.shadowRoot?.querySelector('button') || button).focus();
  // Start setup waits for the row's choices, and takes focus once it has them.
  let focusWhenReady = false;

  function openChoice() {
    if (!shownFor || row) return;
    const drawn = runsWith(runs);
    row = drawn.row;
    hint.hidden = !drawn.recommended;
    offer.hidden = true;
    choose.hidden = false;
    goButton.disabled = !row.ready;
    focusWhenReady = !row.ready;
    if (row.ready) focus(goButton);
  }
  runs.addEventListener('plan-builds-ready', () => {
    if (launching || !row) return;
    goButton.disabled = false;
    if (focusWhenReady) focus(goButton);
    focusWhenReady = false;
  });

  async function sync(project) {
    const asked = ++generation;
    if (project !== offeredFor) { offeredFor = null; openOffer = false; request = { mode: 'setup' }; paintMode(); }
    if (!project) return hide();
    if (project !== shownFor) hide();
    let state = null;
    try {
      const response = await fetch(`/api/project-verification?${new URLSearchParams({ project })}`);
      state = response.ok ? await response.json() : null;
    } catch {
      state = null;
    }
    // A project switch while this was in flight owns the card now.
    if (asked !== generation) return;
    if (offeredFor !== project && !verificationCardShows(state)) return hide();
    $('nc-verify-project').textContent = name(project);
    shownFor = project;
    card.hidden = false;
    if (openOffer) {
      openOffer = false;
      openChoice();
    }
  }

  // The section only reaches the checkout once the setup run ships, so a
  // started setup counts as the choice and the card stays away. After either
  // choice only project Settings offers it again.
  async function settle(project, choice, message) {
    const hadFocus = card.contains(document.activeElement);
    generation++;
    offeredFor = null;
    hide();
    if (hadFocus) document.getElementById('nc-prompt')?.focus();
    try {
      await postVerificationChoice(project, choice);
      if (message) announce(message);
    } catch (error) {
      announce(error.message);
    }
  }

  startButton.addEventListener('click', openChoice);
  goButton.addEventListener('click', async () => {
    const project = shownFor;
    if (!project || !row?.ready || launching) return;
    // The row says why under its controls.
    if (row.blocker) return announce(row.blocker);
    launching = true;
    goButton.disabled = true;
    try {
      // Only a first setup is a choice the home card remembers.
      if (await start(project, row.choices(), promptFor())) {
        if (request.mode === 'setup') await settle(project, 'started', '');
        else { offeredFor = null; request = { mode: 'setup' }; paintMode(); hide(); }
      }
    } finally {
      launching = false;
      goButton.disabled = false;
    }
  });
  cancelButton.addEventListener('click', () => {
    // Settings' Update steps and Set up again have no offer to fold back to.
    if (request.mode !== 'setup') {
      const project = shownFor;
      offeredFor = null;
      request = { mode: 'setup' };
      paintMode();
      hide();
      document.getElementById('nc-prompt')?.focus();
      return project ? sync(project) : null;
    }
    collapse();
    focus(startButton);
  });
  dismissButton.addEventListener('click', () => {
    const project = shownFor;
    return project ? settle(project, 'skipped', `Verification setup skipped for ${name(project)}.`) : null;
  });
  return {
    sync,
    // Project Settings: the card opens on its choice of model for `project`,
    // even once a setup has started or the project has steps. `next` is
    // `{ mode: 'setup' }` (the default), `{ mode: 'update', state, change }`
    // or `{ mode: 'redo', state }`.
    offer(project, next = { mode: 'setup' }) {
      if (shownFor && shownFor !== project) hide();
      if (row) collapse();
      offeredFor = project;
      openOffer = true;
      request = VERIFICATION_CARD_MODES[next?.mode] ? next : { mode: 'setup' };
      paintMode();
      return sync(project);
    },
  };
}
