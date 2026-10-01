import * as THREE from 'three';
import { clock, dayKey } from '../core/clock';
import { sfx } from '../core/audio';
import { NIGHT_FLOWER_BOOST, bondLevel } from '../data/economy';
import { ITEM_INFO } from '../ui/hud';
import type { Game } from '../game';
import type { MenuView } from '../ui/hud';

// 星空觀測（第 10 章，天文台爺爺）：晚上偶爾劃過流星，點「許願」拿小禮物；望遠鏡可以看星空（今晚必定有一顆流星）
// 第 10 章之後夜間花成長 ×1.25
ITEM_INFO.stardust = { name: '星塵', emoji: '✨', price: 300 };

const CONSTELLATION: Record<string, string> = { spring: '獅子座', summer: '天蠍座', autumn: '飛馬座', winter: '獵戶座' };

// 一道流星：發光的頭＋漸淡的尾巴
function buildStreak(): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshBasicMaterial({ color: '#fffbe0' }));
  const tailGeo = new THREE.ConeGeometry(0.5, 16, 8, 1, true);
  tailGeo.rotateZ(Math.PI / 2);
  tailGeo.translate(8, 0, 0);
  const tail = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(head, tail);
  g.visible = false;
  return g;
}

export class Stars {
  private streak = buildStreak();
  private t = -1; // 流星進行中的時間（-1＝沒有）
  private nextT = 60;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private btn: HTMLButtonElement;
  private wishable = false;
  private scopeT = 0;
  private meteor: HTMLElement;

  constructor(private game: Game) {
    game.stage.scene.add(this.streak);
    // 一般遊戲鏡頭往下看，畫面裡沒有天空：另外在畫面上方劃一道流星光痕
    this.meteor = document.createElement('div');
    this.meteor.id = 'meteor';
    document.body.appendChild(this.meteor);
    this.btn = document.createElement('button');
    this.btn.id = 'wish-btn';
    this.btn.className = 'hidden';
    this.btn.innerHTML = '🌠 流星！點我許願';
    this.btn.onclick = () => this.wish();
    this.btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.btn);
  }

  get unlocked(): boolean { return this.game.calendar.chapterOpen(10, this.game.state.now()); }

  // 夜晚：20:00–04:00
  private isNight(): boolean { const h = clock.hour(this.game.state.now()); return h >= 20 || h < 4; }

  launch(): void {
    const g = this.game;
    const c = g.stage.camera.position;
    // 從鏡頭前方的天空一側劃到另一側
    const yaw = g.stage.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const s = Math.random() < 0.5 ? 1 : -1;
    const base = c.clone().addScaledVector(fwd, 60);
    this.from.copy(base).addScaledVector(side, -26 * s).setY(c.y + 22 + Math.random() * 6);
    this.to.copy(base).addScaledVector(side, 20 * s).setY(c.y + 8 + Math.random() * 5);
    this.t = 0;
    this.streak.visible = true;
    this.wishable = true;
    this.btn.classList.remove('hidden');
    this.meteor.style.top = `${6 + Math.random() * 14}%`;
    this.meteor.style.left = `${62 + Math.random() * 22}%`;
    this.meteor.classList.remove('go');
    void this.meteor.offsetWidth;
    this.meteor.classList.add('go');
    sfx.at(0.6, () => sfx.chime());
  }

  wish(): void {
    if (!this.wishable) return;
    this.wishable = false;
    this.btn.classList.add('hidden');
    const g = this.game;
    const d = g.state.data;
    d.stars.wishes++;
    const r = Math.random();
    const at = g.player.root.position.clone().setY(1.8);
    let text: string;
    if (r < 0.06) { g.state.addItem('giantseed'); text = '🌰 巨型種子'; }
    else if (r < 0.3) { g.state.addItem('stardust'); g.progression.record('stardust'); text = '✨ 一顆星塵（收藏品）'; }
    else if (r < 0.55) { g.state.addItem('fert', 3); text = '🧪 有機肥 ×3'; }
    else if (r < 0.75) { const before = bondLevel(d.pet.bond); d.pet.bond += 25; g.pet.react(); text = `💕 ${g.pet.name}的親密度 +25${bondLevel(d.pet.bond) > before ? '（升級了！）' : ''}`; }
    else { const c = 200 + Math.floor(Math.random() * 600); d.coins += c; text = `🪙 ${c} 金幣`; }
    sfx.sparkle();
    g.particles.burst('fw1', at, 18, { speed: 2.4, up: 2, size: 0.45, life: 1.2, gravity: 0.5 });
    g.hud.toast(`🌠 願望實現了：${text}`, 3200);
    g.state.save();
  }

  // ---------- 望遠鏡 ----------
  menu(): MenuView {
    const g = this.game;
    const d = g.state.data;
    const night = this.isNight();
    const season = g.season;
    const seen = d.stars.scope === dayKey(g.state.now() - 6 * 3600000);
    return {
      title: '🔭 天文台爺爺的望遠鏡',
      sub: night ? `今晚看得到${CONSTELLATION[season]}。已經許了 ${d.stars.wishes} 個願望` : '白天看不到星星，晚上 8 點以後再來',
      items: [{ act: 'look', emoji: '🌌', label: '看星空', enabled: night, note: night ? (seen ? '今晚已經看過流星了' : '說不定會看到流星') : '要等晚上' }],
    };
  }

  onAct(act: string): void {
    const g = this.game;
    if (act !== 'look' || !this.isNight()) return;
    const tp = g.sceneLayout.telescope;
    g.enqueue({ kind: 'move', x: tp.x + 0.8, z: tp.z + 0.9 });
    // 鏡頭往上看天空
    const p = g.stage.target.clone();
    g.stage.closeUp(new THREE.Vector3(p.x, 9, p.z - 8), 12, -8, g.stage.yaw);
    this.scopeT = 6;
    const night = dayKey(g.state.now() - 6 * 3600000); // 晚上跨午夜算同一晚
    if (g.state.data.stars.scope !== night) {
      g.state.data.stars.scope = night;
      window.setTimeout(() => this.launch(), 1800); // 今晚第一次看：一定有流星
    }
    g.hud.toast(`🌌 是${CONSTELLATION[g.season]}！`, 2600);
  }

  update(dt: number): void {
    const g = this.game;
    g.farm.nightBoost = this.unlocked ? NIGHT_FLOWER_BOOST : 1;
    if (this.scopeT > 0) { this.scopeT -= dt; if (this.scopeT <= 0) g.stage.closeUp(null); }
    // 流星飛行 1.6 秒，許願按鈕多留 2.5 秒
    if (this.t >= 0) {
      this.t += dt;
      const k = Math.min(1, this.t / 1.6);
      this.streak.position.lerpVectors(this.from, this.to, k);
      this.streak.lookAt(this.to);
      this.streak.rotateY(Math.PI / 2);
      this.streak.scale.setScalar(1 - k * 0.6);
      if (k >= 1) this.streak.visible = false;
      if (this.t > 4.1) { this.t = -1; this.wishable = false; this.btn.classList.add('hidden'); }
      return;
    }
    if (!this.unlocked || !this.isNight() || g.interior.active || g.social.visiting || g.onboarding) return;
    this.nextT -= dt;
    if (this.nextT <= 0) { this.nextT = 90 + Math.random() * 150; this.launch(); }
  }
}
