// `ui-workspace` 的服务契约：跨行注入 `UiWorkspace`（目录浏览对话框要读 `listDirectory` /
// `createDirectory`）。
//
// home 在**对话域**：它是上游 UI 行（`@deepseek-ai/dsh-client-ui-workspace/client`）的契约，属于「对话界面
// 大组装」的一块，不是 workspace 域的独立能力——那一行（`ui/shell/workspace-slots.ts`）也在本包，
// 行与契约同一个 owner。workspace 域只留数据面（注册表 / 存储 / 查询）。
//
// 上游把这个服务建在 `ui-workspace` 那一行内部（`new UiWorkspaceService(ctx, …)`），名字只在行作用域；
// `ui-directory-picker-browse` 是另一行，要按名字拿到它，就必须由 `ui-workspace` 行把它发布成一个
// **契约**。
//
// 形态与其它契约一致：**抽象类 + `@Injectable({ name })`**，服务名与上游一致（`uiWorkspace`）。
import type { UiWorkspace as UiWorkspaceFace } from "@deepseek-ai/dsh-client-ui-workspace/client";
import { Injectable } from "@morlay/zephyr";
// 覆盖守卫是**纯类型**，从 client 出口取：`@morlay/zephyr-app` 包根是宿主面（链到 node 侧），
// 浏览器半（`src/ui`）从包根取会把宿主模块拖进前端 bundle。

/**
 * `ctx.uiWorkspace` 的服务契约（服务名与上游一致：`uiWorkspace`）。
 *
 * 成员按**方法**声明——实现类是上游 `UiWorkspaceService`，属性形态会撞 TS2425。
 */
@Injectable({ name: "uiWorkspace" })
export abstract class UiWorkspace implements UiWorkspaceFace {
  abstract openSession(target: Parameters<UiWorkspaceFace["openSession"]>[0]): void;

  abstract openWorkspace(
    workspaceId: Parameters<UiWorkspaceFace["openWorkspace"]>[0],
    beforeOpen?: Parameters<UiWorkspaceFace["openWorkspace"]>[1],
    options?: Parameters<UiWorkspaceFace["openWorkspace"]>[2],
  ): ReturnType<UiWorkspaceFace["openWorkspace"]>;

  abstract forkSession(
    sessionId: Parameters<UiWorkspaceFace["forkSession"]>[0],
    onCreated?: Parameters<UiWorkspaceFace["forkSession"]>[1],
    options?: Parameters<UiWorkspaceFace["forkSession"]>[2],
  ): ReturnType<UiWorkspaceFace["forkSession"]>;

  abstract connectWorkspace(
    workspaceId: Parameters<UiWorkspaceFace["connectWorkspace"]>[0],
    options?: Parameters<UiWorkspaceFace["connectWorkspace"]>[1],
  ): ReturnType<UiWorkspaceFace["connectWorkspace"]>;

  abstract startSession(
    workspaceId?: Parameters<UiWorkspaceFace["startSession"]>[0],
    options?: Parameters<UiWorkspaceFace["startSession"]>[1],
  ): void;

  abstract archiveSession(
    sessionId: Parameters<UiWorkspaceFace["archiveSession"]>[0],
    options?: Parameters<UiWorkspaceFace["archiveSession"]>[1],
  ): ReturnType<UiWorkspaceFace["archiveSession"]>;

  abstract unarchiveSession(
    sessionId: Parameters<UiWorkspaceFace["unarchiveSession"]>[0],
  ): ReturnType<UiWorkspaceFace["unarchiveSession"]>;

  abstract pinSession(
    sessionId: Parameters<UiWorkspaceFace["pinSession"]>[0],
  ): ReturnType<UiWorkspaceFace["pinSession"]>;

  abstract unpinSession(
    sessionId: Parameters<UiWorkspaceFace["unpinSession"]>[0],
  ): ReturnType<UiWorkspaceFace["unpinSession"]>;

  abstract pickDirectory(): ReturnType<UiWorkspaceFace["pickDirectory"]>;

  abstract listDirectory(
    path?: Parameters<UiWorkspaceFace["listDirectory"]>[0],
    signal?: Parameters<UiWorkspaceFace["listDirectory"]>[1],
  ): ReturnType<UiWorkspaceFace["listDirectory"]>;

  abstract createDirectory(
    path: Parameters<UiWorkspaceFace["createDirectory"]>[0],
    name: Parameters<UiWorkspaceFace["createDirectory"]>[1],
  ): ReturnType<UiWorkspaceFace["createDirectory"]>;

  abstract whenAccess(
    workspaceId: Parameters<UiWorkspaceFace["whenAccess"]>[0],
    action: Parameters<UiWorkspaceFace["whenAccess"]>[1],
    callback: Parameters<UiWorkspaceFace["whenAccess"]>[2],
  ): ReturnType<UiWorkspaceFace["whenAccess"]>;
}
