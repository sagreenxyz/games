/**
 * Klondike Solitaire — UI. Rules: klondike-logic.js. Solo game: no
 * networking; the current game and undo history are saved in localStorage.
 */
(function () {
  'use strict';

  const K = KlondikeLogic;
  const SAVE_KEY = 'games:klondike:v1';
  const MAX_UNDO = 300;
  const el = id => document.getElementById(id);

  let gs = null;
  let history = [];
  let selection = null;   // a `from` spec
  let hintAction = null;
  let timer = null;
  let pendingDraw = null; // draw mode chosen mid-game, used by the next new game

  /* ───────────── persistence ───────────── */
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ gs, history: history.slice(-50) })); } catch { /* storage unavailable */ }
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (data?.gs?.tableau?.length === 7) { gs = data.gs; history = data.history || []; return true; }
    } catch { /* ignore */ }
    return false;
  }

  function newGame(drawCount = pendingDraw ?? Number(el('kDraw').value)) {
    pendingDraw = null;
    gs = K.create();
    K.start(gs, Math.random, { drawCount });
    history = [];
    selection = null; hintAction = null;
    el('kWin').classList.add('hidden');
    setMsg('');
    commit();
  }

  /** Apply an action; push undo history; persist; render. */
  function act(action) {
    const before = JSON.stringify(gs);
    const res = K.apply(gs, 0, action);
    if (!res.ok) { setMsg(res.error); return false; }
    history.push(before);
    if (history.length > MAX_UNDO) history.shift();
    selection = null; hintAction = null;
    setMsg('');
    commit();
    return true;
  }

  function commit() {
    save();
    render();
    if (gs.phase === 'won') showWin();
  }

  function undo() {
    if (!history.length) { setMsg('Nothing to undo.'); return; }
    gs = JSON.parse(history.pop());
    selection = null; hintAction = null;
    el('kWin').classList.add('hidden');
    commit();
  }

  const setMsg = m => { el('kMsg').textContent = m; };

  /* ───────────── rendering ───────────── */
  const sameFrom = (a, b) => a && b && a.pile === b.pile && a.index === b.index && a.suit === b.suit &&
    (a.pile !== 'tableau' || a.cardIndex === b.cardIndex);

  function isSelected(from, ci) {
    if (!selection) return false;
    if (selection.pile === 'tableau' && from.pile === 'tableau') return from.index === selection.index && ci >= selection.cardIndex;
    return sameFrom(selection, from);
  }
  const isHinted = from => hintAction?.type === 'move' && sameFrom(hintAction.from, from);

  function cardEl(card, from, attrs, ci) {
    const cls = [];
    if (card.up && isSelected(from, ci)) cls.push('selected');
    if (card.up && isHinted(from)) cls.push('hint');
    const html = Cards.cardHTML(card, { faceDown: !card.up, playable: card.up, extra: attrs });
    return cls.length ? html.replace('class="playing-card', `class="playing-card ${cls.join(' ')}`) : html;
  }

  function render() {
    const elapsed = Math.floor(((gs.wonAt || Date.now()) - gs.startedAt) / 1000);
    el('kStats').textContent = `Moves ${gs.moves} · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · Draw ${gs.drawCount}`;
    el('kDraw').value = String(pendingDraw ?? gs.drawCount);

    // Stock
    el('kStock').innerHTML = gs.stock.length ? Cards.cardHTML(null, { faceDown: true }) : (gs.waste.length ? '↺' : '');
    el('kStock').title = gs.stock.length ? `${gs.stock.length} cards — click to draw` : 'Click to turn the waste over';
    el('kStock').classList.toggle('hint', hintAction?.type === 'draw');

    // Waste: show up to 3 (draw-3) fanned, top one playable
    const shown = gs.waste.slice(gs.drawCount === 3 ? -3 : -1);
    el('kWaste').classList.toggle('fan3', gs.drawCount === 3);
    el('kWaste').innerHTML = shown.map((c, i) => {
      const isTop = i === shown.length - 1;
      const style = `style="left:calc(var(--cw) * ${i * 0.3})"`;
      return isTop ? cardEl(c, { pile: 'waste' }, `data-pile="waste" ${style}`) : Cards.cardHTML(c, { extra: style });
    }).join('');

    // Foundations
    el('kFoundations').innerHTML = Cards.SUITS.map(s => {
      const f = gs.foundations[s];
      const t = f[f.length - 1];
      const target = selection && K.isLegalMove(gs, selection, { pile: 'foundation' }) && K.movingCards(gs, selection)?.[0].s === s;
      return `<div class="k-slot${target ? ' k-target' : ''}" data-drop="foundation" data-suit="${s}" aria-label="${Cards.SUIT_NAMES[s]} foundation">${t ? cardEl(t, { pile: 'foundation', suit: s }, `data-pile="foundation" data-suit="${s}"`) : s}</div>`;
    }).join('');

    // Tableau
    el('kTableau').innerHTML = gs.tableau.map((pile, index) => {
      const target = selection && K.isLegalMove(gs, selection, { pile: 'tableau', index });
      const cards = pile.map((c, ci) => cardEl(c, { pile: 'tableau', index, cardIndex: ci }, `data-pile="tableau" data-index="${index}" data-ci="${ci}"`, ci)).join('');
      return `<div class="k-col${pile.length ? '' : ' empty'}${target ? ' k-target' : ''}" data-drop="tableau" data-index="${index}">${cards}</div>`;
    }).join('');

    el('kAuto').classList.toggle('hidden', !K.canAutoFinish(gs));
    el('kUndo').disabled = !history.length;
  }

  function showWin() {
    clearInterval(timer);
    const secs = Math.floor((gs.wonAt - gs.startedAt) / 1000);
    el('kWinStats').textContent = `${gs.moves} moves in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.`;
    el('kWin').classList.remove('hidden');
  }

  /* ───────────── interaction ───────────── */
  function fromOf(node) {
    const pile = node.dataset.pile;
    if (pile === 'waste') return { pile };
    if (pile === 'foundation') return { pile, suit: node.dataset.suit };
    if (pile === 'tableau') return { pile, index: Number(node.dataset.index), cardIndex: Number(node.dataset.ci) };
    return null;
  }

  function dropTargetOf(target) {
    const slot = target.closest('[data-drop]');
    if (!slot) return null;
    return slot.dataset.drop === 'foundation' ? { pile: 'foundation' } : { pile: 'tableau', index: Number(slot.dataset.index) };
  }

  function onBoardClick(e) {
    if (gs.phase !== 'playing') return;
    if (e.target.closest('#kStock')) { act({ type: 'draw' }); return; }
    const cardNode = e.target.closest('[data-pile]');
    const to = dropTargetOf(e.target);

    if (selection && to && K.isLegalMove(gs, selection, to)) { act({ type: 'move', from: selection, to }); return; }
    if (cardNode) {
      const from = fromOf(cardNode);
      if (K.movingCards(gs, from)) {
        selection = sameFrom(selection, from) ? null : from;
        hintAction = null;
        setMsg('');
        render();
        return;
      }
    }
    if (selection) { selection = null; render(); }
  }

  function onBoardDblClick(e) {
    const cardNode = e.target.closest('[data-pile]');
    if (!cardNode || gs.phase !== 'playing') return;
    const from = fromOf(cardNode);
    if (K.isLegalMove(gs, from, { pile: 'foundation' })) { act({ type: 'move', from, to: { pile: 'foundation' } }); return; }
    for (let index = 0; index < 7; index++) {
      if (K.isLegalMove(gs, from, { pile: 'tableau', index })) { act({ type: 'move', from, to: { pile: 'tableau', index } }); return; }
    }
  }

  function autoFinish() {
    const step = () => {
      const m = K.foundationMove(gs);
      if (m && act(m)) setTimeout(step, 60);
    };
    step();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!load()) newGame(1);
    render();
    if (gs.phase === 'won') showWin();
    timer = setInterval(() => { if (gs.phase === 'playing') render(); }, 1000);

    el('kBoard').addEventListener('click', onBoardClick);
    el('kBoard').addEventListener('dblclick', onBoardDblClick);
    el('kStock').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act({ type: 'draw' }); } });
    el('kUndo').addEventListener('click', undo);
    el('kHint').addEventListener('click', () => {
      hintAction = K.hint(gs);
      selection = null;
      setMsg(hintAction ? (hintAction.type === 'draw' ? 'Try drawing from the stock.' : 'Try the highlighted card.') : 'No moves left — start a new game.');
      render();
    });
    el('kAuto').addEventListener('click', autoFinish);
    el('kNew').addEventListener('click', () => {
      if (gs.phase === 'playing' && gs.moves > 0 && !confirm('Start a new game? This one will be lost.')) return;
      newGame();
      clearInterval(timer);
      timer = setInterval(() => { if (gs.phase === 'playing') render(); }, 1000);
    });
    el('kWinNew').addEventListener('click', () => {
      newGame();
      timer = setInterval(() => { if (gs.phase === 'playing') render(); }, 1000);
    });
    el('kDraw').addEventListener('change', e => {
      const n = Number(e.target.value);
      if (gs.moves === 0) newGame(n);
      else { pendingDraw = n; setMsg(`Draw ${n} will apply to your next new game.`); }
    });
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } });
  });
})();
