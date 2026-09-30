import * as THREE from 'three';
import type { Grid, Pt } from '../world/grid';
import { tileOf } from '../world/grid';

// 共用的路徑移動器：主角和寵物都用它
export class Mover {
  path: Pt[] = [];
  speed = 4.5;
  moving = false;
  yawGoal = 0;
  private onArrive: (() => void) | null = null;

  constructor(public obj: THREE.Object3D, private grid: Grid) {}

  // 尋路到世界座標；stopShort = 停在目標前方多少距離
  goTo(x: number, z: number, onArrive?: () => void, stopShort = 0): boolean {
    const from = { x: this.obj.position.x, z: this.obj.position.z };
    const st = tileOf(from.x, from.z);
    let tt = tileOf(x, z);
    if (this.grid.isBlocked(tt.x, tt.z)) {
      const nf = this.grid.nearestFree(tt.x, tt.z, from);
      if (!nf) return false;
      tt = nf;
    }
    let startTile = st;
    if (this.grid.isBlocked(st.x, st.z)) startTile = this.grid.nearestFree(st.x, st.z) ?? st;
    const tiles = this.grid.findPath(startTile.x, startTile.z, tt.x, tt.z);
    if (!tiles) return false;
    let goal: Pt = this.grid.isBlocked(Math.round(x), Math.round(z)) ? { x: tt.x, z: tt.z } : { x, z };
    const pts = this.grid.smooth(from, tiles, goal);
    if (stopShort > 0 && pts.length) {
      const last = pts[pts.length - 1];
      const prev = pts.length > 1 ? pts[pts.length - 2] : from;
      const dx = last.x - prev.x, dz = last.z - prev.z;
      const d = Math.hypot(dx, dz);
      if (d > stopShort) {
        goal = { x: last.x - (dx / d) * stopShort, z: last.z - (dz / d) * stopShort };
        pts[pts.length - 1] = goal;
      } else {
        pts.pop();
      }
    }
    this.path = pts;
    this.onArrive = onArrive ?? null;
    this.moving = true;
    if (!pts.length) this.finish();
    return true;
  }

  stop(): void {
    this.path = [];
    this.moving = false;
    this.onArrive = null;
  }

  private finish() {
    this.moving = false;
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  face(x: number, z: number): void {
    this.yawGoal = Math.atan2(x - this.obj.position.x, z - this.obj.position.z);
  }

  update(dt: number): void {
    if (this.moving && this.path.length) {
      const p = this.obj.position;
      const tgt = this.path[0];
      const dx = tgt.x - p.x, dz = tgt.z - p.z;
      const d = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (d <= step) {
        p.x = tgt.x;
        p.z = tgt.z;
        this.path.shift();
        if (!this.path.length) this.finish();
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        this.yawGoal = Math.atan2(dx, dz);
      }
    }
    let dy = this.yawGoal - this.obj.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.obj.rotation.y += dy * (1 - Math.exp(-14 * dt));
  }
}
