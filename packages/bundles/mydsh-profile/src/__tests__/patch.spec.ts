import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROWS, render } from "../../tsdown.config.ts";

// 按行 id 取本包声明的那一行的 `config`（行必须存在：没声明就是写错 id 了）。
function rowConfigOf(rowId: string): Record<string, unknown> {
  const row = ROWS.find((entry) => (entry as { readonly id?: string }).id === rowId) as
    | { readonly config?: Record<string, unknown> }
    | undefined;
  if (row?.config === undefined) throw new Error(`本包没有声明 ${rowId}`);
  return row.config;
}

// 入库那份与真源渲染出来的同形：bundle patch 是生成物，真源是本包 `tsdown.config.ts` 的 `patch`
// （`@local/devkit/patch` 的 `renderPatch` 渲染出这里的比对对象，`bundlePatch` 在 build 时把它写回包根）。
describe("mydsh-profile 的 bundle patch", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/bundles/mydsh-profile/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(await render());
    expect(
      (await render()).startsWith(
        "# 本文件由 packages/bundles/mydsh-profile/tsdown.config.ts 生成",
      ),
    ).toBe(true);
  });

  // 行清单（四份 agent preset）归上游 web-app bundle；本包只给部署默认值。
  it("部署默认 preset 是 ptc", () => {
    expect(rowConfigOf("agent-preset-registry")).toEqual({ default: "ptc" });
  });

  it("不声明 preset 行（行清单归上游，复制会随上游漂移）", () => {
    expect(ROWS.filter((entry) => (entry as { readonly id?: string }).id?.startsWith("preset-"))).toEqual(
      [],
    );
  });
});
