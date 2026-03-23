"""Game constants ported from @monopoly-deal/shared."""

from __future__ import annotations

PROPERTY_COLORS: list[str] = [
    "brown", "blue", "green", "light_blue",
    "orange", "pink", "railroad", "red",
    "yellow", "utility",
]

SET_SIZE: dict[str, int] = {
    "brown": 2, "blue": 2, "green": 3, "light_blue": 3,
    "orange": 3, "pink": 3, "railroad": 4, "red": 3,
    "yellow": 3, "utility": 2,
}

RENT_VALUES: dict[str, list[int]] = {
    "brown":      [1, 2],
    "blue":       [3, 8],
    "green":      [2, 4, 7],
    "light_blue": [1, 2, 3],
    "orange":     [1, 3, 5],
    "pink":       [1, 2, 4],
    "railroad":   [1, 2, 3, 4],
    "red":        [2, 3, 6],
    "yellow":     [2, 4, 6],
    "utility":    [1, 2],
}

ACTION_TYPES: list[str] = [
    "pass_go", "deal_breaker", "just_say_no", "sly_deal",
    "forced_deal", "debt_collector", "its_my_birthday",
    "house", "hotel", "double_the_rent",
]

MONEY_DENOMS: list[int] = [1, 2, 3, 4, 5, 10]

MAX_OPPONENTS = 3

FEATURE_SIZE = 192
MAX_ACTIONS = 95

# Action-space layout indices
IDX_END_TURN = 0
IDX_PLAY_START = 1       # 1..10   play card [0..9] default
IDX_BANK_START = 11      # 11..20  bank card [0..9]
IDX_TARGET_BASE = 21     # 21..50  play card targeting opp 0/1/2 (3 blocks of 10)
IDX_DTR_START = 51       # 51..60  rent + DTR combo
IDX_RESPOND_ACCEPT = 61
IDX_RESPOND_REJECT = 62
IDX_DISCARD_START = 63   # 63..72  discard card [0..9]
IDX_FINISH_PAYMENT = 73  # finish payment
IDX_PAY_START = 74       # 74..83  pay with payable card [0..9]
IDX_REARRANGE_START = 84 # 84..93  rearrange wildcard to color [0..9]
IDX_SKIP_REARRANGE = 94  # skip rearrange

# Reward defaults (mirroring PPOTrainer.ts)
REWARDS = {
    "win": 1.0,
    "lose": -1.0,
    "set": 0.15,
    "property": 0.02,
    "rent": 0.05,
    "action": 0.03,
    "unused_action_penalty": -0.01,
    "jsn_block": 0.10,
    "dtr_combo": 0.08,
}
