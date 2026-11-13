import type { WorkspaceId as WorkspaceIdType } from "@deepseek-ai/dsh-workspace/types";

/**
 * 工作区身份：品牌类型（上游 `WorkspaceId` 的等价副本）。
 */
export type WorkspaceId = WorkspaceIdType;

/**
 * 把字符串铸成工作区身份（与上游 `WorkspaceId()` 同形：`id as WorkspaceId`，零运行期行为）。
 *
 * 类型走上游 `types` 子路径；铸造函数在本仓写一份等价的纯 cast——上游把它放在宿主包根上，
 * 按值转出会给契约面收一条到宿主根的运行期边，而契约面被 ui 与扩展层引用。
 * @param id - 工作区标识（来自注册表或持久化记录）。
 * @returns 同一个字符串，带 `WorkspaceId` 品牌。
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceIdType;
}
