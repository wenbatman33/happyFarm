// 本機模擬的鄰居（Phase 1）：沒有伺服器時，好友是用好友碼當亂數種子「長」出來的 NPC 農場
// 規則跟 Supabase 版一樣（docs/08 §4），之後換成真的後端時遊戲邏輯不用改
import { clock, dayKey } from '../core/clock';
import { hashStr, mulberry32 } from '../core/rng';
import { CROPS } from '../data/crops';
import type { Species } from '../actors/pet';
import type { Look } from '../actors/player';
import type { GameState, PlotSave, WeedSave } from '../systems/state';
import { FIELD_COUNT } from '../systems/farm';
import { SOCIAL_RULES, type ActionResult, type FarmSnapshot, type FriendSummary, type SocialAction, type SocialBackend, type SocialLogEntry } from './types';

const DAY = 86400000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NAMES = ['阿明', '小美', '老王', '林大哥', '小花', '阿傑', '佩佩', '大雄', '小雨', '阿寶', '雯雯', '胖虎'];
const PET_NAMES: Record<Species, string[]> = { corgi: ['旺財', '豆豆', '來福'], cat: ['咪咪', '橘子', '胖胖'], bunny: ['棉花', '雪球', '湯圓'], duck: ['呱呱', '小黃', '鴨鴨'] };
const SPECIES: Species[] = ['corgi', 'cat', 'bunny', 'duck'];

// 內建的 4 位鄰居（新玩家一開始就有朋友）
const STARTERS = ['NPC-MING', 'NPC-MEI', 'NPC-WANG', 'NPC-LIN'];
const STARTER_INFO: Record<string, { name: string; level: number; species: Species; tier: number }> = {
  'NPC-MING': { name: '阿明', level: 18, species: 'corgi', tier: 2 },
  'NPC-MEI': { name: '小美', level: 32, species: 'cat', tier: 3 },
  'NPC-WANG': { name: '老王', level: 45, species: 'duck', tier: 3 },
  'NPC-LIN': { name: '林大哥', level: 61, species: 'bunny', tier: 4 },
};

// 拜訪時雜草可以長的位置（房子周圍、小徑旁、田邊，避開建築）
const WEED_SPOTS: [number, number][] = [
  [-4, -2], [-3, -2], [3, -2], [4, -2], [-4, -4], [4, -4], [-5, -6], [5, -1], [-1, 0], [1, 0], [-1, 3], [1, 3], [-1, 6], [1, 6], [-1, 9], [1, 9],
  [8, 1], [8, 3], [8, 5], [3, 7], [5, 7], [-3, 3], [-5, 1], [-10, 0], [11, -6], [10, 9], [-11, -7], [6, 10], [-6, 11], [12, 4],
];

interface Npc { id: string; name: string; level: number; species: Species; petName: string; tier: number; look: Look }

export class LocalBackend implements SocialBackend {
  readonly mode = 'local' as const;

  constructor(private state: GameState) {}

  private get s() { return this.state.data.social; }

  myCode(): string {
    const h = hashStr('me' + this.state.data.createdAt);
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[(h >>> (i * 5)) % CODE_CHARS.length];
    return `${c.slice(0, 3)}-${c.slice(3)}`;
  }

  private npc(id: string): Npc {
    const st = STARTER_INFO[id];
    const rand = mulberry32(hashStr('npc' + id));
    const species = st?.species ?? SPECIES[Math.floor(rand() * 4)];
    const level = st?.level ?? 5 + Math.floor(rand() * 60);
    return {
      id,
      name: st?.name ?? NAMES[Math.floor(rand() * NAMES.length)],
      level,
      species,
      petName: PET_NAMES[species][Math.floor(rand() * 3)],
      tier: st?.tier ?? (level >= 50 ? 4 : level >= 25 ? 3 : level >= 8 ? 2 : 1),
      look: { body: rand() < 0.5 ? 'round' : 'tall', skin: Math.floor(rand() * 4), hair: (['short', 'bob', 'ponytail', 'pigtails', 'spiky', 'bun'] as const)[Math.floor(rand() * 6)], hairColor: Math.floor(rand() * 5), outfit: Math.floor(rand() * 5), shirt: Math.floor(rand() * 5), hat: rand() < 0.5 },
    };
  }

  private ids(): string[] { return [...STARTERS, ...this.s.friends]; }

  private resetDaily() {
    const day = dayKey(clock.now());
    if (this.s.day === day) return;
    Object.assign(this.s, { day, steals: 0, pranks: 0, helps: 0, perFriend: {} });
  }

  private pf(id: string) {
    this.resetDaily();
    return (this.s.perFriend[id] ??= { help: 0, gift: false, stole: [], weeds: [], watered: [], pranks: [] });
  }

  // NPC 今天的田：每塊田依種子決定種了什麼、什麼時候種的
  private plots(n: Npc, now: number): { plots: PlotSave[]; matureAt: number[] } {
    const day = dayKey(now);
    const rand = mulberry32(hashStr(n.id + day));
    const season = clock.season(now);
    const avail = CROPS.filter((c) => !c.night && c.unlock <= n.level && (c.season === 'all' || c.season === season) && c.minutes <= 720);
    const owned = Math.min(FIELD_COUNT, 8 + Math.floor(n.level / 3));
    const plots: PlotSave[] = [];
    const matureAt: number[] = [];
    const d0 = new Date(now);
    d0.setHours(0, 0, 0, 0);
    for (let i = 0; i < FIELD_COUNT; i++) {
      const own = i < owned;
      const c = avail[Math.floor(rand() * avail.length)];
      const empty = rand() < 0.12;
      // 種下時間：今天清晨到現在之間，讓有些熟了、有些還在長
      const planted = d0.getTime() - c.minutes * 60000 * rand() * 0.8 + rand() * Math.max(1, now - d0.getTime());
      const dry = rand() < 0.3;
      const mAt = planted + c.minutes * 60000;
      plots.push({ owned: own, tilled: own, cropId: own && !empty && planted < now ? c.id : null, p0: 0, snapAt: planted, wetUntil: dry ? planted : planted + 30 * DAY, fert: false });
      matureAt.push(dry ? planted + c.minutes * 60000 / 0.6 : mAt);
    }
    return { plots, matureAt };
  }

  private weeds(n: Npc, now: number): WeedSave[] {
    const rand = mulberry32(hashStr(n.id + 'w' + dayKey(now)));
    const count = 5 + Math.floor(rand() * 8);
    const spots = [...WEED_SPOTS].sort(() => rand() - 0.5).slice(0, count);
    const kinds: WeedSave['kind'][] = ['sprout', 'sprout', 'bush', 'big', 'dandelion'];
    const out: WeedSave[] = spots.map(([x, z], i) => ({ id: `${n.id}-w${i}`, tx: x, tz: z, ox: (rand() - 0.5) * 0.3, oz: (rand() - 0.5) * 0.3, kind: kinds[Math.floor(rand() * kinds.length)], bornAt: now - 3600000, pulls: 1, zone: 'house' }));
    // 我放的惡作劇雜草
    const pf = this.s.perFriend[n.id];
    pf?.pranks?.forEach(([x, z], i) => out.push({ id: `${n.id}-p${i}`, tx: x, tz: z, ox: 0, oz: 0, kind: 'bush', bornAt: now, pulls: 1, zone: 'house', by: '你' }));
    const pulled = new Set(pf?.weeds ?? []);
    return out.filter((w) => !pulled.has(w.id));
  }

  async listFriends(): Promise<FriendSummary[]> {
    const now = clock.now();
    return this.ids().map((id) => {
      const n = this.npc(id);
      const snap = this.snapshotSync(id, now);
      return {
        id, name: n.name, level: n.level, species: n.species, petName: n.petName, look: n.look,
        canSteal: this.stealable(snap, now).length,
        needsHelp: snap.weeds.filter((w) => !w.by).length + snap.plots.filter((p) => p.cropId && p.wetUntil < now).length,
        lastSeen: now - (hashStr(id + dayKey(now)) % 20) * 3600000, isNpc: true,
      };
    });
  }

  async addFriend(code: string): Promise<FriendSummary | null> {
    const c = code.trim().toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(c) || c.replace('-', '') === this.myCode().replace('-', '')) return null;
    const norm = c.includes('-') ? c : `${c.slice(0, 3)}-${c.slice(3)}`;
    if (!this.s.friends.includes(norm)) this.s.friends.push(norm);
    if (this.s.friends.length > 96) this.s.friends.shift();
    return (await this.listFriends()).find((f) => f.id === norm) ?? null;
  }

  async removeFriend(id: string): Promise<void> {
    this.s.friends = this.s.friends.filter((f) => f !== id);
  }

  private snapshotSync(id: string, now: number): FarmSnapshot {
    const n = this.npc(id);
    const { plots, matureAt } = this.plots(n, now);
    const pf = this.s.perFriend[id];
    const stolen: Record<number, number> = {};
    for (const i of pf?.stole ?? []) stolen[i] = (stolen[i] ?? 0) + 1;
    for (const i of pf?.watered ?? []) if (plots[i]) plots[i].wetUntil = now + DAY;
    return {
      matureAt,
      id, name: n.name, level: n.level, look: n.look, houseTier: n.tier, comfort: 40 + n.level * 3,
      pet: { species: n.species, name: n.petName, stage: n.level > 30 ? 2 : n.level > 12 ? 1 : 0, bond: n.level * 80 },
      plots, weeds: this.weeds(n, now), decor: n.level > 20 ? ['scarecrow_' + clock.season(now)] : [],
      stolen, stolenByMe: pf?.stole ?? [], helpedToday: pf?.help ?? 0, now,
    };
  }

  // 可以偷的田：成熟超過 30 分鐘、今天還沒偷過
  private stealable(snap: FarmSnapshot, now: number): number[] {
    const m = snap.matureAt ?? [];
    return snap.plots.map((p, i) => i).filter((i) => snap.plots[i].cropId && m[i] + SOCIAL_RULES.stealProtectMs <= now && !snap.stolenByMe.includes(i));
  }

  async getFarm(id: string): Promise<FarmSnapshot> {
    return this.snapshotSync(id, clock.now());
  }

  async act(id: string, a: SocialAction): Promise<ActionResult> {
    const now = clock.now();
    const pf = this.pf(id);
    const n = this.npc(id);
    const R = SOCIAL_RULES;
    const helpLeft = Math.min(R.helpPerFriendDaily - pf.help, R.helpTotalDaily - this.s.helps);
    switch (a.kind) {
      case 'weed':
      case 'water': {
        if (helpLeft <= 0) return { ok: false, msg: pf.help >= R.helpPerFriendDaily ? `今天已經幫${n.name}很多次了（每位好友每天 ${R.helpPerFriendDaily} 次）` : `今天幫忙的次數用完了（每天 ${R.helpTotalDaily} 次）` };
        pf.help++;
        this.s.helps++;
        if (a.kind === 'weed') { pf.weeds.push(a.weedId); return { ok: true, msg: `幫${n.name}拔了草`, hearts: 1, xp: 6 }; }
        pf.watered.push(a.plot);
        return { ok: true, msg: `幫${n.name}澆了水`, hearts: 1, xp: 4 };
      }
      case 'steal': {
        if (this.s.steals >= R.stealDaily) return { ok: false, msg: `今天偷夠多了（每天 ${R.stealDaily} 次）` };
        const snap = this.snapshotSync(id, now);
        if (!this.stealable(snap, now).includes(a.plot)) return { ok: false, msg: '這塊田現在不能偷（剛成熟的有 30 分鐘保護期，每塊只能偷一次）' };
        this.s.steals++;
        pf.stole.push(a.plot);
        if (Math.random() < R.catchChance[n.species]) return { ok: false, caught: true, msg: `被${n.petName}發現了！` };
        const crop = snap.plots[a.plot].cropId!;
        return { ok: true, msg: `偷偷摘了一個`, items: { [crop]: 1 }, xp: 2 };
      }
      case 'prank': {
        if (this.s.pranks >= R.prankDaily) return { ok: false, msg: `今天的惡作劇用完了（每天 ${R.prankDaily} 次）` };
        this.s.pranks++;
        pf.pranks.push([a.tx, a.tz]);
        return { ok: true, msg: `在${n.name}的農場放了一株草 😈`, hearts: 0 };
      }
      case 'gift': {
        if (pf.gift) return { ok: false, msg: `今天已經送過${n.name}禮物了` };
        pf.gift = true;
        return { ok: true, msg: `送了禮物給${n.name}`, hearts: 2 };
      }
    }
  }

  // 好友對我做的事：每 6 小時一個時段，依種子決定有沒有來幫忙、送禮、偷菜、放草
  async inbox(since: number): Promise<SocialLogEntry[]> {
    const now = clock.now();
    const out: SocialLogEntry[] = [];
    const block = 6 * 3600000;
    const from = Math.max(since, now - 3 * DAY, this.state.data.createdAt + 2 * 3600000);
    for (let b = Math.floor(from / block) + 1; b * block <= now; b++) {
      for (const id of this.ids()) {
        const n = this.npc(id);
        const rand = mulberry32(hashStr(id + 'in' + b));
        const at = b * block - Math.floor(rand() * block * 0.5);
        const r = rand();
        const base = { id: `${id}-${b}`, at, actorId: id, actorName: n.name };
        if (r < 0.3) out.push({ ...base, kind: 'help_weed', n: 1 + Math.floor(rand() * 3) });
        else if (r < 0.42) out.push({ ...base, kind: 'gift', n: 1 + Math.floor(rand() * 3), item: ['fert', 'hay', 'wood', 'stone'][Math.floor(rand() * 4)] });
        else if (r < 0.52) out.push({ ...base, kind: 'steal', n: 1 });
        else if (r < 0.6) out.push({ ...base, kind: 'prank', n: 1 });
        else if (r < 0.75) out.push({ ...base, kind: 'visit', n: 1 });
      }
    }
    return out.filter((e) => e.at > since && e.at <= now).sort((a, b) => a.at - b.at);
  }
}
