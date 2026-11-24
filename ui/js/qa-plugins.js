// QA browser plugins: an app plugin's `contributes.qaBrowser` adds toolbar
// buttons and a page script to the QA window's browser, on the hosts it names.
//
// In Orc.app the page script runs in the native pane inside a content world
// of its own, so the tested page's scripts never see it. A toolbar press asks
// the app to call the handler the script registered for that button.

// `*` stands for one or more characters of a single host label, so
// `*.example.test` is any subdomain and `example-*.localhost` any suffix.
export function hostRegex(pattern) {
  const parts = String(pattern).toLowerCase().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return '^' + parts.join('[a-z0-9-]+') + '$';
}

export function hostMatches(hosts, url) {
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return (hosts || []).some(pattern => new RegExp(hostRegex(pattern)).test(hostname));
}

// The enabled plugins that contribute to the QA browser, with their script's
// address under the plugin's digest-pinned asset path.
export function qaBrowserPlugins(state = globalThis.ORC_APP_PLUGINS) {
  return (state?.plugins || [])
    .filter(plugin => plugin.enabled && !plugin.error && plugin.contributes?.qaBrowser)
    .map(plugin => {
      const spec = plugin.contributes.qaBrowser;
      return {
        id: plugin.id,
        hosts: spec.hosts || [],
        script: spec.script ? plugin.base + spec.script : null,
        buttons: (spec.buttons || []).map(button => ({ id: button.id, label: button.label })),
      };
    });
}

// The buttons the toolbar shows for the page at `url`.
export function buttonsFor(plugins, url) {
  return plugins.filter(plugin => hostMatches(plugin.hosts, url))
    .flatMap(plugin => plugin.buttons.map(button => ({ plugin: plugin.id, ...button })));
}

// The script the pane runs on every page: it returns at once on a host the
// plugin did not name, and otherwise hands the plugin's code `orcQa`, whose
// `button(id, handler)` registers what a toolbar press does. The handler gets
// `{ center }` (the button's middle, in px from the pane's left edge) and
// returns whether its panel is now open.
export function pageScriptSource(plugin, source) {
  const patterns = JSON.stringify(plugin.hosts.map(hostRegex));
  const id = JSON.stringify(plugin.id);
  return `(() => {
  "use strict";
  const host = location.hostname.toLowerCase();
  if (!${patterns}.some(pattern => new RegExp(pattern).test(host))) return;
  const registry = window.__orcQa || (window.__orcQa = {
    handlers: new Map(),
    press(plugin, button, options) {
      const handler = this.handlers.get(plugin + "/" + button);
      return handler ? Boolean(handler(options || {})) : null;
    },
  });
  const orcQa = { button: (button, handler) => registry.handlers.set(${id} + "/" + button, handler) };
  (function (orcQa) {
${source}
  })(orcQa);
})();
`;
}

// Fetches each plugin's script and wraps it. A script that fails to load is
// left out, so one broken plugin never stops the others.
export async function loadPageScripts(plugins, fetchText = url => fetch(url, { cache: 'no-cache' }).then(answer => {
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`);
  return answer.text();
})) {
  const loaded = await Promise.all(plugins.filter(plugin => plugin.script).map(async plugin => {
    try {
      return { plugin: plugin.id, source: pageScriptSource(plugin, await fetchText(plugin.script)) };
    } catch {
      return null;
    }
  }));
  return loaded.filter(Boolean);
}
