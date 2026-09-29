# @morlay/dsh-desktopify

把任意 dsh 工作区打包 / 运行为桌面应用的工具：`dev` 链接工作区直接跑，`bundle` 产出静态、无签名的应用目录。

本包只做**工具**（CLI）：壳是独立的 [`@morlay/dsh-desktop-shell`](../dsh-desktop-shell/README.md)——`dev` 以它的
包目录为 Electron app 启动，`bundle` 把它的 `dist/` 复制成最小壳目录；后端是独立变体
[`@morlay/dsh-desktop-host`](../dsh-desktop-host/README.md)，本包以 `dependencies` 引用它。

## 用法

| 命令                                                     | 作用                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `dsh-desktopify dev [--web] [--home <spec>] [workspace]` | 启动 Electron 壳（不打包）；`--web` 改为在浏览器里跑 `dsh web`；`--home` 换数据面 |
| `dsh-desktopify bundle [--dir] [--install] [workspace]`  | 构建当前平台的静态、无签名桌面应用                                                |

工作区取首个位置参数（缺省当前目录）。装配输入是工作区 `package.json` 的 `dsh` 段：`version`（`@deepseek-ai/dsh`
的依赖 spec）、`profile.bundles`（必填）、`desktop.{id,icon,dshHome,window}`——字段语义与实例见
[设计 桌面化工具](./.agents/designs/20260917-桌面化工具.md)与
[`apps/dsh-custom-next/package.json`](../../../apps/dsh-custom-next/package.json)。

```sh
pnpm exec dsh-desktopify dev            # 本仓库示例工作区：just custom desktop
pnpm exec dsh-desktopify bundle --dir   #                  just custom bundle
```

前置条件：pnpm workspace、`vendor/deepseek-harness` 已构建（`just vendor prepare`）、工具 / 壳包 / 后端变体都已
`pnpm build`。
