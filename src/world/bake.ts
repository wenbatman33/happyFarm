import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 效能工具：把一個群組底下（含巢狀）的網格，依材質合併成少數幾個網格
// 建模時用很多小零件拼起來很方便，但每個零件都是一個 draw call（陰影還要再畫一次）
// deep=false 時只合併直接子網格（保留子群組，例如要做動畫的部分）
export function bakeGroup(root: THREE.Object3D, deep = true): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  const collect = (o: THREE.Object3D) => {
    for (const c of o.children) {
      const m = c as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
        const mat = m.material as THREE.Material;
        if (!groups.has(mat)) groups.set(mat, []);
        groups.get(mat)!.push(m);
      }
      if (deep && !m.isMesh) collect(c);
    }
  };
  collect(root);
  const rel = new THREE.Matrix4();
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    // 屬性組合要一樣才能合併：依屬性名稱分批
    const byKey = new Map<string, THREE.Mesh[]>();
    for (const m of list) {
      const key = Object.keys(m.geometry.attributes).sort().join(',') + (m.geometry.index ? '|i' : '');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(m);
    }
    for (const batch of byKey.values()) {
      if (batch.length < 2) continue;
      const geos = batch.map((m) => { rel.multiplyMatrices(inv, m.matrixWorld); const g = m.geometry.clone(); g.applyMatrix4(rel); return g; });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const out = new THREE.Mesh(merged, mat);
      out.castShadow = batch.some((m) => m.castShadow);
      out.receiveShadow = true;
      out.renderOrder = batch[0].renderOrder;
      for (const m of batch) m.parent?.remove(m);
      root.add(out);
    }
  }
  // 清掉合併後變空的群組
  if (deep) {
    const empty: THREE.Object3D[] = [];
    root.traverse((o) => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0) empty.push(o); });
    for (const e of empty) e.parent?.remove(e);
  }
}
