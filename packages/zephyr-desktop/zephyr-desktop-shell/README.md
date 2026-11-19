# @morlay/zephyr-desktop-shell

zephyr 桌面应用的 Electron 壳：窗口与状态、产品菜单、单实例、导航判据、preload 桥与生命周期都在这一个进程里。
由 [`@morlay/zephyr-desktop-bundle`](../zephyr-desktop-bundle/README.md) 打进应用目录；一般**不需要直接用它**。

## 它做什么

主进程入口（`dist/main.mjs`）按顺序做四件事：

1. 单实例：拿不到锁就聚焦已有窗口并退出（第二份宿主会抢同一个数据根）；
2. 补登录 shell 环境、装快捷键桥与产品菜单（开发者模式关着时没有 Reload / DevTools / Inspector 项）；
3. 开窗口（选项来自 `desktop.window`，位置与尺寸来自上次关窗的状态）；页面从**壳自己的 http 源**进——
   dev 形态是工作区的 dev server，打包形态是宿主同进程里起的 vite；
4. 关窗时存窗口状态、收桥与宿主树，然后退出。

## 形态与调试：只从环境变量来

壳的两种形态与吵闹程度**都由外部环境决定**，中间逻辑（菜单、装配、宿主）不为某个形态改分支：

| 变量                                     | 取值                       | 作用                                                                                      |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `ZEPHYR_DESKTOP_MODE`                    | `dev` / `packaged`         | dev：窗口只当浏览器，页面走工作区 dev server；packaged：页面与宿主都在随包产物里          |
| `ZEPHYR_DESKTOP_DEBUG`                   | `1` / `0`                  | 开发者模式的启动来源之一：`1` 即开（另有 `--zephyr-debug` 与 userData 下的 `debug` 标记） |
| `ZEPHYR_DESKTOP_NO_SANDBOX`              | `1`                        | 受限环境（容器/无 GPU）下关沙箱并停用硬件加速，必须在 ready 之前                          |
| `ZEPHYR_DESKTOP_URL`                     | URL                        | dev 形态加载哪个页面                                                                      |
| `ZEPHYR_DESKTOP_WORKSPACE` / `_DATA_DIR` | 路径                       | 宿主清单需要的部署值                                                                      |
| `ZEPHYR_DESKTOP_DATA_DIR_SPEC`           | `workspace` / `xdg` / 路径 | 数据根的原始写法（`desktop dev` 递进来；启动行原样报出来，壳不推断）                      |

调试面（`log` / `renderer` 受开关控制，`fail` 不受）是**开发者模式的只读投影**，实现在
[`src/debug.ts`](./src/debug.ts)；三源合并与运行期切换在下一节。

## 开发者模式与主进程 Inspector

开发者模式是一个**可切的运行时状态**，不是只读开关：三个启动来源（`ZEPHYR_DESKTOP_DEBUG=1` /
`--zephyr-debug` / `<userData>/debug` 标记文件）任一成立即为开；之后的运行期写口只有菜单里那一项
（视图 → 开发者模式，`⌘⇧D` / `Ctrl+Shift+D`），点一次即时生效并写标记（关掉就删）。

启动参数叫 `--zephyr-debug` 而不是 `--debug`：Electron 会先拿 Node 的开关表过一遍 argv，`--debug` 撞上
已废弃的 `node --debug`，进程在入口求值前就以 `[DEP0062]` 退出（真机读数），那条来源等于不存在。

打开之后视图菜单多出 Reload / DevTools /「打开主进程 Inspector」（勾选）/「复制 Inspector 地址」：
Inspector 只绑 `127.0.0.1`，缺省 9229、被占则顺延，**真实**地址进 `shell-entry.log` 与剪贴板（粘进
Chrome DevTools）；打不开（端口全占）就标灰并记一行，不弹窗也不退出。关掉开发者模式与退出应用都会关掉
它，不留监听。

| 模块                                     | 拥有                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| [`src/dev-mode.ts`](./src/dev-mode.ts)   | 三源合并、运行期切换、持久化与订阅（`DevMode`）                |
| [`src/inspector.ts`](./src/inspector.ts) | 开关主进程调试端口与地址（`InspectorPort` + `node:inspector`） |
| [`src/dev-tools.ts`](./src/dev-tools.ts) | 两者接线：关模式收端口、打不开标灰、退出收端口                 |
| [`src/debug.ts`](./src/debug.ts)         | `ShellDebug`：上面那个状态的只读投影（日志与渲染 console）     |

设计：[开发者模式与主进程 Inspector](./.agents/designs/20261117-开发者模式与主进程Inspector.md)。
**不做**跨 realm 的 CDP（上游那套 Host Worker + Client 只读 Sources）：我们只有一个主进程和一个页面。

## 启动时的路径行

壳在**把 mode 交给应用之前**打一行（stderr，不受调试面开关控制）：

```text
[desktop-shell] mode=… workspace=… profileDir=… dataDir=… dataDirSpec=… userData=… packaged=…
```

字段与 CLI 侧的 `[cli-mode]` / `[app-env]` 同名同序，两行并排就能看出三形态（`desktop dev`、打包后的 app、
`zephyr dev`）各自的装配根与缓存根为什么不同。`userData` 取 Electron 的 `app.getPath("userData")`（拿不到写 `?`），
`packaged` 是 `ZEPHYR_DESKTOP_PACKAGED=1` 的判定结果。这一行只说壳算出的值，不改解析。
实现在 [`src/deployment-line.ts`](./src/deployment-line.ts)。

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
