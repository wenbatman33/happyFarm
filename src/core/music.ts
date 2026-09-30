import { sfx } from './audio';

// 背景音樂與環境音（全部 WebAudio 即時合成）
// 音樂：五聲音階的輕柔撥弦＋長音和弦，白天明亮、晚上低沉稀疏
// 環境音：白天鳥叫、晚上蟲鳴、下雨時的雨聲
const PENTA = [0, 2, 4, 7, 9];
const CHORDS = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]]; // C、Am、F、G
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  musicOn = true;
  ambienceOn = true;
  radio = false;
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private next = 0;
  private beat = 0;
  private birdT = 2;
  private cricketT = 1;
  night = false;
  raining = false;
  indoor = false;

  constructor() {
    sfx.onReady((ctx, out) => {
      this.ctx = ctx;
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(out);
      this.ambGain = ctx.createGain();
      this.ambGain.gain.value = 0;
      this.ambGain.connect(out);
      // 雨聲：一段循環的濾波白噪音
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(f).connect(this.rainGain).connect(this.ambGain);
      src.start();
      this.next = ctx.currentTime + 0.5;
    });
  }

  toggleRadio(): void {
    this.radio = !this.radio;
    sfx.ui();
  }

  private pluck(freq: number, t: number, vol: number, dur = 1.2, type: OscillatorType = 'triangle') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicGain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(root: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    for (const iv of CHORDS[((root % 4) + 4) % 4]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = midi(48 + iv + 12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.musicGain!);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private chirp(t: number) {
    const ctx = this.ctx!;
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const tt = t + i * 0.11;
      o.type = 'sine';
      o.frequency.setValueAtTime(base, tt);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.3), tt + 0.07);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.05, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(g).connect(this.ambGain!);
      o.start(tt);
      o.stop(tt + 0.12);
    }
  }

  private cricket(t: number) {
    const ctx = this.ctx!;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const tt = t + i * 0.05;
      o.type = 'triangle';
      o.frequency.value = 4400 + Math.random() * 300;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.018, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.035);
      o.connect(g).connect(this.ambGain!);
      o.start(tt);
      o.stop(tt + 0.05);
    }
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.ambGain || !this.rainGain) return;
    const t = ctx.currentTime;
    const musicVol = this.musicOn ? (this.indoor ? (this.radio ? 0.9 : 0.55) : 0.5) : this.radio && this.indoor ? 0.8 : 0;
    this.musicGain.gain.setTargetAtTime(musicVol * 0.35, t, 0.6);
    this.ambGain.gain.setTargetAtTime(this.ambienceOn ? (this.indoor ? 0.35 : 1) : 0, t, 0.6);
    this.rainGain.gain.setTargetAtTime(this.raining ? 0.05 : 0, t, 1.2);

    // 音樂排程：每拍 0.75 秒（80 BPM），先排好未來 0.6 秒內的音
    if (musicVol > 0) {
      while (this.next < t + 0.6) {
        const b = this.beat++;
        const bar = Math.floor(b / 4);
        const chord = Math.floor(bar / 2) % 4;
        if (b % 8 === 0) this.pad(chord, this.next, 6.5, this.night ? 0.02 : 0.028);
        const density = this.night ? 0.35 : this.radio ? 0.8 : 0.6;
        if (Math.random() < density) {
          const oct = this.night ? 60 : 67;
          const deg = PENTA[Math.floor(Math.random() * PENTA.length)] + CHORDS[chord][0];
          this.pluck(midi(oct + deg), this.next + (Math.random() < 0.3 ? 0.375 : 0), this.night ? 0.05 : 0.06, this.night ? 1.8 : 1.1);
        }
        if (b % 4 === 0) this.pluck(midi(36 + CHORDS[chord][0] + 12), this.next, 0.05, 1.4, 'sine');
        this.next += 0.75;
      }
    } else this.next = t + 0.3;

    // 環境音
    if (!this.ambienceOn) return;
    if (!this.night && !this.raining) {
      this.birdT -= dt;
      if (this.birdT <= 0) { this.birdT = 2.5 + Math.random() * 5; this.chirp(t + 0.05); }
    }
    if (this.night) {
      this.cricketT -= dt;
      if (this.cricketT <= 0) { this.cricketT = 0.4 + Math.random() * 1.1; this.cricket(t + 0.02); }
    }
  }
}
