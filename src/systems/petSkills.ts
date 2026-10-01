import * as THREE from 'three';
import { dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { bondLevel } from '../data/economy';
import { GEO, mat, mesh } from '../world/materials';
import type { Game } from '../game';
import type { MouseSave } from './state';
import { FIELD_COUNT } from './farm';

// 寵物技能（docs/02 §2）＋田鼠事件
// 技能等級：親密度 1–3 → Lv1、4–6 → Lv2、7+ → Lv3，等級越高越勤勞
const MOUSE_EAT_MS = 6 * 60000; // 田鼠放著 6 分鐘會偷吃
const NAP_COOLDOWN_MS = 10 * 60000;

function buildMouse(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  g.userData.body = body;
  const grey = mat('#9a938c', { roughness: 0.8 }), pink = mat('#ffb0bc', { roughness: 0.8 });
  const b = mesh(GEO.sphere, grey); b.scale.set(0.18, 0.14, 0.24); b.position.y = 0.08;
  const h = mesh(GEO.sphere, grey); h.scale.set(0.13, 0.12, 0.14); h.position.set(0, 0.1, 0.13);
  const n = mesh(GEO.sphereLo, pink, false); n.scale.setScalar(0.03); n.position.set(0, 0.1, 0.2);
  body.add(b, h, n);
  for (const sx of [-1, 1]) {
    const e = mesh(GEO.sphereLo, pink); e.scale.set(0.07, 0.07, 0.02); e.position.set(sx * 0.06, 0.18, 0.1);
    const eye = mesh(GEO.sphereLo, mat('#1d1512', { roughness: 0.2 }), false); eye.scale.setScalar(0.02); eye.position.set(sx * 0.04, 0.12, 0.19);
    body.add(e, eye);
  }
  const tail = mesh(GEO.cyl, pink, false); tail.scale.set(0.012, 0.22, 0.012); tail.rotation.x = 1.2; tail.position.set(0, 0.06, -0.2);
  body.add(tail);
  return g;
}

export class PetSkills {
  private views = new Map<string, { g: THREE.Group; flee: number; dir: THREE.Vector3 }>();
  private decideT = 1;
  private spawnT = 30;
  private napping = false;
  queued = new Set<string>();

  constructor(private game: Game) {}

  get d() { return this.game.state.data.pet; }
  get bondLv(): number { return bondLevel(this.d.bond); }
  get skillLv(): number { const b = this.bondLv; return b >= 7 ? 3 : b >= 4 ? 2 : 1; }
  get mice(): MouseSave[] { return this.game.state.data.mice; }

  mousePos(m: MouseSave): THREE.Vector3 {
    const t = this.game.farm.tileOf(m.plot);
    return new THREE.Vector3(t.x + 0.28, 0, t.z + 0.28);
  }

  // 主角點田鼠：嚇跑牠
  shoo(id: string): void {
    const m = this.mice.find((x) => x.id === id);
    if (!m) return;
    this.flee(m);
    this.game.gainXp(3, this.mousePos(m).setY(0.8), false);
    this.game.hud.toast('🐭 把田鼠趕走了！');
  }

  private flee(m: MouseSave) {
    const v = this.views.get(m.id);
    if (v) { v.flee = 0.001; v.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(); }
    this.game.state.data.mice = this.mice.filter((x) => x.id !== m.id);
    this.queued.delete(m.id);
    sfx.squeak();
  }

  update(dt: number, now: number, night: boolean): void {
    const g = this.game, pet = g.pet, d = this.d;
    const bl = this.bondLv;
    // 親密度解鎖：2 翻肚、3 小帽子、6 領巾
    pet.canRollOver = bl >= 2;
    pet.setAccessories(bl >= 3, bl >= 6);

    // 兔子吃草、小鴨潑水的次數隨時間回復
    const regen = (d.species === 'bunny' ? 20 : 15) * 60000 / [1, 1, 1.4, 2][this.skillLv];
    const cap = d.species === 'bunny' ? 3 : 4;
    if (d.tokens >= cap) d.tokenAt = now;
    while (d.tokens < cap && now - d.tokenAt >= regen) { d.tokens++; d.tokenAt += regen; }

    this.updateMice(dt, now);

    this.decideT -= dt;
    if (this.decideT > 0 || night || pet.busy || pet.state === 'react' || pet.isGrowing) return;
    this.decideT = 1;
    const pp = pet.root.position;
    const near = <T,>(list: T[], pos: (x: T) => { x: number; z: number }, r: number) =>
      list.map((x) => ({ x, d: Math.hypot(pos(x).x - pp.x, pos(x).z - pp.z) })).filter((o) => o.d < r).sort((a, b) => a.d - b.d)[0]?.x;

    // 每日禮物（親密度 5）
    if (bl >= 5 && d.giftDay !== dayKey(now)) {
      const p = g.player.root.position;
      if (Math.hypot(p.x - pp.x, p.z - pp.z) < 4) { d.giftDay = dayKey(now); g.petGift(); return; }
    }

    if (d.species === 'bunny' && d.tokens > 0) {
      const w = near(g.weeds.list, (x) => ({ x: x.tx + x.ox, z: x.tz + x.oz }), 7);
      if (w) {
        pet.doTask(w.tx + w.ox, w.tz + w.oz, 'nibble', 1.6, () => {
          if (!g.weeds.get(w.id)) return;
          d.tokens--;
          g.petEatWeed(w);
        });
      }
    } else if (d.species === 'duck' && d.tokens > 0) {
      const plots = [...Array(g.farm.count).keys()].filter((i) => g.farm.status(i, now) === 'dry');
      const i = near(plots, (x) => g.farm.tileOf(x), 9);
      if (i !== undefined) {
        const t = g.farm.tileOf(i);
        pet.doTask(t.x, t.z, 'splash', 1.3, () => {
          if (g.farm.status(i, g.state.now()) !== 'dry') return;
          d.tokens--;
          g.farm.water(i, g.state.now());
          sfx.water();
          g.particles.burst('water', g.farm.worldPos(i, 0.5), 14, { speed: 1.6, up: 2.2, size: 0.07 });
          g.fx.float(g.farm.worldPos(i, 1), `${pet.name}潑水 💧`, 'item');
        });
      }
    } else if (d.species === 'cat') {
      const m = near(this.mice, (x) => this.mousePos(x), 12);
      if (m) {
        const at = this.mousePos(m);
        pet.doTask(at.x, at.z, 'pounce', 1.0, () => {
          if (!this.mice.find((x) => x.id === m.id)) return;
          this.game.state.data.mice = this.mice.filter((x) => x.id !== m.id);
          const v = this.views.get(m.id);
          if (v) { g.world.root.remove(v.g); this.views.delete(m.id); }
          sfx.squeak();
          sfx.sparkle();
          g.particles.burst('fluff', at.clone().setY(0.2), 10, { speed: 1.5, up: 1.5, gravity: -0.2, size: 0.1, life: 0.7 });
          d.bond += 2;
          g.fx.float(at.clone().setY(1), `${pet.name}抓到田鼠！`, 'love');
        });
        return;
      }
      // 午睡加持：主角閒著、附近有在長的作物 → 趴在田邊睡一下
      if (g.player.idleTime > 10 && now - d.napAt > NAP_COOLDOWN_MS) {
        const growing = [...Array(g.farm.count).keys()].filter((i) => { const s = g.farm.status(i, now); return s === 'growing' || s === 'dry'; });
        const i = near(growing, (x) => g.farm.tileOf(x), 8);
        if (i !== undefined) {
          const t = g.farm.tileOf(i);
          d.napAt = now;
          this.napping = true;
          pet.doTask(t.x + 0.55, t.z + 0.55, 'sleep', 18, () => {
            this.napping = false;
            const boosted = [...Array(g.farm.count).keys()].filter((j) => {
              const tt = g.farm.tileOf(j);
              return g.farm.plot(j).cropId && Math.hypot(tt.x - t.x - 0.5, tt.z - t.z - 0.5) < 1.8;
            });
            boosted.forEach((j) => (g.farm.plot(j).boost = true));
            if (boosted.length) {
              g.hud.toast(`😺 ${pet.name}在田邊午睡，周圍 ${boosted.length} 塊作物的品質會變好`, 3000);
              boosted.forEach((j) => g.particles.burst('sparkle', g.farm.worldPos(j, 0.4), 3, { speed: 0.6, up: 1, size: 0.3 }));
            }
          });
        }
      }
    }
  }

  get isNapping(): boolean { return this.napping; }

  private updateMice(dt: number, now: number) {
    const g = this.game;
    // 生成：有正在長的作物時偶爾出現（最多 2 隻）
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 45;
      const growing = [...Array(g.farm.count).keys()].filter((i) => { const s = g.farm.status(i, now); return i < FIELD_COUNT && (s === 'growing' || s === 'dry') && !this.mice.some((m) => m.plot === i); });
      if (growing.length && this.mice.length < 2 && Math.random() < 0.14) {
        const plot = growing[Math.floor(Math.random() * growing.length)];
        const sd = g.state.data;
        sd.mice.push({ id: `m${++sd.miceSeq}`, plot, bornAt: now });
      }
    }
    // 放太久：偷吃一點進度後跑掉（不會讓作物消失）
    for (const m of [...this.mice]) {
      const p = g.farm.plot(m.plot);
      if (!p.cropId) { this.flee(m); continue; }
      if (now - m.bornAt > MOUSE_EAT_MS) {
        const prog = g.farm.progress(m.plot, now);
        p.p0 = Math.max(0, prog - 0.25);
        p.snapAt = now;
        this.flee(m);
        g.hud.toast('🐭 田鼠偷吃了一點作物就跑了…下次早點趕走牠');
      }
    }
    // 畫面
    const t = performance.now() / 1000;
    for (const m of this.mice) {
      let v = this.views.get(m.id);
      if (!v) {
        const gr = buildMouse();
        g.world.root.add(gr);
        v = { g: gr, flee: 0, dir: new THREE.Vector3() };
        this.views.set(m.id, v);
      }
      const pos = this.mousePos(m);
      v.g.position.copy(pos);
      v.g.rotation.y = Math.sin(t * 0.7 + m.plot) * 0.8;
      const body = v.g.userData.body as THREE.Group;
      body.position.y = Math.abs(Math.sin(t * 9)) * 0.02;
      body.rotation.x = 0.25 + Math.sin(t * 14) * 0.06; // 低頭啃
      body.scale.setScalar(this.queued.has(m.id) ? 1.15 : 1);
    }
    // 逃跑中的田鼠：往外衝然後消失
    for (const [id, v] of this.views) {
      if (this.mice.some((m) => m.id === id)) continue;
      if (!v.flee) { g.world.root.remove(v.g); this.views.delete(id); continue; }
      v.flee += dt;
      v.g.position.addScaledVector(v.dir, dt * 5);
      v.g.rotation.y = Math.atan2(v.dir.x, v.dir.z);
      (v.g.userData.body as THREE.Group).position.y = Math.abs(Math.sin(t * 30)) * 0.05;
      if (v.flee > 1.2) { g.world.root.remove(v.g); this.views.delete(id); }
    }
  }
}
