/**
 * goal 域的状态机真装配：真会话 + 真 agent 循环 + 真 goal 服务。
 *
 * 唯一的外部替身是 `AppEnv`（运行环境）。断言落在 goal 自己的状态机上：
 * 未创建时读不到 → `create` 后 active/armed → `disarm` 只改进程内激活态 →
 * 同阶段重复创建被拒。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { AgentLoop, ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { SessionStore } from "@morlay/dsh-session";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Goal } from "@morlay/dsh-goal";
import { provideGoal } from "@morlay/dsh-goal/server";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-goal-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 指向临时目录的运行环境。 */
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

/** 起真 session/agent/goal 栈，并造一个空闲 agent。 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  agent: Awaited<ReturnType<AgentLoop["create"]>>;
}> {
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    FakeAppEnv, ...provideAgent(), ...provideGoal()],
    timeoutMs: 20_000,
  });
  apps.push(app);
  // 会话标识用存储铸出来的真值（`prepare()` 不注册进目录，正好交给下一行去建）：
  // 本包不直接依赖 `@deepseek-ai/dsh-session`，不需要它的品牌工厂。
  const sessionId = app.get(SessionStore).prepare().id;
  const agent = await app
    .get(AgentLoop)
    .create(sessionId, { provider: "deepseek-official", model: "deepseek-flash" }, { cwd: root });
  return { app, agent };
}

describe("goal 域", () => {
  it("create → get → disarm：阶段与激活态按状态机变化", async () => {
    const { app, agent } = await boot();
    const goals = app.get(Goal);

    expect(goals.get(agent)).toBeUndefined();

    const created = goals.create(agent, { objective: "把测试补齐", maxGoalRounds: 3 });
    expect(created.phase).toBe("active");
    expect(created.activation).toBe("armed");
    expect(created.objective).toBe("把测试补齐");
    expect(goals.get(agent)?.id).toBe(created.id);

    // disarm 只撤进程内续跑授权，不改持久阶段与 revision。
    const disarmed = goals.disarm(agent);
    expect(disarmed?.activation).toBe("disarmed");
    expect(disarmed?.phase).toBe("active");
    expect(disarmed?.revision).toBe(created.revision);
    expect(goals.get(agent)?.activation).toBe("disarmed");

    // 同阶段重复创建被拒：只能 clear 或 resume，不能悄悄替换。
    expect(() => goals.create(agent, { objective: "另一个目标" })).toThrow(/already exists/);

    // 这个域的工具行随 `provideGoal` 一起装：`get_goal` 在工具注册表里。
    expect(app.get(ToolRegistry).get("get_goal")).toBeDefined();
  });
});
