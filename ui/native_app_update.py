"""Select the promoted Orc app for future launches and replace stale processes.

With --restart, replace every running Orc.app and open the promoted one even
when its binary is unchanged: someone ran the installer by hand and expects
the release they just promoted in front of them.
"""

import hashlib
import os
from pathlib import Path
import pwd
import re
import signal
import subprocess
import sys
import tempfile
import time


LSREGISTER = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/"
              "LaunchServices.framework/Support/lsregister")


def login_runtime():
    try:
        return (Path(pwd.getpwuid(os.getuid()).pw_dir) / ".orc/runtime").resolve()
    except (KeyError, OSError):
        return None


def owns_desktop_session(runtime, environ=os.environ):
    # LaunchServices, CFPreferences and /usr/bin/open act on the login user's
    # desktop session regardless of $HOME, so disposable-home and test-suite
    # installs must never register bundles in them or launch Orc.app.
    if environ.get("ORC_TEST_REAL_HOME"):
        return False
    owner = login_runtime()
    return owner is not None and runtime.resolve() == owner


def owned_roots():
    roots = [Path.home().resolve()]
    try:
        # Per-user Darwin temp directories ($TMPDIR) sit outside $HOME; include
        # them only when owned by this uid so shared /tmp is left alone.
        temp = Path(tempfile.gettempdir()).resolve()
        if temp.stat().st_uid == os.getuid():
            roots.append(temp)
    except OSError:
        pass
    return tuple(roots)


def repair_launch_services(promoted):
    # Retained releases and build caches share com.orc.app. Replacing a running
    # process alone leaves them eligible for the next name or orc:// launch.
    # Also hide the retired companion if an old copy is explicitly reopened.
    subprocess.run(["/usr/bin/defaults", "write", "com.orc.app",
                    "companionWindowHidden", "-bool", "true"], check=True)
    dump = subprocess.check_output([LSREGISTER, "-dump"], text=True)
    stale = set()
    roots = (*owned_roots(), promoted.parents[1])
    for record in re.split(r"(?m)^-{20,}\s*$", dump):
        identifier = re.search(r"(?m)^identifier:\s*(\S+)\s*$", record)
        path = re.search(r"(?m)^path:[ \t]+(.+?)(?: \(0x[0-9a-fA-F]+\))?[ \t]*$", record)
        if not identifier or identifier[1] != "com.orc.app" or not path:
            continue
        bundle = Path(path[1])
        # Touch only this user's registrations for this exact application.
        # Missing paths still need unregistering: deleted worktrees leave them.
        resolved = bundle.resolve()
        if any(resolved.is_relative_to(root) for root in roots) and resolved != promoted:
            stale.add(str(bundle))
    # Bound argv size on machines with years of retained desktop releases.
    paths = sorted(stale)
    for start in range(0, len(paths), 100):
        subprocess.run([LSREGISTER, "-u", *paths[start:start + 100]], check=True)
    subprocess.run([LSREGISTER, "-f", str(promoted)], check=True)


def processes():
    output = subprocess.check_output(
        ["/bin/ps", "-U", str(os.getuid()), "-o", "pid=,comm="], text=True)
    return {int(pid): command for line in output.splitlines()
            for pid, command in [line.strip().split(None, 1)]}


def digest(path):
    return hashlib.sha256(path.read_bytes()).digest()


def reconcile(runtime, restart=False):
    promoted = (runtime / "current/Orc.app/Contents/MacOS/Orc").resolve(strict=True)
    expected = digest(promoted)
    repair_launch_services(promoted.parents[2])
    releases = (runtime / "releases").resolve()
    stopped = {}
    for pid, command in processes().items():
        executable = Path(command)
        try:
            relative = executable.relative_to(releases)
        except ValueError:
            continue
        if (len(relative.parts) != 5
                or relative.parts[1:] != ("Orc.app", "Contents", "MacOS", "Orc")):
            continue
        try:
            if not restart and digest(executable) == expected:
                continue
        except OSError:
            continue
        # Recheck ownership immediately before signalling a captured pid.
        if processes().get(pid) != command:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        stopped[pid] = command

    if not stopped:
        if restart:
            subprocess.run(["/usr/bin/open", str(promoted.parents[2])], check=True)
        return 0
    deadline = time.monotonic() + 10
    while any(processes().get(pid) == command for pid, command in stopped.items()):
        if time.monotonic() >= deadline:
            raise TimeoutError("old Orc.app did not exit")
        time.sleep(0.1)
    # Opening before exit would trigger Orc's single-instance guard and keep
    # the old binary. An automatic install passes -g so a merge never steals
    # focus; a hand-run install brings the fresh app forward.
    background = [] if restart else ["-g"]
    subprocess.run(["/usr/bin/open", *background, str(promoted.parents[2])], check=True)
    return len(stopped)


def main(argv=sys.argv, environ=os.environ, platform=sys.platform):
    if platform != "darwin":
        return 0
    runtime = Path(argv[1])
    if not owns_desktop_session(runtime, environ):
        return 0
    try:
        restart = argv[2:] == ["--restart"]
        count = reconcile(runtime, restart=restart)
        if count:
            print("restarted Orc.app to load the promoted release")
        elif restart:
            print("opened Orc.app on the promoted release")
        return 0
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"Could not update running Orc.app: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
