// 年度節慶表（docs/05 §5.2）：農曆節日先用對照表（2026–2030），之後再換成農曆轉換套件
export type FestivalId =
  | 'newyear' | 'cny' | 'lantern' | 'flower' | 'mother' | 'dragonboat' | 'watermelon'
  | 'qixi' | 'midautumn' | 'halloween' | 'harvest' | 'solstice' | 'xmas';

export interface FestivalDef {
  id: FestivalId;
  name: string;
  emoji: string;
  color: string; // 橫幅主色
  blurb: string; // 一句話玩法
  // 節慶商店：代幣換限定品（家具 id、寵物配件、巨型種子等）
  shop: { item: string; cost: number }[];
  // 節慶任務會要求的作物或加工品（依季節挑已解鎖的）
  wants: string[];
}

export const FESTIVALS: Record<FestivalId, FestivalDef> = {
  newyear: { id: 'newyear', name: '元旦跨年', emoji: '🎆', color: '#5b6cff', blurb: '午夜放煙火，寵物戴上派對帽', wants: ['wheat', 'strawberry'], shop: [{ item: 'fw_launcher', cost: 60 }, { item: 'pethat_party', cost: 40 }] },
  cny: { id: 'cny', name: '春節', emoji: '🧧', color: '#d8342c', blurb: '門上貼春聯、寵物送紅包、郵筒來了年菜訂單', wants: ['napa', 'daikon', 'spinach', 'bread', 'soup'], shop: [{ item: 'cny_lion', cost: 120 }, { item: 'cny_couplet', cost: 60 }, { item: 'lantern_string', cost: 80 }, { item: 'pethat_fortune', cost: 90 }, { item: 'giantseed', cost: 150 }] },
  lantern: { id: 'lantern', name: '元宵', emoji: '🏮', color: '#e8762c', blurb: '提燈籠夜遊，猜燈謎換代幣', wants: ['sweetpotato', 'strawberry'], shop: [{ item: 'lantern_string', cost: 60 }, { item: 'moon_lamp', cost: 70 }] },
  flower: { id: 'flower', name: '春日花祭', emoji: '🌷', color: '#e46aa5', blurb: '整座農場開滿花，鬱金香訂單加倍', wants: ['tulip', 'rapeflower', 'pea'], shop: [{ item: 'stamp_spring', cost: 70 }, { item: 'country_plant', cost: 30 }, { item: 'pethat_flower', cost: 60 }] },
  mother: { id: 'mother', name: '母親節', emoji: '💐', color: '#e8708a', blurb: '寫信給奶奶，康乃馨訂單', wants: ['tulip', 'cabbage'], shop: [{ item: 'wall_photo', cost: 50 }, { item: 'heart_cushion', cost: 40 }] },
  dragonboat: { id: 'dragonboat', name: '端午', emoji: '🐉', color: '#3f9a5a', blurb: '門口掛艾草，包粽子', wants: ['corn', 'bamboo'], shop: [{ item: 'pethat_sachet', cost: 60 }, { item: 'country_plant', cost: 30 }] },
  watermelon: { id: 'watermelon', name: '夏日西瓜大賽', emoji: '🍉', color: '#e8484a', blurb: '種出最大的西瓜！', wants: ['watermelon', 'cucumber', 'tomato'], shop: [{ item: 'giantseed', cost: 120 }, { item: 'stamp_summer', cost: 70 }] },
  qixi: { id: 'qixi', name: '七夕', emoji: '🌌', color: '#6a5acd', blurb: '夜空出現銀河，搭起鵲橋', wants: ['blueberry', 'sunflower'], shop: [{ item: 'wall_window', cost: 60 }, { item: 'heart_plushie', cost: 60 }] },
  midautumn: { id: 'midautumn', name: '中秋', emoji: '🥮', color: '#e8a02c', blurb: '烤肉賞月，做月餅，寵物戴柚子帽', wants: ['sweetpotato', 'buckwheat', 'persimmon'], shop: [{ item: 'moon_lamp', cost: 70 }, { item: 'pethat_pomelo', cost: 60 }] },
  halloween: { id: 'halloween', name: '萬聖節', emoji: '🎃', color: '#f07a1a', blurb: '南瓜燈亮起來，寵物變裝', wants: ['pumpkin', 'sweetpotato', 'eggplant'], shop: [{ item: 'pumpkin_lamp', cost: 60 }, { item: 'pethat_witch', cost: 80 }] },
  harvest: { id: 'harvest', name: '豐收祭', emoji: '🌾', color: '#c8902c', blurb: '豐收市集收購價提高，巨南瓜大賽', wants: ['rice', 'pumpkin', 'wheat', 'flour'], shop: [{ item: 'giantseed', cost: 120 }, { item: 'stamp_autumn', cost: 70 }] },
  solstice: { id: 'solstice', name: '冬至', emoji: '🍡', color: '#d86a8a', blurb: '搓湯圓，暖呼呼', wants: ['sweetpotato', 'ginger'], shop: [{ item: 'cozy_rug', cost: 50 }] },
  xmas: { id: 'xmas', name: '聖誕節', emoji: '🎄', color: '#2f8a4a', blurb: '裝飾聖誕樹，雪中收禮物', wants: ['strawberry', 'poinsettia', 'bread'], shop: [{ item: 'xmas_tree', cost: 100 }, { item: 'pethat_santa', cost: 80 }, { item: 'stamp_winter', cost: 70 }] },
};

// 農曆節日的國曆日期
const LUNAR: Record<'cny' | 'lantern' | 'dragonboat' | 'qixi' | 'midautumn', Record<number, string>> = {
  cny: { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03' },
  lantern: { 2026: '03-03', 2027: '02-20', 2028: '02-09', 2029: '02-27', 2030: '02-17' },
  dragonboat: { 2026: '06-19', 2027: '06-09', 2028: '05-28', 2029: '06-16', 2030: '06-05' },
  qixi: { 2026: '08-19', 2027: '08-08', 2028: '08-26', 2029: '08-16', 2030: '08-05' },
  midautumn: { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12' },
};

const at = (y: number, md: string) => { const [m, d] = md.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const DAY = 86400000;

// 母親節：五月第二個星期日
const motherDay = (y: number) => { const d = new Date(y, 4, 1); const first = (7 - d.getDay()) % 7; return new Date(y, 4, 1 + first + 7).getTime(); };

export interface FestivalWindow { id: FestivalId; start: number; end: number; key: string }

// 某一年的所有節慶區間（end 為不含的結束時間）
export function festivalWindows(y: number): FestivalWindow[] {
  const w = (id: FestivalId, start: number, days: number): FestivalWindow => ({ id, start, end: start + days * DAY, key: `${id}${y}` });
  const out: FestivalWindow[] = [
    w('newyear', at(y - 1, '12-31'), 3),
    w('flower', at(y, '04-01'), 10),
    w('mother', motherDay(y) - 3 * DAY, 7),
    w('watermelon', at(y, '07-15'), 14),
    w('halloween', at(y, '10-22'), 10),
    w('harvest', at(y, '11-08'), 14),
    w('solstice', at(y, '12-21'), 3),
    w('xmas', at(y, '12-14'), 12),
  ];
  const lunar = (id: keyof typeof LUNAR, before: number, days: number) => { const md = LUNAR[id][y]; if (md) out.push(w(id, at(y, md) - before * DAY, days)); };
  lunar('cny', 1, 14);
  lunar('lantern', 2, 5);
  lunar('dragonboat', 3, 7);
  lunar('qixi', 2, 5);
  lunar('midautumn', 3, 7);
  // 冬至與聖誕重疊時以冬至優先（只有 3 天）
  return out.sort((a, b) => a.start - b.start);
}

export function festivalAt(now: number): FestivalWindow | null {
  const y = new Date(now).getFullYear();
  const all = [...festivalWindows(y), ...festivalWindows(y + 1)].filter((f) => now >= f.start && now < f.end);
  if (!all.length) return null;
  // 同時有兩個時（冬至在聖誕期間）取比較短的那個
  return all.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
}

// 下一個節慶（給手帳顯示「即將到來」）
export function nextFestival(now: number): FestivalWindow | null {
  const y = new Date(now).getFullYear();
  return [...festivalWindows(y), ...festivalWindows(y + 1)].filter((f) => f.start > now).sort((a, b) => a.start - b.start)[0] ?? null;
}

// 節慶代幣：節慶結束後，剩下的每枚換 20 金幣
export const TOKEN_TO_COINS = 20;
// 春節紅包：每天第一次摸寵物時送
export const RED_ENVELOPE = [88, 168, 288, 388, 888];
