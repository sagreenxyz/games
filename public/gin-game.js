/**
 * Gin Rummy — UI. Rules: gin-logic.js. Networking: room.js.
 */
(function () {
  'use strict';

  const G = GinLogic;
  const R = RummyCore;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;

  let selected = null;     // key of the selected card in my hand
  let sortMode = 'melds';

  const myHand = gs => safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
  const isMyTurn = gs => gs.phase === 'playing' && gs.currentPlayer === Room.mySeat;
  const small = c => Cards.cardHTML(c, { small: true });

  function orderedHand(hand) {
    if (sortMode !== 'melds') return [{ cards: Cards.sortCards(hand, { by: sortMode }), meld: false }];
    const b = R.bestMelds(hand);
    return [...b.melds.map(m => ({ cards: m, meld: true })), { cards: Cards.sortCards(b.deadwood, { by: 'rank' }), meld: false }];
  }

  function renderPiles(gs) {
    const top = gs.discard[gs.discard.length - 1];
    const turn = isMyTurn(gs);
    const stockN = gs.stockCount ?? gs.stock?.length ?? 0;
    const canStock = turn && gs.step === 'draw' && stockN > 0;
    const canDiscardPile = turn && !!top && (gs.step === 'offer' || (gs.step === 'draw' && !gs.stockOnly));
    el('stockPile').innerHTML = stockN ? Cards.cardHTML(null, { faceDown: true }) : '<div class="playing-card empty"></div>';
    el('stockPile').disabled = !canStock;
    setText('stockCount', `Stock: ${stockN}`);
    el('discardPile').innerHTML = top ? Cards.cardHTML(top) : '<div class="playing-card empty"></div>';
    el('discardPile').disabled = !canDiscardPile;
  }

  function renderHand(gs) {
    const me = gs.players[Room.mySeat];
    if (!me) return;
    const hand = myHand(gs);
    if (selected && !hand.some(c => Cards.key(c) === selected)) selected = null;
    setText('myNameLabel', me.name);
    const dw = hand.length ? R.bestMelds(hand).value : 0;
    setText('deadwoodLabel', `Deadwood: ${dw}`);
    const canPick = isMyTurn(gs) && gs.step === 'discard';
    setHTML('myCards', orderedHand(hand).filter(g => g.cards.length).map(g =>
      `<div class="meld-group${g.meld ? '' : ' deadwood'}">${g.cards.map(c => Cards.cardHTML(c, {
        playable: canPick,
        selected: Cards.key(c) === selected,
        dim: Cards.same(c, gs.drawnFromDiscard) && canPick,
        title: Cards.same(c, gs.drawnFromDiscard) ? 'Taken from the discard pile this turn' : '',
      })).join('')}</div>`).join(''));
  }

  function renderActions(gs) {
    const turn = isMyTurn(gs);
    const hand = myHand(gs);
    const ids = ['btnTake', 'btnPass', 'btnStock', 'btnDiscard', 'btnKnock', 'btnBigGin'];
    ids.forEach(hide);
    let msg = '';
    if (turn && gs.step === 'offer') {
      show('btnTake'); show('btnPass');
      el('btnTake').textContent = 'Take upcard';
      msg = 'Take the upcard, or pass.';
    } else if (turn && gs.step === 'draw') {
      show('btnStock');
      if (!gs.stockOnly && gs.discard.length) { show('btnTake'); el('btnTake').textContent = 'Take discard'; }
      msg = 'Draw a card from the stock or the discard pile.';
    } else if (turn && gs.step === 'discard') {
      show('btnDiscard'); show('btnKnock');
      const card = selected && Cards.fromKey(selected);
      const allowed = card && !Cards.same(card, gs.drawnFromDiscard);
      el('btnDiscard').disabled = !allowed;
      const after = allowed ? R.bestMelds(R.without(hand, [card])).value : null;
      el('btnKnock').disabled = !(allowed && after <= G.KNOCK_LIMIT);
      el('btnKnock').textContent = after === 0 ? 'Gin!' : after !== null && after <= G.KNOCK_LIMIT ? `Knock (${after})` : 'Knock';
      if (R.bestMelds(hand).value === 0) show('btnBigGin');
      msg = card ? (allowed ? `Discard ${card.r}${card.s}${after <= G.KNOCK_LIMIT ? ' — or knock!' : ''}` : "You can't discard the card you just took.")
        : 'Select a card to discard.';
    } else if (gs.phase === 'playing') {
      const cp = gs.players[gs.currentPlayer];
      msg = cp ? `Waiting for ${cp.name}${cp.disconnected ? ' to reconnect' : ''}…` : '';
    }
    setText('actionMessage', msg);
  }

  function renderOpponent(gs) {
    const seat = 1 - Room.mySeat;
    const p = gs.players[seat];
    if (!p) { setHTML('opponentsRow', ''); return; }
    const n = handSize(p);
    const turn = gs.currentPlayer === seat;
    setHTML('opponentsRow', `<div class="opp${turn ? ' turn' : ''}${p.disconnected ? ' out' : ''}">
      <div class="opp-head"><strong>${escHtml(p.name)}</strong>
        ${p.disconnected ? `<span class="badge badge-gray">${p.left ? 'Left' : 'Reconnecting…'}</span>` : ''}
        ${turn ? '<span class="badge badge-green">Turn</span>' : ''}
        <span class="right">${gs.scores[seat]} pts</span></div>
      <div class="cards-row fan" style="min-height:62px;">${Array.from({ length: n }, () => Cards.cardHTML(null, { faceDown: true, small: true })).join('')}</div>
    </div>`);
  }

  function handBlock(gs, seat) {
    const h = gs.result.hands[seat];
    const p = gs.players[seat];
    const layoffKeys = new Set(h.layoffs.map(Cards.key));
    const melds = h.melds.map(m => `<div class="meld-group">${m.map(small).join('')}</div>`).join('');
    const dead = h.deadwood.map(c => Cards.cardHTML(c, { small: true, dim: !layoffKeys.has(Cards.key(c)) }));
    const lay = h.layoffs.length ? `<div class="muted small">Laid off: ${h.layoffs.map(c => c.r + c.s).join(' ')}</div>` : '';
    return `<div class="result-hand"><strong>${escHtml(p.name)}</strong> — deadwood ${h.value}
      <div class="row mt-1">${melds}${dead.length ? `<div class="meld-group deadwood">${dead.join('')}</div>` : ''}</div>${lay}</div>`;
  }

  function scoreTable(gs) {
    const rows = [0, 1].map(s => {
      const f = gs.final;
      return `<tr><td>${escHtml(gs.players[s]?.name || '')}</td><td class="num">${gs.handsWon[s]}</td><td class="num">${gs.scores[s]}</td>${f ? `<td class="num">${f.totals[s]}</td>` : ''}</tr>`;
    }).join('');
    return `<table class="score-table"><tr><th>Player</th><th class="num">Hands</th><th class="num">Points</th>${gs.final ? '<th class="num">Final</th>' : ''}</tr>${rows}</table>`;
  }

  function renderModal(gs) {
    const over = gs.phase === 'handOver' || gs.phase === 'matchOver';
    if (!over) { hide('handModal'); return; }
    let title, body = '';
    if (gs.phase === 'matchOver') {
      const f = gs.final;
      title = `🏆 ${escHtml(gs.players[f.winner]?.name || '')} wins the match!`;
      body = f.forfeit ? '<p>The other player left.</p>' : '';
      body += `<p class="small muted">Final = points + 100 game bonus + 25 per hand won${f.shutout ? ', doubled for a shutout' : ''}.</p>`;
    } else if (gs.result?.void) {
      title = 'No score';
      body = `<p>${escHtml(gs.result.note)}</p>`;
    } else {
      title = `${escHtml(gs.result.note)}! ${escHtml(gs.players[gs.result.winner].name)} scores ${gs.result.points}`;
    }
    if (gs.result && !gs.result.void) body += handBlock(gs, gs.result.knocker) + handBlock(gs, 1 - gs.result.knocker);
    body += scoreTable(gs);
    setHTML('handTitle', title);
    setHTML('handDetails', body);
    el('btnNextHand').classList.toggle('hidden', !(Room.amHost && gs.phase === 'handOver'));
    el('btnNewMatch').classList.toggle('hidden', !(Room.amHost && gs.phase === 'matchOver' && !gs.final?.forfeit));
    el('handWaitMsg').classList.toggle('hidden', Room.amHost || gs.final?.forfeit);
    show('handModal');
  }

  function render(gs) {
    setText('roundLabel', `Hand ${gs.round}`);
    const me = Room.mySeat, them = 1 - me;
    setText('scoreLabel', `You ${gs.scores[me]} · ${gs.players[them]?.name || 'Opponent'} ${gs.scores[them]} · to ${G.TARGET}`);
    renderOpponent(gs);
    renderPiles(gs);
    renderHand(gs);
    renderActions(gs);
    renderModal(gs);
    setHTML('actionLogList', [...(gs.actionLog || [])].reverse()
      .map(l => `<div class="${l.startsWith('---') ? 'sep' : l.startsWith('🏆') ? 'win' : ''}">${escHtml(l)}</div>`).join(''));
  }

  const rerender = () => Room.state && render(Room.state);
  const selectedCard = () => selected && Cards.fromKey(selected);

  Room.init({
    logic: G,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => { selected = null; hide('handModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      if (!node) return;
      selected = selected === node.dataset.card ? null : node.dataset.card;
      rerender();
    });
    el('myCards').addEventListener('dblclick', e => {
      const node = e.target.closest('[data-card]');
      if (node) { selected = null; Room.act({ type: 'discard', card: Cards.fromKey(node.dataset.card) }); }
    });
    el('sortMode').addEventListener('change', e => { sortMode = e.target.value; rerender(); });
    el('stockPile').addEventListener('click', () => Room.act({ type: 'drawStock' }));
    el('btnStock').addEventListener('click', () => Room.act({ type: 'drawStock' }));
    el('discardPile').addEventListener('click', () => Room.act({ type: 'takeDiscard' }));
    el('btnTake').addEventListener('click', () => Room.act({ type: 'takeDiscard' }));
    el('btnPass').addEventListener('click', () => Room.act({ type: 'pass' }));
    el('btnDiscard').addEventListener('click', () => { const card = selectedCard(); selected = null; if (card) Room.act({ type: 'discard', card }); });
    el('btnKnock').addEventListener('click', () => { const card = selectedCard(); selected = null; if (card) Room.act({ type: 'knock', card }); });
    el('btnBigGin').addEventListener('click', () => Room.act({ type: 'bigGin' }));
    el('btnNextHand').addEventListener('click', () => Room.update(gs => G.nextRound(gs)));
    el('btnNewMatch').addEventListener('click', () => Room.update(gs => G.start(gs)));
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave the match? Your opponent wins.')) Room.leave(); });
    el('btnLeaveAfter').addEventListener('click', () => { hide('handModal'); Room.leave(); });
  });
})();
