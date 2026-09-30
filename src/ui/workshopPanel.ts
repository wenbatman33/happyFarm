// 加工坊面板：上方是製作中的欄位，下方是食譜
type View = {
  capacity: number;
  slots: { emoji: string; name: string; left: number; prog: number }[];
  recipes: { id: string; emoji: string; name: string; sell: number; minutes: number; inputs: { emoji: string; name: string; have: number; need: number }[]; block: string | null; unlock: number }[];
};

const fmt = (ms: number) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} 時 ${m % 60} 分` : m > 0 ? `${m} 分` : '完成'; };

export class WorkshopPanel {
  private root: HTMLElement;
  private last = '';
  open = false;
  onCraft?: (id: string) => void;
  onCollect?: () => void;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'workshop';
    this.root.className = 'panel hidden';
    this.root.innerHTML = `<div class="panel-card journal-card">
      <div class="jn-head"><h3>🍞 加工坊</h3><button class="btn ghost small close">關閉</button></div>
      <div class="ws-body"></div></div>`;
    document.body.appendChild(this.root);
    this.root.querySelector<HTMLElement>('.close')!.onclick = () => this.close();
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === this.root) { this.close(); return; }
      const c = el.closest<HTMLElement>('[data-craft]');
      if (c && !c.classList.contains('off')) { this.onCraft?.(c.dataset.craft!); return; }
      if (el.closest('.ws-collect:not(.off)')) this.onCollect?.();
    });
  }

  show(): void { this.open = true; this.last = ''; this.root.classList.remove('hidden'); }
  close(): void { this.open = false; this.root.classList.add('hidden'); }

  render(v: View): void {
    if (!this.open) return;
    const ready = v.slots.filter((s) => s.left <= 0).length;
    const slots = Array.from({ length: v.capacity }, (_, i) => {
      const s = v.slots[i];
      if (!s) return '<div class="ws-slot empty">空欄位</div>';
      return `<div class="ws-slot ${s.left <= 0 ? 'done' : ''}"><span class="em">${s.emoji}</span><b>${s.name}</b><div class="jn-bar"><i style="width:${s.prog * 100}%"></i><span>${fmt(s.left)}</span></div></div>`;
    }).join('');
    const recipes = v.recipes.map((r) => `
      <div class="ws-recipe ${r.block && r.block.startsWith('Lv') ? 'locked' : ''}">
        <span class="em">${r.emoji}</span>
        <div class="ws-info"><b>${r.name}</b> <small>🪙${r.sell} · ${r.minutes >= 60 ? `${Math.round(r.minutes / 6) / 10} 小時` : `${r.minutes} 分`}</small>
          <div class="ws-in">${r.inputs.map((it) => `<span class="${it.have >= it.need ? 'ok' : ''}">${it.emoji}${it.name} ${Math.min(it.have, it.need)}/${it.need}</span>`).join('')}</div></div>
        <button class="btn small ${r.block ? 'off' : ''}" data-craft="${r.id}">${r.block ?? '製作'}</button>
      </div>`).join('');
    const html = `<div class="ws-slots">${slots}</div>
      <div class="ws-actions"><button class="btn small ws-collect ${ready ? '' : 'off'}">收取完成品 ${ready ? `×${ready}` : ''}</button></div>
      <div class="jn-sec">📜 食譜 <small>成品價值是原料的 1.8 倍</small></div>${recipes}`;
    if (html === this.last) return;
    this.last = html;
    this.root.querySelector<HTMLElement>('.ws-body')!.innerHTML = html;
  }
}
