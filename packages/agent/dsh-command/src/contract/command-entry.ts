// 一条命令的形状：`CommandCatalog` 的返回项、RPC 的 `commands/list` 响应也用它。
//
// **就是上游那份**（`CommandDescriptor`）：手抄过一次（`definitionId: string` / `input: unknown`），
// 结果是 wire 类型比协议更松——按 `Typerted` 的投影开守卫时，红的就是这两个字段。
export type { CommandDescriptor as CommandEntry } from "@deepseek-ai/dsh-commands/types";
