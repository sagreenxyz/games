import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, rng } from './load.mjs';

const S = loadScripts('cards.js', 'tricks-core.js', 'spades-logic.js').SpadesLogic;
const cards = str => str.trim().split(/\s+/).map(t => ({ r: t.slice(0, -1), s: t.slice(-1) }));
const plain = x => JSON.parse(JSON.stringify(x));
const keys = cs => plain(cs).map(c => c.r + c.s).sort();

function game(seed = 1) {
  const gs = S.create('TEST01');
  for (let i = 0; i < 4; i++) gs.players[i] = S.freshPlayer(`P${i}`);
  assert.ok(S.start(gs, rng(seed)));
  return gs;
}

function position(hands, { trick = [], broken = false, current = 0, bids = [3, 3, 3, 3] } = {}) {
  const gs = game();
  hands.forEach((h, s) => { gs.players[s].handJSON = JSON.stringify(cards(h)); gs.players[s].bid = bids[s]; });
  Object.assign(gs, { phase: 'playing', trick: trick.map(([seat, c]) => ({ seat, card: cards(c)[0] })), spadesBroken: broken, currentPlayer: current });
  return gs;
}

/** Score a hand where each seat took the given number of tricks. */
function scored(bids, tricks, teams = [{ score: 0, bags: 0 }, { score: 0, bags: 0 }]) {
  const gs = game();
  gs.teams = teams;
  [0, 1, 2, 3].forEach(s => { gs.players[s].bid = bids[s]; gs.players[s].tricks = tricks[s]; });
  return [S.scoreTeam(gs, 0), S.scoreTeam(gs, 1)];
}

describe('bidding', () => {
  test('starts left of the dealer; play starts there once all four have bid', () => {
    const gs = game();
    const first = (gs.dealer + 1) % 4;
    assert.equal(gs.phase, 'bidding');
    assert.equal(gs.currentPlayer, first);
    assert.equal(S.apply(gs, (first + 1) % 4, { type: 'bid', value: 3 }).ok, false);
    for (let i = 0; i < 4; i++) assert.ok(S.apply(gs, (first + i) % 4, { type: 'bid', value: 3 }).ok);
    assert.equal(gs.phase, 'playing');
    assert.equal(gs.currentPlayer, first);
  });
  test('bids must be 0–13', () => {
    const gs = game();
    assert.equal(S.apply(gs, gs.currentPlayer, { type: 'bid', value: 14 }).ok, false);
    assert.equal(S.apply(gs, gs.currentPlayer, { type: 'bid', value: -1 }).ok, false);
  });
});

describe('play', () => {
  test("spades can't be led until broken, unless that's all you have", () => {
    let gs = position(['3♦ 9♠', '2♣', '2♣', '2♣']);
    assert.deepEqual(keys(S.legalActions(gs, 0).map(a => a.card)), ['3♦']);
    gs = position(['4♠ 9♠', '2♣', '2♣', '2♣']);
    assert.equal(S.legalActions(gs, 0).length, 2);
  });
  test('spades trump the suit led', () => {
    const gs = position(['A♦', '2♠', 'K♦', '3♦'], { current: 0 });
    for (const [s, c] of [[0, 'A♦'], [1, '2♠'], [2, 'K♦'], [3, '3♦']]) assert.ok(S.apply(gs, s, { type: 'play', card: cards(c)[0] }).ok);
    assert.equal(gs.lastTrick.winner, 1);
    assert.equal(gs.spadesBroken, true);
  });
});

describe('scoring', () => {
  test('making a contract: 10 per trick bid + 1 per bag', () => {
    const [a] = scored([3, 2, 4, 2], [4, 2, 4, 3]);
    assert.equal(a.contract, 7);
    assert.equal(a.points, 71);
    assert.equal(a.bags, 1);
  });
  test('missing a contract: −10 per trick bid', () => {
    const [, b] = scored([3, 4, 3, 4], [5, 2, 5, 1]);
    assert.equal(b.points, -80);
  });
  test('nil: +100 if no tricks, −100 otherwise; nil tricks are bags', () => {
    let [a] = scored([0, 3, 5, 3], [0, 4, 6, 3]);
    assert.equal(a.points, 100 + 50 + 1);
    [a] = scored([0, 3, 5, 3], [2, 4, 5, 2]);
    assert.equal(a.points, -100 + 50 + 2);
    assert.equal(a.bags, 2);
  });
  test('every 10 bags costs 100', () => {
    const gs = position(['A♦', '2♣', 'K♦', '3♣'], { bids: [1, 0, 1, 0] });
    gs.tricksPlayed = 12;
    gs.players[0].tricks = 6; gs.players[2].tricks = 6; // 12 tricks, contract 2 → 10 bags after the last trick… plus this one
    gs.teams[0].bags = 0;
    for (const [s, c] of [[0, 'A♦'], [1, '2♣'], [2, 'K♦'], [3, '3♣']]) S.apply(gs, s, { type: 'play', card: cards(c)[0] });
    assert.equal(gs.result.rows[0].bags, 11);
    assert.equal(gs.result.rows[0].bagPenalty, -100);
    assert.equal(gs.teams[0].bags, 1);
  });
  test('first team to 500 wins', () => {
    const gs = position(['A♦', '2♣', 'K♦', '3♣'], { bids: [1, 1, 1, 1] });
    gs.tricksPlayed = 12;
    gs.players[0].tricks = 1;
    gs.teams[0].score = 480;
    for (const [s, c] of [[0, 'A♦'], [1, '2♣'], [2, 'K♦'], [3, '3♣']]) S.apply(gs, s, { type: 'play', card: cards(c)[0] });
    assert.equal(gs.phase, 'matchOver');
    assert.equal(gs.final.team, 0);
  });
  test('teams: seats 1 & 3 vs 2 & 4', () => {
    assert.equal(S.seatNote(0), 'Team A');
    assert.equal(S.seatNote(1), 'Team B');
    assert.equal(S.seatNote(2), 'Team A');
  });
});
