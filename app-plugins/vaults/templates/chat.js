(() => {
  const byId = id => document.getElementById(id);
  const draft = byId('chat-draft');
  const send = byId('chat-send');
  const stop = byId('chat-stop');
  const history = byId('chat-history');
  const conversation = byId('conversation');
  const presets = document.querySelectorAll('[data-draft], [data-ask]');
  const bridge = window.orcVault;
  let state;
  let sent;
  let previousTurns;
  draft.placeholder = document.querySelector('main').dataset.placeholder || draft.placeholder;

  function controls() {
    send.disabled = !state || state.building || !draft.value.trim();
    send.hidden = !!state?.building;
    stop.hidden = !state?.building;
    draft.disabled = !!state?.building;
    for (const preset of presets) preset.disabled = !state || state.building;
  }

  function submit() {
    if (send.disabled) return;
    sent = { text: draft.value.trim(), at: state.turns.at(-1)?.at };
    bridge.ask(sent.text);
  }

  function showTurns(turns) {
    const key = JSON.stringify(turns);
    if (key === previousTurns) return;
    previousTurns = key;
    const rows = turns.map(turn => {
      const row = document.createElement('li');
      const who = document.createElement('strong');
      who.textContent = turn.from || 'You';
      const ask = document.createElement('p');
      ask.textContent = turn.asked;
      const reply = document.createElement('p');
      reply.textContent = turn.reply;
      if (turn.failed) reply.className = 'failed';
      row.append(who, ask, reply);
      return row;
    });
    byId('chat-turns').replaceChildren(...rows);
    byId('chat-empty').hidden = !!turns.length;
    byId('turn-count').textContent = turns.length ? '(' + turns.length + ')' : '';
    conversation.scrollTop = conversation.scrollHeight;
  }

  history.addEventListener('click', () => {
    conversation.hidden = !conversation.hidden;
    history.setAttribute('aria-expanded', String(!conversation.hidden));
    if (!conversation.hidden) conversation.scrollTop = conversation.scrollHeight;
  });
  draft.addEventListener('input', controls);
  draft.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  send.addEventListener('click', submit);
  stop.addEventListener('click', () => bridge.stop());
  for (const preset of presets) {
    preset.addEventListener('click', () => {
      if (preset.dataset.ask) {
        bridge.ask(preset.dataset.ask);
        return;
      }
      if (!draft.value.trim()) draft.value = preset.dataset.draft;
      controls();
      draft.focus();
      draft.setSelectionRange(draft.value.length, draft.value.length);
    });
  }
  controls();
  if (!bridge) return;
  bridge.onState(next => {
    state = next;
    const last = state.turns.at(-1);
    if (sent && last?.asked === sent.text && (last.pending || last.at !== sent.at)) {
      if (draft.value.trim() === sent.text) draft.value = '';
      sent = null;
    }
    showTurns(state.turns);
    const status = byId('chat-status');
    status.classList.toggle('failed', !!state.error || !!last?.failed);
    status.textContent = state.error || (state.building ? state.activity || 'Working…' : last?.reply || '');
    controls();
  });
})();
