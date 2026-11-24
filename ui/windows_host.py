#!/usr/bin/env python3
"""Windows desktop services for Orc running inside WSL."""
import base64
import hashlib
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile

WSL = platform.system() == "Linux" and "microsoft" in platform.release().lower()
POWERSHELL = ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command"]


def project_path(value):
    if not WSL:
        return value
    if re.match(r"^[A-Za-z]:[\\/]", value):
        try:
            return subprocess.check_output(["wslpath", "-au", value], text=True, timeout=5).strip()
        except (OSError, subprocess.SubprocessError):
            return value
    unc = re.match(r"^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$", value, re.I)
    if unc and unc[1].casefold() == os.environ.get("WSL_DISTRO_NAME", "").casefold():
        return (unc[2] or "/").replace("\\", "/")
    return value


def windows_path(path):
    return subprocess.check_output(["wslpath", "-aw", os.fspath(path)], text=True, timeout=10).rstrip("\r\n")


def powershell(script, value, *, run=subprocess.run):
    # A path or secret can contain PowerShell syntax. Only data crosses stdin.
    return run([*POWERSHELL, "$ErrorActionPreference='Stop';"
                "$data=[Convert]::FromBase64String([Console]::In.ReadToEnd());" + script],
               input=base64.b64encode(value), capture_output=True, timeout=30)


def desktop_open(target, *, select=False):
    if not WSL:
        return subprocess.run(["open", *(["-R"] if select else []), target],
                              capture_output=True, text=True, timeout=10)
    path = windows_path(target)
    if select:
        script = "Start-Process explorer.exe -ArgumentList ('/select,\"' + $p + '\"')"
    else:
        script = "Start-Process -FilePath $p"
    result = powershell("$p=[Text.Encoding]::UTF8.GetString($data);" + script, path.encode())
    return subprocess.CompletedProcess(result.args, result.returncode, "", result.stderr.decode(errors="replace"))


def open_link(link):
    if not WSL:
        return subprocess.run(["open", link], capture_output=True, text=True, timeout=10)
    return powershell("Start-Process -FilePath ([Text.Encoding]::UTF8.GetString($data))", link.encode())


def copy_file(path):
    return powershell("Add-Type -AssemblyName System.Windows.Forms;"
                      "$files=New-Object Collections.Specialized.StringCollection;"
                      "[void]$files.Add([Text.Encoding]::UTF8.GetString($data));"
                      "[Windows.Forms.Clipboard]::SetFileDropList($files);[Console]::Write('true')",
                      windows_path(path).encode())


def credential_file(name, account):
    key = hashlib.sha256((account + "\0" + name).encode()).hexdigest()
    return Path.home() / ".orc" / "credentials" / key


def protect(value, *, decrypt=False, run=subprocess.run):
    operation = "Unprotect" if decrypt else "Protect"
    result = powershell("Add-Type -AssemblyName System.Security;"
                        "$bytes=[Security.Cryptography.ProtectedData]::" + operation +
                        "($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);"
                        "[Console]::Write([Convert]::ToBase64String($bytes))", value, run=run)
    if result.returncode:
        raise OSError("Windows could not unlock the credential store for this user.")
    return base64.b64decode(result.stdout.strip(), validate=True)


def save_credential(path, value, *, run):
    encrypted = protect(value.encode(), run=run)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        try:
            temp.write(encrypted)
            temp.close()
            os.replace(temp.name, path)
        finally:
            Path(temp.name).unlink(missing_ok=True)


if __name__ == "__main__":
    import sys
    from urllib.parse import urlsplit

    if len(sys.argv) != 2 or urlsplit(sys.argv[1]).scheme not in ("http", "https"):
        sys.exit("Expected an HTTP or HTTPS URL.")
    sys.exit(open_link(sys.argv[1]).returncode)
