#!/usr/bin/env bash
# PPO training script for MonopDeal RL agent.
# Usage:
#   ./scripts/train.sh                  # full 500k run
#   ./scripts/train.sh --games 5000     # quick test
#   ./scripts/train.sh --resume         # resume from checkpoint
#
# All flags are forwarded to train.ts:
#   --games N        total games (default 500000)
#   --eval-every N   eval frequency (default 2000)
#   --rollout N      games per rollout (default 200)
#   --lr N           learning rate (default 1e-4)
#   --resume         resume from last checkpoint
#   --keep-old-data  don't clear previous logs/checkpoints

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

DIST_DIR="packages/ai/dist"
mkdir -p "$DIST_DIR"

echo ""
echo "=== MonopDeal PPO Training ==="
echo ""

# Bundle TS → JS with esbuild (fast, <1s)
echo "[Build] Compiling with esbuild..."
npx esbuild packages/ai/src/train.ts \
  --bundle --platform=node --format=esm \
  --outfile="$DIST_DIR/train.mjs" \
  --external:esbuild \
  --target=node20 \
  --sourcemap 2>&1 | head -5

npx esbuild packages/ai/src/rl/game-worker.ts \
  --bundle --platform=node --format=esm \
  --outfile="$DIST_DIR/game-worker.mjs" \
  --external:esbuild \
  --target=node20 \
  --sourcemap 2>&1 | head -5

echo "[Build] Done"
echo ""

exec node "$DIST_DIR/train.mjs" "$@"
