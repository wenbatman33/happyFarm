import * as THREE from 'three';
import { GEO } from './materials';

// 簡易粒子池：泥土、草屑、水滴、閃光、愛心、落葉、雪
export type ParticleKind = 'dirt' | 'grass' | 'water' | 'sparkle' | 'heart' | 'leaf' | 'snow' | 'seed' | 'fluff' | 'zzz' | 'milk' | 'hay';

interface P {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  spin: THREE.Vector3;
  size: number;
  sprite: boolean;
}

function spriteTex(draw: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const heartTex = spriteTex((c) => {
  c.fillStyle = '#ff5c8a';
  c.beginPath();
  c.moveTo(32, 56);
  c.bezierCurveTo(4, 36, 6, 8, 32, 20);
  c.bezierCurveTo(58, 8, 60, 36, 32, 56);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.beginPath();
  c.ellipse(20, 24, 6, 4, -0.6, 0, Math.PI * 2);
  c.fill();
});
const starTex = spriteTex((c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,230,120,0.9)');
  g.addColorStop(1, 'rgba(255,200,80,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#fffbe0';
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? 7 : 30;
    const a = (i / 8) * Math.PI * 2;
    c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  c.fill();
});
const zTex = spriteTex((c) => {
  c.fillStyle = '#ffffff';
  c.font = 'bold 44px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('Z', 32, 34);
});

const mats = {
  dirt: new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 1 }),
  grass: new THREE.MeshStandardMaterial({ color: '#6cbf45', roughness: 0.8 }),
  water: new THREE.MeshStandardMaterial({ color: '#7fd0ff', roughness: 0.1, emissive: '#2a7fbf', emissiveIntensity: 0.3 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#f08a3c', roughness: 0.8 }),
  snow: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
  seed: new THREE.MeshStandardMaterial({ color: '#f1dfb0', roughness: 0.8 }),
  fluff: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.3 }),
  milk: new THREE.MeshStandardMaterial({ color: '#fffdf6', roughness: 0.2, emissive: '#fff8e8', emissiveIntensity: 0.25 }),
  hay: new THREE.MeshStandardMaterial({ color: '#e8c65a', roughness: 0.9 }),
  heart: new THREE.SpriteMaterial({ map: heartTex, depthWrite: false }),
  sparkle: new THREE.SpriteMaterial({ map: starTex, depthWrite: false, blending: THREE.AdditiveBlending }),
  zzz: new THREE.SpriteMaterial({ map: zTex, depthWrite: false, opacity: 0.85 }),
};

export class Particles {
  private live: P[] = [];
  private pools = new Map<ParticleKind, THREE.Object3D[]>();

  constructor(private scene: THREE.Scene) {}

  private take(kind: ParticleKind): { obj: THREE.Object3D; sprite: boolean } {
    const pool = this.pools.get(kind) ?? [];
    this.pools.set(kind, pool);
    const sprite = kind === 'heart' || kind === 'sparkle' || kind === 'zzz';
    let obj = pool.pop();
    if (!obj) {
      if (sprite) obj = new THREE.Sprite(mats[kind as 'heart']);
      else {
        const geo = kind === 'grass' || kind === 'leaf' || kind === 'hay' ? GEO.blade : GEO.sphereLo;
        const m = new THREE.Mesh(geo, mats[kind as 'dirt']);
        m.castShadow = false;
        obj = m;
      }
      obj.userData.kind = kind;
    }
    this.scene.add(obj);
    return { obj, sprite };
  }

  burst(kind: ParticleKind, at: THREE.Vector3, count: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number; dir?: THREE.Vector3 } = {}): void {
    const speed = opts.speed ?? 2;
    const up = opts.up ?? 3;
    for (let i = 0; i < count; i++) {
      const { obj, sprite } = this.take(kind);
      obj.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random() * 0.6), up * (0.6 + Math.random() * 0.6), Math.sin(a) * speed * (0.4 + Math.random() * 0.6));
      if (opts.dir) vel.addScaledVector(opts.dir, speed);
      const size = (opts.size ?? 0.12) * (0.7 + Math.random() * 0.6);
      obj.scale.setScalar(size);
      this.live.push({
        obj, vel, life: 0, max: (opts.life ?? 0.7) * (0.8 + Math.random() * 0.4),
        gravity: opts.gravity ?? (sprite ? -0.5 : 9),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        size, sprite,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        this.scene.remove(p.obj);
        this.pools.get(p.obj.userData.kind as ParticleKind)!.push(p.obj);
        this.live.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      if (p.sprite) p.vel.multiplyScalar(1 - dt * 1.5);
      p.obj.position.addScaledVector(p.vel, dt);
      if (!p.sprite && p.obj.position.y < 0.02) { p.obj.position.y = 0.02; p.vel.set(p.vel.x * 0.4, -p.vel.y * 0.3, p.vel.z * 0.4); }
      if (!p.sprite) p.obj.rotation.set(p.obj.rotation.x + p.spin.x * dt, p.obj.rotation.y + p.spin.y * dt, p.obj.rotation.z + p.spin.z * dt);
      // 前 15% 放大彈出、最後 30% 縮小消失（不用透明度，省效能）
      const k = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      p.obj.scale.setScalar(p.size * k);
    }
  }
}
