// `compile()` 的两条**判据错误**：空清单、缺 REQUIRED 已知包。
//
// 判据在**枚举与断言**那一段，所以两条用例都只需要「一个 client 入口」（夹具里的 `app-boot.ts`），
// 不必跑真打包——跑真打包既慢又会被无关的打包失败掩盖掉判据本身。
//
// 同时钉住「判据没被放宽」：`REQUIRED_PREBUNDLE` 里那三个包是**已知包**（`shiki` 现在仍缺，是下一票的事），
// 谁把断言删掉或把某个名字挪走，这两条会立刻红。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheRootOf, compile, REQUIRED_PREBUNDLE } from "../build/compile.ts";

/** 夹具根（两个目录各有自己的 `src/client/app-boot.ts`）。 */
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

/**
 * 一次调用的输入：产物落 tmpdir（用例不需要产物，只判判据）。
 * @param name - 夹具目录名。
 * @returns `compile()` 的输入。
 */
async function optionsOf(name: string): Promise<Parameters<typeof compile>[0]> {
  const workspace = join(FIXTURES, name);
  const cacheRoot = cacheRootOf(await mkdtemp(join(tmpdir(), "zephyr-compile-")));
  return { workspace, appName: "compile-fixture", dataDirSpec: "workspace", cacheRoot };
}

describe("compile（判据）", () => {
  it("空清单：点名报「清单为空」，并带上入口与产物落点", async () => {
    const error = await compile(await optionsOf("compile-empty")).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单为空");
    // 诊断行要能直接指出是**哪个**入口与**哪个**缓存根（`--data-dir=xdg` 与默认值下要改的东西不同）。
    expect(error?.message).toContain("compile-empty/src/client/app-boot.ts");
    expect(error?.message).toContain("cache/client-modules");
  });

  it("缺 REQUIRED 已知包：逐个点名（shiki 等），并在构建前就失败", async () => {
    const error = await compile(await optionsOf("compile-partial")).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单缺已知包");
    // 只引用了一个已知包，其余两个都必须被点名（不是「几个」而是一句话说完）。
    for (const name of REQUIRED_PREBUNDLE.filter((item) => item !== "@morlay/zephyr-app")) {
      expect(error?.message).toContain(name);
    }
  });

  it("判据没放宽：REQUIRED 仍是那三个包（含现在仍缺的 shiki）", () => {
    expect([...REQUIRED_PREBUNDLE]).toEqual([
      "@morlay/zephyr-app",
      "@morlay/dsh-conversation",
      "shiki",
    ]);
  });
});
