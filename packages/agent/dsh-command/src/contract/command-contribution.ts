// 一条**命令贡献**的形状：注册表要的那三样，与上游 `CommandDefinition` 的必填字段对齐。
//
// 它是接口不是令牌：贡献方 `implements CommandContribution` 并用 `@Command()` 声明装配期登记，
// 不自己写 `registry.register(...)`。
import type { CommandInvocation, CommandResult } from "@morlay/dsh-command/server";

/** 一条命令：名字、一行说明、执行入口。 */
export interface CommandContribution {
  /** `/name` 里的名字（不含斜杠；上游要求小写、字母开头）。 */
  readonly name: string;

  /** 一行说明（发现面展示用，不能为空）。 */
  readonly description: string;

  /** 执行；返回的结果被注册表包成 `command/run` / `command/done` 事件。 */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
