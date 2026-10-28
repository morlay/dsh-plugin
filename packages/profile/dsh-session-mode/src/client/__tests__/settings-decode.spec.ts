// 客户端拿到的 settings 快照是**深冻结**的（`@deepseek-ai/dsh-client-store` 在非 production 下用
// `devFreeze` 冻结每次 `set` 的值），而 settings 页面的解码路径就是"用 schema 校验这个值"
// （`ConfigFormController.decode` → `settingsSchema.validate`）。schemastery 解析会把结果**写回调用方的
// 输入对象**，两处：`dict` 的键名规范化（`data[rKey] = data[key]`，键名没变也写）与 `property` 的适配缓存
// （`data[key] = adapted`，凡 `z.transform(...)` 字段都会触发）。冻结值上这两写直接抛
// `Cannot assign to read only property '<键>'`（`'coding'` / `'tools'` 都见过）；`ConfigForm` 因此把解码判成
// 失败、状态停在 loading，页面上只剩一句"这一行当前不可写"。
//
// 上游那两处写回由 `vendor/patches/schemastery-frozen-input.patch` 修掉（输入只读就不写回）。本用例是那条
// 补丁的判据：真的 `Config`（含 `modes` 这个 dict）+ 真的 `volatileForm` 产物 + 深冻结的值，校验必须不抛；
// 另加一条 `z.transform(...)` 字段，钉住 `property` 那一处。

import Schema from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { plainConfig, volatileForm } from "@deepseek-ai/dsh-settings/src/schema.ts";
import { Config } from "../../index.ts";
import { sessionModeRows } from "../../rows.ts";

// 与 `dsh-client-store` 的 `devFreeze` 等价：逐层冻结普通对象与数组。
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("settings 解码：冻结的 describe 值", () => {
  it("真的 Config 折成的 describe 值能过客户端 schema 校验（dict 不写回输入）", () => {
    const config = sessionModeRows()[0]?.insert?.[0]?.config;
    const form = volatileForm(Config);
    expect(form).toBeDefined();
    // describe 的 value 就是 volatile 值解开之后的那份（`plainConfig`）。
    const value = deepFreeze(JSON.parse(JSON.stringify(plainConfig(Config(config as never)))));
    const schema = new Schema(form!.toJSON() as never);
    expect(() => (schema as unknown as (input: unknown) => unknown)(value)).not.toThrow();
  });

  it("带 `z.transform(...)` 字段的冻结值也不抛（property 不写回适配结果）", () => {
    const schema = Schema.object({
      tools: Schema.transform(Schema.array(Schema.string()), (value: unknown) => value),
    } as never);
    const value = deepFreeze({ tools: ["read"] });
    expect(() => (schema as unknown as (input: unknown) => unknown)(value)).not.toThrow();
  });
});
