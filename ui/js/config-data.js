import { applyCostCurrencyConfig } from './currency.js';

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
      if (pending === request) {
        cached = data;
        applyCostCurrencyConfig(data);
      }
      return data;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
  }
  return pending;
}

// A tilde-form path ("~/Projects/orc") and an absolute one for the same repo
// ("/Users/developer/Projects/orc") must compare equal when matching config.repos
// keys — including absolute paths recorded under a different home (another
// machine or username). Identity is home-agnostic: any /Users/<name> or
// /home/<name> prefix contracts to ~, mirroring canonical_path in serve.py.
export function normPath(p) {
  if (p === '~' || p.startsWith('~/')) return p;
  return p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}
