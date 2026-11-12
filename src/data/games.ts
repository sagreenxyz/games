/**
 * The game registry. Adding an entry here puts the game on the home page and
 * in the header navigation. `slug` is the page folder under src/pages/.
 */
export interface GameInfo {
  slug: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Short player-count label, e.g. "2–4 players" or "Solo". */
  players: string;
  mode: 'multi' | 'solo';
  /** The family of rules it shares code with. */
  family: 'betting' | 'shedding' | 'meld' | 'trick' | 'solitaire';
}

export const games: GameInfo[] = [
  { slug: 'poker', name: 'Poker', emoji: '🃏', blurb: "Texas Hold'em with side pots and blinds.", players: '2–6 players', mode: 'multi', family: 'betting' },
  { slug: 'gin', name: 'Gin Rummy', emoji: '🥃', blurb: 'Two-player rummy: build melds, knock with 10 or less, first to 100.', players: '2 players', mode: 'multi', family: 'meld' },
  { slug: 'rummy', name: 'Rummy', emoji: '🂡', blurb: 'Classic rummy: meld sets and runs, lay off on anyone, go out first. To 100.', players: '2–6 players', mode: 'multi', family: 'meld' },
  { slug: 'rummy500', name: 'Rummy 500', emoji: '5️⃣', blurb: 'Dig into the discard pile, score every card you meld. First to 500.', players: '2–6 players', mode: 'multi', family: 'meld' },
  { slug: 'sevens', name: 'Sevens', emoji: '7️⃣', blurb: 'Fan Tan — build each suit out from its 7. First to empty their hand wins.', players: '2–4 players', mode: 'multi', family: 'shedding' },
];

export const gameBySlug = (slug: string) => {
  const g = games.find(x => x.slug === slug);
  if (!g) throw new Error(`Unknown game: ${slug}`);
  return g;
};
