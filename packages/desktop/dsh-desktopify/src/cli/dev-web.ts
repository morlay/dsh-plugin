import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// 把 profile 的 `dsh.profile.bundles` 刷成 app 定义的那份，已经一致时不改写文件。
//
// 清单过期会让后面的 bundle 打不到前面层的 patch（只 warn 后跳过，配置静默丢失）。
// 返回写过的 `package.json` 路径；无需改写时 undefined。
export async function syncProfileBundles(
  profileDir: string,
  bundles: readonly string[],
): Promise<string | undefined> {
  const target = join(profileDir, "package.json");
  const manifest = JSON.parse(await readFile(target, "utf8")) as {
    name?: string;
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
