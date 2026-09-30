# -*- coding: utf-8 -*-
"""
預覽算圖：匯入 GLB（等於驗證遊戲拿到的東西）→ 擺遊戲裡的靜止姿勢 → EEVEE 柔和三點光
用法：
  Blender -b --python render_preview.py -- <glb> <輸出前綴> [--pose '{"ear_0":[0,0,2.62]}']
        [--hair short] [--nohat] [--views front,side] [--size 800] [--lineup]
姿勢旋轉用 Three.js 的 Euler (x, y, z)（弧度），會自動換算成 Blender 座標
"""
import bpy
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
import os
import json
import math
import argparse
import numpy as np
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import srgb2lin, hexrgb, arg_after_dashes  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('out')
ap.add_argument('--pose', default='{}')
ap.add_argument('--hair', default=None)
ap.add_argument('--nohat', action='store_true')
ap.add_argument('--views', default='front,side')
ap.add_argument('--size', type=int, default=800)
ap.add_argument('--lineup', action='store_true', help='主角六種髮型並排（預設不戴帽）')
ap.add_argument('--hat', action='store_true', help='並排時戴帽（檢查帽子與髮型穿模）')
ap.add_argument('--az', type=float, default=32.0)
ap.add_argument('--el', type=float, default=14.0)
ap.add_argument('--lens', type=float, default=70.0)
ap.add_argument('--margin', type=float, default=1.12)
ap.add_argument('--frame-node', default=None, help='只以某節點底下的網格取景（例如 head 特寫）')
args = ap.parse_args(arg_after_dashes())

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Three → Blender 的基底換算矩陣 C：Blender = C · Three
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def three_euler_to_blender(rx, ry, rz):
    """Three.js 預設 XYZ 順序：M = Rx·Ry·Rz"""
    Mx = Matrix.Rotation(rx, 3, 'X')
    My = Matrix.Rotation(ry, 3, 'Y')
    Mz = Matrix.Rotation(rz, 3, 'Z')
    Mt = Mx @ My @ Mz
    Mb = C @ Mt @ C.transposed()
    return Mb.to_euler('XYZ')


HAIRS = ['hair_short', 'hair_bob', 'hair_ponytail', 'hair_pigtails', 'hair_spiky', 'hair_bun']


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def find(objs, base):
    for o in objs:
        if o.name == base or o.name.split('.')[0] == base:
            return o
    return None


def set_visible(ob, vis):
    for o in [ob] + list(ob.children_recursive):
        o.hide_render = not vis
        o.hide_viewport = not vis


def pose(objs, pose_dict, hair=None, nohat=False):
    for name, r in pose_dict.items():
        o = find(objs, name)
        if o is None:
            print('  [姿勢] 找不到', name)
            continue
        o.rotation_mode = 'XYZ'
        o.rotation_euler = three_euler_to_blender(*r)
    if find(objs, 'hair_short') is not None:
        keep = 'hair_' + (hair or 'short')
        for h in HAIRS:
            o = find(objs, h)
            if o:
                set_visible(o, h == keep)
        hat = find(objs, 'hat')
        if hat:
            set_visible(hat, not nohat)


objs_all = []
if args.lineup:
    styles = ['short', 'bob', 'ponytail', 'pigtails', 'spiky', 'bun']
    for i, st in enumerate(styles):
        objs = import_glb(args.glb)
        root = [o for o in objs if o.parent is None][0]
        pose(objs, json.loads(args.pose), hair=st, nohat=not args.hat)
        root.location.x = (i - 2.5) * 0.95
        objs_all += objs
else:
    objs_all = import_glb(args.glb)
    pose(objs_all, json.loads(args.pose), hair=args.hair, nohat=args.nohat)

bpy.context.view_layer.update()

# 可見網格的包圍盒
pts = []
frame_set = None
if args.frame_node:
    fn = find(objs_all, args.frame_node)
    frame_set = set([fn] + list(fn.children_recursive))
for o in objs_all:
    if o.type == 'MESH' and not o.hide_render and (frame_set is None or o in frame_set):
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
P = np.array([tuple(p) for p in pts])
lo, hi = P.min(0), P.max(0)
center = Vector(((lo + hi) / 2).tolist())
radius = float(np.linalg.norm(hi - lo) / 2)
print('包圍盒', lo.round(3), hi.round(3))

# ---------- 地面 ----------
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new('ground')
gb = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
gb.inputs['Base Color'].default_value = (*srgb2lin(hexrgb('#f2eadc')), 1)
gb.inputs['Roughness'].default_value = 0.9
ground.data.materials.append(gm)

# ---------- 世界：背景淡米色，環境光偏天空藍（Is Camera Ray 分開） ----------
world = bpy.data.worlds.new('w')
scene.world = world
nt = world.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new('ShaderNodeOutputWorld')
lp = nt.nodes.new('ShaderNodeLightPath')
mixn = nt.nodes.new('ShaderNodeMixShader')
amb = nt.nodes.new('ShaderNodeBackground')
amb.inputs['Color'].default_value = (*srgb2lin(hexrgb('#dfe8f4')), 1)
amb.inputs['Strength'].default_value = 0.6
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = (*srgb2lin(hexrgb('#f6f1e8')), 1)
bg.inputs['Strength'].default_value = 1.0
nt.links.new(lp.outputs['Is Camera Ray'], mixn.inputs['Fac'])
nt.links.new(amb.outputs['Background'], mixn.inputs[1])
nt.links.new(bg.outputs['Background'], mixn.inputs[2])
nt.links.new(mixn.outputs['Shader'], out.inputs['Surface'])


# ---------- 三點光（太陽光無距離衰減，地面遠近亮度一致；角度大 → 柔和陰影） ----------
def sun(name, energy, color, az, el, angle_deg, shadow=True):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = energy
    ld.color = srgb2lin(hexrgb(color)).tolist()
    ld.angle = math.radians(angle_deg)
    ld.use_shadow = shadow
    lo_ = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo_)
    a, e = math.radians(az), math.radians(el)
    d = -Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    lo_.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return lo_


sun('key', 2.7, '#fff0dc', -40, 50, 18)
sun('fill', 1.0, '#dde8ff', 60, 22, 30, shadow=False)
sun('rim', 2.4, '#fff4e6', 165, 35, 12, shadow=False)

# ---------- 算圖設定 ----------
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
scene.render.resolution_x = args.size if not args.lineup else args.size * 2
scene.render.resolution_y = args.size
scene.render.film_transparent = False
try:
    scene.eevee.taa_render_samples = 64
except Exception:
    pass
for k, v in (('use_shadows', True), ('use_raytracing', True), ('use_fast_gi', True), ('shadow_ray_count', 3), ('shadow_step_count', 12)):
    try:
        setattr(scene.eevee, k, v)
    except Exception as ex:
        print('eevee 設定略過', k, ex)
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -0.2

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = args.lens
cam_data.sensor_width = 36
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

fov = 2 * math.atan(18 / args.lens)
aspect_w = 2.0 if args.lineup else 1.0

views = args.views.split(',')
for v in views:
    if v == 'front':
        az, el = args.az, args.el
    elif v == 'side':
        az, el = 90.0, 6.0
    elif v == 'back':
        az, el = 180 - args.az, args.el
    elif v == 'top':
        az, el = 20.0, 55.0
    else:
        az, el = 0.0, args.el
    a, e = math.radians(az), math.radians(el)
    dist = radius / math.sin(fov / 2) * args.margin
    if args.lineup:
        dist = (hi[0] - lo[0]) / 2 / math.tan(fov / 2) * 1.1 + 0.6
    dirv = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = center + dirv * dist
    cam.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'{args.out}_{v}.png'
    bpy.ops.render.render(write_still=True)
    print('已輸出', scene.render.filepath)
