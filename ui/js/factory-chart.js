import { esc } from './core.js';

const chartButton = id => `<button type="button" class="factory-chart-node" data-agent-id="${esc(id)}" data-factory-select aria-pressed="false"></button>`;

function chartBranch(title, agents) {
  if (!agents.length) return '';
  return `<section class="factory-chart-branch" aria-label="${title}">
    <h3>${title} <span class="factory-count">${agents.length}</span></h3>
    <ul>${agents.map(agent => `<li>${chartButton(agent.id)}</li>`).join('')}</ul>
  </section>`;
}

export function createFactoryChart(stage, nodeHtml, onViewChange) {
  const viewport = document.createElement('div');
  viewport.className = 'factory-chart-viewport';
  viewport.innerHTML = `<div class="factory-chart-sheet"><div class="factory-chart" role="group" aria-label="Agent delegation"></div></div>`;
  stage.prepend(viewport);
  const chart = viewport.querySelector('.factory-chart');
  const sheet = chart.parentElement;
  let structure = '';
  let scale = 1;

  function update(crew) {
    const workers = crew.agents.filter(agent => agent.kind === 'worker');
    const helpers = crew.agents.filter(agent => agent.kind !== 'worker');
    const branches = chartBranch('Orchestrate workers', workers) + chartBranch('Subagents', helpers);
    const next = chartButton('main') + (branches ? `<div class="factory-chart-branches">${branches}</div>` : '');
    let focused;
    if (structure !== next) {
      focused = chart.contains(document.activeElement) && document.activeElement.dataset.agentId;
      chart.innerHTML = next;
      structure = next;
    }
    const agents = new Map(crew.agents.map(agent => [agent.id, agent]));
    for (const button of chart.querySelectorAll('[data-agent-id]')) {
      const id = button.dataset.agentId;
      const main = id === 'main';
      const agent = main ? crew.main : agents.get(id);
      const html = nodeHtml(agent, main);
      if (button._nodeHtml !== html) {
        button.innerHTML = html;
        button._nodeHtml = html;
      }
      button.dataset.state = agent.state;
      if (id === focused) button.focus({ preventScroll: true });
    }
  }

  const buttonFor = id => chart.querySelector(`[data-agent-id="${CSS.escape(id)}"]`);
  function recenter() {
    scale = 1;
    sheet.style.removeProperty('--factory-chart-scale');
    viewport.scrollTo(0, 0);
    onViewChange();
  }
  function zoom(factor, clientX, clientY) {
    const bounds = viewport.getBoundingClientRect();
    const x = clientX ?? bounds.left + viewport.clientWidth / 2;
    const y = clientY ?? bounds.top + viewport.clientHeight / 2;
    const before = chart.getBoundingClientRect();
    scale = Math.max(0.5, Math.min(2, scale * factor));
    if (Math.abs(scale - 1) < 0.001) scale = 1;
    sheet.style.setProperty('--factory-chart-scale', String(scale));
    const after = chart.getBoundingClientRect();
    if (before.width && before.height) {
      viewport.scrollBy(after.left - x + (x - before.left) * after.width / before.width,
        after.top - y + (y - before.top) * after.height / before.height);
    }
    onViewChange();
  }
  viewport.addEventListener('scroll', onViewChange, { passive: true });
  return {
    viewport, update, recenter, zoom, buttonFor,
    get moved() { return scale !== 1 || viewport.scrollTop > 0 || viewport.scrollLeft > 0; },
    get zoomLimit() { return scale === 2 ? 'in' : scale === 0.5 ? 'out' : null; },
    dispose() { viewport.remove(); },
  };
}
