// 一条命令的形状：`CommandCatalog` 的返回项、RPC 的 `commands/list` 响应也用它。
//
// 与上游 `CommandDescriptor` 对齐：命令只有名字、说明与可选的输入提示（没有单独的展示名）。
export interface CommandEntry {
  /** `/name` 里的名字（不含斜杠）。 */
  readonly name: string;
  /**
   * 定义 id（上游 `CommandDescriptor.definitionId`，例如 `@deepseek-ai/dsh-command-compact`）。
   *
   * 客户端的菜单**按它认内置命令**（`ui-commands` 的 `builtinCommandName`）：认出来了才有本地化名字、
   * 描述与图标；缺这个字段就只能退回宿主给的英文说明。
   */
  readonly definitionId?: string;
  /** 一行说明（展示用）。 */
  readonly description: string;
  /** 输入提示（可选）：告诉客户端这条命令能带什么参数。 */
  readonly input?: unknown;
}
