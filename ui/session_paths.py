"""Path helpers for session state that hooks need without Orc's heavy imports.

Stdlib only: bin/orc-hook-policy runs on every tool call, so importing this
must never pull in the server modules.
"""

import hashlib
from pathlib import Path


def retired_session_path(config_dir, harness, session_id):
    digest = hashlib.sha256(('%s:%s' % (harness, session_id)).encode()).hexdigest()
    return Path(config_dir) / 'retired-sessions' / (digest + '.json')
