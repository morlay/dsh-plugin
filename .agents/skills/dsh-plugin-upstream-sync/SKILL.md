---
name: dsh-plugin-upstream-sync
description: 跟随上游 deepseek-harness（dsh）演进、开发插件集合时用——同步上游到指定提交（DEEPSEEK_HARNESS_VERSION / REVISION）、EXCLUDE 裁剪与本地 patch、构建完整上游、升级与适配评估、排查上游行为；从零搭建的 workspace 对齐与初始化也在这里
disable-model-invocation: true
---

# 上游同步（upstream-sync）

以 side workspace 形态基于上游 deepseek-harness（dsh）开发 cordis 插件集合：
上游以完整 git 仓库 vendor 到 `vendor/<name>/`（保留 `.git`），经 git 同步锁定到
指定提交，构建完整上游；插件包以 `workspace:*` 引用其源码。为什么这样做、否掉了哪些路线，见
`ADR-上游以side-workspace版本锁定完整代码而非发布版本`（根 `.agents/adrs/`）与
`ADR-workspace跨vendor链接与devkit工具链复用`。

上游是**锁版本的只读源码副本**——版本常量与 vendor 路径在 `mise.toml`，只读红线与
发布纪律见 [`AGENTS.md`](../../../AGENTS.md)；插件只在自己的包里适配它。

```
<your-repo>/
├── vendor/<upstream>/       # 上游完整 git clone（保留 .git）
├── packages/<plugin-pkg>/   # 插件包（workspace:* 引用上游，见扩展面清单）
├── patches/                 # steps.json + *.patch（被脚本读取，仓库维护）
├── pnpm-workspace.yaml      # 对齐上游 + 三个 workspace 配置（见初始化）
└── 版本变量配置               # 如 mise.toml：DEEPSEEK_HARNESS_*
```

skill 自带脚本 `scripts/{sync,patch,build}.ts`，用 **`tsx` 执行**（勿用
`pnpm exec`：node_modules 缺失时会触发隐式 install，下载已裁剪依赖）：

| env                                                   | 含义                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `DEEPSEEK_HARNESS_DIR`                                | 上游目录，**相对 workspace 根**（pnpm-workspace.yaml 所在目录） |
| `DEEPSEEK_HARNESS_VERSION`                            | 目标版本（tag `dsh-v{version}` 优先，回退同名 branch）          |
| `DEEPSEEK_HARNESS_REVISION`                           | 可选，特定 commit / 短 sha，**优先于 VERSION**                  |
| `DEEPSEEK_HARNESS_EXCLUDE`                            | 可选，逗号分隔待裁剪包目录完整相对路径（相对上游根）            |
| `DEEPSEEK_HARNESS_PATCHES`                            | 可选，patches 根目录（默认 `<workspace 根>/patches`）           |
| `DEEPSEEK_HARNESS_STEPS`                              | 可选，steps.json 路径（默认 `<patches>/steps.json`）            |
| `DEEPSEEK_HARNESS_REPO` / `DEEPSEEK_HARNESS_NO_CLEAN` | 可选                                                            |

## 初始化：对齐 workspace（一次性）

1. **完整 clone 上游**（保留 .git）：

   ```sh
   git clone https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness
   ```

2. **`pnpm-workspace.yaml` 对齐**：参考上游自己的 pnpm-workspace.yaml，把
   其成员目录以 `vendor/<name>/` 为前缀映射进 `packages` globs，再附插件包
   目录（对齐不全 → 部分上游包从 registry 解析，出现双副本）。

3. **三个配置显式声明为 true**（跨 vendor 源码引用得以成立的开关；显式声明
   固定语义，不依赖 pnpm 默认值随版本变化）：

   ```yaml
   linkWorkspacePackages: true
   hoistWorkspacePackages: true
   autoInstallPeers: true
   ```

   - `linkWorkspacePackages`：workspace 内互引一律链接，`@deepseek-ai/*`
     全仓库唯一一份上游源码（否则 registry 发布副本与源码并存 → 同名
     branded 类型 / 枚举双份，tsc 下互不兼容）。
   - `hoistWorkspacePackages` + `autoInstallPeers`：peer 依赖（如
     `@deepseek-ai/cordis`）自动安装并提升到根——各插件包无需为每个上游包
     重复声明 devDeps。

4. **根安装一次**：`pnpm install`。此后日常依赖变更才需再次根安装。

5. **插件包依赖声明**：对上游 `@deepseek-ai/*` 一律用 **`workspace:*`**
   版本（不用 registry 版本号 / `latest`）——保证解析到 vendor 源码而非
   发布副本。按用途放对位置：

   ```jsonc
   {
     "peerDependencies": { "@deepseek-ai/dsh-session": "workspace:*" }, // 契约面：插件 import 的上游类型/服务
     "devDependencies": { "@deepseek-ai/dsh-token-meter": "workspace:*" }, // 测试面：仅测试装配用
   }
   ```

   - **peerDependencies**：插件运行期 import 的上游包（类型 / 服务契约）；
     消费方（最终装配方）负责解析，插件自身不装副本。
   - **devDependencies**：仅测试 / 装配辅助用（如 mock 服务、投影注册表）；
     不进入运行期依赖。
   - 插件包**不依赖上游构建脚本**（不 import 其 `lib/` 路径之外的产物）。

## 同步流程

日常同步 = sync → patch（**同步链不需要根目录 `pnpm install`**）。`build` 是发布档，只在需要上游 built
产物时跑（`native/` 变化、上游 built-only 门禁、发布校验）。顺序固定，用 `tsx` 直调脚本（勿用 `pnpm exec`）：

```sh
tsx <skill 路径>/scripts/sync.ts    # 1. 对齐到目标提交
tsx <skill 路径>/scripts/patch.ts   # 2. EXCLUDE 裁剪 + steps.json 补丁（含 exports 改写与 typert 生成）
tsx <skill 路径>/scripts/build.ts   # 3.（可选，发布档）干净构建
```

### sync.ts：同步上游到指定提交

- 目录缺失 → 首次完整 clone；存在 → `git fetch --prune`（增量）+
  `git reset --hard` + 检出目标。
- 检出优先级：`REVISION` > `VERSION`（tag → branch）；检出到本地
  `sync/<target>` 分支。fetch 完整 refs，revision 可指向任意提交。
- **目标相同也 reset**——清旧 patch 残留，保证 repatch 干净基线。
- sync 后**必须** patch（repatch）再 build；升级前记旧 HEAD
  （`git -C <dir> log -1`），升级后 `git diff` / `git log` 对比。

### patch.ts：裁剪与补丁

1. **EXCLUDE 裁剪**：对 `DEEPSEEK_HARNESS_EXCLUDE` 每项删目录 + 从全部
   `tsconfig*.json` 移除其 path 引用行；目录不存在时 warn 跳过。
2. **steps.json 步骤清单**（默认 `<workspace 根>/patches/steps.json`）：

   ```jsonc
   [
     { "type": "rm", "path": "…" },
     { "type": "rm", "glob": "**/tsconfig*.json" },
     { "type": "text", "file": "…", "pattern": "…", "flags": "gm", "to": "" },
     { "type": "git", "patch": "…" },
     { "type": "exports" },
     { "type": "typert" },
   ]
   ```

   **任一步骤失败即失败**——上游已变化，评估更新 / 删除 / 新增，不跳过。

   `rm` 的 `glob` 形态按模式批量删（`fs.glob` 展开，`node_modules` 永不在范围内）。本仓库用它删掉上游
   **全部** `tsconfig*.json`：上游不再构建，那些配置只剩干扰。实测**留着也能全量 `just build` 通过**
   （根 `tsconfig.json` 已把 `vendor/**` 纳进编译面），删掉的理由是口径唯一——按文件就近找 tsconfig 的
   工具（tsgo / oxc）只会读到根上那一份，不会撞上未开 `experimentalDecorators` 的上游口径。
   `build --full` 那条路要用上游自己的 tsconfig，所以只能在 `patch` 之前跑（见下）。

   `exports` 是**生成式**步骤（不存 diff）：把上游各包 `exports` 里指向 `lib/` 的目标改写成对应的
   `src` 源文件，并给缺 `"./src/*"` 出口的包补上，使开发与桌面 dev 形态直接消费源码
   （决定见 [ADR-开发与桌面消费上游源码面](../../adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)）。
   生成物出口 `./typert`、`./client/typert`、`./remote` 改指 `typert` 步骤产出的 `.ts`；非 `lib/` 目标
   （资产、`./src/*`）原样。找不到源码的出口打印清单后保持原样——它是上游新增出口的信号，不是同步失败。

   `typert` 是**生成式**步骤：直接编排上游 analyzer/emitter 生成 typert 产物，写成 `.ts`
   （`lib/typert.<face>.ts`、`lib/typert.remote-client.ts`），避免开发/桌面 dev 形态为这两个出口
   再构建一次上游。它不调用 `WorkspaceTypertGenerator.generate`——那条路径带 lib 形态的强制契约校验。
   前置的 `text` 步骤给 analyzer 的「数据出口」跳过列表补 `css`：`.css` 与 `svg`/`png` 同类（无 TS API），
   `client/ui-theme` 的 `brand-font.css` 出口否则会在分析期被判为「missing source」。

> 裁剪或改补丁后，若 lockfile 仍固化被裁依赖，需重新生成 lockfile
> （`pnpm install --lockfile-only`）——否则后续 install 仍会下载。

### build.ts：默认只编译 native，且不 install

默认直接拿**根目录的 `tsx`** 调 `native/system/scripts/build.ts --host-addon-only`——上游只剩 `native/` 的
addon 必须编译（`.node` 是二进制产物，源码面消费不了）。其余产物都由源码面取代：`exports` 指 `src`、
client 半现场打包、typert 生成物由 `patch` 写成 `.ts`，见
[ADR-开发与桌面消费上游源码面](../../adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)。

**不 install**：上游自带 pnpm workspace，在它目录里跑 pnpm（`run` 在 node_modules 缺失时还会**隐式 install**）
会造出上游自己的顶层 `node_modules`，与根 workspace 的链接形成双副本——实测让 client 测试成片失败，
且根 install 不加 `--force` 认不出差别、复不了原。native 构建要的依赖由根 install 提供。

`--full` 跑原来的完整上游构建（install + `pnpm run clean` + `pnpm run build`：tsc -b 全仓 + tsdown 全仓 +
web 前端），供发布档或上游 built-only 门禁；它需要上游自己的 tsconfig，而 `patch` 会删掉它们，所以要在
**未 patch 的干净基线**上跑（`sync` 之后、`patch` 之前），结束时用根 `pnpm install --force` 复原解析。

> 仓库可封装为命令（如 just：`vendor sync` / `vendor patch` / `vendor
> build`），直接 `tsx` 调用脚本，语义与流程一致。

## 升级

1. 改 `DEEPSEEK_HARNESS_VERSION`（或 `DEEPSEEK_HARNESS_REVISION`）。
2. 记旧 HEAD。
3. **先清 vendor 顶层 `node_modules`**（本地）：里面有上一版的副本，会被上游
   `tsc -b` 解析到，表现为双副本类型错误（playwright / zod 版本对不上），
   干净 clone 的 CI 无此问题。build 结束时本就会清掉它，日常恢复姿势是
   `just clean && just dep`。
4. sync → patch（含 `exports` 改写与 `typert` 生成；失效即信号）。
5. 上游 `native/` 变化、或需要 built 产物（上游 built-only 门禁 / 发布校验）时，再跑 `vendor build`。
6. **重跑生成物与 lockfile**（上游包与主题一变就漂移，门禁只在重跑后才可信）：
   - 根 lockfile：`pnpm install --lockfile-only`（上游新包、上游钉住的依赖版本
     如 koffi 都靠它对齐）；
   - 官方包清单：`pnpm --filter @morlay/dsh-desktop-shell run gen:official-packages`
     （读上游 bundle 的 `cordis.patch.yml`，需上游 lib 产物在——先跑一次 `vendor build`）。
6. 门禁：test / lint / build，与 CI 一致。
7. **适配评估（必做）**：对照「cordis 扩展面清单」逐面核对变化；结论记录
   为决策文档或变更日志；行为变更连同测试一起改。

## 插件开发：cordis 扩展面清单

上游代码不可修改，扩展走 cordis 插件层。按扩展面组织插件：

| 扩展面        | 机制                                     | 适配检查点                               |
| ------------- | ---------------------------------------- | ---------------------------------------- |
| 服务注册      | `Service` 子类 + `ctx.inject`            | 服务键唯一；可选服务用 `ctx.get(name)`   |
| 上游抽象实现  | 实现上游接口（如 `SessionHandle`）再注册 | 原语签名 / 标记语义 / 事务模式随版本演进 |
| 事件合并      | `declare module` 扩展 `SessionEventMap`  | 结构化守卫；`ignorable: true` 信封语义   |
| 配置          | `Config` schema（schemastery）           | schema 与 settings namespace 一致        |
| 用户覆盖      | settings namespace                       | `installSection` 钩子；纯 YAML 无 `!!js` |
| 运行时协调    | 读取 / 同步上游服务内部状态              | 私有字段名与语义是升级时最脆弱的面       |
| client bundle | 手递单文件替换上游渲染                   | 单文件约束、external 边界                |

## 排查上游行为

1. 源码即真源：`vendor/<name>/packages/<group>/<pkg>/src/`。
2. 上游测试是契约活文档：`vendor/<name>/packages/<group>/<pkg>/tests/`。
3. 上游自带约定文档优先于猜测。
4. 排查结论影响插件决策则记录（ADR / 变更日志）。

## 本地 patch 管理

1. **最小必要**：能走配置 / 插件层 / settings 解决的不打 patch；整包裁剪
   优先用 `DEEPSEEK_HARNESS_EXCLUDE`。
2. **集中登记**：EXCLUDE 值在环境配置登记；steps.json 集中 `patches/`，
   每项记录为什么（上游缺陷 / 构建约束 / 裁剪需求）。
3. **升级时评估失效**：`git apply` 失败即信号，评估删除 / 更新 / 保留。

## 验证与发布

- **发布走 CI**：严禁本地私自 publish；版本 bump 提交后由 CI 构建 + 发布，
  本地只构建验证。

## 交接

- 适配改动落地走 `dsh-plugin-implement`（先接缝、先测试）；同步后要跑哪些证据按
  `.agents/standards/`（含改动所属层）的证据口径选。
- 上游变更带来的适配决策落哪个 home（ADR / 设计 / 债务）的判据与模板见 `dsh-plugin-design`；
  改完审查走 `dsh-plugin-review`。
