// 工具说明的汉化：模型看到的**工具描述**必须是一行中文，参数 schema 里只留约束
// （`description` / `title` 这类说明性字段剥掉，语义在组正文里讲一次）。
//
// 改写落在**工具定义对象本身**上（与源包同一手法）：装配瀑布不再承载工具声明，而 `llm/stream` 的
// options 是上游冻结过的——在监听器里写 `options.tools` 会抛只读错误。定义对象可变，改它的
// `description` / `parameters` 就等于改了 `executor.describe()` 的输出（模型面），
// 而不经过 `tools.register`、也不触发 `tools/change` 重入。
//
// 执行期的输入校验用的是 `defineTool` 闭包里那份原 schema，不受这里替换影响。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { ToolDefinition } from "@morlay/dsh-agent/contract";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { ToolRegistry } from "@morlay/dsh-agent";
import { SHORT_TOOL_DESCRIPTIONS } from "./guidance/groups.ts";
import { constantMessage, latestConstantText, renderConstantReminder } from "./reminder.ts";
import { SessionMode } from "./contract/session-mode.contract.ts";
import { ContextAssembler } from "./contract/context-assembler.contract.ts";
import { AgentCreated, AgentPreStep, SystemPromptAssemble, ToolsChanged } from "./events.ts";
import {
  TOOL_GROUPS,
  groupSkillBody,
  renderToolsDeclaration,
  type ToolGroup,
} from "./guidance/groups.ts";
import { PTC_ONLY_SECTION, RUN_CODE_NAME } from "./guidance/tool-groups.ts";
import { jsonSchemaToTs } from "@morlay/dsh-ptc/contract";
import { projectToolSchema } from "@morlay/dsh-agent/contract";

// 常驻正文的幂等键：所有 `init` 组合并成这一条。
const BASELINE_KEY = "tool-group-baseline";

// 常驻正文的开场说明：签名块怎么用、哪些组要现取。
const BASELINE_PREAMBLE =
  "`tools.*` 的签名：下面每个组都已给出完整的 d.ts 代码块，**直接按签名调用**，不要再用 `describe_tool` 查这些组。" +
  "这里没列出的组一律 `describe_tool()` 看清单（每组一行判据），再 `describe_tool({ group })` 取那一组——不要在代码里写死组名。" +
  "程序里的变量名必须唯一（`const a = await tools.read(...)`、`const b = …`，或直接 `await tools.read(...)` 不赋值）：同一个名字声明两次会直接 SyntaxError。";

// 一个组的签名块：组内**已可见**的工具各出一条声明（说明用那一行中文当 doc）。
function groupTypeDeclaration(
  group: ToolGroup,
  definitions: ReadonlyMap<string, ToolDefinition>,
  visible: (tool: string) => boolean,
): string {
  const signatures = group.tools
    .map((entry) => entry.tool)
    .filter((name) => visible(name) && definitions.has(name))
    .map((name) => {
      const definition = definitions.get(name) as ToolDefinition;
      const short = SHORT_TOOL_DESCRIPTIONS[name];
      return {
        name,
        args: jsonSchemaToTs(projectToolSchema(definition, false).parameters),
        output: jsonSchemaToTs(definition.output?.schema ?? {}),
        ...(short === undefined ? {} : { doc: short }),
      };
    });
  return renderToolsDeclaration(signatures);
}

// 已经改写过的定义：同一个对象只改一次（`tools/change` 会反复来）。
const projected = new WeakSet<object>();

// 参数 schema 里要剥掉的说明性字段：约束（`type` / `enum` / `required` / `default`）一个都不动。
const PROSE_KEYS = ["description", "title", "examples"] as const;

/** 剥掉说明性字段，保留约束。 */
export function slimSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(slimSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const rest = { ...(schema as Record<string, unknown>) };
  for (const key of PROSE_KEYS) delete rest[key];
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

/** 改写一条工具定义（描述汉化 + 参数精简）。已经改过的不重复改。 */
export function projectDefinition(definition: ToolDefinition): void {
  if (projected.has(definition)) return;
  projected.add(definition);
  const description = SHORT_TOOL_DESCRIPTIONS[definition.name];
  if (description !== undefined) {
    Object.defineProperty(definition, "description", {
      value: description,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
  Object.defineProperty(definition, "parameters", {
    value: slimSchema(definition.parameters),
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

/**
 * 工具说明的汉化行：把全局与会话内的工具定义换成中文描述、精简参数。
 *
 * 落点是**定义对象**（不是装配结果、也不是注册表），因为模型面最终由执行器的 `describe()` 读定义算出来。
 * 三个时机各管一段：
 * - `agent/created`：会话建好时把**这个会话**的工具改一遍（第一次装配之前）；
 * - `tools/change`（会话级）：团队、schedule 这类行在会话建好**之后**才注册工具，全局事件看不到它们；
 * - `tools/change`（全局）+ `onInit`：全局注册表里的工具；
 * - `system-prompt/assemble`：会话内晚注册的（MCP 重连、skill 重载）赶不上前三个，每次装配补一次
 *   ——本次装配的声明已按旧定义收集过了，所以从**下一次**请求开始生效。
 */
/** 这一行的配置：`groups` 是**部署级**开关（本行装在 root，所有会话共用一份）。 */
export interface ToolGuidanceConfig {
  /**
   * 是否做**用法分组**（组 skill + `init` 组正文的常驻注入）。
   *
   * 关掉只保留**预处理**（工具描述换一行中文、剥掉参数里的说明性字段）——只想复用汉化、
   * 不要按步注入的部署把这一项关掉。分组正文会改变 system 前缀，逐 token 计费与缓存都受影响，
   * 所以它是显式开关而不是恒开。
   */
  readonly groups?: boolean;
}

function configWithDefaults(input: ToolGuidanceConfig = {}): Required<ToolGuidanceConfig> {
  return { groups: input.groups ?? true };
}

@Injectable()
export class ToolGuidance implements OnInit {
  static Config = configWithDefaults;

  private readonly config: Required<ToolGuidanceConfig>;

  private readonly tools = inject(ToolRegistry);

  private readonly channel = inject(ContextAssembler);

  private readonly modes = inject.optional(SessionMode);

  private readonly created$ = new AgentCreated();

  private readonly assemble$ = new SystemPromptAssemble();

  private readonly changed$ = new ToolsChanged();

  private readonly preStep$ = new AgentPreStep();

  // 这些会话的模型面只有 `run_code`（PTC）：正文的可见判据要给它豁免。
  private readonly ptcAgents = new WeakSet<Agent>();

  constructor(input: ToolGuidanceConfig = {}) {
    this.config = configWithDefaults(input);
  }

  onInit(_ctx: Context): void {
    const projectAll = (agent?: Agent): void => {
      for (const definition of this.tools.definitions(agent)) projectDefinition(definition);
    };

    // 全局注册表：现在有的 + 之后注册的。
    projectAll();
    this.changed$.on(() => projectAll());

    // 每个会话：建好时改一遍，并跟这个会话自己的 `tools/change`。
    //
    // 监听挂在 **`agent.ctx`** 上（随会话收回）：团队、schedule 这类行在建好会话**之后**才把工具注册进
    // agent scope，全局那条 `tools/change` 看不到它们。`agent.ctx` 的类型面是 cordis 的 `Context`
    // （缺 `on`），这里按我们的 `Context` 收口一次。
    this.created$.on(({ agent }) => {
      projectAll(agent);
      const scoped = agent.ctx as unknown as Context;
      scoped.effect(() => scoped.on("tools/change", () => projectAll(agent)));
    });

    // 装配时补一次（晚注册的工具）。改的是定义对象，所以对**下一次**请求生效。
    //
    // 同时认出 PTC：执行器把模型面收窄成 `run_code` 一条，装配期唯一能看到的信号就是它注册的那条
    // section。读**入参**那份（原始装配）：通道会把非 keep 的 section 降级成 reminder，`result` 里看不到它。
    this.assemble$.onWaterfall(async (assembly, context, next) => {
      const agent = (context as { agent?: Agent }).agent;
      if (agent !== undefined) {
        projectAll(agent);
        if (assembly.sections.some((section) => section.name === PTC_ONLY_SECTION)) {
          this.ptcAgents.add(agent);
        }
      }
      return next();
    });

    // `groups: false`：只留**预处理**。不注册组 skill、不丢上游 section、不注入常驻正文——
    // 那条路会改 system 前缀（逐 token 计费与缓存都受影响），所以由部署显式选。
    if (!this.config.groups) return;

    // **不再把按需组注册成 skill**：`describe_tool({ group })` 已经能返回该组的用法正文与 d.ts，
    // skill 目录里的 `tool-group-*` 只是同一份说明的第二个入口（多一个目录项、多一次加载、多一处漂移）。
    // 组正文的读取路径因此只有两条：`init` 组的常驻注入，与 `describe_tool` 的按需返回。

    // 被丢弃的上游说明：要点已吸收进组正文，原文不再进提示词。
    for (const group of TOOL_GROUPS) {
      for (const section of group.drops) {
        _ctx.effect(() => this.channel.suppressSection(section));
      }
    }

    // `init` 组的正文按会话常驻注入（一次一条，幂等键固定）：多组各发一条会把对话流打散。
    // 注入判据是**这个会话装配结果里最终可见的工具**：收窄掉的工具不列。
    // 每组的正文后面跟它的 d.ts 签名块（模型据此直接调用，不必再 `describe_tool` 查一次）。
    this.preStep$.onWaterfall(async ({ agent, messages, signal }, next) => {
      const decision = await next();
      if (decision.kind !== "enter") return decision;
      const visible = new Set(this.visibleToolsOf(agent));
      const keep = (tool: string): boolean => visible.has(tool);
      const definitions = new Map(
        this.tools.definitions(agent).map((definition) => [definition.name, definition]),
      );
      const sections: string[] = [BASELINE_PREAMBLE];
      for (const group of TOOL_GROUPS) {
        if (group.injection !== "init") continue;
        const body = groupSkillBody(group, keep);
        if (body.length === 0) continue;
        const type = groupTypeDeclaration(group, definitions, keep);
        sections.push(
          [
            `<tool-definitions group="${group.key}">`,
            "",
            body,
            ...(type.length === 0 ? [] : ["", "```ts", type, "```"]),
            "",
            "</tool-definitions>",
          ].join("\n"),
        );
      }
      if (sections.length === 1) return decision;
      const text = renderConstantReminder(sections.join("\n\n"));
      if (latestConstantText(agent, BASELINE_KEY) === text) return decision;
      signal.throwIfAborted();

      // 落点：本步认领的用户消息**之后**（不是列表末尾）。
      const claimedEnd = decision.messages.findLastIndex((message) => messages.includes(message));
      return {
        ...decision,
        messages: decision.messages.toSpliced(
          claimedEnd + 1,
          0,
          constantMessage(BASELINE_KEY, text),
        ),
      };
    });
  }

  // 这个会话装配结果里最终可见的工具：模式的名单收窄之后的注册表集合。
  // 没有 `SessionMode`（或它还没收口过）时退回注册表全量。
  // `run_code` 豁免：它是 PTC 的入口，不在注册表里，但程序内可用。
  private visibleToolsOf(agent: Agent): readonly string[] {
    const modes = this.modes;
    const known =
      modes === undefined
        ? this.tools.definitions(agent).map((definition) => definition.name)
        : modes.knownToolsOf(agent);
    return this.ptcAgents.has(agent) ? [...known, RUN_CODE_NAME] : known;
  }
}
