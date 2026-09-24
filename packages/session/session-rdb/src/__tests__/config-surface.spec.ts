/**
 * 这一行配置在页面上的门面：整段 Config 标了 volatile（host 的 `volatileForm` 才会投影它），解析后是稳定引用
 * （装配时取一次快照；生效靠 Loader 重挂这一行）。
 *
 * 盯的接缝是**schema 与设置面之间的约定**：能被描述出来、能当页面根、且值解析成 `.get()` 引用。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { SessionPersistenceRdb } from "../index.ts";

const Config = SessionPersistenceRdb.Config as never as z;

describe("配置门面", () => {
  it("整段是 volatile：host 的 volatileForm 会投影它（页面据此出现）", () => {
    expect(volatileForm(Config)).toBeDefined();
  });

  it("每个分支都带唯一的常量字段 `type`：这就是页面选变体的判别标签", () => {
    const members = Config.list ?? [];

    expect(members.map((member) => member.type)).toEqual(["object", "object"]);
    for (const member of members) {
      const consts = Object.entries(member.dict ?? {})
        .filter(([, child]) => child.type === "const")
        .map(([key]) => key);
      expect(consts).toEqual(["type"]);
    }
  });

  it("解析后是稳定引用：读它要过 `.get()`（装配时取快照）", () => {
    const parsed = (Config as unknown as (input: unknown) => unknown)({
      type: "sqlite",
      path: ":memory:",
    });

    expect(typeof (parsed as { get?: unknown }).get).toBe("function");
    expect((parsed as { get: () => unknown }).get()).toMatchObject({
      type: "sqlite",
      path: ":memory:",
    });
  });
});
