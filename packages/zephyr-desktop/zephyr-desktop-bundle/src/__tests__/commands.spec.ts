import { bootstrapApplication, Logger } from "@morlay/zephyr";
import {
  BuildSteps,
  CliLogger,
  CliMode,
  Command,
  flagOf,
  Workspace,
  type CliModeValues,
} from "@morlay/zephyr-cli";
import { fakeBuildSteps, resolvedFor } from "@morlay/zephyr-cli/testing";
import { describe, expect, it } from "vitest";
import { BundleCommand } from "../commands/bundle.ts";
import { DesktopCommand } from "../commands/desktop.ts";
import { DesktopDevCommand } from "../commands/dev.ts";
import { PackagerDefault } from "../packager.ts";
import { provideDesktopBundle } from "../provide.ts";

/** 只用于装配的形态值（命令面不读它的内容）。 */
const MODE: CliModeValues = {
  command: ["desktop"],
  workspace: "/w",
  profileDir: "/w",
  dataDir: "/w/.dsh-store",
  dataDirSpec: "workspace",
  configFile: "/w/zephyr.config.ts",
};

describe("桌面插件的命令面", () => {
  it("清单里有父命令、dev 与 bundle（父命令不可省，否则算装配错误）", () => {
    const entries = provideDesktopBundle();
    expect(entries).toContain(DesktopCommand);
    expect(entries).toContain(DesktopDevCommand);
    expect(entries).toContain(BundleCommand);
    expect(entries).toContain(PackagerDefault);
  });

  it("path 声明成两段：desktop 是域，dev / bundle 是阶段", async () => {
    const app = await bootstrapApplication({
      providers: [
        { provide: Logger, useValue: new CliLogger("silent") },
        { provide: CliMode, useValue: MODE },
        { provide: Workspace, useValue: resolvedFor({ workspace: "/w" }) },
        { provide: BuildSteps, useValue: fakeBuildSteps() },
        ...provideDesktopBundle(),
      ],
    });
    try {
      const paths = app.getAll(Command).map((command) => command.path.join(" "));
      expect(paths).toEqual(["desktop", "desktop dev", "desktop bundle"]);
    } finally {
      await app.dispose();
    }
  });

  it("desktop dev 声明 --user-data-dir（并行工作区、端口冲突时的出口都指向它）", () => {
    const dev = desktopDevParamsOf();
    expect(flagOf("userDataDir")).toBe("user-data-dir");
    expect(dev["userDataDir"]).toMatchObject({ kind: "string" });
  });
});

/**
 * `desktop dev` 的参数表（命令实例不需要装配就能读声明）。
 * @returns 键 → 参数声明。
 */
function desktopDevParamsOf(): Record<string, unknown> {
  return new DesktopDevCommand().params as Record<string, unknown>;
}
