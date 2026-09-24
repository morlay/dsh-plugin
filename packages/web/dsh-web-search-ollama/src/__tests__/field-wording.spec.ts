/**
 * 字段文案面的行为：client 半把这一行的字段文案注册到**提示面**（`ctx.schemaFormHints.describe`），
 * 行式配置页据此画注释行；提示面缺席时（老组合）安静跳过，不影响会话面。
 */

import { describe, expect, it } from "vitest";
import { apply, inject } from "../client/index.ts";
import { zh } from "../client/locales.ts";

interface Described {
  ns: string;
  path: readonly string[];
  read: () => { label?: string | undefined; hint?: string | undefined };
}

/** 最小替身：记录提示面的注册事实。 */
function bench(options: { withHints?: boolean } = {}) {
  const described: Described[] = [];
  const dictionaries: string[] = [];
  const services: Record<string, unknown> = {};
  if (options.withHints !== false) {
    services["schemaFormHints"] = {
      describe: (
        ns: string,
        path: readonly string[],
        read: () => { label?: string; hint?: string },
      ) => {
        described.push({ ns, path, read });
        return () => {};
      },
    };
  }
  const ctx = {
    get: (name: string) => services[name],
    effect: (effect: () => unknown) => effect(),
    // 与 cordis 一致：inject 的服务缺席时不执行工厂；在时把服务挂在 scope 上。
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.some((name) => services[name] === undefined)) return;
      factory({ ...ctx, ...services });
    },
    locale: {
      bind: () => (key: keyof typeof zh) => zh[key],
      register: (ns: string) => {
        dictionaries.push(ns);
      },
    },
  };
  return { ctx, described, dictionaries };
}

describe("联网搜索 的字段文案", () => {
  it("只声明用到的服务", () => {
    expect(inject).toEqual(["locale"]);
  });

  it("注册字典与字段文案", () => {
    const b = bench();
    apply(b.ctx as never);

    expect(b.dictionaries).toEqual(["settings.web-search-ollama"]);
    expect(b.described.map((entry) => ({ ns: entry.ns, path: entry.path }))).toEqual([
      { ns: "web-search-ollama", path: ["apiKey"] },
      { ns: "web-search-ollama", path: ["apiKeyEnv"] },
      { ns: "web-search-ollama", path: ["baseURL"] },
      { ns: "web-search-ollama", path: ["maxResults"] },
    ]);
  });

  it("每个字段的文案来自本包字典", () => {
    const b = bench();
    apply(b.ctx as never);

    expect(b.described.map((entry) => entry.read())).toEqual([
      { label: zh.apiKey, hint: zh.apiKeyHint },
      { label: zh.apiKeyEnv, hint: zh.apiKeyEnvHint },
      { label: zh.baseURL, hint: zh.baseURLHint },
      { label: zh.maxResults, hint: zh.maxResultsHint },
    ]);
  });

  it("没有提示面时安静跳过（老组合）", () => {
    const b = bench({ withHints: false });

    expect(() => {
      apply(b.ctx as never);
    }).not.toThrow();
    expect(b.described).toEqual([]);
  });
});
