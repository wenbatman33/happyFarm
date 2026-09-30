import { hashStr, mulberry32 } from '../core/rng';
import { CROPS, CROP_BY_ID } from '../data/crops';
import { MILK_SELL, MILK_XP } from '../data/economy';
import type { Game } from '../game';
import { ITEM_INFO, type OrderCard } from '../ui/hud';
import type { OrderSave } from './state';

// 訂單板（docs/06 §7.1）：早晚 6 點刷新，Lv30 起 6 張
export const ORDER_SKIP_MS = 2 * 3600000;

export function orderSlot(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  if (h < 6) { const p = new Date(t - 86400000); return `${p.getFullYear()}-${p.getMonth() + 1}-${p.getDate()}-pm`; }
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${h < 18 ? 'am' : 'pm'}`;
}

const QUALITIES = ['', ':good', ':gold'];

export class Orders {
  constructor(private game: Game) {}

  get d() { return this.game.state.data.orders; }

  private info(key: string): { emoji: string; name: string; sell: number; xp: number } {
    const c = CROP_BY_ID[key];
    if (c) return { emoji: c.emoji, name: c.name, sell: c.sell, xp: c.xp };
    const it = ITEM_INFO[key];
    return { emoji: it?.emoji ?? '📦', name: it?.name ?? key, sell: key === 'milk' ? MILK_SELL : it?.price ?? 1, xp: key === 'milk' ? MILK_XP : 5 };
  }

  // 一張隨機訂單：只要已解鎖、當季可種的作物（有擠過牛奶就可能要牛奶）
  private make(rand: () => number): OrderSave {
    const g = this.game, d = g.state.data;
    const pool: { key: string; minutes: number }[] = CROPS
      .filter((c) => d.level >= c.unlock && (c.season === 'all' || c.season === g.season))
      .map((c) => ({ key: c.id, minutes: c.minutes }));
    if (d.cows[0]?.milked > 0) pool.push({ key: 'milk', minutes: 240 });
    const kinds = Math.min(pool.length, rand() < 0.6 ? 1 : rand() < 0.9 ? 2 : 3);
    const picks = [...pool].sort(() => rand() - 0.5).slice(0, kinds);
    const items = picks.map((p) => {
      const base = p.key === 'milk' ? 1 : Math.round(7 / Math.sqrt(Math.max(1, p.minutes) / 5));
      return { key: p.key, n: Math.max(1, Math.min(6, base + Math.floor(rand() * 3) - 1)) };
    });
    return this.priced(items, `o${++this.d.seq}`);
  }

  private priced(items: { key: string; n: number }[], id: string): OrderSave {
    let coins = 0, xp = 0;
    for (const it of items) { const f = this.info(it.key); coins += f.sell * it.n; xp += f.xp * it.n; }
    return { id, items, coins: Math.round(coins * 1.4), xp: Math.round(xp * 1.5), done: false };
  }

  // 刷新：到了新的時段就換一批（新手引導中的第一批固定是蘿蔔 ×1）
  refresh(now: number): boolean {
    const slot = orderSlot(now);
    if (this.d.slot === slot) return false;
    const rand = mulberry32(hashStr('orders' + slot + this.d.seq));
    const n = this.game.state.data.level >= 30 ? 6 : 3;
    const list: OrderSave[] = [];
    for (let i = 0; i < n; i++) list.push(this.make(rand));
    if (this.game.state.data.tutorial >= 0 && this.game.state.data.stats.ordersDone === 0) list[0] = this.priced([{ key: 'radish', n: 1 }], `o${++this.d.seq}`);
    this.d.slot = slot;
    this.d.list = list;
    this.d.seen = false;
    return true;
  }

  have(key: string): number {
    const inv = this.game.state.data.inventory;
    return QUALITIES.reduce((s, q) => s + (inv[key + q] ?? 0), 0);
  }

  canDeliver(o: OrderSave): boolean { return !o.done && o.items.every((it) => this.have(it.key) >= it.n); }
  get deliverable(): boolean { return this.d.list.some((o) => this.canDeliver(o)); }

  deliver(id: string): OrderSave | null {
    const o = this.d.list.find((x) => x.id === id);
    if (!o || !this.canDeliver(o)) return null;
    const st = this.game.state;
    for (const it of o.items) {
      let need = it.n;
      for (const q of QUALITIES) { // 先交普通的，好品質留著
        const k = it.key + q;
        const take = Math.min(need, st.data.inventory[k] ?? 0);
        if (take) { st.addItem(k, -take); need -= take; }
      }
    }
    o.done = true;
    st.data.coins += o.coins;
    st.data.stats.ordersDone++;
    return o;
  }

  skip(id: string, now: number): string | null {
    if (now < this.d.skipAt) {
      const m = Math.ceil((this.d.skipAt - now) / 60000);
      return `換訂單冷卻中，還要 ${m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`}`;
    }
    const i = this.d.list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    this.d.list[i] = this.make(mulberry32(hashStr('skip' + now)));
    this.d.skipAt = now + ORDER_SKIP_MS;
    return null;
  }

  nextRefreshText(now: number): string {
    const h = new Date(now).getHours();
    return h >= 6 && h < 18 ? '下次刷新 18:00' : '下次刷新 06:00';
  }

  cards(): OrderCard[] {
    return this.d.list.map((o) => ({
      id: o.id,
      items: o.items.map((it) => { const f = this.info(it.key); return { emoji: f.emoji, name: f.name, have: this.have(it.key), need: it.n }; }),
      coins: o.coins,
      xp: o.xp,
      canDeliver: this.canDeliver(o),
      done: o.done,
    }));
  }
}
