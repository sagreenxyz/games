/**
 * room.js — shared multiplayer room layer for all games.
 *
 * Handles everything that is the same across games: PeerJS host/guest
 * connections, the lobby and waiting-room UI, invite link + QR code, seat
 * assignment, per-player state redaction, and leaving.
 *
 * A game page loads peerjs.min.js, qrcode.min.js, room.js, its own
 * <game>-logic.js, then <game>-game.js, which calls Room.init(config).
 *
 * Trust model: the host browser is authoritative. Guests only ever receive a
 * redacted copy of the state — other players' hands (unless the game says
 * they are revealed) and the deck are stripped before sending.
 *
 * Config passed to Room.init():
 *   maxPlayers                     number of seats
 *   freshRoomState(code)           → initial state object (phase 'waiting')
 *   freshPlayer(name)              → player object for a newly seated player
 *   onStart(gs)                    host clicked Start (≥2 players seated)
 *   onAction(seat, payload)        host: apply an action from `seat`
 *   onPlayerLeft(gs, seat)         host: a seated player left mid-game; mutate gs
 *   render(gs)                     render the in-game view (phase !== 'waiting')
 *   onHostState(gs)  [optional]    host: called after every host state change
 *   canSeeHand(gs, viewer, owner)  [optional] → true to reveal owner's hand
 *   onLeave()        [optional]    clear game timers when returning to lobby
 */
(function () {
  'use strict';

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const CODE_LENGTH = 6;
  const MAX_NAME_LENGTH = 20;

  let cfg = null;
  let peer = null;        // our PeerJS Peer
  let hostConn = null;    // guest → host connection
  let peerConns = [];     // host → guest connections
  const connSeatMap = new Map();
  let view = 'lobby';     // 'lobby' | 'waiting' | 'game'

  /* ───────────── DOM / misc helpers (shared with games) ───────────── */
  const el = id => document.getElementById(id);
  const show = id => el(id)?.classList.remove('hidden');
  const hide = id => el(id)?.classList.add('hidden');
  const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
  const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
  const setLobbyError = msg => setText('lobbyError', msg);

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeParseJSON(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  /** Number of cards a player holds, whether or not the hand is visible. */
  function handSize(p) {
    if (!p) return 0;
    if (typeof p.handCount === 'number') return p.handCount;
    return safeParseJSON(p.handJSON, []).length;
  }

  /** Random fixed-length room code (always exactly CODE_LENGTH chars). */
  function genCode() {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().slice(0, MAX_NAME_LENGTH);
  }

  /** PeerJS options; set window.PEER_CONFIG before scripts load to override. */
  function peerConfig() { return window.PEER_CONFIG || {}; }

  /* ───────────── Views ───────────── */
  function showView(name) {
    hide('lobby'); hide('waitingRoom'); hide('gameTable');
    show(name === 'lobby' ? 'lobby' : name === 'waiting' ? 'waitingRoom' : 'gameTable');
    view = name;
  }

  /* ───────────── State distribution ───────────── */

  /** Copy of gs safe to send to `viewerSeat`: hidden hands and deck removed. */
  function redactFor(gs, viewerSeat) {
    const copy = structuredClone(gs);
    delete copy.deck;
    for (const [key, p] of Object.entries(copy.players || {})) {
      if (!p) continue;
      const seat = Number(key);
      p.handCount = handSize(p);
      const visible = seat === viewerSeat || (cfg.canSeeHand && cfg.canSeeHand(gs, viewerSeat, seat));
      if (!visible) p.handJSON = '[]';
    }
    return copy;
  }

  function sendTo(conn, msg) {
    try { if (conn.open) conn.send(msg); } catch (err) { console.warn('Send failed:', err); }
  }

  /** Host: send each guest its own redacted view of gs. */
  function broadcastState(gs, excludeConn = null) {
    for (const conn of peerConns) {
      if (conn === excludeConn) continue;
      const seat = connSeatMap.get(conn);
      if (seat === undefined) continue;
      sendTo(conn, { type: 'state', state: redactFor(gs, seat) });
    }
  }

  /** Host: commit a new state, send it to every guest, and re-render locally. */
  function pushState(gs) {
    if (!Room.amHost) return;
    Room.state = gs;
    gs.updatedAt = Date.now();
    broadcastState(gs);
    onStateChange(gs);
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

  /** Route a player action: host applies it directly, a guest sends it to the host. */
  function act(payload) {
    if (!Room.state) return;
    if (Room.amHost) cfg.onAction(Room.mySeat, payload);
    else if (hostConn?.open) hostConn.send({ type: 'action', ...payload });
  }

  /* ───────────── Hosting ───────────── */
  function createRoom() {
    Room.myName = cleanName(el('playerName')?.value);
    if (!Room.myName) { setLobbyError('Please enter your name.'); return; }
    if (peer) return; // already creating / connecting
    Room.mySeat = 0;
    Room.amHost = true;
    setLobbyError('Creating room…');
    openHostPeer();
  }

  function openHostPeer() {
    const code = genCode();
    peer = new Peer(code, peerConfig());

    peer.on('open', id => {
      Room.myRoomCode = id;
      const gs = cfg.freshRoomState(id);
      gs.players[0] = cfg.freshPlayer(Room.myName);
      gs.hostSeat = 0;
      Room.state = gs;
      setLobbyError('');
      enterRoomUI(id);
      onStateChange(gs);
    });

    peer.on('connection', handleNewPeerConnection);

    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        openHostPeer(); // code collision — try another
      } else {
        setLobbyError(`Could not create room: ${err.type}`);
        peer.destroy();
        peer = null;
        Room.amHost = false;
        Room.mySeat = -1;
      }
    });
  }

  function handleNewPeerConnection(conn) {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      const gs = Room.state;

      if (msg.type === 'join') {
        const reject = message => { sendTo(conn, { type: 'error', message }); setTimeout(() => conn.close(), 50); };
        if (!gs) return reject('Room not ready.');
        if (gs.phase !== 'waiting') return reject('Game already in progress.');
        if (connSeatMap.has(conn)) return; // duplicate join
        const name = cleanName(msg.name);
        if (!name) return reject('Please enter a valid name.');
        const taken = Object.values(gs.players).some(
          p => p && !p.isEmpty && p.name.toLowerCase() === name.toLowerCase()
        );
        if (taken) return reject(`The name "${name}" is already taken. Please choose a different name.`);
        let seat = -1;
        for (let i = 0; i < cfg.maxPlayers; i++) {
          if (!gs.players[i] || gs.players[i].isEmpty) { seat = i; break; }
        }
        if (seat === -1) return reject(`Room is full (${cfg.maxPlayers} players).`);

        connSeatMap.set(conn, seat);
        peerConns.push(conn);
        gs.players[seat] = cfg.freshPlayer(name);
        sendTo(conn, { type: 'joined', seat, state: redactFor(gs, seat) });
        broadcastState(gs, conn);
        onStateChange(gs);

      } else if (msg.type === 'action') {
        // The seat comes from the connection, never from the message.
        const seat = connSeatMap.get(conn);
        if (gs && seat !== undefined) cfg.onAction(seat, msg);

      } else if (msg.type === 'leave') {
        handlePeerDisconnect(conn);
      }
    });

    conn.on('close', () => handlePeerDisconnect(conn));
    conn.on('error', () => handlePeerDisconnect(conn));
  }

  function handlePeerDisconnect(conn) {
    peerConns = peerConns.filter(c => c !== conn);
    const seat = connSeatMap.get(conn);
    connSeatMap.delete(conn);
    const gs = Room.state;
    if (!gs || seat === undefined || !gs.players[seat]) return;
    if (gs.phase === 'waiting') {
      delete gs.players[seat];
      pushState(gs);
    } else {
      gs.players[seat].disconnected = true;
      cfg.onPlayerLeft(gs, seat); // game decides what happens; it calls pushState
    }
  }

  /* ───────────── Joining ───────────── */
  function joinRoom() {
    Room.myName = cleanName(el('playerName')?.value);
    const code = (el('roomCode')?.value || '').trim().toUpperCase();
    if (!Room.myName) { setLobbyError('Please enter your name.'); return; }
    if (code.length !== CODE_LENGTH) { setLobbyError(`Room code must be ${CODE_LENGTH} characters.`); return; }
    if (peer) return; // already connecting

    Room.myRoomCode = code;
    Room.amHost = false;
    setLobbyError('Connecting…');

    peer = new Peer(peerConfig());
    peer.on('open', () => {
      hostConn = peer.connect(code, { serialization: 'json', reliable: true });
      hostConn.on('open', () => hostConn.send({ type: 'join', name: Room.myName }));
      hostConn.on('data', handleHostMessage);
      hostConn.on('close', () => {
        if (view !== 'lobby') {
          goToLobby();
          setLobbyError('The host closed the room.');
        } else if (peer) {
          // Rejected or dropped before seating — allow another attempt
          peer.destroy();
          peer = null;
          hostConn = null;
        }
      });
      hostConn.on('error', err => setLobbyError(`Connection error: ${err}`));
    });

    peer.on('error', err => {
      setLobbyError(err.type === 'peer-unavailable' ? 'Room not found. Check the code.' : `Error: ${err.type}`);
      peer?.destroy();
      peer = null;
      hostConn = null;
      Room.myRoomCode = '';
    });
  }

  function handleHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'joined') {
      Room.mySeat = msg.seat;
      Room.state = msg.state;
      setLobbyError('');
      enterRoomUI(Room.myRoomCode);
      onStateChange(msg.state);
    } else if (msg.type === 'state') {
      Room.state = msg.state;
      onStateChange(msg.state);
    } else if (msg.type === 'error') {
      const p = peer;
      peer = null; hostConn = null;
      Room.myRoomCode = ''; Room.mySeat = -1;
      p?.destroy();
      setLobbyError(msg.message);
    }
  }

  /* ───────────── Waiting room ───────────── */
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

  function seatedCount(gs) {
    return Object.values(gs.players || {}).filter(p => p && !p.isEmpty).length;
  }

  function updateWaitingRoom(gs) {
    const players = gs.players || {};
    let html = '';
    for (let i = 0; i < cfg.maxPlayers; i++) {
      const p = players[i];
      if (p && !p.isEmpty) {
        const hostBadge = i === gs.hostSeat ? '<span class="badge badge-gold" style="margin-left:.5rem;">Host</span>' : '';
        const selfBadge = i === Room.mySeat ? '<span class="badge badge-green" style="margin-left:.5rem;">You</span>' : '';
        html += `<div style="display:flex;align-items:center;gap:.5rem;background:rgba(0,0,0,.2);padding:.6rem .9rem;border-radius:8px;">
          <span>🧑 Seat ${i + 1}: <strong>${escHtml(p.name)}</strong></span>${hostBadge}${selfBadge}
        </div>`;
      } else {
        html += `<div style="display:flex;align-items:center;gap:.5rem;background:rgba(0,0,0,.1);padding:.6rem .9rem;border-radius:8px;opacity:.5;">
          <span style="color:rgba(255,255,255,.4);">Seat ${i + 1}: empty — waiting for a player to join</span>
        </div>`;
      }
    }
    setHTML('playerSlots', html);

    if (Room.amHost && seatedCount(gs) >= 2) {
      show('btnStart');
      el('btnStart').disabled = false;
    } else {
      hide('btnStart');
    }
    setText('waitingMsg', Room.amHost
      ? 'Need at least 2 players to start — share the invite link!'
      : 'Waiting for the host to start the game…');
  }

  /* ───────────── Leaving ───────────── */
  function leave() {
    if (!Room.amHost && hostConn?.open) hostConn.send({ type: 'leave' });
    // Host: destroying the peer closes every guest connection, which sends
    // guests back to the lobby with a "host closed the room" message.
    goToLobby();
  }

  function goToLobby() {
    cfg.onLeave?.();
    const p = peer;
    peer = null; hostConn = null; peerConns = []; connSeatMap.clear();
    Room.mySeat = -1; Room.myRoomCode = ''; Room.amHost = false; Room.state = null;
    // Switch view before destroying so the resulting close events are no-ops
    showView('lobby');
    p?.destroy();
    // Restore the full lobby (a ?room= link hides New Room / Join Room)
    show('btnNew');
    show('btnJoin');
    hide('joinFields');
    setLobbyError('');
    if (window.location.search) history.replaceState({}, '', window.location.pathname);
  }

  /* ───────────── Wiring ───────────── */
  function flashButton(id, text, restore) {
    const b = el(id);
    if (!b) return;
    b.textContent = text;
    setTimeout(() => { b.textContent = restore; }, 2000);
  }

  function wireLobby() {
    el('btnNew')?.addEventListener('click', createRoom);
    el('btnJoin')?.addEventListener('click', () => el('joinFields')?.classList.toggle('hidden'));
    el('btnJoinConfirm')?.addEventListener('click', joinRoom);
    el('roomCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
    el('playerName')?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      // On a ?room= link the join form is the only option
      if (el('btnNew')?.classList.contains('hidden')) joinRoom(); else createRoom();
    });

    el('btnStart')?.addEventListener('click', () => {
      if (Room.amHost && Room.state && Room.state.phase === 'waiting' && seatedCount(Room.state) >= 2) {
        cfg.onStart(Room.state);
      }
    });
    el('btnLeaveWaiting')?.addEventListener('click', leave);
    el('btnCopyCode')?.addEventListener('click', () => {
      navigator.clipboard.writeText(Room.myRoomCode).catch(() => {});
      flashButton('btnCopyCode', '✅ Copied', '📋 Copy code');
    });
    el('btnCopyLink')?.addEventListener('click', () => {
      const href = el('btnCopyLink')?.getAttribute('data-href') || window.location.href;
      navigator.clipboard.writeText(href).catch(() => {});
      flashButton('btnCopyLink', '✅ Copied', '🔗 Copy link');
    });

    // Direct invite link: ?room=CODE pre-fills and shows only the join form
    const urlCode = new URLSearchParams(window.location.search).get('room');
    if (urlCode && urlCode.length === CODE_LENGTH && el('roomCode')) {
      el('roomCode').value = urlCode.toUpperCase();
      show('joinFields');
      hide('btnNew');
      hide('btnJoin');
    }
  }

  const Room = {
    // live session values (read by games)
    state: null,
    myName: '',
    mySeat: -1,
    myRoomCode: '',
    amHost: false,

    init(config) {
      cfg = config;
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireLobby);
      else wireLobby();
    },
    act,
    pushState,
    leave,
    // helpers
    el, show, hide, setHTML, setText, escHtml, safeParseJSON, handSize,
    // exposed for tests
    _redactFor: redactFor,
    _genCode: genCode,
  };

  window.Room = Room;
})();
