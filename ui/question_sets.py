"""Question files as Answer mode's steps, and its answers as the gate's payload.

A run asks its user-owned questions through a questions file (the shared
schema in skills/_shared/question-form.md). The gate page renders that file
as a form and sends `els`, one entry per rendered control, plus a numbered
text block. Answer mode shows the same questions one step at a time, so its
answers are rebuilt here into exactly the `els` and lines that form sends:
serve._build_form fixes the control order, and validate_clarification_review
counts them.
"""

import json
import os
import re

FACT_TONES = ("ok", "warn", "bad", "info")
MAX_FACTS = 6
MAX_CLIPS = 8
# A review comment's code, as GitHub's diff hunk ends at the commented line.
COMMENT_HUNK_LINES = 8
# The audio run_files.AUDIO_TYPES serves, as chat-timeline.js's mediaKind
# names it.
CLIP_FILE = re.compile(r"\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$", re.I)


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _prompt(question):
    raw = question.get("prompt") or question.get("question") or question.get("q") or ""
    return str(raw).rstrip("?").strip()


def _qtype(question):
    return question.get("type") if question.get("type") in ("multi", "text") else "single"


def _options(question):
    """Options in the order _build_form renders them: recommended first."""
    options = [option for option in question.get("options") or [] if isinstance(option, dict)]
    return sorted(options, key=lambda option: 0 if option.get("recommended") else 1)


def _facts(question):
    facts = []
    for fact in question.get("facts") or []:
        if not isinstance(fact, dict) or not _text(fact.get("label")):
            continue
        tone = fact.get("tone") if fact.get("tone") in FACT_TONES else "info"
        facts.append({"label": _text(fact["label"]), "detail": _text(fact.get("detail")),
                      "tone": tone})
    return facts[:MAX_FACTS]


def _clip_path(value):
    """A clip's path inside the run folder, or "" for anything else."""
    path = _text(value)
    parts = path.split("/")
    if (not CLIP_FILE.search(path) or "\\" in path or ":" in path
            or any(part in ("", ".", "..") for part in parts)):
        return ""
    return path


def _clips(question):
    """Takes the user listens to before answering: audio in the run folder."""
    clips = []
    for clip in question.get("clips") or []:
        if isinstance(clip, str):
            clip = {"path": clip}
        if not isinstance(clip, dict):
            continue
        path = _clip_path(clip.get("path"))
        if path and all(known["path"] != path for known in clips):
            clips.append({"path": path, "label": _text(clip.get("label")) or path.split("/")[-1]})
    return clips[:MAX_CLIPS]


def _comment(question):
    """The review comment a PR feedback round asks about, or None.

    skills/orc-pr's feedback round asks one question per comment and names
    the comment here, so Answer mode can show who said it, where, and the
    code it is about before asking what to do.
    """
    comment = question.get("comment")
    if not isinstance(comment, dict) or not _text(comment.get("body")):
        return None
    line = comment.get("line")
    url = _text(comment.get("url"))
    return {
        "author": _text(comment.get("author")),
        "path": _text(comment.get("path")),
        "line": line if isinstance(line, int) and not isinstance(line, bool) and line > 0 else None,
        "url": url if url.startswith("https://") else "",
        "body": _text(comment.get("body")),
        "diffHunk": "\n".join(str(comment.get("diffHunk") or "").rstrip().splitlines()[-COMMENT_HUNK_LINES:]),
    }


def _draft(question):
    """The comment a drafted review would post, for Answer mode to show in a
    box the user can edit (ui/pr_review_draft.py), or None."""
    draft = question.get("draft")
    if not isinstance(draft, dict) or not isinstance(draft.get("body"), str):
        return None
    return {"label": _text(draft.get("label")) or "Comment", "body": draft["body"].strip(),
            "hint": _text(draft.get("hint"))}


def _qid(question, index):
    value = question.get("id")
    return value if isinstance(value, str) and value else "q%d" % index


# The most questions one Clarification or Quick grilling form takes. The
# longest form any Orc step asks for is verification setup's four
# (skills/_shared/verification-setup.md).
MAX_FORM_QUESTIONS = 4
# Keys that would make one question depend on another's answer. A form asks
# only independent questions; dependent ones get their own later form.
DEPENDENCY_KEYS = frozenset({
    "dependsOn", "depends_on", "dependency", "dependencies", "condition",
    "when", "visibleWhen", "showWhen", "parentQuestion",
})


def form_controls(question):
    """Controls serve._build_form renders for one question; None if unrenderable.

    Single source of truth for the count. tests/test_grilling_form_controls.py
    pins it against the real rendered markup so the two cannot drift again.
    """
    qtype = question.get("type", "single")
    if qtype == "text":
        return 1
    options = question.get("options")
    if not isinstance(options, list) or not options:
        return None
    if not question.get("other"):
        return len(options)
    # single's Other is a radio plus its sibling text input; multi's Other is
    # the text input alone -- _build_form's two opt-other branches.
    return len(options) + (2 if qtype == "single" else 1)


def form_error(questions, label="Quick grilling"):
    """Why a Clarification or Quick grilling form cannot be sent, or None.

    Send (serve._quick_grilling_question_error) and `orc-ui open --gate` both
    ask this, so a form the gate opens is one Send accepts.
    """
    if not isinstance(questions, list) or not 1 <= len(questions) <= MAX_FORM_QUESTIONS:
        return "%s takes 1–%d independent questions" % (label, MAX_FORM_QUESTIONS)
    for question in questions:
        if not isinstance(question, dict) or any(key in question for key in DEPENDENCY_KEYS):
            return "%s questions must be independent" % label
        if question.get("type", "single") not in ("single", "multi", "text"):
            return "%s question type is invalid" % label
        if form_controls(question) is None:
            return "%s choices require options" % label
    return None


def questions_file_path(run_dir, relative="clarification-questions.json"):
    """Run-root path, falling back to the clarification/ sibling of the .mdx.

    The root is canonical, but the contract names this file one sentence after
    `clarification/clarification.mdx`, so runs write it into that directory
    too. Reading only the root made the gate render an empty form -- questions
    in the terminal, nothing to answer in the app -- with no error anywhere.
    """
    path = os.path.join(run_dir, relative)
    if os.path.exists(path):
        return path
    sibling = os.path.join(run_dir, "clarification", os.path.basename(relative))
    return sibling if os.path.exists(sibling) else path


def gate_form_error(run_dir, page, mode=None):
    """Why the form a gate page opens cannot be sent, or None.

    Covers the Clarification page and a Quick grilling round; other pages
    carry no question form and pass.
    """
    if page == "clarification.html":
        path, label = questions_file_path(run_dir), "Clarification"
    elif page == "grilling.html" and mode == "quick":
        path, label = os.path.join(run_dir, "grilling-questions.json"), "Quick grilling"
        if not os.path.exists(path):
            return None
    else:
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return "%s has no readable %s" % (label, os.path.basename(path))
    if not isinstance(value, dict):
        return "%s has no questions" % os.path.basename(path)
    return form_error(value.get("questions"), label)


def requires_answer(question, *, clarification=False):
    # Older Clarification forms assumed every question blocked the run.
    return question.get("required", True) is not False if clarification else bool(question.get("required"))


def normalize(schema, *, clarification=False):
    """The questions file as Answer mode reads it, or ValueError."""
    questions = schema.get("questions") if isinstance(schema, dict) else None
    if not isinstance(questions, list) or not questions \
            or not all(isinstance(question, dict) for question in questions):
        raise ValueError("the questions file has no questions")
    start = schema.get("numberFrom")
    if not isinstance(start, int) or isinstance(start, bool) or start < 1:
        start = 1
    shaped = []
    for index, question in enumerate(questions):
        qtype = _qtype(question)
        group = question.get("group")
        shaped.append({
            "id": _qid(question, index),
            "number": start + index,
            "header": _text(question.get("header")),
            "prompt": _prompt(question),
            "type": qtype,
            "required": requires_answer(question, clarification=clarification),
            "requiredReason": _text(question.get("requiredReason")),
            "other": qtype != "text" and bool(question.get("other")),
            "placeholder": _text(question.get("placeholder")),
            "multiline": question.get("multiline", True) is not False,
            "context": _text(question.get("context")),
            "help": _text(question.get("help")),
            "recommendation": _text(question.get("recommendation")),
            "facts": _facts(question),
            "clips": _clips(question),
            "comment": _comment(question),
            "draft": _draft(question),
            "group": group if isinstance(group, str) and group else None,
            "options": [] if qtype == "text" else [{
                "label": str(option.get("label") or ""),
                "description": _text(option.get("description", option.get("desc"))),
                "recommended": bool(option.get("recommended")),
                "tradeoff": _text(option.get("tradeoff")),
                "buildConsequence": _text(option.get("buildConsequence")),
            } for option in _options(question)],
        })
    return {
        "prefix": _text(schema.get("prefix")) or "Plan",
        "numberFrom": start,
        "notes": bool(schema.get("notes")),
        "questions": shaped,
        "steps": _steps(questions, shaped),
    }


def _steps(raw, shaped):
    """One question per step, except consecutive questions sharing a group."""
    steps = []
    for index, question in enumerate(shaped):
        previous = steps[-1] if steps else None
        if (question["group"] and previous
                and shaped[previous["questions"][-1]]["group"] == question["group"]):
            previous["questions"].append(index)
            continue
        reason = _text(raw[index].get("groupReason")) if question["group"] else ""
        steps.append({"questions": [index], "reason": reason or None})
    return steps


def _answer(question, answers, index):
    answer = answers.get(_qid(question, index), {})
    if not isinstance(answer, dict):
        raise ValueError("answer %d is malformed" % (index + 1))
    picked = answer.get("picked") or []
    if not isinstance(picked, list) or not all(isinstance(label, str) for label in picked):
        raise ValueError("answer %d is malformed" % (index + 1))
    return picked, _text(answer.get("other")), _text(answer.get("text"))


def encode(schema, answers, notes="", *, clarification=False):
    """(els, lines) the gate page would send for these answers, or ValueError.

    `answers` maps a question id to {"picked": [labels], "other": text} for a
    choice and {"text": text} for a text question.
    """
    questions = schema.get("questions") if isinstance(schema, dict) else None
    if not isinstance(questions, list) or not questions:
        raise ValueError("the questions file has no questions")
    if not isinstance(answers, dict):
        raise ValueError("answers are malformed")
    els, lines = [], []
    for index, question in enumerate(questions):
        qtype = _qtype(question)
        picked, other, text = _answer(question, answers, index)
        if qtype == "text":
            if picked or other:
                raise ValueError("question %d takes a written answer" % (index + 1))
            els.append({"v": text})
            reply = text
        else:
            labels = [str(option.get("label") or "") for option in _options(question)]
            if any(label not in labels for label in picked) or len(set(picked)) != len(picked):
                raise ValueError("question %d has an answer it does not offer" % (index + 1))
            if qtype == "single" and len(picked) > 1:
                raise ValueError("question %d takes one answer" % (index + 1))
            if other and not question.get("other"):
                raise ValueError("question %d has no Other answer" % (index + 1))
            els.extend({"c": 1 if label in picked else 0} for label in labels)
            if question.get("other"):
                if qtype == "single":
                    els.append({"c": 1 if other and not picked else 0})
                els.append({"v": other})
            reply = ", ".join(label for label in labels if label in picked)
            if other:
                reply += (" — other: " if reply else "") + other
        if not reply and requires_answer(question, clarification=clarification):
            raise ValueError("question %d needs an answer" % (index + 1))
        lines.append("%d. %s?: %s" % (index + 1, _prompt(question), reply or "Skipped"))
    note = _text(notes) if schema.get("notes") else ""
    if schema.get("notes"):
        els.append({"v": note})
    if note:
        lines.append("Notes: " + note)
    return els, lines
