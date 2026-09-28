import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../../tsdown.config.ts";

/** 入库那份与真源渲染出来的同形：bundle patch 是生成物，改它要改 `tool/patch.ts`。 */
describe("ollama-provider-profile 的 bundle patch", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/bundles/ollama-provider-profile/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(await render());
    expect(
      (await render()).startsWith(
        "# 本文件由 packages/bundles/ollama-provider-profile/tsdown.config.ts 生成",
      ),
    ).toBe(true);
  });
});
