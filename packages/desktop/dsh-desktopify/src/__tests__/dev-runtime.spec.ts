import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  devHostEntry,
  devInstallAnchor,
  devRuntimeRoot,
  requireDevRuntime,
} from "../cli/dev-layout.ts";

const roots: string[] = [];

async function workDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dsh-desktopify-dev-runtime-"));
  roots.push(root);
  return root;
}

async function plant(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{}\n");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("dev 安装根", () => {
  // 宿主与 web 入口都按 `<runtimeDir>/node_modules/<包名>` 解析；dev 复用工作区 pnpm store 的
  // 扁平层，因此这两条路径就是「装没装 / 构建没构建」的判据。
  it("安装根是工作区根下的 pnpm store，锚点与 host 入口都在它的 node_modules 下", () => {
    const runtimeDir = devRuntimeRoot(join("/repo"));

    expect(runtimeDir).toBe(join("/repo", "node_modules", ".pnpm"));
    expect(devInstallAnchor(runtimeDir)).toBe(
      join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
    );
    expect(devHostEntry(runtimeDir)).toBe(
      join(runtimeDir, "node_modules", "@morlay", "dsh-desktop-host", "lib", "index.js"),
    );
  });

  it("锚点与 host 载荷都在时不报错", async () => {
    const runtimeDir = devRuntimeRoot(await workDir());
    await plant(devInstallAnchor(runtimeDir));
    await plant(devHostEntry(runtimeDir));

    await expect(requireDevRuntime(runtimeDir)).resolves.toBeUndefined();
  });

  it("缺安装锚点时把锚点路径报出来", async () => {
    const runtimeDir = devRuntimeRoot(await workDir());
    await plant(devHostEntry(runtimeDir));

    await expect(requireDevRuntime(runtimeDir)).rejects.toThrow(
      new RegExp(`missing at .*@deepseek-ai.*dsh.*package\\.json`, "u"),
    );
  });

  it("缺 host 载荷时指向构建那一步", async () => {
    const runtimeDir = devRuntimeRoot(await workDir());
    await plant(devInstallAnchor(runtimeDir));

    await expect(requireDevRuntime(runtimeDir)).rejects.toThrow(/dsh-desktop-host.*pnpm build/u);
  });
});
