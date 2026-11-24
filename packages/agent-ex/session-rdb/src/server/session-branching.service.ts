// 数据面的分支原语（`SessionBranching` 的实现）：派生一条子会话 + 撤掉这次派生。
//
// 为什么是一条单独的行：令牌是身份，而本包的持久化行已经是 `SessionPersistence` 那个令牌（一个类只能
// 有一个令牌）。跨域编排（复制到工作区）要的是「派生 + 补偿删除」，都住在本域，所以这里只把能力挂出来，
// 编排不认识 `SessionBranch` 也不认识本包的删除账目。
import { SessionId } from "@morlay/dsh-session/contract";
import { SessionBranching, type SessionFork, type SessionForkOptions } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable } from "@morlay/zephyr";
import { SessionBranch } from "../contract/session-branch.contract.ts";
import { asRdbStore } from "../contract/session-rdb-store.contract.ts";

@Injectable()
export class SessionBranchingRdb extends SessionBranching {
  private readonly branch = inject(SessionBranch);

  private readonly persistence = inject(SessionPersistence);

  async fork(sourceId: SessionId, options?: SessionForkOptions): Promise<SessionFork> {
    const cwd = options?.cwd;
    const child = await this.branch.forkFrom(sourceId, cwd === undefined ? {} : { meta: { cwd } });
    return {
      sessionId: child,
      // 撤销走本域自己的补偿删除（复用的事件行登记与派生统计一起清），不借用户删除那条守卫。
      discard: async (): Promise<void> => {
        await asRdbStore(this.persistence).discardDerivedSession(String(child));
      },
    };
  }
}
