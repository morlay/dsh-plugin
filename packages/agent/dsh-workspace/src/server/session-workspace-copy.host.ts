// 「把一条会话复制到目标工作区」的编排（workspace 侧）：解析目标 → 派生 → attach，失败撤掉派生。
//
// 为什么编排住这一侧：它要同时用两个能力——`SessionWorkspace`（本域实现：目标目录 + attach + 广播）
// 与 `SessionBranching`（数据面实现：派生前缀 + 补偿删除），两个**端口**都声明在 `@morlay/dsh-session`。
// 持久化行不认识 workspace，也不该认识：这条跨域动作曾经住在 `SessionPersistenceRdb` 上，让持久化反向
// 依赖 `WorkspaceRegistry` 并与 workspace 行的注入边成环。
import { SessionId } from "@morlay/dsh-session/contract";
import {
  SessionBranching,
  SessionWorkspace,
  SessionWorkspaceCopy,
  SessionWorkspaceCopyFailure,
  SessionWorkspaceNotFoundError,
  type SessionFork,
  type SessionWorkspaceCopyResult,
} from "@morlay/dsh-session";
import { inject, Injectable } from "@morlay/zephyr";

@Injectable()
export class SessionWorkspaceCopyHost extends SessionWorkspaceCopy {
  private readonly target = inject(SessionWorkspace);

  /**
   * 分支原语：**可选**。装配里没有分支能力（官方 jsonl 落盘那一行）时这条动作不可用，
   * 那时它明确失败而不是静默给出半成品。
   */
  private readonly branching = inject.optional(SessionBranching);

  async copyToWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<SessionWorkspaceCopyResult> {
    // 先认工作区再派生：目标不在注册表里时不留下谁也不认识的派生会话。
    const target = await this.resolveTarget(workspaceId);
    const branching = this.branching;
    if (branching === undefined) {
      throw new Error(
        "workspace: 装配里没有 SessionBranching，跨工作区复制要它派生子会话（官方落盘那一行没有这个能力）",
      );
    }
    const fork = await branching.fork(SessionId(sessionId), { cwd: target.cwd });
    try {
      // 归属由 workspace 域做：attach 会按会话 header 的 cwd 校验它确实属于这个目录，并广播这次变更。
      await target.attach(fork.sessionId);
    } catch (error: unknown) {
      throw await attachRejected(workspaceId, fork, error);
    }
    return { sessionId: String(fork.sessionId), workspaceId };
  }

  // 目标解析失败分两种：目标不在注册表里（可判定，给「工作区不存在」）与别的装配/参数问题（原样抛）。
  private async resolveTarget(workspaceId: string) {
    try {
      return await this.target.resolve({ workspaceId });
    } catch (error: unknown) {
      if (error instanceof SessionWorkspaceNotFoundError) {
        throw new SessionWorkspaceCopyFailure("workspace-not-found", error.message, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

/**
 * attach 被拒：撤掉刚派生的子会话，把**两个失败都留在原因链里**。
 *
 * 为什么不是简单地把 attach 的错误挂成 cause：补偿删除自己也可能失败，那时抛出去的原因只剩「撤不干净」，
 * 而用户真正要看的是「复制没成」。用 `AggregateError` 把两条都带上，排障时沿 cause 能看到 attach 为什么被拒、
 * 以及库里还留着哪条子会话。
 * @param workspaceId - 目标工作区。
 * @param fork - 刚派生出来的子会话（含撤销入口）。
 * @param attachError - workspace 域拒绝 attach 的原因。
 * @returns 带原因链的失败。
 */
async function attachRejected(
  workspaceId: string,
  fork: SessionFork,
  attachError: unknown,
): Promise<SessionWorkspaceCopyFailure> {
  const detail = describeFailure(attachError);
  let compensation: unknown;
  try {
    await fork.discard();
  } catch (reason: unknown) {
    compensation = reason;
  }
  if (compensation === undefined) {
    return new SessionWorkspaceCopyFailure(
      "attach-rejected",
      `workspace "${workspaceId}" refused the copied session: ${detail}`,
      { cause: attachError },
    );
  }
  const undo = describeFailure(compensation);
  return new SessionWorkspaceCopyFailure(
    "attach-rejected",
    `workspace "${workspaceId}" refused the copied session: ${detail} (the derived session could not be dropped either: ${undo})`,
    { cause: new AggregateError([attachError, compensation], "copy to workspace failed") },
  );
}

/**
 * 一条失败的可读描述（原文进 message，原值进 cause）。
 * @param error - 捕获到的原因值。
 * @returns 可读描述。
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}
