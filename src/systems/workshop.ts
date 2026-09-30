import { CROP_BY_ID } from '../data/crops';
import { RECIPES, RECIPE_BY_ID, WORKSHOP_LEVEL, workshopSlots, type Recipe } from '../data/recipes';
import type { Game } from '../game';
import { ITEM_INFO } from '../ui/hud';
import type { WorkSlot } from './state';

// 加工坊（docs/06 §7.2）：原料 → 成品，真實時間加工；橘貓被動加工時間 −10%
const QUALITIES = ['', ':good', ':gold'];

export class Workshop {
  constructor(private game: Game) {}

  get slots(): WorkSlot[] { return this.game.state.data.workshop; }
  get capacity(): number { return workshopSlots(this.game.state.data.level); }
  get unlocked(): boolean { return this.game.state.data.level >= WORKSHOP_LEVEL; }

  have(key: string): number {
    const inv = this.game.state.data.inventory;
    return QUALITIES.reduce((s, q) => s + (inv[key + q] ?? 0), 0);
  }

  itemLabel(key: string): { emoji: string; name: string } {
    const c = CROP_BY_ID[key];
    if (c) return { emoji: c.emoji, name: c.name };
    const it = ITEM_INFO[key];
    return { emoji: it?.emoji ?? '📦', name: it?.name ?? key };
  }

  canStart(r: Recipe): string | null {
    if (this.game.state.data.level < r.unlock) return `Lv${r.unlock}`;
    if (this.slots.length >= this.capacity) return '欄位滿了';
    for (const it of r.inputs) if (this.have(it.key) < it.n) return '材料不足';
    return null;
  }

  durationMs(r: Recipe): number {
    return r.minutes * 60000 * (this.game.state.data.pet.species === 'cat' ? 0.9 : 1);
  }

  start(id: string, now: number): boolean {
    const r = RECIPE_BY_ID[id];
    if (!r || this.canStart(r)) return false;
    const st = this.game.state;
    for (const it of r.inputs) {
      let need = it.n;
      for (const q of QUALITIES) {
        const k = it.key + q;
        const take = Math.min(need, st.data.inventory[k] ?? 0);
        if (take) { st.addItem(k, -take); need -= take; }
      }
    }
    this.slots.push({ recipe: id, doneAt: now + this.durationMs(r) });
    return true;
  }

  collect(now: number): Recipe[] {
    const done = this.slots.filter((s) => s.doneAt <= now);
    this.game.state.data.workshop = this.slots.filter((s) => s.doneAt > now);
    return done.map((s) => RECIPE_BY_ID[s.recipe]).filter(Boolean);
  }

  get anyReady(): boolean { const now = this.game.state.now(); return this.slots.some((s) => s.doneAt <= now); }
  get busy(): boolean { const now = this.game.state.now(); return this.slots.some((s) => s.doneAt > now); }

  // 面板用的資料
  view(now: number) {
    return {
      capacity: this.capacity,
      slots: this.slots.map((s) => {
        const r = RECIPE_BY_ID[s.recipe];
        const total = this.durationMs(r);
        return { emoji: r.emoji, name: r.name, left: Math.max(0, s.doneAt - now), prog: Math.min(1, 1 - (s.doneAt - now) / total) };
      }),
      recipes: RECIPES.map((r) => ({
        id: r.id, emoji: r.emoji, name: r.name, sell: r.sell, minutes: Math.round(this.durationMs(r) / 60000),
        inputs: r.inputs.map((it) => ({ ...this.itemLabel(it.key), have: this.have(it.key), need: it.n })),
        block: this.canStart(r), unlock: r.unlock,
      })),
    };
  }
}
