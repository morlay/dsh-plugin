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
    const dropped: string[] = [];
    for (const { name, manifest } of packages) {
      const top = Object.keys(manifest.exports ?? {});
      const published = manifest.publishConfig?.exports ?? manifest.exports ?? {};
      const missing = top.filter((key) => !(key in published));
      if (missing.length > 0) dropped.push(`${name}: ${missing.join(", ")}`);
    }
    expect(dropped).toEqual([]);
  });

  it("client 半的开发态出口回源，发布态才指产物", () => {
    const clients = packages.filter(({ manifest }) => manifest.exports?.["./client"] !== undefined);
    expect(clients.length).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const { name, manifest } of clients) {
      const dev = manifest.exports?.["./client"];
      const published = (manifest.publishConfig?.exports ?? {})["./client"] as
        | { types?: unknown; default?: unknown }
        | undefined;
      // 开发态的出口就是一个指源码的字符串（上游按它读字节），与 host 面同一条规则。
      if (dev !== "./src/client/index.ts") wrong.push(`${name}: dev=${String(dev)}`);
      if (published?.default !== "./dist/client.cjs")
        wrong.push(`${name}: published=${String(published?.default)}`);
    }
    expect(wrong).toEqual([]);
  });
});
