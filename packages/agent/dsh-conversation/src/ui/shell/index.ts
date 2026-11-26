// 会话壳的 client 行：左侧栏骨架、右侧面板、工作区与会话树、系统目录选择、右栏各标签。
//
// 收进来的判据是「**要跨域 UI 上下文才装得起来**」（`uiSession` / `uiWorkspace` / `uiConversation`）：
// `ui-workspace` 行要 `uiSession`，`ui-directory-picker-native` 行要 `uiWorkspace`。只依赖框架通用令牌与
// 本域数据面的**独立**行（上下文菜单、右栏「文件夹」标签）留在各自域（`dsh-workspace/ui`）。
import { configure, provide, type ProviderList } from "@morlay/zephyr";
import { provideSidebarRight, SidebarRightDefault } from "@morlay/zephyr-app/client";
import { RightbarSeats } from "./rightbar-seats.ts";
import { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
import { SessionPanelSlots } from "./session-panel-slots.ts";
import { SidebarBrowserSlots } from "./sidebar-browser-slots.ts";
import { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";

import { SidebarSlots } from "./sidebar-slots.ts";
import { WorkspaceSlots } from "./workspace-slots.ts";
// 终端那三行的 home 是 shell 域（上游 ui-sidebar-terminal + terminal-controller 的 client 半）：
// 行与**顺序**都在那边，这里只装配（`...provideShellUi()`）。
import { provideShellUi } from "@morlay/dsh-shell/ui";
// 「工作区文件组」 的 `file` 资源 provider 的 home 是 workspace 域（上游 `api/workspace-files`，不是 UI 行）。
import { WorkspaceFilesResource } from "@morlay/dsh-workspace/ui";

export { DirectoryPickerNativeSlots } from "./directory-picker-native-slots.ts";
export { SessionPanelSlots } from "./session-panel-slots.ts";
export { SidebarBrowserSlots } from "./sidebar-browser-slots.ts";
export { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";

export { SidebarSlots } from "./sidebar-slots.ts";
export { WorkspaceSlots } from "./workspace-slots.ts";
export {
  SidebarTerminalSlots,
  TerminalEndpointClient,
  WebTerminalsDefault,
} from "@morlay/dsh-shell/ui";
export { WorkspaceFilesResource } from "@morlay/dsh-workspace/ui";

/**
 * 会话壳的行：左栏、右栏、工作区与会话树、系统目录选择、终端链、右栏各标签与文件预览。
 *
 * 终端那三行**整个从 shell 域展开**（`...provideShellUi()`）：清单只有一个 home，这里不重抄。
 *
 * 顺序：`SidebarRightSlots` 要在所有**往 `sidebarRightTabs` 注册 tab 类型**的行之前（注册表由它建出来）；
 * `WorkspaceFilesResource` 在 `SidebarFilesSlots`（在 `provideWorkspaceUi()` 里）之后、
 * `SidebarDocumentPreviewSlots` 之前（预览的 `useResource('file')` 靠它）——所以调用方要把
 * `provideWorkspaceUi()` 排在本函数之前。
 * @returns provider 清单。
 */
export function provideSessionShellSlots(): ProviderList {
  return provide([
    SidebarSlots,
    // 右栏：我们自己的服务 + 座位（不再装上游右栏行）。类型注册表要排在所有往
    // `sidebarRightTabs` 注册 tab 类型的行之前。
    // `onScreenScope` 是右栏行唯一的必填配置：它决定哪个槽位作用域报「在屏资源」（本域是 `session`）。
    ...provideSidebarRight(configure(SidebarRightDefault, { onScreenScope: "session" })),
    // 右栏的两层座位与角位按钮：它们绑 `sessions`（SessionReference），所以装配在本域。
    RightbarSeats,

    // 会话面板：`panel.section` / `panel.indicator` 等槽位的声明方（job / subagent 的条目挂在它下面）。
    SessionPanelSlots,
    ...provideShellUi(),
    // 上游 `ui-workspace` 的适配行：工作区与会话树（要 `uiSession` / `contextMenus` / `workspaces`）。
    WorkspaceSlots,
    // 侧栏「添加工作区」的系统目录对话框。
    DirectoryPickerNativeSlots,
    // 右栏的「浏览器」标签（上游 `ui-sidebar-browser`）：文件树与预览整块由它渲染。
    SidebarBrowserSlots,
    // `file` 资源 provider：排在 `files` 之后（它读那份 「工作区文件组」），
    // 又要排在预览之前（预览的 `useResource('file')` 靠它）。
    WorkspaceFilesResource,
    // 文件预览：claim 文件树里点出来的 `dsh-resource://file/…`。
    SidebarDocumentPreviewSlots,
  ])();
}
