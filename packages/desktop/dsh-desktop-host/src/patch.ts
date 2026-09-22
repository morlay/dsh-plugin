/**
 * 桌面启动的 patch 层清单。
 *
 * 装配行分两层：**app 层**是应用自己的装配（随 app 的只读资源分发，重种 profile 不碰它），
 * **宿主层**是桌面形态的传输接管（`config/desktop.cordis.patch.yml`，随宿主包走）。
 * 上游按「后应用的层覆盖先应用的层」合并（见 `@deepseek-ai/dsh-app-boot` 的
 * `readProfilePatches`），所以 app 层在前、宿主层在后。
 *
 * app 层文件由打包器（`@morlay/dsh-desktopify`）写进 runtime 资源；缺了就不放这一层——
 * 旧产物没有它，仍按只有宿主层的方式启动。
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** runtime 资源里承载 app 装配行的 patch 文件名；打包器与本包共用这一个拼写。 */
export const DESKTOP_APP_PATCH_FILENAME = "app.cordis.patch.yml";

/** 宿主自带的传输接管层：禁掉上游 `webserver` 行，插入宿主内的无端口替身。 */
export const DESKTOP_HOST_PATCH = fileURLToPath(
  new URL("../config/desktop.cordis.patch.yml", import.meta.url),
);

/**
 * patch 层按加载顺序排列：app 层（存在才放）在前，宿主层在后。
 * @param runtimeDir - 部署 runtime 根，host 的 argv[2]。
 * @returns overlay 层的绝对路径列表。
 */
export async function desktopPatchFiles(runtimeDir: string): Promise<string[]> {
  const appPatch = join(runtimeDir, DESKTOP_APP_PATCH_FILENAME);
  const shipped = await access(appPatch).then(
    () => true,
    () => false,
  );
  return shipped ? [appPatch, DESKTOP_HOST_PATCH] : [DESKTOP_HOST_PATCH];
}
