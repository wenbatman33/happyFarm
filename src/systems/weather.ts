import * as THREE from 'three';
import { dayKey, type Season } from '../core/clock';
import { hashStr, mulberry32 } from '../core/rng';

export type Weather = 'sunny' | 'cloudy' | 'rain' | 'snow';
export const WEATHER_ICON: Record<Weather, string> = { sunny: '☀️', cloudy: '⛅', rain: '🌧️', snow: '❄️' };
export const WEATHER_OVERCAST: Record<Weather, number> = { sunny: 0, cloudy: 0.35, rain: 0.85, snow: 0.5 };

// 各季機率（docs/04 §6），以「日期＋6 小時區段」當種子：所有玩家同一時段天氣相同
const TABLE: Record<Season, [Weather, number][]> = {
  spring: [['sunny', 0.5], ['cloudy', 0.25], ['rain', 0.25]],
  summer: [['sunny', 0.6], ['cloudy', 0.15], ['rain', 0.25]],
  autumn: [['sunny', 0.62], ['cloudy', 0.28], ['rain', 0.1]],
  winter: [['sunny', 0.4], ['cloudy', 0.25], ['snow', 0.35]],
};

export function weatherAt(t: number, season: Season): Weather {
  const block = Math.floor(new Date(t).getHours() / 6);
  const r = mulberry32(hashStr(`${dayKey(t)}#${block}`))();
  let acc = 0;
  for (const [w, p] of TABLE[season]) { acc += p; if (r < acc) return w; }
  return 'sunny';
}

// 雨、雪的畫面：跟著鏡頭的粒子盒
export class WeatherFx {
  private rain: THREE.InstancedMesh;
  private snow: THREE.InstancedMesh;
  private pos: Float32Array;
  private n = 700;
  private m = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.55 }), this.n);
    this.snow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), this.n);
    this.rain.frustumCulled = this.snow.frustumCulled = false;
    this.rain.visible = this.snow.visible = false;
    this.pos = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 36;
      this.pos[i * 3 + 1] = Math.random() * 18;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * 36;
    }
    scene.add(this.rain, this.snow);
  }

  update(dt: number, w: Weather, center: THREE.Vector3): void {
    this.rain.visible = w === 'rain';
    this.snow.visible = w === 'snow';
    const im = w === 'rain' ? this.rain : w === 'snow' ? this.snow : null;
    if (!im) return;
    const fall = w === 'rain' ? 16 : 1.4;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.n; i++) {
      let y = this.pos[i * 3 + 1] - fall * dt;
      if (y < 0) y += 18;
      this.pos[i * 3 + 1] = y;
      const sway = w === 'snow' ? Math.sin(t + i) * 0.4 : 0;
      this.m.makeTranslation(center.x + this.pos[i * 3] + sway, y, center.z + this.pos[i * 3 + 2]);
      im.setMatrixAt(i, this.m);
    }
    im.instanceMatrix.needsUpdate = true;
  }
}
