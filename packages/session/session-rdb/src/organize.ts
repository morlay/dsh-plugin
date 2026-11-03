import type { Context } from "@deepseek-ai/cordis";
import { SESSION_ORGANIZE_PATH } from "./routes.ts";
import { mountJsonRoute } from "./http/route.ts";
import type { SessionPersistenceRdb } from "./session-store.ts";

export { SESSION_ORGANIZE_PATH };

interface OrganizeAgentLike {
  cancel?(cause: { kind: "user" }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

// 让所有运行中的 agent 先退场：整理数据要重写事件与统计表，运行中的写路径必须停下来。
async function stopRunningAgents(ctx: Context): Promise<number> {
  const agents = ctx.get("agents") as { list(): OrganizeAgentLike[] } | undefined;
  const running = agents?.list() ?? [];
  for (const agent of running) agent.cancel?.({ kind: "user" }, { keepInbox: true });
  await Promise.all(running.map((agent) => agent.whenIdle()));
  return running.length;
}

/**
 * 整理数据通道：停 agent → 回收孤儿（会话 / 事件行）→ 重算派生统计 → VACUUM。
 *
 * 不只是清理孤儿：三张派生统计表是可销毁重建的，整理时一并整表重算，修掉旁路累加漏记或旧数据漂移。
 */
export function registerSessionOrganize(ctx: Context, persistence: SessionPersistenceRdb): void {
  mountJsonRoute(ctx, {
    path: SESSION_ORGANIZE_PATH,
    handle: async () => {
      const stoppedAgents = await stopRunningAgents(ctx);
      const { orphanSessions, orphanEvents, rebuiltSessions } = await persistence.organize();
      return {
        body: { stoppedAgents, orphanSessions, orphanEvents, rebuiltSessions, vacuumed: true },
      };
    },
  });
}
