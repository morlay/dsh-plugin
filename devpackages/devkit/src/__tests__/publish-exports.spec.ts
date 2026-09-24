// 清单（`exports` / `publishConfig.exports`）由构建写回，规则见
// `devpackages/devkit/src/package-exports.ts`。这条守卫盯的是「发布态不能比开发态少面」：
// `publishConfig.exports` 在发布时**整体替换**顶层 `exports`，漏一个键就是发布包少一个面，而按
// 「包名 + 出口」解析的消费方会直接失败——`@morlay/dsh-desktop-host` 的 `./package.json` 就这样丢过：
// desktopify 的 `import.meta.resolve("@morlay/dsh-desktop-host/package.json")` 抛
// ERR_PACKAGE_PATH_NOT_EXPORTED，`mise run install`（桌面打包）整个起不来。
//
// 判据：发布态出口的键集合必须覆盖顶层出口的键集合。顶层出口的 `types` 回源 `src`（不发布），
// 发布态换成构建产物是允许的，但不许整个键消失。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  readonly name: string;
  readonly exports?: Record<string, unknown>;
  readonly publishConfig?: { exports?: Record<string, unknown> };
}

/** 所有发布包：`packages/<group>/<pkg>/package.json`（devpackages 的 `@local/*` 不发布）。 */
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
    const dropped: string[] = [];
    for (const { name, manifest } of packages) {
      const top = Object.keys(manifest.exports ?? {});
      const published = manifest.publishConfig?.exports ?? manifest.exports ?? {};
      const missing = top.filter((key) => !(key in published));
      if (missing.length > 0) dropped.push(`${name}: ${missing.join(", ")}`);
    }
    expect(dropped).toEqual([]);
  });
});
