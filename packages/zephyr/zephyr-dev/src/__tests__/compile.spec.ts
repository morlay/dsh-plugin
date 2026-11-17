// `compile()` 的两条**判据错误**：空清单、缺 REQUIRED 已知包。
//
// 判据在**枚举与断言**那一段，所以两条用例都只需要「一个 client 入口」（夹具里的 `app-boot.ts`），
// 不必跑真打包——跑真打包既慢又会被无关的打包失败掩盖掉判据本身。
//
// 同时钉住「判据没被放宽」：`REQUIRED_PREBUNDLE` 里那三个包是**已知包**，谁把断言删掉或把某个名字挪走，
// 这几条会立刻红。`shiki` 现在**枚举得到了**（下潜到 `@deepseek-ai/dsh-client*` 之后），所以第二条改成
// 「只点名真正缺的那个」——把"shiki 不再缺失"也钉住，否则枚举范围一缩，这条会悄悄退回旧行为。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, REQUIRED_PREBUNDLE } from "../build/compile.ts";

/** 夹具根（两个目录各有自己的 `src/client/app-boot.ts`）。 */
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

/**
 * 一次调用的输入：产物落 tmpdir（用例不需要产物，只判判据）。
 * @param name - 夹具目录名。
 * @returns `compile()` 的输入。
 */
async function optionsOf(name: string): Promise<Parameters<typeof compile>[0]> {
  const workspace = join(FIXTURES, name);
  const outDir = await mkdtemp(join(tmpdir(), "zephyr-compile-"));
  return { workspace, appName: "compile-fixture", outDir };
}

describe("compile（判据）", () => {
  it("空清单：点名报「清单为空」，并带上入口与产物落点", async () => {
    const options = await optionsOf("compile-empty");
    const error = await compile(options).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单为空");
    // 诊断行要能直接指出是**哪个**入口与**哪个**产物目录（dev 的缓存与 build 的产物目录不同）。
    expect(error?.message).toContain("compile-empty/src/client/app-boot.ts");
    expect(error?.message).toContain(options.outDir);
  });

  it("缺 REQUIRED 已知包：逐个点名，并在构建前就失败", async () => {
    const error = await compile(await optionsOf("compile-partial")).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单缺已知包");
    // 夹具只引了 `@morlay/zephyr-app/client`：它自己（`@morlay/zephyr-app`）与下潜到的 `shiki` 都在清单里，
    // 只有 `@morlay/dsh-conversation` 缺——**缺几个就点几个**（不是「几个」而是一句话说完）。
    expect(error?.message).toContain("@morlay/dsh-conversation");
    for (const name of REQUIRED_PREBUNDLE.filter((item) => item !== "@morlay/dsh-conversation")) {
      expect(error?.message).not.toContain(name);
    }
  });

  it("判据没放宽：REQUIRED 仍是那三个包（含只在别人 node_modules 里的 shiki）", () => {
    expect([...REQUIRED_PREBUNDLE]).toEqual([
      "@morlay/zephyr-app",
      "@morlay/dsh-conversation",
      "shiki",
    ]);
  });
});
