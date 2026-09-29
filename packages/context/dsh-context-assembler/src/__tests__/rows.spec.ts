// 本包那一行的形状断言：装配它的 bundle（本部署是 `@morlay/session-mode-profile`）import 它拼装，
// 构建期由 devkit 的 `bundlePatch` 写出包根那份 `cordis.patch.yml`。
import { describe, expect, it } from "vitest";
import { contextChannel } from "../rows.ts";

describe("通道行", () => {
  it("包根即通道本体，行不带 config（缺省就是本部署要的那一份转换）", () => {
    const row = contextChannel();

    expect(row).toEqual({ id: "context-assembler", name: "@morlay/dsh-context-assembler" });
    expect(row).not.toHaveProperty("config");
  });
});
