# 如何验证

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的接缝、环境门控与落点。

命令入口：`pnpm exec vitest run packages/agent-ex/configurable-sandbox`（整包 9 文件 / 53 通过）、
`pnpm exec oxlint packages/agent-ex/configurable-sandbox`。

## 常规落点（`src/__tests__/`）

| 接缝                        | 守护 spec                                    | 判据                                                                                                                                              |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox.toml` 的读取与退化 | `config-surface.spec.ts`                     | 合法文件六个字段都读到、规则源按前缀分桶；坏 TOML / 未知字段 / 类型不对 / 条目语法不对都退到没有规则且不阻断启动；读面给 `undefined` 时全用默认值 |
| 首次启动写默认文件          | `default-config.spec.ts`                     | 文件不存在时创建并解析出那八条默认规则；已存在时不动                                                                                              |
| 规则语义与命中优先级        | `rules.spec.ts`                              | `--` > `r-` > 可写根；glob 与 `{{ env }}` 展开；`rw` 不收 glob；相对路径相对会话工作区                                                            |
| 平台方言的 argv 生成        | `dialects.spec.ts`                           | 四种方言的识别、追加位置与形状；空规则原样返回；认不出的 runner 在有规则时抛错；能力表与实现一致                                                  |
| 路径包含判定                | `containment.spec.ts`                        | 字面包含、后代算、同前缀兄弟不算；符号链接指到同一对象算包含；root 不存在给 `false`                                                               |
| 两段运行时策略文本          | `policy-text.spec.ts`                        | 三种 mode 的中文语义、规则尾巴的顺序、两条上下文与上游同名、审批 `ask` / `never` 两段                                                             |
| 运行时文本的接管时机        | `runtime-contexts.spec.ts`                   | agent 创建时注册同名 context、第一次装配即本包文本；无审批服务时 `approval:policy` 为空串                                                         |
| `FileSystem` 的规则端到端   | `file-system.spec.ts`                        | `--` 读入口即拒；`r-` 读放行、写拒；`rw` 在 workspace-write 下可写；拒绝一律 `FS_SANDBOX_DENIED`                                                  |
| 装配面（替换官方两行）      | `assembly.spec.ts`                           | 对照组官方兑现；剔两行后本包兑现；只剔一个时另一个仍官方；不带 feature 也起得来；本包每行可被 `without` 定位                                      |
| 测试替身                    | `src/__tests__/support/fake-sandbox-file.ts` | `SandboxFile` 的假件：用例不碰真实 `$DSH_HOME`；`support/fake-policy.ts` 是 `SandboxPolicy` 的假件（不装会话投影）                                |

## 装配面的判据在包级 spec（不在 apps）

装配面与替换形态的判据都在本包 `src/__tests__/`，用最小装配（官方两行 + 本包清单）跑：

- `assembly.spec.ts` 五条：「`without` 之后谁兑现」的判据——对照组官方兑现；剔两行后本包兑现；
  只剔一个时另一个仍官方；不带 feature 也起得来；本包清单每行都能被 `without` 定位；
- `file-system.spec.ts`：经 `FileSystem` 令牌的 `--` / `r-` / `rw` 端到端语义（拒绝一律 `FS_SANDBOX_DENIED`）；
- `runtime-contexts.spec.ts`：运行时策略文本的接管时机（`agent/created` 时注册、第一次装配即本包文本；
  无审批服务时 `approval:policy` 为空串）。

跑它们用 `pnpm exec vitest run packages/agent-ex/configurable-sandbox`。

## 未覆盖（有明确原因）

- **bwrap / Landlock / Windows ACL 的真机行为**：本机是 macOS。这三个方言的 argv 形状由 `dialects.spec.ts` 断言，但「内核真的照它执行」没有证据。
- **Seatbelt 真机执行**：本包不再有 `sandbox-exec` 的 e2e 用例（那类探针在嵌套沙箱里会被内核拒绝）；改动沙箱规则后的人工验证在未被沙箱包住的 macOS shell 里手工跑一次 `sandbox-exec`，结果记在评审说明里，不进默认套件。
- **本行晚挂载时覆盖既有 agent**：`SandboxRuntimeContexts` 的 `existingAgents` 路径（行重挂 / HMR 时覆盖已存在的 agent）没有真装配用例；`runtime-contexts.spec.ts` 只覆盖 `agent/created` 的注册时机与无审批服务的空串。
- **`rw` 在 Windows 上的额外授权**：官方 ACL 能力有预授权路径，本包只告警不用它。
