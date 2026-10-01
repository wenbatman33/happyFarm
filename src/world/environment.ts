import * as THREE from 'three';
import { bakeGroup } from './bake';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropPlacement, SceneLayout } from '../config/layout';
import type { Season } from '../core/clock';
import { mulberry32 } from '../core/rng';
import { GEO, mat, mesh, withWind } from './materials';
import type { Grid } from './grid';
import { GrassField, grassGroundTexture } from './grass';
import { TreeMats, buildTree, clumpGeo, setTreeSeason, type TreeParts } from './trees3d';
import type { FestivalId } from '../data/festivals';
import { Kit, bake, buildFestival, lightString, stick, type Deco, type GlowMat, type HouseFest } from './festive3d';
import { GH_WALL_X, GH_WALL_Z, buildGreenhouse } from './greenhouse3d';
import { MARKET_D, MARKET_W, buildMarket, type MarketKind } from './market3d';
import { FIELD_COLS, FIELD_ROWS } from '../systems/farm';
import { clock } from '../core/clock';
import {
  POND_BUILD_BLOCK, POND_RX, POND_RZ, POND_SIGN, PondFx, buildBeehive, buildHiveStand, buildPetHouse, buildPond, buildTelescope,
  inPondEllipse, paintPondHollow, pondClearsGrass, pondUniforms, updateBeehive, updateTelescope,
} from './props3d';

export { POND_WATER_Y } from './props3d';
// 蜂箱位置的狀態：none = 尚未解鎖（什麼都沒有）、empty = 空木架＋小木牌、hive = 完整蜂箱＋蜜蜂
export type HiveSlot = 'none' | 'empty' | 'hive';

const rbox = (w: number, h: number, d: number, r = 0.06, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

interface Palette { ground: string; ground2: string; grass: string[]; leaves: string[]; hill: string; flowers: number }
export const SEASON_PALETTE: Record<Season, Palette> = {
  spring: { ground: '#8fd16a', ground2: '#78c257', grass: ['#8fdc6a', '#a6e37a', '#79c95a'], leaves: ['#7fcf5c', '#f4b6cf', '#96d86e'], hill: '#86c965', flowers: 1 },
  summer: { ground: '#6fbf4b', ground2: '#5aab3f', grass: ['#6fca4a', '#5cb843', '#84d45a'], leaves: ['#4fae3f', '#5fbf49', '#3f9a36'], hill: '#5fae44', flowers: 1 },
  autumn: { ground: '#9fbe58', ground2: '#aebb56', grass: ['#b9cc5c', '#c7c865', '#a8c458'], leaves: ['#f08a3c', '#e8603a', '#f2b447'], hill: '#b3a85a', flowers: 0.4 },
  winter: { ground: '#eef3f8', ground2: '#dde6ee', grass: ['#e9f0f6', '#d8e2ea', '#f4f8fb'], leaves: ['#eef4f9', '#dfe9f1', '#cfdbe6'], hill: '#e6edf3', flowers: 0 },
};

// T5 風車塔在房屋本地座標的位置（房屋右後方，避開加工坊與果園）
const WINDMILL = { x: 3.6, z: -3.8, yaw: -0.35 };

interface HouseMats { W: number; H: number; D: number; base: number; wall: THREE.Material; wallDark: THREE.Material; trim: THREE.Material; roofMat: THREE.Material; stone: THREE.Material }

export type PropKey = 'house' | 'doghouse' | 'mailbox' | 'compost' | `tree${number}` | `rock${number}`;

export class World {
  root = new THREE.Group();
  props = new Map<string, { obj: THREE.Object3D; place: PropPlacement }>();
  interactive: THREE.Object3D[] = [];
  houseTier = 1;
  season: Season = 'summer';

  private groundGeo!: THREE.PlaneGeometry;
  grassField!: GrassField;
  private flowers!: THREE.InstancedMesh;
  private treeMats = new TreeMats();
  private trees: TreeParts[] = [];
  private hillMat = mat('#5fae44', { roughness: 0.95 });
  private windowMats: THREE.MeshStandardMaterial[] = []; // 加工坊等固定建物的窗
  private houseWindows: THREE.MeshStandardMaterial[] = []; // 房屋的窗（換階段時重建）
  private glowSets = new Map<string, GlowMat[]>(); // 其他夜間發光材質（燈串、燈籠）
  private ticks = new Map<string, (dt: number, t: number, glow: number) => void>();
  greenhouseLevel = 0;
  greenhouseBuilding = false;
  marketKind: MarketKind = 'none';
  festival: FestivalId | null = null;
  private greenhouse: { group: THREE.Object3D; hit: THREE.Object3D } | null = null;
  private market: { group: THREE.Object3D; hit: THREE.Object3D } | null = null;
  private festDeco: Deco | null = null;
  private lantern = new THREE.PointLight('#ffc46b', 0, 7, 1.6);
  private lanternMat = mat('#ffe2a0', { emissive: '#ffb347', emissiveIntensity: 0 });
  private fireflies!: THREE.Points;
  private clouds: THREE.Group[] = [];
  private smoke: { m: THREE.Mesh; life: number }[] = [];
  private smokeMat = mat('#ffffff', { transparent: true, opacity: 0.7, roughness: 1 });
  private smokeTimer = 0;
  private troughHay!: THREE.Object3D;
  private scaffold: THREE.Group | null = null;
  private mailFlag!: THREE.Object3D;
  private decorIds: string[] = [];
  private decorSeason: Season = 'autumn';
  private scarecrow: THREE.Group | null = null;
  private wreath: THREE.Group | null = null;
  workshopBusy = false;
  private wsSmokeT = 0;
  // 池塘（Lv30）
  pondLevel: 0 | 1 = 0;
  pondBuilding = false;
  private pond: { group: THREE.Object3D; hit: THREE.Object3D } | null = null;
  private pondFx = new PondFx();
  // 寵物小屋、蜂箱、望遠鏡
  petHouseTier: 1 | 2 = 1;
  beehiveSlots: HiveSlot[] = [];
  beehiveReady: boolean[] = []; // 由蜂箱系統每幀設定：哪一格的蜂蜜可以收
  private hives: (THREE.Group | null)[] = [];
  telescopeOn = false;
  private telescope: THREE.Group | null = null;
  onRebuildGrid?: () => void; // 讓其他系統（障礙物）補上自己的阻擋格

  constructor(scene: THREE.Scene, private grid: Grid, private layout: SceneLayout) {
    scene.add(this.root);
    this.buildGround();
    this.buildPath();
    this.buildFence();
    this.buildHills();
    this.buildClouds();
    this.addProp('house', this.makeHouse(1), layout.house);
    this.addProp('doghouse', this.makeDoghouse(), layout.doghouse);
    this.addProp('mailbox', this.makeMailbox(), layout.mailbox);
    this.addProp('compost', this.makeCompost(), layout.compost);
    this.addProp('workshop', this.makeWorkshop(), layout.workshop);
    this.buildRanch();
    layout.trees.forEach((t, i) => this.addProp(`tree${i}`, this.makeTree(i), t));
    layout.rocks.forEach((r, i) => this.addProp(`rock${i}`, this.makeRock(i), r));
    this.placeGreenhouse();
    this.root.add(this.pondFx.group);
    this.placePond();
    this.rebuildGrid();
    this.buildGrass();
    this.applyGrassMask();
    this.buildFireflies();
    this.root.add(this.lantern);
  }

  private addProp(key: string, obj: THREE.Object3D, place: PropPlacement) {
    obj.userData.propKey = key;
    this.props.set(key, { obj, place });
    this.root.add(obj);
    this.placeProp(key);
  }

  placeProp(key: string): void {
    const p = this.props.get(key);
    if (!p) return;
    p.obj.position.set(p.place.x, 0, p.place.z);
    p.obj.rotation.y = p.place.rotY;
    p.obj.scale.setScalar(p.place.scale);
    if (key === 'house') {
      const lp = new THREE.Vector3(1.9, 1.7, 3.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.place.rotY);
      this.lantern.position.set(p.place.x + lp.x, lp.y, p.place.z + lp.z);
    }
  }

  // 依物件擺放重新計算阻擋格
  rebuildGrid(): void {
    const g = this.grid;
    g.clear();
    const L = this.layout;
    if (this.houseTier >= 4) g.blockRect(L.house.x - 1.1, L.house.z, 8.4 * L.house.scale, 5 * L.house.scale); // T4/T5 雙層＋側翼／玻璃屋
    else if (this.houseTier >= 3) g.blockRect(L.house.x - 1.1, L.house.z, 8.2 * L.house.scale, 5 * L.house.scale); // T3 左側加蓋
    else g.blockRect(L.house.x, L.house.z, 6 * L.house.scale, 5 * L.house.scale);
    if (this.houseTier >= 5) { const w = this.houseToWorld(WINDMILL.x, WINDMILL.z); g.blockRect(w.x, w.z, 2.0, 2.0); } // 風車塔
    g.blockRect(L.workshop.x, L.workshop.z, 2.6, 2.2);
    if (this.petHouseTier >= 2) this.blockRotRect(L.doghouse, 2.2 * L.doghouse.scale, 1.8 * L.doghouse.scale);
    else g.blockRect(L.doghouse.x, L.doghouse.z, 1.3, 1.3);
    g.blockRect(L.mailbox.x, L.mailbox.z, 0.3, 0.3);
    g.blockRect(L.compost.x, L.compost.z, 0.6, 0.6);
    L.trees.forEach((t) => g.blockRect(t.x, t.z, 0.4, 0.4));
    L.rocks.forEach((r) => { if (r.scale >= 0.9) g.blockRect(r.x, r.z, 0.3, 0.3); });
    // 圍籬：±14，南側留門
    for (let i = -15; i <= 15; i++) {
      for (let j = -15; j <= 15; j++) {
        const edge = Math.abs(i) >= 14 || Math.abs(j) >= 14;
        const gate = j >= 14 && Math.abs(i) <= 1 && j === 14;
        if (edge && !gate) g.blocked[g.idx(i, j)] = 1;
      }
    }
    for (let z = Math.round(L.house.z + 3.5); z <= 13; z++) g.path[g.idx(Math.round(L.house.x), z)] = 1;
    // 牧場：柵欄在 cx±3、cz±2.5 的格線上，東側中間兩格是門
    const rx = Math.round(L.ranch.x), rz = L.ranch.z;
    const z0 = Math.round(rz - 2.5), z1 = Math.round(rz + 2.5);
    for (let z = z0; z <= z1; z++) {
      g.blocked[g.idx(rx - 3, z)] = 1;
      if (Math.abs(z - rz) > 1) g.blocked[g.idx(rx + 3, z)] = 1;
    }
    for (let x = rx - 3; x <= rx + 3; x++) { g.blocked[g.idx(x, z0)] = 1; g.blocked[g.idx(x, z1)] = 1; }
    g.blockRect(rx - 1.6, rz - 1.35, 1.6, 0.6); // 穀倉
    g.blockRect(rx - 3.9, rz - 1.8, 0.3, 0.3); // 乾草堆
    this.blockGreenhouse();
    this.blockPond();
    L.beehives.forEach((h, i) => { if (this.beehiveSlots[i] === 'hive') g.blockRect(h.x, h.z, 0.6, 0.6); });
    if (this.telescopeOn) g.blockRect(L.telescope.x, L.telescope.z, 0.8, 0.8);
    if (this.marketKind !== 'none') this.blockRotRect(L.market, MARKET_W, MARKET_D);
    for (const [x, z] of this.festDeco?.block ?? []) if (g.inBounds(x, z)) g.blocked[g.idx(x, z)] = 1;
    this.onRebuildGrid?.();
    this.applyGrassMask();
  }

  // 草毯遮罩：被擋住的格子（牆、障礙物）不長草；清掉障礙物後草會回來
  private applyGrassMask(): void {
    if (!this.grassField) return;
    const g = this.grid;
    const L = this.layout;
    const gh = this.greenhouseLevel >= 1 || this.greenhouseBuilding;
    const mk = this.marketKind !== 'none';
    this.grassField.applyMask((x, z) => g.isBlocked(Math.round(x), Math.round(z)) || this.noGrassAt(x, z) || this.pondNoGrass(x, z) ||
      (gh && this.inRotRect(L.greenhouse, x, z, GH_WALL_X * 2, GH_WALL_Z * 2)) ||
      (mk && this.inRotRect(L.market, x, z, MARKET_W, MARKET_D)));
  }

  // 依目前房屋階段額外清出的地面（門廊、加蓋）
  private noGrassAt(x: number, z: number): boolean {
    const L = this.layout.house;
    const dx = x - L.x, dz = z - L.z;
    const left = this.houseTier >= 3 ? 5.6 : 3.8;
    return dx > -left && dx < 3.8 && Math.abs(dz) < 3.4;
  }

  // 房屋本地座標 → 世界座標
  private houseToWorld(x: number, z: number): { x: number; z: number } {
    const h = this.layout.house, c = Math.cos(h.rotY), s = Math.sin(h.rotY);
    return { x: h.x + (x * c + z * s) * h.scale, z: h.z + (-x * s + z * c) * h.scale };
  }

  // 世界點是否落在（可旋轉的）矩形內；w 沿本地 x、d 沿本地 z
  private inRotRect(p: PropPlacement, x: number, z: number, w: number, d: number, pad = 0): boolean {
    const c = Math.cos(p.rotY), s = Math.sin(p.rotY), dx = x - p.x, dz = z - p.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < w / 2 + pad && Math.abs(lz) < d / 2 + pad;
  }

  private blockRotRect(p: PropPlacement, w: number, d: number): void {
    const g = this.grid, r = Math.ceil(Math.max(w, d) / 2) + 1;
    for (let z = Math.round(p.z) - r; z <= Math.round(p.z) + r; z++) for (let x = Math.round(p.x) - r; x <= Math.round(p.x) + r; x++) {
      if (g.inBounds(x, z) && this.inRotRect(p, x, z, w, d, 0.2)) g.blocked[g.idx(x, z)] = 1;
    }
  }

  // 溫室：外框一圈擋住（南側中央門口留空），內部可以走；預定地只擋木牌那格
  private blockGreenhouse(): void {
    const g = this.grid, L = this.layout.greenhouse;
    const c = Math.cos(L.rotY), s = Math.sin(L.rotY);
    const block = (dx: number, dz: number) => {
      const x = Math.round(L.x + dx * c + dz * s), z = Math.round(L.z - dx * s + dz * c);
      if (g.inBounds(x, z)) g.blocked[g.idx(x, z)] = 1;
    };
    if (this.greenhouseLevel < 1 && !this.greenhouseBuilding) { block(0, 2); return; }
    for (let dx = -4; dx <= 4; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) !== 4 && Math.abs(dz) !== 2) continue;
      if (dx === 0 && dz === 2) continue; // 門口
      block(dx, dz);
    }
  }

  // ---------- 池塘（Lv30） ----------
  // 世界座標 → 池塘本地座標（含旋轉、縮放）
  private pondLocal(x: number, z: number): [number, number] {
    const p = this.layout.pond, c = Math.cos(p.rotY), s = Math.sin(p.rotY);
    const dx = (x - p.x) / p.scale, dz = (z - p.z) / p.scale;
    return [dx * c - dz * s, dx * s + dz * c];
  }

  private pondToWorld(lx: number, lz: number): { x: number; z: number } {
    const p = this.layout.pond, c = Math.cos(p.rotY), s = Math.sin(p.rotY);
    return { x: p.x + (lx * c + lz * s) * p.scale, z: p.z + (-lx * s + lz * c) * p.scale };
  }

  private pondNoGrass(x: number, z: number): boolean {
    const [lx, lz] = this.pondLocal(x, z);
    if (Math.abs(lx) > POND_RX * 1.5 || Math.abs(lz) > POND_RZ * 1.6) return false;
    return pondClearsGrass(lx, lz, this.pondLevel, this.pondBuilding);
  }

  // 有水（或施工中的坑）：中心落在水面橢圓 ×1.05 內的格子都擋住，岸邊一圈可以走；預定地只擋木牌那格
  private blockPond(): void {
    const g = this.grid, p = this.layout.pond;
    const block = (x: number, z: number) => { if (g.inBounds(x, z)) g.blocked[g.idx(x, z)] = 1; };
    const atLocal = (lx: number, lz: number) => { const w = this.pondToWorld(lx, lz); block(Math.round(w.x), Math.round(w.z)); };
    if (this.pondLevel >= 1 || this.pondBuilding) {
      const r = Math.ceil(POND_RX * 1.05 * p.scale) + 1;
      for (let z = Math.round(p.z) - r; z <= Math.round(p.z) + r; z++) for (let x = Math.round(p.x) - r; x <= Math.round(p.x) + r; x++) {
        const [lx, lz] = this.pondLocal(x, z);
        if (inPondEllipse(lx, lz, 1.05)) block(x, z);
      }
    }
    if (this.pondLevel < 1) atLocal(POND_SIGN[0], POND_SIGN[1]);
    if (this.pondLevel < 1 && this.pondBuilding) for (const [lx, lz] of POND_BUILD_BLOCK) atLocal(lx, lz);
  }

  // level 0 = 預定地；building = 挖池塘中；1 = 有水的池塘
  setPond(level: 0 | 1, building = false): void {
    this.pondLevel = level >= 1 ? 1 : 0;
    this.pondBuilding = building;
    this.placePond();
    this.rebuildGrid();
  }

  private placePond(): void {
    if (this.pond) {
      this.root.remove(this.pond.group);
      this.interactive = this.interactive.filter((o) => o !== this.pond!.hit);
    }
    const d = buildPond(this.pondLevel, this.pondBuilding);
    const L = this.layout.pond;
    d.group.position.set(L.x, 0, L.z);
    d.group.rotation.y = L.rotY;
    d.group.scale.setScalar(L.scale);
    this.root.add(d.group);
    this.interactive.push(d.hit);
    this.glowSets.set('pond', d.glow);
    this.pond = { group: d.group, hit: d.hit };
    const pal = SEASON_PALETTE[this.season];
    paintPondHollow(d.group, pal.ground, pal.ground2);
    this.pondFx.setPond(L.x, L.z, L.rotY, L.scale, this.pondLevel >= 1);
  }

  // 水面上 (x,z) 冒出一圈往外擴散的漣漪（鴨子游泳、種／收蓮花時呼叫）
  pondRipple(x: number, z: number, size = 1): void {
    this.pondFx.ripple(x, z, size);
  }

  // ---------- 寵物小屋、蜂箱、望遠鏡 ----------
  setPetHouseTier(tier: 1 | 2): void {
    const t: 1 | 2 = tier >= 2 ? 2 : 1;
    if (t === this.petHouseTier) return;
    this.petHouseTier = t;
    const entry = this.props.get('doghouse')!;
    this.root.remove(entry.obj);
    this.interactive = this.interactive.filter((o) => o !== entry.obj);
    const h = this.makeDoghouse();
    h.userData.propKey = 'doghouse';
    entry.obj = h;
    this.root.add(h);
    this.placeProp('doghouse');
    this.rebuildGrid();
  }

  // 每個 SCENE_LAYOUT.beehives 位置一個狀態；只有變動的位置會重建
  setBeehives(slots: HiveSlot[]): void {
    const L = this.layout.beehives;
    let changed = false;
    L.forEach((p, i) => {
      const want: HiveSlot = slots[i] ?? 'none';
      if (this.beehiveSlots[i] === want && (want === 'none') === !this.hives[i]) return;
      changed = true;
      const old = this.hives[i];
      if (old) {
        this.root.remove(old);
        this.interactive = this.interactive.filter((o) => o !== old);
      }
      this.hives[i] = null;
      this.beehiveSlots[i] = want;
      if (want === 'none') return;
      const o = want === 'hive' ? buildBeehive() : buildHiveStand();
      o.userData.kind = 'beehive';
      o.userData.slot = i;
      o.userData.hive = want;
      o.position.set(p.x, 0, p.z);
      o.rotation.y = p.rotY;
      o.scale.setScalar(p.scale);
      this.root.add(o);
      this.interactive.push(o);
      this.hives[i] = o;
    });
    while (this.beehiveReady.length < L.length) this.beehiveReady.push(false);
    if (changed) this.rebuildGrid();
  }

  setTelescope(on: boolean): void {
    if (on === this.telescopeOn) return;
    this.telescopeOn = on;
    if (this.telescope) {
      this.root.remove(this.telescope);
      this.interactive = this.interactive.filter((o) => o !== this.telescope);
      this.telescope = null;
      this.glowSets.delete('telescope');
    }
    if (on) {
      const t = buildTelescope();
      t.userData.kind = 'telescope';
      const p = this.layout.telescope;
      t.position.set(p.x, 0, p.z);
      t.rotation.y = p.rotY;
      t.scale.setScalar(p.scale);
      this.root.add(t);
      this.interactive.push(t);
      this.glowSets.set('telescope', t.userData.glow);
      this.telescope = t;
    }
    this.rebuildGrid();
  }

  // ---------- 溫室（Lv40） ----------
  // level 0 = 預定地木牌；1..3 = 各期溫室；building = 施工中（鷹架、帆布、木箱）
  setGreenhouse(level: number, building = false): void {
    this.greenhouseLevel = Math.max(0, Math.min(3, Math.floor(level)));
    this.greenhouseBuilding = building;
    this.placeGreenhouse();
    this.rebuildGrid();
  }

  private placeGreenhouse(): void {
    if (this.greenhouse) {
      this.root.remove(this.greenhouse.group);
      this.interactive = this.interactive.filter((o) => o !== this.greenhouse!.hit);
    }
    const d = buildGreenhouse(this.greenhouseLevel, this.greenhouseBuilding);
    const L = this.layout.greenhouse;
    d.group.position.set(L.x, 0, L.z);
    d.group.rotation.y = L.rotY;
    this.root.add(d.group);
    this.interactive.push(d.hit);
    this.glowSets.set('greenhouse', d.glow);
    this.greenhouse = { group: d.group, hit: d.hit };
  }

  // ---------- 週末市集／流浪商人 ----------
  setMarket(kind: MarketKind): void {
    this.marketKind = kind;
    if (this.market) {
      this.root.remove(this.market.group);
      this.interactive = this.interactive.filter((o) => o !== this.market!.hit);
      this.market = null;
    }
    this.glowSets.delete('market');
    this.ticks.delete('market');
    if (kind !== 'none') {
      const d = buildMarket(kind);
      const L = this.layout.market;
      d.group.position.set(L.x, 0, L.z);
      d.group.rotation.y = L.rotY;
      this.root.add(d.group);
      this.interactive.push(d.hit);
      this.glowSets.set('market', d.glow);
      if (d.tick) this.ticks.set('market', d.tick);
      this.market = { group: d.group, hit: d.hit };
    }
    this.rebuildGrid();
  }

  // ---------- 節慶裝飾 ----------
  setFestival(id: FestivalId | null): void {
    this.festival = id;
    this.applyFestival();
    this.rebuildGrid();
  }

  // 依目前房屋階段（重新）掛上節慶裝飾；換房屋階段時也會呼叫
  private applyFestival(): void {
    const old = this.festDeco;
    if (old) {
      this.root.remove(old.group);
      old.local?.parent?.remove(old.local);
      this.festDeco = null;
    }
    this.glowSets.delete('festival');
    this.ticks.delete('festival');
    if (!this.festival) return;
    const house = this.props.get('house')!.obj;
    const L = this.layout;
    const d = buildFestival(this.festival, {
      fest: house.userData.fest as HouseFest,
      houseX: L.house.x,
      houseZ: L.house.z,
      pathX: L.house.x,
      pathZ0: L.house.z + 3.6,
      gateZ: 14.2,
    });
    this.root.add(d.group);
    if (d.local) house.add(d.local);
    this.glowSets.set('festival', d.glow);
    if (d.tick) this.ticks.set('festival', d.tick);
    this.festDeco = d;
  }

  // ---------- 地面、草、花 ----------
  private buildGround() {
    this.groundGeo = new THREE.PlaneGeometry(220, 220, 110, 110);
    this.groundGeo.rotateX(-Math.PI / 2);
    const pos = this.groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.max(Math.abs(x), Math.abs(z));
      // 圍籬外的地面有起伏，圍籬內保持平坦
      const hill = r > 17 ? (Math.sin(x * 0.11) + Math.cos(z * 0.13) + 1.2) * Math.min(1, (r - 17) / 12) * 0.9 : 0;
      pos.setY(i, hill - 0.02);
    }
    this.groundGeo.computeVertexNormals();
    this.groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3));
    // 草的細節畫在地面貼圖上（4 公尺一塊拼接；有 mipmap，遠近都不會閃）
    const tex = grassGroundTexture();
    tex.repeat.set(220 / 4, 220 / 4);
    const ground = new THREE.Mesh(this.groundGeo, mat('#ffffff', { vertexColors: true, roughness: 0.95, map: tex }));
    ground.receiveShadow = true;
    ground.userData.ground = true;
    this.root.add(ground);
  }

  private paintGround(p: Palette) {
    const pos = this.groundGeo.attributes.position;
    const col = this.groundGeo.attributes.color as THREE.BufferAttribute;
    const a = new THREE.Color(p.ground), b = new THREE.Color(p.ground2), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.37 + z * 0.21) + 0.25 * Math.sin(x * 0.13 - z * 0.41);
      tmp.copy(a).lerp(b, n);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
  }

  private buildPath() {
    const rand = mulberry32(7);
    const stoneMat = mat('#d8cbb3', { roughness: 0.9 });
    const L = this.layout;
    const path = new THREE.Group();
    for (let z = Math.round(L.house.z + 3.3); z <= 14.5; z += 0.9) {
      for (const side of [-0.28, 0.28]) {
        const s = mesh(GEO.cyl, stoneMat, false);
        s.scale.set(0.42 + rand() * 0.14, 0.06, 0.34 + rand() * 0.12);
        s.position.set(L.house.x + side + (rand() - 0.5) * 0.15, 0.02, z + (rand() - 0.5) * 0.3);
        s.rotation.y = rand() * Math.PI;
        path.add(s);
      }
    }
    bakeGroup(path); // 效能：40 幾塊石板合併成一個網格
    this.root.add(path);
  }

  private grassT = 0;

  private buildGrass() {
    const L = this.layout;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // 靜態排除：田區、小徑、房屋本體（其餘由 applyGrassMask 動態隱藏）
    this.grassField = new GrassField(coarse ? 1100 : 2000, coarse ? 400 : 700, (x, z) =>
      (Math.abs(x - L.house.x) < 3.8 && Math.abs(z - L.house.z) < 3.4) ||
      (x > L.field.x - 0.9 && x < L.field.x + FIELD_COLS - 0.1 && z > L.field.z - 0.9 && z < L.field.z + FIELD_ROWS - 0.1) ||
      (Math.abs(x - L.house.x) < 0.9 && z > L.house.z));
    this.root.add(this.grassField.inside, this.grassField.outside);
    const rand = mulberry32(42);

    // 小花：稈＋花頭（兩個 InstancedMesh）
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const fc = 90;
    const headGeo = new THREE.SphereGeometry(0.08, 8, 6);
    headGeo.translate(0, 0.32, 0);
    this.flowers = new THREE.InstancedMesh(headGeo, withWind(mat('#ffffff', { roughness: 0.6 }), 0.9), fc);
    const stems = new THREE.InstancedMesh((() => { const g = new THREE.CylinderGeometry(0.012, 0.015, 0.32, 4); g.translate(0, 0.16, 0); return g; })(), withWind(mat('#4f9a3a'), 0.9), fc);
    const colors = ['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff', '#ff9a4a'];
    for (let i = 0; i < fc; i++) {
      // 集中在房屋前、圍籬邊
      const nearHouse = i < 40;
      const x = nearHouse ? L.house.x + (rand() - 0.5) * 7 : (rand() < 0.5 ? -1 : 1) * (12.4 + rand() * 1.2);
      const z = nearHouse ? L.house.z + 2.9 + rand() * 0.8 : (rand() - 0.5) * 26;
      if (nearHouse && Math.abs(x - L.house.x) < 1.9) { i--; continue; }
      if (!nearHouse && inPondEllipse(...this.pondLocal(x, z), 1.45)) { i--; continue; } // 池塘一帶不長小花
      const sc = 0.8 + rand() * 0.6;
      m.compose(v.set(x, 0, z), q.identity(), s.set(sc, sc, sc));
      this.flowers.setMatrixAt(i, m);
      stems.setMatrixAt(i, m);
      this.flowers.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    }
    this.flowers.castShadow = true;
    this.root.add(this.flowers, stems);
    this.flowers.userData.stems = stems;
  }

  // 割草：半徑內的草變短，回傳這次割到幾叢（換算成舊版叢數）
  mowGrass(x: number, z: number, r: number, now: number): number {
    return this.grassField.mow(x, z, r, now);
  }

  // 會把草推開的角色位置（主角、寵物、乳牛）
  setGrassPushers(pts: (THREE.Vector3 | null)[]): void {
    this.grassField.setPushers(pts);
  }

  get leafColor(): THREE.Color { return this.treeMats.leaves[0].color; }

  applySeason(season: Season): void {
    this.season = season;
    const p = SEASON_PALETTE[season];
    this.paintGround(p);
    if (this.pond) paintPondHollow(this.pond.group, p.ground, p.ground2);
    this.grassField.setSeason(p, season);
    this.treeMats.setSeason(p.leaves);
    this.trees.forEach((t) => setTreeSeason(t, season));
    this.hillMat.color.set(p.hill);
    const showCount = Math.round(this.flowers.count * p.flowers);
    this.flowers.visible = showCount > 0;
    (this.flowers.userData.stems as THREE.InstancedMesh).visible = showCount > 0;
    this.flowers.count = Math.max(1, showCount);
    (this.flowers.userData.stems as THREE.InstancedMesh).count = Math.max(1, showCount);
  }

  // ---------- 圍籬、遠景 ----------
  private buildFence() {
    const woodMat = mat('#dcb88c', { roughness: 0.8 });
    const posts: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const E = 14.2;
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.round(len / 1.4);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        posts.push(new THREE.Matrix4().makeTranslation(x1 + (x2 - x1) * t, 0.42, z1 + (z2 - z1) * t));
      }
      q.setFromAxisAngle(v.set(0, 1, 0), Math.atan2(-(z2 - z1), x2 - x1));
      for (const h of [0.35, 0.65]) rails.push(m.clone().compose(v.set((x1 + x2) / 2, h, (z1 + z2) / 2), q, s.set(len, 1, 1)));
    };
    seg(-E, -E, E, -E);
    seg(-E, -E, -E, E);
    seg(E, -E, E, E);
    seg(-E, E, -1.6, E);
    seg(1.6, E, E, E);
    const postMesh = new THREE.InstancedMesh(rbox(0.16, 0.84, 0.16, 0.05), woodMat, posts.length);
    posts.forEach((pm, i) => postMesh.setMatrixAt(i, pm));
    const railMesh = new THREE.InstancedMesh(rbox(1, 0.09, 0.06, 0.03), woodMat, rails.length);
    rails.forEach((rm, i) => railMesh.setMatrixAt(i, rm));
    for (const im of [postMesh, railMesh]) { im.castShadow = true; im.receiveShadow = true; this.root.add(im); }
  }

  private buildHills() {
    const rand = mulberry32(3);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
      const r = 48 + rand() * 30;
      const h = mesh(GEO.sphere, this.hillMat, false);
      h.scale.set(30 + rand() * 25, 8 + rand() * 10, 22 + rand() * 12);
      h.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      this.root.add(h);
    }
    // 遠景樹林
    const count = 70;
    const foliage = new THREE.InstancedMesh(clumpGeo(0), this.treeMats.leaves[0], count); // 葉材質用頂點色，幾何必須帶 color
    const trunks = new THREE.InstancedMesh(GEO.cyl, mat('#8a5a3a'), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 20 + rand() * 18;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 16 && Math.abs(x) < 20) { i--; continue; } // 鏡頭前方保持開闊
      const sc = 1.6 + rand() * 1.6;
      const gy = (Math.sin(x * 0.11) + Math.cos(z * 0.13) + 1.2) * 0.9;
      foliage.setMatrixAt(i, m.compose(v.set(x, gy + sc * 1.3, z), q, s.set(sc * 1.6, sc * 1.8, sc * 1.6)));
      trunks.setMatrixAt(i, m.compose(v.set(x, gy + sc * 0.4, z), q, s.set(0.35, sc * 0.9, 0.35)));
    }
    foliage.castShadow = true;
    this.root.add(foliage, trunks);
  }

  private buildClouds() {
    const cm = mat('#ffffff', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.25 });
    const rand = mulberry32(11);
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        const s = mesh(GEO.sphereLo, cm, false);
        const sc = 5 + rand() * 5;
        s.scale.set(sc * 1.4, sc * 0.8, sc);
        s.position.set(j * 4 - n * 2 + rand() * 2, rand() * 2, rand() * 3);
        g.add(s);
      }
      const a = rand() * Math.PI * 2;
      g.position.set(Math.cos(a) * (70 + rand() * 40), 38 + rand() * 12, Math.sin(a) * (70 + rand() * 40) - 30);
      g.userData.speed = 0.4 + rand() * 0.6;
      this.clouds.push(g);
      this.root.add(g);
    }
  }

  private buildFireflies() {
    const n = 46;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    const rand = mulberry32(5);
    for (let i = 0; i < n; i++) { arr[i * 3] = (rand() - 0.5) * 26; arr[i * 3 + 1] = 0.4 + rand() * 1.6; arr[i * 3 + 2] = (rand() - 0.5) * 26; }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.userData.base = arr.slice();
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff4a8', size: 0.16, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.root.add(this.fireflies);
  }


  // ---------- 牧場 ----------
  // 牛站的照顧位置、主角站的位置（都是世界座標）
  get cowCareSpot(): { x: number; z: number } { const r = this.layout.ranch; return { x: r.x + 0.8, z: r.z - 0.8 }; }
  get cowSleepSpot(): { x: number; z: number } { const r = this.layout.ranch; return { x: r.x - 1.6, z: r.z - 0.1 }; }
  get ranchBounds(): { x0: number; x1: number; z0: number; z1: number } { const r = this.layout.ranch; return { x0: r.x - 2, x1: r.x + 2, z0: r.z - 0.9, z1: r.z + 1.6 }; }

  setTroughHay(on: boolean): void { this.troughHay.visible = on; }

  private buildRanch() {
    const r = this.layout.ranch;
    const g = new THREE.Group();
    g.position.set(r.x, 0, r.z);
    this.root.add(g);
    const white = mat('#f6f0e4', { roughness: 0.7 });
    // 柵欄（東側留門）
    const post = rbox(0.14, 0.9, 0.14, 0.05);
    const addPost = (x: number, z: number) => { const m = mesh(post, white); m.position.set(x, 0.45, z); g.add(m); };
    const addRail = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (const h of [0.38, 0.7]) {
        const m = mesh(rbox(len, 0.09, 0.06, 0.03), white);
        m.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
        m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
        g.add(m);
      }
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) addPost(x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n);
    };
    addRail(-3, -2.5, 3, -2.5);
    addRail(-3, 2.5, 3, 2.5);
    addRail(-3, -2.5, -3, 2.5);
    addRail(3, -2.5, 3, -0.9);
    addRail(3, 0.9, 3, 2.5);
    // 紅色小穀倉（門朝南，也就是鏡頭這側）
    const barn = new THREE.Group();
    barn.position.set(-1.6, 0, -1.35);
    const red = mat('#c9453a', { roughness: 0.75 });
    const body = mesh(rbox(1.9, 1.3, 1.4, 0.08), red);
    body.position.y = 0.65;
    barn.add(body);
    for (const s of [1, -1]) {
      const roof = mesh(rbox(2.2, 0.1, 0.95, 0.04), mat('#5b4a44'));
      roof.position.set(0, 1.58, s * 0.36);
      roof.rotation.x = s * 0.62;
      barn.add(roof);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-0.95, 0); tri.lineTo(0.95, 0); tri.lineTo(0, 0.58); tri.closePath();
    const gable = mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.3, bevelEnabled: false }), red);
    gable.position.set(0, 1.3, -0.65);
    barn.add(gable);
    const door = mesh(rbox(0.8, 0.95, 0.06, 0.03), mat('#8a2f28'));
    door.position.set(0, 0.5, 0.71);
    barn.add(door);
    for (const rz of [0.75, -0.75]) {
      const x = mesh(rbox(1.05, 0.07, 0.04, 0.02), white, false);
      x.position.set(0, 0.5, 0.75);
      x.rotation.z = rz;
      barn.add(x);
    }
    const trimTop = mesh(rbox(0.86, 0.07, 0.05, 0.02), white, false);
    trimTop.position.set(0, 0.99, 0.74);
    barn.add(trimTop);
    g.add(barn);
    // 飼料槽：沿北側柵欄，餵過才看得到牧草
    const trough = new THREE.Group();
    trough.position.set(0.8, 0, -1.95);
    const wood = mat('#a8804e');
    const tBody = mesh(rbox(1.4, 0.36, 0.5, 0.05), wood);
    tBody.position.y = 0.3;
    const tIn = mesh(rbox(1.25, 0.05, 0.36, 0.02), mat('#5e4128'), false);
    tIn.position.y = 0.46;
    trough.add(tBody, tIn);
    for (const lx of [-0.55, 0.55]) {
      const leg = mesh(rbox(0.1, 0.16, 0.4, 0.03), wood);
      leg.position.set(lx, 0.08, 0);
      trough.add(leg);
    }
    const hay = new THREE.Group();
    const hayMat = mat('#e8c65a', { roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const h = mesh(GEO.sphereLo, hayMat, false);
      h.scale.set(0.34, 0.14, 0.26);
      h.position.set(-0.5 + (i % 5) * 0.25, 0.52 + (i > 4 ? 0.05 : 0), (i % 2 ? 0.06 : -0.06));
      hay.add(h);
    }
    trough.add(hay);
    this.troughHay = hay;
    g.add(trough);
    // 柵欄外的乾草捆
    const bales = new THREE.Group();
    bales.position.set(-3.9, 0, -1.8);
    const baleGeo = rbox(0.9, 0.5, 0.55, 0.12);
    const baleMat = mat('#e2bd55', { roughness: 0.95 });
    [[0, 0.25, 0], [0.1, 0.75, 0.05], [-0.05, 0.25, 0.6]].forEach(([x, y, z], i) => {
      const b = mesh(baleGeo, baleMat);
      b.position.set(x, y, z);
      b.rotation.y = i * 0.4;
      bales.add(b);
    });
    g.add(bales);
  }

  setMailFlag(up: boolean): void {
    const goal = up ? 0 : -Math.PI / 2;
    this.mailFlag.rotation.x += (goal - this.mailFlag.rotation.x) * 0.15;
  }

  // 施工鷹架：房屋修繕期間顯示（依目前房屋大小：T1/T2 原尺寸、T3 含左側加蓋、T4 起兩層樓高）
  setScaffold(on: boolean): void {
    if (on === !!this.scaffold) return;
    const house = this.props.get('house')!;
    if (!on) { this.scaffold!.parent?.remove(this.scaffold!); this.scaffold = null; return; }
    const g = new THREE.Group();
    const pole = mat('#c9a06a', { roughness: 0.85 });
    const plank = mat('#e0bd86', { roughness: 0.85 });
    if (this.houseTier <= 2) {
      const W = 3.3, D = 2.75;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = mesh(GEO.cyl, pole);
        p.scale.set(0.09, 4.4, 0.09);
        p.position.set(sx * W, 2.2, sz * D);
        g.add(p);
      }
      for (const h of [1.3, 2.7]) {
        for (const sz of [-1, 1]) {
          const b = mesh(rbox(W * 2 + 0.3, 0.07, 0.34, 0.03), plank);
          b.position.set(0, h, sz * D);
          g.add(b);
        }
        for (const sx of [-1, 1]) {
          const b = mesh(rbox(0.34, 0.07, D * 2 + 0.3, 0.03), plank);
          b.position.set(sx * W, h, 0);
          g.add(b);
        }
      }
      // 交叉斜撐
      for (const sz of [-1, 1]) for (const r of [0.55, -0.55]) {
        const b = mesh(GEO.cyl, pole);
        b.scale.set(0.05, 3.3, 0.05);
        b.rotation.z = r;
        b.position.set(r > 0 ? -1.6 : 1.6, 1.9, sz * (D + 0.05));
        g.add(b);
      }
    } else {
      const tall = this.houseTier >= 4;
      const x0 = tall ? -5.6 : -5.25, x1 = tall ? 3.55 : 3.35;
      const zf = tall ? 3.75 : 2.8, zb = tall ? -2.65 : -2.75;
      const H = tall ? 7.2 : 4.4;
      const levels = tall ? [1.3, 3.0, 4.6, 6.1] : [1.3, 2.7];
      const n = Math.ceil((x1 - x0) / 3.1);
      const xs = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
      for (const x of xs) for (const z of [zf, zb]) {
        const p = mesh(GEO.cyl, pole);
        p.scale.set(0.09, H, 0.09);
        p.position.set(x, H / 2, z);
        g.add(p);
      }
      for (const h of levels) {
        for (const z of [zf, zb]) {
          const b = mesh(rbox(x1 - x0 + 0.3, 0.07, 0.34, 0.03), plank);
          b.position.set((x0 + x1) / 2, h, z);
          g.add(b);
        }
        for (const x of [x0, x1]) {
          const b = mesh(rbox(0.34, 0.07, zf - zb + 0.3, 0.03), plank);
          b.position.set(x, h, (zf + zb) / 2);
          g.add(b);
        }
      }
      // 斜撐：後面每一跨，前面只在最左邊（避開門廊）
      for (let i = 0; i < n; i++) {
        const a = new THREE.Vector3(xs[i], 0.3, zb - 0.06), b = new THREE.Vector3(xs[i + 1], levels[1] + 0.1, zb - 0.06);
        stick(g, a, b, 0.03, pole);
        if (i === 0) stick(g, new THREE.Vector3(xs[0], 0.3, zf + 0.06), new THREE.Vector3(xs[1], levels[1] + 0.1, zf + 0.06), 0.03, pole);
      }
    }
    this.scaffold = g;
    house.obj.add(g);
  }

  // ---------- 房屋 ----------
  setHouseTier(tier: number): void {
    this.houseTier = Math.max(1, Math.min(5, Math.floor(tier)));
    tier = this.houseTier;
    const entry = this.props.get('house')!;
    const hadScaffold = !!this.scaffold;
    this.scaffold = null;
    this.root.remove(entry.obj);
    this.interactive = this.interactive.filter((o) => o !== entry.obj);
    this.houseWindows = [];
    this.glowSets.delete('house');
    const h = this.makeHouse(tier);
    h.userData.propKey = 'house';
    entry.obj = h;
    this.root.add(h);
    this.placeProp('house');
    this.wreath = null;
    this.setDecor(this.decorIds, this.decorSeason);
    if (hadScaffold) this.setScaffold(true);
    this.applyFestival();
    this.rebuildGrid();
  }

  private makeHouse(tier: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'house';
    this.interactive.push(g);
    if (tier >= 4) { this.makeGrandHouse(g, tier); return g; }
    const worn = tier === 1;
    const t3 = tier >= 3;
    const wall = mat(worn ? '#c28d5e' : t3 ? '#f2e2c4' : '#d69a62', { roughness: 0.85 });
    const wallDark = mat(worn ? '#a8744a' : t3 ? '#e2cda4' : '#bd8350', { roughness: 0.85 });
    const trim = mat('#f3e7d3', { roughness: 0.6 });
    const roofMat = mat(worn ? '#a8604c' : t3 ? '#c9453a' : '#c9553c', { roughness: 0.7 });
    const stone = mat('#b9ad9c', { roughness: 0.95 });
    const W = 5.4, H = 2.5, D = 4.2, base = 0.35;

    const found = mesh(rbox(W + 0.4, base, D + 0.4, 0.1), stone);
    found.position.y = base / 2;
    g.add(found);
    const body = mesh(rbox(W, H, D, 0.12), wall);
    body.position.y = base + H / 2;
    g.add(body);
    // 橫向木板：讓牆面讀起來像小木屋
    for (let i = 0; i < 6; i++) {
      const plank = mesh(rbox(W + 0.04, 0.07, D + 0.04, 0.03), i % 2 ? wall : wallDark, false);
      plank.position.y = base + 0.25 + i * 0.4;
      g.add(plank);
    }
    // 屋角柱
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = mesh(rbox(0.22, H + 0.1, 0.22, 0.06), trim);
      post.position.set(sx * (W / 2), base + H / 2, sz * (D / 2));
      g.add(post);
    }

    // 山牆三角
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0); tri.lineTo(W / 2, 0); tri.lineTo(0, 1.55); tri.closePath();
    const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    for (const sz of [1, -1]) {
      const t = mesh(triGeo, wall);
      t.position.set(0, base + H, sz * (D / 2) - (sz > 0 ? 0.2 : 0));
      g.add(t);
    }
    // 屋頂：兩片斜板＋屋脊
    const rise = 1.6, half = D / 2 + 0.5;
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    const slab = rbox(len + 0.1, 0.26, W + 0.9, 0.1);
    // 注意：slab 的長邊沿 X，建好後轉 90° 讓長邊沿 Z
    for (const sz of [1, -1]) {
      const r = mesh(slab, roofMat);
      r.rotation.set(0, Math.PI / 2, 0);
      const pivot = new THREE.Group();
      pivot.add(r);
      pivot.rotation.x = sz * ang;
      pivot.position.set(0, base + H + rise / 2 + 0.12, sz * half / 2);
      g.add(pivot);
      // 舊屋頂：缺瓦
      if (worn) for (let k = 0; k < 3; k++) {
        const hole = mesh(rbox(0.5, 0.05, 0.4, 0.02), mat('#4a2e26'), false);
        hole.position.set(-1.6 + k * 1.5, 0.14, (k - 1) * 0.5 * sz);
        pivot.add(hole);
      }
    }
    const ridge = mesh(GEO.cyl, mat(worn ? '#8a4a3a' : '#a8412e'));
    ridge.scale.set(0.3, W + 1, 0.3);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.set(0, base + H + rise + 0.2, 0);
    g.add(ridge);

    // 煙囪
    const chim = mesh(rbox(0.6, 1.4, 0.6, 0.08), stone);
    chim.position.set(1.6, base + H + 1.3, -0.7);
    g.add(chim);
    const cap = mesh(rbox(0.75, 0.14, 0.75, 0.05), mat('#8f8578'));
    cap.position.set(1.6, base + H + 2.05, -0.7);
    g.add(cap);
    g.userData.chimneyTop = new THREE.Vector3(1.6, base + H + 2.2, -0.7);

    // 門
    const fz = D / 2;
    const frame = mesh(rbox(1.25, 1.95, 0.14, 0.05), trim);
    frame.position.set(0, base + 0.97, fz + 0.03);
    const door = mesh(rbox(1.0, 1.78, 0.12, 0.08), mat('#8b5a3c', { roughness: 0.7 }));
    door.position.set(0, base + 0.9, fz + 0.08);
    const knob = mesh(GEO.sphereLo, mat('#e8b84a', { metalness: 0.6, roughness: 0.3 }));
    knob.scale.setScalar(0.1);
    knob.position.set(0.34, base + 0.9, fz + 0.18);
    g.add(frame, door, knob);

    // 窗戶（夜晚亮燈）
    for (const sx of [-1, 1]) {
      const wx = sx * 1.65, wy = base + 1.45;
      const f = mesh(rbox(1.1, 0.95, 0.12, 0.05), trim);
      f.position.set(wx, wy, fz + 0.03);
      const glassMat = mat('#9ec9e8', { roughness: 0.15, emissive: '#ffbf66', emissiveIntensity: 0 });
      this.houseWindows.push(glassMat);
      const glass = mesh(rbox(0.86, 0.72, 0.06, 0.02), glassMat, false);
      glass.position.set(wx, wy, fz + 0.07);
      const barV = mesh(rbox(0.06, 0.74, 0.05, 0.02), trim, false);
      barV.position.set(wx, wy, fz + 0.11);
      const barH = mesh(rbox(0.86, 0.06, 0.05, 0.02), trim, false);
      barH.position.set(wx, wy, fz + 0.11);
      g.add(f, glass, barV, barH);
      if (worn && sx < 0) {
        // 破窗：釘上兩塊木板
        for (const r of [0.6, -0.6]) {
          const board = mesh(rbox(1.2, 0.16, 0.06, 0.03), mat('#9c7048'));
          board.position.set(wx, wy, fz + 0.16);
          board.rotation.z = r;
          g.add(board);
        }
      }
      if (!worn) {
        // 花台
        const box = mesh(rbox(1.1, 0.24, 0.3, 0.05), mat('#8fb86a'));
        box.position.set(wx, wy - 0.62, fz + 0.2);
        g.add(box);
        const colors = ['#ff7aa8', '#ffd84a', '#ff9a4a', '#ffffff'];
        for (let k = 0; k < 5; k++) {
          const fl = mesh(GEO.sphereLo, mat(colors[k % 4]), false);
          fl.scale.setScalar(0.16);
          fl.position.set(wx - 0.4 + k * 0.2, wy - 0.44, fz + 0.2);
          g.add(fl);
        }
      }
    }

    // 門廊與階梯
    const deck = mesh(rbox(3.2, 0.2, 1.2, 0.05), mat('#b98a5e'));
    deck.position.set(0, 0.3, fz + 0.75);
    const step = mesh(rbox(1.6, 0.2, 0.5, 0.05), mat('#a87c52'));
    step.position.set(0, 0.1, fz + 1.55);
    g.add(deck, step);
    if (!worn) {
      const matt = mesh(rbox(1.0, 0.03, 0.6, 0.02), mat('#d8584a'), false);
      matt.position.set(0, 0.42, fz + 0.75);
      g.add(matt);
    }
    if (t3) this.addT3Extras(g, { W, H, D, base, wall, wallDark, trim, roofMat, stone });
    g.userData.door = new THREE.Vector3(0, base + 1.45, fz + 0.2);
    // 節慶裝飾的錨點：T3 掛在門廊屋簷下，T1/T2 掛在主屋簷下
    const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const fest: HouseFest = {
      tier, fz, doorHalf: 0.625, doorTop: base + 1.95,
      hang: t3 ? [V3(-1.2, 2.32, fz + 1.2), V3(1.2, 2.32, fz + 1.2)] : [V3(-1.25, 2.84, fz + 0.32), V3(1.25, 2.84, fz + 0.32)],
      eave: t3 ? [V3(-1.85, 2.27, fz + 1.64), V3(1.85, 2.27, fz + 1.64)] : [V3(-W / 2 - 0.35, 2.86, fz + 0.5), V3(W / 2 + 0.35, 2.86, fz + 0.5)],
      porchZ: fz + 1.35, porchY: 0.4, porchHalf: 1.6,
      lintel: t3 ? V3(0, 2.1, fz + 1.66) : V3(0, base + 2.12, fz + 0.1),
      coupletTop: t3 ? 1.78 : base + 1.7,
    };
    g.userData.fest = fest;
    // 燈籠柱
    const lp = mesh(rbox(0.12, 1.6, 0.12, 0.04), mat('#5a4a3a'));
    lp.position.set(1.9, 0.8, fz + 0.8);
    const lamp = mesh(rbox(0.3, 0.36, 0.3, 0.06), this.lanternMat, false);
    lamp.position.set(1.9, 1.72, fz + 0.8);
    g.add(lp, lamp);

    // 破舊版：牆上的藤蔓
    if (worn) {
      const vineMat = withWind(mat('#4f9a3a'), 0.02);
      const rand = mulberry32(21);
      for (let v = 0; v < 5; v++) {
        const x0 = -2.6 + rand() * 1.4 + (v > 2 ? 3.4 : 0);
        for (let k = 0; k < 7; k++) {
          const leaf = mesh(GEO.sphereLo, vineMat, false);
          leaf.scale.set(0.28, 0.2, 0.08);
          leaf.position.set(x0 + Math.sin(k * 1.3 + v) * 0.18, base + 0.3 + k * 0.32, fz + 0.1);
          leaf.rotation.z = rand() - 0.5;
          g.add(leaf);
        }
      }
    }
    return g;
  }

  // T3 紅頂農舍：左側加蓋一間、門廊加屋頂與搖椅
  private addT3Extras(g: THREE.Group, o: HouseMats) {
    this.addWing(g, o, -o.W / 2 - 1.1);
    // 門廊屋頂＋柱子
    const fz = o.D / 2;
    const roof = mesh(rbox(3.6, 0.14, 1.5, 0.05), o.roofMat); roof.position.set(0, 2.45, fz + 0.85); roof.rotation.x = 0.18;
    g.add(roof);
    for (const sx of [-1.55, 1.55]) { const post = mesh(rbox(0.14, 2.2, 0.14, 0.05), o.trim); post.position.set(sx, 1.4, fz + 1.35); g.add(post); }
    // 搖椅
    const chair = this.makeChair();
    chair.position.set(-1.05, 0.4, fz + 0.75);
    chair.rotation.y = 0.5;
    g.add(chair);
    g.userData.chair = chair;
  }

  // 左側加蓋的一間（T3、T4 共用）
  private addWing(g: THREE.Group, o: HouseMats, x: number) {
    const wing = new THREE.Group();
    wing.position.set(x, 0, -0.5);
    const ww = 2.3, wh = 2.0, wd = 3.1;
    const f = mesh(rbox(ww + 0.3, o.base, wd + 0.3, 0.08), o.stone); f.position.y = o.base / 2;
    const b = mesh(rbox(ww, wh, wd, 0.1), o.wall); b.position.y = o.base + wh / 2;
    wing.add(f, b);
    for (let i = 0; i < 4; i++) { const pl = mesh(rbox(ww + 0.03, 0.06, wd + 0.03, 0.02), i % 2 ? o.wall : o.wallDark, false); pl.position.y = o.base + 0.25 + i * 0.42; wing.add(pl); }
    for (const s of [1, -1]) {
      const r = mesh(rbox(1.9, 0.2, wd + 0.5, 0.08), o.roofMat);
      r.position.set(s * 0.72, o.base + wh + 0.5, 0);
      r.rotation.z = -s * 0.55;
      wing.add(r);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-ww / 2, 0); tri.lineTo(ww / 2, 0); tri.lineTo(0, 0.95); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: wd - 0.1, bevelEnabled: false });
    const gable = mesh(tg, o.wall); gable.position.set(0, o.base + wh, -wd / 2 + 0.05); wing.add(gable);
    // 側翼的圓窗
    const win = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20), o.trim); win.rotation.x = Math.PI / 2; win.position.set(0, o.base + 1.2, wd / 2 + 0.03);
    const glass = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20), (this.houseWindows[0] ?? o.trim) as THREE.Material, false); glass.rotation.x = Math.PI / 2; glass.position.set(0, o.base + 1.2, wd / 2 + 0.06);
    wing.add(win, glass);
    g.add(wing);
  }

  private makeChair(): THREE.Group {
    const chair = new THREE.Group();
    const wood = mat('#8a5a3a');
    const seat = mesh(rbox(0.55, 0.07, 0.5, 0.03), wood); seat.position.y = 0.32;
    const back = mesh(rbox(0.55, 0.6, 0.06, 0.03), wood); back.position.set(0, 0.62, -0.24); back.rotation.x = -0.15;
    for (const sx of [-0.25, 0.25]) {
      const rocker = mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 16, Math.PI * 0.6), wood); rocker.rotation.set(0, Math.PI / 2, Math.PI * 1.2); rocker.position.set(sx, 0.42, 0.05);
      chair.add(rocker);
    }
    const cushion = mesh(rbox(0.46, 0.06, 0.42, 0.03), mat('#e87a6a')); cushion.position.y = 0.37;
    chair.add(seat, back, cushion);
    return chair;
  }

  // ---------- T4 雙層農莊／T5 風車莊園 ----------
  // 兩層樓＋閣樓老虎窗、二樓陽台與花台；T5 加上會轉的風車塔、屋簷燈串、左側玻璃屋（溫室連廊）
  private makeGrandHouse(g: THREE.Group, tier: number): void {
    const kit = new Kit();
    const t5 = tier >= 5;
    const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true, parent: THREE.Object3D = g) => {
      const me = mesh(geo, m, shadow);
      me.position.set(x, y, z);
      parent.add(me);
      return me;
    };
    const wall = mat('#f4e4c4', { roughness: 0.85 }), wallDark = mat('#e6d0a8', { roughness: 0.85 });
    const upper = mat('#fbf1dc', { roughness: 0.85 }), upperDark = mat('#efdcb8', { roughness: 0.85 });
    const trim = mat('#fdf8ef', { roughness: 0.6 });
    const roofMat = mat('#4f7fb3', { roughness: 0.7 }), roofDark = mat('#3f6897', { roughness: 0.7 }), roofLight = mat('#5b8cc0', { roughness: 0.7 });
    const stone = mat('#b9ad9c', { roughness: 0.95 }), stoneLight = mat('#d4c8b4', { roughness: 0.95 });
    const shutter = mat('#7ab0cc', { roughness: 0.7 }), shutterDark = mat('#5a90ae', { roughness: 0.7 });
    const deckWood = mat('#b98a5e'), rail = trim;
    const W = 6.2, D = 4.2, base = 0.35, H1 = 2.3, H2 = 2.05;
    const fz = D / 2, y1 = base + H1, y2 = y1 + H2;
    const ang = 0.66, tan = Math.tan(ang), ov = 0.5;
    const rise = (D / 2) * tan, yr = y2 + rise;
    const winMat = () => {
      const m = mat('#9ec9e8', { roughness: 0.15, emissive: '#ffbf66', emissiveIntensity: 0 });
      this.houseWindows.push(m);
      return m;
    };
    const glassMat = winMat();

    // 地基、石砌牆裙、一樓、腰線、二樓
    add(rbox(W + 0.4, base, D + 0.4, 0.1), stone, 0, base / 2, 0);
    add(rbox(W + 0.06, 0.62, D + 0.06, 0.05), stoneLight, 0, base + 0.31, 0);
    add(rbox(W, H1, D, 0.1), wall, 0, base + H1 / 2, 0);
    for (let i = 0; i < 4; i++) add(rbox(W + 0.04, 0.07, D + 0.04, 0.03), i % 2 ? wall : wallDark, 0, base + 0.85 + i * 0.4, 0, false);
    add(rbox(W + 0.2, 0.16, D + 0.2, 0.05), trim, 0, y1, 0);
    add(rbox(W - 0.06, H2, D - 0.06, 0.1), upper, 0, y1 + H2 / 2, 0);
    for (let i = 0; i < 5; i++) add(rbox(W - 0.02, 0.06, D - 0.02, 0.03), i % 2 ? upper : upperDark, 0, y1 + 0.3 + i * 0.4, 0, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(rbox(0.22, y2 - base + 0.04, 0.22, 0.06), trim, sx * (W / 2), (base + y2) / 2, sz * (D / 2));
    add(rbox(W + 0.12, 0.12, D + 0.12, 0.04), trim, 0, y2 - 0.02, 0);

    // 左右山牆＋圓形閣樓窗
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, rise); tri.closePath();
    const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false });
    for (const sx of [-1, 1]) {
      const t = add(triGeo, upper, sx > 0 ? W / 2 - 0.16 : -W / 2, y2, 0);
      t.rotation.y = Math.PI / 2;
      const rw = add(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 20), trim, sx * (W / 2 + 0.02), y2 + 0.62, 0);
      rw.rotation.z = Math.PI / 2;
      const rg = add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20), glassMat, sx * (W / 2 + 0.05), y2 + 0.62, 0, false);
      rg.rotation.z = Math.PI / 2;
    }
    // 屋頂：兩坡（有瓦片橫紋）＋屋脊
    const L = (D / 2 + ov) / Math.cos(ang), th = 0.26;
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, yr, 0);
      pivot.rotation.x = sz * ang;
      add(rbox(W + 0.9, th, L + 0.1, 0.1), roofMat, 0, th / 2, (sz * L) / 2, true, pivot);
      // 瓦片：一排排深淺交錯、微微疊起來
      const rows = 6;
      for (let k = 0; k < rows; k++) add(rbox(W + 0.92, 0.06, L / rows + 0.05, 0.025), k % 2 ? roofLight : roofMat, 0, th + 0.01 + k * 0.006, sz * (L * (k + 0.5)) / rows, false, pivot);
      g.add(pivot);
    }
    const ridge = add(GEO.cyl, roofDark, 0, yr + th * 0.95, 0);
    ridge.scale.set(0.32, W + 1.0, 0.32);
    ridge.rotation.z = Math.PI / 2;
    // 煙囪（左側，避開風車）
    const cx = -1.9, cz = -0.9, cBot = y2 + 0.5, cTop = yr + 0.9;
    add(rbox(0.7, cTop - cBot, 0.7, 0.08), stone, cx, (cTop + cBot) / 2, cz);
    add(rbox(0.86, 0.14, 0.86, 0.05), mat('#8f8578'), cx, cTop + 0.07, cz);
    g.userData.chimneyTop = new THREE.Vector3(cx, cTop + 0.25, cz);

    // 閣樓老虎窗（前坡左右各一）
    const dTri = new THREE.Shape();
    dTri.moveTo(-0.75, 0); dTri.lineTo(0.75, 0); dTri.lineTo(0, 0.5); dTri.closePath();
    const dTriGeo = new THREE.ExtrudeGeometry(dTri, { depth: 0.1, bevelEnabled: false });
    for (const dx of [-1.6, 1.6]) {
      add(rbox(1.5, 1.0, 1.6, 0.06), upper, dx, y2 + 0.45, 1.2);
      add(dTriGeo, upper, dx, y2 + 0.95, 1.9);
      for (const sx of [-1, 1]) {
        const r = add(rbox(0.98, 0.1, 1.85, 0.04), roofMat, dx + sx * 0.42, y2 + 1.25, 1.15);
        r.rotation.z = -sx * 0.53;
      }
      add(rbox(0.8, 0.66, 0.1, 0.04), trim, dx, y2 + 0.46, 2.02);
      add(rbox(0.62, 0.5, 0.05, 0.02), glassMat, dx, y2 + 0.46, 2.06, false);
      add(rbox(0.05, 0.5, 0.05, 0.02), trim, dx, y2 + 0.46, 2.09, false);
      add(rbox(0.62, 0.05, 0.05, 0.02), trim, dx, y2 + 0.46, 2.09, false);
      // 窗下小花台
      add(rbox(0.8, 0.12, 0.16, 0.03), mat('#8fb86a'), dx, y2 + 0.12, 2.1);
      for (let k = 0; k < 4; k++) { const f = add(GEO.sphereLo, mat(['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff'][k]), dx - 0.27 + k * 0.18, y2 + 0.22, 2.1, false); f.scale.setScalar(0.13); }
    }
    // 一樓：大門（紅門＋半圓小窗）
    add(rbox(1.25, 1.95, 0.14, 0.05), trim, 0, base + 0.97, fz + 0.03);
    add(rbox(1.0, 1.78, 0.12, 0.08), mat('#b8503a', { roughness: 0.6 }), 0, base + 0.9, fz + 0.08);
    const arch = add(new THREE.CircleGeometry(0.26, 16, 0, Math.PI), glassMat, 0, base + 1.3, fz + 0.145, false);
    arch.scale.set(1, 0.8, 1);
    const knob = add(GEO.sphereLo, mat('#e8b84a', { metalness: 0.6, roughness: 0.3 }), 0.34, base + 0.9, fz + 0.18);
    knob.scale.setScalar(0.1);
    // 窗戶：一樓兩扇（有花台）、二樓兩扇（有百葉窗）、二樓陽台落地門、右側牆各一扇
    const win = (wx: number, wy: number, w: number, h: number, z: number, rotY = 0, parent: THREE.Object3D = g) => {
      const grp = new THREE.Group();
      grp.position.set(wx, wy, z);
      grp.rotation.y = rotY;
      add(rbox(w, h, 0.12, 0.05), trim, 0, 0, 0.03, true, grp);
      add(rbox(w - 0.22, h - 0.22, 0.06, 0.02), glassMat, 0, 0, 0.07, false, grp);
      add(rbox(0.06, h - 0.2, 0.05, 0.02), trim, 0, 0, 0.11, false, grp);
      add(rbox(w - 0.22, 0.06, 0.05, 0.02), trim, 0, 0, 0.11, false, grp);
      parent.add(grp);
      return grp;
    };
    const colors = ['#ff7aa8', '#ffd84a', '#ff9a4a', '#ffffff', '#b28cff'];
    const flowerBox = (x: number, y: number, z: number, w: number) => {
      add(rbox(w, 0.24, 0.3, 0.05), mat('#8fb86a'), x, y, z);
      const n = Math.round(w / 0.2);
      for (let k = 0; k < n; k++) {
        const f = add(GEO.sphereLo, mat(colors[k % colors.length]), x - w / 2 + 0.12 + k * ((w - 0.24) / Math.max(1, n - 1)), y + 0.18, z, false);
        f.scale.setScalar(0.16);
        if (k % 2 === 0) { const ivy = add(GEO.sphereLo, mat('#5fae44'), f.position.x, y - 0.12, z + 0.16, false); ivy.scale.set(0.12, 0.2, 0.08); }
      }
    };
    for (const sx of [-1, 1]) {
      win(sx * 1.95, base + 1.4, 1.1, 1.05, fz);
      flowerBox(sx * 1.95, base + 0.76, fz + 0.2, 1.1);
      win(sx * 1.95, y1 + 1.05, 1.0, 1.0, fz - 0.03);
      for (const ox of [-0.68, 0.68]) {
        add(rbox(0.3, 1.0, 0.06, 0.03), shutter, sx * 1.95 + ox, y1 + 1.05, fz + 0.02);
        for (let k = 0; k < 4; k++) add(rbox(0.26, 0.03, 0.03, 0.01), shutterDark, sx * 1.95 + ox, y1 + 0.7 + k * 0.23, fz + 0.06, false);
      }
    }
    win(W / 2, base + 1.4, 1.0, 1.0, 0.3, Math.PI / 2);
    win(W / 2 - 0.03, y1 + 1.05, 0.9, 0.9, 0.3, Math.PI / 2);
    // 陽台落地門
    add(rbox(1.1, 1.78, 0.12, 0.05), trim, 0, y1 + 0.97, fz);
    for (const sx of [-1, 1]) add(rbox(0.42, 1.5, 0.05, 0.02), glassMat, sx * 0.23, y1 + 0.9, fz + 0.05, false);
    add(rbox(0.06, 1.6, 0.06, 0.02), trim, 0, y1 + 0.92, fz + 0.08, false);

    // 門廊平台＋階梯＋腳踏墊
    add(rbox(4.2, 0.2, 1.3, 0.05), deckWood, 0, 0.3, fz + 0.7);
    add(rbox(1.6, 0.2, 0.5, 0.05), mat('#a87c52'), 0, 0.1, fz + 1.55);
    add(rbox(1.0, 0.03, 0.6, 0.02), mat('#d8584a'), 0, 0.42, fz + 0.6, false);
    // 二樓陽台：地板、柱子、欄杆、花台
    add(rbox(4.0, 0.16, 1.4, 0.04), deckWood, 0, y1, fz + 0.68);
    add(rbox(4.0, 0.14, 0.14, 0.04), trim, 0, y1 - 0.12, fz + 1.3);
    for (const sx of [-1, 1]) add(rbox(0.16, y1 - 0.4, 0.16, 0.05), trim, sx * 1.9, (0.4 + y1) / 2, fz + 1.25);
    add(rbox(4.0, 0.08, 0.1, 0.03), rail, 0, y1 + 0.85, fz + 1.33);
    add(rbox(4.0, 0.06, 0.08, 0.02), rail, 0, y1 + 0.14, fz + 1.33, false);
    for (const sx of [-1, 1]) {
      add(rbox(0.1, 0.08, 1.3, 0.03), rail, sx * 1.95, y1 + 0.85, fz + 0.68);
      add(rbox(0.08, 0.06, 1.3, 0.02), rail, sx * 1.95, y1 + 0.14, fz + 0.68, false);
      for (let z = fz + 0.25; z < fz + 1.3; z += 0.26) add(rbox(0.05, 0.7, 0.05, 0.02), rail, sx * 1.95, y1 + 0.49, z, false);
    }
    for (let x = -1.85; x <= 1.86; x += 0.25) add(rbox(0.05, 0.7, 0.05, 0.02), rail, x, y1 + 0.49, fz + 1.33, false);
    for (const sx of [-1, 1]) flowerBox(sx * 0.95, y1 + 0.78, fz + 1.5, 1.2);
    // 門廊柱上的燈（夜晚亮）
    for (const sx of [-1, 1]) {
      add(rbox(0.08, 0.08, 0.2, 0.02), mat('#5a4a3a'), sx * 1.9, 1.95, fz + 1.4);
      add(rbox(0.26, 0.3, 0.26, 0.06), kit.lit('#ffe2a0', '#ffb347', 2.0, 0), sx * 1.9, 1.72, fz + 1.5, false);
    }
    // 搖椅
    const chair = this.makeChair();
    chair.position.set(-1.3, 0.4, fz + 0.7);
    chair.rotation.y = 0.5;
    chair.userData.dyn = true;
    g.add(chair);
    g.userData.chair = chair;

    // 左側：T4 加蓋一間；T5 換成玻璃屋（溫室連廊）
    const o: HouseMats = { W, H: H1, D, base, wall, wallDark, trim, roofMat, stone };
    if (!t5) this.addWing(g, o, -W / 2 - 1.1);
    else this.addConservatory(g, kit, W, trim, stone);
    if (t5) {
      this.addWindmill(g, kit, roofMat, roofDark, stone, trim, glassMat);
      // 屋簷＋陽台＋門廊的暖色燈串
      const warm: [string, string][] = [['#fff2c0', '#ffc060']];
      const ey = y2 - ov * tan - 0.04, ez = fz + ov - 0.02;
      lightString(kit, g, V3(-W / 2 - 0.35, ey, ez), V3(0, ey, ez), 0.2, warm, 1.7, 0.04, 0.3, 0.05);
      lightString(kit, g, V3(0, ey, ez), V3(W / 2 + 0.35, ey, ez), 0.2, warm, 1.7, 0.04, 0.3, 0.05);
      lightString(kit, g, V3(-1.95, y1 + 0.9, fz + 1.36), V3(1.95, y1 + 0.9, fz + 1.36), 0.12, warm, 1.7, 0.04, 0.3, 0.045);
      lightString(kit, g, V3(-1.9, y1 - 0.2, fz + 1.38), V3(1.9, y1 - 0.2, fz + 1.38), 0.16, warm, 1.7, 0.04, 0.3, 0.045);
    }
    // 靜態網格合併（搖椅、風車葉片保留）
    bake(g);
    this.glowSets.set('house', kit.glow);
    g.userData.door = new THREE.Vector3(0, base + 1.45, fz + 0.2);
    const fest: HouseFest = {
      tier, fz, doorHalf: 0.625, doorTop: base + 1.95,
      hang: [V3(-1.2, y1 - 0.2, fz + 1.05), V3(1.2, y1 - 0.2, fz + 1.05)],
      eave: [V3(-W / 2 - 0.3, y2 - ov * tan - 0.02, fz + ov + 0.02), V3(W / 2 + 0.3, y2 - ov * tan - 0.02, fz + ov + 0.02)],
      porchZ: fz + 1.35, porchY: 0.4, porchHalf: 2.1,
      lintel: V3(0, y1 - 0.17, fz + 1.42),
      coupletTop: base + 1.7,
    };
    g.userData.fest = fest;
  }

  // T5 左側玻璃屋：矮石牆＋白框玻璃＋單斜玻璃屋頂，裡面有盆栽、小圓桌
  private addConservatory(g: THREE.Group, kit: Kit, W: number, trim: THREE.Material, stone: THREE.Material): void {
    const c = new THREE.Group();
    c.position.set(-W / 2 - 1.15, 0, -0.3);
    const hw = 1.15, hd = 1.4, KH = 0.5, yo = 2.2, yi = 2.75;
    const glass = kit.m('#dff3ff', { transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const me = mesh(geo, m, shadow);
      me.position.set(x, y, z);
      c.add(me);
      return me;
    };
    put(rbox(hw * 2, 0.1, hd * 2, 0.03), stone, 0, 0.05, 0);
    put(rbox(hw * 2, KH, 0.14, 0.04), stone, 0, KH / 2, hd);
    put(rbox(hw * 2, KH, 0.14, 0.04), stone, 0, KH / 2, -hd);
    put(rbox(0.14, KH, hd * 2, 0.04), stone, -hw, KH / 2, 0);
    // 白框：柱子高度跟著屋頂斜度
    const topY = (x: number) => yo + ((x + hw) / (hw * 2)) * (yi - yo);
    for (const x of [-hw, 0, hw]) for (const z of [-hd, hd]) put(rbox(0.08, topY(x), 0.08, 0.02), trim, x, topY(x) / 2, z);
    put(rbox(0.08, yo, 0.08, 0.02), trim, -hw, yo / 2, 0);
    for (const z of [-hd, 0, hd]) stick(c, new THREE.Vector3(hw, yi, z), new THREE.Vector3(-hw - 0.08, yo - 0.03, z), 0.04, trim);
    for (const z of [-hd, hd]) stick(c, new THREE.Vector3(-hw, KH + 0.02, z), new THREE.Vector3(hw, KH + 0.02, z), 0.035, trim);
    stick(c, new THREE.Vector3(-hw, KH + 0.02, -hd), new THREE.Vector3(-hw, KH + 0.02, hd), 0.035, trim);
    stick(c, new THREE.Vector3(-hw, 1.4, -hd), new THREE.Vector3(-hw, 1.4, hd), 0.025, trim);
    // 玻璃：前後梯形牆、外側牆、斜屋頂
    const trap = new THREE.Shape();
    trap.moveTo(-hw, KH); trap.lineTo(hw, KH); trap.lineTo(hw, yi); trap.lineTo(-hw, yo); trap.closePath();
    for (const z of [-hd, hd]) { const me = put(new THREE.ShapeGeometry(trap), glass, 0, 0, z, false); me.receiveShadow = false; }
    const side = put(new THREE.PlaneGeometry(hd * 2, yo - KH), glass, -hw, (yo + KH) / 2, 0, false);
    side.rotation.y = Math.PI / 2;
    side.receiveShadow = false;
    const roofLen = Math.hypot(hw * 2 + 0.2, yi - yo);
    const roof = put(rbox(roofLen, 0.02, hd * 2 + 0.15, 0.005), glass, -0.05, (yo + yi) / 2 + 0.03, 0, false);
    roof.rotation.z = Math.atan2(yi - yo, hw * 2);
    roof.receiveShadow = false;
    // 前面的玻璃門框
    for (const x of [-0.05, 0.6]) put(rbox(0.06, 1.75, 0.06, 0.02), trim, x, KH + 0.85, hd + 0.02);
    put(rbox(0.7, 0.06, 0.06, 0.02), trim, 0.28, KH + 1.72, hd + 0.02);
    put(GEO.sphereLo, kit.m('#e8b84a', { metalness: 0.5, roughness: 0.3 }), 0.5, KH + 0.8, hd + 0.07).scale.setScalar(0.06);
    // 屋內：盆栽、檸檬樹、小圓桌＋茶壺、吊燈
    const pot = (x: number, z: number, s: number, leaf: string, fruit?: string) => {
      put(new THREE.CylinderGeometry(0.2 * s, 0.15 * s, 0.3 * s, 12), kit.m('#c8704a'), x, 0.1 + 0.15 * s, z);
      const f = put(GEO.ico, kit.m(leaf, { roughness: 0.8 }), x, 0.1 + 0.6 * s, z);
      f.scale.set(0.62 * s, 0.6 * s, 0.62 * s);
      if (fruit) for (let k = 0; k < 5; k++) put(GEO.sphereLo, kit.m(fruit), x + Math.cos(k * 1.3) * 0.26 * s, 0.1 + (0.55 + (k % 2) * 0.15) * s, z + Math.sin(k * 1.3) * 0.26 * s, false).scale.setScalar(0.09 * s);
    };
    pot(-0.65, -0.8, 1.3, '#4fae3f');
    pot(0.55, -0.85, 1.1, '#5fbf49', '#f2d84a');
    pot(-0.75, 0.75, 0.9, '#6aca4a', '#ff7aa8');
    const wood = kit.m('#8a5a3a');
    put(GEO.cyl, kit.m('#fdf8ef'), 0.25, 0.72, 0.25).scale.set(0.62, 0.05, 0.62);
    put(GEO.cyl, wood, 0.25, 0.4, 0.25).scale.set(0.08, 0.62, 0.08);
    put(GEO.sphere, kit.m('#6aa0c0'), 0.3, 0.83, 0.2).scale.set(0.18, 0.15, 0.18);
    put(GEO.cyl, kit.m('#f6f0e4'), 0.1, 0.77, 0.38).scale.set(0.1, 0.06, 0.1);
    put(GEO.sphereLo, kit.lit('#fff2c0', '#ffc060', 1.8, 0.05), 0.2, 2.2, 0, false).scale.setScalar(0.16);
    stick(c, new THREE.Vector3(0.2, 2.55, 0), new THREE.Vector3(0.2, 2.28, 0), 0.008, kit.m('#3a3a3a'), false);
    g.add(c);
  }

  // T5 風車塔：石基座、奶油色塔身、藍色塔頂、四片會轉的風車葉
  private addWindmill(g: THREE.Group, kit: Kit, roofMat: THREE.Material, roofDark: THREE.Material, stone: THREE.Material, trim: THREE.Material, glassMat: THREE.Material): void {
    const w = new THREE.Group();
    w.position.set(WINDMILL.x, 0, WINDMILL.z);
    w.rotation.y = WINDMILL.yaw;
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = w, shadow = true) => {
      const me = mesh(geo, m, shadow);
      me.position.set(x, y, z);
      parent.add(me);
      return me;
    };
    const cream = kit.m('#f3e6cc', { roughness: 0.85 });
    const wood = kit.m('#8a5a3a'), woodL = kit.m('#b98a5e');
    const H = 5.2, r0 = 1.02, r1 = 0.72, y0 = 0.4;
    const rAt = (y: number) => r0 - ((y - y0) / H) * (r0 - r1);
    put(new THREE.CylinderGeometry(1.18, 1.24, y0, 10), stone, 0, y0 / 2, 0);
    put(new THREE.CylinderGeometry(r1, r0, H, 10), cream, 0, y0 + H / 2, 0);
    for (const y of [2.1, 3.9]) put(new THREE.CylinderGeometry(rAt(y) + 0.04, rAt(y) + 0.04, 0.12, 10), wood, 0, y, 0);
    // 門、窗、門燈
    const doorZ = rAt(0.9) - 0.02;
    put(rbox(0.72, 1.12, 0.1, 0.03), trim, 0, 0.95, doorZ);
    put(rbox(0.56, 1.0, 0.1, 0.04), woodL, 0, 0.92, doorZ + 0.04);
    put(new THREE.CircleGeometry(0.28, 14, 0, Math.PI), woodL, 0, 1.42, doorZ + 0.09, w, false);
    put(rbox(0.2, 0.24, 0.2, 0.05), kit.lit('#ffe2a0', '#ffb347', 2.0, 0), 0.5, 1.6, doorZ + 0.05, w, false);
    for (const y of [2.95, 4.55]) {
      const z = rAt(y) - 0.01;
      put(rbox(0.42, 0.52, 0.08, 0.03), trim, 0, y, z);
      put(rbox(0.3, 0.4, 0.05, 0.02), glassMat, 0, y, z + 0.03, w, false);
      put(rbox(0.3, 0.04, 0.04, 0.01), trim, 0, y, z + 0.06, w, false);
    }
    // 塔頂圓帽
    const capY = y0 + H;
    put(new THREE.CylinderGeometry(r1 + 0.16, r1 + 0.16, 0.14, 14), roofDark, 0, capY, 0);
    const dome = put(new THREE.SphereGeometry(0.92, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roofMat, 0, capY + 0.05, 0);
    dome.scale.set(1, 0.95, 1.12);
    put(GEO.sphereLo, kit.m('#e8b84a', { metalness: 0.5, roughness: 0.3 }), 0, capY + 0.98, 0).scale.setScalar(0.16);
    // 轉軸＋葉片
    const hubY = capY + 0.35;
    const axle = put(GEO.cyl, wood, 0, hubY, 0.7);
    axle.scale.set(0.16, 0.9, 0.16);
    axle.rotation.x = Math.PI / 2;
    const sails = new THREE.Group();
    sails.position.set(0, hubY, 1.18);
    sails.userData.dyn = true;
    put(GEO.sphere, wood, 0, 0, 0.02, sails).scale.setScalar(0.3);
    const cloth = kit.m('#fbf3e0', { roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2 + 0.3;
      put(rbox(0.1, 2.55, 0.08, 0.03), wood, 0, 1.3, 0, arm);
      put(rbox(0.56, 1.95, 0.02, 0.01), cloth, 0.36, 1.5, -0.03, arm);
      put(rbox(0.05, 2.0, 0.05, 0.01), woodL, 0.66, 1.5, -0.01, arm);
      for (let k = 0; k < 6; k++) put(rbox(0.66, 0.035, 0.035, 0.01), woodL, 0.33, 0.55 + k * 0.38, 0.0, arm, false);
      sails.add(arm);
    }
    w.add(sails);
    g.userData.sails = sails;
    g.add(w);
  }

  // ---------- 加工坊 ----------
  private makeWorkshop(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'workshop';
    this.interactive.push(g);
    const wall = mat('#e9d2a8', { roughness: 0.85 }), wood = mat('#a8744a'), roof = mat('#5f8a4a', { roughness: 0.7 }), stone = mat('#b9ad9c', { roughness: 0.95 });
    const f = mesh(rbox(2.7, 0.3, 2.3, 0.08), stone); f.position.y = 0.15;
    const b = mesh(rbox(2.4, 1.7, 2.0, 0.1), wall); b.position.y = 0.3 + 0.85;
    g.add(f, b);
    for (const sx of [-1.2, 1.2]) for (const sz of [-1, 1]) { const post = mesh(rbox(0.16, 1.8, 0.16, 0.05), wood); post.position.set(sx, 1.15, sz); g.add(post); }
    for (const s of [1, -1]) { const r = mesh(rbox(2.9, 0.16, 1.45, 0.06), roof); r.position.set(0, 2.35, s * 0.55); r.rotation.x = s * 0.52; g.add(r); }
    const tri = new THREE.Shape(); tri.moveTo(-1.2, 0); tri.lineTo(1.2, 0); tri.lineTo(0, 0.75); tri.closePath();
    const gable = mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.9, bevelEnabled: false }), wall); gable.position.set(0, 2.0, -0.95); g.add(gable);
    // 大窗戶（夜晚亮燈）與門
    const glassMat = mat('#9ec9e8', { roughness: 0.15, emissive: '#ffbf66', emissiveIntensity: 0 });
    this.windowMats.push(glassMat);
    const winF = mesh(rbox(1.0, 0.7, 0.1, 0.04), mat('#f3e7d3')); winF.position.set(0.45, 1.35, 1.02);
    const win = mesh(rbox(0.82, 0.54, 0.06, 0.02), glassMat, false); win.position.set(0.45, 1.35, 1.06);
    const door = mesh(rbox(0.6, 1.2, 0.08, 0.04), wood); door.position.set(-0.6, 0.9, 1.04);
    g.add(winF, win, door);
    // 招牌、煙囪、木桶
    const sign = mesh(rbox(1.1, 0.34, 0.06, 0.04), mat('#7a4a2e')); sign.position.set(0, 2.05, 1.12);
    const bread = mesh(GEO.sphere, mat('#e8b060')); bread.scale.set(0.34, 0.16, 0.2); bread.position.set(0, 2.06, 1.17);
    const chim = mesh(rbox(0.4, 0.9, 0.4, 0.06), stone); chim.position.set(0.8, 2.6, -0.4);
    g.add(sign, bread, chim);
    g.userData.chimneyTop = new THREE.Vector3(0.8, 3.1, -0.4);
    const barrel = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.55, 14), wood); barrel.position.set(1.55, 0.3, 0.6);
    const crate = mesh(rbox(0.45, 0.4, 0.45, 0.04), mat('#c89b62')); crate.position.set(1.5, 0.22, -0.2);
    g.add(barrel, crate);
    return g;
  }

  // ---------- 季節手帳的限定裝飾 ----------
  setDecor(ids: string[], season: Season): void {
    this.decorIds = [...ids];
    this.decorSeason = season;
    const last = (kind: string) => [...ids].reverse().find((x) => x.startsWith(kind + '_'));
    const sc = last('scarecrow'), wr = last('wreath');
    if (this.scarecrow) { this.root.remove(this.scarecrow); this.scarecrow = null; }
    if (sc) {
      this.scarecrow = this.makeScarecrow(sc.split('_')[1] as Season);
      const f = this.layout.field;
      this.scarecrow.position.set(f.x - 1.3, 0, f.z + 5.8);
      this.root.add(this.scarecrow);
    }
    const house = this.props.get('house')!.obj;
    if (this.wreath) { this.wreath.parent?.remove(this.wreath); this.wreath = null; }
    if (wr) {
      this.wreath = this.makeWreath(wr.split('_')[1] as Season);
      this.wreath.position.copy(house.userData.door as THREE.Vector3);
      house.add(this.wreath);
    }
  }

  private makeScarecrow(s: Season): THREE.Group {
    const g = new THREE.Group();
    const wood = mat('#8a5a3a'), straw = mat('#f2cf78', { roughness: 0.9 }), sack = mat('#e8d4a8', { roughness: 0.95 });
    const scarf = mat({ spring: '#f4a0c0', summer: '#ffd84a', autumn: '#e8703a', winter: '#d8453c' }[s]);
    const shirt = mat({ spring: '#8ad86a', summer: '#6ab8e8', autumn: '#c8783a', winter: '#5a7fbf' }[s]);
    const pole = mesh(GEO.cyl, wood); pole.scale.set(0.08, 2.0, 0.08); pole.position.y = 1.0;
    const arm = mesh(GEO.cyl, wood); arm.scale.set(0.06, 1.5, 0.06); arm.rotation.z = Math.PI / 2; arm.position.y = 1.35;
    const body = mesh(rbox(0.7, 0.7, 0.34, 0.12), shirt); body.position.y = 1.2;
    const head = mesh(GEO.sphere, sack); head.scale.setScalar(0.46); head.position.y = 1.85;
    const sc = mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 16), scarf); sc.rotation.x = Math.PI / 2; sc.position.y = 1.6;
    const brim = mesh(GEO.cyl, straw); brim.scale.set(0.7, 0.03, 0.7); brim.position.y = 2.06;
    const crown = mesh(GEO.sphere, straw); crown.scale.set(0.38, 0.28, 0.38); crown.position.y = 2.12;
    g.add(pole, arm, body, head, sc, brim, crown);
    for (const sx of [-1, 1]) {
      const e = mesh(GEO.sphereLo, mat('#2a1c18'), false); e.scale.setScalar(0.05); e.position.set(sx * 0.09, 1.9, 0.21); g.add(e);
      const t = mesh(GEO.cone, straw); t.scale.set(0.12, 0.2, 0.12); t.rotation.z = sx * Math.PI / 2; t.position.set(sx * 0.8, 1.35, 0); g.add(t);
    }
    const mouth = mesh(rbox(0.16, 0.02, 0.02, 0.005), mat('#2a1c18'), false); mouth.position.set(0, 1.78, 0.22); g.add(mouth);
    if (s === 'winter') { const snow = mesh(GEO.sphere, mat('#f7fbff')); snow.scale.set(0.5, 0.12, 0.5); snow.position.y = 2.2; g.add(snow); }
    return g;
  }

  private makeWreath(s: Season): THREE.Group {
    const g = new THREE.Group();
    const cols = { spring: ['#f6b8d0', '#8ad86a'], summer: ['#ffd84a', '#5fbf49'], autumn: ['#e8603a', '#f2b447'], winter: ['#2f7a3a', '#d8453c'] }[s];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const l = mesh(GEO.sphereLo, mat(cols[i % 2]), false);
      l.scale.set(0.14, 0.14, 0.08);
      l.position.set(Math.cos(a) * 0.26, Math.sin(a) * 0.26, 0);
      g.add(l);
    }
    const bow = mesh(GEO.sphereLo, mat('#d8453c'), false); bow.scale.set(0.2, 0.1, 0.06); bow.position.set(0, -0.28, 0.04); g.add(bow);
    return g;
  }

  // 寵物小屋：tier 1 原本的狗屋、tier 2 升級版（props3d）
  private makeDoghouse(): THREE.Group {
    const g = buildPetHouse(this.petHouseTier);
    g.userData.kind = 'doghouse';
    this.interactive.push(g);
    if (g.userData.glow) this.glowSets.set('pethouse', g.userData.glow);
    else this.glowSets.delete('pethouse');
    return g;
  }

  private makeMailbox(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'mailbox';
    this.interactive.push(g);
    const post = mesh(rbox(0.12, 1.0, 0.12, 0.04), mat('#8a6a4a'));
    post.position.y = 0.5;
    const box = mesh(rbox(0.36, 0.34, 0.6, 0.14), mat('#4a7fc9', { roughness: 0.4 }));
    box.position.y = 1.12;
    // 旗子：有新訂單時立起來（以轉軸為中心旋轉）
    const flagPivot = new THREE.Group();
    flagPivot.position.set(0.2, 1.12, -0.18);
    const flag = mesh(rbox(0.03, 0.26, 0.14, 0.01), mat('#e84a4a'));
    flag.position.set(0, 0.12, 0.07);
    flagPivot.add(flag);
    this.mailFlag = flagPivot;
    g.add(post, box, flagPivot);
    return g;
  }

  private makeCompost(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'compost';
    this.interactive.push(g);
    const wood = mat('#a8804e');
    for (let i = 0; i < 4; i++) {
      const s = mesh(rbox(0.9, 0.14, 0.9, 0.04), i % 2 ? wood : mat('#94703f'));
      s.position.y = 0.1 + i * 0.16;
      g.add(s);
    }
    const lid = mesh(rbox(0.95, 0.08, 0.95, 0.03), mat('#6aa84a'));
    lid.position.y = 0.72;
    g.add(lid);
    return g;
  }

  // 樹：layout 第 1、4、6 棵是松樹，其餘闊葉樹；外層再包一層，擺放縮放不會蓋掉樹本身的隨機大小
  private makeTree(seed: number): THREE.Group {
    const parts = buildTree(seed, this.treeMats, [1, 4, 6].includes(seed) ? 'pine' : 'round');
    this.trees.push(parts);
    setTreeSeason(parts, this.season);
    const g = new THREE.Group();
    g.add(parts.group);
    return g;
  }

  private makeRock(seed: number): THREE.Group {
    const g = new THREE.Group();
    const rand = mulberry32(300 + seed);
    const r = mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('#a9a49b', { roughness: 0.95, flatShading: false }));
    r.scale.set(0.9 + rand() * 0.4, 0.55 + rand() * 0.2, 0.8 + rand() * 0.3);
    r.position.y = 0.12;
    g.add(r);
    return g;
  }

  // ---------- 每幀 ----------
  update(dt: number, t: number, glow: number, now = 0): void {
    this.grassT -= dt;
    if (this.grassT <= 0 && now) { this.grassT = 0.3; this.grassField.regrow(now); }
    this.windowMats.forEach((m) => (m.emissiveIntensity = glow * 3.2));
    const winK = this.houseTier >= 4 ? 1.7 : 3.2;
    this.houseWindows.forEach((m) => (m.emissiveIntensity = glow * winK));
    for (const set of this.glowSets.values()) for (const gm of set) gm.m.emissiveIntensity = gm.base + glow * gm.k;
    for (const f of this.ticks.values()) f(dt, t, glow);
    const sails = this.props.get('house')?.obj.userData.sails as THREE.Object3D | undefined;
    if (sails) sails.rotation.z -= dt * 0.55;
    this.lanternMat.emissiveIntensity = glow * 5;
    this.lantern.intensity = glow * (this.houseTier >= 4 ? 3 : 6);
    const fm = this.fireflies.material as THREE.PointsMaterial;
    fm.opacity = Math.max(0, glow - 0.4) * 1.6;
    this.fireflies.visible = fm.opacity > 0.01;
    if (this.fireflies.visible) {
      const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      const base = this.fireflies.geometry.userData.base as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, base[i * 3] + Math.sin(t * 0.5 + i) * 0.8, base[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * 0.3, base[i * 3 + 2] + Math.cos(t * 0.4 + i) * 0.8);
      }
      pos.needsUpdate = true;
    }
    // 池塘：夜晚水色、漣漪與魚跳
    pondUniforms.uNight.value = glow;
    this.pondFx.update(dt, t, glow);
    // 蜜蜂白天（6–19 點、非冬天）才出來；望遠鏡夜晚慢慢掃天空
    if (this.hives.length) {
      const hr = clock.hour();
      const beesOut = hr >= 6 && hr < 19 && this.season !== 'winter';
      this.hives.forEach((h, i) => { if (h && this.beehiveSlots[i] === 'hive') updateBeehive(h, t, beesOut, !!this.beehiveReady[i]); });
    }
    if (this.telescope) updateTelescope(this.telescope, t, glow);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 130) c.position.x = -130;
    }
    // 加工坊運作中：煙囪冒煙
    if (this.workshopBusy) {
      this.wsSmokeT -= dt;
      if (this.wsSmokeT <= 0) {
        this.wsSmokeT = 0.6;
        const w = this.props.get('workshop')!;
        const top = (w.obj.userData.chimneyTop as THREE.Vector3).clone().applyMatrix4(w.obj.matrixWorld);
        const m = mesh(GEO.sphereLo, this.smokeMat, false);
        m.position.copy(top);
        m.scale.setScalar(0.22);
        this.root.add(m);
        this.smoke.push({ m, life: 0 });
      }
    }
    // 搖椅輕輕搖
    const chair = this.props.get('house')?.obj.userData.chair as THREE.Object3D | undefined;
    if (chair) chair.rotation.x = Math.sin(t * 1.4) * 0.06;
    // 煙囪冒煙（修繕後才有）
    if (this.houseTier >= 2) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.5;
        const p = this.props.get('house')!;
        const top = (p.obj.userData.chimneyTop as THREE.Vector3).clone().applyMatrix4(p.obj.matrixWorld);
        const m = mesh(GEO.sphereLo, this.smokeMat, false);
        m.position.copy(top);
        m.scale.setScalar(0.25);
        this.root.add(m);
        this.smoke.push({ m, life: 0 });
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life += dt;
      s.m.position.y += dt * 0.6;
      s.m.position.x += dt * 0.25;
      s.m.scale.setScalar(0.25 + s.life * 0.28);
      if (s.life > 3.2) { this.root.remove(s.m); this.smoke.splice(i, 1); }
    }
  }
}
