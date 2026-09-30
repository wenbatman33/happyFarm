import * as THREE from 'three';
import GUI from 'lil-gui';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LAYOUT_MOBILE, LAYOUT_PC, LIGHT_TWEAKS, PET_TUNING, SCENE_LAYOUT, clone, type HudKey, type PropPlacement } from '../config/layout';
import { clock, type Season } from '../core/clock';
import { Models } from '../world/models';
import { FURNITURE } from '../data/furniture';
import { FESTIVALS, type FestivalId } from '../data/festivals';
import { BOND_THRESHOLDS, xpNext } from '../data/economy';
import type { Game } from '../game';
import type { Weather } from '../systems/weather';

// DEV 微調工具（全域開發準則：可拖曳、即時生效、可匯出）
// 開啟：` 鍵、F2，或右下角齒輪。只在開發模式或網址加 ?dev=1 時載入。

const STORE = 'happyFarm.dev';
interface Persisted {
  v?: number;
  layouts?: { pc: typeof LAYOUT_PC; mobile: typeof LAYOUT_MOBILE };
  scene?: typeof SCENE_LAYOUT;
  light?: typeof LIGHT_TWEAKS;
  pet?: typeof PET_TUNING;
  clock?: { offset: number; scale: number };
  layoutMode?: 'auto' | 'pc' | 'mobile';
}

export class DevTools {
  private gui: GUI;
  private tc: TransformControls;
  private proxy = new THREE.Object3D(); // 田區拖曳用的代理物件
  private layoutFolder: GUI | null = null;
  private saveTimer = 0;
  private hudDragOn = false;
  private sel = {
    target: 'house',
    drag: false,
    mode: 'translate' as 'translate' | 'rotate' | 'scale',
  };
  private view = {
    hourFollow: true,
    hour: 12,
    season: 'auto' as Season | 'auto',
    weather: 'auto' as Weather | 'auto',
    speed: 1,
    time: '',
    quality: 'high',
    bond: 0,
    petAnim: 'none',
  };

  // 在建立 Game 之前套用上次的微調
  static applyPersisted(): Persisted {
    let p: Persisted = {};
    try { p = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* 忽略 */ }
    // v2（2026-10-01）：新增溫室、市集，樹的位置有調整；舊的樹位置不要套回去
    if ((p.v ?? 1) < 2 && p.scene) delete (p.scene as Partial<typeof SCENE_LAYOUT>).trees;
    if (p.scene) Object.assign(SCENE_LAYOUT, p.scene);
    if (p.light) Object.assign(LIGHT_TWEAKS, p.light);
    if (p.pet) Object.assign(PET_TUNING, p.pet);
    // 版面：逐項合併，舊存的設定沒有新 HUD 元件（例如節慶橫幅）時沿用預設值
    if (p.layouts) for (const [dst, src] of [[LAYOUT_PC, p.layouts.pc], [LAYOUT_MOBILE, p.layouts.mobile]] as const) {
      if (!src) continue;
      Object.assign(dst.hud, src.hud ?? {});
      Object.assign(dst.camera, src.camera ?? {});
    }
    if (p.clock) clock.restore(p.clock.offset, p.clock.scale);
    return p;
  }

  constructor(private game: Game, persisted: Persisted = {}) {
    if (persisted.layoutMode) { game.layoutMode = persisted.layoutMode; game.applyLayout(); }
    this.view.quality = game.stage.quality;
    this.view.bond = game.state.data.pet.bond;
    this.view.speed = clock.scale;

    this.gui = new GUI({ title: '🛠 DEV 微調工具（` 鍵開關）' });
    this.gui.hide();
    this.tc = new TransformControls(game.stage.camera, game.stage.renderer.domElement);
    this.tc.setTranslationSnap(0.5);
    this.tc.setRotationSnap(THREE.MathUtils.degToRad(15));
    game.stage.scene.add(this.tc.getHelper(), this.proxy);
    this.tc.addEventListener('objectChange', () => this.onGizmoChange());
    this.tc.addEventListener('dragging-changed', (e) => { if (!e.value) { game.world.rebuildGrid(); this.persist(); } });

    const gear = document.createElement('button');
    gear.id = 'dev-gear';
    gear.textContent = '⚙️';
    gear.title = 'DEV 工具（` 鍵）';
    gear.onclick = () => this.toggle();
    document.body.appendChild(gear);
    window.addEventListener('keydown', (e) => { if (e.key === '`' || e.key === 'F2') { this.toggle(); e.preventDefault(); } });

    this.build();
    this.setupHudDrag();
  }

  toggle(): void {
    if (this.gui._hidden) this.gui.show();
    else { this.gui.hide(); this.setSceneDrag(false); this.setHudDrag(false); }
  }

  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const g = this.game;
      const p: Persisted = { v: 2, layouts: g.layouts, scene: g.sceneLayout, light: g.light, pet: g.petTuning, clock: { offset: clock.offset, scale: clock.scale }, layoutMode: g.layoutMode };
      localStorage.setItem(STORE, JSON.stringify(p));
    }, 300);
  }

  private refreshAll() {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private build() {
    const g = this.game;
    const gui = this.gui;
    const onCh = () => this.persist();

    // ---- 版面 ----
    const lf = gui.addFolder('📐 版面');
    lf.add(g, 'layoutMode', { 自動: 'auto', 'PC 版': 'pc', '手機版': 'mobile' }).name('編輯哪個版面').onChange(() => { g.applyLayout(); this.buildLayoutFolder(lf); onCh(); });
    lf.add({ drag: false }, 'drag').name('🖐 直接拖曳 HUD').onChange((v: boolean) => this.setHudDrag(v));
    this.buildLayoutFolder(lf);
    lf.close();

    // ---- 場景物件 ----
    const sf = gui.addFolder('🏡 場景物件');
    const keys = ['house', 'field', 'doghouse', 'mailbox', 'compost', ...g.sceneLayout.trees.map((_, i) => `tree${i}`), ...g.sceneLayout.rocks.map((_, i) => `rock${i}`)];
    sf.add(this.sel, 'target', keys).name('選擇物件').onChange(() => { if (this.sel.drag) this.attachGizmo(); this.buildPlacement(sf); });
    sf.add(this.sel, 'drag').name('🖐 3D 拖曳模式').onChange((v: boolean) => this.setSceneDrag(v));
    sf.add(this.sel, 'mode', { 移動: 'translate', 旋轉: 'rotate', 縮放: 'scale' }).name('操作').onChange((v: 'translate' | 'rotate' | 'scale') => this.tc.setMode(v));
    this.buildPlacement(sf);
    sf.close();

    // ---- 光影 ----
    const vf = gui.addFolder('💡 光影');
    vf.add(this.view, 'quality', { 低: 'low', 中: 'medium', 高: 'high' }).name('畫質').onChange((q: 'low' | 'medium' | 'high') => g.stage.setQuality(q));
    vf.add(this.view, 'hourFollow').name('跟隨現實時間').onChange((v: boolean) => { clock.hourOverride = v ? null : this.view.hour; });
    vf.add(this.view, 'hour', 0, 24, 0.1).name('時段預覽').onChange((h: number) => { this.view.hourFollow = false; clock.hourOverride = h; this.refreshAll(); });
    const presets: [string, number][] = [['🌅 清晨', 6.3], ['☀️ 正午', 12], ['🌇 黃金時刻', 17.3], ['🌆 傍晚', 18.8], ['🌙 夜晚', 21.5]];
    for (const [name, h] of presets) vf.add({ go: () => { this.view.hour = h; this.view.hourFollow = false; clock.hourOverride = h; this.refreshAll(); } }, 'go').name(name);
    vf.add(this.view, 'season', { 自動: 'auto', 春: 'spring', 夏: 'summer', 秋: 'autumn', 冬: 'winter' }).name('季節').onChange((s: Season | 'auto') => { clock.seasonOverride = s === 'auto' ? null : s; });
    vf.add(this.view, 'weather', { 自動: 'auto', 晴: 'sunny', 多雲: 'cloudy', 雨: 'rain', 雪: 'snow' }).name('天氣').onChange((w: Weather | 'auto') => { g.weatherOverride = w === 'auto' ? null : w; g.weather = g.weatherOverride ?? g.weather; });
    const L = g.light;
    vf.add(L, 'exposure', 0.4, 2, 0.01).name('曝光').onChange(onCh);
    vf.add(L, 'sunMul', 0, 2.5, 0.01).name('主光強度').onChange(onCh);
    vf.add(L, 'hemiMul', 0, 2.5, 0.01).name('環境光強度').onChange(onCh);
    vf.add(L, 'aoIntensity', 0, 6, 0.1).name('AO 強度').onChange(onCh);
    vf.add(L, 'aoRadius', 0.2, 4, 0.05).name('AO 半徑').onChange(onCh);
    vf.add(L, 'bloomStrength', 0, 1.5, 0.01).name('Bloom 強度').onChange(onCh);
    vf.add(L, 'bloomThreshold', 0, 1.2, 0.01).name('Bloom 門檻').onChange(onCh);
    vf.add(L, 'vignette', 0, 0.8, 0.01).name('暗角').onChange(onCh);
    vf.close();

    // ---- 時間 ----
    const tf = gui.addFolder('⏱ 時間');
    tf.add(this.view, 'time').name('遊戲時間').listen().disable();
    tf.add(this.view, 'speed', { '1×（現實）': 1, '60×': 60, '600×': 600, '3600×': 3600 }).name('時間倍速').onChange((s: number) => { clock.setScale(Number(s)); onCh(); });
    const jump = (ms: number) => () => { clock.jump(ms); onCh(); };
    tf.add({ f: jump(3600000) }, 'f').name('⏩ +1 小時');
    tf.add({ f: jump(6 * 3600000) }, 'f').name('⏩ +6 小時');
    tf.add({ f: jump(24 * 3600000) }, 'f').name('⏩ +1 天');
    tf.add({ f: jump(30 * 24 * 3600000) }, 'f').name('⏩ +30 天（換季測試）');
    tf.add({ f: () => { clock.reset(); this.view.speed = 1; g.state.data.maxSeen = Date.now(); this.refreshAll(); onCh(); } }, 'f').name('↺ 重設時鐘');
    window.setInterval(() => { this.view.time = new Date(clock.now()).toLocaleString('zh-TW', { hour12: false }); }, 500);
    tf.close();

    // ---- 狀態觸發 ----
    const af = gui.addFolder('🎬 狀態觸發');
    const now = () => g.state.now();
    af.add({ f: () => g.weeds.forceSpawn(10, now(), g.season) }, 'f').name('🌿 生成 10 株雜草');
    af.add({ f: () => g.weeds.forceSpawn(6, now() - 30 * 3600000, g.season, 'big') }, 'f').name('🌾 生成大草叢');
    af.add({ f: () => g.weeds.forceSpawn(6, now(), g.season, 'leaves') }, 'f').name('🍂 生成落葉堆');
    af.add({ f: () => g.weeds.forceSpawn(6, now(), g.season, 'dandelion') }, 'f').name('🌼 生成蒲公英');
    af.add({ f: () => g.weeds.forceSpawn(6, now(), g.season, 'snow') }, 'f').name('❄️ 生成積雪');
    af.add({ f: () => { g.state.data.plots.forEach((p) => { if (p.cropId) p.p0 = 1; }); } }, 'f').name('🧺 作物全部成熟');
    af.add({ f: () => { g.state.data.plots.forEach((p) => { if (p.cropId) { p.p0 = 0.5; p.wetUntil = 0; p.snapAt = now(); } }); } }, 'f').name('💧 作物全部變乾');
    af.add({ f: () => g.state.addXp(xpNext(g.state.data.level) - g.state.data.xp) }, 'f').name('⬆️ 升一級');
    af.add({ f: () => { g.state.data.coins += 1000; } }, 'f').name('🪙 +1000 金幣');
    af.add({ f: () => g.spawnTreasure() }, 'f').name('💎 放一個挖寶點');
    af.add({ f: () => g.pet.react() }, 'f').name('🐶 寵物慶祝');
    af.add({ f: () => { const c = g.state.data.cows[0]; c.milkReadyAt = 0; c.fedAt = g.state.now(); } }, 'f').name('🥛 牛奶立即可擠');
    af.add({ f: () => { g.state.data.cows[0].fedAt = 0; } }, 'f').name('🌾 牛變餓');
    af.add({ f: () => { g.state.data.cows[0].brushes = 0; } }, 'f').name('🪮 重置刷毛次數');
    af.add({ f: () => g.state.addItem('hay', 10) }, 'f').name('🌾 +10 牧草');
    af.add({ f: () => g.player.play('celebrate') }, 'f').name('🙌 主角慶祝');
    af.add({ f: () => { const h = g.state.data.house; h.buildUntil = null; g.world.setScaffold(false); h.tier = h.tier >= 5 ? 1 : h.tier + 1; g.state.data.houseTier = h.tier; g.world.setHouseTier(h.tier); g.world.rebuildGrid(); } }, 'f').name('🏠 房屋階段 T1→…→T5');
    af.add({ f: () => { g.state.data.workshop.forEach((s) => (s.doneAt = 0)); } }, 'f').name('🍞 加工立即完成');
    af.add({ f: () => { g.state.data.trees.forEach((t) => { t.plantedAt -= 30 * 86400000; t.pickedAt = 0; }); } }, 'f').name('🌳 果樹立即成熟並結果');
    af.add({ f: () => g.state.addItem('giantseed', 1) }, 'f').name('🌰 +1 巨型種子');
    af.add({ f: () => { g.state.data.prog.stars += 500; } }, 'f').name('⭐ +500 季節星');
    af.add({ f: () => { const p = g.state.data.prog; p.day = ''; p.week = ''; g.progression.refresh(g.state.now()); } }, 'f').name('📋 重抽每日／每週任務');
    af.add({ f: () => { const h = g.state.data.house; if (h.buildUntil) h.buildUntil = g.state.now(); } }, 'f').name('🔨 施工立即完成');
    af.add({ f: () => { g.state.addItem('wood', 20); g.state.addItem('stone', 20); } }, 'f').name('🪵 +20 木材、+20 石材');
    af.add({ f: () => { g.state.addItem('fert', 5); g.state.addItem('weed', 20); } }, 'f').name('🧪 +5 有機肥、+20 雜草');
    af.add({ f: () => { g.state.data.compost = g.state.data.compost.map(() => 0); } }, 'f').name('🪣 堆肥立即完成');
    af.add({ f: () => { g.orders.d.slot = ''; g.orders.refresh(g.state.now()); } }, 'f').name('📬 刷新訂單');
    af.add({ f: () => { g.state.data.tutorial = 0; void g.tutorial.start(); } }, 'f').name('🎓 重跑新手引導');
    af.close();

    // ---- M3 第二批／M4／M5 ----
    const mf = gui.addFolder('🌱 溫室・工具・室內');
    mf.add({ f: () => { const gh = g.state.data.greenhouse; if (gh.buildUntil) { gh.buildUntil = now(); return; } if (gh.level >= 3) return; gh.level++; g.farm.grantGreenhouse(gh.level, now()); g.world.setGreenhouse(gh.level, false); g.world.rebuildGrid(); } }, 'f').name('🌱 溫室升一期（施工中則立即完成）');
    mf.add({ f: () => { const d = g.state.data; for (const k of Object.keys(d.tools) as (keyof typeof d.tools)[]) d.tools[k] = k === 'robot' ? 1 : 2; d.robotAt = now() - 3600000; g.tools.render(); } }, 'f').name('🧰 工具全部升滿＋機器人');
    mf.add({ f: () => void g.interior.enter() }, 'f').name('🚪 進屋');
    mf.add({ f: () => { for (const f of FURNITURE) g.interior.grant(f.id); g.hud.toast('🛋️ 每件家具各 +1'); } }, 'f').name('🛋️ 所有家具各給一件');
    mf.add({ f: () => { g.state.addItem('windpart', 5); for (const r of ['flour', 'bread', 'jam']) g.state.addItem(r, 10); } }, 'f').name('⚙️ +5 風車零件、+30 加工品');
    mf.close();

    const ef = gui.addFolder('🎉 節慶・日曆');
    ef.add({ id: 'auto' }, 'id', ['auto', ...Object.keys(FESTIVALS)]).name('強制節慶').onChange((id: string) => { g.festival.override = id === 'auto' ? null : (id as FestivalId); g.festival.tick(now()); });
    ef.add({ k: 'auto' }, 'k', ['auto', 'none', 'market', 'merchant']).name('市集攤位').onChange((k: string) => { g.calendar.override = k === 'auto' ? null : (k as 'none' | 'market' | 'merchant'); g.calendar.tick(now()); });
    ef.add({ f: () => { g.state.data.festival.tokens += 100; } }, 'f').name('🏵️ +100 節慶代幣');
    ef.add({ f: () => { g.state.data.festival.envelopeDay = ''; } }, 'f').name('🧧 紅包重置');
    ef.add({ f: () => { const s = g.state.data.stamps; for (let i = 1; i <= 25; i++) { const k = `x${i}`; if (!s.days.includes(k)) s.days.push(k); } } }, 'f').name('📅 印章 +25 天');
    ef.add({ f: () => { const d = g.state.data; d.createdAt -= 400 * 86400000; } }, 'f').name('📜 解鎖故事（加入天數 +400）');
    ef.add({ f: () => g.calendar.welcomeBack(now(), 8 * 24) }, 'f').name('👋 模擬 8 天沒上線（回流禮包）');
    ef.add({ f: () => g.calendar.welcomeBack(now(), 31 * 24) }, 'f').name('📓 模擬 31 天沒上線（想你日記）');
    ef.close();

    const soc = gui.addFolder('👥 社交');
    soc.add({ f: () => void g.social.open() }, 'f').name('👥 好友面板');
    soc.add({ f: () => void g.social.visit('NPC-MING') }, 'f').name('🏡 拜訪阿明');
    soc.add({ f: () => void g.social.leave() }, 'f').name('🏠 回家');
    soc.add({ f: () => { g.state.data.social.inboxAt = now() - 30 * 3600000; (g.social as unknown as { inboxT: number; first: boolean }).inboxT = 0; (g.social as unknown as { first: boolean }).first = true; } }, 'f').name('📬 模擬好友動態（過去 30 小時）');
    soc.add({ f: () => { g.state.data.social.hearts += 50; } }, 'f').name('💗 +50 愛心');
    soc.add({ f: () => { Object.assign(g.state.data.social, { day: '' }); } }, 'f').name('↺ 重置今日社交次數');
    soc.close();

    const perf = gui.addFolder('📊 效能');
    const stat = { calls: 0, tris: 0, fps: 0 };
    perf.add(stat, 'fps').name('FPS').listen().disable();
    perf.add(stat, 'calls').name('Draw calls').listen().disable();
    perf.add(stat, 'tris').name('三角形（千）').listen().disable();
    let frames = 0, t0 = performance.now();
    const loop = () => {
      frames++;
      const t = performance.now();
      if (t - t0 > 1000) {
        stat.fps = Math.round((frames * 1000) / (t - t0));
        frames = 0; t0 = t;
        const info = g.stage.renderer.info.render;
        stat.calls = info.calls;
        stat.tris = Math.round(info.triangles / 1000);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    perf.close();

    const df = gui.addFolder('🗑 存檔');
    df.add({ f: () => { if (confirm('確定要重設存檔？')) { g.state.reset(); localStorage.removeItem('happyFarm.save'); location.reload(); } } }, 'f').name('🗑 重設存檔');
    af.close();

    // ---- 寵物 ----
    const pf = gui.addFolder('🐶 寵物');
    pf.add(Models, 'enabled').name('🧸 使用 Blender GLB 模型').onChange(() => g.applyModels());
    pf.add(g.petTuning, 'followDist', 1.2, 6, 0.1).name('跟隨距離（公尺）').onChange(onCh);
    pf.add({ s: g.pet.species }, 's', { 柯基: 'corgi', 橘貓: 'cat', 垂耳兔: 'bunny', 小鴨: 'duck' }).name('切換物種').onChange((sp: 'corgi' | 'cat' | 'bunny' | 'duck') => {
      const d = g.state.data.pet;
      d.species = sp;
      g.pet.setSpecies(sp);
      g.pet.setStage(d.stage, true);
    });
    for (const [label, st] of [['🍼 幼年', 0], ['🧒 少年', 1], ['🦮 成年', 2]] as const) {
      pf.add({ f: () => { g.state.data.pet.stage = st; g.pet.setStage(st); } }, 'f').name(label);
    }
    pf.add({ f: () => { const d = g.state.data.pet; d.adoptedAt -= 15 * 86400000; d.bond = Math.max(d.bond, 400); } }, 'f').name('🌟 觸發長大（少年）');
    pf.add({ f: () => { g.state.data.pet.tokens = 4; g.state.data.pet.napAt = 0; } }, 'f').name('⚡ 技能次數回滿');
    pf.add({ f: () => { g.state.data.pet.giftDay = ''; } }, 'f').name('🎁 今天的禮物重置');
    pf.add({ f: () => {
      const now = g.state.now();
      const i = [...Array(g.farm.count).keys()].find((j) => { const s = g.farm.status(j, now); return s === 'growing' || s === 'dry'; });
      if (i === undefined) { g.hud.toast('先種一些作物'); return; }
      const d = g.state.data;
      d.mice.push({ id: `m${++d.miceSeq}`, plot: i, bornAt: now });
    } }, 'f').name('🐭 放一隻田鼠');
    pf.add(this.view, 'bond', 0, BOND_THRESHOLDS[9], 10).name('親密度點數').onChange((v: number) => { g.state.data.pet.bond = v; });
    pf.add(this.view, 'petAnim', ['none', 'idle', 'walk', 'sit', 'happy', 'dig', 'sleep', 'petted']).name('強制動畫').onChange((a: string) => { g.pet.forcedAnim = a === 'none' ? null : (a as typeof g.pet.forcedAnim); });
    pf.close();

    // ---- 匯出 ----
    gui.add({ f: () => this.exportJson() }, 'f').name('💾 匯出 / 鎖定（JSON）');
    gui.add({ f: () => { if (confirm('清除所有 DEV 微調，恢復預設？')) { localStorage.removeItem(STORE); location.reload(); } } }, 'f').name('↺ 重設所有微調');
  }

  private buildLayoutFolder(parent: GUI) {
    this.layoutFolder?.destroy();
    const g = this.game;
    const lay = g.layout;
    const f = parent.addFolder(`目前：${g.isMobileLayout ? '手機版' : 'PC 版'}`);
    this.layoutFolder = f;
    const apply = () => { g.applyLayout(); this.persist(); };
    const names: Record<HudKey, string> = { status: '等級列', wallet: '金幣與時間', toolbar: '種子工具列', bag: '背包與寵物鈕', queue: '動作佇列', toast: '提示訊息', event: '節慶橫幅' };
    for (const key of Object.keys(lay.hud) as HudKey[]) {
      const it = lay.hud[key];
      const sf = f.addFolder(names[key]);
      sf.add(it, 'anchor', { 左上: 'tl', 右上: 'tr', 左下: 'bl', 右下: 'br', 上中: 'tc', 下中: 'bc' }).name('錨點').onChange(apply);
      sf.add(it, 'x', -600, 600, 1).onChange(apply);
      sf.add(it, 'y', -200, 900, 1).onChange(apply);
      sf.add(it, 'scale', 0.4, 2, 0.01).name('縮放').onChange(apply);
      sf.add(it, 'fontSize', 8, 32, 1).name('字級').onChange(apply);
      sf.addColor(it, 'color').name('文字色').onChange(apply);
      sf.add(it, 'opacity', 0, 1, 0.01).name('透明度').onChange(apply);
      sf.close();
    }
    const cf = f.addFolder('鏡頭');
    const c = lay.camera;
    cf.add(c, 'fov', 15, 70, 1).name('FOV').onChange(apply);
    cf.add(c, 'dist', 8, 50, 0.5).name('預設距離').onChange(() => { g.stage.dist = c.dist; apply(); });
    cf.add(c, 'distMin', 5, 40, 0.5).name('最近').onChange(apply);
    cf.add(c, 'distMax', 10, 70, 0.5).name('最遠').onChange(apply);
    cf.add(c, 'pitch', 20, 85, 1).name('俯角').onChange(apply);
    cf.add(c, 'followDamp', 0.5, 15, 0.1).name('跟隨阻尼').onChange(apply);
    cf.add(c, 'lookAhead', -4, 6, 0.1).name('注視點前移').onChange(apply);
  }

  private placementFolder: GUI | null = null;
  private placement(): { place: PropPlacement; obj: THREE.Object3D } | null {
    const g = this.game;
    if (this.sel.target === 'field') {
      this.proxy.position.set(g.sceneLayout.field.x, 0, g.sceneLayout.field.z);
      return { place: g.sceneLayout.field, obj: this.proxy };
    }
    const p = g.world.props.get(this.sel.target);
    return p ? { place: p.place, obj: p.obj } : null;
  }

  private buildPlacement(parent: GUI) {
    this.placementFolder?.destroy();
    const pl = this.placement();
    if (!pl) return;
    const f = parent.addFolder('數值');
    this.placementFolder = f;
    const apply = () => this.applyPlacement(true);
    f.add(pl.place, 'x', -14, 14, 0.5).onChange(apply);
    f.add(pl.place, 'z', -14, 14, 0.5).onChange(apply);
    f.add(pl.place, 'rotY', -Math.PI, Math.PI, 0.01).name('旋轉').onChange(apply);
    f.add(pl.place, 'scale', 0.3, 3, 0.01).name('縮放').onChange(apply);
  }

  private applyPlacement(rebuildGrid: boolean) {
    const g = this.game;
    if (this.sel.target === 'field') { g.farm.reposition(); }
    else g.world.placeProp(this.sel.target);
    if (rebuildGrid) g.world.rebuildGrid();
    this.persist();
  }

  private onGizmoChange() {
    const pl = this.placement();
    if (!pl) return;
    const o = this.sel.target === 'field' ? this.proxy : pl.obj;
    pl.place.x = Math.round(o.position.x * 2) / 2;
    pl.place.z = Math.round(o.position.z * 2) / 2;
    if (this.sel.target === 'field') { pl.place.x = Math.round(o.position.x); pl.place.z = Math.round(o.position.z); }
    else { pl.place.rotY = o.rotation.y; pl.place.scale = o.scale.x; }
    this.applyPlacement(false);
    this.refreshAll();
  }

  private attachGizmo() {
    const pl = this.placement();
    if (pl) this.tc.attach(pl.obj);
  }

  private setSceneDrag(on: boolean) {
    this.sel.drag = on;
    this.game.inputBlocked = on;
    if (on) this.attachGizmo();
    else this.tc.detach();
    this.refreshAll();
  }

  // HUD 直接拖曳
  private setHudDrag(on: boolean) {
    this.hudDragOn = on;
    document.body.classList.toggle('dev-drag', on);
  }

  private setupHudDrag() {
    let drag: { key: HudKey; x: number; y: number } | null = null;
    this.game.hud.root.addEventListener('pointerdown', (e) => {
      if (!this.hudDragOn) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.hud-el');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { key: el.dataset.hud as HudKey, x: e.clientX, y: e.clientY };
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const it = this.game.layout.hud[drag.key];
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      it.x += it.anchor[1] === 'r' ? -dx : dx;
      it.y += it.anchor[0] === 'b' ? -dy : dy;
      it.x = Math.round(it.x);
      it.y = Math.round(it.y);
      this.game.applyLayout();
    });
    window.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      this.refreshAll();
      this.persist();
    });
  }

  private exportJson() {
    const g = this.game;
    const out = { LAYOUT_PC: g.layouts.pc, LAYOUT_MOBILE: g.layouts.mobile, SCENE_LAYOUT: g.sceneLayout, LIGHT_TWEAKS: g.light, PET_TUNING: g.petTuning };
    const text = JSON.stringify(out, null, 2);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `happyFarm-layout-${Date.now()}.json`;
    a.click();
    console.log('[DEV 匯出]', text);
    g.hud.toast('💾 已匯出：JSON 已複製到剪貼簿並下載', 3000);
    (window as unknown as { __devExport: unknown }).__devExport = clone(out);
  }
}
