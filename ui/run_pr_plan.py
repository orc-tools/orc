"""The PR feedback round's plan, drawn on the PR comments tab before any fix.

While a round waits on the user (`prFeedback.state` is `awaiting-answers`,
skills/orc-pr "PR feedback round"), its questions file holds one question per
review comment: the comment, what Orc found, the approach it recommends as
short steps, and the choices. This page lays all of them out at once, with the
recommended choice picked and a note box on each, and sends every choice in
one click (**Start fixes**) through the same submit Answer mode uses, so an
answer from either one is the same answer. **Ask about it** puts a question
to Orc in Chat without starting anything.

Once the round has acted on the answers, the tab is the record page again
(ui/run_pr_threads.py), whose look and helpers this page shares.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
from typing import Any
from urllib.parse import quote

import question_sets
import run_pr_threads

QUESTIONS_FILE = "pr-review-questions.json"
ANSWERS_STATE = "awaiting-answers"


def generation(meta: dict[str, Any], path: str) -> str | None:
    """The identity an answer to this round binds to: its number and the
    questions file's bytes. None when the file cannot be read."""
    try:
        with open(path, "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None
    feedback = meta.get("prFeedback") if isinstance(meta.get("prFeedback"), dict) else {}
    return "pr-%s-%s" % (feedback.get("round", ""), digest[:16])


def asking(run_dir: str, meta: dict[str, Any]) -> bool:
    """True while the round's questions are the run's open business."""
    feedback = meta.get("prFeedback")
    return (isinstance(feedback, dict) and feedback.get("state") == ANSWERS_STATE
            and os.path.isfile(os.path.join(run_dir, QUESTIONS_FILE)))


def model(run_dir: str, meta: dict[str, Any]) -> dict[str, Any] | None:
    """What the plan page draws, or None when no round is asking."""
    if not asking(run_dir, meta):
        return None
    path = os.path.join(run_dir, QUESTIONS_FILE)
    try:
        with open(path, encoding="utf-8") as handle:
            schema = json.load(handle)
        shape = question_sets.normalize(schema)
    except (OSError, ValueError):
        return None
    current = generation(meta, path)
    if current is None:
        return None
    authors: list[str] = []
    questions = []
    for question in shape["questions"]:
        comment = question.get("comment") or {}
        author = comment.get("author") or ""
        if author and author not in authors:
            authors.append(author)
        questions.append({key: question[key] for key in (
            "id", "number", "header", "comment", "context", "approach",
            "recommendation", "other", "options")})
    return {
        "generation": current,
        "open": meta.get("status") == "awaiting-gate",
        "summary": shape.get("summary") or "",
        "authors": authors,
        "questions": questions,
    }


def inject(run_dir: str, meta: dict[str, Any], run_id: str,
           review_request: dict[str, Any] | None = None) -> bytes | None:
    """The plan page's markup, or None when no round is asking.
    `review_request` is the reviewer's Request review button
    (zerohands_review.request_model), or None to leave it out."""
    data = model(run_dir, meta)
    if data is None:
        return None
    base = "/runs/%s/" % quote(run_id, safe="")
    data.update(runId=run_id, submitUrl=base + "question-set-submit",
                askUrl=base + "chat-send", reviewRequest=review_request)
    return PAGE_INJECT.replace(
        b"__PR_PLAN__", html.escape(json.dumps(data), quote=True).encode())


PLAN_CSS = rb"""
<style>
  /* The plan stands in for the last round's record, its TL;DR and its
     Addressed date included. */
  body.pr-plan-on #md-content, body.pr-plan-on #tldr,
  body.pr-plan-on .subtitle { display: none; }
  #pr-plan { display: grid; gap: 16px; }
  .prp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
    padding: 12px 16px; position: sticky; top: 10px; z-index: 3; }
  .prp-bar h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--heading); }
  .prp-sub { color: var(--muted-strong); font-size: 13px; }
  .prp-actions { margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px; }
  .prp-btn:focus-visible, .prp-choice input:focus-visible + span,
  .prp-note:focus-visible, .prp-ask textarea:focus-visible {
    outline: 2px solid var(--focus, var(--green)); outline-offset: 2px; }
  .prp-ask { flex-basis: 100%; display: grid; gap: 8px; }
  .prp-ask[hidden] { display: none; }
  .prp-ask textarea, .prp-note { display: block; width: 100%; box-sizing: border-box;
    min-height: 40px; resize: vertical; padding: 9px 12px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
    font: inherit; font-size: 13.5px; line-height: 1.5; }
  .prp-ask-row { display: flex; gap: 8px; justify-content: flex-end; }
  .prp-tldr { border: 1px solid var(--border); border-radius: 8px; background: var(--panel);
    padding: 14px 18px; }
  .prp-kicker { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--accent-text, var(--accent)); }
  .prp-tldr p:last-child { margin: 0; color: var(--heading); font-size: 15px; }
  .prp-num { flex: none; font-size: 12px; font-weight: 600; line-height: 1;
    color: var(--muted-strong); background: var(--chip, var(--code)); border-radius: 999px;
    padding: 4px 8px; }
  .prp-body { display: grid; gap: 14px; padding: 14px 16px; }
  .prp-who { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; }
  .prp-who-name { display: flex; align-items: center; gap: 6px; }
  .prp-who-name strong { color: var(--heading); }
  .prp-bot { font-size: 11px; color: var(--muted-strong); border: 1px solid var(--border);
    border-radius: 4px; padding: 0 5px; line-height: 1.5; }
  .prp-said > :first-child { margin-top: 4px; }
  .prp-said > :last-child { margin-bottom: 0; }
  .prp-label { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted-strong); }
  .prp-section > .md > :first-child { margin-top: 0; }
  .prp-section > .md > :last-child { margin-bottom: 0; }
  .prp-steps { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .prp-steps li::marker { color: var(--muted-strong); }
  .prp-steps p { margin: 0; }
  .prp-choices { display: flex; flex-wrap: wrap; gap: 8px; border: 0; margin: 0; padding: 0;
    min-width: 0; }
  .prp-choices legend { position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap; }
  .prp-choice { position: relative; }
  .prp-choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .prp-choice > span { display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
    box-sizing: border-box; border: 1px solid var(--border); border-radius: 999px;
    padding: 5px 12px; font-size: 13px; color: var(--text); cursor: pointer; }
  .prp-choice input:checked + span { border-color: var(--accent); color: var(--heading);
    font-weight: 600; background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .prp-choice input:disabled + span { cursor: default; }
  .prp-rec { font-size: 11px; font-weight: 600; color: var(--green-text); }
  .prp-locked .prp-choice input:not(:checked) + span { opacity: .55; }
  @media (max-width: 560px) {
    .prp-bar { position: static; }
    .prp-actions { margin-left: 0; width: 100%; }
    .prp-actions .prp-btn { flex: 1 1 auto; }
    .prp-who { grid-template-columns: minmax(0, 1fr); }
    .prp-who .prt-avatar { display: none; }
  }
</style>
"""

PAGE_INJECT = run_pr_threads.THREAD_CSS + PLAN_CSS + rb"""
<script data-pr-plan="__PR_PLAN__">
(function () {
  var data = JSON.parse(document.currentScript.dataset.prPlan);
  var host = document.getElementById('md-content');
  if (!host || !data.questions.length) return;
""" + run_pr_threads.KIT_JS + run_pr_threads.REVIEW_REQUEST_JS + rb"""
  // Choices and notes survive a reload until they are sent.
  var KEY = 'orc-pr-plan:' + data.runId + ':' + data.generation;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  function remember() {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* private window */ }
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) { /* private window */ }
  }
  var recommended = function (question) {
    var pick = question.options.filter(function (option) { return option.recommended; })[0];
    return (pick || question.options[0] || {}).label || '';
  };
  // "Fix it: round down to the cent" reads as "Fix it" on its pill; the rest
  // is the approach above it. The full label is what gets sent.
  var short = function (label) {
    var at = label.indexOf(':');
    return at > 0 ? label.slice(0, at) : label;
  };
  data.questions.forEach(function (question) {
    var mine = saved[question.id];
    var labels = question.options.map(function (option) { return option.label; });
    if (!mine || labels.indexOf(mine.picked) < 0) {
      saved[question.id] = { picked: recommended(question), note: (mine && mine.note) || '' };
    }
  });

  var section = el('section');
  section.id = 'pr-plan';
  section.setAttribute('aria-label', 'Plan for the review comments');
  var count = data.questions.length;

  var bar = el('div', 'prp-bar');
  bar.appendChild(el('h2', '', 'Plan for ' + count + (count === 1 ? ' comment' : ' comments')));
  var sub = el('span', 'prp-sub', (data.authors.length ? data.authors.join(', ') + ' \u00b7 ' : '')
    + (data.open ? 'nothing changed yet' : 'Orc is working on the fixes'));
  bar.appendChild(sub);
  var status = el('p', 'prp-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  function say(text, failed) {
    status.textContent = text;
    status.classList.toggle('prp-error', !!failed);
  }
  var askButton = null, startButton = null, ask = null;
  if (data.open) {
    var actions = el('div', 'prp-actions');
    askButton = el('button', 'prp-btn', 'Ask about it');
    askButton.type = 'button';
    askButton.setAttribute('aria-expanded', 'false');
    startButton = el('button', 'prp-btn prp-primary', 'Start fixes');
    startButton.type = 'button';
    actions.appendChild(askButton);
    actions.appendChild(startButton);
    bar.appendChild(actions);

    ask = el('div', 'prp-ask');
    ask.hidden = true;
    var askLabel = el('label', 'sr-only', 'Your question about the plan');
    askLabel.htmlFor = 'prp-ask-text';
    var askText = el('textarea');
    askText.id = 'prp-ask-text';
    askText.rows = 2;
    askText.placeholder = 'Ask Orc about the plan. Nothing starts.';
    var askRow = el('div', 'prp-ask-row');
    var askCancel = el('button', 'prp-btn', 'Cancel');
    askCancel.type = 'button';
    var askSend = el('button', 'prp-btn', 'Send question');
    askSend.type = 'button';
    askRow.appendChild(askCancel);
    askRow.appendChild(askSend);
    ask.appendChild(askLabel);
    ask.appendChild(askText);
    ask.appendChild(askRow);
    bar.appendChild(ask);

    function toggleAsk(show) {
      ask.hidden = !show;
      askButton.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) askText.focus(); else askButton.focus();
    }
    askButton.addEventListener('click', function () { toggleAsk(ask.hidden); });
    askCancel.addEventListener('click', function () { toggleAsk(false); });
    askSend.addEventListener('click', function () {
      var text = askText.value.trim();
      if (!text) { askText.focus(); return; }
      askSend.disabled = true;
      say('Sending your question\u2026');
      fetch(data.askUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'About the plan: ' + text }) })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            if (!response.ok) throw new Error(payload.error || 'Your question was not sent.');
            askText.value = '';
            ask.hidden = true;
            askButton.setAttribute('aria-expanded', 'false');
            say('Asked. Orc answers in Chat; nothing has started.');
          });
        })
        .catch(function (error) { say(error.message || 'Your question was not sent.', true); })
        .then(function () { askSend.disabled = false; });
    });
  }
  bar.appendChild(status);
  section.appendChild(bar);

  if (data.summary) {
    var tldr = el('div', 'prp-tldr');
    tldr.appendChild(el('p', 'prp-kicker', 'The plan'));
    tldr.appendChild(el('p', '', data.summary));
    section.appendChild(tldr);
  }

  var inputs = [];
  data.questions.forEach(function (question, index) {
    var comment = question.comment || {};
    var card = el('article', 'prt' + (data.open ? '' : ' prp-locked'));
    var head = el('header', 'prt-file');
    var heading = el('h2');
    heading.id = 'prp-heading-' + index;
    card.setAttribute('aria-labelledby', heading.id);
    head.appendChild(el('span', 'prp-num', String(index + 1)));
    if (comment.path) {
      heading.appendChild(el('span', 'prt-path', comment.path));
      if (comment.line) {
        heading.appendChild(document.createTextNode(' '));
        heading.appendChild(el('span', 'prt-line', 'line ' + comment.line));
      }
    } else {
      heading.textContent = question.header || 'Review comment';
    }
    head.appendChild(heading);
    if (comment.url) head.appendChild(external('View on GitHub', comment.url));
    card.appendChild(head);
    if (comment.diffHunk) card.appendChild(hunkBlock(comment.diffHunk));

    var body = el('div', 'prp-body');
    if (comment.body) {
      var author = comment.author || 'Reviewer';
      var who = el('div', 'prp-who');
      var avatar = el('span', 'prt-avatar', author.charAt(0));
      avatar.setAttribute('aria-hidden', 'true');
      who.appendChild(avatar);
      var said = el('div');
      var name = el('div', 'prp-who-name');
      name.appendChild(el('strong', '', author));
      if (comment.bot) name.appendChild(el('span', 'prp-bot', 'bot'));
      said.appendChild(name);
      said.appendChild(markdown(comment.body, 'prp-said md'));
      who.appendChild(said);
      body.appendChild(who);
    }
    if (question.context) {
      var issue = el('div', 'prp-section');
      issue.appendChild(el('p', 'prp-label', 'The issue'));
      issue.appendChild(markdown(question.context, 'md'));
      body.appendChild(issue);
    }
    var steps = question.approach && question.approach.length ? question.approach
      : question.recommendation ? [question.recommendation] : [];
    if (steps.length) {
      var approach = el('div', 'prp-section');
      approach.appendChild(el('p', 'prp-label', 'Recommended approach'));
      var list = el('ol', 'prp-steps md');
      steps.forEach(function (step) {
        var item = el('li');
        var text = markdown(step);
        var only = text.children.length === 1 && text.firstElementChild.tagName === 'P';
        item.appendChild(only ? text.firstElementChild : text);
        list.appendChild(item);
      });
      approach.appendChild(list);
      body.appendChild(approach);
    }

    var choices = el('fieldset', 'prp-choices');
    choices.appendChild(el('legend', '', 'What should Orc do about comment ' + (index + 1)));
    question.options.forEach(function (option, optionIndex) {
      var choice = el('label', 'prp-choice');
      var input = el('input');
      input.type = 'radio';
      input.name = 'prp-' + index;
      input.value = option.label;
      input.checked = saved[question.id].picked === option.label;
      input.disabled = !data.open;
      if (option.description) choice.title = option.description;
      input.addEventListener('change', function () {
        saved[question.id].picked = option.label;
        remember();
      });
      var face = el('span', '', short(option.label));
      if (option.recommended) face.appendChild(el('span', 'prp-rec', 'Recommended'));
      choice.appendChild(input);
      choice.appendChild(face);
      choices.appendChild(choice);
      inputs.push(input);
    });
    body.appendChild(choices);

    if (question.other) {
      var noteId = 'prp-note-' + index;
      var noteLabel = el('label', 'sr-only', 'Note for Orc about comment ' + (index + 1));
      noteLabel.htmlFor = noteId;
      var note = el('textarea', 'prp-note');
      note.id = noteId;
      note.rows = 1;
      note.placeholder = 'Add a note for Orc\u2026';
      note.value = saved[question.id].note || '';
      note.readOnly = !data.open;
      note.addEventListener('input', function () {
        saved[question.id].note = note.value;
        remember();
      });
      body.appendChild(noteLabel);
      body.appendChild(note);
      inputs.push(note);
    }
    card.appendChild(body);
    section.appendChild(card);
  });

  if (data.reviewRequest) section.appendChild(reviewRequest(data.reviewRequest));

  if (startButton) {
    startButton.addEventListener('click', function () {
      var answers = {};
      data.questions.forEach(function (question) {
        var mine = saved[question.id];
        answers[question.id] = { picked: [mine.picked],
          other: question.other ? (mine.note || '').trim() : '' };
      });
      startButton.disabled = true;
      askButton.disabled = true;
      say('Sending your choices\u2026');
      fetch(data.submitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'pr-review', generation: data.generation, answers: answers }) })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            if (!response.ok) throw new Error(payload.error || 'Your choices were not sent.');
            forget();
            inputs.forEach(function (input) {
              if (input.type === 'radio') input.disabled = true; else input.readOnly = true;
            });
            section.querySelectorAll('.prt').forEach(function (card) { card.classList.add('prp-locked'); });
            startButton.textContent = 'Started';
            sub.textContent = (data.authors.length ? data.authors.join(', ') + ' \u00b7 ' : '')
              + 'Orc is working on the fixes';
            say('Sent. Orc is making the fixes; nothing goes to GitHub until you push.');
          });
        })
        .catch(function (error) {
          startButton.disabled = false;
          askButton.disabled = false;
          say(error.message || 'Your choices were not sent.', true);
        });
    });
  }

  host.parentNode.insertBefore(section, host);
  document.body.classList.add('pr-plan-on');
})();
</script>
"""
