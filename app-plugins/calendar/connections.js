import { esc } from '/js/core.js';
import { quietDuringMeetings, setQuietDuringMeetings } from './meeting-quiet.js';

/* Google's own mark, in its own colours on any theme. */
const GOOGLE_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
export const CALENDAR_GLYPH = '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>';
const FEED_MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CALENDAR_GLYPH}</svg>`;

function sourceHead(mark, glyph, status, hint) {
  return `<div class="cal-source-head">
    <span class="cal-source-mark${glyph ? ' is-glyph' : ''}">${mark}</span>
    <div class="cal-source-text">${status}<p class="settings-hint">${hint}</p></div>
  </div>`;
}

export function connectSteps() {
  return `<div class="cal-steps">
    <section><h4>Google Calendar</h4><ol>
      <li><a href="https://calendar.google.com/calendar/u/0/r/settings" target="_blank" rel="noopener noreferrer">Open Google Calendar settings</a>.</li>
      <li>Pick your calendar under <strong>Settings for my calendars</strong>.</li>
      <li>Open <strong>Integrate calendar</strong> and copy <strong>Secret address in iCal format</strong>.</li></ol>
      <p class="cal-note">An iCal address is read-only. To change events from Orc, sign in with Google instead.</p></section>
    <section><h4>Outlook</h4><ol>
      <li><a href="https://outlook.live.com/calendar/0/options/calendar/SharedCalendars" target="_blank" rel="noopener noreferrer">Open Outlook settings</a> (for work or school, use your organisation’s Outlook).</li>
      <li>Choose <strong>Calendar → Shared calendars → Publish a calendar</strong>, if your account permits it.</li>
      <li>Choose the details you want to share and copy the <strong>ICS</strong> link, not the HTML link.</li></ol>
      <p class="cal-note">Publishing shares those details with anyone who has the link. This is not a private account login.</p></section>
    <section><h4>Mac Calendar / iCloud</h4><ol>
      <li>Only if you want to publish: right-click the iCloud calendar and choose <strong>Share Calendar…</strong>.</li>
      <li>Tick <strong>Public Calendar</strong> and copy the <code>webcal://</code> link.</li></ol>
      <p class="cal-note">Publishing makes the calendar accessible to anyone who has the link. It is not a private iCloud login; do not publish a calendar you need to keep private.</p></section>
    </div>`;
}

export function connectForm(submitLabel, prefix = 'calendar', embedded = false) {
  const tag = embedded ? 'div' : 'form';
  return `<${tag} id="${prefix}-connect-form" class="cal-connect-form" ${embedded ? 'role="group" aria-label="Connect a calendar"' : 'novalidate'}>
    <label for="${prefix}-url">Calendar address</label>
    <div class="cal-connect-row">
      <input id="${prefix}-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="off" required placeholder="https://… or webcal://…" aria-describedby="${prefix}-url-hint ${prefix}-connect-error">
      <button type="${embedded ? 'button' : 'submit'}" id="${prefix}-connect" class="cal-primary" data-label="${esc(submitLabel)}">${esc(submitLabel)}</button>
    </div>
    <p id="${prefix}-url-hint" class="cal-note">The address is stored in the macOS Keychain and only read by Orc on this Mac. Treat it like a password.</p>
    <p id="${prefix}-connect-error" class="cal-error" role="alert"></p>
  </${tag}>`;
}

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_WAIT_MS = 5 * 60 * 1000;
const HEX = /^#[0-9a-f]{6}$/i;

async function readGoogle(signal) {
  const start = new Date();
  const end = new Date(start.getTime() + 86400000);
  const response = await fetch(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, { signal, cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Could not check Google Calendar.');
  return data;
}

async function post(path, body, signal) {
  const response = await fetch(path, { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update Google Calendar. Try again.');
  return data;
}

/* Sends the system browser to Google and waits for the sign-in to land back in Orc.
   say(text, url) reports progress; url is the sign-in page when the browser did not open. */
export async function googleSignIn(signal, say) {
  const before = (await readGoogle(signal)).google?.signIns;
  const started = await post('/api/calendar/google/login', {}, signal);
  say(started.opened ? 'Finish signing in in your browser. This updates when you are done.'
    : 'Your browser did not open. Open the sign-in page to continue.', started.opened ? '' : started.url);
  const deadline = Date.now() + SIGN_IN_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, SIGN_IN_POLL_MS));
    if (signal.aborted) throw new DOMException('Sign-in abandoned', 'AbortError');
    const google = (await readGoogle(signal)).google || {};
    if (google.error) throw new Error(google.error);
    if (google.signIns !== before) return;
  }
  throw new Error('The sign-in was not finished. Try again.');
}

/* The sign-in control the connect panel, the add dialog and Settings share. */
export function googleSignInHtml(google, canConnect, label = 'Sign in with Google') {
  if (!canConnect) return '';
  if (!google?.configured) {
    return `<p class="cal-note">Orc has no Google sign-in app yet. <a href="#settings/plugin/calendar">Add yours in Calendar settings</a>, then sign in.</p>`;
  }
  return `<div class="cal-google-signin">
      <button type="button" class="cal-primary cal-google-btn" data-google="sign-in" data-label="${esc(label)}" data-track="Sign in with Google"><span class="cal-google-chip">${GOOGLE_MARK}</span>${esc(label)}</button>
      <a data-google-link target="_blank" rel="noopener noreferrer" hidden>Open the sign-in page</a>
    </div>
    <p class="cal-note" role="status" data-google-progress></p>
    <p class="cal-error" role="alert" data-google-error></p>`;
}

export function wireGoogleSignIn(root, signal, done) {
  let running = false;
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-google="sign-in"]');
    if (!button || running) return;
    const scope = button.closest('.cal-google-signin').parentElement;
    const progress = scope.querySelector('[data-google-progress]');
    const error = scope.querySelector('[data-google-error]');
    const link = scope.querySelector('[data-google-link]');
    running = true;
    button.disabled = true;
    error.textContent = '';
    progress.textContent = 'Opening Google in your browser…';
    try {
      await googleSignIn(signal, (text, url) => {
        progress.textContent = text;
        link.hidden = !url;
        if (url) link.href = url;
      });
      if (!signal.aborted) done();
    } catch (failure) {
      if (signal.aborted) return;
      error.textContent = failure.message;
    } finally {
      running = false;
      if (button.isConnected) {
        button.disabled = false;
        progress.textContent = '';
        link.hidden = true;
        if (error.textContent) button.focus();
      }
    }
  }, { signal });
}

function ownAppHtml(google) {
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  return `<orc-accordion class="cal-provider-help cal-own-app"${google.configured ? '' : ' open'} label="Use your own Google sign-in app">
    <div class="cal-help-body">
    <ol class="cal-app-steps">
      <li>${link('https://console.cloud.google.com/projectcreate', 'Create a Google Cloud project')}, or pick one you have.</li>
      <li>${link('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', 'Enable the Google Calendar API')} for it.</li>
      <li>In ${link('https://console.cloud.google.com/auth/audience', 'Google Auth Platform, Audience')}, set up the consent screen and choose <strong>Publish app</strong>, or <strong>Internal</strong> in a Workspace. An app left in Testing signs you out every 7 days.</li>
      <li>In ${link('https://console.cloud.google.com/auth/clients', 'Clients')}, create a client of type <strong>Desktop app</strong>.</li>
      <li>Paste its client ID and client secret here, then sign in. Google warns that it has not verified your app: choose <strong>Advanced</strong> to continue.</li>
    </ol>
    <div class="cal-app-form" role="group" aria-label="Your Google sign-in app">
      <div class="cal-field"><label for="calendar-google-client">Client ID</label>
        <input id="calendar-google-client" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200" placeholder="…apps.googleusercontent.com" value="${esc(google.clientId || '')}"></div>
      <div class="cal-field"><label for="calendar-google-secret">Client secret</label>
        <input id="calendar-google-secret" type="password" autocomplete="off" maxlength="256" placeholder="${google.ownClient ? 'Saved in the Keychain. Paste to replace it.' : 'GOCSPX-…'}"></div>
      <div class="cal-app-buttons">
        <button type="button" class="settings-btn-inline" data-google="save-app">Save sign-in app</button>
        ${google.ownClient ? `<button type="button" class="settings-btn-inline" data-google="remove-app">${google.shipped ? 'Use the app Orc ships' : 'Remove'}</button>` : ''}
      </div>
      <p class="cal-note">The secret is kept in the macOS Keychain. Changing the app signs your Google accounts out of Orc.</p>
      <p class="cal-error" role="alert" data-google-app-error></p>
    </div>
    </div>
  </orc-accordion>`;
}

function googleAccountsHtml(google, local) {
  return (google.accounts || []).map(account => {
    const calendars = account.calendars || [];
    const shown = calendars.filter(calendar => calendar.shown).length;
    const state = account.error || (calendars.length ? `${shown} of ${calendars.length} calendars shown` : 'No calendars');
    return `<div class="cal-account-row">
        <div><strong>${esc(account.email)}</strong><p class="settings-hint">${esc(state)}</p></div>
        ${local ? `<button type="button" class="settings-btn-inline" data-google="sign-out" data-account="${esc(account.id)}" aria-label="Sign out ${esc(account.email)}">Sign out</button>` : ''}
      </div>
      <ul class="cal-google-calendars" aria-label="Calendars of ${esc(account.email)}">${calendars.map(calendar => `<li><label class="cal-check">
        <input type="checkbox" data-google-calendar="${esc(calendar.id)}"${calendar.shown ? ' checked' : ''}${local ? '' : ' disabled'}>
        <span class="cal-swatch"${HEX.test(calendar.color || '') ? ` style="--cal-tint:${calendar.color}"` : ''} aria-hidden="true"></span>
        <span>${esc(calendar.name)}</span>${calendar.writable ? '' : '<span class="cal-tag">Read-only</span>'}</label></li>`).join('')}</ul>`;
  }).join('');
}

/* Settings' Google part: accounts, which of their calendars show, and the sign-in app. */
function mountGoogle(root, signal, changed) {
  let local = false;
  const draw = data => {
    const google = data.google || {};
    local = data.canConnect === true;
    const accounts = google.accounts || [];
    const full = accounts.length >= (google.maxAccounts || 5);
    const expired = accounts.some(account => account.needsLogin);
    const label = expired ? 'Sign in to Google again' : accounts.length ? 'Add another Google account' : 'Sign in with Google';
    const appOpen = root.querySelector('.cal-own-app')?.open;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.dataset.googleCalendar || focused?.dataset.google || '';
    // The app's steps sit right below, so Settings does not link to itself as the other sign-in places do.
    const signIn = !local ? '<p class="settings-note">Sign in to Google in Orc on the Mac that runs it.</p>'
      : !google.configured ? '<p class="settings-note">Orc has no Google sign-in app yet. Add yours below, then sign in.</p>'
        : full && !expired ? '' : googleSignInHtml(google, true, label);
    root.innerHTML = `<legend class="settings-label">Google Calendar</legend>
      ${sourceHead(GOOGLE_MARK, false,
        `<p class="cal-source-status" role="status" data-google-status>${accounts.length ? `${accounts.length} Google account${accounts.length === 1 ? '' : 's'} signed in` : 'No Google account signed in'}</p>`,
        'Sign in to see your Google calendars in Orc and to create, change and reply to events. Orc keeps the sign-in in the macOS Keychain.')}
      <div data-google-accounts>${googleAccountsHtml(google, local)}</div>
      ${signIn}
      ${local ? ownAppHtml(google) : ''}`;
    // A redraw after saving keeps the sign-in app's steps as the person left them.
    if (appOpen) root.querySelector('.cal-own-app').open = true;
    // innerHTML drops focus, so it goes back to the control that had it.
    if (focused) {
      ([...root.querySelectorAll('[data-google-calendar], [data-google]')]
        .find(control => (control.dataset.googleCalendar || control.dataset.google) === focusKey)
        || root.querySelector('[data-google="sign-in"], .cal-own-app'))?.focus();
    }
  };
  const load = async () => {
    try {
      const data = await readGoogle(signal);
      if (!signal.aborted) draw(data);
    } catch (failure) {
      if (!signal.aborted) root.innerHTML = `<legend class="settings-label">Google Calendar</legend><p class="settings-note" role="status">${esc(failure.message)}</p>`;
    }
  };
  const settle = async () => {
    await load();
    if (!signal.aborted) changed();
  };
  wireGoogleSignIn(root, signal, settle);
  root.addEventListener('change', async event => {
    const box = event.target.closest('[data-google-calendar]');
    if (!box || !local) return;
    box.disabled = true;
    try {
      await post('/api/calendar/google/calendars', { id: box.dataset.googleCalendar, shown: box.checked }, signal);
      await settle();
    } catch (failure) {
      if (signal.aborted) return;
      box.checked = !box.checked;
      box.disabled = false;
      root.querySelector('[data-google-status]').textContent = failure.message;
    }
  }, { signal });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.closest('.cal-app-form input')) return;
    // Settings already owns a form. Keep Enter local and never submit the secret.
    event.preventDefault();
    event.stopPropagation();
    root.querySelector('[data-google="save-app"]').click();
  }, { signal });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-google]');
    const action = button?.dataset.google;
    if (!local || !['sign-out', 'save-app', 'remove-app'].includes(action) || button.disabled) return;
    const error = root.querySelector('[data-google-app-error]');
    if (action === 'sign-out') {
      if (!confirm('Sign this Google account out of Orc? Its calendars stop showing. Your events stay in Google Calendar.')) return;
      button.disabled = true;
      try {
        await post('/api/calendar/google/logout', { account: button.dataset.account }, signal);
        await settle();
      } catch (failure) {
        if (signal.aborted) return;
        button.disabled = false;
        root.querySelector('[data-google-status]').textContent = failure.message;
      }
      return;
    }
    const client = root.querySelector('#calendar-google-client');
    const secret = root.querySelector('#calendar-google-secret');
    const removing = action === 'remove-app';
    error.textContent = '';
    if (!removing && !(client.value.trim() && secret.value.trim())) {
      error.textContent = 'Paste both the client ID and the client secret.';
      (client.value.trim() ? secret : client).focus();
      return;
    }
    const accounts = root.querySelectorAll('[data-google="sign-out"]').length;
    if (accounts && !confirm('Changing the sign-in app signs your Google accounts out of Orc. Continue?')) return;
    button.disabled = true;
    try {
      await post('/api/calendar/google/client', removing ? { clientId: '', clientSecret: '' }
        : { clientId: client.value.trim(), clientSecret: secret.value.trim() }, signal);
      secret.value = '';
      await settle();
    } catch (failure) {
      if (signal.aborted) return;
      button.disabled = false;
      error.textContent = failure.message;
    }
  }, { signal });
  signal.addEventListener('abort', () => {
    const secret = root.querySelector('#calendar-google-secret');
    if (secret) secret.value = '';
  }, { once: true });
  load();
}

export function mountConnections(card, pluginSignal, changed) {
  const controller = new AbortController();
  const { signal } = controller;
  const cleanup = () => { controller.abort(); input.value = ''; };
  pluginSignal.addEventListener('abort', cleanup, { once: true, signal });
  card.innerHTML = `<fieldset class="settings-fieldset cal-account cal-google" data-calendar-google></fieldset>
  <fieldset class="settings-fieldset cal-account" data-calendar-feeds>
    <legend class="settings-label">iCal calendars</legend>
    ${sourceHead(FEED_MARK, true, '<p class="cal-source-status" role="status" data-calendar-status>Checking calendars…</p>',
      'Read-only meetings from iCal addresses, for Outlook, iCloud and any other calendar. Orc never changes these.')}
    <div data-calendar-list></div>
    <div data-calendar-form hidden>${connectForm('Connect', 'calendar-settings', true)}</div>
    <p class="settings-note" data-calendar-remote hidden>Add the calendar address in Orc on the Mac that runs it. Network viewers can read meetings but cannot manage connections.</p>
    <a href="#calendar" class="cal-settings-link">Open Calendar</a>
    <orc-accordion class="cal-provider-help" label="Find your iCal address · Google, Outlook or iCloud"><div class="cal-help-body">${connectSteps()}</div></orc-accordion>
  </fieldset>
  <fieldset class="settings-fieldset cal-account" data-calendar-quiet hidden>
    <legend class="settings-label">Meetings</legend>
    <orc-checkbox class="settings-check" label="Quiet during meetings" aria-describedby="calendar-quiet-hint"${quietDuringMeetings() ? ' checked' : ''}></orc-checkbox>
    <p class="settings-hint" id="calendar-quiet-hint">Orc makes no sound while a meeting is on. A meeting is an event with a start and an end time that lasts less than a day, on a calendar you show. Events you declined and events set to show as free do not count. This choice is kept in this browser.</p>
  </fieldset>`;
  // A Google account signing in or out changes what the feeds below say of it,
  // and whether there is a calendar for the quiet switch to follow.
  mountGoogle(card.querySelector('[data-calendar-google]'), signal, () => {
    load();
    changed();
  });
  const feeds = card.querySelector('[data-calendar-feeds]');
  const find = selector => feeds.querySelector(selector);
  const status = find('[data-calendar-status]');
  const list = find('[data-calendar-list]');
  const form = find('.cal-connect-form');
  const button = find('#calendar-settings-connect');
  const input = find('input');
  const error = find('[role="alert"]');
  let local = false;
  let busy = false;
  const load = async () => {
    const start = new Date();
    const end = new Date(start.getTime() + 86400000);
    try {
      const response = await fetch(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, { signal, cache: 'no-store' });
      const data = await response.json();
      if (signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'Could not check calendars. Reopen Calendar settings to try again.');
      local = data.canConnect === true;
      const calendars = (data.calendars || []).filter(calendar => calendar.source !== 'google');
      const signedIn = new Set((data.google?.accounts || []).map(account => account.email.toLowerCase()));
      // Google names a feed after its account, so the same calendar connected both ways is easy to spot.
      const doubled = calendar => (signedIn.has(calendar.name.toLowerCase())
        ? 'This account is also signed in with Google, so its meetings show twice. Disconnect this address.' : '');
      status.textContent = calendars.length ? `${calendars.length} calendar${calendars.length === 1 ? '' : 's'} connected` : 'No calendars connected';
      list.innerHTML = calendars.map(calendar => `<div class="cal-account-row">
        <div><strong>${esc(calendar.name)}</strong><p class="settings-hint">${esc(calendar.error || doubled(calendar) || (calendar.fetchedAt ? `Updated ${new Date(calendar.fetchedAt).toLocaleString()}` : 'Waiting for the first download'))}</p></div>
        ${local ? `<button type="button" class="settings-btn-inline" data-disconnect="${esc(calendar.id)}" aria-label="Disconnect ${esc(calendar.name)}">Disconnect</button>` : ''}
      </div>`).join('');
      find('[data-calendar-form]').hidden = !local;
      find('[data-calendar-remote]').hidden = local;
      card.querySelector('[data-calendar-quiet]').hidden = data.connected !== true;
    } catch (failure) {
      if (!signal.aborted) status.textContent = failure.message;
    }
  };
  const mutate = async (action, body) => {
    const response = await fetch(`/api/calendar/${action}`, {
      signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not update calendars. Try again.');
    if (!signal.aborted) changed();
  };
  card.querySelector('[data-calendar-quiet] orc-checkbox').addEventListener('change', event => {
    setQuietDuringMeetings(event.detail?.checked ?? event.target.checked);
  }, { signal });
  // Settings already owns a form. Keep Enter local and never submit its secret field.
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    button.click();
  }, { signal });
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (!local || busy) return;
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    if (!/^(https|webcal):\/\/\S+$/i.test(input.value.trim())) {
      error.textContent = 'Paste the calendar address. It starts with https:// or webcal://.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    busy = true;
    form.setAttribute('aria-busy', 'true');
    input.readOnly = true;
    button.disabled = true;
    status.textContent = 'Connecting…';
    try {
      await mutate('connect', { url: input.value.trim() });
      if (signal.aborted) return;
      input.value = '';
      await load();
    } catch (failure) {
      if (signal.aborted) return;
      status.textContent = 'Calendar was not connected.';
      error.textContent = failure.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } finally {
      busy = false;
      input.readOnly = false;
      button.disabled = false;
      form.setAttribute('aria-busy', 'false');
    }
  }, { signal });
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-disconnect]');
    if (!button || !local || busy || !confirm('Disconnect this calendar? Orc removes its address from the Keychain.')) return;
    busy = true;
    button.disabled = true;
    status.textContent = 'Disconnecting…';
    try {
      await mutate('disconnect', { id: button.dataset.disconnect });
      await load();
      if (!signal.aborted) input.focus();
    } catch (failure) {
      if (!signal.aborted) status.textContent = failure.message;
    } finally {
      busy = false;
      button.disabled = false;
    }
  }, { signal });
  load();
  return cleanup;
}
