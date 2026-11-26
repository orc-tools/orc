// The Tailscale plugin: its setup page in Settings, phone access with phone
// pairing, and Share at the top right of the plan page. Everything here talks to the
// plugin's backend under /api/tailscale, which answers only Orc on this Mac.
import { esc } from '/js/core.js';
import { extendPlanTools } from '/js/plan-page.js';
import { trackUsage } from '/js/usage-tracking.js';
import qrcode from '/vendor/orc-qr.min.js';
import { GITHUB_MARK_SVG } from '/js/dialogs.js';

// Tailscale's mark, a grid of nine dots with a T picked out, in the surrounding text colour.
export const TAILSCALE_MARK_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><g opacity=".25"><circle cx="3.5" cy="3.5" r="2.7"/><circle cx="12" cy="3.5" r="2.7"/><circle cx="20.5" cy="3.5" r="2.7"/><circle cx="3.5" cy="20.5" r="2.7"/><circle cx="20.5" cy="20.5" r="2.7"/></g><circle cx="3.5" cy="12" r="2.7"/><circle cx="12" cy="12" r="2.7"/><circle cx="20.5" cy="12" r="2.7"/><circle cx="12" cy="20.5" r="2.7"/></svg>';
const QR_GLYPH_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M21 21v-3M17 21h.01"/></svg>';
const SHARE_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const INFO_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const SETTINGS_HREF = '#settings/plugin/tailscale';

async function call(path, body) {
  const options = body === undefined ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || (response.status === 404 ? 'Turn on the Tailscale plugin in Settings → Plugins.' : 'Tailscale action failed.'));
  return data;
}
const post = (action, body = {}) => call(`/api/tailscale/${action}`, body);

// ---------- setup page ----------

// TESTABLE: tailscale setup steps
const DAY_MS = 86400000;
// Which step to act on next: the first one not done, since each needs the
// one before. Funnel is optional, so a page with only it left counts as set up
// for phone access.
export function setupProgress(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const done = list.filter(step => step.done).length;
  const next = list.findIndex(step => !step.done);
  const ready = id => {
    const at = list.findIndex(step => step.id === id);
    return at >= 0 && list.slice(0, at + 1).every(step => step.done);
  };
  return { done, total: list.length, next, phoneReady: ready('https'), shareReady: ready('funnel') };
}

export function channelNote(state) {
  if (!state) return '';
  if (state.error) return state.error;
  if (state.enabled && !state.running) return 'On, but not running yet.';
  if (!state.enabled && state.owned) return 'Off. Tailscale still has the saved route.';
  return '';
}

export function expiresIn(expiresAt, now = Date.now()) {
  const left = expiresAt * 1000 - now;
  if (!(left > 0)) return 'Expired';
  const days = Math.round(left / DAY_MS);
  if (days >= 1) return `Expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(left / 3600000));
  return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}
// END TESTABLE: tailscale setup steps

function stepHtml(step, index, next) {
  const current = index === next;
  const mark = step.done ? `<span class="ts-step-mark" data-state="done">${CHECK_SVG}</span>`
    : `<span class="ts-step-mark" data-state="${current ? 'current' : 'todo'}">${index + 1}</span>`;
  const actions = [];
  if (!step.done && step.policy) {
    actions.push(`<orc-copy-button variant="ghost" size="compact" value="${esc(step.policy)}" data-track="Tailscale setup › Copy the policy line">Copy the policy line</orc-copy-button>`);
  }
  if (!step.done && step.link && (current || step.id === 'funnel')) {
    const label = step.id === 'installed' ? 'Get Tailscale' : 'Open admin console';
    actions.push(`<a class="settings-btn-inline ts-step-link" href="${esc(step.link)}" target="_blank" rel="noopener">${label}</a>`);
  }
  if (current) actions.push('<orc-button variant="primary" size="compact" data-ts-check>Check again</orc-button>');
  return `<li class="ts-step" data-step="${esc(step.id)}"${current ? ' aria-current="step"' : ''}>
    ${mark}
    <div class="ts-step-text"><p class="ts-step-label">${esc(step.label)}</p>${step.detail ? `<p class="settings-hint">${esc(step.detail)}</p>` : ''}</div>
    ${actions.length ? `<div class="ts-step-actions">${actions.join('')}</div>` : ''}
  </li>`;
}

const SETUP_HTML = `<div class="ts-setup">
  <fieldset class="settings-fieldset ts-group">
    <legend class="settings-label" data-ts-progress>Set up</legend>
    <ol class="ts-steps" data-ts-steps><li class="settings-note" role="status">Checking Tailscale…</li></ol>
  </fieldset>
  <fieldset class="settings-fieldset ts-group">
    <legend class="settings-label">Use it for</legend>
    <section class="ts-use tailscale-channel" aria-label="Phone access">
      <orc-switch class="settings-check" data-ts-channel="phone" label="Phone access" description="Private to your tailnet · port 8443" disabled></orc-switch>
      <p class="settings-hint tailscale-switch-hint" aria-hidden="true" data-ts-hint="phone">Private to your tailnet · port 8443</p>
      <p class="settings-note tailscale-channel-status" data-ts-note="phone" role="status"></p>
      <div class="lan-actions">
        <button type="button" class="settings-btn-inline" data-ts-retry="phone" hidden>Retry connection</button>
        <button type="button" class="settings-btn-inline" data-ts-remove="phone" hidden>Remove saved route</button>
      </div>
      <div class="tailscale-live" data-ts-pairing hidden>
        <div class="tailscale-pair">
          <figure data-ts-qr hidden><img data-ts-qr-image alt="Scan to open Orc on your phone"></figure>
          <ol class="tailscale-steps">
            <li><span class="tailscale-step-mark">${TAILSCALE_MARK_SVG}</span><span>Turn on Tailscale on your phone.</span></li>
            <li><span class="tailscale-step-mark">${QR_GLYPH_SVG}</span><span>Scan the code with its camera, or open this address:<span class="tailscale-url" data-ts-phone-url></span></span></li>
            <li><span class="tailscale-step-mark">${GITHUB_MARK_SVG}</span><span>Sign in with GitHub, or enter a pairing code.</span></li>
          </ol>
        </div>
        <p class="lan-code" data-ts-code aria-live="polite"></p>
        <div class="lan-actions">
          <button type="button" class="settings-btn-inline" data-ts-pair>Show pairing code</button>
          <button type="button" class="settings-btn-inline" data-ts-sign-out>Sign out phones</button>
        </div>
        <orc-accordion class="tailscale-help" data-ts-custom label="Use your own pairing code">
          <label class="settings-field"><span>Custom pairing code</span>
            <orc-input type="password" data-ts-custom-code autocomplete="new-password" aria-label="Custom pairing code" description="6–64 letters or numbers. Not case-sensitive. Saved codes stay hidden and work until replaced."></orc-input>
          </label>
          <button type="button" class="settings-btn-inline" data-ts-custom-save>Save custom code</button>
          <p class="settings-note" data-ts-custom-status role="status"></p>
        </orc-accordion>
      </div>
    </section>
    <section class="ts-use tailscale-channel" aria-label="Share plans by link">
      <orc-switch class="settings-check" data-ts-channel="share" label="Share plans by link" description="Public through Funnel · port 10000" disabled></orc-switch>
      <p class="settings-hint tailscale-switch-hint" aria-hidden="true" data-ts-hint="share">Public through Funnel · port 10000</p>
      <p class="settings-note tailscale-channel-status" data-ts-note="share" role="status"></p>
    </section>
  </fieldset>
  <p class="settings-note" data-ts-status role="status" aria-live="polite"></p>
</div>`;

function mountSetup(slot) {
  slot.innerHTML = SETUP_HTML;
  const part = name => slot.querySelector(`[data-ts-${name}]`);
  const all = selector => [...slot.querySelectorAll(selector)];
  let last = null;
  let busy = false;
  let alive = true;

  const paintQr = url => {
    const figure = part('qr');
    const image = part('qr-image');
    figure.hidden = true;
    image.removeAttribute('src');
    if (!url) return;
    try {
      const code = qrcode(0, 'M');
      code.addData(new URL('pair', url).href);
      code.make();
      image.src = code.createDataURL(6, 24);
      figure.hidden = false;
    } catch {}
  };

  const paint = status => {
    if (!alive) return;
    last = status;
    const eligible = status?.eligible === true;
    const progress = setupProgress(status?.steps);
    part('progress').textContent = progress.total ? `Set up · ${progress.done} of ${progress.total} done` : 'Set up';
    part('steps').innerHTML = progress.total ? status.steps.map((step, index) => stepHtml(step, index, progress.next)).join('')
      : `<li class="settings-note" role="status">${esc(status?.error || 'Could not read Tailscale status.')}</li>`;
    const connected = eligible && status.connected === true;
    for (const channel of ['phone', 'share']) {
      const state = status?.[channel] || {};
      const toggle = slot.querySelector(`[data-ts-channel="${channel}"]`);
      const ready = channel === 'phone' ? progress.phoneReady : progress.shareReady;
      toggle.checked = !!state.enabled;
      // Turning access off must stay possible while Tailscale is disconnected.
      toggle.toggleAttribute('disabled', !eligible || (!state.enabled && !(connected && ready)));
      const waiting = !state.enabled && !ready ? (channel === 'phone' ? 'Finish step 4 first.' : 'Finish step 5 first.') : '';
      slot.querySelector(`[data-ts-note="${channel}"]`).textContent = eligible ? (channelNote(state) || waiting) : '';
    }
    const phone = status?.phone || {};
    const retry = slot.querySelector('[data-ts-retry="phone"]');
    retry.hidden = !eligible || !phone.enabled || !!phone.running;
    retry.disabled = !connected;
    slot.querySelector('[data-ts-remove="phone"]').hidden = !eligible || !!phone.enabled || !phone.owned;
    part('phone-url').innerHTML = phone.running && phone.url
      ? `<a href="${esc(phone.url)}" target="_blank" rel="noopener" translate="no">${esc(phone.url)}</a><orc-copy-button variant="ghost" size="compact" value="${esc(phone.url)}">Copy</orc-copy-button>` : '';
    part('pairing').hidden = !eligible || !phone.running;
    paintQr(!part('pairing').hidden && phone.url);
    if (part('pairing').hidden) part('code').textContent = '';
    const custom = !!status?.customCodeSet;
    part('pair').textContent = custom ? 'Use a random code instead' : 'Show pairing code';
    part('custom-status').textContent = custom ? 'Custom code saved and hidden. Enter a new code to replace it.' : '';
    if (custom) part('custom').open = true;
  };

  const refresh = async () => paint(await call('/api/tailscale/setup'));
  const showCode = code => {
    part('code').innerHTML = code?.code
      ? `<span class="lan-code-value" translate="no">${esc(code.code)}</span><span class="settings-note">Use once before ${esc(new Date(code.expiresAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}.</span>`
      : '';
  };
  // `act` posts and paints its own result; the page is refreshed either way.
  const perform = async act => {
    // A switch flips before its action runs, so a refused one snaps back.
    if (busy) { paint(last); return; }
    busy = true;
    const note = part('status');
    const controls = all('button, orc-switch, orc-button');
    controls.forEach(control => control.toggleAttribute('disabled', true));
    note.textContent = act ? 'Working…' : 'Checking Tailscale…';
    try {
      note.textContent = (act && await act()) || '';
    } catch (error) {
      note.textContent = error.message;
    } finally {
      controls.forEach(control => control.toggleAttribute('disabled', false));
      try { await refresh(); } catch (error) { paint({ error: error.message }); }
      busy = false;
    }
  };
  const run = action => perform(async () => { await post(action); });

  slot.addEventListener('change', event => {
    const channel = event.target.closest?.('[data-ts-channel]')?.dataset.tsChannel;
    if (!channel) return;
    const on = !!event.detail?.checked;
    trackUsage('tailscale.channel', `Tailscale › ${channel === 'phone' ? 'Phone access' : 'Share plans by link'}`, { on });
    if (channel === 'share') forgetShares();
    run(`${channel}-${on ? 'enable' : 'disable'}`);
  });
  slot.addEventListener('click', event => {
    const target = event.target.closest?.('button, orc-button');
    if (!target || target.hasAttribute('disabled')) return;
    if (target.matches('[data-ts-check]')) {
      trackUsage('tailscale.setup', 'Tailscale setup › Check again', { done: setupProgress(last?.steps).done });
      perform();
    } else if (target.matches('[data-ts-retry]')) run('phone-enable');
    else if (target.matches('[data-ts-remove]')) run('phone-disable');
    // With a custom code saved there is no code to show, so the button swaps it for a random one.
    else if (target.matches('[data-ts-pair]')) {
      perform(async () => {
        showCode(last?.customCodeSet ? (await call('/api/lan/pairing-code', {})).pairing : await post('pairing-code'));
      });
    } else if (target.matches('[data-ts-sign-out]')) {
      perform(async () => {
        await post('sign-out-all');
        showCode(null);
        return 'All paired phones are signed out.';
      });
    } else if (target.matches('[data-ts-custom-save]')) {
      perform(async () => {
        const input = part('custom-code');
        await call('/api/lan/custom-code', { code: input.value });
        input.value = '';
        showCode(null);
      });
    }
  });
  perform();
  return () => {
    alive = false;
    const input = part('custom-code');
    if (input) input.value = '';
    slot.replaceChildren();
  };
}

// ---------- Share plan ----------

// What the plugin knows about each run's share, so a repaint draws at once.
const shares = new Map();
const SHARE_TTL_MS = 30000;

// Sharing was turned on or off in Settings: a plan page kept open behind it
// drops what it showed, and the next one asks again.
function forgetShares() {
  shares.clear();
  document.querySelectorAll('[data-ts-share-card]').forEach(node => node.remove());
}

// The card at the foot of the steps panel. Messages are one plain line; only
// a live share, with its link and Stop sharing, gets a box.
function shareCard(runId, entry) {
  if (entry.error) {
    return { plain: true, html: `<p class="ts-share-error" role="alert">${esc(entry.error)}</p>` };
  }
  const state = entry.state || {};
  if (entry.offered && !state.available) {
    return { plain: true, html: `<p class="ts-share-off" role="status">${INFO_SVG}<span>Sharing by link is off. Turn it on in <a href="${SETTINGS_HREF}">settings</a>.${state.error ? ` ${esc(state.error)}` : ''}</span></p>` };
  }
  const share = state.share;
  if (!share) return null;
  return { plain: false, html: `<p class="ts-share-title"><span class="ts-share-dot" aria-hidden="true"></span>Anyone with the link can read this plan</p>
    <p class="ts-share-note">A read-only copy of the plan as it is now, pictures included. Nothing else on this Mac is reachable from it.</p>
    <div class="ts-share-link">
      <input class="ts-share-url" readonly value="${esc(share.url)}" aria-label="Share link" translate="no">
      <orc-copy-button variant="ghost" size="compact" value="${esc(share.url)}" data-track="Plan › Copy share link">Copy</orc-copy-button>
    </div>
    <p class="ts-share-foot"><span>${esc(expiresIn(share.expiresAt))} · this Mac must be awake</span>
      <button type="button" class="ts-share-stop" data-ts-share-stop="${esc(runId)}">Stop sharing</button></p>` };
}

// Share sits at the top right of the plan page, beside the plan's title.
function paintShare(runId, actions, work) {
  actions.querySelectorAll('[data-ts-share-button]').forEach(node => node.remove());
  work.querySelectorAll('[data-ts-share-card]').forEach(node => node.remove());
  const entry = shares.get(runId) || {};
  // Only Orc on this Mac can share; anywhere else the backend says no.
  if (entry.refused) return;
  const shared = !!entry.state?.share;
  const button = document.createElement('orc-button');
  button.setAttribute('variant', 'ghost');
  button.setAttribute('size', 'compact');
  button.className = 'ts-share-button';
  button.dataset.planExtension = 'tailscale';
  button.dataset.tsShareButton = runId;
  if (shared) button.dataset.shared = '';
  if (entry.busy) button.setAttribute('disabled', '');
  button.setAttribute('aria-label', shared ? 'Share this plan again, updating the copy at the same link' : 'Share a read-only copy of this plan by link');
  button.innerHTML = `${SHARE_SVG}<span>${entry.busy ? 'Sharing…' : shared ? 'Share again' : 'Share'}</span>`;
  actions.append(button);
  const shown = shareCard(runId, entry);
  if (!shown) return;
  const card = document.createElement('div');
  card.className = shown.plain ? 'ts-share-card ts-share-plain' : 'ts-share-card';
  card.dataset.planExtension = 'tailscale';
  card.dataset.tsShareCard = runId;
  card.innerHTML = shown.html;
  work.append(card);
}

function renderShare({ runId, layout, actions, work }) {
  if (layout !== 'page' || window.ORC_INSTANCE?.remote) return;
  paintShare(runId, actions, work);
  const entry = shares.get(runId);
  if (entry?.busy || (entry?.at && Date.now() - entry.at < SHARE_TTL_MS)) return;
  shares.set(runId, { ...entry, at: Date.now() });
  fetch(`/api/tailscale/share?run=${encodeURIComponent(runId)}`, { cache: 'no-store' })
    .then(async response => {
      if (response.status === 403 || response.status === 404) {
        shares.set(runId, { ...shares.get(runId), refused: true });
        return;
      }
      if (response.ok) shares.set(runId, { ...shares.get(runId), state: await response.json(), error: null, at: Date.now() });
    })
    .catch(() => {})
    .finally(() => { if (actions.isConnected) paintShare(runId, actions, work); });
}

async function shareAction(runId, action, holder) {
  const layout = holder.closest('.plan-layout');
  const actions = layout?.querySelector('.plan-actions');
  const work = layout?.querySelector('.plan-work');
  const repaint = () => { if (actions?.isConnected && work) paintShare(runId, actions, work); };
  shares.set(runId, { ...shares.get(runId), busy: true, error: null, offered: true });
  repaint();
  try {
    const state = await post(action, { runId });
    shares.set(runId, { state, at: Date.now(), offered: true });
    if (action === 'share' && state.share) {
      try { await navigator.clipboard?.writeText(state.share.url); } catch {}
    }
  } catch (error) {
    // Ask again whether sharing is on, so a refusal for that reason shows the
    // way to turn it on rather than the backend's error text.
    let state = shares.get(runId)?.state;
    try { state = await call(`/api/tailscale/share?run=${encodeURIComponent(runId)}`); } catch {}
    const off = state && !state.available;
    shares.set(runId, { state, offered: true, busy: false, error: off ? null : error.message, at: off ? Date.now() : 0 });
  }
  repaint();
  (work?.querySelector('[data-ts-share-card] .ts-share-url') || actions?.querySelector('[data-ts-share-button]'))?.focus?.();
}

function onPlanClick(event) {
  const share = event.target.closest?.('[data-ts-share-button]');
  if (share && !share.hasAttribute('disabled')) {
    const again = share.hasAttribute('data-shared');
    trackUsage('tailscale.share', again ? 'Plan › Share again' : 'Plan › Share');
    shareAction(share.dataset.tsShareButton, 'share', share);
    return;
  }
  const stop = event.target.closest?.('[data-ts-share-stop]');
  if (stop) {
    trackUsage('tailscale.share', 'Plan › Stop sharing');
    shareAction(stop.dataset.tsShareStop, 'share-stop', stop);
  }
}

export function activate({ signal, base, settings }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = base + 'tailscale.css';
  style.dataset.tailscaleStyle = '';
  document.head.append(style);
  settings(slot => mountSetup(slot));
  const unextend = extendPlanTools('tailscale', renderShare);
  document.addEventListener('click', onPlanClick, { signal });
  return () => {
    unextend();
    shares.clear();
    style.remove();
  };
}
