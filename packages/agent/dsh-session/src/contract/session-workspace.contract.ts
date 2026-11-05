// 「会话归属到哪个目录 / 哪个 workspace」的接缝（host 侧）。
//
// 为什么单独一条接缝：会话创建需要 workspace 的路径，并在建好后把会话挂到 workspace 上（更新 `sessionIds`），
// 而 `@morlay/dsh-session` **不能**依赖 `@morlay/dsh-workspace`（后者已依赖前者，反向会成环）。
// 这里只声明「解析目标 + 事后挂载」两件事，实现由 workspace 那一侧提供，装配层把它们接起来。
import type { SessionId } from "@deepseek-ai/dsh-session";
import { Injectable } from "@morlay/zephyr";

/** 一次会话创建的目标。 */
export interface SessionWorkspaceTarget {
  /** 会话的 cwd（workspace 的路径，或调用方显式给的目录）。 */
  readonly cwd: string;
  /**
   * 把刚建好的会话挂到目标上（有 workspace 时更新它的 `sessionIds`）。
   *
   * 不变量：**收品牌 `SessionId`**，不是裸字符串——身份在 `dsh-session` 这一侧已经铸好
   * （`SessionControllerHost.createForRemote` 建 header 时铸的那一个），实现方原样转给上游
   * `Workspace.attachSession`，两侧不各自再铸一次。
   * @param sessionId - 新建会话的身份。
   */
  attach(sessionId: SessionId): Promise<void>;
}

@Injectable()
export abstract class SessionWorkspace {
  /**
   * 解析这次创建落在哪个目录、事后挂到哪个 workspace。
   * @param request - `workspaceId` 与 `cwd` 互斥（与上游 `session/create` 一致）。
   * @returns 目标目录与挂载动作。
   */
  abstract resolve(request: {
    readonly workspaceId?: string;
    readonly cwd?: string;
  }): Promise<SessionWorkspaceTarget>;
}
