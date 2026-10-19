// `commands/execute` 的契约：执行一条命令。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { Injectable } from "@morlay/zephyr";

/** 执行一条命令（宿主侧 `commands/execute` 的端口）。 */
@Injectable()
export abstract class CommandRunner {
  /** 执行；失败以异常抛出（由调用方决定怎么提示）。 */
  abstract run(sessionId: SessionId, name: string, input?: string): Promise<void>;
}
