import { defineCordisPluginConfig } from "@local/devkit";

const BIN_NAME = "dsh-desktopify";
const CLI_ENTRY = "./src/cli/index.ts";

// 工具只发一个 bin 与一个给壳用的 client bundle 面：壳（Electron 主进程与 preload）已经是
// `@morlay/dsh-desktop-shell`，本包引它来起壳、打包与准备种子。
export default await defineCordisPluginConfig({
  entries: {
    "cli/index": CLI_ENTRY,
    "dev-client-bundles": "./src/dev-client/index.ts",
  },
  // bin 的入口要落位，但不该成为一个包出口（它按命令名用，不按子路径 import）。
  hidden: ["cli/index"],
  bin: { [BIN_NAME]: "cli/index" },
  // 内联进来的 @local/devkit 客户端打包面要 rolldown / lightningcss：两者都是公开包，
  // 按既有边界留在产物外（并在清单里声明），否则它们自己的原生二进制解析不到。
  neverBundle: ["electron", "lightningcss", "rolldown"],
  dts: false,
});
