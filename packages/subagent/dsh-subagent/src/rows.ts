/**
 * 本包作为能力包发布的**装配数据**：行本身在部署那一层装
 * （`bundles/session-mode-profile` 引用它渲染 patch）。
 *
 * 上游 `subagent` 行（`ctx.subagents` 服务定义）由本包接管；官方设置页那张卡片读的是官方那一行的
 * namespace，本部署没有，所以一并停掉。模型白名单服务行**留着**：官方 preset 的 `tool-subagent` 行带
 * `modelSelectionSettings: true` 并 inject 它。
 */

/** 一行装配条目：与 `cordis.patch.yml` 的顶层结构同形。 */
export interface PatchRow {
  readonly id?: string;
  readonly disabled?: boolean;
  readonly insert?: readonly RowEntry[];
}

/** `insert` 里的一个条目。 */
export interface RowEntry {
  readonly id: string;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** 服务接管的装配行。 */
export function subagentRows(): readonly PatchRow[] {
  return [
    { id: "subagent", disabled: true },
    { id: "ui-settings-subagent", disabled: true },
    { insert: [{ id: "subagent-fork", name: "@morlay/dsh-subagent" }] },
  ];
}
