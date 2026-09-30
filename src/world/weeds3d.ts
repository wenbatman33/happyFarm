import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { GEO, mat, mesh, withWind } from './materials';

export type WeedKind = 'sprout' | 'bush' | 'big' | 'dandelion' | 'leaves' | 'snow';

// 雜草要跟裝飾草明顯區分：圓潤的葉叢＋底下一塊深色泥土，顏色更飽和
const M = {
  leaf: withWind(mat('#5cc23a', { roughness: 0.55 }), 0.5),
  leafDark: withWind(mat('#3f9a2c', { roughness: 0.6 }), 0.5),
  leafTip: withWind(mat('#9ad84a', { roughness: 0.55 }), 0.5),
  seed: withWind(mat('#d8c27a'), 0.5),
  yellow: withWind(mat('#ffd23a', { roughness: 0.45, emissive: '#ffb000', emissiveIntensity: 0.15 }), 0.5),
  soil: mat('#6e4a2e', { roughness: 1 }),
  leafA: mat('#f08a3c', { roughness: 0.7 }),
  leafB: mat('#e05a38', { roughness: 0.7 }),
  leafC: mat('#f4bc48', { roughness: 0.7 }),
  snow: mat('#f7fbff', { roughness: 0.8 }),
};

// 一片葉子：以根部為軸心，往外往上翹
function leaf(parent: THREE.Object3D, len: number, width: number, angle: number, tilt: number, material: THREE.Material) {
  const pivot = new THREE.Group();
  const l = mesh(GEO.sphere, material);
  l.scale.set(width, width * 0.28, len);
  l.position.set(0, 0, len * 0.45);
  pivot.add(l);
  pivot.rotation.set(-tilt, angle, 0, 'YXZ');
  parent.add(pivot);
}

function clump(parent: THREE.Object3D, n: number, len: number, rand: () => number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.4;
    const m = i % 3 === 0 ? M.leafDark : i % 3 === 1 ? M.leaf : M.leafTip;
    leaf(parent, len * (0.8 + rand() * 0.4), len * 0.34, a, 0.55 + rand() * 0.5, m);
  }
  // 中間幾片直立的
  for (let i = 0; i < Math.ceil(n / 3); i++) leaf(parent, len * 0.9, len * 0.26, rand() * Math.PI * 2, 1.15 + rand() * 0.25, M.leaf);
}

function soilPatch(g: THREE.Group, r: number) {
  const s = mesh(GEO.sphereLo, M.soil, false);
  s.scale.set(r, 0.05, r);
  s.position.y = 0.0;
  g.add(s);
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
      soilPatch(g, 0.42);
      clump(squash, 5, 0.26, rand);
      break;
    case 'bush':
      soilPatch(g, 0.6);
      clump(squash, 8, 0.4, rand);
      break;
    case 'big':
      soilPatch(g, 0.75);
      clump(squash, 11, 0.55, rand);
      for (let i = 0; i < 3; i++) {
        const st = mesh(GEO.cyl, M.leafDark);
        const h = 0.7 + rand() * 0.2;
        st.scale.set(0.03, h, 0.03);
        const x = (rand() - 0.5) * 0.3, z = (rand() - 0.5) * 0.3;
        st.position.set(x, h / 2, z);
        const s = mesh(GEO.sphereLo, M.seed);
        s.scale.set(0.08, 0.2, 0.08);
        s.position.set(x, h + 0.06, z);
        squash.add(st, s);
      }
      break;
    case 'dandelion': {
      soilPatch(g, 0.4);
      for (let i = 0; i < 7; i++) leaf(squash, 0.26, 0.09, (i / 7) * Math.PI * 2, 0.15, M.leaf);
      const stem = mesh(GEO.cyl, M.leaf);
      stem.scale.set(0.025, 0.4, 0.025);
      stem.position.y = 0.2;
      const head = mesh(GEO.sphere, M.yellow);
      head.scale.set(0.2, 0.14, 0.2);
      head.position.y = 0.42;
      squash.add(stem, head);
      break;
    }
    case 'leaves': {
      // 落葉堆：隆起的一堆，三種秋色
      const ms = [M.leafA, M.leafB, M.leafC];
      for (let i = 0; i < 20; i++) {
        const l = mesh(GEO.sphereLo, ms[i % 3]);
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.42;
        l.scale.set(0.24, 0.04, 0.16);
        l.position.set(Math.cos(a) * r, 0.03 + (0.42 - r) * 0.45, Math.sin(a) * r);
        l.rotation.set((rand() - 0.5) * 0.8, rand() * Math.PI, (rand() - 0.5) * 0.8);
        squash.add(l);
      }
      break;
    }
    case 'snow':
      for (let i = 0; i < 5; i++) {
        const s = mesh(GEO.sphere, M.snow);
        s.scale.set(0.6 - i * 0.08, 0.3 - i * 0.03, 0.55 - i * 0.07);
        s.position.set((rand() - 0.5) * 0.25, 0.06 + i * 0.05, (rand() - 0.5) * 0.25);
        squash.add(s);
      }
      break;
  }
  return g;
}
