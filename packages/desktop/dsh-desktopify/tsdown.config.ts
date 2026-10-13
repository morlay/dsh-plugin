import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

const BIN_NAME = "dsh-desktopify";
const CLI_ENTRY = "./src/cli/index.ts";

// 工具只发一个 bin 与一个给壳用的 client bundle 面：壳（Electron 主进程与 preload）已经是
// `@morlay/dsh-desktop-shell`，本包引它来起壳、打包与准备种子。
export default defineConfig({
  entry: { "cli/index": CLI_ENTRY },
  plugins: [
    cordisPlugin({
      // bin 的入口要落位，但不该成为一个包出口（它按命令名用，不按子路径 import）。
      hidden: ["cli/index"],
      bin: { [BIN_NAME]: "cli/index" },
      neverBundle: ["electron"],
      dts: false,
    }),
  ],
});
