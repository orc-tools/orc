// Top-level side effects depend on this import order.

import './core.js';
import './accordion.js';
import './mermaid.js';
import './filters.js';
import './dialogs.js';
import './control.js';
import './artifact.js';
import './diff.js';
import './settings.js';
import './scenes.js';
import './activity.js';
import './palette.js';
import { bindSettingsSearch } from './secondary-screens.js';
import './merge-plan.js';
import './project-order.js';
import './sidebar-footer.js';
// Paints the sidebar logo's face. Nothing else in core imports it now the
// assistant, which also draws faces, is a plugin.
import './persona.js';
import './terminal.js';
import './diff-panel.js';
import './swipe-nav.js';

import { linkChecked } from './link.js';
import * as scenes from './send-offs.js';
import { lastRunsStr } from './activity.js';
import { showToast } from './core.js';
import { startUsageTracking } from './usage-tracking.js';
import { startHostTheme } from './host-theme.js';
import { startChatSettings } from './chat-settings.js';
import { startAppPlugins } from './app-plugins.js';
import { startProviderUsage } from './provider-usage.js';
import { startTypingFx } from './typing-fx.js';
import { startPluginSetup } from './plugin-settings.js';
import { startOrchestrate } from './orchestrate.js';
import { startShipWhenDone } from './ship-when-done.js';
import { arriveFromLaptop } from './laptop-switch.js';
import { startImageMenu } from './image-menu.js';
import { installTextStageLinks } from './text-stage.js';

// Ship and PR actions run in iframes; expose the host scene runner before
// plugins finish starting, while keeping window.orcScenes as the startup-settled hook.
const hostScenes = {
  ...scenes,
  playYeet: options => scenes.playYeet(options),
  playPrOpened: options => scenes.playPrOpened(options),
};
window.orcSceneHost = hostScenes;
bindSettingsSearch();
startUsageTracking();
startImageMenu();
installTextStageLinks();
startTypingFx();
// Orchestrate's presets load beside the plugins; a model picker opened
// before they arrive moves to its Presets tab when they do.
startOrchestrate();
startShipWhenDone();
await startAppPlugins();
// After plugins, so the first usage check already knows which plugin rows to expect.
startProviderUsage();
startHostTheme();
startChatSettings();
startPluginSetup().catch(error => showToast(error.message));
window.orcScenes = hostScenes;
arriveFromLaptop(() => lastRunsStr !== null && linkChecked());
