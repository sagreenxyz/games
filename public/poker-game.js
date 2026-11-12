/**
 * Poker — Texas Hold'em UI and host orchestration.
 *
 * Rules live in poker-logic.js (PokerLogic); networking, lobby and waiting
 * room live in room.js (Room). This file renders the table and, on the host,
 * applies actions and schedules round transitions.
 */
(function () {
  'use strict';

  const L = PokerLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;
  const RED_SUITS = new Set(['♥', '♦']);
  const NEXT_ROUND_DELAY_MS = 10000;
  const AUTO_FOLD_DELAY_MS = 1500;

  let roundAdvanceTimeout = null;
  let autoFoldTimeout = null;

  /* ───────────── Host orchestration ───────────── */

  function startHand(gs) {
    clearTimeout(roundAdvanceTimeout);
    L.startHand(gs);
    Room.pushState(gs);
  }

  function onAction(seat, payload) {
    const gs = Room.state;
    if (!gs || !payload) return;
    const res = L.applyAction(gs, seat, payload.action, payload.amount);
    if (!res.ok) {
      if (seat === Room.mySeat) setText('gameMessage', res.error);
      return;
    }
    Room.pushState(gs);
  }

  function onPlayerLeft(gs) {
    Room.pushState(gs); // onHostState will auto-fold them when it's their turn
  }

  /** Runs on the host after every state change. */
  function onHostState(gs) {
    if (gs.phase === 'showdown') {
      clearTimeout(roundAdvanceTimeout);
      roundAdvanceTimeout = setTimeout(() => {
        if (Room.amHost && Room.state?.phase === 'showdown') startHand(Room.state);
      }, NEXT_ROUND_DELAY_MS);
      return;
    }
    const seat = gs.currentPlayer;
    if (seat !== -1 && gs.players[seat]?.disconnected) {
      clearTimeout(autoFoldTimeout);
      autoFoldTimeout = setTimeout(() => {
        const cur = Room.state;
        if (!cur || cur.currentPlayer !== seat) return;
        if (L.applyAction(cur, seat, 'fold').ok) Room.pushState(cur);
      }, AUTO_FOLD_DELAY_MS);
    }
  }

  /* ───────────── Rendering ───────────── */

  function cardHTML(card, faceDown = false) {
    if (faceDown || !card) return `<div class="playing-card back" title="Hidden card"></div>`;
    const cls = RED_SUITS.has(card.s) ? 'red' : 'black';
    return `<div class="playing-card ${cls}">
      <span class="card-rank-top">${card.r}</span>
      <span class="card-suit-mid">${card.s}</span>
      <span class="card-rank-bot">${card.r}</span>
    </div>`;
  }

  const placeholder = text => `<span style="color:rgba(255,255,255,.3);font-style:italic;">${text}</span>`;

  function renderActionLog(gs) {
    const list = el('actionLogList');
    if (!list) return;
    const entries = gs.actionLog || [];
    if (entries.length === 0) { list.innerHTML = placeholder('Actions will appear here'); return; }
    list.innerHTML = [...entries].reverse().map(item => {
      if (item.startsWith('---')) {
        return `<div style="text-align:center;color:rgba(255,255,255,.45);font-size:.72rem;padding:.2rem 0;border-top:1px solid rgba(255,255,255,.1);margin:.2rem 0;">${escHtml(item)}</div>`;
      }
      const win = item.startsWith('🏆');
      return `<div style="color:${win ? 'var(--gold)' : 'rgba(255,255,255,.8)'};padding:.1rem 0;${win ? 'font-weight:600;' : ''}">${escHtml(item)}</div>`;
    }).join('');
  }

  function renderOpponents(gs) {
    let html = '';
    for (let i = 0; i < L.MAX_PLAYERS; i++) {
      if (i === Room.mySeat) continue;
      const p = gs.players[i];
      if (!p || p.isEmpty) continue;
      const isTurn = i === gs.currentPlayer;
      const hand = safeParseJSON(p.handJSON, []);
      const revealed = L.canSeeHand(gs, Room.mySeat, i) && hand.length > 0;
      const count = handSize(p);

      let badges = '';
      if (p.disconnected) badges += '<span class="badge badge-gray" style="font-size:.7rem;">Disconnected</span>';
      if (p.folded) badges += '<span class="badge badge-gray" style="font-size:.7rem;margin-left:.25rem;">Folded</span>';
      if (p.allIn) badges += '<span class="badge badge-gold" style="font-size:.7rem;margin-left:.25rem;">All-In</span>';
      if (isTurn) badges += '<span class="badge badge-green" style="font-size:.7rem;margin-left:.25rem;">Turn</span>';

      const cards = revealed
        ? hand.map(c => cardHTML(c)).join('')
        : Array.from({ length: count }, () => cardHTML(null, true)).join('');

      html += `<div style="background:rgba(0,0,0,.3);border-radius:var(--radius);padding:.9rem;border:2px solid ${isTurn ? 'var(--gold)' : 'transparent'};opacity:${!p.folded && !p.disconnected ? 1 : 0.5};">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
          <strong>${escHtml(p.name)}</strong>
          ${badges}
          <span class="chips" style="margin-left:auto;font-size:.85rem;">${p.chips}</span>
        </div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;min-height:60px;align-items:center;">
          ${cards || '<span style="color:rgba(255,255,255,.2);font-size:.8rem;">—</span>'}
        </div>
        ${p.bet > 0 ? `<div style="font-size:.75rem;color:rgba(255,255,255,.5);margin-top:.3rem;">Bet: ${p.bet}</div>` : ''}
      </div>`;
    }
    setHTML('opponentsRow', html);
  }

  function setButtons(legal) {
    el('btnFold').disabled = !legal.canAct;
    el('btnCheck').disabled = !legal.canCheck;
    el('btnCall').disabled = !legal.canCall;
    el('btnRaise').disabled = !legal.canRaise;
    el('raiseAmount').disabled = !legal.canRaise;
  }

  let lastPromptKey = '';

  function renderActions(gs) {
    const me = gs.players[Room.mySeat];
    const legal = L.legalActions(gs, Room.mySeat);
    setButtons(legal);

    if (gs.phase === 'showdown') {
      setHTML('turnIndicator', gs.winnerInfo ? `<span style="color:var(--gold);">${escHtml(gs.winnerInfo)}</span>` : '');
      if (el('roundOverModal')?.classList.contains('hidden')) showRoundOverModal(gs.winnerInfo);
      return;
    }
    hide('roundOverModal');

    if (legal.canAct) {
      el('btnCall').textContent = legal.toCall >= me.chips ? `Call ${me.chips} (all-in)` : `Call ${legal.toCall}`;
      const input = el('raiseAmount');
      input.min = legal.minRaise;
      input.max = legal.maxRaise;
      input.step = 10;
      // Only reset the amount when a new decision starts, not on every re-render
      const key = `${gs.round}:${gs.phase}:${gs.currentBet}:${gs.actionLog?.length}`;
      if (key !== lastPromptKey) { input.value = legal.minRaise; lastPromptKey = key; }
      el('btnRaise').textContent = legal.maxRaise <= legal.minRaise ? 'All-in' : 'Raise by';
      setText('turnIndicator', '🟢 Your turn — choose an action');
    } else {
      el('btnCall').textContent = 'Call';
      el('btnRaise').textContent = 'Raise by';
      if (me?.folded) setText('turnIndicator', 'You folded. Waiting for the round to end…');
      else if (me?.allIn) setText('turnIndicator', 'You are all-in. Waiting for the hand to resolve…');
      else {
        const cp = gs.players[gs.currentPlayer];
        setText('turnIndicator', cp ? `Waiting for ${cp.name}…` : 'Waiting…');
      }
    }
  }

  function render(gs) {
    setText('roundLabel', `Round ${gs.round}`);
    setText('phaseLabel', L.phaseLabel(gs.phase));
    setText('potDisplay', gs.pot);
    setText('currentBetDisplay', gs.currentBet);

    const cc = gs.communityCards || [];
    setHTML('communityCards', cc.length ? cc.map(c => cardHTML(c)).join('') : placeholder('Cards will appear here'));

    const me = gs.players[Room.mySeat];
    if (me) {
      setText('myNameLabel', me.name);
      setText('myChipsLabel', me.chips);
      const myHand = safeParseJSON(me.handJSON, []);
      setHTML('myCards', myHand.length ? myHand.map(c => cardHTML(c)).join('') : placeholder('Your cards will appear here'));
      const rank = cc.length && myHand.length ? L.evalHand([...myHand, ...cc]) : null;
      setText('handRankDisplay', rank ? `Your hand: ${rank.name}` : '');

      let badge = '';
      if (me.folded) badge = '<span class="badge badge-gray">Folded</span>';
      else if (me.allIn) badge = '<span class="badge badge-gold">All-In</span>';
      else if (gs.currentPlayer === Room.mySeat) badge = '<span class="badge badge-green">Your Turn</span>';
      setHTML('myStatusBadge', badge);
    }

    renderOpponents(gs);
    renderActions(gs);
    setText('gameMessage', gs.lastAction || '');
    renderActionLog(gs);
  }

  function showRoundOverModal(winnerInfo) {
    setText('roundOverWinner', winnerInfo || '');
    if (Room.amHost) { show('roundOverHostControls'); hide('roundOverGuestMsg'); }
    else { hide('roundOverHostControls'); show('roundOverGuestMsg'); }
    show('roundOverModal');
  }

  /* ───────────── Wiring ───────────── */

  function onLeave() {
    clearTimeout(roundAdvanceTimeout);
    clearTimeout(autoFoldTimeout);
    hide('roundOverModal');
    lastPromptKey = '';
  }

  Room.init({
    maxPlayers: L.MAX_PLAYERS,
    freshRoomState: L.buildFreshRoomState,
    freshPlayer: L.freshPlayer,
    canSeeHand: L.canSeeHand,
    onStart: startHand,
    onAction,
    onPlayerLeft,
    onHostState,
    render,
    onLeave,
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('btnFold')?.addEventListener('click', () => Room.act({ action: 'fold' }));
    el('btnCheck')?.addEventListener('click', () => Room.act({ action: 'check' }));
    el('btnCall')?.addEventListener('click', () => Room.act({ action: 'call' }));
    el('btnRaise')?.addEventListener('click', () => {
      const amount = parseInt(el('raiseAmount')?.value || '0', 10);
      if (!Number.isInteger(amount) || amount <= 0) return;
      Room.act({ action: 'raise', amount });
    });
    el('btnLeaveGame')?.addEventListener('click', () => {
      if (confirm('Drop out? You will be folded out of the current hand.')) Room.leave();
    });
    el('btnPlayAgain')?.addEventListener('click', () => {
      if (Room.amHost && Room.state?.phase === 'showdown') { hide('roundOverModal'); startHand(Room.state); }
    });
    el('btnLeaveAfterRound')?.addEventListener('click', () => { hide('roundOverModal'); Room.leave(); });
  });
})();
