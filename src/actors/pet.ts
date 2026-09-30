import * as THREE from 'three';
import { GEO, mat, mesh, withRim } from '../world/materials';
import type { Grid } from '../world/grid';
import { Mover } from './mover';
import { clamp, lerp } from '../core/rng';
import type { Player } from './player';

// 柯基「麻糬」：M0 用程式建模的佔位版，M2 換成 Blender GLB
export type PetState = 'idle' | 'follow' | 'wander' | 'react' | 'dig' | 'sleep' | 'petted';
type PetAnim = 'idle' | 'walk' | 'sit' | 'happy' | 'dig' | 'sleep' | 'petted';

export interface PetContext {
  player: Player;
  night: boolean;
  doghouse: { x: number; z: number; rotY: number };
  treasures: { id: string; x: number; z: number }[];
  followDist: number; // 跟主角保持的距離（DEV 可調）
}

const rim = (c: string) => withRim(mat(c, { roughness: 0.75 }), 0.16);

export class Pet {
  root = new THREE.Group();
  mover: Mover;
  name = '麻糬';
  state: PetState = 'idle';
  forcedAnim: PetAnim | null = null; // DEV：強制播放
  private anim: PetAnim = 'idle';
  private stateT = 0;
  private repathT = 0;
  private walkPhase = 0;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private ears: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private tail = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private tongue!: THREE.Mesh;
  private digTarget: { id: string; x: number; z: number } | null = null;
  private blinkT = 3;
  private fxT = 0;
  onBark?: () => void;
  onDigTick?: (at: THREE.Vector3) => void;
  onDug?: (id: string, at: THREE.Vector3) => void;
  onZzz?: (at: THREE.Vector3) => void;

  constructor(grid: Grid) {
    this.mover = new Mover(this.root, grid);
    this.build();
  }

  private build() {
    const orange = rim('#e8954a');
    const white = rim('#fff6ea');
    const pink = mat('#ff9fae', { roughness: 0.8 });
    const black = mat('#1d1512', { roughness: 0.2 });
    this.root.add(this.body);

    const torso = mesh(GEO.capsule, orange);
    torso.scale.set(0.42, 0.34, 0.4);
    torso.rotation.x = Math.PI / 2;
    torso.position.set(0, 0.32, 0);
    const belly = mesh(GEO.capsule, white);
    belly.scale.set(0.36, 0.3, 0.32);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, 0.26, 0.02);
    const chest = mesh(GEO.sphere, white);
    chest.scale.set(0.34, 0.34, 0.3);
    chest.position.set(0, 0.34, 0.24);
    const butt = mesh(GEO.sphere, white);
    butt.scale.set(0.36, 0.34, 0.3);
    butt.position.set(0, 0.34, -0.26);
    this.body.add(torso, belly, chest, butt);

    // 短短的腿（柯基！）
    for (const [x, z] of [[0.12, 0.2], [-0.12, 0.2], [0.12, -0.2], [-0.12, -0.2]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.2, z);
      const l = mesh(GEO.capsule, orange);
      l.scale.set(0.1, 0.07, 0.1);
      l.position.y = -0.08;
      const paw = mesh(GEO.sphere, white);
      paw.scale.set(0.12, 0.08, 0.14);
      paw.position.set(0, -0.16, 0.02);
      leg.add(l, paw);
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.tail.position.set(0, 0.42, -0.4);
    const t = mesh(GEO.sphere, orange);
    t.scale.set(0.12, 0.12, 0.16);
    t.position.z = -0.04;
    this.tail.add(t);
    this.body.add(this.tail);

    // 頭
    this.head.position.set(0, 0.55, 0.3);
    this.body.add(this.head);
    const skull = mesh(GEO.sphere, orange);
    skull.scale.set(0.42, 0.38, 0.4);
    const muzzle = mesh(GEO.sphere, white);
    muzzle.scale.set(0.26, 0.19, 0.26);
    muzzle.position.set(0, -0.07, 0.15);
    const blaze = mesh(GEO.sphere, white);
    blaze.scale.set(0.08, 0.24, 0.1);
    blaze.position.set(0, 0.05, 0.15);
    const nose = mesh(GEO.sphere, black, false);
    nose.scale.set(0.08, 0.06, 0.06);
    nose.position.set(0, -0.03, 0.28);
    this.tongue = mesh(GEO.sphere, pink, false);
    this.tongue.scale.set(0.07, 0.03, 0.09);
    this.tongue.position.set(0, -0.14, 0.24);
    this.tongue.visible = false;
    this.head.add(skull, muzzle, blaze, nose, this.tongue);
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * 0.095, 0.04, 0.17);
      const ball = mesh(GEO.sphere, black, false);
      ball.scale.set(0.075, 0.09, 0.05);
      const hl = mesh(GEO.sphereLo, mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 }), false);
      hl.scale.setScalar(0.025);
      hl.position.set(0.015, 0.02, 0.02);
      e.add(ball, hl);
      this.eyes.push(e);
      // 大耳朵
      const ear = new THREE.Group();
      ear.position.set(sx * 0.12, 0.14, -0.03);
      ear.rotation.z = -sx * 0.35;
      const outer = mesh(GEO.cone, orange);
      outer.scale.set(0.16, 0.26, 0.08);
      outer.position.y = 0.12;
      const inner = mesh(GEO.cone, pink, false);
      inner.scale.set(0.1, 0.18, 0.04);
      inner.position.set(0, 0.1, 0.03);
      ear.add(outer, inner);
      this.ears.push(ear);
      this.head.add(e, ear);
    }
    // 項圈
    const collar = mesh(new THREE.TorusGeometry(0.15, 0.028, 8, 20), mat('#d8453c'));
    collar.position.set(0, 0.44, 0.24);
    collar.rotation.x = Math.PI / 2 - 0.5;
    const tag = mesh(GEO.sphereLo, mat('#f2cf5a', { metalness: 0.6, roughness: 0.3 }), false);
    tag.scale.setScalar(0.06);
    tag.position.set(0, 0.36, 0.36);
    this.body.add(collar, tag);
  }

  react(): void {
    if (this.state === 'sleep' || this.state === 'petted') return;
    this.mover.stop();
    this.state = 'react';
    this.stateT = 0;
    this.onBark?.();
  }

  startPetted(faceX: number, faceZ: number): void {
    this.mover.stop();
    this.mover.face(faceX, faceZ);
    this.state = 'petted';
    this.stateT = 0;
  }

  get busyWithPlayer(): boolean { return this.state === 'petted'; }

  update(dt: number, ctx: PetContext): void {
    this.stateT += dt;
    this.repathT -= dt;
    const p = this.root.position;
    const pp = ctx.player.root.position;
    const dist = Math.hypot(pp.x - p.x, pp.z - p.z);

    // ---- AI 決策 ----
    if (this.state === 'react' && this.stateT > 0.9) this.state = 'idle';
    if (this.state === 'petted' && this.stateT > 1.6) this.state = 'idle';
    const locked = this.state === 'react' || this.state === 'petted' || (this.state === 'dig' && this.digTarget && !this.mover.moving);
    if (!locked) {
      if (ctx.night) {
        if (this.state !== 'sleep') {
          this.state = 'sleep';
          const d = ctx.doghouse;
          this.mover.speed = 2.5;
          this.mover.goTo(d.x + Math.sin(d.rotY) * 1.1, d.z + Math.cos(d.rotY) * 1.1, () => this.mover.face(d.x, d.z));
        }
      } else {
        if (this.state === 'sleep') this.state = 'idle';
        const tr = ctx.treasures.find((t) => Math.hypot(t.x - pp.x, t.z - pp.z) < 7);
        if (tr && this.state !== 'dig') {
          this.state = 'dig';
          this.digTarget = tr;
          this.mover.speed = 5.5;
          this.mover.goTo(tr.x, tr.z, () => { this.stateT = 0; this.mover.face(tr.x, tr.z); }, 0.35);
          this.onBark?.();
        } else if (this.state !== 'dig') {
          const fd = ctx.followDist;
          if (dist > fd + 1.3 && (this.repathT <= 0 || !this.mover.moving)) {
            // 落後太多才跟上，停在主角斜後方 fd 公尺
            this.state = 'follow';
            this.repathT = 0.5;
            this.mover.speed = dist > fd + 3 ? 6.2 : 4.2;
            const back = ctx.player.root.rotation.y + Math.PI + 0.7;
            this.mover.goTo(pp.x + Math.sin(back) * fd, pp.z + Math.cos(back) * fd, () => { this.state = 'idle'; this.stateT = 0; });
          } else if (dist < fd * 0.5 && !this.mover.moving && this.stateT > 0.8) {
            // 靠太近：自己退開一點，保持距離
            this.state = 'wander';
            this.mover.speed = 2.6;
            const ax = (p.x - pp.x) / (dist || 1), az = (p.z - pp.z) / (dist || 1);
            this.mover.goTo(pp.x + (ax || 1) * fd, pp.z + az * fd, () => { this.state = 'idle'; this.stateT = 0; this.mover.face(pp.x, pp.z); });
          } else if (this.state === 'idle' && ctx.player.idleTime > 4 && this.stateT > 3 && Math.random() < dt * 0.4) {
            this.state = 'wander';
            this.mover.speed = 2.2;
            const a = Math.random() * Math.PI * 2;
            const r = fd + 0.4 + Math.random() * 1.2;
            this.mover.goTo(pp.x + Math.cos(a) * r, pp.z + Math.sin(a) * r, () => { this.state = 'idle'; this.stateT = 0; });
          } else if (this.state === 'idle' && Math.random() < dt * 0.3) {
            this.mover.face(pp.x, pp.z);
          }
        }
      }
    }
    // 挖寶：到定點後挖 1.6 秒
    if (this.state === 'dig' && this.digTarget && !this.mover.moving) {
      if (!ctx.treasures.find((t) => t.id === this.digTarget!.id)) { this.digTarget = null; this.state = 'idle'; }
      else {
        this.fxT -= dt;
        if (this.fxT <= 0) { this.fxT = 0.12; this.onDigTick?.(new THREE.Vector3(this.digTarget.x, 0.1, this.digTarget.z)); }
        if (this.stateT > 1.6) {
          const id = this.digTarget.id;
          const at = new THREE.Vector3(this.digTarget.x, 0.3, this.digTarget.z);
          this.digTarget = null;
          this.state = 'react';
          this.stateT = 0;
          this.onDug?.(id, at);
        }
      }
    }
    this.mover.update(dt);

    // ---- 動畫 ----
    if (this.state === 'sleep' && !this.mover.moving) this.anim = 'sleep';
    else if (this.mover.moving) this.anim = 'walk';
    else if (this.state === 'react') this.anim = 'happy';
    else if (this.state === 'petted') this.anim = 'petted';
    else if (this.state === 'dig') this.anim = 'dig';
    else this.anim = this.stateT > 6 ? 'sit' : 'idle';
    if (this.forcedAnim) this.anim = this.forcedAnim;
    this.animate(dt);
    if (this.anim === 'sleep') {
      this.fxT -= dt;
      if (this.fxT <= 0) { this.fxT = 1.4; this.onZzz?.(this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0))); }
    }
  }

  private animate(dt: number) {
    const t = performance.now() / 1000;
    const k = 1 - Math.exp(-14 * dt);
    const b = this.body;
    let bodyY = 0, pitch = 0, spin = 0, headPitch = 0, headYaw = 0, tailSpeed = 6, tailAmp = 0.5, eyeOpen = 1, tongue = false;
    const legRot = [0, 0, 0, 0];
    switch (this.anim) {
      case 'walk': {
        this.walkPhase += dt * this.mover.speed * 4.2;
        const s = Math.sin(this.walkPhase);
        legRot[0] = s * 0.8; legRot[3] = s * 0.8; legRot[1] = -s * 0.8; legRot[2] = -s * 0.8;
        bodyY = Math.abs(Math.cos(this.walkPhase)) * 0.05;
        tailSpeed = 14; tailAmp = 0.6; tongue = this.mover.speed > 5;
        break;
      }
      case 'idle':
        bodyY = Math.sin(t * 3) * 0.008;
        headYaw = Math.sin(t * 0.6) * 0.3;
        headPitch = Math.sin(t * 0.9) * 0.08;
        break;
      case 'sit':
        pitch = -0.38; bodyY = -0.02;
        legRot[2] = legRot[3] = -1.2; legRot[0] = legRot[1] = 0.3;
        headPitch = -0.15; headYaw = Math.sin(t * 0.5) * 0.25;
        tailSpeed = 4;
        break;
      case 'happy': {
        const u = clamp(this.stateT / 0.9, 0, 1);
        bodyY = Math.sin(Math.PI * u) * 0.45;
        spin = u * Math.PI * 2;
        legRot[0] = legRot[1] = -0.8 * Math.sin(Math.PI * u);
        legRot[2] = legRot[3] = 0.8 * Math.sin(Math.PI * u);
        tailSpeed = 22; tailAmp = 0.8; tongue = true; eyeOpen = 0.3;
        break;
      }
      case 'dig':
        pitch = 0.3; headPitch = 0.5;
        legRot[0] = Math.sin(t * 28) * 0.9; legRot[1] = -Math.sin(t * 28) * 0.9;
        tailSpeed = 18; tailAmp = 0.7;
        break;
      case 'sleep':
        bodyY = -0.14 + Math.sin(t * 1.6) * 0.01;
        legRot[0] = legRot[1] = -1.3; legRot[2] = legRot[3] = 1.3;
        headPitch = 0.35; tailAmp = 0.05; eyeOpen = 0.12;
        break;
      case 'petted':
        pitch = -0.38; bodyY = -0.02;
        legRot[2] = legRot[3] = -1.2; legRot[0] = legRot[1] = 0.3;
        headPitch = -0.3; headYaw = Math.sin(t * 5) * 0.12;
        tailSpeed = 24; tailAmp = 0.8; eyeOpen = 0.18; tongue = true;
        break;
    }
    b.position.y = lerp(b.position.y, bodyY, k);
    b.rotation.x = lerp(b.rotation.x, pitch, k);
    b.rotation.y = this.anim === 'happy' ? spin : lerp(b.rotation.y, 0, k);
    this.head.rotation.x = lerp(this.head.rotation.x, headPitch, k);
    this.head.rotation.y = lerp(this.head.rotation.y, headYaw, k);
    this.legs.forEach((l, i) => (l.rotation.x = lerp(l.rotation.x, legRot[i], k * 1.5)));
    this.tail.rotation.y = Math.sin(t * tailSpeed) * tailAmp;
    this.ears.forEach((e, i) => (e.rotation.x = Math.sin(t * 7 + i) * (this.anim === 'walk' ? 0.12 : 0.03)));
    this.tongue.visible = tongue;
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    const blink = this.blinkT < 0.1 ? 0.15 : 1;
    this.eyes.forEach((e) => (e.scale.y = lerp(e.scale.y, Math.min(eyeOpen, blink), k * 2)));
  }
}
