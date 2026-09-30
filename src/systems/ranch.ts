import * as THREE from 'three';
import { Cow } from '../actors/cow';
import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { COW_BRUSH_DAILY, COW_HUNGRY_MS, MILK_REGEN_MS, MILK_XP, QUALITY_LABEL, cowHearts, type Quality } from '../data/economy';
import { GEO, mat, mesh } from '../world/materials';
import { clamp } from '../core/rng';
import type { Game } from '../game';
import type { CowSave } from './state';

// 牧場：照顧乳牛（餵牧草 → 產奶 → 擠奶；每天刷毛增加親密度）
export type CowAct = 'feed' | 'brush' | 'milk';
export interface CowMenuItem { act: CowAct; emoji: string; label: string; enabled: boolean; note: string }

const fmt = (ms: number): string => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`;
};

export class Ranch {
  cow: Cow;
  private props = new THREE.Group(); // 小板凳＋牛奶桶（擠奶時才出現）
  private milkSurface: THREE.Mesh;
  private milkLevel = 0;
  private readyCb: (() => void) | null = null;
  private readyYaw = Math.PI;
  private readyWait = 0;
  private sleeping = false;

  constructor(private game: Game) {
    this.cow = new Cow(game.grid);
    const c = game.world.cowCareSpot;
    this.cow.root.position.set(c.x - 1, 0, c.z + 1.2);
    game.stage.scene.add(this.cow.root);

    // 三腳小板凳
    const wood = mat('#b07a48');
    const stool = new THREE.Group();
    const seat = mesh(GEO.cyl, wood);
    seat.scale.set(0.34, 0.06, 0.34);
    seat.position.y = 0.3;
    stool.add(seat);
    for (let i = 0; i < 3; i++) {
      const leg = mesh(GEO.cyl, wood);
      const a = (i / 3) * Math.PI * 2;
      leg.scale.set(0.04, 0.3, 0.04);
      leg.position.set(Math.cos(a) * 0.1, 0.15, Math.sin(a) * 0.1);
      stool.add(leg);
    }
    const s = this.pose('milk').player;
    stool.position.set(s.x, 0, s.z + 0.12);
    // 牛奶桶
    const bucket = new THREE.Group();
    const metal = mat('#c9d0d8', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
    const wall = mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.3, 18, 1, true), metal);
    wall.position.y = 0.15;
    const bottom = mesh(new THREE.CircleGeometry(0.14, 18), metal, false);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.01;
    const rimRing = mesh(new THREE.TorusGeometry(0.17, 0.015, 6, 20), metal, false);
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = 0.3;
    this.milkSurface = mesh(new THREE.CircleGeometry(0.155, 18), mat('#fffdf6', { roughness: 0.25, emissive: '#fff6e0', emissiveIntensity: 0.15 }), false);
    this.milkSurface.rotation.x = -Math.PI / 2;
    bucket.add(wall, bottom, rimRing, this.milkSurface);
    bucket.position.set(s.x, 0, s.z - 0.4);
    this.props.add(stool, bucket);
    this.props.visible = false;
    game.world.root.add(this.props);
  }

  get d(): CowSave { return this.game.state.data.cows[0]; }
  get name(): string { return this.d.name; }
  hungry(now: number): boolean { return now - this.d.fedAt > COW_HUNGRY_MS; }
  milkReady(now: number): boolean { const r = this.d.milkReadyAt; return r !== null && now >= r; }
  hearts(): number { return cowHearts(this.d.affection); }

  brushesLeft(now: number): number {
    const d = this.d;
    if (d.brushDay !== dayKey(now)) { d.brushDay = dayKey(now); d.brushes = 0; }
    return COW_BRUSH_DAILY - d.brushes;
  }

  // 照顧時的站位：餵草時牛朝北對著飼料槽；擠奶、刷毛時牛側身朝東，主角坐／站在靠鏡頭的南側
  pose(act: CowAct): { cow: { x: number; z: number; yaw: number }; player: { x: number; z: number; yaw: number } } {
    const c = this.game.world.cowCareSpot;
    if (act === 'feed') return { cow: { x: c.x, z: c.z, yaw: Math.PI }, player: { x: c.x + 0.95, z: c.z + 0.3, yaw: -2.4 } };
    const m = { x: c.x - 0.4, z: c.z + 0.55 };
    if (act === 'brush') return { cow: { ...m, yaw: Math.PI / 2 }, player: { x: m.x + 0.15, z: m.z + 0.85, yaw: Math.PI } };
    return { cow: { ...m, yaw: Math.PI / 2 }, player: { x: m.x - 0.22, z: m.z + 0.8, yaw: Math.PI } };
  }

  standSpot(act: CowAct): { x: number; z: number } {
    return this.pose(act).player;
  }

  menu(now: number): { title: string; sub: string; items: CowMenuItem[] } {
    const d = this.d;
    const h = this.hearts();
    const hay = this.game.state.data.inventory.hay ?? 0;
    const hungry = this.hungry(now), ready = this.milkReady(now), left = this.brushesLeft(now);
    const zz = this.sleeping;
    const sub = zz ? '睡得很香 💤' : ready ? '奶水飽飽，可以擠了！' : hungry ? '肚子餓了，想吃牧草…' : '心情很好 ♪';
    return {
      title: `🐄 ${d.name}　${'♥'.repeat(h)}${'♡'.repeat(5 - h)}`,
      sub,
      items: [
        { act: 'feed', emoji: '🌾', label: '餵牧草', enabled: !zz && hungry && hay > 0, note: zz ? '睡覺中' : !hungry ? `${fmt(COW_HUNGRY_MS - (now - d.fedAt))}後會餓` : hay < 1 ? '牧草不夠' : `牧草 ×${hay}` },
        { act: 'brush', emoji: '🪮', label: '刷毛', enabled: !zz && left > 0, note: zz ? '睡覺中' : left > 0 ? `今天還能刷 ${left} 次` : '今天刷夠了' },
        { act: 'milk', emoji: '🥛', label: '擠牛奶', enabled: !zz && ready, note: zz ? '睡覺中' : ready ? '可以擠了！' : d.milkReadyAt === null ? '先餵牧草' : `還要 ${fmt(d.milkReadyAt - now)}` },
      ],
    };
  }

  // ---- 照顧流程：牛先走到飼料槽前站好，主角再開始動作 ----
  prepare(act: CowAct): void {
    const c = this.pose(act).cow;
    this.cow.held = true;
    this.readyYaw = c.yaw;
    const p = this.cow.root.position;
    if (Math.hypot(p.x - c.x, p.z - c.z) > 0.2) this.cow.goTo(c.x, c.z, c.yaw);
    else this.cow.mover.yawGoal = c.yaw;
  }

  whenReady(cb: () => void): void {
    this.readyCb = cb;
    this.readyWait = 0;
  }

  release(): void { this.cow.held = false; }

  private cowPoint(local: THREE.Vector3): THREE.Vector3 {
    this.cow.root.updateMatrixWorld();
    return this.cow.root.localToWorld(local.clone());
  }

  doFeed(done: () => void): void {
    const g = this.game, d = this.d, now = g.state.now();
    if (!this.hungry(now)) { g.hud.toast(`${d.name}還飽飽的，${fmt(COW_HUNGRY_MS - (now - d.fedAt))}後會再餓`); return done(); }
    if ((g.state.data.inventory.hay ?? 0) < 1) { g.hud.toast('🌾 牧草不夠了：推除草機割草可以收集牧草'); return done(); }
    const c = g.world.cowCareSpot;
    g.player.mover.face(c.x + 0.3, c.z - 1.3);
    g.player.play('feed', () => {
      const t = g.state.now();
      g.state.addItem('hay', -1);
      d.fedAt = t;
      g.progression.track('cow');
      if (d.milkReadyAt === null) d.milkReadyAt = t + MILK_REGEN_MS;
      d.affection += 5;
      g.world.setTroughHay(true);
      const trough = new THREE.Vector3(c.x, 0.6, c.z - 1.15);
      g.particles.burst('hay', trough, 10, { speed: 1.2, up: 2, size: 0.6 });
      this.cow.play('eat', 3.4);
      for (let i = 0; i < 7; i++) window.setTimeout(() => sfx.munch(), 350 + i * 420);
      g.gainXp(3, trough.clone().setY(1.4), false);
      g.fx.float(this.cowPoint(new THREE.Vector3(0, 2, 0.3)), '+5 ♥', 'love', 0.3);
    }, done);
  }

  doBrush(done: () => void): void {
    const g = this.game, d = this.d, now = g.state.now();
    if (this.brushesLeft(now) <= 0) { g.hud.toast(`今天已經幫${d.name}刷過 ${COW_BRUSH_DAILY} 次毛了，明天再來吧`); return done(); }
    const pz = this.pose('brush');
    g.player.mover.face(pz.cow.x + 0.15, pz.cow.z);
    g.player.onBrushStroke = () => {
      sfx.brush();
      g.particles.burst('fluff', this.cowPoint(new THREE.Vector3(-0.42, 1.0, (Math.random() - 0.5) * 0.6)), 3, { speed: 0.6, up: 0.8, gravity: -0.2, size: 0.05, life: 1 });
    };
    this.cow.play('brushed', 1.9);
    g.player.play('brush', () => {
      const before = this.hearts();
      d.brushes++;
      d.affection += 10;
      g.progression.track('cow');
      g.gainXp(5, this.cowPoint(new THREE.Vector3(0, 1.9, 0)), false);
      window.setTimeout(() => {
        sfx.moo(true);
        g.particles.burst('heart', this.cowPoint(new THREE.Vector3(0, 1.6, 0.6)), 6, { speed: 1, up: 1.5, size: 0.35, life: 1.2 });
        g.fx.float(this.cowPoint(new THREE.Vector3(0, 2.1, 0.3)), '+10 ♥', 'love');
        if (this.hearts() > before) g.hud.toast(`💕 和${d.name}的感情變好了！（${this.hearts()} 顆心）`, 3000);
      }, 900);
    }, () => { g.player.onBrushStroke = undefined; done(); });
  }

  doMilk(done: () => void): void {
    const g = this.game, d = this.d, now = g.state.now();
    if (this.sleeping) { g.hud.toast(`${d.name}睡著了，明天早上再來擠奶吧`); return done(); }
    if (!this.milkReady(now)) {
      g.hud.toast(d.milkReadyAt === null ? `先餵${d.name}吃牧草，4 小時後就有牛奶了` : `🥛 還要 ${fmt(d.milkReadyAt - now)}才能擠奶`);
      return done();
    }
    // 坐上小板凳、面向牛的乳房
    const s = this.pose('milk').player;
    g.player.root.position.set(s.x, 0, s.z + 0.08);
    g.player.mover.yawGoal = s.yaw;
    g.player.root.rotation.y = s.yaw;
    this.props.visible = true;
    this.milkLevel = 0;
    this.setMilkLevel(0);
    g.particles.burst('fluff', new THREE.Vector3(s.x, 0.3, s.z - 0.3), 8, { speed: 1, up: 1, gravity: -0.3, size: 0.1, life: 0.6 });
    this.cow.play('milked', 3.6);
    const udder = this.cowPoint(this.cow.udderLocal);
    g.player.onSquirt = (alt) => {
      sfx.squirt(alt);
      const from = udder.clone().add(new THREE.Vector3(0, 0, alt ? 0.06 : -0.06));
      g.particles.burst('milk', from, 3, { speed: 0.35, up: 0.2, size: 0.045, life: 0.4, gravity: 7, dir: new THREE.Vector3(0, -0.6, 3.2) });
      this.milkLevel = Math.min(1, this.milkLevel + 1 / 13);
      this.setMilkLevel(this.milkLevel);
    };
    g.player.play('milk', () => {
      const h = this.hearts();
      const brushed = d.brushDay === dayKey(g.state.now()) && d.brushes > 0;
      const r = Math.random();
      const gold = 0.03 + h * 0.03 + (brushed ? 0.05 : 0);
      const good = 0.15 + h * 0.04 + (brushed ? 0.1 : 0);
      const q: Quality = r < gold ? 'gold' : r < gold + good ? 'good' : 'normal';
      g.state.addItem(q === 'normal' ? 'milk' : `milk:${q}`);
      d.milked++;
      g.progression.track('cow');
      g.progression.track('milk');
      g.progression.record(q === 'normal' ? 'milk' : `milk:${q}`);
      d.milkReadyAt = null;
      d.affection += 3;
      g.world.setTroughHay(false);
      const bucket = new THREE.Vector3(s.x, 0.5, s.z - 0.4);
      g.gainXp(MILK_XP, bucket.clone().setY(1.2), true);
      g.fx.fly(bucket, '🥛', g.hud.el('bag'));
      if (q !== 'normal') g.fx.float(bucket.clone().setY(1.6), `${QUALITY_LABEL[q]}牛奶！`, 'coin', 0.3);
      sfx.harvest();
      g.particles.burst('sparkle', bucket, q === 'gold' ? 10 : 4, { speed: 1, up: 1.5, size: 0.35 });
      window.setTimeout(() => {
        sfx.moo(true);
        this.cow.play('happy', 1.1);
        g.particles.burst('heart', this.cowPoint(new THREE.Vector3(0, 1.6, 0.6)), 4, { speed: 0.8, up: 1.4, size: 0.3, life: 1 });
      }, 250);
    }, () => {
      g.player.onSquirt = undefined;
      window.setTimeout(() => {
        this.props.visible = false;
        g.particles.burst('fluff', new THREE.Vector3(s.x, 0.3, s.z - 0.3), 8, { speed: 1, up: 1, gravity: -0.3, size: 0.1, life: 0.6 });
      }, 700);
      done();
    });
  }

  private setMilkLevel(f: number) {
    this.milkSurface.position.y = 0.03 + f * 0.24;
    this.milkSurface.visible = f > 0.01;
  }

  update(dt: number, now: number, night: boolean): void {
    const g = this.game;
    this.sleeping = night && !this.cow.held;
    const hungry = this.hungry(now);
    g.world.setTroughHay(!hungry && now - this.d.fedAt < 40 * 60000); // 餵完 40 分鐘內槽裡還有草
    this.cow.setBubble(this.sleeping ? '💤' : this.milkReady(now) ? '🥛' : hungry ? '🌾' : null);
    if (this.readyCb) {
      this.readyWait += dt;
      if (!this.cow.moving || this.readyWait > 5) {
        if (this.cow.moving) this.cow.mover.stop();
        this.cow.mover.yawGoal = this.readyYaw;
        this.cow.root.rotation.y = this.readyYaw;
        const cb = this.readyCb;
        this.readyCb = null;
        cb();
      }
    }
    // 牛的聲音依與主角的距離調整：3 公尺內最大聲，約 13 公尺外聽不到
    const vol = () => {
      const a = this.cow.root.position, b = g.player.root.position;
      return Math.pow(clamp(1 - (Math.hypot(a.x - b.x, a.z - b.z) - 3) / 10, 0, 1), 2);
    };
    this.cow.update(dt, {
      night,
      bounds: g.world.ranchBounds,
      sleepSpot: g.world.cowSleepSpot,
      hungry,
      onGraze: (x, z) => g.world.mowGrass(x, z, 0.35, now),
      onMoo: (happy) => sfx.moo(happy, vol()),
      onBell: () => sfx.bell(vol()),
    });
  }
}
