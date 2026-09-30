// 所有可由 DEV 工具微調的版面數值集中在這裡。
// 調好後按「💾 匯出」，再把 JSON 寫回本檔。

export type Anchor = 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'bc';
export type HudKey = 'status' | 'wallet' | 'toolbar' | 'bag' | 'queue' | 'toast' | 'event';

export interface HudItem {
  anchor: Anchor;
  x: number; // 相對錨點的水平距離（px）
  y: number; // 相對錨點的垂直距離（px）
  scale: number;
  fontSize: number;
  color: string;
  opacity: number;
}

export interface CameraLayout {
  fov: number;
  dist: number;
  distMin: number;
  distMax: number;
  pitch: number; // 俯角（度）
  followDamp: number;
  lookAhead: number; // 注視點往前偏移（公尺）
}

export interface Layout {
  hud: Record<HudKey, HudItem>;
  camera: CameraLayout;
}

const item = (anchor: Anchor, x: number, y: number, scale = 1, fontSize = 15, color = '#4a3526', opacity = 1): HudItem =>
  ({ anchor, x, y, scale, fontSize, color, opacity });

export const LAYOUT_PC: Layout = {
  hud: {
    status: item('tl', 16, 16, 1, 15),
    wallet: item('tr', 16, 16, 1, 15),
    toolbar: item('bc', 0, 18, 1, 13),
    bag: item('br', 18, 18, 1, 13),
    queue: item('bc', 0, 112, 1, 18),
    toast: item('tc', 0, 90, 1, 16, '#ffffff'),
    event: item('tc', 0, 16, 1, 14),
  },
  camera: { fov: 30, dist: 27, distMin: 12, distMax: 38, pitch: 50, followDamp: 4, lookAhead: 1.8 },
};

export const LAYOUT_MOBILE: Layout = {
  hud: {
    status: item('tl', 10, 10, 0.84, 13),
    wallet: item('tr', 10, 10, 0.84, 13),
    toolbar: item('bc', 0, 12, 0.92, 12),
    bag: item('br', 10, 96, 0.9, 12),
    queue: item('bc', 0, 100, 0.9, 16),
    toast: item('tc', 0, 110, 0.95, 14, '#ffffff'),
    event: item('tl', 10, 64, 0.84, 12),
  },
  camera: { fov: 34, dist: 33, distMin: 14, distMax: 44, pitch: 54, followDamp: 4, lookAhead: 0.4 },
};

// 場景物件的擺放（格座標，1 格 = 1 公尺）
export interface PropPlacement { x: number; z: number; rotY: number; scale: number }

export interface SceneLayout {
  house: PropPlacement;
  field: PropPlacement; // 左上角地塊的格座標
  doghouse: PropPlacement;
  mailbox: PropPlacement;
  compost: PropPlacement;
  ranch: PropPlacement; // 牧場柵欄中心（外框 6×5 公尺，東側開門）
  workshop: PropPlacement; // 加工坊（Lv15）
  greenhouse: PropPlacement; // 溫室（Lv40）中心；外框 x±4.5、z±2.5，南側中央開門
  market: PropPlacement; // 週末市集／流浪商人攤位（面向小徑）
  trees: PropPlacement[];
  rocks: PropPlacement[];
}

const p = (x: number, z: number, rotY = 0, scale = 1): PropPlacement => ({ x, z, rotY, scale });

export const SCENE_LAYOUT: SceneLayout = {
  house: p(0, -5.5),
  field: p(2, 1),
  doghouse: p(-6, -3, 0.5),
  mailbox: p(1.3, -1.4, -0.3),
  compost: p(-4.6, -0.8, 0.2),
  ranch: p(-8, 4.5),
  workshop: p(5.6, -5.4),
  greenhouse: p(-8, -11),
  market: p(-3.4, 9.4, Math.PI / 2),
  trees: [p(-1.8, -11.9, 0, 1.2), p(4.2, -11.8, 0.8, 1.05), p(-12.4, 0.8, 1.2, 1.15), p(11, 7, 2.1, 1.3), p(-8, 10, 0.3, 0.95), p(8.5, 11, 1.7, 1.05), p(-12, -4, 2.5, 1), p(12, -3, 0.9, 0.9)],
  rocks: [p(-3.5, 6, 0.3, 1), p(6, -2, 1.2, 0.8), p(-9.6, 8.8, 2, 1.2), p(10, 2, 0.5, 0.9), p(-2, 11, 1.1, 0.7)],
};

// 光影微調（DEV 工具「光影」分頁）
export const LIGHT_TWEAKS = {
  exposure: 1.0,
  sunMul: 1.1,
  hemiMul: 0.75,
  aoIntensity: 1.6,
  aoRadius: 0.9,
  bloomStrength: 0.35,
  bloomThreshold: 1.35,
  vignette: 0.28,
};

export type LightTweaks = typeof LIGHT_TWEAKS;

// 寵物行為微調（DEV 工具「寵物」分頁）
export const PET_TUNING = {
  followDist: 3.0, // 跟主角保持的距離（公尺）
};

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
