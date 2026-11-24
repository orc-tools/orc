// Each enabled theme's scene module, loaded on demand: its send-off scenes,
// its Factory floor and its look. A theme without a part gets the default
// theme's.
import { availableThemes, defaultTheme, paintedFunMode } from './fun-modes.js';

export async function preloadScenes(theme = paintedFunMode()) {
  const themes = availableThemes();
  const selected = themes.some(item => item.id === theme) ? theme : defaultTheme();
  const loaded = new Map(await Promise.all(themes.filter(theme => theme.id === selected || theme.required).map(async theme => {
    const scene = theme.scene ? (await import(theme.base + theme.scene)).default : {};
    return [theme.id, { ...scene, look: scene.look || {} }];
  })));
  const fallback = loaded.get(defaultTheme());
  return {
    selected,
    sceneLook(theme) {
      const look = loaded.get(theme)?.look || {};
      return { ...fallback.look, ...look, words: { ...fallback.look.words, ...look.words } };
    },
    createScene(name, theme, container, title) { return (loaded.get(theme)?.[name] || fallback[name])(container, title); },
  };
}
