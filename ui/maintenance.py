"""How big the review instructions have grown, for the Maintenance bot's
check-in. Bots cannot read outside their own folder, so Orc measures the
files and the bot reads the numbers through the orc:read MCP scope."""

from pathlib import Path

import review_context

REVIEW_SKILL_BUDGET = 200
CONTEXT_FILE_BUDGET = 200
AUTOMATIC = "(automatic)"


def _lines(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return None


def _review_skill(skills_dir):
    folder = Path(skills_dir) / "orc-review"
    paths = [folder / "SKILL.md", *sorted((folder / "references").glob("*.md"))]
    files = [{"path": str(path.relative_to(folder)), "lines": count}
             for path in paths if (count := _lines(path)) is not None]
    total = sum(f["lines"] for f in files)
    return {"files": files, "lines": total, "budget": REVIEW_SKILL_BUDGET,
            "overBudget": total > REVIEW_SKILL_BUDGET}


def _context_files():
    root = review_context.orc_home() / "review" / "projects"
    found = []
    for path in sorted(root.glob("*/*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        count = len(text.splitlines())
        found.append({"repository": str(path.relative_to(root).with_suffix("")),
                      "path": str(path), "lines": count,
                      "automaticEntries": sum(AUTOMATIC in line for line in text.splitlines()),
                      "budget": CONTEXT_FILE_BUDGET, "overBudget": count > CONTEXT_FILE_BUDGET})
    return found


def status(skills_dir):
    review = _review_skill(skills_dir)
    contexts = _context_files()
    learned = review_context.orc_home() / "review" / "learned-checks.md"
    over = (["orc-review skill"] if review["overBudget"] else []) + \
        ["%s review context" % f["repository"] for f in contexts if f["overBudget"]]
    return {"reviewSkill": review, "contextFiles": contexts,
            "learnedChecks": {"path": str(learned), "lines": _lines(learned)},
            "overBudget": over}
