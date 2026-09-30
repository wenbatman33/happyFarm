import * as THREE from 'three';
import type { CropDef } from '../data/crops';
import { GEO, mat, mesh, withWind } from './materials';

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

export function buildCrop(def: CropDef, stage: number): THREE.Group {
  const g = new THREE.Group();
  const s = def.shape;
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
    const col = s.kind === 'grain' || s.kind === 'cane' ? '#8fcf5a' : 'leaf' in s ? s.leaf : '#6fbf4a';
    g.add(leaf(col, 0.16, 0, -0.6), leaf(col, 0.16, Math.PI, -0.6));
    return g;
  }
  const grown = stage === 3;
  switch (s.kind) {
    case 'root': {
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
            const f = mesh(GEO.sphereLo, cm(s.flower, 0.4), false);
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
