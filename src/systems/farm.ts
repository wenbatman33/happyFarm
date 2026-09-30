import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropPlacement } from '../config/layout';
import { CROP_BY_ID, type CropDef } from '../data/crops';
import { GREENHOUSE, GREENHOUSE_GROWTH, plotPrice, plotsForLevel, rollQuality, type Quality } from '../data/economy';
import { easeOutBack } from '../core/rng';
import { buildCrop } from '../world/crops3d';
import { bakeGroup } from '../world/bake';
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

// 溫室田：接在田區 30 格後面，共 18 格；座標相對於溫室中心（中間 x=0 那一排是走道）
export const GH_COUNT = 18;
export const GH_OFFSETS: [number, number][] = [
  [-3, 0], [-2, 0], [-1, 0], [-3, 1], [-2, 1], [-1, 1], // 第一期
  [1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1], // 第二期
  [-3, -1], [-2, -1], [-1, -1], [1, -1], [2, -1], [3, -1], // 第三期
];
export const ghPlotsFor = (level: number): number => (level <= 0 ? 0 : GREENHOUSE[Math.min(level, GREENHOUSE.length) - 1].plots);

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

// 作物模型快取：同一種作物、同一個階段只建一次（零件依材質合併），之後直接複製（共用幾何）
const cropCache = new Map<string, THREE.Group>();
function cropModel(d: CropDef, stage: number): THREE.Group {
  const k = `${d.id}:${stage}`;
  let c = cropCache.get(k);
  if (!c) { c = buildCrop(d, stage); bakeGroup(c); cropCache.set(k, c); }
  return c.clone();
}

export type PlotStatus = 'locked' | 'debris' | 'forsale' | 'grass' | 'tilled' | 'growing' | 'dry' | 'mature' | 'giantpart';

// 夜間花只在 19:00–05:00 生長：算 [a, b] 與每晚夜間時段的重疊毫秒數
export function nightMs(a: number, b: number): number {
  if (b <= a) return 0;
  const d0 = new Date(a);
  d0.setHours(0, 0, 0, 0);
  let day = d0.getTime() - 86400000, total = 0;
  while (day < b) {
    const n0 = day + 19 * 3600000, n1 = day + 29 * 3600000;
    total += Math.max(0, Math.min(b, n1) - Math.max(a, n0));
    day += 86400000;
  }
  return total;
}

export class Farm {
  root = new THREE.Group();
  private views: PlotView[] = [];
  queued = new Set<number>();
  hasDebris: (i: number) => boolean = () => false;
  showSigns = true; // 拜訪好友時不顯示買地的價格牌

  constructor(parent: THREE.Object3D, private state: GameState, private place: PropPlacement, private gh?: PropPlacement) {
    parent.add(this.root);
    for (let i = 0; i < FIELD_COUNT + GH_COUNT; i++) this.views.push(this.makeView());
    this.reposition();
  }

  get count(): number { return FIELD_COUNT + GH_COUNT; }

  isGH(i: number): boolean { return i >= FIELD_COUNT; }

  tileOf(i: number): { x: number; z: number } {
    if (i >= FIELD_COUNT) {
      const [dx, dz] = GH_OFFSETS[i - FIELD_COUNT];
      return { x: (this.gh?.x ?? 0) + dx, z: (this.gh?.z ?? 0) + dz };
    }
    return { x: this.place.x + (i % FIELD_COLS), z: this.place.z + Math.floor(i / FIELD_COLS) };
  }

  indexAt(tx: number, tz: number): number {
    const c = tx - this.place.x, r = tz - this.place.z;
    if (c >= 0 && c < FIELD_COLS && r >= 0 && r < FIELD_ROWS) return r * FIELD_COLS + c;
    if (this.gh) {
      const k = GH_OFFSETS.findIndex(([dx, dz]) => this.gh!.x + dx === tx && this.gh!.z + dz === tz);
      if (k >= 0 && k < ghPlotsFor(this.state.data.greenhouse?.level ?? 0)) return FIELD_COUNT + k;
    }
    return -1;
  }

  // 玩家在溫室裡（決定工具列顯示全季種子）
  inGreenhouse(x: number, z: number): boolean {
    if (!this.gh || (this.state.data.greenhouse?.level ?? 0) < 1) return false;
    return Math.abs(x - this.gh.x) < 3.6 && Math.abs(z - this.gh.z) < 1.7;
  }

  rank(i: number): number { return UNLOCK_ORDER.indexOf(i); }
  owned(i: number): boolean { return this.plot(i).owned; }
  get ownedCount(): number { return this.state.data.plots.filter((p, i) => p.owned && i < FIELD_COUNT).length; }
  // 目前等級可以擁有幾塊（溫室田由溫室等級決定）
  canOwn(i: number): boolean {
    if (i >= FIELD_COUNT) return i - FIELD_COUNT < ghPlotsFor(this.state.data.greenhouse?.level ?? 0);
    return this.rank(i) < plotsForLevel(this.state.data.level);
  }
  nextPrice(): number { return plotPrice(this.ownedCount + 1); }
  // 還可以買幾塊（等級上限內、尚未擁有）
  get buyable(): number { return this.state.data.plots.filter((p, i) => i < FIELD_COUNT && !p.owned && this.canOwn(i)).length; }

  // 溫室擴建完成：新的溫室田直接給你，而且土已經翻好
  grantGreenhouse(level: number, now: number): void {
    for (let k = 0; k < ghPlotsFor(level); k++) {
      const p = this.plot(FIELD_COUNT + k);
      if (!p.owned) Object.assign(p, { owned: true, tilled: true, cropId: null, p0: 0, snapAt: now, wetUntil: 0, fert: false });
    }
  }

  // 成長需要的毫秒（溫室 ×1.5）
  growMs(i: number, d: CropDef): number { return d.minutes * 60000 * (this.isGH(i) ? GREENHOUSE_GROWTH : 1); }

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
    bakeGroup(fert);
    const sign = new THREE.Group();
    const post = mesh(GEO.cyl, MAT.sign);
    post.scale.set(0.05, 0.4, 0.05);
    post.position.y = 0.2;
    const board = mesh(new RoundedBoxGeometry(0.34, 0.22, 0.04, 1, 0.02), MAT.sign);
    board.position.y = 0.42;
    sign.add(post, board);
    bakeGroup(sign);
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
    const span = d.night ? nightMs(p.snapAt, now) : Math.max(0, now - p.snapAt);
    const wet = d.night ? nightMs(p.snapAt, Math.min(now, p.wetUntil)) : Math.max(0, Math.min(now, p.wetUntil) - p.snapAt);
    const eff = wet + (span - wet) * DRY_RATE;
    return Math.min(1, p.p0 + eff / this.growMs(i, d));
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
    if (p.giantOf !== undefined) return 'giantpart';
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

  // 巨型作物：以 root 為左上角的 3×3，全部是自己的、翻好土、空著
  giantBlock(root: number): number[] | null {
    if (root >= FIELD_COUNT) return null;
    const c = root % FIELD_COLS, r = Math.floor(root / FIELD_COLS);
    if (c > FIELD_COLS - 3 || r > FIELD_ROWS - 3) return null;
    const out: number[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      const i = root + dc + dr * FIELD_COLS;
      const p = this.plot(i);
      if (!p.owned || !p.tilled || p.cropId || p.giantOf !== undefined) return null;
      out.push(i);
    }
    return out;
  }

  plantGiant(root: number, id: string, now: number): boolean {
    const block = this.giantBlock(root);
    if (!block) return false;
    for (const i of block) if (i !== root) this.plot(i).giantOf = root;
    this.plant(root, id, now);
    return true;
  }

  water(i: number, now: number): void {
    const p = this.plot(i);
    const d = this.def(i);
    p.p0 = this.progress(i, now);
    p.snapAt = now;
    // 澆一次維持「成長時間的一半」，最少 2 分鐘、最多 6 小時
    const dur = d ? Math.min(6 * 3600000, Math.max(120000, this.growMs(i, d) * 0.5)) : 120000;
    p.wetUntil = now + dur;
  }

  harvest(i: number, now: number): { def: CropDef; quality: Quality } | null {
    const d = this.def(i);
    if (!d || this.progress(i, now) < 1) return null;
    const p = this.plot(i);
    // 貓咪午睡加持：品質機率往上移 10%
    const r = Math.random();
    const quality = rollQuality(p.boost ? Math.max(0, r - 0.1) : r, true, p.fert);
    p.boost = false;
    if (d.giant) this.state.data.plots.forEach((q) => { if (q.giantOf === i) q.giantOf = undefined; });
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
      // 溫室田：沒擴建到的不顯示；溫室有自動灑水，永遠不會乾
      if (i >= FIELD_COUNT) {
        v.group.visible = own;
        if (!own) return;
        if (p.cropId && p.wetUntil < now + 30000) this.water(i, now);
      } else if (raining && own && p.cropId && p.wetUntil < now + 30000) this.water(i, now);
      v.sign.visible = this.showSigns && (st === 'locked' || st === 'forsale');
      v.grass.material = own ? MAT.plot : st === 'locked' ? MAT.locked : MAT.sale;
      v.grass.visible = !p.tilled || !own;
      v.soil.visible = p.tilled && own;
      v.fert.visible = own && p.fert && !!p.cropId;
      // 標籤：未解鎖顯示等級、可購買顯示價格
      const key = !this.showSigns ? '' : st === 'locked' ? `Lv${this.unlockLevel(i)}` : st === 'forsale' ? `🪙${price}` : '';
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
          v.crop = cropModel(d, stage);
          v.crop.position.set(d.giant ? 1 : 0, 0.14, d.giant ? 1 : 0); // 巨型作物長在 3×3 的正中央
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
        if (d?.giant && v.stage === 3) v.crop.rotation.z = Math.sin(t * 1.5) * 0.015;
      }
    });
  }
}
