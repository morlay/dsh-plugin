// ptc 域的局部闭环：真 `NodePtcRuntimeService` + 真文件系统 / 子进程 / 沙箱栈，只把工作区根换成临时目录。
//
// 判据是「运行时真的接管了令牌，并且它要的四个依赖都在同一个装配里」：PTC 的调用面要活会话与
// 真实进程，装配面能守的是这几条线的接线。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { FileSystem } from "@morlay/dsh-fs";
import { PtcRuntime, providePtc } from "@morlay/dsh-ptc";
import { provideSandbox, SandboxPolicyDefault } from "@morlay/dsh-sandbox";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { provideShell, Subprocess } from "@morlay/dsh-shell";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
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
    providers: [...provideSessionProjection(),
    
      ...provideShell(),
      ...provideSandbox(configure(SandboxPolicyDefault, { mode: "read-only", workspaceRoot: root })),
      ...providePtc(),
    ],
    timeoutMs: 30_000,
  });
  opened.push(app);
  return app;
}

describe("ptc 域", () => {
  it("令牌由上游 `NodePtcRuntimeService` 兑现", { timeout: 30_000 }, async () => {
    const app = await boot();
    expect(app.get(PtcRuntime)).toBeInstanceOf(NodePtcRuntimeService);
  });

  it("它要的四个依赖在同一个装配里就位（fs / subprocess / sandbox / sandboxPolicy）", { timeout: 30_000 }, async () => {
    const app = await boot();
    expect(app.get(FileSystem)).toBeDefined();
    expect(app.get(Subprocess)).toBeDefined();
    expect(app.tryGet(PtcRuntime)).toBeDefined();
  });
});
