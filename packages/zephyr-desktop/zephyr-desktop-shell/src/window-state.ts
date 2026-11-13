// 窗口状态：位置与尺寸是**用户数据**（`userData/window-state.json`），不是配置。
//
// 配置只回答「第一次打开时多大」，之后的位置与尺寸由用户拖动决定。两者混在一处，`desktop.json`
// 就会在运行期被改写——部署数据变成可变文件。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 窗口矩形（Electron `Rectangle` 的子集）。 */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 显示器可用区域（Electron 的 `workArea`：已扣掉菜单栏 / 任务栏）。 */
export type WorkArea = WindowBounds;

/** 一次启动要恢复的状态。 */
export interface WindowState {
  readonly bounds: WindowBounds;
  readonly maximized: boolean;
}

/** 状态文件名（在 `userData` 下）。 */
export const WINDOW_STATE_FILE = "window-state.json";

/**
 * 从存档与当前显示器算出这次要用的窗口状态。
 *
 * 存档是**外部输入**（上一个版本的进程写的文件），形状不可信：坏掉就当没有存档。
 * @param saved - 存档内容（`loadWindowState` 的原样返回，或 `undefined`）。
 * @param workArea - 主显示器的可用区域。
 * @param fallback - 配置给的初始尺寸（第一次启动用）。
 * @returns 已夹进工作区的状态。
 */
export function windowStateOf(
  saved: unknown,
  workArea: WorkArea,
  fallback: { readonly width: number; readonly height: number },
): WindowState {
  const bounds = boundsOf(saved);
  if (bounds === undefined) {
    return { bounds: centered(fallback, workArea), maximized: false };
  }
  return { bounds: clampInto(bounds, workArea), maximized: maximizedOf(saved) };
}

/**
 * 读 `userData` 里的存档（原样返回：形状由 {@link windowStateOf} 判）。
 * @param userData - `userData` 目录。
 * @returns 解析后的 JSON，或 `undefined`（没有文件 / 不是 JSON）。
 */
export async function loadWindowState(userData: string): Promise<unknown> {
  const raw = await readFile(join(userData, WINDOW_STATE_FILE), "utf8").catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 写回存档（写不了就算了：下次启动回到配置尺寸，不是功能故障）。
 * @param userData - `userData` 目录。
 * @param state - 关窗时的状态。
 * @returns 写完成。
 */
export async function saveWindowState(userData: string, state: WindowState): Promise<void> {
  await writeFile(
    join(userData, WINDOW_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  ).catch(() => undefined);
}

/**
 * 取存档里的矩形（四项都得是有限数且宽高为正）。
 * @param saved - 存档内容。
 * @returns 矩形，或 `undefined`（形状不成立）。
 */
function boundsOf(saved: unknown): WindowBounds | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const bounds = (saved as { readonly bounds?: unknown }).bounds;
  if (typeof bounds !== "object" || bounds === null) return undefined;
  const { x, y, width, height } = bounds as Record<string, unknown>;
  if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/**
 * @param saved - 存档内容。
 * @returns 存档里的最大化标记（缺省 `false`）。
 */
function maximizedOf(saved: unknown): boolean {
  if (typeof saved !== "object" || saved === null) return false;
  return (saved as { readonly maximized?: unknown }).maximized === true;
}

/**
 * 把矩形夹进工作区：窗口整个落在可见区域内（换显示器 / 拔掉外接屏之后都还在眼前）。
 * @param bounds - 存档里的矩形。
 * @param area - 主显示器的可用区域。
 * @returns 夹好的矩形。
 */
function clampInto(bounds: WindowBounds, area: WorkArea): WindowBounds {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

/**
 * 第一次启动：用配置尺寸，在工作区里居中（与不给 `x/y` 时 Electron 自己的居中一致）。
 * @param size - 配置给的尺寸。
 * @param area - 主显示器的可用区域。
 * @returns 居中后的矩形。
 */
function centered(
  size: { readonly width: number; readonly height: number },
  area: WorkArea,
): WindowBounds {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

/**
 * @param value - 待判的值。
 * @returns 是不是有限数。
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
