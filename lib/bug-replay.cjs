const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function localURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Only HTTP(S) loopback previews without URL credentials are supported');
  }
  return url.href;
}

function validateFlow(flow) {
  localURL(flow.url);
  if (!Array.isArray(flow.steps) || flow.steps.length > 50) throw new Error('steps must be an array of at most 50 actions');
  for (const step of flow.steps) {
    if (!['click', 'fill', 'press'].includes(step.action) || typeof step.selector !== 'string' || !step.selector.trim()) throw new Error('Each step needs click, fill or press and a selector');
    if (step.action !== 'click' && typeof step.value !== 'string') throw new Error('fill and press need a string value');
  }
  if (!flow.expected || typeof flow.expected.selector !== 'string' || !flow.expected.selector.trim() || typeof flow.expected.text !== 'string') throw new Error('expected needs selector and exact text');
  return { url: localURL(flow.url), steps: flow.steps.map(({ action, selector, value }) => ({ action, selector, ...(action === 'click' ? {} : { value }) })), expected: { selector: flow.expected.selector, text: flow.expected.text } };
}

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function revision(repo) {
  return { head: execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) };
}

async function record(options) {
  const flow = validateFlow(await readJSON(options.flow));
  const repo = path.resolve(options.repo || '.');
  const feedback = options.feedback ? (await fs.readFile(options.feedback, 'utf8')) : null;
  if (feedback && feedback.length > 262144) throw new Error('Feedback context exceeds 256 KiB');
  const result = { schemaVersion: 1, kind: 'local-web-flow', createdAt: new Date().toISOString(), flow, flowDigest: digest(flow), revision: revision(repo), feedback };
  await fs.mkdir(options.out, { recursive: false });
  await writeJSON(path.join(options.out, 'record.json'), result);
  console.log(path.resolve(options.out, 'record.json'));
}

async function replay(options) {
  const recordBytes = await fs.readFile(options.record, 'utf8');
  const recording = JSON.parse(recordBytes);
  const flow = validateFlow(recording.flow);
  if (recording.schemaVersion !== 1 || recording.kind !== 'local-web-flow' || digest(flow) !== recording.flowDigest) throw new Error('Invalid or changed flow recording');
  const recordDigest = crypto.createHash('sha256').update(recordBytes).digest('hex');
  const baseline = options.baseline ? await readJSON(options.baseline) : null;
  if (baseline && (baseline.schemaVersion !== 1 || baseline.recordDigest !== recordDigest || baseline.status !== 'failed' || baseline.failureKind !== 'expectation')) throw new Error('Baseline must be an expectation failure from this exact recording');
  const currentRevision = revision(path.resolve(options.repo || '.'));
  const { chromium, expect } = require('@playwright/test');
  const browser = await chromium.launch();
  try {
    await fs.mkdir(options.out, { recursive: false });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
    const diagnostics = [];
    const log = (type, message) => { if (diagnostics.length < 200) diagnostics.push({ type, message: String(message).slice(0, 2000) }); };
    await context.route('**/*', async route => {
      try { localURL(route.request().url()); await route.continue(); }
      catch { log('blocked-request', route.request().url()); await route.abort(); }
    });
    await context.routeWebSocket(/.*/, socket => { log('blocked-websocket', socket.url()); socket.close(); });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    page.on('console', msg => log('console:' + msg.type(), msg.text()));
    page.on('pageerror', error => log('pageerror', error.message));
    page.on('requestfailed', request => log('requestfailed', request.url() + ' ' + request.failure()?.errorText));
    page.on('response', response => { if (response.status() >= 400) log('http', response.status() + ' ' + response.url()); });
    const result = { schemaVersion: 1, recordDigest, flowDigest: recording.flowDigest, recordedRevision: recording.revision, revision: currentRevision, startedAt: new Date().toISOString(), status: 'failed', failureKind: 'execution', diagnostics, baseline: baseline ? { path: path.resolve(options.baseline), sha256: digest(baseline), revision: baseline.revision } : null };
    let stage = 'navigation';
    try {
      await page.goto(flow.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      for (const [index, step] of flow.steps.entries()) {
        stage = 'step ' + (index + 1);
        const target = page.locator(step.selector);
        if (step.action === 'click') await target.click();
        if (step.action === 'fill') await target.fill(step.value);
        if (step.action === 'press') await target.press(step.value);
      }
      stage = 'expectation';
      await expect(page.locator(flow.expected.selector)).toHaveText(flow.expected.text, { timeout: 3000, useInnerText: true });
      result.status = 'passed';
      result.failureKind = null;
    } catch (error) {
      result.failureKind = stage === 'expectation' ? 'expectation' : 'execution';
      result.failure = { stage, message: error.message.slice(0, 6000) };
    }
    result.finalURL = page.url();
    try { await page.screenshot({ path: path.join(options.out, 'page.png') }); result.screenshot = 'page.png'; }
    catch (error) { log('screenshot-failed', error.message); }
    await context.tracing.stop({ path: path.join(options.out, 'trace.zip') });
    result.trace = 'trace.zip';
    result.finishedAt = new Date().toISOString();
    result.comparison = baseline ? (result.status === 'passed' ? 'failure-to-pass' : 'still-failing') : null;
    await writeJSON(path.join(options.out, 'result.json'), result);
    console.log(JSON.stringify({ status: result.status, comparison: result.comparison, result: path.resolve(options.out, 'result.json') }));
    if (result.status === 'failed') process.exitCode = 1;
  } finally { await browser.close(); }
}

async function main(args) {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: orc-bug-replay record --flow flow.json --out NEW_DIR [--repo REPO] [--feedback FILE]\n       orc-bug-replay replay --record record.json --out NEW_DIR [--repo REPO] [--baseline failed/result.json]');
    return;
  }
  const command = args.shift();
  if (!['record', 'replay'].includes(command)) throw new Error('Expected record or replay');
  const options = {};
  const allowed = command === 'record' ? ['flow', 'out', 'repo', 'feedback'] : ['record', 'out', 'repo', 'baseline'];
  while (args.length) {
    const key = args.shift().replace(/^--/, '');
    const value = args.shift();
    if (!allowed.includes(key) || !value || value.startsWith('--') || key in options) throw new Error('Invalid or duplicate option: ' + key);
    options[key] = value;
  }
  if (!options.out || !(command === 'record' ? options.flow : options.record)) throw new Error('Missing required input or --out');
  await (command === 'record' ? record(options) : replay(options));
}
module.exports = { main };
