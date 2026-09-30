# -*- coding: utf-8 -*-
"""
柯基「麻糬」pet_corgi.glb
橘白雙色、大立耳、短腿、圓屁股（愛心屁股兩瓣）、胸前蓬蓬毛、肉球
用法：Blender -b --python build_corgi.py
"""
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import *  # noqa: F401,F403

ORANGE = hexrgb('#e8954a')
DEEP = hexrgb('#d67f36')     # 背脊與耳緣略深的橘（自然漸層）
WHITE = hexrgb('#fff6ea')
PINK = hexrgb('#ff9fae')
BLUSH = hexrgb('#ff9a92')

rig = Rig('pet_corgi')
M_FUR = material('fur', '#ffffff', rough=0.78, vcol=True)
M_EYE = material('eye', '#1d1512', rough=0.12)
M_HL = material('eyeHighlight', '#ffffff', rough=0.3, emit='#ffffff', emit_strength=0.6)
M_NOSE = material('nose', '#2a1e1a', rough=0.25)
M_MOUTH = material('mouth', '#5a3024', rough=0.6)
M_TONGUE = material('tongue', '#ff8597', rough=0.4)
M_PAD = material('pad', '#ff9fae', rough=0.6)

# ---------------- 節點 ----------------
rig.empty('body')
rig.empty('head', 'body', (0, 0.55, 0.3))
LEGS = [(0.12, 0.2), (-0.12, 0.2), (0.12, -0.2), (-0.12, -0.2)]  # 左前 +x、右前 −x、左後、右後
for i, (x, z) in enumerate(LEGS):
    rig.empty(f'leg_{i}', 'body', (x, 0.2, z))
rig.empty('tail', 'body', (0, 0.42, -0.4))
rig.empty('neck_anchor', 'body', (0, 0.42, 0.24))
rig.empty('ear_0', 'head', (-0.12, 0.14, -0.03))
rig.empty('ear_1', 'head', (0.12, 0.14, -0.03))
rig.empty('hat_anchor', 'head', (0, 0.2, 0.02))
H = rig.world('head')

# ---------------- 身體 ----------------


def body_base(p):
    d = sd_capsule(p, V(0, 0.33, -0.16), V(0, 0.345, 0.12), 0.172)           # 長條身軀
    d = smin(d, sd_ellipsoid(p, V(0, 0.365, 0.19), V(0.162, 0.17, 0.15)), 0.08)  # 胸
    for sx in (-1, 1):                                                         # 愛心屁股兩瓣
        d = smin(d, sd_ellipsoid(p, V(sx * 0.07, 0.345, -0.245), V(0.125, 0.158, 0.13)), 0.05)
    d = smin(d, sd_ellipsoid(p, V(0, 0.25, 0.0), V(0.14, 0.085, 0.2)), 0.08)   # 肚子
    d = smin(d, sd_capsule(p, V(0, 0.40, 0.2), V(0, 0.52, 0.29), 0.11), 0.07)  # 脖子伸進頭裡（頭身柔和相接）
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(p, V(sx * 0.105, 0.27, 0.19), V(0.075, 0.1, 0.085)), 0.05)   # 肩膀，包住前腿根
        d = smin(d, sd_ellipsoid(p, V(sx * 0.105, 0.29, -0.2), V(0.085, 0.12, 0.105)), 0.05)  # 後腿肌肉
    return d


# 胸前蓬蓬毛：三排往下尖的小毛簇，貼在胸口表面
TUFTS = []
for y, xs in ((0.355, (-0.1, -0.034, 0.034, 0.1)), (0.295, (-0.068, 0.0, 0.068)), (0.24, (-0.034, 0.034))):
    for x in xs:
        s = surface_point(body_base, V(x, y, 0.12), (0, 0, 1))
        TUFTS.append((V(x, y + 0.03, s[2] - 0.035), V(x * 1.12, y - 0.055, s[2] + 0.012)))


def body_sdf(p):
    d = body_base(p)
    for a, b in TUFTS:
        d = smin(d, sd_round_cone(p, a, b, 0.04, 0.011), 0.02)
    return d


def body_color(P, N):
    col = np.tile(ORANGE, (len(P), 1))
    col = mix(col, DEEP, smoothstep(0.44, 0.53, P[:, 1]) * 0.45)
    w = sunion([
        sd_ellipsoid(P, V(0, 0.32, 0.34), V(0.15, 0.2, 0.13)),    # 胸前白毛
        sd_ellipsoid(P, V(0, 0.16, 0.0), V(0.15, 0.1, 0.34)),     # 白肚子
        sd_ellipsoid(P, V(0, 0.28, -0.4), V(0.2, 0.1, 0.1)),      # 屁股下緣奶油色
    ], 0.04)
    return mix(col, WHITE, smoothstep(0.01, -0.01, w))


me = build(cage_box((3, 2, 5), V(0, 0.35, 0.0), V(0.2, 0.2, 0.45)), body_sdf,
           skel=[V(0, 0.33, -0.24), V(0, 0.34, 0.12), V(0, 0.42, 0.24)], color=body_color, name='torso')
rig.part('torso', 'body', me, M_FUR)

# ---------------- 頭 ----------------


def head_sdf(p):
    q = p - H
    d = sd_ellipsoid(q, V(0, 0.005, 0), V(0.2, 0.18, 0.2))                     # 頭殼
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(q, V(sx * 0.085, -0.06, 0.06), V(0.115, 0.1, 0.11)), 0.05)  # 肉肉臉頰
        d = smin(d, sd_round_cone(q, V(sx * 0.15, -0.04, 0.0), V(sx * 0.215, -0.095, -0.01), 0.045, 0.012), 0.03)  # 臉頰蓬毛
    d = smin(d, sd_ellipsoid(q, V(0, -0.065, 0.14), V(0.095, 0.075, 0.1)), 0.05)  # 短嘴筒
    return d


def head_color(P, N):
    q = P - H
    col = np.tile(ORANGE, (len(P), 1))
    col = mix(col, DEEP, smoothstep(0.1, 0.18, q[:, 1]) * 0.35)
    w = sunion([
        sd_ellipsoid(q, V(0, -0.075, 0.15), V(0.118, 0.095, 0.13)),   # 嘴筒白
        sd_ellipsoid(q, V(0, -0.13, 0.05), V(0.2, 0.08, 0.17)),       # 下巴與臉頰下緣
        sd_round_cone(q, V(0, 0.17, 0.13), V(0, 0.0, 0.2), 0.018, 0.04),  # 額頭白線
    ], 0.03)
    col = mix(col, WHITE, smoothstep(0.008, -0.008, w))
    for sx in (-1, 1):
        b = sd_sphere(q, V(sx * 0.135, -0.035, 0.13), 0.04)
        col = mix(col, BLUSH, smoothstep(0.02, -0.02, b) * 0.5)
    return col


me = build(cage_box((3, 3, 3), H + V(0, -0.02, 0.04), V(0.24, 0.21, 0.26)), head_sdf,
           skel=[H + V(0, 0.0, -0.05), H + V(0, -0.05, 0.14)], color=head_color, name='skull')
rig.part('skull', 'head', me, M_FUR)

# 鼻子：黑色光亮倒三角
nc = surface_point(head_sdf, H + V(0, -0.028, 0.1), (0, 0.1, 1)) + V(0, 0, 0.004)


def nose_sdf(p):
    return smin(sd_ellipsoid(p, nc + V(0, 0.006, 0), V(0.036, 0.021, 0.022)),
                sd_ellipsoid(p, nc + V(0, -0.01, -0.002), V(0.017, 0.016, 0.018)), 0.012)


me = build(cage_box((1, 1, 1), nc, V(0.04, 0.03, 0.026)), nose_sdf, skel=nc[None], name='nose')
rig.part('nose', 'head', me, M_NOSE)

# 嘴巴：ω 形細線 + 人中
mouth_pts = []
for x, y in ((-0.05, -0.068), (-0.033, -0.087), (-0.014, -0.086), (0.0, -0.074), (0.014, -0.086), (0.033, -0.087), (0.05, -0.068)):
    s = surface_point(head_sdf, H + V(x, y, 0.05), (0, 0, 1))
    mouth_pts.append(s + V(0, 0, -0.001))
ph = [surface_point(head_sdf, H + V(0, y, 0.05), (0, 0, 1)) for y in (nc[1] - H[1] - 0.02, -0.074)]
me = join_meshes([tube_part(mouth_pts, 0.0045, name='mouth_w'), tube_part(ph, 0.0045, name='mouth_ph')])
rig.part('mouth', 'head', me, M_MOUTH)

# 眼睛
add_eye(rig, 'eye_0', 'head', (-0.095, 0.04, 0.17), (0.036, 0.044, 0.021), M_EYE, M_HL, hl_r=0.012)
add_eye(rig, 'eye_1', 'head', (0.095, 0.04, 0.17), (0.036, 0.044, 0.021), M_EYE, M_HL, hl_r=0.012)

# 舌頭（獨立節點，遊戲會開關顯示）
T = H + V(0, -0.14, 0.24)
Rt = rot_x(-0.35)


def tongue_sdf(p):
    q = (p - T) @ Rt
    d = sd_ellipsoid(q, V(0, 0.004, 0.0), V(0.033, 0.047, 0.012))
    d = smin(d, sd_capsule(q, V(0, 0.03, -0.006), V(0, 0.05, -0.02), 0.016), 0.012)
    d = smax(d, -sd_ellipsoid(q, V(0, -0.005, 0.014), V(0.005, 0.034, 0.006)), 0.004)  # 中央淺溝
    return d


me = build(cage_box((1, 2, 1), T + Rt @ V(0, 0.005, 0), V(0.04, 0.08, 0.022), Rt), tongue_sdf,
           skel=[T + Rt @ V(0, 0.035, -0.01), T + Rt @ V(0, -0.025, 0)], name='tongue')
rig.part('tongue', 'head', me, M_TONGUE, origin=(0, -0.14, 0.24))

# ---------------- 耳朵（外傾做進網格，Empty 不旋轉） ----------------
for i, s in ((0, -1), (1, 1)):
    E = rig.world(f'ear_{i}')
    R = rot_z(-s * 0.35) @ rot_x(-0.12) @ rot_y(s * 0.3)

    def outer(q):
        return sd_round_cone(q, V(0, -0.045, 0), V(0, 0.235, 0), 0.09, 0.022)

    def cup(q):
        return sd_round_cone(q, V(0, 0.015, 0.035), V(0, 0.205, 0.018), 0.058, 0.01)

    def ear_sdf(p, E=E, R=R):
        q = (p - E) @ R
        d = sd_flat(q, outer, V(0, 0, 0), None, 0.44)
        d = smax(d, -sd_flat(q, cup, V(0, 0, 0), None, 0.35), 0.012)  # 前面內凹
        return d

    def ear_color(P, N, E=E, R=R):
        q = (P - E) @ R
        col = np.tile(ORANGE, (len(P), 1))
        col = mix(col, DEEP, smoothstep(0.12, 0.22, q[:, 1]) * 0.5)
        c = sd_flat(q, cup, V(0, 0, 0), None, 0.35)
        return mix(col, PINK, smoothstep(0.009, 0.0, c))

    me = build(cage_box((2, 2, 1), E + R @ V(0, 0.09, 0.0), V(0.09, 0.17, 0.04), R), ear_sdf,
               skel=[E + R @ V(0, -0.02, -0.02), E + R @ V(0, 0.2, -0.004)], color=ear_color, name=f'ear_{i}')
    rig.part(f'ear_{i}_mesh', f'ear_{i}', me, M_FUR)

# ---------------- 腿（短腿＋圓腳掌＋白襪）與肉球 ----------------
for i, (x, z) in enumerate(LEGS):
    L = rig.world(f'leg_{i}')
    hind = z < 0
    r_top = 0.068 if hind else 0.06

    def leg_sdf(p, L=L, r_top=r_top):
        d = sd_round_cone(p, L + V(0, 0.03, 0), L + V(0, -0.13, 0.004), r_top, 0.05)
        d = smin(d, sd_ellipsoid(p, L + V(0, -0.162, 0.024), V(0.062, 0.042, 0.078)), 0.03)
        return smax(d, sd_plane(p, V(0, 0.006, 0), V(0, -1, 0)), 0.012)  # 平腳底

    def leg_color(P, N):
        return mix(np.tile(ORANGE, (len(P), 1)), WHITE, smoothstep(0.125, 0.095, P[:, 1]))

    sk = [L + V(0, 0.04, 0), L + V(0, -0.158, 0.026)]
    me = build(cage_capsule(sk, [r_top, 0.07]), leg_sdf, skel=sk, color=leg_color, name=f'leg_{i}')
    rig.part(f'leg_{i}_mesh', f'leg_{i}', me, M_FUR)
    pads = [ellipsoid_part(V(L[0], 0.0095, L[2] + 0.006), V(0.03, 0.007, 0.024), levels=1)]
    for dx in (-0.03, 0.0, 0.03):
        pads.append(ellipsoid_part(V(L[0] + dx, 0.0085, L[2] + 0.056 - abs(dx) * 0.35), V(0.0125, 0.006, 0.0125), levels=1))
    rig.part(f'leg_{i}_pads', f'leg_{i}', join_meshes(pads), M_PAD)

# ---------------- 尾巴：蓬蓬小短尾 ----------------
TL = rig.world('tail')


def tail_sdf(p):
    d = sd_capsule(p, TL + V(0, -0.005, 0.045), TL + V(0, 0.01, -0.03), 0.045)
    d = smin(d, sd_ellipsoid(p, TL + V(0, 0.018, -0.045), V(0.062, 0.058, 0.07)), 0.03)
    for c, r in ((V(0, 0.05, -0.085), 0.034), (V(0.034, 0.02, -0.09), 0.03), (V(-0.034, 0.02, -0.09), 0.03),
                 (V(0, -0.012, -0.09), 0.03), (V(0, 0.07, -0.04), 0.03)):
        d = smin(d, sd_sphere(p, TL + c, r), 0.022)
    return d


def tail_color(P, N):
    q = P - TL
    return mix(np.tile(ORANGE, (len(P), 1)), WHITE, smoothstep(0.02, -0.03, q[:, 1]) * 0.9)


sk = [TL + V(0, -0.005, 0.03), TL + V(0, 0.02, -0.05)]
me = build(cage_capsule(sk, [0.05, 0.065]), tail_sdf, skel=sk, color=tail_color, name='tail')
rig.part('tail_mesh', 'tail', me, M_FUR)

total, _ = rig.stats()
rig.export(os.path.join(MODELS, 'pet_corgi.glb'))
