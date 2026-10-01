import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEO, mat, mesh, withRim } from './materials';

// 服裝工坊：主角頭飾／眼鏡、寵物服裝
// 主角配件掛在 head 節點（座標＝頭部區域座標：頭球心約 (0, 0.28, 0)、半徑 0.345，頭髮頂約 0.68）
// 寵物服裝掛在 rig 的 hat / neck 錨點或 body 樞紐，會跟著成長階段的縮放一起變大

export type PetSpecies = 'corgi' | 'cat' | 'bunny' | 'duck';
export type OutfitAnchor = 'hat' | 'neck' | 'body';
export interface PlayerAccItem { id: string; name: string; emoji: string; price: number; slot: 'hat' | 'glasses'; desc: string }
export interface PetOutfitItem { id: string; name: string; emoji: string; price: number; anchor: OutfitAnchor; desc: string }

// 主角頭飾（slot='hat' 戴上時取代草帽；slot='glasses' 是獨立欄位，可以和帽子一起戴）
export const PLAYER_ACC: PlayerAccItem[] = [
  { id: 'acc_kerchief', name: '農夫頭巾', emoji: '🌾', price: 800, slot: 'hat', desc: '藍底白點的棉頭巾，下田最有架勢' },
  { id: 'acc_beanie', name: '毛線帽', emoji: '🧶', price: 1500, slot: 'hat', desc: '紅白條紋針織帽，頂著一顆毛球' },
  { id: 'acc_cap', name: '棒球帽', emoji: '🧢', price: 1800, slot: 'hat', desc: '綠色網帽，前面繡了一顆小番茄' },
  { id: 'acc_glasses', name: '圓框眼鏡', emoji: '👓', price: 2200, slot: 'glasses', desc: '文青圓框眼鏡，可以和帽子一起戴' },
  { id: 'acc_beret', name: '貝雷帽', emoji: '🎨', price: 2800, slot: 'hat', desc: '覆盆莓色貝雷帽，別著草莓小徽章' },
  { id: 'acc_bucket', name: '漁夫帽', emoji: '🎣', price: 3200, slot: 'hat', desc: '丹寧藍漁夫帽，帽帶別一朵小雛菊' },
  { id: 'acc_earmuff', name: '耳罩', emoji: '🎧', price: 4200, slot: 'hat', desc: '毛茸茸的粉紅耳罩，冬天也不怕冷' },
  { id: 'acc_flower', name: '花冠', emoji: '🌸', price: 6000, slot: 'hat', desc: '用田邊野花編的花冠，春天的味道' },
];

// 寵物服裝（anchor：主要掛點；雨衣另外有帽兜掛在頭上）
export const PET_OUTFIT: PetOutfitItem[] = [
  { id: 'outfit_bowtie', name: '小領結', emoji: '👔', price: 600, anchor: 'neck', desc: '白領子配深藍點點領結，紳士登場' },
  { id: 'outfit_bow', name: '蝴蝶結', emoji: '🎀', price: 900, anchor: 'hat', desc: '粉紅點點蝴蝶結，別在耳朵旁' },
  { id: 'outfit_bell', name: '鈴鐺項圈', emoji: '🔔', price: 1500, anchor: 'neck', desc: '紅皮項圈掛金色小鈴鐺' },
  { id: 'outfit_scarf', name: '毛線圍巾', emoji: '🧣', price: 2000, anchor: 'neck', desc: '湖水綠條紋圍巾，尾巴垂在胸前' },
  { id: 'outfit_vest', name: '小背心', emoji: '🦺', price: 2800, anchor: 'body', desc: '紅格紋法蘭絨小背心' },
  { id: 'outfit_raincoat', name: '雨衣', emoji: '☔', price: 4000, anchor: 'body', desc: '黃色小雨衣＋帽兜，下雨天也能出門' },
];

export const isPlayerHat = (id: string): boolean => PLAYER_ACC.some((a) => a.id === id && a.slot === 'hat');
export const isPlayerGlasses = (id: string): boolean => PLAYER_ACC.some((a) => a.id === id && a.slot === 'glasses');

// ---------- 共用材質／幾何快取（反覆換裝不會一直新建） ----------
const MATS = new Map<string, THREE.MeshStandardMaterial>();
function cm(key: string, make: () => THREE.MeshStandardMaterial, rim = 0.14): THREE.MeshStandardMaterial {
  let m = MATS.get(key);
  if (!m) { m = rim > 0 ? withRim(make(), rim) : make(); MATS.set(key, m); }
  return m;
}
const cloth = (c: string, rough = 0.9) => cm(`cloth${c}${rough}`, () => mat(c, { roughness: rough }));
const cloth2 = (c: string, rough = 0.9) => cm(`cloth2${c}${rough}`, () => mat(c, { roughness: rough, side: THREE.DoubleSide }));
const vcol = (rough = 0.92, side: THREE.Side = THREE.FrontSide) => cm(`vcol${rough}${side}`, () => mat('#ffffff', { roughness: rough, vertexColors: true, side }));
const gold = () => cm('gold', () => mat('#ffcf4a', { metalness: 0.55, roughness: 0.3 }), 0.1);
const plain = (c: string, o: THREE.MeshStandardMaterialParameters = {}) => cm(`plain${c}${JSON.stringify(o)}`, () => mat(c, { roughness: 0.6, ...o }), 0);

const GEOS = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEOS.get(key);
  if (!g) { g = make(); GEOS.set(key, g); }
  return g;
}

// 合併接縫頂點再算法線，避免變形後出現裂縫
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

// 針織直紋：沿圓周做起伏
function ribbed(g: THREE.BufferGeometry, n: number, amp: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + amp * Math.cos(Math.atan2(v.z, v.x) * n);
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  return smooth(g);
}

// 毛茸茸的球（毛球、耳罩）
function fluffy(): THREE.BufferGeometry {
  return geo('fluffy', () => {
    const g = new THREE.IcosahedronGeometry(0.5, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      const k = 1 + 0.07 * Math.sin(n.x * 13 + 1) * Math.sin(n.y * 11 + 2) * Math.sin(n.z * 12 + 3) + 0.04 * Math.sin(n.x * 29 + n.y * 23 + n.z * 31);
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    return smooth(g);
  });
}

// 依頂點高度上色（條紋）
function paintBy(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, i: number) => string): THREE.BufferGeometry {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.set(f(p.getX(i), p.getY(i), p.getZ(i), i)).convertSRGBToLinear();
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// 沿著水平橢圓（xz 平面）的管子：帽緣、項圈、花冠藤蔓
function ringTube(rx: number, rz: number, tube: number, seg = 64, radial = 8): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), seg, tube, radial, true);
}
function pathTube(pts: THREE.Vector3[], tube: number, closed = false, seg = 64): THREE.TubeGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, tube, 8, closed);
}

// 畫布貼圖：圓點、格紋
const TEX = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, rx = 1, ry = 1): THREE.CanvasTexture {
  let t = TEX.get(key);
  if (!t) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d')!);
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    TEX.set(key, t);
  }
  return t;
}
function polkaTex(bg: string, dot: string, nx: number, ny: number, r: number, skipTop = 0): THREE.CanvasTexture {
  return canvasTex(`polka${bg}${dot}${nx}${ny}${skipTop}`, 512, 256, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 512, 256);
    c.fillStyle = dot;
    for (let j = skipTop; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = ((i + (j % 2) * 0.5) / nx) * 512, y = ((j + 0.5) / ny) * 256;
      for (const ox of [-512, 0, 512]) { c.beginPath(); c.arc(x + ox, y, r, 0, Math.PI * 2); c.fill(); }
    }
  });
}
function plaidTex(): THREE.CanvasTexture {
  return canvasTex('plaid', 256, 256, (c) => {
    c.fillStyle = '#c4473a'; c.fillRect(0, 0, 256, 256);
    c.globalAlpha = 0.45; c.fillStyle = '#7a2420';
    for (let i = 0; i < 4; i++) { c.fillRect(i * 64 + 14, 0, 26, 256); c.fillRect(0, i * 64 + 14, 256, 26); }
    c.globalAlpha = 0.8; c.fillStyle = '#ffe9c4';
    for (let i = 0; i < 4; i++) { c.fillRect(i * 64 + 52, 0, 4, 256); c.fillRect(0, i * 64 + 52, 256, 4); }
    c.globalAlpha = 1;
  }, 3, 2);
}

// 小花（花冠、漁夫帽、項圈用）：花面朝 +y
function flower(petal: string, center: string, s = 1): THREE.Group {
  const g = new THREE.Group();
  const pm = cloth(petal, 0.7);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = mesh(GEO.sphereLo, pm, false);
    p.scale.set(0.05 * s, 0.018 * s, 0.032 * s);
    p.position.set(Math.cos(a) * 0.036 * s, 0, Math.sin(a) * 0.036 * s);
    p.rotation.y = -a;
    g.add(p);
  }
  const c = mesh(GEO.sphereLo, cloth(center, 0.6), false);
  c.scale.set(0.034 * s, 0.022 * s, 0.034 * s);
  c.position.y = 0.008 * s;
  g.add(c);
  return g;
}
function leaf(c = '#5aa04a', s = 1): THREE.Mesh {
  const l = mesh(GEO.sphereLo, cloth(c, 0.7), false);
  l.scale.set(0.055 * s, 0.012 * s, 0.026 * s);
  return l;
}
// 讓物件的 +y 朝向指定方向
function faceTo(o: THREE.Object3D, dir: THREE.Vector3): void {
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
}

// ====================================================================
// 主角配件
// ====================================================================

// 配件和髮型的貼合規格（配件區域座標、未縮放）：
// rim：帽緣高度帶內的頭髮必須在帽緣橢圓內；dome：帽緣以上的頭髮必須在帽頂橢球內；side：耳罩兩側
export interface AccFit {
  rim?: { y: number; h: number; r: [number, number]; c?: [number, number]; back?: number };
  dome?: { c: [number, number, number]; r: [number, number, number]; p?: number; above: number; back?: number };
  side?: { y: number; h: number; x: number };
  slab?: number; // 只看 |z| < slab 的頭髮（耳罩頭帶）
  maxS?: number;
  maxSy?: number;
}

function hatRoot(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  return g;
}
// 標記「縮放貼合時保持原比例」的小零件（毛球、徽章）；userData.coversTop＝會包住頭頂（呆毛要收起來）
function noStretch(o: THREE.Object3D): THREE.Object3D {
  o.userData.noStretch = true;
  o.userData.baseScale = o.scale.clone();
  return o;
}

// 毛線帽：芥末黃條紋＋反折帽緣＋毛球
function beanie(): THREE.Group {
  const g = hatRoot(0, 0.44, -0.025, -0.1);
  const dome = mesh(geo('beanieDome', () => paintBy(ribbed(new THREE.SphereGeometry(1, 56, 18, 0, Math.PI * 2, 0, Math.PI / 2), 28, 0.018), (_x, y) => {
    return (y > 0.2 && y < 0.33) || (y > 0.5 && y < 0.62) ? '#fff1d6' : '#e2554a';
  })), vcol(0.95));
  dome.scale.set(0.395, 0.37, 0.405);
  dome.position.y = 0.045;
  const cuff = mesh(geo('beanieCuff', () => ribbed(new THREE.CylinderGeometry(1, 1.01, 1, 56, 1, true), 28, 0.022)), cloth2('#c9443c', 0.95));
  cuff.scale.set(0.41, 0.085, 0.42);
  cuff.position.y = 0.025;
  const lipT = mesh(geo('beanieLip', () => ringTube(0.41, 0.42, 0.016)), cloth('#c9443c', 0.95));
  lipT.position.y = 0.068;
  const lipB = lipT.clone();
  lipB.position.y = -0.016;
  const pom = mesh(fluffy(), cloth('#fff4e2', 1));
  pom.scale.setScalar(0.19);
  pom.position.y = 0.045 + 0.37 + 0.06;
  noStretch(pom);
  g.add(dome, cuff, lipT, lipB, pom);
  g.userData.fit = { rim: { y: -0.02, h: 0.08, r: [0.41, 0.42] }, dome: { c: [0, 0.045, 0], r: [0.395, 0.37, 0.405], above: 0.07 } } as AccFit;
  g.userData.coversTop = true;
  return g;
}

// 貝雷帽：歪戴一邊＋頂上小尾巴＋草莓徽章
function beret(): THREE.Group {
  const g = hatRoot(0, 0.515, -0.03, -0.12, 0, -0.2);
  const main = cloth('#c8435a', 0.85);
  const band = mesh(geo('beretBand', () => ringTube(0.36, 0.37, 0.028)), cloth('#9a2c44', 0.85));
  const puff = mesh(GEO.sphere, main);
  puff.scale.set(0.92, 0.29, 0.92);
  puff.position.set(0.05, 0.11, -0.02);
  const stem = mesh(GEO.cyl, main);
  stem.scale.set(0.03, 0.06, 0.03);
  stem.position.set(0.05, 0.27, -0.02);
  stem.rotation.z = 0.3;
  // 草莓小徽章
  const pin = new THREE.Group();
  const berry = mesh(GEO.sphere, plain('#ff4a5a', { roughness: 0.4 }), false);
  berry.scale.set(0.06, 0.07, 0.04);
  const cap = mesh(GEO.cone, plain('#4fa04a'), false);
  cap.scale.set(0.06, 0.025, 0.04);
  cap.position.y = 0.035;
  pin.add(berry, cap);
  for (let i = 0; i < 4; i++) {
    const seed = mesh(GEO.sphereLo, plain('#ffe27a'), false);
    seed.scale.setScalar(0.008);
    seed.position.set(((i % 2) - 0.5) * 0.024, -0.01 - Math.floor(i / 2) * 0.02, 0.019);
    pin.add(seed);
  }
  pin.position.set(-0.27, 0.06, 0.26);
  pin.rotation.set(-0.3, -0.75, 0.15);
  noStretch(pin);
  g.add(band, puff, stem, pin);
  g.userData.fit = { rim: { y: -0.02, h: 0.07, r: [0.36, 0.37], back: -0.22 }, dome: { c: [0.05, 0.11, -0.02], r: [0.46, 0.145, 0.46], above: 0.05 }, maxS: 1.1 } as AccFit;
  g.userData.coversTop = true;
  return g;
}

// 花冠：綠藤圍一圈＋各色小花＋葉子
function flowerCrown(): THREE.Group {
  const g = hatRoot(0, 0.5, -0.02, -0.14);
  const rx = 0.385, rz = 0.4;
  const vine = mesh(geo('crownVine', () => ringTube(rx, rz, 0.02)), cloth('#5f9e4c', 0.8));
  g.add(vine);
  const cols: [string, string][] = [['#ff8fb1', '#ffd25a'], ['#fff8f0', '#ffcf3a'], ['#ffd25a', '#f08a3a'], ['#c9a2ff', '#ffe27a'], ['#ff9f6a', '#ffe27a']];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2; // i=0 在正前方
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const front = i === 0 ? 1.45 : i === 1 || i === n - 1 ? 1.15 : 1;
    const f = flower(cols[i % cols.length][0], cols[i % cols.length][1], front * 1.05);
    f.position.set(Math.cos(a) * rx, 0.02, Math.sin(a) * rz);
    faceTo(f, out.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 1, 0)));
    g.add(f);
    // 兩朵花之間夾兩片葉子
    const b = a + Math.PI / n;
    for (const k of [-1, 1]) {
      const l = leaf('#5aa04a', 1);
      l.position.set(Math.cos(b + k * 0.07) * (rx + 0.01), 0.0, Math.sin(b + k * 0.07) * (rz + 0.01));
      l.rotation.set(0, -b + Math.PI / 2 + k * 0.5, k * 0.35);
      g.add(l);
    }
  }
  g.userData.fit = { rim: { y: -0.03, h: 0.07, r: [rx, rz], back: -0.3 }, maxS: 1.12 } as AccFit;
  return g;
}

// 棒球帽（網帽）：綠色帽身、米白前片、番茄刺繡，微微歪戴
function cap(): THREE.Group {
  const g = hatRoot(0, 0.45, -0.02, -0.07, 0.38, 0.07);
  const crown = mesh(geo('capCrown', () => paintBy(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), (x, y, z) => {
    const front = Math.atan2(x, z); // 0 = 正前方
    return Math.abs(front) < 0.85 && y < 0.93 ? '#fff3dc' : '#4fa36a';
  })), vcol(0.85));
  crown.scale.set(0.405, 0.335, 0.415);
  const btn = mesh(GEO.sphereLo, cloth('#4fa36a', 0.85));
  btn.scale.set(0.06, 0.03, 0.06);
  btn.position.y = 0.33;
  // 帽簷：半橢圓板
  const visor = mesh(geo('capVisor', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.34, 0);
    s.absellipse(0, 0, 0.34, 0.44, Math.PI, 0, true, 0);
    s.lineTo(-0.34, 0);
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 24 });
    e.rotateX(Math.PI / 2);
    return e;
  }), cloth('#3f8f58', 0.85));
  visor.position.set(0, 0.012, 0.18);
  visor.rotation.x = 0.16;
  // 番茄刺繡（前片中央）
  const badge = new THREE.Group();
  const tomato = mesh(GEO.sphere, plain('#ec4a3c', { roughness: 0.5 }), false);
  tomato.scale.set(0.09, 0.075, 0.035);
  const calyx = mesh(GEO.cone, plain('#4f9e3a'), false);
  calyx.scale.set(0.06, 0.03, 0.02);
  calyx.position.y = 0.04;
  badge.add(tomato, calyx);
  const bn = new THREE.Vector3(0, Math.sin(0.62), Math.cos(0.62));
  badge.position.set(0, bn.y * 0.335 + 0.005, bn.z * 0.415 + 0.005);
  badge.rotation.x = -0.62;
  noStretch(badge);
  g.add(crown, btn, visor, badge);
  g.userData.fit = { rim: { y: -0.02, h: 0.07, r: [0.405, 0.415] }, dome: { c: [0, 0, 0], r: [0.405, 0.335, 0.415], above: 0.05 } } as AccFit;
  g.userData.coversTop = true;
  return g;
}

// 漁夫帽：丹寧藍、米白帽帶、小雛菊
function bucket(): THREE.Group {
  const g = hatRoot(0, 0.49, -0.02, -0.16);
  const denim = cloth2('#6f9bd1', 0.9);
  const crown = mesh(geo('bucketCrown', () => new THREE.LatheGeometry(
    [[0.392, 0], [0.388, 0.06], [0.375, 0.13], [0.352, 0.19], [0.31, 0.236], [0.22, 0.262], [0.1, 0.274], [0, 0.277]].map(([x, y]) => new THREE.Vector2(x, y)), 40)), denim);
  const band = mesh(geo('bucketBand', () => new THREE.CylinderGeometry(0.391, 0.396, 0.06, 40, 1, true)), cloth2('#fff1d6', 0.9));
  band.position.y = 0.04;
  const brim = mesh(geo('bucketBrim', () => new THREE.LatheGeometry(
    [[0.385, 0.012], [0.44, -0.006], [0.5, -0.028], [0.55, -0.05], [0.57, -0.06]].map(([x, y]) => new THREE.Vector2(x, y)), 48)), denim);
  const edge = mesh(geo('bucketEdge', () => ringTube(0.57, 0.57, 0.013, 72)), cloth('#5f8bc1', 0.9));
  edge.position.y = -0.06;
  const stitchM = cloth('#c9dbf0', 0.9);
  for (const [r, y] of [[0.47, -0.019], [0.52, -0.037]]) {
    const s = mesh(geo(`bucketStitch${r}`, () => ringTube(r, r, 0.0045, 72, 4)), stitchM, false);
    s.position.y = y + 0.006;
    g.add(s);
  }
  const daisy = flower('#ffffff', '#ffcf3a', 1.25);
  daisy.position.set(0.3, 0.05, 0.26);
  faceTo(daisy, new THREE.Vector3(0.75, 0.15, 0.65));
  noStretch(daisy);
  g.add(crown, band, brim, edge, daisy);
  g.userData.fit = { rim: { y: -0.02, h: 0.07, r: [0.392, 0.392] }, dome: { c: [0, 0, 0], r: [0.385, 0.277, 0.385], p: 3, above: 0.05 } } as AccFit;
  g.userData.coversTop = true;
  return g;
}

// 農夫頭巾：藍底白點，包住頭頂、在後頸打結
function kerchief(): THREE.Group {
  const g = hatRoot(0, 0.38, -0.03, -0.32);
  const tex = polkaTex('#3f73c4', '#fff6ea', 14, 6, 7, 1);
  const shellM = cm('kerchief', () => mat('#ffffff', { map: tex, roughness: 0.92, side: THREE.DoubleSide }));
  const th = Math.PI * 0.6;
  const shell = mesh(geo('kerchiefShell', () => new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, th)), shellM);
  const R: [number, number, number] = [0.4, 0.345, 0.42];
  shell.scale.set(...R);
  const ey = Math.cos(th) * R[1], er = Math.sin(th);
  const hem = mesh(geo('kerchiefHem', () => ringTube(er * R[0], er * R[2], 0.014)), cloth('#335fa6', 0.92));
  hem.position.y = ey;
  // 後頸的結＋兩條布尾
  const knotM = cm('kerchiefKnot', () => mat('#ffffff', { map: tex, roughness: 0.92 }));
  const knot = mesh(GEO.sphere, knotM);
  knot.scale.set(0.1, 0.08, 0.07);
  knot.position.set(0, ey + 0.02, -er * R[2] - 0.02);
  g.add(shell, hem, knot);
  for (const sx of [-1, 1]) {
    const tail = mesh(GEO.cone, knotM);
    tail.scale.set(0.09, 0.15, 0.03);
    tail.position.set(sx * 0.06, ey - 0.06, -er * R[2] - 0.03);
    tail.rotation.set(0.25, 0, sx * 0.55 + Math.PI);
    g.add(tail);
  }
  g.userData.fit = { rim: { y: ey, h: 0.08, r: [er * R[0], er * R[2]], back: -0.25 }, dome: { c: [0, 0, 0], r: R, above: ey + 0.06, back: -0.3 } } as AccFit;
  g.userData.coversTop = true;
  return g;
}

// 耳罩：頭帶跨過頭頂、兩顆毛茸茸耳罩蓋住耳朵
function earmuffs(): THREE.Group {
  const g = hatRoot(0, 0.26, -0.02, -0.3);
  const R = 0.445, Ry = 0.445;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * Ry, 0)); }
  const band = mesh(geo('muffBand', () => pathTube(pts, 0.026, false, 48)), cloth('#f4e8f4', 0.6));
  g.add(band);
  for (const sx of [-1, 1]) {
    const muff = new THREE.Group();
    muff.position.set(sx * R, 0, 0);
    const fur = mesh(fluffy(), cloth('#ffb3c9', 1));
    fur.scale.set(0.17, 0.27, 0.27);
    const cup = mesh(GEO.sphere, cloth('#f4e8f4', 0.6));
    cup.scale.set(0.09, 0.2, 0.2);
    cup.position.x = sx * 0.06;
    // 杯面上的小愛心
    const heart = new THREE.Group();
    for (const hx of [-1, 1]) {
      const h = mesh(GEO.sphereLo, plain('#ff6f9a'), false);
      h.scale.set(0.03, 0.035, 0.02);
      h.position.set(0, 0.012, hx * 0.016);
      heart.add(h);
    }
    const tip = mesh(GEO.cone, plain('#ff6f9a'), false);
    tip.scale.set(0.05, 0.035, 0.02);
    tip.rotation.x = Math.PI;
    tip.position.y = -0.012;
    heart.add(tip);
    heart.position.x = sx * 0.106;
    heart.rotation.set(0, sx * Math.PI / 2, 0);
    heart.rotation.order = 'YXZ';
    muff.add(fur, cup, heart);
    noStretch(muff);
    g.add(muff);
  }
  g.userData.fit = { slab: 0.1, dome: { c: [0, 0, 0], r: [R, Ry, 9], above: 0.12 }, side: { y: 0, h: 0.12, x: R - 0.08 }, maxS: 1.12 } as AccFit;
  return g;
}

// 圓框眼鏡：咖啡色粗框＋淡藍鏡片反光
function glasses(): THREE.Group {
  const g = hatRoot(0, 0.272, 0.36);
  const frame = cloth('#5b3a28', 0.45);
  const glass = cm('lens', () => mat('#d8ecff', { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false }), 0);
  const shine = cm('lensShine', () => mat('#ffffff', { transparent: true, opacity: 0.55, emissive: '#ffffff', emissiveIntensity: 0.5, depthWrite: false }), 0);
  for (const sx of [-1, 1]) {
    const ring = mesh(geo('lensRing', () => new THREE.TorusGeometry(0.088, 0.013, 8, 32)), frame);
    ring.position.x = sx * 0.12;
    const lens = mesh(geo('lensDisc', () => new THREE.CircleGeometry(0.084, 28)), glass, false);
    lens.position.set(sx * 0.12, 0, -0.002);
    const sh = mesh(geo('lensShine', () => new THREE.PlaneGeometry(0.018, 0.075)), shine, false);
    sh.position.set(sx * 0.12 - 0.03, 0.022, 0.003);
    sh.rotation.z = -0.6;
    // 鏡腳：往後伸進頭髮／耳朵
    const temple = mesh(GEO.cyl, frame);
    const a = new THREE.Vector3(sx * 0.205, 0.01, -0.005), b = new THREE.Vector3(sx * 0.335, 0.03, -0.34);
    temple.position.copy(a).add(b).multiplyScalar(0.5);
    temple.scale.set(0.018, a.distanceTo(b), 0.018);
    faceTo(temple, b.clone().sub(a));
    g.add(ring, lens, sh, temple);
  }
  const bridge = mesh(geo('lensBridge', () => new THREE.TorusGeometry(0.034, 0.011, 6, 14, Math.PI)), frame);
  bridge.position.y = 0.012;
  g.add(bridge);
  return g;
}

const PLAYER_BUILDERS: Record<string, () => THREE.Group> = {
  acc_beanie: beanie, acc_beret: beret, acc_flower: flowerCrown, acc_cap: cap,
  acc_bucket: bucket, acc_kerchief: kerchief, acc_glasses: glasses, acc_earmuff: earmuffs,
};

// 建立主角配件（掛在 head 節點下）。未知 id 回傳空群組
export function buildPlayerAcc(id: string): THREE.Group {
  const g = PLAYER_BUILDERS[id]?.() ?? new THREE.Group();
  g.name = `acc:${id}`;
  g.userData.accId = id;
  return g;
}

// 依目前髮型把帽子撐大／拉高，讓頭髮不會穿出帽子（刺刺頭、包包頭、呆毛）
// acc 必須已經是 head 的子物件；hair 是目前顯示的髮型節點
const ONE = new THREE.Vector3(1, 1, 1);
export function fitPlayerAcc(acc: THREE.Object3D, head: THREE.Object3D, hair: THREE.Object3D | null): void {
  const fit = acc.userData.fit as AccFit | undefined;
  let s = 1, sy = 1;
  if (fit && hair) {
    head.updateWorldMatrix(true, true);
    const toHead = head.matrixWorld.clone().invert();
    const toAcc = new THREE.Matrix4().compose(acc.position, acc.quaternion, ONE).invert();
    const pts: number[] = [];
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    const shown = (o: THREE.Object3D) => { for (let q: THREE.Object3D | null = o; q && q !== head; q = q.parent) if (!q.visible) return false; return true; };
    hair.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh || !shown(me)) return;
      m.multiplyMatrices(toHead, me.matrixWorld).premultiply(toAcc);
      const pos = me.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        if (fit.slab && Math.abs(v.z) > fit.slab) continue;
        pts.push(v.x, v.y, v.z);
      }
    });
    const n = pts.length / 3;
    const tol = Math.max(2, n * 0.002);
    const K = 0.97;
    const rimBad = (S: number) => {
      let bad = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i] / S, y = pts[i + 1], z = pts[i + 2] / S;
        const r = fit.rim;
        if (r && y > r.y - 0.02 && y < r.y + r.h && z > (r.back ?? -0.3)) {
          const ex = (x - (r.c?.[0] ?? 0)) / r.r[0], ez = (z - (r.c?.[1] ?? 0)) / r.r[1];
          if (ex * ex + ez * ez > K * K) bad++;
        }
        const sd = fit.side;
        if (sd && Math.abs(y - sd.y) < sd.h && Math.abs(x) > sd.x) bad++;
      }
      return bad;
    };
    const domeBad = (S: number, SY: number) => {
      const d = fit.dome!;
      const p = d.p ?? 2;
      let bad = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i] / S, y = pts[i + 1] / SY, z = pts[i + 2] / S;
        if (y < d.above || (d.back !== undefined && z < d.back)) continue;
        const hx = (x - d.c[0]) / d.r[0], hz = fit.slab ? 0 : (z - d.c[2]) / d.r[2];
        const h = Math.sqrt(hx * hx + hz * hz);
        if (h > 0.92) continue; // 從帽子側邊／後面露出來的頭髮（馬尾）不管
        const e = Math.pow(Math.pow(h, p) + Math.pow(Math.abs((y - d.c[1]) / d.r[1]), p), 1 / p);
        if (e > K) bad++;
      }
      return bad;
    };
    const maxS = fit.maxS ?? 1.15, maxSy = fit.maxSy ?? 1.45;
    if (fit.rim || fit.side) while (s < maxS && rimBad(s) > tol) s += 0.02;
    if (fit.dome) while (sy < maxSy && domeBad(s, sy) > tol) sy += 0.03;
  }
  acc.scale.set(s, sy, s);
  // 小零件維持原比例
  acc.traverse((o) => {
    if (!o.userData.noStretch) return;
    const b = o.userData.baseScale as THREE.Vector3;
    o.scale.set(b.x / s, b.y / sy, b.z / s);
  });
}

// ====================================================================
// 寵物服裝
// ====================================================================

// 各物種 hat 錨點位置（對齊 pet.ts 程式建模與 GLB 的 hat_anchor）
const HAT_AT: Record<PetSpecies, [number, number, number]> = { corgi: [0, 0.2, 0.02], cat: [0, 0.2, 0], bunny: [0, 0.2, 0], duck: [0, 0.18, 0] };

// 頸圈：中心（相對 neck 錨點）、橢圓半徑、前低後高的傾斜；grow＝頭每放大 1 倍時 [往下, 往前, 放大] 的量
const NECK: Record<PetSpecies, { c: [number, number, number]; r: [number, number]; tilt: number; grow: [number, number, number] }> = {
  corgi: { c: [0, 0.03, -0.03], r: [0.185, 0.17], tilt: 0.55, grow: [0.12, -0.05, 0.35] },
  cat: { c: [0, 0.0, -0.05], r: [0.16, 0.16], tilt: 0.45, grow: [0.12, -0.05, 0.35] },
  bunny: { c: [0, 0.02, -0.07], r: [0.235, 0.2], tilt: 0.6, grow: [0.25, 0.12, 0.45] },
  duck: { c: [0, 0.0, -0.02], r: [0.17, 0.16], tilt: 0.3, grow: [0.12, -0.03, 0.35] },
};
// 身體：背心橢球（相對 body 樞紐）
const TORSO: Record<PetSpecies, { c: [number, number, number]; r: [number, number, number]; th: number; p: number }> = {
  corgi: { c: [0, 0.33, -0.05], r: [0.242, 0.215, 0.36], th: 0.56, p: 2.6 },
  cat: { c: [0, 0.38, -0.03], r: [0.192, 0.19, 0.33], th: 0.56, p: 2.8 },
  bunny: { c: [0, 0.27, -0.05], r: [0.292, 0.278, 0.315], th: 0.6, p: 2.2 },
  duck: { c: [0, 0.33, -0.01], r: [0.258, 0.26, 0.305], th: 0.6, p: 2.2 },
};
// 單位球上的點推到超橢球表面（p=2 就是球）
function superK(x: number, y: number, z: number, p: number): number {
  return 1 / Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p), 1 / p);
}
// 頭：帽兜橢球（相對頭樞紐）＋蝴蝶結位置
const HEAD: Record<PetSpecies, { c: [number, number, number]; r: [number, number, number]; bow: [number, number, number]; bowRot: [number, number, number] }> = {
  corgi: { c: [0, 0.01, 0.0], r: [0.235, 0.215, 0.24], bow: [0.13, 0.15, 0.08], bowRot: [-0.35, 0.25, -0.5] },
  cat: { c: [0, 0.015, 0.0], r: [0.26, 0.22, 0.215], bow: [0.15, 0.16, 0.06], bowRot: [-0.35, 0.25, -0.45] },
  bunny: { c: [0, 0.015, 0.0], r: [0.26, 0.24, 0.225], bow: [0.12, 0.2, 0.05], bowRot: [-0.45, 0.15, -0.4] },
  duck: { c: [0, 0.0, 0.0], r: [0.21, 0.21, 0.2], bow: [0.1, 0.16, 0.05], bowRot: [-0.4, 0.2, -0.45] },
};

const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// 頸部群組：原點在頸圈中心，xz 平面＝頸圈平面，+z 是胸前
function neckFrame(sp: PetSpecies): THREE.Group {
  const n = NECK[sp];
  const g = new THREE.Group();
  g.position.set(...n.c);
  g.rotation.x = n.tilt;
  return g;
}

// 蝴蝶結（粉紅點點）
function bowShape(color: string, s = 1): THREE.Group {
  const g = new THREE.Group();
  const tex = polkaTex(color, '#ffffff', 6, 3, 14);
  const m = cm(`bow${color}`, () => mat('#ffffff', { map: tex, roughness: 0.6 }));
  for (const sx of [-1, 1]) {
    const loop = mesh(GEO.sphere, m);
    loop.scale.set(0.11 * s, 0.085 * s, 0.05 * s);
    loop.position.set(sx * 0.058 * s, 0.005 * s, 0);
    loop.rotation.z = sx * 0.28;
    const tail = mesh(GEO.cone, m);
    tail.scale.set(0.045 * s, 0.075 * s, 0.02 * s);
    tail.position.set(sx * 0.03 * s, -0.045 * s, -0.008 * s);
    tail.rotation.z = sx * 0.4;
    g.add(loop, tail);
  }
  const knot = mesh(GEO.sphere, cloth(color, 0.6));
  knot.scale.set(0.045 * s, 0.05 * s, 0.045 * s);
  knot.position.z = 0.012 * s;
  g.add(knot);
  return g;
}

function petBow(sp: PetSpecies): THREE.Group {
  const g = bowShape('#ff6f9f', 1);
  const h = HEAD[sp];
  g.position.set(...sub(h.bow, HAT_AT[sp]));
  g.rotation.set(...h.bowRot);
  return g;
}

// 毛線圍巾：條紋針織圈＋一條垂在胸前的尾巴（含流蘇）
function petScarf(sp: PetSpecies): THREE.Group {
  const g = neckFrame(sp);
  const n = NECK[sp];
  const tube = 0.042;
  const ring = mesh(geo(`scarfRing${sp}`, () => {
    const t = ringTube(n.r[0] + 0.01, n.r[1] + 0.01, tube, 64, 10);
    return paintBy(t, (_x, _y, _z, i) => (Math.floor(i / 11 / 4) % 2 ? '#fff1d6' : '#3fae9a'));
  }), vcol(0.95));
  ring.scale.set(1, 1.25, 1);
  g.add(ring);
  // 垂下來的尾巴：從前側偏左掛下來
  const tail = new THREE.Group();
  tail.position.set(0.07, -0.01, n.r[1] + 0.03);
  tail.rotation.set(-n.tilt + 0.15, 0, 0.18);
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const b = mesh(GEO.capsule, cloth(i % 2 ? '#fff1d6' : '#3fae9a', 0.95));
    b.scale.set(0.085, 0.022, 0.034);
    b.position.y = -0.025 - i * 0.042;
    tail.add(b);
  }
  for (let i = 0; i < 4; i++) {
    const f = mesh(GEO.cyl, cloth('#3fae9a', 0.95), false);
    f.scale.set(0.012, 0.04, 0.012);
    f.position.set(-0.03 + i * 0.02, -0.025 - segs * 0.042 - 0.005, 0);
    tail.add(f);
  }
  g.add(tail);
  return g;
}

// 鈴鐺項圈：紅皮帶＋金鈴鐺
function petBell(sp: PetSpecies): THREE.Group {
  const g = neckFrame(sp);
  const n = NECK[sp];
  const strap = mesh(geo(`bellStrap${sp}`, () => ringTube(n.r[0], n.r[1], 0.022, 64, 8)), cloth('#d63a3a', 0.55));
  strap.scale.set(1, 1.4, 1);
  g.add(strap);
  // 皮帶上的小鉚釘
  for (let i = -2; i <= 2; i++) {
    if (!i) continue;
    const a = Math.PI / 2 + i * 0.5;
    const stud = mesh(GEO.sphereLo, gold(), false);
    stud.scale.setScalar(0.016);
    stud.position.set(Math.cos(a) * (n.r[0] + 0.02), 0, Math.sin(a) * (n.r[1] + 0.02));
    g.add(stud);
  }
  const bell = new THREE.Group();
  bell.position.set(0, -0.045, n.r[1] + 0.02);
  bell.rotation.x = -n.tilt;
  const ball = mesh(GEO.sphere, gold());
  ball.scale.setScalar(0.085);
  const slit = mesh(GEO.cyl, plain('#5a3a10'), false);
  slit.scale.set(0.012, 0.004, 0.06);
  slit.position.set(0, -0.025, 0.02);
  slit.rotation.x = 0.6;
  const dot = mesh(GEO.sphereLo, plain('#5a3a10'), false);
  dot.scale.setScalar(0.016);
  dot.position.set(0, -0.022, 0.034);
  const loop = mesh(geo('bellLoop', () => new THREE.TorusGeometry(0.018, 0.006, 6, 12)), gold(), false);
  loop.position.y = 0.045;
  const hl = mesh(GEO.sphereLo, plain('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 }), false);
  hl.scale.setScalar(0.014);
  hl.position.set(-0.016, 0.018, 0.032);
  bell.add(ball, slit, dot, loop, hl);
  g.add(bell);
  return g;
}

// 小領結：白領子＋深藍點點領結
function petBowtie(sp: PetSpecies): THREE.Group {
  const g = neckFrame(sp);
  const n = NECK[sp];
  const collar = mesh(geo(`collar${sp}`, () => ringTube(n.r[0], n.r[1], 0.02, 64, 8)), cloth('#fffaf2', 0.7));
  collar.scale.set(1, 1.3, 1);
  g.add(collar);
  // 領子的兩個尖角
  for (const sx of [-1, 1]) {
    const pt = mesh(GEO.cone, cloth('#fffaf2', 0.7));
    pt.scale.set(0.05, 0.06, 0.012);
    pt.position.set(sx * 0.035, -0.028, n.r[1] + 0.012);
    pt.rotation.set(-n.tilt * 0.6, 0, Math.PI + sx * 0.5);
    g.add(pt);
  }
  const tie = new THREE.Group();
  tie.position.set(0, -0.012, n.r[1] + 0.03);
  tie.rotation.x = -n.tilt;
  const tex = polkaTex('#2f3f8f', '#ffffff', 8, 4, 9);
  const m = cm('bowtie', () => mat('#ffffff', { map: tex, roughness: 0.55 }));
  for (const sx of [-1, 1]) {
    const wing = mesh(GEO.cone, m);
    wing.scale.set(0.085, 0.075, 0.035);
    wing.rotation.z = sx * Math.PI / 2;
    wing.position.x = sx * 0.04;
    tie.add(wing);
  }
  const knot = mesh(GEO.sphere, cloth('#2f3f8f', 0.55));
  knot.scale.set(0.038, 0.042, 0.036);
  knot.position.z = 0.008;
  tie.add(knot);
  g.add(tie);
  return g;
}

// 身體外套（背心、雨衣共用）：橢球上半殼，前面開一個 V 口讓脖子／肚子出來
function coatShell(key: string, sp: PetSpecies, open: number, m: THREE.Material, trimM: THREE.Material, extra = 0): { g: THREE.Group; pt: (phi: number, th: number, out?: number) => THREE.Vector3 } {
  const T = TORSO[sp];
  const r: [number, number, number] = [T.r[0] + extra, T.r[1] + extra, T.r[2] + extra];
  const th = Math.PI * T.th;
  const g = new THREE.Group();
  // SphereGeometry 的 phi=π/2 是 +z（正前方）
  const ps = Math.PI / 2 + open, pl = Math.PI * 2 - open * 2;
  const shell = mesh(geo(`${key}${sp}`, () => {
    const g = new THREE.SphereGeometry(1, 48, 18, ps, pl, 0, th);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = superK(p.getX(i), p.getY(i), p.getZ(i), T.p);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }), m);
  shell.scale.set(...r);
  shell.position.set(...T.c);
  g.add(shell);
  const pt = (phi: number, t: number, out = 1.0) => {
    const x = -Math.cos(phi) * Math.sin(t), y = Math.cos(t), z = Math.sin(phi) * Math.sin(t);
    const k = superK(x, y, z, T.p) * out;
    return new THREE.Vector3(x * k * r[0] + T.c[0], y * k * r[1] + T.c[1], z * k * r[2] + T.c[2]);
  };
  // 滾邊：左前緣往上 → 背脊 → 右前緣往下 → 沿下緣繞一圈回來
  const pts: THREE.Vector3[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) pts.push(pt(ps, th * (1 - i / N) + 0.02 * (i / N), 1.005));
  for (let i = 0; i <= N; i++) pts.push(pt(ps + pl, 0.02 + (th - 0.02) * (i / N), 1.005));
  for (let i = 1; i < 30; i++) pts.push(pt(ps + pl - (pl * i) / 30, th, 1.005));
  const trim = mesh(geo(`${key}Trim${sp}`, () => pathTube(pts, 0.016, true, 160)), trimM);
  g.add(trim);
  return { g, pt };
}

function petVest(sp: PetSpecies): THREE.Group {
  const tex = plaidTex();
  const m = cm('vest', () => mat('#ffffff', { map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  const { g, pt } = coatShell('vest', sp, 0.62, m, cloth('#fff1d6', 0.9), 0);
  // 兩側口袋上的愛心補丁＋前襟金扣
  const T = TORSO[sp];
  for (const sx of [-1, 1]) {
    const p = pt(Math.PI / 2 + sx * (Math.PI / 2 + 0.25), Math.PI * T.th * 0.62, 1.01);
    const heart = new THREE.Group();
    for (const hx of [-1, 1]) {
      const h = mesh(GEO.sphereLo, cloth('#ffd25a', 0.8), false);
      h.scale.set(0.035, 0.04, 0.02);
      h.position.set(hx * 0.018, 0.012, 0);
      heart.add(h);
    }
    const tip = mesh(GEO.cone, cloth('#ffd25a', 0.8), false);
    tip.scale.set(0.06, 0.045, 0.02);
    tip.rotation.z = Math.PI;
    tip.position.y = -0.016;
    heart.add(tip);
    heart.position.copy(p);
    heart.lookAt(p.clone().sub(new THREE.Vector3(...T.c)).multiply(new THREE.Vector3(1, 0.4, 1)).add(p));
    g.add(heart);
  }
  for (const sx of [-1, 1]) for (const k of [0.45, 0.75]) {
    const b = mesh(GEO.sphereLo, gold(), false);
    b.scale.set(0.028, 0.028, 0.016);
    b.position.copy(pt(Math.PI / 2 + sx * 0.62 + sx * 0.12, Math.PI * T.th * k, 1.01));
    g.add(b);
  }
  return g;
}

// 雨衣：黃色亮面斗篷＋頭上的帽兜（帽兜另外掛在 hat 錨點）
function petRaincoat(sp: PetSpecies): { cape: THREE.Group; hood: THREE.Group } {
  const yellow = cm('rain', () => mat('#ffd23a', { roughness: 0.32, side: THREE.DoubleSide }), 0.2);
  const trimM = cm('rainTrim', () => mat('#f0a92a', { roughness: 0.35 }), 0.15);
  const { g: cape, pt } = coatShell('rain', sp, 0.42, yellow, trimM, 0.012);
  const T = TORSO[sp];
  // 前襟的牛角扣
  for (const sx of [-1, 1]) for (const k of [0.4, 0.7]) {
    const b = mesh(GEO.capsule, cloth('#fff6e6', 0.6), false);
    b.scale.set(0.018, 0.022, 0.018);
    b.position.copy(pt(Math.PI / 2 + sx * 0.42 + sx * 0.08, Math.PI * T.th * k, 1.02));
    b.rotation.z = Math.PI / 2;
    cape.add(b);
  }
  // 帽兜：橢球殼挖掉臉的部分和底部
  const H = HEAD[sp];
  const hood = new THREE.Group();
  hood.position.set(...sub(H.c, HAT_AT[sp]));
  hood.scale.set(...H.r);
  const face = new THREE.Vector3(0, -0.12, 1).normalize();
  const open = 1.05, cut = -0.5;
  const shell = mesh(geo('hoodShell', () => {
    const g = new THREE.SphereGeometry(1.0, 40, 24);
    const pos = g.attributes.position, idx = g.index!;
    const keep: number[] = [];
    const c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), d = idx.getX(i + 2);
      c.set(pos.getX(a) + pos.getX(b) + pos.getX(d), pos.getY(a) + pos.getY(b) + pos.getY(d), pos.getZ(a) + pos.getZ(b) + pos.getZ(d)).divideScalar(3);
      if (c.y < cut) continue;
      if (c.clone().normalize().dot(face) > Math.cos(open)) continue;
      keep.push(a, b, d);
    }
    g.setIndex(keep);
    return g;
  }), yellow);
  hood.add(shell);
  // 帽兜開口的滾邊
  const u = new THREE.Vector3(1, 0, 0), w = new THREE.Vector3().crossVectors(face, u).normalize();
  const rimPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = -Math.PI * 0.5 + (i / 40) * Math.PI * 2;
    const d = face.clone().multiplyScalar(Math.cos(open)).add(u.clone().multiplyScalar(Math.sin(open) * Math.cos(t))).add(w.clone().multiplyScalar(Math.sin(open) * Math.sin(t)));
    if (d.y < cut + 0.05) continue;
    rimPts.push(d.normalize().multiplyScalar(1.01));
  }
  const rim = mesh(geo('hoodRim', () => pathTube(rimPts, 0.06, false, 64)), trimM);
  hood.add(rim);
  return { cape, hood };
}

export interface PetOutfitPart { obj: THREE.Group; anchor: OutfitAnchor }

// 建立寵物服裝：obj 掛到 anchor（hat＝rig.hat、neck＝rig.neck、body＝rig.body）；extra 是其他掛點的零件（雨衣帽兜）
export function buildPetOutfit(id: string, species: PetSpecies): PetOutfitPart & { extra?: PetOutfitPart[] } {
  let r: PetOutfitPart & { extra?: PetOutfitPart[] };
  switch (id) {
    case 'outfit_bow': r = { obj: petBow(species), anchor: 'hat' }; break;
    case 'outfit_scarf': r = { obj: petScarf(species), anchor: 'neck' }; break;
    case 'outfit_vest': r = { obj: petVest(species), anchor: 'body' }; break;
    case 'outfit_bell': r = { obj: petBell(species), anchor: 'neck' }; break;
    case 'outfit_bowtie': r = { obj: petBowtie(species), anchor: 'neck' }; break;
    case 'outfit_raincoat': {
      const { cape, hood } = petRaincoat(species);
      r = { obj: cape, anchor: 'body', extra: [{ obj: hood, anchor: 'hat' }] };
      break;
    }
    default: r = { obj: new THREE.Group(), anchor: 'body' };
  }
  for (const p of [r, ...(r.extra ?? [])]) { p.obj.name = `outfit:${id}`; p.obj.userData.outfitId = id; }
  return r;
}

// 幼年頭比較大：頸部服裝往下、往前挪一點，免得被大頭吃掉（headScale＝目前頭部縮放）
export function fitPetNeck(obj: THREE.Object3D, species: PetSpecies, headScale: number): void {
  const n = NECK[species];
  const k = Math.max(0, headScale - 1);
  obj.position.set(n.c[0], n.c[1] - k * n.grow[0], n.c[2] + k * n.grow[1]);
  obj.scale.setScalar(1 + k * n.grow[2]);
}
