// Supabase 社交後端（docs/08、docs/10）：只用 fetch，不加 npm 套件
//
// 使用方式：
//   const backend = createSupabaseBackend(); // 沒設定 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 時回傳 null → 改用本機模擬
//   createSupabaseBackend() 會先呼叫 SupabaseBackend.consumeAuthRedirect()，把魔法連結帶回來的 #access_token 存起來
//
// 時間：伺服器時間與遊戲時鐘（core/clock，DEV 可快轉）可能不同。每次 RPC 回傳的 now 會用來估算時差 skew，
//       送出前「遊戲時間 → 伺服器時間」加 skew，收到後「伺服器時間 → 遊戲時間」減 skew。
//
// 作物成長：伺服器只存每塊田的 mature_at（成熟時間）。
//   - 發佈（publishFarm）：用與 systems/farm.ts Farm.progress() 相同的公式（濕 ×1、乾 ×0.6、夜間花只在 19–05 點長），
//     以二分搜尋找出 progress 到達 1 的時間當 matureAt。
//   - 拜訪（getFarm）：反過來組出 PlotSave：snapAt＝現在、wetUntil＝伺服器記錄的濕潤時間（保留乾／濕顯示），
//     再解出 p0 讓 Farm.progress() 剛好在 matureAt 到達 1：p0 = 1 − 有效成長毫秒(現在→matureAt) ÷ 總成長毫秒。
//     已成熟就 p0 = 1。p0 會夾在 [0, 1)，資料不一致時（例如好友剛幫忙澆水）只會讓畫面上的成熟時間稍微偏移。
import { SPECIES, type Species } from '../actors/pet';
import { DEFAULT_LOOK, type Look } from '../actors/player';
import { clock } from '../core/clock';
import { CROP_BY_ID, type CropDef } from '../data/crops';
import { FIELD_COUNT, nightMs } from '../systems/farm';
import type { PlotSave, WeedSave } from '../systems/state';
import type {
  ActionResult, CloudUser, FarmSnapshot, FriendSummary, SocialAction, SocialBackend, SocialLogEntry,
} from './types';

export const AUTH_KEY = 'happyFarm.auth';
const DRY_RATE = 0.6; // 與 systems/farm.ts 的 DRY_RATE 一致（乾田成長速度）
const STEAL_YIELD = 10; // 發佈給伺服器的「偷菜計算用產量」：最多被偷 floor(10 × 20%) = 2 個
const TIMEOUT_MS = 15000;
const WEED_KINDS: WeedSave['kind'][] = ['sprout', 'bush', 'big', 'dandelion', 'leaves', 'snow'];
const LOG_KINDS: SocialLogEntry['kind'][] = ['steal', 'caught', 'help_weed', 'help_water', 'prank', 'gift', 'visit'];

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // 毫秒（真實時間 Date.now()，不是遊戲時鐘）
  user: CloudUser;
}

export type AuthRedirectResult = { ok: true; user: CloudUser } | { ok: false; error: string };

// 發佈快照可以多帶的欄位（FarmSnapshot 沒有，但伺服器會用來做異常偵測／偷菜開關）
export interface PublishExtras { xp?: number; coins?: number; allowSteal?: boolean }

export interface PushPrefs { cropReady: boolean; missYou: boolean; stolen: boolean; helped: boolean }

// ---------- 伺服器回傳的資料形狀（見 supabase/migrations/20261001000000_init.sql） ----------
interface MeRow { id: string; name: string; friendCode: string; now: number }
interface FriendRow {
  id: string; name: string; level: number; species: string; petName: string;
  look: Partial<Look> | null; lastSeen: number | null; canSteal: number; needsHelp: number;
}
interface PlotRow {
  idx: number; owned: boolean; tilled: boolean; cropId: string | null; matureAt: number | null;
  wetUntil: number | null; fert: boolean; giantOf: number | null; yield: number; stolen: number;
}
interface WeedRow {
  id: string; tx: number; tz: number; ox: number; oz: number; kind: string;
  pulls: number; zone: string; bornAt: number | null; placedBy: string | null; placedByName: string | null;
}
interface FarmRow {
  id: string; name: string; look: Partial<Look> | null; level: number; houseTier: number; comfort: number;
  pet: { species?: string; name?: string; stage?: number; bond?: number } | null;
  decor: unknown; allowSteal: boolean; plots: PlotRow[]; weeds: WeedRow[];
  stolenByMe: number[]; helpedToday: number; now: number;
}
interface InboxRow {
  id: number; at_ms: number; actor_id: string; actor_name: string; kind: string;
  n: number; item: string | null; plot: number | null;
}
interface ActRow { ok: boolean; msg: string; caught?: boolean; items?: Record<string, number>; hearts?: number; xp?: number }
interface AddFriendRow { ok: boolean; msg: string; friendId?: string; notFound?: boolean }

// ---------- 小工具 ----------
const hasCjk = (s: string) => /[㐀-鿿]/.test(s);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function toSpecies(s: unknown): Species {
  return typeof s === 'string' && s in SPECIES ? (s as Species) : 'corgi';
}

function toLook(l: Partial<Look> | null | undefined): Look {
  return { ...DEFAULT_LOOK, ...(l && typeof l === 'object' ? l : {}) };
}

// JWT payload（只拿 sub / email / exp，不驗簽：驗簽是伺服器的事）
function decodeJwt(token: string): { sub?: string; email?: string; exp?: number } {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    return s && s.accessToken && s.refreshToken && s.user?.id ? s : null;
  } catch {
    return null;
  }
}

function saveSession(s: AuthSession | null): void {
  try {
    if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
    else localStorage.removeItem(AUTH_KEY);
  } catch { /* 無痕模式或容量滿：只保留在記憶體 */ }
}

// GoTrue 回傳的 token 回應 → session
function sessionFromToken(body: Record<string, unknown>): AuthSession {
  const accessToken = String(body.access_token ?? '');
  const refreshToken = String(body.refresh_token ?? '');
  if (!accessToken || !refreshToken) throw new Error('登入回應缺少 token');
  const claims = decodeJwt(accessToken);
  const user = (body.user ?? {}) as { id?: string; email?: string };
  const expiresAt = body.expires_at ? Number(body.expires_at) * 1000
    : body.expires_in ? Date.now() + Number(body.expires_in) * 1000
      : claims.exp ? claims.exp * 1000 : Date.now() + 3600_000;
  const id = user.id ?? claims.sub ?? '';
  if (!id) throw new Error('登入回應缺少使用者 id');
  return { accessToken, refreshToken, expiresAt, user: { id, email: user.email ?? claims.email ?? '' } };
}

// ---------- 作物成長（與 systems/farm.ts Farm.progress 相同公式） ----------
function effectiveMs(def: CropDef, from: number, to: number, wetUntil: number): number {
  if (to <= from) return 0;
  const span = def.night ? nightMs(from, to) : to - from;
  const wetEnd = Math.min(to, wetUntil);
  const wet = def.night ? nightMs(from, wetEnd) : Math.max(0, wetEnd - from);
  return wet + (span - wet) * DRY_RATE;
}

function progressAt(p: PlotSave, def: CropDef, t: number): number {
  return Math.min(1, p.p0 + effectiveMs(def, p.snapAt, t, p.wetUntil) / (def.minutes * 60000));
}

// 這塊田在（遊戲時間）什麼時候成熟；沒種東西回 null
export function matureAtOf(p: PlotSave, now: number): number | null {
  const def = p.cropId ? CROP_BY_ID[p.cropId] : undefined;
  if (!def) return null;
  let lo: number, hi: number;
  if (progressAt(p, def, now) >= 1) {
    // 已成熟：在 [snapAt, now] 找第一次到 1 的時間
    if (p.p0 >= 1) return p.snapAt;
    lo = p.snapAt; hi = now;
  } else {
    // 還沒熟：上限＝全部以乾田速度、夜間花只有 10/24 的時間在長，再多留 2 天
    const remain = (1 - progressAt(p, def, now)) * def.minutes * 60000;
    lo = now;
    hi = now + (remain / DRY_RATE) * (def.night ? 2.4 : 1) + (def.night ? 2 * 86400000 : 0) + 1000;
  }
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    if (progressAt(p, def, mid) >= 1) hi = mid; else lo = mid;
  }
  return Math.ceil(hi);
}

// 伺服器的田 → PlotSave（全部是遊戲時間）
export function plotFromServer(r: PlotRow | undefined, now: number, toLocal: (t: number) => number): PlotSave {
  const empty: PlotSave = { owned: false, tilled: false, cropId: null, p0: 0, snapAt: now, wetUntil: 0, fert: false };
  if (!r) return empty;
  const wetUntil = r.wetUntil != null ? toLocal(r.wetUntil) : 0;
  const p: PlotSave = { owned: !!r.owned, tilled: !!r.tilled, cropId: null, p0: 0, snapAt: now, wetUntil, fert: !!r.fert };
  if (r.giantOf != null) p.giantOf = r.giantOf;
  const def = r.cropId ? CROP_BY_ID[r.cropId] : undefined;
  if (!def || r.matureAt == null) return p; // 不認得的作物（版本不同）當空田
  p.cropId = def.id;
  const matureAt = toLocal(r.matureAt);
  if (now >= matureAt) { p.p0 = 1; return p; }
  const eff = effectiveMs(def, now, matureAt, wetUntil);
  p.p0 = clamp(1 - eff / (def.minutes * 60000) + 1e-9, 0, 0.999999);
  return p;
}

// ---------- 主類別 ----------
export class SupabaseBackend implements SocialBackend {
  readonly mode = 'supabase' as const;
  static lastRedirect: AuthRedirectResult | null = null;

  private readonly url: string;
  private readonly anonKey: string;
  private session: AuthSession | null = loadSession();
  private refreshing: Promise<AuthSession | null> | null = null;
  private code = '';
  private skew = 0; // 伺服器時間 − 遊戲時鐘（ms）
  private mePromise: Promise<void> | null = null;
  private seenLog = new Set<number>(); // inbox 已回傳過的 id

  constructor(url: string, anonKey: string, private redirectTo = SupabaseBackend.defaultRedirect()) {
    if (!/^https?:\/\//.test(url)) throw new Error('Supabase 網址格式不對（應該是 https://xxxx.supabase.co）');
    if (!anonKey) throw new Error('缺少 Supabase anon key');
    this.url = url.replace(/\/+$/, '');
    this.anonKey = anonKey;
    // 其他分頁登入／登出時同步
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === AUTH_KEY) { this.session = loadSession(); this.code = ''; }
      });
    }
    if (this.session) void this.ready().catch(() => { /* 離線時先略過，之後再試 */ });
  }

  static defaultRedirect(): string {
    return typeof location === 'undefined' ? '' : location.origin + location.pathname;
  }

  // 處理魔法連結回來的網址：#access_token=...&refresh_token=...&expires_in=...
  // 成功就存進 localStorage 並把 hash 從網址列清掉。沒有登入資訊回傳 null。
  static consumeAuthRedirect(): AuthRedirectResult | null {
    if (typeof location === 'undefined' || !location.hash || location.hash.length < 2) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const hasToken = params.has('access_token');
    const hasError = params.has('error') || params.has('error_description');
    if (!hasToken && !hasError) return null;
    let result: AuthRedirectResult;
    if (hasError) {
      const desc = params.get('error_description') ?? params.get('error') ?? '';
      const code = params.get('error_code') ?? '';
      result = { ok: false, error: code === 'otp_expired' || /expired/i.test(desc) ? '登入連結已過期，請重新寄一次' : `登入失敗：${desc}` };
    } else {
      try {
        const s = sessionFromToken(Object.fromEntries(params.entries()));
        saveSession(s);
        result = { ok: true, user: s.user };
      } catch (e) {
        result = { ok: false, error: (e as Error).message };
      }
    }
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* 忽略 */ }
    SupabaseBackend.lastRedirect = result;
    return result;
  }

  // ---------- 時間換算 ----------
  private syncClock(serverNow: unknown, sentAt: number): void {
    const s = num(serverNow, NaN);
    if (!Number.isFinite(s)) return;
    this.skew = s - (sentAt + clock.now()) / 2; // 取請求來回的中點
  }
  private toServer(t: number): number { return Math.round(t + this.skew); }
  private toLocal(t: number): number { return Math.round(t - this.skew); }

  // ---------- HTTP ----------
  private headers(token: string | null, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { apikey: this.anonKey, 'Content-Type': 'application/json', ...extra };
    // 有登入就帶使用者 JWT；沒登入時：舊版 anon key（JWT）放 Authorization，新版 sb_publishable_ key 只放 apikey
    if (token) h.Authorization = `Bearer ${token}`;
    else if (this.anonKey.startsWith('eyJ')) h.Authorization = `Bearer ${this.anonKey}`;
    return h;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(this.url + path, { ...init, signal: ctrl.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('伺服器回應逾時，請稍後再試');
      throw new Error('連不上伺服器，請檢查網路連線');
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorOf(res: Response): Promise<Error> {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* 不是 JSON */ }
    const raw = String(body.message ?? body.msg ?? body.error_description ?? body.error ?? '');
    const code = String(body.code ?? body.error_code ?? '');
    if (raw && hasCjk(raw)) return new Error(raw); // SQL 裡 raise 的中文訊息直接顯示
    if (res.status === 401 || code === 'PGRST301' || code === 'PGRST303') return new Error('登入已過期，請重新登入');
    if (res.status === 429 || code === 'over_email_send_rate_limit') return new Error('操作太頻繁了，請稍等一下再試');
    if (code === 'PGRST202' || code === '42883' || code === '42P01') return new Error('伺服器還沒建立資料表或函式（請先執行 supabase migration）');
    if (res.status === 403) return new Error('沒有權限做這件事');
    if (res.status >= 500) return new Error(`伺服器錯誤（${res.status}），請稍後再試`);
    return new Error(`請求失敗（${res.status}）${raw ? `：${raw}` : ''}`);
  }

  // 取得有效的 access token（快過期就先 refresh）
  private async token(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expiresAt - 60_000 > Date.now()) return s.accessToken;
    const fresh = await this.refresh();
    return fresh?.accessToken ?? null;
  }

  private refresh(): Promise<AuthSession | null> {
    if (this.refreshing) return this.refreshing;
    const s = this.session;
    if (!s) return Promise.resolve(null);
    this.refreshing = (async () => {
      try {
        const res = await this.request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: this.headers(null), body: JSON.stringify({ refresh_token: s.refreshToken }),
        });
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          // refresh token 失效（被撤銷、已用過、太久沒登入）→ 登出
          this.setSession(null);
          return null;
        }
        if (!res.ok) throw await this.errorOf(res);
        const next = sessionFromToken(await res.json());
        this.setSession(next);
        return next;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private setSession(s: AuthSession | null): void {
    this.session = s;
    saveSession(s);
    if (!s) { this.code = ''; this.mePromise = null; }
  }

  // 呼叫 RPC：POST /rest/v1/rpc/<fn>；JWT 過期時自動 refresh 重試一次
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    let token = await this.token();
    if (!token) throw new Error('請先登入雲端帳號');
    for (let attempt = 0; ; attempt++) {
      const res = await this.request(`/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: this.headers(token), body: JSON.stringify(args),
      });
      if (res.status === 401 && attempt === 0) {
        const s = await this.refresh();
        if (!s) throw new Error('登入已過期，請重新登入');
        token = s.accessToken;
        continue;
      }
      if (!res.ok) throw await this.errorOf(res);
      if (res.status === 204) return null as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    }
  }

  // ---------- 帳號 ----------
  user(): CloudUser | null {
    return this.session?.user ?? null;
  }

  // 登入後取好友碼、校正時間（重複呼叫會共用同一個請求）
  ready(): Promise<void> {
    if (!this.session) return Promise.resolve();
    if (!this.mePromise) {
      const sentAt = clock.now();
      this.mePromise = this.rpc<MeRow>('me').then((r) => {
        this.code = r?.friendCode ?? '';
        this.syncClock(r?.now, sentAt);
      }).catch((e) => { this.mePromise = null; throw e; });
    }
    return this.mePromise;
  }

  // 寄魔法連結到信箱；使用者點信中連結會回到 redirectTo，網址帶 #access_token
  async signIn(email: string): Promise<void> {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Email 格式不對');
    const q = this.redirectTo ? `?redirect_to=${encodeURIComponent(this.redirectTo)}` : '';
    const res = await this.request(`/auth/v1/otp${q}`, {
      method: 'POST', headers: this.headers(null), body: JSON.stringify({ email: e, create_user: true }),
    });
    if (!res.ok) throw await this.errorOf(res);
  }

  async signOut(): Promise<void> {
    const token = this.session?.accessToken;
    this.setSession(null);
    if (!token) return;
    try {
      await this.request('/auth/v1/logout?scope=local', { method: 'POST', headers: this.headers(token) });
    } catch { /* 本機已登出，伺服器那邊失敗也沒關係 */ }
  }

  // ---------- 雲端存檔 ----------
  async uploadSave(json: string): Promise<void> {
    let data: unknown;
    try { data = JSON.parse(json); } catch { throw new Error('存檔格式錯誤，無法上傳'); }
    if (!data || typeof data !== 'object') throw new Error('存檔格式錯誤，無法上傳');
    const sentAt = clock.now();
    const r = await this.rpc<{ ok: boolean; now: number }>('upload_save', { data });
    this.syncClock(r?.now, sentAt);
  }

  async downloadSave(): Promise<string | null> {
    const r = await this.rpc<{ save: unknown; updatedAt: number } | null>('download_save');
    return r?.save ? JSON.stringify(r.save) : null;
  }

  // ---------- 好友 ----------
  myCode(): string {
    if (!this.code && this.session) void this.ready().catch(() => { /* 之後再試 */ });
    return this.code;
  }

  async listFriends(): Promise<FriendSummary[]> {
    const rows = await this.rpc<FriendRow[] | null>('list_friends');
    return (rows ?? []).map((r) => this.friendFromRow(r));
  }

  private friendFromRow(r: FriendRow): FriendSummary {
    return {
      id: r.id,
      name: r.name || '農夫',
      level: num(r.level, 1),
      species: toSpecies(r.species),
      petName: r.petName || SPECIES[toSpecies(r.species)].name,
      look: toLook(r.look),
      canSteal: num(r.canSteal),
      needsHelp: num(r.needsHelp),
      lastSeen: r.lastSeen != null ? this.toLocal(r.lastSeen) : 0,
      isNpc: false,
    };
  }

  // 找不到好友碼回傳 null；其他失敗（自己的碼、好友已滿…）丟出中文錯誤
  async addFriend(code: string): Promise<FriendSummary | null> {
    const r = await this.rpc<AddFriendRow>('add_friend', { code });
    if (!r?.ok) {
      if (r?.notFound) return null;
      throw new Error(r?.msg || '加好友失敗');
    }
    const list = await this.listFriends();
    return list.find((f) => f.id === r.friendId) ?? null;
  }

  async removeFriend(id: string): Promise<void> {
    await this.rpc<null>('remove_friend', { target: id });
  }

  // ---------- 拜訪 ----------
  async getFarm(id: string): Promise<FarmSnapshot> {
    const sentAt = clock.now();
    const r = await this.rpc<FarmRow>('get_farm', { target: id });
    if (!r) throw new Error('找不到這座農場');
    this.syncClock(r.now, sentAt);
    const now = clock.now();
    const byIdx = new Map((r.plots ?? []).map((p) => [p.idx, p]));
    // 只有田區 30 格（溫室 idx ≥ FIELD_COUNT 不同步，所以成長倍率一律 ×1）
    const plots = Array.from({ length: FIELD_COUNT }, (_, i) => plotFromServer(byIdx.get(i), now, (t) => this.toLocal(t)));
    const matureAt = Array.from({ length: FIELD_COUNT }, (_, i) => {
      const m = byIdx.get(i)?.matureAt;
      return plots[i].cropId && m != null ? this.toLocal(m) : 0;
    });
    const stolen: Record<number, number> = {};
    for (const p of r.plots ?? []) if (p.stolen > 0) stolen[p.idx] = p.stolen;
    const species = toSpecies(r.pet?.species);
    return {
      id: r.id,
      name: r.name || '農夫',
      level: num(r.level, 1),
      look: toLook(r.look),
      houseTier: num(r.houseTier, 1),
      comfort: num(r.comfort),
      pet: { species, name: r.pet?.name || SPECIES[species].name, stage: num(r.pet?.stage), bond: num(r.pet?.bond) },
      plots,
      weeds: (r.weeds ?? []).map((w) => this.weedFromRow(w, now)),
      decor: Array.isArray(r.decor) ? r.decor.filter((d): d is string => typeof d === 'string') : [],
      stolen,
      stolenByMe: Array.isArray(r.stolenByMe) ? r.stolenByMe : [],
      helpedToday: num(r.helpedToday),
      now,
      matureAt,
    };
  }

  private weedFromRow(w: WeedRow, now: number): WeedSave {
    const kind = (WEED_KINDS as string[]).includes(w.kind) ? (w.kind as WeedSave['kind']) : 'sprout';
    const out: WeedSave = {
      id: w.id, tx: num(w.tx), tz: num(w.tz), ox: num(w.ox), oz: num(w.oz), kind,
      bornAt: w.bornAt != null ? this.toLocal(w.bornAt) : now, pulls: num(w.pulls, 1), zone: w.zone ?? '',
    };
    // 好友放的惡作劇草：by＝放草的人（顯示名稱；自己放的顯示「你」，與 local.ts 相同慣例）
    if (w.placedBy) out.by = w.placedBy === this.session?.user.id ? '你' : w.placedByName || '好友';
    return out;
  }

  // ---------- 社交動作 ----------
  async act(id: string, a: SocialAction): Promise<ActionResult> {
    let r: ActRow;
    switch (a.kind) {
      case 'steal': r = await this.rpc<ActRow>('steal_crop', { target: id, plot: a.plot }); break;
      case 'weed': r = await this.rpc<ActRow>('help_weed', { target: id, weed_id: a.weedId }); break;
      case 'water': r = await this.rpc<ActRow>('help_water', { target: id, plot: a.plot }); break;
      case 'prank': r = await this.rpc<ActRow>('prank_weed', { target: id, tx: Math.round(a.tx), tz: Math.round(a.tz) }); break;
      case 'gift': r = await this.rpc<ActRow>('send_gift', { target: id, item: a.item }); break;
      default: throw new Error('不支援的動作');
    }
    if (!r) throw new Error('伺服器沒有回應結果');
    const out: ActionResult = { ok: !!r.ok, msg: r.msg ?? '' };
    if (r.caught) out.caught = true;
    if (r.items && typeof r.items === 'object') out.items = r.items;
    if (typeof r.hearts === 'number') out.hearts = r.hearts;
    if (typeof r.xp === 'number') out.xp = r.xp;
    return out;
  }

  // 好友對我做了什麼（since：遊戲時間毫秒；回傳舊到新）
  // 伺服器一次最多回 200 筆，滿 200 就帶 after_id＝最後一筆的 id 繼續拿（最多 5 頁）；另外用 id 去重，避免時差校正後重複
  async inbox(since: number): Promise<SocialLogEntry[]> {
    const PAGE = 200;
    let rows: InboxRow[] = [];
    // +1 ms：伺服器的 at_ms 是無條件捨去到毫秒，since 傳回最後一筆的 at 時不會再拿到同一筆
    const args: Record<string, unknown> = since > 0 ? { since: new Date(this.toServer(since) + 1).toISOString() } : {};
    for (let page = 0; page < 5; page++) {
      const part = await this.rpc<InboxRow[] | null>('inbox', args) ?? [];
      rows = rows.concat(part);
      if (part.length < PAGE) break;
      args.after_id = part[part.length - 1].id;
    }
    const out: SocialLogEntry[] = [];
    for (const r of rows) {
      if (this.seenLog.has(r.id)) continue;
      this.seenLog.add(r.id);
      if (!(LOG_KINDS as string[]).includes(r.kind)) continue;
      const e: SocialLogEntry = {
        id: String(r.id), at: this.toLocal(r.at_ms), actorId: r.actor_id, actorName: r.actor_name || '好友',
        kind: r.kind as SocialLogEntry['kind'], n: num(r.n),
      };
      if (r.item != null) e.item = r.item;
      if (r.plot != null) e.plot = r.plot;
      out.push(e);
    }
    // 去重表只留最近 1000 筆
    if (this.seenLog.size > 1000) this.seenLog = new Set([...this.seenLog].slice(-500));
    return out;
  }

  // ---------- 發佈自己的農場 ----------
  // snap.now 與 plots 裡的時間都是遊戲時間；matureAt 在這裡用 Farm.progress 的完整公式重算（不用 snap.matureAt 的估計值），
  // 再換成伺服器時間。只同步田區 30 格（溫室不同步）。
  async publishFarm(snap: Omit<FarmSnapshot, 'stolenByMe' | 'helpedToday'> & PublishExtras): Promise<void> {
    const now = snap.now || clock.now();
    const plots = snap.plots.slice(0, FIELD_COUNT).map((p, idx) => {
      const def = p.cropId ? CROP_BY_ID[p.cropId] : undefined;
      const mature = def ? matureAtOf(p, now) : null;
      return {
        idx,
        owned: p.owned,
        tilled: p.tilled,
        cropId: def ? def.id : null,
        matureAt: mature != null ? this.toServer(mature) : null,
        wetUntil: p.wetUntil > 0 ? this.toServer(p.wetUntil) : null,
        fert: p.fert,
        giantOf: p.giantOf ?? null,
        yield: def && !def.giant ? STEAL_YIELD : 0, // 巨型作物不能偷
      };
    });
    const weeds = snap.weeds.map((w) => ({
      id: w.id, tx: w.tx, tz: w.tz, ox: w.ox, oz: w.oz, kind: w.kind, pulls: w.pulls, zone: w.zone,
      bornAt: this.toServer(w.bornAt),
    }));
    const snapshot: Record<string, unknown> = {
      name: snap.name,
      look: snap.look,
      level: snap.level,
      houseTier: snap.houseTier,
      comfort: snap.comfort,
      pet: snap.pet,
      decor: snap.decor,
      plots,
      weeds,
    };
    if (snap.xp !== undefined) snapshot.xp = snap.xp;
    if (snap.coins !== undefined) snapshot.coins = snap.coins;
    if (snap.allowSteal !== undefined) snapshot.allowSteal = snap.allowSteal;
    const sentAt = clock.now();
    const r = await this.rpc<{ ok: boolean; now: number }>('publish_farm', { snapshot });
    this.syncClock(r?.now, sentAt);
  }

  // ---------- Web Push 訂閱（需要 service worker，見 docs/10 §8） ----------
  async savePushSubscription(sub: PushSubscriptionJSON, prefs: Partial<PushPrefs> = {}): Promise<void> {
    const token = await this.token();
    if (!token) throw new Error('請先登入雲端帳號');
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('推播訂閱資料不完整');
    const body = {
      endpoint: sub.endpoint,
      user_id: this.session!.user.id,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      prefs: { cropReady: true, missYou: true, stolen: false, helped: false, ...prefs },
      updated_at: new Date().toISOString(),
    };
    const res = await this.request('/rest/v1/push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: this.headers(token, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.errorOf(res);
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    const token = await this.token();
    if (!token) return;
    const res = await this.request(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE', headers: this.headers(token, { Prefer: 'return=minimal' }),
    });
    if (!res.ok) throw await this.errorOf(res);
  }
}

// 讀 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY；沒設定就回傳 null（遊戲改用本機模擬的鄰居）
export function createSupabaseBackend(): SupabaseBackend | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || !key) return null;
  SupabaseBackend.consumeAuthRedirect();
  try {
    return new SupabaseBackend(url, key);
  } catch (e) {
    console.warn('[supabase] 設定錯誤，改用本機模式：', (e as Error).message);
    return null;
  }
}
