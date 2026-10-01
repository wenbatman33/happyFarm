import * as THREE from 'three';
import { sfx } from '../core/audio';
import { dayKey } from '../core/clock';
import { PET_ADOPT_COINS, PET_HOUSE_T2, bondLevel } from '../data/economy';
import { Pet, SPECIES, GROWTH, type Species } from '../actors/pet';
import { Sheet, row } from '../ui/sheet';
import type { Game } from '../game';
import type { Player } from '../actors/player';
import { freshPet, type PetSave } from './state';

// 寵物小屋（第 6 章，獸醫白醫生）：小屋升級後可以收養其他寵物（每種一隻，最多 4 隻），
// 選一隻帶出門（技能跟著出門的那隻），其他的在小屋附近玩、晚上回小屋睡
const ALL: Species[] = ['corgi', 'cat', 'bunny', 'duck'];

export class PetHouse {
  sheet = new Sheet('pethouse-panel', '🏡 寵物小屋');
  homePets: Pet[] = [];
  private anchors: { root: THREE.Object3D; idleTime: number }[] = [];

  constructor(private game: Game) {
    this.sheet.onAction = (a) => void this.act(a);
  }

  get d() { return this.game.state.data; }
  get unlocked(): boolean { return this.game.calendar.chapterOpen(6, this.game.state.now()); }
  owned(): Species[] { return [this.d.pet.species, ...this.d.pets.map((p) => p.species)]; }

  // ---------- 在家的寵物 ----------
  syncViews(): void {
    const g = this.game;
    for (const p of this.homePets) g.stage.scene.remove(p.root);
    this.homePets = [];
    this.anchors = [];
    const dh = g.sceneLayout.doghouse;
    this.d.pets.forEach((ps, i) => {
      const pet = new Pet(g.grid, ps.species, ps.name);
      pet.setStage(ps.stage, true);
      const bl = bondLevel(ps.bond);
      pet.canRollOver = bl >= 2;
      pet.setAccessories(bl >= 3, bl >= 6);
      const outfit = this.d.wardrobe.petOutfit[ps.species];
      if (outfit) pet.setOutfit(outfit);
      const a = (i / Math.max(1, this.d.pets.length)) * Math.PI * 2;
      pet.root.position.set(dh.x + Math.cos(a) * 1.6, 0, dh.z + 1.4 + Math.sin(a) * 0.8);
      pet.root.userData.homePet = i;
      g.stage.scene.add(pet.root);
      pet.onBark = () => g.petVoice(ps.species);
      pet.onZzz = (at) => g.particles.burst('zzz', at, 1, { speed: 0.15, up: 0.5, gravity: -0.2, size: 0.28, life: 2.2 });
      this.homePets.push(pet);
      // 假的「主人」：一個在小屋前面慢慢飄的點，讓牠們在附近閒晃
      const anchor = new THREE.Object3D();
      anchor.position.set(dh.x + Math.cos(a) * 1.4, 0, dh.z + 1.6);
      this.anchors.push({ root: anchor, idleTime: 99 });
    });
  }

  private growT = 5;

  // 在家的寵物也會長大（規則跟出門的那隻一樣）
  private grow() {
    const now = this.game.state.now();
    this.d.pets.forEach((ps, i) => {
      const days = (now - ps.adoptedAt) / 86400000;
      const b = bondLevel(ps.bond);
      const want = days >= 60 && b >= 6 ? 2 : days >= 14 && b >= 3 ? 1 : 0;
      if (want > ps.stage) { ps.stage = want; this.homePets[i]?.setStage(want); }
    });
  }

  update(dt: number, night: boolean): void {
    const g = this.game;
    this.growT -= dt;
    if (this.growT <= 0) { this.growT = 5; this.grow(); }
    const dh = g.sceneLayout.doghouse;
    const t = performance.now() / 1000;
    this.homePets.forEach((pet, i) => {
      const an = this.anchors[i];
      // 錨點緩慢繞著小屋前的空地移動
      an.root.position.set(dh.x + Math.cos(t * 0.05 + i * 2) * 2.2, 0, dh.z + 1.8 + Math.sin(t * 0.07 + i) * 1.2);
      if (g.interior.active || g.social.visiting) { pet.root.visible = false; return; }
      pet.root.visible = true;
      if (g.pond.swimming(pet)) { pet.update(dt, { player: an as unknown as Player, night: false, doghouse: { x: dh.x, z: dh.z, rotY: dh.rotY }, treasures: [], followDist: 99 }); return; }
      pet.update(dt, { player: an as unknown as Player, night, doghouse: { x: dh.x + (i - 1) * 0.6, z: dh.z, rotY: dh.rotY }, treasures: [], followDist: 1.6 });
    });
  }

  // 點到在家的寵物
  petAt(ray: THREE.Raycaster): number {
    for (let i = 0; i < this.homePets.length; i++) if (this.homePets[i].root.visible && ray.intersectObject(this.homePets[i].root, true).length) return i;
    return -1;
  }

  homeAnchor(i: number): THREE.Vector3 { return this.homePets[i]?.root.position.clone().setY(1.3) ?? new THREE.Vector3(); }

  homeMenu(i: number) {
    const ps = this.d.pets[i];
    const left = this.touchesLeft(ps);
    return {
      title: `${SPECIES[ps.species].emoji} ${ps.name}`,
      sub: `${GROWTH[ps.stage].label}${SPECIES[ps.species].label} · 親密度 ${bondLevel(ps.bond)}`,
      items: [
        { act: 'pet', emoji: '🤚', label: '摸摸', enabled: left > 0, note: left > 0 ? `今天還可以 ${left} 次` : '今天摸夠了' },
        { act: 'take', emoji: '🚶', label: '帶牠出門', enabled: true, note: `技能：${SPECIES[ps.species].skill.slice(0, 10)}…` },
      ],
    };
  }

  private touchesLeft(ps: PetSave): number {
    const day = dayKey(this.game.state.now());
    if (ps.touchDay !== day) { ps.touchDay = day; ps.touches = 0; }
    return 3 - ps.touches;
  }

  onHomeAct(i: number, act: string): void {
    const g = this.game;
    const ps = this.d.pets[i];
    const pet = this.homePets[i];
    if (!ps || !pet) return;
    if (act === 'pet') {
      if (this.touchesLeft(ps) <= 0) return;
      ps.touches++;
      ps.bond += 10;
      pet.startPetted(g.player.root.position.x, g.player.root.position.z);
      g.player.mover.face(pet.root.position.x, pet.root.position.z);
      g.player.play('pet');
      g.petVoice(ps.species);
      g.particles.burst('heart', pet.root.position.clone().setY(0.9), 6, { speed: 1, up: 1.5, size: 0.35, life: 1.2 });
      g.fx.float(pet.root.position.clone().setY(1), '+10 ♥', 'love');
      g.progression.track('pet');
    } else if (act === 'take') this.switchTo(i);
  }

  // 換一隻帶出門：資料互換，模型重建
  switchTo(i: number): void {
    const g = this.game;
    const d = this.d;
    const next = d.pets[i];
    if (!next) return;
    const oldPos = g.pet.root.position.clone();
    const newPos = this.homePets[i].root.position.clone();
    d.pets[i] = d.pet;
    d.pet = next;
    g.pet.setSpecies(next.species);
    g.pet.name = next.name;
    g.pet.setStage(next.stage, true);
    g.pet.setFestiveHat(d.petHat);
    g.pet.setOutfit(d.wardrobe.petOutfit[next.species] ?? '');
    g.pet.root.position.copy(newPos);
    g.pet.mover.stop();
    g.pet.state = 'idle';
    this.syncViews();
    this.homePets[i]?.root.position.copy(oldPos);
    g.pet.react();
    g.petVoice(next.species);
    sfx.sparkle();
    g.hud.toast(`${SPECIES[next.species].emoji} 今天帶${next.name}出門！技能：${SPECIES[next.species].skill}`, 3400);
    g.refreshHud();
    g.state.save();
  }

  // ---------- 面板 ----------
  open(): void {
    sfx.paper();
    this.sheet.show();
    this.render();
  }

  render(): void {
    if (!this.sheet.open) return;
    const d = this.d;
    const tier = d.petHouse;
    let html = `<div class="jn-season"><b>白醫生：</b>「${tier >= 2 ? '小屋變大了，可以多照顧幾個小傢伙囉。每種寵物一隻，最多四隻。' : '把小屋整修大一點，就能收養更多寵物。'}」</div>`;
    html += `<div class="jn-sec">🐾 我的寵物</div>`;
    html += row(SPECIES[d.pet.species].emoji, `${d.pet.name} <small>${GROWTH[d.pet.stage].label}${SPECIES[d.pet.species].label} · ♥${bondLevel(d.pet.bond)}</small>`, `正在陪你 · ${SPECIES[d.pet.species].skill}`, '出門中', null, 'done');
    d.pets.forEach((p, i) => {
      html += row(SPECIES[p.species].emoji, `${p.name} <small>${GROWTH[p.stage].label}${SPECIES[p.species].label} · ♥${bondLevel(p.bond)}</small>`, `在小屋玩 · ${SPECIES[p.species].skill}`, '帶出門', `take:${i}`);
    });
    if (tier < 2) {
      const lack = d.coins < PET_HOUSE_T2.coins || (d.inventory.wood ?? 0) < PET_HOUSE_T2.wood;
      html += `<div class="jn-sec">🔨 小屋升級</div>` + row('🏡', '升級成雙門寵物小屋', `可以收養更多寵物 · 🪙${PET_HOUSE_T2.coins.toLocaleString()} 🪵${PET_HOUSE_T2.wood}`, lack ? '材料不足' : '升級', lack ? null : 'upgrade');
    } else {
      const avail = ALL.filter((s) => !this.owned().includes(s));
      if (avail.length) {
        html += `<div class="jn-sec">💝 收養 <small>手續費 🪙${PET_ADOPT_COINS.toLocaleString()}</small></div>
          <div class="fr-add"><input class="fr-input pet-name" maxlength="8" placeholder="幫牠取名字（不填就用預設）"></div>`;
        html += avail.map((s) => row(SPECIES[s].emoji, `${SPECIES[s].label} <small>${SPECIES[s].personality}</small>`, `${SPECIES[s].skill}<br>${SPECIES[s].passive}`, '收養', d.coins >= PET_ADOPT_COINS ? `adopt:${s}` : null)).join('');
      } else html += `<div class="jn-season"><small>四種寵物都到齊了！</small></div>`;
    }
    this.sheet.render(html);
  }

  private async act(a: string) {
    const g = this.game;
    const d = this.d;
    if (a === 'upgrade') {
      if (d.petHouse >= 2 || d.coins < PET_HOUSE_T2.coins || (d.inventory.wood ?? 0) < PET_HOUSE_T2.wood) return;
      d.coins -= PET_HOUSE_T2.coins;
      g.state.addItem('wood', -PET_HOUSE_T2.wood);
      d.petHouse = 2;
      g.world.setPetHouseTier(2);
      g.world.rebuildGrid();
      sfx.fanfare();
      const dh = g.sceneLayout.doghouse;
      g.particles.burst('sparkle', new THREE.Vector3(dh.x, 1, dh.z), 20, { speed: 2.5, up: 3, size: 0.45, life: 1.2 });
      g.hud.toast('🏡 寵物小屋升級完成！現在可以收養其他寵物了', 3400);
    } else if (a.startsWith('adopt:')) {
      const s = a.slice(6) as Species;
      if (d.petHouse < 2 || this.owned().includes(s) || d.coins < PET_ADOPT_COINS) return;
      const name = (this.sheet.el.querySelector<HTMLInputElement>('.pet-name')?.value.trim() || SPECIES[s].name).slice(0, 8);
      d.coins -= PET_ADOPT_COINS;
      d.pets.push(freshPet(g.state.now(), s, name));
      this.syncViews();
      const p = this.homePets[this.homePets.length - 1];
      p.react();
      g.petVoice(s);
      g.particles.burst('heart', p.root.position.clone().setY(0.8), 12, { speed: 1.6, up: 2, size: 0.4, life: 1.3 });
      sfx.fanfare();
      g.hud.toast(`💝 歡迎${name}加入農場！牠會在小屋附近玩，想帶牠出門就點牠`, 3600);
    } else if (a.startsWith('take:')) {
      this.sheet.close();
      this.switchTo(Number(a.slice(5)));
      return;
    }
    g.state.save();
    this.render();
  }
}
