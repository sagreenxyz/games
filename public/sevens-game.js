/**
 * Sevens (Fan Tan) — UI and host orchestration.
 *
 * Rules live in sevens-logic.js (SevensLogic); networking, lobby and waiting
 * room live in room.js (Room).
 */
(function () {
  'use strict';

  const L = SevensLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;
  const RED_SUITS = new Set(['♥', '♦']);

  /** Whether the player has turned on move hints. Resets when their turn ends. */
  let hintActive = false;

  /* ───────────── Host orchestration ───────────── */

  function startGame(gs) {
    if (L.startGame(gs)) Room.pushState(gs);
  }

  function onAction(seat, payload) {
    const gs = Room.state;
    if (!gs || !payload) return;
    const res = L.applyAction(gs, seat, payload.action, payload.card);
    if (!res.ok) {
      if (seat === Room.mySeat) setText('actionMessage', res.error);
      return;
    }
    Room.pushState(gs);
  }

  function onPlayerLeft(gs, seat) {
    L.removePlayer(gs, seat);
    Room.pushState(gs);
  }

  function playAgain() {
    const gs = Room.state;
    if (!Room.amHost || !gs || gs.phase !== 'finished') return;
    hide('gameOverModal');
    L.resetToWaiting(gs);
    Room.pushState(gs);
  }

  /* ───────────── Rendering ───────────── */

  function cardHTML(card, { playable = false, highlight = false, faceDown = false } = {}) {
    if (faceDown) return `<div class="playing-card back"></div>`;
    const cls = RED_SUITS.has(card.s) ? 'red' : 'black';
    const style = highlight
      ? 'cursor:pointer;outline:3px solid #40916c;outline-offset:2px;'
      : playable ? 'cursor:pointer;' : '';
    const data = playable ? `data-rank="${escHtml(card.r)}" data-suit="${escHtml(card.s)}"` : '';
    return `<div class="playing-card ${cls}" ${data} style="${style}">
      <span class="card-rank-top">${card.r}</span>
      <span class="card-suit-mid">${card.s}</span>
      <span class="card-rank-bot">${card.r}</span>
    </div>`;
  }

  function boardCardHTML(rank, suit, played) {
    const base = 'display:inline-flex;flex-direction:column;justify-content:space-between;width:42px;height:60px;border-radius:6px;padding:3px 4px;font-size:.7rem;font-weight:700;user-select:none;';
    let look;
    if (!played) {
      look = 'border:1px dashed rgba(255,255,255,.18);background:rgba(255,255,255,.04);color:rgba(255,255,255,.2);';
    } else {
      const is7 = rank === '7';
      look = `border:${is7 ? '2px solid var(--gold-dark)' : '1px solid #ccc'};background:${is7 ? 'var(--gold)' : 'var(--card-bg)'};color:${RED_SUITS.has(suit) ? 'var(--red)' : 'var(--black)'};box-shadow:1px 1px 4px rgba(0,0,0,.3);`;
    }
    return `<div style="${base}${look}">
      <span>${rank}</span>
      <span style="font-size:1rem;text-align:center;">${suit}</span>
      <span aria-hidden="true" style="align-self:flex-end;transform:rotate(180deg);">${rank}</span>
    </div>`;
  }

  function renderBoard(board) {
    setHTML('boardRows', L.SUITS.map(suit => {
      const col = board[suit];
      const cells = L.RANKS.map(rank => {
        const v = L.RANK_VAL[rank];
        return boardCardHTML(rank, suit, col !== null && v >= col.min && v <= col.max);
      }).join('');
      return `<div style="display:flex;align-items:center;gap:.25rem;flex-wrap:wrap;">
        <span style="width:1.5rem;font-size:1.1rem;color:${RED_SUITS.has(suit) ? 'var(--red)' : '#fff'};flex-shrink:0;">${suit}</span>
        <div style="display:flex;gap:.2rem;flex-wrap:wrap;">${cells}</div>
      </div>`;
    }).join(''));
  }

  function renderActionLog(gs) {
    const list = el('actionLogList');
    if (!list) return;
    const entries = gs.actionLog || [];
    if (entries.length === 0) {
      list.innerHTML = '<span style="color:rgba(255,255,255,.3);font-style:italic;">Actions will appear here</span>';
      return;
    }
    list.innerHTML = [...entries].reverse().map(item => {
      if (item.startsWith('---')) {
        return `<div style="text-align:center;color:rgba(255,255,255,.45);font-size:.72rem;padding:.2rem 0;border-top:1px solid rgba(255,255,255,.1);margin:.2rem 0;">${escHtml(item)}</div>`;
      }
      const win = item.startsWith('🥇');
      return `<div style="color:${win ? 'var(--gold)' : 'rgba(255,255,255,.8)'};padding:.1rem 0;${win ? 'font-weight:600;' : ''}">${escHtml(item)}</div>`;
    }).join('');
  }

  function renderMyHand(gs, isFinished) {
    const me = gs.players[Room.mySeat];
    if (!me) return;
    const isMyTurn = gs.currentPlayer === Room.mySeat;
    if (!isMyTurn) hintActive = false;
    const myHand = safeParseJSON(me.handJSON, []);
    const validMoves = isMyTurn && !isFinished ? L.getValidMoves(gs.board, myHand) : [];

    setText('myNameLabel', me.name);
    let badge = '';
    if (me.finished) badge = '<span class="badge badge-gold">Finished</span>';
    else if (isMyTurn) badge = '<span class="badge badge-green">Your Turn</span>';
    setHTML('myStatusBadge', badge);
    setText('myCardCount', `${myHand.length} card${myHand.length !== 1 ? 's' : ''}`);

    if (myHand.length > 0) {
      const sorted = [...myHand].sort((a, b) =>
        (L.SUITS.indexOf(a.s) - L.SUITS.indexOf(b.s)) || (L.RANK_VAL[a.r] - L.RANK_VAL[b.r]));
      setHTML('myCards', sorted.map(card => {
        const isValid = validMoves.some(v => v.r === card.r && v.s === card.s);
        return cardHTML(card, { playable: isMyTurn && !isFinished, highlight: isValid && hintActive });
      }).join(''));
    } else {
      setHTML('myCards', '<span style="color:rgba(255,255,255,.3);font-style:italic;">No cards — you\'re done!</span>');
    }

    const mustPlay = validMoves.length > 0;
    el('btnPass').disabled = !(isMyTurn && !isFinished && !mustPlay);
    const hintBtn = el('btnHint');
    if (hintBtn) {
      hintBtn.disabled = !mustPlay;
      hintBtn.textContent = hintActive ? '💡 Hints On' : '💡 Hint';
      hintBtn.style.outline = hintActive ? '2px solid #40916c' : '';
    }

    let msg;
    if (isFinished) msg = gs.lastAction || '';
    else if (isMyTurn) {
      msg = !mustPlay ? 'No valid moves — click Pass.'
        : hintActive ? 'Click a highlighted card to play it.'
        : 'Click a card to play it, or use Hint to see valid moves.';
    } else {
      const cp = gs.players[gs.currentPlayer];
      msg = cp ? `Waiting for ${cp.name}…` : '';
    }
    setText('actionMessage', msg);
  }

  function renderOpponents(gs) {
    let html = '';
    for (let i = 0; i < L.MAX_PLAYERS; i++) {
      if (i === Room.mySeat) continue;
      const p = gs.players[i];
      if (!p || p.isEmpty) continue;
      const count = handSize(p);
      const isTurn = i === gs.currentPlayer;
      let badges = '';
      if (p.finished) badges += '<span class="badge badge-gold" style="font-size:.7rem;">Finished</span>';
      if (p.disconnected) badges += '<span class="badge badge-gray" style="font-size:.7rem;margin-left:.25rem;">Left</span>';
      if (isTurn) badges += '<span class="badge badge-green" style="font-size:.7rem;margin-left:.25rem;">Turn</span>';

      html += `<div style="background:rgba(0,0,0,.3);border-radius:var(--radius);padding:.9rem;border:2px solid ${isTurn ? 'var(--gold)' : 'transparent'};opacity:${!p.disconnected && !p.finished ? 1 : 0.6};">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
          <strong>${escHtml(p.name)}</strong>${badges}
          <span style="margin-left:auto;font-size:.85rem;color:rgba(255,255,255,.6);">${count} 🃏</span>
        </div>
        <div class="opp-cards-desktop" style="display:flex;gap:.3rem;flex-wrap:wrap;min-height:30px;align-items:center;">
          ${Array.from({ length: Math.min(count, 5) }, () => cardHTML(null, { faceDown: true })).join('')}
          ${count > 5 ? `<span style="color:rgba(255,255,255,.4);font-size:.8rem;">+${count - 5}</span>` : ''}
        </div>
        <div class="opp-cards-mobile" style="font-size:.85rem;color:rgba(255,255,255,.55);">${count} card${count !== 1 ? 's' : ''} remaining</div>
        ${p.passCount ? `<div style="font-size:.75rem;color:rgba(255,255,255,.4);margin-top:.3rem;">Passed: ${p.passCount}×</div>` : ''}
      </div>`;
    }
    setHTML('opponentsRow', html);
  }

  function showGameOverModal(gs) {
    const medals = ['🥇', '🥈', '🥉'];
    const html = (gs.finishOrder || []).map((s, i) => {
      const p = gs.players[s];
      return `<div style="margin:.3rem 0;">${medals[i] || `${i + 1}.`} <strong>${escHtml(p?.name || '')}</strong>${p?.passCount ? ` — passed ${p.passCount}×` : ''}</div>`;
    }).join('');
    setHTML('gameOverResults', html || '<div>No results recorded.</div>');
    if (Room.amHost) { show('btnPlayAgain'); hide('gameOverGuestMsg'); }
    else { hide('btnPlayAgain'); show('gameOverGuestMsg'); }
    show('gameOverModal');
  }

  function render(gs) {
    renderBoard(gs.board);
    setText('roundLabel', `Round ${gs.round}`);
    const isFinished = gs.phase === 'finished';
    if (isFinished) {
      setText('turnIndicator', gs.lastAction || 'Game over!');
      if (el('gameOverModal')?.classList.contains('hidden')) showGameOverModal(gs);
    } else {
      hide('gameOverModal');
      const cp = gs.players[gs.currentPlayer];
      setText('turnIndicator', gs.currentPlayer === Room.mySeat ? '🟢 Your turn!' : `Waiting for ${cp?.name || '…'}…`);
    }
    renderMyHand(gs, isFinished);
    renderOpponents(gs);
    renderActionLog(gs);
  }

  /* ───────────── Wiring ───────────── */

  Room.init({
    maxPlayers: L.MAX_PLAYERS,
    freshRoomState: L.buildFreshRoomState,
    freshPlayer: L.freshPlayer,
    onStart: startGame,
    onAction,
    onPlayerLeft,
    render,
    onLeave: () => { hintActive = false; hide('gameOverModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards')?.addEventListener('click', e => {
      const node = e.target.closest('[data-rank][data-suit]');
      const gs = Room.state;
      if (!node || !gs || gs.currentPlayer !== Room.mySeat) return;
      const card = { r: node.dataset.rank, s: node.dataset.suit };
      const hand = safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
      if (!L.getValidMoves(gs.board, hand).some(v => v.r === card.r && v.s === card.s)) {
        setText('actionMessage', `${card.r}${card.s} can't be played yet.`);
        return;
      }
      hintActive = false;
      Room.act({ action: 'play', card });
    });
    el('btnPass')?.addEventListener('click', () => { hintActive = false; Room.act({ action: 'pass' }); });
    el('btnHint')?.addEventListener('click', () => {
      hintActive = !hintActive;
      if (Room.state) render(Room.state);
    });
    el('btnLeaveGame')?.addEventListener('click', () => { if (confirm('Leave the game?')) Room.leave(); });
    el('btnPlayAgain')?.addEventListener('click', playAgain);
    el('btnLeaveAfterGame')?.addEventListener('click', () => { hide('gameOverModal'); Room.leave(); });
  });
})();
