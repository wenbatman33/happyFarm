import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GEO, mat, mesh, withRim } from '../world/materials';
import type { Grid } from '../world/grid';
import { tileOf } from '../world/grid';
import { Mover } from './mover';
import { node } from '../world/models';
import { clamp, lerp } from '../core/rng';

export type ActionAnim = 'pull' | 'hoe' | 'plant' | 'water' | 'harvest' | 'pet' | 'sickle' | 'celebrate' | 'feed' | 'brush' | 'milk' | 'chop' | 'mine' | 'fert';

// 動作長度（秒）與「作用點」（0..1，這時候才真的拔起、澆到水）
export const ANIM_SPEC: Record<ActionAnim, { dur: number; impact: number; tool?: string }> = {
  pull: { dur: 0.62, impact: 0.66 },
  hoe: { dur: 0.5, impact: 0.56, tool: 'hoe' },
  plant: { dur: 0.42, impact: 0.5, tool: 'bag' },
  water: { dur: 0.6, impact: 0.35, tool: 'can' },
  harvest: { dur: 0.38, impact: 0.5 },
  pet: { dur: 1.2, impact: 0.25 },
  sickle: { dur: 0.45, impact: 0.5, tool: 'sickle' },
  celebrate: { dur: 1.0, impact: 0.5 },
  feed: { dur: 0.85, impact: 0.55, tool: 'hay' },
  brush: { dur: 1.7, impact: 0.3, tool: 'brush' },
  milk: { dur: 3.4, impact: 0.93 },
  chop: { dur: 0.5, impact: 0.56, tool: 'axe' },
  mine: { dur: 0.5, impact: 0.56, tool: 'pick' },
  fert: { dur: 0.45, impact: 0.5, tool: 'fertbag' },
};

interface Pose { y: number; sy: number; lean: number; twist: number; aLx: number; aLz: number; aRx: number; aRz: number; lL: number; lR: number; head: number; toolTilt: number }
const REST: Pose = { y: 0, sy: 1, lean: 0, twist: 0, aLx: 0, aLz: 0.08, aRx: 0, aRz: -0.08, lL: 0, lR: 0, head: 0, toolTilt: 0 };

const rim = (c: string, o: THREE.MeshStandardMaterialParameters = {}) => withRim(mat(c, { roughness: 0.62, ...o }), 0.18);

// 主角外觀（docs/02 §1）
export type HairStyle = 'short' | 'bob' | 'ponytail' | 'pigtails' | 'spiky' | 'bun';
export interface Look { body: 'round' | 'tall'; skin: number; hair: HairStyle; hairColor: number; outfit: number; shirt: number; hat: boolean }
export const LOOK_PALETTE = {
  skin: ['#ffe0c8', '#ffd1b0', '#f2b894', '#d99a6c', '#b87a50', '#8a5634'],
  hair: ['#6b3f25', '#3a2418', '#1f1a18', '#d8a24a', '#f0d27a', '#c0503a', '#e87aa0', '#6a8ad8', '#8a5ac8', '#f4f0e8', '#8a8a8a', '#4a9a6a'],
  outfit: ['#4a7bc8', '#3f9a5a', '#c85a4a', '#8a5ac8', '#e8a03a', '#5a5a6a', '#e87aa0', '#3aa8b8'],
  shirt: ['#e8604c', '#f4f0e8', '#f2c94c', '#6ab8e8', '#8ad86a', '#e87aa0', '#8a6ad8', '#3a3a44'],
};
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'short', label: '短髮' }, { id: 'bob', label: '鮑伯頭' }, { id: 'ponytail', label: '馬尾' },
  { id: 'pigtails', label: '雙馬尾' }, { id: 'spiky', label: '刺刺頭' }, { id: 'bun', label: '包包頭' },
];
export const DEFAULT_LOOK: Look = { body: 'round', skin: 1, hair: 'short', hairColor: 0, outfit: 0, shirt: 0, hat: true };

interface Parts {
  body: THREE.Object3D; head: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; handR: THREE.Object3D;
  eyes: THREE.Object3D[]; hair: THREE.Object3D; hat: THREE.Object3D; hairMap: Partial<Record<HairStyle, THREE.Object3D>> | null;
  mats: { skin: THREE.MeshStandardMaterial; overall: THREE.MeshStandardMaterial; shirt: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial };
}

export class Player {
  root = new THREE.Group();
  mover: Mover;
  manual = new THREE.Vector2(); // WASD 輸入（已轉成世界方向）
  private shape = new THREE.Group(); // 體型縮放（不影響動畫）
  private body: THREE.Object3D = new THREE.Group();
  private hairGroup: THREE.Object3D = new THREE.Group();
  private hatGroup: THREE.Object3D = new THREE.Group();
  private mats: { skin: THREE.MeshStandardMaterial; overall: THREE.MeshStandardMaterial; shirt: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial } = {
    skin: rim('#ffd1b0'), overall: rim('#4a7bc8'), shirt: rim('#e8604c'), hair: rim('#6b3f25'),
  };
  private glbHair: Partial<Record<HairStyle, THREE.Object3D>> | null = null;
  private procParts: Parts | null = null;
  look: Look = { ...DEFAULT_LOOK };
  private head: THREE.Object3D = new THREE.Group();
  private armL: THREE.Object3D = new THREE.Group();
  private armR: THREE.Object3D = new THREE.Group();
  private legL: THREE.Object3D = new THREE.Group();
  private legR: THREE.Object3D = new THREE.Group();
  private handR: THREE.Object3D = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private tools: Record<string, THREE.Object3D> = {};
  private pose: Pose = { ...REST };
  private walkPhase = 0;
  private blinkT = 2;
  private idleT = 0;
  private anim: { name: ActionAnim; t: number; fired: boolean; onImpact?: () => void; onDone?: () => void } | null = null;
  onTugTick?: () => void;
  onSquirt?: (alt: boolean) => void; // 擠奶：每擠一下
  onBrushStroke?: () => void;
  private squirtN = 0;
  pushing = false; // 推除草機中（移動由 Mower 控制）
  pushSpeed = 0;

  // 進出室內時切換走路用的格網
  setGrid(g: Grid): void { this.grid = g; this.mover.grid = g; }

  constructor(private grid: Grid) {
    this.mover = new Mover(this.root, grid);
    this.build();
  }

  get busy(): boolean { return !!this.anim; }
  get idleTime(): number { return this.idleT; }
  get animName(): ActionAnim | null { return this.anim?.name ?? null; }
  get animT(): number { return this.anim ? this.anim.t / ANIM_SPEC[this.anim.name].dur : 0; }

  private build() {
    const { skin, overall, shirt } = this.mats;
    const shoe = rim('#7a4a2e');
    const straw = rim('#f2cf78', { roughness: 0.8 });
    const eye = mat('#1e1512', { roughness: 0.15 });
    const white = mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 });

    this.root.add(this.shape);
    this.shape.add(this.body);
    // 腿
    for (const [leg, sx] of [[this.legL, 1], [this.legR, -1]] as const) {
      leg.position.set(sx * 0.12, 0.3, 0);
      const l = mesh(GEO.capsule, overall);
      l.scale.set(0.18, 0.12, 0.18);
      l.position.y = -0.13;
      const s = mesh(GEO.sphere, shoe);
      s.scale.set(0.2, 0.13, 0.26);
      s.position.set(0, -0.27, 0.04);
      leg.add(l, s);
      this.body.add(leg);
    }
    // 身體：吊帶褲＋上衣
    const torso = mesh(GEO.capsule, overall);
    torso.scale.set(0.5, 0.2, 0.44);
    torso.position.y = 0.6;
    const chest = mesh(GEO.sphere, shirt);
    chest.scale.set(0.48, 0.34, 0.42);
    chest.position.y = 0.8;
    const bib = mesh(GEO.sphere, overall);
    bib.scale.set(0.3, 0.28, 0.1);
    bib.position.set(0, 0.74, 0.19);
    const btn = mesh(GEO.sphereLo, mat('#f2cf5a', { metalness: 0.5, roughness: 0.3 }), false);
    btn.scale.setScalar(0.05);
    for (const sx of [-0.09, 0.09]) {
      const b = btn.clone();
      b.position.set(sx, 0.83, 0.23);
      this.body.add(b);
    }
    this.body.add(torso, chest, bib);
    // 手臂
    for (const [arm, sx] of [[this.armL, 1], [this.armR, -1]] as const) {
      arm.position.set(sx * 0.29, 0.86, 0);
      const a = mesh(GEO.capsule, shirt);
      a.scale.set(0.15, 0.18, 0.15);
      a.position.y = -0.17;
      const h = mesh(GEO.sphere, skin);
      h.scale.setScalar(0.16);
      h.position.y = -0.34;
      arm.add(a, h);
      this.body.add(arm);
    }
    this.handR.position.set(0, -0.36, 0.02);
    this.armR.add(this.handR);
    // 頭：大頭大眼的可愛比例
    this.head.position.y = 0.95;
    this.body.add(this.head);
    const skull = mesh(GEO.sphere, skin);
    skull.scale.setScalar(0.68);
    skull.position.y = 0.28;
    this.head.add(skull, this.hairGroup, this.hatGroup);
    this.buildHair('short');
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * 0.12, 0.27, 0.3);
      const ball = mesh(GEO.sphere, eye, false);
      ball.scale.set(0.11, 0.14, 0.07);
      const hl = mesh(GEO.sphereLo, white, false);
      hl.scale.setScalar(0.035);
      hl.position.set(0.02, 0.03, 0.03);
      e.add(ball, hl);
      this.eyes.push(e);
      const cheek = mesh(GEO.sphereLo, mat('#ff9aa0', { roughness: 0.9 }), false);
      cheek.scale.set(0.1, 0.06, 0.04);
      cheek.position.set(sx * 0.21, 0.17, 0.27);
      const ear = mesh(GEO.sphereLo, skin);
      ear.scale.set(0.08, 0.12, 0.08);
      ear.position.set(sx * 0.33, 0.25, 0);
      this.head.add(e, cheek, ear);
    }
    const nose = mesh(GEO.sphereLo, skin, false);
    nose.scale.set(0.07, 0.06, 0.06);
    nose.position.set(0, 0.2, 0.34);
    const mouth = mesh(GEO.sphereLo, mat('#b2463e'), false);
    mouth.scale.set(0.07, 0.025, 0.02);
    mouth.position.set(0, 0.11, 0.315);
    this.head.add(nose, mouth);
    // 草帽
    const brim = mesh(GEO.cyl, straw);
    brim.scale.set(0.98, 0.035, 0.98);
    brim.position.y = 0.52;
    const crown = mesh(GEO.sphere, straw);
    crown.scale.set(0.56, 0.36, 0.56);
    crown.position.y = 0.58;
    const band = mesh(GEO.cyl, mat('#d8453c'));
    band.scale.set(0.57, 0.06, 0.57);
    band.position.y = 0.58;
    this.hatGroup.add(brim, crown, band);

    // 手持工具
    const woodM = mat('#a87a4c');
    const hoe = new THREE.Group();
    const hs = mesh(GEO.cyl, woodM); hs.scale.set(0.05, 1.0, 0.05); hs.position.y = 0.2;
    const hb = mesh(GEO.sphere, mat('#b8c2cc', { metalness: 0.5, roughness: 0.35 })); hb.scale.set(0.24, 0.05, 0.16); hb.position.set(0, 0.7, 0.08);
    hoe.add(hs, hb);
    hoe.rotation.x = Math.PI / 2;
    const can = new THREE.Group();
    const cb = mesh(GEO.capsule, mat('#5cb85c', { roughness: 0.4 })); cb.scale.set(0.3, 0.14, 0.24);
    const sp = mesh(GEO.cyl, mat('#4a9e4a')); sp.scale.set(0.04, 0.34, 0.04); sp.rotation.x = 1.0; sp.position.set(0, 0.06, 0.2);
    can.add(cb, sp);
    can.position.set(0, -0.08, 0.1);
    const bag = mesh(GEO.sphere, mat('#e6cf9a')); bag.scale.set(0.2, 0.24, 0.18); bag.position.y = -0.08;
    const sickle = new THREE.Group();
    const sh = mesh(GEO.cyl, woodM); sh.scale.set(0.05, 0.36, 0.05);
    const sb = mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16, Math.PI * 1.1), mat('#c9d2da', { metalness: 0.6, roughness: 0.3 }));
    sb.position.set(0.18, 0.17, 0); sb.rotation.z = 0.2;
    sickle.add(sh, sb);
    sickle.rotation.x = Math.PI / 2;
    // 一捆牧草、刷子
    const hay = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const h = mesh(GEO.sphereLo, mat('#e8c65a', { roughness: 0.9 }));
      h.scale.set(0.12, 0.3, 0.12);
      h.position.set((i - 2) * 0.05, 0, 0.1);
      h.rotation.z = (i - 2) * 0.2;
      hay.add(h);
    }
    const brushT = new THREE.Group();
    const bb = mesh(new RoundedBoxGeometry(0.26, 0.08, 0.14, 1, 0.03), mat('#b07a48'));
    const br = mesh(new RoundedBoxGeometry(0.24, 0.06, 0.12, 1, 0.02), mat('#5a3e2a', { roughness: 1 }));
    br.position.y = -0.06;
    brushT.add(bb, br);
    brushT.position.set(0, -0.06, 0.08);
    // 斧頭、鎬、肥料袋
    const metalM = mat('#b8c2cc', { metalness: 0.5, roughness: 0.35 });
    const axe = new THREE.Group();
    const ah = mesh(GEO.cyl, woodM); ah.scale.set(0.05, 0.9, 0.05); ah.position.y = 0.18;
    const ab = mesh(new RoundedBoxGeometry(0.08, 0.22, 0.2, 1, 0.03), metalM); ab.position.set(0, 0.58, 0.08);
    axe.add(ah, ab);
    axe.rotation.x = Math.PI / 2;
    const pick = new THREE.Group();
    const ph = mesh(GEO.cyl, woodM); ph.scale.set(0.05, 0.9, 0.05); ph.position.y = 0.18;
    const pb = mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14, Math.PI * 0.9), metalM); pb.position.set(0, 0.5, 0); pb.rotation.set(0, Math.PI / 2, Math.PI * 0.05);
    pick.add(ph, pb);
    pick.rotation.x = Math.PI / 2;
    const fertbag = mesh(GEO.sphere, mat('#7a9a4a')); fertbag.scale.set(0.2, 0.24, 0.18); fertbag.position.y = -0.08;
    this.tools = { hoe, can, bag, sickle, hay, brush: brushT, axe, pick, fertbag };
    for (const t of Object.values(this.tools)) { t.visible = false; this.handR.add(t); }
  }

  // 切換成 Blender GLB 模型（src＝null 則回到程式建模）
  useModel(src: THREE.Object3D | null): void {
    if (!this.procParts) this.procParts = this.parts();
    if (!src) { this.setParts(this.procParts); return; }
    const root = src.clone(true);
    const need = ['body', 'head', 'armL', 'armR', 'legL', 'legR'];
    if (need.some((n) => !node(root, n))) { console.warn('[模型] 主角 GLB 缺少必要節點，沿用程式建模'); return; }
    // 材質依名稱取出（每次 clone 都複製一份，才能各自換色）
    const mats: Record<string, THREE.MeshStandardMaterial> = {};
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mm = m.material as THREE.MeshStandardMaterial;
      if (!mats[mm.name]) mats[mm.name] = withRim(mm.clone(), 0.18);
      m.material = mats[mm.name];
    });
    const head = node(root, 'head')!;
    const hairMap: Partial<Record<HairStyle, THREE.Object3D>> = {};
    for (const h of HAIR_STYLES) { const n = node(root, `hair_${h.id}`); if (n) hairMap[h.id] = n; }
    let handR = node(root, 'handR');
    if (!handR) { handR = new THREE.Object3D(); handR.position.set(0, -0.36, 0.02); node(root, 'armR')!.add(handR); }
    this.setParts({
      body: node(root, 'body')!, head, armL: node(root, 'armL')!, armR: node(root, 'armR')!, legL: node(root, 'legL')!, legR: node(root, 'legR')!, handR,
      eyes: [node(root, 'eye_0'), node(root, 'eye_1')].filter((x): x is THREE.Object3D => !!x),
      hair: new THREE.Group(), hat: node(root, 'hat') ?? new THREE.Group(), hairMap,
      mats: { skin: mats.skin ?? this.procParts.mats.skin, overall: mats.overall ?? this.procParts.mats.overall, shirt: mats.shirt ?? this.procParts.mats.shirt, hair: mats.hair ?? this.procParts.mats.hair },
    });
  }

  private parts(): Parts {
    return { body: this.body, head: this.head, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR, handR: this.handR, eyes: this.eyes, hair: this.hairGroup, hat: this.hatGroup, hairMap: this.glbHair, mats: this.mats };
  }

  private setParts(p: Parts) {
    this.shape.clear();
    this.shape.add(p.body);
    Object.assign(this, { body: p.body, head: p.head, armL: p.armL, armR: p.armR, legL: p.legL, legR: p.legR, eyes: p.eyes, hairGroup: p.hair, hatGroup: p.hat, glbHair: p.hairMap, mats: p.mats });
    // 工具移到新的右手
    for (const t of Object.values(this.tools)) p.handR.add(t);
    this.handR = p.handR;
    const look = this.look;
    this.look = { ...look, hair: look.hair === 'short' ? 'bob' : 'short' }; // 強制重套髮型
    this.setLook(look);
  }

  setLook(look: Look): void {
    const P = LOOK_PALETTE;
    if (look.hair !== this.look.hair || (!this.glbHair && !this.hairGroup.children.length)) this.buildHair(look.hair);
    this.look = { ...look };
    this.mats.skin.color.set(P.skin[look.skin] ?? P.skin[1]);
    this.mats.hair.color.set(P.hair[look.hairColor] ?? P.hair[0]);
    this.mats.overall.color.set(P.outfit[look.outfit] ?? P.outfit[0]);
    this.mats.shirt.color.set(P.shirt[look.shirt] ?? P.shirt[0]);
    this.hatGroup.visible = look.hat;
    // 高挑款：身體拉長、頭相對小一點
    if (look.body === 'tall') { this.shape.scale.set(0.95, 1.12, 0.95); this.head.scale.setScalar(0.92); }
    else { this.shape.scale.set(1.04, 1, 1.04); this.head.scale.setScalar(1); }
  }

  private buildHair(style: HairStyle) {
    // GLB：6 種髮型已經做好，只切換顯示
    if (this.glbHair) {
      for (const [k, o] of Object.entries(this.glbHair)) if (o) o.visible = k === style;
      return;
    }
    const g = this.hairGroup;
    g.clear();
    const hair = this.mats.hair;
    const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, geo: THREE.BufferGeometry = GEO.sphere, rx = 0, rz = 0) => {
      const m = mesh(geo, hair);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      g.add(m);
      return m;
    };
    const tie = (x: number, y: number, z: number) => { const t = mesh(GEO.sphereLo, mat('#e8504a'), false); t.scale.setScalar(0.07); t.position.set(x, y, z); g.add(t); };
    add(0.7, 0.6, 0.7, 0, 0.37, -0.04); // 頭頂髮帽
    switch (style) {
      case 'short':
        add(0.5, 0.2, 0.3, 0.05, 0.5, 0.2, GEO.sphere, 0, -0.3);
        break;
      case 'bob':
        add(0.74, 0.62, 0.74, 0, 0.35, -0.04);
        for (const sx of [-1, 1]) add(0.22, 0.4, 0.34, sx * 0.29, 0.18, -0.02);
        add(0.58, 0.16, 0.26, 0, 0.47, 0.21);
        break;
      case 'ponytail':
        add(0.5, 0.2, 0.3, -0.05, 0.5, 0.2, GEO.sphere, 0, 0.3);
        add(0.16, 0.2, 0.16, 0, 0.26, -0.4, GEO.capsule, 0.6);
        tie(0, 0.42, -0.32);
        break;
      case 'pigtails':
        add(0.56, 0.16, 0.26, 0, 0.47, 0.21);
        for (const sx of [-1, 1]) { add(0.14, 0.18, 0.14, sx * 0.38, 0.2, -0.08, GEO.capsule, 0, sx * 0.5); tie(sx * 0.32, 0.36, -0.06); }
        break;
      case 'spiky':
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI - Math.PI / 2;
          add(0.12, 0.22, 0.12, Math.sin(a) * 0.24, 0.58, 0.1 + Math.cos(a) * 0.12, GEO.cone, 0.5 + Math.cos(a) * 0.3, -Math.sin(a) * 0.6);
        }
        break;
      case 'bun':
        add(0.56, 0.16, 0.26, 0, 0.47, 0.21);
        add(0.3, 0.3, 0.3, 0, 0.66, -0.12);
        tie(0, 0.56, -0.12);
        break;
    }
  }

  // 播放動作；onImpact 在作用點觸發，onDone 在動作結束
  play(name: ActionAnim, onImpact?: () => void, onDone?: () => void): void {
    this.anim = { name, t: 0, fired: false, onImpact, onDone };
    this.squirtN = 0;
    for (const [k, t] of Object.entries(this.tools)) t.visible = k === ANIM_SPEC[name].tool;
  }

  update(dt: number): void {
    // 手動移動（WASD）
    if (this.manual.lengthSq() > 0.01 && !this.anim && !this.pushing) {
      this.mover.stop();
      const sp = this.mover.speed * dt;
      const p = this.root.position;
      const nx = p.x + this.manual.x * sp, nz = p.z + this.manual.y * sp;
      const ok = (x: number, z: number) => { const t = tileOf(x, z); return !this.grid.isBlocked(t.x, t.z); };
      if (ok(nx, nz)) { p.x = nx; p.z = nz; } else if (ok(nx, p.z)) p.x = nx; else if (ok(p.x, nz)) p.z = nz;
      this.mover.yawGoal = Math.atan2(this.manual.x, this.manual.y);
    }
    this.mover.update(dt);
    const walking = this.pushing ? this.pushSpeed > 0.15 || this.mover.moving : this.mover.moving || this.manual.lengthSq() > 0.01;
    this.idleT = walking || this.anim ? 0 : this.idleT + dt;

    // 目標姿勢
    const g: Pose = { ...REST };
    const tNow = performance.now() / 1000;
    if (this.anim) {
      const spec = ANIM_SPEC[this.anim.name];
      this.anim.t += dt;
      const u = clamp(this.anim.t / spec.dur, 0, 1);
      this.poseFor(this.anim.name, u, g);
      if (this.anim.name === 'pull' && u > 0.28 && u < 0.62 && Math.random() < dt * 8) this.onTugTick?.();
      if (this.anim.name === 'milk' && u > 0.1 && u < 0.9) {
        const n = Math.floor((this.anim.t - spec.dur * 0.1) / 0.24);
        if (n >= this.squirtN) { this.squirtN = n + 1; this.onSquirt?.(n % 2 === 1); }
      }
      if (this.anim.name === 'brush') {
        const n = Math.floor(this.anim.t / 0.42);
        if (n >= this.squirtN) { this.squirtN = n + 1; this.onBrushStroke?.(); }
      }
      if (!this.anim.fired && u >= spec.impact) { this.anim.fired = true; this.anim.onImpact?.(); }
      if (u >= 1) {
        const done = this.anim.onDone;
        this.anim = null;
        for (const t of Object.values(this.tools)) t.visible = false;
        done?.();
      }
    } else if (this.pushing) {
      // 推除草機：雙手前伸握把手、身體前傾，手臂跟著引擎震動
      const buzz = Math.sin(tNow * 70) * 0.03;
      g.aLx = g.aRx = -1.2 + buzz;
      g.aLz = 0.18; g.aRz = -0.18;
      g.lean = 0.3;
      if (walking) {
        this.walkPhase += dt * (7 + this.pushSpeed * 2.5);
        const s = Math.sin(this.walkPhase);
        g.lL = s * 0.6; g.lR = -s * 0.6;
        g.y = Math.abs(Math.cos(this.walkPhase)) * 0.04;
      }
    } else if (walking) {
      this.walkPhase += dt * 13;
      const s = Math.sin(this.walkPhase);
      g.lL = s * 0.75; g.lR = -s * 0.75;
      g.aLx = -s * 0.6; g.aRx = s * 0.6;
      g.y = Math.abs(Math.cos(this.walkPhase)) * 0.06;
      g.lean = 0.12;
      g.sy = 1 + Math.abs(Math.cos(this.walkPhase)) * 0.03;
    } else {
      g.sy = 1 + Math.sin(tNow * 2.4) * 0.015;
      g.head = Math.sin(tNow * 0.7) * 0.06;
      g.aLz = 0.1 + Math.sin(tNow * 2.4) * 0.03;
      g.aRz = -g.aLz;
    }
    // 平滑逼近目標姿勢，避免動作切換時跳動
    const k = 1 - Math.exp(-(this.anim ? 30 : 16) * dt);
    const P = this.pose as unknown as Record<string, number>;
    const G = g as unknown as Record<string, number>;
    for (const key of Object.keys(P)) P[key] = lerp(P[key], G[key], k);
    const pz = this.pose;
    this.body.position.y = pz.y;
    this.body.scale.set(1 + (1 - pz.sy) * 0.6, pz.sy, 1 + (1 - pz.sy) * 0.6);
    this.body.rotation.set(pz.lean, pz.twist, 0);
    this.armL.rotation.set(pz.aLx, 0, pz.aLz);
    this.armR.rotation.set(pz.aRx, 0, pz.aRz);
    this.legL.rotation.x = pz.lL;
    this.legR.rotation.x = pz.lR;
    this.head.rotation.set(-pz.lean * 0.4, pz.head, 0);
    this.tools.can.rotation.x = pz.toolTilt;

    // 眨眼
    this.blinkT -= dt;
    const closed = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    this.eyes.forEach((e) => (e.scale.y = closed ? 0.15 : 1));
  }

  private poseFor(name: ActionAnim, u: number, g: Pose): void {
    const seg = (a: number, b: number) => clamp((u - a) / (b - a), 0, 1);
    switch (name) {
      case 'pull': {
        // 蹲下抓 → 用力拉（抖動）→ 啵！往後坐
        const c = seg(0, 0.25), tug = seg(0.25, 0.66), rec = seg(0.66, 1);
        g.y = -0.2 * c + 0.12 * tug - 0.1 * rec * (1 - rec) * 4;
        g.sy = 1 - 0.14 * c + 0.1 * tug;
        g.lean = 0.45 * c - 0.7 * tug + (u > 0.66 ? -0.35 * (1 - rec) : 0) + (tug > 0 && tug < 1 ? Math.sin(u * 90) * 0.07 : 0);
        g.aLx = g.aRx = -1.25 * c + 0.5 * tug + (u > 0.66 ? 0.6 * (1 - rec) : 0);
        g.lL = g.lR = -0.5 * c;
        break;
      }
      case 'hoe': {
        // 舉高 → 用力往下鋤 → 收回
        const up = seg(0, 0.45), down = seg(0.45, 0.58), back = seg(0.58, 1);
        let a = -2.8 * up, l = -0.18 * up;
        if (u >= 0.45) { a = lerp(-2.8, -0.9, down); l = lerp(-0.18, 0.45, down); }
        if (u >= 0.58) { a = lerp(-0.9, 0, back); l = lerp(0.45, 0, back); }
        g.aLx = g.aRx = a;
        g.lean = l;
        g.y = -0.06 * down * (1 - back);
        g.aLz = 0.2; g.aRz = -0.2;
        break;
      }
      case 'chop':
      case 'mine':
        this.poseFor('hoe', u, g);
        return;
      case 'fert':
        this.poseFor('plant', u, g);
        return;
      case 'plant': {
        const c = seg(0, 0.4), toss = seg(0.4, 0.6), r = seg(0.6, 1);
        g.y = -0.14 * c * (1 - r);
        g.lean = 0.35 * c * (1 - r);
        g.aRx = -0.6 * c - 0.8 * toss * (1 - r);
        g.aLx = -0.3 * c;
        break;
      }
      case 'water': {
        const h = seg(0, 0.2), r = seg(0.85, 1);
        g.aRx = -1.1 * h * (1 - r);
        g.lean = 0.15 * h * (1 - r);
        g.toolTilt = 0.7 * h * (1 - r);
        g.aLz = 0.35;
        break;
      }
      case 'harvest': {
        const c = seg(0, 0.4), up = seg(0.4, 0.7), r = seg(0.7, 1);
        g.y = -0.16 * c * (1 - up) + 0.1 * up * (1 - r);
        g.lean = 0.4 * c * (1 - up);
        g.aLx = g.aRx = -1.1 * c - 1.4 * up * (1 - r);
        g.sy = 1 - 0.1 * c + 0.08 * up * (1 - r);
        break;
      }
      case 'pet': {
        const c = seg(0, 0.2), r = seg(0.85, 1);
        g.y = -0.18 * c * (1 - r);
        g.lean = 0.35 * c * (1 - r);
        g.aRx = -1.3 * c * (1 - r) + Math.sin(u * 40) * 0.15 * c * (1 - r);
        g.aRz = -0.1;
        g.head = 0.2;
        break;
      }
      case 'sickle': {
        const w = seg(0, 0.4), sw = seg(0.4, 0.62), r = seg(0.62, 1);
        g.twist = 0.9 * w - 1.8 * sw + 0.9 * r * sw;
        g.aRx = -1.2 * (w + sw > 0 ? 1 : 0) * (1 - r);
        g.aRz = -0.9 * w + 0.9 * sw;
        g.lean = 0.2 * (1 - r);
        g.y = -0.08 * (1 - r);
        break;
      }
      case 'feed': {
        // 抱著牧草 → 往前拋進飼料槽
        const hold = seg(0, 0.4), toss = seg(0.4, 0.6), r = seg(0.6, 1);
        g.aLx = g.aRx = (-0.9 * hold - 1.1 * toss) * (1 - r);
        g.aLz = 0.1; g.aRz = -0.1;
        g.lean = -0.1 * hold + 0.35 * toss * (1 - r);
        g.y = -0.05 * hold * (1 - toss);
        break;
      }
      case 'brush': {
        // 一下一下順著毛刷
        const c = seg(0, 0.15), r = seg(0.88, 1);
        const stroke = Math.sin(u * Math.PI * 8);
        g.aRx = (-1.35 + stroke * 0.25) * c * (1 - r);
        g.aRz = (-0.35 + stroke * 0.3) * c * (1 - r);
        g.aLx = -0.3 * c * (1 - r);
        g.lean = 0.15 * c * (1 - r);
        g.twist = stroke * 0.12 * c * (1 - r);
        break;
      }
      case 'milk': {
        // 坐在小板凳上，雙手輪流擠
        const sit = seg(0, 0.1), up = seg(0.93, 1);
        const sq = Math.sin(u * 3.4 / 0.24 * Math.PI);
        const on = sit * (1 - up);
        g.y = -0.36 * on;
        g.sy = 1 - 0.06 * on;
        g.lean = 0.28 * on;
        g.lL = g.lR = -1.35 * on;
        g.aLx = (-1.0 + sq * 0.28) * on;
        g.aRx = (-1.0 - sq * 0.28) * on;
        g.aLz = 0.05; g.aRz = -0.05;
        g.head = Math.sin(u * 6) * 0.08 * on;
        break;
      }
      case 'celebrate': {
        const j = Math.sin(Math.PI * clamp(u * 1.3, 0, 1));
        g.y = 0.45 * j;
        g.sy = u < 0.1 ? 0.85 : u > 0.75 ? 0.9 + (u - 0.75) * 0.4 : 1.08;
        g.aLx = g.aRx = -2.9 * Math.min(1, u * 4) * (1 - seg(0.8, 1));
        g.aLz = 0.4; g.aRz = -0.4;
        break;
      }
    }
  }
}
