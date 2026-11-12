/**
 * Generic checks every rules engine must pass. Plays random (or scripted)
 * games through the shared interface and verifies, after every action:
 *   - some seat always has a legal action until the game is over (no stalls)
 *   - every action listed by legalActions() is accepted by apply()
 *   - a seat with no legal actions is refused, and the state doesn't change
 *   - no card is lost or duplicated (when the engine exposes allCards)
 */
import assert from 'node:assert/strict';
import { rng } from './load.mjs';

const key = c => c.r + c.s;

function checkCards(cards, expected) {
  assert.equal(cards.length, expected, `card count changed: ${cards.length} ≠ ${expected}`);
  assert.equal(new Set(cards.map(key)).size, expected, 'duplicate card');
}

export function newGame(L, players, seed = 1) {
  const r = rng(seed);
  const gs = L.create('TEST01');
  for (let i = 0; i < players; i++) gs.players[i] = L.freshPlayer(`P${i}`);
  return { gs, r };
}

/**
 * Play one game. Options:
 *   players, seed, maxSteps, rounds (for engines with nextRound),
 *   mustFinish (fail if not over within maxSteps),
 *   pick(gs, options, r) → [seat, action]  (default: uniformly random)
 */
export function play(L, { players, seed = 1, maxSteps = 5000, rounds = 1, mustFinish = true, pick } = {}) {
  const { gs, r } = newGame(L, players, seed);
  assert.ok(L.start(gs, r), 'start() refused');
  const deckSize = L.allCards ? L.allCards(gs).length : 0;
  if (deckSize) checkCards(L.allCards(gs), deckSize);
  let round = 1;
  let steps = 0;
  for (;;) {
    if (L.isOver(gs)) {
      if (L.nextRound && !L.isMatchOver?.(gs) && round < rounds) {
        assert.ok(L.nextRound(gs, r) !== false, 'nextRound() refused');
        round++;
        if (deckSize) checkCards(L.allCards(gs), deckSize);
        continue;
      }
      return { gs, steps, rounds: round };
    }
    if (steps >= maxSteps) {
      if (mustFinish) assert.fail(`game did not finish in ${maxSteps} steps (phase ${gs.phase})`);
      return { gs, steps, rounds: round, unfinished: true };
    }
    const seats = Object.keys(gs.players).map(Number);
    const options = seats.flatMap(s => L.legalActions(gs, s).map(a => [s, a]));
    assert.ok(options.length > 0, `stalled: nobody can act in phase ${gs.phase}`);

    // A seat with nothing to do must be refused without side effects.
    const idle = seats.find(s => L.legalActions(gs, s).length === 0);
    if (idle !== undefined && steps % 7 === 0) {
      const before = JSON.stringify(gs);
      assert.equal(L.apply(gs, idle, options[0][1]).ok, false, `seat ${idle} acted out of turn`);
      assert.equal(JSON.stringify(gs), before, 'rejected action changed state');
    }

    const [seat, action] = pick ? pick(gs, options, r) : options[Math.floor(r() * options.length)];
    const res = L.apply(gs, seat, action);
    assert.ok(res.ok, `listed action rejected: ${JSON.stringify(action)} → ${res.error}`);
    if (deckSize) checkCards(L.allCards(gs), deckSize);
    steps++;
  }
}

/** Every engine must handle the shared interface basics. */
export function interfaceChecks(L) {
  for (const f of ['create', 'freshPlayer', 'start', 'apply', 'legalActions', 'removePlayer', 'isOver']) {
    assert.equal(typeof L[f], 'function', `missing ${f}()`);
  }
  assert.ok(L.minPlayers >= 1 && L.maxPlayers >= L.minPlayers);
  const { gs, r } = newGame(L, Math.max(0, L.minPlayers - 1));
  if (L.minPlayers > 1) assert.equal(L.start(gs, r), false, 'started with too few players');
  const bad = L.apply(newGame(L, L.minPlayers).gs, 0, { type: 'nonsense' });
  assert.equal(bad.ok, false, 'accepted an action before the game started');
}
