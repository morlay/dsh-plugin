// `subagent` 域的装配：`SubagentRegistryDefault` 接管上游 `SubagentRuntime`，
// `resolveMaxDepth` 的三条分支（默认 / 显式 / provider 自管）都落在这里。
//
// 归本包：`SubagentRegistry` 的契约与适配行都在 `dsh-agent-loop`；装配里要的沙箱与工作目录是
// **下游**（agent-loop → sandbox 是生产边），反方向不成立，所以 spec 住这边。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { WorkingDirectoryDefault, provideAgent, SubagentRegistry } from "@morlay/dsh-agent";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication } from "@morlay/zephyr";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provideSubagent } from "../index.ts";

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
    providers: [
      ...provideSessionProjection(),

      SessionStoreDefault,
      ...provideAgent(),
      { provide: SandboxPolicyDefault, config: { mode: "workspace-write", workspaceRoot: root } },
      FsSandbox,
      WorkingDirectoryDefault,
      // `provideSubagent` 带 `remote.subagents` 的宿主面（要一张 wire handler 表）。
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
