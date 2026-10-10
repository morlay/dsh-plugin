# dev 形态的 profile root 就是 app 目录

状态：**已实现**（dev 两条形态按这一份装配；打包形态保持官方语义，见「打包形态不动」）
范围：dev（Electron 与 `--web`）与 app 目录的关系、装配清单的来源、dev web 入口
（[`dsh-desktop-host/src/app-boot.ts`](../../dsh-desktop-host/src/app-boot.ts) 与
[`src/web.ts`](../../dsh-desktop-host/src/web.ts)）、以及 boot 在 profile root 里留下的文件。
约束：上游 `vendor/**` 只读（本轮不改上游，因此不动 `dsh-plugin-upstream-sync` 的补丁面）；loader 的装载机制
沿用上游原语，不另起第二套启动路径；**打包形态保持官方 profile 语义**。

## 结论摘要

| 议题             | 结论                                                                                                   | 一句话理由                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| dev profile root | **app 目录本身**（Electron 与 `--web` 都一样）                                                         | 装配清单与 patch 层本来就住在 app 目录里，中间再合成一份只多一个会过期的事实                 |
| dev 安装根       | `<workspaceRoot>/node_modules/.pnpm`（零复制、零镜像）                                                 | 它的 `node_modules/` 就是扁平 store，官方闭包与前端产物都在那儿                              |
| dev 装配入口     | Electron 把 app 目录当 profile root 交给宿主（宿主按官方那两步装配）；`--web` 走 dev 专用入口          | 只有 `--web` 需要入口：上游 `dsh web` 按 profile 名到 `$DSH_HOME/profiles/<name>` 找 profile |
| dev 清单来源     | app `package.json` 的 `dsh.profile.bundles`（官方 `dsh-base` / `dsh-web-app` 也由 app 列出来）         | 两个形态必须读同一份清单，否则装配会各自漂移                                                 |
| 打包形态         | **不动**：工具生成 `seed/profiles/<name>` 的 manifest（官方 bundles 在前）、官方装配、随包 pnpm 离线装 | 见「打包形态不动」                                                                           |

## 事实基线

### dev 的两格与一份清单

启动器（`dsh-desktopify/src/cli/dev.ts`）给壳两格，壳按宿主 argv 把它们传下去：

| 形态            | profileDir         | runtimeDir                           | boot 入口                                                         | overlay                                                                          |
| --------------- | ------------------ | ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| dev（Electron） | app 目录（工作区） | `<workspaceRoot>/node_modules/.pnpm` | 宿主 `src/index.ts`（官方 `loadProfileDirectory` + `runProfile`） | `config/desktop.cordis.patch.yml` + `config/dev-client-bundles.cordis.patch.yml` |
| dev `--web`     | app 目录（工作区） | 同上                                 | `src/web.ts` → `app-boot.ts` 的 `bootAppProfile`                  | `config/dev-client-bundles.cordis.patch.yml`                                     |

`bootAppProfile` 做三件事：按 app 清单装配（同一套上游两步 + 跳过清单上报）、把形态 overlay 排在 bundle 层与
profile 自己的 `cordis.patch.yml` 之后、让 `runProfile` 每次启动重写空根 `cordis.yml`。形态名 `web` 与桌面档的
`desktop` 分开，按 profile 名门控的行才各自生效。

dev 的安装根就是工作区 pnpm store：`<runtimeDir>/node_modules/@deepseek-ai/dsh/package.json` 在那儿，且
`node --input-type=module -e "console.log(import.meta.resolve('@deepseek-ai/dsh/package.json'))"`（cwd =
`<runtimeDir>/node_modules`）解析到 `vendor/deepseek-harness/apps/cli/package.json`——即工作区源码面那份，
正是 dev 要的那份；因此不需要任何镜像或复制。启动器对这两格做存在性检查，缺锚点或缺 host 载荷时报出具体路径。

### dev 原先各自造一份 profile

- Electron：把工作区依赖镜像 + dsh 与 host 的真实副本装进 `<buildRoot>/development/project`，再生成一份
  `package.json`；
- `--web`：`dsh plugin --profile web add <pkg>@link:<dir>` 在 `$DSH_HOME/profiles/web` 造一份，再同步清单。

现在两个形态都直接用工作区里的 app 目录当 profile root。`--web` 由 `src/web.ts` 起，端口与 flag 契约与上游 web
形态一致：`PORT` 环境变量定端口（缺省 3080）、启动打印带 token 的 `dsh web:` URL、`--no-open` 不开浏览器、
`DSH_HOME` 定数据面、前端静态资源取自安装根的 `@deepseek-ai/dsh-web-frontend/dist`，认证面就是上游
`dsh-host-webserver` 那一套。`--` 之后的内层参数原样转交给 web app 的 flag family。

### dev 在 profile root 里留下的文件

| 文件                              | 谁写                               | gitignore（app 目录形态） |
| --------------------------------- | ---------------------------------- | ------------------------- |
| `cordis.yml`                      | `runProfile`（每次启动重写空根）   | 是                        |
| `compatibility.json`              | 插件版本豁免操作（设置面板 / CLI） | 是                        |
| `.plugin-manager/`                | 插件页的包操作（安装记录、日志）   | 是                        |
| `node_modules/`、`pnpm-lock.yaml` | 包操作（dev 下就是工作区的）       | `node_modules/` 已有      |

## 打包形态不动

打包走[运行时与 profile 分离且由随包 pnpm 安装](../../dsh-desktopify/.agents/adrs/20260918-运行时与profile分离且由随包pnpm安装.md)
那套官方语义：种子在 `seed/profiles/<name>`，manifest 由工具生成（官方 bundles 在前，app 自己声明的 bundle 按包名
去重后排在后面；依赖是 `file:./vendor/<name>`），`cordis.patch.yml` 是用户数据（重种豁免），随包 pnpm 离线装、
runtime `overrides` 指回随包 runtime、`installAnchor` 指 runtime 的 `@deepseek-ai/dsh`，宿主按官方那两步装配。app
的 `dsh.profile.bundles` 因此是**声明**：dev 直接读它，打包由工具按官方形态落成清单。

## 取舍

- **不重写 loader**：装配在「app 目录即 profile root」之后是数据（清单、bundle 的 patch、profile 自己的 patch、
  形态 overlay），机制仍复用上游 `loadProfileDirectory` + `runProfile`。自己实现一遍等于把上游的兼容性检查、
  跳过清单、fail-loud、关停语义全部抄一遍并跟着版本走（[宿主设计](../../dsh-desktop-host/.agents/designs/20260929-桌面host的运行时面与依赖边界.md)的「不做第二套启动路径」同一条理由）。
- **官方 bundles 写进 app 清单**：dev 两个形态没有中间产物，清单必须自足；打包那份由工具的合并（官方在前 + 去重）
  产出，两者内容一致。
- **dev 直接用源目录当 profile**：代价是插件页的安装 / 卸载会改 app 的 `package.json` 与工作区 lockfile（那正是
  「这个目录就是 profile」的语义），运行时状态因此要 gitignore。备选（dev 也种一份到 `.dsh-store/profiles/`）
  会重新引入一份会过期的副本，与本设计的目的相反。
- **只给 `--web` 加 dev 入口**：桌面形态复用官方入口 + 不同的 profileDir，就不必多一条启动路径。

## 遗留

- 上游 `loadProfileDirectory` 会对清单里出现**已退役 bundle** 的 profile 回写 `package.json`
  （`RETIRED_BUNDLES`，目前只有一条）。dev 形态下即回写源码目录里的 app 清单：只有在 app 真的列了那个包时才会发生。
- dev 下 profile root 是源目录，因此 `pnpm` 的包操作会写工作区清单与 lockfile（见「取舍」）。
