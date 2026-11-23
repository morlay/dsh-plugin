// 会话壳的 client 行：左侧栏骨架与右侧面板。
//
// 这两行包装的是上游 `ui-sidebar` / `ui-sidebar-right`，提供的 `sidebarRight` / `sidebarRightTabs`
// 被会话界面消费——所以它们属于**会话域**的 ui，装配面显式组合（`...provideSessionShellSlots()`），
// 不放在应用里、也不进框架链。
import { provide, type ProviderList } from "@morlay/zephyr";
import { SessionPanelSlots } from "./session-panel-slots.ts";
import { SidebarBrowserSlots } from "./sidebar-browser-slots.ts";
import { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";
import { SidebarRightSlots } from "./sidebar-right-slots.ts";
// 终端那四行的 home 是 shell 域（上游 ui-sidebar-terminal + terminal-controller 的 client 半）：
// 行与**顺序**都在那边，这里只装配（`...provideShellUi()`）。
import { provideShellUi } from "@morlay/dsh-shell/ui";
import { SidebarSlots } from "./sidebar-slots.ts";
// 「文件夹」标签与 file 资源 provider 的 home 是 workspace 域（上游是 api/workspace-files）：
// 行在那边，这里只装配。
import { SidebarFilesSlots, WorkspaceFilesResource } from "@morlay/dsh-workspace/ui";

export { SessionPanelSlots } from "./session-panel-slots.ts";
export { SidebarBrowserSlots } from "./sidebar-browser-slots.ts";
export { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";
export { SidebarRightSlots } from "./sidebar-right-slots.ts";
export {
  RemoteMountsDefault,
  SidebarTerminalSlots,
  TerminalEndpointClient,
  WebTerminalsDefault,
} from "@morlay/dsh-shell/ui";
export { SidebarSlots } from "./sidebar-slots.ts";
export { SidebarFilesSlots, WorkspaceFilesResource } from "@morlay/dsh-workspace/ui";

/**
 * 会话壳的行：左侧栏、右侧面板、终端链、右栏的「文件夹」标签与文件预览。
 *
 * 终端那四行**整个从 shell 域展开**（`...provideShellUi()`）：清单只有一个 home，这里不重抄。
 * 那四行内部有顺序（`TerminalEndpointClient` → `RemoteMountsDefault` → `WebTerminalsDefault` →
 * `SidebarTerminalSlots`：前者被后者字段注入 / 后者 `onInit` 里按 `remote.terminal` 那一面读），
 * 顺序由那边维护——上次 `TerminalEndpointClient` 漏进清单就是「两份清单」的症状。
 *
 * 本文件自己排的两条顺序：`SidebarRightSlots` 要在所有**往 `sidebarRightTabs` 注册 tab 类型**的行之前
 * （那个注册表由它建出来）；`WorkspaceFilesResource` 在 `SidebarFilesSlots` 之后、
 * `SidebarDocumentPreviewSlots` 之前（预览的 `useResource('file')` 靠它）。
 * @returns provider 清单。
 */
export function provideSessionShellSlots(): ProviderList {
  return provide([
    SidebarSlots,
    SidebarRightSlots,
    // 会话面板：`panel.section` / `panel.indicator` 等槽位的声明方（job / subagent 的条目挂在它下面）。
    SessionPanelSlots,
    ...provideShellUi(),
    // 右栏的「浏览器」标签（上游 `ui-sidebar-browser`）：文件树与预览整块由它渲染。
    SidebarBrowserSlots,
    SidebarFilesSlots,
    // `file` 资源 provider：排在 `files` 之后（它读那份 「工作区文件组」），
    // 又要排在预览之前（预览的 `useResource('file')` 靠它）。
    WorkspaceFilesResource,
    // 文件预览：claim 文件树里点出来的 `dsh-resource://file/…`。
    SidebarDocumentPreviewSlots,
  ])();
}
