"""Port of ActionSpace.ts -- enumerate valid actions, build masks, map to emissions."""

from __future__ import annotations

from typing import Any

import numpy as np

from .constants import (
    IDX_BANK_START,
    IDX_DISCARD_START,
    IDX_DTR_START,
    IDX_END_TURN,
    IDX_PLAY_START,
    IDX_RESPOND_ACCEPT,
    IDX_RESPOND_REJECT,
    IDX_TARGET_BASE,
    MAX_ACTIONS,
    PROPERTY_COLORS,
    RENT_VALUES,
    SET_SIZE,
)

# ── Deterministic hand sorting ───────────────────────────────────────────

_TYPE_ORDER = {"money": 0, "property": 1, "property_wildcard": 2, "rent": 3, "action": 4}
_ACTION_TYPE_ORDER = {
    "pass_go": 0, "deal_breaker": 1, "sly_deal": 2, "forced_deal": 3,
    "debt_collector": 4, "its_my_birthday": 5, "house": 6, "hotel": 7,
    "just_say_no": 8, "double_the_rent": 9,
}
_COLOR_ORDER = {c: i for i, c in enumerate(PROPERTY_COLORS)}


def _card_sort_key(card: dict) -> int:
    ctype = card.get("type", "")
    type_ord = _TYPE_ORDER.get(ctype, 5)
    sub = 0
    if ctype == "money":
        sub = card.get("value", 0)
    elif ctype == "property":
        sub = _COLOR_ORDER.get(card.get("color", ""), 0)
    elif ctype == "property_wildcard":
        sub = _COLOR_ORDER.get(card.get("currentColor", ""), 0)
    elif ctype == "action":
        sub = _ACTION_TYPE_ORDER.get(card.get("actionType", ""), 0)
    elif ctype == "rent":
        colors = card.get("colors", [])
        if colors == "all":
            colors = PROPERTY_COLORS
        sub = _COLOR_ORDER.get(colors[0], 0) if colors else 0
    return type_ord * 1000 + sub


def sort_hand(hand: list[dict]) -> list[dict]:
    return sorted(hand, key=_card_sort_key)


# ── Candidate type ───────────────────────────────────────────────────────

ActionCandidate = tuple[int, dict[str, Any]]  # (index, action_dict)


# ── Helper: count property cards in a set ────────────────────────────────

def _count_prop(pset: dict) -> int:
    return sum(1 for c in pset.get("cards", []) if c.get("type") in ("property", "property_wildcard"))


# ── Play-phase actions ───────────────────────────────────────────────────

def enumerate_play_actions(
    state: dict, hand: list[dict], my_id: str,
) -> list[ActionCandidate]:
    candidates: list[ActionCandidate] = []
    players = state.get("players", [])
    me = next((p for p in players if p.get("id") == my_id), None)
    if me is None:
        return candidates
    opponents = [p for p in players if p.get("id") != my_id]

    candidates.append((IDX_END_TURN, {"type": "end-turn"}))

    sorted_hand = sort_hand(hand)
    max_cards = min(len(sorted_hand), 10)
    has_dtr = any(c.get("type") == "action" and c.get("actionType") == "double_the_rent" for c in sorted_hand)

    for ci in range(max_cards):
        card = sorted_hand[ci]

        # Default play (1..10)
        default = _build_default_play(card, me)
        if default is not None:
            candidates.append((IDX_PLAY_START + ci, default))

        # Bank as money (11..20)
        if card.get("type") not in ("property", "property_wildcard"):
            candidates.append((IDX_BANK_START + ci, {
                "type": "play-card", "cardId": card["id"], "opts": {"asMoney": True},
            }))

        # Per-opponent targeting (21..50)
        if _is_targetable(card):
            for oi in range(min(len(opponents), 3)):
                targeted = _build_targeted_play(card, me, opponents[oi])
                if targeted is not None:
                    candidates.append((IDX_TARGET_BASE + oi * 10 + ci, targeted))

        # DTR combo (51..60)
        if card.get("type") == "rent" and has_dtr:
            dtr_card = next(
                (c for c in sorted_hand if c.get("type") == "action" and c.get("actionType") == "double_the_rent"),
                None,
            )
            if dtr_card and card["id"] != dtr_card["id"] and state.get("actionsRemaining", 0) >= 2:
                rent_dtr = _build_rent_with_dtr(card, me, opponents, dtr_card)
                if rent_dtr is not None:
                    candidates.append((IDX_DTR_START + ci, rent_dtr))

    return candidates


# ── Response-phase actions ───────────────────────────────────────────────

def enumerate_response_actions(
    hand: list[dict], pending: dict,
    state: dict | None = None, my_id: str | None = None,
) -> list[ActionCandidate]:
    payment_ids = _compute_payment(state, my_id, pending.get("amount", 0)) if state and my_id else []
    candidates: list[ActionCandidate] = [
        (IDX_RESPOND_ACCEPT, {"type": "respond-accept", "paymentCardIds": payment_ids}),
    ]
    has_jsn = any(c.get("type") == "action" and c.get("actionType") == "just_say_no" for c in hand)
    if has_jsn:
        candidates.append((IDX_RESPOND_REJECT, {"type": "respond-reject"}))
    return candidates


def _compute_payment(state: dict, my_id: str, amount: int) -> list[str]:
    """Auto-select cheapest cards from bank + incomplete property sets to pay *amount*."""
    me = next((p for p in state.get("players", []) if p.get("id") == my_id), None)
    if me is None or amount <= 0:
        return []

    bank_cards = sorted(me.get("bank", []), key=lambda c: c.get("value", 0))
    prop_cards: list[dict] = []
    for s in me.get("propertySets", []):
        if s.get("isComplete"):
            continue
        for c in s.get("cards", []):
            if c.get("type") == "property_wildcard" and c.get("colors") == "all":
                continue
            prop_cards.append(c)
    prop_cards.sort(key=lambda c: c.get("value", 0))

    all_cards = bank_cards + prop_cards
    selected: list[str] = []
    total = 0
    for card in all_cards:
        if total >= amount:
            break
        selected.append(card["id"])
        total += card.get("value", 0)

    if total < amount:
        for s in me.get("propertySets", []):
            if not s.get("isComplete"):
                continue
            for c in s.get("cards", []):
                if total >= amount:
                    break
                if c.get("type") == "property_wildcard" and c.get("colors") == "all":
                    continue
                cid = c["id"]
                if cid not in selected:
                    selected.append(cid)
                    total += c.get("value", 0)

    return selected


# ── Discard-phase actions ────────────────────────────────────────────────

def enumerate_discard_actions(hand: list[dict]) -> list[ActionCandidate]:
    sorted_hand = sort_hand(hand)
    max_cards = min(len(sorted_hand), 10)
    return [
        (IDX_DISCARD_START + ci, {"type": "discard", "cardId": sorted_hand[ci]["id"]})
        for ci in range(max_cards)
    ]


# ── Mask builder ─────────────────────────────────────────────────────────

def build_valid_mask(candidates: list[ActionCandidate]) -> np.ndarray:
    mask = np.zeros(MAX_ACTIONS, dtype=np.bool_)
    for idx, _ in candidates:
        mask[idx] = True
    return mask


# ── Map action index to socket emission ──────────────────────────────────

def action_to_emission(
    action_idx: int,
    candidates: list[ActionCandidate],
) -> tuple[str, dict[str, Any]] | None:
    """Given an action index chosen by the agent, return (event_name, data) for the socket.

    Returns ``None`` if the index isn't among valid candidates.
    """
    action_dict = None
    for idx, ad in candidates:
        if idx == action_idx:
            action_dict = ad
            break
    if action_dict is None:
        return None

    atype = action_dict["type"]

    if atype == "end-turn":
        return ("game:end-turn", {})

    if atype == "play-card":
        data: dict[str, Any] = {"cardId": action_dict["cardId"]}
        opts = action_dict.get("opts", {})
        if opts.get("asMoney"):
            data["asMoney"] = True
        if opts.get("color"):
            data["color"] = opts["color"]
        if opts.get("targetPlayerId"):
            data["targetPlayerId"] = opts["targetPlayerId"]
        if opts.get("targetCardId"):
            data["targetCardId"] = opts["targetCardId"]
        if opts.get("offeredCardId"):
            data["offeredCardId"] = opts["offeredCardId"]
        if opts.get("targetSetColor"):
            data["targetSetColor"] = opts["targetSetColor"]
        if opts.get("doubleTheRentCardIds"):
            data["doubleTheRentCardIds"] = opts["doubleTheRentCardIds"]
        return ("game:play-card", data)

    if atype == "respond-accept":
        data_resp: dict[str, Any] = {"accept": True}
        pids = action_dict.get("paymentCardIds")
        if pids:
            data_resp["paymentCardIds"] = pids
        return ("game:respond", data_resp)

    if atype == "respond-reject":
        return ("game:respond", {"accept": False})

    if atype == "discard":
        return ("game:discard", {"cardIds": [action_dict["cardId"]]})

    return None


# ── Build helpers ────────────────────────────────────────────────────────

def _pick_best_wildcard_color(card: dict, me: dict) -> str:
    colors = PROPERTY_COLORS if card.get("colors") == "all" else card.get("colors", [])
    best = colors[0] if colors else "brown"
    best_score = -1.0
    for color in colors:
        pset = next(
            (s for s in me.get("propertySets", []) if s.get("color") == color and not s.get("isComplete")),
            None,
        )
        current = _count_prop(pset) if pset else 0
        score = (current + 1) / SET_SIZE[color]
        if score > best_score:
            best_score = score
            best = color
    return best


def _find_best_set_for_upgrade(me: dict, needs_house: bool) -> str | None:
    best_color: str | None = None
    best_rent = 0
    for s in me.get("propertySets", []):
        if not s.get("isComplete") or s.get("color") in ("railroad", "utility"):
            continue
        if needs_house:
            if not s.get("hasHouse") or s.get("hasHotel"):
                continue
        else:
            if s.get("hasHouse"):
                continue
        pc = _count_prop(s)
        rv = RENT_VALUES.get(s["color"], [])
        rent = rv[min(pc, len(rv)) - 1] if rv else 0
        if rent > best_rent:
            best_rent = rent
            best_color = s["color"]
    return best_color


def _build_default_play(card: dict, me: dict) -> dict | None:
    ctype = card.get("type")

    if ctype == "property":
        return {"type": "play-card", "cardId": card["id"], "opts": {}}

    if ctype == "property_wildcard":
        color = _pick_best_wildcard_color(card, me)
        return {"type": "play-card", "cardId": card["id"], "opts": {"color": color}}

    if ctype == "money":
        return {"type": "play-card", "cardId": card["id"], "opts": {}}

    if ctype == "action":
        at = card.get("actionType")
        if at in ("pass_go", "its_my_birthday"):
            return {"type": "play-card", "cardId": card["id"], "opts": {}}
        if at == "house":
            color = _find_best_set_for_upgrade(me, False)
            if color:
                return {"type": "play-card", "cardId": card["id"], "opts": {"color": color}}
            return None
        if at == "hotel":
            color = _find_best_set_for_upgrade(me, True)
            if color:
                return {"type": "play-card", "cardId": card["id"], "opts": {"color": color}}
            return None
        if at in ("just_say_no", "double_the_rent"):
            return None
        return None

    if ctype == "rent":
        return _build_untargeted_rent(card, me)

    return None


def _is_targetable(card: dict) -> bool:
    if card.get("type") == "action":
        return card.get("actionType") in ("debt_collector", "deal_breaker", "sly_deal", "forced_deal")
    if card.get("type") == "rent":
        return card.get("colors") == "all"
    return False


def _build_targeted_play(card: dict, me: dict, target: dict) -> dict | None:
    ctype = card.get("type")

    if ctype == "action":
        at = card.get("actionType")
        if at == "debt_collector":
            return {"type": "play-card", "cardId": card["id"], "opts": {"targetPlayerId": target["id"]}}

        if at == "deal_breaker":
            complete_sets = [s for s in target.get("propertySets", []) if s.get("isComplete")]
            if not complete_sets:
                return None
            best_set = complete_sets[0]
            best_val = 0
            for s in complete_sets:
                pc = _count_prop(s)
                rv = RENT_VALUES.get(s["color"], [])
                val = rv[min(pc, len(rv)) - 1] if rv else 0
                if s.get("hasHouse"):
                    val += 3
                if s.get("hasHotel"):
                    val += 4
                if val > best_val:
                    best_val = val
                    best_set = s
            return {"type": "play-card", "cardId": card["id"], "opts": {
                "targetPlayerId": target["id"], "targetSetColor": best_set["color"],
            }}

        if at == "sly_deal":
            stealable = _find_best_stealable_card(target, me)
            if not stealable:
                return None
            return {"type": "play-card", "cardId": card["id"], "opts": {
                "targetPlayerId": target["id"], "targetCardId": stealable["id"],
            }}

        if at == "forced_deal":
            my_tradeable = _find_worst_tradeable(me)
            if not my_tradeable:
                return None
            their_card = _find_best_stealable_card(target, me)
            if not their_card:
                return None
            return {"type": "play-card", "cardId": card["id"], "opts": {
                "targetPlayerId": target["id"],
                "targetCardId": their_card["id"],
                "offeredCardId": my_tradeable["id"],
            }}

    if ctype == "rent" and card.get("colors") == "all":
        rent_action = _build_untargeted_rent(card, me)
        if not rent_action or rent_action["type"] != "play-card":
            return None
        opts = dict(rent_action.get("opts", {}))
        opts["targetPlayerId"] = target["id"]
        return {"type": "play-card", "cardId": card["id"], "opts": opts}

    return None


def _build_untargeted_rent(card: dict, me: dict) -> dict | None:
    if card.get("type") != "rent":
        return None
    colors = PROPERTY_COLORS if card.get("colors") == "all" else card.get("colors", [])
    best_color: str | None = None
    best_amount = 0
    for color in colors:
        pset = next((s for s in me.get("propertySets", []) if s.get("color") == color), None)
        if not pset or not pset.get("cards"):
            continue
        pc = _count_prop(pset)
        rv = RENT_VALUES.get(color, [])
        rent_idx = min(pc, len(rv)) - 1
        amount = rv[rent_idx] if 0 <= rent_idx < len(rv) else 0
        if pset.get("hasHouse"):
            amount += 3
        if pset.get("hasHotel"):
            amount += 4
        if amount > best_amount:
            best_amount = amount
            best_color = color
    if not best_color or best_amount == 0:
        return None
    return {"type": "play-card", "cardId": card["id"], "opts": {"color": best_color}}


def _build_rent_with_dtr(card: dict, me: dict, opponents: list[dict], dtr_card: dict) -> dict | None:
    base_rent = _build_untargeted_rent(card, me)
    if not base_rent or base_rent["type"] != "play-card":
        return None
    opts = dict(base_rent.get("opts", {}))
    opts["doubleTheRentCardIds"] = [dtr_card["id"]]
    if card.get("type") == "rent" and card.get("colors") == "all":
        richest = _pick_richest_opponent(opponents)
        if richest:
            opts["targetPlayerId"] = richest["id"]
    return {"type": "play-card", "cardId": card["id"], "opts": opts}


def _pick_richest_opponent(opponents: list[dict]) -> dict | None:
    best = None
    best_val = -1
    for opp in opponents:
        val = sum(c.get("value", 0) for c in opp.get("bank", []))
        for s in opp.get("propertySets", []):
            val += sum(c.get("value", 0) for c in s.get("cards", []))
        if val > best_val:
            best_val = val
            best = opp
    return best


def _find_best_stealable_card(target: dict, me: dict) -> dict | None:
    best = None
    best_score = -1.0
    for s in target.get("propertySets", []):
        if s.get("isComplete"):
            continue
        for c in s.get("cards", []):
            if c.get("type") not in ("property", "property_wildcard"):
                continue
            color = c.get("color") if c.get("type") == "property" else c.get("currentColor")
            if not color:
                continue
            my_set = next(
                (ms for ms in me.get("propertySets", []) if ms.get("color") == color and not ms.get("isComplete")),
                None,
            )
            progress = _count_prop(my_set) / SET_SIZE[color] if my_set else 0
            score = progress * 1000 + c.get("value", 0)
            if score > best_score:
                best_score = score
                best = c
    return best


def _find_worst_tradeable(me: dict) -> dict | None:
    worst = None
    worst_score = float("inf")
    for s in me.get("propertySets", []):
        if s.get("isComplete"):
            continue
        pc = _count_prop(s)
        gap = SET_SIZE[s["color"]] - pc
        for c in s.get("cards", []):
            if c.get("type") not in ("property", "property_wildcard"):
                continue
            score = gap * 100 - c.get("value", 0)
            if score < worst_score:
                worst_score = score
                worst = c
    return worst
