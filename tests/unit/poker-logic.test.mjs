import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const P = loadScripts('cards.js', 'poker-logic.js').PokerLogic;

/** Parse "A♠ K♥ 10♦" into card objects. */
const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const hand = str => P.evalHand(cards(str));

/**
 * Build a deck that deals the given cards in order (startHand/streets pop
 * from the end): hole cards two at a time, clockwise from the left of the
 * button, then burn + flop, burn + turn, burn + river. Remaining cards fill
 * the rest of the deck.
 */
function riggedDeck(order) {
  const wanted = cards(order);
  const key = c => c.r + c.s;
  const used = new Set(wanted.map(key));
  const rest = P.makeDeck(rng(1)).filter(c => !used.has(key(c)));
  return [...rest, ...wanted.reverse()];
}

function table(n, chips = []) {
  const gs = P.buildFreshRoomState('TEST01');
  for (let i = 0; i < n; i++) {
    gs.players[i] = P.freshPlayer(`P${i}`);
    if (chips[i] !== undefined) gs.players[i].chips = chips[i];
  }
  return gs;
}

const totalChips = gs => Object.values(gs.players).reduce((a, p) => a + p.chips, 0) + gs.pot;

function act(gs, action, amount) {
  const res = P.applyAction(gs, gs.currentPlayer, action, amount);
  assert.ok(res.ok, `${action} rejected: ${res.error}`);
}

describe('hand evaluation', () => {
  test('pair rank is compared before kickers', () => {
    assert.ok(hand('K♠ K♥ Q♦ J♣ 9♠').score > hand('2♠ 2♥ A♦ K♣ Q♠').score);
  });

  test('two pair compares the high pair first', () => {
    assert.ok(hand('A♠ A♥ 3♦ 3♣ 2♠').score > hand('K♠ K♥ Q♦ Q♣ J♠').score);
  });

  test('full house compares the trips first', () => {
    assert.ok(hand('3♠ 3♥ 3♦ 2♣ 2♠').score > hand('2♠ 2♥ 2♦ A♣ A♠').score);
  });

  test('the wheel (A-2-3-4-5) is the lowest straight', () => {
    const wheel = hand('A♠ 2♥ 3♦ 4♣ 5♠');
    assert.equal(wheel.name, 'Straight');
    assert.ok(hand('2♠ 3♥ 4♦ 5♣ 6♠').score > wheel.score);
  });

  test('a wheel straight flush is not a royal flush', () => {
    assert.equal(hand('A♠ 2♠ 3♠ 4♠ 5♠').name, 'Straight Flush');
    assert.equal(hand('10♠ J♠ Q♠ K♠ A♠').name, 'Royal Flush');
  });

  test('best five of seven cards is used', () => {
    assert.equal(hand('2♥ 7♥ 9♥ J♥ K♥ A♠ A♦').name, 'Flush');
  });

  test('identical hands tie', () => {
    assert.equal(hand('A♠ K♥ Q♦ J♣ 9♠').score, hand('A♥ K♦ Q♣ J♠ 9♦').score);
  });
});

describe('dealing and blinds', () => {
  test('heads-up: button posts small blind and acts first pre-flop', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(2)));
    assert.equal(gs.dealer, 0);
    assert.equal(gs.pot, 30);
    assert.equal(gs.players[0].bet, 10);
    assert.equal(gs.players[1].bet, 20);
    assert.equal(gs.currentPlayer, 0);
  });

  test('3+ players: first to act is left of the big blind', () => {
    const gs = table(4);
    P.startHand(gs, P.makeDeck(rng(3)));
    assert.equal(gs.players[1].bet, 10);
    assert.equal(gs.players[2].bet, 20);
    assert.equal(gs.currentPlayer, 3);
  });

  test('big blind gets their option when everyone calls', () => {
    const gs = table(3);
    P.startHand(gs, P.makeDeck(rng(4)));
    act(gs, 'call'); // seat 0 (UTG/button)
    act(gs, 'call'); // seat 1 (SB)
    assert.equal(gs.phase, 'pre-flop');
    assert.equal(gs.currentPlayer, 2);
    act(gs, 'check');
    assert.equal(gs.phase, 'flop');
  });

  test('the button moves to the next occupied seat each hand', () => {
    const gs = table(3);
    P.startHand(gs, P.makeDeck(rng(5)));
    act(gs, 'fold');
    act(gs, 'fold');
    assert.equal(gs.phase, 'showdown');
    P.startHand(gs, P.makeDeck(rng(6)));
    assert.equal(gs.dealer, 1);
  });

  test('a new hand with fewer than two players goes back to the waiting room', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(7)));
    gs.players[1].disconnected = true;
    gs.players[1].left = true;
    act(gs, 'fold');
    assert.equal(P.startHand(gs), false);
    assert.equal(gs.phase, 'waiting');
    assert.deepEqual(Object.keys(gs.players), ['0']);
  });
});

describe('action validation', () => {
  test('rejects actions out of turn', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(8)));
    const res = P.applyAction(gs, 1, 'fold');
    assert.equal(res.ok, false);
    assert.equal(gs.players[1].folded, false);
  });

  test('rejects negative, fractional and non-numeric raises without changing chips', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(9)));
    const before = JSON.stringify(gs);
    for (const amount of [-500, 0, 25.5, 'abc', NaN, null]) {
      assert.equal(P.applyAction(gs, 0, 'raise', amount).ok, false, `amount ${amount}`);
    }
    assert.equal(JSON.stringify(gs), before);
  });

  test('rejects a raise smaller than the minimum', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(10)));
    assert.equal(P.applyAction(gs, 0, 'raise', 10).ok, false);
    assert.ok(P.applyAction(gs, 0, 'raise', 20).ok);
    assert.equal(gs.currentBet, 40);
    // Re-raise must be at least the previous raise size
    assert.equal(P.applyAction(gs, 1, 'raise', 10).ok, false);
  });

  test('raising by more than your stack is an all-in', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(11)));
    act(gs, 'raise', 999999);
    assert.equal(gs.players[0].chips, 0);
    assert.equal(gs.players[0].allIn, true);
  });

  test('rejects check when facing a bet, and call when there is nothing to call', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(12)));
    assert.equal(P.applyAction(gs, 0, 'check').ok, false);
    act(gs, 'call');
    assert.equal(P.applyAction(gs, 1, 'call').ok, false);
  });

  test('rejects actions after the hand is over', () => {
    const gs = table(2);
    P.startHand(gs, P.makeDeck(rng(13)));
    act(gs, 'fold');
    assert.equal(gs.phase, 'showdown');
    assert.equal(P.applyAction(gs, 1, 'fold').ok, false);
    assert.equal(P.applyAction(gs, 0, 'raise', 100).ok, false);
  });
});

describe('reconnecting players', () => {
  test('a player who is reconnecting sits out the next hand but keeps their seat', () => {
    const gs = table(3);
    P.startHand(gs, P.makeDeck(rng(30)));
    gs.players[2].disconnected = true;
    P.startHand(gs, P.makeDeck(rng(31)));
    assert.equal(gs.players[2].active, false);
    assert.equal(gs.players[2].handJSON, '[]');
    assert.ok(gs.players[2]);
    gs.players[2].disconnected = false;
    P.startHand(gs, P.makeDeck(rng(32)));
    assert.equal(gs.players[2].active, true);
  });

  test('removing a player who is not to act folds them without moving the turn', () => {
    const gs = table(4);
    P.startHand(gs, P.makeDeck(rng(33)));
    const current = gs.currentPlayer;
    const other = [0, 1, 2, 3].find(s => s !== current);
    P.removePlayer(gs, other);
    assert.equal(gs.players[other].folded, true);
    assert.equal(gs.currentPlayer, current);
  });
});

describe('turn order', () => {
  test('after a fold, action passes to the next seat clockwise', () => {
    const gs = table(4);
    P.startHand(gs, P.makeDeck(rng(14)));
    act(gs, 'call'); act(gs, 'call'); act(gs, 'call'); act(gs, 'check'); // to the flop
    assert.equal(gs.phase, 'flop');
    assert.equal(gs.currentPlayer, 1);
    act(gs, 'check'); // seat 1
    act(gs, 'fold');  // seat 2
    assert.equal(gs.currentPlayer, 3);
  });

  test('every player acts on a new street before it ends', () => {
    const gs = table(3);
    P.startHand(gs, P.makeDeck(rng(15)));
    act(gs, 'call'); act(gs, 'call'); act(gs, 'check');
    act(gs, 'check'); act(gs, 'check');
    assert.equal(gs.phase, 'flop');
    act(gs, 'check');
    assert.equal(gs.phase, 'turn');
  });
});

describe('all-in', () => {
  test('when nobody can bet any more the board is run out to showdown', () => {
    const gs = table(2, [100, 1000]);
    P.startHand(gs, P.makeDeck(rng(16)));
    act(gs, 'raise', 999); // seat 0 all-in for 100
    act(gs, 'call');       // seat 1 calls
    assert.equal(gs.phase, 'showdown');
    assert.equal(gs.communityCards.length, 5);
    assert.equal(totalChips(gs), 1100);
  });

  test('a blind that puts a player all-in does not stall the hand', () => {
    const gs = table(2, [5, 1000]);
    P.startHand(gs, P.makeDeck(rng(17)));
    // Seat 0 (button/SB) is all-in for 5; seat 1's blind already covers it.
    assert.equal(gs.phase, 'showdown');
    assert.equal(totalChips(gs), 1005);
  });

  test('the last player who can bet must still call an all-in raise', () => {
    const gs = table(2, [1000, 500]);
    P.startHand(gs, P.makeDeck(rng(18)));
    act(gs, 'call');       // seat 0 completes the SB
    act(gs, 'raise', 999); // seat 1 all-in for 500
    assert.equal(gs.phase, 'pre-flop');
    assert.equal(gs.currentPlayer, 0);
    assert.equal(P.bettingOptions(gs, 0).canCall, true);
  });

  test('side pots: a short all-in can only win what it matched', () => {
    // Button = seat 0. Seat 1 (SB) AA for 100, seat 2 (BB) KK, seat 0 QQ.
    const deck = riggedDeck('A♠ A♥ K♠ K♥ Q♠ Q♥  3♠ 2♣ 7♦ 9♣  3♦ 4♥  3♣ J♦');
    const gs = table(3, [1000, 100, 1000]);
    P.startHand(gs, deck);
    act(gs, 'raise', 280); // seat 0 raises to 300
    act(gs, 'call');       // seat 1 calls all-in for 100
    act(gs, 'call');       // seat 2 calls 300
    while (gs.phase !== 'showdown') act(gs, 'check');
    assert.equal(gs.players[1].chips, 300);  // main pot 3 × 100
    assert.equal(gs.players[2].chips, 1100); // side pot 2 × 200, minus 300 put in
    assert.equal(gs.players[0].chips, 700);
    assert.match(gs.winnerInfo, /Main pot/);
    assert.match(gs.winnerInfo, /Side pot/);
  });

  test('an uncalled part of a bet goes back to the bettor', () => {
    const deck = riggedDeck('A♠ A♥ 2♠ 7♥  3♠ K♣ K♦ 9♣  3♦ 4♥  3♣ J♦');
    const gs = table(2, [1000, 200]);
    P.startHand(gs, deck);
    act(gs, 'raise', 999); // seat 0 all-in for 1000
    act(gs, 'call');       // seat 1 can only call 200
    assert.equal(gs.phase, 'showdown');
    // Seat 0 (2-7) loses the 400 matched pot but gets its unmatched 800 back.
    assert.equal(gs.players[0].chips, 800);
    assert.equal(gs.players[1].chips, 400);
  });

  test('pots include chips from folded players', () => {
    const gs = table(3);
    gs.players[0].contributed = 50; gs.players[1].contributed = 50; gs.players[2].contributed = 1;
    gs.players[2].folded = true;
    for (const p of Object.values(gs.players)) p.active = true;
    const pots = P.buildPots(gs);
    assert.equal(pots.reduce((a, p) => a + p.amount, 0), 101);
  });
});

describe('fuzz: random legal play', () => {
  test('chips are conserved and the game never stalls', () => {
    const r = rng(42);
    for (let game = 0; game < 300; game++) {
      const n = 2 + Math.floor(r() * 3);
      const gs = table(n, Array.from({ length: n }, () => 50 + Math.floor(r() * 1500)));
      const startTotal = totalChips(gs);
      P.startHand(gs, P.makeDeck(r));
      for (let step = 0; gs.phase !== 'showdown'; step++) {
        assert.ok(step < 200, 'hand did not finish');
        const seat = gs.currentPlayer;
        const legal = P.bettingOptions(gs, seat);
        assert.ok(legal.canAct, `stalled in ${gs.phase}: seat ${seat} cannot act`);
        const options = ['fold'];
        if (legal.canCheck) options.push('check', 'check');
        if (legal.canCall) options.push('call', 'call');
        if (legal.canRaise) options.push('raise', 'allin');
        const action = options[Math.floor(r() * options.length)];
        const amount = legal.minRaise + Math.floor(r() * 3) * 20;
        assert.ok(P.applyAction(gs, seat, action, amount).ok);
        assert.equal(totalChips(gs), startTotal, 'chips not conserved');
      }
      assert.equal(gs.pot, 0);
    }
  });
});
