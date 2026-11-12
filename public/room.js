/**
 * room.js — shared multiplayer room layer for every multiplayer game.
 *
 * Handles PeerJS host/guest connections, the lobby and waiting room, invite
 * link + QR code, seat assignment, applying actions through the game's rules
 * engine, per-player state redaction, rejoining after a refresh, and leaving.
 *
 * Load order on a game page: peerjs.min.js, qrcode.min.js, cards.js, room.js,
 * <game>-logic.js, <game>-game.js (which calls Room.init).
 *
 * Trust model: the host browser is authoritative. Guests only ever receive a
 * redacted copy of the state: the game's `hiddenFields` (e.g. the deck) are
 * removed, and other players' hands are blanked unless the game reveals them.
 *
 * ── Rules engine interface (`logic`) ──
 *   id, minPlayers, maxPlayers, hiddenFields?: string[]
 *   create(code) → state with phase 'waiting' and players {}
 *   freshPlayer(name) → player object
 *   start(gs, rng?) → boolean        deal / begin (from 'waiting' or between games)
 *   apply(gs, seat, action) → { ok, error? }   never mutates on error
 *   legalActions(gs, seat) → action[]          (used by tests and some UIs)
 *   removePlayer(gs, seat)           a player is gone for good mid-game
 *   canSeeHand?(gs, viewer, owner) → boolean
 *   seatNote?(seat, nPlayers) → string          e.g. team name in the waiting room
 *
 * ── Room.init(config) ──
 *   logic, render(gs)
 *   onHostState?(gs)   host: after every state change (timers, auto-advance)
 *   onError?(message)  an action of ours was rejected
 *   onLeave?()         back to the lobby — clear timers / local UI state
 *   rejoinGraceMs?     how long a disconnected player keeps their seat (default 45 s)
 */
(function () {
  'use strict';

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const CODE_LENGTH = 6;
  const MAX_NAME_LENGTH = 20;
  const RETRY_MS = 2000;

  let cfg = null;
  let logic = null;
  let peer = null;          // our PeerJS Peer
  let hostConn = null;      // guest → host connection
  let peerConns = [];       // host → guest connections
  const connSeatMap = new Map();
  const seatTokens = new Map();   // host: seat → rejoin token (never sent to other guests)
  const graceTimers = new Map();  // host: seat → timeout id
  let view = 'lobby';       // 'lobby' | 'waiting' | 'game'
  let guestMode = null;     // null | 'joining' | 'connected' | 'reconnecting'
  let myToken = null;
  let reconnectDeadline = 0;
  let retryTimer = null;
  let hostClosed = false;

  /* ───────────── helpers ───────────── */
  const el = id => document.getElementById(id);
  const show = id => el(id)?.classList.remove('hidden');
  const hide = id => el(id)?.classList.add('hidden');
  const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
  const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
  const setLobbyError = msg => setText('lobbyError', msg);
  const escHtml = s => Cards.esc(s);
  const safeParseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

  function handSize(p) {
    if (!p) return 0;
    if (typeof p.handCount === 'number') return p.handCount;
    return safeParseJSON(p.handJSON, []).length;
  }

  function randomString(len, alphabet = CODE_ALPHABET) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  }
  const genCode = () => randomString(CODE_LENGTH);

  function cleanName(raw) {
    return typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME_LENGTH) : '';
  }

  function peerConfig() { return window.PEER_CONFIG || {}; }
  const graceMs = () => cfg.rejoinGraceMs ?? 45000;

  /* ───────────── session (survives a page refresh, not closing the tab) ───────────── */
  const sessionKey = () => `games:session:${window.location.pathname}`;
  function saveSession(data) {
    try { sessionStorage.setItem(sessionKey(), JSON.stringify(data)); } catch { /* storage unavailable */ }
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(sessionKey()) || 'null'); } catch { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(sessionKey()); } catch { /* ignore */ }
  }
  function saveHostSession() {
    if (!Room.amHost || !Room.state) return;
    saveSession({ role: 'host', room: Room.myRoomCode, name: Room.myName, state: Room.state, tokens: [...seatTokens] });
  }

  /* ───────────── banner (connection status) ───────────── */
  function banner(msg) {
    let b = el('roomBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'roomBanner';
      b.className = 'room-banner hidden';
      b.setAttribute('role', 'status');
      document.body.appendChild(b);
    }
    b.textContent = msg || '';
    b.classList.toggle('hidden', !msg);
  }

  /* ───────────── views ───────────── */
  function showView(name) {
    hide('lobby'); hide('waitingRoom'); hide('gameTable');
    show(name === 'lobby' ? 'lobby' : name === 'waiting' ? 'waitingRoom' : 'gameTable');
    view = name;
  }

  /* ───────────── state distribution ───────────── */
  function redactFor(gs, viewerSeat) {
    const copy = structuredClone(gs);
    for (const f of (logic.hiddenFields || ['deck'])) delete copy[f];
    for (const [k, p] of Object.entries(copy.players || {})) {
      if (!p) continue;
      const seat = Number(k);
      p.handCount = handSize(p);
      const visible = seat === viewerSeat || (logic.canSeeHand && logic.canSeeHand(gs, viewerSeat, seat));
      if (!visible) p.handJSON = '[]';
    }
    return copy;
  }

  function sendTo(conn, msg) {
    try { if (conn.open) conn.send(msg); } catch (err) { console.warn('Send failed:', err); }
  }

  function broadcastState(gs, excludeConn = null) {
    for (const conn of peerConns) {
      if (conn === excludeConn) continue;
      const seat = connSeatMap.get(conn);
      if (seat !== undefined) sendTo(conn, { type: 'state', state: redactFor(gs, seat) });
    }
  }

  /** Host: commit state, send each guest their view, re-render, persist. */
  function pushState(gs = Room.state) {
    if (!Room.amHost || !gs) return;
    Room.state = gs;
    gs.updatedAt = Date.now();
    broadcastState(gs);
    onStateChange(gs);
    saveHostSession();
  }

  /** Host: run `fn(state)` then push. Return false from fn to skip the push. */
  function update(fn) {
    if (!Room.amHost || !Room.state) return;
    if (fn(Room.state) !== false) pushState(Room.state);
  }

  function onStateChange(gs) {
    if (gs.phase === 'waiting') {
      if (view !== 'waiting') showView('waiting');
      updateWaitingRoom(gs);
    } else {
      if (view !== 'game') showView('game');
      cfg.render(gs);
      if (Room.amHost && cfg.onHostState) cfg.onHostState(gs);
    }
  }

  function applyAction(seat, action, replyConn) {
    const gs = Room.state;
    if (!gs || !action || typeof action !== 'object') return;
    const res = logic.apply(gs, seat, action);
    if (res.ok) { pushState(gs); return; }
    if (replyConn) sendTo(replyConn, { type: 'actionError', message: res.error });
    else cfg.onError?.(res.error);
  }

  /** Play an action: the host applies it, a guest sends it to the host. */
  function act(action) {
    if (!Room.state) return;
    if (Room.amHost) applyAction(Room.mySeat, action, null);
    else if (hostConn?.open) hostConn.send({ type: 'action', action });
  }

  /* ───────────── hosting ───────────── */
  function createRoom() {
    Room.myName = cleanName(el('playerName')?.value);
    if (!Room.myName) { setLobbyError('Please enter your name.'); return; }
    if (peer) return;
    Room.amHost = true;
    Room.mySeat = 0;
    setLobbyError('Creating room…');
    openHostPeer(genCode(), null);
  }

  /** Open the host peer. `resume` = saved session to restore after a refresh. */
  function openHostPeer(code, resume, attempt = 0) {
    peer = new Peer(code, peerConfig());

    peer.on('open', id => {
      Room.myRoomCode = id;
      let gs;
      if (resume) {
        gs = resume.state;
        for (const [seat, token] of resume.tokens || []) seatTokens.set(seat, token);
        // Everyone else has to reconnect; hold their seats for the grace period.
        for (const k of Object.keys(gs.players)) {
          const seat = Number(k);
          if (seat !== Room.mySeat && gs.players[seat] && !gs.players[seat].left) markDisconnected(gs, seat);
        }
        banner('');
      } else {
        gs = logic.create(id);
        gs.players[0] = logic.freshPlayer(Room.myName);
        gs.hostSeat = 0;
      }
      Room.state = gs;
      setLobbyError('');
      enterRoomUI(id);
      pushState(gs);
    });

    peer.on('connection', handleNewPeerConnection);

    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        if (resume) {
          // Our old connection may not have been released yet — keep trying.
          if (attempt > 20) { failResume('Could not reopen the room.'); return; }
          banner('Reopening your room…');
          setTimeout(() => openHostPeer(code, resume, attempt + 1), 1500);
        } else {
          openHostPeer(genCode(), null); // code collision — try another
        }
      } else if (!Room.state) {
        setLobbyError(`Could not create room: ${err.type}`);
        peer.destroy(); peer = null;
        Room.amHost = false; Room.mySeat = -1;
        banner('');
      } else {
        console.warn('Peer error:', err.type);
      }
    });

    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
  }

  function failResume(msg) {
    clearSession();
    goToLobby();
    setLobbyError(msg);
  }

  function seatedPlayers(gs) {
    return Object.keys(gs.players || {}).map(Number).filter(s => gs.players[s] && !gs.players[s].isEmpty);
  }
  const connectedCount = gs => seatedPlayers(gs).filter(s => !gs.players[s].disconnected).length;

  function handleNewPeerConnection(conn) {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      const gs = Room.state;
      if (msg.type === 'join') handleJoin(conn, msg, gs);
      else if (msg.type === 'action') {
        const seat = connSeatMap.get(conn); // the seat comes from the connection, never the message
        if (gs && seat !== undefined) applyAction(seat, msg.action, conn);
      } else if (msg.type === 'leave') handlePeerLeft(conn, true);
    });
    conn.on('close', () => handlePeerLeft(conn, false));
    conn.on('error', () => handlePeerLeft(conn, false));
  }

  function attachConn(conn, seat) {
    for (const [c, s] of connSeatMap) if (s === seat && c !== conn) { connSeatMap.delete(c); peerConns = peerConns.filter(x => x !== c); }
    connSeatMap.set(conn, seat);
    if (!peerConns.includes(conn)) peerConns.push(conn);
  }

  function handleJoin(conn, msg, gs) {
    const reject = message => { sendTo(conn, { type: 'error', message }); setTimeout(() => conn.close(), 50); };
    if (!gs) return reject('Room not ready.');
    if (connSeatMap.has(conn)) return;

    // Rejoin with a token: take the old seat back.
    if (typeof msg.token === 'string') {
      const seat = [...seatTokens].find(([, t]) => t === msg.token)?.[0];
      const p = seat !== undefined ? gs.players[seat] : null;
      if (p && !p.left) {
        clearTimeout(graceTimers.get(seat)); graceTimers.delete(seat);
        attachConn(conn, seat);
        p.disconnected = false;
        sendTo(conn, { type: 'joined', seat, token: msg.token, state: redactFor(gs, seat) });
        pushState(gs);
        return;
      }
      if (gs.phase !== 'waiting') return reject('Your seat was given up after you disconnected.');
    }

    if (gs.phase !== 'waiting') return reject('Game already in progress.');
    const name = cleanName(msg.name);
    if (!name) return reject('Please enter a valid name.');
    if (seatedPlayers(gs).some(s => gs.players[s].name.toLowerCase() === name.toLowerCase())) {
      return reject(`The name "${name}" is already taken. Please choose a different name.`);
    }
    let seat = -1;
    for (let i = 0; i < logic.maxPlayers; i++) if (!gs.players[i] || gs.players[i].isEmpty) { seat = i; break; }
    if (seat === -1) return reject(`Room is full (${logic.maxPlayers} players).`);

    const token = randomString(24);
    seatTokens.set(seat, token);
    attachConn(conn, seat);
    gs.players[seat] = logic.freshPlayer(name);
    sendTo(conn, { type: 'joined', seat, token, state: redactFor(gs, seat) });
    pushState(gs);
  }

  function markDisconnected(gs, seat) {
    gs.players[seat].disconnected = true;
    clearTimeout(graceTimers.get(seat));
    graceTimers.set(seat, setTimeout(() => {
      graceTimers.delete(seat);
      const cur = Room.state;
      if (cur?.players[seat]?.disconnected) removeSeat(cur, seat);
    }, graceMs()));
  }

  /** A seat is gone for good. */
  function removeSeat(gs, seat) {
    clearTimeout(graceTimers.get(seat)); graceTimers.delete(seat);
    seatTokens.delete(seat);
    if (!gs.players[seat]) return;
    if (gs.phase === 'waiting') {
      delete gs.players[seat];
    } else {
      gs.players[seat].disconnected = true;
      gs.players[seat].left = true;
      logic.removePlayer(gs, seat);
    }
    pushState(gs);
  }

  /** A guest connection closed (`intentional` = they clicked Leave). */
  function handlePeerLeft(conn, intentional) {
    const seat = connSeatMap.get(conn);
    if (seat === undefined) return;
    connSeatMap.delete(conn);
    peerConns = peerConns.filter(c => c !== conn);
    const gs = Room.state;
    if (!gs || !gs.players[seat]) return;
    if (intentional || gs.phase === 'waiting') { removeSeat(gs, seat); return; }
    markDisconnected(gs, seat);
    pushState(gs);
  }

  /* ───────────── joining ───────────── */
  function joinRoom() {
    Room.myName = cleanName(el('playerName')?.value);
    const code = (el('roomCode')?.value || '').trim().toUpperCase();
    if (!Room.myName) { setLobbyError('Please enter your name.'); return; }
    if (code.length !== CODE_LENGTH) { setLobbyError(`Room code must be ${CODE_LENGTH} characters.`); return; }
    if (peer) return;
    startGuest(code, null);
  }

  function startGuest(code, token) {
    Room.myRoomCode = code;
    Room.amHost = false;
    myToken = token;
    hostClosed = false;
    guestMode = token ? 'reconnecting' : 'joining';
    if (token) reconnectDeadline = Date.now() + graceMs();
    setLobbyError(token ? '' : 'Connecting…');
    openGuestPeer();
  }

  function openGuestPeer() {
    peer = new Peer(peerConfig());
    peer.on('open', connectToHost);
    peer.on('error', err => {
      if (guestMode === 'reconnecting') { scheduleRetry(); return; }
      setLobbyError(err.type === 'peer-unavailable' ? 'Room not found. Check the code.' : `Error: ${err.type}`);
      resetGuest();
    });
    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
  }

  function connectToHost() {
    if (!peer || peer.destroyed) return;
    const conn = peer.connect(Room.myRoomCode, { serialization: 'json', reliable: true });
    hostConn = conn;
    conn.on('open', () => conn.send({ type: 'join', name: Room.myName, token: myToken || undefined }));
    conn.on('data', msg => { if (conn === hostConn) handleHostMessage(msg); });
    conn.on('close', () => { if (conn === hostConn) onHostConnClosed(); });
    conn.on('error', () => { if (conn === hostConn) onHostConnClosed(); });
  }

  function onHostConnClosed() {
    hostConn = null;
    if (hostClosed) {
      goToLobby();
      setLobbyError('The host closed the room.');
    } else if (guestMode === 'connected' || guestMode === 'reconnecting') {
      if (guestMode === 'connected') reconnectDeadline = Date.now() + graceMs();
      guestMode = 'reconnecting';
      scheduleRetry();
    } else if (view === 'lobby') {
      resetGuest(); // rejected before being seated — allow another attempt
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (Date.now() > reconnectDeadline) {
      clearSession();
      goToLobby();
      setLobbyError('Lost connection to the room.');
      return;
    }
    banner('Connection lost — reconnecting…');
    retryTimer = setTimeout(() => {
      if (guestMode !== 'reconnecting') return;
      if (!peer || peer.destroyed) openGuestPeer();
      else if (peer.disconnected) { peer.reconnect(); scheduleRetry(); }
      else connectToHost();
    }, RETRY_MS);
  }

  function resetGuest() {
    const p = peer;
    peer = null; hostConn = null; guestMode = null;
    Room.myRoomCode = '';
    p?.destroy();
  }

  function handleHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'joined') {
      guestMode = 'connected';
      clearTimeout(retryTimer);
      banner('');
      Room.mySeat = msg.seat;
      myToken = msg.token;
      saveSession({ role: 'guest', room: Room.myRoomCode, name: Room.myName, token: msg.token });
      Room.state = msg.state;
      setLobbyError('');
      enterRoomUI(Room.myRoomCode);
      onStateChange(msg.state);
    } else if (msg.type === 'state') {
      Room.state = msg.state;
      onStateChange(msg.state);
    } else if (msg.type === 'actionError') {
      cfg.onError?.(msg.message);
    } else if (msg.type === 'closed') {
      hostClosed = true;
    } else if (msg.type === 'error') {
      const wasRejoin = guestMode === 'reconnecting';
      clearSession();
      if (wasRejoin) { goToLobby(); setLobbyError(msg.message); return; }
      resetGuest();
      Room.mySeat = -1;
      setLobbyError(msg.message);
    }
  }

  /* ───────────── waiting room ───────────── */
  function enterRoomUI(code) {
    setText('displayRoomCode', code);
    setText('tableRoomCode', code);
    setInviteLink(code);
  }

  function setInviteLink(code) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('room', code);
    const href = url.toString();
    setText('inviteLink', href);
    el('btnCopyLink')?.setAttribute('data-href', href);
    const qr = el('qrCodeContainer');
    if (qr && typeof QRCode !== 'undefined') {
      qr.replaceChildren();
      new QRCode(qr, { text: href, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
    }
  }

  function playerRange() {
    const { minPlayers: lo, maxPlayers: hi } = logic;
    return lo === hi ? `exactly ${lo} players` : `${lo}–${hi} players`;
  }

  function updateWaitingRoom(gs) {
    const players = gs.players || {};
    let html = '';
    for (let i = 0; i < logic.maxPlayers; i++) {
      const p = players[i];
      const note = logic.seatNote ? logic.seatNote(i, logic.maxPlayers) : '';
      const noteBadge = note ? `<span class="badge badge-gray" style="margin-left:auto;">${escHtml(note)}</span>` : '';
      if (p && !p.isEmpty) {
        const hostBadge = i === gs.hostSeat ? '<span class="badge badge-gold">Host</span>' : '';
        const selfBadge = i === Room.mySeat ? '<span class="badge badge-green">You</span>' : '';
        const away = p.disconnected ? '<span class="badge badge-gray">Reconnecting…</span>' : '';
        html += `<div class="seat-row"><span>🧑 Seat ${i + 1}: <strong>${escHtml(p.name)}</strong></span>${hostBadge}${selfBadge}${away}${noteBadge}</div>`;
      } else {
        html += `<div class="seat-row empty"><span>Seat ${i + 1}: empty</span>${noteBadge}</div>`;
      }
    }
    setHTML('playerSlots', html);

    const n = connectedCount(gs);
    const canStart = n >= logic.minPlayers && n <= logic.maxPlayers;
    if (Room.amHost && canStart) { show('btnStart'); el('btnStart').disabled = false; } else hide('btnStart');
    setText('waitingMsg', Room.amHost
      ? (canStart ? 'Ready when you are!' : `This game needs ${playerRange()} — share the invite link!`)
      : 'Waiting for the host to start the game…');
  }

  function startGame() {
    const gs = Room.state;
    if (!Room.amHost || !gs || gs.phase !== 'waiting') return;
    for (const s of seatedPlayers(gs)) if (gs.players[s].disconnected) removeSeat(gs, s);
    const n = connectedCount(gs);
    if (n < logic.minPlayers || n > logic.maxPlayers) return;
    if (logic.start(gs)) pushState(gs);
  }

  /* ───────────── leaving ───────────── */
  function leave() {
    if (Room.amHost) {
      for (const c of peerConns) sendTo(c, { type: 'closed' });
      // Give the 'closed' message a moment to go out before the peer is destroyed.
      const p = peer; peer = null;
      setTimeout(() => p?.destroy(), 150);
    } else if (hostConn?.open) {
      hostConn.send({ type: 'leave' });
    }
    clearSession();
    goToLobby();
  }

  function goToLobby() {
    cfg.onLeave?.();
    clearTimeout(retryTimer);
    for (const t of graceTimers.values()) clearTimeout(t);
    graceTimers.clear(); seatTokens.clear();
    const p = peer;
    peer = null; hostConn = null; peerConns = []; connSeatMap.clear();
    guestMode = null; myToken = null; hostClosed = false;
    Room.mySeat = -1; Room.myRoomCode = ''; Room.amHost = false; Room.state = null;
    showView('lobby'); // before destroy so resulting close events are no-ops
    p?.destroy();
    banner('');
    show('btnNew'); show('btnJoin'); hide('joinFields');
    setLobbyError('');
    if (window.location.search) history.replaceState({}, '', window.location.pathname);
  }

  /* ───────────── wiring ───────────── */
  function flashButton(id, text, restore) {
    const b = el(id);
    if (!b) return;
    b.textContent = text;
    setTimeout(() => { b.textContent = restore; }, 2000);
  }

  function wire() {
    el('btnNew')?.addEventListener('click', createRoom);
    el('btnJoin')?.addEventListener('click', () => el('joinFields')?.classList.toggle('hidden'));
    el('btnJoinConfirm')?.addEventListener('click', joinRoom);
    el('roomCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
    el('playerName')?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (el('btnNew')?.classList.contains('hidden')) joinRoom(); else createRoom();
    });
    el('btnStart')?.addEventListener('click', startGame);
    el('btnLeaveWaiting')?.addEventListener('click', leave);
    el('btnCopyCode')?.addEventListener('click', () => {
      navigator.clipboard.writeText(Room.myRoomCode).catch(() => {});
      flashButton('btnCopyCode', '✅ Copied', '📋 Copy code');
    });
    el('btnCopyLink')?.addEventListener('click', () => {
      navigator.clipboard.writeText(el('btnCopyLink')?.getAttribute('data-href') || window.location.href).catch(() => {});
      flashButton('btnCopyLink', '✅ Copied', '🔗 Copy link');
    });

    const urlCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase();
    const saved = loadSession();

    // Refresh: take our seat back (or reopen our room) automatically.
    if (saved && (!urlCode || urlCode === saved.room)) {
      Room.myName = saved.name;
      if (el('playerName')) el('playerName').value = saved.name;
      if (saved.role === 'host' && saved.state) {
        Room.amHost = true;
        Room.mySeat = saved.state.hostSeat ?? 0;
        banner('Reopening your room…');
        openHostPeer(saved.room, saved);
        return;
      }
      if (saved.role === 'guest' && saved.token) {
        setLobbyError(`Rejoining room ${saved.room}…`);
        startGuest(saved.room, saved.token);
        return;
      }
    }

    if (urlCode && urlCode.length === CODE_LENGTH && el('roomCode')) {
      el('roomCode').value = urlCode;
      show('joinFields'); hide('btnNew'); hide('btnJoin');
    }
  }

  const Room = {
    state: null,
    myName: '',
    mySeat: -1,
    myRoomCode: '',
    amHost: false,

    init(config) {
      cfg = config;
      logic = config.logic;
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
      else wire();
    },
    act, update, pushState, leave,
    get logic() { return logic; },
    el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize,
    _redactFor: redactFor,
    _genCode: genCode,
    _setLogicForTests(l) { logic = l; cfg = cfg || {}; },
  };

  window.Room = Room;
})();
