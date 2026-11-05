---
name: zephyr-upstream-sync
description: 跟随上游源码演进时用——把上游同步到指定提交、裁剪与本地 patch、生成物与原生构建、升级与适配评估；本技能自带执行器，项目特化（步骤清单与补丁）留在 vendor/
disable-model-invocation: true
---

# 上游同步（upstream-sync）

以 **side workspace** 形态跟随上游源码：上游以完整 git 仓库放在 `vendor/<name>/`（保留 `.git`），
用 git 同步锁定到指定提交，本仓库的包以 `workspace:` 协议引用它的**源码面**。上游只读；
本地 patch 是唯一例外（只改工作树，不提交进上游 git）。

本技能只定义 SOP 与执行器。**项目特化的东西在 `vendor/`**：步骤清单 `vendor/steps.ts`、补丁
`vendor/patches/`、命令入口 `vendor/justfile`。为什么这样分工，见项目的决策记录（side-workspace 版本锁定、
源码面消费、第三方补丁纳入根工作区）。

## 一、执行器与命令

同步链是技能自带的包：`.agents/skills/zephyr-upstream-sync/scripts/upstream-sync`（独立工作区、自带依赖，
不在根 workspace 里）。五个子命令都经 `vendor/justfile` 调用，不要绕过它散调：

```sh
just vendor sync          # 1. 对齐到目标提交
just vendor patch         # 2. steps.ts 的 patch 阶段（从干净基线跑一次）
just vendor vendor        # 3. 按需 vendored 的上游内部文件
just vendor prebuild      # 4. steps.ts 的 prebuild 阶段（生成物 + native）
just vendor vendor-check  # CI：只比对 vendored 快照与上游，不写
```

- 依赖由入口现装（`_deps`）；`pnx` 只认绝对路径或已安装的包名，给相对路径会被当成 git 依赖。
- 不要用 `pnpm exec <脚本>`（`node_modules` 缺失时会触发隐式 install），也不要引入 `tsx`。

## 二、环境变量

| env                         | 含义                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| `DEEPSEEK_HARNESS_DIR`      | 上游目录，**相对 workspace 根**（`pnpm-workspace.yaml` 所在目录） |
| `DEEPSEEK_HARNESS_VERSION`  | 目标版本（tag 优先，回退同名 branch）                             |
| `DEEPSEEK_HARNESS_REVISION` | 可选，特定 commit / 短 sha，**优先于 VERSION**                    |
| `DEEPSEEK_HARNESS_REPO`     | 可选，上游仓库地址                                                |

步骤清单与补丁按 `DEEPSEEK_HARNESS_DIR` 的**父目录**定位——换 vendor 目录名不用改脚本。

## 三、两阶段：patch 与 prebuild

顺序固定，**重跑一律从 sync 开始**：`patch` 的 `text` / `git` 步骤要的是未打过补丁的干净基线；
`prebuild` 的生成物要的是 patch 改写后的源码面出口表。

`patch`（改上游工作树）：

| 类型      | 做什么                                   | 失败意味着什么                                               |
| --------- | ---------------------------------------- | ------------------------------------------------------------ |
| `rm`      | 整包裁剪（`glob` 形态按模式批量删）      | 目标不存在：上游挪走 / 改名了，裁剪清单该跟着改              |
| `text`    | 对文件做正则替换                         | 不匹配 / 无变化：上游改到这行，评估更新或删除                |
| `git`     | 打 `vendor/patches/*.patch`              | `git apply` 失败：上游改到这些行，是同步信号                 |
| `exports` | 生成式改写出口（指到源码面、补 `files`） | 找不到源码的出口会打印清单后保持原样——那是上游新增出口的信号 |

`prebuild`（生成物与 native）：

| 类型     | 做什么                                                                             |
| -------- | ---------------------------------------------------------------------------------- |
| `typert` | 跑本仓库的 AST 生成器产出类型面产物（不读上游 tsconfig、不 import 上游 generator） |
| `native` | 只编不得不编译的 addon；直接跑上游构建脚本，不 install、不经过 `pnpm run`          |

清单是 TS，两个具名导出（`patch` / `prebuild`），每条步骤就地写「为什么」；任一步骤失败即失败，不跳过。

## 四、按需 vendored 的内部文件

要用上游的**内部**实现文件（薄壳 fork、组件源码）时，不摊上游 `src/*` 出口、也不写指进 vendor 树的相对路径，
而是**把这些文件复制进自己包的 `src/vendor/<短名>/…`**，import 走包内相对路径。清单与递归补闭包在
`.agents/skills/zephyr-upstream-sync/scripts/upstream-sync/src/vendored.ts`；`vendor-check` 是 CI 上的漂移判据。
当前清单为空：唯一的上游组件快照（`better-session` 的 `src/ui/vendor/dsh-client-ui-chat/**`）是**手工适配过**
的薄壳 fork，不能按字节复制，由那个包的逐行比对判据守护；将来出现「原样复制即可」的文件才进清单。

## 五、升级

1. 改版本或修订（`DEEPSEEK_HARNESS_VERSION` / `REVISION`）。
2. 记旧 HEAD（`git -C <dir> log -1`），升级后 `git diff` / `git log` 对比。
3. **先清 vendor 顶层 `node_modules`**：里面有上一版的副本，会被解析到，表现为双副本类型错误；干净 clone 的 CI 无此问题。
4. `sync → patch → vendor → prebuild`；步骤失效即信号，逐条评估删除 / 更新 / 保留。
5. **重跑生成物与 lockfile**：上游包与主题一变就漂移，门禁只在重跑后才可信。
6. 门禁：按项目证据矩阵跑测试 / lint / 构建。
7. **适配评估（必做）**：对照扩展面逐面核对变化；结论记录为设计、决策或债。

## 六、本地 patch 纪律

- **最小必要**：能走配置 / 插件层 / settings 解决的不打 patch；整包裁剪写成 `rm` 步骤。
- **集中登记**：步骤清单在 `vendor/steps.ts`，补丁文件在 `vendor/patches/`；每一步为什么存在就地写在步骤旁边。
- **升级时评估失效**：`git apply` 失败、`text` 不匹配、`rm` 目标不存在即信号。
- **不进上游 git**：patch 只改工作树，`sync` 的 `reset --hard` 负责抹掉——任何「改完要留下」的东西都得写进 `steps.ts`。

## 七、排查上游行为

1. 源码即真源：`vendor/<name>/packages/**/src/`。
2. 上游测试是契约活文档：`vendor/<name>/packages/**/tests/`。
3. 上游自带文档优先于猜测；别按发布包的类型声明猜语义。
4. 结论影响本仓决策就记录（设计 / 决策 / 债）。

## 八、验证与交接

- 验证证据按项目证据矩阵；同步后至少覆盖测试、lint、构建。
- 适配改动落地 → `zephyr-implement`；适配决策落哪个 home → `zephyr-design`；改完审查 → `zephyr-review`。
