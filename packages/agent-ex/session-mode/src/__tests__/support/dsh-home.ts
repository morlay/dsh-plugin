// 用例的 `{dshHome}`：模式定义的真源是 `{dshHome}/modes/*.toml`，装配时按 id 覆盖 `config.modes` 里的同名项。
// 每条会装配本行的用例都必须把它指到一个空的临时目录，否则开发机上真用户的 `modes/coding.toml` 会顶掉用例输入。
//
// 这是**测试支撑的生命周期**（整文件共用一份环境），不是 spec 级状态：`pinDshHome()` 在 spec 的模块作用域
// 调一次，`beforeAll`/`afterAll` 因此保留（`.oxlintrc.json` 里按文件豁免 `vitest/no-hooks`）。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

// 文件级挂载（在 spec 的模块作用域直接调一次）：整个文件共用一份空 home，跑完连目录一起删。
export function pinDshHome(): void {
  let home = "";
  let previous: string | undefined;
  beforeAll(async () => {
    // 归一成 canonical 路径：macOS 上 `/var` 指向 `/private/var`。
    home = await realpath(await mkdtemp(join(tmpdir(), "session-mode-home-")));
    previous = process.env["DSH_HOME"];
    process.env["DSH_HOME"] = home;
  });
  afterAll(async () => {
    if (previous === undefined) Reflect.deleteProperty(process.env, "DSH_HOME");
    else process.env["DSH_HOME"] = previous;
    if (home !== "") await rm(home, { recursive: true, force: true });
  });
}
