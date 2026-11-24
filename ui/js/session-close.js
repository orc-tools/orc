// Asks the run's own activity endpoint, not /api/runs: the whole list is
// megabytes and is rescanned after any run writes, so it misses a short
// timeout on every try and a stopped agent reads as still running.
export async function waitForPaneClosed(id) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/activity`, {
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      });
      if (response.ok && (await response.json()).activity !== 'running') return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  return false;
}
