import { cropXp, seedPrice, sellPrice } from './economy';
import type { Season } from '../core/clock';

// 參數化作物：同一個生成器吃不同參數，產生 4 個成長階段的模型
export type CropShape =
  | { kind: 'root'; root: string; rootShape: 'round' | 'cone' | 'oval' | 'bulb' | 'long' | 'rhizome'; leaf: string; leafCount: number; tubeLeaves?: boolean; top?: string }
  | { kind: 'grain'; stalk: string; head: string; droop?: boolean }
  | { kind: 'cane'; stalk: string; leaf: string }
  | { kind: 'flower'; leaf: string; stem: string; flower: string; style?: 'cup' | 'cluster' | 'bract'; flower2?: string }
  | { kind: 'fruit'; leaf: string; fruit: string; fruitShape: 'long' | 'berry'; count: number }
  | { kind: 'leafy'; leaf: string; leaf2: string; style: 'head' | 'rosette' | 'feather' | 'ball' | 'curd'; flower?: string }
  | { kind: 'mushroom'; cap: string; stem: string }
  // 攀藤：支架＋藤蔓＋垂掛果實（豌豆帳篷架、番茄單柱、小黃瓜門型架、葡萄棚）
  | { kind: 'vine'; leaf: string; fruit: string; style: 'pod' | 'tomato' | 'cucumber' | 'grape' }
  // 高稈：玉米、向日葵、蘆筍嫩莖、竹筍
  | { kind: 'tall'; stalk: string; leaf: string; fruit: string; style: 'corn' | 'sunflower' | 'asparagus' | 'bamboo' }
  // 灌木：藍莓、蔓越莓（貼地）、茶樹、薰衣草、辣椒
  | { kind: 'bush'; leaf: string; leaf2: string; berry: string; style: 'berry' | 'mat' | 'tea' | 'lavender' | 'chili' }
  // 瓜類：貼地大葉＋躺在土上的大果實
  | { kind: 'melon'; leaf: string; fruit: string; stripe: string; style: 'watermelon' | 'pumpkin' }
  | { kind: 'giant'; variant: 'pumpkin' | 'daikon' | 'cabbage' | 'watermelon' }
  // 水生：浮在水面上（原點＝水面），蓮花、西洋菜
  | { kind: 'aquatic'; leaf: string; flower: string; style: 'lotus' | 'cress' };

export interface CropDef {
  id: string;
  name: string;
  emoji: string;
  season: Season | 'all';
  minutes: number;
  unlock: number;
  shape: CropShape;
  night?: boolean; // 夜間花：只在 19:00–05:00 生長
  giant?: boolean; // 巨型作物：佔 3×3
  water?: boolean; // 水生作物：只能種在池塘的水面位置
  seed: number;
  sell: number;
  xp: number;
}

const def = (id: string, name: string, emoji: string, season: Season | 'all', minutes: number, unlock: number, shape: CropShape): CropDef =>
  ({ id, name, emoji, season, minutes, unlock, shape, seed: seedPrice(minutes), sell: sellPrice(minutes), xp: cropXp(minutes) });

// 一年四季作物（docs/04 §3）：依解鎖等級排序
export const CROPS: CropDef[] = [
  def('radish', '蘿蔔', '🌱', 'all', 1, 1, { kind: 'root', root: '#e8455a', rootShape: 'round', leaf: '#5fbf4a', leafCount: 4 }),
  def('wheat', '小麥', '🌾', 'all', 5, 2, { kind: 'grain', stalk: '#c9a646', head: '#f0c95a' }),
  def('carrot', '胡蘿蔔', '🥕', 'all', 15, 3, { kind: 'root', root: '#ff8a2a', rootShape: 'cone', leaf: '#4fae3c', leafCount: 6 }),
  def('spinach', '菠菜', '🍃', 'winter', 30, 4, { kind: 'leafy', leaf: '#3f9a3a', leaf2: '#5cb84a', style: 'rosette' }),
  def('pea', '豌豆', '🫛', 'spring', 30, 4, { kind: 'vine', leaf: '#4fae3c', fruit: '#a6e25a', style: 'pod' }),
  def('tomato', '番茄', '🍅', 'summer', 30, 4, { kind: 'vine', leaf: '#4f9e3a', fruit: '#ee3b2f', style: 'tomato' }),
  def('buckwheat', '蕎麥', '🌸', 'autumn', 30, 5, { kind: 'flower', leaf: '#5d9e3f', stem: '#c75a6a', flower: '#fff1f4' }),
  def('potato', '馬鈴薯', '🥔', 'all', 45, 6, { kind: 'root', root: '#c9995a', rootShape: 'oval', leaf: '#5a9e3a', leafCount: 7 }),
  def('tulip', '鬱金香', '🌷', 'spring', 60, 7, { kind: 'flower', leaf: '#5fae4a', stem: '#5a9e3a', flower: '#ff5a8a', flower2: '#ff3b3b', style: 'cup' }),
  def('eggplant', '茄子', '🍆', 'autumn', 60, 8, { kind: 'fruit', leaf: '#4f8f3a', fruit: '#6a3a8f', fruitShape: 'long', count: 3 }),
  def('cucumber', '小黃瓜', '🥒', 'summer', 60, 8, { kind: 'vine', leaf: '#4f9e3a', fruit: '#2f7f2a', style: 'cucumber' }),
  def('strawberry', '草莓', '🍓', 'winter', 60, 9, { kind: 'fruit', leaf: '#4fa83a', fruit: '#e8384a', fruitShape: 'berry', count: 5 }),
  def('cabbage', '高麗菜', '🥬', 'spring', 120, 9, { kind: 'leafy', leaf: '#6aae5a', leaf2: '#cdeb9a', style: 'ball' }),
  def('onion', '洋蔥', '🧅', 'all', 120, 10, { kind: 'root', root: '#b8578e', rootShape: 'bulb', leaf: '#6ab84a', leafCount: 5, tubeLeaves: true }),
  def('garland', '茼蒿', '🌼', 'winter', 45, 11, { kind: 'leafy', leaf: '#4f9e3a', leaf2: '#6fbf4a', style: 'feather', flower: '#ffd84a' }),
  def('chili', '辣椒', '🌶️', 'summer', 120, 11, { kind: 'bush', leaf: '#3f8f36', leaf2: '#5aa845', berry: '#e8231c', style: 'chili' }),
  def('shiitake', '香菇', '🍄', 'autumn', 90, 12, { kind: 'mushroom', cap: '#8a5a3a', stem: '#f1e3c2' }),
  def('napa', '大白菜', '🥬', 'winter', 120, 12, { kind: 'leafy', leaf: '#9fd86a', leaf2: '#e8f5c8', style: 'head' }),
  def('rapeflower', '油菜花', '🌼', 'spring', 45, 12, { kind: 'flower', leaf: '#5a9e44', stem: '#6fae3a', flower: '#ffd21f', style: 'cluster' }),
  def('sweetpotato', '地瓜', '🍠', 'autumn', 120, 13, { kind: 'root', root: '#a8456a', rootShape: 'oval', leaf: '#4f8f3a', leafCount: 8 }),
  def('sunflower', '向日葵', '🌻', 'summer', 180, 14, { kind: 'tall', stalk: '#5a9e3a', leaf: '#4f9e3a', fruit: '#ffc21f', style: 'sunflower' }),
  def('asparagus', '蘆筍', '🌱', 'spring', 240, 16, { kind: 'tall', stalk: '#6fb03f', leaf: '#9fd86a', fruit: '#7a6a9a', style: 'asparagus' }),
  def('cauliflower', '花椰菜', '🥦', 'winter', 240, 16, { kind: 'leafy', leaf: '#4f8f5a', leaf2: '#fbf3dc', style: 'curd' }),
  def('corn', '玉米', '🌽', 'summer', 240, 17, { kind: 'tall', stalk: '#7fb94a', leaf: '#62ae44', fruit: '#ffd23a', style: 'corn' }),
  def('sugarcane', '甘蔗', '🎋', 'all', 480, 18, { kind: 'cane', stalk: '#8a5a7a', leaf: '#6ab84a' }),
  def('cranberry', '蔓越莓', '🔴', 'autumn', 240, 18, { kind: 'bush', leaf: '#3f6f3a', leaf2: '#5f8a3a', berry: '#e0203a', style: 'mat' }),
  def('tea', '春茶', '🍵', 'spring', 480, 20, { kind: 'bush', leaf: '#2f7a3a', leaf2: '#b8ec70', berry: '#ffffff', style: 'tea' }),
  def('daikon', '白蘿蔔', '🥕', 'winter', 480, 20, { kind: 'root', root: '#f7f4ec', rootShape: 'long', leaf: '#4fae3c', leafCount: 7, top: '#cfe8a0' }),
  def('blueberry', '藍莓', '🫐', 'summer', 480, 21, { kind: 'bush', leaf: '#4a9a52', leaf2: '#62ae5e', berry: '#3f56d6', style: 'berry' }),
  def('bamboo', '竹筍', '🎍', 'spring', 720, 22, { kind: 'tall', stalk: '#6aa84a', leaf: '#7fc05a', fruit: '#8a5a32', style: 'bamboo' }),
  def('grape', '葡萄', '🍇', 'autumn', 480, 23, { kind: 'vine', leaf: '#5aa03a', fruit: '#7a3fa8', style: 'grape' }),
  def('pumpkin', '南瓜', '🎃', 'autumn', 720, 25, { kind: 'melon', leaf: '#4f8f3a', fruit: '#f5861f', stripe: '#d86a14', style: 'pumpkin' }),
  def('watermelon', '西瓜', '🍉', 'summer', 720, 26, { kind: 'melon', leaf: '#4f9e3a', fruit: '#7cc45a', stripe: '#1f5a24', style: 'watermelon' }),
  def('poinsettia', '聖誕紅', '🌺', 'winter', 720, 26, { kind: 'flower', leaf: '#2f7a3a', stem: '#3f7a2a', flower: '#e0242f', flower2: '#ffd84a', style: 'bract' }),
  { ...def('watercress', '西洋菜', '🥬', 'all', 180, 30, { kind: 'aquatic', leaf: '#5fcf48', flower: '#ffffff', style: 'cress' }), water: true },
  def('lavender', '薰衣草', '💜', 'spring', 1440, 35, { kind: 'bush', leaf: '#8aa88a', leaf2: '#a7c49a', berry: '#8a5ad0', style: 'lavender' }),
  def('rice', '稻米', '🍚', 'autumn', 1440, 36, { kind: 'grain', stalk: '#c9b04a', head: '#f0c24a', droop: true }),
  def('ginger', '老薑', '🫚', 'winter', 1440, 37, { kind: 'root', root: '#d9b27a', rootShape: 'rhizome', leaf: '#4f9e3a', leafCount: 3, top: '#f28aa0' }),
  { ...def('lotus', '蓮花', '🪷', 'summer', 1440, 38, { kind: 'aquatic', leaf: '#4fae3f', flower: '#ff6fa8', style: 'lotus' }), water: true },
];

// 夜間花（docs/04 §4.2）
const nightDef = (id: string, name: string, emoji: string, season: Season, minutes: number, unlock: number, flower: string): CropDef =>
  ({ ...def(id, name, emoji, season, minutes, unlock, { kind: 'flower', leaf: '#3f7a4a', stem: '#5a8a6a', flower }), night: true });
CROPS.push(
  nightDef('primrose', '月見草', '🌙', 'autumn', 360, 31, '#fff27a'),
  nightDef('frostflower', '霜月花', '❄️', 'winter', 360, 32, '#bfe6ff'),
  nightDef('moonlily', '月光鈴蘭', '🔔', 'spring', 360, 28, '#a8d8ff'),
  nightDef('epiphyllum', '曇花', '🤍', 'summer', 480, 30, '#ffffff'),
);

// 巨型作物（docs/04 §4.3）：巨型種子種在 3×3 的田上，3 天成熟
const giantDef = (id: string, name: string, emoji: string, season: Season, variant: 'pumpkin' | 'daikon' | 'cabbage' | 'watermelon'): CropDef =>
  ({ id, name, emoji, season, minutes: 4320, unlock: 1, shape: { kind: 'giant', variant }, giant: true, seed: 0, sell: sellPrice(720) * 12, xp: cropXp(4320) * 3 });
export const GIANTS: CropDef[] = [
  giantDef('giant_pumpkin', '萬聖巨南瓜', '🎃', 'autumn', 'pumpkin'),
  giantDef('giant_daikon', '巨型白蘿蔔', '🥕', 'winter', 'daikon'),
  giantDef('giant_cabbage', '巨無霸高麗菜', '🥬', 'spring', 'cabbage'),
  giantDef('giant_watermelon', '巨型西瓜', '🍉', 'summer', 'watermelon'),
];

export const CROP_BY_ID: Record<string, CropDef> = Object.fromEntries([...CROPS, ...GIANTS].map((c) => [c.id, c]));
