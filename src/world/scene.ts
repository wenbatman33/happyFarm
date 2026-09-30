import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { N8AOPass } from 'n8ao';
import type { CameraLayout, LightTweaks } from '../config/layout';
import { clamp, lerp } from '../core/rng';

export type Quality = 'low' | 'medium' | 'high';

// 一天的光影關鍵影格（依現實時間插值）
interface Key {
  h: number; sun: string; sunI: number; elev: number; skyTop: string; skyHor: string;
  hemiSky: string; hemiGround: string; hemiI: number; fog: string; glow: number;
}
const NIGHT: Omit<Key, 'h'> = { sun: '#8fa6ff', sunI: 0.55, elev: 42, skyTop: '#0b1433', skyHor: '#26335e', hemiSky: '#3a4a86', hemiGround: '#151a30', hemiI: 0.38, fog: '#1f2b52', glow: 1 };
const DAY: Omit<Key, 'h'> = { sun: '#fff4e0', sunI: 3.0, elev: 58, skyTop: '#4f9fe8', skyHor: '#cfe9ff', hemiSky: '#c4e2ff', hemiGround: '#8c7b52', hemiI: 0.95, fog: '#d5ebff', glow: 0 };
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 5, ...NIGHT },
  { h: 6.2, sun: '#ffb48c', sunI: 1.5, elev: 9, skyTop: '#7d98d4', skyHor: '#ffc3aa', hemiSky: '#cbb9e8', hemiGround: '#6c5a4b', hemiI: 0.75, fog: '#f2c6b6', glow: 0.35 },
  { h: 8, ...DAY, sunI: 2.6, elev: 32, sun: '#fff0d8' },
  { h: 12, ...DAY },
  { h: 16, ...DAY, sunI: 2.7, elev: 36, sun: '#ffe6c2' },
  { h: 17.4, sun: '#ffae5c', sunI: 2.7, elev: 14, skyTop: '#6d8ed0', skyHor: '#ffc27c', hemiSky: '#ffd6a6', hemiGround: '#7c5c3c', hemiI: 0.82, fog: '#ffd09c', glow: 0.15 },
  { h: 18.6, sun: '#ff806c', sunI: 1.3, elev: 4, skyTop: '#3b4b8c', skyHor: '#f08c7c', hemiSky: '#8d7cb2', hemiGround: '#3b3142', hemiI: 0.68, fog: '#b07c8c', glow: 0.8 },
  { h: 19.6, ...NIGHT },
  { h: 24, ...NIGHT },
];

const c1 = new THREE.Color(), c2 = new THREE.Color();
const mixHex = (a: string, b: string, t: number, out: THREE.Color) => out.copy(c1.set(a)).lerp(c2.set(b), t);

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.28 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = length((vUv - 0.5) * vec2(1.1, 1.0));
    float v = smoothstep(0.82, 0.25, d); c.rgb *= mix(1.0 - uStrength, 1.0, v); gl_FragColor = c; }`,
};

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun = new THREE.DirectionalLight('#fff4e0', 3);
  hemi = new THREE.HemisphereLight('#c4e2ff', '#8c7b52', 0.9);
  fill = new THREE.DirectionalLight('#bcd4ff', 0.35);
  composer: EffectComposer;
  aoPass: any;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  vignette: ShaderPass;
  quality: Quality = 'high';
  glow = 0; // 夜間發光程度（窗戶、燈籠、螢火蟲）
  overcast = 0;

  // 鏡頭
  target = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  yawGoal = 0;
  dist = 23;
  cam: CameraLayout;

  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private fog = new THREE.Fog('#d5ebff', 50, 120);

  constructor(container: HTMLElement, cam: CameraLayout) {
    this.cam = cam;
    this.dist = cam.dist;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;

    this.camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.5, 400);
    this.scene.fog = this.fog;

    // 柔和反射用的環境貼圖（強度壓低，只給材質一點光澤）
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;

    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 90;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.fill);
    this.fill.position.set(-10, 8, -12);

    this.sky = this.makeSky();
    this.scene.add(this.sky);

    // 後製：AO（微縮模型感的關鍵）→ Bloom → 暗角 → 色調映射輸出
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.aoPass = new N8AOPass(this.scene, this.camera, 512, 512);
    this.aoPass.configuration.gammaCorrection = false;
    this.aoPass.configuration.aoRadius = 1.4;
    this.aoPass.configuration.distanceFalloff = 1.0;
    this.aoPass.configuration.intensity = 2.2;
    this.aoPass.configuration.color = new THREE.Color('#000000');
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.5, 1.35);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());

    this.setQuality(matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeSky() {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new THREE.Color('#4f9fe8') }, uHor: { value: new THREE.Color('#cfe9ff') }, uBot: { value: new THREE.Color('#9fc98a') } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uBot; varying vec3 vDir;
        void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(uHor, uTop, pow(clamp(y * 1.6, 0.0, 1.0), 0.7)) : mix(uHor, uBot, clamp(-y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    const s = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), m);
    s.renderOrder = -1;
    return s;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1);
    const size = q === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.aoPass.enabled = q !== 'low';
    this.renderPass.enabled = q === 'low';
    this.aoPass.configuration.halfRes = q === 'medium';
    this.bloom.enabled = q !== 'low';
    this.resize();
  }

  private lastW = 0;
  private lastH = 0;

  // 每幀檢查尺寸（有些環境轉向或縮放時不會觸發 resize 事件）
  checkResize(): boolean {
    if (window.innerWidth === this.lastW && window.innerHeight === this.lastH) return false;
    this.resize();
    return true;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // 依時段、天氣套用光影
  applyLighting(hour: number, overcastGoal: number, tw: LightTweaks, dt: number): void {
    this.overcast = lerp(this.overcast, overcastGoal, 1 - Math.exp(-dt * 1.5));
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((hour - a.h) / (b.h - a.h), 0, 1);
    const ov = this.overcast;
    const grey = '#9aa7b4';

    mixHex(a.sun, b.sun, t, this.sun.color);
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * (1 - 0.72 * ov) * tw.sunMul;
    mixHex(a.hemiSky, b.hemiSky, t, this.hemi.color);
    mixHex(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t) * (1 + 0.15 * ov) * tw.hemiMul;
    this.glow = lerp(a.glow, b.glow, t);

    const u = this.sky.material.uniforms;
    mixHex(a.skyTop, b.skyTop, t, u.uTop.value).lerp(c1.set(grey), ov * 0.7);
    mixHex(a.skyHor, b.skyHor, t, u.uHor.value).lerp(c1.set('#c3ccd4'), ov * 0.6);
    mixHex(a.fog, b.fog, t, this.fog.color).lerp(c1.set('#b8c2cb'), ov * 0.6);
    u.uBot.value.copy(this.fog.color);
    this.fog.near = lerp(50, 28, ov);
    this.fog.far = lerp(120, 80, ov);

    // 太陽方位：早上東、傍晚西，略偏向鏡頭這側讓房子正面受光；夜晚改成固定的月光
    const isNight = this.glow > 0.9;
    const elev = THREE.MathUtils.degToRad(lerp(a.elev, b.elev, t));
    const az = isNight ? 2.3 : Math.PI * clamp((hour - 6) / 12.5, 0, 1);
    const dir = new THREE.Vector3(Math.cos(az), 0, 0.65 + 0.2 * Math.sin(az)).normalize();
    dir.multiplyScalar(Math.cos(elev)).setY(Math.sin(elev)).normalize();
    this.sun.position.copy(this.target).addScaledVector(dir, 40);
    this.sun.target.position.copy(this.target);
    this.fill.intensity = 0.35 * (1 - this.glow * 0.5);

    this.renderer.toneMappingExposure = tw.exposure * (1 - this.glow * 0.22);
    this.aoPass.configuration.intensity = tw.aoIntensity;
    this.aoPass.configuration.aoRadius = tw.aoRadius;
    this.bloom.strength = tw.bloomStrength + this.glow * 0.25;
    this.bloom.threshold = tw.bloomThreshold;
    this.vignette.uniforms.uStrength.value = tw.vignette;
  }

  updateCamera(focus: THREE.Vector3, dt: number): void {
    const k = 1 - Math.exp(-this.cam.followDamp * dt);
    this.target.lerp(focus, k);
    // 鏡頭旋轉：取最短路徑轉到目標角度
    let d = this.yawGoal - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-8 * dt));
    this.dist = clamp(this.dist, this.cam.distMin, this.cam.distMax);
    const pitch = THREE.MathUtils.degToRad(this.cam.pitch + (this.dist - this.cam.dist) * 0.35);
    const horiz = Math.cos(pitch) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    const ahead = this.cam.lookAhead;
    this.camera.lookAt(this.target.x - Math.sin(this.yaw) * ahead, this.target.y + 0.6, this.target.z - Math.cos(this.yaw) * ahead);
    if (this.camera.fov !== this.cam.fov) {
      this.camera.fov = this.cam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    this.checkResize();
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }
}
