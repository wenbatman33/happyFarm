# -*- coding: utf-8 -*-
"""
垂耳兔「棉花」pet_bunny.glb
奶油白麻糬身、大頭鼓臉頰、淡棕長耳（網格朝正上方 +Y 延伸，遊戲會轉下來變垂耳）、
棉花球尾巴、前腳小、後腳大腳掌（腳底粉紅肉球）、胸前蓬毛
用法：Blender -b --python build_bunny.py
"""
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__
sys.path.insert(0, os.path.dirname(__file__))
from farm_lib import *  # noqa: F401,F403

FUR = hexrgb('#f7efe4')
FLUFF = hexrgb('#fffaf3')
TAN = hexrgb('#d8b48a')
PINK = hexrgb('#ffaab8')
BLUSH = hexrgb('#ffa3a8')

rig = Rig('pet_bunny')
M_FUR = material('fur', '#ffffff', rough=0.8, vcol=True)
M_EYE = material('eye', '#1d1512', rough=0.12)
M_HL = material('eyeHighlight', '#ffffff', rough=0.3, emit='#ffffff', emit_strength=0.6)
M_NOSE = material('nose', '#ffaab8', rough=0.4)
M_MOUTH = material('mouth', '#8a5048', rough=0.6)
M_TONGUE = material('tongue', '#ff8597', rough=0.4)
M_PAD = material('pad', '#ffaab8', rough=0.6)

# ---------------- 節點 ----------------
rig.empty('body')
rig.empty('head', 'body', (0, 0.52, 0.18))
LEGS = [(0.1, 0.18), (-0.1, 0.18), (0.15, -0.1), (-0.15, -0.1)]  # 前腳小、後腳大
for i, (x, z) in enumerate(LEGS):
    rig.empty(f'leg_{i}', 'body', (x, 0.1, z))
rig.empty('tail', 'body', (0, 0.3, -0.3))
rig.empty('neck_anchor', 'body', (0, 0.42, 0.22))
rig.empty('ear_0', 'head', (-0.17, 0.13, 0))
rig.empty('ear_1', 'head', (0.17, 0.13, 0))
rig.empty('hat_anchor', 'head', (0, 0.2, 0))
H = rig.world('head')

# ---------------- 身體：圓滾滾麻糬 ----------------


def body_base(p):
    d = sd_ellipsoid(p, V(0, 0.27, -0.04), V(0.245, 0.235, 0.27))
    d = smin(d, sd_ellipsoid(p, V(0, 0.16, -0.06), V(0.255, 0.13, 0.26)), 0.08)   # 下半部較寬（坐姿麻糬）
    d = smin(d, sd_capsule(p, V(0, 0.38, 0.1), V(0, 0.5, 0.17), 0.12), 0.07)      # 脖子伸進頭
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(p, V(sx * 0.14, 0.17, -0.1), V(0.11, 0.13, 0.15)), 0.06)  # 後腿大腿圓鼓
    return d


TUFTS = []
for y, xs in ((0.33, (-0.08, 0.0, 0.08)), (0.27, (-0.045, 0.045))):
    for x in xs:
        s = surface_point(body_base, V(x, y, 0.05), (0, 0, 1))
        TUFTS.append((V(x, y + 0.03, s[2] - 0.03), V(x * 1.1, y - 0.05, s[2] + 0.012)))


def body_sdf(p):
    d = body_base(p)
    for a, b in TUFTS:
        d = smin(d, sd_round_cone(p, a, b, 0.038, 0.01), 0.02)
    return d


def body_color(P, N):
    col = np.tile(FUR, (len(P), 1))
    col = mix(col, TAN, smoothstep(0.03, -0.03, sd_ellipsoid(P, V(0, 0.44, -0.16), V(0.13, 0.08, 0.13))) * 0.8)  # 背上一塊淡棕斑
    w = sd_ellipsoid(P, V(0, 0.27, 0.2), V(0.15, 0.13, 0.1))
    return mix(col, FLUFF, smoothstep(0.01, -0.01, w))


me = build(cage_box((3, 3, 3), V(0, 0.27, -0.04), V(0.3, 0.3, 0.33)), body_sdf,
           skel=[V(0, 0.25, -0.12), V(0, 0.3, 0.05)], color=body_color, name='torso')
rig.part('torso', 'body', me, M_FUR)

# ---------------- 頭：大頭、鼓臉頰 ----------------


def head_sdf(p):
    q = p - H
    d = sd_ellipsoid(q, V(0, 0.01, 0), V(0.235, 0.21, 0.19))
    for sx in (-1, 1):
        d = smin(d, sd_ellipsoid(q, V(sx * 0.1, -0.07, 0.065), V(0.13, 0.11, 0.12)), 0.05)  # 鼓臉頰
        d = smin(d, sd_ellipsoid(q, V(sx * 0.03, -0.062, 0.16), V(0.04, 0.034, 0.038)), 0.02)  # 鬍鬚墊
    d = smin(d, sd_ellipsoid(q, V(0, -0.1, 0.13), V(0.03, 0.025, 0.028)), 0.02)
    return d


def head_color(P, N):
    q = P - H
    col = np.tile(FUR, (len(P), 1))
    col = mix(col, TAN, smoothstep(0.02, -0.02, sd_ellipsoid(q, V(0, 0.19, 0.0), V(0.12, 0.06, 0.13))) * 0.9)  # 頭頂淡棕斑
    for sx in (-1, 1):
        b = sd_sphere(q, V(sx * 0.15, -0.04, 0.13), 0.045)
        col = mix(col, BLUSH, smoothstep(0.02, -0.025, b) * 0.55)
    return col


me = build(cage_box((3, 3, 3), H + V(0, -0.02, 0.02), V(0.28, 0.25, 0.24)), head_sdf,
           skel=[H + V(0, 0.0, -0.05), H + V(0, -0.04, 0.09)], color=head_color, name='skull')
rig.part('skull', 'head', me, M_FUR)

nc = surface_point(head_sdf, H + V(0, -0.03, 0.1), (0, 0.2, 1)) + V(0, 0, 0.002)


def nose_sdf(p):
    return smin(sd_ellipsoid(p, nc + V(0, 0.004, 0), V(0.023, 0.013, 0.013)),
                sd_ellipsoid(p, nc + V(0, -0.006, -0.002), V(0.011, 0.011, 0.011)), 0.008)


me = build(cage_box((1, 1, 1), nc, V(0.027, 0.02, 0.017)), nose_sdf, skel=nc[None], name='nose')
rig.part('nose', 'head', me, M_NOSE)

mouth_pts = [surface_point(head_sdf, H + V(x, y, 0.06), (0, 0, 1)) + V(0, 0, -0.001)
             for x, y in ((-0.04, -0.07), (-0.026, -0.086), (-0.011, -0.085), (0.0, -0.075),
                          (0.011, -0.085), (0.026, -0.086), (0.04, -0.07))]
ph = [surface_point(head_sdf, H + V(0, y, 0.06), (0, 0, 1)) for y in (nc[1] - H[1] - 0.012, -0.075)]
me = join_meshes([tube_part(mouth_pts, 0.0036, name='mouth_w'), tube_part(ph, 0.0036, name='mouth_ph')])
rig.part('mouth', 'head', me, M_MOUTH)

add_eye(rig, 'eye_0', 'head', (-0.11, 0.04, 0.16), (0.04, 0.048, 0.022), M_EYE, M_HL, hl_r=0.013)
add_eye(rig, 'eye_1', 'head', (0.11, 0.04, 0.16), (0.04, 0.048, 0.022), M_EYE, M_HL, hl_r=0.013)

# 小舌頭（兔兔吐舌，規格可省略，這裡做了一個小的）
TO = V(0, -0.1, 0.18)
T = H + TO
Rt = rot_x(-0.4)


def tongue_sdf(p):
    q = (p - T) @ Rt
    d = sd_ellipsoid(q, V(0, 0.0, 0), V(0.017, 0.022, 0.007))
    return smin(d, sd_capsule(q, V(0, 0.014, -0.003), V(0, 0.026, -0.012), 0.009), 0.006)


me = build(cage_box((1, 1, 1), T + Rt @ V(0, 0.006, 0), V(0.02, 0.036, 0.012), Rt), tongue_sdf,
           skel=[T + Rt @ V(0, 0.018, -0.005), T + Rt @ V(0, -0.01, 0)], name='tongue')
rig.part('tongue', 'head', me, M_TONGUE, origin=tuple(TO))

# ---------------- 長耳：從樞紐往正上方 +Y 延伸約 0.36 ----------------
for i, s in ((0, -1), (1, 1)):
    E = rig.world(f'ear_{i}')

    def outer(q):
        return smin(sd_round_cone(q, V(0, -0.03, 0), V(0, 0.2, 0), 0.05, 0.075),
                    sd_round_cone(q, V(0, 0.2, 0), V(0, 0.315, 0), 0.075, 0.05), 0.02)

    def cup(q):
        return sd_round_cone(q, V(0, 0.05, 0.05), V(0, 0.29, 0.05), 0.04, 0.035)

    def ear_sdf(p, E=E):
        q = p - E
        d = sd_flat(q, outer, V(0, 0, 0), None, 0.36)
        return smax(d, -sd_flat(q, cup, V(0, 0, 0), None, 0.3), 0.012)

    def ear_color(P, N, E=E):
        q = P - E
        col = mix(np.tile(FUR, (len(P), 1)), TAN, smoothstep(0.0, 0.07, q[:, 1]))
        c = sd_flat(q, cup, V(0, 0, 0), None, 0.3)
        return mix(col, PINK, smoothstep(0.012, 0.0, c) * smoothstep(0.03, 0.07, q[:, 1]))

    me = build(cage_box((2, 3, 1), E + V(0, 0.17, 0.0), V(0.09, 0.23, 0.035), shape='box'), ear_sdf,
               skel=[E + V(0, 0.0, -0.008), E + V(0, 0.33, -0.006)], color=ear_color, name=f'ear_{i}')
    rig.part(f'ear_{i}_mesh', f'ear_{i}', me, M_FUR)

# ---------------- 腳 ----------------


def fur_col(P, N):
    return np.tile(FUR, (len(P), 1))


for i in (0, 1):  # 前腳：小圓掌
    quad_leg(rig, i, 0.052, 0.05, 0.042, V(0.045, 0.048, 0.055), M_FUR, M_PAD, fur_col, paw_fwd=0.02, pads=False)

for i in (2, 3):  # 後腳：大腳掌
    L = rig.world(f'leg_{i}')
    foot_c = L + V(0, -0.057, 0.045)

    def hind_sdf(p, L=L, foot_c=foot_c):
        d = sd_round_cone(p, L + V(0, 0.03, -0.03), L + V(0, -0.03, 0.0), 0.075, 0.06)
        d = smin(d, sd_ellipsoid(p, foot_c, V(0.068, 0.046, 0.14)), 0.03)
        return smax(d, sd_plane(p, V(0, 0.006, 0), V(0, -1, 0)), 0.012)

    sk = [L + V(0, 0.03, -0.03), foot_c + V(0, 0.005, 0.07)]
    me = build(cage_capsule(sk, [0.075, 0.07]), hind_sdf, skel=sk, color=fur_col, name=f'leg_{i}')
    rig.part(f'leg_{i}_mesh', f'leg_{i}', me, M_FUR)
    ps = [ellipsoid_part(V(foot_c[0], 0.0095, foot_c[2] - 0.03), V(0.034, 0.007, 0.05), levels=1)]
    for dx in (-0.032, 0.0, 0.032):
        ps.append(ellipsoid_part(V(foot_c[0] + dx, 0.0085, foot_c[2] + 0.09 - abs(dx) * 0.4), V(0.014, 0.006, 0.015), levels=1))
    rig.part(f'leg_{i}_pads', f'leg_{i}', join_meshes(ps), M_PAD)

# ---------------- 棉花球尾巴 ----------------
TL = rig.world('tail')
TC = TL + V(0, 0.012, -0.035)
# 棉花雲朵：大球表面均勻分布 10 顆小球（黃金角螺旋），只取朝後半邊
BUMPS = []
for k in range(14):
    yy = 1 - 2 * (k + 0.5) / 14
    rr = math.sqrt(1 - yy * yy)
    th = k * 2.39996
    v = V(rr * math.cos(th), yy, rr * math.sin(th))
    if v[2] < 0.35:
        BUMPS.append(v * V(0.052, 0.052, 0.045) + V(0, 0, -0.012))


def tail_sdf(p):
    d = sd_ellipsoid(p, TC + V(0, 0, -0.01), V(0.066, 0.066, 0.058))
    for b in BUMPS:
        d = smin(d, sd_sphere(p, TC + b, 0.03), 0.02)
    return d


me = build(cage_box((2, 2, 2), TC + V(0, 0, -0.02), V(0.11, 0.11, 0.11)), tail_sdf, skel=TC[None],
           color=lambda P, N: np.tile(hexrgb('#ffffff'), (len(P), 1)), name='tail')
rig.part('tail_mesh', 'tail', me, M_FUR)

total, _ = rig.stats()
rig.export(os.path.join(MODELS, 'pet_bunny.glb'))
