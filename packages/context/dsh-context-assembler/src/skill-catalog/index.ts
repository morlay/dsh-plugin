import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { isModelInvocable, isSkillName } from "@deepseek-ai/dsh-skill";
import type {} from "@deepseek-ai/dsh-tool-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "../assembler/index.ts";
import { renderVirtualSkill } from "../assembler/index.ts";

export const name = "context-skill-catalog";

export const inject = ["agents", "skills", "tools", "contextAssembler"];

export const CATALOG_ID = "skill-catalog";

/** 目录行里的描述长度上限（上游默认同值）。 */
const DESCRIPTION_MAX_LENGTH = 500;

/**
 * skill 目录 + `skill` 工具：目录是规则块（一行名字 + 摘要），正文按需加载。
 *
 * 目录只列模型可调用的 skill；`auto` 的 skill 标 `modelInvocable: false`，所以它不出现在目录里
 * （它的正文已经随提示送达）。工具的渲染用通道的虚拟 skill 形态，不带 `<skill_resources>`。
 *
 * **这一面归通道**（工作区指令那一面相反，是让位给 preset）：官方 preset 自己装了上游 `tool-skill`，那份
 * 注册在 preset 的 scope 层；我们把 `skill` 工具按会话注册进 **agent 自己那一层**——它最靠里，同名注册遮蔽
 * 继承来的那一份（[`core/tools/src/index.ts:1185-1207`](../../../vendor/deepseek-harness/packages/core/tools/src/index.ts)），
 * 于是模型看到的是我们的工具（中文描述 + 按会话修剪的正文）。上游的目录发布判据是"它自己注册的那个工具是
 * 本会话可见的那个"（[`skill/tool-skill/src/index.ts:213-236`](../../../vendor/deepseek-harness/packages/skill/tool-skill/src/index.ts)），
 * 被遮蔽之后它闭嘴，目录由我们发布；`minimal`（`chat`）那种没有上游行的会话里也只有我们这一份。
 */
export function apply(ctx: Context): void {
  /**
   * 本会话上次算出的目录条目：`source` 是同步的、正文是异步的，两者共用这一次计算的结果
   * （`collect` 里先算正文再取 source）。
   */
  const catalogEntries = new WeakMap<Agent, readonly { name: string; description: string }[]>();

  // 同名工具只能有一个所有者：host 平面已经有人注册了 `skill`（装上游 `tool-skill` 的部署）就让给它，
  // 我们只发布目录。我们的部署里 host 平面那一行是禁用的（preset 才装），所以走的是下面这条。
  const skillTool = ctx.tools.get("skill") === undefined ? defineSkillTool(ctx) : undefined;
  if (skillTool === undefined) {
    ctx.logger.warn(
      "context-skill-catalog: a `skill` tool is already registered; keeping the existing one and only publishing the catalog",
    );
  } else {
    // 按会话注册：`register` 落到**调用它的那个 ctx** 的 scope 层（agent 自己那一层），随 agent 收回。
    const install = (agent: Agent): void => {
      // 本行重装（HMR / 设置面）时上次那份注册还在 agent 自己那一层（它随 agent 而不是随本行收回）：
      // 同一份定义就不要再注册一次——同一层重复注册会抛（`dsh-scope` 的 `NamedEntries.insert`）。
      if (ctx.tools.get("skill", agent) === skillTool) return;
      try {
        agent.ctx.tools.register(skillTool);
      } catch (error) {
        // agent 自己那一层被更具体的注册占了：让开（它自己会发目录），我们这一份注册不上。
        ctx.logger.warn(`context-skill-catalog: ${String(error)}`);
      }
    };
    ctx.on("agent/created", ({ agent }) => {
      install(agent);
    });
    for (const agent of ctx.agents.list()) install(agent);
  }

  ctx.contextAssembler.registerRule({
    id: CATALOG_ID,
    // 对外身份**用我们自己的 kind**（不是上游那个 `skill-catalog`）：目录的正文与条目都由我们发布，而上游
    // `tool-skill` 的目录监听器把任何 `kind: 'skill-catalog'` 且条目可读的消息都当成**它自己的**账本
    // （`catalogMessage` / `catalogHistory`），于是它会删掉我们这一条（首步：`!history.published &&
    // skills.length === 0` 那条分支）或者补一条"没有可用 skill"的空目录把它顶掉（它有可见目录之后）。
    // 形态仍是它认得的 `catalog`（`entries` 是客户端列条目的那份清单），只是 kind 归我们——
    // 它的两个扫法都只看 kind，于是本会话里它彻底闭嘴。
    source: (agent) => ({
      kind: "context-assembler",
      form: "catalog",
      entries: catalogEntries.get(agent) ?? [],
    }),
    text: async (agent) => {
      // 目录没了（工具不在、快照不全、一个 skill 都不可见）就把上次的条目也清掉：`source` 与正文同源。
      const noCatalog = (): string => {
        catalogEntries.delete(agent);
        return "";
      };
      // "谁能用"要连模式的白名单一起算（注册表里有不等于这个会话能用），否则被收窄的工具还会留下技能目录。
      const visible = ctx.contextAssembler.visibleTools(
        agent,
        (tool) => ctx.tools.get(tool, agent) !== undefined,
      );
      // 依赖关系：没有 `skill` 工具（被白名单挡掉或被别的 composition 拿掉）时，目录没有意义——
      // 模型拿到了名字也加载不了。是否注入跟着工具走，而不是靠每个模式去列"不要哪些"。
      if (!visible("skill")) return noCatalog();
      // 必须带上会话的 cwd 与作用域：本地 skill 发现（`~/.agents/skills`、`{cwd}/.agents/skills`、
      // 项目根）由 preset 层的 `skill-filesystem` 行提供，host 层的同名行在 web 组合里是禁用的——
      // 不传作用域只看得见全局层（本仓库注册的运行时 skill），不传 cwd 连项目根都不扫。
      const snapshot = await ctx.skills.snapshot({
        cwd: agent.session.header.cwd,
        scope: agent,
      });
      if (!snapshot.complete) return noCatalog();
      // 技能也跟着工具走：依赖的工具一个都不可见的 skill 不进目录（模型看到名字也用不上）。
      const hidden = ctx.contextAssembler.hiddenSkills(visible);
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
}

/** 一份工具定义，按会话注册进每个 agent 的自己那一层（同一个定义对象，判据里的同一性靠它）。 */
function defineSkillTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
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
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
