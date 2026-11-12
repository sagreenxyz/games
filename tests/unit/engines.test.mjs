/**
 * Shared-interface checks + fuzz for every multiplayer rules engine.
 * Add new engines to ENGINES.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './load.mjs';
import { play, interfaceChecks, newGame } from './harness.mjs';

const ENGINES = [
  { file: 'poker-logic.js', name: 'PokerLogic', rounds: 15, games: 60, mustFinish: true },
  { file: 'sevens-logic.js', name: 'SevensLogic', games: 60, mustFinish: true },
  { file: 'gin-logic.js', name: 'GinLogic', deps: ['rummy-core.js'], rounds: 30, games: 60, mustFinish: true },
  { file: 'crazy-eights-logic.js', name: 'CrazyEightsLogic', rounds: 20, games: 40, mustFinish: true },
  { file: 'hearts-logic.js', name: 'HeartsLogic', deps: ['tricks-core.js'], rounds: 12, games: 25, mustFinish: true },
  { file: 'spades-logic.js', name: 'SpadesLogic', deps: ['tricks-core.js'], rounds: 12, games: 25, mustFinish: true },
  // Random play rarely goes out, so rummy fuzz checks invariants over a capped number of steps
  // (rummy-logic.test.mjs also plays complete matches with a greedy player).
  { file: 'rummy-logic.js', name: 'RummyLogic', sub: 'basic', deps: ['rummy-core.js'], rounds: 3, games: 15, mustFinish: false, maxSteps: 1500 },
  { file: 'rummy-logic.js', name: 'RummyLogic', sub: 'r500', deps: ['rummy-core.js'], rounds: 3, games: 15, mustFinish: false, maxSteps: 1500 },
];

for (const E of ENGINES) {
  const mod = loadScripts('cards.js', ...(E.deps || []), E.file)[E.name];
  const L = E.sub ? mod[E.sub] : mod;
  describe(`${E.name}${E.sub ? '.' + E.sub : ''}: shared interface`, () => {
    test('implements the interface and enforces player counts', () => interfaceChecks(L));

    test('removing a player mid-game never leaves it stuck', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const players = L.maxPlayers;
        const { gs, r } = newGame(L, players, seed);
        L.start(gs, r);
        const seat = seed % players;
        gs.players[seat].disconnected = true;
        gs.players[seat].left = true;
        L.removePlayer(gs, seat);
        assert.ok(L.legalActions(gs, seat).length === 0, 'removed player can still act');
        const anyone = Object.keys(gs.players).some(s => L.legalActions(gs, Number(s)).length > 0);
        assert.ok(anyone || L.isOver(gs), 'stalled after removal');
      }
    });

    for (let n = L.minPlayers; n <= L.maxPlayers; n++) {
      test(`fuzz: ${E.games} random games with ${n} players`, () => {
        for (let seed = 1; seed <= E.games; seed++) {
          play(L, { players: n, seed: seed * 101 + n, rounds: E.rounds || 1, mustFinish: E.mustFinish, maxSteps: E.maxSteps });
        }
      });
    }
  });
}
