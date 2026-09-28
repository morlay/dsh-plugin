// 行清单是 bundle patch 的真源：`dsh.profile.bundles` 列出本包时由它渲染到 host 平面。
import { describe, expect, it } from "vitest";
import { contextChannel, scopeRow } from "../rows.ts";

describe("context 行清单", () => {
  it("通道行：一行组装出口，不带 config（缺省即完整一套）", () => {
    expect(contextChannel()).toEqual({
      id: "context-assembler",
      name: "@morlay/dsh-context-assembler",
    });
  });

  it("config 原样透传（chat 用它裁剪能力清单与参数）", () => {
    const config = {
      capabilities: ["assembler", "scope"],
      options: { scope: { instructions: false } },
    };
    const row = contextChannel(config);

    expect(row.config).toEqual(config);
    expect(row.name).toBe("@morlay/dsh-context-assembler");
  });

  it("模式收口行：id 用全名，且不带 config（模式是 session-mode 的事实）", () => {
    const row = scopeRow();

    expect(row.id).toBe("context-assembler-scope");
    expect(row.name).toBe("@morlay/dsh-context-assembler/scope");
    expect(row).not.toHaveProperty("config");
  });
});
