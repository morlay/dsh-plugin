// 「会话的分支原语」的接缝（host 侧）：派生一条子会话，并给出撤掉这次派生的入口。
//
// 为什么单独一条接缝：跨域编排（把一条会话复制到目标工作区）要的是两件事——派生前缀、attach 失败时
// 把库恢复成「没派生过」。实现在数据面（`@morlay/session-rdb`），而编排在 workspace 那一侧，
// `@morlay/dsh-workspace` **不能**反向依赖数据面（`@morlay/session-rdb` 已依赖它，反向会成环）。
// 所以这里只声明能力，实现由数据面提供，装配层把它们接起来（与 `SessionWorkspace` 同一手法）。
//
// 本仓自有的端口：上游没有对应的服务名，所以不带 `@Injectable({ name })`。
import type { SessionId } from "@deepseek-ai/dsh-session";
import { Injectable } from "@morlay/zephyr";

// 一次派生：子会话身份 + 撤掉它的入口。
export interface SessionFork {
  /** 派生出来的子会话（父会话原样保留）。 */
  readonly sessionId: SessionId;
  /**
   * 撤掉这次派生：库恢复成「没派生过」（派生账目一起清）。
   *
   * 编排在后续步骤（attach）失败时用它做补偿——「要么整件事成、要么库里不多一条谁也找不到的会话」。
   */
  discard(): Promise<void>;
}

// 派生选项：只留跨域编排需要的（换目录）。其它档位（锚点 / seed 后缀）是会话域内部的编辑编排，不上这条端口。
export interface SessionForkOptions {
  /** 子会话的 cwd（缺省沿用源会话的）。 */
  readonly cwd?: string;
}

@Injectable()
export abstract class SessionBranching {
  /**
   * 从源会话派生一条子会话（读的是闭合前缀，父会话不动）。
   * @param sourceId - 源会话。
   * @param options - 子会话的目录覆盖。
   * @returns 子会话身份与它的撤销入口。
   */
  abstract fork(sourceId: SessionId, options?: SessionForkOptions): Promise<SessionFork>;
}
