// orc-ui: the currency every cost is shown in. Costs arrive in US dollars at
// API prices; Settings' "Show costs in" (ui.costCurrency in config.json) can
// show them in pounds, converted with the day's rate the server fetches
// (exchangeRate on GET /api/config). Unchosen, a device whose region is the
// UK starts on pounds. No DOM, so tests load it as it is.

export const COST_CURRENCIES = { usd: { symbol: '$', label: 'Dollars' }, gbp: { symbol: '£', label: 'Pounds' } };

let chosenCostCurrency = null;
let usdToGbpRate = null;
let costRegionLanguages = null;

// The region of the device's first language that names or implies one:
// en-GB is GB, plain "en" maximises to en-Latn-US.
export function localeRegion(languages) {
  for (const tag of languages || []) {
    if (typeof tag !== 'string' || !tag) continue;
    try {
      const region = new Intl.Locale(tag).maximize().region;
      if (region) return region;
    } catch {
      const match = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(tag);
      if (match) return match[1].toUpperCase();
    }
  }
  return null;
}

export const regionCostCurrency = languages => localeRegion(languages) === 'GB' ? 'gbp' : 'usd';

function deviceLanguages() {
  if (costRegionLanguages) return costRegionLanguages;
  const nav = globalThis.navigator;
  return [nav?.language, ...(nav?.languages || [])];
}

// What this device starts on when Settings has no answer.
export const defaultCostCurrency = () => regionCostCurrency(deviceLanguages());

export const validCostCurrency = value => value === 'usd' || value === 'gbp' ? value : null;

// Settings' answer from config.ui; anything else means "not chosen".
export function setCostCurrency(value) { chosenCostCurrency = validCostCurrency(value); }

// The server's rate, { usdToGbp, date } or null; a bad one is no rate.
export function setExchangeRate(value) {
  const rate = Number(value?.usdToGbp);
  usdToGbpRate = rate > 0 && Number.isFinite(rate) ? { usdToGbp: rate, date: typeof value.date === 'string' ? value.date : null } : null;
}

// A /api/config payload: the choice and, when it carries one, the rate. A
// payload without a rate leaves the last one in place.
export function applyCostCurrencyConfig(data) {
  if (!data || typeof data !== 'object') return;
  setCostCurrency(data.config?.ui?.costCurrency);
  if (data.exchangeRate) setExchangeRate(data.exchangeRate);
}

export const chosenCurrency = () => chosenCostCurrency;
export const costCurrency = () => chosenCostCurrency || defaultCostCurrency();
export const exchangeRate = () => usdToGbpRate;

// For tests: forget the choice and rate, and pin the device's languages.
export function resetCostCurrency({ languages = null } = {}) {
  chosenCostCurrency = null;
  usdToGbpRate = null;
  costRegionLanguages = languages;
}

// Pure: a dollar cost in `currency` at `rate` dollars-to-pounds. Pounds with
// no rate show dollars, never a made-up rate. A fraction of a cent is not
// free, so it reads "<£0.01"; no cost is "Unknown" when a model had no price.
export function formatCost(cost, unpriced, { currency = 'usd', rate = null } = {}) {
  if (cost === null || cost === undefined) return unpriced ? 'Unknown' : '—';
  const pounds = currency === 'gbp' && Number(rate) > 0;
  const symbol = pounds ? '£' : '$';
  const amount = Number(cost) * (pounds ? Number(rate) : 1);
  if (amount > 0 && amount < 0.005) return `<${symbol}0.01`;
  return `${symbol}${amount.toFixed(2)}`;
}

// The same, in the currency and rate this page has now.
export const formatCostNow = (cost, unpriced) => formatCost(cost, unpriced,
  { currency: costCurrency(), rate: usdToGbpRate?.usdToGbp ?? null });

// A large total to the nearest whole unit, as Year in review writes it:
// "$1,234" or "£975".
export function formatWholeCost(cost, { currency = 'usd', rate = null } = {}) {
  const pounds = currency === 'gbp' && Number(rate) > 0;
  return `${pounds ? '£' : '$'}${Math.round(Number(cost) * (pounds ? Number(rate) : 1)).toLocaleString('en-US')}`;
}

export const formatWholeCostNow = cost => formatWholeCost(cost,
  { currency: costCurrency(), rate: usdToGbpRate?.usdToGbp ?? null });

// Whether costs show in pounds right now (chosen or by region, with a rate).
export const showsPounds = () => costCurrency() === 'gbp' && Boolean(usdToGbpRate);
