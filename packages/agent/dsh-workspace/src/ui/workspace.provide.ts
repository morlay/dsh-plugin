import { provide } from "@morlay/zephyr";
import { SidebarFilesSlots } from "./sidebar-files-slots.ts";
import { WorkspaceControllerDefault } from "./workspace-controller.service.ts";
import { WorkspaceEndpointClient } from "./workspace-endpoint.client.ts";
import { WorkspaceFilesEndpointClient } from "./workspace-files-endpoint.client.ts";

// workspace 的**浏览器半**：两个端点组的客户端形态 + 数据面 + 两个独立的 UI 行（上下文菜单、右栏「文件夹」标签）。
//
// 一份清单（调用方一行 `...provideWorkspaceUi()`），组内按依赖排序（拓扑排序另有保证，这里只是同层基准）：
// - `WorkspaceEndpointClient` 必须早于 `WorkspaceControllerDefault`（后者 `inject` 它；少这一行，
//   装配期直接报「没有提供者：workspace-endpoint」）；
// - 两组的 descriptor 由各自的客户端形态在 `onInit` 里挂，没有额外的 binding 行；
// - `WorkspaceFilesEndpointClient` 要早于 `SidebarFilesSlots`（后者把它拼进 deps 键）；
// - `contextMenus` 的实现行在框架链里（`@morlay/zephyr-app` 的 `context-menus.slots.ts`），本域只消费它
//   （`inject(ContextMenus)` 与 `ctx.contextMenus.register`）；那条边由拓扑排序保证。
// 要剔某行用 `without(实现类)`。
//
// **要 `uiSession` / `uiWorkspace` 的上游行不在这里**：它们参与会话界面大组装，归 `@morlay/dsh-conversation`。
export const provideWorkspaceUi = provide([
    WorkspaceEndpointClient,
  WorkspaceControllerDefault,
  WorkspaceFilesEndpointClient,
  SidebarFilesSlots,
]);
