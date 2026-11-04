# 随包布局：app 进 asar，宿主依赖住 runtime

状态：**已实施**（宿主改用 Electron 的 node + 开 asar；搬运 runtime 那一步经实测不必做，见文末）。
范围：打包产物 `Contents/Resources/` 的分工，以及"谁能读 asar"这条判据。

## 判据：谁在读

| 读者                                                                   | 读法                                       | 能不能读 asar                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Electron 主进程**（壳自己的代码与它 `require` 的包）                 | `require` / `fs`，走 Electron 的 asar 补丁 | **能**（asar 内是透明路径）                                                             |
| **宿主的 node 子进程**（`@morlay/dsh-desktop-host` 及其依赖）          | 独立进程，`import` 真文件                  | **能——只要它自己也是 Electron 二进制**（`ELECTRON_RUN_AS_NODE=1` 下 asar 补丁照样注入） |
| **外部命令**（`tar` 解压、`node pnpm.mjs`、`spawn` 出来的 shell 工具） | 系统可执行文件                             | **不能**（asar 内不是真文件）                                                           |
| native 模块（`*.node`，`dlopen`）                                      | 需要真文件                                 | **不能** → 必须 `asarUnpack`                                                            |

上游就是这么切的（`vendor/deepseek-harness/apps/desktop/src/main.ts:154`、`node-environment.ts:15`、
`host-process.ts:188`）：**宿主用 Electron 二进制当 node**（`const node = process.execPath` + `ELECTRON_RUN_AS_NODE=1`），
**宿主入口住在 `runtime/node_modules/…`**（不在 app 内）。于是 app 里只剩壳自己，整包可进 asar。

## 目标布局

```
Contents/Resources/
  app.asar                壳（Electron 主进程读；含它 require 的包）
  app.asar.unpacked/      只放 native（`**/*.node`）
  runtime/
    node_modules/         宿主入口 + 宿主的全部依赖（宿主用 Electron 的 node 读，app 外，真文件）
    pnpm/ loader/ bin/    工具链；**不再随包 node**（用 Electron 自带的那个）
  seed/
    profile-node-modules.tar   profile 的依赖面（首启/升级解压；外部 tar 读，必须在 app 外）
```

## 我们现在的偏差（就是"15053 个文件"的根）

1. 壳起宿主的 `node` 用的是**随包 node**（`Resources/runtime/node/bin/node`）——上游用 `process.execPath`；
2. 宿主的**入口与依赖住在 `Resources/app/node_modules`**（壳用 `createRequire(import.meta.url)` 解析）——
   于是这一整棵依赖树都必须 `asarUnpack` 出去，asar 只能装下 app 顶层那 6 个条目，收益为零；
3. 打包配置里 `asar: false`（当时的理由是"Electron 在归档里的模块解析面更窄"——那条在"宿主也在 asar 外、
   且用真文件"时成立；宿主改用 Electron 的 node 之后它不再成立）。

## 落地（两步，实测）

1. **宿主改用 Electron 的 node**：壳起宿主时 `node = process.execPath`、env 补 `ELECTRON_RUN_AS_NODE: "1"`。
   于是随包不再需要一份 node，而且 **asar 补丁对宿主照样生效**——这是"app 能整块进 asar"的前提。
2. **开 asar**：`asar: true` + `asarUnpack: ["**/*.node"]`（native 要真文件给 `dlopen`；其余全在归档里）。

**原计划的第 2 步（把宿主依赖面搬到 runtime）不需要**：那是"宿主读不了 asar"时的补救；宿主既然跑在 Electron
上，入口与它的整棵依赖树都能留在 `app.asar` 内（上游把宿主放在 runtime 里，是因为它的宿主用的是**随包 node**）。

实测（`dshdev desktop bundle --dir`，同一个 app）：

| 项                                  | 改动前 | 改动后                                                                     |
| ----------------------------------- | ------ | -------------------------------------------------------------------------- |
| `Resources/app/node_modules` 文件数 | 15087  | **0**（整块进 `app.asar`，111 MB）                                         |
| `app.asar.unpacked`                 | —      | 758 个文件（其中 6 个 `*.node`）                                           |
| 整个 .app 的文件数                  | ~15800 | **1724**                                                                   |
| 体积                                | 1.2 G  | 1.2 G（asar 不压缩；省的是**文件数**，也就是 Electron 冷启动要读的小文件） |

决定性验证（不需要 GUI）：`ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/<app> -e "readFileSync('<Resources>/app.asar/node_modules/@morlay/dsh-desktop-host/src/index.ts')"`
→ 读到 5860 字节，正是宿主的入口源码。

## 为什么不用 "pnpm store + offline 硬链"（实测排除）

想法很自然：随包带一份 pnpm store，首启在 profile 里 `pnpm install --offline`，让 pnpm 从 store **硬链**
（它平时装包就是硬链，秒级）。实测（`pnpm fetch --prod --store-dir /tmp/store-probe`，用的是 deploy 的
lockfile）：

|        | 现状（tar） | store 方案 |
| ------ | ----------- | ---------- |
| 体积   | 465 MB      | **1.5 GB** |
| 文件数 | 105171      | 91364      |

store 是内容寻址、已经去过重的，仍旧 1.5 G / 9.1 万文件。而首启的耗时是**写文件**（同一个 tar 实测
`real 56.4s / user 4.9s / sys 49.1s`——CPU 只花 5 秒，49 秒在内核写元数据），文件数只少 13% 等于几乎不提速，
体积却翻三倍。**所以这条不做**：真要再快只有"不落盘"（clonefile / 硬链），而它们要么平台专属（APFS），
要么跨卷就退化成拷贝。

首次落盘 ~1 分钟**可以接受**——它只在升级后第一次发生（指纹一致时直接跳过）。真正要防的是"**每次都慢**"，
那是 Electron 冷启动面对 1.5 万个散文件的问题，已由"app 整块进 asar"解决（→ 1724 个文件）。

## profile 的解析面怎么随包（三处实测踩过的坑）

闭包要落在 `Resources/profile`，但这三件事都不通：

| 试过的                                                    | 结果                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extraResources: { from: <deploy>, to: "profile" }`       | 目录建了、非 `node_modules` 的文件也拷了，**唯独 `node_modules` 是空的**——electron-builder 的默认忽略规则含 `**/node_modules/**`，显式 `filter: ["**/*"]` 覆盖不掉 |
| `pnpm deploy --node-linker=hoisted`                       | `ERR_PNPM_CANNOT_DEPLOY`：hoisted 会解析依赖的真实路径，而 lockfile 里有指向 workspace 之外的 `file:` 依赖（在 `vendor` 那份工作区里），pnpm 判定"不安全路径"拒绝  |
| `afterPack` 里用 `context.packager.projectDir` 当工作区根 | 那是壳的装配目录（`.dshdev/shell`），`pnpm deploy` 在那里写过 `pnpm-workspace.yaml`，于是它被当成工作区根 → 同样报"路径在工作区之外"                               |

**落定的做法**：`afterPack` 里调 **`deployClosure(appWorkspace, name, <Resources>/profile)`** ——
`appWorkspace` 是**真的 app 目录**（由 `buildDesktopConfig` 的入参传进来，不能用打包器的 projectDir）；
`deployClosure` 用默认 linker（isolated，顶层是指进 `.pnpm` 的链接）**再挂平顶层**，所以不需要 `hoisted`，
也不经过 electron-builder 的拷贝。

实测（`--dir` 产物）：`Resources/profile/node_modules` 顶层 **661** 个；用 Electron 的 node 以
`Resources/profile` 下的清单为锚点解析 9 个 bundle **全部 OK**。
Node internal 模块的读取在 Electron 45 上走 `--expose-internals` 的 `require`（壳给宿主的命令行恒带该开关；
`node-addon-require-builtin@0.1.9` 的 V8 指纹表只到 Electron 44.7，指纹不匹配时 addon 拒绝服务），
所以 Electron 版本不再被指纹钉住——运行时解析那一处由
[本地补丁](../../../../vendor/patches/expose-internals-internal-modules.patch)对齐 Loader/HMR 的顺序。

## 还没做的（下一步）

- `runtime/node`（随包 node，~100 M）现在没人用了，可以从 `prepare-runtime` 的下载装配里去掉；
- `seed`（444 M 的 tar）仍占整体的大头，且只在首启/升级时用——"移出 .app"是另一件事；
- 宿主启动耗时里那 100 秒是"重种"（解压 465 MB tar）花的，与 asar 无关，见
  [`profile 种子`](../../../../packages/desktop/dsh-desktop-shell/src/seed.ts) 那条线。
