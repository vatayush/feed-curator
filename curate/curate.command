#!/bin/zsh -l
# Opened in Terminal by the curation launcher after a capture (see host/feed_curator_host.py). Runs
# one curation pass with Claude Code, then closes this window. Claude is ended when it finishes its
# report (curate/end_auto_run.py, a Stop hook) or after 15 minutes at the latest, so a stuck run
# can't linger.
cd "${0:A:h:h}" || exit 1
export FEED_CURATOR_AUTO=1
( sleep 900; pkill -TERM -P $$ -f '^claude /curate$' ) &!
watchdog=$!
claude "/curate"
kill $watchdog 2>/dev/null
# Close this window once the shell has exited, so Terminal doesn't ask about a running process.
tty="$(tty)"
( sleep 1; osascript -e "tell application \"Terminal\" to close (every window whose tty of selected tab is \"$tty\")" ) &>/dev/null &!
