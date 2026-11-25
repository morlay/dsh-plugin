// 上游 descriptor → 我们对外暴露的 `CommandEntry`：**两者现在是同一个类型**（`CommandEntry` 是
// `CommandDescriptor` 的别名），所以这里只留一层直通——调用点在，将来要投影字段时改这一处。
import type { CommandDescriptor } from "@morlay/dsh-command/server";
import type { CommandEntry } from "@morlay/dsh-command/contract";

/**
 * 一条命令的对外形状。
 * @param descriptor - 上游 `CommandRuntime.list(agent)` 的返回项。
 * @returns 同一份（类型是别名，不再手抄字段）。
 */
export function commandEntryOf(descriptor: CommandDescriptor): CommandEntry {
  return descriptor;
}
