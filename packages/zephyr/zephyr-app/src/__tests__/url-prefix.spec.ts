/**
 * vite URL 空间的前缀收敛：对外一律 `/_zephyr/@…`，入站 strip 回去、出站补上。
 *
 * 这条用例的存在理由：页面上曾同时出现 `/_zephyr/@modules/…` 与 `/@fs/…`、`/@vite/client`，
 * 而 vite 的 `base` 不能改成 `/_zephyr/`（会给绝对 URL 再补一层，联邦链全断）——只能宿主层重写。
 */
import { describe, expect, it } from "vitest";
import { addZephyrPrefix, rewriteUrls, stripZephyrPrefix, FEDERATION_PREFIX, HMR_PATH } from "@morlay/zephyr-app/testing";

describe("vite URL 空间的前缀收敛", () => {
  it("入站：`/_zephyr/@fs/…` strip 回 vite 的 `/@fs/…`", () => {
    expect(stripZephyrPrefix("/_zephyr/@fs/tmp/a.ts")).toBe("/@fs/tmp/a.ts");
    expect(stripZephyrPrefix("/_zephyr/@vite/client")).toBe("/@vite/client");
    expect(stripZephyrPrefix("/_zephyr/@id/__x00__rows")).toBe("/@id/__x00__rows");
  });

  it("入站：其它路径原样保留（联邦、HMR、页面）", () => {
    for (const url of [FEDERATION_PREFIX, HMR_PATH, "/", "/index.html", "/api/remote.mux"]) {
      expect(stripZephyrPrefix(url)).toBe(url);
    }
  });

  it("出站：正文里的 `\"/@…` 补上 `/_zephyr` 前缀", () => {
    expect(addZephyrPrefix('import c from "/@vite/client";')).toBe(
      'import c from "/_zephyr/@vite/client";',
    );
    expect(addZephyrPrefix('<script src="/@id/__x00__rows"></script>')).toBe(
      '<script src="/_zephyr/@id/__x00__rows"></script>',
    );
  });

  it("出站：已经是 `/_zephyr/…` 的不再重复加前缀", () => {
    const already = `"/_zephyr/@modules/react@18/index.js"`;
    expect(addZephyrPrefix(already)).toBe(already);
  });
});

describe("响应 body 的重写（模块分片）", () => {
  it("字符串分片：`\"/@fs` 被补前缀", () => {
    expect(rewriteUrls('export default "/@fs/tmp/a.ts"')).toBe(
      'export default "/_zephyr/@fs/tmp/a.ts"',
    );
  });

  it("Buffer 分片：含 vite 地址时改写", () => {
    const chunk = Buffer.from('import x from "/@id/__x00__rows"', "utf8");
    expect(rewriteUrls(chunk).toString("utf8")).toBe(
      'import x from "/_zephyr/@id/__x00__rows"',
    );
  });

  it("Buffer 分片：不含 vite 地址时原样返回（同一引用，不拷贝）", () => {
    const chunk = Buffer.from("const a = 1", "utf8");
    expect(rewriteUrls(chunk)).toBe(chunk);
  });

  it("非字符串非 Buffer：原样返回", () => {
    expect(rewriteUrls(undefined)).toBeUndefined();
  });
});
