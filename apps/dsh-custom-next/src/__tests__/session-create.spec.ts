/**
 * 建会话的**整份装配**回归：连开两个会话不能撞 prompt 段落。
 *
 * 真机上第一次 `sessions.create({})` 就失败：
 *
 * ```
 * prompt section "context:file-reference" is already registered
 * ```
 *
 * 报错落在 `PromptLayer` 的 **global 层**分支——说明注册方（上游 `file-reference-local` 在
 * `agent.ctx.inject([...])` 里注册的那个段落）拿到的 ctx，`scopeOf` 读不到 agent 的 scope 标记。
 * `packages/` 各自的 spec 装不出这个问题（它们只装自己那几行），所以这条判据必须放在
 * **整份清单**上：`customProvidersOf(rows)` 就是 `main.ts` 用的那一份。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { clientPackagesOf } from "@morlay/zephyr-app";
import { afterEach, beforeAll, describe, it } from "vitest";
import { customProvidersOf } from "../zephyr.provide.ts";

const opened: App[] = [];
const roots: string[] = [];

// 持久化会把盘上的会话**加载回 `SessionStore`**，而 `prepare()` 的计数器每次从 0 起——
// 共用同一个 `.dsh-store` 时，第二次跑就撞 `session "session-1" already exists`。
// 这条用例只看"建会话不撞段落"，所以跑前把会话目录清掉（设置文档保留）。
beforeAll(async () => {
  await rm(join(process.cwd(), ".dsh-store", "sessions"), { recursive: true, force: true });
});

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 60_000);

describe("整份装配下建会话", { timeout: 120_000 }, () => {
  it("连续 create 两个会话：都不撞 prompt 段落", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-create-twice-"));
    roots.push(root);
    // 装配面会真的 `listen`（`WebServerDefault` 读 `process.env.PORT`，缺省 3080）：必须用随机端口。
    process.env.PORT = "0";
    const app = await bootstrapApplication({
      providers: customProvidersOf([...new Set(await clientPackagesOf(customProvidersOf([])))]),
      timeoutMs: 60_000,
    });
    opened.push(app);

    // 直接走 `AgentLoop.create`：撞名发生在**建 agent** 那一步（上游 `file-reference-local` 在
    // `agent.ctx.inject(...)` 里注册 prompt 段落），与 wire 上的准入策略无关——后者是另一条债
    // （`RemoteAccess` 适配行缺 `decide`）。
    const store = app.get(SessionStore);
    const loop = app.get(AgentLoop);
    const spawn = async (): Promise<void> => {
      const id = store.prepare().id;
      await loop.create(id, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
    };

    await spawn();
    // 第二个 agent 注册同名段落时撞：报错落在 `PromptLayer` 的 **global 层**分支，说明两次注册
    // 的 `scopeOf(调用方 ctx)` 都是 `undefined`——上游 `file-reference-local` 走的是
    // `agent.ctx.inject([...])`，而栈顶是我们的 `withDeps.inject` 短路分支（`from-cordis.ts`）。
    await spawn();
  });
});
