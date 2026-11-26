// 右栏行的**必填配置**：`onScreenScope` 缺失必须在构造期抛，而不是退化成「不绑在屏」。
//
// 判据来自踩了八轮的坑：不绑在屏的症状是「右栏空着、控制台干净」，没有任何报错可追。
import { describe, expect, test } from "@morlay/zephyr/testing";
import { SidebarRightDefault } from "../controller.service.ts";

describe("右栏行配置", () => {
  test("没给 onScreenScope：构造期就抛（不静默降级）", () => {
    expect(() => new SidebarRightDefault()).toThrow(/onScreenScope/);
    expect(() => new SidebarRightDefault({})).toThrow(/configure\(SidebarRightDefault/);
  });

  test("给了 onScreenScope：原样落到行上", () => {
    expect(SidebarRightDefault.Config({ onScreenScope: "session" })).toEqual({
      onScreenScope: "session",
    });
    expect(() => SidebarRightDefault.Config({ onScreenScope: "" })).toThrow(/onScreenScope/);
  });
});
