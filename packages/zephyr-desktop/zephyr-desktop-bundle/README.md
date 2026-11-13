# @morlay/zephyr-desktop-bundle

[`@morlay/zephyr-cli`](../../zephyr/zephyr-cli/README.md) 的桌面插件：往命令树里追加 `desktop dev` 与 `desktop bundle`，
把工作区打成静态、无签名的桌面应用目录。壳是另一个包 [`@morlay/zephyr-desktop-shell`](../zephyr-desktop-shell/README.md)。

## 用法

在工作区配置里内联展开（这就是「插件」的全部接线）：

```ts
import { provideDesktopBundle } from "@morlay/zephyr-desktop-bundle";

export default {
  server: { entry: "./src/server.ts" },
  client: { entry: "./src/client/index.html" },
  desktop: {
    id: "ai.deepseek.zephyr.custom-next",
    name: "Zephyr Custom",
    window: { width: 1280, height: 800 },
  },
  plugins: [...provideDesktopBundle()],
} satisfies ZephyrConfig;
```

| 命令                    | 作用                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `zephyr desktop dev`    | 在 Electron 壳里跑工作区（开发形态）                             |
| `zephyr desktop bundle` | 先构建（每次），再打一个应用目录；`--install` 再装进系统应用目录 |

产物在 `node_modules/.zephyr/app/`：`asar` 打开、`*.node` 拆到 `app.asar.unpacked`，静态面与运行时闭包走
`extraResources`（`Resources/dist`、`Resources/runtime`），桌面身份写一份 `Resources/desktop.json`。
打包时还会写一个 `bootstrap.mjs`（`main` 的第一跳）：Finder 启动没有环境变量，而 `userData` 只能在 ready
之前设——启动器在那一刻算出部署值交给壳。

## 桌面用户数据（`userDataDir`）

Electron 的 `userData` 是浏览器 profile：页面存储、窗口状态、快捷键配置，以及粘住的页面端口
`page-port`。它由**本包一处算出**，壳只 `app.setPath`：

| 形态             | 默认值                                |
| ---------------- | ------------------------------------- |
| `desktop dev`    | `<appData>/<desktop.id>/dev/electron` |
| bundle / preview | `<appData>/<desktop.id>/electron`     |
| test             | 临时目录（用例自己给）                |

显式 `ZEPHYR_DESKTOP_USER_DATA` 优先（多工作区并行、临时 profile 都靠它）；不做按工作区哈希的自动隔离。
它与**数据根**（宿主侧的会话、设置、凭证）是两份数据，删一边不该动另一边。

**不签名**：`mac.identity: null` 是配置事实（不是环境变量开关）——产物给自己/内测用，签名只会引入
钥匙串与证书依赖。图标：配了 `desktop.icon`（svg / png）就由 `prepareIcons` 生成三平台图标（macOS 出 `.icns`，win / linux 用 512 png），没配就用 Electron 默认的。

依赖：`electron` 与 `electron-builder` 都是**可选 peer**——不装也能装配，只是真到打包那一步会明确报缺。

## 设计

- [桌面两包：插件与壳](./.agents/designs/20261110-桌面两包与单进程壳.md)
- [桌面功能面](./.agents/designs/20261114-desktop功能面.md)（能力矩阵、`userData` 目录契约、批次与判据）
- [桌面术语表](./.agents/GLOSSARY.md)
