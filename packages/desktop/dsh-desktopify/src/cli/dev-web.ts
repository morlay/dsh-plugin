import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DevWebConfig } from "./workspace.ts";

export const DEV_WEB_OVERLAY = "dev-web.cordis.patch.yml";

const CLIENT_ENTRY = ["src", "client", "index.ts"];

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `dsh web` 的启动参数：app 层装配以 `--patch` overlay 传入。
 *
 * 不写 profile 的用户层（`cordis.patch.yml`）——那份归用户，settings 面板写在那里；
 * app 装配随开发资源走，和打包形态由 host 加载 app 层是同一个层。
 * @param port - 监听端口。
 * @param appPatch - 开发资源里的 app 层 patch 路径；app 没声明时是 `undefined`。
 * @returns `dsh` 的子命令与参数。
 */
export function devWebArgs(port: string, appPatch: string | undefined): string[] {
  return ["web", "--port", port, ...(appPatch === undefined ? [] : ["--patch", appPatch])];
}

function placeholderBundle(name: string): string {
  return [
    `// dsh-desktopify dev --web 占位：${name} 的 client 半由 src/client/index.ts 现场打包。`,
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: () => ({}) });`,
    "",
  ].join("\n");
}

async function packageDirectories(modulesDir: string): Promise<string[]> {
  const directories: string[] = [];
  for (const entry of await readdir(modulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(modulesDir, entry.name);
    if (!entry.name.startsWith("@")) {
      directories.push(path);
      continue;
    }
    for (const scoped of await readdir(path, { withFileTypes: true })) {
      if (scoped.isDirectory() || scoped.isSymbolicLink())
        directories.push(join(path, scoped.name));
    }
  }
  return directories;
}

async function packageName(directory: string): Promise<string | undefined> {
  const path = join(directory, "package.json");
  if (!(await pathExists(path))) return undefined;
  const name = (JSON.parse(await readFile(path, "utf8")) as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

async function clientBundlePath(directory: string): Promise<string | undefined> {
  const path = join(directory, "package.json");
  if (!(await pathExists(path))) return undefined;
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const entry = manifest.exports?.["./client"];
  const target =
    typeof entry === "string"
      ? entry
      : typeof entry === "object" && entry !== null
        ? (entry as { default?: unknown }).default
        : undefined;
  return typeof target === "string" ? join(directory, target) : undefined;
}

export async function ensureClientBundlePlaceholders(
  profileDir: string,
  config: DevWebConfig,
): Promise<string[]> {
  const modulesDir = join(profileDir, "node_modules");
  if (!(await pathExists(modulesDir))) return [];
  const written: string[] = [];
  for (const directory of await packageDirectories(modulesDir)) {
    const name = await packageName(directory);
    if (name === undefined) continue;
    if (
      !config.packages.includes(name) &&
      !config.prefixes.some((prefix) => name.startsWith(prefix))
    )
      continue;
    if (!(await pathExists(join(directory, ...CLIENT_ENTRY)))) continue;
    const bundle = await clientBundlePath(directory);
    if (bundle === undefined || (await pathExists(bundle))) continue;
    await mkdir(dirname(bundle), { recursive: true });
    await writeFile(bundle, placeholderBundle(name));
    written.push(name);
  }
  return written;
}
