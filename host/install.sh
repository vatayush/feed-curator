#!/bin/sh
# Registers the capture-saving helper with Chrome. Usage: host/install.sh [extension id]
# The extension's manifest pins its id, so the argument is only needed for a modified copy.
set -e
ID="${1:-gfmnfobhjfljldnmnecihbmhfjmjmcko}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3)"
mkdir -p "$HERE/../captures"
# Chrome starts hosts with a bare environment, so pin the interpreter in a small launcher.
cat > "$HERE/run-host.sh" <<SH
#!/bin/sh
exec "$PY" "$HERE/feed_curator_host.py" "\$@"
SH
chmod +x "$HERE/run-host.sh"
DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
cat > "$DIR/com.feedcurator.host.json" <<JSON
{
  "name": "com.feedcurator.host",
  "description": "Feed Curator: saves captures into $(cd "$HERE/.." && pwd)/captures",
  "path": "$HERE/run-host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
echo "Registered the capture helper for extension $ID."

# An on-demand launchd job (no schedule) that opens curate.command in Terminal. The helper starts
# it instead of opening Terminal itself: macOS doesn't let Chrome open documents in Terminal.
ROOT="$(cd "$HERE/.." && pwd)"
LABEL="com.feedcurator.curate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/open</string><string>-a</string><string>Terminal</string><string>$ROOT/curate/curate.command</string></array>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
XML
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Registered the curation launcher ($LABEL)."
