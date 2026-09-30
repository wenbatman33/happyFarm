import { clock, dayKey } from '../core/clock';
import { LEVEL_CAP, NEWBIE_LEVEL, NEWBIE_XP_MULT, RESTED_CAP, RESTED_PER_HOUR, dailyXp, xpNext } from '../data/economy';
import type { WeedKind } from '../world/weeds3d';
import { FIELD_COLS, FIELD_COUNT, GH_COUNT, STARTER_PLOTS, UNLOCK_ORDER } from './farm';
import { plotsForLevel } from '../data/economy';
import { SPECIES, type Species } from '../actors/pet';
import { DEFAULT_LOOK, type Look } from '../actors/player';
import { freshProg, type ProgSave } from './progress';
import { comfortStars } from '../data/furniture';

export const SAVE_KEY = 'happyFarm.save';
export const SCHEMA_VERSION = 1;

export interface PlotSave { owned: boolean; tilled: boolean; cropId: string | null; p0: number; snapAt: number; wetUntil: number; fert: boolean; boost?: boolean; giantOf?: number; stolen?: string }
export interface WorkSlot { recipe: string; doneAt: number }
export interface TreeSave { slot: number; id: string; plantedAt: number; pickedAt: number }
export interface WeedSave { id: string; tx: number; tz: number; ox: number; oz: number; kind: WeedKind; bornAt: number; pulls: number; zone: string; by?: string }
export interface TreasureSpot { id: string; x: number; z: number }
export interface PetSave {
  name: string; bond: number; touchDay: string; touches: number;
  species: Species; adoptedAt: number; stage: number;
  tokens: number; tokenAt: number; // 兔子吃草、小鴨潑水的次數（隨時間回復）
  giftDay: string; napAt: number;
}
export interface MouseSave { id: string; plot: number; bornAt: number }
export interface OrderSave { id: string; items: { key: string; n: number }[]; coins: number; xp: number; done: boolean }
export interface DebrisSave { id: string; x: number; z: number; kind: 'stone' | 'boulder' | 'stump' | 'log'; hits: number; rot: number }
export interface PlacedFurn { uid: string; id: string; x: number; z: number; rot: number }
export interface RoomSave { items: PlacedFurn[] }
export type ToolId = 'can' | 'hoe' | 'sickle' | 'pick' | 'axe' | 'robot';
export interface FestTask { id: string; key: string; n: number; got: number; claimed: boolean }
export interface SocialSave {
  hearts: number;
  friends: string[]; // 好友碼
  day: string; // 每日計數的日期
  steals: number;
  pranks: number;
  helps: number;
  perFriend: Record<string, { help: number; gift: boolean; stole: number[]; weeds: string[]; watered: number[]; pranks: [number, number][] }>;
  inboxAt: number;
  log: { at: number; text: string }[];
  npcDay: string; // 本機模擬鄰居對我做事的日期
}
export interface Settings { music: boolean; ambience: boolean; haptics: boolean; allowSteal: boolean; south: boolean; notify: boolean; quality: 'auto' | 'low' | 'medium' | 'high' }
export interface CowSave { name: string; affection: number; fedAt: number; milkReadyAt: number | null; brushDay: string; brushes: number; milked: number }

export interface SaveData {
  v: number;
  createdAt: number;
  maxSeen: number; // 看過的最大時間：時間只會往前，防止調回時鐘
  lastActive: number;
  level: number;
  xp: number;
  coins: number;
  rested: number; // 休息加成池
  inventory: Record<string, number>;
  plots: PlotSave[];
  weeds: WeedSave[];
  zones: Record<string, number>;
  weedSeq: number;
  pet: PetSave;
  look: Look | null; // null＝還沒捏人（新遊戲）
  onboard: 'look' | 'pet' | 'done';
  mice: MouseSave[];
  miceSeq: number;
  playerName: string;
  stats: { weedsPulled: number; harvests: number; bestCombo: number; ordersDone: number };
  selectedSeed: string;
  houseTier: number;
  treasure: { day: string; spots: TreasureSpot[] };
  cows: CowSave[];
  hayProgress: number;
  debris: DebrisSave[];
  debrisDay: string;
  debrisSeq: number;
  compost: number[]; // 每批完成的時間
  selectedTool: 'seed' | 'fert' | 'giant';
  house: { tier: number; buildUntil: number | null };
  tutorial: number; // 新手引導進度（-1＝已完成）
  orders: { slot: string; list: OrderSave[]; skipAt: number; seq: number; seen: boolean };
  prog: ProgSave;
  workshop: WorkSlot[];
  trees: TreeSave[];
  // M3 第二批
  greenhouse: { level: number; buildUntil: number | null };
  tools: Record<ToolId, number>; // 各工具等級（0＝初始）
  robotAt: number; // 除草機器人上次工作時間
  rooms: RoomSave[];
  comfort: number; // 上次算出的家園舒適度（影響離線休息加成）
  furn: Record<string, number>; // 還沒擺出來的家具
  furnSeq: number;
  // M4
  festival: { key: string; tokens: number; envelopeDay: string; taskDay: string; tasks: FestTask[]; bought: string[] };
  stamps: { month: string; days: string[]; claimed: number[] };
  market: { week: string; sold: Record<string, number>; bought: string[] };
  story: number[]; // 讀過的章節
  catchupUntil: number; // 回流追趕加成（XP ×1.5）到期時間
  petHat: string; // 節慶寵物配件
  settings: Settings;
  // M5
  social: SocialSave;
}

// 新的乳牛：一開始奶是滿的、肚子餓（第一次見面就能擠奶、餵草）
export function freshCow(): CowSave {
  return { name: '花花', affection: 0, fedAt: 0, milkReadyAt: 0, brushDay: '', brushes: 0, milked: 0 };
}

export const freshSocial = (): SocialSave => ({ hearts: 0, friends: [], day: '', steals: 0, pranks: 0, helps: 0, perFriend: {}, inboxAt: 0, log: [], npcDay: '' });
export const DEFAULT_SETTINGS: Settings = { music: true, ambience: true, haptics: true, allowSteal: true, south: false, notify: false, quality: 'auto' };
// 新家：客廳先放奶奶留下的幾件家具
export const freshRooms = (): RoomSave[] => [{ items: [
  { uid: 'f1', id: 'wood_bed', x: -4, z: -3, rot: 0 },
  { uid: 'f2', id: 'wood_table', x: 0, z: -1, rot: 0 },
  { uid: 'f3', id: 'wood_chair', x: 0, z: 0, rot: 2 },
  { uid: 'f6', id: 'wood_chair', x: 1, z: 0, rot: 2 },
  { uid: 'f4', id: 'wall_photo', x: 0, z: -3, rot: 0 },
  { uid: 'f5', id: 'pet_bed', x: 3, z: 1, rot: 0 },
] }];

export const freshPet = (now: number, species: Species, name = SPECIES[species].name): PetSave =>
  ({ name, bond: 0, touchDay: '', touches: 0, species, adoptedAt: now, stage: 0, tokens: 3, tokenAt: now, giftDay: '', napAt: 0 });

const freshPlot = (now: number, owned: boolean): PlotSave => ({ owned, tilled: false, cropId: null, p0: 0, snapAt: now, wetUntil: 0, fert: false });

export function freshSave(now: number): SaveData {
  return {
    v: SCHEMA_VERSION,
    createdAt: now,
    maxSeen: now,
    lastActive: now,
    level: 1,
    xp: 0,
    coins: 120,
    rested: 0,
    inventory: { hay: 5 },
    plots: Array.from({ length: FIELD_COUNT + GH_COUNT }, (_, i) => freshPlot(now, i < FIELD_COUNT && UNLOCK_ORDER.indexOf(i) < STARTER_PLOTS)),
    weeds: [],
    zones: {},
    weedSeq: 0,
    pet: freshPet(now, 'corgi'),
    look: null,
    onboard: 'look',
    mice: [],
    miceSeq: 0,
    playerName: '',
    stats: { weedsPulled: 0, harvests: 0, bestCombo: 0, ordersDone: 0 },
    selectedSeed: 'radish',
    houseTier: 1,
    treasure: { day: '', spots: [] },
    cows: [freshCow()],
    hayProgress: 0,
    debris: [],
    debrisDay: '',
    debrisSeq: 0,
    compost: [],
    selectedTool: 'seed',
    house: { tier: 1, buildUntil: null },
    tutorial: 0,
    orders: { slot: '', list: [], skipAt: 0, seq: 0, seen: false },
    prog: freshProg(),
    workshop: [],
    trees: [],
    greenhouse: { level: 0, buildUntil: null },
    tools: { can: 0, hoe: 0, sickle: 0, pick: 0, axe: 0, robot: 0 },
    robotAt: 0,
    rooms: freshRooms(),
    comfort: 10,
    furn: {},
    furnSeq: 10,
    festival: { key: '', tokens: 0, envelopeDay: '', taskDay: '', tasks: [], bought: [] },
    stamps: { month: '', days: [], claimed: [] },
    market: { week: '', sold: {}, bought: [] },
    story: [],
    catchupUntil: 0,
    petHat: '',
    settings: { ...DEFAULT_SETTINGS },
    social: freshSocial(),
  };
}

// 存檔版本遷移：之後每次改格式都在這裡加一段，舊存檔不能壞
function migrate(d: SaveData): SaveData {
  if (!d.v) d.v = 1;
  // 牧場（2026-09-30 加入）：舊存檔補上乳牛與起始牧草
  if (!d.cows) { d.cows = [freshCow()]; d.inventory.hay = (d.inventory.hay ?? 0) + 5; }
  if (d.hayProgress === undefined) d.hayProgress = 0;
  // M1（2026-09-30）：田區 4×3 → 6×5，舊田的內容搬到新座標；已解鎖的田視為已擁有
  if (d.plots.length === 12) {
    const old = d.plots as unknown as Omit<PlotSave, 'owned' | 'fert'>[];
    const oldOrder = [0, 1, 2, 4, 5, 6, 8, 9, 10, 3, 7, 11];
    const cap = plotsForLevel(d.level);
    const now = d.maxSeen;
    const plots = Array.from({ length: FIELD_COUNT + GH_COUNT }, () => freshPlot(now, false));
    old.forEach((p, i) => {
      const ni = Math.floor(i / 4) * FIELD_COLS + (i % 4);
      plots[ni] = { ...p, owned: oldOrder.indexOf(i) < Math.min(cap, 12), fert: false };
    });
    d.plots = plots;
  }
  if (!d.debris) { d.debris = []; d.debrisDay = ''; d.debrisSeq = 0; }
  if (!d.compost) d.compost = [];
  if (!d.selectedTool) d.selectedTool = 'seed';
  if (!d.house) d.house = { tier: d.houseTier ?? 1, buildUntil: null };
  if (d.tutorial === undefined) d.tutorial = -1; // 舊玩家不再跑新手引導
  if (!d.orders) d.orders = { slot: '', list: [], skipAt: 0, seq: 0, seen: false };
  if (d.stats.ordersDone === undefined) d.stats.ordersDone = 0;
  // M2（2026-09-30）：寵物物種與成長、主角外觀；舊玩家沿用柯基、預設外觀、略過開場
  if (!d.pet.species) Object.assign(d.pet, { species: 'corgi', adoptedAt: d.createdAt, stage: 0, tokens: 3, tokenAt: d.maxSeen, giftDay: '', napAt: 0 });
  if (d.look === undefined) { d.look = { ...DEFAULT_LOOK }; d.onboard = 'done'; }
  if (!d.mice) { d.mice = []; d.miceSeq = 0; }
  if (d.playerName === undefined) d.playerName = '';
  // M3（2026-09-30）：任務、手帳、圖鑑、成就、加工坊、果樹
  if (!d.prog) d.prog = freshProg();
  if (!d.workshop) d.workshop = [];
  if (!d.trees) d.trees = [];
  // M3 第二批／M4／M5（2026-10-01）：溫室田（田區後面接 18 格）、工具、室內、節慶、印章、市集、社交
  while (d.plots.length < FIELD_COUNT + GH_COUNT) d.plots.push(freshPlot(d.maxSeen, false));
  if (!d.greenhouse) d.greenhouse = { level: 0, buildUntil: null };
  if (!d.tools) d.tools = { can: 0, hoe: 0, sickle: 0, pick: 0, axe: 0, robot: 0 };
  if (d.robotAt === undefined) d.robotAt = 0;
  if (!d.rooms) { d.rooms = freshRooms(); d.furnSeq = 10; }
  if (!d.furn) d.furn = {};
  if (d.comfort === undefined) d.comfort = 10;
  if (!d.festival) d.festival = { key: '', tokens: 0, envelopeDay: '', taskDay: '', tasks: [], bought: [] };
  if (!d.stamps) d.stamps = { month: '', days: [], claimed: [] };
  if (!d.market) d.market = { week: '', sold: {}, bought: [] };
  if (!d.story) d.story = [];
  if (d.catchupUntil === undefined) d.catchupUntil = 0;
  if (d.petHat === undefined) d.petHat = '';
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) };
  if (!d.social) d.social = freshSocial();
  return d;
}

export class GameState {
  data: SaveData;
  isNew = false;
  rewound = false;
  offlineHours = 0;
  frozen = false; // 讀取別的存檔、重新開始時：不要再把目前的狀態寫回去
  onLevelUp?: (level: number) => void;

  constructor() {
    let d: SaveData | null = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) d = migrate(JSON.parse(raw));
    } catch { d = null; }
    if (!d) { d = freshSave(clock.now()); this.isNew = true; }
    this.data = d;
    const real = clock.now();
    if (real < d.maxSeen - 5 * 60 * 1000) this.rewound = true;
    // 休息加成：離線每小時累積
    const hours = Math.max(0, (this.now() - d.lastActive) / 3600000);
    this.offlineHours = hours;
    const cap = dailyXp(d.level) * RESTED_CAP;
    // 家園舒適度每一顆星，休息加成多累積 10%
    const stars = comfortStars(d.comfort ?? 10);
    d.rested = Math.min(cap, d.rested + hours * RESTED_PER_HOUR * dailyXp(d.level) * (1 + 0.1 * stars));
    // 請求持久化儲存（降低 Safari 清除存檔的風險）
    void navigator.storage?.persist?.();
  }

  // 模擬用的「現在」：時間只會往前
  now(): number {
    const n = clock.now();
    if (n > this.data.maxSeen) this.data.maxSeen = n;
    return this.data.maxSeen;
  }

  save(): void {
    if (this.frozen) return;
    this.data.lastActive = this.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch { /* 容量滿或無痕模式 */ }
  }

  reset(): void {
    localStorage.removeItem(SAVE_KEY);
    this.data = freshSave(clock.now());
    this.isNew = true;
  }

  // 回傳實際獲得的 XP（含休息加成、新手加成）
  addXp(base: number, useRested = false): { gained: number; rested: boolean } {
    const d = this.data;
    let gained = base;
    let rested = false;
    if (useRested && d.rested > 0) {
      const bonus = Math.floor(Math.min(base, d.rested));
      d.rested -= bonus;
      gained += bonus;
      rested = bonus > 0;
    }
    if (d.level < NEWBIE_LEVEL) gained *= NEWBIE_XP_MULT;
    gained = Math.round(gained);
    d.xp += gained;
    while (d.level < LEVEL_CAP && d.xp >= xpNext(d.level)) {
      d.xp -= xpNext(d.level);
      d.level++;
      this.onLevelUp?.(d.level);
    }
    return { gained, rested };
  }

  addItem(key: string, n = 1): void {
    this.data.inventory[key] = (this.data.inventory[key] ?? 0) + n;
    if (this.data.inventory[key] <= 0) delete this.data.inventory[key];
  }

  petTouchesLeft(now: number): number {
    const p = this.data.pet;
    if (p.touchDay !== dayKey(now)) { p.touchDay = dayKey(now); p.touches = 0; }
    return 3 - p.touches;
  }
}
