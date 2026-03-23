#!/usr/bin/env python3
"""Evaluate a trained MaskablePPO model by playing N games and reporting win rate.

Usage:
    # Start the game server first:
    #   cd packages/server && npm run dev
    # Then:
    python scripts/evaluate.py --model monopdeal_ppo --games 50
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sb3_contrib import MaskablePPO

from monopdeal_rl.env import MonopDealEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a trained MonopDeal agent")
    parser.add_argument("--model", required=True, help="Path to saved MaskablePPO model")
    parser.add_argument("--server", default="http://localhost:3003", help="Game server URL")
    parser.add_argument("--games", type=int, default=50, help="Number of evaluation games")
    parser.add_argument("--bot-count", type=int, default=1, help="Number of opponent bots")
    parser.add_argument("--difficulty", default="medium", choices=["easy", "medium", "hard"])
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    env = MonopDealEnv(
        server_url=args.server,
        bot_count=args.bot_count,
        difficulty=args.difficulty,
        fast=True,
    )

    model = MaskablePPO.load(args.model)

    wins = 0
    total_rewards = 0.0
    total_steps = 0
    start_time = time.time()

    for game_idx in range(args.games):
        obs, info = env.reset()
        done = False
        episode_reward = 0.0
        steps = 0

        while not done:
            action_masks = env.action_masks()
            action, _ = model.predict(obs, action_masks=action_masks, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(int(action))
            episode_reward += reward
            steps += 1
            done = terminated or truncated

        state = env._client.game_state or {}
        won = state.get("winnerId") == env._client.my_id
        if won:
            wins += 1

        total_rewards += episode_reward
        total_steps += steps

        status = "WIN" if won else "LOSS"
        print(f"  Game {game_idx + 1:3d}/{args.games}: {status}  reward={episode_reward:+.3f}  steps={steps}")

    elapsed = time.time() - start_time
    win_rate = wins / args.games if args.games > 0 else 0

    print("\n" + "=" * 50)
    print(f"Results: {wins}/{args.games} wins ({win_rate:.1%})")
    print(f"Avg reward: {total_rewards / max(args.games, 1):.3f}")
    print(f"Avg steps:  {total_steps / max(args.games, 1):.1f}")
    print(f"Time:       {elapsed:.1f}s ({elapsed / max(args.games, 1):.2f}s/game)")
    print("=" * 50)

    env.close()


if __name__ == "__main__":
    main()
