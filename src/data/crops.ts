import { cropXp, seedPrice, sellPrice } from './economy';
import type { Season } from '../core/clock';

// 參數化作物：同一個生成器吃不同參數，產生 4 個成長階段的模型
export type CropShape =
  | { kind: 'root'; root: string; rootShape: 'round' | 'cone' | 'oval' | 'bulb'; leaf: string; leafCount: number; tubeLeaves?: boolean }
  | { kind: 'grain'; stalk: string; head: string }
  | { kind: 'cane'; stalk: string; leaf: string }
  | { kind: 'flower'; leaf: string; stem: string; flower: string }
  | { kind: 'fruit'; leaf: string; fruit: string; fruitShape: 'long' | 'berry'; count: number }
  | { kind: 'leafy'; leaf: string; leaf2: string; style: 'head' | 'rosette' | 'feather'; flower?: string }
  | { kind: 'mushroom'; cap: string; stem: string };

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

// M1：全季 6 種＋秋季 4 種＋冬季 4 種（docs/04 §3）
export const CROPS: CropDef[] = [
  def('radish', '蘿蔔', '🌱', 'all', 1, 1, { kind: 'root', root: '#e8455a', rootShape: 'round', leaf: '#5fbf4a', leafCount: 4 }),
  def('wheat', '小麥', '🌾', 'all', 5, 2, { kind: 'grain', stalk: '#c9a646', head: '#f0c95a' }),
  def('carrot', '胡蘿蔔', '🥕', 'all', 15, 3, { kind: 'root', root: '#ff8a2a', rootShape: 'cone', leaf: '#4fae3c', leafCount: 6 }),
  def('spinach', '菠菜', '🍃', 'winter', 30, 4, { kind: 'leafy', leaf: '#3f9a3a', leaf2: '#5cb84a', style: 'rosette' }),
  def('buckwheat', '蕎麥', '🌸', 'autumn', 30, 5, { kind: 'flower', leaf: '#5d9e3f', stem: '#c75a6a', flower: '#fff1f4' }),
  def('potato', '馬鈴薯', '🥔', 'all', 45, 6, { kind: 'root', root: '#c9995a', rootShape: 'oval', leaf: '#5a9e3a', leafCount: 7 }),
  def('eggplant', '茄子', '🍆', 'autumn', 60, 8, { kind: 'fruit', leaf: '#4f8f3a', fruit: '#6a3a8f', fruitShape: 'long', count: 3 }),
  def('strawberry', '草莓', '🍓', 'winter', 60, 9, { kind: 'fruit', leaf: '#4fa83a', fruit: '#e8384a', fruitShape: 'berry', count: 5 }),
  def('onion', '洋蔥', '🧅', 'all', 120, 10, { kind: 'root', root: '#b8578e', rootShape: 'bulb', leaf: '#6ab84a', leafCount: 5, tubeLeaves: true }),
  def('garland', '茼蒿', '🌼', 'winter', 45, 11, { kind: 'leafy', leaf: '#4f9e3a', leaf2: '#6fbf4a', style: 'feather', flower: '#ffd84a' }),
  def('shiitake', '香菇', '🍄', 'autumn', 90, 12, { kind: 'mushroom', cap: '#8a5a3a', stem: '#f1e3c2' }),
  def('napa', '大白菜', '🥬', 'winter', 120, 12, { kind: 'leafy', leaf: '#9fd86a', leaf2: '#e8f5c8', style: 'head' }),
  def('sweetpotato', '地瓜', '🍠', 'autumn', 120, 13, { kind: 'root', root: '#a8456a', rootShape: 'oval', leaf: '#4f8f3a', leafCount: 8 }),
  def('sugarcane', '甘蔗', '🎋', 'all', 480, 18, { kind: 'cane', stalk: '#8a5a7a', leaf: '#6ab84a' }),
];

export const CROP_BY_ID: Record<string, CropDef> = Object.fromEntries(CROPS.map((c) => [c.id, c]));
