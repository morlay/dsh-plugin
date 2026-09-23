import type { Context } from "@deepseek-ai/cordis";
import type { ToolSchema } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import type {} from "../assembler/index.ts";
import { SHORT_TOOL_DESCRIPTIONS, TOOL_GROUPS, groupSkillBody, skillNameOf } from "./groups.ts";

export const name = "context-tool-guidance";

export const inject = ["tools", "systemPrompt", "contextAssembler"];

export interface Config {
  /**
   * 是否注册用法分组（组 skill）。模式只想复用**工具预处理**（描述汉化 + 剥掉参数说明）而不要用法注入时，
   * 把它关掉——chat 就是这样：它连 skill 工具都没有。
   */
  groups?: boolean;
}

export const Config: z<Config> = z.object({ groups: z.boolean().default(true) });

/**
 * 工具的两件事：
 *
 * 1. **预处理**（所有模式都要）：把上游的工具描述换成一行中文、剥掉参数里的说明性字段——它们常驻请求，
 *    是最大的一段开销；
 * 2. **用法分组**（模式可选，`config.groups`）：把用法按组切开交给注入通道，`base` 组正文常驻、其余注册成
 *    按需 skill。chat 只复用前者。
 */
export function apply(ctx: Context, config: Config): void {
  if (config.groups ?? true) {
    // 被丢弃的上游说明：要点已吸收进组正文，原文不再进提示词。
    for (const group of TOOL_GROUPS) {
      for (const section of group.drops) ctx.contextAssembler.suppressSection(section);
    }
  }

  for (const group of (config.groups ?? true) ? TOOL_GROUPS : []) {
    ctx.contextAssembler.registerSkill({
      name: skillNameOf(group.key),
      title: group.title,
      description: group.skillDescription,
      // 按会话修剪：只写这个会话真的能用的工具（chat 的 base 正文只有它那三个）。
      content: (agent) =>
        groupSkillBody(
          group,
          agent === undefined ? () => true : (tool) => ctx.tools.get(tool, agent) !== undefined,
        ),
      injection: group.injection,
      // 该组的入口工具一个都不可见时，这个 skill 也不该出现在技能目录里（组内混了两套来源时由组自己
      // 声明入口，见 `ToolGroup.requires`）。
      requires: group.requires ?? group.tools,
    });
  }

  ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const result = await next();
    return { ...result, tools: shortenTools(result.tools) };
  });
}

/**
 * 投影里的参数 schema：只留**约束与散文**之外的一切——`type` / `enum` / `oneOf` / `required` /
 * `default` 这些照旧（它们是校验的一部分），剥掉的是 `description` / `title` / `examples` 这类
 * 说明性字段（语义在组 skill 正文里讲一次）。
 */
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

/**
 * 改写模型看到的工具投影：描述换成一行中文，参数只留约束。
 *
 * 改的是装配结果（`assembly.tools`）而不是注册表：在 agent 作用域注册同名工具会同步触发
 * `tools/change`，而上游 `tool-subagent` 正是用该事件做 composition reconcile
 * （`tool-subagent/src/index.ts:710`）——两个插件互相触发会让装配风暴式重入，把 session 创建卡死。
 * 装配投影只影响本次请求，不碰注册表，因此没有这个回响；晚注册的工具也照样能覆盖。
 *
 * 参数的说明性字段（description / title / examples）整段丢弃、而不是翻译成中文：schema 常驻，
 * 参数语义（窗口、唯一性、边界）属于用法，归组 skill 正文讲一次；留在 schema 里等于同一件事在请求里
 * 说两遍，而上游那些英文描述正是最占地方的一段。约束字段（type / enum / oneOf / required / default）全留。
 */
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
