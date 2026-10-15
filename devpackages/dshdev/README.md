# @local/dshdev

把任意 dsh 工作区打包 / 运行为桌面应用的工具：`dev` 链接工作区直接跑，`bundle` 产出静态、无签名的应用目录。

本包只做**工具**（CLI）：壳是独立的 [`@morlay/dsh-desktop-shell`](../../packages/desktop/dsh-desktop-shell/README.md)——`dev` 以它的
包目录为 Electron app 启动，`bundle` 把它的 `dist/` 复制成最小壳目录；后端是独立变体
[`@morlay/dsh-desktop-host`](../../packages/desktop/dsh-desktop-host/README.md)，本包以 `dependencies` 引用它。

## 用法

| 命令                                                     | 作用                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `dshdev web [--data-dir <spec>] [--prod] [workspace]` | 在浏览器里跑 `dsh web`（页面与资源走宿主自己的 http 端口） |
| `dshdev desktop [--data-dir <spec>] [--prod] [workspace]` | 启动 Electron 壳（不打包） |
| `dshdev desktop bundle [--dir] [--install] [workspace]` | 构建当前平台的静态、无签名桌面应用 |
| `dshdev check-deps [package]` | 从一个包的入口扫出它运行期 import 的包，报**没在自己清单里声明**的那些（非零退出） |

`--prod`：起之前先装配**打包形态的解析面**（`pnpm deploy` 的闭包，deploy 目录同时当 profile 与 runtime），
再让 web 跑在它上面——闭包内容、依赖解析面与真打完包一致，于是不必等一轮打包就能验证打包形态的问题
（闭包缺依赖、清单不对）。`--prod` 下前端装配在 profile bundles 里，不再挂 dev 形态那份 `--patch`。

`$DSH_HOME` 两种形态的**缺省有意不同**：dev 落在工作区里的 `.dsh-store`，打包形态落在系统应用数据目录
（macOS 的 `~/Library/Application Support/<name>`）——开发不污染稳定版本的数据。要对齐两边用 `--data-dir=xdg`。

工作区取首个位置参数（缺省当前目录）。装配输入是工作区 `package.json` 的 `dsh` 段：`version`（`@deepseek-ai/dsh`
的依赖 spec）、`profile.bundles`（必填）、`desktop.{id,name,icon,dshHome,window}`——`desktop.name` 是桌面应用的
对外名字（缺省用工作区包名），产物名、macOS 的 `.app`、Linux 启动器条目与退出确认都用它；字段语义与实例见
[设计 桌面化工具](./.agents/designs/20260917-桌面化工具.md)与
[`apps/dsh-custom-next/package.json`](../../apps/dsh-custom-next/package.json)。

```sh
pnpm exec dshdev desktop        # 本仓库示例工作区：just custom dev
pnpm exec dshdev web            #                  just custom web
pnpm exec dshdev desktop bundle --dir  #       just custom bundle
```

前置条件：pnpm workspace、`vendor/deepseek-harness` 已构建（`just prepare`）、工具 / 壳包 / 后端变体都已
`pnpm build`。
