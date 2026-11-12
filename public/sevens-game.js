/**
 * Sevens (Fan Tan) — UI. Rules: sevens-logic.js. Networking: room.js.
 */
(function () {
  'use strict';

  const L = SevensLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;

  /** Whether the player has turned on move hints. Resets when their turn ends. */
  let hintActive = false;

  function boardCardHTML(rank, suit, played) {
    if (played) return Cards.cardHTML({ r: rank, s: suit }, { small: true, extra: rank === '7' ? 'style="background:var(--gold);"' : '' });
    return `<div class="playing-card small empty" style="background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.18);box-shadow:none;color:rgba(255,255,255,.2);">
      <span class="card-rank-top">${rank}</span><span class="card-suit-mid">${suit}</span><span class="card-rank-bot">${rank}</span></div>`;
  }

  function renderBoard(board) {
    setHTML('boardRows', L.SUITS.map(suit => {
      const col = board[suit];
      const cells = L.RANKS.map(rank => {
        const v = L.RANK_VAL[rank];
        return boardCardHTML(rank, suit, col !== null && v >= col.min && v <= col.max);
      }).join('');
      return `<div class="row wrap" style="gap:.25rem;">
        <span style="width:1.5rem;font-size:1.1rem;color:${Cards.isRed({ s: suit }) ? 'var(--red)' : '#fff'};">${suit}</span>
        <div class="row wrap" style="gap:.2rem;">${cells}</div>
      </div>`;
    }).join(''));
  }

  function renderActionLog(gs) {
    const list = el('actionLogList');
    if (!list) return;
    const entries = gs.actionLog || [];
    list.innerHTML = entries.length
      ? [...entries].reverse().map(item => `<div class="${item.startsWith('---') ? 'sep' : item.startsWith('🥇') ? 'win' : ''}">${escHtml(item)}</div>`).join('')
      : '<span class="placeholder">Actions will appear here</span>';
  }

  function renderMyHand(gs, isFinished) {
    const me = gs.players[Room.mySeat];
    if (!me) return;
    const isMyTurn = gs.currentPlayer === Room.mySeat;
    if (!isMyTurn) hintActive = false;
    const myHand = safeParseJSON(me.handJSON, []);
    const validMoves = isMyTurn && !isFinished ? L.getValidMoves(gs.board, myHand) : [];

    setText('myNameLabel', me.name);
    setHTML('myStatusBadge', me.finished ? '<span class="badge badge-gold">Finished</span>'
      : isMyTurn ? '<span class="badge badge-green">Your Turn</span>' : '');
    setText('myCardCount', `${myHand.length} card${myHand.length !== 1 ? 's' : ''}`);

    if (myHand.length > 0) {
      const sorted = Cards.sortCards(myHand, { suitOrder: L.SUITS });
      setHTML('myCards', sorted.map(card => Cards.cardHTML(card, {
        playable: isMyTurn && !isFinished,
        highlight: hintActive && validMoves.some(v => Cards.same(v, card)),
      })).join(''));
    } else {
      setHTML('myCards', '<span class="placeholder">No cards — you\'re done!</span>');
    }

    const mustPlay = validMoves.length > 0;
    el('btnPass').disabled = !(isMyTurn && !isFinished && !mustPlay);
    const hintBtn = el('btnHint');
    hintBtn.disabled = !mustPlay;
    hintBtn.textContent = hintActive ? '💡 Hints On' : '💡 Hint';

    let msg;
    if (isFinished) msg = gs.lastAction || '';
    else if (isMyTurn) {
      msg = !mustPlay ? 'No valid moves — click Pass.'
        : hintActive ? 'Click a highlighted card to play it.'
        : 'Click a card to play it, or use Hint to see valid moves.';
    } else {
      const cp = gs.players[gs.currentPlayer];
      msg = cp ? `Waiting for ${cp.name}${cp.disconnected ? ' to reconnect' : ''}…` : '';
    }
    setText('actionMessage', msg);
  }

  function renderOpponents(gs) {
    let html = '';
    for (let i = 0; i < L.MAX_PLAYERS; i++) {
      const p = gs.players[i];
      if (i === Room.mySeat || !p || p.isEmpty) continue;
      const count = handSize(p);
      const isTurn = i === gs.currentPlayer;
      let badges = '';
      if (p.finished) badges += '<span class="badge badge-gold">Finished</span>';
      if (p.disconnected) badges += `<span class="badge badge-gray">${p.left ? 'Left' : 'Reconnecting…'}</span>`;
      if (isTurn) badges += '<span class="badge badge-green">Turn</span>';
      html += `<div class="opp${isTurn ? ' turn' : ''}${p.left || p.finished ? ' out' : ''}">
        <div class="opp-head"><strong>${escHtml(p.name)}</strong>${badges}<span class="right">${count} 🃏</span></div>
        <div class="opp-cards-desktop cards-row" style="min-height:30px;">
          ${Array.from({ length: Math.min(count, 5) }, () => Cards.cardHTML(null, { faceDown: true, small: true })).join('')}
          ${count > 5 ? `<span class="muted small">+${count - 5}</span>` : ''}
        </div>
        <div class="opp-cards-mobile muted small">${count} card${count !== 1 ? 's' : ''} remaining</div>
        ${p.passCount ? `<div class="muted small">Passed: ${p.passCount}×</div>` : ''}
      </div>`;
    }
    setHTML('opponentsRow', html);
  }

  function showGameOverModal(gs) {
    const medals = ['🥇', '🥈', '🥉'];
    setHTML('gameOverResults', (gs.finishOrder || []).map((s, i) => {
      const p = gs.players[s];
      return `<div style="margin:.3rem 0;">${medals[i] || `${i + 1}.`} <strong>${escHtml(p?.name || '')}</strong>${p?.passCount ? ` — passed ${p.passCount}×` : ''}</div>`;
    }).join('') || '<div>No results recorded.</div>');
    if (Room.amHost) { show('btnPlayAgain'); hide('gameOverGuestMsg'); } else { hide('btnPlayAgain'); show('gameOverGuestMsg'); }
    show('gameOverModal');
  }

  function render(gs) {
    renderBoard(gs.board);
    setText('roundLabel', `Round ${gs.round}`);
    const isFinished = gs.phase === 'finished';
    if (isFinished) {
      setText('turnIndicator', gs.lastAction || 'Game over!');
      if (el('gameOverModal').classList.contains('hidden')) showGameOverModal(gs);
    } else {
      hide('gameOverModal');
      const cp = gs.players[gs.currentPlayer];
      setText('turnIndicator', gs.currentPlayer === Room.mySeat ? '🟢 Your turn!' : `Waiting for ${cp?.name || '…'}…`);
    }
    renderMyHand(gs, isFinished);
    renderOpponents(gs);
    renderActionLog(gs);
  }

  Room.init({
    logic: L,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => { hintActive = false; hide('gameOverModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      const gs = Room.state;
      if (!node || !gs || gs.currentPlayer !== Room.mySeat) return;
      const card = Cards.fromKey(node.dataset.card);
      const hand = safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
      if (!L.getValidMoves(gs.board, hand).some(v => Cards.same(v, card))) {
        setText('actionMessage', `${card.r}${card.s} can't be played yet.`);
        return;
      }
      hintActive = false;
      Room.act({ type: 'play', card });
    });
    el('btnPass').addEventListener('click', () => { hintActive = false; Room.act({ type: 'pass' }); });
    el('btnHint').addEventListener('click', () => { hintActive = !hintActive; if (Room.state) render(Room.state); });
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave the game?')) Room.leave(); });
    el('btnPlayAgain').addEventListener('click', () => {
      hide('gameOverModal');
      Room.update(gs => { if (gs.phase !== 'finished') return false; L.resetToWaiting(gs); });
    });
    el('btnLeaveAfterGame').addEventListener('click', () => { hide('gameOverModal'); Room.leave(); });
  });
})();
