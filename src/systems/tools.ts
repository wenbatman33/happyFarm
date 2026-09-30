import * as THREE from 'three';
import { sfx } from '../core/audio';
import { ROBOT_PER_HOUR, TOOLS, type ToolTier } from '../data/economy';
import { Mover } from '../actors/mover';
import { GEO, mat, mesh, withRim } from '../world/materials';
import { Sheet, row } from '../ui/sheet';
import { ITEM_INFO } from '../ui/hud';
import type { Game } from '../game';
import type { ToolId, WeedSave } from './state';

// 工具升級（docs/03 §4.4、§5）：木匠老木的工具箱＋除草小機器人
const ORDER: ToolId[] = ['can', 'hoe', 'sickle', 'pick', 'axe', 'robot'];
const SICKLE_AUTO = 6; // 小鐮刀 Lv6 自動拿到
const ROBOT_SKIP = new Set(['dandelion', 'leaves', 'snow', 'big']); // 稀有草、季節雜草留給玩家

function buildRobot(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  g.userData.body = body;
  const white = withRim(mat('#f4f1ea', { roughness: 0.35 })), mint = withRim(mat('#6fd0b8', { roughness: 0.4 }));
  const dark = mat('#3a3f46', { roughness: 0.5 });
  const base = mesh(GEO.cyl, mint); base.scale.set(0.5, 0.18, 0.5); base.position.y = 0.16;
  const dome = mesh(GEO.sphere, white); dome.scale.set(0.46, 0.4, 0.46); dome.position.y = 0.32;
  const face = mesh(GEO.sphereLo, dark, false); face.scale.set(0.3, 0.16, 0.08); face.position.set(0, 0.36, 0.2);
  const eyeM = mat('#8ff7ff', { emissive: '#4fe8ff', emissiveIntensity: 1.6 });
  for (const sx of [-1, 1]) { const e = mesh(GEO.sphereLo, eyeM, false); e.scale.setScalar(0.06); e.position.set(sx * 0.07, 0.37, 0.245); body.add(e); }
  const ant = mesh(GEO.cyl, dark, false); ant.scale.set(0.015, 0.16, 0.015); ant.position.y = 0.58;
  const bulb = mesh(GEO.sphereLo, mat('#ffcf4a', { emissive: '#ffb020', emissiveIntensity: 1.5 }), false); bulb.scale.setScalar(0.07); bulb.position.y = 0.67;
  // 前面的小割草刀
  const blade = mesh(GEO.cyl, mat('#c9ced6', { metalness: 0.6, roughness: 0.3 }), false); blade.scale.set(0.34, 0.02, 0.34); blade.position.set(0, 0.06, 0.28);
  body.add(base, dome, face, ant, bulb, blade);
  g.userData.blade = blade;
  for (const sx of [-1, 1]) { const w = mesh(GEO.cyl, dark); w.scale.set(0.14, 0.06, 0.14); w.rotation.z = Math.PI / 2; w.position.set(sx * 0.26, 0.08, -0.05); g.add(w); }
  g.scale.setScalar(0.9);
  return g;
}

export class Tools {
  sheet = new Sheet('tools-panel', '🧰 工具箱');
  robot: THREE.Group | null = null;
  private robotMover: Mover | null = null;
  private robotT = 0;
  private robotBusy = false;
  private home = { x: -7.2, z: -2.2 };

  constructor(private game: Game) {
    this.sheet.onAction = (a) => { if (a.startsWith('up:')) this.upgrade(a.slice(3) as ToolId); };
  }

  tier(id: ToolId): number {
    const d = this.game.state.data;
    const t = d.tools[id] ?? 0;
    return id === 'sickle' && d.level >= SICKLE_AUTO ? Math.max(1, t) : t;
  }

  // 每下的威力（鎬、斧）
  power(tool: 'pick' | 'axe'): number { return [1, 2, 99][this.tier(tool)]; }
  // 鐮刀範圍與一次最多幾株
  sickleReach(): { r: number; n: number } { return this.tier('sickle') >= 2 ? { r: 2.0, n: 6 } : { r: 1.3, n: 3 }; }
  // 澆水壺、鋤頭的作用範圍：0 單格、1 一排 3 格、2 3×3
  area(tool: 'can' | 'hoe', i: number): number[] {
    const f = this.game.farm;
    const t = f.tileOf(i);
    const tier = this.tier(tool);
    const out = [i];
    if (tier <= 0) return out;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if (tier === 1 && dz) continue;
      const j = f.indexAt(t.x + dx, t.z + dz);
      if (j >= 0 && f.owned(j)) out.push(j);
    }
    return out;
  }

  private cost(t: ToolTier): string {
    return `🪙${t.coins.toLocaleString()}${t.wood ? ` 🪵${t.wood}` : ''}${t.stone ? ` 🪨${t.stone}` : ''}`;
  }

  open(): void {
    sfx.paper();
    this.sheet.show();
    this.render();
  }

  render(): void {
    if (!this.sheet.open) return;
    const d = this.game.state.data;
    const inv = d.inventory;
    const html = `<div class="jn-season"><b>木匠老木：</b>「工具好，做事就輕鬆。不過拔草這件事，還是留一點給自己的手吧！」</div>` +
      ORDER.map((id) => {
        const def = TOOLS[id];
        const cur = this.tier(id);
        const now = def.tiers[cur];
        const next = def.tiers[cur + 1];
        if (!next) return row(def.emoji, `${now.name} <small>已經是最好的了</small>`, now.desc, '', null, 'done');
        const lack = d.level < next.level ? `Lv${next.level}` : d.coins < next.coins || (inv.wood ?? 0) < (next.wood ?? 0) || (inv.stone ?? 0) < (next.stone ?? 0) ? '材料不足' : '';
        const sub = `現在：${now.name}${now.desc ? `（${now.desc}）` : ''}<br>下一級：<b>${next.name}</b> — ${next.desc}<br><span class="${lack ? '' : 'ok'}">${this.cost(next)}</span>`;
        return row(def.emoji, def.name, sub, lack || '升級', lack ? null : `up:${id}`);
      }).join('');
    this.sheet.render(html);
  }

  upgrade(id: ToolId): void {
    const d = this.game.state.data;
    const cur = this.tier(id);
    const next = TOOLS[id].tiers[cur + 1];
    if (!next || d.level < next.level || d.coins < next.coins || (d.inventory.wood ?? 0) < (next.wood ?? 0) || (d.inventory.stone ?? 0) < (next.stone ?? 0)) return;
    d.coins -= next.coins;
    if (next.wood) this.game.state.addItem('wood', -next.wood);
    if (next.stone) this.game.state.addItem('stone', -next.stone);
    d.tools[id] = cur + 1;
    sfx.hammer(1);
    window.setTimeout(() => sfx.fanfare(), 250);
    this.game.hud.toast(`${TOOLS[id].emoji} 拿到了${next.name}！${next.desc}`, 3400);
    if (id === 'robot') { d.robotAt = this.game.state.now(); this.ensureRobot(); }
    this.game.state.save();
    this.render();
  }

  // ---------- 除草小機器人 ----------
  ensureRobot(): void {
    if (this.robot || this.game.state.data.tools.robot < 1) return;
    this.robot = buildRobot();
    this.robot.position.set(this.home.x, 0, this.home.z);
    this.game.world.root.add(this.robot);
    this.robotMover = new Mover(this.robot, this.game.grid);
    this.robotMover.speed = 1.8;
  }

  private eligible(): WeedSave[] {
    return this.game.weeds.list.filter((w) => !ROBOT_SKIP.has(w.kind) && !w.by && !this.game.weeds.queued.has(w.id));
  }

  // 離線期間機器人做的事：每小時 5 株，回來時直接結算
  catchUp(now: number): number {
    const d = this.game.state.data;
    if (d.tools.robot < 1) return 0;
    const hours = (now - d.robotAt) / 3600000;
    const n = Math.min(Math.floor(hours * ROBOT_PER_HOUR), this.eligible().length);
    if (hours >= 0.2) d.robotAt = now;
    let got = 0;
    for (const w of this.eligible().slice(0, n)) { this.game.weeds.remove(w.id); this.game.state.addItem('weed', w.kind === 'bush' ? 2 : 1); got++; }
    return got;
  }

  update(dt: number, now: number): void {
    const d = this.game.state.data;
    if (d.tools.robot < 1) return;
    this.ensureRobot();
    const r = this.robot!;
    const t = performance.now() / 1000;
    (r.userData.body as THREE.Object3D).position.y = Math.abs(Math.sin(t * 6)) * 0.02 * (this.robotMover!.moving ? 1 : 0.3);
    (r.userData.blade as THREE.Object3D).rotation.y += dt * (this.robotBusy ? 30 : 2);
    this.robotMover!.update(dt);
    if (this.robotBusy) return;
    // 每 12 分鐘處理一株（每小時 5 株）；DEV 快轉時也會跟上
    this.robotT -= dt;
    if (this.robotT > 0) return;
    this.robotT = 2;
    if (now - d.robotAt < 3600000 / ROBOT_PER_HOUR) return;
    const list = this.eligible();
    if (!list.length) { d.robotAt = now; if (!this.robotMover!.moving && Math.hypot(r.position.x - this.home.x, r.position.z - this.home.z) > 0.5) this.robotMover!.goTo(this.home.x, this.home.z); return; }
    const w = list.sort((a, b) => Math.hypot(a.tx - r.position.x, a.tz - r.position.z) - Math.hypot(b.tx - r.position.x, b.tz - r.position.z))[0];
    this.robotBusy = true;
    d.robotAt += 3600000 / ROBOT_PER_HOUR;
    const ok = this.robotMover!.goTo(w.tx + w.ox, w.tz + w.oz, () => {
      window.setTimeout(() => {
        this.robotBusy = false;
        if (!this.game.weeds.get(w.id)) return;
        const pos = this.game.weeds.worldPos(w, 0.3);
        this.game.weeds.remove(w.id);
        this.game.state.addItem('weed', w.kind === 'bush' ? 2 : 1);
        this.game.particles.burst('grass', pos, 10, { speed: 2, up: 2.5, size: 0.8 });
        this.game.fx.fly(pos, ITEM_INFO.weed.emoji, this.game.hud.el('bag'));
        this.game.soundAt('swish', pos);
      }, 700);
    }, 0.45);
    if (!ok) this.robotBusy = false;
  }
}
