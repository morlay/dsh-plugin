// `job/*` 的宿主面：真 `LocalJobRegistry` + 真上游 `JobController`，断言落在真行为上。
//
// 判据：
// - `job/list` 是**流**：首帧是这个会话能看见的整份花名册（这里没有任务 → 空表），取消后安静结束；
// - `job/kill` 对不认识的任务回上游自己的失败面（`job/not-found`），不是「没实现」。
import { JobControllerRow, JobRegistryDefault } from "../index.ts";
import { JobEndpointDefault } from "@morlay/dsh-job/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

/** 起注册表 + `job/*` 端点。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [...provideTypert(),
    JobRegistryDefault, RemoteHandlersDefault, JobControllerRow, JobEndpointDefault],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("job/* 的宿主面", { timeout: 30_000 }, () => {
  it("list 是流：首帧就是这个会话的整份花名册（空）", async () => {
    const app = await boot();
    const controller = new AbortController();
    const stream = app
      .get(RemoteHandlers)
      .stream("job/list", { request: { sessionId: SessionId("s1") } }, controller.signal);
    expect(stream).toBeDefined();
    const iterator = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const frame = await iterator.next();
    controller.abort();
    expect(frame.done).not.toBe(true);
    // 上游帧形状：`{ jobs: [...] }`（`api/job-controller/src/types.ts` 的 `JobListFrame`）。
    expect(frame.value).toMatchObject({ jobs: [] });
  });

  it("kill 对不认识的任务回上游的失败面（job/not-found），不是「没实现」", async () => {
    const app = await boot();
    const result = await app.get(RemoteHandlers).invoke("job/kill", {
      request: { sessionId: SessionId("s1"), jobId: "nope" },
    });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("job/not-found");
  });
});
