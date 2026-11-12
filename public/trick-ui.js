/**
 * trick-ui.js — rendering helpers shared by the Hearts and Spades UIs.
 * Requires cards.js and room.js. Exposes `window.TrickUI`.
 */
(function () {
  'use strict';

  const POS = ['bottom', 'left', 'top', 'right'];
  const rel = seat => POS[(seat - Room.mySeat + 4) % 4];

  /** Fill the three opponent seats. `info(seat, p)` returns a short line of HTML. */
  function renderSeats(gs, info) {
    for (const pos of ['left', 'top', 'right']) Room.setHTML(`seat-${pos}`, '');
    for (const s of [0, 1, 2, 3]) {
      const p = gs.players[s];
      if (!p || s === Room.mySeat) continue;
      const pos = rel(s);
      const n = Room.handSize(p);
      const status = p.disconnected ? `<span class="badge badge-gray">${p.left ? 'Left' : 'Reconnecting…'}</span>` : '';
      const node = Room.el(`seat-${pos}`);
      node.classList.toggle('turn', gs.currentPlayer === s);
      node.innerHTML = `<div class="seat-name">${Cards.esc(p.name)}</div>${status}
        <div class="muted small">${info(s, p)}</div>
        <div class="cards-row fan">${Array.from({ length: Math.min(n, 13) }, () => Cards.cardHTML(null, { faceDown: true, small: true })).join('')}</div>`;
    }
  }

  /** The current trick, or the last completed one (faded) with who took it. */
  function renderTrick(gs) {
    const area = Room.el('trickArea');
    const showLast = !gs.trick.length && gs.lastTrick;
    const plays = gs.trick.length ? gs.trick : showLast ? gs.lastTrick.plays : [];
    area.classList.toggle('done', !!showLast);
    area.innerHTML = plays.map(t => Cards.cardHTML(t.card, { extra: `data-pos="${rel(t.seat)}"` }).replace('class="playing-card', `class="playing-card pos-${rel(t.seat)}`)).join('')
      + (showLast ? `<div class="trick-note">${Cards.esc(gs.players[gs.lastTrick.winner]?.name || '')} took it</div>` : '');
  }

  function renderLog(gs) {
    Room.setHTML('actionLogList', [...(gs.actionLog || [])].reverse()
      .map(l => `<div class="${l.startsWith('---') ? 'sep' : /^(🏁|🌙|🏆)/.test(l) ? 'win' : ''}">${Cards.esc(l)}</div>`).join(''));
  }

  function showModal(gs, title, body, { canNext, canNew, waiting }) {
    Room.setHTML('handTitle', title);
    Room.setHTML('handDetails', body);
    Room.el('btnNextHand').classList.toggle('hidden', !canNext);
    Room.el('btnNewMatch').classList.toggle('hidden', !canNew);
    Room.el('handWaitMsg').classList.toggle('hidden', !waiting);
    Room.show('handModal');
  }

  window.TrickUI = { rel, renderSeats, renderTrick, renderLog, showModal };
})();
