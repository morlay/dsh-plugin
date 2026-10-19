/**
 * subagent 域的真装配：真 `SubagentRuntime` + 真 sandbox/working-directory + 真 agent 栈，
 * 只把 `AppEnv` 换成临时目录（外部运行环境）。
 *
 * 行为断言落在该契约最有判别力的一处：`resolveMaxDepth` 的三条分支
 * （显式值 > 配置默认 > provider 自理）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, configure } from "@morlay/zephyr";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { provideAgent } from "@morlay/dsh-agent/server";
import { FsSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { WorkingDirectoryDefault } from "@morlay/dsh-working-directory";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SubagentRegistry } from "../contract/subagent-registry.contract.ts";
import { provideSubagent } from "../server/subagent.provide.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-subagent-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 起一套带 working-directory 的真栈。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(),
    
      SessionStoreDefault,
      ...provideAgent(),
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root })([SandboxPolicyDefault]),
      FsSandbox,
      WorkingDirectoryDefault,
      // `provideSubagent` 现在带 `remote.subagents` 的宿主面（要一张 wire handler 表）。
      RemoteHandlersDefault,
      ...provideSubagent(),
    ],
    timeoutMs: 8_000,
  });
  apps.push(app);
  return { app };
}

describe("subagent 域", () => {
  it(
    "装配后 SubagentRegistry 可解析，resolveMaxDepth 按三分支取值",
    { timeout: 20_000 },
    async () => {
      const { app } = await boot();

      const subagents = app.get(SubagentRegistry);
      expect(typeof subagents.resolveMaxDepth).toBe("function");

      // 未显式给值 → 配置默认（上游 Config 默认 1）。
      expect(subagents.resolveMaxDepth()).toBe(1);
      // 显式值原样返回。
      expect(subagents.resolveMaxDepth(3)).toBe(3);
      // provider 自管深度时不设上限。
      expect(subagents.resolveMaxDepth("provider-managed")).toBeUndefined();
    },
  );
});
