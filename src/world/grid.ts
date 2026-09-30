// 農場格網：1 格 = 1 公尺，格座標 -15..15；負責阻擋判斷與 A* 尋路

export const HALF = 15;
export const SIZE = HALF * 2 + 1;

export interface Tile { x: number; z: number }
export interface Pt { x: number; z: number }

export const tileOf = (x: number, z: number): Tile => ({ x: Math.round(x), z: Math.round(z) });

export class Grid {
  blocked = new Uint8Array(SIZE * SIZE);
  path = new Uint8Array(SIZE * SIZE); // 小徑（雜草不會長在上面）

  idx(x: number, z: number): number {
    return (z + HALF) * SIZE + (x + HALF);
  }

  inBounds(x: number, z: number): boolean {
    return x >= -HALF && x <= HALF && z >= -HALF && z <= HALF;
  }

  isBlocked(x: number, z: number): boolean {
    return !this.inBounds(x, z) || this.blocked[this.idx(x, z)] === 1;
  }

  clear(): void {
    this.blocked.fill(0);
    this.path.fill(0);
  }

  // 以矩形（中心、寬、深）阻擋格子
  blockRect(cx: number, cz: number, w: number, d: number): void {
    for (let z = -HALF; z <= HALF; z++) {
      for (let x = -HALF; x <= HALF; x++) {
        if (Math.abs(x - cx) < w / 2 + 0.2 && Math.abs(z - cz) < d / 2 + 0.2) this.blocked[this.idx(x, z)] = 1;
      }
    }
  }

  nearestFree(x: number, z: number, from?: Pt): Tile | null {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= 4 && !best; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = x + dx, tz = z + dz;
          if (this.isBlocked(tx, tz)) continue;
          const d = from ? Math.hypot(tx - from.x, tz - from.z) : Math.hypot(dx, dz);
          if (d < bestD) { bestD = d; best = { x: tx, z: tz }; }
        }
      }
    }
    return best;
  }

  // 8 方向 A*，不允許斜角穿過牆角
  findPath(sx: number, sz: number, tx: number, tz: number): Tile[] | null {
    if (this.isBlocked(tx, tz)) return null;
    const start = this.inBounds(sx, sz) ? this.idx(sx, sz) : -1;
    const goal = this.idx(tx, tz);
    if (start < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const g = new Float32Array(SIZE * SIZE).fill(Infinity);
    const came = new Int32Array(SIZE * SIZE).fill(-1);
    const closed = new Uint8Array(SIZE * SIZE);
    const open: number[] = [start];
    const f = new Float32Array(SIZE * SIZE).fill(Infinity);
    g[start] = 0;
    const h = (i: number) => {
      const x = (i % SIZE) - HALF, z = Math.floor(i / SIZE) - HALF;
      const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    f[start] = h(start);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) {
        const out: Tile[] = [];
        for (let c = cur; c !== -1; c = came[c]) out.push({ x: (c % SIZE) - HALF, z: Math.floor(c / SIZE) - HALF });
        return out.reverse();
      }
      closed[cur] = 1;
      const cx = (cur % SIZE) - HALF, cz = Math.floor(cur / SIZE) - HALF;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
          const ni = this.idx(nx, nz);
          if (closed[ni]) continue;
          const ng = g[cur] + (dx && dz ? 1.414 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(ni);
            came[ni] = cur;
            if (!open.includes(ni)) open.push(ni);
          }
        }
      }
    }
    return null;
  }

  // 世界座標直線是否可走（取樣檢查，含角色半徑）
  lineWalkable(a: Pt, b: Pt, radius = 0.28): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    const nx = -(b.z - a.z) / (len || 1), nz = (b.x - a.x) / (len || 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      for (const s of [-radius, 0, radius]) {
        const tt = tileOf(x + nx * s, z + nz * s);
        if (this.isBlocked(tt.x, tt.z)) return false;
      }
    }
    return true;
  }

  // 把格子路徑拉直成較少的轉折點
  smooth(from: Pt, tiles: Tile[], to: Pt): Pt[] {
    const pts: Pt[] = [...tiles.map((t) => ({ x: t.x, z: t.z }))];
    pts[pts.length - 1] = to;
    const out: Pt[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineWalkable(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}
