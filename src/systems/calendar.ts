import * as THREE from 'three';
import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { hashStr, mulberry32 } from '../core/rng';
import { CROPS, CROP_BY_ID } from '../data/crops';
import { RECIPES } from '../data/recipes';
import { CATCHUP_DAYS, CATCHUP_MULT, MONTH_THEME, STAMP_BIG, STAMP_SMALL, bondLevel } from '../data/economy';
import { FURNITURE, FURN_BY_ID } from '../data/furniture';
import { MARKET_BONUS, MARKET_CAP, PET_TREAT, STORY, type Chapter } from '../data/story';
import { Sheet, row } from '../ui/sheet';
import { ITEM_INFO } from '../ui/hud';
import type { Game } from '../game';

// 日曆類的黏著系統（docs/05）：月曆印章卡、月份主題、週末市集與流浪商人、小鎮主線、回流保護
const DAY = 86400000;
const SEASON_STAMP = ['stamp_winter', 'stamp_winter', 'stamp_spring', 'stamp_spring', 'stamp_spring', 'stamp_summer', 'stamp_summer', 'stamp_summer', 'stamp_autumn', 'stamp_autumn', 'stamp_autumn', 'stamp_winter'];
const monthKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}`; };
// 週一為一週的開始
const weekKey = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); };

export type MarketKind = 'none' | 'merchant' | 'market';

export class Calendar {
  market = new Sheet('market-panel', '🧺 市集');
  kind: MarketKind = 'none';
  override: MarketKind | null = null; // DEV
  private monthShown = '';
  private storyBusy = false;

  constructor(private game: Game) {
    this.market.onAction = (a) => this.marketAct(a);
  }

  // ---------- 月份主題 ----------
  theme(now = this.game.state.now()) { return MONTH_THEME[new Date(now).getMonth() + 1]; }
  xpMult(kind: 'harvest' | 'weed' | 'other', now: number): number {
    const t = this.theme(now);
    let m = kind === 'harvest' ? t.harvestXp ?? 1 : kind === 'weed' ? t.weedXp ?? 1 : 1;
    if (now < this.game.state.data.catchupUntil) m *= CATCHUP_MULT;
    return m;
  }

  // ---------- 每秒 ----------
  tick(now: number): void {
    const d = this.game.state.data;
    // 月曆印章：當天第一次上線蓋一格
    const mk = monthKey(now), dk = dayKey(now);
    if (d.stamps.month !== mk) d.stamps = { month: mk, days: [], claimed: [] };
    if (!d.stamps.days.includes(dk) && d.onboard === 'done') {
      d.stamps.days.push(dk);
      const n = d.stamps.days.length;
      window.setTimeout(() => this.game.hud.toast(`📅 月曆印章 +1（本月第 ${n} 天${n === STAMP_SMALL || n === STAMP_BIG ? '，可以領獎了！' : ''}）`, 2600), 3500);
    }
    if (this.monthShown !== mk && d.onboard === 'done') {
      this.monthShown = mk;
      const t = this.theme(now);
      window.setTimeout(() => this.game.hud.toast(`🗓️ ${new Date(now).getMonth() + 1} 月主題「${t.name}」：${t.desc}`, 3400), 6000);
    }
    // 市集：週六日擺攤、週三流浪商人（第 3 章之後才開始）
    const wd = new Date(now).getDay();
    const unlocked = this.chapterOpen(3, now);
    const kind: MarketKind = this.override ?? (!unlocked ? 'none' : wd === 0 || wd === 6 ? 'market' : wd === 3 ? 'merchant' : 'none');
    if (kind !== this.kind) {
      this.kind = kind;
      this.game.world.setMarket(kind);
      this.game.world.rebuildGrid();
      if (kind !== 'none' && d.onboard === 'done') window.setTimeout(() => this.game.hud.toast(kind === 'market' ? '🧺 週末市集開張了！阿福在小徑旁擺攤收購作物' : '🎒 流浪商人路過農場，帶來了稀有的東西', 3400), 2800);
    }
    const wk = weekKey(now);
    if (d.market.week !== wk) d.market = { week: wk, sold: {}, bought: [] };
    if (this.market.open) this.renderMarket();
    this.checkStory(now);
  }

  // ---------- 回流保護（開遊戲時呼叫一次） ----------
  welcomeBack(now: number, offlineHours: number): void {
    const g = this.game;
    const d = g.state.data;
    const days = offlineHours / 24;
    if (d.onboard !== 'done' || days < 3) return;
    const gift: string[] = [];
    g.state.addItem('fert', 3); gift.push('🧪 有機肥 ×3');
    const coins = 200 + d.level * 30; d.coins += coins; gift.push(`🪙 ${coins}`);
    if (days >= 7) { d.catchupUntil = now + CATCHUP_DAYS * DAY; gift.push(`✨ 接下來 ${CATCHUP_DAYS} 天 XP ×${CATCHUP_MULT}`); }
    let cleared = 0;
    if (days >= 30) {
      // 想你日記：幫你把草除到剩一半
      const list = [...g.weeds.list];
      cleared = Math.floor(list.length / 2);
      for (const w of list.slice(0, cleared)) g.weeds.remove(w.id);
    }
    const pet = g.pet.name;
    const html = days >= 30
      ? `<p>📓 <b>${pet}的想你日記</b></p><p>你離開了 ${Math.floor(days)} 天。我每天都坐在門口等你。</p><p>草長得好高，我拔掉了 ${cleared} 株（剩下的留給你）。花花每天都有哞哞叫，應該也是在想你。</p><p>歡迎回家！這些是我幫你存下來的：</p><p><b>${gift.join('　')}</b></p><p class="sign">— ${pet} 🐾</p>`
      : `<p>🎁 <b>歡迎回來！</b></p><p>你不在的 ${Math.floor(days)} 天，${pet}一直在門口張望。</p><p>這是回流禮包：<b>${gift.join('　')}</b></p><p class="sign">— 農場的大家</p>`;
    window.setTimeout(() => {
      g.pet.react();
      g.particles.burst('heart', g.pet.root.position.clone().setY(1), 16, { speed: 2, up: 2, size: 0.4, life: 1.4 });
      void g.hud.letter(html, '我回來了！');
    }, 2500);
  }

  // ---------- 小鎮主線 ----------
  chapterOpen(n: number, now: number): boolean {
    const c = STORY[n - 1];
    const d = this.game.state.data;
    return d.level >= c.level && now - d.createdAt >= c.day * DAY - 60000;
  }

  private async checkStory(now: number) {
    const g = this.game;
    const d = g.state.data;
    if (this.storyBusy || d.onboard !== 'done' || d.tutorial >= 0 || g.onboarding || g.interior.active) return;
    const next = STORY.find((c) => !d.story.includes(c.n) && this.chapterOpen(c.n, now));
    if (!next) return;
    this.storyBusy = true;
    d.story.push(next.n);
    await new Promise((r) => window.setTimeout(r, 1800));
    sfx.paper();
    await g.hud.letter(this.letterHtml(next, true), '收下');
    this.grant(next);
    g.state.save();
    this.storyBusy = false;
  }

  private letterHtml(c: Chapter, withReward: boolean): string {
    return `<p>📜 <b>第 ${c.n} 章　${c.title}</b></p>${c.letter.map((l) => `<p>${l}</p>`).join('')}<p class="sign">— ${c.emoji} ${c.who}</p>` +
      (withReward ? `<p><small>開放：${c.opens}　禮物：${this.rewardText(c)}</small></p>` : '');
  }

  private rewardText(c: Chapter): string {
    const r = c.reward;
    if (r.coins) return `🪙${r.coins.toLocaleString()}`;
    if (r.furn) return `${FURN_BY_ID[r.furn]?.emoji} ${FURN_BY_ID[r.furn]?.name}`;
    if (r.item) return `${ITEM_INFO[r.item]?.emoji} ${ITEM_INFO[r.item]?.name} ×${r.count}`;
    return '';
  }

  private grant(c: Chapter) {
    const g = this.game;
    const r = c.reward;
    if (r.coins) g.state.data.coins += r.coins;
    if (r.item) g.state.addItem(r.item, r.count ?? 1);
    if (r.furn) g.interior.grant(r.furn);
    sfx.sparkle();
  }

  storyTab(now: number): string {
    const d = this.game.state.data;
    const read = STORY.filter((c) => d.story.includes(c.n)).length;
    return `<div class="jn-season"><b>📜 小鎮復興　${read} / ${STORY.length} 章</b><br><small>奶奶的農場旁邊有個沒落的小鎮。農場興旺起來，搬走的村民就會一個一個回來。</small></div>` +
      STORY.map((c) => {
        const got = d.story.includes(c.n);
        if (got) return `<div class="jn-task claimed story-row" data-a="read:${c.n}"><span class="em">${c.emoji}</span><div class="jn-tl"><b>第 ${c.n} 章　${c.title}</b><br><small>${c.who} · 開放：${c.opens}（點一下重讀）</small></div><span class="jn-ok">✔</span></div>`;
        const daysLeft = Math.max(0, Math.ceil((d.createdAt + c.day * DAY - now) / DAY));
        return `<div class="jn-task"><span class="em">❔</span><div class="jn-tl"><b>第 ${c.n} 章　？？？</b><br><small>${daysLeft ? `再過 ${daysLeft} 天、` : ''}Lv${c.level} 解鎖</small></div></div>`;
      }).join('');
  }

  reread(n: number): void {
    const c = STORY[n - 1];
    if (c) void this.game.hud.letter(this.letterHtml(c, false), '好');
  }

  // ---------- 月曆印章 ----------
  stampTab(now: number): string {
    const d = this.game.state.data;
    const s = d.stamps;
    const dt = new Date(now);
    const days = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    const first = new Date(dt.getFullYear(), dt.getMonth(), 1).getDay();
    const cells = Array.from({ length: first }, () => '<div class="st-cell empty"></div>').join('') +
      Array.from({ length: days }, (_, i) => {
        const k = `${dt.getFullYear()}-${dt.getMonth() + 1}-${i + 1}`;
        const on = s.days.includes(k);
        return `<div class="st-cell ${on ? 'on' : ''} ${i + 1 === dt.getDate() ? 'today' : ''}">${i + 1}${on ? '<i>🐾</i>' : ''}</div>`;
      }).join('');
    const n = s.days.length;
    const big = SEASON_STAMP[dt.getMonth()];
    const t = this.theme(now);
    const prize = (need: number, label: string, key: number) => {
      const claimed = s.claimed.includes(key);
      return row(key === STAMP_BIG ? FURN_BY_ID[big].emoji : '🎁', `登入 ${need} 天`, label, claimed ? '已領' : n >= need ? '領取' : `${n}/${need}`, !claimed && n >= need ? `stamp:${key}` : null, claimed ? 'done' : '');
    };
    return `<div class="jn-season"><b>📅 ${dt.getMonth() + 1} 月印章卡</b>　本月已登入 <b>${n}</b> 天 <small>（不用連續，漏掉也不會歸零）</small><br><small>🗓️ 本月主題「${t.name}」：${t.desc}${d.catchupUntil > now ? `　✨ 回流加成 XP ×${CATCHUP_MULT}（剩 ${Math.ceil((d.catchupUntil - now) / DAY)} 天）` : ''}</small></div>
      <div class="st-grid">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="st-wd">${w}</div>`).join('')}${cells}</div>` +
      prize(STAMP_SMALL, '🧪 有機肥 ×3＋🪙500', STAMP_SMALL) + prize(STAMP_BIG, `當月限定家具：${FURN_BY_ID[big].name}`, STAMP_BIG);
  }

  claimStamp(key: number): void {
    const g = this.game;
    const s = g.state.data.stamps;
    if (s.claimed.includes(key) || s.days.length < key) return;
    s.claimed.push(key);
    if (key === STAMP_SMALL) { g.state.addItem('fert', 3); g.state.data.coins += 500; }
    else { const f = SEASON_STAMP[new Date(g.state.now()).getMonth()]; g.interior.grant(f); g.hud.toast(`${FURN_BY_ID[f].emoji} 拿到當月限定家具：${FURN_BY_ID[f].name}`, 3000); }
    sfx.fanfare();
    g.state.save();
  }

  // ---------- 週末市集／流浪商人 ----------
  openMarket(): void {
    if (this.kind === 'none') { this.game.hud.toast('攤位今天沒開：週末是市集、週三有流浪商人'); return; }
    sfx.paper();
    this.market.show();
    this.renderMarket();
  }

  // 本週市集收購的 4 樣東西（已解鎖的作物或加工品）
  private featured(): string[] {
    const d = this.game.state.data;
    const pool = [
      ...CROPS.filter((c) => !c.night && d.level >= c.unlock && (c.season === 'all' || c.season === this.game.season)).map((c) => c.id),
      ...RECIPES.filter((r) => d.level >= r.unlock).map((r) => r.id),
    ];
    const rand = mulberry32(hashStr('market' + d.market.week));
    const out: string[] = [];
    while (out.length < Math.min(4, pool.length)) { const k = pool[Math.floor(rand() * pool.length)]; if (!out.includes(k)) out.push(k); }
    return out;
  }

  private price(key: string): number {
    const c = CROP_BY_ID[key];
    if (c) return Math.round(c.sell * MARKET_BONUS);
    return Math.round((ITEM_INFO[key]?.price ?? 1) * MARKET_BONUS);
  }

  private have(key: string): number {
    const inv = this.game.state.data.inventory;
    return inv[key] ?? 0;
  }

  // 流浪商人的貨：巨型種子、節慶家具復刻、有機肥
  private merchantGoods(): { id: string; kind: 'item' | 'furn'; n: number; coins: number }[] {
    const rand = mulberry32(hashStr('merchant' + this.game.state.data.market.week));
    const festive = FURNITURE.filter((f) => f.source === 'festival');
    const f = festive[Math.floor(rand() * festive.length)];
    return [
      { id: 'giantseed', kind: 'item', n: 1, coins: 5000 },
      { id: f.id, kind: 'furn', n: 1, coins: 3000 },
      { id: 'fert', kind: 'item', n: 5, coins: 400 },
    ];
  }

  renderMarket(): void {
    const g = this.game;
    const d = g.state.data;
    let html = '';
    if (this.kind === 'market') {
      this.market.setTitle('🧺 週末市集');
      html += `<div class="jn-season"><b>阿福：</b>「這個週末我特別想收這幾樣，價錢是平常的 ${MARKET_BONUS} 倍喔！」<br><small>每樣每個週末最多收 ${MARKET_CAP} 個（普通品質）</small></div>`;
      html += this.featured().map((k) => {
        const sold = d.market.sold[k] ?? 0;
        const have = this.have(k);
        const can = Math.min(have, MARKET_CAP - sold);
        const info = CROP_BY_ID[k] ?? ITEM_INFO[k];
        return row(info?.emoji ?? '📦', `${info?.name ?? k} <small>🪙${this.price(k)} / 個</small>`, `背包 ${have} · 本週已賣 ${sold}/${MARKET_CAP}`, can > 0 ? `賣 ${can} 個` : sold >= MARKET_CAP ? '收滿了' : '沒有貨', can > 0 ? `sell:${k}` : null);
      }).join('');
      const treats = d.market.bought.filter((b) => b === 'treat').length;
      html += `<div class="jn-sec">🦴 寵物零食 <small>每週最多 ${PET_TREAT.perWeek} 包</small></div>` +
        row('🦴', `${g.pet.name}最愛的零食`, `親密度 +${PET_TREAT.bond} · 🪙${PET_TREAT.coins}`, treats >= PET_TREAT.perWeek ? '賣完了' : '購買', treats < PET_TREAT.perWeek && d.coins >= PET_TREAT.coins ? 'treat' : null);
    } else {
      this.market.setTitle('🎒 流浪商人');
      html += `<div class="jn-season"><b>流浪商人：</b>「呵呵……這些東西，別的地方可買不到。錯過這週，就要等下週三囉。」</div>`;
      html += this.merchantGoods().map((it) => {
        const tag = `m:${it.id}`;
        const bought = d.market.bought.includes(tag);
        const name = it.kind === 'furn' ? `${FURN_BY_ID[it.id].emoji} ${FURN_BY_ID[it.id].name}` : `${ITEM_INFO[it.id].emoji} ${ITEM_INFO[it.id].name} ×${it.n}`;
        const sub = it.kind === 'furn' ? `節慶家具復刻 · 舒適 +${FURN_BY_ID[it.id].comfort}` : it.id === 'giantseed' ? '種在 3×3 的田上，3 天長成巨型作物' : '堆肥桶做的有機肥，特價';
        return row(name.split(' ')[0], name.split(' ').slice(1).join(' '), `${sub} · 🪙${it.coins.toLocaleString()}`, bought ? '已購買' : '購買', !bought && d.coins >= it.coins ? `mbuy:${it.id}` : null, bought ? 'done' : '');
      }).join('');
    }
    this.market.render(html);
  }

  private marketAct(a: string) {
    const g = this.game;
    const d = g.state.data;
    if (a.startsWith('sell:')) {
      const k = a.slice(5);
      const sold = d.market.sold[k] ?? 0;
      const n = Math.min(this.have(k), MARKET_CAP - sold);
      if (n <= 0) return;
      g.state.addItem(k, -n);
      d.market.sold[k] = sold + n;
      const c = n * this.price(k);
      d.coins += c;
      g.progression.track('sell', n);
      g.progression.track('coins', c);
      sfx.coin();
      g.hud.toast(`🧺 賣給阿福 ${n} 個，🪙+${c}`);
    } else if (a === 'treat') {
      if (d.coins < PET_TREAT.coins) return;
      d.coins -= PET_TREAT.coins;
      d.market.bought.push('treat');
      const before = bondLevel(d.pet.bond);
      d.pet.bond += PET_TREAT.bond;
      g.pet.react();
      g.particles.burst('heart', g.pet.root.position.clone().setY(1), 10, { speed: 1.2, up: 1.6, size: 0.35, life: 1.2 });
      g.hud.toast(`🦴 ${g.pet.name}開心地吃掉零食！親密度 +${PET_TREAT.bond}${bondLevel(d.pet.bond) > before ? `，升到 ${bondLevel(d.pet.bond)} 級` : ''}`, 2800);
    } else if (a.startsWith('mbuy:')) {
      const it = this.merchantGoods().find((x) => x.id === a.slice(5));
      const tag = `m:${a.slice(5)}`;
      if (!it || d.market.bought.includes(tag) || d.coins < it.coins) return;
      d.coins -= it.coins;
      d.market.bought.push(tag);
      if (it.kind === 'furn') g.interior.grant(it.id);
      else g.state.addItem(it.id, it.n);
      sfx.coin();
      g.hud.toast(`🎒 買到了 ${it.kind === 'furn' ? FURN_BY_ID[it.id].name : ITEM_INFO[it.id].name}`);
    }
    g.state.save();
    this.renderMarket();
  }

  // 攤位上方的選單錨點
  anchor(): THREE.Vector3 {
    const m = this.game.sceneLayout.market;
    return new THREE.Vector3(m.x, 2.6, m.z);
  }
}
