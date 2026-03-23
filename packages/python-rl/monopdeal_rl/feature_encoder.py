"""Port of FeatureEncoder.ts -- encodes GameState + hand into a flat numpy vector."""

from __future__ import annotations

import numpy as np

from .constants import (
    ACTION_TYPES,
    FEATURE_SIZE,
    MAX_OPPONENTS,
    MONEY_DENOMS,
    PROPERTY_COLORS,
    SET_SIZE,
)


def _find_player(players: list[dict], pid: str) -> dict | None:
    for p in players:
        if p.get("id") == pid:
            return p
    return None


def _count_prop_cards(pset: dict) -> int:
    return sum(
        1 for c in pset.get("cards", [])
        if c.get("type") in ("property", "property_wildcard")
    )


def encode_state(
    state: dict,
    hand: list[dict],
    my_id: str,
) -> np.ndarray:
    """Encode game state + private hand into a (FEATURE_SIZE,) float32 vector.

    This is a faithful port of the TypeScript ``encodeState`` function.
    """
    features = np.zeros(FEATURE_SIZE, dtype=np.float32)
    idx = 0

    # ── Hand composition (36 features) ───────────────────────────────
    money_count: dict[int, int] = {d: 0 for d in MONEY_DENOMS}
    prop_count: dict[str, int] = {c: 0 for c in PROPERTY_COLORS}
    action_count: dict[str, int] = {a: 0 for a in ACTION_TYPES}
    rent_count: dict[str, int] = {c: 0 for c in PROPERTY_COLORS}

    for card in hand:
        ctype = card.get("type")
        if ctype == "money":
            d = card["value"] if card["value"] in MONEY_DENOMS else 1
            money_count[d] = money_count.get(d, 0) + 1
        elif ctype == "property":
            color = card["color"]
            prop_count[color] = prop_count.get(color, 0) + 1
        elif ctype == "property_wildcard":
            color = card.get("currentColor") or (
                "brown" if card.get("colors") == "all" else card["colors"][0]
            )
            prop_count[color] = prop_count.get(color, 0) + 1
        elif ctype == "action":
            at = card["actionType"]
            action_count[at] = action_count.get(at, 0) + 1
        elif ctype == "rent":
            colors = PROPERTY_COLORS if card.get("colors") == "all" else card["colors"]
            for c in colors:
                rent_count[c] = rent_count.get(c, 0) + 1

    for d in MONEY_DENOMS:
        features[idx] = money_count[d] / 3
        idx += 1
    for c in PROPERTY_COLORS:
        features[idx] = prop_count[c] / 3
        idx += 1
    for a in ACTION_TYPES:
        features[idx] = action_count[a] / 2
        idx += 1
    for c in PROPERTY_COLORS:
        features[idx] = rent_count[c] / 2
        idx += 1

    # ── My board (24 features) ───────────────────────────────────────
    players = state.get("players", [])
    me = _find_player(players, my_id)
    if me is None:
        return features

    my_sets: list[dict] = me.get("propertySets", [])

    for color in PROPERTY_COLORS:
        pset = next((s for s in my_sets if s.get("color") == color), None)
        pc = _count_prop_cards(pset) if pset else 0
        features[idx] = pc / SET_SIZE[color]
        idx += 1

    for color in PROPERTY_COLORS:
        pset = next((s for s in my_sets if s.get("color") == color), None)
        features[idx] = 1.0 if (pset and pset.get("isComplete")) else 0.0
        idx += 1

    bank_value = sum(c.get("value", 0) for c in me.get("bank", []))
    features[idx] = min(bank_value / 20, 1.0)
    idx += 1
    features[idx] = min(len(me.get("bank", [])) / 10, 1.0)
    idx += 1
    complete_sets = sum(1 for s in my_sets if s.get("isComplete"))
    features[idx] = complete_sets / 3
    idx += 1
    features[idx] = 1.0 if any(s.get("hasHouse") for s in my_sets) else 0.0
    idx += 1

    # ── Opponents (14 x 3 = 42 features) ─────────────────────────────
    opponents = [p for p in players if p.get("id") != my_id]
    for oi in range(MAX_OPPONENTS):
        if oi >= len(opponents):
            idx += 14
            continue
        opp = opponents[oi]
        opp_sets: list[dict] = opp.get("propertySets", [])

        for color in PROPERTY_COLORS:
            pset = next((s for s in opp_sets if s.get("color") == color), None)
            pc = _count_prop_cards(pset) if pset else 0
            features[idx] = pc / SET_SIZE[color]
            idx += 1

        features[idx] = sum(1 for s in opp_sets if s.get("isComplete")) / 3
        idx += 1
        opp_bank = sum(c.get("value", 0) for c in opp.get("bank", []))
        features[idx] = min(opp_bank / 20, 1.0)
        idx += 1
        features[idx] = min(opp.get("handCount", 0) / 10, 1.0)
        idx += 1

        max_progress = 0.0
        for s in opp_sets:
            if s.get("isComplete"):
                max_progress = 1.0
                break
            pc = _count_prop_cards(s)
            progress = pc / SET_SIZE[s["color"]]
            if progress > max_progress:
                max_progress = progress
        features[idx] = max_progress
        idx += 1

    # ── Turn context (14 features) ───────────────────────────────────
    features[idx] = state.get("actionsRemaining", 0) / 3
    idx += 1
    features[idx] = min(state.get("turnNumber", 0) / 40, 1.0)
    idx += 1
    features[idx] = len(hand) / 10
    idx += 1

    phases = ["draw", "action", "discard", "waiting"]
    tp = state.get("turnPhase")
    for p in phases:
        features[idx] = 1.0 if tp == p else 0.0
        idx += 1

    pa_types = ["rent", "debt_collector", "its_my_birthday", "deal_breaker", "sly_deal", "forced_deal"]
    pa = state.get("pendingAction")
    features[idx] = 0.0 if pa else 1.0
    idx += 1
    for t in pa_types:
        features[idx] = 1.0 if (pa and pa.get("type") == t) else 0.0
        idx += 1

    # ── PPO features ─────────────────────────────────────────────────
    dtr_count = sum(1 for c in hand if c.get("type") == "action" and c.get("actionType") == "double_the_rent")
    features[idx] = min(dtr_count / 2, 1.0)
    idx += 1

    jsn_count = sum(1 for c in hand if c.get("type") == "action" and c.get("actionType") == "just_say_no")
    features[idx] = min(jsn_count / 2, 1.0)
    idx += 1

    # Pending action details (6)
    features[idx] = min((pa.get("amount", 0) or 0) / 10, 1.0) if pa else 0.0
    idx += 1
    if pa:
        src_idx = -1
        for i, o in enumerate(opponents):
            if o.get("id") == pa.get("sourcePlayerId"):
                src_idx = i
                break
        for i in range(MAX_OPPONENTS):
            features[idx] = 1.0 if src_idx == i else 0.0
            idx += 1
    else:
        idx += MAX_OPPONENTS

    features[idx] = 1.0 if (pa and pa.get("type") == "deal_breaker" and any(s.get("isComplete") for s in my_sets)) else 0.0
    idx += 1
    targets_near_complete = False
    if pa and pa.get("type") in ("sly_deal", "forced_deal"):
        for s in my_sets:
            if not s.get("isComplete") and _count_prop_cards(s) >= SET_SIZE[s["color"]] - 1:
                targets_near_complete = True
                break
    features[idx] = 1.0 if targets_near_complete else 0.0
    idx += 1

    # Deck remaining (1)
    features[idx] = min(state.get("drawPileCount", 0) / 40, 1.0)
    idx += 1

    # Turn position (1)
    my_player_idx = next((i for i, p in enumerate(players) if p.get("id") == my_id), 0)
    features[idx] = my_player_idx / max(len(players) - 1, 1)
    idx += 1

    # Am I the current player? (1)
    features[idx] = 1.0 if state.get("currentPlayerIndex") == my_player_idx else 0.0
    idx += 1

    # ── Payment-phase features (4) ───────────────────────────────────
    # Not used in the WebSocket env (payment is handled server-side), but kept
    # for feature-vector compatibility with the TS encoder. Always zero here.
    idx += 4

    # ── Rearrangeable wildcards on board (1) ─────────────────────────
    rearrangeable = 0
    for s in my_sets:
        for c in s.get("cards", []):
            if c.get("type") == "property_wildcard":
                rearrangeable += 1
    features[idx] = min(rearrangeable / 3, 1.0)
    idx += 1

    return features
