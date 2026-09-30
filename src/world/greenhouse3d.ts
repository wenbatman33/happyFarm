import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { GEO } from './materials';
import { FONT_ROUND, Kit, P, bake, canvasTex, cord, lightString, rbox, sag, stick, texPlane, type Deco } from './festive3d';

// 溫室（Lv40）：中心在原點，外框 x±3.6、z±1.6（內牆面 x±3.55、z±1.55），牆高 2.4、屋脊 3.4
// 南側（+z）中央開 1 公尺寬的門；x=0 那一排是走道

export const GH_WALL_X = 3.6;
export const GH_WALL_Z = 1.6;

// 各期的田格（相對溫室中心的格座標）
export function greenhouseTiles(level: number): [number, number][] {
  if (level < 1) return [];
  const cols = level >= 2 ? [-3, -2, -1, 1, 2, 3] : [-3, -2, -1];
  const rows = level >= 3 ? [-1, 0, 1] : [0, 1];
  const out: [number, number][] = [];
  for (const z of rows) for (const x of cols) out.push([x, z]);
  return out;
}

export interface GreenhouseDeco extends Deco { hit: THREE.Object3D }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function signTex(text: string, bg: string, fg: string, sub?: string): THREE.CanvasTexture {
  return canvasTex(384, 160, (c, w, h) => {
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(6, 6, w - 12, h - 12, 22);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 5;
    c.stroke();
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold ${sub ? 56 : 70}px ${FONT_ROUND}`;
    c.fillText(text, w / 2, sub ? h / 2 - 18 : h / 2 + 4);
    if (sub) {
      c.font = `bold 32px ${FONT_ROUND}`;
      c.globalAlpha = 0.85;
      c.fillText(sub, w / 2, h / 2 + 40);
    }
  });
}

// 木牌＋柱子（原點在地面）
function signpost(kit: Kit, parent: THREE.Object3D, text: string, sub: string | undefined, bg: string): void {
  const wood = kit.m('#a8744a'), dark = kit.m('#8a5a3a');
  P(parent, rbox(0.1, 1.25, 0.1, 0.03), dark, [0, 0.62, 0]);
  P(parent, rbox(1.2, 0.52, 0.07, 0.04), wood, [0, 1.05, 0.02]);
  texPlane(parent, signTex(text, bg, '#fffaf0', sub), 1.08, 0.45, [0, 1.05, 0.06]);
}

// 盆栽（原點在地面）
function pot(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, s: number, leaf: string, flower?: string): void {
  P(parent, new THREE.CylinderGeometry(0.16 * s, 0.12 * s, 0.24 * s, 12), kit.m('#c8704a'), [x, y + 0.12 * s, z]);
  P(parent, GEO.ico, kit.m(leaf, { roughness: 0.8 }), [x, y + 0.34 * s, z], null, [0.4 * s, 0.34 * s, 0.4 * s]);
  if (flower) for (let i = 0; i < 3; i++) P(parent, GEO.sphereLo, kit.m(flower), [x + Math.cos(i * 2.1) * 0.1 * s, y + 0.48 * s, z + Math.sin(i * 2.1) * 0.1 * s], null, 0.1 * s, false);
}

// 吊盆：從高處垂下，底下有垂藤
function hangingPot(kit: Kit, parent: THREE.Object3D, top: THREE.Vector3, len: number, rand: () => number): void {
  const rope = kit.m('#d8c8a0');
  const y = top.y - len;
  for (const a of [0, 2.1, 4.2]) stick(parent, top, V(top.x + Math.cos(a) * 0.12, y + 0.12, top.z + Math.sin(a) * 0.12), 0.006, rope, false);
  P(parent, new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.m('#d8845a', { side: THREE.DoubleSide }), [top.x, y + 0.12, top.z]);
  const leaf = kit.m('#5fbf49'), leaf2 = kit.m('#4fae3f');
  P(parent, GEO.ico, leaf, [top.x, y + 0.16, top.z], null, [0.34, 0.16, 0.34], false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand();
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) P(parent, GEO.sphereLo, k % 2 ? leaf : leaf2, [top.x + Math.cos(a) * (0.15 + k * 0.01), y + 0.06 - k * 0.1, top.z + Math.sin(a) * (0.15 + k * 0.01)], null, [0.09, 0.07, 0.05], false);
  }
}

function wateringCan(kit: Kit, parent: THREE.Object3D, x: number, z: number, ry: number): void {
  const g = new THREE.Group();
  const m = kit.m('#6aa8c8', { metalness: 0.3, roughness: 0.4 });
  P(g, new THREE.CylinderGeometry(0.13, 0.15, 0.26, 14), m, [0, 0.13, 0]);
  stick(g, V(0.1, 0.1, 0), V(0.32, 0.3, 0), 0.025, m);
  P(g, new THREE.CylinderGeometry(0.05, 0.03, 0.05, 10), m, [0.33, 0.31, 0], [0, 0, -0.9]);
  P(g, new THREE.TorusGeometry(0.1, 0.02, 6, 14, Math.PI), m, [-0.02, 0.27, 0], [0, 0, 0.2]);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
}

// 施工中的道具：鷹架、帆布、木箱、玻璃片
function construction(kit: Kit, parent: THREE.Object3D, full: boolean): void {
  const pole = kit.m('#c9a06a', { roughness: 0.85 }), plank = kit.m('#e0bd86', { roughness: 0.85 });
  const X = full ? 3.95 : 3.8, Z = 1.95;
  // 前面與右側的鷹架
  const xs = full ? [X] : [-X, 0, X];
  for (const x of xs) for (const z of [-Z, Z]) {
    if (!full && z > 0 && x === 0) continue; // 門口不擋
    P(parent, GEO.cyl, pole, [x, 1.5, z], null, [0.08, 3.0, 0.08]);
  }
  for (const h of full ? [1.1, 2.3] : [2.3]) {
    if (full) P(parent, rbox(0.34, 0.06, Z * 2 + 0.3, 0.02), plank, [X, h, 0]);
    else P(parent, rbox(X * 2 + 0.3, 0.06, 0.34, 0.02), plank, [0, h, Z]);
  }
  if (!full) P(parent, rbox(X * 2 + 0.3, 0.06, 0.34, 0.02), plank, [0, 1.1, -Z]);
  // 帆布（藍綠色，蓋在一角）
  const tarp = kit.m('#5a9ab8', { roughness: 0.9, side: THREE.DoubleSide });
  if (full) {
    // 帆布沿著屋頂兩坡蓋住右半邊
    const sl = Math.atan2(1.0, 1.6), len = Math.hypot(1.6, 1.0) + 0.25;
    for (const s of [-1, 1]) P(parent, rbox(1.5, 0.03, len, 0.01), tarp, [2.9, 2.93, s * 0.8], [s * sl, 0, 0]);
    P(parent, rbox(0.03, 1.0, 3.4, 0.01), tarp, [3.68, 1.95, 0]);
  } else {
    P(parent, rbox(2.6, 0.04, 3.5, 0.02), tarp, [2.3, 2.5, 0], [0, 0, 0.12]);
    P(parent, rbox(0.04, 1.4, 3.5, 0.02), tarp, [3.62, 1.8, 0], [0, 0, 0.05]);
  }
  // 木箱與玻璃片
  const crate = kit.m('#c89b62'), crate2 = kit.m('#a8804e');
  const cx = full ? 4.25 : -2.6, cz = full ? 1.15 : 2.05;
  P(parent, rbox(0.5, 0.45, 0.5, 0.04), crate, [cx, 0.225, cz]);
  P(parent, rbox(0.45, 0.4, 0.45, 0.04), crate2, [cx + (full ? 0 : 0.55), full ? 0.65 : 0.2, cz + (full ? 0 : 0.05)], [0, 0.4, 0]);
  const glass = kit.m('#cfeeff', { transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false });
  for (let i = 0; i < 3; i++) P(parent, rbox(0.8, 1.0, 0.02, 0.01), glass, [full ? 4.2 : 2.3 + i * 0.05, 0.5, full ? -0.8 + i * 0.05 : 2.05], [full ? 0 : -0.18, full ? Math.PI / 2 : 0, full ? 0.18 : 0], null, false);
  if (!full) for (let i = 0; i < 4; i++) P(parent, rbox(1.6, 0.08, 0.08, 0.02), kit.m('#eef4ea'), [1.6, 0.04 + i * 0.08, 2.1], [0, 0.1 * i, 0]);
}

export function buildGreenhouse(level: number, building: boolean): GreenhouseDeco {
  const kit = new Kit();
  const group = new THREE.Group();
  const hit = new THREE.Group();
  hit.userData.kind = 'greenhouse';
  hit.userData.dyn = true; // 點擊用，不合併
  group.add(hit);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const rand = mulberry32(40 + level);
  const X = GH_WALL_X, Z = GH_WALL_Z, WH = 2.4, RH = 3.4;

  if (level < 1 && !building) {
    // ---- 預定地：木牌＋木樁拉繩 ----
    const sp = new THREE.Group();
    sp.position.set(0, 0, Z + 0.15);
    signpost(kit, sp, '溫室預定地', 'Lv40', '#7aa85a');
    hit.add(sp);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 0.5), hitMat);
    hb.position.set(0, 0.75, Z + 0.15);
    hit.add(hb);
    const stake = kit.m('#b98a5e'), flag = kit.m('#f28a3a', { side: THREE.DoubleSide });
    const corners = [V(-X, 0, -Z), V(X, 0, -Z), V(X, 0, Z), V(-X, 0, Z)];
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1.8));
      for (let k = 0; k < n; k++) ring.push(a.clone().lerp(b, k / n));
    }
    ring.forEach((p, i) => {
      P(group, rbox(0.06, 0.42, 0.06, 0.02), stake, [p.x, 0.21, p.z], [0.05, i, 0]);
      if (corners.some((c) => c.distanceTo(p) < 0.01)) P(group, new THREE.PlaneGeometry(0.16, 0.1), flag, [p.x + 0.08, 0.38, p.z], null, null, false);
    });
    const rope = kit.m('#efe2c0', { roughness: 0.9 });
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i].clone().setY(0.3), b = ring[(i + 1) % ring.length].clone().setY(0.3);
      // 門口那段不拉繩
      if (a.z > Z - 0.1 && b.z > Z - 0.1 && Math.min(Math.abs(a.x), Math.abs(b.x)) < 1.9 && Math.sign(a.x) !== Math.sign(b.x)) continue;
      cord(group, sag(a, b, 0.06, 6), rope, 0.012);
    }
    bake(group);
    return { group, glow: kit.glow, hit };
  }

  const frame = kit.m('#eef5ea', { roughness: 0.45, metalness: 0.15 });
  const brick = kit.m('#c98f6e', { roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: '#dff3ff', transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const G = (geo: THREE.BufferGeometry, pos: [number, number, number], rot?: [number, number, number], m: THREE.Material = glass) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(pos[0], pos[1], pos[2]);
    if (rot) me.rotation.set(rot[0], rot[1], rot[2]);
    me.castShadow = false;
    me.receiveShadow = false;
    me.renderOrder = 2;
    group.add(me);
    return me;
  };
  const fullShell = level >= 1;
  const KH = 0.45; // 矮牆高

  // 地面碎石與踏腳石
  P(group, rbox(X * 2 - 0.1, 0.02, Z * 2 - 0.1, 0.01), kit.m('#d9ceb6', { roughness: 1 }), [0, 0.01, 0], null, null, false);
  const stone = kit.m('#bfb4a2', { roughness: 0.95 });
  for (const z of fullShell ? [-1.05, -0.15, 0.75, 2.2] : [2.2]) P(group, GEO.cyl, stone, [(rand() - 0.5) * 0.08, 0.025, z], [0, rand() * 3, 0], [0.5, 0.05, 0.4], false);

  // 矮磚牆＋白色壓條（門口留空）
  const knee = (x: number, z: number, w: number, d: number) => {
    P(group, rbox(w, KH, d, 0.03), brick, [x, KH / 2, z]);
    P(group, rbox(w + 0.04, 0.05, d + 0.06, 0.02), frame, [x, KH + 0.02, z]);
  };
  const doorH = 0.5;
  if (fullShell) {
    knee(-(X + doorH) / 2, Z, X - doorH + 0.06, 0.12);
    knee((X + doorH) / 2, Z, X - doorH + 0.06, 0.12);
    knee(0, -Z, X * 2 + 0.12, 0.12);
    for (const s of [-1, 1]) knee(s * X, 0, 0.12, Z * 2);
  } else {
    // 施工中：只砌好後牆與左牆
    knee(0, -Z, X * 2 + 0.12, 0.12);
    knee(-X, 0, 0.12, Z * 2);
    knee(-(X + doorH) / 2, Z, X - doorH + 0.06, 0.12);
  }

  // 柱子
  const postGeo = rbox(0.09, WH, 0.09, 0.02);
  const frontXs = [-X, -2.55, -1.5, -doorH, doorH, 1.5, 2.55, X];
  const backXs = [-X, -2.4, -1.2, 0, 1.2, 2.4, X];
  const addPost = (x: number, z: number) => P(group, postGeo, frame, [x, WH / 2, z]);
  if (fullShell) {
    frontXs.forEach((x) => addPost(x, Z));
    backXs.forEach((x) => addPost(x, -Z));
    for (const s of [-1, 1]) for (const z of [-0.55, 0.55]) addPost(s * X, z);
  } else {
    for (const x of [-X, X]) for (const z of [-Z, Z]) addPost(x, z);
    addPost(-X, 0);
    addPost(0, -Z);
  }
  // 橫梁
  const beam = (x: number, y: number, z: number, w: number, d: number) => P(group, rbox(w, 0.08, d, 0.02), frame, [x, y, z]);
  beam(0, WH, -Z, X * 2 + 0.1, 0.1);
  beam(-X, WH, 0, 0.1, Z * 2 + 0.1);
  if (fullShell) {
    beam(0, WH, Z, X * 2 + 0.1, 0.1);
    beam(X, WH, 0, 0.1, Z * 2 + 0.1);
    // 中段橫條（門口除外）
    for (const s of [-1, 1]) beam(s * (X + doorH) / 2, 1.45, Z, X - doorH, 0.06);
    beam(0, 1.45, -Z, X * 2, 0.06);
    for (const s of [-1, 1]) beam(s * X, 1.45, 0, 0.06, Z * 2);
    beam(0, 2.12, Z, doorH * 2 + 0.1, 0.1); // 門楣
    // 屋脊＋椽
    beam(0, RH, 0, X * 2 + 0.2, 0.1);
    for (const x of backXs) for (const s of [-1, 1]) stick(group, V(x, WH, s * Z), V(x, RH, 0), 0.04, frame);
    // 玻璃：牆
    const wh = WH - KH - 0.05, wy = KH + 0.05 + wh / 2;
    for (const s of [-1, 1]) G(new THREE.PlaneGeometry(X - doorH, wh), [s * (X + doorH) / 2, wy, Z]);
    G(new THREE.PlaneGeometry(doorH * 2, 0.26), [0, 2.27, Z]);
    G(new THREE.PlaneGeometry(X * 2, wh), [0, wy, -Z]);
    for (const s of [-1, 1]) G(new THREE.PlaneGeometry(Z * 2, wh), [s * X, wy, 0], [0, Math.PI / 2, 0]);
    // 玻璃：屋頂兩坡＋兩側山牆三角
    const slope = Math.hypot(Z, RH - WH), ang = Math.atan2(Z, RH - WH);
    for (const s of [-1, 1]) G(new THREE.PlaneGeometry(X * 2, slope), [0, (WH + RH) / 2, (s * Z) / 2], [-s * ang, 0, 0]);
    const tri = new THREE.Shape();
    tri.moveTo(-Z, 0); tri.lineTo(Z, 0); tri.lineTo(0, RH - WH); tri.closePath();
    for (const s of [-1, 1]) G(new THREE.ShapeGeometry(tri), [s * X, WH, 0], [0, Math.PI / 2, 0]);
    // 玻璃反光條（卡通感）
    for (const x of [-2.6, -2.35, 1.2, 1.45]) G(new THREE.PlaneGeometry(0.1, slope * 0.8), [x, (WH + RH) / 2 + 0.01, Z / 2 + 0.02], [-ang, 0, 0.35], shine);
    for (const x of [-3.0, 2.2]) G(new THREE.PlaneGeometry(0.08, wh * 0.7), [x, wy, Z + 0.01], [0, 0, 0.4], shine);
    // 打開的兩扇玻璃門
    for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s * doorH, 0, Z);
      pv.rotation.y = -s * 1.25;
      const cx = -s * (doorH / 2);
      P(pv, rbox(0.05, 2.08, 0.05, 0.01), frame, [cx - s * 0.23, 1.04, 0]);
      P(pv, rbox(0.05, 2.08, 0.05, 0.01), frame, [cx + s * 0.23, 1.04, 0]);
      for (const y of [0.05, 1.0, 2.05]) P(pv, rbox(0.5, 0.05, 0.05, 0.01), frame, [cx, y, 0]);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 1.95), glass);
      gl.position.set(cx, 1.04, 0);
      gl.renderOrder = 2;
      pv.add(gl);
      group.add(pv);
    }
    // 屋內：苗床木框（每格 1×1，只做框，土由遊戲畫）
    const tiles = greenhouseTiles(level);
    const wood = kit.m('#a8744a', { roughness: 0.8 }), woodD = kit.m('#8a5a3a');
    const edges = new Set<string>(), corners = new Set<string>();
    for (const [tx, tz] of tiles) {
      edges.add(`h|${tx}|${tz - 0.5}`); edges.add(`h|${tx}|${tz + 0.5}`);
      edges.add(`v|${tx - 0.5}|${tz}`); edges.add(`v|${tx + 0.5}|${tz}`);
      for (const cx of [tx - 0.5, tx + 0.5]) for (const cz of [tz - 0.5, tz + 0.5]) corners.add(`${cx}|${cz}`);
    }
    for (const e of edges) {
      const [k, a, b] = e.split('|');
      const x = Number(a), z = Number(b);
      if (k === 'h') P(group, rbox(1.0, 0.2, 0.07, 0.02), wood, [x, 0.1, z]);
      else P(group, rbox(0.07, 0.2, 1.0, 0.02), wood, [x, 0.1, z]);
    }
    for (const c of corners) {
      const [a, b] = c.split('|').map(Number);
      P(group, rbox(0.11, 0.26, 0.11, 0.02), woodD, [a, 0.13, b]);
    }
    // 還沒蓋苗床的區域：盆栽、工作台
    const has = (x: number, z: number) => tiles.some(([a, b]) => a === x && b === z);
    if (!has(-2, -1)) {
      // 後排工作台
      const bx = -2, bz = -1.15;
      P(group, rbox(2.2, 0.08, 0.5, 0.02), wood, [bx, 0.78, bz]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(group, rbox(0.07, 0.78, 0.07, 0.02), woodD, [bx + sx * 1.0, 0.39, bz + sz * 0.2]);
      P(group, rbox(2.1, 0.05, 0.45, 0.02), wood, [bx, 0.25, bz]);
      pot(kit, group, bx - 0.7, 0.82, bz, 0.8, '#5fbf49', '#ff7aa8');
      pot(kit, group, bx - 0.15, 0.82, bz, 0.7, '#6aca4a');
      pot(kit, group, bx + 0.45, 0.82, bz, 0.85, '#4fae3f', '#ffd84a');
      P(group, rbox(0.4, 0.3, 0.3, 0.06), kit.m('#e8d8b0'), [bx + 0.6, 0.43, bz + 0.02]);
    }
    if (!has(2, 0)) {
      for (const [x, z, s] of [[1.2, 0.3, 1.1], [2.3, -0.2, 1.3], [2.9, 0.9, 1.0], [1.6, 1.1, 0.9]] as [number, number, number][]) pot(kit, group, x, 0, z, s, rand() < 0.5 ? '#5fbf49' : '#4fae3f', rand() < 0.5 ? '#ffffff' : undefined);
      P(group, rbox(0.45, 0.55, 0.35, 0.12), kit.m('#e8d8b0'), [2.9, 0.28, -0.9], [0, 0.3, 0]);
    } else if (!has(2, -1)) {
      P(group, rbox(0.45, 0.55, 0.35, 0.12), kit.m('#e8d8b0'), [2.9, 0.28, -1.15], [0, 0.3, 0]);
      pot(kit, group, 2.2, 0, -1.2, 1.0, '#5fbf49', '#b28cff');
    }
    // 吊盆（沿後牆＋走道上方）
    for (const x of [-2.4, -1.2, 1.2, 2.4]) hangingPot(kit, group, V(x, 2.36, -Z + 0.12), 0.55, rand);
    hangingPot(kit, group, V(0, 3.3, -0.2), 1.0, rand);
    // 夜間暖光：屋脊下的小燈串＋兩顆圓球吊燈
    const lampM = kit.lit('#fff2c0', '#ffc060', 2.0, 0.05, { roughness: 0.3 });
    for (const x of [-2.4, 2.4]) {
      stick(group, V(x, RH - 0.04, 0), V(x, 2.86, 0), 0.008, kit.m('#3a3a3a'), false);
      P(group, GEO.cyl, kit.m('#4a7a5a'), [x, 2.86, 0], null, [0.08, 0.06, 0.08], false);
      P(group, GEO.sphere, lampM, [x, 2.74, 0], null, 0.22, false);
    }
    for (const s of [-1, 1]) lightString(kit, group, V(s * 0.1, RH - 0.08, 0.06), V(s * (X - 0.15), RH - 0.08, 0.06), 0.14, [['#fff2c0', '#ffc060']], 1.7, 0.04, 0.32, 0.04);
    // 門口：澆水壺、盆花、招牌
    wateringCan(kit, group, 1.05, Z + 0.35, -0.6);
    pot(kit, group, -1.0, 0, Z + 0.35, 1.0, '#5fbf49', '#ff9a4a');
    if (level >= 2) {
      // 屋頂通風窗撐開
      const vg = new THREE.Group();
      vg.position.set(2.4, RH - 0.05, 0);
      vg.rotation.x = Math.PI / 2 - ang - 0.35; // 貼齊前坡再撐開一點
      P(vg, rbox(1.1, 0.04, 0.05, 0.01), frame, [0, 0, 0.02]);
      P(vg, rbox(1.1, 0.04, 0.05, 0.01), frame, [0, 0, 0.72]);
      for (const s of [-1, 1]) P(vg, rbox(0.04, 0.04, 0.72, 0.01), frame, [s * 0.53, 0, 0.37]);
      const vgl = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.7), glass);
      vgl.rotation.x = -Math.PI / 2;
      vgl.position.set(0, 0.01, 0.37);
      vgl.renderOrder = 2;
      vg.add(vgl);
      group.add(vg);
    }
    if (level >= 3) {
      // 風向雞＋牆角爬藤
      const wv = new THREE.Group();
      wv.position.set(-2.8, RH, 0);
      const iron = kit.m('#3a3a44', { metalness: 0.4, roughness: 0.5 });
      P(wv, GEO.cyl, iron, [0, 0.3, 0], null, [0.04, 0.6, 0.04]);
      P(wv, rbox(0.4, 0.03, 0.03, 0.01), iron, [0, 0.45, 0]);
      P(wv, GEO.sphere, kit.m('#e8b84a', { metalness: 0.5, roughness: 0.35 }), [0, 0.7, 0], null, [0.28, 0.2, 0.08]);
      P(wv, GEO.cone, kit.m('#d8453c'), [0.1, 0.82, 0], null, [0.08, 0.1, 0.04]);
      group.add(wv);
      const vine = kit.m('#4f9a3a');
      for (const [x, z] of [[-X - 0.06, Z + 0.06], [X + 0.06, Z + 0.06]]) for (let k = 0; k < 9; k++) P(group, GEO.sphereLo, vine, [x + Math.sin(k * 1.7) * 0.1, 0.5 + k * 0.2, z], null, [0.18, 0.13, 0.07], false);
    }
  } else {
    // 施工中的第一期：框架剛立起來
    beam(0, WH, Z, X * 2 + 0.1, 0.1);
    beam(X, WH, 0, 0.1, Z * 2 + 0.1);
  }

  // 招牌＋點擊區（門上方）
  if (building) construction(kit, group, fullShell);
  const sign = new THREE.Group();
  if (building) {
    sign.position.set(-1.45, 0, Z + 0.55);
    sign.rotation.y = 0.15;
    signpost(kit, sign, fullShell ? '擴建中' : '施工中', '木匠老木', '#e8a23a');
  } else {
    sign.position.set(0, 2.64, Z + 0.07);
    P(sign, rbox(1.3, 0.38, 0.06, 0.03), kit.m('#6a9a4a'), [0, 0, 0]);
    texPlane(sign, signTex('溫室', '#5a8a3a', '#fffaf0'), 1.2, 0.34, [0, 0, 0.035]);
    for (const s of [-1, 1]) P(sign, rbox(0.05, 0.3, 0.05, 0.01), frame, [s * 0.45, -0.2, -0.02]);
  }
  hit.add(sign);
  const hb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.9, 0.3), hitMat);
  hb.position.set(0, 1.45, Z + 0.18);
  hit.add(hb);
  if (building) {
    const hb2 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 0.5), hitMat);
    hb2.position.set(-1.45, 0.75, Z + 0.55);
    hit.add(hb2);
  }
  bake(group);
  return { group, glow: kit.glow, hit };
}
