import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CropDef, CropShape } from '../data/crops';
import { GEO, mat, mesh, withWind } from './materials';

type Shape<K extends CropShape['kind']> = Extract<CropShape, { kind: K }>;

// 參數化作物生成器：同一套程式吃 CropDef.shape 參數，產生 4 個成長階段
// stage 0 種子、1 發芽、2 成長中、3 成熟

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const cm = (color: string, wind = 0, rough = 0.6) => {
  const key = color + wind + rough;
  let m = matCache.get(key);
  if (!m) {
    m = mat(color, { roughness: rough });
    if (wind) withWind(m, wind);
    matCache.set(key, m);
  }
  return m;
};

// 一片葉子：以根部為軸心，往外往上翹
function leaf(color: string, len: number, angle: number, tilt: number, width = 0.42): THREE.Object3D {
  const pivot = new THREE.Group();
  const l = mesh(GEO.sphereLo, cm(color, 0.5));
  l.scale.set(len * width, 0.04, len);
  l.position.set(0, len * 0.35, len * 0.42);
  l.rotation.x = -0.5;
  pivot.add(l);
  pivot.rotation.set(tilt, angle, 0);
  return pivot;
}

function rosette(g: THREE.Group, color: string, color2: string, n: number, len: number, tilt: number, width = 0.42) {
  for (let i = 0; i < n; i++) g.add(leaf(i % 2 ? color2 : color, len * (0.85 + (i % 3) * 0.1), (i / n) * Math.PI * 2 + i * 0.3, tilt - (i % 2) * 0.2, width));
}

function stick(color: string, h: number, r: number, wind = 0.35): THREE.Mesh {
  const s = mesh(GEO.cyl, cm(color, wind), false);
  s.scale.set(r, h, r);
  s.position.y = h / 2;
  return s;
}

// ── 新作物用的小工具 ──
// 固定亂數：同一作物每次長得一樣
const rnd = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

// 放一個零件：幾何、材質、縮放、位置
function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const p = mesh(geo, m, shadow);
  p.scale.set(sx, sy, sz);
  p.position.set(x, y, z);
  g.add(p);
  return p;
}

// 讓零件的 +y 軸指向某方向（斜枝、垂掛的果實）
function aim(o: THREE.Object3D, dx: number, dy: number, dz: number): void {
  o.quaternion.setFromUnitVectors(UP, tmpV.set(dx, dy, dz).normalize());
}

// 兩點之間的一根棍子（支架、藤蔓、斜莖）；d 為直徑
function rod(g: THREE.Object3D, m: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, d: number, shadow = false): THREE.Mesh {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const r = part(g, GEO.cyl, m, d, len, d, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, shadow);
  aim(r, bx - ax, by - ay, bz - az);
  return r;
}

// 放在某處、朝某方向伸出的一片葉子；先俯仰再轉向（YXZ），各方向的葉子翹起角度一致
// tilt：0 ≈ 往上 30°、0.5 ≈ 水平、-1 ≈ 直立
function leafAt(g: THREE.Object3D, color: string, len: number, x: number, y: number, z: number, angle: number, tilt: number, width = 0.42): THREE.Object3D {
  const l = leaf(color, len, angle, tilt, width);
  l.rotation.order = 'YXZ';
  l.position.set(x, y, z);
  g.add(l);
  return l;
}
// 水平方向 (cos a, sin a) 轉成 leaf() 的 angle
const outA = (a: number) => Math.PI / 2 - a;

// 西瓜條紋：沿經線的波浪深綠條紋（球體 UV 的 u 繞一圈）
function stripeMat(base: string, stripe: string): THREE.MeshStandardMaterial {
  const key = 'stripe' + base + stripe;
  let m = matCache.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = base;
    x.fillRect(0, 0, 256, 64);
    x.fillStyle = stripe;
    for (let i = 0; i < 9; i++) {
      const cx = ((i + 0.5) / 9) * 256;
      x.beginPath();
      for (let y = 0; y <= 64; y += 4) x.lineTo(cx - 7 + Math.sin(y * 0.45 + i) * 4, y);
      for (let y = 64; y >= 0; y -= 4) x.lineTo(cx + 7 + Math.sin(y * 0.45 + i + 1.4) * 4, y);
      x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = mat('#ffffff', { roughness: 0.38, map: t });
    matCache.set(key, m);
  }
  return m;
}

// 南瓜：壓扁的球體＋8 道瓣溝＋上下凹陷（只建一次）
let pumpkinGeo: THREE.BufferGeometry | null = null;
function getPumpkinGeo(): THREE.BufferGeometry {
  if (pumpkinGeo) return pumpkinGeo;
  let geo: THREE.BufferGeometry = new THREE.SphereGeometry(0.5, 32, 16);
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rib = 0.84 + 0.16 * Math.pow(Math.abs(Math.cos(Math.atan2(z, x) * 4)), 0.55);
    const rxz = Math.min(1, Math.hypot(x, z) / 0.5);
    p.setXYZ(i, x * rib, y * 0.78 - Math.sign(y) * (1 - rxz) * 0.1, z * rib);
  }
  geo.computeVertexNormals();
  return (pumpkinGeo = geo);
}

const SOIL = '#7a4a2c';

// 夜間花：花朵自己發光
const glowCache = new Map<string, THREE.MeshStandardMaterial>();
const glow = (color: string) => {
  let m = glowCache.get(color);
  if (!m) { m = withWind(mat(color, { roughness: 0.4, emissive: color, emissiveIntensity: 1.1 }), 0.4); glowCache.set(color, m); }
  return m;
};

// 巨型作物（3×3）：成熟時約 2.4 公尺寬
function buildGiant(variant: 'pumpkin' | 'daikon' | 'cabbage' | 'watermelon', stage: number): THREE.Group {
  const g = new THREE.Group();
  if (stage <= 1) {
    for (let i = 0; i < 5; i++) g.add(leaf('#4f9e3a', stage === 0 ? 0.3 : 0.6, (i / 5) * Math.PI * 2, -0.4));
    return g;
  }
  const k = stage === 2 ? 0.55 : 1;
  const leafC = '#4f8f3a';
  for (let i = 0; i < 7; i++) g.add(leaf(leafC, 1.0 * k, (i / 7) * Math.PI * 2 + 0.3, -0.25));
  if (variant === 'pumpkin') {
    const orange = cm('#f28a2a', 0, 0.55);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = mesh(GEO.sphere, orange);
      rib.scale.set(0.9 * k, 1.25 * k, 1.5 * k);
      rib.position.set(Math.cos(a) * 0.42 * k, 0.62 * k, Math.sin(a) * 0.42 * k);
      rib.rotation.y = -a;
      g.add(rib);
    }
    const stem = mesh(GEO.cyl, cm('#6a8a3a')); stem.scale.set(0.16 * k, 0.4 * k, 0.16 * k); stem.position.y = 1.35 * k; stem.rotation.z = 0.3;
    g.add(stem);
  } else if (variant === 'watermelon') {
    const body = mesh(GEO.sphere, cm('#3f9a3a', 0, 0.4)); body.scale.set(2.0 * k, 1.35 * k, 1.6 * k); body.position.y = 0.6 * k;
    g.add(body);
    for (let i = 0; i < 8; i++) {
      const st = mesh(GEO.sphere, cm('#2a6a2a', 0, 0.4), false);
      st.scale.set(0.16 * k, 1.37 * k, 1.62 * k); st.position.set((i - 3.5) * 0.24 * k, 0.6 * k, 0);
      g.add(st);
    }
  } else if (variant === 'daikon') {
    const root = mesh(GEO.cone, cm('#f7f4ec', 0, 0.5)); root.scale.set(0.9 * k, 1.6 * k, 0.9 * k); root.rotation.x = Math.PI; root.position.y = 0.3 * k;
    const top = mesh(GEO.sphere, cm('#e0f0c8', 0, 0.5)); top.scale.set(0.9 * k, 0.4 * k, 0.9 * k); top.position.y = 1.05 * k;
    g.add(root, top);
    for (let i = 0; i < 8; i++) { const l = leaf('#4fae3c', 1.1 * k, (i / 8) * Math.PI * 2, -1.0); l.position.y = 1.1 * k; g.add(l); }
  } else {
    const core = mesh(GEO.sphere, cm('#cde8a0', 0, 0.55)); core.scale.set(1.6 * k, 1.4 * k, 1.6 * k); core.position.y = 0.7 * k;
    g.add(core);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = mesh(GEO.sphere, cm('#8fcf5a', 0.1, 0.55)); l.scale.set(0.9 * k, 1.3 * k, 0.35 * k);
      l.position.set(Math.cos(a) * 0.62 * k, 0.65 * k, Math.sin(a) * 0.62 * k);
      l.lookAt(Math.cos(a) * 3, 0.65 * k, Math.sin(a) * 3);
      g.add(l);
    }
  }
  return g;
}

// ── 攀藤類：支架＋藤蔓＋垂掛果實 ──
function buildVine(g: THREE.Group, s: Shape<'vine'>, grown: boolean): void {
  const wood = cm('#b58a5a', 0, 0.85);
  const pole = cm('#dcc486', 0, 0.7);
  const fruitM = cm(s.fruit, 0, 0.35);
  if (s.style === 'pod') {
    // 豌豆：三根竹竿綁成小帳篷，藤蔓沿竿往上爬，豆莢垂掛、開小白花
    const H = 1.02;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      const bx = Math.cos(a) * 0.3, bz = Math.sin(a) * 0.3;
      const at = (t: number): [number, number, number] => [bx * (1 - t * 0.94), H * t, bz * (1 - t * 0.94)];
      rod(g, pole, bx, 0, bz, bx * 0.06, H, bz * 0.06, 0.035, true);
      const n = grown ? 4 : 2;
      for (let j = 0; j < n; j++) {
        const [x, y, z] = at(0.12 + j * 0.2);
        leafAt(g, s.leaf, 0.2, x, y, z, outA(a + (j % 2 ? 1.1 : -1.1)), 0.05, 0.85);
      }
      const [fx, fy, fz] = at(grown ? 0.86 : 0.5);
      part(g, GEO.sphereLo, cm('#fbe4f0', 0.2), 0.08, 0.06, 0.08, fx + Math.cos(a) * 0.04, fy, fz + Math.sin(a) * 0.04, false);
      if (!grown) continue;
      [0.3, 0.5, 0.7].forEach((t, j) => {
        const [x, y, z] = at(t);
        const pod = part(g, GEO.capsule, fruitM, 0.085, 0.1, 0.045, x + Math.cos(a) * 0.08, y - 0.1, z + Math.sin(a) * 0.08);
        pod.rotation.set(0, outA(a), (j % 2 ? 1 : -1) * 0.3);
      });
    }
    part(g, GEO.sphereLo, wood, 0.07, 0.07, 0.07, 0, H, 0, false);
  } else if (s.style === 'tomato') {
    // 番茄：一根木樁，枝葉一團團往上長，紅番茄一顆顆掛在外側
    rod(g, wood, 0, 0, 0, 0, 1.02, 0, 0.05, true);
    const n = grown ? 5 : 3;
    for (let j = 0; j < n; j++) {
      const a = j * 2.4 + 0.3, k = 1 - j * 0.08;
      part(g, GEO.ico, cm(j % 2 ? s.leaf : '#5aae44', 0.12), 0.32 * k, 0.24 * k, 0.32 * k, Math.cos(a) * 0.09, 0.2 + j * 0.17, Math.sin(a) * 0.09);
    }
    for (let i = 0; i < 3; i++) leafAt(g, s.leaf, 0.24, 0, 0.02, 0, i * 2.1, -0.2, 0.6);
    if (grown) {
      const calyx = cm('#3f7a2a');
      for (let j = 0; j < 6; j++) {
        const a = j * 2.1 + 1.0, sz = 0.18 - (j % 2) * 0.03;
        const x = Math.cos(a) * 0.24, y = 0.2 + (j % 3) * 0.2, z = Math.sin(a) * 0.24;
        part(g, GEO.sphere, j === 4 ? cm('#ff9a2a', 0, 0.35) : fruitM, sz, sz * 0.88, sz, x, y, z);
        part(g, GEO.sphereLo, calyx, sz * 0.6, sz * 0.2, sz * 0.6, x, y + sz * 0.42, z, false);
      }
    }
  } else if (s.style === 'cucumber') {
    // 小黃瓜：門型竹架＋網繩，大葉子攀在架上，細長的瓜垂掛
    rod(g, pole, -0.32, 0, 0, -0.32, 1.02, 0, 0.04, true);
    rod(g, pole, 0.32, 0, 0, 0.32, 1.02, 0, 0.04, true);
    rod(g, pole, -0.38, 0.98, 0, 0.38, 0.98, 0, 0.035, true);
    const twine = cm('#efe2c0', 0, 0.9);
    for (const y of [0.42, 0.72]) rod(g, twine, -0.32, y, 0, 0.32, y, 0, 0.012);
    rod(g, twine, 0, 0, 0, 0, 0.98, 0, 0.012);
    const vineM = cm('#5a9e3a', 0.2);
    rod(g, vineM, -0.26, 0, 0.02, -0.3, grown ? 0.92 : 0.5, 0.02, 0.022);
    rod(g, vineM, 0.26, 0, -0.02, 0.3, grown ? 0.9 : 0.5, -0.02, 0.022);
    const leaves: [number, number, number][] = [[-0.3, 0.22, 1], [0.3, 0.3, -1], [-0.12, 0.4, -1], [0.12, 0.48, 1], [-0.28, 0.62, 1], [0.28, 0.72, -1], [-0.08, 0.84, -1], [0.14, 0.9, 1]];
    for (const [x, y, sd] of leaves) if (grown || y < 0.55) leafAt(g, s.leaf, 0.22, x, y - 0.08, sd * 0.03, sd > 0 ? 0 : Math.PI, -0.75, 0.95);
    const yellow = cm('#ffd23a', 0.2, 0.5);
    part(g, GEO.sphereLo, yellow, 0.08, 0.05, 0.08, 0.2, grown ? 0.8 : 0.45, 0.07, false);
    part(g, GEO.sphereLo, yellow, 0.08, 0.05, 0.08, -0.2, grown ? 0.55 : 0.3, -0.07, false);
    if (grown) {
      const cukes: [number, number, number][] = [[-0.18, 0.5, 1], [0.06, 0.62, -1], [0.2, 0.42, 1], [-0.04, 0.34, -1]];
      cukes.forEach(([x, y, sd], i) => {
        const c = part(g, GEO.capsule, fruitM, 0.08, 0.13, 0.08, x, y, sd * 0.08);
        c.rotation.z = (i % 2 ? 1 : -1) * 0.12;
        part(g, GEO.sphereLo, yellow, 0.05, 0.04, 0.05, x + c.rotation.z * 0.13, y - 0.13, sd * 0.08, false);
      });
    }
  } else {
    // 葡萄：小棚架，葉子鋪在棚頂，紫葡萄一串串垂在棚下兩側
    const H = 1.0;
    rod(g, wood, -0.34, 0, 0, -0.34, H, 0, 0.05, true);
    rod(g, wood, 0.34, 0, 0, 0.34, H, 0, 0.05, true);
    rod(g, wood, -0.42, H, 0, 0.42, H, 0, 0.045, true);
    for (const x of [-0.2, 0.2]) rod(g, wood, x, H + 0.03, -0.2, x, H + 0.03, 0.2, 0.035);
    const trunk = cm('#6a4a2e', 0, 0.9);
    rod(g, trunk, 0.3, 0, 0.06, 0.25, 0.5, 0.03, 0.055, true);
    rod(g, trunk, 0.25, 0.5, 0.03, 0.32, H, 0, 0.05, true);
    const xs = grown ? [-0.27, -0.09, 0.09, 0.27] : [0.12, 0.28];
    xs.forEach((x, i) => part(g, GEO.ico, cm(i % 2 ? s.leaf : '#4a8f34', 0.1), 0.3, 0.15, 0.28, x, H + 0.06, 0));
    if (!grown) return;
    for (let i = 0; i < 4; i++) leafAt(g, s.leaf, 0.17, -0.3 + i * 0.2, H + 0.02, i % 2 ? -0.12 : 0.12, i % 2 ? Math.PI : 0, 0.9, 0.9);
    const bunches: [number, number][] = [[-0.2, 0.2], [0.18, 0.2], [-0.12, -0.2], [0.24, -0.2]];
    const dark = cm('#5a2a88', 0, 0.35);
    for (const [bx, bz] of bunches) {
      const top = 0.84;
      const layers: [number, number, number][] = [[3, 0.045, 0], [2, 0.03, 0.075], [1, 0, 0.145]];
      let n = 0;
      for (const [cnt, r, dy] of layers) for (let j = 0; j < cnt; j++) {
        const a = (j / cnt) * Math.PI * 2 + dy * 20;
        part(g, GEO.sphereLo, n++ % 2 ? fruitM : dark, 0.095, 0.095, 0.095, bx + Math.cos(a) * r, top - dy, bz + Math.sin(a) * r, false);
      }
    }
  }
}

// 向日葵花盤：一圈黃花瓣＋咖啡色花心＋綠色背面；朝 yaw 方向並往上仰（鏡頭在上方）
function sunHead(g: THREE.Group, petal: string, x: number, y: number, z: number, yaw: number, k: number): void {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.set(-0.85, yaw, 0, 'YXZ');
  const pm = cm(petal, 0, 0.5);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = part(h, GEO.sphereLo, pm, 0.1 * k, 0.17 * k, 0.03 * k, Math.cos(a) * 0.16 * k, Math.sin(a) * 0.16 * k, (i % 2) * 0.01 * k, false);
    p.rotation.z = a - Math.PI / 2;
  }
  part(h, GEO.sphere, cm('#6a3a1a', 0, 0.9), 0.25 * k, 0.25 * k, 0.09 * k, 0, 0, 0.025 * k, false);
  part(h, GEO.sphere, cm('#4f8f3a'), 0.27 * k, 0.27 * k, 0.07 * k, 0, 0, -0.02 * k);
  g.add(h);
}

// ── 高稈類 ──
function buildTall(g: THREE.Group, s: Shape<'tall'>, grown: boolean): void {
  if (s.style === 'corn') {
    // 玉米：三株高稈、長帶狀葉、頂上雄穗，側邊斜掛著半剝開的玉米
    const stalkM = cm(s.stalk, 0.25);
    const tassel = cm('#e6c878', 0.4);
    const huskM = cm('#a8cf62', 0, 0.6);
    const cobM = cm(s.fruit, 0, 0.45);
    const silk = cm('#9a5a2a', 0, 0.8);
    const pos: [number, number][] = [[-0.13, 0.08], [0.14, 0.06], [0.0, -0.14]];
    pos.forEach(([x, z], i) => {
      const H = (grown ? 1.62 : 0.8) * (1 - i * 0.06);
      rod(g, stalkM, x, 0, z, x, H, z, 0.07, true);
      for (let j = 0; j < (grown ? 4 : 3); j++) leafAt(g, s.leaf, grown ? 0.52 : 0.38, x, H * (0.16 + j * 0.2), z, i * 1.3 + j * 2.6, 0.25, 0.2);
      if (!grown) return;
      for (let j = 0; j < 3; j++) {
        const a = j * 2.1 + i;
        rod(g, tassel, x, H - 0.02, z, x + Math.cos(a) * 0.1, H + 0.16, z + Math.sin(a) * 0.1, 0.018);
      }
      if (i === 2) return;
      // 玉米：往外斜伸，外皮剝開露出黃色玉米粒
      const a = i === 0 ? 2.5 : 0.5;
      const dx = Math.cos(a) * 0.9, dz = Math.sin(a) * 0.9;
      const len = Math.hypot(dx, 1, dz);
      const ux = dx / len, uy = 1 / len, uz = dz / len;
      const cx = x + Math.cos(a) * 0.13, cy = H * 0.52 + 0.08, cz = z + Math.sin(a) * 0.13;
      aim(part(g, GEO.capsule, cobM, 0.11, 0.14, 0.11, cx, cy, cz), dx, 1, dz);
      for (const sd of [-1, 1]) {
        const px = -Math.sin(a) * sd * 0.035, pz = Math.cos(a) * sd * 0.035;
        aim(part(g, GEO.sphere, huskM, 0.075, 0.3, 0.055, cx - ux * 0.07 + px * 1.2, cy - uy * 0.07, cz - uz * 0.07 + pz * 1.2), dx + px * 5, 1, dz + pz * 5);
      }
      part(g, GEO.sphereLo, silk, 0.06, 0.06, 0.06, cx + ux * 0.15, cy + uy * 0.15, cz + uz * 0.15, false);
    });
  } else if (s.style === 'sunflower') {
    // 向日葵：粗莖、心形大葉、大花盤朝前上方；旁邊一株小的朝另一邊
    const stalkM = cm(s.stalk, 0.2);
    const H = grown ? 1.45 : 0.72;
    rod(g, stalkM, 0, 0, 0, 0.02, H, 0.03, 0.08, true);
    for (let j = 0; j < (grown ? 4 : 3); j++) leafAt(g, s.leaf, grown ? 0.3 : 0.24, 0.01, H * (0.18 + j * 0.19), 0.01, j * 2.5 + 0.4, 0.15, 0.85);
    if (!grown) {
      // 還沒開的綠色花苞
      part(g, GEO.sphere, cm('#5a9e3a'), 0.16, 0.13, 0.16, 0.02, H + 0.04, 0.03);
      for (let j = 0; j < 5; j++) leafAt(g, '#6aae44', 0.08, 0.02, H + 0.02, 0.03, (j / 5) * Math.PI * 2, -0.4, 0.5);
      return;
    }
    sunHead(g, s.fruit, 0.02, H + 0.02, 0.07, 0, 1);
    rod(g, stalkM, 0.16, 0, -0.12, 0.22, 1.02, -0.16, 0.06, true);
    leafAt(g, s.leaf, 0.24, 0.18, 0.45, -0.13, 1.4, 0.15, 0.85);
    leafAt(g, s.leaf, 0.22, 0.2, 0.72, -0.15, -1.9, 0.15, 0.85);
    sunHead(g, s.fruit, 0.22, 1.04, -0.18, 2.6, 0.72);
  } else if (s.style === 'asparagus') {
    // 蘆筍：土堆冒出一根根粗嫩莖，尖端是帶紫的鱗芽
    part(g, GEO.sphere, cm(SOIL, 0, 0.95), 0.62, 0.12, 0.62, 0, 0, 0, false);
    const spear = cm(s.stalk, 0.15, 0.5), tip = cm(s.fruit, 0.15, 0.5);
    const n = grown ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + 0.5, r = i === 0 ? 0 : 0.08 + (i % 3) * 0.045;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = (grown ? 0.42 : 0.2) + rnd(i) * (grown ? 0.22 : 0.08);
      const tx = x * 1.35, tz = z * 1.35;
      rod(g, spear, x, 0, z, tx, h, tz, 0.08, true);
      aim(part(g, GEO.sphereLo, tip, 0.088, 0.15, 0.088, tx, h, tz, false), tx - x, h, tz - z);
      // 莖上的小三角鱗片
      const m = part(g, GEO.cone, tip, 0.05, 0.07, 0.05, x + (tx - x) * 0.5 + Math.cos(a + 1) * 0.035, h * 0.5, z + (tz - z) * 0.5 + Math.sin(a + 1) * 0.035, false);
      m.rotation.set(Math.sin(a + 1) * 0.5, 0, -Math.cos(a + 1) * 0.5);
    }
  } else {
    // 竹筍：土堆冒出一層層褐色筍殼的尖筍；成熟時後面一根小竹子點出「竹」
    part(g, GEO.sphere, cm(SOIL, 0, 0.95), 0.66, 0.14, 0.66, 0, 0, 0, false);
    const shoots: [number, number, number, number][] = grown ? [[0.02, 0.08, 0.58, 0.3], [0.21, -0.08, 0.4, 0.23], [-0.2, -0.02, 0.34, 0.21]] : [[0.02, 0.04, 0.3, 0.18]];
    const c1 = cm(s.fruit, 0, 0.8), c2 = cm('#b0804a', 0, 0.8), c3 = cm('#cdc46a', 0, 0.7);
    shoots.forEach(([x, z, h, d], i) => {
      const sh = new THREE.Group();
      sh.position.set(x, 0, z);
      sh.rotation.set(rnd(i) * 0.24 - 0.12, 0, rnd(i + 5) * 0.3 - 0.15);
      g.add(sh);
      part(sh, GEO.cone, c1, d, h * 0.7, d, 0, h * 0.35, 0);
      part(sh, GEO.cone, c2, d * 0.72, h * 0.6, d * 0.72, 0, h * 0.55, 0);
      part(sh, GEO.cone, c3, d * 0.38, h * 0.34, d * 0.38, 0, h * 0.86, 0, false);
    });
    if (!grown) return;
    const cane = cm(s.stalk, 0.15, 0.45), node = cm('#4f8a3a', 0.15, 0.5);
    rod(g, cane, -0.08, 0, -0.26, -0.1, 1.15, -0.28, 0.07, true);
    for (const y of [0.38, 0.76]) part(g, GEO.cyl, node, 0.085, 0.03, 0.085, -0.08 - y * 0.017, y, -0.26 - y * 0.017, false);
    for (let j = 0; j < 4; j++) leafAt(g, s.leaf, 0.3, -0.1, 1.08 - j * 0.14, -0.28, j * 1.9 + 0.5, 0.35, 0.24);
  }
}

// ── 灌木類 ──
type Blob = [number, number, number, number, number, number]; // 中心 xyz、尺寸 xyz
function blobs(g: THREE.Group, list: Blob[], c1: string, c2: string, k: number, wind = 0.1, rough = 0.6): Blob[] {
  const out = list.map(([x, y, z, sx, sy, sz]): Blob => [x * k, y * k, z * k, sx * k, sy * k, sz * k]);
  out.forEach(([x, y, z, sx, sy, sz], i) => part(g, GEO.ico, cm(i % 2 ? c2 : c1, wind, rough), sx, sy, sz, x, y, z));
  return out;
}
// 在灌木表面取一點（e：仰角）
function onBlob(b: Blob, a: number, e: number): [number, number, number] {
  return [b[0] + Math.cos(a) * Math.cos(e) * b[3] * 0.5, b[1] + Math.sin(e) * b[4] * 0.5, b[2] + Math.sin(a) * Math.cos(e) * b[5] * 0.5];
}

function buildBush(g: THREE.Group, s: Shape<'bush'>, grown: boolean): void {
  const k = grown ? 1 : 0.62;
  const berryM = cm(s.berry, 0, 0.4);
  const twig = cm('#7a5a3e', 0, 0.9);
  if (s.style === 'berry') {
    // 藍莓：圓滾滾的灌木，表面掛著一串串藍紫色小莓果
    rod(g, twig, 0, 0, 0, 0.05, 0.25 * k, 0, 0.05);
    const bs = blobs(g, [[0, 0.42, 0, 0.58, 0.46, 0.58], [0.2, 0.3, 0.07, 0.4, 0.34, 0.4], [-0.19, 0.3, 0.1, 0.4, 0.34, 0.4], [0.02, 0.3, -0.21, 0.42, 0.34, 0.42], [-0.04, 0.6, 0.02, 0.36, 0.28, 0.36]], s.leaf, s.leaf2, k);
    if (!grown) return;
    const pale = cm('#8a94e0', 0, 0.4);
    for (let c = 0; c < 10; c++) {
      const [x, y, z] = onBlob(bs[c % bs.length], c * 2.4 + 0.4, 0.35 + (c % 3) * 0.3);
      for (let j = 0; j < 3; j++) part(g, GEO.sphereLo, c === 3 && j === 0 ? pale : berryM, 0.1, 0.1, 0.1, x + Math.cos(j * 2.1 + c) * 0.05, y + 0.02 - j * 0.03, z + Math.sin(j * 2.1 + c) * 0.05, false);
    }
  } else if (s.style === 'mat') {
    // 蔓越莓：貼地蔓生的矮叢（深綠帶紅褐），上面灑滿亮紅色小果
    const bs = blobs(g, [[0, 0.1, 0, 0.52, 0.22, 0.52], [0.25, 0.07, 0.1, 0.36, 0.17, 0.36], [-0.23, 0.07, 0.12, 0.36, 0.17, 0.36], [0.06, 0.07, -0.25, 0.38, 0.17, 0.38], [-0.16, 0.06, -0.2, 0.3, 0.15, 0.3], [0.2, 0.06, -0.17, 0.3, 0.15, 0.3]], s.leaf, s.leaf2, k, 0.05, 0.7);
    const n = grown ? 18 : 5;
    const pink = cm('#f6b8c8', 0, 0.5);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = onBlob(bs[i % bs.length], rnd(i) * Math.PI * 2, 0.35 + rnd(i + 9) * 0.8);
      part(g, GEO.sphereLo, grown ? berryM : pink, grown ? 0.085 : 0.05, grown ? 0.085 : 0.05, grown ? 0.085 : 0.05, x, y, z, false);
    }
  } else if (s.style === 'tea') {
    // 茶樹：修剪成圓頂的茶叢（油亮深綠），頂上冒出嫩綠的「一心二葉」
    rod(g, twig, -0.08, 0, 0, -0.1, 0.2 * k, 0, 0.05);
    rod(g, twig, 0.08, 0, 0, 0.1, 0.2 * k, 0, 0.05);
    const bs = blobs(g, [[-0.19, 0.24, 0.05, 0.4, 0.36, 0.42], [0.18, 0.25, -0.06, 0.44, 0.4, 0.44], [0.03, 0.27, 0.19, 0.42, 0.34, 0.32], [-0.04, 0.27, -0.19, 0.4, 0.34, 0.32], [0.02, 0.36, 0, 0.42, 0.3, 0.42]], s.leaf, '#3a8a44', k, 0.08, 0.35);
    const n = grown ? 12 : 4;
    const tipM = cm(s.leaf2, 0.3, 0.45);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = onBlob(bs[i % bs.length], i * 2.4, 0.75 + rnd(i) * 0.6);
      leafAt(g, s.leaf2, 0.15, x, y - 0.02, z, i * 1.7, -0.5, 0.6);
      part(g, GEO.sphereLo, tipM, 0.05, 0.12, 0.05, x, y + 0.05, z, false);
    }
  } else if (s.style === 'lavender') {
    // 薰衣草：灰綠色細葉叢，往外放射一根根紫色花穗
    const bladeM = cm(s.leaf, 0.5);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      aim(part(g, GEO.blade, bladeM, 1.5 * k, 1.1 * k, 1.5 * k, Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03, false), Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6);
    }
    const stemM = cm(s.leaf2, 0.4);
    const spikes = [berryM, cm('#a57ae6', 0, 0.45)];
    const bud = cm('#9fb89a', 0.3);
    const n = grown ? 13 : 7;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, sp = 0.12 + (i % 4) * 0.12;
      const L = (grown ? 0.6 : 0.34) + rnd(i) * 0.12;
      const dx = Math.sin(sp) * Math.cos(a), dy = Math.cos(sp), dz = Math.sin(sp) * Math.sin(a);
      const bx = Math.cos(a) * 0.03, bz = Math.sin(a) * 0.03;
      rod(g, stemM, bx, 0.04, bz, bx + dx * L, 0.04 + dy * L, bz + dz * L, 0.02);
      const c = grown ? 0.08 : 0.03;
      aim(part(g, GEO.capsule, grown ? spikes[i % 2] : bud, grown ? 0.055 : 0.035, c, grown ? 0.055 : 0.035, bx + dx * (L - c * 0.6), 0.04 + dy * (L - c * 0.6), bz + dz * (L - c * 0.6), false), dx, dy, dz);
    }
  } else {
    // 辣椒（朝天椒）：小樹狀的矮叢，一根根紅辣椒從葉叢往上翹
    rod(g, cm('#5f8a36', 0.1), 0, 0, 0, 0, 0.3 * k, 0, 0.05);
    blobs(g, [[0, 0.46, 0, 0.46, 0.32, 0.46], [0.18, 0.36, 0.08, 0.34, 0.28, 0.34], [-0.17, 0.36, 0.1, 0.34, 0.28, 0.34], [0.02, 0.36, -0.19, 0.36, 0.28, 0.36]], s.leaf, s.leaf2, k);
    const calyx = cm('#3f7a2a');
    if (!grown) {
      for (let i = 0; i < 3; i++) part(g, GEO.sphereLo, cm('#ffffff', 0.2), 0.05, 0.04, 0.05, Math.cos(i * 2.1) * 0.17, 0.34, Math.sin(i * 2.1) * 0.17, false);
      return;
    }
    const other = [cm('#4f9e2a', 0, 0.4), cm('#ff8a1a', 0, 0.4)];
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4 + 0.3, r = i === 0 ? 0 : 0.12 + (i % 3) * 0.05;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, base = 0.52 + (i === 0 ? 0.08 : 0) - (i % 3) * 0.05;
      // 往外上方伸、尖端再彎一點：圓胖的椒身＋尖尖的椒尾
      const l = Math.hypot(0.45, 1), dx = (Math.cos(a) * 0.45) / l, dy = 1 / l, dz = (Math.sin(a) * 0.45) / l;
      const pm = i === 3 ? other[0] : i === 6 ? other[1] : berryM;
      aim(part(g, GEO.capsule, pm, 0.09, 0.11, 0.09, x + dx * 0.11, base + dy * 0.11, z + dz * 0.11), dx, dy, dz);
      aim(part(g, GEO.cone, pm, 0.072, 0.07, 0.072, x + dx * 0.25 + Math.cos(a) * 0.02, base + dy * 0.24, z + dz * 0.25 + Math.sin(a) * 0.02, false), dx * 2.2, dy, dz * 2.2);
      part(g, GEO.sphereLo, calyx, 0.075, 0.045, 0.075, x, base + 0.01, z, false);
    }
  }
}

// ── 瓜類：貼地大葉＋躺在土上的大果實 ──
function buildMelon(g: THREE.Group, s: Shape<'melon'>, grown: boolean): void {
  const k = grown ? 1 : 0.62;
  const vineM = cm('#5a8f3a', 0.2);
  rod(g, vineM, -0.38 * k, 0.03, 0.2 * k, 0.34 * k, 0.03, -0.22 * k, 0.03);
  rod(g, vineM, -0.3 * k, 0.03, -0.3 * k, 0.12 * k, 0.03, 0.34 * k, 0.03);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.4;
    leafAt(g, i % 2 ? s.leaf : '#5aa845', 0.32 * k, Math.cos(a) * 0.12 * k, 0.02, Math.sin(a) * 0.12 * k, outA(a), 0.35, 0.95);
  }
  if (!grown) {
    const yellow = cm('#ffd23a', 0.2, 0.5);
    part(g, GEO.sphereLo, yellow, 0.09, 0.05, 0.09, 0.14, 0.12, 0.1, false);
    part(g, GEO.sphereLo, yellow, 0.08, 0.05, 0.08, -0.12, 0.1, -0.1, false);
    return;
  }
  if (s.style === 'watermelon') {
    // 西瓜：一顆大的、一顆小的，深綠波浪條紋
    const m = stripeMat(s.fruit, s.stripe);
    const big = new THREE.Group();
    big.position.set(0.05, 0, 0.07);
    big.rotation.y = 0.35;
    g.add(big);
    part(big, GEO.sphere, m, 0.46, 0.64, 0.46, 0, 0.22, 0).rotation.z = Math.PI / 2;
    part(big, GEO.cyl, vineM, 0.03, 0.08, 0.03, 0.33, 0.24, 0, false).rotation.z = Math.PI / 2;
    const sm = new THREE.Group();
    sm.position.set(-0.26, 0, -0.24);
    sm.rotation.y = -0.9;
    g.add(sm);
    part(sm, GEO.sphere, m, 0.26, 0.33, 0.26, 0, 0.12, 0).rotation.z = Math.PI / 2;
  } else {
    // 南瓜：有瓣溝的扁圓南瓜＋粗短的瓜蒂
    const pm = cm(s.fruit, 0, 0.5), stemM = cm('#6a7a2a', 0, 0.8);
    part(g, getPumpkinGeo(), pm, 0.58, 0.58, 0.58, 0.04, 0.17, 0.06);
    rod(g, stemM, 0.04, 0.3, 0.06, 0.09, 0.42, 0.09, 0.07, true);
    part(g, getPumpkinGeo(), pm, 0.3, 0.3, 0.3, -0.27, 0.09, -0.25);
    rod(g, stemM, -0.27, 0.15, -0.25, -0.24, 0.22, -0.27, 0.045);
  }
}

// ── 花卉新款式：鬱金香（杯形）、油菜花（花簇）、聖誕紅（星形苞片）──
function buildFlower(g: THREE.Group, s: Shape<'flower'>, grown: boolean): void {
  const stemM = cm(s.stem, 0.4);
  if (s.style === 'cup') {
    // 鬱金香：基部直立寬葉，長莖頂著杯狀花（三片花瓣合成），紅粉交錯
    for (let i = 0; i < 5; i++) leafAt(g, s.leaf, 0.3, 0, 0, 0, (i / 5) * Math.PI * 2 + 0.3, -0.85, 0.36);
    const n = grown ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + 0.3, r = i === 0 ? 0 : 0.15;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, tx = x * 1.15, tz = z * 1.15;
      const h = (grown ? 0.5 : 0.32) + (i % 2) * 0.08;
      rod(g, stemM, x, 0, z, tx, h, tz, 0.03);
      if (!grown) {
        part(g, GEO.sphereLo, cm('#8fcf5a', 0.3), 0.06, 0.1, 0.06, tx, h + 0.03, tz, false);
        continue;
      }
      const col = cm(i % 2 && s.flower2 ? s.flower2 : s.flower, 0, 0.45);
      for (let j = 0; j < 3; j++) {
        const b = (j / 3) * Math.PI * 2 + i;
        aim(part(g, GEO.sphere, col, 0.085, 0.16, 0.085, tx + Math.cos(b) * 0.03, h + 0.07, tz + Math.sin(b) * 0.03, false), Math.cos(b) * 0.28, 1, Math.sin(b) * 0.28);
      }
    }
  } else if (s.style === 'cluster') {
    // 油菜花：基部寬葉，多根花莖往外散開，頂端開滿一簇簇黃色小花
    for (let i = 0; i < 5; i++) leafAt(g, s.leaf, 0.28, 0, 0, 0, (i / 5) * Math.PI * 2, -0.45, 0.55);
    const fm = cm(s.flower, 0, 0.5);
    const n = grown ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : 0.06 + (i % 3) * 0.05;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, tx = x * 2.2, tz = z * 2.2;
      const h = (grown ? 0.62 : 0.36) + rnd(i) * 0.14;
      rod(g, stemM, x, 0, z, tx, h, tz, 0.025);
      if (!grown) {
        part(g, GEO.sphereLo, cm('#b8d860', 0.3), 0.06, 0.07, 0.06, tx, h + 0.02, tz, false);
        continue;
      }
      for (let j = 0; j < 3; j++) {
        const b = (j / 3) * Math.PI * 2 + i;
        part(g, GEO.sphereLo, fm, 0.11, 0.09, 0.11, tx + Math.cos(b) * 0.045, h + (j === 0 ? 0.06 : 0), tz + Math.sin(b) * 0.045, false);
      }
    }
  } else {
    // 聖誕紅：深綠葉叢，頂端一朵朵紅色星形苞片，中心一撮黃色小花
    for (let i = 0; i < 6; i++) leafAt(g, s.leaf, 0.3, 0, 0.02, 0, (i / 6) * Math.PI * 2 + 0.2, -0.3, 0.5);
    const tops: [number, number, number][] = grown ? [[0, 0.46, 0.02], [0.18, 0.36, -0.1], [-0.16, 0.34, -0.12]] : [[0, 0.3, 0.02], [0.14, 0.24, -0.08]];
    const center = cm(s.flower2 ?? '#ffd84a', 0, 0.5);
    tops.forEach(([x, y, z], i) => {
      rod(g, stemM, x * 0.3, 0, z * 0.3, x, y, z, 0.04);
      for (let j = 0; j < 6; j++) leafAt(g, grown ? s.flower : '#6aa84a', grown ? 0.2 : 0.12, x, y, z, (j / 6) * Math.PI * 2 + i, 0.3, 0.45);
      if (grown) part(g, GEO.sphereLo, center, 0.08, 0.05, 0.08, x, y + 0.04, z, false);
    });
  }
}

// ── 稻米：一叢細稈，成熟時金黃色稻穗往外彎垂 ──
function buildRice(g: THREE.Group, s: Shape<'grain'>, grown: boolean): void {
  const H = grown ? 0.72 : 0.42;
  const stalkM = cm(grown ? s.stalk : '#7fbf4a', 0.3);
  const bladeM = cm(grown ? '#a9b84a' : '#72b845', 0.5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    aim(part(g, GEO.blade, bladeM, 1.3, grown ? 1.7 : 1.2, 1.3, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, false), Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45);
  }
  const headM = cm(s.head, 0.2, 0.55);
  const n = grown ? 9 : 7;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + 0.2, r = i === 0 ? 0 : 0.035 + (i % 3) * 0.03;
    const ox = Math.cos(a), oz = Math.sin(a);
    const x = ox * r, z = oz * r, h = H - rnd(i) * 0.1;
    const tx = x + ox * 0.1, tz = z + oz * 0.1;
    rod(g, stalkM, x, 0, z, tx, h, tz, 0.022);
    if (!grown) continue;
    // 稻穗：先往外上方一小段，再往下垂
    const mx = tx + ox * 0.07, my = h + 0.05, mz = tz + oz * 0.07;
    rod(g, headM, tx, h, tz, mx, my, mz, 0.03);
    const L = 0.22, ex = mx + ox * L * 0.55, ey = my - L * 0.8, ez = mz + oz * L * 0.55;
    aim(part(g, GEO.capsule, headM, 0.055, L / 2, 0.055, (mx + ex) / 2, (my + ey) / 2, (mz + ez) / 2, false), ex - mx, ey - my, ez - mz);
  }
}

// ── 根莖新款式：白蘿蔔（長根）、老薑（根莖）──
function buildRoot2(g: THREE.Group, s: Shape<'root'>, grown: boolean): void {
  const k = grown ? 1 : 0.5;
  if (s.rootShape === 'long') {
    // 白蘿蔔：粗長的白根露出土面一大截，頂端一圈淡綠，上面一大叢直立葉
    const body = new THREE.Group();
    body.rotation.z = 0.1;
    g.add(body);
    part(body, GEO.capsule, cm(s.root, 0, 0.45), 0.23 * k, 0.26 * k, 0.23 * k, 0, 0.13 * k, 0);
    part(body, GEO.sphere, cm(s.top ?? '#cfe8a0', 0, 0.5), 0.235 * k, 0.16 * k, 0.235 * k, 0, 0.34 * k, 0);
    const n = grown ? s.leafCount + 1 : s.leafCount - 2;
    for (let i = 0; i < n; i++) leafAt(body, s.leaf, grown ? 0.44 : 0.3, 0, 0.38 * k, 0, (i / n) * Math.PI * 2, -0.55 - (i % 2) * 0.3, 0.38);
    return;
  }
  // 老薑：土面上一坨疙瘩狀的淡褐色根莖，芽點帶粉紅，長出幾根像蘆葦的葉莖
  const rm = cm(s.root, 0, 0.75), pink = cm(s.top ?? '#f28aa0', 0, 0.5), stemM = cm(s.leaf, 0.3);
  const knobs: Blob[] = [[0, 0, 0, 0.22, 0.14, 0.17], [0.15, 0, 0.03, 0.15, 0.12, 0.13], [-0.14, 0, 0.06, 0.15, 0.12, 0.12], [0.04, 0, 0.16, 0.14, 0.11, 0.12], [-0.07, 0, -0.14, 0.14, 0.12, 0.12], [0.2, 0, -0.1, 0.1, 0.08, 0.09]];
  knobs.forEach(([x, , z, sx, sy, sz], i) => { part(g, GEO.sphere, rm, sx * k, sy * k, sz * k, x * k, sy * k * 0.3, z * k).rotation.y = i * 1.3; });
  const stems: [number, number, number][] = [[0.15, 0.03, 0.62], [-0.14, 0.06, 0.55], [-0.07, -0.14, 0.68]];
  for (const [x, z, h0] of stems) {
    const bx = x * k, bz = z * k, h = h0 * (grown ? 1 : 0.55);
    part(g, GEO.sphereLo, pink, 0.06 * k + 0.02, 0.08 * k + 0.02, 0.06 * k + 0.02, bx, 0.07 * k, bz, false);
    const tx = bx * 1.6, tz = bz * 1.6;
    rod(g, stemM, bx, 0.05 * k, bz, tx, h, tz, 0.03);
    const side = Math.atan2(bz, bx) + Math.PI / 2;
    for (let j = 0; j < (grown ? 4 : 2); j++) {
      const t = 0.4 + j * 0.17;
      leafAt(g, s.leaf, grown ? 0.26 : 0.2, bx + (tx - bx) * t, h * t, bz + (tz - bz) * t, outA(side + (j % 2) * Math.PI), -0.15, 0.26);
    }
  }
}

// ── 水生作物：原點＝水面，全部浮在水上（最低不低於 -0.05）──

// 睡蓮葉：單位半徑的圓葉＋一道缺口，中心淺、邊緣深，隔一條輻射線亮一點（葉脈）；邊緣微微上翹
let padGeoCache: THREE.BufferGeometry | null = null;
export function lilyPadGeo(): THREE.BufferGeometry {
  if (padGeoCache) return padGeoCache;
  const N = 28, notch = 0.46;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const cC = new THREE.Color('#9be07a'), cM = new THREE.Color('#5cb84a'), cV = new THREE.Color('#86d464'), cR = new THREE.Color('#3f9a3a'), cS = new THREE.Color('#2f7a2e');
  const push = (x: number, y: number, z: number, c: THREE.Color, nx = 0, ny = 1, nz = 0) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  push(0, 0.012, 0, cC);
  for (let i = 0; i <= N; i++) {
    const a = notch / 2 + (i / N) * (Math.PI * 2 - notch);
    push(Math.cos(a) * 0.55, 0.012, Math.sin(a) * 0.55, i % 2 ? cM : cV);
    push(Math.cos(a), 0.024, Math.sin(a), cR);
  }
  for (let i = 0; i < N; i++) {
    const m0 = 1 + i * 2, r0 = m0 + 1, m1 = m0 + 2, r1 = m0 + 3;
    idx.push(0, m1, m0, m0, m1, r1, m0, r1, r0);
  }
  // 葉緣側邊：深綠色的一圈薄邊
  const base = pos.length / 3;
  for (let i = 0; i <= N; i++) {
    const a = notch / 2 + (i / N) * (Math.PI * 2 - notch);
    const c = Math.cos(a), s = Math.sin(a);
    push(c, 0.024, s, cS, c, 0, s);
    push(c, 0, s, cS, c, 0, s);
  }
  for (let i = 0; i < N; i++) {
    const t0 = base + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.push(t0, t1, b1, t0, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return (padGeoCache = g);
}

let padMatCache: THREE.MeshStandardMaterial | null = null;
export function lilyPadMat(): THREE.MeshStandardMaterial {
  return padMatCache ??= withWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide }), 0.05);
}

// 一片浮葉：半徑 r，y 為離水面的高度（疊在一起時錯開一點避免閃爍）
function pad(g: THREE.Object3D, r: number, x: number, y: number, z: number, rotY: number): THREE.Mesh {
  const p = mesh(lilyPadGeo(), lilyPadMat());
  p.scale.set(r, Math.min(1, r * 3.5), r);
  p.position.set(x, y, z);
  p.rotation.y = rotY;
  return (g.add(p), p);
}

// 蓮花花瓣：尖頭、微微內凹的長橢圓，根部白、瓣尖粉紅（頂點色）；原點在花瓣根部，往 +y 長
const petalCache = new Map<string, THREE.BufferGeometry>();
function lotusPetalGeo(tip: string): THREE.BufferGeometry {
  let g = petalCache.get(tip);
  if (g) return g;
  g = new THREE.SphereGeometry(0.5, 12, 10);
  const p = g.attributes.position as THREE.BufferAttribute;
  const cb = new THREE.Color('#fff4f8'), ct = new THREE.Color(tip), c = new THREE.Color();
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y + 0.5; // 0 根部 → 1 瓣尖
    const taper = 1 - Math.pow(Math.max(0, y / 0.5), 1.6) * 0.92;
    p.setXYZ(i, x * taper, y + 0.5, z * taper * 0.38 - t * t * 0.16);
    c.copy(cb).lerp(ct, Math.min(1, Math.pow(t, 1.4) * 1.15));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  petalCache.set(tip, g);
  return g;
}
const petalMatCache = new Map<string, THREE.MeshStandardMaterial>();
const petalMat = (key: string) => {
  let m = petalMatCache.get(key);
  if (!m) petalMatCache.set(key, (m = withWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, emissive: '#ff8fb8', emissiveIntensity: 0.06 }), 0.08)));
  return m;
};

// 一圈花瓣：中心在 (x,y,z)，n 片，往外傾 tilt（0 = 直立），尺寸 w×h
function petalRing(g: THREE.Object3D, tip: string, x: number, y: number, z: number, n: number, tilt: number, w: number, h: number, off = 0): void {
  const geo = lotusPetalGeo(tip), m = petalMat(tip);
  for (let i = 0; i < n; i++) {
    const p = mesh(geo, m, false);
    p.scale.set(w, h, w);
    p.position.set(x, y, z);
    p.rotation.order = 'YXZ';
    p.rotation.set(tilt, (i / n) * Math.PI * 2 + off, 0);
    g.add(p);
  }
}

// 蓮蓬：倒圓錐，平頂上有幾個深色小孔
function seedPod(g: THREE.Object3D, x: number, y: number, z: number, k: number, color = '#9aa84a'): void {
  part(g, GEO.cone, cm(color, 0, 0.6), 0.16 * k, 0.12 * k, 0.16 * k, x, y, z).rotation.x = Math.PI;
  part(g, GEO.cyl, cm('#c9cf72', 0, 0.6), 0.16 * k, 0.012, 0.16 * k, x, y + 0.06 * k, z, false);
  for (let i = 0; i < 3; i++) part(g, GEO.sphereLo, cm('#5a4a2a', 0, 0.8), 0.025 * k, 0.012, 0.025 * k, x + Math.cos(i * 2.1) * 0.035 * k, y + 0.066 * k, z + Math.sin(i * 2.1) * 0.035 * k, false);
}

const STAMEN_GEO = new THREE.TorusGeometry(0.5, 0.18, 6, 16); // 花心外圈的雄蕊

function buildLotus(g: THREE.Group, s: Shape<'aquatic'>, stage: number): void {
  const stemM = cm('#5f9e3a', 0.15, 0.55);
  if (stage === 0) {
    // 浮在水面的小蓮蓬＋一片小圓葉
    seedPod(g, 0.02, 0.03, 0.0, 0.75, '#8a9a4a');
    pad(g, 0.09, -0.1, 0.004, 0.07, 1.2);
    return;
  }
  if (stage === 1) {
    // 兩片小浮葉＋一支剛捲起來冒出水面的嫩葉
    pad(g, 0.13, -0.06, 0.004, 0.04, 0.3);
    pad(g, 0.1, 0.12, 0.008, -0.06, 2.6);
    part(g, GEO.cone, cm('#7fc85a', 0.2), 0.05, 0.16, 0.05, 0.04, 0.08, 0.08).rotation.z = -0.15;
    return;
  }
  const grown = stage === 3;
  // 浮葉：成熟 4 片大圓葉，成長中 3 片
  const pads: [number, number, number, number][] = grown
    ? [[-0.17, 0.12, 0.27, 0.4], [0.2, 0.14, 0.23, 2.2], [0.04, -0.21, 0.29, 4.4], [-0.27, -0.16, 0.18, 5.6]]
    : [[-0.12, 0.08, 0.2, 0.4], [0.15, 0.1, 0.16, 2.2], [0.02, -0.15, 0.18, 4.4]];
  pads.forEach(([x, z, r, ry], i) => pad(g, r, x, 0.004 + i * 0.004, z, ry));
  // 挺出水面的一片荷葉（微微傾斜的杯狀）
  const lx = grown ? 0.24 : 0.17, lz = grown ? -0.2 : -0.14, lh = grown ? 0.32 : 0.22;
  rod(g, stemM, 0.08, 0, -0.05, lx, lh, lz, 0.025);
  const up = pad(g, grown ? 0.17 : 0.12, lx, lh, lz, 1.0);
  up.rotation.set(0.35, 1.0, -0.25);
  const tip = s.flower;
  if (!grown) {
    // 含苞：長莖頂著合起來的粉紅花苞
    rod(g, stemM, 0, 0, 0.02, -0.02, 0.36, 0.05, 0.03);
    petalRing(g, tip, -0.02, 0.35, 0.05, 4, 0.14, 0.13, 0.17);
    part(g, GEO.sphereLo, cm('#6aa84a', 0.1), 0.06, 0.04, 0.06, -0.02, 0.36, 0.05, false);
    return;
  }
  // 盛開：長莖、兩層尖花瓣、黃色蓮蓬花心＋一圈雄蕊
  const fx = -0.02, fy = 0.5, fz = 0.06;
  rod(g, stemM, 0, 0, 0.02, fx, fy, fz, 0.032);
  petalRing(g, tip, fx, fy - 0.01, fz, 8, 1.05, 0.15, 0.2, 0.2);
  petalRing(g, tip, fx, fy, fz, 6, 0.5, 0.13, 0.17, 0.55);
  part(g, GEO.cyl, cm('#e8d84a', 0, 0.5), 0.075, 0.05, 0.075, fx, fy + 0.05, fz, false);
  part(g, STAMEN_GEO, cm('#ffc93a', 0, 0.5), 0.13, 0.13, 0.13, fx, fy + 0.045, fz, false).rotation.x = Math.PI / 2;
  // 旁邊一支已結果的蓮蓬
  rod(g, stemM, -0.05, 0, -0.04, -0.2, 0.38, -0.1, 0.022);
  seedPod(g, -0.2, 0.4, -0.1, 0.8);
}

// 西洋菜：一片浮在水面、層層疊疊的亮綠小圓葉＋往上挺的嫩枝（葉子全部合併成一個幾何，依階段快取）
// 嫩枝位置：[根部 x, z, 頂端 x, z, 高度]
function cressSprigs(stage: number): [number, number, number, number, number][] {
  if (stage < 2) return [];
  const n = stage === 3 ? 6 : 3, out: [number, number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + 0.4, r = 0.05 + (i % 3) * 0.07;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    out.push([x, z, x * 1.5 + Math.cos(a) * 0.03, z * 1.5 + Math.sin(a) * 0.03, (stage === 3 ? 0.17 : 0.11) + rnd(i + 20) * 0.05]);
  }
  return out;
}
const cressCache = new Map<string, THREE.BufferGeometry>();
function cressGeo(stage: number, leafColor: string): THREE.BufferGeometry {
  const key = stage + leafColor;
  let g = cressCache.get(key);
  if (g) return g;
  const n = [6, 18, 40, 72][stage], R = [0.09, 0.17, 0.27, 0.36][stage], H = [0.004, 0.018, 0.045, 0.08][stage];
  const base = new THREE.Color(leafColor);
  const tones = [base.clone(), base.clone().lerp(new THREE.Color('#a8f060'), 0.35), base.clone().lerp(new THREE.Color('#1f7a26'), 0.4), base.clone().lerp(new THREE.Color('#d8ff80'), 0.2)];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const SEG = 12;
  // 一片小圓葉：中心微微隆起、邊緣深一點
  const disc = (x: number, y: number, z: number, r: number, rx: number, ry: number, rz: number, c: THREE.Color) => {
    m.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(r, r, r * 0.9));
    const b = pos.length / 3;
    const p0 = new THREE.Vector3(0, 0.18, 0).applyMatrix4(m);
    pos.push(p0.x, p0.y, p0.z);
    col.push(Math.min(1, c.r * 1.2), Math.min(1, c.g * 1.2), Math.min(1, c.b * 1.2));
    for (let k = 0; k <= SEG; k++) {
      const t = (k / SEG) * Math.PI * 2;
      const pk = new THREE.Vector3(Math.cos(t), 0, Math.sin(t)).applyMatrix4(m);
      pos.push(pk.x, pk.y, pk.z);
      col.push(c.r * 0.72, c.g * 0.72, c.b * 0.72);
    }
    for (let k = 0; k < SEG; k++) idx.push(b, b + k + 2, b + k + 1);
  };
  for (let i = 0; i < n; i++) {
    // 黃金角散佈：中間高、外圈貼水面
    const r = Math.sqrt((i + 0.5) / n) * R, a = i * 2.39996;
    const y = 0.006 + (1 - (r / R) ** 2) * H + rnd(i) * 0.01;
    const lr = (0.045 + rnd(i + 3) * 0.028) * (stage === 0 ? 0.75 : 1);
    disc(Math.cos(a) * r, y, Math.sin(a) * r, lr, (rnd(i + 7) - 0.5) * 0.6 * (r / R) + 0.08, rnd(i + 11) * 6.28, (rnd(i + 13) - 0.5) * 0.45, tones[i % tones.length]);
  }
  // 嫩枝上的小葉：沿莖兩兩對生，越上面越小
  cressSprigs(stage).forEach(([x, z, tx, tz, h], i) => {
    for (let k = 0; k < 3; k++) {
      const t = 0.45 + k * 0.27, px = x + (tx - x) * t, pz = z + (tz - z) * t, py = 0.03 + (h - 0.03) * t;
      const out = Math.atan2(tz - z, tx - x);
      for (const sd of [-1, 1]) {
        const ang = out + sd * 1.2;
        disc(px + Math.cos(ang) * 0.03, py, pz + Math.sin(ang) * 0.03, 0.036 - k * 0.006, 0.35 * sd, -ang, 0.25, tones[(i + k) % tones.length]);
      }
    }
    disc(tx, h + 0.005, tz, 0.03, 0, i, 0, tones[1]);
  });
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  cressCache.set(key, g);
  return g;
}
let cressMatCache: THREE.MeshStandardMaterial | null = null;

function buildCress(g: THREE.Group, s: Shape<'aquatic'>, stage: number): void {
  cressMatCache ??= withWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, side: THREE.DoubleSide }), 0.06);
  g.add(mesh(cressGeo(stage, s.leaf), cressMatCache, stage >= 2));
  // 嫩枝的莖；成熟時頂端開白色小花
  const stemM = cm('#4f9e3a', 0.3), flowerM = cm(s.flower, 0.3, 0.5);
  cressSprigs(stage).forEach(([x, z, tx, tz, h], i) => {
    rod(g, stemM, x, 0.03, z, tx, h, tz, 0.016);
    if (stage === 3 && i % 2 === 0) for (let k = 0; k < 2; k++) part(g, GEO.sphereLo, flowerM, 0.035, 0.03, 0.035, tx + (k ? 0.025 : -0.015), h + 0.03 + k * 0.01, tz + (k ? -0.01 : 0.02), false);
  });
}

function buildAquatic(s: Shape<'aquatic'>, stage: number): THREE.Group {
  const g = new THREE.Group();
  if (s.style === 'cress') buildCress(g, s, stage);
  else buildLotus(g, s, stage);
  return g;
}

export function buildCrop(def: CropDef, stage: number): THREE.Group {
  const g = new THREE.Group();
  const s = def.shape;
  if (s.kind === 'giant') return buildGiant(s.variant, stage);
  if (s.kind === 'aquatic') return buildAquatic(s, stage);
  if (stage === 0) {
    for (let i = 0; i < 3; i++) {
      const seed = mesh(GEO.sphereLo, cm('#f1dfb0'), false);
      seed.scale.set(0.07, 0.05, 0.07);
      seed.position.set(Math.cos(i * 2.1) * 0.12, 0.02, Math.sin(i * 2.1) * 0.12);
      g.add(seed);
    }
    return g;
  }
  if (stage === 1) {
    if (s.kind === 'mushroom') {
      const log = mesh(GEO.cyl, cm('#7a5a3e', 0, 0.9));
      log.scale.set(0.24, 0.62, 0.24);
      log.rotation.z = Math.PI / 2;
      log.position.y = 0.12;
      g.add(log);
      return g;
    }
    if (s.kind === 'tall' && s.style === 'bamboo') {
      // 竹筍：剛冒出土的小筍尖
      part(g, GEO.sphere, cm(SOIL, 0, 0.95), 0.36, 0.08, 0.36, 0, 0, 0, false);
      part(g, GEO.cone, cm(s.fruit, 0, 0.8), 0.12, 0.16, 0.12, 0, 0.06, 0);
      return g;
    }
    const col = s.kind === 'grain' || s.kind === 'cane' ? '#8fcf5a' : 'leaf' in s ? s.leaf : '#6fbf4a';
    g.add(leaf(col, 0.16, 0, -0.6), leaf(col, 0.16, Math.PI, -0.6));
    return g;
  }
  const grown = stage === 3;
  switch (s.kind) {
    case 'root': {
      if (s.rootShape === 'long' || s.rootShape === 'rhizome') { buildRoot2(g, s, grown); break; }
      const n = grown ? s.leafCount + 1 : s.leafCount - 1;
      if (s.tubeLeaves) {
        // 洋蔥：直立的管狀葉
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const t = stick(s.leaf, grown ? 0.5 : 0.32, 0.03, 0.5);
          t.position.set(Math.cos(a) * 0.04, t.position.y, Math.sin(a) * 0.04);
          t.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25);
          g.add(t);
        }
      } else {
        for (let i = 0; i < n; i++) g.add(leaf(s.leaf, grown ? 0.38 : 0.26, (i / n) * Math.PI * 2, -0.35 - (i % 2) * 0.2));
      }
      const rootMat = cm(s.root, 0, 0.5);
      if (s.rootShape === 'oval') {
        // 馬鈴薯、地瓜：好幾顆露出土面
        const k = grown ? 1 : 0.55;
        for (let i = 0; i < 3; i++) {
          const r = mesh(GEO.sphere, rootMat);
          r.scale.set(0.2 * k, 0.15 * k, 0.26 * k);
          const a = i * 2.2 + 0.4;
          r.position.set(Math.cos(a) * 0.18 * k, 0.03, Math.sin(a) * 0.18 * k);
          r.rotation.y = a;
          g.add(r);
        }
      } else {
        const r = mesh(s.rootShape === 'cone' ? GEO.cone : GEO.sphere, rootMat);
        if (s.rootShape === 'cone') {
          const k = grown ? 0.22 : 0.12;
          r.scale.set(k, k * 2.2, k);
          r.rotation.x = Math.PI;
          r.position.y = grown ? 0.08 : 0.0;
        } else if (s.rootShape === 'bulb') {
          const k = grown ? 0.3 : 0.17;
          r.scale.set(k, k * 1.05, k);
          r.position.y = grown ? 0.12 : 0.04;
        } else {
          const k = grown ? 0.34 : 0.18;
          r.scale.set(k, k * 0.95, k);
          r.position.y = grown ? 0.1 : 0.02;
        }
        g.add(r);
      }
      break;
    }
    case 'grain': {
      if (s.droop) { buildRice(g, s, grown); break; }
      const n = grown ? 7 : 5;
      const h = grown ? 0.85 : 0.45;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = i === 0 ? 0 : 0.13;
        const st = stick(grown ? s.stalk : '#7fbf4a', h, 0.035);
        st.position.x = Math.cos(a) * rr;
        st.position.z = Math.sin(a) * rr;
        g.add(st);
        if (grown) {
          const head = mesh(GEO.sphereLo, cm(s.head, 0.35));
          head.scale.set(0.09, 0.26, 0.09);
          head.position.set(Math.cos(a) * rr, h + 0.1, Math.sin(a) * rr);
          g.add(head);
        }
      }
      for (let i = 0; i < 3; i++) g.add(leaf(grown ? '#a8b84a' : '#7fbf4a', 0.3, i * 2.1, -0.3));
      break;
    }
    case 'cane': {
      // 甘蔗：高高的分節莖＋長葉
      const n = grown ? 4 : 3;
      const h = grown ? 1.35 : 0.7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12;
        const st = stick(grown ? s.stalk : '#8fbf5a', h, 0.06, 0.2);
        st.position.x = x;
        st.position.z = z;
        g.add(st);
        for (let k = 1; k < 4; k++) {
          const ring = mesh(GEO.cyl, cm('#5e3e52', 0.2), false);
          ring.scale.set(0.07, 0.025, 0.07);
          ring.position.set(x, (h / 4) * k, z);
          if (grown) g.add(ring);
        }
        const top = new THREE.Group();
        top.position.set(x, h * 0.85, z);
        for (let k = 0; k < 3; k++) top.add(leaf(s.leaf, 0.45, a + k * 2.1, -0.2, 0.22));
        g.add(top);
      }
      break;
    }
    case 'flower': {
      if (s.style) { buildFlower(g, s, grown); break; }
      const n = grown ? 6 : 4;
      for (let i = 0; i < n; i++) g.add(leaf(s.leaf, 0.26, (i / n) * Math.PI * 2, -0.5));
      const stems = grown ? 5 : 3;
      for (let i = 0; i < stems; i++) {
        const a = i * 1.9;
        const h = (grown ? 0.55 : 0.35) + (i % 2) * 0.1;
        const st = stick(s.stem, h, 0.025, 0.4);
        st.position.x = Math.cos(a) * 0.1;
        st.position.z = Math.sin(a) * 0.1;
        g.add(st);
        if (grown) {
          for (let k = 0; k < 4; k++) {
            const f = mesh(GEO.sphereLo, def.night ? glow(s.flower) : cm(s.flower, 0.4), false);
            f.scale.setScalar(0.07);
            f.position.set(Math.cos(a) * 0.1 + Math.cos(k * 1.6) * 0.05, h + 0.02 + (k % 2) * 0.04, Math.sin(a) * 0.1 + Math.sin(k * 1.6) * 0.05);
            g.add(f);
          }
        }
      }
      break;
    }
    case 'fruit': {
      // 茄子、草莓：一叢葉子＋垂掛的果實
      const berry = s.fruitShape === 'berry';
      rosette(g, s.leaf, s.leaf, grown ? 7 : 5, berry ? 0.28 : 0.34, berry ? -0.35 : -0.6);
      if (!berry) {
        const st = stick('#4a7a34', grown ? 0.45 : 0.3, 0.035);
        g.add(st);
      }
      const n = grown ? s.count : Math.max(1, s.count - 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.5;
        const f = mesh(berry ? GEO.cone : GEO.capsule, cm(grown ? s.fruit : '#8fcf5a', 0, 0.35));
        if (berry) {
          f.scale.set(0.09, 0.12, 0.09);
          f.rotation.x = Math.PI;
          f.position.set(Math.cos(a) * 0.22, 0.07, Math.sin(a) * 0.22);
        } else {
          f.scale.set(0.1, grown ? 0.14 : 0.08, 0.1);
          f.position.set(Math.cos(a) * 0.16, grown ? 0.22 : 0.26, Math.sin(a) * 0.16);
          f.rotation.z = Math.cos(a) * 0.4;
          f.rotation.x = -Math.sin(a) * 0.4;
          const cap = mesh(GEO.sphereLo, cm('#3f7a2a'), false);
          cap.scale.set(0.09, 0.05, 0.09);
          cap.position.set(f.position.x, f.position.y + (grown ? 0.16 : 0.1), f.position.z);
          g.add(cap);
        }
        g.add(f);
      }
      break;
    }
    case 'leafy': {
      if (s.style === 'head') {
        // 大白菜：一層層包起來的葉球
        const k = grown ? 1 : 0.6;
        const core = mesh(GEO.sphere, cm(s.leaf2, 0, 0.55));
        core.scale.set(0.3 * k, 0.42 * k, 0.3 * k);
        core.position.y = 0.2 * k;
        g.add(core);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const l = mesh(GEO.sphere, cm(s.leaf, 0.2, 0.55));
          l.scale.set(0.24 * k, 0.4 * k, 0.1 * k);
          l.position.set(Math.cos(a) * 0.13 * k, 0.2 * k, Math.sin(a) * 0.13 * k);
          l.rotation.set(Math.sin(a) * 0.25, -a, Math.cos(a) * 0.25);
          l.lookAt(l.position.x * 3, 0.2 * k, l.position.z * 3);
          g.add(l);
        }
        rosette(g, s.leaf, s.leaf, 5, 0.3 * k, -0.15);
      } else if (s.style === 'rosette') {
        rosette(g, s.leaf, s.leaf2, grown ? 10 : 6, grown ? 0.32 : 0.22, -0.3, 0.55);
      } else if (s.style === 'ball') {
        // 高麗菜：外圈大片外翻的葉子托著一顆緊實的淡綠菜球
        const k = grown ? 1 : 0.6;
        for (let i = 0; i < 7; i++) leafAt(g, s.leaf, 0.42 * k, 0, 0.02, 0, (i / 7) * Math.PI * 2 + 0.2, 0.15 - (i % 2) * 0.25, 0.85);
        part(g, GEO.sphere, cm(s.leaf2, 0, 0.5), 0.4 * k, 0.36 * k, 0.4 * k, 0, 0.19 * k, 0);
        if (grown) {
          const mid = '#' + new THREE.Color(s.leaf).lerp(new THREE.Color(s.leaf2), 0.45).getHexString();
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.5;
            part(g, GEO.sphere, cm(mid, 0, 0.5), 0.3, 0.3, 0.12, Math.cos(a) * 0.12, 0.15, Math.sin(a) * 0.12).lookAt(Math.cos(a) * 3, 0.1, Math.sin(a) * 3);
          }
        }
      } else if (s.style === 'curd') {
        // 花椰菜：直立的藍綠大葉圍成一圈，中間捧著白色凹凸花球
        const k = grown ? 1 : 0.62;
        for (let i = 0; i < 7; i++) leafAt(g, s.leaf, 0.46 * k, 0, 0.02, 0, (i / 7) * Math.PI * 2, -0.1 - (i % 2) * 0.25, 0.55);
        const cur = cm(grown ? s.leaf2 : '#dfe8b0', 0, 0.85);
        if (grown) {
          part(g, GEO.sphere, cur, 0.36, 0.24, 0.36, 0, 0.24, 0);
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2, r = 0.11 + (i % 2) * 0.02;
            part(g, GEO.sphere, cur, 0.16, 0.14, 0.16, Math.cos(a) * r, 0.25 + (i % 2) * 0.03, Math.sin(a) * r, false);
          }
          for (let i = 0; i < 3; i++) part(g, GEO.sphere, cur, 0.13, 0.11, 0.13, Math.cos(i * 2.1) * 0.05, 0.32, Math.sin(i * 2.1) * 0.05, false);
        } else {
          part(g, GEO.sphere, cur, 0.12, 0.09, 0.12, 0, 0.12, 0);
        }
      } else {
        // 茼蒿：細碎的羽狀葉，成熟時開小黃花
        for (let i = 0; i < (grown ? 9 : 6); i++) {
          const a = i * 0.7;
          const h = (grown ? 0.4 : 0.25) + (i % 3) * 0.05;
          const st = stick(s.leaf, h, 0.02, 0.5);
          st.position.set(Math.cos(a) * 0.1, st.position.y, Math.sin(a) * 0.1);
          st.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
          g.add(st);
          const tuft = mesh(GEO.sphereLo, cm(i % 2 ? s.leaf2 : s.leaf, 0.5), false);
          tuft.scale.set(0.14, 0.1, 0.14);
          tuft.position.set(Math.cos(a) * 0.1 + Math.cos(a) * 0.3 * h * 0.3, h, Math.sin(a) * 0.1 + Math.sin(a) * 0.3 * h * 0.3);
          g.add(tuft);
          if (grown && s.flower && i % 3 === 0) {
            const f = mesh(GEO.sphereLo, cm(s.flower, 0.5), false);
            f.scale.setScalar(0.08);
            f.position.set(tuft.position.x, h + 0.07, tuft.position.z);
            g.add(f);
          }
        }
      }
      break;
    }
    case 'vine': buildVine(g, s, grown); break;
    case 'tall': buildTall(g, s, grown); break;
    case 'bush': buildBush(g, s, grown); break;
    case 'melon': buildMelon(g, s, grown); break;
    case 'mushroom': {
      // 香菇：段木上長出的菇
      const log = mesh(GEO.cyl, cm('#7a5a3e', 0, 0.9));
      log.scale.set(0.24, 0.62, 0.24);
      log.rotation.z = Math.PI / 2;
      log.position.y = 0.12;
      g.add(log);
      const n = grown ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const x = -0.22 + (i / (n - 1)) * 0.44;
        const side = i % 2 ? 1 : -1;
        const k = grown ? 1 : 0.55;
        const stem = mesh(GEO.cyl, cm(s.stem), false);
        stem.scale.set(0.04 * k, 0.08 * k, 0.04 * k);
        stem.position.set(x, 0.22 + 0.04 * k, side * 0.06);
        const cap = mesh(GEO.sphere, cm(s.cap, 0, 0.7));
        cap.scale.set(0.16 * k, 0.08 * k, 0.16 * k);
        cap.position.set(x, 0.28 + 0.08 * k, side * 0.06);
        g.add(stem, cap);
      }
      break;
    }
  }
  return g;
}
