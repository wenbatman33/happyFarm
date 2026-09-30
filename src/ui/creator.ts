import { DEFAULT_LOOK, HAIR_STYLES, LOOK_PALETTE, type Look } from '../actors/player';
import { SPECIES, type Species } from '../actors/pet';

// 捏人與選寵物的介面（docs/01 §7 新手流程）

const el = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
};

export function openCreator(init: Look | null, name: string, onChange: (l: Look) => void, opts: { title: string; ok: string; showName: boolean }): Promise<{ look: Look; name: string }> {
  const look: Look = { ...(init ?? DEFAULT_LOOK) };
  const sw = (key: 'skin' | 'hairColor' | 'outfit' | 'shirt', pal: string[]) =>
    `<div class="sw" data-k="${key}">${pal.map((c, i) => `<button style="background:${c}" data-v="${i}"></button>`).join('')}</div>`;
  const root = el(`
    <div class="creator">
      <div class="cr-card">
        <h3>${opts.title}</h3>
        ${opts.showName ? `<label class="cr-name">名字<input maxlength="8" placeholder="小農夫" value="${name}"></label>` : ''}
        <div class="cr-row"><span>體型</span><div class="seg" data-k="body"><button data-v="round">圓潤</button><button data-v="tall">高挑</button></div></div>
        <div class="cr-row"><span>膚色</span>${sw('skin', LOOK_PALETTE.skin)}</div>
        <div class="cr-row"><span>髮型</span><div class="seg wrap" data-k="hair">${HAIR_STYLES.map((h) => `<button data-v="${h.id}">${h.label}</button>`).join('')}</div></div>
        <div class="cr-row"><span>髮色</span>${sw('hairColor', LOOK_PALETTE.hair)}</div>
        <div class="cr-row"><span>吊帶褲</span>${sw('outfit', LOOK_PALETTE.outfit)}</div>
        <div class="cr-row"><span>上衣</span>${sw('shirt', LOOK_PALETTE.shirt)}</div>
        <div class="cr-row"><span>草帽</span><div class="seg" data-k="hat"><button data-v="1">戴</button><button data-v="0">不戴</button></div></div>
        <div class="cr-actions"><button class="btn ghost rnd">🎲 隨機</button><button class="btn ok">${opts.ok}</button></div>
      </div>
    </div>`);
  document.body.appendChild(root);
  const refresh = () => {
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((g) => {
      const k = g.dataset.k as keyof Look;
      const cur = k === 'hat' ? (look.hat ? '1' : '0') : String(look[k]);
      g.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
    });
    onChange({ ...look });
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k] button');
    if (!b) return;
    const k = (b.parentElement as HTMLElement).dataset.k as keyof Look;
    const v = b.dataset.v!;
    if (k === 'hat') look.hat = v === '1';
    else if (k === 'body') look.body = v as Look['body'];
    else if (k === 'hair') look.hair = v as Look['hair'];
    else (look[k] as number) = Number(v);
    refresh();
  });
  root.querySelector<HTMLElement>('.rnd')!.onclick = () => {
    const r = (n: number) => Math.floor(Math.random() * n);
    Object.assign(look, {
      body: r(2) ? 'round' : 'tall', skin: r(LOOK_PALETTE.skin.length), hair: HAIR_STYLES[r(HAIR_STYLES.length)].id,
      hairColor: r(LOOK_PALETTE.hair.length), outfit: r(LOOK_PALETTE.outfit.length), shirt: r(LOOK_PALETTE.shirt.length), hat: r(3) > 0,
    });
    refresh();
  };
  refresh();
  return new Promise((resolve) => {
    root.querySelector<HTMLElement>('.ok')!.onclick = () => {
      const input = root.querySelector<HTMLInputElement>('.cr-name input');
      const n = (input?.value ?? name).trim().slice(0, 8);
      root.remove();
      resolve({ look, name: n || name || '小農夫' });
    };
  });
}

export function openPetPicker(onFocus: (s: Species) => void): Promise<{ species: Species; name: string }> {
  const order: Species[] = ['corgi', 'cat', 'bunny', 'duck'];
  let sel: Species = 'corgi';
  const root = el(`
    <div class="petpick">
      <div class="pp-card">
        <h3>🐾 選一個陪你種田的夥伴</h3>
        <div class="pp-list">${order.map((s) => {
          const d = SPECIES[s];
          return `<button class="pp-item" data-s="${s}"><span class="pp-em">${d.emoji}</span><b>${d.label}</b><small>${d.personality}</small><span class="pp-skill">${d.skill}</span></button>`;
        }).join('')}</div>
        <div class="pp-bottom"><label class="cr-name">名字<input maxlength="6"></label><button class="btn ok">就是你了！</button></div>
      </div>
    </div>`);
  document.body.appendChild(root);
  const input = root.querySelector<HTMLInputElement>('input')!;
  let touched = false;
  input.oninput = () => (touched = true);
  const pick = (s: Species) => {
    sel = s;
    root.querySelectorAll<HTMLElement>('.pp-item').forEach((b) => b.classList.toggle('on', b.dataset.s === s));
    if (!touched) input.value = SPECIES[s].name;
    onFocus(s);
  };
  root.querySelectorAll<HTMLElement>('.pp-item').forEach((b) => (b.onclick = () => pick(b.dataset.s as Species)));
  pick('corgi');
  return new Promise((resolve) => {
    root.querySelector<HTMLElement>('.ok')!.onclick = () => {
      const name = input.value.trim().slice(0, 6) || SPECIES[sel].name;
      root.remove();
      resolve({ species: sel, name });
    };
  });
}
