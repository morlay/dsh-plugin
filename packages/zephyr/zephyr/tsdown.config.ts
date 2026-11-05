// 三个入口：门面、cordis 兼容层、测试面。
//
// 必须写出来：tsdown 默认只按 `src/index.ts` 出产物，`publishConfig.exports` 里的
// `./compat` / `./testing` 就会指向不存在的文件（`just build` 也不会报——它只检查入口能出活）。
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/compat/index.ts", "src/testing/index.ts"],
});
