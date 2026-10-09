// PeerJS session: one JSON data channel (reliable) + one video call carrying
// each player's game canvas so you can watch your opponent live.
export const PROTO = 2;
const PREFIX = 'sansduel-race-v2-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HB_MS = 2000, HB_TIMEOUT = 10000, CONNECT_TIMEOUT = 20000;
const TYPES = new Set(['hello', 'setup', 'ready', 'go', 'st', 'end', 'rematch', 'ping', 'pong', 'bye']);

export function randomCode() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function peerOptions() {
  return {
    debug: 0,
    config: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
    },
  };
}

function describe(e) {
  switch (e?.type) {
    case 'peer-unavailable': return 'No room with that code is open.';
    case 'unavailable-id': return 'Room code collision, try again.';
    case 'network': case 'socket-error': case 'socket-closed': return 'Could not reach the matchmaking server.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    case 'webrtc': return 'Direct connection failed (strict NAT / VPN / firewall). Try another network.';
    default: return 'Connection error.';
  }
}

export class Session {
  constructor() {
    this.peer = null; this.conn = null; this.call = null; this.closed = false;
    this.h = { message: [], open: [], close: [], status: [], stream: [] };
    this.lastSeen = 0; this.hb = null; this.role = null;
    this.localStream = null;
  }
  on(e, fn) { this.h[e].push(fn); return this; }
  emit(e, ...a) { for (const fn of this.h[e]) { try { fn(...a); } catch (err) { console.error(err); } } }
  get open() { return !this.closed && !!this.conn?.open; }

  host(code) {
    this.role = 'host';
    return new Promise((resolve, reject) => {
      if (typeof Peer !== 'function') { reject(new Error('PeerJS failed to load.')); return; }
      const peer = new Peer(PREFIX + code, peerOptions());
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; peer.destroy(); reject(new Error('Matchmaking server timeout.')); } }, CONNECT_TIMEOUT);
      peer.on('error', (e) => {
        if (!done) { done = true; clearTimeout(timer); peer.destroy(); reject(new Error(describe(e))); }
      });
      peer.on('open', () => {
        done = true; clearTimeout(timer);
        this.peer = peer;
        this._listenCalls();
        peer.on('connection', (conn) => {
          if (this.conn || this.closed) { try { conn.close(); } catch { /* */ } return; }
          this.emit('status', 'Opponent found, connecting…');
          this._attach(conn, false);
        });
        resolve(code);
      });
    });
  }

  join(code) {
    this.role = 'guest';
    return new Promise((resolve, reject) => {
      if (typeof Peer !== 'function') { reject(new Error('PeerJS failed to load.')); return; }
      const peer = new Peer(undefined, peerOptions());
      let done = false;
      const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); try { peer.destroy(); } catch { /* */ } reject(new Error(msg)); };
      const timer = setTimeout(() => fail('No answer from that room. Check the code.'), CONNECT_TIMEOUT);
      peer.on('error', (e) => fail(describe(e)));
      peer.on('open', () => {
        this.peer = peer;
        this._listenCalls();
        this.emit('status', 'Looking for the room…');
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (done) return;
          done = true; clearTimeout(timer);
          this._attach(conn, true);
          resolve();
        });
        conn.on('error', (e) => fail(describe(e)));
      });
    });
  }

  _listenCalls() {
    this.peer.on('call', (call) => {
      if (this.closed || call.peer !== this.conn?.peer) { try { call.close(); } catch { /* */ } return; }
      try { this.call?.close(); } catch { /* */ }
      this.call = call;
      call.answer(this.localStream || undefined);
      call.on('stream', (s) => this.emit('stream', s));
    });
  }

  /** Send our game canvas to the opponent (host initiates; guest answers with its own). */
  shareStream(stream) {
    this.localStream = stream;
    if (this.role !== 'host' || !this.conn || this.closed) return;
    try { this.call?.close(); } catch { /* */ }
    const call = this.peer.call(this.conn.peer, stream);
    if (!call) return;
    this.call = call;
    call.on('stream', (s) => this.emit('stream', s));
  }

  _attach(conn, already) {
    if (conn.serialization !== 'json') { try { conn.close(); } catch { /* */ } return; }
    this.conn = conn;
    conn.on('data', (d) => this._data(d));
    conn.on('close', () => this._lost());
    conn.on('iceStateChanged', (s) => { if (s === 'failed') this._lost(); });
    const go = () => {
      this.lastSeen = Date.now();
      this.hb = setInterval(() => {
        if (Date.now() - this.lastSeen > HB_TIMEOUT) { this._lost(); return; }
        this.send({ t: 'ping' });
      }, HB_MS);
      this.emit('open');
    };
    if (already) go(); else conn.on('open', go);
  }

  _data(m) {
    if (typeof m === 'string') { if (m.length > 8000) return; try { m = JSON.parse(m); } catch { return; } }
    if (!m || typeof m !== 'object' || !TYPES.has(m.t)) return;
    this.lastSeen = Date.now();
    if (m.t === 'ping') { this.send({ t: 'pong' }); return; }
    if (m.t === 'pong') return;
    if (m.t === 'bye') { this._lost(); return; }
    this.emit('message', m);
  }

  send(m) {
    if (!this.open) return false;
    try { this.conn.send(m); return true; } catch { return false; }
  }

  _lost() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.hb);
    try { this.call?.close(); } catch { /* */ }
    try { this.conn?.close(); } catch { /* */ }
    try { this.peer?.destroy(); } catch { /* */ }
    this.emit('close');
  }

  close() {
    if (this.closed) return;
    this.send({ t: 'bye' });
    this.closed = true;
    clearInterval(this.hb);
    setTimeout(() => {
      try { this.call?.close(); } catch { /* */ }
      try { this.conn?.close(); } catch { /* */ }
      try { this.peer?.destroy(); } catch { /* */ }
    }, 150);
  }
}
