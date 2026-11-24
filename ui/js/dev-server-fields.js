// The project's saved Live dev server (`repos[key].worktreeServer`), or null
// when it is off. Off is the key's absence, never `false`.
export function projectWorktreeServer(entry) {
  const value = entry?.worktreeServer;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const optionalNumber = (raw, { integer, min, max }) => {
  const text = String(raw ?? '').trim();
  if (!text) return { blank: true };
  const number = Number(text);
  const ok = Number.isFinite(number) && (!integer || Number.isInteger(number)) && number >= min && number <= max;
  return ok ? { value: number } : { invalid: true };
};

// Writes the dev server fields into a project's config entry. A field that
// would break worktree setup (an empty command, a port out of range) keeps
// what was saved instead, so a half-typed value never reaches config.json;
// keys this form doesn't show survive.
export function writeProjectWorktreeServer(base, { enabled, command, install, copy, port, readyTimeout }) {
  const stored = projectWorktreeServer(base);
  if (!enabled) { delete base.worktreeServer; return; }
  const value = { ...(stored || {}) };
  const typed = String(command ?? '').trim();
  if (typed) value.command = typed;
  if (!value.command) { if (!stored) delete base.worktreeServer; return; }
  const installText = String(install ?? '').trim();
  if (installText) value.install = installText; else delete value.install;
  const paths = String(copy ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  if (paths.length) value.copy = paths; else delete value.copy;
  for (const [key, raw, rule] of [
    ['port', port, { integer: true, min: 1, max: 65535 }],
    ['readyTimeout', readyTimeout, { integer: false, min: 0, max: Infinity }],
  ]) {
    const parsed = optionalNumber(raw, rule);
    if (parsed.blank) delete value[key];
    else if (!parsed.invalid) value[key] = parsed.value;
  }
  base.worktreeServer = value;
}

export function devServerCommandFieldHtml(server = {}, esc, { idPrefix = 'proj-dev' } = {}) {
  return `<div class="settings-field">
            <label class="proj-dev-label" for="${idPrefix}-command">Command</label>
            <input id="${idPrefix}-command" data-proj-dev="command" type="text" maxlength="1000" autocomplete="off" spellcheck="false" translate="no"
                   aria-describedby="hint-${idPrefix}-command" placeholder="npm run dev -- --port {port}" value="${esc(server.command || '')}">
            <p class="settings-hint" id="hint-${idPrefix}-command">Runs in the worktree. Use <code translate="no">{port}</code> and <code translate="no">{path}</code>.</p>
          </div>`;
}

export function devServerExtraFieldsHtml(server = {}, esc, { idPrefix = 'proj-dev' } = {}) {
  return `<div class="settings-field">
            <label class="proj-dev-label" for="${idPrefix}-install">Install command</label>
            <input id="${idPrefix}-install" data-proj-dev="install" type="text" maxlength="1000" autocomplete="off" spellcheck="false" translate="no"
                   placeholder="npm install" value="${esc(server.install || '')}">
          </div>
          <div class="settings-field">
            <label class="proj-dev-label" for="${idPrefix}-copy">Copy into each worktree (one path per line)</label>
            <textarea id="${idPrefix}-copy" data-proj-dev="copy" rows="3" spellcheck="false" translate="no" placeholder=".env.local">${esc((Array.isArray(server.copy) ? server.copy : []).join('\n'))}</textarea>
          </div>
          <div class="proj-dev-server-row">
            <div class="settings-field">
              <label class="proj-dev-label" for="${idPrefix}-port">Port</label>
              <input id="${idPrefix}-port" data-proj-dev="port" type="number" min="1" max="65535" step="1" inputmode="numeric" value="${esc(String(server.port ?? ''))}">
            </div>
            <div class="settings-field">
              <label class="proj-dev-label" for="${idPrefix}-ready">Ready timeout (seconds)</label>
              <input id="${idPrefix}-ready" data-proj-dev="readyTimeout" type="number" min="0" step="any" placeholder="60" value="${esc(String(server.readyTimeout ?? ''))}">
            </div>
          </div>
          <p class="settings-hint">Install runs once per worktree and existing files are not overwritten. Leave Port blank for a port of the project’s own.</p>`;
}

export function devServerFieldsHtml(server, esc, on = true, options = {}) {
  return `<div class="proj-dev-server-fields" data-proj-dev-server-fields ${on ? '' : 'hidden'}>
          ${devServerCommandFieldHtml(server, esc, options)}
          ${devServerExtraFieldsHtml(server, esc, options)}
        </div>`;
}

export function devServerValues(row, enabled = true) {
  const field = name => row.querySelector(`[data-proj-dev="${name}"]`)?.value ?? '';
  return { enabled, command: field('command'), install: field('install'), copy: field('copy'),
    port: field('port'), readyTimeout: field('readyTimeout') };
}
