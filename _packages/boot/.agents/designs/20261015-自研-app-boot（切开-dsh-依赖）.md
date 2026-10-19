# 自研 app-boot：切开对 `@deepseek-ai/dsh` 的依赖

状态：**已实现**（`bootAppProfile` 与 `runProfile` 落在 `packages/boot/dsh-app-boot/src/`；落地方案见文末「落地记录」）。
范围：新建 `packages/boot/dsh-app-boot`（包名 `@morlay/dsh-app-boot`），替代
`@deepseek-ai/dsh-app-boot`（装配）与 `@deepseek-ai/dsh/profile-boot`（`runProfile`）；并迁移
`@morlay/dsh-desktop-host`、`@local/dshdev`、`@local/devkit` 的使用点。
边界见 [`AGENTS.md`](../../../../../AGENTS.md)；相关设计见
[`桌面host的运行时面与依赖边界`](../../../../desktop/dsh-desktop-host/.agents/designs/20260929-桌面host的运行时面与依赖边界.md)。

## 为什么自研

1. 我们只有两个形态（desktop / web），上游 boot 面（`app-boot` 1069 + `profile.ts` 822 +
   `profile-boot` 326 行）里的模板初始化、retired bundles 回写、version exemptions、审计细节都用不到；
2. `@deepseek-ai/dsh` 是 vendor 里的 **private 应用包**（`vendor/deepseek-harness/apps/cli`），我们依赖它
   只为它的 `./profile-boot` 一个子出口；
3. 装配与 patch 语义归我方才可控：现在"配置不生效"就发生在这一层（见下）。

## 事实基线（已核实，含出处）

| 环节                     | 出处                                                                 | 做什么                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runProfile`             | `vendor/deepseek-harness/apps/cli/src/profile-boot.ts:244`           | 装代理 → `composeProfile` → `boot` → 提交 `appReady` → 返回 `{ ctx, shutdown }`                                                                                                 |
| `composeProfile`         | 同上 `:197`                                                          | 用调用方给的 profile；`createRuntimeResolution({ installAnchor, profile })`；解析 `--patch` overlays                                                                            |
| `boot`                   | `vendor/.../boot/app-boot/src/index.ts:975`                          | `new Context()` → `ctx.baseUrl` → `provide('dshHomePath')` → 装 fail-loud → `ctx.plugin(Loader)` → `prepare(ctx)` → `mountRootInclude(root, patches)` → `loader.await()` → 审计 |
| `loadProfileDirectory`   | `vendor/.../boot/app-boot/src/profile.ts:739`                        | 清单 → `dsh.profile.bundles` → 逐个 `resolveBundleDir` → 读该包 `dsh.bundle` → `bundlePatchPaths` → `loadOverlayPatches` → layers；再读 profile 自己的 `cordis.patch.yml`       |
| 层序                     | 同上 `:739` + `composeProfile`                                       | bundles 列表顺序 → profile 用户层 → `--patch` overlays                                                                                                                          |
| **patch 应用与 id 匹配** | `mountRootInclude`（`app-boot/src/index.ts:540`）与 `PluginPackages` | **bundle 的依赖包被 insert 成行，patch 按 entry id 覆盖**；`ui-settings-general`、`locale` 这类 id 属于这一层                                                                   |

最后一行是当前 bug 的现场：`mydsh-profile` 的 patch 写法（`- id: locale` 等）与官方 patch 同构，生效与否
取决于 insert 出来的 entry id —— 自研这一层之后，规则归我们，测试可以直接钉住它。

## 新包的出口（接缝）

```ts
// —— profile 组装（替代 loadProfileDirectory / loadLayeredEnv）
interface ProfileLayer {
  packageName: string;
  packageDir: string;
  patchPaths: string[];
  patches: PatchOptions[];
}
interface Profile {
  name: string;
  dir: string;
  layers: ProfileLayer[];
  patchPath: string;
  patches: PatchOptions[];
  skippedBundles: SkippedBundle[];
}
function loadProfile(binName: string, profileDir: string): Profile;
function readProfilePatches(profileContext: ProfileContext, profile: Profile): PatchOptions[];
// —— 外壳（替代 runProfile）
interface RunProfileOptions {
  profile: string;
  profileDir: string;
  patchFiles: readonly string[];
  args: readonly string[];
  packageManager?: PackageManager;
}
function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: Shutdown }>;
// —— 元数据（check-locale / devkit 用，替代 readPluginMeta）
function readPluginMeta(name: string, manifestUrl: string): PluginMeta | undefined;
```

## 要 provide 的服务面（上游 app 行 inject 的，少了就 pending）

| 服务                                             | 谁 inject                                                                     | 自研怎么给                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `dshHomePath`                                    | 各行的 `!!js` 配置与路径解析                                                  | 自己 provide（`$DSH_HOME` 解析器）                                                            |
| `cmdlineArgs` / `appExit` / `appReady`           | `vendor/deepseek-harness/packages/bundle/web-app/src/startup.ts`、headless 等 | **继续用** `@deepseek-ai/dsh-cmdline` 的 `provideCmdline`（契约由这些消费方定义，复刻无收益） |
| `launchEnvironment`（key = `launchEnvironment`） | credentials-local、open-in-app、web-app                                       | **继续用** `@deepseek-ai/dsh-launch-environment`                                              |
| `profileContext`                                 | 我们的桌面 patch 行与 web 行                                                  | 自研 provide                                                                                  |
| `loader`                                         | loader 插件自身                                                               | cordis 的 `@deepseek-ai/cordis-plugin-loader`（借）                                           |

即：**借 cordis 的 Loader/include/group 与两个小包（cmdline / launch-environment），自研组装与外壳**。

## 明确不做（YAGNI）

- 不重写 cordis 的 Loader / include / group；
- 不实现 `installAnchor`：完整闭包就在 profile，锚点即 profile 的清单；
- 不做 profile 模板初始化（`initProfile` / `PROFILE_TEMPLATES`）、不回收 retired bundles、不做 version
  exemptions —— 我们无对应需求；遇到即报错，不静默跳过；
- 不做 `--dump-config` 那一族诊断出口。

## 验收

1. **单测**：profile 组装（fixture bundle：`patch` 为字符串 / 数组、缺 `dsh.bundle` 必报错、层序正确）；
   `runProfile` 起一棵最小 cordis 树（fixture：一个 insert 行 + 一个 patch 覆盖它，断言 config 真的生效）
   —— 这条测试必须在"patch 按 id 覆盖失效"时失败，它就是那条覆盖语义的回归网。
2. **本地**：`dshdev web --prod` 起得来且页面 200；`dshdev desktop --prod` 同。

## 与上游的分工

`PluginPackages`（依赖包 → entries 的推导）与 `mountRootInclude` 这两层继续用上游——不复刻它们，bundle 的
`dependencies` 就不会成为行、官方 bundles 直接失效：

- 借上游 `@deepseek-ai/dsh-app-boot` 的 `boot` / `loadProfileDirectory` / `readProfilePatches` /
  `createRuntimeResolution` / `loadOverlayPatches` / `installFailLoud` / `PluginPackages`（公开包，可依赖）；
- 自研只有**组合与外壳**：层序、要 provide 的服务面（`profileContext` 在自研侧，`cmdlineArgs`/`appExit`/
  `appReady` 继续用 `dsh-cmdline` 的 `provideCmdline`）、fail-loud 接线与本包自带的
  [`有界退出控制器`](../../src/process-shutdown.ts)；
- 于是对 `@deepseek-ai/dsh`（vendor 里那个 private 的 `apps/cli`）的依赖归零，而"哪一层生效"的规则仍在上游
  那一层——若将来要改 patch 与 insert 的 id 匹配语义，那才是需要动 `boot` 那一步的时候。
