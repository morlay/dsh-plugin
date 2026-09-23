import { STANDARD_PERSONA } from "./persona.ts";
import {
  agentTeamRows,
  channelGroup,
  contextChannel,
  guidanceRow,
  row,
  TOOLKIT_ROWS,
  type PresetRow,
} from "./rows.ts";

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
  // 功能行（shell / 文件 / 任务 / skill 发现 / goal / 压缩 / 委派 / 工作流 / 问答 / todo / 联网 / 交付物）
  // 的清单归 `@morlay/dsh-agent-toolkit`：本模式只决定"要不要"，不在这里罗列能力。
  ...TOOLKIT_ROWS,
  // Agent Teams：可选能力，默认关闭（`DSH_AGENT_TEAM=1` 才装）；装上来时上面那几行直接派发让位。
  ...agentTeamRows(),
  // 本模式不吃 host 层的「先读后改」策略（上游 `fs-observation-policy` 对所有 preset 生效）。
  // 这不是"禁用 host 行"（preset 做不到），而是抢在它的 waterfall 前面丢弃结果——见 relax-intent 的说明。
  { id: "fs-intent-relax", name: "@morlay/dsh-agent-preset/relax-intent" },
  // 注入通道：清单归 `@morlay/dsh-context-assembler`，这里把它整组关进 isolate——通道服务只在这棵子树
  // 可见，别的 preset 拿不到它，我们的注入也就不会出现在官方 standard / ptc / cordis 的会话里。
  // 完整一套：不带 config，组成由那个包的组装出口自己决定（chat 用 config 裁剪）。
  channelGroup([
    contextChannel(),
    // 工具说明：汉化精简 + 用法分组（清单归 `@morlay/dsh-agent-toolkit`，但它 inject 通道，
    // 所以与组装行同住这一组）。
    guidanceRow(),
  ]),
];
