import * as THREE from 'three';
import { sfx } from '../core/audio';
import { GREENHOUSE, GREENHOUSE_GROWTH } from '../data/economy';
import type { Game } from '../game';
import type { MenuView } from '../ui/hud';
import { ghPlotsFor } from './farm';

// 溫室（docs/03 §1，Lv40）：任何季節都能種任何作物，成長時間 ×1.5，自動灑水；分三期擴建
const fmtMs = (ms: number) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };

export class Greenhouse {
  private hammerT = 0;
  constructor(private game: Game) {}

  get level(): number { return this.game.state.data.greenhouse.level; }

  anchor(): THREE.Vector3 {
    const L = this.game.sceneLayout.greenhouse;
    return new THREE.Vector3(L.x, 3.2, L.z + 2.4);
  }

  menu(now: number): MenuView {
    const d = this.game.state.data;
    const gh = d.greenhouse;
    const next = GREENHOUSE[gh.level];
    const items: MenuView['items'] = [];
    let sub: string;
    if (gh.buildUntil) sub = `🔨 施工中，還要 ${fmtMs(gh.buildUntil - now)}`;
    else if (gh.level === 0) sub = `任何季節都能種任何作物（成長 ×${GREENHOUSE_GROWTH}），還會自動灑水`;
    else sub = `第 ${gh.level} 期 · ${ghPlotsFor(gh.level)} 塊溫室田 · 走進去工具列會出現全季種子`;
    if (next && !gh.buildUntil) {
      const lack: string[] = [];
      if (d.level < next.level) lack.push(`Lv${next.level} 解鎖`);
      else {
        if (d.coins < next.coins) lack.push(`🪙${d.coins.toLocaleString()}/${next.coins.toLocaleString()}`);
        if ((d.inventory.wood ?? 0) < next.wood) lack.push(`🪵${d.inventory.wood ?? 0}/${next.wood}`);
        if ((d.inventory.stone ?? 0) < next.stone) lack.push(`🪨${d.inventory.stone ?? 0}/${next.stone}`);
      }
      items.push({ act: 'build', emoji: '🔨', label: gh.level === 0 ? '蓋溫室' : `擴建到 ${next.plots} 塊田`, enabled: !lack.length, note: lack.length ? lack.join(' ') : `🪙${next.coins.toLocaleString()} 🪵${next.wood} 🪨${next.stone}` });
    }
    if (gh.level > 0) items.push({ act: 'enter', emoji: '🚪', label: '走進溫室', enabled: true, note: '全季種子都能種' });
    return { title: '🌱 溫室', sub, items };
  }

  onAct(act: string): void {
    if (act === 'build') void this.start();
    else if (act === 'enter') {
      const L = this.game.sceneLayout.greenhouse;
      this.game.enqueue({ kind: 'move', x: L.x, z: L.z + 0.4 });
    }
  }

  private async start() {
    const g = this.game;
    const d = g.state.data;
    const next = GREENHOUSE[d.greenhouse.level];
    if (!next) return;
    const ok = await g.hud.confirm(`🌱 ${d.greenhouse.level ? '擴建溫室' : '蓋溫室'}`, `花費 🪙${next.coins.toLocaleString()} ＋ 🪵 木材 ×${next.wood} ＋ 🪨 石材 ×${next.stone}<br>木匠老木大約 ${next.ms / 3600000} 小時完工，完工後有 ${next.plots} 塊溫室田（土已經翻好）。`, '開始施工');
    if (!ok || d.greenhouse.buildUntil || d.coins < next.coins || (d.inventory.wood ?? 0) < next.wood || (d.inventory.stone ?? 0) < next.stone) return;
    d.coins -= next.coins;
    g.state.addItem('wood', -next.wood);
    g.state.addItem('stone', -next.stone);
    d.greenhouse.buildUntil = g.state.now() + next.ms;
    g.world.setGreenhouse(d.greenhouse.level, true);
    g.world.rebuildGrid();
    sfx.coin();
    g.hud.toast(`🔨 溫室開工了！大約 ${next.ms / 3600000} 小時後完工`, 3000);
    g.state.save();
  }

  update(dt: number, now: number): void {
    const g = this.game;
    const gh = g.state.data.greenhouse;
    if (!gh.buildUntil) return;
    const L = g.sceneLayout.greenhouse;
    if (now >= gh.buildUntil) {
      gh.buildUntil = null;
      gh.level = Math.min(GREENHOUSE.length, gh.level + 1);
      g.farm.grantGreenhouse(gh.level, now);
      g.world.setGreenhouse(gh.level, false);
      g.world.rebuildGrid();
      const at = new THREE.Vector3(L.x, 2, L.z);
      g.particles.burst('sparkle', at, 26, { speed: 3, up: 3.5, size: 0.5, life: 1.4 });
      g.particles.burst('fluff', at, 20, { speed: 3, up: 2.5, gravity: -0.3, size: 0.25, life: 1.1 });
      sfx.fanfare();
      g.hud.toast(gh.level === 1 ? '🌱 溫室完工！走進去，工具列會出現所有季節的種子' : `🌱 溫室擴建完成！現在有 ${ghPlotsFor(gh.level)} 塊溫室田`, 4000);
      g.state.save();
      return;
    }
    this.hammerT -= dt;
    if (this.hammerT <= 0) {
      this.hammerT = 0.35 + Math.random() * 0.5;
      const p = g.player.root.position;
      sfx.hammer(Math.pow(Math.max(0, 1 - (Math.hypot(p.x - L.x, p.z - L.z) - 4) / 14), 2));
    }
  }
}
