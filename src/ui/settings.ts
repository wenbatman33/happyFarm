import { clock } from '../core/clock';
import { sfx } from '../core/audio';
import { SAVE_KEY, type Settings } from '../systems/state';
import { Sheet } from './sheet';
import type { Game } from '../game';

// 設定：音效音樂、畫質、南半球、偷菜開關、通知；存檔匯出匯入（存檔碼、檔案）、雲端存檔
const b64 = {
  enc: (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// 存檔碼：HF1:（gzip）或 HF0:（沒有壓縮）＋ base64
export async function encodeSave(json: string): Promise<string> {
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') return `HF1:${b64.enc(await pipe(raw, new CompressionStream('gzip')))}`;
  return `HF0:${b64.enc(raw)}`;
}

export async function decodeSave(code: string): Promise<string> {
  const c = code.trim().replace(/\s+/g, '');
  if (c.startsWith('{')) return c;
  const body = b64.dec(c.slice(4));
  if (c.startsWith('HF1:')) return new TextDecoder().decode(await pipe(body, new DecompressionStream('gzip')));
  if (c.startsWith('HF0:')) return new TextDecoder().decode(body);
  throw new Error('這不是暖暖農場的存檔碼');
}

export class SettingsPanel {
  sheet = new Sheet('settings-panel', '⚙️ 設定');
  private code = '';
  private msg = '';

  constructor(private game: Game) {
    this.sheet.onAction = (a, el) => void this.act(a, el);
  }

  get s(): Settings { return this.game.state.data.settings; }

  open(): void {
    sfx.paper();
    this.code = '';
    this.msg = '';
    this.sheet.show();
    this.render();
  }

  // 套用設定到遊戲（開局與每次切換時）
  apply(): void {
    const s = this.s;
    const g = this.game;
    g.music.musicOn = s.music;
    g.music.ambienceOn = s.ambience;
    if (clock.south !== s.south) { clock.south = s.south; }
    if (s.quality !== 'auto' && g.stage.quality !== s.quality) g.stage.setQuality(s.quality);
  }

  private toggle(key: keyof Settings, label: string, sub: string): string {
    const on = this.s[key] as boolean;
    return `<div class="set-row"><div><b>${label}</b><small>${sub}</small></div><button class="tog ${on ? 'on' : ''}" data-a="tog:${key}"><i></i></button></div>`;
  }

  render(): void {
    const g = this.game;
    const s = this.s;
    const cloud = g.social.backend.mode === 'supabase';
    const user = g.social.backend.user?.();
    const q = (v: Settings['quality'], l: string) => `<button data-a="q:${v}" class="${s.quality === v ? 'on' : ''}">${l}</button>`;
    const html = `
      <div class="jn-sec">🔊 聲音</div>
      <div class="set-row"><div><b>音效</b><small>M 鍵也可以切換</small></div><button class="tog ${sfx.muted ? '' : 'on'}" data-a="mute"><i></i></button></div>
      ${this.toggle('music', '背景音樂', '五聲音階的輕音樂，白天明亮、晚上安靜')}
      ${this.toggle('ambience', '環境音', '鳥叫、蟲鳴、雨聲')}
      ${this.toggle('haptics', '手機震動', '拔草、割草時輕輕震一下')}
      <div class="jn-sec">🖥️ 畫面</div>
      <div class="set-row"><div><b>畫質</b><small>目前：${g.stage.quality}</small></div><div class="seg">${q('auto', '自動')}${q('low', '低')}${q('medium', '中')}${q('high', '高')}</div></div>
      ${this.toggle('south', '南半球', '季節對調（例如 12 月是夏天）')}
      <div class="jn-sec">👥 社交</div>
      ${this.toggle('allowSteal', '允許好友偷菜', '關掉後好友不能偷你的菜（懷舊玩法）')}
      ${this.toggle('notify', '作物成熟通知', '分頁開著但在背景時提醒你（需要允許通知）')}
      <div class="jn-sec">📲 安裝</div>
      ${matchMedia('(display-mode: standalone)').matches ? '<div class="set-note">✅ 已經是安裝版了（從主畫面開啟）</div>' : (window as unknown as { installPrompt?: Event }).installPrompt ? '<div class="set-btns"><button class="btn small" data-a="install">📲 安裝到主畫面</button></div><div class="set-note">安裝後像 App 一樣全螢幕、離線也能玩，存檔也比較不會被瀏覽器清掉。</div>' : '<div class="set-note">iPhone／iPad：用 Safari 按「分享」→「加入主畫面」。安裝後全螢幕、離線也能玩，存檔也比較不會被清掉。</div>'}
      <div class="jn-sec">💾 存檔</div>
      <div class="set-note">存檔放在這個瀏覽器裡。換手機、清除瀏覽資料之前，記得先匯出存檔碼或下載存檔檔案。${cloud ? '' : '（雲端存檔要等後端上線後才能用）'}</div>
      <div class="set-btns">
        <button class="btn small" data-a="export">📋 產生存檔碼</button>
        <button class="btn small ghost" data-a="download">⬇️ 下載存檔檔案</button>
        <button class="btn small ghost" data-a="upload">⬆️ 讀取存檔檔案</button>
      </div>
      <textarea class="set-code" placeholder="貼上存檔碼後按「匯入存檔碼」" spellcheck="false">${this.code}</textarea>
      <div class="set-btns"><button class="btn small ghost" data-a="copy">複製</button><button class="btn small ghost" data-a="import">匯入存檔碼</button></div>
      ${cloud ? `<div class="jn-sec">☁️ 雲端存檔</div>${user ? `<div class="set-note">已登入：${user.email}</div><div class="set-btns"><button class="btn small" data-a="cloud-up">上傳到雲端</button><button class="btn small ghost" data-a="cloud-down">從雲端下載</button><button class="btn small ghost" data-a="signout">登出</button></div>` : `<div class="set-btns"><input class="set-email" type="email" placeholder="你的 Email"><button class="btn small" data-a="signin">寄登入連結</button></div>`}` : ''}
      ${this.msg ? `<div class="set-msg">${this.msg}</div>` : ''}
      <div class="jn-sec">⚠️ 危險區</div>
      <div class="set-btns"><button class="btn small ghost danger" data-a="reset">重新開始新遊戲</button></div>
      <div class="set-note">版本 ${__APP_VERSION__}</div>`;
    this.sheet.render(html);
  }

  private async act(a: string, el: HTMLElement) {
    const g = this.game;
    const s = this.s;
    const ta = this.sheet.el.querySelector<HTMLTextAreaElement>('.set-code');
    if (ta) this.code = ta.value;
    try {
      if (a === 'mute') { g.hud.onMute?.(); }
      else if (a === 'install') {
        const w = window as unknown as { installPrompt?: Event & { prompt: () => Promise<void> } };
        await w.installPrompt?.prompt();
        w.installPrompt = undefined;
      }
      else if (a.startsWith('tog:')) {
        const k = a.slice(4) as keyof Settings;
        (s as unknown as Record<string, boolean>)[k] = !s[k];
        if (k === 'notify' && s.notify && 'Notification' in window && Notification.permission !== 'granted') {
          const p = await Notification.requestPermission();
          if (p !== 'granted') { s.notify = false; this.msg = '瀏覽器沒有允許通知'; }
        }
        if (k === 'south') { g.hud.toast(s.south ? '🌏 切換到南半球：季節對調' : '🌏 切換回北半球', 2400); }
        this.apply();
      } else if (a.startsWith('q:')) {
        s.quality = a.slice(2) as Settings['quality'];
        if (s.quality !== 'auto') g.stage.setQuality(s.quality);
        this.apply();
      } else if (a === 'export') {
        g.state.save();
        this.code = await encodeSave(localStorage.getItem(SAVE_KEY) ?? '');
        this.msg = `✅ 存檔碼產生好了（${this.code.length.toLocaleString()} 字），複製起來存在安全的地方`;
      } else if (a === 'copy') {
        if (!this.code) return;
        await navigator.clipboard.writeText(this.code);
        this.msg = '✅ 已複製';
      } else if (a === 'download') {
        g.state.save();
        const blob = new Blob([localStorage.getItem(SAVE_KEY) ?? ''], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const d = new Date();
        link.href = url;
        link.download = `happyfarm-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.msg = '✅ 已下載存檔檔案';
      } else if (a === 'upload') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json,text/plain';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          await this.load(await f.text());
        };
        input.click();
        return;
      } else if (a === 'import') {
        if (!this.code.trim()) { this.msg = '請先貼上存檔碼'; }
        else await this.load(await decodeSave(this.code));
        return;
      } else if (a === 'signin') {
        const email = this.sheet.el.querySelector<HTMLInputElement>('.set-email')?.value.trim() ?? '';
        if (!email.includes('@')) { this.msg = '請輸入 Email'; }
        else { await g.social.backend.signIn?.(email); this.msg = `📧 登入連結寄到 ${email} 了，到信箱點連結就會回到遊戲`; }
      } else if (a === 'signout') { await g.social.backend.signOut?.(); this.msg = '已登出'; }
      else if (a === 'cloud-up') { g.state.save(); await g.social.backend.uploadSave?.(localStorage.getItem(SAVE_KEY) ?? ''); this.msg = '☁️ 已上傳到雲端'; }
      else if (a === 'cloud-down') {
        const json = await g.social.backend.downloadSave?.();
        if (!json) this.msg = '雲端上還沒有存檔';
        else { await this.load(json); return; }
      } else if (a === 'reset') {
        const ok = await g.hud.confirm('⚠️ 重新開始', '目前的農場會<b>全部清除</b>，而且沒辦法復原。<br>建議先匯出存檔碼。確定要重新開始嗎？', '清除並重新開始');
        if (ok) { g.state.reset(); window.onbeforeunload = null; g.state.frozen = true; location.reload(); }
        return;
      }
    } catch (e) {
      this.msg = `❌ ${(e as Error).message}`;
    }
    void el;
    g.state.save();
    this.render();
  }

  // 讀入存檔：先檢查格式，確認後覆蓋並重新載入
  private async load(json: string) {
    const g = this.game;
    let d: { v?: number; plots?: unknown[]; level?: number; coins?: number };
    try { d = JSON.parse(json); } catch { this.msg = '❌ 存檔內容壞掉了'; this.render(); return; }
    if (!d || !d.v || !Array.isArray(d.plots)) { this.msg = '❌ 這不是暖暖農場的存檔'; this.render(); return; }
    const ok = await g.hud.confirm('💾 讀取存檔', `要用這個存檔（Lv${d.level}、🪙${(d.coins ?? 0).toLocaleString()}）<b>取代</b>現在的農場嗎？`, '讀取');
    if (!ok) return;
    g.state.frozen = true;
    localStorage.setItem(SAVE_KEY, json);
    location.reload();
  }
}
