#!/bin/bash
# Feed Curator installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/vatayush/feed-curator/main/install.sh | bash
#
# Options (after `bash -s --` when piped):
#   --dir <path>     where to install (default: ~/feed-curator)
#   --from-source    build the extension with npm instead of downloading the release build
#   --uninstall      remove the Chrome helper registration, and optionally the install folder
set -euo pipefail

REPO="vatayush/feed-curator"
REPO_URL="${FEED_CURATOR_REPO_URL:-https://github.com/$REPO.git}"
EXT_ZIP_URL="https://github.com/$REPO/releases/latest/download/feed-curator-extension.zip"
EXT_ID="gfmnfobhjfljldnmnecihbmhfjmjmcko"
HOST_JSON="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.feedcurator.host.json"
DIR="$HOME/feed-curator"
FROM_SOURCE=0
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --from-source) FROM_SOURCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\nError: %s\n' "$*" >&2; exit 1; }
# Questions read from the terminal, so they work when this script is piped from curl.
ask()  { local a; read -r -p "  $1 [y/N] " a 2>/dev/null </dev/tty || return 1; [[ "$a" == [yY]* ]]; }
set_config() { # set_config <key> <json value>
  python3 - "$DIR/config.json" "$1" "$2" <<'PY'
import json, sys
path, key, value = sys.argv[1:]
c = json.load(open(path))
c[key] = json.loads(value)
json.dump(c, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
PY
}
config_value() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")' "$DIR/config.json" "$1"; }

if [ "$UNINSTALL" = 1 ]; then
  say "Uninstalling Feed Curator"
  rm -f "$HOST_JSON" && info "Removed the Chrome helper registration."
  launchctl bootout "gui/$(id -u)/com.feedcurator.curate" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.feedcurator.curate.plist" && info "Removed the curation launcher."
  if [ -d "$DIR" ] && ask "Delete $DIR too? It holds your captures and config.json."; then
    rm -rf "$DIR" && info "Deleted $DIR."
  fi
  info "Remove the extension yourself on chrome://extensions. Your Feed Curator page stays on claude.ai."
  exit 0
fi

say "Checking requirements"
[ "$(uname)" = Darwin ] || die "Feed Curator runs on macOS only."
[ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ] \
  || die "Google Chrome isn't installed."
command -v claude >/dev/null || die "Claude Code isn't installed. Get it at https://claude.com/claude-code, then run this again."
xcode-select -p >/dev/null 2>&1 || die "Install Apple's command line tools first (they provide git and python3): xcode-select --install"
info "macOS, Chrome, Claude Code, git and python3: OK"

say "Getting Feed Curator into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only --quiet && info "Updated the existing copy."
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  die "$DIR exists and isn't a Feed Curator copy. Move it, or pass --dir <another folder>."
else
  git clone --quiet "$REPO_URL" "$DIR" && info "Downloaded."
fi
cd "$DIR"
mkdir -p captures work
[ -f config.json ] || cp config.example.json config.json

say "Preparing the Chrome extension"
if [ "$FROM_SOURCE" = 1 ]; then
  command -v npm >/dev/null || die "--from-source needs Node.js (npm)."
  npm ci --silent && npm run --silent build && info "Built from source into $DIR/dist."
else
  tmp="$(mktemp -d)"
  curl -fsSL "$EXT_ZIP_URL" -o "$tmp/ext.zip" || die "Couldn't download the extension build. Try again with --from-source."
  rm -rf dist && mkdir dist && unzip -q "$tmp/ext.zip" -d dist && rm -rf "$tmp"
  info "Downloaded the latest build into $DIR/dist."
fi

say "Registering the capture helper with Chrome"
sh host/install.sh "$EXT_ID" | sed 's/^/  /'

say "Automatic curation"
cat <<EOF
  After each capture, Feed Curator can open a Terminal window that runs Claude Code to score the
  new posts and update your page. Those runs are unattended, so they get these permissions in
  advance, only inside $DIR:
    - read your Feed Curator page's data, and write its digest (nothing else; a hook enforces it)
    - run curate/prepare.py and curate/apply.py, and write files in work/
  Anything else stops at a permission prompt, and each run is closed after 15 minutes.
  Without this, you curate by hand: open Claude Code in $DIR and type /curate.
EOF
if ask "Turn on automatic curation?"; then
  set_config autoCurate true && info "On. Change it any time with \"autoCurate\" in config.json."
else
  set_config autoCurate false && info "Off. Turn it on with \"autoCurate\": true in config.json."
fi

say "Your Feed Curator page"
if [ -n "$(config_value artifactUrl)" ]; then
  info "Already set up: $(config_value artifactUrl)"
else
  info "Claude Code will now open and create your page on claude.ai. Approve its steps, and"
  info "type /exit when it says the page is ready."
  ask "Ready?" || die "Run this installer again when you're ready."
  claude "/setup-page" </dev/tty
  [ -n "$(config_value artifactUrl)" ] \
    || die "The page wasn't created. Run 'claude /setup-page' in $DIR, then this installer again."
  info "Page: $(config_value artifactUrl)"
fi

say "Last step: load the extension in Chrome (Chrome doesn't allow this from a script)"
cat <<EOF
  1. In Chrome, open chrome://extensions and turn on Developer mode (top right).
  2. Click "Load unpacked" and choose: $DIR/dist  (opening it in Finder now)
  3. Pin Feed Curator to the toolbar, open it and press "Run X now" to try it.
EOF
open "$DIR/dist"

say "Done"
cat <<EOF
  X is captured at 07:45 and 17:45 (change the times in the extension's popup), while Chrome is
  open and you're logged in to X. Your digest: $(config_value artifactUrl)
  Settings: the page (preferences, people, blocked words), the popup (times, feeds, LinkedIn),
  and $DIR/config.json (topics, a note about you, automatic curation).
  Uninstall: bash $DIR/install.sh --uninstall
EOF
