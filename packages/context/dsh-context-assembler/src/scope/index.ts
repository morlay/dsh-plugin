/**
 * 按**会话**收口：工具白名单、instruction 总开关、动态快照。
 *
 * 这是本包的 `scope` 出口（行 id `context-assembler-scope`）。它不再吃 config，也不认识"模式"这个概念——
 * 收口要什么由消费方在会话建立时**推**进来：`ctx.sessionToolScope.apply(agent, mode)`（
 * [`@morlay/dsh-session-mode`](../../../profile/dsh-session-mode/README.md) 的模式定义里正好是这几项）。
 * 方向因此是单向的：装配层读这个服务，这个包不认识装配层。
 *
 * `apply` 落到该 agent 身上的三件事，各走一条与"谁注册了这个工具"无关的路：
 *
 * 1. **装配期投影**（每次装配按已注册的那份）：模型目录与工具说明的 `tool:<工具名>` section 同源过滤；
 * 2. **执行层 guard**：落在 `agent.ctx` 上，调用被拒时给出该模式的文案；
 * 3. **通道开关**：`instructions` 关掉该会话的规则块（工作区指令、技能目录、用法正文）、
 *    `runtimeContext` 抑制该会话的动态快照（沙箱与审批策略那两条）。
 *
 * 为什么不用 `tools.restrict()`：它会改动可见工具集，从而触发 `tools/change`；上游 `tool-subagent` 正是用
 * 该事件做 composition reconcile——两边互相触发会变成装配风暴。这里用投影过滤加执行层 guard：既不碰注册
 * 表、也不发事件。
 *
 * 为什么按 `agent.ctx` 注册而不是先建一棵 preset 子树：会话的 persona / 工具收口本来就是"这个 agent 的
 * 事"，`agent.ctx` 的 scope 已经够了（上游给子 agent 装 persona 用的也是这条路）；一棵子树要连带上游的
 * `agent-presets` 注册表、每 revision 一份 Loader 与 `isolate` realm，模式本身用不上。
 *
 * 模式在空白窗口里可以切换，所以状态是**可替换**的：同一个 agent 再 `apply` 一次就是换一份——旧的
 * disposer 全部收回，再按新的装一遍。
 */

import { Service, type Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import z from "@deepseek-ai/schemastery";
import type {} from "../assembler/index.ts";

export const name = "context-assembler-scope";

/** 收口要的服务；`sessionToolScope` 由本行自己发布，`tools` 的 guard 挂在每个 agent 的 ctx 上。 */
export const inject = ["tools", "systemPrompt"];

/** 本行不吃 config：要收成什么样由消费方在 `apply` 时给。 */
export const Config = z.object({});

/** 一次收口的全部输入：模式定义里本出口用到的那几项。 */
export interface SessionToolScopeMode {
  /** 拒绝对话时用的模式名。 */
  readonly name: string;
  /** 这个会话能用的工具；其余既不进目录，调用也被拒。 */
  readonly allowTools: readonly string[];
  /** 缺省为要；`false` 表示这个会话不要任何 instruction 类注入。 */
  readonly instructions?: boolean | undefined;
  /** 缺省为要；`false` 表示这个会话不要动态快照。 */
  readonly runtimeContext?: boolean | undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessionToolScope: SessionToolScope;
  }
}

const OUT_OF_SCOPE = (toolName: string, modeName: string): string =>
  `${toolName} 不在「${modeName}」的工具范围内，用它不会有结果；按当前模式提供的工具完成任务，或让用户切到别的模式。`;

/** 单个工具的说明 section 名前缀：`tool:<工具名>`（`tools:` 那类是聚合块，不归白名单管）。 */
const TOOL_SECTION_PREFIX = "tool:";

/** 一个 agent 当前装着的那一份。 */
interface Applied {
  readonly mode: SessionToolScopeMode;
  /** 收回这一份在 `agent.ctx` 上的注册（抑制器与执行层 guard）。 */
  readonly dispose: () => void;
}

/** 通道是可选的搭档：没有它就没有 instruction 可关、也没人收窄技能目录，工具目录与执行 guard 照常生效。 */
function channelOf(ctx: Context):
  | {
      setInstructions(agent: Agent, on: boolean): void;
      restrictTools(agent: Agent, allowed: (tool: string) => boolean): void;
    }
  | undefined {
  try {
    return ctx.get("contextAssembler");
  } catch {
    return undefined;
  }
}

/** 按会话收口工具与注入的服务。 */
export class SessionToolScope extends Service {
  private readonly applied = new WeakMap<Agent, Applied>();

  constructor(ctx: Context) {
    super(ctx, "sessionToolScope");
    // 装配期过滤：这里只认已经 `apply` 过的会话；没登记过的（没装 session-mode 的部署）一律放行。
    ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
      const agent = context.agent;
      const applied = agent === undefined ? undefined : this.applied.get(agent);
      if (applied === undefined) return next();
      const allow = new Set(applied.mode.allowTools);
      const result = await next();
      return {
        ...result,
        // 工具自己的说明 section 与工具目录同源：目录里没有的工具，它的说明也不该留在提示词里。
        sections: result.sections.filter((section) =>
          section.name.startsWith(TOOL_SECTION_PREFIX)
            ? allow.has(section.name.slice(TOOL_SECTION_PREFIX.length))
            : true,
        ),
        tools: result.tools.filter((tool) => allow.has(tool.name)),
      };
    });
  }

  /**
   * 把某个会话收口到这份定义上（同一个 agent 再调就是换一份）。
   * @param agent - 目标会话的 agent。
   * @param mode - 收口的全部输入。
   */
  apply(agent: Agent, mode: SessionToolScopeMode): void {
    const previous = this.applied.get(agent);
    if (previous !== undefined) previous.dispose();
    const allow = new Set(mode.allowTools);

    // 落在 `agent.ctx` 上的那两件用一个 effect 装：抑制器是 scope 层的一次注册；执行层 guard 要等
    // `tools` 激活才装得上（`inject` 的回调），它挂在那个 inject fiber 下，所以收回时连 fiber 一起收。
    const dispose = agent.ctx.effect(() => {
      const stoppers: (() => void)[] = [];
      if (mode.runtimeContext === false) {
        // service 在 `agent.ctx` 上是 shadow：抑制落在该 agent 的 scope 层，只覆盖这个会话。
        stoppers.push(agent.ctx.systemPrompt.suppressRuntimeContext());
      }
      // 必须落在 `agent.ctx` 上才是这个会话的作用域。
      const fiber = agent.ctx.inject(["tools"], (scope) => {
        scope.tools.guard((exec) =>
          allow.has(exec.name) ? undefined : OUT_OF_SCOPE(exec.name, mode.name),
        );
      });
      return [...stoppers, () => fiber.dispose()];
    }, "sessionToolScope: per-session gate");

    // 与"谁注册了这个工具"无关的那两件：通道按 agent 覆盖，不需要收回。
    const channel = channelOf(this.ctx);
    channel?.setInstructions(agent, mode.instructions !== false);
    channel?.restrictTools(agent, (tool) => allow.has(tool));

    this.applied.set(agent, { mode, dispose });
  }
}

export function apply(ctx: Context): void {
  new SessionToolScope(ctx);
}
