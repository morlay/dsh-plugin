import { describe, expect, it } from "vitest";
import { mergeMissingEnv, parseEnvDump } from "../shell-env.ts";

describe("登录 shell 环境（全量继承）", () => {
  it("解析 env -0（NUL 分隔，值里可以有空格）", () => {
    expect(parseEnvDump("PATH=/usr/bin:/bin\0GREETING=hello world\0EMPTY=\0")).toEqual({
      PATH: "/usr/bin:/bin",
      GREETING: "hello world",
      EMPTY: "",
    });
  });

  it("凭证也照样继承（桌面应用是用户环境的延伸），但只补缺失的键", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/custom", HOME: "" };
    mergeMissingEnv(target, { PATH: "/usr/bin", HOME: "/Users/me", DEEPSEEK_API_KEY: "sk-xxx" });
    expect(target).toEqual({ PATH: "/custom", HOME: "/Users/me", DEEPSEEK_API_KEY: "sk-xxx" });
  });
});
