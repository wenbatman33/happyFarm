import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { GEO, mat } from './materials';
import { FONT_ROUND, Kit, P, bake, bunting, canvasTex, lightString, rbox, stick, texPlane, type Deco } from './festive3d';

// 週末市集攤位／流浪商人：原點在攤位中心，正面朝 +z（擺放時轉向小徑）
// 佔地約 x±1.3、z±0.8

export type MarketKind = 'none' | 'merchant' | 'market';
export const MARKET_W = 2.6; // 本地 x 方向
export const MARKET_D = 1.6; // 本地 z 方向

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 友善的攤販老闆：圓身體、圍裙、帽子
function shopkeeper(kit: Kit): { g: THREE.Group; head: THREE.Object3D; arm: THREE.Object3D } {
  const g = new THREE.Group();
  const skin = kit.m('#f6cfa8', { roughness: 0.6 });
  const shirt = kit.m('#7ab8e0', { roughness: 0.7 });
  const apron = kit.m('#fff4dc', { roughness: 0.8 });
  const dark = kit.m('#3a2a22');
  P(g, GEO.sphere, shirt, [0, 0.62, 0], null, [0.56, 0.7, 0.46]);
  P(g, GEO.sphere, kit.m('#5a6a8a'), [0, 0.3, 0], null, [0.5, 0.4, 0.42]);
  // 圍裙＋口袋＋肩帶
  P(g, rbox(0.4, 0.5, 0.05, 0.05), apron, [0, 0.58, 0.2], [-0.12, 0, 0]);
  P(g, rbox(0.18, 0.1, 0.02, 0.02), kit.m('#6ab85a'), [0, 0.48, 0.235], [-0.12, 0, 0], null, false);
  for (const s of [-1, 1]) stick(g, V(s * 0.16, 0.82, 0.18), V(s * 0.12, 1.0, 0.02), 0.02, apron, false);
  const head = new THREE.Group();
  head.position.set(0, 1.12, 0);
  P(head, GEO.sphere, skin, [0, 0, 0], null, [0.48, 0.46, 0.46]);
  for (const s of [-1, 1]) {
    P(head, GEO.sphereLo, dark, [s * 0.09, 0.02, 0.215], null, [0.055, 0.07, 0.03], false);
    P(head, GEO.sphereLo, kit.m('#ff9aa0'), [s * 0.15, -0.06, 0.19], null, [0.08, 0.05, 0.02], false);
    P(head, GEO.sphereLo, skin, [s * 0.235, 0, 0], null, [0.08, 0.11, 0.06]);
  }
  P(head, GEO.sphereLo, kit.m('#f0b890'), [0, -0.03, 0.235], null, 0.07, false);
  P(head, new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), dark, [0, -0.1, 0.215], [0, 0, Math.PI], null, false);
  // 鬍子
  P(head, GEO.sphereLo, kit.m('#8a5a3a'), [0, -0.075, 0.22], null, [0.16, 0.04, 0.04], false);
  // 帽子：芥末黃鴨舌帽
  const hat = kit.m('#f2c44a', { roughness: 0.6 });
  P(head, new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat, [0, 0.08, 0], null, [1, 0.8, 1]);
  P(head, GEO.cyl, hat, [0, 0.09, 0.2], null, [0.3, 0.025, 0.2]);
  P(head, GEO.sphereLo, kit.m('#e8554a'), [0, 0.28, 0], null, 0.07, false);
  g.add(head);
  // 手臂（右手會揮）
  P(g, GEO.capsule, shirt, [-0.3, 0.66, 0.02], [0, 0, -0.35], [0.12, 0.14, 0.12]);
  P(g, GEO.sphereLo, skin, [-0.36, 0.5, 0.06], null, 0.1, false);
  const arm = new THREE.Group();
  arm.position.set(0.25, 0.8, 0.02);
  P(arm, GEO.capsule, shirt, [0.05, -0.14, 0], [0, 0, 0.35], [0.12, 0.14, 0.12]);
  P(arm, GEO.sphereLo, skin, [0.1, -0.3, 0.04], null, 0.1, false);
  g.add(arm);
  return { g, head, arm };
}

// 神秘流浪商人：紫色斗篷、兜帽裡兩顆發亮的眼睛、大背包、提燈
function wanderer(kit: Kit): { g: THREE.Group; lamp: THREE.Object3D } {
  const g = new THREE.Group();
  const cloak = kit.m('#5b3a8c', { roughness: 0.75 });
  const cloak2 = kit.m('#4a2e74', { roughness: 0.75 });
  const gold = kit.m('#e8b84a', { metalness: 0.4, roughness: 0.4 });
  P(g, GEO.cone, cloak, [0, 0.5, 0], null, [0.66, 1.0, 0.58]);
  P(g, new THREE.TorusGeometry(0.31, 0.025, 6, 24), gold, [0, 0.03, 0], [Math.PI / 2, 0, 0], [1, 0.9, 1], false);
  P(g, GEO.sphere, cloak2, [0, 0.78, 0], null, [0.4, 0.3, 0.36]);
  // 兜帽＋暗暗的臉＋發亮的眼睛
  P(g, GEO.sphere, cloak, [0, 1.08, -0.02], null, [0.5, 0.5, 0.5]);
  P(g, GEO.cone, cloak, [0, 1.3, -0.16], [-0.9, 0, 0], [0.18, 0.3, 0.18]);
  P(g, GEO.sphere, kit.m('#241a30', { roughness: 1 }), [0, 1.04, 0.13], null, [0.34, 0.3, 0.24], false);
  const eye = kit.lit('#fff0a0', '#ffd24a', 2.4, 0.9);
  for (const s of [-1, 1]) P(g, GEO.sphereLo, eye, [s * 0.075, 1.06, 0.245], null, [0.06, 0.075, 0.03], false);
  // 斗篷上的星星扣子
  P(g, GEO.sphereLo, gold, [0, 0.86, 0.19], null, 0.06, false);
  for (const [x, y, z] of [[0.15, 0.4, 0.23], [-0.18, 0.25, 0.25], [0.05, 0.62, 0.17]]) P(g, GEO.sphereLo, kit.m('#f2e08a'), [x, y, z], null, 0.035, false);
  // 大背包（比人還高）
  const pack = new THREE.Group();
  pack.position.set(0, 0.95, -0.34);
  pack.rotation.x = 0.12;
  P(pack, rbox(0.62, 0.8, 0.36, 0.08), kit.m('#9a6a3a'), [0, 0, 0]);
  P(pack, rbox(0.5, 0.3, 0.06, 0.04), kit.m('#b8844a'), [0, -0.12, 0.2]);
  P(pack, GEO.cyl, kit.m('#c8453a'), [0, 0.5, 0], [0, 0, Math.PI / 2], [0.22, 0.72, 0.22]);
  P(pack, GEO.cyl, kit.m('#e8d4a8'), [0, 0.5, 0], [0, 0, Math.PI / 2], [0.23, 0.08, 0.23], false);
  P(pack, new THREE.CylinderGeometry(0.1, 0.12, 0.14, 12), kit.m('#6a6a72', { metalness: 0.5, roughness: 0.4 }), [0.36, -0.1, 0], null, null);
  P(pack, GEO.cyl, kit.m('#4a8a5a'), [-0.34, 0.12, 0.02], null, [0.1, 0.4, 0.1]);
  for (const [x, y, c] of [[-0.18, 0.62, '#6ac8e8'], [0.16, 0.66, '#e86aa8']] as [number, number, string][]) {
    P(pack, GEO.sphere, kit.lit(c, c, 1.6, 0.35, { roughness: 0.2 }), [x, y, 0.05], null, 0.14, false);
    P(pack, GEO.cyl, kit.m('#c89b62'), [x, y + 0.1, 0.05], null, [0.05, 0.08, 0.05], false);
  }
  g.add(pack);
  // 手杖＋提燈
  const staff = kit.m('#6a4a2a');
  stick(g, V(0.36, 0, 0.18), V(0.4, 1.6, 0.16), 0.025, staff);
  stick(g, V(0.4, 1.6, 0.16), V(0.58, 1.66, 0.16), 0.02, staff);
  const lamp = new THREE.Group();
  lamp.position.set(0.6, 1.64, 0.16);
  lamp.userData.dyn = true;
  stick(lamp, V(0, 0, 0), V(0, -0.1, 0), 0.008, kit.m('#3a3a3a'), false);
  const frame = kit.m('#3a3a44', { metalness: 0.4, roughness: 0.5 });
  P(lamp, rbox(0.2, 0.04, 0.2, 0.01), frame, [0, -0.11, 0]);
  P(lamp, rbox(0.17, 0.2, 0.17, 0.02), kit.lit('#ffe2a0', '#ffb347', 2.4, 0.3, { roughness: 0.3 }), [0, -0.23, 0], null, null, false);
  P(lamp, rbox(0.2, 0.04, 0.2, 0.01), frame, [0, -0.35, 0]);
  P(lamp, GEO.cone, frame, [0, -0.06, 0], null, [0.2, 0.08, 0.2]);
  g.add(lamp);
  // 另一隻手
  P(g, GEO.sphereLo, kit.m('#e8c8a8'), [0.34, 0.8, 0.2], null, 0.1, false);
  return { g, lamp };
}

function crate(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, produce: string, rand: () => number): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.x = 0.18;
  P(g, rbox(0.62, 0.2, 0.5, 0.03), kit.m('#c89b62'), [0, 0.1, 0]);
  P(g, rbox(0.54, 0.02, 0.42, 0.01), kit.m('#8a5a3a'), [0, 0.19, 0], null, null, false);
  for (const s of [-1, 1]) P(g, rbox(0.64, 0.04, 0.02, 0.01), kit.m('#a8744a'), [0, 0.1, s * 0.25], null, null, false);
  const put = (n: number, f: (i: number) => void) => { for (let i = 0; i < n; i++) f(i); };
  if (produce === 'tomato') {
    const m = kit.m('#e8403a', { roughness: 0.35 });
    put(9, (i) => {
      const px = -0.2 + (i % 3) * 0.2 + (rand() - 0.5) * 0.04, pz = -0.13 + Math.floor(i / 3) * 0.13;
      P(g, GEO.sphereLo, m, [px, 0.26, pz], null, [0.16, 0.13, 0.16]);
      P(g, GEO.sphereLo, kit.m('#4f9a3a'), [px, 0.33, pz], null, [0.06, 0.02, 0.06], false);
    });
  } else if (produce === 'carrot') {
    const m = kit.m('#f28a2a', { roughness: 0.5 }), leaf = kit.m('#5fbf49');
    put(7, (i) => {
      const pz = -0.16 + i * 0.055;
      P(g, GEO.cone, m, [0.02, 0.25, pz], [0, 0, Math.PI / 2 + (rand() - 0.5) * 0.2], [0.09, 0.36, 0.09]);
      P(g, GEO.cone, leaf, [-0.24, 0.26, pz], [0, 0, -Math.PI / 2], [0.07, 0.16, 0.05], false);
    });
  } else {
    const m = kit.m('#9ad86a', { roughness: 0.6 }), m2 = kit.m('#7ac04a', { roughness: 0.6 });
    put(4, (i) => {
      const px = -0.14 + (i % 2) * 0.28, pz = -0.09 + Math.floor(i / 2) * 0.18;
      P(g, GEO.sphere, m, [px, 0.3, pz], null, [0.25, 0.22, 0.25]);
      P(g, GEO.sphereLo, m2, [px, 0.36, pz], null, [0.2, 0.1, 0.2], false);
    });
  }
  parent.add(g);
}

function signBoard(text: string, bg: string): THREE.CanvasTexture {
  return canvasTex(320, 128, (c, w, h) => {
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, 18);
    c.fill();
    c.fillStyle = '#fffaf0';
    c.font = `bold 58px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 3);
  });
}

function buildStall(kit: Kit, g: THREE.Group, dyn: THREE.Object3D[]): (dt: number, t: number) => void {
  const rand = mulberry32(77);
  const wood = kit.m('#b98a5e'), woodL = kit.m('#d8b484'), dark = kit.m('#8a5a3a');
  // 柱子（後高前低）
  for (const sx of [-1.1, 1.1]) {
    P(g, rbox(0.1, 2.1, 0.1, 0.03), wood, [sx, 1.05, 0.55]);
    P(g, rbox(0.1, 2.38, 0.1, 0.03), wood, [sx, 1.19, -0.55]);
  }
  // 條紋遮陽棚＋扇形垂邊
  const red = kit.m('#e8554a', { roughness: 0.75, side: THREE.DoubleSide });
  const cream = kit.m('#fff4e0', { roughness: 0.75, side: THREE.DoubleSide });
  const n = 8, sw = 2.6 / n;
  const slope = Math.atan2(0.3, 1.5);
  const scallop = new THREE.CircleGeometry(sw / 2, 14, Math.PI, Math.PI);
  for (let i = 0; i < n; i++) {
    const x = -1.3 + sw * (i + 0.5);
    const m = i % 2 ? cream : red;
    P(g, rbox(sw + 0.005, 0.04, 1.62, 0.01), m, [x, 2.26, 0.03], [slope, 0, 0]);
    P(g, scallop, m, [x, 2.13, 0.83], null, null, false);
  }
  P(g, rbox(2.66, 0.06, 0.06, 0.02), dark, [0, 2.13, 0.8]);
  // 櫃台＋招牌
  P(g, rbox(2.3, 0.78, 0.66, 0.05), wood, [0, 0.39, 0.22]);
  P(g, rbox(2.46, 0.07, 0.82, 0.03), woodL, [0, 0.8, 0.22]);
  for (let i = 0; i < 5; i++) P(g, rbox(0.04, 0.7, 0.02, 0.01), dark, [-0.92 + i * 0.46, 0.4, 0.56], null, null, false);
  P(g, rbox(1.16, 0.36, 0.05, 0.04), kit.m('#6a8a4a'), [0, 0.46, 0.59]);
  texPlane(g, signBoard('週末市集', '#5a8a3a'), 1.08, 0.32, [0, 0.46, 0.62]);
  // 櫃台上三箱蔬果
  crate(kit, g, -0.78, 0.84, 0.26, 'tomato', rand);
  crate(kit, g, 0, 0.84, 0.26, 'carrot', rand);
  crate(kit, g, 0.78, 0.84, 0.26, 'cabbage', rand);
  // 吊秤（掛在前梁右側）
  const scale = new THREE.Group();
  scale.position.set(0.72, 2.1, 0.72);
  scale.userData.dyn = true;
  const metal = kit.m('#c8c8d0', { metalness: 0.6, roughness: 0.3 });
  stick(scale, V(0, 0, 0), V(0, -0.2, 0), 0.01, metal, false);
  P(scale, GEO.cyl, kit.m('#e8403a'), [0, -0.3, 0], [Math.PI / 2, 0, 0], [0.22, 0.05, 0.22]);
  P(scale, GEO.cyl, kit.m('#ffffff'), [0, -0.3, 0.028], [Math.PI / 2, 0, 0], [0.17, 0.01, 0.17], false);
  P(scale, rbox(0.012, 0.07, 0.005, 0.002), kit.m('#2a2a2a'), [0.012, -0.28, 0.036], [0, 0, -0.5], null, false);
  for (const a of [0, 2.1, 4.2]) stick(scale, V(0, -0.41, 0), V(Math.cos(a) * 0.14, -0.6, Math.sin(a) * 0.14), 0.005, metal, false);
  P(scale, new THREE.CylinderGeometry(0.17, 0.12, 0.05, 16), metal, [0, -0.62, 0]);
  P(scale, GEO.sphereLo, kit.m('#f28a2a'), [0, -0.56, 0], null, [0.14, 0.1, 0.14], false);
  g.add(scale);
  dyn.push(scale);
  // 彩旗＋夜間小燈泡
  bunting(kit, g, V(-1.1, 2.0, 0.62), V(1.1, 2.0, 0.62), ['#ffd84a', '#6ab8e8', '#ff7aa8', '#8ad86a'], 0.18, 0.2);
  lightString(kit, g, V(-1.2, 2.2, 0.86), V(1.2, 2.2, 0.86), 0.08, [['#fff2c0', '#ffc060']], 1.7, 0.05, 0.3, 0.04);
  // 地上：籃子、南瓜、黑板
  P(g, new THREE.CylinderGeometry(0.22, 0.17, 0.26, 14), kit.m('#c8a060'), [-1.05, 0.13, 0.62]);
  for (let i = 0; i < 5; i++) P(g, GEO.sphereLo, kit.m(i % 2 ? '#e8403a' : '#f2c44a'), [-1.05 + Math.cos(i * 1.3) * 0.1, 0.28, 0.62 + Math.sin(i * 1.3) * 0.1], null, 0.12, false);
  P(g, GEO.sphere, kit.m('#f07a22', { roughness: 0.55 }), [1.0, 0.18, 0.66], null, [0.4, 0.32, 0.36]);
  P(g, GEO.cyl, kit.m('#6a8a3a'), [1.0, 0.36, 0.66], null, [0.05, 0.1, 0.05], false);
  const board = new THREE.Group();
  board.position.set(-1.28, 0, 0.1);
  board.rotation.y = -0.5;
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.rotation.x = s * 0.18;
    P(leg, rbox(0.42, 0.6, 0.03, 0.02), kit.m('#3a4a3a'), [0, 0.32, s * 0.03]);
    board.add(leg);
  }
  const menu = canvasTex(128, 180, (c, w, h) => {
    c.fillStyle = '#3a4a3a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.font = `bold 26px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.fillText('今日特價', w / 2, 34);
    c.font = `22px ${FONT_ROUND}`;
    ['🍅 番茄', '🥕 蘿蔔', '🥬 高麗菜'].forEach((l, i) => c.fillText(l, w / 2, 76 + i * 34));
  });
  texPlane(board, menu, 0.36, 0.5, [0, 0.34, 0.1], 0);
  g.add(board);
  // 老闆（站在櫃台後）
  const npc = shopkeeper(kit);
  npc.g.position.set(0.15, 0, -0.35);
  npc.g.userData.dyn = true;
  g.add(npc.g);
  return (_dt, t) => {
    const b = Math.abs(Math.sin(t * 2.2));
    npc.g.position.y = b * 0.035;
    npc.g.scale.set(1 + b * 0.015, 1 - b * 0.02, 1 + b * 0.015);
    npc.head.rotation.y = Math.sin(t * 0.7) * 0.35;
    npc.head.rotation.z = Math.sin(t * 1.1) * 0.06;
    // 每隔幾秒揮揮手
    const wave = Math.max(0, Math.sin(t * 0.8));
    npc.arm.rotation.z = wave > 0.85 ? 2.2 + Math.sin(t * 12) * 0.35 : 0.1;
    scale.rotation.z = Math.sin(t * 1.4) * 0.05;
  };
}

function buildMerchant(kit: Kit, g: THREE.Group): (dt: number, t: number, glow: number) => void {
  const wood = kit.m('#8a6a4a'), woodL = kit.m('#a8804e'), dark = kit.m('#5a3a22');
  const purple = kit.m('#7a4ab8', { roughness: 0.75, side: THREE.DoubleSide });
  const gold = kit.m('#e8b84a', { metalness: 0.4, roughness: 0.4 });
  // 小木推車（長邊沿 x）
  const cart = new THREE.Group();
  cart.position.set(-0.35, 0, -0.15);
  P(cart, rbox(1.5, 0.12, 0.9, 0.03), wood, [0, 0.62, 0]);
  for (const s of [-1, 1]) {
    P(cart, rbox(1.5, 0.26, 0.06, 0.02), woodL, [0, 0.8, s * 0.43]);
    P(cart, GEO.cyl, dark, [0, 0.4, s * 0.5], [Math.PI / 2, 0, 0], [0.8, 0.07, 0.8]);
    P(cart, GEO.cyl, woodL, [0, 0.4, s * 0.54], [Math.PI / 2, 0, 0], [0.18, 0.03, 0.18], false);
    for (let k = 0; k < 4; k++) P(cart, rbox(0.72, 0.035, 0.02, 0.01), woodL, [0, 0.4, s * 0.52], [0, 0, (k * Math.PI) / 4], null, false);
    stick(cart, V(-0.72, 0.66, s * 0.3), V(-1.25, 0.42, s * 0.3), 0.03, dark);
  }
  P(cart, rbox(0.06, 0.26, 0.9, 0.02), woodL, [0.72, 0.8, 0]);
  P(cart, rbox(0.06, 0.26, 0.9, 0.02), woodL, [-0.72, 0.8, 0]);
  // 紫色拱形車篷＋金色星星
  for (const x of [-0.6, 0.6]) P(cart, new THREE.TorusGeometry(0.46, 0.025, 6, 20, Math.PI), dark, [x, 0.9, 0], [0, Math.PI / 2, 0]);
  P(cart, new THREE.CylinderGeometry(0.47, 0.47, 1.3, 16, 1, true, -Math.PI / 2, Math.PI), purple, [0, 0.9, 0], [0, 0, Math.PI / 2]);
  const starM = kit.lit('#f2e08a', '#ffd24a', 1.6, 0.25);
  for (const [a, x] of [[0.6, -0.35], [1.4, 0.2], [2.2, -0.1], [1.0, 0.45], [2.5, 0.4]]) P(cart, GEO.sphereLo, starM, [x, 0.9 + Math.sin(a) * 0.48, Math.cos(a) * 0.48], null, 0.06, false);
  // 車上的貨：瓶瓶罐罐、捲起來的地毯、水晶球
  const goods: [number, number, string, number][] = [[-0.45, 0.2, '#6ac8e8', 0.9], [-0.25, -0.2, '#e86aa8', 0.8], [0.1, 0.22, '#8ae86a', 0.85], [0.3, -0.15, '#f2c44a', 0.95]];
  for (const [x, z, c, s] of goods) {
    P(cart, GEO.sphere, kit.lit(c, c, 1.4, 0.3, { roughness: 0.2 }), [x, 0.8 * s, z], null, 0.22 * s);
    P(cart, GEO.cyl, kit.m('#c89b62'), [x, 0.8 * s + 0.14, z], null, [0.06, 0.1, 0.06], false);
  }
  P(cart, GEO.cyl, kit.m('#c8453a'), [0.5, 0.78, 0.05], [Math.PI / 2, 0, 0], [0.16, 0.7, 0.16]);
  P(cart, GEO.cyl, kit.m('#3a8ab8'), [0.52, 0.93, -0.05], [Math.PI / 2, 0, 0], [0.13, 0.62, 0.13]);
  g.add(cart);
  // 地上的小地毯＋水晶球
  const rug = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#8a3a4a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f2c44a';
    c.lineWidth = 6;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#e8a23a';
    for (let i = 0; i < 5; i++) {
      const cx = 36 + i * 46;
      c.beginPath(); c.moveTo(cx, 34); c.lineTo(cx + 16, 64); c.lineTo(cx, 94); c.lineTo(cx - 16, 64); c.closePath(); c.fill();
    }
  });
  const rugM = mat('#ffffff', { map: rug, roughness: 0.95 });
  const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), rugM);
  rugMesh.rotation.x = -Math.PI / 2;
  rugMesh.position.set(-0.3, 0.012, 0.55);
  rugMesh.receiveShadow = true;
  g.add(rugMesh);
  const orb = kit.lit('#b89aff', '#9a6aff', 1.8, 0.6, { roughness: 0.1, transparent: true, opacity: 0.85 });
  P(g, GEO.cyl, gold, [-0.55, 0.06, 0.55], null, [0.2, 0.08, 0.2]);
  const orbMesh = P(g, GEO.sphere, orb, [-0.55, 0.22, 0.55], null, 0.26, false);
  orbMesh.userData.dyn = true;
  P(g, new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12), kit.m('#6a6a72', { metalness: 0.5, roughness: 0.4 }), [0.05, 0.1, 0.6]);
  P(g, GEO.sphere, kit.lit('#6ae8c0', '#4affc0', 1.4, 0.3, { roughness: 0.2 }), [0.05, 0.28, 0.6], null, 0.16, false);
  // 商人站在推車右前方
  const w = wanderer(kit);
  w.g.position.set(0.82, 0, 0.32);
  w.g.rotation.y = -0.25;
  w.g.userData.dyn = true;
  g.add(w.g);
  return (_dt, t, glow) => {
    w.g.position.y = Math.abs(Math.sin(t * 1.6)) * 0.025;
    w.g.rotation.z = Math.sin(t * 0.8) * 0.03;
    w.lamp.rotation.z = Math.sin(t * 1.5) * 0.12;
    w.lamp.rotation.x = Math.sin(t * 1.1) * 0.06;
    orb.emissiveIntensity = (0.6 + glow * 1.8) * (0.75 + 0.25 * Math.sin(t * 2.5));
    orbMesh.scale.setScalar(0.26 * (1 + Math.sin(t * 2.5) * 0.02));
  };
}

export function buildMarket(kind: 'merchant' | 'market'): Deco & { hit: THREE.Object3D } {
  const kit = new Kit();
  const group = new THREE.Group();
  group.userData.kind = 'market';
  const dyn: THREE.Object3D[] = [];
  let tick: Deco['tick'];
  if (kind === 'market') {
    const f = buildStall(kit, group, dyn);
    tick = (dt, t) => f(dt, t);
  } else tick = buildMerchant(kit, group);
  bake(group);
  return { group, glow: kit.glow, tick, hit: group };
}
