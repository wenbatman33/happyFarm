import { dayKey, type Season } from '../core/clock';
import { hashStr, mulberry32 } from '../core/rng';
import { bondLevel } from '../data/economy';
import type { SaveData } from './state';

// 長線進度（docs/05）：每日任務、每週挑戰、季節手帳、成就、圖鑑
export type Ev = 'weed' | 'harvest' | 'plant' | 'water' | 'order' | 'pet' | 'cow' | 'milk' | 'debris' | 'compost' | 'sell' | 'coins' | 'gold' | 'craft' | 'fruit';

export interface TaskDef { id: string; ev: Ev; n: number; label: string; need?: (d: SaveData) => boolean }
export interface TaskState { id: string; got: number; claimed: boolean }

export const DAILY_POOL: TaskDef[] = [
  { id: 'd_weed', ev: 'weed', n: 15, label: '拔掉 15 株雜草' },
  { id: 'd_harvest', ev: 'harvest', n: 20, label: '收成 20 次' },
  { id: 'd_plant', ev: 'plant', n: 12, label: '播種 12 次' },
  { id: 'd_water', ev: 'water', n: 10, label: '澆水 10 次' },
  { id: 'd_order', ev: 'order', n: 1, label: '交出 1 張訂單' },
  { id: 'd_pet', ev: 'pet', n: 3, label: '摸摸寵物 3 次' },
  { id: 'd_cow', ev: 'cow', n: 2, label: '照顧花花 2 次' },
  { id: 'd_debris', ev: 'debris', n: 2, label: '清掉 2 個石頭或樹樁', need: (d) => d.debris.length > 0 },
  { id: 'd_sell', ev: 'sell', n: 20, label: '賣出 20 個東西' },
  { id: 'd_craft', ev: 'craft', n: 2, label: '在加工坊做 2 樣東西', need: (d) => d.level >= 15 },
];

export const WEEKLY_POOL: TaskDef[] = [
  { id: 'w_weed', ev: 'weed', n: 100, label: '拔掉 100 株雜草' },
  { id: 'w_harvest', ev: 'harvest', n: 150, label: '收成 150 次' },
  { id: 'w_order', ev: 'order', n: 10, label: '交出 10 張訂單' },
  { id: 'w_milk', ev: 'milk', n: 5, label: '擠 5 次牛奶' },
  { id: 'w_debris', ev: 'debris', n: 8, label: '清掉 8 個障礙物' },
  { id: 'w_compost', ev: 'compost', n: 3, label: '做出 3 包有機肥' },
  { id: 'w_coins', ev: 'coins', n: 3000, label: '賺進 3,000 金幣' },
  { id: 'w_pet', ev: 'pet', n: 15, label: '摸摸寵物 15 次' },
  { id: 'w_gold', ev: 'gold', n: 5, label: '收成 5 個金星作物' },
  { id: 'w_craft', ev: 'craft', n: 10, label: '在加工坊做 10 樣東西', need: (d) => d.level >= 15 },
];

export const DAILY_STARS = 10;
export const DAILY_ALL_BONUS = 10;
export const WEEKLY_STARS = 30;
export const TIER_STARS = 100;
export const TIERS = 30;

// 季節手帳 30 階獎勵；10／20／30 階是季節限定
export type Reward = { coins?: number; item?: string; n?: number; decor?: string; label: string; emoji: string };
export const SEASON_DECOR: Record<Season, { t10: string; t30: string; n10: string; n30: string }> = {
  spring: { t10: 'scarecrow', t30: 'wreath', n10: '春日稻草人', n30: '櫻花門環' },
  summer: { t10: 'scarecrow', t30: 'wreath', n10: '草帽稻草人', n30: '向日葵門環' },
  autumn: { t10: 'scarecrow', t30: 'wreath', n10: '豐收稻草人', n30: '楓葉門環' },
  winter: { t10: 'scarecrow', t30: 'wreath', n10: '雪人稻草人', n30: '聖誕門環' },
};
export function tierReward(i: number, season: Season): Reward {
  const sd = SEASON_DECOR[season];
  if (i === 10) return { decor: `${sd.t10}_${season}`, label: sd.n10, emoji: '🧑‍🌾' };
  if (i === 20) return { item: 'giantseed', n: 1, label: '巨型種子', emoji: '🎃' };
  if (i === 30) return { decor: `${sd.t30}_${season}`, label: sd.n30, emoji: '💐' };
  if (i % 5 === 0) return { coins: 300 * (i / 5), label: `${300 * (i / 5)} 金幣`, emoji: '🪙' };
  const cycle: Reward[] = [
    { item: 'fert', n: 2, label: '有機肥 ×2', emoji: '🧪' },
    { item: 'hay', n: 4, label: '牧草 ×4', emoji: '🌾' },
    { coins: 150, label: '150 金幣', emoji: '🪙' },
    { item: 'wood', n: 6, label: '木材 ×6', emoji: '🪵' },
    { item: 'stone', n: 6, label: '石材 ×6', emoji: '🪨' },
  ];
  if (i === 13 || i === 27) return { item: 'clover', n: 1, label: '四葉草', emoji: '🍀' };
  return cycle[i % cycle.length];
}

// 成就
export interface AchDef { id: string; name: string; desc: string; coins: number; check: (d: SaveData) => number; n: number }
const life = (ev: Ev) => (d: SaveData) => d.prog.life[ev] ?? 0;
const ach = (id: string, name: string, desc: string, n: number, coins: number, check: (d: SaveData) => number): AchDef => ({ id, name, desc, n, coins, check });
export const ACHIEVEMENTS: AchDef[] = [
  ach('weed1', '除草新手', '拔掉 10 株雜草', 10, 100, life('weed')),
  ach('weed2', '除草達人', '拔掉 100 株雜草', 100, 500, life('weed')),
  ach('weed3', '除草大師', '拔掉 1,000 株雜草', 1000, 3000, life('weed')),
  ach('harv1', '第一次收成', '收成 1 次', 1, 50, life('harvest')),
  ach('harv2', '勤勞的農夫', '收成 100 次', 100, 500, life('harvest')),
  ach('harv3', '豐收之王', '收成 1,000 次', 1000, 3000, life('harvest')),
  ach('ord1', '第一張訂單', '交出 1 張訂單', 1, 100, life('order')),
  ach('ord2', '可靠的供應商', '交出 20 張訂單', 20, 800, life('order')),
  ach('ord3', '小鎮的好朋友', '交出 100 張訂單', 100, 4000, life('order')),
  ach('milk1', '第一杯牛奶', '擠 1 次牛奶', 1, 100, life('milk')),
  ach('milk2', '牧場主人', '擠 30 次牛奶', 30, 1500, life('milk')),
  ach('deb1', '開墾者', '清掉 10 個障礙物', 10, 300, life('debris')),
  ach('deb2', '拓荒英雄', '清掉 60 個障礙物', 60, 1500, life('debris')),
  ach('comp1', '循環農法', '做出 3 包有機肥', 3, 300, life('compost')),
  ach('gold1', '閃閃發亮', '收成 1 個金星作物', 1, 100, life('gold')),
  ach('gold2', '品質保證', '收成 30 個金星作物', 30, 1500, life('gold')),
  ach('coin1', '小有積蓄', '累計賺進 10,000 金幣', 10000, 500, life('coins')),
  ach('coin2', '農場富翁', '累計賺進 100,000 金幣', 100000, 5000, life('coins')),
  ach('pet1', '好朋友', '摸寵物 30 次', 30, 300, life('pet')),
  ach('craft1', '手作職人', '在加工坊做 20 樣東西', 20, 1000, life('craft')),
  ach('fruit1', '果園園丁', '採收 20 次水果', 20, 1500, life('fruit')),
  ach('combo1', '連擊高手', '除草連擊 10 次', 10, 300, (d) => d.stats.bestCombo),
  ach('combo2', '除草旋風', '除草連擊 30 次', 30, 1000, (d) => d.stats.bestCombo),
  ach('lv10', '農場起步', '升到 Lv10', 10, 500, (d) => d.level),
  ach('lv25', '有模有樣', '升到 Lv25', 25, 2000, (d) => d.level),
  ach('lv50', '資深農夫', '升到 Lv50', 50, 8000, (d) => d.level),
  ach('bond5', '心靈相通', '寵物親密度 5 級', 5, 800, (d) => bondLevel(d.pet.bond)),
  ach('bond10', '一生的夥伴', '寵物親密度 10 級', 10, 5000, (d) => bondLevel(d.pet.bond)),
  ach('plot20', '田連阡陌', '擁有 20 塊田', 20, 1000, (d) => d.plots.filter((p) => p.owned).length),
  ach('house2', '溫暖的家', '修繕房屋', 2, 500, (d) => d.house.tier),
  ach('alm10', '收藏家', '圖鑑收集 10 項', 10, 500, (d) => Object.keys(d.prog.almanac).length),
  ach('alm25', '博物學家', '圖鑑收集 25 項', 25, 2500, (d) => Object.keys(d.prog.almanac).length),
];

export interface ProgSave {
  day: string; daily: TaskState[]; dailyBonus: boolean;
  week: string; weekly: TaskState[];
  season: string; stars: number; tiers: number[];
  life: Partial<Record<Ev, number>>;
  ach: string[];
  almanac: Record<string, { n: number; q: number }>; // q：1 普通、2 優良、4 金星
  decor: string[];
  title: string;
}

export const freshProg = (): ProgSave => ({ day: '', daily: [], dailyBonus: false, week: '', weekly: [], season: '', stars: 0, tiers: [], life: {}, ach: [], almanac: {}, decor: [], title: '' });

// 週一開始的週次
export function weekKey(t: number): string {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${mon.getFullYear()}-${mon.getMonth() + 1}-${mon.getDate()}`;
}

// 季節手帳的季度鍵（冬季跨年：12 月與隔年 1、2 月算同一季）
export function seasonKey(t: number, s: Season): string {
  const d = new Date(t);
  const y = s === 'winter' && d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
  return `${y}-${s}`;
}

export function pickTasks(pool: TaskDef[], n: number, seed: string, d: SaveData): TaskState[] {
  const rand = mulberry32(hashStr(seed));
  return pool.filter((t) => !t.need || t.need(d)).sort(() => rand() - 0.5).slice(0, n).map((t) => ({ id: t.id, got: 0, claimed: false }));
}

export const taskDef = (id: string): TaskDef | undefined => DAILY_POOL.find((t) => t.id === id) ?? WEEKLY_POOL.find((t) => t.id === id);
export { dayKey };
