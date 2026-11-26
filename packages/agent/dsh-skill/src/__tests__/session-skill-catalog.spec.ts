// `skills/list` 的宿主接缝：端点在 `RemoteHandlers` 里真的注册了，调用落到上游
// `SessionSkillCatalog.list`——失败也是上游自己的失败面（`session/not-found`），不是
// `[remote] skills/list 没有实现`。
//
// 依赖用真的模块装：agent 目录、session query（sqlite 内存）、typert registry、working-directory
// 与它的 fs（沙箱行）、skill registry。没有假件。
import { provideAgent } from "@morlay/dsh-agent";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { AppEnv, RemoteHandlers, provideApiGateway, provideTypert } from "@morlay/zephyr-app";
import { describe, expect, test, type AppEnvFixture } from "@morlay/zephyr-app/testing";
import { provideSessionQuerySqlite } from "@morlay/dsh-session/server";
import { provideSkill } from "@morlay/dsh-skill/server";

/** 指向临时目录的运行环境。 */
/**
 * 起 `skills/list` 的宿主栈。
 * @returns handler 表。
 */
async function boot(appEnv: AppEnvFixture): Promise<RemoteHandlers> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),
      { provide: AppEnv, useValue: appEnv },
      // 顺序即装配顺序：`provideSkill()` 里的工具行要 `ToolRegistry`，它由 `provideAgent()` 里的适配行给。
      ...provideAgent(),
      // 技能域一个装配函数装齐：注册表、工具行、适配行与 `skills` 端点行。
      ...provideSkill(),
      ...provideWorkingDirectory(
        configure(WorkingDirectoryDefault, { defaultDirectory: appEnv.values.dataDir }),
      ),
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      FsSandbox,
    ],
    timeoutMs: 20_000,
  });
  // 卸载跟着 fixture 的清理链走（它跑在「删临时目录」之前；`onTestFinished` 更晚，见 `fixtures.ts`）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return app.get(RemoteHandlers);
}

describe("skills/list 的宿主端点", () => {
  test(
    "端点在 handler 表里；对未知会话失败在上游服务（不是「没有实现」）",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const handlers = await boot(appEnv);
      // 裸值口径：宿主**抛**上游的 `RemoteError`（不是回 `{ ok:false, error }`）。
      // 包过一层的话这里会是 `{ ok:false, error:{…} }` 而不抛。
      const error = await handlers
        .invoke("skills/list", { request: { sessionId: "s-unknown" } })
        .then(
          () => new Error("应当抛错"),
          (thrown: unknown) => thrown,
        );
      expect(error).not.toHaveProperty("ok");
      expect((error as { code?: string }).code).toBe("session/not-found");
    },
  );
});
