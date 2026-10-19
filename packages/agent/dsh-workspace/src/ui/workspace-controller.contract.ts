// WorkspaceController 契约（浏览器侧）：令牌按服务语义命名（上游注册名 `workspaces`）。
//
// 成员来自上游 `IWorkspaces`（`api/workspace-controller` 的 client 面）：`ui-workspace` 的每个入口
// （建/改名/删/排序/归档/置顶）都读这一面。成员按**方法**声明——实现类 `WorkspaceControllerDefault`
// 用 `async` 方法覆盖，属性形态会撞 TS2425。
// 实现由本应用的 `WorkspaceControllerDefault` 给（数据面走 `remote.workspace` 的 follow 流）。
import type { IWorkspaces } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type WorkspaceControllerCovered = AssertTrue<AssertCovered<IWorkspaces, WorkspaceController>>;

@Injectable()
export abstract class WorkspaceController {
  abstract readonly list: IWorkspaces["list"];

  abstract create(input: Parameters<IWorkspaces["create"]>[0]): ReturnType<IWorkspaces["create"]>;

  abstract initializeDefault(
    signal?: Parameters<IWorkspaces["initializeDefault"]>[0],
  ): ReturnType<IWorkspaces["initializeDefault"]>;

  abstract rename(
    workspaceId: Parameters<IWorkspaces["rename"]>[0],
    title: Parameters<IWorkspaces["rename"]>[1],
  ): ReturnType<IWorkspaces["rename"]>;

  abstract delete(workspaceId: Parameters<IWorkspaces["delete"]>[0]): ReturnType<IWorkspaces["delete"]>;

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

  abstract pinSession(sessionId: Parameters<IWorkspaces["pinSession"]>[0]): ReturnType<IWorkspaces["pinSession"]>;

  abstract unpinSession(
    sessionId: Parameters<IWorkspaces["unpinSession"]>[0],
  ): ReturnType<IWorkspaces["unpinSession"]>;

  abstract insertSessionBefore(
    workspaceId: Parameters<IWorkspaces["insertSessionBefore"]>[0],
    sessionId: Parameters<IWorkspaces["insertSessionBefore"]>[1],
    beforeSessionId?: Parameters<IWorkspaces["insertSessionBefore"]>[2],
  ): ReturnType<IWorkspaces["insertSessionBefore"]>;
}
