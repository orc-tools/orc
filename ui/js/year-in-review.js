// orc-ui: Year in review — shareable cards of a day's, week's, month's or
// year's run figures, drawn in the colours of whichever theme is showing.
// Figures can be exported as JSON and pasted into another machine's Orc to
// combine the two.

import { $, announce, esc, runs } from './core.js';
import { isOrchestrationWorker, isQuestionRun, modelLabel } from './run-presentation.js';
import { runProject } from './filters.js';

// TESTABLE: year in review figures
const YIR_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YIR_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YIR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const YIR_STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/;
const YIR_KIND = 'orc-year-in-review';
const YIR_MAX_RECORDS = 50000;
export const YEAR_IN_REVIEW_KINDS = ['day', 'week', 'month', 'year'];
const YIR_FIGURES_VERSION = 3;
const YIR_CACHE = 24;
const yirPad = n => String(n).padStart(2, '0');

// Periods are local calendar ranges, start inclusive and end exclusive, so they
// match run-id stamps, which carry the local start time. Weeks start on Monday.
function yirPeriodStart(kind, date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  if (kind === 'year') return new Date(y, 0, 1);
  if (kind === 'month') return new Date(y, m, 1);
  if (kind === 'week') return new Date(y, m, d - ((date.getDay() + 6) % 7));
  return new Date(y, m, d);
}
function yirPeriodShift(kind, start, steps) {
  if (kind === 'year') return new Date(start.getFullYear() + steps, 0, 1);
  if (kind === 'month') return new Date(start.getFullYear(), start.getMonth() + steps, 1);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + steps * (kind === 'week' ? 7 : 1));
}
function yirPeriodKey(kind, start) {
  const y = String(start.getFullYear()), m = yirPad(start.getMonth() + 1);
  if (kind === 'year') return y;
  if (kind === 'month') return `${y}-${m}`;
  return `${y}-${m}-${yirPad(start.getDate())}`;
}

// The period of a kind holding a date, or named by its key: 2026, 2026-11,
// 2026-11-02 for the week starting that Monday, 2026-11-07 for a day. A key
// that does not name the start of its period is refused.
export function yearInReviewPeriod(kind, at = new Date()) {
  if (!YEAR_IN_REVIEW_KINDS.includes(kind)) return null;
  let date;
  if (typeof at === 'string') {
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(at);
    if (!m) return null;
    date = new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1);
  } else {
    date = new Date(at);
  }
  if (Number.isNaN(date.getTime())) return null;
  const start = yirPeriodStart(kind, date);
  const key = yirPeriodKey(kind, start);
  if (typeof at === 'string' && key !== at) return null;
  return { kind, key, start, end: yirPeriodShift(kind, start, 1) };
}

export function yearInReviewStep(period, steps) {
  return yearInReviewPeriod(period.kind, yirPeriodShift(period.kind, period.start, steps));
}

export function yearInReviewInPeriod(period, stamp) {
  const start = yirStart(stamp);
  return !!start && start >= period.start && start < period.end;
}

// 2–8 Nov 2026, or the short form for a card's hero: 2–8 Nov.
export function yearInReviewPeriodLabel(period, short = false) {
  const { kind, start } = period;
  const y = start.getFullYear(), mon = YIR_MONTHS[start.getMonth()], d = start.getDate();
  if (kind === 'year') return String(y);
  if (kind === 'month') return short ? YIR_MONTH_NAMES[start.getMonth()] : `${mon} ${y}`;
  if (kind === 'day') return `${YIR_WEEKDAYS[start.getDay()]} ${d} ${mon}${short ? '' : ` ${y}`}`;
  const last = new Date(y, start.getMonth(), d + 6);
  const to = `${last.getDate()} ${YIR_MONTHS[last.getMonth()]}`;
  const from = last.getMonth() === start.getMonth() ? `${d}–` : `${d} ${mon} – `;
  if (short) return `${from}${to}`;
  if (last.getFullYear() !== y) return `${d} ${mon} ${y} – ${to} ${last.getFullYear()}`;
  return `${from}${to} ${y}`;
}

// The period to show for a kind: the one holding at when it has runs,
// otherwise the most recent earlier one with runs, otherwise the one holding at.
export function yearInReviewLatest(kind, stamps, at = new Date()) {
  const current = yearInReviewPeriod(kind, at);
  let latest = null;
  (stamps || []).forEach(stamp => {
    const start = yirStart(stamp);
    if (start && start < current.end && (!latest || start > latest)) latest = start;
  });
  return latest ? yearInReviewPeriod(kind, latest) : current;
}

function yirStamp(id) {
  const m = /-(\d{8}-\d{4})(?:-\d+)?$/.exec(id || '');
  return m ? m[1] : null;
}
// Run ids end in the local start time, so a record keeps that stamp rather than
// an instant: a run started at 23:50 on another machine stays a late-night run.
function yirStart(stamp) {
  const m = YIR_STAMP.exec(stamp || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
function yirDayKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
function yirDayLabel(key) {
  return key ? `${+key.slice(6, 8)} ${YIR_MONTHS[+key.slice(4, 6) - 1]}` : '';
}
function yirModel(meta) {
  const usable = model => typeof model === 'string' && model && !['unknown', 'inherited'].includes(model);
  if (usable(meta.launchModel)) return meta.launchModel;
  const phases = meta.subagentModels && typeof meta.subagentModels === 'object' ? Object.values(meta.subagentModels) : [];
  for (const rows of phases) {
    const row = Array.isArray(rows) && rows.find(r => r && r.role === 'orchestrator' && usable(r.model));
    if (row) return row.model;
  }
  return null;
}
function yirPersona(hour) {
  if (hour === null) return null;
  if (hour >= 5 && hour < 12) return 'Early bird';
  if (hour >= 12 && hour < 18) return 'Daytime builder';
  if (hour >= 18 && hour < 22) return 'Evening hacker';
  return 'Night owl';
}
function yirTop(counts) {
  let best = null;
  counts.forEach((count, key) => { if (!best || count > best.count) best = { key, count }; });
  return best;
}
const yirText = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const yirTokenCount = value => Number.isSafeInteger(value) && value >= 0;
// A run's token use: k total tokens, c estimated USD, u tokens per model id.
// The same checks clean this machine's counts and a pasted export's.
function yirUsage(raw) {
  const usage = {};
  if (!raw || typeof raw !== 'object') return usage;
  if (yirTokenCount(raw.k)) usage.k = raw.k;
  if (Number.isFinite(raw.c) && raw.c >= 0) usage.c = Math.round(raw.c * 100) / 100;
  if (raw.u && typeof raw.u === 'object') {
    const models = Object.entries(raw.u).slice(0, 20)
      .map(([model, count]) => [yirText(model, 80), count])
      .filter(([model, count]) => model && yirTokenCount(count) && count > 0);
    if (models.length) usage.u = Object.fromEntries(models);
  }
  return usage;
}

// The portable form of one run: enough to rebuild every figure, and nothing
// from its prompt, files or transcript. Projects travel by folder name, since
// the same repository lives at different paths on different machines. usage
// is the run's token use from /api/year-in-review/usage, when it was counted.
export function yearInReviewRecord(run, usage) {
  const meta = (run && run.meta) || {};
  const t = yirStamp(run && run.id);
  if (!t) return null;
  const record = { id: run.id, t, host: yirText(meta.host, 80) || 'Unknown machine', h: meta.harness === 'codex' ? 'codex' : 'claude', ...yirUsage(usage) };
  if (isOrchestrationWorker(meta)) return { ...record, w: 1 };
  const project = runProject(run);
  if (project.key !== 'other') record.p = project.label;
  const model = yirModel(meta);
  if (model) record.m = model;
  if (isQuestionRun(run)) record.o = 'answered';
  else if (meta.status === 'merged' || meta.status === 'merged-to-parent') {
    record.o = 'merged';
    const minutes = Math.round((Date.parse(meta.mergedAt || '') - yirStart(t).getTime()) / 60000);
    if (Number.isFinite(minutes) && minutes > 0) record.mm = minutes;
  }
  return record;
}

export function yearInReviewRecords(list, period, usage = {}) {
  return (list || []).map(run => yearInReviewRecord(run, run && usage[run.id]))
    .filter(record => record && yearInReviewInPeriod(period, record.t));
}

// The usage endpoint's per-run counts in record form, keyed by run id.
export function yearInReviewUsage(payload) {
  const runs = payload && typeof payload.runs === 'object' && payload.runs ? payload.runs : {};
  return Object.fromEntries(Object.entries(runs).map(([id, run]) =>
    [id, yirUsage(run && { k: run.tokens, c: run.cost, u: run.models })]));
}

// Malformed records are dropped rather than trusted, so a hand-edited export
// cannot break the card. With a period, records outside it are dropped too.
function yirCleanRecord(raw, period) {
  if (!raw || typeof raw !== 'object') return null;
  const id = yirText(raw.id, 200), t = typeof raw.t === 'string' && YIR_STAMP.test(raw.t) ? raw.t : null;
  if (!id || !t || !yirStart(t) || (period && !yearInReviewInPeriod(period, t))) return null;
  const record = { id, t, host: yirText(raw.host, 80) || 'Unknown machine', h: raw.h === 'codex' ? 'codex' : 'claude', ...yirUsage(raw) };
  if (raw.w) return { ...record, w: 1 };
  const project = yirText(raw.p, 120), model = yirText(raw.m, 80);
  if (project) record.p = project;
  if (model) record.m = model;
  if (raw.o === 'merged' || raw.o === 'answered') record.o = raw.o;
  if (record.o === 'merged' && Number.isInteger(raw.mm) && raw.mm > 0) record.mm = raw.mm;
  return record;
}

export function yearInReviewExport(period, records, now = new Date()) {
  return {
    kind: YIR_KIND, version: 2, period: { kind: period.kind, key: period.key }, exportedAt: now.toISOString(),
    runs: (records || []).filter(record => yearInReviewInPeriod(period, record.t)),
  };
}

// Version 1 exports cover a year; version 2 names its period.
export function yearInReviewParse(text) {
  let data;
  try { data = JSON.parse(String(text || '')); } catch { return { error: 'That is not valid JSON. Paste the whole export from the other machine.' }; }
  if (!data || data.kind !== YIR_KIND || !Array.isArray(data.runs)) return { error: 'That JSON is not a Year in review export.' };
  if (data.version !== 1 && data.version !== 2) return { error: 'That export comes from a newer Orc. Update Orc here, then paste it again.' };
  let period = null;
  if (data.version === 1) {
    if (!Number.isInteger(data.year) || data.year < 2000 || data.year > 3000) return { error: 'That export has no valid year.' };
    period = yearInReviewPeriod('year', String(data.year));
  } else {
    const raw = data.period && typeof data.period === 'object' ? data.period : {};
    period = typeof raw.key === 'string' ? yearInReviewPeriod(raw.kind, raw.key) : null;
    const year = period && period.start.getFullYear();
    if (!period || year < 2000 || year > 3000) return { error: 'That export has no valid period.' };
  }
  const records = data.runs.slice(0, YIR_MAX_RECORDS).map(raw => yirCleanRecord(raw, period)).filter(Boolean);
  if (!records.length) return { error: `That export has no runs from ${yearInReviewPeriodLabel(period)}.` };
  return { period, records, skipped: Math.min(data.runs.length, YIR_MAX_RECORDS) - records.length };
}

// One record per run id. Later sets win, so this machine's live runs replace
// an older import of the same run instead of counting it twice.
export function yearInReviewMerge(...sets) {
  const byId = new Map();
  sets.forEach(set => (set || []).forEach(record => byId.set(record.id, record)));
  return [...byId.values()].sort((a, b) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id));
}

// The activity chart's buckets: months of a year, days of a month or week,
// hours of a day.
function yirBucketCount(period) {
  if (period.kind === 'year') return 12;
  if (period.kind === 'month') return Math.round((period.end - period.start) / 86400000);
  return period.kind === 'week' ? 7 : 24;
}
function yirBucket(period, start) {
  if (period.kind === 'year') return start.getMonth();
  if (period.kind === 'month') return start.getDate() - 1;
  return period.kind === 'week' ? (start.getDay() + 6) % 7 : start.getHours();
}
const yirPeriodOf = f => yearInReviewPeriod(f.period.kind, f.period.key);

// Delegated orchestration workers are counted as agents, not as runs: the user
// started the parent, and counting its workers too would inflate every figure.
// Their tokens still count: a worker's session is real model use.
export function yearInReviewFigures(records, period, now = new Date()) {
  const buckets = Array(yirBucketCount(period)).fill(0), hourly = Array(24).fill(0);
  const days = new Map(), hours = new Map(), projects = new Map(), models = new Map(), machines = new Map();
  let total = 0, merged = 0, answered = 0, weekend = 0, lateNight = 0, claude = 0, codex = 0, delegated = 0;
  let tokens = 0, tokenRuns = 0, cost = 0, priced = false;
  const mergeMinutes = [];
  // Models group by their readable name, so a dated id and its alias meet.
  const model = id => {
    const name = modelLabel(id) || id;
    if (!models.has(name)) models.set(name, { name, runs: 0, tokens: 0 });
    return models.get(name);
  };
  (records || []).forEach(record => {
    const start = yirStart(record.t);
    if (!start || start < period.start || start >= period.end) return;
    const machine = machines.get(record.host) || { name: record.host, runs: 0, merged: 0, delegated: 0 };
    machines.set(record.host, machine);
    if (record.k !== undefined) { tokens += record.k; tokenRuns++; }
    if (record.c !== undefined) { cost += record.c; priced = true; }
    Object.entries(record.u || {}).forEach(([id, count]) => { model(id).tokens += count; });
    if (record.w) { delegated++; machine.delegated++; return; }
    total++;
    machine.runs++;
    buckets[yirBucket(period, start)]++;
    const day = yirDayKey(start);
    days.set(day, (days.get(day) || 0) + 1);
    hours.set(start.getHours(), (hours.get(start.getHours()) || 0) + 1);
    hourly[start.getHours()]++;
    if (start.getDay() === 0 || start.getDay() === 6) weekend++;
    if (start.getHours() < 5) lateNight++;
    if (record.h === 'codex') codex++; else claude++;
    if (record.p) projects.set(record.p, (projects.get(record.p) || 0) + 1);
    if (record.m) model(record.m).runs++;
    if (record.o === 'answered') answered++;
    if (record.o === 'merged') {
      merged++;
      machine.merged++;
      if (record.mm) mergeMinutes.push(record.mm);
    }
  });

  const dayKeys = [...days.keys()].sort();
  let streak = null, length = 0, from = '';
  dayKeys.forEach((key, i) => {
    const prev = i && new Date(+dayKeys[i - 1].slice(0, 4), +dayKeys[i - 1].slice(4, 6) - 1, +dayKeys[i - 1].slice(6, 8) + 1);
    length = prev && yirDayKey(prev) === key ? length + 1 : 1;
    if (length === 1) from = key;
    if (!streak || length > streak.days) streak = { days: length, from, to: key };
  });
  const busiestDay = yirTop(days);
  const busiestBucket = total ? buckets.reduce((best, count, i) => (count > buckets[best] ? i : best), 0) : null;
  const peak = yirTop(hours);
  const topProjects = [...projects].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([label, count]) => ({ label, count }));
  // Favourite means most used: tokens where they were counted, runs otherwise.
  const topModels = [...models.values()]
    .sort((a, b) => b.tokens - a.tokens || b.runs - a.runs || a.name.localeCompare(b.name)).slice(0, 5);
  mergeMinutes.sort((a, b) => a - b);
  const shippable = total - answered;
  return {
    version: YIR_FIGURES_VERSION,
    period: { kind: period.kind, key: period.key },
    generatedAt: now.toISOString(),
    runs: total,
    merged,
    answered,
    shipRate: shippable > 0 ? Math.round((merged / shippable) * 100) : null,
    projects: projects.size,
    topProject: topProjects[0] || null,
    topProjects,
    activeDays: days.size,
    streak,
    busiestDay: busiestDay && { key: busiestDay.key, count: busiestDay.count },
    busiestBucket: busiestBucket === null ? null : { index: busiestBucket, count: buckets[busiestBucket] },
    buckets,
    hours: hourly,
    peakHour: peak ? peak.key : null,
    persona: yirPersona(peak ? peak.key : null),
    weekend,
    lateNight,
    claude,
    codex,
    topModels,
    tokens,
    tokenRuns,
    cost: priced ? Math.round(cost * 100) / 100 : null,
    delegated,
    fastestMerge: mergeMinutes.length ? mergeMinutes[0] : null,
    medianMerge: mergeMinutes.length ? mergeMinutes[Math.floor((mergeMinutes.length - 1) / 2)] : null,
    machines: [...machines.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
  };
}

export function yearInReviewDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes / 1440)} days`;
}

const yirCount = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export function yearInReviewHeadline(f) {
  if (!f.runs) return `A quiet ${yearInReviewPeriodLabel(yirPeriodOf(f))} so far. The swamp awaits.`;
  const parts = [yirCount(f.runs, 'run'), `${f.merged.toLocaleString('en-US')} merged`];
  if (f.streak && f.streak.days > 1) parts.push(`a ${f.streak.days}-day streak`);
  const list = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');
  return `${list}. ${f.persona} energy.`;
}

export function yearInReviewSummary(f) {
  const period = yirPeriodOf(f), day = period.kind === 'day';
  const bits = [`${yearInReviewPeriodLabel(period)} in Orc: ${yirCount(f.runs, 'run')}`, `${f.merged} merged`];
  if (f.shipRate !== null) bits.push(`${f.shipRate}% ship rate`);
  if (f.streak && !day) bits.push(`longest streak ${yirCount(f.streak.days, 'day')}`);
  if (f.topProject) bits.push(`top project ${f.topProject.label}`);
  if (f.busiestDay && !day) bits.push(`busiest day ${yirDayLabel(f.busiestDay.key)} with ${yirCount(f.busiestDay.count, 'run')}`);
  if (f.persona) bits.push(f.persona);
  if (f.fastestMerge !== null) bits.push(`fastest merge ${yearInReviewDuration(f.fastestMerge)}`);
  if (f.machines.length > 1) bits.push(`across ${f.machines.map(m => `${m.name} (${yirCount(m.runs, 'run')}, ${m.merged} merged)`).join(' and ')}`);
  return `${bits.join(', ')}.`;
}

function yirWrap(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) { line = ''; lines[maxLines - 1] += '…'; break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}
function yirFitFontSize(text, width, base) {
  return Math.max(24, Math.min(base, Math.floor(width / Math.max(String(text).length * 0.6, 1))));
}

// A bucket's full name for the bar's tooltip, and its tick under the chart:
// month initials, weekday initials, every seventh day of a month, every sixth hour.
function yirBucketName(period, i) {
  if (period.kind === 'year') return YIR_MONTHS[i];
  if (period.kind === 'day') return yirHour(i);
  const date = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
  return `${YIR_WEEKDAYS[date.getDay()]} ${date.getDate()} ${YIR_MONTHS[date.getMonth()]}`;
}
function yirBucketTick(period, i) {
  if (period.kind === 'year') return YIR_MONTHS[i][0];
  if (period.kind === 'week') return 'MTWTFSS'[i];
  if (period.kind === 'month') return i % 7 ? '' : String(i + 1);
  return i % 6 ? '' : yirHour(i);
}

export const YEAR_IN_REVIEW_SIZE = { width: 1080, height: 1350 };
const YIR_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const yirSvgText = (x, y, size, fill, value, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${esc(String(value))}</text>`;

// The card as standalone SVG, so the same markup shows in the dialog and
// rasterizes to a PNG without a DOM screenshot. colors holds resolved CSS
// colours for the current theme.
export function yearInReviewCardSvg(f, colors, fontFamily) {
  const { width: W, height: H } = YEAR_IN_REVIEW_SIZE;
  const c = colors;
  const font = esc(fontFamily || YIR_FONT);
  const pad = 72;
  const text = yirSvgText;
  const multi = f.machines.length > 1;
  const period = yirPeriodOf(f), label = yearInReviewPeriodLabel(period);
  // A single day has no streak or busiest day, so it shows its tokens and
  // answered questions instead.
  const day = period.kind === 'day';
  const tiles = [
    { label: 'Merged', value: f.merged.toLocaleString('en-US'), sub: f.shipRate === null ? 'nothing to ship yet' : `${f.shipRate}% ship rate`, tone: c.green },
    day
      ? { label: 'Tokens', value: f.tokens ? yearInReviewCompact(f.tokens) : '—', sub: f.tokens ? `across ${yirCount(f.tokenRuns, 'run')}` : 'no token counts', tone: c.orange }
      : { label: 'Longest streak', value: f.streak ? yirCount(f.streak.days, 'day') : '—', sub: f.streak ? (f.streak.days > 1 ? `${yirDayLabel(f.streak.from)} – ${yirDayLabel(f.streak.to)}` : yirDayLabel(f.streak.from)) : 'no runs yet', tone: c.orange },
    { label: 'Top project', value: f.topProject ? f.topProject.label : '—', sub: f.topProject ? `${yirCount(f.topProject.count, 'run')} · ${yirCount(f.projects, 'project')} total` : 'no projects yet', tone: c.accent },
    day
      ? { label: 'Answered', value: f.answered.toLocaleString('en-US'), sub: 'questions, no code needed', tone: c.purple }
      : { label: 'Busiest day', value: f.busiestDay ? yirCount(f.busiestDay.count, 'run') : '—', sub: f.busiestDay ? yirDayLabel(f.busiestDay.key) : 'no runs yet', tone: c.purple },
    { label: 'Your hours', value: f.persona || '—', sub: f.peakHour === null ? 'no runs yet' : `peak at ${String(f.peakHour).padStart(2, '0')}:00 · ${f.lateNight} after midnight`, tone: c.cyan },
    { label: 'Fastest merge', value: yearInReviewDuration(f.fastestMerge), sub: f.medianMerge === null ? 'no merges yet' : `median ${yearInReviewDuration(f.medianMerge)}`, tone: c.yellow },
  ];
  const tileW = (W - pad * 2 - 32) / 2, tileH = 152, tileTop = 562;
  const tilesSvg = tiles.map((t, i) => {
    const x = pad + (i % 2) * (tileW + 32), y = tileTop + Math.floor(i / 2) * (tileH + 18);
    const size = yirFitFontSize(t.value, tileW - 70, 48);
    return `<g>
      <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="24" fill="${c.panel}" fill-opacity="0.82" stroke="${c.border}" stroke-opacity="0.7"/>
      <rect x="${x + 22}" y="${y + 26}" width="6" height="${tileH - 52}" rx="3" fill="${t.tone}"/>
      ${text(x + 46, y + 42, 20, c.muted, t.label.toUpperCase(), ' font-weight="600" letter-spacing="2"')}
      ${text(x + 46, y + 92, size, c.heading, t.value, ' font-weight="700"')}
      ${text(x + 46, y + tileH - 20, 21, c.muted, t.sub)}
    </g>`;
  }).join('');
  const chartTop = 1112, chartH = 88, n = f.buckets.length, gap = n > 12 ? 4 : 10;
  const barW = (W - pad * 2 - gap * (n - 1)) / n;
  const peak = Math.max(1, ...f.buckets);
  const best = f.busiestBucket ? f.busiestBucket.index : -1;
  const bars = f.buckets.map((count, i) => {
    const h = count ? Math.max(6, Math.round((count / peak) * chartH)) : 2;
    const r = Math.min(4, h, barW / 2), x = +(pad + i * (barW + gap)).toFixed(1), w = +barW.toFixed(1), y = chartTop + chartH - h;
    const tick = yirBucketTick(period, i);
    // Hour ticks are as wide as several bars, so they start at their bar.
    const hourTick = period.kind === 'day';
    return `<g><title>${yirBucketName(period, i)}: ${yirCount(count, 'run')}</title>
      <path d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z" fill="${c.accent}" fill-opacity="${i === best ? 1 : 0.42}"/>
      ${tick ? text(hourTick ? x : x + w / 2, chartTop + chartH + 28, 19, i === best && !hourTick ? c.heading : c.muted, tick, `${hourTick ? '' : ' text-anchor="middle"'}${i === best && !hourTick ? ' font-weight="700"' : ''}`) : ''}
    </g>`;
  }).join('');
  const agents = [`Claude ${f.claude.toLocaleString('en-US')} · Codex ${f.codex.toLocaleString('en-US')}`];
  if (f.delegated) agents.push(`${yirCount(f.delegated, 'agent')} delegated`);
  if (f.topModels.length) agents.push(`favourite model ${f.topModels[0].name}`);
  // Machines keep fixed hues in their run-count order, each labelled with its
  // own name and figures so identity never rests on colour alone.
  const tones = [c.accent, c.purple, c.green, c.orange, c.cyan];
  let machinesSvg = '';
  if (multi) {
    const shown = f.machines.slice(0, 3);
    const slot = (W - pad * 2) / shown.length;
    machinesSvg = shown.map((m, i) => {
      const x = pad + i * slot;
      const label = `${m.name} · ${yirCount(m.runs, 'run')}, ${m.merged.toLocaleString('en-US')} merged`;
      return `<circle cx="${x + 8}" cy="${H - 79}" r="8" fill="${tones[i]}"/>${text(x + 24, H - 72, yirFitFontSize(label, slot - 34, 21), c.text, label, ' font-weight="600"')}`;
    }).join('') + (f.machines.length > 3 ? text(W - pad, H - 104, 18, c.muted, `+${f.machines.length - 3} more`, ' text-anchor="end"') : '');
  }
  const heroSub = day
    ? `${f.runs === 1 ? 'run' : 'runs'} on ${yearInReviewPeriodLabel(period, true)}${multi ? ` across ${f.machines.length} machines` : ''}`
    : `${f.runs === 1 ? 'run' : 'runs'} across ${yirCount(f.activeDays, 'day')}${multi ? ` on ${f.machines.length} machines` : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}">
  <defs>
    <radialGradient id="yir-glow-a" cx="0.85" cy="0.08" r="0.65"><stop offset="0" stop-color="${c.accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="yir-glow-b" cx="0.05" cy="0.62" r="0.6"><stop offset="0" stop-color="${c.purple}" stop-opacity="0.32"/><stop offset="1" stop-color="${c.purple}" stop-opacity="0"/></radialGradient>
    <radialGradient id="yir-glow-c" cx="0.9" cy="0.98" r="0.5"><stop offset="0" stop-color="${c.green}" stop-opacity="0.28"/><stop offset="1" stop-color="${c.green}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#yir-glow-a)"/>
  <rect width="${W}" height="${H}" fill="url(#yir-glow-b)"/>
  <rect width="${W}" height="${H}" fill="url(#yir-glow-c)"/>
  ${text(pad, 104, 24, c.muted, `ORC · ${period.kind.toUpperCase()} IN REVIEW`, ' font-weight="600" letter-spacing="4"')}
  ${text(W - pad, 108, yirFitFontSize(label, 500, 40), c.accent, label, ' font-weight="800" text-anchor="end"')}
  ${text(pad - 8, 316, yirFitFontSize(f.runs.toLocaleString('en-US'), W - pad * 2, 220), c.heading, f.runs.toLocaleString('en-US'), ' font-weight="800" letter-spacing="-6"')}
  ${text(pad, 376, yirFitFontSize(heroSub, W - pad * 2, 38), c.text, heroSub, ' font-weight="500"')}
  ${yirWrap(yearInReviewHeadline(f), 38, 2).map((line, i) => text(pad, 450 + i * 46, 36, c.heading, line, ' font-weight="600"')).join('')}
  ${tilesSvg}
  ${text(pad, chartTop - 20, 20, c.muted, `RUNS BY ${{ year: 'MONTH', day: 'HOUR' }[period.kind] || 'DAY'}`, ' font-weight="600" letter-spacing="2"')}
  ${bars}
  ${machinesSvg}
  ${text(pad, H - 36, yirFitFontSize(agents.join(' · '), W - pad * 2, 21), c.muted, agents.join(' · '))}
</svg>`;
}

// 1.24B rather than 1,240,000,000: three significant figures and a unit.
export function yearInReviewCompact(n) {
  if (!Number.isFinite(n) || n < 1000) return String(Number.isFinite(n) ? Math.round(n) : 0);
  for (const [size, unit] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    const value = +(n / size).toPrecision(3);
    if (value >= 1) return `${value}${unit}`;
  }
  return String(n);
}
const yirUsd = n => `$${Math.round(n).toLocaleString('en-US')}`;
// War and Peace runs to about 780,000 tokens.
const YIR_NOVEL_TOKENS = 780000;
function yirModelValue(m) {
  return m.tokens ? `${yearInReviewCompact(m.tokens)} tokens${m.runs ? ` · ${yirCount(m.runs, 'run')}` : ''}` : yirCount(m.runs, 'run');
}
function yirHour(hour) { return `${String(hour).padStart(2, '0')}:00`; }

// The story cards, in the order they play. Cards with nothing to say are left
// out, a day has no streak, and the summary card always closes the set.
export function yearInReviewDeck(f) {
  const deck = [{ key: 'intro', label: 'Intro' }];
  if (f.tokens > 0) deck.push({ key: 'tokens', label: 'Tokens' });
  if (f.topModels.length) deck.push({ key: 'model', label: 'Favourite model' });
  if (f.topProjects.length) deck.push({ key: 'projects', label: 'Top projects' });
  if (f.runs) deck.push({ key: 'hours', label: 'Your hours' });
  if (f.runs && f.period.kind !== 'day') deck.push({ key: 'streak', label: 'Streak' });
  if (f.merged) deck.push({ key: 'shipped', label: 'Shipped' });
  deck.push({ key: 'summary', label: 'Summary' });
  return deck;
}

export function yearInReviewCardAlt(f, key) {
  const lead = `${yearInReviewPeriodLabel(yirPeriodOf(f))} in Orc: `;
  if (key === 'intro') {
    const across = f.period.kind === 'day' ? '' : ` across ${yirCount(f.activeDays, 'day')}`;
    return `${lead}${yirCount(f.runs, 'run')} and ${f.merged.toLocaleString('en-US')} merged${across}.`;
  }
  if (key === 'tokens') {
    const cost = f.cost ? `, about ${yirUsd(f.cost)} at API prices` : '';
    return `${lead}${yearInReviewCompact(f.tokens)} tokens used across ${yirCount(f.tokenRuns, 'run')}${cost}.`;
  }
  if (key === 'model') return `${lead}favourite model ${f.topModels[0].name}. Top models: ${f.topModels.map(m => `${m.name} (${yirModelValue(m)})`).join(', ')}.`;
  if (key === 'projects') return `${lead}top projects ${f.topProjects.map(p => `${p.label} (${yirCount(p.count, 'run')})`).join(', ')}.`;
  if (key === 'hours') return `${lead}${f.persona}. Most runs started around ${yirHour(f.peakHour)}, ${f.lateNight} after midnight and ${f.weekend} at weekends.`;
  if (key === 'streak') {
    const range = f.streak.days > 1 ? ` from ${yirDayLabel(f.streak.from)} to ${yirDayLabel(f.streak.to)}` : '';
    return `${lead}longest streak ${yirCount(f.streak.days, 'day')}${range}. Busiest day ${yirDayLabel(f.busiestDay.key)} with ${yirCount(f.busiestDay.count, 'run')}. Active on ${yirCount(f.activeDays, 'day')}.`;
  }
  if (key === 'shipped') {
    const bits = [`${f.merged.toLocaleString('en-US')} merged`];
    if (f.shipRate !== null) bits.push(`${f.shipRate}% ship rate`);
    if (f.fastestMerge !== null) bits.push(`fastest merge ${yearInReviewDuration(f.fastestMerge)}`);
    return `${lead}${bits.join(', ')}.`;
  }
  return yearInReviewSummary(f);
}

// Bold shapes in the theme's accent colours, kept clear of the text column so
// every theme stays readable.
function yirShape(kind, tone, tone2, bg) {
  const cx = 960, cy = 340;
  if (kind === 'disc') {
    return `<circle cx="${cx}" cy="${cy}" r="200" fill="${tone}"/><circle cx="${cx}" cy="${cy}" r="132" fill="none" stroke="${bg}" stroke-opacity="0.25" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="70" fill="${bg}"/><circle cx="${cx}" cy="${cy}" r="22" fill="${tone2}"/>`;
  }
  if (kind === 'rings') {
    return [200, 140, 80].map(r => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${tone}" stroke-width="24"/>`).join('')
      + `<circle cx="${cx}" cy="${cy}" r="26" fill="${tone2}"/>`;
  }
  if (kind === 'burst') {
    const points = Array.from({ length: 32 }, (_, i) => {
      const r = i % 2 ? 150 : 210, a = (Math.PI * i) / 16;
      return `${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`;
    }).join(' ');
    return `<polygon points="${points}" fill="${tone}"/><circle cx="${cx}" cy="${cy}" r="64" fill="${tone2}"/>`;
  }
  return [[-90, tone], [0, tone2], [90, tone]].map(([dy, fill]) =>
    `<rect x="${cx - 170}" y="${cy + dy - 40}" width="340" height="80" rx="40" fill="${fill}" transform="rotate(-28 ${cx} ${cy + dy})"/>`).join('');
}
const YIR_SHAPES = ['disc', 'burst', 'rings', 'pills'];

function yirRows(items, top, tone, c) {
  const pad = 80, width = YEAR_IN_REVIEW_SIZE.width - pad * 2, rowH = 58;
  const most = Math.max(1, ...items.map(item => item.weight));
  return items.map((item, i) => {
    const y = top + i * rowH, barW = Math.max(56, Math.round((item.weight / most) * width));
    return `<rect x="${pad}" y="${y}" width="${barW}" height="48" rx="14" fill="${tone}" fill-opacity="${i ? 0.2 : 0.42}"/>
      ${yirSvgText(pad + 22, y + 34, 26, c.heading, i + 1, ' font-weight="800"')}
      ${yirSvgText(pad + 62, y + 34, yirFitFontSize(item.name, width - 330, 28), c.heading, item.name, ' font-weight="600"')}
      ${yirSvgText(pad + width - 18, y + 34, 24, c.text, item.value, ' text-anchor="end"')}`;
  }).join('');
}

function yirStats(items, top, tones, c) {
  const pad = 80, colW = (YEAR_IN_REVIEW_SIZE.width - pad * 2 - 32) / 2, rowH = 136;
  return items.map((item, i) => {
    const x = pad + (i % 2) * (colW + 32), y = top + Math.floor(i / 2) * rowH;
    return `<rect x="${x}" y="${y}" width="6" height="104" rx="3" fill="${tones[i % tones.length]}"/>
      ${yirSvgText(x + 26, y + 22, 20, c.muted, item.label.toUpperCase(), ' font-weight="600" letter-spacing="2"')}
      ${yirSvgText(x + 26, y + 72, yirFitFontSize(item.value, colW - 40, 50), c.heading, item.value, ' font-weight="700"')}
      ${yirSvgText(x + 26, y + 104, 22, c.text, item.sub)}`;
  }).join('');
}

function yirStoryContent(f, key, tone, tones, c) {
  const pad = 80, W = YEAR_IN_REVIEW_SIZE.width;
  const period = yirPeriodOf(f), noun = period.kind;
  if (key === 'intro') {
    const sub = [yirCount(f.runs, 'run'), `${f.merged.toLocaleString('en-US')} merged`];
    if (noun !== 'day') sub.push(yirCount(f.activeDays, 'active day'));
    return {
      kicker: `Your ${noun} in Orc`, hero: yearInReviewPeriodLabel(period, true), heroMax: 300,
      sub: sub.join(' · '),
      body: yirWrap(f.runs ? 'Here is how the swamp remembers it.' : `A quiet ${noun} so far. The swamp awaits.`, 26, 2)
        .map((line, i) => yirSvgText(pad, 990 + i * 62, 50, c.heading, line, ' font-weight="700"')).join(''),
    };
  }
  if (key === 'tokens') {
    const novels = Math.floor(f.tokens / YIR_NOVEL_TOKENS);
    const fun = novels >= 2 ? `That is War and Peace ${novels.toLocaleString('en-US')} times over.` : 'Every one of them put to work.';
    const shares = f.topModels.filter(m => m.tokens).slice(0, 3);
    let x = pad;
    const split = shares.map((m, i) => {
      const w = Math.max(8, ((W - pad * 2) * m.tokens) / f.tokens);
      const bar = `<rect x="${x.toFixed(1)}" y="1104" width="${w.toFixed(1)}" height="30" fill="${tones[i % tones.length]}"/>`;
      x += w;
      return bar;
    }).join('');
    const legend = shares.map(m => `${m.name} ${Math.round((m.tokens / f.tokens) * 100)}%`).join('  ·  ');
    return {
      kicker: 'You put the models to work', hero: yearInReviewCompact(f.tokens), heroMax: 260,
      sub: `tokens across ${yirCount(f.tokenRuns, 'run')}`,
      body: yirWrap(fun, 30, 2).map((line, i) => yirSvgText(pad, 935 + i * 54, 44, c.heading, line, ' font-weight="700"')).join('')
        + (f.cost ? yirSvgText(pad, 1062, 30, c.text, `About ${yirUsd(f.cost)} at API prices`) : '')
        + (shares.length ? `<clipPath id="yir-split"><rect x="${pad}" y="1104" width="${W - pad * 2}" height="30" rx="15"/></clipPath><g clip-path="url(#yir-split)">${split}</g>`
          + yirSvgText(pad, 1176, yirFitFontSize(legend, W - pad * 2, 24), c.muted, legend) : ''),
    };
  }
  if (key === 'model') {
    const top = f.topModels[0];
    return {
      kicker: 'Your favourite model was', hero: top.name, heroMax: 150,
      sub: yirModelValue(top),
      body: yirRows(f.topModels.map(m => ({ name: m.name, value: yirModelValue(m), weight: m.tokens || m.runs })), 905, tone, c),
    };
  }
  if (key === 'projects') {
    return {
      kicker: `Where you spent your ${noun}`, hero: f.topProject.label, heroMax: 150,
      sub: `${yirCount(f.topProject.count, 'run')} · ${yirCount(f.projects, 'project')} in total`,
      body: yirRows(f.topProjects.map(p => ({ name: p.label, value: yirCount(p.count, 'run'), weight: p.count })), 905, tone, c),
    };
  }
  if (key === 'hours') {
    const chartTop = 930, chartH = 200, gap = 6, barW = (W - pad * 2 - gap * 23) / 24;
    const most = Math.max(1, ...f.hours);
    const bars = f.hours.map((count, hour) => {
      const h = count ? Math.max(8, Math.round((count / most) * chartH)) : 3;
      return `<rect x="${(pad + hour * (barW + gap)).toFixed(1)}" y="${chartTop + chartH - h}" width="${barW.toFixed(1)}" height="${h}" rx="4" fill="${tone}" fill-opacity="${hour === f.peakHour ? 1 : 0.38}"/>`;
    }).join('');
    const labels = [0, 6, 12, 18].map(hour => yirSvgText(pad + hour * (barW + gap), chartTop + chartH + 36, 22, c.muted, yirHour(hour))).join('');
    return {
      kicker: 'When the swamp called, you were a', hero: f.persona, heroMax: 170,
      sub: `Most runs started around ${yirHour(f.peakHour)} · ${f.lateNight.toLocaleString('en-US')} after midnight`,
      body: bars + labels,
    };
  }
  if (key === 'streak') {
    const range = f.streak.days > 1 ? `${yirDayLabel(f.streak.from)} – ${yirDayLabel(f.streak.to)}` : yirDayLabel(f.streak.from);
    return {
      kicker: 'You kept coming back', hero: yirCount(f.streak.days, 'day'), heroMax: 220,
      sub: `in a row, ${range}`,
      body: yirStats([
        { label: 'Busiest day', value: yirDayLabel(f.busiestDay.key), sub: yirCount(f.busiestDay.count, 'run') },
        { label: 'Active days', value: f.activeDays.toLocaleString('en-US'), sub: `${f.weekend.toLocaleString('en-US')} weekend runs` },
        noun === 'year'
          ? { label: 'Busiest month', value: YIR_MONTHS[f.busiestBucket.index], sub: yirCount(f.busiestBucket.count, 'run') }
          : { label: 'Peak hour', value: yirHour(f.peakHour), sub: yirCount(f.hours[f.peakHour], 'run') },
        { label: 'Late nights', value: f.lateNight.toLocaleString('en-US'), sub: 'runs after midnight' },
      ], 920, tones, c),
    };
  }
  return {
    kicker: 'And you shipped', hero: f.merged.toLocaleString('en-US'), heroMax: 260,
    sub: f.shipRate === null ? 'merged' : `merged · ${f.shipRate}% ship rate`,
    body: yirStats([
      { label: 'Fastest merge', value: yearInReviewDuration(f.fastestMerge), sub: 'start to merged' },
      { label: 'Median merge', value: yearInReviewDuration(f.medianMerge), sub: 'start to merged' },
      { label: 'Claude · Codex', value: `${f.claude.toLocaleString('en-US')} · ${f.codex.toLocaleString('en-US')}`, sub: 'runs by agent' },
      f.delegated
        ? { label: 'Delegated', value: f.delegated.toLocaleString('en-US'), sub: 'agents put to work' }
        : { label: 'Answered', value: f.answered.toLocaleString('en-US'), sub: 'questions, no code needed' },
    ], 920, tones, c),
  };
}

// One story card as standalone SVG, the same size as the summary card, with
// story progress along the top so a pasted card shows where it sits.
export function yearInReviewStorySvg(f, deck, index, colors, fontFamily) {
  const card = deck[index];
  if (!card || card.key === 'summary') return yearInReviewCardSvg(f, colors, fontFamily);
  const { width: W, height: H } = YEAR_IN_REVIEW_SIZE;
  const c = colors, pad = 80;
  const tones = [c.accent, c.purple, c.green, c.orange, c.cyan, c.yellow];
  const tone = tones[index % tones.length], tone2 = tones[(index + 2) % tones.length];
  const content = yirStoryContent(f, card.key, tone, [tone, tone2, ...tones.filter(t => t !== tone && t !== tone2)], c);
  const segW = (W - pad * 2 - (deck.length - 1) * 10) / deck.length;
  const progress = deck.map((_, i) =>
    `<rect x="${(pad + i * (segW + 10)).toFixed(1)}" y="44" width="${segW.toFixed(1)}" height="6" rx="3" fill="${c.heading}" fill-opacity="${i <= index ? 0.9 : 0.18}"/>`).join('');
  const kicker = yirWrap(content.kicker, 20, 3);
  const period = yirPeriodOf(f), label = yearInReviewPeriodLabel(period);
  const heroSize = yirFitFontSize(content.hero, W - pad * 2, content.heroMax);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(fontFamily || YIR_FONT)}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  ${yirShape(YIR_SHAPES[index % YIR_SHAPES.length], tone, tone2, c.bg)}
  <circle cx="0" cy="${H}" r="170" fill="${tone2}"/>
  ${progress}
  <text x="${pad}" y="116" font-size="24" fill="${c.muted}" font-weight="600" letter-spacing="4"><tspan fill="${c.heading}" font-weight="800">ORC</tspan> · ${period.kind.toUpperCase()} IN REVIEW</text>
  ${yirSvgText(W - pad, 116, yirFitFontSize(label, 480, 26), c.heading, label, ' font-weight="800" text-anchor="end"')}
  ${kicker.map((line, i) => yirSvgText(pad, 300 + i * 72, 60, c.heading, line, ' font-weight="700" letter-spacing="-1"')).join('')}
  ${yirSvgText(pad - 6, 740, heroSize, c.heading, content.hero, ` font-weight="800" letter-spacing="${heroSize > 150 ? -6 : -2}"`)}
  <rect x="${pad}" y="772" width="150" height="14" rx="7" fill="${tone}"/>
  ${yirSvgText(pad, 846, yirFitFontSize(content.sub, W - pad * 2, 34), c.text, content.sub, ' font-weight="500"')}
  ${content.body}
  ${yirSvgText(W - pad, H - 56, 24, c.muted, `orc · ${label}`, ' font-weight="600" text-anchor="end" letter-spacing="2"')}
</svg>`;
}

const yirCacheKey = period => `${period.kind}:${period.key}`;

// The saved state: the kind last shown, one pool of pasted runs with one
// Combine or Replace setting, and figures per period. Stores from before
// periods kept pasted runs per year; those move into the pool so nothing
// pasted earlier is lost, and their figures are regenerated.
export function yearInReviewStore(raw) {
  const store = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const clean = list => (Array.isArray(list) ? list.map(record => yirCleanRecord(record, null)).filter(Boolean) : []);
  if (store.version !== 2) {
    const years = Object.keys(store).filter(key => /^\d{4}$/.test(key) && store[key] && typeof store[key] === 'object').sort();
    const pasted = years.filter(key => clean(store[key].imported).length);
    return {
      version: 2, kind: 'year', figures: {},
      imported: yearInReviewMerge(...years.map(key => clean(store[key].imported))),
      replace: pasted.length ? store[pasted[pasted.length - 1]].replace === true : false,
    };
  }
  const figures = Object.entries(store.figures && typeof store.figures === 'object' ? store.figures : {})
    .filter(([key, f]) => f && f.version === YIR_FIGURES_VERSION && f.period && yirCacheKey(f.period) === key
      && yearInReviewPeriod(f.period.kind, f.period.key) && Array.isArray(f.buckets) && Array.isArray(f.machines))
    .slice(-YIR_CACHE);
  return {
    version: 2,
    kind: YEAR_IN_REVIEW_KINDS.includes(store.kind) ? store.kind : 'year',
    figures: Object.fromEntries(figures),
    imported: yearInReviewMerge(clean(store.imported)),
    replace: store.replace === true,
  };
}

export function yearInReviewCached(store, period) {
  return store.figures[yirCacheKey(period)] || null;
}

// Keeps the newest figures last and only the most recent few periods, so the
// store stays small however far back someone steps.
export function yearInReviewRemember(store, figures) {
  const key = yirCacheKey(figures.period);
  const kept = Object.entries(store.figures).filter(([k]) => k !== key);
  return { ...store, figures: Object.fromEntries([...kept, [key, figures]].slice(-YIR_CACHE)) };
}
// END TESTABLE: year in review figures

const STORE_KEY = 'orcYearInReview';
const COLOR_TOKENS = ['bg', 'panel', 'border', 'heading', 'text', 'muted', 'accent', 'green', 'purple', 'cyan', 'orange', 'yellow'];
// The GIF is drawn at half size, which keeps it small enough to post. Each
// card holds, then slides up into the next like a story.
const GIF_SCALE = 0.5;
const GIF_HOLD_CS = 240;
const GIF_SLIDE = [0.3, 0.72];
const GIF_SLIDE_CS = 8;

function readStore() {
  try { return yearInReviewStore(JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { return yearInReviewStore({}); }
}
function writeStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

// Resolve each theme token to a concrete colour through a probe inside the
// dialog, so dark and fun modes land in the SVG exactly as shown and the PNG
// carries plain colours rather than var() references.
function themeColors(host) {
  const probe = document.createElement('span');
  probe.hidden = true;
  host.appendChild(probe);
  const colors = {};
  COLOR_TOKENS.forEach(name => {
    probe.style.color = `var(--${name})`;
    colors[name] = getComputedStyle(probe).color;
  });
  const font = getComputedStyle(probe).getPropertyValue('--orc-font-sans').trim();
  probe.remove();
  return { colors, font };
}

const dialog = $('year-review-dialog');
const cardEl = $('year-review-card');
const imageEl = $('year-review-image');
const stepEl = $('year-review-step');
const prevEl = $('year-review-prev');
const nextEl = $('year-review-next');
const pasteEl = $('year-review-paste');
const statusEl = $('year-review-status');
const kindEl = $('year-review-kind');
const labelEl = $('year-review-label');
const earlierEl = $('year-review-earlier');
const laterEl = $('year-review-later');
const modeEl = $('year-review-mode');
const clearEl = $('year-review-clear');
let store = yearInReviewStore({});
let period = null;
let figures = null;
let deck = [];
let index = 0;
// Token counts per run id, by the year the server counted them for.
const usageByYear = new Map();
let generation = 0;
let themeObserver = null;
// Each card is shown as the same PNG that Copy image and Download PNG hand
// over, so the app's own right-click Copy Image works where the web clipboard
// API is refused. Drawn cards are kept per theme until the figures change.
const drawn = new Map();
let shown = null;
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

function setStatus(message) { statusEl.textContent = message; }
function savedAtLabel(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'earlier' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const periodLabel = () => yearInReviewPeriodLabel(period);
const fileStem = () => `orc-${period.kind}-in-review-${period.key}`;
function cardPng(i) {
  const { colors, font } = themeColors(dialog);
  const svg = yearInReviewStorySvg(figures, deck, i, colors, font);
  let entry = drawn.get(i);
  if (entry?.svg !== svg) {
    entry = { svg, png: rasterize(svg) };
    drawn.set(i, entry);
  }
  return entry;
}
function paint() {
  if (!figures) return;
  const card = deck[index];
  imageEl.alt = yearInReviewCardAlt(figures, card.key);
  stepEl.textContent = `${index + 1} of ${deck.length} · ${card.label}`;
  const entry = cardPng(index);
  if (shown === entry) return;
  shown = entry;
  cardEl.setAttribute('aria-busy', 'true');
  entry.png.then(blob => {
    if (shown !== entry) return;
    const previous = imageEl.src;
    imageEl.src = URL.createObjectURL(blob);
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    cardEl.removeAttribute('aria-busy');
  }, () => {
    if (shown === entry) setStatus('Could not draw the card. Switch theme or Regenerate to try again.');
  });
}
function show(nextFigures, keep = null) {
  figures = nextFigures;
  deck = yearInReviewDeck(figures);
  const at = keep ? deck.findIndex(card => card.key === keep) : -1;
  index = at === -1 ? 0 : at;
  drawn.clear();
  shown = null;
  paint();
}
// Stepping wraps around, like the GIF, so neither button ever goes dead under focus.
function go(step) {
  index = (index + step + deck.length) % deck.length;
  paint();
}
function syncControls() {
  modeEl.value = store.replace ? 'replace' : 'combine';
  clearEl.hidden = !store.imported.length;
}
function stamps() {
  return [...runs.map(run => yirStamp(run?.id)), ...store.imported.map(record => record.t)].filter(Boolean);
}
function syncPeriod() {
  const kindName = `${period.kind[0].toUpperCase()}${period.kind.slice(1)}`;
  dialog.setAttribute('heading', `${kindName} in review`);
  kindEl.value = period.kind;
  labelEl.textContent = periodLabel();
  laterEl.disabled = period.start >= yearInReviewPeriod(period.kind).start;
  earlierEl.disabled = !stamps().some(stamp => yirStart(stamp) < period.start);
}
// A week can straddle New Year, so a period asks for every year it touches.
function periodYears(at) {
  const first = at.start.getFullYear(), last = new Date(at.end - 1).getFullYear();
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
function usageFor(at) {
  return Object.assign({}, ...periodYears(at).map(year => usageByYear.get(year) || {}));
}
function records() {
  const pasted = store.imported.filter(record => yearInReviewInPeriod(period, record.t));
  return store.replace ? pasted : yearInReviewMerge(pasted, yearInReviewRecords(runs, period, usageFor(period)));
}
// Counting tokens reads every run's transcript, which can take the better part
// of a minute the first time; the server keeps the counts after that.
function loadUsage(years) {
  return Promise.all(years.map(year => fetch(`/api/year-in-review/usage?year=${year}`)
    .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then(payload => { usageByYear.set(year, yearInReviewUsage(payload)); return true; }, () => false)))
    .then(results => results.every(Boolean));
}
async function generate() {
  const ticket = ++generation;
  let note = '';
  if (!store.replace) {
    const stale = !figures || figures.period.kind !== period.kind || figures.period.key !== period.key;
    if (stale || !periodYears(period).every(year => usageByYear.has(year))) {
      show(yearInReviewFigures(records(), period), deck[index]?.key);
      syncControls();
    }
    setStatus('Counting tokens from every run’s transcript. The first count can take a minute.');
    if (!(await loadUsage(periodYears(period)))) note = ' Token counts are unavailable right now.';
    if (ticket !== generation) return;
  }
  show(yearInReviewFigures(records(), period), deck[index]?.key);
  store = yearInReviewRemember(store, figures);
  writeStore();
  syncControls();
  const machines = figures.machines.length > 1 ? ` across ${yirCount(figures.machines.length, 'machine')}` : '';
  setStatus(`${figures.runs ? `Generated from ${yirCount(figures.runs, 'run')}${machines} just now.` : `No runs ${period.kind === 'day' ? 'on' : 'in'} ${periodLabel()} yet.`}${note}`);
}
function load(next) {
  period = next;
  generation++;
  syncPeriod();
  const saved = yearInReviewCached(store, period);
  if (saved) {
    show(saved, deck[index]?.key);
    syncControls();
    setStatus(`Saved figures from ${savedAtLabel(figures.generatedAt)}. Regenerate to include newer runs.`);
    // Fetched quietly so Copy JSON carries this machine's token counts.
    const missing = periodYears(period).filter(year => !usageByYear.has(year));
    if (missing.length) loadUsage(missing);
  } else {
    generate();
  }
}
// Pasted runs or the Combine/Replace setting changed, so every saved period's
// figures are out of date.
function poolChanged() {
  store = { ...store, figures: {} };
}

function watchTheme(on) {
  themeObserver?.disconnect();
  themeObserver = null;
  darkQuery?.removeEventListener?.('change', paint);
  if (!on) return;
  themeObserver = new MutationObserver(() => paint());
  themeObserver.observe(document.documentElement, { attributes: true });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  darkQuery?.addEventListener?.('change', paint);
}

export function openYearInReview(kind) {
  store = readStore();
  if (kind) store = { ...store, kind };
  // Rewrites a store saved before periods in the pooled shape.
  writeStore();
  figures = null;
  deck = [];
  pasteEl.value = '';
  dialog.show();
  load(yearInReviewLatest(store.kind, stamps()));
  watchTheme(true);
  // Without preventScroll a phone scrolls the card's top out of view.
  nextEl.focus({ preventScroll: true });
}

function exportText() {
  return JSON.stringify(yearInReviewExport(period, records()), null, 2);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// An SVG drawn through an <img> cannot load the page's web fonts, so Inter
// travels inside it, as the Mermaid diagram export does.
let interFace = null;
function interFontFace() {
  interFace ??= fetch('/fonts/inter-latin-wght-normal.woff2').then(async response => {
    if (!response.ok) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face { font-family: "Inter"; src: url(data:font/woff2;base64,${btoa(binary)}) format("woff2"); font-weight: 100 900; }`;
  }).catch(() => '');
  return interFace;
}
async function rasterize(svg) {
  const { width, height } = YEAR_IN_REVIEW_SIZE;
  const face = await interFontFace();
  const source = face ? svg.replace(/(<svg[^>]*>)/, `$1<style>${face}</style>`) : svg;
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(picture, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('empty image'))), 'image/png'));
}
function cardName() {
  const key = deck[index].key;
  return `${fileStem()}${key === 'summary' ? '' : `-${index + 1}-${key}`}.png`;
}

// Every card at half size, each held and then slid into the next, looping
// back to the first.
async function gifFrames() {
  const { width, height } = YEAR_IN_REVIEW_SIZE;
  const w = Math.round(width * GIF_SCALE), h = Math.round(height * GIF_SCALE);
  const cards = await Promise.all(deck.map((_, i) => cardPng(i).png.then(blob => createImageBitmap(blob))));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const frames = [], delaysCs = [];
  const frame = (from, to, t, delay) => {
    const shift = Math.round(h * (1 - (1 - t) ** 3));
    ctx.drawImage(from, 0, -shift, w, h);
    if (to) ctx.drawImage(to, 0, h - shift, w, h);
    frames.push(canvas.toDataURL('image/png'));
    delaysCs.push(delay);
  };
  cards.forEach((card, i) => {
    frame(card, null, 0, GIF_HOLD_CS);
    if (cards.length > 1) GIF_SLIDE.forEach(t => frame(card, cards[(i + 1) % cards.length], t, GIF_SLIDE_CS));
  });
  return { frames, delaysCs };
}
async function exportGif(deliver) {
  const name = fileStem();
  setStatus('Making the GIF…');
  try {
    const shot = await gifFrames();
    const response = await fetch('/api/gallery-gif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: name, format: 'gif', deliver, ...shot }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'GIF export failed');
    if (body.copied) setStatus(`Copied ${body.name}. Paste it into Slack, Messages or a folder.`);
    else if (body.path) setStatus(`Saved ${body.name} to Downloads.`);
    else {
      const a = document.createElement('a');
      a.href = body.url;
      a.download = body.name || `${name}.gif`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus(`Downloading ${body.name || `${name}.gif`}.`);
    }
  } catch (error) {
    setStatus(`Could not make the GIF: ${error.message}`);
  }
}

prevEl.onclick = () => go(-1);
nextEl.onclick = () => go(1);
// Arrow keys step through the cards unless a control that uses them has focus.
dialog.addEventListener('keydown', e => {
  if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.target.closest?.('orc-textarea, orc-segmented, input, textarea')) return;
  e.preventDefault();
  go(e.key === 'ArrowLeft' ? -1 : 1);
});
// Switching kind zooms in or out around the period on show, never past today.
kindEl.addEventListener('change', e => {
  const kind = e.detail.value;
  store = { ...store, kind };
  writeStore();
  const now = new Date();
  load(yearInReviewLatest(kind, stamps(), period.end > now ? now : new Date(period.end - 1)));
});
earlierEl.addEventListener('click', () => { if (!earlierEl.disabled) load(yearInReviewStep(period, -1)); });
laterEl.addEventListener('click', () => { if (!laterEl.disabled) load(yearInReviewStep(period, 1)); });
$('year-review-regenerate').onclick = () => { generate(); announce(`Year in review regenerating for ${periodLabel()}.`); };
$('year-review-close').onclick = () => dialog.close();
dialog.addEventListener('close', () => { generation++; watchTheme(false); });
modeEl.addEventListener('change', e => {
  store = { ...store, replace: e.detail.value === 'replace' };
  if (store.imported.length) {
    poolChanged();
    generate();
  } else {
    writeStore();
  }
});
$('year-review-import').onclick = () => {
  const parsed = yearInReviewParse(pasteEl.value);
  if (parsed.error) { setStatus(parsed.error); pasteEl.focus(); return; }
  // Combine keeps earlier imports so a third machine can join a second;
  // Replace shows only what was just pasted for that period.
  const kept = store.replace ? store.imported.filter(record => !yearInReviewInPeriod(parsed.period, record.t)) : store.imported;
  store = { ...store, kind: parsed.period.kind, imported: yearInReviewMerge(kept, parsed.records) };
  poolChanged();
  pasteEl.value = '';
  period = parsed.period;
  syncPeriod();
  const skipped = parsed.skipped ? ` Skipped ${yirCount(parsed.skipped, 'malformed run')}.` : '';
  const done = `${store.replace ? 'Replaced with' : 'Combined with'} ${yirCount(parsed.records.length, 'pasted run')}.${skipped}`;
  generate().then(() => setStatus(done));
};
clearEl.onclick = () => {
  store = { ...store, imported: [], replace: false };
  poolChanged();
  syncPeriod();
  generate().then(() => setStatus('Removed pasted runs. Showing this machine only.'));
  $('year-review-regenerate').focus();
};
$('year-review-copy-json').onclick = async () => {
  try {
    await navigator.clipboard.writeText(exportText());
    setStatus('Copied the JSON. Paste it into Year in review on another machine.');
  } catch {
    setStatus('Copy failed. Use Download JSON instead.');
  }
};
$('year-review-download-json').onclick = () => {
  download(new Blob([exportText()], { type: 'application/json' }), `${fileStem()}.json`);
  setStatus('Downloaded the JSON.');
};
$('year-review-download').onclick = async () => {
  try {
    download(await cardPng(index).png, cardName());
    setStatus(`Downloaded ${deck[index].label} as a PNG.`);
  } catch {
    setStatus('Could not draw the card as a PNG. Try again.');
  }
};
// WebKit only lets the click write to the clipboard if the write starts in the
// click itself, so the item is handed the pending PNG rather than awaiting it.
$('year-review-copy').onclick = async () => {
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('unsupported');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardPng(index).png })]);
    setStatus(`Copied ${deck[index].label} to your clipboard as an image.`);
  } catch {
    setStatus('This window blocked the copy. Right-click the card and choose Copy Image.');
  }
};
$('year-review-copy-gif').onclick = () => exportGif('copy');
$('year-review-download-gif').onclick = () => exportGif('download');
