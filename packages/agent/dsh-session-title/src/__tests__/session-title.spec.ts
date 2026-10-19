/**
 * session-title 域的真装配：真会话存储 + 真投影 + 真上游 `SessionTitleService`。
 *
 * 行为断言走标题自己的语义：未命名时读不到 → 会话里出现 `session/title` 事件后
 * `get` 折叠出该标题。会话本身是真 `SessionStore.create` 出来的活会话。
 *
 * 写入路径（`rename()`）也覆盖：上游会先 `assertServiceActive()`（`ownerFiber.uid !== null &&
 * state === ACTIVE`），行作用域的 fiber 现在有非空 uid，所以这条链路是通的。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { AgentDirectoryDefault } from "@morlay/dsh-agent/server";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionTitle, provideSessionTitle } from "../index.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-title-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境（会话持久化要读它）。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 起真会话栈 + 标题服务。 */
async function boot(): Promise<{ app: Awaited<ReturnType<typeof bootstrapApplication>> }> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    FakeAppEnv, AgentDirectoryDefault, ...provideSessionTitle()],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return { app };
}

describe("session-title 域", () => {
  it("装配后 SessionTitle 可解析，rename 后 get 读回规范化标题", async () => {
    const { app } = await boot();

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
