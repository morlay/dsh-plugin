import type { Context } from "@deepseek-ai/cordis";
import { SESSION_GC_PATH } from "./routes.ts";
import { mountJsonRoute } from "./http/route.ts";
import type { SessionPersistenceRdb } from "./index.ts";

export { SESSION_GC_PATH };

interface GcAgentLike {
  cancel?(cause: { kind: "user" }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

// 让所有运行中的 agent 先退场：GC 要重写事件表，运行中的写路径必须停下来。
async function stopRunningAgents(ctx: Context): Promise<number> {
  const agents = ctx.get("agents") as { list(): GcAgentLike[] } | undefined;
  const running = agents?.list() ?? [];
  for (const agent of running) agent.cancel?.({ kind: "user" }, { keepInbox: true });
  await Promise.all(running.map((agent) => agent.whenIdle()));
  return running.length;
}

// GC 通道：停 agent → 回收孤儿事件行 → VACUUM，一次请求完成。
export function registerSessionGc(ctx: Context, persistence: SessionPersistenceRdb): void {
  mountJsonRoute(ctx, {
    path: SESSION_GC_PATH,
    handle: async () => {
      const stoppedAgents = await stopRunningAgents(ctx);
      // 先回收孤儿会话，再回收事件行：被删会话独占的事件行才刚成为孤儿。
      const orphanSessions = await persistence.collectOrphanSessions();
      const orphanEvents = await persistence.collectOrphans();
      await persistence.vacuum();
      return { body: { orphanSessions, orphanEvents, stoppedAgents, vacuumed: true } };
    },
  });
}
