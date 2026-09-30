import * as THREE from 'three';
import { LAYOUT_MOBILE, LAYOUT_PC, LIGHT_TWEAKS, PET_TUNING, SCENE_LAYOUT, clone, type Layout, type LightTweaks, type SceneLayout } from './config/layout';
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
import { Pet, SPECIES, GROWTH, type Species } from './actors/pet';
import { DEFAULT_LOOK } from './actors/player';
import { PetSkills } from './systems/petSkills';
import { openCreator, openPetPicker } from './ui/creator';
import { GameState, freshPet, type WeedSave } from './systems/state';
import { Farm } from './systems/farm';
import { Weeds } from './systems/weeds';
import { WEATHER_ICON, WEATHER_OVERCAST, WeatherFx, weatherAt, type Weather } from './systems/weather';
import { Hud, ITEM_INFO, type MenuView, type ToolSlot } from './ui/hud';
import { Mower } from './systems/mower';
import { COMPOST_MS, COMPOST_SLOTS, COMPOST_WEEDS, DEBRIS, HAY_PER_TUFTS, MOWER_DEMO, MOWER_LEVEL, RANCH_DEMO, RANCH_LEVEL } from './data/economy';
import { Debris } from './systems/debris';
import { Orders } from './systems/orders';
import { Tutorial } from './systems/tutorial';
import { Bubble } from './world/bubble';
import { Progression } from './systems/progression';
import { JournalUI } from './ui/journal';
import { Orchard } from './systems/orchard';
import { Workshop } from './systems/workshop';
import { WorkshopPanel } from './ui/workshopPanel';
import { RECIPE_BY_ID, WORKSHOP_LEVEL } from './data/recipes';
import { ORCHARD_LEVEL } from './data/trees';
import { GIANTS } from './data/crops';
import { HOUSE_TIERS } from './data/economy';
import { Models, loadModels } from './world/models';
import { Ranch, type CowAct } from './systems/ranch';
import { ScreenFx } from './ui/fx';
import { Tools } from './systems/tools';
import { Interior } from './systems/interior';
import { Festival } from './systems/festival';
import { Calendar } from './systems/calendar';
import { Social } from './systems/social';
import { Greenhouse } from './systems/greenhouse';
import { Music } from './core/music';
import { SettingsPanel } from './ui/settings';
import { MONTH_THEME, TOOLS } from './data/economy';

export type Target =
  | { kind: 'plot'; i: number }
  | { kind: 'weed'; id: string }
  | { kind: 'pet' }
  | { kind: 'prop'; key: string }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'cow'; act: CowAct }
  | { kind: 'menu'; key: string }
  | { kind: 'workshop' }
  | { kind: 'tree'; slot: number; act: string }
  | { kind: 'orders' }
  | { kind: 'buy'; i: number }
  | { kind: 'debris'; id: string }
  | { kind: 'compost'; act: 'add' | 'collect' }
  | { kind: 'treasure'; id: string }
  | { kind: 'mouse'; id: string };

const keyOf = (t: Target): string => {
  switch (t.kind) {
    case 'plot': return `p${t.i}`;
    case 'weed': return `w${t.id}`;
    case 'prop': return `prop${t.key}`;
    case 'cow': return `cow${t.act}`;
    case 'debris': return `d${t.id}`;
    case 'compost': return `compost${t.act}`;
    case 'treasure': return `t${t.id}`;
    case 'mouse': return `m${t.id}`;
    case 'tree': return `tree${t.slot}${t.act}`;
    default: return t.kind;
  }
};
const fmtMs = (ms: number): string => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`;
};

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
  petTuning = clone(PET_TUNING);
  stage: Stage;
  world: World;
  farm: Farm;
  weeds: Weeds;
  player: Player;
  pet: Pet;
  mower: Mower;
  ranch: Ranch;
  debris: Debris;
  orders: Orders;
  tutorial: Tutorial;
  petSkills: PetSkills;
  progression: Progression;
  journal = new JournalUI();
  orchard: Orchard;
  workshop: Workshop;
  workshopPanel = new WorkshopPanel();
  tools: Tools;
  interior: Interior;
  festival: Festival;
  calendar: Calendar;
  social: Social;
  greenhouse: Greenhouse;
  music = new Music();
  settings: SettingsPanel;
  private fadeEl: HTMLElement;
  private pokeT = 0;
  onboarding = false;
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
  private toolSlots: ToolSlot[] = [];
  private bubbles: { mail: Bubble; compost: Bubble; house: Bubble; workshop: Bubble };
  private hammerT = 0;
  private tutorialHint = '';

  constructor(container: HTMLElement) {
    const d = this.state.data;
    this.stage = new Stage(container, this.layout.camera);
    this.world = new World(this.stage.scene, this.grid, this.sceneLayout);
    this.farm = new Farm(this.world.root, this.state, this.sceneLayout.field, this.sceneLayout.greenhouse);
    this.weeds = new Weeds(this.world.root, this.state, this.grid, this.sceneLayout, this.farm);
    this.debris = new Debris(this.world.root, this.state, this.grid, this.farm, this.sceneLayout);
    this.farm.hasDebris = (i) => this.debris.onPlot(i);
    this.weeds.extraBlocked = (x, z) => !!this.debris.at(x, z);
    this.world.onRebuildGrid = () => { this.debris.applyBlocking(); this.orchard?.applyBlocking(); };
    this.particles = new Particles(this.stage.scene);
    this.weatherFx = new WeatherFx(this.stage.scene);
    this.fx = new ScreenFx(this.stage.camera);
    this.player = new Player(this.grid);
    this.pet = new Pet(this.grid, d.pet.species, d.pet.name);
    this.pet.setStage(d.pet.stage, true);
    this.player.setLook(d.look ?? DEFAULT_LOOK);
    this.stage.scene.add(this.player.root, this.pet.root);
    this.mower = new Mower(this);
    this.ranch = new Ranch(this);
    this.orders = new Orders(this);
    this.tutorial = new Tutorial(this);
    this.petSkills = new PetSkills(this);
    this.progression = new Progression(this);
    this.orchard = new Orchard(this);
    this.workshop = new Workshop(this);
    this.tools = new Tools(this);
    this.interior = new Interior(this);
    this.festival = new Festival(this);
    this.calendar = new Calendar(this);
    this.social = new Social(this);
    this.greenhouse = new Greenhouse(this);
    this.settings = new SettingsPanel(this);
    this.fadeEl = document.getElementById('fade')!;
    const L = this.sceneLayout;
    const bubbleAt = (x: number, z: number, y: number) => { const g = new THREE.Group(); g.position.set(x, 0, z); this.world.root.add(g); return new Bubble(g, y); };
    this.bubbles = { mail: bubbleAt(L.mailbox.x, L.mailbox.z, 1.85), compost: bubbleAt(L.compost.x, L.compost.z, 1.45), house: bubbleAt(L.house.x, L.house.z + 1, 5.6), workshop: bubbleAt(L.workshop.x, L.workshop.z, 3.6) };
    const h = this.sceneLayout.house;
    this.player.root.position.set(h.x, 0, h.z + 3.9);
    this.pet.root.position.set(h.x - 1.2, 0, h.z + 4.4);
    this.stage.target.copy(this.player.root.position);

    const now = this.state.now();
    this.season = clock.season(now);
    this.world.applySeason(this.season);
    if (d.house.tier !== 1) this.world.setHouseTier(d.house.tier);
    if (d.house.buildUntil) this.world.setScaffold(true);
    this.world.setGreenhouse(d.greenhouse.level, !!d.greenhouse.buildUntil);
    if (d.petHat) this.pet.setFestiveHat(d.petHat);
    this.settings.apply();
    const occupied = (x: number, z: number) => !!this.weeds.at(x, z) || d.treasure.spots.some((t) => t.x === x && t.z === z);
    if (this.state.isNew || (!d.debris.length && !d.debrisDay)) this.debris.seedInitial(now, occupied);
    else this.debris.daily(now, occupied);
    this.world.rebuildGrid();
    this.orders.refresh(now);
    this.world.rebuildGrid();
    this.progression.refresh(now);
    this.world.setDecor(d.prog.decor, this.season);
    if (this.state.isNew) this.weeds.seedInitial(now, this.season);
    else {
      const born = this.weeds.tick(now, this.season);
      if (born.length) window.setTimeout(() => this.hud.toast(`你不在的時候，長了 ${born.length} 株雜草 🌿`, 3200), 900);
    }
    const robotDid = this.tools.catchUp(now);
    if (robotDid) window.setTimeout(() => this.hud.toast(`🤖 除草小機器人在你不在時清了 ${robotDid} 株草`, 3000), 5200);
    this.calendar.welcomeBack(now, this.state.offlineHours);
    if (this.state.rewound) window.setTimeout(() => this.hud.toast('⏰ 偵測到時間被調回，作物會等現實時間追上', 4000), 1500);
    else if (d.rested > 0 && this.state.offlineHours >= 1) window.setTimeout(() => this.hud.toast('✨ 休息加成：收成 XP ×2', 2600), 4200);

    this.wire();
    this.hud.applyLayout(this.layout);
    this.refreshHud();
    this.stage.renderer.setAnimationLoop(() => this.tick());
    void loadModels().then(() => this.applyModels());
    if (d.onboard !== 'done') window.setTimeout(() => void this.runOnboarding(), 500);
    else if (d.tutorial === 0) window.setTimeout(() => void this.tutorial.start(), 700);
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
    this.state.onLevelUp = (lv) => this.onLevelUp(lv);
    this.hud.onTool = (id) => this.selectTool(id);
    this.hud.onBag = () => this.openBag();
    this.hud.onSell = () => this.sellAll();
    this.hud.onPet = () => this.enqueue({ kind: 'pet' });
    this.hud.onMute = () => { sfx.setMuted(!sfx.muted); this.hud.setMute(sfx.muted); };
    this.hud.onMow = () => this.toggleMower();
    this.hud.onMenuAct = (key, act) => this.onMenuAct(key, act);
    this.hud.onDeliver = (id) => this.deliverOrder(id);
    this.hud.onJournal = () => this.openJournal();
    this.hud.onFriends = () => { if (this.social.visiting) return; void this.social.open(); };
    this.hud.onSettings = () => this.settings.open();
    this.journal.onAction = (a) => {
      if (a.startsWith('stamp:')) this.calendar.claimStamp(Number(a.slice(6)));
      else if (a.startsWith('read:')) this.calendar.reread(Number(a.slice(5)));
      this.journal.onRender?.();
    };
    this.journal.extra = {
      stamps: { label: '📅 印章', render: () => this.calendar.stampTab(this.state.now()) },
      story: { label: '📜 故事', render: () => this.calendar.storyTab(this.state.now()) },
    };
    this.journal.onRender = () => this.journal.render(this.state.data, this.season, this.state.now());
    this.journal.onClaimTask = (id) => { this.progression.claimTask(id); this.journal.onRender?.(); };
    this.journal.onClaimTier = (i) => { this.progression.claimTier(i); this.journal.onRender?.(); };
    this.progression.onChange = () => this.journal.onRender?.();
    this.workshopPanel.onCraft = (id) => this.craft(id);
    this.workshopPanel.onCollect = () => this.collectCrafts();
    this.hud.onSkip = (id) => this.skipOrder(id);
    this.player.onTugTick = () => {
      sfx.tug();
      if (this.current?.kind === 'weed') {
        const w = this.weeds.get(this.current.id);
        if (w) this.particles.burst('dirt', this.weeds.worldPos(w, 0.05), 1, { speed: 1, up: 1.5, size: 0.06 });
      }
    };
    this.wirePet();

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
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.state.save(); this.onHidden(); } else this.onVisible(); });
    window.addEventListener('pagehide', () => this.state.save());
  }

  // ---------- PWA：圖示未讀數字、作物成熟通知 ----------
  private notifyTimer = 0;

  private readyCount(now: number): number {
    const d = this.state.data;
    let n = 0;
    for (let i = 0; i < this.farm.count; i++) if (this.farm.owned(i) && this.farm.status(i, now) === 'mature') n++;
    n += d.compost.filter((t) => t <= now).length;
    n += d.workshop.filter((w) => w.doneAt <= now).length;
    return n;
  }

  private onHidden() {
    const now = this.state.now();
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> };
    void nav.setAppBadge?.(this.readyCount(now)).catch(() => {});
    if (!this.state.data.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    // 找最快成熟的田，時間到了通知（分頁要開著，只是在背景）
    let soon = Infinity;
    for (let i = 0; i < this.farm.count; i++) {
      const c = this.farm.def(i);
      if (!c || !this.farm.owned(i) || this.farm.status(i, now) === 'mature' || c.night) continue;
      soon = Math.min(soon, (1 - this.farm.progress(i, now)) * this.farm.growMs(i, c));
    }
    if (!isFinite(soon)) return;
    window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      const body = `${this.pet.name}在田邊等你收成了 🌾`;
      void navigator.serviceWorker?.getRegistration().then((r) => {
        if (r) void r.showNotification('暖暖農場：作物成熟了！', { body, icon: './icons/icon-192.png', tag: 'ripe' });
        else new Notification('暖暖農場：作物成熟了！', { body });
      }).catch(() => {});
    }, Math.max(60000, soon));
  }

  private onVisible() {
    window.clearTimeout(this.notifyTimer);
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
    void nav.clearAppBadge?.().catch(() => {});
  }

  // 套用 Blender GLB 模型（沒有檔案時維持程式建模）
  applyModels(): void {
    this.player.useModel(Models.enabled ? Models.player : null);
    this.pet.setSpecies(this.pet.species);
  }

  private wirePet() {
    this.pet.onBark = () => this.petVoice();
    this.pet.onDigTick = (at) => this.particles.burst('dirt', at, 2, { speed: 1.4, up: 2.5, size: 0.08 });
    this.pet.onDug = (id, at) => this.collectTreasure(id, at, true);
    this.pet.onZzz = (at) => this.particles.burst('zzz', at, 1, { speed: 0.15, up: 0.5, gravity: -0.2, size: 0.28, life: 2.2 });
  }

  // 不同物種的叫聲
  petVoice(species: Species = this.pet.species): void {
    if (species === 'corgi') sfx.woof();
    else if (species === 'cat') sfx.meow();
    else if (species === 'duck') sfx.quack();
    else sfx.squeak();
  }

  // ---------- 開場：捏人 → 選寵物 → 奶奶的信 ----------
  private async runOnboarding() {
    const d = this.state.data;
    this.onboarding = true;
    document.body.classList.add('onboarding');
    this.clearQueue();
    const h = this.sceneLayout.house;
    const pl = this.player.root;
    if (d.onboard === 'look') {
      pl.position.set(h.x, 0, h.z + 4.2);
      pl.rotation.y = 0;
      this.player.mover.yawGoal = 0;
      this.pet.root.visible = false;
      const wide = window.innerWidth > 640;
      // 鏡頭拉近主角；PC 版讓主角偏左（右邊是設定卡）
      this.stage.closeUp(new THREE.Vector3(pl.position.x + (wide ? 0.9 : 0), wide ? 0.95 : 0.4, pl.position.z), wide ? 5.6 : 6.4, 8, 0);
      const r = await openCreator(d.look, d.playerName, (l) => this.player.setLook(l), { title: '✨ 捏一個你', ok: '下一步', showName: true });
      d.look = r.look;
      d.playerName = r.name;
      this.player.setLook(r.look);
      d.onboard = 'pet';
      sfx.levelUp();
      this.state.save();
    }
    if (d.onboard === 'pet') {
      this.pet.root.visible = false;
      const order: Species[] = ['corgi', 'cat', 'bunny', 'duck'];
      const narrow = window.innerWidth <= 640;
      const center = new THREE.Vector3(h.x, 0, h.z + 6);
      pl.position.set(h.x, 0, h.z + 4.2);
      const shows = order.map((sp, i) => {
        const pt = new Pet(this.grid, sp);
        pt.setStage(0, true);
        // 手機直式畫面窄：排成 2×2
        if (narrow) pt.root.position.set(center.x + (i % 2 ? 0.8 : -0.8), 0, center.z + (i < 2 ? -0.6 : 0.8));
        else pt.root.position.set(center.x - 2.4 + i * 1.6, 0, center.z);
        this.stage.scene.add(pt.root);
        return pt;
      });
      let focus: Species = 'corgi';
      const anim = new Map<Species, 'idle' | 'happy' | 'sit'>(order.map((sp) => [sp, 'sit']));
      const tick = (dt: number) => shows.forEach((pt) => pt.showcase(dt, anim.get(pt.species)!));
      this.showcaseTick = tick;
      // 鏡頭注視點放在寵物前方，讓牠們出現在選單上面
      if (narrow) this.stage.closeUp(new THREE.Vector3(center.x, 0, center.z + 2.4), 8.5, 30, 0);
      else this.stage.closeUp(new THREE.Vector3(center.x, 0.1, center.z - 0.2), 7.5, 18, 0);
      const r = await openPetPicker((sp) => {
        focus = sp;
        order.forEach((o) => anim.set(o, o === sp ? 'happy' : 'sit'));
        shows.find((pt) => pt.species === sp)!.resetTimer();
        this.petVoice(sp);
      });
      // 其他寵物揮手道別
      const chosen = shows.find((pt) => pt.species === r.species)!;
      for (const pt of shows) {
        if (pt === chosen) continue;
        this.particles.burst('fluff', pt.root.position.clone().setY(0.4), 12, { speed: 1.5, up: 1.5, gravity: -0.3, size: 0.12, life: 0.7 });
        this.stage.scene.remove(pt.root);
      }
      this.stage.scene.remove(chosen.root);
      this.showcaseTick = null;
      d.pet = freshPet(this.state.now(), r.species, r.name);
      this.pet.setSpecies(r.species);
      this.pet.name = r.name;
      this.pet.setStage(0, true);
      this.pet.root.position.copy(chosen.root.position);
      this.pet.root.visible = true;
      this.pet.react();
      this.petVoice(r.species);
      void focus;
      d.onboard = 'done';
      this.state.save();
    }
    this.stage.closeUp(null);
    document.body.classList.remove('onboarding');
    this.onboarding = false;
    if (d.tutorial === 0) window.setTimeout(() => void this.tutorial.start(), 900);
  }
  private showcaseTick: ((dt: number) => void) | null = null;

  // ---------- 寵物：技能、禮物、成長 ----------
  petEatWeed(w: WeedSave): void {
    if (!this.weeds.get(w.id)) return;
    this.progression.track('weed');
    const pos = this.weeds.worldPos(w, 0.25);
    this.weeds.remove(w.id);
    const [item, n] = WEED_ITEM[w.kind];
    this.state.addItem(item, n);
    this.state.data.stats.weedsPulled++;
    sfx.pop(0);
    this.particles.burst(w.kind === 'leaves' ? 'leaf' : w.kind === 'snow' ? 'snow' : 'grass', pos, 8, { speed: 1.5, up: 2.5, size: 0.8 });
    this.fx.float(pos.clone().setY(1), `${this.pet.name}吃掉了 ${ITEM_INFO[item].emoji}`, 'love');
    this.fx.fly(pos, ITEM_INFO[item].emoji, this.hud.el('bag'));
  }

  petGift(): void {
    const at = this.pet.root.position.clone().setY(0.9);
    this.pet.react();
    this.petVoice();
    const r = Math.random();
    const gift: [string, number] = r < 0.05 ? ['clover', 1] : r < 0.3 ? ['fert', 1] : r < 0.55 ? ['hay', 3] : r < 0.8 ? ['wood', 4] : ['stone', 4];
    this.state.addItem(gift[0], gift[1]);
    const info = ITEM_INFO[gift[0]];
    this.particles.burst('heart', at, 5, { speed: 1, up: 1.4, size: 0.3, life: 1.1 });
    this.fx.fly(at, info.emoji, this.hud.el('bag'));
    this.hud.toast(`🎁 ${this.pet.name}叼來一份禮物：${info.emoji} ${info.name} ×${gift[1]}`, 3200);
  }

  private growthStage(now: number): number {
    const d = this.state.data.pet;
    const days = (now - d.adoptedAt) / 86400000;
    const b = bondLevel(d.bond);
    return days >= 60 && b >= 6 ? 2 : days >= 14 && b >= 3 ? 1 : 0;
  }

  private growT = 0;
  private checkGrowth(now: number) {
    const d = this.state.data.pet;
    const want = this.growthStage(now);
    if (want <= d.stage || this.onboarding || this.pet.state === 'sleep' || this.player.busy) return;
    d.stage = want;
    this.pet.mover.stop();
    this.pet.setStage(want);
    this.stage.closeUp(this.pet.root.position.clone().setY(0.6), 4.5, 16, this.stage.yaw);
    this.growT = 3.2;
    sfx.fanfare();
    this.particles.burst('sparkle', this.pet.root.position.clone().setY(0.8), 26, { speed: 2.5, up: 3, size: 0.45, life: 1.3 });
    this.hud.toast(`🌟 ${this.pet.name}長大了！現在是${GROWTH[want].label}${SPECIES[d.species].label}`, 4000);
    this.state.save();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('.lil-gui, .creator, .petpick, input, textarea')) return;
    const k = e.key.toLowerCase();
    if (!down) { this.keys.delete(k); return; }
    sfx.unlock();
    this.keys.add(k);
    if (e.repeat) return;
    if (this.interior.active && this.interior.key(k)) return;
    if (k === 'escape' && this.social.visiting) { void this.social.leave(); return; }
    if (k === 'f' && !this.interior.active && !this.social.visiting) void this.social.open();
    if (k === 'q') this.stage.yawGoal += Math.PI / 2;
    if (k === 'e') this.stage.yawGoal -= Math.PI / 2;
    if (k >= '1' && k <= '9') { const s = this.toolSlots[Number(k) - 1]; if (s) this.selectTool(s.id); }
    if (k === ' ') { if (!this.mower.active && !this.interior.active && !this.social.visiting) this.interactNearest(); e.preventDefault(); }
    if (k === 'b') this.openBag();
    if (k === 'j') this.openJournal();
    if (k === 'm') this.hud.onMute?.();
    if (k === 'r' && !this.interior.active && !this.social.visiting) this.toggleMower();
    if (k === 'escape' && this.mower.active) this.toggleMower(false);
    if (k === 'escape') { this.hud.hideMenu(); this.hud.closeOrders(); this.journal.close(); this.workshopPanel.close(); for (const sh of [this.tools.sheet, this.interior.shop, this.festival.sheet, this.calendar.market, this.social.sheet, this.settings.sheet]) sh.close(); }
  }

  private onDown(e: PointerEvent) {
    sfx.unlock();
    if (this.inputBlocked || this.onboarding) return;
    if (this.hud.menuOpen) this.hud.hideMenu();
    if (this.interior.active) { this.interior.pointerDown(e.clientX, e.clientY); return; }
    if (this.social.visiting) {
      const hit = this.groundAt(e.clientX, e.clientY);
      this.ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), this.stage.camera);
      const vp = this.social.visiting.pet.root;
      const petHit = this.ray.intersectObject(vp, true).length > 0 || (!!hit && Math.hypot(hit.x - vp.position.x, hit.z - vp.position.z) < 0.55);
      this.social.pointerDown(hit ? new THREE.Vector3(hit.x, 0, hit.z) : null, petHit);
      return;
    }
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
    if (this.interior.active) this.interior.pointerMove(e.clientX, e.clientY);
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
    if (!this.dragging || this.interior.active || this.social.visiting) return;
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
      if (this.ray.intersectObject(this.ranch.cow.root, true).length) return { kind: 'menu', key: 'cow' };
      const props = this.ray.intersectObjects(this.world.interactive, true);
      if (props.length && props[0].distance < groundDist) {
        let o: THREE.Object3D | null = props[0].object;
        while (o && !o.userData.kind) o = o.parent;
        const k = o?.userData.kind as string | undefined;
        if (k === 'house' || k === 'compost' || k === 'greenhouse' || k === 'market') return { kind: 'menu', key: k };
        if (k === 'workshop') return { kind: 'workshop' };
        if (k === 'mailbox') return { kind: 'orders' };
        if (k) return { kind: 'prop', key: k };
      }
    }
    // 果園樹位
    if (!dragging) { const sl = this.orchard.slotAt(hit.x, hit.z); if (sl >= 0) return { kind: 'menu', key: `tree:${sl}` }; }
    // 田鼠、挖寶點
    for (const m of this.state.data.mice) { const mp = this.petSkills.mousePos(m); if (Math.hypot(mp.x - hit.x, mp.z - hit.z) < 0.5) return { kind: 'mouse', id: m.id }; }
    if (!dragging) for (const t of this.state.data.treasure.spots) if (Math.hypot(t.x - hit.x, t.z - hit.z) < 0.55) return { kind: 'treasure', id: t.id };
    // 荒地障礙物
    for (const db of this.debris.list) if (Math.hypot(db.x - hit.x, db.z - hit.z) < 0.62) return { kind: 'debris', id: db.id };
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
    if (i >= 0) {
      // 拖曳只處理自己的田；點一下可購買的田會跳出購買確認
      if (!this.farm.owned(i)) {
        if (dragging) return null;
        if (this.farm.status(i, this.state.now()) === 'forsale') return { kind: 'buy', i };
      }
      return { kind: 'plot', i };
    }
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
    for (const db of this.debris.list) {
      const d = Math.hypot(db.x - p.x, db.z - p.z);
      if (d < bd) { bd = d; best = { kind: 'debris', id: db.id }; }
    }
    for (let i = 0; i < this.farm.count; i++) {
      if (!this.farm.owned(i)) continue;
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
    if (t.kind === 'menu') { this.openMenu(t.key); return; }
    if (t.kind === 'orders') { this.openOrders(); return; }
    if (t.kind === 'workshop') { this.openWorkshop(); return; }
    if (t.kind === 'buy') { void this.tryBuy(t.i); return; }
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
    if (t.kind === 'debris') on ? this.debris.queued.add(t.id) : this.debris.queued.delete(t.id);
    if (t.kind === 'mouse') on ? this.petSkills.queued.add(t.id) : this.petSkills.queued.delete(t.id);
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
      case 'menu': case 'orders': case 'buy': case 'workshop': return null;
      case 'tree': { const p = this.orchard.pos(t.slot); return { x: p.x, z: p.z + 1.0 }; }
      case 'debris': { const db = this.debris.get(t.id); return db ? { x: db.x, z: db.z } : null; }
      case 'compost': return { x: this.sceneLayout.compost.x, z: this.sceneLayout.compost.z };
      case 'treasure': { const tr = this.state.data.treasure.spots.find((x) => x.id === t.id); return tr ? { x: tr.x, z: tr.z } : null; }
      case 'mouse': { const m = this.state.data.mice.find((x) => x.id === t.id); return m ? this.petSkills.mousePos(m) : null; }
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
    const reach = t.kind === 'plot' ? 0.9 : t.kind === 'weed' ? 0.7 : t.kind === 'pet' ? 0.95 : t.kind === 'debris' ? 0.95 : t.kind === 'compost' ? 1.05 : t.kind === 'treasure' ? 0.75 : t.kind === 'mouse' ? 0.8 : t.kind === 'tree' ? 0.3 : 0;
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
      case 'debris': return this.actDebris(t.id);
      case 'compost': return this.actCompost(t.act);
      case 'treasure': {
        // 主角自己挖（柯基以外的寵物不會挖寶）
        const tr = this.state.data.treasure.spots.find((x) => x.id === t.id);
        if (!tr) return this.finish();
        const at = new THREE.Vector3(tr.x, 0.3, tr.z);
        this.player.play('hoe', () => { sfx.dig(); this.particles.burst('dirt', at, 10, { speed: 1.8, up: 3, size: 0.1 }); this.collectTreasure(t.id, at, false); }, () => this.finish());
        return;
      }
      case 'mouse':
        this.player.play('harvest', () => this.petSkills.shoo(t.id), () => this.finish());
        return;
      case 'tree': return this.actTree(t.slot, t.act);
      default: return this.finish();
    }
  }

  // ---------- 動作選單（牛、堆肥桶、房子） ----------
  private menuView(key: string, now: number): MenuView {
    if (key === 'cow') return this.ranch.menu(now);
    if (key === 'compost') return this.compostMenu(now);
    if (key.startsWith('tree:')) return this.orchard.menu(Number(key.slice(5)), now);
    if (key === 'greenhouse') return this.greenhouse.menu(now);
    return this.houseMenu(now);
  }

  private menuAnchor(key: string): THREE.Vector3 {
    const L = this.sceneLayout;
    if (key === 'cow') return this.ranch.cow.root.position.clone().setY(2.3);
    if (key === 'compost') return new THREE.Vector3(L.compost.x, 1.3, L.compost.z);
    if (key.startsWith('tree:')) { const p = this.orchard.pos(Number(key.slice(5))); return new THREE.Vector3(p.x, 2.4, p.z); }
    if (key === 'greenhouse') return this.greenhouse.anchor();
    return new THREE.Vector3(L.house.x, this.state.data.house.tier >= 4 ? 5.6 : 4.2, L.house.z + 2);
  }

  private openMenu(key: string) {
    if (key === 'market') { this.calendar.openMarket(); return; }
    if (key === 'cow' && !RANCH_DEMO && this.state.data.level < RANCH_LEVEL) { this.hud.toast(`🐄 牧場在 Lv${RANCH_LEVEL} 開放`); return; }
    sfx.ui();
    this.hud.showMenu(key, this.menuView(key, this.state.now()));
    this.placeMenu();
  }

  private placeMenu() {
    if (!this.hud.menuOpen) return;
    const s = this.fx.project(this.menuAnchor(this.hud.menuOpen));
    this.hud.moveMenu(s.x, s.y);
  }

  private onMenuAct(key: string, act: string) {
    if (key === 'cow') this.enqueue({ kind: 'cow', act: act as CowAct });
    else if (key === 'compost') this.enqueue({ kind: 'compost', act: act as 'add' | 'collect' });
    else if (key === 'house' && act === 'repair') void this.startRepair();
    else if (key === 'house' && act === 'wardrobe') void this.openWardrobe();
    else if (key === 'house' && act === 'enter') void this.interior.enter();
    else if (key === 'house' && act === 'tools') this.tools.open();
    else if (key === 'house' && act === 'shop') this.interior.openShop();
    else if (key === 'greenhouse') this.greenhouse.onAct(act);
    else if (key.startsWith('tree:')) this.enqueue({ kind: 'tree', slot: Number(key.slice(5)), act });
  }

  // ---------- 堆肥桶 ----------
  private compostMenu(now: number): MenuView {
    const d = this.state.data;
    const weeds = d.inventory.weed ?? 0;
    const ready = d.compost.filter((t) => t <= now).length;
    const brewing = d.compost.filter((t) => t > now).sort((a, b) => a - b);
    const sub = brewing.length ? `發酵中 ${brewing.length} 批，最快 ${fmtMs(brewing[0] - now)}後完成` : ready ? '有機肥做好了！' : '放入雜草就能做成有機肥';
    return {
      title: '🪣 堆肥桶',
      sub,
      items: [
        { act: 'collect', emoji: '🧪', label: `收取有機肥`, enabled: ready > 0, note: ready ? `×${ready}` : '還沒好' },
        { act: 'add', emoji: '🌿', label: `放入雜草 ×${COMPOST_WEEDS}`, enabled: weeds >= COMPOST_WEEDS && d.compost.length < COMPOST_SLOTS, note: d.compost.length >= COMPOST_SLOTS ? '桶子滿了' : `背包 ${weeds} 株` },
      ],
    };
  }

  private actCompost(act: 'add' | 'collect') {
    const d = this.state.data;
    const L = this.sceneLayout.compost;
    const at = new THREE.Vector3(L.x, 0.8, L.z);
    const done = () => this.finish();
    if (act === 'add') {
      if ((d.inventory.weed ?? 0) < COMPOST_WEEDS) { this.hud.toast(`雜草不夠，要 ${COMPOST_WEEDS} 株`); return done(); }
      if (d.compost.length >= COMPOST_SLOTS) { this.hud.toast('堆肥桶滿了，等發酵好再放'); return done(); }
      this.player.play('plant', () => {
        this.state.addItem('weed', -COMPOST_WEEDS);
        d.compost.push(this.state.now() + COMPOST_MS);
        sfx.dig();
        this.particles.burst('grass', at, 12, { speed: 1, up: 2.5, size: 0.8 });
        this.hud.toast(`🪣 開始發酵，2 小時後得到有機肥 🧪`);
      }, done);
    } else {
      const now = this.state.now();
      const ready = d.compost.filter((t) => t <= now).length;
      if (!ready) { this.hud.toast('有機肥還沒做好'); return done(); }
      this.player.play('harvest', () => {
        d.compost = d.compost.filter((t) => t > now);
        this.state.addItem('fert', ready);
        this.progression.track('compost', ready);
        sfx.harvest();
        this.particles.burst('sparkle', at, 8, { speed: 1.2, up: 2, size: 0.35 });
        this.fx.float(at.clone().setY(1.4), `+${ready} 🧪 有機肥`, 'item');
        this.fx.fly(at, '🧪', this.hud.el('bag'));
        this.hud.toast('🧪 有機肥：選工具列的「有機肥」，點已播種的田就能施肥（品質更好）', 3600);
      }, done);
    }
  }

  // ---------- 房屋修繕 ----------
  private houseMenu(now: number): MenuView {
    const d = this.state.data;
    const h = d.house;
    const wood = d.inventory.wood ?? 0;
    const building = h.buildUntil !== null;
    const sub = building ? `🔨 施工中，還要 ${fmtMs(h.buildUntil! - now)}` : h.tier === 1 ? '窗戶破了、屋頂也缺了幾片瓦…' : '溫暖的家，煙囪冒著煙 ♪';
    const items: MenuView['items'] = [];
    const next = HOUSE_TIERS[h.tier + 1];
    if (next && !building) {
      const stone = d.inventory.stone ?? 0;
      const lack: string[] = [];
      const crafted = this.craftedCount(), parts = d.inventory.windpart ?? 0;
      if (d.level < next.level) lack.push(`Lv${next.level} 解鎖`);
      else {
        if (d.coins < next.coins) lack.push(`🪙${d.coins.toLocaleString()}/${next.coins.toLocaleString()}`);
        if (wood < next.wood) lack.push(`🪵${wood}/${next.wood}`);
        if (stone < next.stone) lack.push(`🪨${stone}/${next.stone}`);
        if (next.crafted && crafted < next.crafted) lack.push(`🍞${crafted}/${next.crafted}`);
        if (next.parts && parts < next.parts) lack.push(`⚙️${parts}/${next.parts}`);
      }
      items.push({ act: 'repair', emoji: '🔨', label: h.tier === 1 ? '修繕房屋' : `擴建成${next.name}`, enabled: !lack.length, note: lack.length ? lack.join(' ') : `🪙${next.coins.toLocaleString()} 🪵${next.wood}${next.stone ? ` 🪨${next.stone}` : ''}${next.crafted ? ` 🍞${next.crafted}` : ''}${next.parts ? ` ⚙️${next.parts}` : ''}` });
    }
    const c = this.interior.comfort();
    items.push({ act: 'enter', emoji: '🚪', label: '進屋', enabled: !building, note: building ? '施工中' : `舒適度 ${c.total} ${'⭐'.repeat(c.stars)}` });
    items.push({ act: 'tools', emoji: '🧰', label: '工具箱', enabled: true, note: '升級澆水壺、鋤頭、鐮刀…' });
    items.push({ act: 'wardrobe', emoji: '👕', label: '換裝', enabled: true, note: '換髮型、衣服顏色' });
    return { title: h.tier === 1 ? '🏠 奶奶的小木屋' : `🏠 ${HOUSE_TIERS[h.tier]?.name ?? '小木屋'}`, sub, items };
  }

  private async openWardrobe() {
    const d = this.state.data;
    this.onboarding = true;
    document.body.classList.add('onboarding');
    this.clearQueue();
    this.player.mover.stop();
    const pl = this.player.root;
    pl.rotation.y = this.stage.yaw;
    this.player.mover.yawGoal = this.stage.yaw;
    const wide = window.innerWidth > 640;
    this.stage.closeUp(new THREE.Vector3(pl.position.x + (wide ? Math.cos(this.stage.yaw) * 0.9 : 0), wide ? 0.95 : 0.4, pl.position.z - (wide ? Math.sin(this.stage.yaw) * 0.9 : 0)), wide ? 5.6 : 6.4, 8, this.stage.yaw);
    const r = await openCreator(d.look, d.playerName, (l) => this.player.setLook(l), { title: '👕 換裝', ok: '完成', showName: false });
    d.look = r.look;
    this.player.setLook(r.look);
    this.stage.closeUp(null);
    document.body.classList.remove('onboarding');
    this.onboarding = false;
    sfx.sparkle();
    this.state.save();
  }

  private async startRepair() {
    const d = this.state.data;
    const next = HOUSE_TIERS[d.house.tier + 1];
    if (!next) return;
    const hours = next.ms / 3600000;
    const extra = `${next.crafted ? ` ＋ 🍞 任意加工品 ×${next.crafted}` : ''}${next.parts ? ` ＋ ⚙️ 風車零件 ×${next.parts}` : ''}`;
    const ok = await this.hud.confirm(`🔨 ${d.house.tier === 1 ? '修繕房屋' : `擴建成${next.name}`}`, `花費 🪙${next.coins.toLocaleString()} ＋ 🪵 木材 ×${next.wood}${next.stone ? ` ＋ 🪨 石材 ×${next.stone}` : ''}${extra}<br>木匠老木會來施工，大約 ${hours} 小時完工。`, '開始施工');
    if (!ok) return;
    if (d.coins < next.coins || (d.inventory.wood ?? 0) < next.wood || (d.inventory.stone ?? 0) < next.stone || d.house.buildUntil || (next.crafted && this.craftedCount() < next.crafted) || (next.parts && (d.inventory.windpart ?? 0) < next.parts)) { this.hud.toast('材料不夠了'); return; }
    d.coins -= next.coins;
    this.state.addItem('wood', -next.wood);
    if (next.stone) this.state.addItem('stone', -next.stone);
    if (next.parts) this.state.addItem('windpart', -next.parts);
    if (next.crafted) this.consumeCrafted(next.crafted);
    d.house.buildUntil = this.state.now() + next.ms;
    this.world.setScaffold(true);
    const L = this.sceneLayout.house;
    this.particles.burst('fluff', new THREE.Vector3(L.x, 1.5, L.z + 2.5), 20, { speed: 2.5, up: 2, gravity: -0.3, size: 0.2, life: 1 });
    sfx.coin();
    this.hud.toast(`🔨 木匠老木開始施工了！大約 ${hours} 小時後完工`, 3200);
    this.state.save();
  }

  private updateConstruction(dt: number, now: number) {
    const h = this.state.data.house;
    if (!h.buildUntil) return;
    const L = this.sceneLayout.house;
    if (now >= h.buildUntil) {
      h.buildUntil = null;
      h.tier = Math.min(5, h.tier + 1);
      this.state.data.houseTier = h.tier;
      this.world.setScaffold(false);
      this.world.setHouseTier(h.tier);
      const at = new THREE.Vector3(L.x, 2, L.z + 1);
      this.particles.burst('fluff', at, 30, { speed: 3.5, up: 3, gravity: -0.3, size: 0.28, life: 1.2 });
      this.particles.burst('sparkle', at.clone().setY(3), 24, { speed: 3, up: 4, size: 0.5, life: 1.4 });
      sfx.fanfare();
      const done: Record<number, string> = { 2: '🏠 房屋修繕完成！煙囪冒煙了，窗戶也亮起來了', 3: '🏠 紅頂農舍落成！多了一間臥室和門廊搖椅', 4: '🏡 雙層農莊落成！多了廚房和閣樓，陽台還有花台', 5: '🌬️ 風車莊園落成！風車轉起來了，晚上屋簷會亮起燈串' };
      this.hud.toast(done[h.tier] ?? '🏠 房屋完工！', 4200);
      this.interior.renderBar();
      this.pet.react();
      if (!this.player.busy && !this.current) this.player.play('celebrate');
      this.state.save();
      return;
    }
    // 施工中：依距離播敲打聲、偶爾冒灰塵
    this.hammerT -= dt;
    if (this.hammerT <= 0) {
      this.hammerT = 0.28 + Math.random() * 0.5;
      const p = this.player.root.position;
      const dist = Math.hypot(p.x - L.x, p.z - L.z);
      sfx.hammer(Math.pow(Math.max(0, 1 - (dist - 4) / 14), 2));
      if (Math.random() < 0.3) this.particles.burst('fluff', new THREE.Vector3(L.x + (Math.random() - 0.5) * 5, 1 + Math.random() * 2.5, L.z + 2.6), 3, { speed: 0.6, up: 0.6, gravity: -0.2, size: 0.12, life: 0.9 });
    }
  }

  // 背包裡的加工品數量（房屋 T4 要用）
  craftedCount(): number {
    const inv = this.state.data.inventory;
    return Object.entries(inv).reduce((n, [k, v]) => n + (RECIPE_BY_ID[k.split(':')[0]] && k !== 'windpart' ? v : 0), 0);
  }

  private consumeCrafted(n: number) {
    const inv = this.state.data.inventory;
    // 先用便宜的
    const keys = Object.keys(inv).filter((k) => RECIPE_BY_ID[k.split(':')[0]] && k !== 'windpart').sort((a, b) => RECIPE_BY_ID[a.split(':')[0]].sell - RECIPE_BY_ID[b.split(':')[0]].sell);
    for (const k of keys) { if (n <= 0) break; const take = Math.min(n, inv[k]); this.state.addItem(k, -take); n -= take; }
  }

  // 進出室內、拜訪好友時的淡入淡出
  fade(on: boolean): Promise<void> {
    this.fadeEl.classList.toggle('on', on);
    return new Promise((r) => window.setTimeout(r, 320));
  }

  // 拜訪好友時把自己農場的東西藏起來
  setOwnFarmVisible(v: boolean): void {
    this.farm.root.visible = v;
    this.weeds.root.visible = v;
    this.debris.root.visible = v;
    this.orchard.root.visible = v;
    if (this.tools.robot) this.tools.robot.visible = v;
    for (const o of this.treasureViews.values()) o.visible = v;
    for (const b of Object.values(this.bubbles)) if (b.sprite.parent) b.sprite.parent.visible = v;
  }

  // 依距離播音效
  soundAt(name: 'swish' | 'robot' | 'pop', at: THREE.Vector3): void {
    const p = this.player.root.position;
    const v = Math.pow(Math.max(0, 1 - (Math.hypot(at.x - p.x, at.z - p.z) - 3) / 14), 2);
    sfx.at(v, () => (name === 'pop' ? sfx.pop(0) : sfx[name]()));
  }

  // ---------- 農場手帳 ----------
  private openJournal() {
    sfx.paper();
    this.hud.hideMenu();
    this.journal.show();
    this.journal.onRender?.();
  }

  // ---------- 加工坊 ----------
  private openWorkshop() {
    if (!this.workshop.unlocked) { this.hud.toast(`🍞 加工坊在 Lv${WORKSHOP_LEVEL} 開放`); return; }
    sfx.ui();
    this.workshopPanel.show();
    this.workshopPanel.render(this.workshop.view(this.state.now()));
  }

  private craft(id: string) {
    if (!this.workshop.start(id, this.state.now())) { this.hud.toast('材料不夠或欄位滿了'); return; }
    const r = RECIPE_BY_ID[id];
    sfx.plant();
    const L = this.sceneLayout.workshop;
    this.particles.burst('fluff', new THREE.Vector3(L.x, 1.4, L.z + 1.2), 6, { speed: 1, up: 1, gravity: -0.2, size: 0.1, life: 0.6 });
    this.hud.toast(`🍞 開始做${r.name}`);
    this.workshopPanel.render(this.workshop.view(this.state.now()));
  }

  private collectCrafts() {
    const done = this.workshop.collect(this.state.now());
    if (!done.length) return;
    const L = this.sceneLayout.workshop;
    const at = new THREE.Vector3(L.x, 1.6, L.z + 1.2);
    for (const r of done) {
      this.state.addItem(r.id);
      this.progression.record(r.id);
      this.fx.fly(at, r.emoji, this.hud.el('bag'));
    }
    this.progression.track('craft', done.length);
    this.gainXp(done.reduce((s, r) => s + r.xp, 0), at, false);
    sfx.harvest();
    this.particles.burst('sparkle', at, 8, { speed: 1.2, up: 2, size: 0.35 });
    this.workshopPanel.render(this.workshop.view(this.state.now()));
    this.state.save();
  }

  // ---------- 果園 ----------
  private actTree(slot: number, act: string) {
    const now = this.state.now();
    const p = this.orchard.pos(slot);
    this.player.mover.face(p.x, p.z);
    if (act.startsWith('plant:')) {
      const id = act.slice(6);
      this.player.play('plant', () => {
        if (!this.orchard.plant(slot, id, this.state.now())) { this.hud.toast('種不了這棵樹'); return; }
        sfx.dig();
        this.particles.burst('dirt', new THREE.Vector3(p.x, 0.2, p.z), 10, { speed: 1.6, up: 2.5, size: 0.1 });
        this.hud.toast('🌳 種下果樹了！成熟需要一段日子，耐心等等吧', 3000);
      }, () => this.finish());
      return;
    }
    if (act === 'pick') {
      if (this.orchard.status(slot, now).st !== 'ready') { this.hud.toast('還沒有果實'); this.finish(); return; }
      this.player.play('harvest', () => {
        const def = this.orchard.pick(slot, this.state.now());
        if (!def) return;
        const at = new THREE.Vector3(p.x, 1.8, p.z);
        this.state.addItem(def.id, def.yieldN);
        this.progression.record(def.id);
        this.progression.track('fruit');
        this.progression.track('harvest');
        sfx.harvest();
        this.particles.burst('leaf', at, 10, { speed: 1.5, up: 1, size: 0.12 });
        this.particles.burst('sparkle', at, 6, { speed: 1, up: 1.5, size: 0.35 });
        this.fx.float(at.clone().setY(2.4), `+${def.yieldN} ${def.emoji}`, 'item');
        this.fx.fly(at, def.emoji, this.hud.el('bag'));
        this.gainXp(def.xp, at, true);
      }, () => this.finish());
      return;
    }
    this.finish();
  }

  // ---------- 訂單板 ----------
  private openOrders() {
    sfx.paper();
    this.orders.d.seen = true;
    this.hud.openOrders(this.orders.nextRefreshText(this.state.now()), this.orders.cards());
  }

  private deliverOrder(id: string) {
    const o = this.orders.deliver(id);
    if (!o) return;
    // 月份主題：訂單金幣加成
    const bonus = Math.round(o.coins * ((MONTH_THEME[new Date(this.state.now()).getMonth() + 1].orderCoins ?? 1) - 1));
    if (bonus) { this.state.data.coins += bonus; o.coins += bonus; }
    this.progression.track('order');
    this.progression.track('coins', o.coins);
    const L = this.sceneLayout.mailbox;
    const at = new THREE.Vector3(L.x, 1.4, L.z);
    sfx.coin();
    sfx.sparkle();
    this.particles.burst('sparkle', at, 16, { speed: 2, up: 3, size: 0.4 });
    this.fx.float(at, `+${o.coins} 🪙`, 'coin');
    this.gainXp(o.xp, at.clone().setY(1.9), false);
    this.pet.react();
    this.hud.openOrders(this.orders.nextRefreshText(this.state.now()), this.orders.cards());
    this.state.save();
  }

  private skipOrder(id: string) {
    const err = this.orders.skip(id, this.state.now());
    if (err) { this.hud.toast(err); return; }
    sfx.paper();
    this.hud.openOrders(this.orders.nextRefreshText(this.state.now()), this.orders.cards());
  }

  // ---------- 買地、清荒地 ----------
  private async tryBuy(i: number) {
    const price = this.farm.nextPrice();
    const d = this.state.data;
    if (d.coins < price) { this.hud.toast(`買這塊田要 🪙${price}，金幣不夠`); return; }
    const ok = await this.hud.confirm('🟫 購買田地', `花 🪙${price} 買下這塊田？<br><small>之後的田會越來越貴</small>`, '購買');
    if (!ok || this.farm.owned(i) || d.coins < price) return;
    d.coins -= price;
    this.farm.buy(i);
    const at = this.farm.worldPos(i, 0.4);
    sfx.coin();
    this.particles.burst('sparkle', at, 12, { speed: 1.5, up: 2.5, size: 0.4 });
    this.particles.burst('dirt', at.clone().setY(0.1), 8, { speed: 1.5, up: 2, size: 0.09 });
    this.hud.toast('🟫 買到新的田了！點它翻土就能種', 2600);
    this.state.save();
  }

  private actDebris(id: string) {
    const db = this.debris.get(id);
    if (!db) return this.finish();
    const spec = DEBRIS[db.kind];
    const pos = this.debris.worldPos(db, 0.35);
    this.player.play(spec.tool === 'axe' ? 'chop' : 'mine', () => {
      const cur = this.debris.get(id);
      if (!cur) return;
      cur.hits -= this.tools.power(spec.tool === 'axe' ? 'axe' : 'pick');
      if (spec.tool === 'axe') sfx.chop(); else sfx.mine();
      this.particles.burst(spec.item === 'wood' ? 'chip' : 'rock', pos, 5, { speed: 1.8, up: 2.5, size: spec.item === 'wood' ? 0.7 : 0.08 });
      if (cur.hits > 0) { this.debris.shake(id); return; }
      // 碎掉：掉出材料
      this.debris.remove(id);
      this.world.rebuildGrid();
      sfx.crumble();
      this.particles.burst(spec.item === 'wood' ? 'chip' : 'rock', pos, 16, { speed: 2.6, up: 3.5, size: spec.item === 'wood' ? 0.9 : 0.12 });
      this.particles.burst('dirt', pos.clone().setY(0.1), 8, { speed: 1.6, up: 2, size: 0.09 });
      this.state.addItem(spec.item, spec.n);
      this.progression.track('debris');
      const info = ITEM_INFO[spec.item];
      this.fx.float(pos.clone().setY(1.2), `+${spec.n} ${info.emoji} ${info.name}`, 'item');
      this.fx.fly(pos, info.emoji, this.hud.el('bag'));
      this.gainXp(spec.xp, pos.clone().setY(1.6), false);
    }, () => {
      if (this.debris.get(id)) this.actDebris(id); // 還沒碎：繼續敲
      else this.finish();
    });
  }

  // ---------- 牧場 ----------
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
  private actPlot(i: number): void {
    const now = this.state.now();
    const d = this.state.data;
    const pos = this.farm.worldPos(i);
    const status = this.farm.status(i, now);
    const done = () => this.finish();
    if (status === 'giantpart') return this.actPlot(this.farm.plot(i).giantOf!);
    switch (status) {
      case 'locked':
        this.hud.toast(`🔒 Lv${this.farm.unlockLevel(i)} 可以買這塊田`);
        return done();
      case 'debris':
        this.hud.toast('🪨 先把這塊田上的石頭或樹樁清掉，才能買下來');
        return done();
      case 'forsale':
        void this.tryBuy(i);
        return done();
      case 'grass':
        this.player.play('hoe', () => {
          const t = this.state.now();
          for (const j of this.tools.area('hoe', i)) {
            if (this.farm.status(j, t) !== 'grass') continue;
            this.farm.hoe(j, t);
            this.particles.burst('dirt', this.farm.worldPos(j, 0.15), j === i ? 9 : 5, { speed: 1.8, up: 3, size: 0.1 });
            if (j !== i) this.queue = this.queue.filter((q) => !(q.kind === 'plot' && q.i === j));
          }
          sfx.dig();
        }, done);
        return;
      case 'tilled': {
        if (d.selectedTool === 'fert') { this.hud.toast('🧪 有機肥要施在已經播種的田上'); return done(); }
        if (d.selectedTool === 'giant') {
          const g = GIANTS.find((x) => x.season === this.season);
          if (!g) return done();
          if (!this.farm.giantBlock(i)) { this.hud.toast('🌰 巨型種子要種在「這塊當左上角」的 3×3 田上，9 塊都要翻好土、空著'); return done(); }
          this.player.play('plant', () => {
            if (!this.farm.plantGiant(i, g.id, this.state.now())) return;
            this.state.addItem('giantseed', -1);
            if ((d.inventory.giantseed ?? 0) < 1) d.selectedTool = 'seed';
            sfx.sparkle();
            this.particles.burst('sparkle', this.farm.worldPos(i + 1 + 6, 0.5), 16, { speed: 2, up: 2.5, size: 0.4 });
            this.hud.toast(`🌰 種下了${g.name}！3 天後就會長成巨大的樣子`, 3200);
          }, done);
          return;
        }
        const c = CROP_BY_ID[d.selectedSeed];
        if (!c || d.level < c.unlock) { this.hud.toast(`${c?.name ?? '種子'} 需要 Lv${c?.unlock}`); return done(); }
        if (c.season !== 'all' && c.season !== this.season && !this.farm.isGH(i)) { this.hud.toast(`${c.name} 只能在${SEASON_LABEL[c.season]}季種植（溫室裡什麼季節都能種）`); return done(); }
        if (d.coins < c.seed) { this.hud.toast('金幣不夠買種子了，先賣掉背包裡的東西吧 🎒'); return done(); }
        this.player.play('plant', () => {
          d.coins -= c.seed;
          this.farm.plant(i, c.id, this.state.now());
          this.progression.track('plant');
          sfx.plant();
          this.particles.burst('seed', pos.clone().setY(0.3), 5, { speed: 0.8, up: 1.5, size: 0.06 });
          this.fx.float(pos, `-${c.seed} 🪙`, 'bad');
        }, done);
        return;
      }
      case 'dry':
        if (this.tryFertilize(i)) return;
        this.player.play('water', () => {
          const t = this.state.now();
          const dir = new THREE.Vector3(0, -1, 0);
          // 水壺升級後一次澆多塊（只澆有作物、還沒濕的）
          for (const j of this.tools.area('can', i)) {
            const st = this.farm.status(j, t);
            if (j !== i && st !== 'dry') continue;
            this.farm.water(j, t);
            this.progression.track('water');
            this.particles.burst('water', this.farm.worldPos(j, 0.9), j === i ? 14 : 8, { speed: 0.8, up: 0.5, size: 0.07, dir, gravity: 12 });
            if (j !== i) this.queue = this.queue.filter((q) => !(q.kind === 'plot' && q.i === j));
          }
          sfx.water();
        }, done);
        return;
      case 'growing': {
        if (this.tryFertilize(i)) return;
        const c = this.farm.def(i)!;
        const left = (1 - this.farm.progress(i, now)) * c.minutes * 60;
        this.hud.toast(`${c.emoji} ${c.name}還要 ${left > 3600 ? `${Math.floor(left / 3600)} 小時 ${Math.ceil((left % 3600) / 60)} 分` : left > 60 ? `${Math.ceil(left / 60)} 分鐘` : `${Math.ceil(left)} 秒`}${c.night ? '（只在晚上 7 點到清晨 5 點生長）' : ''}`, 2000);
        return done();
      }
      case 'mature':
        this.player.play('harvest', () => this.harvest(i), done);
        return;
    }
  }

  private harvest(i: number) {
    const stolenBy = this.farm.plot(i).stolen;
    const res = this.farm.harvest(i, this.state.now());
    if (!res) return;
    this.farm.plot(i).stolen = undefined;
    const { def, quality } = res;
    const pos = this.farm.worldPos(i, 0.5);
    const key = quality === 'normal' ? def.id : `${def.id}:${quality}`;
    this.state.addItem(key);
    this.state.data.stats.harvests++;
    this.progression.track('harvest');
    if (quality === 'gold') this.progression.track('gold');
    this.progression.record(key);
    if (def.giant) {
      sfx.fanfare();
      this.particles.burst('sparkle', pos.clone().setY(1.5), 30, { speed: 3, up: 4, size: 0.5, life: 1.4 });
      this.hud.toast(`🎉 收成了${def.name}！`, 3200);
    }
    sfx.harvest();
    this.particles.burst('sparkle', pos, quality === 'gold' ? 10 : 4, { speed: 1.2, up: 1.5, size: 0.35, life: 0.8 });
    this.particles.burst('grass', pos.clone().setY(0.2), 5, { speed: 1.2, up: 2, size: 0.8 });
    this.fx.fly(pos, def.emoji, this.hud.el('bag'));
    this.gainXp(Math.round(def.xp * (stolenBy ? 0.8 : 1)), pos, true, 'harvest');
    if (stolenBy) this.fx.float(pos.clone().setY(1.5), `被${stolenBy}偷走了一點點 🤭`, 'bad', 0.4);
    if (quality !== 'normal') this.fx.float(pos.clone().setY(1), `${QUALITY_LABEL[quality]}！`, 'coin', 0.25);
    if (this.pet.species === 'bunny' && def.shape.kind === 'root' && Math.random() < 0.1) {
      this.state.addItem(key);
      this.fx.float(pos.clone().setY(1.3), `🐰 多收 1 個！`, 'love', 0.35);
    }
    if (quality === 'gold' || Math.random() < 0.2) this.pet.react();
  }

  // 施肥模式：點已播種、還沒熟的田就施肥
  private tryFertilize(i: number): boolean {
    const d = this.state.data;
    if (d.selectedTool !== 'fert') return false;
    if (this.farm.plot(i).fert) { this.hud.toast('這塊田已經施過肥了'); this.finish(); return true; }
    if ((d.inventory.fert ?? 0) < 1) { this.hud.toast('有機肥用完了，去堆肥桶做一些吧'); d.selectedTool = 'seed'; this.finish(); return true; }
    const pos = this.farm.worldPos(i);
    this.player.play('fert', () => {
      this.state.addItem('fert', -1);
      this.farm.fertilize(i);
      sfx.plant();
      this.particles.burst('sparkle', pos.clone().setY(0.4), 6, { speed: 0.8, up: 1.2, size: 0.3 });
      if ((d.inventory.fert ?? 0) < 1) d.selectedTool = 'seed';
    }, () => this.finish());
    return true;
  }

  selectTool(id: string): void {
    const d = this.state.data;
    if (id === 'giant') {
      if ((d.inventory.giantseed ?? 0) < 1) return;
      d.selectedTool = 'giant';
      sfx.ui();
      this.hud.toast('🌰 點一塊田當 3×3 的左上角（9 塊都要翻好土、空著）', 3200);
      this.refreshHud();
      return;
    }
    if (id === 'fert') {
      if ((d.inventory.fert ?? 0) < 1) { this.hud.toast('還沒有有機肥：把雜草放進堆肥桶就能做'); return; }
      d.selectedTool = 'fert';
      sfx.ui();
      this.refreshHud();
      return;
    }
    this.selectSeed(id);
  }

  selectSeed(id: string): void {
    const c = CROP_BY_ID[id];
    if (!c) return;
    const d = this.state.data;
    if (d.level < c.unlock) { this.hud.toast(`${c.name} 在 Lv${c.unlock} 解鎖`); return; }
    const pp = this.player.root.position;
    if (c.season !== 'all' && c.season !== this.season && !this.farm.inGreenhouse(pp.x, pp.z)) { this.hud.toast(`${c.name} 只能在${SEASON_LABEL[c.season]}季種植（溫室裡什麼季節都能種）`); return; }
    d.selectedSeed = id;
    d.selectedTool = 'seed';
    sfx.ui();
    this.refreshHud();
  }

  // ---------- 除草 ----------
  private actWeed(id: string) {
    const w = this.weeds.get(id);
    if (!w) return this.finish();
    const useSickle = this.tools.tier('sickle') >= 1 && (w.kind === 'bush' || w.kind === 'big');
    if (useSickle) {
      this.player.play('sickle', () => {
        sfx.swish();
        // 鐮刀：前方扇形 1.3 m 內最多 3 株
        const p = this.player.root.position;
        const yaw = this.player.root.rotation.y;
        const reach = this.tools.sickleReach();
        const hits = this.weeds.list
          .map((x) => ({ x, d: Math.hypot(x.tx + x.ox - p.x, x.tz + x.oz - p.z), a: Math.atan2(x.tx + x.ox - p.x, x.tz + x.oz - p.z) }))
          .filter((h) => h.x.id === id || (h.d < reach.r && Math.abs(Math.atan2(Math.sin(h.a - yaw), Math.cos(h.a - yaw))) < 1.2))
          .sort((a, b) => a.d - b.d)
          .slice(0, reach.n);
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
    this.progression.track('weed');
    this.lastPull = nowMs;
    d.stats.weedsPulled++;
    d.stats.bestCombo = Math.max(d.stats.bestCombo, this.combo);
    sfx.pop(this.combo - 1);
    const kindFx = w.kind === 'leaves' ? 'leaf' : w.kind === 'snow' ? 'snow' : w.kind === 'dandelion' ? 'fluff' : 'grass';
    this.particles.burst(kindFx, pos, w.kind === 'big' ? 14 : 9, kindFx === 'fluff' ? { speed: 1, up: 1.2, gravity: 0.4, size: 0.06, life: 1.8 } : { speed: 2, up: 3.5, size: kindFx === 'grass' ? 0.9 : 0.12 });
    this.particles.burst('dirt', pos.clone().setY(0.05), 5, { speed: 1.5, up: 2.5, size: 0.08 });
    const [item, n] = WEED_ITEM[w.kind];
    const pr = w.by ? 2 : 1; // 好友惡作劇放的草：獎勵加倍
    this.state.addItem(item, n * pr);
    this.fx.fly(pos, ITEM_INFO[item].emoji, this.hud.el('bag'));
    this.gainXp(WEED_XP[w.kind] * pr, pos, false, 'weed');
    if (w.by) this.fx.float(pos.clone().setY(1.3), `${w.by}放的草！獎勵 ×2`, 'love', 0.3);
    if (d.settings.haptics) navigator.vibrate?.(12);
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
    this.progression.record(item);
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
        const pts = Math.round(PET_TOUCH_POINTS * (d.pet.species === 'duck' && this.weather === 'rain' ? 2 : 1) * (MONTH_THEME[new Date(this.state.now()).getMonth() + 1].bond ?? 1));
        d.pet.touches++;
        d.pet.bond += pts;
        this.progression.track('pet');
        sfx.woof();
        this.particles.burst('heart', at, 6, { speed: 1, up: 1.5, size: 0.35, life: 1.2 });
        this.fx.float(at, `+${pts} ♥`, 'love');
        const after = bondLevel(d.pet.bond);
        if (after > before) {
          const unlock: Record<number, string> = { 2: '學會翻肚打滾', 3: '戴上小草帽', 4: '技能升到 Lv2', 5: '每天會送你禮物', 6: '繫上紅領巾', 7: '技能升到 Lv3' };
          this.hud.toast(`💕 和${this.pet.name}的親密度升到 ${after} 級！${unlock[after] ? `（${unlock[after]}）` : ''}`, 3400);
        }
      } else {
        this.particles.burst('heart', at, 2, { speed: 0.6, up: 1, size: 0.3, life: 1 });
        this.hud.toast(`${this.pet.name}今天已經被摸夠囉（每天 3 次）`);
      }
      this.festival.tryEnvelope();
    }, () => this.finish());
  }

  // ---------- 場景物件 ----------
  private actProp(key: string) {
    const d = this.state.data;
    const msg: Record<string, string> = {
      doghouse: `${SPECIES[this.pet.species].emoji} ${this.pet.name}的小屋（親密度 ${bondLevel(d.pet.bond)}，${GROWTH[d.pet.stage].label}）`,
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
        if (this.grid.isBlocked(x, z) || this.grid.path[this.grid.idx(x, z)] || this.farm.indexAt(x, z) >= 0 || this.weeds.at(x, z) || this.debris.at(x, z)) continue;
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

  private collectTreasure(id: string, at: THREE.Vector3, byPet = false) {
    const tr = this.state.data.treasure;
    if (!tr.spots.find((s) => s.id === id)) return;
    tr.spots = tr.spots.filter((s) => s.id !== id);
    this.syncTreasureViews();
    sfx.sparkle();
    this.particles.burst('sparkle', at, 14, { speed: 2, up: 3, size: 0.4 });
    const r = Math.random();
    if (r < 0.1) {
      this.state.addItem('coin_old');
      this.progression.record('coin_old');
      this.hud.toast(byPet ? `🐶 ${this.pet.name}挖到了古錢幣！` : '⛏️ 挖到了古錢幣！');
    } else if (r < 0.3) {
      this.gainXp(40, at, false);
      this.hud.toast(byPet ? `🐶 ${this.pet.name}挖到了一包經驗種子！` : '⛏️ 挖到了一包經驗種子！');
    } else {
      const c = Math.round((30 + Math.floor(Math.random() * 50)) * (byPet && this.pet.species === 'corgi' ? 1.2 : 1));
      this.state.data.coins += c;
      sfx.coin();
      this.fx.float(at, `+${c} 🪙`, 'coin');
      this.hud.toast(byPet ? `🐶 ${this.pet.name}挖到了 ${c} 金幣！` : `⛏️ 挖到了 ${c} 金幣！`);
    }
  }

  // ---------- 經驗與升級 ----------
  gainXp(base: number, at: THREE.Vector3, useRested: boolean, kind: 'harvest' | 'weed' | 'other' = 'other'): void {
    const r = this.state.addXp(Math.round(base * this.calendar.xpMult(kind, this.state.now())), useRested);
    this.fx.float(at, `+${r.gained} XP${r.rested ? ' ✨' : ''}`, r.rested ? 'rested' : 'xp');
  }

  private onLevelUp(level: number) {
    sfx.levelUp();
    const unlocks: string[] = [];
    CROPS.filter((c) => c.unlock === level).forEach((c) => unlocks.push(`${c.emoji} ${c.name}${c.season !== 'all' ? `（${SEASON_LABEL[c.season]}）` : ''}`));
    const plots = plotsForLevel(level) - plotsForLevel(level - 1);
    if (plots > 0) unlocks.push(`🟫 可再買 ${plots} 塊田`);
    if (level === SICKLE_LEVEL) unlocks.push('🔪 小鐮刀');
    if (level === HOUSE_TIERS[2].level) unlocks.push('🏠 房屋修繕');
    if (level === RANCH_LEVEL) unlocks.push('🐄 牧場');
    if (level === 30) unlocks.push('📬 訂單 6 張');
    if (level === WORKSHOP_LEVEL) unlocks.push('🍞 加工坊');
    if (level === ORCHARD_LEVEL) unlocks.push('🌳 果園', '🏡 紅頂農舍');
    if (level === 40) unlocks.push('🍞 加工欄位 4 格', '🌱 溫室');
    if (level === 50) unlocks.push('🏡 雙層農莊');
    if (level === 55 || level === 70) unlocks.push('🌱 溫室擴建');
    if (level === 60) unlocks.push('⚙️ 風車零件配方');
    if (level === 75) unlocks.push('🤖 除草小機器人');
    if (level === 80) unlocks.push('🌬️ 風車莊園');
    for (const [id, t] of Object.entries(TOOLS)) t.tiers.forEach((tt, k) => { if (k > 0 && tt.level === level && tt.coins > 0) unlocks.push(`${TOOLS[id as keyof typeof TOOLS].emoji} ${tt.name}`); });
    this.progression.poke();
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
      if (['clover', 'coin_old', 'hay', 'wood', 'stone', 'fert', 'giantseed', 'windpart', 'token'].includes(k) || k.startsWith('pethat_')) continue; // 收藏品、飼料、建材、肥料、配件不賣
      const info = this.itemInfo(k) ?? ITEM_INFO[k];
      if (!info) continue;
      total += info.price * inv[k];
      n += inv[k];
      delete inv[k];
    }
    if (!n) { this.hud.toast('沒有可以賣的東西'); return; }
    this.state.data.coins += total;
    this.progression.track('sell', n);
    this.progression.track('coins', total);
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
    this.toolSlots = this.buildToolSlots();
    this.hud.setTools(this.toolSlots);
    this.hud.setPet(bondLevel(d.pet.bond), this.state.petTouchesLeft(now), SPECIES[this.pet.species].emoji);
    this.hud.setBagCount(Object.entries(d.inventory).reduce((s, [, v]) => s + v, 0));
    this.hud.setJournalBadge(this.progression.claimable);
    if (this.journal.open) this.journal.onRender?.();
    if (this.workshopPanel.open) this.workshopPanel.render(this.workshop.view(now));
    const icons: string[] = [];
    for (const t of [this.current, ...this.queue]) {
      if (!t) continue;
      if (t.kind === 'plot') {
        const st = this.farm.status(t.i, now);
        icons.push({ locked: '🔒', debris: '🪨', forsale: '🪙', grass: '⛏️', tilled: '🌱', dry: '💧', growing: '⏳', mature: '🧺', giantpart: '🌰' }[st]);
      } else if (t.kind === 'weed') {
        const w = this.weeds.get(t.id);
        icons.push(w ? WEED_ICON[w.kind] : '🌿');
      } else if (t.kind === 'pet') icons.push('🐶');
      else if (t.kind === 'cow') icons.push({ feed: '🌾', brush: '🪮', milk: '🥛' }[t.act]);
      else if (t.kind === 'debris') { const db = this.debris.get(t.id); icons.push(db && DEBRIS[db.kind].item === 'wood' ? '🪓' : '⛏️'); }
      else if (t.kind === 'compost') icons.push('🪣');
      else if (t.kind === 'treasure') icons.push('💎');
      else if (t.kind === 'mouse') icons.push('🐭');
    }
    this.hud.setQueue(icons);
    // 提示：新手引導中顯示引導文字；之後只在有田可買時提醒
    let hint = this.tutorialHint;
    if (!hint && this.tutorial && !this.tutorial.active && this.farm.buyable > 0 && d.coins >= this.farm.nextPrice() && d.plots.filter((p) => p.owned).length < 12)
      hint = '🟫 有新的田可以買了：點發光的價格牌（石頭樹樁要先清掉）';
    this.hud.hint(hint);
    if (this.hud.ordersOpen) this.hud.openOrders(this.orders.nextRefreshText(now), this.orders.cards());
  }

  // 工具列：有機肥＋當季已解鎖的種子＋下一個即將解鎖的種子
  private buildToolSlots(): ToolSlot[] {
    const d = this.state.data;
    const slots: ToolSlot[] = [];
    const fert = d.inventory.fert ?? 0;
    if (fert > 0 || d.compost.length) slots.push({ id: 'fert', emoji: '🧪', name: '有機肥', sub: `×${fert}`, selected: d.selectedTool === 'fert', lock: fert > 0 ? '' : '製作中' });
    const gs = d.inventory.giantseed ?? 0;
    if (gs > 0) slots.push({ id: 'giant', emoji: '🌰', name: '巨型種子', sub: `×${gs}`, selected: d.selectedTool === 'giant', lock: '' });
    const pp = this.player.root.position;
    const inGH = this.farm.inGreenhouse(pp.x, pp.z);
    const inSeason = CROPS.filter((c) => inGH ? !c.night : c.season === 'all' || c.season === this.season);
    const next = inSeason.filter((c) => c.unlock > d.level).sort((a, b) => a.unlock - b.unlock)[0];
    for (const c of inSeason) {
      if (c.unlock > d.level && c !== next) continue;
      slots.push({ id: c.id, emoji: c.emoji, name: c.name, sub: `🪙${c.seed}`, selected: d.selectedTool === 'seed' && d.selectedSeed === c.id, lock: c.unlock > d.level ? `Lv${c.unlock}` : '' });
    }
    return slots;
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
      if (this.debris.daily(now, (x, z) => !!this.weeds.at(x, z))) this.world.rebuildGrid();
      if (this.orders.refresh(now)) this.hud.toast('📬 郵筒來了新的訂單！', 2400);
      // 換季後選到的種子不能種了：換回蘿蔔（在溫室裡不用換）
      const sel = CROP_BY_ID[this.state.data.selectedSeed];
      const pp = this.player.root.position;
      if (sel && sel.season !== 'all' && sel.season !== this.season && !this.farm.inGreenhouse(pp.x, pp.z)) this.state.data.selectedSeed = 'radish';
      this.festival.tick(now);
      this.calendar.tick(now);
      this.weather = this.weatherOverride ?? weatherAt(now, this.season);
      this.checkGrowth(now);
      this.progression.refresh(now);
      this.pokeT -= 1;
      if (this.pokeT <= 0) { this.pokeT = 5; this.progression.poke(); }
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
    this.debris.update(dt);
    this.orchard.update(dt, now, this.season, this.world.leafColor);
    this.progression.update(dt);
    this.world.workshopBusy = this.workshop.busy;
    this.updateConstruction(dt, now);
    this.greenhouse.update(dt, now);
    this.tools.update(dt, now);
    this.interior.update(dt, this.stage.glow);
    this.festival.update(dt, this.stage.glow);
    this.social.update(dt, now, this.weather === 'rain' || this.weather === 'snow');
    this.music.night = night || hour >= 20;
    this.music.raining = this.weather === 'rain';
    this.music.indoor = this.interior.active;
    this.music.update(dt);
    this.world.setGrassPushers([this.player.root.position, this.pet.root.position, this.ranch.cow.root.position]);
    this.tutorialHint = this.tutorial.update(dt);
    {
      const d = this.state.data;
      this.bubbles.mail.set(this.onboarding ? null : !this.orders.d.seen || this.orders.deliverable ? (this.orders.deliverable ? '✅' : '❗') : null);
      this.bubbles.compost.set(d.compost.some((t) => t <= now) ? '🧪' : null);
      this.bubbles.house.set(d.house.buildUntil ? '🔨' : null);
      this.bubbles.workshop.set(this.workshop.anyReady ? '🍞' : null);
      for (const b of Object.values(this.bubbles)) b.update(this.elapsed);
      this.world.setMailFlag(!this.orders.d.seen || this.orders.deliverable);
    }
    this.mower.update(dt, this.driveInput);
    this.ranch.update(dt, now, night);
    this.placeMenu();
    this.player.update(dt);
    const dh = this.sceneLayout.doghouse;
    if (this.interior.active) {
      // 室內：寵物跟著主角，主角發呆一陣子（或晚上）就跑去牠最喜歡的家具上睡
      this.pet.update(dt, { player: this.player, night: night || this.player.idleTime > 6, doghouse: this.interior.petHome, treasures: [], followDist: 1.8 });
    } else if (!this.onboarding || this.state.data.onboard === 'done') {
      if (!this.social.visiting) this.petSkills.update(dt, now, night);
      this.pet.update(dt, { player: this.player, night: night && !this.social.visiting, doghouse: { x: dh.x, z: dh.z, rotY: dh.rotY }, treasures: this.pet.species === 'corgi' && !this.social.visiting ? this.state.data.treasure.spots : [], followDist: this.petTuning.followDist });
    }
    this.showcaseTick?.(dt);
    if (this.growT > 0) { this.growT -= dt; if (this.growT <= 0) this.stage.closeUp(null); }
    if (!this.mower.active && !this.onboarding && !this.interior.active && !this.social.visiting) this.runQueue();
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
      if (this.hud.menuOpen) this.hud.showMenu(this.hud.menuOpen, this.menuView(this.hud.menuOpen, now));
    }
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 10; this.state.save(); }
    this.autoQuality(dt);
    if (this.stage.checkResize()) { this.applyLayout(); if (this.interior.active) this.interior.aim(); }
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
