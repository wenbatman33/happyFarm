import * as THREE from 'three';

// 浮動文字（+XP、+金幣）與「飛進背包」的圖示
interface Floater { el: HTMLElement; pos: THREE.Vector3; t: number; life: number }

export class ScreenFx {
  private layer: HTMLElement;
  private floaters: Floater[] = [];
  private v = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    this.layer = document.createElement('div');
    this.layer.id = 'fx';
    document.body.appendChild(this.layer);
  }

  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    this.v.copy(p).project(this.camera);
    return { x: (this.v.x * 0.5 + 0.5) * window.innerWidth, y: (-this.v.y * 0.5 + 0.5) * window.innerHeight, visible: this.v.z < 1 };
  }

  float(pos: THREE.Vector3, text: string, cls = 'xp', delay = 0): void {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: -delay, life: 1.1 });
  }

  fly(from: THREE.Vector3, emoji: string, to: HTMLElement): void {
    const a = this.project(from);
    const r = to.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'flyer';
    el.textContent = emoji;
    el.style.left = `${a.x}px`;
    el.style.top = `${a.y}px`;
    this.layer.appendChild(el);
    const dx = r.left + r.width / 2 - a.x, dy = r.top + r.height / 2 - a.y;
    // 先往上彈，再飛進背包
    el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(0.6)' },
        { transform: `translate(calc(-50% + ${dx * 0.1}px), calc(-50% - 60px)) scale(1.3)`, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5)` },
      ],
      { duration: 850, easing: 'cubic-bezier(.5,0,.6,1)' },
    ).onfinish = () => {
      el.remove();
      to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 250 });
    };
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t < 0) { f.el.style.opacity = '0'; continue; }
      const u = f.t / f.life;
      if (u >= 1) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      const s = this.project(f.pos);
      f.el.style.left = `${s.x}px`;
      f.el.style.top = `${s.y - 20 - u * 50}px`;
      f.el.style.opacity = String(u > 0.7 ? (1 - u) / 0.3 : 1);
      f.el.style.transform = `translate(-50%,-50%) scale(${u < 0.15 ? 0.6 + u * 3 : 1})`;
    }
  }
}
