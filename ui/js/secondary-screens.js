import { $, showToast } from './core.js';
import { settingsViewActive } from './settings.js';

export const FACTORY_KEY = '__factory__';
let factory;
export const loadFactory = async () => (factory ??= await import('./factory.js'));
export const factoryShowing = () => factory?.factoryShowing();
export const factoryMounted = id => factory?.factoryMounted(id);
export const updateFactoryRun = run => factory?.updateFactoryRun(run);
export const unmountFactory = () => factory?.unmountFactory();

export function openYearInReview(kind) {
  return import('./year-in-review.js').then(module => module.openYearInReview(kind))
    .catch(error => showToast(error.message));
}

export function bindSettingsSearch() {
  let generation = 0;
  let search;
  function open(fromShortcut) {
    if (!settingsViewActive || $('settings-view').hidden) return false;
    if (fromShortcut && document.querySelector('orc-dialog[open]:not(#settings-search), #lightbox.open')) return false;
    if (search) return search.openSettingsSearch({ fromShortcut });
    const requested = ++generation;
    import('./settings-search.js').then(module => {
      search = module;
      if (requested === generation && settingsViewActive) search.openSettingsSearch({ fromShortcut });
    }).catch(error => showToast(error.message));
    return true;
  }
  window.orcOpenSettingsSearch = () => open(true);
  window.orcCloseSettingsSearch = () => {
    generation++;
    search?.closeSettingsSearch({ restoreFocus: false });
  };
  $('settings-view')?.addEventListener('click', event => {
    if (event.target.closest?.('#settings-search-btn') && open(false)) event.preventDefault();
  });
  document.addEventListener('keydown', event => {
    if (!event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey)
        && event.key.toLowerCase() === 'f' && open(true)) event.preventDefault();
  });
}
