import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadWindowState, saveWindowState, windowStateOf } from "../window-state.ts";

/** 一块 1440×876、顶上有 24px 菜单栏的显示器。 */
const AREA = { x: 0, y: 24, width: 1440, height: 876 };

/** 配置给的初始尺寸（只当第一次启动的缺省）。 */
const FALLBACK = { width: 1280, height: 800 };

describe("窗口状态（用户数据，不进配置）", () => {
  it("没有存档：用配置尺寸并在工作区里居中", () => {
    expect(windowStateOf(undefined, AREA, FALLBACK)).toEqual({
      bounds: { x: 80, y: 62, width: 1280, height: 800 },
      maximized: false,
    });
  });

  it("存档落在拔掉的显示器上：夹回工作区，尺寸不变", () => {
    const saved = { bounds: { x: 3000, y: 100, width: 1280, height: 800 }, maximized: false };
    expect(windowStateOf(saved, AREA, FALLBACK).bounds).toEqual({
      x: 160,
      y: 100,
      width: 1280,
      height: 800,
    });
  });

  it("存档比工作区还大：收到工作区的尺寸", () => {
    const saved = { bounds: { x: 0, y: 0, width: 2000, height: 1200 }, maximized: false };
    expect(windowStateOf(saved, AREA, FALLBACK).bounds).toEqual({
      x: 0,
      y: 24,
      width: 1440,
      height: 876,
    });
  });

  it("最大化标记原样带回", () => {
    const saved = { bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: true };
    expect(windowStateOf(saved, AREA, FALLBACK).maximized).toBe(true);
  });

  it("存档字段坏了就当没有存档（文件是外部输入，形状不可信）", () => {
    for (const broken of [
      {},
      { bounds: { x: "1" } },
      { bounds: { x: 1, y: 2, width: 0, height: 3 } },
    ]) {
      expect(windowStateOf(broken, AREA, FALLBACK)).toEqual({
        bounds: { x: 80, y: 62, width: 1280, height: 800 },
        maximized: false,
      });
    }
  });

  it("存盘再读回：形状一致（state 文件只有这一个真源）", async () => {
    const userData = await mkdtemp(join(tmpdir(), "dsh-window-state-"));
    const state = { bounds: { x: 10, y: 30, width: 900, height: 700 }, maximized: true };
    await saveWindowState(userData, state);
    expect(windowStateOf(await loadWindowState(userData), AREA, FALLBACK)).toEqual(state);
  });
});
