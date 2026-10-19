import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../../tsdown.config.ts";

function bodyOf(text: string): string {
  return text.slice(text.indexOf("\n") + 1);
}

describe("DshWebAppPatchModule → cordis.patch.yml", () => {
  it("渲染结果与入库 patch 一致", async () => {
    const generated = await render();
    const stored = await readFile(
      join(process.cwd(), "packages/bundles/dsh-web-app/cordis.patch.yml"),
      "utf8",
    );
    expect(bodyOf(generated)).toBe(bodyOf(stored));
  });
});
