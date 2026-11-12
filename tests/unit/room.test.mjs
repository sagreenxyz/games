import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const ctx = loadScripts('room.js', 'poker-logic.js');
const { Room, PokerLogic: P } = ctx;
Room.init({ canSeeHand: P.canSeeHand, maxPlayers: 4 });

describe('room codes', () => {
  test('are always 6 unambiguous characters', () => {
    for (let i = 0; i < 2000; i++) assert.match(Room._genCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('state sent to guests', () => {
  function liveHand() {
    const gs = P.buildFreshRoomState('TEST01');
    for (let i = 0; i < 3; i++) gs.players[i] = P.freshPlayer(`P${i}`);
    P.startHand(gs, P.makeDeck(rng(1)));
    return gs;
  }

  test("hides other players' cards and the deck, but keeps card counts", () => {
    const gs = liveHand();
    const view = Room._redactFor(gs, 1);
    assert.equal(view.deck, undefined);
    assert.equal(JSON.parse(view.players[1].handJSON).length, 2);
    for (const s of [0, 2]) {
      assert.equal(view.players[s].handJSON, '[]');
      assert.equal(view.players[s].handCount, 2);
    }
    // The host's own state is untouched
    assert.equal(gs.deck.length > 0, true);
    assert.equal(JSON.parse(gs.players[0].handJSON).length, 2);
  });

  test('reveals hands still in at a real showdown, but not folded ones', () => {
    const gs = liveHand();
    const act = a => assert.ok(P.applyAction(gs, gs.currentPlayer, a).ok);
    act('fold');   // seat 0 folds
    act('call');   // seat 1
    act('check');  // seat 2
    while (gs.phase !== 'showdown') act('check');
    const view = Room._redactFor(gs, 1);
    assert.equal(JSON.parse(view.players[2].handJSON).length, 2);
    assert.equal(view.players[0].handJSON, '[]');
  });

  test('does not reveal the winner when everyone else folded', () => {
    const gs = liveHand();
    assert.ok(P.applyAction(gs, gs.currentPlayer, 'fold').ok);
    assert.ok(P.applyAction(gs, gs.currentPlayer, 'fold').ok);
    assert.equal(gs.phase, 'showdown');
    const winner = Object.keys(gs.players).map(Number).find(s => !gs.players[s].folded);
    const viewer = winner === 0 ? 1 : 0;
    assert.equal(Room._redactFor(gs, viewer).players[winner].handJSON, '[]');
  });
});
