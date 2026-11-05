import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapApplication, Logger } from "@morlay/zephyr";
import {
  BuildSteps,
  CliLogger,
  CliMode,
  Command,
  Workspace,
  type CliModeValues,
  type ResolvedConfig,
} from "@morlay/zephyr-cli";
import { fakeBuildSteps, resolvedFor, tempWorkspace } from "@morlay/zephyr-cli/testing";
import { describe, expect, it } from "vitest";
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
 * 装一棵只含 bundle 命令的树。
 * @param resolved - 解析结果。
 * @returns 装配结果与两个替身。
 */
async function mount(resolved: ResolvedConfig) {
  const steps = fakeBuildSteps();
  const mode: CliModeValues = {
    command: ["desktop", "bundle"],
    workspace: resolved.workspace,
    profileDir: resolved.layout.runtime,
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
      FakePackager,
      BundleCommand,
    ],
  });
  const command = app.getAll(Command).find((candidate) => candidate instanceof BundleCommand);
  return { app, mode, command, steps };
}

describe("desktop bundle（装配级）", () => {
  it("没有产物时先构建一次，再交出配置与身份文件", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    const { app, mode, command, steps } = await mount(resolved);
    try {
      const code = await command?.run({ params: {}, rest: [], mode });
      expect(code).toBe(0);
      const packager = app.get(Packager) as FakePackager;
      // 三步各一次 = 构建跑了一轮
      expect(steps.calls).toHaveLength(3);
      expect(packager.packs[0]?.appId).toBe("ai.example.demo");
      await expect(access(join(resolved.layout.root, "desktop.json"))).resolves.toBeUndefined();
      expect(packager.installs).toHaveLength(0);
    } finally {
      await app.dispose();
    }
  });

  it("每次 bundle 都先重建（包里的产物必须与源码一致）", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    // 已经有旧产物也照样重建：旧 `entry.mjs` 可能对应已经改掉的源码。
    await mkdir(resolved.layout.runtime, { recursive: true });
    await writeFile(resolved.layout.entry, "export default {};", "utf8");
    const { app, mode, command, steps } = await mount(resolved);
    try {
      await command?.run({ params: {}, rest: [], mode });
      expect(steps.calls.length).toBeGreaterThan(0);
    } finally {
      await app.dispose();
    }
  });

  it("--install 才装进系统应用目录", async () => {
    const workspace = await tempWorkspace({});
    const resolved = demoResolved(workspace);
    const { app, mode, command } = await mount(resolved);
    try {
      await command?.run({ params: { install: true }, rest: [], mode });
      const packager = app.get(Packager) as FakePackager;
      expect(packager.installs).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });
});
