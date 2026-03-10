#!/usr/bin/env bash
# Launches server + client + 3 bots for UI testing.
# Usage: ./scripts/dev-test.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID $CLIENT_PID $BOT_PID 2>/dev/null || true
  wait $SERVER_PID $CLIENT_PID $BOT_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

echo ""
echo "=== MonopDeal Dev Test ==="
echo ""

# 1. Start server
echo "[1/3] Starting server..."
npm run dev:server &
SERVER_PID=$!
sleep 2

# 2. Start client
echo "[2/3] Starting client..."
npm run dev:client &
CLIENT_PID=$!
sleep 3

# 3. Start bots
echo "[3/3] Starting bots..."
echo ""
node scripts/test-bots.mjs &
BOT_PID=$!

wait $BOT_PID
