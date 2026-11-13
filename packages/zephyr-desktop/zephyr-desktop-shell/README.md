# @morlay/zephyr-desktop-shell

zephyr 桌面应用的 Electron 壳：窗口与状态、产品菜单、单实例、导航判据、preload 桥与生命周期都在这一个进程里。
由 [`@morlay/zephyr-desktop-bundle`](../zephyr-desktop-bundle/README.md) 打进应用目录；一般**不需要直接用它**。

## 它做什么

主进程入口（`dist/main.mjs`）按顺序做四件事：

1. 单实例：拿不到锁就聚焦已有窗口并退出（第二份宿主会抢同一个数据根）；
2. 补登录 shell 环境、装快捷键桥与产品菜单（打包形态没有 Reload / DevTools 项）；
3. 开窗口（选项来自 `desktop.window`，位置与尺寸来自上次关窗的状态）；页面从**壳自己的 http 源**进——
   dev 形态是工作区的 dev server，打包形态是宿主同进程里起的 vite；
4. 关窗时存窗口状态、收桥与宿主树，然后退出。

## 形态与调试：只从环境变量来

壳的两种形态与吵闹程度**都由外部环境决定**，中间逻辑（菜单、装配、宿主）不为某个形态改分支：

| 变量                                     | 取值               | 作用                                                                                             |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `ZEPHYR_DESKTOP_MODE`                    | `dev` / `packaged` | dev：窗口只当浏览器，页面走工作区 dev server；packaged：页面与宿主都在随包产物里                 |
| `ZEPHYR_DESKTOP_DEBUG`                   | `1` / `0`          | 调试面：渲染进程 console 转发 + DevTools + 菜单里的 Reload / DevTools 项（`desktop dev` 默认 1） |
| `ZEPHYR_DESKTOP_NO_SANDBOX`              | `1`                | 受限环境（容器/无 GPU）下关沙箱并停用硬件加速，必须在 ready 之前                                 |
| `ZEPHYR_DESKTOP_URL`                     | URL                | dev 形态加载哪个页面                                                                             |
| `ZEPHYR_DESKTOP_WORKSPACE` / `_DATA_DIR` | 路径               | 宿主清单需要的部署值                                                                             |

调试面的实现只有一处：[`src/debug.ts`](./src/debug.ts)（`log` / `renderer` 受开关控制，`fail` 不受）。

## 纯逻辑出口

`windowOptionsOf` / `windowStateOf` / `menuTemplateOf` / `navigationPlanOf` / `focusWindowOf` 都可以单独引用
与单测；`electron` 是可选 peer，壳包不静态依赖它——原生能力只经 [`src/electron-like.ts`](./src/electron-like.ts)
的声明面调用。

## 用户数据

窗口位置与尺寸、快捷键配置都在 Electron 的 `userData` 下（`window-state.json` / `shortcuts.json`）：
配置只回答「第一次打开时多大」，之后由用户拖动决定。

`userData` 的**位置不归壳算**：它由 [`@morlay/zephyr-desktop-bundle`](../zephyr-desktop-bundle/README.md)
一处算出，经 `ZEPHYR_DESKTOP_USER_DATA` 递进来；壳只 `app.setPath("userData", 值)`，缺了就启动失败
（不自己拼 appData、不读第二个变量兜底）。

## 设计

- [设计 桌面壳功能面](./.agents/designs/20261111-桌面壳功能面.md)
- [设计 桌面两包：插件与壳](../zephyr-desktop-bundle/.agents/designs/20261110-桌面两包与单进程壳.md)
- [设计 桌面功能面](../zephyr-desktop-bundle/.agents/designs/20261114-desktop功能面.md)（能力边界与批次）
