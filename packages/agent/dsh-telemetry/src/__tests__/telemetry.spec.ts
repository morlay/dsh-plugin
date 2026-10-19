/**
 * telemetry 域的真装配：真 `OTel` 聚合面 + 真会话遥测后端，只用真 `SessionStore` 满足依赖。
 *
 * 两个契约面（`Otel` / `SessionTelemetry`）按设计只有令牌、没有方法，所以行为断言
 * 落在上游聚合面**真实可用的能力**上：能按调用方给的选项建一条独立的事件上报队列，
 * 并能在期限内关掉。不 emit、不连网——构造与关闭都不发请求。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { SessionStoreDefault } from "@morlay/dsh-session";
import { afterEach, describe, expect, it } from "vitest";
import { Otel, SessionTelemetry, provideTelemetry } from "../index.ts";

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 起真 telemetry 栈。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [SessionStoreDefault, ...provideTelemetry()],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return { app };
}

describe("telemetry 域", () => {
  it("装配后两个契约令牌都可解析", async () => {
    const { app } = await boot();

    expect(typeof app.get(Otel)).toBe("object");
    expect(typeof app.get(SessionTelemetry)).toBe("object");
  });

  it("OTel 聚合面能建一条独立的事件上报队列并在期限内关闭", async () => {
    const { app } = await boot();
    const otel = app.get(Otel);

    const reporter = otel.createEventReporter({
      exporter: {
        url: "http://127.0.0.1:9/v1/logs",
        timeoutMillis: 100,
      },
      resourceAttributes: { "service.name": "dsh-test" },
      scope: { name: "dsh-telemetry-test" },
      processor: {
        scheduledDelayMillis: 60_000,
        maxQueueSize: 8,
        maxExportBatchSize: 8,
        exportTimeoutMillis: 200,
      },
      onFailure: () => {},
    });

    expect(typeof reporter.emit).toBe("function");
    // 空队列关闭：不发请求，也不需要外部网络。
    await expect(reporter.shutdown(AbortSignal.timeout(2_000))).resolves.toBeUndefined();
  });
});
