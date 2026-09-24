# @morlay/dsh-desktop-shell

dsh 桌面应用的 **Electron 壳**：服务应用自己的 `<name>://` 协议，经字节管道（FD 3/4）把 desktop profile 交给
host 子进程 [`@morlay/dsh-desktop-host`](../dsh-desktop-host/README.md) 启动，并在首次启动 / 种子指纹变化时把
profile 种进 `DSH_HOME`。

它**不单独跑**——启动与打包它的是 [`@morlay/dsh-desktopify`](../dsh-desktopify/README.md)：

- `dsh-desktopify dev` 以**本包目录**为 Electron app 启动（Electron 按本包清单的 `main` 找到 `dist/index.mjs`）；
- `dsh-desktopify bundle` 把本包的 `dist/` 复制成最小壳 app 目录再交给 electron-builder。

边界与拆分理由见[设计 壳独立成包](./.agents/designs/20260924-壳独立成包.md)。

## 出口

| 出口                | 用途                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `.`                 | 壳入口（`dist/index.mjs`，Electron 主进程），由 `main` 与它一起指到 |
| `./appconfig`       | `appconfig.json` 读写与 profile patch 文件名                        |
| `./dshhome`         | `dshHome` 语义解析（`xdg` / `env` / 路径）                          |
| `./official`        | 官方包清单与 host 变体包名（壳与工具的同一份事实）                  |
| `./profile-project` | profile 工程（`pnpm-workspace.yaml`、overrides、清单）              |
| `./seed`            | 种子布局与指纹                                                      |

后五个是工具侧复用同一份实现的入口——种子、官方包清单、home 解析都只有这一份，壳与 CLI 都引它。

## 依赖边界

壳产物整份进 `app.asar`，那里只有壳自己的字节（`@local/*` 与 `@morlay/dsh-desktop-host` 构建期内联），上游包
一律留在产物外。因此**壳入口可达的模块只能 import node 内建、`electron` 与那两个内联面**——上游裸引用能过类型
检查、能打出产物，但装进 asar 后解析不到，只在真机启动时炸。守卫：
[`shell-import-boundary.spec.ts`](./src/__tests__/shell-import-boundary.spec.ts)。

preload 必须是 CJS（sandboxed preload 的约束），所以它单独一遍构建；壳主进程与它产在同一次 `pnpm build`。
