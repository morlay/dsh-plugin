// 一条命令的形状：`CommandCatalog` 的返回项、RPC 的 `commands/list` 响应也用它。
//
// 与上游 `CommandDescriptor` 对齐：命令只有名字、说明与可选的输入提示（没有单独的展示名）。
export interface CommandEntry {
  /** `/name` 里的名字（不含斜杠）。 */
  readonly name: string;
  /** 一行说明（展示用）。 */
  readonly description: string;
  /** 输入提示（可选）：告诉客户端这条命令能带什么参数。 */
  readonly input?: unknown;
}
