// 用例的 `{dshHome}`：模式定义的真源是 `{dshHome}/modes/*.toml`（`mode-store.ts`），装配时按 id 覆盖
// `config.modes` 里的同名项。所以每条会装配本行的用例都必须把它指到一个**空的临时目录**——否则开发机上真用户的
// `modes/coding.toml` 会顶掉用例里写的那份定义（工具名单、persona、开关全被换掉），失败信息看起来像产品回归，
// 实际是"被测输入被环境换掉了"。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

// 文件级挂载（在 spec 的模块作用域直接调一次）：整个文件共用一份空 home，跑完连目录一起删。
export function pinDshHome(): void {
  let home = "";
  let previous: string | undefined;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "dsh-home-"));
    previous = process.env["DSH_HOME"];
    process.env["DSH_HOME"] = home;
  });
  afterAll(async () => {
    if (previous === undefined) Reflect.deleteProperty(process.env, "DSH_HOME");
    else process.env["DSH_HOME"] = previous;
    if (home !== "") await rm(home, { recursive: true, force: true });
  });
}
