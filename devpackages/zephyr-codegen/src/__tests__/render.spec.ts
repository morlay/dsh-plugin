import { renderPatch } from "../patch.ts";
import { describe, expect, it } from "vitest";
describe("jsExpr 构建期序列化", () => {
  it("配置里的 __jsExpr 渲染成 YAML !!js 标量", async () => {
    const text = await renderPatch({
      from: import.meta.url,
      rows: () => [
        { id: "llm", config: { root: { __jsExpr: "dshHomePath('sessions')" } } },
      ],
    });

    expect(text).toContain("root: !!js dshHomePath('sessions')");
  });
});
