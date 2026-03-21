/**
 * peerjs-mock.js — BroadcastChannel-based drop-in mock for PeerJS 1.x
 *
 * Replaces window.Peer so tests can run two pages in the same browser context
 * without WebRTC or an external PeerJS server.
 *
 * Protocol (all messages carry __mock:true so they can't clash with app code):
 *   connect-request  from→to   : peer A wants to connect to peer B
 *   connect-accept   from→to   : peer B accepted; guest may now open its conn
 *   connect-reject   from→to   : peer B unknown — triggers 'peer-unavailable'
 *   data             from→to   : application data payload
 *   close            from→to   : connection closed by sender
 *
 * Ordering guarantee:
 *   1. Host receives 'connect-request' and fires 'connection' (sets up data handlers)
 *   2. Host sends 'connect-accept' so guest's conn is opened AFTER host is ready
 *   3. Guest sends 'join' → host data handler is guaranteed to be in place
 */
(function () {
  'use strict';

  const CHANNEL_NAME = '__peerjs_mock__';
  const bc = new BroadcastChannel(CHANNEL_NAME);
  /** Set of peer IDs that have been created in this page */
  const localPeerIds = new Set();

  function uid() {
    return Math.random().toString(36).slice(2, 10) + '-mock';
  }

  // ─── DataConnection ────────────────────────────────────────────────────────

  class MockDataConnection {
    constructor(localId, remotePeerId) {
      this._localId   = localId;
      this.peer       = remotePeerId;
      this.open       = false;
      this._listeners = { open: [], data: [], close: [], error: [] };
    }

    on(event, fn) {
      if (this._listeners[event]) this._listeners[event].push(fn);
      return this;
    }

    _emit(event, ...args) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(...args); } catch (e) { console.error('[mock] listener error', e); }
      });
    }

    send(payload) {
      if (!this.open) return;
      bc.postMessage({ __mock: true, type: 'data', from: this._localId, to: this.peer, payload });
    }

    close() {
      if (!this.open) return;
      this.open = false;
      bc.postMessage({ __mock: true, type: 'close', from: this._localId, to: this.peer });
      this._emit('close');
    }
  }

  // ─── Peer ──────────────────────────────────────────────────────────────────

  class MockPeer {
    constructor(idOrOptions, _options) {
      this.id          = (typeof idOrOptions === 'string') ? idOrOptions : uid();
      this._destroyed  = false;
      this._listeners  = { open: [], connection: [], error: [] };
      /** @type {Map<string, MockDataConnection>} remoteId → connection */
      this._conns      = new Map();

      localPeerIds.add(this.id);

      this._onBCMessage = this._onBCMessage.bind(this);
      bc.addEventListener('message', this._onBCMessage);

      // Announce ourselves so other pages can discover us
      bc.postMessage({ __mock: true, type: 'register', id: this.id });

      // Fire 'open' asynchronously, matching real PeerJS behaviour
      setTimeout(() => { if (!this._destroyed) this._emit('open', this.id); }, 20);
    }

    on(event, fn) {
      if (this._listeners[event]) this._listeners[event].push(fn);
      return this;
    }

    _emit(event, ...args) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(...args); } catch (e) { console.error('[mock] listener error', e); }
      });
    }

    _onBCMessage(evt) {
      const msg = evt.data;
      if (!msg || !msg.__mock) return;

      if (msg.type === 'connect-request' && msg.to === this.id) {
        // ── Incoming connection ────────────────────────────────────────────
        // 1. Create the server-side DataConnection
        const conn = new MockDataConnection(this.id, msg.from);
        this._conns.set(msg.from, conn);

        // 2. Fire 'connection' immediately so the host sets up its data handlers
        conn.open = true;
        conn._emit('open');
        this._emit('connection', conn);

        // 3. Now tell the guest to open its side
        //    (do this after a microtask so host listeners are fully installed)
        Promise.resolve().then(() => {
          bc.postMessage({ __mock: true, type: 'connect-accept', from: this.id, to: msg.from });
        });

      } else if (msg.type === 'connect-accept' && msg.to === this.id) {
        // ── Our outgoing connect() was accepted ────────────────────────────
        const conn = this._conns.get(msg.from);
        if (conn && !conn.open) {
          conn.open = true;
          conn._emit('open');
        }

      } else if (msg.type === 'connect-reject' && msg.to === this.id) {
        // ── Remote peer does not exist ─────────────────────────────────────
        this._emit('error',
          Object.assign(new Error('peer-unavailable'), { type: 'peer-unavailable' }));

      } else if (msg.type === 'data' && msg.to === this.id) {
        const conn = this._conns.get(msg.from);
        if (conn) conn._emit('data', msg.payload);

      } else if (msg.type === 'close' && msg.to === this.id) {
        const conn = this._conns.get(msg.from);
        if (conn && conn.open) { conn.open = false; conn._emit('close'); }
      }
    }

    connect(remotePeerId, _options) {
      const conn = new MockDataConnection(this.id, remotePeerId);
      this._conns.set(remotePeerId, conn);

      // Send connect-request; the remote peer replies with accept or reject.
      // Set a 3-second timeout for 'peer-unavailable' if no reply comes.
      let accepted = false;
      const timer = setTimeout(() => {
        if (!accepted) {
          this._emit('error',
            Object.assign(new Error('peer-unavailable'), { type: 'peer-unavailable' }));
        }
      }, 3000);

      conn.on('open', () => { accepted = true; clearTimeout(timer); });

      bc.postMessage({ __mock: true, type: 'connect-request', from: this.id, to: remotePeerId });
      return conn;
    }

    destroy() {
      this._destroyed = true;
      localPeerIds.delete(this.id);
      bc.removeEventListener('message', this._onBCMessage);
      this._conns.forEach(conn => { try { if (conn.open) conn.close(); } catch (_) {} });
      this._conns.clear();
    }
  }

  window.Peer = MockPeer;
})();
