import * as THREE from 'three';
import { dayKey } from '../core/clock';
import { hashStr, mulberry32 } from '../core/rng';
import { DEBRIS, DEBRIS_DAILY, DEBRIS_WILD_CAP, type DebrisKind } from '../data/economy';
import type { SceneLayout } from '../config/layout';
import { GEO, mat, mesh } from '../world/materials';
import type { Grid } from '../world/grid';
import { STARTER_PLOTS, UNLOCK_ORDER, type Farm } from './farm';
import type { DebrisSave, GameState } from './state';

// 荒地障礙物（docs/03 §5）：清掉拿石材、木材，未擁有的田地要先清乾淨才能買
const M = {
  stone: mat('#a9a49b', { roughness: 0.95 }),
  stoneDark: mat('#8e8980', { roughness: 0.95 }),
  bark: mat('#7a5236', { roughness: 0.95 }),
  wood: mat('#dcb27a', { roughness: 0.85 }),
  ring: mat('#b58a58', { roughness: 0.9 }),
  moss: mat('#6aa84a', { roughness: 0.9 }),
  shroom: mat('#e8584a', { roughness: 0.6 }),
  dot: mat('#fff4e6'),
};

function buildDebris(kind: DebrisKind, seed: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group(); // 被敲時抖動
  g.add(body);
  g.userData.body = body;
  const rand = mulberry32(seed);
  switch (kind) {
    case 'stone': {
      const r = mesh(new THREE.IcosahedronGeometry(0.5, 1), M.stone);
      r.scale.set(0.42 + rand() * 0.1, 0.26, 0.36 + rand() * 0.1);
      r.position.y = 0.08;
      body.add(r);
      break;
    }
    case 'boulder': {
      const a = mesh(new THREE.IcosahedronGeometry(0.5, 1), M.stone);
      a.scale.set(0.95, 0.62, 0.8);
      a.position.y = 0.24;
      const b = mesh(new THREE.IcosahedronGeometry(0.5, 1), M.stoneDark);
      b.scale.set(0.5, 0.4, 0.45);
      b.position.set(0.4, 0.14, 0.25);
      const moss = mesh(GEO.sphereLo, M.moss, false);
      moss.scale.set(0.4, 0.08, 0.3);
      moss.position.set(-0.1, 0.52, 0);
      body.add(a, b, moss);
      break;
    }
    case 'stump': {
      const s = mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.38, 14), M.bark);
      s.position.y = 0.19;
      const top = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14), M.wood, false);
      top.position.y = 0.39;
      body.add(s, top);
      for (const r of [0.17, 0.09]) {
        const ring = mesh(new THREE.TorusGeometry(r, 0.012, 4, 20), M.ring, false);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.405;
        body.add(ring);
      }
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + rand();
        const root = mesh(GEO.capsule, M.bark);
        root.scale.set(0.12, 0.14, 0.12);
        root.rotation.set(Math.PI / 2, 0, -a);
        root.position.set(Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32);
        root.lookAt(Math.cos(a) * 2, 0, Math.sin(a) * 2);
        root.rotateX(Math.PI / 2);
        body.add(root);
      }
      break;
    }
    case 'log': {
      const l = mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.1, 14), M.bark);
      l.rotation.z = Math.PI / 2;
      l.position.y = 0.2;
      body.add(l);
      for (const s of [-1, 1]) {
        const cap = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 14), M.wood, false);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(s * 0.56, 0.2, 0);
        body.add(cap);
      }
      const moss = mesh(GEO.sphereLo, M.moss, false);
      moss.scale.set(0.5, 0.07, 0.22);
      moss.position.set(-0.1, 0.39, 0);
      const cap = mesh(GEO.sphere, M.shroom, false);
      cap.scale.set(0.14, 0.08, 0.14);
      cap.position.set(0.25, 0.44, 0.05);
      const dot = mesh(GEO.sphereLo, M.dot, false);
      dot.scale.setScalar(0.03);
      dot.position.set(0.25, 0.49, 0.1);
      body.add(moss, cap, dot);
      break;
    }
  }
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}

interface View { group: THREE.Group; kind: DebrisKind; shake: number }

export class Debris {
  root = new THREE.Group();
  private views = new Map<string, View>();
  queued = new Set<string>();

  constructor(parent: THREE.Object3D, private state: GameState, private grid: Grid, private farm: Farm, private layout: SceneLayout) {
    parent.add(this.root);
  }

  get list(): DebrisSave[] { return this.state.data.debris; }
  get(id: string): DebrisSave | undefined { return this.list.find((d) => d.id === id); }
  at(tx: number, tz: number): DebrisSave | undefined { return this.list.find((d) => d.x === tx && d.z === tz); }
  onPlot(i: number): boolean { const t = this.farm.tileOf(i); return !!this.at(t.x, t.z); }

  private add(x: number, z: number, kind: DebrisKind, rand: () => number): void {
    const d = this.state.data;
    this.list.push({ id: `d${++d.debrisSeq}`, x, z, kind, hits: DEBRIS[kind].hits, rot: rand() * 6 });
  }

  // 新遊戲：還沒買的田地上堆著石頭、樹樁，荒地也散落一些
  seedInitial(now: number, occupied: (x: number, z: number) => boolean): void {
    const rand = mulberry32(hashStr('debris' + now));
    const kinds: DebrisKind[] = ['stone', 'stump', 'boulder', 'stone', 'log', 'stump'];
    UNLOCK_ORDER.forEach((i, rank) => {
      if (rank < STARTER_PLOTS) return;
      const t = this.farm.tileOf(i);
      if (rank % 3 !== 2) this.add(t.x, t.z, kinds[rank % kinds.length], rand); // 約 2/3 的田有障礙物
    });
    this.spawnWild(8, rand, occupied);
    this.state.data.debrisDay = dayKey(now);
  }

  // 每天在荒地補長幾個
  daily(now: number, occupied: (x: number, z: number) => boolean): number {
    const d = this.state.data;
    const day = dayKey(now);
    if (d.debrisDay === day) return 0;
    d.debrisDay = day;
    return this.spawnWild(DEBRIS_DAILY, mulberry32(hashStr('debris' + day)), occupied);
  }

  private spawnWild(n: number, rand: () => number, occupied: (x: number, z: number) => boolean): number {
    const wild = this.list.filter((d) => this.farm.indexAt(d.x, d.z) < 0).length;
    let added = 0;
    const L = this.layout;
    const kinds: DebrisKind[] = ['stone', 'stone', 'stump', 'boulder', 'log'];
    for (let k = 0; k < 80 && added < n && wild + added < DEBRIS_WILD_CAP; k++) {
      const x = Math.round((rand() - 0.5) * 24), z = Math.round((rand() - 0.5) * 24);
      if (this.grid.isBlocked(x, z) || this.grid.path[this.grid.idx(x, z)]) continue;
      if (this.farm.indexAt(x, z) >= 0 || this.at(x, z) || occupied(x, z)) continue;
      if (Math.abs(x - L.house.x) < 4.5 && Math.abs(z - L.house.z) < 5.5) continue; // 房子前後留空
      if (Math.abs(x - L.ranch.x) < 3.5 && Math.abs(z - L.ranch.z) < 3) continue; // 牧場裡不放
      this.add(x, z, kinds[Math.floor(rand() * kinds.length)], rand);
      added++;
    }
    return added;
  }

  // 大型障礙物會擋路（小石頭不擋）
  applyBlocking(): void {
    for (const d of this.list) if (d.kind !== 'stone') this.grid.blocked[this.grid.idx(d.x, d.z)] = 1;
  }

  remove(id: string): void {
    this.state.data.debris = this.list.filter((d) => d.id !== id);
    this.queued.delete(id);
  }

  shake(id: string): void {
    const v = this.views.get(id);
    if (v) v.shake = 1;
  }

  worldPos(d: DebrisSave, y = 0.3): THREE.Vector3 { return new THREE.Vector3(d.x, y, d.z); }

  update(dt: number): void {
    const alive = new Set<string>();
    const t = performance.now() / 1000;
    for (const d of this.list) {
      alive.add(d.id);
      let v = this.views.get(d.id);
      if (!v) {
        const group = buildDebris(d.kind, hashStr(d.id));
        group.position.set(d.x, 0, d.z);
        group.rotation.y = d.rot;
        this.root.add(group);
        v = { group, kind: d.kind, shake: 0 };
        this.views.set(d.id, v);
      }
      v.shake = Math.max(0, v.shake - dt * 5);
      const body = v.group.userData.body as THREE.Group;
      body.rotation.z = Math.sin(t * 60) * 0.08 * v.shake;
      body.scale.setScalar(1 - v.shake * 0.08);
      body.position.y = this.queued.has(d.id) ? Math.abs(Math.sin(t * 6)) * 0.03 : 0;
    }
    for (const [id, v] of this.views) if (!alive.has(id)) { this.root.remove(v.group); this.views.delete(id); }
  }
}
