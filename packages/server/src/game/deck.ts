import type {
  AnyCard, MoneyCard, PropertyCard, WildcardCard,
  ActionCard, RentCard, PropertyColor, ActionType,
} from '@monopoly-deal/shared';
import { COLOR_NAMES } from '@monopoly-deal/shared';

let cardCounter = 0;
function nextId(): string {
  return `card_${++cardCounter}`;
}

function money(value: number): MoneyCard {
  return {
    id: nextId(), type: 'money',
    name: `${value}M`,
    description: `Billet de ${value}M. A placer dans la banque.`,
    value,
  };
}

function property(name: string, color: PropertyColor, value: number): PropertyCard {
  return {
    id: nextId(), type: 'property',
    name, color, value,
    description: `Propriete ${COLOR_NAMES[color]}. Valeur : ${value}M.`,
  };
}

function wildcard(colors: [PropertyColor, PropertyColor] | 'all', value: number): WildcardCard {
  const name = colors === 'all'
    ? 'Property Wildcard'
    : `Wildcard ${COLOR_NAMES[colors[0]]}/${COLOR_NAMES[colors[1]]}`;
  const desc = colors === 'all'
    ? 'Se place sur n\'importe quelle couleur. Peut etre deplace a tout moment.'
    : `Se place sur un set ${COLOR_NAMES[colors[0]]} ou ${COLOR_NAMES[colors[1]]}. Peut etre retourne.`;
  return {
    id: nextId(), type: 'property_wildcard',
    name, description: desc, colors, value,
    currentColor: colors === 'all' ? 'brown' : colors[0],
  };
}

function action(name: string, actionType: ActionType, value: number, description: string): ActionCard {
  return { id: nextId(), type: 'action', name, description, actionType, value };
}

function rent(colors: [PropertyColor, PropertyColor] | 'all', value: number): RentCard {
  const name = colors === 'all'
    ? 'Wild Rent'
    : `Rent ${COLOR_NAMES[colors[0]]}/${COLOR_NAMES[colors[1]]}`;
  const desc = colors === 'all'
    ? 'Un joueur au choix te paye le loyer d\'une couleur que tu possedes.'
    : `Tous les joueurs te payent le loyer de tes proprietes ${COLOR_NAMES[colors[0]]} ou ${COLOR_NAMES[colors[1]]}.`;
  return { id: nextId(), type: 'rent', name, description: desc, colors, value };
}

function repeat<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, fn);
}

export function buildDeck(): AnyCard[] {
  cardCounter = 0;
  const cards: AnyCard[] = [];

  // ─── Money (20 cards) ─────────────────────────────────────────────
  cards.push(...repeat(6, () => money(1)));
  cards.push(...repeat(5, () => money(2)));
  cards.push(...repeat(3, () => money(3)));
  cards.push(...repeat(3, () => money(4)));
  cards.push(...repeat(2, () => money(5)));
  cards.push(money(10));

  // ─── Properties (28 cards) ────────────────────────────────────────
  cards.push(property('Boulevard de Belleville', 'brown', 1));
  cards.push(property('Rue Lecourbe', 'brown', 1));
  cards.push(property('Rue de la Paix', 'blue', 4));
  cards.push(property('Avenue des Champs-Elysees', 'blue', 4));
  cards.push(property('Avenue de Breteuil', 'green', 4));
  cards.push(property('Avenue Foch', 'green', 4));
  cards.push(property('Boulevard des Capucines', 'green', 4));
  cards.push(property('Rue de Vaugirard', 'light_blue', 1));
  cards.push(property('Rue de Courcelles', 'light_blue', 1));
  cards.push(property('Avenue de la Republique', 'light_blue', 1));
  cards.push(property('Boulevard Saint-Michel', 'orange', 2));
  cards.push(property('Place Pigalle', 'orange', 2));
  cards.push(property('Boulevard de la Madeleine', 'orange', 2));
  cards.push(property('Boulevard de la Villette', 'pink', 2));
  cards.push(property('Avenue de Neuilly', 'pink', 2));
  cards.push(property('Rue de Paradis', 'pink', 2));
  cards.push(property('Gare Montparnasse', 'railroad', 2));
  cards.push(property('Gare de Lyon', 'railroad', 2));
  cards.push(property('Gare du Nord', 'railroad', 2));
  cards.push(property('Gare Saint-Lazare', 'railroad', 2));
  cards.push(property('Avenue Henri-Martin', 'red', 3));
  cards.push(property('Boulevard Malesherbes', 'red', 3));
  cards.push(property('Avenue Mozart', 'red', 3));
  cards.push(property('Rue La Fayette', 'yellow', 3));
  cards.push(property('Avenue Matignon', 'yellow', 3));
  cards.push(property('Place de la Bourse', 'yellow', 3));
  cards.push(property('Compagnie d\'Electricite', 'utility', 2));
  cards.push(property('Compagnie des Eaux', 'utility', 2));

  // ─── Property Wildcards (11 cards) ────────────────────────────────
  cards.push(...repeat(2, () => wildcard('all', 0)));
  cards.push(wildcard(['green', 'railroad'], 4));
  cards.push(wildcard(['light_blue', 'railroad'], 4));
  cards.push(wildcard(['light_blue', 'brown'], 1));
  cards.push(...repeat(2, () => wildcard(['orange', 'pink'], 2)));
  cards.push(...repeat(2, () => wildcard(['red', 'yellow'], 3)));
  cards.push(wildcard(['railroad', 'utility'], 2));
  cards.push(wildcard(['green', 'blue'], 4));

  // ─── Action Cards (34 cards) — Fix 1: forced_deal 3 not 4 ────────
  cards.push(...repeat(10, () => action(
    'Pass Go', 'pass_go', 1,
    'Piochez 2 cartes supplementaires.',
  )));
  cards.push(...repeat(2, () => action(
    'Deal Breaker', 'deal_breaker', 5,
    'Volez un set complet de proprietes a un adversaire !',
  )));
  cards.push(...repeat(3, () => action(
    'Just Say No', 'just_say_no', 4,
    'Annulez une action jouee contre vous. Peut etre contre par un autre "Non merci !".',
  )));
  cards.push(...repeat(3, () => action(
    'Sly Deal', 'sly_deal', 3,
    'Volez une propriete d\'un set INCOMPLET d\'un adversaire.',
  )));
  cards.push(...repeat(3, () => action(
    'Forced Deal', 'forced_deal', 3,
    'Echangez une de vos proprietes avec celle d\'un adversaire (sets incomplets uniquement).',
  )));
  cards.push(...repeat(3, () => action(
    'Debt Collector', 'debt_collector', 3,
    'Un joueur de votre choix vous doit 5M.',
  )));
  cards.push(...repeat(3, () => action(
    "It's My Birthday", 'its_my_birthday', 2,
    'Tous les joueurs vous donnent 2M chacun.',
  )));
  cards.push(...repeat(3, () => action(
    'House', 'house', 3,
    'Ajoutez a un set complet. Le loyer augmente de 3M.',
  )));
  cards.push(...repeat(2, () => action(
    'Hotel', 'hotel', 4,
    'Ajoutez a un set complet avec maison. Le loyer augmente de 4M.',
  )));
  cards.push(...repeat(2, () => action(
    'Double the Rent', 'double_the_rent', 1,
    'A jouer avec une carte Loyer. Double le montant du loyer !',
  )));

  // ─── Rent Cards (13 cards) ────────────────────────────────────────
  cards.push(...repeat(3, () => rent('all', 3)));
  cards.push(...repeat(2, () => rent(['green', 'blue'], 1)));
  cards.push(...repeat(2, () => rent(['brown', 'light_blue'], 1)));
  cards.push(...repeat(2, () => rent(['orange', 'pink'], 1)));
  cards.push(...repeat(2, () => rent(['railroad', 'utility'], 1)));
  cards.push(...repeat(2, () => rent(['red', 'yellow'], 1)));

  return cards; // 106 cards
}

export function shuffleDeck(deck: AnyCard[]): AnyCard[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
