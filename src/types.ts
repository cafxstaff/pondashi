export type Category = "bgm" | "se";

export type Pad = {
  id: string;
  label: string;
  fileId: string;
  fileName: string;
  durationSec: number;
  category: Category;
  loop: boolean;
  /** ボタン個別の音量 (dB) */
  volumeDb: number;
  /** 再生開始前の空白 (秒) */
  leadInSec: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AppSettings = {
  /** "" はシステム既定の出力 */
  outputDeviceId: string;
  /** BGM 切り替え・停止時のフェードアウト時間 (秒) */
  fadeOutSec: number;
  masterVolumeDb: number;
  gridScale: number;
};

export const GRID_COLUMNS = 20;
export const GRID_ROW_HEIGHT = 56;
export const DEFAULT_PAD_SIZE = { w: 4, h: 2 };

export const DEFAULT_SETTINGS: AppSettings = {
  outputDeviceId: "",
  fadeOutSec: 2,
  masterVolumeDb: 0,
  gridScale: 1,
};

export const CATEGORY_DEFAULTS: Record<Category, { leadInSec: number; loop: boolean }> = {
  bgm: { leadInSec: 1, loop: true },
  se: { leadInSec: 0, loop: false },
};

export const CATEGORY_LABEL: Record<Category, string> = {
  bgm: "BGM",
  se: "SE",
};
