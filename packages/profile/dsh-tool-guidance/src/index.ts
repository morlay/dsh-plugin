import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ToolSchema } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-skill";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@morlay/dsh-context-assembler";
import z from "@deepseek-ai/schemastery";
import {
  BASE_GROUP_KEY,
  SHORT_TOOL_DESCRIPTIONS,
  TOOL_GROUPS,
  groupByKey,
  groupSkillBody,
  skillNameOf,
} from "./guidance/groups.ts";

export const name = "tool-guidance";

export const inject = ["tools", "systemPrompt", "skills", "contextAssembler"];

export interface Config {
  // 是否做**用法分组**（组 skill + `base` 常驻注入）。部署只想复用**工具预处理**（描述汉化 + 剥掉参数说明）
  // 时把它关掉。这是**部署级**开关（本行在 host 平面，所有会话共用一份 config），表达不了"某个模式不要用法
  // 正文"——chat 那档是模式收窄（`skill` 不进它的工具投影）加上 `skills` 推导成 `false` 丢掉官方目录注入。
  groups?: boolean;
}

export const Config: z<Config> = z.object({ groups: z.boolean().default(true) });

// 工具的两件事：**预处理**（所有模式都要——把上游描述换成一行中文、剥掉参数里的说明性字段）与
// **用法分组**（模式可选，`config.groups`：`base` 的正文由本行常驻注入，其余每组注册成一个官方 skill，
// 由官方 `tool-skill` 的目录列出、按需加载）。
export function apply(ctx: Context, config: Config): void {
  const groups = config.groups ?? true;

  // 这个会话**装配结果里最终可见**的工具名（每次装配刷新一份）。`base` 正文的过滤判据用它，不用工具注册表：
  // 会话收窄（模式的 `allowTools` / `denyTools`）落在装配投影与执行 guard 上，注册表上什么都看不到——挂在
  // 全套工具的 preset 上的 chat 会话，注册表里 read / write / bash 一个不少。
  const visibleTools = new WeakMap<Agent, ReadonlySet<string>>();

  if (groups) {
    // 被丢弃的上游说明：要点已吸收进组正文，原文不再进提示词。
    for (const group of TOOL_GROUPS) {
      for (const section of group.drops) ctx.contextAssembler.suppressSection(section);
    }

    for (const group of TOOL_GROUPS) {
      // `base` 不进官方目录：它的正文已经常驻在手上了，列一份出来只会让模型再花一轮加载重复正文。
      if (group.key === BASE_GROUP_KEY) continue;
      // 注册进**官方的 skill 注册表**（`ctx.skills`）：目录与按需加载都由官方 `tool-skill` 那一行提供，
      // 本包不再自己发布目录、也不按会话修剪正文——正文里提到的工具是否在这个会话的目录里，由模式收窄决定。
      ctx.effect(() =>
        ctx.skills.register({
          name: skillNameOf(group.key),
          description: group.skillDescription,
          content: groupSkillBody(group),
          source: "runtime",
          invocation: { modelInvocable: true, userInvocable: true },
        }),
      );
    }

    ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
      const decision = await next();
      if (decision.kind === "reject" || decision.messages.length === 0) return decision;

      // 幂等：surface 上同键最近一条的正文逐字相等就不送（压缩掉、正文变更时自然补发/重发）。
      signal.throwIfAborted();
      const key = skillNameOf(BASE_GROUP_KEY);
      // 正文按**这个会话装配结果里最终可见的工具目录**过滤：与模型手上的工具目录同源，收窄掉的工具不列。
      const available = visibleTools.get(agent);
      const text = renderSkillContent(
        key,
        groupSkillBody(
          baseGroup,
          available === undefined ? registeredIn(ctx, agent) : (tool) => available.has(tool),
        ),
      );
      if (latestInjectText(agent, key) === text) return decision;
      signal.throwIfAborted();

      // 落点：本步认领的用户消息**之后**——这个位置不随别的监听者的注册顺序漂移到列表末尾
      // （末尾那个位置归官方 `tool-skill` 的目录、上游的 runtime context）。
      const claimedEnd = decision.messages.findLastIndex((message) => messages.includes(message));
      return {
        ...decision,
        messages: decision.messages.toSpliced(claimedEnd + 1, 0, injectMessage(key, text)),
      };
    });
  }

  // 本行挂在**最外层**（`prepend`）：会话收窄的监听比本行先注册（host 平面的行先于本行的 scope），而瀑布里
  // 先注册的是外层——收窄发生在它的返回路径上，站在内层读 `next()` 拿到的是收窄**之前**的目录。站到最外层，
  // 一次装配走完手里的 `result` 才是这个会话最终可见的那份。工具投影的改写与过滤可交换（只换描述与 schema，
  // 不动名字），所以把改写一并挪到最外层，别人看到的结果不变。
  ctx.on(
    "system-prompt/assemble",
    async (_assembly, context, next) => {
      const result = await next();
      const agent = context.agent;
      // 记名字集合：`result.tools` 是投影**之后**的目录（收窄已生效、描述已被 `shortenTools` 换过），
      // 名字不受描述改写影响。诊断式的无 agent 装配不记（那种装配也不属于任何会话）。
      if (agent !== undefined) {
        visibleTools.set(agent, new Set(result.tools.map((tool) => tool.name)));
      }
      return { ...result, tools: shortenTools(result.tools) };
    },
    { prepend: true },
  );
}

const baseGroup = groupByKey(BASE_GROUP_KEY);

// **兜底**判据 = 工具注册表（这一行装没装这个工具）：只有当 `visibleTools` 里还没有这个 agent 的记录时才用得上。
// 为什么需要兜底：理论上 `agent/pre-step` 之前每个 agent 必有一次装配（loop 里先 `assemble` 再走这条瀑布），
// 但直接调瀑布的路径（诊断、别的插件自造 pre-step）可能没有——退回注册表总比渲染一份全量正文或空正文强。
function registeredIn(ctx: Context, agent: Agent): (tool: string) => boolean {
  return (tool) => ctx.tools.get(tool, agent) !== undefined;
}

// `base` 正文的信封：与官方 `renderSkillContent` 同形的内容块，但**手写**、不带 `<skill_resources>` 段
// ——运行时注册的虚拟 skill 没有资源目录，那一段只有 provider 提示的噪音。上游改信封时跟着改。
function renderSkillContent(name: string, body: string): string {
  return [
    `<skill_content name="${name}">`,
    "<skill_instructions>",
    body,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

// 常驻注入的身份用上游已有的 `skill-invocation`（与按需加载同形态），幂等键就是组 skill 名（它不带 id）。
function injectMessage(name: string, text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "skill-invocation", name, form: "instructions" },
  });
}

// surface 上最近一条该键注入的正文（含信封）；没有则 undefined——压缩掉它、或进程重启后 resume 折叠出它，
// 都由这一眼分辨。
function latestInjectText(agent: Agent, name: string): string | undefined {
  for (const seq of agent.session.surface.nodes.toReversed()) {
    const event = agent.session.eventAt(seq);
    if (event?.type !== "user/message") continue;
    const source = event.data.source as { readonly kind?: unknown; readonly name?: unknown };
    if (source.kind !== "skill-invocation" || source.name !== name) continue;
    const [block] = event.data.content;
    return event.data.content.length === 1 && block?.type === "text" ? block.text : "";
  }
  return undefined;
}

// 投影里的参数 schema：只留**约束与散文**之外的一切——`type` / `enum` / `oneOf` / `required` /
// `default` 这些照旧（它们是校验的一部分），剥掉的是 `description` / `title` / `examples` 这类
// 说明性字段（语义在组 skill 正文里讲一次）。
function slimSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(slimSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const {
    description: _description,
    title: _title,
    examples: _examples,
    ...rest
  } = schema as Record<string, unknown>;
  const properties = rest["properties"];
  if (typeof properties === "object" && properties !== null) {
    rest["properties"] = Object.fromEntries(
      Object.entries(properties as Record<string, unknown>).map(([key, value]) => [
        key,
        slimSchema(value),
      ]),
    );
  }
  for (const key of ["items", "additionalProperties"]) {
    if (key in rest) rest[key] = slimSchema(rest[key]);
  }
  return rest;
}

// 改写模型看到的工具投影：描述换成一行中文，参数只留约束（`type` / `enum` / `oneOf` / `required` / `default`），
// 说明性字段整段丢弃。改装配结果而不是注册表——注册同名工具会触发 `tools/change`，与上游 `tool-subagent` 的
// composition reconcile 互相触发会造成装配风暴式重入；投影只影响本次请求，晚注册的工具也照样能覆盖。
function shortenTools(tools: readonly ToolSchema[]): ToolSchema[] {
  return tools.map((tool) => {
    const description = SHORT_TOOL_DESCRIPTIONS[tool.name];
    return {
      ...tool,
      parameters: slimSchema(tool.parameters),
      ...(description === undefined ? {} : { description }),
    } as ToolSchema;
  });
}
