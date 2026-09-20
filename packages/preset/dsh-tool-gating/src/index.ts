import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-commands";
import { createUserMessage, type ToolSchema, type UserMessage } from "@deepseek-ai/dsh-llm";
import { scopeChainOf, scopeOf } from "@deepseek-ai/dsh-scope";
import type { Session } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  ENABLE_TOOLS_DESCRIPTION,
  REPLACED_SECTION_TEXTS,
  renderCatalog,
  renderEnableResult,
  renderLevel,
} from "./catalog.ts";
import {
  BASE_GROUP_KEY,
  ENABLE_TOOLS_NAME,
  GROUP_KEYS,
  IGNORED_SECTIONS,
  SHORT_TOOL_DESCRIPTIONS,
  deniedToolReason,
  guidanceOf,
  isGroupKey,
  normalizeGroups,
  type GroupKey,
} from "./groups.ts";

export const name = "tool-gating";

export const inject = ["agents", "tools", "systemPrompt"];

export interface Config {
  /** 会话起始档位：基础组之外默认启用的组。模式 preset 在这里给出自己的默认能力。 */
  initial?: string[];
}

export const Config: z<Config> = z.object({
  initial: z.array(z.string()).default([]),
});

export const LEVEL_COMMAND = "tools";

const CATALOG_SECTION = "tool-gating:catalog";
const CATALOG_ORDER = 700;
const GUIDANCE_SECTION = "tool-gating:guidance";
const GUIDANCE_ORDER = 710;
const MASK_ORDER = 720;
const NO_AGENT_TEXT = "无法启用工具组：本次调用没有归属的 Agent。";
const LEVEL_COMMAND_HINT = "[groups...]";

/** 本插件的档位切换消息：给模型看中文说明，给重建看结构化的组。 */
export interface LevelSource {
  kind: "tool-gating";
  groups: GroupKey[];
}

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "tool-gating": LevelSource;
  }
}

/** 从落库的调用参数里取组名；参数可能被截断，也可能不是本工具的载荷。 */
function groupsFromArguments(argumentsJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch (error: unknown) {
    void error;
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const groups: unknown = (parsed as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter((group): group is string => typeof group === "string");
}

/** 一次档位变更：`set` 替换（slash command），`add` 并集（`enable_tools`）。 */
interface LevelChange {
  readonly seq: number;
  readonly kind: "set" | "add";
  readonly groups: readonly string[];
}

function levelChanges(session: Session): LevelChange[] {
  const callArguments = new Map<string, string>();
  for (const event of session.snapshotEvents()) {
    if (event.type !== "tool/call" || event.data.name !== ENABLE_TOOLS_NAME) continue;
    callArguments.set(event.data.callId, event.data.arguments);
  }
  const changes: LevelChange[] = [];
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq);
    if (event === undefined) continue;
    if (event.type === "user/message" && event.data.source.kind === "tool-gating") {
      changes.push({ seq: Number(seq), kind: "set", groups: event.data.source.groups });
      continue;
    }
    if (event.type !== "tool/result" || event.data.error !== undefined) continue;
    const callId = event.data.message.content[0]?.toolCallId;
    const argumentsJson = callId === undefined ? undefined : callArguments.get(callId);
    if (argumentsJson !== undefined) {
      changes.push({ seq: Number(seq), kind: "add", groups: groupsFromArguments(argumentsJson) });
    }
  }
  return changes.toSorted((left, right) => left.seq - right.seq);
}

/**
 * 重建档位：以 `initial` 起步，随后按 surface 上的先后顺序应用每次变更。
 * 只认当前 surface 上的记录，rewind 截断后那次变更随之消失。
 */
export function unlockedFromSession(session: Session, initial: readonly GroupKey[]): GroupKey[] {
  let unlocked: GroupKey[] = [...initial];
  for (const change of levelChanges(session)) {
    const groups = normalizeGroups(change.groups);
    if (change.kind === "set") unlocked = groups;
    else unlocked = [...unlocked, ...groups.filter((key) => !unlocked.includes(key))];
  }
  return unlocked;
}

export function levelMessage(groups: readonly GroupKey[]): UserMessage {
  return createUserMessage({
    content: [{ type: "text", text: renderLevel(groups) }],
    source: { kind: "tool-gating", groups: [...groups] },
  });
}

interface GatingState {
  readonly agent: Agent;
  /** agent 作用域内的注册面；inject 回调就绪前为 undefined。 */
  scope: Context | undefined;
  unlocked: GroupKey[];
}

/**
 * 用中文短描述改写模型看到的工具投影。
 *
 * 改的是装配结果（`assembly.tools`）而不是注册表：在 agent 作用域注册同名工具会同步触发
 * `tools/change`，而上游 `tool-subagent` 正是用该事件做 composition reconcile
 * （`tool-subagent/src/index.ts:710`）——两个插件互相触发会让装配风暴式重入，把 session 创建卡死。
 * 装配投影只影响本次请求，不碰注册表，因此没有这个回响；晚注册的工具也照样能覆盖。
 */
function shortenTools(tools: readonly ToolSchema[]): ToolSchema[] {
  return tools.map((tool) => {
    const description = SHORT_TOOL_DESCRIPTIONS[tool.name];
    return description === undefined ? tool : { ...tool, description };
  });
}

/** 忽略上游逐个工具的说明：在 agent 作用域用同名空文本遮蔽，改由按组提示替代。 */
function maskUpstreamGuidance(scope: Context): void {
  for (const sectionName of IGNORED_SECTIONS) {
    scope.systemPrompt.section({ name: sectionName, order: MASK_ORDER, text: "" });
  }
}

/** 解析 slash command 的输入：不带参数即回到基础组。 */
function parseLevelInput(rawInput: string): { groups: GroupKey[] } | { error: string } {
  const requested = rawInput.trim();
  if (requested === "") return { groups: [] };
  const tokens = requested.split(/\s+/);
  const unknown = tokens.filter((token) => !isGroupKey(token) || token === BASE_GROUP_KEY);
  if (unknown.length > 0) {
    return {
      error:
        `不认得的组：${unknown.join("、")}。可用组：${GROUP_KEYS.join("、")}；` +
        `不带参数即回到 ${BASE_GROUP_KEY}。`,
    };
  }
  return { groups: normalizeGroups(tokens) };
}

export function apply(ctx: Context, config: Config): void {
  const initialKeys = config.initial ?? [];
  const invalidInitial = initialKeys.filter((key) => !isGroupKey(key) || key === BASE_GROUP_KEY);
  if (invalidInitial.length > 0) {
    throw new Error(
      `tool-gating: initial names unknown group(s) ${invalidInitial.map((key) => `"${key}"`).join(", ")}; ` +
        `known groups: ${GROUP_KEYS.join(", ")} (base is implied and must be omitted)`,
    );
  }
  const initial = normalizeGroups(initialKeys);
  const states = new WeakMap<Agent, GatingState>();

  ctx.systemPrompt.section({
    name: CATALOG_SECTION,
    order: CATALOG_ORDER,
    text: (context) => {
      const agent = context.agent;
      const state = agent === undefined ? undefined : states.get(agent);
      if (agent === undefined || state === undefined) return "";
      return renderCatalog(
        state.unlocked,
        (toolName) => ctx.tools.get(toolName, agent) !== undefined,
      );
    },
  });

  ctx.systemPrompt.section({
    name: GUIDANCE_SECTION,
    order: GUIDANCE_ORDER,
    text: (context) => {
      const agent = context.agent;
      const state = agent === undefined ? undefined : states.get(agent);
      if (state === undefined) return "";
      return guidanceOf(
        state.unlocked,
        (toolName) => ctx.tools.get(toolName, state.agent) !== undefined,
      ).join("\n");
    },
  });

  ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const result = await next();
    return {
      ...result,
      tools: shortenTools(result.tools),
      sections: result.sections.map((section) => {
        const text = REPLACED_SECTION_TEXTS[section.name];
        return text === undefined ? section : { ...section, text };
      }),
    };
  });

  ctx.tools.register(
    defineTool({
      name: ENABLE_TOOLS_NAME,
      description: ENABLE_TOOLS_DESCRIPTION,
      parameters: {
        groups: {
          type: "array",
          required: true,
          description: "要启用的能力组 key，可一次给多个：base、flow、web、team。",
          items: { type: "string", enum: [...GROUP_KEYS] },
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(args, exec) {
        const agent = exec.agent;
        const state = agent === undefined ? undefined : states.get(agent);
        if (agent === undefined || state === undefined) return NO_AGENT_TEXT;
        const added = normalizeGroups(args.groups).filter(
          (group) => !state.unlocked.includes(group),
        );
        if (added.length > 0) state.unlocked = [...state.unlocked, ...added];
        return renderEnableResult(state.unlocked, added);
      },
    }),
  );

  ctx.inject(["commands", "tools", "systemPrompt"], (commandCtx) => {
    commandCtx.commands.register({
      name: LEVEL_COMMAND,
      description: "查看或切换本会话的能力组（增强工具）",
      input: { hint: LEVEL_COMMAND_HINT },
      handler: ({ agent, rawInput }) => {
        const state = states.get(agent);
        if (state === undefined) return { kind: "error", text: "当前会话没有可切换的档位。" };
        const parsed = parseLevelInput(rawInput);
        if ("error" in parsed) return { kind: "error", text: parsed.error };
        state.unlocked = [...parsed.groups];
        agent.session.append("user/message", levelMessage(parsed.groups), {
          surfaceOp: "append",
        });
        return { kind: "success", text: renderLevel(parsed.groups) };
      },
    });
  });

  const install = (agent: Agent): void => {
    if (states.has(agent)) return;
    const state: GatingState = {
      agent,
      scope: undefined,
      unlocked: unlockedFromSession(agent.session, initial),
    };
    states.set(agent, state);
    agent.ctx.inject(["tools", "systemPrompt"], (scope) => {
      state.scope = scope;
      maskUpstreamGuidance(scope);
      // guard 读 state 里的档位，所以切换只改提示与这里的判定，不动工具目录。
      scope.tools.guard((exec) => deniedToolReason(state.unlocked, exec.name));
    });
  };

  const presetKey = scopeOf(ctx);
  const belongs = (agent: Agent): boolean => {
    if (presetKey === undefined) return true;
    const key = scopeOf(agent.ctx);
    return key !== undefined && scopeChainOf(key).includes(presetKey);
  };

  for (const agent of ctx.agents.list()) {
    if (belongs(agent)) install(agent);
  }
  ctx.on("agent/created", ({ agent }) => {
    install(agent);
  });
}
