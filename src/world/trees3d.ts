import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import { mat, withWind } from './materials';

// 風格化樹木：凹凸的葉團疊成蓬鬆樹冠（下暗上亮的頂點色做出樹冠內的陰影），彎曲漸細的樹幹＋分枝
// 闊葉樹冬天落葉只剩枝幹；松樹常綠、冬天頂上積雪

export type TreeKind = 'round' | 'pine';

// 3D 雜訊（位置決定，所以共用頂點的位移一致，不會裂開）
const noise3 = (x: number, y: number, z: number, s: number) =>
  Math.sin(x * 3.1 + s) * 0.5 + Math.sin(y * 4.3 + s * 1.7) * 0.3 + Math.sin(z * 3.7 + s * 2.3) * 0.4 + Math.sin((x + z) * 6.1 + y * 2.3 + s) * 0.2;

// 凹凸的葉團：icosahedron 沿法線位移＋頂點色（底部暗、頂部亮）
const clumpCache = new Map<number, THREE.BufferGeometry>();
export function clumpGeo(variant: number): THREE.BufferGeometry {
  const key = variant % 6;
  let g = clumpCache.get(key);
  if (g) return g;
  // 先合併重複頂點，法線才會是平滑的（柔和的皮克斯感，不是一面一面的低多邊形）
  const ico = new THREE.IcosahedronGeometry(0.5, 3);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  g = mergeVertices(ico);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1 + noise3(n.x, n.y, n.z, key * 1.9) * 0.13;
    v.copy(n).multiplyScalar(0.5 * d);
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.6; // 底部壓平
    pos.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.58 + 0.52 * THREE.MathUtils.smoothstep(v.y, -0.35, 0.45) + noise3(v.x * 2, v.y * 2, v.z * 2, key) * 0.03;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  clumpCache.set(key, g);
  return g;
}

// 樹幹：漸細、微彎、根部外擴，頂點色從根部暗到上面亮
function trunkGeo(h: number, r0: number, r1: number, bend: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 9, 6, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = y / h;
    const flare = 1 + Math.max(0, 0.18 - t) * 2.4; // 根部張開
    const ox = Math.sin(t * 2.2 + seed) * bend * t, oz = Math.cos(t * 1.7 + seed) * bend * 0.6 * t;
    pos.setXYZ(i, x * flare + ox, y, z * flare + oz);
    const s = 0.72 + 0.35 * t;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function branchGeo(from: THREE.Vector3, to: THREE.Vector3, r: number): THREE.BufferGeometry {
  const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.15, 0));
  const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 5, r, 6, false);
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.9), 3));
  return g;
}

// 樹共用的材質：顏色跟著季節換（頂點色只負責明暗）
export class TreeMats {
  leaves = ['#4fae3f', '#5fbf49', '#3f9a36'].map((c) => withWind(mat(c, { roughness: 0.85, vertexColors: true }), 0.02));
  pine = withWind(mat('#3f7a4a', { roughness: 0.85, vertexColors: true }), 0.015);
  bark = mat('#7a5236', { roughness: 0.95, vertexColors: true });
  snow = mat('#f7fbff', { roughness: 0.8 });

  setSeason(leafColors: string[]): void {
    this.leaves.forEach((m, i) => m.color.set(leafColors[i % leafColors.length]));
  }
}

// 效能：把同一個群組裡、同材質的網格合併成一個（每棵樹從 30 幾個 draw call 降到個位數）
function bake(parent: THREE.Object3D): void {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of [...parent.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.children.length) continue;
    const mat = m.material as THREE.Material;
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat)!.push(m);
  }
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const geos = list.map((m) => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = list[0].castShadow;
    out.receiveShadow = true;
    for (const m of list) parent.remove(m);
    parent.add(out);
  }
}

export interface TreeParts { group: THREE.Group; canopy: THREE.Group; bare: THREE.Group; snow: THREE.Group; kind: TreeKind }

export function buildTree(seed: number, mats: TreeMats, kind: TreeKind = 'round'): TreeParts {
  const rand = mulberry32(1000 + seed * 17);
  const group = new THREE.Group();
  const canopy = new THREE.Group();
  const bare = new THREE.Group();
  const snow = new THREE.Group();
  group.add(canopy, bare, snow);
  const addMesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const x = new THREE.Mesh(geo, m);
    x.castShadow = shadow;
    x.receiveShadow = true;
    parent.add(x);
    return x;
  };

  if (kind === 'pine') {
    addMesh(group, trunkGeo(1.3, 0.2, 0.12, 0.05, seed), mats.bark);
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const r = 1.35 - k * 0.28, h = 1.25 - k * 0.12, y = 0.85 + k * 0.72;
      const cone = new THREE.ConeGeometry(r, h, 11, 3);
      const pos = cone.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const wob = 1 + (yy < -h * 0.3 ? Math.sin(a * 7 + k) * 0.12 : 0); // 下緣做出鋸齒
        pos.setXYZ(i, x * wob, yy - (yy < -h * 0.3 ? Math.abs(Math.sin(a * 7 + k)) * 0.08 : 0), z * wob);
        const s = 0.6 + 0.5 * ((yy + h / 2) / h);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
      }
      cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
      cone.computeVertexNormals();
      const m = addMesh(canopy, cone, mats.pine);
      m.position.y = y + h / 2;
      // 冬天：每層上面蓋一點雪
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, h * 0.5, 11, 1), mats.snow);
      cap.position.y = y + h * 0.78;
      cap.castShadow = false;
      snow.add(cap);
    }
    bare.visible = false;
    snow.visible = false;
    [group, canopy, bare, snow].forEach(bake);
    const s = 0.9 + rand() * 0.35;
    group.scale.set(s, s * (0.95 + rand() * 0.2), s);
    return { group, canopy, bare, snow, kind };
  }

  // ---- 闊葉樹 ----
  const h = 1.7 + rand() * 0.4;
  addMesh(group, trunkGeo(h, 0.27, 0.14, 0.12, seed), mats.bark);
  const top = new THREE.Vector3(Math.sin(2.2 + seed) * 0.12, h, Math.cos(1.7 + seed) * 0.07);
  // 分枝：伸進樹冠裡；冬天露出來的也是這些
  const nb = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rand() * 0.5;
    const from = new THREE.Vector3(top.x * 0.8, h * (0.62 + rand() * 0.3), top.z * 0.8);
    const to = new THREE.Vector3(Math.cos(a) * (0.8 + rand() * 0.4), h + 0.6 + rand() * 0.6, Math.sin(a) * (0.8 + rand() * 0.4));
    addMesh(group, branchGeo(from, to, 0.07), mats.bark);
    // 冬天才看得到的小枝
    for (let j = 0; j < 2; j++) {
      const b = (rand() - 0.5) * 1.4;
      const tip = to.clone().add(new THREE.Vector3(Math.cos(a + b) * 0.45, 0.35 + rand() * 0.3, Math.sin(a + b) * 0.45));
      addMesh(bare, branchGeo(to, tip, 0.035), mats.bark, false);
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mats.snow);
      sn.scale.set(1.6, 0.6, 1.6);
      sn.position.copy(tip);
      snow.add(sn);
    }
  }
  // 樹冠：中心一大團＋沿著橢球面排的葉團，上面多下面少
  const cy = h + 0.95;
  const R = { x: 1.35, y: 1.05, z: 1.35 };
  const core = addMesh(canopy, clumpGeo(seed), mats.leaves[0]);
  core.scale.set(2.3, 1.9, 2.3);
  core.position.set(0, cy, 0);
  const n = 15 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    // 黃金角分布在上半球＋腰部
    const u = (i + 0.5) / n;
    const phi = Math.acos(1 - 1.35 * u);
    const th = i * 2.399 + rand() * 0.3;
    const dx = Math.sin(phi) * Math.cos(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.sin(th);
    const c = addMesh(canopy, clumpGeo(seed + i), mats.leaves[(i + seed) % 3]);
    const s = 0.95 + rand() * 0.45;
    c.scale.set(s * 1.15, s, s * 1.15);
    c.position.set(dx * R.x * 0.78, cy + dy * R.y * 0.72 - 0.05, dz * R.z * 0.78);
    c.rotation.y = rand() * Math.PI;
  }
  bare.visible = false;
  snow.visible = false;
  [group, canopy, bare, snow].forEach(bake);
  const s = 0.9 + rand() * 0.25;
  group.scale.setScalar(s);
  return { group, canopy, bare, snow, kind };
}

// 換季：闊葉樹冬天落葉（露出枝幹＋積雪）；松樹冬天頂上積雪
export function setTreeSeason(t: TreeParts, season: string): void {
  const winter = season === 'winter';
  if (t.kind === 'pine') { t.snow.visible = winter; return; }
  t.canopy.visible = !winter;
  t.bare.visible = winter;
  t.snow.visible = winter;
}
