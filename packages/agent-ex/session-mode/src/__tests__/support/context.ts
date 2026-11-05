// 测试里用的 **cordis 根 ctx 的类型面**。
//
// 运行时它就是 `bootstrapApplication` 回来的 `App.ctx`（真 cordis 根 ctx）；这里的交叉只是补上
// vendor 的模块增强在本仓 TS program 里看不到的那几个服务属性（`ctx.sessionModes` 等）。
import type { Context as CordisContext } from "@morlay/zephyr";
import type { Agent } from "@morlay/dsh-agent/contract";
import type { ContextAssembler } from "../../contract/context-assembler.contract.ts";
import type { SessionMode } from "../../contract/session-mode.contract.ts";

/** 测试用的根 ctx：cordis 的完整面 + 本包与相邻域按别名读的那几个服务。 */
export type TestContext = CordisContext & {
  /** 按服务名读（cordis 的服务表）。 */
  get(name: string, strict?: boolean): unknown;
  /** 按名字发一个服务。 */
  provide(name: string, value: unknown): void;
  readonly sessionModes: SessionMode;
  readonly contextAssembler: ContextAssembler;
  readonly systemPrompt: {
    assemble(agent: unknown): Promise<unknown>;
    section(value: { name: string; order: number; text: unknown }): () => void;
    context(value: { name: string; order: number; text: unknown }): () => void;
  };
  readonly tools: {
    register(tool: unknown): () => void;
    definitions(scope?: unknown): readonly { readonly name: string }[];
    schemas(scope?: unknown): readonly { readonly name: string }[];
    execute(input: unknown): Promise<unknown>;
  };
  readonly agents: {
    create(options: { sessionId: unknown }): Promise<{ agent: Agent }>;
    resume(options: unknown): Promise<{ agent: Agent }>;
  };
  readonly agentLoop: {
    create(id: unknown, options?: unknown, meta?: unknown): Promise<Agent>;
    createAgent(ctx: unknown, options: unknown): Promise<{ agent: Agent }>;
  };
};
