"""orc-ui: builds the publisher's Mac installer from Orc's source checkout and
opens it, for real or as a preview that changes nothing on the Mac, or exports
one that starts on a chosen theme or carries optional local packages and shows
its zip in Finder. It also zips one of those optional packages on its own into a
folder such as Downloads.

The installer is a publisher tool that never enters the public export, so a
public install has no installer/build.sh and the command stays hidden."""

import importlib.util
import os
import re
import subprocess
import threading

import app_plugins

BUILD_TIMEOUT = 900
ZIP_TIMEOUT = 120
_BUILDING = threading.Lock()


class InstallerError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def build_script(repo):
    return os.path.join(repo, "installer", "build.sh")


def available(repo):
    return os.path.isfile(build_script(repo))


def private_plugins(repo):
    """The checkout's optional packages an installer can carry, if a local
    catalog policy supplies them."""
    policy = app_plugins.catalog_policy(repo)
    if policy is not None and hasattr(policy, "extra_packages"):
        return policy.extra_packages(repo)
    return []


def themes(repo):
    """The public themes an installer built from the checkout can start on,
    [{id, name}] with Swamp first, as installer/stage.py lists them."""
    script = os.path.join(repo, "installer", "stage.py")
    if not os.path.isfile(script):
        return []
    try:
        spec = importlib.util.spec_from_file_location("orc_installer_stage", script)
        stage = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(stage)
        return stage.public_themes(repo)
    except Exception:  # A checkout mid-edit lists no themes rather than failing the palette.
        return []


def open_installer(repo, preview, environ=None, private=(), theme=None, export=None):
    """Runs build.sh and returns once it finishes. A preview, or a plain
    build, opens the app. An export (a real build that starts on a theme or
    carries private plugins, unless export says otherwise) shows its zip in
    Finder instead. Swamp is the theme every installer starts on already."""
    environ = dict(os.environ if environ is None else environ)
    if not available(repo):
        raise InstallerError(404, "The installer is only in Orc's source checkout.")
    private = list(dict.fromkeys(private))
    offered = {item["id"] for item in private_plugins(repo)}
    unknown = [identifier for identifier in private if identifier not in offered]
    if unknown:
        raise InstallerError(400, "No private plugin " + ", ".join(unknown) + " in Orc's source checkout.")
    if theme == "swamp":
        theme = None
    if theme is not None and theme not in {item["id"] for item in themes(repo)}:
        raise InstallerError(400, "No public theme " + str(theme) + " in Orc's source checkout.")
    if export is None:
        export = bool(private or theme)
    export = bool(export) and not preview
    if not _BUILDING.acquire(blocking=False):
        raise InstallerError(409, "The installer is already building.")
    command = ["bash", build_script(repo)] + ([] if export else ["--open"])
    if theme:
        command += ["--theme", theme]
    for identifier in private:
        command += ["--private", identifier]
    if preview:
        command += ["--demo", "--out", os.path.join(repo, "installer", "build", "preview")]
    environ["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        done = subprocess.run(command, cwd=repo, capture_output=True, text=True,
                              timeout=BUILD_TIMEOUT, env=environ)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InstallerError(500, "The installer did not build: " + str(error)) from error
    finally:
        _BUILDING.release()
    if done.returncode:
        lines = [line for line in (done.stderr or "").splitlines() if line.strip()]
        raise InstallerError(500, lines[-1] if lines else f"installer/build.sh exited {done.returncode}.")
    result = {"ok": True, "preview": bool(preview)}
    if export:
        found = re.search(r"^zip:\s+(.+)$", done.stdout or "", re.MULTILINE)
        if not found:
            raise InstallerError(500, "The installer built, but build.sh did not say where its zip is.")
        result["zip"] = found.group(1).strip()
        subprocess.run(["open", "-R", result["zip"]], capture_output=True, timeout=30, env=environ)
    return result


def zip_private_plugin(repo, identifier, destination, environ=None):
    """Zips one optional checkout package as HEAD commits it to destination."""
    policy = app_plugins.catalog_policy(repo)
    if policy is not None and hasattr(policy, "zip_extra_package"):
        return policy.zip_extra_package(repo, identifier, destination, InstallerError,
                                        environ=environ, run=subprocess.run)
    raise InstallerError(404, "Orc's source checkout has no optional package called that.")
