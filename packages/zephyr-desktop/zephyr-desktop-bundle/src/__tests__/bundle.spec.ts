import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapApplication, Injectable, Logger, type ProviderEntry } from "@morlay/zephyr";
import {
  BuildSteps,
  CliError,
  CliLogger,
  CliMode,
  Command,
  Workspace,
  type CliModeValues,
  type ResolvedConfig,
} from "@morlay/zephyr-cli";
import { fakeBuildSteps, resolvedFor, tempWorkspace } from "@morlay/zephyr-cli/testing";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { BundleCommand } from "../commands/bundle.ts";
import { Packager } from "../packager.ts";
import { FakePackager } from "../testing/index.ts";

/**
 * 带 desktop 段的解析结果。
 * @param workspace - 工作区。
 * @returns 解析结果。
 */
function demoResolved(workspace: string): ResolvedConfig {
  const base = resolvedFor({ workspace, appName: "Demo" });
  return {
    ...base,
    config: {
      ...base.config,
      desktop: { id: "ai.example.demo", name: "Demo", window: { width: 900, height: 700 } },
    },
  };
}

/**
 * 造一份「构建已经完成」的产物。
 *
 * 真构建跑完必然有 `bootstrap.mjs` 与 `client_modules/`（框架的 build 期冒烟会去加载它）；
 * 用例用替身步骤，所以这里把那份产物补上，避免把「替身步骤没产物」当成被测行为。
 * @param resolved - 解析结果。
 * @returns 造完成。
 */
async function seedClosure(resolved: ResolvedConfig): Promise<void> {
  await mkdir(resolved.layout.clientModules, { recursive: true });
  await writeFile(
    resolved.layout.manifest,
    JSON.stringify({ name: "demo", type: "module", dependencies: {} }),
    "utf8",
  );
  await writeFile(resolved.layout.bootstrap, "export default [];\n", "utf8");
}

/**
 * 装上「打包就失败」的替身：证明 pack 的异常不会被命令吞掉（CLI 必须非 0）。
 */
@Injectable()
class FailingPackager extends Packager {
  /**
   * @returns 永不返回（总是抛）。
   * @throws CliError 模拟打包期冒烟失败。
   */
  async pack(): Promise<never> {
    throw new CliError("运行时闭包不自包含（测试替身）");
  }

  /**
   * @param _result - 打包结果。
   * @returns 安装路径（本用例走不到）。
   */
  async install(_result: { readonly appDir: string }): Promise<string> {
    return "/Applications/fake.app";
  }
}

/**
 * 装一棵只含 bundle 命令的树。
 * @param resolved - 解析结果。
 * @param packager - 打包替身（缺省 `FakePackager`）。
 * @returns 装配结果与两个替身。
 */
async function mount(resolved: ResolvedConfig, packager: ProviderEntry = FakePackager) {
  const steps = fakeBuildSteps();
  const mode: CliModeValues = {
    command: ["desktop", "bundle"],
    workspace: resolved.workspace,
    profileDir: resolved.layout.root,
    dataDir: join(resolved.workspace, ".dsh-store"),
    dataDirSpec: "workspace",
    configFile: resolved.configFile,
  };
  const app = await bootstrapApplication({
    providers: [
      { provide: CliMode, useValue: mode },
      { provide: Workspace, useValue: resolved },
      { provide: Logger, useValue: new CliLogger("silent") },
      { provide: BuildSteps, useValue: steps },
      packager,
      BundleCommand,
    ],
  });
  const command = app.getAll(Command).find((candidate) => candidate instanceof BundleCommand);
  return { app, mode, command, steps };
}

describe("desktop bundle（装配级）", () => {
  test("没有产物时先构建一次，再交出配置与身份文件", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    await seedClosure(resolved);
    const { app, mode, command, steps } = await mount(resolved);
    try {
      const code = await command?.run({ params: {}, rest: [], mode });
      expect(code).toBe(0);
      const packager = app.get(Packager) as FakePackager;
      // 构建的三步各一次（前端静态目录 / 运行时闭包 / 生产态装配）= 构建跑了一轮
      expect(steps.calls).toHaveLength(3);
      expect(packager.packs[0]?.appId).toBe("ai.example.demo");
      await expect(access(join(resolved.layout.root, "desktop.json"))).resolves.toBeUndefined();
      expect(packager.installs).toHaveLength(0);
    } finally {
      await app.dispose();
    }
  });

  test("每次 bundle 都先重建（包里的产物必须与源码一致）", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    // 已经有旧产物也照样重建：旧产物可能对应已经改掉的源码。
    await mkdir(resolved.layout.root, { recursive: true });
    await writeFile(resolved.layout.bootstrap, "export default {};", "utf8");
    const { app, mode, command, steps } = await mount(resolved);
    try {
      await command?.run({ params: {}, rest: [], mode });
      expect(steps.calls.length).toBeGreaterThan(0);
    } finally {
      await app.dispose();
    }
  });

  test("--install 才装进系统应用目录", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    await seedClosure(resolved);
    const { app, mode, command } = await mount(resolved);
    try {
      await command?.run({ params: { install: true }, rest: [], mode });
      const packager = app.get(Packager) as FakePackager;
      expect(packager.installs).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });

  test("打包失败必须冒到调用方（CLI 才会非 0）", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    await seedClosure(resolved);
    const { app, mode, command } = await mount(resolved, FailingPackager);
    try {
      // 不吞：命令 reject，且是带退出码 1 的 CliError（runCli 据此返回 1）。
      await expect(command?.run({ params: {}, rest: [], mode })).rejects.toMatchObject({ code: 1 });
      await expect(command?.run({ params: {}, rest: [], mode })).rejects.toThrow(/不自包含/u);
      // 同进程里跑过 electron-builder 之后退出码可能被异步代码盖掉：命令自己要把它按住。
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    } finally {
      await app.dispose();
    }
  });
});
