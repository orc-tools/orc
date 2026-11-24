"""Codex-owned transcripts and cumulative token usage for API estimates."""

import json
from pathlib import Path

import codex_questions
import run_chat
import run_subagents
import token_usage


TOKEN_FIELDS = token_usage.FIELDS


def transcripts(thread_id):
    if not isinstance(thread_id, str) or not codex_questions.THREAD_ID.fullmatch(thread_id):
        return {}
    main = run_chat.codex_rollout(thread_id)
    if main is None:
        return {}
    root = (codex_questions.home() / "sessions").resolve()
    candidates = {thread_id: main, **dict(run_subagents.codex_children(thread_id))}
    sources = {}
    pending = list(candidates)
    for ident in pending:
        if len(sources) >= 128:
            break
        candidate = candidates[ident] or run_chat.codex_rollout(ident)
        if candidate is None:
            continue
        path = Path(candidate).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            continue
        reader = run_chat.summary_reader("codex", path)
        with reader.lock:
            reader.poll()
            if reader.summary.id != ident:
                continue
            children = list(reader.summary.agents)
        sources[ident] = str(path)
        for child in children:
            if codex_questions.THREAD_ID.fullmatch(child) and child not in candidates:
                candidates[child] = None
                pending.append(child)
    return sources if thread_id in sources else {}


def token_totals(sources):
    models = {}
    seen_paths = set()
    for owner, path in sources.items():
        real = Path(path).resolve()
        if real in seen_paths:
            continue
        seen_paths.add(real)
        try:
            handle = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        owned, model = False, "unknown"
        meter = token_usage.CodexMeter()
        with handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(record, dict) or not isinstance(record.get("payload"), dict):
                    continue
                kind, payload = record.get("type"), record["payload"]
                if kind == "session_meta":
                    owned = payload.get("id") == owner
                if not owned or payload.get("thread_id", owner) != owner:
                    continue
                if kind == "turn_context":
                    model = payload.get("model") or "unknown"
                    continue
                if kind != "event_msg" or payload.get("type") != "token_count":
                    continue
                info = payload.get("info")
                step = meter.step(info.get("total_token_usage") if isinstance(info, dict) else None)
                if step is None:
                    continue
                tokens, reasoning, long_context = step
                if long_context:
                    tokens["longContext"] = dict(tokens)
                bucket = models.setdefault(str(model), dict.fromkeys(TOKEN_FIELDS, 0))
                token_usage.add(bucket, tokens)
                bucket["reasoning"] = bucket.get("reasoning", 0) + reasoning
    return models
