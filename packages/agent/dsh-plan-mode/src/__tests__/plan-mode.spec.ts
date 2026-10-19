// plan-mode 域的局部闭环：真 `PlanModeController` + 真工具注册表 / 系统提示 / 投影注册表。
//
// 判据是这一行**真的挂了东西**：计划模式在 apply 里既注册 `exit_plan_mode` 这个工具，
// 又登记自己的系统提示段与会话投影。工具那条最容易观察，用它当证据。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanModeController, EXIT_PLAN_MODE } from "@morlay/dsh-plan-mode/server";
import { ToolRegistry } from "@morlay/dsh-agent";
import { provideAgent } from "@morlay/dsh-agent/server";
import { PlanMode } from "../index.ts";
import { providePlanMode } from "@morlay/dsh-plan-mode/server";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { bootstrapApplication, Injectable, type App } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const opened: App[] = [];
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-plan-mode-"));
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

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 20_000);

async function boot(): Promise<App> {
  // `PlanModeController` 现在声明 `agents`：用真的 agent 目录，不造假件。
  const app = await bootstrapApplication({
    providers: [...provideSession(), ...provideSessionProjection(),
    FakeAppEnv, ...provideAgent(), ...providePlanMode()],
    timeoutMs: 20_000,
  });
  opened.push(app);
  return app;
}

describe("plan-mode 域", () => {
  it("令牌由上游控制器兑现", { timeout: 20_000 }, async () => {
    const app = await boot();
    expect(app.get(PlanMode)).toBeInstanceOf(PlanModeController);
  });

  it("装完这一行，`exit_plan_mode` 工具在工具注册表里", { timeout: 20_000 }, async () => {
    const app = await boot();
    expect(app.get(ToolRegistry).get(EXIT_PLAN_MODE)).toBeDefined();
  });

  it("待办工具（`todo_write`）也跟着这个模块装", { timeout: 20_000 }, async () => {
    const app = await boot();
    expect(app.get(ToolRegistry).get("todo_write")).toBeDefined();
  });
});
