// workspace 变更广播（host 侧）：`workspace/follow` 的帧来源。
//
// **为什么由命令驱动而不是事件驱动**：上游 `WorkspaceFeed` 订阅 `domain/changed`，而 `StorageDomain` 与
// workspace 行是两个独立作用域——cordis 事件不跨兄弟作用域传播，feed 收不到写事件，follow 流只会有 baseline
// （页面表现：建了工作区，列表不出现）。命令本来就知道自己改了什么，这里把结果折成帧广播出去。
//
// 另一个入口是「会话挂到工作区」（`SessionWorkspaceHost.attach`）：它不走 workspace 命令，
// 所以由它调 `broadcastUpsert`。
import { workspaceView } from "@deepseek-ai/dsh-api-workspace-controller/src/feed.ts";
import { WorkspaceId } from "@deepseek-ai/dsh-workspace";
import { inject, Injectable } from "@morlay/zephyr";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";

@Injectable()
export class WorkspaceBroadcaster {
  private readonly registry = inject(WorkspaceRegistry);

  /** 活跃的 follow 流：帧从命令完成后推给它们。 */
  private readonly followers = new Set<(frame: unknown) => void>();

  /** 一帧 `baseline`：注册表的当前全量（列表顺序即 `registry.list()` 的顺序）。 */
  baseline(): unknown {
    return {
      items: this.registry.list().map((workspace) => workspaceView(workspace)),
      archivedSessionIds: [...this.registry.archivedSessionIds],
      pinnedSessionIds: [...this.registry.pinnedSessionIds],
    };
  }

  /**
   * `workspace/follow` 的帧序列：先 baseline，之后等广播。
   *
   * 用队列 + 唤醒而不是 `for await` 上游 generator：增量来自**命令**（见文件头）。
   * @param signal - 客户端取消信号。
   */
  async *follow(signal: AbortSignal): AsyncGenerator<unknown> {
    const queue: unknown[] = [];
    let wake: (() => void) | undefined;
    const push = (frame: unknown): void => {
      queue.push(frame);
      wake?.();
      wake = undefined;
    };
    const onAbort = (): void => {
      wake?.();
      wake = undefined;
    };
    this.followers.add(push);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      yield { type: "baseline", value: this.baseline() };
      for (;;) {
        if (signal.aborted) return;
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.followers.delete(push);
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** 广播一帧增量给所有活跃的 follow 流（先取快照：推送中途退订不影响本轮）。 */
  broadcast(frame: unknown): void {
    for (const push of Array.from(this.followers)) push(frame);
  }

  /**
   * 把某个工作区的当前状态推一帧 `upsert`。
   * @param workspaceId - 工作区身份。
   */
  broadcastUpsert(workspaceId: string): void {
    // 品牌在边界铸造一次（调用方拿到的是裸字符串）：注册表按 `WorkspaceId` 索引。
    const workspace = this.registry.get(WorkspaceId(workspaceId));
    if (workspace === undefined) return;
    this.broadcast({ type: "upsert", workspace: workspaceView(workspace) });
  }
}
