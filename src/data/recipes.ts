import { CROP_BY_ID } from './crops';
import { MILK_SELL, MILK_XP } from './economy';

// 加工坊（docs/06 §7.2）：成品售價 = 原料售價總和 × 1.8，XP = 原料 XP × 0.5，時間 = 原料最長成長時間 × 0.5（最多 4 小時）
export interface Recipe { id: string; name: string; emoji: string; inputs: { key: string; n: number }[]; unlock: number; minutes: number; sell: number; xp: number }

const RAW: [string, string, string, [string, number][], number][] = [
  ['flour', '麵粉', '🥣', [['wheat', 3]], 15],
  ['fries', '薯條', '🍟', [['potato', 3]], 15],
  ['jam', '草莓果醬', '🫙', [['strawberry', 4]], 15],
  ['soba', '蕎麥麵', '🍜', [['buckwheat', 2], ['flour', 1]], 16],
  ['butter', '奶油', '🧈', [['milk', 2]], 16],
  ['roastpotato', '烤地瓜', '🍠', [['sweetpotato', 2]], 17],
  ['salad', '蔬菜沙拉', '🥗', [['napa', 1], ['carrot', 2]], 18],
  ['soup', '香菇湯', '🍲', [['shiitake', 2], ['onion', 1]], 19],
  ['bread', '麵包', '🍞', [['flour', 2], ['sugarcane', 1]], 20],
  ['cheese', '起司', '🧀', [['milk', 3]], 22],
  // M4：春夏作物與節慶的配方
  ['ketchup', '番茄醬', '🥫', [['tomato', 4]], 16],
  ['pickles', '醃黃瓜', '🥒', [['cucumber', 4]], 17],
  ['mooncake', '月餅', '🥮', [['sweetpotato', 2], ['flour', 1]], 18],
  ['popcorn', '爆米花', '🍿', [['corn', 3]], 18],
  ['teacan', '春茶罐', '🍵', [['tea', 3]], 22],
  ['blueberryjam', '藍莓果醬', '🫙', [['blueberry', 4]], 22],
  ['pumpkinpie', '南瓜派', '🥧', [['pumpkin', 1], ['flour', 2]], 26],
  ['lavendersoap', '薰衣草皂', '🧼', [['lavender', 2], ['butter', 1]], 35],
  ['tangyuan', '湯圓', '🍡', [['rice', 2], ['sugarcane', 1]], 36],
  // 房屋 T5 要用的風車零件（木材＋石材）
  ['windpart', '風車零件', '⚙️', [['wood', 10], ['stone', 10]], 60],
];

export const RECIPES: Recipe[] = [];
export const RECIPE_BY_ID: Record<string, Recipe> = {};

// 原料的價值與時間（作物、牛奶、或其他加工品）
function base(key: string): { sell: number; xp: number; minutes: number } {
  const c = CROP_BY_ID[key];
  if (c) return { sell: c.sell, xp: c.xp, minutes: c.minutes };
  if (key === 'milk') return { sell: MILK_SELL, xp: MILK_XP, minutes: 240 };
  const r = RECIPE_BY_ID[key];
  return r ? { sell: r.sell, xp: r.xp, minutes: r.minutes } : { sell: 1, xp: 1, minutes: 1 };
}

for (const [id, name, emoji, inputs, unlock] of RAW) {
  let sell = 0, xp = 0, mins = 1;
  for (const [k, n] of inputs) { const b = base(k); sell += b.sell * n; xp += b.xp * n; mins = Math.max(mins, b.minutes); }
  const r: Recipe = { id, name, emoji, inputs: inputs.map(([key, n]) => ({ key, n })), unlock, minutes: Math.min(240, Math.max(2, Math.round(mins * 0.5))), sell: Math.round(sell * 1.8), xp: Math.round(xp * 0.5) };
  RECIPES.push(r);
  RECIPE_BY_ID[id] = r;
}

// 風車零件不是食物：固定 4 小時、價值另外算
Object.assign(RECIPE_BY_ID.windpart, { minutes: 240, sell: 800, xp: 60 });

export const WORKSHOP_LEVEL = 15;
export const workshopSlots = (level: number): number => (level >= 70 ? 6 : level >= 40 ? 4 : 2);
