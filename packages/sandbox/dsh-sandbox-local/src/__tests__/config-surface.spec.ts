/**
 * 这一行在设置页上的字段面：**六个字段都上页面**——`access` 可改（改完规则当场重算），其余五个是装配事实
 * （runner 命令、进程 cwd、上游基类读一次的超时与差额上限），页面上只读可见。
 *
 * 盯的接缝是 schema 的 meta 事实：`volatile`（host 的 `volatileForm` 据此投影）与 `disabled`（页面据此只读）。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { Config, upstreamConfigOf } from "../config.ts";

/** 装配事实：页面上只读可见的那五个。 */
const FACTS = [
  "runnerCommand",
  "runnerFailureSignatures",
  "probeTimeoutMs",
  "cwd",
  "diffBasisMaxBytes",
] as const;

interface Node {
  meta?: { volatile?: boolean; disabled?: boolean };
}

/** 一段 schema 的字段表（`toJSON` 是引用表形式，重建之后才好读）。 */
function dictOf(schema: z): Record<string, Node> {
  const rehydrated = new z(schema.toJSON()) as unknown as { dict?: Record<string, Node> };
  return rehydrated.dict ?? {};
}

/** host 投影后的表单 schema：只留带 volatile 的字段。 */
function form(): Record<string, Node> {
  return dictOf(volatileForm(Config as never) as z);
}

describe("设置页上的字段面", () => {
  it("六个字段都在表单里（装配事实不会因为只读而消失）", () => {
    expect(Object.keys(form())).toEqual(["access", ...FACTS]);
  });

  it("六个字段都是 volatile（host 据此投影到设置页）", () => {
    const dict = dictOf(Config);
    for (const key of Object.keys(dict)) expect(dict[key]?.meta?.volatile, key).toBe(true);
  });

  it("access 可改，其余五个只读", () => {
    const dict = form();
    expect(dict["access"]?.meta?.disabled).toBeUndefined();
    for (const key of FACTS) expect(dict[key]?.meta?.disabled, key).toBe(true);
  });

  it("给上游基类的是解包后的值，不是引用", () => {
    const resolved = Config({ access: ["rw:/tmp"] }) as unknown as Parameters<
      typeof upstreamConfigOf
    >[0];

    expect(upstreamConfigOf(resolved)).toMatchObject({
      runnerCommand: [],
      runnerFailureSignatures: [],
      probeTimeoutMs: 5_000,
      diffBasisMaxBytes: 10 * 1024 * 1024,
    });
    expect(typeof upstreamConfigOf(resolved).cwd).toBe("string");
  });
});
