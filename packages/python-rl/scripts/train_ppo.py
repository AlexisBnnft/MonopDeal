#!/usr/bin/env python3
"""Train a MaskablePPO agent against the MonopDeal game server.

Usage:
    # Start the game server first:
    #   cd packages/server && npm run dev
    # Then:
    python scripts/train_ppo.py --timesteps 100000 --server http://localhost:3003
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

# Ensure the package is importable when running from the scripts/ directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sb3_contrib import MaskablePPO
from sb3_contrib.common.wrappers import ActionMasker

from monopdeal_rl.env import MonopDealEnv


def mask_fn(env: MonopDealEnv):  # noqa: ANN201
    return env.action_masks()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train MaskablePPO on MonopDeal")
    parser.add_argument("--server", default="http://localhost:3003", help="Game server URL")
    parser.add_argument("--timesteps", type=int, default=100_000, help="Total training timesteps")
    parser.add_argument("--bot-count", type=int, default=1, help="Number of opponent bots")
    parser.add_argument("--difficulty", default="medium", choices=["easy", "medium", "hard"])
    parser.add_argument("--save-path", default="monopdeal_ppo", help="Where to save the model")
    parser.add_argument("--log-dir", default="logs/", help="Tensorboard log directory")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    env = MonopDealEnv(
        server_url=args.server,
        bot_count=args.bot_count,
        difficulty=args.difficulty,
        fast=True,
    )
    env = ActionMasker(env, mask_fn)

    model = MaskablePPO(
        "MlpPolicy",
        env,
        verbose=1,
        tensorboard_log=args.log_dir,
        learning_rate=3e-4,
        n_steps=512,
        batch_size=64,
        n_epochs=4,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.05,
    )

    print(f"Training for {args.timesteps} timesteps against {args.bot_count} {args.difficulty} bot(s)...")
    model.learn(total_timesteps=args.timesteps)
    model.save(args.save_path)
    print(f"Model saved to {args.save_path}")

    env.close()


if __name__ == "__main__":
    main()
