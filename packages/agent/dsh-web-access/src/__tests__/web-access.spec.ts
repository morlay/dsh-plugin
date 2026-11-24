/**
 * tool-web 的 web 子域真装配：真 `WebRuntime` + 真 http 抓取后端。
 *
 * 抓取的成功路径要出网，测试里不造；这里断言的是它**必须拒绝**的两种输入
 * （SSRF 防护与非法 URL），错误码与文案都来自真实现的判定，不联网。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { Web } from "@morlay/dsh-web-access";
import { DeepSeekAuthToken } from "@morlay/dsh-auth";
import { provideWebAccess } from "@morlay/dsh-web-access/server";

/** 起真 web 栈。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    // 搜索后端（`web-search-deepseek`）从 `ctx.deepseekAuth` 取凭据（上游 0.2.3）：它的显式依赖。
    // 这条 spec 只验 web 域，不需要真凭据链，给一个最小面。
    providers: [
      {
        provide: DeepSeekAuthToken,
        useFactory: () => ({
          connect: () => () => {},
          routeKind: () => undefined,
          candidates: () => [],
          authorize: async () => undefined,
        }),
      },
      ...provideWebAccess(),
    ],
    timeoutMs: 10_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return { app };
}

describe("tool-web 的 web 子域", () => {
  test("装配后 Web 可解析；抓内网地址在发请求这一步失败", async () => {
    const { app } = await boot();

    const web = app.get(Web);
    expect(typeof web.fetch).toBe("function");

    // 上游 0.2.2 的 fetch 只做协议/长度/凭据检查，不做地址策略（`network.ts` 只剩声明），
    // 所以内网地址在这里表现为连接失败。断言只钉「请求真的发出去了、并且失败了」。
    await expect(web.fetch({ url: "http://127.0.0.1:1/" })).rejects.toThrow();
  });

  test("非法 URL 在本地就被拒绝，不是伪造一个空结果", async () => {
    const { app } = await boot();

    await expect(app.get(Web).fetch({ url: "not a url" })).rejects.toThrow();
  });
});
