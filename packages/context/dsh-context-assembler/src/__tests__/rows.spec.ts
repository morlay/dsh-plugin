// 行清单是"两种采用方式同一份真源"的接缝：bundle patch 由它渲染，preset 引用它。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  channelGroup,
  CONTEXT_CHANNEL_GROUP_ID,
  contextChannel,
  PATCH_ROWS,
  scopeRow,
} from "../rows.ts";
import { renderPatch } from "../../tool/patch.ts";

describe("context 行清单", () => {
  it("组形状：一个 isolate 组，组内只有组装行、不带 config（完整一套）", () => {
    const group = channelGroup([contextChannel()]);

    expect(group.id).toBe(CONTEXT_CHANNEL_GROUP_ID);
    expect(group.name).toBe("cordis:group");
    expect(group.group).toBe(true);
    // 通道服务由 isolate 隔离：组内 ctx 才解析得到它，组外（别的 preset / 根 realm）拿不到。
    expect(group.isolate).toEqual({ contextAssembler: true });
    expect(group.config).toEqual([{ id: "context-assembler", name: "@morlay/dsh-context-assembler" }]);
  });

  it("config 原样透传（chat 用它裁剪能力清单与参数）", () => {
    const config = { capabilities: ["assembler", "scope"], options: { scope: { instructions: false } } };
    const row = contextChannel(config);

    expect(row.config).toEqual(config);
    expect(row.name).toBe("@morlay/dsh-context-assembler");
  });

  it("开关行：id 与 scope 出口对齐，config 原样透传", () => {
    const row = scopeRow({ allowTools: ["read"], instructions: false });

    expect(row.id).toBe("context-scope");
    expect(row.name).toBe("@morlay/dsh-context-assembler/scope");
    expect(row.config).toEqual({ allowTools: ["read"], instructions: false });
  });

  it("bundle patch 是这份清单渲染出来的", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/context/dsh-context-assembler/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(renderPatch());
    expect(renderPatch().startsWith("# 本文件由 packages/context/dsh-context-assembler/tool/patch.ts 生成"))
      .toBe(true);
    // profile 平面装一次：通道 + 两个注入方；`scope` 是模式的开关，由 preset 装 `scopeRow()`。
    expect(PATCH_ROWS).toEqual([
      channelGroup([
        contextChannel({ capabilities: ["assembler", "agent-instructions", "skill-catalog"] }),
      ]),
    ]);
  });
});
