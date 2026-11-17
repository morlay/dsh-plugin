// `compile()` 的判据：**判据错误**（空清单、缺 REQUIRED 已知包）与**可达性判据**（从页面入口 BFS 可达地址）。
//
// 两条判据在**编排**那一段，所以都不必跑真打包——跑真打包既慢又会被无关的打包失败掩盖掉判据本身。
//
// 判据错误那三条同时钉住「判据没被放宽」：`REQUIRED_PREBUNDLE` 里那三个包是**已知包**，谁把断言删掉或把
// 某个名字挪走，这几条会立刻红。`shiki` 现在**枚举得到了**（下潜到 `@deepseek-ai/dsh-client*` 之后），所以第二条改成
// 「只点名真正缺的那个」——把"shiki 不再缺失"也钉住，否则枚举范围一缩，这条会悄悄退回旧行为。
//
// 可达性判据本身是纯函数（`reachableModulesOf`）：输入是「入口地址 + 地址 → 产物字节」，输出是「可达集合 + 缺口」。
// 不碰磁盘、不碰 runtime——快照怎么攒、缺口怎么变成构建失败都在别处接线，于是这里能用手写产物钉住规则。
// 那里有两条一定要钉住：
// 1. **不可达的坏产物不算缺口**：宿主面产物留在目录里是取舍（设计决定 12），页面永远不加载它，
//    它缺东西不该让构建红——判据只看可达子集。
// 2. **缺口要点名到「地址 + 引用方」**：只报一条地址，排查的人还得自己去 grep 谁引的。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, reachableModulesOf, REQUIRED_PREBUNDLE } from "../build/compile.ts";

/** 夹具根（两个目录各有自己的 `src/client/app-boot.ts`）。 */
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

/**
 * 一次调用的输入：产物落 tmpdir（用例不需要产物，只判判据）。
 * @param name - 夹具目录名。
 * @returns `compile()` 的输入。
 */
async function optionsOf(name: string): Promise<Parameters<typeof compile>[0]> {
  const workspace = join(FIXTURES, name);
  const outDir = await mkdtemp(join(tmpdir(), "zephyr-compile-"));
  return { workspace, appName: "compile-fixture", outDir };
}

describe("compile（判据）", () => {
  it("空清单：点名报「清单为空」，并带上入口与产物落点", async () => {
    const options = await optionsOf("compile-empty");
    const error = await compile(options).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单为空");
    // 诊断行要能直接指出是**哪个**入口与**哪个**产物目录（dev 的缓存与 build 的产物目录不同）。
    expect(error?.message).toContain("compile-empty/src/client/app-boot.ts");
    expect(error?.message).toContain(options.outDir);
  });

  it("缺 REQUIRED 已知包：逐个点名，并在构建前就失败", async () => {
    const error = await compile(await optionsOf("compile-partial")).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );
    expect(error?.message).toContain("前端预编译清单缺已知包");
    // 夹具只引了 `@morlay/zephyr-app/client`：它自己（`@morlay/zephyr-app`）与下潜到的 `shiki` 都在清单里，
    // 只有 `@morlay/dsh-conversation` 缺——**缺几个就点几个**（不是「几个」而是一句话说完）。
    expect(error?.message).toContain("@morlay/dsh-conversation");
    for (const name of REQUIRED_PREBUNDLE.filter((item) => item !== "@morlay/dsh-conversation")) {
      expect(error?.message).not.toContain(name);
    }
  });

  it("判据没放宽：REQUIRED 仍是那三个包（含只在别人 node_modules 里的 shiki）", () => {
    expect([...REQUIRED_PREBUNDLE]).toEqual([
      "@morlay/zephyr-app",
      "@morlay/dsh-conversation",
      "shiki",
    ]);
  });
});

/** 联邦地址前缀（与 `hmr-path.ts` 的 `FEDERATION_PREFIX` 同一个值，这里写字面量当独立真值）。 */
const PREFIX = "/_zephyr/@modules";

/** 应用入口地址（`<app>@<ver>/client.js`）：页面骨架里那一条。 */
const ENTRY = `${PREFIX}/app@0.1.0/client.js`;

/** 一个包产物地址：`<pkg>@<ver>/<出口名>.js`。 */
function moduleUrlOf(pkg: string, version: string, file: string): string {
  return `${PREFIX}/${pkg}@${version}/${file}`;
}

describe("reachableModulesOf（从页面入口 BFS 可达地址）", () => {
  it("可达的缺口：点名地址与引用方；不可达产物里的缺口不算", () => {
    const direct = moduleUrlOf("pkg-a", "1.0.0", "index.js");
    const lazy = moduleUrlOf("pkg-b", "2.0.0", "index.js");
    // 可达链上引用、但盘上没有产物：这是会 404 的那种缺口。
    const missing = moduleUrlOf("pkg-c", "3.0.0", "index.js");
    // 宿主面产物：页面不加载它，它引用的东西缺了也不该参与判据（设计决定 12）。
    const hostOnly = moduleUrlOf("host-only", "1.0.0", "index.js");
    const missingFromHost = moduleUrlOf("gone", "0.0.0", "index.js");

    const graph = reachableModulesOf({
      entry: ENTRY,
      artifacts: new Map([
        [ENTRY, `import { a } from "${direct}";`],
        // 动态 import 也是边：语言包 / grammar 只在运行时按需加载。
        [direct, `export const a = 1;\nconst later = () => import("${lazy}");\nconst b = later;\nexport { b };`],
        [lazy, `const gone = () => import("${missing}");\nexport { gone };`],
        [hostOnly, `import "${missingFromHost}";`],
      ]),
    });

    // 可达集合按 BFS 顺序，**含**那条没有产物的地址（浏览器照样会去取它）。
    expect(graph.reachable).toEqual([ENTRY, direct, lazy, missing]);
    expect(graph.gaps).toEqual([{ url: missing, importers: [lazy] }]);
    expect(graph.reachable).not.toContain(hostOnly);
  });

  it("同一条缺口被多处引用：只出一条，引用方按 BFS 顺序排", () => {
    const first = moduleUrlOf("first", "1.0.0", "index.js");
    const second = moduleUrlOf("second", "1.0.0", "index.js");
    const missing = moduleUrlOf("same-gap", "0.0.0", "index.js");

    const graph = reachableModulesOf({
      entry: ENTRY,
      artifacts: new Map([
        [ENTRY, `import "${first}";\nimport "${second}";`],
        [first, `import "${missing}";`],
        [second, `import "${missing}";`],
      ]),
    });

    expect(graph.gaps).toEqual([{ url: missing, importers: [first, second] }]);
  });

  it("`?v=` 不参与地址身份：带查询的引用命中不带查询的产物", () => {
    const dep = moduleUrlOf("pkg-a", "1.0.0", "index.js");

    const graph = reachableModulesOf({
      entry: `${ENTRY}?v=deadbeef`,
      artifacts: new Map([
        // 页面里的入口带 `?v=<构建器指纹>`，盘上与清单里都不带——它是缓存世代，不是地址的一部分。
        [ENTRY, `import { a } from "${dep}?v=deadbeef";\nconst b = a;\nexport { b };`],
        [dep, "export const a = 1;"],
      ]),
    });

    expect(graph.reachable).toEqual([ENTRY, dep]);
    expect(graph.gaps).toEqual([]);
  });

  it("入口自己没有产物：也算一处缺口（没有引用方）", () => {
    const graph = reachableModulesOf({ entry: ENTRY, artifacts: new Map() });

    expect(graph.reachable).toEqual([ENTRY]);
    expect(graph.gaps).toEqual([{ url: ENTRY, importers: [] }]);
  });
});
