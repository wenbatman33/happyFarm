import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropPlacement } from '../config/layout';
import { CROP_BY_ID, type CropDef } from '../data/crops';
import { plotsForLevel, rollQuality, type Quality } from '../data/economy';
import { easeOutBack } from '../core/rng';
import { buildCrop } from '../world/crops3d';
import { GEO, mat, mesh } from '../world/materials';
import type { GameState, PlotSave } from './state';

export const FIELD_COLS = 4;
export const FIELD_ROWS = 3;
// 解鎖順序：先左邊 3×2，再第三排，最後第四欄
const UNLOCK_ORDER = [0, 1, 2, 4, 5, 6, 8, 9, 10, 3, 7, 11];

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
  locked: mat('#a4ad8c', { roughness: 0.95 }),
  sign: mat('#c89b62'),
  ring: new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.85, depthWrite: false }),
};

interface PlotView {
  group: THREE.Group;
  grass: THREE.Mesh;
  soil: THREE.Group;
  sign: THREE.Group;
  crop: THREE.Group | null;
  stage: number;
  cropId: string | null;
  pop: number; // 生長階段改變時的彈跳動畫
  ring: THREE.Mesh;
  wet: boolean;
}

export type PlotStatus = 'locked' | 'grass' | 'tilled' | 'growing' | 'dry' | 'mature';

export class Farm {
  root = new THREE.Group();
  private views: PlotView[] = [];
  queued = new Set<number>();

  constructor(parent: THREE.Object3D, private state: GameState, private place: PropPlacement) {
    parent.add(this.root);
    for (let i = 0; i < FIELD_COLS * FIELD_ROWS; i++) this.views.push(this.makeView());
    this.reposition();
  }

  get count(): number { return FIELD_COLS * FIELD_ROWS; }

  tileOf(i: number): { x: number; z: number } {
    return { x: this.place.x + (i % FIELD_COLS), z: this.place.z + Math.floor(i / FIELD_COLS) };
  }

  indexAt(tx: number, tz: number): number {
    const c = tx - this.place.x, r = tz - this.place.z;
    if (c < 0 || c >= FIELD_COLS || r < 0 || r >= FIELD_ROWS) return -1;
    return r * FIELD_COLS + c;
  }

  isUnlocked(i: number): boolean {
    return UNLOCK_ORDER.indexOf(i) < plotsForLevel(this.state.data.level);
  }

  unlockLevel(i: number): number {
    const rank = UNLOCK_ORDER.indexOf(i);
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
    const sign = new THREE.Group();
    const post = mesh(GEO.cyl, MAT.sign);
    post.scale.set(0.05, 0.4, 0.05);
    post.position.y = 0.2;
    const board = mesh(new RoundedBoxGeometry(0.34, 0.22, 0.04, 1, 0.02), MAT.sign);
    board.position.y = 0.42;
    sign.add(post, board);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.48, 28), MAT.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    ring.visible = false;
    group.add(grass, soil, sign, ring);
    this.root.add(group);
    return { group, grass, soil, sign, crop: null, stage: -1, cropId: null, pop: 1, ring, wet: false };
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
    if (!this.isUnlocked(i)) return 'locked';
    const p = this.plot(i);
    if (!p.tilled) return 'grass';
    if (!p.cropId) return 'tilled';
    if (this.progress(i, now) >= 1) return 'mature';
    return p.wetUntil > now ? 'growing' : 'dry';
  }

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
  }

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
    p.cropId = null;
    p.p0 = 0;
    p.snapAt = now;
    p.wetUntil = 0;
    return { def: d, quality: rollQuality(Math.random(), true) };
  }

  worldPos(i: number, y = 0.3): THREE.Vector3 {
    const t = this.tileOf(i);
    return new THREE.Vector3(t.x, y, t.z);
  }

  update(dt: number, now: number, raining: boolean): void {
    const t = performance.now() / 1000;
    this.views.forEach((v, i) => {
      const p = this.plot(i);
      const unlocked = this.isUnlocked(i);
      if (raining && unlocked && p.cropId && p.wetUntil < now + 30000) this.water(i, now);
      v.sign.visible = !unlocked;
      v.grass.material = unlocked ? MAT.plot : MAT.locked;
      v.grass.visible = !p.tilled || !unlocked;
      v.soil.visible = p.tilled && unlocked;
      const wet = p.tilled && p.wetUntil > now;
      if (wet !== v.wet) {
        v.wet = wet;
        v.soil.children.forEach((c, k) => ((c as THREE.Mesh).material = k === 0 ? (wet ? MAT.wet : MAT.soil) : wet ? MAT.furrowWet : MAT.furrow));
      }
      v.ring.visible = this.queued.has(i);
      if (v.ring.visible) v.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.05);

      const d = this.def(i);
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
