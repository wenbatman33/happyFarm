import { clock, dayKey } from '../core/clock';
import { NEWBIE_LEVEL, NEWBIE_XP_MULT, RESTED_CAP, RESTED_PER_HOUR, dailyXp, xpNext } from '../data/economy';
import type { WeedKind } from '../world/weeds3d';

export const SAVE_KEY = 'happyFarm.save';
export const SCHEMA_VERSION = 1;

export interface PlotSave { tilled: boolean; cropId: string | null; p0: number; snapAt: number; wetUntil: number }
export interface WeedSave { id: string; tx: number; tz: number; ox: number; oz: number; kind: WeedKind; bornAt: number; pulls: number; zone: string }
export interface TreasureSpot { id: string; x: number; z: number }
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
  pet: { name: string; bond: number; touchDay: string; touches: number };
  stats: { weedsPulled: number; harvests: number; bestCombo: number };
  selectedSeed: string;
  houseTier: number;
  treasure: { day: string; spots: TreasureSpot[] };
  cows: CowSave[];
  hayProgress: number;
}

// 新的乳牛：一開始奶是滿的、肚子餓（第一次見面就能擠奶、餵草）
export function freshCow(): CowSave {
  return { name: '花花', affection: 0, fedAt: 0, milkReadyAt: 0, brushDay: '', brushes: 0, milked: 0 };
}

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
    plots: Array.from({ length: 12 }, () => ({ tilled: false, cropId: null, p0: 0, snapAt: now, wetUntil: 0 })),
    weeds: [],
    zones: {},
    weedSeq: 0,
    pet: { name: '麻糬', bond: 0, touchDay: '', touches: 0 },
    stats: { weedsPulled: 0, harvests: 0, bestCombo: 0 },
    selectedSeed: 'radish',
    houseTier: 1,
    treasure: { day: '', spots: [] },
    cows: [freshCow()],
    hayProgress: 0,
  };
}

// 存檔版本遷移：之後每次改格式都在這裡加一段，舊存檔不能壞
function migrate(d: SaveData): SaveData {
  if (!d.v) d.v = 1;
  // 牧場（2026-09-30 加入）：舊存檔補上乳牛與起始牧草
  if (!d.cows) { d.cows = [freshCow()]; d.inventory.hay = (d.inventory.hay ?? 0) + 5; }
  if (d.hayProgress === undefined) d.hayProgress = 0;
  return d;
}

export class GameState {
  data: SaveData;
  isNew = false;
  rewound = false;
  offlineHours = 0;
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
    d.rested = Math.min(cap, d.rested + hours * RESTED_PER_HOUR * dailyXp(d.level));
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
    while (d.xp >= xpNext(d.level)) {
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
