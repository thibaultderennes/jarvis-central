#!/bin/bash
# Stop and remove the Jarvis launchd jobs (macOS). Logs, settings and ~/.config/jarvis/env are kept.
set -uo pipefail
for name in worker plan weekly; do
  label="com.jarvis.$name"
  launchctl bootout "gui/$UID/$label" 2>/dev/null && echo "unloaded $label" || echo "$label was not loaded"
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
