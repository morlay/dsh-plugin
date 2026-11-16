// 造导入包：fflate 的 `zip` 是回调式异步 API（与生产导出同一条路径），这里桥成 Promise。
//
// 用例只用它拼 zip 的目录形状（artifact 名 + 内容），压缩算法本身不是判据。
import { zip } from "fflate";

/**
 * 把一组条目打成一个 zip。
 * @param entries - 条目名 → 内容。
 * @returns zip 字节。
 */
export async function zipOf(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, (error, data) => {
      if (error === null) resolve(data);
      else reject(error);
    });
  });
}
