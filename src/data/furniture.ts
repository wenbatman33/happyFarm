// 室內家具目錄（docs/03 §2.2、§3）
// 房間是 9×7 格的地板（x −4..4、z −3..3，1 格 = 1 公尺），後牆在 z = −3.5，有 9 個掛牆位置（x −4..4）
// floor：佔 w×d 格；rug：地毯，上面還能擺家具；wall：掛在後牆，佔 w 個牆位
export type FurnLayer = 'floor' | 'rug' | 'wall';
export type FurnSeries = 'wood' | 'country' | 'cozy' | 'kitchen' | 'pet' | 'festive';

export interface FurnDef {
  id: string;
  name: string;
  emoji: string;
  layer: FurnLayer;
  w: number;
  d: number;
  comfort: number;
  series: FurnSeries;
  unlock: number; // 等級
  coins: number;
  wood?: number;
  stone?: number;
  // 取得方式：shop＝家具店購買；其他只能從節慶、手帳、愛心商店、印章卡拿到
  source: 'shop' | 'festival' | 'pass' | 'heart' | 'stamp' | 'gift';
  pets?: ('corgi' | 'cat' | 'bunny' | 'duck')[]; // 寵物喜歡待在這件家具上
  glow?: boolean; // 夜間會發光（燈、壁爐）
  sit?: boolean; // 主角可以坐
}

const f = (id: string, name: string, emoji: string, layer: FurnLayer, w: number, d: number, comfort: number, series: FurnSeries, unlock: number, coins: number, extra: Partial<FurnDef> = {}): FurnDef =>
  ({ id, name, emoji, layer, w, d, comfort, series, unlock, coins, source: 'shop', ...extra });

export const FURNITURE: FurnDef[] = [
  // 原木系列：木材做的基本款
  f('wood_bed', '原木床', '🛏️', 'floor', 2, 2, 8, 'wood', 1, 800, { wood: 10 }),
  f('wood_table', '原木餐桌', '🪵', 'floor', 2, 1, 5, 'wood', 1, 500, { wood: 8 }),
  f('wood_chair', '原木椅', '🪑', 'floor', 1, 1, 2, 'wood', 1, 200, { wood: 3, sit: true }),
  f('wood_stool', '小板凳', '🪑', 'floor', 1, 1, 1, 'wood', 1, 120, { wood: 2, sit: true }),
  f('wood_shelf', '原木書櫃', '📚', 'floor', 2, 1, 4, 'wood', 5, 600, { wood: 8 }),
  f('wood_wardrobe', '原木衣櫃', '🚪', 'floor', 2, 1, 4, 'wood', 8, 900, { wood: 12 }),
  // 田園系列
  f('country_sofa', '田園沙發', '🛋️', 'floor', 2, 1, 10, 'country', 10, 2500, { sit: true, pets: ['cat', 'corgi'] }),
  f('country_armchair', '格紋單人椅', '💺', 'floor', 1, 1, 5, 'country', 10, 1200, { sit: true }),
  f('country_lamp', '田園立燈', '💡', 'floor', 1, 1, 3, 'country', 10, 700, { glow: true }),
  f('country_rug', '格紋地毯', '🟥', 'rug', 3, 2, 4, 'country', 10, 900, { pets: ['corgi', 'bunny'] }),
  f('country_plant', '大盆栽', '🪴', 'floor', 1, 1, 3, 'country', 6, 400),
  f('country_sideboard', '碗櫃', '🍽️', 'floor', 2, 1, 5, 'country', 14, 1800),
  // 暖暖系列（高等級）
  f('cozy_fireplace', '石砌壁爐', '🔥', 'floor', 2, 1, 15, 'cozy', 25, 6000, { stone: 30, glow: true, pets: ['cat', 'corgi', 'bunny', 'duck'] }),
  f('cozy_rug', '圓形毛地毯', '⭕', 'rug', 2, 2, 5, 'cozy', 20, 1500, { pets: ['corgi', 'bunny', 'duck'] }),
  f('cozy_bed', '羽絨大床', '🛌', 'floor', 2, 2, 14, 'cozy', 30, 8000, { pets: ['cat'] }),
  f('cozy_windowseat', '窗邊臥榻', '🪟', 'floor', 2, 1, 8, 'cozy', 25, 4000, { sit: true, pets: ['cat'] }),
  f('cozy_radio', '老收音機', '📻', 'floor', 1, 1, 3, 'cozy', 18, 1200),
  f('cozy_piano', '小鋼琴', '🎹', 'floor', 2, 1, 12, 'cozy', 40, 15000),
  // 廚房
  f('kitchen_stove', '燒柴爐', '🍳', 'floor', 2, 1, 6, 'kitchen', 15, 3000, { stone: 10, glow: true }),
  f('kitchen_icebox', '復古冰箱', '🧊', 'floor', 1, 1, 4, 'kitchen', 20, 2500),
  f('kitchen_counter', '料理台', '🔪', 'floor', 2, 1, 4, 'kitchen', 15, 1500, { wood: 6 }),
  // 寵物用品
  f('pet_bed', '寵物軟墊', '🧺', 'floor', 1, 1, 4, 'pet', 3, 600, { pets: ['corgi', 'bunny', 'duck'] }),
  f('pet_cattower', '貓跳台', '🐈', 'floor', 1, 1, 5, 'pet', 8, 1500, { pets: ['cat'] }),
  f('pet_bowl', '寵物碗', '🥣', 'floor', 1, 1, 2, 'pet', 1, 300),
  // 牆飾
  f('wall_painting', '風景畫', '🖼️', 'wall', 1, 1, 3, 'country', 3, 600),
  f('wall_clock', '咕咕鐘', '🕰️', 'wall', 1, 1, 3, 'wood', 6, 900),
  f('wall_window', '花窗', '🪟', 'wall', 2, 1, 5, 'country', 12, 1500),
  f('wall_shelf', '牆上層板', '🧸', 'wall', 2, 1, 3, 'wood', 4, 700, { wood: 4 }),
  f('wall_photo', '全家福照片', '📷', 'wall', 1, 1, 6, 'cozy', 1, 0, { source: 'gift' }),
  // 節慶與特殊來源
  f('cny_lion', '舞獅擺飾', '🦁', 'floor', 1, 1, 10, 'festive', 1, 0, { source: 'festival' }),
  f('cny_couplet', '春聯', '🧧', 'wall', 2, 1, 6, 'festive', 1, 0, { source: 'festival' }),
  f('lantern_string', '燈籠串', '🏮', 'wall', 2, 1, 6, 'festive', 1, 0, { source: 'festival', glow: true }),
  f('xmas_tree', '聖誕樹', '🎄', 'floor', 1, 1, 12, 'festive', 1, 0, { source: 'festival', glow: true }),
  f('pumpkin_lamp', '南瓜燈', '🎃', 'floor', 1, 1, 6, 'festive', 1, 0, { source: 'festival', glow: true }),
  f('moon_lamp', '月亮燈', '🌕', 'floor', 1, 1, 6, 'festive', 1, 0, { source: 'festival', glow: true }),
  f('fw_launcher', '煙火台', '🎆', 'floor', 1, 1, 8, 'festive', 1, 0, { source: 'festival' }),
  f('heart_cushion', '愛心抱枕', '💗', 'floor', 1, 1, 5, 'cozy', 1, 0, { source: 'heart', pets: ['bunny', 'duck'] }),
  f('heart_plushie', '寵物玩偶', '🧸', 'floor', 1, 1, 6, 'pet', 1, 0, { source: 'heart', pets: ['corgi'] }),
  f('stamp_spring', '櫻花盆景', '🌸', 'floor', 1, 1, 7, 'festive', 1, 0, { source: 'stamp' }),
  f('stamp_summer', '玻璃風鈴', '🎐', 'wall', 1, 1, 7, 'festive', 1, 0, { source: 'stamp' }),
  f('stamp_autumn', '楓葉燈', '🍁', 'floor', 1, 1, 7, 'festive', 1, 0, { source: 'stamp', glow: true }),
  f('stamp_winter', '雪花玻璃球', '❄️', 'floor', 1, 1, 7, 'festive', 1, 0, { source: 'stamp' }),
];

export const FURN_BY_ID: Record<string, FurnDef> = Object.fromEntries(FURNITURE.map((x) => [x.id, x]));

export const SERIES_LABEL: Record<FurnSeries, string> = { wood: '原木', country: '田園', cozy: '暖暖', kitchen: '廚房', pet: '寵物', festive: '節慶' };

// 房間：依房屋階段開放（T1 1 間 → T3 2 間 → T4 4 間 → T5 6 間）
export type RoomStyle = 'living' | 'bedroom' | 'kitchen' | 'attic' | 'study' | 'sunroom';
export const ROOMS: { style: RoomStyle; name: string; tier: number }[] = [
  { style: 'living', name: '客廳', tier: 1 },
  { style: 'bedroom', name: '臥室', tier: 3 },
  { style: 'kitchen', name: '廚房', tier: 4 },
  { style: 'attic', name: '閣樓', tier: 4 },
  { style: 'study', name: '書房', tier: 5 },
  { style: 'sunroom', name: '陽光室', tier: 5 },
];
export const ROOM_W = 9; // x −4..4
export const ROOM_D = 7; // z −3..3

// 家園舒適度（docs/03 §3）
export const HOUSE_COMFORT = [0, 10, 30, 60, 110, 200]; // 依房屋階段
export const SET_BONUS = 0.2; // 同一個房間同系列 3 件以上 +20%
export const WEED_PENALTY_CAP = 0.5; // 雜草最多扣掉 50%
// 舒適度星等門檻：影響休息加成累積速度與寵物心情
export const COMFORT_STARS = [0, 40, 100, 200, 350, 550];
export const comfortStars = (c: number): number => COMFORT_STARS.filter((t) => c >= t).length - 1;
