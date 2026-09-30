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
