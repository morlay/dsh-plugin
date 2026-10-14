import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { prepareShellAppDirectory } from "../cli/electron-builder.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dshdev-shell-app-"));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

function appConfig(): AppConfig {
  return {
    name: "dsh-custom-next",
    displayName: "DSH Custom Next",
    id: "ai.deepseek.dsh.custom-next",
    version: "0.1.5",
    profile: "desktop",
    dshHome: "xdg",
    window: { width: 1280, height: 800, minWidth: 800, minHeight: 600 },
  };
}

describe("prepareShellAppDirectory", () => {
  it("用 prebuild 装配好的 app 目录，只补一份 electron-builder 需要的隔离文件", async () => {
    // appRoot 现在是 `prepareShell` 装配出来的目录（引导 + 转译后的 dist + 清单 + 本地化）：
    // 这里只补 `pnpm-workspace.yaml`（让 electron-builder 的包遍历停在工作目录），**不再重新装配**。
    const appDir = await workDir();
    await writeFile(join(appDir, "package.json"), `${JSON.stringify({ main: "./bootstrap.mjs" })}\n`);
    await writeFile(join(appDir, "bootstrap.mjs"), "export {};\n");
    await mkdir(join(appDir, "dist"), { recursive: true });
    await writeFile(join(appDir, "dist", "index.mjs"), "export {};\n");
    await writeFile(join(appDir, "dist", "preload-app.cjs"), "module.exports = {};\n");

    const prepared = await prepareShellAppDirectory({
      appRoot: appDir,
      buildCache: await workDir(),
      appConfig: appConfig(),
      icons: {},
      dir: true,
    });

    expect(prepared).toBe(appDir);
    expect(await readFile(join(prepared, "pnpm-workspace.yaml"), "utf8")).toBe("packages: []\n");
    const manifest = JSON.parse(await readFile(join(prepared, "package.json"), "utf8")) as {
      main?: string;
    };
    expect(manifest.main).toBe("./bootstrap.mjs");
    // 装配好的字节原样留着（dist 的入口与 preload）。
    expect(await exists(join(prepared, "dist", "index.mjs"))).toBe(true);
    expect(await exists(join(prepared, "dist", "preload-app.cjs"))).toBe(true);
  });
});
