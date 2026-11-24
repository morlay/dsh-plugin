import { bootstrapApplication, Logger } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { BuildSteps } from "../build/builder.ts";
import { BuildCommand } from "../commands/build.ts";
import { Command } from "../command.ts";
import { Workspace } from "../config/contract.ts";
import { CliLogger } from "../logger.ts";
import { CliMode, type CliModeValues } from "../mode.ts";
import { fakeBuildSteps, resolvedFor, tempWorkspace } from "../testing/index.ts";

describe("build 命令（装配级）", () => {
  test("把三步交给步骤替身，并按步汇总", async () => {
    const workspace = await tempWorkspace({});
    const resolved = resolvedFor({ workspace });
    const mode: CliModeValues = {
      command: ["build"],
      workspace,
      profileDir: resolved.layout.root,
      dataDir: `${workspace}/.dsh-store`,
      dataDirSpec: "workspace",
      configFile: resolved.configFile,
    };
    const steps = fakeBuildSteps();
    const lines: string[] = [];
    const app = await bootstrapApplication({
      providers: [
        { provide: CliMode, useValue: mode },
        { provide: Workspace, useValue: resolved },
        { provide: BuildSteps, useValue: steps },
        {
          provide: Logger,
          useValue: new CliLogger("info", {
            stdout: (line) => void lines.push(line),
            stderr: () => {},
          }),
        },
        BuildCommand,
      ],
    });
    try {
      const command = app.getAll(Command).find((candidate) => candidate instanceof BuildCommand);
      expect(command).toBeDefined();
      const code = await command?.run({ params: {}, rest: [], mode });
      expect(code).toBe(0);
      // 三步各一次（顺序由 runBuild 保证）：前端静态目录 / 运行时闭包 / 生产态装配
      expect(steps.calls).toHaveLength(3);
      expect(lines.join("\n")).toContain("前端静态目录");
      expect(lines.join("\n")).toContain("完成");
    } finally {
      await app.dispose();
    }
  });
});
