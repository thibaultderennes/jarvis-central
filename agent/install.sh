#!/bin/bash
# Install (or reinstall) the Jarvis scheduled jobs on macOS (launchd), rendered from jarvis.config.json:
#   com.jarvis.worker  inbox worker, every worker.interval_seconds
#   com.jarvis.plan    weekly planner, planner.run
#   com.jarvis.weekly  Monday reviews, reviews.run
# Linux: run `node agent/schedule.mjs cron` and paste the lines into `crontab -e` instead.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(uname)" != "Darwin" ]; then
  echo "launchd is macOS-only. On Linux use: node $HERE/schedule.mjs cron   (then crontab -e)" >&2
  exit 1
fi
if [ ! -f "$HOME/.config/jarvis/env" ]; then
  echo "Missing ~/.config/jarvis/env (JARVIS_URL, JARVIS_AGENT_TOKEN). Run: node app/scripts/setup.mjs secrets" >&2
  exit 1
fi
command -v claude >/dev/null || { echo "The claude CLI isn't on PATH. Install Claude Code and run 'claude' once to log in." >&2; exit 1; }
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST" "$HOME/Library/Logs/jarvis"
node "$HERE/schedule.mjs" launchd --out "$DEST"
for name in worker plan weekly; do
  label="com.jarvis.$name"
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  plutil -lint "$DEST/$label.plist" >/dev/null
  launchctl bootstrap "gui/$UID" "$DEST/$label.plist"
  echo "loaded $label"
done
launchctl print "gui/$UID/com.jarvis.worker" | grep -E "state|last exit" || true
echo "Logs: ~/Library/Logs/jarvis/   ·   Remove with: $HERE/uninstall.sh"
