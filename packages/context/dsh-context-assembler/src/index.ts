/**
 * 组装出口：按 config 把各能力装成一个 cordis 插件树。
 *
 * 装配面因此只有**一行**（`@morlay/dsh-context-assembler`）：`isolate` 是行级选项，一行声明就覆盖它整棵子树，
 * 而这里 `ctx.plugin()` 出来的子插件都继承行 ctx 的 isolate map 与 scope——**通道服务由这一行装一次**。
 * **每个子插件各有自己的 `inject`**（合成单入口会让 inject 变并集，一个可选搭档缺席就拖垮整包），这是这层
 * 组装唯一必须守住的东西。
 *
 * 模式之间的差异（哪个模式要哪些能力、工具收到什么程度）不在这里用 config 裁：由
 * `context-assembler-scope` 那一行把模式定义登记给通道（`options` 只用来给留下的能力传参，能力名就是子出口名）。
 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import * as agentInstructions from "./agent-instructions/index.ts";
import * as assembler from "./assembler/index.ts";
import * as scope from "./scope/index.ts";
import * as skillCatalog from "./skill-catalog/index.ts";

export const name = "context-assembler-tree";

const CAPABILITIES = {
  assembler,
  "agent-instructions": agentInstructions,
  "skill-catalog": skillCatalog,
  scope,
} as const;

export type Capability = keyof typeof CAPABILITIES;

const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as Capability[];

export interface Config {
  /** 装哪些能力（名字即子出口名）；缺省全部——标准模式要完整的一套。未知名字在装载时报错。 */
  capabilities?: string[];
  /** 各能力自己的 config，按能力名给（例如 `{ scope: { allowTools: [...] } }`）。 */
  options?: Record<string, Record<string, unknown>>;
}

export const Config: z<Config> = z.object({
  capabilities: z.array(z.string()).default([...CAPABILITY_NAMES]),
  options: z.any().default({}),
});

export function apply(ctx: Context, config: Config): void {
  const wanted = config.capabilities ?? CAPABILITY_NAMES;
  const options = config.options ?? {};
  for (const name of wanted) {
    const capability = CAPABILITIES[name as Capability];
    if (capability === undefined) {
      throw new Error(
        `context: unknown capability "${name}"（可选：${CAPABILITY_NAMES.join(" / ")}）`,
      );
    }
    ctx.plugin(capability, options[name] ?? {});
  }
}
