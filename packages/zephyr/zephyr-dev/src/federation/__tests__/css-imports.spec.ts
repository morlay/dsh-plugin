import { describe, expect, it } from "vitest";
import { productFileNameOf, rewriteCssImports } from "@morlay/zephyr-dev/testing";

describe("rewriteCssImports", () => {
  it("把裸 @import 改写成联邦地址", () => {
    const out = rewriteCssImports(
      '@import "@deepseek-ai/dsh-client-ui-theme/brand-font.css";',
      new Map([["@deepseek-ai/dsh-client-ui-theme", "0.2.2-rc.2"]]),
    );
    // 地址末段 = 产物文件名（决定 4）：CSS 产物是 `<出口名>.css.js`，不带 `.js` 就是一条 404。
    expect(out).toContain(
      "/_zephyr/@modules/@deepseek-ai+dsh-client-ui-theme@0.2.2-rc.2/brand-font.css.js",
    );
    const address = /@import\s+"([^"]+)"/u.exec(out)?.[1] ?? "";
    expect(address.split("/").pop(), "末段与 productFileNameOf 逐字相等").toBe(
      productFileNameOf("brand-font.css"),
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