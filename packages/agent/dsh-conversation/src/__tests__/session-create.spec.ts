/**
 * 建会话的**整包装配**回归：连开两个会话不能撞 prompt 段落。
 *
 * 真机上第一次 `sessions.create({})` 就失败：
 *
 * ```
 * prompt section "context:file-reference" is already registered
 * ```
 *
 * 报错落在 `PromptLayer` 的 **global 层**分支——说明注册方（上游 `file-reference-local` 在
 * `agent.ctx.inject([...])` 里注册的那个段落）拿到的 ctx，`scopeOf` 读不到 agent 的 scope 标记。
 * 各包自己的 spec 装不出这个问题（它们只装自己那几行），所以在**本包自己那份整装**上判
 * （清单见 `./support/host.ts`，与 apps 的那份等价但只含本包的依赖域）。
 */
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent-loop/contract";
import { SessionStore } from "@morlay/dsh-session";
import { cleanupDataDirs, tempDataDir, type FullApp } from "@morlay/zephyr-app/testing";
import { afterEach, describe, it } from "vitest";
import { mountConversationHost } from "./support/host.ts";

const opened: FullApp[] = [];

afterEach(async () => {
  for (const app of opened.splice(0).reverse()) await app.dispose();
  await cleanupDataDirs();
}, 120_000);

describe("整包装配下建会话", { timeout: 180_000 }, () => {
  it("连续 create 两个会话：都不撞 prompt 段落", async () => {
    // 数据根与会话的 cwd 都走 tmpdir：默认的 `<cwd>/.dsh-store` 是开发者真实的库，
    // 而会话 cwd 指到仓库会让上游的 file-reference 去扫真实工作区。
    const dataDir = await tempDataDir("dsh-create-twice-");
    const workdir = await tempDataDir("dsh-create-cwd-");
    const host = await mountConversationHost(join(dataDir, "data"));
    opened.push(host);
    const app = host.app;

    // 直接走 `AgentLoop.create`：撞名发生在**建 agent** 那一步（上游 `file-reference-local` 在
    // `agent.ctx.inject(...)` 里注册 prompt 段落），与 wire 上的准入策略无关。
    const store = app.get(SessionStore);
    const loop = app.get(AgentLoop);
    const spawn = async (): Promise<void> => {
      const id = store.prepare().id;
      await loop.create(
        id,
        { provider: "deepseek-official", model: "deepseek-flash" },
        { cwd: workdir },
      );
    };

    await spawn();
    // 第二个 agent 注册同名段落时撞：报错落在 `PromptLayer` 的 **global 层**分支。
    await spawn();
  });
});
