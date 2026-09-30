import * as THREE from 'three';

// 物件頭上的提示泡泡（emoji 貼圖快取）：牛、郵筒、堆肥桶、施工中的房子共用
const cache = new Map<string, THREE.Texture>();

export function bubbleTexture(emoji: string): THREE.Texture {
  let t = cache.get(emoji);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(0,0,0,0.12)';
  c.beginPath(); c.arc(66, 62, 50, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fffaf0';
  c.beginPath(); c.arc(64, 58, 50, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(52, 100); c.lineTo(64, 124); c.lineTo(76, 100); c.fill();
  c.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(emoji, 64, 62);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(emoji, t);
  return t;
}

export class Bubble {
  sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, depthTest: false }));
  private emoji: string | null = null;

  constructor(parent: THREE.Object3D, private y: number, size = 0.62) {
    this.sprite.scale.setScalar(size);
    this.sprite.position.y = y;
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
    parent.add(this.sprite);
  }

  set(emoji: string | null): void {
    if (emoji === this.emoji) return;
    this.emoji = emoji;
    this.sprite.visible = !!emoji;
    if (emoji) {
      const m = this.sprite.material as THREE.SpriteMaterial;
      m.map = bubbleTexture(emoji);
      m.needsUpdate = true;
    }
  }

  update(t: number): void {
    if (this.sprite.visible) this.sprite.position.y = this.y + Math.sin(t * 2.2) * 0.06;
  }
}
