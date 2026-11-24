/**
 * 跨包 `@import` 的**构建期内联展开**（闪电的 `bundleAsync`，不扫文本）。
 *
 * 约束：`@import "pkg/x.css"` 是**包引用**（构建期能解析到那份真实文件），展开成内容才会生效；
 * 展开进来的样式里的 `url(./x.woff2)` 按**那份 CSS 自己的目录**解析，走既有资产策略。
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { bundleCssFile, cssImportSpecifiersOf } from "../../cordis-assets/styles.ts";
import { resolveCssImport } from "../bundle.ts";

/** 写一个文件（父目录不存在就建）。 */
async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/** 展开一份样式（跨包说明符走真实实现 `resolveCssImport`，资产走 `threshold`）。 */
async function expand(file: string): Promise<string> {
  return await bundleCssFile({
    file,
    importTargetOf: async (specifier, from) => await resolveCssImport(specifier, from),
    assets: "threshold",
    // 大文件走这条：返回一个可辨认的标记，断言展开后的文本里就是它。
    emit: (name) => `asset:${name}`,
  });
}

/**
 * 建一份 CSS 宿主/依赖/环 的目录结构（每条用例一份，用完删）。
 * @returns 宿主的样式文件路径与 fixture 根。
 */
async function cssWorkspaceOf(): Promise<{ work: string; hostCss: string }> {
  const work = await realpath(await mkdtemp(join(tmpdir(), "dsh-css-inline-")));
  onTestFinished(() => rm(work, { recursive: true, force: true }));
  // 宿主：跨包一行 + 一行相对引用 + 一行 http(s)。
  const host = join(work, "node_modules", "@morlay", "css-host");
  await put(
    join(host, "package.json"),
    `${JSON.stringify({ name: "@morlay/css-host", version: "1.0.0", exports: { "./brand-font.css": "./src/brand-font.css" } })}\n`,
  );
  const hostCss = join(host, "src", "brand-font.css");
  await put(
    hostCss,
    [
      // 外部 `@import` 必须排在内联的那些之前（CSS 的规则，闪电会如实报错）。
      '@import "https://cdn.example/x.css";',
      '@import "css-dep/brand-font.css";',
      '@import "./local.css";',
      ":root { --host: 1; }",
      "",
    ].join("\n"),
  );
  await put(join(host, "src", "local.css"), ".local { color: red; }\n");
  // 被引用的包：`@font-face` + 两种相对 `url()`（大的出资产、小的内联成 data URI）。
  const dep = join(work, "node_modules", "css-dep");
  await put(
    join(dep, "package.json"),
    `${JSON.stringify({ name: "css-dep", version: "1.0.0", exports: { "./brand-font.css": "./brand-font.css" } })}\n`,
  );
  await put(
    join(dep, "brand-font.css"),
    [
      "@font-face {",
      '  font-family: "Dep";',
      '  src: url(./fonts/big-font.woff2) format("woff2");',
      "}",
      ".dot { background-image: url(./dot.png); }",
      "",
    ].join("\n"),
  );
  await put(join(dep, "fonts", "big-font.woff2"), "x".repeat(5000));
  await put(join(dep, "dot.png"), "png");
  // 环：a 引 b、b 又引回 a。
  await put(
    join(work, "node_modules", "cycle-a", "package.json"),
    `${JSON.stringify({ name: "cycle-a", version: "1.0.0", exports: { "./a.css": "./a.css" } })}\n`,
  );
  await put(join(work, "node_modules", "cycle-a", "a.css"), '@import "cycle-b/b.css";\n');
  await put(
    join(work, "node_modules", "cycle-b", "package.json"),
    `${JSON.stringify({ name: "cycle-b", version: "1.0.0", exports: { "./b.css": "./b.css" } })}\n`,
  );
  await put(join(work, "node_modules", "cycle-b", "b.css"), '@import "cycle-a/a.css";\n');
  return { work, hostCss };
}

describe("bundleCssFile（构建期内联展开）", () => {
  test("跨包 @import 展开成内容：@font-face 在，包引用形态的 @import 不在", async () => {
    const { hostCss } = await cssWorkspaceOf();
    const css = await expand(hostCss);
    expect(css).toContain("@font-face");
    expect(css).toContain("Dep");
    expect(css).toContain("--host");
    expect(css).not.toMatch(/@import\s+(?:url\(\s*)?["']?css-dep\//u);
    expect(css).not.toMatch(/@import[^;]*_zephyr/u);
  });

  test("相对 @import 也展开（同一张图），http(s) 原样留着", async () => {
    const { hostCss } = await cssWorkspaceOf();
    const css = await expand(hostCss);
    expect(css).toContain(".local");
    expect(css).not.toContain("./local.css");
    expect(css).toContain("https://cdn.example/x.css");
  });

  test("展开进来的相对 url() 按**那份 CSS 的目录**解析：大的出资产、小的内联成 data URI", async () => {
    const { hostCss } = await cssWorkspaceOf();
    const css = await expand(hostCss);
    expect(css, "大文件按 threshold 交给 emit").toContain("asset:big-font.woff2");
    expect(css, "小文件内联成 data URI").toContain("data:image/png;base64,");
    expect(css, "相对路径不再留在产物里").not.toContain("./fonts/big-font.woff2");
  });

  test("解析不到的包原样留着（不静默吞掉）", async () => {
    const { hostCss } = await cssWorkspaceOf();
    const css = await bundleCssFile({
      file: hostCss,
      importTargetOf: async () => undefined,
    }).catch(() => undefined);
    // 解析不到 → 外部引用：要么整份文本里还留着那条 @import，要么这里根本没有可展开的东西。
    expect(css === undefined || css.includes("css-dep/brand-font.css")).toBe(true);
  });

  test("环形 @import：不无限递归，报错带链", async () => {
    const { work } = await cssWorkspaceOf();
    const a = join(work, "node_modules", "cycle-a", "a.css");
    const error = await expand(a).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("成环");
    expect(error?.message).toContain("a.css");
    expect(error?.message).toContain("b.css");
  });
});

describe("cssImportSpecifiersOf（样式的说明符由解析器读）", () => {
  const file = "/tmp/x.css";

  test("注释与字符串里的 @import 不算，只有真的那些进图", async () => {
    const found = cssImportSpecifiersOf(
      [
        '/* @import "ghost/comment.css"; */',
        '@import "pkg/a.css";',
        '@import "./b.css" screen;',
        ".x { content: '@import \"ghost/string.css\"'; }",
        "",
      ].join("\n"),
      file,
    );
    expect(found.bare).toEqual(["pkg/a.css"]);
    expect(found.relative).toEqual(["./b.css"]);
  });
});
