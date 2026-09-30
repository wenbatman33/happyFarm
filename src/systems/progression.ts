import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { ALMANAC } from '../data/almanac';
import type { Game } from '../game';
import { ITEM_INFO } from '../ui/hud';
import {
  ACHIEVEMENTS, DAILY_ALL_BONUS, DAILY_POOL, DAILY_STARS, TIER_STARS, TIERS, WEEKLY_POOL, WEEKLY_STARS,
  pickTasks, seasonKey, taskDef, tierReward, weekKey, type Ev, type ProgSave,
} from './progress';

// 長線進度管理：任務計數、換日換週換季、領獎、圖鑑、成就
export class Progression {
  private achT = 0;
  onChange?: () => void;

  constructor(private game: Game) {}

  get p(): ProgSave { return this.game.state.data.prog; }

  refresh(now: number): void {
    const p = this.p, d = this.game.state.data;
    const day = dayKey(now);
    if (p.day !== day) { p.day = day; p.daily = pickTasks(DAILY_POOL, 3, 'daily' + day, d); p.dailyBonus = false; }
    const wk = weekKey(now);
    if (p.week !== wk) { p.week = wk; p.weekly = pickTasks(WEEKLY_POOL, 7, 'weekly' + wk, d); }
    const sk = seasonKey(now, this.game.season);
    if (p.season !== sk) {
      if (p.season) this.game.hud.toast('📔 新的季節手帳開始了！季節星重新累積', 3200);
      p.season = sk; p.stars = 0; p.tiers = [];
    }
  }

  // 任務與成就的計數（遊戲各處呼叫）
  track(ev: Ev, n = 1): void {
    const p = this.p;
    p.life[ev] = (p.life[ev] ?? 0) + n;
    for (const t of [...p.daily, ...p.weekly]) {
      const def = taskDef(t.id);
      if (def?.ev === ev && t.got < def.n) {
        t.got = Math.min(def.n, t.got + n);
        if (t.got >= def.n) { sfx.sparkle(); this.game.hud.toast(`📋 任務完成：${def.label}（到手帳領取季節星）`, 2600); }
      }
    }
    this.achT = 0.5;
    this.game.festival?.onEv(ev, n);
  }

  // 圖鑑紀錄：key 可帶品質（例如 carrot:gold）
  record(key: string): void {
    const [id, q] = key.split(':');
    this.game.festival?.onItem(id);
    if (!ALMANAC.some((e) => e.id === id)) return;
    const a = this.p.almanac;
    const isNew = !a[id];
    const bit = q === 'gold' ? 4 : q === 'good' ? 2 : 1;
    a[id] = { n: (a[id]?.n ?? 0) + 1, q: (a[id]?.q ?? 0) | bit };
    if (isNew) {
      const e = ALMANAC.find((x) => x.id === id)!;
      this.game.hud.toast(`📖 圖鑑新增：${e.emoji} ${e.name}`, 2400);
      this.achT = 0.5;
    }
  }

  claimTask(id: string): void {
    const p = this.p;
    const t = [...p.daily, ...p.weekly].find((x) => x.id === id);
    const def = taskDef(id);
    if (!t || !def || t.claimed || t.got < def.n) return;
    t.claimed = true;
    const weekly = p.weekly.includes(t);
    p.stars += weekly ? WEEKLY_STARS : DAILY_STARS;
    this.game.state.data.coins += weekly ? 200 : 50;
    sfx.coin();
    if (!weekly && !p.dailyBonus && p.daily.every((x) => x.claimed)) {
      p.dailyBonus = true;
      p.stars += DAILY_ALL_BONUS;
      this.game.hud.toast(`⭐ 今天的任務全部完成！額外 +${DAILY_ALL_BONUS} 季節星`, 3000);
    }
    this.onChange?.();
  }

  claimTier(i: number): void {
    const p = this.p, g = this.game;
    if (p.tiers.includes(i) || p.stars < i * TIER_STARS) return;
    p.tiers.push(i);
    const r = tierReward(i, g.season);
    if (r.coins) g.state.data.coins += r.coins;
    if (r.item) g.state.addItem(r.item, r.n ?? 1);
    if (r.decor && !p.decor.includes(r.decor)) { p.decor.push(r.decor); g.world.setDecor(p.decor, g.season); }
    sfx.levelUp();
    g.hud.toast(`📔 季節手帳第 ${i} 階：${r.emoji} ${r.label}`, 2800);
    this.onChange?.();
  }

  get claimable(): number {
    const p = this.p;
    const tasks = [...p.daily, ...p.weekly].filter((t) => !t.claimed && t.got >= (taskDef(t.id)?.n ?? Infinity)).length;
    let tiers = 0;
    for (let i = 1; i <= TIERS; i++) if (!p.tiers.includes(i) && p.stars >= i * TIER_STARS) tiers++;
    return tasks + tiers;
  }

  update(dt: number): void {
    if (this.achT <= 0) return;
    this.achT -= dt;
    if (this.achT > 0) return;
    const d = this.game.state.data, p = this.p;
    for (const a of ACHIEVEMENTS) {
      if (p.ach.includes(a.id) || a.check(d) < a.n) continue;
      p.ach.push(a.id);
      d.coins += a.coins;
      p.title = a.name;
      sfx.fanfare();
      this.game.hud.toast(`🏆 成就解鎖：${a.name}（+${a.coins} 🪙）`, 3200);
      this.onChange?.();
      break; // 一次一個，避免洗版
    }
    if (ACHIEVEMENTS.some((a) => !p.ach.includes(a.id) && a.check(d) >= a.n)) this.achT = 3.5;
  }

  // 定期檢查（等級、親密度這類不是事件觸發的成就）
  poke(): void { if (this.achT <= 0) this.achT = 0.5; }

  itemName(key: string): string { return ITEM_INFO[key]?.name ?? key; }
}
