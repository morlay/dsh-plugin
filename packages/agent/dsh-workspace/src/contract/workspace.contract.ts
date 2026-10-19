// workspace 注册表契约：令牌按服务语义命名（上游注册名 `workspaceRegistry`）。
//
// 成员取自上游 `WorkspaceRegistry` 的**全部**公开成员，而不是「本仓当前用到的那几个」：
// 上游 `api/workspace-controller` 的 host 面会经 `ctx.workspaceRegistry` 调它，契约缺一个，
// 那条插件在运行时读到的就是 `undefined`。
import type WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `WorkspaceRegistry` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type WorkspaceRegistryCovered = AssertTrue<
  AssertCovered<WorkspaceRegistryService, WorkspaceRegistry>
>;

@Injectable()
export abstract class WorkspaceRegistry {
  abstract readonly archivedSessionIds: WorkspaceRegistryService["archivedSessionIds"];

  abstract readonly pinnedSessionIds: WorkspaceRegistryService["pinnedSessionIds"];

  abstract readonly initializeDefault: WorkspaceRegistryService["initializeDefault"];

  abstract readonly create: WorkspaceRegistryService["create"];

  abstract readonly resolveByPath: WorkspaceRegistryService["resolveByPath"];

  abstract readonly get: WorkspaceRegistryService["get"];

  abstract readonly list: WorkspaceRegistryService["list"];

  abstract readonly delete: WorkspaceRegistryService["delete"];

  abstract readonly insertBefore: WorkspaceRegistryService["insertBefore"];

  abstract readonly archiveSession: WorkspaceRegistryService["archiveSession"];

  abstract readonly unarchiveSession: WorkspaceRegistryService["unarchiveSession"];

  abstract readonly pinSession: WorkspaceRegistryService["pinSession"];

  abstract readonly unpinSession: WorkspaceRegistryService["unpinSession"];
}

