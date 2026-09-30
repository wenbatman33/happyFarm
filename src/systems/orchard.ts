import * as THREE from 'three';
import { sfx } from '../core/audio';
import { FRUIT_EVERY_MS, ORCHARD_LEVEL, ORCHARD_SLOTS, TREES, TREE_BY_ID, type TreeDef } from '../data/trees';
import { SEASON_LABEL, type Season } from '../core/clock';
import { GEO, mat, mesh, withWind } from '../world/materials';
import type { Game } from '../game';
import type { MenuView } from '../ui/hud';
import type { TreeSave } from './state';

// 果園（docs/04 §4.1）：6 個樹位，果樹永久存在，成熟後只在自己的季節每 2 天結果
export type TreeStatus = 'locked' | 'empty' | 'growing' | 'offseason' | 'waiting' | 'ready';

const DAY = 86400000;
const fmtDays = (ms: number) => (ms > DAY ? `${Math.ceil(ms / DAY)} 天` : `${Math.max(1, Math.ceil(ms / 3600000))} 小時`);

interface View { g: THREE.Group; canopy: THREE.Group; fruits: THREE.Group; blossoms: THREE.Group; key: string; shake: number }

export class Orchard {
  root = new THREE.Group();
  private views = new Map<number, View>();
  private markers: THREE.Group[] = [];
  private leaf = withWind(mat('#5fbf49', { roughness: 0.8 }), 0.02);

  constructor(private game: Game) {
    game.world.root.add(this.root);
    // 空樹位：一圈土＋小木牌
    ORCHARD_SLOTS.forEach(([x, z]) => {
      const m = new THREE.Group();
      const dirt = mesh(GEO.cyl, mat('#8c5a36', { roughness: 1 }), false);
      dirt.scale.set(1.1, 0.04, 1.1);
      dirt.position.y = 0.02;
      const post = mesh(GEO.cyl, mat('#c89b62')); post.scale.set(0.05, 0.45, 0.05); post.position.set(0.45, 0.22, 0.45);
      const board = mesh(GEO.sphereLo, mat('#c89b62')); board.scale.set(0.3, 0.2, 0.05); board.position.set(0.45, 0.48, 0.45);
      m.add(dirt, post, board);
      m.position.set(x, 0, z);
      this.root.add(m);
      this.markers.push(m);
    });
  }

  get list(): TreeSave[] { return this.game.state.data.trees; }
  treeAt(slot: number): TreeSave | undefined { return this.list.find((t) => t.slot === slot); }
  pos(slot: number): { x: number; z: number } { const [x, z] = ORCHARD_SLOTS[slot]; return { x, z }; }

  slotAt(x: number, z: number): number {
    return ORCHARD_SLOTS.findIndex(([sx, sz]) => Math.hypot(sx - x, sz - z) < 0.9);
  }

  status(slot: number, now: number): { st: TreeStatus; left: number } {
    const t = this.treeAt(slot);
    if (!t) return { st: this.game.state.data.level >= ORCHARD_LEVEL ? 'empty' : 'locked', left: 0 };
    const def = TREE_BY_ID[t.id];
    const matureAt = t.plantedAt + def.matureDays * DAY;
    if (now < matureAt) return { st: 'growing', left: matureAt - now };
    if (def.season !== this.game.season) return { st: 'offseason', left: 0 };
    const next = Math.max(matureAt, t.pickedAt + FRUIT_EVERY_MS);
    return now >= next ? { st: 'ready', left: 0 } : { st: 'waiting', left: next - now };
  }

  applyBlocking(): void {
    const g = this.game.grid;
    for (const t of this.list) { const p = this.pos(t.slot); g.blocked[g.idx(Math.round(p.x), Math.round(p.z))] = 1; }
  }

  menu(slot: number, now: number): MenuView {
    const d = this.game.state.data;
    const { st, left } = this.status(slot, now);
    if (st === 'locked') return { title: '🌳 果園', sub: `Lv${ORCHARD_LEVEL} 開放`, items: [] };
    if (st === 'empty') {
      return {
        title: '🌳 空的樹位', sub: '種下果樹，成熟後在它的季節會一直結果',
        items: TREES.map((t) => ({
          act: `plant:${t.id}`, emoji: t.emoji, label: `${t.name}樹`, enabled: d.level >= t.unlock && d.coins >= t.sapling && !this.list.some((x) => x.id === t.id),
          note: this.list.some((x) => x.id === t.id) ? '已經種了' : d.level < t.unlock ? `Lv${t.unlock}` : `🪙${t.sapling} · ${SEASON_LABEL[t.season]}季結果`,
        })),
      };
    }
    const t = this.treeAt(slot)!;
    const def = TREE_BY_ID[t.id];
    const sub = st === 'growing' ? `還要 ${fmtDays(left)}長大` : st === 'offseason' ? `${SEASON_LABEL[def.season]}季才會結果` : st === 'waiting' ? `${fmtDays(left)}後結果` : '結滿果實了！';
    return { title: `${def.emoji} ${def.name}樹`, sub, items: [{ act: 'pick', emoji: '🧺', label: '採收', enabled: st === 'ready', note: st === 'ready' ? `×${def.yieldN}` : '還不行' }] };
  }

  plant(slot: number, id: string, now: number): boolean {
    const def = TREE_BY_ID[id];
    const d = this.game.state.data;
    if (!def || this.treeAt(slot) || d.coins < def.sapling || d.level < def.unlock) return false;
    d.coins -= def.sapling;
    d.trees.push({ slot, id, plantedAt: now, pickedAt: 0 });
    this.game.world.rebuildGrid();
    return true;
  }

  pick(slot: number, now: number): TreeDef | null {
    const t = this.treeAt(slot);
    if (!t || this.status(slot, now).st !== 'ready') return null;
    t.pickedAt = now;
    const v = this.views.get(slot);
    if (v) v.shake = 1;
    return TREE_BY_ID[t.id];
  }

  private build(def: TreeDef): View {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.5, 10), mat('#8a5a3a'));
    trunk.position.y = 0.75;
    const canopy = new THREE.Group();
    canopy.position.y = 1.9;
    for (let i = 0; i < 4; i++) {
      const f = mesh(GEO.ico, this.leaf);
      const a = (i / 4) * Math.PI * 2;
      f.scale.setScalar(i === 0 ? 1.3 : 1);
      f.position.set(i === 0 ? 0 : Math.cos(a) * 0.5, i === 0 ? 0.3 : 0, i === 0 ? 0 : Math.sin(a) * 0.5);
      canopy.add(f);
    }
    const fruits = new THREE.Group();
    const fm = mat(def.fruit, { roughness: 0.4 });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = 0.7 + (i % 3) * 0.1;
      const f = mesh(GEO.sphere, fm, false);
      f.scale.setScalar(0.18);
      f.position.set(Math.cos(a) * r, -0.1 + (i % 3) * 0.3, Math.sin(a) * r);
      fruits.add(f);
    }
    const blossoms = new THREE.Group();
    const bm = mat(def.blossom, { roughness: 0.6 });
    for (let i = 0; i < 12; i++) {
      const a = i * 1.9;
      const b = mesh(GEO.sphereLo, bm, false);
      b.scale.setScalar(0.12);
      b.position.set(Math.cos(a) * 0.75, (i % 4) * 0.22 - 0.1, Math.sin(a) * 0.75);
      blossoms.add(b);
    }
    canopy.add(fruits, blossoms);
    g.add(trunk, canopy);
    return { g, canopy, fruits, blossoms, key: '', shake: 0 };
  }

  update(dt: number, now: number, season: Season, leafColor: THREE.Color): void {
    this.leaf.color.copy(leafColor);
    const t = performance.now() / 1000;
    ORCHARD_SLOTS.forEach((_, slot) => {
      const tree = this.treeAt(slot);
      this.markers[slot].visible = !tree;
      let v = this.views.get(slot);
      if (!tree) { if (v) { this.root.remove(v.g); this.views.delete(slot); } return; }
      const def = TREE_BY_ID[tree.id];
      if (!v || v.key !== tree.id) {
        if (v) this.root.remove(v.g);
        v = this.build(def);
        v.key = tree.id;
        const p = this.pos(slot);
        v.g.position.set(p.x, 0, p.z);
        v.g.rotation.y = slot * 1.3;
        this.root.add(v.g);
        this.views.set(slot, v);
      }
      const { st } = this.status(slot, now);
      const age = (now - tree.plantedAt) / (def.matureDays * DAY);
      const s = st === 'growing' ? 0.35 + 0.65 * Math.min(1, age) : 1;
      v.g.scale.setScalar(s);
      v.fruits.visible = st === 'ready';
      v.blossoms.visible = st === 'waiting' && def.season === season;
      v.shake = Math.max(0, v.shake - dt * 2);
      v.canopy.rotation.z = Math.sin(t * 30) * 0.08 * v.shake;
      if (st === 'ready') v.fruits.children.forEach((f, i) => (f.position.y += Math.sin(t * 2 + i) * 0.0008));
    });
    void sfx;
  }
}
