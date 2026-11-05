# 上游以 side workspace 版本锁定完整代码而非发布版本

状态：已采纳——`vendor/deepseek-harness/` 锁在 `DEEPSEEK_HARNESS_VERSION`（当前 `0.2.2-rc.1`），引用上游的包一律经 `workspace:^` 解析到这份源码
背景：上游 deepseek-harness 处于 pre-release（无兼容承诺）、改动频繁，而插件要扩展它就得读**源码**：服务实现、事件映射、`SessionHandle` 这类持久化契约、live 会话的内存 log。registry 上的发布物只有 `lib/` 与类型声明，读不到这些，也没法打本地补丁。

**决定**

把上游整仓按版本 clone 进 `vendor/deepseek-harness/`（独立 git 仓，由 `vendor/.gitignore` 排除；主仓库只跟踪 `vendor/` 这一层维护物），作为根 pnpm workspace 的成员参与安装与构建，使 `@deepseek-ai/*` 各包解析到**当前锁定版本**的源码。版本锚点只有一处：[`mise.toml`](../../mise.toml) 的 `DEEPSEEK_HARNESS_VERSION`；可选 `DEEPSEEK_HARNESS_REVISION` 指向具体 commit 并优先于版本。检出 tag `dsh-v{version}` 优先、回退同名 branch（[`sync.ts`](../skills/zephyr-upstream-sync/scripts/upstream-sync/src/sync.ts)）。

"上游源码全仓库只有一份"由 [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) 的三个开关**显式**保证，不吃 pnpm 默认值：`linkWorkspacePackages`（workspace 内互引一律链接）、`hoistWorkspacePackages`、`autoInstallPeers`。

**考虑过的选项**

| 选项                                     | 否掉的理由                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 用 registry 上的 `@deepseek-ai/*` 发布版 | 只有 `lib/` 与 d.ts，读不到私有实现；pre-release 无兼容承诺，升级不可控；没有打本地补丁的位置                                            |
| 直接依赖 git 远程（`github:` spec）      | 分支漂移、无锁定粒度、pnpm 解析不稳定；同样没有"按版本重放补丁"的位置                                                                    |
| 不显式声明那三个开关                     | 默认值随 pnpm 版本变；链接一旦关掉，`@deepseek-ai/*` 会从 registry 解析出**第二份**实现，同名 branded 类型 / 枚举两副本在 tsc 下互不兼容 |

**后果**

- 上游是**只读源码副本**（红线见 [`AGENTS.md`](../../AGENTS.md)）：扩展走 cordis 插件层，本地 patch 是唯一例外，且只改工作树——`sync` 的 `reset --hard` 会抹掉它，所以每处改动都要写进 [`vendor/steps.ts`](../../vendor/steps.ts) 的两阶段清单（`patch` / `prebuild`），补丁文件放 `vendor/patches/`。步骤类型与判据的 home 是 [`zephyr-upstream-sync`](../skills/zephyr-upstream-sync/SKILL.md)，这里不复述。
- 上游**不构建**：`prebuild` 只做生成物（typert 的 `.ts`）与 native addon 两件事，开发与桌面链直接吃源码（见 [ADR-开发与桌面消费上游源码面而非lib产物](./20261010-开发与桌面消费上游源码面而非lib产物.md)）。
- 升级 = 改 `mise.toml` 的版本 → `just prepare`（sync → patch → dep → prebuild）→ `just test` / `just lint` / `just build`。
- `vendor/deepseek-harness/` 删掉后只能靠 `just vendor sync` 重建（`pnpm install` 不会重新 clone）。
- 本仓库的包引用上游一律写 `workspace:^`：运行期 `import` 的包进 `dependencies`，只在测试 / 装配辅助里用的进 `devDependencies`；只有"宿主必须提供、我们自己不 import"的契约才进 `peerDependencies`（当前只有 `@morlay/zephyr` 的 `@deepseek-ai/cordis`）。
