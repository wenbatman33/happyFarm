import { sfx } from '../core/audio';
import { SPECIES } from '../actors/pet';
import { PET_OUTFIT, PLAYER_ACC, isPlayerGlasses } from '../world/accessories3d';
import { Sheet, row } from '../ui/sheet';
import type { Game } from '../game';

// 服裝工坊（第 7 章，裁縫阿布）：主角的帽子、眼鏡，寵物的衣服；買過的可以隨時換

export class Tailor {
  sheet = new Sheet('tailor-panel', '🧵 阿布的服裝工坊');
  private tab: 'me' | 'pet' = 'me';

  constructor(private game: Game) {
    this.sheet.onAction = (a) => this.act(a);
  }

  get unlocked(): boolean { return this.game.calendar.chapterOpen(7, this.game.state.now()); }
  get w() { return this.game.state.data.wardrobe; }

  // 開局與換寵物時套用
  apply(): void {
    const g = this.game;
    g.player.setAccessory(this.w.hat, this.w.glasses);
    g.pet.setOutfit(this.w.petOutfit[g.pet.species] ?? '');
  }

  open(): void {
    if (!this.unlocked) { this.game.hud.toast('🧵 裁縫阿布還沒回到鎮上（第 7 章）'); return; }
    sfx.paper();
    this.sheet.show();
    this.render();
  }

  render(): void {
    if (!this.sheet.open) return;
    const g = this.game;
    const d = g.state.data;
    const w = this.w;
    const tabs = `<div class="jn-tabs"><button data-a="tab:me" class="${this.tab === 'me' ? 'on' : ''}">🧑‍🌾 主角</button><button data-a="tab:pet" class="${this.tab === 'pet' ? 'on' : ''}">${SPECIES[g.pet.species].emoji} ${g.pet.name}</button></div>`;
    let html = `<div class="jn-season"><b>阿布：</b>「每天穿同一件吊帶褲下田也很可愛啦，不過偶爾換個造型，心情也會不一樣喔！」</div>${tabs}`;
    if (this.tab === 'me') {
      html += PLAYER_ACC.map((a) => {
        const own = w.owned.includes(a.id);
        const on = w.hat === a.id || w.glasses === a.id;
        if (!own) return row(a.emoji, a.name, `${a.desc}<br>🪙${a.price.toLocaleString()}`, '購買', d.coins >= a.price ? `buy:${a.id}` : null);
        return row(a.emoji, a.name, `${a.desc}<br>${on ? '穿戴中' : '已擁有'}`, on ? '脫下' : '穿上', `wear:${a.id}`, on ? 'on' : '');
      }).join('');
    } else {
      const sp = g.pet.species;
      const cur = w.petOutfit[sp] ?? '';
      html += `<div class="jn-season"><small>每隻寵物的衣服分開記，換寵物出門時會自動換上牠的衣服。</small></div>` + PET_OUTFIT.map((a) => {
        const own = w.owned.includes(a.id);
        const on = cur === a.id;
        if (!own) return row(a.emoji, a.name, `${a.desc}<br>🪙${a.price.toLocaleString()}`, '購買', d.coins >= a.price ? `buy:${a.id}` : null);
        return row(a.emoji, a.name, `${a.desc}<br>${on ? `${g.pet.name}穿著` : '已擁有'}`, on ? '脫下' : '穿上', `wear:${a.id}`, on ? 'on' : '');
      }).join('');
    }
    this.sheet.render(html);
  }

  private act(a: string) {
    const g = this.game;
    const d = g.state.data;
    const w = this.w;
    if (a.startsWith('tab:')) { this.tab = a.slice(4) as 'me' | 'pet'; this.render(); return; }
    const id = a.slice(a.indexOf(':') + 1);
    const item = [...PLAYER_ACC, ...PET_OUTFIT].find((x) => x.id === id);
    if (!item) return;
    const forPet = PET_OUTFIT.some((x) => x.id === id);
    if (a.startsWith('buy:')) {
      if (w.owned.includes(id) || d.coins < item.price) return;
      d.coins -= item.price;
      w.owned.push(id);
      sfx.coin();
    }
    // 買完直接穿上；再按一次就脫下
    if (forPet) {
      const sp = g.pet.species;
      w.petOutfit[sp] = a.startsWith('wear:') && w.petOutfit[sp] === id ? '' : id;
      g.pet.setOutfit(w.petOutfit[sp] ?? '');
      g.pet.react();
    } else if (isPlayerGlasses(id)) {
      w.glasses = a.startsWith('wear:') && w.glasses === id ? '' : id;
    } else {
      w.hat = a.startsWith('wear:') && w.hat === id ? '' : id;
    }
    g.player.setAccessory(w.hat, w.glasses);
    if (!forPet) g.player.play('celebrate');
    sfx.sparkle();
    g.state.save();
    this.render();
  }
}
