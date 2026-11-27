"""The PR feedback round drawn as review threads, the way GitHub shows them.

`pr-replies.json` carries a `threads` list beside its `replies`: the reviewer's
comment, where it sits, and what the round did about it. The page draws each
one as a thread with its suggested reply as an editable pending draft, and a
draft edit is saved back into `replies` so the same file still posts. A round
written before `threads` existed keeps the plain document page.
"""
from __future__ import annotations

import contextlib
import fcntl
import html
import json
import os
import tempfile
from typing import Any

REPLIES_FILE = "pr-replies.json"
LOCK_FILE = ".pr-replies.lock"
REVIEW_KEY = "review"
# GitHub refuses a longer comment body.
REPLY_MAX_CHARS = 65536
HUNK_LINES = 4
STATUSES = ("fixed", "left", "follow-up", "decision")


def _read_json(path: str) -> dict[str, Any] | None:
    try:
        with open(path) as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def card_id(value: Any) -> str:
    """A card's id as the string the round's files key it by. A round can
    write `"card": 1` for card "1", so a whole number counts as its digits;
    anything else that is not a non-empty string has no id ("")."""
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return str(value)
    return value.strip() if isinstance(value, str) else ""


def _link(value: Any) -> str:
    url = _text(value)
    return url if url.startswith(("https://", "http://")) else ""


def _posted(feedback: dict[str, Any], reply: dict[str, Any]) -> dict[str, Any] | None:
    """The recorded post for one reply. Review-body replies go out together
    as one PR comment, recorded once with the cards it carried."""
    posted = feedback.get("replies")
    if not isinstance(posted, dict):
        return None
    card = card_id(reply.get("card"))
    if reply.get("kind") == "thread":
        entry = posted.get(card)
    else:
        entry = posted.get(REVIEW_KEY)
        if isinstance(entry, dict) and card not in (entry.get("cards") or []):
            entry = None
    return entry if isinstance(entry, dict) else None


def _round_open(feedback: Any) -> bool:
    return (isinstance(feedback, dict)
            and feedback.get("state") in ("awaiting-push", "pushed")
            and not feedback.get("repliesPostedAt"))


def model(run_dir: str, meta: dict[str, Any]) -> dict[str, Any] | None:
    """What the page draws, or None when the round has no thread data."""
    feedback = meta.get("prFeedback")
    plan = _read_json(os.path.join(run_dir, REPLIES_FILE))
    if not isinstance(feedback, dict) or plan is None \
            or not isinstance(plan.get("threads"), list):
        return None
    replies = {card_id(reply.get("card")): reply for reply in plan.get("replies") or []
               if isinstance(reply, dict) and card_id(reply.get("card"))
               and _text(reply.get("body"))}
    editable = _round_open(feedback)
    threads = []
    for thread in plan["threads"]:
        if not isinstance(thread, dict):
            continue
        card, comment = card_id(thread.get("card")), _text(thread.get("comment"))
        if not card or not comment:
            continue
        line = thread.get("line")
        status = thread.get("status")
        entry = {
            "card": card,
            "header": _text(thread.get("header")),
            "author": _text(thread.get("author")),
            "path": _text(thread.get("path")),
            "line": line if isinstance(line, int) and not isinstance(line, bool)
            and line > 0 else None,
            "url": _link(thread.get("url")),
            "comment": comment,
            "diffHunk": "\n".join(
                _text(thread.get("diffHunk")).splitlines()[-HUNK_LINES:]),
            "status": status if status in STATUSES else "",
            "verdict": _text(thread.get("verdict")),
            "reply": None,
        }
        reply = replies.get(card)
        if reply is not None:
            posted = _posted(feedback, reply)
            entry["reply"] = {
                "body": reply["body"].strip(),
                "postedUrl": _link(posted.get("url")) if posted else "",
                "posted": posted is not None,
                "editable": editable and posted is None,
            }
        threads.append(entry)
    if not threads:
        return None
    commit = _text(feedback.get("commit"))
    return {
        "state": feedback.get("state") if isinstance(feedback.get("state"), str) else "",
        "commit": commit[:7],
        "branch": _text(meta.get("branch")),
        "verification": _text(feedback.get("verification")),
        "threads": threads,
    }


def save_reply(run_dir: str, card: Any, body: Any) -> tuple[int, str | None]:
    """Write one edited draft into pr-replies.json. Returns an HTTP status and,
    when the save is refused, the reason to show beside the draft."""
    if not isinstance(card, str) or not card:
        return 400, "card must be a string"
    if not isinstance(body, str) or not body.strip():
        return 400, "A reply cannot be empty."
    if len(body) > REPLY_MAX_CHARS:
        return 400, "A reply cannot be longer than %d characters." % REPLY_MAX_CHARS
    path = os.path.join(run_dir, REPLIES_FILE)
    with contextlib.ExitStack() as stack:
        # orc-pr-replies holds this lock while it posts, and records each post
        # in meta.json as it lands. Reading both under the lock means a draft
        # never changes after its text went to GitHub.
        lock = stack.enter_context(open(os.path.join(run_dir, LOCK_FILE), "a+"))
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 409, "The replies are being posted."
        meta = _read_json(os.path.join(run_dir, "meta.json")) or {}
        feedback = meta.get("prFeedback")
        plan = _read_json(path)
        if plan is None or not _round_open(feedback):
            return 409, "This round's replies are already posted."
        reply = next((reply for reply in plan.get("replies") or []
                      if isinstance(reply, dict) and card_id(reply.get("card")) == card), None)
        if reply is None:
            return 404, "No draft reply for card %s." % card
        if _posted(feedback, reply) is not None:
            return 409, "This reply is already posted."
        reply["body"] = body.strip()
        fd, temp_name = tempfile.mkstemp(
            dir=run_dir, prefix=".pr-replies.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(json.dumps(plan, indent=2) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        except OSError:
            with contextlib.suppress(OSError):
                os.unlink(temp_name)
            return 500, "Could not save the reply."
    return 200, None


def inject(run_dir: str, meta: dict[str, Any], save_url: str,
           push_both: bool = True,
           review_request: dict[str, Any] | None = None) -> bytes | None:
    """`push_both` says the round's push button also posts its replies
    (Settings' Push to a PR); otherwise they wait for Push comments.
    `review_request` is the reviewer's Request review button
    (zerohands_review.request_model), or None to leave it out."""
    data = model(run_dir, meta)
    if data is None:
        return None
    data["saveUrl"] = save_url
    data["reviewRequest"] = review_request
    data["postLabel"] = ("Push comments & commits"
                         if data["state"] == "awaiting-push" and push_both
                         else "Push comments")
    return PAGE_INJECT.replace(
        b"__PR_THREADS__", html.escape(json.dumps(data), quote=True).encode())


# The look and the helpers the review threads share with the round's plan
# (ui/run_pr_plan.py), which draws the same comments before any fix.
THREAD_CSS = rb"""
<style>
  body.pr-threads-on #md-content { display: none; }
  #pr-threads { display: grid; gap: 18px; }
  .prt { border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
    overflow: hidden; }
  .prt-file { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    padding: 8px 14px; border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--border) 28%, var(--panel)); }
  .prt-file h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--heading);
    min-width: 0; overflow-wrap: anywhere; flex: 1 1 12rem; }
  .prt-path { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prt-line { margin-left: 2px; font-weight: 400; color: var(--muted-strong); }
  .prt-file a { font-size: 12px; white-space: nowrap; }
  .prt-hunk { margin: 0; padding: 6px 0; overflow-x: auto; background: var(--code);
    border-bottom: 1px solid var(--border); font: 12px/1.6 "JetBrains Mono",
    ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prt-hunk span { display: block; padding: 0 14px; white-space: pre; }
  .prt-hunk .prt-add { background: color-mix(in srgb, var(--green) 16%, transparent); }
  .prt-hunk .prt-del { background: color-mix(in srgb, var(--red) 16%, transparent); }
  .prt-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px;
    padding: 14px 14px 0; }
  .prt-row:last-child { padding-bottom: 14px; }
  .prt-avatar { width: 28px; height: 28px; border-radius: 50%; display: grid;
    place-items: center; font-size: 12px; font-weight: 700; color: var(--heading);
    background: color-mix(in srgb, var(--accent) 30%, var(--panel));
    border: 1px solid var(--border); text-transform: uppercase; }
  .prt-avatar.prt-you { background: color-mix(in srgb, var(--green) 30%, var(--panel));
    font-size: 9.5px; letter-spacing: .02em; }
  .prt-bubble { border: 1px solid var(--border); border-radius: 8px; min-width: 0;
    background: var(--bg); }
  .prt-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
    padding: 7px 12px; border-bottom: 1px solid var(--border); font-size: 12.5px;
    color: var(--muted-strong); border-radius: 8px 8px 0 0;
    background: color-mix(in srgb, var(--border) 22%, var(--bg)); }
  .prt-meta strong { color: var(--heading); }
  .prt-meta a { margin-left: auto; font-size: 12px; }
  .prt-body { padding: 10px 12px; overflow-wrap: anywhere; }
  .prt-body > :first-child { margin-top: 0; }
  .prt-body > :last-child { margin-bottom: 0; }
  .prt-verdict { margin: 12px 14px 0 52px; display: flex; flex-wrap: wrap;
    align-items: baseline; gap: 6px 10px; font-size: 13px; color: var(--text); }
  .prt-verdict:last-child { margin-bottom: 14px; }
  .prt-verdict p { margin: 0; flex: 1 1 16rem; min-width: 0; }
  .prt-chip, .prt-badge { display: inline-block; padding: 1px 8px; border-radius: 999px;
    font-size: 11.5px; font-weight: 600; line-height: 1.6; white-space: nowrap;
    border: 1px solid var(--border); color: var(--muted-strong); }
  .prt-chip.prt-fixed { color: var(--green-text);
    border-color: color-mix(in srgb, var(--green) 55%, transparent); }
  .prt-chip.prt-decision { color: var(--yellow-text);
    border-color: color-mix(in srgb, var(--yellow) 55%, transparent); }
  .prt-badge.prt-pending { color: var(--yellow-text);
    border-color: color-mix(in srgb, var(--yellow) 55%, transparent); }
  .prt-badge.prt-posted { color: var(--green-text);
    border-color: color-mix(in srgb, var(--green) 55%, transparent); }
  .prt-draft .prt-bubble { border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
  .prt-draft textarea { display: block; width: 100%; min-height: 48px; resize: vertical;
    margin: 0; padding: 10px 12px; border: 0; border-radius: 0; background: transparent;
    color: var(--text); font: inherit; line-height: 1.55; overflow: hidden; }
  .prt-draft textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .prt-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 6px 12px;
    border-top: 1px solid var(--border); font-size: 12px; color: var(--muted-strong); }
  .prt-save { margin-left: auto; }
  .prt-save.prt-error { color: var(--red-text); }
  .prt-push { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
    background: var(--panel); }
  .prt-push h2 { margin: 0 0 4px; font-size: 14px; color: var(--heading); }
  .prt-push p { margin: 0; overflow-wrap: anywhere; }
  .prt-push code { background: var(--code); border-radius: 4px; padding: 1px 5px;
    font-size: 12.5px; }
  .prp-btn { font-family: inherit; font-size: 13.5px; font-weight: 600; line-height: 1;
    border-radius: 6px;
    padding: 9px 14px; min-height: 36px; border: 1px solid var(--border);
    background: var(--chip, var(--panel)); color: var(--heading); cursor: pointer; }
  .prp-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 12%, var(--chip, var(--panel))); }
  .prp-btn.prp-primary { background: var(--green); border-color: var(--green); color: var(--bg); }
  .prp-btn.prp-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--green) 82%, var(--heading)); }
  .prp-btn:disabled { opacity: .6; cursor: default; }
  .prp-btn:focus-visible { outline: 2px solid var(--focus, var(--green)); outline-offset: 2px; }
  .prp-status { flex-basis: 100%; margin: 0; font-size: 13px; color: var(--muted-strong); }
  .prp-status:empty { display: none; }
  .prp-status.prp-error { color: var(--red-text); }
  .prp-review { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
    background: var(--panel); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
  .prp-review h2 { margin: 0; font-size: 14px; color: var(--heading); }
  .prp-review p { margin: 0; flex: 1 1 16rem; min-width: 0; font-size: 13px;
    color: var(--muted-strong); }
  .prp-review code { background: var(--code); border-radius: 4px; padding: 1px 5px;
    font-size: 12.5px; }
  .prp-review .prp-status { flex-basis: 100%; }
  @media (max-width: 560px) {
    .prt-row { grid-template-columns: minmax(0, 1fr); }
    .prt-avatar { display: none; }
    .prt-verdict { margin-left: 14px; }
  }
</style>
"""

# Helpers for an injected page script, pasted inside its function scope.
KIT_JS = rb"""
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Comment text comes from whoever reviewed the PR, so only plain formatting
  // survives: no markup of theirs runs or loads anything in this page.
  var ALLOWED = { P: 1, BR: 1, STRONG: 1, EM: 1, DEL: 1, CODE: 1, PRE: 1, UL: 1, OL: 1,
    LI: 1, BLOCKQUOTE: 1, A: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HR: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1 };
  function clean(node) {
    Array.prototype.slice.call(node.children).forEach(function (child) {
      if (!ALLOWED[child.tagName]) {
        child.replaceWith(document.createTextNode(child.textContent));
        return;
      }
      var href = child.tagName === 'A' ? child.getAttribute('href') || '' : '';
      Array.prototype.slice.call(child.attributes).forEach(function (attr) {
        child.removeAttribute(attr.name);
      });
      if (/^https?:\/\//i.test(href)) {
        child.setAttribute('href', href);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      clean(child);
    });
  }
  function markdown(text, className) {
    var box = el('div', className);
    if (typeof marked === 'undefined') { box.textContent = text; return box; }
    var template = document.createElement('template');
    template.innerHTML = marked.parse(text);
    clean(template.content);
    box.appendChild(template.content);
    return box;
  }

  function row(avatarText, avatarClass) {
    var wrap = el('div', 'prt-row');
    var avatar = el('span', 'prt-avatar' + (avatarClass ? ' ' + avatarClass : ''), avatarText);
    avatar.setAttribute('aria-hidden', 'true');
    var bubble = el('div', 'prt-bubble');
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    return { wrap: wrap, bubble: bubble };
  }

  function external(label, href) {
    var link = el('a', '', label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function hunkBlock(diffHunk) {
    var hunk = el('pre', 'prt-hunk');
    hunk.setAttribute('aria-label', 'Code under review');
    diffHunk.split('\n').forEach(function (line) {
      hunk.appendChild(el('span', line.charAt(0) === '+' ? 'prt-add'
        : line.charAt(0) === '-' ? 'prt-del' : '', line || ' '));
    });
    return hunk;
  }

"""

# The reviewer's Request review panel, on the record page and the plan
# (ui/run_pr_plan.py); `request.hold` names why it waits (zerohands_review.request_hold),
# else it is live.
REVIEW_REQUEST_JS = rb"""
  function reviewRequest(request) {
    var hold = request.hold || '';
    var box = el('section', 'prp-review');
    box.setAttribute('aria-label', request.name + ' review');
    box.appendChild(el('h2', '', request.name + ' review'));
    var line = el('p');
    function describe(when) {
      line.textContent = '';
      if (hold) { line.textContent = hold; return; }
      line.appendChild(document.createTextNode('Posts '));
      line.appendChild(el('code', '', request.comment));
      line.appendChild(document.createTextNode(' on the PR as you'
        + (when ? '. Last asked ' + when + '.' : ', so ' + request.name + ' reviews what is on GitHub now.')));
    }
    function stamp(iso) {
      var date = new Date(iso);
      return isNaN(date) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    describe(request.requestedAt ? stamp(request.requestedAt) : '');
    box.appendChild(line);
    var button = el('button', 'prp-btn', request.label);
    button.type = 'button';
    button.disabled = !!hold;
    var status = el('p', 'prp-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    button.addEventListener('click', function () {
      button.disabled = true;
      status.classList.remove('prp-error');
      status.textContent = 'Posting ' + request.comment + '\u2026';
      fetch(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            if (!response.ok) throw new Error(payload.error || 'The request did not post.');
            status.textContent = 'Asked ' + request.name + ' for a review.';
            describe(stamp(payload.requestedAt || new Date().toISOString()));
            setTimeout(function () { button.disabled = false; }, 60000);
          });
        })
        .catch(function (error) {
          status.classList.add('prp-error');
          status.textContent = error.message || 'The request did not post.';
          button.disabled = false;
        });
    });
    box.appendChild(button);
    box.appendChild(status);
    return box;
  }
"""

PAGE_INJECT = THREAD_CSS + rb"""
<script data-pr-threads="__PR_THREADS__">
(function () {
  var data = JSON.parse(document.currentScript.dataset.prThreads);
  var host = document.getElementById('md-content');
  if (!host || !data.threads.length) return;

"""+KIT_JS+REVIEW_REQUEST_JS+rb"""
  var STATUS_LABEL = { fixed: 'Fixed', left: 'Left as is', 'follow-up': 'Follow-up run', decision: 'Needs your decision' };
  var postLabel = data.postLabel;

  function draft(thread, where) {
    var reply = thread.reply;
    var out = row('You', 'prt-you');
    out.wrap.classList.add('prt-draft');
    var meta = el('div', 'prt-meta');
    meta.appendChild(el('strong', '', 'Your reply'));
    out.bubble.appendChild(meta);
    if (reply.posted) {
      out.wrap.classList.remove('prt-draft');
      meta.appendChild(el('span', 'prt-badge prt-posted', 'Posted'));
      if (reply.postedUrl) meta.appendChild(external('View on GitHub', reply.postedUrl));
      out.bubble.appendChild(markdown(reply.body, 'prt-body md'));
      return out.wrap;
    }
    meta.appendChild(el('span', 'prt-badge prt-pending', 'Pending'));
    var id = 'prt-reply-' + thread.card.replace(/[^A-Za-z0-9_-]/g, '-');
    var label = el('label', 'sr-only', 'Reply to ' + (thread.author || 'the reviewer') + ' on ' + where);
    label.htmlFor = id;
    var field = el('textarea');
    field.id = id;
    field.value = reply.body;
    field.readOnly = !reply.editable;
    var foot = el('div', 'prt-foot');
    var hint = el('span', '', reply.editable
      ? 'Posts when you click ' + postLabel + '. Edits save as you type.'
      : 'Posts when you click ' + postLabel + '.');
    hint.id = id + '-hint';
    var status = el('span', 'prt-save');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    field.setAttribute('aria-describedby', hint.id);
    foot.appendChild(hint);
    foot.appendChild(status);
    out.bubble.appendChild(label);
    out.bubble.appendChild(field);
    out.bubble.appendChild(foot);

    function fit() {
      field.style.height = 'auto';
      field.style.height = field.scrollHeight + 'px';
    }
    requestAnimationFrame(fit);
    if (!reply.editable) return out.wrap;

    var saved = reply.body, timer = null;
    function say(text, failed) {
      status.textContent = text;
      status.classList.toggle('prt-error', !!failed);
    }
    function save() {
      clearTimeout(timer);
      timer = null;
      var body = field.value.trim();
      if (body === saved) return;
      if (!body) { say('A reply cannot be empty. The last saved text will post.', true); return; }
      say('Saving\u2026');
      fetch(data.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: thread.card, body: body })
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok) throw new Error(payload.error || 'Could not save the reply.');
          saved = body;
          if (field.value.trim() === body) say('Saved');
        });
      }).catch(function (error) {
        say(error.message || 'Could not save the reply.', true);
      });
    }
    field.addEventListener('input', function () {
      fit();
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    });
    field.addEventListener('blur', function () { if (timer) save(); });
    return out.wrap;
  }

  var section = el('section');
  section.id = 'pr-threads';
  section.setAttribute('aria-label', 'Review threads');
  data.threads.forEach(function (thread, index) {
    var card = el('article', 'prt');
    var where = thread.path ? thread.path + (thread.line ? ' line ' + thread.line : '') : 'the review';
    var file = el('header', 'prt-file');
    var heading = el('h2');
    heading.id = 'prt-heading-' + index;
    card.setAttribute('aria-labelledby', heading.id);
    if (thread.path) {
      heading.appendChild(el('span', 'prt-path', thread.path));
      if (thread.line) {
        heading.appendChild(document.createTextNode(' '));
        heading.appendChild(el('span', 'prt-line', 'line ' + thread.line));
      }
    } else {
      heading.textContent = 'Review comment';
    }
    file.appendChild(heading);
    if (thread.url) file.appendChild(external('View on GitHub', thread.url));
    card.appendChild(file);

    if (thread.diffHunk) card.appendChild(hunkBlock(thread.diffHunk));

    var author = thread.author || 'Reviewer';
    var comment = row(author.charAt(0));
    var meta = el('div', 'prt-meta');
    meta.appendChild(el('strong', '', author));
    meta.appendChild(el('span', '', 'commented'));
    comment.bubble.appendChild(meta);
    comment.bubble.appendChild(markdown(thread.comment, 'prt-body md'));
    card.appendChild(comment.wrap);

    if (thread.status || thread.verdict) {
      var verdict = el('div', 'prt-verdict md');
      if (thread.status) {
        verdict.appendChild(el('span', 'prt-chip prt-' + thread.status, STATUS_LABEL[thread.status]));
      }
      if (thread.verdict) {
        var note = markdown(thread.verdict);
        var only = note.children.length === 1 && note.firstElementChild.tagName === 'P';
        verdict.appendChild(only ? note.firstElementChild : note);
      }
      card.appendChild(verdict);
    }
    if (thread.reply) card.appendChild(draft(thread, where));
    section.appendChild(card);
  });

  if (data.commit) {
    var push = el('section', 'prt-push');
    push.appendChild(el('h2', '', data.state === 'pushed' ? 'Pushed' : 'Push'));
    var line = el('p');
    line.appendChild(document.createTextNode('Commit '));
    line.appendChild(el('code', '', data.commit));
    if (data.branch) {
      line.appendChild(document.createTextNode(' on '));
      line.appendChild(el('code', '', data.branch));
    }
    line.appendChild(document.createTextNode('.' + (data.verification ? ' Checked: ' + data.verification : '')));
    push.appendChild(line);
    section.appendChild(push);
  }

  if (data.reviewRequest) section.appendChild(reviewRequest(data.reviewRequest));

  host.parentNode.insertBefore(section, host);
  document.body.classList.add('pr-threads-on');
})();
</script>
"""
