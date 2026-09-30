#!/bin/zsh
# 一鍵重建 5 個角色：建模匯出 GLB → 重新匯入驗收 → EEVEE 預覽圖
# 用法：scripts/blender/build_all.sh [輸出驗收 JSON 的資料夾，預設 /tmp]
set -e
B=${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}
D=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$D/../.." && pwd)
OUT=${1:-/tmp}
cd "$ROOT"
for n in corgi cat bunny duck player; do
  echo "=== 建模 $n ==="
  $B -b --python "$D/build_$n.py" 2>&1 | grep -E "合計|同時可見|不含髮型|已匯出|警告|Error|Traceback" || true
done
for f in pet_corgi pet_cat pet_bunny pet_duck char_player; do
  echo "=== 驗收 $f ==="
  $B -b --python "$D/inspect_glb.py" -- "public/models/$f.glb" "$f" --json "$OUT/$f.inspect.json" 2>&1 | grep -E "結果|  -|✗" || true
done
P=concept/models_preview
$B -b --python "$D/render_preview.py" -- public/models/pet_corgi.glb $P/pet_corgi >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/pet_cat.glb $P/pet_cat >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/pet_bunny.glb $P/pet_bunny --pose '{"ear_0":[0,0,2.62],"ear_1":[0,0,-2.62]}' >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/pet_duck.glb $P/pet_duck >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/char_player.glb $P/char_player --views front,side,back >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/char_player.glb $P/char_player_hairstyles --lineup --views front,back --az 20 --el 10 >/dev/null 2>&1
$B -b --python "$D/render_preview.py" -- public/models/char_player.glb $P/char_player_hairstyles_hat --lineup --hat --views front,back --az 30 --el 14 >/dev/null 2>&1
echo "預覽圖已輸出到 $P"
python3 "$D/make_readme.py" "$OUT"
