"""Validate optional answer views with the same catalog used by the browser."""
import hashlib
import json
import subprocess
from pathlib import Path

MAX_BYTES = 262144
VALIDATOR = """
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const { validateAnswerSpec } = await import(pathToFileURL(process.argv[1]).href);
try {
  const spec = validateAnswerSpec(JSON.parse(readFileSync(0, 'utf8')));
  process.stdout.write(JSON.stringify(spec));
} catch (error) {
  process.stderr.write('Invalid answer view: ' + error.message);
  process.exitCode = 1;
}
"""


def prepare_view(raw, answer):
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError('answer view must be UTF-8 JSON at most 256 KiB')
    bundle = Path(__file__).parent / 'vendor' / 'orc-answer.mjs'
    try:
        result = subprocess.run(
            ['node', '--input-type=module', '-e', VALIDATOR, str(bundle)],
            input=raw, capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('answer view validation requires Node.js and the built answer bundle') from exc
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', errors='replace')[:1000])
    encoded = (json.dumps({'schemaVersion': 1,
                        'answerSha256': hashlib.sha256(answer).hexdigest(),
                        'spec': json.loads(result.stdout)}, ensure_ascii=False) + '\n').encode('utf-8')
    if len(encoded) > MAX_BYTES:
        raise ValueError('published answer view exceeds 256 KiB')
    return encoded
