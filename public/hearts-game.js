/**
 * Hearts — UI. Rules: hearts-logic.js. Shared table helpers: trick-ui.js.
 */
(function () {
  'use strict';

  const H = HeartsLogic;
  const { el, show, hide, setHTML, setText, escHtml, safeParseJSON } = Room;
  let selected = new Set();

  const myHand = gs => safeParseJSON(gs.players[Room.mySeat]?.handJSON, []);
  const nameOf = (gs, s) => gs.players[s]?.name || `Seat ${s + 1}`;
  const DIR_TEXT = { left: 'to the left', right: 'to the right', across: 'across' };

  function render(gs) {
    setText('roundLabel', `Hand ${gs.round}`);
    setText('infoLabel', gs.phase === 'passing' ? `Passing ${DIR_TEXT[gs.passDir]}` : gs.heartsBroken ? 'Hearts broken ♥' : '');
    TrickUI.renderSeats(gs, (s, p) => `${p.handPoints} pts this hand · ${p.score} total`);
    TrickUI.renderTrick(gs);

    const me = gs.players[Room.mySeat];
    const hand = myHand(gs);
    const passing = gs.phase === 'passing' && !gs.passedSeats.includes(Room.mySeat);
    const myTurn = gs.phase === 'playing' && gs.currentPlayer === Room.mySeat;
    const legal = myTurn ? H.playableCards(gs, Room.mySeat) : [];
    if (!passing) selected.clear();
    if (me) {
      setText('myNameLabel', me.name);
      setText('myInfo', `${me.handPoints} this hand · ${me.score} total`);
      setHTML('myCards', TrickCore.sortHand(hand).map(c => {
        const can = myTurn && legal.some(x => Cards.same(x, c));
        const html = Cards.cardHTML(c, {
          playable: passing || can,
          selected: passing && selected.has(Cards.key(c)),
          highlight: can, dim: myTurn && !can,
          title: c.recv ? 'Passed to you' : '',
        });
        return c.recv ? html.replace('class="playing-card', 'class="playing-card recv') : html;
      }).join('') || '<span class="placeholder">No cards</span>');
    }

    // Controls
    el('btnPass').classList.toggle('hidden', !passing);
    el('btnPass').disabled = selected.size !== 3;
    el('btnPass').textContent = `Pass 3 cards ${DIR_TEXT[gs.passDir] || ''}`;
    let msg = '';
    if (gs.phase === 'passing') {
      const waiting = [0, 1, 2, 3].filter(s => !gs.passedSeats.includes(s)).map(s => nameOf(gs, s));
      msg = passing ? `Choose 3 cards to pass ${DIR_TEXT[gs.passDir]} (${selected.size}/3).` : `Waiting for ${waiting.join(', ')} to pass…`;
    } else if (myTurn) {
      msg = gs.tricksPlayed === 0 && !gs.trick.length ? 'Lead the 2♣.' : 'Your turn — play a highlighted card.';
      if (hand.some(c => c.recv)) msg += ' (Cards passed to you are outlined in green.)';
    } else if (gs.phase === 'playing') {
      const cp = gs.players[gs.currentPlayer];
      msg = `Waiting for ${cp?.name || '…'}${cp?.disconnected ? ' to reconnect' : ''}…`;
    }
    setText('actionMessage', msg);

    setHTML('scoreboard', `<table class="score-table"><tr><th>Player</th><th class="num">Tricks</th><th class="num">This hand</th><th class="num">Score</th></tr>${
      [0, 1, 2, 3].map(s => `<tr><td>${escHtml(nameOf(gs, s))}${s === Room.mySeat ? ' (you)' : ''}</td><td class="num">${gs.players[s]?.tricks ?? 0}</td><td class="num">${gs.players[s]?.handPoints ?? 0}</td><td class="num">${gs.players[s]?.score ?? 0}</td></tr>`).join('')}</table>
      <p class="muted small">Low score wins. The game ends when someone reaches ${H.TARGET}.</p>`);

    renderModal(gs);
    TrickUI.renderLog(gs);
  }

  function renderModal(gs) {
    if (gs.phase !== 'handOver' && gs.phase !== 'matchOver') { hide('handModal'); return; }
    let title;
    if (gs.phase === 'matchOver') title = gs.final.abandoned ? 'Game ended — a player left' : `🏆 ${escHtml(nameOf(gs, gs.final.winner))} wins with the lowest score!`;
    else title = gs.result.shooter !== null ? `🌙 ${escHtml(nameOf(gs, gs.result.shooter))} shot the moon!` : 'Hand over';
    const body = gs.result ? `<table class="score-table"><tr><th>Player</th><th class="num">This hand</th><th class="num">Total</th></tr>${
      [0, 1, 2, 3].map(s => `<tr><td>${escHtml(nameOf(gs, s))}</td><td class="num">+${gs.result.delta[s]}</td><td class="num">${gs.players[s].score}</td></tr>`).join('')}</table>` : '';
    TrickUI.showModal(gs, title, body, {
      canNext: Room.amHost && gs.phase === 'handOver',
      canNew: Room.amHost && gs.phase === 'matchOver' && !gs.final?.abandoned,
      waiting: !Room.amHost && !gs.final?.abandoned,
    });
  }

  const rerender = () => Room.state && render(Room.state);

  Room.init({
    logic: H,
    render,
    onError: msg => setText('actionMessage', msg),
    onLeave: () => { selected.clear(); hide('handModal'); },
  });

  document.addEventListener('DOMContentLoaded', () => {
    el('myCards').addEventListener('click', e => {
      const node = e.target.closest('[data-card]');
      const gs = Room.state;
      if (!node || !gs) return;
      const k = node.dataset.card;
      if (gs.phase === 'passing') {
        if (selected.has(k)) selected.delete(k);
        else if (selected.size < 3) selected.add(k);
        rerender();
      } else {
        Room.act({ type: 'play', card: Cards.fromKey(k) });
      }
    });
    el('btnPass').addEventListener('click', () => {
      const cards = [...selected].map(Cards.fromKey);
      selected.clear();
      Room.act({ type: 'pass', cards });
    });
    el('btnNextHand').addEventListener('click', () => Room.update(gs => H.nextRound(gs)));
    el('btnNewMatch').addEventListener('click', () => Room.update(gs => H.start(gs)));
    el('btnLeaveGame').addEventListener('click', () => { if (confirm('Leave? Hearts needs four players, so the game will end.')) Room.leave(); });
    el('btnLeaveAfter').addEventListener('click', () => { hide('handModal'); Room.leave(); });
  });
})();
