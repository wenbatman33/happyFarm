import * as THREE from 'three';
import { GEO, mat, mesh, withRim } from '../world/materials';
import type { Grid } from '../world/grid';
import { Mover } from './mover';
import { clamp, lerp } from '../core/rng';
import type { Player } from './player';

// 寵物：開局 4 選 1（docs/02 §2）。M2 先用程式建模，之後換成 Blender GLB
export type Species = 'corgi' | 'cat' | 'bunny' | 'duck';

export const SPECIES: Record<Species, { label: string; emoji: string; name: string; personality: string; skill: string; passive: string }> = {
  corgi: { label: '柯基犬', emoji: '🐶', name: '麻糬', personality: '熱情黏人', skill: '每天在農場挖寶，挖出金幣和寶物', passive: '挖寶獲得量 +20%' },
  cat: { label: '橘貓', emoji: '🐱', name: '橘子', personality: '慵懶傲嬌', skill: '抓偷吃作物的田鼠；在田邊午睡，周圍作物品質變好', passive: '加工時間 −10%（加工坊開放後）' },
  bunny: { label: '垂耳兔', emoji: '🐰', name: '棉花', personality: '害羞溫柔', skill: '自己去吃掉附近的雜草（雜草會進背包）', passive: '根莖類作物有 10% 機率多收 1 個' },
  duck: { label: '小鴨', emoji: '🐥', name: '嘎嘎', personality: '好奇愛玩水', skill: '幫乾掉的田潑水', passive: '雨天摸牠的親密度 ×2' },
};

export type PetState = 'idle' | 'follow' | 'wander' | 'react' | 'dig' | 'sleep' | 'petted' | 'task';
type PetAnim = 'idle' | 'walk' | 'sit' | 'happy' | 'dig' | 'sleep' | 'petted' | 'pounce' | 'nibble' | 'splash' | 'rollover';

export interface PetContext {
  player: Player;
  night: boolean;
  doghouse: { x: number; z: number; rotY: number };
  treasures: { id: string; x: number; z: number }[];
  followDist: number; // 跟主角保持的距離（DEV 可調）
}

// 成長階段的比例：幼年頭大身體小
export const GROWTH = [
  { scale: 0.72, head: 1.3, eye: 1.15, label: '幼年' },
  { scale: 0.86, head: 1.12, eye: 1.06, label: '少年' },
  { scale: 1, head: 1, eye: 1, label: '成年' },
];

const rim = (c: string) => withRim(mat(c, { roughness: 0.75 }), 0.16);
const BLACK = mat('#1d1512', { roughness: 0.2 });
const WHITE_HL = mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 });

interface Rig {
  body: THREE.Group;
  head: THREE.Group;
  legs: THREE.Group[];
  tail: THREE.Group;
  ears: THREE.Group[];
  eyes: THREE.Object3D[];
  wings: THREE.Group[];
  tongue: THREE.Mesh | null;
  hat: THREE.Object3D; // 帽子掛點
  neck: THREE.Object3D; // 領巾掛點
  gait: 'trot' | 'prowl' | 'hop' | 'waddle';
}

function eye(sx: number, x: number, y: number, z: number, s = 1): THREE.Group {
  const e = new THREE.Group();
  e.position.set(sx * x, y, z);
  const ball = mesh(GEO.sphere, BLACK, false);
  ball.scale.set(0.075 * s, 0.09 * s, 0.05 * s);
  const hl = mesh(GEO.sphereLo, WHITE_HL, false);
  hl.scale.setScalar(0.025 * s);
  hl.position.set(0.015 * s, 0.02 * s, 0.02 * s);
  e.add(ball, hl);
  return e;
}

function blankRig(gait: Rig['gait']): Rig {
  return { body: new THREE.Group(), head: new THREE.Group(), legs: [], tail: new THREE.Group(), ears: [], eyes: [], wings: [], tongue: null, hat: new THREE.Object3D(), neck: new THREE.Object3D(), gait };
}

function legs4(r: Rig, fur: THREE.Material, paw: THREE.Material, pos: [number, number][], y: number, len: number, w = 0.1) {
  for (const [x, z] of pos) {
    const leg = new THREE.Group();
    leg.position.set(x, y, z);
    const l = mesh(GEO.capsule, fur);
    l.scale.set(w, len, w);
    l.position.y = -len * 1.1;
    const p = mesh(GEO.sphere, paw);
    p.scale.set(w * 1.2, w * 0.8, w * 1.4);
    p.position.set(0, -len * 2.3, 0.02);
    leg.add(l, p);
    r.legs.push(leg);
    r.body.add(leg);
  }
}

// ---------- 柯基 ----------
function buildCorgi(): Rig {
  const r = blankRig('trot');
  const orange = rim('#e8954a'), white = rim('#fff6ea');
  const pink = mat('#ff9fae', { roughness: 0.8 });
  const torso = mesh(GEO.capsule, orange);
  torso.scale.set(0.42, 0.34, 0.4); torso.rotation.x = Math.PI / 2; torso.position.set(0, 0.32, 0);
  const belly = mesh(GEO.capsule, white);
  belly.scale.set(0.36, 0.3, 0.32); belly.rotation.x = Math.PI / 2; belly.position.set(0, 0.26, 0.02);
  const chest = mesh(GEO.sphere, white); chest.scale.set(0.34, 0.34, 0.3); chest.position.set(0, 0.34, 0.24);
  const butt = mesh(GEO.sphere, white); butt.scale.set(0.36, 0.34, 0.3); butt.position.set(0, 0.34, -0.26);
  r.body.add(torso, belly, chest, butt);
  legs4(r, orange, white, [[0.12, 0.2], [-0.12, 0.2], [0.12, -0.2], [-0.12, -0.2]], 0.2, 0.07);
  r.tail.position.set(0, 0.42, -0.4);
  const t = mesh(GEO.sphere, orange); t.scale.set(0.12, 0.12, 0.16); t.position.z = -0.04;
  r.tail.add(t);
  r.body.add(r.tail);
  r.head.position.set(0, 0.55, 0.3);
  r.body.add(r.head);
  const skull = mesh(GEO.sphere, orange); skull.scale.set(0.42, 0.38, 0.4);
  const muzzle = mesh(GEO.sphere, white); muzzle.scale.set(0.26, 0.19, 0.26); muzzle.position.set(0, -0.07, 0.15);
  const blaze = mesh(GEO.sphere, white); blaze.scale.set(0.08, 0.24, 0.1); blaze.position.set(0, 0.05, 0.15);
  const nose = mesh(GEO.sphere, BLACK, false); nose.scale.set(0.08, 0.06, 0.06); nose.position.set(0, -0.03, 0.28);
  r.tongue = mesh(GEO.sphere, pink, false); r.tongue.scale.set(0.07, 0.03, 0.09); r.tongue.position.set(0, -0.14, 0.24);
  r.head.add(skull, muzzle, blaze, nose, r.tongue);
  for (const sx of [-1, 1]) {
    const e = eye(sx, 0.095, 0.04, 0.17);
    r.eyes.push(e);
    const ear = new THREE.Group();
    ear.position.set(sx * 0.12, 0.14, -0.03); ear.rotation.z = -sx * 0.35;
    const outer = mesh(GEO.cone, orange); outer.scale.set(0.16, 0.26, 0.08); outer.position.y = 0.12;
    const inner = mesh(GEO.cone, pink, false); inner.scale.set(0.1, 0.18, 0.04); inner.position.set(0, 0.1, 0.03);
    ear.add(outer, inner);
    r.ears.push(ear);
    r.head.add(e, ear);
  }
  r.hat.position.set(0, 0.2, 0.02);
  r.neck.position.set(0, 0.42, 0.24);
  r.head.add(r.hat);
  r.body.add(r.neck);
  return r;
}

// ---------- 橘貓 ----------
function buildCat(): Rig {
  const r = blankRig('prowl');
  const fur = rim('#f2a450'), stripe = mat('#d9772e', { roughness: 0.8 }), white = rim('#fff6ea');
  const pink = mat('#ff9fae', { roughness: 0.8 });
  const torso = mesh(GEO.capsule, fur);
  torso.scale.set(0.34, 0.36, 0.34); torso.rotation.x = Math.PI / 2; torso.position.set(0, 0.36, 0);
  const chest = mesh(GEO.sphere, white); chest.scale.set(0.26, 0.28, 0.24); chest.position.set(0, 0.34, 0.24);
  r.body.add(torso, chest);
  for (let i = 0; i < 4; i++) {
    const s = mesh(GEO.sphere, stripe, false);
    s.scale.set(0.3, 0.06, 0.08);
    s.position.set(0, 0.52, -0.2 + i * 0.13);
    s.rotation.x = 0.2;
    r.body.add(s);
  }
  legs4(r, fur, white, [[0.1, 0.2], [-0.1, 0.2], [0.1, -0.2], [-0.1, -0.2]], 0.28, 0.1, 0.085);
  // 長尾巴：三節往上翹
  r.tail.position.set(0, 0.46, -0.36);
  let seg: THREE.Object3D = r.tail;
  for (let i = 0; i < 3; i++) {
    const piv = new THREE.Group();
    piv.position.y = i === 0 ? 0 : 0.16;
    piv.rotation.x = i === 0 ? -0.9 : 0.35;
    const m = mesh(GEO.capsule, i === 2 ? stripe : fur);
    m.scale.set(0.07, 0.08, 0.07);
    m.position.y = 0.08;
    piv.add(m);
    seg.add(piv);
    seg = piv;
  }
  r.body.add(r.tail);
  r.head.position.set(0, 0.66, 0.3);
  r.body.add(r.head);
  const skull = mesh(GEO.sphere, fur); skull.scale.set(0.46, 0.4, 0.4);
  const muzzle = mesh(GEO.sphere, white); muzzle.scale.set(0.22, 0.14, 0.16); muzzle.position.set(0, -0.08, 0.15);
  const nose = mesh(GEO.sphereLo, pink, false); nose.scale.set(0.05, 0.035, 0.04); nose.position.set(0, -0.03, 0.22);
  r.tongue = mesh(GEO.sphere, pink, false); r.tongue.scale.set(0.05, 0.02, 0.06); r.tongue.position.set(0, -0.13, 0.2);
  r.head.add(skull, muzzle, nose, r.tongue);
  const fStripe = mesh(GEO.sphere, stripe, false); fStripe.scale.set(0.06, 0.12, 0.06); fStripe.position.set(0, 0.14, 0.15);
  r.head.add(fStripe);
  for (const sx of [-1, 1]) {
    const e = eye(sx, 0.1, 0.03, 0.16, 1.1);
    r.eyes.push(e);
    const ear = new THREE.Group();
    ear.position.set(sx * 0.13, 0.15, 0); ear.rotation.z = -sx * 0.2;
    const outer = mesh(GEO.cone, fur); outer.scale.set(0.15, 0.18, 0.1); outer.position.y = 0.08;
    const inner = mesh(GEO.cone, pink, false); inner.scale.set(0.09, 0.12, 0.04); inner.position.set(0, 0.07, 0.04);
    ear.add(outer, inner);
    r.ears.push(ear);
    r.head.add(e, ear);
    // 鬍鬚
    for (let k = 0; k < 2; k++) {
      const w = mesh(GEO.cyl, WHITE_HL, false);
      w.scale.set(0.006, 0.2, 0.006);
      w.rotation.z = sx * (Math.PI / 2 - 0.12 + k * 0.2);
      w.position.set(sx * 0.14, -0.07 - k * 0.02, 0.18);
      r.head.add(w);
    }
  }
  r.hat.position.set(0, 0.2, 0);
  r.neck.position.set(0, 0.52, 0.26);
  r.head.add(r.hat);
  r.body.add(r.neck);
  return r;
}

// ---------- 垂耳兔 ----------
function buildBunny(): Rig {
  const r = blankRig('hop');
  const fur = rim('#f7efe4'), patch = rim('#d8b48a');
  const pink = mat('#ffaab8', { roughness: 0.8 });
  const torso = mesh(GEO.sphere, fur); torso.scale.set(0.5, 0.46, 0.56); torso.position.set(0, 0.27, -0.04);
  r.body.add(torso);
  const tail = mesh(GEO.sphere, mat('#ffffff', { roughness: 1 })); tail.scale.setScalar(0.15);
  r.tail.position.set(0, 0.3, -0.3);
  r.tail.add(tail);
  r.body.add(r.tail);
  // 前腳小、後腳大
  for (const [x, z, big] of [[0.1, 0.18, 0], [-0.1, 0.18, 0], [0.15, -0.1, 1], [-0.15, -0.1, 1]] as const) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.1, z);
    const f = mesh(GEO.sphere, fur);
    f.scale.set(big ? 0.14 : 0.09, big ? 0.1 : 0.12, big ? 0.28 : 0.1);
    f.position.set(0, -0.04, big ? 0.04 : 0);
    leg.add(f);
    r.legs.push(leg);
    r.body.add(leg);
  }
  r.head.position.set(0, 0.52, 0.18);
  r.body.add(r.head);
  const skull = mesh(GEO.sphere, fur); skull.scale.set(0.46, 0.42, 0.42);
  const cheekL = mesh(GEO.sphere, fur); cheekL.scale.set(0.14, 0.12, 0.12); cheekL.position.set(0.07, -0.08, 0.16);
  const cheekR = cheekL.clone(); cheekR.position.x = -0.07;
  const nose = mesh(GEO.sphereLo, pink, false); nose.scale.set(0.045, 0.035, 0.03); nose.position.set(0, -0.03, 0.21);
  r.head.add(skull, cheekL, cheekR, nose);
  for (const sx of [-1, 1]) {
    const e = eye(sx, 0.11, 0.04, 0.16, 1.05);
    r.eyes.push(e);
    // 垂下來的長耳朵
    const ear = new THREE.Group();
    ear.position.set(sx * 0.17, 0.13, 0);
    ear.rotation.set(0.15, 0, -sx * 2.62); // 往外、往下垂在臉頰兩側
    const outer = mesh(GEO.capsule, patch); outer.scale.set(0.12, 0.18, 0.07); outer.position.y = 0.18;
    const inner = mesh(GEO.capsule, pink, false); inner.scale.set(0.065, 0.13, 0.03); inner.position.set(0, 0.18, 0.035);
    ear.add(outer, inner);
    r.ears.push(ear);
    r.head.add(e, ear);
  }
  const spot = mesh(GEO.sphere, patch, false); spot.scale.set(0.16, 0.1, 0.14); spot.position.set(0, 0.17, 0.02);
  r.head.add(spot);
  r.hat.position.set(0, 0.2, 0);
  r.neck.position.set(0, 0.42, 0.22);
  r.head.add(r.hat);
  r.body.add(r.neck);
  return r;
}

// ---------- 小鴨 ----------
function buildDuck(): Rig {
  const r = blankRig('waddle');
  const yellow = rim('#ffd84a'), bill = mat('#ff9a2a', { roughness: 0.5 });
  const torso = mesh(GEO.sphere, yellow); torso.scale.set(0.46, 0.42, 0.52); torso.position.set(0, 0.3, 0);
  r.body.add(torso);
  r.tail.position.set(0, 0.42, -0.26);
  const t = mesh(GEO.cone, yellow); t.scale.set(0.12, 0.16, 0.08); t.rotation.x = -1.1; t.position.y = 0.04;
  r.tail.add(t);
  r.body.add(r.tail);
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.21, 0.36, 0);
    const m = mesh(GEO.sphere, yellow); m.scale.set(0.08, 0.2, 0.26); m.position.set(0, -0.02, -0.02); m.rotation.x = 0.3;
    w.add(m);
    r.wings.push(w);
    r.body.add(w);
    // 橘色蹼腳
    const leg = new THREE.Group();
    leg.position.set(sx * 0.1, 0.1, 0.02);
    const shin = mesh(GEO.cyl, bill); shin.scale.set(0.035, 0.1, 0.035); shin.position.y = -0.03;
    const foot = mesh(GEO.sphere, bill); foot.scale.set(0.12, 0.03, 0.15); foot.position.set(0, -0.08, 0.05);
    leg.add(shin, foot);
    r.legs.push(leg);
    r.body.add(leg);
  }
  r.head.position.set(0, 0.62, 0.14);
  r.body.add(r.head);
  const skull = mesh(GEO.sphere, yellow); skull.scale.set(0.38, 0.38, 0.36);
  const b = mesh(GEO.sphere, bill); b.scale.set(0.2, 0.07, 0.18); b.position.set(0, -0.05, 0.19);
  const tuft = mesh(GEO.cone, yellow); tuft.scale.set(0.06, 0.1, 0.06); tuft.position.set(0, 0.2, 0); tuft.rotation.x = -0.4;
  r.head.add(skull, b, tuft);
  for (const sx of [-1, 1]) {
    const e = eye(sx, 0.1, 0.05, 0.14, 0.95);
    r.eyes.push(e);
    r.head.add(e);
  }
  r.hat.position.set(0, 0.18, 0);
  r.neck.position.set(0, 0.5, 0.14);
  r.head.add(r.hat);
  r.body.add(r.neck);
  return r;
}

const BUILDERS: Record<Species, () => Rig> = { corgi: buildCorgi, cat: buildCat, bunny: buildBunny, duck: buildDuck };

// 小草帽（親密度 3 解鎖）、紅領巾（親密度 6 解鎖）
function makeHat(): THREE.Group {
  const straw = mat('#f2cf78', { roughness: 0.8 });
  const g = new THREE.Group();
  const brim = mesh(GEO.cyl, straw); brim.scale.set(0.34, 0.02, 0.34);
  const crown = mesh(GEO.sphere, straw); crown.scale.set(0.2, 0.14, 0.2); crown.position.y = 0.03;
  const band = mesh(GEO.cyl, mat('#e8504a')); band.scale.set(0.21, 0.03, 0.21); band.position.y = 0.03;
  g.add(brim, crown, band);
  g.rotation.x = -0.15;
  return g;
}
function makeBandana(): THREE.Group {
  const red = mat('#d8453c', { roughness: 0.7 });
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 18), red); ring.rotation.x = Math.PI / 2 - 0.4;
  const tri = mesh(GEO.cone, red); tri.scale.set(0.16, 0.16, 0.04); tri.rotation.x = Math.PI + 0.3; tri.position.set(0, -0.07, 0.1);
  g.add(ring, tri);
  return g;
}

export class Pet {
  root = new THREE.Group();
  mover: Mover;
  species: Species;
  name: string;
  state: PetState = 'idle';
  forcedAnim: PetAnim | null = null; // DEV：強制播放
  canRollOver = false; // 親密度 2：被摸時會翻肚
  private anim: PetAnim = 'idle';
  private stateT = 0;
  private repathT = 0;
  private walkPhase = 0;
  private scaler = new THREE.Group(); // 成長階段的整體縮放
  private rig!: Rig;
  private stage = 2;
  private growT = 1; // 成長過場動畫進度
  private fromStage = 2;
  private hatObj: THREE.Object3D | null = null;
  private bandanaObj: THREE.Object3D | null = null;
  private digTarget: { id: string; x: number; z: number } | null = null;
  private task: { x: number; z: number; anim: PetAnim; dur: number; onDone: () => void; arrived: boolean } | null = null;
  private blinkT = 3;
  private fxT = 0;
  private rollOver = false;
  onBark?: () => void;
  onDigTick?: (at: THREE.Vector3) => void;
  onDug?: (id: string, at: THREE.Vector3) => void;
  onZzz?: (at: THREE.Vector3) => void;

  constructor(grid: Grid, species: Species = 'corgi', name?: string) {
    this.mover = new Mover(this.root, grid);
    this.species = species;
    this.name = name ?? SPECIES[species].name;
    this.root.add(this.scaler);
    this.setSpecies(species);
  }

  setSpecies(species: Species): void {
    this.species = species;
    if (this.rig) this.scaler.remove(this.rig.body);
    this.rig = BUILDERS[species]();
    this.scaler.add(this.rig.body);
    this.hatObj = this.bandanaObj = null;
    this.applyGrowth(this.stage, true);
  }

  // 成長階段（0 幼年、1 少年、2 成年）；instant=false 時播成長過場
  setStage(stage: number, instant = false): void {
    if (stage === this.stage && instant) { this.applyGrowth(stage, true); return; }
    this.fromStage = this.stage;
    this.stage = stage;
    this.growT = instant ? 1 : 0;
    if (instant) this.applyGrowth(stage, true);
  }

  private applyGrowth(stage: number, force = false) {
    const k = force ? 1 : this.growT;
    const a = GROWTH[this.fromStage] ?? GROWTH[stage], b = GROWTH[stage];
    const e = k * k * (3 - 2 * k);
    this.scaler.scale.setScalar(lerp(a.scale, b.scale, e));
    this.rig.head.scale.setScalar(lerp(a.head, b.head, e));
    this.rig.eyes.forEach((ey) => { ey.scale.x = ey.scale.z = lerp(a.eye, b.eye, e); });
  }

  setAccessories(hat: boolean, bandana: boolean): void {
    if (hat && !this.hatObj) { this.hatObj = makeHat(); this.rig.hat.add(this.hatObj); }
    if (!hat && this.hatObj) { this.rig.hat.remove(this.hatObj); this.hatObj = null; }
    if (bandana && !this.bandanaObj) { this.bandanaObj = makeBandana(); this.rig.neck.add(this.bandanaObj); }
    if (!bandana && this.bandanaObj) { this.rig.neck.remove(this.bandanaObj); this.bandanaObj = null; }
  }

  react(): void {
    if (this.state === 'sleep' || this.state === 'petted' || this.state === 'task') return;
    this.mover.stop();
    this.state = 'react';
    this.stateT = 0;
    this.onBark?.();
  }

  startPetted(faceX: number, faceZ: number): void {
    this.mover.stop();
    this.mover.face(faceX, faceZ);
    this.state = 'petted';
    this.stateT = 0;
    this.task = null;
    this.rollOver = this.canRollOver && Math.random() < 0.45;
  }

  // 技能任務：走到定點、播動作、結束時回呼
  doTask(x: number, z: number, anim: PetAnim, dur: number, onDone: () => void): void {
    this.state = 'task';
    this.stateT = 0;
    this.task = { x, z, anim, dur, onDone, arrived: false };
    this.mover.speed = this.species === 'duck' ? 3.2 : 4.6;
    const ok = this.mover.goTo(x, z, () => { if (this.task) { this.task.arrived = true; this.stateT = 0; this.mover.face(x, z); } }, 0.45);
    if (!ok) { this.task = null; this.state = 'idle'; }
  }

  // 展示模式：不跑 AI，只播指定動作（選寵物畫面用）
  showcase(dt: number, anim: 'idle' | 'happy' | 'sit'): void {
    this.stateT += dt;
    this.anim = anim;
    this.animate(dt);
  }
  resetTimer(): void { this.stateT = 0; }

  get busy(): boolean { return this.state === 'task' || this.state === 'petted' || this.state === 'sleep' || this.state === 'dig'; }
  get busyWithPlayer(): boolean { return this.state === 'petted'; }
  get isGrowing(): boolean { return this.growT < 1; }

  update(dt: number, ctx: PetContext): void {
    this.stateT += dt;
    this.repathT -= dt;
    const p = this.root.position;
    const pp = ctx.player.root.position;
    const dist = Math.hypot(pp.x - p.x, pp.z - p.z);

    // 成長過場：慢慢長大並轉圈
    if (this.growT < 1) {
      this.growT = Math.min(1, this.growT + dt / 1.6);
      this.applyGrowth(this.stage);
    }

    // ---- AI 決策 ----
    if (this.state === 'react' && this.stateT > 0.9) this.state = 'idle';
    if (this.state === 'petted' && this.stateT > (this.rollOver ? 2.4 : 1.6)) this.state = 'idle';
    if (this.state === 'task' && this.task?.arrived && this.stateT > this.task.dur) {
      const cb = this.task.onDone;
      this.task = null;
      this.state = 'idle';
      this.stateT = 0;
      cb();
    }
    const locked = this.state === 'react' || this.state === 'petted' || this.state === 'task' || (this.state === 'dig' && this.digTarget && !this.mover.moving);
    if (!locked) {
      if (ctx.night) {
        if (this.state !== 'sleep') {
          this.state = 'sleep';
          const d = ctx.doghouse;
          this.mover.speed = 2.5;
          this.mover.goTo(d.x + Math.sin(d.rotY) * 1.1, d.z + Math.cos(d.rotY) * 1.1, () => this.mover.face(d.x, d.z));
        }
      } else {
        if (this.state === 'sleep') this.state = 'idle';
        const tr = ctx.treasures.find((t) => Math.hypot(t.x - pp.x, t.z - pp.z) < 7);
        if (tr && this.state !== 'dig') {
          this.state = 'dig';
          this.digTarget = tr;
          this.mover.speed = 5.5;
          this.mover.goTo(tr.x, tr.z, () => { this.stateT = 0; this.mover.face(tr.x, tr.z); }, 0.35);
          this.onBark?.();
        } else if (this.state !== 'dig') {
          const fd = ctx.followDist;
          if (dist > fd + 1.3 && (this.repathT <= 0 || !this.mover.moving)) {
            // 落後太多才跟上，停在主角斜後方 fd 公尺
            this.state = 'follow';
            this.repathT = 0.5;
            this.mover.speed = (dist > fd + 3 ? 6.2 : 4.2) * (this.species === 'duck' ? 0.8 : 1);
            const back = ctx.player.root.rotation.y + Math.PI + 0.7;
            this.mover.goTo(pp.x + Math.sin(back) * fd, pp.z + Math.cos(back) * fd, () => { this.state = 'idle'; this.stateT = 0; });
          } else if (dist < fd * 0.5 && !this.mover.moving && this.stateT > 0.8) {
            // 靠太近：自己退開一點，保持距離
            this.state = 'wander';
            this.mover.speed = 2.6;
            const ax = (p.x - pp.x) / (dist || 1), az = (p.z - pp.z) / (dist || 1);
            this.mover.goTo(pp.x + (ax || 1) * fd, pp.z + az * fd, () => { this.state = 'idle'; this.stateT = 0; this.mover.face(pp.x, pp.z); });
          } else if (this.state === 'idle' && ctx.player.idleTime > 4 && this.stateT > 3 && Math.random() < dt * 0.4) {
            this.state = 'wander';
            this.mover.speed = 2.2;
            const a = Math.random() * Math.PI * 2;
            const r = fd + 0.4 + Math.random() * 1.2;
            this.mover.goTo(pp.x + Math.cos(a) * r, pp.z + Math.sin(a) * r, () => { this.state = 'idle'; this.stateT = 0; });
          } else if (this.state === 'idle' && Math.random() < dt * 0.3) {
            this.mover.face(pp.x, pp.z);
          }
        }
      }
    }
    // 挖寶：到定點後挖 1.6 秒
    if (this.state === 'dig' && this.digTarget && !this.mover.moving) {
      if (!ctx.treasures.find((t) => t.id === this.digTarget!.id)) { this.digTarget = null; this.state = 'idle'; }
      else {
        this.fxT -= dt;
        if (this.fxT <= 0) { this.fxT = 0.12; this.onDigTick?.(new THREE.Vector3(this.digTarget.x, 0.1, this.digTarget.z)); }
        if (this.stateT > 1.6) {
          const id = this.digTarget.id;
          const at = new THREE.Vector3(this.digTarget.x, 0.3, this.digTarget.z);
          this.digTarget = null;
          this.state = 'react';
          this.stateT = 0;
          this.onDug?.(id, at);
        }
      }
    }
    this.mover.update(dt);

    // ---- 動畫 ----
    if (this.state === 'sleep' && !this.mover.moving) this.anim = 'sleep';
    else if (this.mover.moving) this.anim = 'walk';
    else if (this.state === 'react') this.anim = 'happy';
    else if (this.state === 'petted') this.anim = this.rollOver ? 'rollover' : 'petted';
    else if (this.state === 'dig') this.anim = 'dig';
    else if (this.state === 'task' && this.task?.arrived) this.anim = this.task.anim;
    else this.anim = this.stateT > 6 ? 'sit' : 'idle';
    if (this.growT < 1) this.anim = 'happy';
    if (this.forcedAnim) this.anim = this.forcedAnim;
    this.animate(dt);
    if (this.anim === 'sleep') {
      this.fxT -= dt;
      if (this.fxT <= 0) { this.fxT = 1.4; this.onZzz?.(this.rig.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0))); }
    }
  }

  private animate(dt: number) {
    const R = this.rig;
    const t = performance.now() / 1000;
    const k = 1 - Math.exp(-14 * dt);
    let bodyY = 0, pitch = 0, roll = 0, spin = 0, fwd = 0, headPitch = 0, headYaw = 0, tailSpeed = 6, tailAmp = 0.5, eyeOpen = 1, tongue = false, earFlop = 0, wing = 0;
    const legRot = [0, 0, 0, 0];
    const gait = R.gait;
    switch (this.anim) {
      case 'walk': {
        this.walkPhase += dt * this.mover.speed * (gait === 'hop' ? 2.2 : gait === 'waddle' ? 5.5 : 4.2);
        const s = Math.sin(this.walkPhase);
        if (gait === 'hop') {
          // 兔子：一跳一跳
          const h = Math.abs(Math.sin(this.walkPhase));
          bodyY = h * 0.2;
          pitch = -Math.cos(this.walkPhase) * 0.25;
          legRot[0] = legRot[1] = -h * 0.6;
          legRot[2] = legRot[3] = h * 0.8;
          earFlop = h * 0.4;
        } else if (gait === 'waddle') {
          // 小鴨：左右搖擺
          roll = s * 0.22;
          bodyY = Math.abs(s) * 0.03;
          legRot[0] = s * 0.6; legRot[1] = -s * 0.6;
          wing = Math.abs(s) * 0.3;
        } else {
          legRot[0] = legRot[3] = s * 0.8;
          legRot[1] = legRot[2] = -s * 0.8;
          bodyY = Math.abs(Math.cos(this.walkPhase)) * (gait === 'prowl' ? 0.02 : 0.05);
          if (gait === 'prowl') roll = s * 0.04;
        }
        tailSpeed = 14; tailAmp = gait === 'prowl' ? 0.25 : 0.6;
        tongue = gait === 'trot' && this.mover.speed > 5;
        break;
      }
      case 'idle':
        bodyY = Math.sin(t * 3) * 0.008;
        headYaw = Math.sin(t * 0.6) * 0.3;
        headPitch = Math.sin(t * 0.9) * 0.08;
        if (gait === 'hop') earFlop = Math.sin(t * 1.3) * 0.08;
        if (gait === 'prowl') tailAmp = 0.35;
        break;
      case 'sit':
        if (gait === 'waddle' || gait === 'hop') { bodyY = -0.04; headYaw = Math.sin(t * 0.5) * 0.3; }
        else {
          pitch = -0.38; bodyY = -0.02;
          legRot[2] = legRot[3] = -1.2; legRot[0] = legRot[1] = 0.3;
          headPitch = -0.15; headYaw = Math.sin(t * 0.5) * 0.25;
        }
        tailSpeed = 4;
        break;
      case 'happy': {
        const u = clamp(this.stateT / 0.9, 0, 1);
        bodyY = Math.sin(Math.PI * u) * 0.45;
        spin = (this.growT < 1 ? this.growT * 2 : u) * Math.PI * 2;
        legRot[0] = legRot[1] = -0.8 * Math.sin(Math.PI * u);
        legRot[2] = legRot[3] = 0.8 * Math.sin(Math.PI * u);
        tailSpeed = 22; tailAmp = 0.8; tongue = true; eyeOpen = 0.3;
        wing = 0.9 * Math.abs(Math.sin(t * 20));
        earFlop = 0.4;
        break;
      }
      case 'dig':
        pitch = 0.3; headPitch = 0.5;
        legRot[0] = Math.sin(t * 28) * 0.9; legRot[1] = -Math.sin(t * 28) * 0.9;
        tailSpeed = 18; tailAmp = 0.7;
        break;
      case 'pounce': {
        // 貓：伏低 → 撲出去
        const u = clamp(this.stateT / (this.task?.dur ?? 1), 0, 1);
        if (u < 0.45) { bodyY = -0.1; pitch = 0.15; tailAmp = 0.4; tailSpeed = 20; }
        else { const j = Math.sin(Math.PI * clamp((u - 0.45) / 0.4, 0, 1)); bodyY = j * 0.35; fwd = j * 0.5; pitch = -0.3 * j; legRot[0] = legRot[1] = -1.1 * j; legRot[2] = legRot[3] = 0.9 * j; }
        break;
      }
      case 'nibble':
        // 兔子：低頭啃，鼻子一抖一抖
        headPitch = 0.55 + Math.sin(t * 22) * 0.05;
        bodyY = -0.02;
        earFlop = 0.15;
        break;
      case 'splash':
        // 小鴨：拍翅膀潑水
        wing = 1.1 * Math.abs(Math.sin(t * 16));
        bodyY = Math.abs(Math.sin(t * 8)) * 0.05;
        headPitch = 0.2;
        break;
      case 'sleep':
        bodyY = gait === 'waddle' || gait === 'hop' ? -0.05 : -0.14 + Math.sin(t * 1.6) * 0.01;
        if (gait === 'trot' || gait === 'prowl') { legRot[0] = legRot[1] = -1.3; legRot[2] = legRot[3] = 1.3; }
        headPitch = 0.35; tailAmp = 0.05; eyeOpen = 0.12;
        break;
      case 'petted':
        if (gait === 'trot' || gait === 'prowl') {
          pitch = -0.38; bodyY = -0.02;
          legRot[2] = legRot[3] = -1.2; legRot[0] = legRot[1] = 0.3;
        }
        headPitch = -0.3; headYaw = Math.sin(t * 5) * 0.12;
        tailSpeed = 24; tailAmp = 0.8; eyeOpen = 0.18; tongue = true;
        wing = 0.3 * Math.abs(Math.sin(t * 10));
        break;
      case 'rollover':
        // 翻肚：躺平露出肚子，腳在空中亂踢
        roll = 2.6; bodyY = 0.12;
        legRot.forEach((_, i) => (legRot[i] = Math.sin(t * 12 + i) * 0.6));
        headYaw = Math.sin(t * 4) * 0.3; eyeOpen = 0.2; tongue = true; tailSpeed = 20;
        break;
    }
    const b = R.body;
    b.position.y = lerp(b.position.y, bodyY, k);
    b.position.z = lerp(b.position.z, fwd, k);
    b.rotation.x = lerp(b.rotation.x, pitch, k);
    b.rotation.z = lerp(b.rotation.z, roll, k);
    b.rotation.y = this.anim === 'happy' ? spin : lerp(b.rotation.y, 0, k);
    R.head.rotation.x = lerp(R.head.rotation.x, headPitch, k);
    R.head.rotation.y = lerp(R.head.rotation.y, headYaw, k);
    R.legs.forEach((l, i) => (l.rotation.x = lerp(l.rotation.x, legRot[i] ?? 0, k * 1.5)));
    R.tail.rotation.y = Math.sin(t * tailSpeed) * tailAmp;
    R.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * lerp(w.rotation.z * (i ? -1 : 1), wing, k * 2)));
    R.ears.forEach((e, i) => {
      if (R.gait === 'hop') e.rotation.z = (i ? 1 : -1) * (-2.62 + earFlop * 0.5);
      else e.rotation.x = Math.sin(t * 7 + i) * (this.anim === 'walk' ? 0.12 : 0.03);
    });
    if (R.tongue) R.tongue.visible = tongue;
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    const blink = this.blinkT < 0.1 ? 0.15 : 1;
    const eyeBase = GROWTH[this.stage].eye;
    R.eyes.forEach((e) => (e.scale.y = lerp(e.scale.y, Math.min(eyeOpen, blink) * eyeBase, k * 2)));
  }
}
