import * as THREE from 'three';
import type { CropDef } from '../data/crops';
import { GEO, mat, mesh, withWind } from './materials';

// 參數化作物生成器：同一套程式吃 CropDef.shape 參數，產生 4 個成長階段
// stage 0 種子、1 發芽、2 成長中、3 成熟

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const cm = (color: string, wind = 0) => {
  const key = color + wind;
  let m = matCache.get(key);
  if (!m) {
    m = mat(color, { roughness: 0.6 });
    if (wind) withWind(m, wind);
    matCache.set(key, m);
  }
  return m;
};

function leaf(color: string, len: number, angle: number, tilt: number): THREE.Object3D {
  const pivot = new THREE.Group();
  const l = mesh(GEO.sphereLo, cm(color, 0.5));
  l.scale.set(len * 0.42, 0.04, len);
  l.position.set(0, len * 0.35, len * 0.42);
  l.rotation.x = -0.5;
  pivot.add(l);
  pivot.rotation.set(tilt, angle, 0);
  return pivot;
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
    const col = s.kind === 'grain' ? '#8fcf5a' : s.kind === 'root' ? s.leaf : s.leaf;
    g.add(leaf(col, 0.16, 0, -0.6), leaf(col, 0.16, Math.PI, -0.6));
    return g;
  }
  const grown = stage === 3;
  if (s.kind === 'root') {
    const n = grown ? s.leafCount + 1 : s.leafCount - 1;
    for (let i = 0; i < n; i++) g.add(leaf(s.leaf, grown ? 0.38 : 0.26, (i / n) * Math.PI * 2, -0.35 - (i % 2) * 0.2));
    const rootMat = cm(s.root);
    const r = mesh(s.rootShape === 'round' ? GEO.sphere : GEO.cone, rootMat);
    if (s.rootShape === 'round') {
      const k = grown ? 0.34 : 0.18;
      r.scale.set(k, k * 0.95, k);
      r.position.y = grown ? 0.1 : 0.02;
    } else {
      const k = grown ? 0.22 : 0.12;
      r.scale.set(k, k * 2.2, k);
      r.rotation.x = Math.PI;
      r.position.y = grown ? 0.08 : 0.0;
    }
    g.add(r);
  } else if (s.kind === 'grain') {
    const n = grown ? 7 : 5;
    const h = grown ? 0.85 : 0.45;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = i === 0 ? 0 : 0.13;
      const stalk = mesh(GEO.cyl, cm(grown ? s.stalk : '#7fbf4a', 0.35), false);
      stalk.scale.set(0.035, h, 0.035);
      stalk.position.set(Math.cos(a) * rr, h / 2, Math.sin(a) * rr);
      g.add(stalk);
      if (grown) {
        const head = mesh(GEO.sphereLo, cm(s.head, 0.35));
        head.scale.set(0.09, 0.26, 0.09);
        head.position.set(Math.cos(a) * rr, h + 0.1, Math.sin(a) * rr);
        g.add(head);
      }
    }
    for (let i = 0; i < 3; i++) g.add(leaf(grown ? '#a8b84a' : '#7fbf4a', 0.3, i * 2.1, -0.3));
  } else {
    const n = grown ? 6 : 4;
    for (let i = 0; i < n; i++) g.add(leaf(s.leaf, 0.26, (i / n) * Math.PI * 2, -0.5));
    const stems = grown ? 5 : 3;
    for (let i = 0; i < stems; i++) {
      const a = i * 1.9;
      const h = (grown ? 0.55 : 0.35) + (i % 2) * 0.1;
      const st = mesh(GEO.cyl, cm(s.stem, 0.4), false);
      st.scale.set(0.025, h, 0.025);
      st.position.set(Math.cos(a) * 0.1, h / 2, Math.sin(a) * 0.1);
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
  }
  return g;
}
