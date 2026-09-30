import * as THREE from 'three';
import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { CROP_BY_ID } from '../data/crops';
import { FURN_BY_ID } from '../data/furniture';
import { Pet, SPECIES } from '../actors/pet';
import { LocalBackend } from '../net/local';
import { createSupabaseBackend } from '../net/supabase';
import { SOCIAL_RULES, type FarmSnapshot, type FriendSummary, type PublishSnapshot, type SocialBackend, type SocialLogEntry } from '../net/types';
import { Sheet, row } from '../ui/sheet';
import { ITEM_INFO } from '../ui/hud';
import { tileOf } from '../world/grid';
import { Farm, FIELD_COUNT, GH_COUNT } from './farm';
import { Weeds } from './weeds';
import type { Game } from '../game';
import type { GameState, PlotSave, WeedSave } from './state';

// 社交（docs/08 §4）：好友列表、拜訪好友農場（幫忙除草澆水、偷菜、放草惡作劇）、好友對你做的事、愛心商店
const HEART_SHOP: { id: string; hearts: number; n?: number }[] = [
  { id: 'fert', hearts: 10, n: 3 },
  { id: 'heart_cushion', hearts: 30 },
  { id: 'heart_plushie', hearts: 50 },
  { id: 'giantseed', hearts: 80 },
];
ITEM_INFO.heart = { name: '愛心', emoji: '💗', price: 0 };

interface Visit {
  snap: FarmSnapshot;
  fake: { data: Record<string, unknown>; now: () => number };
  farm: Farm;
  weeds: Weeds;
  pet: Pet;
  prank: boolean;
  saved: { tier: number; gh: number; scaffold: boolean; decor: string[] };
}

export class Social {
  backend: SocialBackend;
  sheet = new Sheet('friends-panel', '👥 好友');
  friends: FriendSummary[] = [];
  visiting: Visit | null = null;
  private bar: HTMLElement;
  private busy = false;
  private inboxT = 4;
  private pubT = 20;
  private first = true;

  constructor(private game: Game) {
    this.backend = createSupabaseBackend() ?? new LocalBackend(game.state);
    this.sheet.onAction = (a) => void this.act(a);
    this.bar = document.createElement('div');
    this.bar.id = 'visit-bar';
    this.bar.className = 'hidden';
    document.body.appendChild(this.bar);
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'home') void this.leave();
      if (b.dataset.a === 'prank') { if (this.visiting) { this.visiting.prank = !this.visiting.prank; this.renderBar(); } }
    });
  }

  get s() { return this.game.state.data.social; }

  private resetDaily() {
    const day = dayKey(this.game.state.now());
    if (this.s.day !== day) Object.assign(this.s, { day, steals: 0, pranks: 0, helps: 0, perFriend: {} });
  }

  // ---------- 好友面板 ----------
  async open(): Promise<void> {
    sfx.paper();
    this.sheet.show();
    this.render();
    await this.refresh();
    this.render();
  }

  async refresh(): Promise<void> {
    try { this.friends = await this.backend.listFriends(); } catch (e) { this.game.hud.toast(`❌ ${(e as Error).message}`); }
    this.game.hud.setFriendBadge(this.friends.filter((f) => f.canSteal > 0 || f.needsHelp > 0).length);
  }

  render(): void {
    if (!this.sheet.open) return;
    this.resetDaily();
    const s = this.s;
    const R = SOCIAL_RULES;
    const local = this.backend.mode === 'local';
    let html = `<div class="jn-season"><b>我的好友碼：<span class="fr-code">${this.backend.myCode()}</span></b> <button class="btn small ghost" data-a="copy">複製</button><br>
      <small>${local ? '目前是單機版：好友是用好友碼「長」出來的模擬鄰居，規則跟正式連線版一樣。後端上線後就能加真正的朋友。' : '把好友碼傳給朋友，互相加好友就能拜訪彼此的農場。'}</small></div>
      <div class="fr-add"><input class="fr-input" maxlength="7" placeholder="輸入好友碼（例：ABC-123）"><button class="btn small" data-a="add">加好友</button></div>
      <div class="jn-season"><small>今天：幫忙 ${s.helps}/${R.helpTotalDaily} · 偷菜 ${s.steals}/${R.stealDaily} · 惡作劇 ${s.pranks}/${R.prankDaily}　💗 愛心 <b>${s.hearts}</b></small></div>
      <div class="jn-sec">🏡 好友的農場</div>`;
    html += this.friends.length ? this.friends.map((f) => {
      const tags = `${f.canSteal ? `<span class="fr-tag steal">🧺 可偷 ${f.canSteal}</span>` : ''}${f.needsHelp ? `<span class="fr-tag help">🌿 可幫忙 ${f.needsHelp}</span>` : ''}`;
      return row(SPECIES[f.species].emoji, `${f.name} <small>Lv${f.level} · ${SPECIES[f.species].label}「${f.petName}」</small>`, tags || '<small>農場很整齊</small>', '拜訪', `visit:${f.id}`);
    }).join('') : '<div class="empty">讀取中…</div>';
    html += `<div class="jn-sec">💗 愛心商店 <small>幫好友除草、澆水可以拿到愛心</small></div>` + HEART_SHOP.map((h) => {
      const f = FURN_BY_ID[h.id];
      const name = f ? `${f.emoji} ${f.name}` : `${ITEM_INFO[h.id].emoji} ${ITEM_INFO[h.id].name}${h.n ? ` ×${h.n}` : ''}`;
      return row(name.split(' ')[0], name.split(' ').slice(1).join(' '), `${f ? `家具 · 舒適 +${f.comfort} · ` : ''}💗${h.hearts}`, '兌換', s.hearts >= h.hearts ? `heart:${h.id}` : null);
    }).join('');
    if (s.log.length) html += `<div class="jn-sec">📜 最近的動態</div>` + s.log.slice(-8).reverse().map((l) => `<div class="fr-log"><small>${new Date(l.at).getMonth() + 1}/${new Date(l.at).getDate()} ${String(new Date(l.at).getHours()).padStart(2, '0')}:${String(new Date(l.at).getMinutes()).padStart(2, '0')}</small> ${l.text}</div>`).join('');
    this.sheet.render(html);
  }

  private async act(a: string) {
    const g = this.game;
    if (a === 'copy') { await navigator.clipboard?.writeText(this.backend.myCode()); g.hud.toast('📋 好友碼已複製'); return; }
    if (a === 'add') {
      const v = this.sheet.el.querySelector<HTMLInputElement>('.fr-input')?.value ?? '';
      const f = await this.backend.addFriend(v);
      if (!f) { g.hud.toast('好友碼格式不對（6 個英文或數字），或是你自己的碼'); return; }
      sfx.sparkle();
      g.hud.toast(`🤝 和 ${f.name} 成為好友了！`);
      await this.refresh();
      g.state.save();
    } else if (a.startsWith('visit:')) {
      this.sheet.close();
      await this.visit(a.slice(6));
      return;
    } else if (a.startsWith('heart:')) {
      const h = HEART_SHOP.find((x) => x.id === a.slice(6));
      if (!h || this.s.hearts < h.hearts) return;
      this.s.hearts -= h.hearts;
      if (FURN_BY_ID[h.id]) g.interior.grant(h.id);
      else g.state.addItem(h.id, h.n ?? 1);
      sfx.coin();
      g.hud.toast(`💗 換到了 ${FURN_BY_ID[h.id]?.name ?? ITEM_INFO[h.id].name}`);
      g.state.save();
    }
    this.render();
  }

  private log(text: string, at = this.game.state.now()) {
    this.s.log.push({ at, text });
    if (this.s.log.length > 40) this.s.log.splice(0, this.s.log.length - 40);
  }

  // ---------- 好友對我做的事 ----------
  private async processInbox(first: boolean) {
    const g = this.game;
    const d = g.state.data;
    if (d.onboard !== 'done') return;
    let entries: SocialLogEntry[] = [];
    try { entries = await this.backend.inbox(this.s.inboxAt || g.state.now() - 3600000); } catch { return; }
    if (!entries.length) return;
    this.s.inboxAt = Math.max(this.s.inboxAt, ...entries.map((e) => e.at));
    const lines: string[] = [];
    const now = g.state.now();
    for (const e of entries) {
      const who = e.actorName;
      let text = '';
      if (e.kind === 'help_weed') {
        // Supabase 版：item 是被拔掉的那株草的 id；找不到（或本機模擬）才隨便挑
        const byId = e.item ? g.weeds.get(e.item) : undefined;
        const list = byId ? [byId] : g.weeds.list.filter((w) => !w.by).slice(0, e.n);
        for (const w of list) { g.weeds.remove(w.id); g.state.addItem('weed', 1); }
        if (list.length) text = `🌿 ${who}幫你拔了 ${list.length} 株草（雜草進了背包）`;
      } else if (e.kind === 'help_water') {
        if (e.plot !== undefined && d.plots[e.plot]?.cropId) { g.farm.water(e.plot, now); text = `💧 ${who}幫你澆了水`; }
      } else if (e.kind === 'gift' && e.item) {
        g.state.addItem(e.item, e.n);
        text = `🎁 ${who}送你 ${ITEM_INFO[e.item]?.emoji ?? ''}${ITEM_INFO[e.item]?.name ?? e.item} ×${e.n}`;
      } else if (e.kind === 'caught') {
        const crop = CROP_BY_ID[e.item ?? ''];
        text = `🐾 ${g.pet.name}發現${who}鬼鬼祟祟想摸走${crop?.emoji ?? '作物'}，把他趕跑了！`;
      } else if (e.kind === 'steal' && this.backend.mode === 'supabase') {
        // 伺服器已經擲過看門寵物的骰子，這筆就是偷成功
        const crop = CROP_BY_ID[e.item ?? ''];
        if (e.plot !== undefined && d.plots[e.plot]?.cropId) d.plots[e.plot].stolen = who;
        text = `🤭 ${who}偷偷摸走了${e.n > 1 ? ` ${e.n} 個` : '一點點'}${crop?.emoji ?? ''}${crop?.name ?? ''}`;
      } else if (e.kind === 'steal' && d.settings.allowSteal) {
        const ok = g.farm.status.bind(g.farm);
        const cands = [...Array(FIELD_COUNT).keys()].filter((i) => ok(i, now) === 'mature' && !d.plots[i].stolen && !CROP_BY_ID[d.plots[i].cropId ?? '']?.giant);
        if (cands.length) {
          const i = cands[Math.floor(Math.random() * cands.length)];
          const crop = CROP_BY_ID[d.plots[i].cropId!];
          if (Math.random() < SOCIAL_RULES.catchChance[d.pet.species]) text = `🐾 ${g.pet.name}發現${who}鬼鬼祟祟想摸走${crop.emoji}，把他趕跑了！`;
          else { d.plots[i].stolen = who; text = `🤭 ${who}偷偷摸走了一點點${crop.emoji}${crop.name}（收成時少一點經驗）`; }
        }
      } else if (e.kind === 'prank') {
        const w = g.weeds.spawnPrank(who, now, g.season);
        if (w) text = `😈 ${who}在你家門口放了一株草（拔掉可以拿雙倍獎勵）`;
      } else if (e.kind === 'visit') text = `👣 ${who}來你的農場逛了一圈`;
      if (text) { this.log(text, e.at); lines.push(text); }
    }
    if (!lines.length) return;
    if (first && lines.length >= 2) {
      window.setTimeout(() => void g.hud.letter(`<p>📬 <b>你不在的時候…</b></p>${lines.slice(-6).map((l) => `<p>${l}</p>`).join('')}${lines.length > 6 ? `<p><small>還有 ${lines.length - 6} 則，打開 👥 好友看全部</small></p>` : ''}`, '知道了'), 3000);
    } else lines.slice(-2).forEach((l, i) => window.setTimeout(() => g.hud.toast(l, 3200), i * 3400));
    g.state.save();
  }

  // ---------- 拜訪 ----------
  async visit(id: string): Promise<void> {
    const g = this.game;
    if (this.visiting || g.interior.active) return;
    let snap: FarmSnapshot;
    try { snap = await this.backend.getFarm(id); } catch (e) { g.hud.toast(`❌ ${(e as Error).message}`); return; }
    g.clearQueue();
    g.player.mover.stop();
    if (g.mower.active) g.toggleMower(false);
    sfx.door();
    await g.fade(true);
    const plots: PlotSave[] = [...snap.plots.slice(0, FIELD_COUNT)];
    while (plots.length < FIELD_COUNT + GH_COUNT) plots.push({ owned: false, tilled: false, cropId: null, p0: 0, snapAt: 0, wetUntil: 0, fert: false });
    const fake = { data: { plots, level: 99, greenhouse: { level: 0 }, weeds: snap.weeds.map((w) => ({ ...w })), zones: {}, weedSeq: 0 }, now: () => g.state.now() };
    const st = fake as unknown as GameState;
    const farm = new Farm(g.world.root, st, g.sceneLayout.field, g.sceneLayout.greenhouse);
    farm.showSigns = false;
    const weeds = new Weeds(g.world.root, st, g.grid, g.sceneLayout, farm);
    const d = g.state.data;
    const saved = { tier: d.house.tier, gh: d.greenhouse.level, scaffold: !!d.house.buildUntil, decor: d.prog.decor };
    g.setOwnFarmVisible(false);
    g.world.setHouseTier(snap.houseTier);
    g.world.setScaffold(false);
    g.world.setGreenhouse(0, false);
    g.world.setDecor(snap.decor, g.season);
    g.world.rebuildGrid();
    const pet = new Pet(g.grid, snap.pet.species, snap.pet.name);
    pet.setStage(snap.pet.stage, true);
    pet.setAccessories(snap.pet.bond > 1000, snap.pet.bond > 5500);
    const dh = g.sceneLayout.doghouse;
    pet.root.position.set(dh.x + 1, 0, dh.z + 1.2);
    g.stage.scene.add(pet.root);
    this.visiting = { snap, fake, farm, weeds, pet, prank: false, saved };
    // 從大門走進來
    g.player.root.position.set(0, 0, 11.5);
    g.player.mover.yawGoal = Math.PI;
    g.pet.root.position.set(-1, 0, 12.5);
    g.stage.target.copy(g.player.root.position);
    document.body.classList.add('visiting');
    this.bar.classList.remove('hidden');
    this.renderBar();
    this.log(`👣 你去拜訪了${snap.name}的農場`);
    g.progression.track('visit');
    await g.fade(false);
    // 對方的寵物跑過來聞聞你
    window.setTimeout(() => {
      if (!this.visiting) return;
      const p = g.player.root.position;
      pet.doTask(p.x + 0.8, p.z - 0.6, 'happy', 1.6, () => {});
      g.petVoice(snap.pet.species);
      g.hud.toast(`${SPECIES[snap.pet.species].emoji} ${snap.pet.name}跑過來聞聞你、搖搖尾巴！`, 2600);
    }, 600);
  }

  async leave(): Promise<void> {
    const g = this.game;
    const v = this.visiting;
    if (!v) return;
    sfx.door();
    await g.fade(true);
    g.world.root.remove(v.farm.root, v.weeds.root);
    g.stage.scene.remove(v.pet.root);
    this.visiting = null;
    g.setOwnFarmVisible(true);
    g.world.setHouseTier(v.saved.tier);
    g.world.setScaffold(v.saved.scaffold);
    g.world.setGreenhouse(v.saved.gh, !!g.state.data.greenhouse.buildUntil);
    g.world.setDecor(v.saved.decor, g.season);
    g.world.rebuildGrid();
    document.body.classList.remove('visiting');
    this.bar.classList.add('hidden');
    g.player.mover.stop();
    g.player.root.position.set(0, 0, 11.5);
    g.pet.root.position.set(-1, 0, 12.5);
    g.stage.target.copy(g.player.root.position);
    g.state.save();
    await g.fade(false);
    g.hud.toast('🏠 回到自己的農場了');
  }

  renderBar(): void {
    const v = this.visiting;
    if (!v) return;
    this.resetDaily();
    const pf = this.s.perFriend[v.snap.id];
    const helpLeft = Math.max(0, Math.min(SOCIAL_RULES.helpPerFriendDaily - (pf?.help ?? 0), SOCIAL_RULES.helpTotalDaily - this.s.helps));
    const prankLeft = SOCIAL_RULES.prankDaily - this.s.pranks;
    this.bar.innerHTML = `<div class="vb-title">🏡 ${v.snap.name}的農場 <small>Lv${v.snap.level}</small></div>
      <div class="vb-info">🌿 可幫忙 ${helpLeft} 次 · 🧺 可偷 ${Math.max(0, SOCIAL_RULES.stealDaily - this.s.steals)} 次 · 💗 ${this.s.hearts}</div>
      <div class="vb-btns"><button class="btn small ${v.prank ? '' : 'ghost'} ${prankLeft > 0 ? '' : 'off'}" data-a="prank">😈 放草 ${prankLeft}</button><button class="btn small" data-a="home">🏠 回家</button></div>
      ${v.prank ? '<div class="vb-hint">點一塊空地放一株草（好友拔掉時會拿到雙倍獎勵）</div>' : '<div class="vb-hint">點雜草幫忙拔、點乾掉的田幫忙澆水、點成熟的作物……偷偷摘一個？</div>'}`;
  }

  // 拜訪時的點擊
  pointerDown(hit: THREE.Vector3 | null, petHit: boolean): void {
    const g = this.game;
    const v = this.visiting;
    if (!v || !hit || this.busy) return;
    if (petHit) { v.pet.startPetted(g.player.root.position.x, g.player.root.position.z); g.petVoice(v.snap.pet.species); g.particles.burst('heart', v.pet.root.position.clone().setY(1), 4, { speed: 1, up: 1.4, size: 0.3, life: 1 }); return; }
    const t = tileOf(hit.x, hit.z);
    if (v.prank) { this.doPrank(t.x, t.z); return; }
    let best: WeedSave | null = null;
    let bd = 0.62;
    for (const w of v.weeds.list) { const dd = Math.hypot(w.tx + w.ox - hit.x, w.tz + w.oz - hit.z); if (dd < bd) { bd = dd; best = w; } }
    if (best) { this.doWeed(best); return; }
    const i = v.farm.indexAt(t.x, t.z);
    if (i >= 0 && i < FIELD_COUNT && v.farm.owned(i)) {
      const st = v.farm.status(i, g.state.now());
      if (st === 'mature') this.doSteal(i);
      else if (st === 'dry') this.doWater(i);
      else if (st === 'growing') g.hud.toast(`${v.farm.def(i)?.emoji ?? '🌱'} 還在長大中`);
      else g.hud.toast('這塊田空著');
      return;
    }
    g.player.mover.goTo(hit.x, hit.z);
  }

  private walkThen(x: number, z: number, reach: number, fn: () => void) {
    const g = this.game;
    this.busy = true;
    const ok = g.player.mover.goTo(x, z, () => { g.player.mover.face(x, z); fn(); }, reach);
    if (!ok) this.busy = false;
  }

  private applyResult(r: { ok: boolean; msg: string; hearts?: number; xp?: number; items?: Record<string, number> }, at: THREE.Vector3) {
    const g = this.game;
    if (r.hearts) { this.s.hearts += r.hearts; g.fx.float(at.clone().setY(1.4), `+${r.hearts} 💗`, 'love'); }
    if (r.xp) g.gainXp(r.xp, at, false);
    if (r.items) for (const [k, n] of Object.entries(r.items)) { g.state.addItem(k, n); g.fx.fly(at, CROP_BY_ID[k]?.emoji ?? '📦', g.hud.el('bag')); }
    this.renderBar();
    g.state.save();
  }

  private doWeed(w: WeedSave) {
    const g = this.game;
    const v = this.visiting!;
    this.walkThen(w.tx + w.ox, w.tz + w.oz, 0.6, () => {
      g.player.play('pull', undefined, async () => {
        const r = await this.backend.act(v.snap.id, { kind: 'weed', weedId: w.id });
        this.busy = false;
        const pos = v.weeds.worldPos(w, 0.3);
        if (!r.ok) { g.hud.toast(r.msg); return; }
        v.weeds.remove(w.id);
        sfx.pop(0);
        g.particles.burst('grass', pos, 10, { speed: 2, up: 3, size: 0.9 });
        g.progression.track('help');
        this.applyResult(r, pos);
      });
    });
  }

  private doWater(i: number) {
    const g = this.game;
    const v = this.visiting!;
    const t = v.farm.tileOf(i);
    this.walkThen(t.x, t.z, 0.85, () => {
      g.player.play('water', () => { sfx.water(); g.particles.burst('water', v.farm.worldPos(i, 0.9), 14, { speed: 0.8, up: 0.5, size: 0.07, dir: new THREE.Vector3(0, -1, 0), gravity: 12 }); }, async () => {
        const r = await this.backend.act(v.snap.id, { kind: 'water', plot: i });
        this.busy = false;
        if (!r.ok) { g.hud.toast(r.msg); return; }
        v.farm.water(i, g.state.now());
        g.progression.track('help');
        this.applyResult(r, v.farm.worldPos(i, 0.5));
      });
    });
  }

  private doSteal(i: number) {
    const g = this.game;
    const v = this.visiting!;
    if (!g.state.data.settings.allowSteal) { g.hud.toast('你在設定裡關掉了偷菜（互相的）'); return; }
    const t = v.farm.tileOf(i);
    this.walkThen(t.x, t.z, 0.85, () => {
      g.player.play('harvest', undefined, async () => {
        const r = await this.backend.act(v.snap.id, { kind: 'steal', plot: i });
        this.busy = false;
        const pos = v.farm.worldPos(i, 0.5);
        if (r.caught) {
          // 被看門寵物抓到：寵物追著你跑
          const p = g.player.root.position;
          g.petVoice(v.snap.pet.species);
          v.pet.doTask(p.x, p.z, 'happy', 0.5, () => {});
          g.player.mover.speed = 7;
          g.player.mover.goTo(p.x + (p.x > 0 ? -4 : 4), p.z + 3, () => { g.player.mover.speed = 4.5; });
          window.setTimeout(() => { g.player.mover.speed = 4.5; }, 2500);
          g.hud.toast(`🐾 被${v.snap.pet.name}發現了！被追著跑，什麼都沒拿到 😂`, 3000);
          this.log(`😅 想偷${v.snap.name}的菜，被${v.snap.pet.name}追著跑`);
          this.renderBar();
          return;
        }
        if (!r.ok) { g.hud.toast(r.msg); return; }
        sfx.pop(2);
        g.particles.burst('sparkle', pos, 6, { speed: 1, up: 1.4, size: 0.3 });
        const crop = Object.keys(r.items ?? {})[0];
        g.hud.toast(`🤭 偷偷摘了一個${CROP_BY_ID[crop]?.emoji ?? ''}${CROP_BY_ID[crop]?.name ?? ''}`);
        g.progression.track('steal');
        this.log(`🤭 在${v.snap.name}的田裡偷偷摘了${CROP_BY_ID[crop]?.emoji ?? ''}`);
        this.applyResult(r, pos);
      });
    });
  }

  private doPrank(x: number, z: number) {
    const g = this.game;
    const v = this.visiting!;
    if (g.grid.isBlocked(x, z) || v.farm.indexAt(x, z) >= 0 || v.weeds.list.some((w) => w.tx === x && w.tz === z)) { g.hud.toast('這裡放不了'); return; }
    this.walkThen(x, z, 0.7, () => {
      g.player.play('plant', undefined, async () => {
        const r = await this.backend.act(v.snap.id, { kind: 'prank', tx: x, tz: z });
        this.busy = false;
        if (!r.ok) { g.hud.toast(r.msg); v.prank = false; this.renderBar(); return; }
        v.weeds.list.push({ id: `prank${Date.now()}`, tx: x, tz: z, ox: 0, oz: 0, kind: 'bush', bornAt: g.state.now(), pulls: 1, zone: 'house', by: '你' });
        sfx.pop(4);
        g.hud.toast(`😈 ${r.msg}`);
        this.log(`😈 在${v.snap.name}的農場放了一株草`);
        v.prank = false;
        this.renderBar();
        g.state.save();
      });
    });
  }

  // ---------- 每幀 ----------
  update(dt: number, now: number, raining: boolean): void {
    const g = this.game;
    const v = this.visiting;
    if (v) {
      v.farm.update(dt, now, raining);
      v.weeds.update(dt);
      const dh = g.sceneLayout.doghouse;
      v.pet.update(dt, { player: g.player, night: false, doghouse: { x: dh.x, z: dh.z, rotY: dh.rotY }, treasures: [], followDist: 2.2 });
    }
    this.inboxT -= dt;
    if (this.inboxT <= 0 && !v) {
      this.inboxT = 60;
      void this.processInbox(this.first);
      this.first = false;
      void this.refresh();
    }
    // Supabase 模式：定期把自己的農場公開給好友
    this.pubT -= dt;
    if (this.pubT <= 0 && this.backend.publishFarm) {
      this.pubT = 300;
      void this.backend.publishFarm(this.mySnapshot(now)).catch(() => {});
    }
  }

  private mySnapshot(now: number): PublishSnapshot {
    const g = this.game;
    const d = g.state.data;
    const matureAt = d.plots.slice(0, FIELD_COUNT).map((p, i) => {
      const c = g.farm.def(i);
      if (!c || !p.owned) return 0;
      return now + (1 - g.farm.progress(i, now)) * g.farm.growMs(i, c);
    });
    return {
      id: 'me', name: d.playerName || '農夫', level: d.level, look: d.look!, houseTier: d.house.tier, comfort: d.comfort,
      pet: { species: d.pet.species, name: d.pet.name, stage: d.pet.stage, bond: d.pet.bond },
      plots: d.plots.slice(0, FIELD_COUNT), weeds: d.weeds, decor: d.prog.decor, stolen: {}, now, matureAt,
      xp: d.xp, coins: d.coins, allowSteal: d.settings.allowSteal,
    };
  }
}
