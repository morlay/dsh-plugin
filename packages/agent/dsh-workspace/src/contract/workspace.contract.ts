// workspace 注册表契约：令牌按服务语义命名（上游注册名 `workspaceRegistry`）。
//
// 成员取自上游 `WorkspaceRegistry` 的**全部**公开成员，而不是「本仓当前用到的那几个」：
// 上游 `api/workspace-controller` 的 host 面会经 `ctx.workspaceRegistry` 调它，契约缺一个，
// 那条插件在运行时读到的就是 `undefined`。
import type WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
// 品牌类型走上游 `types` 子路径：那一片只有类型、没有运行期代码（上游自己的文件头就这么写的）。
import type { WorkspaceId as WorkspaceIdBrand } from "@deepseek-ai/dsh-workspace/types";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：工作区的身份、落盘形状与存储域状态。消费方（会话归属、目录选择器、管理面）拿它们
// 读写工作区记录，不必自己引 `@deepseek-ai/dsh-workspace`。
//
// `WorkspaceId` 的**类型**走上游 `types` 子路径；**铸造函数**在本仓写一份等价的纯 cast——上游把它放在
// 宿主包根上，按值转出会给契约面收一条到宿主根的运行期边，而契约面被 ui 与扩展层引用。
// 品牌铸造没有领域逻辑（`@deepseek-ai/dsh-brand` 的约定：独立副本产出的值可互换），复制的是那一行 cast。
// 判据见 `packages/agent/.agents/designs/20261113-上游基础装配.md` 的决定 6。

/** 工作区身份：品牌类型（`Branded<'WorkspaceId'>`）。 */
export type WorkspaceId = WorkspaceIdBrand;

/**
 * 把字符串铸成工作区身份（与上游 `WorkspaceId()` 同形：`id as WorkspaceId`，零运行期行为）。
 * @param id - 工作区标识（来自注册表或持久化记录）。
 * @returns 同一个字符串，带 `WorkspaceId` 品牌。
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId;
}

/** 一份工作区记录：路径、标题、挂上的会话与置顶/归档标记。 */
export type { WorkspaceRecord } from "@deepseek-ai/dsh-workspace";
/** 工作区存储域的整体状态（注册表整份落盘的那一坨）。 */
export type { WorkspaceDomainState } from "@deepseek-ai/dsh-workspace";

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
