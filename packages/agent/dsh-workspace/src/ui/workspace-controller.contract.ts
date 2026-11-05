// WorkspaceController 契约（浏览器侧）：令牌按服务语义命名（上游注册名 `workspaces`）。
//
// 成员来自上游 `IWorkspaces`（`api/workspace-controller` 的 client 面）：`ui-workspace` 的每个入口
// （建/改名/删/排序/归档/置顶）都读这一面。成员按**方法**声明——实现类 `WorkspaceControllerDefault`
// 用 `async` 方法覆盖，属性形态会撞 TS2425。
// 实现由本应用的 `WorkspaceControllerDefault` 给（数据面走 「工作区组」 的 follow 流）。
import type { IWorkspaces } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { Injectable, InjectionToken } from "@morlay/zephyr";
// 覆盖守卫是**纯类型**，从 client 出口取：`@morlay/zephyr-app` 包根是宿主面（链到 node 侧），
// 浏览器半（`src/ui`）从包根取会把宿主模块拖进前端 bundle。
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type WorkspaceControllerCovered = AssertTrue<
  AssertCovered<IWorkspaces, WorkspaceController>
>;

/**
 * 服务名令牌：上游 `ui-workspace` 按 `ctx.workspaces` 读这一面。
 * 不显式给令牌的话，名字会按类名派生成 `workspace-controller`，上游读不到。
 */
export const WorkspaceControllerToken = InjectionToken<IWorkspaces>("workspaces");

@Injectable({ token: WorkspaceControllerToken })
export abstract class WorkspaceController {
  /**
   * 上游注册名：`ctx.workspaces`。
   *
   * 默认推导会给连字符形式，而上游 client 插件按 `ctx.workspaces` 读它——
   * 名字对不上的后果是"契约令牌能解析、按名字却读不到"。
   */
  static readonly serviceName = "workspaces";

  abstract readonly list: IWorkspaces["list"];

  abstract create(input: Parameters<IWorkspaces["create"]>[0]): ReturnType<IWorkspaces["create"]>;

  abstract initializeDefault(
    signal?: Parameters<IWorkspaces["initializeDefault"]>[0],
  ): ReturnType<IWorkspaces["initializeDefault"]>;

  abstract rename(
    workspaceId: Parameters<IWorkspaces["rename"]>[0],
    title: Parameters<IWorkspaces["rename"]>[1],
  ): ReturnType<IWorkspaces["rename"]>;

  abstract delete(
    workspaceId: Parameters<IWorkspaces["delete"]>[0],
  ): ReturnType<IWorkspaces["delete"]>;

  abstract insertBefore(
    workspaceId: Parameters<IWorkspaces["insertBefore"]>[0],
    beforeWorkspaceId?: Parameters<IWorkspaces["insertBefore"]>[1],
  ): ReturnType<IWorkspaces["insertBefore"]>;

  abstract archiveSession(
    sessionId: Parameters<IWorkspaces["archiveSession"]>[0],
    options?: Parameters<IWorkspaces["archiveSession"]>[1],
  ): ReturnType<IWorkspaces["archiveSession"]>;

  abstract unarchiveSession(
    sessionId: Parameters<IWorkspaces["unarchiveSession"]>[0],
  ): ReturnType<IWorkspaces["unarchiveSession"]>;

  abstract pinSession(
    sessionId: Parameters<IWorkspaces["pinSession"]>[0],
  ): ReturnType<IWorkspaces["pinSession"]>;

  abstract unpinSession(
    sessionId: Parameters<IWorkspaces["unpinSession"]>[0],
  ): ReturnType<IWorkspaces["unpinSession"]>;

  abstract insertSessionBefore(
    workspaceId: Parameters<IWorkspaces["insertSessionBefore"]>[0],
    sessionId: Parameters<IWorkspaces["insertSessionBefore"]>[1],
    beforeSessionId?: Parameters<IWorkspaces["insertSessionBefore"]>[2],
  ): ReturnType<IWorkspaces["insertSessionBefore"]>;
}
