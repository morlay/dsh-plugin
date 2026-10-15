---
name: dsh-plugin-upstream-sync
description: 跟随上游 deepseek-harness（dsh）演进、开发插件集合时用——同步上游到指定提交（DEEPSEEK_HARNESS_VERSION / REVISION）、裁剪与本地 patch、prebuild（typert 生成 + native addon）、升级与适配评估、排查上游行为；从零搭建的 workspace 对齐与初始化也在这里
disable-model-invocation: true
---

# 上游同步（upstream-sync）

以 side workspace 形态基于上游 deepseek-harness（dsh）开发 cordis 插件集合：
上游以完整 git 仓库 vendor 到 `vendor/<name>/`（保留 `.git`），经 git 同步锁定到
指定提交，插件包以 `workspace:*` 引用其源码。为什么这样做、否掉了哪些路线，见
`ADR-上游以side-workspace版本锁定完整代码而非发布版本`（根 `.agents/adrs/`）与
`ADR-workspace跨vendor链接与devkit工具链复用`。

上游是**锁版本的只读源码副本**——版本常量在 `mise.toml`，只读红线与发布纪律见
[`AGENTS.md`](../../../AGENTS.md)；插件只在自己的包里适配它。本地 patch 是唯一例外，
它只改工作树（改完的东西不提交进上游 git），见「本地 patch」。

```
<your-repo>/
├── vendor/
│   ├── <upstream>/          # 上游完整 git clone（保留 .git，只读）
│   ├── steps.ts             # patch / prebuild 两阶段步骤清单（TS，仓库维护）
│   └── patches/*.patch      # 本地补丁（仓库维护）
├── packages/<plugin-pkg>/   # 插件包（workspace:* 引用上游，见扩展面清单）
├── pnpm-workspace.yaml      # 对齐上游 + 三个 workspace 配置（见初始化）
└── 版本变量配置               # 如 mise.toml：DEEPSEEK_HARNESS_*
```

同步链是一个 **devpackage**（`devpackages/upstream-sync`）：`sync` / `patch` / `prebuild` 三条子命令，
一律用 **`pnpm dlx @oxc-node/cli`** 直跑它的 CLI（oxc transformer + resolver）：

```sh
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts <sync|patch|prebuild>
```

**为什么是包**：链上要用到解析器（AST 探查，如 `exports` 步骤里的依赖修复）。散脚本住在技能目录下、不属于任何
包，`node_modules` 里什么也解析不到；做成包之后依赖写在清单里，脚本向上一条目录就是它的 `node_modules`。

**不要**用 `pnpm exec <脚本>`（node_modules 缺失时会触发隐式 install，下载已裁剪依赖），
不要引入 tsx——仓库里没有它，`node_modules/.bin/tsx` 只是别家依赖顺带提升上来的；也别再写
`node --import=<loader>`（loader 那条路留给插件包自己的构建，见 `@local/devkit` 的 README）。

| env                         | 含义                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `DEEPSEEK_HARNESS_DIR`      | 上游目录，**相对 workspace 根**（pnpm-workspace.yaml 所在目录） |
| `DEEPSEEK_HARNESS_VERSION`  | 目标版本（tag `dsh-v{version}` 优先，回退同名 branch）          |
| `DEEPSEEK_HARNESS_REVISION` | 可选，特定 commit / 短 sha，**优先于 VERSION**                  |
| `DEEPSEEK_HARNESS_REPO`     | 可选，上游仓库地址                                              |

`vendor/steps.ts` 与 `vendor/patches/` 按 `DEEPSEEK_HARNESS_DIR` 的**父目录**定位——换 vendor
目录名不用改脚本。

## 初始化：对齐 workspace（一次性）

1. **先立 `vendor/`**（仓库维护的那一层，见第 6 步）再完整 clone 上游（保留 .git）：

   ```sh
   mkdir -p vendor/patches
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

6. **`vendor/steps.ts` 两阶段清单**：裁剪、补丁与生成步骤都写在这里（见「patch 阶段」），
   `vendor/patches/*.patch` 放补丁文件本身。清单是 TS，两个阶段各一个具名导出
   （`export const patch` / `export const prebuild`），每条步骤就地写「为什么」。它是同步配置、
   不属于任何编译面（host 叶已把它排除），类型检查走同步链包自己的 `tsconfig.json`
   （`devpackages/upstream-sync/tsconfig.json`）。

## 同步流程

日常同步 = **sync → patch → prebuild**（同步链不需要根目录 `pnpm install`）。顺序固定，
用 oxc 驱动直调脚本（勿用 `pnpm exec`，也勿引入 tsx）：

```sh
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts sync          # 1. 对齐到目标提交
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts patch         # 2. steps.ts 的 patch 阶段（从干净基线跑一次）
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts vendor        # 3. 按需 vendored 的上游内部文件（见下）
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts prebuild      # 4. steps.ts 的 prebuild 阶段（生成物 + native）
pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts vendor-check  # CI：只比对 vendored 快照与上游，不写
```

**`vendor`（按需 vendored 的上游内部文件）**：我们的包有时要用上游的**内部**实现文件（薄壳 fork、
`MessageIconActions.tsx` 这类）。三条路里选第三条：不让上游把 `src/*` 摊成出口（那会让打包边界跟着乱：同一个包
既按出口引、又按源码路径引），也不写指向 vendor 树的相对路径（闭包面里深度对不上、解析不到），而是**把这些文件
按需复制进自己包的 `src/vendor/<短名>/…`**，import 走包内相对路径。清单与递归补闭包在
`devpackages/upstream-sync/src/vendored.ts`；`.oxlintrc.json` 忽略 `**/src/vendor/**`（那是上游代码）。

**上游代码不再 build**：`exports` 改指源码面、client 半现场打包、typert 产物写成 `.ts`，
所以没有「构建上游」这一步（决策与放弃的产物见
[ADR-开发与桌面消费上游源码面](../../adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)）。
两条路都不是可任意重跑的：`patch` 的 `text` / `git` 步骤要的是**未打过补丁的干净基线**，
`prebuild` 的 typert 分析要的是上游 tsconfig（本阶段末尾会把它删掉），所以**重跑一律从 sync 开始**
（整条链在本仓库实测十几秒）。

### sync.ts：同步上游到指定提交

- 目录缺失 → 首次完整 clone；存在 → `git fetch --prune`（增量）+
  `git reset --hard` + 检出目标。
- 检出优先级：`REVISION` > `VERSION`（tag → branch）；检出到本地
  `sync/<target>` 分支。fetch 完整 refs，revision 可指向任意提交。
- **目标相同也 reset**——清旧 patch 残留，保证 repatch 干净基线。
- 升级前记旧 HEAD（`git -C <dir> log -1`），升级后 `git diff` / `git log` 对比。

### patch 阶段：steps.ts 的 `patch`（改上游工作树）

`vendor/steps.ts` 的两阶段都是**任一步骤失败即失败**——上游已变化，评估更新 / 删除 /
新增，不跳过。清单形状（`patch` 阶段为例，`prebuild` 同理）：

```ts
import type { Step } from "../devpackages/upstream-sync/src/steps.ts";

export const patch: Step[] = [
  // 为什么裁它 / 为什么打这个补丁，写在步骤旁边
  { type: "rm", path: "packages/subagent/subagent-claude-code" },
  { type: "text", file: "…", pattern: "…", flags: "gm", to: "" },
  { type: "git", patch: "…" },
  // 生成式改写：`lib→src` 同构规则推不出来的两类出口由步骤自己给
  { type: "exports", generated: { … }, explicit: { … } },
];
```

`exports` 步骤除了把出口/`main`/`types`/`files` 改指源码面，还连带做四件事（都在 `rewriteExports` 里）：
**删顶层 `main`/`types`**（`"type": "module"` 且有 `exports` 时它们只是重复）、**把同值的条件对象压成字符串**
（`{"types": "./src/x.ts", "default": "./src/x.ts"}` → `"./src/x.ts"`）、**把运行期真用到的依赖从
`devDependencies` 挪进 `dependencies` 并整段删掉 `devDependencies`**（上游把 client 半的浏览器依赖算 devDeps、
构建时内联，而我们这条链是运行期现场打包）、以及**不补 `./src/*` 出口**（内部文件面不该当包边界，要用的按上面的
`vendor` 步骤复制进来）。

步骤类型与语义：

- **`rm`（整包裁剪）**：删目录。目标不存在即**失败**——上游把这块挪走 / 改名了，裁剪清单
  该跟着改。裁剪就是一条步骤，「为什么裁」写在它所在的那份清单里（不再有 env 与清单两处事实）。
- **`rm` 的 `glob` 形态**：按模式批量删（`fs.glob` 展开，`node_modules` 永不在范围内）。
  本仓库用它删掉上游**全部** `tsconfig*.json`：上游不再构建，那些配置只剩干扰，删掉的理由是
  口径唯一——按文件就近找 tsconfig 的工具（tsgo / oxc）只会读到根上那一份，不会撞上未开
  `experimentalDecorators` 的上游口径。它排在 `prebuild` **末尾**：typert 分析器正是靠上游根的
  face tsconfig（`tsconfig.host.json` / `tsconfig.client.json`）找贡献者包，先删就没得读了。
- **`text`**：对文件做正则替换（不匹配 / 无变化即失败）。本仓库那一条给 typert analyzer 的
  「数据出口」跳过列表补 `css`：`.css` 与 `svg`/`png` 同类（无 TS API），`client/ui-theme` 的
  `brand-font.css` 出口否则会在分析期被判为「missing source」。它改的是上游工作树，放在
  `patch` 阶段（它给 `prebuild` 的 typert 铺路，但自身不幂等，不能进可重复的执行面）。
- **`git`**：本地补丁（`vendor/patches/*.patch` 打进上游工作树，打不上就失败——上游改到这些行即
  信号）：`decorator-dual-protocol.patch` 让写端（typert 的 `Remote`/`RemoteScope`、cordis 的
  `Inject`）同时接受 TC39 与 legacy 两种调用约定，**类型面也一样**（`RemoteMethodDecorator` 与
  `Remote` 的裸用法各多一条 legacy 签名、`Inject` 多一条 `(target: Function)`——本仓库根 tsconfig
  开着 `experimentalDecorators`，少了它们 `@Remote(…)` 就报 `TS1241`）；`source-loader.patch` 让
  subprocess runner 的转译器可由 `DSH_SOURCE_LOADER` 注入（上游默认的 `tsx/esm` 在本仓库与随包
  产物里都不存在）。
- **`exports`** 是**生成式**步骤（不存 diff）：把上游各包 `exports` 里指向 `lib/` 的目标改写成对应的
  `src` 源文件，并给缺 `"./src/*"` 出口的包补上，使开发与桌面两种形态直接消费源码
  （决定见 [ADR-开发与桌面消费上游源码面](../../adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)）。
  同一步还把各包 `files` 里的 `lib/*` 项换成 `src`（有 `src/` 的包才动），另补 `lib/typert.*`——`files`
  是发布面的文件集，而桌面 bundle 的 deploy 闭包正是按它拷工作区副本，不改就是「清单在、代码没了」的空壳。
  生成物出口 `./typert`、`./client/typert`、`./remote` 改指 `prebuild` 阶段产出的 `.ts`；非 `lib/` 目标
  （资产、`./src/*`）原样。找不到源码的出口打印清单后保持原样——它是上游新增出口的信号，不是同步失败。
  同构规则推不出来的那两类出口（生成物出口、出口名 ≠ 源文件名的包）由步骤自带参数给：`generated`
  与 `explicit` 两个映射就写在 `vendor/steps.ts` 的这一步里（一处说明，不在脚本里藏常量）。

> 改补丁 / 裁包之后，若 lockfile 仍固化被裁依赖，需重新生成 lockfile
> （`pnpm install --lockfile-only`）——否则后续 install 仍会下载。

### prebuild 阶段：steps.ts 的 `prebuild`（生成物 + native）

- **`typert`** 是**生成式**步骤：跑本仓库自己的生成器（`@local/typert-generator`）产出
  `lib/typert.{host,client,remote-client}.ts`——它按 **AST**（oxc）把上游源码的方法面与声明树
  （`target/dts`，由 devkit 生成，缺了就补一次）的类型面合成产物，**不读上游 tsconfig、也不 import 上游
  generator**（后者要给每个包各建一次 tsgo 类型图）。产物三件套都由它写，包数 / invocation 条数与上游一一对应。
- **`native`**：只编**不得不编译**的 addon——`.node` 是二进制产物，源码面消费不了。它直接跑上游自己的
  `native/system/scripts/build.ts --host-addon-only`（同样由 `pnpm dlx @oxc-node/cli` 驱动）。
  **不 install、不经过 `pnpm run`**：上游自带 pnpm workspace，在它目录里跑 pnpm（`run` 在 node_modules
  缺失时还会**隐式 install**）会造出上游自己的顶层 `node_modules`，与根 workspace 的链接形成双副本
  ——实测让 client 测试成片失败，且根 install 不加 `--force` 认不出差别、复不了原。native 构建要的
  依赖由根 install 提供。
- **`rm tsconfig`**：见上一节的 glob 说明（口径收口，必须排在 `typert` 之后）。

> 仓库可封装为命令（`vendor sync` / `vendor patch` / `vendor prebuild`；根 `just prepare`
> 串成 sync → patch → dep → prebuild），语义与流程一致。

## 升级

1. 改 `mise.toml` 的 `DEEPSEEK_HARNESS_VERSION`（或 `DEEPSEEK_HARNESS_REVISION`）。
2. 记旧 HEAD。
3. **先清 vendor 顶层 `node_modules`**（本地）：里面有上一版的副本，会被解析到，表现为双副本类型
   错误（playwright / zod 版本对不上），干净 clone 的 CI 无此问题。日常恢复姿势是
   `just clean && just dep`。
4. sync → patch → prebuild（`text` / `git` / `typert` 步骤失效即信号，逐条评估）。
5. **重跑生成物与 lockfile**（上游包与主题一变就漂移，门禁只在重跑后才可信）：
   - 根 lockfile：`pnpm install --lockfile-only`（上游新包、上游钉住的依赖版本
     如 koffi 都靠它对齐）；
   - 官方包清单：`pnpm --filter @morlay/dsh-desktop-shell run gen:official-packages`
     （读上游 bundle 的 `cordis.patch.yml`）。
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

## 本地 patch

1. **最小必要**：能走配置 / 插件层 / settings 解决的不打 patch；整包裁剪写成 `rm` 步骤。
2. **集中登记**：步骤清单在 `vendor/steps.ts`（`patch` / `prebuild` 两个具名导出），补丁文件在
   `vendor/patches/`；每个步骤为什么存在（上游缺陷 / 构建约束 / 裁剪需求）就地写在步骤旁边——
   清单是 TS，注释就住在那里；本技能只讲各步骤类型的语义与判据。
3. **升级时评估失效**：`git apply` 失败、`text` 不匹配、`rm` 目标不存在即信号，评估删除 / 更新 / 保留。
4. **不进上游 git**：patch 只改工作树，`sync` 的 `reset --hard` 负责抹掉，所以任何"改完要留下"的
   东西都得写进 `steps.ts`。

## 验证与发布

- **发布走 CI**：严禁本地私自 publish；版本 bump 提交后由 CI 构建 + 发布，
  本地只构建验证。

## 交接

- 适配改动落地走 `dsh-plugin-implement`（先接缝、先测试）；同步后要跑哪些证据按
  `.agents/standards/`（含改动所属层）的证据口径选。
- 上游变更带来的适配决策落哪个 home（ADR / 设计 / 债务）的判据与模板见 `dsh-plugin-design`；
  改完审查走 `dsh-plugin-review`。
