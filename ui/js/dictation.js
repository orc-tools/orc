import { iconButtonTooltip } from './control-tooltip.js';
import { shortcutHint, shortcutMatches } from './shortcuts.js';

const dictationBindings = new WeakMap();
let activeDictation = null;

const DICTATION_MICROPHONE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';

function dictationBridge() {
  return window.orcWindowsDictation || window.webkit?.messageHandlers?.orcDictation;
}

function browserSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function browserDictationBridge() {
  let recognition;
  return { postMessage({ action, id, locale }) {
    if (action === 'cancel') return recognition?.abort();
    if (action === 'stop') return recognition?.stop();
    const Recognition = browserSpeechRecognition();
    recognition = new Recognition();
    recognition.lang = locale;
    recognition.continuous = true;
    recognition.interimResults = true;
    let heard = '';
    const emit = (state, extra = {}) => receiveDictationEvent({ id, state, ...extra });
    recognition.onstart = () => emit('recording');
    recognition.onresult = event => {
      heard = Array.from(event.results, result => result[0].transcript.trim()).filter(Boolean).join(' ');
      emit('partial', { text: heard });
    };
    recognition.onerror = event => {
      const messages = {
        'not-allowed': 'The browser blocked the microphone or speech recognition. Allow both for this site in the browser’s site settings, then try again.',
        // Safari reports this when dictation is off, and in Home Screen apps and other iOS browsers, which expose but refuse the API.
        'service-not-allowed': 'This browser won’t run speech recognition here. Turn on dictation in your device settings, or open Orc in a Safari, Chrome or Edge tab rather than a Home Screen app.',
        'audio-capture': 'No microphone found. Connect one, or let the browser use it in your system’s privacy settings, then try again.',
        'no-speech': 'No speech detected. Try again.',
      };
      emit('error', { message: messages[event.error] || 'Browser dictation failed. Check your connection and microphone, then try again.' });
    };
    recognition.onend = () => {
      emit('transcribing');
      // Keep the words already on screen when the browser ends before finalizing them.
      emit('complete', { text: heard });
    };
    recognition.start();
  } };
}

function liveDraft(session) {
  const { draftText, start, end, inserted } = session;
  return draftText.slice(0, start) + (inserted ?? draftText.slice(start, end)) + draftText.slice(end);
}

function ownsDictationDraft(session) {
  const { area, owner } = session.binding;
  return area.isConnected && !area.disabled && !area.readOnly && area.getClientRects().length > 0
    && location.hash === session.hash && owner() === session.owner && area.value === liveDraft(session);
}

function writeDictation(session, text) {
  const { draftText, start, end } = session;
  const before = draftText.slice(0, start), after = draftText.slice(end), selected = draftText.slice(start, end);
  const leading = /\S$/.test(before) && !/^[,.;:!?)]/.test(text) ? ' ' : '';
  const trailing = /^\S/.test(after) && !/^[,.;:!?)]/.test(after) ? ' ' : '';
  const inserted = text ? leading + text + trailing : null;
  if (inserted === session.inserted) return;
  const { area } = session.binding;
  area.setRangeText(inserted ?? selected, start, start + (session.inserted ?? selected).length, 'end');
  session.inserted = inserted;
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

function releaseDictation(session, message = '', completed = false) {
  if (activeDictation !== session) return;
  activeDictation = null;
  session.observer.disconnect();
  session.binding.paint('idle', message);
  session.resolveFinish?.(completed);
}

export function cancelDictation(area, message = '') {
  const session = activeDictation;
  if (!session || (area && session.binding.area !== area)) return;
  releaseDictation(session, message);
  try { session.bridge.postMessage({ action: 'cancel', id: session.id }); } catch (_) {}
}

export function canFinishDictation(area) {
  return activeDictation?.binding.area === area
    && ['recording', 'transcribing'].includes(activeDictation.phase);
}

export function finishDictation(area) {
  if (!canFinishDictation(area)) return Promise.resolve(false);
  const session = activeDictation;
  if (!session.finishPromise) {
    session.finishPromise = new Promise(resolve => { session.resolveFinish = resolve; });
  }
  stopDictation(session);
  return session.finishPromise;
}

// Send finishes a recording and goes ahead only once its transcript is in the
// draft; a recording that has not started yet is dropped so the typed draft sends.
export function settleDictation(area) {
  if (canFinishDictation(area)) return finishDictation(area);
  cancelDictation(area);
  return Promise.resolve(true);
}

function stopDictation(session) {
  if (session.phase !== 'recording') return;
  session.phase = 'transcribing';
  session.binding.paint('transcribing', session.transcribingMessage);
  try { session.bridge.postMessage({ action: 'stop', id: session.id }); }
  catch (_) { cancelDictation(session.binding.area, 'Dictation is unavailable. Reload Orc and try again.'); }
}

function receiveDictationEvent(detail) {
  const session = activeDictation;
  if (!session || detail?.id !== session.id) return;
  if (!ownsDictationDraft(session)) return cancelDictation(null, 'Dictation cancelled because the draft changed.');
  const { binding } = session;
  if (detail.state === 'partial') {
    if (!['recording', 'transcribing'].includes(session.phase)) return;
    writeDictation(session, typeof detail.text === 'string' ? detail.text.trim() : '');
  } else if (detail.state === 'complete') {
    if (session.phase !== 'transcribing') return;
    const text = typeof detail.text === 'string' ? detail.text.trim() : '';
    writeDictation(session, text);
    if (!text) return releaseDictation(session, 'No speech detected. Try again.');
    releaseDictation(session, '', true);
    binding.area.focus();
  } else if (detail.state === 'cancelled') {
    releaseDictation(session);
  } else if (detail.state === 'error') {
    releaseDictation(session, detail.message || 'Dictation failed. Try again.');
  } else if (['preparing', 'downloading', 'recording', 'transcribing'].includes(detail.state)) {
    if (session.phase === 'transcribing' && detail.state !== 'transcribing') return;
    session.phase = detail.state;
    const messages = {
      preparing: 'Preparing dictation…', downloading: 'Downloading the speech model for first use…',
      recording: '', transcribing: session.transcribingMessage,
    };
    binding.paint(detail.state, messages[detail.state]);
  }
}

window.addEventListener('orc-dictation', event => receiveDictationEvent(event.detail));
window.addEventListener('hashchange', () => cancelDictation(null, 'Dictation cancelled.'));
window.addEventListener('pagehide', () => cancelDictation());

// ⌘D finishes the recording in progress, else dictates into the focused composer, else the one on screen.
function shortcutBinding() {
  if (activeDictation && activeDictation.binding.area.getClientRects().length) return activeDictation.binding;
  const focused = dictationBindings.get(document.activeElement);
  if (focused) return focused;
  for (const area of document.querySelectorAll('textarea')) {
    const binding = dictationBindings.get(area);
    if (binding && area.getClientRects().length && !area.disabled && !area.readOnly) return binding;
  }
  return null;
}

// Orc.app's ⌘D menu item calls this when the menu sees the key before the page does.
window.orcToggleDictation = () => {
  const binding = shortcutBinding();
  binding?.toggle();
  return Boolean(binding);
};

window.addEventListener('keydown', event => {
  if (event.isComposing || !shortcutMatches('dictation', event)) return;
  const binding = shortcutBinding();
  if (!binding) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) binding.toggle();
}, true);

// Browsers block the microphone on plain-HTTP pages such as http://<tailscale-ip>/, and Safari also hides speech recognition there.
function needsHttps() {
  return !dictationBridge() && !window.isSecureContext;
}

export function bindDictation(area, { owner = () => location.hash, changed = () => {} } = {}) {
  if ((!dictationBridge() && !browserSpeechRecognition() && !needsHttps()) || dictationBindings.has(area)) return;
  const surface = area.closest('.newconv-prompt');
  const actions = surface?.querySelector('.nc-actions, .chat-actions');
  if (!actions) return;
  const button = document.createElement('orc-icon-button');
  button.setAttribute('size', 'compact');
  button.className = 'prompt-dictate';
  button.innerHTML = DICTATION_MICROPHONE_ICON;
  // Keep the caret in the draft: a pointer press would otherwise move focus to the button.
  button.addEventListener('mousedown', event => event.preventDefault());
  // Errors and notices that stay until you act on them get a row above the bar.
  const panel = document.createElement('div');
  panel.className = 'prompt-dictation-panel';
  panel.hidden = true;
  panel.innerHTML = '<span role="status" aria-live="polite" aria-atomic="true"></span>';
  const status = panel.querySelector('span');
  status.id = area.id + '-dictation-status';
  // Preparing, downloading and transcribing sit inside the bar, after the model
  // label (or before the microphone where the bar has none), so the composer
  // keeps its height while you dictate.
  const progress = document.createElement('span');
  progress.className = 'prompt-dictation-progress';
  progress.hidden = true;
  progress.innerHTML = '<span class="status-spinner" aria-hidden="true"></span><span role="status" aria-live="polite" aria-atomic="true"></span>';
  const progressText = progress.lastElementChild;
  progressText.id = area.id + '-dictation-progress';
  button.setAttribute('aria-describedby', `${progressText.id} ${status.id}`);
  surface.insertBefore(panel, surface.querySelector('footer'));
  actions.prepend(button);
  iconButtonTooltip(button, { detail: () => shortcutHint('dictation') });
  const info = surface.querySelector('.chat-composer-info');
  const modelLabel = info?.querySelector(':scope > :not(.chat-status)');
  if (modelLabel) modelLabel.after(progress);
  else if (info) info.prepend(progress);
  else actions.prepend(progress);
  const binding = { area, owner, paint(phase, message) {
    const recording = phase === 'recording';
    const label = phase === 'idle' ? 'Dictate prompt' : 'Finish dictation';
    button.setAttribute('label', label);
    button.disabled = area.disabled || area.readOnly;
    button.classList.toggle('is-recording', recording);
    const working = Boolean(message) && phase !== 'idle';
    progress.hidden = !working;
    progress.title = working ? message : '';
    progressText.textContent = working ? message : '';
    panel.hidden = working || !message;
    status.textContent = working ? '' : message;
    changed();
  } };
  dictationBindings.set(area, binding);
  binding.paint('idle', '');
  const availability = new MutationObserver(() => {
    if (area.disabled || area.readOnly) cancelDictation(area);
    button.disabled = area.disabled || area.readOnly;
  });
  availability.observe(area, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
  area.addEventListener('input', () => {
    if (activeDictation?.binding === binding && area.value === liveDraft(activeDictation)) return;
    cancelDictation(area, 'Dictation cancelled because the draft changed.');
  });
  binding.toggle = () => {
    if (area.disabled || area.readOnly) return;
    area.focus();
    if (activeDictation?.binding === binding) {
      stopDictation(activeDictation);
      return;
    }
    if (needsHttps()) {
      // Browsers hide http:// in the address bar, so name the address this page is really on.
      const httpsUrl = window.ORC_INSTANCE?.httpsUrl;
      binding.paint('idle', `Dictation needs HTTPS, and this page is open at ${location.origin}. ${httpsUrl
        ? `Open ${httpsUrl} instead`
        : 'Open Orc at its https:// Tailscale address, shown on the host in Tailscale settings'}, then try again.`);
      return;
    }
    cancelDictation(null, 'Dictation cancelled.');
    const session = {
      binding, id: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
      hash: location.hash, owner: owner(), draftText: area.value,
      start: area.selectionStart, end: area.selectionEnd, inserted: null, phase: 'preparing',
      bridge: dictationBridge() || browserDictationBridge(),
      transcribingMessage: dictationBridge() ? 'Transcribing on your Mac…' : 'Transcribing in your browser…',
      observer: new MutationObserver(() => {
        if (activeDictation === session && !ownsDictationDraft(session)) cancelDictation(area, 'Dictation cancelled.');
      }),
    };
    activeDictation = session;
    session.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'class', 'style', 'disabled', 'readonly'] });
    binding.paint('preparing', 'Preparing dictation…');
    try { session.bridge.postMessage({ action: 'start', id: session.id, locale: navigator.language }); }
    catch (_) { cancelDictation(area, 'Dictation is unavailable. Reload Orc and try again.'); }
  };
  button.addEventListener('click', binding.toggle);
  return () => {
    cancelDictation(area);
    availability.disconnect();
    dictationBindings.delete(area);
    button.removeEventListener('click', binding.toggle);
  };
}
