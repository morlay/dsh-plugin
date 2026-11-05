// 运行中 agent 的控制面：编辑编排要"先停下 agent、再动日志"。
//
// 宿主侧的 agent 目录不是本包的域，这里只声明用到的三条。
import type { UserMessage } from "@morlay/dsh-agent/contract";
import type { Session } from "@morlay/dsh-session/contract";
import { Injectable } from "@morlay/zephyr";

export interface SessionAgentLike {
  readonly id: string;
  readonly session: Session;
  followup(message: UserMessage): void;
  cancel?(cause: { kind: "user" }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

@Injectable()
export abstract class SessionAgentControl {
  abstract get(id: string): SessionAgentLike | undefined;

  abstract list(): readonly SessionAgentLike[];
}
