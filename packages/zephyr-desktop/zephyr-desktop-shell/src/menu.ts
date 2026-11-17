// 产品菜单：**纯函数**给出模板，装到 Electron 上只是 `setApplicationMenu(buildFromTemplate(...))`。
//
// 为什么要有它：不调 `setApplicationMenu` 时 Electron 会自己装一份默认菜单——英文，且打包形态里
// Reload / Toggle DevTools 一样可用。这里裁掉那些项，其余交给 `role`（本地化与快捷键由 Electron 给）。
//
// 两种自造项是**入口**而不是能力：视图菜单底部的「开发者模式」是唯一的写口，开发项里的 Inspector 两项
// 是主进程调试端口的开关与它的地址。它们只画菜单，动作由装配方经 {@link MenuActions} 注入。
/** 菜单项（Electron `MenuItemConstructorOptions` 的子集）。 */
export interface MenuItemSpec {
  readonly role?: string;
  /** 顶层菜单的标题（与 macOS 的应用菜单名）。 */
  readonly label?: string;
  readonly type?: "separator" | "checkbox";
  /** 勾选（`type: "checkbox"` 才有意义）。 */
  readonly checked?: boolean;
  /** 能不能点（打不开的 Inspector 项标灰，不弹窗）。 */
  readonly enabled?: boolean;
  /** 快捷键（Electron 的写法：`CmdOrCtrl` 在 mac 是 ⌘、其它平台是 Ctrl）。 */
  readonly accelerator?: string;
  readonly click?: () => void;
  readonly submenu?: readonly MenuItemSpec[];
}

/** 主进程 Inspector 在菜单里的样子（由 `InspectorPort` 的读数给出）。 */
export interface InspectorMenuState {
  /** 开着没有（决定勾选）。 */
  readonly opened: boolean;
  /** 地址（开着时才有：复制项要用它）。 */
  readonly address?: string;
  /** 曾经打不开（端口全占）：两项标灰，等下一次切换再试。 */
  readonly failed?: boolean;
}

/** 自造项的点击回调（纯函数只画菜单，动作由装配方注入）。 */
export interface MenuActions {
  /** 「开发者模式」：切一次并持久化。 */
  readonly toggleDevMode: () => void;
  /** 「打开主进程 Inspector」：开或关。 */
  readonly toggleInspector: () => void;
  /** 「复制 Inspector 地址」：把地址放进剪贴板。 */
  readonly copyInspectorAddress: () => void;
}

/** 造菜单要的部署值。 */
export interface MenuTemplateInput {
  /** 平台（注入以便测三个平台）。 */
  readonly platform: NodeJS.Platform;
  /** 应用名（macOS 应用菜单的标题）。 */
  readonly appName: string;
  /** 开发者模式：关着时视图菜单只有「开发者模式」一项（无 Reload / DevTools / Inspector）。 */
  readonly debug: boolean;
  /** 主进程 Inspector 的状态（缺省当作关着：没接适配器时也画得出菜单）。 */
  readonly inspector?: InspectorMenuState;
  /** 点击回调（缺省时这些项仍在，只是不挂动作——便于测试断言）。 */
  readonly on?: MenuActions;
}

/** 「开发者模式」的快捷键（`CmdOrCtrl` 在两个平台上就是 ⌘⇧D / Ctrl+Shift+D）。 */
const DEV_MODE_ACCELERATOR = "CmdOrCtrl+Shift+D";

/** 分隔线。 */
const SEPARATOR: MenuItemSpec = { type: "separator" };

/**
 * 按平台、开发者模式与 Inspector 状态给出菜单模板。
 * @param input - 平台、应用名、开发者模式、Inspector 状态与点击回调。
 * @returns 顶层菜单项（可直接交给 `Menu.buildFromTemplate`）。
 */
export function menuTemplateOf(input: MenuTemplateInput): readonly MenuItemSpec[] {
  const menus: MenuItemSpec[] = [
    { label: "编辑", submenu: editMenu() },
    { label: "视图", submenu: viewMenu(input) },
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
 * @param input - 开发者模式与 Inspector 状态（点击回调从这里透给自造项）。
 * @returns 视图菜单：开发者模式关着时开发项整体收起，开关本身一直在最底下。
 */
function viewMenu(input: MenuTemplateInput): readonly MenuItemSpec[] {
  const dev: MenuItemSpec[] = input.debug
    ? [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        SEPARATOR,
        ...inspectorMenu(input.inspector ?? { opened: false }, input.on),
        SEPARATOR,
      ]
    : [];
  const devMode: MenuItemSpec = {
    label: "开发者模式",
    type: "checkbox",
    checked: input.debug,
    accelerator: DEV_MODE_ACCELERATOR,
    ...(input.on === undefined ? {} : { click: input.on.toggleDevMode }),
  };
  return [
    ...dev,
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    SEPARATOR,
    { role: "togglefullscreen" },
    SEPARATOR,
    devMode,
  ];
}

/**
 * @param inspector - Inspector 的状态（勾选 / 地址 / 打不开过）。
 * @param on - 点击回调。
 * @returns 开发项里与 Inspector 有关的两项。
 */
function inspectorMenu(
  inspector: InspectorMenuState,
  on: MenuActions | undefined,
): readonly MenuItemSpec[] {
  const failed = inspector.failed === true;
  return [
    {
      label: "打开主进程 Inspector",
      type: "checkbox",
      checked: inspector.opened,
      enabled: !failed,
      ...(on === undefined ? {} : { click: on.toggleInspector }),
    },
    {
      label: "复制 Inspector 地址",
      enabled: !failed && inspector.address !== undefined,
      ...(on === undefined ? {} : { click: on.copyInspectorAddress }),
    },
  ];
}

/**
 * @returns 窗口菜单（关窗走这里：快捷键录制期间壳会把菜单快捷键让给页面）。
 */
function windowMenu(): readonly MenuItemSpec[] {
  return [{ role: "minimize" }, { role: "zoom" }, SEPARATOR, { role: "close" }];
}
