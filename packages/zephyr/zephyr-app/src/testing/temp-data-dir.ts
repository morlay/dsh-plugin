// 测试用的数据根：**必须是 tmpdir**。
//
// 装配面的 `dataDir` 缺省落在 `<cwd>/.dsh-store`——那是开发者真实的数据目录（会话库、设置、凭据都在里面）。
// 测试指到那里就会读写别人的库（实测过一次：把一份真会话库写成 2.6G）。
//
// 用法：
//
//   afterEach(async () => {
//     for (const app of opened.splice(0).reverse()) await app.dispose();
//     await cleanupDataDirs();     // ← 必须在 dispose **之后**：行还在写盘时删目录会 ENOENT
//   });
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/**
 * 建一个临时数据根。
 * @param prefix - 目录前缀（spec 名），排查时能认出是哪个用例留下的。
 * @returns 目录绝对路径。
 */
export async function tempDataDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/**
 * 删掉这次建过的全部数据根。**在 app 全部 dispose 之后调**。
 *
 * `maxRetries` 不是可选项：投影缓存的写盘是**异步**的，dispose 返回之后仍可能有半条写在飞，
 * 直接 `rm -rf` 会撞 `ENOTEMPTY`（实测过）。重试几次让它写完再删。
 * @returns 全部删完。
 */
export async function cleanupDataDirs(): Promise<void> {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
