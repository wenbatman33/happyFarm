// 數值公式：唯一來源是 docs/06-成長曲線與經濟.md

// 升到下一級所需 XP
export const xpNext = (level: number): number => Math.ceil(300 + 42 * Math.pow(level, 1.72));

// 一般玩家每日 XP（休息加成的計算基準）
export const dailyXp = (level: number): number => 2400 * (1 + 0.055 * level);

// 作物：t = 成長時間（分鐘）
export const seedPrice = (t: number): number => Math.round(2 + 2 * Math.pow(t, 0.55));
export const sellPrice = (t: number): number => seedPrice(t) + Math.round(4 + 3 * Math.pow(t, 0.55));
export const cropXp = (t: number): number => Math.round(2 + 3 * Math.sqrt(t));

// 新手加成：Lv6 之前 XP ×5，確保第一次上線 15 分鐘內能升到 Lv5–6
export const NEWBIE_LEVEL = 6;
export const NEWBIE_XP_MULT = 5;

// 地塊上限
const PLOT_TABLE: [number, number][] = [[1, 6], [3, 9], [6, 12], [10, 16], [15, 20], [20, 25], [30, 30], [40, 36], [50, 42], [65, 48], [80, 54], [95, 60]];
export const plotsForLevel = (level: number): number => {
  let n = 6;
  for (const [lv, count] of PLOT_TABLE) if (level >= lv) n = count;
  return n;
};
// 第 n 塊地的價格（06 §6.1）
export const plotPrice = (n: number): number => Math.round((150 * Math.pow(1.085, n - 6)) / 10) * 10;

// 荒地障礙物：清除需要的次數與產出
export type DebrisKind = 'stone' | 'boulder' | 'stump' | 'log';
export const DEBRIS: Record<DebrisKind, { hits: number; item: 'stone' | 'wood'; n: number; tool: 'pick' | 'axe'; name: string; xp: number }> = {
  stone: { hits: 1, item: 'stone', n: 1, tool: 'pick', name: '小石頭', xp: 5 },
  boulder: { hits: 3, item: 'stone', n: 4, tool: 'pick', name: '大石頭', xp: 12 },
  stump: { hits: 3, item: 'wood', n: 4, tool: 'axe', name: '樹樁', xp: 10 },
  log: { hits: 4, item: 'wood', n: 6, tool: 'axe', name: '倒木', xp: 14 },
};
export const DEBRIS_WILD_CAP = 12; // 田地以外的荒地障礙物上限
export const DEBRIS_DAILY = 2; // 每天重生幾個

// 堆肥：雜草 10 → 有機肥 1，發酵 2 小時，最多同時 3 批
export const COMPOST_WEEDS = 10;
export const COMPOST_MS = 2 * 3600000;
export const COMPOST_SLOTS = 3;

// 房屋修繕 T2（03 §2）
export const HOUSE_T2 = { level: 8, coins: 3000, wood: 20, ms: 3600000 };

export const nextPlotUnlockLevel = (level: number): number | null => {
  for (const [lv] of PLOT_TABLE) if (lv > level) return lv;
  return null;
};

// 品質
export type Quality = 'normal' | 'good' | 'gold';
export const QUALITY_MULT: Record<Quality, number> = { normal: 1, good: 1.25, gold: 1.6 };
export const QUALITY_LABEL: Record<Quality, string> = { normal: '', good: '優良', gold: '金星' };

export function rollQuality(rand: number, noWeeds: boolean, fert = false): Quality {
  // 基礎 85/12/3；田上沒雜草 80/17/3；施有機肥 58/32/10（見 06 §5）
  const gold = fert ? 0.1 : 0.03;
  const good = fert ? 0.32 : noWeeds ? 0.17 : 0.12;
  if (rand < gold) return 'gold';
  if (rand < gold + good) return 'good';
  return 'normal';
}

// 除草
export const WEED_SPAWN_MS = 90 * 60 * 1000;
export const WEED_XP = { sprout: 3, bush: 5, big: 8, dandelion: 4, leaves: 4, snow: 4 } as const;
export const COMBO_WINDOW_MS = 1600;

// 手推除草機：正式版 Lv45 解鎖；M0 試玩先開放
export const MOWER_LEVEL = 45;
export const MOWER_DEMO = true;
// 割草收集牧草：每割 40 叢得 1 捆
export const HAY_PER_TUFTS = 40;

// 牧場：乳牛（原規劃第二年，提前到第一年；正式 Lv12 解鎖，M0 試玩先開放）
export const RANCH_LEVEL = 12;
export const RANCH_DEMO = true;
export const MILK_REGEN_MS = 4 * 3600000; // 餵過牧草後 4 小時產奶
export const COW_HUNGRY_MS = 6 * 3600000; // 餵食後 6 小時會再餓
export const COW_BRUSH_DAILY = 3;
export const MILK_SELL = sellPrice(240); // 價值比照 4 小時作物
export const MILK_XP = cropXp(240);
export const COW_BOND_THRESHOLDS = [0, 60, 200, 450, 800, 1300];
export const cowHearts = (p: number): number => COW_BOND_THRESHOLDS.filter((t) => p >= t).length - 1;

// 休息加成：離線每小時累積 DailyXP × 5%，上限 150%
export const RESTED_PER_HOUR = 0.05;
export const RESTED_CAP = 1.5;

// 寵物親密度
export const BOND_THRESHOLDS = [0, 100, 400, 1000, 2000, 3500, 5500, 8000, 10800, 13500];
export const bondLevel = (points: number): number => {
  let lv = 1;
  BOND_THRESHOLDS.forEach((t, i) => { if (points >= t) lv = i + 1; });
  return lv;
};
export const PET_TOUCH_POINTS = 10;
export const PET_TOUCH_DAILY = 3;
