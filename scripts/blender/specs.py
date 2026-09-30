# -*- coding: utf-8 -*-
"""
各角色的樞紐規格（Three.js 座標，位置為「相對父節點」）
驗收腳本 inspect_glb.py 會拿 GLB 的節點與這張表比對（容許 ±0.01）
"""

_PET_COMMON = ['body', 'head', 'tail', 'eye_0', 'eye_1', 'hat_anchor', 'neck_anchor']

SPECS = {
    'char_player': {
        'body': (None, (0, 0, 0)),
        'legL': ('body', (0.12, 0.3, 0)),
        'legR': ('body', (-0.12, 0.3, 0)),
        'armL': ('body', (0.29, 0.86, 0)),
        'armR': ('body', (-0.29, 0.86, 0)),
        'handR': ('armR', (0, -0.36, 0.02)),
        'head': ('body', (0, 0.95, 0)),
        'eye_0': ('head', (-0.12, 0.27, 0.30)),
        'eye_1': ('head', (0.12, 0.27, 0.30)),
        'hat': ('head', (0, 0.52, 0)),
        'hair_short': ('head', (0, 0, 0)),
        'hair_bob': ('head', (0, 0, 0)),
        'hair_ponytail': ('head', (0, 0, 0)),
        'hair_pigtails': ('head', (0, 0, 0)),
        'hair_spiky': ('head', (0, 0, 0)),
        'hair_bun': ('head', (0, 0, 0)),
    },
    'pet_corgi': {
        'body': (None, (0, 0, 0)),
        'head': ('body', (0, 0.55, 0.3)),
        'leg_0': ('body', (0.12, 0.2, 0.2)),
        'leg_1': ('body', (-0.12, 0.2, 0.2)),
        'leg_2': ('body', (0.12, 0.2, -0.2)),
        'leg_3': ('body', (-0.12, 0.2, -0.2)),
        'tail': ('body', (0, 0.42, -0.4)),
        'ear_0': ('head', (-0.12, 0.14, -0.03)),
        'ear_1': ('head', (0.12, 0.14, -0.03)),
        'eye_0': ('head', (-0.095, 0.04, 0.17)),
        'eye_1': ('head', (0.095, 0.04, 0.17)),
        'hat_anchor': ('head', (0, 0.2, 0.02)),
        'neck_anchor': ('body', (0, 0.42, 0.24)),
        'tongue': ('head', (0, -0.14, 0.24)),
    },
    'pet_cat': {
        'body': (None, (0, 0, 0)),
        'head': ('body', (0, 0.66, 0.3)),
        'leg_0': ('body', (0.1, 0.28, 0.2)),
        'leg_1': ('body', (-0.1, 0.28, 0.2)),
        'leg_2': ('body', (0.1, 0.28, -0.2)),
        'leg_3': ('body', (-0.1, 0.28, -0.2)),
        'tail': ('body', (0, 0.46, -0.36)),
        'ear_0': ('head', (-0.13, 0.15, 0)),
        'ear_1': ('head', (0.13, 0.15, 0)),
        'eye_0': ('head', (-0.1, 0.03, 0.16)),
        'eye_1': ('head', (0.1, 0.03, 0.16)),
        'hat_anchor': ('head', (0, 0.2, 0)),
        'neck_anchor': ('body', (0, 0.52, 0.26)),
        'tongue': ('head', (0, -0.13, 0.2)),
    },
    'pet_bunny': {
        'body': (None, (0, 0, 0)),
        'head': ('body', (0, 0.52, 0.18)),
        'leg_0': ('body', (0.1, 0.1, 0.18)),
        'leg_1': ('body', (-0.1, 0.1, 0.18)),
        'leg_2': ('body', (0.15, 0.1, -0.1)),
        'leg_3': ('body', (-0.15, 0.1, -0.1)),
        'tail': ('body', (0, 0.3, -0.3)),
        'ear_0': ('head', (-0.17, 0.13, 0)),
        'ear_1': ('head', (0.17, 0.13, 0)),
        'eye_0': ('head', (-0.11, 0.04, 0.16)),
        'eye_1': ('head', (0.11, 0.04, 0.16)),
        'hat_anchor': ('head', (0, 0.2, 0)),
        'neck_anchor': ('body', (0, 0.42, 0.22)),
    },
    'pet_duck': {
        'body': (None, (0, 0, 0)),
        'head': ('body', (0, 0.62, 0.14)),
        'leg_0': ('body', (0.1, 0.1, 0.02)),
        'leg_1': ('body', (-0.1, 0.1, 0.02)),
        'wing_0': ('body', (-0.21, 0.36, 0)),
        'wing_1': ('body', (0.21, 0.36, 0)),
        'tail': ('body', (0, 0.42, -0.26)),
        'eye_0': ('head', (-0.1, 0.05, 0.14)),
        'eye_1': ('head', (0.1, 0.05, 0.14)),
        'hat_anchor': ('head', (0, 0.18, 0)),
        'neck_anchor': ('body', (0, 0.5, 0.14)),
    },
}

# 不可以出現的節點（例如小鴨沒有耳朵、後腳）
FORBIDDEN = {
    'pet_duck': ['ear_0', 'ear_1', 'leg_2', 'leg_3'],
}

# 主角必要材質名稱
PLAYER_MATERIALS = ['skin', 'hair', 'overall', 'shirt', 'shoe', 'straw', 'hatband', 'eye', 'eyeHighlight', 'cheek', 'button']
