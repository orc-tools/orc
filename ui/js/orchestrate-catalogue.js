// The models a route can name: everything the composer's model picker offers,
// grouped by the agent that runs it. A cloud harness, which runs other agents'
// models in its own cloud, is not a route a job can take.
import { harnessMark } from './agent-marks.js';
import { harnessEffortLevels, harnessFor } from './harnesses.js';
import { launchModels } from './launch-selection.js';
import { NC_EFFORT_OPTIONS, launchTakesEffort, launchTakesFast, ncAgentOptions, ncSupportsUltra } from './launch-options.js';
import { modelIsHidden } from './model-catalog.js';

function levelsFor(agent, model, capabilities) {
  if (!launchTakesEffort({ agent, model })) return [];
  const offered = harnessEffortLevels(agent, model);
  return NC_EFFORT_OPTIONS.map(([level]) => level).filter(level =>
    (level !== 'ultra' || ncSupportsUltra(capabilities, agent, model)) && (!offered || offered.includes(level)));
}

// `capabilities` is /api/config's launchEffort, which says where Ultra works.
// `fast` is whether the agent has a Fast mode this computer offers.
// `inUse(agent, model)` keeps a model the picker hides while a route names it.
export function modelRacks(capabilities = {}, inUse = () => false) {
  const models = launchModels();
  return ncAgentOptions()
    .filter(([agent]) => !harnessFor(agent)?.cloud && harnessFor(agent)?.orchestration !== false)
    .map(([agent, label]) => {
      const mark = harnessMark(agent);
      return {
        agent, label: mark?.[0] || label, mark: mark?.[1] || '', fast: launchTakesFast({ agent }),
        models: (models[agent] || []).map(([id, name, note]) => ({
          id, name, note: note || '', levels: levelsFor(agent, id, capabilities),
        })).filter(model => !modelIsHidden(agent, model.id) || inUse(agent, model.id)),
      };
    })
    .filter(rack => rack.models.length);
}
