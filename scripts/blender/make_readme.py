# -*- coding: utf-8 -*-
"""
從 inspect_glb.py 產生的驗收 JSON 自動寫出 public/models/README.md
用法：python3 scripts/blender/make_readme.py <驗收 JSON 資料夾>
"""
import json
import os
import sys
sys.dont_write_bytecode = True  # 不在專案資料夾產生 __pycache__

sys.path.insert(0, os.path.dirname(__file__))
from specs import SPECS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
FILES = [
    ('char_player', '主角 Q 版小農夫'),
    ('pet_corgi', '柯基「麻糬」'),
    ('pet_cat', '橘色虎斑貓「橘子」'),
    ('pet_bunny', '垂耳兔「棉花」'),
    ('pet_duck', '小鴨「嘎嘎」'),
]
HAIRS = ['short', 'bob', 'ponytail', 'pigtails', 'spiky', 'bun']


def fmt(v):
    return f'({v[0]:+.3f}, {v[1]:+.3f}, {v[2]:+.3f})'


out = []
w = out.append
w('# 角色模型（GLB）')
w('')
w('由 `scripts/blender/` 的 Blender 5.2 無頭腳本程式化建模產生，**不要手動改 GLB**，改腳本後重跑：')
w('')
w('```bash')
w('scripts/blender/build_all.sh          # 建模 → 匯出 → 重新匯入驗收 → EEVEE 預覽圖（約 30 秒）')
w('```')
w('')
w('預覽圖在 `concept/models_preview/`（`<名稱>_front.png` 正面 3/4、`<名稱>_side.png` 側面；主角另有 `_back`、髮型並排 `char_player_hairstyles_*`）。')
w('')
w('## 共通規則')
w('')
w('- 座標：Three.js（Y 朝上、角色面向 +Z、單位公尺、原點在腳底中心）。')
w('- 結構：**剛體部件掛在 Empty 樞紐底下的節點階層**，沒有骨架／蒙皮、沒有動畫。遊戲直接轉動樞紐節點。')
w('- 所有節點（Empty 與網格）旋轉皆為 0、縮放皆為 1；下表位置為「相對父節點」。網格的造型（例如耳朵外傾）已做進頂點。')
w('- 網格節點原點＝父樞紐（區域變換為單位矩陣），唯一例外是寵物的 `tongue`（有自己的節點位置）。')
w('- 材質只有 Principled BSDF → 匯出為 `MeshStandardMaterial`，沒有貼圖、沒有使用任何 glTF 擴充。')
w('- 寵物的毛色用**頂點色**（`COLOR_0`，材質 `fur`／`feather` 的 baseColor 為白色），花紋、白襪、腮紅、內耳粉紅都在頂點色裡。')
w('- 造型：少量四邊形籠子 → Catmull-Clark 細分 2 級套用 → 投影到 SDF 有機造型（頭身相接處用 smooth-union 柔和過渡）→ 平滑著色。')
w('  主角髮帽、胸前護片、吊帶是「貼體曲面片」，直接以等同細分 2 級的密度解析取樣（邊界對齊髮際線、邊緣內收進頭皮／衣服）。')
w('  1 cm 級的小零件（眼睛高光、肉球、鬍鬚、嘴巴線條、眉毛、呆毛、髮圈、帽帶、小鴨頭頂捲毛）用 1 級細分以節省面數。')
w('')

for key, title in FILES:
    d = json.load(open(os.path.join(SRC, f'{key}.inspect.json')))
    nodes = d['nodes']
    order = list(SPECS[key].keys())
    empties = sorted([n for n in nodes if n['mesh_tris'] is None], key=lambda n: order.index(n['name']) if n['name'] in order else 99)
    meshes = [n for n in nodes if n['mesh_tris'] is not None]
    lo, hi = d['bbox_three']
    w(f'## `{key}.glb` — {title}')
    w('')
    w(f'- 檔案大小：**{d["size_kb"]} KB**；三角面：**{d["tris"]:,}**')
    w(f'- 材質：{"、".join("`" + m + "`" for m in d["materials"])}')
    w(f'- 頂點色：{"有（COLOR_0）" if d["vertex_color"] else "無"}')
    w(f'- 包圍盒（Three）：x {lo[0]:+.3f}～{hi[0]:+.3f}、y {lo[1]:+.3f}～{hi[1]:+.3f}、z {lo[2]:+.3f}～{hi[2]:+.3f}')
    w(f'- 驗收：{"全部通過（樞紐位置誤差 0.000、旋轉 0、縮放 1）" if not d["problems"] else "；".join(d["problems"])}')
    if key == 'char_player':
        hair_t = {h: sum(n['mesh_tris'] for n in meshes if n['parent'] == f'hair_{h}') for h in HAIRS}
        base = d['tris'] - sum(hair_t.values())
        w('')
        w(f'面數說明：檔案內含 6 種髮型，總面數 {d["tris"]:,}；遊戲一次只顯示一種髮型，**同時可見面數**如下（身體＋帽子 {base:,}）：')
        w('')
        w('| 髮型 | 髮型面數 | 同時可見 |')
        w('|---|---:|---:|')
        for h in HAIRS:
            w(f'| `hair_{h}` | {hair_t[h]:,} | {base + hair_t[h]:,} |')
    w('')
    w('樞紐節點（Empty）：')
    w('')
    w('| 節點 | 父節點 | 位置（相對父，Three） |')
    w('|---|---|---|')
    for n in empties:
        w(f'| `{n["name"]}` | {("`" + n["parent"] + "`") if n["parent"] else "（根）"} | {fmt(n["translation"])} |')
    w('')
    w('網格部件（名稱 ← 父節點：三角面）：')
    w('')
    byp = {}
    for n in meshes:
        byp.setdefault(n['parent'], []).append(n)
    for p, ns in byp.items():
        w(f'- `{p}`：' + '、'.join(f'`{n["name"]}` {n["mesh_tris"]}' + (f'（節點位置 {fmt(n["translation"])}）' if any(abs(x) > 1e-6 for x in n['translation']) else '') for n in ns))
    w('')

w('## 遊戲整合注意事項')
w('')
w('1. **主角髮型**：6 個 `hair_*` 群組預設全部可見，載入後請只留 `look.hair` 對應的那個。髮型換色改 `hair` 材質（眉毛也用 `hair`，會一起換色）；髮圈另用 `hairTie`。')
w('2. **主角軀幹 `torso`** 一個網格含 `shirt`（腰線以上）與 `overall`（腰線以下）兩個材質 → Three.js 會載入成名為 `torso` 的 Group，底下兩個子 Mesh。依材質名稱換色即可。')
w('3. 主角額外材質：`mouth`（張嘴笑）、`hairTie`（髮圈）；其餘 11 個指定材質名稱都有。')
w('4. **主角高度**：依樞紐表（頭樞紐 0.95、頭球心 +0.28、半徑 0.34），頭頂約 1.57 m、戴草帽帽頂約 1.72 m。需求文字寫的「高約 1.3 m／帽頂約 1.55 m」與樞紐表互相矛盾，以樞紐表為準；帽頂必須包住頭頂與頭髮，所以比 1.55 高。')
w('5. **寵物頂點色**：`fur`／`feather` 的顏色來自頂點色。如果遊戲要把材質換成自己的（例如加 rim light），新材質記得 `vertexColors: true`。')
w('6. **垂耳兔耳朵**：網格朝正上方（+Y）延伸約 0.36，靜止姿勢是立耳；遊戲照現有程式把 `ear_0.rotation.z = +2.62`、`ear_1.rotation.z = −2.62` 就會垂到臉頰兩側（預覽圖就是這樣擺的）。')
w('7. **小鴨翅膀**：`wing_*` 樞紐在肩膀、網格往下垂。`pet.ts` 目前對 `wing_0`（−x 側）用正的 `rotation.z`，會讓翼尖往身體內側擺；拍翅要往外張，`wing_0` 應用負值、`wing_1` 用正值（即把現有正負號對調）。')
w('8. 舌頭：柯基、橘貓有 `tongue`；垂耳兔多做了一個小舌頭（規格可省略，做了可用於吐舌）；小鴨沒有 `tongue`（也沒有耳朵與後腳節點）。')
w('9. 柯基身長約 1.08 m（含頭與尾，由頭 z=0.3、尾 z=−0.4 的樞紐決定），比需求文字「約 0.8 m」長；與原程式建模比例一致。')
w('10. 寵物的 `neck_anchor`（領巾）與 `hat_anchor`（小草帽）都是空節點，配件由遊戲掛上。柯基沒有另做項圈，以免與領巾配件重疊。')
w('')

path = os.path.join(ROOT, 'public', 'models', 'README.md')
with open(path, 'w') as f:
    f.write('\n'.join(out) + '\n')
print('已寫出', path)
