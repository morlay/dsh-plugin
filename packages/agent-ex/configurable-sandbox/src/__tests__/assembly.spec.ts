// 装配面的明确判据：`without(SandboxDefault)` + `without(FsSandbox)` 之后两个令牌由本包兑现。
//
// 三条判据各管一件事（都不是重复 `plugin.spec.ts`）：
// - 官方两行在位时（对照组）两个令牌是官方实现，装配也起得来——证明 `without` 确实换掉了东西；
// - 只剔掉一个实现时，另一个仍由官方兑现（`without` 按实现类定位，不误伤）；
// - 本包清单里每一行都能被 `without` 定位（装配面要能按需剔）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystem, LocalFileSystem } from "@morlay/dsh-fs";
import { FsSandbox, LocalSandboxProvider, Sandbox, SandboxDefault } from "@morlay/dsh-sandbox";
import {
  ConfigurableFileSystem,
  ConfigurableFsSandbox,
  ConfigurableSandbox,
  ConfigurableSandboxProvider,
  SandboxFileDefault,
  SandboxRulesDefault,
  SandboxRuntimeContexts,
  provideConfigurableSandbox,
} from "@morlay/configurable-sandbox";
import { bootstrapApplication, provide, without, type App } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { createTestingAppEnv } from "@morlay/zephyr-app/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { FakePolicy } from "./support/fake-policy.ts";
import { fakeSandboxFileOf } from "./support/fake-sandbox-file.ts";

async function workspaceRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "configurable-sandbox-asm-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function boot(
  providers: Parameters<typeof bootstrapApplication>[0]["providers"],
): Promise<App> {
  const app = await bootstrapApplication({ providers, timeoutMs: 15_000 });
  onTestFinished(() => app.dispose().catch(() => undefined));
  return app;
}

describe("装配面", () => {
  test("对照组：官方两行在位时两个令牌是官方实现", async () => {
    FakePolicy.root = await workspaceRoot();
    const app = await boot([FakePolicy, ...provide([SandboxDefault, FsSandbox])()]);

    expect(app.get(Sandbox)).toBeInstanceOf(LocalSandboxProvider);
    expect(app.get(FileSystem)).toBeInstanceOf(LocalFileSystem);
  });

  test("剔除官方两行 + 装本包：两个令牌换成本包的实现", async () => {
    const root = await workspaceRoot();
    FakePolicy.root = root;
    const app = await boot([
      FakePolicy,
      { provide: AppEnv, useValue: createTestingAppEnv({ root }) },
      ...provide([SandboxDefault, FsSandbox])(without(SandboxDefault), without(FsSandbox)),
      fakeSandboxFileOf(undefined),
      ...provideConfigurableSandbox(without(SandboxFileDefault)),
    ]);

    expect(app.get(Sandbox)).toBeInstanceOf(ConfigurableSandboxProvider);
    expect(app.get(FileSystem)).toBeInstanceOf(ConfigurableFileSystem);
  });

  test("只剔一个：另一个仍由官方兑现（without 按实现类定位）", async () => {
    const root = await workspaceRoot();
    FakePolicy.root = root;
    const app = await boot([
      FakePolicy,
      { provide: AppEnv, useValue: createTestingAppEnv({ root }) },
      ...provide([SandboxDefault, FsSandbox])(without(SandboxDefault)),
      fakeSandboxFileOf(undefined),
      ...provideConfigurableSandbox(without(SandboxFileDefault), without(ConfigurableFsSandbox)),
    ]);

    expect(app.get(Sandbox)).toBeInstanceOf(ConfigurableSandboxProvider);
    expect(app.get(FileSystem)).toBeInstanceOf(LocalFileSystem);
  });

  test("不带 feature 的 provideConfigurableSandbox() 也起得来（默认读面写 DSH_HOME）", async () => {
    const dir = await workspaceRoot();
    FakePolicy.root = dir;
    // `SandboxFileDefault` 读 `{DSH_HOME}/sandbox.toml`：把这台机器的 home 指到临时目录，用例不依赖开发机配置。
    const previous = process.env["DSH_HOME"];
    process.env["DSH_HOME"] = dir;
    try {
      const app = await boot([
        FakePolicy,
        { provide: AppEnv, useValue: createTestingAppEnv({ root: dir }) },
        ...provide([SandboxDefault, FsSandbox])(without(SandboxDefault), without(FsSandbox)),
        ...provideConfigurableSandbox(),
      ]);

      expect(app.get(Sandbox)).toBeInstanceOf(ConfigurableSandboxProvider);
      expect(app.get(FileSystem)).toBeInstanceOf(ConfigurableFileSystem);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "DSH_HOME");
      else process.env["DSH_HOME"] = previous;
    }
  });

  test("本包清单里每一行都能被 without 定位（装配面按需剔）", () => {
    for (const impl of [
      SandboxFileDefault,
      SandboxRulesDefault,
      ConfigurableSandbox,
      ConfigurableFsSandbox,
      SandboxRuntimeContexts,
    ]) {
      expect(provideConfigurableSandbox(without(impl)).length).toBe(
        provideConfigurableSandbox().length - 1,
      );
    }
  });
});
