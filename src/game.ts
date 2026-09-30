import * as THREE from 'three';
import { LAYOUT_MOBILE, LAYOUT_PC, LIGHT_TWEAKS, SCENE_LAYOUT, clone, type Layout, type LightTweaks, type SceneLayout } from './config/layout';
import { clock, dayKey, SEASON_LABEL, type Season } from './core/clock';
import { sfx } from './core/audio';
import { hashStr, mulberry32 } from './core/rng';
import { CROPS, CROP_BY_ID } from './data/crops';
import { COMBO_WINDOW_MS, PET_TOUCH_POINTS, QUALITY_LABEL, QUALITY_MULT, WEED_XP, bondLevel, plotsForLevel, type Quality } from './data/economy';
import { Stage } from './world/scene';
import { Grid, tileOf } from './world/grid';
import { World } from './world/environment';
import { Particles } from './world/particles';
import { GEO, mat, mesh, windUniforms } from './world/materials';
import { Player } from './actors/player';
import { Pet } from './actors/pet';
import { GameState, type WeedSave } from './systems/state';
import { Farm } from './systems/farm';
import { Weeds } from './systems/weeds';
import { WEATHER_ICON, WEATHER_OVERCAST, WeatherFx, weatherAt, type Weather } from './systems/weather';
import { Hud, ITEM_INFO } from './ui/hud';
import { Mower } from './systems/mower';
import { HAY_PER_TUFTS, MOWER_DEMO, MOWER_LEVEL, RANCH_DEMO, RANCH_LEVEL } from './data/economy';
import { Ranch, type CowAct } from './systems/ranch';
import { ScreenFx } from './ui/fx';

export type Target =
  | { kind: 'plot'; i: number }
  | { kind: 'weed'; id: string }
  | { kind: 'pet' }
  | { kind: 'prop'; key: string }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'cow'; act: CowAct }
  | { kind: 'cowMenu' };

const keyOf = (t: Target): string => (t.kind === 'plot' ? `p${t.i}` : t.kind === 'weed' ? `w${t.id}` : t.kind === 'prop' ? `prop${t.key}` : t.kind === 'cow' ? `cow${t.act}` : t.kind);

const WEED_ITEM: Record<WeedSave['kind'], [string, number]> = {
  sprout: ['weed', 1], bush: ['weed', 2], big: ['weed', 4], dandelion: ['dandelion', 1], leaves: ['leaf', 2], snow: ['snowball', 1],
};
const WEED_ICON: Record<WeedSave['kind'], string> = { sprout: '🌿', bush: '🌿', big: '🌾', dandelion: '🌼', leaves: '🍂', snow: '❄️' };
const SICKLE_LEVEL = 6;

export class Game {
  grid = new Grid();
  state = new GameState();
  hud = new Hud();
  layouts = { pc: clone(LAYOUT_PC), mobile: clone(LAYOUT_MOBILE) };
  layoutMode: 'auto' | 'pc' | 'mobile' = 'auto';
  sceneLayout: SceneLayout = clone(SCENE_LAYOUT);
  light: LightTweaks = clone(LIGHT_TWEAKS);
  stage: Stage;
  world: World;
  farm: Farm;
  weeds: Weeds;
  player: Player;
  pet: Pet;
  mower: Mower;
  ranch: Ranch;
  particles: Particles;
  weatherFx: WeatherFx;
  fx: ScreenFx;
  queue: Target[] = [];
  current: Target | null = null;
  weather: Weather = 'sunny';
  weatherOverride: Weather | null = null;
  season: Season;
  inputBlocked = false; // DEV 拖曳物件時暫停遊戲輸入
  private combo = 0;
  private lastPull = 0;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragSeen = new Set<string>();
  private dragging = false;
  private pinch: { d: number; a: number } | null = null;
  private secT = 0;
  private hudT = 0;
  private saveT = 0;
  private lastT = performance.now();
  private elapsed = 0;
  private fpsSamples: number[] = [];
  private treasureViews = new Map<string, THREE.Object3D>();
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private driveInput = new THREE.Vector2();
  private downAt = { t: 0, x: 0, y: 0 };

  constructor(container: HTMLElement) {
    const d = this.state.data;
    this.stage = new Stage(container, this.layout.camera);
    this.world = new World(this.stage.scene, this.grid, this.sceneLayout);
    this.farm = new Farm(this.world.root, this.state, this.sceneLayout.field);
    this.weeds = new Weeds(this.world.root, this.state, this.grid, this.sceneLayout, this.farm);
    this.particles = new Particles(this.stage.scene);
    this.weatherFx = new WeatherFx(this.stage.scene);
    this.fx = new ScreenFx(this.stage.camera);
    this.player = new Player(this.grid);
    this.pet = new Pet(this.grid);
    this.stage.scene.add(this.player.root, this.pet.root);
    this.mower = new Mower(this);
    this.ranch = new Ranch(this);
    const h = this.sceneLayout.house;
    this.player.root.position.set(h.x, 0, h.z + 3.9);
    this.pet.root.position.set(h.x - 1.2, 0, h.z + 4.4);
    this.stage.target.copy(this.player.root.position);

    const now = this.state.now();
    this.season = clock.season(now);
    this.world.applySeason(this.season);
    if (d.houseTier !== 1) this.world.setHouseTier(d.houseTier);
    if (this.state.isNew) this.weeds.seedInitial(now, this.season);
    else {
      const born = this.weeds.tick(now, this.season);
      if (born.length) window.setTimeout(() => this.hud.toast(`你不在的時候，長了 ${born.length} 株雜草 🌿`, 3200), 900);
    }
    if (this.state.rewound) window.setTimeout(() => this.hud.toast('⏰ 偵測到時間被調回，作物會等現實時間追上', 4000), 1500);
    else if (d.rested > 0 && this.state.offlineHours >= 1) window.setTimeout(() => this.hud.toast('✨ 休息加成：收成 XP ×2', 2600), 4200);

    this.wire();
    this.hud.applyLayout(this.layout);
    this.refreshHud();
    this.stage.renderer.setAnimationLoop(() => this.tick());
  }

  // ---------- 版面 ----------
  get isMobileLayout(): boolean {
    if (this.layoutMode !== 'auto') return this.layoutMode === 'mobile';
    return window.innerWidth < 768 || (matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 820);
  }

  get layout(): Layout { return this.isMobileLayout ? this.layouts.mobile : this.layouts.pc; }

  applyLayout(): void {
    this.stage.cam = this.layout.camera;
    this.hud.applyLayout(this.layout);
  }

  // ---------- 事件綁定 ----------
  private wire() {
    const d = this.state.data;
    this.state.onLevelUp = (lv) => this.onLevelUp(lv);
    this.hud.onSeed = (id) => this.selectSeed(id);
    this.hud.onBag = () => this.openBag();
    this.hud.onSell = () => this.sellAll();
    this.hud.onPet = () => this.enqueue({ kind: 'pet' });
    this.hud.onMute = () => { sfx.setMuted(!sfx.muted); this.hud.setMute(sfx.muted); };
    this.hud.onMow = () => this.toggleMower();
    this.hud.onCowAct = (act) => this.enqueue({ kind: 'cow', act });
    this.player.onTugTick = () => {
      sfx.tug();
      if (this.current?.kind === 'weed') {
        const w = this.weeds.get(this.current.id);
        if (w) this.particles.burst('dirt', this.weeds.worldPos(w, 0.05), 1, { speed: 1, up: 1.5, size: 0.06 });
      }
    };
    this.pet.name = d.pet.name;
    this.pet.onBark = () => sfx.woof();
    this.pet.onDigTick = (at) => this.particles.burst('dirt', at, 2, { speed: 1.4, up: 2.5, size: 0.08 });
    this.pet.onDug = (id, at) => this.collectTreasure(id, at);
    this.pet.onZzz = (at) => this.particles.burst('zzz', at, 1, { speed: 0.15, up: 0.5, gravity: -0.2, size: 0.28, life: 2.2 });

    const cv = this.stage.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.onUp(e);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { this.stage.dist *= 1 + e.deltaY * 0.0012; e.preventDefault(); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('resize', () => this.applyLayout());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.state.save(); });
    window.addEventListener('pagehide', () => this.state.save());
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('.lil-gui')) return;
    const k = e.key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    sfx.unlock();
    this.keys.add(k);
    if (e.repeat) return;
    if (k === 'q') this.stage.yawGoal += Math.PI / 2;
    if (k === 'e') this.stage.yawGoal -= Math.PI / 2;
    if (k >= '1' && k <= '9') { const c = CROPS[Number(k) - 1]; if (c) this.selectSeed(c.id); }
    if (k === ' ') { if (!this.mower.active) this.interactNearest(); e.preventDefault(); }
    if (k === 'b') this.openBag();
    if (k === 'm') this.hud.onMute?.();
    if (k === 'r') this.toggleMower();
    if (k === 'escape' && this.mower.active) this.toggleMower(false);
    if (k === 'escape') this.hud.hideCowMenu();
  }

  private onDown(e: PointerEvent) {
    sfx.unlock();
    if (this.inputBlocked) return;
    if (this.hud.cowMenuOpen) this.hud.hideCowMenu();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 2) {
      this.dragging = false;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
      return;
    }
    if (this.pointers.size > 1) return;
    this.dragging = true;
    this.dragSeen.clear();
    if (this.mower.active) {
      this.downAt = { t: performance.now(), x: e.clientX, y: e.clientY };
      this.mower.holdTarget = this.groundAt(e.clientX, e.clientY);
      this.mower.autoRelease = false;
      return;
    }
    const t = this.pick(e.clientX, e.clientY, false);
    if (t) { this.dragSeen.add(keyOf(t)); this.enqueue(t); }
  }

  private onMove(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.stage.dist *= this.pinch.d / Math.max(1, d);
      this.stage.yawGoal -= ang - this.pinch.a;
      this.stage.yaw = this.stage.yawGoal;
      this.pinch = { d, a: ang };
      return;
    }
    if (!this.dragging) return;
    if (this.mower.active) { this.mower.holdTarget = this.groundAt(e.clientX, e.clientY); return; }
    // 拖曳：經過的田地、雜草都排進佇列
    const t = this.pick(e.clientX, e.clientY, true);
    if (t && !this.dragSeen.has(keyOf(t))) { this.dragSeen.add(keyOf(t)); this.enqueue(t); }
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      const q = Math.PI / 4;
      this.stage.yawGoal = Math.round(this.stage.yawGoal / q) * q;
    }
    if (!this.pointers.size) {
      if (this.dragging && this.mower.active) {
        const tap = performance.now() - this.downAt.t < 260 && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 12;
        if (tap) this.mower.autoRelease = true; // 點一下：推到那裡自動停
        else this.mower.holdTarget = null; // 放開：停下
      }
      this.dragging = false;
    }
  }

  private groundAt(cx: number, cy: number): { x: number; z: number } | null {
    this.ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1), this.stage.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, hit) ? { x: hit.x, z: hit.z } : null;
  }

  // ---------- 除草機 ----------
  toggleMower(on = !this.mower.active): void {
    if (on === this.mower.active) return;
    if (on) {
      if (!MOWER_DEMO && this.state.data.level < MOWER_LEVEL) { this.hud.toast(`🚜 手推除草機在 Lv${MOWER_LEVEL} 解鎖`); return; }
      if (this.player.busy) return;
      this.clearQueue();
      this.player.mover.stop();
      this.finish();
      this.hud.toast(this.isMobileLayout ? '🚜 除草機發動！按住畫面往想去的方向推，再點 🚜 收起' : '🚜 除草機發動！WASD 或按住滑鼠推著走，R／Esc 收起', 3200);
    }
    this.mower.toggle(on);
    this.hud.setMower(on);
  }

  canDrive(x: number, z: number): boolean {
    const t = tileOf(x, z);
    return !this.grid.isBlocked(t.x, t.z) && this.farm.indexAt(t.x, t.z) < 0;
  }

  // 除草機割到雜草：不用拔，直接清掉
  mowWeed(w: WeedSave): void {
    this.removeWeed(w);
  }

  // 螢幕座標 → 目標
  pick(cx: number, cy: number, dragging: boolean): Target | null {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.stage.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, hit)) return null;
    const groundDist = this.ray.ray.origin.distanceTo(hit);
    if (!dragging) {
      const pp = this.pet.root.position;
      if (this.ray.intersectObject(this.pet.root, true).length || Math.hypot(hit.x - pp.x, hit.z - pp.z) < 0.55) return { kind: 'pet' };
      if (this.ray.intersectObject(this.ranch.cow.root, true).length) return { kind: 'cowMenu' };
      const props = this.ray.intersectObjects(this.world.interactive, true);
      if (props.length && props[0].distance < groundDist) {
        let o: THREE.Object3D | null = props[0].object;
        while (o && !o.userData.kind) o = o.parent;
        if (o) return { kind: 'prop', key: o.userData.kind as string };
      }
    }
    // 雜草：容許一點偏移，找最近的
    let best: WeedSave | null = null;
    let bestD = 0.62;
    for (const w of this.weeds.list) {
      const dd = Math.hypot(w.tx + w.ox - hit.x, w.tz + w.oz - hit.z);
      if (dd < bestD) { bestD = dd; best = w; }
    }
    if (best) return { kind: 'weed', id: best.id };
    const t = tileOf(hit.x, hit.z);
    const i = this.farm.indexAt(t.x, t.z);
    // 拖曳經過未解鎖的田地不排入佇列（單點才顯示解鎖等級）
    if (i >= 0) return dragging && !this.farm.isUnlocked(i) ? null : { kind: 'plot', i };
    if (dragging) return null;
    return { kind: 'move', x: hit.x, z: hit.z };
  }

  private interactNearest() {
    const p = this.player.root.position;
    let best: Target | null = null;
    let bd = 1.8;
    for (const w of this.weeds.list) {
      const d = Math.hypot(w.tx + w.ox - p.x, w.tz + w.oz - p.z);
      if (d < bd) { bd = d; best = { kind: 'weed', id: w.id }; }
    }
    for (let i = 0; i < this.farm.count; i++) {
      const t = this.farm.tileOf(i);
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < bd) { bd = d; best = { kind: 'plot', i }; }
    }
    const pp = this.pet.root.position;
    if (Math.hypot(pp.x - p.x, pp.z - p.z) < bd) best = { kind: 'pet' };
    if (best) this.enqueue(best);
  }

  // ---------- 動作佇列 ----------
  enqueue(t: Target): void {
    if (t.kind === 'cowMenu') { this.openCowMenu(); return; }
    if (t.kind === 'cow' && !RANCH_DEMO && this.state.data.level < RANCH_LEVEL) { this.hud.toast(`🐄 牧場在 Lv${RANCH_LEVEL} 開放`); return; }
    if (t.kind === 'move') {
      this.clearQueue();
      if (this.current && !this.player.busy) { this.player.mover.stop(); this.finish(); }
      this.queue.push(t);
      return;
    }
    const k = keyOf(t);
    if (this.current && keyOf(this.current) === k) return;
    if (this.queue.some((q) => keyOf(q) === k) || this.queue.length >= 60) return;
    // 走路中被新指令插入時，取消單純的移動
    if (this.current?.kind === 'move') { this.player.mover.stop(); this.finish(); }
    this.queue.push(t);
    this.mark(t, true);
    sfx.ui();
  }

  clearQueue(): void {
    for (const t of this.queue) this.mark(t, false);
    this.queue = [];
  }

  private mark(t: Target, on: boolean) {
    if (t.kind === 'plot') on ? this.farm.queued.add(t.i) : this.farm.queued.delete(t.i);
    if (t.kind === 'weed') on ? this.weeds.queued.add(t.id) : this.weeds.queued.delete(t.id);
  }

  private finish() {
    if (this.current) this.mark(this.current, false);
    this.current = null;
  }

  private targetPos(t: Target): { x: number; z: number } | null {
    switch (t.kind) {
      case 'plot': return this.farm.tileOf(t.i);
      case 'weed': { const w = this.weeds.get(t.id); return w ? { x: w.tx + w.ox, z: w.tz + w.oz } : null; }
      case 'pet': return { x: this.pet.root.position.x, z: this.pet.root.position.z };
      case 'move': return { x: t.x, z: t.z };
      case 'cow': return this.ranch.standSpot(t.act);
      case 'cowMenu': return null;
      case 'prop': {
        const L = this.sceneLayout;
        const p = t.key === 'house' ? { x: L.house.x, z: L.house.z + 3.6 } : t.key === 'doghouse' ? L.doghouse : t.key === 'mailbox' ? L.mailbox : L.compost;
        return { x: p.x, z: p.z };
      }
    }
  }

  private runQueue() {
    if (this.current || this.player.busy || !this.queue.length) return;
    const t = this.queue.shift()!;
    this.current = t;
    const pos = this.targetPos(t);
    if (!pos) { this.finish(); return; }
    const p = this.player.root.position;
    const reach = t.kind === 'plot' ? 0.9 : t.kind === 'weed' ? 0.7 : t.kind === 'pet' ? 0.95 : 0;
    if (t.kind === 'pet') this.pet.startPetted(p.x, p.z);
    if (t.kind === 'cow') {
      this.ranch.prepare(t.act);
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < 0.25) { this.arrive(t); return; }
    }
    if (reach && Math.hypot(pos.x - p.x, pos.z - p.z) <= reach + 0.2) { this.arrive(t); return; }
    const ok = this.player.mover.goTo(pos.x, pos.z, () => this.arrive(t), reach * 0.85);
    if (!ok) this.finish();
  }

  private arrive(t: Target) {
    if (this.current !== t) return;
    const pos = this.targetPos(t);
    if (pos && t.kind !== 'move') this.player.mover.face(pos.x, pos.z);
    switch (t.kind) {
      case 'plot': return this.actPlot(t.i);
      case 'weed': return this.actWeed(t.id);
      case 'pet': return this.actPet();
      case 'prop': return this.actProp(t.key);
      case 'move': return this.finish();
      case 'cow': return this.ranch.whenReady(() => this.actCow(t.act));
      case 'cowMenu': return this.finish();
    }
  }

  // ---------- 牧場 ----------
  private openCowMenu() {
    sfx.ui();
    this.hud.showCowMenu(this.ranch.menu(this.state.now()));
    this.placeCowMenu();
  }

  private placeCowMenu() {
    const s = this.fx.project(this.ranch.cow.root.position.clone().setY(2.3));
    this.hud.moveCowMenu(s.x, s.y);
  }

  private actCow(act: CowAct) {
    const done = () => { this.ranch.release(); this.finish(); };
    if (act === 'feed') this.ranch.doFeed(done);
    else if (act === 'brush') this.ranch.doBrush(done);
    else this.ranch.doMilk(done);
  }

  // 除草機割下的草累積成牧草
  addHayProgress(tufts: number): void {
    const d = this.state.data;
    d.hayProgress += tufts;
    while (d.hayProgress >= HAY_PER_TUFTS) {
      d.hayProgress -= HAY_PER_TUFTS;
      this.state.addItem('hay');
      const at = this.player.root.position.clone().setY(1.6);
      this.fx.float(at, '+1 🌾 牧草', 'item');
      this.fx.fly(at, '🌾', this.hud.el('bag'));
    }
  }

  // ---------- 田地 ----------
  private actPlot(i: number) {
    const now = this.state.now();
    const d = this.state.data;
    const pos = this.farm.worldPos(i);
    const status = this.farm.status(i, now);
    const done = () => this.finish();
    switch (status) {
      case 'locked':
        this.hud.toast(`🔒 Lv${this.farm.unlockLevel(i)} 解鎖這塊田`);
        return done();
      case 'grass':
        this.player.play('hoe', () => {
          this.farm.hoe(i, this.state.now());
          sfx.dig();
          this.particles.burst('dirt', pos.clone().setY(0.15), 9, { speed: 1.8, up: 3, size: 0.1 });
        }, done);
        return;
      case 'tilled': {
        const c = CROP_BY_ID[d.selectedSeed];
        if (!c || d.level < c.unlock) { this.hud.toast(`${c?.name ?? '種子'} 需要 Lv${c?.unlock}`); return done(); }
        if (c.season !== 'all' && c.season !== this.season) { this.hud.toast(`${c.name} 只能在${SEASON_LABEL[c.season]}季種植`); return done(); }
        if (d.coins < c.seed) { this.hud.toast('金幣不夠買種子了，先賣掉背包裡的東西吧 🎒'); return done(); }
        this.player.play('plant', () => {
          d.coins -= c.seed;
          this.farm.plant(i, c.id, this.state.now());
          sfx.plant();
          this.particles.burst('seed', pos.clone().setY(0.3), 5, { speed: 0.8, up: 1.5, size: 0.06 });
          this.fx.float(pos, `-${c.seed} 🪙`, 'bad');
        }, done);
        return;
      }
      case 'dry':
        this.player.play('water', () => {
          this.farm.water(i, this.state.now());
          sfx.water();
          const dir = new THREE.Vector3(0, -1, 0);
          this.particles.burst('water', pos.clone().setY(0.9), 14, { speed: 0.8, up: 0.5, size: 0.07, dir, gravity: 12 });
        }, done);
        return;
      case 'growing': {
        const c = this.farm.def(i)!;
        const left = (1 - this.farm.progress(i, now)) * c.minutes * 60;
        this.hud.toast(`${c.emoji} ${c.name}還要 ${left > 60 ? `${Math.ceil(left / 60)} 分鐘` : `${Math.ceil(left)} 秒`}`, 1400);
        return done();
      }
      case 'mature':
        this.player.play('harvest', () => this.harvest(i), done);
        return;
    }
  }

  private harvest(i: number) {
    const res = this.farm.harvest(i, this.state.now());
    if (!res) return;
    const { def, quality } = res;
    const pos = this.farm.worldPos(i, 0.5);
    const key = quality === 'normal' ? def.id : `${def.id}:${quality}`;
    this.state.addItem(key);
    this.state.data.stats.harvests++;
    sfx.harvest();
    this.particles.burst('sparkle', pos, quality === 'gold' ? 10 : 4, { speed: 1.2, up: 1.5, size: 0.35, life: 0.8 });
    this.particles.burst('grass', pos.clone().setY(0.2), 5, { speed: 1.2, up: 2, size: 0.8 });
    this.fx.fly(pos, def.emoji, this.hud.el('bag'));
    this.gainXp(def.xp, pos, true);
    if (quality !== 'normal') this.fx.float(pos.clone().setY(1), `${QUALITY_LABEL[quality]}！`, 'coin', 0.25);
    if (quality === 'gold' || Math.random() < 0.2) this.pet.react();
  }

  selectSeed(id: string): void {
    const c = CROP_BY_ID[id];
    if (!c) return;
    const d = this.state.data;
    if (d.level < c.unlock) { this.hud.toast(`${c.name} 在 Lv${c.unlock} 解鎖`); return; }
    if (c.season !== 'all' && c.season !== this.season) { this.hud.toast(`${c.name} 只能在${SEASON_LABEL[c.season]}季種植`); return; }
    d.selectedSeed = id;
    sfx.ui();
    this.refreshHud();
  }

  // ---------- 除草 ----------
  private actWeed(id: string) {
    const w = this.weeds.get(id);
    if (!w) return this.finish();
    const useSickle = this.state.data.level >= SICKLE_LEVEL && (w.kind === 'bush' || w.kind === 'big');
    if (useSickle) {
      this.player.play('sickle', () => {
        sfx.swish();
        // 鐮刀：前方扇形 1.3 m 內最多 3 株
        const p = this.player.root.position;
        const yaw = this.player.root.rotation.y;
        const hits = this.weeds.list
          .map((x) => ({ x, d: Math.hypot(x.tx + x.ox - p.x, x.tz + x.oz - p.z), a: Math.atan2(x.tx + x.ox - p.x, x.tz + x.oz - p.z) }))
          .filter((h) => h.x.id === id || (h.d < 1.3 && Math.abs(Math.atan2(Math.sin(h.a - yaw), Math.cos(h.a - yaw))) < 1.2))
          .sort((a, b) => a.d - b.d)
          .slice(0, 3);
        hits.forEach((h, k) => window.setTimeout(() => this.removeWeed(h.x), k * 70));
      }, () => this.finish());
      return;
    }
    this.player.play('pull', () => {
      const cur = this.weeds.get(id);
      if (!cur) return;
      cur.pulls--;
      if (cur.pulls > 0) {
        this.weeds.setTug(id, 0);
        this.weeds.shake(id);
        sfx.tug();
        this.particles.burst('grass', this.weeds.worldPos(cur, 0.2), 3, { speed: 1, up: 2, size: 0.7 });
      } else this.removeWeed(cur);
    }, () => {
      // 需要多拉幾次的草：繼續拉
      if (this.weeds.get(id)) this.actWeed(id);
      else this.finish();
    });
  }

  private removeWeed(w: WeedSave) {
    if (!this.weeds.get(w.id)) return;
    const pos = this.weeds.worldPos(w, 0.25);
    this.weeds.remove(w.id);
    const d = this.state.data;
    const nowMs = performance.now();
    this.combo = nowMs - this.lastPull < COMBO_WINDOW_MS ? this.combo + 1 : 1;
    this.lastPull = nowMs;
    d.stats.weedsPulled++;
    d.stats.bestCombo = Math.max(d.stats.bestCombo, this.combo);
    sfx.pop(this.combo - 1);
    const kindFx = w.kind === 'leaves' ? 'leaf' : w.kind === 'snow' ? 'snow' : w.kind === 'dandelion' ? 'fluff' : 'grass';
    this.particles.burst(kindFx, pos, w.kind === 'big' ? 14 : 9, kindFx === 'fluff' ? { speed: 1, up: 1.2, gravity: 0.4, size: 0.06, life: 1.8 } : { speed: 2, up: 3.5, size: kindFx === 'grass' ? 0.9 : 0.12 });
    this.particles.burst('dirt', pos.clone().setY(0.05), 5, { speed: 1.5, up: 2.5, size: 0.08 });
    const [item, n] = WEED_ITEM[w.kind];
    this.state.addItem(item, n);
    this.fx.fly(pos, ITEM_INFO[item].emoji, this.hud.el('bag'));
    this.gainXp(WEED_XP[w.kind], pos, false);
    // 小機率撿到幸運物
    const r = Math.random();
    if (r < 0.01) this.luckyFind('clover', pos);
    else if (r < 0.015) this.luckyFind('coin_old', pos);
    if (this.combo >= 2) {
      const s = this.fx.project(this.player.root.position.clone().setY(2.2));
      this.hud.combo(this.combo, s.x, s.y);
    }
    if (this.combo > 0 && this.combo % 10 === 0) {
      this.pet.react();
      this.particles.burst('sparkle', this.player.root.position.clone().setY(1.5), 12, { speed: 2, up: 2, size: 0.4 });
      this.gainXp(20, this.player.root.position.clone().setY(2), false);
      sfx.sparkle();
    }
  }

  private luckyFind(item: string, pos: THREE.Vector3) {
    this.state.addItem(item);
    sfx.sparkle();
    this.particles.burst('sparkle', pos, 12, { speed: 1.5, up: 2, size: 0.4 });
    this.hud.toast(`${ITEM_INFO[item].emoji} 幸運！撿到了${ITEM_INFO[item].name}`);
  }

  // ---------- 寵物 ----------
  private actPet() {
    if (this.pet.state === 'sleep') { this.hud.toast(`${this.pet.name}睡得很熟 💤`); return this.finish(); }
    this.pet.startPetted(this.player.root.position.x, this.player.root.position.z);
    this.player.play('pet', () => {
      const d = this.state.data;
      const at = this.pet.root.position.clone().setY(1);
      const left = this.state.petTouchesLeft(this.state.now());
      if (left > 0) {
        const before = bondLevel(d.pet.bond);
        d.pet.touches++;
        d.pet.bond += PET_TOUCH_POINTS;
        sfx.woof();
        this.particles.burst('heart', at, 6, { speed: 1, up: 1.5, size: 0.35, life: 1.2 });
        this.fx.float(at, `+${PET_TOUCH_POINTS} ♥`, 'love');
        const after = bondLevel(d.pet.bond);
        if (after > before) this.hud.toast(`💕 和${this.pet.name}的親密度升到 ${after} 級！`, 3000);
      } else {
        this.particles.burst('heart', at, 2, { speed: 0.6, up: 1, size: 0.3, life: 1 });
        this.hud.toast(`${this.pet.name}今天已經被摸夠囉（每天 3 次）`);
      }
    }, () => this.finish());
  }

  // ---------- 場景物件 ----------
  private actProp(key: string) {
    const d = this.state.data;
    const msg: Record<string, string> = {
      house: d.houseTier === 1 ? '🏠 奶奶留下的小木屋。Lv8 可以修繕（M1 開放），室內裝潢在 M3' : '🏠 修繕好的小木屋，煙囪冒煙了！',
      mailbox: '📬 訂單板會在 M1 開放',
      doghouse: `🐶 ${this.pet.name}的家`,
      compost: `🪣 堆肥桶：背包裡有 ${d.inventory.weed ?? 0} 株雜草（堆肥功能 M1 開放）`,
    };
    this.hud.toast(msg[key] ?? key, 2800);
    this.finish();
  }

  // ---------- 挖寶 ----------
  private refreshTreasure(now: number) {
    const tr = this.state.data.treasure;
    const day = dayKey(now);
    if (tr.day !== day) {
      tr.day = day;
      tr.spots = [];
      const rand = mulberry32(hashStr('treasure' + day));
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < 40 && tr.spots.length < n; k++) {
        const x = Math.round((rand() - 0.5) * 22), z = Math.round((rand() - 0.5) * 22);
        if (this.grid.isBlocked(x, z) || this.grid.path[this.grid.idx(x, z)] || this.farm.indexAt(x, z) >= 0 || this.weeds.at(x, z)) continue;
        tr.spots.push({ id: `t${day}-${k}`, x, z });
      }
    }
    this.syncTreasureViews();
  }

  spawnTreasure(): void {
    const p = this.player.root.position;
    const t = this.grid.nearestFree(Math.round(p.x + 3), Math.round(p.z + 1));
    if (t) this.state.data.treasure.spots.push({ id: `dev${Date.now()}`, x: t.x, z: t.z });
    this.syncTreasureViews();
  }

  private syncTreasureViews() {
    const spots = this.state.data.treasure.spots;
    for (const [id, o] of this.treasureViews) if (!spots.find((s) => s.id === id)) { this.world.root.remove(o); this.treasureViews.delete(id); }
    for (const s of spots) {
      if (this.treasureViews.has(s.id)) continue;
      const g = new THREE.Group();
      const mound = mesh(GEO.sphereLo, mat('#8c5a36', { roughness: 1 }), false);
      mound.scale.set(0.5, 0.14, 0.5);
      const gem = mesh(new THREE.OctahedronGeometry(0.12), mat('#ffd84a', { emissive: '#ffb020', emissiveIntensity: 1.2, roughness: 0.2 }), false);
      gem.position.y = 0.4;
      g.add(mound, gem);
      g.userData.gem = gem;
      g.position.set(s.x, 0, s.z);
      this.world.root.add(g);
      this.treasureViews.set(s.id, g);
    }
  }

  private collectTreasure(id: string, at: THREE.Vector3) {
    const tr = this.state.data.treasure;
    if (!tr.spots.find((s) => s.id === id)) return;
    tr.spots = tr.spots.filter((s) => s.id !== id);
    this.syncTreasureViews();
    sfx.sparkle();
    this.particles.burst('sparkle', at, 14, { speed: 2, up: 3, size: 0.4 });
    const r = Math.random();
    if (r < 0.1) {
      this.state.addItem('coin_old');
      this.hud.toast(`🐶 ${this.pet.name}挖到了古錢幣！`);
    } else if (r < 0.3) {
      this.gainXp(40, at, false);
      this.hud.toast(`🐶 ${this.pet.name}挖到了一包經驗種子！`);
    } else {
      const c = 30 + Math.floor(Math.random() * 50);
      this.state.data.coins += c;
      sfx.coin();
      this.fx.float(at, `+${c} 🪙`, 'coin');
      this.hud.toast(`🐶 ${this.pet.name}挖到了 ${c} 金幣！`);
    }
  }

  // ---------- 經驗與升級 ----------
  gainXp(base: number, at: THREE.Vector3, useRested: boolean): void {
    const r = this.state.addXp(base, useRested);
    this.fx.float(at, `+${r.gained} XP${r.rested ? ' ✨' : ''}`, r.rested ? 'rested' : 'xp');
  }

  private onLevelUp(level: number) {
    sfx.levelUp();
    const unlocks: string[] = [];
    CROPS.filter((c) => c.unlock === level).forEach((c) => unlocks.push(`${c.emoji} ${c.name}`));
    const plots = plotsForLevel(level) - plotsForLevel(level - 1);
    if (plots > 0) unlocks.push(`🟫 田地 +${plots}`);
    if (level === SICKLE_LEVEL) unlocks.push('🔪 小鐮刀');
    if (level === 8) unlocks.push('🏠 房屋修繕');
    this.hud.levelUp(level, unlocks);
    this.particles.burst('sparkle', this.player.root.position.clone().setY(1.2), 20, { speed: 3, up: 4, size: 0.45, life: 1.2 });
    if (!this.player.busy && !this.current) this.player.play('celebrate');
    this.pet.react();
  }

  // ---------- 背包 ----------
  private itemInfo(key: string): { name: string; emoji: string; price: number } | null {
    const [id, q] = key.split(':');
    const c = CROP_BY_ID[id];
    const quality = (q ?? 'normal') as Quality;
    if (!c) {
      const it = ITEM_INFO[id];
      return it && q ? { name: `${QUALITY_LABEL[quality]} ${it.name}`, emoji: it.emoji, price: Math.round(it.price * QUALITY_MULT[quality]) } : null;
    }
    return { name: `${QUALITY_LABEL[quality] ? QUALITY_LABEL[quality] + ' ' : ''}${c.name}`, emoji: c.emoji, price: Math.round(c.sell * QUALITY_MULT[quality]) };
  }

  private openBag() {
    sfx.ui();
    this.hud.openBag(this.state.data.inventory, (k) => this.itemInfo(k));
  }

  private sellAll() {
    const inv = this.state.data.inventory;
    let total = 0, n = 0;
    for (const k of Object.keys(inv)) {
      if (k === 'clover' || k === 'coin_old' || k === 'hay') continue; // 收藏品、牛的飼料不賣
      const info = this.itemInfo(k) ?? ITEM_INFO[k];
      if (!info) continue;
      total += info.price * inv[k];
      n += inv[k];
      delete inv[k];
    }
    if (!n) { this.hud.toast('沒有可以賣的東西'); return; }
    this.state.data.coins += total;
    sfx.coin();
    this.hud.closeBag();
    this.hud.toast(`賣出 ${n} 個，獲得 🪙${total}`);
    this.state.save();
  }

  // ---------- HUD ----------
  refreshHud(): void {
    const d = this.state.data;
    const now = this.state.now();
    this.hud.setStatus(d.level, d.xp, d.rested);
    this.hud.setWallet(d.coins, this.season, clock.now(), WEATHER_ICON[this.weather]);
    this.hud.setSeeds(CROPS, d.selectedSeed, d.level, this.season);
    this.hud.setPet(bondLevel(d.pet.bond), this.state.petTouchesLeft(now));
    this.hud.setBagCount(Object.entries(d.inventory).reduce((s, [, v]) => s + v, 0));
    const icons: string[] = [];
    for (const t of [this.current, ...this.queue]) {
      if (!t) continue;
      if (t.kind === 'plot') {
        const st = this.farm.status(t.i, now);
        icons.push({ locked: '🔒', grass: '⛏️', tilled: '🌱', dry: '💧', growing: '⏳', mature: '🧺' }[st]);
      } else if (t.kind === 'weed') {
        const w = this.weeds.get(t.id);
        icons.push(w ? WEED_ICON[w.kind] : '🌿');
      } else if (t.kind === 'pet') icons.push('🐶');
      else if (t.kind === 'cow') icons.push({ feed: '🌾', brush: '🪮', milk: '🥛' }[t.act]);
    }
    this.hud.setQueue(icons);
    // 簡易新手引導
    const tilled = d.plots.some((p) => p.tilled);
    let hint = '';
    if (d.stats.weedsPulled < 5) hint = '👆 點房子周圍的雜草，把奶奶的農場整理乾淨！按住拖曳可以連續拔';
    else if (d.stats.harvests < 1) hint = tilled ? '🌱 翻好的土點一下播種，再點一下澆水，蘿蔔 1 分鐘就熟' : '🟫 點右邊的田地翻土';
    else if (d.pet.bond < 10) hint = `🐶 點一下${this.pet.name}摸摸牠`;
    else if (d.cows[0].milked < 1) hint = '🐄 左邊牧場的花花等你照顧，點牠看看';
    else if (d.level < 3) hint = '🎒 收成的作物可以在背包賣掉換金幣';
    this.hud.hint(hint);
  }

  // ---------- 每幀 ----------
  private tick() {
    const tNow = performance.now();
    const dt = Math.min(0.05, (tNow - this.lastT) / 1000);
    this.lastT = tNow;
    this.elapsed += dt;
    windUniforms.uTime.value += dt;
    const now = this.state.now();

    this.secT -= dt;
    if (this.secT <= 0) {
      this.secT = 1;
      const s = clock.season(now);
      if (s !== this.season) {
        this.season = s;
        this.world.applySeason(s);
        this.hud.toast(`🍃 季節變成${SEASON_LABEL[s]}天了`, 3000);
      }
      this.weeds.tick(now, this.season);
      this.refreshTreasure(now);
      this.weather = this.weatherOverride ?? weatherAt(now, this.season);
    }

    // 鍵盤移動（相對鏡頭方向）；推除草機時交給 Mower
    this.player.manual.set(0, 0);
    const m = this.mower.active ? this.driveInput.set(0, 0) : this.player.manual;
    if (!this.inputBlocked) {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      if (f || r) {
        const y = this.stage.yaw;
        m.set(-Math.sin(y) * f + Math.cos(y) * r, -Math.cos(y) * f - Math.sin(y) * r).normalize();
        if (!this.mower.active) {
          if (this.queue.length) this.clearQueue();
          if (this.current && !this.player.busy) { this.player.mover.stop(); this.finish(); }
        }
      }
    }

    const hour = clock.hour(now);
    const night = hour >= 23 || hour < 6;
    this.stage.applyLighting(hour, WEATHER_OVERCAST[this.weather], this.light, dt);
    this.world.update(dt, this.elapsed, this.stage.glow, now);
    this.farm.update(dt, now, this.weather === 'rain' || this.weather === 'snow');
    this.weeds.update(dt);
    this.mower.update(dt, this.driveInput);
    this.ranch.update(dt, now, night);
    if (this.hud.cowMenuOpen) this.placeCowMenu();
    this.player.update(dt);
    const dh = this.sceneLayout.doghouse;
    this.pet.update(dt, { player: this.player, night, doghouse: { x: dh.x, z: dh.z, rotY: dh.rotY }, treasures: this.state.data.treasure.spots });
    if (!this.mower.active) this.runQueue();
    if (this.current?.kind === 'weed' && this.player.animName === 'pull') {
      const u = this.player.animT;
      this.weeds.setTug(this.current.id, u < 0.25 ? 0 : u < 0.66 ? (u - 0.25) / 0.41 : 0);
    }
    for (const g of this.treasureViews.values()) {
      const gem = g.userData.gem as THREE.Object3D;
      gem.rotation.y += dt * 2;
      gem.position.y = 0.4 + Math.sin(this.elapsed * 3) * 0.08;
    }
    this.particles.update(dt);
    this.weatherFx.update(dt, this.weather, this.stage.target);
    this.stage.updateCamera(this.player.root.position, dt);
    this.fx.update(dt);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.25;
      this.refreshHud();
      if (this.hud.cowMenuOpen) this.hud.showCowMenu(this.ranch.menu(now));
    }
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 10; this.state.save(); }
    this.autoQuality(dt);
    if (this.stage.checkResize()) this.applyLayout();
    this.stage.render();
  }

  // 前幾秒量測 FPS，太低就自動降畫質
  private autoQuality(dt: number) {
    if (this.elapsed < 2 || this.elapsed > 8) return;
    this.fpsSamples.push(1 / Math.max(dt, 0.001));
    if (this.fpsSamples.length >= 120) {
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.fpsSamples = [];
      if (avg < 40 && this.stage.quality !== 'low') {
        this.stage.setQuality(this.stage.quality === 'high' ? 'medium' : 'low');
        console.info(`[畫質] 平均 ${avg.toFixed(0)} FPS，自動降到 ${this.stage.quality}`);
      }
    }
  }
}
