import * as THREE from 'three';

// 共用 uniform：風吹搖擺的時間
export const windUniforms = { uTime: { value: 0 } };

export function mat(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...opts });
}

// 輪廓光：讓角色剪影從背景跳出來（皮克斯常用的邊緣光）
export function withRim(m: THREE.MeshStandardMaterial, strength = 0.28, color = '#fff1dc', power = 2.6): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRimStrength;\nuniform vec3 uRimColor;\nuniform float uRimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPower);
          totalEmissiveRadiance += uRimColor * rimF * uRimStrength;
        }`,
      );
  };
  m.customProgramCacheKey = () => `rim-${strength}-${power}`;
  return m;
}

// 風吹搖擺：越高的頂點擺動越多（草、作物、樹葉）
export function withWind(m: THREE.MeshStandardMaterial, strength = 0.12): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wpos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wpos = instanceMatrix * wpos;
          #endif
          wpos = modelMatrix * wpos;
          float hgt = max(position.y, 0.0);
          float sw = sin(uTime * 1.8 + wpos.x * 0.35 + wpos.z * 0.22) + 0.35 * sin(uTime * 3.7 + wpos.x * 1.3);
          transformed.x += sw * uWind * hgt * hgt;
          transformed.z += cos(uTime * 1.5 + wpos.z * 0.4) * uWind * 0.6 * hgt * hgt;
        }`,
      );
  };
  m.customProgramCacheKey = () => `wind-${strength}`;
  return m;
}

// 共用幾何：避免每個物件重建
export const GEO = {
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  sphereLo: new THREE.SphereGeometry(0.5, 10, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 2),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  blade: (() => {
    const g = new THREE.ConeGeometry(0.035, 0.36, 4);
    g.translate(0, 0.18, 0);
    return g;
  })(),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 14),
};

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
