// `devkit clean`：删声明树与各包产物目录。
// 声明树删**整棵**（不是内容）：完成标记 `target/dts/.complete` 是隐藏文件，留着会让下一次构建以为声明还在。
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 删 `target/dts` 与 `packages/**` / `devpackages/**` 的 `dist`。
 *
 * @param root - 仓库根。
 * @returns 子进程退出码（删目录本身不失败）。
 */
export async function run(root: string): Promise<number> {
  await rm(join(root, "target/dts"), { recursive: true, force: true });
  return await new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "-r",
        "--filter",
        "./devpackages/*",
        "--filter",
        "./packages/*/*",
        "exec",
        "node",
        join(here, "clean-one.ts"),
      ],
      { cwd: root, stdio: "inherit" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
