// @vitest-environment happy-dom
// 时间筛选的窗口是**本地自然日**的边界（与宿主统计 `localDayKey` 同一口径：host 本地时区的零点）：
// 「近 7 天」= 今天零点往前 6 天（含今天共 7 个自然日），不是 `Date.now() - 7 × 24h` 的滚动窗口。
//
// 期望值来自规格原文与日历本身（手写的本地年月日），不与被测代码用同一种方式算出来。
import { describe, expect, it } from "vitest";
import { localDayWindowStart } from "../rows-query.ts";

describe("时间筛选：本地自然日窗口", () => {
  it("近 7 天从 6 天前的本地零点起，不是 7 × 24 小时前的此刻", () => {
    // 固定时刻：2026-03-10 15:30:12.345（本地）。
    const now = new Date(2026, 2, 10, 15, 30, 12, 345).getTime();
    expect(localDayWindowStart(now, 7)).toBe(new Date(2026, 2, 4, 0, 0, 0, 0).getTime());
    // 近 30 天同理：往前 29 天，跨月落在 2 月 9 日的零点。
    expect(localDayWindowStart(now, 30)).toBe(new Date(2026, 1, 9, 0, 0, 0, 0).getTime());
  });

  it("按日历日回退：跨月也落在本地零点", () => {
    const now = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
    const start = new Date(localDayWindowStart(now, 2));
    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    ]).toEqual([2026, 0, 1, 0, 0, 0, 0]);
  });
});
