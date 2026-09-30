// 通用面板：標題列＋內容區；內容裡有 data-a="動作" 的元素被點時觸發 onAction（有 .off 的不觸發）
// 工具升級、溫室、家具店、節慶商店、市集、好友、設定都用這個
export class Sheet {
  root: HTMLElement;
  open = false;
  onAction?: (act: string, el: HTMLElement) => void;
  onClose?: () => void;
  private body: HTMLElement;
  private title: HTMLElement;
  private last = '';

  constructor(id: string, title: string, wide = true) {
    this.root = document.createElement('div');
    this.root.id = id;
    this.root.className = 'panel hidden';
    this.root.innerHTML = `<div class="panel-card ${wide ? 'journal-card' : ''} sheet-card">
      <div class="jn-head"><h3 class="sh-title"></h3><button class="btn ghost small close">關閉</button></div>
      <div class="sh-body"></div></div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.sh-body')!;
    this.title = this.root.querySelector<HTMLElement>('.sh-title')!;
    this.title.textContent = title;
    this.root.querySelector<HTMLElement>('.close')!.onclick = () => this.close();
    this.root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === this.root) { this.close(); return; }
      const a = el.closest<HTMLElement>('[data-a]');
      if (a && !a.classList.contains('off')) this.onAction?.(a.dataset.a!, a);
    });
    // 面板裡的輸入框不要把按鍵傳給遊戲
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setTitle(t: string): void { if (this.title.textContent !== t) this.title.textContent = t; }

  show(): void {
    this.open = true;
    this.last = '';
    this.root.classList.remove('hidden');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  // 內容沒變就不重畫（保留捲動位置與輸入框焦點）
  render(html: string): void {
    if (!this.open || html === this.last) return;
    this.last = html;
    const y = this.body.scrollTop;
    this.body.innerHTML = html;
    this.body.scrollTop = y;
  }

  get el(): HTMLElement { return this.body; }
}

// 小工具：一列「圖示＋名稱＋說明＋按鈕」
export const row = (emoji: string, title: string, sub: string, btn: string, act: string | null, extraCls = ''): string =>
  `<div class="ws-recipe ${extraCls}"><span class="em">${emoji}</span><div class="ws-info"><b>${title}</b><div class="ws-in2">${sub}</div></div>` +
  (btn ? `<button class="btn small ${act ? '' : 'off'}" ${act ? `data-a="${act}"` : ''}>${btn}</button>` : '') + '</div>';
