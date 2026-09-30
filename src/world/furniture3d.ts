// 室內家具與房間外殼的 3D 模型（程式化建模，皮克斯／動森風格的圓潤低多邊形）
// 慣例（遊戲端依賴，勿改）：
// - 1 單位 = 1 公尺。房間地板 9×7：x ∈ [−4.5, 4.5]、z ∈ [−3.5, 3.5]；後牆內面 z = −3.5，側牆內面 x = ±4.5，前方 z = +3.5 開放
// - floor 家具：原點在佔地中心的地面（y=0），正面朝 +z，收在 w×d 公尺內（留約 0.06 邊）；高的櫃子貼齊佔地後緣
// - rug 地毯：扁平（高 ≤ 0.03），原點在中心
// - wall 牆飾：原點在貼牆的背面中心，往 +z 凸出（≤ 0.25），垂直置中；遊戲放在 y=1.6、z=−3.5
// - 動畫：updateFurniture 走訪 userData.fx 標記（glow / flame / bob / pendulum / chime / snow / window）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FURN_BY_ID, type RoomStyle } from '../data/furniture';
import { mulberry32 } from '../core/rng';
import { GEO, mat, mesh } from './materials';

type Std = THREE.MeshStandardMaterial;

// ---------- 幾何快取：同尺寸只建一次 ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
function cg(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const k3 = (...v: number[]) => v.map((x) => x.toFixed(3)).join(',');

// 圓角方塊
function B(w: number, h: number, d: number, r = 0.03): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2, h / 2, d / 2) * 0.96;
  return cg('b' + k3(w, h, d, rr), () => (rr < 0.002 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, rr)));
}
// 圓柱（open = 無上下蓋，燈罩用）
function CY(rt: number, rb: number, h: number, seg = 16, open = false): THREE.BufferGeometry {
  return cg('c' + k3(rt, rb, h, seg) + open, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}
function TO(R: number, tube: number, arc = Math.PI * 2): THREE.BufferGeometry {
  return cg('t' + k3(R, tube, arc), () => new THREE.TorusGeometry(R, tube, 8, 28, arc));
}
function CO(r: number, h: number, seg = 12): THREE.BufferGeometry {
  return cg('k' + k3(r, h, seg), () => new THREE.ConeGeometry(r, h, seg));
}
function PL(w: number, h: number): THREE.BufferGeometry {
  return cg('p' + k3(w, h), () => new THREE.PlaneGeometry(w, h));
}
// 底部在 y=0 的圓錐：火焰縮放時從底部往上竄
function flameGeo(r: number, h: number): THREE.BufferGeometry {
  return cg('fl' + k3(r, h), () => new THREE.ConeGeometry(r, h, 10).translate(0, h / 2, 0));
}
// 半圓拱（平底在 y=0，厚度沿 z 置中）
function archGeo(r: number, depth: number): THREE.BufferGeometry {
  return cg('a' + k3(r, depth), () => new THREE.CylinderGeometry(r, r, depth, 22, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2));
}
// 上半球殼（風鈴）
function domeGeo(r: number): THREE.BufferGeometry {
  return cg('d' + k3(r), () => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
}
function tubeGeo(key: string, pts: [number, number, number][], r: number): THREE.BufferGeometry {
  return cg('tb' + key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, r, 6, false));
}

// 愛心（尖端朝 −y，寬 s）
function heartShape(s: number): THREE.Shape {
  const k = s / 22;
  const p = (x: number, y: number): [number, number] => [(x - 5) * k, -(y - 9.5) * k];
  const sh = new THREE.Shape();
  sh.moveTo(...p(5, 5));
  const bz = (a: number, b: number, c: number, d: number, e: number, f: number) => {
    const [x1, y1] = p(a, b), [x2, y2] = p(c, d), [x3, y3] = p(e, f);
    sh.bezierCurveTo(x1, y1, x2, y2, x3, y3);
  };
  bz(5, 5, 4, 0, 0, 0);
  bz(-6, 0, -6, 7, -6, 7);
  bz(-6, 11, -3, 15.4, 5, 19);
  bz(12, 15.4, 16, 11, 16, 7);
  bz(16, 7, 16, 0, 10, 0);
  bz(7, 0, 5, 5, 5, 5);
  return sh;
}
function heartGeo(s: number, depth: number, bevel = 0.02): THREE.BufferGeometry {
  return cg('h' + k3(s, depth, bevel), () =>
    new THREE.ExtrudeGeometry(heartShape(s), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 }).translate(0, 0, -depth / 2),
  );
}
function starGeo(ro: number, ri: number, depth: number): THREE.BufferGeometry {
  return cg('s' + k3(ro, ri, depth), () => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? ri : ro;
      if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: ro * 0.08, bevelSegments: 2 }).translate(0, 0, -depth / 2);
  });
}
// 楓葉：五裂葉＋鋸齒＋葉柄，大小約 s
function mapleGeo(s: number): THREE.BufferGeometry {
  return cg('mp' + k3(s), () => {
    const sh = new THREE.Shape();
    const pol = (deg: number, r: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r * s, Math.sin((deg * Math.PI) / 180) * r * s];
    sh.moveTo(0.03 * s, -0.5 * s);
    sh.lineTo(0.03 * s, -0.14 * s);
    const lobes: [number, number][] = [[340, 0.56], [35, 0.84], [90, 1], [145, 0.84], [200, 0.56]];
    sh.lineTo(...pol(305, 0.26));
    lobes.forEach(([a, L], i) => {
      sh.lineTo(...pol(a - 13, L * 0.7));
      sh.lineTo(...pol(a - 6, L * 0.78));
      sh.lineTo(...pol(a, L));
      sh.lineTo(...pol(a + 6, L * 0.78));
      sh.lineTo(...pol(a + 13, L * 0.7));
      if (i < lobes.length - 1) sh.lineTo(...pol((a + lobes[i + 1][0] + (i === 0 ? 360 : 0)) / 2, 0.3));
    });
    sh.lineTo(...pol(235, 0.26));
    sh.lineTo(-0.03 * s, -0.14 * s);
    sh.lineTo(-0.03 * s, -0.5 * s);
    sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }).translate(0, 0, -0.006);
  });
}

// 多個方塊合併成一個網格（頂點色）：書本等大量小物件
interface Bx { w: number; h: number; d: number; x: number; y: number; z: number; rz?: number; ry?: number; c: string }
function mergedBoxes(key: string, list: () => Bx[]): THREE.BufferGeometry {
  return cg('mb' + key, () => {
    const col = new THREE.Color();
    const parts = list().map((b) => {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d).rotateZ(b.rz ?? 0).rotateY(b.ry ?? 0).translate(b.x, b.y, b.z);
      col.set(b.c);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    return mergeGeometries(parts)!;
  });
}
// 多顆小球合併（燈泡串、雪花、飼料）
function mergedDots(key: string, list: () => [number, number, number, number][]): THREE.BufferGeometry {
  return cg('md' + key, () => mergeGeometries(list().map(([x, y, z, r]) => new THREE.SphereGeometry(r, 8, 6).translate(x, y, z)))!);
}

// ---------- 材質快取 ----------
const matCache = new Map<string, Std>();
function M(color: string, rough = 0.72, metal = 0): Std {
  const key = color + '|' + rough + '|' + metal;
  let m = matCache.get(key);
  if (!m) {
    m = mat(color, { roughness: rough, metalness: metal });
    matCache.set(key, m);
  }
  return m;
}
function MX(key: string, make: () => Std): Std {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}
const goldM = () => M('#f2c14e', 0.35, 0.45);
const chromeM = () => M('#e3e8ec', 0.25, 0.55);
const vcM = () => MX('vc', () => mat('#ffffff', { vertexColors: true, roughness: 0.8 }));
const glassM = () => MX('glass', () => mat('#e2f4ff', { transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));

// 調色盤
const C = {
  pine: '#e2a868', pineD: '#c4884c', pineL: '#f0c48e', walnut: '#8a5a38', cherry: '#b8603f',
  cream: '#f7ecd6', linen: '#fbf6ea', white: '#fffaf2', ink: '#2a2220',
  red: '#d9544d', green: '#6fae6a',
  pink: '#f6c3cf', rose: '#f29bb0', lav: '#d6c4ec', mint: '#bfe6d4', butter: '#fbe3a0',
  enamel: '#f6efdc', minty: '#8fd3bd', iron: '#3b3634',
  leaf: '#5fae4c', leafD: '#3f8f3c', terracotta: '#d4774a', lred: '#d8342c',
};

// ---------- canvas 貼圖 ----------
const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, wrap = false): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}
// 同一張圖、不同重複次數：clone 共用影像來源
function repTex(base: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = base.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}
// 顏色明暗微調
function tint(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function ginghamTex(color: string) {
  return canvasTex('ging' + color, 32, 32, (c) => {
    c.fillStyle = '#fffaf2';
    c.fillRect(0, 0, 32, 32);
    c.globalAlpha = 0.5;
    c.fillStyle = color;
    c.fillRect(0, 0, 16, 32);
    c.fillRect(0, 0, 32, 16);
  }, true);
}
function gingham(color: string, rx: number, ry: number): Std {
  return MX(`ging${color}${rx}x${ry}`, () => mat('#ffffff', { map: repTex(ginghamTex(color), rx, ry), roughness: 0.92 }));
}
function texMat(key: string, t: () => THREE.Texture, rough = 0.85): Std {
  return MX('tx' + key, () => mat('#ffffff', { map: t(), roughness: rough }));
}
// 拼布被
function patchTex() {
  return canvasTex('patch', 128, 128, (c) => {
    const cols = ['#f6c3cf', '#bfe6d4', '#fbe3a0', '#cfe0f5', '#f5cfae', '#dccbef', '#fff4e2'];
    const rnd = mulberry32(5);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      c.fillStyle = cols[Math.floor(rnd() * cols.length)];
      c.fillRect(i * 32, j * 32, 32, 32);
      if (rnd() < 0.4) {
        c.fillStyle = 'rgba(255,255,255,0.7)';
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c.fillRect(i * 32 + 6 + a * 10, j * 32 + 6 + b * 10, 3, 3);
      }
    }
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.setLineDash([3, 3]);
    c.lineWidth = 1.5;
    for (let k = 0; k <= 4; k++) {
      c.beginPath(); c.moveTo(k * 32, 0); c.lineTo(k * 32, 128); c.stroke();
      c.beginPath(); c.moveTo(0, k * 32); c.lineTo(128, k * 32); c.stroke();
    }
  });
}
// 毛線織紋（條紋＋V 字）
function knitTex(a: string, b: string) {
  return canvasTex('knit' + a + b, 64, 64, (c) => {
    for (let r = 0; r < 4; r++) {
      c.fillStyle = r % 2 ? b : a;
      c.fillRect(0, r * 16, 64, 16);
    }
    c.strokeStyle = 'rgba(0,0,0,0.08)';
    c.lineWidth = 1.5;
    for (let y = 0; y < 64; y += 6) for (let x = 0; x < 64; x += 8) {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 4, y + 4); c.lineTo(x + 8, y); c.stroke();
    }
  }, true);
}
// 鋼琴琴鍵（上緣＝靠玩家）
function keysTex() {
  return canvasTex('keys', 512, 64, (c) => {
    c.fillStyle = '#fffdf6';
    c.fillRect(0, 0, 512, 64);
    const n = 28, kw = 512 / n;
    c.fillStyle = '#cfc6b8';
    for (let i = 1; i < n; i++) c.fillRect(i * kw - 1, 0, 2, 64);
    c.fillStyle = '#2b2522';
    for (let i = 0; i < n - 1; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) c.fillRect((i + 1) * kw - kw * 0.3, 26, kw * 0.6, 38);
  });
}
function landscapeTex() {
  return canvasTex('landscape', 256, 192, (c) => {
    const sky = c.createLinearGradient(0, 0, 0, 120);
    sky.addColorStop(0, '#8fcaf2'); sky.addColorStop(1, '#e6f5ff');
    c.fillStyle = sky; c.fillRect(0, 0, 256, 192);
    c.fillStyle = '#ffe28a'; c.beginPath(); c.arc(206, 40, 18, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    for (const [x, y] of [[60, 36], [80, 30], [98, 38]]) { c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#a8d487'; c.beginPath(); c.ellipse(70, 150, 150, 60, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#86c065'; c.beginPath(); c.ellipse(210, 170, 140, 60, 0, 0, Math.PI * 2); c.fill();
    // 紅穀倉
    c.fillStyle = '#d9544d'; c.fillRect(150, 104, 42, 32);
    c.fillStyle = '#8a3a30'; c.beginPath(); c.moveTo(144, 106); c.lineTo(171, 84); c.lineTo(198, 106); c.fill();
    c.fillStyle = '#fff4e2'; c.fillRect(164, 118, 14, 18);
    // 樹
    c.fillStyle = '#7a5234'; c.fillRect(56, 104, 6, 22);
    c.fillStyle = '#4f9e46'; c.beginPath(); c.arc(59, 98, 16, 0, Math.PI * 2); c.fill();
    const fl = ['#ff8fb0', '#ffd84a', '#ffffff'];
    const rnd = mulberry32(3);
    for (let i = 0; i < 40; i++) { c.fillStyle = fl[i % 3]; c.fillRect(rnd() * 256, 140 + rnd() * 50, 3, 3); }
  });
}
function familyTex() {
  return canvasTex('family', 256, 200, (c) => {
    c.fillStyle = '#fffaf2'; c.fillRect(0, 0, 256, 200);
    const bg = c.createLinearGradient(0, 12, 0, 188);
    bg.addColorStop(0, '#bfe3f7'); bg.addColorStop(1, '#e8f6d8');
    c.fillStyle = bg; c.fillRect(12, 12, 232, 176);
    c.fillStyle = '#9fd07a'; c.fillRect(12, 150, 232, 38);
    const person = (x: number, s: number, body: string, hair: string) => {
      c.fillStyle = body;
      c.beginPath(); c.roundRect(x - 20 * s, 150 - 62 * s, 40 * s, 64 * s, 14 * s); c.fill();
      c.fillStyle = '#f6d2b0'; c.beginPath(); c.arc(x, 150 - 78 * s, 19 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = hair; c.beginPath(); c.arc(x, 150 - 83 * s, 19 * s, Math.PI, Math.PI * 2); c.fill();
      c.fillStyle = '#3a2a22';
      c.fillRect(x - 8 * s, 150 - 78 * s, 3 * s, 4 * s); c.fillRect(x + 5 * s, 150 - 78 * s, 3 * s, 4 * s);
      c.strokeStyle = '#b8563f'; c.lineWidth = 2 * s;
      c.beginPath(); c.arc(x, 150 - 72 * s, 6 * s, 0.2, Math.PI - 0.2); c.stroke();
    };
    person(78, 1.1, '#5b8fd1', '#5a3a28');
    person(150, 1.05, '#e98fb0', '#7a4a2a');
    person(114, 0.72, '#f2c14e', '#5a3a28');
    // 小狗
    c.fillStyle = '#e9a55f';
    c.beginPath(); c.ellipse(205, 142, 22, 14, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(222, 124, 13, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(214, 116); c.lineTo(218, 100); c.lineTo(226, 114); c.fill();
    c.fillStyle = '#2a2220'; c.fillRect(224, 121, 3, 3);
    c.fillStyle = '#ff8fb0';
    c.beginPath(); c.arc(40, 40, 6, 0, Math.PI * 2); c.arc(50, 40, 6, 0, Math.PI * 2); c.fill();
  });
}
// 春聯：紅紙金字
const CJK_FONT = "'Kaiti TC','STKaiti','BiauKai','PingFang TC','Heiti TC','Noto Serif CJK TC',serif";
function coupletTex(text: string, vertical: boolean) {
  const n = text.length;
  const w = vertical ? 64 : 64 * n, h = vertical ? 64 * n : 64;
  return canvasTex('cp' + text, w, h, (c) => {
    c.fillStyle = '#d42a22'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f5c542'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    c.font = `bold 44px ${CJK_FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffd35a';
    [...text].forEach((ch, i) => c.fillText(ch, vertical ? 32 : 32 + i * 64, vertical ? 34 + i * 64 : 34));
  });
}
function fuTex() {
  return canvasTex('fu', 128, 128, (c) => {
    c.fillStyle = '#d42a22'; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#f5c542'; c.lineWidth = 5; c.strokeRect(6, 6, 116, 116);
    c.translate(64, 66); c.rotate(-Math.PI / 4);
    c.font = `bold 78px ${CJK_FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffd35a'; c.fillText('福', 0, 0);
  });
}
// 窗外景色（也當自發光貼圖：白天亮、夜晚轉深藍）
function skyTex() {
  return canvasTex('sky', 128, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#7fc0ee'); g.addColorStop(0.6, '#cbe8fa'); g.addColorStop(1, '#ffe7bf');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [x, y, r] of [[34, 34, 11], [48, 30, 13], [62, 36, 10]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#9fd67c'; c.beginPath(); c.ellipse(30, 132, 80, 30, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#86c866'; c.beginPath(); c.ellipse(110, 136, 70, 28, 0, 0, Math.PI * 2); c.fill();
  });
}
function skyMat(): Std {
  const t = skyTex();
  return mat('#ffffff', { map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.85, roughness: 0.3 });
}
function tagWindow(o: THREE.Object3D): void {
  Object.assign(o.userData, { fx: 'window', gd: 0.85, gn: 0.55 });
}

// ---------- 發光與動畫標記 ----------
let PH = 0; // 目前這件家具的動畫相位（每件不同，避免同步閃爍）
function G(color: string, emissive: string, extra: THREE.MeshStandardMaterialParameters = {}): Std {
  return mat(color, { emissive, emissiveIntensity: 1, roughness: 0.55, ...extra });
}
// 標記發光：白天 day、夜晚 night 的自發光強度，flick = 閃爍幅度
function glow<T extends THREE.Object3D>(o: T, day: number, night: number, flick = 0, ph = PH): T {
  Object.assign(o.userData, { fx: 'glow', gd: day, gn: night, fl: flick, ph });
  const m = (o as unknown as THREE.Mesh).material as Std;
  if (m) m.emissiveIntensity = day;
  return o;
}
function flame<T extends THREE.Object3D>(o: T, day: number, night: number, ph = PH): T {
  glow(o, day, night, 0.16, ph);
  Object.assign(o.userData, { fx: 'flame', sx: o.scale.x, sy: o.scale.y, sz: o.scale.z });
  return o;
}

// ---------- 擺放小工具 ----------
function P(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const o = mesh(geo, m, shadow);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
// 橢球：sx/sy/sz 是直徑
function E(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, shadow = true): THREE.Mesh {
  const o = P(parent, GEO.sphere, m, x, y, z, shadow);
  o.scale.set(sx, sy, sz);
  return o;
}
// 圓團（樹葉、花叢用多面球）
function I(parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, s: number, sy = s): THREE.Mesh {
  const o = P(parent, GEO.ico, m, x, y, z);
  o.scale.set(s, sy, s);
  return o;
}
function R<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}
const PI = Math.PI, HP = Math.PI / 2;

// ---------- 家具 ----------
type Builder = (g: THREE.Group) => void;

const BUILDERS: Record<string, Builder> = {
  // ===== 原木系列：蜂蜜松木 =====
  wood_bed(g) {
    const wood = M(C.pine), dark = M(C.pineD), light = M(C.pineL);
    const W = 1.44, L = 1.84;
    P(g, B(W, 0.2, L - 0.12, 0.05), wood, 0, 0.23, 0);
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.01);
      P(g, CY(0.055, 0.055, 1.12), dark, x, 0.56, -L / 2 + 0.06);
      E(g, light, x, 1.16, -L / 2 + 0.06, 0.15);
      P(g, CY(0.055, 0.055, 0.68), dark, x, 0.34, L / 2 - 0.06);
      E(g, light, x, 0.72, L / 2 - 0.06, 0.14);
    }
    P(g, B(W, 0.78, 0.07, 0.03), wood, 0, 0.62, -L / 2 + 0.06);
    P(g, B(W - 0.34, 0.4, 0.03, 0.015), light, 0, 0.76, -L / 2 + 0.1);
    P(g, heartGeo(0.2, 0.02, 0.01), M(C.red, 0.6), 0, 0.78, -L / 2 + 0.12);
    P(g, B(W, 0.4, 0.06, 0.03), wood, 0, 0.42, L / 2 - 0.06);
    P(g, B(W - 0.08, 0.16, L - 0.22, 0.07), M(C.linen, 0.9), 0, 0.41, 0);
    const quilt = texMat('patch', patchTex, 0.95);
    P(g, B(W + 0.02, 0.09, 1.06, 0.04), quilt, 0, 0.52, 0.26);
    for (const sx of [-1, 1]) P(g, B(0.03, 0.2, 1.06, 0.012), quilt, sx * (W / 2 + 0.005), 0.44, 0.26);
    P(g, B(W + 0.04, 0.1, 0.16, 0.05), M(C.white, 0.9), 0, 0.54, -0.3);
    for (const sx of [-1, 1]) R(P(g, B(0.56, 0.14, 0.34, 0.07), M(C.white, 0.9), sx * 0.33, 0.56, -0.6), -0.2, 0, sx * 0.04);
  },
  wood_table(g) {
    const wood = M(C.pine), dark = M(C.pineD);
    const W = 1.8, D = 0.84;
    P(g, B(W, 0.07, D, 0.03), wood, 0, 0.715, 0);
    P(g, B(W - 0.2, 0.1, D - 0.18, 0.02), dark, 0, 0.63, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.045, 0.035, 0.68), wood, sx * (W / 2 - 0.14), 0.34, sz * (D / 2 - 0.12));
    P(g, B(0.42, 0.012, D + 0.02, 0.005), gingham(C.red, 3, 7), 0, 0.756, 0, false);
    P(g, CY(0.05, 0.07, 0.16), M('#7fb3d9', 0.35), 0, 0.84, 0);
    P(g, CY(0.008, 0.008, 0.16), M(C.leaf), 0, 0.97, 0, false);
    E(g, M('#ffd84a'), -0.05, 1.03, 0.0, 0.09);
    E(g, M('#ff8fb0'), 0.05, 1.06, 0.02, 0.1);
    E(g, M(C.white), 0.0, 1.0, -0.05, 0.08);
    E(g, M(C.leaf), 0.07, 0.96, -0.03, 0.08, 0.04, 0.05);
  },
  wood_chair(g) {
    const wood = M(C.pine), dark = M(C.pineD), light = M(C.pineL);
    P(g, B(0.46, 0.06, 0.44, 0.025), wood, 0, 0.42, 0.01);
    for (const sx of [-1, 1]) for (const z of [0.19, -0.18]) P(g, CY(0.024, 0.02, 0.4), dark, sx * 0.19, 0.2, z);
    for (const sx of [-1, 1]) P(g, B(0.05, 0.56, 0.05, 0.02), wood, sx * 0.19, 0.67, -0.18);
    P(g, B(0.48, 0.13, 0.05, 0.03), light, 0, 0.9, -0.18);
    P(g, B(0.38, 0.06, 0.03, 0.01), wood, 0, 0.72, -0.18);
    P(g, heartGeo(0.1, 0.02, 0.008), M(C.red, 0.6), 0, 0.9, -0.15);
    P(g, B(0.4, 0.05, 0.38, 0.025), gingham(C.red, 2.5, 2.5), 0, 0.47, 0.02);
  },
  wood_stool(g) {
    const wood = M(C.pine), dark = M(C.pineD);
    P(g, CY(0.2, 0.2, 0.05, 20), wood, 0, 0.425, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + PI / 4, c = Math.cos(a), s = Math.sin(a);
      R(P(g, CY(0.025, 0.02, 0.42), dark, c * 0.15, 0.215, s * 0.15), -s * 0.14, 0, c * 0.14);
    }
    R(P(g, TO(0.15, 0.015), dark, 0, 0.15, 0), HP);
    P(g, CY(0.17, 0.17, 0.03, 20), knitMat(C.butter, '#fff6e6'), 0, 0.46, 0);
  },
  wood_shelf(g) {
    const wood = M(C.pine), dark = M(C.pineD), light = M(C.pineL);
    const W = 1.7, D = 0.38, H = 1.8, zc = -0.5 + 0.06 + D / 2;
    for (const sx of [-1, 1]) P(g, B(0.06, H, D, 0.02), wood, sx * (W / 2 - 0.03), H / 2, zc);
    P(g, B(W + 0.08, 0.06, D + 0.04, 0.02), light, 0, H + 0.03, zc);
    P(g, B(W, 0.1, D, 0.02), dark, 0, 0.05, zc);
    P(g, B(W - 0.08, H - 0.1, 0.03, 0.01), dark, 0, H / 2 + 0.05, zc - D / 2 + 0.02);
    for (const y of [0.5, 0.92, 1.34]) P(g, B(W - 0.1, 0.04, D - 0.04, 0.01), wood, 0, y, zc);
    // 書本（合併成一個網格）
    const cols = ['#d9544d', '#6fae6a', '#5b8fd1', '#f2c14e', '#e98fb0', '#8a6fc2', '#f09a4a', '#4fb3a9', '#f3ead6'];
    P(g, mergedBoxes('shelfBooks', () => {
      const rnd = mulberry32(11);
      const out: Bx[] = [];
      [0.1, 0.52, 0.94, 1.36].forEach((y0, lv) => {
        let x = -W / 2 + 0.1;
        const stop = lv % 2 ? 0.2 : 0.55;
        while (x < stop) {
          const w = 0.05 + rnd() * 0.04, h = 0.22 + rnd() * 0.12;
          out.push({ w, h, d: 0.26, x: x + w / 2, y: y0 + h / 2, z: zc + 0.02, c: cols[Math.floor(rnd() * cols.length)] });
          x += w + 0.004;
        }
        // 斜靠的一本
        out.push({ w: 0.05, h: 0.28, d: 0.26, x: x + 0.09, y: y0 + 0.13, z: zc + 0.02, rz: -0.45, c: cols[(lv * 3) % cols.length] });
        // 橫放一疊
        const sx = lv % 2 ? 0.52 : 0.72;
        for (let k = 0; k < 3; k++) out.push({ w: 0.26 - k * 0.03, h: 0.05, d: 0.2, x: sx, y: y0 + 0.025 + k * 0.05, z: zc + 0.04, c: cols[(lv + k * 2) % cols.length] });
      });
      return out;
    }), vcM(), 0, 0, 0);
    // 小盆栽、罐子
    P(g, CY(0.06, 0.05, 0.1), M(C.terracotta, 0.85), 0.48, 0.99, zc + 0.03);
    I(g, M(C.leaf), 0.48, 1.09, zc + 0.03, 0.16);
    P(g, CY(0.06, 0.06, 0.14, 14), M('#bfe6f5', 0.2), 0.72, 1.43, zc + 0.03);
    P(g, CY(0.065, 0.065, 0.03, 14), M(C.red), 0.72, 1.515, zc + 0.03);
  },
  wood_wardrobe(g) {
    const wood = M(C.pine), dark = M(C.pineD), light = M(C.pineL);
    const W = 1.56, D = 0.56, H = 1.96, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.05, 0.04, 0.1), dark, sx * (W / 2 - 0.1), 0.05, zc + sz * (D / 2 - 0.1));
    P(g, B(W, H - 0.2, D, 0.04), wood, 0, 0.1 + (H - 0.2) / 2, zc);
    P(g, B(W + 0.1, 0.1, D + 0.08, 0.03), dark, 0, H - 0.05, zc);
    P(g, archGeo(0.26, 0.05), light, 0, H, zf - 0.03).scale.y = 0.55;
    for (const sx of [-1, 1]) {
      P(g, B(W / 2 - 0.07, 1.2, 0.03, 0.015), light, sx * (W / 4), 1.14, zf + 0.01);
      P(g, B(W / 2 - 0.25, 0.9, 0.02, 0.01), wood, sx * (W / 4), 1.1, zf + 0.025);
      P(g, heartGeo(0.14, 0.02, 0.008), dark, sx * (W / 4), 1.62, zf + 0.03);
      E(g, goldM(), sx * 0.07, 1.1, zf + 0.05, 0.06);
      E(g, goldM(), sx * 0.3, 0.3, zf + 0.04, 0.06);
    }
    P(g, B(W - 0.12, 0.3, 0.03, 0.015), light, 0, 0.3, zf + 0.01);
    // 帽盒
    P(g, CY(0.17, 0.17, 0.2, 20), M(C.pink), -0.4, 2.06, zc);
    P(g, CY(0.18, 0.18, 0.04, 20), M(C.rose), -0.4, 2.17, zc);
  },

  // ===== 田園系列：奶油布面＋格紋 =====
  country_sofa(g) {
    const fab = M('#f5e7cb', 0.95), cush = M('#fbf1dc', 0.95);
    const W = 1.84, D = 0.84;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.035, 0.03, 0.08), M(C.walnut), sx * (W / 2 - 0.12), 0.04, sz * (D / 2 - 0.12));
    P(g, B(W - 0.04, 0.14, D - 0.04, 0.02), gingham(C.red, 14, 1), 0, 0.15, 0);
    P(g, B(W, 0.2, D, 0.08), fab, 0, 0.3, 0);
    P(g, B(W - 0.08, 0.56, 0.24, 0.11), fab, 0, 0.64, -D / 2 + 0.13);
    for (const sx of [-1, 1]) {
      P(g, B(0.2, 0.3, D, 0.09), fab, sx * (W / 2 - 0.1), 0.52, 0);
      R(P(g, CY(0.12, 0.12, D, 18), fab, sx * (W / 2 - 0.1), 0.66, 0), HP);
      P(g, B(0.72, 0.14, 0.56, 0.06), cush, sx * 0.37, 0.46, 0.1);
    }
    R(P(g, B(0.36, 0.34, 0.12, 0.08), gingham(C.red, 4, 4), -0.5, 0.68, -0.18), -0.25, 0.15, 0.1);
    R(P(g, B(0.36, 0.34, 0.12, 0.08), gingham(C.green, 4, 4), 0.5, 0.68, -0.18), -0.25, -0.15, -0.1);
    R(P(g, heartGeo(0.26, 0.06, 0.03), M(C.rose, 0.9), 0, 0.66, -0.16), -0.28);
  },
  country_armchair(g) {
    const fab = M('#f5e7cb', 0.95);
    const W = 0.86, D = 0.8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.035, 0.03, 0.08), M(C.walnut), sx * (W / 2 - 0.1), 0.04, sz * (D / 2 - 0.1));
    P(g, B(W - 0.04, 0.14, D - 0.04, 0.02), gingham(C.green, 6, 1), 0, 0.15, 0);
    P(g, B(W, 0.2, D, 0.08), fab, 0, 0.3, 0);
    P(g, B(W - 0.08, 0.62, 0.22, 0.1), fab, 0, 0.66, -D / 2 + 0.12);
    for (const sx of [-1, 1]) {
      P(g, B(0.16, 0.28, D, 0.07), fab, sx * (W / 2 - 0.08), 0.52, 0);
      R(P(g, CY(0.1, 0.1, D, 16), fab, sx * (W / 2 - 0.08), 0.65, 0), HP);
    }
    P(g, B(0.54, 0.14, 0.54, 0.06), gingham(C.green, 3, 3), 0, 0.46, 0.08);
    R(P(g, B(0.34, 0.3, 0.11, 0.07), gingham(C.red, 4, 4), 0, 0.7, -0.19), -0.25);
  },
  country_lamp(g) {
    const wood = M(C.walnut);
    P(g, CY(0.18, 0.2, 0.05, 20), wood, 0, 0.025, 0);
    P(g, CY(0.022, 0.022, 1.36), M('#c99a5a', 0.4, 0.3), 0, 0.72, 0);
    P(g, CY(0.19, 0.19, 0.03, 20), M(C.pine), 0, 0.64, 0);
    // 小茶杯
    P(g, CY(0.04, 0.03, 0.06, 12), M(C.white, 0.4), 0.09, 0.685, 0.03);
    P(g, TO(0.022, 0.006), M(C.white, 0.4), 0.135, 0.69, 0.03);
    const shade = P(g, CY(0.15, 0.27, 0.34, 24, true), G('#fbeed3', '#ffc070', { side: THREE.DoubleSide, roughness: 0.9 }), 0, 1.44, 0, false);
    glow(shade, 0.25, 1.7, 0.02);
    for (const [r, y] of [[0.15, 1.61], [0.27, 1.27]] as const) R(P(g, TO(r, 0.014), M(C.red, 0.8), 0, y, 0, false), HP);
    glow(E(g, G('#fff4d6', '#ffd27a'), 0, 1.37, 0, 0.12, 0.14, 0.12, false), 0.6, 2.8);
    E(g, M(C.pine), 0, 1.66, 0, 0.06);
  },
  country_rug(g) {
    P(g, B(2.88, 0.016, 1.88, 0.008), M('#c8453e', 0.95), 0, 0.008, 0, false);
    P(g, B(2.66, 0.02, 1.66, 0.008), gingham(C.red, 11, 7), 0, 0.012, 0, false);
    P(g, mergedDots('rugTassel', () => {
      const out: [number, number, number, number][] = [];
      for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) out.push([sx * 1.45, 0.015, -0.8 + i * (1.6 / 7), 0.015]);
      return out;
    }), M(C.cream, 0.95), 0, 0, 0, false);
  },
  country_plant(g) {
    P(g, CY(0.21, 0.16, 0.36, 18), M(C.terracotta, 0.85), 0, 0.18, 0);
    P(g, CY(0.235, 0.235, 0.07, 18), M('#c96a3e', 0.85), 0, 0.37, 0);
    P(g, CY(0.2, 0.2, 0.02, 18), M('#5a4030', 1), 0, 0.395, 0);
    P(g, CY(0.215, 0.18, 0.05, 18), gingham(C.green, 8, 1), 0, 0.24, 0);
    P(g, CY(0.025, 0.035, 0.55), M(C.walnut), 0, 0.66, 0);
    const greens = [M(C.leaf, 0.8), M(C.leafD, 0.8), M('#7cc45e', 0.8)];
    const blobs: [number, number, number, number][] = [[0, 1.04, 0, 0.6], [-0.2, 0.88, 0.08, 0.44], [0.2, 0.92, -0.04, 0.46], [0.04, 1.3, -0.02, 0.42], [-0.12, 0.72, -0.12, 0.34], [0.15, 0.72, 0.14, 0.32]];
    blobs.forEach(([x, y, z, s], i) => I(g, greens[i % 3], x, y, z, s));
  },
  country_sideboard(g) {
    const cream = M('#f7ecd6', 0.7), sage = M('#9cc49a', 0.65), top = M(C.pine);
    const W = 1.7, D = 0.5, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2;
    P(g, B(W - 0.06, 0.08, D - 0.06, 0.02), M(C.walnut), 0, 0.04, zc);
    P(g, B(W, 0.76, D, 0.04), cream, 0, 0.46, zc);
    P(g, B(W + 0.06, 0.05, D + 0.04, 0.02), top, 0, 0.865, zc);
    for (const sx of [-1, 1]) {
      const x = (sx * W) / 4;
      P(g, B(W / 2 - 0.1, 0.16, 0.03, 0.015), sage, x, 0.72, zf + 0.01);
      E(g, goldM(), x, 0.72, zf + 0.04, 0.05);
      P(g, B(W / 2 - 0.1, 0.46, 0.03, 0.015), sage, x, 0.35, zf + 0.01);
      P(g, heartGeo(0.12, 0.02, 0.008), cream, x, 0.38, zf + 0.03);
      E(g, goldM(), sx * 0.08, 0.35, zf + 0.04, 0.05);
    }
    // 上層碗架
    const D2 = 0.28, zc2 = -0.5 + 0.06 + D2 / 2;
    for (const sx of [-1, 1]) P(g, B(0.05, 0.95, D2, 0.015), cream, sx * (W / 2 - 0.05), 1.365, zc2);
    P(g, B(W - 0.14, 0.95, 0.02, 0.005), gingham(C.green, 12, 7), 0, 1.365, zc2 - D2 / 2 + 0.01);
    P(g, B(W - 0.12, 0.03, D2, 0.01), cream, 0, 1.3, zc2);
    P(g, B(W, 0.07, D2 + 0.06, 0.02), sage, 0, 1.87, zc2);
    const plate = M('#fdfcf6', 0.35), plateB = M('#8fbbe0', 0.35);
    [-0.56, -0.28, 0.28, 0.56].forEach((x, i) => R(P(g, CY(0.12, 0.12, 0.018, 20), i % 2 ? plateB : plate, x, 1.44, zc2 - 0.02), HP - 0.18));
    P(g, CY(0.09, 0.09, 0.02, 20), plate, 0, 1.32, zc2);
    P(g, CY(0.06, 0.07, 0.12, 14), M(C.red, 0.4), 0, 1.4, zc2);
    const cup = M(C.white, 0.35);
    for (const x of [-0.5, -0.3]) P(g, CY(0.045, 0.035, 0.08, 12), cup, x, 0.93, zc2 + 0.02);
    P(g, CY(0.07, 0.07, 0.16, 14), M('#e9d6a8', 0.3), 0.4, 0.97, zc2);
    P(g, CY(0.075, 0.075, 0.03, 14), M(C.red), 0.4, 1.06, zc2);
  },

  // ===== 暖暖系列：粉嫩針織、圓潤 =====
  cozy_fireplace(g) {
    const stone = M('#d2c1ab', 0.95), stoneL = M('#e2d4c0', 0.95), stoneD = M('#b7a58f', 0.95);
    const D = 0.5, zc = -0.5 + 0.06 + 0.3, zf = zc + D / 2 + 0.03;
    P(g, B(1.84, 0.08, 0.86, 0.03), stoneD, 0, 0.04, -0.01);
    // 拱形爐口：有真正的開口
    const body = P(g, cg('fireBody', () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.84, 0); sh.lineTo(0.84, 0); sh.lineTo(0.84, 1.17); sh.lineTo(-0.84, 1.17); sh.closePath();
      const hole = new THREE.Path();
      hole.moveTo(-0.42, 0.01); hole.lineTo(0.42, 0.01); hole.lineTo(0.42, 0.5);
      hole.absarc(0, 0.5, 0.42, 0, PI, false);
      hole.lineTo(-0.42, 0.01);
      sh.holes.push(hole);
      return new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 16 });
    }), stone, 0, 0.11, zc - D / 2);
    body.receiveShadow = true;
    const soot = G('#2e2320', '#ff6a1a', { roughness: 1 });
    glow(P(g, B(0.9, 0.96, 0.04, 0.01), soot, 0, 0.56, zc - D / 2 + 0.06, false), 0.25, 0.9, 0.2);
    P(g, B(0.8, 0.02, D, 0.01), M('#3a2d27', 1), 0, 0.16, zc);
    // 石塊點綴
    const stones: [number, number, number][] = [[-0.7, 0.25, 0.26], [-0.62, 0.56, 0.22], [-0.72, 0.86, 0.24], [-0.58, 1.08, 0.2], [0.7, 0.3, 0.24], [0.62, 0.62, 0.22], [0.72, 0.95, 0.26], [0.56, 1.1, 0.2], [-0.26, 1.12, 0.26], [0.2, 1.14, 0.22]];
    stones.forEach(([x, y, w], i) => P(g, B(w, 0.13, 0.04, 0.03), i % 2 ? stoneL : stoneD, x, y, zf));
    for (let i = 0; i < 5; i++) {
      const a = PI * (0.15 + i * 0.175);
      R(P(g, B(0.15, 0.12, 0.05, 0.02), stoneL, Math.cos(a) * 0.51, 0.61 + Math.sin(a) * 0.51, zf), 0, 0, a - HP);
    }
    // 壁爐架與煙囪
    P(g, B(1.86, 0.09, 0.64, 0.03), M(C.walnut), 0, 1.325, -0.12);
    P(g, B(1.2, 1.3, 0.42, 0.05), stone, 0, 2.02, zc - 0.07);
    P(g, B(1.28, 0.08, 0.46, 0.03), stoneD, 0, 2.7, zc - 0.07);
    // 木柴與火焰
    const log = M('#7a4a2c', 0.9);
    R(P(g, CY(0.055, 0.055, 0.56, 10), log, 0, 0.19, zc + 0.02), 0, 0.25, HP);
    R(P(g, CY(0.05, 0.05, 0.5, 10), log, 0, 0.2, zc + 0.08), 0, -0.3, HP);
    const fo = G('#c84a10', '#ff6a10', { roughness: 0.6 }), fy = G('#ffd040', '#ffc030', { roughness: 0.6 });
    flame(P(g, flameGeo(0.14, 0.44), fo, 0, 0.22, zc + 0.06, false), 1.0, 1.3);
    flame(P(g, flameGeo(0.1, 0.3), fo, -0.16, 0.2, zc + 0.08, false), 1.0, 1.3, PH + 1.7);
    flame(P(g, flameGeo(0.1, 0.32), fo, 0.16, 0.2, zc + 0.06, false), 1.0, 1.3, PH + 3.1);
    flame(P(g, flameGeo(0.08, 0.26), fy, 0, 0.22, zc + 0.12, false), 1.4, 2.0, PH + 0.8);
    // 壁爐架擺飾：蠟燭、盆栽、小鐘
    for (const sx of [-1, 1]) {
      P(g, CY(0.035, 0.035, 0.16, 12), M(C.cream, 0.6), sx * 0.74, 1.45, -0.1);
      glow(E(g, G('#ffe3a0', '#ffb347'), sx * 0.74, 1.56, -0.1, 0.04, 0.07, 0.04, false), 1.0, 2.4, 0.25, PH + sx);
    }
    P(g, CY(0.06, 0.05, 0.1, 12), M(C.terracotta, 0.85), 0.36, 1.42, -0.16);
    I(g, M(C.leaf), 0.36, 1.52, -0.16, 0.16);
    P(g, B(0.2, 0.2, 0.08, 0.04), M(C.rose, 0.6), -0.32, 1.47, -0.16);
    R(P(g, CY(0.07, 0.07, 0.01, 18), M(C.white, 0.5), -0.32, 1.48, -0.115), HP);
  },
  cozy_rug(g) {
    P(g, CY(0.92, 0.92, 0.014, 40), M('#f5c3cf', 0.98), 0, 0.007, 0, false);
    P(g, CY(0.72, 0.72, 0.018, 40), M('#fff4e6', 0.98), 0, 0.009, 0, false);
    P(g, CY(0.52, 0.52, 0.022, 36), M('#dccbef', 0.98), 0, 0.011, 0, false);
    P(g, CY(0.3, 0.3, 0.026, 32), M('#fbe3a0', 0.98), 0, 0.013, 0, false);
    const rim = P(g, TO(0.9, 0.035), M('#f7b3c4', 1), 0, 0.014, 0, false);
    rim.rotation.x = HP;
    rim.scale.z = 0.4;
  },
  cozy_bed(g) {
    const lav = M('#d9c8ef', 0.8), lavD = M('#b9a2dc', 0.7), head = M('#fbe0e8', 0.9), white = M(C.white, 0.95);
    const W = 1.6, L = 1.84;
    P(g, B(W, 0.22, L - 0.06, 0.1), lav, 0, 0.2, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) E(g, lavD, sx * (W / 2 - 0.12), 0.06, sz * (L / 2 - 0.15), 0.12);
    P(g, B(W - 0.1, 0.16, L - 0.16, 0.07), white, 0, 0.38, 0.03);
    P(g, B(W + 0.02, 0.2, 1.2, 0.1), M('#f7c9d4', 0.95), 0, 0.5, 0.3);
    R(P(g, CY(0.09, 0.09, W + 0.03, 16), white, 0, 0.56, -0.3), 0, 0, HP);
    const zH = -L / 2 + 0.08;
    P(g, B(W + 0.04, 0.72, 0.16, 0.08), head, 0, 0.62, zH);
    E(g, head, -0.5, 0.98, zH, 0.52, 0.36, 0.16);
    E(g, head, 0, 1.06, zH, 0.64, 0.44, 0.16);
    E(g, head, 0.5, 0.98, zH, 0.52, 0.36, 0.16);
    for (const [x, y] of [[-0.5, 0.6], [0, 0.6], [0.5, 0.6], [-0.25, 0.82], [0.25, 0.82], [0, 1.0]]) E(g, lavD, x, y, zH + 0.08, 0.045);
    for (const sx of [-1, 1]) R(P(g, B(0.62, 0.17, 0.36, 0.08), white, sx * 0.36, 0.53, -0.6), -0.25, 0, 0);
    R(P(g, heartGeo(0.3, 0.07, 0.03), M(C.rose, 0.9), 0, 0.66, -0.42), -0.35);
    P(g, B(W + 0.06, 0.05, 0.36, 0.025), knitMat(C.butter, '#fff6e6'), 0, 0.625, 0.62);
  },
  cozy_windowseat(g) {
    const wood = M('#f3e3cc', 0.7), wall = M('#fbeede', 0.9), mint = M('#a8dcc6', 0.7);
    const D = 0.52, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2, zb = zc - D / 2 + 0.03;
    for (const sx of [-1, 1]) P(g, B(0.1, 2.0, D, 0.04), wood, sx * 0.87, 1.0, zc);
    P(g, B(1.84, 0.14, D, 0.04), wood, 0, 2.03, zc);
    P(g, B(1.64, 0.16, 0.03, 0.01), M(C.pink, 0.9), 0, 1.88, zf - 0.03);
    for (let i = 0; i < 6; i++) E(g, M(C.pink, 0.9), -0.68 + i * 0.272, 1.8, zf - 0.03, 0.2, 0.12, 0.03);
    P(g, B(1.64, 1.9, 0.05, 0.01), wall, 0, 1.0, zb);
    // 窗
    P(g, B(1.1, 0.9, 0.05, 0.02), M(C.white, 0.6), 0, 1.25, zb + 0.03);
    tagWindow(P(g, PL(0.96, 0.76), skyMat(), 0, 1.25, zb + 0.058, false));
    P(g, B(0.04, 0.76, 0.03, 0.01), M(C.white, 0.6), 0, 1.25, zb + 0.07);
    P(g, B(0.96, 0.04, 0.03, 0.01), M(C.white, 0.6), 0, 1.25, zb + 0.07);
    // 座椅
    P(g, B(1.64, 0.42, D - 0.02, 0.03), wood, 0, 0.21, zc);
    for (const sx of [-1, 1]) {
      P(g, B(0.7, 0.26, 0.03, 0.015), mint, sx * 0.4, 0.21, zf);
      E(g, goldM(), sx * 0.4, 0.21, zf + 0.03, 0.05);
    }
    P(g, B(1.62, 0.12, D - 0.04, 0.06), M(C.mint, 0.95), 0, 0.48, zc);
    R(P(g, B(0.36, 0.32, 0.12, 0.08), M(C.pink, 0.95), -0.56, 0.68, zc - 0.13), -0.2, 0.1, 0.1);
    R(P(g, B(0.36, 0.32, 0.12, 0.08), M(C.butter, 0.95), 0.56, 0.68, zc - 0.13), -0.2, -0.1, -0.1);
    R(P(g, heartGeo(0.26, 0.06, 0.03), M('#cdb6ec', 0.9), 0, 0.68, zc - 0.1), -0.22);
    R(P(g, B(0.2, 0.04, 0.15, 0.01), M('#5b8fd1', 0.7), 0.18, 0.56, zc + 0.08), 0, 0.4, 0);
    P(g, B(0.44, 0.03, 0.5, 0.012), knitMat(C.lav, '#fff6e6'), -0.2, 0.55, zc + 0.02);
  },
  cozy_radio(g) {
    const wood = M(C.pineL), cherry = M(C.cherry, 0.45), cream = M('#f3e2bf', 0.9);
    P(g, CY(0.27, 0.27, 0.04, 24), wood, 0, 0.56, 0);
    P(g, CY(0.035, 0.045, 0.52, 12), M(C.pine), 0, 0.28, 0);
    P(g, CY(0.18, 0.2, 0.04, 20), M(C.pine), 0, 0.02, 0);
    P(g, CY(0.2, 0.2, 0.006, 20), M(C.white, 0.9), 0, 0.583, 0, false);
    const rg = new THREE.Group();
    rg.position.y = 0.586;
    Object.assign(rg.userData, { fx: 'bob', y0: 0.586, ph: PH });
    g.add(rg);
    P(rg, B(0.44, 0.26, 0.2, 0.06), cherry, 0, 0.13, 0);
    P(rg, archGeo(0.22, 0.2), cherry, 0, 0.25, 0).scale.y = 0.6;
    P(rg, B(0.22, 0.16, 0.02, 0.01), cream, -0.08, 0.14, 0.1);
    P(rg, archGeo(0.11, 0.02), cream, -0.08, 0.22, 0.1).scale.y = 0.7;
    for (const y of [0.1, 0.14, 0.18, 0.22]) P(rg, B(0.2, 0.012, 0.01, 0.004), cherry, -0.08, y, 0.112, false);
    for (const y of [0.18, 0.09]) R(P(rg, CY(0.035, 0.035, 0.03, 14), goldM(), 0.13, y, 0.105), HP);
    glow(P(rg, B(0.12, 0.045, 0.012, 0.005), G('#fff2c4', '#ffc56b'), 0.1, 0.27, 0.1, false), 0.3, 1.8);
    R(P(rg, CY(0.006, 0.006, 0.3, 6), chromeM(), 0.16, 0.42, -0.05, false), 0, 0, -0.5);
    E(rg, M(C.red), 0.235, 0.55, -0.05, 0.035);
    for (const sx of [-1, 1]) P(rg, B(0.06, 0.02, 0.12, 0.008), M(C.walnut), sx * 0.16, 0.0, 0);
  },
  cozy_piano(g) {
    const body = M('#fbf0e3', 0.45), trim = M('#e9b7b0', 0.55);
    const W = 1.5, zc = -0.5 + 0.06 + 0.22;
    P(g, B(W, 0.08, 0.42, 0.02), trim, 0, 0.04, zc);
    P(g, B(W - 0.1, 0.58, 0.3, 0.02), body, 0, 0.37, zc - 0.05);
    for (const sx of [-1, 1]) P(g, B(0.07, 1.26, 0.44, 0.03), body, sx * (W / 2 - 0.035), 0.63, zc);
    P(g, B(W - 0.1, 0.56, 0.36, 0.03), body, 0, 1.0, zc - 0.04);
    P(g, B(W + 0.04, 0.05, 0.46, 0.02), trim, 0, 1.285, zc);
    P(g, B(W - 0.12, 0.08, 0.26, 0.02), trim, 0, 0.68, 0.05);
    const keys = MX('keysMat', () => mat('#ffffff', { map: keysTex(), roughness: 0.4 }));
    P(g, cg('keysBox', () => new THREE.BoxGeometry(W - 0.2, 0.03, 0.17)), keys, 0, 0.735, 0.08);
    R(P(g, B(0.8, 0.26, 0.03, 0.01), trim, 0, 0.92, -0.01), -0.2);
    R(P(g, B(0.5, 0.2, 0.01, 0.003), M(C.white, 0.9), 0, 0.93, 0.01, false), -0.2);
    for (const sx of [-1, 1]) {
      P(g, CY(0.04, 0.03, 0.6, 12), trim, sx * (W / 2 - 0.14), 0.34, 0.12);
      P(g, B(0.04, 0.02, 0.08, 0.008), goldM(), sx * 0.06, 0.1, zc + 0.24);
    }
    // 琴上擺飾：花瓶、節拍器
    P(g, CY(0.05, 0.06, 0.14, 12), M('#9fd0e8', 0.3), -0.5, 1.38, zc);
    E(g, M(C.rose), -0.52, 1.49, zc, 0.1);
    E(g, M(C.butter), -0.46, 1.47, zc + 0.03, 0.08);
    R(P(g, CO(0.08, 0.22, 4), M(C.cherry, 0.5), 0.45, 1.42, zc), 0, PI / 4, 0);
    // 琴椅
    P(g, B(0.7, 0.07, 0.24, 0.03), M(C.rose, 0.9), 0, 0.46, 0.31);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.02, 0.018, 0.42, 8), trim, sx * 0.3, 0.21, 0.31 + sz * 0.08);
  },

  // ===== 廚房系列：奶油＋薄荷琺瑯 =====
  kitchen_stove(g) {
    const enamel = M(C.enamel, 0.45), mint = M(C.minty, 0.45), iron = M(C.iron, 0.6, 0.3);
    const W = 1.5, D = 0.6, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.04, 0.03, 0.14, 10), iron, sx * (W / 2 - 0.1), 0.07, zc + sz * (D / 2 - 0.1));
    P(g, B(W, 0.68, D, 0.06), enamel, 0, 0.48, zc);
    P(g, B(W + 0.02, 0.05, D + 0.02, 0.02), mint, 0, 0.16, zc);
    P(g, B(W + 0.04, 0.05, D + 0.04, 0.02), iron, 0, 0.845, zc);
    for (const sx of [-1, 1]) P(g, CY(0.14, 0.14, 0.02, 20), M('#2a2524', 0.5, 0.3), sx * 0.4, 0.88, zc + 0.02);
    // 火箱門（小窗透出火光）
    P(g, B(0.46, 0.34, 0.03, 0.02), iron, -0.43, 0.56, zf + 0.01);
    glow(P(g, B(0.3, 0.1, 0.02, 0.008), G('#e0701a', '#ff8a1a'), -0.43, 0.6, zf + 0.025, false), 1.1, 1.5, 0.25);
    P(g, B(0.46, 0.14, 0.03, 0.02), iron, -0.43, 0.27, zf + 0.01);
    P(g, B(0.66, 0.5, 0.03, 0.02), mint, 0.32, 0.46, zf + 0.01);
    R(P(g, CY(0.015, 0.015, 0.46, 8), chromeM(), 0.32, 0.66, zf + 0.06), 0, 0, HP);
    R(P(g, CY(0.05, 0.05, 0.02, 16), M(C.cream, 0.4), 0.32, 0.46, zf + 0.03), HP);
    // 後方保溫櫃＋煙管
    P(g, B(W, 0.36, 0.1, 0.03), enamel, 0, 1.05, zc - D / 2 + 0.05);
    for (const sx of [-1, 1]) P(g, B(0.5, 0.2, 0.02, 0.01), mint, sx * 0.4, 1.05, zc - D / 2 + 0.11);
    P(g, B(W + 0.04, 0.04, 0.2, 0.015), iron, 0, 1.25, zc - D / 2 + 0.1);
    P(g, CY(0.075, 0.075, 1.35, 14), iron, 0.55, 1.95, zc - 0.2);
    P(g, CY(0.09, 0.09, 0.04, 14), iron, 0.55, 1.62, zc - 0.2);
    // 水壺、煎蛋
    const kettle = M('#e8604c', 0.4);
    E(g, kettle, -0.4, 0.97, zc + 0.02, 0.26, 0.2, 0.26);
    E(g, kettle, -0.4, 1.06, zc + 0.02, 0.1, 0.05, 0.1);
    E(g, M(C.iron), -0.4, 1.09, zc + 0.02, 0.04);
    R(P(g, CY(0.02, 0.035, 0.14, 8), kettle, -0.27, 1.0, zc + 0.02), 0, 0, -0.9);
    P(g, TO(0.09, 0.012, PI), M(C.iron), -0.4, 1.03, zc + 0.02);
    P(g, CY(0.14, 0.12, 0.04, 20), iron, 0.4, 0.91, zc + 0.02);
    P(g, B(0.22, 0.025, 0.04, 0.01), M(C.walnut), 0.62, 0.92, zc + 0.02);
    P(g, CY(0.07, 0.07, 0.01, 16), M(C.white, 0.5), 0.38, 0.935, zc + 0.04, false);
    E(g, M('#ffc83a', 0.4), 0.38, 0.945, zc + 0.04, 0.06, 0.035, 0.06, false);
  },
  kitchen_icebox(g) {
    const body = M('#a6dcc6', 0.4), chrome = chromeM();
    const W = 0.72, D = 0.62, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, CY(0.03, 0.03, 0.08, 10), chrome, sx * 0.26, 0.04, zc + sz * 0.22);
    P(g, B(W, 1.42, D, 0.13), body, 0, 0.79, zc);
    P(g, B(W - 0.1, 0.02, 0.012, 0.005), M('#7fc2a8', 0.5), 0, 1.08, zf);
    for (const y of [1.28, 0.86]) P(g, B(0.04, 0.2, 0.05, 0.02), chrome, 0.26, y, zf + 0.02);
    P(g, B(0.2, 0.05, 0.015, 0.01), chrome, 0, 1.38, zf);
    P(g, B(W - 0.12, 0.08, 0.02, 0.01), chrome, 0, 0.16, zf - 0.005);
    // 冰箱磁鐵與便條
    P(g, heartGeo(0.08, 0.015, 0.006), M(C.red, 0.5), -0.15, 0.94, zf + 0.005);
    P(g, starGeo(0.045, 0.02, 0.012), M('#ffd84a', 0.5), 0.05, 0.72, zf + 0.005);
    R(P(g, B(0.14, 0.18, 0.004, 0.001), M(C.white, 0.9), -0.12, 0.7, zf, false), 0, 0, 0.1);
    R(P(g, CY(0.022, 0.022, 0.012, 12), M('#5b8fd1', 0.5), -0.12, 0.78, zf + 0.008), HP);
    // 頂上水果籃
    P(g, CY(0.16, 0.12, 0.1, 16), M('#d8a860', 0.9), 0, 1.55, zc);
    E(g, M('#e0443a', 0.5), -0.06, 1.62, zc, 0.11);
    E(g, M('#8fcf4a', 0.5), 0.06, 1.62, zc + 0.03, 0.1);
    E(g, M('#ffcf3a', 0.5), 0.0, 1.63, zc - 0.07, 0.1);
  },
  kitchen_counter(g) {
    const cream = M(C.enamel, 0.5), mint = M(C.minty, 0.45), chrome = chromeM();
    const W = 1.8, D = 0.6, zc = -0.5 + 0.06 + D / 2, zf = zc + D / 2;
    P(g, B(W - 0.08, 0.1, D - 0.08, 0.02), M('#6f5a48'), 0, 0.05, zc - 0.02);
    P(g, B(W - 0.04, 0.74, D - 0.02, 0.03), cream, 0, 0.47, zc);
    P(g, B(W, 0.07, D + 0.04, 0.02), M(C.pine, 0.6), 0, 0.875, zc);
    for (const x of [-0.58, 0, 0.58]) {
      P(g, B(0.52, 0.44, 0.03, 0.02), mint, x, 0.36, zf);
      E(g, chrome, x + (x < 0 ? 0.18 : x > 0 ? -0.18 : 0.18), 0.48, zf + 0.03, 0.045);
      P(g, B(0.52, 0.16, 0.03, 0.02), mint, x, 0.7, zf);
      E(g, chrome, x, 0.7, zf + 0.03, 0.045);
    }
    P(g, B(W, 0.32, 0.03, 0.005), texMat('subway', () => repTex(subwayTex(), 6, 1.3), 0.4), 0, 1.07, zc - D / 2 + 0.02);
    // 砧板、番茄、紅蘿蔔、刀
    P(g, B(0.44, 0.03, 0.3, 0.015), M(C.pineL), -0.45, 0.925, zc + 0.05);
    E(g, M('#e0443a', 0.45), -0.56, 0.98, zc + 0.06, 0.1);
    E(g, M(C.leaf), -0.56, 1.03, zc + 0.06, 0.04, 0.015, 0.04);
    R(P(g, CO(0.028, 0.2, 10), M('#f08a2c', 0.6), -0.36, 0.96, zc + 0.1), 0, 0, -HP);
    E(g, M(C.leaf), -0.24, 0.965, zc + 0.1, 0.07, 0.03, 0.04);
    P(g, B(0.16, 0.006, 0.035, 0.002), chrome, -0.36, 0.943, zc - 0.04);
    P(g, B(0.08, 0.02, 0.03, 0.008), M(C.walnut), -0.24, 0.948, zc - 0.04);
    // 攪拌碗、湯匙筒
    P(g, CY(0.16, 0.1, 0.12, 20), M('#f3a7b4', 0.4), 0.42, 0.97, zc + 0.02);
    P(g, CY(0.14, 0.14, 0.01, 20), M('#fff6de', 0.6), 0.42, 1.02, zc + 0.02, false);
    P(g, CY(0.06, 0.06, 0.16, 12), M('#9fd0e8', 0.35), 0.76, 0.99, zc - 0.16);
    for (const [dx, rz] of [[-0.02, 0.15], [0.02, -0.12], [0, 0.02]]) R(P(g, CY(0.008, 0.008, 0.26, 6), M(C.walnut), 0.76 + dx, 1.08, zc - 0.16, false), 0, 0, rz);
  },

  // ===== 寵物用品 =====
  pet_bed(g) {
    const rim = P(g, TO(0.3, 0.12), M('#a9cfe8', 0.95), 0, 0.1, 0);
    rim.rotation.x = HP;
    rim.scale.z = 0.8;
    E(g, M('#fbf1e2', 0.95), 0, 0.07, 0, 0.64, 0.12, 0.64);
    const paw = M('#f2b8c6', 0.9);
    E(g, paw, 0, 0.13, 0.04, 0.12, 0.02, 0.1, false);
    for (const [x, z] of [[-0.08, -0.05], [-0.03, -0.09], [0.03, -0.09], [0.08, -0.05]]) E(g, paw, x, 0.13, z, 0.045, 0.02, 0.05, false);
    const bone = M(C.white, 0.6);
    R(P(g, CY(0.018, 0.018, 0.14, 8), bone, 0.28, 0.025, 0.34), 0, 0, HP);
    for (const s of [-1, 1]) for (const o of [-0.02, 0.02]) E(g, bone, 0.28 + s * 0.07, 0.028, 0.34 + o, 0.045);
  },
  pet_cattower(g) {
    const carpet = M('#ecdcc2', 1), pink = M('#f2b8c6', 0.95), sisal = M('#d9b98a', 1);
    P(g, B(0.78, 0.08, 0.78, 0.03), carpet, 0, 0.04, 0);
    P(g, B(0.42, 0.36, 0.42, 0.06), pink, -0.15, 0.26, -0.12);
    R(P(g, CY(0.11, 0.11, 0.01, 18), M('#4a3530', 1), -0.15, 0.24, 0.095, false), HP);
    P(g, CY(0.055, 0.055, 0.66, 12), sisal, -0.15, 0.77, -0.12);
    P(g, CY(0.25, 0.25, 0.06, 20), carpet, -0.15, 1.13, -0.12);
    R(P(g, TO(0.19, 0.05), pink, -0.15, 1.19, -0.12), HP);
    P(g, CY(0.055, 0.055, 0.62, 12), sisal, 0.2, 0.39, 0.18);
    P(g, CY(0.22, 0.22, 0.06, 20), pink, 0.2, 0.73, 0.18);
    const ring = M('#c9a574', 1);
    for (const y of [0.25, 0.45, 0.62]) R(P(g, TO(0.057, 0.008), ring, 0.2, y, 0.18, false), HP);
    for (const y of [0.6, 0.8, 1.0]) R(P(g, TO(0.057, 0.008), ring, -0.15, y, -0.12, false), HP);
    P(g, CY(0.004, 0.004, 0.2, 4), M(C.ink), 0.36, 0.6, 0.22, false);
    E(g, M('#ffd84a', 1), 0.36, 0.49, 0.22, 0.08);
  },
  pet_bowl(g) {
    P(g, B(0.62, 0.015, 0.4, 0.007), M('#f6c3cf', 0.9), 0, 0.008, 0, false);
    P(g, CY(0.12, 0.1, 0.08, 20), M('#e36b5d', 0.45), -0.15, 0.055, 0);
    P(g, CY(0.1, 0.1, 0.01, 18), M('#a8683a', 0.9), -0.15, 0.093, 0, false);
    P(g, mergedDots('kibble', () => [[-0.03, 0.1, 0.02, 0.022], [0.02, 0.1, -0.03, 0.022], [0.03, 0.1, 0.03, 0.02], [-0.04, 0.1, -0.03, 0.02], [0, 0.11, 0, 0.022]]), M('#8a522e', 0.8), -0.15, 0, 0, false);
    P(g, CY(0.12, 0.1, 0.08, 20), M('#6fa8dc', 0.45), 0.15, 0.055, 0);
    P(g, CY(0.1, 0.1, 0.01, 18), M('#bfe6ff', 0.1), 0.15, 0.092, 0, false);
    P(g, heartGeo(0.08, 0.01, 0.004), M(C.white, 0.6), 0.15, 0.055, 0.12, false);
    P(g, heartGeo(0.08, 0.01, 0.004), M(C.white, 0.6), -0.15, 0.055, 0.12, false);
  },

  // ===== 牆飾（原點＝貼牆背面中心，往 +z 凸出，垂直置中） =====
  wall_painting(g) {
    P(g, B(0.84, 0.64, 0.05, 0.02), M('#b8793f', 0.6), 0, 0, 0.025);
    P(g, B(0.74, 0.54, 0.052, 0.01), goldM(), 0, 0, 0.026);
    P(g, PL(0.7, 0.5), texMat('landscape', landscapeTex, 0.9), 0, 0, 0.053, false);
  },
  wall_clock(g) {
    const wood = M('#a86e3c', 0.7), roof = M('#6f4428', 0.7);
    P(g, B(0.4, 0.44, 0.16, 0.03), wood, 0, 0.1, 0.08);
    for (const s of [-1, 1]) R(P(g, B(0.32, 0.04, 0.2, 0.015), roof, s * 0.12, 0.4, 0.11), 0, 0, -s * 0.62);
    E(g, M(C.leaf), -0.17, 0.3, 0.19, 0.08, 0.05, 0.03);
    E(g, M(C.leaf), 0.17, 0.3, 0.19, 0.08, 0.05, 0.03);
    // 布穀鳥
    E(g, M('#ffd84a', 0.6), 0, 0.53, 0.1, 0.08);
    R(P(g, CO(0.015, 0.04, 6), M('#f08a2c'), 0, 0.53, 0.155), HP);
    P(g, B(0.1, 0.1, 0.02, 0.008), M('#3a2618'), 0, 0.25, 0.165);
    E(g, M('#ffd84a', 0.6), 0, 0.25, 0.18, 0.06);
    R(P(g, CY(0.11, 0.11, 0.02, 24), M('#fbf3dd', 0.6), 0, 0.05, 0.165), HP);
    P(g, TO(0.11, 0.012), goldM(), 0, 0.05, 0.172);
    P(g, B(0.012, 0.08, 0.005, 0.002), M(C.ink), 0, 0.08, 0.18, false);
    R(P(g, B(0.012, 0.05, 0.005, 0.002), M(C.ink), 0.02, 0.06, 0.18, false), 0, 0, -1.2);
    for (let i = 0; i < 4; i++) E(g, M(C.ink), Math.sin((i * PI) / 2) * 0.085, 0.05 + Math.cos((i * PI) / 2) * 0.085, 0.176, 0.018, 0.018, 0.008, false);
    // 鐘擺（左右擺動）
    const pv = new THREE.Group();
    pv.position.set(0, -0.12, 0.03);
    Object.assign(pv.userData, { fx: 'pendulum', ph: PH });
    g.add(pv);
    P(pv, B(0.014, 0.34, 0.008, 0.003), goldM(), 0, -0.17, 0);
    R(P(pv, CY(0.05, 0.05, 0.015, 20), goldM(), 0, -0.34, 0), HP);
    // 松果砝碼
    for (const sx of [-1, 1]) {
      P(g, CY(0.004, 0.004, 0.22, 4), goldM(), sx * 0.1, -0.23, 0.1, false);
      R(P(g, CO(0.035, 0.12, 8), M('#6a4428', 0.9), sx * 0.1, -0.39, 0.1), PI);
    }
  },
  wall_window(g) {
    const white = M('#fffaf0', 0.6);
    const W = 1.5, H = 1.1;
    P(g, B(W, H, 0.08, 0.03), white, 0, 0.05, 0.04);
    tagWindow(P(g, PL(W - 0.2, H - 0.2), skyMat(), 0, 0.05, 0.082, false));
    P(g, B(0.05, H - 0.2, 0.03, 0.01), white, 0, 0.05, 0.095);
    P(g, B(W - 0.2, 0.05, 0.03, 0.01), white, 0, 0.1, 0.095);
    P(g, B(W + 0.12, 0.05, 0.14, 0.02), white, 0, -0.5, 0.07);
    P(g, B(W - 0.2, 0.18, 0.16, 0.03), M('#8fb86a', 0.8), 0, -0.62, 0.12);
    const fl = ['#ff7aa8', '#ffd84a', '#ff9a4a', '#ffffff', '#c89af0'];
    for (let i = 0; i < 7; i++) E(g, M(fl[i % fl.length], 0.7), -0.54 + i * 0.18, -0.48, 0.12 + (i % 2) * 0.03, 0.13);
    for (let i = 0; i < 4; i++) E(g, M(C.leaf), -0.45 + i * 0.3, -0.52, 0.18, 0.14, 0.06, 0.08);
    for (const sx of [-1, 1]) R(P(g, B(0.24, 1.05, 0.03, 0.015), gingham(C.red, 3, 12), sx * (W / 2 - 0.04), 0.1, 0.13), 0, 0, sx * 0.03);
    P(g, B(W + 0.1, 0.16, 0.05, 0.025), gingham(C.red, 16, 2), 0, 0.62, 0.12);
    R(P(g, CY(0.015, 0.015, W + 0.2, 8), goldM(), 0, 0.7, 0.1), 0, 0, HP);
  },
  wall_shelf(g) {
    const wood = M(C.pine), dark = M(C.pineD);
    P(g, B(1.7, 0.05, 0.22, 0.02), wood, 0, -0.18, 0.11);
    for (const sx of [-1, 1]) {
      P(g, B(0.04, 0.18, 0.04, 0.01), dark, sx * 0.6, -0.29, 0.02);
      R(P(g, B(0.03, 0.22, 0.03, 0.01), dark, sx * 0.6, -0.28, 0.1), PI / 4);
    }
    // 小熊
    const bear = M('#c8874e', 0.95), snout = M('#f3dcc0', 0.95);
    const bx = -0.52, by = -0.155, bz = 0.11;
    E(g, bear, bx, by + 0.1, bz, 0.2, 0.22, 0.18);
    E(g, bear, bx, by + 0.26, bz + 0.01, 0.17);
    for (const s of [-1, 1]) {
      E(g, bear, bx + s * 0.07, by + 0.33, bz, 0.07, 0.07, 0.04);
      E(g, bear, bx + s * 0.1, by + 0.1, bz + 0.05, 0.07, 0.1, 0.07);
      E(g, bear, bx + s * 0.06, by + 0.03, bz + 0.08, 0.08, 0.07, 0.1);
      E(g, M(C.ink), bx + s * 0.035, by + 0.28, bz + 0.085, 0.022);
    }
    E(g, snout, bx, by + 0.24, bz + 0.08, 0.07, 0.055, 0.05);
    E(g, M(C.ink), bx, by + 0.255, bz + 0.105, 0.025, 0.018, 0.015);
    E(g, M(C.red), bx, by + 0.18, bz + 0.07, 0.08, 0.04, 0.03);
    // 書、盆栽、罐子
    const cols = ['#5b8fd1', '#f2c14e', '#6fae6a', '#e98fb0', '#d9544d'];
    P(g, mergedBoxes('wallShelfBooks', () => [
      ...cols.slice(0, 4).map((c, i) => ({ w: 0.045, h: 0.2 + (i % 2) * 0.04, d: 0.15, x: -0.12 + i * 0.05, y: -0.155 + 0.1 + (i % 2) * 0.02, z: 0.11, c })),
      { w: 0.045, h: 0.22, d: 0.15, x: 0.12, y: -0.155 + 0.1, z: 0.11, rz: -0.4, c: cols[4] },
    ]), vcM());
    P(g, CY(0.07, 0.055, 0.1, 14), M(C.terracotta, 0.85), 0.52, -0.105, 0.11);
    I(g, M(C.leaf), 0.52, -0.01, 0.11, 0.15);
    E(g, M('#ff8fb0'), 0.49, 0.04, 0.15, 0.05);
    E(g, M('#ffd84a'), 0.56, 0.03, 0.14, 0.045);
    P(g, CY(0.05, 0.05, 0.12, 12), M('#cfeeff', 0.2), 0.3, -0.095, 0.11);
    P(g, CY(0.052, 0.052, 0.025, 12), M(C.red), 0.3, -0.025, 0.11);
  },
  wall_photo(g) {
    const sub = new THREE.Group();
    sub.rotation.z = 0.035;
    g.add(sub);
    P(sub, B(0.68, 0.56, 0.04, 0.02), M(C.pineL, 0.6), 0, 0, 0.02);
    P(sub, PL(0.58, 0.46), texMat('family', familyTex, 0.8), 0, 0, 0.041, false);
    R(P(g, heartGeo(0.12, 0.02, 0.008), M(C.rose, 0.6), 0.29, 0.25, 0.05), 0, 0, 0.3);
    E(g, goldM(), 0, 0.42, 0.016, 0.03);
    for (const s of [-1, 1]) R(P(g, CY(0.003, 0.003, 0.27, 4), M(C.ink), s * 0.12, 0.35, 0.01, false), 0, 0, s * 1.1);
  },

  // ===== 節慶與特殊來源 =====
  cny_lion(g) {
    const red = M('#e0352b', 0.55), gold = goldM(), fur = M('#fffaf0', 1), black = M(C.ink, 0.4);
    P(g, B(0.62, 0.26, 0.52, 0.05), M('#b52a22', 0.4), 0, 0.13, 0);
    P(g, B(0.64, 0.04, 0.54, 0.02), gold, 0, 0.24, 0);
    const h = new THREE.Group();
    h.position.set(0, 0.56, 0);
    g.add(h);
    E(h, red, 0, 0.06, -0.02, 0.62, 0.5, 0.52);
    R(P(h, CO(0.05, 0.16, 10), gold, 0, 0.33, 0.06), 0.35);
    R(P(h, CY(0.055, 0.055, 0.02, 16), M('#b9c9d6', 0.5, 0.2), 0, 0.2, 0.22), HP - 0.55);
    P(h, TO(0.058, 0.01), gold, 0, 0.2, 0.225).rotation.x = -0.55;
    for (const s of [-1, 1]) {
      E(h, fur, s * 0.12, 0.08, 0.19, 0.15, 0.15, 0.1);
      E(h, black, s * 0.12, 0.08, 0.24, 0.07);
      E(h, fur, s * 0.14, 0.1, 0.27, 0.02);
      E(h, gold, s * 0.12, 0.15, 0.19, 0.17, 0.07, 0.12);
      E(h, fur, s * 0.13, 0.21, 0.17, 0.17, 0.07, 0.08);
      E(h, gold, s * 0.1, -0.06, 0.22, 0.16, 0.12, 0.12);
      E(h, gold, s * 0.28, 0.18, -0.02, 0.1, 0.16, 0.08);
      E(h, M('#6fc26a', 1), s * 0.3, 0.0, 0.1, 0.1);
      E(h, fur, s * 0.04, -0.11, 0.25, 0.04, 0.05, 0.03);
    }
    E(h, M('#f28aa0', 0.5), 0, 0.0, 0.27, 0.12, 0.09, 0.09);
    E(h, red, 0, -0.18, 0.12, 0.4, 0.14, 0.34);
    E(h, M('#7a1a14', 0.6), 0, -0.12, 0.2, 0.24, 0.06, 0.12);
    for (const x of [-0.1, 0, 0.1]) E(h, fur, x, -0.27, 0.12, 0.12);
    // 後方鬃毛
    for (let i = 0; i < 7; i++) {
      const a = PI * (0.1 + i * 0.133);
      E(h, i % 2 ? fur : M('#ffd84a', 1), Math.cos(a) * 0.3, Math.sin(a) * 0.22 + 0.02, -0.16, 0.12);
    }
  },
  cny_couplet(g) {
    const paper = (t: string, v: boolean) => texMat('cp' + t, () => coupletTex(t, v), 0.9);
    P(g, PL(0.28, 1.12), paper('六畜興旺', true), -0.72, -0.1, 0.012, false);
    P(g, PL(0.28, 1.12), paper('五穀豐登', true), 0.72, -0.1, 0.012, false);
    P(g, PL(1.0, 0.25), paper('春滿農家', false), 0, 0.62, 0.012, false);
    R(P(g, PL(0.42, 0.42), texMat('fu', fuTex, 0.9), 0, -0.08, 0.014, false), 0, 0, PI / 4);
    for (const x of [-0.72, 0.72]) E(g, goldM(), x, 0.47, 0.015, 0.04, 0.04, 0.02);
  },
  lantern_string(g) {
    const pts: [number, number, number][] = [[-0.85, 0.4, 0.04], [-0.42, 0.22, 0.11], [0, 0.16, 0.13], [0.42, 0.22, 0.11], [0.85, 0.4, 0.04]];
    P(g, tubeGeo('lanternCord', pts, 0.01), M('#8a2a20', 0.8), 0, 0, 0, false);
    for (const s of [-1, 1]) E(g, goldM(), s * 0.85, 0.4, 0.028, 0.05);
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const gold = goldM(), tassel = M('#f5c542', 0.8);
    for (let i = 0; i < 5; i++) {
      const body = G('#d8302a', '#ff3a18', { roughness: 0.5 });
      const p = curve.getPoint(0.1 + i * 0.2);
      const y = p.y - 0.2, z = 0.13;
      P(g, CY(0.004, 0.004, 0.08, 4), M(C.ink), p.x, p.y - 0.04, z, false);
      P(g, CY(0.045, 0.05, 0.03, 12), gold, p.x, y + 0.1, z);
      glow(E(g, body, p.x, y, z, 0.2, 0.17, 0.2), 0.25, 1.1, 0.06, PH + i * 1.3);
      P(g, CY(0.05, 0.045, 0.03, 12), gold, p.x, y - 0.1, z);
      P(g, CY(0.012, 0.02, 0.12, 6), tassel, p.x, y - 0.17, z, false);
    }
  },
  xmas_tree(g) {
    P(g, CY(0.2, 0.16, 0.26, 18), M('#c8392f', 0.5), 0, 0.13, 0);
    P(g, CY(0.205, 0.205, 0.04, 18), goldM(), 0, 0.21, 0);
    P(g, CY(0.05, 0.05, 0.14, 8), M(C.walnut), 0, 0.32, 0);
    const tiers: [number, number, number][] = [[0.42, 0.55, 0.62], [0.34, 0.48, 0.93], [0.25, 0.4, 1.2], [0.16, 0.32, 1.43]];
    tiers.forEach(([r, h, y], i) => P(g, CO(r, h, 16), M(i % 2 ? '#4aa865' : '#3f9a5a', 0.8), 0, y, 0));
    glow(P(g, starGeo(0.12, 0.055, 0.04), G('#ffe07a', '#ffc23a', { metalness: 0.2 }), 0, 1.68, 0.02, false), 0.7, 2.6, 0.08);
    // 彩球（落在圓錐表面）
    const spots: [number, number][] = [];
    tiers.forEach((_, i) => {
      for (let k = 0; k < 3; k++) spots.push([i, (k / 3) * PI * 2 + i * 0.9 + 0.3]);
    });
    const bm = [M('#e0342c', 0.3, 0.3), M('#f2c14e', 0.3, 0.45), M('#5b8fd1', 0.3, 0.3), M('#ffffff', 0.3, 0.2)];
    spots.forEach(([i, a], n) => {
      const [r, h, y] = tiers[i];
      const f = 0.22, rr = r * (1 - f) + 0.02;
      E(g, bm[n % bm.length], Math.sin(a) * rr, y - h / 2 + f * h, Math.cos(a) * rr, 0.085);
    });
    // 燈泡串：兩組交替閃爍
    for (let set = 0; set < 2; set++) {
      const geo = mergedDots('treeLights' + set, () => {
        const out: [number, number, number, number][] = [];
        tiers.forEach(([r, h, y], i) => {
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * PI * 2 + set * 0.78 + i * 0.4, f = 0.45 + (k % 2) * 0.15, rr = r * (1 - f) + 0.015;
            out.push([Math.sin(a) * rr, y - h / 2 + f * h, Math.cos(a) * rr, 0.022]);
          }
        });
        return out;
      });
      glow(P(g, geo, G(set ? '#fff1b0' : '#ffd0e0', set ? '#ffd35a' : '#ff8fb0'), 0, 0, 0, false), 0.5, 2.4, 0.5, PH + set * PI);
    }
    // 禮物
    const gift = (x: number, z: number, s: number, c: string, rc: string, ry: number) => {
      const b = R(P(g, B(s, s * 0.85, s, 0.015), M(c, 0.6), x, (s * 0.85) / 2, z), 0, ry, 0);
      const rib = M(rc, 0.4);
      R(P(g, B(s + 0.005, s * 0.86, 0.03, 0.005), rib, x, (s * 0.85) / 2, z), 0, ry, 0);
      R(P(g, B(0.03, s * 0.86, s + 0.005, 0.005), rib, x, (s * 0.85) / 2, z), 0, ry, 0);
      return b;
    };
    gift(0.26, 0.28, 0.18, '#5b8fd1', '#f2c14e', 0.3);
    gift(-0.28, 0.25, 0.14, '#e98fb0', '#ffffff', -0.4);
  },
  pumpkin_lamp(g) {
    const hay = M('#e7c35a', 1);
    P(g, B(0.56, 0.22, 0.4, 0.04), hay, 0, 0.11, 0);
    for (const x of [-0.15, 0.15]) P(g, B(0.03, 0.225, 0.405, 0.01), M('#a8803a', 1), x, 0.11, 0);
    const orange = G('#f08a24', '#ff7a1a', { roughness: 0.6 });
    const pumpkin = (cx: number, cy: number, cz: number, s: number, n: number, m: Std, tag: boolean) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2;
        const o = E(g, m, cx + Math.cos(a) * 0.13 * s, cy, cz + Math.sin(a) * 0.13 * s, 0.24 * s, 0.36 * s, 0.34 * s);
        o.rotation.y = HP - a;
        if (tag) glow(o, 0, 0.35);
      }
      R(P(g, CY(0.025 * s, 0.04 * s, 0.12 * s, 8), M('#6b7a34', 0.8), cx, cy + 0.2 * s, cz), 0, 0, 0.25);
    };
    pumpkin(0, 0.4, 0, 1, 8, orange, true);
    orange.emissiveIntensity = 0;
    E(g, M(C.leaf), 0.07, 0.6, -0.03, 0.12, 0.03, 0.08);
    P(g, TO(0.05, 0.006, PI * 1.5), M(C.leaf), -0.07, 0.6, 0.0, false);
    // 雕刻的臉（發光）
    const face = G('#ffe07a', '#ffb02e', { roughness: 0.6 });
    const eye = cg('pkEye', () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.05); sh.lineTo(-0.05, -0.03); sh.lineTo(0.05, -0.03); sh.closePath();
      return new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03);
    });
    const mouth = cg('pkMouth', () => {
      const sh = new THREE.Shape();
      const pts: [number, number][] = [[-0.13, 0.03], [-0.08, 0.0], [-0.05, 0.03], [0, 0.0], [0.05, 0.03], [0.08, 0.0], [0.13, 0.03], [0.09, -0.05], [0.03, -0.07], [0, -0.04], [-0.03, -0.07], [-0.09, -0.05]];
      sh.moveTo(...pts[0]);
      pts.slice(1).forEach((p) => sh.lineTo(...p));
      sh.closePath();
      return new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03);
    });
    for (const s of [-1, 1]) glow(R(P(g, eye, face, s * 0.09, 0.46, 0.265, false), -0.2, s * 0.3, 0), 0.8, 2.6, 0.15);
    glow(R(P(g, mouth, face, 0, 0.34, 0.275, false), 0.25, 0, 0), 0.8, 2.6, 0.15);
    // 旁邊的小南瓜（不發光）
    pumpkin(0.3, 0.075, 0.3, 0.42, 6, M('#f5a33a', 0.6), false);
  },
  moon_lamp(g) {
    P(g, CY(0.2, 0.22, 0.05, 20), M(C.walnut), 0, 0.025, 0);
    P(g, CY(0.02, 0.02, 0.7, 8), M('#c99a5a', 0.4, 0.4), 0, 0.4, 0);
    P(g, TO(0.26, 0.018, PI), M('#c99a5a', 0.4, 0.4), 0, 0.98, 0).rotation.z = PI;
    const moon = G('#fbf1cf', '#fff0c0', { roughness: 0.8 });
    glow(E(g, moon, 0, 0.98, 0, 0.48, 0.48, 0.48, false), 0.55, 2.2, 0.03);
    const crater = G('#eadbb0', '#f5dca0', { roughness: 0.9 });
    for (const [x, y, z, s] of [[0.1, 1.08, 0.19, 0.09], [-0.12, 0.94, 0.19, 0.07], [0.02, 0.88, 0.22, 0.05], [-0.05, 1.12, 0.18, 0.06]]) glow(E(g, crater, x, y, z, s, s, s * 0.4, false), 0.4, 1.6);
    // 玉兔
    const bun = M('#ffffff', 0.9);
    E(g, bun, 0.18, 0.12, 0.12, 0.16, 0.14, 0.18);
    E(g, bun, 0.18, 0.22, 0.17, 0.12);
    for (const s of [-1, 1]) {
      R(E(g, bun, 0.18 + s * 0.025, 0.32, 0.16, 0.04, 0.14, 0.03), 0, 0, -s * 0.15);
      E(g, M(C.ink), 0.18 + s * 0.03, 0.23, 0.225, 0.018);
    }
    E(g, M(C.rose), 0.18, 0.21, 0.23, 0.02);
  },
  fw_launcher(g) {
    const wood = M(C.pine), dark = M(C.pineD);
    P(g, B(0.56, 0.22, 0.46, 0.03), wood, 0, 0.11, 0);
    for (const y of [0.07, 0.15]) P(g, B(0.565, 0.012, 0.465, 0.004), dark, 0, y, 0);
    P(g, starGeo(0.06, 0.028, 0.015), M(C.red, 0.5), 0, 0.11, 0.235);
    const cols = ['#e0342c', '#5b8fd1', '#f2c14e', '#6fc26a', '#e98fb0', '#8a6fc2'];
    const hs = [0.34, 0.42, 0.3, 0.38, 0.46, 0.32];
    let i = 0;
    for (const z of [-0.08, 0.1]) for (const x of [-0.16, 0, 0.16]) {
      const h = hs[i], m = M(cols[i], 0.5);
      const t = new THREE.Group();
      t.position.set(x, 0.22, z);
      t.rotation.set(z * 0.6, 0, -x * 0.6);
      g.add(t);
      P(t, CY(0.055, 0.055, h, 12), m, 0, h / 2, 0);
      P(t, CY(0.057, 0.057, 0.04, 12), M(C.white, 0.6), 0, h * 0.6, 0);
      P(t, CO(0.058, 0.07, 12), m, 0, h + 0.035, 0);
      R(P(t, CY(0.005, 0.005, 0.08, 4), M(C.ink), 0.02, h + 0.1, 0, false), 0, 0, -0.4);
      i++;
    }
  },
  heart_cushion(g) {
    R(P(g, heartGeo(0.78, 0.08, 0.06), M('#f48fb1', 0.95), 0, 0.1, 0.02), -HP);
    E(g, M('#e56f98', 0.8), 0, 0.2, -0.02, 0.07, 0.04, 0.07);
    R(P(g, heartGeo(0.34, 0.07, 0.04), M('#fff0f5', 0.95), 0, 0.36, -0.14), -0.28);
  },
  heart_plushie(g) {
    const tan = M('#e9a55f', 0.95), cream = M('#fbeedb', 0.95), pink = M('#f7a1b5', 0.9), black = M(C.ink, 0.4);
    const d = new THREE.Group();
    d.scale.setScalar(1.15);
    g.add(d);
    E(d, tan, 0, 0.2, -0.02, 0.36, 0.36, 0.34);
    E(d, cream, 0, 0.19, 0.1, 0.22, 0.24, 0.14);
    E(d, tan, 0, 0.47, 0.02, 0.34, 0.3, 0.3);
    E(d, cream, 0, 0.43, 0.15, 0.16, 0.11, 0.1);
    E(d, black, 0, 0.46, 0.2, 0.05, 0.035, 0.035);
    for (const s of [-1, 1]) {
      E(d, black, s * 0.075, 0.5, 0.15, 0.045);
      E(d, pink, s * 0.11, 0.44, 0.13, 0.05, 0.03, 0.02);
      R(E(d, tan, s * 0.12, 0.63, -0.01, 0.12, 0.2, 0.06), 0, 0, -s * 0.35);
      R(E(d, pink, s * 0.12, 0.62, 0.015, 0.07, 0.13, 0.02), 0, 0, -s * 0.35);
      E(d, cream, s * 0.08, 0.05, 0.14, 0.1, 0.08, 0.12);
      E(d, tan, s * 0.15, 0.08, 0.02, 0.14, 0.12, 0.2);
      R(E(d, pink, s * 0.05, 0.33, 0.13, 0.08, 0.06, 0.04), 0, 0, s * 0.3);
    }
    E(d, M('#e56f98', 0.8), 0, 0.33, 0.14, 0.04);
    E(d, tan, 0, 0.18, -0.2, 0.08);
  },
  stamp_spring(g) {
    const dark = M('#6b4630', 0.7);
    P(g, B(0.56, 0.05, 0.42, 0.02), dark, 0, 0.3, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, B(0.05, 0.28, 0.05, 0.015), dark, sx * 0.23, 0.14, sz * 0.16);
    P(g, B(0.44, 0.1, 0.3, 0.03), M('#5e8fb8', 0.35), 0, 0.375, 0);
    P(g, B(0.4, 0.02, 0.26, 0.01), M('#4a3526', 1), 0, 0.43, 0);
    for (const [x, z] of [[-0.12, 0.06], [0.1, -0.05], [0.14, 0.08]]) E(g, M('#6fae4a', 0.9), x, 0.44, z, 0.1, 0.04, 0.08);
    const bark = M('#5c3b28', 0.9);
    P(g, tubeGeo('bonsaiTrunk', [[0, 0.42, 0], [-0.07, 0.55, 0.02], [0.02, 0.68, 0], [-0.04, 0.82, -0.02]], 0.035), bark);
    P(g, tubeGeo('bonsaiBranch', [[0.0, 0.66, 0], [0.12, 0.72, 0.03], [0.21, 0.76, 0.02]], 0.02), bark);
    E(g, bark, 0, 0.44, 0, 0.12, 0.06, 0.1);
    const pinks = [M('#f7b6c8', 0.9), M('#fbd0dc', 0.9), M('#f29bb5', 0.9)];
    const bl: [number, number, number, number][] = [[-0.06, 0.9, 0, 0.3], [0.22, 0.83, 0.02, 0.22], [-0.2, 0.76, 0.05, 0.2], [0.07, 1.0, -0.04, 0.2], [0.12, 0.72, 0.12, 0.14]];
    bl.forEach(([x, y, z, s], i) => I(g, pinks[i % 3], x, y, z, s));
    for (const [x, z] of [[-0.2, 0.15], [0.18, -0.14], [0.22, 0.12]]) E(g, pinks[1], x, 0.33, z, 0.04, 0.008, 0.03, false);
  },
  stamp_summer(g) {
    // 風鈴：牆上木鉤＋玻璃鐘（畫金魚）＋短冊紙條，整組會隨風擺動
    const wood = M(C.walnut);
    P(g, B(0.12, 0.2, 0.025, 0.01), wood, 0, 0.34, 0.0125);
    P(g, B(0.035, 0.035, 0.12, 0.012), wood, 0, 0.4, 0.08);
    P(g, CY(0.012, 0.012, 0.05, 8), wood, 0, 0.39, 0.13);
    const pv = new THREE.Group();
    pv.position.set(0, 0.37, 0.13);
    Object.assign(pv.userData, { fx: 'chime', amp: 0.1, ph: PH });
    g.add(pv);
    P(pv, CY(0.003, 0.003, 0.12, 4), M(C.white), 0, -0.06, 0, false);
    // 玻璃鐘（前後略扁，才能收在 0.25 深度內）
    const bg = new THREE.Group();
    bg.scale.set(1.25, 1.25, 0.92);
    pv.add(bg);
    const glass = MX('chimeGlass', () => mat('#bfe6ff', { transparent: true, opacity: 0.62, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    P(bg, domeGeo(0.12), glass, 0, -0.22, 0, false);
    R(P(bg, TO(0.12, 0.008), M('#8fd0f2', 0.2), 0, -0.22, 0, false), HP);
    R(P(bg, TO(0.108, 0.006), M('#e0443a', 0.5), 0, -0.17, 0, false), HP);
    // 畫在玻璃上的小金魚
    for (const [a, h] of [[0.35, 0.075], [-0.7, 0.07]]) {
      const r = Math.sqrt(0.12 * 0.12 - h * h) + 0.004;
      const fish = new THREE.Group();
      fish.position.set(Math.sin(a) * r, -0.22 + h, Math.cos(a) * r);
      fish.rotation.y = a;
      bg.add(fish);
      E(fish, M('#f07a3a', 0.5), 0, 0, 0, 0.06, 0.034, 0.014, false);
      E(fish, M('#f07a3a', 0.5), -0.035, 0, 0, 0.025, 0.04, 0.01, false);
    }
    P(bg, CY(0.002, 0.002, 0.14, 4), M(C.white), 0, -0.2, 0, false);
    E(bg, glass, 0, -0.27, 0, 0.04, 0.04, 0.04, false);
    // 短冊紙條（擺得比玻璃鐘更大）
    const pp = new THREE.Group();
    pp.position.y = -0.34;
    Object.assign(pp.userData, { fx: 'chime', amp: 0.2, ph: PH + 1.3 });
    pv.add(pp);
    P(pp, CY(0.002, 0.002, 0.06, 4), M(C.white), 0, -0.03, 0, false);
    P(pp, B(0.11, 0.32, 0.004, 0.001), M('#ffc9d6', 0.9), 0, -0.22, 0, false);
    P(pp, B(0.11, 0.04, 0.006, 0.001), M('#6fb6e8', 0.8), 0, -0.34, 0, false);
  },
  stamp_autumn(g) {
    P(g, CY(0.18, 0.2, 0.05, 20), M(C.walnut), 0, 0.025, 0);
    P(g, CY(0.02, 0.02, 0.72, 8), M('#b8894a', 0.4, 0.4), 0, 0.41, 0);
    const washi = G('#fbead0', '#ffb45a', { roughness: 0.9 });
    glow(E(g, washi, 0, 0.98, 0, 0.44, 0.4, 0.44, false), 0.35, 2.0, 0.05);
    P(g, CY(0.07, 0.09, 0.05, 14), M(C.walnut), 0, 1.19, 0);
    P(g, CY(0.09, 0.07, 0.04, 14), M(C.walnut), 0, 0.78, 0);
    const leafCols = [M('#e0502e', 0.7), M('#f08a3c', 0.7), M('#f2b447', 0.7)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + 0.3, y = 0.94 + (i % 2) * 0.1;
      const r = 0.22 * Math.sqrt(1 - ((y - 0.98) / 0.2) ** 2) + 0.004;
      R(P(g, mapleGeo(0.17), leafCols[i % 3], Math.sin(a) * r, y, Math.cos(a) * r, false), 0, a, (i - 2) * 0.3);
    }
    R(P(g, mapleGeo(0.12), leafCols[0], 0.08, 0.056, 0.1, false), -HP, 0, 0.6);
    R(P(g, mapleGeo(0.1), leafCols[2], -0.1, 0.056, 0.02, false), -HP, 0, -0.9);
  },
  stamp_winter(g) {
    P(g, CY(0.3, 0.3, 0.04, 24), M(C.pineL), 0, 0.38, 0);
    P(g, CY(0.04, 0.05, 0.36, 10), M(C.pine), 0, 0.18, 0);
    P(g, CY(0.18, 0.2, 0.03, 20), M(C.pine), 0, 0.015, 0);
    P(g, CY(0.17, 0.2, 0.12, 24), M('#c8392f', 0.4), 0, 0.46, 0);
    P(g, CY(0.175, 0.175, 0.03, 24), goldM(), 0, 0.5, 0);
    E(g, M('#ffffff', 0.9), 0, 0.56, 0, 0.38, 0.1, 0.38);
    P(g, B(0.1, 0.08, 0.08, 0.01), M('#e0604c', 0.6), 0.06, 0.62, 0);
    R(P(g, CO(0.085, 0.07, 4), M('#ffffff', 0.8), 0.06, 0.695, 0), 0, PI / 4, 0);
    glow(P(g, B(0.03, 0.03, 0.005, 0.002), G('#ffe8a0', '#ffc050'), 0.06, 0.62, 0.041, false), 0.5, 2.0);
    P(g, CO(0.06, 0.16, 8), M('#3f9a5a', 0.8), -0.07, 0.66, 0.02);
    P(g, CO(0.035, 0.06, 8), M('#ffffff', 0.8), -0.07, 0.72, 0.02);
    const sg = new THREE.Group();
    sg.position.y = 0.72;
    Object.assign(sg.userData, { fx: 'snow', y0: 0.72, ph: PH });
    g.add(sg);
    P(sg, mergedDots('snowflakes', () => {
      const rnd = mulberry32(9);
      const out: [number, number, number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const a = rnd() * PI * 2, r = 0.05 + rnd() * 0.12;
        out.push([Math.cos(a) * r, -0.06 + rnd() * 0.22, Math.sin(a) * r, 0.01 + rnd() * 0.008]);
      }
      return out;
    }), M('#ffffff', 0.6), 0, 0, 0, false);
    E(g, glassM(), 0, 0.72, 0, 0.44, 0.44, 0.44, false).renderOrder = 2;
  },
};

// 暖暖系列針織材質
function knitMat(a: string, b: string): Std {
  return texMat('knit' + a + b, () => repTex(knitTex(a, b), 6, 2), 0.95);
}
// 廚房白色地鐵磚（0.5 公尺一格）
function subwayTex() {
  return canvasTex('subway', 128, 128, (c) => {
    c.fillStyle = '#dcdcd4'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#fbfaf5';
    for (let r = 0; r < 5; r++) for (let k = -1; k < 3; k++) c.fillRect(k * 64 + (r % 2) * 32 + 2, r * 25.6 + 2, 60, 21.6);
  }, true);
}

// 未知 id：小木箱
function placeholder(g: THREE.Group): void {
  P(g, B(0.5, 0.5, 0.5, 0.03), M(C.pine), 0, 0.25, 0);
  for (const y of [0.12, 0.38]) P(g, B(0.52, 0.05, 0.52, 0.01), M(C.pineD), 0, y, 0);
}

/** 建立家具模型；未知 id 回傳小木箱 */
export function buildFurniture(id: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'furn:' + id;
  g.userData.furnId = id;
  PH = Math.random() * PI * 2;
  const b = BUILDERS[id];
  if (b) b(g);
  else placeholder(g);
  // 地毯不投影，避免在地上蓋一層黑影
  if (FURN_BY_ID[id]?.layer === 'rug') g.traverse((o) => (o.castShadow = false));
  return g;
}

// ---------- 房間外殼 ----------
interface Shell {
  floor: 'planks' | 'checker' | 'parquet' | 'tile';
  fa: string; fb: string; seam: string;
  wall: string; pat: 'stripe' | 'dots' | 'plain' | 'boards' | 'diamond' | 'sprig'; patC: string;
  wains: 'bead' | 'tile' | 'panel' | null; wainsC: string; wainsH: number;
  trim: string; base: string; cut: string; curtain: string; door: string; slab: string;
}
const SHELL: Record<RoomStyle, Shell> = {
  living: { floor: 'planks', fa: '#c98d57', fb: '#bb7f4b', seam: '#8a5a34', wall: '#f8ebd2', pat: 'stripe', patC: '#f0dcb8', wains: 'bead', wainsC: '#e4c395', wainsH: 0.95, trim: '#fff6e4', base: '#b9824e', cut: '#eadcc2', curtain: '#d9544d', door: '#b07446', slab: '#8f6a4a' },
  bedroom: { floor: 'planks', fa: '#ebcca2', fb: '#e0bb8c', seam: '#a97f56', wall: '#c4e3da', pat: 'dots', patC: '#eaf7f2', wains: 'bead', wainsC: '#f6f2ea', wainsH: 0.9, trim: '#ffffff', base: '#f0ebe0', cut: '#e6ece8', curtain: '#f2b6c6', door: '#e9d6bd', slab: '#9a7a5c' },
  kitchen: { floor: 'checker', fa: '#f7efdc', fb: '#e8927f', seam: '#d6ccb6', wall: '#bfe8d6', pat: 'plain', patC: '#b3e0cc', wains: 'tile', wainsC: '#fbfaf5', wainsH: 1.0, trim: '#ffffff', base: '#8fd3bd', cut: '#e4efe8', curtain: '#8fd3bd', door: '#f3e6cf', slab: '#8f7a64' },
  attic: { floor: 'planks', fa: '#8c6444', fb: '#7c5839', seam: '#4c3321', wall: '#c99c6c', pat: 'boards', patC: '#b98b5c', wains: null, wainsC: '#000000', wainsH: 0, trim: '#7a5436', base: '#6d4a30', cut: '#a57c55', curtain: '#e9c46a', door: '#8a5a36', slab: '#6a4c34' },
  study: { floor: 'parquet', fa: '#8e5f3b', fb: '#7c5132', seam: '#4c3120', wall: '#7fa88a', pat: 'diamond', patC: '#93b99c', wains: 'panel', wainsC: '#6d4a31', wainsH: 1.0, trim: '#efe3c8', base: '#5a3c28', cut: '#d8ccb2', curtain: '#b8453c', door: '#6b4630', slab: '#5e4331' },
  sunroom: { floor: 'tile', fa: '#f3ebdc', fb: '#e9dec9', seam: '#d4c6ab', wall: '#fbf0cf', pat: 'sprig', patC: '#a9cf8a', wains: 'bead', wainsC: '#ffffff', wainsH: 0.8, trim: '#ffffff', base: '#ffffff', cut: '#efe6d2', curtain: '#9cc49a', door: '#ffffff', slab: '#a8927a' },
};

// 地板：整片 9×7 公尺畫在一張 canvas（每公尺 128 px）
function floorTex(style: RoomStyle, S: Shell): THREE.Texture {
  return canvasTex('floor-' + style, 1152, 896, (c, w, h) => {
    const ppm = 128;
    const rnd = mulberry32(style.length * 97 + 13);
    const mix = () => (rnd() < 0.5 ? S.fa : S.fb);
    if (S.floor === 'planks') {
      const pw = 32;
      for (let r = 0; r * pw < h; r++) {
        let x = -rnd() * 2 * ppm;
        while (x < w) {
          const L = (1.1 + rnd() * 1.4) * ppm;
          c.fillStyle = tint(mix(), 0.93 + rnd() * 0.12);
          c.fillRect(x, r * pw, L, pw);
          c.strokeStyle = 'rgba(60,30,10,0.08)';
          c.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            const gy = r * pw + 6 + k * 9 + rnd() * 3;
            c.beginPath(); c.moveTo(x + 4, gy);
            c.bezierCurveTo(x + L * 0.3, gy + 3, x + L * 0.6, gy - 3, x + L - 4, gy + 1);
            c.stroke();
          }
          if (rnd() < 0.15) { c.fillStyle = 'rgba(70,40,15,0.18)'; c.beginPath(); c.ellipse(x + L * rnd(), r * pw + pw / 2, 6, 3, 0, 0, PI * 2); c.fill(); }
          c.fillStyle = S.seam;
          c.globalAlpha = 0.6;
          c.fillRect(x, r * pw, 2, pw);
          c.globalAlpha = 0.35;
          c.fillRect(x + 6, r * pw + 6, 2, 2); c.fillRect(x + 6, r * pw + pw - 8, 2, 2);
          c.globalAlpha = 1;
          x += L;
        }
        c.fillStyle = S.seam;
        c.globalAlpha = 0.55;
        c.fillRect(0, r * pw, w, 2);
        c.globalAlpha = 1;
      }
    } else if (S.floor === 'checker') {
      const t = 64;
      for (let i = 0; i * t < w; i++) for (let j = 0; j * t < h; j++) {
        c.fillStyle = tint((i + j) % 2 ? S.fb : S.fa, 0.97 + rnd() * 0.05);
        c.fillRect(i * t, j * t, t, t);
      }
      c.fillStyle = S.seam;
      for (let i = 0; i * t <= w; i++) c.fillRect(i * t - 1, 0, 2, h);
      for (let j = 0; j * t <= h; j++) c.fillRect(0, j * t - 1, w, 2);
    } else if (S.floor === 'parquet') {
      const t = 64, sl = 16;
      for (let i = 0; i * t < w; i++) for (let j = 0; j * t < h; j++) {
        const vert = (i + j) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          c.fillStyle = tint(mix(), 0.9 + rnd() * 0.16);
          if (vert) c.fillRect(i * t + k * sl, j * t, sl, t);
          else c.fillRect(i * t, j * t + k * sl, t, sl);
          c.fillStyle = 'rgba(40,20,8,0.35)';
          if (vert) c.fillRect(i * t + k * sl, j * t, 1, t);
          else c.fillRect(i * t, j * t + k * sl, t, 1);
        }
        c.fillStyle = S.seam;
        c.fillRect(i * t, j * t, t, 2);
        c.fillRect(i * t, j * t, 2, t);
      }
    } else {
      const t = 96;
      for (let i = 0; i * t < w; i++) for (let j = 0; j * t < h; j++) {
        c.fillStyle = tint(mix(), 0.97 + rnd() * 0.05);
        c.fillRect(i * t, j * t, t, t);
        c.fillStyle = 'rgba(120,100,70,0.06)';
        for (let k = 0; k < 12; k++) c.fillRect(i * t + rnd() * t, j * t + rnd() * t, 3, 3);
      }
      c.fillStyle = S.seam;
      for (let i = 0; i * t <= w; i++) c.fillRect(i * t - 2, 0, 3, h);
      for (let j = 0; j * t <= h; j++) c.fillRect(0, j * t - 2, w, 3);
    }
  });
}
// 壁紙：128 px = 0.5 公尺，重複貼
function wallTex(style: RoomStyle, S: Shell): THREE.Texture {
  return canvasTex('wall-' + style, 128, 128, (c) => {
    c.fillStyle = S.wall; c.fillRect(0, 0, 128, 128);
    c.fillStyle = S.patC; c.strokeStyle = S.patC;
    const rnd = mulberry32(31);
    switch (S.pat) {
      case 'stripe':
        c.fillRect(0, 0, 22, 128); c.fillRect(64, 0, 22, 128);
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(40, 0, 3, 128); c.fillRect(104, 0, 3, 128);
        break;
      case 'dots':
        for (const [x, y] of [[32, 32], [96, 96], [96, 32], [32, 96]]) { c.beginPath(); c.arc(x, y, (x + y) % 128 === 0 ? 6 : 3.5, 0, PI * 2); c.fill(); }
        break;
      case 'plain':
        for (let k = 0; k < 60; k++) c.fillRect(rnd() * 128, rnd() * 128, 2, 2);
        break;
      case 'boards':
        for (let k = 0; k < 4; k++) {
          c.fillStyle = tint(k % 2 ? S.wall : S.patC, 0.97 + rnd() * 0.06);
          c.fillRect(k * 32, 0, 32, 128);
          c.fillStyle = 'rgba(60,35,15,0.45)'; c.fillRect(k * 32, 0, 2, 128);
          c.fillStyle = 'rgba(60,35,15,0.4)'; c.fillRect(k * 32 + 14, 18 + rnd() * 80, 2, 2);
        }
        break;
      case 'diamond':
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(64, 0); c.lineTo(128, 64); c.lineTo(64, 128); c.lineTo(0, 64); c.closePath(); c.stroke();
        c.fillStyle = '#c9b77a';
        for (const [x, y] of [[64, 64], [0, 0], [128, 0], [0, 128], [128, 128]]) { c.beginPath(); c.arc(x, y, 4, 0, PI * 2); c.fill(); }
        break;
      case 'sprig':
        for (const [x, y, a] of [[32, 36, -0.5], [96, 96, 0.6]]) {
          c.save(); c.translate(x, y); c.rotate(a);
          c.fillRect(-1, -12, 2, 24);
          for (const s of [-1, 1]) for (const k of [-6, 2]) { c.beginPath(); c.ellipse(s * 6, k, 6, 3, s * 0.5, 0, PI * 2); c.fill(); }
          c.restore();
        }
        c.fillStyle = '#f2b6c6';
        c.beginPath(); c.arc(96, 30, 4, 0, PI * 2); c.arc(30, 100, 4, 0, PI * 2); c.fill();
        break;
    }
  }, true);
}
// 護牆板
function wainsTex(style: RoomStyle, S: Shell): THREE.Texture {
  if (S.wains === 'tile') return subwayTex();
  return canvasTex('wains-' + style, 128, 128, (c) => {
    c.fillStyle = S.wainsC; c.fillRect(0, 0, 128, 128);
    if (S.wains === 'bead') {
      for (let x = 0; x < 128; x += 32) {
        c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x, 0, 2, 128);
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 2, 0, 1, 128);
      }
    } else {
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 3; c.strokeRect(14, 16, 100, 96);
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 2; c.strokeRect(19, 21, 90, 86);
    }
  }, true);
}

/** 建立房間外殼（地板＋三面牆＋窗＋門）；不含燈光 */
export function buildRoomShell(style: RoomStyle, tier: number): THREE.Group {
  const S = SHELL[style] ?? SHELL.living;
  const g = new THREE.Group();
  g.name = 'roomShell:' + style;
  g.userData.roomStyle = style;
  PH = 0;
  const attic = style === 'attic', sun = style === 'sunroom';
  const H = 3.0, sideH = attic ? 2.1 : H;
  const cut = M(S.cut, 0.85), trim = M(S.trim, 0.6), base = M(S.base, 0.6);

  // 地板：底座厚板＋貼圖平面＋前緣飾條
  P(g, cg('roomSlab', () => new THREE.BoxGeometry(9.3, 0.3, 7.15)), M(S.slab, 0.9), 0, -0.15, -0.075, false);
  P(g, cg('roomFloor', () => new THREE.PlaneGeometry(9, 7).rotateX(-HP)), MX('floor' + style, () => mat('#ffffff', { map: floorTex(style, S), roughness: 0.78 })), 0, 0.002, 0, false);
  P(g, B(9.3, 0.06, 0.06, 0.02), base, 0, -0.02, 3.5, false);

  // 牆面座標系：local x 沿牆、local +z 指向室內、y 向上
  const frame = (x: number, z: number, ry: number) => {
    const lg = new THREE.Group();
    lg.position.set(x, 0, z);
    lg.rotation.y = ry;
    g.add(lg);
    return lg;
  };
  const back = frame(0, -3.5, 0), left = frame(-4.5, 0, HP), right = frame(4.5, 0, -HP);
  const paper = (len: number, h: number) => MX(`paper${style}${k3(len, h)}`, () => mat('#ffffff', { map: repTex(wallTex(style, S), len / 0.5, h / 0.5), roughness: 0.9 }));
  const wallBox = (lg: THREE.Group, len: number, h: number, cx: number) => {
    const m = new THREE.Mesh(cg('wall' + k3(len, h), () => new THREE.BoxGeometry(len, h, 0.15)), [cut, cut, cut, cut, paper(len, h), cut]);
    m.position.set(cx, h / 2, -0.075);
    m.receiveShadow = true;
    lg.add(m);
  };

  // 後牆（閣樓是山牆形）
  if (attic) {
    const geo = cg('atticGable', () => {
      const sh = new THREE.Shape();
      sh.moveTo(-4.65, 0); sh.lineTo(4.65, 0); sh.lineTo(4.65, 2.1); sh.lineTo(3.0, 3.2); sh.lineTo(-3.0, 3.2); sh.lineTo(-4.65, 2.1); sh.closePath();
      return new THREE.ExtrudeGeometry(sh, { depth: 0.15, bevelEnabled: false }).translate(0, 0, -0.15);
    });
    const pm = MX('paperAtticGable', () => mat('#ffffff', { map: repTex(wallTex(style, S), 2, 2), roughness: 0.9 }));
    const m = new THREE.Mesh(geo, [pm, cut]);
    m.receiveShadow = true;
    back.add(m);
  } else wallBox(back, 9.3, H, 0);

  // 側牆（陽光室是玻璃牆）
  if (sun) {
    glassWall(left, -3.5, 3.65, H, null);
    glassWall(right, -3.65, 3.5, H, 1.6);
  } else {
    wallBox(left, 7.15, sideH, 0.075);
    wallBox(right, 7.15, sideH, -0.075);
  }

  // 踢腳板、護牆板、頂飾條
  const doorX = 1.6, doorW = 1.0, doorH = attic ? 1.8 : 2.1;
  const decorate = (lg: THREE.Group, a: number, b: number, holes: [number, number][], topY: number | null) => {
    const segs: [number, number][] = [];
    let s = a;
    for (const [h0, h1] of holes) { if (h0 > s) segs.push([s, h0]); s = h1; }
    if (s < b) segs.push([s, b]);
    for (const [s0, s1] of segs) {
      const len = s1 - s0, cx = (s0 + s1) / 2;
      P(lg, B(len, 0.14, 0.04, 0.01), base, cx, 0.07, 0.02, false);
      if (S.wains) {
        const wm = MX(`wains${style}${k3(len)}`, () => mat('#ffffff', { map: repTex(wainsTex(style, S), len / 0.5, S.wains === 'tile' ? S.wainsH / 0.5 : 1), roughness: S.wains === 'tile' ? 0.4 : 0.8 }));
        P(lg, cg('wn' + k3(len, S.wainsH), () => new THREE.BoxGeometry(len, S.wainsH, 0.025)), wm, cx, S.wainsH / 2, 0.0125, false);
        P(lg, B(len, 0.05, 0.05, 0.015), trim, cx, S.wainsH, 0.025, false);
      }
    }
    if (topY !== null && tier >= 4) {
      P(lg, B(b - a, 0.1, 0.08, 0.02), trim, (a + b) / 2, topY - 0.05, 0.04, false);
      P(lg, B(b - a, 0.04, 0.12, 0.01), trim, (a + b) / 2, topY - 0.13, 0.06, false);
    }
  };
  decorate(back, -4.5, 4.5, [], attic ? null : H);
  if (!sun) {
    decorate(left, -3.5, 3.5, [], sideH);
    decorate(right, -3.5, 3.5, [[doorX - doorW / 2 - 0.12, doorX + doorW / 2 + 0.12]], sideH);
    // 左牆窗戶（閣樓是小圓窗）
    if (attic) roundWindow(left, 1.0, 1.15, 0.36, trim);
    else addWindow(left, 1.0, 1.62, 1.5, 1.2, S, tier, trim);
    addDoor(right, doorX, doorW, doorH, S, trim);
  }

  // 閣樓：斜屋樑＋桁條＋山牆小圓窗
  if (attic) {
    const beam = M('#6d4c33', 0.85);
    for (const z of [-3.3, -1.65, 0, 1.65, 3.3]) for (const s of [-1, 1]) {
      R(P(g, B(2.0, 0.16, 0.12, 0.02), beam, s * 3.75, 2.72, z), 0, 0, -s * 0.588);
    }
    for (const s of [-1, 1]) {
      P(g, B(0.14, 0.14, 7.15, 0.02), beam, s * 3.0, 3.22, -0.075);
      P(g, B(0.22, 0.1, 7.15, 0.02), beam, s * 4.55, 2.15, -0.075);
    }
    roundWindow(back, 0, 2.62, 0.26, trim);
  }

  // 陽光室：窗外綠籬、室內吊盆
  if (sun) {
    const greens = [M(C.leaf, 0.85), M(C.leafD, 0.85), M('#7cc45e', 0.85)];
    for (const [lg, a, b] of [[left, -3.4, 3.4], [right, -3.4, 3.4]] as const) {
      P(lg, B(b - a + 0.6, 0.12, 1.2, 0.03), M('#8fcf6a', 0.95), 0, -0.06, -0.8, false);
      for (let i = 0; i < 7; i++) {
        const x = a + (i + 0.5) * ((b - a) / 7);
        I(lg, greens[i % 3], x, 0.45 + (i % 3) * 0.12, -0.7, 0.9 + (i % 2) * 0.25, 0.9 + (i % 3) * 0.2);
        E(lg, M(i % 2 ? '#ff9ec0' : '#fff2a8', 0.7), x + 0.2, 0.75 + (i % 2) * 0.2, -0.3, 0.1, 0.1, 0.1, false);
      }
      for (const x of lg === right ? [-2.4, -0.6] : [-2.2, 2.4]) hangingPlant(lg, x, H, greens);
    }
  }

  // T5：側牆壁燈
  if (tier >= 5) {
    for (const [lg, x] of [[left, 2.7], [right, -2.7]] as const) {
      const brass = M('#c99a5a', 0.35, 0.5);
      P(lg, B(0.12, 0.2, 0.03, 0.01), brass, x, 2.15, 0.015);
      R(P(lg, CY(0.012, 0.012, 0.16, 6), brass, x, 2.18, 0.1), HP);
      glow(P(lg, CY(0.07, 0.11, 0.14, 16, true), G('#fbeed3', '#ffc070', { side: THREE.DoubleSide, roughness: 0.9 }), x, 2.26, 0.18, false), 0.3, 1.8);
    }
  }
  return g;
}

// 一般窗（local 座標，牆面 z=0）
function addWindow(lg: THREE.Group, x: number, y: number, w: number, h: number, S: Shell, tier: number, trim: Std): void {
  tagWindow(P(lg, PL(w - 0.1, h - 0.1), skyMat(), x, y, 0.01, false));
  for (const sy of [-1, 1]) P(lg, B(w + 0.1, 0.1, 0.1, 0.02), trim, x, y + sy * (h / 2), 0.05);
  for (const sx of [-1, 1]) P(lg, B(0.1, h, 0.1, 0.02), trim, x + sx * (w / 2), y, 0.05);
  P(lg, B(0.05, h - 0.1, 0.05, 0.01), trim, x, y, 0.03);
  P(lg, B(w - 0.1, 0.05, 0.05, 0.01), trim, x, y + 0.1, 0.03);
  P(lg, B(w + 0.24, 0.06, 0.2, 0.02), trim, x, y - h / 2 - 0.06, 0.1);
  if (tier >= 2) {
    P(lg, CY(0.07, 0.055, 0.1, 12), M(C.terracotta, 0.85), x - 0.45, y - h / 2 + 0.02, 0.11);
    I(lg, M(C.leaf), x - 0.45, y - h / 2 + 0.12, 0.11, 0.16);
    E(lg, M('#ff8fb0'), x - 0.42, y - h / 2 + 0.18, 0.15, 0.06);
  }
  if (tier >= 3) {
    const cm = M(S.curtain, 0.95);
    for (const sx of [-1, 1]) {
      R(P(lg, B(0.34, h + 0.5, 0.05, 0.02), cm, x + sx * (w / 2 + 0.12), y + 0.05, 0.14), 0, 0, sx * 0.02);
      P(lg, B(0.36, 0.05, 0.07, 0.02), M(C.cream), x + sx * (w / 2 + 0.12), y - 0.2, 0.15);
    }
    R(P(lg, CY(0.018, 0.018, w + 0.9, 8), M('#c99a5a', 0.35, 0.5), x, y + h / 2 + 0.28, 0.14), 0, 0, HP);
    for (const sx of [-1, 1]) E(lg, M('#c99a5a', 0.35, 0.5), x + sx * (w / 2 + 0.45), y + h / 2 + 0.28, 0.14, 0.07);
  }
}
function roundWindow(lg: THREE.Group, x: number, y: number, r: number, trim: Std): void {
  tagWindow(R(P(lg, cg('rwin' + k3(r), () => new THREE.CircleGeometry(r, 28)), skyMat(), x, y, 0.01, false)));
  P(lg, TO(r, 0.05), trim, x, y, 0.03);
  P(lg, B(0.04, r * 2, 0.04, 0.01), trim, x, y, 0.02);
  P(lg, B(r * 2, 0.04, 0.04, 0.01), trim, x, y, 0.02);
}
function addDoor(lg: THREE.Group, x: number, w: number, h: number, S: Shell, trim: Std): void {
  const door = M(S.door, 0.7);
  const inset = MX('doorInset' + S.door, () => mat(S.door, { roughness: 0.7, color: new THREE.Color(S.door).multiplyScalar(0.88) }));
  for (const sx of [-1, 1]) P(lg, B(0.12, h + 0.12, 0.08, 0.02), trim, x + sx * (w / 2 + 0.06), (h + 0.12) / 2, 0.04);
  P(lg, B(w + 0.24, 0.12, 0.08, 0.02), trim, x, h + 0.06, 0.04);
  P(lg, B(w, h, 0.05, 0.02), door, x, h / 2, 0.025);
  for (const sx of [-1, 1]) P(lg, B(w / 2 - 0.16, h * 0.36, 0.02, 0.01), inset, x + sx * (w / 4 - 0.02), h * 0.26, 0.055);
  tagWindow(R(P(lg, cg('doorWin', () => new THREE.CircleGeometry(0.2, 24)), skyMat(), x, h * 0.7, 0.052, false)));
  P(lg, TO(0.2, 0.03), trim, x, h * 0.7, 0.056);
  E(lg, M('#e8b84a', 0.3, 0.6), x - w / 2 + 0.12, h * 0.48, 0.09, 0.08);
  P(lg, B(0.06, 0.16, 0.01, 0.005), M('#e8b84a', 0.3, 0.6), x - w / 2 + 0.12, h * 0.48, 0.055);
}
// 陽光室玻璃牆（白框、下方矮牆）
function glassWall(lg: THREE.Group, xa: number, xb: number, H: number, doorX: number | null): void {
  const len = xb - xa, cx = (xa + xb) / 2, z = -0.075;
  const white = M('#fbfbf7', 0.5);
  P(lg, B(len, 0.5, 0.18, 0.02), white, cx, 0.25, z);
  const gm = MX('sunGlass', () => mat('#d8f0ff', { transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
  P(lg, PL(len, H - 0.5), gm, cx, 0.5 + (H - 0.5) / 2, z, false);
  P(lg, B(len, 0.14, 0.2, 0.02), white, cx, H - 0.07, z);
  P(lg, B(len, 0.06, 0.18, 0.01), white, cx, 2.3, z);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const x = xa + (i * len) / n;
    if (doorX !== null && Math.abs(x - doorX) < 0.7) continue;
    P(lg, B(0.08, H - 0.5, 0.18, 0.01), white, x, 0.5 + (H - 0.5) / 2, z);
  }
  if (doorX !== null) {
    for (const sx of [-1, 1]) P(lg, B(0.12, 2.3, 0.2, 0.02), white, doorX + sx * 0.55, 1.15, z);
    P(lg, B(1.0, 0.06, 0.16, 0.01), white, doorX, 1.15, z);
    E(lg, M('#e8b84a', 0.3, 0.6), doorX - 0.4, 1.0, 0.06, 0.08);
  }
}
function hangingPlant(lg: THREE.Group, x: number, H: number, greens: Std[]): void {
  P(lg, CY(0.006, 0.006, H - 0.14 - 2.62, 4), M('#a8865a'), x, (H - 0.14 + 2.62) / 2, 0.35, false);
  P(lg, CY(0.14, 0.1, 0.16, 14), M(C.terracotta, 0.85), x, 2.54, 0.35);
  I(lg, greens[0], x, 2.64, 0.35, 0.34, 0.24);
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) I(lg, greens[(k + 1) % 3], x + s * 0.12, 2.42 - k * 0.14, 0.35 + s * 0.04, 0.12);
}

// ---------- 每幀動畫 ----------
const WIN_DAY = new THREE.Color('#ffffff');
const WIN_NIGHT_E = new THREE.Color('#4a5c9c');
const WIN_NIGHT_C = new THREE.Color('#1e2a4a');

/** 家具／房間動畫：t 秒、night 0..1（夜間發光更強） */
export function updateFurniture(root: THREE.Object3D, t: number, night: number): void {
  const n = Math.max(0, Math.min(1, night));
  root.traverse((o) => {
    const u = o.userData;
    const fx = u.fx as string | undefined;
    if (!fx) return;
    const ph = (u.ph as number) || 0;
    switch (fx) {
      case 'glow':
      case 'flame': {
        const m = (o as THREE.Mesh).material as Std;
        let k = u.gd + (u.gn - u.gd) * n;
        if (u.fl) k *= 1 + u.fl * (0.6 * Math.sin(t * 7.3 + ph) + 0.4 * Math.sin(t * 17.9 + ph * 2.3));
        m.emissiveIntensity = Math.max(0, k);
        if (fx === 'flame') {
          const f = 1 + 0.16 * Math.sin(t * 9.7 + ph * 1.3) + 0.08 * Math.sin(t * 23.1 + ph);
          o.scale.set(u.sx * (1 + 0.06 * Math.sin(t * 13 + ph)), u.sy * f, u.sz * (1 + 0.06 * Math.cos(t * 11 + ph)));
        }
        break;
      }
      case 'bob':
        o.position.y = u.y0 + Math.abs(Math.sin(t * 4.4 + ph)) * 0.014;
        o.rotation.z = Math.sin(t * 4.4 + ph) * 0.035;
        break;
      case 'pendulum':
        o.rotation.z = Math.sin(t * 2.8 + ph) * 0.3;
        break;
      case 'chime':
        o.rotation.z = (0.7 * Math.sin(t * 1.6 + ph) + 0.3 * Math.sin(t * 3.7 + ph * 1.7)) * u.amp;
        o.rotation.x = Math.sin(t * 1.1 + ph * 0.7) * u.amp * 0.5;
        break;
      case 'snow':
        o.rotation.y = t * 0.35 + ph;
        o.position.y = u.y0 + Math.sin(t * 1.2 + ph) * 0.012;
        break;
      case 'window': {
        const m = (o as THREE.Mesh).material as Std;
        m.emissiveIntensity = u.gd + (u.gn - u.gd) * n;
        m.emissive.copy(WIN_DAY).lerp(WIN_NIGHT_E, n);
        m.color.copy(WIN_DAY).lerp(WIN_NIGHT_C, n);
        break;
      }
    }
  });
}
