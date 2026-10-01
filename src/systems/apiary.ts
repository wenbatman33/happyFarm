import * as THREE from 'three';
import { sfx } from '../core/audio';
import { HIVE } from '../data/economy';
import type { Game } from '../game';
import type { MenuView } from '../ui/hud';
import { FIELD_COUNT } from './farm';

// 蜂箱（第 9 章，養蜂人）：最多 3 個，每 6 小時產蜂蜜；田裡盛開的花越多，蜂蜜越多（花田加成）；冬天蜜蜂休息
const FLOWERY = new Set(['flower', 'tall', 'bush']); // 會開花、蜜蜂愛去的作物造型
const fmtMs = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };

export class Apiary {
  constructor(private game: Game) {}

  get unlocked(): boolean { return this.game.calendar.chapterOpen(9, this.game.state.now()); }
  get hives() { return this.game.state.data.hives; }

  anchor(slot: number): THREE.Vector3 {
    const p = this.game.sceneLayout.beehives[slot];
    return new THREE.Vector3(p.x, 1.6, p.z);
  }

  // 田裡正在盛開（成熟）的花：每 3 株多 1 罐，最多 +3
  flowerBonus(now: number): number {
    const f = this.game.farm;
    let n = 0;
    for (let i = 0; i < FIELD_COUNT; i++) {
      const c = f.def(i);
      if (c && FLOWERY.has(c.shape.kind) && f.status(i, now) === 'mature') n++;
    }
    return Math.min(HIVE.maxBonus, Math.floor(n / 3));
  }

  // 冬天蜜蜂休息，那段時間不算
  private resting(): boolean { return this.game.season === 'winter'; }

  ready(slot: number, now: number): boolean {
    const h = this.hives.find((x) => x.slot === slot);
    return !!h && !this.resting() && now - h.at >= HIVE.ms;
  }

  menu(slot: number, now: number): MenuView {
    const d = this.game.state.data;
    const h = this.hives.find((x) => x.slot === slot);
    if (!this.unlocked) return { title: '🐝 蜂箱位置', sub: '養蜂人來信之後開放（第 9 章）', items: [] };
    if (!h) {
      const lack = d.coins < HIVE.coins || (d.inventory.wood ?? 0) < HIVE.wood;
      return { title: '🐝 空的蜂箱位置', sub: '放一個蜂箱，蜜蜂會去採田裡的花', items: [{ act: 'build', emoji: '🔨', label: '放蜂箱', enabled: !lack, note: `🪙${HIVE.coins.toLocaleString()} 🪵${HIVE.wood}` }] };
    }
    const bonus = this.flowerBonus(now);
    const rdy = this.ready(slot, now);
    const sub = this.resting() ? '冬天蜜蜂在蜂箱裡取暖，春天再開工' : rdy ? `蜂蜜滿了！（花田加成 +${bonus}）` : `還要 ${fmtMs(h.at + HIVE.ms - now)} · 田裡盛開的花：加成 +${bonus}`;
    return { title: '🐝 蜂箱', sub, items: [{ act: 'collect', emoji: '🍯', label: '收蜂蜜', enabled: rdy, note: rdy ? `×${HIVE.base + bonus}` : '還沒好' }] };
  }

  onAct(slot: number, act: string): void {
    const g = this.game;
    const d = g.state.data;
    const p = g.sceneLayout.beehives[slot];
    if (act === 'build') {
      if (this.hives.some((x) => x.slot === slot) || d.coins < HIVE.coins || (d.inventory.wood ?? 0) < HIVE.wood) return;
      g.enqueue({ kind: 'move', x: p.x, z: p.z + 1.1 });
      d.coins -= HIVE.coins;
      g.state.addItem('wood', -HIVE.wood);
      this.hives.push({ slot, at: g.state.now() });
      this.sync();
      sfx.hammer(1);
      g.hud.toast('🐝 蜂箱放好了！6 小時後就能收蜂蜜；田裡種花，蜜蜂會更勤勞', 3400);
      g.state.save();
    } else if (act === 'collect') {
      const now = g.state.now();
      const h = this.hives.find((x) => x.slot === slot);
      if (!h || !this.ready(slot, now)) return;
      g.enqueue({ kind: 'move', x: p.x, z: p.z + 1.1 });
      const n = HIVE.base + this.flowerBonus(now);
      h.at = now;
      g.state.addItem('honey', n);
      g.progression.record('honey');
      const at = new THREE.Vector3(p.x, 1, p.z);
      sfx.harvest();
      g.particles.burst('sparkle', at, 10, { speed: 1.4, up: 2, size: 0.35 });
      g.fx.float(at.clone().setY(1.6), `+${n} 🍯 蜂蜜`, 'item');
      g.fx.fly(at, '🍯', g.hud.el('bag'));
      g.gainXp(n * 12, at, false);
      g.state.save();
    }
  }

  sync(): void {
    const on = this.unlocked;
    this.game.world.setBeehives(this.game.sceneLayout.beehives.map((_, i) => (!on ? 'none' : this.hives.some((h) => h.slot === i) ? 'hive' : 'empty')));
  }

  update(now: number): void {
    const w = this.game.world;
    w.beehiveReady = this.game.sceneLayout.beehives.map((_, i) => this.ready(i, now));
  }
}
