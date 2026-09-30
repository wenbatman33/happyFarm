// 遊戲時鐘：正式版 = 現實時間；DEV 工具可以快轉、跳時間

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_LABEL: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

class GameClock {
  private baseReal = Date.now();
  private baseGame = Date.now();
  scale = 1;
  seasonOverride: Season | null = null; // DEV：強制季節
  hourOverride: number | null = null; // DEV：光影時段預覽（不影響作物）
  south = false; // 南半球：季節對調（設定裡切換）

  now(): number {
    return this.baseGame + (Date.now() - this.baseReal) * this.scale;
  }

  setScale(s: number): void {
    const n = this.now();
    this.baseReal = Date.now();
    this.baseGame = n;
    this.scale = s;
  }

  jump(ms: number): void {
    const n = this.now();
    this.baseReal = Date.now();
    this.baseGame = n + ms;
  }

  // 目前與現實時間的差距（DEV 設定存檔用）
  get offset(): number {
    return this.now() - Date.now();
  }

  restore(offset: number, scale: number): void {
    this.baseReal = Date.now();
    this.baseGame = Date.now() + offset;
    this.scale = scale;
  }

  reset(): void {
    this.restore(0, 1);
  }

  season(t = this.now()): Season {
    if (this.seasonOverride) return this.seasonOverride;
    let m = new Date(t).getMonth() + 1;
    if (this.south) m = ((m + 5) % 12) + 1;
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }

  // 光影用的小時（含小數）
  hour(t = this.now()): number {
    if (this.hourOverride !== null) return this.hourOverride;
    const d = new Date(t);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
}

export const clock = new GameClock();

export const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
