import { access, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 壳包根：dev 以它作为 Electron app 目录（Electron 按壳包清单的 `main` 起主进程），
 * bundle 从它拷 `dist/`。壳与工具拆成两个包之后，这条路径一律由 node 解析，工具里不写死包名。
 */
export const SHELL_PACKAGE_ROOT = dirname(
  fileURLToPath(import.meta.resolve("@morlay/dsh-desktop-shell/package.json")),
);

export const SHELL_ENTRY = join(SHELL_PACKAGE_ROOT, "dist", "index.mjs");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      found.push(...(await filesUnder(path)));
    } else if (entry.isFile()) found.push(path);
  }
  return found;
}

async function checkShellBuild(): Promise<void> {
  if (!(await pathExists(SHELL_ENTRY))) {
    throw new Error(`dsh-desktopify: shell build is missing ${SHELL_ENTRY}; run pnpm build`);
  }
  const built = (await stat(SHELL_ENTRY)).mtimeMs;
  const stale: string[] = [];
  for (const file of await filesUnder(join(SHELL_PACKAGE_ROOT, "src"))) {
    if ((await stat(file)).mtimeMs > built) stale.push(file);
  }
  if (stale.length > 0) {
    console.warn(
      `dsh-desktopify: shell build is older than ${String(stale.length)} source file(s) ` +
        `(first: ${relative(SHELL_PACKAGE_ROOT, stale[0] ?? "")}); run pnpm build — dev and bundle ` +
        "load the built shell, not the sources",
    );
  }
}

export async function buildShell(): Promise<void> {
  if (!(await pathExists(join(SHELL_PACKAGE_ROOT, "src", "index.ts")))) {
    if (!(await pathExists(SHELL_ENTRY))) {
      throw new Error(`dsh-desktopify: packaged shell build is missing ${SHELL_ENTRY}`);
    }
    console.log("dsh-desktopify: using the packaged shell build");
    return;
  }
  await checkShellBuild();
}
