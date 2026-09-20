import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPackageTree } from "../cli/official-deps.ts";

const roots: string[] = [];

async function workDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-desktopify-payload-"));
  roots.push(root);
  return root;
}

async function manifest(dir: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(value, undefined, 2)}\n`);
}

async function touch(root: string, ...paths: string[]): Promise<void> {
  for (const path of paths) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "");
  }
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("official package copy", () => {
  it("copies an installation whole, including files outside its files whitelist", async () => {
    const root = await workDir();

    const source = join(root, "node_modules", "@img", "colour");
    await manifest(source, {
      name: "@img/colour",
      version: "1.1.0",
      main: "index.cjs",
      files: ["color.cjs", "index.d.ts"],
    });
    await touch(source, "color.cjs", "index.cjs", "index.d.ts", "README.md", "LICENSE.md");
    await manifest(join(source, "node_modules", "nested"), { name: "nested", version: "1.0.0" });
    await touch(join(source, "node_modules", "nested"), "index.js");

    const target = join(root, "closure", "@img", "colour");
    await copyPackageTree(source, target);

    expect((await readdir(target)).sort()).toEqual([
      "LICENSE.md",
      "README.md",
      "color.cjs",
      "index.cjs",
      "index.d.ts",
      "package.json",
    ]);
    expect(await exists(join(target, "node_modules"))).toBe(false);
  });

  it("keeps the files whitelist for a local source package", async () => {
    const root = await workDir();
    const source = join(root, "vendor", "harness", "packages", "some-pkg");
    await manifest(source, { name: "some-pkg", version: "0.0.0", files: ["dist"] });
    await touch(source, "dist/index.js", "src/index.ts", "README.md");

    const target = join(root, "closure", "some-pkg");
    await copyPackageTree(source, target);

    expect((await readdir(target)).sort()).toEqual(["dist", "package.json"]);
    expect(await exists(join(target, "src"))).toBe(false);
  });

  it("keeps a whitelisted plain file that sits outside a whitelisted directory", async () => {
    const root = await workDir();
    // 桌面 host 的载荷形状：`lib/` 是产物目录，桌面 patch 在 `lib/` 之外的单文件条目上。
    // 部署里的 host 启动时读 `../config/desktop.cordis.patch.yml`，两个条目缺一就起不来。
    const source = join(root, "packages", "desktop", "dsh-desktop-host");
    await manifest(source, {
      name: "@morlay/dsh-desktop-host",
      version: "0.0.1",
      files: ["lib", "config/desktop.cordis.patch.yml"],
    });
    await touch(
      source,
      "lib/index.js",
      "lib/webserver.js",
      "lib/wire.js",
      "config/desktop.cordis.patch.yml",
      "src/index.ts",
    );

    const target = join(root, "closure", "@morlay", "dsh-desktop-host");
    await copyPackageTree(source, target);

    expect((await readdir(target)).sort()).toEqual(["config", "lib", "package.json"]);
    for (const path of [
      "lib/index.js",
      "lib/webserver.js",
      "lib/wire.js",
      "config/desktop.cordis.patch.yml",
    ]) {
      expect(await exists(join(target, ...path.split("/")))).toBe(true);
    }
    expect(await exists(join(target, "src"))).toBe(false);
  });
});
