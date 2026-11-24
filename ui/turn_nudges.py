"""One-shot turn-exit nudges for headless minimal-shell runs across all harnesses."""

from pathlib import Path
import re

import harness_context
import headless_session
import run_chat
import run_tasks

SHIP_NUDGE_FILE = ".ship-gate-nudged"
QUESTION_NUDGE_FILE = ".question-form-nudged"


def asks_question(text):
    """True when prose outside code blocks and URLs ends a clause with '?'."""
    prose = re.sub(r"```.*?```|`[^`\n]*`|https?://\S+", " ", text or "", flags=re.S)
    return bool(re.search(r"\?(?=[\s\"')*_]|$)", prose))


def last_turn_assistant_text(run_dir, meta):
    """The latest assistant reply in the most recent turn of run_dir, or ''."""
    try:
        items = run_chat.timeline(meta, harness_run_dir=str(run_dir)).get("items") or []
    except Exception:
        return ""
    for item in reversed(items):
        kind = item.get("kind")
        if kind == "assistant":
            text = (item.get("text") or "").strip()
            if text:
                return text
        elif kind == "user":
            break
    return ""


def _minimal_shell_candidate(run_dir, meta):
    if meta.get("route") not in (None, "minimal-shell") or meta.get("outcome"):
        return False
    plan_path = Path(run_dir) / "plan.mdx"
    try:
        return not plan_path.is_file() or plan_path.stat().st_size == 0
    except OSError:
        return True


def evaluate_turn_exit_nudge(run_dir, meta, *, config_dir=None):
    """Return a one-shot follow-up nudge for an idle headless turn, or None."""
    if not isinstance(meta, dict) or not headless_session.is_headless(meta):
        return None
    if meta.get("status") != "running" or not _minimal_shell_candidate(run_dir, meta):
        return None
    turn = headless_session.turn_state(str(run_dir))
    if (not turn or turn.get("state") != "idle"
            or turn.get("outcome") != "completed" or turn.get("interrupted")):
        return None
    run_id = meta.get("runId") or Path(run_dir).name
    cfg = harness_context._config_dir(run_dir=run_dir, config_dir=config_dir)
    try:
        if run_tasks.pending_count(cfg, run_id) > 0:
            return None
    except Exception:
        pass

    # A deliberate stop must not trap the run in an endless nudge loop; touch a
    # one-shot marker per nudge kind so a second stop stays idle.
    root = Path(run_dir)
    if meta.get("lifecycleVersion") == 4 and meta.get("branch") and meta.get("phase") != "ship":
        marker = root / SHIP_NUDGE_FILE
        if marker.exists():
            return None
        try:
            marker.touch()
        except OSError:
            return None
        return (
            f"orc run `{run_id}` stopped with branch `{meta['branch']}` before opening the Ship gate, "
            "so Orc shows no Merge or PR button. Finish `minimal-shell.md` Ship now: write `pr-body.md` "
            f"and run `orc-delivery-authority ship --run-dir {run_dir} --input <authority-json>` "
            "(or for a multi-repo run, publish and validate authority, run `orc-split-children`, and ship "
            "each child). To stop for the user's input instead, set `status=escalated` and ask one question."
        )

    if (not meta.get("branch")
            and meta.get("phase") in ("grilling", "plan", "clarification")
            and (meta.get("lifecycleVersion") == 4 or meta.get("mode") in ("gated", "quick"))):
        marker = root / QUESTION_NUDGE_FILE
        if marker.exists() or not asks_question(last_turn_assistant_text(run_dir, meta)):
            return None
        try:
            marker.touch()
        except OSError:
            return None
        return (
            f"orc run `{run_id}` stopped before Build on a question asked in chat text, which gives "
            "the user no options to pick and leaves the run showing as working. If the user must answer "
            "before Build, open the Clarification form per `grilling-phase.md`: write "
            "`clarification/clarification.mdx` and `clarification-questions.json`, run "
            f"`orc-ui open --gate '{run_id}/clarification/clarification.html' --title \"<title>\"`, "
            "and stop with that link. If this was a read-only question run whose answer is complete, "
            f"publish it with `orc-publish-question --run-dir {run_dir} --title \"<title>\" --answer-file <answer-md>`. "
            "If nothing needs the user's answer, stop again."
        )

    return None
