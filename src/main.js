// SansDuel: race wrapper around jcw87's Bad Time Simulator.
// Both players run the real sans fight (same seed) side by side; whoever gets
// further wins. You see your opponent's game live as a WebRTC video stream.
import { GameBridge, FINAL_HITS } from './bridge.js';
import { Session, randomCode, cleanCode, PROTO } from './net.js';
import { decideResult } from './race.js';

const $ = (s) => document.querySelector(s);
const frame = $('#game');
const bridge = new GameBridge(frame);

const KEY_Z = 90;
const TOTAL = FINAL_HITS + 1; // progress steps shown as "attack N / 24"

let sess = null;
let mode = null;              // 'solo' | 'race'
let myName = 'Chara', theirName = '???';
let race = null;
let pollTimer = null, sendTimer = 0;
let rematch = { me: false, them: false };

const fresh = () => ({ status: 'alive', hits: 0, hp: 92, kr: 0, time: 0, ready: false });

function newRace(seed) {
  return { seed, phase: 'loading', t0: 0, me: fresh(), them: fresh(), result: null, reason: '', lastText: '', keepPlaying: false };
}

// ---------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  $('#lobby').classList.toggle('hidden', !id);
}

function setOverlay(html, cls = '') {
  const o = $('#myov');
  if (!html) { o.classList.add('hidden'); o.innerHTML = ''; return; }
  o.className = 'ov ' + cls;
  o.innerHTML = html;
}

function loadGame(params) {
  if (new URLSearchParams(location.search).get('testclock')) params = { ...params, testclock: 1 };
  const qs = new URLSearchParams(params).toString();
  frame.src = 'game/index.html' + (qs ? '?' + qs : '');
  $('#arena').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// solo
// ---------------------------------------------------------------------------
function startSolo() {
  mode = 'solo';
  myName = getName();
  race = null;
  $('#side').classList.add('hidden');
  $('#arena').classList.add('solo');
  setOverlay(null);
  loadGame({});
  frame.addEventListener('load', () => { bridge.setName(myName); bridge.focus(); }, { once: true });
  show(null);
}

// ---------------------------------------------------------------------------
// race flow
// ---------------------------------------------------------------------------
function beginRace(seed) {
  mode = 'race';
  race = newRace(seed);
  rematch = { me: false, them: false };
  $('#side').classList.remove('hidden');
  $('#arena').classList.remove('solo');
  $('#oppname').textContent = theirName;
  $('#myname').textContent = myName;
  $('#oppvid').srcObject = null;
  $('#vidwait').classList.remove('hidden');
  setOverlay(null);
  loadGame({ race: 1, seed });
  show(null);
  renderSide();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 100);
}

function poll() {
  if (!race) return;
  const r = race;
  // waiting for the game to load + the player to click "ready" inside it
  if (r.phase === 'loading') {
    if (bridge.menuReady()) {
      bridge.setName(myName);
      if (!r.streamed) {
        const c = bridge.canvas();
        if (c && c.captureStream) { sess?.shareStream(c.captureStream(24)); r.streamed = true; }
      }
      if (bridge.isReady() && !r.me.ready) {
        r.me.ready = true;
        sess?.send({ t: 'ready' });
        maybeGo();
      }
    }
    renderSide();
    return;
  }
  if (r.phase !== 'racing' && !(r.phase === 'over' && r.keepPlaying)) return;
  const st = bridge.state();
  if (!st) return;
  const me = r.me;
  if (r.phase === 'racing' && me.status === 'alive') {
    me.time = performance.now() - r.t0;
    if (!r.seenBattle) {
      // GO was pressed but the game hasn't left its menu yet: keep nudging it
      if (st.layout === 'BattleScreen') r.seenBattle = true;
      else if (performance.now() - (r.lastTap || 0) > 600) { r.lastTap = performance.now(); bridge.tap(KEY_Z); }
    }
    if (st.layout === 'BattleScreen') {
      if (st.hits !== r.seededAt) { r.seededAt = st.hits; bridge.reseed(st.hits); }
      me.hits = st.hits; me.hp = st.hp; me.kr = st.kr;
      if (st.text) r.lastText = st.text;
      if (/you win/i.test(st.text)) setMyStatus('won');
      else if (st.hp <= 0) setMyStatus('dead');
      else decide(); // you may have just passed a dead opponent
    } else if (st.layout === 'MainMenu' && r.seenBattle) {
      // the game went back to its menu: either the win sequence finished or we died
      setMyStatus(/you win/i.test(r.lastText) ? 'won' : 'dead');
    }
    sendTimer += 100;
    if (sendTimer >= 200) { sendTimer = 0; sendState(); }
  }
  renderSide();
}

function sendState() {
  const m = race.me;
  sess?.send({ t: 'st', status: m.status, hits: m.hits, hp: m.hp, kr: m.kr, time: Math.round(m.time) });
}

function setMyStatus(s) {
  const me = race.me;
  if (me.status !== 'alive') return;
  me.status = s;
  if (s === 'won') me.hits = TOTAL;
  me.time = performance.now() - race.t0;
  sendState();
  sess?.send({ t: 'end', status: s, hits: me.hits, time: Math.round(me.time) });
  if (s === 'dead' && race.them.status === 'alive') {
    setOverlay(`<h2>YOU DIED</h2><p>made it to attack ${Math.min(TOTAL, me.hits + 1)} / ${TOTAL}</p><p class="dim">${esc(theirName)} has to get past that to win…</p>`, 'dead');
  }
  decide();
}

function maybeGo() {
  if (!race || race.phase !== 'loading') return;
  if (sess?.role === 'host' && race.me.ready && race.them.ready) {
    sess.send({ t: 'go' });
    countdown();
  }
}

function countdown() {
  race.phase = 'countdown';
  let n = 3;
  const tick = () => {
    if (!race || race.phase !== 'countdown') return;
    if (n > 0) { setOverlay(`<div class="count">${n}</div>`, 'count'); n--; setTimeout(tick, 1000); return; }
    setOverlay(null);
    race.phase = 'racing';
    race.t0 = performance.now();
    bridge.lock(false);
    bridge.focus();
    race.lastTap = performance.now();
    bridge.tap(KEY_Z); // "Normal" is the default menu choice
    setTimeout(() => bridge.focus(), 150);
  };
  tick();
}

function decide(forfeit) {
  const r = race;
  if (!r || r.phase === 'over') return;
  const res = forfeit ? 'me' : decideResult(r.me, r.them);
  if (!res) return;
  r.phase = 'over';
  r.result = res;
  let why;
  const them = esc(theirName);
  if (forfeit) why = `${them} left the race.`;
  else if (r.me.status === 'won' && res === 'me') why = `you beat sans first! (${fmt(r.me.time)})`;
  else if (r.them.status === 'won' && res === 'them') why = `${them} beat sans first (${fmt(r.them.time)}).`;
  else if (res === 'me') why = r.them.status === 'dead' && r.me.status === 'alive' ? `you got further than ${them}.` : `you survived longer than ${them}.`;
  else why = `${them} got further than you.`;
  const canKeep = r.me.status === 'alive';
  if (canKeep) { bridge.lock(true); bridge.suspend(true); }
  setOverlay(`<h2 class="${res === 'me' ? 'win' : 'lose'}">${res === 'me' ? 'YOU WIN' : 'YOU LOSE'}</h2>
    <p>${why}</p>
    <div class="row">
      <button id="ovRematch">REMATCH</button>
      ${canKeep ? '<button id="ovKeep">KEEP PLAYING</button>' : ''}
      <button id="ovMenu">MENU</button>
    </div><p id="ovRematchStatus" class="dim"></p>`, res === 'me' ? 'won' : 'lost');
  $('#ovRematch').addEventListener('click', requestRematch);
  $('#ovMenu').addEventListener('click', backToMenu);
  $('#ovKeep')?.addEventListener('click', () => {
    r.keepPlaying = true;
    setOverlay(null);
    bridge.lock(false);
    bridge.suspend(false);
    bridge.focus();
  });
  if (rematch.them) $('#ovRematchStatus').textContent = `${theirName} wants a rematch!`;
  renderSide();
}

function requestRematch() {
  if (rematch.me) return;
  rematch.me = true;
  sess?.send({ t: 'rematch' });
  const s = $('#ovRematchStatus');
  if (s) s.textContent = rematch.them ? '' : `waiting for ${theirName}…`;
  tryRematch();
}

function tryRematch() {
  if (!rematch.me || !rematch.them) return;
  if (sess?.role === 'host') {
    const seed = randomSeed();
    sess.send({ t: 'setup', seed });
    beginRace(seed);
  }
}

// ---------------------------------------------------------------------------
// side panel (both progress bars + opponent video)
// ---------------------------------------------------------------------------
function renderSide() {
  if (!race) return;
  paintPlayer('#mecard', race.me, race.phase);
  paintPlayer('#oppcard', race.them, race.phase);
  const st = race.phase === 'loading'
    ? (race.me.ready ? (race.them.ready ? 'starting…' : `waiting for ${theirName} to ready up…`) : 'click inside your game when you\'re ready')
    : race.phase === 'countdown' ? 'get ready…'
    : race.phase === 'racing' ? `racing · ${fmt(performance.now() - race.t0)}`
    : race.result === 'me' ? 'you won!' : 'you lost.';
  $('#racestatus').textContent = st;
}

function paintPlayer(sel, p, phase) {
  const el = $(sel);
  const hits = Math.min(TOTAL, p.status === 'won' ? TOTAL : p.hits);
  el.querySelector('.prog i').style.width = (hits / TOTAL) * 100 + '%';
  el.querySelector('.progtxt').textContent = p.status === 'won' ? 'BEAT SANS' : `attack ${Math.min(TOTAL, hits + 1)} / ${TOTAL}`;
  const hp = Math.max(0, p.hp);
  el.querySelector('.hp .y').style.width = ((hp - p.kr) / 92) * 100 + '%';
  el.querySelector('.hp .k').style.width = (p.kr / 92) * 100 + '%';
  el.querySelector('.hptxt').textContent = `${hp} / 92`;
  el.querySelector('.hptxt').classList.toggle('kr', p.kr > 0);
  const tag = el.querySelector('.tag');
  tag.textContent = phase === 'loading' ? (p.ready ? 'READY' : 'NOT READY')
    : p.status === 'alive' ? (phase === 'over' ? '' : 'FIGHTING') : p.status === 'won' ? 'WON' : 'DIED';
  tag.className = 'tag ' + (p.status === 'dead' ? 'dead' : p.status === 'won' ? 'won' : p.ready || phase !== 'loading' ? 'ok' : '');
}

// ---------------------------------------------------------------------------
// networking
// ---------------------------------------------------------------------------
function onMessage(m) {
  switch (m.t) {
    case 'hello':
      theirName = typeof m.name === 'string' ? m.name.slice(0, 12) : '???';
      if (m.v !== PROTO) { netGone('Your opponent is on a different version of the page. Both of you refresh.'); return; }
      if (sess.role === 'host') {
        const seed = randomSeed();
        sess.send({ t: 'setup', seed });
        beginRace(seed);
      }
      break;
    case 'setup':
      if (sess.role === 'guest' && Number.isInteger(m.seed)) beginRace(m.seed);
      break;
    case 'ready':
      if (race) { race.them.ready = true; maybeGo(); renderSide(); }
      break;
    case 'go':
      if (race && race.phase === 'loading' && sess.role === 'guest') countdown();
      break;
    case 'st':
    case 'end':
      if (!race) return;
      if (typeof m.hits === 'number') race.them.hits = clampN(m.hits, 0, TOTAL);
      if (typeof m.hp === 'number') race.them.hp = clampN(m.hp, 0, 92);
      if (typeof m.kr === 'number') race.them.kr = clampN(m.kr, 0, 40);
      if (typeof m.time === 'number') race.them.time = m.time;
      if (['alive', 'dead', 'won'].includes(m.status) && race.them.status === 'alive') race.them.status = m.status;
      if (m.t === 'end' && m.status === 'won') race.them.hits = TOTAL;
      decide();
      renderSide();
      break;
    case 'rematch':
      rematch.them = true;
      { const s = $('#ovRematchStatus'); if (s) s.textContent = rematch.me ? '' : `${theirName} wants a rematch!`; }
      tryRematch();
      break;
  }
}

function wire(s) {
  s.on('message', onMessage);
  s.on('status', (t) => { $('#hoststatus').textContent = t; $('#joinstatus').textContent = t; });
  s.on('open', () => s.send({ t: 'hello', v: PROTO, name: myName }));
  s.on('stream', (stream) => {
    const v = $('#oppvid');
    v.srcObject = stream;
    v.play().catch(() => {});
    $('#vidwait').classList.add('hidden');
  });
  s.on('close', () => { if (sess === s) netGone(`${theirName} disconnected.`); });
}

function netGone(msg) {
  if (race && race.phase !== 'over' && (race.phase === 'racing' || race.phase === 'countdown')) {
    decide(true);
    $('#racestatus').textContent = msg;
    return;
  }
  $('#racestatus').textContent = msg;
  if (race && race.phase === 'loading') setOverlay(`<h2>DISCONNECTED</h2><p>${esc(msg)}</p><div class="row"><button id="ovMenu">MENU</button></div>`, 'lost');
  $('#ovMenu')?.addEventListener('click', backToMenu);
  const s = $('#ovRematchStatus');
  if (s) s.textContent = msg;
}

async function hostGame() {
  myName = getName();
  const code = randomCode();
  sess = new Session();
  wire(sess);
  $('#hostinfo').classList.remove('hidden');
  $('#hostcode').textContent = '…';
  $('#hoststatus').textContent = 'Opening a room…';
  $('#hostgo').disabled = true;
  try {
    await sess.host(code);
    $('#hostcode').textContent = code;
    $('#hostlink').value = `${location.origin}${location.pathname}?join=${code}`;
    $('#hoststatus').textContent = 'Waiting for your opponent to join…';
  } catch (e) {
    $('#hoststatus').textContent = e.message;
    $('#hostgo').disabled = false;
  }
}

async function joinGame() {
  myName = getName();
  const code = cleanCode($('#joincode').value);
  if (code.length !== 5) { $('#joinstatus').textContent = 'Room codes are 5 characters.'; return; }
  sess = new Session();
  wire(sess);
  $('#joinstatus').textContent = 'Connecting…';
  $('#joingo').disabled = true;
  try {
    await sess.join(code);
    $('#joinstatus').textContent = 'Connected!';
  } catch (e) {
    $('#joinstatus').textContent = e.message;
    $('#joingo').disabled = false;
  }
}

function backToMenu() {
  try { sess?.close(); } catch { /* */ }
  sess = null;
  race = null;
  mode = null;
  clearInterval(pollTimer);
  frame.src = 'about:blank';
  $('#arena').classList.add('hidden');
  setOverlay(null);
  history.replaceState(null, '', location.pathname);
  show('menu');
}

// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (ms) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const randomSeed = () => 1 + Math.floor(Math.random() * 2 ** 30);

function getName() {
  const n = $('#name').value.trim().replace(/[^\w .\-]/g, '').slice(0, 12);
  try { localStorage.setItem('sansduel.name', n); } catch { /* */ }
  return n || 'Chara';
}

function init() {
  try { $('#name').value = localStorage.getItem('sansduel.name') || ''; } catch { /* */ }
  $('#btnHost').addEventListener('click', () => { $('#hostinfo').classList.add('hidden'); $('#hostgo').disabled = false; $('#hoststatus').textContent = ''; show('host'); });
  $('#btnJoin').addEventListener('click', () => { $('#joingo').disabled = false; $('#joinstatus').textContent = ''; show('join'); });
  $('#btnSolo').addEventListener('click', startSolo);
  $('#hostgo').addEventListener('click', hostGame);
  $('#joingo').addEventListener('click', joinGame);
  $('#joincode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
  document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', backToMenu));
  $('#leave').addEventListener('click', backToMenu);
  $('#copylink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#hostlink').value); $('#copylink').textContent = 'COPIED'; } catch { $('#hostlink').select(); }
    setTimeout(() => { $('#copylink').textContent = 'COPY'; }, 1500);
  });
  // clicking anywhere on the game area hands keyboard focus back to the game
  $('#mine').addEventListener('mousedown', () => setTimeout(() => bridge.focus(), 0));
  const q = new URLSearchParams(location.search).get('join');
  if (q) { $('#joincode').value = cleanCode(q); show('join'); } else show('menu');
}
init();

window.__race = { get race() { return race; }, bridge, decideResult };
