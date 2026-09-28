import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { standardDecoratorsPlugin } from "../standard-decorators.ts";

// 上游 typert 的远程面写法：标准（TC39）装饰器挂在方法上。
const DECORATED_SOURCE = `class Service {
  @Remote("prompt") async prompt(request) {
    return request;
  }
}
`;

const PLAIN_SOURCE = `class Service {
  async prompt(request) {
    return request;
  }
}
`;

const DECORATED_TSX_SOURCE = `class View {
  @Remote("render") async render() {
    return <span>ok</span>;
  }
}
`;

/** 插件契约：命中时返回降级后的代码，其余情形原样放过（`undefined`）。 */
async function transform(
  plugin: ReturnType<typeof standardDecoratorsPlugin>,
  code: string,
  id: string,
): Promise<{ code: string; map: unknown } | undefined> {
  const hook = plugin.transform;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (handler === undefined) return;
  // rolldown 给钩子声明了 `this: TransformPluginContext`；预转换不看 this，测试这里当普通函数调。
  const run = handler as unknown as (
    code: string,
    id: string,
    meta?: unknown,
  ) => Promise<{ code: string; map: unknown } | undefined>;
  return await run(code, id);
}

describe("standardDecoratorsPlugin", () => {
  it("把标准装饰器降级到 Node 能解析的形态", async () => {
    // 前置：原始源码在 Node 里是语法错——这条保证下面的断言有辨别力。
    expect(() => new Script(DECORATED_SOURCE)).toThrow(SyntaxError);

    const result = await transform(standardDecoratorsPlugin(), DECORATED_SOURCE, "/w/src/a.ts");

    expect(result).toBeDefined();
    expect(result?.code).not.toMatch(/^\s*@[A-Za-z_$][\w$]*/m);
    expect(() => new Script(result?.code ?? "")).not.toThrow();
  });

  it("范围之外的文件原样放过", async () => {
    const plugin = standardDecoratorsPlugin({ scope: /\/packages\/subagent\// });

    await expect(transform(plugin, DECORATED_SOURCE, "/w/src/a.ts")).resolves.toBeUndefined();
    await expect(
      transform(plugin, DECORATED_SOURCE, "/w/packages/subagent/x/src/a.ts"),
    ).resolves.not.toBeUndefined();
  });

  it("没有装饰器的源码与不是 TS 的文件都不动", async () => {
    const plugin = standardDecoratorsPlugin();

    await expect(transform(plugin, PLAIN_SOURCE, "/w/src/a.ts")).resolves.toBeUndefined();
    await expect(transform(plugin, DECORATED_SOURCE, "/w/src/a.js")).resolves.toBeUndefined();
  });

  it("按后缀选 tsx loader（同一份源码里 JSX 与装饰器共存）", async () => {
    const result = await transform(
      standardDecoratorsPlugin(),
      DECORATED_TSX_SOURCE,
      "/w/src/a.tsx",
    );

    expect(result).toBeDefined();
    expect(result?.code).not.toMatch(/^\s*@[A-Za-z_$][\w$]*/m);
  });

  it("sourcemap 选项决定是否带出映射", async () => {
    const plain = await transform(standardDecoratorsPlugin(), DECORATED_SOURCE, "/w/src/a.ts");
    const mapped = await transform(
      standardDecoratorsPlugin({ sourcemap: true }),
      DECORATED_SOURCE,
      "/w/src/a.ts",
    );

    expect(plain?.map).toBeNull();
    expect(mapped?.map).not.toBeNull();
  });

  it("enforce 只在被要求时写进插件", () => {
    expect(standardDecoratorsPlugin().enforce).toBeUndefined();
    expect(standardDecoratorsPlugin({ enforce: "pre" }).enforce).toBe("pre");
  });
});
