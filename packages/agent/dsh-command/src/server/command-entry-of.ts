// 上游 descriptor → 我们的 `CommandEntry`：`commands/list` 的响应项与 `CommandCatalog` 的返回项是同一个
// 形状，映射只写这一份（wire 实现与同进程实现都用它）。
import type { CommandDescriptor } from "@morlay/dsh-command/server";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";

/**
 * 一条命令的对外形状。
 * @param descriptor - 上游 `CommandRuntime.list(agent)` 的返回项。
 * @returns 名字、说明与可选输入提示。
 */
export function commandEntryOf(descriptor: CommandDescriptor): CommandEntry {
  return {
    name: descriptor.name,
    description: descriptor.description,
    // `exactOptionalPropertyTypes`：没有输入提示时不写这个键，而不是塞一个 `undefined`。
    ...(descriptor.input === undefined ? {} : { input: descriptor.input }),
  };
}
