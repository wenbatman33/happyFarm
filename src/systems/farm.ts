import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropPlacement } from '../config/layout';
import { CROP_BY_ID, type CropDef } from '../data/crops';
import { plotPrice, plotsForLevel, rollQuality, type Quality } from '../data/economy';
import { easeOutBack } from '../core/rng';
import { buildCrop } from '../world/crops3d';
import { GEO, mat, mesh } from '../world/materials';
import type { GameState, PlotSave } from './state';

export const FIELD_COLS = 6;
export const FIELD_ROWS = 5;
export const FIELD_COUNT = FIELD_COLS * FIELD_ROWS;

// 解鎖順序：田區從左上角一圈圈長大（3×2 → 3×3 → 4×3 → 4×4 → 5×4 → 5×5 → 6×5）
export const UNLOCK_ORDER: number[] = (() => {
  const out: number[] = [];
  for (const [c, r] of [[3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5], [6, 5]]) {
    for (let row = 0; row < r; row++) for (let col = 0; col < c; col++) {
      const i = row * FIELD_COLS + col;
      if (!out.includes(i)) out.push(i);
    }
  }
  return out;
})();
export const STARTER_PLOTS = 6;

const DRY_RATE = 0.6;
const soilGeo = new RoundedBoxGeometry(0.92, 0.16, 0.92, 2, 0.06);
const grassGeo = new RoundedBoxGeometry(0.94, 0.05, 0.94, 2, 0.02);
const furrowGeo = new RoundedBoxGeometry(0.8, 0.03, 0.08, 1, 0.012);
const MAT = {
  soil: mat('#8c5a36', { roughness: 0.95 }),
  wet: mat('#5a371f', { roughness: 0.4 }),
  furrow: mat('#6e4428', { roughness: 1 }),
  furrowWet: mat('#43291a', { roughness: 0.5 }),
  plot: mat('#b3cf72', { roughness: 0.95 }),
  sale: mat('#c9d98a', { roughness: 0.95 }),
  locked: mat('#a4ad8c', { roughness: 0.95 }),
  sign: mat('#c89b62'),
  fert: mat('#f2c94c', { emissive: '#e0a020', emissiveIntensity: 0.6, roughness: 0.4 }),
  ring: new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.85, depthWrite: false }),
};

// 田地上方的小標籤（等級、價格）
const labelTex = new Map<string, THREE.Texture>();
function labelTexture(text: string, bg: string): THREE.Texture {
  const key = text + bg;
  let t = labelTex.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(4, 6, 152, 52, 26);
  c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 30px "Baloo 2","PingFang TC","Noto Sans TC",sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 80, 34);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  labelTex.set(key, t);
  return t;
}

interface PlotView {
  group: THREE.Group;
  grass: THREE.Mesh;
  soil: THREE.Group;
  sign: THREE.Group;
  label: THREE.Sprite;
  labelKey: string;
  fert: THREE.Group;
  crop: THREE.Group | null;
  stage: number;
  cropId: string | null;
  pop: number; // 生長階段改變時的彈跳動畫
  ring: THREE.Mesh;
  wet: boolean;
}

export type PlotStatus = 'locked' | 'debris' | 'forsale' | 'grass' | 'tilled' | 'growing' | 'dry' | 'mature';

export class Farm {
  root = new THREE.Group();
  private views: PlotView[] = [];
  queued = new Set<number>();
  hasDebris: (i: number) => boolean = () => false;

  constructor(parent: THREE.Object3D, private state: GameState, private place: PropPlacement) {
    parent.add(this.root);
    for (let i = 0; i < FIELD_COUNT; i++) this.views.push(this.makeView());
    this.reposition();
  }

  get count(): number { return FIELD_COUNT; }

  tileOf(i: number): { x: number; z: number } {
    return { x: this.place.x + (i % FIELD_COLS), z: this.place.z + Math.floor(i / FIELD_COLS) };
  }

  indexAt(tx: number, tz: number): number {
    const c = tx - this.place.x, r = tz - this.place.z;
    if (c < 0 || c >= FIELD_COLS || r < 0 || r >= FIELD_ROWS) return -1;
    return r * FIELD_COLS + c;
  }

  rank(i: number): number { return UNLOCK_ORDER.indexOf(i); }
  owned(i: number): boolean { return this.plot(i).owned; }
  get ownedCount(): number { return this.state.data.plots.filter((p) => p.owned).length; }
  // 目前等級可以擁有幾塊
  canOwn(i: number): boolean { return this.rank(i) < plotsForLevel(this.state.data.level); }
  nextPrice(): number { return plotPrice(this.ownedCount + 1); }
  // 還可以買幾塊（等級上限內、尚未擁有）
  get buyable(): number { return this.state.data.plots.filter((p, i) => !p.owned && this.canOwn(i)).length; }

  unlockLevel(i: number): number {
    const rank = this.rank(i);
    for (let lv = 1; lv < 100; lv++) if (plotsForLevel(lv) > rank) return lv;
    return 99;
  }

  private makeView(): PlotView {
    const group = new THREE.Group();
    const grass = mesh(grassGeo, MAT.plot, false);
    grass.position.y = 0.025;
    const soil = new THREE.Group();
    const s = mesh(soilGeo, MAT.soil, false);
    s.position.y = 0.06;
    soil.add(s);
    for (let k = -1; k <= 1; k++) {
      const f = mesh(furrowGeo, MAT.furrow, false);
      f.position.set(0, 0.145, k * 0.25);
      soil.add(f);
    }
    // 施過肥：土上撒一點金色顆粒
    const fert = new THREE.Group();
    for (let k = 0; k < 7; k++) {
      const d = mesh(GEO.sphereLo, MAT.fert, false);
      d.scale.setScalar(0.045);
      d.position.set(Math.cos(k * 2.4) * 0.3, 0.16, Math.sin(k * 2.4) * 0.3);
      fert.add(d);
    }
    fert.visible = false;
    const sign = new THREE.Group();
    const post = mesh(GEO.cyl, MAT.sign);
    post.scale.set(0.05, 0.4, 0.05);
    post.position.y = 0.2;
    const board = mesh(new RoundedBoxGeometry(0.34, 0.22, 0.04, 1, 0.02), MAT.sign);
    board.position.y = 0.42;
    sign.add(post, board);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
    label.scale.set(0.62, 0.25, 1);
    label.position.set(0, 0.78, 0);
    label.visible = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.48, 28), MAT.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    ring.visible = false;
    group.add(grass, soil, fert, sign, label, ring);
    this.root.add(group);
    return { group, grass, soil, sign, label, labelKey: '', fert, crop: null, stage: -1, cropId: null, pop: 1, ring, wet: false };
  }

  reposition(): void {
    this.views.forEach((v, i) => {
      const t = this.tileOf(i);
      v.group.position.set(t.x, 0, t.z);
    });
  }

  plot(i: number): PlotSave { return this.state.data.plots[i]; }

  def(i: number): CropDef | null {
    const id = this.plot(i).cropId;
    return id ? CROP_BY_ID[id] : null;
  }

  // 成長進度：濕潤時段 ×1、乾燥時段 ×0.6，分段積分
  progress(i: number, now: number): number {
    const p = this.plot(i);
    const d = this.def(i);
    if (!d) return 0;
    const span = Math.max(0, now - p.snapAt);
    const wet = Math.max(0, Math.min(now, p.wetUntil) - p.snapAt);
    const eff = wet + (span - wet) * DRY_RATE;
    return Math.min(1, p.p0 + eff / (d.minutes * 60000));
  }

  stageOf(prog: number): number {
    return prog >= 1 ? 3 : prog >= 0.5 ? 2 : prog >= 0.15 ? 1 : 0;
  }

  status(i: number, now: number): PlotStatus {
    const p = this.plot(i);
    if (!p.owned) {
      if (!this.canOwn(i)) return 'locked';
      return this.hasDebris(i) ? 'debris' : 'forsale';
    }
    if (!p.tilled) return 'grass';
    if (!p.cropId) return 'tilled';
    if (this.progress(i, now) >= 1) return 'mature';
    return p.wetUntil > now ? 'growing' : 'dry';
  }

  buy(i: number): void { this.plot(i).owned = true; }

  hoe(i: number, now: number): void {
    const p = this.plot(i);
    p.tilled = true;
    p.cropId = null;
    p.wetUntil = 0;
    p.snapAt = now;
  }

  plant(i: number, cropId: string, now: number): void {
    const p = this.plot(i);
    p.cropId = cropId;
    p.p0 = 0;
    p.snapAt = now;
    p.wetUntil = 0;
    p.fert = false;
  }

  fertilize(i: number): void { this.plot(i).fert = true; }

  water(i: number, now: number): void {
    const p = this.plot(i);
    const d = this.def(i);
    p.p0 = this.progress(i, now);
    p.snapAt = now;
    // 澆一次維持「成長時間的一半」，最少 2 分鐘、最多 6 小時
    const dur = d ? Math.min(6 * 3600000, Math.max(120000, d.minutes * 60000 * 0.5)) : 120000;
    p.wetUntil = now + dur;
  }

  harvest(i: number, now: number): { def: CropDef; quality: Quality } | null {
    const d = this.def(i);
    if (!d || this.progress(i, now) < 1) return null;
    const p = this.plot(i);
    const quality = rollQuality(Math.random(), true, p.fert);
    p.cropId = null;
    p.p0 = 0;
    p.snapAt = now;
    p.wetUntil = 0;
    p.fert = false;
    return { def: d, quality };
  }

  worldPos(i: number, y = 0.3): THREE.Vector3 {
    const t = this.tileOf(i);
    return new THREE.Vector3(t.x, y, t.z);
  }

  update(dt: number, now: number, raining: boolean): void {
    const t = performance.now() / 1000;
    const price = this.nextPrice();
    this.views.forEach((v, i) => {
      const p = this.plot(i);
      const st = this.status(i, now);
      const own = p.owned;
      if (raining && own && p.cropId && p.wetUntil < now + 30000) this.water(i, now);
      v.sign.visible = st === 'locked' || st === 'forsale';
      v.grass.material = own ? MAT.plot : st === 'locked' ? MAT.locked : MAT.sale;
      v.grass.visible = !p.tilled || !own;
      v.soil.visible = p.tilled && own;
      v.fert.visible = own && p.fert && !!p.cropId;
      // 標籤：未解鎖顯示等級、可購買顯示價格
      const key = st === 'locked' ? `Lv${this.unlockLevel(i)}` : st === 'forsale' ? `🪙${price}` : '';
      if (key !== v.labelKey) {
        v.labelKey = key;
        v.label.visible = !!key;
        if (key) {
          (v.label.material as THREE.SpriteMaterial).map = labelTexture(key, st === 'locked' ? 'rgba(74,53,38,0.72)' : 'rgba(214,150,40,0.92)');
          (v.label.material as THREE.SpriteMaterial).needsUpdate = true;
        }
      }
      if (st === 'forsale') v.label.position.y = 0.78 + Math.sin(t * 2.5 + i) * 0.04;
      const wet = p.tilled && p.wetUntil > now;
      if (wet !== v.wet) {
        v.wet = wet;
        v.soil.children.forEach((c, k) => ((c as THREE.Mesh).material = k === 0 ? (wet ? MAT.wet : MAT.soil) : wet ? MAT.furrowWet : MAT.furrow));
      }
      v.ring.visible = this.queued.has(i);
      if (v.ring.visible) v.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05);

      const d = own ? this.def(i) : null;
      const stage = d ? this.stageOf(this.progress(i, now)) : -1;
      if (stage !== v.stage || (d?.id ?? null) !== v.cropId) {
        if (v.crop) v.group.remove(v.crop);
        v.crop = null;
        if (d && stage >= 0) {
          v.crop = buildCrop(d, stage);
          v.crop.position.y = 0.14;
          v.crop.rotation.y = (i * 1.7) % (Math.PI * 2);
          v.group.add(v.crop);
          v.pop = 0;
        }
        v.stage = stage;
        v.cropId = d?.id ?? null;
      }
      if (v.crop) {
        v.pop = Math.min(1, v.pop + dt * 3);
        let s = 0.5 + 0.5 * easeOutBack(v.pop);
        if (v.stage === 3) s *= 1 + Math.sin(t * 3 + i) * 0.03; // 成熟：輕輕呼吸，提示可以收
        v.crop.scale.setScalar(s);
      }
    });
  }
}
