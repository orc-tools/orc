import copy
import os
import re
import shlex

import windows_host

PRESETS = [
    {'type': 'neovim', 'name': 'Neovim'},
    {'type': 'cursor', 'name': 'Cursor'},
    {'type': 'vscode', 'name': 'VS Code'},
    {'type': 'textedit', 'name': 'Notepad' if windows_host.WSL else 'TextEdit'},
]
DEFAULT = {'actions': [{'id': 'neovim', **PRESETS[0]}], 'defaultAction': 'neovim'}
APPS = {'cursor': 'Cursor', 'vscode': 'Visual Studio Code', 'textedit': 'TextEdit'}
PLACEHOLDERS = {'<filepath>': 'ORC_FILEPATH', '<filename>': 'ORC_FILENAME', '<fileext>': 'ORC_FILEEXT'}


def validate(value):
    if not isinstance(value, dict) or set(value) != {'actions', 'defaultAction'}:
        raise ValueError('Expected actions and defaultAction.')
    actions = value['actions']
    if not isinstance(actions, list) or len(actions) > 24:
        raise ValueError('Use up to 24 file actions.')
    seen = set()
    cleaned = []
    for action in actions:
        if not isinstance(action, dict) or set(action) - {'id', 'name', 'type', 'command'}:
            raise ValueError('Invalid file action.')
        identifier, name, kind = (action.get(key) for key in ('id', 'name', 'type'))
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', identifier) or identifier in seen:
            raise ValueError('Each action needs a unique id.')
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or '\0' in name:
            raise ValueError('Name each action using 1–80 characters.')
        if not isinstance(kind, str) or kind not in {'neovim', *APPS, 'custom'}:
            raise ValueError('Choose a preset or custom script.')
        item = {'id': identifier, 'name': name.strip(), 'type': kind}
        if kind == 'custom':
            command = action.get('command')
            if not isinstance(command, str) or not command.strip() or len(command) > 16384 or '\0' in command:
                raise ValueError('Enter a script using 1–16384 characters.')
            item['command'] = command
        elif action.get('command'):
            raise ValueError('Only custom actions accept scripts.')
        cleaned.append(item)
        seen.add(identifier)
    default = value['defaultAction']
    if not isinstance(default, str) or (default not in seen if actions else default != ''):
        raise ValueError('Choose a default from your file actions.')
    return {'actions': cleaned, 'defaultAction': default}


def read(config):
    ui = config.get('ui') if isinstance(config.get('ui'), dict) else {}
    return validate(ui['filesBrowser']) if 'filesBrowser' in ui else copy.deepcopy(DEFAULT)


def script_with_variables(script):
    output, quote, index = [], '', 0
    while index < len(script):
        char = script[index]
        if char == '#' and not quote and (index == 0 or script[index - 1].isspace() or script[index - 1] in ';|&()'):
            end = script.find('\n', index)
            if end == -1:
                output.append(script[index:])
                break
            output.append(script[index:end + 1])
            index = end + 1
            continue
        token = next((token for token in PLACEHOLDERS if script.startswith(token, index)), None)
        if token:
            variable = '${' + PLACEHOLDERS[token] + '}'
            output.append(variable if quote == '"' else ('\'"' + variable + '"\'' if quote == "'" else '"' + variable + '"'))
            index += len(token)
            continue
        if char == '\\' and quote != "'" and index + 1 < len(script):
            output.append(script[index:index + 2])
            index += 2
            continue
        if char in ('"', "'"):
            if not quote:
                quote = char
            elif quote == char:
                quote = ''
        output.append(char)
        index += 1
    return ''.join(output)


def command(action, target):
    kind = action['type']
    if kind == 'neovim':
        return 'nvim -- ' + shlex.quote(target)
    if windows_host.WSL and kind in APPS:
        if kind == 'textedit':
            return shlex.join(['notepad.exe', windows_host.windows_path(target)])
        return shlex.join(['code' if kind == 'vscode' else 'cursor', '--', target])
    if kind in APPS:
        return shlex.join(['open', '-a', APPS[kind], '--', target])
    script = script_with_variables(action['command'])
    name = os.path.basename(target)
    values = {'ORC_FILEPATH': target, 'ORC_FILENAME': name,
              'ORC_FILEEXT': '' if os.path.isdir(target) else os.path.splitext(name)[1][1:]}
    return (' '.join(key + '=' + shlex.quote(value) for key, value in values.items())
            + ' /bin/sh -c ' + shlex.quote(script))
