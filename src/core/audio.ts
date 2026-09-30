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
}

export const sfx = new Sfx();
