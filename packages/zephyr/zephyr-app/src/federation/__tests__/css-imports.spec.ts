import { describe, expect, it } from "vitest";
import { rewriteCssImports } from "../bundle.ts";

describe("rewriteCssImports", () => {
  it("把裸 @import 改写成联邦地址", () => {
    const out = rewriteCssImports(
      '@import "@deepseek-ai/dsh-client-ui-theme/brand-font.css";',
      new Map([["@deepseek-ai/dsh-client-ui-theme", "0.2.2-rc.2"]]),
    );
    expect(out).toContain(
      "/_zephyr/@modules/@deepseek-ai+dsh-client-ui-theme@0.2.2-rc.2/brand-font.css",
    );
    expect(out).not.toMatch(/@import\s+["']@deepseek-ai\//u);
  });

  it("相对路径与 http(s) 原样", () => {
    const css = '@import "./x.css";\n@import "https://a/b.css";';
    expect(rewriteCssImports(css, new Map())).toBe(css);
  });

  it("解析不到的包原样", () => {
    const css = '@import "unknown-pkg/x.css";';
    expect(rewriteCssImports(css, new Map())).toBe(css);
  });
});
