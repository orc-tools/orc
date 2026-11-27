import { $, esc } from '/js/core.js';
import { SLACK_MARK_SVG } from '/js/agent-marks.js';

export const BOARD_LISTS = {
  now: { label: 'Do next', hint: 'Merges, fixes and follow-ups', shape: 'burst', icon: 'bolt', tone: 'fail' },
  stale: { label: 'Stale in Slack', hint: 'Posts waiting four days or longer', shape: 'hexagon', icon: 'active', tone: 'warn', slack: true },
  'team-reviews': { label: 'Team reviews', hint: 'Posts tagged for your team', shape: 'shield', icon: 'team', tone: 'gate', slack: true },
  waiting: { label: 'Reviews to pick up', hint: 'Requests for you and open reviews', shape: 'ticket', icon: 'eye', tone: 'active' },
  reviewed: { label: 'Waiting on authors', hint: 'Reviews waiting for a reply', shape: 'blob', icon: 'active', tone: 'neutral' },
  own: { label: 'Your pull requests', hint: 'Your open PRs and drafts', shape: 'squircle', icon: 'pr', tone: 'neutral' },
};
const COLUMNS = { repo: 'Repository', author: 'Author', size: 'Change size', ticket: 'Ticket', checks: 'Checks' };
const STEPS = [
  { name: 'Repositories', title: 'Which repositories do you follow?', hint: 'Choose where Orc looks for pull requests and review requests.' },
  { name: 'Slack', title: 'Include reviews from Slack?', hint: 'Orc reads the channels you choose with its own Slack sign-in, set up in Settings, Integrations.' },
  { name: 'Layout', title: 'What belongs on your board?', hint: 'Choose the lists you follow and the columns you want on each pull request.' },
];
const ORG = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const CHANNEL = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const SLACK_SIGN_IN = "Orc isn't signed in to Slack, so Slack is hidden on this page. Sign in from Settings, Integrations, Slack.";

function channelNames(text) {
  return text.split(',').map(part => part.trim()).filter(Boolean).map(part => part.replace(/^#/, '').toLowerCase());
}

function choice(name, value, label, hint = '', { type = 'checkbox', checked = false, disabled = false } = {}) {
  return `<label class="prs-choice" data-focus-key="${name}:${esc(value.toLowerCase())}">
    <input type="${type}" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
    <span><strong>${esc(label)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
}

function selectedNames(names = []) {
  return new Map(names.map(name => [name.toLowerCase(), name]));
}

function repoResults(catalog, draft, loading) {
  const needle = draft.query.trim();
  const low = needle.toLowerCase();
  const orgs = new Map([...draft.orgs, ...catalog.orgs]);
  const repos = new Map([...draft.repos, ...catalog.repos]);
  if (REPO.test(needle) && !repos.has(low)) repos.set(low, needle);
  if (ORG.test(needle) && !orgs.has(low)) orgs.set(low, needle);
  const groups = [];
  for (const [name, options, label] of [['prs-onboard-org', orgs, 'Organizations'], ['prs-onboard-repo', repos, 'Repositories']]) {
    const entries = [...options].filter(([key]) => key.includes(low));
    if (!entries.length) continue;
    const rows = entries.map(([key, value]) => {
      if (options === orgs) return choice(name, value, value, `Every repository in ${value}/*`, { checked: draft.orgs.has(key) });
      const owner = key.split('/')[0];
      const covered = draft.orgs.has(owner);
      return choice(name, value, value, covered ? `Included with ${draft.orgs.get(owner)}/*` : '', { checked: covered || draft.repos.has(key), disabled: covered });
    });
    groups.push(`<fieldset class="prs-repo-group"><legend>${label}</legend>${rows.join('')}</fieldset>`);
  }
  if (groups.length) return groups.join('');
  return `<p class="prs-setup-note">${loading ? 'Loading repositories…' : 'Enter an organization or owner/repo to add it directly.'}</p>`;
}

function repositoryStep(draft) {
  return `<fieldset class="prs-choices prs-scope-options"><legend class="sr-only">Repository scope</legend>
    ${choice('repo-mode', 'all', 'All repositories', 'Includes repositories you join later.', { type: 'radio', checked: draft.all })}
    ${choice('repo-mode', 'selected', 'Choose repositories', 'Follow specific organizations or repos.', { type: 'radio', checked: !draft.all })}
  </fieldset>
  <div id="prs-onboard-picker"${draft.all ? ' hidden' : ''}>
    <label class="prs-onboard-search"><span class="sr-only">Search organizations and repositories</span>
      <input id="prs-onboard-search" type="search" placeholder="Search an organization or owner/repo" autocomplete="off" spellcheck="false" value="${esc(draft.query)}"></label>
    <div id="prs-onboard-notice"></div>
    <div id="prs-onboard-results" class="prs-onboard-results"></div>
  </div>`;
}

function slackStep(draft) {
  return `<div class="prs-slack-choice">${SLACK_MARK_SVG}<div><strong>Check Slack for reviews</strong><small>Include team review requests and see who picked them up.</small></div>
    <orc-switch id="prs-onboard-slack" aria-label="Check Slack for reviews"${draft.useSlack ? ' checked' : ''}></orc-switch></div>
    <div id="prs-channel-settings"${draft.useSlack ? '' : ' hidden'}>
      <label for="prs-onboard-channel">Review channels</label>
      <div class="prs-channel-entry"><input id="prs-onboard-channel" type="text" autocomplete="off" spellcheck="false" placeholder="#team-reviews" aria-describedby="prs-channel-help" value="${esc(draft.channelInput)}">
        <button type="button" id="prs-channel-add" class="settings-btn-inline">Add</button></div>
      <p id="prs-channel-help" class="prs-setup-note">Enter a channel name, or separate several with commas.</p>
      <ul id="prs-channels" aria-label="Selected Slack channels"></ul>
      <p id="prs-onboard-slack-note" class="prs-setup-note"${draft.disconnected ? '' : ' hidden'}>${esc(SLACK_SIGN_IN)}</p>
    </div>`;
}

function availableLists(draft) {
  return Object.entries(BOARD_LISTS).filter(([, list]) => draft.useSlack || !list.slack);
}

function layoutStep(draft) {
  const lists = availableLists(draft).map(([id, list]) => choice('board-list', id, list.label, list.hint, { checked: draft.lists.has(id) }));
  const columns = Object.entries(COLUMNS).map(([id, label]) => choice('board-column', id, label, '', { checked: draft.columns.has(id) }));
  return `<fieldset class="prs-choices prs-layout-lists"><legend>Lists</legend>${lists.join('')}</fieldset>
    <fieldset class="prs-choices prs-layout-columns"><legend>Columns</legend>${columns.join('')}</fieldset>
    <figure class="prs-board-example"><figcaption>Row preview</figcaption><div id="prs-board-preview"></div></figure>`;
}

export function mountBoardSetup(view, snapshot, { saved, cancel, preview, crest }) {
  const scope = snapshot.repoScope;
  const editing = snapshot.onboardingComplete !== false;
  const draft = {
    all: !scope || scope.mode === 'all',
    orgs: selectedNames(scope?.orgs), repos: selectedNames(scope?.repos), query: '',
    useSlack: editing && snapshot.slack?.enabled !== false,
    channels: editing ? [...(snapshot.slack?.channels || [snapshot.slack?.channel].filter(Boolean))] : [],
    disconnected: snapshot.slack?.connected === false, channelInput: '',
    lists: new Set(snapshot.visibleLists || Object.keys(BOARD_LISTS)),
    columns: new Set(snapshot.columns || Object.keys(COLUMNS)),
  };
  const catalog = { orgs: new Map(), repos: new Map() };
  const events = new AbortController();
  let step = 0;
  let visited = editing ? STEPS.length - 1 : 0;
  let saving = false;
  let repoRequest;
  let repoTimer;
  let catalogLoaded = false;
  let repoNotice = '';

  view.innerHTML = `<div id="prs-onboarding" class="prs-onboard-stage"><form class="prs-onboard-card" aria-labelledby="pr-manager-title" novalidate>
    <header class="prs-setup-head"><span class="prs-setup-brand">${crest}Pull requests</span>${editing ? '<button type="button" id="prs-onboard-cancel" class="prs-quiet-btn">Cancel</button>' : ''}</header>
    <ol class="prs-setup-steps" aria-label="Setup progress">${STEPS.map(({ name }, i) => `<li><button type="button" data-setup-step="${i}"><span aria-hidden="true">${i + 1}</span>${name}</button></li>`).join('')}</ol>
    <h2 id="pr-manager-title" tabindex="-1"></h2><p id="prs-setup-hint"></p>
    <fieldset id="prs-step-fields"><legend class="sr-only">Board settings</legend><div id="prs-step-body"></div></fieldset>
    <p id="prs-onboard-error" role="alert"></p>
    <footer class="prs-setup-footer"><p id="prs-setup-summary" role="status"></p><div>
      <button type="button" id="prs-onboard-back" class="am-btn ghost">Back</button>
      <button type="submit" id="prs-onboard-next" class="am-btn primary"></button>
    </div></footer></form></div>`;
  const form = view.querySelector('form');

  function pendingChannels() {
    return [...new Set([...draft.channels, ...channelNames(draft.channelInput)])];
  }

  function valid(index) {
    if (index === 0) return draft.all || draft.orgs.size + draft.repos.size > 0;
    if (index === 1) {
      const channels = pendingChannels();
      return !draft.useSlack || (channels.length > 0 && channels.every(name => CHANNEL.test(name)));
    }
    return availableLists(draft).some(([id]) => draft.lists.has(id));
  }

  function summary() {
    if (!step) {
      if (draft.all) return 'You can change this in Settings.';
      return [draft.orgs.size && `${draft.orgs.size} organization${draft.orgs.size === 1 ? '' : 's'}`, draft.repos.size && `${draft.repos.size} ${draft.repos.size === 1 ? 'repository' : 'repositories'}`].filter(Boolean).join(' · ') || 'Choose at least one repository or organization';
    }
    if (step === 1) {
      if (!draft.useSlack) return 'GitHub only';
      if (!valid(1)) return pendingChannels().length ? 'Use letters, numbers, dots, dashes or underscores.' : 'Add a channel to continue';
      return `${pendingChannels().length} ${pendingChannels().length === 1 ? 'channel' : 'channels'} selected`;
    }
    const count = availableLists(draft).filter(([id]) => draft.lists.has(id)).length;
    return count ? `${count} ${count === 1 ? 'list' : 'lists'} · ${draft.columns.size} ${draft.columns.size === 1 ? 'column' : 'columns'}` : 'Choose at least one list';
  }

  function sync() {
    const last = step === STEPS.length - 1;
    $('prs-onboard-next').textContent = saving ? 'Saving…' : last ? (editing ? 'Save changes' : 'Open my board') : 'Continue';
    $('prs-onboard-next').disabled = saving || !valid(step);
    $('prs-onboard-back').hidden = step === 0;
    $('prs-onboard-back').disabled = saving;
    if (editing) $('prs-onboard-cancel').disabled = saving;
    $('prs-step-fields').disabled = saving;
    $('prs-setup-summary').textContent = summary();
    for (const button of form.querySelectorAll('[data-setup-step]')) {
      const index = Number(button.dataset.setupStep);
      button.disabled = saving || index > visited || (index > step && !valid(step));
      if (index === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    if (step === 1) {
      $('prs-channel-settings').hidden = !draft.useSlack;
      $('prs-channel-add').disabled = !channelNames(draft.channelInput).length || !valid(1);
      $('prs-onboard-channel').setAttribute('aria-invalid', String(!!draft.channelInput.trim() && !valid(1)));
    }
    if (last) $('prs-board-preview').innerHTML = preview([...draft.columns]);
  }

  function renderCatalog() {
    if (events.signal.aborted || step !== 0 || draft.all) return;
    const results = $('prs-onboard-results');
    const focused = results.contains(document.activeElement) ? document.activeElement.closest('label')?.dataset.focusKey : null;
    results.innerHTML = repoResults(catalog, draft, !!repoRequest);
    if (focused) [...results.querySelectorAll('label')].find(el => el.dataset.focusKey === focused)?.querySelector('input:enabled')?.focus({ preventScroll: true });
    $('prs-onboard-notice').innerHTML = repoNotice ? `<p class="prs-catalog-error">${esc(repoNotice)} <button type="button" id="prs-onboard-retry-repos" class="settings-btn-inline">Retry</button></p>` : '';
  }

  async function loadRepos(q = '', force = false) {
    repoRequest?.abort();
    const controller = new AbortController();
    repoRequest = controller;
    renderCatalog();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (force) params.set('refresh', '1');
    try {
      const res = await fetch(`/api/prs/repos${params.size ? '?' + params : ''}`, { signal: controller.signal, cache: 'no-store' });
      const data = await res.json();
      if (controller !== repoRequest) return;
      if (!res.ok) throw new Error(data.error || 'Could not load repositories.');
      for (const { login } of data.orgs || []) catalog.orgs.set(login.toLowerCase(), login);
      for (const repo of data.repos || []) {
        catalog.repos.set(repo.toLowerCase(), repo);
        const owner = repo.split('/')[0];
        catalog.orgs.set(owner.toLowerCase(), owner);
      }
      repoNotice = data.error || '';
      if (!q) catalogLoaded = !repoNotice;
    } catch (error) {
      if (!controller.signal.aborted) repoNotice = error.message || 'Could not reach GitHub.';
    } finally {
      if (repoRequest === controller) {
        repoRequest = null;
        renderCatalog();
      }
    }
  }

  function renderChannels() {
    $('prs-channels').innerHTML = draft.channels.map(name => `<li><span>#${esc(name)}</span><button type="button" data-remove-channel="${esc(name)}" aria-label="Remove #${esc(name)}">×</button></li>`).join('');
  }

  function show(index, focus = true) {
    step = index;
    visited = Math.max(visited, step);
    $('pr-manager-title').textContent = STEPS[step].title;
    $('prs-setup-hint').textContent = STEPS[step].hint;
    $('prs-onboard-error').textContent = '';
    $('prs-step-body').innerHTML = [repositoryStep, slackStep, layoutStep][step](draft);
    if (step === 0 && !draft.all) {
      renderCatalog();
      if (!catalogLoaded && !repoRequest) loadRepos();
    }
    if (step === 1) renderChannels();
    sync();
    if (focus) {
      $('pr-manager-title').focus({ preventScroll: true });
      view.scrollTop = 0;
    }
  }

  function addChannels() {
    if (!valid(1)) return;
    draft.channels = pendingChannels();
    draft.channelInput = '';
    $('prs-onboard-channel').value = '';
    renderChannels();
    sync();
    $('prs-onboard-channel').focus();
  }

  function go(index) {
    if (step === 1 && draft.useSlack && valid(1)) addChannels();
    show(index);
  }

  form.addEventListener('input', event => {
    if (event.target.id === 'prs-onboard-search') {
      draft.query = event.target.value;
      clearTimeout(repoTimer);
      renderCatalog();
      const q = draft.query.trim();
      if (q.length >= 2) repoTimer = setTimeout(() => loadRepos(q), 220);
    } else if (event.target.id === 'prs-onboard-channel') {
      draft.channelInput = event.target.value;
      sync();
    }
  });
  form.addEventListener('change', event => {
    const field = event.target;
    if (field.name === 'repo-mode') {
      draft.all = field.value === 'all';
      $('prs-onboard-picker').hidden = draft.all;
      if (!draft.all) {
        renderCatalog();
        if (!catalogLoaded && !repoRequest) loadRepos();
      }
    } else if (field.name === 'prs-onboard-org' || field.name === 'prs-onboard-repo') {
      const map = field.name === 'prs-onboard-org' ? draft.orgs : draft.repos;
      const key = field.value.toLowerCase();
      if (field.checked) map.set(key, field.value);
      else map.delete(key);
      if (field.checked && map === draft.orgs) {
        for (const repo of draft.repos.keys()) if (repo.startsWith(key + '/')) draft.repos.delete(repo);
      }
      renderCatalog();
    } else if (field.id === 'prs-onboard-slack') {
      draft.useSlack = event.detail.checked;
    } else if (field.name === 'board-list' || field.name === 'board-column') {
      const set = field.name === 'board-list' ? draft.lists : draft.columns;
      if (field.checked) set.add(field.value);
      else set.delete(field.value);
    }
    $('prs-onboard-error').textContent = '';
    sync();
  });
  form.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || saving) return;
    if (button.hasAttribute('data-setup-step')) go(Number(button.dataset.setupStep));
    else if (button.id === 'prs-onboard-cancel') cancel();
    else if (button.id === 'prs-onboard-back') go(step - 1);
    else if (button.id === 'prs-onboard-retry-repos') loadRepos(draft.query.trim(), true);
    else if (button.id === 'prs-channel-add') addChannels();
    else if (button.hasAttribute('data-remove-channel')) {
      draft.channels = draft.channels.filter(name => name !== button.dataset.removeChannel);
      renderChannels();
      sync();
      $('prs-onboard-channel').focus();
    }
  });
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.target.id === 'prs-onboard-search') event.preventDefault();
    if (event.target.id === 'prs-onboard-channel') {
      event.preventDefault();
      addChannels();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && editing && !saving) {
      event.preventDefault();
      cancel();
    }
  }, { signal: events.signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !valid(step)) return;
    if (step < STEPS.length - 1) return go(step + 1);
    const invalid = STEPS.findIndex((_, index) => !valid(index));
    if (invalid !== -1) return show(invalid);
    const payload = {
      mode: draft.all ? 'all' : 'selected', orgs: draft.all ? [] : [...draft.orgs.values()], repos: draft.all ? [] : [...draft.repos.values()],
      useSlack: draft.useSlack, slackChannels: draft.useSlack ? pendingChannels() : draft.channels,
      visibleLists: Object.keys(BOARD_LISTS).filter(id => draft.lists.has(id)),
      columns: Object.keys(COLUMNS).filter(id => draft.columns.has(id)),
    };
    saving = true;
    $('prs-onboard-error').textContent = '';
    sync();
    try {
      const res = await fetch('/api/prs/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.onboardingComplete) throw new Error(data.error || 'Could not save your board settings.');
      if (!events.signal.aborted) saved(data);
    } catch (error) {
      if (events.signal.aborted) return;
      saving = false;
      $('prs-onboard-error').textContent = error.message || 'Could not save your board settings.';
      sync();
      $('prs-onboard-next').focus();
    }
  });

  show(0);
  return () => {
    events.abort();
    clearTimeout(repoTimer);
    repoRequest?.abort();
  };
}
