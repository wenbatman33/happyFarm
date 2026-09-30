import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { GEO, mat, mesh, withWind } from './materials';
import { bakeGroup } from './bake';

export type WeedKind = 'sprout' | 'bush' | 'big' | 'dandelion' | 'leaves' | 'snow';

// 雜草要一眼跟草皮分開：飽和的深綠色、成叢的長葉＋狗尾草穗，底下只有柔和的接地陰影（不再是一塊泥土）
// 草葉合併成一個幾何（頂點色：根部深綠 → 草尖黃綠），每株只有少數幾個 draw call
const BLADE_MAT = withWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }), 0.45);
const M = {
  leaf: withWind(mat('#3fae33', { roughness: 0.55 }), 0.4),
  leafDark: withWind(mat('#2b8a2a', { roughness: 0.6 }), 0.4),
  stem: withWind(mat('#5a9a34', { roughness: 0.7 }), 0.5),
  spike: withWind(mat('#b9cf62', { roughness: 0.85 }), 0.5),
  yellow: withWind(mat('#ffd23a', { roughness: 0.45, emissive: '#ffb000', emissiveIntensity: 0.18 }), 0.5),
  puff: withWind(mat('#ffffff', { roughness: 0.9, transparent: true, opacity: 0.85 }), 0.6),
  leafA: mat('#f08a3c', { roughness: 0.75 }),
  leafB: mat('#e05a38', { roughness: 0.75 }),
  leafC: mat('#f4bc48', { roughness: 0.75 }),
  leafD: mat('#b8552e', { roughness: 0.8 }),
  twig: mat('#7a5436', { roughness: 0.9 }),
  snow: mat('#f7fbff', { roughness: 0.75 }),
};

// 接地陰影：放射狀漸層的小圓片
const shadowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(30,40,15,0.55)');
  g.addColorStop(0.6, 'rgba(30,40,15,0.25)');
  g.addColorStop(1, 'rgba(30,40,15,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const SHADOW_MAT = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const SHADOW_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function contactShadow(g: THREE.Group, r: number) {
  const s = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  s.scale.set(r * 2, 1, r * 2);
  s.position.y = 0.012;
  s.renderOrder = 1;
  g.add(s);
}

// 一叢草葉：n 片彎曲收尖的長葉，從中心往外開（像芒草／牛筋草）
interface ClumpOpt { n: number; hMin: number; hMax: number; width: number; leanMin: number; leanMax: number; spread: number; base: string; tip: string }
function bladeClump(rand: () => number, o: ClumpOpt): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cb = new THREE.Color(o.base), ct = new THREE.Color(o.tip), c = new THREE.Color();
  const seg = 5;
  for (let b = 0; b < o.n; b++) {
    const h = o.hMin + rand() * (o.hMax - o.hMin);
    const w = o.width * (0.75 + rand() * 0.5);
    const yaw = (b / o.n) * Math.PI * 2 + rand() * 0.8;
    const lean = o.leanMin + rand() * (o.leanMax - o.leanMin);
    const r0 = Math.sqrt(rand()) * o.spread;
    const ox = Math.cos(yaw) * r0, oz = Math.sin(yaw) * r0;
    const dir = new THREE.Vector2(Math.cos(yaw), Math.sin(yaw));
    const side = new THREE.Vector2(-dir.y, dir.x);
    const start = pos.length / 3;
    const tipTint = rand() * 0.25;
    for (let j = 0; j <= seg; j++) {
      const t = j / seg;
      // 往外彎：水平位移隨高度平方增加
      const out = lean * h * t * t;
      const y = h * t * (1 - 0.35 * lean * t);
      const half = j === seg ? 0 : (w * 0.5) * Math.pow(1 - t, 0.6);
      const cx = ox + dir.x * out, cz = oz + dir.y * out;
      c.copy(cb).lerp(ct, Math.min(1, t * 1.1 + tipTint * t));
      if (j === seg) {
        pos.push(cx, y, cz);
        col.push(c.r, c.g, c.b);
      } else {
        pos.push(cx - side.x * half, y, cz - side.y * half, cx + side.x * half, y, cz + side.y * half);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < seg - 1; j++) {
      const a = start + j * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const t = start + (seg - 1) * 2;
    idx.push(t, t + 1, start + seg * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function addClump(parent: THREE.Object3D, rand: () => number, o: ClumpOpt) {
  const m = new THREE.Mesh(bladeClump(rand, o), BLADE_MAT);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
}

// 寬葉（蒲公英葉、車前草葉）：以根部為軸心往外平鋪
function leaf(parent: THREE.Object3D, len: number, width: number, angle: number, tilt: number, material: THREE.Material) {
  const pivot = new THREE.Group();
  const l = mesh(GEO.sphere, material);
  l.scale.set(width, width * 0.22, len);
  l.position.set(0, 0, len * 0.46);
  pivot.add(l);
  pivot.rotation.set(-tilt, angle, 0, 'YXZ');
  parent.add(pivot);
}

// 狗尾草穗：彎彎的細莖＋毛茸茸的穗
function foxtail(parent: THREE.Object3D, rand: () => number, h: number) {
  const a = rand() * Math.PI * 2;
  const lean = 0.25 + rand() * 0.35;
  const x0 = (rand() - 0.5) * 0.12, z0 = (rand() - 0.5) * 0.12;
  const tip = new THREE.Vector3(x0 + Math.cos(a) * h * lean, h, z0 + Math.sin(a) * h * lean);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, h * 0.7, z0), tip);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 6, 0.012, 4), M.stem);
  stem.castShadow = true;
  parent.add(stem);
  const spike = mesh(GEO.sphereLo, M.spike);
  spike.scale.set(0.07, 0.24, 0.07);
  spike.position.copy(tip);
  const d = curve.getTangent(1);
  spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  spike.rotateX(0.5); // 穗往下垂一點
  parent.add(spike);
}

// 雜草模型：squash 群組用來做「被拉長」的動畫
export function buildWeed(kind: WeedKind, seed: number): THREE.Group {
  const g = new THREE.Group();
  const squash = new THREE.Group();
  g.add(squash);
  g.userData.squash = squash;
  const rand = mulberry32(seed);
  switch (kind) {
    case 'sprout':
      // 小草芽：一叢寬葉＋幾根挺直的嫩葉
      contactShadow(g, 0.38);
      for (let i = 0; i < 6; i++) leaf(squash, 0.22 + rand() * 0.06, 0.13, (i / 6) * Math.PI * 2 + rand() * 0.4, 0.35 + rand() * 0.3, i % 2 ? M.leaf : M.leafDark);
      addClump(squash, rand, { n: 7, hMin: 0.26, hMax: 0.4, width: 0.07, leanMin: 0.05, leanMax: 0.35, spread: 0.05, base: '#2b8a2a', tip: '#8fd84a' });
      break;
    case 'bush':
      // 雜草叢：往外開的長葉＋兩根狗尾草
      contactShadow(g, 0.5);
      addClump(squash, rand, { n: 20, hMin: 0.38, hMax: 0.62, width: 0.075, leanMin: 0.2, leanMax: 0.85, spread: 0.1, base: '#26802a', tip: '#9ad84a' });
      for (let i = 0; i < 4; i++) leaf(squash, 0.26, 0.12, rand() * Math.PI * 2, 0.25, M.leafDark);
      foxtail(squash, rand, 0.62);
      foxtail(squash, rand, 0.55);
      break;
    case 'big':
      // 大草叢：半人高的一大叢，狗尾草穗到處垂
      contactShadow(g, 0.68);
      addClump(squash, rand, { n: 30, hMin: 0.55, hMax: 0.95, width: 0.085, leanMin: 0.25, leanMax: 1.0, spread: 0.16, base: '#21752a', tip: '#a8dc52' });
      addClump(squash, rand, { n: 10, hMin: 0.3, hMax: 0.45, width: 0.1, leanMin: 0.6, leanMax: 1.2, spread: 0.12, base: '#2b8a2a', tip: '#7cc842' });
      for (let i = 0; i < 5; i++) foxtail(squash, rand, 0.75 + rand() * 0.3);
      break;
    case 'dandelion': {
      contactShadow(g, 0.36);
      for (let i = 0; i < 8; i++) leaf(squash, 0.26, 0.1, (i / 8) * Math.PI * 2 + rand() * 0.3, 0.12, i % 2 ? M.leaf : M.leafDark);
      for (let k = 0; k < 3; k++) {
        const puff = k === 2;
        const h = 0.32 + rand() * 0.14;
        const x = (rand() - 0.5) * 0.14, z = (rand() - 0.5) * 0.14;
        const stem = mesh(GEO.cyl, M.stem);
        stem.scale.set(0.022, h, 0.022);
        stem.position.set(x, h / 2, z);
        const head = mesh(GEO.sphere, puff ? M.puff : M.yellow);
        head.scale.set(puff ? 0.2 : 0.17, puff ? 0.2 : 0.11, puff ? 0.2 : 0.17);
        head.position.set(x, h + 0.02, z);
        squash.add(stem, head);
      }
      break;
    }
    case 'leaves': {
      // 落葉堆：隆起的一座小葉山（沿著半球面疊葉子），旁邊散幾片
      contactShadow(g, 0.55);
      const ms = [M.leafA, M.leafB, M.leafC, M.leafD];
      const R = 0.46, H = 0.3;
      for (let i = 0; i < 46; i++) {
        const u = rand(), a = rand() * Math.PI * 2;
        const r = Math.sqrt(u) * R;
        const y = H * Math.sqrt(Math.max(0, 1 - (r / R) * (r / R)));
        const l = mesh(GEO.sphereLo, ms[i % 4]);
        l.scale.set(0.2 + rand() * 0.06, 0.03, 0.13 + rand() * 0.04);
        l.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        // 葉面大致貼著葉堆表面
        l.rotation.set((rand() - 0.5) * 0.5 + (r / R) * 0.7 * Math.sin(a), rand() * Math.PI * 2, (rand() - 0.5) * 0.5 - (r / R) * 0.7 * Math.cos(a));
        squash.add(l);
      }
      for (let i = 0; i < 6; i++) {
        const l = mesh(GEO.sphereLo, ms[(i + 1) % 4], false);
        const a = rand() * Math.PI * 2, r = R + 0.1 + rand() * 0.25;
        l.scale.set(0.2, 0.025, 0.13);
        l.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
        l.rotation.y = rand() * Math.PI;
        g.add(l);
      }
      const tw = mesh(GEO.cyl, M.twig);
      tw.scale.set(0.02, 0.4, 0.02);
      tw.position.set(0.05, H * 0.9, 0);
      tw.rotation.z = 1.1;
      squash.add(tw);
      break;
    }
    case 'snow':
      // 積雪：圓滾滾的雪堆，頂上冒出一點草尖
      contactShadow(g, 0.5);
      for (let i = 0; i < 5; i++) {
        const s = mesh(GEO.sphere, M.snow);
        s.scale.set(0.66 - i * 0.08, 0.34 - i * 0.03, 0.6 - i * 0.07);
        s.position.set((rand() - 0.5) * 0.22, 0.05 + i * 0.05, (rand() - 0.5) * 0.22);
        squash.add(s);
      }
      addClump(squash, rand, { n: 5, hMin: 0.32, hMax: 0.42, width: 0.05, leanMin: 0.1, leanMax: 0.5, spread: 0.08, base: '#6a8a5a', tip: '#b8c8a0' });
      break;
  }
  // 效能：同材質的零件合併（落葉堆原本 50 幾個網格 → 5 個）
  bakeGroup(squash);
  bakeGroup(g, false);
  // 已經有接地陰影圓片：小雜草不投射即時陰影（省掉陰影貼圖那一輪的繪製），只有大草叢保留
  if (kind !== 'big') g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
  return g;
}
