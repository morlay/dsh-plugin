// `skills/list` 的宿主接缝：端点在 `RemoteHandlers` 里真的注册了，调用落到上游
// `SessionSkillCatalog.list`——失败也是上游自己的失败面（`session/not-found`），不是
// `[remote] skills/list 没有实现`。
//
// 依赖用真的模块装：agent 目录、session query（sqlite 内存）、typert registry、working-directory
// 与它的 fs（沙箱行）、skill registry。没有假件。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAgent } from "@morlay/dsh-agent";
import { FsSandbox, SandboxDefault, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { SubprocessDefault } from "@morlay/dsh-shell";
import { WorkingDirectoryDefault, provideWorkingDirectory } from "@morlay/dsh-agent";
import { bootstrapApplication, Injectable, configure } from "@morlay/zephyr";
import {
  AppEnv,
  RemoteHandlers,
  provideApiGateway,
  provideTypert,
  type AppEnvValues,
} from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provideSessionQuerySqlite } from "@morlay/dsh-session/server";
import { provideSkill } from "@morlay/dsh-skill/server";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-skill-catalog-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/**
 * 起 `skills/list` 的宿主栈。
 * @returns handler 表。
 */
async function boot(): Promise<RemoteHandlers> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      ...provideSessionQuerySqlite(),
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),
      FakeAppEnv,
      // 顺序即装配顺序：`provideSkill()` 里的工具行要 `ToolRegistry`，它由 `provideAgent()` 里的适配行给。
      ...provideAgent(),
      // 技能域一个装配函数装齐：注册表、工具行、适配行与 `skills` 端点行。
      ...provideSkill(),
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
      SubprocessDefault,
      SandboxDefault,
      SandboxPolicyDefault,
      FsSandbox,
    ],
    timeoutMs: 20_000,
  });
  apps.push(app);
  return app.get(RemoteHandlers);
}

describe("skills/list 的宿主端点", () => {
  it(
    "端点在 handler 表里；对未知会话失败在上游服务（不是「没有实现」）",
    { timeout: 20_000 },
    async () => {
      const handlers = await boot();
      const result = await handlers.invoke("skills/list", { request: { sessionId: "s-unknown" } });
      console.log("PROBE result", JSON.stringify(result));
      expect(result).toMatchObject({
        ok: false,
        error: { code: "session/not-found" },
      });
    },
  );
});
