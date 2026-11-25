// workspace 注册表契约：令牌按服务语义命名（上游注册名 `workspaceRegistry`）。
//
// 成员取自上游 `WorkspaceRegistry` 的**全部**公开成员，而不是「本仓当前用到的那几个」：
// 上游 `api/workspace-controller` 的 host 面会经 `ctx.workspaceRegistry` 调它，契约缺一个，
// 那条插件在运行时读到的就是 `undefined`。
import type WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";
/** 一份工作区记录：路径、标题、挂上的会话与置顶/归档标记。 */
export type { WorkspaceRecord } from "@deepseek-ai/dsh-workspace";
/** 工作区存储域的整体状态（注册表整份落盘的那一坨）。 */
export type { WorkspaceDomainState } from "@deepseek-ai/dsh-workspace";

@Injectable({ name: "workspaceRegistry" })
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

/**
 * 覆盖守卫（严格）：上游 `WorkspaceRegistryService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type WorkspaceRegistryCovered = AssertTrue<AssertCoveredStrict<WorkspaceRegistryService, WorkspaceRegistry>>;
