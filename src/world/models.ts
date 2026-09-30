import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Species } from '../actors/pet';

// Blender 匯出的角色 GLB（public/models/）：節點階層對齊程式動畫的樞紐
// 沒有檔案或載入失敗時，遊戲自動沿用程式建模
export const Models = {
  enabled: true,
  player: null as THREE.Object3D | null,
  pets: {} as Partial<Record<Species, THREE.Object3D>>,
  loaded: false,
};

const url = (f: string) => new URL(`models/${f}`, document.baseURI).href;

async function tryLoad(loader: GLTFLoader, file: string): Promise<THREE.Object3D | null> {
  try {
    const res = await fetch(url(file), { method: 'HEAD' });
    // 找不到檔案時，開發伺服器可能回傳 HTML 首頁：一律視為沒有模型
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const g = await loader.loadAsync(url(file));
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    return g.scene;
  } catch (e) {
    console.warn(`[模型] ${file} 載入失敗，沿用程式建模`, e);
    return null;
  }
}

export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const [player, corgi, cat, bunny, duck] = await Promise.all(
    ['char_player.glb', 'pet_corgi.glb', 'pet_cat.glb', 'pet_bunny.glb', 'pet_duck.glb'].map((f) => tryLoad(loader, f)),
  );
  Models.player = player;
  Models.pets = { ...(corgi && { corgi }), ...(cat && { cat }), ...(bunny && { bunny }), ...(duck && { duck }) };
  Models.loaded = true;
  const n = [player, corgi, cat, bunny, duck].filter(Boolean).length;
  if (n) console.info(`[模型] 載入 ${n} 個 GLB 角色`);
}

// 取出指定名稱的節點（找不到就回傳 null）
export const node = (root: THREE.Object3D, name: string): THREE.Object3D | null => root.getObjectByName(name) ?? null;
