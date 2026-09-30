// 全部音效用 WebAudio 即時合成，不需要音檔

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.45, this.ctx.currentTime, 0.02);
  }

  private ready(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx || !this.master || this.muted) return null;
    return { ctx: this.ctx, out: this.master };
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.4, slideTo?: number, delay = 0): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime + delay;
    const o = r.ctx.createOscillator();
    const g = r.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(r.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, filterType: BiquadFilterType, freq: number, vol = 0.3, delay = 0): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime + delay;
    const len = Math.ceil(r.ctx.sampleRate * dur);
    const buf = r.ctx.createBuffer(1, len, r.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = r.ctx.createBufferSource();
    src.buffer = buf;
    const f = r.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = r.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(r.out);
    src.start(t);
  }

  // 拔草「啵」：連擊時每次升半音
  pop(combo = 0): void {
    const base = 480 * Math.pow(2, Math.min(combo, 14) / 12);
    this.tone(base, 0.12, 'sine', 0.45, base * 1.9);
    this.noise(0.05, 'highpass', 2500, 0.12);
  }
  tug(): void { this.noise(0.12, 'lowpass', 500, 0.18); }
  dig(): void { this.noise(0.14, 'lowpass', 380, 0.4); this.tone(120, 0.1, 'sine', 0.25, 70); }
  plant(): void { this.tone(220, 0.1, 'sine', 0.3, 110); }
  water(): void { this.noise(0.4, 'bandpass', 1400, 0.22); }
  harvest(): void { this.tone(660, 0.09, 'triangle', 0.3); this.tone(990, 0.14, 'triangle', 0.28, undefined, 0.07); }
  coin(): void { this.tone(1318, 0.07, 'square', 0.08); this.tone(1760, 0.16, 'square', 0.08, undefined, 0.06); }
  woof(): void { this.tone(330, 0.12, 'sawtooth', 0.12, 520); this.tone(420, 0.1, 'sawtooth', 0.1, 260, 0.12); }
  sparkle(): void { [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.12, undefined, i * 0.06)); }
  ui(): void { this.tone(880, 0.04, 'sine', 0.15); }
  levelUp(): void { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.3, undefined, i * 0.09)); }
  swish(): void { this.noise(0.18, 'bandpass', 2200, 0.25); }

  // ---------- 除草機引擎（持續音） ----------
  private eng: {
    out: GainNode; lp: BiquadFilterNode; o1: OscillatorNode; o2: OscillatorNode; lfo: OscillatorNode; ng: GainNode; srcs: AudioScheduledSourceNode[];
  } | null = null;

  engineStart(): void {
    if (!this.ctx || !this.master || this.eng) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.2, t + 0.7);
    out.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.connect(out);
    // 被 LFO 調變的增益：做出「噗噗噗」的單缸引擎聲
    const am = ctx.createGain();
    am.gain.value = 0.6;
    am.connect(lp);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(18, t);
    o1.frequency.exponentialRampToValueAtTime(50, t + 0.7); // 拉繩發動：轉速爬升
    o1.connect(am);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(37, t);
    o2.frequency.exponentialRampToValueAtTime(101, t + 0.7);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.25;
    o2.connect(o2g).connect(am);
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 15;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.3;
    lfo.connect(lfoG).connect(am.gain);
    // 刀片割草的沙沙聲（割到草時才開大）
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const dd = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource();
    ns.buffer = buf;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    ns.connect(bp).connect(ng).connect(out);
    const srcs = [o1, o2, lfo, ns];
    srcs.forEach((n) => n.start(t));
    this.noise(0.5, 'lowpass', 900, 0.35); // 拉繩的「唰」
    this.eng = { out, lp, o1, o2, lfo, ng, srcs };
  }

  // speed01：推動速度；load01：割草負載
  engineUpdate(speed01: number, load01: number): void {
    if (!this.eng || !this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    const f = 50 + speed01 * 16 + load01 * 10;
    e.o1.frequency.setTargetAtTime(f, t, 0.12);
    e.o2.frequency.setTargetAtTime(f * 2.02, t, 0.12);
    e.lfo.frequency.setTargetAtTime(15 + speed01 * 8, t, 0.12);
    e.ng.gain.setTargetAtTime(Math.min(0.5, load01 * 0.6), t, 0.05);
    e.lp.frequency.setTargetAtTime(650 + load01 * 700 + speed01 * 200, t, 0.1);
  }

  engineStop(): void {
    if (!this.eng || !this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    e.o1.frequency.setTargetAtTime(20, t, 0.25);
    e.out.gain.setTargetAtTime(0.0001, t, 0.18);
    e.srcs.forEach((n) => n.stop(t + 0.9));
    this.eng = null;
  }

  bump(): void { this.tone(90, 0.12, 'square', 0.18, 55); }

  // ---------- 牧場 ----------
  // 哞：鋸齒波經過共振峰濾波，音高先升後降
  // v：依距離算出的音量（0–1），太小就不播
  moo(happy = false, v = 1): void {
    const r = this.ready();
    if (!r || v < 0.02) return;
    const ctx = r.ctx, t = ctx.currentTime;
    const dur = happy ? 0.75 : 1.05;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = happy ? 175 : 140;
    o.frequency.setValueAtTime(base * 0.9, t);
    o.frequency.linearRampToValueAtTime(base * 1.15, t + dur * 0.35);
    o.frequency.linearRampToValueAtTime(base * 0.78, t + dur);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.setValueAtTime(520, t); f1.frequency.linearRampToValueAtTime(760, t + dur * 0.4); f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'lowpass'; f2.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.12);
    g.gain.setValueAtTime(0.9 * v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1).connect(f2).connect(g).connect(r.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  squirt(alt = false): void { this.noise(0.08, 'highpass', alt ? 3200 : 2600, 0.22); this.tone(alt ? 1150 : 950, 0.06, 'sine', 0.05, alt ? 1500 : 1250); }
  bell(v = 1): void {
    if (v < 0.02) return;
    this.tone(1480, 0.5, 'triangle', 0.06 * v);
    this.tone(2230, 0.35, 'sine', 0.035 * v, undefined, 0.01);
  }
  munch(): void { this.noise(0.07, 'lowpass', 1100, 0.25); }
  brush(): void { this.noise(0.22, 'bandpass', 1900, 0.16); }
}

export const sfx = new Sfx();
