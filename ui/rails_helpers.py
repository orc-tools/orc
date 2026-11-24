"""Resolve the enabled application package's Rails provider."""

import json
from pathlib import Path
import re

from app_plugins import Registry, package_file


def configuration():
    providers = Registry().contributions('railsHelpers')
    if not providers:
        return {}
    root, config = providers[0]
    value = json.loads(package_file(root, config).read_text())
    if 'command' in value:
        value['command'] = str(package_file(root, value['command']))
    return value


def command():
    return configuration().get('command')


def repository(url, config=None):
    config = configuration() if config is None else config
    for name, remotes in config.get('remotes', {}).items():
        if any(re.search(r'[:/]' + re.escape(remote) + r'(\.git)?/?$', url)
               for remote in remotes):
            return name
    return None
