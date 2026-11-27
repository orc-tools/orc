"""Keep files Orc and the Mac leave in a checkout out of `git status`.

A public install is a clone with no .gitignore (the export leaves it out). Orc
runs Python from that clone, which writes __pycache__ beside the modules, and
Finder drops .DS_Store into any folder it opens. Either one made the clone look
edited, and Orc refuses to update an edited checkout. The checkout's own
.git/info/exclude ignores them without changing any published file.
"""

from pathlib import Path
import subprocess
import sys


PATTERNS = ('__pycache__/', '.DS_Store')


def ignore(repo):
    """Add the missing patterns to repo's info/exclude. Returns the ones added."""
    result = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
                            capture_output=True, text=True, timeout=10)
    if result.returncode or not result.stdout.strip():
        return []
    exclude = Path(result.stdout.strip())
    try:
        text = exclude.read_text()
    except FileNotFoundError:
        text = ''
    present = {line.strip() for line in text.splitlines()}
    missing = [pattern for pattern in PATTERNS if pattern not in present]
    if missing:
        exclude.parent.mkdir(parents=True, exist_ok=True)
        lead = '\n' if text and not text.endswith('\n') else ''
        with exclude.open('a') as handle:
            handle.write(lead + '# Orc: files Python and Finder leave in the checkout\n'
                         + ''.join(pattern + '\n' for pattern in missing))
    return missing


if __name__ == '__main__':
    for path in sys.argv[1:] or ['.']:
        ignore(path)
