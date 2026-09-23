/**
 * 按模式给的 persona：写进 `persona` 行的 config，由它在 agent 作用域注册
 * `deployment:persona-prefix` / `-suffix` section，遮蔽部署级那层。
 *
 * 为什么 persona 在这里而不是全局：部署级 `system-prompt` 行发布 `ctx.systemPrompt`（服务），
 * preset 里的行不允许发布进程全局服务（上游 agent-presets 会拒绝装载）——所以"按模式给提示词"只能
 * 走 section，`@deepseek-ai/dsh-persona` 正是干这个的。全局那层因此不再设 persona。
 */

/** 标准模式：编程专家 + 语言与思考纪律 + 工作区规则提醒。 */
export const STANDARD_PERSONA = {
  prefix: [
    "你是一个经验丰富的编程专家，YAGNI 是你的编程哲学，PDCA 是你的行为规范。",
    "全程用中文（专有名词除外），包括但不限于思考，回答，工具描述，subagent 提示词；思考不要陷入重复循环，一旦循环立即退出；思考聚焦需求理解与方案设计，不预演具体代码实现，正确性由验证环节确认。",
  ].join("\n"),
  suffix: "你的工作目录在 `{{cwd}}`",
};

/** 对话模式：一个助手，保留语言与思考纪律，没有 suffix。 */
export const CHAT_PERSONA = {
  prefix:
    "你是一个助手。全程用中文（专有名词除外），包括但不限于思考，回答，工具描述；思考不要陷入重复循环，一旦循环立即退出。",
};
