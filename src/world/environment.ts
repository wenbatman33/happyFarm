import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropPlacement, SceneLayout } from '../config/layout';
import type { Season } from '../core/clock';
import { mulberry32 } from '../core/rng';
import { GEO, mat, mesh, withWind } from './materials';
import type { Grid } from './grid';

const rbox = (w: number, h: number, d: number, r = 0.06, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

interface Palette { ground: string; ground2: string; grass: string[]; leaves: string[]; hill: string; flowers: number }
export const SEASON_PALETTE: Record<Season, Palette> = {
  spring: { ground: '#8fd16a', ground2: '#78c257', grass: ['#8fdc6a', '#a6e37a', '#79c95a'], leaves: ['#7fcf5c', '#f4b6cf', '#96d86e'], hill: '#86c965', flowers: 1 },
  summer: { ground: '#6fbf4b', ground2: '#5aab3f', grass: ['#6fca4a', '#5cb843', '#84d45a'], leaves: ['#4fae3f', '#5fbf49', '#3f9a36'], hill: '#5fae44', flowers: 1 },
  autumn: { ground: '#a3c25a', ground2: '#b8b457', grass: ['#b7c95e', '#d0b65a', '#9fbf55'], leaves: ['#f08a3c', '#e8603a', '#f2b447'], hill: '#b3a85a', flowers: 0.4 },
  winter: { ground: '#eef3f8', ground2: '#dde6ee', grass: ['#e9f0f6', '#d8e2ea', '#f4f8fb'], leaves: ['#eef4f9', '#dfe9f1', '#cfdbe6'], hill: '#e6edf3', flowers: 0 },
};

export type PropKey = 'house' | 'doghouse' | 'mailbox' | 'compost' | `tree${number}` | `rock${number}`;

export class World {
  root = new THREE.Group();
  props = new Map<string, { obj: THREE.Object3D; place: PropPlacement }>();
  interactive: THREE.Object3D[] = [];
  houseTier = 1;
  season: Season = 'summer';

  private groundGeo!: THREE.PlaneGeometry;
  private grass!: THREE.InstancedMesh;
  private flowers!: THREE.InstancedMesh;
  private leafMats = [mat('#4fae3f'), mat('#5fbf49'), mat('#3f9a36')].map((m) => withWind(m, 0.02));
  private hillMat = mat('#5fae44', { roughness: 0.95 });
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private lantern = new THREE.PointLight('#ffc46b', 0, 7, 1.6);
  private lanternMat = mat('#ffe2a0', { emissive: '#ffb347', emissiveIntensity: 0 });
  private fireflies!: THREE.Points;
  private clouds: THREE.Group[] = [];
  private smoke: { m: THREE.Mesh; life: number }[] = [];
  private smokeMat = mat('#ffffff', { transparent: true, opacity: 0.7, roughness: 1 });
  private smokeTimer = 0;
  private troughHay!: THREE.Object3D;

  constructor(scene: THREE.Scene, private grid: Grid, private layout: SceneLayout) {
    scene.add(this.root);
    this.buildGround();
    this.buildPath();
    this.buildFence();
    this.buildHills();
    this.buildClouds();
    this.addProp('house', this.makeHouse(1), layout.house);
    this.addProp('doghouse', this.makeDoghouse(), layout.doghouse);
    this.addProp('mailbox', this.makeMailbox(), layout.mailbox);
    this.addProp('compost', this.makeCompost(), layout.compost);
    this.buildRanch();
    layout.trees.forEach((t, i) => this.addProp(`tree${i}`, this.makeTree(i), t));
    layout.rocks.forEach((r, i) => this.addProp(`rock${i}`, this.makeRock(i), r));
    this.rebuildGrid();
    this.buildGrass();
    this.buildFireflies();
    this.root.add(this.lantern);
  }

  private addProp(key: string, obj: THREE.Object3D, place: PropPlacement) {
    obj.userData.propKey = key;
    this.props.set(key, { obj, place });
    this.root.add(obj);
    this.placeProp(key);
  }

  placeProp(key: string): void {
    const p = this.props.get(key);
    if (!p) return;
    p.obj.position.set(p.place.x, 0, p.place.z);
    p.obj.rotation.y = p.place.rotY;
    p.obj.scale.setScalar(p.place.scale);
    if (key === 'house') {
      const lp = new THREE.Vector3(1.9, 1.7, 3.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.place.rotY);
      this.lantern.position.set(p.place.x + lp.x, lp.y, p.place.z + lp.z);
    }
  }

  // 依物件擺放重新計算阻擋格
  rebuildGrid(): void {
    const g = this.grid;
    g.clear();
    const L = this.layout;
    g.blockRect(L.house.x, L.house.z, 6 * L.house.scale, 5 * L.house.scale);
    g.blockRect(L.doghouse.x, L.doghouse.z, 1.3, 1.3);
    g.blockRect(L.mailbox.x, L.mailbox.z, 0.3, 0.3);
    g.blockRect(L.compost.x, L.compost.z, 0.6, 0.6);
    L.trees.forEach((t) => g.blockRect(t.x, t.z, 0.4, 0.4));
    L.rocks.forEach((r) => { if (r.scale >= 0.9) g.blockRect(r.x, r.z, 0.3, 0.3); });
    // 圍籬：±14，南側留門
    for (let i = -15; i <= 15; i++) {
      for (let j = -15; j <= 15; j++) {
        const edge = Math.abs(i) >= 14 || Math.abs(j) >= 14;
        const gate = j >= 14 && Math.abs(i) <= 1 && j === 14;
        if (edge && !gate) g.blocked[g.idx(i, j)] = 1;
      }
    }
    for (let z = Math.round(L.house.z + 3.5); z <= 13; z++) g.path[g.idx(Math.round(L.house.x), z)] = 1;
    // 牧場：柵欄在 cx±3、cz±2.5 的格線上，東側中間兩格是門
    const rx = Math.round(L.ranch.x), rz = L.ranch.z;
    const z0 = Math.round(rz - 2.5), z1 = Math.round(rz + 2.5);
    for (let z = z0; z <= z1; z++) {
      g.blocked[g.idx(rx - 3, z)] = 1;
      if (Math.abs(z - rz) > 1) g.blocked[g.idx(rx + 3, z)] = 1;
    }
    for (let x = rx - 3; x <= rx + 3; x++) { g.blocked[g.idx(x, z0)] = 1; g.blocked[g.idx(x, z1)] = 1; }
    g.blockRect(rx - 1.6, rz - 1.35, 1.6, 0.6); // 穀倉
    g.blockRect(rx - 3.9, rz - 1.8, 0.3, 0.3); // 乾草堆
  }

  // ---------- 地面、草、花 ----------
  private buildGround() {
    this.groundGeo = new THREE.PlaneGeometry(220, 220, 110, 110);
    this.groundGeo.rotateX(-Math.PI / 2);
    const pos = this.groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.max(Math.abs(x), Math.abs(z));
      // 圍籬外的地面有起伏，圍籬內保持平坦
      const hill = r > 17 ? (Math.sin(x * 0.11) + Math.cos(z * 0.13) + 1.2) * Math.min(1, (r - 17) / 12) * 0.9 : 0;
      pos.setY(i, hill - 0.02);
    }
    this.groundGeo.computeVertexNormals();
    this.groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3));
    const ground = new THREE.Mesh(this.groundGeo, mat('#ffffff', { vertexColors: true, roughness: 0.95 }));
    ground.receiveShadow = true;
    ground.userData.ground = true;
    this.root.add(ground);
  }

  private paintGround(p: Palette) {
    const pos = this.groundGeo.attributes.position;
    const col = this.groundGeo.attributes.color as THREE.BufferAttribute;
    const a = new THREE.Color(p.ground), b = new THREE.Color(p.ground2), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.37 + z * 0.21) + 0.25 * Math.sin(x * 0.13 - z * 0.41);
      tmp.copy(a).lerp(b, n);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
  }

  private buildPath() {
    const rand = mulberry32(7);
    const stoneMat = mat('#d8cbb3', { roughness: 0.9 });
    const L = this.layout;
    for (let z = Math.round(L.house.z + 3.3); z <= 14.5; z += 0.9) {
      for (const side of [-0.28, 0.28]) {
        const s = mesh(GEO.cyl, stoneMat, false);
        s.scale.set(0.42 + rand() * 0.14, 0.06, 0.34 + rand() * 0.12);
        s.position.set(L.house.x + side + (rand() - 0.5) * 0.15, 0.02, z + (rand() - 0.5) * 0.3);
        s.rotation.y = rand() * Math.PI;
        this.root.add(s);
      }
    }
  }

  // 草地資料：除草機割過要能變短、再慢慢長回來
  private grassData!: { x: Float32Array; z: Float32Array; s: Float32Array; sy: Float32Array; rot: Float32Array; mowedAt: Float64Array; inside: Uint8Array };
  private mowedList = new Set<number>();
  private grassT = 0;
  static GRASS_REGROW_MS = 5 * 60 * 1000;

  private buildGrass() {
    // 單片草葉用開口圓錐（沒有底面），一叢 3 片，面數很少
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.ConeGeometry(0.04, 0.38, 3, 1, true);
      b.translate(0, 0.19, 0);
      b.scale(1, 0.75 + i * 0.15, 1);
      b.rotateZ((i - 1) * 0.3);
      b.rotateY(i * 2.1);
      b.translate((i - 1) * 0.05, 0, (i % 2) * 0.05);
      blades.push(b);
    }
    const tuft = mergeGeometries(blades)!;
    // 圍籬內種得密，割草才有感；圍籬外稀疏
    const inside = 3400, outside = 800;
    const count = inside + outside;
    this.grass = new THREE.InstancedMesh(tuft, withWind(mat('#ffffff', { roughness: 0.9, side: THREE.DoubleSide }), 0.9), count);
    this.grass.receiveShadow = true;
    const d = { x: new Float32Array(count), z: new Float32Array(count), s: new Float32Array(count), sy: new Float32Array(count), rot: new Float32Array(count), mowedAt: new Float64Array(count), inside: new Uint8Array(count) };
    this.grassData = d;
    const rand = mulberry32(42);
    const L = this.layout;
    let n = 0;
    while (n < count) {
      const isIn = n < inside;
      const x = isIn ? (rand() - 0.5) * 27 : (rand() - 0.5) * 64;
      const z = isIn ? (rand() - 0.5) * 27 : (rand() - 0.5) * 64;
      if (!isIn && Math.abs(x) < 14.5 && Math.abs(z) < 14.5) continue;
      if (isIn && this.grid.isBlocked(Math.round(x), Math.round(z))) continue;
      if (Math.abs(x - L.house.x) < 3.8 && Math.abs(z - L.house.z) < 3.4) continue;
      if (x > L.field.x - 0.9 && x < L.field.x + 3.9 && z > L.field.z - 0.9 && z < L.field.z + 2.9) continue;
      if (Math.abs(x - L.house.x) < 0.9 && z > L.house.z) continue;
      d.x[n] = x;
      d.z[n] = z;
      d.s[n] = 0.6 + rand() * 0.6;
      d.sy[n] = 0.85 + rand() * 0.5;
      d.rot[n] = rand() * Math.PI * 2;
      d.inside[n] = isIn ? 1 : 0;
      this.setGrassMatrix(n, 1);
      n++;
    }
    this.root.add(this.grass);

    // 小花：稈＋花頭（兩個 InstancedMesh）
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const fc = 90;
    const headGeo = new THREE.SphereGeometry(0.08, 8, 6);
    headGeo.translate(0, 0.32, 0);
    this.flowers = new THREE.InstancedMesh(headGeo, withWind(mat('#ffffff', { roughness: 0.6 }), 0.9), fc);
    const stems = new THREE.InstancedMesh((() => { const g = new THREE.CylinderGeometry(0.012, 0.015, 0.32, 4); g.translate(0, 0.16, 0); return g; })(), withWind(mat('#4f9a3a'), 0.9), fc);
    const colors = ['#ff7aa8', '#ffd84a', '#ffffff', '#b28cff', '#ff9a4a'];
    for (let i = 0; i < fc; i++) {
      // 集中在房屋前、圍籬邊
      const nearHouse = i < 40;
      const x = nearHouse ? L.house.x + (rand() - 0.5) * 7 : (rand() < 0.5 ? -1 : 1) * (12.4 + rand() * 1.2);
      const z = nearHouse ? L.house.z + 2.9 + rand() * 0.8 : (rand() - 0.5) * 26;
      if (nearHouse && Math.abs(x - L.house.x) < 1.9) { i--; continue; }
      const sc = 0.8 + rand() * 0.6;
      m.compose(v.set(x, 0, z), q.identity(), s.set(sc, sc, sc));
      this.flowers.setMatrixAt(i, m);
      stems.setMatrixAt(i, m);
      this.flowers.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    }
    this.flowers.castShadow = true;
    this.root.add(this.flowers, stems);
    this.flowers.userData.stems = stems;
  }

  private gm = new THREE.Matrix4();
  private gq = new THREE.Quaternion();
  private gv = new THREE.Vector3();
  private gs = new THREE.Vector3();
  private setGrassMatrix(i: number, height: number) {
    const d = this.grassData;
    this.gq.setFromAxisAngle(this.gv.set(0, 1, 0), d.rot[i]);
    this.gm.compose(this.gv.set(d.x[i], 0, d.z[i]), this.gq, this.gs.set(d.s[i], d.s[i] * d.sy[i] * height, d.s[i]));
    this.grass.setMatrixAt(i, this.gm);
  }

  // 割草：半徑內的草變成短草根，回傳這次割到幾叢
  mowGrass(x: number, z: number, r: number, now: number): number {
    const d = this.grassData;
    let n = 0;
    for (let i = 0; i < d.x.length; i++) {
      if (!d.inside[i]) continue;
      const dx = d.x[i] - x, dz = d.z[i] - z;
      if (dx * dx + dz * dz > r * r) continue;
      // 已經割過、還沒長回一半的就不算
      if (d.mowedAt[i] && now - d.mowedAt[i] < World.GRASS_REGROW_MS * 0.5) continue;
      d.mowedAt[i] = now;
      this.mowedList.add(i);
      this.setGrassMatrix(i, 0.16);
      n++;
    }
    if (n) this.grass.instanceMatrix.needsUpdate = true;
    return n;
  }

  // 割過的草依時間慢慢長回來（用遊戲時間，DEV 快轉也看得到）
  private regrowGrass(now: number) {
    if (!this.mowedList.size) return;
    const d = this.grassData;
    for (const i of this.mowedList) {
      const t = Math.min(1, Math.max(0, (now - d.mowedAt[i]) / World.GRASS_REGROW_MS));
      this.setGrassMatrix(i, 0.16 + 0.84 * t * t);
      if (t >= 1) { d.mowedAt[i] = 0; this.mowedList.delete(i); }
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  applySeason(season: Season): void {
    this.season = season;
    const p = SEASON_PALETTE[season];
    this.paintGround(p);
    const rand = mulberry32(9);
    const c = new THREE.Color();
    for (let i = 0; i < this.grass.count; i++) {
      c.set(p.grass[Math.floor(rand() * p.grass.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
      this.grass.setColorAt(i, c);
    }
    this.grass.instanceColor!.needsUpdate = true;
    this.leafMats.forEach((m, i) => m.color.set(p.leaves[i % p.leaves.length]));
    this.hillMat.color.set(p.hill);
    const showCount = Math.round(this.flowers.count * p.flowers);
    this.flowers.visible = showCount > 0;
    (this.flowers.userData.stems as THREE.InstancedMesh).visible = showCount > 0;
    this.flowers.count = Math.max(1, showCount);
    (this.flowers.userData.stems as THREE.InstancedMesh).count = Math.max(1, showCount);
  }

  // ---------- 圍籬、遠景 ----------
  private buildFence() {
    const woodMat = mat('#dcb88c', { roughness: 0.8 });
    const posts: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const E = 14.2;
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.round(len / 1.4);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        posts.push(new THREE.Matrix4().makeTranslation(x1 + (x2 - x1) * t, 0.42, z1 + (z2 - z1) * t));
      }
      q.setFromAxisAngle(v.set(0, 1, 0), Math.atan2(-(z2 - z1), x2 - x1));
      for (const h of [0.35, 0.65]) rails.push(m.clone().compose(v.set((x1 + x2) / 2, h, (z1 + z2) / 2), q, s.set(len, 1, 1)));
    };
    seg(-E, -E, E, -E);
    seg(-E, -E, -E, E);
    seg(E, -E, E, E);
    seg(-E, E, -1.6, E);
    seg(1.6, E, E, E);
    const postMesh = new THREE.InstancedMesh(rbox(0.16, 0.84, 0.16, 0.05), woodMat, posts.length);
    posts.forEach((pm, i) => postMesh.setMatrixAt(i, pm));
    const railMesh = new THREE.InstancedMesh(rbox(1, 0.09, 0.06, 0.03), woodMat, rails.length);
    rails.forEach((rm, i) => railMesh.setMatrixAt(i, rm));
    for (const im of [postMesh, railMesh]) { im.castShadow = true; im.receiveShadow = true; this.root.add(im); }
  }

  private buildHills() {
    const rand = mulberry32(3);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
      const r = 48 + rand() * 30;
      const h = mesh(GEO.sphere, this.hillMat, false);
      h.scale.set(30 + rand() * 25, 8 + rand() * 10, 22 + rand() * 12);
      h.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      this.root.add(h);
    }
    // 遠景樹林
    const count = 70;
    const foliage = new THREE.InstancedMesh(GEO.ico, this.leafMats[0], count);
    const trunks = new THREE.InstancedMesh(GEO.cyl, mat('#8a5a3a'), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 20 + rand() * 18;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 16 && Math.abs(x) < 20) { i--; continue; } // 鏡頭前方保持開闊
      const sc = 1.6 + rand() * 1.6;
      const gy = (Math.sin(x * 0.11) + Math.cos(z * 0.13) + 1.2) * 0.9;
      foliage.setMatrixAt(i, m.compose(v.set(x, gy + sc * 1.3, z), q, s.set(sc * 1.6, sc * 1.8, sc * 1.6)));
      trunks.setMatrixAt(i, m.compose(v.set(x, gy + sc * 0.4, z), q, s.set(0.35, sc * 0.9, 0.35)));
    }
    foliage.castShadow = true;
    this.root.add(foliage, trunks);
  }

  private buildClouds() {
    const cm = mat('#ffffff', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.25 });
    const rand = mulberry32(11);
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        const s = mesh(GEO.sphereLo, cm, false);
        const sc = 5 + rand() * 5;
        s.scale.set(sc * 1.4, sc * 0.8, sc);
        s.position.set(j * 4 - n * 2 + rand() * 2, rand() * 2, rand() * 3);
        g.add(s);
      }
      const a = rand() * Math.PI * 2;
      g.position.set(Math.cos(a) * (70 + rand() * 40), 38 + rand() * 12, Math.sin(a) * (70 + rand() * 40) - 30);
      g.userData.speed = 0.4 + rand() * 0.6;
      this.clouds.push(g);
      this.root.add(g);
    }
  }

  private buildFireflies() {
    const n = 46;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    const rand = mulberry32(5);
    for (let i = 0; i < n; i++) { arr[i * 3] = (rand() - 0.5) * 26; arr[i * 3 + 1] = 0.4 + rand() * 1.6; arr[i * 3 + 2] = (rand() - 0.5) * 26; }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.userData.base = arr.slice();
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff4a8', size: 0.16, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.root.add(this.fireflies);
  }


  // ---------- 牧場 ----------
  // 牛站的照顧位置、主角站的位置（都是世界座標）
  get cowCareSpot(): { x: number; z: number } { const r = this.layout.ranch; return { x: r.x + 0.8, z: r.z - 0.8 }; }
  get cowSleepSpot(): { x: number; z: number } { const r = this.layout.ranch; return { x: r.x - 1.6, z: r.z - 0.1 }; }
  get ranchBounds(): { x0: number; x1: number; z0: number; z1: number } { const r = this.layout.ranch; return { x0: r.x - 2, x1: r.x + 2, z0: r.z - 0.9, z1: r.z + 1.6 }; }

  setTroughHay(on: boolean): void { this.troughHay.visible = on; }

  private buildRanch() {
    const r = this.layout.ranch;
    const g = new THREE.Group();
    g.position.set(r.x, 0, r.z);
    this.root.add(g);
    const white = mat('#f6f0e4', { roughness: 0.7 });
    // 柵欄（東側留門）
    const post = rbox(0.14, 0.9, 0.14, 0.05);
    const addPost = (x: number, z: number) => { const m = mesh(post, white); m.position.set(x, 0.45, z); g.add(m); };
    const addRail = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (const h of [0.38, 0.7]) {
        const m = mesh(rbox(len, 0.09, 0.06, 0.03), white);
        m.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
        m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
        g.add(m);
      }
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) addPost(x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n);
    };
    addRail(-3, -2.5, 3, -2.5);
    addRail(-3, 2.5, 3, 2.5);
    addRail(-3, -2.5, -3, 2.5);
    addRail(3, -2.5, 3, -0.9);
    addRail(3, 0.9, 3, 2.5);
    // 紅色小穀倉（門朝南，也就是鏡頭這側）
    const barn = new THREE.Group();
    barn.position.set(-1.6, 0, -1.35);
    const red = mat('#c9453a', { roughness: 0.75 });
    const body = mesh(rbox(1.9, 1.3, 1.4, 0.08), red);
    body.position.y = 0.65;
    barn.add(body);
    for (const s of [1, -1]) {
      const roof = mesh(rbox(2.2, 0.1, 0.95, 0.04), mat('#5b4a44'));
      roof.position.set(0, 1.58, s * 0.36);
      roof.rotation.x = s * 0.62;
      barn.add(roof);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-0.95, 0); tri.lineTo(0.95, 0); tri.lineTo(0, 0.58); tri.closePath();
    const gable = mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.3, bevelEnabled: false }), red);
    gable.position.set(0, 1.3, -0.65);
    barn.add(gable);
    const door = mesh(rbox(0.8, 0.95, 0.06, 0.03), mat('#8a2f28'));
    door.position.set(0, 0.5, 0.71);
    barn.add(door);
    for (const rz of [0.75, -0.75]) {
      const x = mesh(rbox(1.05, 0.07, 0.04, 0.02), white, false);
      x.position.set(0, 0.5, 0.75);
      x.rotation.z = rz;
      barn.add(x);
    }
    const trimTop = mesh(rbox(0.86, 0.07, 0.05, 0.02), white, false);
    trimTop.position.set(0, 0.99, 0.74);
    barn.add(trimTop);
    g.add(barn);
    // 飼料槽：沿北側柵欄，餵過才看得到牧草
    const trough = new THREE.Group();
    trough.position.set(0.8, 0, -1.95);
    const wood = mat('#a8804e');
    const tBody = mesh(rbox(1.4, 0.36, 0.5, 0.05), wood);
    tBody.position.y = 0.3;
    const tIn = mesh(rbox(1.25, 0.05, 0.36, 0.02), mat('#5e4128'), false);
    tIn.position.y = 0.46;
    trough.add(tBody, tIn);
    for (const lx of [-0.55, 0.55]) {
      const leg = mesh(rbox(0.1, 0.16, 0.4, 0.03), wood);
      leg.position.set(lx, 0.08, 0);
      trough.add(leg);
    }
    const hay = new THREE.Group();
    const hayMat = mat('#e8c65a', { roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const h = mesh(GEO.sphereLo, hayMat, false);
      h.scale.set(0.34, 0.14, 0.26);
      h.position.set(-0.5 + (i % 5) * 0.25, 0.52 + (i > 4 ? 0.05 : 0), (i % 2 ? 0.06 : -0.06));
      hay.add(h);
    }
    trough.add(hay);
    this.troughHay = hay;
    g.add(trough);
    // 柵欄外的乾草捆
    const bales = new THREE.Group();
    bales.position.set(-3.9, 0, -1.8);
    const baleGeo = rbox(0.9, 0.5, 0.55, 0.12);
    const baleMat = mat('#e2bd55', { roughness: 0.95 });
    [[0, 0.25, 0], [0.1, 0.75, 0.05], [-0.05, 0.25, 0.6]].forEach(([x, y, z], i) => {
      const b = mesh(baleGeo, baleMat);
      b.position.set(x, y, z);
      b.rotation.y = i * 0.4;
      bales.add(b);
    });
    g.add(bales);
  }

  // ---------- 房屋 ----------
  setHouseTier(tier: number): void {
    this.houseTier = tier;
    const entry = this.props.get('house')!;
    this.root.remove(entry.obj);
    this.interactive = this.interactive.filter((o) => o !== entry.obj);
    this.windowMats = [];
    const h = this.makeHouse(tier);
    h.userData.propKey = 'house';
    entry.obj = h;
    this.root.add(h);
    this.placeProp('house');
  }

  private makeHouse(tier: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'house';
    this.interactive.push(g);
    const worn = tier === 1;
    const wall = mat(worn ? '#c28d5e' : '#d69a62', { roughness: 0.85 });
    const wallDark = mat(worn ? '#a8744a' : '#bd8350', { roughness: 0.85 });
    const trim = mat('#f3e7d3', { roughness: 0.6 });
    const roofMat = mat(worn ? '#a8604c' : '#c9553c', { roughness: 0.7 });
    const stone = mat('#b9ad9c', { roughness: 0.95 });
    const W = 5.4, H = 2.5, D = 4.2, base = 0.35;

    const found = mesh(rbox(W + 0.4, base, D + 0.4, 0.1), stone);
    found.position.y = base / 2;
    g.add(found);
    const body = mesh(rbox(W, H, D, 0.12), wall);
    body.position.y = base + H / 2;
    g.add(body);
    // 橫向木板：讓牆面讀起來像小木屋
    for (let i = 0; i < 6; i++) {
      const plank = mesh(rbox(W + 0.04, 0.07, D + 0.04, 0.03), i % 2 ? wall : wallDark, false);
      plank.position.y = base + 0.25 + i * 0.4;
      g.add(plank);
    }
    // 屋角柱
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = mesh(rbox(0.22, H + 0.1, 0.22, 0.06), trim);
      post.position.set(sx * (W / 2), base + H / 2, sz * (D / 2));
      g.add(post);
    }

    // 山牆三角
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0); tri.lineTo(W / 2, 0); tri.lineTo(0, 1.55); tri.closePath();
    const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    for (const sz of [1, -1]) {
      const t = mesh(triGeo, wall);
      t.position.set(0, base + H, sz * (D / 2) - (sz > 0 ? 0.2 : 0));
      g.add(t);
    }
    // 屋頂：兩片斜板＋屋脊
    const rise = 1.6, half = D / 2 + 0.5;
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    const slab = rbox(len + 0.1, 0.26, W + 0.9, 0.1);
    // 注意：slab 的長邊沿 X，建好後轉 90° 讓長邊沿 Z
    for (const sz of [1, -1]) {
      const r = mesh(slab, roofMat);
      r.rotation.set(0, Math.PI / 2, 0);
      const pivot = new THREE.Group();
      pivot.add(r);
      pivot.rotation.x = sz * ang;
      pivot.position.set(0, base + H + rise / 2 + 0.12, sz * half / 2);
      g.add(pivot);
      // 舊屋頂：缺瓦
      if (worn) for (let k = 0; k < 3; k++) {
        const hole = mesh(rbox(0.5, 0.05, 0.4, 0.02), mat('#4a2e26'), false);
        hole.position.set(-1.6 + k * 1.5, 0.14, (k - 1) * 0.5 * sz);
        pivot.add(hole);
      }
    }
    const ridge = mesh(GEO.cyl, mat(worn ? '#8a4a3a' : '#a8412e'));
    ridge.scale.set(0.3, W + 1, 0.3);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.set(0, base + H + rise + 0.2, 0);
    g.add(ridge);

    // 煙囪
    const chim = mesh(rbox(0.6, 1.4, 0.6, 0.08), stone);
    chim.position.set(1.6, base + H + 1.3, -0.7);
    g.add(chim);
    const cap = mesh(rbox(0.75, 0.14, 0.75, 0.05), mat('#8f8578'));
    cap.position.set(1.6, base + H + 2.05, -0.7);
    g.add(cap);
    g.userData.chimneyTop = new THREE.Vector3(1.6, base + H + 2.2, -0.7);

    // 門
    const fz = D / 2;
    const frame = mesh(rbox(1.25, 1.95, 0.14, 0.05), trim);
    frame.position.set(0, base + 0.97, fz + 0.03);
    const door = mesh(rbox(1.0, 1.78, 0.12, 0.08), mat('#8b5a3c', { roughness: 0.7 }));
    door.position.set(0, base + 0.9, fz + 0.08);
    const knob = mesh(GEO.sphereLo, mat('#e8b84a', { metalness: 0.6, roughness: 0.3 }));
    knob.scale.setScalar(0.1);
    knob.position.set(0.34, base + 0.9, fz + 0.18);
    g.add(frame, door, knob);

    // 窗戶（夜晚亮燈）
    for (const sx of [-1, 1]) {
      const wx = sx * 1.65, wy = base + 1.45;
      const f = mesh(rbox(1.1, 0.95, 0.12, 0.05), trim);
      f.position.set(wx, wy, fz + 0.03);
      const glassMat = mat('#9ec9e8', { roughness: 0.15, emissive: '#ffbf66', emissiveIntensity: 0 });
      this.windowMats.push(glassMat);
      const glass = mesh(rbox(0.86, 0.72, 0.06, 0.02), glassMat, false);
      glass.position.set(wx, wy, fz + 0.07);
      const barV = mesh(rbox(0.06, 0.74, 0.05, 0.02), trim, false);
      barV.position.set(wx, wy, fz + 0.11);
      const barH = mesh(rbox(0.86, 0.06, 0.05, 0.02), trim, false);
      barH.position.set(wx, wy, fz + 0.11);
      g.add(f, glass, barV, barH);
      if (worn && sx < 0) {
        // 破窗：釘上兩塊木板
        for (const r of [0.6, -0.6]) {
          const board = mesh(rbox(1.2, 0.16, 0.06, 0.03), mat('#9c7048'));
          board.position.set(wx, wy, fz + 0.16);
          board.rotation.z = r;
          g.add(board);
        }
      }
      if (!worn) {
        // 花台
        const box = mesh(rbox(1.1, 0.24, 0.3, 0.05), mat('#8fb86a'));
        box.position.set(wx, wy - 0.62, fz + 0.2);
        g.add(box);
        const colors = ['#ff7aa8', '#ffd84a', '#ff9a4a', '#ffffff'];
        for (let k = 0; k < 5; k++) {
          const fl = mesh(GEO.sphereLo, mat(colors[k % 4]), false);
          fl.scale.setScalar(0.16);
          fl.position.set(wx - 0.4 + k * 0.2, wy - 0.44, fz + 0.2);
          g.add(fl);
        }
      }
    }

    // 門廊與階梯
    const deck = mesh(rbox(3.2, 0.2, 1.2, 0.05), mat('#b98a5e'));
    deck.position.set(0, 0.3, fz + 0.75);
    const step = mesh(rbox(1.6, 0.2, 0.5, 0.05), mat('#a87c52'));
    step.position.set(0, 0.1, fz + 1.55);
    g.add(deck, step);
    if (!worn) {
      const matt = mesh(rbox(1.0, 0.03, 0.6, 0.02), mat('#d8584a'), false);
      matt.position.set(0, 0.42, fz + 0.75);
      g.add(matt);
    }
    // 燈籠柱
    const lp = mesh(rbox(0.12, 1.6, 0.12, 0.04), mat('#5a4a3a'));
    lp.position.set(1.9, 0.8, fz + 0.8);
    const lamp = mesh(rbox(0.3, 0.36, 0.3, 0.06), this.lanternMat, false);
    lamp.position.set(1.9, 1.72, fz + 0.8);
    g.add(lp, lamp);

    // 破舊版：牆上的藤蔓
    if (worn) {
      const vineMat = withWind(mat('#4f9a3a'), 0.02);
      const rand = mulberry32(21);
      for (let v = 0; v < 5; v++) {
        const x0 = -2.6 + rand() * 1.4 + (v > 2 ? 3.4 : 0);
        for (let k = 0; k < 7; k++) {
          const leaf = mesh(GEO.sphereLo, vineMat, false);
          leaf.scale.set(0.28, 0.2, 0.08);
          leaf.position.set(x0 + Math.sin(k * 1.3 + v) * 0.18, base + 0.3 + k * 0.32, fz + 0.1);
          leaf.rotation.z = rand() - 0.5;
          g.add(leaf);
        }
      }
    }
    return g;
  }

  private makeDoghouse(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'doghouse';
    this.interactive.push(g);
    const body = mesh(rbox(1.2, 0.9, 1.2, 0.1), mat('#d4764c'));
    body.position.y = 0.45;
    g.add(body);
    for (const s of [1, -1]) {
      const r = mesh(rbox(1.5, 0.12, 0.95, 0.05), mat('#5b84c4'));
      r.position.set(0, 1.12, s * 0.32);
      r.rotation.x = s * 0.62;
      g.add(r);
    }
    const tri = new THREE.Shape();
    tri.moveTo(-0.6, 0); tri.lineTo(0.6, 0); tri.lineTo(0, 0.5); tri.closePath();
    const t = mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.1, bevelEnabled: false }), mat('#d4764c'));
    t.position.set(0, 0.9, -0.55);
    g.add(t);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20, 0, Math.PI), mat('#2a1c18', { roughness: 1 }));
    hole.position.set(0, 0.12, 0.61);
    const holeLo = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.25), hole.material);
    holeLo.position.set(0, 0.12, 0.611);
    hole.position.y = 0.24;
    const plate = mesh(rbox(0.5, 0.16, 0.04, 0.02), mat('#f3e7d3'), false);
    plate.position.set(0, 0.72, 0.62);
    g.add(hole, holeLo, plate);
    return g;
  }

  private makeMailbox(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'mailbox';
    this.interactive.push(g);
    const post = mesh(rbox(0.12, 1.0, 0.12, 0.04), mat('#8a6a4a'));
    post.position.y = 0.5;
    const box = mesh(rbox(0.36, 0.34, 0.6, 0.14), mat('#4a7fc9', { roughness: 0.4 }));
    box.position.y = 1.12;
    const flag = mesh(rbox(0.03, 0.26, 0.14, 0.01), mat('#e84a4a'));
    flag.position.set(0.2, 1.24, -0.08);
    g.add(post, box, flag);
    return g;
  }

  private makeCompost(): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = 'compost';
    this.interactive.push(g);
    const wood = mat('#a8804e');
    for (let i = 0; i < 4; i++) {
      const s = mesh(rbox(0.9, 0.14, 0.9, 0.04), i % 2 ? wood : mat('#94703f'));
      s.position.y = 0.1 + i * 0.16;
      g.add(s);
    }
    const lid = mesh(rbox(0.95, 0.08, 0.95, 0.03), mat('#6aa84a'));
    lid.position.y = 0.72;
    g.add(lid);
    return g;
  }

  private makeTree(seed: number): THREE.Group {
    const g = new THREE.Group();
    const rand = mulberry32(100 + seed);
    const trunk = mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 10), mat('#8a5a3a'));
    trunk.position.y = 0.8;
    g.add(trunk);
    const n = 4 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const f = mesh(GEO.ico, this.leafMats[i % this.leafMats.length]);
      const s = 1.1 + rand() * 0.7;
      f.scale.set(s * 1.1, s * 0.95, s * 1.1);
      const a = (i / n) * Math.PI * 2;
      f.position.set(i === 0 ? 0 : Math.cos(a) * 0.55, i === 0 ? 2.5 : 1.9 + rand() * 0.5, i === 0 ? 0 : Math.sin(a) * 0.55);
      g.add(f);
    }
    return g;
  }

  private makeRock(seed: number): THREE.Group {
    const g = new THREE.Group();
    const rand = mulberry32(300 + seed);
    const r = mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('#a9a49b', { roughness: 0.95, flatShading: false }));
    r.scale.set(0.9 + rand() * 0.4, 0.55 + rand() * 0.2, 0.8 + rand() * 0.3);
    r.position.y = 0.12;
    g.add(r);
    return g;
  }

  // ---------- 每幀 ----------
  update(dt: number, t: number, glow: number, now = 0): void {
    this.grassT -= dt;
    if (this.grassT <= 0 && now) { this.grassT = 0.3; this.regrowGrass(now); }
    this.windowMats.forEach((m) => (m.emissiveIntensity = glow * 3.2));
    this.lanternMat.emissiveIntensity = glow * 5;
    this.lantern.intensity = glow * 6;
    const fm = this.fireflies.material as THREE.PointsMaterial;
    fm.opacity = Math.max(0, glow - 0.4) * 1.6;
    this.fireflies.visible = fm.opacity > 0.01;
    if (this.fireflies.visible) {
      const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      const base = this.fireflies.geometry.userData.base as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, base[i * 3] + Math.sin(t * 0.5 + i) * 0.8, base[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * 0.3, base[i * 3 + 2] + Math.cos(t * 0.4 + i) * 0.8);
      }
      pos.needsUpdate = true;
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 130) c.position.x = -130;
    }
    // 煙囪冒煙（修繕後才有）
    if (this.houseTier >= 2) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.5;
        const p = this.props.get('house')!;
        const top = (p.obj.userData.chimneyTop as THREE.Vector3).clone().applyMatrix4(p.obj.matrixWorld);
        const m = mesh(GEO.sphereLo, this.smokeMat, false);
        m.position.copy(top);
        m.scale.setScalar(0.25);
        this.root.add(m);
        this.smoke.push({ m, life: 0 });
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life += dt;
      s.m.position.y += dt * 0.6;
      s.m.position.x += dt * 0.25;
      s.m.scale.setScalar(0.25 + s.life * 0.28);
      if (s.life > 3.2) { this.root.remove(s.m); this.smoke.splice(i, 1); }
    }
  }
}
