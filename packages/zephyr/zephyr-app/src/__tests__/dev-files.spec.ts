import { describe, expect, it } from "vitest";
import { globToRegExp, isDevFile } from "@morlay/zephyr-app/testing";

describe("当文件名单", () => {
  it("glob 只支持 *，但要能匹配 scope 包", () => {
    const patterns = ["@morlay/*", "react"].map(globToRegExp);
    expect(isDevFile("@morlay/dsh-session", patterns)).toBe(true);
    expect(isDevFile("react", patterns)).toBe(true);
    expect(isDevFile("react-dom", patterns)).toBe(false);
  });

  it("不在名单里的一律 prebundle（上游也默认不在）", () => {
    const patterns = ["@morlay/*"].map(globToRegExp);
    expect(isDevFile("@deepseek-ai/dsh-llm", patterns)).toBe(false);
  });

  it("空名单表示全部 prebundle", () => {
    expect(isDevFile("@morlay/dsh-session", [])).toBe(false);
  });
});
