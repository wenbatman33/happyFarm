import * as THREE from 'three';
import { sfx } from '../core/audio';
import { POND } from '../data/economy';
import type { Game } from '../game';
import type { MenuView } from '../ui/hud';
import type { Pet } from '../actors/pet';
import { POND_Y } from './farm';

// 池塘（docs/03 §1，Lv30）：挖好後可以種水生作物（蓮花、西洋菜），小鴨會下水游泳
const fmtMs = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };
const RX = 1.75, RZ = 1.3; // 游泳路線（比水面小一圈）

interface Swim { pet: Pet; t: number; dur: number; phase: number; dir: number; rippleT: number; done: () => void }

export class Pond {
  private hammerT = 0;
  private swimT = 40;
  private swims: Swim[] = [];

  constructor(private game: Game) {}

  get level(): number { return this.game.state.data.pond.level; }
  get center(): { x: number; z: number } { const p = this.game.sceneLayout.pond; return { x: p.x, z: p.z }; }

  anchor(): THREE.Vector3 { const c = this.center; return new THREE.Vector3(c.x, 1.6, c.z + 1.6); }

  menu(now: number): MenuView {
    const d = this.game.state.data;
    const p = d.pond;
    const items: MenuView['items'] = [];
    let sub: string;
    if (p.buildUntil) sub = `⛏️ 挖池塘中，還要 ${fmtMs(p.buildUntil - now)}`;
    else if (p.level === 0) sub = '挖好之後可以種蓮花、西洋菜，小鴨也會來游泳';
    else sub = '靠近池塘，工具列會出現水生作物的種子';
    if (p.level === 0 && !p.buildUntil) {
      const lack: string[] = [];
      if (d.level < POND.level) lack.push(`Lv${POND.level} 解鎖`);
      else {
        if (d.coins < POND.coins) lack.push(`🪙${d.coins.toLocaleString()}/${POND.coins.toLocaleString()}`);
        if ((d.inventory.stone ?? 0) < POND.stone) lack.push(`🪨${d.inventory.stone ?? 0}/${POND.stone}`);
      }
      items.push({ act: 'build', emoji: '⛏️', label: '挖池塘', enabled: !lack.length, note: lack.length ? lack.join(' ') : `🪙${POND.coins.toLocaleString()} 🪨${POND.stone}` });
    }
    if (p.level > 0) items.push({ act: 'go', emoji: '🪷', label: '走到池邊', enabled: true, note: '種水生作物' });
    return { title: '💧 池塘', sub, items };
  }

  async onAct(act: string): Promise<void> {
    const g = this.game;
    const d = g.state.data;
    if (act === 'go') { const c = this.center; g.enqueue({ kind: 'move', x: c.x, z: c.z + 2.6 }); return; }
    if (act !== 'build') return;
    const ok = await g.hud.confirm('⛏️ 挖池塘', `花費 🪙${POND.coins.toLocaleString()} ＋ 🪨 石材 ×${POND.stone}<br>木匠老木大約 ${POND.ms / 3600000} 小時挖好，池塘有 6 個水生作物的位置。`, '開始挖');
    if (!ok || d.pond.buildUntil || d.pond.level || d.coins < POND.coins || (d.inventory.stone ?? 0) < POND.stone) return;
    d.coins -= POND.coins;
    g.state.addItem('stone', -POND.stone);
    d.pond.buildUntil = g.state.now() + POND.ms;
    g.world.setPond(0, true);
    g.world.rebuildGrid();
    sfx.dig();
    g.hud.toast(`⛏️ 開始挖池塘了！大約 ${POND.ms / 3600000} 小時後完成`, 3000);
    g.state.save();
  }

  // 池塘範圍內的雜草、石頭、樹樁清掉（預定地期間可能長在那裡，挖好後不能留在水裡）
  clearWater(): number {
    const g = this.game;
    const c = this.center;
    const inside = (x: number, z: number) => Math.hypot((x - c.x) / 2.9, (z - c.z) / 2.3) < 1;
    let n = 0;
    for (const w of [...g.weeds.list]) if (inside(w.tx + w.ox, w.tz + w.oz)) { g.weeds.remove(w.id); n++; }
    for (const db of [...g.debris.list]) if (inside(db.x, db.z)) { g.debris.remove(db.id); n++; }
    if (n) g.world.rebuildGrid();
    return n;
  }

  // 小鴨（或在家的其他小鴨）下水游一圈
  private startSwim(pet: Pet) {
    const c = this.center;
    const p = pet.root.position;
    const phase = Math.atan2((p.z - c.z) / RZ, (p.x - c.x) / RX);
    const edge = { x: c.x + Math.cos(phase) * (RX + 1.2), z: c.z + Math.sin(phase) * (RZ + 1.2) };
    pet.doTask(edge.x, edge.z, 'happy', 0.4, () => {
      this.swims.push({ pet, t: 0, dur: 9 + Math.random() * 5, phase, dir: Math.random() < 0.5 ? 1 : -1, rippleT: 0, done: () => {} });
      pet.state = 'task';
    });
  }

  update(dt: number, now: number): void {
    const g = this.game;
    const d = g.state.data;
    const c = this.center;
    // 施工
    if (d.pond.buildUntil) {
      if (now >= d.pond.buildUntil) {
        d.pond.buildUntil = null;
        d.pond.level = 1;
        g.farm.grantPond(now);
        this.clearWater();
        g.world.setPond(1, false);
        g.world.rebuildGrid();
        const at = new THREE.Vector3(c.x, 0.6, c.z);
        g.particles.burst('water', at, 30, { speed: 3, up: 4, size: 0.1 });
        g.particles.burst('sparkle', at, 20, { speed: 2.5, up: 3, size: 0.45, life: 1.3 });
        sfx.fanfare();
        g.hud.toast('💧 池塘挖好了！靠近池塘，工具列會出現蓮花、西洋菜的種子', 4000);
        g.state.save();
      } else {
        this.hammerT -= dt;
        if (this.hammerT <= 0) {
          this.hammerT = 0.6 + Math.random() * 0.6;
          const p = g.player.root.position;
          sfx.at(Math.pow(Math.max(0, 1 - (Math.hypot(p.x - c.x, p.z - c.z) - 4) / 14), 2), () => sfx.dig());
        }
      }
      return;
    }
    if (d.pond.level < 1) return;
    // 小鴨偶爾下水（白天、沒在做別的事）
    this.swimT -= dt;
    if (this.swimT <= 0) {
      this.swimT = 35 + Math.random() * 40;
      const ducks = [g.pet, ...g.petHouse.homePets].filter((p) => p.species === 'duck' && p.state !== 'sleep' && !p.busy && !this.swims.some((s) => s.pet === p));
      const near = ducks.find((p) => Math.hypot(p.root.position.x - c.x, p.root.position.z - c.z) < 9);
      if (near && !g.interior.active && !g.social.visiting) this.startSwim(near);
    }
    // 游泳中：沿著橢圓繞圈，身體沉進水裡一點，拖出漣漪
    for (const s of [...this.swims]) {
      s.t += dt;
      const p = s.pet.root;
      if (s.t >= s.dur) {
        this.swims.splice(this.swims.indexOf(s), 1);
        p.position.y = 0;
        const out = { x: c.x + Math.cos(s.phase) * (RX + 1.3), z: c.z + Math.sin(s.phase) * (RZ + 1.3) };
        p.position.x = out.x;
        p.position.z = out.z;
        s.pet.state = 'idle';
        g.world.pondRipple(out.x, out.z);
        continue;
      }
      const enter = Math.min(1, s.t / 0.8);
      s.phase += s.dir * dt * 0.45;
      const tx = c.x + Math.cos(s.phase) * RX, tz = c.z + Math.sin(s.phase) * RZ;
      p.position.x += (tx - p.position.x) * Math.min(1, dt * 3);
      p.position.z += (tz - p.position.z) * Math.min(1, dt * 3);
      p.position.y = (POND_Y - 0.16) * enter + Math.sin(s.t * 3) * 0.015;
      p.rotation.y = Math.atan2(-Math.sin(s.phase) * s.dir * RX, Math.cos(s.phase) * s.dir * RZ);
      s.pet.mover.yawGoal = p.rotation.y;
      s.rippleT -= dt;
      if (s.rippleT <= 0) { s.rippleT = 0.7; g.world.pondRipple(p.position.x, p.position.z); }
    }
  }

  // 寵物正在游泳（主程式要避免其他動作打斷）
  swimming(pet: Pet): boolean { return this.swims.some((s) => s.pet === pet); }
}
