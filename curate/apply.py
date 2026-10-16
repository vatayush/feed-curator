#!/usr/bin/env python3
"""Step 3 of a curation run: combine the rules' decisions with Claude's scores into the digest.

Reads state.json (from prepare.py) and scores.json (Claude: {"<post id>": {"score": 0-1,
"reason": "...", "topic": "..."}}), checks every judged post got a valid score, and writes
digest.json: the body of the page's digest/current document.

Usage: apply.py --work <dir>
"""
import argparse, json, os, sys

KEEP = ("id", "site", "url", "author", "text", "truncated", "postedAt", "postedAtText",
        "context", "quoted", "feeds")
MAX_BYTES = 240_000  # the store's limit is 256 KiB per document


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    a = ap.parse_args()
    state = json.load(open(os.path.join(a.work, "state.json")))
    scores = json.load(open(os.path.join(a.work, "scores.json")))

    problems, out = [], []
    for p in state["posts"]:
        s = state["decided"].get(p["id"]) or scores.get(p["id"])
        if s is None:
            problems.append(f"missing score: {p['id']}")
            continue
        score = s.get("score")
        if not isinstance(score, (int, float)) or not 0 <= score <= 1:
            problems.append(f"bad score {score!r}: {p['id']}")
            continue
        q = {k: p.get(k) for k in KEEP}
        q.update(score=round(float(score), 2), reason=(s.get("reason") or "").strip()[:200],
                 topic=(s.get("topic") or "").strip()[:40] or None)
        if s.get("rule"):
            q["rule"] = s["rule"]
        out.append(q)
    extra = set(scores) - {p["id"] for p in state["posts"]}
    if extra:
        problems.append(f"scores for unknown ids: {sorted(extra)[:5]}")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1

    digest = {"sample": False, "generatedAt": state["generatedAt"], "sources": state["sources"], "posts": out}
    body = json.dumps(digest, ensure_ascii=False)
    # Too big for one document: trim the longest texts of low scorers until it fits.
    for p in sorted(out, key=lambda p: (p["score"], -len(p["text"] or ""))):
        if len(body.encode()) <= MAX_BYTES:
            break
        if p["text"] and len(p["text"]) > 280:
            p["text"], p["truncated"] = p["text"][:280], True
            body = json.dumps(digest, ensure_ascii=False)
    if len(body.encode()) > MAX_BYTES:
        # Publishing would be refused: say so now rather than at the last step.
        print(f"digest is {len(body.encode())} bytes even with texts trimmed; the limit is {MAX_BYTES}",
              file=sys.stderr)
        return 1
    json.dump(digest, open(os.path.join(a.work, "digest.json"), "w"), ensure_ascii=False)
    kept = sum(1 for p in out if p["score"] >= state["threshold"])
    print(json.dumps({"posts": len(out), "kept": kept, "dropped": len(out) - kept,
                      "bytes": len(body.encode()), "threshold": state["threshold"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
