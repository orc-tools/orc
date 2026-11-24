"""Suggested arguments for one MCP tool or prompt, written by a fast model.

The MCP inspector's Suggest button sends the item the person has open (its
input schema or prompt arguments), what they have typed so far and an
optional request such as "a week of data for Paris". One tool-less Claude
call (quick_claude) answers with a JSON object of arguments, which the
inspector puts in the form for the person to check. Nothing is called, and
no result, header or secret-looking typed value reaches the model.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass

import quick_claude

TIMEOUT = 60
ITEM_LIMIT = 64 * 1024
DRAFT_LIMIT = 16 * 1024
HINT_LIMIT = 2000
INSTRUCTIONS_LIMIT = 4000
CONTEXT_LIMIT = 2000
REPLY_LIMIT = 64 * 1024
KINDS = {"tools": "tool", "prompts": "prompt"}
SECRET_NAME = re.compile(r"(?i)(key|token|secret|passw(or)?d|credential|auth)")

RULES = """\
Reply with one JSON object holding the arguments and nothing else: no markdown, no code fence, no explanation.
- Use realistic, specific values that fit each property's type, format, pattern, enum and limits.
- Fill every required property. Add optional ones only where they make the call more useful.
- Prefer values the descriptions, defaults, examples or server instructions point to.
- Keep the arguments already typed unless the request asks for something else.
- Never make up passwords, tokens, API keys or personal details of real people.
"""


class BadRequest(ValueError):
    pass


class SuggestError(Exception):
    """Why no arguments came back, worded for the inspector."""


def _bounded_json(value, limit: int, field: str) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if len(text) > limit:
        raise BadRequest("%s is larger than %d KB" % (field, limit // 1024))
    return text


@dataclass(frozen=True)
class Request:
    kind: str
    name: str
    item: dict
    draft: dict
    hint: str

    @classmethod
    def parse(cls, data: dict) -> "Request":
        kind, item = data.get("kind"), data.get("item")
        if kind not in KINDS:
            raise BadRequest("kind must be one of: %s" % ", ".join(sorted(KINDS)))
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            raise BadRequest("item must be the %s as the server lists it" % KINDS[kind])
        draft, hint = data.get("draft", {}), data.get("hint", "")
        if not isinstance(draft, dict):
            raise BadRequest("draft must be an object")
        if not isinstance(hint, str) or len(hint) > HINT_LIMIT:
            raise BadRequest("hint must be text of at most %d characters" % HINT_LIMIT)
        _bounded_json(item, ITEM_LIMIT, "item")
        _bounded_json(draft, DRAFT_LIMIT, "draft")
        return cls(kind, item["name"][:512], item, draft, hint.strip())

    def shareable_draft(self) -> dict:
        """What was typed, without any value that reads as a secret: one the
        schema marks writeOnly or a password, or whose name says key, token,
        secret or password."""
        schema = self.item.get("inputSchema") if isinstance(self.item.get("inputSchema"), dict) else {}
        properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}

        def secret(name):
            prop = properties.get(name) if isinstance(properties.get(name), dict) else {}
            return bool(SECRET_NAME.search(name)) or prop.get("writeOnly") is True or prop.get("format") == "password"
        return {name: value for name, value in self.draft.items() if not secret(name)}

    def declared(self) -> set[str]:
        """The names of the arguments the item declares."""
        if self.kind == "prompts":
            return {arg["name"] for arg in self.item.get("arguments") or []
                    if isinstance(arg, dict) and isinstance(arg.get("name"), str)}
        schema = self.item.get("inputSchema") if isinstance(self.item.get("inputSchema"), dict) else {}
        properties = schema.get("properties")
        return set(properties) if isinstance(properties, dict) else set()


def prompt(request: Request, *, server: str = "", instructions: str | None = None,
           context: list[str] | None = None) -> str:
    """The whole request the model reads."""
    noun = KINDS[request.kind]
    lines = ["You fill in example arguments for one %s of an MCP server, so someone can try it." % noun, ""]
    if server:
        lines.append("Server: %s" % server[:200])
    if isinstance(instructions, str) and instructions.strip():
        lines.append("Server instructions: %s" % instructions.strip()[:INSTRUCTIONS_LIMIT])
    for line in (context or [])[:5]:
        if isinstance(line, str) and line.strip():
            lines.append(line.strip()[:CONTEXT_LIMIT])
    title = request.item.get("title")
    lines.append("%s: %s%s" % (noun.capitalize(), request.name,
                                " (%s)" % title if isinstance(title, str) and title.strip() else ""))
    description = request.item.get("description")
    if isinstance(description, str) and description.strip():
        lines.append("Description: %s" % description.strip()[:INSTRUCTIONS_LIMIT])
    if request.kind == "tools":
        lines.append("Input schema (JSON Schema): %s" % json.dumps(request.item.get("inputSchema") or {},
                                                                   ensure_ascii=False, sort_keys=True))
    else:
        lines.append("Arguments: %s" % json.dumps(request.item.get("arguments") or [], ensure_ascii=False))
        lines.append("Every value is a string.")
    typed = request.shareable_draft()
    if typed:
        lines.append("Arguments already typed: %s" % json.dumps(typed, ensure_ascii=False, sort_keys=True))
    if request.hint:
        lines.append("What the person wants: %s" % request.hint)
    return "\n".join([*lines, "", RULES])


def parse_reply(text: str, request: Request) -> dict:
    """The arguments in the model's reply: the first JSON object in it, cut
    to what the item declares when its schema allows nothing else."""
    text = (text or "")[:REPLY_LIMIT]
    text = re.sub(r"^\s*```[A-Za-z]*\s*|\s*```\s*$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    try:
        value = json.loads(text[start:end + 1]) if 0 <= start < end else None
    except ValueError:
        value = None
    if not isinstance(value, dict):
        raise SuggestError("The suggestion was not a JSON object of arguments. Try again.")
    declared = request.declared()
    closed = request.kind == "prompts" or (
        isinstance(request.item.get("inputSchema"), dict)
        and request.item["inputSchema"].get("additionalProperties") is False)
    if closed:
        value = {name: item for name, item in value.items() if name in declared}
    if request.kind == "prompts":
        value = {name: item if isinstance(item, str) else json.dumps(item) for name, item in value.items()}
    return value


def suggest(request: Request, *, server: str = "", instructions: str | None = None,
            context: list[str] | None = None, run=subprocess.run) -> dict:
    try:
        reply = quick_claude.ask(prompt(request, server=server, instructions=instructions, context=context),
                                 noun="suggestion", consequence="so Orc can't suggest arguments",
                                 timeout=TIMEOUT, override_env="ORC_MCP_SUGGEST_CLAUDE", run=run)
    except quick_claude.QuickError as exc:
        raise SuggestError(str(exc)) from None
    return parse_reply(reply, request)
