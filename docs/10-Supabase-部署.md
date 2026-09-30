# 10 — Supabase 部署（Phase 2 社交後端）

> 後端程式已經寫好，**拿到 Supabase 專案網址＋ anon key 後照這份文件做就能上線**。
> 設計依據見 `08-社交與後端-第二階段.md`。

---

## 0. 檔案一覽

| 檔案 | 用途 |
|---|---|
| `supabase/migrations/20261001000000_init.sql` | 資料表、RLS、伺服器規則（RPC）、異常偵測 |
| `supabase/functions/push-scheduler/index.ts` | 推播排程（Edge Function，Deno） |
| `supabase/config.toml` | `supabase start` 本機開發設定 |
| `src/net/supabase.ts` | 前端介接：`SupabaseBackend`（實作 `SocialBackend`）、`createSupabaseBackend()` |

前端只用 `fetch`，**沒有新增任何 npm 套件**。沒設定環境變數時 `createSupabaseBackend()` 回傳 `null`，遊戲自動改用本機模擬的鄰居（`src/net/local.ts`）。

---

## 1. 建立 Supabase 專案

1. 到 <https://supabase.com/dashboard> → **New project**。
2. Region 選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**（離台灣近）。
3. 記下資料庫密碼（`supabase db push` 會用到）。
4. 建好後到 **Project Settings → API**，記下：
   - **Project URL**：`https://<ref>.supabase.co`
   - **anon / publishable key**：前端用的公開金鑰（舊版叫 `anon`，是 `eyJ...` 開頭的 JWT；新版叫 publishable，是 `sb_publishable_...` 開頭，**兩種 `src/net/supabase.ts` 都支援**）
   - **service_role / secret key**：**絕對不能放前端**，只給 Edge Function 用（平台會自動注入，不用手動設定）

---

## 2. 建立資料庫（執行 migration）

### 方法 A：SQL Editor（最簡單）

Dashboard → **SQL Editor** → New query → 貼上 `supabase/migrations/20261001000000_init.sql` 全部內容 → **Run**。
看到 `Success. No rows returned` 就完成了。

### 方法 B：Supabase CLI

```bash
# 安裝 CLI（macOS）
brew install supabase/tap/supabase

cd /Users/batman_work/claude/happyFarm
supabase login
supabase link --project-ref <ref>      # 會問資料庫密碼
supabase db push                       # 執行 supabase/migrations/ 底下還沒跑過的檔案
```

### 確認

```sql
-- SQL Editor 執行：應該列出 me、add_friend、steal_crop … 等 14 個函式
select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1;
```

> ⚠️ 之後要改資料庫，**新增**一個 migration 檔（例如 `20261015000000_xxx.sql`），不要改已經跑過的 `20261001000000_init.sql`。

---

## 3. 開啟 Email 魔法連結登入

Dashboard → **Authentication**：

1. **Sign In / Providers → Email**：啟用（預設已開）。「Confirm email」可以關掉（魔法連結本身就是驗證）。
2. **URL Configuration**：
   - **Site URL**：`https://wenbatman33.github.io/happyFarm/`
   - **Redirect URLs** 加入：
     - `https://wenbatman33.github.io/happyFarm/**`
     - `http://localhost:5188/**`（本機 `npm run dev`）
3. **Emails → Templates → Magic Link**：預設模板即可（用 `{{ .ConfirmationURL }}`）。可以改成中文文案。
4. **寄信額度**：Supabase 內建的寄信服務每小時只能寄很少封（測試用）。正式上線前到 **Authentication → Emails → SMTP Settings** 接自己的 SMTP（Resend、SendGrid、Amazon SES…）。

登入流程（前端已實作）：

```
signIn(email) → POST /auth/v1/otp?redirect_to=<目前網址>
使用者點信中連結 → 回到 https://wenbatman33.github.io/happyFarm/#access_token=...&refresh_token=...
頁面載入 → createSupabaseBackend() 內呼叫 SupabaseBackend.consumeAuthRedirect()
          → session 存進 localStorage「happyFarm.auth」、網址列的 #... 清掉
access token 快過期 → 自動 POST /auth/v1/token?grant_type=refresh_token
```

想顯示「登入成功／連結過期」提示，可以讀 `SupabaseBackend.lastRedirect`（`{ ok: true, user } | { ok: false, error } | null`）。

之後也可以在 **Sign In / Providers** 開 Google、Apple 登入（docs/08 §2），前端需另外加按鈕呼叫 `/auth/v1/authorize?provider=google&redirect_to=...`，回來的網址格式相同，`consumeAuthRedirect()` 可以直接處理。

---

## 4. 前端環境變數

### 4.1 本機開發：`.env.local`

在專案根目錄建立 `/Users/batman_work/claude/happyFarm/.env.local`：

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon 或 publishable key>
# 推播（第 8 節），還沒做可以先不填
VITE_VAPID_PUBLIC_KEY=<VAPID 公鑰>
```

> ⚠️ 目前 `.gitignore` **沒有**忽略 `.env.local`，請在 `.gitignore` 加一行 `*.local`（Vite 慣例）。
> anon key 本來就會被打包進前端 JS、不算機密，但養成不把 `.env` 推上 git 的習慣比較安全。

重新 `npm run dev` 後生效（Vite 只在啟動時讀 `.env`）。

### 4.2 GitHub Pages 正式版：Actions 建置時注入

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**，新增：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`（推播做好後再加）

   （這三個值本來就公開，也可以改放在 **Variables** 分頁，下面的 `secrets.` 改成 `vars.`。）

2. 修改 `.github/workflows/deploy.yml`，在 **build job 的 `npm run build` 這一步**加上 `env`：

```yaml
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_VAPID_PUBLIC_KEY: ${{ secrets.VITE_VAPID_PUBLIC_KEY }}
      - uses: actions/upload-pages-artifact@v4
```

沒設定 secrets 時建置照樣成功，遊戲會用本機模式，所以可以先合併 workflow 再慢慢設定。

---

## 5. 伺服器規則（RPC）對照

所有社交動作都在伺服器驗證，前端只負責顯示。每日次數以**台北時間 00:00** 換日。

| RPC | 規則 |
|---|---|
| `me()` | 建立／取得 profile，回傳 6 碼好友碼、伺服器時間 |
| `add_friend(code)` | 知道好友碼就立即成為好友；上限 100 人；每小時最多嘗試 30 次（防暴力猜碼） |
| `list_friends()` | 每位好友的 `canSteal`（成熟＋過保護期＋未達 20%＋我今天沒偷過）與 `needsHelp`（草＋乾田，當天幫忙額度用完顯示 0） |
| `get_farm(target)` | 自己或好友的農場；拜訪好友每天記一筆 `visit` |
| `steal_crop(target, plot)` | 好友限定；成熟後 30 分鐘保護期；每塊田最多被偷 `floor(yield × 20%)`；同一塊田每人每天 1 次；每天 20 次；看門寵物依物種 20–30% 抓到（記 `caught`） |
| `help_weed(target, weed_id)` | 每位好友每天 5 次、每天總共 30 次（與澆水合計）；刪掉那株草；不能拔自己放的惡作劇草 |
| `help_water(target, plot)` | 同上限；只能澆還沒熟的乾田；設定 `watered_by / watered_at` |
| `prank_weed(target, tx, tz)` | 每天 3 次；在對方農場插入一株 `placed_by = 我` 的草 |
| `send_gift(target, item)` | 每位好友每天 1 次；只能送便宜的東西（`fert`、`hay`、`wood`、`stone`、`weed`、`leaf`、`dandelion`、`milk`、`seed:<作物>`） |
| `publish_farm(snapshot)` | 上傳自己的農場快照（田、草、寵物、外觀…） |
| `upload_save(data)` / `download_save()` | 雲端存檔（整份 SaveData JSON，上限 1 MB） |
| `inbox(since, after_id)` | 好友對我做了什麼；一次最多 200 筆，前端自動翻頁 |

規則常數在 SQL 的 `private.rules()`，**與 `src/net/types.ts` 的 `SOCIAL_RULES` 必須一致**，改一邊就要改另一邊（新增 migration 覆寫 `private.rules()`）。

### 5.1 作物成熟時間（重要設計）

作物成長公式（濕 ×1、乾 ×0.6、夜間花只在 19–05 點長）在 SQL 很難重算，所以：

- **發佈時**：`publishFarm()` 用與 `Farm.progress()` 相同的公式，二分搜尋出每塊田的成熟時間 `matureAt`，換成伺服器時間後上傳。
- **伺服器**：只用 `mature_at` 驗證偷菜（`now() >= mature_at + 30 分鐘`）。同一批已成熟的作物，伺服器記錄的 `mature_at` 與被偷數量 `stolen` **不會被主人的新快照覆蓋**（防止主人重新澆水把保護期刷新，或把被偷數量歸零）；換了作物才重置。
- **拜訪時**：`getFarm()` 把 `matureAt` 反推回 `PlotSave`：`snapAt = 現在`、`wetUntil = 伺服器記錄的濕潤時間`（保留乾／濕畫面），`p0 = 1 − 有效成長毫秒(現在→matureAt) ÷ 總成長毫秒`，已成熟就 `p0 = 1`。這樣好友端的 `Farm.progress()` 會剛好在 `matureAt` 到 1。
- **時差**：每次 RPC 回傳伺服器時間，前端估算「伺服器 − 遊戲時鐘」的差，送出加、收到減（DEV 快轉時鐘也不會壞）。
- 只同步田區 30 格；溫室不同步。

> 已驗證：3,000 組隨機田（含夜間花、乾濕交錯、90 秒時差），`matureAtOf` 與 `Farm.progress` 完全一致，反推的 `PlotSave` 都在 ±1.5 秒內成熟。

### 5.2 前端處理 inbox 的約定（`src/systems/social.ts` 要對應）

| kind | 欄位 | 主人客戶端應該做的事 |
|---|---|---|
| `steal` | `n`＝被偷數量、`item`＝作物 id、`plot`＝哪塊田 | 伺服器已經擲過看門寵物的骰子，這筆就是「偷成功」，**不要再擲一次** |
| `caught` | `item`、`plot` | 寵物抓到小偷的趣味訊息（這筆沒偷到東西） |
| `help_weed` | `item`＝**被拔掉的草 id** | 移除這株草、雜草進背包（用 id 找，找不到才隨便挑一株） |
| `help_water` | `plot` | 對那塊田呼叫 `Farm.water()` |
| `prank` | `item`＝伺服器那株草的 id | 產生一株惡作劇草（位置可以用 `getFarm(自己的 id)` 找那株草的 `tx/tz`，或自己挑位置） |
| `gift` | `item`、`n` | 放進背包 |
| `visit` | — | 「某某來逛了一圈」 |

`publishFarm` 可以多帶 `{ xp, coins, allowSteal }`（型別 `PublishExtras`）：`allowSteal` 對應「設定裡關掉偷菜」，`xp/coins` 用於異常偵測。

---

## 6. 安全性說明

- **RLS 全開**：自己可讀自己的資料；好友才能讀彼此的 `profiles / farms / farm_plots / farm_weeds`；`social_log` 只有動作者和被動作者看得到；`push_subscriptions` 只能管自己的。
- **客戶端不能直接寫**：`farms / farm_plots / farm_weeds / friendships / social_log` 沒有開放 insert/update/delete，全部走 `SECURITY DEFINER` 的 RPC（`set search_path = ''`、全部用完整名稱）。`profiles` 只開放改 `name`、`look`。
- **`farms.save`（完整存檔）用欄位權限藏起來**，好友讀不到；本人用 `download_save()` 讀。所以 REST 查 `farms` 不能用 `select=*`，要列欄位。
- **內部 helper 放在 `private` schema**，不透過 PostgREST 對外，也收回了執行權限。
- **匿名（anon）不能呼叫任何 RPC**。
- **防同時送出繞過上限**：每個玩家的動作用 `pg_advisory_xact_lock` 排隊；偷菜時 `select ... for update` 鎖住那塊田。
- **異常偵測（docs/08 §3）**：`farms` 的觸發器比較「每小時 XP／金幣增加量」與合理上限（`private.hourly_caps()`：XP＝一般玩家一天 XP 的一半、新手期 ×5；金幣＝600＋120×等級），超過 **3 倍**就設 `flagged = true` 並寫入 `farm_flags`。第一次上傳存檔（單機存檔綁定雲端）只建立基準點、不檢查。另外上傳時若「等級 > 12 ＋ 遊玩天數 × 6」也會標記。**只標記、不封鎖**，請定期到 SQL Editor 查：
  ```sql
  select f.*, p.name from public.farm_flags f join public.profiles p on p.id = f.user_id order by f.created_at desc limit 50;
  ```
- **已知限制（伺服器看不到背包）**：送禮、偷到的作物、幫忙的 XP／愛心都是由客戶端加進本機存檔，伺服器只保證「次數與規則」。所以禮物清單只開放便宜的東西，並靠異常偵測抓暴增。
- **刪帳號**：Dashboard → Authentication → Users 刪除，所有資料會 cascade 刪掉。

---

## 7. 推播排程（Edge Function ＋ pg_cron）

### 7.1 產生 VAPID 金鑰（只做一次）

```bash
npx web-push generate-vapid-keys
# 或（不裝 Node 套件）：deno run -A npm:web-push generate-vapid-keys
```

會得到 Public Key、Private Key。Public Key 給前端（`VITE_VAPID_PUBLIC_KEY`），Private Key **只放伺服器**。

### 7.2 設定 secrets 並部署

```bash
cd /Users/batman_work/claude/happyFarm
supabase secrets set \
  VAPID_PUBLIC_KEY=<公鑰> \
  VAPID_PRIVATE_KEY=<私鑰> \
  VAPID_SUBJECT=mailto:<你的信箱> \
  CRON_SECRET=<自己產生一串隨機字，例如 openssl rand -hex 24> \
  APP_URL=https://wenbatman33.github.io/happyFarm/

supabase functions deploy push-scheduler --no-verify-jwt
```

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 平台會自動注入。
`--no-verify-jwt`：這支函式由 pg_cron 呼叫，用 `x-cron-secret` 標頭驗證（`config.toml` 也設了 `verify_jwt = false`）。

先試跑（不會真的送出）：

```bash
curl "https://<ref>.supabase.co/functions/v1/push-scheduler?dry=1" -H "x-cron-secret: <CRON_SECRET>"
# 模擬早上 9 點：...?dry=1&now=2026-10-01T09:00:00%2B08:00
```

### 7.3 排程（每 15 分鐘）

Dashboard → **Database → Extensions** 啟用 `pg_cron`、`pg_net`（Vault 預設已啟用），然後在 SQL Editor 執行：

```sql
-- 把網址與密鑰存進 Vault（不要直接寫在 cron 指令裡）
select vault.create_secret('https://<ref>.supabase.co', 'happyfarm_project_url');
select vault.create_secret('<CRON_SECRET>', 'happyfarm_cron_secret');

select cron.schedule('happyfarm-push', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'happyfarm_project_url') || '/functions/v1/push-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'happyfarm_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- 每天清理舊紀錄（social_log 60 天、push_log 30 天）
select cron.schedule('happyfarm-cleanup', '17 4 * * *', $$ select private.cleanup(); $$);

-- 查看執行紀錄
select * from cron.job_run_details order by start_time desc limit 20;
```

### 7.4 推播規則（`push-scheduler/index.ts` 的 `planNotices()`）

- **每人每天（台北時間）最多 2 則**，每次執行每人最多 1 則（多台裝置都會收到，但只算 1 則）。
- **22:00–08:00 不推**；晚上成熟的作物，早上 8 點後補推。
- 優先順序：作物成熟 → 被偷菜（預設關）→ 好友幫忙（預設關）→ 寵物想你（3 天沒上線，每次離開只推一次）。
- 作物成熟：只看 12 小時內成熟、且成熟後玩家還沒上線過的。
- 訂閱失效（404／410）會自動刪除。

---

## 8. 前端推播訂閱（還沒做）

`src/net/supabase.ts` 已經提供：

```ts
await backend.savePushSubscription(subscription.toJSON(), { cropReady: true, missYou: true, stolen: false, helped: false });
await backend.deletePushSubscription(endpoint);
```

還需要（Phase 2 後續工作）：

1. `public/sw.js` service worker：`push` 事件 → `self.registration.showNotification(title, { body, tag, data: { url } })`；`notificationclick` → `clients.openWindow(url)`。
2. 設定頁加「開啟通知」按鈕：`Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VITE_VAPID_PUBLIC_KEY })` → `savePushSubscription()`。
3. iOS 只有「加入主畫面」的 PWA 才能收 Web Push（iOS 16.4+），需要 `manifest.webmanifest`。

---

## 9. 本機開發（選用）

需要 Docker Desktop。

```bash
cd /Users/batman_work/claude/happyFarm
supabase start          # 第一次會下載映像檔；跑完會印出 API URL 與 anon key
supabase db reset       # 重建資料庫並重跑 migrations
supabase status         # 再看一次 URL / key
supabase functions serve push-scheduler --env-file supabase/functions/.env   # 本機跑推播函式（.env 自己建立，內容同 7.2 的 secrets，不要推上 git）
```

- 本機 API：`http://127.0.0.1:54321`，Studio：`http://127.0.0.1:54323`
- 魔法連結的信不會真的寄出，到 `http://127.0.0.1:54324`（Inbucket／Mailpit）收信。
- `.env.local` 的 `VITE_SUPABASE_URL` 改成 `http://127.0.0.1:54321`、`VITE_SUPABASE_ANON_KEY` 用 `supabase status` 印出的 key。

---

## 10. 上線前檢查清單

- [ ] migration 執行成功，14 個 RPC 都在
- [ ] Authentication 的 Site URL、Redirect URLs 設好；接好自己的 SMTP
- [ ] GitHub secrets 設好、`deploy.yml` 的 build 步驟加了 `env`
- [ ] 兩個帳號互加好友 → 拜訪 → 偷菜（等保護期）→ 幫忙拔草／澆水 → 惡作劇 → 送禮，對方 inbox 都收得到
- [ ] 換一台裝置登入，`downloadSave()` 取回存檔
- [ ] `push-scheduler?dry=1` 回傳合理的推播計畫；真的送一則到自己手機

---

## 11. 驗證狀態與待辦

### 已驗證（2026-09-30，本機）

- **SQL**：在 PGlite（PostgreSQL 17.5，WASM）上用模擬的 Supabase 環境（`anon / authenticated / service_role` 角色、`auth.users`、`auth.uid()`、Supabase 預設的 public 權限）**實際執行 migration**，並跑 78 項情境測試：RLS（非好友讀不到、不能直接寫、`save` 欄位藏起來）、好友碼、偷菜全部規則（保護期、20%、每田每日一次、每日 20 次、跨台北午夜重置、看門寵物抓到比例 ≈25%）、幫忙上限、惡作劇、送禮、墓碑機制、inbox 分頁、雲端存檔、異常偵測、刪帳號 cascade。
- **前端 `src/net/supabase.ts`**：`tsc --noEmit` 無錯誤；用假 fetch 跑 34 項測試（成熟時間換算、魔法連結解析、token refresh 與 401 重試、錯誤訊息中文化、各 RPC 參數與資料對應、inbox 翻頁去重、登入登出）。
- **推播函式**：`deno check` 通過；排程邏輯 10 項測試（勿擾時段、每日 2 則、優先順序、prefs、不重複）；`npm:web-push` 在 Deno CLI 能產生 VAPID 簽章與加密內容。

### 還沒驗證／待辦

- [ ] **沒有在真正的 Supabase 專案上跑過**（GoTrue 魔法連結、PostgREST 實際呼叫、`auth.users` 觸發器）。第一次部署後請走一遍第 10 節的檢查清單。
- [ ] Web Push **實際送達手機**、`npm:web-push` 在 **Supabase Edge Runtime** 上的相容性（若失敗改用 `jsr:@negrel/webpush`）。
- [ ] 前端 service worker 與「開啟通知」UI（第 8 節）。
- [ ] `social.ts` 對 inbox 的處理要照 5.2 的約定調整（`help_weed` 用草 id、`caught`、`help_water`；`steal` 不要再擲一次寵物骰子）。
- [ ] 單機存檔第一次綁定雲端的流程 UI（docs/08 §3.1：上傳前比對雲端與本機哪個比較新）。目前 `upload_save` 是「後寫入者勝」。
- [ ] 異常偵測的上限數值（`private.hourly_caps()`）需要依實際玩家資料調整。
- [ ] 好友上限 100、好友碼節流、禮物白名單等數值上線後再觀察。
- [ ] Google／Apple 登入按鈕。

---

## 12. 最後更新

- 版本 0.1.0／2026-09-30／審查狀態：待確認
