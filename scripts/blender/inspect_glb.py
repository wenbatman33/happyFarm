# -*- coding: utf-8 -*-
"""
驗收：
  (A) 直接解析 GLB 的 JSON（= Three.js GLTFLoader 讀到的節點），比對 specs.py 的樞紐表
  (B) 用 Blender 重新匯入 GLB，列出所有節點、父子關係、位置（換回 Three 座標）、旋轉是否為 0
用法：Blender -b --python inspect_glb.py -- <glb> <規格名稱> [--json 輸出路徑]
"""
import bpy
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
import os
import json
import struct
import math
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from specs import SPECS, FORBIDDEN, PLAYER_MATERIALS  # noqa: E402
from farm_lib import arg_after_dashes  # noqa: E402

argv = arg_after_dashes()
path, key = argv[0], argv[1]
json_out = argv[argv.index('--json') + 1] if '--json' in argv else None
TOL = 0.01
problems = []


def read_glb(p):
    with open(p, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF', '不是 GLB'
    clen, ctype = struct.unpack_from('<I4s', data, 12)
    return json.loads(data[20:20 + clen].decode('utf-8'))


gl = read_glb(path)
nodes = gl['nodes']
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i
by_name = {n.get('name', f'#{i}'): i for i, n in enumerate(nodes)}

# 三角面數
acc = gl['accessors']
mesh_tris = []
for m in gl.get('meshes', []):
    t = 0
    for pr in m['primitives']:
        if 'indices' in pr:
            t += acc[pr['indices']]['count'] // 3
        else:
            t += acc[pr['attributes']['POSITION']]['count'] // 3
    mesh_tris.append(t)
total_tris = sum(mesh_tris[n['mesh']] for n in nodes if 'mesh' in n)
mat_names = [m.get('name') for m in gl.get('materials', [])]
has_vcol = any('COLOR_0' in pr['attributes'] for m in gl.get('meshes', []) for pr in m['primitives'])
exts = gl.get('extensionsUsed', [])

print(f'\n==== (A) GLB JSON：{os.path.basename(path)} ====')
print(f'檔案大小 {os.path.getsize(path) / 1024:.1f} KB，節點 {len(nodes)}，三角面 {total_tris}')
print('材質：', ', '.join(mat_names))
print('頂點色 COLOR_0：', '有' if has_vcol else '無', '；使用的擴充：', exts or '無')


def pname(i):
    return nodes[parent[i]].get('name') if i in parent else None


def is_identity_rot(n):
    q = n.get('rotation', [0, 0, 0, 1])
    return abs(q[0]) < 1e-6 and abs(q[1]) < 1e-6 and abs(q[2]) < 1e-6


def is_unit_scale(n):
    s = n.get('scale', [1, 1, 1])
    return all(abs(x - 1) < 1e-6 for x in s)


def tree(i, depth=0):
    n = nodes[i]
    t = n.get('translation', [0, 0, 0])
    kind = f"mesh({mesh_tris[n['mesh']]}△)" if 'mesh' in n else 'empty'
    flag = '' if is_identity_rot(n) and is_unit_scale(n) else '  ⚠ 旋轉/縮放非單位'
    print(f"  {'  ' * depth}{n.get('name')}  [{kind}]  t=({t[0]:+.3f}, {t[1]:+.3f}, {t[2]:+.3f}){flag}")
    for c in n.get('children', []):
        tree(c, depth + 1)


roots = gl['scenes'][gl.get('scene', 0)]['nodes']
print('節點樹（Three 座標，相對父節點）：')
for r in roots:
    tree(r)

spec = SPECS[key]
print('\n樞紐比對（容許 ±0.01）：')
for name, (par, pos) in spec.items():
    if name not in by_name:
        problems.append(f'缺少節點 {name}')
        print(f'  ✗ {name}：缺少')
        continue
    i = by_name[name]
    n = nodes[i]
    t = np.array(n.get('translation', [0, 0, 0]))
    err = float(np.abs(t - np.array(pos)).max())
    ok_par = pname(i) == par
    ok_rot = is_identity_rot(n) and is_unit_scale(n)
    is_empty = 'mesh' not in n or name == 'tongue'
    ok = err <= TOL and ok_par and ok_rot and is_empty
    if not ok:
        problems.append(f'{name}: 父={pname(i)} 誤差={err:.4f} 旋轉縮放單位={ok_rot}')
    print(f"  {'✓' if ok else '✗'} {name:<14} 父={str(pname(i)):<8} 位置=({t[0]:+.3f},{t[1]:+.3f},{t[2]:+.3f}) 誤差={err:.4f}")
for name in FORBIDDEN.get(key, []):
    if name in by_name:
        problems.append(f'不應存在的節點 {name}')
        print(f'  ✗ 不應存在：{name}')
# 所有節點（含網格）的旋轉縮放都要是單位
for i, n in enumerate(nodes):
    if not (is_identity_rot(n) and is_unit_scale(n)):
        problems.append(f"{n.get('name')} 旋轉/縮放不是單位")
if key == 'char_player':
    for m in PLAYER_MATERIALS:
        if m not in mat_names:
            problems.append(f'缺少材質 {m}')
    print('主角必要材質：', '全部存在' if all(m in mat_names for m in PLAYER_MATERIALS) else '有缺')
if key == 'pet_corgi' or key.startswith('pet_'):
    tongue = by_name.get('tongue')
    if tongue is not None:
        print('  tongue 節點：', 'mesh ✓' if 'mesh' in nodes[tongue] else '不是 mesh ✗')

# ============ (B) Blender 重新匯入 ============
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
bpy.context.view_layer.update()
print(f'\n==== (B) Blender 重新匯入：{len(bpy.data.objects)} 個物件 ====')


def b2t(v):
    return (v[0], v[2], -v[1])


rows = []
for ob in sorted(bpy.data.objects, key=lambda o: (o.parent.name if o.parent else '', o.name)):
    loc = b2t(ob.location)
    rot0 = all(abs(a) < 1e-5 for a in ob.rotation_euler) if ob.rotation_mode != 'QUATERNION' else \
        all(abs(a) < 1e-5 for a in ob.rotation_quaternion[1:])
    sc1 = all(abs(s - 1) < 1e-5 for s in ob.scale)
    rows.append((ob.name, ob.type, ob.parent.name if ob.parent else '-', loc, rot0, sc1))
for r in rows:
    if r[1] == 'EMPTY':
        print(f"  {r[0]:<16} EMPTY  父={r[2]:<8} Three位置=({r[3][0]:+.3f},{r[3][1]:+.3f},{r[3][2]:+.3f})  旋轉0={r[4]} 縮放1={r[5]}")
nm = sum(1 for r in rows if r[1] == 'MESH')
print(f'  （另有 {nm} 個網格物件，全部旋轉0={all(r[4] for r in rows if r[1] == "MESH")}）')

# 世界包圍盒（Three 座標）
pts = []
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        for v in ob.data.vertices:
            pts.append(ob.matrix_world @ v.co)
P = np.array([b2t(p) for p in pts])
lo, hi = P.min(0), P.max(0)
print(f'包圍盒（Three）：x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:+.3f}..{hi[1]:+.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}')

print('\n結果：', '全部通過 ✓' if not problems else '有問題 ✗')
for p in problems:
    print('  -', p)

if json_out:
    with open(json_out, 'w') as f:
        json.dump({'file': path, 'size_kb': round(os.path.getsize(path) / 1024, 1), 'tris': total_tris,
                   'materials': mat_names, 'vertex_color': has_vcol, 'problems': problems,
                   'bbox_three': [lo.round(3).tolist(), hi.round(3).tolist()],
                   'nodes': [{'name': n.get('name'), 'parent': pname(i), 'translation': n.get('translation', [0, 0, 0]),
                              'mesh_tris': mesh_tris[n['mesh']] if 'mesh' in n else None} for i, n in enumerate(nodes)]},
                  f, ensure_ascii=False, indent=1)
