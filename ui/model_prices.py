"""The one table of API prices Orc's cost estimates use, for Claude and
Codex models alike.

A model is priced only by its exact id. A model missing from the table has
no price, and its cost reads as unknown rather than borrowing a near name's
rate: Opus 4.1 and Opus 5.5 share "opus" but bill three times apart.
``unpriced`` lists the models a catalog offers that the table lacks, which
is what the assistant's daily pricing check asks it to look up.
"""
import re

import token_usage

FIELDS = token_usage.FIELDS
ANTHROPIC_PRICING = "https://platform.claude.com/docs/en/about-claude/pricing"
OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing"


def claude(inp, out, cache_read, long_context=None):
    """USD/MTok for a Claude model. Cache writes are fixed multiples of the
    input rate (5-minute 1.25x, 1-hour 2x); reads vary by model."""
    return {"input": inp, "output": out, "cacheRead": cache_read, "cache5m": inp * 1.25,
            "cache1h": inp * 2, "longContext": long_context, "source": ANTHROPIC_PRICING}


def openai(inp, cached, written, out, long_context=None):
    """USD/MTok for an OpenAI model, which has no 1-hour cache tier. A
    ``written`` of None means the model has no cache-write rate."""
    return {"input": inp, "output": out, "cacheRead": cached, "cache5m": written,
            "cache1h": None, "longContext": long_context, "source": OPENAI_PRICING}


# Above 272K input tokens a GPT-6 or GPT-5.6 request bills input and cache
# at 2x and output at 1.5x: https://developers.openai.com/api/docs/models/gpt-6.2-sol
GPT_LONG = {"above": token_usage.CODEX_LONG_CONTEXT, "input": 2, "cacheRead": 2, "cache5m": 2, "output": 1.5}
# Above 100K prompt tokens Haiku 5.5 bills $0.50 input and $2.50 output. Its
# long-context cache rates are not published, so those tokens price as unknown.
HAIKU_LONG = {"above": 100_000, "input": 5, "output": 5}

# Claude rates verified 2026-11-13 and OpenAI rates 2026-10-15 (gpt-6.1-terra
# and gpt-5.6-luna 2026-11-13, gpt-6.2-astra and gpt-6.2-sol 2026-11-17), each
# against its source page.
PRICES = {
    "claude-fable-5-2": claude(8.0, 40.0, 0.20),
    "claude-mythos-5-2": claude(8.0, 40.0, 0.20),
    "claude-fable-5-1": claude(10.0, 50.0, 0.25),
    "claude-mythos-5-1": claude(10.0, 50.0, 0.25),
    "claude-fable-5": claude(10.0, 50.0, 1.0),
    "claude-opus-5-5": claude(4.0, 20.0, 0.20),
    "claude-opus-5": claude(5.0, 25.0, 0.50),
    "claude-opus-4-8": claude(5.0, 25.0, 0.50),
    "claude-opus-4-7": claude(5.0, 25.0, 0.50),
    "claude-opus-4-6": claude(5.0, 25.0, 0.50),
    "claude-sonnet-5-5": claude(2.0, 10.0, 0.10),
    "claude-sonnet-5": claude(2.0, 10.0, 0.20),
    "claude-sonnet-4-6": claude(3.0, 15.0, 0.30),
    "claude-haiku-5-5": claude(0.10, 0.50, 0.01, HAIKU_LONG),
    "claude-haiku-4-5": claude(1.0, 5.0, 0.10),
    "gpt-6.2-astra": openai(8.0, 0.4, 10.0, 40.0, GPT_LONG),
    "gpt-6.2-sol": openai(2.0, 0.1, 2.5, 10.0, GPT_LONG),
    "gpt-6-astra": openai(10.0, 1.0, 12.5, 50.0, GPT_LONG),
    "gpt-6.1-sol": openai(2.0, 0.1, 2.5, 10.0, GPT_LONG),
    "gpt-6.1-terra": openai(1.0, 0.05, 1.25, 5.0, GPT_LONG),
    "gpt-6-sol": openai(2.0, 0.2, 2.5, 10.0, GPT_LONG),
    "gpt-6-luna": openai(0.1, 0.01, 0.125, 0.5, GPT_LONG),
    "gpt-5.6-sol": openai(4.0, 0.4, 5.0, 20.0, GPT_LONG),
    "gpt-5.6-terra": openai(2.0, 0.2, 2.5, 12.0, GPT_LONG),
    "gpt-5.6-luna": openai(0.2, 0.02, 0.25, 1.2, GPT_LONG),
    "gpt-5.3-codex": openai(1.75, 0.175, None, 14.0),
}
# https://developers.openai.com/api/docs/models/gpt-5.6-sol documents this alias.
ALIASES = {"gpt-5.6": "gpt-5.6-sol"}
# A context-window tag such as "[1m]" or a dated snapshot suffix names the
# same model at the same price.
SUFFIX = re.compile(r"(?:\[[^\]]*\]|-\d{8})\Z")


def canonical(model):
    """The table key a transcript's or catalog's model id is priced under."""
    name = str(model or "").strip().lower()
    while SUFFIX.search(name):
        name = SUFFIX.sub("", name)
    return ALIASES.get(name, name)


def rates(model):
    """USD per MTok for each token field, or None when the model has no price."""
    price = PRICES.get(canonical(model))
    return None if price is None else {field: price[field] for field in FIELDS}


def long_context_above(model):
    """Prompt tokens past which a request bills at the long-context premium, or None."""
    price = PRICES.get(canonical(model))
    return (price.get("longContext") or {}).get("above") if price else None


def claude_tokens(model, usage):
    """One Claude message's priced fields, with a ``longContext`` copy when
    its prompt is past the model's long-context threshold."""
    tokens = token_usage.claude(usage)
    above = long_context_above(model)
    prompt = tokens["input"] + tokens["cacheRead"] + tokens["cache5m"] + tokens["cache1h"]
    if above is not None and prompt > above:
        tokens["longContext"] = dict(tokens)
    return tokens


def model_cost(model, tokens):
    """Estimated USD for one model's token totals, or None when any of them
    has no published rate."""
    price = PRICES.get(canonical(model))
    if price is None:
        return None
    if any(tokens.get(field) and price[field] is None for field in FIELDS):
        return None
    cost = sum(tokens.get(field, 0) * (price[field] or 0) for field in FIELDS)
    long = tokens.get("longContext") or {}
    premium = price.get("longContext")
    if premium:
        for field in FIELDS:
            if not long.get(field):
                continue
            if premium.get(field) is None:
                return None
            cost += long[field] * price[field] * (premium[field] - 1)
    return cost / 1_000_000


def model_key(agent, model):
    """The table key ``agent``'s catalog id ``model`` is priced under, or
    None for an id that names no one model: "default", or a bare Claude
    alias such as "opus"."""
    if not isinstance(model, str) or model == "default":
        return None
    key = canonical(model)
    if agent == "claude" and not key.startswith("claude-"):
        return None
    return key


def unpriced(catalog):
    """The model ids a ``model_catalog.snapshot`` offers that have no price,
    once each, as ``[(agent, model id)]``."""
    found, seen = [], set()
    for agent, rows in (catalog or {}).items():
        for row in rows or []:
            key = model_key(agent, row.get("id") if isinstance(row, dict) else None)
            if key is not None and key not in PRICES and key not in seen:
                seen.add(key)
                found.append((agent, row["id"]))
    return found
