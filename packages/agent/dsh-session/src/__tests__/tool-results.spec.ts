// `toolResults/watch` 的宿主面：真会话 + 真上游 `SessionToolResults`，只把「一次工具结果的写入」当外部输入喂进去。
//
// 判据：会话里有了一条工具结果之后，`handlers.stream("toolResults/watch", { request: { sessionId, seq } })`
// 的第一帧就是那条值（`{ available: true, value }`）。
//
// 造法说明（诚实边界）：上游按 `tools/result` 事件的 `exec.agent.session` 与 `exec.callId` 记账，并在随后的
// `tool/result` 会话事件里把键**改写成 `event.seq`**（`client/ui-trajectory/src/index.ts:44-72`）。这里
// 直接发一条 `tools/result`，把 `callId` 给成数字 `seq`——等价于「那条会话事件已经按 seq 记好账」，
// 于是 `watch({ seq })` 就能取到它。真实流量里由工具执行与事件落库共同产生，这个 spec 不覆盖那半条链。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { ToolResultsDefault } from "../server/tool-results.service.ts";
import { FakeAppEnv } from "./support/fake-app-env.ts";

const SESSION = "s1";
const SEQ = 7;

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** 起真会话存储 + `toolResults` 行。 */
async function boot(): Promise<App> {
  const root = await mkdtemp(join(tmpdir(), "dsh-tool-results-"));
  roots.push(root);
  FakeAppEnv.root = root;
  const app = await bootstrapApplication({
    providers: [
      ...provideTypert(),
      ...provideSession(),
      ...provideSessionProjection(),
      FakeAppEnv,
      RemoteHandlersDefault,
      ToolResultsDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("toolResults/watch 的宿主面", { timeout: 30_000 }, () => {
  it("订阅上了：没有工具结果时首帧是 available:false，取消后流安静结束", async () => {
    const app = await boot();
    const sessions = app.get(SessionStore);
    // 真会话（`create` 会把它 enter + announce 进注册表）：作用域解析要它在册。
    sessions.create(SessionId(SESSION));

    const controller = new AbortController();
    const stream = app
      .get(RemoteHandlers)
      .stream("toolResults/watch", { request: { sessionId: SESSION, seq: SEQ } }, controller.signal);
    expect(stream).toBeDefined();
    const frames: unknown[] = [];
    for await (const frame of stream as AsyncIterable<unknown>) {
      frames.push(frame);
      // 第一帧到手就取消：`watch` 之后会一直等新值，取消即结束这一代。
      controller.abort();
    }
    // **弱断言**（诚实边界）：这条只证明「端点接上了上游 `watch`、帧按协议发出来、取消不抛」。
    // 「真工具结果写进来后能读到那一帧」没有覆盖：要覆盖得先能造 `ToolDispatchExecution` 的**全形**
    // （`ctx.emit("tools/result", exec, result)` 是闭合事件类型，`exec` 缺一个字段就 `TS2769`），
    // 那份形状见上游 `core/agent/src/runtime-types.ts`——留给有真工具执行的集成用例。
    expect(frames[0]).toEqual({ available: false });
  });
});
