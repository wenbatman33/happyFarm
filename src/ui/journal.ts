import { ALMANAC } from '../data/almanac';
import { ACHIEVEMENTS, TIER_STARS, TIERS, taskDef, tierReward, type ProgSave } from '../systems/progress';
import type { SaveData } from '../systems/state';
import type { Season } from '../core/clock';

// 農場手帳：任務／季節手帳／圖鑑／成就
export type JournalTab = 'tasks' | 'season' | 'almanac' | 'ach';

export class JournalUI {
  private root: HTMLElement;
  private tab: JournalTab = 'tasks';
  open = false;
  onClaimTask?: (id: string) => void;
  onClaimTier?: (i: number) => void;
  private last = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'journal';
    this.root.className = 'panel hidden';
    this.root.innerHTML = `<div class="panel-card journal-card">
      <div class="jn-head"><h3>📔 農場手帳</h3><button class="btn ghost small close">關閉</button></div>
      <div class="jn-tabs">
        <button data-tab="tasks">📋 任務</button><button data-tab="season">⭐ 季節手帳</button><button data-tab="almanac">📖 圖鑑</button><button data-tab="ach">🏆 成就</button>
      </div>
      <div class="jn-body"></div></div>`;
    document.body.appendChild(this.root);
    this.root.querySelector<HTMLElement>('.close')!.onclick = () => this.close();
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === this.root) { this.close(); return; }
      const tb = el.closest<HTMLElement>('[data-tab]');
      if (tb) { this.tab = tb.dataset.tab as JournalTab; this.last = ''; this.onRender?.(); return; }
      const ct = el.closest<HTMLElement>('[data-claim-task]');
      if (ct) { this.onClaimTask?.(ct.dataset.claimTask!); return; }
      const cr = el.closest<HTMLElement>('[data-claim-tier]');
      if (cr) this.onClaimTier?.(Number(cr.dataset.claimTier));
    });
  }

  onRender?: () => void;

  show(tab?: JournalTab): void {
    if (tab) this.tab = tab;
    this.open = true;
    this.last = '';
    this.root.classList.remove('hidden');
  }

  close(): void { this.open = false; this.root.classList.add('hidden'); }

  render(d: SaveData, season: Season, now: number): void {
    if (!this.open) return;
    const p = d.prog;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    let html = '';
    if (this.tab === 'tasks') html = this.tasks(p, now);
    else if (this.tab === 'season') html = this.season(p, season);
    else if (this.tab === 'almanac') html = this.almanac(p);
    else html = this.achievements(d);
    if (html === this.last) return;
    this.last = html;
    this.root.querySelector<HTMLElement>('.jn-body')!.innerHTML = html;
  }

  private taskRow(t: { id: string; got: number; claimed: boolean }, stars: number): string {
    const def = taskDef(t.id)!;
    const done = t.got >= def.n;
    return `<div class="jn-task ${t.claimed ? 'claimed' : ''}">
      <div class="jn-tl"><b>${def.label}</b><div class="jn-bar"><i style="width:${Math.min(100, (t.got / def.n) * 100)}%"></i><span>${t.got.toLocaleString()} / ${def.n.toLocaleString()}</span></div></div>
      ${t.claimed ? '<span class="jn-ok">✔</span>' : `<button class="btn small ${done ? '' : 'off'}" ${done ? `data-claim-task="${t.id}"` : ''}>⭐${stars}</button>`}
    </div>`;
  }

  private tasks(p: ProgSave, now: number): string {
    const d = new Date(now);
    const hoursLeft = 24 - d.getHours();
    return `<div class="jn-sec">☀️ 每日任務 <small>${hoursLeft} 小時後換新 · 全部完成再 +10⭐</small></div>${p.daily.map((t) => this.taskRow(t, 10)).join('')}
      <div class="jn-sec">📅 每週挑戰 <small>每週一換新</small></div>${p.weekly.map((t) => this.taskRow(t, 30)).join('')}`;
  }

  private season(p: ProgSave, season: Season): string {
    const label = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[season];
    const tier = Math.min(TIERS, Math.floor(p.stars / TIER_STARS));
    const cells = Array.from({ length: TIERS }, (_, k) => {
      const i = k + 1;
      const r = tierReward(i, season);
      const claimed = p.tiers.includes(i);
      const ready = !claimed && p.stars >= i * TIER_STARS;
      const special = i % 10 === 0;
      return `<button class="jn-tier ${claimed ? 'claimed' : ready ? 'ready' : 'locked'} ${special ? 'special' : ''}" ${ready ? `data-claim-tier="${i}"` : ''}>
        <small>${i}</small><span class="em">${r.emoji}</span><span class="lb">${r.label}</span>${claimed ? '<i>✔</i>' : ''}</button>`;
    }).join('');
    return `<div class="jn-season"><div><b>${label}季手帳</b>　⭐ ${p.stars.toLocaleString()} 季節星 · 第 ${tier} / ${TIERS} 階</div>
      <div class="jn-bar big"><i style="width:${Math.min(100, ((p.stars % TIER_STARS) / TIER_STARS) * 100)}%"></i><span>下一階還要 ${TIER_STARS - (p.stars % TIER_STARS)} ⭐</span></div>
      <small>季節星從每日任務、每週挑戰取得。第 10、20、30 階是本季限定獎勵。</small></div>
      <div class="jn-tiers">${cells}</div>`;
  }

  private almanac(p: ProgSave): string {
    const cats = [...new Set(ALMANAC.map((e) => e.cat))];
    const got = ALMANAC.filter((e) => p.almanac[e.id]).length;
    return `<div class="jn-season"><b>📖 已收集 ${got} / ${ALMANAC.length}</b><div class="jn-bar big"><i style="width:${(got / ALMANAC.length) * 100}%"></i></div><small>有些要等到其他季節才遇得到，一年四季都來看看吧！</small></div>` +
      cats.map((c) => `<div class="jn-sec">${c}</div><div class="jn-grid">${ALMANAC.filter((e) => e.cat === c).map((e) => {
        const a = p.almanac[e.id];
        if (!a) return `<div class="jn-card unknown"><span class="em">❔</span><b>？？？</b><small>${e.hint}</small></div>`;
        const stars = `${a.q & 2 ? '⭐' : ''}${a.q & 4 ? '🌟' : ''}`;
        return `<div class="jn-card"><span class="em">${e.emoji}</span><b>${e.name}</b><small>×${a.n} ${stars}</small></div>`;
      }).join('')}</div>`).join('');
  }

  private achievements(d: SaveData): string {
    const p = d.prog;
    return `<div class="jn-season"><b>🏆 ${p.ach.length} / ${ACHIEVEMENTS.length}</b>${p.title ? `　目前稱號：<b>${p.title}</b>` : ''}</div>` +
      ACHIEVEMENTS.map((a) => {
        const v = Math.min(a.n, a.check(d));
        const done = p.ach.includes(a.id);
        return `<div class="jn-task ${done ? 'claimed' : ''}"><div class="jn-tl"><b>${done ? '🏆' : '🔒'} ${a.name}</b> <small>${a.desc} · 🪙${a.coins}</small>
          <div class="jn-bar"><i style="width:${(v / a.n) * 100}%"></i><span>${v.toLocaleString()} / ${a.n.toLocaleString()}</span></div></div>${done ? '<span class="jn-ok">✔</span>' : ''}</div>`;
      }).join('');
  }
}
