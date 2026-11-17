// planPrebundle 的三条**枚举规则**，每条都由一个「要不是这样就会错」的现场守着：
//
// 1. **解析基准是引用方**，不是应用清单——shiki 只装在引用它的那个包的 node_modules 里，
//    从应用清单出发解析不到（应用没声明它），但产物里必须有它；
// 2. **脏包名要丢**——正则扫源码会扫出模板字符串 / 文档里的假 import（@deepseek-ai/dsh-client-ghost/remote），
//    它们解析不到包根，应当**消失**，而不是进 failures（那是「该有却没有」的报告位）；
// 3. **子路径按实际说明符出**——@shikijs/langs 有 361 个 exports 子路径，全枚举会把清单撑爆；
//    源码引了哪几个就出哪几个，而同一个包的不同子路径仍各自出 target（shiki 与 shiki/core）。
//
// 夹具用 mkdtemp 现造：node_modules 被 .gitignore 挡住、进不了仓库；而且「只装在子包 node_modules 里」
// 这条事实本身要求一层嵌套，动态造更直白。
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { planPrebundle } from "../prebundle-plan.ts";

/** 写一个文件（父目录不存在就建）。 */
async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/** 写一份包清单。 */
async function putManifest(
  root: string,
  manifest: { name: string; version: string; exports: Record<string, string> },
): Promise<void> {
  await put(
    join(root, "package.json"),
    `${JSON.stringify({ type: "module", ...manifest }, null, 2)}\n`,
  );
}

/**
 * 造一份夹具工作区：
 *
 *   <root>/package.json                        应用清单（**不声明 shiki**）
 *   <root>/src/client/app-boot.ts              入口：引 @morlay/fixture-ui 的两个出口 + 一段脏数据
 *   <root>/node_modules/@morlay/fixture-ui/    我们的包（下潜范围）
 *   <root>/node_modules/@morlay/fixture-ui/node_modules/
 *     @deepseek-ai/dsh-client-fixture/         上游 client 面（下潜范围）
 *       node_modules/shiki/                    **只在这里**，从应用清单解析不到
 *       node_modules/@shikijs/langs/           exports 里有 5 个子路径，源码只引 2 个
 *
 * @returns 工作区根与那个上游包的包根（反例断言要用后者当"引用方"）。
 */
async function makeFixture(): Promise<{ root: string; upstream: string }> {
  // mkdtemp 给的可能是软链路径（macOS 的 /var → /private/var），而包根是 **realpath**
  // （软链要解开才能让紧随其后的解析按真实位置向上找）——两边先对齐，断言才比得了。
  const root = await realpath(await mkdtemp(join(tmpdir(), "zephyr-prebundle-plan-")));
  await putManifest(root, { name: "plan-fixture", version: "0.0.0", exports: {} });
  await put(
    join(root, "src", "client", "app-boot.ts"),
    [
      'import "@morlay/fixture-ui";',
      'import "@morlay/fixture-ui/client";',
      // 模板字符串里的**假 import**（文档片段 / 配置示例）：正则扫得到，包根解析不到。
      // 这行必须让 import 落在行首，正则才真的会把它当成说明符捡走。
      "export const snippet = `",
      'import "@deepseek-ai/dsh-client-ghost/remote";',
      'import "@morlay/ghost-pkg/ui";',
      "`;",
      "",
    ].join("\n"),
  );
  // 我们的包：宿主面（引上游包根）与 client 面（引上游 ./client）分两个出口。
  await putManifest(join(root, "node_modules", "@morlay", "fixture-ui"), {
    name: "@morlay/fixture-ui",
    version: "1.0.0",
    exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
  });
  await put(
    join(root, "node_modules", "@morlay", "fixture-ui", "src", "index.ts"),
    'import "@deepseek-ai/dsh-client-fixture";\n',
  );
  await put(
    join(root, "node_modules", "@morlay", "fixture-ui", "src", "client", "index.ts"),
    'import "@deepseek-ai/dsh-client-fixture/client";\n',
  );
  const upstream = join(
    root,
    "node_modules",
    "@morlay",
    "fixture-ui",
    "node_modules",
    "@deepseek-ai",
    "dsh-client-fixture",
  );
  await putManifest(upstream, {
    name: "@deepseek-ai/dsh-client-fixture",
    version: "2.0.0",
    exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
  });
  // 上游 client 面的真实现场：静态引 shiki 的子路径、动态引语言包（grammar 家族是运行期按需加载的）。
  await put(
    join(upstream, "src", "index.ts"),
    [
      'import "shiki";',
      'import "shiki/core";',
      'import "@shikijs/langs/typescript";',
      'export const load = async () => await import("@shikijs/langs/json");',
      "",
    ].join("\n"),
  );
  await put(join(upstream, "src", "client", "index.ts"), "export const client = 1;\n");
  // shiki / @shikijs/langs：**装在这一层**（pnpm 严格布局下传递依赖只在引用方可见）。
  await putManifest(join(upstream, "node_modules", "shiki"), {
    name: "shiki",
    version: "9.9.9",
    exports: {
      ".": "./index.mjs",
      "./core": "./core.mjs",
      "./engine/javascript": "./engine-javascript.mjs",
    },
  });
  for (const file of ["index.mjs", "core.mjs", "engine-javascript.mjs"]) {
    await put(join(upstream, "node_modules", "shiki", file), "export default 1;\n");
  }
  await putManifest(join(upstream, "node_modules", "@shikijs", "langs"), {
    name: "@shikijs/langs",
    version: "9.9.9",
    // 真实包有 361 个子路径；这里留几个就够证明「不全枚举」。
    exports: {
      ".": "./index.mjs",
      "./typescript": "./typescript.mjs",
      "./json": "./json.mjs",
      "./python": "./python.mjs",
      "./rust": "./rust.mjs",
    },
  });
  for (const file of ["index.mjs", "typescript.mjs", "json.mjs", "python.mjs", "rust.mjs"]) {
    await put(join(upstream, "node_modules", "@shikijs", "langs", file), "export default [];\n");
  }
  return { root, upstream };
}

describe("planPrebundle（枚举规则）", () => {
  it("按**引用方**解析包根：只装在子包 node_modules 里的 shiki 也要枚举到", async () => {
    const { root, upstream } = await makeFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const shiki = plan.targets.filter((target) => target.name === "shiki");
    // 包根与子路径**各自**是 target（core 与 index 不是同一个入口）。
    expect(shiki.map((target) => target.exportName).sort()).toEqual(["core", "index"]);
    // 清单落在**引用方**那一份上（不是仓库根、也不是应用清单所在的那层）。
    for (const target of shiki) {
      expect(target.entry).toContain(join("dsh-client-fixture", "node_modules", "shiki"));
      expect(target.manifestOf).toBe(
        join(
          root,
          "node_modules",
          "@morlay",
          "fixture-ui",
          "node_modules",
          "@deepseek-ai",
          "dsh-client-fixture",
          "node_modules",
          "shiki",
          "package.json",
        ),
      );
    }
    // 反向钉住「基准不能是应用清单」：同样的包名，从**应用清单**出发找不到（它没声明这个依赖，
    // 而 pnpm 的严格布局也只让声明者看得见），从**引用方**出发才有。
    const { findPackageJSON } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    // findPackageJSON 解析不到时**抛**（不是返回 undefined），所以这里与实现里一样包一层 try。
    const fromApp = (() => {
      try {
        return findPackageJSON("shiki", pathToFileURL(join(root, "package.json")).href);
      } catch {
        return undefined;
      }
    })();
    expect(fromApp).toBeUndefined();
    const fromImporter = findPackageJSON(
      "shiki",
      pathToFileURL(join(upstream, "src", "index.ts")).href,
    );
    expect(fromImporter).toBe(
      join(
        root,
        "node_modules",
        "@morlay",
        "fixture-ui",
        "node_modules",
        "@deepseek-ai",
        "dsh-client-fixture",
        "node_modules",
        "shiki",
        "package.json",
      ),
    );
  });

  it("脏包名被丢弃：既不进 targets，也不进 failures", async () => {
    const { root } = await makeFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const ghosts = ["@deepseek-ai/dsh-client-ghost", "@morlay/ghost-pkg"];
    for (const ghost of ghosts) {
      expect(plan.targets.some((target) => target.name === ghost)).toBe(false);
      // **failures 是「该有却没有」的报告位**：扫出来的假名不在这里。
      expect(plan.failures.some((failure) => failure.name === ghost)).toBe(false);
    }
    expect(plan.failures).toEqual([]);
  });

  it("子路径按**实际说明符**出：@shikijs/langs 只出被引用的那两个", async () => {
    const { root } = await makeFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const langs = plan.targets.filter((target) => target.name === "@shikijs/langs");
    // 静态 import 与动态 import 都算。
    expect(langs.map((target) => target.exportName).sort()).toEqual(["json", "typescript"]);
    // exports 里还有 python / rust：**没有被引用**就不该出目标（361 个子路径不能全枚举）。
    expect(langs.some((target) => target.exportName === "python")).toBe(false);
    expect(langs.some((target) => target.exportName === "rust")).toBe(false);
  });
});

/**
 * 造一份「同名多版本」夹具（pnpm 的严格布局下这是常态：不同引用方各看到一份）。
 *
 *   <root>/src/client/app-boot.ts          引两个我们的包（下潜范围）的 `./client` 出口
 *   <root>/node_modules/@morlay/holder-one/  src/client/index.ts → import dep-multi（1.0.0）
 *   <root>/node_modules/@morlay/holder-two/  src/client/index.ts → import dep-multi（2.0.0）
 *
 * 两个 holder 必须在**下潜范围**里：多版本只有沿着源码 import 图走才会被看见。
 * @returns 工作区根。
 */
async function makeMultiVersionFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zephyr-prebundle-multi-")));
  await putManifest(root, { name: "multi-fixture", version: "0.0.0", exports: {} });
  await put(
    join(root, "src", "client", "app-boot.ts"),
    ['import "@morlay/holder-one/client";', 'import "@morlay/holder-two/client";', ""].join("\n"),
  );
  for (const [holder, version] of [
    ["@morlay/holder-one", "1.0.0"],
    ["@morlay/holder-two", "2.0.0"],
  ] as const) {
    const holderRoot = join(root, "node_modules", ...holder.split("/"));
    await putManifest(holderRoot, {
      name: holder,
      version: "0.0.0",
      exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
    });
    await put(join(holderRoot, "src", "index.ts"), "export default 1;\n");
    await put(join(holderRoot, "src", "client", "index.ts"), 'import "dep-multi";\n');
    const multiRoot = join(holderRoot, "node_modules", "dep-multi");
    await putManifest(multiRoot, {
      name: "dep-multi",
      version,
      exports: { ".": "./index.mjs" },
    });
    await put(join(multiRoot, "index.mjs"), "export default 1;\n");
  }
  return root;
}

describe("planPrebundle（多版本）", () => {
  it("同名多版本各出一份：按副本而不是按包名去重", async () => {
    const root = await makeMultiVersionFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const multi = plan.targets.filter((target) => target.name === "dep-multi");
    // 按包名去重会把这两份塌成一份：产物里只出一个版本，另一个版本的地址永远 404（页面白屏）。
    expect(multi.map((target) => target.version).sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(new Set(multi.map((target) => target.manifestOf)).size).toBe(2);
  });
});
/**
 * 造一份「**双面入口**」夹具（设计决定 3：入口按浏览器条件解析，不是 `require` 条件）。
 *
 *   <root>/src/client/app-boot.ts            引 @morlay/dual-root 与 @morlay/dual-client/client
 *   <root>/node_modules/@morlay/dual-root/   exports['.'] 同时给 require / import
 *   <root>/node_modules/@morlay/dual-client/ exports['./client'] 同样双面，两条分支各引一个
 *                                            **只有那条路才看得见**的包（下潜读哪份，清单里就有哪个）
 *
 * 两条分支都用 `.ts`：判据是「**哪个文件**被选中」，不是扩展名或语法。
 * @returns 工作区根。
 */
async function makeDualEntryFixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zephyr-prebundle-dual-")));
  await put(join(root, "package.json"), `${JSON.stringify({ name: "dual-fixture", version: "0.0.0", exports: {} })}\n`);
  await put(
    join(root, "src", "client", "app-boot.ts"),
    ['import "@morlay/dual-root";', 'import "@morlay/dual-client/client";', ""].join("\n"),
  );
  // 目标侧：包根出口双面。
  const dualRoot = join(root, "node_modules", "@morlay", "dual-root");
  await put(
    join(dualRoot, "package.json"),
    `${JSON.stringify({
      name: "@morlay/dual-root",
      version: "1.0.0",
      exports: { ".": { require: "./dist/root.cjs", import: "./dist/root.mjs" } },
    })}\n`,
  );
  await put(join(dualRoot, "dist", "root.mjs"), 'export const variant = "import";\n');
  await put(join(dualRoot, "dist", "root.cjs"), 'module.exports = { variant: "require" };\n');
  // 下潜侧：`./client` 双面，两条分支各引一个只在它那边出现的包。
  const dualClient = join(root, "node_modules", "@morlay", "dual-client");
  await put(
    join(dualClient, "package.json"),
    `${JSON.stringify({
      name: "@morlay/dual-client",
      version: "1.0.0",
      exports: {
        "./client": { require: "./src/client/legacy.ts", import: "./src/client/modern.ts" },
      },
    })}\n`,
  );
  await put(join(dualClient, "src", "client", "modern.ts"), 'import "from-import-side";\n');
  await put(join(dualClient, "src", "client", "legacy.ts"), 'import "from-require-side";\n');
  for (const name of ["from-import-side", "from-require-side"]) {
    await put(
      join(root, "node_modules", name, "package.json"),
      `${JSON.stringify({ name, version: "1.0.0", exports: { ".": "./index.mjs" } })}\n`,
    );
    await put(join(root, "node_modules", name, "index.mjs"), "export default 1;\n");
  }
  return root;
}

describe("planPrebundle（入口按浏览器条件解析）", () => {
  it("`exports['.']` 双面：target.entry 落在 **import** 那份", async () => {
    const root = await makeDualEntryFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const target = plan.targets.find((item) => item.name === "@morlay/dual-root");
    // `createRequire().resolve` 会拿 `dist/root.cjs`（UMD/CJS 的字节）——产物跑在浏览器里，那不是它的字节。
    expect(target?.entry).toBe(join(root, "node_modules", "@morlay", "dual-root", "dist", "root.mjs"));
  });

  it("下潜也读 import 那份：只有它引到的包才进清单", async () => {
    const root = await makeDualEntryFixture();
    const plan = await planPrebundle({ entry: join(root, "src", "client", "app-boot.ts") });
    const names = plan.targets.map((target) => target.name);
    expect(names).toContain("from-import-side");
    expect(names).not.toContain("from-require-side");
  });
});
