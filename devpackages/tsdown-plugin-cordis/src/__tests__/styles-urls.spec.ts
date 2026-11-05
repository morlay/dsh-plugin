// `url()` 的处理走 lightningcss 的 AST 钩子，不是正则扫文本：`url()` 会出现在 `@supports` 内层、
// `mask` / `mask-image` 简写、`image-set()`、`@font-face` 里——文本正则漏一处就是一张图凭空消失
// （`ui-chat` 的 running-whale 掩膜图就是这么丢的）。这条用例盯的就是那种写法。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewriteCssUrls } from "../css.ts";

const CSS = [
  "/* 掩膜图：`@supports` 内层 + `mask` 简写，正则最容易漏的形状 */",
  "@supports (mask-mode: alpha) and (mask-image: url('')) {",
  "  .whale {",
  "    mask: url('./running-whale.png') center / 100% 100% no-repeat;",
  "  }",
  "}",
  "",
  ".plain { background-image: url('./dot.png'); }",
  "",
  ".external { background-image: url('https://example.com/a.png'); }",
  "",
].join("\n");

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "dsh-css-urls-"));
  // 大图（≥ 4KB）与一个小图，分别验证两条分支。
  await writeFile(join(directory, "running-whale.png"), Buffer.alloc(5000, 7));
  await writeFile(join(directory, "dot.png"), Buffer.from([1, 2, 3]));
  await writeFile(join(directory, "styles.css"), CSS);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("样式里的 url() 处理", () => {
  it("`@supports` 内层与 `mask` 简写里的 url() 也会被内联", async () => {
    const out = await rewriteCssUrls(CSS, join(directory, "styles.css"));

    expect(out).toContain("data:image/png;base64,");
    expect(out).not.toContain("./running-whale.png");
    // 外链原样留着（不该去读网络路径）。
    expect(out).toContain("https://example.com/a.png");
  });

  it("超过阈值的大图走 emit（落到资产），URL 换成给回来的那个", async () => {
    const emitted: string[] = [];
    const out = await rewriteCssUrls(
      CSS,
      join(directory, "styles.css"),
      "threshold",
      (name, bytes) => {
        emitted.push(`${name}:${String(bytes.byteLength)}`);
        return `/@client-modules/demo@1.0.0/assets/${name}`;
      },
    );

    expect(emitted).toContain("running-whale.png:5000");
    expect(out).toContain("/@client-modules/demo@1.0.0/assets/running-whale.png");
    // 小图仍然内联。
    expect(out).toContain("data:image/png;base64,");
  });
});
