import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { scopeChainOf, scopeOf } from "@deepseek-ai/dsh-scope";
import z from "@deepseek-ai/schemastery";
import type {} from "../assembler/index.ts";

export const name = "context-scope";

export const inject = ["tools", "systemPrompt"];

export interface Config {
  /** 只保留这些工具；其余（含 host 层 bundle 加进来的）既不进模型目录，也调用不了。 */
  allowTools?: string[];
  /**
   * 是否要 instruction 类的注入（工作区指令、技能目录、用法正文那类规则块）。缺省要；
   * `false` 表示这个模式不要任何 instructions——对话模式就是它。
   *
   * 关的是**规则块与降级 section**（通道的 `setInstructions`）；内容块（`auto` 组正文、引用材料）
   * 不受这个开关管，要靠对应的注入方自己不注册（chat 同时给了 `groups: false`）。
   * 注意这与工具白名单是两件事：工具没给，跟着它的注入本来就该自己关（见各注入包对 requires 的判断）；
   * 这里是"连与工具无关的 instruction 也不要"的总开关。
   */
  instructions?: boolean;
  /**
   * 是否要 runtime context（动态快照：文件沙箱策略、审批策略）。缺省要；`false` 表示这个模式不要它们
   * ——对话模式没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"对它全是噪音。
   *
   * 抑制是**按 scope** 的（上游按装配的 scope 链查抑制器），所以本行装在 preset 子树里就只作用于这个
   * 模式的会话；它只挡注入，不改任何提供方的行为（沙箱该怎么判还怎么判）。
   */
  runtimeContext?: boolean;
}

export const Config: z<Config> = z.object({
  allowTools: z.array(z.string()).default([]),
  instructions: z.boolean().default(true),
  runtimeContext: z.boolean().default(true),
});

const OUT_OF_SCOPE = (toolName: string): string =>
  `${toolName} 不在本模式的工具范围内，用它不会有结果；按当前模式提供的工具完成任务，或让用户切到别的模式。`;

/**
 * 把某个 preset 的工具收成"只有这些"。
 *
 * 为什么需要它：preset composition 只能决定"加什么"，管不了 host 层——`dsh.profile.bundles` 打开的
 * bundle（例如实验性的 Agent Teams）会在 host 层插工具行与 section，对所有 preset 一视同仁。模式想
 * 表达"我只有这几个工具、一条提示词都不要"时，唯一与来源无关的做法是收口"有什么"。
 *
 * 为什么不是 `tools.restrict()`：它会改动可见工具集，从而触发 `tools/change`；上游 `tool-subagent`
 * 正是用该事件做 composition reconcile——两边互相触发会变成装配风暴。这里用投影过滤加执行层 guard：
 * 既不碰注册表、也不发事件。
 */
export function apply(ctx: Context, config: Config): void {
  const allow = new Set(config.allowTools ?? []);
  if (allow.size === 0) {
    throw new Error(
      "context-scope: `allowTools` must name at least one tool; omit the row instead of mounting an empty scope",
    );
  }
  const presetKey = scopeOf(ctx);
  const scoped = new WeakSet<Agent>();

  if (config.runtimeContext === false) {
    // service 在 scoped ctx 上是 shadow：注册落在本行的 scope（preset 子树），抑制因此只覆盖这个模式。
    ctx.systemPrompt.suppressRuntimeContext();
  }

  const belongs = (agent: Agent): boolean => {
    if (presetKey === undefined) return true;
    const key = scopeOf(agent.ctx);
    return key !== undefined && scopeChainOf(key).includes(presetKey);
  };

  /** 每个会话只做一次：拨提示词开关，并挂上执行层白名单。 */
  const scopeOnce = (agent: Agent): void => {
    if (scoped.has(agent) || !belongs(agent)) return;
    scoped.add(agent);
    if (config.instructions === false) {
      // 通道是可选的（`ctx.get` 在未声明 inject 的 ctx 上会抛，所以自己兜住）：没有它就没有
      // instruction 可关，工具白名单照常生效——不该因为一个可选搭档缺席就让整个插件不激活。
      try {
        ctx.get("contextAssembler")?.setInstructions(agent, false);
      } catch {
        void 0;
      }
    }
    // inject 回调只是在该 ctx 上解锁 `tools`；调用必须落在 `agent.ctx` 上才是这个会话的作用域。
    agent.ctx.inject(["tools"], () => {
      agent.ctx.tools.guard((exec) => (allow.has(exec.name) ? undefined : OUT_OF_SCOPE(exec.name)));
    });
  };

  // 在**装配期**注册，不在创建期：创建期 tools 的可用性还在变，那时注册容易与装配流程互相牵扯
  // （`tools/change` 的回响就是这么来的）。目录过滤也在这里，每步幂等。
  ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
    const agent = context.agent;
    if (agent !== undefined) scopeOnce(agent);
    const result = await next();
    return { ...result, tools: result.tools.filter((tool) => allow.has(tool.name)) };
  });
}
