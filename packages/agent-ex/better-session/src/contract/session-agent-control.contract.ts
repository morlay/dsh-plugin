// 运行中 agent 的控制面：编辑编排要"先停下 agent、再动日志"。
//
// 宿主侧的 agent 目录不是本包的域，这里只声明用到的三条。
import type { UserMessage } from "@morlay/dsh-agent/contract";
import type { Session } from "@morlay/dsh-session/contract";
import { Injectable } from "@morlay/zephyr";

export interface SessionAgentLike {
  readonly id: string;
  readonly session: Session;
  /**
   * 重放相位（上游 agent 的 **private 面**：`phase.lastTurn` 记「重放到第几轮」）。
   *
   * 编辑编排在写完种子日志之后要把它的 `lastTurn` 推到最后一轮 `turn/start`，否则上游从旧轮号继续
   * 编号。上游没有把它放进公开面，所以由这里显式声明——与 `rewind.ts` 读同一份私有相位。
   */
  readonly phase?: { lastTurn?: number };
  followup(message: UserMessage): void;
  cancel?(cause: { kind: "user" }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

@Injectable()
export abstract class SessionAgentControl {
  abstract get(id: string): SessionAgentLike | undefined;

  abstract list(): readonly SessionAgentLike[];
}
