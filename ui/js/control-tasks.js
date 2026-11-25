import { esc, fileUrl, runs } from './core.js';
import { runModelLabel } from './launch-options.js';

const controlTaskSnapshots = new Map();
const finishedTaskStates = new Set(['completed', 'failed', 'cancelled']);

// A task is named by its child run's title, then the title it was delegated
// with, then the first sentence of its prompt.
export function controlTaskTitle(task, text) {
  const child = task.childRunId ? runs.find(run => run.id === task.childRunId) : null;
  const named = String(child?.meta?.title || task.request?.title || '').trim();
  if (named) return named;
  const line = String(text).trim().split('\n')[0];
  return line.match(/^.+?[.!?](?=\s)/)?.[0] || line;
}

export function controlTaskRowsHtml(runId, tasks, readOnly = false) {
  if (!tasks.length) return '<p class="control-help">No automatic tasks yet.</p>';
  return `<ul class="control-task-list">${tasks.map(task => {
    const selection = task.selection || {};
    const taskText = task.request?.text || task.text || task.taskId || 'Task';
    const title = controlTaskTitle(task, taskText);
    const model = runModelLabel({ launchModel: selection.model, launchEffort: selection.effort });
    const chosen = [selection.agent, selection.claudeAccount, model].filter(Boolean)
      .map(part => `<span>${esc(part)}</span>`).join(' · ');
    const name = task.childRunId
      ? `<a class="control-task-title" href="#${encodeURIComponent(task.childRunId)}" title="${esc(taskText)}">${esc(title)}</a>`
      : `<span class="control-task-title" title="${esc(taskText)}">${esc(title)}</span>`;
    const result = task.result?.path && task.childRunId
      ? `<a href="${esc(fileUrl(task.childRunId, task.result.path))}">${esc(task.result.path)}</a>${task.result.sha256 ? ` <span translate="no" title="${esc(task.result.sha256)}">${esc(task.result.sha256.slice(0, 12))}</span>` : ''}`
      : '';
    const delivery = typeof task.delivery === 'object' ? task.delivery?.state : task.delivery;
    const pendingDelivery = task.state === 'completed' && ['pending', 'sending', 'ambiguous'].includes(delivery);
    const cancellable = !readOnly && task.taskId && (!finishedTaskStates.has(task.state) || pendingDelivery);
    return `<li class="control-task">${name}`
      + `<p class="control-task-meta"><span>${esc(task.state || 'unknown')}</span>${chosen ? ` · <span>${chosen}</span>` : ''}</p>`
      + (delivery ? `<p class="control-help">Delivery: ${esc(delivery)}</p>` : '')
      + (task.error ? `<p class="control-help control-error">${esc(task.error)}</p>` : '')
      + (result ? `<p class="control-task-result">${result}</p>` : '')
      + (cancellable ? `<button type="button" data-task-cancel="${esc(task.taskId)}" aria-label="Stop task ${esc(title)}">Stop task</button>` : '')
      + '</li>';
  }).join('')}</ul>`;
}

function orchestrationStatus(snapshot) {
  if (!snapshot) return 'Loading orchestration status…';
  return snapshot.enabled ? 'Orchestration is on. The agent plans and delegates work across your available agents.' : 'Orchestration is off for this run.';
}

export function controlTasksHtml(runId, snapshot = null, readOnly = false) {
  return `<legend class="settings-label"><h5 id="control-tasks-title">Automatic tasks</h5></legend>
    <p class="control-help" data-task-summary>${orchestrationStatus(snapshot)}</p>
    <div data-task-rows>${controlTaskRowsHtml(runId, snapshot?.tasks || [], readOnly)}</div>
    <div class="control-actions"><button type="button" data-task-refresh>Refresh tasks</button></div>
    <p id="control-tasks-status" class="control-status-line" aria-live="polite">${snapshot ? '' : 'Loading tasks…'}</p>`;
}

export function bindControlTasks(run, container, readOnly = false) {
  if (!container) return;
  const id = run.id;
  let snapshot = controlTaskSnapshots.get(id) || null;
  let busy = false;
  let refreshTimer;
  let disposed = false;
  const removalObserver = new MutationObserver(() => {
    if (container.isConnected) return;
    disposed = true;
    clearTimeout(refreshTimer);
    removalObserver.disconnect();
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
  const status = (message, error = false) => {
    if (!container.isConnected) return;
    const line = container.querySelector('#control-tasks-status');
    line.textContent = message;
    line.className = `control-status-line${error ? ' control-error' : ''}`;
  };
  const request = async body => {
    const response = await fetch(`/runs/${encodeURIComponent(id)}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not update tasks. Retry when ready.');
    return data;
  };
  const load = async () => {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/tasks`, { cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not load tasks. Refresh to retry.');
    }
    const data = await response.json();
    if (typeof data.enabled !== 'boolean' || !Array.isArray(data.tasks)) throw new Error('Could not read tasks. Refresh to retry.');
    snapshot = data;
    controlTaskSnapshots.set(id, data);
  };
  const draw = () => {
    if (!container.isConnected) return;
    container.innerHTML = controlTasksHtml(id, snapshot, readOnly);
    bind();
  };
  const operate = async (message, action, success) => {
    if (busy) return;
    busy = true;
    const active = document.activeElement;
    const focusControl = container.contains(active) && active.hasAttribute('data-task-refresh');
    container.querySelectorAll('button, input, select, textarea, fieldset').forEach(element => { element.disabled = true; });
    status(message);
    let failure = '';
    try { await action(); } catch (error) { failure = error.message || 'Could not update tasks. Retry when ready.'; }
    busy = false;
    draw();
    const focusTarget = focusControl ? container.querySelector('[data-task-refresh]') : null;
    if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: true });
    status(failure || success, !!failure);
  };
  const bindTaskStops = () => {
    container.querySelectorAll('[data-task-cancel]').forEach(button => button.addEventListener('click', () => {
      if (readOnly) return;
      operate('Stopping task…', async () => {
        await request({ action: 'cancel', taskId: button.dataset.taskCancel });
        await load();
      }, 'Task stopped.');
    }));
  };
  const bind = () => {
    bindTaskStops();
    container.querySelector('[data-task-refresh]').addEventListener('click', () => operate('Refreshing tasks…', load, 'Tasks refreshed.'));
  };
  const scheduleRefresh = () => {
    if (disposed || !container.isConnected) return;
    refreshTimer = setTimeout(async () => {
      if (disposed || !container.isConnected) return;
      if (!busy) {
        busy = true;
        const previous = JSON.stringify(snapshot?.tasks);
        try {
          await load();
          if (!disposed && container.isConnected) container.querySelector('[data-task-summary]').textContent = orchestrationStatus(snapshot);
          if (!disposed && container.isConnected && previous !== JSON.stringify(snapshot.tasks)) {
            const rows = container.querySelector('[data-task-rows]');
            const active = document.activeElement;
            const focusedTask = rows.contains(active) ? active.dataset.taskCancel : null;
            const focusedHref = rows.contains(active) ? active.getAttribute('href') : null;
            rows.innerHTML = controlTaskRowsHtml(id, snapshot.tasks, readOnly);
            bindTaskStops();
            const replacement = [...rows.querySelectorAll('button, a')].find(element =>
              focusedTask ? element.dataset.taskCancel === focusedTask : focusedHref && element.getAttribute('href') === focusedHref);
            replacement?.focus({ preventScroll: true });
          }
        } catch (error) {
          status(error.message || 'Could not refresh tasks.', true);
        } finally {
          busy = false;
        }
      }
      scheduleRefresh();
    }, 3000);
  };
  draw();
  operate('Loading tasks…', load, '').then(scheduleRefresh);
}
