/**
 * Spades — UI. Rules: spades-logic.js. Shared table helpers: trick-ui.js.
 */
(function () {
  'use strict';

  const S = SpadesLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON } = Room;

  const myHand = gs => safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
  const nameOf = (gs, s) => gs.players[s]?.name || `Seat ${s + 1}`;
  const bidText = b => (b === null || b === undefined ? '—' : b === 0 ? 'Nil' : String(b));
  const teamLabel = (gs, t) => `${S.TEAM_NAMES[t]} (${escHtml(nameOf(gs, t))} & ${escHtml(nameOf(gs, t + 2))})`;

  function render(gs) {
    setText('roundLabel', `Hand ${gs.round}`);
    const myTeam = S.teamOf(Room.mySeat);
    setText('infoLabel', `${S.TEAM_NAMES[myTeam]} (you) ${gs.teams[myTeam].score} · ${S.TEAM_NAMES[1 - myTeam]} ${gs.teams[1 - myTeam].score}${gs.spadesBroken ? ' · Spades broken ♠' : ''}`);
    TrickUI.renderSeats(gs, (s, p) => `${S.teamOf(s) === myTeam ? 'Partner' : 'Opponent'} · bid ${bidText(p.bid)} · won ${p.tricks}`);
    TrickUI.renderTrick(gs);

    const me = gs.players[Room.mySeat];
    const myTurn = gs.currentPlayer === Room.mySeat;
    const playing = gs.phase === 'playing';
    const legal = playing && myTurn ? S.playableCards(gs, Room.mySeat) : [];
    if (me) {
      setText('myNameLabel', me.name);
      setText('myInfo', `${S.TEAM_NAMES[myTeam]} · bid ${bidText(me.bid)} · won ${me.tricks}`);
      setHTML('myCards', TrickCore.sortHand(myHand(gs)).map(c => {
        const can = legal.some(x => Cards.same(x, c));
        return Cards.cardHTML(c, { playable: can, highlight: can, dim: playing && myTurn && !can });
      }).join('') || '<span class="placeholder">No cards</span>');
    }

    const bidding = gs.phase === 'bidding' && myTurn;
    el('bidPanel').classList.toggle('hidden', !bidding);
    if (bidding && !el('bidGrid').children.length) {
      setHTML('bidGrid', Array.from({ length: 14 }, (_, v) => `<button class="btn btn-sm btn-outline" data-bid="${v}">${v === 0 ? 'Nil' : v}</button>`).join(''));
    }

    let msg = '';
    if (gs.phase === 'bidding') {
      const partner = gs.players[(Room.mySeat + 2) % 4];
      msg = myTurn ? `Your bid. Your partner bid ${bidText(partner?.bid)}.` : `Waiting for ${nameOf(gs, gs.currentPlayer)} to bid…`;
    } else if (playing) {
      if (myTurn) msg = 'Your turn — play a highlighted card.';
      else {
        const cp = gs.players[gs.currentPlayer];
        msg = `Waiting for ${cp?.name || '…'}${cp?.disconnected ? ' to reconnect' : ''}…`;
      }
    }
    setText('actionMessage', msg);

    setHTML('scoreboard', `<table class="score-table"><tr><th>Team</th><th class="num">Bid</th><th class="num">Won</th><th class="num">Bags</th><th class="num">Score</th></tr>${
      [0, 1].map(t => {
        const ps = [gs.players[t], gs.players[t + 2]];
        const bid = ps.map(p => bidText(p?.bid)).join(' + ');
        const won = ps.reduce((a, p) => a + (p?.tricks || 0), 0);
        return `<tr><td>${teamLabel(gs, t)}${t === myTeam ? ' ★' : ''}</td><td class="num">${bid}</td><td class="num">${won}</td><td class="num">${gs.teams[t].bags}</td><td class="num">${gs.teams[t].score}</td></tr>`;
      }).join('')}</table><p class="muted small">First team to ${S.TARGET} wins. Every 10 bags costs 100.</p>`);

    renderModal(gs);
    TrickUI.renderLog(gs);
  }

  function renderModal(gs) {
    if (gs.phase !== 'handOver' && gs.phase !== 'matchOver') { hide('handModal'); return; }
    let title = 'Hand over';
    if (gs.phase === 'matchOver') title = gs.final.abandoned ? 'Game ended — a player left' : `🏆 ${teamLabel(gs, gs.final.team)} wins!`;
    let body = '';
    if (gs.result) {
      body = `<table class="score-table"><tr><th>Team</th><th class="num">Contract</th><th class="num">Tricks</th><th class="num">Points</th><th class="num">Total</th></tr>${
        gs.result.rows.map((r, t) => {
          const nil = r.nil.map(n => `${escHtml(nameOf(gs, n.seat))} nil ${n.made ? '✓' : '✗'}`).join(', ');
          const pts = r.points + (r.bagPenalty || 0);
          return `<tr><td>${S.TEAM_NAMES[t]}${nil ? `<div class="muted small">${nil}</div>` : ''}${r.bagPenalty ? '<div class="muted small">10 bags: −100</div>' : ''}</td><td class="num">${r.contract}</td><td class="num">${r.tricks}</td><td class="num">${pts >= 0 ? '+' : ''}${pts}</td><td class="num">${gs.teams[t].score}</td></tr>`;
        }).join('')}</table>`;
    }
    TrickUI.showModal(gs, title, body, {
      canNext: Room.amHost && gs.phase === 'handOver',
      canNew: Room.amHost && gs.phase === 'matchOver' && !gs.final?.abandoned,
      waiting: !Room.amHost && !gs.final?.abandoned,
    });
  }

  Room.init({
    logic: S,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => hide('handModal'),
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      if (node) Room.act({ type: 'play', card: Cards.fromKey(node.dataset.card) });
    });
    el('bidGrid').addEventListener('click', e => {
      const b = e.target.closest('[data-bid]');
      if (b) Room.act({ type: 'bid', value: Number(b.dataset.bid) });
    });
    el('btnNextHand').addEventListener('click', () => Room.update(gs => S.nextRound(gs)));
    el('btnNewMatch').addEventListener('click', () => Room.update(gs => S.start(gs)));
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave? Spades needs four players, so the game will end.')) Room.leave(); });
    el('btnLeaveAfter').addEventListener('click', () => { hide('handModal'); Room.leave(); });
  });
})();
