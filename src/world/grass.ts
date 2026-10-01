import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

// 草地（第三版）：草的細節畫在地面貼圖上（有 mipmap，遠近都平滑、不會閃），
// 再放少量「完全靜態」的粗草叢點綴，一次 draw call、不投影、不隨風擺動。
// 除草機割草：用 0.5 公尺的格子記錄割過的時間（算牧草），割到的草叢變短、5 分鐘長回來。

export interface GrassPalette { ground: string; ground2: string; grass: string[] }

// 與 World.paintGround 相同的地面色塊雜訊
export const groundNoise = (x: number, z: number): number => 0.5 + 0.25 * Math.sin(x * 0.37 + z * 0.21) + 0.25 * Math.sin(x * 0.13 - z * 0.41);

// ---------- 地面草紋貼圖（可無縫拼接） ----------
let groundTex: THREE.CanvasTexture | null = null;
export function grassGroundTexture(): THREE.CanvasTexture {
  if (groundTex) return groundTex;
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!;
  // 底色接近白色：貼圖乘上地面的季節顏色，只負責明暗細節
  c.fillStyle = '#f2f2f2';
  c.fillRect(0, 0, N, N);
  const rand = mulberry32(77);
  // 大塊柔和的明暗（打破拼接的重複感）
  for (let i = 0; i < 18; i++) {
    const x = rand() * N, y = rand() * N, r = 50 + rand() * 90;
    const light = rand() < 0.5;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, light ? 'rgba(255,255,240,0.10)' : 'rgba(90,110,60,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  // 細小草葉筆觸（低對比；邊界外的筆觸繞回另一側，保證無縫）
  const stroke = (x: number, y: number, len: number, ang: number, w: number, col: string) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const bx = x + ox, by = y + oy;
      if (bx < -20 || bx > N + 20 || by < -20 || by > N + 20) continue;
      c.strokeStyle = col;
      c.lineWidth = w;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(bx, by);
      c.quadraticCurveTo(bx + Math.cos(ang) * len * 0.5 + 2, by - len * 0.55, bx + Math.cos(ang) * len, by - len * Math.sin(ang + 1.2));
      c.stroke();
    }
  };
  for (let i = 0; i < 2600; i++) {
    const dark = rand() < 0.55;
    const l = dark ? 150 + rand() * 50 : 225 + rand() * 30;
    const col = dark ? `rgba(${(l * 0.82) | 0},${l | 0},${(l * 0.6) | 0},0.35)` : `rgba(${l | 0},${l | 0},${(l * 0.85) | 0},0.4)`;
    stroke(rand() * N, rand() * N, 7 + rand() * 9, 0.9 + rand() * 1.3, 1.6 + rand() * 1.4, col);
  }
  groundTex = new THREE.CanvasTexture(cv);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.anisotropy = 8;
  return groundTex;
}

// ---------- 靜態草叢 ----------
// 一叢 5 片粗短草葉；position.y 為 0..1；頂點色做根部到草尖的漸層
function tuftGeo(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const rand = mulberry32(5);
  for (let b = 0; b < 5; b++) {
    const yaw = (b / 5) * Math.PI * 2 + rand() * 0.6;
    const lean = 0.15 + rand() * 0.35;
    const h = 0.7 + rand() * 0.3;
    const w = 0.13 + rand() * 0.04;
    const dir = new THREE.Vector2(Math.cos(yaw), Math.sin(yaw));
    const side = new THREE.Vector2(-dir.y, dir.x);
    const ox = dir.x * 0.04, oz = dir.y * 0.04;
    const start = pos.length / 3;
    const seg = 3;
    for (let j = 0; j <= seg; j++) {
      const t = j / seg;
      const out = lean * t * t;
      const half = j === seg ? 0 : w * 0.5 * (1 - t * 0.85);
      const cx = ox + dir.x * out, cz = oz + dir.y * out, y = h * t;
      const shade = 0.82 + 0.18 * t;
      if (j === seg) { pos.push(cx, y, cz); col.push(shade, shade, shade); }
      else { pos.push(cx - side.x * half, y, cz - side.y * half, cx + side.x * half, y, cz + side.y * half); col.push(shade, shade, shade, shade, shade, shade); }
    }
    for (let j = 0; j < seg - 1; j++) { const a = start + j * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
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

// 材質：法線朝上（明暗跟地面一致）、根部顏色貼齊地面；沒有任何動畫
function tuftMaterial(seasonH: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSeasonH = seasonH;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCut;\nattribute vec3 aBase;\nuniform float uSeasonH;\nvarying float vH;\nvarying vec3 vBase;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\nvH = clamp(position.y, 0.0, 1.0);\nvBase = aBase;\ntransformed.y *= aCut * uSeasonH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vBase;')
      .replace('#include <normal_fragment_begin>', 'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(vBase, diffuseColor.rgb, smoothstep(0.0, 0.7, vH));`);
  };
  m.customProgramCacheKey = () => 'grass-tuft-static';
  return m;
}

interface Field { mesh: THREE.InstancedMesh; x: Float32Array; z: Float32Array; cut: THREE.InstancedBufferAttribute; base: THREE.InstancedBufferAttribute }

const CELL = 0.5; // 割草記錄的格子大小
const HALF = 13.5; // 圍籬內範圍
const CELLS = Math.ceil((HALF * 2) / CELL);

export class GrassField {
  inside: THREE.InstancedMesh;
  outside: THREE.InstancedMesh;
  private seasonH = { value: 1 };
  private fin: Field;
  private fout: Field;
  private masked: Uint8Array;
  private tuftMowedAt: Float64Array;
  private mowedTufts = new Set<number>();
  private cellMowedAt = new Float64Array(CELLS * CELLS);
  private bins = new Map<number, number[]>();
  static REGROW_MS = 5 * 60 * 1000;
  static MOWN = 0.25;

  // skip：不長草叢的地方（房子、田、小徑）
  constructor(count: number, outsideCount: number, skip: (x: number, z: number) => boolean) {
    const geo = tuftGeo();
    const material = tuftMaterial(this.seasonH);
    const rand = mulberry32(42);
    // 草叢成簇分布（比均勻撒更自然）
    const clusters = Array.from({ length: Math.max(1, Math.round(count / 9)) }, () => [(rand() - 0.5) * 26.6, (rand() - 0.5) * 26.6] as [number, number]);
    this.fin = this.makeField(geo, material, count, rand, (r) => {
      for (let k = 0; k < 20; k++) {
        const c = clusters[Math.floor(r() * clusters.length)];
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.1;
        const x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
        if (Math.abs(x) < 13.3 && Math.abs(z) < 13.3 && !skip(x, z)) return [x, z];
      }
      return null;
    }, 0.28, 0.48);
    this.fout = this.makeField(geo, material, outsideCount, rand, (r) => {
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2, d = 14.2 + Math.pow(r(), 1.6) * 24;
        const x = Math.cos(a) * d * 1.05, z = Math.sin(a) * d;
        if (Math.abs(x) > 14.3 || Math.abs(z) > 14.3) return [x, z];
      }
      return null;
    }, 0.35, 0.6);
    this.inside = this.fin.mesh;
    this.outside = this.fout.mesh;
    this.masked = new Uint8Array(this.fin.x.length);
    this.tuftMowedAt = new Float64Array(this.fin.x.length);
    for (let i = 0; i < this.fin.x.length; i++) {
      const k = this.binKey(Math.round(this.fin.x[i]), Math.round(this.fin.z[i]));
      let b = this.bins.get(k);
      if (!b) this.bins.set(k, (b = []));
      b.push(i);
    }
  }

  private binKey(x: number, z: number): number { return (x + 64) * 256 + (z + 64); }

  private makeField(geo: THREE.BufferGeometry, material: THREE.Material, n: number, rand: () => number, place: (r: () => number) => [number, number] | null, hMin: number, hMax: number): Field {
    const mesh = new THREE.InstancedMesh(geo.clone(), material, n);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const x = new Float32Array(n), z = new Float32Array(n);
    const cut = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    cut.setUsage(THREE.DynamicDrawUsage);
    const base = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.geometry.setAttribute('aCut', cut);
    mesh.geometry.setAttribute('aBase', base);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = place(rand);
      if (!p) continue;
      x[k] = p[0];
      z[k] = p[1];
      const w = 0.85 + rand() * 0.4;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m4.compose(v.set(p[0], 0, p[1]), q, s.set(w, hMin + rand() * (hMax - hMin), w));
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, new THREE.Color('#8fdc6a'));
      k++;
    }
    mesh.count = k;
    mesh.frustumCulled = false;
    return { mesh, x: x.subarray(0, k), z: z.subarray(0, k), cut, base };
  }

  // 換季：草叢顏色依位置大片緩慢變化（不是每叢隨機，避免雜訊感）；根部貼齊地面顏色
  setSeason(p: GrassPalette, season: string): void {
    const a = new THREE.Color(p.ground), b = new THREE.Color(p.ground2), tmp = new THREE.Color(), c = new THREE.Color();
    const c1 = new THREE.Color(p.grass[0]), c2 = new THREE.Color(p.grass[1 % p.grass.length]), c3 = new THREE.Color(p.grass[2 % p.grass.length]);
    for (const f of [this.fin, this.fout]) {
      const arr = f.base.array as Float32Array;
      for (let i = 0; i < f.x.length; i++) {
        const x = f.x[i], z = f.z[i];
        tmp.copy(a).lerp(b, groundNoise(x, z));
        arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
        const n1 = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17) * Math.cos(x * 0.11 - z * 0.21);
        const n2 = 0.5 + 0.5 * Math.sin(x * 0.07 - z * 0.13 + 1.7);
        c.copy(c1).lerp(c2, n1).lerp(c3, n2 * 0.5);
        f.mesh.setColorAt(i, c);
      }
      f.base.needsUpdate = true;
      f.mesh.instanceColor!.needsUpdate = true;
    }
    this.seasonH.value = season === 'winter' ? 0.3 : 1;
  }

  // 被擋住的格子（房子、障礙物、溫室內部等）不長草叢
  applyMask(hidden: (x: number, z: number) => boolean): void {
    const arr = this.fin.cut.array as Float32Array;
    for (let i = 0; i < this.fin.x.length; i++) {
      const h = hidden(this.fin.x[i], this.fin.z[i]) ? 1 : 0;
      this.masked[i] = h;
      arr[i] = h ? 0 : this.tuftMowedAt[i] ? GrassField.MOWN : 1;
    }
    this.fin.cut.needsUpdate = true;
  }

  // 割草：半徑內第一次（或已長回一半）被割的格子才算數；回傳換算成舊版的「叢數」（牧草累積速度不變）
  mow(x: number, z: number, r: number, now: number): number {
    let cells = 0;
    const r2 = r * r;
    for (let gx = Math.floor((x - r + HALF) / CELL); gx <= Math.floor((x + r + HALF) / CELL); gx++) {
      for (let gz = Math.floor((z - r + HALF) / CELL); gz <= Math.floor((z + r + HALF) / CELL); gz++) {
        if (gx < 0 || gz < 0 || gx >= CELLS || gz >= CELLS) continue;
        const cx = gx * CELL - HALF + CELL / 2, cz = gz * CELL - HALF + CELL / 2;
        if ((cx - x) ** 2 + (cz - z) ** 2 > r2) continue;
        const k = gz * CELLS + gx;
        const t = this.cellMowedAt[k];
        if (t && now - t < GrassField.REGROW_MS * 0.5) continue;
        this.cellMowedAt[k] = now;
        cells++;
      }
    }
    // 割到的草叢變短
    const arr = this.fin.cut.array as Float32Array;
    let changed = false;
    for (let bx = Math.round(x - r) - 1; bx <= Math.round(x + r) + 1; bx++) {
      for (let bz = Math.round(z - r) - 1; bz <= Math.round(z + r) + 1; bz++) {
        const b = this.bins.get(this.binKey(bx, bz));
        if (!b) continue;
        for (const i of b) {
          if (this.masked[i]) continue;
          if ((this.fin.x[i] - x) ** 2 + (this.fin.z[i] - z) ** 2 > r2) continue;
          this.tuftMowedAt[i] = now;
          this.mowedTufts.add(i);
          arr[i] = GrassField.MOWN;
          changed = true;
        }
      }
    }
    if (changed) this.fin.cut.needsUpdate = true;
    // 舊版草地密度約每平方公尺 4.7 叢，一格 0.25 平方公尺
    return cells * CELL * CELL * 4.7;
  }

  // 割過的草叢依遊戲時間慢慢長回來
  regrow(now: number): void {
    if (!this.mowedTufts.size) return;
    const arr = this.fin.cut.array as Float32Array;
    for (const i of this.mowedTufts) {
      const t = Math.min(1, Math.max(0, (now - this.tuftMowedAt[i]) / GrassField.REGROW_MS));
      if (!this.masked[i]) arr[i] = GrassField.MOWN + (1 - GrassField.MOWN) * t * t;
      if (t >= 1) { this.tuftMowedAt[i] = 0; this.mowedTufts.delete(i); }
    }
    this.fin.cut.needsUpdate = true;
  }

  // 舊介面保留：草不再被推動，也不隨風擺
  setPushers(_pts: (THREE.Vector3 | null)[]): void {}

  get count(): number { return this.fin.x.length + this.fout.x.length; }
}
