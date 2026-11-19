// ptc 域的局部闭环：真 `NodePtcRuntimeService` + 真文件系统 / 子进程 / 沙箱栈，只把工作区根换成临时目录。
//
// 判据是「运行时真的接管了令牌，并且它要的四个依赖都在同一个装配里」：PTC 的调用面要活会话与
// 真实进程，装配面能守的是这几条线的接线。
//
// 两行都声明了 `@AgentScoped()`（运行时**按 agent 一份**），所以断言走 `AgentScopedRows.install`：
// 装进某个 scope 的 ctx 之后从那个 ctx 读——这正是 agent 创建处做的事。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import {
  AgentScopedRows,
  AgentScopedRowsDefault,
  SystemPromptDefault,
  ToolRegistryDefault,
} from "@morlay/dsh-agent";
import { FileSystem } from "@morlay/dsh-fs";
import { providePtc } from "@morlay/dsh-ptc";
import { provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { Subprocess } from "@morlay/dsh-shell";
import { provideShell } from "@morlay/dsh-shell/server";
import { bootstrapApplication, type App, configure, type Context } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 30_000);

async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "dsh-ptc-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideSessionProjection(),

      ...provideShell(),
      ...provideSandbox(
        configure(SandboxPolicyDefault, { mode: "read-only", workspaceRoot: root }),
      ),
      // 执行器那一行要注册表与提示词面：它把模型面收成 `run_code`，两条 section 也注册在提示词上。
      SystemPromptDefault,
      ToolRegistryDefault,
      // per-agent 行的装行能力：任何装了 `@AgentScoped()` 行的装配都要有它（agent 骨架里也带一条）。
      AgentScopedRowsDefault,
      ...providePtc(),
    ],
    timeoutMs: 30_000,
  });
  opened.push(app);
  return app;
}

/**
 * 造一个「某个 agent 的 scope」：从应用根派生，于是读得到根上的依赖（fs / subprocess / sandbox）。
 * @param app - 装配结果。
 * @returns 派生的 scope ctx。
 */
function freshScope(app: App): Context {
  return (app.ctx as unknown as Context).extend();
}

describe("ptc 域", () => {
  it("令牌由上游 `NodePtcRuntimeService` 兑现", { timeout: 30_000 }, async () => {
    const app = await boot();
    const scope = freshScope(app);
    await app.get(AgentScopedRows).install(scope);
    // 上游把自己注册成 `ptcRuntime`（它的 `static inject` 就用这个名字读依赖）：
    // 装进这个 scope 之后，读得到的是那一份真实例。
    expect(scope.get("ptcRuntime")).toBeInstanceOf(NodePtcRuntimeService);
  });

  it(
    "它要的四个依赖在同一个装配里就位（fs / subprocess / sandbox / sandboxPolicy）",
    { timeout: 30_000 },
    async () => {
      const app = await boot();
      const scope = freshScope(app);
      await app.get(AgentScopedRows).install(scope);
      expect(app.get(FileSystem)).toBeDefined();
      expect(app.get(Subprocess)).toBeDefined();
      expect(scope.get("ptcRuntime")).toBeInstanceOf(NodePtcRuntimeService);
    },
  );
});
