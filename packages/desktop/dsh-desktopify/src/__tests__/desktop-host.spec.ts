import { mkdir, mkdtemp, lstat, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  desktopHost,
  materializeDesktopHost,
  officialClosure,
  officialDependencySpecs,
} from "../cli/official-deps.ts";
import { DESKTOP_HOST_PACKAGE } from "../official.ts";

const TOOL_ROOT = dirname(
  fileURLToPath(import.meta.resolve("@morlay/dsh-desktopify/package.json")),
);
/** 工具自己的依赖副本：部署里落位的载荷只能是它（不是工作区 / vendor 的同名包）。 */
const PAYLOAD = await desktopHost();

const roots: string[] = [];

async function workDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-desktopify-host-"));
  roots.push(root);
  return root;
}

async function plantStaleHost(modulesDir: string): Promise<string> {
  const target = join(modulesDir, ...DESKTOP_HOST_PACKAGE.split("/"));
  await mkdir(join(target, "lib"), { recursive: true });
  await writeFile(join(target, "lib", "index.js"), "// stale copy\n");
  await writeFile(
    join(target, "package.json"),
    `${JSON.stringify({ name: DESKTOP_HOST_PACKAGE, version: "9.9.9" })}\n`,
  );
  return target;
}

function payloadDir(): string {
  if (PAYLOAD === undefined) throw new Error("the tool has no desktop host payload dependency");
  return PAYLOAD.dir;
}

/** 部署里 host 的四样载荷：入口、无端口 webServer（patch 行按相对路径加载）、wire 协议与桌面 patch。
 *
 * host 启动时读 `../config/desktop.cordis.patch.yml`（`patchFiles`），patch 行再加载 `../lib/webserver.js`，
 * 所以缺任一样 host 都起不来——落位时必须齐全。
 */
const DEPLOYED_HOST_FILES: readonly (readonly string[])[] = [
  ["lib", "index.js"],
  ["lib", "webserver.js"],
  ["lib", "wire.js"],
  ["config", "desktop.cordis.patch.yml"],
];

async function expectDeployedHostFiles(root: string): Promise<void> {
  for (const segments of DEPLOYED_HOST_FILES) {
    expect((await lstat(join(root, ...segments))).isFile()).toBe(true);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop host 载荷", () => {
  it("载荷来自工具的依赖包，启动要用的四样文件都随包", async () => {
    const dir = payloadDir();

    expect(PAYLOAD?.version).not.toBe("9.9.9");
    expect(dir).toContain("dsh-desktop-host");
    await expectDeployedHostFiles(dir);
  });

  it("把闭包里已有的旧副本换成工具自己的载荷", async () => {
    const modulesDir = join(await workDir(), "node_modules");
    const stale = await plantStaleHost(modulesDir);

    expect(await materializeDesktopHost(modulesDir)).toBe(stale);

    expect(await readFile(join(stale, "lib", "index.js"), "utf8")).not.toContain("stale copy");
    const manifest = JSON.parse(await readFile(join(stale, "package.json"), "utf8")) as {
      version?: string;
    };
    expect(manifest.version).not.toBe("9.9.9");
    // 落位的是按 manifest `files` 复制的那一份：`lib/` 全部产物与 `config/` 都要在，
    // 否则部署里的 host 读不到桌面 patch。
    await expectDeployedHostFiles(stale);
  });

  it("把指向别处的载荷链接换成自己的副本", async () => {
    const root = await workDir();
    const modulesDir = join(root, "node_modules");
    const linked = await plantStaleHost(join(root, "workspace-link"));

    await mkdir(join(modulesDir, ...DESKTOP_HOST_PACKAGE.split("/").slice(0, -1)), {
      recursive: true,
    });
    await symlink(linked, join(modulesDir, ...DESKTOP_HOST_PACKAGE.split("/")), "dir");

    const target = await materializeDesktopHost(modulesDir);

    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(join(linked, "lib", "index.js"), "utf8")).toBe("// stale copy\n");
  });

  it("闭包与 dev 项目的装配都用这个载荷", async () => {
    const input = {
      workspace: TOOL_ROOT,
      workspaceRoot: process.cwd(),
      toolRoot: TOOL_ROOT,
      dshVersion: "workspace:*",
    };

    const closure = await officialClosure(input);
    const specs = await officialDependencySpecs(input);

    expect(closure.get(DESKTOP_HOST_PACKAGE)).toBe(payloadDir());
    expect(specs[DESKTOP_HOST_PACKAGE]).toBe(`link:${payloadDir()}`);
  });
});
