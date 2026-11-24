"""Token counts as the agents' transcripts record them, in the five fields a
cost estimate prices."""

FIELDS = ("input", "output", "cacheRead", "cache5m", "cache1h")
CODEX_USAGE_FIELDS = ("input_tokens", "output_tokens", "cached_input_tokens",
                      "cache_write_input_tokens", "reasoning_output_tokens")
# GPT-6 and GPT-5.6 bill a request above this many input tokens at a premium.
CODEX_LONG_CONTEXT = 272_000


def blank():
    return dict.fromkeys(FIELDS, 0)


def add(total, tokens):
    """Add ``tokens`` into ``total``, including the share of them a request
    past its model's long-context threshold billed (``longContext``)."""
    for field in FIELDS:
        total[field] += tokens.get(field, 0)
    if isinstance(tokens.get("longContext"), dict):
        add(total.setdefault("longContext", blank()), tokens["longContext"])
    return total


def claude(usage):
    """The priced fields of one Claude assistant message's ``usage``."""
    tokens = blank()
    tokens["input"] = int(usage.get("input_tokens") or 0)
    tokens["output"] = int(usage.get("output_tokens") or 0)
    tokens["cacheRead"] = int(usage.get("cache_read_input_tokens") or usage.get("cache_read_tokens") or 0)
    created = usage.get("cache_creation")
    if isinstance(created, dict):
        tokens["cache5m"] = int(created.get("ephemeral_5m_input_tokens") or 0)
        tokens["cache1h"] = int(created.get("ephemeral_1h_input_tokens") or 0)
    else:
        # Older transcripts report only the flat creation count, billed at
        # the 5-minute rate the API charges by default.
        tokens["cache5m"] = int(usage.get("cache_creation_input_tokens") or 0)
    return tokens


class CodexMeter:
    """Codex reports a thread's running total after every model call, so one
    call's tokens are the growth since the last report."""

    def __init__(self):
        self.previous = dict.fromkeys(CODEX_USAGE_FIELDS, 0)

    def step(self, usage):
        """(tokens, reasoning tokens, whether the call ran long) for the next
        ``total_token_usage``, or None when it adds nothing."""
        if not isinstance(usage, dict) or not all(key in usage for key in CODEX_USAGE_FIELDS[:2]):
            return None
        current = {key: usage.get(key, 0) for key in CODEX_USAGE_FIELDS}
        if any(type(value) is not int or value < 0 for value in current.values()):
            return None
        delta = {key: max(current[key] - self.previous[key], 0) for key in CODEX_USAGE_FIELDS}
        self.previous = {key: max(current[key], self.previous[key]) for key in CODEX_USAGE_FIELDS}
        cached = min(delta["cached_input_tokens"], delta["input_tokens"])
        written = min(delta["cache_write_input_tokens"], delta["input_tokens"] - cached)
        tokens = {"input": delta["input_tokens"] - cached - written, "output": delta["output_tokens"],
                  "cacheRead": cached, "cache5m": written, "cache1h": 0}
        if not any(tokens.values()):
            return None
        return tokens, delta["reasoning_output_tokens"], delta["input_tokens"] > CODEX_LONG_CONTEXT
