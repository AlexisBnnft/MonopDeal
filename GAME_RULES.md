# Monopoly Deal — Game Rules & Implementation Spec

## 1. Overview

**Monopoly Deal** is a card game for **2–5 players** (6+ players possible with 2 decks). The objective is to be the **first player to complete 3 full property sets** on the table.

---

## 2. Deck Composition (110 cards)

### 2.1 Money Cards (20)

| Denomination | Count |
|-------------|-------|
| 1M          | 6     |
| 2M          | 5     |
| 3M          | 3     |
| 4M          | 3     |
| 5M          | 2     |
| 10M         | 1     |

### 2.2 Action Cards (34)

| Card             | Count | Bank Value |
|-----------------|-------|------------|
| Deal Breaker     | 2     | 5M         |
| Just Say No      | 3     | 4M         |
| Pass Go          | 10    | 1M         |
| Forced Deal      | 3     | 3M         |
| Sly Deal         | 3     | 3M         |
| Debt Collector   | 3     | 3M         |
| It's My Birthday | 3     | 2M         |
| Double the Rent  | 2     | 1M         |
| House            | 3     | 3M         |
| Hotel            | 2     | 4M         |

### 2.3 Rent Cards (13)

| Colors              | Count | Bank Value |
|---------------------|-------|------------|
| Dark Blue / Green   | 2     | 1M         |
| Red / Yellow        | 2     | 1M         |
| Pink / Orange       | 2     | 1M         |
| Light Blue / Brown  | 2     | 1M         |
| Railroad / Utility  | 2     | 1M         |
| Wild (all 10 colors)| 3     | 3M         |

### 2.4 Property Cards (28)

| Color       | Count | Set Size |
|-------------|-------|----------|
| Dark Blue   | 2     | 2        |
| Brown       | 2     | 2        |
| Utility     | 2     | 2        |
| Green       | 3     | 3        |
| Yellow      | 3     | 3        |
| Red         | 3     | 3        |
| Orange      | 3     | 3        |
| Pink        | 3     | 3        |
| Light Blue  | 3     | 3        |
| Railroad    | 4     | 4        |

### 2.5 Property Wildcards (11)

| Colors                          | Count |
|---------------------------------|-------|
| Dark Blue / Green               | 1     |
| Green / Railroad                | 1     |
| Utility / Railroad              | 1     |
| Light Blue / Railroad           | 1     |
| Light Blue / Brown              | 1     |
| Pink / Orange                   | 2     |
| Red / Yellow                    | 2     |
| Multicolor (all 10 colors)      | 2     |

### 2.6 Quick Start Rule Cards (4)

These are removed from the deck before play and are not used during the game.

---

## 3. Property Sets & Rent Values

Each property card specifies the color and how many cards are needed to complete that color set. Rent values scale with the number of cards of that color a player has on the table.

| Color       | Set Size | Rent (1 card) | Rent (2 cards) | Rent (3 cards) | Rent (4 cards) |
|-------------|----------|---------------|----------------|----------------|----------------|
| Brown       | 2        | 1M            | 2M             | —              | —              |
| Light Blue  | 3        | 1M            | 2M             | 3M             | —              |
| Pink        | 3        | 1M            | 2M             | 4M             | —              |
| Orange      | 3        | 1M            | 3M             | 5M             | —              |
| Red         | 3        | 2M            | 3M             | 6M             | —              |
| Yellow      | 3        | 2M            | 4M             | 6M             | —              |
| Green       | 3        | 2M            | 4M             | 7M             | —              |
| Dark Blue   | 2        | 3M            | 8M             | —              | —              |
| Utility     | 2        | 1M            | 2M             | —              | —              |
| Railroad    | 4        | 1M            | 2M             | 3M             | 4M             |

> **House bonus:** +3M rent on a completed set.
> **Hotel bonus:** +4M rent on a completed set (on top of the House bonus, for a total of +7M).

---

## 4. Game Setup

1. Remove the 4 "Quick Start Rules" cards from the deck.
2. Shuffle the remaining 106 cards.
3. Deal **5 cards** to each player face down.
4. Place the remaining deck face down in the center as the **draw pile**.
5. Players pick up their cards without revealing them to others.

---

## 5. Turn Structure

Play proceeds **clockwise**. On each turn a player performs these steps in order:

### 5.1 Draw Phase

- Draw **2 cards** from the draw pile.
- **Exception:** if the player has **0 cards in hand** at the start of their turn, they draw **5 cards** instead.

### 5.2 Action Phase

- Play **up to 3 cards** from your hand. Each card placed on the table counts as 1 play.
- You are **not required** to play all 3 cards.
- Cards can be played to one of three zones (see Section 6).

### 5.3 Discard Phase (End of Turn)

- If you have **more than 7 cards** in hand after all plays, discard the excess into the discard pile.
- Maximum hand size at end of turn: **7 cards**.

### 5.4 Win Check

- After the discard phase, if the current player has **3 or more completed property sets** on the table, they win immediately.

---

## 6. Zones / Play Areas

There are three zones where cards can be placed:

### 6.1 Bank (personal)

- Face-up pile in front of the player.
- Accepts: **Money cards**, **Action cards** (banked for their monetary value), **Rent cards** (banked for value).
- Does **not** accept: Property cards.
- Every non-property card has a monetary value printed in its corner.
- Cards in the bank are used to pay other players.
- Opponents may **not** touch or look through your bank pile.

### 6.2 Property Area (personal)

- Face-up cards organized by color set in front of the player.
- Accepts: **Property cards**, **Property Wildcards**, **Houses**, **Hotels**.
- Opponents may **not** touch or look through your property cards.

### 6.3 Discard Pile (shared, center)

- Face-up pile in the center.
- Action cards are discarded here when played for their effect.
- Excess hand cards at end of turn go here.
- When the draw pile is empty, shuffle the discard pile to form a new draw pile.

---

## 7. Card Types & Detailed Rules

### 7.1 Money Cards

- Played into your **bank**.
- Used solely to pay rent, debts, and birthday charges.
- No change is ever given when overpaying.

### 7.2 Property Cards

- Played into your **property area** face up.
- Organized by color to form sets.
- Cannot be placed in the bank.
- Cannot be returned to your hand once played.

### 7.3 Property Wildcards (2-color)

- Can count as **either** of the two colors printed on the card.
- Can be **rearranged** between sets freely, but **only during your own turn**.
- Can be stolen via Sly Deal or Force Deal if **not** part of a completed set.
- If part of a completed set, can only be taken via Deal Breaker (with the whole set).

### 7.4 Multicolor Property Wildcard (10-color)

- Can represent **any** color.
- Can be rearranged freely during your turn.
- Has **no monetary value** — cannot be used to pay debts.
- **Cannot charge rent** against it alone; must be paired with at least one other property card in the same set.
- Can be stolen via Sly Deal or Force Deal if not part of a completed set.
- Can be taken via Deal Breaker as part of a completed set.

### 7.5 Pass Go

- **Effect:** Draw 2 cards from the draw pile.
- Discarded into the center after use.
- Multiple Pass Go cards can be played in a single turn (each counts as 1 of your 3 plays).
- The 7-card hand limit still applies at end of turn.

### 7.6 Sly Deal

- **Effect:** Steal one property card (including property wildcards) from any opponent.
- The target property must **not** be part of a completed set.
- Cannot steal Houses or Hotels that are on completed sets.
- Can steal a House or Hotel that is on the table but not attached to a completed set.
- Discarded into the center after use.
- Can be countered with Just Say No.

### 7.7 Forced Deal

- **Effect:** Swap one of your properties for one of an opponent's properties.
- Neither property needs to be of equal value.
- Target property must **not** be part of a completed set.
- Cannot target Houses or Hotels on completed sets, but can target orphaned Houses/Hotels.
- Discarded into the center after use.
- Can be countered with Just Say No.
- When receiving a property from a Force Deal, you may rearrange it into your sets.

### 7.8 Debt Collector

- **Effect:** Force **one** chosen opponent to pay you **5M**.
- Discarded into the center after use.
- Can be countered with Just Say No.

### 7.9 It's My Birthday

- **Effect:** **All** other players must pay you **2M** each.
- Discarded into the center after use.
- Each opponent can individually counter with Just Say No (only negates payment for that opponent).

### 7.10 Deal Breaker

- **Effect:** Steal an entire **completed property set** from an opponent, including any Houses and Hotels attached to it.
- If played against a player who does not have a completed set, the card is wasted (discarded with no effect) and still counts as a play.
- Discarded into the center after use.
- Can be countered with Just Say No.

### 7.11 Rent Cards (Dual-Color)

- **Effect:** Charge rent to **all** other players for one of the two colors shown on the card.
- You must own at least one property of the chosen color.
- Rent amount is determined by how many cards of that color you have (see rent table in Section 3).
- Discarded into the center after use.
- Each opponent can individually counter with Just Say No.

### 7.12 Rent Cards (Wild / All Colors)

- **Effect:** Charge rent to **one** chosen opponent for any single color you own.
- You must own at least one property of the chosen color.
- Discarded into the center after use.
- Can be countered with Just Say No.

### 7.13 Double the Rent

- **Must** be played together with a Rent card on the same turn.
- **Effect:** Doubles the rent amount charged.
- Counts as **1 of your 3 plays** (so Rent + Double the Rent = 2 plays).
- Two Double the Rent cards can be stacked (Rent + 2× Double = 3 plays, rent is quadrupled).
- If countered by Just Say No, only the Double the Rent is negated — the base rent still applies.
- Discarded into the center after use.

### 7.14 House

- Played on a **completed property set** only.
- Adds **+3M** to the rent value of that set.
- Cannot be placed on Railroad or Utility sets.
- If the completed set is later broken up (e.g., you pay with one of its properties), the House remains on the table as an orphaned card until you complete another eligible set.
- Orphaned Houses can be stolen via Sly Deal or Force Deal.
- A House on a completed set can only be stolen via Deal Breaker (with the entire set).

### 7.15 Hotel

- Played on a **completed property set that already has a House**.
- Adds **+4M** to the rent value of that set (total bonus with House: **+7M**).
- Cannot be placed on Railroad or Utility sets.
- Same orphan and stealing rules as House.

### 7.16 Just Say No

- **Effect:** Cancels any action card played against you (Rent, Sly Deal, Force Deal, Deal Breaker, Debt Collector, It's My Birthday, Double the Rent).
- **Does NOT count** as one of your 3 plays per turn.
- Can be played **during any player's turn** (it is a reaction card).
- Can be countered by **another Just Say No**, which re-enables the original action. This chain can continue as long as players have Just Say No cards.
- Discarded into the center after use.
- When played against a multi-target action (e.g., It's My Birthday or dual-color Rent), it only negates the action **for the player who played it**, not for all targets.

---

## 8. Payment Rules

### 8.1 What Can You Pay With

- Any cards **on the table** in front of you: money from your bank, property cards, action cards in your bank, Houses, Hotels.
- You **cannot** pay with cards in your hand.

### 8.2 Who Chooses

- The **paying player** decides which cards to use for payment.

### 8.3 No Change Given

- If the total value of cards paid exceeds the amount owed, the receiving player keeps the overpayment. No change is returned.

### 8.4 Where Do Paid Cards Go

- **Money / Action cards** paid go into the opponent's **bank**.
- **Property cards** paid go into the opponent's **property area** (property always stays as property).
- **Houses / Hotels** paid go into the opponent's property area (they function as orphaned improvements until placed on a set).

### 8.5 Insufficient Funds

- If a player cannot pay the full amount, they pay everything they can from the table. The remaining debt is forgiven.
- If a player has **no cards on the table**, they pay nothing.

### 8.6 Action Cards Used as Payment

- If an action card was in a player's bank and is used to pay another player, it goes to the opponent's **bank** as money. The opponent **cannot** use it as an action.

---

## 9. Property Set Completion Rules

- A set is **complete** when it contains exactly the number of cards specified for that color (see Section 3).
- **Duplicate sets:** You can complete multiple sets of the same color. Each counts toward the 3-set win condition.
- If you have **more property cards** of one color than needed (due to wildcards), the extras must form a **new set** of that color or be flipped to another color.
- The maximum number of cards in a single set equals the required set size for that color.

---

## 10. Card Rearrangement

- You may **freely rearrange** your property cards and wildcards during **your own turn**.
- You may **not** rearrange during another player's turn, except when receiving a property via Forced Deal (you may place that card where you like).
- Once your turn ends, your layout is locked until your next turn.
- A card played to the table **cannot** be returned to your hand. "A card laid is a card played."

---

## 11. Draw Pile Exhaustion

- When the draw pile runs out, shuffle the discard pile and place it face down as the new draw pile.

---

## 12. Empty Hand Rule

- If a player runs out of cards in their hand **during their turn**, they must wait until their next turn.
- On their next turn, they draw **5 cards** instead of the usual 2.
- Until then, they have no cards in hand to defend with (no Just Say No available).

---

## 13. Misplay Rules

- "A card laid is a card played." No take-backs unless all opponents agree.
- Accidentally drawn extra cards should be reshuffled into the draw pile.

---

## 14. Multi-Deck Play (6+ Players)

- For 6+ players, shuffle 2 complete decks together.
- Optionally increase the win condition (e.g., 5 completed sets instead of 3).
- Cards can be added or removed to customize difficulty.

---

## 15. Implementation Notes

### 15.1 State Model

Each game state should track:

- **Draw pile** (ordered list of cards)
- **Discard pile** (ordered list of cards)
- **Per player:**
  - Hand (hidden from other players)
  - Bank (visible, but only top card should be revealed to opponents per strategy norms — implementation may show all to the owning player)
  - Property area (visible, grouped by color set)
  - Number of plays remaining this turn (max 3)

### 15.2 Turn Flow (State Machine)

```
GAME_START
  → DEAL_INITIAL_HANDS
  → PLAYER_TURN_START
    → DRAW_PHASE (draw 2, or 5 if hand was empty)
    → ACTION_PHASE (loop: play 0–3 cards)
      → resolve card effect
      → allow Just Say No chain if applicable
      → check win condition after each play
    → DISCARD_PHASE (discard down to 7)
    → WIN_CHECK
      → if 3 complete sets → GAME_OVER
      → else → next player's PLAYER_TURN_START
```

### 15.3 Action Resolution Priority

1. Active player plays an action card targeting opponent(s).
2. Each targeted opponent may respond with Just Say No.
3. Active player may counter the Just Say No with their own Just Say No.
4. Chain continues until one side has no more Just Say No cards or chooses not to play one.
5. Resolve the final outcome (action succeeds or is canceled).

### 15.4 Validation Rules (enforce at play time)

| Action              | Validation                                                                 |
|---------------------|---------------------------------------------------------------------------|
| Play property       | Card must be a property or wildcard; placed in property area              |
| Play money          | Card must be money or bankable action; placed in bank                     |
| Sly Deal            | Target property must not be in a completed set                            |
| Force Deal          | Neither swapped property can be in a completed set                        |
| Deal Breaker        | Target must be a completed set (if not, card is wasted)                   |
| Rent (dual-color)   | Player must own ≥1 property of the chosen color                          |
| Rent (wild)         | Player must own ≥1 property of the chosen color; must choose 1 opponent  |
| Double the Rent     | Must be played alongside a Rent card in the same turn                     |
| House               | Must be placed on a completed set (not Railroad/Utility)                  |
| Hotel               | Must be placed on a completed set that already has a House (not Railroad/Utility) |
| Just Say No         | Can only be played in response to an action targeting you; does not count as a play |
| Discard             | Only required if hand > 7 at end of turn                                  |

### 15.5 Key Edge Cases

1. **Multicolor wildcard has 0M value** — cannot be used for payment, cannot have rent charged against it alone.
2. **Orphaned House/Hotel** — remains on table if its completed set is broken; can be stolen individually; must be placed on a new completed set when available.
3. **Just Say No chains** — unlimited depth; all 3 (or 6 with 2 decks) can be used in a single exchange.
4. **Deal Breaker on no completed set** — card is wasted, still counts as a play.
5. **Pass Go + hand limit** — drawing cards via Pass Go can push you over 7; you must discard at end of turn.
6. **Double the Rent + Just Say No** — negates only the doubling; base rent still applies.
7. **Paying with property** — property paid goes to opponent's property area, not bank.
8. **No change given** — overpayment is kept by the recipient.
9. **No cards on table** — if a player has nothing on the table, they pay nothing when charged.
10. **Same-color duplicate sets** — valid for the 3-set win condition.
