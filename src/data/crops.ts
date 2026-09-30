import { cropXp, seedPrice, sellPrice } from './economy';
import type { Season } from '../core/clock';

// 參數化作物：同一個生成器吃不同參數，產生 4 個成長階段的模型
export type CropShape =
  | { kind: 'root'; root: string; rootShape: 'round' | 'cone'; leaf: string; leafCount: number }
  | { kind: 'grain'; stalk: string; head: string }
  | { kind: 'flower'; leaf: string; stem: string; flower: string };

export interface CropDef {
  id: string;
  name: string;
  emoji: string;
  season: Season | 'all';
  minutes: number;
  unlock: number;
  shape: CropShape;
  seed: number;
  sell: number;
  xp: number;
}

const def = (id: string, name: string, emoji: string, season: Season | 'all', minutes: number, unlock: number, shape: CropShape): CropDef =>
  ({ id, name, emoji, season, minutes, unlock, shape, seed: seedPrice(minutes), sell: sellPrice(minutes), xp: cropXp(minutes) });

// M0 先做 4 種：3 種全季＋1 種秋季（現在是秋天）
export const CROPS: CropDef[] = [
  def('radish', '蘿蔔', '🌱', 'all', 1, 1, { kind: 'root', root: '#e8455a', rootShape: 'round', leaf: '#5fbf4a', leafCount: 4 }),
  def('wheat', '小麥', '🌾', 'all', 5, 2, { kind: 'grain', stalk: '#c9a646', head: '#f0c95a' }),
  def('carrot', '胡蘿蔔', '🥕', 'all', 15, 3, { kind: 'root', root: '#ff8a2a', rootShape: 'cone', leaf: '#4fae3c', leafCount: 6 }),
  def('buckwheat', '蕎麥', '🌸', 'autumn', 30, 5, { kind: 'flower', leaf: '#5d9e3f', stem: '#c75a6a', flower: '#fff1f4' }),
];

export const CROP_BY_ID: Record<string, CropDef> = Object.fromEntries(CROPS.map((c) => [c.id, c]));
