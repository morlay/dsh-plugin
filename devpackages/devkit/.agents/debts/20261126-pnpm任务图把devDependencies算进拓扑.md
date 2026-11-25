# pnpm 的任务图把 `devDependencies` 算进拓扑：跨域测试装配会造出任务图环

状态：**已修（实例），保留为知识**——`dsh-shell → @morlay/dsh-sandbox` 那条边已消；机制本身仍会咬下一个人
位置：机制在 pnpm 的 workspace 递归（`pnpm -r … exec`）；实例在 `packages/agent/dsh-shell/src/ui/__tests__/terminal-endpoints.spec.ts`；被它挡住的判据在 `devpackages/devkit/src/audit/`（`devkit audit` 的逐包扫描）

**现象**

`pnpm exec devkit audit`（内部 `pnpm -r --filter './packages/*/*' exec node audit/package-audit.ts`）在**不打印任何错误明细**的情况下失败，汇总器只报一句：

```
✗ 没有任何包报告：判据没跑起来（检查 pnpm 递归是否被 workspace 循环依赖挡住）
```

真正的错误在 pnpm 那一侧：

```
Error: ERR_PNPM_TASK_CYCLE
  × The tasks form a dependency cycle: packages/agent/dsh-sandbox#node → packages/agent/dsh-shell#node → …
```

**机制**

1. `pnpm -r … exec` 会按 **workspace 依赖图**给每个包排拓扑序（每个包一个 `#node` 任务）；
2. 那张图**包含 `devDependencies`**——它要按 workspace 拓扑跑脚本，dev 与 prod 不区分；
3. 于是「生产依赖 A→B」+「B 的测试里装了 A 的真行（B devDependencies→A）」就是**双向边**，pnpm 判环并**拒跑**整个递归；
4. 递归零产出 → 汇总器读到空输入 → 判据报「没跑起来」（这条兜底是对的：空输入不许当全绿）。

**为什么「挪字段」不管用**（踩过）

把那条边从 `dependencies` / `peerDependencies` **挪到 `devDependencies` 一点用都没有**——边还在图里。实测：`@morlay/dsh-sandbox` 本来就已经只在 `dsh-shell` 的 `devDependencies`，环照样成立；把该依赖**整条删掉**，环立刻消失。所以判据是「这条边在不在」，不是「写在哪个字段」。

**修法（已落地）**

包内测试**不装别的域的真行**，用**最小面替身**：本包自己的令牌 + 一行「按上游服务名发布」的 provider。实例：

- 替身：`FakeSandboxPolicy` / `FakeWorkingDirectory`（空面）+ `PublishExecutionFaces`（`onInit` 里 `ctx[rootContextKey].provide('sandboxPolicy' | 'workingDirectory', …)`）；
- 依据：上游 `TerminalController.execution()` 只做**存在性检查**（`api/terminal-controller/src/index.ts:526-537`），本 spec 不开终端；
- 注意 `publishingTo()`（`packages/zephyr/zephyr-app/src/testing/publish-service-name.ts`）**不能连用两次**：它的生成类名固定是 `service-name-publisher`，第二次注册直接抛 `service "service-name-publisher" has been registered`。要发布多个名字就自己写一条发布行。

**怎么发现下一个实例**

`pnpm -r --filter './packages/*/*' exec node -e 0`：判环时立刻红。任何「包内测试 import 了会反向依赖本包的域」都是同一类（`dsh-agent-instruction` / `dsh-permission` 的那几条是「只在测试里用」，但方向不构成环，已挪 `devDependencies` 收口）。

**不要的修法**

- `ignoreWorkspaceCycles: true`（`pnpm-workspace.yaml`）：会让**所有** `pnpm -r`（含 `just test`）都无视环，为一个判据把全局门禁降级；
- 给审计命令加 `--no-sort`：只对「扫描彼此独立」的调用成立，把环留在别处照样会炸；本轮曾试过，环修好后已删。
