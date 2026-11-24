// 转发事件源（宿主半）的**真服务**判据：真 Web 宿主 + 真 wire + 真客户端 transport。
//
// 不用替身 gateway：这条链的失败模式恰好都发生在真实 wire 上——帧投不出去、同一条请求投两遍、
// 请求按「没人应答」结束。替身只会把「登记上了」说成通过，而界面上什么都不弹。
// 装配与 dev 同形：WebServer + Connection/ApiGateway + mux 服务 + 客户端 `muxTransport`。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished, vi } from "vitest";
import { muxTransport, type RemoteFetch } from "@morlay/zephyr-app/client";
import { AppEnv } from "@morlay/zephyr-app";
import {
  CredentialsInMemory,
  createTestingAppEnv,
  WebServer,
  provideApiGateway,
  provideConnection,
  provideMuxServer,
  provideTypert,
  provideWeb,
} from "@morlay/zephyr-app/testing";
import { TypertGateway } from "../../typert/gateway.contract.ts";
import { RemoteQuestions } from "../remote-questions.contract.ts";
/** 一条要答复的请求（本 spec 只用到这一样）。 */
const QUESTION = { questions: [{ id: "q1", question: "继续吗？" }] };
/** 起好的宿主。 */
interface Host {
  readonly app: App;
  readonly port: number;
  dispose(): Promise<void>;
}
/** 起一份带 wire 面的宿主（与 dev 同形的那些行）。 */
async function boot(): Promise<Host> {
  const root = await mkdtemp(join(tmpdir(), "zephyr-app-remote-events-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv("PORT", "0");
  const app = await bootstrapApplication({
    providers: [
      { provide: AppEnv, useValue: createTestingAppEnv({ root }) },
      CredentialsInMemory,
      ...provideWeb(),
      ...provideConnection(),
      ...provideTypert(),
      ...provideApiGateway(),
      ...provideMuxServer(),
    ],
    timeoutMs: 20_000,
  });
  return { app, port: app.get(WebServer).port, dispose: () => app.dispose() };
}
/**
 * 浏览器那一侧：真 WebSocket（流式与 `$events`）+ 真 HTTP（unary 与 `$events/result`）。
 * @param port - 宿主端口。
 * @returns 客户端 transport。
 */
function clientOf(port: number) {
  const origin = `http://127.0.0.1:${String(port)}`;
  const fetchOf: RemoteFetch = (input, init) =>
    fetch(`${origin}${new URL(String(input), origin).pathname}`, init);
  return muxTransport(
    () =>
      ({
        openWebSocket: (path: string) => new WebSocket(`${origin.replace(/^http/u, "ws")}${path}`),
      }) as never,
    fetchOf,
  );
}
describe("转发事件源（真宿主 + 真客户端）", { timeout: 20_000 }, () => {
  test("宿主发起请求 → 浏览器收到 waterfall 帧并作答 → 答复回到发起方", async () => {
    const host = await boot();
    onTestFinished(() => host.dispose().catch(() => {}));
    const transport = clientOf(host.port);
    const asked: string[] = [];
    transport.answer?.(async (invocation) => {
      asked.push(invocation.event);
      return { kind: "result", value: { answers: [{ id: "q1", selected: ["继续"] }] } };
    });
    // 等客户端的事件流就位：没有它，请求会一直在队列里等人。
    await vi.waitFor(() => expect(host.app.get(TypertGateway).hasLiveClient()).toBe(true), {
      timeout: 10_000,
    });
    const answer = await host.app
      .get(RemoteQuestions)
      .ask("user-questions/request", QUESTION, { id: "a1", ctx: host.app.ctx });
    expect(asked, "同一条请求只该投一次（投两次就是界面上两张卡）").toEqual([
      "user-questions/request",
    ]);
    expect(answer, "答复要原样回到发起方").toEqual({
      answers: [{ id: "q1", selected: ["继续"] }],
    });
  });
});
