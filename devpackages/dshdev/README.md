# @local/dshdev

把任意 dsh 工作区跑成（或打包成）桌面应用的工具：`web` 起浏览器形态，`desktop` 起 Electron 壳，`desktop bundle`
产出静态、无签名的应用目录。

本包只做**工具**（CLI）：壳是独立的 [`@morlay/dsh-desktop-shell`](../../packages/desktop/dsh-desktop-shell/README.md)——`desktop` 以它的
包目录为 Electron app 启动，`desktop bundle` 把它的 `dist/` 复制成最小壳目录；后端是独立变体
[`@morlay/dsh-desktop-host`](../../packages/desktop/dsh-desktop-host/README.md)，本包以 `dependencies` 引用它。

## 用法

| 命令                                                      | 作用                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `dshdev web [--data-dir <spec>] [--prod] [workspace]`     | 在浏览器里跑 `dsh web`（页面与资源走宿主自己的 http 端口）                         |
| `dshdev desktop [--data-dir <spec>] [--prod] [workspace]` | 启动 Electron 壳（不打包）                                                         |
| `dshdev desktop bundle [--dir] [--install] [workspace]`   | 构建当前平台的静态、无签名桌面应用                                                 |
| `dshdev check-deps [package]`                             | 从一个包的入口扫出它运行期 import 的包，报**没在自己清单里声明**的那些（非零退出） |

`--prod`：起之前先装配**打包形态的解析面**（`pnpm deploy` 的闭包，deploy 目录同时当 profile 与 runtime），
再让 web 跑在它上面，于是不必等一轮打包就能验证打包形态的问题（闭包缺依赖、清单不对）。`--prod` 下前端装配在
profile bundles 里，不再挂 dev 形态那份 dev-only bundle。

`$DSH_HOME` 的缺省按形态不同：dev 落在工作区里的 `.dsh-store`，打包形态落在系统应用数据目录（macOS 的
`~/Library/Application Support/<name>`）；要对齐两边用 `--data-dir=xdg`。

工作区取首个位置参数（缺省当前目录）。装配输入是工作区 `package.json` 的 `dsh` 段——字段语义、目录取值与
形态 × 槽位见[设计 数据与工作目录的 layout](./.agents/designs/20261014-数据与工作目录的-layout.md)，实例见
[`apps/dsh-custom-next/package.json`](../../apps/dsh-custom-next/package.json)。

```sh
pnpm exec dshdev desktop        # 本仓库示例工作区：just custom dev
pnpm exec dshdev web            #                  just custom web
pnpm exec dshdev desktop bundle --dir  #       just custom bundle
```

前置条件：pnpm workspace、`vendor/deepseek-harness` 已构建（`just prepare`）、工具 / 壳包 / 后端变体都已
`pnpm build`。另外，工作区装了 `@deepseek-ai/dsh-experimental-cua-macos`（经 `dsh-cua-bundle`）时，还需要它
的 native 载荷：上游把 `native/bin/` 加进了 `.gitignore`，源码树里 dev 是现场编译，而**打出来的闭包**只认那份
发布产物（`native/bin/darwin-<arch>/current.json`）。`just prepare` 会在 macOS + Xcode 的机器上顺带产出
（`cua-native` 步骤，别的平台跳过；单独跑用 `just native-cua`）；缺它时 `desktop bundle` 直接报错，不会产出
打不开的包。
