export type Token<T = any> = abstract new (...args: any[]) => T;

export type Newable<T = any> = new (...args: any[]) => T;

export type Awaitable<T> = T | Promise<T>;

export type ModuleClass = abstract new (...args: never[]) => unknown;

/**
 * Provider 能看到的 Context 面：只留生命周期；读服务走 `inject()`，发布原生服务名走
 * Provider 上的 `static service` / `static exposes`。
 */
export interface Context {
  effect(callback: (...args: any[]) => any, label?: string): () => void;
}

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
