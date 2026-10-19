// shell 域的局部闭环：真 `LocalSubprocessRuntime` + 真 `ShellEnvRegistry`，不假本包服务。
//
// 断言落在两处外部事实：可执行文件解析回本机绝对路径（执行世界的能力），以及注册表的
// 「登记 → 枚举 → 卸载」与键冲突拒绝（`DSH_*` 谁声明谁负责，重复即报错）。
import { isAbsolute } from "node:path";
import { ToolCallId } from "@morlay/dsh-agent/server";
import { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import type { ToolDispatchExecution } from "@deepseek-ai/dsh-tools";
import { ToolRegistry } from "@morlay/dsh-agent";
import { SystemPromptDefault, ToolExecutorNative, ToolRegistryDefault } from "@morlay/dsh-agent/server";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { ShellEnv, ShellExecutor, Subprocess } from "../index.ts";
import { provideShell } from "../index.ts";

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 10_000);

async function boot(): Promise<App> {
  const app = await bootstrapApplication({
    providers: [
      ...provideShell(),
      // 工具注册表只为「拿一次真实执行上下文」而装：`collect` 的入参是运行时真值。
      // 0.2.2 起 `ToolRuntime.execute` 先选执行器（`selectExecutor`），没有它就抛
      // `ToolExecutorUnavailableError`——所以这一行必须一起装（与 `provideAgent` 的排法一致）。
      SystemPromptDefault,
      ToolRegistryDefault,
      ToolExecutorNative,
    ],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return app;
}

/**
 * 真执行一次探针工具，返回那次执行的 `ToolExecution`。
 *
 * `collect(execution)` 里的 `token` 由注册表在执行期分配（没有导出的工厂），所以走真实路径：
 * 注册探针 → `execute` → 从 `tools/execute`（scoped waterfall）的载荷里取那份执行。
 * @param app - 已装配的应用。
 * @returns 那次执行的载荷。
 */
async function runProbeExecution(app: App): Promise<ToolDispatchExecution> {
  const registry = app.get(ToolRegistry);
  const dispose = registry.register({
    name: "spec-probe",
    description: "只为拿一次真实执行上下文",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "object" },
      render: () => [{ type: "text", text: "ok" }],
    },
    execute: async () => ({}),
  });
  try {
    const captured = new Promise<ToolDispatchExecution>((resolve) => {
      // `tools/execute` 从 scope carrier（agent 缺失时是根 scope）派发：root 监听要显式 global。
      app.ctx.on(
        "tools/execute",
        (exec, next) => {
          resolve(exec);
          return next();
        },
        { global: true },
      );
    });
    await registry.execute({
      // 0.2.2 起 `execute` 收的是**批量**输入：`calls` 是模型产出的 tool-call 块（`arguments` 是 JSON 串）。
      calls: [{ type: "tool-call", id: ToolCallId("spec-call"), name: "spec-probe", arguments: "{}" }],
      signal: new AbortController().signal,
    });
    return await captured;
  } finally {
    dispose();
  }
}

describe("shell 域：子进程 + shell 环境", () => {
  it("`provideShell` 装的是上游的两份实现，两个契约令牌都能解析", async () => {
    const app = await boot();
    // Service 类的适配行由上游实例自己兑现令牌（`fromCordis` 只做接管与转发）。
    expect(app.get(Subprocess)).toBeInstanceOf(LocalSubprocessRuntime);
    expect(app.get(ShellEnv)).toBeInstanceOf(ShellEnvRegistry);
  });

  it("`resolveExecutable` 把裸名字解析成本机绝对路径", { timeout: 20_000 }, async () => {
    const app = await boot();
    const subprocess = app.get(Subprocess);

    const node = await subprocess.resolveExecutable("node");
    expect(isAbsolute(node)).toBe(true);

    // 不存在的名字要拒绝，而不是回落到原样字符串。
    await expect(subprocess.resolveExecutable("dsh-no-such-executable")).rejects.toThrow();
  });

  it(
    "shell 环境注册表：登记后能枚举、能收集取值，注销后消失；重复的键被拒",
    { timeout: 20_000 },
    async () => {
      const app = await boot();
      const shellEnv = app.get(ShellEnv);
      const dispose = shellEnv.register({
        name: "spec",
        variables: { DSH_SPEC_FLAG: { description: "spec 专用的事实" } },
        resolve: () => ({ DSH_SPEC_FLAG: "on" }),
      });

      expect(shellEnv.list()).toContainEqual(
        expect.objectContaining({ key: "DSH_SPEC_FLAG", contributor: "spec" }),
      );
      expect(shellEnv.collect(await runProbeExecution(app))).toMatchObject({ DSH_SPEC_FLAG: "on" });

      expect(() =>
        shellEnv.register({
          name: "spec-2",
          variables: { DSH_SPEC_FLAG: { description: "抢同一个键" } },
          resolve: () => ({}),
        }),
      ).toThrow(/already owned/);

      dispose();
      expect(shellEnv.list().some((entry) => entry.key === "DSH_SPEC_FLAG")).toBe(false);
    },
  );

  it("`ShellExecutor` 令牌由沙箱域的行兑现，本包只声明契约", async () => {
    const app = await boot();
    // 本包没有 shell 执行器的实现（`BashSandbox` 在沙箱域，因为它要 `Sandbox` 才能 mount）。
    expect(app.tryGet(ShellExecutor)).toBeUndefined();
  });
});
