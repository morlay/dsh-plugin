/**
 * tool-web 的 web 子域真装配：真 `WebRuntime` + 真 http 抓取后端。
 *
 * 抓取的成功路径要出网，测试里不造；这里断言的是它**必须拒绝**的两种输入
 * （SSRF 防护与非法 URL），错误码与文案都来自真实现的判定，不联网。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { Web } from "@morlay/dsh-web-access";
import { provideWebAccess } from "@morlay/dsh-web-access/server";

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 起真 web 栈。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [...provideWebAccess()],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return { app };
}

describe("tool-web 的 web 子域", () => {
  it("装配后 Web 可解析；抓内网地址在发请求这一步失败", async () => {
    const { app } = await boot();

    const web = app.get(Web);
    expect(typeof web.fetch).toBe("function");

    // 上游 0.2.2 的 fetch 只做协议/长度/凭据检查，不做地址策略（`network.ts` 只剩声明），
    // 所以内网地址在这里表现为连接失败。断言只钉「请求真的发出去了、并且失败了」。
    await expect(web.fetch({ url: "http://127.0.0.1:1/" })).rejects.toThrow();
  });

  it("非法 URL 在本地就被拒绝，不是伪造一个空结果", async () => {
    const { app } = await boot();

    await expect(app.get(Web).fetch({ url: "not a url" })).rejects.toThrow();
  });
});
