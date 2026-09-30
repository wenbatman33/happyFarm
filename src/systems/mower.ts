import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sfx } from '../core/audio';
import { clamp } from '../core/rng';
import { GEO, mat, mesh } from '../world/materials';
import { tileOf } from '../world/grid';
import type { Game } from '../game';

// 手推除草機（docs/03 §4.4）：推著走、割過留下條紋、草屑從側邊噴出
const MAX_SPEED = 2.8;
const TURN_RATE = 2.8; // 每秒最大轉向（弧度）：車身有重量，轉彎會畫弧
const ACCEL = 4.5;
const DECEL = 7;
const DECK_AHEAD = 1.25; // 刀盤中心在主角前方多遠
const CUT_R = 0.58;

// 草坪條紋：一張蓋在圍籬內地面上的透明畫布
class LawnStripes {
  static SIZE = 32;
  static RES = 512;
  private cv = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private dirty = false;
  private fadeT = 0;
  private frame = 0;

  constructor(parent: THREE.Object3D) {
    this.cv.width = this.cv.height = LawnStripes.RES;
    this.ctx = this.cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(LawnStripes.SIZE, LawnStripes.SIZE);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.y = 0.015;
    m.receiveShadow = true;
    m.renderOrder = 1;
    parent.add(m);
  }

  private px(v: number): number { return (v + LawnStripes.SIZE / 2) * (LawnStripes.RES / LawnStripes.SIZE); }

  // 新的一刀蓋掉舊條紋（跟真的草坪一樣，最後割的方向決定深淺）
  stamp(a: { x: number; z: number }, b: { x: number; z: number }, light: boolean): void {
    const ax = this.px(a.x), ay = this.px(a.z), bx = this.px(b.x), by = this.px(b.z);
    const len = Math.hypot(bx - ax, by - ay) + 3;
    const w = 1.05 * (LawnStripes.RES / LawnStripes.SIZE);
    const c = this.ctx;
    c.save();
    c.translate((ax + bx) / 2, (ay + by) / 2);
    c.rotate(Math.atan2(by - ay, bx - ax));
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fillRect(-len / 2, -w / 2, len, w);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = light ? 'rgba(255, 250, 205, 0.15)' : 'rgba(20, 60, 12, 0.2)';
    c.fillRect(-len / 2, -w / 2, len, w);
    c.restore();
    this.dirty = true;
  }

  update(dt: number): void {
    // 條紋慢慢淡掉（草長回來）
    this.fadeT += dt;
    if (this.fadeT > 1) {
      this.fadeT = 0;
      const c = this.ctx;
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,0.008)';
      c.fillRect(0, 0, LawnStripes.RES, LawnStripes.RES);
      c.globalCompositeOperation = 'source-over';
      this.dirty = true;
    }
    this.frame++;
    if (this.dirty && this.frame % 2 === 0) { this.tex.needsUpdate = true; this.dirty = false; }
  }
}

export class Mower {
  active = false;
  holdTarget: { x: number; z: number } | null = null;
  autoRelease = false; // 點一下＝開到那裡就停；按住拖曳＝跟著手指
  private model = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private chute = new THREE.Object3D();
  private stripes: LawnStripes;
  private heading = 0;
  private speed = 0;
  private vel = 0;
  private load = 0;
  private clipAcc = 0;
  private lastPos = new THREE.Vector3();
  private lastDeck: { x: number; z: number } | null = null;
  private buzzT = 0;

  constructor(private game: Game) {
    this.stripes = new LawnStripes(game.world.root);
    this.build();
  }

  private build() {
    const rb = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r);
    this.model.position.z = DECK_AHEAD;
    this.model.add(this.body);
    const red = mat('#e8463a', { roughness: 0.45 });
    const deck = mesh(rb(0.95, 0.2, 0.8, 0.08), red);
    deck.position.y = 0.22;
    const skirt = mesh(rb(1.0, 0.08, 0.86, 0.035), mat('#b3302a'));
    skirt.position.y = 0.13;
    const bumper = mesh(rb(0.7, 0.08, 0.08, 0.035), mat('#f4efe6'));
    bumper.position.set(0, 0.24, 0.43);
    const engine = mesh(GEO.cyl, mat('#3d434c', { roughness: 0.4, metalness: 0.3 }));
    engine.scale.set(0.4, 0.26, 0.4);
    engine.position.set(0, 0.45, 0.05);
    const cap = mesh(GEO.cyl, mat('#f2b33d', { roughness: 0.4 }));
    cap.scale.set(0.3, 0.06, 0.3);
    cap.position.set(0, 0.6, 0.05);
    const knob = mesh(GEO.sphereLo, mat('#222'), false);
    knob.scale.setScalar(0.07);
    knob.position.set(0.14, 0.55, -0.12);
    this.body.add(deck, skirt, bumper, engine, cap, knob);
    // 輪子：外層 pivot 負責滾動
    for (const [x, z] of [[0.47, 0.3], [-0.47, 0.3], [0.47, -0.3], [-0.47, -0.3]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.13, z);
      const w = mesh(GEO.cyl, mat('#26262a', { roughness: 0.8 }));
      w.scale.set(0.26, 0.08, 0.26);
      w.rotation.z = Math.PI / 2;
      const hub = mesh(GEO.sphereLo, mat('#c9ccd2', { metalness: 0.5, roughness: 0.3 }), false);
      hub.scale.set(0.05, 0.1, 0.1);
      hub.position.x = x > 0 ? 0.04 : -0.04;
      pivot.add(w, hub);
      this.wheels.push(pivot);
      this.model.add(pivot);
    }
    // 出草口：在主角的右手邊（面向 +Z 時右邊是 -X）
    const chuteMesh = mesh(rb(0.26, 0.14, 0.32, 0.05), mat('#4a4f57'));
    chuteMesh.position.set(-0.58, 0.17, 0);
    chuteMesh.rotation.z = -0.25;
    this.chute.position.set(-0.72, 0.2, 0);
    this.body.add(chuteMesh, this.chute);
    // 把手：從刀盤後方斜斜延伸到主角手上
    const grip = new THREE.Vector3(0, 0.72, -0.77);
    for (const sx of [-0.27, 0.27]) {
      const from = new THREE.Vector3(sx, 0.3, -0.3);
      const to = grip.clone().setX(sx);
      const dir = to.clone().sub(from);
      const rod = mesh(GEO.cyl, mat('#c9ccd2', { metalness: 0.5, roughness: 0.35 }));
      rod.scale.set(0.045, dir.length(), 0.045);
      rod.position.copy(from).addScaledVector(dir, 0.5);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.body.add(rod);
    }
    const bar = mesh(GEO.cyl, mat('#222', { roughness: 0.9 }));
    bar.scale.set(0.07, 0.62, 0.07);
    bar.rotation.z = Math.PI / 2;
    bar.position.copy(grip);
    this.body.add(bar);
  }

  private deckPos(): { x: number; z: number } {
    const p = this.game.player.root.position;
    return { x: p.x + Math.sin(this.heading) * DECK_AHEAD, z: p.z + Math.cos(this.heading) * DECK_AHEAD };
  }

  toggle(on: boolean): void {
    if (on === this.active) return;
    const g = this.game, pl = g.player;
    this.active = on;
    pl.pushing = on;
    pl.pushSpeed = 0;
    this.holdTarget = null;
    const d = this.deckPos();
    g.particles.burst('fluff', new THREE.Vector3(d.x, 0.4, d.z), 12, { speed: 1.6, up: 1.4, gravity: -0.3, size: 0.13, life: 0.9 });
    if (on) {
      this.heading = pl.root.rotation.y;
      this.speed = 0;
      this.lastPos.copy(pl.root.position);
      this.lastDeck = null;
      pl.root.add(this.model);
      sfx.engineStart();
    } else {
      pl.root.remove(this.model);
      sfx.engineStop();
    }
  }

  update(dt: number, input: THREE.Vector2): void {
    this.stripes.update(dt);
    if (!this.active) return;
    const g = this.game, pl = g.player, p = pl.root.position;

    // ---- 操控：鍵盤方向優先，其次是手指／滑鼠的目標點 ----
    let throttle = 0;
    let desired: number | null = null;
    if (input.lengthSq() > 0.01) {
      desired = Math.atan2(input.x, input.y);
      throttle = 1;
      this.holdTarget = null;
    } else if (this.holdTarget) {
      const dx = this.holdTarget.x - p.x, dz = this.holdTarget.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { if (this.autoRelease) this.holdTarget = null; }
      else { desired = Math.atan2(dx, dz); throttle = clamp(d / 1.6, 0.35, 1); }
    }
    if (desired !== null) {
      const diff = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading));
      const maxTurn = TURN_RATE * dt;
      this.heading += clamp(diff, -maxTurn, maxTurn);
      throttle *= Math.max(0.2, Math.cos(diff)); // 大轉彎先減速
    }
    this.speed += clamp(MAX_SPEED * throttle - this.speed, -DECEL * dt, ACCEL * dt);

    // ---- 移動與碰撞 ----
    if (this.speed > 0.01) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const nx = p.x + fx * this.speed * dt, nz = p.z + fz * this.speed * dt;
      const ok = g.canDrive(nx, nz) && g.canDrive(nx + fx * DECK_AHEAD, nz + fz * DECK_AHEAD) && g.canDrive(nx + fx * (DECK_AHEAD + 0.45), nz + fz * (DECK_AHEAD + 0.45));
      if (ok) { p.x = nx; p.z = nz; }
      else {
        if (this.speed > 1.2) sfx.bump();
        this.speed = 0;
        if (this.autoRelease) this.holdTarget = null;
      }
    }
    pl.root.rotation.y = this.heading;
    pl.mover.yawGoal = this.heading;
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos.copy(p);
    this.vel = moved / Math.max(dt, 0.001);
    pl.pushSpeed = this.vel;

    // ---- 割草 ----
    const deck = this.deckPos();
    const now = g.state.now();
    let cut = g.world.mowGrass(deck.x, deck.z, CUT_R, now);
    if (cut) g.addHayProgress(cut);
    const hits = g.weeds.list.filter((w) => Math.hypot(w.tx + w.ox - deck.x, w.tz + w.oz - deck.z) < CUT_R + 0.18);
    for (const w of hits) g.mowWeed(w);
    if (hits.length) { cut += 4 * hits.length; navigator.vibrate?.(18); }
    const loadGoal = clamp(cut / Math.max(dt, 0.001) / 14, 0, 1);
    this.load += (loadGoal - this.load) * (1 - Math.exp(-(loadGoal > this.load ? 14 : 4) * dt));

    // 草屑從出草口往右側噴
    this.clipAcc += cut * 0.8;
    if (this.clipAcc >= 1) {
      const n = Math.min(6, Math.floor(this.clipAcc));
      this.clipAcc -= n;
      const at = this.chute.getWorldPosition(new THREE.Vector3());
      const right = new THREE.Vector3(-Math.cos(this.heading), 0.3, Math.sin(this.heading));
      g.particles.burst('grass', at, n, { speed: 1.2, up: 2.0, size: 0.55, life: 0.75, dir: right.multiplyScalar(2) });
    }

    // 割草條紋：朝遠離鏡頭方向割＝亮條，朝鏡頭割＝暗條
    if (this.vel > 0.2) {
      const t = tileOf(deck.x, deck.z);
      if (g.grid.inBounds(t.x, t.z) && !g.grid.path[g.grid.idx(t.x, t.z)]) {
        const light = Math.cos(this.heading - g.stage.yaw) < 0;
        this.stripes.stamp(this.lastDeck ?? deck, deck, light);
      }
    }
    this.lastDeck = deck;

    // ---- 引擎聲、車身震動、輪子滾動 ----
    sfx.engineUpdate(clamp(this.vel / MAX_SPEED, 0, 1), this.load);
    this.buzzT += dt;
    const amp = 1 + this.load * 2.5;
    this.body.position.y = Math.sin(this.buzzT * 62) * 0.007 * amp;
    this.body.rotation.z = Math.sin(this.buzzT * 47) * 0.012 * amp;
    this.body.rotation.x = Math.sin(this.buzzT * 39) * 0.006 * amp;
    this.wheels.forEach((w) => (w.rotation.x += moved / 0.13));
  }
}
