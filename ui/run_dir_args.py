"""How a run's helper command finds the run it is for.

A helper takes ``--run-dir`` or ``--run-id``. With neither it uses
``ORC_RUN_ID``, which Orc sets in a headless run's own session, so the agent
can call the helper bare.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def add_arguments(parser):
    parser.add_argument("--run-dir")
    parser.add_argument("--run-id")


def resolve(args, tool):
    """The run's folder and its status. Exits naming `tool` when the run
    cannot be found."""
    if args.run_dir:
        run_dir = Path(args.run_dir).expanduser()
    else:
        run_id = args.run_id or os.environ.get("ORC_RUN_ID")
        if not run_id:
            raise SystemExit("%s: pass --run-dir or --run-id (ORC_RUN_ID is not set)" % tool)
        run_dir = Path(os.environ.get("ORC_RUNS_DIR") or Path.home() / ".orc" / "runs") / run_id
    try:
        status = json.loads((run_dir / "meta.json").read_text()).get("status")
    except (OSError, ValueError, AttributeError):
        raise SystemExit("%s: %s is not a run directory" % (tool, run_dir))
    return run_dir, status
