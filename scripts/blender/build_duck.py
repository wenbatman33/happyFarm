# -*- coding: utf-8 -*-
"""
小鴨「嘎嘎」pet_duck.glb
鮮黃圓身、蓬蓬胸毛、橘色扁嘴（嘴角上揚）、頭頂三根捲毛、貼身下垂的小翅膀、翹尾巴、
只有兩隻短腿＋扁平蹼腳；沒有耳朵、沒有後腳
用法：Blender -b --python build_duck.py
"""
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import *  # noqa: F401,F403

YEL = hexrgb('#ffd84a')
LIGHT = hexrgb('#ffe88e')
DEEP = hexrgb('#f5c232')
BLUSH = hexrgb('#ff9f86')

rig = Rig('pet_duck')
M_FEATHER = material('feather', '#ffffff', rough=0.8, vcol=True)
M_BILL = material('bill', '#ff9a2a', rough=0.5)
M_EYE = material('eye', '#1d1512', rough=0.12)
M_HL = material('eyeHighlight', '#ffffff', rough=0.3, emit='#ffffff', emit_strength=0.6)

# ---------------- 節點 ----------------
rig.empty('body')
rig.empty('head', 'body', (0, 0.62, 0.14))
rig.empty('leg_0', 'body', (0.1, 0.1, 0.02))
rig.empty('leg_1', 'body', (-0.1, 0.1, 0.02))
rig.empty('wing_0', 'body', (-0.21, 0.36, 0))
rig.empty('wing_1', 'body', (0.21, 0.36, 0))
rig.empty('tail', 'body', (0, 0.42, -0.26))
rig.empty('neck_anchor', 'body', (0, 0.5, 0.14))
rig.empty('hat_anchor', 'head', (0, 0.18, 0))
H = rig.world('head')

# ---------------- 身體 ----------------


def body_base(p):
    d = sd_ellipsoid(p, V(0, 0.29, -0.01), V(0.225, 0.2, 0.25))
    d = smin(d, sd_ellipsoid(p, V(0, 0.315, 0.09), V(0.2, 0.19, 0.18)), 0.07)      # 圓胸
    d = smin(d, sd_round_cone(p, V(0, 0.31, -0.13), V(0, 0.41, -0.245), 0.14, 0.045), 0.06)  # 往尾巴收
    d = smin(d, sd_capsule(p, V(0, 0.42, 0.08), V(0, 0.58, 0.13), 0.1), 0.06)     # 脖子伸進頭
    return d


TUFTS = []
for y, xs in ((0.44, (-0.08, 0.0, 0.08)), (0.38, (-0.11, -0.04, 0.04, 0.11)), (0.32, (-0.07, 0.0, 0.07))):
    for x in xs:
        s = surface_point(body_base, V(x, y, 0.05), (0, 0, 1))
        TUFTS.append((V(x, y + 0.025, s[2] - 0.03), V(x * 1.1, y - 0.045, s[2] + 0.012)))


def body_sdf(p):
    d = body_base(p)
    for a, b in TUFTS:
        d = smin(d, sd_round_cone(p, a, b, 0.036, 0.01), 0.02)
    return d


def body_color(P, N):
    col = np.tile(YEL, (len(P), 1))
    col = mix(col, DEEP, smoothstep(0.38, 0.5, P[:, 1]) * smoothstep(0.05, -0.1, P[:, 2]) * 0.6)
    return mix(col, LIGHT, smoothstep(0.02, -0.03, sd_ellipsoid(P, V(0, 0.26, 0.2), V(0.16, 0.2, 0.1))))


me = build(cage_box((3, 3, 3), V(0, 0.3, -0.01), V(0.27, 0.26, 0.32)), body_sdf,
           skel=[V(0, 0.29, -0.14), V(0, 0.31, 0.08)], color=body_color, name='torso')
rig.part('torso', 'body', me, M_FEATHER)

# ---------------- 頭 ----------------


def head_sdf(p):
    q = p - H
    d = sd_ellipsoid(q, V(0, 0.0, 0), V(0.19, 0.185, 0.175))
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(q, V(sx * 0.07, -0.05, 0.06), V(0.1, 0.085, 0.09)), 0.05)  # 臉頰
    return d


def head_color(P, N):
    q = P - H
    col = np.tile(YEL, (len(P), 1))
    col = mix(col, DEEP, smoothstep(0.08, 0.18, q[:, 1]) * 0.35)
    for sx in (-1, 1):
        b = sd_sphere(q, V(sx * 0.135, -0.01, 0.1), 0.04)
        col = mix(col, BLUSH, smoothstep(0.02, -0.025, b) * 0.5)
    return col


me = build(cage_box((3, 3, 3), H + V(0, -0.01, 0.01), V(0.23, 0.22, 0.22)), head_sdf,
           skel=[H + V(0, 0.0, -0.04), H + V(0, -0.02, 0.05)], color=head_color, name='skull')
rig.part('skull', 'head', me, M_FEATHER)

add_eye(rig, 'eye_0', 'head', (-0.1, 0.05, 0.14), (0.036, 0.044, 0.02), M_EYE, M_HL, hl_r=0.012)
add_eye(rig, 'eye_1', 'head', (0.1, 0.05, 0.14), (0.036, 0.044, 0.02), M_EYE, M_HL, hl_r=0.012)

# 扁嘴：上嘴片嘴角上揚（笑臉），下嘴片較小，中間一道嘴縫
BC = H + V(0, -0.045, 0.2)


def bill_sdf(p):
    q = p - BC
    q = q.copy()
    q[:, 1] -= 2.2 * q[:, 0] ** 2          # 嘴角往上彎
    up = sd_ellipsoid(q, V(0, 0.0, 0.0), V(0.092, 0.03, 0.085))
    up = smin(up, sd_ellipsoid(q, V(0, 0.005, -0.06), V(0.075, 0.035, 0.05)), 0.02)   # 嘴根埋進頭
    lo = sd_ellipsoid(q, V(0, -0.028, -0.012), V(0.07, 0.018, 0.065))
    d = smin(up, lo, 0.012)
    groove = sd_ellipsoid(q, V(0, -0.018, 0.012), V(0.1, 0.0035, 0.085))
    return smax(d, -groove, 0.006)


me = build(cage_box((2, 1, 2), BC + V(0, -0.01, -0.01), V(0.11, 0.05, 0.11), shape='box'), bill_sdf,
           skel=[BC + V(0, -0.005, -0.06), BC + V(0, -0.005, 0.05)], name='bill')
rig.part('bill', 'head', me, M_BILL)

# 頭頂三根捲毛（小零件，1 級細分）
tuft = []
for x, lean, ln in ((0.0, 0.0, 1.0), (-0.034, -0.45, 0.8), (0.034, 0.45, 0.8)):
    base = surface_point(head_sdf, H + V(x, 0.05, 0.0), (x * 3, 1, 0.05)) + V(0, -0.014, 0)
    pts = [base, base + V(lean * 0.035, 0.05 * ln, 0.03), base + V(lean * 0.07, 0.095 * ln, 0.02),
           base + V(lean * 0.085, 0.105 * ln, -0.02)]                          # 往前再往後捲
    rad = [0.024, 0.02, 0.014, 0.008] if x == 0 else [0.019, 0.016, 0.011, 0.007]

    def fsdf(p, pts=pts, rad=rad):
        return sd_tube(p, pts, rad)
    tuft.append(build(cage_capsule(pts, rad), fsdf, skel=pts, levels=1, relax_iters=0,
                      color=lambda P, N: np.tile(DEEP, (len(P), 1)), name='tuft'))
rig.part('tuft', 'head', join_meshes(tuft), M_FEATHER)

# ---------------- 翅膀：貼著身體往下垂，尾端三瓣羽毛 ----------------
for i, s in ((0, -1), (1, 1)):
    W = rig.world(f'wing_{i}')
    R = rot_z(s * 0.18) @ rot_y(s * 0.12)       # 下緣略往內收，順著身體弧度

    def wing_core(q):
        # 座標已重排：(前後, 上下, 厚度)
        # 葉片形：上寬、往後下收成柔和尖端
        d = sd_ellipsoid(q, V(-0.02, -0.06, 0), V(0.064, 0.088, 0.064), rot_z(-0.55))
        return smin(d, sd_ellipsoid(q, V(-0.075, -0.125, 0), V(0.028, 0.042, 0.03), rot_z(-0.75)), 0.035)

    def wing_sdf(p, W=W, R=R):
        q = (p - W) @ R
        q = q[:, [2, 1, 0]]                      # 讓厚度方向對到 sd_flat 的 z
        return sd_flat(q, wing_core, V(0, 0, 0), None, 0.42)

    def wing_color(P, N, W=W):
        q = P - W
        return mix(np.tile(YEL, (len(P), 1)), DEEP, smoothstep(-0.06, -0.14, q[:, 1]) * 0.7)

    cen = W + R @ V(0, -0.065, -0.05)
    me = build(cage_box((1, 2, 2), cen, V(0.04, 0.13, 0.12), R, shape='box'), wing_sdf,
               skel=[W + R @ V(0, 0.0, 0.0), W + R @ V(0, -0.12, -0.07)], color=wing_color, name=f'wing_{i}')
    rig.part(f'wing_{i}_mesh', f'wing_{i}', me, M_FEATHER)

# ---------------- 腿：短腿＋扁平蹼腳（三趾扇形） ----------------
for i in (0, 1):
    L = rig.world(f'leg_{i}')
    FC = V(L[0], 0.016, L[2] + 0.06)

    def shin_sdf(p, L=L):
        return sd_round_cone(p, L + V(0, 0.04, 0), V(L[0], 0.02, L[2] + 0.02), 0.03, 0.022)

    sk = [L + V(0, 0.04, 0), V(L[0], 0.022, L[2] + 0.02)]
    me = build(cage_capsule(sk, [0.03, 0.022]), shin_sdf, skel=sk, name=f'leg_{i}')
    rig.part(f'leg_{i}_mesh', f'leg_{i}', me, M_BILL)

    def foot_sdf(p, FC=FC):
        q = p - FC
        d = sd_ellipsoid(q, V(0, 0.0, -0.01), V(0.055, 0.014, 0.05))            # 蹼
        for ang in (-0.55, 0.0, 0.55):
            tip = V(math.sin(ang) * 0.07, -0.002, math.cos(ang) * 0.07 - 0.005)
            d = smin(d, sd_round_cone(q, V(0, 0.002, -0.03), tip, 0.017, 0.016), 0.022)  # 三趾
        return smax(d, sd_plane(p, V(0, 0.004, 0), V(0, -1, 0)), 0.006)

    me = build(cage_box((2, 1, 2), FC + V(0, 0, 0.01), V(0.09, 0.03, 0.09), shape='box'), foot_sdf,
               skel=[FC + V(0, 0.0, -0.03), FC + V(0, 0.0, 0.03)], name=f'foot_{i}')
    rig.part(f'leg_{i}_foot', f'leg_{i}', me, M_BILL)

# ---------------- 翹尾巴：三根小羽毛往上翹 ----------------
TL = rig.world('tail')


def tail_sdf(p):
    q = p - TL
    d = sd_round_cone(q, V(0, -0.01, 0.04), V(0, 0.085, -0.07), 0.05, 0.014)
    for sx in (-1, 1):
        d = smin(d, sd_round_cone(q, V(sx * 0.02, -0.01, 0.03), V(sx * 0.045, 0.06, -0.06), 0.04, 0.012), 0.02)
    return d


sk = [TL + V(0, 0.0, 0.035), TL + V(0, 0.07, -0.055)]
me = build(cage_capsule(sk, [0.06, 0.03]), tail_sdf, skel=sk,
           color=lambda P, N: mix(np.tile(YEL, (len(P), 1)), DEEP, smoothstep(0.43, 0.5, P[:, 1])), name='tail')
rig.part('tail_mesh', 'tail', me, M_FEATHER)

total, _ = rig.stats()
rig.export(os.path.join(MODELS, 'pet_duck.glb'))
