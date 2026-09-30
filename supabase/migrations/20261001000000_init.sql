-- =============================================================================
-- 開心農場 Phase 2：初始資料庫（docs/08 §3–§6、部署步驟見 docs/10）
--
-- 設計原則
--   1. 伺服器權威：偷菜、幫忙、惡作劇、送禮、加好友全部走 SECURITY DEFINER 的 RPC，
--      客戶端「不能」直接寫別人的資料列，也不能直接寫自己的 farms / farm_plots / farm_weeds
--      （只能透過 publish_farm / upload_save，方便伺服器抽查與異常偵測）。
--   2. RLS 全開：自己可讀自己的資料；好友可讀彼此的 profiles / farms / farm_plots / farm_weeds；
--      social_log 只有動作者與被動作者看得到。
--   3. 作物成長公式（濕／乾分段積分、夜間花）很難在 SQL 重算，所以由客戶端在快照裡附上
--      每塊田的 mature_at（成熟時間，毫秒 epoch）；伺服器只用它驗證偷菜：now() >= mature_at + 30 分鐘。
--   4. 每日次數限制用 social_log 計數，日界線是「台北時間 00:00」。
--   5. 規則常數與 src/net/types.ts 的 SOCIAL_RULES 一致（見 private.rules()）；改一邊就要改另一邊。
--
-- 對外 RPC（PostgREST：POST /rest/v1/rpc/<name>）
--   me()                                 取得／建立自己的 profile，回傳好友碼與伺服器時間
--   add_friend(code)                     用好友碼加好友（立即成為好友）
--   remove_friend(target)                刪除好友
--   list_friends()                       好友列表＋可偷／可幫忙數量
--   get_farm(target)                     拜訪農場快照（順便記一筆 visit）
--   steal_crop(target, plot)             偷菜
--   help_weed(target, weed_id)           幫忙拔草
--   help_water(target, plot)             幫忙澆水
--   prank_weed(target, tx, tz)           惡作劇：放草
--   send_gift(target, item)              送禮
--   publish_farm(snapshot)               發佈自己的農場快照
--   upload_save(data) / download_save()  雲端存檔
--   inbox(since, after_id)               好友對我做了什麼（after_id 用來分頁）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 私有 schema：放內部 helper，不透過 PostgREST 對外（config.toml 只開放 public）
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- 規則常數（與 src/net/types.ts 的 SOCIAL_RULES 保持一致）
create or replace function private.rules()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'helpPerFriendDaily', 5,
    'helpTotalDaily', 30,
    'stealProtectMinutes', 30,
    'stealMaxShare', 0.2,
    'stealDaily', 20,
    'prankDaily', 3,
    'giftPerFriendDaily', 1,
    'friendMax', 100,
    'catchChance', jsonb_build_object('corgi', 0.3, 'cat', 0.25, 'bunny', 0.2, 'duck', 0.22)
  )
$$;

-- 台北時間「今天 00:00」（回傳 timestamptz）。
-- 注意：不能直接拿 created_at 跟 date_trunc('day', now() at time zone 'Asia/Taipei') 比，
-- 後者是不帶時區的 timestamp，會被當成 session 時區（UTC）解讀而差 8 小時，所以要再轉回 timestamptz。
create or replace function private.day_start(p_at timestamptz default now())
returns timestamptz
language sql stable
set search_path = ''
as $$
  select date_trunc('day', p_at at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'
$$;

-- timestamptz ↔ 毫秒 epoch（前端 Date.now() 的單位）
create or replace function private.ms(p timestamptz)
returns bigint
language sql stable
set search_path = ''
as $$
  select floor(extract(epoch from p) * 1000)::bigint
$$;

create or replace function private.from_ms(p numeric)
returns timestamptz
language sql immutable
set search_path = ''
as $$
  -- 只接受 1970～2100 之間的值，避免 to_timestamp 超出範圍報錯
  select case when p is null or p < 0 or p > 4102444800000 then null else to_timestamp(p / 1000.0) end
$$;

-- 讀 jsonb 數字欄位（型別不對就回 null）
create or replace function private.jnum(p jsonb, p_key text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p -> p_key) = 'number' then (p ->> p_key)::numeric end
$$;

create or replace function private.jbool(p jsonb, p_key text, p_default boolean)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p -> p_key) = 'boolean' then (p ->> p_key)::boolean else p_default end
$$;

-- 夾在範圍內；p_val 為 null 時回傳預設值（注意 greatest/least 會忽略 null，所以要先判斷）
create or replace function private.clampi(p_val numeric, p_lo numeric, p_hi numeric, p_default numeric)
returns bigint
language sql immutable
set search_path = ''
as $$
  select case when p_val is null then p_default::bigint else least(greatest(round(p_val), p_lo), p_hi)::bigint end
$$;

-- 動作結果（對應 src/net/types.ts 的 ActionResult）
create or replace function private.res(p_ok boolean, p_msg text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', p_ok, 'msg', p_msg) || coalesce(p_extra, '{}'::jsonb)
$$;

-- 必須登入
create or replace function private.require_uid()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception '請先登入' using errcode = '42501';
  end if;
  return v;
end
$$;

-- 好友碼：6 碼，去掉容易看錯的 I、O、0、1
create or replace function private.new_friend_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles p where p.friend_code = v_code);
  end loop;
  return v_code;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. 資料表
-- -----------------------------------------------------------------------------

-- 玩家（docs/08 §5 的 users）
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 24),
  look        jsonb not null default '{}'::jsonb check (jsonb_typeof(look) = 'object' and pg_column_size(look) < 4096),
  friend_code text not null unique default private.new_friend_code(),
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- 農場總表（等級、金幣、房屋、寵物、雲端存檔）
create table public.farms (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  level           int not null default 1 check (level between 1 and 999),
  xp              bigint not null default 0 check (xp >= 0),
  coins           bigint not null default 0,
  house_tier      int not null default 1 check (house_tier between 1 and 20),
  comfort         int not null default 0,
  pet             jsonb not null default '{"species":"corgi","name":"麻糬","stage":0,"bond":0}'::jsonb,
  decor           jsonb not null default '[]'::jsonb check (jsonb_typeof(decor) = 'array'),
  allow_steal     boolean not null default true, -- docs/08 §4.4：偷菜可在設定關閉
  save            jsonb,                          -- 完整存檔（只有本人能透過 download_save 讀）
  schema_version  int not null default 1,
  save_updated_at timestamptz,
  inbox_read_at   timestamptz,                    -- 最後一次讀 inbox 的時間（保護還沒同步的惡作劇草）
  updated_at      timestamptz not null default now(),
  -- 異常偵測（docs/08 §3）：每小時金幣、XP 超過合理上限 3 倍 → 標記審查
  flagged         boolean not null default false,
  flag_reason     text,
  check_at        timestamptz, -- 檢查點
  check_xp        bigint,      -- 檢查點當下的累積 XP
  check_coins     bigint       -- 檢查點當下的金幣
);

-- 田（固定 30 格；客戶端每次 publish_farm 覆蓋）
create table public.farm_plots (
  user_id    uuid not null references public.farms (user_id) on delete cascade,
  idx        int not null check (idx between 0 and 29),
  owned      boolean not null default false,
  tilled     boolean not null default false,
  crop_id    text check (crop_id is null or crop_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  mature_at  timestamptz,          -- 客戶端算好的成熟時間
  wet_until  timestamptz,          -- 濕潤到何時（null／過去＝乾田，好友可以幫忙澆水）
  fert       boolean not null default false,
  giant_of   int check (giant_of is null or giant_of between 0 and 29),
  yield      int not null default 10 check (yield between 0 and 1000), -- 偷菜計算用產量
  stolen     int not null default 0 check (stolen >= 0),               -- 這一批作物已被偷走幾個
  watered_by uuid references public.profiles (id) on delete set null,  -- 最後一位幫忙澆水的好友
  watered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, idx)
);
create index farm_plots_mature_idx on public.farm_plots (mature_at) where crop_id is not null;

-- 雜草（含好友放的惡作劇草：placed_by 不為 null）
create table public.farm_weeds (
  user_id   uuid not null references public.farms (user_id) on delete cascade,
  id        text not null check (char_length(id) between 1 and 40),
  tx        int not null check (tx between -200 and 200),
  tz        int not null check (tz between -200 and 200),
  ox        real not null default 0,
  oz        real not null default 0,
  kind      text not null default 'sprout' check (kind in ('sprout', 'bush', 'big', 'dandelion', 'leaves', 'snow')),
  pulls     int not null default 1 check (pulls between 0 and 10),
  zone      text not null default '' check (char_length(zone) <= 24),
  born_at   timestamptz not null default now(),
  placed_by uuid references public.profiles (id) on delete set null,
  primary key (user_id, id)
);

-- 好友關係：一對好友只存一列（user_a < user_b）
create table public.friendships (
  user_a       uuid not null references public.profiles (id) on delete cascade,
  user_b       uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'accepted' check (status in ('pending', 'accepted', 'blocked')),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);

-- 社交紀錄（也是每日次數限制的計數來源）
create table public.social_log (
  id         bigint generated always as identity primary key,
  actor      uuid not null references public.profiles (id) on delete cascade,
  target     uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('steal', 'caught', 'help_weed', 'help_water', 'prank', 'gift', 'visit')),
  n          int not null default 1 check (n between 0 and 1000),
  item       text check (item is null or char_length(item) <= 64),
  plot       int check (plot is null or plot between 0 and 29),
  created_at timestamptz not null default now()
);
create index social_log_actor_idx on public.social_log (actor, created_at desc);
create index social_log_target_idx on public.social_log (target, created_at desc);

-- Web Push 訂閱（一個裝置一列）
create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://'),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  keys       jsonb not null check (keys ? 'p256dh' and keys ? 'auth'),
  prefs      jsonb not null default '{"cropReady":true,"missYou":true,"stolen":false,"helped":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 推播紀錄（每日 2 則上限的計數來源；只有 service_role 讀寫）
create table public.push_log (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind    text not null check (kind in ('crop_ready', 'miss_you', 'stolen', 'helped')),
  sent_at timestamptz not null default now()
);
create index push_log_user_idx on public.push_log (user_id, sent_at desc);

-- 異常偵測紀錄（只有 service_role／後台看）
create table public.farm_flags (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reason     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index farm_flags_user_idx on public.farm_flags (user_id, created_at desc);

-- 簡易節流（加好友嘗試次數，防止暴力猜好友碼）
create table private.rate_events (
  user_id    uuid not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index rate_events_idx on private.rate_events (user_id, kind, created_at);

-- -----------------------------------------------------------------------------
-- 2. 好友判斷、每日次數 helper
-- -----------------------------------------------------------------------------
create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b) and f.status = 'accepted'
  )
$$;

-- RLS 用：目前登入者跟 p_other 是不是好友（只能問「自己」的關係，不會洩漏別人的好友名單）
create or replace function private.is_friend(p_other uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.are_friends(auth.uid(), p_other)
$$;

-- 每日次數：actor 今天（台北時間）做了幾次 p_kinds；可再限定對象、田
create or replace function private.daily_count(p_actor uuid, p_kinds text[], p_target uuid default null, p_plot int default null)
returns int
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int
  from public.social_log sl
  where sl.actor = p_actor
    and sl.kind = any (p_kinds)
    and (p_target is null or sl.target = p_target)
    and (p_plot is null or sl.plot = p_plot)
    and sl.created_at >= private.day_start()
$$;

-- 幫忙次數上限：每位好友每天 5 次、每天總共 30 次；沒超過回 null
create or replace function private.help_limit(p_me uuid, p_target uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_rules jsonb := private.rules();
begin
  if private.daily_count(p_me, array['help_weed', 'help_water'], p_target) >= (v_rules ->> 'helpPerFriendDaily')::int then
    return format('今天已經幫這位好友 %s 次了，明天再來吧', v_rules ->> 'helpPerFriendDaily');
  end if;
  if private.daily_count(p_me, array['help_weed', 'help_water']) >= (v_rules ->> 'helpTotalDaily')::int then
    return format('今天已經幫忙 %s 次了，休息一下吧', v_rules ->> 'helpTotalDaily');
  end if;
  return null;
end
$$;

-- 可以當禮物的東西（伺服器看不到對方背包，扣庫存由客戶端負責，所以只開放便宜的東西）
create or replace function private.giftable(p_item text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_item in ('fert', 'hay', 'wood', 'stone', 'weed', 'leaf', 'dandelion', 'milk')
    or p_item ~ '^seed:[a-z0-9_]{1,24}$', false)
$$;

-- 確保 profile / farm 存在（觸發器之前就註冊的帳號也能用）
create or replace function private.ensure_me(p_uid uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (p_uid) on conflict (id) do nothing;
  insert into public.farms (user_id) values (p_uid) on conflict (user_id) do nothing;
end
$$;

-- 新註冊帳號：自動建立 profile 與 farm
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', ''), 24))
  on conflict (id) do nothing;
  insert into public.farms (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. 異常偵測（docs/08 §3）：每小時 XP／金幣超過合理上限 3 倍 → flagged＋farm_flags
-- -----------------------------------------------------------------------------

-- 累積 XP（與 src/data/economy.ts 的 xpNext 一致：ceil(300 + 42 × level^1.72)）
create or replace function private.total_xp(p_level int, p_xp bigint)
returns bigint
language sql immutable
set search_path = ''
as $$
  select coalesce((
    select sum(ceil(300 + 42 * power(l::numeric, 1.72)))::bigint
    from generate_series(1, greatest(coalesce(p_level, 1), 1) - 1) as l
  ), 0) + coalesce(p_xp, 0)
$$;

-- 每小時「合理上限」（可調）：
--   XP：一般玩家一天 XP（dailyXp＝2400×(1+0.055×level)）的一半；新手期（Lv6 前 XP×5）再乘 5
--   金幣：600 + 120 × level
create or replace function private.hourly_caps(p_level int, out xp_cap numeric, out coin_cap numeric)
language sql immutable
set search_path = ''
as $$
  select 2400 * (1 + 0.055 * p_level) * 0.5 * (case when p_level < 6 then 5 else 1 end),
         600 + 120 * p_level::numeric
$$;

create or replace function private.farms_anomaly_check()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total bigint := private.total_xp(new.level, new.xp);
  v_hours numeric;
  v_xp_rate numeric;
  v_coin_rate numeric;
  v_caps record;
begin
  -- 建立基準點、不做檢查的情況：
  --   新建的 farm（還是預設值）、還沒上傳過存檔（XP／金幣未知）、第一次上傳存檔（單機存檔綁定雲端，數值一次跳上來是正常的）
  if tg_op = 'INSERT' then
    new.check_at := now();
    new.check_xp := v_total;
    new.check_coins := new.coins;
    return new;
  end if;
  if new.check_at is null or old.save_updated_at is null or new.save_updated_at is null then
    new.check_at := now();
    new.check_xp := v_total;
    new.check_coins := new.coins;
    return new;
  end if;
  -- 不到一小時也當一小時算（短時間暴增一樣會被抓到）
  v_hours := greatest(extract(epoch from (now() - new.check_at)) / 3600.0, 1.0);
  v_xp_rate := (v_total - coalesce(new.check_xp, v_total)) / v_hours;
  v_coin_rate := (new.coins - coalesce(new.check_coins, new.coins)) / v_hours;
  select * into v_caps from private.hourly_caps(new.level);
  if v_xp_rate > 3 * v_caps.xp_cap or v_coin_rate > 3 * v_caps.coin_cap then
    new.flagged := true;
    new.flag_reason := format('每小時 XP %s（上限 %s）、金幣 %s（上限 %s）',
      round(v_xp_rate), round(v_caps.xp_cap), round(v_coin_rate), round(v_caps.coin_cap));
    insert into public.farm_flags (user_id, reason, detail)
    values (new.user_id, 'hourly_rate', jsonb_build_object(
      'xpPerHour', round(v_xp_rate), 'coinsPerHour', round(v_coin_rate),
      'xpCap', round(v_caps.xp_cap), 'coinCap', round(v_caps.coin_cap),
      'hours', round(v_hours, 2), 'level', new.level));
    new.check_at := now();
    new.check_xp := v_total;
    new.check_coins := new.coins;
  elsif now() - new.check_at >= interval '1 hour' then
    -- 滿一小時就移動檢查點
    new.check_at := now();
    new.check_xp := v_total;
    new.check_coins := new.coins;
  end if;
  return new;
end
$$;

create trigger farms_anomaly
  before insert or update of level, xp, coins on public.farms
  for each row execute function private.farms_anomaly_check();

-- -----------------------------------------------------------------------------
-- 4. RLS 與權限
--    Supabase 預設會把 public 的表 GRANT ALL 給 anon / authenticated，這裡先全部收回再逐一開放。
--    service_role 保留預設權限（且繞過 RLS），給 Edge Function 用。
-- -----------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.farms              enable row level security;
alter table public.farm_plots         enable row level security;
alter table public.farm_weeds         enable row level security;
alter table public.friendships        enable row level security;
alter table public.social_log         enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_log           enable row level security;
alter table public.farm_flags         enable row level security;

revoke all on public.profiles, public.farms, public.farm_plots, public.farm_weeds, public.friendships,
  public.social_log, public.push_subscriptions, public.push_log, public.farm_flags
  from anon, authenticated;
revoke all on private.rate_events from public, anon, authenticated;

-- profiles：自己與好友可讀；只能改自己的暱稱與外觀（好友碼、id 不能改）
grant select on public.profiles to authenticated;
grant update (name, look) on public.profiles to authenticated;
create policy "profiles_select_self_or_friend" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_friend(id));
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- farms：自己與好友可讀，但 save（完整存檔）與異常偵測欄位不開放（欄位權限），
-- 本人讀存檔請用 download_save()。寫入一律走 RPC。
-- 注意：因為有欄位權限，REST 查 farms 不能用 select=*，要明確列出欄位。
grant select (user_id, level, xp, coins, house_tier, comfort, pet, decor, allow_steal, schema_version, updated_at)
  on public.farms to authenticated;
create policy "farms_select_self_or_friend" on public.farms
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_friend(user_id));

-- farm_plots / farm_weeds：自己與好友可讀；寫入只能透過 RPC
grant select on public.farm_plots to authenticated;
create policy "farm_plots_select_self_or_friend" on public.farm_plots
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_friend(user_id));

grant select on public.farm_weeds to authenticated;
create policy "farm_weeds_select_self_or_friend" on public.farm_weeds
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_friend(user_id));

-- friendships：只看得到自己參與的；新增／刪除走 add_friend / remove_friend
grant select on public.friendships to authenticated;
create policy "friendships_select_party" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- social_log：動作者與被動作者可讀；寫入只能透過 RPC
grant select on public.social_log to authenticated;
create policy "social_log_select_party" on public.social_log
  for select to authenticated
  using (actor = (select auth.uid()) or target = (select auth.uid()));

-- push_subscriptions：只能管理自己的訂閱
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- push_log、farm_flags：沒有任何 policy → 一般使用者完全讀寫不到（service_role 繞過 RLS）

-- -----------------------------------------------------------------------------
-- 5. RPC：帳號、好友
-- -----------------------------------------------------------------------------

-- 登入後第一個呼叫：確保資料存在、更新上線時間、回傳好友碼與伺服器時間
create or replace function public.me()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_p public.profiles%rowtype;
begin
  perform private.ensure_me(v_me);
  update public.profiles p set last_seen = now() where p.id = v_me returning * into v_p;
  return jsonb_build_object('id', v_p.id, 'name', v_p.name, 'friendCode', v_p.friend_code, 'now', private.ms(now()));
end
$$;

-- 用好友碼加好友：知道好友碼就視為同意，立即成為好友（開心農場的玩法）
create or replace function public.add_friend(code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_rules jsonb := private.rules();
  v_code text := upper(regexp_replace(coalesce(add_friend.code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_max int := (v_rules ->> 'friendMax')::int;
  v_other uuid;
begin
  perform private.ensure_me(v_me);
  perform pg_advisory_xact_lock(hashtextextended('friend:' || v_me::text, 0));

  -- 節流：每小時最多嘗試 30 次
  delete from private.rate_events r where r.user_id = v_me and r.created_at < now() - interval '1 day';
  if (select count(*) from private.rate_events r
      where r.user_id = v_me and r.kind = 'add_friend' and r.created_at > now() - interval '1 hour') >= 30 then
    return private.res(false, '嘗試太多次了，休息一下再加好友吧');
  end if;
  insert into private.rate_events (user_id, kind) values (v_me, 'add_friend');

  if length(v_code) <> 6 then
    return private.res(false, '好友碼是 6 碼英文數字喔');
  end if;
  select p.id into v_other from public.profiles p where p.friend_code = v_code;
  if v_other is null then
    return private.res(false, '找不到這個好友碼', '{"notFound": true}'::jsonb);
  end if;
  if v_other = v_me then
    return private.res(false, '這是你自己的好友碼喔');
  end if;
  if exists (select 1 from public.friendships f
             where f.user_a = least(v_me, v_other) and f.user_b = greatest(v_me, v_other) and f.status = 'blocked') then
    return private.res(false, '無法加這位好友');
  end if;
  if private.are_friends(v_me, v_other) then
    return private.res(true, '你們已經是好友了', jsonb_build_object('friendId', v_other));
  end if;
  if (select count(*) from public.friendships f where v_me in (f.user_a, f.user_b)) >= v_max then
    return private.res(false, format('好友已經 %s 人了（上限）', v_max));
  end if;
  if (select count(*) from public.friendships f where v_other in (f.user_a, f.user_b)) >= v_max then
    return private.res(false, '對方的好友已經滿了');
  end if;

  insert into public.friendships (user_a, user_b, status, requested_by)
  values (least(v_me, v_other), greatest(v_me, v_other), 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted';
  return private.res(true, '加好友成功！', jsonb_build_object('friendId', v_other));
end
$$;

create or replace function public.remove_friend(target uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := remove_friend.target;
begin
  delete from public.friendships f
  where f.user_a = least(v_me, v_t) and f.user_b = greatest(v_me, v_t) and f.status <> 'blocked';
end
$$;

-- 好友列表（對應 FriendSummary；isNpc 由客戶端補 false）
create or replace function public.list_friends()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_rules jsonb := private.rules();
  v_day timestamptz := private.day_start();
  v_protect interval := make_interval(mins => (v_rules ->> 'stealProtectMinutes')::int);
  v_share numeric := (v_rules ->> 'stealMaxShare')::numeric;
  v_help_full boolean := private.daily_count(v_me, array['help_weed', 'help_water']) >= (v_rules ->> 'helpTotalDaily')::int;
  v_out jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.last_seen desc), '[]'::jsonb)
  into v_out
  from (
    select p.last_seen, jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'level', coalesce(f.level, 1),
      'species', coalesce(f.pet ->> 'species', 'corgi'),
      'petName', coalesce(f.pet ->> 'name', ''),
      'look', p.look,
      'lastSeen', private.ms(p.last_seen),
      -- 成熟、過了保護期、還沒被偷到上限、我今天還沒偷過
      'canSteal', case when coalesce(f.allow_steal, true) then (
        select count(*) from public.farm_plots fp
        where fp.user_id = p.id
          and fp.crop_id is not null and fp.mature_at is not null
          and fp.mature_at + v_protect <= now()
          and fp.stolen < floor(fp.yield * v_share)
          and not exists (
            select 1 from public.social_log sl
            where sl.actor = v_me and sl.target = p.id and sl.plot = fp.idx
              and sl.kind in ('steal', 'caught') and sl.created_at >= v_day)
      ) else 0 end,
      -- 可幫忙：草（不含我自己放的）＋還沒熟的乾田；今天已達上限就顯示 0
      'needsHelp', case
        when v_help_full
          or private.daily_count(v_me, array['help_weed', 'help_water'], p.id) >= (v_rules ->> 'helpPerFriendDaily')::int
        then 0
        else (select count(*) from public.farm_weeds w where w.user_id = p.id and w.placed_by is distinct from v_me)
           + (select count(*) from public.farm_plots fp
              where fp.user_id = p.id and fp.crop_id is not null and fp.mature_at > now()
                and (fp.wet_until is null or fp.wet_until <= now()))
      end
    ) as j
    from public.friendships fr
    join public.profiles p on p.id = case when fr.user_a = v_me then fr.user_b else fr.user_a end
    left join public.farms f on f.user_id = p.id
    where v_me in (fr.user_a, fr.user_b) and fr.status = 'accepted'
  ) x;
  return v_out;
end
$$;

-- 拜訪農場（自己或好友）。拜訪好友時每天記一筆 visit。
create or replace function public.get_farm(target uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := get_farm.target;
  v_day timestamptz := private.day_start();
  v_p public.profiles%rowtype;
  v_f public.farms%rowtype;
  v_plots jsonb;
  v_weeds jsonb;
  v_stolen_by_me jsonb;
begin
  if v_t is null or (v_t <> v_me and not private.are_friends(v_me, v_t)) then
    raise exception '你們還不是好友，不能拜訪' using errcode = '42501';
  end if;
  select * into v_p from public.profiles p where p.id = v_t;
  if not found then
    raise exception '找不到這座農場' using errcode = 'P0002';
  end if;
  select * into v_f from public.farms f where f.user_id = v_t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'idx', fp.idx, 'owned', fp.owned, 'tilled', fp.tilled, 'cropId', fp.crop_id,
      'matureAt', private.ms(fp.mature_at), 'wetUntil', private.ms(fp.wet_until),
      'fert', fp.fert, 'giantOf', fp.giant_of, 'yield', fp.yield, 'stolen', fp.stolen
    ) order by fp.idx), '[]'::jsonb)
  into v_plots
  from public.farm_plots fp where fp.user_id = v_t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'tx', w.tx, 'tz', w.tz, 'ox', w.ox, 'oz', w.oz, 'kind', w.kind,
      'pulls', w.pulls, 'zone', w.zone, 'bornAt', private.ms(w.born_at),
      'placedBy', w.placed_by, 'placedByName', pb.name
    )), '[]'::jsonb)
  into v_weeds
  from public.farm_weeds w
  left join public.profiles pb on pb.id = w.placed_by
  where w.user_id = v_t;

  select coalesce(jsonb_agg(distinct sl.plot), '[]'::jsonb)
  into v_stolen_by_me
  from public.social_log sl
  where sl.actor = v_me and sl.target = v_t and sl.kind in ('steal', 'caught')
    and sl.plot is not null and sl.created_at >= v_day;

  if v_t <> v_me and not exists (
    select 1 from public.social_log sl
    where sl.actor = v_me and sl.target = v_t and sl.kind = 'visit' and sl.created_at >= v_day
  ) then
    insert into public.social_log (actor, target, kind, n) values (v_me, v_t, 'visit', 1);
  end if;

  return jsonb_build_object(
    'id', v_p.id,
    'name', v_p.name,
    'look', v_p.look,
    'level', coalesce(v_f.level, 1),
    'houseTier', coalesce(v_f.house_tier, 1),
    'comfort', coalesce(v_f.comfort, 0),
    'pet', coalesce(v_f.pet, '{}'::jsonb),
    'decor', coalesce(v_f.decor, '[]'::jsonb),
    'allowSteal', coalesce(v_f.allow_steal, true),
    'plots', v_plots,
    'weeds', v_weeds,
    'stolenByMe', v_stolen_by_me,
    'helpedToday', private.daily_count(v_me, array['help_weed', 'help_water'], v_t),
    'now', private.ms(now())
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 6. RPC：社交動作（全部回傳 ActionResult 形狀的 jsonb：{ok, msg, caught?, items?, hearts?, xp?}）
-- -----------------------------------------------------------------------------

-- 偷菜（docs/08 §4.4）
create or replace function public.steal_crop(target uuid, plot int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := steal_crop.target;
  v_idx int := steal_crop.plot;
  v_rules jsonb := private.rules();
  v_protect interval := make_interval(mins => (v_rules ->> 'stealProtectMinutes')::int);
  v_farm public.farms%rowtype;
  v_row public.farm_plots%rowtype;
  v_cap int;
  v_n int;
  v_chance numeric;
  v_pet_name text;
begin
  if v_t = v_me then
    return private.res(false, '這是你自己的田啦 😆');
  end if;
  -- 同一個人的動作排隊處理，避免同時送出繞過每日上限
  perform pg_advisory_xact_lock(hashtextextended('act:' || v_me::text, 0));
  if v_t is null or not private.are_friends(v_me, v_t) then
    return private.res(false, '你們還不是好友');
  end if;
  if v_idx is null or v_idx < 0 or v_idx > 29 then
    return private.res(false, '沒有這塊田');
  end if;
  if private.daily_count(v_me, array['steal', 'caught']) >= (v_rules ->> 'stealDaily')::int then
    return private.res(false, format('今天已經偷 %s 次了，良心會痛的 😇', v_rules ->> 'stealDaily'));
  end if;

  select * into v_farm from public.farms f where f.user_id = v_t;
  if not found then
    return private.res(false, '找不到這座農場');
  end if;
  if not v_farm.allow_steal then
    return private.res(false, '對方關閉了偷菜功能');
  end if;

  -- 鎖住這塊田：多位好友同時偷時依序處理，被偷數量不會超過上限
  select * into v_row from public.farm_plots fp where fp.user_id = v_t and fp.idx = v_idx for update;
  if not found or v_row.crop_id is null or v_row.mature_at is null then
    return private.res(false, '這塊田沒有可以偷的作物');
  end if;
  if now() < v_row.mature_at then
    return private.res(false, '作物還沒成熟');
  end if;
  if now() < v_row.mature_at + v_protect then
    return private.res(false, format('剛成熟的作物有保護期，再等 %s 分鐘',
      ceil(extract(epoch from (v_row.mature_at + v_protect - now())) / 60)));
  end if;
  if private.daily_count(v_me, array['steal', 'caught'], v_t, v_idx) > 0 then
    return private.res(false, '今天已經偷過這塊田了');
  end if;
  v_cap := floor(v_row.yield * (v_rules ->> 'stealMaxShare')::numeric);
  if v_row.stolen >= v_cap then
    return private.res(false, '這塊田已經被偷光了（主人至少要留 80%）');
  end if;

  -- 看門寵物（docs/02 §2）：依物種有 20–30% 機率被抓到
  v_chance := coalesce((v_rules -> 'catchChance' ->> coalesce(v_farm.pet ->> 'species', 'corgi'))::numeric, 0.25);
  v_pet_name := coalesce(nullif(v_farm.pet ->> 'name', ''), '看門寵物');
  if random() < v_chance then
    insert into public.social_log (actor, target, kind, n, item, plot)
    values (v_me, v_t, 'caught', 0, v_row.crop_id, v_idx);
    return private.res(false, format('被%s發現了！什麼都沒拿到，快跑～', v_pet_name),
      jsonb_build_object('caught', true));
  end if;

  -- 一次偷 1 個（30% 機率 2 個），不超過上限
  v_n := least(v_cap - v_row.stolen, case when random() < 0.3 then 2 else 1 end);
  update public.farm_plots fp set stolen = fp.stolen + v_n where fp.user_id = v_t and fp.idx = v_idx;
  insert into public.social_log (actor, target, kind, n, item, plot)
  values (v_me, v_t, 'steal', v_n, v_row.crop_id, v_idx);
  return private.res(true, format('偷偷摸走了 %s 個 🤫', v_n),
    jsonb_build_object('items', jsonb_build_object(v_row.crop_id, v_n), 'xp', 1));
end
$$;

-- 幫忙拔草：直接刪掉那株草；主人下次讀 inbox 時把草（kind 對應的物品）放進背包
create or replace function public.help_weed(target uuid, weed_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := help_weed.target;
  v_id text := help_weed.weed_id;
  v_w public.farm_weeds%rowtype;
  v_limit text;
begin
  if v_t = v_me then
    return private.res(false, '自己的草自己拔就好啦');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('act:' || v_me::text, 0));
  if v_t is null or not private.are_friends(v_me, v_t) then
    return private.res(false, '你們還不是好友');
  end if;
  select * into v_w from public.farm_weeds w where w.user_id = v_t and w.id = v_id for update;
  if not found then
    return private.res(false, '這株草已經不見了');
  end if;
  if v_w.placed_by = v_me then
    return private.res(false, '這是你放的草，留給主人拔吧 😈');
  end if;
  v_limit := private.help_limit(v_me, v_t);
  if v_limit is not null then
    return private.res(false, v_limit);
  end if;
  delete from public.farm_weeds w where w.user_id = v_t and w.id = v_id;
  -- item＝草的 id：主人客戶端據此移除本機的草；publish_farm 也用它當墓碑，避免舊快照把草寫回來
  insert into public.social_log (actor, target, kind, n, item) values (v_me, v_t, 'help_weed', 1, v_id);
  return private.res(true, '幫忙拔掉一株草！', jsonb_build_object('xp', 5, 'hearts', 1));
end
$$;

-- 幫忙澆水：只能澆還沒熟的乾田；設定 watered_by / watered_at 旗標，主人客戶端讀 inbox 後套用真正的澆水
create or replace function public.help_water(target uuid, plot int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := help_water.target;
  v_idx int := help_water.plot;
  v_row public.farm_plots%rowtype;
  v_limit text;
begin
  if v_t = v_me then
    return private.res(false, '自己的田自己澆就好啦');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('act:' || v_me::text, 0));
  if v_t is null or not private.are_friends(v_me, v_t) then
    return private.res(false, '你們還不是好友');
  end if;
  v_limit := private.help_limit(v_me, v_t);
  if v_limit is not null then
    return private.res(false, v_limit);
  end if;
  select * into v_row from public.farm_plots fp where fp.user_id = v_t and fp.idx = v_idx for update;
  if not found or v_row.crop_id is null then
    return private.res(false, '這塊田沒有種東西');
  end if;
  if v_row.mature_at is not null and v_row.mature_at <= now() then
    return private.res(false, '作物已經成熟了，不用澆水');
  end if;
  if v_row.wet_until is not null and v_row.wet_until > now() then
    return private.res(false, '土還是濕的，不用澆水');
  end if;
  -- 伺服器不知道作物的澆水時長，先標 30 分鐘濕潤（只影響好友看到的畫面）；
  -- 真正的 wetUntil 由主人客戶端 Farm.water() 算，下次 publish_farm 再覆蓋
  update public.farm_plots fp
  set wet_until = now() + interval '30 minutes', watered_by = v_me, watered_at = now()
  where fp.user_id = v_t and fp.idx = v_idx;
  insert into public.social_log (actor, target, kind, n, plot) values (v_me, v_t, 'help_water', 1, v_idx);
  return private.res(true, '幫忙澆了水 💧', jsonb_build_object('xp', 2, 'hearts', 1));
end
$$;

-- 惡作劇：在好友農場放一株草（每天 3 次）。主人拔掉時由客戶端給兩倍獎勵（docs/08 §4.5）
create or replace function public.prank_weed(target uuid, tx int, tz int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := prank_weed.target;
  v_tx int := prank_weed.tx;
  v_tz int := prank_weed.tz;
  v_rules jsonb := private.rules();
  v_kind text;
  v_id text;
begin
  if v_t = v_me then
    return private.res(false, '不能在自己家放草啦');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('act:' || v_me::text, 0));
  if v_t is null or not private.are_friends(v_me, v_t) then
    return private.res(false, '你們還不是好友');
  end if;
  if private.daily_count(v_me, array['prank']) >= (v_rules ->> 'prankDaily')::int then
    return private.res(false, format('今天的惡作劇次數用完了（每天 %s 次）', v_rules ->> 'prankDaily'));
  end if;
  -- 伺服器不知道地圖，只擋明顯不合理的座標；是否能長草由主人客戶端再檢查
  if v_tx is null or v_tz is null or abs(v_tx) > 200 or abs(v_tz) > 200 then
    return private.res(false, '這裡不能放草');
  end if;
  if not exists (select 1 from public.farms f where f.user_id = v_t) then
    return private.res(false, '找不到這座農場');
  end if;
  if exists (select 1 from public.farm_weeds w where w.user_id = v_t and w.tx = v_tx and w.tz = v_tz) then
    return private.res(false, '這裡已經有草了');
  end if;
  if (select count(*) from public.farm_weeds w where w.user_id = v_t) >= 80 then
    return private.res(false, '對方的農場已經長滿草了，饒了他吧');
  end if;

  v_kind := (array['sprout', 'bush', 'dandelion'])[1 + floor(random() * 3)::int];
  v_id := 'p' || substr(md5(random()::text || clock_timestamp()::text || v_me::text), 1, 12);
  insert into public.farm_weeds (user_id, id, tx, tz, ox, oz, kind, pulls, zone, born_at, placed_by)
  values (v_t, v_id, v_tx, v_tz, (random() - 0.5) * 0.4, (random() - 0.5) * 0.4, v_kind,
          case v_kind when 'bush' then 2 else 1 end, 'prank', now(), v_me);
  -- item＝新草的 id：主人客戶端可用 get_farm(自己) 取得完整資料
  insert into public.social_log (actor, target, kind, n, item) values (v_me, v_t, 'prank', 1, v_id);
  return private.res(true, '偷偷放了一株草 😈', jsonb_build_object('xp', 1));
end
$$;

-- 送禮：每位好友每天 1 次
create or replace function public.send_gift(target uuid, item text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_t uuid := send_gift.target;
  v_item text := lower(btrim(coalesce(send_gift.item, '')));
  v_rules jsonb := private.rules();
begin
  if v_t = v_me then
    return private.res(false, '不能送禮給自己啦');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('act:' || v_me::text, 0));
  if v_t is null or not private.are_friends(v_me, v_t) then
    return private.res(false, '你們還不是好友');
  end if;
  if not private.giftable(v_item) then
    return private.res(false, '這個東西不能當禮物送喔');
  end if;
  if private.daily_count(v_me, array['gift'], v_t) >= (v_rules ->> 'giftPerFriendDaily')::int then
    return private.res(false, '今天已經送過禮物給這位好友了');
  end if;
  insert into public.social_log (actor, target, kind, n, item) values (v_me, v_t, 'gift', 1, v_item);
  return private.res(true, '禮物送出了 🎁', jsonb_build_object('hearts', 1));
end
$$;

-- -----------------------------------------------------------------------------
-- 7. RPC：同步自己的農場、雲端存檔、收件匣
-- -----------------------------------------------------------------------------

-- 發佈自己的農場快照（格式見 src/net/supabase.ts 的 publishFarm）
--   { name, look, level, houseTier, comfort, pet:{species,name,stage,bond}, decor:[],
--     allowSteal?, xp?, coins?,
--     plots:[{idx, owned, tilled, cropId, matureAt(ms), wetUntil(ms), fert, giantOf, yield}],
--     weeds:[{id, tx, tz, ox, oz, kind, pulls, zone, bornAt(ms)}] }
-- 任何欄位缺少就保留舊值；plots / weeds 有給才整批同步。
create or replace function public.publish_farm(snapshot jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_s jsonb := publish_farm.snapshot;
  v_now timestamptz := now();
  v_plot jsonb;
  v_weed jsonb;
  v_idx int;
  v_crop text;
  v_kind text;
  v_idxs int[] := '{}';
  v_weed_ids text[] := '{}';
  v_tomb text[];
  v_read_at timestamptz;
  v_pet jsonb;
begin
  if v_s is null or jsonb_typeof(v_s) <> 'object' then
    raise exception '快照格式錯誤' using errcode = '22023';
  end if;
  if pg_column_size(v_s) > 262144 then
    raise exception '快照太大了（上限 256 KB）' using errcode = '54000';
  end if;
  perform private.ensure_me(v_me);
  perform pg_advisory_xact_lock(hashtextextended('publish:' || v_me::text, 0));

  -- profile
  update public.profiles p set
    name = coalesce(left(nullif(btrim(v_s ->> 'name'), ''), 24), p.name),
    look = case when jsonb_typeof(v_s -> 'look') = 'object' and pg_column_size(v_s -> 'look') < 4096
                then v_s -> 'look' else p.look end,
    last_seen = v_now
  where p.id = v_me;

  -- 寵物：只留拜訪需要的欄位
  if jsonb_typeof(v_s -> 'pet') = 'object' then
    v_pet := jsonb_build_object(
      'species', case when (v_s -> 'pet' ->> 'species') in ('corgi', 'cat', 'bunny', 'duck')
                      then v_s -> 'pet' ->> 'species' else 'corgi' end,
      'name', left(coalesce(v_s -> 'pet' ->> 'name', ''), 16),
      'stage', private.clampi(private.jnum(v_s -> 'pet', 'stage'), 0, 10, 0),
      'bond', private.clampi(private.jnum(v_s -> 'pet', 'bond'), 0, 1000000, 0));
  end if;

  update public.farms f set
    level      = private.clampi(private.jnum(v_s, 'level'), 1, 999, f.level),
    xp         = private.clampi(private.jnum(v_s, 'xp'), 0, 1e15, f.xp),
    coins      = private.clampi(private.jnum(v_s, 'coins'), -1e15, 1e15, f.coins),
    house_tier = private.clampi(private.jnum(v_s, 'houseTier'), 1, 20, f.house_tier),
    comfort    = private.clampi(private.jnum(v_s, 'comfort'), -1000000, 1000000, f.comfort),
    pet        = coalesce(v_pet, f.pet),
    decor      = case when jsonb_typeof(v_s -> 'decor') = 'array' and jsonb_array_length(v_s -> 'decor') <= 300
                      then v_s -> 'decor' else f.decor end,
    allow_steal = private.jbool(v_s, 'allowSteal', f.allow_steal),
    updated_at = v_now
  where f.user_id = v_me;

  -- 田
  if jsonb_typeof(v_s -> 'plots') = 'array' then
    for v_plot in select e from jsonb_array_elements(v_s -> 'plots') as t(e) limit 30 loop
      continue when jsonb_typeof(v_plot) <> 'object';
      v_idx := private.clampi(private.jnum(v_plot, 'idx'), -1, 30, -1);
      continue when v_idx < 0 or v_idx > 29 or v_idx = any (v_idxs);
      v_idxs := v_idxs || v_idx;
      v_crop := case when (v_plot ->> 'cropId') ~ '^[A-Za-z0-9_-]{1,40}$' then v_plot ->> 'cropId' end;

      insert into public.farm_plots as fp
        (user_id, idx, owned, tilled, crop_id, mature_at, wet_until, fert, giant_of, yield, stolen, updated_at)
      values (
        v_me, v_idx,
        private.jbool(v_plot, 'owned', false),
        private.jbool(v_plot, 'tilled', false),
        v_crop,
        case when v_crop is null then null else private.from_ms(private.jnum(v_plot, 'matureAt')) end,
        private.from_ms(private.jnum(v_plot, 'wetUntil')),
        private.jbool(v_plot, 'fert', false),
        private.clampi(private.jnum(v_plot, 'giantOf'), 0, 29, null),
        private.clampi(private.jnum(v_plot, 'yield'), 0, 1000, 10),
        0,
        v_now)
      on conflict (user_id, idx) do update set
        owned = excluded.owned,
        tilled = excluded.tilled,
        crop_id = excluded.crop_id,
        fert = excluded.fert,
        giant_of = excluded.giant_of,
        yield = excluded.yield,
        updated_at = excluded.updated_at,
        -- 「同一批已成熟的作物」：伺服器記錄的成熟時間與被偷數量不讓客戶端改
        --   （避免主人重新澆水／改時間躲保護期，或把被偷數量歸零）
        mature_at = case
          when fp.crop_id is not distinct from excluded.crop_id and excluded.crop_id is not null
               and fp.mature_at <= v_now and coalesce(excluded.mature_at <= v_now, true)
          then fp.mature_at else excluded.mature_at end,
        stolen = case
          when fp.crop_id is not distinct from excluded.crop_id and excluded.crop_id is not null
               and fp.mature_at <= v_now and coalesce(excluded.mature_at <= v_now, true)
          then fp.stolen else 0 end,
        -- 同一批作物：好友剛幫忙澆的水先保留（主人客戶端可能還沒讀 inbox）
        wet_until = case when fp.crop_id is not distinct from excluded.crop_id
                         then greatest(fp.wet_until, excluded.wet_until) else excluded.wet_until end,
        watered_by = case when fp.crop_id is not distinct from excluded.crop_id then fp.watered_by end,
        watered_at = case when fp.crop_id is not distinct from excluded.crop_id then fp.watered_at end;
    end loop;
    delete from public.farm_plots fp where fp.user_id = v_me and not (fp.idx = any (v_idxs));
  end if;

  -- 雜草
  if jsonb_typeof(v_s -> 'weeds') = 'array' then
    select f.inbox_read_at into v_read_at from public.farms f where f.user_id = v_me;
    -- 墓碑：7 天內好友幫忙拔掉的草，不再從（可能過時的）快照寫回
    select coalesce(array_agg(sl.item), '{}') into v_tomb
    from public.social_log sl
    where sl.target = v_me and sl.kind = 'help_weed' and sl.item is not null
      and sl.created_at > v_now - interval '7 days';

    for v_weed in select e from jsonb_array_elements(v_s -> 'weeds') as t(e) limit 300 loop
      continue when jsonb_typeof(v_weed) <> 'object';
      continue when coalesce(v_weed ->> 'id', '') = '' or char_length(v_weed ->> 'id') > 40;
      continue when (v_weed ->> 'id') = any (v_tomb) or (v_weed ->> 'id') = any (v_weed_ids);
      continue when private.jnum(v_weed, 'tx') is null or private.jnum(v_weed, 'tz') is null;
      v_weed_ids := v_weed_ids || (v_weed ->> 'id');
      v_kind := case when (v_weed ->> 'kind') in ('sprout', 'bush', 'big', 'dandelion', 'leaves', 'snow')
                     then v_weed ->> 'kind' else 'sprout' end;
      insert into public.farm_weeds as fw (user_id, id, tx, tz, ox, oz, kind, pulls, zone, born_at)
      values (
        v_me, v_weed ->> 'id',
        private.clampi(private.jnum(v_weed, 'tx'), -200, 200, 0),
        private.clampi(private.jnum(v_weed, 'tz'), -200, 200, 0),
        coalesce(least(greatest(private.jnum(v_weed, 'ox'), -1), 1), 0),
        coalesce(least(greatest(private.jnum(v_weed, 'oz'), -1), 1), 0),
        v_kind,
        private.clampi(private.jnum(v_weed, 'pulls'), 0, 10, 1),
        left(coalesce(v_weed ->> 'zone', ''), 24),
        coalesce(private.from_ms(private.jnum(v_weed, 'bornAt')), v_now))
      on conflict (user_id, id) do update set
        tx = excluded.tx, tz = excluded.tz, ox = excluded.ox, oz = excluded.oz,
        kind = excluded.kind, pulls = excluded.pulls, zone = excluded.zone, born_at = excluded.born_at;
        -- placed_by 不從客戶端覆寫
    end loop;
    -- 快照裡沒有的草就刪掉；但「主人上次讀 inbox 之後才被放的惡作劇草」先留著（主人還不知道）
    delete from public.farm_weeds fw
    where fw.user_id = v_me
      and not (fw.id = any (v_weed_ids))
      and not (fw.placed_by is not null and fw.born_at > coalesce(v_read_at, '-infinity'::timestamptz));
  end if;

  return jsonb_build_object('ok', true, 'now', private.ms(v_now));
end
$$;

-- 上傳雲端存檔（整份 SaveData JSON）。順便更新等級／XP／金幣，觸發異常偵測。
create or replace function public.upload_save(data jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_s jsonb := upload_save.data;
  v_level int;
  v_created numeric;
  v_days numeric;
begin
  if v_s is null or jsonb_typeof(v_s) <> 'object' then
    raise exception '存檔格式錯誤' using errcode = '22023';
  end if;
  if pg_column_size(v_s) > 1048576 then
    raise exception '存檔太大了（上限 1 MB）' using errcode = '54000';
  end if;
  perform private.ensure_me(v_me);
  v_level := private.clampi(private.jnum(v_s, 'level'), 1, 999, 1);

  -- 合理性抽查（docs/08 §3.1）：等級明顯超過遊玩天數能達到的程度 → 標記審查（不拒絕，避免誤殺）
  v_created := private.jnum(v_s, 'createdAt');
  if v_created is not null then
    v_days := greatest((extract(epoch from now()) * 1000 - v_created) / 86400000.0, 0);
    if v_level > 12 + v_days * 6 then
      insert into public.farm_flags (user_id, reason, detail)
      values (v_me, 'level_vs_days', jsonb_build_object('level', v_level, 'days', round(v_days, 2)));
      update public.farms f set flagged = true, flag_reason = '等級與遊玩天數不符' where f.user_id = v_me;
    end if;
  end if;

  update public.farms f set
    save = v_s,
    schema_version = private.clampi(private.jnum(v_s, 'v'), 1, 100000, f.schema_version),
    save_updated_at = now(),
    updated_at = now(),
    level = v_level,
    xp = private.clampi(private.jnum(v_s, 'xp'), 0, 1e15, f.xp),
    coins = private.clampi(private.jnum(v_s, 'coins'), -1e15, 1e15, f.coins)
  where f.user_id = v_me;
  return jsonb_build_object('ok', true, 'now', private.ms(now()));
end
$$;

-- 下載雲端存檔：{save, updatedAt} 或 null
create or replace function public.download_save()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_out jsonb;
begin
  select case when f.save is null then null
              else jsonb_build_object('save', f.save, 'updatedAt', private.ms(f.save_updated_at)) end
  into v_out
  from public.farms f where f.user_id = v_me;
  return v_out;
end
$$;

-- 收件匣：好友對我做了什麼（since 之後，舊到新，一次最多 200 筆）
-- 剛好回傳 200 筆代表還有更多：客戶端帶同一個 since，再加 after_id＝最後一筆的 id 繼續拿（keyset 分頁，不會漏同一時間的紀錄）。
-- inbox_read_at 只推進到「真的回傳給客戶端」的最後一筆，publish_farm 用它保護還沒同步的惡作劇草。
create or replace function public.inbox(since timestamptz default null, after_id bigint default null)
returns table (id bigint, at_ms bigint, actor_id uuid, actor_name text, kind text, n int, item text, plot int)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := private.require_uid();
  v_since timestamptz := coalesce(inbox.since, now() - interval '7 days');
  v_limit constant int := 200;
  v_count int;
  v_last timestamptz;
begin
  perform private.ensure_me(v_me);
  select count(*), max(s.created_at) into v_count, v_last
  from (
    select sl.created_at from public.social_log sl
    where sl.target = v_me and sl.actor <> v_me and sl.created_at > v_since
      and (inbox.after_id is null or sl.id > inbox.after_id)
    order by sl.id asc
    limit v_limit
  ) s;
  update public.farms f
  set inbox_read_at = case when v_count >= v_limit then greatest(coalesce(f.inbox_read_at, v_last), v_last) else now() end
  where f.user_id = v_me;
  update public.profiles p set last_seen = now() where p.id = v_me;
  return query
    select sl.id, private.ms(sl.created_at), sl.actor, coalesce(p.name, ''), sl.kind, sl.n, sl.item, sl.plot
    from public.social_log sl
    left join public.profiles p on p.id = sl.actor
    where sl.target = v_me and sl.actor <> v_me and sl.created_at > v_since
      and (inbox.after_id is null or sl.id > inbox.after_id)
    order by sl.id asc
    limit v_limit;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. 定期清理（由 pg_cron 每天呼叫一次，見 docs/10）
-- -----------------------------------------------------------------------------
create or replace function private.cleanup()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.social_log where created_at < now() - interval '60 days';
  delete from public.push_log where sent_at < now() - interval '30 days';
  delete from private.rate_events where created_at < now() - interval '2 days';
end
$$;

-- -----------------------------------------------------------------------------
-- 9. 函式權限：對外 RPC 只給 authenticated；private helper 全部收回，只留 RLS 需要的 is_friend
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_friend(uuid) to authenticated;

revoke execute on function
  public.me(),
  public.add_friend(text),
  public.remove_friend(uuid),
  public.list_friends(),
  public.get_farm(uuid),
  public.steal_crop(uuid, int),
  public.help_weed(uuid, text),
  public.help_water(uuid, int),
  public.prank_weed(uuid, int, int),
  public.send_gift(uuid, text),
  public.publish_farm(jsonb),
  public.upload_save(jsonb),
  public.download_save(),
  public.inbox(timestamptz, bigint)
from public, anon;

grant execute on function
  public.me(),
  public.add_friend(text),
  public.remove_friend(uuid),
  public.list_friends(),
  public.get_farm(uuid),
  public.steal_crop(uuid, int),
  public.help_weed(uuid, text),
  public.help_water(uuid, int),
  public.prank_weed(uuid, int, int),
  public.send_gift(uuid, text),
  public.publish_farm(jsonb),
  public.upload_save(jsonb),
  public.download_save(),
  public.inbox(timestamptz, bigint)
to authenticated;
