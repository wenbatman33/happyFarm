import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import { GEO, mat, windUniforms, withWind } from './materials';
import { FONT_ROUND, Kit, P, bake, canvasTex, cord, rbox, sag, stick, texPlane, type GlowMat } from './festive3d';
import { lilyPadGeo, lilyPadMat } from './crops3d';
import { groundNoise } from './grass';

// 場景小物：池塘（Lv30）、蜂箱、望遠鏡、寵物小屋
// 所有 build* 的原點都在地面中心；靜態零件用 bake() 依材質合併，會動的子樹標 userData.dyn

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// =====================================================================
// 池塘
// =====================================================================

export const POND_WATER_Y = 0.05; // 水面高度（水生作物放在這個高度）
export const POND_RX = 2.3; // 水面橢圓半徑（x）
export const POND_RZ = 1.8; // 水面橢圓半徑（z）
// 遊戲放水生作物的位置（相對池塘中心）：睡蓮葉、道具都要避開
const POND_SLOTS: [number, number][] = [[-1.2, -0.8], [0, -1.0], [1.2, -0.7], [-1.0, 0.7], [0.2, 0.9], [1.3, 0.6]];
// 預定地／施工中木牌的位置（池塘本地座標，西南岸）
export const POND_SIGN: [number, number] = [-1.35, 2.2];
// 施工中額外要擋住的點（土堆、手推車）
export const POND_BUILD_BLOCK: [number, number][] = [[0.75, -2.3], [-0.85, -2.25], [2.0, 2.05]];

// 池塘本地座標點是否在水面橢圓（放大 k 倍）內
export const inPondEllipse = (lx: number, lz: number, k = 1): boolean => (lx / (POND_RX * k)) ** 2 + (lz / (POND_RZ * k)) ** 2 < 1;

// 沙岸外緣（橢圓的倍率，隨角度起伏；南側多一片沙灘）
const sandK = (a: number): number => 1.13 + 0.045 * Math.sin(a * 3 + 0.6) + 0.03 * Math.sin(a * 5 + 1.7) + 0.2 * Math.exp(-(((a - 1.75) / 0.42) ** 2));

// 這個池塘本地點底下要不要清掉草（水面＋沙岸；預定地／施工中只清凹地）
export function pondClearsGrass(lx: number, lz: number, level: number, building: boolean): boolean {
  if (level < 1 && !building) return inPondEllipse(lx, lz, 1.0);
  if (level < 1) return inPondEllipse(lx, lz, 1.08);
  const a = Math.atan2(lz / POND_RZ, lx / POND_RX);
  return inPondEllipse(lx, lz, sandK(a));
}

// 預定地的凹地：極座標網格圓盤（被遮罩的草會倒平，要有不透明的地面蓋住），顏色由 paintPondHollow 依季節地面色塗上
function hollowGeo(): THREE.BufferGeometry {
  const RINGS = 8, SEG = 56;
  const pos: number[] = [0, 0, 0], idx: number[] = [];
  for (let r = 1; r <= RINGS; r++) for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2, t = r / RINGS;
    pos.push(Math.cos(a) * POND_RX * t, 0, Math.sin(a) * POND_RZ * t);
  }
  const at = (r: number, k: number) => (r === 0 ? 0 : 1 + (r - 1) * SEG + (k % SEG));
  for (let r = 0; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
    if (r === 0) { idx.push(0, at(1, k + 1), at(1, k)); continue; }
    idx.push(at(r, k), at(r, k + 1), at(r + 1, k + 1), at(r, k), at(r + 1, k + 1), at(r + 1, k));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 依季節地面色（跟 World.paintGround 同一套雜訊）塗凹地：越往中間越暗、微微偏乾草色
export function paintPondHollow(obj: THREE.Object3D, ground: string, ground2: string): void {
  const m = obj.userData.hollow as THREE.Mesh | undefined;
  if (!m) return;
  m.updateWorldMatrix(true, false);
  const pos = m.geometry.attributes.position as THREE.BufferAttribute, col = m.geometry.attributes.color as THREE.BufferAttribute;
  const a = new THREE.Color(ground), b = new THREE.Color(ground2), dry = new THREE.Color('#b9a463'), c = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r2 = (v.x / POND_RX) ** 2 + (v.z / POND_RZ) ** 2;
    v.applyMatrix4(m.matrixWorld);
    c.copy(a).lerp(b, groundNoise(v.x, v.z));
    const d = Math.max(0, 1 - r2);
    c.lerp(dry, 0.18 * d).multiplyScalar(1 - 0.26 * d);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// ---------- 水面材質 ----------
// MeshStandardMaterial＋onBeforeCompile：中心深、岸邊淺的藍綠色，世界座標的漣漪擾動法線，
// 焦散網紋、閃光點、邊緣菲涅耳；uNight 讓夜晚變深藍並出現月光倒影
export const pondUniforms = {
  uNight: { value: 0 },
};
const C = (h: string) => new THREE.Color(h);
let waterMatCache: THREE.MeshStandardMaterial | null = null;
function waterMat(): THREE.MeshStandardMaterial {
  if (waterMatCache) return waterMatCache;
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.16, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: windUniforms.uTime,
      uNight: pondUniforms.uNight,
      uDeep: { value: C('#2386b8') }, uMid: { value: C('#3fbcd0') }, uShal: { value: C('#9ee6d6') }, uEdge: { value: C('#d6e6b8') },
      uDeepN: { value: C('#081a3c') }, uMidN: { value: C('#12305e') }, uShalN: { value: C('#24497a') }, uEdgeN: { value: C('#3a4c66') },
      uSky: { value: C('#bfe6ff') }, uSkyN: { value: C('#3a5aa0') },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPondQ;\nvarying vec2 vPondW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPondQ = uv * 2.0 - 1.0;\nvPondW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uNight;
        uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShal; uniform vec3 uEdge;
        uniform vec3 uDeepN; uniform vec3 uMidN; uniform vec3 uShalN; uniform vec3 uEdgeN;
        uniform vec3 uSky; uniform vec3 uSkyN;
        varying vec2 vPondQ; varying vec2 vPondW;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pr = length(vPondQ);
        vec3 wc = mix(mix(uDeep, uDeepN, uNight), mix(uMid, uMidN, uNight), smoothstep(0.05, 0.72, pr));
        wc = mix(wc, mix(uShal, uShalN, uNight), smoothstep(0.62, 0.93, pr));
        wc = mix(wc, mix(uEdge, uEdgeN, uNight), smoothstep(0.9, 1.0, pr));
        {
          // 焦散網紋：兩組扭曲的正弦相乘，接近 0 的地方連成亮線
          vec2 cw = vPondW * 2.4;
          float c1 = sin(cw.x + 1.3 * sin(cw.y * 1.2 + uTime * 0.8) + uTime * 0.5);
          float c2 = sin(cw.y * 1.15 + 1.3 * sin(cw.x * 1.35 - uTime * 0.7) - uTime * 0.45);
          float caus = pow(1.0 - abs(c1 * c2), 8.0);
          wc += caus * 0.11 * (1.0 - uNight * 0.75) * smoothstep(0.15, 0.85, pr) * (1.0 - smoothstep(0.92, 1.0, pr));
        }
        diffuseColor.rgb = wc;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // 三組方向不同的小波，解析梯度 → 世界法線 → 視角空間
          vec2 w = vPondW; vec2 gr = vec2(0.0);
          vec2 d1 = vec2(0.93, 0.37); gr += d1 * cos(dot(d1, w) * 2.3 + uTime * 1.4) * 0.07;
          vec2 d2 = vec2(-0.45, 0.89); gr += d2 * cos(dot(d2, w) * 3.7 - uTime * 1.9) * 0.05;
          vec2 d3 = vec2(0.6, -0.8); gr += d3 * cos(dot(d3, w) * 6.1 + uTime * 2.6) * 0.035;
          gr *= 1.0 - smoothstep(0.85, 1.0, pr) * 0.7;
          normal = normalize((viewMatrix * vec4(normalize(vec3(-gr.x, 1.0, -gr.y)), 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 w = vPondW;
          // 閃光點：白天柔和、夜晚是月光碎片（夠亮才會被 bloom 撿到）
          vec2 gw = w + vec2(sin(w.y * 3.1 + uTime * 0.7), cos(w.x * 2.7 - uTime * 0.6)) * 0.18;
          float sp = sin(gw.x * 11.3 + uTime * 1.6) * sin(gw.y * 12.7 - uTime * 1.25) * sin((gw.x - gw.y) * 7.9 + uTime * 2.2);
          float glint = smoothstep(0.86, 0.99, sp) * (1.0 - smoothstep(0.82, 0.98, pr));
          totalEmissiveRadiance += mix(vec3(0.85, 0.95, 1.0) * 0.7, vec3(0.78, 0.88, 1.0) * 3.0, uNight) * glint;
          // 菲涅耳：斜看時邊緣帶一點天空色
          float fr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
          totalEmissiveRadiance += mix(uSky * 0.35, uSkyN * 0.6, uNight) * fr;
          // 夜晚：水面上一道被漣漪切碎的月光倒影
          vec2 q = vPondQ - vec2(0.28, -0.22);
          q.x += sin(q.y * 34.0 + uTime * 3.0) * 0.025;
          float moon = exp(-(q.x * q.x / 0.012 + q.y * q.y / 0.05));
          float shards = 0.55 + 0.45 * sin(q.y * 60.0 - uTime * 4.0);
          totalEmissiveRadiance += vec3(0.85, 0.92, 1.0) * moon * shards * uNight * 1.8;
        }`);
  };
  m.customProgramCacheKey = () => 'pond-water-v1';
  return (waterMatCache = m);
}

// 木牌貼圖（池塘預定地、施工中）
function boardTex(text: string, bg: string, fg: string, sub?: string): THREE.CanvasTexture {
  return canvasTex(384, 160, (c, w, h) => {
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(6, 6, w - 12, h - 12, 22);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 5;
    c.stroke();
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold ${sub ? 54 : 70}px ${FONT_ROUND}`;
    c.fillText(text, w / 2, sub ? h / 2 - 18 : h / 2 + 4);
    if (sub) {
      c.font = `bold 32px ${FONT_ROUND}`;
      c.globalAlpha = 0.85;
      c.fillText(sub, w / 2, h / 2 + 40);
    }
  });
}

function signpost(kit: Kit, parent: THREE.Object3D, text: string, sub: string | undefined, bg: string, s = 1): void {
  const wood = kit.m('#a8744a'), dark = kit.m('#8a5a3a');
  P(parent, rbox(0.1 * s, 1.25 * s, 0.1 * s, 0.03), dark, [0, 0.62 * s, 0]);
  P(parent, rbox(1.2 * s, 0.52 * s, 0.07, 0.04), wood, [0, 1.05 * s, 0.02]);
  texPlane(parent, boardTex(text, bg, '#fffaf0', sub), 1.08 * s, 0.45 * s, [0, 1.05 * s, 0.06]);
}

// 橢圓周上的點（k 為倍率）
const onRim = (a: number, k: number): [number, number] => [Math.cos(a) * POND_RX * k, Math.sin(a) * POND_RZ * k];

// 徑向漸層的圓盤貼圖（凹地陰影、泥巴）
function radialTex(stops: [number, string][], extra?: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  return canvasTex(256, 256, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [t, col] of stops) g.addColorStop(t, col);
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
    extra?.(c, w);
  });
}

// 一叢香蒲：細長的劍葉＋頂端咖啡色的蒲棒
function reeds(kit: Kit, parent: THREE.Object3D, x: number, z: number, n: number, h: number, rand: () => number): void {
  const blade = withWind(kit.m('#5f9e3a', { roughness: 0.7 }), 0.35);
  const blade2 = withWind(kit.m('#7fb84a', { roughness: 0.7 }), 0.35);
  const stem = kit.m('#6a9a3a', { roughness: 0.7 });
  const head = kit.m('#7a4a2a', { roughness: 0.85 });
  for (let i = 0; i < n * 2; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.16;
    const b = P(parent, GEO.blade, i % 2 ? blade : blade2, [x + Math.cos(a) * r, 0, z + Math.sin(a) * r], null, [1.4, h * (1.6 + rand() * 1.2), 1.4]);
    b.quaternion.setFromUnitVectors(V(0, 1, 0), V(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize());
  }
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.12;
    const hh = h * (0.75 + rand() * 0.45);
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    const tx = bx + Math.cos(a) * 0.08, tz = bz + Math.sin(a) * 0.08;
    stick(parent, V(bx, 0, bz), V(tx, hh, tz), 0.012, stem, false);
    const c = P(parent, GEO.capsule, head, [bx + (tx - bx) * 0.86, hh * 0.86, bz + (tz - bz) * 0.86], null, [0.05, 0.06, 0.05]);
    c.quaternion.setFromUnitVectors(V(0, 1, 0), V(tx - bx, hh, tz - bz).normalize());
  }
}

// 小青蛙石像：圓滾滾的身體、大眼睛、粉紅腮紅
function frog(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, ry: number): void {
  const f = new THREE.Group();
  f.position.set(x, y, z);
  f.rotation.y = ry;
  const green = kit.m('#6cc04a', { roughness: 0.55 }), belly = kit.m('#e6f2b0'), white = kit.m('#ffffff', { roughness: 0.3 }), black = kit.m('#1e1a18', { roughness: 0.3 });
  P(f, GEO.sphere, green, [0, 0.1, 0], null, [0.26, 0.18, 0.24]);
  P(f, GEO.sphere, belly, [0, 0.08, 0.06], null, [0.18, 0.12, 0.16], false);
  for (const s of [-1, 1]) {
    P(f, GEO.sphere, green, [s * 0.06, 0.18, 0.03], null, 0.1);
    P(f, GEO.sphereLo, white, [s * 0.065, 0.2, 0.065], null, 0.06, false);
    P(f, GEO.sphereLo, black, [s * 0.066, 0.205, 0.088], null, 0.032, false);
    P(f, GEO.sphereLo, kit.m('#ff9aa8'), [s * 0.085, 0.12, 0.09], null, [0.04, 0.025, 0.02], false);
    P(f, GEO.sphere, green, [s * 0.09, 0.03, 0.08], null, [0.08, 0.05, 0.1], false);
  }
  P(f, rbox(0.06, 0.008, 0.01, 0.003), black, [0, 0.135, 0.118], null, null, false);
  parent.add(f);
}

export interface PondDeco { group: THREE.Group; hit: THREE.Group; glow: GlowMat[] }

// level 0 = 預定地（乾凹地＋木牌）；building = 施工中（泥坑、鏟子、手推車、木樁拉繩）；1 = 完成的池塘
export function buildPond(level: number, building: boolean): PondDeco {
  const kit = new Kit();
  const group = new THREE.Group();
  const hit = new THREE.Group();
  hit.userData.kind = 'pond';
  hit.userData.dyn = true;
  group.add(hit);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const rand = mulberry32(77 + level * 3 + (building ? 1 : 0));
  const stoneMats = [kit.m('#b9b3a6', { roughness: 0.92 }), kit.m('#a59e92', { roughness: 0.92 }), kit.m('#cfc8b8', { roughness: 0.92 })];
  const ellipse = (k: number) => { const g = new THREE.CircleGeometry(1, 64); g.rotateX(-Math.PI / 2); g.scale(POND_RX * k, 1, POND_RZ * k); return g; };

  if (level < 1) {
    if (!building) {
      // ---- 預定地：微微下凹的乾草地（顏色跟著季節地面）、小石頭虛線外框、兩叢蘆葦 ----
      const d = new THREE.Mesh(hollowGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      d.position.y = 0.004;
      d.receiveShadow = true;
      d.userData.dyn = true;
      group.add(d);
      group.userData.hollow = d;
      const N = 30;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const [x, z] = onRim(a, 1.0);
        P(group, GEO.ico, stoneMats[i % 3], [x, 0.02, z], [0, a, 0], [0.16 + rand() * 0.06, 0.07, 0.12], false);
      }
      reeds(kit, group, ...onRim(-0.9, 1.0), 4, 0.55, rand);
      reeds(kit, group, ...onRim(3.5, 1.0), 3, 0.45, rand);
      const sp = new THREE.Group();
      sp.position.set(POND_SIGN[0], 0, POND_SIGN[1]);
      signpost(kit, sp, '池塘預定地', 'Lv30', '#4f94c4');
      hit.add(sp);
    } else {
      // ---- 施工中：泥坑（中間積了一點水）、兩堆土、插著的鏟子、手推車、木樁拉繩 ----
      const mud = mat('#ffffff', {
        roughness: 0.95,
        map: radialTex([[0, '#4a3220'], [0.35, '#5d4029'], [0.8, '#7a5838'], [0.95, '#8c6a46'], [1, '#93734e']], (c, w) => {
          c.fillStyle = 'rgba(120,150,165,0.75)';
          c.beginPath();
          c.ellipse(w * 0.46, w * 0.52, w * 0.16, w * 0.11, 0.3, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = 'rgba(255,255,255,0.35)';
          c.beginPath();
          c.ellipse(w * 0.42, w * 0.49, w * 0.05, w * 0.02, 0.3, 0, Math.PI * 2);
          c.fill();
          // 鏟痕
          c.strokeStyle = 'rgba(40,25,15,0.35)';
          c.lineWidth = 4;
          for (let i = 0; i < 14; i++) { const a = i * 0.45, r = w * (0.22 + (i % 4) * 0.06); c.beginPath(); c.arc(w / 2, w / 2, r, a, a + 0.35); c.stroke(); }
        }),
      });
      P(group, ellipse(1.08), mud, [0, 0.006, 0], null, null, false);
      // 坑緣翻起的土
      const dirt = kit.m('#8a6644', { roughness: 0.95 }), dirt2 = kit.m('#7a5838', { roughness: 0.95 });
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + rand() * 0.1;
        const [x, z] = onRim(a, 1.06);
        P(group, GEO.sphereLo, i % 2 ? dirt : dirt2, [x, 0.0, z], [0, a, 0], [0.42 + rand() * 0.2, 0.14 + rand() * 0.06, 0.26], false);
      }
      for (const [x, z, s] of [[POND_BUILD_BLOCK[0][0], POND_BUILD_BLOCK[0][1], 1], [POND_BUILD_BLOCK[1][0], POND_BUILD_BLOCK[1][1], 0.8]] as [number, number, number][]) {
        P(group, GEO.sphere, dirt, [x, 0, z], null, [1.1 * s, 0.75 * s, 0.9 * s]);
        P(group, GEO.sphere, dirt2, [x + 0.25 * s, 0.05, z + 0.12], null, [0.6 * s, 0.45 * s, 0.5 * s]);
      }
      // 鏟子：斜插在土堆上
      const sh = new THREE.Group();
      sh.position.set(POND_BUILD_BLOCK[0][0] - 0.1, 0.3, POND_BUILD_BLOCK[0][1] + 0.1);
      sh.rotation.set(0.25, 0.4, -0.3);
      const metal = kit.m('#9aa4ac', { metalness: 0.6, roughness: 0.35 });
      P(sh, GEO.cyl, kit.m('#c9985a'), [0, 0.45, 0], null, [0.045, 0.9, 0.045]);
      P(sh, rbox(0.2, 0.05, 0.05, 0.02), kit.m('#3a3a3a'), [0, 0.92, 0]);
      P(sh, rbox(0.22, 0.26, 0.03, 0.03), metal, [0, -0.08, 0]);
      group.add(sh);
      // 手推車（裝了土）
      const wb = new THREE.Group();
      wb.position.set(POND_BUILD_BLOCK[2][0], 0, POND_BUILD_BLOCK[2][1]);
      wb.rotation.y = -0.6;
      const tray = kit.m('#5aa0d0', { roughness: 0.55 }), iron = kit.m('#4a4a50', { metalness: 0.4, roughness: 0.5 });
      P(wb, rbox(0.55, 0.26, 0.75, 0.06), tray, [0, 0.42, 0]);
      P(wb, GEO.sphere, dirt, [0, 0.55, 0], null, [0.48, 0.2, 0.64], false);
      P(wb, new THREE.TorusGeometry(0.15, 0.05, 8, 18), kit.m('#2e2e30'), [0, 0.18, 0.45], [0, Math.PI / 2, 0]);
      P(wb, GEO.cyl, iron, [0, 0.18, 0.45], [0, 0, Math.PI / 2], [0.04, 0.14, 0.04], false);
      for (const s of [-1, 1]) {
        stick(wb, V(s * 0.12, 0.18, 0.45), V(s * 0.22, 0.42, -0.85), 0.02, iron);
        stick(wb, V(s * 0.2, 0.32, -0.3), V(s * 0.2, 0, -0.32), 0.018, iron);
        P(wb, GEO.capsule, kit.m('#2e2e30'), [s * 0.22, 0.43, -0.88], [Math.PI / 2 - 0.25, 0, 0], [0.05, 0.06, 0.05], false);
      }
      group.add(wb);
      // 木樁拉繩（西南角木牌那段留空）
      const stake = kit.m('#b98a5e'), flag = kit.m('#f28a3a', { side: THREE.DoubleSide });
      const rope = kit.m('#efe2c0', { roughness: 0.9 });
      const N = 10;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + 0.2;
        const [x, z] = onRim(a, 1.2);
        pts.push(V(x, 0.36, z));
        P(group, rbox(0.06, 0.46, 0.06, 0.02), stake, [x, 0.23, z], [0.06, a, 0]);
        if (i % 3 === 0) P(group, new THREE.PlaneGeometry(0.16, 0.1), flag, [x + 0.08, 0.42, z], null, null, false);
      }
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[(i + 1) % N];
        if (i === 3) continue; // 木牌前面那段
        cord(group, sag(a, b, 0.07, 6), rope, 0.012);
      }
      const sp = new THREE.Group();
      sp.position.set(POND_SIGN[0], 0, POND_SIGN[1]);
      sp.rotation.y = 0.15;
      signpost(kit, sp, '施工中', '挖池塘中', '#e8a23a');
      hit.add(sp);
      const hb2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.3), hitMat);
      hb2.position.set(POND_BUILD_BLOCK[2][0], 0.45, POND_BUILD_BLOCK[2][1]);
      hb2.rotation.y = -0.6;
      hit.add(hb2);
    }
    const hb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 0.5), hitMat);
    hb.position.set(POND_SIGN[0], 0.75, POND_SIGN[1]);
    hit.add(hb);
    bake(group);
    return { group, glow: kit.glow, hit };
  }

  // ---- 完成的池塘 ----
  // 沙岸：比水面大一圈、邊緣起伏，南側多一片小沙灘
  const sandShape = new THREE.Shape();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const [x, z] = onRim(a, sandK(a));
    if (i === 0) sandShape.moveTo(x, -z); else sandShape.lineTo(x, -z);
  }
  const sandGeo = new THREE.ShapeGeometry(sandShape, 4);
  sandGeo.rotateX(-Math.PI / 2);
  P(group, sandGeo, kit.m('#ead8a6', { roughness: 1 }), [0, 0.004, 0], null, null, false);
  // 水面
  const water = new THREE.Mesh(ellipse(1.0), waterMat());
  water.position.y = POND_WATER_Y;
  water.receiveShadow = true;
  water.userData.dyn = true; // 不跟其他零件合併（自訂著色器）
  group.add(water);
  // 石頭岸：沙灘（南）與碼頭（西南）留空
  const DOCK_A = 2.5;
  const skip = (a: number) => {
    const n = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return (n > 1.22 && n < 2.25) || Math.abs(n - DOCK_A) < 0.24;
  };
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rand() * 0.05;
    if (skip(a)) continue;
    const [x, z] = onRim(a, 1.02 + rand() * 0.04);
    const tx = -Math.sin(a) * POND_RX, tz = Math.cos(a) * POND_RZ;
    const big = i % 5 === 0;
    P(group, GEO.ico, stoneMats[i % 3], [x, 0.05, z], [rand() * 0.3, Math.atan2(-tz, tx), rand() * 0.2], [(big ? 0.4 : 0.3) + rand() * 0.08, (big ? 0.2 : 0.14) + rand() * 0.04, 0.24 + rand() * 0.06]);
  }
  // 沙灘上幾顆小卵石
  for (let i = 0; i < 6; i++) {
    const a = 1.35 + rand() * 0.8;
    const [x, z] = onRim(a, 1.12 + rand() * 0.12);
    P(group, GEO.ico, stoneMats[(i + 1) % 3], [x, 0.02, z], [0, rand() * 3, 0], [0.1 + rand() * 0.06, 0.05, 0.08], false);
  }
  // 大石頭＋青蛙石像（北岸，不會擋到鏡頭）
  const [r1x, r1z] = onRim(-1.95, 1.12), [r2x, r2z] = onRim(0.25, 1.14), [frx, frz] = onRim(-2.3, 1.1);
  P(group, GEO.ico, stoneMats[1], [r1x, 0.12, r1z], [0.2, 0.6, 0.1], [0.7, 0.42, 0.55]);
  P(group, GEO.ico, stoneMats[2], [r2x, 0.08, r2z], [0, 0.4, 0.15], [0.5, 0.3, 0.42]);
  P(group, GEO.ico, stoneMats[0], [frx, 0.1, frz], [0.1, 1.2, 0], [0.62, 0.36, 0.5]);
  frog(kit, group, frx, 0.25, frz + 0.02, 0.35);
  // 香蒲叢：東北、西北、東側
  reeds(kit, group, ...onRim(-0.95, 1.08), 5, 0.8, rand);
  reeds(kit, group, ...onRim(-2.75, 1.08), 4, 0.7, rand);
  reeds(kit, group, ...onRim(0.55, 1.1), 3, 0.6, rand);
  reeds(kit, group, ...onRim(1.15, 1.12), 2, 0.4, rand);
  // 睡蓮葉（避開水生作物的 6 個位置）＋一朵小白睡蓮
  // 睡蓮葉自己合併成一個網格（bake 會丟掉頂點色）
  const pads: [number, number, number][] = [[-1.85, -0.05, 0.26], [1.95, -0.1, 0.22], [-0.4, -0.1, 0.19], [0.68, 0.02, 0.17], [1.05, -1.45, 0.18], [-0.55, 1.42, 0.16]];
  const padGeos: THREE.BufferGeometry[] = [];
  const pmx = new THREE.Matrix4(), pq = new THREE.Quaternion();
  for (const [x, z, r] of pads) {
    if (POND_SLOTS.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 0.6)) continue;
    pq.setFromAxisAngle(V(0, 1, 0), rand() * 6.28);
    padGeos.push(lilyPadGeo().clone().applyMatrix4(pmx.compose(V(x, POND_WATER_Y + 0.004, z), pq, V(r, 1, r))));
  }
  const padMesh = new THREE.Mesh(mergeGeometries(padGeos)!, lilyPadMat());
  padMesh.receiveShadow = true;
  padMesh.userData.dyn = true;
  group.add(padMesh);
  const lily = new THREE.Group();
  lily.position.set(-1.85, POND_WATER_Y + 0.03, -0.05);
  const pw = kit.m('#fffaf4', { roughness: 0.4, emissive: '#fff6e8', emissiveIntensity: 0.05 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    P(lily, GEO.sphereLo, pw, [Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05], [Math.sin(a) * 0.9, -a, -Math.cos(a) * 0.9], [0.05, 0.02, 0.1], false).rotation.order = 'YXZ';
  }
  P(lily, GEO.sphereLo, kit.m('#ffd23a'), [0, 0.035, 0], null, [0.05, 0.03, 0.05], false);
  group.add(lily);

  // 小木碼頭（西南岸，伸出水面一小段）
  const [dsx, dsz] = onRim(DOCK_A, 1.0);
  const dirx = -Math.cos(DOCK_A) * POND_RZ, dirz = -Math.sin(DOCK_A) * POND_RX; // 往池中心的法線方向（近似）
  const dl = Math.hypot(dirx, dirz);
  const ux = dirx / dl, uz = dirz / dl;
  const dock = new THREE.Group();
  dock.position.set(dsx - ux * 0.22, 0, dsz - uz * 0.22);
  dock.rotation.y = Math.atan2(ux, uz); // 碼頭本地 +z 指向水裡
  const plank = kit.m('#c9985e', { roughness: 0.85 }), plank2 = kit.m('#b8874f', { roughness: 0.85 }), post = kit.m('#8a5a3a', { roughness: 0.9 });
  for (let i = 0; i < 6; i++) P(dock, rbox(0.78, 0.05, 0.17, 0.02), i % 2 ? plank : plank2, [(rand() - 0.5) * 0.04, 0.11, -0.5 + i * 0.19], [0, (rand() - 0.5) * 0.04, 0]);
  for (const s of [-1, 1]) P(dock, rbox(0.07, 0.07, 1.15, 0.02), post, [s * 0.3, 0.06, -0.03], null, null, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(dock, GEO.cyl, post, [sx * 0.36, sz > 0 ? 0.08 : 0.1, sz * 0.5], null, [0.08, sz > 0 ? 0.26 : 0.2, 0.08]);
  // 碼頭邊的燈柱＋小木牌（夜晚亮）
  const lp = new THREE.Group();
  lp.position.set(-0.46, 0, -0.45);
  // 木柱頂上一盞小燈籠（四角小屋頂）
  P(lp, rbox(0.09, 0.8, 0.09, 0.025), post, [0, 0.4, 0]);
  P(lp, rbox(0.17, 0.03, 0.17, 0.01), kit.m('#4a3a2a'), [0, 0.815, 0], null, null, false);
  P(lp, rbox(0.14, 0.17, 0.14, 0.04), kit.lit('#ffe2a0', '#ffb347', 2.6, 0), [0, 0.915, 0], null, null, false);
  P(lp, new THREE.ConeGeometry(0.14, 0.1, 4), kit.m('#4a3a2a'), [0, 1.05, 0], [0, Math.PI / 4, 0], null, false);
  dock.add(lp);
  // 碼頭頭上的小水桶
  P(dock, new THREE.CylinderGeometry(0.09, 0.07, 0.14, 12), kit.m('#6aa8c8', { metalness: 0.3, roughness: 0.45 }), [0.22, 0.2, 0.3]);
  group.add(dock);
  // 點擊區：整個碼頭＋燈柱
  const hd = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 1.4), hitMat);
  hd.position.copy(dock.position).setY(0.4);
  hd.rotation.y = dock.rotation.y;
  hit.add(hd);
  bake(group);
  return { group, glow: kit.glow, hit };
}

// ---------- 漣漪＋魚跳（每幀更新） ----------
interface Ring { m: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; delay: number; size: number; on: boolean }
const RING_GEO = (() => { const g = new THREE.RingGeometry(0.86, 1.0, 40); g.rotateX(-Math.PI / 2); return g; })();

export class PondFx {
  group = new THREE.Group();
  active = false; // 池塘存在時才有環境漣漪、魚跳
  private rings: Ring[] = [];
  private cx = 0;
  private cz = 0;
  private k = 1;
  private rot = 0;
  private ambT = 2;
  private fishT = 6;
  private fish: THREE.Group;
  private jump: { sx: number; sz: number; ex: number; ez: number; t: number; dur: number } | null = null;
  private drops: { m: THREE.Mesh; vx: number; vy: number; vz: number; t: number }[] = [];
  private dropMat = new THREE.MeshBasicMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.9 });
  private rand = mulberry32(911);

  constructor() {
    this.group.position.y = POND_WATER_Y + 0.006;
    for (let i = 0; i < 12; i++) {
      const m2 = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(RING_GEO, m2);
      m.visible = false;
      m.renderOrder = 3;
      this.group.add(m);
      this.rings.push({ m, mat: m2, t: 0, delay: 0, size: 1, on: false });
    }
    // 跳出水面的小錦鯉
    this.fish = new THREE.Group();
    const orange = mat('#ff8a3a', { roughness: 0.4 }), white = mat('#fff6ee', { roughness: 0.4 });
    P(this.fish, GEO.sphere, orange, [0, 0, 0], null, [0.08, 0.08, 0.22], false);
    P(this.fish, GEO.sphere, white, [0, 0.02, 0.04], null, [0.07, 0.06, 0.1], false);
    P(this.fish, GEO.cone, orange, [0, 0, -0.15], [Math.PI / 2, 0, 0], [0.02, 0.1, 0.12], false);
    this.fish.visible = false;
    this.group.add(this.fish);
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(GEO.sphereLo, this.dropMat);
      d.scale.setScalar(0.035);
      d.visible = false;
      this.group.add(d);
      this.drops.push({ m: d, vx: 0, vy: 0, vz: 0, t: 1 });
    }
  }

  setPond(x: number, z: number, rotY: number, scale: number, active: boolean): void {
    this.cx = x; this.cz = z; this.rot = rotY; this.k = scale; this.active = active;
    if (!active) { this.fish.visible = false; this.jump = null; }
  }

  // 世界座標 → 是否在水面內（留一點邊）
  private inWater(x: number, z: number, k = 0.92): boolean {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), dx = (x - this.cx) / this.k, dz = (z - this.cz) / this.k;
    return inPondEllipse(dx * c - dz * s, dx * s + dz * c, k);
  }

  // 在水面隨機取一點（世界座標）
  private randomPoint(k: number): [number, number] {
    const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * k;
    const lx = Math.cos(a) * r * POND_RX, lz = Math.sin(a) * r * POND_RZ;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [this.cx + (lx * c + lz * s) * this.k, this.cz + (-lx * s + lz * c) * this.k];
  }

  // 在 (x,z) 產生一圈往外擴散的漣漪（約 1 秒淡出）；size 1 ≈ 最後直徑 1.1 公尺
  ripple(x: number, z: number, size = 1): void {
    for (const [delay, sz] of [[0, size], [0.22, size * 0.7]] as [number, number][]) {
      let r = this.rings.find((q) => !q.on);
      if (!r) r = this.rings.reduce((a, b) => (a.t > b.t ? a : b));
      r.on = true; r.t = 0; r.delay = delay; r.size = sz;
      r.m.position.set(x, 0, z);
      r.m.visible = false;
    }
  }

  update(dt: number, _t: number, night: number): void {
    const col = night > 0.5 ? '#cfe0ff' : '#ffffff';
    for (const r of this.rings) {
      if (!r.on) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt;
      const u = r.t / 1.05;
      if (u >= 1) { r.on = false; r.m.visible = false; continue; }
      const e = 1 - (1 - u) * (1 - u);
      r.m.visible = true;
      r.m.scale.setScalar(r.size * (0.06 + 0.5 * e));
      r.mat.opacity = 0.7 * Math.pow(1 - u, 1.4);
      r.mat.color.set(col);
    }
    // 水花
    for (const d of this.drops) {
      if (d.t >= 0.6) continue;
      d.t += dt;
      d.vy -= 6 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      d.m.visible = d.t < 0.6 && d.m.position.y > -0.01;
    }
    if (!this.active) return;
    // 環境漣漪：偶爾一圈（小蟲點水）
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 2.2 + this.rand() * 3.5;
      const [x, z] = this.randomPoint(0.8);
      this.ripple(x, z, 0.45 + this.rand() * 0.3);
    }
    // 魚跳：從水裡畫一道弧線再落回水中，起落各一圈漣漪＋水花
    this.fishT -= dt;
    if (this.fishT <= 0 && !this.jump) {
      this.fishT = 9 + this.rand() * 10;
      const [sx, sz] = this.randomPoint(0.55);
      const a = this.rand() * Math.PI * 2, L = 0.55 + this.rand() * 0.3;
      const ex = sx + Math.cos(a) * L, ez = sz + Math.sin(a) * L;
      if (this.inWater(ex, ez)) {
        this.jump = { sx, sz, ex, ez, t: 0, dur: 0.75 };
        this.ripple(sx, sz, 0.6);
        this.splash(sx, sz, 3);
      }
    }
    if (this.jump) {
      const j = this.jump;
      j.t += dt;
      const u = Math.min(1, j.t / j.dur);
      const y = 0.42 * 4 * u * (1 - u) - 0.06;
      this.fish.visible = y > -0.04;
      this.fish.position.set(j.sx + (j.ex - j.sx) * u, y, j.sz + (j.ez - j.sz) * u);
      this.fish.rotation.set(0, 0, 0);
      this.fish.rotation.y = Math.atan2(j.ex - j.sx, j.ez - j.sz);
      this.fish.rotateX(-(1 - 2 * u) * 1.1);
      if (u >= 1) {
        this.jump = null;
        this.fish.visible = false;
        this.ripple(j.ex, j.ez, 0.9);
        this.splash(j.ex, j.ez, 6);
      }
    }
  }

  private splash(x: number, z: number, n: number): void {
    let k = 0;
    for (const d of this.drops) {
      if (k >= n) break;
      if (d.t < 0.6) continue;
      const a = this.rand() * Math.PI * 2, sp = 0.4 + this.rand() * 0.5;
      d.t = 0; d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = 1.4 + this.rand() * 0.8;
      d.m.position.set(x, 0, z);
      d.m.visible = true;
      k++;
    }
  }
}

// =====================================================================
// 蜂箱
// =====================================================================

const BEE_COUNT = 6;
let beeAssets: { body: THREE.BufferGeometry; wings: THREE.BufferGeometry; bodyMat: THREE.Material; wingMat: THREE.Material } | null = null;
function bees(): NonNullable<typeof beeAssets> {
  if (beeAssets) return beeAssets;
  // 身體：沿 +y 的長橢圓，貼圖上端黑色頭、黃黑相間的條紋
  const tex = canvasTex(16, 64, (c) => {
    c.fillStyle = '#ffd23a';
    c.fillRect(0, 0, 16, 64);
    c.fillStyle = '#2a2018';
    c.fillRect(0, 0, 16, 15);
    c.fillRect(0, 26, 16, 8);
    c.fillRect(0, 42, 16, 8);
    c.fillRect(0, 59, 16, 5);
  });
  const body = new THREE.SphereGeometry(0.5, 12, 10);
  body.scale(0.075, 0.12, 0.07);
  // 翅膀：背上（+z）一對往外上方張開的半透明薄片
  const wing = (s: number) => {
    const w = new THREE.SphereGeometry(0.5, 8, 6);
    w.deleteAttribute('uv');
    w.scale(0.075, 0.05, 0.01);
    w.rotateY(-s * 0.45);
    w.translate(s * 0.045, -0.01, 0.04);
    return w;
  };
  const wings = mergeGeometries([wing(-1), wing(1)])!;
  beeAssets = {
    body,
    wings,
    bodyMat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }),
    wingMat: new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, roughness: 0.2, emissive: '#ffffff', emissiveIntensity: 0.25, depthWrite: false }),
  };
  return beeAssets;
}

// 空的蜂箱架：木架＋插著一塊「蜂箱位」小木牌（還沒放蜂箱的位置）
export function buildHiveStand(): THREE.Group {
  const kit = new Kit();
  const g = new THREE.Group();
  hiveStandParts(kit, g);
  const tex = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#f6e7c4';
    c.beginPath();
    c.roundRect(6, 6, w - 12, h - 12, 20);
    c.fill();
    // 小蜂巢六角形
    c.fillStyle = '#f2b82a';
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; c.lineTo(52 + Math.cos(a) * 30, h / 2 + Math.sin(a) * 30); }
    c.closePath();
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = `bold 40px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('+', 52, h / 2 + 2);
    c.fillStyle = '#7a4a2a';
    c.font = `bold 46px ${FONT_ROUND}`;
    c.fillText('蜂箱位', 162, h / 2 + 3);
  });
  const sign = new THREE.Group();
  sign.position.set(0.28, 0, 0.32);
  sign.rotation.y = -0.25;
  P(sign, rbox(0.05, 0.5, 0.05, 0.015), kit.m('#8a5a3a'), [0, 0.25, 0]);
  P(sign, rbox(0.42, 0.22, 0.04, 0.02), kit.m('#a8744a'), [0, 0.5, 0.01]);
  texPlane(sign, tex, 0.38, 0.19, [0, 0.5, 0.035]);
  g.add(sign);
  // 架子旁邊兩小叢花（吸引蜜蜂的意象）
  for (const [x, z, c] of [[-0.32, 0.25, '#ffd84a'], [0.05, 0.36, '#ff9ac0']] as [number, number, string][]) {
    P(g, GEO.ico, kit.m('#5fae44'), [x, 0.06, z], null, [0.18, 0.12, 0.16], false);
    for (let i = 0; i < 3; i++) P(g, GEO.sphereLo, kit.m(c), [x + Math.cos(i * 2.1) * 0.05, 0.13, z + Math.sin(i * 2.1) * 0.05], null, 0.05, false);
  }
  bake(g);
  return g;
}

// 木架（兩種蜂箱共用）：四隻腳＋平台
function hiveStandParts(kit: Kit, g: THREE.Object3D): void {
  const wood = kit.m('#b98a5e', { roughness: 0.85 }), woodD = kit.m('#8a5a3a', { roughness: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, rbox(0.06, 0.18, 0.06, 0.015), woodD, [sx * 0.24, 0.09, sz * 0.19]);
  P(g, rbox(0.62, 0.045, 0.5, 0.015), wood, [0, 0.2, 0]);
  for (const sz of [-1, 1]) P(g, rbox(0.56, 0.03, 0.03, 0.01), woodD, [0, 0.08, sz * 0.19], null, null, false);
}

// 粉彩疊箱式蜂箱（Langstroth）：木架、出入口＋停降板、三層箱（白／淡黃／白）、山形屋頂；約 0.95 公尺高
export function buildBeehive(): THREE.Group {
  const kit = new Kit();
  const g = new THREE.Group();
  hiveStandParts(kit, g);
  const cream = kit.m('#fbf3df', { roughness: 0.75 }), yellow = kit.m('#ffd96e', { roughness: 0.75 }), seam = kit.m('#e6d4a8', { roughness: 0.8 });
  const dark = kit.m('#3a2a1e', { roughness: 1 }), roofM = kit.m('#e8735a', { roughness: 0.7 }), roofD = kit.m('#c95a44', { roughness: 0.7 });
  const W = 0.52, D = 0.42;
  // 底板＋往前斜的停降板＋出入口
  P(g, rbox(W + 0.02, 0.04, D + 0.06, 0.012), kit.m('#d8b884'), [0, 0.245, 0.02]);
  P(g, rbox(0.42, 0.022, 0.16, 0.01), kit.m('#d8b884'), [0, 0.24, 0.3], [0.14, 0, 0]);
  // 三層箱
  const boxes: [number, number, THREE.Material][] = [[0.265, 0.24, cream], [0.505, 0.16, yellow], [0.665, 0.14, cream]];
  for (const [y0, h, m] of boxes) {
    P(g, rbox(W, h, D, 0.025), m, [0, y0 + h / 2, 0]);
    // 兩側的把手凹槽
    for (const s of [-1, 1]) P(g, rbox(0.02, 0.028, 0.12, 0.008), seam, [s * (W / 2 + 0.002), y0 + h * 0.62, 0], null, null, false);
    P(g, rbox(W + 0.012, 0.012, D + 0.012, 0.005), seam, [0, y0 + 0.006, 0], null, null, false);
  }
  P(g, rbox(0.3, 0.03, 0.02, 0.008), dark, [0, 0.285, D / 2 + 0.002], null, null, false);
  // 正面的蜂巢六角徽章
  P(g, new THREE.CylinderGeometry(0.055, 0.055, 0.012, 6), kit.m('#f2b82a', { roughness: 0.5 }), [0, 0.585, D / 2 + 0.006], [Math.PI / 2, Math.PI / 6, 0], null, false);
  // 內蓋＋山形屋頂
  const yt = 0.805;
  P(g, rbox(W + 0.06, 0.035, D + 0.06, 0.012), seam, [0, yt + 0.018, 0]);
  const rise = 0.13, half = W / 2 + 0.06;
  const len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [-1, 1]) P(g, rbox(len + 0.02, 0.035, D + 0.12, 0.012), roofM, [s * half / 2, yt + 0.04 + rise / 2, 0], [0, 0, -s * ang]);
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2 - 0.02, 0); tri.lineTo(W / 2 + 0.02, 0); tri.lineTo(0, rise); tri.closePath();
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: D, bevelEnabled: false });
  P(g, triGeo, cream, [0, yt + 0.035, -D / 2]);
  P(g, GEO.cyl, roofD, [0, yt + 0.045 + rise, 0], [Math.PI / 2, 0, 0], [0.04, D + 0.14, 0.04]);

  // 蜂蜜（可收成時顯示）：箱縫流下的一滴金黃蜂蜜＋地上一罐閃閃發亮的蜂蜜
  const honey = new THREE.Group();
  honey.userData.dyn = true;
  const honeyM = mat('#ffb422', { roughness: 0.15, emissive: '#ff9a10', emissiveIntensity: 0.25 });
  for (const [x, l] of [[0.1, 0.05], [0.17, 0.028]] as [number, number][]) {
    P(honey, GEO.capsule, honeyM, [x, 0.505 - l * 0.6, D / 2 + 0.008], null, [0.024, l * 0.6, 0.014], false);
    P(honey, GEO.sphere, honeyM, [x, 0.5 - l * 1.25, D / 2 + 0.012], null, [0.032, 0.04, 0.024], false);
  }
  P(honey, GEO.sphere, honeyM, [0.135, 0.505, D / 2 + 0.006], null, [0.13, 0.022, 0.016], false);
  const jar = new THREE.Group();
  jar.position.set(-0.42, 0, 0.3);
  P(jar, new THREE.CylinderGeometry(0.07, 0.065, 0.12, 14), honeyM, [0, 0.06, 0]);
  P(jar, new THREE.CylinderGeometry(0.078, 0.078, 0.025, 14), kit.m('#e8584a'), [0, 0.13, 0], null, null, false);
  P(jar, GEO.sphereLo, kit.m('#fbf3df'), [0, 0.152, 0], null, [0.12, 0.03, 0.12], false);
  honey.add(jar);
  // 閃光：十字形的小星芒（夠亮會被 bloom 撿到）
  const glintM = new THREE.MeshBasicMaterial({ color: '#fff6cc', transparent: true, opacity: 0.9, depthWrite: false });
  const glint = new THREE.Group();
  glint.userData.dyn = true;
  glint.position.set(-0.39, 0.14, 0.38);
  P(glint, new THREE.PlaneGeometry(0.14, 0.022), glintM, [0, 0, 0], null, null, false);
  P(glint, new THREE.PlaneGeometry(0.022, 0.14), glintM, [0, 0, 0], null, null, false);
  honey.add(glint);
  bake(honey);
  honey.visible = false;
  g.add(honey);

  // 蜜蜂：兩個 InstancedMesh（身體、翅膀），位置每幀由 updateBeehive 算
  const A = bees();
  const bodyIM = new THREE.InstancedMesh(A.body, A.bodyMat, BEE_COUNT);
  const wingIM = new THREE.InstancedMesh(A.wings, A.wingMat, BEE_COUNT);
  for (const im of [bodyIM, wingIM]) { im.frustumCulled = false; im.castShadow = false; im.userData.dyn = true; g.add(im); }
  wingIM.renderOrder = 3;
  bake(g);
  g.userData.bees = { body: bodyIM, wings: wingIM };
  g.userData.honey = honey;
  g.userData.glint = glint;
  g.userData.honeyMat = honeyM;
  return g;
}

const bm = new THREE.Matrix4(), bm2 = new THREE.Matrix4(), bs = new THREE.Matrix4();
const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), bp = new THREE.Vector3(), bq = new THREE.Vector3();
// 第 i 隻蜜蜂在時間 t 的位置（蜂箱本地座標）：有的繞著箱子打轉，有的飛遠一點去採蜜，一隻在停降板前徘徊
function beePos(i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  if (i === BEE_COUNT - 1) return out.set(Math.sin(t * 1.3) * 0.16 + Math.sin(t * 9) * 0.02, 0.36 + Math.sin(t * 2.1) * 0.05, 0.42 + Math.cos(t * 1.7) * 0.06);
  const ph = i * 1.7, sp = (0.85 + (i % 3) * 0.28) * (i % 2 ? 1 : -1);
  const a = t * sp + ph;
  const far = i % 3 === 0;
  const R = far ? 0.85 + 0.35 * Math.sin(t * 0.37 + i) : 0.36 + 0.1 * Math.sin(t * 1.3 + i);
  return out.set(
    Math.cos(a) * R + Math.sin(t * 7.3 + i * 3) * 0.035,
    0.6 + 0.24 * Math.sin(t * 1.9 + ph) + Math.sin(t * 11 + i) * 0.02,
    Math.sin(a) * R * 0.85 + 0.12 + Math.cos(t * 6.1 + i) * 0.035,
  );
}

// 蜜蜂動畫：active（白天、非冬天）時繞著蜂箱飛，否則躲回箱子裡；honeyReady 時顯示蜂蜜與閃光
export function updateBeehive(obj: THREE.Object3D, t: number, active: boolean, honeyReady: boolean): void {
  const b = obj.userData.bees as { body: THREE.InstancedMesh; wings: THREE.InstancedMesh } | undefined;
  if (b) {
    b.body.visible = b.wings.visible = active;
    if (active) {
      for (let i = 0; i < BEE_COUNT; i++) {
        beePos(i, t, bp);
        beePos(i, t + 0.05, bq);
        by.subVectors(bq, bp);
        if (by.lengthSq() < 1e-8) by.set(0, 0, 1);
        by.normalize(); // 身體 +y = 前進方向
        bz.set(0, 1, 0).addScaledVector(by, -by.y).normalize(); // 背（+z）朝上
        bx.crossVectors(by, bz);
        bm.makeBasis(bx, by, bz).setPosition(bp);
        b.body.setMatrixAt(i, bm);
        const flap = 0.45 + 0.55 * Math.abs(Math.sin(t * 55 + i * 1.3));
        bm2.copy(bm).multiply(bs.makeScale(flap, 1, 1));
        b.wings.setMatrixAt(i, bm2);
      }
      b.body.instanceMatrix.needsUpdate = true;
      b.wings.instanceMatrix.needsUpdate = true;
    }
  }
  const honey = obj.userData.honey as THREE.Object3D | undefined;
  if (honey) {
    honey.visible = honeyReady;
    if (honeyReady) {
      const glint = obj.userData.glint as THREE.Object3D;
      const pulse = Math.pow(Math.max(0, Math.sin(t * 2.2)), 6);
      glint.scale.setScalar(0.25 + pulse * 1.1);
      glint.rotation.z = t * 0.8;
      (obj.userData.honeyMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + pulse * 0.6;
    }
  }
}

// =====================================================================
// 望遠鏡
// =====================================================================

// 黃銅望遠鏡＋木頭三腳架＋旁邊的星圖架；約 1.6 公尺高，鏡筒朝東北方天空（本地座標 +x、-z 方向）
const TELE_YAW = Math.atan2(1, -1), TELE_ELEV = 0.62; // 東北：x+、z-（three 的 yaw：sin = x、cos = z）
export function buildTelescope(): THREE.Group {
  const kit = new Kit();
  const g = new THREE.Group();
  const wood = kit.m('#a8744a', { roughness: 0.8 }), woodD = kit.m('#7a4f30', { roughness: 0.85 });
  const brass = kit.m('#c8963c', { metalness: 0.45, roughness: 0.4 }), brassD = kit.m('#9a6e26', { metalness: 0.45, roughness: 0.42 });
  const head = V(0, 1.1, 0);
  // 三腳架＋中間的置物三角板
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const foot = V(Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48);
    stick(g, foot, V(Math.cos(a) * 0.06, head.y - 0.04, Math.sin(a) * 0.06), 0.028, wood);
    P(g, GEO.cyl, brassD, [foot.x, 0.03, foot.z], null, [0.07, 0.06, 0.07], false);
    stick(g, V(Math.cos(a) * 0.2, 0.62, Math.sin(a) * 0.2), V(0, 0.62, 0), 0.012, woodD, false);
  }
  P(g, new THREE.CylinderGeometry(0.11, 0.11, 0.025, 3), woodD, [0, 0.63, 0], [0, 0.4, 0]);
  P(g, GEO.cyl, brassD, [0, head.y, 0], null, [0.14, 0.08, 0.14]);
  P(g, GEO.sphere, brass, [0, head.y + 0.07, 0], null, 0.1);
  // 鏡筒（會慢慢轉動）：沿本地 +z，物鏡在前
  const tube = new THREE.Group();
  tube.userData.dyn = true;
  tube.position.set(0, head.y + 0.08, 0);
  tube.rotation.order = 'YXZ';
  tube.rotation.set(-TELE_ELEV, TELE_YAW, 0);
  const T = new THREE.Group();
  T.position.z = 0.12;
  tube.add(T);
  const along = (geo: THREE.BufferGeometry, m: THREE.Material, z: number, s: [number, number, number], shadow = true) => P(T, geo, m, [0, 0, z], [Math.PI / 2, 0, 0], s, shadow);
  along(new THREE.CylinderGeometry(0.092, 0.07, 0.86, 18), brass, 0, [1, 1, 1]);
  along(new THREE.CylinderGeometry(0.108, 0.104, 0.2, 18), brassD, 0.5, [1, 1, 1]);
  for (const z of [-0.3, 0.05, 0.36]) along(new THREE.TorusGeometry(0.088, 0.014, 6, 18), brassD, z, [1, 1, 1], false).rotation.set(0, 0, 0);
  along(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 12), brassD, -0.5, [1, 1, 1]);
  along(new THREE.CylinderGeometry(0.042, 0.042, 0.05, 12), kit.m('#2a2622', { roughness: 0.6 }), -0.6, [1, 1, 1], false);
  // 物鏡玻璃＋鏡口一圈亮邊：夜晚會閃一下（從後面看也看得到亮邊）
  const lensM = mat('#8fd0ff', { roughness: 0.05, metalness: 0.2, emissive: '#cfe8ff', emissiveIntensity: 0.1 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), lensM);
  lens.position.z = 0.601;
  T.add(lens);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.012, 6, 24), lensM);
  rim.position.z = 0.605;
  T.add(rim);
  // 尋星鏡＋支架
  P(T, GEO.cyl, brass, [0, 0.13, -0.05], [Math.PI / 2, 0, 0], [0.05, 0.3, 0.05]);
  for (const z of [-0.14, 0.04]) P(T, rbox(0.02, 0.06, 0.02, 0.005), brassD, [0, 0.1, z], null, null, false);
  bake(tube);
  g.add(tube);
  // 星圖架：小講台，深藍星圖（夜晚微微發光）
  const chart = canvasTex(256, 192, (c, w, h) => {
    c.fillStyle = '#16244a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c9a65a';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
    const r = mulberry32(5);
    c.fillStyle = '#fff6d0';
    for (let i = 0; i < 40; i++) { c.beginPath(); c.arc(12 + r() * (w - 24), 12 + r() * (h - 24), 1 + r() * 1.8, 0, Math.PI * 2); c.fill(); }
    // 北斗七星
    const dip: [number, number][] = [[40, 60], [80, 52], [112, 66], [140, 88], [182, 84], [196, 124], [150, 132]];
    c.strokeStyle = 'rgba(160,200,255,0.8)';
    c.lineWidth = 2.5;
    c.beginPath();
    dip.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.lineTo(140, 88);
    c.stroke();
    c.fillStyle = '#ffffff';
    for (const [x, y] of dip) { c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); }
    // 月亮
    c.fillStyle = '#ffe9a0';
    c.beginPath(); c.arc(206, 40, 18, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#16244a';
    c.beginPath(); c.arc(214, 34, 16, 0, Math.PI * 2); c.fill();
  });
  const st = new THREE.Group();
  st.position.set(0.62, 0, 0.42);
  st.rotation.y = -0.5;
  P(st, rbox(0.05, 0.72, 0.05, 0.015), woodD, [0, 0.36, 0]);
  P(st, rbox(0.3, 0.03, 0.22, 0.01), woodD, [0, 0.015, 0], null, null, false);
  const board = new THREE.Group();
  board.position.set(0, 0.78, 0);
  board.rotation.x = -0.75;
  P(board, rbox(0.46, 0.34, 0.03, 0.012), wood, [0, 0, 0]);
  texPlane(board, chart, 0.42, 0.3, [0, 0, 0.018], 0, { emissive: '#ffffff', k: 0.5, base: 0.08, kit });
  P(board, rbox(0.46, 0.03, 0.05, 0.01), woodD, [0, -0.17, 0.02], null, null, false);
  st.add(board);
  g.add(st);
  bake(g);
  g.userData.tube = tube;
  g.userData.lens = lensM;
  g.userData.glow = kit.glow;
  return g;
}

// 夜晚鏡筒慢慢掃過天空、物鏡偶爾閃一下
export function updateTelescope(obj: THREE.Object3D, t: number, night: number): void {
  const tube = obj.userData.tube as THREE.Object3D | undefined;
  if (tube) {
    tube.rotation.y = TELE_YAW - obj.rotation.y + night * (0.22 * Math.sin(t * 0.13) + 0.05 * Math.sin(t * 0.41));
    tube.rotation.x = -TELE_ELEV - night * 0.08 * Math.sin(t * 0.09 + 1.0);
  }
  const lens = obj.userData.lens as THREE.MeshStandardMaterial | undefined;
  if (lens) lens.emissiveIntensity = 0.1 + night * (0.5 + Math.pow(Math.max(0, Math.sin(t * 0.9)), 12) * 3.2);
}

// =====================================================================
// 寵物小屋
// =====================================================================

// tier 1 = 原本的小狗屋（橘牆、藍屋頂）；tier 2 = 升級版：木平台、雙拱門、名牌、花台、圍欄小院
// 原點在地面中心、門朝 +z；tier 2 佔地 ≤ 2.2 × 1.8 公尺
export function buildPetHouse(tier: number): THREE.Group {
  const kit = new Kit();
  const g = new THREE.Group();
  const wall = kit.m('#d4764c'), roof = kit.m('#5b84c4'), holeM = kit.m('#2a1c18', { roughness: 1 }), cream = kit.m('#f3e7d3');
  if (tier < 2) {
    P(g, rbox(1.2, 0.9, 1.2, 0.1), wall, [0, 0.45, 0]);
    for (const s of [1, -1]) P(g, rbox(1.5, 0.12, 0.95, 0.05), roof, [0, 1.12, s * 0.32], [s * 0.62, 0, 0]);
    const tri = new THREE.Shape();
    tri.moveTo(-0.6, 0); tri.lineTo(0.6, 0); tri.lineTo(0, 0.5); tri.closePath();
    P(g, new THREE.ExtrudeGeometry(tri, { depth: 1.1, bevelEnabled: false }), wall, [0, 0.9, -0.55]);
    P(g, new THREE.CircleGeometry(0.3, 20, 0, Math.PI), holeM, [0, 0.24, 0.61], null, null, false);
    P(g, new THREE.PlaneGeometry(0.6, 0.25), holeM, [0, 0.12, 0.611], null, null, false);
    P(g, rbox(0.5, 0.16, 0.04, 0.02), cream, [0, 0.72, 0.62], null, null, false);
    bake(g);
    return g;
  }
  const wallD = kit.m('#c2653e'), roofD = kit.m('#4a70ad'), trim = kit.m('#fbf3e4');
  const deck = kit.m('#c9a06a', { roughness: 0.85 }), deckD = kit.m('#a8804e', { roughness: 0.85 }), fence = kit.m('#fbf6ec', { roughness: 0.7 });
  // 木平台
  P(g, rbox(2.1, 0.08, 1.7, 0.03), deck, [0, 0.04, 0]);
  for (let z = -0.6; z <= 0.61; z += 0.3) P(g, rbox(2.06, 0.012, 0.02, 0.005), deckD, [0, 0.081, z], null, null, false);
  // 主屋
  const hx = -0.2, hz = -0.3, W = 1.5, D = 1.05, H = 0.95, y0 = 0.08;
  const fz = hz + D / 2;
  P(g, rbox(W, H, D, 0.08), wall, [hx, y0 + H / 2, hz]);
  for (const y of [0.3, 0.55, 0.8]) P(g, rbox(W + 0.02, 0.045, D + 0.02, 0.02), wallD, [hx, y0 + y, hz], null, null, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, rbox(0.1, H + 0.02, 0.1, 0.03), trim, [hx + sx * W / 2, y0 + H / 2, hz + sz * D / 2]);
  // 屋頂：屋脊前後向（往左右兩邊斜下），前後是三角山牆
  const rise = 0.5, half = W / 2 + 0.12;
  const len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [1, -1]) P(g, rbox(len + 0.04, 0.09, D + 0.24, 0.035), roof, [hx + (s * half) / 2, y0 + H + rise / 2 + 0.04, hz], [0, 0, -s * ang]);
  P(g, GEO.cyl, roofD, [hx, y0 + H + rise + 0.07, hz], [Math.PI / 2, 0, 0], [0.1, D + 0.28, 0.1]);
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2, 0); tri.lineTo(W / 2, 0); tri.lineTo(0, rise); tri.closePath();
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.06, bevelEnabled: false });
  P(g, triGeo, wall, [hx, y0 + H, fz - 0.06]);
  P(g, triGeo, wall, [hx, y0 + H, hz - D / 2]);
  // 兩個拱門（白色門框）
  const archTrim = new THREE.TorusGeometry(0.2, 0.03, 6, 18, Math.PI);
  for (const dx of [-0.36, 0.36]) {
    const x = hx + dx;
    P(g, new THREE.CircleGeometry(0.18, 18, 0, Math.PI), holeM, [x, y0 + 0.4, fz + 0.011], null, null, false);
    P(g, new THREE.PlaneGeometry(0.36, 0.4), holeM, [x, y0 + 0.2, fz + 0.012], null, null, false);
    P(g, archTrim, trim, [x, y0 + 0.4, fz + 0.025], null, null, false);
    for (const s of [-1, 1]) P(g, rbox(0.055, 0.4, 0.05, 0.015), trim, [x + s * 0.2, y0 + 0.2, fz + 0.025], null, null, false);
  }
  // 名牌（山牆上）
  const plate = canvasTex(256, 96, (c, w, h) => {
    c.fillStyle = '#fbf3e4';
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, 26);
    c.fill();
    c.strokeStyle = '#c2653e';
    c.lineWidth = 6;
    c.stroke();
    // 小腳印
    c.fillStyle = '#c2653e';
    const paw = (x: number, y: number, s: number) => {
      c.beginPath(); c.ellipse(x, y + 6 * s, 11 * s, 9 * s, 0, 0, Math.PI * 2); c.fill();
      for (const [ox, oy] of [[-11, -7], [-4, -13], [4, -13], [11, -7]]) { c.beginPath(); c.arc(x + ox * s, y + oy * s, 4.2 * s, 0, Math.PI * 2); c.fill(); }
    };
    paw(36, h / 2, 1.1);
    paw(w - 36, h / 2, 1.1);
    c.fillStyle = '#7a4a2a';
    c.font = `bold 40px ${FONT_ROUND}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('毛孩之家', w / 2, h / 2 + 2);
  });
  P(g, rbox(0.62, 0.24, 0.03, 0.015), deckD, [hx, y0 + H + 0.17, fz + 0.01]);
  texPlane(g, plate, 0.58, 0.21, [hx, y0 + H + 0.17, fz + 0.03]);
  // 左側牆：圓窗（夜晚亮燈）＋花台
  const wx = hx - W / 2;
  P(g, new THREE.CylinderGeometry(0.15, 0.15, 0.04, 18), trim, [wx - 0.01, y0 + 0.58, hz], [0, 0, Math.PI / 2]);
  P(g, new THREE.CylinderGeometry(0.11, 0.11, 0.03, 18), kit.lit('#9ec9e8', '#ffbf66', 2.6, 0, { roughness: 0.15 }), [wx - 0.025, y0 + 0.58, hz], [0, 0, Math.PI / 2], null, false);
  const leafG = kit.m('#6fb24e');
  P(g, rbox(0.12, 0.1, 0.46, 0.03), leafG, [wx - 0.07, y0 + 0.36, hz]);
  const fc = ['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff'];
  for (let k = 0; k < 4; k++) P(g, GEO.sphereLo, kit.m(fc[k]), [wx - 0.08, y0 + 0.45, hz - 0.16 + k * 0.11], null, 0.1, false);
  // 平台前左角：長條花盆
  P(g, rbox(0.5, 0.14, 0.18, 0.04), wallD, [-0.72, 0.15, 0.7]);
  P(g, GEO.ico, leafG, [-0.72, 0.24, 0.7], null, [0.46, 0.12, 0.16], false);
  for (let k = 0; k < 4; k++) P(g, GEO.sphereLo, kit.m(fc[(k + 1) % 4]), [-0.9 + k * 0.12, 0.3, 0.7 + (k % 2 ? 0.03 : -0.03)], null, 0.09, false);
  // 圍欄小院（右前角）：白色尖頭木柵欄
  const picket = rbox(0.05, 0.3, 0.03, 0.012), tip = new THREE.ConeGeometry(0.035, 0.06, 4);
  const pickets = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 0.14);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      P(g, picket, fence, [x, 0.23, z], [0, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2, 0]);
      P(g, tip, fence, [x, 0.41, z], [0, Math.PI / 4, 0], null, false);
    }
    for (const y of [0.17, 0.31]) stick(g, V(x0, y, z0), V(x1, y, z1), 0.012, fence, false);
  };
  pickets(1.0, -0.78, 1.0, 0.78);
  pickets(1.0, 0.78, 0.35, 0.78);
  // 院子裡：飼料碗、骨頭、小球
  P(g, new THREE.CylinderGeometry(0.1, 0.08, 0.06, 14), kit.m('#d8584a'), [0.68, 0.11, 0.42]);
  P(g, GEO.sphere, deckD, [0.68, 0.135, 0.42], null, [0.15, 0.04, 0.15], false);
  const bone = fence;
  P(g, GEO.cyl, bone, [0.62, 0.11, -0.25], [0, 0.6, Math.PI / 2], [0.035, 0.16, 0.035], false);
  for (const s of [-1, 1]) for (const o of [-1, 1]) P(g, GEO.sphereLo, bone, [0.62 + s * 0.068 * Math.cos(0.6) + o * 0.02 * Math.sin(0.6), 0.11, -0.25 - s * 0.068 * Math.sin(0.6) + o * 0.02 * Math.cos(0.6)], null, 0.045, false);
  P(g, GEO.sphere, kit.m('#c8e04a', { roughness: 0.5 }), [0.82, 0.15, 0.05], null, 0.13);
  bake(g);
  g.userData.glow = kit.glow;
  return g;
}
