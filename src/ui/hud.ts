import type { HudKey, Layout } from '../config/layout';
import { LEVEL_CAP, MILK_SELL, xpNext } from '../data/economy';
import { RECIPES } from '../data/recipes';
import { TREES } from '../data/trees';
import { GIANTS } from '../data/crops';
import { SEASON_LABEL, type Season } from '../core/clock';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export const ITEM_INFO: Record<string, { name: string; emoji: string; price: number }> = {
  weed: { name: '雜草', emoji: '🌿', price: 1 },
  leaf: { name: '落葉', emoji: '🍂', price: 1 },
  snowball: { name: '雪球', emoji: '⛄', price: 2 },
  dandelion: { name: '蒲公英', emoji: '🌼', price: 3 },
  clover: { name: '四葉草', emoji: '🍀', price: 50 },
  coin_old: { name: '古錢幣', emoji: '🪙', price: 120 },
  milk: { name: '牛奶', emoji: '🥛', price: MILK_SELL },
  hay: { name: '牧草', emoji: '🌾', price: 2 },
  wood: { name: '木材', emoji: '🪵', price: 3 },
  stone: { name: '石材', emoji: '🪨', price: 3 },
  fert: { name: '有機肥', emoji: '🧪', price: 20 },
  giantseed: { name: '巨型種子', emoji: '🌰', price: 0 },
  vine: { name: '藤條', emoji: '🪢', price: 8 },
  honey: { name: '蜂蜜', emoji: '🍯', price: 140 },
};
// 加工品、水果、巨型作物
for (const r of RECIPES) ITEM_INFO[r.id] = { name: r.name, emoji: r.emoji, price: r.sell };
for (const t of TREES) ITEM_INFO[t.id] = { name: t.name, emoji: t.emoji, price: t.sell };
for (const g of GIANTS) ITEM_INFO[g.id] = { name: g.name, emoji: g.emoji, price: g.sell };

// 通用的動作選單項目（牛、堆肥桶、房子共用）
export interface MenuItem { act: string; emoji: string; label: string; enabled: boolean; note: string }
export interface MenuView { title: string; sub: string; items: MenuItem[] }

// 工具列格子（種子、有機肥）
export interface ToolSlot { id: string; emoji: string; name: string; sub: string; selected: boolean; lock: string }

// 訂單卡
export interface OrderCard {
  id: string;
  items: { emoji: string; name: string; have: number; need: number }[];
  coins: number;
  xp: number;
  canDeliver: boolean;
  done: boolean;
  cafe?: boolean; // 咖啡廳特殊訂單
  bonus?: string; // 附贈的禮物
}

export class Hud {
  root: HTMLElement;
  private els = {} as Record<HudKey, HTMLElement>;
  private toastTimer = 0;
  private hintText = '';
  private toolKey = '';
  onTool?: (id: string) => void;
  onBag?: () => void;
  onPet?: () => void;
  onMute?: () => void;
  onSell?: () => void;
  onMow?: () => void;
  onJournal?: () => void;
  onFriends?: () => void;
  onSettings?: () => void;
  onMenuAct?: (key: string, act: string) => void;
  onDeliver?: (id: string) => void;
  onSkip?: (id: string) => void;
  private menu!: HTMLElement;
  menuOpen: string | null = null;
  ordersOpen = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-el" data-hud="status">
        <div class="avatar">🧑‍🌾</div>
        <div class="stat-col">
          <div class="lv-row"><span class="lv">Lv 1</span><span class="rested" title="休息加成：收成 XP ×2">✨</span></div>
          <div class="xpbar"><div class="xpfill"></div><span class="xptext"></span></div>
        </div>
      </div>
      <div class="hud-el" data-hud="wallet">
        <div class="pill clock"><span class="wx">☀️</span><span class="date"></span></div>
        <div class="pill coins">🪙 <b class="coin-n">0</b></div>
        <button class="pill icon-btn mute" title="音效">🔊</button>
        <button class="pill icon-btn gear" title="設定">⚙️</button>
      </div>
      <div class="hud-el" data-hud="toolbar"><div class="seeds"></div></div>
      <div class="hud-el" data-hud="bag">
        <button class="round-btn fr-btn" title="好友 (F)"><span>👥</span><i class="badge hidden">0</i></button>
        <button class="round-btn jn-btn" title="農場手帳 (J)"><span>📔</span><i class="badge hidden">0</i></button>
        <button class="round-btn mow-btn" title="除草機 (R)"><span>🚜</span></button>
        <button class="round-btn pet-btn" title="麻糬"><span>🐶</span><i class="bond"></i></button>
        <button class="round-btn bag-btn" title="背包 (B)"><span>🎒</span><i class="badge hidden">0</i></button>
      </div>
      <div class="hud-el" data-hud="queue"><div class="queue"></div></div>
      <div class="hud-el" data-hud="toast"><div class="toast hidden"></div></div>
      <div class="hud-el" data-hud="event"></div>
    `;
    document.body.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('.hud-el').forEach((el) => (this.els[el.dataset.hud as HudKey] = el));
    $('.bag-btn', this.root).onclick = () => this.onBag?.();
    $('.pet-btn', this.root).onclick = () => this.onPet?.();
    $('.mute', this.root).onclick = () => this.onMute?.();
    $('.mow-btn', this.root).onclick = () => this.onMow?.();
    $('.jn-btn', this.root).onclick = () => this.onJournal?.();
    $('.fr-btn', this.root).onclick = () => this.onFriends?.();
    $('.gear', this.root).onclick = () => this.onSettings?.();
    // 工具列：滑鼠滾輪橫向捲動
    const seeds = $('.seeds', this.root);
    seeds.addEventListener('wheel', (e) => { seeds.scrollLeft += e.deltaY; e.preventDefault(); }, { passive: false });

    const panel = this.makePanel('bag-panel', `<div class="panel-card"><h3>🎒 背包</h3><div class="items"></div>
      <div class="panel-actions"><button class="btn sell">全部賣出</button><button class="btn ghost close">關閉</button></div></div>`);
    $('.sell', panel).onclick = () => this.onSell?.();

    const orders = this.makePanel('orders-panel', `<div class="panel-card wide"><h3>📬 訂單板</h3><div class="ord-sub"></div><div class="orders"></div>
      <div class="panel-actions"><button class="btn ghost close">關閉</button></div></div>`, () => (this.ordersOpen = false));
    orders.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-oid]');
      if (!b || b.classList.contains('off')) return;
      if (b.dataset.kind === 'deliver') this.onDeliver?.(b.dataset.oid!);
      else this.onSkip?.(b.dataset.oid!);
    });

    this.makePanel('confirm-panel', `<div class="panel-card"><h3 class="cf-title"></h3><div class="cf-body"></div>
      <div class="panel-actions"><button class="btn cf-ok">確定</button><button class="btn ghost close">取消</button></div></div>`);
    this.makePanel('letter-panel', `<div class="panel-card letter"><div class="lt-body"></div>
      <div class="panel-actions"><button class="btn lt-ok">好</button></div></div>`);

    const lv = document.createElement('div');
    lv.id = 'levelup';
    lv.className = 'hidden';
    document.body.appendChild(lv);

    const combo = document.createElement('div');
    combo.id = 'combo';
    document.body.appendChild(combo);

    this.menu = document.createElement('div');
    this.menu.id = 'act-menu';
    this.menu.className = 'hidden';
    this.menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.menu.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!b || b.classList.contains('off') || !this.menuOpen) return;
      const key = this.menuOpen;
      this.hideMenu();
      this.onMenuAct?.(key, b.dataset.act!);
    };
    document.body.appendChild(this.menu);
  }

  private makePanel(id: string, html: string, onClose?: () => void): HTMLElement {
    const p = document.createElement('div');
    p.id = id;
    p.className = 'panel hidden';
    p.innerHTML = html;
    document.body.appendChild(p);
    const close = () => { p.classList.add('hidden'); onClose?.(); };
    p.querySelector<HTMLElement>('.close')?.addEventListener('click', close);
    p.addEventListener('click', (e) => { if (e.target === p && id !== 'letter-panel') close(); });
    return p;
  }

  el(key: HudKey): HTMLElement { return this.els[key]; }

  applyLayout(layout: Layout): void {
    for (const key of Object.keys(this.els) as HudKey[]) {
      const it = layout.hud[key];
      const el = this.els[key];
      const s = el.style;
      s.left = s.right = s.top = s.bottom = '';
      const [v, h] = [it.anchor[0], it.anchor[1]];
      const insetY = v === 't' ? 'env(safe-area-inset-top)' : 'env(safe-area-inset-bottom)';
      if (v === 't') s.top = `calc(${it.y}px + ${insetY})`;
      else s.bottom = `calc(${it.y}px + ${insetY})`;
      let tx = '0';
      if (h === 'l') s.left = `calc(${it.x}px + env(safe-area-inset-left))`;
      else if (h === 'r') s.right = `calc(${it.x}px + env(safe-area-inset-right))`;
      else { s.left = `calc(50% + ${it.x}px)`; tx = '-50%'; }
      s.transform = `translateX(${tx}) scale(${it.scale})`;
      s.transformOrigin = `${h === 'l' ? 'left' : h === 'r' ? 'right' : 'center'} ${v === 't' ? 'top' : 'bottom'}`;
      s.fontSize = `${it.fontSize}px`;
      s.color = it.color;
      s.opacity = String(it.opacity);
    }
  }

  setStatus(level: number, xp: number, rested: number): void {
    const need = xpNext(level);
    const max = level >= LEVEL_CAP;
    $('.lv', this.root).textContent = `Lv ${level}`;
    ($('.xpfill', this.root) as HTMLElement).style.width = max ? '100%' : `${Math.min(100, (xp / need) * 100)}%`;
    $('.xptext', this.root).textContent = max ? 'MAX' : `${Math.floor(xp).toLocaleString()} / ${need.toLocaleString()}`;
    $('.rested', this.root).classList.toggle('hidden', rested <= 0);
  }

  setWallet(coins: number, season: Season, t: number, wx: string): void {
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    const html = `${SEASON_LABEL[season]} · ${d.getMonth() + 1}/${d.getDate()} <span class="wd">週${WEEKDAY[d.getDay()]}</span> ${hh}:${mm}`;
    const el = $('.date', this.root);
    if (el.innerHTML !== html) el.innerHTML = html;
    $('.wx', this.root).textContent = wx;
    $('.coin-n', this.root).textContent = Math.floor(coins).toLocaleString();
  }

  // ---------- 動作選單（跟著物件在畫面上的位置） ----------
  showMenu(key: string, m: MenuView): void {
    const html = `<div class="cm-title">${m.title}</div><div class="cm-sub">${m.sub}</div>` +
      m.items.map((it) => `<button data-act="${it.act}" class="${it.enabled ? '' : 'off'}"><span class="em">${it.emoji}</span><span class="lb">${it.label}</span><span class="nt">${it.note}</span></button>`).join('');
    if (this.menu.innerHTML !== html) this.menu.innerHTML = html;
    if (this.menuOpen !== key) {
      this.menu.classList.remove('hidden', 'pop');
      void this.menu.offsetWidth;
      this.menu.classList.add('pop');
    }
    this.menuOpen = key;
  }

  moveMenu(x: number, y: number): void {
    this.menu.style.left = `${Math.max(130, Math.min(window.innerWidth - 130, x))}px`;
    this.menu.style.top = `${Math.max(220, y)}px`;
  }

  hideMenu(): void {
    this.menuOpen = null;
    this.menu.classList.add('hidden');
  }

  setMower(on: boolean): void { $('.mow-btn', this.root).classList.toggle('on', on); }

  setMute(m: boolean): void { $('.mute', this.root).textContent = m ? '🔇' : '🔊'; }

  // ---------- 工具列（種子＋有機肥，可橫向捲動） ----------
  setTools(slots: ToolSlot[]): void {
    const box = $('.seeds', this.root);
    const key = slots.map((s) => s.id).join(',');
    if (key !== this.toolKey) {
      this.toolKey = key;
      box.innerHTML = '';
      slots.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'seed';
        b.dataset.id = s.id;
        b.innerHTML = `<span class="em"></span><span class="nm"></span><span class="pr"></span><span class="key">${i < 9 ? i + 1 : ''}</span><span class="lock"></span>`;
        b.onclick = () => this.onTool?.(s.id);
        box.appendChild(b);
      });
    }
    slots.forEach((s) => {
      const b = box.querySelector<HTMLElement>(`[data-id="${s.id}"]`)!;
      b.querySelector('.em')!.textContent = s.emoji;
      b.querySelector('.nm')!.textContent = s.name;
      b.querySelector('.pr')!.textContent = s.sub;
      b.querySelector('.lock')!.textContent = s.lock;
      b.classList.toggle('sel', s.selected);
      b.classList.toggle('locked', !!s.lock);
    });
  }

  setPet(bondLv: number, touchesLeft: number, emoji = '🐶'): void {
    const sp = $('.pet-btn span', this.root);
    if (sp.textContent !== emoji) sp.textContent = emoji;
    $('.bond', this.root).textContent = `♥${bondLv}`;
    $('.pet-btn', this.root).classList.toggle('glow', touchesLeft > 0);
  }

  setJournalBadge(n: number): void {
    const b = $('.jn-btn .badge', this.root);
    b.textContent = String(n);
    b.classList.toggle('hidden', n <= 0);
  }

  setFriendBadge(n: number): void {
    const b = $('.fr-btn .badge', this.root);
    b.textContent = String(n);
    b.classList.toggle('hidden', n <= 0);
  }

  setBagCount(n: number): void {
    const b = $('.bag-btn .badge', this.root);
    b.textContent = String(n);
    b.classList.toggle('hidden', n <= 0);
  }

  setQueue(icons: string[]): void {
    const q = $('.queue', this.root);
    const shown = icons.slice(0, 12);
    const html = shown.map((i) => `<span>${i}</span>`).join('') + (icons.length > 12 ? `<span class="more">+${icons.length - 12}</span>` : '');
    if (q.innerHTML !== html) q.innerHTML = html;
    q.classList.toggle('hidden', !icons.length);
  }

  toast(msg: string, ms = 2200): void {
    const t = $('.toast', this.root);
    t.textContent = msg;
    t.classList.remove('hidden', 'hint');
    t.classList.remove('pop');
    void t.offsetWidth;
    t.classList.add('pop');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.showHint(), ms);
  }

  // 常駐提示（新手引導）
  hint(msg: string): void {
    if (this.hintText === msg) return;
    this.hintText = msg;
    this.showHint();
  }

  private showHint() {
    const t = $('.toast', this.root);
    if (!this.hintText) { t.classList.add('hidden'); return; }
    t.textContent = this.hintText;
    t.classList.remove('hidden');
    t.classList.add('hint');
  }

  openBag(inv: Record<string, number>, cropInfo: (key: string) => { name: string; emoji: string; price: number } | null): void {
    const panel = $('#bag-panel');
    const items = $('.items', panel);
    const keys = Object.keys(inv).filter((k) => inv[k] > 0);
    items.innerHTML = keys.length
      ? keys.map((k) => {
        const info = cropInfo(k) ?? ITEM_INFO[k] ?? { name: k, emoji: '📦', price: 0 };
        return `<div class="item"><span class="em">${info.emoji}</span><span class="nm">${info.name}</span><span class="ct">×${inv[k]}</span><span class="pr">🪙${info.price}</span></div>`;
      }).join('')
      : '<div class="empty">背包是空的，去收成或拔草吧！</div>';
    panel.classList.remove('hidden');
  }

  closeBag(): void { $('#bag-panel').classList.add('hidden'); }

  // ---------- 訂單板 ----------
  openOrders(sub: string, cards: OrderCard[]): void {
    const p = $('#orders-panel');
    $('.ord-sub', p).textContent = sub;
    const html = cards.map((c) => `
      <div class="order ${c.done ? 'done' : ''} ${c.cafe ? 'cafe' : ''}">
        ${c.cafe ? '<div class="ord-cafe">☕ 咖啡廳特別訂單</div>' : ''}
        <div class="ord-items">${c.items.map((it) => `<div class="ord-it ${it.have >= it.need ? 'ok' : ''}"><span class="em">${it.emoji}</span><span class="nm">${it.name}</span><span class="ct">${Math.min(it.have, it.need)}/${it.need}</span></div>`).join('')}</div>
        <div class="ord-reward">🪙${c.coins}　✨${c.xp} XP${c.bonus ? `<br>🎁 ${c.bonus}` : ''}</div>
        ${c.done ? '<div class="stamp">完成</div>' : `<div class="ord-btns"><button class="btn ${c.canDeliver ? '' : 'off'}" data-oid="${c.id}" data-kind="deliver">交貨</button>${c.cafe ? '' : `<button class="btn ghost small" data-oid="${c.id}" data-kind="skip">換一張</button>`}</div>`}
      </div>`).join('');
    const box = $('.orders', p);
    if (box.innerHTML !== html) box.innerHTML = html;
    p.classList.remove('hidden');
    this.ordersOpen = true;
  }

  closeOrders(): void { $('#orders-panel').classList.add('hidden'); this.ordersOpen = false; }

  // ---------- 確認視窗、信件 ----------
  confirm(title: string, body: string, ok = '確定'): Promise<boolean> {
    const p = $('#confirm-panel');
    $('.cf-title', p).textContent = title;
    $('.cf-body', p).innerHTML = body;
    $('.cf-ok', p).textContent = ok;
    p.classList.remove('hidden');
    return new Promise((resolve) => {
      const done = (v: boolean) => { p.classList.add('hidden'); okBtn.onclick = null; cancel.onclick = null; resolve(v); };
      const okBtn = $('.cf-ok', p), cancel = $('.close', p);
      okBtn.onclick = () => done(true);
      cancel.onclick = () => done(false);
    });
  }

  letter(html: string, ok: string): Promise<void> {
    const p = $('#letter-panel');
    $('.lt-body', p).innerHTML = html;
    $('.lt-ok', p).textContent = ok;
    p.classList.remove('hidden');
    return new Promise((resolve) => { $('.lt-ok', p).onclick = () => { p.classList.add('hidden'); resolve(); }; });
  }

  levelUp(level: number, unlocks: string[]): void {
    const el = $('#levelup');
    el.innerHTML = `<div class="lv-card"><div class="lv-title">升級！</div><div class="lv-num">Lv ${level}</div>${unlocks.length ? `<div class="lv-unlocks">${unlocks.map((u) => `<span>${u}</span>`).join('')}</div>` : ''}</div>`;
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;
    el.classList.add('show');
    window.setTimeout(() => el.classList.add('hidden'), 2600);
  }

  combo(n: number, x: number, y: number): void {
    const el = $('#combo');
    el.textContent = `×${n} 連擊！`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}
