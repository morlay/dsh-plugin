import { describe, expect, it } from "vitest";
import { CliError } from "../errors.ts";
import type { CliModeValues } from "../mode.ts";
import { loadServerProviders } from "../server-entry.ts";
import { tempWorkspace } from "../testing/index.ts";

const MODE: CliModeValues = {
  command: ["dev"],
  workspace: "/w",
  profileDir: "/w",
  dataDir: "/w/.dsh-store",
  dataDirSpec: "workspace",
  configFile: "/w/zephyr.config.ts",
};

describe("服务端入口", () => {
  it("导出一份清单就直接用它", async () => {
    const workspace = await tempWorkspace({ "src/server.ts": "export default ['a', 'b'];\n" });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).resolves.toEqual([
      "a",
      "b",
    ]);
  });

  it("导出函数时把部署参数传进去（清单在装配前就要用它算路径）", async () => {
    const workspace = await tempWorkspace({
      "src/server.ts": "export default (mode) => [mode.dataDir, mode.command.join(' ')];\n",
    });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).resolves.toEqual([
      "/w/.dsh-store",
      "dev",
    ]);
  });

  it("什么都没导出时给出可操作的错误", async () => {
    const workspace = await tempWorkspace({ "src/server.ts": "export const other = 1;\n" });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).rejects.toThrowError(
      CliError,
    );
  });
});
