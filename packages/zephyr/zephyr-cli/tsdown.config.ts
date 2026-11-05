// 两个入口：库面（命令作者用）与 bin（`zephyr` 本体）。
//
// 必须写出来：tsdown 只按 `exports` 推断入口，`bin` 不在它的推导里——不写这一行，
// `publishConfig.bin` 指向的 `dist/cli.mjs` 根本不会产出。
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
});
