# -*- coding: utf-8 -*-
"""
快樂農場角色建模共用工具（Blender 5.2 無頭模式）

建模方法：
  1. 先用少量四邊形做「籠子」(cage)：方盒球化 cage_box() 或沿路徑的管子 cage_tube()
  2. 細分曲面 Catmull-Clark 套用 2 級（Subdivision Surface modifier → 套用）
  3. 把細分後的頂點投影到 SDF（有號距離場）造型上：
       - ray：從骨架（點／線段／折線）往外射線，找第一個穿出表面的位置（適合圓滾滾的有機造型）
       - newton：往最近表面收（適合籠子已接近形狀的扁平件，例如帽簷）
     再做幾輪「沿表面切線方向」的鬆弛，讓網格分布均勻
  4. 可選頂點色（顏色由 SDF 區域決定，交界柔和）
所有造型座標一律用 Three.js 座標（Y 朝上、+Z 朝前、公尺）撰寫，建立網格時才換成 Blender 座標：
  Three (x, y, z) → Blender (x, −z, y)
"""
import bpy
import bmesh
import math
import os
import sys
import numpy as np
from mathutils import Matrix, Vector

# ============================================================
# 座標換算
# ============================================================

def t2b(a):
    """Three → Blender：(x, y, z) → (x, −z, y)"""
    a = np.asarray(a, dtype=np.float64)
    return np.stack([a[..., 0], -a[..., 2], a[..., 1]], axis=-1)


def b2t(a):
    """Blender → Three：(x, y, z) → (x, z, −y)"""
    a = np.asarray(a, dtype=np.float64)
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)


def V(*a):
    return np.array(a, dtype=np.float64)


# ============================================================
# 顏色
# ============================================================

def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """a、b 可為單色 (3,) 或每頂點 (N,3)；t 為 (N,)"""
    t = np.asarray(t)[:, None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


# ============================================================
# 旋轉矩陣（欄向量 = 區域座標軸在世界中的方向）
# ============================================================

def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def frame_from_axis(axis, up=(0, 0, 1)):
    """回傳 3x3：第 2 欄（y）= axis，第 3 欄（z）盡量貼近 up"""
    y = np.asarray(axis, float)
    y = y / np.linalg.norm(y)
    u = np.asarray(up, float)
    z = u - y * (u @ y)
    if np.linalg.norm(z) < 1e-6:
        z = np.array([1.0, 0, 0]) - y * y[0]
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], axis=1)


# ============================================================
# SDF 基本形（numpy 向量化，p 為 (N,3)）
# ============================================================

def _loc(p, c, R):
    q = p - np.asarray(c, float)
    if R is not None:
        q = q @ R  # 轉到區域座標
    return q


def sd_sphere(p, c, r):
    return np.linalg.norm(p - np.asarray(c, float), axis=1) - r


def sd_ellipsoid(p, c, r, R=None):
    """Inigo Quilez 的橢球近似距離（表面附近準確、符號正確）"""
    q = _loc(p, c, R)
    r = np.asarray(r, float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    d = k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)
    return np.where(k1 < 1e-9, -r.min(), d)


def sd_capsule(p, a, b, r):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    pa = p - a
    ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def sd_round_cone(p, a, b, r1, r2):
    """兩端半徑不同的圓錐膠囊（IQ）"""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    l2 = ba @ ba
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - y[:, None] * ba
    x2 = np.sum(xv * xv, axis=1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    r_a = np.sqrt(x2 + z2) * il2 - r2
    r_b = np.sqrt(x2 + y2) * il2 - r1
    r_c = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, r_a, np.where(np.sign(y) * a2 * y2 < k, r_b, r_c))


def sd_tube(p, pts, radii):
    """折線 + 每點半徑 → 一串圓錐膠囊的聯集（尾巴、手臂用）"""
    pts = np.asarray(pts, float)
    radii = np.broadcast_to(np.asarray(radii, float), (len(pts),))
    d = None
    for i in range(len(pts) - 1):
        di = sd_round_cone(p, pts[i], pts[i + 1], radii[i], radii[i + 1])
        d = di if d is None else np.minimum(d, di)
    return d


def sd_flat(p, sdf_fn, c, R, squash):
    """把任意 SDF 沿區域 z 軸壓扁（squash<1），用來做扁平耳朵、舌頭等"""
    q = _loc(p, c, R)
    q = q.copy()
    q[:, 2] /= squash
    return sdf_fn(q) * squash


def sd_round_cyl(p, c, radius, half_h, rnd, R=None):
    """圓角圓柱（帽簷、帽帶）：軸為區域 y"""
    q = _loc(p, c, R)
    dx = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - radius + rnd
    dy = np.abs(q[:, 1]) - half_h + rnd
    out = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2)
    return np.minimum(np.maximum(dx, dy), 0) + out - rnd


def sd_torus(p, c, big_r, small_r, R=None):
    """甜甜圈：環面在區域 xz 平面"""
    q = _loc(p, c, R)
    qx = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - big_r
    return np.sqrt(qx * qx + q[:, 1] ** 2) - small_r


def sd_plane(p, point, normal):
    """半空間：法向量那一側為外（正）"""
    n = np.asarray(normal, float)
    n = n / np.linalg.norm(n)
    return (p - np.asarray(point, float)) @ n


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sunion(ds, k):
    d = ds[0]
    for x in ds[1:]:
        d = smin(d, x, k)
    return d


# ============================================================
# 籠子（cage）產生器
# ============================================================

def cage_box(dims, center, radii, R=None, shape='sphere'):
    """
    方盒細分籠子：dims=(nx, ny, nz) 各軸切幾段
    shape: 'sphere' 球化、'cyl' xz 平面圓化（圓柱／圓盤）、'box' 原樣
    回傳 (頂點 (N,3) Three 世界座標, 面列表)
    """
    nx, ny, nz = dims
    idx = {}
    raw = []

    def vid(i, j, k):
        key = (i, j, k)
        if key not in idx:
            idx[key] = len(raw)
            raw.append((2.0 * i / nx - 1, 2.0 * j / ny - 1, 2.0 * k / nz - 1))
        return idx[key]

    faces = []
    for i in (0, nx):
        for j in range(ny):
            for k in range(nz):
                q = [vid(i, j, k), vid(i, j + 1, k), vid(i, j + 1, k + 1), vid(i, j, k + 1)]
                faces.append(q if i else q[::-1])
    for j in (0, ny):
        for i in range(nx):
            for k in range(nz):
                q = [vid(i, j, k), vid(i, j, k + 1), vid(i + 1, j, k + 1), vid(i + 1, j, k)]
                faces.append(q if j else q[::-1])
    for k in (0, nz):
        for i in range(nx):
            for j in range(ny):
                q = [vid(i, j, k), vid(i + 1, j, k), vid(i + 1, j + 1, k), vid(i, j + 1, k)]
                faces.append(q if k else q[::-1])
    u = np.array(raw, dtype=np.float64)
    x, y, z = u[:, 0], u[:, 1], u[:, 2]
    if shape == 'sphere':
        # 等面積的立方體→球面映射
        xs = x * np.sqrt(1 - y * y / 2 - z * z / 2 + y * y * z * z / 3)
        ys = y * np.sqrt(1 - z * z / 2 - x * x / 2 + z * z * x * x / 3)
        zs = z * np.sqrt(1 - x * x / 2 - y * y / 2 + x * x * y * y / 3)
        u = np.stack([xs, ys, zs], axis=1)
    elif shape == 'cyl':
        xs = x * np.sqrt(1 - z * z / 2)
        zs = z * np.sqrt(1 - x * x / 2)
        u = np.stack([xs, y, zs], axis=1)
    loc = u * np.asarray(radii, float)
    if R is not None:
        loc = loc @ np.asarray(R).T
    return loc + np.asarray(center, float), faces


def cage_tube(path, radii, ring=4, up=(0, 0, 1), closed=False, caps=True, twist=0.0):
    """
    沿折線的管狀籠子。radii: 每點半徑（純量或 (N,) 或 (N,2) 橢圓）
    ring: 每圈頂點數（4 或 8）
    """
    P = np.asarray(path, float)
    n = len(P)
    R = np.asarray(radii, float)
    if R.ndim == 0:
        R = np.full((n, 2), float(R))
    elif R.ndim == 1:
        R = np.stack([R, R], axis=1)
    # 切線
    T = np.zeros_like(P)
    for i in range(n):
        if closed:
            T[i] = P[(i + 1) % n] - P[(i - 1) % n]
        else:
            T[i] = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T[i] /= np.linalg.norm(T[i])
    # 平行傳輸座標框
    u = np.asarray(up, float)
    N0 = u - T[0] * (u @ T[0])
    if np.linalg.norm(N0) < 1e-6:
        N0 = np.array([1.0, 0, 0]) - T[0] * T[0][0]
    N0 /= np.linalg.norm(N0)
    Ns = [N0]
    for i in range(1, n):
        a, b = T[i - 1], T[i]
        v = np.cross(a, b)
        s = np.linalg.norm(v)
        Nprev = Ns[-1]
        if s < 1e-9:
            Ns.append(Nprev)
            continue
        v /= s
        ang = math.atan2(s, a @ b)
        # Rodrigues 旋轉
        Nn = Nprev * math.cos(ang) + np.cross(v, Nprev) * math.sin(ang) + v * (v @ Nprev) * (1 - math.cos(ang))
        Ns.append(Nn)
    verts = []
    for i in range(n):
        Nn = Ns[i]
        B = np.cross(T[i], Nn)
        for k in range(ring):
            th = 2 * math.pi * k / ring + math.pi / ring + twist
            verts.append(P[i] + Nn * math.cos(th) * R[i, 0] + B * math.sin(th) * R[i, 1])
    faces = []
    segs = n if closed else n - 1
    for i in range(segs):
        i2 = (i + 1) % n
        for k in range(ring):
            k2 = (k + 1) % ring
            faces.append([i * ring + k, i * ring + k2, i2 * ring + k2, i2 * ring + k])
    verts = list(verts)
    if caps and not closed:
        for end, flip in ((0, True), (n - 1, False)):
            base = end * ring
            if ring == 4:
                f = [base + 0, base + 1, base + 2, base + 3]
                faces.append(f[::-1] if flip else f)
            else:
                c = len(verts)
                verts.append(P[end].copy())
                for k in range(0, ring, 2):
                    f = [base + k, base + (k + 1) % ring, base + (k + 2) % ring, c]
                    faces.append(f[::-1] if flip else f)
    return np.array(verts), faces


# ============================================================
# 投影
# ============================================================

def closest_on_polyline(P, S):
    S = np.asarray(S, float).reshape(-1, 3)
    if len(S) == 1:
        return np.repeat(S, len(P), axis=0)
    best = np.zeros_like(P)
    bestd = np.full(len(P), np.inf)
    for a, b in zip(S[:-1], S[1:]):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        C = a + t[:, None] * ab
        d = np.linalg.norm(P - C, axis=1)
        m = d < bestd
        best[m] = C[m]
        bestd[m] = d[m]
    return best


def grad(sdf, P, e=1e-4):
    g = np.zeros_like(P)
    for k in range(3):
        dp = np.zeros(3)
        dp[k] = e
        g[:, k] = (sdf(P + dp) - sdf(P - dp)) / (2 * e)
    return g


def newton(P, sdf, iters=3):
    for _ in range(iters):
        d = sdf(P)
        g = grad(sdf, P)
        gg = np.sum(g * g, axis=1) + 1e-12
        P = P - (d / gg)[:, None] * g
    return P


def ray_project(P, skel, sdf, tmax=None, steps=260, name=''):
    """從骨架最近點往外射線，找第一次穿出表面的位置"""
    O = closest_on_polyline(P, skel)
    D = P - O
    L = np.linalg.norm(D, axis=1)
    bad = L < 1e-9
    D[bad] = (0, 1, 0)
    L[bad] = 1
    D /= L[:, None]
    inside = sdf(O) < 0
    if not inside.all():
        print(f'  [警告] {name}: {int((~inside).sum())} 個射線起點不在造型內')
    if tmax is None:
        tmax = 2.5 * float(L.max()) + 0.05
    ts = np.linspace(0, tmax, steps)
    lo = np.zeros(len(P))
    hi = np.full(len(P), tmax)
    found = np.zeros(len(P), bool)
    prev = 0.0
    for t in ts[1:]:
        idx = np.where(~found)[0]
        if len(idx) == 0:
            break
        d = sdf(O[idx] + D[idx] * t)
        hit = idx[d > 0]
        lo[hit] = prev
        hi[hit] = t
        found[hit] = True
        prev = t
    if not found.all():
        print(f'  [警告] {name}: {int((~found).sum())} 條射線未穿出（tmax 太小？）')
    for _ in range(32):
        mid = (lo + hi) * 0.5
        out = sdf(O + D * mid[:, None]) > 0
        hi = np.where(out, mid, hi)
        lo = np.where(out, lo, mid)
    return O + D * ((lo + hi) * 0.5)[:, None]


def relax(P, E, sdf, w=0.35):
    """沿表面切線方向的拉普拉斯鬆弛"""
    acc = np.zeros_like(P)
    cnt = np.zeros(len(P))
    np.add.at(acc, E[:, 0], P[E[:, 1]])
    np.add.at(acc, E[:, 1], P[E[:, 0]])
    np.add.at(cnt, E[:, 0], 1)
    np.add.at(cnt, E[:, 1], 1)
    avg = acc / np.maximum(cnt, 1)[:, None]
    disp = avg - P
    g = grad(sdf, P)
    n = g / (np.linalg.norm(g, axis=1)[:, None] + 1e-12)
    disp -= np.sum(disp * n, axis=1)[:, None] * n
    return P + w * disp


# ============================================================
# 網格工具
# ============================================================

def _get_co(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def _set_co(me, co):
    me.vertices.foreach_set('co', np.asarray(co, dtype=np.float64).ravel())
    me.update()


def _edges(me):
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def _vnormals(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertex_normals.foreach_get('vector', a)
    return a.reshape(-1, 3)


def subdivide(me, levels):
    """套用 Catmull-Clark 細分（用 Subdivision Surface modifier 求值後取出網格）"""
    tmp = bpy.data.objects.new('_subd_tmp', me)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new('subd', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    mod.quality = 3
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(me)
    return me2


def recalc_normals(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()


def mesh_from(verts_t, faces, name='cage'):
    me = bpy.data.meshes.new(name)
    me.from_pydata(t2b(verts_t).tolist(), [], [list(f) for f in faces])
    me.update()
    return me


def build(cage, sdf=None, skel=None, levels=2, project='ray', relax_iters=2, relax_w=0.35,
          color=None, tmax=None, name='part'):
    """
    cage: (verts, faces)（Three 世界座標）
    回傳 Blender mesh（頂點為 Blender 世界座標，之後由 Rig.part 轉成相對樞紐）
    color(P, N) → (N,3) sRGB 0..1；P、N 為 Three 世界座標
    """
    verts, faces = cage
    me = mesh_from(verts, faces, name)
    if levels > 0:
        me = subdivide(me, levels)
    P = b2t(_get_co(me))
    if sdf is not None:
        if project == 'ray':
            P = ray_project(P, skel if skel is not None else P.mean(0, keepdims=True), sdf, tmax=tmax, name=name)
            P = newton(P, sdf, 2)
        else:
            P = newton(P, sdf, 8)
        E = _edges(me)
        for _ in range(relax_iters):
            P = relax(P, E, sdf, relax_w)
            P = newton(P, sdf, 3)
    _set_co(me, t2b(P))
    recalc_normals(me)
    me.shade_smooth()
    if color is not None:
        N = b2t(_vnormals(me))
        rgb = np.clip(np.asarray(color(P, N), float), 0, 1)
        if rgb.ndim == 1:
            rgb = np.tile(rgb, (len(P), 1))
        lin = srgb2lin(rgb)
        rgba = np.concatenate([lin, np.ones((len(P), 1))], axis=1)
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', rgba.ravel())
        me.color_attributes.active_color = attr
    return me


def join_meshes(mes):
    """把多個 mesh 合成一個（同一材質的小零件，例如肉球）"""
    bm = bmesh.new()
    for me in mes:
        bm.from_mesh(me)
    out = bpy.data.meshes.new('joined')
    bm.to_mesh(out)
    bm.free()
    for me in mes:
        bpy.data.meshes.remove(me)
    out.shade_smooth()
    return out


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ============================================================
# 材質（只用 Principled BSDF → 匯出成 MeshStandardMaterial）
# ============================================================

def material(name, color='#ffffff', rough=0.6, metal=0.0, emit=None, emit_strength=0.0, vcol=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    lin = srgb2lin(hexrgb(color))
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit is not None:
        el = srgb2lin(hexrgb(emit))
        bsdf.inputs['Emission Color'].default_value = (*el, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if vcol:
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    m.diffuse_color = (*lin, 1.0)
    return m


# ============================================================
# 節點階層
# ============================================================

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


class Rig:
    """管理 Empty 樞紐與掛在底下的剛體網格"""

    def __init__(self, name):
        reset_scene()
        self.name = name
        self.nodes = {}  # 名稱 → (物件, Three 世界座標)
        self.parts = []
        self.col = bpy.context.scene.collection

    def world(self, name):
        return self.nodes[name][1].copy()

    def empty(self, name, parent=None, pos=(0, 0, 0)):
        """pos 為相對父節點的 Three 座標；Empty 旋轉 0、縮放 1"""
        pw = self.nodes[parent][1] if parent else np.zeros(3)
        world = pw + np.asarray(pos, float)
        ob = bpy.data.objects.new(name, None)
        ob.empty_display_type = 'PLAIN_AXES'
        ob.empty_display_size = 0.04
        self.col.objects.link(ob)
        if parent:
            ob.parent = self.nodes[parent][0]
        ob.location = Vector(t2b(world - pw).tolist())
        ob.rotation_euler = (0, 0, 0)
        ob.scale = (1, 1, 1)
        self.nodes[name] = (ob, world)
        return name

    def part(self, name, parent, me, mat, origin=None):
        """
        把網格掛到 parent 底下。預設網格物件原點 = 樞紐（區域變換為單位矩陣）
        origin：相對 parent 的偏移（例如舌頭要有自己的節點位置）
        """
        pob, pw = self.nodes[parent]
        off = np.zeros(3) if origin is None else np.asarray(origin, float)
        me.transform(Matrix.Translation(Vector(t2b(-(pw + off)).tolist())))
        me.name = name
        # 清空材質槽會把面的材質索引歸零，先存起來再還原
        idx = np.zeros(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get('material_index', idx)
        me.materials.clear()
        mats = mat if isinstance(mat, (list, tuple)) else [mat]
        for m in mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', idx)
        me.update()
        ob = bpy.data.objects.new(name, me)
        self.col.objects.link(ob)
        ob.parent = pob
        ob.location = Vector(t2b(off).tolist())
        self.parts.append(ob)
        return ob

    def stats(self, groups=None):
        total = 0
        rows = []
        for ob in self.parts:
            t = tri_count(ob.data)
            total += t
            rows.append((ob.name, ob.parent.name, t))
        rows.sort(key=lambda r: -r[2])
        print(f'==== {self.name} 三角面統計 ====')
        for r in rows:
            print(f'  {r[0]:<28} ← {r[1]:<14} {r[2]:>6}')
        print(f'  合計 {total}')
        return total, rows

    def export(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # 確認所有 Empty 旋轉 0、縮放 1
        for ob in bpy.data.objects:
            if ob.type == 'EMPTY':
                assert tuple(ob.rotation_euler) == (0, 0, 0), ob.name
                assert tuple(ob.scale) == (1, 1, 1), ob.name
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  export_animations=False, export_materials='EXPORT')
        print(f'已匯出 {path}  {os.path.getsize(path) / 1024:.1f} KB')


def arg_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(PROJECT, 'public', 'models')
PREVIEW = os.path.join(PROJECT, 'concept', 'models_preview')


# ============================================================
# 共用零件
# ============================================================

def normalize(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def frame_zy(zdir, up=(0, 1, 0)):
    """3x3 座標框：區域 z = zdir，區域 y 盡量朝 up"""
    z = normalize(zdir)
    x = np.cross(np.asarray(up, float), z)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([1.0, 0, 0])
    x = normalize(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def ellipsoid_part(c, r, R=None, dims=(1, 1, 1), levels=2, name='ell', color=None):
    """單一橢球零件（眼睛、鈕扣、肉球…）"""
    c = np.asarray(c, float)
    r = np.asarray(r, float) if np.ndim(r) else np.array([r, r, r], float)
    sdf = lambda p: sd_ellipsoid(p, c, r, R)
    return build(cage_box(dims, c, r, R), sdf, skel=c[None], levels=levels, relax_iters=1, name=name, color=color)


def add_eye(rig, name, head, rel, radii, eye_mat, hl_mat, look=(0, 0, 1), spread=0.35,
            hl_dir=(0.42, 0.52, 0.74), hl_r=0.012, hl_sink=0.25, hl_levels=1):
    """
    眼睛 = eye Empty 底下：黑色光亮橢球 + 白色高光小球（遊戲會壓扁 eye 的 scale.y 眨眼）
    眼球的扁平方向朝「頭心→眼睛」與正前方的混合方向
    """
    rig.empty(name, head, rel)
    c = rig.world(name)
    hc = rig.world(head)
    out = normalize(normalize(c - hc) * spread + np.asarray(look, float))
    R = frame_zy(out)
    radii = np.asarray(radii, float)
    me = ellipsoid_part(c, radii, R, name=name + '_ball')
    rig.part(name + '_ball', name, me, eye_mat)
    # 高光：沿固定世界方向（左右眼一致，像同一盞光）找眼球表面，再往內沉一點
    d = normalize(hl_dir)
    q = d @ R  # 區域方向
    t = 1.0 / np.linalg.norm(q / radii)
    hp = c + d * (t - hl_r * hl_sink * 2)
    me = ellipsoid_part(hp, hl_r, levels=hl_levels, name=name + '_hl')
    rig.part(name + '_hl', name, me, hl_mat)
    return name


def tube_part(path, radius, levels=1, ring=4, name='tube', project=True, color=None):
    """細管（嘴巴線條、鬍鬚）：沿折線的圓管，端點圓頭"""
    path = np.asarray(path, float)
    rad = np.broadcast_to(np.asarray(radius, float), (len(path),))
    cage = cage_tube(path, rad * 1.3, ring=ring)
    sdf = (lambda p: sd_tube(p, path, rad)) if project else None
    return build(cage, sdf, skel=path, levels=levels, relax_iters=0, name=name, color=color)


def surface_point(sdf, origin, direction, tmax=0.6):
    """從 origin 沿 direction 射線找表面點（用來把五官貼到臉上）"""
    o = np.asarray(origin, float)[None]
    d = normalize(direction)
    P = ray_project(o + d[None] * 0.01, o, sdf, tmax=tmax, name='surface_point')
    return P[0]


def cage_capsule(skel, radius, ring=4, ext=None, up=(0, 0, 1), end_scale=0.55):
    """
    沿骨架折線的膠囊籠子：兩端各多延伸一圈（超過骨架端點），
    細分後端蓋才會落在骨架端點「外側」，射線投影才打得到圓頭。
    radius: 純量、(N,) 或 (N,2)（每個骨架點的半徑，可為橢圓）
    """
    S = np.asarray(skel, float).reshape(-1, 3)
    n = len(S)
    R = np.asarray(radius, float)
    if R.ndim == 0:
        R = np.full((n, 2), float(R))
    elif R.ndim == 1:
        R = np.stack([R, R], axis=1)
    d0 = normalize(S[0] - S[1])
    d1 = normalize(S[-1] - S[-2])
    e0 = R[0].mean() if ext is None else ext
    e1 = R[-1].mean() if ext is None else ext
    path = np.vstack([S[0] + d0 * e0 * 0.75, S, S[-1] + d1 * e1 * 0.75])
    radii = np.vstack([R[0] * end_scale, R, R[-1] * end_scale])
    return cage_tube(path, radii, ring=ring, up=up)


def polyline_param(P, path):
    """每個點在折線上最近位置的弧長（用來畫尾巴環紋）與總長"""
    S = np.asarray(path, float)
    seg_len = np.linalg.norm(S[1:] - S[:-1], axis=1)
    cum = np.concatenate([[0], np.cumsum(seg_len)])
    best_s = np.zeros(len(P))
    bestd = np.full(len(P), np.inf)
    for i, (a, b) in enumerate(zip(S[:-1], S[1:])):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        m = d < bestd
        bestd[m] = d[m]
        best_s[m] = cum[i] + t[m] * seg_len[i]
    return best_s, cum[-1]


def quad_leg(rig, i, length, r_top, r_ankle, paw_r, fur_mat, pad_mat, color_fn, sole=0.006,
             paw_fwd=0.022, pads=True, pad_scale=1.0):
    """
    四足寵物的腿：圓錐腿＋圓腳掌（平底）＋腳底粉紅肉球（主肉球＋3 顆小肉球）
    length：樞紐到腳掌中心的距離
    """
    name = f'leg_{i}'
    L = rig.world(name)
    top = L + V(0, 0.03, 0)
    ank = L + V(0, -length + paw_r[1] * 0.9, paw_fwd * 0.2)
    paw = L + V(0, -length, paw_fwd)

    def leg_sdf(p):
        d = sd_round_cone(p, top, ank, r_top, r_ankle)
        d = smin(d, sd_ellipsoid(p, paw, paw_r), 0.03)
        return smax(d, sd_plane(p, V(0, sole, 0), V(0, -1, 0)), 0.012)  # 平腳底

    sk = [L + V(0, 0.035, 0), paw + V(0, 0.004, 0)]
    me = build(cage_capsule(sk, [r_top, max(paw_r[0], paw_r[2])]), leg_sdf, skel=sk, color=color_fn, name=name)
    rig.part(name + '_mesh', name, me, fur_mat)
    if pads:
        s = pad_scale
        ps = [ellipsoid_part(V(paw[0], sole + 0.0035, paw[2] - 0.016 * s), V(0.03, 0.007, 0.024) * s, levels=1)]
        for dx in (-0.03, 0.0, 0.03):
            ps.append(ellipsoid_part(V(paw[0] + dx * s, sole + 0.0025, paw[2] + (0.034 - abs(dx) * 0.35) * s),
                                     V(0.0125, 0.006, 0.0125) * s, levels=1))
        rig.part(name + '_pads', name, join_meshes(ps), pad_mat)
    return leg_sdf



def cast_rays(O, D, sdf, tmax, steps=200, outside_in=False):
    """
    逐點射線：O 起點、D 方向（皆 (N,3)）
    outside_in=False：起點在內部，找第一次穿出；True：從 O+D*tmax 往回找第一次進入（= 最外層表面）
    """
    O = np.asarray(O, float)
    D = np.asarray(D, float)
    D = D / np.linalg.norm(D, axis=1)[:, None]
    if outside_in:
        O = O + D * tmax
        D = -D
    ts = np.linspace(0, tmax, steps)
    lo = np.zeros(len(O))
    hi = np.full(len(O), tmax)
    found = np.zeros(len(O), bool)
    prev = 0.0
    for t in ts[1:]:
        idx = np.where(~found)[0]
        if len(idx) == 0:
            break
        d = sdf(O[idx] + D[idx] * t)
        hit = idx[(d < 0) if outside_in else (d > 0)]
        lo[hit] = prev
        hi[hit] = t
        found[hit] = True
        prev = t
    for _ in range(32):
        mid = (lo + hi) * 0.5
        d = sdf(O + D * mid[:, None])
        out = (d < 0) if outside_in else (d > 0)
        hi = np.where(out, mid, hi)
        lo = np.where(out, lo, mid)
    return O + D * ((lo + hi) * 0.5)[:, None]


def surface_sheet(nu, nv, map_fn, levels=2, outward_sdf=None, name='sheet'):
    """
    貼在表面上的開放曲面片（胸前護片、吊帶）：
    在參數空間 (u,v)∈[0,1]² 直接建立「細分 levels 級」密度的網格（nu×nv 籠子 → 每格切 2^levels），
    每個頂點用解析函式 map_fn(U, V) → (N,3) 映射到 3D。背面藏在身體裡，不需要厚度。
    outward_sdf：用來確認面朝外（必要時整片翻面）
    """
    Nu, Nv = nu * 2 ** levels, nv * 2 ** levels
    U, W = np.meshgrid(np.linspace(0, 1, Nu + 1), np.linspace(0, 1, Nv + 1), indexing='ij')
    P = np.asarray(map_fn(U.ravel(), W.ravel()), float)
    faces = []
    for i in range(Nu):
        for j in range(Nv):
            a_ = i * (Nv + 1) + j
            faces.append([a_, a_ + Nv + 1, a_ + Nv + 2, a_ + 1])
    me = mesh_from(P, faces, name)
    if outward_sdf is not None:
        me.update()
        c = np.empty(len(me.polygons) * 3)
        me.polygons.foreach_get('center', c)
        n = np.empty(len(me.polygons) * 3)
        me.polygons.foreach_get('normal', n)
        Ct, Nt = b2t(c.reshape(-1, 3)), b2t(n.reshape(-1, 3))
        g = grad(outward_sdf, Ct)
        if np.sum(np.sum(g * Nt, axis=1)) < 0:
            for poly in me.polygons:
                poly.flip()
            me.update()
    me.shade_smooth()
    return me
