import * as THREE from 'three';
import { sfx } from '../core/audio';
import { mat, mesh } from '../world/materials';
import type { Game } from '../game';

// 新手引導（docs/01 §7）：奶奶的信 → 拔草 → 翻土 → 播種 → 澆水 → 摸狗 → 收成 → 交訂單 → 看看花花
interface Step {
  hint: string;
  done: (g: Game) => boolean;
  target: (g: Game) => THREE.Vector3 | null;
}

const LETTER = `
  <p>親愛的孩子：</p>
  <p>奶奶年紀大了，這座農場就交給你了。</p>
  <p>房子周圍的草長得好高，田也荒了好久，</p>
  <p>不過別擔心，<b>麻糬</b>會陪著你，</p>
  <p>牧場裡的<b>花花</b>也很期待見到你。</p>
  <p>慢慢來，把這裡變回熱鬧的家吧！</p>
  <p class="sign">—— 愛你的奶奶 🌻</p>`;

export class Tutorial {
  private arrow = new THREE.Group();
  private t = 0;
  private cheerT = 0;
  private steps: Step[];

  constructor(private game: Game) {
    // 3D 指示箭頭：橘色、會上下彈跳
    const m = mat('#ff9f2a', { emissive: '#ff7a00', emissiveIntensity: 0.6, roughness: 0.4 });
    const head = mesh(new THREE.ConeGeometry(0.28, 0.42, 16), m, false);
    head.rotation.x = Math.PI;
    const shaft = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 12), m, false);
    shaft.position.y = 0.38;
    this.arrow.add(head, shaft);
    this.arrow.visible = false;
    game.stage.scene.add(this.arrow);

    const plotWhere = (g: Game, test: (i: number) => boolean) => {
      for (let i = 0; i < g.farm.count; i++) if (test(i)) return g.farm.worldPos(i, 0.9);
      return null;
    };
    this.steps = [
      { hint: '', done: () => true, target: () => null }, // 0：讀信
      {
        hint: '👆 點房子周圍的雜草，拔掉 3 株（按住拖曳可以連續拔）',
        done: (g) => g.state.data.stats.weedsPulled >= 3,
        target: (g) => {
          const p = g.player.root.position;
          const w = [...g.weeds.list].sort((a, b) => Math.hypot(a.tx - p.x, a.tz - p.z) - Math.hypot(b.tx - p.x, b.tz - p.z))[0];
          return w ? g.weeds.worldPos(w, 1.0) : null;
        },
      },
      {
        hint: '🟫 點一塊田地翻土',
        done: (g) => g.state.data.plots.some((p) => p.owned && p.tilled),
        target: (g) => plotWhere(g, (i) => g.farm.plot(i).owned && !g.farm.plot(i).tilled),
      },
      {
        hint: '🌱 再點一下翻好的土，種下蘿蔔',
        done: (g) => g.state.data.plots.some((p) => p.cropId) || g.state.data.stats.harvests > 0,
        target: (g) => plotWhere(g, (i) => g.farm.plot(i).tilled && !g.farm.plot(i).cropId),
      },
      {
        hint: '💧 再點一下澆水，蘿蔔 1 分鐘就會長好',
        done: (g) => g.state.data.plots.some((p) => p.cropId && p.wetUntil > g.state.now()) || g.state.data.stats.harvests > 0,
        target: (g) => plotWhere(g, (i) => !!g.farm.plot(i).cropId),
      },
      {
        hint: '🐶 等蘿蔔長大的時候，點麻糬摸摸牠',
        done: (g) => g.state.data.pet.bond >= 10 || g.state.data.stats.harvests > 0,
        target: (g) => g.pet.root.position.clone().setY(1.3),
      },
      {
        hint: '🧺 蘿蔔熟了！點它收成（還沒熟就再等一下下）',
        done: (g) => g.state.data.stats.harvests > 0,
        target: (g) => plotWhere(g, (i) => !!g.farm.plot(i).cropId),
      },
      {
        hint: '📬 點郵筒打開訂單板，交出第一張訂單',
        done: (g) => g.state.data.stats.ordersDone > 0,
        target: (g) => { const m = g.sceneLayout.mailbox; return new THREE.Vector3(m.x, 1.9, m.z); },
      },
      {
        hint: '🐄 去左邊的牧場看看花花吧',
        done: (g) => g.state.data.cows[0].affection > 0,
        target: (g) => g.ranch.cow.root.position.clone().setY(2.6),
      },
    ];
  }

  get active(): boolean { return this.game.state.data.tutorial >= 0; }

  // 新遊戲：先讀奶奶的信
  async start(): Promise<void> {
    const d = this.game.state.data;
    if (d.tutorial !== 0) return;
    sfx.paper();
    await this.game.hud.letter(LETTER, '開始整理農場 🌱');
    sfx.ui();
    d.tutorial = 1;
  }

  update(dt: number): string {
    const g = this.game, d = g.state.data;
    this.t += dt;
    this.cheerT -= dt;
    if (d.tutorial < 1) { this.arrow.visible = false; return ''; }
    const step = this.steps[d.tutorial];
    if (!step) { this.arrow.visible = false; return ''; }
    if (step.done(g)) {
      d.tutorial++;
      if (d.tutorial >= this.steps.length) {
        d.tutorial = -1;
        sfx.fanfare();
        g.hud.toast('🎉 新手引導完成！接下來就自由經營你的農場吧', 3600);
        this.arrow.visible = false;
        return '';
      }
      if (this.cheerT <= 0) { sfx.sparkle(); this.cheerT = 1; }
      return this.steps[d.tutorial].hint;
    }
    const at = step.target(g);
    this.arrow.visible = !!at;
    if (at) {
      this.arrow.position.set(at.x, at.y + 0.35 + Math.abs(Math.sin(this.t * 4)) * 0.3, at.z);
      this.arrow.rotation.y += dt * 2;
    }
    return step.hint;
  }
}
