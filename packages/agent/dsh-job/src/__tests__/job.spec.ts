// job 域的局部闭环：真 `LocalJobRegistry`（上游）经 `JobRegistryDefault` 接管。
//
// 断言落在注册表自己的语义上：空装配下目录是空的、查不到的 id 直接失败（不静默给 undefined），
// 而不是「令牌能解析」这一条——契约面是空的，能解析本身不说明什么。
import { JobId } from "@deepseek-ai/dsh-jobs";
import { ToolRegistry } from "@morlay/dsh-agent";
import { SystemPromptDefault, ToolRegistryDefault } from "@morlay/dsh-agent/server";
import { JobRegistry } from "@morlay/dsh-job";
import { provideJob } from "@morlay/dsh-job/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 10_000);

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    // `provideJob` 现在还带 `remote.job` 的宿主面（上游 `JobController` 要 `typert` 与 wire 的 handler 表）。
    providers: [...provideTypert(),
    SystemPromptDefault, ToolRegistryDefault, RemoteHandlersDefault, ...provideJob()],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return app;
}

describe("job 域", () => {
  it("令牌由上游注册表兑现，空装配下目录为空", async () => {
    const app = await boot();
    const jobs = app.get(JobRegistry);
    expect(jobs.list()).toEqual([]);
  });

  it("这个域的工具行随模块一起装：`job_list` 在工具注册表里", async () => {
    const app = await boot();
    expect(app.get(ToolRegistry).get("job_list")).toBeDefined();
  });

  it("查不到的 id 直接失败，不静默给空值", async () => {
    const app = await boot();
    expect(() => app.get(JobRegistry).get(JobId("no-such-job"))).toThrow(/unknown job/);
  });
});
