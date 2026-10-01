import * as THREE from 'three';
import type { SceneLayout } from '../config/layout';
import type { Season } from '../core/clock';
import { hashStr, mulberry32 } from '../core/rng';
import { WEED_SPAWN_MS } from '../data/economy';
import type { Grid, Tile } from '../world/grid';
import { buildWeed, type WeedKind } from '../world/weeds3d';
import { FIELD_COLS, FIELD_ROWS, type Farm } from './farm';
import type { GameState, WeedSave } from './state';

// 雜草生長區（docs/03 §4.1）
interface Zone { name: string; cap: number; tiles: () => Tile[] }

export const PULLS: Record<WeedKind, number> = { sprout: 1, bush: 2, big: 3, dandelion: 1, leaves: 1, snow: 1, vine: 1 };
export const WEED_LABEL: Record<WeedKind, string> = { sprout: '小草芽', bush: '雜草叢', big: '大草叢', dandelion: '蒲公英', leaves: '落葉堆', snow: '積雪', vine: '牆面藤蔓' };

interface WeedView { group: THREE.Group; kind: WeedKind; tug: number; pop: number; shake: number }

export class Weeds {
  root = new THREE.Group();
  private views = new Map<string, WeedView>();
  queued = new Set<string>();
  extraBlocked?: (x: number, z: number) => boolean; // 其他東西（障礙物）佔用的格子
  private zones: Zone[];

  constructor(parent: THREE.Object3D, private state: GameState, private grid: Grid, private layout: SceneLayout, private farm: Farm) {
    parent.add(this.root);
    this.zones = [
      { name: 'house', cap: 10, tiles: () => this.ring(this.layout.house.x, this.layout.house.z, 3.5, 3.0, 5.2, 4.6) },
      { name: 'path', cap: 8, tiles: () => this.pathSides() },
      { name: 'fence', cap: 8, tiles: () => this.fenceEdge() },
      // 房子正面牆上的藤蔓（要修枝剪才能剪，docs/03 §4.1）
      { name: 'wall', cap: 4, tiles: () => this.wallSpots().map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) })) },
      { name: 'field', cap: 10, tiles: () => { const iw = FIELD_COLS / 2, id = FIELD_ROWS / 2; return this.ring(this.layout.field.x + (FIELD_COLS - 1) / 2, this.layout.field.z + (FIELD_ROWS - 1) / 2, iw, id, iw + 1.1, id + 1.1); } },
    ];
  }

  get list(): WeedSave[] { return this.state.data.weeds; }

  // 藤蔓長在房子正面牆上（窗戶兩側），位置是精確的牆面座標
  wallSpots(): { x: number; z: number }[] {
    const h = this.layout.house;
    return [-2.6, -1.4, 1.4, 2.6].map((dx) => ({ x: h.x + dx, z: h.z + 2.3 }));
  }

  // 藤蔓在牆上，點地面對不到：用射線直接打藤蔓模型
  rayVine(ray: THREE.Raycaster): string | null {
    for (const w of this.list) {
      if (w.kind !== 'vine') continue;
      const v = this.views.get(w.id);
      if (v && ray.intersectObject(v.group, true).length) return w.id;
    }
    return null;
  }

  private free(x: number, z: number): boolean {
    return !this.grid.isBlocked(x, z) && !this.grid.path[this.grid.idx(x, z)] && this.farm.indexAt(x, z) < 0 && !this.extraBlocked?.(x, z);
  }

  // 矩形外環：內框（半寬 iw、半深 id）以外、外框以內的格子
  private ring(cx: number, cz: number, iw: number, id: number, ow: number, od: number): Tile[] {
    const out: Tile[] = [];
    for (let z = Math.floor(cz - od); z <= Math.ceil(cz + od); z++) {
      for (let x = Math.floor(cx - ow); x <= Math.ceil(cx + ow); x++) {
        const inside = Math.abs(x - cx) <= iw && Math.abs(z - cz) <= id;
        const within = Math.abs(x - cx) <= ow && Math.abs(z - cz) <= od;
        if (!inside && within && this.free(x, z)) out.push({ x, z });
      }
    }
    return out;
  }

  private pathSides(): Tile[] {
    const out: Tile[] = [];
    const px = Math.round(this.layout.house.x);
    for (let z = Math.round(this.layout.house.z + 4); z <= 12; z++) for (const x of [px - 1, px + 1]) if (this.free(x, z)) out.push({ x, z });
    return out;
  }

  private fenceEdge(): Tile[] {
    const out: Tile[] = [];
    for (let i = -13; i <= 13; i++) for (const [x, z] of [[i, -13], [i, 13], [-13, i], [13, i]]) if (this.free(x, z)) out.push({ x, z });
    return out;
  }

  at(tx: number, tz: number): WeedSave | undefined {
    return this.list.find((w) => w.tx === tx && w.tz === tz);
  }

  get(id: string): WeedSave | undefined {
    return this.list.find((w) => w.id === id);
  }

  worldPos(w: WeedSave, y = 0.2): THREE.Vector3 {
    return new THREE.Vector3(w.tx + w.ox, y, w.tz + w.oz);
  }

  private spawn(zone: Zone, bornAt: number, season: Season, rand: () => number, forceKind?: WeedKind): WeedSave | null {
    const taken = new Set(this.list.map((w) => `${w.tx},${w.tz}`));
    const tiles = zone.tiles().filter((t) => !taken.has(`${t.x},${t.z}`));
    if (!tiles.length) return null;
    const t = tiles[Math.floor(rand() * tiles.length)];
    if (zone.name === 'wall') {
      const sp = this.wallSpots().find((p) => Math.round(p.x) === t.x && Math.round(p.z) === t.z)!;
      const d = this.state.data;
      const w: WeedSave = { id: `w${++d.weedSeq}`, tx: t.x, tz: t.z, ox: sp.x - t.x, oz: sp.z - t.z, kind: 'vine', bornAt, pulls: PULLS.vine, zone: 'wall' };
      this.list.push(w);
      return w;
    }
    const r = rand();
    // 季節雜草：春天蒲公英、秋天落葉堆、冬天積雪
    let kind: WeedKind = 'sprout';
    if (season === 'spring' && r < 0.25) kind = 'dandelion';
    if (season === 'autumn' && r < 0.35) kind = 'leaves';
    if (season === 'winter' && r < 0.5) kind = 'snow';
    if (forceKind) kind = forceKind;
    const d = this.state.data;
    const w: WeedSave = { id: `w${++d.weedSeq}`, tx: t.x, tz: t.z, ox: (rand() - 0.5) * 0.4, oz: (rand() - 0.5) * 0.4, kind, bornAt, pulls: PULLS[kind], zone: zone.name };
    this.list.push(w);
    return w;
  }

  // 新遊戲：房子周圍長滿草（新手教學用）
  seedInitial(now: number, season: Season): void {
    const rand = mulberry32(hashStr('init' + now));
    const plan: [string, number][] = [['house', 10], ['path', 4], ['field', 4], ['fence', 5], ['wall', 2]];
    for (const [name, n] of plan) {
      const z = this.zones.find((zz) => zz.name === name)!;
      for (let i = 0; i < n; i++) {
        const age = i % 4 === 3 ? 8 * 3600000 : 2 * 3600000; // 一部分已經長成雜草叢
        this.spawn(z, now - age, season, rand);
      }
      this.state.data.zones[name] = now;
    }
  }

  // 依時間補長雜草：離線多久就一次補齊（可重現）
  tick(now: number, season: Season): WeedSave[] {
    const born: WeedSave[] = [];
    const d = this.state.data;
    for (const z of this.zones) {
      let last = d.zones[z.name] ?? now;
      if (now - last > WEED_SPAWN_MS * 40) last = now - WEED_SPAWN_MS * z.cap;
      while (now - last >= WEED_SPAWN_MS) {
        last += WEED_SPAWN_MS;
        const count = this.list.filter((w) => w.zone === z.name).length;
        if (count < z.cap) {
          const w = this.spawn(z, last, season, mulberry32(hashStr(z.name + last)));
          if (w) born.push(w);
        }
      }
      d.zones[z.name] = last;
    }
    // 小草芽隨時間長大：6 小時→雜草叢、24 小時→大草叢
    for (const w of this.list) {
      if (w.kind !== 'sprout' && w.kind !== 'bush') continue;
      const age = now - w.bornAt;
      const want: WeedKind = age > 24 * 3600000 ? 'big' : age > 6 * 3600000 ? 'bush' : 'sprout';
      if (want !== w.kind && PULLS[want] > PULLS[w.kind]) {
        w.pulls += PULLS[want] - PULLS[w.kind];
        w.kind = want;
      }
    }
    return born;
  }

  // 好友的惡作劇：在房子附近放一株草（拔掉時獎勵加倍）
  spawnPrank(by: string, now: number, season: Season): WeedSave | null {
    const z = this.zones.find((zz) => zz.name === 'house')!;
    const w = this.spawn(z, now, season, mulberry32(hashStr(by + now)), 'bush');
    if (w) { w.by = by; w.zone = 'prank'; }
    return w;
  }

  // DEV：在指定區域長一株（例如牆上的藤蔓）
  forceSpawnZone(name: string, now: number): void {
    const z = this.zones.find((zz) => zz.name === name);
    if (z) this.spawn(z, now, 'spring', mulberry32(hashStr(name + now + this.list.length)));
  }

  forceSpawn(n: number, now: number, season: Season, kind?: WeedKind): void {
    const rand = mulberry32(hashStr('dev' + now));
    for (let i = 0; i < n; i++) this.spawn(this.zones[i % this.zones.length], now, season, rand, kind);
  }

  remove(id: string): void {
    this.state.data.weeds = this.list.filter((w) => w.id !== id);
    this.queued.delete(id);
  }

  // 拔草動畫：tug 0..1 會把草往上拉長
  setTug(id: string, tug: number): void {
    const v = this.views.get(id);
    if (v) v.tug = tug;
  }

  shake(id: string): void {
    const v = this.views.get(id);
    if (v) v.shake = 1;
  }

  update(dt: number): void {
    const t = performance.now() / 1000;
    const alive = new Set<string>();
    for (const w of this.list) {
      alive.add(w.id);
      let v = this.views.get(w.id);
      if (v && v.kind !== w.kind) { this.root.remove(v.group); v = undefined; }
      if (!v) {
        const group = buildWeed(w.kind, hashStr(w.id));
        group.position.set(w.tx + w.ox, 0, w.tz + w.oz);
        group.rotation.y = w.kind === 'vine' ? 0 : hashStr(w.id) % 6; // 藤蔓貼著牆，不能轉
        this.root.add(group);
        v = { group, kind: w.kind, tug: 0, pop: 0, shake: 0 };
        this.views.set(w.id, v);
      }
      v.pop = Math.min(1, v.pop + dt * 2.5);
      v.shake = Math.max(0, v.shake - dt * 4);
      const sq = v.group.userData.squash as THREE.Group;
      // 被拉：Y 拉長、XZ 變細（擠壓伸展）
      const stretch = 1 + v.tug * 0.45;
      const thin = 1 / Math.sqrt(stretch);
      const popIn = v.pop < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - v.pop, 3)) : 1;
      sq.scale.set(thin * popIn, stretch * popIn, thin * popIn);
      sq.rotation.z = Math.sin(t * 50) * 0.08 * (v.tug > 0 ? 1 : v.shake);
      const q = this.queued.has(w.id);
      sq.position.y = q ? Math.abs(Math.sin(t * 6)) * 0.04 : 0;
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) { this.root.remove(v.group); this.views.delete(id); }
    }
  }
}
