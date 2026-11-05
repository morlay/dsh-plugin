// 工作区配置：**唯一**配置面（`package.json` 的 `dsh` 段不再被读）。
//
// 它描述的是「这个工作区是什么」，不是「CLI 有哪些命令」：`dev` / `build` / `preview` 永远存在，
// 桌面命令由插件追加（本工作区暂未装桌面插件）。
import { provideDesktopBundle } from "@morlay/zephyr-desktop-bundle";
import { zephyrClientViteConfig } from "@morlay/zephyr-app/build";
import type { ZephyrConfig } from "@morlay/zephyr-cli";

export default {
  // 服务端入口：导出（或 (mode) => ）一份 provider 清单；生命周期归 CLI。
  server: { entry: "./src/server.ts" },
  // 页面与前端入口：root 是本目录（HTML 里写的是 ./app-boot.ts）。
  client: {
    // 页面入口：root 是它的目录，input 是它自己（前端模块由 HTML 里的 script 引）。
    entry: "./src/client/index.html",
    // 静态面按框架的解析规则产出（alias / define / 装饰器）：片段在这里展开，产物位置由 CLI 叠上去。
    vite: zephyrClientViteConfig({ repoRoot: import.meta.dirname }),
  },
  desktop: {
    id: "ai.deepseek.zephyr.custom",
    name: "Zephyr Custom",
    icon: "icon.svg",
    window: { width: 1280, height: 800, minWidth: 800, minHeight: 600 },
  },
  // dev 落在工作区的 .dsh-store；打包形态用 `--data-dir=xdg` 或在这里改成 "xdg"。
  dataDir: "workspace",
  // 桌面命令由插件追加：`desktop dev` / `desktop bundle`。
  plugins: [...provideDesktopBundle()],
} satisfies ZephyrConfig;
