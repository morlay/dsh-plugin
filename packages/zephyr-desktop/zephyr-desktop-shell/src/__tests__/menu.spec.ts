import { describe, expect, it } from "vitest";
import { menuTemplateOf, type MenuItemSpec } from "../menu.ts";

const APP = "Zephyr Custom";
const PLATFORMS = ["darwin", "win32", "linux"] as const;

/** 模板里所有 role（含子菜单）。 */
function rolesOf(items: readonly MenuItemSpec[]): string[] {
  return items
    .flatMap((item) => [item.role, ...(item.submenu === undefined ? [] : rolesOf(item.submenu))])
    .filter((role): role is string => role !== undefined);
}

/** 模板里所有没有 role 也没有子菜单的项（产品自造的项）。 */
function customItemsOf(items: readonly MenuItemSpec[]): MenuItemSpec[] {
  return items.flatMap((item) => [
    ...(item.type === "separator" || item.role !== undefined || item.submenu !== undefined
      ? []
      : [item]),
    ...(item.submenu === undefined ? [] : customItemsOf(item.submenu)),
  ]);
}

describe("产品菜单（裁剪 Electron 的默认菜单）", () => {
  it("mac：第一项是应用菜单，退出项在它下面", () => {
    const template = menuTemplateOf({ platform: "darwin", appName: APP, debug: false });
    expect(template[0]?.label).toBe(APP);
    expect(rolesOf(template[0]?.submenu ?? [])).toContain("quit");
  });

  it("win / linux：没有应用菜单，退出靠关窗", () => {
    for (const platform of ["win32", "linux"] as const) {
      const template = menuTemplateOf({ platform, appName: APP, debug: false });
      expect(template.map((item) => item.label)).not.toContain(APP);
      expect(rolesOf(template)).not.toContain("quit");
    }
  });

  it("调试面关（打包形态）：三平台都没有 Reload 与 DevTools", () => {
    for (const platform of PLATFORMS) {
      const roles = rolesOf(menuTemplateOf({ platform, appName: APP, debug: false }));
      expect(roles).not.toContain("reload");
      expect(roles).not.toContain("forceReload");
      expect(roles).not.toContain("toggleDevTools");
    }
  });

  it("调试面开：才有 Reload 与 DevTools", () => {
    const roles = rolesOf(menuTemplateOf({ platform: "darwin", appName: APP, debug: true }));
    expect(roles).toContain("reload");
    expect(roles).toContain("toggleDevTools");
  });

  it("每一项要么是分隔线、要么是 role、要么是子菜单（本地化与快捷键由 Electron 给）", () => {
    for (const platform of PLATFORMS) {
      expect(customItemsOf(menuTemplateOf({ platform, appName: APP, debug: false }))).toEqual([]);
    }
  });

  it("编辑项覆盖复制粘贴与全选，关窗项挂在窗口菜单下", () => {
    const template = menuTemplateOf({ platform: "linux", appName: APP, debug: false });
    const roles = rolesOf(template);
    for (const role of ["copy", "paste", "cut", "selectAll", "close", "minimize"]) {
      expect(roles).toContain(role);
    }
  });
});
