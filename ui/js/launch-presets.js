// Launch presets: the named setups the model picker lists in its Presets tab.
// Picking one turns Orchestrate on when at least one task role is routed, and
// launches on that preset's lead without Orchestrate when only the lead is set;
// a preset with no lead cannot launch until it has one. Core only draws and
// picks them. The package that owns them (Orchestrate) provides the list, so
// core never imports a package.
//
// A source is:
//   list()        -> [{ id, name, caption, icon, lead, orchestrates?, planner? }]
//                    icon: { image: '<data URL>' } | { agent: '<agent id>' } | null
//                    lead: { agent, model, effort?, fast? } | null
//                    orchestrates: boolean (defaults to true when omitted)
//                    planner: { agent, model, name }: the model a plan started
//                    on the preset is written on, when its planner is on offer
//   current()     -> the id of the preset the composer launches on
//   pick(id)      -> makes that preset the composer's, and notifies
//   configure(id) -> opens the settings that edit that preset
//   create?(from) -> starts a new preset in settings, copied from `from` or active preset
//   reorder?(ids) -> saves the presets in the given id order; returns a Promise
//   max?          -> maximum number of presets allowed
let source = null;
const listeners = new Set();

export const notifyLaunchPresets = () => listeners.forEach(listener => listener());

export function subscribeLaunchPresets(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Returns the function that withdraws the source again.
export function provideLaunchPresets(next) {
  source = next;
  notifyLaunchPresets();
  return () => {
    if (source !== next) return;
    source = null;
    notifyLaunchPresets();
  };
}

export const launchPresets = () => source?.list() || [];
export const currentLaunchPreset = () => source?.current() || null;
export const pickLaunchPreset = id => source?.pick?.(id);
export const configureLaunchPreset = id => source?.configure(id);
export const createLaunchPreset = from => source?.create?.(from);
export const canCreateLaunchPreset = () => typeof source?.create === 'function';
export const reorderLaunchPresets = ids => source?.reorder?.(ids);
export const canReorderLaunchPresets = () => typeof source?.reorder === 'function';
export const launchPresetsMax = () => (typeof source?.max === 'number' ? source.max : Infinity);
// A preset by id, else the first, which is the one a launch naming none gets.
export function launchPreset(id) {
  const list = launchPresets();
  return list.find(preset => preset.id === id) || list[0] || null;
}
