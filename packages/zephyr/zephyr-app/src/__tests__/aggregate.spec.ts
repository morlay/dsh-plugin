import { describe, expect, it } from "vitest";
import { globToRegExp, isAggregated } from "@morlay/zephyr-app/testing";

describe("聚合名单", () => {
  it("glob 只支持 *，但要能匹配 scope 包", () => {
    const patterns = ["@deepseek-ai/*", "react"].map(globToRegExp);
    expect(isAggregated("@deepseek-ai/dsh-llm", patterns)).toBe(true);
    expect(isAggregated("react", patterns)).toBe(true);
    expect(isAggregated("react-dom", patterns)).toBe(false);
  });

  it("空名单表示全部走逐文件 vite", () => {
    expect(isAggregated("react", [])).toBe(false);
  });
});
