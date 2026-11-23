// 删本包的 `dist`：`devkit clean` 用 `pnpm -r exec` 在每个包目录里跑一次（包列表由 pnpm 给）。
import { rm } from "node:fs/promises";
import { join } from "node:path";

await rm(join(process.cwd(), "dist"), { recursive: true, force: true });
