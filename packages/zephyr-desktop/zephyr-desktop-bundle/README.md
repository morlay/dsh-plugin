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

**不签名**：`mac.identity: null` 是配置事实（不是环境变量开关）——产物给自己/内测用，签名只会引入
钥匙串与证书依赖。图标：配了 `desktop.icon`（svg / png）就由 `prepareIcons` 生成三平台图标（macOS 出 `.icns`，win / linux 用 512 png），没配就用 Electron 默认的。

依赖：`electron` 与 `electron-builder` 都是**可选 peer**——不装也能装配，只是真到打包那一步会明确报缺。

## 设计

- [桌面两包：插件与壳](./.agents/designs/20261110-桌面两包与单进程壳.md)
