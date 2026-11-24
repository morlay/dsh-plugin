// 「把一条会话复制到目标工作区」的接缝（host 侧）：跨域编排面，不是持久化能力。
//
// 为什么在会话这一侧声明：一次复制要同时用两个能力——「会话的分支原语」（`SessionBranching`，数据面）
// 与「会话归属到哪个工作区」（`SessionWorkspace`，workspace 侧）。**同时需要两者**的那一层是编排层，
// 它不许住进持久化行（那会让持久化反向依赖 workspace 域、与 workspace 行的注入边成环）。
// 所以端口住在这里，实现按域各就各位：分支原语由数据面给，编排由 workspace 侧给，装配层接起来。
//
// 本仓自有的端口：上游没有对应的服务名，所以不带 `@Injectable({ name })`。
import { Injectable } from "@morlay/zephyr";

// 一次复制的结果：新派生的子会话与它挂上的工作区（源会话原样保留——复制不是移动）。
export interface SessionWorkspaceCopyResult {
  readonly sessionId: string;
  readonly workspaceId: string;
}

/**
 * 复制失败的两条原因。
 *
 * 实现方按语义给原因，**不**决定 wire 域码：域码是本域（session）的词汇，由端点行映射。
 */
export type SessionWorkspaceCopyFailureReason = "workspace-not-found" | "attach-rejected";

// 一次复制失败：原因为稳定面，message 只给人看，cause 是原因链（补偿删除也失败时是 AggregateError）。
export class SessionWorkspaceCopyFailure extends Error {
  constructor(
    readonly reason: SessionWorkspaceCopyFailureReason,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SessionWorkspaceCopyFailure";
  }
}

@Injectable()
export abstract class SessionWorkspaceCopy {
  /**
   * 把一条会话复制到目标工作区：派生一条 cwd 换成目标路径的子会话，再挂到那个工作区上。
   *
   * 不变量：**先认工作区再派生**（目标不在注册表里时不留下谁也不认识的派生会话）；attach 失败时
   * 撤掉刚派生的子会话（复制要么落在目标工作区，要么库里不多一条会话）。
   * @param sessionId - 源会话。
   * @param workspaceId - 目标工作区（注册表里的 id）。
   * @returns 子会话与目标工作区。
   */
  abstract copyToWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<SessionWorkspaceCopyResult>;
}
