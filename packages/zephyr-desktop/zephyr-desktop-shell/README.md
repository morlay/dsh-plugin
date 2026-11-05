# @morlay/zephyr-desktop-shell

zephyr 桌面应用的 Electron 壳：自定义协议出页面，窗口与生命周期也是装配行。
由 [`@morlay/zephyr-desktop-bundle`](../zephyr-desktop-bundle/README.md) 打进应用目录；一般**不需要直接用它**。

## 它做什么

主进程入口（`dist/main.mjs`）按顺序做四件事：

1. 注册 `zephyr://` 为特权协议（standard / secure / supportFetchAPI）；
2. 从 `Resources/dist` 读页面与资源，越界请求一律 403；
3. 装配一棵树：本包导出 `provideDesktopShell({ electron, resourcesDir, desktop })`，其余行由调用方的清单给；
4. 开窗口（选项来自配置里的 `desktop.window`），`window-all-closed` 时拆树退出。

渲染进程不拿 node 权限（`contextIsolation: true`、`nodeIntegration: false`）——这条在
`windowOptionsOf` 里是硬编码，不是缺省值。

## 形态与调试：只从环境变量来

壳的两种形态与吵闹程度**都由外部环境决定**，中间逻辑（协议、装配、宿主）不为某个形态改分支：

| 变量                                     | 取值               | 作用                                                                                          |
| ---------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `ZEPHYR_DESKTOP_MODE`                    | `dev` / `packaged` | dev：窗口只当浏览器，页面走工作区 dev server；packaged：页面与宿主都在随包产物里              |
| `ZEPHYR_DESKTOP_DEBUG`                   | `1` / `0`          | 调试面：渲染进程 console 转发 + DevTools + 生命周期日志（`desktop dev` 默认 1；错误永远输出） |
| `ZEPHYR_DESKTOP_NO_SANDBOX`              | `1`                | 受限环境（容器/无 GPU）下关沙箱并停用硬件加速，必须在 ready 之前                              |
| `ZEPHYR_DESKTOP_URL`                     | URL                | dev 形态加载哪个页面                                                                          |
| `ZEPHYR_DESKTOP_WORKSPACE` / `_DATA_DIR` | 路径               | 宿主清单需要的部署值                                                                          |

调试面的实现只有一处：[`src/debug.ts`](./src/debug.ts)（`log` / `renderer` 受开关控制，`fail` 不受）。

## 纯逻辑出口

`windowOptionsOf` / `resourcePathOf` / `mimeOf` / `isInside` 都可以单独引用与单测；
`electron` 是可选 peer，壳包不静态依赖它。

设计见 [桌面两包：插件与壳](../zephyr-desktop-bundle/.agents/designs/20261110-桌面两包与单进程壳.md)。
