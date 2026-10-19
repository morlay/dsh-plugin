// @vitest-environment happy-dom
/**
 * `SessionController.create` 的局部闭环（client 用 mock 宿主）。
 *
 * 守的是「基于 workspace 建会话」这条交互：UI 传目录 / workspace，wire 上必须变成
 * `session/create` 的 `request` 命名参数，返回值解成宿主给的会话身份。
 *
 * 只替传输层（`FakeRemote`）；`SessionRemote` 与 `SessionController` 都是装配里的真实现，
 * 断言全部经 `SessionController` 契约方法与 wire 载荷。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { SessionRemoteDefault } from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";
import { SessionController } from "../session-controller.contract.ts";
import { provideSessionsStore } from "../sessions.provide.ts";
import { FakeRemote, type RemoteCall } from "./support/fake-remote.ts";

/**
 * 建好 client 半（假传输 + 真 store），并把 `session/create` 的 wire 载荷收集起来。
 * @param createReply - 宿主对 `session/create` 的应答。
 * @returns 应用、会话目录与收集到的调用。
 */
async function boot(createReply: () => unknown): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  sessions: SessionController;
  calls: RemoteCall[];
}> {
  const calls: RemoteCall[] = [];
  FakeRemote.next = {
    handlers: {
      "session/list": () => ({ ids: [], byId: {} }),
      "session/create": (payload) => {
        calls.push({ endpoint: "session/create", args: payload.args });
        return createReply();
      },
    },
    streams: {},
  };
  const app = await bootstrapApplication({
    providers: [
      // 会话 store 的数据面装配函数。
      ...provideSessionsStore(),
      // `SessionRemote` 的默认实现（本仓 client 半的装配面；断言不经它）。
      FakeRemote,
      SessionRemoteDefault,
    ],
    timeoutMs: 10_000,
  });
  return { app, sessions: app.get(SessionController), calls };
}

describe("SessionController.create", { timeout: 10_000 }, () => {
  it("把目录作为 request 命名参数发出去，返回宿主的 sessionId", async () => {
    const { app, sessions, calls } = await boot(() => ({ sessionId: "s1" }));
    try {
      await expect(sessions.create({ cwd: "/tmp/w1" })).resolves.toBe("s1");
      expect(calls).toEqual([
        { endpoint: "session/create", args: { request: { cwd: "/tmp/w1" } } },
      ]);
    } finally {
      await app.dispose().catch(() => {});
    }
  });

  it("宿主响应缺 sessionId 时报可读错误（不把 undefined 当成会话身份）", async () => {
    const { app, sessions } = await boot(() => ({ id: "s1" }));
    try {
      await expect(sessions.create({ cwd: "/tmp/x" })).rejects.toThrow(
        "session/create 的响应不符合契约",
      );
    } finally {
      await app.dispose().catch(() => {});
    }
  });
});
