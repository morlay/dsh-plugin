// 指纹的输入文件集（缓存失效用）：仓库内的包看源码目录，三方看它的清单。
import { join } from "node:path";

export function watchOf(root: string | undefined, entry: string): string[] {
  if (root === undefined) return [entry];
  return root.includes("node_modules")
    ? [join(root, "package.json")]
    : [join(root, "src"), join(root, "lib")];
}
