// `Federation` 的用例夹具：一个指向 fixtures / 临时缓存的最小 `AppEnv`。
//
// 三份复制（serve / deps-url / reply）曾经各写一遍——同一份夹具只留一个 home。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app/testing";

/** fixtures 根（`fixture-row` / `fixture-cjs` 等假包住在这里）。 */
export const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;
const PACKAGE_ROOT = new URL("../../../../", import.meta.url).pathname;

/** fake 环境：`profileDir` 指向 fixtures（里面有 `fixture-row` / `fixture-cjs` 两个假包）。 */
@Injectable()
export class FakeAppEnv extends AppEnv {
  private static cache: string | undefined;

  /**
   * 指定这次装配用的缓存根。
   * @param cache - 临时缓存目录（见 {@link temporaryCache}）。
   */
  static useCache(cache: string): void {
    FakeAppEnv.cache = cache;
  }

  readonly values: AppEnvValues = {
    profileDir: FIXTURES,
    dataDir: join(tmpdir(), "dsh-federation-test"),
  };

  readonly cacheDir = FakeAppEnv.cache ?? join(tmpdir(), "dsh-fed-cache");

  readonly packageRoot = PACKAGE_ROOT;

  readonly appBootDir = join(PACKAGE_ROOT, "src", "client", "app-boot");

  readonly profileManifest = join(FIXTURES, "package.json");
}

/**
 * 起一个临时缓存目录（每个 spec 一份，产物互不串）。
 * @returns 缓存根路径。
 */
export async function temporaryCache(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "dsh-fed-"));
}
