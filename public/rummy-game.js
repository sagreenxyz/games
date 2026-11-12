/**
 * Rummy / Rummy 500 — UI for both variants. Rules: rummy-logic.js.
 * The variant comes from #gameTable[data-variant] ("basic" or "500").
 */
(function () {
  'use strict';

  const VARIANT = document.getElementById('gameTable')?.dataset.variant === '500' ? '500' : 'basic';
  const L = VARIANT === '500' ? RummyLogic.r500 : RummyLogic.basic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;

  let selected = new Set();   // card keys selected in my hand
  let sortMode = 'suit';

  const myHand = gs => safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
  const isMyTurn = gs => gs.phase === 'playing' && gs.currentPlayer === Room.mySeat;
  const selectedCards = gs => myHand(gs).filter(c => selected.has(Cards.key(c)));
  const nameOf = (gs, s) => gs.players[s]?.name || `Seat ${s + 1}`;

  function renderOpponents(gs) {
    let html = '';
    for (const k of Object.keys(gs.players)) {
      const s = Number(k), p = gs.players[s];
      if (s === Room.mySeat || !p || p.isEmpty) continue;
      const n = handSize(p), turn = gs.currentPlayer === s;
      html += `<div class="opp${turn ? ' turn' : ''}${p.disconnected ? ' out' : ''}">
        <div class="opp-head"><strong>${escHtml(p.name)}</strong>
          ${p.disconnected ? `<span class="badge badge-gray">${p.left ? 'Left' : 'Reconnecting…'}</span>` : ''}
          ${turn ? '<span class="badge badge-green">Turn</span>' : ''}
          <span class="right">${p.score} pts</span></div>
        <div class="cards-row fan" style="min-height:62px;">${Array.from({ length: n }, () => Cards.cardHTML(null, { faceDown: true, small: true })).join('')}</div>
      </div>`;
    }
    setHTML('opponentsRow', html);
  }

  function renderPiles(gs) {
    const turn = isMyTurn(gs) && gs.step === 'draw';
    const stockN = gs.stockCount ?? gs.stock?.length ?? 0;
    const canStock = turn && L.legalActions(gs, Room.mySeat).some(a => a.type === 'drawStock');
    el('stockPile').innerHTML = stockN ? Cards.cardHTML(null, { faceDown: true }) : '<div class="playing-card empty"></div>';
    el('stockPile').disabled = !canStock;
    setText('stockCount', `Stock: ${stockN}`);

    const hand = myHand(gs);
    const d = gs.discard;
    const shown = VARIANT === '500' ? d.map((c, i) => [c, i]) : d.length ? [[d[d.length - 1], d.length - 1]] : [];
    setHTML('discardPile', shown.length ? shown.map(([c, i]) => {
      const ok = turn && L.canTakeDiscard(gs, hand, i);
      return `<button class="pile-btn" data-index="${i}" ${ok ? '' : 'disabled'} aria-label="Take ${c.r}${c.s}${i < d.length - 1 ? ' and the cards above it' : ''}">${Cards.cardHTML(c, { small: VARIANT === '500', highlight: ok && VARIANT === '500' })}</button>`;
    }).join('') : '<div class="playing-card empty"></div>');
    setText('discardHint', VARIANT === '500'
      ? (turn ? 'Click a highlighted card to take it and everything above it' : `Discard pile (${d.length})`)
      : `Discard pile (${d.length})`);
  }

  function renderTable(gs) {
    const sel = selectedCards(gs);
    const one = isMyTurn(gs) && gs.step === 'play' && sel.length === 1 ? sel[0] : null;
    const anyTarget = one && gs.table.some(m => L.canLayOff(one, m));
    setText('layoffHint', anyTarget ? `— click a highlighted meld to lay off ${one.r}${one.s}` : '');
    setHTML('tableMelds', gs.table.length ? gs.table.map(m => {
      const target = one && L.canLayOff(one, m);
      return `<div class="meld-group${target ? ' meld-target' : ''}" data-meld="${m.id}" ${target ? 'role="button" tabindex="0"' : ''}>${
        m.cards.map(c => Cards.cardHTML(c, { small: true, title: `Melded by ${nameOf(gs, c.by)}` })).join('')}</div>`;
    }).join('') : '<span class="placeholder small">No melds yet</span>');
  }

  function renderHand(gs) {
    const me = gs.players[Room.mySeat];
    if (!me) return;
    const hand = myHand(gs);
    for (const k of [...selected]) if (!hand.some(c => Cards.key(c) === k)) selected.delete(k);
    setText('myNameLabel', me.name);
    setText('myScore', `${me.score} pts`);
    const canPick = isMyTurn(gs) && gs.step === 'play';
    setHTML('myCards', Cards.sortCards(hand, { by: sortMode, aceHigh: VARIANT === '500' }).map(c => Cards.cardHTML(c, {
      playable: canPick,
      selected: selected.has(Cards.key(c)),
      highlight: Cards.same(c, gs.mustUse),
      title: Cards.same(c, gs.mustUse) ? 'You must meld this card this turn' : Cards.same(c, gs.noDiscard) ? "Taken this turn — can't be discarded" : '',
    })).join('') || '<span class="placeholder">No cards</span>');
  }

  function renderActions(gs) {
    ['btnStock', 'btnTakeTop', 'btnMeld', 'btnDiscard', 'btnClear', 'btnEndHand'].forEach(hide);
    const legal = L.legalActions(gs, Room.mySeat);
    let msg = '';
    if (isMyTurn(gs) && gs.step === 'draw') {
      if (legal.some(a => a.type === 'drawStock')) show('btnStock');
      if (VARIANT === 'basic' && legal.some(a => a.type === 'takeDiscard')) show('btnTakeTop');
      if (legal.some(a => a.type === 'endHand')) show('btnEndHand');
      msg = VARIANT === '500' ? 'Draw from the stock, or take from the discard pile.' : 'Draw from the stock or take the top discard.';
    } else if (isMyTurn(gs) && gs.step === 'play') {
      const sel = selectedCards(gs);
      show('btnMeld'); show('btnDiscard');
      if (sel.length) show('btnClear');
      el('btnMeld').disabled = !(sel.length >= 3 && L.isMeld(sel));
      el('btnDiscard').disabled = !(sel.length === 1 && legal.some(a => a.type === 'discard' && Cards.same(a.card, sel[0])));
      if (gs.mustUse) msg = `Meld ${gs.mustUse.r}${gs.mustUse.s} first (highlighted) — it's the card you dug for.`;
      else if (sel.length >= 3) msg = L.isMeld(sel) ? 'Valid meld — click "Meld selected".' : 'Those cards are not a set or a run.';
      else if (sel.length === 1) msg = gs.table.some(m => L.canLayOff(sel[0], m)) ? 'Discard it, or lay it off on a highlighted meld.' : 'Discard it, or select more cards to meld.';
      else msg = 'Select cards to meld (3+), or one card to lay off or discard.';
    } else if (gs.phase === 'playing') {
      const cp = gs.players[gs.currentPlayer];
      msg = cp ? `Waiting for ${cp.name}${cp.disconnected ? ' to reconnect' : ''}…` : '';
    }
    setText('actionMessage', msg);
  }

  function renderModal(gs) {
    if (gs.phase !== 'handOver' && gs.phase !== 'matchOver') { hide('handModal'); return; }
    const res = gs.result;
    let title;
    if (gs.phase === 'matchOver') title = `🏆 ${escHtml(nameOf(gs, gs.final.winner))} wins the match!`;
    else if (res?.outSeat != null) title = `${escHtml(nameOf(gs, res.outSeat))} went out${res.rummy ? ' — rummy! (doubled)' : ''}`;
    else title = 'The stock ran out';
    let body = gs.final?.forfeit ? '<p>Everyone else left.</p>' : '';
    if (res) {
      const seats = Object.keys(res.rows).map(Number).filter(s => gs.players[s] && !gs.players[s].left);
      const melded = VARIANT === '500';
      body += `<table class="score-table"><tr><th>Player</th>${melded ? '<th class="num">Melded</th>' : ''}<th class="num">In hand</th><th class="num">This hand</th><th class="num">Total</th></tr>${
        seats.map(s => `<tr><td>${escHtml(nameOf(gs, s))}</td>${melded ? `<td class="num">${res.rows[s].melded}</td>` : ''}<td class="num">${res.rows[s].inHand}</td><td class="num">${res.rows[s].points}</td><td class="num">${gs.players[s].score}</td></tr>`).join('')}</table>`;
      body += `<p class="muted small">${melded ? 'Melded cards score for you; cards in hand count against you.' : 'The player who goes out scores the cards left in everyone else\'s hands.'} Target: ${L.variant.target}.</p>`;
    }
    setHTML('handTitle', title);
    setHTML('handDetails', body);
    el('btnNextHand').classList.toggle('hidden', !(Room.amHost && gs.phase === 'handOver'));
    el('btnNewMatch').classList.toggle('hidden', !(Room.amHost && gs.phase === 'matchOver' && !gs.final?.forfeit));
    el('handWaitMsg').classList.toggle('hidden', Room.amHost || !!gs.final?.forfeit);
    show('handModal');
  }

  function render(gs) {
    setText('roundLabel', `Hand ${gs.round}`);
    setText('scoreLabel', `First to ${L.variant.target}`);
    renderOpponents(gs);
    renderPiles(gs);
    renderTable(gs);
    renderHand(gs);
    renderActions(gs);
    renderModal(gs);
    setHTML('actionLogList', [...(gs.actionLog || [])].reverse()
      .map(l => `<div class="${l.startsWith('---') ? 'sep' : /^(🏆|🏁)/.test(l) ? 'win' : ''}">${escHtml(l)}</div>`).join(''));
  }

  const rerender = () => Room.state && render(Room.state);
  const actAndClear = action => { selected.clear(); Room.act(action); };

  Room.init({
    logic: L,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => { selected.clear(); hide('handModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      if (!node) return;
      const k = node.dataset.card;
      if (selected.has(k)) selected.delete(k); else selected.add(k);
      rerender();
    });
    el('tableMelds').addEventListener('click', e => {
      const node = e.target.closest('.meld-target');
      const gs = Room.state;
      if (!node || !gs) return;
      const [card] = selectedCards(gs);
      if (card) actAndClear({ type: 'layoff', card, meld: Number(node.dataset.meld) });
    });
    el('discardPile').addEventListener('click', e => {
      const node = e.target.closest('[data-index]');
      if (node && !node.disabled) actAndClear({ type: 'takeDiscard', index: Number(node.dataset.index) });
    });
    el('stockPile').addEventListener('click', () => actAndClear({ type: 'drawStock' }));
    el('btnStock').addEventListener('click', () => actAndClear({ type: 'drawStock' }));
    el('btnTakeTop').addEventListener('click', () => actAndClear({ type: 'takeDiscard', index: Room.state.discard.length - 1 }));
    el('btnMeld').addEventListener('click', () => actAndClear({ type: 'meld', cards: selectedCards(Room.state) }));
    el('btnDiscard').addEventListener('click', () => { const [card] = selectedCards(Room.state); if (card) actAndClear({ type: 'discard', card }); });
    el('btnClear').addEventListener('click', () => { selected.clear(); rerender(); });
    el('btnEndHand').addEventListener('click', () => actAndClear({ type: 'endHand' }));
    el('sortMode').addEventListener('change', e => { sortMode = e.target.value; rerender(); });
    el('btnNextHand').addEventListener('click', () => Room.update(gs => L.nextRound(gs)));
    el('btnNewMatch').addEventListener('click', () => Room.update(gs => L.start(gs)));
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave the game?')) Room.leave(); });
    el('btnLeaveAfter').addEventListener('click', () => { hide('handModal'); Room.leave(); });
  });
})();
