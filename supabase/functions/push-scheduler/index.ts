// 推播排程（docs/08 §6）— Supabase Edge Function（Deno）
//
// 由 pg_cron 每 15 分鐘呼叫一次（排程 SQL 見 docs/10 §7）。規則：
//   - 每人每天（台北時間）最多 2 則
//   - 22:00–08:00（台北時間）不推；晚上成熟的作物會在早上 8 點後補推
//   - 預設只推：作物成熟、寵物想你（3 天沒上線）；被偷菜／好友幫忙預設關閉，玩家自己在 prefs 打開
//   - 同一個人一次執行最多推 1 則（多台裝置都會收到，但只算 1 則）
//
// 環境變數（`supabase secrets set KEY=value`）：
//   SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY  平台自動注入
//   VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY       `npx web-push generate-vapid-keys` 產生
//   VAPID_SUBJECT                              例：mailto:you@example.com
//   CRON_SECRET                                pg_cron 呼叫時放在 x-cron-secret 標頭
//   APP_URL                                    點通知要開的網址（預設 GitHub Pages）
//
// 測試：GET/POST ...?dry=1 只回傳「會推什麼」不真的送出（沒設 CRON_SECRET 時也允許）；
//       dry 模式可加 &now=2026-10-01T09:00:00%2B08:00 模擬時間。

const TZ_OFFSET_MS = 8 * 3600_000; // 台北固定 UTC+8（沒有日光節約時間）
const DAILY_MAX = 2;
const QUIET_START = 22;
const QUIET_END = 8;
const MISS_YOU_MS = 3 * 86400_000;
const CROP_LOOKBACK_MS = 12 * 3600_000; // 只看 12 小時內成熟的作物（避免很久以前的舊田一直推）
const SOCIAL_LOOKBACK_MS = 12 * 3600_000;
const CHUNK = 80; // PostgREST in.(...) 一次帶幾個 id

type Kind = 'crop_ready' | 'miss_you' | 'stolen' | 'helped';

interface Prefs { cropReady: boolean; missYou: boolean; stolen: boolean; helped: boolean }
const DEFAULT_PREFS: Prefs = { cropReady: true, missYou: true, stolen: false, helped: false };
const PREF_OF: Record<Kind, keyof Prefs> = { crop_ready: 'cropReady', miss_you: 'missYou', stolen: 'stolen', helped: 'helped' };

interface SubRow { endpoint: string; user_id: string; keys: { p256dh: string; auth: string }; prefs: Partial<Prefs> | null }
interface PushLogRow { user_id: string; kind: Kind; sent_at: string }
interface PlotRow { user_id: string; crop_id: string | null; mature_at: string | null }
interface ProfileRow { id: string; name: string; last_seen: string }
interface FarmRow { user_id: string; pet: { species?: string; name?: string } | null }
interface SocialRow { actor: string; target: string; kind: string; n: number; created_at: string }

export interface Notice {
  userId: string;
  kind: Kind;
  endpoints: SubRow[];
  payload: { title: string; body: string; tag: string; url: string };
}

// ---------- 時間 ----------
export function taipeiHour(now: number): number {
  return new Date(now + TZ_OFFSET_MS).getUTCHours();
}
export function taipeiDayStart(now: number): number {
  const d = new Date(now + TZ_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - TZ_OFFSET_MS;
}
export function isQuietHours(now: number): boolean {
  const h = taipeiHour(now);
  return h >= QUIET_START || h < QUIET_END;
}
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);

// ---------- 排程邏輯（純函式，方便測試） ----------
export interface PlanInput {
  subs: SubRow[];
  logs: PushLogRow[]; // 近 4 天的推播紀錄
  plots: PlotRow[];
  profiles: ProfileRow[];
  farms: FarmRow[];
  social: SocialRow[];
  actorNames: Record<string, string>;
  appUrl: string;
}

export function planNotices(input: PlanInput, now: number): Notice[] {
  if (isQuietHours(now)) return [];
  const dayStart = taipeiDayStart(now);
  const byUser = new Map<string, SubRow[]>();
  for (const s of input.subs) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }
  const profileOf = new Map(input.profiles.map((p) => [p.id, p]));
  const petOf = new Map(input.farms.map((f) => [f.user_id, f.pet ?? {}]));
  const out: Notice[] = [];

  for (const [userId, subs] of byUser) {
    const logs = input.logs.filter((l) => l.user_id === userId);
    // 每日上限
    if (logs.filter((l) => ms(l.sent_at) >= dayStart).length >= DAILY_MAX) continue;
    const lastSent = (k: Kind) => Math.max(0, ...logs.filter((l) => l.kind === k).map((l) => ms(l.sent_at)));
    const lastSeen = ms(profileOf.get(userId)?.last_seen);
    const pet = petOf.get(userId) ?? {};
    const petName = pet.name || '寵物';
    // 這一種通知要推給哪些裝置（prefs 以裝置為單位）
    const devices = (k: Kind) => subs.filter((s) => ({ ...DEFAULT_PREFS, ...(s.prefs ?? {}) })[PREF_OF[k]]);
    const make = (kind: Kind, title: string, body: string): Notice | null => {
      const endpoints = devices(kind);
      return endpoints.length ? { userId, kind, endpoints, payload: { title, body, tag: `happyfarm-${kind}`, url: input.appUrl } } : null;
    };

    const candidates: (() => Notice | null)[] = [
      // 1. 作物成熟：有新成熟的作物，且成熟後玩家還沒上線過、也還沒推過
      () => {
        const matured = input.plots
          .filter((p) => p.user_id === userId && p.crop_id && p.mature_at)
          .map((p) => ms(p.mature_at))
          .filter((t) => t <= now && t > now - CROP_LOOKBACK_MS);
        if (!matured.length) return null;
        const latest = Math.max(...matured);
        if (latest <= Math.max(lastSent('crop_ready'), lastSeen)) return null;
        return make('crop_ready', '🌾 作物成熟了！', `田裡有 ${matured.length} 塊作物可以收成，${petName}在田邊等你喔`);
      },
      // 2. 被偷菜／抓到小偷（預設關閉）
      () => {
        const since = Math.max(lastSent('stolen'), lastSeen, now - SOCIAL_LOOKBACK_MS);
        const rows = input.social.filter((s) => s.target === userId && (s.kind === 'steal' || s.kind === 'caught') && ms(s.created_at) > since);
        if (!rows.length) return null;
        const r = rows[rows.length - 1];
        const who = input.actorNames[r.actor] || '好友';
        return r.kind === 'caught'
          ? make('stolen', '🐾 抓到小偷了！', `${petName}發現${who}鬼鬼祟祟想偷菜，把他趕跑了`)
          : make('stolen', '🥬 有人來偷菜', `${who}偷偷摸走了 ${r.n} 個作物…${petName}好像在睡午覺`);
      },
      // 3. 好友幫忙（預設關閉）
      () => {
        const since = Math.max(lastSent('helped'), lastSeen, now - SOCIAL_LOOKBACK_MS);
        const rows = input.social.filter((s) => s.target === userId && ['help_weed', 'help_water', 'gift'].includes(s.kind) && ms(s.created_at) > since);
        if (!rows.length) return null;
        const who = input.actorNames[rows[rows.length - 1].actor] || '好友';
        return make('helped', '💛 好友來幫忙了', rows.length > 1 ? `${who}等好友幫你做了 ${rows.length} 件事` : `${who}來幫你的農場幫忙了`);
      },
      // 4. 寵物想你：3 天沒上線，而且這次離開後還沒推過
      () => {
        if (!lastSeen || now - lastSeen < MISS_YOU_MS) return null;
        if (lastSent('miss_you') > lastSeen) return null;
        const days = Math.floor((now - lastSeen) / 86400_000);
        return make('miss_you', `🐾 ${petName}想你了`, `已經 ${days} 天沒見到你了，${petName}一直在門口等你回來`);
      },
    ];

    for (const c of candidates) {
      const n = c();
      if (n) { out.push(n); break; } // 一次最多 1 則
    }
  }
  return out;
}

// ---------- PostgREST（service role） ----------
function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`缺少環境變數 ${name}`);
  return v;
}

function restHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  // 舊版 service_role 金鑰是 JWT，要放 Authorization；新版 sb_secret_ 金鑰只放 apikey
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${env('SUPABASE_URL')}/rest/v1/${path}`;
  const res = await fetch(url, { ...init, headers: { ...restHeaders(env('SUPABASE_SERVICE_ROLE_KEY')), ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new Error(`PostgREST ${res.status} ${path.split('?')[0]}：${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function restIn<T>(table: string, select: string, col: string, ids: string[], extra = ''): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    out.push(...(await rest<T[]>(`${table}?select=${select}&${col}=in.(${part.join(',')})${extra}`)));
  }
  return out;
}

async function loadInput(now: number): Promise<PlanInput> {
  const subs = await rest<SubRow[]>('push_subscriptions?select=endpoint,user_id,keys,prefs');
  const ids = [...new Set(subs.map((s) => s.user_id))];
  if (!ids.length) return { subs, logs: [], plots: [], profiles: [], farms: [], social: [], actorNames: {}, appUrl: '' };
  const iso = (t: number) => encodeURIComponent(new Date(t).toISOString());
  const [logs, plots, profiles, farms, social] = await Promise.all([
    restIn<PushLogRow>('push_log', 'user_id,kind,sent_at', 'user_id', ids, `&sent_at=gte.${iso(now - 4 * 86400_000)}`),
    restIn<PlotRow>('farm_plots', 'user_id,crop_id,mature_at', 'user_id', ids,
      `&crop_id=not.is.null&mature_at=lte.${iso(now)}&mature_at=gt.${iso(now - CROP_LOOKBACK_MS)}`),
    restIn<ProfileRow>('profiles', 'id,name,last_seen', 'id', ids),
    restIn<FarmRow>('farms', 'user_id,pet', 'user_id', ids),
    restIn<SocialRow>('social_log', 'actor,target,kind,n,created_at', 'target', ids,
      `&created_at=gt.${iso(now - SOCIAL_LOOKBACK_MS)}&kind=in.(steal,caught,help_weed,help_water,gift)&order=created_at.asc`),
  ]);
  const actorIds = [...new Set(social.map((s) => s.actor))];
  const actors = actorIds.length ? await restIn<ProfileRow>('profiles', 'id,name,last_seen', 'id', actorIds) : [];
  const actorNames = Object.fromEntries(actors.map((a) => [a.id, a.name]));
  return { subs, logs, plots, profiles, farms, social, actorNames, appUrl: '' };
}

// ---------- Web Push 發送 ----------
interface WebPushLib {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts?: { TTL?: number; urgency?: string; topic?: string }): Promise<{ statusCode: number }>;
}

let webpushLib: WebPushLib | null = null;
async function loadWebPush(): Promise<WebPushLib> {
  if (webpushLib) return webpushLib;
  // TODO(VAPID)：npm:web-push 依賴 Node 的 crypto／https。已在 Deno CLI 2.7 驗證可產生 VAPID 簽章與加密內容，
  //   但「Supabase Edge Runtime 上實際送出」尚未實測。若失敗，改用 Deno 原生的 jsr:@negrel/webpush（需改寫 send() 這段）。
  const mod = await import('npm:web-push@3.6.7');
  const lib = ((mod as { default?: unknown }).default ?? mod) as WebPushLib;
  lib.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  webpushLib = lib;
  return lib;
}

async function send(n: Notice): Promise<{ ok: number; gone: string[]; failed: number }> {
  const lib = await loadWebPush();
  let ok = 0, failed = 0;
  const gone: string[] = [];
  for (const s of n.endpoints) {
    try {
      await lib.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(n.payload), { TTL: 6 * 3600, urgency: 'normal', topic: n.kind.replace('_', '') });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint); // 訂閱已失效
      else { failed++; console.error('推播失敗', code, (e as Error).message); }
    }
  }
  return { ok, gone, failed };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

// ---------- 入口 ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.has('dry');
  const secret = Deno.env.get('CRON_SECRET');
  if (secret) {
    if (req.headers.get('x-cron-secret') !== secret) return json({ ok: false, error: '未授權' }, 401);
  } else if (!dry) {
    return json({ ok: false, error: '尚未設定 CRON_SECRET，只允許 ?dry=1' }, 500);
  }

  const nowParam = dry ? url.searchParams.get('now') : null;
  const now = nowParam && !Number.isNaN(Date.parse(nowParam)) ? Date.parse(nowParam) : Date.now();
  if (isQuietHours(now)) return json({ ok: true, quiet: true, taipeiHour: taipeiHour(now), sent: 0 });

  try {
    const input = await loadInput(now);
    input.appUrl = Deno.env.get('APP_URL') ?? 'https://wenbatman33.github.io/happyFarm/';
    const plan = planNotices(input, now);
    if (dry) {
      return json({ ok: true, dry: true, planned: plan.map((n) => ({ userId: n.userId, kind: n.kind, devices: n.endpoints.length, payload: n.payload })) });
    }

    let sent = 0, failed = 0;
    const gone: string[] = [];
    const logRows: { user_id: string; kind: Kind }[] = [];
    for (const n of plan) {
      const r = await send(n);
      failed += r.failed;
      gone.push(...r.gone);
      if (r.ok > 0) { sent++; logRows.push({ user_id: n.userId, kind: n.kind }); }
    }
    if (logRows.length) await rest('push_log', { method: 'POST', body: JSON.stringify(logRows), headers: { Prefer: 'return=minimal' } });
    for (const endpoint of gone) {
      await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    return json({ ok: true, planned: plan.length, sent, failed, removed: gone.length });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
