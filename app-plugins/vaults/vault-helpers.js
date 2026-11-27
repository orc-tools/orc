// The vault helpers that both Orc's Vaults screen (frontend.js) and a
// vault's standalone app (vault-app.js) use. Nothing here touches Orc.

// TESTABLE: vault helpers
const VAULT_SOUL_LIMIT = 8192;
const VAULT_NOTE_LIMIT = 262144;
function vaultByteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}
function vaultCountLabel(bytes, limit) {
  return `${bytes.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} bytes${bytes > limit ? ' — too long' : ''}`;
}
// The server decodes the whole path, so each part is encoded on its own and the slashes stay.
function vaultNoteUrl(slug, path) {
  return `/api/vaults/${encodeURIComponent(slug)}/notes/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}
function vaultNotePath(value) {
  const path = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!path) return '';
  return /\.(md|txt)$/i.test(path) ? path : `${path}.md`;
}
function vaultSizeLabel(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function vaultPlural(count, word) {
  const number = Number(count) || 0;
  return `${number.toLocaleString('en-US')} ${word}${number === 1 ? '' : 's'}`;
}
// A vault keeps one colour for life: its slug never changes, its name can.
function vaultHue(slug) {
  let hash = 0;
  for (const char of String(slug ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}
function vaultsByNeed(vaults) {
  const waiting = vault => (Number(vault?.pending) > 0 ? 0 : 1);
  return [...(vaults || [])].sort((a, b) => waiting(a) - waiting(b));
}
// A tiny note still shows a sliver, so no listed note has an empty bar.
function vaultMeterPercent(size, largest) {
  const bytes = Number(size) || 0;
  const most = Number(largest) || 0;
  if (bytes <= 0 || most <= 0) return 0;
  return Math.max(4, Math.min(100, Math.round((bytes / most) * 100)));
}
// A tool the page's builder was refused or allowed, in words:
// mcp__claude_ai_Notion__search is "Notion: search".
function vaultToolLabel(tool) {
  const name = String(tool ?? '');
  if (name === 'WebSearch') return 'Web search';
  if (name === 'WebFetch') return 'Reading web pages';
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!match) return name;
  const words = text => text.replace(/^claude_ai_/, '').split(/[_-]+/).filter(Boolean).join(' ');
  return `${words(match[1])}: ${words(match[2]).toLowerCase()}`;
}
// Who started a build, as the line under the box names them.
function vaultBuildSource(build) {
  if (build?.source === 'automation') return build.title ? `“${build.title}”` : 'An automation';
  if (build?.source === 'entries') return 'An approved entry';
  return '';
}
// The page is shown through the frame Orc wraps it in, which keeps it from
// going anywhere else. The address changes with the page's version, so each
// of a build's saves loads afresh, and carries Orc's mode, which the page
// paints in from the start.
function vaultPageUrl(slug, version, mode) {
  const shown = mode === 'light' || mode === 'dark' ? `&mode=${mode}` : '';
  return `/api/vaults/${encodeURIComponent(slug)}/frame?v=${encodeURIComponent(version ?? '')}${shown}`;
}
// Orc's mode, light or dark: the one the document wears (Orc's shell always
// sets data-theme to it), else the one saved for this browser (`saved`, from
// the orcTheme key), else the system's.
function vaultMode(theme, saved, systemDark) {
  if (theme === 'light' || theme === 'dark') return theme;
  if (saved === 'light' || saved === 'dark') return saved;
  return systemDark ? 'dark' : 'light';
}
// A link a page asked Orc to open, when it is one Orc may open: a web
// address on another site. `own` is Orc's own origin.
function vaultLink(href, own) {
  let url;
  try { url = new URL(String(href ?? '')); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === own || url.href.length > 2000 || url.username || url.password) return null;
  return { href: url.href, host: url.hostname.toLowerCase(), label: `${url.hostname}${url.pathname === '/' ? '' : url.pathname}` };
}
// Whether a page's link to `host` may open without asking: the user chose
// that site, or a site it sits under, for this page.
function vaultTrustsLink(host, sites) {
  return (sites || []).some(site => host === site || String(host).endsWith(`.${site}`));
}
function vaultBuildEndedLine(build) {
  if (build?.outcome === 'completed') return build.reply || 'The page is built.';
  return build?.error ? `The build stopped: ${build.error}` : 'The build stopped.';
}
// The vault's own address on a phone: Orc's private Tailscale address with
// the vault's path, or '' while phone access is off.
function vaultPermalink(phoneUrl, slug) {
  if (!phoneUrl || !slug) return '';
  try { return new URL(`vault/${encodeURIComponent(slug)}`, phoneUrl).href; } catch { return ''; }
}
// A page can hold its own box, through the orcVault bridge Orc gives it (see
// page-script.js). This is what it is sent: whether it is building,
// and the conversation so far, oldest first, with an ask in flight last.
const VAULT_PAGE_TURNS = 6;
const VAULT_PAGE_ASK_MAX = 8000;
function vaultPageState(detail, error = '') {
  const build = detail?.build || {};
  const building = build.state === 'building';
  const history = Array.isArray(detail?.history) ? detail.history.slice(-VAULT_PAGE_TURNS) : [];
  const turns = history.map(item => {
    const failed = item?.outcome !== 'completed';
    return { asked: String(item?.prompt || ''), from: vaultBuildSource(item), at: item?.at || '',
      reply: failed ? vaultBuildEndedLine(item) : item.reply || 'Done.', failed, pending: false };
  });
  if (building) turns.push({ asked: String(build.prompt || ''), from: vaultBuildSource(build), at: build.startedAt || '', reply: '', failed: false, pending: true });
  return {
    building, activity: building ? build.activity || 'Working' : '',
    turns: turns.slice(-VAULT_PAGE_TURNS), error: String(error || ''),
  };
}
// What a page's message asks of Orc: {ask: text}, {stop: true} or {ready:
// true}, or null for anything else. An ask is trimmed and must say something.
function vaultPageRequest(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.orcVaultAsk === 'string') {
    const text = data.orcVaultAsk.trim();
    return text && text.length <= VAULT_PAGE_ASK_MAX ? { ask: text } : null;
  }
  if (data.orcVaultStop === true) return { stop: true };
  if (data.orcVaultReady === true) return { ready: true };
  return null;
}
// Whether an ask from the page comes from the user's own click or key in
// it: the browser counts a gesture as fresh, and for as long as a gesture
// stays fresh Orc itself saw no click or key and the page has been on show.
// So the page's script cannot borrow one made in Orc (the click that opened
// the vault), and a page that just loaded cannot borrow the click that
// rebuilt it, which would build again and again.
const VAULT_GESTURE_MS = 5000;
function vaultPageGesture({ active, sinceOrcInput, sinceShown }) {
  return !!active && Number(sinceOrcInput) > VAULT_GESTURE_MS && Number(sinceShown) > VAULT_GESTURE_MS;
}
// Where the things that float over a vault's page sit, as fractions of the
// room each can move in: x 0 is the left edge and 1 the right, y 0 the top
// and 1 the bottom. The menu button starts top right and the chat at the
// foot, in the middle; anything unreadable puts them back there.
const VAULT_PLACE_HOMES = Object.freeze({ dock: Object.freeze({ x: 1, y: 0 }), chat: Object.freeze({ x: 0.5, y: 1 }) });
const VAULT_PLACE_STEP = 0.05;
function vaultPlaceAt(value, home) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (value == null || !Number.isFinite(x) || !Number.isFinite(y)) return { x: home.x, y: home.y };
  const clamp = number => Math.round(Math.min(1, Math.max(0, number)) * 1000) / 1000;
  return { x: clamp(x), y: clamp(y) };
}
// A vault's layout on this Mac, from what was stored: where the menu button
// and the chat sit, whether the chat shows the conversation, and whether it
// is shrunk to a button.
function vaultLayout(stored) {
  let value = stored;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  return {
    dock: vaultPlaceAt(value?.dock, VAULT_PLACE_HOMES.dock),
    chat: vaultPlaceAt(value?.chat, VAULT_PLACE_HOMES.chat),
    history: value?.history === true,
    small: value?.small === true,
  };
}
// The place a thing dragged with the pointer at (clientX, clientY) lands,
// held where it was grabbed (box.grabX, box.grabY from its corner), within
// `room` ({left, top, width, height}) less a margin on every side. A thing
// as wide or tall as the room keeps home's place on that side.
function vaultPlaceFromPoint({ clientX, clientY }, room, box, margin, home) {
  const spanX = room.width - box.width - 2 * margin;
  const spanY = room.height - box.height - 2 * margin;
  return vaultPlaceAt({
    x: spanX > 0 ? (clientX - box.grabX - room.left - margin) / spanX : home.x,
    y: spanY > 0 ? (clientY - box.grabY - room.top - margin) / spanY : home.y,
  }, home);
}
function vaultPlaceNudge(at, key, home) {
  if (key === 'Home') return { x: home.x, y: home.y };
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!step) return null;
  const from = vaultPlaceAt(at, home);
  return vaultPlaceAt({ x: from.x + step[0] * VAULT_PLACE_STEP, y: from.y + step[1] * VAULT_PLACE_STEP }, home);
}
// END TESTABLE: vault helpers

export {
  VAULT_NOTE_LIMIT, VAULT_SOUL_LIMIT, vaultBuildSource, vaultByteLength, vaultCountLabel, vaultHue, vaultLink, vaultMeterPercent, vaultMode, vaultNotePath, vaultNoteUrl, vaultPageUrl, vaultPlural, vaultSizeLabel, vaultToolLabel, vaultsByNeed,
  VAULT_PLACE_HOMES, vaultBuildEndedLine, vaultLayout, vaultPlaceFromPoint, vaultPlaceNudge, vaultPageGesture, vaultPageRequest, vaultPageState, vaultPermalink, vaultTrustsLink,
};
