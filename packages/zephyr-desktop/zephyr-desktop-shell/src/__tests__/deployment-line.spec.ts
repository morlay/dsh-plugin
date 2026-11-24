import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { CliModeValues } from "@morlay/zephyr-cli";
import { deploymentLineOf } from "../deployment-line.ts";

/** 一份 dev 形态的部署值（打包形态只差 `dataDirSpec` 与两个路径）。 */
const mode: CliModeValues = {
  command: ["desktop", "dev"],
  workspace: "/w",
  profileDir: "/w",
  dataDir: "/d",
  dataDirSpec: "workspace",
  configFile: "",
};

describe("壳的启动路径行", () => {
  test("一行打全七个字段，顺序固定（与 CLI 侧同一字段名）", () => {
    const line = deploymentLineOf({
      form: "packaged",
      mode,
      userData: "/u",
      packaged: true,
    });
    expect(line).toBe(
      "[desktop-shell] mode=packaged workspace=/w profileDir=/w dataDir=/d dataDirSpec=workspace userData=/u packaged=1",
    );
    // 四个关键字段必须都在（对比三形态靠的就是它们）。
    for (const field of ["workspace=", "profileDir=", "dataDir=", "dataDirSpec="]) {
      expect(line).toContain(field);
    }
    expect(line).not.toContain("\n");
  });

  test("userData 拿不到时写问号，packaged 关掉时写 0", () => {
    const line = deploymentLineOf({ form: "dev", mode, userData: undefined, packaged: false });
    expect(line).toContain("userData=? packaged=0");
    expect(line.startsWith("[desktop-shell] mode=dev ")).toBe(true);
  });
});

describe("壳的启动顺序", () => {
  test("打这一行排在把 mode 交给应用之前（两个形态都在）", async () => {
    const source = await readFile(join(import.meta.dirname, "..", "app.ts"), "utf8");
    // 唯一的发生点：`reportDeployment()` 里调 `deploymentLineOf`，两个形态各调它一次。
    expect(source).toContain("deploymentLineOf({");
    expect(source.match(/reportDeployment\(\)/gu)).toHaveLength(3);
    // 交出去的那个 mode 就是打印过的那个：`bootHost(runtimeDir, mode)` 在打印之后。
    const printed = source.indexOf("const mode = await reportDeployment();");
    const handed = source.indexOf("bootHost(runtimeDir, mode)");
    expect(printed).toBeGreaterThan(0);
    expect(handed).toBeGreaterThan(printed);
    // userData 用的是 Electron 自己认的那个（不是部署值回读）。
    expect(source).toContain('app.getPath("userData")');
  });
});
