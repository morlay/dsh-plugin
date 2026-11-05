// 两个入口：库面（清单与纯函数）与 Electron 主进程入口。
//
// `electron` 是可选 peer，必须外部化——打进产物就等于把 Electron 本体塞进 asar。
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts", "src/app.ts", "src/preload.ts"],
  external: ["electron"],
});
