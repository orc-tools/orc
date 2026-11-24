const TIMEOUT_MS = 2 * 60 * 1000;
const POLL_MS = 700;
const copy = value => structuredClone(value);
const terminal = state => state === 'started' || state === 'failed';

function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

export function createLaunchAttempts({ fetch: send = (...args) => globalThis.fetch(...args),
  now = () => Date.now(), setTimeout: later = (...args) => globalThis.setTimeout(...args),
  clearTimeout: cancel = timer => globalThis.clearTimeout(timer) } = {}) {
  const attempts = new Map();
  const byRun = new Map();
  const optimistic = new Map();
  const listeners = new Set();
  let sequence = 0;
  const view = attempt => attempt ? immutable(copy({ id: attempt.id, runId: attempt.runId,
    launchId: attempt.launchId, request: attempt.request, recovery: attempt.recovery,
    state: attempt.state, starting: attempt.state === 'launching', error: attempt.error,
    reason: attempt.reason, prompt: attempt.request?.prompt, startPrompt: attempt.startPrompt,
    response: attempt.response, record: attempt.record })) : null;
  function notify(attempt, kind) {
    const current = view(attempt);
    for (const listener of listeners) listener(current, kind);
    return current;
  }
  function settle(attempt, state, error = null, reason = null) {
    if (attempt.state === state && attempt.error === error && attempt.reason === reason) return;
    attempt.state = state;
    attempt.error = error;
    attempt.reason = reason;
    cancel(attempt.deadline);
    cancel(attempt.poll);
    notify(attempt, 'settled');
  }
  function canonical(attempt, record) {
    if (attempt.state === 'failed' && attempt.reason === 'canonical' && record?.state !== 'failed') return;
    if (record && typeof record === 'object') attempt.record = copy(record);
    if (terminal(record?.state)) settle(attempt, record.state, record.error || null, 'canonical');
    // Startup trust holds the queued prompt; the composer and Chat ask for it.
    else if (record?.state === 'needs-trust' && attempt.state !== 'needs-trust' && !terminal(attempt.state)) {
      attempt.state = 'needs-trust';
      notify(attempt, 'needs-trust');
    }
  }
  function schedule(attempt) {
    if (terminal(attempt.state) || !attempt.launchId) return;
    attempt.poll = later(async () => {
      try {
        const response = await send(`/api/new-conversation/${encodeURIComponent(attempt.launchId)}`, { cache: 'no-store' });
        if (response.ok) canonical(attempt, await response.json());
      } catch {
        // An unavailable status endpoint is inconclusive; the independent deadline still settles this attempt.
      }
      schedule(attempt);
    }, POLL_MS);
  }
  function observe(runId, { run, launch, startPrompt, items = [] } = {}) {
    let attempt = byRun.get(runId);
    if (!attempt) {
      attempt = { id: `restored:${runId}`, runId, state: run?.pending ? 'launching' : null,
        request: null, recovery: null, error: null };
      byRun.set(runId, attempt);
    }
    if (startPrompt) attempt.startPrompt = copy(startPrompt);
    const record = run?.meta?.status === 'escalated' && run.meta.launchFailure
      ? { state: 'failed', error: run.meta.launchFailure.error } : launch;
    canonical(attempt, record);
    if ((!terminal(attempt.state) || attempt.reason === 'timeout' || attempt.reason === 'network') && (items.some(item => item.kind === 'user')
      || (!run?.pending && run?.meta?.sessionBackend === 'headless' && run.meta.sessionActivity === 'idle'))) {
      // A run first seen already under way was never shown as starting, so
      // its listeners have nothing to redraw, and each of them redraws the
      // whole sidebar or the Chat when told.
      if (!attempt.state && record?.state !== 'launching') Object.assign(attempt, { state: 'started', error: null, reason: 'session' });
      else settle(attempt, 'started', null, 'session');
    }
    if (!attempt.state && launch?.state === 'launching') {
      attempt.state = 'launching';
      notify(attempt, 'observed');
    }
    return view(attempt);
  }
  function project(run) {
    const attempt = byRun.get(run.id);
    if (!terminal(attempt?.state)) return run;
    return { ...run, pending: false, meta: attempt.state === 'failed'
      ? { ...run.meta, status: 'escalated' } : run.meta };
  }
  function withPendingRuns(rows) {
    const listed = new Set(rows.map(run => run.id));
    const result = rows.map(project);
    for (const [id, entry] of optimistic) {
      if (now() - entry.at >= TIMEOUT_MS) optimistic.delete(id);
      else if (!listed.has(id)) result.push(project(copy(entry.run)));
    }
    return result;
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get pending() { return [...attempts.values()].some(attempt => !terminal(attempt.state)); },
    forRun(runId) { return view(byRun.get(runId)); },
    observe,
    async start(request, recovery) {
      const attempt = { id: `launch:${++sequence}`, request: copy(request), recovery: copy(recovery),
        state: 'launching', error: null, runId: null, launchId: null };
      attempts.set(attempt.id, attempt);
      attempt.deadline = later(() => settle(attempt, 'failed', null, 'timeout'), TIMEOUT_MS);
      notify(attempt, 'sending');
      let response, data;
      try {
        response = await send('/api/new-conversation', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.request) });
        data = await response.json().catch(() => ({}));
      } catch {
        if (!terminal(attempt.state)) settle(attempt, 'failed', 'Failed to start', 'network');
        return view(attempt);
      }
      if (!response.ok) {
        if (!terminal(attempt.state)) settle(attempt, 'failed', data.error || 'Failed to start', 'rejected');
        return view(attempt);
      }
      attempt.response = copy(data);
      attempt.runId = data.runId || null;
      attempt.launchId = data.launchId || null;
      const observed = byRun.get(attempt.runId);
      if (attempt.runId) byRun.set(attempt.runId, attempt);
      if (observed?.startPrompt) attempt.startPrompt = observed.startPrompt;
      if (observed?.record) attempt.record = observed.record;
      if (terminal(observed?.state)) {
        attempt.state = observed.state;
        attempt.error = observed.error;
        attempt.reason = observed.reason;
        cancel(attempt.deadline);
      }
      if (data.run) optimistic.set(data.run.id, { run: copy(data.run), at: now() });
      notify(attempt, 'accepted');
      canonical(attempt, data);
      schedule(attempt);
      return view(attempt);
    },
    withPendingRuns,
    reconcile(rows) {
      for (const run of rows) {
        if (byRun.has(run.id) || run.pending || run.meta?.launchFailure) observe(run.id, { run });
        optimistic.delete(run.id);
      }
      return withPendingRuns(rows);
    },
    recover(id, draft = {}) {
      if (draft.text?.trim() || draft.attachments?.length || draft.tickets?.length) return null;
      const attempt = attempts.get(id) || byRun.get(id);
      if (!attempt || attempt.state !== 'failed') return null;
      const material = attempt.recovery || attempt.startPrompt;
      return material ? immutable(copy({ ...material, request: attempt.request })) : null;
    },
  };
}

export const launchAttempts = createLaunchAttempts();
