import type {
  AnyCard, MoneyCard, PropertyCard, WildcardCard,
  ActionCard, RentCard, PropertyColor, ActionType,
} from '@monopoly-deal/shared';

let cardCounter = 0;
function nextId(): string {
  return `card_${++cardCounter}`;
}

function money(value: number): MoneyCard {
  return { id: nextId(), type: 'money', name: `${value}M`, value };
}

function property(name: string, color: PropertyColor, value: number): PropertyCard {
  return { id: nextId(), type: 'property', name, color, value };
}

function wildcard(colors: [PropertyColor, PropertyColor] | 'all', value: number): WildcardCard {
  const name = colors === 'all'
    ? 'Wild Property'
    : `Wild ${colors[0]}/${colors[1]}`;
  return {
    id: nextId(), type: 'property_wildcard', name, colors, value,
    currentColor: colors === 'all' ? 'brown' : colors[0],
  };
}

function action(name: string, actionType: ActionType, value: number): ActionCard {
  return { id: nextId(), type: 'action', name, actionType, value };
}

function rent(colors: [PropertyColor, PropertyColor] | 'all', value: number): RentCard {
  const name = colors === 'all'
    ? 'Wild Rent'
    : `Rent ${colors[0]}/${colors[1]}`;
  return { id: nextId(), type: 'rent', name, colors, value };
}

function repeat<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, fn);
}

export function buildDeck(): AnyCard[] {
  cardCounter = 0;
  const cards: AnyCard[] = [];

  // ─── Money (20 cards) ───────────────────────────────────────────────
  cards.push(...repeat(6, () => money(1)));
  cards.push(...repeat(5, () => money(2)));
  cards.push(...repeat(3, () => money(3)));
  cards.push(...repeat(3, () => money(4)));
  cards.push(...repeat(2, () => money(5)));
  cards.push(money(10));

  // ─── Properties (28 cards) ──────────────────────────────────────────
  // Brown (2)
  cards.push(property('Mediterranean Ave', 'brown', 1));
  cards.push(property('Baltic Ave', 'brown', 1));
  // Blue (2)
  cards.push(property('Park Place', 'blue', 4));
  cards.push(property('Boardwalk', 'blue', 4));
  // Green (3)
  cards.push(property('Pacific Ave', 'green', 4));
  cards.push(property('North Carolina Ave', 'green', 4));
  cards.push(property('Pennsylvania Ave', 'green', 4));
  // Light Blue (3)
  cards.push(property('Oriental Ave', 'light_blue', 1));
  cards.push(property('Vermont Ave', 'light_blue', 1));
  cards.push(property('Connecticut Ave', 'light_blue', 1));
  // Orange (3)
  cards.push(property('St. James Place', 'orange', 2));
  cards.push(property('Tennessee Ave', 'orange', 2));
  cards.push(property('New York Ave', 'orange', 2));
  // Pink (3)
  cards.push(property('St. Charles Place', 'pink', 2));
  cards.push(property('States Ave', 'pink', 2));
  cards.push(property('Virginia Ave', 'pink', 2));
  // Railroad (4)
  cards.push(property('Reading Railroad', 'railroad', 2));
  cards.push(property('Pennsylvania Railroad', 'railroad', 2));
  cards.push(property('B&O Railroad', 'railroad', 2));
  cards.push(property('Short Line', 'railroad', 2));
  // Red (3)
  cards.push(property('Kentucky Ave', 'red', 3));
  cards.push(property('Indiana Ave', 'red', 3));
  cards.push(property('Illinois Ave', 'red', 3));
  // Yellow (3)
  cards.push(property('Atlantic Ave', 'yellow', 3));
  cards.push(property('Ventnor Ave', 'yellow', 3));
  cards.push(property('Marvin Gardens', 'yellow', 3));
  // Utility (2)
  cards.push(property('Electric Company', 'utility', 2));
  cards.push(property('Water Works', 'utility', 2));

  // ─── Property Wildcards (11 cards) ──────────────────────────────────
  cards.push(...repeat(2, () => wildcard('all', 0)));
  cards.push(wildcard(['green', 'railroad'], 4));
  cards.push(wildcard(['light_blue', 'railroad'], 4));
  cards.push(wildcard(['light_blue', 'brown'], 1));
  cards.push(...repeat(2, () => wildcard(['orange', 'pink'], 2)));
  cards.push(...repeat(2, () => wildcard(['red', 'yellow'], 3)));
  cards.push(wildcard(['railroad', 'utility'], 2));
  cards.push(wildcard(['green', 'blue'], 4));

  // ─── Action Cards (34 cards) ────────────────────────────────────────
  cards.push(...repeat(10, () => action('Pass Go', 'pass_go', 1)));
  cards.push(...repeat(2, () => action('Deal Breaker', 'deal_breaker', 5)));
  cards.push(...repeat(3, () => action('Just Say No', 'just_say_no', 4)));
  cards.push(...repeat(3, () => action('Sly Deal', 'sly_deal', 3)));
  cards.push(...repeat(4, () => action('Forced Deal', 'forced_deal', 3)));
  cards.push(...repeat(3, () => action('Debt Collector', 'debt_collector', 3)));
  cards.push(...repeat(3, () => action("It's My Birthday", 'its_my_birthday', 2)));
  cards.push(...repeat(3, () => action('House', 'house', 3)));
  cards.push(...repeat(2, () => action('Hotel', 'hotel', 4)));
  cards.push(...repeat(2, () => action('Double The Rent', 'double_the_rent', 1)));

  // ─── Rent Cards (13 cards) ──────────────────────────────────────────
  cards.push(...repeat(3, () => rent('all', 3)));
  cards.push(...repeat(2, () => rent(['green', 'blue'], 1)));
  cards.push(...repeat(2, () => rent(['brown', 'light_blue'], 1)));
  cards.push(...repeat(2, () => rent(['orange', 'pink'], 1)));
  cards.push(...repeat(2, () => rent(['railroad', 'utility'], 1)));
  cards.push(...repeat(2, () => rent(['red', 'yellow'], 1)));

  return cards; // 106 cards total
}

export function shuffleDeck(deck: AnyCard[]): AnyCard[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
