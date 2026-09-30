import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { windUniforms } from './materials';

// 濃密草毯：GPU instancing 一次畫數萬叢草葉
// - 每叢 3 片彎曲草葉；根部顏色＝地面顏色，往上漸層到草尖顏色，所以整片看起來是連續的草皮
// - 風吹波浪＋角色走過時草往兩邊倒（uPush）
// - 除草機割草：每叢一個高度係數 aCut（割短後依時間長回來）

export interface GrassPalette { ground: string; ground2: string; grass: string[] }

// 與 World.paintGround 相同的地面色塊雜訊
export const groundNoise = (x: number, z: number): number => 0.5 + 0.25 * Math.sin(x * 0.37 + z * 0.21) + 0.25 * Math.sin(x * 0.13 - z * 0.41);

// 單片草葉：寬度往上收尖、往前彎；position.y 為 0..1
function bladeGeo(width: number, bend: number, lean: number, yaw: number, dx: number, dz: number, h: number): THREE.BufferGeometry {
  const seg = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < seg; j++) {
    const y = j / seg;
    const w = width * Math.pow(1 - y, 0.7) * 0.5;
    const z = bend * y * y;
    pos.push(-w, y, z, w, y, z);
  }
  pos.push(0, 1, bend);
  for (let j = 0; j < seg - 1; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const t = (seg - 1) * 2;
  idx.push(t, t + 1, seg * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // 傾斜、旋轉、位移；y 仍保持 0..h 的比例（用來算漸層與風）
  const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(lean));
  g.applyMatrix4(m);
  g.scale(1, h, 1);
  g.translate(dx, 0, dz);
  return g;
}

function tuftGeo(): THREE.BufferGeometry {
  const parts = [
    bladeGeo(0.075, 0.18, 0.12, 0.2, 0, 0, 1),
    bladeGeo(0.065, 0.22, 0.28, 2.3, 0.035, 0.02, 0.8),
    bladeGeo(0.06, 0.2, 0.3, 4.3, -0.03, 0.03, 0.68),
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    const a = p.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) pos.push(a[i]);
    const ix = p.index!.array as ArrayLike<number>;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    off += a.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function grassMaterial(push: THREE.Vector3[], seasonH: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uPush = { value: push };
    shader.uniforms.uSeasonH = seasonH;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aCut;
        attribute vec3 aBase;
        uniform float uTime;
        uniform float uSeasonH;
        uniform vec3 uPush[3];
        varying float vH;
        varying vec3 vBase;`)
      // 法線一律朝上：草的明暗跟地面一致，不會一片黑一片白
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float h01 = clamp(position.y, 0.0, 1.0);
        vH = h01;
        vBase = aBase;
        transformed.y *= aCut * uSeasonH;
        {
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // 世界座標的位移向量：風＋被推開
          float sw = sin(uTime * 1.6 + root.x * 0.45 + root.z * 0.3) + 0.45 * sin(uTime * 3.3 + root.x * 1.7 - root.z * 1.1);
          vec3 wv = vec3(sw * 0.07, 0.0, cos(uTime * 1.2 + root.z * 0.5) * 0.04);
          for (int k = 0; k < 3; k++) {
            vec3 d = root - uPush[k];
            d.y = 0.0;
            float dist = length(d);
            float f = 1.0 - smoothstep(0.15, 0.75, dist);
            wv += normalize(d + vec3(0.0001)) * f * 0.28;
          }
          wv *= h01 * h01 * aCut;
          // 轉回每叢自己的座標系（只有繞 Y 旋轉＋縮放）
          vec3 c0 = instanceMatrix[0].xyz;
          vec3 c2 = instanceMatrix[2].xyz;
          transformed.x += dot(wv, c0) / dot(c0, c0);
          transformed.z += dot(wv, c2) / dot(c2, c2);
          transformed.y -= length(wv) * 0.5 * h01;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vBase;')
      // 雙面草葉的背面不要把法線翻成朝下（否則一半草葉變暗，整片看起來焦黑）
      .replace('#include <normal_fragment_begin>', `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(vBase * 0.9, diffuseColor.rgb, smoothstep(0.0, 0.85, vH));`);
  };
  m.customProgramCacheKey = () => 'grass-carpet';
  return m;
}

interface Field {
  mesh: THREE.InstancedMesh;
  x: Float32Array;
  z: Float32Array;
  cut: THREE.InstancedBufferAttribute;
  base: THREE.InstancedBufferAttribute;
}

export class GrassField {
  inside: THREE.InstancedMesh;
  outside: THREE.InstancedMesh;
  push = [new THREE.Vector3(999, 0, 999), new THREE.Vector3(999, 0, 999), new THREE.Vector3(999, 0, 999)];
  private seasonH = { value: 1 };
  private fin: Field;
  private fout: Field;
  private mowedAt: Float64Array;
  private masked: Uint8Array;
  private mowed = new Set<number>();
  private bins = new Map<number, number[]>();
  static REGROW_MS = 5 * 60 * 1000;
  static MOWN = 0.2;
  private mowScale = 1;

  // skip：不長草的地方（房子、田、小徑）
  constructor(count: number, outsideCount: number, skip: (x: number, z: number) => boolean) {
    const geo = tuftGeo();
    const material = grassMaterial(this.push, this.seasonH);
    const rand = mulberry32(42);
    this.fin = this.makeField(geo, material, count, rand, (r) => {
      for (let k = 0; k < 20; k++) {
        const x = (r() - 0.5) * 26.8, z = (r() - 0.5) * 26.8;
        if (!skip(x, z)) return [x, z];
      }
      return null;
    }, 0.16, 0.3);
    this.fout = this.makeField(geo, material, outsideCount, rand, (r) => {
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2, d = 14.2 + Math.pow(r(), 1.6) * 24;
        const x = Math.cos(a) * d * 1.05, z = Math.sin(a) * d;
        if (Math.abs(x) > 14.3 || Math.abs(z) > 14.3) return [x, z];
      }
      return null;
    }, 0.22, 0.4);
    this.inside = this.fin.mesh;
    this.outside = this.fout.mesh;
    this.mowedAt = new Float64Array(this.fin.x.length);
    this.masked = new Uint8Array(this.fin.x.length);
    // 舊版圍籬內約 3400 叢；割草回傳值換算回舊版叢數，牧草累積速度不變
    this.mowScale = 3400 / Math.max(1, this.fin.x.length);
    // 割草用的分格索引（1 公尺一格）
    for (let i = 0; i < this.fin.x.length; i++) {
      const k = this.binKey(Math.round(this.fin.x[i]), Math.round(this.fin.z[i]));
      let b = this.bins.get(k);
      if (!b) this.bins.set(k, (b = []));
      b.push(i);
    }
  }

  private binKey(x: number, z: number): number { return (x + 64) * 256 + (z + 64); }

  private makeField(geo: THREE.BufferGeometry, material: THREE.Material, n: number, rand: () => number, place: (r: () => number) => [number, number] | null, hMin: number, hMax: number): Field {
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const x = new Float32Array(n), z = new Float32Array(n);
    const cut = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    cut.setUsage(THREE.DynamicDrawUsage);
    const base = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.geometry = geo.clone();
    mesh.geometry.setAttribute('aCut', cut);
    mesh.geometry.setAttribute('aBase', base);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = place(rand);
      if (!p) continue;
      x[k] = p[0];
      z[k] = p[1];
      const w = 0.8 + rand() * 0.5;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m4.compose(v.set(p[0], 0, p[1]), q, s.set(w, hMin + rand() * (hMax - hMin), w));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, new THREE.Color('#8fdc6a'));
      k++;
    }
    mesh.count = k;
    mesh.frustumCulled = false; // 草鋪滿整張地圖，不需要逐物件裁切
    return { mesh, x: x.subarray(0, k), z: z.subarray(0, k), cut, base };
  }

  // 換季：草尖顏色＋根部貼齊地面顏色；冬天草被雪蓋住只剩一點點
  setSeason(p: GrassPalette, season: string): void {
    const a = new THREE.Color(p.ground), b = new THREE.Color(p.ground2), tmp = new THREE.Color(), c = new THREE.Color();
    const rand = mulberry32(9);
    for (const f of [this.fin, this.fout]) {
      const arr = f.base.array as Float32Array;
      for (let i = 0; i < f.x.length; i++) {
        tmp.copy(a).lerp(b, groundNoise(f.x[i], f.z[i]));
        arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
        c.set(p.grass[Math.floor(rand() * p.grass.length)]).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.07);
        f.mesh.setColorAt(i, c);
      }
      f.base.needsUpdate = true;
      f.mesh.instanceColor!.needsUpdate = true;
    }
    this.seasonH.value = season === 'winter' ? 0.38 : season === 'autumn' ? 0.92 : 1;
  }

  // 不長草的格子（被擋住的格子、溫室內部等）：高度設 0
  applyMask(hidden: (x: number, z: number) => boolean): void {
    const arr = this.fin.cut.array as Float32Array;
    for (let i = 0; i < this.fin.x.length; i++) {
      const h = hidden(this.fin.x[i], this.fin.z[i]) ? 1 : 0;
      this.masked[i] = h;
      arr[i] = h ? 0 : this.mowedAt[i] ? GrassField.MOWN : 1;
    }
    this.fin.cut.needsUpdate = true;
  }

  // 割草：半徑內的草變短，回傳割到幾叢
  mow(x: number, z: number, r: number, now: number): number {
    const arr = this.fin.cut.array as Float32Array;
    let n = 0;
    const r2 = r * r;
    for (let bx = Math.round(x - r) - 1; bx <= Math.round(x + r) + 1; bx++) {
      for (let bz = Math.round(z - r) - 1; bz <= Math.round(z + r) + 1; bz++) {
        const b = this.bins.get(this.binKey(bx, bz));
        if (!b) continue;
        for (const i of b) {
          if (this.masked[i]) continue;
          const dx = this.fin.x[i] - x, dz = this.fin.z[i] - z;
          if (dx * dx + dz * dz > r2) continue;
          if (this.mowedAt[i] && now - this.mowedAt[i] < GrassField.REGROW_MS * 0.5) continue;
          this.mowedAt[i] = now;
          this.mowed.add(i);
          arr[i] = GrassField.MOWN;
          n++;
        }
      }
    }
    if (n) this.fin.cut.needsUpdate = true;
    return n * this.mowScale;
  }

  // 割過的草依遊戲時間慢慢長回來
  regrow(now: number): void {
    if (!this.mowed.size) return;
    const arr = this.fin.cut.array as Float32Array;
    for (const i of this.mowed) {
      const t = Math.min(1, Math.max(0, (now - this.mowedAt[i]) / GrassField.REGROW_MS));
      if (!this.masked[i]) arr[i] = GrassField.MOWN + (1 - GrassField.MOWN) * t * t;
      if (t >= 1) { this.mowedAt[i] = 0; this.mowed.delete(i); }
    }
    this.fin.cut.needsUpdate = true;
  }

  // 會把草推開的角色位置（主角、寵物、乳牛）
  setPushers(pts: (THREE.Vector3 | null)[]): void {
    for (let i = 0; i < 3; i++) {
      const p = pts[i];
      if (p) this.push[i].set(p.x, 0, p.z);
      else this.push[i].set(999, 0, 999);
    }
  }

  get count(): number { return this.fin.x.length + this.fout.x.length; }
}
