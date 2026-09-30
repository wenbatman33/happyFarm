import * as THREE from 'three';
import { GEO, mat, mesh, withRim } from '../world/materials';
import type { Grid } from '../world/grid';
import { Mover } from './mover';
import { clamp, lerp } from '../core/rng';

// 乳牛「花花」：M0 程式建模佔位版
export type CowAnim = 'idle' | 'walk' | 'graze' | 'eat' | 'happy' | 'brushed' | 'milked' | 'sleep';

export interface CowContext {
  night: boolean;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  sleepSpot: { x: number; z: number };
  onGraze: (x: number, z: number) => void; // 低頭吃草：把嘴邊的草啃短
  onMoo: (happy: boolean) => void;
  onBell: () => void;
  hungry: boolean;
}

const rim = (c: string) => withRim(mat(c, { roughness: 0.7 }), 0.14);

// 頭上的需求泡泡（emoji 貼圖快取）
const bubbleTex = new Map<string, THREE.Texture>();
function bubbleTexture(emoji: string): THREE.Texture {
  let t = bubbleTex.get(emoji);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(0,0,0,0.12)';
  c.beginPath(); c.arc(66, 62, 50, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fffaf0';
  c.beginPath(); c.arc(64, 58, 50, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(52, 100); c.lineTo(64, 124); c.lineTo(76, 100); c.fill();
  c.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(emoji, 64, 62);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  bubbleTex.set(emoji, t);
  return t;
}

export class Cow {
  root = new THREE.Group();
  mover: Mover;
  held = false; // 玩家照顧中：停下來不亂走
  private anim: CowAnim = 'idle';
  private react: { anim: CowAnim; t: number; dur: number } | null = null;
  private mode: 'idle' | 'walk' | 'graze' | 'sleep' = 'idle';
  private modeT = 0;
  private nextDecide = 2;
  private mooT = 18;
  private bellT = 0;
  private grazeT = 0;
  private walkPhase = 0;
  private blinkT = 2;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private snout = new THREE.Group();
  private legs: THREE.Group[] = [];
  private tail = new THREE.Group();
  private ears: THREE.Object3D[] = [];
  private eyes: THREE.Object3D[] = [];
  private bubble: THREE.Sprite;
  private bubbleEmoji: string | null = null;
  udderLocal = new THREE.Vector3(0, 0.36, -0.22);

  constructor(grid: Grid) {
    this.mover = new Mover(this.root, grid);
    this.mover.speed = 0.9;
    this.root.userData.kind = 'cow';
    this.build();
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, depthTest: false }));
    this.bubble.scale.setScalar(0.62);
    this.bubble.position.y = 2.05;
    this.bubble.renderOrder = 5;
    this.bubble.visible = false;
    this.root.add(this.bubble);
  }

  private build() {
    const white = rim('#fbf7f0');
    const black = rim('#2d2926');
    const pink = mat('#f4a7b0', { roughness: 0.6 });
    const hoof = mat('#4a3a30');
    const cream = mat('#f1e3c2');
    this.root.add(this.body);

    const torso = mesh(GEO.capsule, white);
    torso.scale.set(0.92, 0.58, 0.8);
    torso.rotation.x = Math.PI / 2;
    torso.position.y = 0.85;
    this.body.add(torso);
    // 黑色斑塊
    for (const [x, y, z, s] of [[0.38, 0.95, 0.18, 0.34], [-0.37, 0.98, -0.28, 0.36], [0.12, 1.2, -0.38, 0.3], [-0.2, 1.17, 0.32, 0.26], [0.36, 0.84, -0.42, 0.24]]) {
      const p = mesh(GEO.sphere, black, false);
      p.scale.set(s, s * 0.8, s);
      p.position.set(x * 1.03, y, z);
      this.body.add(p);
    }
    // 乳房
    const udder = mesh(GEO.sphere, pink);
    udder.scale.set(0.36, 0.22, 0.3);
    udder.position.set(0, 0.46, -0.22);
    this.body.add(udder);
    for (const [x, z] of [[0.07, -0.16], [-0.07, -0.16], [0.07, -0.28], [-0.07, -0.28]]) {
      const t = mesh(GEO.cyl, pink, false);
      t.scale.set(0.035, 0.09, 0.035);
      t.position.set(x, 0.33, z);
      this.body.add(t);
    }
    // 腿
    for (const [x, z] of [[0.27, 0.36], [-0.27, 0.36], [0.27, -0.36], [-0.27, -0.36]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.6, z);
      const l = mesh(GEO.capsule, white);
      l.scale.set(0.2, 0.2, 0.2);
      l.position.y = -0.26;
      const h = mesh(GEO.cyl, hoof);
      h.scale.set(0.2, 0.1, 0.2);
      h.position.y = -0.55;
      leg.add(l, h);
      this.legs.push(leg);
      this.body.add(leg);
    }
    // 尾巴
    this.tail.position.set(0, 1.05, -0.64);
    const tl = mesh(GEO.cyl, white, false);
    tl.scale.set(0.04, 0.55, 0.04);
    tl.position.set(0, -0.26, -0.05);
    tl.rotation.x = 0.18;
    const tuft = mesh(GEO.sphere, black, false);
    tuft.scale.set(0.1, 0.16, 0.1);
    tuft.position.set(0, -0.55, -0.1);
    this.tail.add(tl, tuft);
    this.body.add(this.tail);
    // 項圈與鈴鐺
    const collar = mesh(new THREE.TorusGeometry(0.25, 0.04, 8, 22), mat('#d8453c'));
    collar.position.set(0, 1.0, 0.52);
    collar.rotation.x = Math.PI / 2 - 0.55;
    const bell = mesh(GEO.sphere, mat('#f2c043', { metalness: 0.6, roughness: 0.3 }));
    bell.scale.set(0.16, 0.18, 0.16);
    bell.position.set(0, 0.8, 0.66);
    this.body.add(collar, bell);

    // 頭
    this.head.position.set(0, 1.18, 0.66);
    this.body.add(this.head);
    const skull = mesh(GEO.sphere, white);
    skull.scale.set(0.6, 0.56, 0.58);
    const eyePatch = mesh(GEO.sphere, black, false);
    eyePatch.scale.set(0.24, 0.26, 0.2);
    eyePatch.position.set(0.18, 0.08, 0.16);
    this.head.add(skull, eyePatch);
    this.snout.position.set(0, -0.12, 0.25);
    const muzzle = mesh(GEO.sphere, pink);
    muzzle.scale.set(0.5, 0.34, 0.3);
    this.snout.add(muzzle);
    for (const sx of [-0.1, 0.1]) {
      const n = mesh(GEO.sphereLo, mat('#b86b76'), false);
      n.scale.set(0.07, 0.05, 0.03);
      n.position.set(sx, 0.02, 0.15);
      this.snout.add(n);
    }
    this.head.add(this.snout);
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * 0.17, 0.08, 0.24);
      const ball = mesh(GEO.sphere, mat('#1d1512', { roughness: 0.15 }), false);
      ball.scale.set(0.13, 0.16, 0.08);
      const hl = mesh(GEO.sphereLo, mat('#fff', { emissive: '#fff', emissiveIntensity: 0.6 }), false);
      hl.scale.setScalar(0.04);
      hl.position.set(0.02, 0.03, 0.035);
      e.add(ball, hl);
      this.eyes.push(e);
      const horn = mesh(GEO.cone, cream);
      horn.scale.set(0.08, 0.16, 0.08);
      horn.position.set(sx * 0.17, 0.3, 0.0);
      horn.rotation.z = -sx * 0.5;
      const ear = new THREE.Group();
      ear.position.set(sx * 0.3, 0.12, -0.02);
      ear.rotation.z = -sx * 0.25;
      const eo = mesh(GEO.sphere, sx > 0 ? black : white);
      eo.scale.set(0.3, 0.09, 0.17);
      eo.position.x = sx * 0.1;
      const ei = mesh(GEO.sphere, pink, false);
      ei.scale.set(0.2, 0.05, 0.1);
      ei.position.set(sx * 0.1, 0.02, 0.02);
      ear.add(eo, ei);
      this.ears.push(ear);
      this.head.add(e, horn, ear);
    }
    const tuftTop = mesh(GEO.sphere, black, false);
    tuftTop.scale.set(0.2, 0.1, 0.16);
    tuftTop.position.set(0, 0.28, 0.04);
    this.head.add(tuftTop);
  }

  // 頭上泡泡：null 表示隱藏
  setBubble(emoji: string | null): void {
    if (emoji === this.bubbleEmoji) return;
    this.bubbleEmoji = emoji;
    this.bubble.visible = !!emoji;
    if (emoji) { (this.bubble.material as THREE.SpriteMaterial).map = bubbleTexture(emoji); (this.bubble.material as THREE.SpriteMaterial).needsUpdate = true; }
  }

  // 播放短反應（開心、吃飯、被刷毛、被擠奶）
  play(anim: CowAnim, dur: number): void {
    this.react = { anim, t: 0, dur };
  }

  // 走到照顧位置、朝北（對著飼料槽）
  goTo(x: number, z: number, faceYaw: number, onArrive?: () => void): void {
    this.mode = 'walk';
    this.mover.speed = 1.3;
    const ok = this.mover.goTo(x, z, () => { this.mover.yawGoal = faceYaw; this.mode = 'idle'; onArrive?.(); });
    if (!ok) { this.root.position.set(x, 0, z); this.mover.yawGoal = faceYaw; this.mode = 'idle'; onArrive?.(); }
  }

  get moving(): boolean { return this.mover.moving; }

  update(dt: number, ctx: CowContext): void {
    this.modeT += dt;
    if (this.react) { this.react.t += dt; if (this.react.t >= this.react.dur) this.react = null; }
    const p = this.root.position;

    // ---- AI ----
    if (!this.held) {
      if (ctx.night) {
        if (this.mode !== 'sleep' && !this.mover.moving) {
          const s = ctx.sleepSpot;
          if (Math.hypot(p.x - s.x, p.z - s.z) > 0.3) this.goTo(s.x, s.z, 0, () => { this.mode = 'sleep'; });
          else this.mode = 'sleep';
        }
      } else {
        if (this.mode === 'sleep') { this.mode = 'idle'; this.modeT = 0; }
        this.nextDecide -= dt;
        if (this.nextDecide <= 0 && !this.mover.moving) {
          this.nextDecide = 5 + Math.random() * 4;
          const b = ctx.bounds;
          if (Math.random() < 0.55) {
            this.mode = 'walk';
            this.mover.speed = 0.9;
            this.mover.goTo(lerp(b.x0, b.x1, Math.random()), lerp(b.z0, b.z1, Math.random()), () => { this.mode = 'idle'; });
          } else {
            this.mode = 'graze';
            this.modeT = 0;
          }
        }
        if (this.mode === 'graze') {
          this.grazeT -= dt;
          if (this.grazeT <= 0) {
            this.grazeT = 1;
            const f = new THREE.Vector3(0, 0, 1.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
            ctx.onGraze(p.x + f.x, p.z + f.z);
          }
          if (this.modeT > 5) this.mode = 'idle';
        }
        // 偶爾哞一聲（餓的時候比較常叫）
        this.mooT -= dt;
        if (this.mooT <= 0) {
          this.mooT = (ctx.hungry ? 12 : 26) + Math.random() * 14;
          ctx.onMoo(false);
          this.play('happy', 1.0);
        }
      }
    }
    const wasMoving = this.mover.moving;
    this.mover.update(dt);
    if (wasMoving) {
      this.bellT -= dt;
      if (this.bellT <= 0) { this.bellT = 1.1; ctx.onBell(); }
    }

    // ---- 動畫 ----
    this.anim = this.react?.anim ?? (this.mover.moving ? 'walk' : this.mode === 'sleep' ? 'sleep' : this.mode === 'graze' ? 'graze' : 'idle');
    this.animate(dt);
  }

  private animate(dt: number) {
    const t = performance.now() / 1000;
    const k = 1 - Math.exp(-10 * dt);
    let bodyY = 0, headPitch = 0, headYaw = 0, headRoll = 0, tailAmp = 0.25, tailSpeed = 2.2, eyeOpen = 1, chew = 0;
    const legRot = [0, 0, 0, 0];
    const u = this.react ? clamp(this.react.t / this.react.dur, 0, 1) : 0;
    switch (this.anim) {
      case 'walk': {
        this.walkPhase += dt * this.mover.speed * 5.5;
        const s = Math.sin(this.walkPhase);
        legRot[0] = legRot[3] = s * 0.45;
        legRot[1] = legRot[2] = -s * 0.45;
        bodyY = Math.abs(Math.cos(this.walkPhase)) * 0.03;
        headPitch = Math.sin(this.walkPhase * 2) * 0.05;
        break;
      }
      case 'idle':
        bodyY = Math.sin(t * 1.6) * 0.008;
        headYaw = Math.sin(t * 0.4) * 0.25;
        chew = 1;
        break;
      case 'graze':
      case 'eat':
        headPitch = 0.75;
        chew = 1.6;
        tailSpeed = 3;
        break;
      case 'happy':
        headPitch = -0.35 * Math.sin(Math.PI * u);
        bodyY = 0.05 * Math.sin(Math.PI * u);
        tailAmp = 0.7; tailSpeed = 9;
        eyeOpen = 0.35;
        break;
      case 'brushed':
        // 被刷毛：瞇眼、頭歪向主角、尾巴甩得很開心
        headRoll = 0.2; headYaw = -0.45; headPitch = -0.1;
        eyeOpen = 0.15; tailAmp = 0.8; tailSpeed = 10;
        bodyY = Math.sin(t * 3) * 0.01;
        break;
      case 'milked':
        headYaw = -0.9 + Math.sin(t * 0.8) * 0.15; // 回頭看主角
        chew = 1;
        tailAmp = 0.45; tailSpeed = 4;
        break;
      case 'sleep':
        bodyY = -0.42;
        legRot[0] = legRot[1] = -1.4; legRot[2] = legRot[3] = 1.4;
        headPitch = 0.3; headRoll = 0.15;
        eyeOpen = 0.1; tailAmp = 0.05;
        bodyY += Math.sin(t * 1.2) * 0.012;
        break;
    }
    this.body.position.y = lerp(this.body.position.y, bodyY, k);
    this.head.rotation.x = lerp(this.head.rotation.x, headPitch, k);
    this.head.rotation.y = lerp(this.head.rotation.y, headYaw, k);
    this.head.rotation.z = lerp(this.head.rotation.z, headRoll, k);
    this.legs.forEach((l, i) => (l.rotation.x = lerp(l.rotation.x, legRot[i], k * 1.4)));
    this.tail.rotation.z = Math.sin(t * tailSpeed) * tailAmp;
    this.snout.rotation.y = chew ? Math.sin(t * 5 * chew) * 0.09 : 0;
    this.snout.position.y = -0.12 + (chew ? Math.abs(Math.sin(t * 5 * chew)) * 0.015 : 0);
    this.ears.forEach((e, i) => (e.rotation.x = Math.sin(t * 1.3 + i * 2) * 0.12 + (Math.sin(t * 0.37 + i) > 0.97 ? 0.4 : 0)));
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    const open = Math.min(eyeOpen, this.blinkT < 0.12 ? 0.12 : 1);
    this.eyes.forEach((e) => (e.scale.y = lerp(e.scale.y, open, k * 2)));
    if (this.bubble.visible) this.bubble.position.y = 2.05 + Math.sin(t * 2.2) * 0.06 + (this.anim === 'sleep' ? -0.4 : 0);
  }
}
