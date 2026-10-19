import type { Context } from "@deepseek-ai/cordis";
import { ContextAssembler } from "./channel.ts";
import { Config, install, type Config as ConfigShape } from "./index.ts";

export { Config };
export { DEFAULT_KEEP, DEFAULT_REPLACE, DEFAULT_SUPPRESS } from "./defaults.ts";

export const inject = ["systemPrompt"];

export function apply(ctx: Context, config: ConfigShape): void {
  install(ctx, config, new ContextAssembler(ctx), ctx.systemPrompt);
}
