import { describe, expect, test } from "@morlay/zephyr/testing";
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
  test("导出一份清单就直接用它", async () => {
    const workspace = await tempWorkspace({ "src/server.ts": "export default ['a', 'b'];\n" });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).resolves.toEqual([
      "a",
      "b",
    ]);
  });

  test("导出函数时把部署参数传进去（清单在装配前就要用它算路径）", async () => {
    const workspace = await tempWorkspace({
      "src/server.ts": "export default (mode) => [mode.dataDir, mode.command.join(' ')];\n",
    });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).resolves.toEqual([
      "/w/.dsh-store",
      "dev",
    ]);
  });

  test("具名 providers 是入口的正式形态（应用侧不再写默认导出）", async () => {
    const workspace = await tempWorkspace({
      "src/server.ts": "export const providers = (mode) => [mode.profileDir];\n",
    });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).resolves.toEqual(["/w"]);
  });

  test("什么都没导出时给出可操作的错误", async () => {
    const workspace = await tempWorkspace({ "src/server.ts": "export const other = 1;\n" });
    await expect(loadServerProviders(`${workspace}/src/server.ts`, MODE)).rejects.toThrowError(
      CliError,
    );
  });
});
