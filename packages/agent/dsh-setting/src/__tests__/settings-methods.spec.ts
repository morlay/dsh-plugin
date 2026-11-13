/**
 * `SETTINGS_METHODS` 与**上游 descriptor** 的一致性（防复发）。
 *
 * 这条常量曾经抄错：它写成了 `describe / set / unset`——那三个里 `set` / `unset` 属于
 * **`credentials` 组**（同一个生成文件里两组都带 `describe`，读错了 namespace 就会串）。
 * 判据因此不写死字符串，而是**从 descriptor 里解析**：过滤 `namespace === "settings"` 的
 * descriptor，取它们的 `method`，再与本常量逐项对齐。
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_METHODS } from "../endpoint/settings.group.ts";
import { SETTINGS_REMOTE } from "../endpoint/index.ts";

/** descriptor 里本 spec 只读的两个字段（宽化成 string，避免与上游的字面量联合打架）。 */
interface DescriptorFields {
  readonly namespace?: string;
  readonly method?: string;
}

/** 从上游 descriptor 解析出 `settings` 组的方法名（排序后便于比较）。 */
function settingsMethodsOf(contribution: {
  readonly descriptors: readonly DescriptorFields[];
}): string[] {
  return contribution.descriptors
    .filter((d) => d.namespace === "settings")
    .map((d) => d.method)
    .filter((m): m is string => typeof m === "string")
    .sort();
}

describe("settings 组的方法名", () => {
  it("`SETTINGS_METHODS` 的键集合等于上游 descriptor 的 `settings` 方法集", () => {
    const upstream = settingsMethodsOf(SETTINGS_REMOTE);
    // 先钉住"解析确实拿到了这 5 个"（解析失手会得到空数组，那样下面的对齐会假绿）。
    expect(upstream).toEqual([
      "describe",
      "mutate",
      "openSettingsDocument",
      "replace",
      "update",
    ]);
    expect(Object.keys(SETTINGS_METHODS).sort()).toEqual(upstream);
  });

  it("映射是恒等的（键 = wire 上的方法名）", () => {
    for (const [key, value] of Object.entries(SETTINGS_METHODS)) {
      expect(value).toBe(key);
    }
  });

  it("不含 `set` / `unset`：它们是 `credentials` 组的方法", () => {
    const keys = Object.keys(SETTINGS_METHODS);
    expect(keys).not.toContain("set");
    expect(keys).not.toContain("unset");
    // 反向核对：这两个名字确实在 descriptor 的**别的** namespace 里。
    const otherNamespaces: readonly (string | undefined)[] = SETTINGS_REMOTE.descriptors
      .filter((d) => d.namespace !== "settings")
      .map((d) => d.method);
    expect(otherNamespaces).toContain("set");
    expect(otherNamespaces).toContain("unset");
  });
});
