// 數值公式：唯一來源是 docs/06-成長曲線與經濟.md

// 等級上限（docs/06：1–100 級）
export const LEVEL_CAP = 100;

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
// 各階段升級條件（升到該階段）
// crafted：任意加工品的數量；parts：風車零件（加工坊製作）
export const HOUSE_TIERS: Record<number, { level: number; coins: number; wood: number; stone: number; ms: number; name: string; crafted?: number; parts?: number }> = {
  2: { level: 8, coins: 3000, wood: 20, stone: 0, ms: 3600000, name: '修繕小木屋' },
  3: { level: 25, coins: 40000, wood: 80, stone: 40, ms: 8 * 3600000, name: '紅頂農舍' },
  4: { level: 50, coins: 150000, wood: 200, stone: 150, ms: 24 * 3600000, name: '雙層農莊', crafted: 30 },
  5: { level: 80, coins: 400000, wood: 400, stone: 300, ms: 72 * 3600000, name: '風車莊園', parts: 5 },
};

// 溫室（docs/03 §1）：任何季節都能種任何作物，成長時間 ×1.5；分三期擴建
export const GREENHOUSE_GROWTH = 1.5;
export const GREENHOUSE: { level: number; coins: number; wood: number; stone: number; ms: number; plots: number }[] = [
  { level: 40, coins: 30000, wood: 40, stone: 40, ms: 2 * 3600000, plots: 6 },
  { level: 55, coins: 90000, wood: 80, stone: 60, ms: 6 * 3600000, plots: 12 },
  { level: 70, coins: 200000, wood: 120, stone: 120, ms: 12 * 3600000, plots: 18 },
];

// 工具升級（docs/03 §4.4、§5）：木匠老木的工具箱
export interface ToolTier { name: string; level: number; coins: number; wood?: number; stone?: number; desc: string }
export const TOOLS: Record<'can' | 'hoe' | 'sickle' | 'shears' | 'pick' | 'axe' | 'robot', { name: string; emoji: string; tiers: ToolTier[] }> = {
  can: { name: '澆水壺', emoji: '🚿', tiers: [
    { name: '木水壺', level: 1, coins: 0, desc: '一次澆 1 塊田' },
    { name: '銅水壺', level: 12, coins: 2000, stone: 10, desc: '一次澆一排 3 塊' },
    { name: '金水壺', level: 30, coins: 20000, stone: 40, desc: '一次澆 3×3 共 9 塊' },
  ] },
  hoe: { name: '鋤頭', emoji: '⛏️', tiers: [
    { name: '舊鋤頭', level: 1, coins: 0, desc: '一次翻 1 塊田' },
    { name: '銅鋤頭', level: 10, coins: 1500, wood: 10, desc: '一次翻一排 3 塊' },
    { name: '金鋤頭', level: 28, coins: 15000, wood: 30, stone: 20, desc: '一次翻 3×3 共 9 塊' },
  ] },
  sickle: { name: '鐮刀', emoji: '🔪', tiers: [
    { name: '徒手', level: 1, coins: 0, desc: '一次拔 1 株' },
    { name: '小鐮刀', level: 6, coins: 0, desc: '前方扇形 1.3 m，一次 3 株（Lv6 自動拿到）' },
    { name: '大鐮刀', level: 20, coins: 5000, wood: 15, desc: '前方扇形 2 m，一次 6 株，連大草叢都一刀' },
  ] },
  shears: { name: '修枝剪', emoji: '✂️', tiers: [
    { name: '還沒有', level: 1, coins: 0, desc: '' },
    { name: '修枝剪', level: 10, coins: 800, desc: '可以剪掉房子牆上的藤蔓（藤條能做花圈）' },
  ] },
  pick: { name: '鎬', emoji: '⛏️', tiers: [
    { name: '鐵鎬', level: 1, coins: 0, desc: '大石頭要敲 3 下' },
    { name: '鋼鎬', level: 15, coins: 3000, wood: 10, desc: '每下威力 ×2' },
    { name: '金鎬', level: 35, coins: 25000, wood: 20, desc: '什麼石頭都一下碎' },
  ] },
  axe: { name: '斧頭', emoji: '🪓', tiers: [
    { name: '鐵斧', level: 1, coins: 0, desc: '樹樁要砍 3 下' },
    { name: '鋼斧', level: 15, coins: 3000, stone: 10, desc: '每下威力 ×2' },
    { name: '金斧', level: 35, coins: 25000, stone: 20, desc: '什麼木頭都一下斷' },
  ] },
  robot: { name: '除草小機器人', emoji: '🤖', tiers: [
    { name: '還沒有', level: 1, coins: 0, desc: '' },
    { name: '除草小機器人', level: 75, coins: 80000, stone: 60, desc: '每小時自動清 5 株普通雜草（稀有草和季節雜草留給你親手拔）' },
  ] },
};
export const ROBOT_PER_HOUR = 5;

// 月份主題（docs/05 §4.3）
export const MONTH_THEME: Record<number, { name: string; desc: string; harvestXp?: number; craftTime?: number; weedXp?: number; orderCoins?: number; bond?: number }> = {
  1: { name: '新年新希望', desc: '訂單金幣 +10%', orderCoins: 1.1 },
  2: { name: '團圓月', desc: '摸寵物親密度 +50%', bond: 1.5 },
  3: { name: '播種月', desc: '收成 XP +10%', harvestXp: 1.1 },
  4: { name: '花漾月', desc: '拔草 XP +20%', weedXp: 1.2 },
  5: { name: '感恩月', desc: '訂單金幣 +10%', orderCoins: 1.1 },
  6: { name: '盛夏月', desc: '加工時間 −15%', craftTime: 0.85 },
  7: { name: '西瓜月', desc: '收成 XP +10%', harvestXp: 1.1 },
  8: { name: '星空月', desc: '摸寵物親密度 +50%', bond: 1.5 },
  9: { name: '月圓月', desc: '拔草 XP +20%', weedXp: 1.2 },
  10: { name: '豐收月', desc: '收成 XP +10%', harvestXp: 1.1 },
  11: { name: '市集月', desc: '訂單金幣 +10%', orderCoins: 1.1 },
  12: { name: '暖冬月', desc: '加工時間 −20%', craftTime: 0.8 },
};

// 月曆印章卡（docs/05 §4.1）：當月登入 10 天小獎、20 天換當月限定家具（不需要連續）
export const STAMP_SMALL = 10;
export const STAMP_BIG = 20;

// 回流保護（docs/05 §6）
export const CATCHUP_DAYS = 7;
export const CATCHUP_MULT = 1.5;

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
export const WEED_XP = { sprout: 3, bush: 5, big: 8, dandelion: 4, leaves: 4, snow: 4, vine: 10 } as const;
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

// ---------- M6：池塘、蜂箱、寵物小屋、咖啡廳、流星 ----------
// 池塘（docs/03 §1，Lv30）：挖好後有 6 個水生作物位置
export const POND = { level: 30, coins: 20000, stone: 40, ms: 3 * 3600000 };
// 寵物小屋升級（第 6 章）：升級後可以收養其他寵物（最多 4 隻）
export const PET_HOUSE_T2 = { coins: 20000, wood: 40 };
export const PET_ADOPT_COINS = 3000;
// 蜂箱（第 9 章）：每 6 小時產蜂蜜，田裡有成熟的花越多產量越多；冬天蜜蜂休息
export const HIVE = { coins: 5000, wood: 20, ms: 6 * 3600000, base: 2, maxBonus: 3 };
export const HONEY_SELL = 140;
export const HONEY_XP = 35;
// 咖啡廳訂單（第 8 章）：每天一張，組合加工品，價格 ×2.2
export const CAFE_MULT = 2.2;
// 流星（第 10 章）：晚上 20:00–04:00，間隔 90–240 秒；夜間花成長 ×1.25
export const NIGHT_FLOWER_BOOST = 1.25;
