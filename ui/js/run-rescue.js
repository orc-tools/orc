import { esc, fileUrl } from './core.js';
import { ncAgentOptions } from './launch-options.js';

// Mirrors run_rescue.unstarted_stub: an orc-ui launch no /orc:run session
// adopted, whose first turn failed.
const isUnstartedStub = (meta = {}) => meta.launchedBy === 'orc-ui' && meta.titlePending === true
  && meta.status === 'running' && !meta.outcome
  && ['lifecycleVersion', 'route', 'branch', 'repositories'].every(key => meta[key] === undefined);

export function failedFirstLaunch(meta = {}) {
  return isUnstartedStub(meta)
    && (meta.headlessTurn ? meta.headlessTurn.outcome === 'failed' : Boolean(meta.launchFailure));
}

export function isSettledSession(meta = {}) {
  return ['complete', 'merged'].includes(meta.status)
    || ['question', 'evals'].includes(meta.outcome);
}

export function switchBlocker(meta = {}) {
  if (meta.remote) return 'Remote runs cannot switch models from this computer.';
  if (meta.route === 'orchestration-worker') return 'Delegated worker sessions are managed by their coordinator.';
  if (meta.status === 'merged-to-parent') return 'Runs merged into a parent cannot switch sessions.';
  if (meta.outcome && !['question', 'evals'].includes(meta.outcome)) return 'Closed runs cannot switch sessions.';
  if (meta.mergeConflict || meta.mergeOperation || ['merging', 'merging-to-parent'].includes(meta.status)) {
    return 'A git merge is in progress. Wait for it to finish before switching.';
  }
  if (meta.deliveryOperation) return 'A delivery action is in progress. Wait for it to finish before switching.';
  return '';
}

export function canRescueRun(meta = {}) {
  if (switchBlocker(meta)) return false;
  if (isUnstartedStub(meta)) return failedFirstLaunch(meta);
  return true;
}

export function rescueExpectedOwner(meta = {}) {
  const harness = meta.harness || (meta.sessionId ? 'claude' : '');
  const session = harness === 'claude' ? meta.sessionId : harness === 'codex' ? meta.codexThreadId : '';
  return `${harness}:${session || ''}`;
}

export function rescueSectionHtml(run) {
  const meta = run.meta || {};
  if (!canRescueRun(meta)) return '';
  const unstarted = failedFirstLaunch(meta);
  const agent = unstarted ? (meta.harness === 'claude' ? 'codex' : 'claude') : meta.harness;
  const options = ncAgentOptions();
  const agents = options.some(([id]) => id === agent) ? options : [...options, [agent, agent]];
  const operation = meta.sessionRescue;
  const failed = operation?.state === 'failed' || meta.headlessTurn?.outcome === 'failed';
  const message = operation?.state === 'failed' ? operation.error
    : failed ? 'The last turn failed. Continue with a fresh session below.'
      : operation?.state === 'started' ? 'The previous session is superseded. Messages go to the replacement.' : '';
  const history = (meta.sessionHistory || []).filter(row => row.state === 'superseded');
  return `<fieldset class="settings-fieldset control-section"${failed || operation?.state === 'failed' ? ' data-lamp="error"' : ''}>
    <legend class="settings-label"><h5 id="control-rescue-title" tabindex="-1">Switch model or account</h5></legend>
    <p class="control-help">${unstarted
      ? 'This run never started. Start it on another agent or account with the same brief and parent run.'
      : 'Out of usage or stuck? Stop the old session and carry this run into a fresh one. Your branch, unfinished edits and decisions stay with the run.'}</p>
    <form class="control-rescue" data-run-rescue>
      <div class="control-rescue-field"><span>Agent</span><orc-select name="agent" aria-label="Rescue agent">${agents.map(([id, label]) => `<option value="${esc(id)}"${agent === id ? ' selected' : ''}>${esc(label)}</option>`).join('')}</orc-select></div>
      <div class="control-rescue-field" data-rescue-account${agent !== 'claude' ? ' hidden' : ''}><span>Claude account</span><orc-select name="claudeAccount" aria-label="Rescue Claude account" disabled><option value="" selected>Loading accounts…</option></orc-select></div>
      <label>Model (optional)<input name="model" type="text" maxlength="200" autocomplete="off" placeholder="Use Orc's default model" aria-describedby="control-rescue-help"></label>
      ${unstarted ? '' : `<orc-accordion data-recovery-notes label="Recovery handoff (optional)">
        <p class="control-help">Record what the replacement should know. Saved artifacts and recent chat are included automatically. These notes do not approve delivery or certify checks.</p>
        <label>Intended outcome<textarea name="outcome" maxlength="4000" rows="2"></textarea></label>
        <label>Accepted decisions<textarea name="decisions" maxlength="4000" rows="2"></textarea></label>
        <label>Checks so far<textarea name="checks" maxlength="4000" rows="2" placeholder="Commands, results, and what remains unverified"></textarea></label>
        <label>Failed hypotheses<textarea name="failedHypotheses" maxlength="4000" rows="2" placeholder="What was tried and why it did not help"></textarea></label>
        <label>Next step<textarea name="nextStep" maxlength="4000" rows="2"></textarea></label>
      </orc-accordion>`}
      <p id="control-rescue-help" class="control-help">${unstarted
        ? 'The failed launch is retired first. The new session gets no approval or delivery consent.'
        : 'The old session stops before the new one starts. Checks and interrupted actions are revalidated. This keeps the current approval gate.'}</p>
      <button type="submit">${unstarted ? 'Start on this agent' : 'Stop old session and continue'}</button>
    </form>
    <p data-rescue-status class="control-status-line${failed ? ' control-error' : ''}" role="status" aria-live="polite">${esc(message || '')}</p>
    ${operation?.checkpoint ? `<a href="${esc(fileUrl(run.id, operation.checkpoint.replace(/checkpoint\.json$/, 'context.md')))}" target="_blank" rel="noopener">Read rescue context</a>` : ''}
    ${history.length ? `<orc-accordion label="${history.length} superseded session${history.length === 1 ? '' : 's'}"><ul>${history.map(row => `<li>${esc(row.harness)} ${esc(row.claudeAccount || '')} <code>${esc(row.sessionId || row.codexThreadId || row.providerSessionId || 'unrecorded')}</code></li>`).join('')}</ul></orc-accordion>` : ''}
  </fieldset>`;
}

export async function bindRunRescue(run, root, refresh) {
  const form = root.querySelector('[data-run-rescue]');
  if (!form) return;
  const agent = form.querySelector('[name="agent"]');
  const account = form.querySelector('[name="claudeAccount"]');
  const accountLabel = form.querySelector('[data-rescue-account]');
  const button = form.querySelector('button[type="submit"]');
  const status = root.querySelector('[data-rescue-status]');
  let busy = false;
  let accountsReady = false;
  const updateAccount = () => {
    accountLabel.hidden = agent.value !== 'claude';
    account.disabled = agent.value !== 'claude' || !accountsReady || busy;
    button.disabled = busy || (agent.value === 'claude' && !accountsReady);
  };
  agent.addEventListener('change', updateAccount);
  updateAccount();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || button.disabled) return;
    busy = true;
    const meta = run.meta || {};
    const payload = { agent: agent.value, expectedOwner: rescueExpectedOwner(meta) };
    if (meta.sessionRescue?.token) payload.expectedGeneration = meta.sessionRescue.token;
    const model = form.elements.model.value.trim();
    if (model) payload.model = model;
    const recoveryNotes = {};
    for (const key of ['outcome', 'decisions', 'checks', 'failedHypotheses', 'nextStep']) {
      const text = form.elements[key]?.value.trim();
      if (text) recoveryNotes[key] = text;
    }
    if (Object.keys(recoveryNotes).length) payload.recoveryNotes = recoveryNotes;
    if (agent.value === 'claude') payload.claudeAccount = account.value;
    form.querySelectorAll('input, textarea, orc-select, button').forEach(control => { control.disabled = true; });
    status.classList.remove('control-error');
    status.textContent = 'Stopping the old session, saving context and starting the replacement…';
    try {
      const response = await fetch(`/runs/${encodeURIComponent(run.id)}/rescue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The replacement could not start.');
      status.textContent = 'Replacement started. Continue in Chat.';
      await refresh();
      const refreshedStatus = root.querySelector('[data-rescue-status]');
      if (refreshedStatus) {
        refreshedStatus.classList.remove('control-error');
        refreshedStatus.textContent = 'Replacement started. Continue in Chat.';
      }
    } catch (error) {
      status.textContent = error.message || 'Could not reach Orc. Refresh Run Control to check whether the session changed.';
      status.classList.add('control-error');
      busy = false;
      form.querySelectorAll('input, textarea, orc-select, button').forEach(control => { control.disabled = false; });
      updateAccount();
    }
  });
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load accounts.');
    const config = await response.json();
    const names = Array.isArray(config.claudeAccounts) ? config.claudeAccounts : [];
    const wanted = names.includes(run.meta?.claudeAccount) ? run.meta.claudeAccount : names[0] || '';
    account.replaceChildren(...names.map(name => new Option(name === '.claude' ? 'Default account' : name, name, name === wanted, name === wanted)));
    account.syncCustomSelect?.();
    accountsReady = names.length > 0;
  } catch {
    account.replaceChildren(new Option('Accounts unavailable. Reopen Run Control to retry.', '', true, true));
    account.syncCustomSelect?.();
  }
  updateAccount();
}
