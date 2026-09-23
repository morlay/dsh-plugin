# @morlay/dsh-desktopify

把任意 dsh 工作区打包 / 运行为桌面应用的工具：`dev` 链接工作区直接跑，`bundle` 产出静态、无签名的应用目录。

实现机制（壳与 host 协议、依赖闭包与种子指纹、profile 安装、XDG 路径与 shell 注入）见
[设计 桌面化工具](./.agents/designs/20260917-桌面化工具.md)；自研离线打包器（而非直接用上游桌面应用）的决策见
[ADR-20260917-自研离线桌面打包器而非直接用上游桌面应用](../../../.agents/adrs/20260917-自研离线桌面打包器而非直接用上游桌面应用.md)。

## 命令

| 命令                                                     | 作用                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `dsh-desktopify dev [--web] [--home <spec>] [workspace]` | 启动 Electron 壳（不打包）；`--web` 改为在浏览器里跑 `dsh web`；`--home` 换数据面 |
| `dsh-desktopify bundle [--dir] [--install] [workspace]`  | 构建当前平台的静态、无签名桌面应用                                                |

工作区取首个位置参数（缺省当前目录），CLI 会把它写进 `DSH_DESKTOP_WORKSPACE`；工具内不写死任何 app 路径或名字。dev 两种形态的数据面共用工作区的 `.dsh-store`（`DSH_HOME`；profile 名 `desktop` / `web` 互不冲突），只有 Electron 的浏览器数据落在构建目录 `<workspace>/node_modules/.dsh-desktopify/development/electron-user-data`。

`--home <spec>` 把数据面换到别处，取值与工作区的 `dshHome` 配置同构（解析只有一份，见 [`src/dshhome.ts`](./src/dshhome.ts)）：

| `--home` | 数据面                                               |
| -------- | ---------------------------------------------------- |
| 缺省     | `<workspace>/.dsh-store`（工作区内，与打包形态隔离） |
| `xdg`    | 打包形态那同一个目录（`<平台数据目录>/<app 名>`）    |
| `env`    | 环境里的 `DSH_HOME`（没设就 fail loud）              |
| 绝对路径 | 原样使用                                             |

「打包形态才复现」的问题（如内存增长）用 `just custom dev --home=xdg` 就能让 dev 跑真实数据；`DSH_APP_DSH_HOME` 仍是壳里的最高优先覆盖。
壳产物由 `pnpm build` 生成，dev / bundle 只校验它在，不重建——源码形态下产物比源码旧会打印警告（改了壳没重建的话，
打包出来的 app 跑的还是旧壳）。随包 Node / pnpm 载荷的准备与校验、profile 种子生成是 `bundle` 的内部步骤，
不单独暴露命令。本仓库示例工作区：`just custom desktop`（dev）/ `just custom bundle`（打包）。

## 工作区契约（package.json）

```jsonc
{
  "name": "dsh-custom",
  "version": "0.1.5", // 应用版本（electron-builder product version）
  "private": true,
  "dependencies": { "@morlay/better-session": "^0.0.17" },
  "dsh": {
    "version": "0.1.5-rc.1", // @deepseek-ai/dsh 的依赖 spec：具体版本或 workspace:
    "profile": { "bundles": ["@morlay/better-session"] },
    "desktop": {
      "id": "ai.deepseek.dsh.custom",
      "icon": "icon.svg",
      "dshHome": "xdg",
    },
  },
}
```

`name` 除作为 electron-builder 的 productName，还决定壳对外自称的两处标识：页面的自定义协议
（`<name>://app/`，去 scope 前缀、非法字符换成 `-`）与后端 host 子进程在 `ps` 里的名字
（`<name>-server`），见[设计 桌面标识取自 app 名](./.agents/designs/20260921-桌面标识取自app名.md)。

`dsh.version` 是 `@deepseek-ai/dsh` 的依赖 spec：仓库内项目可配 `workspace:*`（从 vendor 源码解析），
仓库外项目配具体版本（从 registry 安装）；缺省时回退到工作区已解析的 dsh 版本。配 `workspace:` 时工具不把它落成
版本号（本地源码可能尚未发布），而是指向解析到的包目录。打包时工作区没有的官方包（实验包这类）按这个版本钉住
装进部署项目；`workspace:` 与缺省 dsh.version 都不行时，只能靠工作区自己装齐官方包。

## 环境变量

| 变量                              | 作用                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DSH_DESKTOP_WORKSPACE`           | 目标工作区（位置参数会写入）                                                                                                                        |
| `DSH_DESKTOP_NODE_BINARY`         | dev / 打包后 host 使用的 node 可执行文件                                                                                                            |
| `DSH_DESKTOP_APPCONFIG_DIR`       | 覆盖 `appconfig.json` 所在目录（dev / 测试）                                                                                                        |
| `DSH_DESKTOP_SEED_DIR`            | 覆盖 profile 种子目录（dev / 测试）                                                                                                                 |
| `DSH_DESKTOP_DEV_PROJECT_DIR`     | 覆盖 dev 临时项目目录                                                                                                                               |
| `DSH_DESKTOP_PRIMARY_RUNTIME_DIR` | 覆盖 host argv[4] 的载荷源目录（见[债务 20260918-桌面未随包primary-runtime载荷](../../../.agents/debts/20260918-桌面未随包primary-runtime载荷.md)） |
| `DSH_DESKTOP_TSX_IMPORT`          | dev 启动器写入的 tsx loader spec（无 tsx 时为空）                                                                                                   |
| `DSH_DESKTOP_OPEN_DEVTOOLS`       | dev 是否自动打开 DevTools（默认 `1`，置 `0` 关闭）                                                                                                  |
| `DSH_DESKTOP_HOST_INSPECT_PORT`   | host 调试端口（默认 9230）                                                                                                                          |
| `DSH_DESKTOP_MAIN_INSPECT_PORT`   | 主进程调试端口（默认 9229）                                                                                                                         |
| `DSH_DESKTOP_RENDERER_DEBUG_PORT` | 渲染进程调试端口（默认 9222）                                                                                                                       |
| `DSH_DESKTOP_TARGET_PLATFORM`     | bundle 随包载荷的目标平台（默认当前平台；只有构建主机平台能打，见「已知行为」）                                                                     |
| `DSH_DESKTOP_TARGET_ARCH`         | bundle 随包载荷的目标架构（同上）                                                                                                                   |
| `DSH_DESKTOP_DIAGNOSTIC_FILE`     | 壳启动失败时把错误栈写入该文件                                                                                                                      |
| `DSH_APP_DSH_HOME`                | 覆盖运行时 `DSH_HOME`（优先于 `dshHome` 配置）                                                                                                      |

## 前置条件

- pnpm workspace（dev 依赖 `findWorkspaceRoot` 装配临时项目；bundle 依赖 `pnpm deploy` 导出 app 闭包，
  工具不改写工作区清单 / lockfile）。
- `vendor/deepseek-harness` 已构建（`just vendor prepare`：dev 需要 dsh CLI；后端变体
  [`@morlay/dsh-desktop-host`](../dsh-desktop-host/README.md) 运行期从部署载荷的 `node_modules` 解析上游
  `@deepseek-ai/*` 包）。
- 工具与后端变体都已构建（`pnpm build`）：dev / bundle 用 `@morlay/dsh-desktop-host` 的 `lib/index.js`。
- 前端静态资源来自闭包内 `@deepseek-ai/dsh-web-frontend/dist`（`dsh` → `dsh-web-app` 的传递依赖），
  壳按 `<runtimeDir>/node_modules/@deepseek-ai/dsh-web-frontend/dist` 读取。

## 产物布局（打包形态）

`Resources/` 下两棵互不覆盖的树：

- `runtime/`：随包运行时——`node/`（随包 Node）、`pnpm/bin/pnpm.mjs`（随包 pnpm 的入口，壳把它作为 host
  argv[6] 交给 `profileContext.packageManager`；该 npm 包只是 wrapper，入口会 spawn 同平台
  `@pnpm/exe.<platform>-<arch>` 的原生二进制，所以载荷带上那个平台包）、`bin/`（pnpm 子进程的 `PATH`
  前置目录，Unix 下是指向 `../node/node` 的相对链接）、`appconfig.json`、`versions.json`；
- `seed/`：`runtime/`（不可变闭包 = host 的 dsh 安装锚点与前端静态资源）+
  `profiles/desktop/`（初始 profile：app 自己的 bundle 以 `file:` 指向 `vendor/` 副本、`pnpm-workspace.yaml`、
  `desktop-runtime-packages.json`、`.seed-hash`）。

用户的 `DSH_HOME` 只放 profile（`profiles/<name>`）：种出 / 替换后由壳用随包 pnpm 离线安装它，官方包与 dsh
始终取自 `seed/runtime`。替换逻辑只对 profile 的 `cordis.patch.yml` 豁免——它是用户数据（settings 面板写在那里），
重种时把用户那份读出来、种完放回去。

## 已知行为

- **首次启动会安装 profile**：种子指纹变化时，壳在启动 host 前用随包 pnpm 在 profile 里跑一次
  `install --prod --ignore-scripts --offline`——依赖全是 `file:` 源与指向 runtime 的 `link:` 覆盖，不需要网络。
  插件页的安装 / 卸载 / 启停使用同一个随包 pnpm（`<resources>/runtime/pnpm/bin/pnpm.mjs`）。
- **跨平台打包被拒绝**：随包 pnpm 的载荷只含构建主机平台的 `@pnpm/exe` 二进制，
  `DSH_DESKTOP_TARGET_PLATFORM` / `DSH_DESKTOP_TARGET_ARCH` 指向别的平台时 `bundle` 在写入前失败
  （`desktop runtime: bundled pnpm carries the <host> native binary, which cannot serve <target>`）。
- **启动即静默退出**（残留 `SingletonLock`，无输出、退出码 0）：清掉 `<userData>/Singleton*` 即可恢复；
  机制见 [设计 桌面化工具](./.agents/designs/20260917-桌面化工具.md)。
