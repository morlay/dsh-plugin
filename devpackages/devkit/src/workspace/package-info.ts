// 一个包的清单快照：`pnpm -r exec` 在每个包目录里跑一次，`workspacePackages` 收集这些行。
// 走 pnpm 的递归是为了让「哪些目录是包」只由 `pnpm-workspace.yaml` 决定——工具里不再自己 readdir。
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as Record<
  string,
  unknown
>;
process.stdout.write(JSON.stringify({ dir: process.cwd(), manifest }) + "\n");
