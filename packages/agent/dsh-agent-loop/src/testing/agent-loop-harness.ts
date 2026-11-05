// 「跑一轮」的测试装配：**本仓实现**（不借上游 testkit）。
//
// 两条入口：
//   - `loopTestProviders()`：返回 `ProviderList`（`bootstrapApplication` 装）；
//   - `mountLoopTestDependencies()` / `mountLoopTestHarness()`：往一个 cordis ctx 里逐条挂
//     （给「一行一行挂、单独观察某一行」的 spec 用，实现走本包的 `mountProviders`）。
import { configure, provide, type ProviderList } from "@morlay/zephyr";
import { SystemPromptDefault, provideAgent } from "@morlay/dsh-agent";
import { provideSession, provideSessionProjection } from "@morlay/dsh-session/server";
import { AgentLoopDefault, ToolExecutorNative } from "../index.ts";
import {
  bridgeContractToUpstream,
  mountProvider,
  mountProviders,
  type MountedRow,
} from "./mount.ts";

/** 上游 `Agent` 的类型面（vendor 的模块增强，本仓 program 看不到整份形状）。 */
export type Agent = import("@morlay/dsh-agent/contract").Agent;

/** 循环本体那一份（默认 `agents: []`）。 */
const loopRow = provide([AgentLoopDefault], [configure(AgentLoopDefault, { agents: [] })]);

/** 装配选项（与上游 testkit 的三个选项同义）。 */
export interface LoopTestOptions {
  /** 装上工作目录（要读目录的用例才需要）。 */
  readonly workingDirectory?: boolean;
  /** 提示词配置（透传给 `SystemPromptDefault`，形状由上游 `Config` 决定）。 */
  readonly systemPrompt?: Record<string, unknown>;
  /** 工具面：`native` 或 `ptc`（默认 native）。 */
  readonly tools?: { readonly mode?: "native" | "ptc" };
}

/**
 * 跑一轮对话所需的装配清单（本仓的装配方式）。
 *
 * 装「骨架（含提示词与默认模型）+ 会话 + 投影 + 执行器」；`headless` 时到此为止，不装循环本体。
 * @param options - 见 `LoopTestOptions` 与 `headless`。
 * @returns 条目清单。
 */
export function loopTestProviders(
  options: LoopTestOptions & { readonly headless?: boolean } = {},
): ProviderList {
  const systemPrompt = options.systemPrompt;
  const personaLed =
    systemPrompt === undefined
      ? [...provideAgent()]
      : [...provideAgent(configure(SystemPromptDefault, systemPrompt as never))];
  return [
    ...provideSession(),
    ...provideSessionProjection(),
    ...personaLed,
    ToolExecutorNative,
    ...(options.headless === true ? [] : loopRow()),
  ];
}

/** 测试驱动面：建真 agent 并驱动它的收件箱（与上游 harness 同形）。 */
export interface LoopHarness {
  /** 建一个真 agent（与它的会话）。 */
  create(id: unknown, options?: unknown, meta?: unknown): Promise<Agent>;
  /** 这一轮的收件箱：投递一条用户消息并取回要处理的那几条。 */
  claim(agent: Agent, target: unknown, turn: number): readonly unknown[];
}

/**
 * 往给定 ctx 里装「跑一轮」的依赖（不含循环本体）。
 * @param ctx - 拥有这些服务的测试上下文。
 * @param options - 装配选项。
 * @returns 已挂的行。
 */
/** 懒装配上下文的最小面（`session-mode` 的测试支撑提供）。 */
interface LazyLike {
  add(providers: readonly unknown[]): void;
}

function lazyOf(ctx: unknown): LazyLike | undefined {
  const candidate = ctx as Partial<LazyLike>;
  return typeof candidate.add === "function" ? (ctx as LazyLike) : undefined;
}

export async function mountLoopTestDependencies(
  ctx: unknown,
  options: LoopTestOptions = {},
): Promise<MountedRow[]> {
  const lazy = lazyOf(ctx);
  if (lazy !== undefined) {
    // 懒装配：只收集，`ctx.ready()` 时统一 bootstrap。
    lazy.add(loopTestProviders({ ...options, headless: true }) as readonly unknown[]);
    return [];
  }
  const rows = await mountProviders(ctx, loopTestProviders({ ...options, headless: true }));
  bridgeContractToUpstream(ctx);
  return rows;
}

/**
 * 装循环本体并给出驱动面。调用前先 `mountLoopTestDependencies`。
 * @param ctx - 已装好依赖的测试上下文。
 * @returns 本仓的驱动面。
 */
export async function mountLoopTestHarness(ctx: unknown): Promise<LoopHarness> {
  const lazy = lazyOf(ctx);
  if (lazy !== undefined) {
    // 懒装配：把循环本体也收进清单，`create()` 之前再 `ready()`。
    lazy.add(loopRow() as readonly unknown[]);
    const lazyCtx = ctx as { ready(): Promise<void>; get(name: unknown): unknown };
    return {
      create: async (id, options, meta) => {
        await lazyCtx.ready();
        const service = lazyCtx.get("agentLoop") as {
          create(id: unknown, options?: unknown, meta?: unknown): Promise<Agent>;
        };
        return await service.create(id, options, meta);
      },
      claim: (agent, target, turn) =>
        (
          agent as unknown as {
            inbox: { claim(target: unknown, turn: number): readonly unknown[] };
          }
        ).inbox.claim(target, turn),
    };
  }
  const row = await mountProvider(ctx, AgentLoopDefault, { agents: [] });
  const service = row.instance as {
    create(id: unknown, options?: unknown, meta?: unknown): Promise<Agent>;
  };
  return {
    create: async (id, options, meta) => await service.create(id, options, meta),
    claim: (agent, target, turn) =>
      (
        agent as unknown as { inbox: { claim(target: unknown, turn: number): readonly unknown[] } }
      ).inbox.claim(target, turn),
  };
}
