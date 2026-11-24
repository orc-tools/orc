"""Prove a just-promoted desktop release serves before the installer keeps it.

install.sh runs this file from the new release twice. Before switching
runtime/current, ``--release`` boots it, so a release that cannot serve
fails the install with nothing changed and the viewer left alone. After
restarting the default viewer onto it, ``--viewer`` checks that viewer; a
failure there rolls back to the release that was current before and
restarts the viewer on it. Automatic updates read the ``ERROR:`` line as
the reason the update failed.

The release starts its own server in an empty home on a spare port, so the
check needs no running viewer and touches none of the user's runs. That
server must answer the page and the APIs every screen loads first, and
still answer a moment later, so a release that crashes on start or soon
after never stays installed. When the installer restarted the default
viewer onto the release, that viewer must answer the same way, except that
its run list may still be loading.

Python 3.9 runs this on a Mac with only Apple's Command Line Tools.
"""

import argparse
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PATHS = ('', 'api/app', 'api/runs', 'api/config')
# The restarted viewer reads every run folder before its first run list, which
# takes a minute on a few thousand runs on a busy Mac. A viewer that answers
# the other paths and is still building the list is up, not broken: rolling
# it back would only cost a second cold start, and the automatic retry would
# repeat both every few minutes. The empty-home boot holds the list to the
# same deadline as the other paths.
VIEWER_LOADING_PATHS = ('api/runs',)
BOOT_SECONDS = 30
SETTLE_SECONDS = 2
REQUEST_SECONDS = 5
LOG_TAIL = 1200


def spare_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def timed_out(error):
    # socket.timeout is TimeoutError from 3.10; on 3.9 it is its own class.
    return isinstance(error, socket.timeout) or isinstance(getattr(error, 'reason', None), socket.timeout)


def unanswered(url, loading=(), request=REQUEST_SECONDS):
    """The first of PATHS that url does not answer with 200, as a reason,
    or '' when it answers them all. A path in loading may also run past
    request seconds, which says the server is up but still working on it."""
    for path in PATHS:
        try:
            with urllib.request.urlopen(url + path, timeout=request) as response:
                response.read()
                code = response.status
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
        except (OSError, ValueError) as error:
            if path in loading and timed_out(error):
                continue
            return '/%s did not answer: %s' % (path, getattr(error, 'reason', error))
        if code != 200:
            return '/%s answered HTTP %d' % (path, code)
    return ''


def serving(url, alive=lambda: True, boot=BOOT_SECONDS, settle=SETTLE_SECONDS, loading=(),
            request=REQUEST_SECONDS):
    """'' once url answers PATHS and still does settle seconds later, else
    the reason it does not. alive says whether the server is still running;
    loading and request are as for unanswered()."""
    deadline = time.monotonic() + boot
    while True:
        if not alive():
            return 'the server exited while starting'
        reason = unanswered(url, loading, request)
        if not reason:
            break
        if time.monotonic() >= deadline:
            return 'no answer within %ds: %s' % (boot, reason)
        time.sleep(0.2)
    time.sleep(settle)
    if not alive():
        return 'the server exited %ds after it started answering' % settle
    reason = unanswered(url, loading, request)
    return reason and 'stopped answering %ds after it started: %s' % (settle, reason)


def stop(process):
    """Stop the server and anything it started."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except OSError:
            return
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            continue


def boot_problem(release, **timing):
    """'' when the release's own server boots and serves in an empty home,
    else why not, with the end of its log."""
    serve = Path(release) / 'ui' / 'serve.py'
    if not serve.is_file():
        return 'the release has no ui/serve.py'
    with tempfile.TemporaryDirectory(prefix='orc-release-health-') as home:
        log_path = Path(home) / 'serve.log'
        port = spare_port()
        env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': home,
               'LANG': os.environ.get('LANG', 'en_US.UTF-8'),
               # The release is immutable and shared; bytecode beside it
               # would change its bytes.
               'PYTHONDONTWRITEBYTECODE': '1',
               # An empty home would otherwise download the radio library.
               'ORC_RADIO_MEDIA_URL': 'http://127.0.0.1:9/media'}
        with log_path.open('wb') as log:
            process = subprocess.Popen([sys.executable, str(serve), str(port)], cwd=home, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
        try:
            reason = serving('http://127.0.0.1:%d/' % port, lambda: process.poll() is None, **timing)
        finally:
            stop(process)
        if not reason:
            return ''
        tail = log_path.read_text(encoding='utf-8', errors='replace').strip()[-LOG_TAIL:]
        return reason + (' — server log: ' + ' | '.join(tail.splitlines()) if tail else '')


def check(release=None, viewer=None, **timing):
    reason = release and boot_problem(release, **timing)
    if reason:
        return 'the new release does not serve: ' + reason
    if viewer:
        reason = serving(viewer, loading=VIEWER_LOADING_PATHS, **timing)
        if reason:
            return 'the restarted viewer at %s does not serve: %s' % (viewer, reason)
    return ''


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--release', help='boot this release folder in an empty home')
    parser.add_argument('--viewer', help='the default viewer URL the installer restarted')
    args = parser.parse_args()
    if not args.release and not args.viewer:
        parser.error('give --release, --viewer or both')
    reason = check(args.release, args.viewer)
    if reason:
        print('ERROR: release health check failed: ' + reason, file=sys.stderr)
        return 1
    print('the restarted viewer answers' if not args.release else
          'the new release serves' + (' and the restarted viewer answers' if args.viewer else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
