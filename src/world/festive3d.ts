import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FestivalId } from '../data/festivals';
import { mulberry32 } from '../core/rng';
import { GEO, mat } from './materials';

// =====================================================================
// 共用小工具（溫室、市集、節慶裝飾都會用到）
// =====================================================================

const rcache = new Map<string, THREE.BufferGeometry>();
export const rbox = (w: number, h: number, d: number, r = 0.06, seg = 2): THREE.BufferGeometry => {
  const key = `${w}|${h}|${d}|${r}|${seg}`;
  let g = rcache.get(key);
  if (!g) rcache.set(key, (g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))));
  return g;
};

// 夜間發光材質：每幀 emissiveIntensity = base + glow × k（跟房屋窗戶同一套做法）
export interface GlowMat { m: THREE.MeshStandardMaterial; k: number; base: number }

// 一組裝飾：group 放在世界座標；local（可選）掛在房屋底下跟著房屋走
export interface Deco {
  group: THREE.Group;
  local?: THREE.Group;
  glow: GlowMat[];
  tick?: (dt: number, t: number, glow: number) => void;
  block?: [number, number][]; // 需要擋住的世界格座標
}

// 材質快取＋發光材質登記
export class Kit {
  glow: GlowMat[] = [];
  private cache = new Map<string, THREE.MeshStandardMaterial>();

  m(color: string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const key = color + JSON.stringify(opts);
    let m = this.cache.get(key);
    if (!m) this.cache.set(key, (m = mat(color, opts)));
    return m;
  }

  lit(color: string, emissive: string, k: number, base = 0, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const key = `lit|${color}|${emissive}|${k}|${base}|${JSON.stringify(opts)}`;
    let m = this.cache.get(key);
    if (!m) {
      m = mat(color, { emissive, emissiveIntensity: base, ...opts });
      this.cache.set(key, m);
      this.glow.push({ m, k, base });
    }
    return m;
  }
}

type V3 = [number, number, number];
// 快速放一個網格：P(父物件, 幾何, 材質, 位置, 旋轉, 縮放, 投影)
export function P(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: V3, rot?: V3 | null, scale?: number | V3 | null, shadow = true): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(pos[0], pos[1], pos[2]);
  if (rot) me.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined && scale !== null) {
    if (typeof scale === 'number') me.scale.setScalar(scale);
    else me.scale.set(scale[0], scale[1], scale[2]);
  }
  me.castShadow = shadow;
  me.receiveShadow = true;
  parent.add(me);
  return me;
}

// 從 a 指到 b 的棍子（柱、梁、繩子）
export function stick(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, shadow = true): THREE.Mesh {
  const len = a.distanceTo(b);
  const me = new THREE.Mesh(GEO.cyl, m);
  me.scale.set(r * 2, len, r * 2);
  me.position.copy(a).lerp(b, 0.5);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  me.castShadow = shadow;
  me.receiveShadow = true;
  parent.add(me);
  return me;
}

// 靜態網格依材質合併成少數 draw call；userData.dyn = true 的子樹（會動的）保留原樣
export function bake(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const statics: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== root && o.userData.dyn) return;
    const me = o as THREE.Mesh;
    if (o !== root && me.isMesh && !(me as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(me.material)) statics.push(me);
    for (const c of o.children) visit(c);
  };
  visit(root);
  const buckets = new Map<string, { m: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  const tmp = new THREE.Matrix4();
  for (const me of statics) {
    const material = me.material as THREE.Material;
    const key = material.uuid + (me.castShadow ? '|s' : '') + (me.receiveShadow ? '|r' : '');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { m: material, cast: me.castShadow, recv: me.receiveShadow, geos: [] }));
    const src = me.geometry.index ? me.geometry.toNonIndexed() : me.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position').clone());
    const n = src.getAttribute('normal');
    if (n) g.setAttribute('normal', n.clone());
    else g.computeVertexNormals();
    const uv = src.getAttribute('uv');
    g.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.applyMatrix4(tmp.multiplyMatrices(inv, me.matrixWorld));
    b.geos.push(g);
  }
  for (const me of statics) me.parent?.remove(me);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const out = new THREE.Mesh(merged, b.m);
    out.castShadow = b.cast;
    out.receiveShadow = b.recv;
    if ((b.m as THREE.Material).transparent) out.renderOrder = 2;
    root.add(out);
  }
}

// 畫布貼圖（招牌、春聯文字）
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const FONT_KAI = '"Kaiti TC","STKaiti","BiauKai","DFKai-SB","Songti TC","Noto Serif TC",serif';
export const FONT_ROUND = '"Baloo 2","PingFang TC","Noto Sans TC",sans-serif';

// 貼一張文字面板（平面，面向 +z）
export function texPlane(parent: THREE.Object3D, tex: THREE.Texture, w: number, h: number, pos: V3, rotY = 0, lit?: { emissive: string; k: number; base: number; kit: Kit }): THREE.Mesh {
  const opts: THREE.MeshStandardMaterialParameters = { map: tex, roughness: 0.85, transparent: true, alphaTest: 0.05 };
  const m = mat('#ffffff', opts);
  if (lit) {
    m.emissive.set(lit.emissive);
    m.emissiveMap = tex;
    lit.kit.glow.push({ m, k: lit.k, base: lit.base });
  }
  const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  me.position.set(pos[0], pos[1], pos[2]);
  me.rotation.y = rotY;
  me.receiveShadow = true;
  parent.add(me);
  return me;
}

// 下垂的繩子點列
export function sag(a: THREE.Vector3, b: THREE.Vector3, droop: number, n = 16): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= droop * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}

export function cord(parent: THREE.Object3D, pts: THREE.Vector3[], m: THREE.Material, r = 0.012): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, r, 4, false), m);
  me.castShadow = false;
  parent.add(me);
  return me;
}

// 三角彩旗串
const flagGeo = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  return g;
})();
export function bunting(kit: Kit, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, colors: string[], droop = 0.3, size = 0.26): void {
  const pts = sag(a, b, droop, 24);
  cord(parent, pts, kit.m('#f4ead8'), 0.012);
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(2, Math.floor(a.distanceTo(b) / (size * 1.3)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const f = new THREE.Mesh(flagGeo, kit.m(colors[i % colors.length], { side: THREE.DoubleSide, roughness: 0.8 }));
    f.scale.set(size, size * 1.15, 1);
    f.position.copy(p);
    f.rotation.y = Math.atan2(-tan.z, tan.x);
    f.castShadow = true;
    parent.add(f);
  }
}

// 燈泡串：沿著下垂的繩子每隔 spacing 一顆
export function lightString(kit: Kit, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, droop: number, palette: [string, string][], k = 1.8, base = 0.06, spacing = 0.3, r = 0.05): THREE.MeshStandardMaterial[] {
  const pts = sag(a, b, droop, 20);
  cord(parent, pts, kit.m('#3a4a32'), 0.01);
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
  const used: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const [c, e] = palette[i % palette.length];
    const m = kit.lit(c, e, k, base, { roughness: 0.3 });
    if (!used.includes(m)) used.push(m);
    P(parent, GEO.sphereLo, m, [p.x, p.y - r * 1.1, p.z], null, [r * 2, r * 2.5, r * 2], false);
  }
  return used;
}

// 中式燈籠（原點在吊掛點，燈身往下掛）
export function chineseLantern(kit: Kit, color: string, emissive: string, size: number, shape: 'round' | 'tall' = 'round', k = 1.2, base = 0.08): THREE.Group {
  const g = new THREE.Group();
  const gold = kit.m('#e8b84a', { metalness: 0.35, roughness: 0.45 });
  const body = kit.lit(color, emissive, k, base, { roughness: 0.6 });
  const rib = kit.m('#' + new THREE.Color(color).multiplyScalar(0.62).getHexString(), { roughness: 0.7 });
  const hy = shape === 'tall' ? size * 1.3 : size * 0.86;
  const cy = -0.06 - size * 0.1 - hy / 2;
  P(g, GEO.cyl, kit.m('#6a2a1a'), [0, -0.03, 0], null, [0.02, 0.06, 0.02], false);
  P(g, GEO.cyl, gold, [0, cy + hy / 2 + size * 0.02, 0], null, [size * 0.5, size * 0.12, size * 0.5]);
  P(g, GEO.sphere, body, [0, cy, 0], null, [size, hy, size]);
  const ribGeo = new THREE.TorusGeometry(0.5, 0.02, 4, 28);
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) P(g, ribGeo, rib, [0, cy, 0], [0, a, 0], [size * 1.01, hy * 1.01, size * 1.01], false);
  P(g, GEO.cyl, gold, [0, cy - hy / 2 - size * 0.02, 0], null, [size * 0.42, size * 0.1, size * 0.42]);
  P(g, GEO.cyl, kit.m(color === '#e8342c' || color === '#d8342c' ? '#f2c44a' : '#e8342c'), [0, cy - hy / 2 - size * 0.34, 0], null, [size * 0.12, size * 0.5, size * 0.12], false);
  return g;
}

// 五角星形狀
export function starShape(ro: number, ri: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.25);
  s.bezierCurveTo(0, 0.25, -0.05, 0.5, -0.25, 0.5);
  s.bezierCurveTo(-0.55, 0.5, -0.55, 0.15, -0.55, 0.15);
  s.bezierCurveTo(-0.55, -0.05, -0.35, -0.27, 0, -0.45);
  s.bezierCurveTo(0.35, -0.27, 0.55, -0.05, 0.55, 0.15);
  s.bezierCurveTo(0.55, 0.15, 0.55, 0.5, 0.25, 0.5);
  s.bezierCurveTo(0.1, 0.5, 0, 0.25, 0, 0.25);
  return s;
}

// =====================================================================
// 節慶裝飾
// =====================================================================

// 房屋提供給節慶裝飾的錨點（房屋本地座標，門朝 +z）
export interface HouseFest {
  tier: number;
  fz: number; // 前牆 z
  doorHalf: number; // 門框半寬
  doorTop: number; // 門框頂端高度
  hang: THREE.Vector3[]; // 門廊左右吊掛點
  eave: [THREE.Vector3, THREE.Vector3]; // 前簷線（燈串、彩旗）
  porchZ: number; // 門廊前緣 z
  porchY: number; // 門廊地板高度
  porchHalf: number; // 門廊半寬
  lintel: THREE.Vector3; // 橫批（門上方橫幅）的中心：T3 掛在門廊屋簷前緣、T4 起掛在陽台前梁
  coupletTop: number; // 春聯上緣高度（T3 門廊屋頂較低，春聯要往下貼才看得到）
}

export interface FestCtx {
  fest: HouseFest;
  houseX: number;
  houseZ: number;
  pathX: number;
  pathZ0: number; // 小徑起點（房屋門前）
  gateZ: number; // 南側大門
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 大門兩側的裝飾柱（回傳柱頂位置）
function gatePosts(kit: Kit, g: THREE.Group, ctx: FestCtx, color: string, h = 2.0): THREE.Vector3[] {
  const m = kit.m(color, { roughness: 0.7 });
  const cap = kit.m('#f3e7d3');
  const tops: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const x = ctx.pathX + s * 1.6;
    P(g, rbox(0.24, h, 0.24, 0.05), m, [x, h / 2, ctx.gateZ]);
    P(g, GEO.sphereLo, cap, [x, h + 0.08, ctx.gateZ], null, 0.26);
    tops.push(V(x, h - 0.1, ctx.gateZ));
  }
  return tops;
}

// 小徑旁的短柱＋往小徑伸出的橫桿（回傳吊掛點）
function pathPosts(kit: Kit, g: THREE.Group, ctx: FestCtx, zs: number[], color = '#8a5a3a', h = 1.7): THREE.Vector3[] {
  const m = kit.m(color, { roughness: 0.75 });
  const hooks: THREE.Vector3[] = [];
  for (const z of zs) for (const s of [-1, 1]) {
    const x = ctx.pathX + s * 1.1;
    P(g, rbox(0.1, h, 0.1, 0.03), m, [x, h / 2, z]);
    P(g, rbox(0.42, 0.06, 0.06, 0.02), m, [x - s * 0.19, h - 0.08, z]);
    hooks.push(V(x - s * 0.36, h - 0.11, z));
  }
  return hooks;
}

// 橫幅：兩根門柱之間的木牌（文字朝 +z）
function banner(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, y: number, tex: THREE.Texture, h: number, kit: Kit, boardColor: string): void {
  const w = a.distanceTo(b) - 0.24;
  const mid = a.clone().lerp(b, 0.5);
  P(g, rbox(w, h + 0.08, 0.08, 0.03), kit.m(boardColor), [mid.x, y, mid.z]);
  texPlane(g, tex, w - 0.1, h, [mid.x, y, mid.z + 0.045]);
}

// ---------- 春節 ----------
function cnyTextTex(chars: string, vertical: boolean): THREE.CanvasTexture {
  const n = chars.length;
  const W = vertical ? 128 : 128 * n, H = vertical ? 128 * n : 128;
  return canvasTex(W + 24, H + 24, (c, w, h) => {
    c.fillStyle = '#c8261e';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f2c44a';
    c.lineWidth = 6;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#ffd966';
    c.font = `bold 96px ${FONT_KAI}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const x = vertical ? w / 2 : 12 + 64 + i * 128;
      const y = vertical ? 12 + 64 + i * 128 : h / 2;
      c.fillText(chars[i], x, y + 4);
    }
  });
}

function fuTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d42a22';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f2c44a';
    c.lineWidth = 12;
    c.strokeRect(14, 14, w - 28, h - 28);
    // 倒貼的「福」：福到了
    c.translate(w / 2, h / 2);
    c.rotate(Math.PI + Math.PI / 4);
    c.fillStyle = '#1e0c08';
    c.font = `bold 150px ${FONT_KAI}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('福', 0, 8);
  });
}

// 一串鞭炮（原點在頂端）
function firecrackers(kit: Kit, n = 9): THREE.Group {
  const g = new THREE.Group();
  const red = kit.m('#d8342c', { roughness: 0.55 });
  const gold = kit.m('#f2c44a');
  stick(g, V(0, 0, 0), V(0, -n * 0.075 - 0.05, 0), 0.01, kit.m('#6a2a1a'), false);
  for (let i = 0; i < n; i++) {
    const y = -0.08 - i * 0.075;
    for (const s of [-1, 1]) {
      const cr = P(g, GEO.cyl, red, [s * 0.05, y, 0], [0, 0, s * 0.9], [0.045, 0.13, 0.045], false);
      cr.rotation.y = i * 0.5;
    }
  }
  P(g, GEO.sphereLo, gold, [0, 0.02, 0], null, 0.09, false);
  return g;
}

function buildCny(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group, dyn: THREE.Object3D[]): void {
  const f = ctx.fest;
  const zf = f.fz + 0.1;
  // 春聯（上聯在右）＋橫批＋倒福
  const cw = 0.3, ch = 1.1;
  const cy = f.coupletTop - ch / 2;
  texPlane(local, cnyTextTex('五穀豐登', true), cw, ch, [f.doorHalf + 0.21, cy, zf]);
  texPlane(local, cnyTextTex('六畜興旺', true), cw, ch, [-(f.doorHalf + 0.21), cy, zf]);
  texPlane(local, cnyTextTex('吉祥如意', false), 1.14, 0.3, [f.lintel.x, f.lintel.y, f.lintel.z]);
  const fu = texPlane(local, fuTex(), 0.42, 0.42, [0, f.doorTop - 0.95, f.fz + 0.16]);
  fu.rotation.z = Math.PI / 4;
  // 門廊兩個大紅燈籠（會輕輕搖）
  f.hang.forEach((h) => {
    const l = chineseLantern(kit, '#e8342c', '#ff5a2a', 0.56, 'round', 1.3, 0.1);
    l.position.copy(h);
    l.userData.dyn = true;
    local.add(l);
    dyn.push(l);
    const fc = firecrackers(kit, 8);
    fc.position.set(h.x + Math.sign(h.x) * 0.5, h.y, h.z);
    local.add(fc);
  });
  // 小徑兩側紅燈籠
  for (const hk of pathPosts(kit, g, ctx, [ctx.pathZ0 + 3.2, ctx.pathZ0 + 7.4, ctx.pathZ0 + 11.6], '#a8322a')) {
    const l = chineseLantern(kit, '#e8342c', '#ff5a2a', 0.34, 'round', 1.2, 0.08);
    l.position.copy(hk);
    g.add(l);
  }
  // 大門：紅柱＋「恭喜發財」橫幅＋燈籠＋鞭炮
  const tops = gatePosts(kit, g, ctx, '#b8322a', 2.8);
  banner(g, tops[0], tops[1], 2.45, cnyTextTex('恭喜發財', false), 0.36, kit, '#8a2a20');
  for (const t of tops) {
    const l = chineseLantern(kit, '#e8342c', '#ff5a2a', 0.4, 'round', 1.2, 0.08);
    l.position.set(t.x, t.y - 0.15, t.z + 0.22);
    g.add(l);
    const fc = firecrackers(kit, 10);
    fc.position.set(t.x + (t.x > ctx.pathX ? -0.2 : 0.2), 1.95, t.z + 0.16);
    g.add(fc);
  }
}

// ---------- 元宵 ----------
const LANTERN_COLS: [string, string][] = [['#e8342c', '#ff5a2a'], ['#f28a22', '#ff9a2a'], ['#f6c83a', '#ffc83a'], ['#ef6fa0', '#ff6aa8'], ['#6ac46a', '#6aff8a'], ['#6aa8e8', '#6ac8ff'], ['#a87ad8', '#c08aff']];
function buildLantern(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group, dyn: THREE.Object3D[]): void {
  const f = ctx.fest;
  const rand = mulberry32(88);
  f.hang.forEach((h, i) => {
    const [c, e] = LANTERN_COLS[i ? 1 : 0];
    const l = chineseLantern(kit, c, e, 0.5, i ? 'tall' : 'round', 1.3, 0.1);
    l.position.copy(h);
    l.userData.dyn = true;
    local.add(l);
    dyn.push(l);
  });
  // 屋簷下一串小燈籠
  const [ea, eb] = f.eave;
  const ep = sag(ea.clone().setY(ea.y - 0.05), eb.clone().setY(eb.y - 0.05), 0.25, 12);
  cord(local, ep, kit.m('#6a2a1a'), 0.012);
  for (let i = 1; i < ep.length - 1; i += 1) {
    const [c, e] = LANTERN_COLS[i % LANTERN_COLS.length];
    const l = chineseLantern(kit, c, e, 0.22, i % 3 ? 'round' : 'tall', 1.2, 0.08);
    l.position.copy(ep[i]);
    local.add(l);
  }
  // 小徑：兩排高竿，竿與竿之間掛燈籠串，並在路上方交叉
  const pole = kit.m('#8a5a3a');
  const zs: number[] = [];
  for (let z = ctx.pathZ0 + 2; z <= ctx.gateZ - 1; z += 3.1) zs.push(z);
  const H = 2.4;
  const tops: Record<string, THREE.Vector3> = {};
  for (const z of zs) for (const s of [-1, 1]) {
    const x = ctx.pathX + s * 1.15;
    P(g, rbox(0.1, H, 0.1, 0.03), pole, [x, H / 2, z]);
    P(g, GEO.sphereLo, kit.m('#f2c44a'), [x, H + 0.04, z], null, 0.12);
    tops[`${s}|${z}`] = V(x, H - 0.05, z);
  }
  const hangOn = (a: THREE.Vector3, b: THREE.Vector3, n: number, droop: number, big = 0.3) => {
    const pts = sag(a, b, droop, 16);
    cord(g, pts, kit.m('#6a2a1a'), 0.012);
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let i = 1; i <= n; i++) {
      const p = curve.getPointAt(i / (n + 1));
      const [c, e] = LANTERN_COLS[Math.floor(rand() * LANTERN_COLS.length)];
      const l = chineseLantern(kit, c, e, big * (0.85 + rand() * 0.3), rand() < 0.35 ? 'tall' : 'round', 1.2, 0.08);
      l.position.copy(p);
      g.add(l);
      // 燈謎紙條
      if (rand() < 0.5) P(g, rbox(0.07, 0.2, 0.01, 0.004), kit.m(rand() < 0.5 ? '#fff4e0' : '#ffd0e0'), [p.x, p.y - big * 1.35, p.z + 0.02], null, null, false);
    }
  };
  for (let i = 0; i < zs.length; i++) {
    const zl = zs[i];
    for (const s of [-1, 1]) if (i < zs.length - 1) hangOn(tops[`${s}|${zl}`], tops[`${s}|${zs[i + 1]}`], 3, 0.45);
    hangOn(tops[`-1|${zl}`], tops[`1|${zl}`], 2, 0.3, 0.26);
  }
}

// ---------- 中秋 ----------
function rabbitLantern(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const body = kit.lit('#fff8f0', '#ffd9a0', 1.1, 0.1, { roughness: 0.6 });
  const red = kit.m('#e8342c');
  const pink = kit.m('#ffb0c0');
  const wheel = kit.m('#a8322a');
  P(g, GEO.sphere, body, [0, 0.36, 0], null, [0.46, 0.38, 0.66]);
  P(g, GEO.sphere, body, [0, 0.6, 0.3], null, [0.34, 0.32, 0.34]);
  for (const s of [-1, 1]) {
    const ear = P(g, GEO.sphere, body, [s * 0.08, 0.86, 0.22], [-0.35, 0, s * 0.18], [0.1, 0.36, 0.07]);
    ear.castShadow = true;
    P(g, GEO.sphere, pink, [s * 0.08, 0.86, 0.245], [-0.35, 0, s * 0.18], [0.05, 0.26, 0.03], false);
    P(g, GEO.sphereLo, red, [s * 0.1, 0.63, 0.45], null, 0.06, false);
    for (const z of [-0.18, 0.18]) P(g, GEO.cyl, wheel, [s * 0.2, 0.09, z], [0, 0, Math.PI / 2], [0.18, 0.05, 0.18]);
    // 身上的紅色雲紋
    P(g, GEO.sphereLo, red, [s * 0.225, 0.38, 0.05], null, [0.03, 0.1, 0.16], false);
  }
  P(g, GEO.sphereLo, body, [0, 0.42, -0.34], null, 0.14);
  P(g, GEO.sphereLo, pink, [0, 0.58, 0.47], null, 0.04, false);
  return g;
}

function mooncakeTable(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.m('#a8744a');
  P(g, GEO.cyl, wood, [0, 0.42, 0], null, [0.9, 0.06, 0.9]);
  P(g, GEO.cyl, wood, [0, 0.2, 0], null, [0.12, 0.4, 0.12]);
  P(g, GEO.cyl, kit.m('#f6f0e4'), [0, 0.47, 0], null, [0.55, 0.03, 0.55]);
  const cake = kit.m('#c8843a', { roughness: 0.6 });
  [[-0.1, 0], [0.1, 0.02], [0, 0.14]].forEach(([x, z], i) => P(g, GEO.cyl, cake, [x, 0.52 + (i === 2 ? 0.06 : 0), z - 0.05], null, [0.16, 0.07, 0.16]));
  P(g, GEO.sphere, kit.m('#c8d860'), [0.26, 0.58, 0.18], null, [0.22, 0.2, 0.22]);
  P(g, GEO.sphere, kit.m('#e6ce5a'), [-0.28, 0.56, 0.16], null, [0.18, 0.17, 0.18]);
  // 茶壺
  P(g, GEO.sphere, kit.m('#6aa0c0'), [0.05, 0.56, -0.26], null, [0.18, 0.15, 0.18]);
  return g;
}

function buildMidautumn(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group, dyn: THREE.Object3D[]): THREE.Vector3 {
  const f = ctx.fest;
  f.hang.forEach((h, i) => {
    const l = chineseLantern(kit, i ? '#f6c83a' : '#f28a22', i ? '#ffc83a' : '#ff9a2a', 0.5, 'round', 1.3, 0.1);
    l.position.copy(h);
    l.userData.dyn = true;
    local.add(l);
    dyn.push(l);
  });
  // 兔子燈放在台階左前方的地上
  const rb = rabbitLantern(kit);
  rb.position.set(-1.2, 0, f.porchZ + 0.45);
  rb.rotation.y = 0.55;
  rb.scale.setScalar(1.3);
  local.add(rb);
  for (const [i, hk] of pathPosts(kit, g, ctx, [ctx.pathZ0 + 2.8, ctx.pathZ0 + 6.4, ctx.pathZ0 + 10, ctx.pathZ0 + 13.4]).entries()) {
    const l = chineseLantern(kit, i % 2 ? '#f6c83a' : '#f28a22', i % 2 ? '#ffc83a' : '#ff9a2a', 0.32, 'round', 1.2, 0.08);
    l.position.copy(hk);
    g.add(l);
  }
  // 賞月小桌
  const table = mooncakeTable(kit);
  const tp = V(ctx.pathX - 2.3, 0, ctx.pathZ0 + 3.2);
  table.position.copy(tp);
  g.add(table);
  return tp;
}

// ---------- 萬聖節 ----------
function jackOLantern(kit: Kit, s: number, face = true): THREE.Group {
  const g = new THREE.Group();
  const skin = kit.lit('#f28a22', '#ff7a10', 0.35, 0, { roughness: 0.55 });
  const faceM = kit.lit('#3a1a08', '#ffb42a', 2.3, 0, { roughness: 0.9 });
  const cy = 0.39 * s;
  P(g, GEO.sphere, skin, [0, cy, 0], null, [s, 0.78 * s, 0.92 * s]);
  for (const sx of [-1, 1]) P(g, GEO.sphere, skin, [sx * 0.24 * s, cy - 0.02 * s, -0.04 * s], [0, sx * 0.3, 0], [0.62 * s, 0.74 * s, 0.8 * s]);
  P(g, GEO.sphere, skin, [0, cy - 0.02 * s, -0.2 * s], null, [0.8 * s, 0.74 * s, 0.6 * s]);
  P(g, GEO.cyl, kit.m('#6a8a3a'), [0.02 * s, 0.8 * s, 0], [0, 0, 0.25], [0.1 * s, 0.22 * s, 0.1 * s]);
  P(g, GEO.sphereLo, kit.m('#5aa23a'), [0.14 * s, 0.78 * s, 0.05 * s], [0, 0, 0.5], [0.2 * s, 0.05 * s, 0.14 * s], false);
  if (face) {
    const tri = new THREE.CircleGeometry(0.1 * s, 3);
    for (const sx of [-1, 1]) P(g, tri, faceM, [sx * 0.15 * s, cy + 0.1 * s, 0.425 * s], [-0.25, sx * 0.3, Math.PI / 2 + (sx > 0 ? 0.2 : -0.2)], null, false);
    P(g, new THREE.CircleGeometry(0.05 * s, 3), faceM, [0, cy + 0.01 * s, 0.458 * s], [-0.1, 0, -Math.PI / 2], null, false);
    const m = new THREE.Shape();
    const mw = 0.22 * s;
    m.moveTo(-mw, 0.03 * s);
    m.quadraticCurveTo(0, -0.1 * s, mw, 0.03 * s);
    m.quadraticCurveTo(mw * 0.6, -0.14 * s, 0.07 * s, -0.12 * s);
    m.lineTo(0.03 * s, -0.07 * s);
    m.lineTo(-0.02 * s, -0.13 * s);
    m.quadraticCurveTo(-mw * 0.6, -0.14 * s, -mw, 0.03 * s);
    P(g, new THREE.ShapeGeometry(m), faceM, [0, cy - 0.05 * s, 0.44 * s], [-0.2, 0, 0], null, false);
  }
  return g;
}

function bat(kit: Kit): { g: THREE.Group; wings: THREE.Object3D[] } {
  const g = new THREE.Group();
  const black = kit.m('#2e2638', { roughness: 0.6 });
  P(g, GEO.sphere, black, [0, 0, 0], null, [0.2, 0.22, 0.18]);
  for (const s of [-1, 1]) {
    P(g, GEO.cone, black, [s * 0.06, 0.12, 0], [0, 0, -s * 0.3], [0.06, 0.1, 0.05], false);
    P(g, GEO.sphereLo, kit.lit('#ffe07a', '#ffd040', 2, 0.6), [s * 0.045, 0.02, 0.085], null, 0.035, false);
  }
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.05);
  wingShape.lineTo(0.34, 0.1);
  wingShape.quadraticCurveTo(0.3, -0.02, 0.22, -0.04);
  wingShape.quadraticCurveTo(0.17, 0.02, 0.12, -0.05);
  wingShape.quadraticCurveTo(0.07, 0.01, 0, -0.04);
  const wg = new THREE.ShapeGeometry(wingShape);
  const wingM = kit.m('#3a3048', { side: THREE.DoubleSide, roughness: 0.7 });
  const wings: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(s * 0.06, 0.02, 0);
    const w = P(pv, wg, wingM, [0, 0, 0], null, [s, 1, 1], false);
    w.castShadow = true;
    pv.userData.side = s;
    g.add(pv);
    wings.push(pv);
  }
  return { g, wings };
}

function buildHalloween(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group, dyn: THREE.Object3D[]): (dt: number, t: number, glow: number) => void {
  const f = ctx.fest;
  const rand = mulberry32(31);
  // 門廊南瓜燈
  for (const [x, s] of [[-f.porchHalf + 0.3, 0.46], [f.porchHalf - 0.3, 0.42], [-f.porchHalf + 0.75, 0.28]] as [number, number][]) {
    const j = jackOLantern(kit, s);
    j.position.set(x, f.porchY, f.porchZ - 0.14);
    j.rotation.y = -x * 0.12;
    local.add(j);
  }
  const step = jackOLantern(kit, 0.32);
  step.position.set(0.62, 0.2, f.porchZ + 0.2);
  local.add(step);
  // 門廊下倒掛的蝙蝠
  const hangers = [...f.hang, f.hang[0].clone().lerp(f.hang[1], 0.5)];
  hangers.forEach((h, i) => {
    const b = bat(kit);
    b.g.position.set(h.x + (i === 2 ? 0 : Math.sign(h.x) * 0.1), h.y - 0.18, h.z);
    b.g.rotation.z = Math.PI;
    b.wings.forEach((w) => (w.rotation.y = (w.userData.side as number) * 1.25));
    b.g.userData.dyn = true;
    b.g.userData.phase = i;
    local.add(b.g);
    dyn.push(b.g);
  });
  // 小徑兩側南瓜燈
  for (let i = 0; i < 10; i++) {
    const s = i % 2 ? 1 : -1;
    const z = ctx.pathZ0 + 1.6 + Math.floor(i / 2) * 2.9 + (s > 0 ? 1.2 : 0);
    const j = jackOLantern(kit, 0.36 + rand() * 0.16);
    j.position.set(ctx.pathX + s * (0.95 + rand() * 0.15), 0, z);
    j.rotation.y = -s * 0.5 + (rand() - 0.5) * 0.3;
    g.add(j);
  }
  // 大門柱上的南瓜
  for (const t of gatePosts(kit, g, ctx, '#5a4a6a')) {
    const j = jackOLantern(kit, 0.34);
    j.position.set(t.x, 2.14, t.z);
    g.add(j);
  }
  // 在屋頂上方繞圈飛的蝙蝠
  const flyers: { g: THREE.Group; wings: THREE.Object3D[]; r: number; p: number; h: number; sp: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const b = bat(kit);
    b.g.userData.dyn = true;
    b.g.scale.setScalar(1.3);
    g.add(b.g);
    flyers.push({ ...b, r: 3.2 + i * 0.8, p: i * 2.1, h: 5.4 + i * 0.5, sp: 0.55 + i * 0.12 });
  }
  const faceM = kit.lit('#3a1a08', '#ffb42a', 2.3, 0, { roughness: 0.9 });
  return (_dt, t, glow) => {
    // 南瓜燈燭火閃爍
    faceM.emissiveIntensity = glow * 2.3 * (0.82 + 0.12 * Math.sin(t * 13) + 0.06 * Math.sin(t * 29 + 1.3));
    for (const d of dyn) {
      const ph = d.userData.phase as number;
      d.rotation.x = Math.sin(t * 1.6 + ph) * 0.12;
    }
    for (const fl of flyers) {
      const a = t * fl.sp + fl.p;
      fl.g.position.set(ctx.houseX + Math.cos(a) * fl.r, fl.h + Math.sin(t * 2 + fl.p) * 0.3, ctx.houseZ + Math.sin(a) * fl.r * 0.7);
      fl.g.rotation.y = -a;
      const flap = Math.sin(t * 16 + fl.p) * 0.8;
      fl.wings.forEach((w) => (w.rotation.y = (w.userData.side as number) * flap));
    }
  };
}

// ---------- 聖誕節 ----------
function giftBox(kit: Kit, w: number, h: number, d: number, col: string, rib: string): THREE.Group {
  const g = new THREE.Group();
  P(g, rbox(w, h, d, 0.03), kit.m(col, { roughness: 0.5 }), [0, h / 2, 0]);
  const r = kit.m(rib, { roughness: 0.4 });
  P(g, rbox(w + 0.02, h + 0.02, 0.07, 0.01), r, [0, h / 2, 0], null, null, false);
  P(g, rbox(0.07, h + 0.02, d + 0.02, 0.01), r, [0, h / 2, 0], null, null, false);
  const bow = new THREE.TorusGeometry(0.07, 0.025, 6, 14);
  for (const s of [-1, 1]) P(g, bow, r, [s * 0.06, h + 0.05, 0], [0, 0, s * 0.5], [1, 1, 1], false);
  return g;
}

function xmasTree(kit: Kit): { g: THREE.Group; star: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const rand = mulberry32(12);
  P(g, GEO.cyl, kit.m('#7a4a2a'), [0, 0.2, 0], null, [0.22, 0.4, 0.22]);
  P(g, GEO.cyl, kit.m('#c8453a'), [0, 0.12, 0], null, [0.5, 0.24, 0.5]);
  const green = kit.m('#2f7a3a', { roughness: 0.8 });
  const tiers = [[1.0, 1.0, 0.8], [0.8, 0.9, 1.35], [0.58, 0.8, 1.85], [0.36, 0.62, 2.3]];
  for (const [r, h, y] of tiers) P(g, GEO.cone, green, [0, y, 0], null, [r * 2, h, r * 2]);
  // 裝飾球
  const balls = ['#e8342c', '#f2c44a', '#4a8ae8', '#e8e8f0', '#e86aa8'];
  for (let i = 0; i < 18; i++) {
    const tr = tiers[i % 3];
    const a = rand() * Math.PI * 2;
    const yy = tr[2] - tr[1] * 0.35;
    const rr = tr[0] * 0.78;
    P(g, GEO.sphereLo, kit.m(balls[i % balls.length], { roughness: 0.25, metalness: 0.3 }), [Math.cos(a) * rr, yy, Math.sin(a) * rr], null, 0.12, false);
  }
  // 螺旋燈串
  const cols: [string, string][] = [['#ffe07a', '#ffc840'], ['#ff6a6a', '#ff4a4a'], ['#7ad0ff', '#4ab0ff'], ['#9aff8a', '#5aff5a']];
  for (let i = 0; i < 34; i++) {
    const t = i / 34;
    const y = 0.45 + t * 2.0;
    const r = (1.0 - (y - 0.3) * 0.4) * 0.92 + 0.04;
    const a = t * Math.PI * 7;
    const [c, e] = cols[i % cols.length];
    P(g, GEO.sphereLo, kit.lit(c, e, 1.8, 0.2, { roughness: 0.3 }), [Math.cos(a) * r, y, Math.sin(a) * r], null, 0.08, false);
  }
  const star = kit.lit('#ffd84a', '#ffc020', 1.8, 0.45, { metalness: 0.3, roughness: 0.35 });
  const sg = new THREE.ExtrudeGeometry(starShape(0.24, 0.1), { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  sg.translate(0, 0, -0.03);
  P(g, sg, star, [0, 2.78, 0]);
  return { g, star };
}

function candyCane(kit: Kit, tex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const m = mat('#ffffff', { map: tex, roughness: 0.35 });
  P(g, new THREE.CylinderGeometry(0.035, 0.035, 0.7, 10), m, [0, 0.35, 0]);
  P(g, new THREE.TorusGeometry(0.09, 0.035, 8, 14, Math.PI), m, [0.09, 0.7, 0], null, null);
  return g;
}

function buildXmas(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group): { tick: (dt: number, t: number, glow: number) => void; block: [number, number][] } {
  const f = ctx.fest;
  // 聖誕樹（房屋右前方）＋禮物
  const tree = xmasTree(kit);
  const tx = ctx.houseX + 3.6, tz = ctx.houseZ + 3.3;
  tree.g.position.set(tx, 0, tz);
  g.add(tree.g);
  const gifts: [number, number, number, number, number, string, string][] = [
    [0.55, 0.36, 0.3, 0.44, 0.4, '#e8342c', '#f2c44a'], [-0.5, 0.3, 0.42, 0.34, 0.34, '#4a8ae8', '#ffffff'],
    [0.1, 0.24, 0.6, 0.3, 0.3, '#5ab84a', '#e8342c'], [-0.15, 0.5, 0.25, 0.36, 0.28, '#f2c44a', '#e8342c'],
  ];
  for (const [x, w, z, h, d, c, r] of gifts) {
    const b = giftBox(kit, w, h, d, c, r);
    b.position.set(tx + x, 0, tz + z);
    b.rotation.y = x * 0.8;
    g.add(b);
  }
  // 屋簷彩色燈串
  const cols: [string, string][] = [['#ff6a6a', '#ff3a3a'], ['#9aff8a', '#4aff4a'], ['#ffe07a', '#ffc020'], ['#7ad0ff', '#3aa8ff']];
  const [ea, eb] = f.eave;
  const mid = ea.clone().lerp(eb, 0.5);
  const set = new Set<THREE.MeshStandardMaterial>();
  for (const [a, b] of [[ea, mid], [mid, eb]]) lightString(kit, local, a.clone().setY(a.y - 0.08), b.clone().setY(b.y - 0.08), 0.22, cols, 1.8, 0.12, 0.28, 0.055).forEach((m) => set.add(m));
  const all = [...set];
  // 門廊吊掛點：紅色蝴蝶結＋松枝
  const bowM = kit.m('#d8342c', { roughness: 0.5 });
  const pine = kit.m('#2f7a3a');
  for (const h of f.hang) {
    for (let i = 0; i < 5; i++) P(local, GEO.sphereLo, pine, [h.x - 0.25 + i * 0.12, h.y - 0.05 - Math.sin((i / 4) * Math.PI) * 0.08, h.z], null, [0.2, 0.12, 0.14], false);
    for (const s of [-1, 1]) P(local, new THREE.TorusGeometry(0.07, 0.03, 6, 14), bowM, [h.x + s * 0.07, h.y - 0.12, h.z + 0.06], [0, 0, s * 0.5], null, false);
  }
  // 小徑拐杖糖
  const tex = canvasTex(64, 256, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8342c';
    for (let y = -64; y < h + 64; y += 48) {
      c.beginPath();
      c.moveTo(0, y); c.lineTo(w, y + 32); c.lineTo(w, y + 52); c.lineTo(0, y + 20);
      c.closePath();
      c.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  for (const z of [ctx.pathZ0 + 2.6, ctx.pathZ0 + 6.2, ctx.pathZ0 + 9.8, ctx.pathZ0 + 13.2]) for (const s of [-1, 1]) {
    const c = candyCane(kit, tex);
    c.position.set(ctx.pathX + s * 0.95, 0, z);
    c.rotation.y = s > 0 ? Math.PI : 0;
    g.add(c);
  }
  for (const t of gatePosts(kit, g, ctx, '#2f7a3a')) {
    P(g, new THREE.TorusGeometry(0.2, 0.07, 8, 18), pine, [t.x, 1.6, t.z + 0.16], null, null);
    P(g, GEO.sphereLo, bowM, [t.x, 1.4, t.z + 0.24], null, [0.16, 0.1, 0.06], false);
  }
  const tick = (_dt: number, t: number, glow: number) => {
    // 燈串一閃一閃
    all.forEach((m, i) => (m.emissiveIntensity = 0.12 + glow * 1.8 * (0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.7))));
    tree.star.emissiveIntensity = 0.45 + glow * 1.8 * (0.8 + 0.2 * Math.sin(t * 3));
  };
  return { tick, block: [[Math.round(tx), Math.round(tz)], [Math.round(tx - 1), Math.round(tz)]] };
}

// ---------- 元旦：彩旗＋煙火架＋夜間煙火 ----------
function fireworksRack(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.m('#a8744a');
  P(g, rbox(0.9, 0.12, 0.5, 0.03), wood, [0, 0.06, 0]);
  for (const s of [-1, 1]) P(g, rbox(0.08, 0.7, 0.45, 0.02), wood, [s * 0.42, 0.4, 0]);
  P(g, rbox(0.9, 0.06, 0.08, 0.02), wood, [0, 0.62, -0.18]);
  const cols = ['#e8342c', '#4a8ae8', '#f2c44a', '#5ab84a', '#a87ad8'];
  cols.forEach((c, i) => {
    const x = -0.3 + i * 0.15;
    P(g, GEO.cyl, kit.m(c, { roughness: 0.5 }), [x, 0.45, 0.02], [-0.25, 0, (i - 2) * 0.08], [0.11, 0.62, 0.11]);
    P(g, GEO.cone, kit.m('#f3e7d3'), [x + (i - 2) * 0.025, 0.8, -0.06], [-0.25, 0, (i - 2) * 0.08], [0.12, 0.12, 0.12], false);
  });
  // 旁邊一箱煙火
  P(g, rbox(0.4, 0.3, 0.32, 0.03), kit.m('#e8342c'), [0.72, 0.15, 0.1]);
  P(g, rbox(0.42, 0.06, 0.34, 0.02), kit.m('#f2c44a'), [0.72, 0.31, 0.1]);
  return g;
}

class Fireworks {
  group = new THREE.Group();
  private timer = 1.5;
  private rand = mulberry32(2027);
  private rockets: { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; age: number; col: THREE.Color }[] = [];
  private bursts: { pts: THREE.Points; vel: Float32Array; age: number }[] = [];
  private rocketMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.6), fog: false });
  constructor(private origin: THREE.Vector3, private center: THREE.Vector3) {}

  update(dt: number, glow: number): void {
    this.timer -= dt;
    if (glow > 0.55 && this.timer <= 0) {
      this.timer = 1.2 + this.rand() * 2.2;
      const to = this.center.clone().add(new THREE.Vector3((this.rand() - 0.5) * 14, 8 + this.rand() * 3, (this.rand() - 0.5) * 8));
      const m = new THREE.Mesh(GEO.sphereLo, this.rocketMat);
      m.scale.setScalar(0.12);
      m.position.copy(this.origin);
      this.group.add(m);
      const hues = [0.0, 0.08, 0.15, 0.33, 0.55, 0.62, 0.8, 0.92];
      this.rockets.push({ m, from: this.origin.clone(), to, age: 0, col: new THREE.Color().setHSL(hues[Math.floor(this.rand() * hues.length)], 0.9, 0.62) });
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      const t = Math.min(1, r.age / 1.1);
      const e = 1 - (1 - t) * (1 - t);
      r.m.position.lerpVectors(r.from, r.to, e);
      r.m.position.x += Math.sin(r.age * 30) * 0.03;
      if (t >= 1) {
        this.group.remove(r.m);
        this.rockets.splice(i, 1);
        this.burst(r.to, r.col);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const pos = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        b.vel[k + 1] -= 1.2 * dt;
        const drag = Math.pow(0.35, dt);
        b.vel[k] *= drag; b.vel[k + 1] *= drag; b.vel[k + 2] *= drag;
        arr[k] += b.vel[k] * dt; arr[k + 1] += b.vel[k + 1] * dt; arr[k + 2] += b.vel[k + 2] * dt;
      }
      pos.needsUpdate = true;
      const mt = b.pts.material as THREE.PointsMaterial;
      mt.opacity = Math.max(0, 1 - Math.pow(b.age / 2.2, 2));
      mt.size = 0.5 * (1 - b.age / 3);
      if (b.age > 2.2) {
        this.group.remove(b.pts);
        b.pts.geometry.dispose();
        mt.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private burst(at: THREE.Vector3, col: THREE.Color): void {
    const n = 120;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), cols = new Float32Array(n * 3);
    const c2 = col.clone().offsetHSL(0.1, 0, 0.1);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      const u = this.rand() * 2 - 1, a = this.rand() * Math.PI * 2, s = 4.2 + this.rand() * 1.2;
      const q = Math.sqrt(1 - u * u);
      vel[i * 3] = Math.cos(a) * q * s; vel[i * 3 + 1] = u * s; vel[i * 3 + 2] = Math.sin(a) * q * s;
      const c = i % 3 ? col : c2;
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.PointsMaterial({ size: 0.5, vertexColors: true, color: new THREE.Color(3.2, 3.2, 3.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(geo, m);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.bursts.push({ pts, vel, age: 0 });
  }
}

function buildNewyear(kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group): { tick: (dt: number, t: number, glow: number) => void; block: [number, number][] } {
  const f = ctx.fest;
  const cols = ['#e8342c', '#f2c44a', '#4a8ae8', '#5ab84a', '#e86aa8', '#a87ad8'];
  const [ea, eb] = f.eave;
  bunting(kit, local, ea, eb, cols, 0.35, 0.28);
  bunting(kit, local, f.hang[0].clone().setX(-f.porchHalf), f.hang[1].clone().setX(f.porchHalf), cols.slice().reverse(), 0.2, 0.22);
  const tops = gatePosts(kit, g, ctx, '#4a6ab8', 2.8);
  const happy = canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#2a3a8a';
    c.fillRect(0, 0, w, h);
    c.font = `bold 78px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const txt = '新年快樂';
    const grad = c.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#ffd84a'); grad.addColorStop(0.5, '#ff8ac0'); grad.addColorStop(1, '#8ad8ff');
    c.fillStyle = grad;
    c.fillText(txt, w / 2, h / 2 + 4);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 18; i++) c.fillRect((i * 97) % w, (i * 53) % h, 4, 4);
  });
  banner(g, tops[0], tops[1], 2.45, happy, 0.36, kit, '#f2c44a');
  bunting(kit, g, tops[0].clone().setY(1.95), tops[1].clone().setY(1.95), cols, 0.3, 0.24);
  const rp = V(ctx.pathX + 1.9, 0, ctx.gateZ - 1.8);
  const rack = fireworksRack(kit);
  rack.position.copy(rp);
  rack.rotation.y = -0.4;
  g.add(rack);
  const fw = new Fireworks(rp.clone().setY(0.9), V(ctx.pathX, 0, ctx.houseZ + 8));
  fw.group.userData.dyn = true;
  g.add(fw.group);
  return { tick: (dt, _t, glow) => fw.update(dt, glow), block: [[Math.round(rp.x), Math.round(rp.z)]] };
}

// ---------- 其他節慶：主題彩旗＋一兩個主題道具 ----------
function flowerArch(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const white = kit.m('#f6f0e4');
  const rand = mulberry32(5);
  for (const s of [-1, 1]) P(g, rbox(0.1, 1.9, 0.1, 0.03), white, [s * 1.25, 0.95, 0]);
  P(g, new THREE.TorusGeometry(1.25, 0.05, 6, 28, Math.PI), white, [0, 1.9, 0]);
  const cols = ['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff', '#ff9a4a', '#f4b6cf'];
  const leaf = kit.m('#5fbf49');
  for (let i = 0; i < 46; i++) {
    let x: number, y: number;
    if (i < 26) { const a = (i / 25) * Math.PI; x = Math.cos(a) * 1.25; y = 1.9 + Math.sin(a) * 1.25; }
    else { const s = i % 2 ? 1 : -1; x = s * 1.25; y = 0.3 + rand() * 1.6; }
    P(g, GEO.ico, leaf, [x + (rand() - 0.5) * 0.12, y + (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.16], null, 0.16 + rand() * 0.08, false);
    P(g, GEO.sphereLo, kit.m(cols[i % cols.length]), [x + (rand() - 0.5) * 0.16, y + (rand() - 0.5) * 0.16, 0.06 + (rand() - 0.5) * 0.12], null, 0.12 + rand() * 0.06, false);
  }
  return g;
}

function flowerPot(kit: Kit, cols: string[], carnation = false): THREE.Group {
  const g = new THREE.Group();
  P(g, new THREE.CylinderGeometry(0.2, 0.15, 0.3, 14), kit.m('#c8704a'), [0, 0.15, 0]);
  P(g, GEO.cyl, kit.m('#5a3a22'), [0, 0.29, 0], null, [0.36, 0.02, 0.36], false);
  const stem = kit.m('#4f9a3a');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = i ? 0.1 : 0;
    const top = V(Math.cos(a) * r * 1.4, 0.62 + (i % 3) * 0.06, Math.sin(a) * r * 1.4);
    stick(g, V(Math.cos(a) * r * 0.5, 0.3, Math.sin(a) * r * 0.5), top, 0.012, stem, false);
    const c = kit.m(cols[i % cols.length]);
    if (carnation) {
      for (let k = 0; k < 3; k++) P(g, GEO.sphereLo, c, [top.x, top.y + k * 0.025, top.z], [0, k, 0], [0.14 - k * 0.03, 0.06, 0.14 - k * 0.03], false);
    } else P(g, GEO.sphereLo, c, [top.x, top.y, top.z], null, 0.12, false);
  }
  return g;
}

function mugwort(kit: Kit): THREE.Group {
  // 艾草束：倒掛在門邊，紅繩綁住
  const g = new THREE.Group();
  const leafA = kit.m('#5f9a4a'), leafB = kit.m('#7ab85a');
  for (let i = 0; i < 9; i++) {
    const a = (i - 4) * 0.09;
    P(g, GEO.cone, i % 2 ? leafA : leafB, [Math.sin(a) * 0.25, -0.3, 0.01 * i], [0, 0, Math.PI + a], [0.07, 0.62, 0.03], false);
  }
  P(g, new THREE.TorusGeometry(0.05, 0.018, 6, 12), kit.m('#d8342c'), [0, -0.02, 0.02], null, null, false);
  return g;
}

function zongziString(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const leaf = kit.m('#6aa84a', { roughness: 0.7 });
  const tie = kit.m('#e8d4a8');
  stick(g, V(0, 0, 0), V(0, -0.2, 0), 0.008, tie, false);
  const tet = new THREE.TetrahedronGeometry(0.13);
  [[-0.1, -0.3], [0.1, -0.34], [0, -0.52]].forEach(([x, y], i) => {
    stick(g, V(0, -0.2, 0), V(x, y + 0.08, 0), 0.006, tie, false);
    P(g, tet, leaf, [x, y, 0], [0.6, i, 0.3]);
  });
  // 香包
  P(g, GEO.sphere, kit.m('#e8342c'), [0, -0.72, 0], null, [0.14, 0.18, 0.08]);
  P(g, GEO.cyl, kit.m('#f2c44a'), [0, -0.87, 0], null, [0.03, 0.14, 0.03], false);
  return g;
}

function stripeTex(): THREE.CanvasTexture {
  return canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = '#7ac24a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f6a2a';
    for (let x = 0; x < w; x += 32) {
      c.beginPath();
      for (let y = 0; y <= h; y += 4) c.lineTo(x + 8 + Math.sin(y * 0.4) * 3, y);
      for (let y = h; y >= 0; y -= 4) c.lineTo(x + 20 + Math.sin(y * 0.4) * 3, y);
      c.fill();
    }
  });
}

function melonCart(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.m('#b98a5e'), dark = kit.m('#8a5a3a');
  P(g, rbox(1.3, 0.1, 0.75, 0.03), wood, [0, 0.45, 0]);
  for (const s of [-1, 1]) {
    P(g, rbox(1.3, 0.26, 0.06, 0.02), wood, [0, 0.6, s * 0.36]);
    P(g, GEO.cyl, dark, [-0.2, 0.3, s * 0.45], [Math.PI / 2, 0, 0], [0.58, 0.06, 0.58]);
    P(g, GEO.cyl, kit.m('#c8a06a'), [-0.2, 0.3, s * 0.49], [Math.PI / 2, 0, 0], [0.16, 0.02, 0.16], false);
    stick(g, V(0.65, 0.5, s * 0.3), V(1.15, 0.28, s * 0.3), 0.03, dark);
  }
  P(g, rbox(0.06, 0.26, 0.75, 0.02), wood, [-0.62, 0.6, 0]);
  P(g, rbox(0.1, 0.3, 0.1, 0.02), dark, [0.45, 0.15, 0]);
  const skin = mat('#ffffff', { map: stripeTex(), roughness: 0.4 });
  [[-0.35, 0.72, -0.15], [0.05, 0.72, -0.17], [-0.3, 0.72, 0.18], [0.1, 0.72, 0.16], [-0.12, 0.98, 0]].forEach(([x, y, z], i) => P(g, GEO.sphere, skin, [x, y, z], [0, i * 0.7, 0.2 * (i % 2)], [0.42, 0.36, 0.36]));
  // 切開的一片
  const slice = new THREE.Group();
  P(slice, new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16, 1, false, 0, Math.PI), kit.m('#3f8a3a'), [0, 0, 0], [Math.PI / 2, 0, 0]);
  P(slice, new THREE.CylinderGeometry(0.17, 0.17, 0.065, 16, 1, false, 0, Math.PI), kit.m('#ff5a5a'), [0, 0.012, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) P(slice, GEO.sphereLo, kit.m('#2a1c18'), [-0.08 + i * 0.055, 0.05 + (i % 2) * 0.03, 0.04], null, [0.02, 0.03, 0.01], false);
  slice.position.set(0.42, 0.72, 0.12);
  slice.rotation.set(-0.3, -0.4, 0);
  g.add(slice);
  return g;
}

function starGarland(kit: Kit, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, droop: number): void {
  const pts = sag(a, b, droop, 16);
  cord(parent, pts, kit.m('#c8c0e8'), 0.01);
  const curve = new THREE.CatmullRomCurve3(pts);
  const sg = new THREE.ExtrudeGeometry(starShape(0.1, 0.045), { depth: 0.03, bevelEnabled: false });
  const cols: [string, string][] = [['#ffe07a', '#ffd040'], ['#ffffff', '#e0e8ff'], ['#c8a8ff', '#a888ff']];
  const n = Math.max(3, Math.round(a.distanceTo(b) / 0.34));
  for (let i = 1; i < n; i++) {
    const p = curve.getPointAt(i / n);
    const [c, e] = cols[i % 3];
    P(parent, sg, kit.lit(c, e, 1.6, 0.25), [p.x, p.y - 0.1, p.z], [0, 0, i * 0.4], null, false);
  }
}

function magpie(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const black = kit.m('#26263a'), white = kit.m('#f6f6fa');
  P(g, GEO.sphere, black, [0, 0.12, 0], null, [0.18, 0.16, 0.26]);
  P(g, GEO.sphere, white, [0, 0.09, 0.02], null, [0.16, 0.12, 0.2], false);
  P(g, GEO.sphere, black, [0, 0.24, 0.1], null, 0.13);
  P(g, GEO.cone, kit.m('#3a3a4a'), [0, 0.23, 0.2], [Math.PI / 2, 0, 0], [0.04, 0.08, 0.04], false);
  P(g, rbox(0.06, 0.03, 0.26, 0.01), black, [0, 0.14, -0.22], [0.3, 0, 0], null, false);
  return g;
}

function cornSheaf(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const stalk = kit.m('#d9b25a', { roughness: 0.9 }), stalk2 = kit.m('#c8a04a', { roughness: 0.9 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tilt = 0.14;
    const base = V(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
    const tie = V(Math.cos(a) * 0.05, 0.55, Math.sin(a) * 0.05);
    const top = V(Math.cos(a) * (0.18 + tilt), 1.35, Math.sin(a) * (0.18 + tilt));
    stick(g, base, tie, 0.022, i % 2 ? stalk : stalk2);
    stick(g, tie, top, 0.018, i % 2 ? stalk : stalk2);
    if (i % 3 === 0) P(g, GEO.cone, stalk, [top.x * 1.1, 1.3, top.z * 1.1], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], [0.06, 0.4, 0.02], false);
  }
  P(g, GEO.cyl, kit.m('#a8322a'), [0, 0.55, 0], null, [0.18, 0.08, 0.18]);
  for (const s of [-1, 1]) P(g, GEO.sphere, kit.m('#f2c44a', { roughness: 0.6 }), [s * 0.22, 0.2, 0.18], [0.3, 0, s * 0.35], [0.1, 0.3, 0.1]);
  return g;
}

function hayAndPumpkins(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const hay = kit.m('#e2bd55', { roughness: 0.95 });
  P(g, rbox(0.9, 0.5, 0.55, 0.12), hay, [0, 0.25, 0]);
  P(g, rbox(0.9, 0.5, 0.55, 0.12), hay, [0.15, 0.75, 0.02], [0, 0.3, 0]);
  const pk = kit.m('#f07a22', { roughness: 0.55 });
  [[0.65, 0.22, 0.1, 0.46], [-0.6, 0.2, 0.18, 0.4], [0.2, 1.12, 0.05, 0.3], [0.5, 0.16, -0.35, 0.3]].forEach(([x, y, z, s]) => {
    P(g, GEO.sphere, pk, [x, y, z], null, [s, s * 0.78, s * 0.9]);
    P(g, GEO.cyl, kit.m('#6a8a3a'), [x, y + s * 0.42, z], null, [0.05, 0.12, 0.05], false);
  });
  return g;
}

function tangyuanSign(kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const wood = kit.m('#a8744a');
  P(g, rbox(0.1, 1.3, 0.1, 0.03), wood, [0, 0.65, 0]);
  P(g, rbox(1.0, 0.7, 0.06, 0.04), kit.m('#8a5a3a'), [0, 1.3, 0.02]);
  const tex = canvasTex(320, 224, (c, w, h) => {
    c.fillStyle = '#fff4e4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#d86a8a';
    c.font = `bold 44px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.fillText('冬至 吃湯圓', w / 2, 52);
    // 碗
    c.fillStyle = '#6aa0c0';
    c.beginPath(); c.ellipse(w / 2, 130, 90, 20, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(w / 2 - 90, 130); c.quadraticCurveTo(w / 2, 240, w / 2 + 90, 130); c.fill();
    const balls: [number, number, string][] = [[-40, 122, '#ffffff'], [0, 116, '#ffb0c8'], [40, 122, '#ffffff'], [-18, 128, '#ffb0c8'], [22, 130, '#ffffff']];
    for (const [x, y, col] of balls) { c.fillStyle = col; c.beginPath(); c.arc(w / 2 + x, y, 20, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#c8c8d0'; c.lineWidth = 5;
    for (const x of [-30, 0, 30]) { c.beginPath(); c.moveTo(w / 2 + x, 92); c.quadraticCurveTo(w / 2 + x + 12, 80, w / 2 + x, 66); c.stroke(); }
  });
  texPlane(g, tex, 0.9, 0.62, [0, 1.3, 0.056]);
  // 小凳子上一碗湯圓
  const stool = new THREE.Group();
  P(stool, GEO.cyl, wood, [0, 0.36, 0], null, [0.5, 0.06, 0.5]);
  for (const a of [0.8, 2.9, 5]) P(stool, GEO.cyl, wood, [Math.cos(a) * 0.16, 0.17, Math.sin(a) * 0.16], null, [0.05, 0.34, 0.05]);
  P(stool, new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.m('#e8eef8', { side: THREE.DoubleSide }), [0, 0.58, 0]);
  const soup = kit.m('#f6e8d4');
  P(stool, GEO.cyl, soup, [0, 0.55, 0], null, [0.36, 0.01, 0.36], false);
  [[-0.06, -0.04, '#ffffff'], [0.06, 0.02, '#ffb0c8'], [0, 0.07, '#ffffff'], [-0.04, 0.06, '#ffb0c8']].forEach(([x, z, c]) => P(stool, GEO.sphereLo, kit.m(c as string), [x as number, 0.57, z as number], null, 0.08, false));
  stool.position.set(0.7, 0, 0.1);
  g.add(stool);
  return g;
}

function buildGeneric(id: FestivalId, kit: Kit, ctx: FestCtx, local: THREE.Group, g: THREE.Group, dyn: THREE.Object3D[]): { block: [number, number][] } {
  const f = ctx.fest;
  const palettes: Partial<Record<FestivalId, string[]>> = {
    flower: ['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff'],
    mother: ['#e8708a', '#ffb0c8', '#ffffff', '#d8342c'],
    dragonboat: ['#3f9a5a', '#f2c44a', '#e8342c', '#4a8ae8'],
    watermelon: ['#e8484a', '#5ab84a', '#ffffff', '#2f6a2a'],
    qixi: ['#6a5acd', '#a8a0ff', '#ff9ac8', '#4a4a9a'],
    harvest: ['#c8902c', '#e8603a', '#f2c44a', '#8a5a3a'],
    solstice: ['#d86a8a', '#ffffff', '#ffb0c8', '#6aa0c0'],
  };
  const cols = palettes[id] ?? ['#e8342c', '#f2c44a'];
  const [ea, eb] = f.eave;
  const block: [number, number][] = [];
  if (id === 'qixi') {
    const mid = ea.clone().lerp(eb, 0.5);
    starGarland(kit, local, ea, mid, 0.25);
    starGarland(kit, local, mid, eb, 0.25);
  } else bunting(kit, local, ea, eb, cols, 0.35, 0.28);
  const tops = gatePosts(kit, g, ctx, id === 'qixi' ? '#4a4a8a' : '#a8744a');
  if (id === 'qixi') starGarland(kit, g, tops[0], tops[1], 0.4);
  else bunting(kit, g, tops[0], tops[1], cols, 0.35, 0.24);
  const zp = ctx.pathZ0;
  switch (id) {
    case 'flower': {
      for (const z of [zp + 2.4, ctx.gateZ - 1.4]) {
        const a = flowerArch(kit);
        a.position.set(ctx.pathX, 0, z);
        g.add(a);
      }
      for (const s of [-1, 1]) {
        const p = flowerPot(kit, s > 0 ? ['#ff7aa8', '#ffd84a'] : ['#b28cff', '#ffffff']);
        p.position.set(s * (f.porchHalf - 0.3), f.porchY, f.porchZ - 0.14);
        local.add(p);
      }
      break;
    }
    case 'mother': {
      for (const s of [-1, 1]) {
        const p = flowerPot(kit, ['#e8342c', '#ff8aa8', '#ffffff'], true);
        p.position.set(s * (f.porchHalf - 0.3), f.porchY, f.porchZ - 0.14);
        local.add(p);
        const p2 = flowerPot(kit, ['#ff8aa8', '#e8342c'], true);
        p2.position.set(s * 1.05, 0, f.porchZ + 0.5);
        p2.scale.setScalar(0.85);
        local.add(p2);
      }
      const hs = heartShape();
      const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      P(local, hg, kit.m('#ff7aa0', { roughness: 0.45 }), [0, f.doorTop - 0.62, f.fz + 0.16], null, 0.5);
      break;
    }
    case 'dragonboat': {
      for (const s of [-1, 1]) {
        const m = mugwort(kit);
        m.position.set(s * (f.doorHalf + 0.2), f.doorTop - 0.05, f.fz + 0.13);
        m.rotation.z = s * 0.12;
        local.add(m);
      }
      f.hang.forEach((h, i) => {
        const z = zongziString(kit);
        z.position.copy(h);
        z.userData.dyn = true;
        z.userData.phase = i;
        local.add(z);
        dyn.push(z);
      });
      break;
    }
    case 'watermelon': {
      const c = melonCart(kit);
      const cx = ctx.pathX - 2.3, cz = zp + 4.9;
      c.position.set(cx, 0, cz);
      c.rotation.y = -Math.PI / 2 + 0.3;
      g.add(c);
      block.push([Math.round(cx), Math.round(cz)], [Math.round(cx - 0.6), Math.round(cz)]);
      break;
    }
    case 'qixi': {
      f.hang.forEach((h) => {
        const sg = new THREE.ExtrudeGeometry(starShape(0.22, 0.1), { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
        const st = new THREE.Group();
        stick(st, V(0, 0, 0), V(0, -0.2, 0), 0.006, kit.m('#c8c0e8'), false);
        P(st, sg, kit.lit('#ffe07a', '#ffd040', 1.7, 0.3), [0, -0.42, 0]);
        st.position.copy(h);
        st.userData.dyn = true;
        st.userData.phase = h.x;
        local.add(st);
        dyn.push(st);
      });
      tops.forEach((t, i) => {
        const b = magpie(kit);
        b.position.set(t.x, 2.14, t.z);
        b.rotation.y = i ? -Math.PI / 2 - 0.3 : Math.PI / 2 + 0.3;
        g.add(b);
      });
      break;
    }
    case 'harvest': {
      for (const s of [-1, 1]) {
        const c = cornSheaf(kit);
        c.position.set(s * (f.porchHalf + 0.25), 0, f.porchZ - 0.2);
        local.add(c);
        const c2 = cornSheaf(kit);
        c2.position.set(tops[s > 0 ? 1 : 0].x + s * 0.35, 0, ctx.gateZ - 0.4);
        c2.scale.setScalar(0.85);
        g.add(c2);
      }
      const hp = hayAndPumpkins(kit);
      const hx = ctx.pathX - 2.2, hz = zp + 3.0;
      hp.position.set(hx, 0, hz);
      hp.rotation.y = 0.3;
      g.add(hp);
      block.push([Math.round(hx), Math.round(hz)]);
      break;
    }
    case 'solstice': {
      const s = tangyuanSign(kit);
      s.position.set(ctx.pathX - 1.6, 0, zp + 1.8);
      s.rotation.y = 0.35;
      g.add(s);
      block.push([Math.round(ctx.pathX - 1.6), Math.round(zp + 1.8)]);
      break;
    }
    default:
      break;
  }
  return { block };
}

// 建立某個節慶的全部裝飾
export function buildFestival(id: FestivalId, ctx: FestCtx): Deco {
  const kit = new Kit();
  const local = new THREE.Group(); // 掛在房屋上
  const group = new THREE.Group(); // 世界座標（小徑、大門）
  const dyn: THREE.Object3D[] = [];
  let tick: Deco['tick'];
  let block: [number, number][] = [];
  switch (id) {
    case 'cny': buildCny(kit, ctx, local, group, dyn); break;
    case 'lantern': buildLantern(kit, ctx, local, group, dyn); break;
    case 'midautumn': { const tp = buildMidautumn(kit, ctx, local, group, dyn); block = [[Math.round(tp.x), Math.round(tp.z)]]; break; }
    case 'halloween': tick = buildHalloween(kit, ctx, local, group, dyn); break;
    case 'xmas': { const r = buildXmas(kit, ctx, local, group); tick = r.tick; block = r.block; break; }
    case 'newyear': { const r = buildNewyear(kit, ctx, local, group); tick = r.tick; block = r.block; break; }
    default: block = buildGeneric(id, kit, ctx, local, group, dyn).block; break;
  }
  bake(local);
  bake(group);
  // 會搖的吊飾（燈籠、粽子、星星）；萬聖節自己處理
  const sway = id === 'halloween' ? null : dyn;
  const inner = tick;
  const all = (dt: number, t: number, glow: number) => {
    if (sway) sway.forEach((d, i) => { d.rotation.z = Math.sin(t * 1.3 + i * 1.7) * 0.06; d.rotation.x = Math.sin(t * 0.9 + i) * 0.04; });
    inner?.(dt, t, glow);
  };
  return { group, local, glow: kit.glow, tick: all, block };
}
