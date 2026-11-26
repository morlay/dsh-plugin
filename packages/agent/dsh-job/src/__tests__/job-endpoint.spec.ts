// `job/*` 的宿主面：真 `LocalJobRegistry` + 真上游 `JobController`，断言落在真行为上。
//
// 判据：
// - `job/list` 是**流**：首帧是这个会话能看见的整份花名册（这里没有任务 → 空表），取消后安静结束；
// - `job/kill` 对不认识的任务回上游自己的失败面（`job/not-found`），不是「没实现」。
import { JobControllerRow, JobRegistryDefault } from "../index.ts";
import { JobEndpointDefault } from "@morlay/dsh-job/server";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlers, provideApiGateway } from "@morlay/zephyr-app";
import { provideTypert } from "@morlay/zephyr-app";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 起注册表 + `job/*` 端点。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideTypert(),
      // `typertGateway` 的实现是上游 `api/gateway` 的 `TypertGatewayService`（我们不再自己写）。
      ...provideApiGateway(),
      JobRegistryDefault,
      JobControllerRow,
      JobEndpointDefault,
    ],
    timeoutMs: 20_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app;
}

describe("job/* 的宿主面", { timeout: 30_000 }, () => {
  test("list 是流：首帧就是这个会话的整份花名册（空）", async () => {
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

  test("kill 失败是**抛异常**（裸值口径：失败不是 `{ ok:false, error }`）", async () => {
    const app = await boot();
    const error = await app
      .get(RemoteHandlers)
      .invoke("job/kill", { request: { sessionId: SessionId("s1"), jobId: "nope" } })
      .then(
        () => new Error("应当抛错"),
        (thrown: unknown) => thrown,
      );
    // 上游 `JobError` 原样抛出来（`jobs/error.ts:28`）；包过一层的话这里会是 `{ ok:false, error:{…} }`。
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/unknown job/);
    expect(error).not.toHaveProperty("ok");
  });
});
