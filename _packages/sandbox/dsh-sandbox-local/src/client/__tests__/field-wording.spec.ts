// 字段文案面的行为：client 半把这一行的字段文案注册到**提示面**（`ctx.schemaFormHints.describe`），
// 行式配置页据此画注释行；提示面缺席时（老组合）安静跳过，不影响会话面。

import { Context, type Fiber } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import entry from "../index.ts";
import { zh } from "../locales.ts";

interface Described {
  ns: string;
  path: readonly string[];
  read: () => { label?: string | undefined; hint?: string | undefined };
}

const fibers: Fiber[] = [];

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose();
});

// 用真实 Context + 最小服务替身：插件走 client 同一条 attachProvider 路径。
async function bench(options: { withHints?: boolean } = {}) {
  const described: Described[] = [];
  const dictionaries: string[] = [];
  const ctx = new Context();
  ctx.reflect.provide("locale", {
    bind: () => (key: keyof typeof zh) => zh[key],
    register: (ns: string) => {
      dictionaries.push(ns);
    },
  });
  if (options.withHints !== false) {
    ctx.reflect.provide("schemaFormHints", {
      describe: (
        ns: string,
        path: readonly string[],
        read: () => { label?: string; hint?: string },
      ) => {
        described.push({ ns, path, read });
        return () => {};
      },
    });
  }
  const fiber = ctx.plugin(entry);
  fibers.push(fiber);
  await fiber;
  return { ctx, described, dictionaries };
}

describe("沙箱 的字段文案", () => {
  it("注册字典与字段文案", async () => {
    const b = await bench();

    expect(b.dictionaries).toEqual(["settings.sandbox-local"]);
    expect(b.described.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "sandbox-local", path: ["access"] },
    ]);
  });

  it("每个字段的文案来自本包字典", async () => {
    const b = await bench();

    expect(b.described.map((entry) => entry.read())).toEqual([
      { label: zh.access, hint: zh.accessHint },
    ]);
  });

  it("没有提示面时安静跳过（老组合）", async () => {
    const b = await bench({ withHints: false });
    expect(b.described).toEqual([]);
  });
});
