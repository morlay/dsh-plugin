// 守卫「发布态不能比开发态少面」（判据：发布态出口的键集合覆盖顶层出口的键集合；顶层的 `types`
// 回源 `src`，发布态换成产物是允许的，但不许整个键消失）：`publishConfig.exports` 发布时整体替换顶层
// `exports`，漏一个键就是发布包少一个面（`@morlay/dsh-desktop-host` 的 `./package.json` 就这样丢过）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  readonly name: string;
  readonly exports?: Record<string, unknown>;
  readonly publishConfig?: { exports?: Record<string, unknown> };
  readonly dsh?: { client?: { platform?: string; inline?: boolean } };
}

// 所有发布包：`packages/<group>/<pkg>/package.json`（devpackages 的 `@local/*` 不发布）。
async function publishablePackages(): Promise<{ name: string; manifest: Manifest }[]> {
  const { glob } = await import("node:fs/promises");
  const found: { name: string; manifest: Manifest }[] = [];
  for await (const file of glob("packages/*/*/package.json", { cwd: process.cwd() })) {
    const manifest = JSON.parse(await readFile(join(process.cwd(), file), "utf8")) as Manifest;
    found.push({ name: manifest.name, manifest });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const packages = await publishablePackages();

describe("发布态的包出口", () => {
  it("有发布包可查（守卫本身没空转）", () => {
    expect(packages.length).toBeGreaterThan(10);
  });

  it("发布态出口覆盖顶层出口的每个键", () => {
    // `./src/*` 例外：那是**源码面**出口（包内测试按包名引用自己的源码），只在 workspace 内有效，
    // 发布物里不承诺它——顶层有、发布态无是正常的。
    const sourceOnly = new Set(["./src/*"]);
    const dropped: string[] = [];
    for (const { name, manifest } of packages) {
      const top = Object.keys(manifest.exports ?? {}).filter((key) => !sourceOnly.has(key));
      const published = manifest.publishConfig?.exports ?? manifest.exports ?? {};
      const missing = top.filter((key) => !(key in published));
      if (missing.length > 0) dropped.push(`${name}: ${missing.join(", ")}`);
    }
    expect(dropped).toEqual([]);
  });

  // client 面发布态有两个条件各司其职：`import` 给按 **ESM** 解析的消费方（vite / node 的 resolver），
  // `default` 是**兜底**条件——按包名 + `./client` 解析并读字节的加载方（CJS 的 `require`/`require.resolve`
  // 走的正是它）必须拿到 CJS 工厂，那是 `__ModuleLoader__.load` 的注册脚本。
  it("client 面开发态出口回源，发布态指 ESM 库产物与它的类型", () => {
    const clients = packages.filter(({ manifest }) => manifest.exports?.["./client"] !== undefined);
    expect(clients.length).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const { name, manifest } of clients) {
      const dev = manifest.exports?.["./client"];
      const published = (manifest.publishConfig?.exports ?? {})["./client"] as
        | { types?: unknown; import?: unknown; default?: unknown }
        | undefined;
      // 开发态的出口就是一个指源码的字符串（宿主按它读字节），与 host 面同一条规则。
      if (dev !== "./src/client/index.ts") wrong.push(`${name}: dev=${String(dev)}`);
      // 发布态：`import` 指 **ESM 库**、`default` 兜底指 **CJS 工厂**，`types` 指 ESM 面的声明。
      if (published?.import !== "./dist/client.mjs")
        wrong.push(`${name}: import=${String(published?.import)}`);
      if (published?.types !== "./dist/client.d.mts")
        wrong.push(`${name}: types=${String(published?.types)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("client 面的 default 兜底指 CJS 工厂（加载方按它读注册脚本）", () => {
    const clients = packages.filter(({ manifest }) => manifest.exports?.["./client"] !== undefined);
    const wrong = clients.filter(({ manifest }) => {
      const published = (manifest.publishConfig?.exports ?? {})["./client"] as
        | { default?: unknown }
        | undefined;
      return published?.default !== "./dist/client.cjs";
    });
    expect(wrong.map(({ name }) => name)).toEqual([]);
  });
});
