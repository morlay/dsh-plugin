import { describe, expect, it } from "vitest";
import { CliError } from "../errors.ts";
import { flagOf, helpOf, parseParams, usageOf, type ParamSpecs } from "../params.ts";

const specs: ParamSpecs = {
  workspace: { kind: "position", description: "工作区" },
  dataDir: {
    kind: "enum",
    values: ["workspace", "xdg"],
    allowPath: true,
    description: "数据目录",
  },
  port: { kind: "number", description: "端口" },
  prod: { kind: "boolean", description: "先装配打包形态" },
  logLevel: { kind: "enum", values: ["debug", "info"], default: "info", description: "日志阈值" },
};

describe("参数声明即 flags", () => {
  it("把键写成 kebab-case 的 flag", () => {
    expect(flagOf("dataDir")).toBe("data-dir");
    expect(flagOf("workspace")).toBe("workspace");
  });

  it("解析 --name 值、--name=值 与位置参数", () => {
    const parsed = parseParams(specs, ["--port", "3000", "--data-dir=xdg", "/work"]);
    expect(parsed.values.port).toBe(3000);
    expect(parsed.values.dataDir).toBe("xdg");
    expect(parsed.values.workspace).toBe("/work");
  });

  it("布尔给 --no- 的反向", () => {
    expect(parseParams(specs, ["--prod"]).values.prod).toBe(true);
    expect(parseParams(specs, ["--no-prod"]).values.prod).toBe(false);
  });

  it("枚举额外接受绝对路径，越界算用法错误", () => {
    expect(parseParams(specs, ["--data-dir", "/tmp/store"]).values.dataDir).toBe("/tmp/store");
    const failure = (): unknown => parseParams(specs, ["--data-dir", "elsewhere"]);
    expect(failure).toThrowError(CliError);
    expect(failure).toThrowError(/只接受/u);
  });

  it("未知 flag 与缺值都是用法错误（退出码 2）", () => {
    const unknown = (): void => {
      parseParams(specs, ["--nope"]);
    };
    expect(unknown).toThrowError(CliError);
    try {
      unknown();
    } catch (error) {
      expect((error as CliError).code).toBe(2);
    }
    expect(() => parseParams(specs, ["--port"])).toThrowError(/缺一个值/u);
  });

  it("--help 只置标记，不当作位置参数", () => {
    expect(parseParams(specs, ["--help"]).help).toBe(true);
  });
});

describe("help 由声明生成", () => {
  it("列出选项、反向写法、默认值与位置参数", () => {
    const text = helpOf({ path: ["dev"], description: "起开发形态", params: specs });
    expect(text).toContain("用法: zephyr dev [options] [workspace]");
    expect(text).toContain("--data-dir <workspace|xdg|绝对路径>");
    expect(text).toContain("--prod / --no-prod");
    expect(text).toContain("（默认: info）");
    expect(text).toContain("工作区");
  });

  it("usage 只给出有位置的段", () => {
    expect(usageOf(["desktop", "bundle"], {})).toBe("zephyr desktop bundle");
    expect(usageOf(["dev"], { workspace: { kind: "position", description: "" } })).toBe(
      "zephyr dev [workspace]",
    );
  });
});
