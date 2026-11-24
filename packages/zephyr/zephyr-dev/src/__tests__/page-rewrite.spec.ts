// 页面骨架的落盘规则（设计决定 9）：`index.html` 进静态目录，入口 script 改写成应用入口的
// **联邦地址**——改完页面只认地址，不认源码。
//
// 规则与 dev 期同一条（`ServeDefault.replyPage` 那条「本地入口 → 交付地址」），所以这里不分文件名：
// 页面里那个 `type="module"` + 相对 src 的 script 就是入口。唯一变量是文件名（`index.html` /
// `index.ts`），改文件名等于造第二条规则。
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { BUNDLER_REV } from "../federation/bundle.ts";
import { writePage } from "../build/compile.ts";

/** 一页最小骨架（与应用 `src/client/index.html` 同形）。 */
const PAGE = [
  "<!doctype html>",
  "<html>",
  "  <head><title>t</title></head>",
  "  <body>",
  '    <div id="root"></div>',
  '    <script type="module" src="./app-boot.ts"></script>',
  "  </body>",
  "</html>",
  "",
].join("\n");

const APP = { name: "demo-app", version: "1.2.3", exportName: "client", entry: "/w/app-boot.ts" };

/**
 * 造一个静态目录 + 页面原文。
 * @param html - 页面原文。
 * @returns 页面路径与产物目录。
 */
async function fixture(html: string): Promise<{ pageEntry: string; outDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "zephyr-page-"));
  const outDir = join(root, "client_modules");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });
  const pageEntry = join(root, "index.html");
  await writeFile(pageEntry, html, "utf8");
  return { pageEntry, outDir };
}

describe("页面骨架落盘", () => {
  test("入口 script 改写成应用入口的联邦地址（带 ?v= 构建世代）", async () => {
    const { pageEntry, outDir } = await fixture(PAGE);
    const page = await writePage({ pageEntry, outDir, app: APP });
    const html = await readFile(page, "utf8");
    const expected = `/_zephyr/@modules/demo-app@1.2.3/client.js?v=${BUNDLER_REV}`;
    expect(html).toContain(`src="${expected}"`);
    expect(html).not.toContain("./app-boot.ts");
    // 其余内容原样保留（容器、head、注释都不动）。
    expect(html).toContain('id="root"');
    expect(page).toBe(join(outDir, "index.html"));
  });

  test("页面里没有本地入口 script：抛错（静默通过会产出一个永远白屏的目录）", async () => {
    const { pageEntry, outDir } = await fixture("<html><body>没有入口</body></html>");
    await expect(writePage({ pageEntry, outDir, app: APP })).rejects.toThrowError(/入口 script/u);
  });
});
