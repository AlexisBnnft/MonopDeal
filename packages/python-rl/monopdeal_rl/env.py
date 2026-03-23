"""Gymnasium environment that connects to the MonopDeal game server via Socket.IO."""

from __future__ import annotations

import logging
import time
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .action_mapper import (
    action_to_emission,
    build_valid_mask,
    enumerate_discard_actions,
    enumerate_play_actions,
    enumerate_response_actions,
)
from .constants import FEATURE_SIZE, MAX_ACTIONS, REWARDS
from .feature_encoder import encode_state
from .socket_client import GameSocketClient

logger = logging.getLogger(__name__)

_STATE_TIMEOUT = 5.0
_MAX_STEPS_PER_EPISODE = 500


class MonopDealEnv(gym.Env):
    """Gymnasium wrapper around a live MonopDeal game server.

    The agent connects as a regular Socket.IO client, creates a room with
    TypeScript bots, and plays the game.  Observations are 192-dim feature
    vectors; actions are discrete indices from the shared action space (95).

    Compatible with ``sb3-contrib.MaskablePPO`` via :meth:`action_masks`.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        server_url: str = "http://localhost:3003",
        bot_count: int = 1,
        difficulty: str = "medium",
        fast: bool = True,
        rewards: dict[str, float] | None = None,
    ) -> None:
        super().__init__()
        self.server_url = server_url
        self.bot_count = bot_count
        self.difficulty = difficulty
        self.fast = fast
        self.reward_cfg = {**REWARDS, **(rewards or {})}

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(FEATURE_SIZE,), dtype=np.float32,
        )
        self.action_space = spaces.Discrete(MAX_ACTIONS)

        self._client = GameSocketClient()
        self._candidates: list[tuple[int, dict]] = []
        self._mask = np.zeros(MAX_ACTIONS, dtype=np.bool_)
        self._prev_complete_sets = 0
        self._step_count = 0

    # ------------------------------------------------------------------
    # Gym API
    # ------------------------------------------------------------------

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        self._step_count = 0
        self._prev_complete_sets = 0

        # Tear down previous connection and reconnect
        try:
            self._client.disconnect()
        except Exception:
            pass
        self._client = GameSocketClient()
        self._client.connect(self.server_url)

        self._client.create_ai_room(
            bot_count=self.bot_count,
            difficulty=self.difficulty,
            fast=self.fast,
        )

        # Wait until we receive a game state where we need to act
        obs, info = self._wait_for_decision_point()
        return obs, info

    def step(
        self, action: int,
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        self._step_count += 1

        # Rebuild candidates from the FRESHEST state so we never emit
        # actions computed from a stale state snapshot.
        state = self._client.game_state or {}
        hand = self._client.hand
        try:
            my_id = self._client.my_id
        except AssertionError:
            my_id = ""
        fresh_candidates = self._enumerate_candidates(state, hand, my_id)
        if fresh_candidates:
            self._candidates = fresh_candidates
            self._mask = build_valid_mask(self._candidates)
            if not self._mask.any():
                self._candidates = [(0, {"type": "end-turn"})]
                self._mask[0] = True

        # Map the chosen action to a socket emission
        emission = action_to_emission(action, self._candidates)
        if emission is None:
            logger.debug("Action %d no longer valid – forcing end-turn", action)
            emission = ("game:end-turn", {})

        event_name, event_data = emission

        # Snapshot state before the action for reward computation
        prev_state = self._client.game_state
        prev_hand = list(self._client.hand)

        # Clear any stale error, then capture version *before* emit so we
        # can detect new arrivals even if the bot responds instantly.
        self._client.consume_error()
        pre_emit_ver = self._client.state_version

        # Emit the action; if the socket is dead, truncate the episode
        if not self._safe_emit(event_name, event_data):
            obs = np.zeros(FEATURE_SIZE, dtype=np.float32)
            info: dict[str, Any] = {"action_mask": np.zeros(MAX_ACTIONS, dtype=np.bool_)}
            info["action_mask"][0] = True
            return obs, self.reward_cfg["lose"], False, True, info

        # Wait until the server has sent at least one state update after
        # our emit, then wait until the agent needs to make a decision.
        obs, info = self._wait_for_decision_point(since_version=pre_emit_ver)

        reward = self._compute_reward(action, prev_state, prev_hand)

        terminated = self._client.game_over
        truncated = self._step_count >= _MAX_STEPS_PER_EPISODE

        if terminated:
            winner_id = (self._client.game_state or {}).get("winnerId")
            if winner_id == self._client.my_id:
                reward += self.reward_cfg["win"]
            elif winner_id is not None:
                reward += self.reward_cfg["lose"]

        return obs, reward, terminated, truncated, info

    def action_masks(self) -> np.ndarray:
        """Return the current valid-action mask (for MaskablePPO)."""
        return self._mask.copy()

    def close(self) -> None:
        try:
            self._client.disconnect()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Internal: wait until the agent needs to make a decision
    # ------------------------------------------------------------------

    def _wait_for_decision_point(
        self, since_version: int | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Block until the game state requires a decision from the agent.

        The GameEngine auto-draws at turn start, so the agent only needs to
        decide during action / response / discard phases.

        *since_version* – if set, we first ensure the client has received at
        least one event newer than this version (captured *before* emitting an
        action) to avoid acting on a stale pre-action state.  Because the bot
        can finish its entire turn before we even enter this method, we compare
        against the pre-emit version instead of the version at call-time.
        """
        deadline = time.monotonic() + _STATE_TIMEOUT

        # ── Phase 1: ensure we have at least one post-emit state ──
        if since_version is not None:
            target = since_version + 1
            if self._client.state_version < target:
                remaining = max(deadline - time.monotonic(), 0.1)
                try:
                    self._client.wait_for_version(target, timeout=remaining)
                except TimeoutError:
                    return self._build_obs_and_info()

        # ── Phase 2: spin until a decision is needed ──
        while time.monotonic() < deadline:
            if self._is_decision_needed():
                # Tiny yield: the socket background thread may still have
                # events in its queue (e.g. game:hand right after game:state).
                time.sleep(0.005)
                return self._build_obs_and_info()

            remaining = max(deadline - time.monotonic(), 0.1)
            try:
                self._client.wait_for_new_state(timeout=remaining)
            except TimeoutError:
                break

        # Timeout fallback – return whatever state we have
        return self._build_obs_and_info()

    def _is_decision_needed(self) -> bool:
        state = self._client.game_state
        if state is None:
            return False
        if state.get("phase") == "finished":
            return True
        if self._client.is_pending_for_me():
            return True
        if self._client.is_my_turn() and not state.get("pendingAction"):
            tp = state.get("turnPhase")
            if tp in ("action", "discard"):
                return True
        return False

    def _build_obs_and_info(self) -> tuple[np.ndarray, dict[str, Any]]:
        state = self._client.game_state or {}
        hand = self._client.hand
        try:
            my_id = self._client.my_id
        except AssertionError:
            obs = np.zeros(FEATURE_SIZE, dtype=np.float32)
            self._candidates = [(0, {"type": "end-turn"})]
            self._mask = np.zeros(MAX_ACTIONS, dtype=np.bool_)
            self._mask[0] = True
            self._client.game_over = True
            return obs, {"action_mask": self._mask}

        obs = encode_state(state, hand, my_id)

        # Build valid-action candidates
        self._candidates = self._enumerate_candidates(state, hand, my_id)
        self._mask = build_valid_mask(self._candidates)

        # Ensure at least one action is valid (end-turn fallback)
        if not self._mask.any():
            self._candidates = [(0, {"type": "end-turn"})]
            self._mask[0] = True

        return obs, {"action_mask": self._mask}

    def _enumerate_candidates(
        self, state: dict, hand: list[dict], my_id: str,
    ) -> list[tuple[int, dict]]:
        if state.get("phase") == "finished":
            return [(0, {"type": "end-turn"})]

        # Response phase
        pa = state.get("pendingAction")
        if pa and self._client.is_pending_for_me():
            return enumerate_response_actions(hand, pa, state=state, my_id=my_id)

        tp = state.get("turnPhase")

        if tp == "discard":
            return enumerate_discard_actions(hand)

        if tp == "action":
            return enumerate_play_actions(state, hand, my_id)

        return [(0, {"type": "end-turn"})]

    # ------------------------------------------------------------------
    # Internal: emit a socket event
    # ------------------------------------------------------------------

    def _safe_emit(self, event_name: str, data: dict[str, Any]) -> bool:
        """Emit and return True, or return False if the socket is dead."""
        try:
            self._emit_event(event_name, data)
            return True
        except Exception:
            logger.warning("Socket disconnected – truncating episode")
            self._client.game_over = True
            return False

    def _emit_event(self, event_name: str, data: dict[str, Any]) -> None:
        if event_name == "game:end-turn":
            self._client.emit_end_turn()
        elif event_name == "game:play-card":
            card_id = data.get("cardId", "")
            self._client.emit_play_card(
                card_id,
                as_money=data.get("asMoney"),
                color=data.get("color"),
                target_player_id=data.get("targetPlayerId"),
                target_card_id=data.get("targetCardId"),
                offered_card_id=data.get("offeredCardId"),
                target_set_color=data.get("targetSetColor"),
                double_the_rent_card_ids=data.get("doubleTheRentCardIds"),
            )
        elif event_name == "game:respond":
            self._client.emit_respond(
                accept=data.get("accept", True),
                payment_card_ids=data.get("paymentCardIds"),
            )
        elif event_name == "game:discard":
            self._client.emit_discard(data.get("cardIds", []))
        elif event_name == "game:draw":
            self._client.emit_draw()
        else:
            logger.warning("Unknown event: %s", event_name)

    # ------------------------------------------------------------------
    # Internal: reward shaping
    # ------------------------------------------------------------------

    def _compute_reward(
        self,
        action_idx: int,
        prev_state: dict | None,
        prev_hand: list[dict],
    ) -> float:
        reward = 0.0
        state = self._client.game_state or {}
        my_id = self._client.my_id
        me = next((p for p in state.get("players", []) if p.get("id") == my_id), None)
        if me is None:
            return reward

        current_complete = sum(1 for s in me.get("propertySets", []) if s.get("isComplete"))
        set_delta = current_complete - self._prev_complete_sets
        self._prev_complete_sets = current_complete
        reward += set_delta * self.reward_cfg["set"]

        # Examine what action was taken
        action_dict = None
        for idx, ad in self._candidates:
            if idx == action_idx:
                action_dict = ad
                break

        if action_dict and action_dict.get("type") == "play-card":
            card_id = action_dict.get("cardId")
            card = next((c for c in prev_hand if c.get("id") == card_id), None)
            if card:
                ct = card.get("type")
                if ct in ("property", "property_wildcard"):
                    reward += self.reward_cfg["property"]
                elif ct == "rent":
                    reward += self.reward_cfg["rent"]
                    if action_dict.get("opts", {}).get("doubleTheRentCardIds"):
                        reward += self.reward_cfg["dtr_combo"]
                elif ct == "action" and not action_dict.get("opts", {}).get("asMoney"):
                    reward += self.reward_cfg["action"]

        if action_dict and action_dict.get("type") == "respond-reject":
            reward += self.reward_cfg["jsn_block"]

        if action_dict and action_dict.get("type") == "end-turn":
            actions_remaining = (prev_state or {}).get("actionsRemaining", 0)
            if actions_remaining > 1:
                reward += self.reward_cfg["unused_action_penalty"] * (actions_remaining - 1)

        return reward
