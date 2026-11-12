/**
 * Crazy Eights — UI. Rules: crazy-eights-logic.js. Networking: room.js.
 */
(function () {
  'use strict';

  const C = CrazyEightsLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;
  let pendingEight = null; // an 8 waiting for a suit choice

  const myHand = gs => safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
  const isMyTurn = gs => gs.phase === 'playing' && gs.currentPlayer === Room.mySeat;
  const nameOf = (gs, s) => gs.players[s]?.name || `Seat ${s + 1}`;

  function render(gs) {
    setText('roundLabel', `Hand ${gs.round}`);
    const cp = gs.players[gs.currentPlayer];
    setText('turnLabel', gs.phase !== 'playing' ? '' : isMyTurn(gs) ? '🟢 Your turn' : `Waiting for ${cp?.name || '…'}${cp?.disconnected ? ' (reconnecting…)' : ''}`);

    // Opponents
    let opp = '';
    for (const k of Object.keys(gs.players)) {
      const s = Number(k), p = gs.players[s];
      if (s === Room.mySeat || !p || p.isEmpty) continue;
      const n = handSize(p), turn = gs.currentPlayer === s;
      opp += `<div class="opp${turn ? ' turn' : ''}${p.disconnected ? ' out' : ''}">
        <div class="opp-head"><strong>${escHtml(p.name)}</strong>
          ${p.disconnected ? `<span class="badge badge-gray">${p.left ? 'Left' : 'Reconnecting…'}</span>` : ''}
          ${turn ? '<span class="badge badge-green">Turn</span>' : ''}
          <span class="right">${p.score} pts · ${n} 🃏</span></div>
        <div class="cards-row fan" style="min-height:62px;">${Array.from({ length: Math.min(n, 12) }, () => Cards.cardHTML(null, { faceDown: true, small: true })).join('')}</div>
      </div>`;
    }
    setHTML('opponentsRow', opp);

    // Piles
    const legal = C.legalActions(gs, Room.mySeat);
    const canDraw = legal.some(a => a.type === 'draw');
    const stockN = gs.stockCount ?? gs.stock?.length ?? 0;
    el('stockPile').innerHTML = stockN ? Cards.cardHTML(null, { faceDown: true }) : '<div class="playing-card empty"></div>';
    el('stockPile').disabled = !canDraw;
    setText('stockCount', `Stock: ${stockN}`);
    const t = gs.discard[gs.discard.length - 1];
    setHTML('discardTop', t ? Cards.cardHTML(t) : '');
    setHTML('followLabel', gs.declaredSuit
      ? `Follow: <strong style="font-size:1.2rem;color:${Cards.isRed({ s: gs.declaredSuit }) ? '#ff8a8a' : '#fff'}">${gs.declaredSuit}</strong>`
      : 'Discard');

    // My hand — highlight the cards I can play
    const me = gs.players[Room.mySeat];
    if (me) {
      setText('myNameLabel', me.name);
      setText('myScore', `${me.score} pts`);
      const hand = myHand(gs);
      const turn = isMyTurn(gs);
      const can = c => legal.some(a => a.type === 'play' && Cards.same(a.card, c));
      setHTML('myCards', Cards.sortCards(hand).map(c => Cards.cardHTML(c, {
        playable: turn && can(c), highlight: turn && can(c), dim: turn && !can(c),
        selected: pendingEight && Cards.same(c, pendingEight),
      })).join('') || '<span class="placeholder">No cards</span>');
    }

    // Actions
    hide('btnDraw'); hide('btnPass');
    if (!isMyTurn(gs)) pendingEight = null;
    el('suitPicker').classList.toggle('hidden', !pendingEight);
    let msg = '';
    if (isMyTurn(gs)) {
      if (pendingEight) msg = 'Name the suit the next player must follow.';
      else if (gs.drawnCard) { show('btnPass'); msg = `You drew ${gs.drawnCard.r}${gs.drawnCard.s} — play it or pass.`; }
      else if (canDraw) { show('btnDraw'); msg = "You can't play — draw a card."; }
      else if (legal.some(a => a.type === 'pass')) { show('btnPass'); msg = 'No cards to draw — pass.'; }
      else msg = 'Play a highlighted card.';
    }
    setText('actionMessage', msg);

    renderModal(gs);
    setHTML('actionLogList', [...(gs.actionLog || [])].reverse()
      .map(l => `<div class="${l.startsWith('---') ? 'sep' : l.startsWith('🏆') ? 'win' : ''}">${escHtml(l)}</div>`).join(''));
  }

  function renderModal(gs) {
    if (gs.phase !== 'handOver' && gs.phase !== 'matchOver') { hide('handModal'); return; }
    const res = gs.result;
    const title = gs.phase === 'matchOver'
      ? `🏆 ${escHtml(nameOf(gs, gs.final.winner))} wins the match!`
      : `${escHtml(nameOf(gs, res.winner))} ${res.blocked ? 'wins a blocked hand' : 'goes out'} — ${res.rows[res.winner].points} points`;
    let body = gs.final?.forfeit ? '<p>Everyone else left.</p>' : '';
    if (res) {
      const seats = Object.keys(res.rows).map(Number);
      body += `<table class="score-table"><tr><th>Player</th><th class="num">Left in hand</th><th class="num">This hand</th><th class="num">Total</th></tr>${
        seats.map(s => `<tr><td>${escHtml(nameOf(gs, s))}</td><td class="num">${res.rows[s].inHand}</td><td class="num">${res.rows[s].points}</td><td class="num">${gs.players[s].score}</td></tr>`).join('')}</table>
        <p class="muted small">First to ${C.TARGET} wins.</p>`;
    }
    setHTML('handTitle', title);
    setHTML('handDetails', body);
    el('btnNextHand').classList.toggle('hidden', !(Room.amHost && gs.phase === 'handOver'));
    el('btnNewMatch').classList.toggle('hidden', !(Room.amHost && gs.phase === 'matchOver' && !gs.final?.forfeit));
    el('handWaitMsg').classList.toggle('hidden', Room.amHost || !!gs.final?.forfeit);
    show('handModal');
  }

  const rerender = () => Room.state && render(Room.state);

  Room.init({
    logic: C,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => { pendingEight = null; hide('handModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      if (!node) return;
      const card = Cards.fromKey(node.dataset.card);
      if (card.r === '8') { pendingEight = card; rerender(); return; }
      Room.act({ type: 'play', card });
    });
    el('suitPicker').addEventListener('click', e => {
      const b = e.target.closest('[data-suit]');
      if (!b || !pendingEight) return;
      const card = pendingEight; pendingEight = null;
      Room.act({ type: 'play', card, suit: b.dataset.suit });
    });
    el('btnCancelEight').addEventListener('click', () => { pendingEight = null; rerender(); });
    el('stockPile').addEventListener('click', () => Room.act({ type: 'draw' }));
    el('btnDraw').addEventListener('click', () => Room.act({ type: 'draw' }));
    el('btnPass').addEventListener('click', () => Room.act({ type: 'pass' }));
    el('btnNextHand').addEventListener('click', () => Room.update(gs => C.nextRound(gs)));
    el('btnNewMatch').addEventListener('click', () => Room.update(gs => C.start(gs)));
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave the game?')) Room.leave(); });
    el('btnLeaveAfter').addEventListener('click', () => { hide('handModal'); Room.leave(); });
  });
})();
