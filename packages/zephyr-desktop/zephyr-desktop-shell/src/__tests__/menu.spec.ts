import { describe, expect, test } from "@morlay/zephyr/testing";
import { menuTemplateOf, type MenuActions, type MenuItemSpec } from "../menu.ts";

const APP = "Zephyr Custom";
const PLATFORMS = ["darwin", "win32", "linux"] as const;

/** 模板里所有 role（含子菜单）。 */
function rolesOf(items: readonly MenuItemSpec[]): string[] {
  return items
    .flatMap((item) => [item.role, ...(item.submenu === undefined ? [] : rolesOf(item.submenu))])
    .filter((role): role is string => role !== undefined);
}

/** 模板里所有文案（含子菜单）。 */
function labelsOf(items: readonly MenuItemSpec[]): string[] {
  return items.flatMap((item) => [
    ...(item.label === undefined ? [] : [item.label]),
    ...(item.submenu === undefined ? [] : labelsOf(item.submenu)),
  ]);
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

/**
 * @param template - 顶层菜单。
 * @returns 视图菜单的子项。
 */
function viewMenuOf(template: readonly MenuItemSpec[]): readonly MenuItemSpec[] {
  return template.find((item) => item.label === "视图")?.submenu ?? [];
}

/**
 * @param template - 顶层菜单。
 * @returns 「开发者模式」那一项。
 */
function devModeItemOf(template: readonly MenuItemSpec[]): MenuItemSpec | undefined {
  return viewMenuOf(template).find((item) => item.label === "开发者模式");
}

describe("产品菜单（裁剪 Electron 的默认菜单）", () => {
  test("mac：第一项是应用菜单，退出项在它下面", () => {
    const template = menuTemplateOf({ platform: "darwin", appName: APP, debug: false });
    expect(template[0]?.label).toBe(APP);
    expect(rolesOf(template[0]?.submenu ?? [])).toContain("quit");
  });

  test("win / linux：没有应用菜单，退出靠关窗", () => {
    for (const platform of ["win32", "linux"] as const) {
      const template = menuTemplateOf({ platform, appName: APP, debug: false });
      expect(template.map((item) => item.label)).not.toContain(APP);
      expect(rolesOf(template)).not.toContain("quit");
    }
  });

  test("开发者模式关（打包形态无参数启动）：没有 Reload / DevTools，也没有 Inspector 两项", () => {
    for (const platform of PLATFORMS) {
      const template = menuTemplateOf({ platform, appName: APP, debug: false });
      const roles = rolesOf(template);
      expect(roles).not.toContain("reload");
      expect(roles).not.toContain("forceReload");
      expect(roles).not.toContain("toggleDevTools");
      const labels = labelsOf(template);
      expect(labels).not.toContain("打开主进程 Inspector");
      expect(labels).not.toContain("复制 Inspector 地址");
    }
  });

  test("开发者模式开：才有 Reload 与 DevTools", () => {
    const roles = rolesOf(menuTemplateOf({ platform: "darwin", appName: APP, debug: true }));
    expect(roles).toContain("reload");
    expect(roles).toContain("toggleDevTools");
  });

  test("视图菜单底部是「开发者模式」勾选项：checked 跟随状态，点它调动作", () => {
    const clicks: string[] = [];
    const on: MenuActions = {
      toggleDevMode: () => clicks.push("dev"),
      toggleInspector: () => clicks.push("inspector"),
      copyInspectorAddress: () => clicks.push("copy"),
    };
    for (const platform of PLATFORMS) {
      const item = devModeItemOf(menuTemplateOf({ platform, appName: APP, debug: false, on }));
      expect(item?.label).toBe("开发者模式");
      expect(item?.type).toBe("checkbox");
      expect(item?.checked).toBe(false);
      expect(item?.accelerator).toBe("CmdOrCtrl+Shift+D");
      item?.click?.();
    }
    expect(
      devModeItemOf(menuTemplateOf({ platform: "darwin", appName: APP, debug: true }))?.checked,
    ).toBe(true);
    expect(clicks).toEqual(["dev", "dev", "dev"]);
  });

  test("产品自造项只有「开发者模式」与开发项里的那两条（其余交给 role：本地化与快捷键由 Electron 给）", () => {
    for (const platform of PLATFORMS) {
      expect(
        customItemsOf(menuTemplateOf({ platform, appName: APP, debug: false })).map((i) => i.label),
      ).toEqual(["开发者模式"]);
      expect(
        customItemsOf(menuTemplateOf({ platform, appName: APP, debug: true })).map((i) => i.label),
      ).toEqual(["打开主进程 Inspector", "复制 Inspector 地址", "开发者模式"]);
    }
  });

  test("编辑项覆盖复制粘贴与全选，关窗项挂在窗口菜单下", () => {
    const template = menuTemplateOf({ platform: "linux", appName: APP, debug: false });
    const roles = rolesOf(template);
    for (const role of ["copy", "paste", "cut", "selectAll", "close", "minimize"]) {
      expect(roles).toContain(role);
    }
  });
});
