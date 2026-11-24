"""Sign and verify public Orc release commits with pinned SSH keys.

Public releases are signed locally by the publisher's SSH key (kept off GitHub),
and every public install verifies incoming commits against the public key(s)
pinned in its currently installed release's ``distribution.json`` before
fast-forwarding or running the installer.

Python 3.9 runs this on a Mac with only Apple's Command Line Tools.
"""

import base64
import binascii
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

SIGNER_PRINCIPAL = 'noreply@orc.invalid'
DEFAULT_SIGNERS_FILE = 'distribution/release-signers.pub'
ALLOWED_KEY_TYPES = frozenset({
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
    'sk-ecdsa-sha2-nistp256@openssh.com',
    'rsa-sha2-256',
    'rsa-sha2-512',
    'ssh-rsa',
})
SIGNATURE_HEADERS = re.compile(rb'^gpgsig(?:-sha256)?(?= |$)[^\n]*(?:\n [^\n]*)*', re.MULTILINE)
SSH_SIGNATURE = re.compile(
    rb'gpgsig(?:-sha256)? -----BEGIN SSH SIGNATURE-----\n'
    rb'(?: [A-Za-z0-9+/=]+\n)+ -----END SSH SIGNATURE-----'
)


def _clean_git_env():
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env['GIT_TERMINAL_PROMPT'] = '0'
    env['GIT_CONFIG_GLOBAL'] = '/dev/null'
    env['GIT_CONFIG_SYSTEM'] = '/dev/null'
    env['GIT_CONFIG_NOSYSTEM'] = '1'
    return env


def normalize_public_key(line):
    """Validate and normalize one OpenSSH public key line to ``<type> <base64>``."""
    if not isinstance(line, str):
        raise ValueError('signing key must be a string')
    if '\n' in line or '\r' in line or '\0' in line:
        raise ValueError('signing key must be a single line')
    parts = line.strip().split()
    if len(parts) < 2:
        raise ValueError('signing key must contain key type and base64 key data')
    key_type, blob = parts[0], parts[1]
    if key_type not in ALLOWED_KEY_TYPES:
        raise ValueError('unsupported SSH signing key type: %s' % key_type)
    try:
        decoded = base64.b64decode(blob.encode('ascii'), validate=True)
    except (UnicodeEncodeError, binascii.Error, ValueError):
        raise ValueError('invalid base64 data in SSH signing key') from None
    if len(decoded) < 16:
        raise ValueError('SSH signing key data is too short')
    return '%s %s' % (key_type, blob)


def parse_signers_text(text):
    """Parse pinned SSH public keys from text (ignoring blank lines and # comments)."""
    keys = []
    seen = set()
    for lineno, raw in enumerate((text or '').splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith('#'):
            continue
        try:
            key = normalize_public_key(stripped)
        except ValueError as error:
            raise ValueError('line %d: %s' % (lineno, error)) from None
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def normalize_signing_keys(keys):
    """Validate a non-empty list of SSH public keys from distribution.json."""
    if not isinstance(keys, list) or not keys:
        raise ValueError('signingKeys must be a non-empty list of SSH public keys')
    normalized = []
    seen = set()
    for item in keys:
        key = normalize_public_key(item)
        if key not in seen:
            seen.add(key)
            normalized.append(key)
    return normalized


def manifest_signing_keys(manifest, required=True):
    """Return normalized signingKeys from a parsed distribution.json object."""
    if not isinstance(manifest, dict):
        raise ValueError('distribution.json must be an object')
    if 'signingKeys' not in manifest:
        if required:
            raise ValueError('distribution.json is missing pinned signingKeys')
        return None
    return normalize_signing_keys(manifest['signingKeys'])


def public_key_for_signing_key(key_path):
    """Return the normalized SSH public key corresponding to ``key_path``."""
    path = Path(key_path).expanduser()
    if not path.is_file():
        raise ValueError('signing key not found: %s' % path)
    ssh_keygen = shutil.which('ssh-keygen')
    if ssh_keygen:
        result = subprocess.run(
            [ssh_keygen, '-y', '-f', str(path)],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0 and result.stdout.strip():
            return normalize_public_key(result.stdout.strip().splitlines()[0])
    pub = Path(str(path) + '.pub')
    if pub.is_file():
        keys = parse_signers_text(pub.read_text())
        if len(keys) == 1:
            return keys[0]
    raise ValueError('could not read public key for signing key %s' % path)


def allowed_signers_content(keys):
    """Render an OpenSSH allowed_signers file restricted to the git namespace."""
    normalized = normalize_signing_keys(keys)
    return ''.join('%s namespaces="git" %s\n' % (SIGNER_PRINCIPAL, key) for key in normalized)


def verify_commit(repo, commit, keys):
    """Verify ``commit`` in ``repo`` is signed by one of the pinned SSH ``keys``.

    Returns '' when the signature is valid, or a plain-language reason why the
    commit was refused.
    """
    short = str(commit or '')[:12] or 'unknown'
    try:
        signers_text = allowed_signers_content(keys)
    except ValueError as error:
        return 'pinned release signing keys are invalid: %s' % error
    ssh_keygen = shutil.which('ssh-keygen')
    if not ssh_keygen:
        return 'ssh-keygen is required to verify signed Orc releases'
    env = _clean_git_env()
    resolved = subprocess.run(
        ['git', '--no-replace-objects', '-C', str(repo), 'rev-parse', '--verify', str(commit) + '^{commit}'],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
    )
    if resolved.returncode != 0 or not resolved.stdout.strip():
        return 'commit %s could not be read for signature verification' % short
    sha = resolved.stdout.strip()
    short = sha[:12]
    raw_commit = subprocess.run(
        ['git', '--no-replace-objects', '-C', str(repo), 'cat-file', 'commit', sha],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=15,
    )
    if raw_commit.returncode != 0:
        return 'commit %s could not be inspected for signature verification' % short
    header, separator, _body = raw_commit.stdout.partition(b'\n\n')
    signatures = SIGNATURE_HEADERS.findall(header)
    if len(signatures) > 1:
        return 'commit %s has multiple release signature headers' % short
    if not separator or not signatures or not SSH_SIGNATURE.fullmatch(signatures[0]):
        return 'commit %s is not signed with a release SSH signature' % short
    with tempfile.TemporaryDirectory(prefix='orc-signers-') as scratch:
        signers_path = Path(scratch) / 'allowed_signers'
        fd = os.open(signers_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(signers_text)
        verify = subprocess.run(
            [
                'git', '--no-replace-objects', '-C', str(repo),
                '-c', 'gpg.format=ssh',
                '-c', 'gpg.ssh.allowedSignersFile=' + str(signers_path),
                '-c', 'gpg.ssh.program=' + ssh_keygen,
                '-c', 'gpg.ssh.revocationFile=',
                'verify-commit', sha,
            ],
            env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )
    if verify.returncode != 0:
        detail = (verify.stderr or verify.stdout or '').strip()
        if 'No principal matched' in detail:
            return 'commit %s is signed by an untrusted key' % short
        return 'commit %s failed release signature verification' % short
    return ''


def read_committed_manifest(repo, commit):
    """Read ``distribution.json`` from ``commit`` in ``repo``."""
    result = subprocess.run(
        ['git', '--no-replace-objects', '-C', str(repo), 'show', '%s:distribution.json' % commit],
        env=_clean_git_env(), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
    )
    if result.returncode != 0:
        raise ValueError('candidate commit %s has no distribution.json' % str(commit)[:12])
    return json.loads(result.stdout)


def trusted_keys_for_public_repo(repo, installed_manifest_path=None, candidate_commit=None):
    """Pinned keys used to verify a public release commit.

    When an installed release carries ``signingKeys``, those pinned keys are
    the sole trust anchor so an attacker cannot substitute their own key in an
    unverified upstream commit. Legacy pre-signing installs (no ``signingKeys``
    in the installed manifest) and fresh installs verify against the candidate's
    pinned keys and begin enforcing pinned keys from that release onward.
    """
    if installed_manifest_path is not None and Path(installed_manifest_path).exists():
        installed = json.loads(Path(installed_manifest_path).read_text())
        pinned = manifest_signing_keys(installed, required=False)
        if pinned is not None:
            return pinned
    if candidate_commit:
        candidate = read_committed_manifest(repo, candidate_commit)
    else:
        candidate = json.loads((Path(repo) / 'distribution.json').read_text())
    return manifest_signing_keys(candidate, required=True)
