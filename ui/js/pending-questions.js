const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const drafts = new Map(), sending = new Set(), errors = new Map();
const acknowledgements = new Set();
function draft(key, value) {
  if (value !== undefined) drafts.set(key, value);
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key) || drafts.get(key) || '';
  } catch { return drafts.get(key) || ''; }
}

export function renderCodexQuestions(host, runId, meta, announce, refresh) {
  host.classList.add('codex-questions');
  for (const reply of meta.questionAcknowledgements || []) {
    const key = `orc-question:${runId}:${meta.codexThreadId}:${reply.version}`;
    if (!acknowledgements.has(key)) {
      if (draft(key)) announce('Codex acknowledged your answer');
      acknowledgements.add(key);
      drafts.delete(key); errors.delete(key); sending.delete(key);
      try { sessionStorage.removeItem(key); } catch {}
    }
  }
  const pq = meta.pendingQuestion, questions = pq?.questions || [];
  const signature = JSON.stringify([runId, pq, meta.sessionAlive, meta.sessionBackend]);
  if (host.dataset.codexSignature === signature) return;
  const focused = host.contains(document.activeElement) && document.activeElement.matches('input')
    ? { version: document.activeElement.dataset.version, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null;
  host.dataset.codexSignature = signature;
  host.hidden = !questions.length;
  if (!questions.length) { host.replaceChildren(); return; }
  const connected = meta.sessionAlive !== false, inline = pq.replyMode === 'inline';
  const headless = meta.sessionBackend === 'headless';
  host.innerHTML = `<div class="pq-heading"><div><h2 class="pq-head">${questions.length} ${questions.length === 1 ? 'question' : 'questions'} from Codex</h2>`
    + `<p class="pq-help">${inline ? headless ? 'Sending your answer resumes Codex immediately.' : 'Codex can keep working while you answer.' : !connected ? 'Session disconnected. Reopen the session to answer.' : 'This session is not connected for replies in Orc. Copy your answer, open the terminal, and answer the question there.'}</p></div>`
    + `<button type="button" class="pq-terminal pq-secondary" ${headless ? 'hidden' : ''}>${connected ? 'Open in terminal' : 'Reopen session'}</button></div>`
    + questions.map((q, i) => `<section class="pq-item" data-question="${i}" aria-labelledby="pq-title-${i}">
        <h3 class="pq-q" id="pq-title-${i}">${esc(q.question)}</h3>
        ${q.options.length ? `<div class="pq-options" role="group" aria-label="Suggested answers">${q.options.map((o, n) => `<button type="button" class="pq-option" data-option="${n}" aria-pressed="false"><span class="pq-option-mark" aria-hidden="true">✓</span><span>${esc(o.label)}</span></button>`).join('')}</div>` : ''}
        <form class="pq-reply"><label class="pq-label" for="pq-input-${i}">Your answer</label>
          <div class="pq-compose"><input id="pq-input-${i}" maxlength="2000" autocomplete="off" placeholder="${q.options.length ? 'Choose an option or write your own answer…' : 'Write your answer…'}" required>
          <button type="submit" class="pq-submit primary">${inline ? 'Send answer' : 'Copy answer'}</button></div></form>
        <div class="pq-answer" hidden><span class="pq-label">Your answer</span><p class="pq-answer-text"></p></div>
        <div class="pq-footer"><p class="pq-feedback" role="status" aria-live="polite"></p>
          <button type="button" class="pq-dismiss pq-secondary" title="Hide this question in Orc only">Dismiss in Orc</button></div>
      </section>`).join('');
  host.querySelectorAll('.pq-item').forEach(section => {
    const q = questions[Number(section.dataset.question)];
    const key = `orc-question:${runId}:${pq.threadId}:${q.version}`;
    const input = section.querySelector('input'), feedback = section.querySelector('.pq-feedback');
    const controls = [...section.querySelectorAll('input, button')];
    const options = [...section.querySelectorAll('[data-option]')];
    const syncSelection = () => options.forEach(button => {
      button.setAttribute('aria-pressed', String(input.value === q.options[Number(button.dataset.option)].label));
    });
    const setReplyState = state => {
      section.dataset.replyState = state;
      controls.forEach(control => { control.disabled = state !== 'open'; });
      section.querySelector('.pq-answer').hidden = state === 'open' || !input.value;
      section.querySelector('.pq-answer-text').textContent = input.value;
    };
    input.dataset.version = q.version;
    input.value = draft(key);
    input.oninput = () => { draft(key, input.value); syncSelection(); };
    syncSelection();
    setReplyState('open');
    feedback.textContent = errors.get(key) || '';
    if (['sending', 'unconfirmed'].includes(q.replyState) || sending.has(key)) {
      setReplyState(q.replyState === 'unconfirmed' ? 'unconfirmed' : 'sending');
      feedback.textContent = q.replyState === 'unconfirmed' ? 'Reply not confirmed. Check the conversation before answering again.' : 'Waiting for Codex to acknowledge your answer…';
    }
    options.forEach(button => {
      button.onclick = () => {
        input.value = q.options[Number(button.dataset.option)].label;
        draft(key, input.value); syncSelection(); input.focus();
      };
    });
    section.querySelector('.pq-dismiss').onclick = async () => {
      try {
        const response = await fetch(`/runs/${encodeURIComponent(runId)}/answer-question`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss', threadId: pq.threadId, questionId: q.id, version: q.version }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not dismiss the question.');
        refresh({ force: true });
      } catch (error) { feedback.textContent = error.message; }
    };
    section.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || sending.has(key)) return;
      if (!inline) {
        try { await navigator.clipboard.writeText(text); feedback.textContent = 'Copied. Open the terminal and answer there.'; }
        catch { feedback.textContent = 'Copy failed. Select the text and copy it manually.'; }
        return;
      }
      sending.add(key); errors.delete(key);
      setReplyState('sending');
      feedback.textContent = 'Sending answer…';
      let retryable = false;
      try {
        const response = await fetch(`/runs/${encodeURIComponent(runId)}/answer-question`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, threadId: pq.threadId, questionId: q.id, version: q.version }),
        });
        const body = await response.json();
        retryable = body.retryable === true || [400, 409].includes(response.status);
        if (!response.ok) throw new Error(body.error || 'Reply not confirmed. Check the conversation.');
        feedback.textContent = 'Waiting for Codex to acknowledge your answer…';
      } catch (error) {
        feedback.textContent = error.message || 'Reply not confirmed. Check the conversation before retrying.';
        errors.set(key, feedback.textContent);
        setReplyState(retryable ? 'open' : 'unconfirmed');
      } finally {
        announce(feedback.textContent);
        sending.delete(key); host.dataset.codexSignature = ''; refresh({ force: true });
      }
    };
  });
  if (focused) {
    const input = [...host.querySelectorAll('input')].find(el => el.dataset.version === focused.version);
    if (input && !input.disabled) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(focused.start, focused.end);
    }
  }
  host.querySelector('.pq-terminal').onclick = async () => {
    try {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}/${connected ? 'open-session' : 'reopen-session'}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not open the session.');
      announce('Session opened in the terminal');
    } catch (error) { announce(error.message); }
  };
}
