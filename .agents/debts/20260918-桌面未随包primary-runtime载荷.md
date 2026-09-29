# 桌面未随包 primary runtime 载荷

状态：未销账（`load_workspace_dependencies` 工具在桌面形态下必然失败：payload 目录不存在）

**现象**

desktop-host 把 argv[4] 当 bundled 依赖载荷源交给本变体的 Office 组合
（`packages/desktop/dsh-desktop-host/src/office.ts`），后者把 `{source, root}` 传给官方
`@deepseek-ai/dsh-tool-workspace-dependencies`（`packages/skill/tool-workspace-dependencies/src/index.ts`）：
`load_workspace_dependencies` 首次被调用时 `installPrimaryRuntime(source, root)` 读 `<source>/runtime.json`
（`readPrimaryRuntime` / `compatibleManifest`），把 payload 装到
`<root>=<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`，并返回 Python / numpy / pandas / Node / pnpm 的绝对路径。

我们的壳把 argv[4] 指到 `<resources>/runtime/primary-runtime`
（`packages/desktop/dsh-desktop-shell/src/index.ts` 的 `runtimeResources()`；dev 由
`DSH_DESKTOP_PRIMARY_RUNTIME_DIR` 覆盖，见 `packages/desktop/dsh-desktopify/src/cli/dev.ts`；host 侧的缺省是
`<runtimeDir>/../runtime/primary-runtime`，见 `packages/desktop/dsh-desktop-host/src/index.ts`），
但 `dev` / `bundle` 都不生成这个目录：

```
$ ls apps/dsh-custom-next/node_modules/.dsh-desktopify/runtime
appconfig.json  bin  node  pnpm  versions.json
```

上游自己的 `vendor/deepseek-harness/apps/desktop/scripts/prepare-primary-runtime.ts` 要下载平台 Python（含 numpy /
pandas / python-docx 等 wheel）与 pnpm，并做 smoke 执行；我们没走这一步。

`office-skills` 资源同样**不随包**：本变体不挂 `officeSkills`（见
[设计 桌面化工具](../../packages/desktop/dsh-desktopify/.agents/designs/20260917-桌面化工具.md) 的「随包运行时载荷」）。
宿主自己的包操作用 pnpm 已随包（`<resources>/runtime/pnpm/bin/pnpm.mjs` + `<resources>/runtime/bin`，由 shell 经
host argv[5]/[6] 交给 `profileContext.packageManager`），但那是宿主包操作的入口，与本 payload 的
`dependencies/{python,node,pnpm}` 不是同一份。剩余缺口只有 `primary-runtime` payload 本体
（`runtime.json` + python / node / pnpm）。

**影响**

桌面会话里调用 `load_workspace_dependencies` 工具会以 `primary runtime: ...` 的 ENOENT /
`readPrimaryRuntime` 报错失败（安装是惰性的，**不阻塞 Host 启动**）。撞上的是让模型用 bundled
Python 处理脚本类任务的用户；其余会话不受影响。

**触发条件**

动到 bundled Python / pnpm 依赖装载、或需要桌面形态与官方桌面在 Office / 脚本能力上对齐之前。

**销账条件**

Done when：`dev` 与 `bundle` 产物里都有可用的 `primary-runtime` payload（`runtime.json` +
`dependencies/{python,node,pnpm}`），且 `load_workspace_dependencies` 返回的路径可执行通过
上游 `smokePrimaryRuntime` 同等的检查。

眼下未达成：产物仍是
`apps/dsh-custom-next/node_modules/.dsh-desktopify/runtime` = `appconfig.json bin node pnpm versions.json`
（无 `primary-runtime/`）；上游那条下载 + smoke 线（`vendor/deepseek-harness/apps/desktop/scripts/prepare-primary-runtime.ts`）
我们未走。

**不修的理由**

payload 是几十到上百 MB 的平台资产（上游单独跑下载 + 校验 + smoke），当前桌面化目标是「能跑
morlay 的会话插件」；随包 Node 已经从 Node 官方 SHASUMS 校验下载，再加一条 Python 载荷线属于
另一件事。缺了只影响一个工具，且失败是显式的。
