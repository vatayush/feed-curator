#!/usr/bin/env python3
"""Step 1 of a curation run: merge the latest captures with the Feed Curator page's data.

Applies the hard rules (always-show / always-hide people, blocked words) itself, so they behave
the same on every run, and writes two files into --work:

  judge.json   what Claude scores: active preferences, recent votes, and the posts the rules
               didn't decide, trimmed to what's needed to judge them
  state.json   everything apply.py needs to build the digest afterwards

Usage: prepare.py --db <dir from ArtifactData out_dir> --work <dir>  (captures: <project>/captures)
"""
import argparse, json, os, shutil, sys, time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TOPICS = ["AI & tech", "Startups", "Jobs", "Engineering", "Other"]
STALE_AFTER_H = 3          # a capture older than this isn't new: don't re-curate it
RECENT_VOTES = 100
TEXT_CHARS = 700


def load_collection(db_dir, name):
    d = os.path.join(db_dir, name)
    if not os.path.isdir(d):
        return []
    rows = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".json"):
            doc = json.load(open(os.path.join(d, f)))
            rows.append(doc.get("data", doc))
    return rows


def load_config():
    """The reader's own settings (config.json, next to curate/). Missing file: defaults."""
    try:
        return json.load(open(os.path.join(ROOT, "config.json")))
    except FileNotFoundError:
        return {}


def parse_time(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def norm_handle(site, handle):
    h = (handle or "").strip().lower()
    return f"{site}:{h if site != 'x' else (h if h.startswith('@') else '@' + h)}"


def prune_work_folders(work, keep_days=7):
    """Deletes sibling run-* work folders older than a week, so runs never need to delete anything.
    Only inside a folder named work/, so a mistaken --work can't clean up somewhere else."""
    parent = os.path.dirname(os.path.abspath(work))
    if os.path.basename(parent) != "work":
        return
    cutoff = time.time() - keep_days * 86400
    for name in os.listdir(parent) if os.path.isdir(parent) else []:
        path = os.path.join(parent, name)
        if name.startswith("run-") and os.path.isdir(path) and path != os.path.abspath(work) \
                and os.path.getmtime(path) < cutoff:
            shutil.rmtree(path)


def write_judge(path, judge):
    """One vote or post per line, so the Read tool shows the whole file (it stops at 2000 lines)."""
    line = lambda v: json.dumps(v, ensure_ascii=False)
    parts = []
    for k, v in judge.items():
        if isinstance(v, list):
            items = ",\n".join("  " + line(x) for x in v)
            parts.append(f"{line(k)}: [\n{items}\n]" if v else f"{line(k)}: []")
        else:
            parts.append(f"{line(k)}: {line(v)}")
    with open(path, "w") as f:
        f.write("{\n" + ",\n".join(parts) + "\n}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--runs", default=os.path.join(ROOT, "captures"))
    ap.add_argument("--work", required=True)
    ap.add_argument("--now", help="ISO time, for tests")
    ap.add_argument("--force", action="store_true", help="re-curate a capture that was already curated")
    a = ap.parse_args()
    now = parse_time(a.now) if a.now else datetime.now(timezone.utc)
    prune_work_folders(a.work)

    prefs = [p["text"] for p in load_collection(a.db, "prefs") if p.get("active", True) and p.get("text")]
    people = load_collection(a.db, "people")
    keywords = [k["text"] for k in load_collection(a.db, "keywords") if k.get("text")]
    votes = sorted(load_collection(a.db, "votes"), key=lambda v: v.get("at", 0), reverse=True)
    settings = (load_collection(a.db, "settings") or [{}])[0]
    config = load_config()

    show = {norm_handle(p["site"], p["handle"]): p["handle"] for p in people if p.get("list") == "show"}
    hide = {norm_handle(p["site"], p["handle"]): p["handle"] for p in people if p.get("list") == "hide"}

    # A missing or unreadable captures folder means this run can't see the captures (e.g. the
    # folder isn't shared with it), not that nothing was ever captured. Refuse, so the digest's
    # source details aren't overwritten with "never captured".
    if not os.path.isdir(a.runs) or not os.access(a.runs, os.R_OK | os.X_OK):
        print(json.dumps({"fresh": False, "capturesFolderMissing": a.runs}))
        return 5

    sources, posts = [], []
    for site in ("x", "linkedin"):
        path = os.path.join(a.runs, f"{site}-latest.json")
        if not os.path.exists(path):
            sources.append({"site": site, "status": "disabled", "reason": "never captured", "postCount": 0})
            continue
        run = json.load(open(path))
        age_h = (now - parse_time(run["finishedAt"])).total_seconds() / 3600
        src = {"site": site, "status": run["status"], "reason": run["reason"], "postCount": run["postCount"],
               "capturedAt": run["finishedAt"]}
        if run["status"] in ("ok", "stopped") and run["posts"] and age_h > STALE_AFTER_H:
            src.update(status="stale", reason=f"no new capture since {run['finishedAt']} (Chrome closed or asleep?)")
        elif run["status"] in ("ok", "stopped"):
            posts.extend(run["posts"])
        sources.append(src)

    decided, to_judge = {}, []
    for p in posts:
        key = norm_handle(p["site"], p["author"]["handle"])
        hay = " ".join([p.get("text") or "", (p.get("quoted") or {}).get("text") or ""]).lower()
        hit = next((k for k in keywords if k.lower() in hay), None)
        if key in show:
            decided[p["id"]] = {"score": 1.0, "reason": f"Always show: {show[key]}", "rule": "show"}
        elif key in hide:
            decided[p["id"]] = {"score": 0.0, "reason": f"Always hidden: {hide[key]}", "rule": "hide"}
        elif hit:
            decided[p["id"]] = {"score": 0.0, "reason": f"Blocked word: “{hit}”", "rule": "keyword"}
        else:
            to_judge.append({
                "id": p["id"], "site": p["site"], "feeds": p.get("feeds", []),
                "author": f"{p['author']['name']} ({p['author']['handle']})",
                "context": p.get("context"),
                "text": (p.get("text") or "")[:TEXT_CHARS] or "[image or video only]",
                "truncated": p.get("truncated", False),
                "quoted": p.get("quoted"),
            })

    liked = {}
    for v in votes:
        h = (v.get("author") or {}).get("handle")
        if h:
            liked.setdefault(h, [0, 0])[0 if v.get("vote", 0) > 0 else 1] += 1

    os.makedirs(a.work, exist_ok=True)
    judge = {
        "preferences": prefs,
        "about": (config.get("about") or "").strip(),
        "topics": config.get("topics") or DEFAULT_TOPICS,
        "recentVotes": [{"vote": "up" if v.get("vote", 0) > 0 else "down",
                         "author": (v.get("author") or {}).get("handle"),
                         "feeds": v.get("feeds"), "topic": v.get("topic"),
                         "text": (v.get("text") or "")[:200]} for v in votes[:RECENT_VOTES]],
        "authorVotes": {h: {"up": u, "down": d} for h, (u, d) in liked.items()},
        "posts": to_judge,
    }
    write_judge(os.path.join(a.work, "judge.json"), judge)
    json.dump({"generatedAt": now.isoformat().replace("+00:00", "Z"), "sources": sources,
               "threshold": settings.get("threshold", 0.6), "decided": decided, "posts": posts},
              open(os.path.join(a.work, "state.json"), "w"), ensure_ascii=False)

    # Already curated: the current digest came from these exact captures. Re-scoring them would
    # only churn the digest, so stop unless asked (e.g. to apply new votes now).
    prev = (load_collection(a.db, "digest") or [{}])[0]
    prev_caps = {s["site"]: s.get("capturedAt") for s in prev.get("sources", [])}
    used = [s for s in sources if s["status"] in ("ok", "stopped") and s.get("capturedAt")]
    if posts and used and not a.force and all(prev_caps.get(s["site"]) == s["capturedAt"] for s in used):
        print(json.dumps({"fresh": False, "alreadyCurated": True,
                          "capturedAt": {s["site"]: s["capturedAt"] for s in used}}))
        return 4

    fresh = bool(posts)
    print(json.dumps({"fresh": fresh, "posts": len(posts), "decidedByRules": len(decided),
                      "toJudge": len(to_judge), "preferences": len(prefs), "votes": len(votes),
                      "sources": [(s["site"], s["status"]) for s in sources]}))
    return 0 if fresh else 3


if __name__ == "__main__":
    sys.exit(main())
