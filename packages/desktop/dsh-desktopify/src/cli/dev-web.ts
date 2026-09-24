import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROFILE_PATCH_NAME } from "@morlay/dsh-desktop-shell/appconfig";
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

export async function installProfilePatch(
  profileDir: string,
  workspace: string,
): Promise<string | undefined> {
  const source = join(workspace, PROFILE_PATCH_NAME);
  if (!(await pathExists(source))) return undefined;
  const target = join(profileDir, PROFILE_PATCH_NAME);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(source, "utf8"));
  return target;
}

/**
 * 把 profile 的 `dsh.profile.bundles` 刷成 app 定义的那份。
 *
 * profile 目录里这份清单是种子时写下的用户数据，dev 只往里 `plugin add` 依赖、不跟随后来的改动；而
 * 装配的 patch 层顺序按它排——清单过期时，app 里排在后面的 bundle 插入的行打不到前面层的 patch（只
 * warn 后跳过，配置静默丢失）。这里让它与 app 定义同源；已经一致时不改写文件。
 * @param profileDir - profile 目录，其 `package.json` 带 `dsh.profile.bundles`。
 * @param bundles - app 定义的装配清单（shipped bundle 前缀 + 应用自己的 bundle）。
 * @returns 写过的 `package.json` 路径；无需改写时 undefined。
 */
export async function syncProfileBundles(
  profileDir: string,
  bundles: readonly string[],
): Promise<string | undefined> {
  const target = join(profileDir, "package.json");
  const manifest = JSON.parse(await readFile(target, "utf8")) as {
    dsh?: { profile?: { bundles?: unknown } };
  };
  const current = manifest.dsh?.profile?.bundles;
  if (
    Array.isArray(current) &&
    current.length === bundles.length &&
    current.every((bundle, index) => bundle === bundles[index])
  )
    return undefined;
  const dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles] } };
  await writeFile(target, `${JSON.stringify({ ...manifest, dsh }, undefined, 2)}\n`);
  return target;
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
