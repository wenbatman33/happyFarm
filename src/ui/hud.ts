import type { HudKey, Layout } from '../config/layout';
import type { CropDef } from '../data/crops';
import { MILK_SELL, xpNext } from '../data/economy';
import type { CowAct, CowMenuItem } from '../systems/ranch';
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
};

export class Hud {
  root: HTMLElement;
  private els = {} as Record<HudKey, HTMLElement>;
  private toastTimer = 0;
  private hintText = '';
  onSeed?: (id: string) => void;
  onBag?: () => void;
  onPet?: () => void;
  onMute?: () => void;
  onSell?: () => void;
  onMow?: () => void;
  onCowAct?: (act: CowAct) => void;
  private cowMenu!: HTMLElement;
  cowMenuOpen = false;

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
      </div>
      <div class="hud-el" data-hud="toolbar"><div class="seeds"></div></div>
      <div class="hud-el" data-hud="bag">
        <button class="round-btn mow-btn" title="除草機 (R)"><span>🚜</span></button>
        <button class="round-btn pet-btn" title="麻糬"><span>🐶</span><i class="bond"></i></button>
        <button class="round-btn bag-btn" title="背包 (B)"><span>🎒</span><i class="badge hidden">0</i></button>
      </div>
      <div class="hud-el" data-hud="queue"><div class="queue"></div></div>
      <div class="hud-el" data-hud="toast"><div class="toast hidden"></div></div>
    `;
    document.body.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('.hud-el').forEach((el) => (this.els[el.dataset.hud as HudKey] = el));
    $('.bag-btn', this.root).onclick = () => this.onBag?.();
    $('.pet-btn', this.root).onclick = () => this.onPet?.();
    $('.mute', this.root).onclick = () => this.onMute?.();
    $('.mow-btn', this.root).onclick = () => this.onMow?.();

    const panel = document.createElement('div');
    panel.id = 'bag-panel';
    panel.className = 'panel hidden';
    panel.innerHTML = `<div class="panel-card"><h3>🎒 背包</h3><div class="items"></div>
      <div class="panel-actions"><button class="btn sell">全部賣出</button><button class="btn ghost close">關閉</button></div></div>`;
    document.body.appendChild(panel);
    $('.close', panel).onclick = () => panel.classList.add('hidden');
    panel.onclick = (e) => { if (e.target === panel) panel.classList.add('hidden'); };
    $('.sell', panel).onclick = () => this.onSell?.();

    const lv = document.createElement('div');
    lv.id = 'levelup';
    lv.className = 'hidden';
    document.body.appendChild(lv);

    const combo = document.createElement('div');
    combo.id = 'combo';
    document.body.appendChild(combo);

    this.cowMenu = document.createElement('div');
    this.cowMenu.id = 'cow-menu';
    this.cowMenu.className = 'hidden';
    this.cowMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.cowMenu.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!b || b.classList.contains('off')) return;
      this.hideCowMenu();
      this.onCowAct?.(b.dataset.act as CowAct);
    };
    document.body.appendChild(this.cowMenu);
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
    $('.lv', this.root).textContent = `Lv ${level}`;
    ($('.xpfill', this.root) as HTMLElement).style.width = `${Math.min(100, (xp / need) * 100)}%`;
    $('.xptext', this.root).textContent = `${Math.floor(xp).toLocaleString()} / ${need.toLocaleString()}`;
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

  // 牛隻照顧選單：跟著牛頭在畫面上的位置
  showCowMenu(m: { title: string; sub: string; items: CowMenuItem[] }): void {
    const html = `<div class="cm-title">${m.title}</div><div class="cm-sub">${m.sub}</div>` +
      m.items.map((it) => `<button data-act="${it.act}" class="${it.enabled ? '' : 'off'}"><span class="em">${it.emoji}</span><span class="lb">${it.label}</span><span class="nt">${it.note}</span></button>`).join('');
    if (this.cowMenu.innerHTML !== html) this.cowMenu.innerHTML = html;
    if (!this.cowMenuOpen) {
      this.cowMenu.classList.remove('hidden', 'pop');
      void this.cowMenu.offsetWidth;
      this.cowMenu.classList.add('pop');
    }
    this.cowMenuOpen = true;
  }

  moveCowMenu(x: number, y: number): void {
    this.cowMenu.style.left = `${Math.max(130, Math.min(window.innerWidth - 130, x))}px`;
    this.cowMenu.style.top = `${Math.max(200, y)}px`;
  }

  hideCowMenu(): void {
    this.cowMenuOpen = false;
    this.cowMenu.classList.add('hidden');
  }

  setMower(on: boolean): void { $('.mow-btn', this.root).classList.toggle('on', on); }

  setMute(m: boolean): void { $('.mute', this.root).textContent = m ? '🔇' : '🔊'; }

  setSeeds(crops: CropDef[], selected: string, level: number, season: Season): void {
    const box = $('.seeds', this.root);
    if (!box.childElementCount) {
      crops.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'seed';
        b.dataset.id = c.id;
        b.innerHTML = `<span class="em">${c.emoji}</span><span class="nm">${c.name}</span><span class="pr">🪙${c.seed}</span><span class="key">${i + 1}</span><span class="lock"></span>`;
        b.onclick = () => this.onSeed?.(c.id);
        box.appendChild(b);
      });
    }
    crops.forEach((c) => {
      const b = box.querySelector<HTMLElement>(`[data-id="${c.id}"]`)!;
      const lockedLv = level < c.unlock;
      const offSeason = c.season !== 'all' && c.season !== season;
      b.classList.toggle('sel', c.id === selected);
      b.classList.toggle('locked', lockedLv || offSeason);
      b.querySelector('.lock')!.textContent = lockedLv ? `Lv${c.unlock}` : offSeason ? `${SEASON_LABEL[c.season as Season]}季` : '';
    });
  }

  setPet(bondLv: number, touchesLeft: number): void {
    $('.bond', this.root).textContent = `♥${bondLv}`;
    $('.pet-btn', this.root).classList.toggle('glow', touchesLeft > 0);
  }

  setBagCount(n: number): void {
    const b = $('.badge', this.root);
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
