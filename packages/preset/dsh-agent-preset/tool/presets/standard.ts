import { STANDARD_PERSONA } from "./persona.ts";
import { channelGroup, contextChannel, group, row, SHELL_ROWS, type PresetRow } from "./rows.ts";

/**
 * 标准模式的装配行：**我们按需列出**，不再从上游 `standard` 派生。
 *
 * 派生的问题是一直在「读上游 → 禁用/收窄」：上游给的 planning、agent-instructions、tool-skill、
 * 外部 agent CLI（codex / claude-code）、ralph、plugin-manager 工具行都不是本部署要的，于是产物里
 * 堆一串 `disabled: true`。改成显式清单后，产物里只有我们要的行；上游改动由覆盖性测试提醒
 * （清单里的包必须能被解析、短名必须与包自己的 `invariant` 一致），而不是靠自动跟随。
 *
 * `config` 只写**偏离上游默认**的项：值与默认相同就该删掉（`patch.spec.ts` 会提醒）。
 */
export const STANDARD_ROWS: readonly PresetRow[] = [
  // persona 按模式给：注册 agent 作用域的同名 section，遮蔽部署级那层。
  row("persona", { config: { ...STANDARD_PERSONA } }),
  ...SHELL_ROWS,
  row("tool-fs"),
  row("tool-fs-search", { config: { sampleOverCapGlobResults: false } }),
  row("tool-jobs"),
  // skill 发现：目录与 `skill` 工具由 context-skill-catalog 接管，但 provider 仍是它。
  row("skill-filesystem"),
  row("command-goal"),
  row("tool-goal"),
  group(
    "compaction",
    [
      row("compaction-basic"),
      row("command-compact"),
      row("compaction-tool-result-pruner", {
        id: "tool-result-pruner",
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      }),
    ],
    { isolate: { compaction: true, toolResultPruner: true } },
  ),
  group(
    "delegation",
    [
      row("tool-subagent-control"),
      row("tool-subagent-control/list-agents", { id: "tool-subagent-list-agents" }),
      // 不带 `modelSelectionSettings`：子代理一律继承父会话的模型（见 dsh-preset 的 patch 说明）。
      row("tool-subagent", {
        config: { provider: "spawn", toolName: "subagent", backgroundMode: "continuable" },
      }),
      // 同一个包的第二个实例：换 provider 就是 fork 那一支。
      row("tool-subagent", {
        id: "tool-subagent-fork",
        config: { provider: "fork", toolName: "subagent_fork", backgroundMode: "continuable" },
      }),
      row("workflow-ptc", { config: { provider: "spawn" } }),
      row("tool-workflow"),
    ],
    { isolate: { workflowEngine: true } },
  ),
  row("tool-ask-user"),
  row("tool-todo", { config: { allowParallelInProgress: true } }),
  row("tool-web", { config: { fetch: true, searchTimeoutMs: 60000 } }),
  row("tool-present", { id: "present" }),
  // 本模式不吃 host 层的「先读后改」策略（上游 `fs-observation-policy` 对所有 preset 生效）。
  // 这不是"禁用 host 行"（preset 做不到），而是抢在它的 waterfall 前面丢弃结果——见 relax-intent 的说明。
  { id: "fs-intent-relax", name: "@morlay/dsh-agent-preset/relax-intent" },
  // 注入通道与它的消费者一起关进 isolate 组：通道服务只在这棵子树可见，别的 preset 拿不到它，
  // 我们的注入也就不会出现在官方 standard / ptc / cordis 的会话里。
  // 完整一套：不带 config，组成由包的主出口（组装插件）自己决定。
  channelGroup([contextChannel()]),
];
