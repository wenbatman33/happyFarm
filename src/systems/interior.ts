import * as THREE from 'three';
import { sfx } from '../core/audio';
import { COMFORT_STARS, FURNITURE, FURN_BY_ID, HOUSE_COMFORT, ROOMS, SERIES_LABEL, SET_BONUS, WEED_PENALTY_CAP, comfortStars, type FurnDef } from '../data/furniture';
import { Grid } from '../world/grid';
import { buildFurniture, buildRoomShell, updateFurniture } from '../world/furniture3d';
import { Sheet, row } from '../ui/sheet';
import type { Game } from '../game';
import type { PlacedFurn } from './state';

// 室內（docs/03 §2.2）：點房子進屋，每個房間 9×7 格，可以擺家具、掛牆飾、鋪地毯
// 室內場景放在原點，進屋時把戶外整個藏起來，主角、寵物改用室內的格網走路
const WALL_Y = 1.6;
const WALL_Z = -3.5;
const inRoom = (x: number, z: number) => x >= -4 && x <= 4 && z >= -3 && z <= 3;

interface Ghost { id: string; uid: string | null; rot: number; x: number; z: number; ok: boolean; obj: THREE.Group }

export class Interior {
  active = false;
  room = 0;
  edit = false;
  root = new THREE.Group();
  grid = new Grid();
  shop = new Sheet('furn-shop', '🛒 家具店');
  private shell: THREE.Group | null = null;
  private furn = new THREE.Group();
  private views = new Map<string, THREE.Group>();
  private marks = new THREE.Group();
  private ghost: Ghost | null = null;
  private lamp = new THREE.PointLight('#ffcf8a', 0, 14, 1.4);
  private bar: HTMLElement;
  private tray: HTMLElement;
  private fade: HTMLElement;
  private ray = new THREE.Raycaster();
  private petSpot: { x: number; z: number; rotY: number } | null = null;
  private markGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
  private markOk = new THREE.MeshBasicMaterial({ color: '#7ee07a', transparent: true, opacity: 0.45, depthWrite: false });
  private markBad = new THREE.MeshBasicMaterial({ color: '#ff6a5a', transparent: true, opacity: 0.45, depthWrite: false });

  constructor(private game: Game) {
    this.root.visible = false;
    this.lamp.position.set(0.5, 2.9, 0.8);
    this.root.add(this.furn, this.marks, this.lamp);
    game.stage.scene.add(this.root);

    this.bar = document.createElement('div');
    this.bar.id = 'indoor-bar';
    this.bar.className = 'hidden';
    document.body.appendChild(this.bar);
    this.bar.addEventListener('click', (e) => this.onBar(e));
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.tray = document.createElement('div');
    this.tray.id = 'furn-tray';
    this.tray.className = 'hidden';
    document.body.appendChild(this.tray);
    this.tray.addEventListener('click', (e) => this.onTray(e));
    this.tray.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    document.body.appendChild(this.fade);

    this.shop.onAction = (a) => { if (a.startsWith('buy:')) this.buy(a.slice(4)); };
  }

  // ---------- 房間與舒適度 ----------
  get rooms() { return ROOMS.filter((r) => r.tier <= this.game.state.data.house.tier); }
  private items(room = this.room): PlacedFurn[] {
    const d = this.game.state.data;
    while (d.rooms.length <= room) d.rooms.push({ items: [] });
    return d.rooms[room].items;
  }

  comfort(): { total: number; stars: number; furniture: number; penalty: number; sets: string[] } {
    const d = this.game.state.data;
    let furniture = 0;
    const sets: string[] = [];
    d.rooms.forEach((r, ri) => {
      if (ri >= this.rooms.length) return;
      const count = new Map<string, number>();
      for (const it of r.items) { const def = FURN_BY_ID[it.id]; if (def) count.set(def.series, (count.get(def.series) ?? 0) + 1); }
      for (const it of r.items) {
        const def = FURN_BY_ID[it.id];
        if (!def) continue;
        const bonus = (count.get(def.series) ?? 0) >= 3 ? 1 + SET_BONUS : 1;
        furniture += def.comfort * bonus;
      }
      for (const [s, n] of count) if (n >= 3) sets.push(`${ROOMS[ri].name}・${SERIES_LABEL[s as keyof typeof SERIES_LABEL]}`);
    });
    const base = HOUSE_COMFORT[d.house.tier] ?? 10;
    const raw = base + furniture;
    // 房屋周圍的雜草：每株 −1，最多扣到 50%
    const weeds = this.game.weeds.list.filter((w) => w.zone === 'house').length;
    const penalty = Math.min(weeds, raw * WEED_PENALTY_CAP);
    const total = Math.round(raw - penalty);
    return { total, stars: comfortStars(total), furniture: Math.round(furniture), penalty: Math.round(penalty), sets };
  }

  // ---------- 進出 ----------
  async enter(): Promise<void> {
    const g = this.game;
    if (this.active || g.onboarding) return;
    g.clearQueue();
    g.player.mover.stop();
    if (g.mower.active) g.toggleMower(false);
    sfx.door();
    await this.fadeTo(1);
    this.active = true;
    this.room = Math.min(this.room, this.rooms.length - 1);
    g.world.root.visible = false;
    g.ranch.cow.root.visible = false;
    g.stage.indoor = true;
    this.root.visible = true;
    document.body.classList.add('indoor');
    this.build();
    g.player.setGrid(this.grid);
    g.pet.setGrid(this.grid);
    g.player.root.position.set(3, 0, 2);
    g.player.mover.yawGoal = Math.PI;
    g.pet.root.position.set(2, 0, 2.6);
    this.aim();
    this.bar.classList.remove('hidden');
    this.renderBar();
    this.saveComfort();
    await this.fadeTo(0);
    g.hud.toast(`🏠 歡迎回家！舒適度 ${this.comfort().total}`, 2400);
  }

  async exit(): Promise<void> {
    const g = this.game;
    if (!this.active) return;
    this.setEdit(false);
    sfx.door();
    await this.fadeTo(1);
    this.active = false;
    this.root.visible = false;
    g.world.root.visible = true;
    g.ranch.cow.root.visible = true;
    g.stage.indoor = false;
    document.body.classList.remove('indoor');
    g.player.setGrid(g.grid);
    g.pet.setGrid(g.grid);
    g.player.mover.stop();
    g.pet.mover.stop();
    const h = g.sceneLayout.house;
    g.player.root.position.set(h.x, 0, h.z + 3.9);
    g.player.mover.yawGoal = 0;
    g.pet.root.position.set(h.x - 1.2, 0, h.z + 4.4);
    g.stage.closeUp(null);
    this.bar.classList.add('hidden');
    this.saveComfort();
    g.state.save();
    await this.fadeTo(0);
  }

  // 鏡頭：整個房間（含後牆上的掛飾）都要在頂列下方看得到；直式手機拉更遠
  aim(): void {
    // 依畫面比例算距離：房間 9 公尺寬（左右各留一點邊）要整個放得進畫面
    const aspect = window.innerWidth / window.innerHeight;
    const halfV = THREE.MathUtils.degToRad(this.game.layout.camera.fov / 2);
    const fitW = 5.6 / (Math.tan(halfV) * aspect);
    const portrait = aspect < 1;
    const dist = THREE.MathUtils.clamp(Math.max(15.5, fitW), 15.5, 40);
    this.game.stage.closeUp(new THREE.Vector3(0, portrait ? 0.2 : 0.9, portrait ? -0.6 : -0.4), dist * (portrait ? 0.92 : 1), portrait ? 68 : 46, 0);
  }

  private fadeTo(v: number): Promise<void> {
    this.fade.classList.toggle('on', v > 0);
    return new Promise((r) => window.setTimeout(r, 320));
  }

  private saveComfort() { this.game.state.data.comfort = this.comfort().total; }

  switchRoom(i: number): void {
    if (i === this.room || i >= this.rooms.length) return;
    this.setEdit(false);
    this.room = i;
    sfx.door();
    this.build();
    this.game.player.root.position.set(3, 0, 2);
    this.game.player.mover.stop();
    this.game.pet.mover.stop();
    this.game.pet.root.position.set(2, 0, 2.6);
    this.renderBar();
  }

  // ---------- 建場景 ----------
  private build(): void {
    if (this.shell) this.root.remove(this.shell);
    const r = this.rooms[this.room];
    this.shell = buildRoomShell(r.style, this.game.state.data.house.tier);
    this.root.add(this.shell);
    for (const v of this.views.values()) this.furn.remove(v);
    this.views.clear();
    for (const it of this.items()) this.addView(it);
    this.rebuildGrid();
    this.pickPetSpot();
  }

  private dims(def: FurnDef, rot: number): [number, number] { return rot % 2 ? [def.d, def.w] : [def.w, def.d]; }

  private placeObj(obj: THREE.Object3D, def: FurnDef, x: number, z: number, rot: number) {
    if (def.layer === 'wall') {
      obj.position.set(x + (def.w - 1) / 2, WALL_Y, WALL_Z);
      obj.rotation.y = 0;
      return;
    }
    const [w, d] = this.dims(def, rot);
    obj.position.set(x + (w - 1) / 2, 0, z + (d - 1) / 2);
    obj.rotation.y = -rot * Math.PI / 2;
  }

  private addView(it: PlacedFurn) {
    const def = FURN_BY_ID[it.id];
    if (!def) return;
    const obj = buildFurniture(it.id);
    obj.userData.uid = it.uid;
    this.placeObj(obj, def, it.x, it.z, it.rot);
    this.furn.add(obj);
    this.views.set(it.uid, obj);
  }

  private tiles(def: FurnDef, x: number, z: number, rot: number): [number, number][] {
    const [w, d] = this.dims(def, rot);
    const out: [number, number][] = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x + i, z + j]);
    return out;
  }

  private rebuildGrid() {
    const g = this.grid;
    g.clear();
    for (let z = -15; z <= 15; z++) for (let x = -15; x <= 15; x++) if (!inRoom(x, z)) g.blocked[g.idx(x, z)] = 1;
    for (const it of this.items()) {
      const def = FURN_BY_ID[it.id];
      if (!def || def.layer !== 'floor') continue;
      for (const [x, z] of this.tiles(def, it.x, it.z, it.rot)) if (inRoom(x, z)) g.blocked[g.idx(x, z)] = 1;
    }
  }

  canPlace(def: FurnDef, x: number, z: number, rot: number, exceptUid: string | null): boolean {
    const others = this.items().filter((o) => o.uid !== exceptUid);
    if (def.layer === 'wall') {
      if (x < -4 || x + def.w - 1 > 4) return false;
      for (const o of others) {
        const od = FURN_BY_ID[o.id];
        if (od?.layer !== 'wall') continue;
        if (x < o.x + od.w && o.x < x + def.w) return false;
      }
      return true;
    }
    const mine = this.tiles(def, x, z, rot);
    if (!mine.every(([tx, tz]) => inRoom(tx, tz))) return false;
    const key = (a: number, b: number) => `${a},${b}`;
    const taken = new Set<string>();
    for (const o of others) {
      const od = FURN_BY_ID[o.id];
      if (!od || od.layer === 'wall' || od.layer !== def.layer) continue; // 地毯只跟地毯互斥
      for (const [tx, tz] of this.tiles(od, o.x, o.z, o.rot)) taken.add(key(tx, tz));
    }
    if (mine.some(([tx, tz]) => taken.has(key(tx, tz)))) return false;
    // 家具不能壓住主角或寵物站的位置
    if (def.layer === 'floor') {
      const g = this.game;
      for (const p of [g.player.root.position, g.pet.root.position]) if (mine.some(([tx, tz]) => Math.round(p.x) === tx && Math.round(p.z) === tz)) return false;
    }
    return true;
  }

  // 寵物喜歡的家具：有標記喜歡這個物種的，挑舒適度最高的
  private pickPetSpot() {
    const sp = this.game.pet.species;
    const fav = this.items().map((it) => ({ it, def: FURN_BY_ID[it.id] })).filter((x) => x.def?.pets?.includes(sp)).sort((a, b) => b.def.comfort - a.def.comfort)[0];
    if (!fav) { this.petSpot = null; return; }
    const [w, d] = this.dims(fav.def, fav.it.rot);
    const cx = fav.it.x + (w - 1) / 2, cz = fav.it.z + (d - 1) / 2;
    // 地毯、軟墊直接睡上面；其他家具睡在前面
    const onTop = fav.def.layer === 'rug' || fav.def.id === 'pet_bed' || fav.def.id === 'heart_cushion';
    const front = -fav.it.rot * Math.PI / 2;
    this.petSpot = onTop ? { x: cx, z: cz, rotY: front } : { x: cx + Math.sin(front) * (d / 2 + 0.3), z: cz + Math.cos(front) * (d / 2 + 0.3), rotY: front };
  }

  // 寵物的「狗屋」位置：pet.update 會在想睡時走過去
  get petHome(): { x: number; z: number; rotY: number } {
    const s = this.petSpot ?? { x: -2.5, z: 2, rotY: 0 };
    // Pet 會走到 (x + sin(rotY)·1.1, z + cos(rotY)·1.1)，先往回推
    return { x: s.x - Math.sin(s.rotY) * 1.1, z: s.z - Math.cos(s.rotY) * 1.1, rotY: s.rotY };
  }

  // ---------- 佈置模式 ----------
  setEdit(on: boolean): void {
    if (this.edit === on) return;
    this.edit = on;
    document.body.classList.toggle('editing', on);
    if (!on) this.dropGhost(true);
    this.tray.classList.toggle('hidden', !on);
    this.renderBar();
    this.renderTray();
  }

  private startGhost(id: string, uid: string | null, rot: number, x: number, z: number) {
    this.dropGhost(true);
    const obj = buildFurniture(id);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
    this.root.add(obj);
    this.ghost = { id, uid, rot, x, z, ok: false, obj };
    if (uid) { const v = this.views.get(uid); if (v) v.visible = false; }
    this.updateGhost(x, z);
    sfx.pickup();
    this.renderTray();
  }

  // cancel：拿起來的家具放回原位
  private dropGhost(cancel: boolean) {
    const gh = this.ghost;
    if (!gh) return;
    this.root.remove(gh.obj);
    this.marks.clear();
    if (gh.uid && cancel) { const v = this.views.get(gh.uid); if (v) v.visible = true; }
    this.ghost = null;
    this.renderTray();
  }

  private updateGhost(x: number, z: number) {
    const gh = this.ghost!;
    const def = FURN_BY_ID[gh.id];
    gh.x = x;
    gh.z = z;
    gh.ok = this.canPlace(def, x, z, gh.rot, gh.uid);
    this.placeObj(gh.obj, def, x, z, gh.rot);
    gh.obj.position.y += def.layer === 'wall' ? 0 : 0.08;
    this.marks.clear();
    const tiles = def.layer === 'wall' ? Array.from({ length: def.w }, (_, i) => [x + i, -3] as [number, number]) : this.tiles(def, x, z, gh.rot);
    for (const [tx, tz] of tiles) {
      const m = new THREE.Mesh(this.markGeo, gh.ok ? this.markOk : this.markBad);
      m.position.set(tx, 0.03, tz);
      this.marks.add(m);
    }
  }

  rotateGhost(): void {
    if (!this.ghost) return;
    const def = FURN_BY_ID[this.ghost.id];
    if (def.layer === 'wall' || (def.w === 1 && def.d === 1 && def.layer === 'rug')) return;
    this.ghost.rot = (this.ghost.rot + 1) % 4;
    sfx.ui();
    this.updateGhost(this.ghost.x, this.ghost.z);
  }

  private commitGhost() {
    const gh = this.ghost;
    if (!gh || !gh.ok) { if (gh) this.game.hud.toast('這裡放不下 🙅'); return; }
    const d = this.game.state.data;
    const items = this.items();
    if (gh.uid) {
      const it = items.find((o) => o.uid === gh.uid);
      if (it) Object.assign(it, { x: gh.x, z: gh.z, rot: gh.rot });
      const v = this.views.get(gh.uid);
      if (v && it) { v.visible = true; this.placeObj(v, FURN_BY_ID[it.id], it.x, it.z, it.rot); }
    } else {
      if ((d.furn[gh.id] ?? 0) < 1) return;
      d.furn[gh.id]--;
      if (d.furn[gh.id] <= 0) delete d.furn[gh.id];
      const it: PlacedFurn = { uid: `f${++d.furnSeq}`, id: gh.id, x: gh.x, z: gh.z, rot: gh.rot };
      items.push(it);
      this.addView(it);
    }
    this.root.remove(gh.obj);
    this.marks.clear();
    this.ghost = null;
    sfx.place();
    this.game.particles.burst('fluff', new THREE.Vector3(gh.x, 0.3, gh.z), 8, { speed: 1.2, up: 1, gravity: -0.2, size: 0.1, life: 0.6 });
    this.rebuildGrid();
    this.pickPetSpot();
    this.saveComfort();
    this.renderBar();
    this.renderTray();
    this.game.progression.track('decor');
    this.game.state.save();
  }

  // 拿起來的家具收回倉庫
  storeGhost(): void {
    const gh = this.ghost;
    if (!gh?.uid) return;
    const d = this.game.state.data;
    d.rooms[this.room].items = this.items().filter((o) => o.uid !== gh.uid);
    const v = this.views.get(gh.uid);
    if (v) { this.furn.remove(v); this.views.delete(gh.uid); }
    d.furn[gh.id] = (d.furn[gh.id] ?? 0) + 1;
    this.root.remove(gh.obj);
    this.marks.clear();
    this.ghost = null;
    sfx.pickup();
    this.rebuildGrid();
    this.pickPetSpot();
    this.saveComfort();
    this.renderBar();
    this.renderTray();
  }

  // ---------- 輸入 ----------
  private ndc(cx: number, cy: number) { return new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1); }

  private floorAt(cx: number, cy: number): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc(cx, cy), this.game.stage.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  // 游標 → 家具的錨點格
  private anchorFor(def: FurnDef, rot: number, cx: number, cy: number): [number, number] | null {
    if (def.layer === 'wall') {
      this.ray.setFromCamera(this.ndc(cx, cy), this.game.stage.camera);
      const hit = new THREE.Vector3();
      let px: number | null = null;
      if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -WALL_Z - 0.05), hit) && hit.y > 0.3 && hit.y < 3.2) px = hit.x;
      else { const f = this.floorAt(cx, cy); if (f) px = f.x; }
      if (px === null) return null;
      return [Math.round(px - (def.w - 1) / 2), -3];
    }
    const f = this.floorAt(cx, cy);
    if (!f) return null;
    const [w, d] = this.dims(def, rot);
    return [Math.round(f.x - (w - 1) / 2), Math.round(f.z - (d - 1) / 2)];
  }

  private furnitureAt(cx: number, cy: number): string | null {
    this.ray.setFromCamera(this.ndc(cx, cy), this.game.stage.camera);
    const hits = this.ray.intersectObjects(this.furn.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.uid) o = o.parent;
      if (o?.visible) return o.userData.uid as string;
    }
    return null;
  }

  pointerDown(cx: number, cy: number): void {
    const g = this.game;
    if (this.edit) {
      if (this.ghost) {
        const def = FURN_BY_ID[this.ghost.id];
        const a = this.anchorFor(def, this.ghost.rot, cx, cy);
        if (a) this.updateGhost(a[0], a[1]);
        this.commitGhost();
        return;
      }
      const uid = this.furnitureAt(cx, cy);
      if (uid) {
        const it = this.items().find((o) => o.uid === uid)!;
        this.startGhost(it.id, uid, it.rot, it.x, it.z);
      }
      return;
    }
    // 一般模式：點家具看看、點地板走過去
    const uid = this.furnitureAt(cx, cy);
    if (uid) {
      const it = this.items().find((o) => o.uid === uid);
      const def = it && FURN_BY_ID[it.id];
      if (def) {
        const [w, d] = this.dims(def, it!.rot);
        const cxw = it!.x + (w - 1) / 2, czw = def.layer === 'wall' ? -2.4 : it!.z + (d - 1) / 2;
        g.player.mover.goTo(cxw, czw + (def.layer === 'wall' ? 0 : d / 2 + 0.4), () => {
          g.player.mover.face(cxw, def.layer === 'wall' ? WALL_Z : czw);
          if (def.id === 'cozy_radio') g.music.toggleRadio();
          else if (def.sit) g.player.play('celebrate');
          g.hud.toast(`${def.emoji} ${def.name}　舒適度 +${def.comfort}${def.pets?.includes(g.pet.species) ? `（${g.pet.name}最喜歡這個）` : ''}`, 2200);
        }, 0.2);
        return;
      }
    }
    const f = this.floorAt(cx, cy);
    if (f) g.player.mover.goTo(f.x, f.z);
  }

  pointerMove(cx: number, cy: number): void {
    if (!this.edit || !this.ghost) return;
    const def = FURN_BY_ID[this.ghost.id];
    const a = this.anchorFor(def, this.ghost.rot, cx, cy);
    if (a && (a[0] !== this.ghost.x || a[1] !== this.ghost.z)) this.updateGhost(a[0], a[1]);
  }

  key(k: string): boolean {
    if (!this.active) return false;
    if (k === 'r' && this.edit) { this.rotateGhost(); return true; }
    if (k === 'escape') { if (this.ghost) this.dropGhost(true); else if (this.edit) this.setEdit(false); else void this.exit(); return true; }
    return false;
  }

  // ---------- UI ----------
  private onBar(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const a = b.dataset.a!;
    if (a === 'exit') void this.exit();
    else if (a === 'edit') this.setEdit(!this.edit);
    else if (a.startsWith('room:')) this.switchRoom(Number(a.slice(5)));
  }

  private onTray(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b || b.classList.contains('off')) return;
    const a = b.dataset.a!;
    if (a === 'shop') this.openShop();
    else if (a === 'rot') this.rotateGhost();
    else if (a === 'store') this.storeGhost();
    else if (a === 'cancel') this.dropGhost(true);
    else if (a === 'done') this.setEdit(false);
    else if (a.startsWith('put:')) {
      const id = a.slice(4);
      const def = FURN_BY_ID[id];
      this.startGhost(id, null, 0, def.layer === 'wall' ? 0 : 0, def.layer === 'wall' ? -3 : 1);
    }
  }

  renderBar(): void {
    if (!this.active) return;
    const c = this.comfort();
    const stars = '⭐'.repeat(c.stars) + '☆'.repeat(Math.max(0, COMFORT_STARS.length - 1 - c.stars));
    const tabs = this.rooms.map((r, i) => `<button data-a="room:${i}" class="${i === this.room ? 'on' : ''}">${r.name}</button>`).join('');
    this.bar.innerHTML = `<div class="ib-tabs">${tabs}</div>
      <div class="ib-comfort" title="舒適度越高，離線時累積的休息加成越多">🛋️ 舒適度 <b>${c.total}</b> ${stars}${c.penalty ? ` <small>（屋外雜草 −${c.penalty}）</small>` : ''}</div>
      <div class="ib-btns"><button data-a="edit" class="btn small ${this.edit ? '' : 'ghost'}">${this.edit ? '✅ 佈置中' : '🔨 佈置'}</button><button data-a="exit" class="btn small ghost">🚪 出門</button></div>`;
  }

  renderTray(): void {
    if (!this.edit) return;
    const d = this.game.state.data;
    const gh = this.ghost;
    const owned = Object.entries(d.furn).filter(([, n]) => n > 0);
    const list = owned.length
      ? owned.map(([id, n]) => { const def = FURN_BY_ID[id]; return def ? `<button class="ft-item ${gh?.id === id && !gh.uid ? 'on' : ''}" data-a="put:${id}"><span class="em">${def.emoji}</span><small>${def.name}</small><i>×${n}</i></button>` : ''; }).join('')
      : '<div class="ft-empty">倉庫是空的，去家具店逛逛吧</div>';
    const hint = gh ? (FURN_BY_ID[gh.id].layer === 'wall' ? '點後牆掛上去' : '移動到想放的位置再點一下；綠色可以放') : '點家具可以拿起來移動；點下面的家具擺進房間';
    this.tray.innerHTML = `<div class="ft-hint">${hint}</div><div class="ft-row"><div class="ft-list">${list}</div>
      <div class="ft-btns"><button class="btn small" data-a="shop">🛒 家具店</button>
      <button class="btn small ghost ${gh ? '' : 'off'}" data-a="rot">↻ 旋轉 (R)</button>
      <button class="btn small ghost ${gh?.uid ? '' : 'off'}" data-a="store">📦 收起</button>
      <button class="btn small ghost ${gh ? '' : 'off'}" data-a="cancel">✖ 取消</button>
      <button class="btn small" data-a="done">完成</button></div></div>`;
  }

  // ---------- 家具店 ----------
  openShop(): void {
    sfx.paper();
    this.shop.show();
    this.renderShop();
  }

  renderShop(): void {
    if (!this.shop.open) return;
    const d = this.game.state.data;
    const bySeries = new Map<string, FurnDef[]>();
    for (const f of FURNITURE.filter((x) => x.source === 'shop')) {
      const k = SERIES_LABEL[f.series];
      if (!bySeries.has(k)) bySeries.set(k, []);
      bySeries.get(k)!.push(f);
    }
    const c = this.comfort();
    let html = `<div class="jn-season">🛋️ 舒適度 <b>${c.total}</b>（房屋 ${HOUSE_COMFORT[d.house.tier]}＋家具 ${c.furniture}${c.penalty ? `－雜草 ${c.penalty}` : ''}）<br><small>同一個房間放 3 件同系列家具，那個系列 +20%。${c.sets.length ? `目前套組：${c.sets.join('、')}` : ''} 舒適度每一顆星讓離線休息加成多累積 10%。</small></div>`;
    for (const [series, list] of bySeries) {
      html += `<div class="jn-sec">${series}系列</div>` + list.map((f) => {
        const lack = d.level < f.unlock ? `Lv${f.unlock}` : d.coins < f.coins || (d.inventory.wood ?? 0) < (f.wood ?? 0) || (d.inventory.stone ?? 0) < (f.stone ?? 0) ? '材料不足' : '';
        const have = (d.furn[f.id] ?? 0) + d.rooms.reduce((s, r) => s + r.items.filter((i) => i.id === f.id).length, 0);
        const cost = `🪙${f.coins.toLocaleString()}${f.wood ? ` 🪵${f.wood}` : ''}${f.stone ? ` 🪨${f.stone}` : ''}`;
        return row(f.emoji, `${f.name} <small>舒適 +${f.comfort} · ${f.layer === 'wall' ? '牆飾' : f.layer === 'rug' ? '地毯' : `${f.w}×${f.d}`}${have ? ` · 已有 ${have}` : ''}</small>`, cost, lack || '購買', lack ? null : `buy:${f.id}`);
      }).join('');
    }
    this.shop.render(html);
  }

  buy(id: string): void {
    const f = FURN_BY_ID[id];
    const d = this.game.state.data;
    if (!f || d.level < f.unlock || d.coins < f.coins || (d.inventory.wood ?? 0) < (f.wood ?? 0) || (d.inventory.stone ?? 0) < (f.stone ?? 0)) return;
    d.coins -= f.coins;
    if (f.wood) this.game.state.addItem('wood', -f.wood);
    if (f.stone) this.game.state.addItem('stone', -f.stone);
    d.furn[id] = (d.furn[id] ?? 0) + 1;
    sfx.coin();
    this.game.hud.toast(`${f.emoji} 買了${f.name}！${this.active ? '按「🔨 佈置」擺進房間' : '進屋按「🔨 佈置」就能擺'}`, 2600);
    this.renderShop();
    this.renderTray();
    this.game.state.save();
  }

  // 其他來源（節慶、印章、愛心商店）拿到家具
  grant(id: string, n = 1): void {
    const d = this.game.state.data;
    d.furn[id] = (d.furn[id] ?? 0) + n;
    this.renderTray();
  }

  // ---------- 每幀 ----------
  update(dt: number, night: number): void {
    if (!this.active) return;
    const t = performance.now() / 1000;
    updateFurniture(this.furn, t, night);
    if (this.shell) updateFurniture(this.shell, t, night); // 窗景日夜、壁燈
    if (this.ghost) updateFurniture(this.ghost.obj, t, night);
    // 晚上點燈：暖色點光源＋有發光家具時更亮
    this.lamp.intensity = 6 + night * 22;
    if (this.edit && this.ghost) this.ghost.obj.position.y = (FURN_BY_ID[this.ghost.id].layer === 'wall' ? WALL_Y : 0.08) + Math.sin(t * 5) * 0.03;
    void dt;
  }
}
