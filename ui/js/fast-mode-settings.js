// Settings → General → Fast mode: the Offer Fast mode switch over one row per
// agent that takes Fast, each with its mark and whether the composer offers it.
// Claude bills Fast mode only to extra usage. A login whose Fast turn came
// back without it has the switch hidden, and Claude's row names those logins
// and brings the switch back with Show it again.
import { $, esc } from './core.js';
import { harnessMark } from './agent-marks.js';
import { knownHarness } from './harnesses.js';

const FAST_AGENTS = [
  { id: 'claude', name: 'Claude', detail: 'Billed only to extra usage. On a login without it, Fast runs at normal speed and Orc hides the switch.' },
  { id: 'codex', name: 'Codex', detail: 'Quicker responses that use your plan at a higher rate.' },
];

function claudeHiddenOn(data) {
  const logins = Array.isArray(data?.claudeFastUnavailable) ? data.claudeFastUnavailable : [];
  if (!logins.length) return null;
  if ((data.claudeAccounts || []).length <= 1) return 'your login';
  return logins.map(login => esc(data.claudeAccountNames?.[login] || `~/${login}`)).join(', ');
}

function agentRowHtml(agent, offered, data) {
  const mark = harnessMark(agent.id)?.[1] || '';
  const hiddenOn = agent.id === 'claude' ? claudeHiddenOn(data) : null;
  const state = !offered ? 'off' : hiddenOn ? 'hidden' : 'offered';
  const detail = hiddenOn
    ? `Hidden on ${hiddenOn}, where extra usage is off. Turn it on before showing the switch again.`
    : agent.detail;
  const side = state === 'hidden'
    ? '<button type="button" id="claude-fast-reset" class="settings-btn-inline" data-track="Show Claude Fast mode again">Show it again</button>'
    : `<span class="fast-agent-state">${state === 'off' ? 'Off' : 'Offered'}</span>`;
  return `<li class="fast-agent" data-agent="${agent.id}" data-state="${state}">
    <span class="fast-agent-mark" aria-hidden="true">${mark}</span>
    <span class="fast-agent-text"><span class="fast-agent-name">${agent.name}</span><span class="fast-agent-detail">${detail}</span></span>
    ${side}
  </li>`;
}

function agentRowsHtml(offered, data) {
  return FAST_AGENTS.filter(agent => knownHarness(agent.id)?.fast !== false)
    .map(agent => agentRowHtml(agent, offered, data)).join('');
}

export function fastModeSettingsHtml(ui, data) {
  const offered = ui?.offerFastMode !== false;
  return `<div class="settings-subblock fast-mode-settings" data-settings-anchor="fast-mode">
        <orc-switch class="settings-check" id="set-offer-fast" name="set-offer-fast" label="Offer Fast mode" aria-describedby="hint-offer-fast" ${offered ? 'checked' : ''}></orc-switch>
        <p class="settings-hint" id="hint-offer-fast">Shows the Fast switch when you start a conversation, for quicker responses at a higher rate.</p>
        <ul class="fast-agents" id="fast-agents" aria-label="Fast mode by agent">${agentRowsHtml(offered, data)}</ul>
      </div>`;
}

async function showClaudeFastAgain(event, data) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const res = await fetch('/api/claude-fast-mode/reset', { method: 'POST' });
    if (!res.ok) throw new Error(`reset failed: ${res.status}`);
    globalThis.ORC_CLAUDE_FAST_UNAVAILABLE = [];
    data.claudeFastUnavailable = [];
    paintRows(data);
    $('set-offer-fast')?.focus();
    globalThis.dispatchEvent?.(new Event('orc-plugins-changed'));
  } catch {
    button.disabled = false;
  }
}

function paintRows(data) {
  const list = $('fast-agents');
  if (!list) return;
  list.innerHTML = agentRowsHtml($('set-offer-fast')?.checked !== false, data);
  $('claude-fast-reset')?.addEventListener('click', event => showClaudeFastAgain(event, data));
}

export function mountFastModeSettings(data) {
  $('set-offer-fast')?.addEventListener('change', () => paintRows(data));
  $('claude-fast-reset')?.addEventListener('click', event => showClaudeFastAgain(event, data));
}
