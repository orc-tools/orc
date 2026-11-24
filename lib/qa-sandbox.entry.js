import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

let child = null;
let signalReceived = null;

function installSignalHandlers() {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      signalReceived = sig;
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(sig);
        } catch {
          // Child already gone.
        }
      }
    });
  }
}

function exitWithSignal(sig) {
  process.removeAllListeners(sig);
  process.kill(process.pid, sig);
}

function parseArgs(argv) {
  const out = { check: false, shell: false, config: null, command: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      out.check = true;
    } else if (arg === '--shell') {
      out.shell = true;
    } else if (arg === '--config') {
      out.config = argv[++i] ?? null;
    } else if (arg === '--command') {
      out.command = argv[++i] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

async function runCheck() {
  if (!SandboxManager.isSupportedPlatform()) {
    console.log(JSON.stringify({
      ok: false,
      errors: [`Unsupported platform: ${process.platform}`],
      warnings: [],
    }));
    process.exit(1);
  }
  const result = await SandboxManager.checkDependencies();
  const ok = result.errors.length === 0;
  console.log(JSON.stringify({ ok, errors: result.errors, warnings: result.warnings }));
  process.exit(ok ? 0 : 1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.check) {
    await runCheck();
    return;
  }
  if (!opts.config) {
    throw new Error('--config <path> is required');
  }
  if (!opts.shell && opts.command === null) {
    throw new Error('Either --command <cmd> or --shell is required');
  }

  installSignalHandlers();
  const config = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  if (process.env.TMPDIR && !process.env.CLAUDE_CODE_TMPDIR) {
    process.env.CLAUDE_CODE_TMPDIR = process.env.TMPDIR;
  }

  await SandboxManager.initialize(config);
  if (signalReceived) {
    await SandboxManager.reset().catch(() => {});
    exitWithSignal(signalReceived);
    return;
  }

  const targetCommand = opts.shell
    ? 'exec /bin/bash --noprofile --norc -i'
    : opts.command;
  const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
    targetCommand,
    '/bin/bash',
  );
  if (signalReceived) {
    await SandboxManager.reset().catch(() => {});
    exitWithSignal(signalReceived);
    return;
  }

  child = spawn(argv[0], argv.slice(1), {
    shell: false,
    stdio: 'inherit',
    env,
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = async (code, childSignal) => {
      if (settled) return;
      settled = true;
      await SandboxManager.reset().catch(() => {});
      const sig = signalReceived || childSignal;
      if (sig) {
        exitWithSignal(sig);
        resolve();
        return;
      }
      process.exit(code ?? 1);
    };
    child.on('exit', (code, sig) => { void finish(code, sig); });
    child.on('error', (err) => {
      console.error(`qa-sandbox: failed to start: ${err.message}`);
      void finish(1, null);
    });
  });
}

main().catch(async (err) => {
  await SandboxManager.reset().catch(() => {});
  if (signalReceived) {
    exitWithSignal(signalReceived);
    return;
  }
  console.error(`qa-sandbox: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
