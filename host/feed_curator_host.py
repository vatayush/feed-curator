"""Chrome native messaging host: saves capture runs into the project's captures/ folder.

The extension can only download into ~/Downloads, so it hands each run to this script instead.
Message: {"type": "save", "site": "x"|"linkedin", "stamp": "<finishedAt, filesystem-safe>", "json": "<run file>",
          "curate": true|false}
Reply: {"ok": true, "path": "...", "curating": true|false} or {"ok": false, "error": "..."}

With "curate" set and "autoCurate" on in config.json, it then starts the launchd job that
opens curate/curate.command in Terminal.
"""
import json
import os
import re
import struct
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURES = os.path.join(ROOT, "captures")
JOB = "com.feedcurator.curate"  # launchd job that opens curate/curate.command in Terminal
LOCK = os.path.join(ROOT, "work", ".curate-started")
LOCK_S = 5 * 60  # two captures this close together get one curation pass
KEEP_DAYS = 30
SITES = {"x", "linkedin"}
STAMP = re.compile(r"^[0-9T-]+Z$")


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (n,) = struct.unpack("=I", raw)
    return json.loads(sys.stdin.buffer.read(n))


def send(msg):
    data = json.dumps(msg).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
    sys.stdout.buffer.flush()


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def prune():
    """Deletes timestamped run files older than 30 days. The -latest files are kept."""
    cutoff = time.time() - KEEP_DAYS * 86400
    for name in os.listdir(CAPTURES):
        if re.match(r"^(x|linkedin)-\d.*\.json$", name):
            p = os.path.join(CAPTURES, name)
            if os.path.getmtime(p) < cutoff:
                os.remove(p)


def auto_curate_on():
    try:
        return json.load(open(os.path.join(ROOT, "config.json"))).get("autoCurate", False) is True
    except (FileNotFoundError, ValueError):
        return False


def start_curation():
    """Opens a Terminal window running /curate, unless one was started in the last few minutes."""
    try:
        if time.time() - os.path.getmtime(LOCK) < LOCK_S:
            return False
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    with open(LOCK, "w"):
        pass
    # Start the launchd job that opens curate.command in Terminal (host/install.sh registers it):
    # macOS doesn't let Chrome, which this helper runs under, open documents in Terminal itself.
    try:
        subprocess.run(["/bin/launchctl", "kickstart", f"gui/{os.getuid()}/{JOB}"], timeout=20, check=True,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        os.remove(LOCK)
        return False
    return True


def save(msg):
    site, stamp, text = msg.get("site"), msg.get("stamp"), msg.get("json")
    if site not in SITES or not isinstance(stamp, str) or not STAMP.match(stamp) or not isinstance(text, str):
        return {"ok": False, "error": "bad message"}
    json.loads(text)  # refuse anything that isn't a JSON document
    os.makedirs(CAPTURES, exist_ok=True)
    path = os.path.join(CAPTURES, f"{site}-{stamp}.json")
    write_atomic(path, text)
    write_atomic(os.path.join(CAPTURES, f"{site}-latest.json"), text)
    prune()
    curating = msg.get("curate") is True and auto_curate_on() and start_curation()
    return {"ok": True, "path": path, "curating": curating}


def main():
    msg = read_message()
    if msg is None:
        return
    try:
        send(save(msg) if msg.get("type") == "save" else {"ok": False, "error": "unknown type"})
    except Exception as e:  # report instead of dying silently
        send({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
