#!/usr/bin/env bash
# Starts the backend and frontend dev servers in the background, then drops
# into a sqlite3 shell on checkpoints.db. Ctrl-D / .quit stops both servers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_FILE="${1:-$ROOT_DIR/checkpoints.db}"

cleanup() {
  echo "Stopping backend (pid $BACKEND_PID) and frontend (pid $FRONTEND_PID)..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting backend (server/) ..."
(cd "$ROOT_DIR/server" && npm run dev) &
BACKEND_PID=$!

echo "Starting frontend (client/client/) ..."
(cd "$ROOT_DIR/client/client" && npm run dev) &
FRONTEND_PID=$!

sleep 1
echo "Backend pid=$BACKEND_PID, frontend pid=$FRONTEND_PID"
echo "Opening sqlite3 shell on $DB_FILE (.tables to list tables, .quit to exit and stop servers)"
sqlite3 "$DB_FILE"
