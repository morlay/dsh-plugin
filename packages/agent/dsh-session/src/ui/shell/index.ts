// 会话壳的 client 行：左侧栏骨架与右侧面板。
//
// 这两行包装的是上游 `ui-sidebar` / `ui-sidebar-right`，提供的 `sidebarRight` / `sidebarRightTabs`
// 被会话界面消费——所以它们属于**会话域**的 ui，装配面显式组合（`...provideSessionShellSlots()`），
// 不放在应用里、也不进框架链。
import { provide, type ProviderList } from "@morlay/zephyr";
import { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";
import { SidebarFilesSlots } from "./sidebar-files-slots.ts";
import { SidebarRightSlots } from "./sidebar-right-slots.ts";
import { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";
import { WorkspaceFilesResource } from "./workspace-files-resource.ts";
import { SidebarSlots } from "./sidebar-slots.ts";

export { SidebarDocumentPreviewSlots } from "./sidebar-document-preview-slots.ts";
export { SidebarFilesSlots } from "./sidebar-files-slots.ts";
export { SidebarRightSlots } from "./sidebar-right-slots.ts";
export { SidebarTerminalSlots, WebTerminalsDefault } from "./sidebar-terminal-slots.ts";
export { WorkspaceFilesResource } from "./workspace-files-resource.ts";
export { SidebarSlots } from "./sidebar-slots.ts";

/**
 * 会话壳的三行：左侧栏、右侧面板、右栏的「文件夹」标签（顺序有依赖，见各文件注释）。
 *
 * `SidebarFilesSlots` / `SidebarTerminalSlots` 要在 `SidebarRightSlots` 之后：它们往 `sidebarRightTabs`
 * 注册 tab 类型，而那个注册表由右栏那一行建出来；`WebTerminalsDefault` 还要排在终端那一行之前
 * （它建的 `webTerminals` 是终端行的依赖）。
 * @returns provider 清单。
 */
export function provideSessionShellSlots(): ProviderList {
  return provide([
    SidebarSlots,
    SidebarRightSlots,
    WebTerminalsDefault,
    SidebarFilesSlots,
    // `file` 资源 provider：排在 `files` 之后（它读那份 `remote.workspaceFiles`），
    // 又要排在预览之前（预览的 `useResource('file')` 靠它）。
    WorkspaceFilesResource,
    // 文件预览：claim 文件树里点出来的 `dsh-resource://file/…`。
    SidebarDocumentPreviewSlots,
    SidebarTerminalSlots,
  ])();
}
