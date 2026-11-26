// 「前端靠什么等待」的框架判据：**listener 返回一个 Promise，框架就等它**。
//
// 审批卡与提问卡都是这个形状：宿主发起一条 waterfall → 浏览器把请求交给 `$on` 注册的 listener →
// listener 不返回（等用户点选）就是"还在等" → 用户点了才把答案送回宿主。这一段之前没有任何用例，
// 断在哪一步都表现为「卡不弹」或「点了没反应」，而装配期全绿。
//
// 这里用真宿主 + 真客户端 `RemoteDefault` + 真 wire；只有「会话域」用最小实现（它是域对象，不是 wire）。
import { bootstrapApplication, configure, Injectable } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished, vi } from "vitest";
import {
  ClientConnectionDefault,
  ClientScopeResolver,
  provideClientConnection,
  provideClientRemote,
  RemoteDefault,
  muxTransport,
  type Remote,
} from "@morlay/zephyr-app/client";
import { RemoteQuestions } from "../../../api-gateway/remote-questions.contract.ts";
import { mountWireApp, type WireApp } from "../../../__tests__/support/wire-app.ts";
/** 客户端作用域的最小实现：本用例只验等待语义（真实现见会话域的 `AgentScopesDefault`）。 */
@Injectable()
class ScopesStub extends ClientScopeResolver {
  readonly scope = { kind: "client-scope" };
  resolve(id: string): object | undefined {
    return id === "a1" ? this.scope : undefined;
  }
}
describe("转发请求的**等待**（真宿主 + 真客户端）", { timeout: 20_000 }, () => {
  test("listener 不返回时宿主一直等；它兑现之后答案才回到发起方", async () => {
    const host = await mountWireApp();
    onTestFinished(() => host.dispose());
    const remote = await clientOf(host);
    const seen: unknown[] = [];
    /** 用户点选：用例握着这个 resolve，就等于握着那张卡。 */
    const chosen = Promise.withResolvers<{ id: string; selected: string[] }>();
    remote.$on("user-questions/request", ((request: unknown) => {
      seen.push(request);
      return chosen.promise;
    }) as never);
    let settled = false;
    const answer = host.app
      .get(RemoteQuestions)
      .ask(
        "user-questions/request",
        { questions: [{ id: "q1", question: "继续吗？" }] },
        {
          id: "a1",
          ctx: host.app.ctx,
        },
      )
      .finally(() => {
        settled = true;
      });
    // 等「请求已经到了浏览器」这个条件成立——此时用户还没点，宿主就不该有结论。
    await vi.waitFor(() => expect(seen.length).toBe(1), { timeout: 10_000 });
    expect(settled, "listener 还在等：宿主不能提前结束这次请求").toBe(false);
    chosen.resolve({ id: "q1", selected: ["继续"] });
    await expect(answer).resolves.toEqual({ id: "q1", selected: ["继续"] });
  });
});
/**
 * 浏览器那一侧：真 `RemoteDefault`（wire 全真），socket 与 unary 都接到这份宿主上。
 * @param host - 真宿主。
 * @returns 客户端 remote 服务。
 */
async function clientOf(host: WireApp): Promise<Remote> {
  const app = await bootstrapApplication({
    providers: [
      ...provideClientConnection(configure(ClientConnectionDefault, { origin: host.origin })),
      ...provideClientRemote(),
      ScopesStub,
    ],
    timeoutMs: 20_000,
  });
  const remote = app.get(RemoteDefault);
  // 非浏览器宿主没有 `location`：socket 与 unary 都要显式接到本用例的宿主上。
  remote.useTransport(
    muxTransport(
      () =>
        ({
          openWebSocket: (path: string) =>
            new WebSocket(`${host.origin.replace(/^http/u, "ws")}${path}`),
        }) as never,
      (input, init) => fetch(`${host.origin}${new URL(String(input), host.origin).pathname}`, init),
    ),
  );
  return remote;
}
