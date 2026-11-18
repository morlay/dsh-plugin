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
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
// **按包出口取**（`@morlay/zephyr-dev/testing`），不写 `../build/compile.ts` 这类跨目录相对路径：
// 子出口面里的相对 `../` 会让"面"退化成目录结构的一部分。
import {
  artifactAddressOf,
  artifactsOf,
  assertEntryProduct,
  assertReachableComplete,
  compile,
  fallbackToRuntime,
  memberAddressesOf,
  reachableModulesOf,
  REQUIRED_PREBUNDLE,
  supplementTargetsOf,
} from "@morlay/zephyr-dev/testing";

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

  // 枚举要按引用方逐个解析包根（rc.3 的上游包更多），3s 的默认上限不够（不是断言失败，是规模）。
  it("缺 REQUIRED 已知包：逐个点名，并在构建前就失败", { timeout: 20_000 }, async () => {
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
        [
          direct,
          `export const a = 1;\nconst later = () => import("${lazy}");\nconst b = later;\nexport { b };`,
        ],
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

  it("入口不进缺口：它是构建自身的前提，不是「页面会 404 的地址」", () => {
    const graph = reachableModulesOf({ entry: ENTRY, artifacts: new Map() });

    // 可达集合仍然从入口开始（它就是页面唯一引用的那一条）……
    expect(graph.reachable).toEqual([ENTRY]);
    // ……但不进缺口：入口产物由**入口 bundle 直接落盘**，既没有引用方、也不在预编译清单里。
    // 把它混进缺口判据只会得到「无引用方 / 无副本 / 没经手过」三句对入口毫无信息量的话；
    // 它的存在性由 `assertEntryProduct` 单独守（构建自身的前提，缺了就是构建没写出产物）。
    expect(graph.gaps).toEqual([]);
  });
});
describe("assertEntryProduct（入口产物是构建自身的前提）", () => {
  /** 入口目标（与 `appTargetOf` 同形：出口名 `client`，产物 `client.js`）。 */
  function appOf(workspace: string): Parameters<typeof assertEntryProduct>[0]["app"] {
    return {
      name: "fx-app",
      version: "0.0.0",
      exportName: "client",
      entry: join(workspace, "src/client/app-boot.ts"),
    };
  }

  it("入口产物不在盘上：报「没落盘」并指到文件，而不是当成缺口", async () => {
    const fixture = await fixtureOf({});

    const error = await assertEntryProduct({
      outDir: fixture.outDir,
      app: appOf(fixture.workspace),
    }).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );

    expect(error?.message).toContain("页面入口的产物没落盘");
    // 直接指到那个文件：排查的人不用再去拼目录名与产物文件名。
    expect(error?.message).toContain(join("fx-app@0.0.0", "client.js"));
    // 缺口判据那套**逐条格式**（缩进的「引用方 / 副本 / 打包器」三段）不该套到入口上。
    expect(error?.message).not.toContain("\n    引用方 ");
    expect(error?.message).not.toContain("\n    副本 ");
    expect(error?.message).not.toContain("\n    打包器 ");
  });

  it("入口产物在盘上：通过，并返回它的绝对路径", async () => {
    const fixture = await fixtureOf({
      "out/fx-app@0.0.0/.files.json": manifestOf({ client: "fx-app@0.0.0/client.js" }),
      "out/fx-app@0.0.0/client.js": "export const app = 1;\n",
    });

    await expect(
      assertEntryProduct({ outDir: fixture.outDir, app: appOf(fixture.workspace) }),
    ).resolves.toBe(join(fixture.outDir, "fx-app@0.0.0", "client.js"));
  });
});

describe("artifactsOf（清单是唯一真相：读不出就红）", () => {
  it("清单不是 JSON：抛错并指到那份清单，不静默当成「这个包没产物」", async () => {
    // 静默当空会把它的每条地址都算成缺口，报出来的却是一串「无副本、没经手过」的误导话。
    const fixture = await fixtureOf({
      "out/fx-app@0.0.0/.files.json": "{ 坏掉的 json",
      "out/fx-app@0.0.0/client.js": "export const app = 1;\n",
    });

    const error = await artifactsOf(fixture.outDir).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );

    expect(error?.message).toContain("产物清单不是 JSON");
    expect(error?.message).toContain(join("fx-app@0.0.0", ".files.json"));
  });
});
/** 共享运行时聚合产物的地址（虚拟包：名字与版本是实现的公开事实，这里写字面量当独立真值）。 */
const RUNTIME = PREFIX + "/@zephyr+shared-runtime@0.0.0/index.js";

/**
 * 一次性夹具：在 tmpdir 里铺一个工作区 + 一个静态目录。
 * @param files - 相对路径 → 内容（相对 tmp 根）。
 * @returns 工作区、静态目录与 `node:*` 的浏览器替身（判据这条链不碰它，给一个真实存在的文件即可）。
 */
async function fixtureOf(
  files: Record<string, string>,
): Promise<{ workspace: string; outDir: string; nodeStub: string }> {
  const root = await mkdtemp(join(tmpdir(), "zephyr-fallback-"));
  const nodeStub = join(root, "node-stub.cjs");
  await writeFile(nodeStub, "module.exports = {};\n", "utf8");
  for (const [relative, content] of Object.entries(files)) {
    const file = join(root, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  return { workspace: join(root, "workspace"), outDir: join(root, "out"), nodeStub };
}

/** 产物清单（`.files.json` 的原文）：产物地址从 `files` 的每一项算出来。 */
function manifestOf(files: Record<string, string>): string {
  return JSON.stringify({ rev: "fixture", files }, null, 2);
}

/**
 * 一个装着 `fx-runtime@1.0.0` 的夹具工作区：它够格当聚合产物的成员（能从应用清单解析到入口）。
 * @returns 相对 tmp 根的文件表。
 */
function appWorkspaceFiles(): Record<string, string> {
  return {
    "workspace/package.json": JSON.stringify({
      name: "fx-app",
      version: "0.0.0",
      dependencies: { "fx-runtime": "1.0.0" },
    }),
    "workspace/node_modules/fx-runtime/package.json": JSON.stringify({
      name: "fx-runtime",
      version: "1.0.0",
      exports: { ".": "./index.js" },
    }),
    "workspace/node_modules/fx-runtime/index.js": "export const runtimeMember = 1;\n",
  };
}

/**
 * 引用方的产物：清单 + 一段引用代码。
 * @param code - 产物正文。
 * @returns 相对 tmp 根的文件表。
 */
function clientOf(code: string): Record<string, string> {
  return {
    "out/fx-app@0.0.0/.files.json": manifestOf({ client: "fx-app@0.0.0/client.js" }),
    "out/fx-app@0.0.0/client.js": code,
  };
}

/** 引用方的产物地址（用例里当"引用方"的独立真值）。 */
const CLIENT = moduleUrlOf("fx-app", "0.0.0", "client.js");

describe("fallbackToRuntime（共享运行时兜底）", () => {
  it("产物引用没有出产物的地址：改写到聚合产物地址，聚合产物转发成员的具名导出", async () => {
    const missing = moduleUrlOf("fx-runtime", "1.0.0", "index.js");
    const fixture = await fixtureOf({
      ...appWorkspaceFiles(),
      ...clientOf(
        'import { runtimeMember } from "' +
          missing +
          '?v=deadbeef";\nconsole.log(runtimeMember);\n',
      ),
    });

    const result = await fallbackToRuntime({
      outDir: fixture.outDir,
      addresses: [missing],
      appManifest: join(fixture.workspace, "package.json"),
      repoRoot: fixture.workspace,
      nodeStub: fixture.nodeStub,
    });

    expect(result.runtime).toBe(RUNTIME);
    expect(result.members).toEqual(["fx-runtime"]);
    expect(result.rewritten).toEqual([missing]);
    // 引用方被改写：落到聚合产物、带着构建器指纹，且不再指向那条缺产物的地址。
    const client = await readFile(join(fixture.outDir, "fx-app@0.0.0/client.js"), "utf8");
    expect(client).toContain('from "' + RUNTIME + "?v=");
    expect(client).not.toContain(missing);
    // 聚合产物落盘，成员地址表就是它正文里 `export * from` 的那几段（具名平铺、没有 default 位）。
    const runtime = await readFile(
      join(fixture.outDir, "@zephyr+shared-runtime@0.0.0/index.js"),
      "utf8",
    );
    expect(memberAddressesOf(runtime)).toEqual([missing]);
    expect(runtime).not.toContain("export default");
    expect(runtime).not.toContain("export{default");
  });

  it("共享运行时被 default 导入：构建失败，并给出引用方产物与成员的两个地址", async () => {
    const member = moduleUrlOf("fx-runtime", "1.0.0", "index.js");
    const fixture = await fixtureOf({
      ...appWorkspaceFiles(),
      ...clientOf('import React from "' + member + '?v=deadbeef";\nconsole.log(React);\n'),
    });

    const error = await fallbackToRuntime({
      outDir: fixture.outDir,
      addresses: [member],
      appManifest: join(fixture.workspace, "package.json"),
      repoRoot: fixture.workspace,
      nodeStub: fixture.nodeStub,
    }).then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    );

    expect(error?.message).toContain("共享运行时只允许具名导入");
    // 两个地址都在：被默认导入的成员地址 + 写这条导入的引用方产物地址（不是桩出来的"源文件"）。
    expect(error?.message).toContain(member);
    expect(error?.message).toContain(CLIENT);
    expect(error?.message).toContain("React");
  });

  it("版本对不上、或出口解析不到：不成为聚合产物成员（不吞多版本、不退化到包根）", async () => {
    // 应用清单里是 katex 0.18.10，地址指的是 0.16.47 那一份副本：拿 0.18 的导出面顶上去就是吞多版本。
    const otherVersion = moduleUrlOf("katex", "0.16.47", "index.js");
    // 包根解析得到、但 `ui` 这个出口解析不到：退化成包根成员，平铺出来的导出名与引用方要的对不上。
    const unknownExport = moduleUrlOf("fx-runtime", "1.0.0", "ui.js");
    const fixture = await fixtureOf({
      "workspace/package.json": JSON.stringify({
        name: "fx-app",
        version: "0.0.0",
        dependencies: { katex: "0.18.10", "fx-runtime": "1.0.0" },
      }),
      "workspace/node_modules/katex/package.json": JSON.stringify({
        name: "katex",
        version: "0.18.10",
        exports: { ".": "./index.js" },
      }),
      "workspace/node_modules/katex/index.js": 'export const version = "0.18.10";\n',
      "workspace/node_modules/fx-runtime/package.json": JSON.stringify({
        name: "fx-runtime",
        version: "1.0.0",
        exports: { ".": "./index.js" },
      }),
      "workspace/node_modules/fx-runtime/index.js": "export const runtimeMember = 1;\n",
      ...clientOf(
        'import "' +
          otherVersion +
          '?v=deadbeef";\nimport { nope } from "' +
          unknownExport +
          '?v=deadbeef";\n',
      ),
    });

    const result = await fallbackToRuntime({
      outDir: fixture.outDir,
      addresses: [otherVersion, unknownExport],
      appManifest: join(fixture.workspace, "package.json"),
      repoRoot: fixture.workspace,
      nodeStub: fixture.nodeStub,
    });

    // 一个成员都没有 → 不造空产物、也不改写：它们留在缺口里，由失败面报红（决定 13）。
    expect(result).toEqual({ runtime: "", members: [], rewritten: [] });
    const client = await readFile(join(fixture.outDir, "fx-app@0.0.0/client.js"), "utf8");
    expect(client).toContain(otherVersion);
    expect(client).toContain(unknownExport);
  });
});

describe("supplementTargetsOf（有副本的一律按副本出独立产物）", () => {
  it("多版本各按自己的副本补目标、不合并；连副本都解析不到的才留给兜底", async () => {
    // pnpm 严格布局：`katex@0.16` 只挂在 `micromark-extension-math` 下面，`katex@0.18` 在图根那一份里。
    const nested = "node_modules/.pnpm/micromark-extension-math@3.1.0/node_modules";
    const rootCopy = "node_modules/.pnpm/katex@0.18.10/node_modules/katex";
    const nestedCopy = `${nested}/katex`;
    const files: Record<string, string> = {
      "workspace/package.json": JSON.stringify({ name: "fx-app", version: "0.0.0" }),
    };
    for (const [copy, version] of [
      [rootCopy, "0.18.10"],
      [nestedCopy, "0.16.0"],
    ] as const) {
      files[`workspace/${copy}/package.json`] = JSON.stringify({
        name: "katex",
        version,
        exports: { ".": "./index.js" },
      });
      files[`workspace/${copy}/index.js`] = `export const version = "${version}";\n`;
    }
    // 引用方（它自己已在产物里）：传递依赖的副本只从它的清单解析得到。
    files[`workspace/${nested}/micromark-extension-math/package.json`] = JSON.stringify({
      name: "micromark-extension-math",
      version: "3.1.0",
      dependencies: { katex: "^0.16.0" },
      exports: { ".": "./index.js" },
    });
    files[`workspace/${nested}/micromark-extension-math/index.js`] = "export const math = 1;\n";
    const fixture = await fixtureOf(files);
    const importer = {
      name: "micromark-extension-math",
      version: "3.1.0",
      exportName: "index",
      entry: join(fixture.workspace, nested, "micromark-extension-math/index.js"),
      manifestOf: join(fixture.workspace, nested, "micromark-extension-math/package.json"),
    };
    const rootTarget = {
      name: "katex",
      version: "0.18.10",
      exportName: "index",
      entry: join(fixture.workspace, rootCopy, "index.js"),
      manifestOf: join(fixture.workspace, rootCopy, "package.json"),
    };

    // 连副本都解析不到的地址（哪个 node_modules 里都没有它）。
    const ghost = moduleUrlOf("ghost", "0.0.0", "index.js");

    const extra = await supplementTargetsOf({
      gaps: [
        // 图根那一份副本：从已知目标里认出来。
        { url: moduleUrlOf("katex", "0.18.10", "index.js"), importers: [] },
        // 引用方下面那一份：只能从引用方的清单解析。
        {
          url: moduleUrlOf("katex", "0.16.0", "index.js"),
          importers: [artifactAddressOf(importer)],
        },
        // 连副本都没有的：补不出目标，交给兜底。
        { url: ghost, importers: [] },
      ],
      known: [rootTarget, importer],
      appManifest: join(fixture.workspace, "package.json"),
    });

    // 两条地址各自的副本都被认了出来（版本各是各的、包根也各是各的：合并会让其中一个永远 404）。
    expect(extra.map((target) => [target.version, dirname(target.entry)])).toEqual([
      ["0.18.10", join(fixture.workspace, rootCopy)],
      ["0.16.0", join(fixture.workspace, nestedCopy)],
    ]);
    // 传递依赖那一条：**解析基准是引用方**（所以认得出 0.16 那份），但清单要是**这份副本自己的**
    // ——外置版本表与包组都按它分，拿引用方的清单顶上会把同一份副本拆成两个组。
    expect(extra[1]?.manifestOf).toContain(
      "micromark-extension-math@3.1.0/node_modules/katex/package.json",
    );
    expect(extra.some((target) => target.name === "ghost")).toBe(false);
    // **两份都出了产物 ⇒ 兜底一次都不该被触发**：只剩 ghost 那条进兜底，而它连副本都没有、也不成成员，
    // 于是 runtime 为空（不造空产物），留在缺口里由失败面报红（决定 13）。
    const resolved = new Set(extra.map((target) => artifactAddressOf(target)));
    const fallback = await fallbackToRuntime({
      outDir: fixture.outDir,
      addresses: [ghost],
      appManifest: join(fixture.workspace, "package.json"),
      repoRoot: fixture.workspace,
      nodeStub: fixture.nodeStub,
    });
    expect(resolved.size).toBe(2);
    expect(fallback).toEqual({ runtime: "", members: [], rewritten: [] });
  });
});
describe("assertReachableComplete（兜底之后仍缺即红）", () => {
  it("不可达的坏产物不参与判据；可达的坏地址报错，并点名地址与引用方", async () => {
    const broken = moduleUrlOf("pkg-a", "1.0.0", "index.js");
    const missing = moduleUrlOf("pkg-c", "3.0.0", "index.js");
    // 宿主面产物：页面不加载它，它引用的东西缺了也不该让构建红（决定 12）。
    const hostOnly = moduleUrlOf("host-only", "1.0.0", "index.js");
    const graph = reachableModulesOf({
      entry: ENTRY,
      artifacts: new Map([
        [ENTRY, `import { a } from "${broken}";`],
        [broken, `import { c } from "${missing}?v=deadbeef";`],
        [hostOnly, `import "${moduleUrlOf("gone", "0.0.0", "index.js")}";`],
      ]),
    });

    // 只有不可达的坏产物时：不抛（目录里有垃圾 ≠ 页面会 404）。
    expect(() =>
      assertReachableComplete({
        reachable: reachableModulesOf({
          entry: ENTRY,
          artifacts: new Map([[ENTRY, "export const a = 1;"]]),
        }),
        failures: [],
        where: "夹具",
      }),
    ).not.toThrow();

    const error = (() => {
      try {
        assertReachableComplete({
          reachable: graph,
          failures: [
            {
              target: {
                name: "pkg-c",
                version: "3.0.0",
                exportName: "index",
                entry: "/tmp/pkg-c/index.js",
                manifestOf: "/tmp/pkg-c/package.json",
              },
              reason: "原生模块 .node 编不了",
            },
          ],
          where: "应用 fx · 入口 /tmp/fx/src/client/app-boot.ts",
        });
        return undefined;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    // 四样凑齐才算「一次定位」：地址 / 引用方 / 副本 / 打包器原话。
    expect(error?.message).toContain("仍有缺口");
    expect(error?.message).toContain(missing);
    expect(error?.message).toContain(broken);
    expect(error?.message).toContain("pkg-c@3.0.0");
    expect(error?.message).toContain("原生模块 .node 编不了");
    // 不可达的那条不在读数里。
    expect(error?.message).not.toContain(hostOnly);
  });
});
