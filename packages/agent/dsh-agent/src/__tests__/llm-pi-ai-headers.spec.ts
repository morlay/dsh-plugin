// provider 头里的环境引用（`Bearer ${OLLAMA_API_KEY}`）在挂载前解析成真值。
//
// 判据只有两类：取得到就替换（真值只进运行期 config），取不到就把这个头摘掉
// （绝不把引用字符串发成请求头）；其余字段与输入对象一概不动。
import { describe, expect, it } from "vitest";
import { resolveHeaderReferences } from "../llm-pi-ai-headers.ts";

/** 只回答一个变量的启动环境快照替身。 */
function lookupOf(entries: Record<string, string>) {
  return {
    get: (name: string) => (name in entries ? { value: entries[name] as string } : undefined),
  };
}

/** 一份带环境引用的 pi-ai config。 */
function configOf(headers: unknown): unknown {
  return {
    providers: {
      ollama: {
        apiKeyEnv: "OLLAMA_API_KEY",
        baseURL: "https://ollama.com",
        headers,
      },
    },
  };
}

describe("provider 头里的环境引用", () => {
  it("取得到就替换；输入对象不被修改", () => {
    const config = configOf({ Authorization: "Bearer ${OLLAMA_API_KEY}" });
    const resolved = resolveHeaderReferences(config, lookupOf({ OLLAMA_API_KEY: "sk-test" }));

    expect(resolved).toEqual({
      providers: {
        ollama: {
          apiKeyEnv: "OLLAMA_API_KEY",
          baseURL: "https://ollama.com",
          headers: { Authorization: "Bearer sk-test" },
        },
      },
    });
    // 装配层的 base 读的是这份 config：它必须仍是引用字符串，密钥不能进它。
    expect(
      (config as { providers: { ollama: { headers: { Authorization: string } } } }).providers.ollama
        .headers.Authorization,
    ).toBe("Bearer ${OLLAMA_API_KEY}");
  });

  it("取不到（或空值）就把这个头摘掉，不发明细量", () => {
    for (const lookup of [lookupOf({}), lookupOf({ OLLAMA_API_KEY: "" }), undefined]) {
      const resolved = resolveHeaderReferences(
        configOf({ Authorization: "Bearer ${OLLAMA_API_KEY}" }),
        lookup,
      ) as { providers: { ollama: Record<string, unknown> } };
      expect(resolved.providers.ollama["headers"]).toBeUndefined();
    }
  });

  it("没有引用的头原样保留；非 headers 字段里的 ${…} 不动", () => {
    const config = {
      providers: {
        ollama: {
          displayName: "${NOT_A_REFERENCE}",
          headers: { "X-Tenant": "acme" },
        },
      },
    };
    expect(resolveHeaderReferences(config, lookupOf({}))).toEqual(config);
  });

  it("形状不认识时原样返回", () => {
    expect(resolveHeaderReferences(undefined, undefined)).toBeUndefined();
    expect(resolveHeaderReferences({ providers: [] }, undefined)).toEqual({ providers: [] });
  });
});
