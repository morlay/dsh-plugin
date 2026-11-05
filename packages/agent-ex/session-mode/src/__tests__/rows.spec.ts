// 通道那一行在装配清单里的形状：装到的必须是**通道本体**，且它不吃 config（缺省就是本部署要的那一份转换）。
//
// 源包用 `contextChannel()` 描述「行」（由 devkit 的 `bundlePatch` 写成 `cordis.patch.yml`）；本仓没有行文件这层，
// 装配面就是 `provideContextAssembler()` 的 provider 清单——同一条判据落在清单上：通道本体在清单里，
// `Config()` 的缺省不带任何 override。
import { DEFAULT_KEEP, DEFAULT_REPLACE, DEFAULT_SUPPRESS } from "@morlay/session-mode";
import { provideContextAssembler } from "@morlay/session-mode";
import { describe, expect, it } from "vitest";
import { ContextChannel } from "../context-assembler.provide.ts";

describe("通道行", () => {
  it("装的是通道本体，行不带 config（缺省就是本部署要的那一份转换）", () => {
    const rows = provideContextAssembler();

    // 清单里就有通道本体：装配不会退化成「只装了服务、没挂两个接缝」。
    expect(rows).toContain(ContextChannel);
    // 不带 config：`Config()` 的缺省等于本部署要的那一份转换（三份清单都没有 override）。
    expect(ContextChannel.Config?.({})).toEqual({
      keep: [...DEFAULT_KEEP],
      suppress: [...DEFAULT_SUPPRESS],
      replace: { ...DEFAULT_REPLACE },
    });
  });
});
