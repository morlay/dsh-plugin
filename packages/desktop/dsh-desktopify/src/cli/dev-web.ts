import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROFILE_PATCH_NAME } from "@morlay/dsh-desktop-shell/appconfig";

export const DEV_WEB_OVERLAY = "dev-web.cordis.patch.yml";

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
