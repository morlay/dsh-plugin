export type Token<T = any> = abstract new (...args: any[]) => T;

export type Newable<T = any> = new (...args: any[]) => T;

export type Awaitable<T> = T | Promise<T>;

/**
 * `onInit(ctx)` 的 ctx 就是**真实的 cordis Context**（`attach.ts` 直接把 cordis ctx 传进来）。
 *
 * 这里不再另造窄接口：窄类型会让「上游 API 要 cordis Context」的每一处消费方都写一次
 * `ctx as never` 的谎报，成本从一处定义转嫁成 N 处 cast。类型诚实、运行时不变。
 */
import type { Context as CordisContext } from "@deepseek-ai/cordis";

export type { CordisContext };

export type Context = CordisContext;

/** 只需要装配的 Provider：`implements OnInit`，`onInit()` 不用 ctx 时可省略参数。 */
export interface OnInit {
  onInit(ctx: Context): Awaitable<void>;
}

/** 只需要清理的 Provider。 */
export interface OnDispose {
  onDispose(): Awaitable<void>;
}

/** 两者都要时的组合（大多数 Provider 只是其中之一，按需 `implements`）。 */
export interface Lifecycle extends Partial<OnInit>, Partial<OnDispose> {}

// 可等待的 fiber：`await` 之后还能单独 dispose。
export type InjectedFiber = Promise<unknown> & { dispose(): void };

// 上游 logger 的类型面（业务包从这里取，不直接 import cordis）。
export type { LoggerService } from "@deepseek-ai/cordis";
