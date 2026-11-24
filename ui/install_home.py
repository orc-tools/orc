"""Managed ~/.orc links created by the macOS installer."""

from __future__ import annotations

import os
from pathlib import Path
import stat


OWNER_FILE = '.orc-install-owner'


def entry_path(home: Path, entry: str) -> Path:
    if entry == '~' or entry.startswith('~/'):
        return home / entry[2:]
    return home / entry


def display_path(home: Path, path: Path) -> str:
    return str(Path('~') / path.relative_to(home)) if path.is_relative_to(home) else str(path)


def owner_text(home: Path) -> str:
    return f'{os.getuid()}\n{home.resolve()}\n'


def user_owned(path: Path) -> bool:
    info = path.stat()
    return stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022


def configured_target(home: Path) -> Path | None:
    link = home / '.orc'
    if not link.is_symlink():
        return None
    try:
        target = link.resolve(strict=True)
        owner = target / OWNER_FILE
        if (not home.resolve().is_relative_to(target) and user_owned(target)
                and not owner.is_symlink() and owner.is_file()
                and owner.stat().st_uid == os.getuid() and owner.read_text() == owner_text(home)):
            return target
    except (OSError, RuntimeError, UnicodeError):
        pass
    raise ValueError('shared Orc home or unavailable installer-managed data folder')


def choose_data_home(home: Path, entry: str) -> None:
    link = home / '.orc'
    configured = configured_target(home)
    target = entry_path(home, entry).resolve()
    if '\n' in str(target) or '\r' in str(target):
        raise ValueError('Orc folder paths cannot contain line breaks.')
    if target == (configured or link.resolve()):
        return
    if configured:
        raise ValueError(f'Orc already uses {display_path(home.resolve(), configured)} for its data.')
    if home.resolve().is_relative_to(target) or target.is_relative_to(link.resolve()):
        raise ValueError('Choose a separate folder for Orc data.')
    if link.exists() and (not link.is_dir() or any(link.iterdir())):
        raise ValueError('Orc already has data in ~/.orc. Keep using that folder.')

    created = False
    owner = target / OWNER_FILE
    owner_created = False
    try:
        if not target.exists():
            if not target.parent.is_dir():
                raise ValueError('Choose an existing parent folder for the new Orc data folder.')
            target.mkdir(mode=0o700)
            created = True
        if not user_owned(target) or any(target.iterdir()):
            raise ValueError('Choose an empty folder that you own, or enter a new folder path.')
        with owner.open('x') as record:
            owner_created = True
            os.fchmod(record.fileno(), 0o600)
            record.write(owner_text(home))
        if link.exists() and not link.is_symlink():
            link.rmdir()
        link.symlink_to(target, target_is_directory=True)
    except Exception:
        if owner_created:
            owner.unlink()
        if created:
            target.rmdir()
        raise
