// 产品菜单：**纯函数**给出模板，装到 Electron 上只是 `setApplicationMenu(buildFromTemplate(...))`。
//
// 为什么要有它：不调 `setApplicationMenu` 时 Electron 会自己装一份默认菜单——英文，且打包形态里
// Reload / Toggle DevTools 一样可用。这里裁掉那些项，其余交给 `role`（本地化与快捷键由 Electron 给）。
/** 菜单项（Electron `MenuItemConstructorOptions` 的子集：只有 role、分隔线与子菜单）。 */
export interface MenuItemSpec {
  readonly role?: string;
  /** 顶层菜单的标题（与 macOS 的应用菜单名）。 */
  readonly label?: string;
  readonly type?: "separator";
  readonly submenu?: readonly MenuItemSpec[];
}

/** 造菜单要的部署值。 */
export interface MenuTemplateInput {
  /** 平台（注入以便测三个平台）。 */
  readonly platform: NodeJS.Platform;
  /** 应用名（macOS 应用菜单的标题）。 */
  readonly appName: string;
  /** 调试面：决定视图菜单里有没有 Reload 与 DevTools。 */
  readonly debug: boolean;
}

/** 分隔线。 */
const SEPARATOR: MenuItemSpec = { type: "separator" };

/**
 * 按平台与调试面给出菜单模板。
 * @param input - 平台、应用名与调试面。
 * @returns 顶层菜单项（可直接交给 `Menu.buildFromTemplate`）。
 */
export function menuTemplateOf(input: MenuTemplateInput): readonly MenuItemSpec[] {
  const menus: MenuItemSpec[] = [
    { label: "编辑", submenu: editMenu() },
    { label: "视图", submenu: viewMenu(input.debug) },
    { label: "窗口", submenu: windowMenu() },
  ];
  // macOS 的惯例：第一项是应用菜单（About / Services / Hide / Quit），其它平台没有这一项。
  if (input.platform !== "darwin") return menus;
  return [{ label: input.appName, submenu: appMenu() }, ...menus];
}

/**
 * @returns 应用菜单（macOS）。
 */
function appMenu(): readonly MenuItemSpec[] {
  return [
    { role: "about" },
    SEPARATOR,
    { role: "services" },
    SEPARATOR,
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    SEPARATOR,
    { role: "quit" },
  ];
}

/**
 * @returns 编辑菜单（全是 role：剪贴板的规则不自己实现）。
 */
function editMenu(): readonly MenuItemSpec[] {
  return [
    { role: "undo" },
    { role: "redo" },
    SEPARATOR,
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "pasteAndMatchStyle" },
    { role: "delete" },
    { role: "selectAll" },
  ];
}

/**
 * @param debug - 调试面：关着时不给 Reload / DevTools（打包形态不该有换页面与开调试器的入口）。
 * @returns 视图菜单。
 */
function viewMenu(debug: boolean): readonly MenuItemSpec[] {
  const dev: MenuItemSpec[] = debug
    ? [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, SEPARATOR]
    : [];
  return [
    ...dev,
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    SEPARATOR,
    { role: "togglefullscreen" },
  ];
}

/**
 * @returns 窗口菜单（关窗走这里：快捷键录制期间壳会把菜单快捷键让给页面）。
 */
function windowMenu(): readonly MenuItemSpec[] {
  return [{ role: "minimize" }, { role: "zoom" }, SEPARATOR, { role: "close" }];
}
