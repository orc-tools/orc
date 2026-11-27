import {
  devServerCommandFieldHtml, devServerExtraFieldsHtml, devServerFieldsHtml,
  devServerValues, projectWorktreeServer, writeProjectWorktreeServer,
} from './dev-server-fields.js';

export const NEW_CONV_HANDOFF_KEY = 'orcNewConvHandoff';

const nameOf = project => project.split('/').filter(Boolean).pop() || project;

const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;

// The run saves what it finds itself (orc-setting dev-server), so Chat shows
// the saved line with Edit and Undo instead of a command to paste. A dev
// server already saved is never replaced without asking.
export function devServerAgentPrompt(project) {
  const name = nameOf(project);
  return `Figure out the local dev server command for ${name} by checking the README, package.json, and other standard project files. Use {port} if it supports a port flag, plus any install command or env files to copy into worktrees. Then save it as ${name}'s Live dev server with \`orc-setting dev-server --project ${shellQuote(project)} --command '<command>' [--install '<command>'] [--copy <file>]\` and tell me what you saved. If ${name} already has a dev server saved, tell me what you would change and ask before replacing it.`;
}

export function queueAgentDevServerSetup(project, { runId = '', openRun }) {
  const id = `dev-server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(NEW_CONV_HANDOFF_KEY, JSON.stringify({
      id,
      project,
      prompt: devServerAgentPrompt(project),
    }));
  } catch {}
  const hash = runId
    ? `new/${encodeURIComponent(runId)}?handoff=${encodeURIComponent(id)}`
    : `new?handoff=${encodeURIComponent(id)}`;
  openRun(hash);
}

export function compactSetupNotice(project = '', esc = value => String(value ?? '')) {
  return `<button type="button" class="qa-link" data-act="setup-server"${project ? ` data-setup-project="${esc(project)}"` : ''}>Set up dev server</button>`;
}

// Saves a project's Live dev server through config.json, as Settings does,
// and refuses to replace one saved meanwhile.
export async function saveProjectDevServer(project, values) {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not read the project settings.');
  const { config, configMtime } = await response.json();
  const entry = config?.repos?.[project];
  if (!entry || entry.worktree === false) throw new Error('This project is no longer available for worktree setup.');
  if (projectWorktreeServer(entry)) throw new Error('A dev server was saved while setup was open. Close setup to see it.');
  writeProjectWorktreeServer(entry, values);
  const saved = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, baseMtime: configMtime }),
  });
  if (!saved.ok) {
    if (saved.status === 409) throw new Error('Project settings changed. Review your command and save again.');
    throw new Error('Could not save the dev server settings.');
  }
}

function wireSetupForm(form, project, { onSaved, onAskAgent, extraDisable = [] }) {
  const command = form.querySelector('[data-proj-dev="command"]');
  command.required = true;
  const save = form.querySelector('[type="submit"]');
  const askAgent = form.querySelector('[data-act="ask-agent-dev-server"]');
  const errorLine = form.querySelector('[role="alert"]');
  const setDisabled = disabled => {
    for (const control of [save, askAgent, ...extraDisable]) {
      if (control) control.disabled = disabled;
    }
  };
  if (askAgent) askAgent.onclick = () => onAskAgent?.();
  form.onsubmit = async event => {
    event.preventDefault();
    if (save.disabled) return;
    const values = devServerValues(form);
    if (!values.command.trim()) {
      command.focus();
      command.setCustomValidity('Enter a command.');
      command.reportValidity();
      return;
    }
    setDisabled(true);
    if (errorLine) errorLine.textContent = '';
    try {
      await saveProjectDevServer(project, values);
      onSaved?.();
    } catch (error) {
      if (errorLine) errorLine.textContent = error.message;
      setDisabled(false);
    }
  };
  command.oninput = () => command.setCustomValidity('');
}

export function createServerSetup(project, esc, { onSaved, onAskAgent } = {}) {
  const section = document.createElement('section');
  section.className = 'qa-setup';
  section.dataset.setupProject = project;
  section.innerHTML = `<h2>Set up the dev server for ${esc(nameOf(project))}</h2>
    <p class="qa-setup-lead">Enter the command you use to start this app locally, or ask your agent to figure it out from the project files.</p>
    <form class="qa-setup-form">
      ${devServerCommandFieldHtml({}, esc, { idPrefix: 'qa-setup' })}
      <details class="qa-setup-more"><summary>More options</summary><div class="qa-setup-more-fields">${devServerExtraFieldsHtml({}, esc, { idPrefix: 'qa-setup' })}</div></details>
      <p class="qa-error" role="alert"></p>
      <div class="qa-setup-actions">
        <button type="submit" class="qa-btn primary">Save</button>
        <button type="button" class="qa-btn" data-act="ask-agent-dev-server">Figure it out with my agent</button>
      </div>
    </form>`;
  wireSetupForm(section.querySelector('form'), project, { onSaved, onAskAgent });
  return section;
}

export function openServerSetup(project, esc, { onClose, onAskAgent } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'qa-setup-dialog';
  dialog.setAttribute('aria-labelledby', 'qa-setup-name');
  dialog.innerHTML = `<form><h2 id="qa-setup-name">Live dev server for ${esc(nameOf(project))}</h2>
    ${devServerFieldsHtml({}, esc, true, { idPrefix: 'qa-dialog-dev' })}
    <p class="qa-error" role="alert"></p>
    <footer><button class="qa-btn qa-dialog-agent" type="button" data-act="ask-agent-dev-server">Figure it out with my agent</button>
    <button class="qa-btn" type="button" data-act="cancel">Cancel</button>
    <button class="qa-btn primary" type="submit">Save</button></footer></form>`;
  document.getElementById('qa-root').append(dialog);
  const form = dialog.querySelector('form');
  const command = form.querySelector('[data-proj-dev="command"]');
  const cancel = form.querySelector('[data-act="cancel"]');
  const save = form.querySelector('[type="submit"]');
  cancel.onclick = () => dialog.close();
  dialog.oncancel = event => { if (save.disabled) event.preventDefault(); };
  dialog.onclose = () => { dialog.remove(); onClose?.(); };
  wireSetupForm(form, project, {
    onSaved: () => dialog.close(),
    onAskAgent: () => { dialog.close(); onAskAgent?.(); },
    extraDisable: [cancel],
  });
  dialog.showModal();
  command.focus();
}
