/**
 * session-title 域的真装配：真会话存储 + 真投影 + 真上游 `SessionTitleService`。
 *
 * 行为断言走标题自己的语义：未命名时读不到 → 会话里出现 `session/title` 事件后
 * `get` 折叠出该标题。会话本身是真 `SessionStore.create` 出来的活会话。
 *
 * 写入路径（`rename()`）也覆盖：上游会先 `assertServiceActive()`（`ownerFiber.uid !== null &&
 * state === ACTIVE`），行作用域的 fiber 现在有非空 uid，所以这条链路是通的。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { AgentDirectoryDefault } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { describe, expect, test, type AppEnvFixture } from "@morlay/dsh-conversation/testing";
import { SessionTitle } from "../index.ts";
import { provideSessionTitle } from "../server/session-title.provide.ts";

/**
 * 起真会话栈 + 标题服务。
 * @param appEnv - 本用例的运行环境（会话持久化要读它的 `dataDir`）。
 * @returns 装配面。
 */
async function boot(
  appEnv: AppEnvFixture,
): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [
      ...provideSession(),
      ...provideSessionProjection(),
      { provide: AppEnv, useValue: appEnv },
      AgentDirectoryDefault,
      ...provideSessionTitle(),
    ],
    timeoutMs: 10_000,
  });
  // 卸载跟着 fixture 的清理链走（它早于 `onTestFinished`，见 `fixtures.ts` 文件头）。
  appEnv.onCleanup(() => app.dispose().catch(() => {}));
  return { app };
}

describe("session-title 域", () => {
  test("装配后 SessionTitle 可解析，rename 后 get 读回规范化标题", async ({ appEnv }) => {
    const { app } = await boot(appEnv);

    const titles = app.get(SessionTitle);
    expect(typeof titles.get).toBe("function");

    // 不传 id：由存储自己铸一个（`SessionStore.create(id?)`），拿到的是真会话对象。
    const session = app.get(SessionStore).create();
    expect(titles.get(session)).toBeUndefined();

    // 标题是会话日志里的 `session/title` 事件折叠出来的：追加一条就能读到。
    session.append("session/title", {
      title: "手写标题",
      messageSeqs: [],
      source: { kind: "user" },
    });
    expect(titles.get(session)?.title).toBe("手写标题");

    // 再改一次：写入路径可重复调用，且读回的是最后一次。
    titles.rename(session, "第二次改名");
    expect(titles.get(session)?.title).toBe("第二次改名");
  });
});
