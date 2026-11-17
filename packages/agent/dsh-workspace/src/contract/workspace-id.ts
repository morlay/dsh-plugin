// 类型从**包根**取（`import type`，运行期零边）：上游 `./types` 子路径与包根导出的是同一个
// `WorkspaceId`，但按名字解析类型的工具（typert 生成器）只按「包入口图的导出」建索引——子路径出口
// 不在那张表里，于是 `…/types` 这条引用解析不到（rc.3 新增 schema 首次引用到它时暴露）。
import type { WorkspaceId as WorkspaceIdType } from "@deepseek-ai/dsh-workspace";

/**
 * 工作区身份：品牌类型（上游 `WorkspaceId` 的等价副本）。
 */
export type WorkspaceId = WorkspaceIdType;

/**
 * 把字符串铸成工作区身份（与上游 `WorkspaceId()` 同形：`id as WorkspaceId`，零运行期行为）。
 *
 * 铸造函数在本仓写一份等价的纯 cast——上游把它放在宿主包根上，按**值**转出会给契约面收一条到宿主根的
 * 运行期边，而契约面被 ui 与扩展层引用；类型这一层只是 `import type`，没有这个问题。
 * @param id - 工作区标识（来自注册表或持久化记录）。
 * @returns 同一个字符串，带 `WorkspaceId` 品牌。
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceIdType;
}
