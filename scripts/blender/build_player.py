# -*- coding: utf-8 -*-
"""
主角 Q 版小農夫 char_player.glb
吊帶褲（胸前護片＋兩條吊帶＋金色鈕扣）、上衣、短腿圓頭靴、手套般的小拳頭（有大拇指）、
大頭大眼、粉紅腮紅、小鼻子、張嘴笑、眉毛、耳朵、草帽（微下垂帽簷＋圓帽頂＋紅帽帶）、6 種髮型
材質名稱與遊戲對應：skin hair overall shirt shoe straw hatband eye eyeHighlight cheek button
（另有 mouth、hairTie 兩個額外材質）
用法：Blender -b --python build_player.py
"""
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import *  # noqa: F401,F403

rig = Rig('char_player')
M = {
    'skin': material('skin', '#ffd1b0', rough=0.62),
    'hair': material('hair', '#6b3f25', rough=0.6),
    'overall': material('overall', '#4a7bc8', rough=0.68),
    'shirt': material('shirt', '#e8604c', rough=0.66),
    'shoe': material('shoe', '#7a4a2e', rough=0.55),
    'straw': material('straw', '#f2cf78', rough=0.8),
    'hatband': material('hatband', '#d8453c', rough=0.6),
    'eye': material('eye', '#1e1512', rough=0.15),
    'eyeHighlight': material('eyeHighlight', '#ffffff', rough=0.3, emit='#ffffff', emit_strength=0.6),
    'cheek': material('cheek', '#ff9aa0', rough=0.9),
    'button': material('button', '#f2cf5a', rough=0.3, metal=0.5),
    'mouth': material('mouth', '#9a3a34', rough=0.6),
    'hairTie': material('hairTie', '#e8504a', rough=0.55),
}

# ---------------- 節點 ----------------
rig.empty('body')
rig.empty('legL', 'body', (0.12, 0.3, 0))
rig.empty('legR', 'body', (-0.12, 0.3, 0))
rig.empty('armL', 'body', (0.29, 0.86, 0))
rig.empty('armR', 'body', (-0.29, 0.86, 0))
rig.empty('handR', 'armR', (0, -0.36, 0.02))
rig.empty('head', 'body', (0, 0.95, 0))
rig.empty('hat', 'head', (0, 0.52, 0))
HAIRS = ['short', 'bob', 'ponytail', 'pigtails', 'spiky', 'bun']
for h in HAIRS:
    rig.empty(f'hair_{h}', 'head', (0, 0, 0))
H0 = rig.world('head')           # 頭的樞紐（脖子）
HC = H0 + V(0, 0.28, 0)          # 頭部球心
Y_WAIST = 0.70                   # 上衣／吊帶褲分界（剛好是一圈邊）

# ================= 身體：上衣＋吊帶褲同一個網格、兩個材質 =================


def torso_sdf(p):
    d = sd_ellipsoid(p, V(0, 0.52, 0.0), V(0.25, 0.25, 0.22))                       # 圓肚子
    d = smin(d, sd_ellipsoid(p, V(0, 0.76, -0.005), V(0.232, 0.2, 0.198)), 0.08)    # 胸
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(p, V(sx * 0.2, 0.85, 0.0), V(0.1, 0.075, 0.092)), 0.06)  # 圓肩膀（接手臂）
    d = smin(d, sd_capsule(p, V(0, 0.85, 0), V(0, 0.97, 0), 0.085), 0.05)          # 脖子（藏在頭下）
    for sx in (-1, 1):                                                             # 小圓領
        d = smin(d, sd_ellipsoid(p, V(sx * 0.07, 0.905, 0.125), V(0.07, 0.022, 0.05), rot_z(sx * 0.35)), 0.02)
    # 腰線以下的吊帶褲比上衣略鼓一點，形成褲頭的小段差
    return d - 0.008 * smoothstep(Y_WAIST + 0.012, Y_WAIST - 0.012, p[:, 1])


path = [V(0, y, 0) for y in (0.29, 0.55, Y_WAIST, 0.85, 0.98)]
radii = [(0.16, 0.14), (0.25, 0.22), (0.24, 0.21), (0.3, 0.19), (0.1, 0.1)]
me = build(cage_tube(path, radii, ring=8), torso_sdf, skel=[V(0, 0.33, 0), V(0, 0.93, 0)], relax_iters=0, name='torso')
# 依面中心高度分配材質：0 = 上衣、1 = 吊帶褲（Blender z = Three y）
for poly in me.polygons:
    poly.material_index = 1 if poly.center.z < Y_WAIST else 0
rig.part('torso', 'body', me, [M['shirt'], M['overall']])

# 胸前護片（吊帶褲的 bib）：貼體曲面片，中間浮起 1.2 cm，邊緣內收進上衣（背面藏在身體裡）
BIB_Y0, BIB_Y1 = 0.63, 0.9


def front_surface(x, y):
    """從 (x, y, 0) 往 +z 射線找軀幹前表面，回傳表面點與法線"""
    O = np.stack([x, y, np.zeros_like(x)], axis=1)
    S = cast_rays(O, np.tile([0, 0, 1.0], (len(x), 1)), torso_sdf, 0.5)
    n = grad(torso_sdf, S)
    return S, n / np.linalg.norm(n, axis=1)[:, None]


def bib_map(u, v):
    y = BIB_Y0 + v * (BIB_Y1 - BIB_Y0)
    half_w = 0.128 + (BIB_Y1 - y) * 0.12          # 上窄下寬
    x = (u - 0.5) * 2 * half_w
    S, n = front_surface(x, y)
    e = np.minimum(np.minimum(u, 1 - u) * 2 * half_w, np.minimum(v, 1 - v) * (BIB_Y1 - BIB_Y0))
    h = -0.006 + 0.018 * smoothstep(0.0, 0.016, e)  # 邊緣內收、中間浮起
    return S + n * h[:, None]


me = surface_sheet(3, 3, bib_map, outward_sdf=torso_sdf, name='bib')
rig.part('bib', 'body', me, M['overall'])

# 吊帶：從護片上角越過肩膀到背後（同樣是貼體曲面片，略高於護片，接縫由鈕扣蓋住）


def catmull(pts, t):
    """Catmull-Rom 曲線取樣"""
    pts = np.asarray(pts, float)
    n = len(pts) - 1
    t = np.clip(t, 0, 1) * n
    i = np.minimum(t.astype(int), n - 1)
    f = (t - i)[:, None]
    p0 = pts[np.maximum(i - 1, 0)]
    p1 = pts[i]
    p2 = pts[i + 1]
    p3 = pts[np.minimum(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


def strap_map_for(sx):
    ctrl = newton(np.array([V(sx * x, y, z) for x, y, z in ((0.108, 0.875, 0.2), (0.12, 0.925, 0.12), (0.125, 0.945, 0.0),
                                                              (0.122, 0.915, -0.12), (0.115, 0.82, -0.2), (0.11, 0.68, -0.21))]),
                  torso_sdf, 8)
    half_w = 0.024

    def f(u, v):
        C = catmull(ctrl, u)
        T = catmull(ctrl, np.minimum(u + 0.01, 1)) - catmull(ctrl, np.maximum(u - 0.01, 0))
        n = grad(torso_sdf, C)
        n /= np.linalg.norm(n, axis=1)[:, None]
        B = np.cross(T, n)
        B /= np.linalg.norm(B, axis=1)[:, None]
        Q = newton(C + B * ((v - 0.5) * 2 * half_w)[:, None], torso_sdf, 4)
        n2 = grad(torso_sdf, Q)
        n2 /= np.linalg.norm(n2, axis=1)[:, None]
        e = np.minimum(np.minimum(v, 1 - v) * 2 * half_w, np.minimum(u, 1 - u) * 0.9)
        h = -0.005 + 0.02 * smoothstep(0.0, 0.009, e)
        return Q + n2 * h[:, None]
    return f


straps = [surface_sheet(6, 1, strap_map_for(sx), outward_sdf=torso_sdf, name='strap') for sx in (-1, 1)]
rig.part('straps', 'body', join_meshes(straps), M['overall'])


# 金色鈕扣
btns = []
for sx in (-1, 1):
    s = surface_point(torso_sdf, V(0, 0.865, 0), (sx * 0.5, 0, 1))
    n = normalize(grad(torso_sdf, s[None])[0])
    c = s + n * 0.012
    btns.append(ellipsoid_part(c, V(0.026, 0.026, 0.011), frame_zy(n), levels=1))
rig.part('buttons', 'body', join_meshes(btns), M['button'])

# ================= 腿：褲管（反摺褲腳）＋圓頭靴 =================
for leg, sx in (('legL', 1), ('legR', -1)):
    L = rig.world(leg)
    x = L[0]

    def pant_sdf(p, L=L, x=x):
        d = sd_round_cone(p, L + V(0, 0.04, 0), L + V(0, -0.16, 0.0), 0.1, 0.082)
        return smin(d, sd_round_cyl(p, V(x, 0.15, 0), 0.094, 0.024, 0.016), 0.012)  # 反摺褲腳

    sk = [L + V(0, 0.045, 0), L + V(0, -0.165, 0)]
    me = build(cage_capsule(sk, [0.1, 0.095]), pant_sdf, skel=sk, name=leg + '_pant')
    rig.part(leg + '_pant', leg, me, M['overall'])

    def shoe_sdf(p, x=x):
        d = sd_ellipsoid(p, V(x, 0.068, 0.045), V(0.1, 0.072, 0.14))
        d = smin(d, sd_round_cone(p, V(x, 0.15, -0.01), V(x, 0.075, 0.0), 0.078, 0.09), 0.03)
        d = smin(d, sd_ellipsoid(p, V(x, 0.075, 0.12), V(0.085, 0.06, 0.07)), 0.03)   # 圓鞋頭
        return smax(d, sd_plane(p, V(0, 0.0, 0), V(0, -1, 0)), 0.012)               # 平鞋底

    me = build(cage_box((1, 1, 2), V(x, 0.08, 0.04), V(0.13, 0.11, 0.2)), shoe_sdf,
               skel=[V(x, 0.075, -0.03), V(x, 0.07, 0.11)], name=leg + '_shoe')
    rig.part(leg + '_shoe', leg, me, M['shoe'])

# ================= 手臂：袖子（反摺袖口）＋有大拇指的小拳頭 =================
for arm, sx in (('armL', 1), ('armR', -1)):
    A = rig.world(arm)

    def sleeve_sdf(p, A=A):
        d = sd_round_cone(p, A + V(0, 0.0, 0), A + V(0, -0.22, 0.0), 0.082, 0.066)
        return smin(d, sd_round_cyl(p, A + V(0, -0.245, 0), 0.074, 0.022, 0.016), 0.01)  # 袖口

    sk = [A + V(0, 0.01, 0), A + V(0, -0.255, 0)]
    me = build(cage_capsule(sk, [0.085, 0.075]), sleeve_sdf, skel=sk, name=arm + '_sleeve')
    rig.part(arm + '_sleeve', arm, me, M['shirt'])

    F = A + V(0, -0.34, 0.005)

    def hand_sdf(p, A=A, F=F, sx=sx):
        d = sd_ellipsoid(p, F, V(0.066, 0.072, 0.07))
        d = smin(d, sd_round_cone(p, A + V(0, -0.25, 0), F + V(0, 0.03, 0), 0.045, 0.05), 0.02)       # 手腕
        d = smin(d, sd_round_cone(p, F + V(-sx * 0.03, 0.025, 0.04), F + V(-sx * 0.036, 0.04, 0.078), 0.026, 0.021), 0.015)  # 大拇指
        return d

    me = build(cage_box((1, 1, 1), F + V(0, 0.01, 0.01), V(0.1, 0.11, 0.1)), hand_sdf, skel=F[None], name=arm + '_hand')
    rig.part(arm + '_hand', arm, me, M['skin'])

# ================= 頭 =================


def skull_sdf(p):
    q = p - H0
    d = sd_ellipsoid(q, V(0, 0.28, 0), V(0.345, 0.335, 0.335))
    d = smin(d, sd_ellipsoid(q, V(0, 0.15, 0.085), V(0.3, 0.19, 0.25)), 0.12)          # 圓潤的下半臉（嬰兒肥）
    d = smin(d, sd_ellipsoid(q, V(0, 0.05, 0.17), V(0.13, 0.08, 0.1)), 0.08)           # 下巴
    d = smin(d, sd_ellipsoid(q, V(0, 0.195, 0.322), V(0.036, 0.029, 0.027)), 0.02)       # 小鼻子
    return d


me = build(cage_box((3, 3, 3), H0 + V(0, 0.27, 0.02), V(0.42, 0.41, 0.42)), skull_sdf,
           skel=[H0 + V(0, 0.3, -0.05), H0 + V(0, 0.25, 0.08)], name='skull')
rig.part('skull', 'head', me, M['skin'])

add_eye(rig, 'eye_0', 'head', (-0.12, 0.27, 0.30), (0.055, 0.07, 0.034), M['eye'], M['eyeHighlight'],
        spread=0.28, hl_r=0.019)
add_eye(rig, 'eye_1', 'head', (0.12, 0.27, 0.30), (0.055, 0.07, 0.034), M['eye'], M['eyeHighlight'],
        spread=0.28, hl_r=0.019)

# 眉毛（hair 材質，跟著髮色換色）
brows = []
for sx in (-1, 1):
    pts = [surface_point(skull_sdf, HC, V(sx * x, y - 0.28, 0.3)) for x, y in ((0.075, 0.372), (0.12, 0.388), (0.165, 0.376))]
    brows.append(tube_part(pts, [0.012, 0.014, 0.011], name='brow'))
rig.part('brows', 'head', join_meshes(brows), M['hair'])

# 腮紅
cheeks = []
for sx in (-1, 1):
    s = surface_point(skull_sdf, HC, V(sx * 0.2, -0.115, 0.26))
    n = normalize(grad(skull_sdf, s[None])[0])
    cheeks.append(ellipsoid_part(s - n * 0.004, V(0.058, 0.04, 0.012), frame_zy(n)))
rig.part('cheeks', 'head', join_meshes(cheeks), M['cheek'])

# 耳朵（獨立網格，外側有淺淺的耳窩）
ears = []
for sx in (-1, 1):
    E = H0 + V(sx * 0.33, 0.25, -0.01)

    def ear_sdf(p, E=E, sx=sx):
        d = sd_ellipsoid(p, E + V(sx * 0.018, 0, 0), V(0.045, 0.07, 0.05), rot_z(-sx * 0.12))
        return smax(d, -sd_ellipsoid(p, E + V(sx * 0.062, 0.0, 0.012), V(0.016, 0.042, 0.026)), 0.012)

    ears.append(build(cage_box((1, 1, 1), E + V(sx * 0.02, 0, 0), V(0.07, 0.09, 0.07)), ear_sdf,
                      skel=(E + V(sx * 0.012, 0, 0))[None], name='ear'))
rig.part('ears', 'head', join_meshes(ears), M['skin'])

# 張嘴笑（上揚的月牙形）
s = surface_point(skull_sdf, HC, V(0, -0.17, 0.33))
n = normalize(grad(skull_sdf, s[None])[0])
Rm = frame_zy(n)
MC = s - n * 0.007


def mouth_sdf(p):
    q = (p - MC) @ Rm
    d = sd_ellipsoid(q, V(0, 0.0, 0), V(0.062, 0.042, 0.016))
    return smax(d, -sd_ellipsoid(q, V(0, 0.034, 0), V(0.085, 0.045, 0.05)), 0.006)   # 挖掉上半 → 嘴角上揚


me = build(cage_box((1, 1, 1), MC + Rm @ V(0, -0.018, 0), V(0.07, 0.035, 0.025), Rm), mouth_sdf,
           skel=[MC + Rm @ V(-0.025, -0.022, 0), MC + Rm @ V(0.025, -0.022, 0)], name='mouth')
rig.part('mouth', 'head', me, M['mouth'])

# ================= 草帽 =================
P = rig.world('hat')


def brim_sdf(p):
    q = p - P
    rho = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    q = q.copy()
    q[:, 1] += 0.03 * (rho / 0.49) ** 2          # 帽簷外緣微微下垂
    return sd_round_cyl(q, V(0, 0, 0), 0.49, 0.016, 0.014)


me = build(cage_box((2, 1, 2), P, V(0.5, 0.03, 0.5), shape='cyl'), brim_sdf, project='newton', relax_iters=1, name='brim')
rig.part('hat_brim', 'hat', me, M['straw'])


def crown_sdf(p):
    q = p - P
    k = 1 - 0.1 * np.clip(q[:, 1] / 0.25, 0, 1)   # 往上略收
    q2 = q.copy()
    q2[:, 0] /= k
    q2[:, 2] /= k
    return sd_round_cyl(q2, V(0, 0.115, 0), 0.325, 0.135, 0.11) * k


me = build(cage_box((2, 1, 2), P + V(0, 0.12, 0), V(0.35, 0.16, 0.35), shape='cyl'), crown_sdf,
           skel=(P + V(0, 0.1, 0))[None], name='crown')
rig.part('hat_crown', 'hat', me, M['straw'])


def band_sdf(p):
    t = crown_sdf(p)
    shell = smax(t - 0.012, -(t + 0.012), 0.003)
    return smax(shell, np.abs(p[:, 1] - (P[1] + 0.05)) - 0.034, 0.008)


ring = np.array([P + V(math.cos(a) * 0.325, 0.05, math.sin(a) * 0.325) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)])
cage = cage_tube(ring, np.tile([0.036, 0.02], (12, 1)), ring=4, closed=True, up=(0, 1, 0))
me = build(cage, band_sdf, levels=1, project='newton', relax_iters=1, name='band')
rig.part('hat_band', 'hat', me, M['hatband'])

# ================= 6 種髮型（每種一個 Empty 群組，都在 head 原點） =================
# 做法「髮帽曲面片」：以頭心為原點，在（方位角 θ、髮際線→頭頂）的參數格上，
#   沿射線取「頭髮體積 ∪ 頭殼」的最外層表面；靠近髮際線的一圈平滑內收進頭皮。
#   髮際線（含瀏海尖、鬢角、後頸）直接就是網格邊界 → 輪廓乾淨沒有鋸齒，也不浪費面在看不到的底面。
#   網格直接以「細分 2 級」的密度解析取樣（等同 Catmull-Clark 2 級後投影到造型上）。


def rel(v):
    return H0 + V(*v)


def shell(p, c=(0, 0.3, -0.02), r=(0.372, 0.372, 0.38)):
    return sd_ellipsoid(p - H0, V(*c), V(*r))


def with_locks(base, locks, k=0.025):
    """瀏海、鬢角等髮束體積：一串圓錐膠囊融進髮帽"""
    def f(p):
        d = base(p)
        for a, b_, ra, rb in locks:
            d = smin(d, sd_round_cone(p, rel(a), rel(b_), ra, rb), k)
        return d
    return f


def hairline(front, side, back, bumps=()):
    """
    髮際線高度 y(θ)（相對 head 樞紐）：前/側/後三個高度平滑內插，再減去瀏海尖、鬢角等「下垂尖角」
    θ：0 = 正前方(+z)、+π/2 = 角色左側(+x)
    bumps：(中心 θ, 往 −θ 側寬度, 往 +θ 側寬度, 下垂量, 尖銳度)
    """
    b = (front - back) / 2
    a = ((front + back) / 2 + side) / 2
    c = ((front + back) / 2 - side) / 2

    def f(th):
        y = a + b * np.cos(th) + c * np.cos(2 * th)
        for tc, wl, wr, drop, sharp in bumps:
            dt = (th - tc + np.pi) % (2 * np.pi) - np.pi
            t = np.where(dt < 0, 1 + dt / wl, 1 - dt / wr)
            y = y - drop * np.clip(t, 0, 1) ** sharp
        return y
    return f


def _dirs(t, p):
    return np.stack([np.sin(p) * np.sin(t), np.cos(p), np.sin(p) * np.cos(t)], axis=-1)


def hair_sheet(vol_sdf, edge_y, nth=48, ns=14, ramp=0.035, tuck=0.006, name='hair'):
    O = HC
    R_REF = 0.35
    th = np.linspace(0, 2 * np.pi, nth, endpoint=False)
    phiE = np.arccos(np.clip((edge_y(th) - 0.28) / R_REF, -1, 1))
    s = np.linspace(0, 1, ns + 1)[:-1]
    TH, S = np.meshgrid(th, s, indexing='ij')
    D = np.vstack([_dirs(TH, phiE[:, None] * (1 - S)).reshape(-1, 3), [[0.0, 1.0, 0.0]]])
    Os = np.tile(O, (len(D), 1))
    Ssk = cast_rays(Os, D, skull_sdf, 0.6)                                   # 頭皮
    Sout = cast_rays(Os, D, lambda p: np.minimum(vol_sdf(p), skull_sdf(p)), 0.9, outside_in=True)  # 最外層頭髮
    rsk = np.linalg.norm(Ssk - O, axis=1)
    rout = np.linalg.norm(Sout - O, axis=1)
    th_d = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    E = _dirs(th_d, np.arccos(np.clip((edge_y(th_d) - 0.28) / R_REF, -1, 1)))
    de = np.arccos(np.clip(D @ E.T, -1, 1)).min(axis=1) * rsk             # 到髮際線的球面距離
    rmp = smoothstep(0.0, ramp, de)
    r = rsk - tuck + (rout - rsk + tuck) * rmp
    P = O + D * r[:, None]
    faces = []
    pole = len(P) - 1
    for i in range(nth):
        i2 = (i + 1) % nth
        for j in range(ns - 1):
            faces.append([i * ns + j, i2 * ns + j, i2 * ns + j + 1, i * ns + j + 1])
        faces.append([i * ns + ns - 1, i2 * ns + ns - 1, pole])
    me = mesh_from(P, faces, name)
    me.update()
    c = np.empty(len(me.polygons) * 3)
    n = np.empty(len(me.polygons) * 3)
    me.polygons.foreach_get('center', c)
    me.polygons.foreach_get('normal', n)
    if np.sum(np.sum((b2t(c.reshape(-1, 3)) - O) * b2t(n.reshape(-1, 3)), axis=1)) < 0:
        for poly in me.polygons:
            poly.flip()
        me.update()
    me.shade_smooth()
    return me


def add_hair(style, vol, edge, **kw):
    me = hair_sheet(vol, edge, name='hair_' + style, **kw)
    rig.part(f'hair_{style}_cap', f'hair_{style}', me, M['hair'])


def tie_ring(center, axis, big_r=0.068, small_r=0.02):
    """髮圈：圍著髮束的小甜甜圈（1 級細分）"""
    R = frame_from_axis(axis)
    pts = np.array([center + R @ V(math.cos(a) * big_r, 0, math.sin(a) * big_r) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)])
    sdf = lambda p: sd_torus(p, center, big_r, small_r, R)
    return build(cage_tube(pts, small_r * 1.3, ring=4, closed=True, up=axis), sdf, skel=np.vstack([pts, pts[:1]]),
                 levels=1, relax_iters=0, name='tie')


def strand(style, path, radii, name, levels=2):
    path = np.array([rel(p) for p in path])
    me = build(cage_capsule(path, radii), lambda p: sd_tube(p, path, radii), skel=path, levels=levels, relax_iters=1, name=name)
    return me


PI = math.pi
SIDEBURNS = [(PI / 2 - 0.3, 0.07, 0.07, 0.1, 1.2), (-PI / 2 + 0.3, 0.07, 0.07, 0.1, 1.2)]

# --- 短髮（預設）：往 +x 撥的瀏海、鬢角、後頸兩撮、頭頂一根呆毛 ---
short_vol = with_locks(shell, [
    ((-0.12, 0.58, 0.16), (0.05, 0.43, 0.325), 0.075, 0.03),
    ((0.03, 0.6, 0.15), (0.17, 0.445, 0.29), 0.07, 0.03),
    ((0.12, 0.58, 0.12), (0.25, 0.44, 0.22), 0.06, 0.03),
    ((-0.2, 0.53, 0.15), (-0.13, 0.43, 0.3), 0.055, 0.03),
])
short_edge = hairline(0.47, 0.36, 0.12, [(0.12, 0.42, 0.13, 0.08, 1.0), (0.55, 0.34, 0.12, 0.06, 1.1),
                                         (-0.32, 0.26, 0.1, 0.05, 1.4)] + SIDEBURNS +
                      [(PI - 0.3, 0.14, 0.14, 0.05, 1.3), (PI + 0.3, 0.14, 0.14, 0.05, 1.3)])
add_hair('short', short_vol, short_edge)
me = strand('short', [(0.0, 0.64, 0.0), (0.015, 0.72, 0.03), (0.055, 0.755, 0.07), (0.085, 0.735, 0.1)],
            [0.03, 0.022, 0.014, 0.007], 'ahoge', levels=1)
rig.part('hair_short_ahoge', 'hair_short', me, M['hair'])


# --- 鮑伯頭：圓蘑菇形、齊瀏海、兩側蓋住耳朵到下巴、髮尾內彎 ---
def bob_vol(p):
    q = p - H0
    d = sd_ellipsoid(q, V(0, 0.28, -0.02), V(0.395, 0.4, 0.4))
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(q, V(sx * 0.3, 0.12, 0.02), V(0.11, 0.08, 0.2)), 0.05)
    return d


def bob_edge(th):
    a = np.abs((th + PI) % (2 * PI) - PI)
    w = 1 - smoothstep(0.62, 0.95, a)                     # 臉部開口的圓角
    notch = sum(0.012 * np.clip(1 - np.abs(((th - t0 + PI) % (2 * PI) - PI)) / 0.09, 0, 1) for t0 in (-0.36, 0.0, 0.36))
    return 0.07 + (0.44 - 0.07) * w - notch * w


add_hair('bob', bob_vol, bob_edge, nth=56, ns=16)

# --- 馬尾：往 −x 撥瀏海、低馬尾（帽簷下方）＋髮圈 ---
pony_vol = with_locks(shell, [
    ((0.12, 0.58, 0.16), (-0.05, 0.43, 0.325), 0.075, 0.03),
    ((-0.03, 0.6, 0.15), (-0.17, 0.445, 0.29), 0.07, 0.03),
    ((0.2, 0.53, 0.15), (0.13, 0.43, 0.3), 0.055, 0.03),
    ((0.0, 0.52, -0.2), (0.0, 0.42, -0.33), 0.08, 0.06),                     # 往馬尾收攏
])
pony_edge = hairline(0.45, 0.36, 0.14, [(-0.12, 0.13, 0.42, 0.08, 1.4), (-0.55, 0.12, 0.34, 0.06, 1.4),
                                        (0.32, 0.1, 0.26, 0.05, 1.4)] + SIDEBURNS)
add_hair('ponytail', pony_vol, pony_edge)
PT = [(0, 0.4, -0.3), (0, 0.36, -0.46), (0, 0.16, -0.52), (0.03, -0.03, -0.43)]
me = strand('ponytail', PT, [0.066, 0.078, 0.072, 0.02], 'ponytail')
rig.part('hair_ponytail_tail', 'hair_ponytail', me, M['hair'])
me = tie_ring(rel((0, 0.402, -0.355)), V(0, 0, -1), 0.066, 0.02)
rig.part('hair_ponytail_tie', 'hair_ponytail', me, M['hairTie'])


# --- 雙馬尾：中分短瀏海、耳後兩束往外下垂＋髮圈 ---
def pig_vol(p):
    d = with_locks(shell, [((x, 0.56, 0.2), (x * 1.15, 0.43, 0.33), 0.06, 0.03) for x in (-0.1, 0.0, 0.1)] +
                   [((sx * 0.22, 0.45, -0.12), (sx * 0.29, 0.38, -0.14), 0.07, 0.06) for sx in (-1, 1)])(p)
    return smax(d, -sd_ellipsoid(p - H0, V(0, 0.67, 0.12), V(0.012, 0.03, 0.22)), 0.012)   # 中分線


pig_edge = hairline(0.45, 0.36, 0.12, [(t, 0.17, 0.17, 0.065, 1.3) for t in (-0.36, 0.0, 0.36)] + SIDEBURNS)
add_hair('pigtails', pig_vol, pig_edge, nth=44, ns=13)
tails, ties = [], []
for sx in (-1, 1):
    # 髮束造型走三點（中段鼓起），籠子與射線骨架只用頭尾兩點以省面
    PG = np.array([rel(v) for v in ((sx * 0.3, 0.375, -0.14), (sx * 0.39, 0.19, -0.11), (sx * 0.42, -0.03, -0.07))])
    PR = [0.056, 0.07, 0.018]
    sk = [PG[0], PG[2] + V(0, 0.02, 0)]
    tails.append(build(cage_capsule(sk, [0.06, 0.03]), lambda p, PG=PG, PR=PR: sd_tube(p, PG, PR), skel=sk,
                       relax_iters=1, name='pigtail'))
    ties.append(tie_ring(rel((sx * 0.335, 0.365, -0.14)), normalize(V(sx * 1, -0.35, 0)), 0.058, 0.019))
rig.part('hair_pigtails_tails', 'hair_pigtails', join_meshes(tails), M['hair'])
rig.part('hair_pigtails_ties', 'hair_pigtails', join_meshes(ties), M['hairTie'])

# --- 刺刺頭：前後左右的尖刺（帽簷以上的刺都收在帽頂內） ---
SPIKES = []
for x in (-0.14, 0.0, 0.14):
    SPIKES.append(((x, 0.52, 0.18), (x * 1.3, 0.43, 0.37), 0.07, 0.014))
for sx in (-1, 1):
    SPIKES += [((sx * 0.25, 0.46, 0.05), (sx * 0.43, 0.43, 0.08), 0.065, 0.014),
               ((sx * 0.24, 0.39, -0.13), (sx * 0.41, 0.33, -0.19), 0.065, 0.014),
               ((sx * 0.1, 0.4, -0.25), (sx * 0.16, 0.32, -0.44), 0.065, 0.014),
               ((sx * 0.1, 0.6, 0.0), (sx * 0.16, 0.74, 0.03), 0.06, 0.014)]
SPIKES += [((0, 0.3, -0.27), (0, 0.17, -0.44), 0.065, 0.014), ((0, 0.62, -0.1), (0, 0.765, -0.12), 0.06, 0.014)]
spiky_vol = with_locks(shell, SPIKES, k=0.03)
spiky_edge = hairline(0.47, 0.36, 0.12, [(t, 0.15, 0.15, 0.09, 1.8) for t in (-0.36, 0.0, 0.36)] +
                      [(PI / 2 - 0.28, 0.1, 0.1, 0.1, 1.6), (-PI / 2 + 0.28, 0.1, 0.1, 0.1, 1.6)] +
                      [(PI + t, 0.14, 0.14, 0.08, 1.6) for t in (-0.34, 0.0, 0.34)])
add_hair('spiky', spiky_vol, spiky_edge, nth=64, ns=18)

# --- 包包頭：側撥瀏海、後腦勺圓髮髻（在帽簷下方，戴帽不穿模）＋髮圈 ---
bun_vol = with_locks(shell, [
    ((-0.1, 0.58, 0.16), (0.07, 0.43, 0.32), 0.075, 0.03),
    ((0.05, 0.6, 0.15), (0.19, 0.445, 0.28), 0.065, 0.03),
    ((-0.2, 0.53, 0.15), (-0.13, 0.43, 0.3), 0.055, 0.03),
    ((0.0, 0.46, -0.2), (0.0, 0.37, -0.3), 0.09, 0.07),
])
bun_edge = hairline(0.45, 0.36, 0.14, [(0.18, 0.4, 0.13, 0.075, 1.4), (0.6, 0.3, 0.12, 0.055, 1.4),
                                       (-0.3, 0.24, 0.1, 0.05, 1.4)] + SIDEBURNS)
add_hair('bun', bun_vol, bun_edge)
BC = rel((0, 0.36, -0.385))


def bun_sdf(p):
    return sd_ellipsoid(p, BC, V(0.115, 0.108, 0.105))


me = build(cage_box((1, 1, 1), BC, V(0.14, 0.14, 0.14)), bun_sdf, skel=BC[None], name='bun')
rig.part('hair_bun_bun', 'hair_bun', me, M['hair'])
me = tie_ring(rel((0, 0.36, -0.29)), V(0, 0, -1), 0.07, 0.02)
rig.part('hair_bun_tie', 'hair_bun', me, M['hairTie'])

# ---------------- 統計 ----------------
total, rows = rig.stats()
hair_tris = {h: sum(r[2] for r in rows if r[1] == f'hair_{h}') for h in HAIRS}
base = total - sum(hair_tris.values())
print('不含髮型（身體＋帽子）:', base)
for h in HAIRS:
    print(f'  + {h:<9} {hair_tris[h]:>5}  → 同時可見 {base + hair_tris[h]}')
rig.export(os.path.join(MODELS, 'char_player.glb'))
