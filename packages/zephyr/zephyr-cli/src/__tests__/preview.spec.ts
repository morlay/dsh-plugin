// 判据 7：缺产物时 `preview` 报错退出，**不静默重建**（设计「四、行为与边界」）。
//
// 两条各删一样：`bootstrap.mjs`（装配文件）与 `client_modules/`（前端静态目录）。
// 它们是 preview 唯一要读的两样；缺一样就不该起服务——「我明明 build 过」这类问题的答案只有这一句。
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapApplication, Logger } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { Command } from "../command.ts";
import { PreviewCommand } from "../commands/preview.ts";
import { Workspace } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import { CliLogger } from "../logger.ts";
import { CliMode, type CliModeValues } from "../mode.ts";
import { resolvedFor, tempWorkspace } from "../testing/index.ts";

/** 本轮建的临时目录（用例结束统一删）。 */
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * 造一份产物（按需建 `bootstrap.mjs` 与 `client_modules/`）。
 * @param shape - 要建哪几样。
 * @returns 解析结果与命令模式。
 */
async function mount(shape: { readonly bootstrap: boolean; readonly clientModules: boolean }) {
  const workspace = await tempWorkspace({});
  created.push(workspace);
  const resolved = resolvedFor({ workspace, appName: "Demo" });
  if (shape.bootstrap) {
    await mkdir(resolved.layout.root, { recursive: true });
    await writeFile(resolved.layout.bootstrap, "export default [];\n", "utf8");
  }
  if (shape.clientModules) {
    await mkdir(resolved.layout.clientModules, { recursive: true });
    await writeFile(join(resolved.layout.clientModules, "index.html"), "<!doctype html>\n", "utf8");
  }
  const mode: CliModeValues = {
    command: ["preview"],
    workspace,
    profileDir: resolved.layout.root,
    dataDir: join(workspace, ".dsh-store"),
    dataDirSpec: "workspace",
    configFile: resolved.configFile,
  };
  const app = await bootstrapApplication({
    providers: [
      { provide: CliMode, useValue: mode },
      { provide: Workspace, useValue: resolved },
      { provide: Logger, useValue: new CliLogger("silent") },
      PreviewCommand,
    ],
  });
  const command = app.getAll(Command).find((candidate) => candidate instanceof PreviewCommand);
  return { app, command, mode, layout: resolved.layout };
}

describe("preview（判据 7：缺产物就报错）", () => {
  it("缺 bootstrap.mjs：CliError，指出缺哪个与怎么补", async () => {
    const { app, command, mode } = await mount({ bootstrap: false, clientModules: true });
    try {
      const error = await command?.run({ params: {}, rest: [], mode }).then(
        () => undefined,
        (rejected: unknown) => rejected,
      );
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain("bootstrap.mjs");
      expect((error as CliError).message).toContain("zephyr build");
      // 退出码非 0（`runCli` 据此返回）。
      expect((error as CliError).code).toBe(1);
    } finally {
      await app.dispose();
    }
  });

  it("缺 client_modules/：同样当场报错（不回退到现场编译）", async () => {
    const { app, command, mode } = await mount({ bootstrap: true, clientModules: false });
    try {
      await expect(command?.run({ params: {}, rest: [], mode })).rejects.toThrowError(
        /client_modules/u,
      );
    } finally {
      await app.dispose();
    }
  });

  it("两样都在：进到装配那一步（不报产物缺失）", async () => {
    const { app, command, mode } = await mount({ bootstrap: true, clientModules: true });
    try {
      // 装配文件是替身（`export default []`，不是函数）：报错必然来自它，而不是产物校验。
      await expect(command?.run({ params: {}, rest: [], mode })).rejects.toThrowError(/装配函数/u);
    } finally {
      await app.dispose();
    }
  });
});
