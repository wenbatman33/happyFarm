# -*- coding: utf-8 -*-
"""
橘色虎斑貓「橘子」pet_cat.glb
橘色帶深橘條紋、白胸白襪、三角耳（內有白色耳毛）、細長尾巴往後往上捲成問號、鬍鬚、蓬蓬臉頰
用法：Blender -b --python build_cat.py
"""
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import *  # noqa: F401,F403

FUR = hexrgb('#f2a450')
STRIPE = hexrgb('#d9772e')
WHITE = hexrgb('#fff6ea')
PINK = hexrgb('#ff9fae')
BLUSH = hexrgb('#ff9a92')

rig = Rig('pet_cat')
M_FUR = material('fur', '#ffffff', rough=0.78, vcol=True)
M_EYE = material('eye', '#1d1512', rough=0.12)
M_HL = material('eyeHighlight', '#ffffff', rough=0.3, emit='#ffffff', emit_strength=0.6)
M_NOSE = material('nose', '#ff8a9a', rough=0.35)
M_MOUTH = material('mouth', '#6a3526', rough=0.6)
M_TONGUE = material('tongue', '#ff8597', rough=0.4)
M_PAD = material('pad', '#ff9fae', rough=0.6)
M_WHISKER = material('whisker', '#fffaf2', rough=0.5)

# ---------------- 節點 ----------------
rig.empty('body')
rig.empty('head', 'body', (0, 0.66, 0.3))
LEGS = [(0.1, 0.2), (-0.1, 0.2), (0.1, -0.2), (-0.1, -0.2)]
for i, (x, z) in enumerate(LEGS):
    rig.empty(f'leg_{i}', 'body', (x, 0.28, z))
rig.empty('tail', 'body', (0, 0.46, -0.36))
rig.empty('neck_anchor', 'body', (0, 0.52, 0.26))
rig.empty('ear_0', 'head', (-0.13, 0.15, 0))
rig.empty('ear_1', 'head', (0.13, 0.15, 0))
rig.empty('hat_anchor', 'head', (0, 0.2, 0))
H = rig.world('head')

# ---------------- 身體 ----------------


def body_base(p):
    d = sd_capsule(p, V(0, 0.385, -0.15), V(0, 0.395, 0.11), 0.152)
    d = smin(d, sd_ellipsoid(p, V(0, 0.41, 0.18), V(0.135, 0.155, 0.13)), 0.07)   # 胸
    d = smin(d, sd_ellipsoid(p, V(0, 0.31, 0.0), V(0.115, 0.07, 0.17)), 0.07)    # 肚子
    d = smin(d, sd_capsule(p, V(0, 0.46, 0.19), V(0, 0.62, 0.29), 0.095), 0.06)  # 脖子伸進頭
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(p, V(sx * 0.085, 0.35, 0.18), V(0.066, 0.1, 0.075)), 0.045)    # 肩膀
        d = smin(d, sd_ellipsoid(p, V(sx * 0.085, 0.37, -0.19), V(0.078, 0.125, 0.105)), 0.05)  # 後腿肌肉
    return d


TUFTS = []
for y, xs in ((0.41, (-0.075, 0.0, 0.075)), (0.35, (-0.04, 0.04))):
    for x in xs:
        s = surface_point(body_base, V(x, y, 0.12), (0, 0, 1))
        TUFTS.append((V(x, y + 0.025, s[2] - 0.03), V(x * 1.1, y - 0.045, s[2] + 0.01)))


def body_sdf(p):
    d = body_base(p)
    for a, b in TUFTS:
        d = smin(d, sd_round_cone(p, a, b, 0.034, 0.009), 0.018)
    return d


def tabby(P, y_top, y_fade, period=0.105, phase=0.0):
    """背上的虎斑：沿 z 的彎曲條紋，越往側邊越細，肚子沒有"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    band = 0.5 + 0.5 * np.sin(2 * np.pi * (z - phase) / period + 7.0 * x * x)
    side = np.clip((y_top - y) / (y_top - y_fade), 0, 1)
    thr = 0.58 + 0.38 * side
    return smoothstep(thr, thr + 0.1, band) * (1 - smoothstep(0.85, 1.0, side))


def body_color(P, N):
    col = np.tile(FUR, (len(P), 1))
    st = tabby(P, 0.53, 0.33) * (1 - smoothstep(0.12, 0.2, P[:, 2]))
    col = mix(col, STRIPE, st)
    w = sunion([
        sd_ellipsoid(P, V(0, 0.37, 0.31), V(0.12, 0.17, 0.11)),   # 白胸
        sd_ellipsoid(P, V(0, 0.24, 0.02), V(0.13, 0.09, 0.26)),   # 白肚子
    ], 0.04)
    return mix(col, WHITE, smoothstep(0.01, -0.01, w))


me = build(cage_box((3, 2, 4), V(0, 0.4, 0.0), V(0.18, 0.2, 0.42)), body_sdf,
           skel=[V(0, 0.385, -0.22), V(0, 0.4, 0.12), V(0, 0.48, 0.22)], color=body_color, name='torso')
rig.part('torso', 'body', me, M_FUR)

# ---------------- 頭 ----------------


def head_sdf(p):
    q = p - H
    d = sd_ellipsoid(q, V(0, 0.01, 0), V(0.22, 0.185, 0.19))                       # 頭殼（寬）
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(q, V(sx * 0.09, -0.06, 0.05), V(0.13, 0.1, 0.12)), 0.05)  # 圓臉頰
        d = smin(d, sd_ellipsoid(q, V(sx * 0.032, -0.072, 0.15), V(0.043, 0.034, 0.04)), 0.02)  # 鬍鬚墊
        # 臉頰兩側蓬毛（貓咪臉頰的小尖毛）
        d = smin(d, sd_round_cone(q, V(sx * 0.17, -0.03, 0.0), V(sx * 0.245, -0.07, -0.02), 0.045, 0.01), 0.025)
        d = smin(d, sd_round_cone(q, V(sx * 0.16, -0.08, 0.0), V(sx * 0.225, -0.125, -0.02), 0.04, 0.01), 0.025)
    d = smin(d, sd_ellipsoid(q, V(0, -0.105, 0.125), V(0.032, 0.026, 0.03)), 0.02)  # 小下巴
    return d


def head_color(P, N):
    q = P - H
    col = np.tile(FUR, (len(P), 1))
    # 額頭 M 字紋與臉頰條紋
    st = [sd_capsule(q, V(0, 0.19, 0.08), V(0, 0.1, 0.165), 0.013),
          sd_capsule(q, V(-0.055, 0.17, 0.11), V(-0.045, 0.11, 0.16), 0.011),
          sd_capsule(q, V(0.055, 0.17, 0.11), V(0.045, 0.11, 0.16), 0.011)]
    for sx in (-1, 1):
        st.append(sd_capsule(q, V(sx * 0.17, 0.01, 0.09), V(sx * 0.23, -0.0, -0.02), 0.011))
        st.append(sd_capsule(q, V(sx * 0.17, -0.035, 0.1), V(sx * 0.22, -0.045, 0.0), 0.009))
        st.append(sd_capsule(q, V(sx * 0.1, 0.17, -0.02), V(sx * 0.07, 0.12, -0.14), 0.013))   # 頭頂後方
    st.append(sd_capsule(q, V(0, 0.2, -0.02), V(0, 0.15, -0.16), 0.014))
    col = mix(col, STRIPE, smoothstep(0.004, -0.004, np.min(np.stack(st), axis=0)))
    w = sunion([
        sd_ellipsoid(q, V(0, -0.075, 0.15), V(0.085, 0.06, 0.07)),     # 嘴邊白
        sd_ellipsoid(q, V(0, -0.13, 0.08), V(0.13, 0.06, 0.12)),       # 下巴
    ], 0.03)
    col = mix(col, WHITE, smoothstep(0.008, -0.008, w))
    for sx in (-1, 1):
        b = sd_sphere(q, V(sx * 0.14, -0.04, 0.13), 0.04)
        col = mix(col, BLUSH, smoothstep(0.02, -0.02, b) * 0.45)
    return col


me = build(cage_box((3, 3, 3), H + V(0, -0.02, 0.02), V(0.27, 0.22, 0.24)), head_sdf,
           skel=[H + V(0, 0.0, -0.05), H + V(0, -0.04, 0.1)], color=head_color, name='skull')
rig.part('skull', 'head', me, M_FUR)

# 粉紅小鼻子（倒三角）
nc = surface_point(head_sdf, H + V(0, -0.038, 0.1), (0, 0.15, 1)) + V(0, 0, 0.002)


def nose_sdf(p):
    return smin(sd_ellipsoid(p, nc + V(0, 0.004, 0), V(0.024, 0.013, 0.014)),
                sd_ellipsoid(p, nc + V(0, -0.007, -0.002), V(0.011, 0.011, 0.012)), 0.008)


me = build(cage_box((1, 1, 1), nc, V(0.028, 0.02, 0.018)), nose_sdf, skel=nc[None], name='nose')
rig.part('nose', 'head', me, M_NOSE)

# 嘴巴：ω + 人中
mouth_pts = [surface_point(head_sdf, H + V(x, y, 0.06), (0, 0, 1)) + V(0, 0, -0.001)
             for x, y in ((-0.042, -0.083), (-0.027, -0.097), (-0.011, -0.095), (0.0, -0.085),
                          (0.011, -0.095), (0.027, -0.097), (0.042, -0.083))]
ph = [surface_point(head_sdf, H + V(0, y, 0.06), (0, 0, 1)) for y in (nc[1] - H[1] - 0.012, -0.085)]
me = join_meshes([tube_part(mouth_pts, 0.0038, name='mouth_w'), tube_part(ph, 0.0038, name='mouth_ph')])
rig.part('mouth', 'head', me, M_MOUTH)

# 鬍鬚：每邊 2 根，從鬍鬚墊往外
wh = []
for sx in (-1, 1):
    for k, (dy, tilt) in enumerate(((0.0, 0.08), (-0.016, -0.06))):
        a = surface_point(head_sdf, H + V(sx * 0.05, -0.068 + dy, 0.08), (sx * 0.5, 0, 1))
        b = a + V(sx * 0.15, tilt * 0.15 + 0.005, -0.03)
        wh.append(tube_part([a - V(sx * 0.01, 0, 0.004), (a + b) / 2 + V(0, 0.006, 0), b], [0.0035, 0.0028, 0.0018], name='whisker'))
rig.part('whiskers', 'head', join_meshes(wh), M_WHISKER)

# 眼睛（大一點、圓亮）
add_eye(rig, 'eye_0', 'head', (-0.1, 0.03, 0.16), (0.041, 0.05, 0.022), M_EYE, M_HL, hl_r=0.013)
add_eye(rig, 'eye_1', 'head', (0.1, 0.03, 0.16), (0.041, 0.05, 0.022), M_EYE, M_HL, hl_r=0.013)

# 舌頭（小小的吐舌）
T = H + V(0, -0.13, 0.2)
Rt = rot_x(-0.45)


def tongue_sdf(p):
    q = (p - T) @ Rt
    d = sd_ellipsoid(q, V(0, 0.004, 0), V(0.022, 0.03, 0.009))
    d = smin(d, sd_capsule(q, V(0, 0.02, -0.004), V(0, 0.034, -0.015), 0.011), 0.008)
    return smax(d, -sd_ellipsoid(q, V(0, 0.0, 0.01), V(0.004, 0.022, 0.004)), 0.003)


me = build(cage_box((1, 1, 1), T + Rt @ V(0, 0.008, 0), V(0.026, 0.05, 0.016), Rt), tongue_sdf,
           skel=[T + Rt @ V(0, 0.024, -0.006), T + Rt @ V(0, -0.015, 0)], name='tongue')
rig.part('tongue', 'head', me, M_TONGUE, origin=(0, -0.13, 0.2))

# ---------------- 三角耳（外傾 0.2 做進網格） ----------------
for i, s in ((0, -1), (1, 1)):
    E = rig.world(f'ear_{i}')
    R = rot_z(-s * 0.22) @ rot_x(-0.08) @ rot_y(s * 0.35)

    def outer(q):
        return sd_round_cone(q, V(0, -0.045, 0), V(0, 0.165, 0), 0.086, 0.013)

    def cup(q):
        return sd_round_cone(q, V(0, 0.005, 0.034), V(0, 0.14, 0.014), 0.058, 0.006)

    def ear_sdf(p, E=E, R=R):
        q = (p - E) @ R
        d = sd_flat(q, outer, V(0, 0, 0), None, 0.6)
        return smax(d, -sd_flat(q, cup, V(0, 0, 0), None, 0.45), 0.01)

    def ear_color(P, N, E=E, R=R):
        q = (P - E) @ R
        col = mix(np.tile(FUR, (len(P), 1)), STRIPE, smoothstep(0.1, 0.15, q[:, 1]) * 0.6)
        c = sd_flat(q, cup, V(0, 0, 0), None, 0.45)
        inner = smoothstep(0.008, 0.0, c)
        col = mix(col, PINK, inner)
        tuft = inner * smoothstep(0.05, 0.0, q[:, 1]) * smoothstep(0.04, 0.0, np.abs(q[:, 0]))  # 耳根白色耳毛
        return mix(col, WHITE, tuft)

    me = build(cage_box((2, 1, 1), E + R @ V(0, 0.055, 0.0), V(0.09, 0.13, 0.055), R), ear_sdf,
               skel=[E + R @ V(0, -0.02, -0.03), E + R @ V(0, 0.13, -0.005)], color=ear_color, name=f'ear_{i}')
    rig.part(f'ear_{i}_mesh', f'ear_{i}', me, M_FUR)

# ---------------- 腿（白襪＋肉球） ----------------
for i, (x, z) in enumerate(LEGS):
    hind = z < 0

    def leg_color(P, N):
        col = np.tile(FUR, (len(P), 1))
        ring = 0.5 + 0.5 * np.sin(2 * np.pi * P[:, 1] / 0.07 + 1.0)
        col = mix(col, STRIPE, smoothstep(0.72, 0.85, ring) * smoothstep(0.1, 0.14, P[:, 1]) * smoothstep(0.3, 0.24, P[:, 1]))
        return mix(col, WHITE, smoothstep(0.1, 0.075, P[:, 1]))

    quad_leg(rig, i, 0.245, 0.062 if hind else 0.054, 0.044, V(0.052, 0.036, 0.064), M_FUR, M_PAD, leg_color,
             paw_fwd=0.02, pad_scale=0.9)

# ---------------- 尾巴：往後往上捲成問號 ----------------
TL = rig.world('tail')
TAIL = np.array([TL + V(0, -0.01, 0.05), TL + V(0, 0.02, -0.08), TL + V(0, 0.16, -0.16),
                 TL + V(0, 0.29, -0.13), TL + V(0, 0.335, -0.045), TL + V(0, 0.295, 0.0)])
TR = np.array([0.036, 0.033, 0.031, 0.031, 0.032, 0.03])


def tail_sdf(p):
    return sd_tube(p, TAIL, TR)


def tail_color(P, N):
    s, total = polyline_param(P, TAIL)
    col = np.tile(FUR, (len(P), 1))
    ring = 0.5 + 0.5 * np.sin(2 * np.pi * s / 0.075)
    col = mix(col, STRIPE, smoothstep(0.6, 0.75, ring) * smoothstep(0.08, 0.12, s))
    return mix(col, STRIPE, smoothstep(total - 0.08, total - 0.03, s))  # 深色尾巴尖


me = build(cage_capsule(TAIL, TR, up=(1, 0, 0)), tail_sdf, skel=TAIL, color=tail_color, relax_iters=1, name='tail')
rig.part('tail_mesh', 'tail', me, M_FUR)

total, _ = rig.stats()
rig.export(os.path.join(MODELS, 'pet_cat.glb'))
