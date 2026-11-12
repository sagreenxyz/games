/**
 * Poker — Texas Hold'em UI and host orchestration.
 *
 * Rules live in poker-logic.js (PokerLogic); networking, lobby, waiting room
 * and applying actions live in room.js (Room). This file renders the table
 * and, on the host, schedules the next hand and auto-folds absent players.
 */
(function () {
  'use strict';

  const L = PokerLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize } = Room;
  const NEXT_ROUND_DELAY_MS = 10000;
  const AUTO_FOLD_DELAY_MS = 10000; // give a refreshing player a moment to come back

  let roundAdvanceTimeout = null;
  let autoFoldTimeout = null;

  /* ───────────── Host orchestration ───────────── */

  function nextHand() {
    clearTimeout(roundAdvanceTimeout);
    Room.update(gs => { L.startHand(gs); });
  }

  /** Runs on the host after every state change. */
  function onHostState(gs) {
    if (gs.phase === 'showdown') {
      clearTimeout(roundAdvanceTimeout);
      roundAdvanceTimeout = setTimeout(() => {
        if (Room.amHost && Room.state?.phase === 'showdown') nextHand();
      }, NEXT_ROUND_DELAY_MS);
      return;
    }
    const seat = gs.currentPlayer;
    if (seat !== -1 && gs.players[seat]?.disconnected) {
      clearTimeout(autoFoldTimeout);
      autoFoldTimeout = setTimeout(() => {
        const cur = Room.state;
        if (!cur || cur.currentPlayer !== seat) return;
        if (cur.players[seat]?.disconnected && L.applyAction(cur, seat, 'fold').ok) Room.pushState(cur);
      }, AUTO_FOLD_DELAY_MS);
    }
  }

  /* ───────────── Rendering ───────────── */

  const cardHTML = (card, faceDown = false) => Cards.cardHTML(card, { faceDown });
  const placeholder = text => `<span class="placeholder">${text}</span>`;

  function renderActionLog(gs) {
    const list = el('actionLogList');
    if (!list) return;
    const entries = gs.actionLog || [];
    if (entries.length === 0) { list.innerHTML = placeholder('Actions will appear here'); return; }
    list.innerHTML = [...entries].reverse().map(item => {
      const cls = item.startsWith('---') ? 'sep' : item.startsWith('🏆') ? 'win' : '';
      return `<div class="${cls}">${escHtml(item)}</div>`;
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
      if (p.disconnected) badges += `<span class="badge badge-gray" style="font-size:.7rem;">${p.left ? 'Left' : 'Reconnecting…'}</span>`;
      else if (!p.active && gs.phase !== 'waiting') badges += '<span class="badge badge-gray" style="font-size:.7rem;">Sitting out</span>';
      if (p.folded) badges += '<span class="badge badge-gray" style="font-size:.7rem;margin-left:.25rem;">Folded</span>';
      if (p.allIn) badges += '<span class="badge badge-gold" style="font-size:.7rem;margin-left:.25rem;">All-In</span>';
      if (isTurn) badges += '<span class="badge badge-green" style="font-size:.7rem;margin-left:.25rem;">Turn</span>';

      const cards = revealed
        ? hand.map(c => cardHTML(c)).join('')
        : Array.from({ length: count }, () => cardHTML(null, true)).join('');

      html += `<div class="opp${isTurn ? ' turn' : ''}${p.folded || p.disconnected ? ' out' : ''}">
        <div class="opp-head">
          <strong>${escHtml(p.name)}</strong>
          ${badges}
          <span class="chips right">${p.chips}</span>
        </div>
        <div class="cards-row">${cards || '<span class="placeholder small">—</span>'}</div>
        ${p.bet > 0 ? `<div class="muted small">Bet: ${p.bet}</div>` : ''}
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
    const legal = L.bettingOptions(gs, Room.mySeat);
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
      else if (me && !me.active) setText('turnIndicator', 'You are sitting out this hand — you will be dealt in next hand.');
      else {
        const cp = gs.players[gs.currentPlayer];
        setText('turnIndicator', cp ? `Waiting for ${cp.name}${cp.disconnected ? ' (reconnecting…)' : ''}…` : 'Waiting…');
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
    logic: L,
    render,
    onHostState,
    onLeave,
    onError: msg => setText('gameMessage', msg),
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('btnFold')?.addEventListener('click', () => Room.act({ type: 'fold' }));
    el('btnCheck')?.addEventListener('click', () => Room.act({ type: 'check' }));
    el('btnCall')?.addEventListener('click', () => Room.act({ type: 'call' }));
    el('btnRaise')?.addEventListener('click', () => {
      const amount = parseInt(el('raiseAmount')?.value || '0', 10);
      if (!Number.isInteger(amount) || amount <= 0) return;
      Room.act({ type: 'raise', amount });
    });
    el('btnLeaveGame')?.addEventListener('click', () => {
      if (confirm('Drop out? You will be folded out of the current hand.')) Room.leave();
    });
    el('btnPlayAgain')?.addEventListener('click', () => {
      if (Room.amHost && Room.state?.phase === 'showdown') { hide('roundOverModal'); nextHand(); }
    });
    el('btnLeaveAfterRound')?.addEventListener('click', () => { hide('roundOverModal'); Room.leave(); });
  });
})();
