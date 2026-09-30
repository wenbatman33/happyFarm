import { CROPS } from './crops';

// 圖鑑目錄（docs/04 §8）：還沒實作的季節內容也先列出來，讓玩家看得到一整年的收集目標
export interface AlmanacEntry { id: string; name: string; emoji: string; cat: string; hint: string }

const S = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季', all: '全季' } as const;

// 春、夏作物（之後的季節更新會實作）
const PLANNED: [string, string, string, keyof typeof S, number][] = [
  ['pea', '豌豆', '🫛', 'spring', 4], ['tulip', '鬱金香', '🌷', 'spring', 7], ['cabbage', '高麗菜', '🥬', 'spring', 9], ['rapeflower', '油菜花', '🌼', 'spring', 12],
  ['asparagus', '蘆筍', '🌱', 'spring', 16], ['tea', '春茶', '🍵', 'spring', 20], ['bamboo', '竹筍', '🎍', 'spring', 22], ['lavender', '薰衣草', '💜', 'spring', 35],
  ['tomato', '番茄', '🍅', 'summer', 4], ['cucumber', '小黃瓜', '🥒', 'summer', 8], ['chili', '辣椒', '🌶️', 'summer', 11], ['sunflower', '向日葵', '🌻', 'summer', 14],
  ['corn', '玉米', '🌽', 'summer', 17], ['blueberry', '藍莓', '🫐', 'summer', 21], ['watermelon', '西瓜', '🍉', 'summer', 26], ['lotus', '蓮花', '🪷', 'summer', 38],
  ['pumpkin', '南瓜', '🎃', 'autumn', 25], ['grape', '葡萄', '🍇', 'autumn', 23], ['cranberry', '蔓越莓', '🔴', 'autumn', 18], ['rice', '稻米', '🍚', 'autumn', 36],
  ['cauliflower', '花椰菜', '🥦', 'winter', 16], ['daikon', '白蘿蔔', '🥕', 'winter', 20], ['poinsettia', '聖誕紅', '🌺', 'winter', 26], ['ginger', '老薑', '🫚', 'winter', 37],
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

export const CRAFTED: [string, string, string][] = [
  ['flour', '麵粉', '🥣'], ['bread', '麵包', '🍞'], ['jam', '草莓果醬', '🫙'], ['butter', '奶油', '🧈'], ['cheese', '起司', '🧀'],
  ['fries', '薯條', '🍟'], ['soba', '蕎麥麵', '🍜'], ['roastpotato', '烤地瓜', '🍠'], ['soup', '香菇湯', '🍲'], ['salad', '蔬菜沙拉', '🥗'],
];

export const ALMANAC: AlmanacEntry[] = [
  ...CROPS.filter((c) => !c.night).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, cat: '作物', hint: `${S[c.season]} · Lv${c.unlock}` })),
  ...PLANNED.map(([id, name, emoji, s, lv]) => ({ id, name, emoji, cat: '作物', hint: `${S[s]} · Lv${lv}（即將推出）` })),
  ...NIGHT_FLOWERS.map(([id, name, emoji, s, lv]) => ({ id, name, emoji, cat: '夜間花', hint: `${S[s]}夜晚 · Lv${lv}` })),
  ...FRUITS.map(([id, name, emoji, s, lv]) => ({ id, name, emoji, cat: '果樹', hint: `${S[s]} · Lv${lv}` })),
  ...GIANTS.map(([id, name, emoji, s]) => ({ id, name, emoji, cat: '巨型作物', hint: `${S[s]} · 巨型種子` })),
  { id: 'milk', name: '牛奶', emoji: '🥛', cat: '牧場', hint: '照顧花花' },
  ...CRAFTED.map(([id, name, emoji]) => ({ id, name, emoji, cat: '加工品', hint: '加工坊 · Lv15' })),
  { id: 'clover', name: '四葉草', emoji: '🍀', cat: '收藏品', hint: '拔草時偶爾撿到' },
  { id: 'coin_old', name: '古錢幣', emoji: '🪙', cat: '收藏品', hint: '拔草或挖寶' },
];
