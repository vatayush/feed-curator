#!/usr/bin/env python3
"""PreToolUse hook for ArtifactData in the Feed Curator folder (see .claude/settings.json).

Curation reads posts written by strangers with the database tool pre-approved, so a post could try
to steer Claude into deleting votes or editing another artifact. This allows only what a curation
run needs: reading the Feed Curator page's data and writing its digest/current document.
Exit 2 blocks the call and tells Claude why.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READS = {"get", "list", "query"}
WRITES = {"set", "update"}


def page_url():
    """The reader's Feed Curator page, from config.json (written by setup)."""
    try:
        return (json.load(open(os.path.join(ROOT, "config.json"))).get("artifactUrl") or "").rstrip("/")
    except FileNotFoundError:
        return ""


def verdict(call):
    inp = call.get("tool_input") or {}
    action, url = inp.get("action"), (inp.get("url") or "").rstrip("/")
    page = page_url()
    if not page:
        return "there's no Feed Curator page in config.json yet; run setup first"
    if url != page:
        return "only the Feed Curator page in config.json may be used from this project"
    if action in READS:
        return None
    if action in WRITES and inp.get("collection") == "digest" and inp.get("doc_id") == "current":
        return None
    return f"curation may only read the page's data and write digest/current, not {action}"


def main():
    # Any other exit code lets the call through, so an unreadable request is blocked too.
    try:
        reason = verdict(json.load(sys.stdin))
    except Exception as e:
        reason = f"couldn't check the call ({type(e).__name__})"
    if reason:
        print(f"Blocked by curate/guard_artifact.py: {reason}.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
