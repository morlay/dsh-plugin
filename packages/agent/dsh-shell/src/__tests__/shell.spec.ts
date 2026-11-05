/**
 * shell 域的真装配：`provideShell()` 装的是**上游两份实现**——子进程运行时（`LocalSubprocessRuntime`）
 * 与 shell 环境注册表（`ShellEnvRegistry`），两者都经 `fromCordis` 接管。
 *
 * 本包**不提供** `ShellExecutor` 的实现：那个契约由沙箱域的行（`BashSandbox`）兑现，这里只声明。
 * 这条边界是本文件的第一条用例——执行器一旦被误装进基础清单，两个域就会在同一个 scope 上争一个令牌。
 *
 * 其余用例走真实现：`resolveExecutable` 真读 PATH；环境注册表真做登记 / 枚举 / 冲突检测 / 注销。
 */
import { access } from "node:fs/promises";
import type { DshEnvironmentKey } from "@deepseek-ai/dsh-shell";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import {
  ShellEnv,
  ShellExecutor,
  ShellEnvDefault,
  Subprocess,
  SubprocessDefault,
} from "../index.ts";
import { provideShell, provideTerminal } from "../server/index.ts";

const apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
});

/** 起本域的基础装配（只用 `provideShell()`：终端那份清单要沙箱策略与工作目录，不在这里）。 */
async function boot(): Promise<App> {
  const app = await bootstrapApplication({ providers: [...provideShell()], timeoutMs: 20_000 });
  apps.push(app);
  return app;
}

/** 一个最小贡献者：只声明一个 `DSH_*` 键，取值为空。 */
function contributor(name: string, key: string, description: string) {
  return {
    name,
    variables: { [key]: { description } } as Readonly<
      Record<DshEnvironmentKey, { description: string }>
    >,
    resolve: () => ({}) as Readonly<Partial<Record<DshEnvironmentKey, string>>>,
  };
}

describe("shell 域的基础装配", () => {
  it("`provideShell()` 装上游两份实现，顺序是先子进程后 shell 环境", () => {
    expect(provideShell()).toEqual([SubprocessDefault, ShellEnvDefault]);
  });

  it("`ShellExecutor` 在本包只有声明：基础清单与终端清单都不提供它", () => {
    expect(provideShell()).not.toContain(ShellExecutor);
    expect(provideTerminal()).not.toContain(ShellExecutor);
    // 契约是纯声明：原型上没有自己的方法实现（实现由沙箱域的行给）。
    expect(Object.getOwnPropertyNames(ShellExecutor.prototype)).toEqual(["constructor"]);
  });
});

describe("子进程运行时（`Subprocess`）", () => {
  it("`resolveExecutable` 真的解析到 PATH 上的可执行文件", { timeout: 20_000 }, async () => {
    const app = await boot();
    const resolved = await app.get(Subprocess).resolveExecutable("bash");
    expect(typeof resolved).toBe("string");
    expect(resolved).toContain("bash");
    // 异步判据（`node/no-sync`）：能 access 到才算真文件。
    await expect(access(resolved), `解析结果要是真文件：${resolved}`).resolves.toBeUndefined();
  });

  it("不存在的命令走失败面（不是返回空串）", { timeout: 20_000 }, async () => {
    const app = await boot();
    await expect(
      app.get(Subprocess).resolveExecutable("dsh-spec-no-such-command-xyz"),
    ).rejects.toThrow();
  });
});

describe("shell 环境注册表（`ShellEnv`）", () => {
  it("登记后出现在枚举里，注销后消失", { timeout: 20_000 }, async () => {
    const app = await boot();
    const shellEnv = app.get(ShellEnv);

    const dispose = shellEnv.register(
      contributor("dsh-spec-alpha", "DSH_SPEC_ALPHA", "测试用的环境事实"),
    );
    expect(shellEnv.list()).toContainEqual({
      contributor: "dsh-spec-alpha",
      key: "DSH_SPEC_ALPHA",
      description: "测试用的环境事实",
    });

    dispose();
    expect(shellEnv.list().filter((entry) => entry.contributor === "dsh-spec-alpha")).toEqual([]);
  });

  it("同名贡献者重复登记直接抛错", { timeout: 20_000 }, async () => {
    const app = await boot();
    const shellEnv = app.get(ShellEnv);

    shellEnv.register(contributor("dsh-spec-dup", "DSH_SPEC_DUP_1", "第一个"));
    expect(() =>
      shellEnv.register(contributor("dsh-spec-dup", "DSH_SPEC_DUP_2", "第二个")),
    ).toThrow(/already registered/);
  });

  it("一个键被两个贡献者声明直接抛错（报出谁是 owner）", { timeout: 20_000 }, async () => {
    const app = await boot();
    const shellEnv = app.get(ShellEnv);

    shellEnv.register(contributor("dsh-spec-owner", "DSH_SPEC_SHARED", "先占"));
    expect(() =>
      shellEnv.register(contributor("dsh-spec-rival", "DSH_SPEC_SHARED", "后来")),
    ).toThrow(/already owned by contributor "dsh-spec-owner"/);
  });

  it("保留键不许被贡献者占用", { timeout: 20_000 }, async () => {
    const app = await boot();
    await expect(
      Promise.resolve().then(() =>
        app.get(ShellEnv).register(contributor("dsh-spec-reserved", "DSH_HOME", "想抢内置键")),
      ),
    ).rejects.toThrow(/reserved key/);
  });
});
