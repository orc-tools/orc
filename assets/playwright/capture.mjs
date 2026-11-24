import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const REASON_RULES = JSON.parse(
  readFileSync(new URL('./capture-reason-rules.json', import.meta.url), 'utf8'),
);
const CAPTURE_VERSION = 1;
const DEFAULT_PADDING = 24;
const SETTLE_MS = 100;
const MIN_VIEWPORT_TARGET_RATIO = 0.2;
const DEFAULT_MOTION_DURATION_MS = 1000;
const MAX_MOTION_DURATION_MS = 2500;
const DEFAULT_MOTION_FPS = 8;
const MAX_MOTION_FRAMES = 20;
const MAX_GIF_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOOP_DURATION_MS = 6000;
const MAX_LOOP_DURATION_MS = 15000;
const DEFAULT_LOOP_FPS = 12;
const MAX_LOOP_FPS = 25;
const DEFAULT_LOOP_CROSSFADE_MS = 750;
const LOOP_SCALES = [1, 0.75, 0.5];
// Far enough past the start that an app's load timers have all fired once.
const FREEZE_AFTER_MS = 60_000;
const FLUSH_MS = 500;
const SETTLE_ATTEMPTS = 6;
const NETWORK_IDLE_MS = 5000;
// Without these, two screenshots of one frame can disagree by a brightness level
// on rounded corners when the machine is busy, alternating for as long as you retry.
export const REPEATABLE_BROWSER_ARGS = [
  '--disable-partial-raster',
  '--disable-threaded-animation',
  '--run-all-compositor-stages-before-draw',
  '--disable-checker-imaging',
  '--force-color-profile=srgb',
];
// Pinned rather than "now", so dates and "2 hours ago" labels never change between runs.
export const REPEATABLE_TIME = Date.UTC(2026, 0, 15, 10, 0, 0);

export class BestEffortCaptureError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'BestEffortCaptureError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const DEFAULT_RUNTIME = {
  makeTempDir: parent => mkdtemp(join(parent, '.orc-gif-')),
  remove: (target, options) => rm(target, options),
  rename: (from, to) => rename(from, to),
  stat: target => stat(target),
  run: (command, args) => runProcess(command, args),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: timer => clearTimeout(timer),
};

async function findGifEncoder(runtime) {
  const probes = [['ffmpeg', /ffmpeg version/i], ['magick', /ImageMagick/i]];
  for (const [name, signature] of probes) {
    try {
      const version = await runtime.run(name, ['-version']);
      if (version.code === 0 && signature.test(`${version.stdout || ''}\n${version.stderr || ''}`)) return name;
    } catch {
      // Not on PATH: the next encoder may be.
    }
  }
  throw new BestEffortCaptureError(
    'GIF capture skipped: neither ffmpeg nor a compatible ImageMagick `magick` executable is available',
    'ENCODER_UNAVAILABLE',
  );
}

async function runEncoder(encoder, args, runtime) {
  let result;
  try {
    result = await runtime.run(encoder, args);
  } catch (error) {
    throw new BestEffortCaptureError(
      `GIF capture skipped: ${encoder} encoder failed: ${error.message}`,
      'ENCODER_FAILED',
      error,
    );
  }
  if (result.code !== 0) {
    throw new BestEffortCaptureError(
      `GIF capture skipped: ${encoder} encoder failed: ${conciseProcessError(result)}`,
      'ENCODER_FAILED',
    );
  }
}

// One palette for the whole clip and ordered dithering keep still areas from
// shimmering. Dither noise that moves between frames also defeats GIF's frame
// differencing, which is what keeps a mostly still screen small.
function encodeGif(encoder, { framePaths, tempDir, fps, scale, output }, runtime) {
  if (encoder === 'magick') {
    return runEncoder('magick', [
      '-delay', String(Math.max(1, Math.round(100 / fps))), '-loop', '0', ...framePaths,
      ...(scale === 1 ? [] : ['-resize', `${scale * 100}%`]),
      '-layers', 'Optimize', output,
    ], runtime);
  }
  const resize = scale === 1 ? '' : `scale=iw*${scale}:-2:flags=lanczos,`;
  return runEncoder('ffmpeg', [
    '-y', '-nostdin', '-loglevel', 'error',
    '-framerate', String(fps), '-i', join(tempDir, 'frame-%03d.png'),
    '-filter_complex',
    `[0:v]${resize}split[frames][source];[source]palettegen=stats_mode=full[palette];`
      + '[frames][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-frames:v', String(framePaths.length),
    '-loop', '0', '-threads', '1', '-fflags', '+bitexact', output,
  ], runtime);
}

function blendFrames(encoder, { from, to, weight, output }, runtime) {
  if (encoder === 'magick') {
    return runEncoder('magick', [
      from, to, '-define', `compose:args=${Math.round(weight * 100)}`, '-compose', 'blend', '-composite', output,
    ], runtime);
  }
  return runEncoder('ffmpeg', [
    '-y', '-nostdin', '-loglevel', 'error', '-i', from, '-i', to,
    '-filter_complex',
    `[0:v]format=gbrp[from];[1:v]format=gbrp[to];[from][to]blend=all_expr='A*${1 - weight}+B*${weight}',format=rgb24`,
    '-frames:v', '1', '-threads', '1', '-fflags', '+bitexact', output,
  ], runtime);
}

async function removeFrames(tempDir, captureError, runtime) {
  try {
    await runtime.remove(tempDir, { recursive: true, force: true });
  } catch (error) {
    const prior = captureError ? `${captureError.message}; ` : '';
    throw new BestEffortCaptureError(
      `${prior}temporary GIF frame cleanup failed: ${error.message}`,
      'CLEANUP_FAILED',
      { capture: captureError, cleanup: error },
    );
  }
}

function requireDescription(targetDescription) {
  if (typeof targetDescription !== 'string' || !targetDescription.trim()) {
    throw new TypeError('targetDescription must be a non-empty semantic description');
  }
  const value = targetDescription.trim();
  if (/^(?:[#.\[]|\/\/|css=|xpath=)/i.test(value)) {
    throw new TypeError('targetDescription must describe the target semantically, not repeat a selector');
  }
  return value;
}

function requirePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new TypeError('capture path must be a non-empty string');
  }
  return path;
}

// Chromium writes an empty JPEG past 65,500 px on a side and WebKit a
// truncated one past 65,535, and neither reports it.
const JPEG_MAX_SIDE = 65500;

// A .jpg still at quality 80 keeps text crisp at 1.5x scale for half the
// bytes of a 2x PNG.
function stillFormat(path, options) {
  return /\.jpe?g$/i.test(path) ? { type: 'jpeg', quality: options.quality ?? 80 } : {};
}

async function requireJpegFits(page, path, width, height) {
  if (stillFormat(path, {}).type !== 'jpeg') return;
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const side = Math.ceil(Math.max(width, height) * scale);
  if (side > JPEG_MAX_SIDE) {
    throw new TypeError(`still is ${side} px on its longest side, over the ${JPEG_MAX_SIDE} px a JPEG can hold; use a .png path for an image this large`);
  }
}

function requirePadding(padding) {
  if (!Number.isFinite(padding) || padding < 0) {
    throw new TypeError('padding must be a non-negative finite number');
  }
  return padding;
}

function requireMotionOptions(options) {
  const durationMs = options.durationMs ?? DEFAULT_MOTION_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_MOTION_DURATION_MS) {
    throw new RangeError('animation durationMs must be greater than 0 and no more than 2,500ms');
  }
  const fps = options.fps ?? DEFAULT_MOTION_FPS;
  if (!Number.isFinite(fps) || fps <= 0 || fps > DEFAULT_MOTION_FPS) {
    throw new RangeError('animation fps must be greater than 0 and no more than 8fps');
  }
  return { durationMs, fps };
}

function timeout(promise, milliseconds, runtime) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = runtime.setTimer(() => reject(new BestEffortCaptureError(
      `GIF capture skipped: action did not finish within ${milliseconds}ms capture window`,
      'ACTION_TIMEOUT',
    )), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => runtime.clearTimer(timer));
}

function conciseProcessError(result) {
  const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim();
  return detail.slice(0, 300);
}

function requireBounds(bounds, label) {
  const keys = ['x', 'y', 'width', 'height'];
  if (!bounds || keys.some(key => !Number.isFinite(bounds[key])) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`${label} has no usable bounding box`);
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

async function viewportBounds(page) {
  const configured = page.viewportSize?.();
  const viewport = configured || await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const valid = requireBounds({ x: 0, y: 0, ...viewport }, 'viewport');
  return { width: valid.width, height: valid.height };
}

async function prepareTarget(locator) {
  if (!locator || typeof locator.boundingBox !== 'function') {
    throw new TypeError('target must be a Playwright locator');
  }
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const page = locator.page();
  await page.waitForTimeout(SETTLE_MS);
  const bounds = requireBounds(await locator.boundingBox(), 'target');
  return { page, bounds };
}

function paddedClip(bounds, viewport, padding) {
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(viewport.width, bounds.x + bounds.width + padding);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height + padding);
  return requireBounds({ x, y, width: right - x, height: bottom - y }, 'focused capture');
}

function visibleTargetArea(bounds, viewport) {
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(viewport.width, bounds.x + bounds.width);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function requireExceptionReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new TypeError('exception reason must explain why a padded crop cannot show the change');
  }
  const value = reason.trim();
  const normalized = value.toLowerCase().replaceAll('’', "'");
  const includesAny = terms => terms.some(term => normalized.includes(term));
  if (!includesAny(REASON_RULES.framingTerms)
      || !includesAny(REASON_RULES.limitationTerms)
      || !includesAny(REASON_RULES.contextTerms)) {
    throw new Error('exception reason must explain why a padded crop cannot show the change; layout properties such as “element is fixed” are insufficient');
  }
  return value;
}

function framing(method, target, reason, padding, targetBounds, imageBounds, viewport, setup) {
  const result = {
    captureVersion: CAPTURE_VERSION,
    method,
    target,
    reason,
    padding,
    targetBounds,
    imageBounds,
    viewport,
  };
  if (setup !== undefined) result.setup = setup;
  return result;
}

export async function captureFocused(locator, path, options = {}) {
  const target = requireDescription(options.targetDescription);
  const padding = requirePadding(options.padding ?? DEFAULT_PADDING);
  requirePath(path);
  const { page, bounds } = await prepareTarget(locator);
  const viewport = await viewportBounds(page);
  const clip = paddedClip(bounds, viewport, padding);
  await requireJpegFits(page, path, clip.width, clip.height);
  await page.screenshot({ path, clip, ...stillFormat(path, options) });
  return framing(
    'focused', target, 'default focused crop', padding, bounds, clip, viewport, options.setup,
  );
}

export async function captureFocusedAnimation(locator, path, action, options = {}) {
  const target = requireDescription(options.targetDescription);
  const padding = requirePadding(options.padding ?? DEFAULT_PADDING);
  requirePath(path);
  if (typeof action !== 'function') {
    throw new TypeError('animation action must be an explicit async callback');
  }
  const { durationMs, fps } = requireMotionOptions(options);
  const runtime = { ...DEFAULT_RUNTIME, ...options.runtime };

  const encoder = await findGifEncoder(runtime);

  let tempDir;
  let captureError;
  try {
    tempDir = await runtime.makeTempDir(dirname(path));
    const { page, bounds } = await prepareTarget(locator);
    const viewport = await viewportBounds(page);
    const clip = paddedClip(bounds, viewport, padding);
    const frameCount = Math.min(
      MAX_MOTION_FRAMES,
      Math.max(2, Math.ceil((durationMs * fps) / 1000) + 1),
    );
    const intervalMs = durationMs / (frameCount - 1);
    const framePaths = Array.from(
      { length: frameCount },
      (_, index) => join(tempDir, `frame-${String(index).padStart(3, '0')}.png`),
    );
    const captureFrame = framePath => page.screenshot({ path: framePath, clip, scale: 'css' });

    await captureFrame(framePaths[0]);
    const actionResult = timeout(Promise.resolve().then(action), durationMs, runtime);
    const samplingResult = (async () => {
      for (let index = 1; index < framePaths.length - 1; index += 1) {
        await page.waitForTimeout(intervalMs);
        await captureFrame(framePaths[index]);
      }
      const elapsedMs = intervalMs * Math.max(0, framePaths.length - 2);
      await page.waitForTimeout(Math.max(0, durationMs - elapsedMs));
    })();
    const [actionState, samplingState] = await Promise.allSettled([actionResult, samplingResult]);
    if (samplingState.status === 'rejected') {
      throw new BestEffortCaptureError(
        `GIF capture skipped: frame burst failed: ${samplingState.reason?.message || samplingState.reason}`,
        'FRAME_CAPTURE_FAILED',
        samplingState.reason,
      );
    }
    if (actionState.status === 'rejected') {
      if (actionState.reason instanceof BestEffortCaptureError) throw actionState.reason;
      throw new BestEffortCaptureError(
        `GIF capture skipped: animation action failed: ${actionState.reason?.message || actionState.reason}`,
        'ACTION_FAILED',
        actionState.reason,
      );
    }
    await captureFrame(framePaths.at(-1));

    const encodedPath = join(tempDir, 'output.gif');
    await encodeGif(encoder, { framePaths, tempDir, fps, scale: 1, output: encodedPath }, runtime);
    const encodedStat = await runtime.stat(encodedPath);
    if (encodedStat.size >= MAX_GIF_BYTES) {
      throw new BestEffortCaptureError(
        'GIF capture skipped: encoded animation must be smaller than 10MB',
        'SIZE_LIMIT',
      );
    }
    await runtime.rename(encodedPath, path);
    return framing(
      'focused', target, 'default focused crop', padding, bounds, clip, viewport, options.setup,
    );
  } catch (error) {
    captureError = error instanceof BestEffortCaptureError
      ? error
      : new BestEffortCaptureError(
        `GIF capture skipped: focused animation capture failed: ${error.message}`,
        'CAPTURE_FAILED',
        error,
      );
    throw captureError;
  } finally {
    if (tempDir) await removeFrames(tempDir, captureError, runtime);
  }
}

export async function captureViewport(page, path, options = {}) {
  const target = requireDescription(options.targetDescription);
  const reason = requireExceptionReason(options.reason);
  requirePath(path);
  if (!options.target || options.target.page?.() !== page) {
    throw new TypeError('target must be a locator belonging to the captured page');
  }
  const { bounds } = await prepareTarget(options.target);
  const viewport = await viewportBounds(page);
  const ratio = visibleTargetArea(bounds, viewport) / (viewport.width * viewport.height);
  if (ratio < MIN_VIEWPORT_TARGET_RATIO) {
    throw new Error(`viewport capture rejected: target fills ${(ratio * 100).toFixed(1)}% of frame; minimum is 20%`);
  }
  const imageBounds = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  await requireJpegFits(page, path, viewport.width, viewport.height);
  await page.screenshot({ path, ...stillFormat(path, options) });
  return framing('viewport', target, reason, null, bounds, imageBounds, viewport, options.setup);
}

export async function captureFullPage(page, path, options = {}) {
  const target = requireDescription(options.targetDescription);
  const reason = requireExceptionReason(options.reason);
  requirePath(path);
  if (!options.target || options.target.page?.() !== page) {
    throw new TypeError('target must be a locator belonging to the captured page');
  }
  await prepareTarget(options.target);
  const viewport = await viewportBounds(page);

  await page.evaluate(position => window.scrollTo(0, position === 'bottom' ? document.documentElement.scrollHeight : 0), 'bottom');
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(position => window.scrollTo(0, position === 'bottom' ? document.documentElement.scrollHeight : 0), 'top');
  await page.waitForTimeout(SETTLE_MS);
  const size = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  }));
  const bounds = requireBounds(await options.target.boundingBox(), 'target');
  const imageBounds = requireBounds({ x: 0, y: 0, ...size }, 'full page');
  await requireJpegFits(page, path, size.width, size.height);
  await page.screenshot({ path, fullPage: true, ...stillFormat(path, options) });
  return framing('full-page', target, reason, null, bounds, imageBounds, viewport, options.setup);
}

const repeatablePages = new WeakMap();

function seededRandom(seed) {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Call before the first navigation: a clock installed later misses load timers.
export async function prepareRepeatablePage(page, { time = REPEATABLE_TIME, seed = 1 } = {}) {
  await page.clock.install({ time });
  await page.addInitScript(seededRandom, seed);
  repeatablePages.set(page, { time, frozen: false, atMs: 0 });
}

async function seekAnimations(page, atMs) {
  const seek = at => {
    // document.getAnimations() stops at shadow roots, and web components animate inside theirs.
    const scopes = [document];
    for (const scope of scopes) {
      for (const element of scope.querySelectorAll('*')) {
        if (element.shadowRoot) scopes.push(element.shadowRoot);
      }
      for (const animation of scope.getAnimations()) {
        // Scroll-driven timelines take percentages and refuse a time; they don't move here anyway.
        try {
          animation.pause();
          animation.currentTime = at;
        } catch {}
      }
    }
  };
  await Promise.all(page.frames().map(frame => frame.evaluate(seek, atMs).catch(() => {})));
}

// A screenshot straight after a seek can hold a few stale pixels, so a frame
// counts once two in a row agree.
async function settledFrame(page, shot) {
  let previous = null;
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    const digest = createHash('sha256').update(await page.screenshot(shot)).digest('hex');
    if (digest === previous) return digest;
    previous = digest;
  }
  throw new BestEffortCaptureError(
    `GIF capture skipped: a frame kept changing after ${SETTLE_ATTEMPTS} screenshots, so something on this screen is not on the animation timeline`,
    'UNSTABLE_FRAME',
  );
}

async function quietNetwork(page) {
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => {});
}

// Stops timers at a fixed instant and puts every CSS and Web Animation at atMs
// on one shared timeline. Two runs then see the same frame whatever the machine's speed.
export async function freezeMotion(page, { atMs = 0 } = {}) {
  const state = repeatablePages.get(page);
  if (!state) throw new TypeError('call prepareRepeatablePage before navigating the page');
  if (!state.frozen) {
    // A view may have pinned the clock later than this itself, and the clock only goes forward.
    const current = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(Math.max(state.time + FREEZE_AFTER_MS, current + 1));
    await quietNetwork(page);
    await page.clock.runFor(FLUSH_MS);
    await quietNetwork(page);
    await page.evaluate(() => document.fonts?.ready.then(() => undefined));
    state.frozen = true;
  }
  state.atMs = atMs;
  await seekAnimations(page, atMs);
}

function requireLoopOptions(options) {
  const durationMs = options.durationMs ?? DEFAULT_LOOP_DURATION_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_LOOP_DURATION_MS) {
    throw new RangeError('loop durationMs must be greater than 0 and no more than 15,000ms');
  }
  const fps = options.fps ?? DEFAULT_LOOP_FPS;
  if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_LOOP_FPS) {
    throw new RangeError('loop fps must be greater than 0 and no more than 25fps');
  }
  const crossfadeMs = options.crossfadeMs ?? DEFAULT_LOOP_CROSSFADE_MS;
  if (!Number.isFinite(crossfadeMs) || crossfadeMs < 0 || crossfadeMs >= durationMs) {
    throw new RangeError('loop crossfadeMs must be at least 0 and shorter than durationMs');
  }
  return { durationMs, fps, crossfadeMs };
}

async function loopFraming(page, options, target) {
  const { bounds } = await prepareTarget(options.target);
  const viewport = await viewportBounds(page);
  if (options.padding !== undefined) {
    const padding = requirePadding(options.padding);
    const clip = paddedClip(bounds, viewport, padding);
    return { clip, framed: framing('focused', target, 'default focused crop', padding, bounds, clip, viewport, options.setup) };
  }
  const reason = requireExceptionReason(options.reason);
  const ratio = visibleTargetArea(bounds, viewport) / (viewport.width * viewport.height);
  if (ratio < MIN_VIEWPORT_TARGET_RATIO) {
    throw new Error(`viewport capture rejected: target fills ${(ratio * 100).toFixed(1)}% of frame; minimum is 20%`);
  }
  const imageBounds = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  return { clip: undefined, framed: framing('viewport', target, reason, null, bounds, imageBounds, viewport, options.setup) };
}

// A repeatable looping GIF of ambient motion. Unlike captureFocusedAnimation,
// which samples a triggered change in real time, this seeks each frame, so a
// slow machine gets the same picture and only takes longer.
export async function captureLoopGif(page, path, options = {}) {
  const target = requireDescription(options.targetDescription);
  requirePath(path);
  const { durationMs, fps, crossfadeMs } = requireLoopOptions(options);
  const state = repeatablePages.get(page);
  if (!state) throw new TypeError('call prepareRepeatablePage before navigating the page');
  const runtime = { ...DEFAULT_RUNTIME, ...options.runtime };
  const encoder = await findGifEncoder(runtime);
  const atMs = options.atMs ?? state.atMs;

  if (!options.target || options.target.page?.() !== page) {
    throw new TypeError('target must be a locator belonging to the captured page');
  }
  await freezeMotion(page, { atMs });
  const { clip, framed } = await loopFraming(page, options, target);

  const frameMs = 1000 / fps;
  const frameCount = Math.max(2, Math.round(durationMs / frameMs));
  const fadeCount = Math.min(frameCount - 1, Math.round(crossfadeMs / frameMs));
  let tempDir;
  let captureError;
  try {
    tempDir = await runtime.makeTempDir(dirname(path));
    const framePath = index => join(tempDir, `frame-${String(index).padStart(3, '0')}.png`);
    const digests = new Set();
    for (let index = 0; index < frameCount + fadeCount; index += 1) {
      if (options.advanceClock) await page.clock.runFor(frameMs);
      await seekAnimations(page, atMs + index * frameMs);
      digests.add(await settledFrame(page, { path: framePath(index), clip, scale: 'css' }));
    }
    if (digests.size < 2) {
      throw new BestEffortCaptureError('GIF capture skipped: nothing moves on this screen', 'NO_MOTION');
    }

    // Fade the frames just past the loop's end over its start, so it has no visible jump.
    for (let index = 0; index < fadeCount; index += 1) {
      await blendFrames(encoder, {
        from: framePath(frameCount + index),
        to: framePath(index),
        weight: (index + 1) / (fadeCount + 1),
        output: join(tempDir, `blend-${index}.png`),
      }, runtime);
      await runtime.rename(join(tempDir, `blend-${index}.png`), framePath(index));
    }

    const framePaths = Array.from({ length: frameCount }, (_, index) => framePath(index));
    const encodedPath = join(tempDir, 'output.gif');
    let chosenScale = null;
    for (const scale of LOOP_SCALES) {
      await encodeGif(encoder, { framePaths, tempDir, fps, scale, output: encodedPath }, runtime);
      if ((await runtime.stat(encodedPath)).size < MAX_GIF_BYTES) {
        chosenScale = scale;
        break;
      }
    }
    if (chosenScale === null) {
      throw new BestEffortCaptureError(
        `GIF capture skipped: encoded loop stayed over 10MB at ${LOOP_SCALES.at(-1) * 100}% size; shorten it or lower fps`,
        'SIZE_LIMIT',
      );
    }
    await runtime.rename(encodedPath, path);
    return {
      ...framed,
      motion: { atMs, durationMs, fps, frames: frameCount, crossfadeMs, scale: chosenScale, encoder },
    };
  } catch (error) {
    captureError = error instanceof BestEffortCaptureError
      ? error
      : new BestEffortCaptureError(`GIF capture skipped: loop capture failed: ${error.message}`, 'CAPTURE_FAILED', error);
    throw captureError;
  } finally {
    if (tempDir) await removeFrames(tempDir, captureError, runtime);
  }
}
