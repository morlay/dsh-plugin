// `commands/execute` 的契约：执行一条命令。
//
// 返回**注册表的结算值**（`commandId` + `result`），不是 `void`：处理器把失败写在 `result.kind` 里
// （例如档位名不在目录中），调用方（上游权限 chip）正是按它判断成败。丢掉返回值就等于把失败
// 伪装成成功——真机上表现为"点了切换、什么都不变"。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { Injectable } from "@morlay/zephyr";
import type { CommandExecuteValue } from "../endpoint/command-endpoint.ts";

/** 执行一条命令（宿主侧 `commands/execute` 的端口）。 */
@Injectable()
export abstract class CommandRunner {
  /** 执行；找不到命令或执行失败以异常抛出，处理器自己结算的失败在 `result.kind` 上。 */
  abstract run(sessionId: SessionId, name: string, input?: string): Promise<CommandExecuteValue>;
}
