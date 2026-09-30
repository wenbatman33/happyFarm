import { CROPS } from './crops';
import { RECIPES } from './recipes';

// 圖鑑目錄（docs/04 §8）：還沒實作的季節內容也先列出來，讓玩家看得到一整年的收集目標
export interface AlmanacEntry { id: string; name: string; emoji: string; cat: string; hint: string }

const S = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季', all: '全季' } as const;

// 尚未實作的作物（其餘四季作物已由 CROPS 自動列入）
const PLANNED: [string, string, string, keyof typeof S, number, string][] = [
  ['lotus', '蓮花', '🪷', 'summer', 38, '池塘開放後推出'],
];

export const NIGHT_FLOWERS: [string, string, string, keyof typeof S, number][] = [
  ['moonlily', '月光鈴蘭', '🔔', 'spring', 28], ['epiphyllum', '曇花', '🤍', 'summer', 30], ['primrose', '月見草', '🌙', 'autumn', 31], ['frostflower', '霜月花', '❄️', 'winter', 32],
];

export const FRUITS: [string, string, string, keyof typeof S, number][] = [
  ['cherry', '櫻桃', '🍒', 'spring', 25], ['loquat', '枇杷', '🟠', 'spring', 45], ['mango', '芒果', '🥭', 'summer', 27], ['peach', '水蜜桃', '🍑', 'summer', 48],
  ['persimmon', '柿子', '🟧', 'autumn', 29], ['apple', '蘋果', '🍎', 'autumn', 50], ['orange', '橘子', '🍊', 'winter', 28], ['kumquat', '金桔', '🟡', 'winter', 46],
];

export const GIANTS: [string, string, string, keyof typeof S][] = [
  ['giant_cabbage', '巨無霸高麗菜', '🥬', 'spring'], ['giant_watermelon', '巨型西瓜', '🍉', 'summer'], ['giant_pumpkin', '萬聖巨南瓜', '🎃', 'autumn'], ['giant_daikon', '巨型白蘿蔔', '🥕', 'winter'],
];

// 加工品直接從食譜產生（風車零件不算圖鑑）
export const CRAFTED: [string, string, string][] = RECIPES.filter((r) => r.id !== 'windpart').map((r) => [r.id, r.name, r.emoji]);

export const ALMANAC: AlmanacEntry[] = [
  ...CROPS.filter((c) => !c.night).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, cat: '作物', hint: `${S[c.season]} · Lv${c.unlock}` })),
  ...PLANNED.map(([id, name, emoji, s, lv, note]) => ({ id, name, emoji, cat: '作物', hint: `${S[s]} · Lv${lv}（${note}）` })),
  ...NIGHT_FLOWERS.map(([id, name, emoji, s, lv]) => ({ id, name, emoji, cat: '夜間花', hint: `${S[s]}夜晚 · Lv${lv}` })),
  ...FRUITS.map(([id, name, emoji, s, lv]) => ({ id, name, emoji, cat: '果樹', hint: `${S[s]} · Lv${lv}` })),
  ...GIANTS.map(([id, name, emoji, s]) => ({ id, name, emoji, cat: '巨型作物', hint: `${S[s]} · 巨型種子` })),
  { id: 'milk', name: '牛奶', emoji: '🥛', cat: '牧場', hint: '照顧花花' },
  ...CRAFTED.map(([id, name, emoji]) => ({ id, name, emoji, cat: '加工品', hint: '加工坊 · Lv15' })),
  { id: 'clover', name: '四葉草', emoji: '🍀', cat: '收藏品', hint: '拔草時偶爾撿到' },
  { id: 'coin_old', name: '古錢幣', emoji: '🪙', cat: '收藏品', hint: '拔草或挖寶' },
];
