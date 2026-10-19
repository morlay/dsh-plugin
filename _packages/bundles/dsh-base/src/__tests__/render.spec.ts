import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, sourceUrl } from "../../tsdown.config.ts";

function bodyOf(text: string): string {
  return text.slice(text.indexOf("\n") + 1);
}

describe("DshBaseModule → cordis.patch.yml", () => {
  it("渲染结果与入库 patch 一致", async () => {
    const generated = await render();
    const stored = await readFile(join(process.cwd(), "packages/bundles/dsh-base/cordis.patch.yml"), "utf8");
    expect(bodyOf(generated)).toBe(bodyOf(stored));
  });

  it("头注释按真源推导", async () => {
    const generated = await render();
    expect(generated.split("\n")[0]).toContain("packages/bundles/dsh-base/tsdown.config.ts");
    expect(sourceUrl).toContain("tsdown.config.ts");
  });
});
