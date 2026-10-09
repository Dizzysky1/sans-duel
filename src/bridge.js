// Reads/drives jcw87's Construct 2 sans fight (game/) running in an iframe.
// The exported runtime is minified, so object types are looked up by index
// (fixed for this vendored build) and verified by shape before use.
const T_SANSLEGS = 25;   // instance vars: NextAttack, HitAttempts, DodgeState, DodgeTimer, JustDodged, XSpeed
const T_SANSFONT = 48;   // instance vars: ?, Voice, FullText, EndFunc, Interactive, CurrentChar, T, ...
const T_VPAD = 2;
export const FINAL_HITS = 23; // HitAttempts after sans_final

export class GameBridge {
  constructor(iframe) {
    this.frame = iframe;
    this.ivKey = null;
  }

  get win() { try { return this.frame.contentWindow; } catch { return null; } }

  runtime() {
    try {
      const w = this.win;
      return w && typeof w.cr_getC2Runtime === 'function' ? w.cr_getC2Runtime() : null;
    } catch { return null; }
  }

  /** Name of the instance-variable array property (minified). */
  _iv(inst, len) {
    if (this.ivKey && Array.isArray(inst[this.ivKey])) return inst[this.ivKey];
    for (const k of Object.keys(inst)) {
      const v = inst[k];
      if (Array.isArray(v) && v.length === len && v.every((x) => typeof x === 'number')) { this.ivKey = k; return v; }
    }
    return null;
  }

  global(name) {
    const rt = this.runtime();
    const v = rt && Array.isArray(rt.Gu) ? rt.Gu.find((g) => g.name === name) : null;
    return v || null;
  }

  layout() {
    const rt = this.runtime();
    if (!rt) return null;
    if (rt.ba && typeof rt.ba.name === 'string') return rt.ba.name;
    for (const k of Object.keys(rt)) { const v = rt[k]; if (Array.isArray(rt.hd) && rt.hd.includes(v)) return v.name; }
    return null;
  }

  /** Has the main menu finished loading the attack CSVs? */
  menuReady() {
    if (this.layout() !== 'MainMenu') return false;
    const rt = this.runtime();
    const vpad = rt?.p?.[T_VPAD]?.d;
    return Array.isArray(vpad) && vpad.length > 0;
  }

  setName(name) {
    const v = this.global('Name');
    if (v) v.data = String(name || 'Chara').slice(0, 12);
  }

  state() {
    const rt = this.runtime();
    if (!rt) return null;
    const hp = this.global('HP'), kr = this.global('KR');
    const legsI = rt.p?.[T_SANSLEGS]?.d?.[0];
    const iv = legsI ? this._iv(legsI, 6) : null;
    let text = '';
    const font = rt.p?.[T_SANSFONT]?.d?.[0];
    if (font) {
      for (const k of Object.keys(font)) {
        const v = font[k];
        if (Array.isArray(v) && v.includes('SansSpeak')) { text = String(v[2] || ''); break; }
      }
    }
    return {
      layout: this.layout(),
      hp: hp ? hp.data : 0,
      kr: kr ? kr.data : 0,
      next: iv ? iv[0] : 0,
      hits: iv ? iv[1] : 0,
      text,
    };
  }

  key(code, down) {
    const w = this.win;
    if (!w) return;
    const ev = new w.KeyboardEvent(down ? 'keydown' : 'keyup', { keyCode: code, which: code, bubbles: true });
    ev.__sd = true; // passes the race-mode input lock
    w.document.dispatchEvent(ev);
  }

  /** Tap a key long enough for the runtime to see at least one tick. */
  tap(code) {
    this.key(code, true);
    setTimeout(() => this.key(code, false), 90);
  }

  reseed(n) { try { this.win.__sdReseed?.(n); } catch { /* */ } }

  lock(on) { try { this.win.__inputLock = !!on; } catch { /* */ } }
  isReady() { try { return !!this.win.__sdReady; } catch { return false; } }

  suspend(on) {
    try { this.win?.cr_setSuspended?.(!!on); } catch { /* */ }
  }

  canvas() {
    try { return this.win?.document.getElementById('c2canvas') || null; } catch { return null; }
  }

  focus() {
    try { this.frame.focus(); this.win?.focus(); } catch { /* */ }
  }
}
