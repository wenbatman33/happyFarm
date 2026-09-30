import { Game } from './game';
import { clock } from './core/clock';
import { sfx } from './core/audio';

// DEV 工具只在開發模式或網址加 ?dev=1 時載入（正式版不會下載）
const devEnabled = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

async function boot() {
  let game: Game;
  if (devEnabled) {
    const { DevTools } = await import('./dev/devtools');
    const persisted = DevTools.applyPersisted();
    game = new Game(document.getElementById('app')!);
    new DevTools(game, persisted);
  } else {
    game = new Game(document.getElementById('app')!);
  }
  (window as unknown as { game: Game }).game = game;
  if (devEnabled) Object.assign(window, { clock, sfx });
  const ld = document.getElementById('loading');
  window.setTimeout(() => { ld?.classList.add('done'); window.setTimeout(() => ld?.remove(), 600); }, 300);
}

void boot();

// PWA：正式版註冊 Service Worker（離線可玩）；記下「安裝到主畫面」的提示事件給設定頁用
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[PWA] Service Worker 註冊失敗', e)));
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { installPrompt: Event }).installPrompt = e;
});
