import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const ctx = loadScripts('cards.js', 'tricks-core.js', 'hearts-logic.js');
const H = ctx.HeartsLogic;
const T = ctx.TrickCore;
const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const hand = (gs, s) => JSON.parse(gs.players[s].handJSON);
const plain = x => JSON.parse(JSON.stringify(x));
const keys = cs => plain(cs).map(c => c.r + c.s).sort();

function game(seed = 1) {
  const gs = H.create('TEST01');
  for (let i = 0; i < 4; i++) gs.players[i] = H.freshPlayer(`P${i}`);
  assert.ok(H.start(gs, rng(seed)));
  return gs;
}

/** Mid-hand position: seat 0 to play, given hands, trick so far, tricks already played. */
function position(hands, { trick = [], tricksPlayed = 1, broken = false, current = 0 } = {}) {
  const gs = game();
  hands.forEach((h, s) => { gs.players[s].handJSON = JSON.stringify(cards(h)); });
  Object.assign(gs, { phase: 'playing', trick: trick.map(([seat, c]) => ({ seat, card: cards(c)[0] })), tricksPlayed, heartsBroken: broken, currentPlayer: current });
  return gs;
}

describe('trick helpers', () => {
  test('highest of the led suit wins without trumps; a trump beats it', () => {
    const trick = [{ seat: 0, card: { r: '9', s: '♦' } }, { seat: 1, card: { r: 'A', s: '♣' } }, { seat: 2, card: { r: 'K', s: '♦' } }, { seat: 3, card: { r: '2', s: '♠' } }];
    assert.equal(T.trickWinner(trick), 2);
    assert.equal(T.trickWinner(trick, '♠'), 3);
  });
});

describe('passing', () => {
  test('pass left in hand 1, right in 2, across in 3, none in 4', () => {
    const gs = game();
    assert.equal(gs.phase, 'passing');
    const dirs = [];
    for (let i = 0; i < 4; i++) { dirs.push(gs.passDir); gs.phase = 'handOver'; H.nextRound(gs, rng(i + 2)); }
    assert.deepEqual(dirs, ['left', 'right', 'across', 'hold']);
    assert.equal(gs.passDir, 'left');
  });

  test('each player passes 3 cards to the left; the cards arrive marked', () => {
    const gs = game(3);
    const given = [0, 1, 2, 3].map(s => hand(gs, s).slice(0, 3));
    for (const s of [0, 1, 2, 3]) assert.ok(H.apply(gs, s, { type: 'pass', cards: given[s] }).ok);
    assert.equal(gs.phase, 'playing');
    for (const s of [0, 1, 2, 3]) {
      const recv = hand(gs, (s + 1) % 4).filter(c => c.recv);
      assert.deepEqual(keys(recv), keys(given[s]));
    }
  });

  test('the cards being passed are hidden from other players', () => {
    assert.ok(H.hiddenFields.includes('passes'));
  });

  test('rejects passing the wrong number of cards or cards you lack', () => {
    const gs = game(4);
    assert.equal(H.apply(gs, 0, { type: 'pass', cards: hand(gs, 0).slice(0, 2) }).ok, false);
    assert.equal(H.apply(gs, 0, { type: 'pass', cards: hand(gs, 1).slice(0, 3) }).ok, false);
  });
});

describe('play rules', () => {
  test('2♣ leads the first trick', () => {
    const gs = game(5);
    for (const s of [0, 1, 2, 3]) H.apply(gs, s, H.legalActions(gs, s)[0]);
    const leader = gs.currentPlayer;
    assert.ok(hand(gs, leader).some(c => c.r === '2' && c.s === '♣'));
    assert.deepEqual(keys(H.legalActions(gs, leader).map(a => a.card)), ['2♣']);
  });

  test('must follow suit', () => {
    const gs = position(['3♦ 9♠ K♥', 'x', 'x', 'x'].map(h => (h === 'x' ? '2♥' : h)), { trick: [[3, '5♦']], current: 0 });
    assert.deepEqual(keys(H.legalActions(gs, 0).map(a => a.card)), ['3♦']);
  });

  test('no points on the first trick unless you have nothing else', () => {
    let gs = position(['9♠ Q♠ K♥', '2♥', '2♥', '2♥'], { trick: [[3, '5♣']], tricksPlayed: 0 });
    assert.deepEqual(keys(H.legalActions(gs, 0).map(a => a.card)), ['9♠']);
    gs = position(['Q♠ K♥', '2♥', '2♥', '2♥'], { trick: [[3, '5♣']], tricksPlayed: 0 });
    assert.equal(H.legalActions(gs, 0).length, 2);
  });

  test("hearts can't be led until broken, unless you hold only hearts", () => {
    let gs = position(['3♦ 9♥', '2♣', '2♣', '2♣']);
    assert.deepEqual(keys(H.legalActions(gs, 0).map(a => a.card)), ['3♦']);
    gs = position(['4♥ 9♥', '2♣', '2♣', '2♣']);
    assert.equal(H.legalActions(gs, 0).length, 2);
    gs = position(['3♦ 9♥', '2♣', '2♣', '2♣'], { broken: true });
    assert.equal(H.legalActions(gs, 0).length, 2);
  });
});

describe('scoring', () => {
  test('hearts are 1, Q♠ is 13, the winner takes the points and leads', () => {
    const gs = position(['A♦', '3♥', 'Q♠', '9♦'], { tricksPlayed: 12, broken: true });
    H.apply(gs, 0, { type: 'play', card: { r: 'A', s: '♦' } });
    H.apply(gs, 1, { type: 'play', card: { r: '3', s: '♥' } });
    H.apply(gs, 2, { type: 'play', card: { r: 'Q', s: '♠' } });
    H.apply(gs, 3, { type: 'play', card: { r: '9', s: '♦' } });
    assert.equal(gs.phase, 'handOver');
    assert.equal(gs.result.delta[0], 14);
  });

  test('shooting the moon gives everyone else 26', () => {
    const gs = position(['A♦', '3♥', 'Q♠', '9♦'], { tricksPlayed: 12, broken: true });
    gs.players[0].handPoints = 12;
    for (const [s, c] of [[0, 'A♦'], [1, '3♥'], [2, 'Q♠'], [3, '9♦']]) H.apply(gs, s, { type: 'play', card: cards(c)[0] });
    assert.equal(gs.result.shooter, 0);
    assert.deepEqual(plain(gs.result.delta), { 0: 0, 1: 26, 2: 26, 3: 26 });
  });

  test('when someone reaches 100 the lowest score wins', () => {
    const gs = position(['A♦', '3♥', 'Q♠', '9♦'], { tricksPlayed: 12, broken: true });
    gs.players[0].score = 90; gs.players[1].score = 20; gs.players[2].score = 40; gs.players[3].score = 50;
    for (const [s, c] of [[0, 'A♦'], [1, '3♥'], [2, 'Q♠'], [3, '9♦']]) H.apply(gs, s, { type: 'play', card: cards(c)[0] });
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.winner, 1);
  });

  test('a player leaving ends the game', () => {
    const gs = game();
    H.removePlayer(gs, 2);
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.abandoned, true);
  });
});
