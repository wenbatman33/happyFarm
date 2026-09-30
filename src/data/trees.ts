import type { Season } from '../core/clock';
import { cropXp, seedPrice, sellPrice } from './economy';

// 果樹（docs/04 §4.1）：永久存在，成熟後當季每 2 天結果
export interface TreeDef { id: string; name: string; emoji: string; season: Season; unlock: number; matureDays: number; yieldN: number; fruit: string; blossom: string; sapling: number; sell: number; xp: number }

const t = (id: string, name: string, emoji: string, season: Season, unlock: number, matureDays: number, yieldN: number, fruit: string, blossom: string): TreeDef =>
  ({ id, name, emoji, season, unlock, matureDays, yieldN, fruit, blossom, sapling: seedPrice(720) * 20, sell: sellPrice(480), xp: cropXp(480) });

export const TREES: TreeDef[] = [
  t('cherry', '櫻桃', '🍒', 'spring', 25, 10, 3, '#d8203a', '#f6b8d0'),
  t('mango', '芒果', '🥭', 'summer', 27, 12, 3, '#f2a02a', '#f7e08a'),
  t('orange', '橘子', '🍊', 'winter', 28, 12, 3, '#f28a1e', '#fff4e0'),
  t('persimmon', '柿子', '🟧', 'autumn', 29, 12, 3, '#ec6a1a', '#f7e0b0'),
  t('loquat', '枇杷', '🟠', 'spring', 45, 14, 4, '#f2b43a', '#fff4e0'),
  t('kumquat', '金桔', '🟡', 'winter', 46, 10, 4, '#f7b21a', '#fff4e0'),
  t('peach', '水蜜桃', '🍑', 'summer', 48, 14, 4, '#f7a08a', '#f9c4d4'),
  t('apple', '蘋果', '🍎', 'autumn', 50, 14, 4, '#d8303a', '#fbe4ea'),
];
export const TREE_BY_ID: Record<string, TreeDef> = Object.fromEntries(TREES.map((x) => [x.id, x]));
export const FRUIT_EVERY_MS = 2 * 86400000;
export const ORCHARD_LEVEL = 25;
// 果園樹位（格座標）：房子東北邊
export const ORCHARD_SLOTS: [number, number][] = [[7.5, -11.5], [10, -11.5], [12.3, -11.5], [7.5, -8.6], [10, -8.6], [12.3, -8.6]];
