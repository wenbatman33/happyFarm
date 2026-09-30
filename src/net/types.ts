// 社交後端介面（docs/08）：Phase 1 用本機模擬的鄰居（local.ts），之後換成 Supabase（supabase.ts），遊戲邏輯不用改
import type { Species } from '../actors/pet';
import type { Look } from '../actors/player';
import type { PlotSave, WeedSave } from '../systems/state';

export interface FriendSummary {
  id: string;
  name: string;
  level: number;
  species: Species;
  petName: string;
  look: Look;
  canSteal: number; // 有幾塊成熟、過了保護期、還能偷的田
  needsHelp: number; // 有幾株草／幾塊乾田可以幫忙
  lastSeen: number;
  isNpc: boolean;
}

// 拜訪時看到的農場（只含拜訪需要的欄位）
export interface FarmSnapshot {
  id: string;
  name: string;
  level: number;
  look: Look;
  houseTier: number;
  comfort: number;
  pet: { species: Species; name: string; stage: number; bond: number };
  plots: PlotSave[]; // 田區 30 格（與 SaveData.plots 前 30 格相同格式）
  weeds: WeedSave[];
  decor: string[];
  stolen: Record<number, number>; // 每塊田已被偷走的數量
  stolenByMe: number[]; // 我今天在這座農場偷過的田
  helpedToday: number; // 我今天幫這位好友的次數
  now: number; // 取得快照的時間
  matureAt?: number[]; // 每塊田成熟的時間（判斷偷菜保護期）
}

export type SocialAction =
  | { kind: 'weed'; weedId: string }
  | { kind: 'water'; plot: number }
  | { kind: 'steal'; plot: number }
  | { kind: 'prank'; tx: number; tz: number }
  | { kind: 'gift'; item: string };

export interface ActionResult {
  ok: boolean;
  msg: string;
  caught?: boolean; // 偷菜被看門寵物抓到
  items?: Record<string, number>;
  hearts?: number;
  xp?: number;
}

// 好友對我做了什麼（回到自己農場時顯示）
export interface SocialLogEntry {
  id: string;
  at: number;
  actorId: string;
  actorName: string;
  kind: 'steal' | 'caught' | 'help_weed' | 'help_water' | 'prank' | 'gift' | 'visit';
  n: number;
  item?: string;
  plot?: number;
}

// 發佈自己的農場：多帶 xp、coins（異常偵測）與 allowSteal（設定裡關掉偷菜）
export type PublishSnapshot = Omit<FarmSnapshot, 'stolenByMe' | 'helpedToday'> & { xp?: number; coins?: number; allowSteal?: boolean };

export interface CloudUser { id: string; email: string }

export interface SocialBackend {
  readonly mode: 'local' | 'supabase';
  myCode(): string;
  listFriends(): Promise<FriendSummary[]>;
  addFriend(code: string): Promise<FriendSummary | null>;
  removeFriend(id: string): Promise<void>;
  getFarm(id: string): Promise<FarmSnapshot>;
  act(id: string, a: SocialAction): Promise<ActionResult>;
  inbox(since: number): Promise<SocialLogEntry[]>;
  // 雲端存檔（只有 Supabase 模式有）
  user?(): CloudUser | null;
  signIn?(email: string): Promise<void>;
  signOut?(): Promise<void>;
  uploadSave?(json: string): Promise<void>;
  downloadSave?(): Promise<string | null>;
  // 把自己的農場狀態同步到伺服器（讓好友看得到、能偷能幫）
  publishFarm?(snap: PublishSnapshot): Promise<void>;
}

// 規則常數（docs/08 §4）
export const SOCIAL_RULES = {
  helpPerFriendDaily: 5,
  helpTotalDaily: 30,
  stealProtectMs: 30 * 60000,
  stealMaxShare: 0.2,
  stealDaily: 20,
  prankDaily: 3,
  giftPerFriendDaily: 1,
  catchChance: { corgi: 0.3, cat: 0.25, bunny: 0.2, duck: 0.22 } as Record<Species, number>,
};
