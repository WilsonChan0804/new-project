#!/bin/bash
# Twofold local server for Mac. Double-click to start; close the window to stop.
cd "$(dirname "$0")"
PORT=8765
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
echo "Twofold is running at http://localhost:$PORT — keep this window open."
(sleep 1; open "http://localhost:$PORT/") &
python3 -m http.server $PORT
