"""Stop hook: ends an automatic curation session once Claude has finished its report.

curate/curate.command sets FEED_CURATOR_AUTO=1 and then closes its Terminal window when Claude exits.
Sessions you start yourself don't have it set, and are left alone.
"""
import os
import signal
import subprocess
import sys

if os.environ.get("FEED_CURATOR_AUTO") != "1":
    sys.exit(0)

# Walk up from this hook to the Claude process that ran it.
pid = os.getppid()
while pid > 1:
    out = subprocess.run(["ps", "-o", "ppid=,command=", "-p", str(pid)], capture_output=True, text=True).stdout.split(None, 1)
    if len(out) < 2:
        break
    if out[1].strip() == "claude /curate":
        os.kill(pid, signal.SIGTERM)
        break
    pid = int(out[0])
