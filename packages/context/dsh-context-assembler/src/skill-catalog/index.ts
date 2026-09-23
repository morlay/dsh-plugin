import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { isModelInvocable, isSkillName } from "@deepseek-ai/dsh-skill";
import type {} from "@deepseek-ai/dsh-tool-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "../assembler/index.ts";
import { renderVirtualSkill } from "../assembler/index.ts";

export const name = "context-skill-catalog";

export const inject = ["skills", "tools", "contextAssembler"];

export const CATALOG_ID = "skill-catalog";

/** 目录行里的描述长度上限（上游默认同值）。 */
const DESCRIPTION_MAX_LENGTH = 500;

/**
 * skill 目录 + `skill` 工具：目录是规则块（一行名字 + 摘要），正文按需加载。
 *
 * 目录只列模型可调用的 skill；`auto` 的 skill 标 `modelInvocable: false`，所以它不出现在目录里
 * （它的正文已经随提示送达）。工具的渲染用通道的虚拟 skill 形态，不带 `<skill_resources>`。
 */
export function apply(ctx: Context): void {
  /**
   * 本会话上次算出的目录条目：`source` 是同步的、正文是异步的，两者共用这一次计算的结果
   * （`collect` 里先算正文再取 source）。
   */
  const catalogEntries = new WeakMap<Agent, readonly { name: string; description: string }[]>();

  ctx.contextAssembler.registerRule({
    id: CATALOG_ID,
    // 对外身份沿用上游 kind：客户端标签与按 kind 认领的消费方认得这是技能目录，`entries` 就是
    // 目录行里发布的那份清单（非模型消费者照它列条目）。
    source: (agent) => ({
      kind: "skill-catalog",
      form: "catalog",
      entries: catalogEntries.get(agent) ?? [],
    }),
    text: async (agent) => {
      // 目录没了（工具不在、快照不全、一个 skill 都不可见）就把上次的条目也清掉：`source` 与正文同源。
      const noCatalog = (): string => {
        catalogEntries.delete(agent);
        return "";
      };
      // 依赖关系：没有 `skill` 工具（被白名单挡掉或被别的 composition 拿掉）时，目录没有意义——
      // 模型拿到了名字也加载不了。是否注入跟着工具走，而不是靠每个模式去列"不要哪些"。
      if (ctx.tools.get("skill", agent) === undefined) return noCatalog();
      // 必须带上会话的 cwd 与作用域：本地 skill 发现（`~/.agents/skills`、`{cwd}/.agents/skills`、
      // 项目根）由 preset 层的 `skill-filesystem` 行提供，host 层的同名行在 web 组合里是禁用的——
      // 不传作用域只看得见全局层（本仓库注册的运行时 skill），不传 cwd 连项目根都不扫。
      const snapshot = await ctx.skills.snapshot({
        cwd: agent.session.header.cwd,
        scope: agent,
      });
      if (!snapshot.complete) return noCatalog();
      // 技能也跟着工具走：依赖的工具一个都不可见的 skill 不进目录（模型看到名字也用不上）。
      const hidden = ctx.contextAssembler.hiddenSkills(
        (tool) => ctx.tools.get(tool, agent) !== undefined,
      );
      const skills = snapshot.skills
        .filter(isModelInvocable)
        .filter((skill) => !hidden.has(skill.name));
      if (skills.length === 0) return noCatalog();
      const entries = skills.map((skill) => ({
        name: skill.name,
        description: clamp(skill.description, DESCRIPTION_MAX_LENGTH),
      }));
      catalogEntries.set(agent, entries);
      return [
        "<available_skills>",
        ...entries.map((entry) => `- ${entry.name}: ${entry.description}`),
        "</available_skills>",
        "",
        "任务与某个 skill 说明匹配时，先加载它再行事。",
      ].join("\n");
    },
  });

  // 同名工具只能有一个所有者：host 层的 `tool-skill` 行由 patch 禁用，但万一没禁掉（上游改了行 id、
  // 或别的 bundle 又插了一份），重复注册会让 tools/change 抖动甚至让 session 创建失败——所以先看清
  // 注册表里有没有，有就让给对方，我们只负责目录。
  if (ctx.tools.get("skill") !== undefined) {
    ctx.logger.warn(
      "context-skill-catalog: a `skill` tool is already registered; keeping the existing one and only publishing the catalog",
    );
  } else {
    registerSkillTool(ctx);
  }
}

function registerSkillTool(ctx: Context): void {
  const skillTool = defineTool({
    name: "skill",
    description: "按需加载 skill 的完整说明。",
    parameters: {
      name: { type: "string", required: true, description: "技能目录里的 skill 名。" },
    },
    output: {
      // 与上游 `tool-skill` 的输出**同形**（`additionalProperties: false`，少一个字段就是校验不过）：
      // 客户端按这个结构渲染 skill 结果，缺 `provider` 会让那次调用直接失败。
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", required: true },
          provider: { type: "string", required: true },
          resourceBase: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", required: true, const: "directory" },
                  path: { type: "string", required: true },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", required: true, const: "url" },
                  url: { type: "string", required: true },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", required: true, const: "opaque" },
                  description: { type: "string", required: true },
                },
              },
            ],
          },
          content: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        { type: "text", text: renderVirtualSkill(value.name, value.content) },
      ],
    },
    async execute(args, exec) {
      if (!isSkillName(args.name)) throw new Error(`invalid skill name "${args.name}"`);
      const lookup = {
        cwd: exec.agent?.session.header.cwd,
        signal: exec.signal,
        scope: exec.agent,
      };
      const skill = await ctx.skills.get(args.name, lookup);
      if (skill === undefined)
        throw new Error(`skill "${args.name}" is unknown or no longer available`);
      if (!isModelInvocable(skill))
        throw new Error(`skill "${args.name}" is not available for model invocation`);
      // 注册表里那份是不过滤的全量（技能注册是装配期一次），按需加载时按这个会话重算一份：
      // 组正文不该讲这个会话没装的工具。
      const content = ctx.contextAssembler.contentFor(skill.name, exec.agent) ?? skill.content;
      return { name: skill.name, provider: skill.provider, content };
    },
    presentCall(args) {
      return {
        card: "generic",
        title: `Load skill ${args.name}`,
        kind: "read",
        rawInput: args.name,
      };
    },
  });
  ctx.tools.register(skillTool);
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
