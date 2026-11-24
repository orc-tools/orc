let cached = null;
let pending = null;

export function cachedConfigData() {
  return cached;
}

export function fetchConfigData({ fresh = false } = {}) {
  if (!pending || fresh) {
    const request = fetch('/api/config').then(async response => {
      if (!response.ok) throw new Error(`Config request failed: ${response.status}`);
      const data = await response.json();
      if (pending === request) cached = data;
      return data;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
  }
  return pending;
}
