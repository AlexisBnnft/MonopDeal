"""Debug script to exercise the MonopDealEnv step-by-step."""

import logging
import sys
import time

sys.path.insert(0, "..")

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)

from monopdeal_rl.env import MonopDealEnv


def pr(msg):
    print(msg, flush=True)


def main():
    env = MonopDealEnv(
        server_url="http://localhost:3003",
        bot_count=1,
        difficulty="medium",
        fast=True,
    )
    pr("=== RESET ===")
    obs, info = env.reset()
    mask = info["action_mask"]
    pr(f"Reset OK  obs.shape={obs.shape}  valid_actions={mask.sum()}")
    pr(f"  my_id={env._client.my_id}")
    pr(f"  is_my_turn={env._client.is_my_turn()}")
    state = env._client.game_state or {}
    pr(f"  turnPhase={state.get('turnPhase')}  cpi={state.get('currentPlayerIndex')}")
    pr(f"  hand_size={len(env._client.hand)}")

    for step_i in range(30):
        mask = env.action_masks()
        valid = mask.nonzero()[0]
        action = int(valid[0])
        pr(f"\n--- Step {step_i} ---")
        pr(f"  Chosen action: {action}  (valid: {valid[:10].tolist()})")

        state_before = env._client.game_state or {}
        pr(f"  Before emit: cpi={state_before.get('currentPlayerIndex')}, "
           f"tp={state_before.get('turnPhase')}, "
           f"is_my_turn={env._client.is_my_turn()}")

        obs, reward, terminated, truncated, info = env.step(action)

        state_after = env._client.game_state or {}
        pr(f"  After step:  cpi={state_after.get('currentPlayerIndex')}, "
           f"tp={state_after.get('turnPhase')}, "
           f"is_my_turn={env._client.is_my_turn()}, "
           f"reward={reward:.3f}")

        if terminated or truncated:
            winner = state_after.get("winnerId")
            pr(f"  Episode done! terminated={terminated} truncated={truncated} winner={winner}")
            break

        err = env._client.consume_error()
        if err:
            pr(f"  SERVER ERROR: {err}")

    env.close()
    pr("\nDone")


if __name__ == "__main__":
    main()
