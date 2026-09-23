// 行清单是 bundle patch 的真源：`dsh.profile.bundles` 列出本包时由它渲染到 host 平面。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contextChannel, PATCH_ROWS, scopeRow } from "../rows.ts";
import { renderPatch } from "../../tool/patch.ts";

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

  it("bundle patch 是这份清单渲染出来的", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/context/dsh-context-assembler/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(renderPatch());
    expect(
      renderPatch().startsWith(
        "# 本文件由 packages/context/dsh-context-assembler/tool/patch.ts 生成",
      ),
    ).toBe(true);
    // profile 平面装一次，服务全局：工具说明（toolkit 的 guidance 行）在别的包里 `inject` 它，
    // 隔离会把消费者挡在组外——行停在 waiting，不报错。
    // 形态是 insert：这些行由本包装到 host 平面；写成"改既有行"会打不到行，通道永远装上不了。
    expect(PATCH_ROWS).toEqual([
      {
        insert: [
          contextChannel({ capabilities: ["assembler", "agent-instructions", "skill-catalog"] }),
        ],
      },
    ]);
  });
});
