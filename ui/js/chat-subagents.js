import { esc } from './core.js';
import { formatElapsed } from './chat-timeline.js';

const STATES = { running: 'Running', done: 'Done', interrupted: 'Stopped', error: 'Failed', unknown: 'Status unavailable' };

export function subagentSummary(agents) {
  const running = agents.filter(agent => agent.status === 'running').length;
  return `${agents.length} subagent${agents.length === 1 ? '' : 's'}${running ? ` · ${running} running` : ''}`;
}

export function subagentRowHtml(agent) {
  const state = STATES[agent.status] ? agent.status : 'unknown';
  const since = Date.parse(agent.startedAt);
  const duration = Number.isFinite(agent.durationMs) ? agent.durationMs : null;
  const live = state === 'running' && Number.isFinite(since);
  const elapsed = live ? Date.now() - since : duration;
  const time = elapsed === null ? 'Time unavailable' : formatElapsed(elapsed);
  const tokens = Number.isFinite(agent.tokens) && agent.tokens >= 0 ? agent.tokens : null;
  const count = tokens === null ? 'Tokens unavailable'
    : `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)} tokens`;
  const description = [agent.role, agent.model].filter(Boolean).join(' · ');
  return `<li class="chat-subagent">
    <div class="chat-subagent-heading"><span class="chat-subagent-name" title="${esc(agent.name)}">${esc(agent.name)}</span>
      <span class="chat-subagent-state is-${state}">${STATES[state]}</span></div>
    ${description ? `<div class="chat-subagent-description">${esc(description)}</div>` : ''}
    <div class="chat-subagent-metrics"><span title="Elapsed time">${live
      ? `<span class="chat-working-time" data-since="${esc(agent.startedAt)}">${esc(time)}</span>` : esc(time)}</span>
      <span title="${tokens === null ? 'No token usage recorded yet' : `${tokens.toLocaleString('en')} recorded tokens, including cached input`}">${esc(count)}</span></div>
  </li>`;
}
