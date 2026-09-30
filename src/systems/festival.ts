import * as THREE from 'three';
import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { hashStr, mulberry32 } from '../core/rng';
import { CROP_BY_ID } from '../data/crops';
import { RECIPE_BY_ID } from '../data/recipes';
import { FESTIVALS, RED_ENVELOPE, TOKEN_TO_COINS, festivalAt, nextFestival, type FestivalId, type FestivalWindow } from '../data/festivals';
import { FURN_BY_ID } from '../data/furniture';
import { Sheet, row } from '../ui/sheet';
import { ITEM_INFO } from '../ui/hud';
import type { Game } from '../game';
import type { Ev } from './progress';

// 節慶（docs/05 §5.2）：依現實日期自動開始；節慶代幣換限定品，結束後剩下的代幣換成金幣
// 春節特別版：寵物每天送紅包、年菜訂單、門上貼春聯、夜空放煙火

export const PET_HATS: Record<string, { name: string; emoji: string }> = {
  pethat_party: { name: '派對帽', emoji: '🥳' },
  pethat_fortune: { name: '財神帽', emoji: '🧧' },
  pethat_flower: { name: '花圈', emoji: '💐' },
  pethat_sachet: { name: '端午香包', emoji: '🎐' },
  pethat_pomelo: { name: '柚子帽', emoji: '🍈' },
  pethat_witch: { name: '小巫師帽', emoji: '🧙' },
  pethat_santa: { name: '聖誕帽', emoji: '🎅' },
};
for (const [k, v] of Object.entries(PET_HATS)) ITEM_INFO[k] = { name: `寵物${v.name}`, emoji: v.emoji, price: 0 };
ITEM_INFO.token = { name: '節慶代幣', emoji: '🏵️', price: 0 };

interface TaskGen { key: string; ev?: Ev; item?: string; n: number; label: string }

export class Festival {
  sheet = new Sheet('fest-panel', '🎉 節慶');
  override: FestivalId | null = null; // DEV：強制節慶
  cur: FestivalWindow | null = null;
  private fwT = 3;
  private banner: HTMLElement;

  constructor(private game: Game) {
    this.sheet.onAction = (a) => this.act(a);
    this.banner = document.createElement('button');
    this.banner.className = 'fest-banner hidden';
    this.banner.onclick = () => this.open();
    game.hud.el('event').appendChild(this.banner);
  }

  get def() { return this.cur ? FESTIVALS[this.cur.id] : null; }

  // 每秒檢查：節慶開始／結束
  tick(now: number): void {
    const d = this.game.state.data;
    const f = this.override ? { id: this.override, start: now - 86400000, end: now + 5 * 86400000, key: `${this.override}dev` } : festivalAt(now);
    const key = f?.key ?? '';
    if (key !== (this.cur?.key ?? '')) {
      this.cur = f;
      this.game.world.setFestival(f?.id ?? null);
    }
    const fe = d.festival;
    if (fe.key !== key) {
      // 上一個節慶結束：代幣換金幣
      if (fe.key && fe.tokens > 0) {
        const c = fe.tokens * TOKEN_TO_COINS;
        d.coins += c;
        window.setTimeout(() => this.game.hud.toast(`🏵️ 節慶結束了，剩下的 ${fe.tokens} 枚代幣換成 🪙${c}`, 3600), 1200);
      }
      d.festival = { key, tokens: 0, envelopeDay: '', taskDay: '', tasks: [], bought: [] };
      if (f) window.setTimeout(() => { sfx.cheer(); this.game.hud.toast(`${FESTIVALS[f.id].emoji} ${FESTIVALS[f.id].name}開始了！${FESTIVALS[f.id].blurb}（點上方橫幅看活動）`, 4200); }, 2200);
    }
    if (f) this.refreshTasks(now);
    this.renderBanner(now);
    if (this.sheet.open) this.render();
  }

  // 每天 3 個節慶任務
  private refreshTasks(now: number) {
    const d = this.game.state.data;
    const fe = d.festival;
    const day = dayKey(now);
    if (fe.taskDay === day) return;
    fe.taskDay = day;
    const rand = mulberry32(hashStr(fe.key + day));
    const wants = this.wanted();
    const pool: TaskGen[] = [
      { key: 'weed', ev: 'weed', n: 12, label: '拔掉 12 株雜草' },
      { key: 'pet', ev: 'pet', n: 2, label: '摸摸寵物 2 次' },
      { key: 'order', ev: 'order', n: 1, label: '交出 1 張訂單' },
      { key: 'harvest', ev: 'harvest', n: 15, label: '收成 15 次' },
    ];
    const tasks: TaskGen[] = [];
    if (wants.length) { const w = wants[Math.floor(rand() * wants.length)]; tasks.push({ key: `item:${w}`, item: w, n: 5, label: `收成或做出 ${this.label(w)} ×5` }); }
    while (tasks.length < 3) { const t = pool.splice(Math.floor(rand() * pool.length), 1)[0]; tasks.push(t); }
    fe.tasks = tasks.map((t, i) => ({ id: `${day}-${i}`, key: t.key, n: t.n, got: 0, claimed: false }));
  }

  // 已解鎖、目前拿得到的節慶指定品
  private wanted(): string[] {
    const d = this.game.state.data;
    const def = this.def;
    if (!def) return [];
    return def.wants.filter((k) => {
      const c = CROP_BY_ID[k];
      if (c) return d.level >= c.unlock && (c.season === 'all' || c.season === this.game.season || d.greenhouse.level > 0);
      const r = RECIPE_BY_ID[k];
      if (r) return d.level >= r.unlock;
      return false;
    });
  }

  private label(k: string): string {
    const c = CROP_BY_ID[k];
    if (c) return `${c.emoji}${c.name}`;
    const it = ITEM_INFO[k];
    return it ? `${it.emoji}${it.name}` : k;
  }

  private taskLabel(key: string, n: number): string {
    if (key.startsWith('item:')) return `收成或做出 ${this.label(key.slice(5))} ×${n}`;
    return { weed: `拔掉 ${n} 株雜草`, pet: `摸摸寵物 ${n} 次`, order: `交出 ${n} 張訂單`, harvest: `收成 ${n} 次` }[key] ?? key;
  }

  onEv(ev: Ev, n: number): void {
    if (!this.cur) return;
    for (const t of this.game.state.data.festival.tasks) if (t.key === ev && !t.claimed) this.bump(t, n);
  }

  onItem(id: string): void {
    if (!this.cur) return;
    for (const t of this.game.state.data.festival.tasks) if (t.key === `item:${id}` && !t.claimed) this.bump(t, 1);
  }

  private bump(t: { got: number; n: number; key: string }, n: number) {
    const was = t.got;
    t.got = Math.min(t.n, t.got + n);
    if (was < t.n && t.got >= t.n) this.game.hud.toast(`${this.def!.emoji} 節慶任務完成：${this.taskLabel(t.key, t.n)}（點橫幅領代幣）`, 2600);
  }

  // 春節紅包：每天第一次摸寵物時，寵物叼來一個紅包
  tryEnvelope(): boolean {
    const d = this.game.state.data;
    if (this.cur?.id !== 'cny') return false;
    const day = dayKey(this.game.state.now());
    if (d.festival.envelopeDay === day) return false;
    d.festival.envelopeDay = day;
    const c = RED_ENVELOPE[Math.floor(Math.random() * RED_ENVELOPE.length)];
    d.coins += c;
    d.festival.tokens += 5;
    const at = this.game.pet.root.position.clone().setY(0.9);
    sfx.envelope();
    this.game.particles.burst('fw0', at, 14, { speed: 1.6, up: 2, size: 0.35, life: 1 });
    this.game.fx.float(at.clone().setY(1.4), `🧧 +${c} 🪙　🏵️+5`, 'coin');
    this.game.hud.toast(`🧧 ${this.game.pet.name}叼來一個紅包！恭喜發財：🪙${c}＋節慶代幣 5`, 3600);
    return true;
  }

  // ---------- 面板 ----------
  open(): void {
    if (!this.cur) {
      const nf = nextFestival(this.game.state.now());
      if (nf) this.game.hud.toast(`下一個節慶：${FESTIVALS[nf.id].emoji} ${FESTIVALS[nf.id].name}（${new Date(nf.start).getMonth() + 1}/${new Date(nf.start).getDate()} 開始）`, 3000);
      return;
    }
    sfx.paper();
    this.sheet.show();
    this.render();
  }

  // 節慶訂單：每天一張，要 2 樣指定品
  private order(): { items: { key: string; n: number }[]; tokens: number; coins: number } | null {
    const wants = this.wanted();
    if (!wants.length) return null;
    const rand = mulberry32(hashStr(this.game.state.data.festival.key + dayKey(this.game.state.now()) + 'ord'));
    const a = wants[Math.floor(rand() * wants.length)], b = wants[Math.floor(rand() * wants.length)];
    const items = a === b ? [{ key: a, n: 5 }] : [{ key: a, n: 3 }, { key: b, n: 2 }];
    return { items, tokens: 25, coins: 300 + this.game.state.data.level * 20 };
  }

  private have(key: string): number {
    const inv = this.game.state.data.inventory;
    return ['', ':good', ':gold'].reduce((s, q) => s + (inv[key + q] ?? 0), 0);
  }

  render(): void {
    const g = this.game;
    const d = g.state.data;
    const def = this.def;
    if (!def || !this.cur) { this.sheet.close(); return; }
    this.sheet.setTitle(`${def.emoji} ${def.name}`);
    const left = Math.max(0, Math.ceil((this.cur.end - g.state.now()) / 86400000));
    const fe = d.festival;
    let html = `<div class="jn-season fest-head" style="--fc:${def.color}"><b>${def.blurb}</b><br><small>還有 ${left} 天 · 手上 🏵️ <b>${fe.tokens}</b> 枚節慶代幣（節慶結束後每枚換 🪙${TOKEN_TO_COINS}）</small></div>`;
    if (this.cur.id === 'cny') html += `<div class="jn-season"><small>🧧 每天第一次摸 ${g.pet.name}，牠會叼紅包給你。今天${fe.envelopeDay === dayKey(g.state.now()) ? '已經拿過了' : '還沒拿！'}</small></div>`;
    html += `<div class="jn-sec">📋 今日節慶任務 <small>每個 🏵️10</small></div>` + fe.tasks.map((t) => {
      const done = t.got >= t.n;
      return `<div class="jn-task ${t.claimed ? 'claimed' : ''}"><div class="jn-tl"><b>${this.taskLabel(t.key, t.n)}</b><div class="jn-bar"><i style="width:${(t.got / t.n) * 100}%"></i><span>${t.got} / ${t.n}</span></div></div>${t.claimed ? '<span class="jn-ok">✔</span>' : `<button class="btn small ${done ? '' : 'off'}" ${done ? `data-a="task:${t.id}"` : ''}>🏵️10</button>`}</div>`;
    }).join('');
    const o = this.order();
    if (o) {
      const doneToday = fe.bought.includes(`order:${dayKey(g.state.now())}`);
      const ok = o.items.every((it) => this.have(it.key) >= it.n);
      html += `<div class="jn-sec">${this.cur.id === 'cny' ? '🍲 年菜訂單' : '📦 節慶訂單'} <small>每天一張</small></div>` +
        row(def.emoji, o.items.map((it) => `${this.label(it.key)} ${Math.min(this.have(it.key), it.n)}/${it.n}`).join('　'), `獎勵 🏵️${o.tokens}＋🪙${o.coins}`, doneToday ? '完成' : '交貨', !doneToday && ok ? 'order' : null, doneToday ? 'done' : '');
    }
    html += `<div class="jn-sec">🛍️ 節慶商店</div>` + def.shop.map((s) => {
      const f = FURN_BY_ID[s.item];
      const hat = PET_HATS[s.item];
      const name = f ? `${f.emoji} ${f.name}` : hat ? `${hat.emoji} 寵物${hat.name}` : `${ITEM_INFO[s.item]?.emoji ?? '🎁'} ${ITEM_INFO[s.item]?.name ?? s.item}`;
      const sub = f ? `家具 · 舒適 +${f.comfort}` : hat ? `買了自動幫 ${g.pet.name} 戴上` : '限定道具';
      const owned = hat && (d.inventory[s.item] ?? 0) > 0;
      if (owned) return row(hat!.emoji, `寵物${hat!.name}`, d.petHat === s.item ? '戴著呢' : '已擁有', d.petHat === s.item ? '拿下' : '戴上', `wear:${s.item}`);
      return row(name.split(' ')[0], name.split(' ').slice(1).join(' '), `${sub} · 🏵️${s.cost}`, '兌換', fe.tokens >= s.cost ? `buy:${s.item}:${s.cost}` : null);
    }).join('');
    this.sheet.render(html);
  }

  private act(a: string) {
    const g = this.game;
    const d = g.state.data;
    const fe = d.festival;
    if (a.startsWith('task:')) {
      const t = fe.tasks.find((x) => x.id === a.slice(5));
      if (!t || t.claimed || t.got < t.n) return;
      t.claimed = true;
      fe.tokens += 10;
      sfx.coin();
    } else if (a === 'order') {
      const o = this.order();
      const tag = `order:${dayKey(g.state.now())}`;
      if (!o || fe.bought.includes(tag) || !o.items.every((it) => this.have(it.key) >= it.n)) return;
      for (const it of o.items) {
        let need = it.n;
        for (const q of ['', ':good', ':gold']) { const k = it.key + q; const take = Math.min(need, d.inventory[k] ?? 0); if (take) { g.state.addItem(k, -take); need -= take; } }
      }
      fe.bought.push(tag);
      fe.tokens += o.tokens;
      d.coins += o.coins;
      g.progression.track('order');
      sfx.fanfare();
      g.hud.toast(`${this.def!.emoji} 節慶訂單完成！🏵️+${o.tokens} 🪙+${o.coins}`, 2800);
    } else if (a.startsWith('buy:')) {
      const [, item, cost] = a.split(':');
      const c = Number(cost);
      if (fe.tokens < c) return;
      fe.tokens -= c;
      if (FURN_BY_ID[item]) { g.interior.grant(item); g.hud.toast(`${FURN_BY_ID[item].emoji} 換到了${FURN_BY_ID[item].name}！進屋按「🔨 佈置」就能擺`, 3000); }
      else if (PET_HATS[item]) { g.state.addItem(item); this.wear(item); }
      else { g.state.addItem(item); g.hud.toast(`換到了 ${ITEM_INFO[item]?.emoji ?? ''} ${ITEM_INFO[item]?.name ?? item}`); }
      sfx.sparkle();
    } else if (a.startsWith('wear:')) {
      const item = a.slice(5);
      this.wear(d.petHat === item ? '' : item);
    }
    g.state.save();
    this.render();
  }

  wear(item: string): void {
    const g = this.game;
    g.state.data.petHat = item;
    g.pet.setFestiveHat(item);
    if (item) { g.pet.react(); g.hud.toast(`${PET_HATS[item].emoji} ${g.pet.name}戴上了${PET_HATS[item].name}！`, 2400); }
  }

  private renderBanner(now: number) {
    const b = this.banner;
    const def = this.def;
    b.classList.toggle('hidden', !def);
    if (!def || !this.cur) return;
    const left = Math.max(0, Math.ceil((this.cur.end - now) / 86400000));
    const claim = this.game.state.data.festival.tasks.filter((t) => !t.claimed && t.got >= t.n).length;
    const html = `<span class="em">${def.emoji}</span><b>${def.name}</b><small>剩 ${left} 天 · 🏵️${this.game.state.data.festival.tokens}</small>${claim ? `<i class="badge">${claim}</i>` : ''}`;
    if (b.innerHTML !== html) b.innerHTML = html;
    b.style.setProperty('--fc', def.color);
  }

  // 夜空煙火（元旦、春節、元宵）
  update(dt: number, glow: number): void {
    const id = this.cur?.id;
    if (!id || !['newyear', 'cny', 'lantern'].includes(id) || glow < 0.7 || this.game.interior.active) return;
    this.fwT -= dt;
    if (this.fwT > 0) return;
    this.fwT = 2.5 + Math.random() * 4;
    const a = Math.random() * Math.PI - Math.PI;
    const at = new THREE.Vector3(Math.cos(a) * 16, 11 + Math.random() * 5, -8 + Math.sin(a) * 8);
    const k = (['fw0', 'fw1', 'fw2', 'fw3'] as const)[Math.floor(Math.random() * 4)];
    window.setTimeout(() => {
      this.game.particles.burst(k, at, 36, { speed: 7, up: 1.5, size: 0.9, life: 1.6, gravity: 1.2 });
      this.game.particles.burst('fw1', at, 10, { speed: 3, up: 0.5, size: 0.5, life: 1.2, gravity: 1 });
      const p = this.game.player.root.position;
      sfx.at(Math.max(0.15, 1 - Math.hypot(at.x - p.x, at.z - p.z) / 40), () => sfx.firework());
    }, 100);
  }
}
