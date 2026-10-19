// `commands/list` 的契约：某个会话当前可见的命令（只读）。
//
// 与 host 侧的 `CommandRegistry` 不同：那是可写注册表（谁能注册命令），这里是「某会话能看见什么」。
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { Injectable } from "@morlay/zephyr";
import type { CommandEntry } from "./command-entry.ts";

/** 命令目录：某个会话当前可见的命令。实现由组合层提供（host 直连、走 remote、或测试里的假实现）。 */
@Injectable()
export abstract class CommandCatalog {
  /** 拉一个会话可见的命令（实现方可缓存）。 */
  abstract list(sessionId: SessionId): Promise<readonly CommandEntry[]>;
}
